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
