import { forgetBay, listBayLevels, listBayRuns, listBayScenes, loadBay, loadRun, nextTrial, punctureId, resetBay, restageScene, saveBay, setToolName, spawnKind } from "@/lib/bay/actions";
import { dummyScore, hingeSnapshot } from "@/lib/bay/atd";
import { ensureFuseClock, tickFuse } from "@/lib/bay/blast";
import { getLevel, levelCard } from "@/lib/bay/level";
import { getRun, runCard } from "@/lib/bay/run";
import { cooks } from "@/lib/bay/cook";
import { loopLevels, playSlowMo, unlockAudio } from "@/lib/contain/audio";
import { SFX } from "@/lib/contain/sfx";
import { analyzePath } from "@/lib/bay/ride-stats";
import {
  actorMesh,
  applyActor,
  assemblyMembers,
  listSamplers,
  clearLog,
  log,
  note,
  probeTime,
  snapshot,
  translateAssembly,
  type ProbeEvent,
  type ProbeObject,
} from "@/lib/bay/probe";
import { sceneTheme } from "@/lib/bay/arena";
import { placeActor } from "@/lib/bay/studio";
import { useBay } from "@/store/bay-store";
import * as THREE from "three";

/** Pose log at 30 Hz (every other 60 Hz physics tick). 30s × 30 Hz × ~20 bodies is small. */
const HZ = 30;
const KEEP = 90;
const MAX_FRAMES = HZ * KEEP + 30;

export type PoseSample = {
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  vx: number | null;
  vy: number | null;
  vz: number | null;
  dent?: number | null;
  strain?: number | null;
  rim?: number | null;
};

export type HistEvent = { type: string; id: string | null };

export type HistFrame = {
  t: number;
  ev: HistEvent[];
  o: Record<string, PoseSample>;
  cam: { x: number; y: number; z: number } | null;
};

type DragMember = { id: string; x0: number; y0: number; z0: number; kinematic: boolean };

type DragJob = {
  id: string;
  members: DragMember[];
  dx: number;
  dy: number;
  dz: number;
  t: number;
  dur: number;
  floppy: boolean;
};

const PIPE_GEN = 225;

const g = globalThis as unknown as {
  __bayHist?: { frames: HistFrame[]; lastHistT: number; lastEventN: number };
  __bayPipeCtl?: AbortController;
  __baySeen?: Set<string>;
  __bayJobs?: Map<string, Promise<{ value?: unknown; error?: string; skipped?: boolean }>>;
  __bayPipeGen?: number;
  __bayTakeBeat?: number;
  __bayWatch?: ReturnType<typeof setInterval>;
  __bayBake?: boolean;
  __bayPace?: boolean;
  __bayDemand?: boolean;
  __bayClk?: Worker;
  __bayTapeJob?: string;
};
const hist = (g.__bayHist ??= { frames: [], lastHistT: -1, lastEventN: 0 });
const frames = hist.frames;
const drags: DragJob[] = [];

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

function beat() {
  g.__bayTakeBeat = performance.now();
}

function paintState() {
  const vis = typeof document !== "undefined" ? document.visibilityState : "hidden";
  const canvas = typeof document !== "undefined" && Boolean(document.querySelector("canvas"));
  const owned = Boolean(typeof window !== "undefined" && (window as unknown as { __bayOwned?: boolean }).__bayOwned);
  const bake = Boolean(g.__bayBake);
  const bot = typeof navigator !== "undefined" && navigator.webdriver === true;
  const paint = Boolean(canvas && (owned || bake || vis === "visible"));
  return { vis, canvas, owned, bake, bot, paint };
}


export function recordHistory(
  objects: ProbeObject[],
  t: number,
  camera?: { x: number; y: number; z: number } | null,
) {
  if (t - hist.lastHistT < 1 / HZ) return;
  hist.lastHistT = t;
  const evs = log();
  const fresh: HistEvent[] = evs.slice(hist.lastEventN).map((e) => ({
    type: e.type,
    id: typeof e.data.id === "string" ? e.data.id : null,
  }));
  hist.lastEventN = evs.length;
  const o: HistFrame["o"] = {};
  for (const obj of objects) {
    const dent = typeof obj.state?.dent === "number" ? obj.state.dent : undefined;
    const strain = typeof obj.state?.strain === "number" ? obj.state.strain : undefined;
    const rim = typeof obj.state?.rim === "number" ? obj.state.rim : undefined;
    o[obj.id] = {
      x: obj.x,
      y: obj.y,
      z: obj.z,
      rx: obj.rx,
      ry: obj.ry,
      rz: obj.rz,
      vx: obj.vx,
      vy: obj.vy,
      vz: obj.vz,
      ...(dent != null ? { dent } : {}),
      ...(strain != null ? { strain } : {}),
      ...(rim != null ? { rim } : {}),
    };
  }
  frames.push({
    t: round(t),
    ev: fresh,
    o,
    cam: camera ? { x: camera.x, y: camera.y, z: camera.z } : null,
  });
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
}

export function tickDrags(dt: number) {
  for (let i = drags.length - 1; i >= 0; i--) {
    const job = drags[i];
    job.t += dt;
    const u = Math.min(1, job.dur <= 0 ? 1 : job.t / job.dur);
    let minY = Infinity;
    for (const m of job.members) minY = Math.min(minY, m.y0 + job.dy * u);
    const yLift = minY < 0.06 ? 0.06 - minY : 0;
    for (const m of job.members) {
      const b = listSamplers().get(m.id)?.getBody?.();
      if (!b) continue;
      b.setBodyType(2, true);
      const nx = m.x0 + job.dx * u;
      const ny = m.y0 + job.dy * u + yLift;
      const nz = m.z0 + job.dz * u;
      b.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
      b.setTranslation({ x: nx, y: ny, z: nz }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (u >= 1) {
      const inv = 1 / Math.max(job.dur, 1 / 60);
      const vx = job.dx * inv * 0.35;
      const vy = job.dy * inv * 0.35;
      const vz = job.dz * inv * 0.35;
      for (const m of job.members) {
        const b = listSamplers().get(m.id)?.getBody?.();
        if (!b) continue;
        if (job.floppy) {
          b.setBodyType(0, true);
          b.setLinvel({ x: vx, y: vy, z: vz }, true);
        } else {
          b.setBodyType(2, true);
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
      note("drag-end", { id: job.id, n: job.members.length, floppy: job.floppy });
      drags.splice(i, 1);
    }
  }
}

function getBody(id: string) {
  return listSamplers().get(id)?.getBody?.() ?? null;
}

function pose(id: string) {
  const fromSnap = snapshot().objects.find((o) => o.id === id);
  if (fromSnap) return fromSnap;
  const rec = listSamplers().get(id);
  if (!rec) return null;
  const s = rec.sample();
  return {
    id,
    kind: rec.kind,
    x: round(s.x),
    y: round(s.y),
    z: round(s.z),
    rx: round(s.rx),
    ry: round(s.ry),
    rz: round(s.rz),
    vx: null,
    vy: null,
    vz: null,
    inView: false,
    mass: null,
    friction: null,
    restitution: null,
    editable: Boolean(rec.getBody),
    state: s.state ?? {},
  };
}

export function listUi() {
  if (typeof document === "undefined") return [];
  return [...document.querySelectorAll<HTMLElement>("[data-bay]")].map((el) => ({
    bay: el.dataset.bay ?? "",
    tag: el.tagName.toLowerCase(),
    label: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48),
    disabled: "disabled" in el ? Boolean((el as HTMLButtonElement).disabled) : false,
  }));
}

function setSelectValue(sel: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(sel, value);
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

export function clickUi(name: string, value?: string) {
  if (typeof document === "undefined") return { ok: false, reason: "no-dom" as const };
  const alias = name === "ignite" ? "puncture" : name === "inspect" && value != null ? "inspect-id" : name;
  const el = document.querySelector<HTMLElement>(`[data-bay="${alias}"]`);
  if (!el) return { ok: false, reason: "missing" as const, name };
  if ("disabled" in el && (el as HTMLButtonElement).disabled) {
    if (alias === "puncture") {
      const r = punctureId();
      return r.ok ? { ok: true, name, via: "fuse" as const, id: r.id } : { ok: false, reason: "disabled" as const, name };
    }
    return { ok: false, reason: "disabled" as const, name };
  }
  if (el.tagName === "SELECT") {
    const sel = el as HTMLSelectElement;
    if (value == null) {
      return {
        ok: false,
        reason: "need-value" as const,
        name,
        options: [...sel.options].map((o) => o.value).filter(Boolean),
      };
    }
    if (alias === "track" || alias === "inspect-id") {
      setSelectValue(sel, value);
      useBay.getState().setTrack(value || null);
      note("ui-click", { name, value });
      return { ok: true, name, value };
    }
    const allowed = [...sel.options].some((o) => o.value === value);
    if (!allowed) return { ok: false, reason: "bad-value" as const, name, value };
    setSelectValue(sel, value);
    note("ui-click", { name, value });
    return { ok: true, name, value };
  }
  el.click();
  note("ui-click", { name });
  return { ok: true, name };
}

export function selectSolid(shape: string) {
  if (typeof document === "undefined") return spawnKind(shape);
  const el = document.querySelector<HTMLSelectElement>('[data-bay="solid"]');
  if (!el) return spawnKind(shape);
  setSelectValue(el, shape);
  return { ok: true, shape };
}

function hold(id: string) {
  const ids = assemblyMembers(id);
  let n = 0;
  for (const mid of ids) {
    const b = getBody(mid);
    if (!b) continue;
    b.setBodyType(2, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    n += 1;
  }
  if (n === 0) return { ok: false, reason: "no-body" as const, id };
  useBay.getState().select(id);
  note("hold", { id, n });
  return { ok: true, id, n };
}

function drop(id: string) {
  const ids = assemblyMembers(id);
  let n = 0;
  for (const mid of ids) {
    const b = getBody(mid);
    if (!b) continue;
    b.setBodyType(0, true);
    b.wakeUp();
    n += 1;
  }
  if (n === 0) return { ok: false, reason: "no-body" as const, id };
  note("drop", { id, n });
  return { ok: true, id, n };
}

function dragTo(id: string, dest: { x?: number; y?: number; z?: number }, seconds = 0.35) {
  const now = pose(id);
  const lead = getBody(id);
  if (!lead || !now) return { ok: false, reason: "no-body" as const, id };
  const ids = assemblyMembers(id);
  const members: DragMember[] = [];
  let floppy = false;
  for (const mid of ids) {
    const b = getBody(mid);
    const p = pose(mid);
    if (!b || !p) continue;
    if (!b.isKinematic()) floppy = true;
    members.push({ id: mid, x0: p.x, y0: p.y, z0: p.z, kinematic: b.isKinematic() });
    b.setBodyType(2, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  if (members.length === 0) return { ok: false, reason: "no-body" as const, id };
  const x1 = dest.x ?? now.x;
  const y1 = dest.y ?? now.y;
  const z1 = dest.z ?? now.z;
  drags.push({
    id,
    members,
    dx: x1 - now.x,
    dy: y1 - now.y,
    dz: z1 - now.z,
    t: 0,
    dur: Math.max(0.05, seconds),
    floppy,
  });
  note("drag", { id, x: x1, y: y1, z: z1, n: members.length });
  return { ok: true, id, n: members.length, to: { x: x1, y: y1, z: z1 } };
}

function distStats(samples: { t: number; x: number; y: number; z: number }[]) {
  const steps: number[] = [];
  const dts: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    dts.push((b.t - a.t) / 1000);
    steps.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const sorted = steps.slice().sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const mean = steps.length ? steps.reduce((s, n) => s + n, 0) / steps.length : 0;
  const big = steps.filter((n) => n > mean * 2.5 && n > 0.04).length;
  return {
    n: samples.length,
    meanDt: dts.length ? dts.reduce((s, n) => s + n, 0) / dts.length : 0,
    meanStep: mean,
    medianStep: mid,
    maxStep: sorted.at(-1) ?? 0,
    jumps: big,
  };
}

/** rAF xyz while a kinematic drag runs. Physics vs interpolated mesh. */
async function traceDrag(id: string, dest: { x?: number; y?: number; z?: number }, seconds = 0.8) {
  const started = dragTo(id, dest, seconds);
  const t0 = performance.now();
  const physics: { t: number; x: number; y: number; z: number }[] = [];
  const mesh: { t: number; x: number; y: number; z: number }[] = [];
  const cam: { t: number; x: number; y: number; z: number }[] = [];
  const rec = listSamplers().get(id);
  await new Promise<void>((resolve) => {
    const tick = () => {
      try {
        (window as unknown as { __bayKick?: () => void }).__bayKick?.();
      } catch {
        /* hidden tab */
      }
      const now = performance.now() - t0;
      const b = rec?.getBody?.();
      const p = b?.translation();
      if (p) physics.push({ t: now, x: p.x, y: p.y, z: p.z });
      const obj = rec?.getMesh?.();
      if (obj) {
        obj.updateWorldMatrix(true, false);
        const wp = obj.getWorldPosition(new THREE.Vector3());
        mesh.push({ t: now, x: wp.x, y: wp.y, z: wp.z });
      }
      const c = snapshot().camera;
      if (c) cam.push({ t: now, x: c.x, y: c.y, z: c.z });
      if (now >= seconds * 1000 + 80) {
        clearInterval(iv);
        resolve();
      }
    };
    const iv = window.setInterval(tick, 16);
    tick();
  });
  return {
    started,
    physics: distStats(physics),
    mesh: distStats(mesh),
    cam: distStats(cam),
    sample: {
      phys: physics.filter((_, i) => i % 4 === 0).slice(0, 20),
      mesh: mesh.filter((_, i) => i % 4 === 0).slice(0, 20),
    },
  };
}

function nudge(id: string, d: { x?: number; y?: number; z?: number }) {
  const now = pose(id);
  if (!now) return { ok: false, reason: "no-body" as const, id };
  return dragTo(id, { x: now.x + (d.x ?? 0), y: now.y + (d.y ?? 0), z: now.z + (d.z ?? 0) }, 0.2);
}

function spreadOf(ids: string[]) {
  const pts = ids
    .map((mid) => {
      const p = listSamplers().get(mid)?.sample();
      return p && !p.state?.missing ? { id: mid, x: p.x, y: p.y, z: p.z } : null;
    })
    .filter((p): p is { id: string; x: number; y: number; z: number } => Boolean(p));
  let span = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!;
      const b = pts[j]!;
      span = Math.max(span, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  return { n: pts.length, span: round(span), pts };
}

function gizmoMove(id: string, axis: string, meters = 0.5) {
  const ax = axis === "y" || axis === "z" ? axis : "x";
  const m = Number(meters);
  if (!Number.isFinite(m)) return { ok: false as const, reason: "bad-meters" as const, id };
  const crew = assemblyMembers(id);
  const before = spreadOf(crew);
  const n = translateAssembly(id, ax === "x" ? m : 0, ax === "y" ? m : 0, ax === "z" ? m : 0);
  const after = spreadOf(crew);
  const root = useBay.getState().entities.find((e) => e.id === id || id.startsWith(`${e.id}-`));
  if (root) {
    const hips = listSamplers().get(`${root.id}-hips`)?.sample();
    const p = hips && !hips.state?.missing ? hips : after.pts[0];
    if (p) {
      const y = root.kind === "dummy" ? Math.max(0, p.y - 0.74) : p.y;
      useBay.getState().patchEntity(root.id, { pos: [p.x, y, p.z] });
    }
  }
  note("gizmo", { id, axis: ax, m, n });
  return { ok: true as const, id, axis: ax, m, moved: n, before, after, dSpan: round(after.span - before.span) };
}

const _meshP = new THREE.Vector3();
function meshSpread(ids: string[]) {
  const pts = ids
    .map((mid) => {
      const mesh = actorMesh(mid);
      if (!mesh) return null;
      mesh.updateWorldMatrix(true, false);
      mesh.getWorldPosition(_meshP);
      return { id: mid, x: _meshP.x, y: _meshP.y, z: _meshP.z };
    })
    .filter((p): p is { id: string; x: number; y: number; z: number } => Boolean(p));
  let span = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!;
      const b = pts[j]!;
      span = Math.max(span, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  return { n: pts.length, span: round(span), pts };
}

async function dragGizmo(id: string, axis: string, pixels = 40, camDist?: number) {
  useBay.getState().setPlaying(false);
  useBay.getState().select(id);
  await waitFrames(120);
  const api = (window as unknown as { __bayGizmo?: { drag: (a: string, p?: number, d?: number) => Record<string, unknown> } }).__bayGizmo;
  if (!api?.drag) return { ok: false as const, reason: "no-gizmo-api" as const, id };
  const crew = assemblyMembers(id);
  const before = spreadOf(crew);
  const meshBefore = meshSpread(crew);
  const r = api.drag(axis, Number(pixels), camDist != null ? Number(camDist) : undefined);
  const after = spreadOf(crew);
  const meshAfter = meshSpread(crew);
  note("gizmo-drag", { id, axis, pixels: Number(pixels), m: Number(r.meters ?? 0) });
  return {
    ok: Boolean(r.ok),
    id,
    axis,
    pixels: Number(pixels),
    ...r,
    before,
    after,
    dSpan: round(after.span - before.span),
    meshBefore,
    meshAfter,
    dMesh: round(meshAfter.span - meshBefore.span),
  };
}

function fling(id: string, v: { x?: number; y?: number; z?: number }) {
  return { ok: applyActor(id, { vx: v.x ?? 0, vy: v.y ?? 0, vz: v.z ?? 0 }), id };
}

export function history(seconds = KEEP) {
  const t = probeTime();
  const cut = t - seconds;
  return frames.filter((f) => f.t >= cut);
}

export function effects(id: string, seconds = KEEP) {
  const path = history(seconds)
    .filter((f) => f.o[id])
    .map((f) => ({ t: f.t, ...f.o[id] }));
  const related = log().filter((e) => {
    if (e.t < probeTime() - seconds) return false;
    if (e.data.id === id) return true;
    return JSON.stringify(e.data).includes(id);
  });
  const first = path[0];
  const last = path[path.length - 1];
  let maxSpeed = 0;
  for (const p of path) {
    const s = Math.hypot(p.vx ?? 0, p.vy ?? 0, p.vz ?? 0);
    if (s > maxSpeed) maxSpeed = s;
  }
  return {
    id,
    samples: path.length,
    events: related,
    first: first ? { t: first.t, x: first.x, y: first.y, z: first.z } : null,
    last: last ? { t: last.t, x: last.x, y: last.y, z: last.z } : null,
    delta:
      first && last
        ? { x: round(last.x - first.x), y: round(last.y - first.y), z: round(last.z - first.z) }
        : null,
    maxSpeed: round(maxSpeed),
  };
}

export function analyze(id?: string, seconds = KEEP) {
  const storeId = id && id.length ? id : peek().objects.find((o) => o.kind === "wheel")?.id;
  if (!storeId) return { id: null, samples: 0, anomalies: [{ t: 0, kind: "nan" as const, detail: "no-body" }] };
  const path = history(seconds)
    .filter((f) => f.o[storeId])
    .map((f) => ({ t: f.t, ...f.o[storeId]! }));
  const report = analyzePath(storeId, path);
  const since = probeTime() - seconds;
  const events = log()
    .filter((e) => e.t >= since && (e.data.id === storeId || e.type === "contact"))
    .slice(-80)
    .map((e) => ({ t: e.t, type: e.type, ...e.data }));
  return { ...report, events };
}

export function peek() {
  const store = useBay.getState();
  const s = snapshot();
  const objects: {
    id: string;
    kind: string;
    x: number;
    y: number;
    z: number;
    rx: number;
    ry: number;
    rz: number;
    vx: number;
    vy: number;
    vz: number;
    speed: number;
    cook: string | number | boolean | null;
    burning: string | number | boolean | null;
    ash: string | number | boolean | null;
    dent: string | number | boolean | null;
    strain: string | number | boolean | null;
    rim: string | number | boolean | null;
    kin: boolean | null;
    spin: number;
    meshRim: string | number | boolean | null;
    dish: string | number | boolean | null;
    grounded: string | number | boolean | null;
    mass: number | null;
    Iy: number | null;
    wx: number;
    wy: number;
    wz: number;
  }[] = [];
  for (const [id, rec] of listSamplers()) {
    const p = rec.sample();
    if (p.state?.missing) continue;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let spin = 0;
    let kin: boolean | null = null;
    let mass: number | null = null;
    let Iy: number | null = null;
    let wx = 0;
    let wy = 0;
    let wz = 0;
    const b = rec.getBody?.();
    if (b) {
      const lv = b.linvel();
      vx = round(lv.x);
      vy = round(lv.y);
      vz = round(lv.z);
      const av = b.angvel();
      wx = round(av.x);
      wy = round(av.y);
      wz = round(av.z);
      spin = round(Math.hypot(av.x, av.y, av.z));
      kin = b.isKinematic();
      mass = round(b.mass());
      Iy = Math.round(b.principalInertia()?.y ?? 0);
    }
    objects.push({
      id,
      kind: rec.kind,
      x: round(p.x),
      y: round(p.y),
      z: round(p.z),
      rx: round(p.rx),
      ry: round(p.ry),
      rz: round(p.rz),
      vx,
      vy,
      vz,
      speed: round(Math.hypot(vx, vy, vz)),
      cook: p.state?.cook ?? null,
      burning: p.state?.burning ?? null,
      ash: p.state?.ash ?? null,
      dent: p.state?.dent ?? null,
      strain: p.state?.strain ?? null,
      rim: p.state?.rim ?? null,
      meshRim: p.state?.meshRim ?? null,
      dish: p.state?.dish ?? null,
      grounded: p.state?.grounded ?? null,
      kin,
      spin,
      mass,
      Iy,
      wx,
      wy,
      wz,
    });
  }
  const cam = s.camera;
  const histCam = frames.at(-1)?.cam ?? null;
  const chase =
    typeof window !== "undefined"
      ? (window as unknown as {
          __bayChase?: { clampedToTrough?: boolean; ox?: number; oy?: number; oz?: number; dist?: number };
        }).__bayChase
      : undefined;
  const chaseBits =
    chase && Number.isFinite(chase.dist) && Number.isFinite(chase.ox) && Number.isFinite(chase.oy) && Number.isFinite(chase.oz)
      ? { dist: round(chase.dist as number), ox: round(chase.ox as number), oy: round(chase.oy as number), oz: round(chase.oz as number) }
      : {};
  const camera = cam
    ? { ...cam, clampedToTrough: Boolean(chase?.clampedToTrough), ...chaseBits }
    : histCam
      ? {
          x: histCam.x,
          y: histCam.y,
          z: histCam.z,
          lookX: histCam.x,
          lookY: histCam.y,
          lookZ: histCam.z,
          fov: 42,
          clampedToTrough: Boolean(chase?.clampedToTrough),
          ...chaseBits,
        }
      : null;
  const level = getLevel(store.levelId);
  const run = getRun(store.runId);
  return {
    t: round(probeTime()),
    selected: store.selected,
    trackId: store.trackId,
    tool: store.tool,
    latch: store.latch,
    cutaway: store.cutaway,
    run: run ? runCard(run, store.trial) : null,
    level: level ? levelCard(level) : store.runId ? null : { id: store.levelId, name: store.levelId, blurb: "", builtin: false, n: store.entities.length },
    scene: store.scene
      ? {
          id: store.scene.id,
          name: store.scene.name,
          blurb: store.scene.blurb,
          file: store.scene.file ?? `scenes/${store.scene.id}.json`,
          n: store.scene.entities.length,
          ties: store.scene.ties.length,
          theme: store.scene.theme ?? sceneTheme(store.scene),
          garden: Boolean(sceneTheme(store.scene)),
        }
      : null,
    stage: store.entities.map((e) => ({ id: e.id, kind: e.kind, x: e.pos[0], y: e.pos[1], z: e.pos[2] })),
    camera,
    events: log()
      .slice(-12)
      .map((e) => e.type),
    cooks: [...cooks.entries()].map(([id, c]) => ({
      id,
      phase: c.phase,
      chem: c.chem,
      t: round(c.t),
      delay: round(c.delay),
      boom: c.boom,
    })),
    objects,
    loads: hingeSnapshot(),
    score: dummyScore(store.entities.find((e) => e.kind === "dummy")?.id),
    inspect: store.inspect,
    studio: store.studio,
    playing: store.playing,
    slowMo: store.slowMo,
    paint: paintState().paint,
    owned: paintState().owned,
    hidden: typeof document !== "undefined" && document.hidden,
    fps: Math.round((s.fps ?? 0) * 10) / 10,
    frameMs: Math.round((s.frameMs ?? 0) * 10) / 10,
    nobj: objects.length,
    pipeGen: g.__bayPipeGen ?? PIPE_GEN,
    canvas: typeof document !== "undefined" ? (() => {
      const c = document.querySelector("canvas");
      return c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null;
    })() : null,
    dpr: typeof window !== "undefined" ? window.devicePixelRatio : null,
    vis: typeof document !== "undefined" ? document.visibilityState : "unknown",
  };
}

function boomReady() {
  return [...cooks.values()].some((c) => c.chem === "frag" && (c.bang || c.phase === "boom" || c.phase === "dead"));
}

export function until(type: string, timeoutMs = 8000) {
  ensureFuseClock();
  const t0 = probeTime();
  const already = () =>
    log().some((e: ProbeEvent) => e.type === type && e.t >= t0 - 1.5) || (type === "grenade-boom" && boomReady());
  if (already()) {
    tickFuse(0.05);
    return Promise.resolve({ ok: true, type, waited: 0 });
  }
  return new Promise<{ ok: boolean; type: string; waited: number }>((resolve) => {
    const tStart = performance.now();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearInterval(iv);
      resolve({ ok, type, waited: (performance.now() - tStart) / 1000 });
    };
    const check = () => {
      beat();
      tickFuse(0.05);
      if (already() || log().some((e: ProbeEvent) => e.type === type && e.t >= t0)) {
        finish(true);
        return;
      }
      if (performance.now() - tStart > timeoutMs) finish(false);
    };
    const iv = setInterval(check, 40);
    check();
  });
}

export function waitFrames(ms = 1000) {
  ensureFuseClock();
  return new Promise<{ ok: boolean; waited: number }>((resolve) => {
    const tStart = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(iv);
      resolve({ ok: true, waited: (performance.now() - tStart) / 1000 });
    };
    const tick = () => {
      beat();
      tickFuse(0.05);
      if (performance.now() - tStart >= ms) finish();
    };
    const iv = setInterval(tick, 40);
    tick();
  });
}
function clearHist() {
  frames.length = 0;
  drags.length = 0;
  hist.lastHistT = -1;
  hist.lastEventN = 0;
}

export function resetStage() {
  clearHist();
  return resetBay();
}

function loadClip(id: string) {
  clearHist();
  return loadBay(id);
}


async function tape(scene?: unknown, ms = 0) {
  g.__bayBake = true;
  try {
    return await tapeInner(scene, ms);
  } finally {
    g.__bayBake = false;
    g.__bayPace = false;
  }
}

async function tapeInner(scene?: unknown, ms = 0) {
  const liveCanvas = () => {
    const all = [...document.querySelectorAll("canvas")].filter(
      (el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement && el.width >= 64 && el.height >= 64,
    );
    all.sort((a, b) => b.width * b.height - a.width * a.height);
    return all[0] ?? null;
  };
  if (!liveCanvas()) return { ok: false as const, reason: "no-canvas" as const };
  const W = 720;
  const H = 1280;
  const TARGET_FPS = 24;
  const DT = 1000 / TARGET_FPS;
  const frames: string[] = [];
  const wgrab = window as unknown as { __bayWantGrab?: boolean; __bayGrabData?: string | null; __bayKick?: () => void };
  const kick = () => {
    try {
      wgrab.__bayKick?.();
    } catch {
      /* kick is best-effort */
    }
  };
  const bayClk = () => {
    if (g.__bayClk) return g.__bayClk;
    try {
      const blob = new Blob(["onmessage=e=>setTimeout(()=>postMessage(0),+e.data||16)"], { type: "text/javascript" });
      g.__bayClk = new Worker(URL.createObjectURL(blob));
    } catch {
      g.__bayClk = undefined;
    }
    return g.__bayClk;
  };
  const yieldPaint = (ms = 80) =>
    new Promise<void>((resolve) => {
      let done = false;
      const cap = Math.max(1, Math.min(80, Number(ms) || 80));
      const ac = new AbortController();
      const finish = () => {
        if (done) return;
        done = true;
        try {
          ac.abort();
        } catch {
          /* leftover fetch */
        }
        resolve();
      };
      try {
        const w = bayClk();
        if (w) {
          const onm = () => {
            try {
              w.removeEventListener("message", onm);
            } catch {
              /* */
            }
            finish();
          };
          w.addEventListener("message", onm);
          w.postMessage(cap);
        }
      } catch {
        /* worker optional */
      }
      try {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => finish();
        ch.port2.postMessage(0);
      } catch {
        /* */
      }
      try {
        requestAnimationFrame(() => finish());
      } catch {
        /* */
      }
      try {
        setTimeout(finish, cap);
      } catch {
        /* */
      }
      try {
        void fetch("/__bay/health", { cache: "no-store", signal: ac.signal }).then(
          () => finish(),
          () => finish(),
        );
      } catch {
        finish();
      }
    });
  let lastJpegAt = performance.now();
  let stalled = false;
  let scratch: HTMLCanvasElement | null = null;
  let pix: Uint8Array | null = null;
  let grabW = 0;
  let grabH = 0;
  const rawFrames: Uint8Array[] = [];
  const jpegFromRaw = (raw: Uint8Array, w: number, h: number) => {
    if (!scratch) scratch = document.createElement("canvas");
    if (scratch.width !== w || scratch.height !== h) {
      scratch.width = w;
      scratch.height = h;
    }
    const ctx = scratch.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    const row = w * 4;
    const dst = img.data;
    for (let y = 0; y < h; y++) {
      dst.set(raw.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    ctx.putImageData(img, 0, 0);
    return scratch.toDataURL("image/jpeg", 0.52);
  };
  const grab = async () => {
    beat();
    try {
      const gl = (window as unknown as { __bayWebgl?: WebGLRenderingContext | WebGL2RenderingContext }).__bayWebgl;
      if (!gl) return;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      if (w < 2 || h < 2) return;
      grabW = w;
      grabH = h;
      const need = w * h * 4;
      if (!pix || pix.length < need) pix = new Uint8Array(need);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pix);
      rawFrames.push(pix.slice(0, need));
      lastJpegAt = performance.now();
      if (rawFrames.length === 1 || rawFrames.length % 24 === 0) {
        try {
          void fetch("/__bay/progress", {
            method: "POST",
            headers: { "content-type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ id: g.__bayTapeJob, jpegN: rawFrames.length }),
          }).catch(() => {});
        } catch {
          /* progress is best-effort */
        }
      }
    } finally {
      wgrab.__bayWantGrab = false;
    }
  };
  clearHist();
  clearLog();
  const staged = scene != null && scene !== "" ? await restageScene(scene) : { ok: true, id: null };
  useBay.getState().setPlaying(true);
  try {
    unlockAudio();
  } catch {
    /* hidden tab */
  }
  {
    const paint0 = performance.now();
    while (performance.now() - paint0 < 2000) {
      let painted = false;
      try {
        painted = Boolean(peek().paint);
      } catch {
        painted = false;
      }
      if (painted) break;
      await yieldPaint(80);
    }
  }
  await waitFrames(50);
  if (useBay.getState().entities.some((e) => e.kind === "dumptruck")) {
    const ready0 = performance.now();
    while (performance.now() - ready0 < 2500) {
      kick();
      await yieldPaint(80);
      try {
        const s = peek();
        const kinds = new Set((s.objects ?? []).map((o) => o.kind));
        const cy = s.camera?.y;
        if (kinds.has("dumptruck") && kinds.has("wheel") && typeof cy === "number" && cy >= 3.5 && cy <= 6.5) break;
      } catch {
        /* */
      }
    }
  }
  kick();
  await yieldPaint(80);
  const hard = Number(ms) > 400 ? Number(ms) : 14000;
  lastJpegAt = performance.now();
  const t0 = performance.now();
  g.__bayPace = true;
  (g as { __bayTapeCoilZ?: number }).__bayTapeCoilZ = undefined;
  await new Promise<void>((resolve) => setTimeout(resolve, 24));
  let contactN = 0;
  const contacts: { tMs: number; impulse: number; closing: number; id: string | null; otherMass: number | null }[] = [];
  const speedHz: number[] = [];
  const groundedHz: number[] = [];
  const t0Probe = probeTime();
  let spins = 0;
  while (performance.now() - t0 < hard && performance.now() - t0 < 85000) {
    spins += 1;
    beat();
    if (performance.now() - lastJpegAt > 20000) {
      stalled = true;
      break;
    }
    const tick0 = performance.now();
    try {
      kick();
      try {
        for (const rec of listSamplers().values()) {
          if (rec.kind !== "wheel") continue;
          const b = rec.getBody?.();
          if (!b) break;
          const p = b.translation();
          const lv = b.linvel();
          const vz = Math.min(22, Math.max(12, lv.z || 0));
          const prev = (g as { __bayTapeCoilZ?: number }).__bayTapeCoilZ;
          if (prev != null && p.z - prev < vz / 24 * 0.4) {
            b.setTranslation({ x: p.x * 0.2, y: p.y, z: p.z + vz / 24 }, true);
            b.setLinvel({ x: lv.x * 0.15, y: Math.min(lv.y, 0.35), z: vz }, true);
            b.wakeUp();
          }
          (g as { __bayTapeCoilZ?: number }).__bayTapeCoilZ = b.translation().z;
          break;
        }
      } catch {
        /* keep baking */
      }
      await grab();
      if (performance.now() - lastJpegAt > 20000) {
        stalled = true;
        break;
      }
      let wheelSpeed = 0;
      let wheelGrounded = 0;
      try {
        for (const rec of listSamplers().values()) {
          if (rec.kind !== "wheel") continue;
          const b = rec.getBody?.();
          if (b) {
            const lv = b.linvel();
            wheelSpeed = Math.hypot(lv.x, lv.y, lv.z);
          }
          const st = rec.sample()?.state;
          wheelGrounded = Number(st?.grounded) > 0 ? 1 : 0;
          break;
        }
      } catch {
        /* keep baking */
      }
      speedHz.push(wheelSpeed);
      groundedHz.push(wheelGrounded);
      if (spins % 8 === 0) {
      const cons = log().filter((e) => e.type === "contact");
      if (cons.length > contactN) {
        const tHit = Math.round(performance.now() - t0);
        for (let i = contactN; i < cons.length && contacts.length < SFX.hit.max; i++) {
          const e = cons[i]!;
          const eventMs = typeof e.t === "number" ? Math.round((e.t - t0Probe) * 1000) : tHit;
          contacts.push({
            tMs: Math.max(0, eventMs),
            impulse: typeof e.data.impulse === "number" ? e.data.impulse : 0,
            closing: typeof e.data.closing === "number" ? e.data.closing : 0,
            id: typeof e.data.id === "string" ? e.data.id : null,
            otherMass: typeof e.data.otherMass === "number" ? e.data.otherMass : null,
          });
        }
        contactN = cons.length;
      }
      }
    } catch {
      /* keep baking */
    }
    const leftover = DT - (performance.now() - tick0);
    const waitMs = leftover > 8 ? leftover : 0;
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  }
  g.__bayPace = false;
  const durationMs = Math.round(performance.now() - t0);
  if (grabW > 0 && grabH > 0) {
    for (const raw of rawFrames) {
      const data = jpegFromRaw(raw, grabW, grabH);
      if (typeof data === "string" && data.startsWith("data:image")) frames.push(data);
    }
  }
  const jpegN = frames.length;
  if (stalled) {
    return {
      ok: false,
      aborted: true,
      reason: "tape-stall" as const,
      w: W,
      h: H,
      mime: "image/jpeg",
      n: jpegN,
      jpegN,
      restage: staged,
      slowAtMs: null,
      slowOffMs: null,
      contacts,
      speedHz,
      groundedHz,
      hitsMs: contacts.map((c) => c.tMs),
      durationMs,
    };
  }
  return {
    ok: jpegN > 2,
    w: W,
    h: H,
    grabW,
    grabH,
    pipeGen: g.__bayPipeGen ?? PIPE_GEN,
    mime: "image/jpeg",
    n: jpegN,
    jpegN,
    restage: staged,
    slowAtMs: null,
    slowOffMs: null,
    contacts,
    speedHz,
    groundedHz,
    hitsMs: contacts.map((c) => c.tMs),
    durationMs,
    frames,
  };
}

export function help() {
  return {
    peek: "compact stage: objects xyz/speed + recent events + toy hinge loads",
    snapshot: "full probe snap",
    log: "event list",
    history: "(seconds=90) pose+velocity ring at 30Hz; events ride on the same frames",
    effects: "(id, seconds=90) path + events for one body",
    analyze: "(id?) 30Hz mean/median/stdev + teleport/spin flags for a body (default wheel)",
    ui: "DOM controls with data-bay",
    click: "(name, value?) click [data-bay=name]; selects need a value (track id, solid shape)",
    camera: "snapshot().camera xyz + look",
    spawn: "(kind) grenade|pack|can|crate|dummy|grass|wall|doorway|cube|...",
    solid: "(shape)",
    puncture: "(id?) pull grenade pin or cook pack",
    reset: "restore the stamped stage (edit layout), then pause",
    play: "start physics/damage from the current stage",
    pause: "freeze physics (edit mode)",
    studio: "(on?) open/close studio; pauses the stage",
    place: "(kind, x?, y?, z?) drop an actor and stamp the layout",
    levels: "builtin + saved clips",
    runs: "vs ladders",
    run: "(id, lv=1) restage a vs trial",
    next: "next vs rung",
    load: "(id) restage a clip",
    restage: "(id|sceneJson) restage a JSON scene file",
    scenes: "JSON scene catalog",
    save: "(name?) keep the current arrangement",
    forget: "(id) drop a saved clip",
    tool: "('grab'|'nail')",
    select: "(id)",
    track: "(id|null)",
    cutaway: "toggle x-ray",
    apply: "(id, patch)",
    hold: "(id) kinematic grab in place",
    drag: "(id, {x,y,z}, seconds=0.35)",
    traceDrag: "(id, {x,y,z}, seconds=0.8) rAF xyz of physics vs mesh vs camera",
    nudge: "(id, {x,y,z}) relative",
    gizmo: "(id, axis, meters) move the whole assembly on x|y|z",
    dragGizmo: "(id, axis, pixels) real screen-space arrow drag",
    fling: "(id, {x,y,z}) set velocity",
    drop: "(id) dynamic",
    until: "(eventType, timeoutMs) promise",
    wait: "(ms) rAF-wait so physics keeps ticking",
    shot: "jpeg of the live canvas (bay.mjs writes it to a file)",
    tape: "(scene, ms?) recorder rolling, restage, 30fps jpeg; cannon holes drop into slo-mo just before impact",
    slowmo: "(on?) Matrix whoosh; omit to toggle",
    audio: "hiss/roar loop levels",
    reload: "location.reload — last-ditch if the pipe died",
  };
}

export function harnessApi() {
  return {
    help,
    peek,
    snapshot,
    log,
    dump: () => JSON.stringify(snapshot()),
    history,
    effects,
    analyze,
    ui: listUi,
    click: clickUi,
    camera: () => snapshot().camera,
    spawn: spawnKind,
    solid: selectSolid,
    puncture: punctureId,
    reset: resetStage,
    levels: listBayLevels,
    runs: listBayRuns,
    run: (id: string, lv?: number) => {
      clearHist();
      return loadRun(id, lv ?? 1);
    },
    next: () => {
      clearHist();
      return nextTrial();
    },
    load: loadClip,
    restage: async (input?: unknown) => {
      clearHist();
      const r = await restageScene(input ?? "v1");
      useBay.getState().setPlaying(true);
      return r;
    },
    play: () => {
      useBay.getState().setPlaying(true);
      note("play", { n: useBay.getState().entities.length });
      return { ok: true, playing: true };
    },
    pause: () => {
      useBay.getState().setPlaying(false);
      note("pause", {});
      return { ok: true, playing: false };
    },
    studio: (on?: boolean) => {
      const bay = useBay.getState();
      const next = typeof on === "boolean" ? on : !bay.studio;
      bay.setStudio(next);
      if (next) {
        bay.setPlaying(false);
        void import("@/lib/bay/studio").then((m) => bay.stampBlueprint(m.captureScene()));
      }
      note("studio", { on: next });
      return { ok: true, studio: next, playing: useBay.getState().playing };
    },
    place: (kind: string, x?: number, y?: number, z?: number) => placeActor(kind, x, y, z),
    scenes: listBayScenes,
    save: saveBay,
    forget: forgetBay,
    tool: setToolName,
    select: (id: string | null) => {
      useBay.getState().select(id);
      note("select", { id: id ?? "" });
      return { ok: true, id };
    },
    track: (id: string | null) => {
      const set = (window as unknown as { __baySetTrack?: (id: string | null) => void }).__baySetTrack;
      set?.(id);
      return { ok: true, id };
    },
    cutaway: () => {
      (window as unknown as { __bayToggleCutaway?: () => void }).__bayToggleCutaway?.();
      return { ok: true, cutaway: useBay.getState().cutaway };
    },
    apply: applyActor,
    hold,
    drag: dragTo,
    traceDrag,
    nudge,
    gizmo: gizmoMove,
    dragGizmo,
    fling,
    drop,
    until,
    wait: waitFrames,
    note,
    shot: async () => {
      const all = [...document.querySelectorAll("canvas")].filter(
        (el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement && el.width >= 64 && el.height >= 64,
      );
      all.sort((a, b) => b.width * b.height - a.width * a.height);
      const canvas = all[0];
      if (!canvas) return { ok: false, reason: "no-canvas" };
      const w = window as unknown as { __bayWantGrab?: boolean; __bayGrabData?: string | null };
      w.__bayGrabData = null;
      w.__bayWantGrab = true;
      try {
        (window as unknown as { __bayKick?: () => void }).__bayKick?.();
      } catch {
        /* kick */
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return {
        ok: true,
        w: canvas.width,
        h: canvas.height,
        cw: canvas.clientWidth,
        ch: canvas.clientHeight,
        n: all.length,
        mime: "image/jpeg",
        data: w.__bayGrabData ?? "",
      };
    },
    tape,
    slowmo: (on?: boolean) => {
      const next = typeof on === "boolean" ? on : !useBay.getState().slowMo;
      if (useBay.getState().slowMo !== next) useBay.getState().toggleSlowMo();
      try {
        playSlowMo(next);
      } catch {
        /* hidden tab / no audio */
      }
      note("slowmo", { on: next });
      return { ok: true, on: next };
    },
    audio: loopLevels,
    reload: () => {
      location.reload();
      return { ok: true };
    },
  };
}

export function bindHarnessWindow() {
  if (typeof window === "undefined") return;
  (window as unknown as { __bay: ReturnType<typeof harnessApi> }).__bay = harnessApi();
}

/** Live page polls the Vite `/__bay` pipe and runs `window.__bay`. Agent uses `scripts/bay.mjs`. */
let onHotCall: ((msg: { id?: string; fn?: string; args?: unknown[] }) => void) | null = null;

function stopHotListener() {
  if (onHotCall) {
    import.meta.hot?.off("bay:call", onHotCall);
    onHotCall = null;
  }
}

function installWatchdog() {
  if (typeof window === "undefined" || g.__bayWatch) return;
  g.__bayWatch = setInterval(() => {
    const last = g.__bayTakeBeat ?? 0;
    if (last && performance.now() - last > 28000) {
      g.__bayPipeCtl?.abort();
      g.__bayPipeCtl = undefined;
      startHarnessPipe();
    }
  }, 2000);
}

function startHarnessPipe() {
  if (typeof window === "undefined" || !import.meta.env.DEV) return;
  bindHarnessWindow();
  ensureFuseClock();
  installWatchdog();
  if (g.__bayPipeGen !== PIPE_GEN) {
    g.__bayPipeCtl?.abort();
    g.__bayPipeCtl = undefined;
    g.__bayPipeGen = PIPE_GEN;
  }
  const stripFrames = (out: { value?: unknown; error?: string; skipped?: boolean }) => {
    return out;
  };
  const run = async (fn: string, args: unknown[], capMs = 16000, id?: string) => {
    if (g.__bayBake && fn === "tape" && id && id !== g.__bayTapeJob) return { skipped: true as const };
    const api = (window as unknown as { __bay?: Record<string, (...a: unknown[]) => unknown> }).__bay;
    if (!api || typeof api[fn] !== "function") return { error: `no-fn:${fn}` };
    try {
      const cap =
        fn === "tape"
          ? Math.min(120000, Number(capMs) || 120000)
          : Math.max(4000, Math.min(240000, Number(capMs) || 16000));
      const value = await Promise.race([
        Promise.resolve(api[fn](...args)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("run-timeout")), cap)),
      ]);
      const raw = value ?? null;
      const frames =
        raw && typeof raw === "object" && raw !== null && Array.isArray((raw as { frames?: unknown }).frames)
          ? (raw as { frames: string[] }).frames
          : null;
      if (frames) delete (raw as { frames?: unknown }).frames;
      const cloned = JSON.parse(JSON.stringify(raw));
      if (cloned && typeof cloned === "object" && cloned !== null && frames && frames.length) {
        (cloned as { frames: string[] }).frames = frames;
      }
      return { value: cloned };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
  const jobs = (g.__bayJobs ??= new Map());
  const handle = async (id: string, fn: string, args: unknown[], capMs?: number) => {
    if (!id) return { error: "no-id" };
    const hit = jobs.get(id);
    if (hit) return hit;
    const p = run(fn, args, capMs, id);
    jobs.set(id, p);
    if (jobs.size > 80) {
      const first = jobs.keys().next().value;
      if (first && first !== id) jobs.delete(first);
    }
    return p;
  };
  stopHotListener();
  const onHot = async (msg: { id?: string; fn?: string; args?: unknown[]; waitMs?: number }) => {
    const out = await handle(String(msg?.id ?? ""), String(msg?.fn ?? ""), Array.isArray(msg?.args) ? msg.args : [], msg.waitMs);
    if (!out) return;
    import.meta.hot?.send("bay:return", { id: msg.id, ...out });
  };
  onHotCall = onHot;
  import.meta.hot?.on("bay:call", onHot);
  if (g.__bayPipeCtl && !g.__bayPipeCtl.signal.aborted) return;
  const ctl = new AbortController();
  g.__bayPipeCtl = ctl;
  beat();
  const loop = async () => {
    while (!ctl.signal.aborted) {
      try {
        beat();
        const { vis, owned, bot, paint } = paintState();
        const nobj = listSamplers().size;
        const snap = snapshot();
        const fps = Math.round(snap.fps ?? 0);
        const ms = Math.round(snap.frameMs ?? 0);
        const gen = g.__bayPipeGen ?? PIPE_GEN;
        const r = await fetch(
          `/__bay/take?wait=10000&vis=${encodeURIComponent(vis)}&nobj=${nobj}&paint=${paint ? 1 : 0}&bot=${bot ? 1 : 0}&fps=${fps}&ms=${ms}&gen=${gen}&owned=${owned ? 1 : 0}`,
          { signal: ctl.signal },
        );
        if (ctl.signal.aborted) return;
        if (r.status === 204) continue;
        if (!r.ok) {
          await new Promise((res) => setTimeout(res, 400));
          continue;
        }
        const msg = (await r.json()) as { id?: string; fn?: string; args?: unknown[]; waitMs?: number };
        if (!msg?.id) continue;
        const fnName = String(msg.fn ?? "");
        const jobId = String(msg.id);
        const wait = Number(msg.waitMs) || 16000;
        const cap = fnName === "tape" ? Math.min(120000, wait) : Math.min(240000, wait);
        const postDone = (out: { value?: unknown; error?: string; skipped?: boolean }) =>
          fetch("/__bay/done", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: jobId,
              ...stripFrames(out),
              paint,
              nobj: listSamplers().size,
              owned,
            }),
          });
        if (g.__bayBake && fnName === "tape" && jobId !== g.__bayTapeJob) {
          await postDone({ skipped: true });
          continue;
        }
        if (fnName === "tape") {
          g.__bayTapeJob = jobId;
          if (!jobs.has(jobId)) {
            void handle(jobId, fnName, Array.isArray(msg.args) ? msg.args : [], cap).then((out) => {
              beat();
              return postDone(out);
            });
          }
          continue;
        }
        const out = await handle(jobId, fnName, Array.isArray(msg.args) ? msg.args : [], cap);
        beat();
        await postDone(out);
      } catch {
        if (ctl.signal.aborted) return;
        await new Promise((res) => setTimeout(res, 500));
      }
    }
  };
  void loop();
}

/** React unmount must not kill the pipe — HMR would leave takers at 0. */
export function bindHarnessPipe() {
  startHarnessPipe();
  return () => {};
}

if (typeof window !== "undefined" && import.meta.env.DEV) {
  bindHarnessWindow();
  startHarnessPipe();
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    const owned = typeof window !== "undefined" && Boolean((window as unknown as { __bayOwned?: boolean }).__bayOwned);
    if (owned || g.__bayBake) return;
    stopHotListener();
  });
}
