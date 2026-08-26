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
const CUT = 0.75;
const SEG = 40;
const COL = 36;
const THICK = 0.4;

/** s in [0,1] along a U-parabola cut at 75% width. Bottom of the U at s = 2/3. */
function parabolaY(s: number, h: number) {
  const v = 0.5 / CUT;
  const a = h / (v * v);
  const d = s - v;
  // keep the trough off the world floor so the cart doesn't scrape to a stop
  return a * d * d + 0.9;
}

function buildHill(w: number, h: number, d: number) {
  const hw = w / 2;
  const hd = d / 2;
  const top: number[] = [];
  const bot: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const s = i / SEG;
    const z = -hd + s * d;
    const y = parabolaY(s, h);
    top.push(-hw, y, z, hw, y, z);
    bot.push(-hw, y - THICK, z, hw, y - THICK, z);
  }
  const n = SEG + 1;
  const verts: number[] = [];
  verts.push(...top, ...bot);
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d0: number) => {
    indices.push(a, b, c, a, c, d0);
  };
  for (let i = 0; i < SEG; i++) {
    const t0 = i * 2;
    const t1 = t0 + 2;
    const b0 = n * 2 + i * 2;
    const b1 = b0 + 2;
    quad(t0, t0 + 1, t1 + 1, t1);
    quad(b0 + 1, b0, b1, b1 + 1);
    quad(t0, t1, b1, b0);
    quad(t0 + 1, b0 + 1, b1 + 1, t1 + 1);
  }
  const lastT = (n - 1) * 2;
  const lastB = n * 2 + (n - 1) * 2;
  quad(0, n * 2, n * 2 + 1, 1);
  quad(lastT + 1, lastB + 1, lastB, lastT);

  const pos = new Float32Array(verts);
  const idx = new Uint32Array(indices);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const edge = new THREE.BufferGeometry();
  const epts: THREE.Vector3[] = [];
  for (let i = 0; i <= SEG; i++) {
    const s = i / SEG;
    epts.push(new THREE.Vector3(-hw, parabolaY(s, h) + 0.02, -hd + s * d));
  }
  edge.setFromPoints(epts);

  const hulls: Float32Array[] = [];
  for (let i = 0; i < COL; i++) {
    const s0 = Math.max(0, i / COL - 0.004);
    const s1 = Math.min(1, (i + 1) / COL + 0.004);
    const z0 = -hd + s0 * d;
    const z1 = -hd + s1 * d;
    const y0 = parabolaY(s0, h);
    const y1 = parabolaY(s1, h);
    hulls.push(
      new Float32Array([
        -hw, y0, z0,
         hw, y0, z0,
        -hw, y0 - THICK, z0,
         hw, y0 - THICK, z0,
        -hw, y1, z1,
         hw, y1, z1,
        -hw, y1 - THICK, z1,
         hw, y1 - THICK, z1,
      ]),
    );
  }

  return { geo, edge, hulls };
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
  const [w, h, d] = size ?? [8, 8, 22];
  const mu = grip ?? 0.55;
  const hill = useMemo(() => buildHill(w, h, d), [w, h, d]);

  useEffect(() => {
    registerBody(
      id,
      "ramp",
      () => poseOf(r.current, { ramp: true, hill: true, grip: mu, sx: w, sy: h, sz: d }),
      () => r.current,
    );
    return () => unregisterBody(id);
  }, [id, mu, w, h, d]);

  useEffect(
    () => () => {
      hill.geo.dispose();
      hill.edge.dispose();
    },
    [hill],
  );

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
      {hill.hulls.map((hull, i) => (
        <ConvexHullCollider key={i} args={[hull]} collisionGroups={GROUPS} friction={mu} restitution={0.02} />
      ))}
      <mesh geometry={hill.geo}>
        <meshStandardMaterial
          color={selected ? 0xd4d7cf : dirt}
          roughness={0.88}
          metalness={0.03}
          side={THREE.DoubleSide}
        />
      </mesh>
      <line geometry={hill.edge}>
        <lineBasicMaterial color={dirtEdge} />
      </line>
      <mesh position={[0, parabolaY(0, h) + 0.02, -d / 2 + 0.02]}>
        <boxGeometry args={[w * 0.98, 0.04, 0.04]} />
        <meshStandardMaterial color={dirtHi} roughness={0.9} metalness={0} />
      </mesh>
    </RigidBody>
  );
}

export { Ramp as Hill };
