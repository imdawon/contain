import type { RapierRigidBody } from "@react-three/rapier";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useBay } from "@/store/bay-store";

export function useGrab(body: RefObject<RapierRigidBody | null>, id: string) {
  const grabbing = useRef(false);
  const last = useRef(new THREE.Vector3());
  const vel = useRef(new THREE.Vector3());

  useEffect(() => {
    const up = () => release();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  function down(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    useBay.getState().select(id);
    if (useBay.getState().tool !== "grab") return;
    const b = body.current;
    if (!b) return;
    grabbing.current = true;
    useBay.getState().setDragging(true);
    const t = b.translation();
    last.current.set(t.x, t.y, t.z);
    b.setBodyType(2, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  function release() {
    if (!grabbing.current) return;
    grabbing.current = false;
    useBay.getState().setDragging(false);
    const b = body.current;
    if (!b) return;
    b.setBodyType(0, true);
    b.setLinvel({ x: vel.current.x, y: vel.current.y, z: vel.current.z }, true);
  }

  function tick(ray: THREE.Ray, dt: number) {
    if (!grabbing.current) return;
    const b = body.current;
    if (!b) return;
    const hit = new THREE.Vector3();
    ray.at(Math.max(1.4, ray.origin.y), hit);
    hit.y = Math.max(0.08, hit.y);
    const inv = 1 / Math.max(dt, 1 / 60);
    vel.current.set((hit.x - last.current.x) * inv, (hit.y - last.current.y) * inv, (hit.z - last.current.z) * inv);
    last.current.copy(hit);
    b.setNextKinematicTranslation({ x: hit.x, y: hit.y, z: hit.z });
  }

  return { down, tick, grabbing };
}
