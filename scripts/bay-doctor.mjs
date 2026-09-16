#!/usr/bin/env node
/** Wrapper around `node scripts/bay.mjs` health / peek / history. No second HTTP client. */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileMeanLuma } from "./jpeg-luma.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bayPath = join(here, "bay.mjs");
const PROOF = "/tmp/bay-doctor-proof.json";

function callBay(fn, extra = []) {
  const r = spawnSync(process.execPath, [bayPath, fn, ...extra], {
    encoding: "utf8",
    env: process.env,
    cwd: root,
  });
  const text = String(r.stdout || "").trim();
  try {
    const body = JSON.parse(text);
    return { ok: r.status === 0 && body.ok !== false, status: r.status ?? 1, ...body };
  } catch {
    return {
      ok: false,
      error: "bad-json",
      takers: 0,
      paints: 0,
      stderr: String(r.stderr || "").slice(0, 240),
    };
  }
}

function unwrap(raw) {
  if (raw && typeof raw === "object" && raw.value != null && typeof raw.value === "object") {
    return raw.value;
  }
  return raw && typeof raw === "object" ? raw : {};
}

function nobjOf(health, peek) {
  const list = Array.isArray(health?.list) ? health.list : [];
  const fromList = list.reduce((m, t) => Math.max(m, Number(t?.nobj) || 0), 0);
  const fromPeek = Number(peek?.nobj ?? peek?.objects?.length ?? 0);
  return Math.max(fromList, fromPeek);
}

const health = callBay("health");
const peek = unwrap(callBay("peek"));
const history = unwrap(callBay("history"));

const takers = Number(health.takers ?? 0);
const paints = Number(health.paints ?? 0);
const clients = Number(health.clients ?? 0);
const nobj = nobjOf(health, peek);

let miss = null;
if (takers < 1) miss = "takers-0";
else if (paints < 1) miss = "paints-0";

let luma = null;
if (takers >= 1 && paints >= 1) {
  const shot = callBay("shot", ["/tmp/bay-doctor.jpg"]);
  if (!shot.ok) {
    miss = "no-shot";
  } else if (!existsSync("/tmp/bay-doctor.jpg")) {
    miss = "no-shot";
  } else {
    luma = fileMeanLuma("/tmp/bay-doctor.jpg");
    if (luma == null || luma < 8) miss = "black-frame";
  }
}

const pass = miss == null;
const summary = {
  ok: pass,
  pass,
  miss,
  takers,
  paints,
  clients,
  nobj,
  luma,
  scene: peek?.scene?.id ?? peek?.scene ?? null,
  historyN: Array.isArray(history) ? history.length : 0,
  gates: "takers>=1 && paints>=1",
};

writeFileSync(PROOF, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary)}\n`);
process.exit(pass ? 0 : 1);
