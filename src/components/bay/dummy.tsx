import {
  CuboidCollider,
  RigidBody,
  interactionGroups,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  useRapier,
  useRevoluteJoint,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { useGrab } from "@/components/bay/grab";
import {
  armLoadWindow,
  armSnaps,
  isSnapped,
  resetInjury,
  sampleContact,
  sampleHinge,
  sampleImpact,
  takeSnap,
  toyJointImpulse,
  type HingeId,
} from "@/lib/bay/atd";
import { cooks } from "@/lib/bay/cook";
import { lineOccluded } from "@/lib/bay/cover";
import { COVER_G, CRATE_G, DUMMY_G, WHEEL_G, WORLD_G } from "@/lib/bay/groups";
import { DUMMY } from "@/lib/bay/parts";
import { note, registerAssembly, registerBody, setBodyMass, setColliderGroups, unregisterAssembly, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";
import { carriedHang, onRide, ridePeakY } from "@/lib/bay/ride";

/** World 0, dummy 1, crate 2, cover 14. Unique 3–13 let non-adjacent bones hit each other. */
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
  return interactionGroups([DUMMY_G, self], [WORLD_G, CRATE_G, COVER_G, WHEEL_G, ...others]);
}

const GROUPS = {
  hips: dummyGroups(BONE_G.hips, [BONE_G.chest, BONE_G.thighL, BONE_G.thighR]),
  chest: dummyGroups(BONE_G.chest, [BONE_G.hips, BONE_G.head, BONE_G.uarmL, BONE_G.uarmR]),
  head: dummyGroups(BONE_G.head, [BONE_G.chest]),
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
const snappedCol = 0x8a4638;
type BodyType = "kinematicPosition" | "dynamic";
type ContactId = Extract<HingeId, "femur-l" | "femur-r" | "humerus-lower-l" | "humerus-lower-r">;

function Hinge({
  dummyId,
  label,
  a,
  b,
  pa,
  pb,
  axis,
  lim,
}: {
  dummyId: string;
  label: HingeId;
  a: RefObject<RapierRigidBody>;
  b: RefObject<RapierRigidBody>;
  pa: [number, number, number];
  pb: [number, number, number];
  axis: [number, number, number];
  lim: [number, number];
}) {
  const j = useRevoluteJoint(a, b, [pa, pb, axis, lim]);
  const { world } = useRapier();
  const gone = useRef(false);
  const pending = useRef(false);
  useBeforePhysicsStep(() => {
    if (gone.current || pending.current) return;
    const joint = j.current;
    if (!joint?.isValid()) return;
    const mag = toyJointImpulse(joint);
    sampleHinge(dummyId, label, mag);
    if (!takeSnap(dummyId, label, mag)) return;
    pending.current = true;
  });
  useAfterPhysicsStep(() => {
    if (!pending.current || gone.current) return;
    gone.current = true;
    pending.current = false;
    const joint = j.current;
    const distal = b.current;
    const proximal = a.current;
    if (joint?.isValid()) {
      try {
        world.removeImpulseJoint(joint, true);
      } catch {
        /* already gone */
      }
    }
    if (distal && proximal) {
      const pa2 = proximal.translation();
      const pb2 = distal.translation();
      const dx = pb2.x - pa2.x;
      const dy = pb2.y - pa2.y;
      const dz = pb2.z - pa2.z;
      const d = Math.max(0.08, Math.hypot(dx, dy, dz));
      distal.applyImpulse({ x: (dx / d) * 0.45, y: 0.28 + (dy / d) * 0.2, z: (dz / d) * 0.45 }, true);
      distal.wakeUp();
    }
  });
  return null;
}

function Bone({
  r,
  id,
  dummyId,
  pos,
  size,
  mass,
  type,
  linearDamping,
  angularDamping,
  groups,
  color = bone,
  contact,
  snap,
  children,
}: {
  r: RefObject<RapierRigidBody>;
  id: string;
  dummyId: string;
  pos: [number, number, number];
  size: [number, number, number];
  mass: number;
  type: BodyType;
  linearDamping: number;
  angularDamping: number;
  groups: number;
  color?: number;
  contact?: ContactId;
  snap?: HingeId;
  children?: ReactNode;
}) {
  const grab = useGrab(r, id);
  const pinned = useRef(false);
  const mesh = useRef<THREE.Mesh>(null);
  const selected = useBay((s) => s.selected === id);
  const mat = useRef<THREE.MeshStandardMaterial>(null);

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
    if (!b) return;
    if (!pinned.current) {
      setBodyMass(b, mass);
      if (b.numColliders() > 0) b.collider(0)?.setContactForceEventThreshold(0.08);
      pinned.current = true;
    }
    if (snap && mat.current && isSnapped(dummyId, snap)) {
      mat.current.color.setHex(snappedCol);
    }
  });

  const [sx, sy, sz] = size;
  return (
    <RigidBody
      ref={r}
      position={pos}
      colliders={false}
      type={type}
      mass={mass}
      friction={0.78}
      restitution={0.05}
      linearDamping={linearDamping}
      angularDamping={angularDamping}
      collisionGroups={groups}
      ccd
    >
      <CuboidCollider
        args={[sx * 0.44, sy * 0.44, sz * 0.44]}
        collisionGroups={groups}
        onContactForce={(p) => {
          sampleImpact(dummyId, p.totalForceMagnitude);
          if (contact) sampleContact(dummyId, contact, p.totalForceMagnitude);
        }}
      />
      <mesh ref={mesh} onPointerDown={grab.down}>
        <boxGeometry args={size} />
        <meshStandardMaterial
          ref={mat}
          color={selected ? 0xd4d7cf : color}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>
      {children}
    </RigidBody>
  );
}

function bonePos(r: RefObject<RapierRigidBody>) {
  const b = r.current;
  if (!b) return null;
  return b.translation();
}

export function Dummy({
  id,
  pos,
  rot,
  live: startLive,
  vel,
}: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  live?: boolean;
  vel?: [number, number, number];
}) {
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
  const live = useRef(false);
  const blasted = useRef(false);
  const launched = useRef(false);
  const injuryArmed = useRef(false);
  const { world, rapier } = useRapier();
  if (!injuryArmed.current) {
    injuryArmed.current = true;
    resetInjury(id);
    armLoadWindow(24);
    armSnaps(id, 0.75);
  }

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

  const boneGroups = [
    GROUPS.hips, GROUPS.chest, GROUPS.head,
    GROUPS.thighL, GROUPS.thighR, GROUPS.shinL, GROUPS.shinR,
    GROUPS.uarmL, GROUPS.uarmR, GROUPS.larmL, GROUPS.larmR,
  ];
  function setLive(on: boolean, gravity: number, lin: number, ang: number) {
    live.current = on;
    bones.current.forEach((r, i) => {
      const b = r.current;
      if (!b) return;
      b.setBodyType(on ? 0 : 2, true);
      b.setGravityScale(gravity, true);
      b.setLinearDamping(lin);
      b.setAngularDamping(ang);
      if (!on) {
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        setColliderGroups(b, boneGroups[i] ?? GROUPS.hips);
        b.wakeUp();
      }
    });
  }

  useBeforePhysicsStep(() => {
    if (startLive && !live.current && !floppy.current && !blasted.current) {
      setLive(true, 1, 0.05, 1.45);
      if (vel) {
        launched.current = true;
        for (const r of bones.current) {
          const b = r.current;
          if (!b) continue;
          b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
          b.wakeUp();
        }
      }
      note("dummy-live", { id, via: "scene" });
    }
  });

  useFrame(() => {
    if (live.current || floppy.current) {
      for (const r of bones.current) {
        const b = r.current;
        if (!b) continue;
        const v = b.linvel();
        const s = Math.hypot(v.x, v.y, v.z);
        if (s > 52) {
          const k = 52 / s;
          b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
        }
        const w = b.angvel();
        const ws = Math.hypot(w.x, w.y, w.z);
        if (ws > 24) {
          const k = 24 / ws;
          b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
        }
      }
    }
    if (floppy.current || live.current || blasted.current) return;
    for (const c of cooks.values()) {
      if (c.chem === "frag" && (c.phase === "cook" || c.phase === "boom")) {
        setLive(true, 0, 3.2, 8);
        note("dummy-live", { id });
        break;
      }
    }
  });

  useEffect(() => {
    const onBlast = (ev: Event) => {
      const { x, y, z, power } = (ev as CustomEvent<{ x: number; y: number; z: number; power: number }>).detail;
      const h = hips.current;
      if (!h || power < 4) return;
      const already = blasted.current;
      blasted.current = true;
      const p = h.translation();
      if (onRide(id)) {
        const vy = h.linvel().y;
        if (!carriedHang(p.y, vy, ridePeakY())) return;
      }
      const dist = Math.hypot(p.x - x, p.z - z);
      const blast = { x, y, z };
      const hipsBlock = lineOccluded(world, rapier, blast, p);
      if (!already) {
        resetInjury(id);
        armLoadWindow(0.55);
      }

      const kickBone = (r: RefObject<RapierRigidBody>, scale: number) => {
        const b = r.current;
        if (!b) return;
        const q = b.translation();
        if (lineOccluded(world, rapier, blast, q).hit) return;
        const dx = q.x - x;
        const dy = q.y - y;
        const dz = q.z - z;
        const d = Math.max(0.22, Math.hypot(dx, dy, dz));
        const j = Math.min(5.8, (power * 0.225 * scale) / d);
        b.applyImpulse({ x: (dx / d) * j, y: (dy / d) * j, z: (dz / d) * j }, true);
        b.wakeUp();
      };

      if (dist > 3.5) {
        if (!already) setLive(false, 0, 3.2, 8);
        return;
      }
      const fall = Math.min(1, 0.7 / Math.max(0.35, dist));
      const kick = Math.min(12, (1.4 + power * 0.07) * fall * 5);
      if (kick < 0.9) {
        if (!already) setLive(false, 0, 3.2, 8);
        return;
      }
      if (hipsBlock.hit) {
        if (!already) note("cover-block", { id, kind: hipsBlock.kind, toi: Math.round(hipsBlock.toi * 1000) / 1000, x: p.x, z: p.z });
        for (const r of bones.current) kickBone(r, already ? 1 : 0.35);
        return;
      }

      if (already) {
        for (const r of bones.current) kickBone(r, 1);
        return;
      }

      floppy.current = true;
      unregisterAssembly(id);
      const hx = p.x - x;
      const hy = p.y - y;
      const hz = p.z - z;
      const hl = Math.max(0.22, Math.hypot(hx, hy, hz));
      const kx = (hx / hl) * kick;
      const ky = (hy / hl) * kick;
      const kz = (hz / hl) * kick;
      const wx = hz >= 0 ? 5.3 : -5.3;
      let n = 0;
      for (const r of bones.current) {
        const b = r.current;
        if (!b) continue;
        b.setBodyType(0, true);
        b.setGravityScale(1, true);
        b.setLinearDamping(0.16);
        b.setAngularDamping(0.42);
        b.wakeUp();
        n += 1;
      }
      for (const r of bones.current) kickBone(r, 1);
      const set = (r: RefObject<RapierRigidBody>, vx: number, vy: number, vz: number, ax = 0, ay = 0, az = 0) => {
        const b = r.current;
        if (!b) return;
        const q = bonePos(r);
        if (q && lineOccluded(world, rapier, blast, q).hit) return;
        b.setLinvel({ x: vx, y: vy, z: vz }, true);
        b.setAngvel({ x: ax, y: ay, z: az }, true);
      };
      set(hips, kx, ky, kz, wx, 0.4, 0);
      set(chest, kx * 1.05, ky + 0.35, kz * 1.12, wx * 0.85, 0, 0);
      set(head, kx * 1.05, ky + 0.4, kz * 1.12, wx * 0.22, 0, 0);
      set(thighL, kx * 0.7, ky * 0.35, kz * 0.7, 1.4, 0, 0);
      set(thighR, kx * 0.7, ky * 0.35, kz * 0.7, 1.4, 0, 0);
      set(shinL, kx * 0.45, ky * 0.15, kz * 0.45, 0.8, 0, 0);
      set(shinR, kx * 0.45, ky * 0.15, kz * 0.45, 0.8, 0, 0);
      set(uarmL, kx - 1.1, ky + 0.4, kz, 0, 0, -3.4);
      set(uarmR, kx + 1.1, ky + 0.4, kz, 0, 0, 3.4);
      set(larmL, kx - 1.6, ky + 0.2, kz, 0, 0, -2.2);
      set(larmR, kx + 1.6, ky + 0.2, kz, 0, 0, 2.2);
      const pair = (hinge: HingeId, aa: RefObject<RapierRigidBody>, bb: RefObject<RapierRigidBody>) => {
        const ja = aa.current;
        const jb = bb.current;
        if (!ja || !jb) return;
        sampleHinge(id, hinge, toyJointImpulse({ isValid: () => true, body1: () => ja, body2: () => jb }));
      };
      pair("lumbar", hips, chest);
      pair("upper-neck", chest, head);
      pair("femur-l", hips, thighL);
      pair("femur-r", hips, thighR);
      pair("knee-l", thighL, shinL);
      pair("knee-r", thighR, shinR);
      pair("shoulder-l", chest, uarmL);
      pair("shoulder-r", chest, uarmR);
      pair("humerus-lower-l", uarmL, larmL);
      pair("humerus-lower-r", uarmR, larmR);
      const load = Math.max(0.55, kick * 1.7);
      sampleHinge(id, "lumbar", load);
      sampleHinge(id, "upper-neck", load * 0.72);
      sampleHinge(id, "femur-l", load * 0.9);
      sampleHinge(id, "femur-r", load * 0.9);
      if (first && n > 0) note("dummy-flop", { id, n, x: p.x, z: p.z });
    };
    window.addEventListener("bay-blast", onBlast);
    return () => window.removeEventListener("bay-blast", onBlast);
  }, [id, world, rapier]);

  const boneProps = { dummyId: id, type: "kinematicPosition" as BodyType, linearDamping: 3.2, angularDamping: 8 };

  return (
    <group position={pos} rotation={rot ?? [0, 0, 0]}>
      <Bone r={hips} id={`${id}-hips`} pos={[0, 0.74, 0]} size={[0.3, 0.16, 0.18]} mass={DUMMY.hipMass} groups={GROUPS.hips} {...boneProps} />
      <Bone r={chest} id={`${id}-chest`} pos={[0, 1.0, 0]} size={[0.28, 0.34, 0.16]} mass={DUMMY.chestMass} groups={GROUPS.chest} snap="lumbar" {...boneProps} />
      <Bone r={head} id={`${id}-head`} pos={[0, 1.28, 0]} size={[0.16, 0.16, 0.16]} mass={DUMMY.headMass} color={jointCol} groups={GROUPS.head} snap="upper-neck" {...boneProps} />
      <Bone r={thighL} id={`${id}-thigh-l`} pos={[-0.08, 0.5, 0]} size={[0.1, 0.32, 0.1]} mass={DUMMY.thighMass} groups={GROUPS.thighL} contact="femur-l" snap="femur-l" {...boneProps} />
      <Bone r={thighR} id={`${id}-thigh-r`} pos={[0.08, 0.5, 0]} size={[0.1, 0.32, 0.1]} mass={DUMMY.thighMass} groups={GROUPS.thighR} contact="femur-r" snap="femur-r" {...boneProps} />
      <Bone r={shinL} id={`${id}-shin-l`} pos={[-0.08, 0.17, 0]} size={[0.09, 0.32, 0.09]} mass={DUMMY.shinMass} groups={GROUPS.shinL} snap="knee-l" {...boneProps} />
      <Bone r={shinR} id={`${id}-shin-r`} pos={[0.08, 0.17, 0]} size={[0.09, 0.32, 0.09]} mass={DUMMY.shinMass} groups={GROUPS.shinR} snap="knee-r" {...boneProps} />
      <Bone r={uarmL} id={`${id}-uarm-l`} pos={[-0.28, 1.08, 0]} size={[0.26, 0.08, 0.08]} mass={DUMMY.uarmMass} groups={GROUPS.uarmL} contact="humerus-lower-l" snap="shoulder-l" {...boneProps} />
      <Bone r={uarmR} id={`${id}-uarm-r`} pos={[0.28, 1.08, 0]} size={[0.26, 0.08, 0.08]} mass={DUMMY.uarmMass} groups={GROUPS.uarmR} contact="humerus-lower-r" snap="shoulder-r" {...boneProps} />
      <Bone r={larmL} id={`${id}-larm-l`} pos={[-0.52, 1.08, 0]} size={[0.22, 0.07, 0.07]} mass={DUMMY.larmMass} groups={GROUPS.larmL} snap="humerus-lower-l" {...boneProps} />
      <Bone r={larmR} id={`${id}-larm-r`} pos={[0.52, 1.08, 0]} size={[0.22, 0.07, 0.07]} mass={DUMMY.larmMass} groups={GROUPS.larmR} snap="humerus-lower-r" {...boneProps} />

      <Hinge dummyId={id} label="lumbar" a={hips} b={chest} pa={[0, 0.08, 0]} pb={[0, -0.17, 0]} axis={[1, 0, 0]} lim={[-1.15, 0.5]} />
      <Hinge dummyId={id} label="upper-neck" a={chest} b={head} pa={[0, 0.17, 0]} pb={[0, -0.08, 0]} axis={[1, 0, 0]} lim={[-0.75, 0.55]} />
      <Hinge dummyId={id} label="femur-l" a={hips} b={thighL} pa={[-0.08, -0.08, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-0.2, 1.65]} />
      <Hinge dummyId={id} label="femur-r" a={hips} b={thighR} pa={[0.08, -0.08, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-0.2, 1.65]} />
      <Hinge dummyId={id} label="knee-l" a={thighL} b={shinL} pa={[0, -0.16, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-2.2, 0.05]} />
      <Hinge dummyId={id} label="knee-r" a={thighR} b={shinR} pa={[0, -0.16, 0]} pb={[0, 0.16, 0]} axis={[1, 0, 0]} lim={[-2.2, 0.05]} />
      <Hinge dummyId={id} label="shoulder-l" a={chest} b={uarmL} pa={[-0.16, 0.1, 0]} pb={[0.13, 0, 0]} axis={[0, 0, 1]} lim={[-2.1, 0.45]} />
      <Hinge dummyId={id} label="shoulder-r" a={chest} b={uarmR} pa={[0.16, 0.1, 0]} pb={[-0.13, 0, 0]} axis={[0, 0, 1]} lim={[-0.45, 2.1]} />
      <Hinge dummyId={id} label="humerus-lower-l" a={uarmL} b={larmL} pa={[-0.13, 0, 0]} pb={[0.11, 0, 0]} axis={[0, 0, 1]} lim={[-0.08, 2.15]} />
      <Hinge dummyId={id} label="humerus-lower-r" a={uarmR} b={larmR} pa={[0.13, 0, 0]} pb={[-0.11, 0, 0]} axis={[0, 0, 1]} lim={[-2.15, 0.08]} />
    </group>
  );
}
