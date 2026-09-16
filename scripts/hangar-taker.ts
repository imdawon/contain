#!/usr/bin/env npx tsx
/**
 * Headless Rapier world for eval-style stats. No canvas, no Chrome.
 * Do not start this as the hangar taker — `hangar-paint.mjs` owns `/__bay/take`.
 * Kept for scripts that want numbers without a GPU.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorld, loadRapier, resetSim, type Actor, type Sim } from "../src/lib/bay/headless.ts";
import { steelDish, steelRim } from "../src/lib/bay/yield.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASE = (process.env.BAY_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const DRUM_WAKE = 40;

type SceneFile = {
  id?: string;
  name?: string;
  blurb?: string;
  file?: string;
  entities?: Actor[];
};

type HistFrame = {
  t: number;
  ev: { type: string; id: string | null }[];
  o: Record<string, Record<string, number | null>>;
  cam: null;
};

type RapierMod = Awaited<ReturnType<typeof loadRapier>>;

let R: RapierMod | null = null;
let sim: Sim | null = null;
let scene: SceneFile | null = null;
let wheelName = "coil";
let t = 0;
let lastHistT = -1;
let frames: HistFrame[] = [];
let events: { t: number; type: string; data: Record<string, string | number | boolean | null> }[] = [];

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

function note(type: string, data: Record<string, string | number | boolean | null> = {}) {
  events.push({ t: round(t), type, data });
  if (events.length > 800) events.splice(0, events.length - 800);
}

function scenePath(input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as { id?: string; file?: string };
    if (typeof obj.file === "string" && obj.file.length) return resolve(ROOT, "public", obj.file.replace(/^\//, ""));
    if (typeof obj.id === "string" && obj.id.length) input = obj.id;
  }
  const s = String(input ?? "v1").trim();
  if (s.endsWith(".json") || s.includes("/")) {
    const rel = s.replace(/^\.\//, "").replace(/^\//, "");
    const abs = resolve(ROOT, rel.startsWith("public/") ? rel : `public/${rel}`);
    if (existsSync(abs)) return abs;
  }
  return resolve(ROOT, `public/scenes/${s}.json`);
}

function loadScene(input: unknown): SceneFile {
  if (input && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as SceneFile).entities)) {
    return input as SceneFile;
  }
  const path = scenePath(input);
  const raw = JSON.parse(readFileSync(path, "utf8")) as SceneFile;
  if (!Array.isArray(raw.entities)) throw new Error(`no entities in ${path}`);
  if (!raw.file) raw.file = path.startsWith(ROOT) ? path.slice(ROOT.length + 1).replace(/^public\//, "") : path;
  return raw;
}

function clearHist() {
  frames = [];
  lastHistT = -1;
}

function poseOf() {
  if (!sim) return null;
  const p = sim.wheel.translation();
  const v = sim.wheel.linvel();
  const a = sim.wheel.angvel();
  return {
    id: wheelName,
    name: wheelName,
    kind: "wheel",
    x: round(p.x),
    y: round(p.y),
    z: round(p.z),
    vx: round(v.x),
    vy: round(v.y),
    vz: round(v.z),
    wx: round(a.x),
    wy: round(a.y),
    wz: round(a.z),
    speed: round(Math.hypot(v.x, v.y, v.z)),
    dent: round(sim.wheelShell.maxTaken),
    strain: round(sim.wheelShell.strain),
    rim: round(steelRim(sim.wheelShell)),
    meshRim: round(steelRim(sim.wheelShell)),
    dish: round(steelDish(sim.wheelShell)),
    mass: round(sim.wheel.mass()),
    kin: false,
    spin: round(Math.hypot(a.x, a.y, a.z)),
  };
}

function recordHistory() {
  if (!sim) return;
  if (t - lastHistT < 1 / 30) return;
  lastHistT = t;
  const cut = t - 1 / 30;
  const freshEv = events
    .filter((e) => e.t >= cut)
    .map((e) => ({ type: e.type, id: typeof e.data.id === "string" ? e.data.id : null }));
  const wheel = poseOf();
  const o: HistFrame["o"] = {};
  if (wheel) {
    o[wheel.id] = {
      x: wheel.x,
      y: wheel.y,
      z: wheel.z,
      vx: wheel.vx,
      vy: wheel.vy,
      vz: wheel.vz,
      dent: wheel.dent,
      strain: wheel.strain,
      rim: wheel.rim,
    };
  }
  frames.push({ t: round(t), ev: freshEv, o, cam: null });
  if (frames.length > 930) frames.splice(0, frames.length - 930);
}

function wakeDrums() {
  if (!sim || sim.drumsOn || sim.drumMode === "off") return;
  const p = sim.wheel.translation();
  for (const rest of sim.drumRests) {
    const dx = rest.x - p.x;
    const dy = rest.y - p.y;
    const dz = rest.z - p.z;
    if (dx * dx + dy * dy + dz * dz < DRUM_WAKE * DRUM_WAKE) {
      sim.drumsOn = true;
      for (const d of sim.drums) {
        d.setEnabled(true);
        d.wakeUp();
      }
      sim.world.numSolverIterations = sim.smashSolver;
      sim.world.numInternalPgsIterations = sim.smashPgs;
      return;
    }
  }
}

function step(n: number) {
  if (!sim) return { ok: false, waited: 0, reason: "no-sim" };
  const steps = Math.max(0, Math.round(n));
  for (let i = 0; i < steps; i++) {
    sim.world.step();
    t += 1 / 60;
    wakeDrums();
    recordHistory();
  }
  return { ok: true, waited: steps / 60, frames: steps };
}

function waitArg(args: unknown[]) {
  const n = Number(args[0]);
  if (!Number.isFinite(n) || n <= 0) return 60;
  if (n <= 600) return n;
  return Math.max(1, Math.round(n / (1000 / 60)));
}

function peek() {
  const wheel = poseOf();
  const objects = wheel ? [{ ...wheel }] : [];
  if (sim) {
    for (let i = 0; i < sim.drums.length; i++) {
      const d = sim.drums[i]!;
      if (!d.isEnabled()) continue;
      const p = d.translation();
      const v = d.linvel();
      objects.push({
        id: `drum-${i + 1}`,
        name: `drum-${i + 1}`,
        kind: "drum",
        x: round(p.x),
        y: round(p.y),
        z: round(p.z),
        vx: round(v.x),
        vy: round(v.y),
        vz: round(v.z),
        wx: 0,
        wy: 0,
        wz: 0,
        speed: round(Math.hypot(v.x, v.y, v.z)),
        dent: round(sim.drumShells[i]!.maxTaken),
        strain: round(sim.drumShells[i]!.strain),
        rim: round(steelRim(sim.drumShells[i]!)),
        meshRim: round(steelRim(sim.drumShells[i]!)),
        dish: round(steelDish(sim.drumShells[i]!)),
        mass: round(d.mass()),
        kin: false,
        spin: 0,
      });
    }
  }
  return {
    t: round(t),
    leftover: false,
    skipped: false,
    paint: false,
    hidden: true,
    run: null,
    scene: scene
      ? {
          id: scene.id ?? null,
          name: scene.name ?? scene.id ?? null,
          blurb: scene.blurb ?? "",
          file: scene.file ?? (scene.id ? `scenes/${scene.id}.json` : null),
          n: scene.entities?.length ?? 0,
        }
      : null,
    events: events.slice(-12).map((e) => e.type),
    objects,
    nobj: objects.length,
  };
}

function restage(input: unknown) {
  const loaded = loadScene(input);
  const actors = loaded.entities ?? [];
  const coil = actors.find((a) => a.kind === "wheel" || a.kind === "coil" || a.name === "coil" || a.name === "wheel");
  wheelName = coil?.name || "wheel";
  if (sim) {
    try {
      sim.world.free();
    } catch {
      /* old world */
    }
    sim = null;
  }
  if (!R) throw new Error("rapier-not-ready");
  sim = buildWorld(R, actors, { drums: "lazy" });
  resetSim(sim, 0, 1);
  scene = loaded;
  t = 0;
  events = [];
  clearHist();
  note("restage-scene", { id: loaded.id ?? "", file: loaded.file ?? "", name: loaded.name ?? "", n: actors.length });
  note("spawn", { kind: "wheel", id: wheelName });
  recordHistory();
  return {
    ok: true,
    skipped: false,
    id: loaded.id ?? null,
    name: loaded.name ?? loaded.id ?? null,
    file: loaded.file ?? (loaded.id ? `scenes/${loaded.id}.json` : null),
    n: actors.length,
    nobj: nobj(),
    scene: { id: loaded.id ?? null, name: loaded.name ?? null, file: loaded.file ?? null, n: actors.length },
  };
}

function history(seconds = 30) {
  const cut = t - Number(seconds || 30);
  return frames.filter((f) => f.t >= cut);
}

function effects(id: string, seconds = 30) {
  const path = history(seconds)
    .filter((f) => f.o[id])
    .map((f) => ({ t: f.t, ...f.o[id] }));
  const first = path[0];
  const last = path[path.length - 1];
  let maxSpeed = 0;
  for (const p of path) {
    const s = Math.hypot(Number(p.vx ?? 0), Number(p.vy ?? 0), Number(p.vz ?? 0));
    if (s > maxSpeed) maxSpeed = s;
  }
  return {
    id,
    samples: path.length,
    events: events.filter((e) => e.data.id === id),
    first: first ? { t: first.t, x: first.x, y: first.y, z: first.z } : null,
    last: last ? { t: last.t, x: last.x, y: last.y, z: last.z } : null,
    maxSpeed: round(maxSpeed),
  };
}

function nobj() {
  if (!sim) return 0;
  return 1 + sim.drums.filter((d) => d.isEnabled()).length;
}

async function run(fn: string, args: unknown[]) {
  if (fn === "restage") {
    try {
      return { value: restage(args[0]) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (fn === "wait") return { value: step(waitArg(args)) };
  if (fn === "peek") return { value: peek() };
  if (fn === "history") return { value: history(Number(args[0] ?? 30)) };
  if (fn === "effects") return { value: effects(String(args[0] ?? wheelName), Number(args[1] ?? 30)) };
  if (fn === "reset") {
    if (scene) return { value: restage(scene) };
    return { value: { ok: false, reason: "no-scene" } };
  }
  if (fn === "help") {
    return { value: { restage: true, wait: true, peek: true, history: true, effects: true, headless: true } };
  }
  return { error: `no-fn:${fn}` };
}

async function loop() {
  R = await loadRapier();
  const ctl = new AbortController();
  const takeUrl = () =>
    `${BASE}/__bay/take?wait=10000&vis=hidden&nobj=${nobj()}&paint=0&bot=0&fps=60&ms=16&gen=90`;
  while (!ctl.signal.aborted) {
    try {
      const r = await fetch(takeUrl(), { signal: ctl.signal });
      if (r.status === 204) continue;
      if (!r.ok) {
        await new Promise((res) => setTimeout(res, 400));
        continue;
      }
      const msg = (await r.json()) as { id?: string; fn?: string; args?: unknown[]; waitMs?: number };
      if (!msg?.id) continue;
      const cap = Math.min(590000, Number(msg.waitMs) || 16000);
      const out = await Promise.race([
        run(String(msg.fn ?? ""), Array.isArray(msg.args) ? msg.args : []),
        new Promise<{ error: string }>((res) => setTimeout(() => res({ error: "run-timeout" }), cap)),
      ]);
      await fetch(`${BASE}/__bay/done`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: msg.id,
          ...out,
          skipped: false,
          paint: false,
          nobj: nobj(),
        }),
      });
    } catch {
      if (ctl.signal.aborted) return;
      await new Promise((res) => setTimeout(res, 500));
    }
  }
}

loop().catch((err) => {
  console.error(err);
  process.exit(1);
});
