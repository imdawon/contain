import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ArenaDeck, ArenaFloor, ArenaMound, type PaintFn } from "@/components/bay/arena-ground";

const stone: PaintFn = (n, y, stripe, sun) => [
  0.38 + stripe * 0.08 + sun * 0.12 - n * 0.04,
  0.32 + stripe * 0.05 + sun * 0.08,
  0.26 + stripe * 0.04,
];

function cobble(x: number, z: number): [number, number, number] {
  const cell = (Math.sin(x * 3.4) * Math.sin(z * 3.1) + 1) * 0.5;
  const moat = Math.max(0, 1 - Math.abs(x - Math.sin(z * 0.3) * 1.2) / 2.1) * Math.max(0, 1 - Math.abs(z) / 9);
  if (moat > 0.35) return [0.1, 0.2, 0.28];
  return [0.34 + cell * 0.08, 0.32 + cell * 0.05, 0.3 + cell * 0.04];
}

function Banner({ pos, hue }: { pos: [number, number, number]; hue: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (mesh.current) mesh.current.rotation.y = Math.sin(clock.elapsedTime * 1.6 + hue) * 0.18;
  });
  return (
    <group position={pos}>
      <mesh position={[0, 1.4, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 2.8, 6]} />
        <meshStandardMaterial color="#4a3828" roughness={0.8} />
      </mesh>
      <mesh ref={mesh} position={[0.38, 2.15, 0]} castShadow>
        <planeGeometry args={[0.7, 0.9]} />
        <meshStandardMaterial color={hue < 0.5 ? "#b4232c" : "#d4a017"} side={THREE.DoubleSide} roughness={0.62} />
      </mesh>
    </group>
  );
}

function Crenel({ pos }: { pos: [number, number, number] }) {
  return (
    <mesh position={pos} castShadow receiveShadow>
      <boxGeometry args={[0.42, 0.55, 0.32]} />
      <meshStandardMaterial color="#6a6158" roughness={0.88} />
    </mesh>
  );
}

function Torch({ pos }: { pos: [number, number, number] }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.intensity = 4.2 + Math.sin(clock.elapsedTime * 11) * 0.8;
  });
  return (
    <group position={pos}>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.7, 6]} />
        <meshStandardMaterial color="#3a2a1c" />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <coneGeometry args={[0.1, 0.28, 6]} />
        <meshBasicMaterial color="#ff7a2a" />
      </mesh>
      <pointLight ref={light} position={[0, 0.8, 0]} color="#ff8a30" distance={8} />
    </group>
  );
}

function Gate() {
  return (
    <group position={[0, 0, 0]}>
      <mesh position={[-1.55, 1.6, 0]} castShadow>
        <boxGeometry args={[0.7, 3.2, 0.7]} />
        <meshStandardMaterial color="#5c564c" roughness={0.86} />
      </mesh>
      <mesh position={[1.55, 1.6, 0]} castShadow>
        <boxGeometry args={[0.7, 3.2, 0.7]} />
        <meshStandardMaterial color="#5c564c" roughness={0.86} />
      </mesh>
      <mesh position={[0, 3.05, 0]} castShadow>
        <boxGeometry args={[3.8, 0.45, 0.7]} />
        <meshStandardMaterial color="#4e4840" roughness={0.84} />
      </mesh>
    </group>
  );
}

function Bridge() {
  return (
    <group position={[0, 0.22, 0]} rotation={[0, 0.04, 0]}>
      {[-1.1, -0.35, 0.35, 1.1].map((z) => (
        <mesh key={z} position={[0, 0.08, z]} receiveShadow castShadow>
          <boxGeometry args={[1.35, 0.1, 0.55]} />
          <meshStandardMaterial color="#7a5230" roughness={0.82} />
        </mesh>
      ))}
    </group>
  );
}

export function Keep() {
  const paint = useMemo(() => stone, []);
  const floor = useMemo(() => cobble, []);
  return (
    <group>
      <ArenaFloor paint={floor} />
      <ArenaMound pos={[0, 0, -20.2]} radius={9.4} height={3.42} paint={paint} />
      <ArenaMound pos={[0, 0, 20.4]} radius={10.6} height={3.5} paint={paint} />
      <ArenaDeck pos={[0, 3.47, -20.2]} color="#6a6158" />
      <ArenaDeck pos={[0, 3.55, 20.4]} color="#6a6158" />
      <Gate />
      <Bridge />
      {[-2.4, -0.8, 0.8, 2.4].map((a, i) => (
        <Crenel key={`n${i}`} pos={[Math.sin(a) * 3.4, 3.72, -20.2 + Math.cos(a) * 3.4]} />
      ))}
      {[-2.2, -0.7, 0.7, 2.2].map((a, i) => (
        <Crenel key={`f${i}`} pos={[Math.sin(a) * 3.6, 3.82, 20.4 + Math.cos(a) * 3.6]} />
      ))}
      <Banner pos={[-3.6, 0, -12]} hue={0.1} />
      <Banner pos={[3.8, 0, -8.4]} hue={0.7} />
      <Banner pos={[-4.2, 0, 9]} hue={0.3} />
      <Banner pos={[4.1, 0, 14]} hue={0.9} />
      <Torch pos={[-2.1, 0, -6.2]} />
      <Torch pos={[2.2, 0, -5.8]} />
      <Torch pos={[-2.0, 0, 6.4]} />
      <Torch pos={[2.4, 0, 7.1]} />
      {[-8.2, 8.4].map((x, i) => (
        <mesh key={i} position={[x, 2.4, i ? 4 : -4]} castShadow>
          <cylinderGeometry args={[0.55, 0.7, 4.8, 8]} />
          <meshStandardMaterial color="#5a544c" roughness={0.9} />
        </mesh>
      ))}
      {[-7.2, 7.2].map((x) => (
        <mesh key={`w${x}`} position={[x, 1.1, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.55, 2.2, 18]} />
          <meshStandardMaterial color="#5c564e" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
