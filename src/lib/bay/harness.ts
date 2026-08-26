import { punctureId, resetBay, setToolName, spawnKind } from "@/lib/bay/actions";
import {
  applyActor,
  assemblyMembers,
  listSamplers,
  log,
  note,
  probeTime,
  snapshot,
  type ProbeEvent,
  type ProbeObject,
} from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

/** Pose log at 30 Hz (every other 60 Hz physics tick). 30s × 30 Hz × ~20 bodies is small. */
const HZ = 30;
const KEEP = 30;
const MAX_FRAMES = HZ * KEEP + 30;

export type PoseSample = {
  x: number;
  y: number;
  z: number;
  vx: number | null;
  vy: number | null;
  vz: number | null;
};

export type HistEvent = { type: string; id: string | null };

export type HistFrame = {
  t: number;
  ev: HistEvent[];
  o: Record<string, PoseSample>;
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

const frames: HistFrame[] = [];
const drags: DragJob[] = [];
let lastHistT = -1;
let lastEventN = 0;

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function recordHistory(objects: ProbeObject[], t: number) {
  if (t - lastHistT < 1 / HZ) return;
  lastHistT = t;
  const evs = log();
  const fresh: HistEvent[] = evs.slice(lastEventN).map((e) => ({
    type: e.type,
    id: typeof e.data.id === "string" ? e.data.id : null,
  }));
  lastEventN = evs.length;
  const o: HistFrame["o"] = {};
  for (const obj of objects) {
    o[obj.id] = { x: obj.x, y: obj.y, z: obj.z, vx: obj.vx, vy: obj.vy, vz: obj.vz };
  }
  frames.push({ t: round(t), ev: fresh, o });
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
}

export function tickDrags(dt: number) {
  for (let i = drags.length - 1; i >= 0; i--) {
    const job = drags[i];
    job.t += dt;
    const u = Math.min(1, job.dur <= 0 ? 1 : job.t / job.dur);
    for (const m of job.members) {
      const b = listSamplers().get(m.id)?.getBody?.();
      if (!b) continue;
      b.setBodyType(2, true);
      b.setNextKinematicTranslation({
        x: m.x0 + job.dx * u,
        y: Math.max(0.06, m.y0 + job.dy * u),
        z: m.z0 + job.dz * u,
      });
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

export function clickUi(name: string) {
  if (typeof document === "undefined") return { ok: false, reason: "no-dom" as const };
  const el = document.querySelector<HTMLElement>(`[data-bay="${name}"]`);
  if (!el) return { ok: false, reason: "missing" as const, name };
  if ("disabled" in el && (el as HTMLButtonElement).disabled) {
    return { ok: false, reason: "disabled" as const, name };
  }
  el.click();
  note("ui-click", { name });
  return { ok: true, name };
}

export function selectSolid(shape: string) {
  if (typeof document === "undefined") return spawnKind(shape);
  const el = document.querySelector<HTMLSelectElement>('[data-bay="solid"]');
  if (!el) return spawnKind(shape);
  el.value = shape;
  el.dispatchEvent(new Event("change", { bubbles: true }));
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

function nudge(id: string, d: { x?: number; y?: number; z?: number }) {
  const now = pose(id);
  if (!now) return { ok: false, reason: "no-body" as const, id };
  return dragTo(id, { x: now.x + (d.x ?? 0), y: now.y + (d.y ?? 0), z: now.z + (d.z ?? 0) }, 0.2);
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

export function peek() {
  const s = snapshot();
  const live =
    s.objects.length > 0
      ? s.objects
      : [...listSamplers()].map(([id, rec]) => {
          const p = rec.sample();
          return { id, kind: rec.kind, x: round(p.x), y: round(p.y), z: round(p.z), vx: 0, vy: 0, vz: 0, state: p.state ?? {} };
        });
  return {
    t: round(s.t),
    selected: s.selected ?? useBay.getState().selected,
    trackId: s.trackId,
    tool: s.tool,
    latch: s.latch,
    cutaway: s.cutaway,
    events: s.events.slice(-12).map((e) => e.type),
    objects: live.map((o) => ({
      id: o.id,
      kind: o.kind,
      x: o.x,
      y: o.y,
      z: o.z,
      speed: round(Math.hypot("vx" in o ? (o.vx ?? 0) : 0, "vy" in o ? (o.vy ?? 0) : 0, "vz" in o ? (o.vz ?? 0) : 0)),
      cook: o.state?.cook ?? null,
      burning: o.state?.burning ?? null,
      ash: o.state?.ash ?? null,
    })),
  };
}

export function until(type: string, timeoutMs = 8000) {
  const t0 = probeTime();
  if (log().some((e) => e.type === type && e.t >= t0 - 0.05)) {
    return Promise.resolve({ ok: true, type, waited: 0 });
  }
  return new Promise<{ ok: boolean; type: string; waited: number }>((resolve) => {
    const tStart = performance.now();
    const tick = () => {
      if (log().some((e: ProbeEvent) => e.type === type && e.t >= t0)) {
        resolve({ ok: true, type, waited: (performance.now() - tStart) / 1000 });
        return;
      }
      if (performance.now() - tStart > timeoutMs) {
        resolve({ ok: false, type, waited: timeoutMs / 1000 });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function help() {
  return {
    peek: "compact stage: objects xyz/speed + recent events",
    snapshot: "full probe snap",
    log: "event list",
    history: "(seconds=30) pose+velocity ring at 30Hz (every other 60Hz tick); events ride on the same frames",
    effects: "(id, seconds=30) path + events for one body",
    ui: "DOM controls with data-bay",
    click: "(name) click [data-bay=name]",
    spawn: "(kind) pack|charge|can|crate|dummy|grass|cube|...",
    solid: "(shape)",
    puncture: "(id?) cook selected pack/charge",
    reset: "restage clip",
    tool: "('grab'|'nail')",
    select: "(id)",
    track: "(id|null)",
    cutaway: "toggle x-ray",
    apply: "(id, patch)",
    hold: "(id) kinematic grab in place",
    drag: "(id, {x,y,z}, seconds=0.35)",
    nudge: "(id, {x,y,z}) relative",
    fling: "(id, {x,y,z}) set velocity",
    drop: "(id) dynamic",
    until: "(eventType, timeoutMs) promise",
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
    ui: listUi,
    click: clickUi,
    spawn: spawnKind,
    solid: selectSolid,
    puncture: punctureId,
    reset: () => {
      frames.length = 0;
      lastHistT = -1;
      lastEventN = 0;
      return resetBay();
    },
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
    nudge,
    fling,
    drop,
    until,
    note,
  };
}

export function bindHarnessWindow() {
  if (typeof window === "undefined") return;
  (window as unknown as { __bay: ReturnType<typeof harnessApi> }).__bay = harnessApi();
}
