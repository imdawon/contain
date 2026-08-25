import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { MATERIALS, PHONE } from "@/lib/contain/catalog";
import { bits } from "@/lib/contain/bodies";
import { chamberLayout, type PieceId } from "@/lib/contain/layout";
import { runtime } from "@/lib/contain/runtime";
import type { ChemistryId, MaterialId } from "@/lib/contain/types";

const tmp = new THREE.Color();

export function VesselShell({
  materialId,
  maps,
}: {
  materialId: MaterialId;
  maps: { cardboard: THREE.Texture; steel: THREE.Texture };
}) {
  const mat = MATERIALS[materialId];
  const layout = useMemo(() => chamberLayout(materialId), [materialId]);
  const map = materialId === "steel" ? maps.steel : materialId === "cardboard" ? maps.cardboard : undefined;
  const meshRefs = useRef<Record<string, THREE.Mesh | null>>({});
  const matRefs = useRef<Record<string, THREE.MeshStandardMaterial | null>>({});

  useFrame(() => {
    const bulge = runtime.show.bulge;
    const meltY =
      runtime.thermal.melted
        ? Math.max(0.28, 1 - (runtime.thermal.boxC - 158) / 280)
        : 1;
    const char = runtime.show.char;
    for (const piece of layout.pieces) {
      if (piece.id === "front") continue;
      const mesh = meshRefs.current[piece.id];
      const body = bits.find((b) => b.id === piece.id);
      if (!mesh || !body) continue;
      mesh.position.set(body.pos[0], body.pos[1], body.pos[2]);
      mesh.rotation.set(body.rot[0], body.rot[1], body.rot[2]);
      const sx = 1 + bulge * (piece.id === "left" || piece.id === "right" ? 0.02 : 0.09);
      const sz = 1 + bulge * (piece.id === "back" ? 0.02 : 0.11);
      const sy = piece.id === "bottom" || piece.id === "lid" ? 1 : meltY;
      mesh.scale.set(sx, sy, sz);
      const m = matRefs.current[piece.id];
      if (!m) continue;
      if (materialId === "cardboard") {
        tmp.setHex(0xc4a574).lerp(tmp.setHex(0x2a1810), char);
        m.color.copy(tmp.setHex(0xc4a574).lerp(new THREE.Color(0x2a1810), char));
        if (runtime.thermal.burning) {
          m.emissive.set("#c45a20");
          m.emissiveIntensity = 0.9 + Math.sin(runtime.thermal.t * 18) * 0.3;
        } else {
          m.emissive.set("#000");
          m.emissiveIntensity = 0;
        }
      } else {
        const glow = runtime.show.glow;
        m.emissive.setRGB(0.7 * glow, 0.18 * glow, 0.04 * glow);
        m.emissiveIntensity = glow * 1.6;
      }
    }
    const shardBits = bits.filter((b) => b.id === "shard");
    for (let i = 0; i < 12; i++) {
      const mesh = meshRefs.current[`shard-${i}`];
      const b = shardBits[i];
      if (!mesh) continue;
      if (!b) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      mesh.rotation.set(b.rot[0], b.rot[1], b.rot[2]);
    }
  });

  return (
    <group>
      {layout.pieces.map((piece) => {
        const ghost = piece.id === "front";
        return (
          <mesh
            key={`${materialId}-${piece.id}`}
            ref={(el) => {
              meshRefs.current[piece.id] = el;
            }}
            position={piece.pos}

          >
            <boxGeometry args={piece.size} />
            <meshStandardMaterial
              ref={(el) => {
                matRefs.current[piece.id] = el;
              }}
              map={ghost ? undefined : map}
              color={ghost ? 0x9aa48c : mat.color}
              roughness={mat.roughness}
              metalness={mat.metalness}
              transparent={ghost || materialId === "plastic"}
              opacity={ghost ? 0.16 : materialId === "plastic" ? 0.52 : 1}
              depthWrite={!ghost}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh
          key={`shard-${i}`}
          ref={(el) => {
            meshRefs.current[`shard-${i}`] = el;
          }}
          visible={false}
        >
          <boxGeometry args={[0.05, 0.016, 0.038]} />
          <meshStandardMaterial color={mat.color} roughness={0.5} metalness={mat.metalness} />
        </mesh>
      ))}
      {materialId === "steel" ? <AmmoBits layout={layout} map={maps.steel} /> : null}
      {materialId === "plastic" ? <ToteBits layout={layout} /> : null}
      {materialId === "cardboard" ? <Tape layout={layout} /> : null}
    </group>
  );
}

function AmmoBits({
  layout,
  map,
}: {
  layout: ReturnType<typeof chamberLayout>;
  map: THREE.Texture;
}) {
  const w = layout.inner.w + layout.t * 2;
  const d = layout.inner.d + layout.t * 2;
  return (
    <group>
      <mesh position={[0, layout.t * 0.55, d / 2 + 0.005]}>
        <boxGeometry args={[w * 0.72, 0.02, 0.012]} />
        <meshStandardMaterial color="#2a2e24" metalness={0.7} roughness={0.38} map={map} />
      </mesh>

    </group>
  );
}

function ToteBits({ layout }: { layout: ReturnType<typeof chamberLayout> }) {
  const y = layout.inner.h + layout.t * 0.85;
  const x = (layout.inner.w + layout.t) / 2 + 0.018;
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * x, y, 0]} rotation={[Math.PI / 2, 0, s * Math.PI / 2]}>
          <torusGeometry args={[0.05, 0.011, 8, 18]} />
          <meshStandardMaterial color="#1c2428" roughness={0.32} metalness={0.04} />
        </mesh>
      ))}
    </group>
  );
}

function Tape({ layout }: { layout: ReturnType<typeof chamberLayout> }) {
  const lid = bits.find((b) => b.id === "lid");
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ref.current || !lid) return;
    ref.current.position.set(lid.pos[0], lid.pos[1] + 0.01, lid.pos[2]);
    ref.current.rotation.set(lid.rot[0], lid.rot[1], lid.rot[2]);
  });
  return (
    <mesh ref={ref} position={[0, layout.inner.h + layout.t * 2, 0]}>
      <boxGeometry args={[layout.inner.w * 0.9, 0.01, 0.048]} />
      <meshStandardMaterial color="#c9b36a" roughness={0.7} />
    </mesh>
  );
}

export function PhoneRig({
  chemistry,
  origin,
}: {
  chemistry: ChemistryId;
  origin: [number, number, number];
}) {
  const body = useRef<THREE.MeshStandardMaterial>(null);
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const group = useRef<THREE.Group>(null);
  const vel = useRef({ x: 0, y: 0, z: 0, wx: 0, wy: 0, flying: false });

  useFrame((_, dt) => {
    const s = runtime.thermal;
    const heat = THREE.MathUtils.clamp((s.cellC - 70) / 500, 0, 1);
    if (body.current) {
      body.current.emissive.setRGB(1 * heat, 0.16 * heat, 0.02 * heat);
      body.current.emissiveIntensity = heat * 4.6;
    }
    if (screen.current) {
      const dead = s.phase === "spent" || s.phase === "ended";
      screen.current.emissive.setRGB(dead ? 0.02 : 0.95 * heat + 0.02, dead ? 0.02 : 0.28 * heat, 0.04);
      screen.current.emissiveIntensity = dead ? 0.08 : 0.4 + heat * 7;
    }
    const g = group.current;
    if (!g) return;
    if (s.failure === "burst" && !vel.current.flying) {
      vel.current.flying = true;
      vel.current.x = (Math.random() - 0.5) * 1.8;
      vel.current.y = 2.4 + Math.random();
      vel.current.z = (Math.random() - 0.5) * 1.8;
      vel.current.wx = 8;
      vel.current.wy = 5;
    }
    if (vel.current.flying) {
      vel.current.y -= 9.8 * dt;
      g.position.x += vel.current.x * dt;
      g.position.y += vel.current.y * dt;
      g.position.z += vel.current.z * dt;
      g.rotation.x += vel.current.wx * dt;
      g.rotation.y += vel.current.wy * dt;
      if (g.position.y < 0.04) {
        g.position.y = 0.04;
        vel.current.y *= -0.25;
        vel.current.x *= 0.6;
      }
    } else {
      const swell = 1 + THREE.MathUtils.clamp((s.cellC - 160) / 700, 0, 0.16);
      g.position.set(origin[0], origin[1], origin[2]);
      g.scale.set(swell, 1, swell * 1.06);
      g.rotation.set(
        Math.sin(s.t * 38) * runtime.show.rattle * 0.045,
        0,
        Math.cos(s.t * 31) * runtime.show.rattle * 0.04,
      );
    }
  });

  return (
    <group ref={group} position={origin}>
      <mesh>
        <boxGeometry args={[PHONE.w, PHONE.h, PHONE.d]} />
        <meshStandardMaterial
          ref={body}
          color={chemistry === "nmc" ? "#1b1c1f" : "#262a2e"}
          roughness={0.28}
          metalness={0.65}
        />
      </mesh>
      <mesh position={[0, 0.002, PHONE.d / 2 + 0.0008]}>
        <boxGeometry args={[PHONE.w * 0.88, PHONE.h * 0.86, 0.0016]} />
        <meshStandardMaterial ref={screen} color="#050608" roughness={0.12} metalness={0.4} />
      </mesh>
      <mesh position={[0, PHONE.h * 0.38, PHONE.d / 2 + 0.0016]}>
        <cylinderGeometry args={[0.0048, 0.0048, 0.003, 12]} />
        <meshStandardMaterial color="#111" metalness={0.8} roughness={0.25} />
      </mesh>
    </group>
  );
}

export function NailRig() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const target = runtime.thermal.phase === "idle" ? 0 : 1;
    runtime.show.nail += (target - runtime.show.nail) * Math.min(1, dt * (target > 0.5 ? 22 : 5));
    const t = runtime.show.nail;
    if (!ref.current) return;
    ref.current.position.set(0.018, 0.05 + 0.2 * (1 - t), 0.028);
    ref.current.rotation.set(-0.95 - t * 0.55, 0.12, 0.35);
  });
  return (
    <group ref={ref}>
      <mesh>
        <cylinderGeometry args={[0.0024, 0.0015, 0.14, 8]} />
        <meshStandardMaterial color="#c9cdc4" metalness={0.9} roughness={0.22} />
      </mesh>
      <mesh position={[0, 0.072, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.004, 12]} />
        <meshStandardMaterial color="#d8dcd4" metalness={0.85} roughness={0.28} />
      </mesh>
    </group>
  );
}

export type { PieceId };
