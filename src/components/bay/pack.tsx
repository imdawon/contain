import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { cooks, startCook, stepCook } from "@/lib/bay/cook";
import { PACK } from "@/lib/bay/parts";
import { playEvent } from "@/lib/contain/audio";
import { note, registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";
import { JetFire } from "@/components/bay/fx";
import { useGrab } from "@/components/bay/grab";
import type { Texture } from "three";
import * as THREE from "three";

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function Pack({
  id,
  pos,
  fireMap,
}: {
  id: string;
  pos: [number, number, number];
  fireMap: Texture;
}) {
  const body = useRef<RapierRigidBody>(null);
  const boomOnce = useRef(false);
  const massPinned = useRef(false);
  const selected = useBay((s) => s.selected === id);
  const grab = useGrab(body, id);
  const spec = PACK.nmc;

  useEffect(() => {
    registerBody(
      id,
      "pack",
      () => {
        const b = body.current;
        const c = cooks.get(id);
        if (!b) {
          return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, state: { missing: true, cook: "idle", kW: 0, t: 0 } };
        }
        const p = b.translation();
        const r = b.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        _e.setFromQuaternion(_q);
        return {
          x: p.x,
          y: p.y,
          z: p.z,
          rx: _e.x,
          ry: _e.y,
          rz: _e.z,
          state: {
            missing: false,
            cook: c?.phase ?? "idle",
            kW: c ? Math.round(c.kW * 100) / 100 : 0,
            t: c ? Math.round(c.t * 100) / 100 : 0,
          },
        };
      },
      () => body.current,
    );
    return () => unregisterBody(id);
  }, [id]);

  useFrame((state, dt) => {
    const cap = Math.min(dt, 0.05);
    grab.tick(state.raycaster.ray, cap);
    const b = body.current;
    if (!b) return;
    if (!massPinned.current) {
      setBodyMass(b, spec.mass);
      massPinned.current = true;
    }
    const cook = cooks.get(id);
    if (!cook || cook.phase === "dead") return;
    const c = stepCook(id, cap);
    const p = b.translation();
    if (c) {
      c.pos = [p.x, p.y, p.z];
    }
    if (c?.phase === "boom" && !boomOnce.current) {
      boomOnce.current = true;
      note("pack-boom", { id, x: p.x, y: p.y, z: p.z, boom: c.boom });
      playEvent("burst", "nmc");
      b.applyImpulse({ x: (Math.random() - 0.5) * 0.06, y: 0.08, z: (Math.random() - 0.5) * 0.06 }, true);
    }
  });

  function onDown(e: Parameters<typeof grab.down>[0]) {
    grab.down(e);
    if (useBay.getState().tool === "nail") {
      startCook(id, "nmc", spec.cook, spec.peak, spec.boom);
      playEvent("puncture", "nmc");
      note("puncture", { id, via: "nail" });
    }
  }

  const [sx, sy, sz] = spec.size;
  return (
    <RigidBody
      ref={body}
      position={pos}
      colliders="cuboid"
      mass={spec.mass}
      restitution={0.08}
      friction={0.7}
      linearDamping={0.6}
      angularDamping={0.6}
      ccd
    >
      <mesh onPointerDown={onDown}>
        <boxGeometry args={[sx, sy, sz]} />
        <meshStandardMaterial
          color={selected ? 0xd4d7cf : 0x1a1c1e}
          metalness={0.55}
          roughness={0.3}
          emissive={selected ? 0x444438 : 0x000000}
          emissiveIntensity={selected ? 0.2 : 0}
        />
      </mesh>
      <JetFire cook={() => cooks.get(id)} map={fireMap} />
    </RigidBody>
  );
}

export function punctureSelected() {
  const id = useBay.getState().selected;
  if (!id) return false;
  const ent = useBay.getState().entities.find((e) => e.id === id);
  if (!ent || ent.kind !== "pack") return false;
  startCook(id, "nmc", PACK.nmc.cook, PACK.nmc.peak, PACK.nmc.boom);
  playEvent("puncture", "nmc");
  note("puncture", { id });
  return true;
}
