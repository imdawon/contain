import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { note, registerBody, unregisterBody } from "@/lib/bay/probe";

/** Visual launcher. No collider — the dummy and coil spawn in front of the muzzle. */
export function Cannon({
  id,
  pos,
  rot,
  size,
}: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  size?: [number, number, number];
}) {
  const bore = Math.max(0.18, size?.[0] ?? 0.42);
  const length = Math.max(1.2, size?.[1] ?? 3.2);
  const big = bore > 0.9;
  const flash = useRef<THREE.PointLight>(null);
  const born = useRef(0);

  useEffect(() => {
    registerBody(id, "cannon", () => ({
      x: pos[0],
      y: pos[1],
      z: pos[2],
      rx: rot?.[0] ?? 0,
      ry: rot?.[1] ?? 0,
      rz: rot?.[2] ?? 0,
      state: { missing: false, cannon: true },
    }));
    note("spawn", { kind: "cannon", id });
    return () => unregisterBody(id);
  }, [id, pos, rot]);

  useFrame(({ clock }) => {
    if (!born.current) born.current = clock.elapsedTime;
    const age = clock.elapsedTime - born.current;
    if (flash.current) flash.current.intensity = age < 0.28 ? 22 * (1 - age / 0.28) : 0;
  });

  const iron = big ? 0x5c6168 : 0x4a453c;
  const wood = 0x6a4e32;
  const ring = 0x2e2c28;
  const segs = useMemo(() => (big ? 20 : 12), [big]);

  return (
    <group position={pos} rotation={rot ?? [0, 0, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -length * 0.08]} castShadow receiveShadow>
        <cylinderGeometry args={[bore, bore * 1.12, length, segs]} />
        <meshStandardMaterial color={iron} metalness={big ? 0.55 : 0.28} roughness={0.46} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, length * 0.42]} castShadow>
        <cylinderGeometry args={[bore * 1.18, bore * 1.22, length * 0.12, segs]} />
        <meshStandardMaterial color={ring} metalness={0.6} roughness={0.38} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -length * 0.52]} castShadow>
        <cylinderGeometry args={[bore * 1.08, bore * 0.55, length * 0.22, segs]} />
        <meshStandardMaterial color={ring} metalness={0.5} roughness={0.42} />
      </mesh>
      {!big ? (
        <group position={[0, -bore * 1.15, -length * 0.22]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[bore * 2.4, bore * 0.55, length * 0.7]} />
            <meshStandardMaterial color={wood} roughness={0.84} metalness={0.04} />
          </mesh>
          <mesh position={[-bore * 1.15, -bore * 0.55, 0.1]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[bore * 0.55, bore * 0.55, 0.12, 12]} />
            <meshStandardMaterial color={0x2a2622} metalness={0.3} roughness={0.55} />
          </mesh>
          <mesh position={[bore * 1.15, -bore * 0.55, 0.1]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[bore * 0.55, bore * 0.55, 0.12, 12]} />
            <meshStandardMaterial color={0x2a2622} metalness={0.3} roughness={0.55} />
          </mesh>
        </group>
      ) : (
        <mesh position={[0, -bore * 1.35, -length * 0.18]} castShadow receiveShadow>
          <boxGeometry args={[bore * 2.6, bore * 0.7, length * 0.5]} />
          <meshStandardMaterial color={0x3a3d42} metalness={0.4} roughness={0.5} />
        </mesh>
      )}
      <pointLight ref={flash} position={[0, 0, length * 0.55]} color="#ffd7a0" intensity={0} distance={18} />
    </group>
  );
}
