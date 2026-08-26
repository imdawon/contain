import {
  CuboidCollider,
  RigidBody,
  interactionGroups,
  useRevoluteJoint,
  useSphericalJoint,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useGrab } from "@/components/bay/grab";
import { DUMMY } from "@/lib/bay/parts";
import { note, registerAssembly, registerBody, setBodyMass, unregisterAssembly, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";

/** World 0, dummy 1, crate 2. Bones skip each other; they still hit floor/crate/charge. */
const GROUPS = interactionGroups([1], [0, 2]);
const bone = 0xc4b8a8;
const jointCol = 0x6a5348;
type BodyType = "dynamic" | "kinematicPosition";

function Ball({
  a,
  b,
  pa,
  pb,
}: {
  a: RefObject<RapierRigidBody>;
  b: RefObject<RapierRigidBody>;
  pa: [number, number, number];
  pb: [number, number, number];
}) {
  useSphericalJoint(a, b, [pa, pb]);
  return null;
}

function Hinge({
  a,
  b,
  pa,
  pb,
  axis,
  lim,
}: {
  a: RefObject<RapierRigidBody>;
  b: RefObject<RapierRigidBody>;
  pa: [number, number, number];
  pb: [number, number, number];
  axis: [number, number, number];
  lim: [number, number];
}) {
  useRevoluteJoint(a, b, [pa, pb, axis, lim]);
  return null;
}

function Bone({
  r,
  id,
  pos,
  size,
  mass,
  type,
  linearDamping,
  angularDamping,
  color = bone,
  children,
}: {
  r: RefObject<RapierRigidBody>;
  id: string;
  pos: [number, number, number];
  size: [number, number, number];
  mass: number;
  type: BodyType;
  linearDamping: number;
  angularDamping: number;
  color?: number;
  children?: ReactNode;
}) {
  const grab = useGrab(r, id);
  const pinned = useRef(false);
  const selected = useBay((s) => s.selected === id);

  useEffect(() => {
    registerBody(
      id,
      "dummy-bone",
      () =>
        poseOf(r.current, {
          parent: id.split("-")[0] ?? null,
          kinematic: r.current ? r.current.isKinematic() : true,
        }),
      () => r.current,
    );
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
      type={type}
      mass={mass}
      friction={0.7}
      restitution={0.04}
      linearDamping={linearDamping}
      angularDamping={angularDamping}
      collisionGroups={GROUPS}
      ccd
    >
      <CuboidCollider args={[sx / 2, sy / 2, sz / 2]} />
      <mesh onPointerDown={grab.down}>
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={selected ? 0xd4d7cf : color}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>
      {children}
    </RigidBody>
  );
}

export function Dummy({ id, pos }: { id: string; pos: [number, number, number] }) {
  const hips = useRef<RapierRigidBody>(null!);
  const chest = useRef<RapierRigidBody>(null!);
  const head = useRef<RapierRigidBody>(null!);
  const thighL = useRef<RapierRigidBody>(null!);
  const thighR = useRef<RapierRigidBody>(null!);
  const shinL = useRef<RapierRigidBody>(null!);
  const shinR = useRef<RapierRigidBody>(null!);
  const uarmL = useRef<RapierRigidBody>(null!);
  const uarmR = useRef<RapierRigidBody>(null!);
  const larmL = useRef<RapierRigidBody>(null!);
  const larmR = useRef<RapierRigidBody>(null!);
  const bones = useRef([hips, chest, head, thighL, thighR, shinL, shinR, uarmL, uarmR, larmL, larmR]);
  const [floppy, setFloppy] = useState(false);
  const type: BodyType = floppy ? "dynamic" : "kinematicPosition";
  const lin = floppy ? 0.12 : 3.2;
  const ang = floppy ? 0.16 : 8;

  useEffect(() => {
    const ids = [
      `${id}-hips`,
      `${id}-chest`,
      `${id}-head`,
      `${id}-thigh-l`,
      `${id}-thigh-r`,
      `${id}-shin-l`,
      `${id}-shin-r`,
      `${id}-uarm-l`,
      `${id}-uarm-r`,
      `${id}-larm-l`,
      `${id}-larm-r`,
    ];
    registerAssembly(id, ids);
    return () => unregisterAssembly(id);
  }, [id]);

  useEffect(() => {
    const onBlast = (ev: Event) => {
      const { x, z, power } = (ev as CustomEvent<{ x: number; y: number; z: number; power: number }>).detail;
      const h = hips.current;
      if (!h || power < 4) return;
      const p = h.translation();
      if (Math.hypot(p.x - x, p.z - z) > 6) return;
      unregisterAssembly(id);
      let n = 0;
      for (const r of bones.current) {
        const b = r.current;
        if (!b) continue;
        b.setBodyType(0, true);
        b.setLinearDamping(0.12);
        b.setAngularDamping(0.16);
        b.wakeUp();
        n += 1;
      }
      setFloppy(true);
      if (n > 0) note("dummy-flop", { id, n, x: p.x, z: p.z });
    };
    window.addEventListener("bay-blast", onBlast, true);
    return () => window.removeEventListener("bay-blast", onBlast, true);
  }, [id]);

  const boneProps = { type, linearDamping: lin, angularDamping: ang };

  return (
    <group position={pos}>
      <Bone r={hips} id={`${id}-hips`} pos={[0, 0.74, 0]} size={[0.3, 0.16, 0.18]} mass={DUMMY.hipMass} {...boneProps} />
      <Bone r={chest} id={`${id}-chest`} pos={[0, 1.0, 0]} size={[0.28, 0.34, 0.16]} mass={DUMMY.chestMass} {...boneProps} />
      <Bone r={head} id={`${id}-head`} pos={[0, 1.28, 0]} size={[0.16, 0.16, 0.16]} mass={DUMMY.headMass} color={jointCol} {...boneProps} />
      <Bone r={thighL} id={`${id}-thigh-l`} pos={[-0.08, 0.5, 0]} size={[0.1, 0.32, 0.1]} mass={DUMMY.thighMass} {...boneProps} />
      <Bone r={thighR} id={`${id}-thigh-r`} pos={[0.08, 0.5, 0]} size={[0.1, 0.32, 0.1]} mass={DUMMY.thighMass} {...boneProps} />
      <Bone r={shinL} id={`${id}-shin-l`} pos={[-0.08, 0.17, 0]} size={[0.09, 0.32, 0.09]} mass={DUMMY.shinMass} {...boneProps} />
      <Bone r={shinR} id={`${id}-shin-r`} pos={[0.08, 0.17, 0]} size={[0.09, 0.32, 0.09]} mass={DUMMY.shinMass} {...boneProps} />
      <Bone r={uarmL} id={`${id}-uarm-l`} pos={[-0.28, 1.08, 0]} size={[0.26, 0.08, 0.08]} mass={DUMMY.uarmMass} {...boneProps} />
      <Bone r={uarmR} id={`${id}-uarm-r`} pos={[0.28, 1.08, 0]} size={[0.26, 0.08, 0.08]} mass={DUMMY.uarmMass} {...boneProps} />
      <Bone r={larmL} id={`${id}-larm-l`} pos={[-0.52, 1.08, 0]} size={[0.22, 0.07, 0.07]} mass={DUMMY.larmMass} {...boneProps} />
      <Bone r={larmR} id={`${id}-larm-r`} pos={[0.52, 1.08, 0]} size={[0.22, 0.07, 0.07]} mass={DUMMY.larmMass} {...boneProps} />

      <Ball a={hips} b={chest} pa={[0, 0.08, 0]} pb={[0, -0.17, 0]} />
      <Ball a={chest} b={head} pa={[0, 0.17, 0]} pb={[0, -0.08, 0]} />
      <Ball a={hips} b={thighL} pa={[-0.08, -0.08, 0]} pb={[0, 0.16, 0]} />
      <Ball a={hips} b={thighR} pa={[0.08, -0.08, 0]} pb={[0, 0.16, 0]} />
      <Hinge a={thighL} b={shinL} pa={[0, -0.16, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-2.3, 0.08]} />
      <Hinge a={thighR} b={shinR} pa={[0, -0.16, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-2.3, 0.08]} />
      <Ball a={chest} b={uarmL} pa={[-0.16, 0.1, 0]} pb={[0.13, 0, 0]} />
      <Ball a={chest} b={uarmR} pa={[0.16, 0.1, 0]} pb={[-0.13, 0, 0]} />
      <Hinge a={uarmL} b={larmL} pa={[-0.13, 0, 0]} pb={[0.11, 0, 0]} axis={[0, 0, 1]} lim={[-0.1, 2.2]} />
      <Hinge a={uarmR} b={larmR} pa={[0.13, 0, 0]} pb={[-0.11, 0, 0]} axis={[0, 0, 1]} lim={[-2.2, 0.1]} />
    </group>
  );
}
