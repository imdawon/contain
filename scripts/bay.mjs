#!/usr/bin/env node
/** Call live `window.__bay` through the Vite `/__bay` pipe. No browser. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { writeScoreWav } from "./sfx-score.mjs";
import { Agent, setGlobalDispatcher } from "undici";
setGlobalDispatcher(new Agent({ headersTimeout: 600000, bodyTimeout: 600000, connectTimeout: 600000 }));

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
  // Owned hangar paint uses ?hmr=false, so Vite WS full-reload never reaches it.
  let pipeOut = null;
  try {
    const pr = await fetch(`${base}/__bay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fn: "reload", args: [], waitMs: 4000 }),
    });
    pipeOut = await readJson(pr);
  } catch (err) {
    pipeOut = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  const out = await reloadPage();
  const t0 = Date.now();
  let waited = await health();
  while (Date.now() - t0 < 15000) {
    if ((waited.takers ?? 0) > 0 && (waited.paints ?? 0) > 0) break;
    await sleep(250);
    waited = await health();
  }
  process.stdout.write(`${JSON.stringify({ ...out, pipe: pipeOut, ...waited })}\n`);
  process.exit((waited.takers ?? 0) > 0 && (waited.paints ?? 0) > 0 ? 0 : 1);
}

if (fn === "abort" || fn === "cancel") {
  const ar = await fetch(`${base}/__bay/abort`, { method: "POST" });
  const body = await readJson(ar);
  process.stdout.write(`${JSON.stringify(body)}\n`);
  process.exit(body.ok ? 0 : 1);
}

let waitMs = 20000;
if (fn === "until") waitMs = Math.max(waitMs, Number(args[1] || 8000) + 4000);
if (fn === "restage" || fn === "load" || fn === "run") waitMs = 60000;
if (fn === "tape") waitMs = 120000;
let pipeFn = fn;
let pipeArgs = args;
let tapeDest = null;
let writeDest = null;
if (fn === "tape") {
  const scene = args[0];
  const maybeDest = typeof args[1] === "string" && /\.(webm|mp4)$/i.test(args[1]) ? args[1] : null;
  const ms = maybeDest ? args[2] : args[1];
  tapeDest = maybeDest || "screenshots/bay-tape.webm";
  pipeArgs = [scene, ms].filter((x) => x !== undefined);
}
if (fn === "writeScene") {
  const a0 = args[0];
  const a1 = args[1];
  const destArg = typeof a0 === "string" && /\.json$/i.test(a0) ? a0 : typeof a1 === "string" && /\.json$/i.test(a1) ? a1 : null;
  const nameArg = destArg === a0 ? undefined : a0;
  pipeFn = "exportScene";
  pipeArgs = nameArg != null && nameArg !== "" ? [nameArg] : [];
  writeDest = destArg;
}
const r = await fetch(`${base}/__bay`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fn: pipeFn, args: pipeArgs, waitMs }),
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


function writeWhooshWav(path, reverse) {
  const sr = 44100;
  const n = Math.floor(sr * 0.8);
  const samples = new Float32Array(n);
  let ph1 = 0;
  let ph2 = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const env = Math.min(1, i / (sr * 0.045)) * (1 - u) ** 0.36;
    const f1 = 620 * 0.12 ** u;
    const f2 = 210 * 0.17 ** u;
    ph1 += (2 * Math.PI * f1) / sr;
    ph2 += (2 * Math.PI * f2) / sr;
    const noise = Math.random() * 2 - 1;
    const cut = 0.2 * (1 - u) + 0.018;
    lp += cut * (noise - lp);
    samples[i] = Math.max(-1, Math.min(1, (lp * 0.7 + Math.sin(ph1) * 0.34 + Math.sin(ph2) * 0.5) * env));
  }
  if (reverse) {
    for (let i = 0, j = n - 1; i < j; i++, j--) {
      const tmp = samples[i];
      samples[i] = samples[j];
      samples[j] = tmp;
    }
  }
  let oscPh = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f0 = reverse ? 42 : 96;
    const f1 = reverse ? 170 : 36;
    const f = f0 * (f1 / f0) ** Math.min(1, t / 0.58);
    oscPh += (2 * Math.PI * f) / sr;
    const g = 0.2 * Math.exp(-t / 0.22);
    samples[i] = Math.max(-1, Math.min(1, samples[i] + Math.sin(oscPh) * g));
  }
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(sr, 24);
  pcm.writeUInt32LE(sr * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  writeFileSync(path, pcm);
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
      const wallMs = Number(val?.durationMs);
      const durationSec = wallMs > 0 ? wallMs / 1000 : Number(val?.durationSec) > 0 ? Number(val.durationSec) : 0;
      const jpegN = Number(val?.jpegN) > 0 ? Number(val.jpegN) : frames.length;
      const fps = durationSec > 0 ? jpegN / durationSec : 30;
      const ff = spawnSync(
        "ffmpeg",
        ["-y", "-framerate", String(fps), "-i", join(dir, "f%04d.jpg"), "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", mp4],
        { encoding: "utf8" },
      );
      const slowAt = Number(val?.slowAtMs);
      const slowOff = Number(val?.slowOffMs);
      const contacts = Array.isArray(val?.contacts)
        ? val.contacts
        : (Array.isArray(val?.hitsMs) ? val.hitsMs.map((n) => ({ tMs: Number(n), impulse: 800, closing: 12 })) : []);
      const speedHz = Array.isArray(val?.speedHz) ? val.speedHz.map((n) => Number(n) || 0) : [];
      const wantSteel = ff.status === 0 && !(Number.isFinite(slowAt) && slowAt > 0) && durationSec > 2;
      if (wantSteel) {
        const bed = join(dir, "steel-bed.wav");
        const mixed = mp4.replace(/\.mp4$/i, ".a.mp4");
        const groundedHz = Array.isArray(val?.groundedHz) ? val.groundedHz.map((n) => Number(n) > 0) : undefined;
        writeScoreWav(bed, durationSec, speedHz, contacts, groundedHz);
        const mix = spawnSync("ffmpeg", ["-y", "-i", mp4, "-i", bed, "-filter_complex", "[1:a]apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", mixed], { encoding: "utf8" });
        if (mix.status === 0 && existsSync(mixed)) {
          writeFileSync(mp4, readFileSync(mixed));
          rmSync(mixed, { force: true });
          val.audio = true;
        } else {
          val.audio = false;
          val.audioErr = (mix.stderr || mix.stdout || "").slice(-400);
        }
      }
      if (ff.status === 0 && Number.isFinite(slowAt) && slowAt > 0) {
        const inn = join(dir, "whoosh-in.wav");
        const outw = join(dir, "whoosh-out.wav");
        const mixed = mp4.replace(/\.mp4$/i, ".a.mp4");
        writeWhooshWav(inn, false);
        const fc = [];
        const ins = ["-y", "-i", mp4, "-i", inn];
        if (Number.isFinite(slowOff) && slowOff > slowAt) {
          writeWhooshWav(outw, true);
          ins.push("-i", outw);
          fc.push(`[1:a]adelay=${Math.round(slowAt)}|${Math.round(slowAt)}[in]`);
          fc.push(`[2:a]adelay=${Math.round(slowOff)}|${Math.round(slowOff)}[out]`);
          fc.push("[in][out]amix=inputs=2:normalize=0,apad[a]");
        } else {
          fc.push(`[1:a]adelay=${Math.round(slowAt)}|${Math.round(slowAt)},apad[a]`);
        }
        const mix = spawnSync("ffmpeg", [...ins, "-filter_complex", fc.join(";"), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", mixed], { encoding: "utf8" });
        if (mix.status === 0 && existsSync(mixed)) {
          writeFileSync(mp4, readFileSync(mixed));
          rmSync(mixed, { force: true });
          val.audio = true;
        } else {
          val.audio = false;
          val.audioErr = (mix.stderr || mix.stdout || "").slice(-400);
        }
      }
      rmSync(dir, { recursive: true, force: true });
      val.jpegN = jpegN;
      val.n = jpegN;
      delete val.frames;
      val.file = mp4;
      val.ffmpeg = ff.status;
      if (wallMs > 0) val.durationSec = wallMs / 1000;
      if (ff.status === 0 && existsSync(mp4)) {
        const probe = spawnSync(
          "ffprobe",
          ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,nb_frames,duration", "-of", "json", mp4],
          { encoding: "utf8" },
        );
        let mp4Frames = 0;
        let mp4DurationSec = 0;
        try {
          const info = JSON.parse(probe.stdout || "{}");
          const st = Array.isArray(info.streams) ? info.streams[0] : null;
          const readN = Number(st?.nb_read_frames);
          const nb = Number(st?.nb_frames);
          mp4Frames = Number.isFinite(readN) && readN > 0 ? readN : Number.isFinite(nb) && nb > 0 ? nb : 0;
          const dur = Number(st?.duration);
          if (Number.isFinite(dur) && dur > 0) mp4DurationSec = dur;
        } catch {
          /* keep zeros */
        }
        val.mp4Frames = mp4Frames;
        val.mp4DurationSec = mp4DurationSec;
      }
      val.fps = durationSec > 0 ? jpegN / durationSec : 30;
      val.framesPerSec = val.fps;
      val.bake = true;
      if (val.aborted === true) val.aborted = true;
      parsed.value = val;
      parsed.ok = parsed.ok !== false && val.ok !== false && ff.status === 0;
      if (val.aborted === true) parsed.ok = false;
      out = `${JSON.stringify(parsed)}\n`;
    } else if (val) {
      const jpegN = Number(val.jpegN) > 0 ? Number(val.jpegN) : frames.length;
      val.jpegN = jpegN;
      val.n = jpegN;
      if (val.aborted === true) val.aborted = true;
      delete val.frames;
      if (Number(val.durationMs) > 0) val.durationSec = Number(val.durationMs) / 1000;
      else if (!(Number(val.durationSec) > 0)) val.durationSec = 0;
      val.fps = Number(val.durationSec) > 0 ? jpegN / Number(val.durationSec) : 0;
      val.framesPerSec = val.fps;
      val.bake = val.bake === true;
      parsed.value = val;
      parsed.ok = false;
      out = `${JSON.stringify(parsed)}\n`;
    }
  } catch {
    /* keep raw */
  }
}

if (fn === "writeScene") {
  try {
    const parsed = JSON.parse(out);
    const val = parsed.value && typeof parsed.value === "object" ? parsed.value : parsed;
    const scene = val && val.scene && typeof val.scene === "object" ? val.scene : null;
    if (scene && typeof scene.id === "string") {
      const dest = resolve(writeDest || `public/scenes/${scene.id}.json`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, `${JSON.stringify(scene, null, 2)}\n`);
      val.file = dest;
      val.n = Array.isArray(scene.entities) ? scene.entities.length : 0;
      delete val.json;
      parsed.value = val;
      parsed.ok = parsed.ok !== false;
      out = `${JSON.stringify(parsed)}\n`;
    }
  } catch {
    /* keep raw */
  }
}

process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
if (!r.ok) process.exit(1);
