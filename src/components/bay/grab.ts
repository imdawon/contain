import type { RapierRigidBody } from "@react-three/rapier";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { assemblyMembers, awakenRagdoll, listSamplers, note } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

const _hit = new THREE.Vector3();

type Member = { id: string; kinematic: boolean };
type Mode = "assembly" | "spring" | "solo";

export function useGrab(body: RefObject<RapierRigidBody | null>, id: string) {
  const grabbing = useRef(false);
  const last = useRef(new THREE.Vector3());
  const vel = useRef(new THREE.Vector3());
  const dist = useRef(-1);
  const offset = useRef(new THREE.Vector3());
  const crew = useRef<Member[]>([]);
  const mode = useRef<Mode>("solo");
  const axis = useRef<"x" | "y" | "z" | null>(null);

  useEffect(() => {
    const up = () => release();
    const wheel = (e: WheelEvent) => {
      if (!grabbing.current) return;
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * Math.min(0.35, Math.abs(e.deltaY) * 0.002);
      dist.current = Math.min(16, Math.max(0.4, dist.current + delta));
    };
    const key = (e: KeyboardEvent) => {
      if (!grabbing.current) return;
      const k = e.key.toLowerCase();
      if (k === "x" || k === "y" || k === "z") {
        e.preventDefault();
        axis.current = axis.current === k ? null : k;
        useBay.getState().setMoveAxis(axis.current);
      }
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
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
    axis.current = useBay.getState().moveAxis;
    const t = b.translation();
    last.current.set(t.x, t.y, t.z);
    dist.current = Math.max(0.4, e.distance);
    offset.current.set(t.x - e.point.x, t.y - e.point.y, t.z - e.point.z);
    const editing = !useBay.getState().playing;
    const bone = listSamplers().get(id)?.kind === "dummy-bone";
    if (bone && !editing) {
      awakenRagdoll(id);
      mode.current = "spring";
      crew.current = [{ id, kinematic: false }];
      note("grab", { id, n: 1, spring: true });
      return;
    }
    const crewBodies = bodies();
    mode.current = crewBodies.length > 1 ? "assembly" : "solo";
    crew.current = crewBodies.map(({ id: mid, b: rb }) => {
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
    const editing = !useBay.getState().playing;
    if (editing) {
      for (const m of crew.current) {
        const rb = m.id === id ? body.current : listSamplers().get(m.id)?.getBody?.();
        if (!rb) continue;
        rb.setBodyType(m.kinematic ? 2 : 0, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      const root = useBay.getState().entities.find((e) => e.id === id || id.startsWith(`${e.id}-`));
      if (root && body.current) {
        const p = body.current.translation();
        const hips = listSamplers().get(`${root.id}-hips`)?.getBody?.()?.translation();
        const q = hips ?? p;
        useBay.getState().patchEntity(root.id, {
          pos: [q.x, root.kind === "dummy" ? Math.max(0, q.y - 0.74) : q.y, q.z],
        });
      }
      void import("@/lib/bay/studio").then((m) => useBay.getState().stampBlueprint(m.captureScene()));
      note("ungrab", { id, edit: true });
      crew.current = [];
      mode.current = "solo";
      return;
    }
    if (mode.current === "spring") {
      const rb = body.current;
      if (rb) {
        rb.setLinvel({ x: vel.current.x * 0.55, y: vel.current.y * 0.55, z: vel.current.z * 0.55 }, true);
        rb.wakeUp();
      }
      note("ungrab", { id, floppy: true, spring: true });
      crew.current = [];
      mode.current = "solo";
      return;
    }
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
    mode.current = "solo";
  }

  function tick(ray: THREE.Ray, dt: number) {
    if (!grabbing.current || dist.current < 0) return;
    const b = body.current;
    if (!b) return;
    ray.at(dist.current, _hit);
    _hit.add(offset.current);
    _hit.y = Math.max(0.06, _hit.y);
    const lock = axis.current ?? useBay.getState().moveAxis;
    if (lock === "x") {
      _hit.y = last.current.y;
      _hit.z = last.current.z;
    } else if (lock === "y") {
      _hit.x = last.current.x;
      _hit.z = last.current.z;
    } else if (lock === "z") {
      _hit.x = last.current.x;
      _hit.y = last.current.y;
    }
    if (mode.current === "spring") {
      const p = b.translation();
      const k = 14;
      const vx = (_hit.x - p.x) * k;
      const vy = (_hit.y - p.y) * k;
      const vz = (_hit.z - p.z) * k;
      vel.current.set(vx, vy, vz);
      b.setLinvel({ x: vx, y: vy, z: vz }, true);
      b.wakeUp();
      last.current.copy(_hit);
      return;
    }
    let dx = _hit.x - last.current.x;
    let dy = _hit.y - last.current.y;
    let dz = _hit.z - last.current.z;
    let minY = Infinity;
    for (const m of crew.current) {
      const rb = m.id === id ? b : listSamplers().get(m.id)?.getBody?.();
      if (!rb) continue;
      minY = Math.min(minY, rb.translation().y);
    }
    if (Number.isFinite(minY) && minY + dy < 0.06) dy = 0.06 - minY;
    const inv = 1 / Math.max(dt, 1 / 60);
    vel.current.set(dx * inv, dy * inv, dz * inv);
    last.current.x += dx;
    last.current.y += dy;
    last.current.z += dz;
    for (const m of crew.current) {
      const rec = listSamplers().get(m.id);
      const rb = m.id === id ? b : rec?.getBody?.();
      if (!rb) continue;
      const p = rb.translation();
      const nx = p.x + dx;
      const ny = p.y + dy;
      const nz = p.z + dz;
      rb.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
      rb.setTranslation({ x: nx, y: ny, z: nz }, true);
      const obj = rec?.getMesh?.()?.parent;
      if (obj) obj.position.set(nx, ny, nz);
    }
  }

  return { down, tick, grabbing };
}
