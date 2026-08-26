import type { RapierRigidBody } from "@react-three/rapier";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { assemblyMembers, listSamplers, note } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

const _hit = new THREE.Vector3();

type Member = { id: string; kinematic: boolean };

export function useGrab(body: RefObject<RapierRigidBody | null>, id: string) {
  const grabbing = useRef(false);
  const last = useRef(new THREE.Vector3());
  const vel = useRef(new THREE.Vector3());
  const dist = useRef(-1);
  const offset = useRef(new THREE.Vector3());
  const crew = useRef<Member[]>([]);

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

  function bodies() {
    const ids = assemblyMembers(id);
    const out: { id: string; b: RapierRigidBody }[] = [];
    for (const mid of ids) {
      const b = mid === id ? body.current : listSamplers().get(mid)?.getBody?.();
      if (b) out.push({ id: mid, b });
    }
    if (out.length === 0 && body.current) out.push({ id, b: body.current });
    return out;
  }

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
    crew.current = bodies().map(({ id: mid, b: rb }) => {
      const kinematic = rb.isKinematic();
      rb.setBodyType(2, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return { id: mid, kinematic };
    });
    note("grab", { id, n: crew.current.length });
  }

  function release() {
    if (!grabbing.current) return;
    grabbing.current = false;
    useBay.getState().setDragging(false);
    dist.current = -1;
    const floppy = crew.current.some((m) => !m.kinematic);
    for (const m of crew.current) {
      const rb = m.id === id ? body.current : listSamplers().get(m.id)?.getBody?.();
      if (!rb) continue;
      if (floppy) {
        rb.setBodyType(0, true);
        rb.setLinvel({ x: vel.current.x * 0.7, y: vel.current.y * 0.7, z: vel.current.z * 0.7 }, true);
      } else {
        rb.setBodyType(2, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    note("ungrab", { id, floppy });
    crew.current = [];
  }

  function tick(ray: THREE.Ray, dt: number) {
    if (!grabbing.current || dist.current < 0) return;
    const b = body.current;
    if (!b) return;
    ray.at(dist.current, _hit);
    _hit.add(offset.current);
    _hit.y = Math.max(0.06, _hit.y);
    const dx = _hit.x - last.current.x;
    const dy = _hit.y - last.current.y;
    const dz = _hit.z - last.current.z;
    const inv = 1 / Math.max(dt, 1 / 60);
    vel.current.set(dx * inv, dy * inv, dz * inv);
    last.current.copy(_hit);
    for (const m of crew.current) {
      const rb = m.id === id ? b : listSamplers().get(m.id)?.getBody?.();
      if (!rb) continue;
      const p = rb.translation();
      rb.setNextKinematicTranslation({ x: p.x + dx, y: Math.max(0.06, p.y + dy), z: p.z + dz });
    }
  }

  return { down, tick, grabbing };
}
