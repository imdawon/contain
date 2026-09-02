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
const DRUM_FLAT_GROUPS = interactionGroups([DRUM_G], [WORLD_G, DRUM_G]);
const WHEEL_MEMBER = 1 << WHEEL_G;
let lastWheelZ = 0;
let lastWheelGrounded = 0;
const lastContactAt = new Map<string, number>();

type CrushCol = RapierCollider & {
  raw?: () => CrushCol;
  setHalfHeight?: (h: number) => void;
  setRadius?: (r: number) => void;
  setRestitution?: (v: number) => void;
  setCollisionGroups?: (g: number) => void;
};

function crushDrumCollider(col: RapierCollider | null, halfH: number, radius: number, flat: boolean) {
  if (!col) return;
  const wrapped = col as CrushCol;
  const raw = wrapped.raw?.() ?? wrapped;
  try {
    raw.setHalfHeight?.(Math.max(0.028, halfH));
    raw.setRadius?.(Math.max(0.16, radius));
    raw.setRestitution?.(0);
    if (flat) raw.setCollisionGroups?.(DRUM_FLAT_GROUPS);
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
    setBodyMass(b, kg, kind);
    if (vel) {
      b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
      b.wakeUp();
    }
    pinned.current = true;
  }, [kg, kind, stageN, vel]);

  useFrame((state, dt) => {
    grab.tick(state.raycaster.ray, Math.min(dt, 0.05));
    const b = body.current;
    if (!b) return;
    if (!pinned.current) {
      setBodyMass(b, kg, kind);
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
    if (kind === "wheel" && hangarTrack) {
      const w = b.angvel();
      const v = b.linvel();
      const q = b.rotation();
      const ax = 2 * (q.x * q.y - q.w * q.z);
      const ay = 1 - 2 * (q.x * q.x + q.z * q.z);
      const az = 2 * (q.y * q.z + q.w * q.x);
      const roll = w.x * ax + w.y * ay + w.z * az;
      const speed = Math.hypot(v.x, v.y, v.z);
      const maxW = speed / Math.max(0.2, WHEEL.radius) + 0.4;
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
    let added = 0;
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
      const forYield = raw.filter(
        (h) => h.closing >= SFX.hit.minClosing && (h.otherMass >= 4000 || !Number.isFinite(h.otherMass)),
      );
      if (forYield.length > 0) {
        const reach = WHEEL.radius * 1.7 + WHEEL.thick;
        const local = forYield.some((h) => Math.hypot(h.x, h.y, h.z) > reach) ? worldHitsToLocal(b, forYield) : forYield;
        added += applySteelHits(shell, local);
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
      pushSteelHulls(shell, hulls.current, rapier.ConvexPolyhedron, hullArgs);
      setBodyMass(b, kg, kind);
    } else {
      const ext = steelExtents(shell);
      crushDrumCollider(hulls.current[0] ?? null, ext.halfH, ext.radius, shell.maxTaken >= 0.4);
    }
    b.wakeUp();
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
      position={pos}
      rotation={rot ?? [0, 0, 0]}
      colliders={false}
      friction={mu}
      restitution={rest}
      linearDamping={kind === "wheel" ? 0.004 : 0.05}
      angularDamping={kind === "wheel" ? 0.08 : 0.12}
      collisionGroups={groups}
      canSleep={kind !== "wheel"}
      ccd={Boolean(vel)}
      enabledRotations={[true, true, true]}
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
      {kind === "wheel" ? (
        <mesh geometry={geo} scale={1.055} frustumCulled={false} userData={{ labSkip: true }}>
          <meshBasicMaterial color="#000000" side={THREE.FrontSide} toneMapped={false} fog={false} />
        </mesh>
      ) : null}
      <mesh ref={mesh} geometry={geo} onPointerDown={grab.down} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial
          color={color}
          vertexColors
          flatShading={kind === "wheel"}
          metalness={kind === "wheel" ? 0.42 : 0.55}
          roughness={kind === "wheel" ? 0.5 : 0.38}
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
