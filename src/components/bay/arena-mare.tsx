import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ArenaDeck, ArenaFloor, ArenaMound, type PaintFn } from "@/components/bay/arena-ground";

const regolith: PaintFn = (n, y, stripe, sun) => [
  0.42 + stripe * 0.08 + sun * 0.12 - n * 0.08,
  0.42 + stripe * 0.06 + sun * 0.1,
  0.4 + stripe * 0.05,
];

function dust(x: number, z: number): [number, number, number] {
  const crater = Math.hypot(x - 4.2, z - 2.4);
  const ring = Math.abs(crater - 3.2) < 0.45 ? 0.12 : 0;
  return [0.36 - ring, 0.36 - ring, 0.34 - ring];
}

function Stars() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 280;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const r = 90 + Math.random() * 40;
      pos[i * 3] = Math.sin(b) * Math.cos(a) * r;
      pos[i * 3 + 1] = Math.abs(Math.cos(b) * r);
      pos[i * 3 + 2] = Math.sin(b) * Math.sin(a) * r;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geo} userData={{ labSkip: true }}>
      <pointsMaterial color="#e8f0ff" size={0.35} sizeAttenuation />
    </points>
  );
}

function Earth() {
  return (
    <group position={[-22, 16, 28]} userData={{ labSkip: true }}>
      <mesh>
        <sphereGeometry args={[4.2, 16, 12]} />
        <meshBasicMaterial color="#3a6ec8" />
      </mesh>
      <mesh>
        <sphereGeometry args={[4.28, 16, 12]} />
        <meshBasicMaterial color="#9ad0ff" transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

function Lander({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.55, 0.9, 8]} />
        <meshStandardMaterial color="#c8ccd0" metalness={0.45} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.22, 0]}>
        <sphereGeometry args={[0.32, 10, 8]} />
        <meshStandardMaterial color="#dce4ea" metalness={0.3} roughness={0.35} />
      </mesh>
      {[-0.7, 0.7].map((x) =>
        [-0.7, 0.7].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.28, z]} rotation={[0.4, 0, x > 0 ? -0.3 : 0.3]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 0.9, 5]} />
            <meshStandardMaterial color="#8a9096" />
          </mesh>
        )),
      )}
    </group>
  );
}

function Dish({ pos }: { pos: [number, number, number] }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.rotation.y = clock.elapsedTime * 0.15;
  });
  return (
    <group position={pos} ref={g}>
      <mesh rotation={[0.9, 0, 0]} castShadow>
        <cylinderGeometry args={[0.9, 0.15, 0.16, 16]} />
        <meshStandardMaterial color="#d0d4d8" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.35, 0.2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 5]} />
        <meshStandardMaterial color="#9aa0a6" />
      </mesh>
    </group>
  );
}

export function Mare() {
  const paint = useMemo(() => regolith, []);
  const floor = useMemo(() => dust, []);
  return (
    <group>
      <ArenaFloor paint={floor} />
      <ArenaMound pos={[0, 0, -20.2]} radius={9.4} height={3.42} paint={paint} friction={0.55} />
      <ArenaMound pos={[0, 0, 20.4]} radius={10.6} height={3.5} paint={paint} friction={0.55} />
      <ArenaDeck pos={[0, 3.47, -20.2]} color="#8a8e92" />
      <ArenaDeck pos={[0, 3.55, 20.4]} color="#8a8e92" />
      <Stars />
      <Earth />
      <Lander pos={[-5.6, 0, -8.2]} />
      <Dish pos={[4.8, 0.2, 6.4]} />
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[2.6, 3.15, 28]} />
        <meshStandardMaterial color="#2e3034" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-6.2, 1.4, 11]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.8, 6]} />
        <meshStandardMaterial color="#c8ccd0" />
      </mesh>
      <mesh position={[-6.2, 2.7, 11.08]}>
        <planeGeometry args={[0.7, 0.45]} />
        <meshStandardMaterial color="#e8eef4" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
