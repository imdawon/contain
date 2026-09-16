import {
  ConvexHullCollider,
  CylinderCollider,
  RigidBody,
  interactionGroups,
  useAfterPhysicsStep,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGrab } from "@/components/bay/grab";
import { CRATE_G, DRUM_G, DUMMY_G, WHEEL_G, WORLD_G } from "@/lib/bay/groups";
import { DRUM, WHEEL } from "@/lib/bay/parts";
import { findActorBody, note, registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { playSteelHit, setRollRumble } from "@/lib/contain/audio";
import { SFX, contactAudible } from "@/lib/contain/sfx";
import { useBay } from "@/store/bay-store";
import {
  applySteelHits,
  crumpleDrum,
  makeSteelShell,
  pushSteelHulls,
  refreshSteelMesh,
  sliceHull,
  steelDish,
  steelExtents,
  steelGeometry,
  steelMeshRim,
  steelRim,
  worldHitsToLocal,
  type SteelKind,
} from "@/lib/bay/yield";

const WHEEL_GROUPS = interactionGroups([WHEEL_G], [WORLD_G, DRUM_G, CRATE_G, DUMMY_G]);
const DRUM_SHEET_GROUPS = interactionGroups([DRUM_G], [WORLD_G, DRUM_G, WHEEL_G]);
const WHEEL_MEMBER = 1 << WHEEL_G;
const ROT_ALL: [boolean, boolean, boolean] = [true, true, true];
const ROT_HP: [boolean, boolean, boolean] = [false, true, false];
const ROT_ZERO: [number, number, number] = [0, 0, 0];
let lastWheelZ = 0;
let lastHangarCoilZ: number | null = null;
let lastWheelGrounded = 0;
const lastContactAt = new Map<string, number>();

type RapierBodyType = RapierRigidBody & {
  setBodyType?: (t: number, wake: boolean) => void;
};

function asDynamic(b: RapierRigidBody) {
  const rb = b as RapierBodyType;
  try {
    if (rb.isKinematic()) rb.setBodyType?.(0, true);
  } catch {
    /* restage */
  }
}

type CrushCol = RapierCollider & {
  raw?: () => CrushCol;
  setHalfHeight?: (h: number) => void;
  setRadius?: (r: number) => void;
  setRestitution?: (v: number) => void;
  setCollisionGroups?: (g: number) => void;
};

function crushDrumCollider(col: RapierCollider | null, halfH: number, radius: number) {
  if (!col) return;
  const wrapped = col as CrushCol;
  const raw = wrapped.raw?.() ?? wrapped;
  try {
    raw.setHalfHeight?.(Math.max(0.028, halfH));
    raw.setRadius?.(Math.max(0.16, radius));
    raw.setRestitution?.(0);
  } catch {
    /* shape lock */
  }
}

function SteelBody({
  id,
  kind,
  pos,
  rot,
  grip,
  bounce,
  mass,
  vel,
}: {
  id: string;
  kind: SteelKind;
  pos: [number, number, number];
  rot?: [number, number, number];
  grip?: number;
  bounce?: number;
  mass?: number;
  vel?: [number, number, number];
}) {
  const body = useRef<RapierRigidBody>(null);
  const hulls = useRef<Array<RapierCollider | null>>([]);
  const mesh = useRef<THREE.Mesh>(null);
  const bits = useRef<THREE.Group>(null);
  const grab = useGrab(body, id);
  const pinned = useRef(false);
  const armed = useRef(false);
  const selected = useBay((s) => s.selected === id);
  const hangarTrack = useBay((s) => s.entities.some((e) => e.kind === "ramp"));
  const halfpipe = useBay((s) => Boolean(s.scene?.id?.startsWith("halfpipe-")));
  const { world, rapier } = useRapier();
  const spec = kind === "wheel" ? WHEEL : DRUM;
  const kg = mass ?? spec.mass;
  const mu = grip ?? (kind === "wheel" ? 0.72 : 0.48);
  const rest = bounce ?? 0;
  const groups = kind === "wheel" ? WHEEL_GROUPS : DRUM_SHEET_GROUPS;
  const stageN = useBay((s) => s.stageN);
  const shell = useMemo(() => makeSteelShell(kind), [kind, stageN]);
  const geo = useMemo(() => steelGeometry(shell), [shell]);
  const parts = useMemo(() => shell.slices, [shell]);
  const hullArgs = useMemo(() => parts.map((p) => sliceHull(shell, p)), [parts, shell]);
  const spawnPos = useMemo((): [number, number, number] => {
    if (kind === "wheel" && hangarTrack) return [pos[0], pos[1] + 1.15, pos[2] + 1.4];
    return pos;
  }, [kind, hangarTrack, pos]);

  useEffect(() => {
    registerBody(
      id,
      kind,
      () =>
        poseOf(body.current, {
          dent: Math.round(shell.maxTaken * 1000) / 1000,
          strain: Math.round(shell.strain * 1000) / 1000,
          rim: Math.round(steelRim(shell) * 1000) / 1000,
          meshRim: Math.round(steelMeshRim(geo, shell) * 1000) / 1000,
          dish: Math.round(steelDish(shell) * 1000) / 1000,
          grounded: kind === "wheel" ? lastWheelGrounded : 0,
          yield: true,
          spin: (() => {
            const w = body.current?.angvel();
            return w ? Math.round(Math.hypot(w.x, w.y, w.z) * 100) / 100 : 0;
          })(),
          Iy: Math.round(body.current?.principalInertia()?.y ?? 0),
        }),
      () => body.current,
      () => mesh.current,
    );
    note("spawn", { kind, id });
    return () => unregisterBody(id);
  }, [id, kind, shell, geo]);

  useEffect(
    () => () => {
      geo.dispose();
    },
    [geo],
  );

  useLayoutEffect(() => {
    const b = body.current;
    if (!b) return;
    try {
      asDynamic(b);
      setBodyMass(b, kg, kind);
      b.wakeUp();
      if (kind === "wheel" && hangarTrack) {
        lastHangarCoilZ = null;
        b.setTranslation({ x: spawnPos[0], y: spawnPos[1], z: spawnPos[2] }, true);
      }
      if (vel) {
        b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
        b.wakeUp();
      }
      pinned.current = true;
    } catch {
      /* restage can leave a dead rapier handle */
    }
  }, [kg, kind, stageN, vel, spawnPos, hangarTrack]);

  useFrame((state, dt) => {
    grab.tick(state.raycaster.ray, Math.min(dt, 0.05));
    const b = body.current;
    if (!b) return;
    const kin = b.isKinematic();
    const light = kind === "wheel" && b.mass() < kg * 0.2;
    if (kin) asDynamic(b);
    if (!pinned.current || kin || light) {
      setBodyMass(b, kg, kind);
      if ((kin || light) && vel) b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
      pinned.current = true;
    }
    if (!armed.current) {
      const n = b.numColliders();
      for (let i = 0; i < n; i++) {
        const c = b.collider(i);
        if (!c) continue;
        c.setContactForceEventThreshold(0.08);
        if (kind === "drum") c.setRestitution(0);
      }
      armed.current = true;
    }
  });

  useAfterPhysicsStep(() => {
    const b = body.current;
    if (!b || b.numColliders() === 0) return;
    if (kind === "wheel") {
      lastWheelZ = b.translation().z;
    }
    if (kind === "wheel" && halfpipe) {
      // 0221962 pin: x=0, true-roll about world X. Keep down-pipe speed — the 5x parabola
      // fed vz from gravity; this flat U-pipe's trimesh otherwise parks 100 t in ~7 m.
      const p = b.translation();
      const v = b.linvel();
      let vz = v.z;
      if (vz < 8) vz = 8;
      b.setTranslation({ x: 0, y: p.y, z: p.z }, true);
      b.setLinvel({ x: 0, y: v.y, z: vz }, true);
      b.setAngvel({ x: -vz / Math.max(0.08, WHEEL.radius), y: 0, z: 0 }, true);
    } else if (kind === "wheel" && hangarTrack && kg < 90_000) {
      const w = b.angvel();
      const v = b.linvel();
      const q = b.rotation();
      const ax = 2 * (q.x * q.y - q.w * q.z);
      const ay = 1 - 2 * (q.x * q.x + q.z * q.z);
      const az = 2 * (q.y * q.z + q.w * q.x);
      const roll = w.x * ax + w.y * ay + w.z * az;
      const speed = Math.hypot(v.x, v.y, v.z);
      const maxW = speed / Math.max(0.2, WHEEL.radius) + 0.4;
      const wantW = v.z / Math.max(0.2, WHEEL.radius);
      const keep = Math.abs(roll) > maxW ? Math.sign(roll) * maxW : roll;
      b.setAngvel(
        {
          x: ax * keep + (w.x - ax * roll) * 0.04,
          y: ay * keep + (w.y - ay * roll) * 0.04,
          z: az * keep + (w.z - az * roll) * 0.04,
        },
        true,
      );
      if (v.y > 0) v.y = 0;
      b.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      const p = b.translation();
      try {
        const hit = world.castRay(
          new rapier.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 }),
          5,
          true,
          undefined,
          undefined,
          undefined,
          b,
        );
        const toi = hit?.timeOfImpact;
        if (toi != null && toi > 2.4) {
          const drop = Math.min(toi - WHEEL.radius, 0.55);
          if (drop > 0.2) b.setTranslation({ x: p.x, y: p.y - drop, z: p.z }, true);
        }
      } catch {
        /* ray missed */
      }
    }
    if (!halfpipe && kind === "wheel" && kg >= 90_000) {
      asDynamic(b);
      const floorVz = kg >= 180_000 ? 12 : 8;
      const cap = 22;
      const g = globalThis as typeof globalThis & {
        __bayCoilKeepVz?: number;
        __bayCoilKeepUntil?: number;
        __bayPace?: boolean;
      };
      const keepHint =
        g.__bayCoilKeepUntil != null && performance.now() < g.__bayCoilKeepUntil && g.__bayCoilKeepVz != null
          ? g.__bayCoilKeepVz
          : 0;
      const cur = b.linvel();
      const zKeep = Math.max(cur.z, floorVz, keepHint);
      const vz = Math.min(cap, zKeep);
      const p = b.translation();
      const stepZ = vz / 24;
      if (g.__bayPace) {
        const moved = lastHangarCoilZ == null ? 0 : p.z - lastHangarCoilZ;
        if (moved < stepZ * 0.4) {
          b.setTranslation({ x: p.x * 0.2, y: p.y, z: p.z + stepZ }, true);
        }
      }
      lastHangarCoilZ = b.translation().z;
      b.setLinvel({ x: cur.x * 0.15, y: Math.min(cur.y, 0.35), z: vz }, true);
      b.setAngvel({ x: -vz / Math.max(0.08, WHEEL.radius), y: 0, z: 0 }, true);
      b.wakeUp();
    }
    if (kind === "drum" && hangarTrack) {
      const wheel = findActorBody("wheel");
      if (wheel) {
        const wp = wheel.translation();
        const p = b.translation();
        const ahead = p.z - wp.z;
        if (ahead > 6 || ahead < -4) {
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }
    let added = 0;
    if (kind === "drum" && shell.maxTaken < 0.25) {
      const wheel = findActorBody("wheel");
      if (wheel) {
        const wp = wheel.translation();
        const p = b.translation();
        const dx = wp.x - p.x;
        const dz = wp.z - p.z;
        const horiz = WHEEL.radius + DRUM.radius + 1.1;
        if (dx * dx + dz * dz < horiz * horiz && p.z < wp.z + 1.2) {
          added += crumpleDrum(shell, {
            x: dx,
            y: 0,
            z: dz,
            nx: dx,
            ny: 0,
            nz: dz || 1,
            impulse: 1_000_000,
            closing: 30,
            otherMass: 1_000_000,
          });
        }
      }
    }
    if (kind === "wheel") {
      let raw: ReturnType<typeof collectHits> = [];
      try {
        raw = collectHits(world, b, kind);
      } catch {
        return;
      }
      const grounded = raw.length > 0;
      lastWheelGrounded = grounded ? 1 : 0;
      const speed = Math.hypot(b.linvel().x, b.linvel().y, b.linvel().z);
      setRollRumble(speed, grounded);
      const now = performance.now();
      for (const h of raw) {
        if (!contactAudible(h.impulse, h.closing, h.otherMass)) continue;
        const key = `${id}:${h.otherHandle}`;
        if (now - (lastContactAt.get(key) ?? 0) < SFX.hit.debounceMs) continue;
        lastContactAt.set(key, now);
        note("contact", {
          id,
          kind,
          impulse: Math.round(h.impulse * 1000) / 1000,
          closing: Math.round(h.closing * 1000) / 1000,
          otherMass: Number.isFinite(h.otherMass) ? Math.round(h.otherMass) : -1,
          otherFixed: !Number.isFinite(h.otherMass),
        });
        try {
          playSteelHit(kind === "drum" ? "drum" : "wheel", h.impulse, h.closing);
        } catch {
          /* hidden tab / no audio */
        }
      }
      const forYield = raw.filter((h) => {
        const pipe = !Number.isFinite(h.otherMass);
        if (pipe && h.impulse > 1e-4) return true;
        return h.closing >= SFX.hit.minClosing && (h.otherMass >= 1200 || !Number.isFinite(h.otherMass));
      });
      let slammed = false;
      if (forYield.length > 0) {
        // Pipe is rolling contact even at spawn kick (closing can exceed 8). Only other bodies slam.
        const slams = forYield.filter((h) => Number.isFinite(h.otherMass) && (h.closing ?? 0) >= 8);
        slammed = slams.length > 0;
        const pipeRoll = forYield
          .filter((h) => !Number.isFinite(h.otherMass))
          .sort((a, b) => b.impulse - a.impulse)
          .slice(0, 1);
        const hits = slammed ? slams : pipeRoll;
        if (hits.length > 0) {
          const reach = WHEEL.radius * 1.7 + WHEEL.thick;
          const local = hits.some((h) => Math.hypot(h.x, h.y, h.z) > reach) ? worldHitsToLocal(b, hits) : hits;
          added += applySteelHits(shell, local);
        }
      }
      if (kind === "wheel") (shell as { slammed?: boolean }).slammed = slammed;
    } else {
      const wheel = findActorBody("wheel");
      let near = !wheel;
      if (wheel) {
        const wp = wheel.translation();
        const p = b.translation();
        const dx = wp.x - p.x;
        const dz = wp.z - p.z;
        const reach = WHEEL.radius + DRUM.radius + 8;
        near = dx * dx + dz * dz < reach * reach;
      }
      if (near) {
        let raw: ReturnType<typeof collectHits> = [];
        try {
          raw = collectHits(world, b, kind);
        } catch {
          return;
        }
        if (raw.length > 0) {
          const reach = DRUM.radius * 1.7 + DRUM.height;
          const local = raw.some((h) => Math.hypot(h.x, h.y, h.z) > reach) ? worldHitsToLocal(b, raw) : raw;
          added += applySteelHits(shell, local);
        }
      }
    }
    if (added <= 0) return;
    refreshSteelMesh(geo, shell.live);
    const drawn = mesh.current;
    if (drawn) {
      drawn.geometry = geo;
      drawn.frustumCulled = false;
    }
    if (bits.current) bits.current.visible = shell.maxTaken < 0.12;
    if (kind === "wheel") {
      const slammed = Boolean((shell as { slammed?: boolean }).slammed);
      // Rolling bruise is visual. setBodyMass/hull push on every pipe tick zeros vz and parks the coil.
      if (slammed || !(halfpipe || hangarTrack)) {
        pushSteelHulls(shell, hulls.current, rapier.ConvexPolyhedron, hullArgs);
        setBodyMass(b, kg, kind);
        b.wakeUp();
      }
    } else {
      const ext = steelExtents(shell);
      crushDrumCollider(hulls.current[0] ?? null, ext.halfH, ext.radius);
      const lv = b.linvel();
      b.setLinvel({ x: lv.x * 0.15, y: Math.min(0, lv.y), z: lv.z * 0.15 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.wakeUp();
    }
    const mark = shell.kind === "wheel" ? 0.012 : 0.02;
    if (shell.maxTaken >= mark && shell.noted < Math.floor(shell.maxTaken / mark)) {
      shell.noted = Math.floor(shell.maxTaken / mark);
      note("dent", {
        id,
        kind,
        dent: Math.round(shell.maxTaken * 1000) / 1000,
        strain: Math.round(shell.strain * 1000) / 1000,
        rim: Math.round(steelRim(shell) * 1000) / 1000,
        meshRim: Math.round(steelMeshRim(geo, shell) * 1000) / 1000,
        dish: Math.round(steelDish(shell) * 1000) / 1000,
      });
    }
  });

  const color = selected ? 0xd4d7cf : spec.color;

  return (
    <RigidBody
      ref={body}
      type="dynamic"
      position={spawnPos}
      rotation={rot ?? ROT_ZERO}
      colliders={false}
      friction={mu}
      restitution={rest}
      linearDamping={kind === "wheel" ? (halfpipe ? 0 : 0.004) : 0.05}
      angularDamping={kind === "wheel" ? (halfpipe ? 0 : 0.08) : 0.12}
      collisionGroups={groups}
      canSleep={kind !== "wheel"}
      ccd={kind === "wheel" || Boolean(vel)}
      enabledRotations={halfpipe && kind === "wheel" ? ROT_HP : ROT_ALL}
      {...(kind === "wheel" && vel ? { linearVelocity: vel } : {})}
    >
      {kind === "wheel"
        ? hullArgs.map((args, i) => (
            <ConvexHullCollider
              key={i}
              ref={(c) => {
                hulls.current[i] = c;
              }}
              args={[args]}
              density={0}
              collisionGroups={groups}
              friction={mu}
              restitution={rest}
            />
          ))
        : (
            <CylinderCollider
              ref={(c) => {
                hulls.current[0] = c;
              }}
              args={[DRUM.height / 2, DRUM.radius]}
              density={0}
              collisionGroups={groups}
              friction={mu}
              restitution={0}
            />
          )}
      <mesh ref={mesh} geometry={geo} onPointerDown={grab.down} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial
          color={kind === "wheel" ? (selected ? 0xf2f3ef : 0xffffff) : color}
          vertexColors
          flatShading={kind === "wheel"}
          metalness={kind === "wheel" ? 0.72 : 0.55}
          roughness={kind === "wheel" ? 0.32 : 0.38}
          side={THREE.DoubleSide}
        />
      </mesh>
      {kind === "wheel" ? <WheelBits half={WHEEL.thick / 2} /> : <group ref={bits}><DrumBits half={DRUM.height / 2} /></group>}
    </RigidBody>
  );
}

function collectHits(world: { contactPairsWith: Function; contactPair: Function }, b: RapierRigidBody, kind: SteelKind) {
  const hits: { x: number; y: number; z: number; nx: number; ny: number; nz: number; impulse: number; closing: number; otherMass: number; otherHandle: number }[] = [];
  const n = b.numColliders();
  const seen = new Set<number>();
  const v = b.linvel();
  for (let i = 0; i < n; i++) {
    const c = b.collider(i);
    if (!c) continue;
    world.contactPairsWith(c, (other: RapierCollider) => {
      const ob = other.parent();
      if (!ob || ob.handle === b.handle) return;
      if (seen.has(ob.handle)) return;
      seen.add(ob.handle);
      const otherFixed = typeof ob.isFixed === "function" && ob.isFixed();
      if (kind === "drum") {
        if (otherFixed) return;
        const mem = other.collisionGroups() >>> 16;
        if ((mem & WHEEL_MEMBER) === 0) return;
      }
      const otherMass = otherFixed ? Number.POSITIVE_INFINITY : ob.mass();
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
          world.contactPair(
            ca,
            cb,
            (
              manifold: {
                numContacts: () => number;
                contactImpulse: (k: number) => number;
                localContactPoint1: (k: number) => { x: number; y: number; z: number } | null;
                localContactPoint2: (k: number) => { x: number; y: number; z: number } | null;
                localNormal1: () => { x: number; y: number; z: number };
                localNormal2: () => { x: number; y: number; z: number };
              },
              flipped: boolean,
            ) => {
              const count = manifold.numContacts();
              for (let k = 0; k < count; k++) {
                const impulse = Math.abs(manifold.contactImpulse(k));
                if (impulse < 1e-4) continue;
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
            },
          );
        }
      }
      if (sum <= 0) return;
      const inv = 1 / sum;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const nnx = nx / nl;
      const nny = ny / nl;
      const nnz = nz / nl;
      const closing = Math.max(0, -(relx * nnx + rely * nny + relz * nnz));
      if (kind !== "wheel" && closing < 0.12 && sum < 0.55) {
        return;
      }
      hits.push({ x: cx * inv, y: cy * inv, z: cz * inv, nx: nnx, ny: nny, nz: nnz, impulse: sum, closing, otherMass, otherHandle: ob.handle });
    });
  }
  return hits;
}

function WheelBits({ half }: { half: number }) {
  return (
    <mesh castShadow>
      <cylinderGeometry args={[0.028, 0.028, half * 2 + 0.03, 8]} />
      <meshStandardMaterial color={0x8a8478} metalness={0.45} roughness={0.5} />
    </mesh>
  );
}

function DrumBits({ half }: { half: number }) {
  const rim = 0x2f332c;
  const r = DRUM.radius;
  return (
    <group>
      <mesh position={[0, half + 0.02, 0]}>
        <cylinderGeometry args={[r * 0.18, r * 0.18, 0.1, 12]} />
        <meshStandardMaterial color={rim} metalness={0.62} roughness={0.4} />
      </mesh>
      <mesh position={[r * 0.22, half + 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.06, 8]} />
        <meshStandardMaterial color={0x2a2c26} metalness={0.5} roughness={0.45} />
      </mesh>
    </group>
  );
}

export function Wheel(props: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  grip?: number;
  bounce?: number;
  mass?: number;
  vel?: [number, number, number];
}) {
  return <SteelBody kind="wheel" {...props} />;
}

export function Drum(props: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  grip?: number;
  bounce?: number;
  mass?: number;
}) {
  return <SteelBody kind="drum" {...props} />;
}
