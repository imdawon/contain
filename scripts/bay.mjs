#!/usr/bin/env node
/** Call live `window.__bay` through the Vite `/__bay` pipe. No browser. */
const base = (process.env.BAY_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const fn = process.argv[2];
if (!fn) {
  console.error("usage: node scripts/bay.mjs <fn> [jsonOrString args...]");
  process.exit(2);
}

const args = process.argv.slice(3).map((s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
});

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
const r = await fetch(`${base}/__bay`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fn, args, waitMs }),
});
const text = await r.text();
process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
if (!r.ok) process.exit(1);
