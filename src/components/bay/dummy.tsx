import {
  CuboidCollider,
  RigidBody,
  interactionGroups,
  useRevoluteJoint,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useGrab } from "@/components/bay/grab";
import { DUMMY } from "@/lib/bay/parts";
import { note, registerAssembly, registerBody, setBodyMass, unregisterAssembly, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";

/** World 0, dummy 1, crate 2. Unique 3–13 let non-adjacent bones hit each other. */
const WORLD = 0;
const DUMMY_G = 1;
const CRATE_G = 2;
const BONE_G = {
  hips: 3,
  chest: 4,
  head: 5,
  thighL: 6,
  thighR: 7,
  shinL: 8,
  shinR: 9,
  uarmL: 10,
  uarmR: 11,
  larmL: 12,
  larmR: 13,
} as const;
const ALL_BONES = Object.values(BONE_G);

function dummyGroups(self: number, skip: number[]) {
  const blocked = new Set([self, ...skip]);
  const others = ALL_BONES.filter((g) => !blocked.has(g));
  return interactionGroups([DUMMY_G, self], [WORLD, CRATE_G, ...others]);
}

const GROUPS = {
  hips: dummyGroups(BONE_G.hips, [BONE_G.chest, BONE_G.thighL, BONE_G.thighR]),
  chest: dummyGroups(BONE_G.chest, [BONE_G.hips, BONE_G.uarmL, BONE_G.uarmR]),
  head: dummyGroups(BONE_G.head, []),
  thighL: dummyGroups(BONE_G.thighL, [BONE_G.hips, BONE_G.shinL]),
  thighR: dummyGroups(BONE_G.thighR, [BONE_G.hips, BONE_G.shinR]),
  shinL: dummyGroups(BONE_G.shinL, [BONE_G.thighL]),
  shinR: dummyGroups(BONE_G.shinR, [BONE_G.thighR]),
  uarmL: dummyGroups(BONE_G.uarmL, [BONE_G.chest, BONE_G.larmL]),
  uarmR: dummyGroups(BONE_G.uarmR, [BONE_G.chest, BONE_G.larmR]),
  larmL: dummyGroups(BONE_G.larmL, [BONE_G.uarmL]),
  larmR: dummyGroups(BONE_G.larmR, [BONE_G.uarmR]),
};

const bone = 0xc4b8a8;
const jointCol = 0x6a5348;
type BodyType = "kinematicPosition";

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
  groups,
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
  groups: number;
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
      friction={0.92}
      restitution={0.02}
      linearDamping={linearDamping}
      angularDamping={angularDamping}
      gravityScale={0.68}
      collisionGroups={groups}
      ccd
    >
      <CuboidCollider args={[sx * 0.47, sy * 0.47, sz * 0.47]} collisionGroups={groups} />
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
  const floppy = useRef(false);

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
      const c = chest.current;
      if (!h || power < 4) return;
      const p = h.translation();
      if (Math.hypot(p.x - x, p.z - z) > 10) return;
      const first = !floppy.current;
      floppy.current = true;
      unregisterAssembly(id);
      const away = Math.max(0.35, Math.hypot(p.x - x, p.z - z));
      const kick = Math.min(1.6, 0.85 + power * 0.04);
      const kx = ((p.x - x) / away) * kick;
      const kz = ((p.z - z) / away) * (kick + 0.2);
      const ky = 0.55 + Math.min(0.35, power * 0.015);
      let n = 0;
      for (const r of bones.current) {
        const b = r.current;
        if (!b) continue;
        b.setBodyType(0, true);
        b.setLinearDamping(0.42);
        b.setAngularDamping(1.35);
        b.wakeUp();
        n += 1;
      }
      h.setLinvel({ x: kx, y: ky, z: kz }, true);
      if (c) c.setLinvel({ x: kx * 0.9, y: ky * 0.8, z: kz * 0.9 }, true);
      if (first && n > 0) note("dummy-flop", { id, n, x: p.x, z: p.z });
    };
    window.addEventListener("bay-blast", onBlast);
    return () => window.removeEventListener("bay-blast", onBlast);
  }, [id]);

  const boneProps = { type: "kinematicPosition" as BodyType, linearDamping: 3.2, angularDamping: 8 };

  return (
    <group position={pos}>
      <Bone r={hips} id={`${id}-hips`} pos={[0, 0.74, 0]} size={[0.3, 0.16, 0.18]} mass={DUMMY.hipMass} groups={GROUPS.hips} {...boneProps} />
      <Bone r={chest} id={`${id}-chest`} pos={[0, 1.0, 0]} size={[0.28, 0.34, 0.16]} mass={DUMMY.chestMass} groups={GROUPS.chest} {...boneProps} />
      <Bone r={head} id={`${id}-head`} pos={[0, 1.28, 0]} size={[0.16, 0.16, 0.16]} mass={DUMMY.headMass} color={jointCol} groups={GROUPS.head} {...boneProps} />
      <Bone r={thighL} id={`${id}-thigh-l`} pos={[-0.08, 0.5, 0]} size={[0.1, 0.32, 0.1]} mass={DUMMY.thighMass} groups={GROUPS.thighL} {...boneProps} />
      <Bone r={thighR} id={`${id}-thigh-r`} pos={[0.08, 0.5, 0]} size={[0.1, 0.32, 0.1]} mass={DUMMY.thighMass} groups={GROUPS.thighR} {...boneProps} />
      <Bone r={shinL} id={`${id}-shin-l`} pos={[-0.08, 0.17, 0]} size={[0.09, 0.32, 0.09]} mass={DUMMY.shinMass} groups={GROUPS.shinL} {...boneProps} />
      <Bone r={shinR} id={`${id}-shin-r`} pos={[0.08, 0.17, 0]} size={[0.09, 0.32, 0.09]} mass={DUMMY.shinMass} groups={GROUPS.shinR} {...boneProps} />
      <Bone r={uarmL} id={`${id}-uarm-l`} pos={[-0.28, 1.08, 0]} size={[0.26, 0.08, 0.08]} mass={DUMMY.uarmMass} groups={GROUPS.uarmL} {...boneProps} />
      <Bone r={uarmR} id={`${id}-uarm-r`} pos={[0.28, 1.08, 0]} size={[0.26, 0.08, 0.08]} mass={DUMMY.uarmMass} groups={GROUPS.uarmR} {...boneProps} />
      <Bone r={larmL} id={`${id}-larm-l`} pos={[-0.52, 1.08, 0]} size={[0.22, 0.07, 0.07]} mass={DUMMY.larmMass} groups={GROUPS.larmL} {...boneProps} />
      <Bone r={larmR} id={`${id}-larm-r`} pos={[0.52, 1.08, 0]} size={[0.22, 0.07, 0.07]} mass={DUMMY.larmMass} groups={GROUPS.larmR} {...boneProps} />

      <Hinge a={hips} b={chest} pa={[0, 0.08, 0]} pb={[0, -0.17, 0]} axis={[1, 0, 0]} lim={[-0.22, 0.55]} />
      <Hinge a={chest} b={head} pa={[0, 0.17, 0]} pb={[0, -0.08, 0]} axis={[1, 0, 0]} lim={[-0.35, 0.4]} />
      <Hinge a={hips} b={thighL} pa={[-0.08, -0.08, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-0.12, 1.45]} />
      <Hinge a={hips} b={thighR} pa={[0.08, -0.08, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-0.12, 1.45]} />
      <Hinge a={thighL} b={shinL} pa={[0, -0.16, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-2.1, 0.06]} />
      <Hinge a={thighR} b={shinR} pa={[0, -0.16, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-2.1, 0.06]} />
      <Hinge a={chest} b={uarmL} pa={[-0.16, 0.1, 0]} pb={[0.13, 0, 0]} axis={[0, 0, 1]} lim={[-2.0, 0.35]} />
      <Hinge a={chest} b={uarmR} pa={[0.16, 0.1, 0]} pb={[-0.13, 0, 0]} axis={[0, 0, 1]} lim={[-0.35, 2.0]} />
      <Hinge a={uarmL} b={larmL} pa={[-0.13, 0, 0]} pb={[0.11, 0, 0]} axis={[0, 0, 1]} lim={[-0.08, 2.0]} />
      <Hinge a={uarmR} b={larmR} pa={[0.13, 0, 0]} pb={[-0.11, 0, 0]} axis={[0, 0, 1]} lim={[-2.0, 0.08]} />
    </group>
  );
}
