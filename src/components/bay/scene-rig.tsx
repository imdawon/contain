import { useRapier } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cooks } from "@/lib/bay/cook";
import { applyActor, listSamplers, note } from "@/lib/bay/probe";
import type { Scene } from "@/lib/bay/scene";
import { useBay } from "@/store/bay-store";

const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _rel = new THREE.Vector3();
const _qRel = new THREE.Quaternion();

function bodyOf(id: string) {
  return listSamplers().get(id)?.getBody?.() ?? null;
}

function resolveRef(ref: string) {
  if (listSamplers().has(ref)) return ref;
  const dummy = useBay.getState().entities.find((e) => e.kind === "dummy");
  if (dummy && ref.startsWith("dummy-")) return `${dummy.id}-${ref.slice(6)}`;
  const named = useBay.getState().entities.find((e) => e.id === ref || e.kind === ref);
  return named?.id ?? ref;
}

export function SceneRig({ scene }: { scene: Scene }) {
  const { world, rapier } = useRapier();
  const phase = useRef(0);
  const airborne = useRef(false);
  const midBoom = useRef(false);
  const joints = useRef<Array<{ isValid?: () => boolean }>>([]);
  const stamp = `${scene.id}:${scene.entities.map((e) => e.name).join(",")}`;

  useEffect(() => {
    phase.current = 0;
    airborne.current = false;
    midBoom.current = false;
    joints.current = [];
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
    };
  }, [stamp, scene, world]);

  useFrame(() => {
    if (phase.current === 0) {
      const ready = scene.entities.every((e) => {
        if (e.kind === "dummy") return Boolean(bodyOf(`${e.name}-hips`));
        return Boolean(bodyOf(e.name));
      });
      if (!ready) return;
      phase.current = 1;
      return;
    }

    if (phase.current === 1) {
      for (const e of useBay.getState().entities) {
        const id = e.kind === "dummy" ? `${e.id}-hips` : e.id;
        const patch: { friction?: number; restitution?: number; mass?: number } = {};
        if (e.grip != null) patch.friction = e.grip;
        if (e.bounce != null) patch.restitution = e.bounce;
        if (e.mass != null) patch.mass = e.mass;
        if (Object.keys(patch).length) applyActor(id, patch);
      }
      phase.current = 2;
      return;
    }

    if (phase.current === 2) {
      for (const tie of scene.ties) {
        const aId = resolveRef(tie.a);
        const bId = resolveRef(tie.b);
        const a = bodyOf(aId);
        const b = bodyOf(bId);
        if (!a || !b) continue;
        const pa = a.translation();
        const ra = a.rotation();
        const pb = b.translation();
        const rb = b.rotation();
        _qA.set(ra.x, ra.y, ra.z, ra.w);
        _qB.set(rb.x, rb.y, rb.z, rb.w);
        _inv.copy(_qB).invert();
        _rel.set(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z).applyQuaternion(_inv);
        _qRel.copy(_inv).multiply(_qA);
        const joint = world.createImpulseJoint(
          rapier.JointData.fixed(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0, w: 1 },
            { x: _rel.x, y: _rel.y, z: _rel.z },
            { x: _qRel.x, y: _qRel.y, z: _qRel.z, w: _qRel.w },
          ),
          a,
          b,
          true,
        );
        joints.current.push(joint);
        note("tie", { a: aId, b: bId });
      }
      phase.current = 3;
      return;
    }

    if (phase.current === 3) {
      const dummy = useBay.getState().entities.find((e) => e.kind === "dummy" && e.live);
      if (dummy) {
        const hips = bodyOf(`${dummy.id}-hips`);
        if (hips?.isKinematic()) return;
      }
      for (const e of useBay.getState().entities) {
        if (!e.vel) continue;
        const id = e.kind === "dummy" ? `${e.id}-hips` : e.id;
        applyActor(id, { vx: e.vel[0], vy: e.vel[1], vz: e.vel[2] });
      }
      note("scene-kick", { id: scene.id, file: scene.file ?? `scenes/${scene.id}.json` });
      phase.current = 4;
      return;
    }

    const dummy = useBay.getState().entities.find((e) => e.kind === "dummy");
    if (!dummy) return;
    const hips = bodyOf(`${dummy.id}-hips`);
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
    const nade = useBay.getState().entities.find((e) => e.kind === "grenade" || e.kind === "charge");
    const cook = nade ? cooks.get(nade.id) : undefined;
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
