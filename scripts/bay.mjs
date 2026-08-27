#!/usr/bin/env node
/** Call live `window.__bay` through the Vite `/__bay` pipe. No browser. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const base = (process.env.BAY_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const fn = process.argv[2];
if (!fn) {
  console.error("usage: node scripts/bay.mjs <fn> [jsonOrString args...]");
  process.exit(2);
}

function parseArg(s) {
  const abs = resolve(s);
  if (s.endsWith(".json") && existsSync(abs)) {
    return JSON.parse(readFileSync(abs, "utf8"));
  }
  if (existsSync(s) && s.endsWith(".json")) {
    return JSON.parse(readFileSync(s, "utf8"));
  }
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

const args = process.argv.slice(3).map(parseArg);

async function readJson(r) {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "bad-json", raw: text.slice(0, 400) };
  }
}

async function health() {
  const r = await fetch(`${base}/__bay/health`);
  const body = await readJson(r);
  return { ok: r.ok && body.ok !== false, status: r.status, ...body };
}

async function reloadPage() {
  const r = await fetch(`${base}/__bay/reload`, { method: "POST" });
  return readJson(r);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function waitForTaker(ms = 8000) {
  const t0 = Date.now();
  let last = await health();
  while (Date.now() - t0 < ms) {
    if ((last.takers ?? 0) > 0 || (last.clients ?? 0) > 0) {
      if ((last.takers ?? 0) > 0) return last;
    }
    await sleep(200);
    last = await health();
  }
  return last;
}

if (fn === "health") {
  const h = await health();
  process.stdout.write(`${JSON.stringify(h)}\n`);
  process.exit(h.ok ? 0 : 1);
}

if (fn === "reload") {
  const out = await reloadPage();
  const waited = await waitForTaker(10000);
  process.stdout.write(`${JSON.stringify({ ...out, ...waited })}\n`);
  process.exit((waited.takers ?? 0) > 0 ? 0 : 1);
}

let waitMs = 20000;
if (fn === "until") waitMs = Math.max(waitMs, Number(args[1] || 8000) + 4000);
if (fn === "tape") waitMs = 60000;
let pipeArgs = args;
let tapeDest = null;
if (fn === "tape") {
  const scene = args[0];
  const maybeDest = typeof args[1] === "string" && /\.(webm|mp4)$/i.test(args[1]) ? args[1] : null;
  const ms = maybeDest ? args[2] : args[1];
  tapeDest = maybeDest || "screenshots/bay-tape.webm";
  pipeArgs = [scene, ms].filter((x) => x !== undefined);
}
const r = await fetch(`${base}/__bay`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fn, args: pipeArgs, waitMs }),
});
const text = await r.text();
let out = text;
if (fn === "shot") {
  try {
    const parsed = JSON.parse(text);
    const val = parsed.value && typeof parsed.value === "object" ? parsed.value : parsed;
    if (val && typeof val.data === "string" && val.data.startsWith("data:image")) {
      const dest = typeof args[0] === "string" && args[0].length ? resolve(args[0]) : resolve("screenshots/bay-shot.jpg");
      mkdirSync(dirname(dest), { recursive: true });
      const b64 = val.data.split(",")[1] ?? "";
      writeFileSync(dest, Buffer.from(b64, "base64"));
      delete val.data;
      val.file = dest;
      parsed.value = val;
      parsed.ok = parsed.ok !== false && val.ok !== false;
      out = `${JSON.stringify(parsed)}\n`;
    }
  } catch {
    /* keep raw */
  }
}
if (fn === "tape") {
  try {
    const parsed = JSON.parse(text);
    const val = parsed.value && typeof parsed.value === "object" ? parsed.value : parsed;
    const frames = Array.isArray(val?.frames) ? val.frames.filter((f) => typeof f === "string" && f.startsWith("data:image")) : [];
    const dest = resolve(typeof tapeDest === "string" ? tapeDest.replace(/\.webm$/i, ".mp4") : "screenshots/bay-tape.mp4");
    const mp4 = dest.endsWith(".mp4") ? dest : dest.replace(/\.[^.]+$/, "") + ".mp4";
    if (frames.length >= 3) {
      const dir = join(dirname(mp4), `.tape-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      frames.forEach((f, i) => {
        const b64 = String(f).split(",")[1] ?? "";
        writeFileSync(join(dir, `f${String(i).padStart(4, "0")}.jpg`), Buffer.from(b64, "base64"));
      });
      const ff = spawnSync(
        "ffmpeg",
        ["-y", "-framerate", "20", "-i", join(dir, "f%04d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", mp4],
        { encoding: "utf8" },
      );
      rmSync(dir, { recursive: true, force: true });
      delete val.frames;
      val.n = frames.length;
      val.file = mp4;
      val.ffmpeg = ff.status;
      parsed.value = val;
      parsed.ok = parsed.ok !== false && val.ok !== false && ff.status === 0;
      out = `${JSON.stringify(parsed)}\n`;
    } else if (val) {
      delete val.frames;
      val.n = frames.length;
      parsed.value = val;
      parsed.ok = false;
      out = `${JSON.stringify(parsed)}\n`;
    }
  } catch {
    /* keep raw */
  }
}
process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
if (!r.ok) process.exit(1);
