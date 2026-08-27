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
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGrab } from "@/components/bay/grab";
import { CRATE_G, DRUM_G, WHEEL_G, WORLD_G } from "@/lib/bay/groups";
import { DRUM, WHEEL } from "@/lib/bay/parts";
import { note, registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";
import {
  applySteelHits,
  makeSteelShell,
  pushSteelHulls,
  refreshSteelMesh,
  sliceHull,
  steelDish,
  steelGeometry,
  steelMeshRim,
  steelRim,
  worldHitsToLocal,
  type SteelKind,
} from "@/lib/bay/yield";

const WHEEL_GROUPS = interactionGroups([WHEEL_G], [WORLD_G, DRUM_G, CRATE_G]);
const DRUM_GROUPS = interactionGroups([DRUM_G], [WORLD_G, DRUM_G, WHEEL_G]);
const WHEEL_MEMBER = 1 << WHEEL_G;
function SteelBody({
  id,
  kind,
  pos,
  rot,
  grip,
  bounce,
  mass,
}: {
  id: string;
  kind: SteelKind;
  pos: [number, number, number];
  rot?: [number, number, number];
  grip?: number;
  bounce?: number;
  mass?: number;
}) {
  const body = useRef<RapierRigidBody>(null);
  const hulls = useRef<Array<RapierCollider | null>>([]);
  const mesh = useRef<THREE.Mesh>(null);
  const grab = useGrab(body, id);
  const pinned = useRef(false);
  const armed = useRef(false);
  const selected = useBay((s) => s.selected === id);
  const { world, rapier } = useRapier();
  const spec = kind === "wheel" ? WHEEL : DRUM;
  const kg = mass ?? spec.mass;
  const mu = grip ?? (kind === "wheel" ? 0.72 : 0.48);
  const rest = bounce ?? 0.03;
  const groups = kind === "wheel" ? WHEEL_GROUPS : DRUM_GROUPS;
  const shell = useMemo(() => makeSteelShell(kind), [kind]);
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
          yield: true,
        }),
      () => body.current,
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

  useFrame((state, dt) => {
    grab.tick(state.raycaster.ray, Math.min(dt, 0.05));
    const b = body.current;
    if (!b) return;
    if (!pinned.current) {
      setBodyMass(b, kg);
      pinned.current = true;
    }
    if (!armed.current) {
      const n = b.numColliders();
      for (let i = 0; i < n; i++) {
        const c = b.collider(i);
        if (!c) continue;
        c.setContactForceEventThreshold(0.08);
      }
      armed.current = true;
    }
    if (shell.maxTaken > 0) {
      refreshSteelMesh(geo, shell.live);
      const drawn = mesh.current;
      if (drawn && drawn.geometry !== geo) drawn.geometry = geo;
    }
  });

  useAfterPhysicsStep(() => {
    const b = body.current;
    if (!b || b.numColliders() === 0) return;
    let raw: ReturnType<typeof collectHits> = [];
    try {
      raw = collectHits(world, b, kind);
    } catch {
      return;
    }
    if (raw.length === 0) return;
    const reach = kind === "wheel" ? WHEEL.radius * 1.7 + WHEEL.thick : DRUM.radius * 1.7 + DRUM.height;
    const local = raw.some((h) => Math.hypot(h.x, h.y, h.z) > reach) ? worldHitsToLocal(b, raw) : raw;
    const added = applySteelHits(shell, local);
    if (added <= 0) return;
    refreshSteelMesh(geo, shell.live);
    const drawn = mesh.current;
    if (drawn) {
      drawn.geometry = geo;
      drawn.frustumCulled = false;
    }
    if (kind === "wheel") {
      pushSteelHulls(shell, hulls.current, rapier.ConvexPolyhedron, hullArgs);
      setBodyMass(b, kg);
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
      mass={kg}
      friction={mu}
      restitution={rest}
      linearDamping={kind === "wheel" ? 0.004 : 0.04}
      angularDamping={kind === "wheel" ? 0.008 : 0.06}
      collisionGroups={groups}
      canSleep={kind !== "wheel"}
      ccd={kind === "wheel"}
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
              collisionGroups={groups}
              friction={mu}
              restitution={rest}
            />
          ))
        : (
            <CylinderCollider
              args={[DRUM.height / 2, DRUM.radius]}
              collisionGroups={groups}
              friction={mu}
              restitution={rest}
            />
          )}
      <mesh ref={mesh} geometry={geo} onPointerDown={grab.down} castShadow frustumCulled={false}>
        <meshStandardMaterial
          color={color}
          vertexColors
          flatShading
          metalness={kind === "wheel" ? 0.34 : 0.28}
          roughness={kind === "wheel" ? 0.58 : 0.64}
          side={THREE.DoubleSide}
        />
      </mesh>
      {kind === "wheel" ? <WheelBits half={WHEEL.thick / 2} /> : <DrumBits half={DRUM.height / 2} />}
    </RigidBody>
  );
}

function collectHits(world: { contactPairsWith: Function; contactPair: Function }, b: RapierRigidBody, kind: SteelKind) {
  const hits: { x: number; y: number; z: number; nx: number; ny: number; nz: number; impulse: number }[] = [];
  const n = b.numColliders();
  const seen = new Set<number>();
  const v = b.linvel();
  for (let i = 0; i < n; i++) {
    const c = b.collider(i);
    if (!c) continue;
    world.contactPairsWith(c, (other: RapierCollider) => {
      const ob = other.parent();
      if (!ob || ob.handle === b.handle || ob.isFixed()) return;
      if (seen.has(ob.handle)) return;
      seen.add(ob.handle);
      if (kind === "drum") {
        const mem = other.collisionGroups() >>> 16;
        if ((mem & WHEEL_MEMBER) === 0) return;
      }
      const ov = ob.linvel();
      const closing = Math.hypot(v.x - ov.x, v.y - ov.y, v.z - ov.z);
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
            },
          );
        }
      }
      if (sum < 0.08) return;
      if (closing < 0.12 && sum < 0.55) return;
      const inv = 1 / sum;
      const nl = Math.hypot(nx, ny, nz) || 1;
      hits.push({ x: cx * inv, y: cy * inv, z: cz * inv, nx: nx / nl, ny: ny / nl, nz: nz / nl, impulse: sum });
    });
  }
  return hits;
}

function WheelBits({ half }: { half: number }) {
  return (
    <mesh>
      <cylinderGeometry args={[0.028, 0.028, half * 2 + 0.03, 8]} />
      <meshStandardMaterial color={0x8a8478} metalness={0.45} roughness={0.5} />
    </mesh>
  );
}

function DrumBits({ half }: { half: number }) {
  const rim = 0x2f332c;
  return (
    <group>
      <mesh position={[0, half * 0.12, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.028, 10]} />
        <meshStandardMaterial color={rim} metalness={0.62} roughness={0.4} />
      </mesh>
      <mesh position={[0.055, half * 0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.014, 8]} />
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
