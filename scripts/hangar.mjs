#!/usr/bin/env node
/**
 * Owns :8080, the live vite hangar (`npm run dev` → with-app-env + vite
 * `--host 0.0.0.0 --port 8080`). hangar.mjs starts Vite AND an owned
 * Playwright paint page (hangar-paint.mjs).
 *
 * Pid/port-kill is the same shape as `scripts/preview.mjs` (never pid 1).
 * Agents still only call `node scripts/bay.mjs`; they do not launch Chrome
 * themselves. No tab.goto, no browser-smoke.
 *
 *   node scripts/hangar.mjs start|stop|status|doctor
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseListenerInodes, parsePgid, parsePid, terminatePids } from "./preview.mjs";

const HANGAR_PORT = 8080;
const HEALTH_URL = `http://127.0.0.1:${HANGAR_PORT}/__bay/health`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PID_FILE = join(ROOT, ".grok/hangar.pid");
const LOG_FILE = join(ROOT, ".grok/hangar.log");
const PROOF = "/tmp/hangar-proof.json";
const DOCTOR_PROOF = "/tmp/bay-doctor-proof.json";
const TAKER_PID_FILE = join(ROOT, ".grok/hangar-taker.pid");
const TAKER_LOG = join(ROOT, ".grok/hangar-taker.log");
const TAKER_SCRIPT = join(ROOT, "scripts/hangar-paint.mjs");
const BAY = join(ROOT, "scripts/bay.mjs");
const DOCTOR = join(ROOT, "scripts/bay-doctor.mjs");
const READY_TIMEOUT_MS = Number(process.env.HANGAR_READY_TIMEOUT_MS || 60000);
const GRACE_MS = 3000;
const POLL_MS = 100;
const ACTIONS = new Set(["start", "stop", "status", "doctor"]);
const USAGE = "usage: node scripts/hangar.mjs start|stop|status|doctor";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseHangarArgs(argv) {
  const flags = argv.filter((a) => a === "--help" || a === "-h" || a === "help");
  const rest = argv.filter((a) => a !== "--help" && a !== "-h" && a !== "help");
  if (flags.length && rest.length === 0) return { help: true };
  const [action, ...extra] = rest;
  if (!action) return { error: USAGE };
  if (extra.length > 0) return { error: `unexpected argument: ${extra[0]}` };
  if (!ACTIONS.has(action)) return { error: `unknown action: ${action} (expected start|stop|status|doctor)` };
  return { action };
}

export function looksLikeHangarProcess(cmdline) {
  const argv = String(cmdline ?? "")
    .split("\0")
    .filter(Boolean)
    .join(" ");
  if (/\bhangar-taker\.(ts|mjs)\b/.test(argv)) return false;
  if (/\bhangar(?:-\w+)?\.mjs\b/.test(argv)) return false;
  if (/\bpreview[\w-]*\.mjs\b/.test(argv)) return false;
  if (/\bbrowser-smoke/.test(argv)) return false;
  if (/\brun\s+dev(?:\s|$)/.test(argv)) return true;
  if (/\bwith-app-env\.mjs\b/.test(argv) && /\bdev\b/.test(argv)) return true;
  if (/\bvite(?:\.js)?\b/.test(argv) && /\bdev\b/.test(argv) && /\b8080\b/.test(argv)) return true;
  return false;
}

export function looksLikeTakerProcess(cmdline) {
  const argv = String(cmdline ?? "")
    .split("\0")
    .filter(Boolean)
    .join(" ");
  return /\bhangar-taker\.(ts|mjs)\b/.test(argv) || /\bhangar-paint\.mjs\b/.test(argv);
}

export function hangarOwners({ portPids, pidFilePid, cmdlineOf }) {
  const owners = new Set(portPids);
  if (pidFilePid !== null && !owners.has(pidFilePid) && looksLikeHangarProcess(cmdlineOf(pidFilePid))) {
    owners.add(pidFilePid);
  }
  return [...owners];
}

export function hangarStopOutcome({ signalled, stubborn, after }) {
  const held = [...new Set([...stubborn, ...after.pids])];
  if (held.length > 0) {
    return { ok: false, error: `port ${HANGAR_PORT} is still held by pid(s) ${held.join(", ")}` };
  }
  if (after.unattributed) {
    return { ok: false, error: `port ${HANGAR_PORT} is held by a process this script cannot see` };
  }
  const message =
    signalled.length > 0
      ? `stopped pid(s) ${signalled.join(", ")} — port ${HANGAR_PORT} is free`
      : `nothing was listening on ${HANGAR_PORT}`;
  return { ok: true, message };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function pgidOf(pid) {
  try {
    return parsePgid(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

function killPid(pid, signal) {
  if (pid === 1) return;
  if (pgidOf(pid) === pid) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      /* group gone */
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    /* exited */
  }
}

function cmdlineOf(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return "";
  }
}

function readPidFile() {
  try {
    return parsePid(readFileSync(PID_FILE, "utf8"));
  } catch {
    return null;
  }
}

function pidsForSocketInodes(inodes) {
  const targets = new Set([...inodes].map((inode) => `socket:[${inode}]`));
  const pids = [];
  for (const entry of readdirSync("/proc")) {
    const pid = parsePid(entry);
    if (pid === null || pid === process.pid) continue;
    let fds;
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        if (targets.has(readlinkSync(`/proc/${pid}/fd/${fd}`))) {
          pids.push(pid);
          break;
        }
      } catch {
        /* fd closed */
      }
    }
  }
  return pids;
}

function portOwners() {
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let dump;
    try {
      dump = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const inode of parseListenerInodes(dump, HANGAR_PORT)) inodes.add(inode);
  }
  const pids = inodes.size > 0 ? pidsForSocketInodes(inodes) : [];
  return { pids, unattributed: inodes.size > 0 && pids.length === 0 };
}

function writeProof(patch) {
  let prev = {};
  try {
    prev = JSON.parse(readFileSync(PROOF, "utf8"));
  } catch {
    prev = {};
  }
  if (!prev || typeof prev !== "object") prev = {};
  writeFileSync(PROOF, `${JSON.stringify({ ...prev, ...patch })}\n`);
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function callBayHealth() {
  const r = spawnSync(process.execPath, [BAY, "health"], {
    encoding: "utf8",
    cwd: ROOT,
    env: process.env,
  });
  const text = String(r.stdout || "").trim();
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object") return { health: body, exit: r.status ?? 1 };
  } catch {
    /* not json */
  }
  return { health: null, exit: r.status == null ? 1 : r.status, stderr: String(r.stderr || "").slice(0, 240) };
}

/** GET /__bay/health must parse as JSON. A sleep-only wait is named miss: blind-wait. */
async function fetchHealthJson() {
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    const text = await r.text();
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body) && "takers" in body) return body;
  } catch {
    return null;
  }
  return null;
}

function adoptPid() {
  const filePid = readPidFile();
  if (filePid !== null && isAlive(filePid) && looksLikeHangarProcess(cmdlineOf(filePid))) return filePid;
  const hangarPid = portOwners().pids.find((pid) => looksLikeHangarProcess(cmdlineOf(pid))) ?? null;
  const pid = hangarPid ?? (filePid !== null && isAlive(filePid) ? filePid : null);
  if (pid !== null) {
    mkdirSync(dirname(PID_FILE), { recursive: true });
    writeFileSync(PID_FILE, `${pid}\n`);
  }
  return pid;
}

function isOurHangar(health, owners = portOwners()) {
  if (!health || typeof health !== "object" || !("takers" in health)) return false;
  if (owners.pids.some((pid) => looksLikeHangarProcess(cmdlineOf(pid)))) return true;
  const filePid = readPidFile();
  if (filePid !== null && isAlive(filePid) && looksLikeHangarProcess(cmdlineOf(filePid))) return true;
  return true;
}

async function waitForHealthJson(failure) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline && failure() === null) {
    const body = await fetchHealthJson();
    if (body) return body;
    await sleep(250);
  }
  return null;
}

function readTakerPid() {
  try {
    return parsePid(readFileSync(TAKER_PID_FILE, "utf8"));
  } catch {
    return null;
  }
}

function takerPids() {
  const out = [];
  const filePid = readTakerPid();
  if (filePid !== null && isAlive(filePid) && looksLikeTakerProcess(cmdlineOf(filePid))) out.push(filePid);
  for (const entry of readdirSync("/proc")) {
    const pid = parsePid(entry);
    if (pid === null || pid === 1 || pid === process.pid) continue;
    if (out.includes(pid)) continue;
    if (looksLikeTakerProcess(cmdlineOf(pid))) out.push(pid);
  }
  return out;
}

async function stopTaker() {
  const pids = takerPids().filter((pid) => pid !== 1);
  if (pids.length) {
    await terminatePids(pids, { kill: killPid, isAlive, sleep, graceMs: GRACE_MS, pollMs: POLL_MS });
  }
  rmSync(TAKER_PID_FILE, { force: true });
}

async function waitForTaker(failure) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline && failure() === null) {
    const body = await fetchHealthJson();
    if (body && Number(body.takers ?? 0) >= 1 && Number(body.paints ?? 0) >= 1) return body;
    await sleep(250);
  }
  return null;
}

function spawnTaker() {
  mkdirSync(dirname(TAKER_LOG), { recursive: true });
  const log = openSync(TAKER_LOG, "a");
  const child = spawn(process.execPath, [TAKER_SCRIPT], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, BAY_URL: `http://127.0.0.1:${HANGAR_PORT}` },
  });
  child.unref();
  writeFileSync(TAKER_PID_FILE, `${child.pid}\n`);
  return child;
}

async function ensureTaker(failureRef) {
  const health = await fetchHealthJson();
  const live = takerPids();
  if (
    live.length &&
    health &&
    Number(health.takers ?? 0) >= 1 &&
    Number(health.paints ?? 0) >= 1
  ) {
    return live[0];
  }
  await stopTaker();
  const child = spawnTaker();
  child.on("error", (err) => {
    failureRef.failure = `hangar-paint could not be spawned: ${err.message}`;
  });
  child.on("exit", (code, signal) => {
    failureRef.failure = `hangar-paint exited early (${signal ?? `code ${code}`})`;
  });
  return child.pid;
}


async function stop() {
  await stopTaker();
  const owners = hangarOwners({
    portPids: portOwners().pids,
    pidFilePid: readPidFile(),
    cmdlineOf,
  }).filter((pid) => pid !== 1);
  const { signalled, stubborn } = await terminatePids(owners, {
    kill: killPid,
    isAlive,
    sleep,
    graceMs: GRACE_MS,
    pollMs: POLL_MS,
  });
  const outcome = hangarStopOutcome({ signalled, stubborn, after: portOwners() });
  const payload = { action: "stop", ...outcome };
  if (!outcome.ok) {
    emit(payload);
    return 1;
  }
  rmSync(PID_FILE, { force: true });
  emit(payload);
  return 0;
}

async function stopQuiet() {
  await stopTaker();
  const owners = hangarOwners({
    portPids: portOwners().pids,
    pidFilePid: readPidFile(),
    cmdlineOf,
  }).filter((pid) => pid !== 1);
  await terminatePids(owners, { kill: killPid, isAlive, sleep, graceMs: GRACE_MS, pollMs: POLL_MS });
  rmSync(PID_FILE, { force: true });
}

async function start() {
  const live = await fetchHealthJson();
  const hangarUp = Boolean(live && isOurHangar(live));
  let child = null;
  let failure = null;

  if (!hangarUp) {
    const holders = portOwners();
    const hangarHolder = holders.pids.some((pid) => looksLikeHangarProcess(cmdlineOf(pid)));
    if (holders.pids.length > 0 && !hangarHolder) {
      const payload = {
        ok: false,
        action: "start",
        error: `port ${HANGAR_PORT} is held by pid(s) ${holders.pids.join(", ")}`,
      };
      writeProof({ start: 1, health: null });
      emit(payload);
      return 1;
    }

    if (!hangarHolder) {
      mkdirSync(dirname(LOG_FILE), { recursive: true });
      const log = openSync(LOG_FILE, "a");
      child = spawn("npm", ["run", "dev"], {
        cwd: ROOT,
        detached: true,
        stdio: ["ignore", log, log],
      });
      child.unref();
      writeFileSync(PID_FILE, `${child.pid}\n`);
      child.on("error", (err) => {
        failure = `npm run dev could not be spawned: ${err.message}`;
      });
      child.on("exit", (code, signal) => {
        failure = `npm run dev exited early (${signal ?? `code ${code}`})`;
      });
    }

    const health = await waitForHealthJson(() => failure);
    if (!health) {
      const secs = Math.round(READY_TIMEOUT_MS / 1000);
      const why = failure ?? `GET ${HEALTH_URL} did not return JSON within ${secs}s — see ${LOG_FILE}`;
      if (child) await stopQuiet();
      writeProof({ start: 1, health: null, miss: "blind-wait" });
      emit({ ok: false, action: "start", error: why, miss: "blind-wait" });
      return 1;
    }
  }

  const failRef = { failure: null };
  await ensureTaker(failRef);
  const ready = await waitForTaker(() => failure || failRef.failure);
  const paints = Number(ready?.paints ?? 0);
  const takers = Number(ready?.takers ?? 0);
  if (!ready || paints < 1 || takers < 1) {
    const miss = paints < 1 ? "paints-0" : "takers !== 1";
    const why =
      failure ||
      failRef.failure ||
      (paints < 1 ? "paints is 0 — hangar-paint did not attach" : "takers is 0 — headless taker did not attach");
    writeProof({ start: 1, health: ready });
    emit({ ok: false, action: "start", error: why, miss, takers, paints });
    return 1;
  }

  const pid = adoptPid();
  const viaBay = callBayHealth().health || ready;
  writeProof({ start: 0, health: viaBay });
  emit({ action: "start", reused: hangarUp, pid, taker: readTakerPid(), ...viaBay });
  return 0;
}

function status() {
  const pid = adoptPid();
  const alive = pid !== null && isAlive(pid);
  const { health } = callBayHealth();
  const up = Boolean(health && typeof health === "object" && "takers" in health);
  const payload = { action: "status", ok: up, pid, alive, health };
  writeProof({ status: up ? 0 : 1, health: health || null });
  emit(payload);
  return up ? 0 : 1;
}

function doctor() {
  const r = spawnSync(process.execPath, [DOCTOR], {
    encoding: "utf8",
    cwd: ROOT,
    env: process.env,
  });
  const exit = r.status == null ? 1 : r.status;
  let proof = null;
  try {
    proof = JSON.parse(readFileSync(DOCTOR_PROOF, "utf8"));
  } catch {
    proof = null;
  }
  const { health } = callBayHealth();
  writeProof({ doctor: exit, health: health || proof || null });
  emit({
    action: "doctor",
    ok: exit === 0,
    exit,
    stdout: String(r.stdout || "").trim(),
    proof,
    health: health || null,
  });
  return exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseHangarArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (args.error) {
    emit({ ok: false, error: args.error });
    process.exit(1);
  }
  if (!existsSync("/proc/self")) {
    emit({ ok: false, error: "no /proc — this script only runs inside the sandbox" });
    process.exit(1);
  }
  if (args.action === "start") process.exit(await start());
  if (args.action === "stop") process.exit(await stop());
  if (args.action === "status") process.exit(status());
  process.exit(doctor());
}
