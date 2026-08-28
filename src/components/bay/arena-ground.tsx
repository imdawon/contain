import { ConvexHullCollider, CuboidCollider, RigidBody, interactionGroups } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CRATE_G, DUMMY_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";

export const ARENA_G = interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G]);

export function moundHull(radius: number, height: number, segs = 18) {
  const pts: number[] = [];
  const plateau = 0.22;
  const rings = [0.02, 0.22, 0.4, 0.58, 0.74, 0.88, 1];
  for (const n of rings) {
    const u = n <= plateau ? 0 : (n - plateau) / (1 - plateau);
    const y = height * Math.pow(1 - u, 1.62);
    const r = Math.max(0.08, radius * n);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  return pts;
}

export type PaintFn = (n: number, yFrac: number, stripe: number, sun: number) => [number, number, number];

export function ArenaMound({
  pos,
  radius,
  height,
  paint,
  friction = 0.92,
}: {
  pos: [number, number, number];
  radius: number;
  height: number;
  paint: PaintFn;
  friction?: number;
}) {
  const geo = useMemo(() => {
    const g = new THREE.CircleGeometry(radius, 40);
    g.rotateX(-Math.PI / 2);
    const posA = g.attributes.position;
    const col = new Float32Array(posA.count * 3);
    const plateau = 0.22;
    for (let i = 0; i < posA.count; i++) {
      const x = posA.getX(i);
      const z = posA.getZ(i);
      const r = Math.hypot(x, z);
      const n = Math.min(1, r / radius);
      const t = n <= plateau ? 0 : (n - plateau) / (1 - plateau);
      const y = height * Math.pow(1 - t, 1.62);
      posA.setY(i, y);
      const stripe = 0.5 + 0.5 * Math.sin(r * 4.1 + z * 0.2);
      const sun = 0.45 + 0.55 * (y / Math.max(0.2, height));
      const c = paint(n, y / Math.max(0.2, height), stripe, sun);
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [radius, height, paint]);
  const hull = useMemo(() => moundHull(radius, height), [radius, height]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <RigidBody type="fixed" position={pos} colliders={false} friction={friction} restitution={0.05}>
      <ConvexHullCollider args={[hull]} collisionGroups={ARENA_G} friction={friction} restitution={0.05} />
      <mesh geometry={geo} receiveShadow castShadow>
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0.04} />
      </mesh>
    </RigidBody>
  );
}

export function ArenaDeck({
  pos,
  color,
  size = [1.7, 0.1, 1.9],
}: {
  pos: [number, number, number];
  color: string;
  size?: [number, number, number];
}) {
  return (
    <RigidBody type="fixed" position={pos} colliders={false} friction={0.9} restitution={0}>
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} collisionGroups={ARENA_G} friction={0.9} restitution={0} />
      <mesh receiveShadow castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.78} />
      </mesh>
    </RigidBody>
  );
}

export function ArenaFloor({
  color,
  paint,
}: {
  color?: string;
  paint?: (x: number, z: number) => [number, number, number];
}) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(64, 72, 36, 42);
    g.rotateX(-Math.PI / 2);
    if (paint) {
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const c = paint(pos.getX(i), pos.getZ(i));
        col[i * 3] = c[0];
        col[i * 3 + 1] = c[1];
        col[i * 3 + 2] = c[2];
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    g.computeVertexNormals();
    return g;
  }, [paint]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} receiveShadow>
      {paint ? (
        <meshStandardMaterial vertexColors roughness={0.94} metalness={0.02} />
      ) : (
        <meshStandardMaterial color={color ?? "#6a6a62"} roughness={0.94} metalness={0.04} />
      )}
    </mesh>
  );
}
