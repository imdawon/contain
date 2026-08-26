import { forgetBay, listBayLevels, listBayRuns, listBayScenes, loadBay, loadRun, nextTrial, punctureId, resetBay, restageScene, saveBay, setToolName, spawnKind } from "@/lib/bay/actions";
import { hingeSnapshot } from "@/lib/bay/atd";
import { ensureFuseClock, tickFuse } from "@/lib/bay/blast";
import { getLevel, levelCard } from "@/lib/bay/level";
import { getRun, runCard } from "@/lib/bay/run";
import { cooks } from "@/lib/bay/cook";
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
  rx?: number;
  ry?: number;
  rz?: number;
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

const PIPE_GEN = 5;

const g = globalThis as unknown as {
  __bayHist?: { frames: HistFrame[]; lastHistT: number; lastEventN: number };
  __bayPipeCtl?: AbortController;
  __baySeen?: Set<string>;
  __bayPipeGen?: number;
  __bayTakeBeat?: number;
  __bayWatch?: ReturnType<typeof setInterval>;
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
    o[obj.id] = { x: obj.x, y: obj.y, z: obj.z, rx: obj.rx, ry: obj.ry, rz: obj.rz, vx: obj.vx, vy: obj.vy, vz: obj.vz };
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
    inspect: store.inspect,
    paint: typeof document !== "undefined" && document.visibilityState === "visible",
    hidden: typeof document !== "undefined" && document.hidden,
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

export function help() {
  return {
    peek: "compact stage: objects xyz/speed + recent events + toy hinge loads",
    snapshot: "full probe snap",
    log: "event list",
    history: "(seconds=30) pose+velocity ring at 30Hz (every other 60Hz tick); events ride on the same frames",
    effects: "(id, seconds=30) path + events for one body",
    ui: "DOM controls with data-bay",
    click: "(name, value?) click [data-bay=name]; selects need a value (track id, solid shape)",
    camera: "snapshot().camera xyz + look",
    spawn: "(kind) grenade|pack|can|crate|dummy|grass|wall|doorway|cube|...",
    solid: "(shape)",
    puncture: "(id?) pull grenade pin or cook pack",
    reset: "restage the current trial or clip",
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
    nudge: "(id, {x,y,z}) relative",
    fling: "(id, {x,y,z}) set velocity",
    drop: "(id) dynamic",
    until: "(eventType, timeoutMs) promise",
    wait: "(ms) rAF-wait so physics keeps ticking",
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
    restage: (input?: unknown) => {
      clearHist();
      return restageScene(input ?? "v1");
    },
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
    nudge,
    fling,
    drop,
    until,
    wait: waitFrames,
    note,
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
  const run = async (fn: string, args: unknown[], capMs = 16000) => {
    const api = (window as unknown as { __bay?: Record<string, (...a: unknown[]) => unknown> }).__bay;
    if (!api || typeof api[fn] !== "function") return { error: `no-fn:${fn}` };
    try {
      const cap = Math.max(4000, Math.min(60000, Number(capMs) || 16000));
      const value = await Promise.race([
        Promise.resolve(api[fn](...args)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("run-timeout")), cap)),
      ]);
      return { value: JSON.parse(JSON.stringify(value ?? null)) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
  const seen = (g.__baySeen ??= new Set<string>());
  const handle = async (id: string, fn: string, args: unknown[], capMs?: number) => {
    if (!id || seen.has(id)) return null;
    seen.add(id);
    if (seen.size > 80) {
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }
    return run(fn, args, capMs);
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
        const vis = typeof document !== "undefined" ? document.visibilityState : "hidden";
        const nobj = listSamplers().size;
        const bot = typeof navigator !== "undefined" && navigator.webdriver === true;
        const paint = vis === "visible" && typeof document !== "undefined" && Boolean(document.querySelector("canvas")) && !bot;
        const r = await fetch(
          `/__bay/take?wait=10000&vis=${encodeURIComponent(vis)}&nobj=${nobj}&paint=${paint ? 1 : 0}&bot=${bot ? 1 : 0}`,
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
        const cap = Math.min(20000, Number(msg.waitMs) || 16000);
        const out = await handle(String(msg.id), String(msg.fn ?? ""), Array.isArray(msg.args) ? msg.args : [], cap);
        beat();
        await fetch("/__bay/done", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: msg.id,
            ...(out ?? { skipped: true }),
            paint,
            nobj: listSamplers().size,
          }),
        });
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
  import.meta.hot.dispose(() => stopHotListener());
}
