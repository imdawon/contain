import { ConvexHullCollider, RigidBody, interactionGroups, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CRATE_G, DUMMY_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { findActorBody, registerBody, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";

const GROUPS = interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G]);
const dirt = 0xb7aea0;
const dirtHi = 0xe2c47a;
const CUT = 0.75;
const SEG = 48;
const COL = 48;
const THICK = 0.4;
/** Run past the parabola cut so the last hull face is behind the launch, not a cliff. */
const LIP = 1.4;

/** s in [0,1]. Vertex at s = 0.5/cut. cut=1 is a full U split at the center. */
function parabolaY(s: number, h: number, cut: number) {
  const v = 0.5 / cut;
  const a = h / (v * v);
  const d = s - v;
  // keep the trough off the world floor so the cart doesn't scrape to a stop
  return a * d * d + 0.9;
}

function lipSlope(h: number, d: number, cut: number) {
  const v = 0.5 / cut;
  const a = h / (v * v);
  return (2 * a * (1 - v)) / d;
}

function surfaceY(z: number, h: number, d: number, cut: number) {
  const hd = d / 2;
  if (z <= hd) {
    const s = (z + hd) / d;
    return parabolaY(Math.min(1, Math.max(0, s)), h, cut);
  }
  if (cut >= 1) return parabolaY(1, h, cut);
  return parabolaY(1, h, cut) + lipSlope(h, d, cut) * (z - hd);
}

function thickAt(z: number, d: number, cut: number) {
  const hd = d / 2;
  if (z <= hd || cut >= 1) return THICK;
  const u = Math.min(1, Math.max(0, (z - hd) / LIP));
  return Math.max(0.05, THICK * (1 - 0.88 * u * u));
}

function buildHill(w: number, h: number, d: number, cut: number, grade = 0) {
  const hw = w / 2;
  const hd = d / 2;
  const z0 = -hd;
  const z1 = cut >= 1 ? hd : hd + LIP;
  const span = z1 - z0;
  const segs = d > 40 ? 12 : SEG;
  const cols = d > 28 ? 4 : COL;
  const samples: { z: number; y: number; t: number }[] = [];
  for (let i = 0; i <= segs; i++) {
    const z = z0 + (i / segs) * span;
    samples.push({ z, y: surfaceY(z, h, d, cut), t: thickAt(z, d, cut) });
  }
  const n = samples.length;
  const top: number[] = [];
  const bot: number[] = [];
  for (const p of samples) {
    top.push(-hw, p.y - hw * grade, p.z, hw, p.y + hw * grade, p.z);
    bot.push(-hw, p.y - p.t - hw * grade, p.z, hw, p.y - p.t + hw * grade, p.z);
  }
  const verts: number[] = [];
  verts.push(...top, ...bot);
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d0: number) => {
    indices.push(a, b, c, a, c, d0);
  };
  for (let i = 0; i < n - 1; i++) {
    const t0 = i * 2;
    const t1 = t0 + 2;
    const b0 = n * 2 + i * 2;
    const b1 = b0 + 2;
    quad(t0, t0 + 1, t1 + 1, t1);
    quad(b0 + 1, b0, b1, b1 + 1);
    quad(t0, t1, b1, b0);
    quad(t0 + 1, b0 + 1, b1 + 1, t1 + 1);
  }
  quad(0, n * 2, n * 2 + 1, 1);

  const pos = new Float32Array(verts);
  const idx = new Uint32Array(indices);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const hulls: Float32Array[] = [];
  for (let i = 0; i < cols; i++) {
    const u0 = Math.max(0, i / cols - 0.012);
    const u1 = Math.min(1, (i + 1) / cols + 0.012);
    const za = z0 + u0 * span;
    const zb = z0 + u1 * span;
    const ya = surfaceY(za, h, d, cut);
    const yb = surfaceY(zb, h, d, cut);
    const ta = thickAt(za, d, cut);
    const tb = thickAt(zb, d, cut);
    hulls.push(
      new Float32Array([
        -hw, ya - hw * grade, za,
         hw, ya + hw * grade, za,
        -hw, ya - ta - hw * grade, za,
         hw, ya - ta + hw * grade, za,
        -hw, yb - hw * grade, zb,
         hw, yb + hw * grade, zb,
        -hw, yb - tb - hw * grade, zb,
         hw, yb - tb + hw * grade, zb,
      ]),
    );
  }

  return { geo, hulls };
}

export function Ramp({
  id,
  pos,
  rot,
  size,
  grip,
  bounce,
  cut: cutArg,
  grade: gradeArg,
}: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  size?: [number, number, number];
  grip?: number;
  bounce?: number;
  cut?: number;
  grade?: number;
}) {
  const r = useRef<RapierRigidBody>(null);
  const vis = useRef<THREE.Mesh>(null);
  const selected = useBay((s) => s.selected === id);
  const hangar = useBay((s) => s.entities.some((e) => e.kind === "wheel"));
  const [w, h, d] = size ?? [8, 8, 22];
  const cut = cutArg != null && cutArg > 0.2 ? cutArg : CUT;
  const mu = grip ?? 0.55;
  const rest = bounce ?? 0;
  const grade = gradeArg ?? 0;
  const hill = useMemo(() => buildHill(w, h, d, cut, grade), [w, h, d, cut, grade]);

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
    },
    [hill],
  );


  useFrame(() => {
    if (!hangar || !vis.current) return;
    const wheel = findActorBody("wheel");
    if (!wheel) return;
    const dz = wheel.translation().z - pos[2];
    vis.current.visible = dz > -50 && dz < 110;
  });
  return (
    <RigidBody
      ref={r}
      type="fixed"
      position={pos}
      rotation={rot ?? [0, 0, 0]}
      colliders={false}
      friction={mu}
      restitution={rest}
      collisionGroups={GROUPS}
    >
      {hill.hulls.map((hull, i) => (
        <ConvexHullCollider key={i} args={[hull]} collisionGroups={GROUPS} friction={mu} restitution={rest} />
      ))}
      <mesh ref={vis} geometry={hill.geo} receiveShadow={false} frustumCulled>
        {hangar ? (
          <meshBasicMaterial color={selected ? 0xd4d7cf : dirt} side={THREE.FrontSide} />
        ) : (
          <meshStandardMaterial
            color={selected ? 0xd4d7cf : dirt}
            roughness={0.82}
            metalness={0.04}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>
      <mesh position={[0, parabolaY(0, h, cut) + 0.02, -d / 2 + 0.02]}>
        <boxGeometry args={[w * 0.98, 0.04, 0.04]} />
        <meshStandardMaterial color={dirtHi} roughness={0.9} metalness={0} />
      </mesh>
    </RigidBody>
  );
}

export { Ramp as Hill };
