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

const g = globalThis as unknown as {
  __bayActors?: Map<string, Actor>;
  __bayAssemblies?: Map<string, string[]>;
  __bayMemberOf?: Map<string, string>;
  __bayEvents?: ProbeEvent[];
  __bayLast?: ProbeSnap;
  __bayStarted?: number;
};
const actors = (g.__bayActors ??= new Map<string, Actor>());
const assemblies = (g.__bayAssemblies ??= new Map<string, string[]>());
const memberOf = (g.__bayMemberOf ??= new Map<string, string>());
const events: ProbeEvent[] = (g.__bayEvents ??= []);
const MAX_EVENTS = 800;
let last: ProbeSnap = (g.__bayLast ??= emptySnap());
function setLast(s: ProbeSnap) {
  last = s;
  g.__bayLast = s;
}

function now() {
  if (!g.__bayStarted) g.__bayStarted = performance.now();
  return (performance.now() - g.__bayStarted) / 1000;
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

export function registerAssembly(group: string, ids: string[]) {
  assemblies.set(group, ids.slice());
  for (const id of ids) memberOf.set(id, group);
}

export function unregisterAssembly(group: string) {
  const ids = assemblies.get(group);
  assemblies.delete(group);
  if (!ids) return;
  for (const id of ids) if (memberOf.get(id) === group) memberOf.delete(id);
}

export function assemblyMembers(id: string): string[] {
  const group = memberOf.get(id);
  if (!group) return [id];
  return assemblies.get(group) ?? [id];
}

export function assemblyGroup(id: string) {
  return memberOf.get(id) ?? null;
}

/** Turn an assembly into live dynamic bodies without touching React RigidBody props. */
export function awakenRagdoll(
  id: string,
  lin = 0.28,
  ang = 0.62,
): number {
  const ids = assemblyMembers(id);
  let n = 0;
  for (const mid of ids) {
    const b = actors.get(mid)?.getBody?.();
    if (!b) continue;
    b.setBodyType(0, true);
    b.setGravityScale(1, true);
    b.setLinearDamping(lin);
    b.setAngularDamping(ang);
    b.wakeUp();
    n += 1;
  }
  const group = memberOf.get(id);
  if (group) unregisterAssembly(group);
  return n;
}

export function setColliderGroups(b: RapierRigidBody, groups: number) {
  const n = b.numColliders();
  for (let i = 0; i < n; i++) {
    b.collider(i)?.setCollisionGroups(groups);
  }
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

function placeBody(b: RapierRigidBody, x: number, y: number, z: number) {
  if (b.isKinematic()) {
    b.setNextKinematicTranslation({ x, y, z });
  }
  b.setTranslation({ x, y, z }, true);
}

export function applyActor(id: string, patch: ActorPatch) {
  const actor = actors.get(id);
  const lead = actor?.getBody?.();
  if (!lead) return false;
  const moving = patch.x != null || patch.y != null || patch.z != null;
  const vel = patch.vx != null || patch.vy != null || patch.vz != null;
  const crew = moving || vel ? assemblyMembers(id) : [id];
  const p = lead.translation();
  const v = lead.linvel();
  const dx = (patch.x ?? p.x) - p.x;
  const dy = (patch.y ?? p.y) - p.y;
  const dz = (patch.z ?? p.z) - p.z;
  const vx = patch.vx ?? v.x;
  const vy = patch.vy ?? v.y;
  const vz = patch.vz ?? v.z;
  for (const mid of crew) {
    const b = mid === id ? lead : actors.get(mid)?.getBody?.();
    if (!b) continue;
    if (moving) {
      const q = b.translation();
      placeBody(b, q.x + dx, q.y + dy, q.z + dz);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (vel) b.setLinvel({ x: vx, y: vy, z: vz }, true);
    b.wakeUp();
  }
  if (patch.mass != null) setBodyMass(lead, patch.mass);
  const n = lead.numColliders();
  for (let i = 0; i < n; i++) {
    const c = lead.collider(i);
    if (!c) continue;
    if (patch.friction != null) c.setFriction(Math.max(0, patch.friction));
    if (patch.restitution != null) c.setRestitution(Math.max(0, patch.restitution));
  }
  lead.wakeUp();
  note("set-prop", {
    id,
    x: patch.x ?? null,
    y: patch.y ?? null,
    z: patch.z ?? null,
    mass: patch.mass ?? null,
    vx: patch.vx ?? null,
    vy: patch.vy ?? null,
    vz: patch.vz ?? null,
    n: crew.length,
  });
  return true;
}

export function writeSnap(partial: Omit<ProbeSnap, "events" | "t">) {
  setLast({
    t: now(),
    ...partial,
    events: events.slice(-40),
  });
}

export function snapshot(): ProbeSnap {
  return g.__bayLast ?? last;
}

export function clearLog() {
  events.length = 0;
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
