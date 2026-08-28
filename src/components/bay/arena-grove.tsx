import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ArenaDeck, ArenaFloor, ArenaMound, type PaintFn } from "@/components/bay/arena-ground";

const moss: PaintFn = (n, y, stripe, sun) => [
  0.22 + stripe * 0.06 + sun * 0.08,
  0.38 + stripe * 0.12 + sun * 0.1 - n * 0.04,
  0.16 + stripe * 0.04,
];

function dirt(x: number, z: number): [number, number, number] {
  const path = Math.max(0, 1 - Math.abs(x) / 2.4);
  const mossN = 0.5 + 0.5 * Math.sin(x * 0.7 + z * 0.4);
  if (path > 0.45) return [0.36, 0.26, 0.16];
  return [0.16 + mossN * 0.06, 0.32 + mossN * 0.12, 0.14];
}

function Pine({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.22, 2.2, 7]} />
        <meshStandardMaterial color="#4a3424" roughness={0.9} />
      </mesh>
      {[2.4, 3.5, 4.5].map((y, i) => (
        <mesh key={y} position={[0, y, 0]} castShadow>
          <coneGeometry args={[1.35 - i * 0.28, 1.8, 7]} />
          <meshStandardMaterial color={i ? "#2f6a38" : "#275c30"} roughness={0.78} />
        </mesh>
      ))}
    </group>
  );
}

function Log({ pos, rot = 0 }: { pos: [number, number, number]; rot?: number }) {
  return (
    <mesh position={pos} rotation={[0, rot, 0.12]} castShadow receiveShadow>
      <cylinderGeometry args={[0.22, 0.26, 2.4, 8]} />
      <meshStandardMaterial color="#5a3c24" roughness={0.9} />
    </mesh>
  );
}

function Cap({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.2, 5]} />
        <meshStandardMaterial color="#efe4c8" />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <sphereGeometry args={[0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#d23b3b" roughness={0.55} />
      </mesh>
    </group>
  );
}

function Fireflies() {
  const g = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = g.current;
    if (!m) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < 18; i++) {
      dummy.position.set(Math.sin(t * 0.6 + i) * 6, 0.6 + Math.sin(t * 1.7 + i * 0.4) * 0.5, Math.cos(t * 0.5 + i * 0.7) * 10);
      dummy.scale.setScalar(0.6 + (Math.sin(t * 8 + i) * 0.5 + 0.5));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={g} args={[undefined, undefined, 18]} userData={{ labSkip: true }}>
      <sphereGeometry args={[0.05, 6, 6]} />
      <meshBasicMaterial color="#d6ff6a" />
    </instancedMesh>
  );
}

function Campfire() {
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.intensity = 5 + Math.sin(clock.elapsedTime * 9) * 1.2;
  });
  return (
    <group position={[3.4, 0, 4.2]}>
      {[-0.18, 0.16].map((x, i) => (
        <mesh key={i} position={[x, 0.08, 0]} rotation={[0.2, i, 0.4]}>
          <cylinderGeometry args={[0.05, 0.06, 0.5, 5]} />
          <meshStandardMaterial color="#4a3018" />
        </mesh>
      ))}
      <mesh position={[0, 0.22, 0]}>
        <coneGeometry args={[0.16, 0.38, 6]} />
        <meshBasicMaterial color="#ff6a20" />
      </mesh>
      <pointLight ref={light} position={[0, 0.4, 0]} color="#ff7a30" distance={9} />
    </group>
  );
}

export function Grove() {
  const paint = useMemo(() => moss, []);
  const floor = useMemo(() => dirt, []);
  return (
    <group>
      <ArenaFloor paint={floor} />
      <ArenaMound pos={[0, 0, -20.2]} radius={9.4} height={3.42} paint={paint} />
      <ArenaMound pos={[0, 0, 20.4]} radius={10.6} height={3.5} paint={paint} />
      <ArenaDeck pos={[0, 3.47, -20.2]} color="#3d5c32" />
      <ArenaDeck pos={[0, 3.55, 20.4]} color="#3d5c32" />
      <Pine pos={[-8.4, 0, -12]} s={1.2} />
      <Pine pos={[-9.6, 0, -4]} s={1.05} />
      <Pine pos={[-7.8, 0, 6]} s={1.3} />
      <Pine pos={[-8.8, 0, 16]} s={0.95} />
      <Pine pos={[8.6, 0, -10]} s={1.15} />
      <Pine pos={[9.4, 0, 2]} s={1.25} />
      <Pine pos={[8.2, 0, 14]} s={1.05} />
      <Pine pos={[7.4, 0, -18]} s={0.9} />
      <Log pos={[-2.6, 0.2, -6.4]} rot={0.7} />
      <Log pos={[2.8, 0.18, 5.6]} rot={-0.5} />
      <Cap pos={[-2.2, 0.08, -7.1]} s={1.1} />
      <Cap pos={[-2.6, 0.08, -6.6]} s={0.7} />
      <Cap pos={[3.1, 0.08, 6.2]} />
      <Campfire />
      <Fireflies />
    </group>
  );
}
