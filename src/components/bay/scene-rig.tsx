import { interactionGroups, useBeforePhysicsStep, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cooks } from "@/lib/bay/cook";
import { applyActor, listSamplers, note, setColliderGroups } from "@/lib/bay/probe";
import type { Scene } from "@/lib/bay/scene";
import { COVER_G, CRATE_G, DUMMY_G, WORLD_G } from "@/lib/bay/groups";
import { WHEEL } from "@/lib/bay/parts";
import { carriedHang, holdRide, noteRideY, resetRide, ridePeakY } from "@/lib/bay/ride";
import { useBay } from "@/store/bay-store";

const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _rel = new THREE.Vector3();
const _qRel = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

const DUMMY_SIT: Record<string, { p: [number, number, number]; e: [number, number, number] }> = {
  hips: { p: [0, 0.3, -0.08], e: [0.18, 0, 0] },
  chest: { p: [0, 0.54, -0.02], e: [0.28, 0, 0] },
  head: { p: [0, 0.78, 0.04], e: [0.22, 0, 0] },
  "thigh-l": { p: [-0.09, 0.22, 0.14], e: [1.18, 0, 0] },
  "thigh-r": { p: [0.09, 0.22, 0.14], e: [1.18, 0, 0] },
  "shin-l": { p: [-0.09, 0.14, 0.38], e: [0.22, 0, 0] },
  "shin-r": { p: [0.09, 0.14, 0.38], e: [0.22, 0, 0] },
  "uarm-l": { p: [-0.2, 0.5, 0.04], e: [0.35, 0, 0.95] },
  "uarm-r": { p: [0.2, 0.5, 0.04], e: [0.35, 0, -0.95] },
  "larm-l": { p: [-0.18, 0.3, 0.18], e: [0.55, 0, 0.7] },
  "larm-r": { p: [0.18, 0.3, 0.18], e: [0.55, 0, -0.7] },
};

type Lock = {
  id: string;
  lx: number;
  ly: number;
  lz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
};

type RapierBody = {
  isKinematic: () => boolean;
  setNextKinematicTranslation: (p: { x: number; y: number; z: number }) => void;
  setNextKinematicRotation: (q: { x: number; y: number; z: number; w: number }) => void;
  setTranslation: (p: { x: number; y: number; z: number }, w: boolean) => void;
  setRotation: (q: { x: number; y: number; z: number; w: number }, w: boolean) => void;
  setLinvel: (v: { x: number; y: number; z: number }, w: boolean) => void;
  setAngvel: (v: { x: number; y: number; z: number }, w: boolean) => void;
  setGravityScale: (s: number, w: boolean) => void;
  setLinearDamping: (s: number) => void;
  setAngularDamping: (s: number) => void;
  setBodyType: (t: number, w: boolean) => void;
  translation: () => { x: number; y: number; z: number };
  rotation: () => { x: number; y: number; z: number; w: number };
  linvel: () => { x: number; y: number; z: number };
  angvel: () => { x: number; y: number; z: number };
  wakeUp: () => void;
};

function bodyOf(id: string) {
  return (listSamplers().get(id)?.getBody?.() ?? null) as (RapierRigidBody & RapierBody) | null;
}

function resolveRef(ref: string) {
  if (listSamplers().has(ref)) return ref;
  const ents = useBay.getState().entities;
  const dummy = ents.find((e) => e.kind === "dummy");
  if (dummy && ref.startsWith("dummy-")) return `${dummy.id}-${ref.slice(6)}`;
  const named = ents.find(
    (e) => e.id === ref || e.name === ref || e.kind === ref || (ref === "nade" && e.kind === "grenade"),
  );
  return named?.id ?? ref;
}

function quatFromEuler(rot: [number, number, number]) {
  _e.set(rot[0], rot[1], rot[2], "XYZ");
  _q.setFromEuler(_e);
  return { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
}

function poseBody(
  b: RapierBody,
  x: number,
  y: number,
  z: number,
  rot: { x: number; y: number; z: number; w: number },
) {
  if (b.isKinematic()) {
    b.setNextKinematicTranslation({ x, y, z });
    b.setNextKinematicRotation(rot);
  }
  b.setTranslation({ x, y, z }, true);
  b.setRotation(rot, true);
  b.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  b.wakeUp();
}

export function SceneRig({ scene }: { scene: Scene }) {
  const { world } = useRapier();
  const phase = useRef(0);
  const airborne = useRef(false);
  const midBoom = useRef(false);
  const released = useRef(false);
  const locks = useRef<Lock[]>([]);
  const joints = useRef<Array<{ isValid?: () => boolean }>>([]);
  const stamp = `${scene.id}:${scene.entities.map((e) => e.name).join(",")}`;

  useEffect(() => {
    phase.current = 0;
    airborne.current = false;
    midBoom.current = false;
    released.current = false;
    locks.current = [];
    joints.current = [];
    resetRide();
    note("scene-file", {
      id: scene.id,
      file: scene.file ?? `scenes/${scene.id}.json`,
      n: scene.entities.length,
      ties: scene.ties.length,
    });
    return () => {
      for (const j of joints.current) {
        try {
          if (j && typeof (world as { removeImpulseJoint?: (j: unknown, w: boolean) => void }).removeImpulseJoint === "function") {
            (world as { removeImpulseJoint: (j: unknown, w: boolean) => void }).removeImpulseJoint(j, true);
          }
        } catch {
          /* restage */
        }
      }
      joints.current = [];
      locks.current = [];
    };
  }, [stamp, scene, world]);

  useBeforePhysicsStep(() => {
    if (phase.current === 0) {
      const ents = useBay.getState().entities;
      const dummy = ents.find((e) => e.kind === "dummy");
      const wagon = ents.find((e) => e.kind === "wagon");
      const wheel = ents.find((e) => e.kind === "wheel");
      const nade = ents.find((e) => e.kind === "grenade" || e.kind === "charge");
      const hill = ents.find((e) => e.kind === "hill" || e.kind === "ramp");
      if (hill && !bodyOf(hill.id)) return;
      if (wagon && !bodyOf(wagon.id)) return;
      if (wheel && !bodyOf(wheel.id)) return;
      if (nade && !bodyOf(nade.id)) return;
      if (dummy && !bodyOf(`${dummy.id}-hips`)) return;
      for (const e of ents) {
        if (e.kind === "drum" && !bodyOf(e.id)) return;
      }

      for (const e of ents) {
        const rot = quatFromEuler(e.rot ?? [0, 0, 0]);
        if (e.kind === "dummy") {
          // Wagon ride seats him and ghosts bone-vs-world until the boom.
          // Cannon / free dummy keeps Dummy.tsx pose and wheel/floor groups.
          if (!wagon) continue;
          _q.set(rot.x, rot.y, rot.z, rot.w);
          for (const [part, sit] of Object.entries(DUMMY_SIT)) {
            const bone = bodyOf(`${e.id}-${part}`);
            if (!bone) continue;
            _e.set(sit.e[0], sit.e[1], sit.e[2], "XYZ");
            _qA.setFromEuler(_e);
            _qRel.copy(_q).multiply(_qA);
            _p.set(sit.p[0], sit.p[1], sit.p[2]).applyQuaternion(_q);
            poseBody(bone, e.pos[0] + _p.x, e.pos[1] + _p.y, e.pos[2] + _p.z, { x: _qRel.x, y: _qRel.y, z: _qRel.z, w: _qRel.w });
            bone.setBodyType(0, true);
            bone.setGravityScale(0, true);
            setColliderGroups(bone, interactionGroups([DUMMY_G], []));
          }
          continue;
        }
        if (e.kind === "hill" || e.kind === "ramp") continue;
        const b = bodyOf(e.id);
        if (!b) continue;
        poseBody(b, e.pos[0], e.pos[1], e.pos[2], rot);
        const patch: { friction?: number; restitution?: number; mass?: number } = {};
        if (e.grip != null) patch.friction = e.grip;
        if (e.bounce != null) patch.restitution = e.bounce;
        if (e.mass != null) patch.mass = e.mass;
        if (Object.keys(patch).length) applyActor(e.id, patch);
        b.setBodyType(0, true);
        if (e.kind === "wagon" || e.kind === "wheel" || e.kind === "drum") {
          b.setGravityScale(1, true);
        } else {
          b.setGravityScale(0, true);
        }
      }

      const wagonBody = wagon ? bodyOf(wagon.id) : null;
      const wheelBody = wheel ? bodyOf(wheel.id) : null;
      const leadEnt = wagon ?? wheel;
      const leadBody = wagonBody ?? wheelBody;
      if (wagon && !wagonBody) return;
      if (!wagon && wheel && !wheelBody) return;
      if (wagon && wagonBody) {
        const pb = wagonBody.translation();
        const rb = wagonBody.rotation();
        _qB.set(rb.x, rb.y, rb.z, rb.w);
        _inv.copy(_qB).invert();

        const followIds = new Set<string>();
        if (dummy) {
          for (const part of Object.keys(DUMMY_SIT)) followIds.add(`${dummy.id}-${part}`);
        }
        if (nade) followIds.add(nade.id);
        for (const tie of scene.ties) {
          const aId = resolveRef(tie.a);
          const bId = resolveRef(tie.b);
          followIds.add(aId === wagon.id ? bId : aId);
        }
        followIds.delete(wagon.id);

        locks.current = [];
        for (const id of followIds) {
          const b = bodyOf(id);
          if (!b) continue;
          const pa = b.translation();
          const ra = b.rotation();
          _qA.set(ra.x, ra.y, ra.z, ra.w);
          _rel.set(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z).applyQuaternion(_inv);
          _qRel.copy(_inv).multiply(_qA);
          b.setBodyType(0, true);
          b.setGravityScale(0, true);
          if (id.includes("-")) setColliderGroups(b, interactionGroups([DUMMY_G], []));
          locks.current.push({
            id,
            lx: _rel.x,
            ly: _rel.y,
            lz: _rel.z,
            qx: _qRel.x,
            qy: _qRel.y,
            qz: _qRel.z,
            qw: _qRel.w,
          });
          note("tie", { a: id, b: wagon.id });
        }
        if (dummy) holdRide(dummy.id);
        if (nade) {
          const nb = bodyOf(nade.id);
          if (nb) setColliderGroups(nb, interactionGroups([WORLD_G], []));
        }
      }

      if (leadEnt && leadBody) {
        const kick = leadEnt.vel ?? [0, 0, 0];
        leadBody.setBodyType(0, true);
        leadBody.setGravityScale(1, true);
        leadBody.setLinvel({ x: kick[0], y: kick[1], z: kick[2] }, true);
        if (leadEnt.kind === "wheel") {
          const r = WHEEL.radius;
          leadBody.setAngvel({
            x: -(kick[2] || 0) / Math.max(0.08, r),
            y: 0,
            z: -(kick[0] || 0) / Math.max(0.08, r),
          }, true);
        }
        leadBody.wakeUp();
        applyActor(leadEnt.id, { vx: kick[0], vy: kick[1], vz: kick[2] });
        note("scene-kick", {
          id: scene.id,
          file: scene.file ?? `scenes/${scene.id}.json`,
          vx: kick[0],
          vy: kick[1],
          vz: kick[2],
        });
      }
      phase.current = 1;
      return;
    }

    const ents = useBay.getState().entities;
    const wagonEnt = ents.find((e) => e.kind === "wagon");
    const wagon = wagonEnt ? bodyOf(wagonEnt.id) : null;
    const nade = ents.find((e) => e.kind === "grenade" || e.kind === "charge");
    const cook = nade ? cooks.get(nade.id) : undefined;
    const boom = Boolean(cook && (cook.phase === "boom" || cook.phase === "dead"));
    const dummy = ents.find((e) => e.kind === "dummy");
    const hips = dummy ? bodyOf(`${dummy.id}-hips`) : null;
    if (hips) noteRideY(hips.translation().y);

    if (boom && !released.current && hips) {
      const hp = hips.translation();
      const hv = hips.linvel();
      if (carriedHang(hp.y, hv.y, ridePeakY())) {
        released.current = true;
        for (const lock of locks.current) {
          const b = bodyOf(lock.id);
          if (!b) continue;
          b.setBodyType(0, true);
          b.setGravityScale(1, true);
          setColliderGroups(b, interactionGroups([DUMMY_G], [WORLD_G, CRATE_G, COVER_G]));
          b.wakeUp();
        }
      }
    }

    if (wagon && !released.current) {
      const pb = wagon.translation();
      const rb = wagon.rotation();
      const v = wagon.linvel();
      _qB.set(rb.x, rb.y, rb.z, rb.w);
      for (const lock of locks.current) {
        const b = bodyOf(lock.id);
        if (!b) continue;
        _rel.set(lock.lx, lock.ly, lock.lz).applyQuaternion(_qB);
        _qRel.set(lock.qx, lock.qy, lock.qz, lock.qw);
        _qA.copy(_qB).multiply(_qRel);
        const x = pb.x + _rel.x;
        const y = pb.y + _rel.y;
        const z = pb.z + _rel.z;
        const rot = { x: _qA.x, y: _qA.y, z: _qA.z, w: _qA.w };
        if (b.isKinematic()) {
          b.setBodyType(0, true);
        }
        b.setTranslation({ x, y, z }, true);
        b.setRotation(rot, true);
        b.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
        b.setAngvel(wagon.angvel(), true);
        b.setGravityScale(0, true);
        b.setLinearDamping(0.12);
        b.setAngularDamping(0.28);
      }
    }

    if (!dummy) return;
    if (!hips) return;
    const p = hips.translation();
    const v = hips.linvel();
    const gate = scene.airborne ?? {};
    const minY = gate.minY ?? 1.25;
    const minZ = gate.minZ ?? 6;
    if (!airborne.current && p.y >= minY && p.z >= minZ) {
      airborne.current = true;
      note("airborne", {
        id: `${dummy.id}-hips`,
        x: Math.round(p.x * 1000) / 1000,
        y: Math.round(p.y * 1000) / 1000,
        z: Math.round(p.z * 1000) / 1000,
        vy: Math.round(v.y * 1000) / 1000,
        file: scene.file ?? `scenes/${scene.id}.json`,
      });
    }
    if (cook && (cook.phase === "boom" || cook.phase === "dead") && !midBoom.current) {
      midBoom.current = true;
      note("boom-pose", {
        id: `${dummy.id}-hips`,
        x: Math.round(p.x * 1000) / 1000,
        y: Math.round(p.y * 1000) / 1000,
        z: Math.round(p.z * 1000) / 1000,
        vy: Math.round(v.y * 1000) / 1000,
        airborne: p.y >= minY ? 1 : 0,
        file: scene.file ?? `scenes/${scene.id}.json`,
      });
    }
  });

  return null;
}
