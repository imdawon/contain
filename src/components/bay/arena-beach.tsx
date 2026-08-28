import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ArenaDeck, ArenaFloor, ArenaMound, type PaintFn } from "@/components/bay/arena-ground";

const sand: PaintFn = (n, y, stripe, sun) => [
  0.78 + stripe * 0.08 + sun * 0.1 - n * 0.06,
  0.64 + stripe * 0.06 + sun * 0.08,
  0.38 + stripe * 0.04,
];

function shore(x: number, z: number): [number, number, number] {
  const wet = Math.max(0, 1 - Math.abs(x - 7.4) / 9);
  return [0.82 - wet * 0.18, 0.68 - wet * 0.12, 0.4 - wet * 0.02];
}

function Ocean() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.uniforms.uT.value = clock.elapsedTime;
  });
  return (
    <mesh position={[11, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} userData={{ labSkip: true }}>
      <planeGeometry args={[36, 80, 8, 8]} />
      <shaderMaterial
        ref={mat}
        transparent
        depthWrite={false}
        uniforms={{ uT: { value: 0 } }}
        vertexShader={`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`}
        fragmentShader={`
          varying vec2 vUv; uniform float uT;
          void main() {
            float w = sin(vUv.y * 28.0 + uT * 1.8) * 0.04 + sin(vUv.x * 18.0 - uT * 1.1) * 0.03;
            vec3 deep = vec3(0.08, 0.38, 0.55);
            vec3 lite = vec3(0.42, 0.78, 0.82);
            vec3 foam = vec3(0.92, 0.97, 0.96);
            float shore = smoothstep(0.0, 0.18, vUv.x);
            vec3 c = mix(foam, mix(lite, deep, vUv.x), shore);
            c += w;
            gl_FragColor = vec4(c, 0.92);
          }
        `}
      />
    </mesh>
  );
}

function Palm({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 1.5, 0]} rotation={[0.12, 0, 0.08]} castShadow>
        <cylinderGeometry args={[0.12, 0.2, 3.1, 7]} />
        <meshStandardMaterial color="#7a5230" roughness={0.86} />
      </mesh>
      {[0, 1.2, 2.4, 3.6, 4.8].map((a) => (
        <mesh key={a} position={[Math.sin(a) * 0.7, 3.15, Math.cos(a) * 0.7]} rotation={[0.9, a, 0]} castShadow>
          <coneGeometry args={[0.22, 1.5, 5]} />
          <meshStandardMaterial color="#3d9a48" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function Umbrella({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.8, 6]} />
        <meshStandardMaterial color="#eee8dc" />
      </mesh>
      <mesh position={[0, 1.78, 0]} rotation={[0, 0.4, 0]}>
        <coneGeometry args={[1.05, 0.35, 8]} />
        <meshStandardMaterial color="#e23b4a" roughness={0.55} />
      </mesh>
    </group>
  );
}

function Castle({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[1.1, 0.44, 0.9]} />
        <meshStandardMaterial color="#e8d2a0" roughness={0.9} />
      </mesh>
      <mesh position={[-0.4, 0.52, 0.2]} castShadow>
        <boxGeometry args={[0.28, 0.38, 0.28]} />
        <meshStandardMaterial color="#edd8aa" />
      </mesh>
      <mesh position={[0.38, 0.48, -0.15]} castShadow>
        <boxGeometry args={[0.24, 0.3, 0.24]} />
        <meshStandardMaterial color="#edd8aa" />
      </mesh>
    </group>
  );
}

function Gulls() {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.elapsedTime;
    g.current.position.set(Math.sin(t * 0.35) * 10, 6.5 + Math.sin(t) * 0.4, Math.cos(t * 0.28) * 12);
  });
  return (
    <group ref={g} userData={{ labSkip: true }}>
      {[-0.8, 0.2, 0.9].map((x, i) => (
        <mesh key={i} position={[x, i * 0.2, i * 0.4]} rotation={[0.2, 0.4, 0]}>
          <planeGeometry args={[0.55, 0.12]} />
          <meshBasicMaterial color="#f4f7fa" side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

export function Beach() {
  const paint = useMemo(() => sand, []);
  const floor = useMemo(() => shore, []);
  return (
    <group>
      <ArenaFloor paint={floor} />
      <ArenaMound pos={[0, 0, -20.2]} radius={9.4} height={3.42} paint={paint} friction={0.78} />
      <ArenaMound pos={[0, 0, 20.4]} radius={10.6} height={3.5} paint={paint} friction={0.78} />
      <ArenaDeck pos={[0, 3.47, -20.2]} color="#d7b56a" />
      <ArenaDeck pos={[0, 3.55, 20.4]} color="#d7b56a" />
      <Ocean />
      <Palm pos={[-7.4, 0, -11]} s={1.15} />
      <Palm pos={[-8.6, 0, 3.2]} s={0.95} />
      <Palm pos={[6.8, 0, -6]} s={1.05} />
      <Palm pos={[7.6, 0, 12.4]} s={1.25} />
      <Palm pos={[-6.2, 0, 16]} s={0.85} />
      <Umbrella pos={[-3.4, 0, -7.2]} />
      <Castle pos={[2.8, 0, -3.4]} />
      <mesh position={[-2.8, 0.04, -6.6]} rotation={[-Math.PI / 2, 0, 0.4]} receiveShadow>
        <planeGeometry args={[1.4, 0.8]} />
        <meshStandardMaterial color="#3d7ad6" roughness={0.7} />
      </mesh>
      <Gulls />
    </group>
  );
}
