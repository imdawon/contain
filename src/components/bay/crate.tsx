import {
  CuboidCollider,
  RigidBody,
  useFixedJoint,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import { useGrab } from "@/components/bay/grab";
import { CRATE } from "@/lib/bay/parts";
import { note, registerAssembly, registerBody, setBodyMass, unregisterAssembly, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { playEvent } from "@/lib/contain/audio";

const Q = [0, 0, 0, 1] as [number, number, number, number];
const ply = 0x8a6a3e;
const plyLid = 0x9a7a48;

function Panel({
  r,
  id,
  pos,
  size,
  mass,
  color,
}: {
  r: RefObject<RapierRigidBody>;
  id: string;
  pos: [number, number, number];
  size: [number, number, number];
  mass: number;
  color: number;
}) {
  const grab = useGrab(r, id);
  const pinned = useRef(false);

  useEffect(() => {
    registerBody(id, "crate-panel", () => poseOf(r.current, { parent: id.split("-")[0] ?? null }), () => r.current);
    return () => unregisterBody(id);
  }, [id, r]);

  useFrame((state, dt) => {
    grab.tick(state.raycaster.ray, Math.min(dt, 0.05));
    const b = r.current;
    if (!b || pinned.current) return;
    setBodyMass(b, mass);
    pinned.current = true;
  });

  const [sx, sy, sz] = size;
  return (
    <RigidBody
      ref={r}
      position={pos}
      colliders={false}
      mass={mass}
      friction={0.55}
      restitution={0.08}
      linearDamping={0.4}
      angularDamping={0.35}
      ccd
    >
      <CuboidCollider args={[sx / 2, sy / 2, sz / 2]} />
      <mesh onPointerDown={grab.down}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.82} metalness={0.04} />
      </mesh>
    </RigidBody>
  );
}

export function Crate({ id, pos }: { id: string; pos: [number, number, number] }) {
  const { w, h, d, wall: t, lid: lh, floorMass, wallMass, lidMass } = CRATE;
  const floor = useRef<RapierRigidBody>(null!);
  const left = useRef<RapierRigidBody>(null!);
  const right = useRef<RapierRigidBody>(null!);
  const back = useRef<RapierRigidBody>(null!);
  const front = useRef<RapierRigidBody>(null!);
  const lid = useRef<RapierRigidBody>(null!);
  const { world } = useRapier();
  const gone = useRef(false);

  const jL = useFixedJoint(floor, left, [
    [-w / 2 + t / 2, t / 2, 0],
    Q,
    [0, -h / 2, 0],
    Q,
  ]);
  const jR = useFixedJoint(floor, right, [
    [w / 2 - t / 2, t / 2, 0],
    Q,
    [0, -h / 2, 0],
    Q,
  ]);
  const jB = useFixedJoint(floor, back, [
    [0, t / 2, -d / 2 + t / 2],
    Q,
    [0, -h / 2, 0],
    Q,
  ]);
  const jF = useFixedJoint(floor, front, [
    [0, t / 2, d / 2 - t / 2],
    Q,
    [0, -h / 2, 0],
    Q,
  ]);
  const jLid = useFixedJoint(floor, lid, [
    [0, h + lh / 2 + t / 2, 0],
    Q,
    [0, 0, 0],
    Q,
  ]);

  useEffect(() => {
    registerAssembly(id, [`${id}-floor`, `${id}-left`, `${id}-right`, `${id}-back`, `${id}-front`, `${id}-lid`]);
    return () => unregisterAssembly(id);
  }, [id]);

  useEffect(() => {
    const onBlast = (ev: Event) => {
      if (gone.current) return;
      const { x, y, z, power } = (ev as CustomEvent<{ x: number; y: number; z: number; power: number }>).detail;
      const f = floor.current;
      if (!f) return;
      const p = f.translation();
      const dist = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (dist > 1.6 || power < 5) return;
      gone.current = true;
      unregisterAssembly(id);
      for (const j of [jL, jR, jB, jF, jLid]) {
        if (j.current) world.removeImpulseJoint(j.current, true);
      }
      note("crate-break", { id, dist, power });
      playEvent("lid", "nmc");
    };
    window.addEventListener("bay-blast", onBlast, true);
    return () => window.removeEventListener("bay-blast", onBlast, true);
  }, [id, world, jL, jR, jB, jF, jLid]);

  const floorY = t / 2;
  const wallY = t + h / 2;
  const lidY = t + h + lh / 2;

  return (
    <group position={pos}>
      <Panel r={floor} id={`${id}-floor`} pos={[0, floorY, 0]} size={[w, t, d]} mass={floorMass} color={ply} />
      <Panel r={left} id={`${id}-left`} pos={[-w / 2 + t / 2, wallY, 0]} size={[t, h, d]} mass={wallMass} color={ply} />
      <Panel r={right} id={`${id}-right`} pos={[w / 2 - t / 2, wallY, 0]} size={[t, h, d]} mass={wallMass} color={ply} />
      <Panel r={back} id={`${id}-back`} pos={[0, wallY, -d / 2 + t / 2]} size={[w, h, t]} mass={wallMass} color={ply} />
      <Panel r={front} id={`${id}-front`} pos={[0, wallY, d / 2 - t / 2]} size={[w, h, t]} mass={wallMass} color={ply} />
      <Panel r={lid} id={`${id}-lid`} pos={[0, lidY, 0]} size={[w + 0.02, lh, d + 0.02]} mass={lidMass} color={plyLid} />
    </group>
  );
}
