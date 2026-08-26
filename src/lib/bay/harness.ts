import { punctureId, resetBay, setToolName, spawnKind } from "@/lib/bay/actions";
import { loopLevels } from "@/lib/contain/audio";
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

const frames: HistFrame[] = [];
const drags: DragJob[] = [];
let lastHistT = -1;
let lastEventN = 0;

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function recordHistory(
  objects: ProbeObject[],
  t: number,
  camera?: { x: number; y: number; z: number } | null,
) {
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
      b.setNextKinematicTranslation({
        x: m.x0 + job.dx * u,
        y: m.y0 + job.dy * u + yLift,
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
  const store = useBay.getState();
  const s = snapshot();
  const objects: {
    id: string;
    kind: string;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    speed: number;
    cook: string | number | boolean | null;
    burning: string | number | boolean | null;
    ash: string | number | boolean | null;
    kin: boolean | null;
    spin: number;
  }[] = [];
  for (const [id, rec] of listSamplers()) {
    const p = rec.sample();
    if (p.state?.missing) continue;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let spin = 0;
    let kin: boolean | null = null;
    const b = rec.getBody?.();
    if (b) {
      const lv = b.linvel();
      vx = round(lv.x);
      vy = round(lv.y);
      vz = round(lv.z);
      const av = b.angvel();
      spin = round(Math.hypot(av.x, av.y, av.z));
      kin = b.isKinematic();
    }
    objects.push({
      id,
      kind: rec.kind,
      x: round(p.x),
      y: round(p.y),
      z: round(p.z),
      vx,
      vy,
      vz,
      speed: round(Math.hypot(vx, vy, vz)),
      cook: p.state?.cook ?? null,
      burning: p.state?.burning ?? null,
      ash: p.state?.ash ?? null,
      kin,
      spin,
    });
  }
  const cam = s.camera;
  const histCam = frames.at(-1)?.cam ?? null;
  const camera = cam
    ? { x: cam.x, y: cam.y, z: cam.z, lookX: cam.lookX, lookY: cam.lookY, lookZ: cam.lookZ, fov: cam.fov }
    : histCam
      ? { x: histCam.x, y: histCam.y, z: histCam.z, lookX: histCam.x, lookY: histCam.y, lookZ: histCam.z, fov: 42 }
      : null;
  return {
    t: round(probeTime()),
    selected: store.selected,
    trackId: store.trackId,
    tool: store.tool,
    latch: store.latch,
    cutaway: store.cutaway,
    camera,
    events: log()
      .slice(-12)
      .map((e) => e.type),
    objects,
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

export function resetStage() {
  frames.length = 0;
  drags.length = 0;
  lastHistT = -1;
  lastEventN = 0;
  return resetBay();
}

export function help() {
  return {
    peek: "compact stage: objects xyz/speed + recent events",
    snapshot: "full probe snap",
    log: "event list",
    history: "(seconds=30) pose+velocity ring at 30Hz (every other 60Hz tick); events ride on the same frames",
    effects: "(id, seconds=30) path + events for one body",
    ui: "DOM controls with data-bay",
    click: "(name, value?) click [data-bay=name]; selects need a value (track id, solid shape)",
    camera: "snapshot().camera xyz + look",
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
    audio: "hiss/roar loop levels",
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
    camera: () => snapshot().camera,
    spawn: spawnKind,
    solid: selectSolid,
    puncture: punctureId,
    reset: resetStage,
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
    audio: loopLevels,
  };
}

export function bindHarnessWindow() {
  if (typeof window === "undefined") return;
  (window as unknown as { __bay: ReturnType<typeof harnessApi> }).__bay = harnessApi();
}
