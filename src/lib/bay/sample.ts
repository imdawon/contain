import type { RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function poseOf(
  rb: RapierRigidBody | null | undefined,
  extra: Record<string, string | number | boolean | null> = {},
) {
  if (!rb) return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, state: { missing: true, ...extra } };
  const p = rb.translation();
  const r = rb.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _e.setFromQuaternion(_q);
  return { x: p.x, y: p.y, z: p.z, rx: _e.x, ry: _e.y, rz: _e.z, state: { missing: false, ...extra } };
}
