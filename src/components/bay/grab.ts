import type { RapierRigidBody } from "@react-three/rapier";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useBay } from "@/store/bay-store";

const _hit = new THREE.Vector3();

export function useGrab(body: RefObject<RapierRigidBody | null>, id: string) {
  const grabbing = useRef(false);
  const last = useRef(new THREE.Vector3());
  const vel = useRef(new THREE.Vector3());
  const dist = useRef(-1);
  const offset = useRef(new THREE.Vector3());

  useEffect(() => {
    const up = () => release();
    const wheel = (e: WheelEvent) => {
      if (!grabbing.current) return;
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * Math.min(0.35, Math.abs(e.deltaY) * 0.002);
      dist.current = Math.min(16, Math.max(0.4, dist.current + delta));
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("wheel", wheel);
    };
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
    dist.current = Math.max(0.4, e.distance);
    offset.current.set(t.x - e.point.x, t.y - e.point.y, t.z - e.point.z);
    b.setBodyType(2, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  function release() {
    if (!grabbing.current) return;
    grabbing.current = false;
    useBay.getState().setDragging(false);
    dist.current = -1;
    const b = body.current;
    if (!b) return;
    b.setBodyType(0, true);
    b.setLinvel(
      { x: vel.current.x * 0.7, y: vel.current.y * 0.7, z: vel.current.z * 0.7 },
      true,
    );
  }

  function tick(ray: THREE.Ray, dt: number) {
    if (!grabbing.current || dist.current < 0) return;
    const b = body.current;
    if (!b) return;
    ray.at(dist.current, _hit);
    _hit.add(offset.current);
    _hit.y = Math.max(0.06, _hit.y);
    const inv = 1 / Math.max(dt, 1 / 60);
    vel.current.set((_hit.x - last.current.x) * inv, (_hit.y - last.current.y) * inv, (_hit.z - last.current.z) * inv);
    last.current.copy(_hit);
    b.setNextKinematicTranslation({ x: _hit.x, y: _hit.y, z: _hit.z });
  }

  return { down, tick, grabbing };
}
