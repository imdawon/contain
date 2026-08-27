/** Headless Rapier world for tonne-roll stats. No canvas, no tape. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CRATE_G, DUMMY_G, WAGON_G, WORLD_G } from "./groups.ts";
import { hillHulls } from "./hill-hulls.ts";
import { DRUM, FLOOR, WHEEL } from "./parts.ts";
import { applySteelHits, makeSteelShell, steelExtents, steelRim, worldHitsToLocal, type SteelHit, type SteelKind, type SteelShell } from "./yield.ts";

export type Actor = {
  name?: string;
  kind: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  vel?: [number, number, number];
  mass?: number;
  grip?: number;
  bounce?: number;
  size?: [number, number, number];
  cut?: number;
  grade?: number;
};

export type Trial = {
  steps: number;
  seconds: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  maxSpeed: number;
  rim: number;
  dent: number;
  strain: number;
  drumsCrushed: number;
  drumMaxDent: number;
  hitWall: boolean;
  tFloor: number | null;
  wallX: number;
};

export type DrumMode = "lazy" | "always" | "off";

export type BuildOpts = {
  solver?: number;
  pgs?: number;
  hullCols?: number;
  drums?: DrumMode;
};

const require = createRequire(fileURLToPath(import.meta.url));
const RAPER_PATH = fileURLToPath(new URL("../../../node_modules/@react-three/rapier/node_modules/@dimforge/rapier3d-compat/rapier.cjs", import.meta.url));

type RapierMod = {
  init: () => Promise<void>;
  World: new (g: { x: number; y: number; z: number }) => RapierWorld;
  RigidBodyDesc: {
    fixed: () => BodyDesc;
    dynamic: () => BodyDesc;
  };
  ColliderDesc: {
    cuboid: (x: number, y: number, z: number) => ColDesc;
    cylinder: (h: number, r: number) => ColDesc;
    convexHull: (pts: Float32Array) => ColDesc | null;
  };
};

type BodyDesc = {
  setTranslation: (x: number, y: number, z: number) => BodyDesc;
  setRotation: (q: { x: number; y: number; z: number; w: number }) => BodyDesc;
  setLinvel: (x: number, y: number, z: number) => BodyDesc;
  setCcdEnabled: (v: boolean) => BodyDesc;
  setCanSleep: (v: boolean) => BodyDesc;
  setLinearDamping: (v: number) => BodyDesc;
  setAngularDamping: (v: number) => BodyDesc;
  setEnabled: (v: boolean) => BodyDesc;
};

type ColDesc = {
  setMass: (v: number) => ColDesc;
  setFriction: (v: number) => ColDesc;
  setRestitution: (v: number) => ColDesc;
  setCollisionGroups: (v: number) => ColDesc;
  setDensity: (v: number) => ColDesc;
  setTranslation: (x: number, y: number, z: number) => ColDesc;
};

type RapierWorld = {
  free: () => void;
  step: () => void;
  timestep: number;
  numSolverIterations: number;
  numInternalPgsIterations: number;
  createRigidBody: (d: BodyDesc) => RapierBody;
  createCollider: (d: ColDesc, b: RapierBody) => unknown;
  contactPairsWith: (c: RapierCol, f: (other: RapierCol) => void) => void;
  contactPair: (a: RapierCol, b: RapierCol, f: (m: Manifold, flipped: boolean) => void) => void;
};

type RapierBody = {
  handle: number;
  numColliders: () => number;
  collider: (i: number) => RapierCol | null;
  translation: () => { x: number; y: number; z: number };
  rotation: () => { x: number; y: number; z: number; w: number };
  linvel: () => { x: number; y: number; z: number };
  angvel: () => { x: number; y: number; z: number };
  mass: () => number;
  isFixed: () => boolean;
  isEnabled: () => boolean;
  setEnabled: (v: boolean) => void;
  setTranslation: (t: { x: number; y: number; z: number }, wake: boolean) => void;
  setRotation: (q: { x: number; y: number; z: number; w: number }, wake: boolean) => void;
  setLinvel: (v: { x: number; y: number; z: number }, wake: boolean) => void;
  setAngvel: (v: { x: number; y: number; z: number }, wake: boolean) => void;
  wakeUp: () => void;
  sleep: () => void;
};

type RapierCol = {
  parent: () => RapierBody | null;
  collisionGroups: () => number;
};

type Manifold = {
  numContacts: () => number;
  contactImpulse: (k: number) => number;
  localContactPoint1: (k: number) => { x: number; y: number; z: number } | null;
  localContactPoint2: (k: number) => { x: number; y: number; z: number } | null;
  localNormal1: () => { x: number; y: number; z: number };
  localNormal2: () => { x: number; y: number; z: number };
};

let rapierPromise: Promise<RapierMod> | null = null;

export function loadRapier(): Promise<RapierMod> {
  if (!rapierPromise) {
    const R = require(RAPER_PATH) as RapierMod;
    rapierPromise = R.init().then(() => R);
  }
  return rapierPromise;
}

function bitmask(groups: number[]) {
  return groups.reduce((acc, g) => acc | (1 << g), 0);
}

function interactionGroups(membership: number[], filter: number[]) {
  return (bitmask(membership) << 16) + bitmask(filter);
}

const WHEEL_GROUPS = interactionGroups([WAGON_G], [WORLD_G, CRATE_G]);
const DRUM_GROUPS = interactionGroups([CRATE_G], [WORLD_G, CRATE_G, WAGON_G]);
const WORLD_GROUPS = interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G]);
const WHEEL_MEMBER = 1 << WAGON_G;
const DRUM_WAKE_Z = 1e9;
const DRUM_NEAR = 8;
const DRUM_WAKE = 40;

/** Three.js Euler order XYZ — same as the live canvas. */
function eulerToQuat(rx: number, ry: number, rz: number) {
  const c1 = Math.cos(rx / 2);
  const s1 = Math.sin(rx / 2);
  const c2 = Math.cos(ry / 2);
  const s2 = Math.sin(ry / 2);
  const c3 = Math.cos(rz / 2);
  const s3 = Math.sin(rz / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

type Rest = {
  x: number;
  y: number;
  z: number;
  q: { x: number; y: number; z: number; w: number };
  vx: number;
  vy: number;
  vz: number;
};

export type Sim = {
  world: RapierWorld;
  wheel: RapierBody;
  drums: RapierBody[];
  wheelRest: Rest;
  drumRests: Rest[];
  wheelShell: SteelShell;
  drumShells: SteelShell[];
  hulls: number;
  hullFail: number;
  drumsOn: boolean;
  drumMode: DrumMode;
  smashSolver: number;
  smashPgs: number;
};

function restOf(b: RapierBody, vel?: [number, number, number]): Rest {
  const t = b.translation();
  const q = b.rotation();
  return { x: t.x, y: t.y, z: t.z, q: { x: q.x, y: q.y, z: q.z, w: q.w }, vx: vel?.[0] ?? 0, vy: vel?.[1] ?? 0, vz: vel?.[2] ?? 0 };
}

function poseBody(b: RapierBody, rest: Rest, jitter = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }) {
  b.setTranslation({ x: rest.x + jitter.x, y: rest.y + jitter.y, z: rest.z + jitter.z }, true);
  b.setRotation(rest.q, true);
  b.setLinvel({ x: rest.vx + jitter.vx, y: rest.vy + jitter.vy, z: rest.vz + jitter.vz }, true);
  b.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function setDrumsEnabled(sim: Sim, on: boolean) {
  if (sim.drumsOn === on) return;
  sim.drumsOn = on;
  for (const d of sim.drums) {
    d.setEnabled(on);
    if (on) d.wakeUp();
  }
  if (on) {
    sim.world.numSolverIterations = sim.smashSolver;
    sim.world.numInternalPgsIterations = sim.smashPgs;
  }
}

export function buildWorld(R: RapierMod, actors: Actor[], opts?: BuildOpts): Sim {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const smashSolver = opts?.solver ?? 8;
  const smashPgs = opts?.pgs ?? 2;
  const drumMode: DrumMode = opts?.drums ?? "lazy";
  const startWithDrums = drumMode === "always";
  world.numSolverIterations = startWithDrums ? smashSolver : 4;
  world.numInternalPgsIterations = startWithDrums ? smashPgs : 1;

  const floor = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
  world.createCollider(
    R.ColliderDesc.cuboid(FLOOR.half, 0.25, FLOOR.half)
      .setTranslation(0, -0.25, 0)
      .setFriction(0.95)
      .setRestitution(0)
      .setCollisionGroups(WORLD_GROUPS),
    floor,
  );

  let wheel: RapierBody | null = null;
  let wheelVel: [number, number, number] | undefined;
  const drums: RapierBody[] = [];
  const drumRests: Rest[] = [];
  let hulls = 0;
  let hullFail = 0;
  const hullCols = opts?.hullCols ?? 16;

  for (const e of actors) {
    const rot = e.rot ?? [0, 0, 0];
    const q = eulerToQuat(rot[0], rot[1], rot[2]);
    if (e.kind === "ramp") {
      const size = e.size ?? [16, 3.7, 16];
      const cut = e.cut ?? 1;
      const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(e.pos[0], e.pos[1], e.pos[2]).setRotation(q));
      const mu = e.grip ?? 0.7;
      for (const hull of hillHulls(size[0], size[1], size[2], cut, hullCols, e.grade ?? 0)) {
        const desc = R.ColliderDesc.convexHull(hull);
        if (!desc) {
          hullFail += 1;
          continue;
        }
        hulls += 1;
        world.createCollider(desc.setFriction(mu).setRestitution(0).setCollisionGroups(WORLD_GROUPS), body);
      }
    } else if (e.kind === "wheel") {
      const kg = e.mass ?? WHEEL.mass;
      const mu = e.grip ?? 0.72;
      const bounce = e.bounce ?? 0;
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(e.pos[0], e.pos[1], e.pos[2])
          .setRotation(q)
          .setLinvel(e.vel?.[0] ?? 0, e.vel?.[1] ?? 0, e.vel?.[2] ?? 0)
          .setCcdEnabled(true)
          .setCanSleep(false)
          .setLinearDamping(0.004)
          .setAngularDamping(0.08),
      );
      world.createCollider(
        R.ColliderDesc.cylinder(WHEEL.thick / 2, WHEEL.radius)
          .setMass(kg)
          .setFriction(mu)
          .setRestitution(bounce)
          .setCollisionGroups(WHEEL_GROUPS),
        body,
      );
      wheel = body;
      wheelVel = e.vel;
    } else if (e.kind === "drum") {
      if (drumMode === "off") continue;
      const kg = e.mass ?? DRUM.mass;
      const mu = e.grip ?? 0.48;
      const bounce = e.bounce ?? 0;
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(e.pos[0], e.pos[1], e.pos[2])
        .setRotation(q)
        .setCanSleep(true)
        .setLinearDamping(0.04)
        .setAngularDamping(0.06)
        .setEnabled(startWithDrums);
      const body = world.createRigidBody(desc);
      world.createCollider(
        R.ColliderDesc.cylinder(DRUM.height / 2, DRUM.radius)
          .setMass(kg)
          .setFriction(mu)
          .setRestitution(bounce)
          .setCollisionGroups(DRUM_GROUPS),
        body,
      );
      drums.push(body);
      drumRests.push(restOf(body));
    }
  }
  if (!wheel) throw new Error("no wheel");
  return {
    world,
    wheel,
    drums,
    wheelRest: restOf(wheel, wheelVel),
    drumRests,
    wheelShell: makeSteelShell("wheel"),
    drumShells: drums.map(() => makeSteelShell("drum")),
    hulls,
    hullFail,
    drumsOn: startWithDrums,
    drumMode,
    smashSolver,
    smashPgs,
  };
}

function collectHits(world: RapierWorld, b: RapierBody, kind: SteelKind): SteelHit[] {
  const hits: SteelHit[] = [];
  const n = b.numColliders();
  const seen = new Set<number>();
  const v = b.linvel();
  for (let i = 0; i < n; i++) {
    const c = b.collider(i);
    if (!c) continue;
    world.contactPairsWith(c, (other) => {
      const ob = other.parent();
      if (!ob || ob.handle === b.handle) return;
      if (seen.has(ob.handle)) return;
      seen.add(ob.handle);
      const otherFixed = ob.isFixed();
      if (kind === "drum") {
        if (otherFixed) return;
        if ((other.collisionGroups() >>> 16 & WHEEL_MEMBER) === 0) return;
      }
      const otherMass = otherFixed ? Number.POSITIVE_INFINITY : ob.mass();
      if (kind === "wheel" && !otherFixed && otherMass < 4000) return;
      const ov = otherFixed ? { x: 0, y: 0, z: 0 } : ob.linvel();
      const relx = v.x - ov.x;
      const rely = v.y - ov.y;
      const relz = v.z - ov.z;
      let sum = 0;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      const on = ob.numColliders();
      for (let a = 0; a < n; a++) {
        const ca = b.collider(a);
        if (!ca) continue;
        for (let bi = 0; bi < on; bi++) {
          const cb = ob.collider(bi);
          if (!cb) continue;
          world.contactPair(ca, cb, (manifold, flipped) => {
            const count = manifold.numContacts();
            for (let k = 0; k < count; k++) {
              const impulse = Math.abs(manifold.contactImpulse(k));
              if (impulse < 0.02) continue;
              const lp = flipped ? manifold.localContactPoint2(k) : manifold.localContactPoint1(k);
              const ln = flipped ? manifold.localNormal2() : manifold.localNormal1();
              if (!lp) continue;
              sum += impulse;
              cx += lp.x * impulse;
              cy += lp.y * impulse;
              cz += lp.z * impulse;
              nx += ln.x * impulse;
              ny += ln.y * impulse;
              nz += ln.z * impulse;
            }
          });
        }
      }
      if (sum < 0.08) return;
      const inv = 1 / sum;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const nnx = nx / nl;
      const nny = ny / nl;
      const nnz = nz / nl;
      const closing = Math.max(0, -(relx * nnx + rely * nny + relz * nnz));
      if (kind === "wheel") {
        if (closing < 3.2) return;
      } else if (closing < 0.12 && sum < 0.55) {
        return;
      }
      hits.push({ x: cx * inv, y: cy * inv, z: cz * inv, nx: nnx, ny: nny, nz: nnz, impulse: sum, closing, otherMass });
    });
  }
  return hits;
}

function yieldBody(world: RapierWorld, b: RapierBody, shell: SteelShell, kind: SteelKind) {
  let raw: SteelHit[] = [];
  try {
    raw = collectHits(world, b, kind);
  } catch {
    return;
  }
  if (raw.length === 0) return;
  const reach = kind === "wheel" ? WHEEL.radius * 1.7 + WHEEL.thick : DRUM.radius * 1.7 + DRUM.height;
  const local = raw.some((h) => Math.hypot(h.x, h.y, h.z) > reach) ? worldHitsToLocal(b, raw) : raw;
  const added = applySteelHits(shell, local);
  if (kind === "drum" && added > 0) {
    const col = b.collider(0) as { setHalfHeight?: (h: number) => void; setRadius?: (r: number) => void; setRestitution?: (v: number) => void; setCollisionGroups?: (g: number) => void };
    const ext = steelExtents(shell);
    col.setHalfHeight?.(Math.max(0.03, ext.halfH));
    col.setRadius?.(Math.max(0.08, ext.radius));
    col.setRestitution?.(0);
    if (ext.halfH < 0.09) col.setCollisionGroups?.(interactionGroups([CRATE_G], [WORLD_G, CRATE_G]));
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resetSim(sim: Sim, jitter = 0, seed = 1) {
  const rng = mulberry32(seed);
  const j = jitter
    ? {
        x: (rng() - 0.5) * 2 * jitter,
        y: 0,
        z: (rng() - 0.5) * 2 * jitter,
        vx: (rng() - 0.5) * 2 * jitter,
        vy: (rng() - 0.5) * jitter,
        vz: (rng() - 0.5) * 2 * jitter,
      }
    : { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  poseBody(sim.wheel, sim.wheelRest, j);
  sim.wheel.wakeUp();
  const wantDrums = sim.drumMode === "always";
  for (let i = 0; i < sim.drums.length; i++) {
    const d = sim.drums[i]!;
    poseBody(d, sim.drumRests[i]!);
    d.setEnabled(wantDrums);
  }
  sim.drumsOn = wantDrums;
  sim.world.numSolverIterations = wantDrums ? sim.smashSolver : 4;
  sim.world.numInternalPgsIterations = wantDrums ? sim.smashPgs : 1;
  sim.wheelShell = makeSteelShell("wheel");
  sim.drumShells = sim.drums.map(() => makeSteelShell("drum"));
}

export function runTrial(
  sim: Sim,
  opts?: {
    maxSteps?: number;
    jitter?: number;
    seed?: number;
    yieldHits?: boolean;
    lazyDrums?: boolean;
    trace?: (row: { step: number; x: number; y: number; z: number; speed: number }) => void;
  },
): Trial {
  const maxSteps = opts?.maxSteps ?? 2400;
  const yieldHits = opts?.yieldHits !== false;
  const lazyDrums = opts?.lazyDrums !== false && sim.drumMode !== "always";
  resetSim(sim, opts?.jitter ?? 0, opts?.seed ?? 1);
  if (!lazyDrums && sim.drumMode !== "off") setDrumsEnabled(sim, true);
  let maxSpeed = 0;
  let tFloor: number | null = null;
  let parked = 0;
  let step = 0;
  for (; step < maxSteps; step++) {
    sim.world.step();
    const p = sim.wheel.translation();
    const v = sim.wheel.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > maxSpeed) maxSpeed = speed;
    if (lazyDrums && !sim.drumsOn) {
      let near = false;
      for (const rest of sim.drumRests) {
        const dx = rest.x - p.x;
        const dy = rest.y - p.y;
        const dz = rest.z - p.z;
        if (dx * dx + dy * dy + dz * dz < DRUM_WAKE * DRUM_WAKE) {
          near = true;
          break;
        }
      }
      if (near) setDrumsEnabled(sim, true);
    }
    if (yieldHits && speed >= 3.2) yieldBody(sim.world, sim.wheel, sim.wheelShell, "wheel");
    const lastZ = sim.drumRests.length ? sim.drumRests[sim.drumRests.length - 1]!.z : 400;
    if (tFloor == null && p.z > lastZ + 8 && p.y < 4.5) tFloor = step / 60;
    if (opts?.trace && step % 60 === 0) opts.trace({ step, x: p.x, y: p.y, z: p.z, speed });
    if (yieldHits && sim.drumsOn) {
      const r2 = DRUM_NEAR * DRUM_NEAR;
      for (let i = 0; i < sim.drums.length; i++) {
        const rest = sim.drumRests[i]!;
        const dx = rest.x - p.x;
        const dz = rest.z - p.z;
        if (dx * dx + dz * dz > r2) continue;
        yieldBody(sim.world, sim.drums[i]!, sim.drumShells[i]!, "drum");
      }
    }
    if (p.y < 1.2 && speed < 0.45 && p.z > lastZ) {
      parked += 1;
      if (parked > 18) {
        step += 1;
        break;
      }
    } else parked = 0;
    if (tFloor != null && step / 60 - tFloor >= 2.5) {
      step += 1;
      break;
    }
    if (Math.abs(p.x) > 22 && p.y < 4) {
      step += 1;
      break;
    }
  }
  const p = sim.wheel.translation();
  const v = sim.wheel.linvel();
  let crushed = 0;
  let drumMax = 0;
  let wallX = 0;
  let nWall = 0;
  for (let i = 0; i < sim.drums.length; i++) {
    const dent = sim.drumShells[i]!.maxTaken;
    if (dent > 0.02) crushed += 1;
    if (dent > drumMax) drumMax = dent;
    const dp = sim.drums[i]!.translation();
    wallX += dp.x;
    nWall += 1;
  }
  wallX = nWall ? wallX / nWall : 0;
  return {
    steps: step,
    seconds: step / 60,
    x: p.x,
    y: p.y,
    z: p.z,
    speed: Math.hypot(v.x, v.y, v.z),
    maxSpeed,
    rim: steelRim(sim.wheelShell),
    dent: sim.wheelShell.maxTaken,
    strain: sim.wheelShell.strain,
    drumsCrushed: crushed,
    drumMaxDent: drumMax,
    hitWall: crushed > 0 || (sim.drums.length > 0 && p.z > sim.drumRests[sim.drumRests.length - 1]!.z - 8),
    tFloor,
    wallX,
  };
}

export function stats(xs: number[]) {
  if (xs.length === 0) return { n: 0, mean: 0, median: 0, mode: 0, std: 0, min: 0, max: 0, p05: 0, p95: 0 };
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) >> 1]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
  const min = s[0]!;
  const max = s[n - 1]!;
  const p05 = s[Math.floor((n - 1) * 0.05)]!;
  const p95 = s[Math.floor((n - 1) * 0.95)]!;
  const varsum = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(varsum);
  const bins = new Map<number, number>();
  const width = Math.max(1e-6, (max - min) / Math.min(24, Math.max(4, Math.round(Math.sqrt(n)))));
  for (const x of s) {
    const k = min + Math.floor((x - min) / width) * width;
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  let mode = s[0]!;
  let best = 0;
  for (const [k, c] of bins) {
    if (c > best) {
      best = c;
      mode = k + width / 2;
    }
  }
  return { n, mean, median, mode, std, min, max, p05, p95 };
}

export function summarize(trials: Trial[]) {
  const num = (key: keyof Trial) => trials.map((t) => Number(t[key]));
  return {
    n: trials.length,
    hitWall: trials.filter((t) => t.hitWall).length / trials.length,
    rim: stats(num("rim")),
    dent: stats(num("dent")),
    strain: stats(num("strain")),
    maxSpeed: stats(num("maxSpeed")),
    z: stats(num("z")),
    x: stats(num("x")),
    drumsCrushed: stats(num("drumsCrushed")),
    seconds: stats(num("seconds")),
    tFloor: stats(trials.map((t) => t.tFloor ?? Number.NaN).filter(Number.isFinite)),
  };
}
