import { ConvexHullCollider, RigidBody, interactionGroups, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CRATE_G, DUMMY_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { registerBody, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";

const GROUPS = interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G]);
const dirt = 0xc9a15c;
const dirtHi = 0xe2c47a;
const dirtEdge = 0x6a4a2c;

/** size = [width, height at high end, length]. High end at -Z, lip at +Z, base at local y = -h/2. */
export function wedgeVerts(w: number, h: number, d: number) {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;
  return [
    -hw, -hh, -hd,
     hw, -hh, -hd,
    -hw,  hh, -hd,
     hw,  hh, -hd,
    -hw, -hh,  hd,
     hw, -hh,  hd,
  ];
}

function wedgeGeometry(w: number, h: number, d: number) {
  const v = wedgeVerts(w, h, d);
  const p = (i: number) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]] as [number, number, number];
  const faces: number[][] = [
    [2, 3, 5],
    [2, 5, 4],
    [0, 2, 3],
    [0, 3, 1],
    [0, 1, 5],
    [0, 5, 4],
    [0, 4, 2],
    [1, 3, 5],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const [i0, i1, i2] of faces) {
    const p0 = p(i0);
    const p1 = p(i1);
    const p2 = p(i2);
    a.set(...p0);
    b.set(...p1);
    c.set(...p2);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    pos.push(...p0, ...p1, ...p2);
    nrm.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

export function Ramp({
  id,
  pos,
  rot,
  size,
  grip,
}: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  size?: [number, number, number];
  grip?: number;
}) {
  const r = useRef<RapierRigidBody>(null);
  const selected = useBay((s) => s.selected === id);
  const [w, h, d] = size ?? [4, 2.4, 8];
  const mu = grip ?? 0.55;
  const hull = useMemo(() => new Float32Array(wedgeVerts(w, h, d)), [w, h, d]);
  const geom = useMemo(() => wedgeGeometry(w, h, d), [w, h, d]);
  const edge = useMemo(() => {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const g = new THREE.BufferGeometry();
    g.setFromPoints([
      new THREE.Vector3(-hw, hh, -hd),
      new THREE.Vector3(hw, hh, -hd),
      new THREE.Vector3(hw, -hh, hd),
      new THREE.Vector3(-hw, -hh, hd),
      new THREE.Vector3(-hw, hh, -hd),
    ]);
    return g;
  }, [w, h, d]);

  useEffect(() => {
    registerBody(
      id,
      "ramp",
      () => poseOf(r.current, { ramp: true, hill: true, grip: mu, sx: w, sy: h, sz: d }),
      () => r.current,
    );
    return () => unregisterBody(id);
  }, [id, mu, w, h, d]);

  useEffect(() => () => {
    geom.dispose();
    edge.dispose();
  }, [geom, edge]);

  return (
    <RigidBody
      ref={r}
      type="fixed"
      position={pos}
      rotation={rot ?? [0, 0, 0]}
      colliders={false}
      friction={mu}
      restitution={0.02}
      collisionGroups={GROUPS}
    >
      <ConvexHullCollider args={[hull]} collisionGroups={GROUPS} friction={mu} restitution={0.02} />
      <mesh geometry={geom}>
        <meshStandardMaterial color={selected ? 0xd4d7cf : dirt} roughness={0.88} metalness={0.03} side={THREE.DoubleSide} />
      </mesh>
      <line geometry={edge}>
        <lineBasicMaterial color={dirtEdge} />
      </line>
      <mesh position={[0, h / 2 - 0.02, -d / 2 + 0.02]}>
        <boxGeometry args={[w * 0.98, 0.04, 0.04]} />
        <meshStandardMaterial color={dirtHi} roughness={0.9} metalness={0} />
      </mesh>
    </RigidBody>
  );
}

export { Ramp as Hill };
