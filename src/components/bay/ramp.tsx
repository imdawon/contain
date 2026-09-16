import { CuboidCollider, RigidBody, TrimeshCollider, interactionGroups, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CRATE_G, DUMMY_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { registerBody, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";

const GROUPS = interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G]);
const dirt = 0xb7aea0;
const dirtHi = 0xe2c47a;
const concrete = 0x8b8d88;
const grass = 0x4d7a3e;
const railCol = 0x3a3c3a;
const CUT = 0.75;
const SEG = 48;
const THICK = 0.4;
/** Run past the parabola cut so the last surface is behind the launch, not a cliff. */
const LIP = 1.4;
const PIPE_THICK = 1.2;
const BERM = 9;
const RAIL_H = 1.1;
const RAIL_T = 0.14;

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
  const segs = d > 40 ? 96 : SEG;
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

  return { geo };
}

type XY = { x: number; y: number };

function geoFrom(verts: number[], indices: number[]) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  return geo;
}

function extrudeRibbon(profile: XY[], z0: number, z1: number, rows: number, out: boolean) {
  const verts: number[] = [];
  const indices: number[] = [];
  const n = profile.length;
  for (let r = 0; r <= rows; r++) {
    const z = z0 + (r / rows) * (z1 - z0);
    for (const p of profile) verts.push(p.x, p.y, z);
  }
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n - 1; i++) {
      const a = r * n + i;
      const b = a + 1;
      const d = a + n;
      const c = d + 1;
      if (out) quad(a, d, c, b);
      else quad(a, b, c, d);
    }
  }
  return { verts, indices };
}

function stitch(a: ReturnType<typeof extrudeRibbon>, b: ReturnType<typeof extrudeRibbon>) {
  const base = a.verts.length / 3;
  return {
    verts: a.verts.concat(b.verts),
    indices: a.indices.concat(b.indices.map((i) => i + base)),
  };
}

function stripPair(left: XY[], right: XY[], z0: number, z1: number, rows: number) {
  const verts: number[] = [];
  const indices: number[] = [];
  const n = Math.min(left.length, right.length);
  for (let r = 0; r <= rows; r++) {
    const z = z0 + (r / rows) * (z1 - z0);
    for (let i = 0; i < n; i++) {
      verts.push(left[i].x, left[i].y, z);
      verts.push(right[i].x, right[i].y, z);
    }
  }
  const stride = n * 2;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * stride + i * 2;
      const b = a + 1;
      const d = a + stride;
      const c = d + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  return { verts, indices };
}

/** U in X-Y, extrude along local Z. size = [innerWidth, depth, length]. Floor y ≈ 0.9. Open +Z. */
function buildPipe(w: number, h: number, d: number) {
  const hw = w / 2;
  const hd = d / 2;
  const z0 = -hd;
  const z1 = hd;
  const cols = 48;
  const rows = Math.max(2, Math.ceil(d / 20));
  const a = 4 * h;
  const inner: XY[] = [];
  const outer: XY[] = [];
  const floorY = parabolaY(0.5, h, 1);
  const flat = 4;
  for (let i = 0; i <= cols; i++) {
    const s = i / cols;
    const x = (s - 0.5) * w;
    const y = Math.abs(x) <= flat ? floorY : parabolaY(s, h, 1);
    const dx = w;
    const dy = Math.abs(x) <= flat ? 0 : 2 * a * (s - 0.5);
    const len = Math.hypot(-dy, dx) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    inner.push({ x, y });
    outer.push({ x: x - nx * PIPE_THICK, y: y - ny * PIPE_THICK });
  }
  const oL = outer[0];
  const oR = outer[outer.length - 1];
  const groundY = 0.12;
  const bermL: XY[] = [
    oL,
    { x: oL.x - BERM * 0.28, y: Math.max(groundY, oL.y - 0.6) },
    { x: oL.x - BERM * 0.62, y: Math.max(groundY, oL.y * 0.45) },
    { x: oL.x - BERM, y: groundY },
  ];
  const bermR: XY[] = [
    oR,
    { x: oR.x + BERM * 0.28, y: Math.max(groundY, oR.y - 0.6) },
    { x: oR.x + BERM * 0.62, y: Math.max(groundY, oR.y * 0.45) },
    { x: oR.x + BERM, y: groundY },
  ];

  const innerMesh = extrudeRibbon(inner, z0, z1, rows, false);
  const outerMesh = extrudeRibbon(outer, z0, z1, rows, true);
  const bermLMesh = extrudeRibbon([...bermL].reverse(), z0, z1, rows, false);
  const bermRMesh = extrudeRibbon(bermR, z0, z1, rows, false);
  const lipL = stripPair([inner[0]], [outer[0]], z0, z1, rows);
  const lipR = stripPair([outer[outer.length - 1]], [inner[inner.length - 1]], z0, z1, rows);

  const grassBits = stitch(stitch(stitch(outerMesh, bermLMesh), bermRMesh), stitch(lipL, lipR));
  const collider = innerMesh;

  const lipY = parabolaY(0, h, 1);
  return {
    concrete: geoFrom(innerMesh.verts, innerMesh.indices),
    grass: geoFrom(grassBits.verts, grassBits.indices),
    collider: geoFrom(collider.verts, collider.indices),
    rails: [
      { pos: [-hw, lipY + RAIL_H / 2, 0] as [number, number, number], half: [RAIL_T / 2, RAIL_H / 2, hd] as [number, number, number] },
      { pos: [hw, lipY + RAIL_H / 2, 0] as [number, number, number], half: [RAIL_T / 2, RAIL_H / 2, hd] as [number, number, number] },
    ],
  };
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
  const meshRef = useRef<THREE.Mesh>(null);
  const selected = useBay((s) => s.selected === id);
  const [w, h, d] = size ?? [8, 8, 22];
  const cut = cutArg != null && cutArg > 0.2 ? cutArg : CUT;
  const mu = grip ?? 0.55;
  const rest = bounce ?? 0;
  const grade = gradeArg ?? 0;
  const yaw = rot?.[1] ?? 0;
  const alongZ = cut >= 0.99 && Math.abs(yaw) < 0.2;

  const hill = useMemo(() => (alongZ ? null : buildHill(w, h, d, cut, grade)), [alongZ, w, h, d, cut, grade]);
  const pipe = useMemo(() => (alongZ ? buildPipe(w, h, d) : null), [alongZ, w, h, d]);

  useEffect(() => {
    registerBody(
      id,
      "ramp",
      () => poseOf(r.current, { ramp: true, hill: true, grip: mu, sx: w, sy: h, sz: d, roughness: 0.86, metalness: 0.04 }),
      () => r.current,
      () => meshRef.current,
    );
    return () => unregisterBody(id);
  }, [id, mu, w, h, d]);

  useEffect(
    () => () => {
      hill?.geo.dispose();
      pipe?.concrete.dispose();
      pipe?.grass.dispose();
      pipe?.collider.dispose();
    },
    [hill, pipe],
  );

  const colliderGeo = pipe?.collider ?? hill!.geo;

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
      <TrimeshCollider
        args={[colliderGeo.attributes.position.array as Float32Array, colliderGeo.index!.array as Uint32Array]}
        collisionGroups={GROUPS}
        friction={mu}
        restitution={rest}
      />
      {pipe ? (
        <>
          <mesh ref={meshRef} geometry={pipe.concrete} receiveShadow castShadow frustumCulled>
            <meshStandardMaterial
              color={selected ? 0xc4c6c1 : concrete}
              roughness={0.86}
              metalness={0.04}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh geometry={pipe.grass} receiveShadow frustumCulled>
            <meshStandardMaterial color={grass} roughness={0.92} metalness={0} side={THREE.DoubleSide} />
          </mesh>
          {pipe.rails.map((rail, i) => (
            <CuboidCollider
              key={`col-${i}`}
              args={rail.half}
              position={rail.pos}
              collisionGroups={GROUPS}
              friction={0.55}
              restitution={0}
            />
          ))}
          {pipe.rails.map((rail, i) => (
            <mesh key={`rail-${i}`} position={rail.pos} castShadow receiveShadow>
              <boxGeometry args={[rail.half[0] * 2, rail.half[1] * 2, rail.half[2] * 2]} />
              <meshStandardMaterial color={railCol} roughness={0.45} metalness={0.35} />
            </mesh>
          ))}
        </>
      ) : (
        <>
          <mesh ref={meshRef} geometry={hill!.geo} receiveShadow frustumCulled>
            <meshStandardMaterial
              color={selected ? 0xd4d7cf : dirt}
              roughness={0.82}
              metalness={0.04}
              side={THREE.DoubleSide}
              shadowSide={THREE.DoubleSide}
            />
          </mesh>
          <mesh position={[0, parabolaY(0, h, cut) + 0.02, -d / 2 + 0.02]}>
            <boxGeometry args={[w * 0.98, 0.04, 0.04]} />
            <meshStandardMaterial color={dirtHi} roughness={0.9} metalness={0} />
          </mesh>
        </>
      )}
    </RigidBody>
  );
}

export { Ramp as Hill };
