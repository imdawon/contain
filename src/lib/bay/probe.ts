import type { RapierRigidBody } from "@react-three/rapier";

export type Vec3 = [number, number, number];

export interface ProbeObject {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  vx: number | null;
  vy: number | null;
  vz: number | null;
  inView: boolean;
  mass: number | null;
  friction: number | null;
  restitution: number | null;
  editable: boolean;
  state: Record<string, string | number | boolean | null>;
}

export interface ProbeCamera {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
}

export interface ProbeEvent {
  t: number;
  type: string;
  data: Record<string, string | number | boolean | null>;
}

export interface ProbeSnap {
  t: number;
  latch: string;
  selected: string | null;
  trackId: string | null;
  tool: string;
  cutaway: boolean;
  camera: ProbeCamera | null;
  objects: ProbeObject[];
  inView: string[];
  events: ProbeEvent[];
}

export type ActorPatch = {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  mass?: number;
  friction?: number;
  restitution?: number;
};

type Sampler = () => {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  state?: Record<string, string | number | boolean | null>;
};

type Actor = {
  kind: string;
  sample: Sampler;
  getBody?: () => RapierRigidBody | null | undefined;
};

const actors = new Map<string, Actor>();
const events: ProbeEvent[] = [];
const MAX_EVENTS = 120;
let last: ProbeSnap = emptySnap();
let started = 0;

function now() {
  if (!started) started = performance.now();
  return (performance.now() - started) / 1000;
}

function emptySnap(): ProbeSnap {
  return {
    t: 0,
    latch: "sealed",
    selected: null,
    trackId: null,
    tool: "grab",
    cutaway: false,
    camera: null,
    objects: [],
    inView: [],
    events: [],
  };
}

export function registerBody(
  id: string,
  kind: string,
  sample: Sampler,
  getBody?: () => RapierRigidBody | null | undefined,
) {
  actors.set(id, { kind, sample, getBody });
}

export function unregisterBody(id: string) {
  actors.delete(id);
}

export function note(type: string, data: Record<string, string | number | boolean | null> = {}) {
  events.push({ t: now(), type, data });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

const colliderMass = new WeakMap<RapierRigidBody, number>();

function colliderBaseMass(b: RapierRigidBody) {
  let sum = 0;
  const n = b.numColliders();
  for (let i = 0; i < n; i++) {
    const c = b.collider(i);
    if (c) sum += c.mass();
  }
  return sum;
}

export function setBodyMass(b: RapierRigidBody, kg: number) {
  if (!Number.isFinite(kg) || kg <= 0.02) return;
  if (!colliderMass.has(b)) {
    const native = colliderBaseMass(b);
    colliderMass.set(b, native > 0.0001 ? native : kg);
  }
  const base = colliderMass.get(b) ?? kg;
  b.setAdditionalMass(kg - base, true);
  b.wakeUp();
}

export function applyActor(id: string, patch: ActorPatch) {
  const actor = actors.get(id);
  const b = actor?.getBody?.();
  if (!b) return false;
  const p = b.translation();
  const v = b.linvel();
  if (patch.x != null || patch.y != null || patch.z != null) {
    b.setTranslation({ x: patch.x ?? p.x, y: patch.y ?? p.y, z: patch.z ?? p.z }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  if (patch.vx != null || patch.vy != null || patch.vz != null) {
    b.setLinvel({ x: patch.vx ?? v.x, y: patch.vy ?? v.y, z: patch.vz ?? v.z }, true);
  }
  if (patch.mass != null) setBodyMass(b, patch.mass);
  const n = b.numColliders();
  for (let i = 0; i < n; i++) {
    const c = b.collider(i);
    if (!c) continue;
    if (patch.friction != null) c.setFriction(Math.max(0, patch.friction));
    if (patch.restitution != null) c.setRestitution(Math.max(0, patch.restitution));
  }
  b.wakeUp();
  note("set-prop", {
    id,
    x: patch.x ?? null,
    y: patch.y ?? null,
    z: patch.z ?? null,
    mass: patch.mass ?? null,
    vx: patch.vx ?? null,
    vy: patch.vy ?? null,
    vz: patch.vz ?? null,
  });
  return true;
}

export function writeSnap(partial: Omit<ProbeSnap, "events" | "t">) {
  last = {
    t: now(),
    ...partial,
    events: events.slice(-40),
  };
}

export function snapshot(): ProbeSnap {
  return last;
}

export function log(): ProbeEvent[] {
  return events.slice();
}

export function dump(): string {
  return JSON.stringify(last);
}

export function listSamplers() {
  return actors;
}

export function bindProbeWindow() {
  if (typeof window === "undefined") return;
  const api = {
    snapshot,
    log,
    dump,
    note,
    apply: applyActor,
    track(id: string | null) {
      const set = (
        window as unknown as { __baySetTrack?: (id: string | null) => void }
      ).__baySetTrack;
      set?.(id);
    },
    cutaway() {
      (
        window as unknown as { __bayToggleCutaway?: () => void }
      ).__bayToggleCutaway?.();
    },
  };
  (window as unknown as { __bay: typeof api }).__bay = api;
}

export { now as probeTime };
