import { ConvexHullCollider, CuboidCollider, RigidBody, interactionGroups } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CRATE_G, DUMMY_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { startCreek, stopCreek } from "@/lib/contain/audio";

const GREEN_G = interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G]);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function moundGeo(radius: number, height: number, segs = 40) {
  const g = new THREE.CircleGeometry(radius, segs);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const plateau = 0.22;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const n = Math.min(1, r / radius);
    const t = n <= plateau ? 0 : (n - plateau) / (1 - plateau);
    const y = height * Math.pow(1 - t, 1.62);
    pos.setY(i, y);
    const stripe = 0.5 + 0.5 * Math.sin(r * 4.1 + z * 0.2);
    const sun = 0.45 + 0.55 * (y / Math.max(0.2, height));
    col[i * 3] = 0.26 + stripe * 0.12 + sun * 0.1;
    col[i * 3 + 1] = 0.62 + stripe * 0.18 + sun * 0.12;
    col[i * 3 + 2] = 0.16 + stripe * 0.04;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function moundHull(radius: number, height: number, segs = 18) {
  const pts: number[] = [];
  const plateau = 0.22;
  const rings = [0.02, 0.22, 0.4, 0.58, 0.74, 0.88, 1];
  for (const n of rings) {
    const u = n <= plateau ? 0 : (n - plateau) / (1 - plateau);
    const y = height * Math.pow(1 - u, 1.62);
    const r = Math.max(0.08, radius * n);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  return pts;
}

function Mound({ pos, radius, height }: { pos: [number, number, number]; radius: number; height: number }) {
  const geo = useMemo(() => moundGeo(radius, height), [radius, height]);
  const hull = useMemo(() => moundHull(radius, height), [radius, height]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <RigidBody type="fixed" position={pos} colliders={false} friction={0.92} restitution={0.05}>
      <ConvexHullCollider args={[hull]} collisionGroups={GREEN_G} friction={0.92} restitution={0.05} />
      <mesh geometry={geo} receiveShadow castShadow>
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0.02} />
      </mesh>
    </RigidBody>
  );
}

function Creek() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(3.2, 18.6, 14, 36);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      pos.setX(i, pos.getX(i) + Math.sin(z * 0.34) * 1.45);
      pos.setY(i, 0.03 + Math.sin(z * 0.9) * 0.012);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.uniforms.uT.value = clock.elapsedTime;
  });
  return (
    <mesh geometry={geo} userData={{ labSkip: true }}>
      <shaderMaterial
        ref={mat}
        transparent
        depthWrite={false}
        uniforms={{ uT: { value: 0 } }}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying vec2 vUv;
          uniform float uT;
          void main() {
            float w = sin(vUv.x * 18.0 + uT * 1.8) * 0.045 + sin(vUv.y * 26.0 - uT * 2.4) * 0.05;
            float bank = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
            vec3 deep = vec3(0.12, 0.42, 0.58);
            vec3 lite = vec3(0.46, 0.84, 0.82);
            vec3 foam = vec3(0.93, 0.98, 0.96);
            vec3 c = mix(deep, lite, 0.42 + w * 4.2);
            c = mix(c, foam, (1.0 - bank) * 0.75);
            gl_FragColor = vec4(c, 0.86 * bank + 0.28);
          }
        `}
      />
    </mesh>
  );
}

function Tree({ pos, s = 1, hue = 0 }: { pos: [number, number, number]; s?: number; hue?: number }) {
  const leafA = hue > 0.5 ? "#2f8f38" : "#3aaa42";
  const leafB = hue > 0.5 ? "#4cbf52" : "#2c7a32";
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 0.78, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.17, 1.55, 6]} />
        <meshStandardMaterial color="#8a5634" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.72, 0]} castShadow>
        <sphereGeometry args={[0.78, 8, 6]} />
        <meshStandardMaterial color={leafA} roughness={0.72} />
      </mesh>
      <mesh position={[0.42, 1.86, 0.12]} castShadow>
        <sphereGeometry args={[0.52, 8, 6]} />
        <meshStandardMaterial color={leafB} roughness={0.74} />
      </mesh>
      <mesh position={[-0.36, 1.78, -0.2]} castShadow>
        <sphereGeometry args={[0.48, 8, 6]} />
        <meshStandardMaterial color="#58c45a" roughness={0.7} />
      </mesh>
    </group>
  );
}

function Flower({ pos, color }: { pos: [number, number, number]; color: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.012, 0.016, 0.24, 4]} />
        <meshStandardMaterial color="#2f7a38" />
      </mesh>
      <mesh position={[0, 0.26, 0]}>
        <sphereGeometry args={[0.055, 6, 5]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.275, 0]}>
        <sphereGeometry args={[0.022, 5, 4]} />
        <meshStandardMaterial color="#ffe566" />
      </mesh>
    </group>
  );
}

function Toadstool({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, 0.24, 6]} />
        <meshStandardMaterial color="#f2e6c9" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.26, 0]} castShadow>
        <sphereGeometry args={[0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#e23b4a" roughness={0.55} />
      </mesh>
      {[[-0.06, 0.3, 0.05], [0.07, 0.28, -0.04], [0.02, 0.32, 0.08]].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]}>
          <sphereGeometry args={[0.028, 5, 4]} />
          <meshStandardMaterial color="#fff6e8" />
        </mesh>
      ))}
    </group>
  );
}

function Reed({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.28, 0]} rotation={[0.08, 0, 0.05]}>
        <cylinderGeometry args={[0.012, 0.02, 0.56, 4]} />
        <meshStandardMaterial color="#3f7a38" />
      </mesh>
      <mesh position={[0.04, 0.22, 0.02]} rotation={[-0.1, 0.4, 0.12]}>
        <cylinderGeometry args={[0.01, 0.016, 0.42, 4]} />
        <meshStandardMaterial color="#4a8a40" />
      </mesh>
    </group>
  );
}

function Tufts() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.ConeGeometry(0.045, 0.16, 5), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3e9a40", roughness: 0.85 }), []);
  const n = 80;
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const r = rng(90210);
    for (let i = 0; i < n; i++) {
      let x = (r() - 0.5) * 22;
      let z = (r() - 0.5) * 48;
      if (Math.abs(x) < 2.6 && Math.abs(z) < 9.5) x += x < 0 ? -3.2 : 3.2;
      dummy.position.set(x, 0.1, z);
      dummy.rotation.set((r() - 0.5) * 0.2, r() * 6, (r() - 0.5) * 0.2);
      dummy.scale.setScalar(0.7 + r() * 1.1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  return <instancedMesh ref={mesh} args={[geo, mat, n]} castShadow={false} receiveShadow />;
}

function Bridge() {
  const plank = "#c4a06a";
  const rail = "#8a6238";
  return (
    <group position={[0, 0.2, 0.2]}>
      {[-1.05, -0.35, 0.35, 1.05].map((x) => (
        <mesh key={x} position={[x, 0.08, 0]} receiveShadow castShadow>
          <boxGeometry args={[0.52, 0.07, 1.35]} />
          <meshStandardMaterial color={plank} roughness={0.86} />
        </mesh>
      ))}
      {[-0.62, 0.62].map((z) => (
        <mesh key={z} position={[0, 0.38, z]} castShadow>
          <boxGeometry args={[2.3, 0.07, 0.06]} />
          <meshStandardMaterial color={rail} roughness={0.8} />
        </mesh>
      ))}
      {[-0.62, 0.62].flatMap((z) =>
        [-1.0, 0, 1.0].map((x) => (
          <mesh key={`${x}:${z}`} position={[x, 0.26, z]} castShadow>
            <boxGeometry args={[0.05, 0.34, 0.05]} />
            <meshStandardMaterial color={rail} roughness={0.8} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Flag() {
  const cloth = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = cloth.current;
    if (!m) return;
    m.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.22;
  });
  return (
    <group position={[3.6, 0, 4.6]}>
      <mesh position={[0, 1.15, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.036, 2.3, 6]} />
        <meshStandardMaterial color="#d8d4cc" metalness={0.35} roughness={0.4} />
      </mesh>
      <mesh ref={cloth} position={[0.32, 2.05, 0]} castShadow>
        <planeGeometry args={[0.64, 0.42]} />
        <meshStandardMaterial color="#ff4b5a" side={THREE.DoubleSide} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.28, 12]} />
        <meshStandardMaterial color="#d7c089" roughness={0.88} />
      </mesh>
    </group>
  );
}

function HoleSign() {
  return (
    <group position={[-3.8, 0, 5.2]} rotation={[0, 0.5, 0]}>
      <mesh position={[-0.28, 0.42, 0]} castShadow>
        <boxGeometry args={[0.06, 0.84, 0.06]} />
        <meshStandardMaterial color="#8a6238" roughness={0.82} />
      </mesh>
      <mesh position={[0.28, 0.42, 0]} castShadow>
        <boxGeometry args={[0.06, 0.84, 0.06]} />
        <meshStandardMaterial color="#8a6238" roughness={0.82} />
      </mesh>
      <mesh position={[0, 0.86, 0]} castShadow>
        <boxGeometry args={[0.92, 0.48, 0.08]} />
        <meshStandardMaterial color="#c9a06a" roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.88, 0.05]}>
        <circleGeometry args={[0.16, 10]} />
        <meshStandardMaterial color="#e23b4a" roughness={0.55} />
      </mesh>
    </group>
  );
}

function Deck({ pos }: { pos: [number, number, number] }) {
  return (
    <RigidBody type="fixed" position={pos} colliders={false} friction={0.9} restitution={0}>
      <CuboidCollider args={[0.85, 0.05, 0.95]} collisionGroups={GREEN_G} friction={0.9} restitution={0} />
      <mesh receiveShadow castShadow>
        <boxGeometry args={[1.7, 0.1, 1.9]} />
        <meshStandardMaterial color="#6f8f3c" roughness={0.78} />
      </mesh>
    </RigidBody>
  );
}

function Cloud({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  return (
    <group position={pos} scale={s} userData={{ labSkip: true }}>
      <mesh>
        <sphereGeometry args={[1.1, 8, 6]} />
        <meshBasicMaterial color="#f4fbff" />
      </mesh>
      <mesh position={[0.9, 0.1, 0.1]}>
        <sphereGeometry args={[0.85, 8, 6]} />
        <meshBasicMaterial color="#eef7ff" />
      </mesh>
      <mesh position={[-0.8, 0.05, -0.15]}>
        <sphereGeometry args={[0.72, 8, 6]} />
        <meshBasicMaterial color="#f7fdff" />
      </mesh>
    </group>
  );
}

function Clouds() {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!g.current) return;
    g.current.position.x += dt * 0.22;
    if (g.current.position.x > 18) g.current.position.x = -18;
  });
  return (
    <group ref={g}>
      <Cloud pos={[-6, 9.5, 6]} s={1.35} />
      <Cloud pos={[3, 11, 14]} s={1.05} />
      <Cloud pos={[8, 8.8, -4]} s={0.85} />
    </group>
  );
}

function Butterflies() {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  const c = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const place = (ref: typeof a, ox: number, oz: number, k: number) => {
      const g = ref.current;
      if (!g) return;
      g.position.set(ox + Math.sin(t * k) * 1.6, 0.7 + Math.sin(t * k * 1.7) * 0.35, oz + Math.cos(t * k * 0.8) * 1.4);
      g.rotation.y = t * k;
      const flap = 0.55 + Math.sin(t * 14 * k) * 0.45;
      const L = g.children[0] as THREE.Mesh | undefined;
      const R = g.children[1] as THREE.Mesh | undefined;
      if (L) L.rotation.z = flap;
      if (R) R.rotation.z = -flap;
    };
    place(a, -2.8, -1.2, 0.7);
    place(b, 2.4, 1.6, 0.9);
    place(c, 1.1, -3.4, 0.55);
  });
  const wing = (color: string) => (
    <>
      <mesh position={[-0.07, 0, 0]} rotation={[0.2, 0, 0.6]}>
        <planeGeometry args={[0.14, 0.1]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.07, 0, 0]} rotation={[0.2, 0, -0.6]}>
        <planeGeometry args={[0.14, 0.1]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
  return (
    <group userData={{ labSkip: true }}>
      <group ref={a}>{wing("#ffb347")}</group>
      <group ref={b}>{wing("#ff6b9d")}</group>
      <group ref={c}>{wing("#ffe066")}</group>
    </group>
  );
}

function Rocks() {
  const spots: [number, number, number, number][] = [
    [-1.9, 0.1, -6.2, 0.22],
    [1.7, 0.09, -5.4, 0.18],
    [-1.6, 0.11, 5.8, 0.26],
    [2.0, 0.08, 6.4, 0.16],
    [1.4, 0.09, 0.4, 0.14],
    [-2.2, 0.1, 1.8, 0.2],
  ];
  return (
    <group>
      {spots.map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} scale={[1, 0.55, 0.85]} rotation={[0, i * 0.7, 0]} castShadow receiveShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={i % 2 ? "#9aa3a0" : "#7d8682"} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Fairway() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(64, 72, 36, 42);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r0 = Math.hypot(x, z + 20.2);
      const r1 = Math.hypot(x, z - 20.4);
      const nearTee = Math.min(r0, r1);
      const stripe = 0.5 + 0.5 * Math.sin(z * 0.55);
      const rough = Math.min(1, Math.hypot(x * 0.7, z * 0.22) / 22);
      const meander = Math.sin(z * 0.34) * 1.45;
      const dx = x - meander;
      const along = Math.max(0, 1 - Math.abs(z) / 9.4);
      const channel = along * (1 - Math.min(1, Math.abs(dx) / 1.85));
      const bed = channel * channel;
      pos.setY(i, 0.09 - bed * 0.16);
      col[i * 3] = 0.18 + stripe * 0.12 + rough * 0.08;
      col[i * 3 + 1] = 0.46 + stripe * 0.2 - rough * 0.12;
      col[i * 3 + 2] = 0.14 + stripe * 0.05;
      if (nearTee < 10) {
        col[i * 3] += 0.04;
        col[i * 3 + 1] += 0.1;
      }
      if (bed > 0.35) {
        col[i * 3] = 0.72 + bed * 0.08;
        col[i * 3 + 1] = 0.58 + bed * 0.04;
        col[i * 3 + 2] = 0.32;
      }
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.94} metalness={0.02} />
    </mesh>
  );
}

export function Green() {
  const flowers = useMemo(() => {
    const r = rng(77);
    const cols = ["#ff5a6a", "#ffe066", "#fff7ee", "#ff8ad4", "#7ec8ff"];
    const list: { p: [number, number, number]; c: string }[] = [];
    for (let i = 0; i < 34; i++) {
      let x = (r() - 0.5) * 16;
      let z = (r() - 0.5) * 40;
      if (Math.abs(x) < 2.4 && Math.abs(z) < 9) x += x < 0 ? -3.2 : 3.2;
      list.push({ p: [x, 0.08, z], c: cols[i % cols.length]! });
    }
    return list;
  }, []);

  useEffect(() => {
    startCreek();
    return () => stopCreek();
  }, []);

  return (
    <group>
      <Fairway />
      <Mound pos={[0, 0, -20.2]} radius={9.4} height={3.42} />
      <Mound pos={[0, 0, 20.4]} radius={10.6} height={3.5} />
      <Deck pos={[0, 3.47, -20.2]} />
      <Deck pos={[0, 3.55, 20.4]} />
      <Creek />
      {[[-0.5, 0.055, -2.4, 0.3], [0.55, 0.055, 1.2, 0.24], [-0.15, 0.055, 3.5, 0.2]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[-Math.PI / 2, 0, i * 0.8]} userData={{ labSkip: true }}>
          <circleGeometry args={[r, 8]} />
          <meshBasicMaterial color={i === 1 ? "#4aaa4a" : "#3d8f40"} />
        </mesh>
      ))}
      <Rocks />
      <Bridge />
      <Flag />
      <HoleSign />
      <Tufts />
      {flowers.map((f, i) => (
        <Flower key={i} pos={f.p} color={f.c} />
      ))}
      <Toadstool pos={[-2.6, 0.08, -7.4]} s={1.15} />
      <Toadstool pos={[-3.1, 0.08, -6.8]} s={0.7} />
      <Toadstool pos={[4.4, 0.08, 7.2]} s={1} />
      <Reed pos={[-1.7, 0, -3.4]} />
      <Reed pos={[1.85, 0, -1.1]} />
      <Reed pos={[-1.9, 0, 2.8]} />
      <Reed pos={[1.7, 0, 4.1]} />
      <Tree pos={[-8.4, 0, -11.5]} s={1.15} hue={0.2} />
      <Tree pos={[-9.6, 0, 3.8]} s={0.95} hue={0.7} />
      <Tree pos={[9.4, 0, -5.2]} s={1.05} hue={0.3} />
      <Tree pos={[8.8, 0, 13.6]} s={1.25} hue={0.8} />
      <Tree pos={[-7.2, 0, 17.4]} s={0.88} hue={0.4} />
      <mesh position={[-6.4, 0.05, -8.2]} rotation={[-Math.PI / 2, 0, 0.4]} scale={[1.8, 1.15, 1]} receiveShadow>
        <circleGeometry args={[1, 14]} />
        <meshStandardMaterial color="#e4d09a" roughness={0.95} />
      </mesh>
      <mesh position={[6.6, 0.05, 8.8]} rotation={[-Math.PI / 2, 0, -0.3]} scale={[1.5, 1.05, 1]} receiveShadow>
        <circleGeometry args={[1, 14]} />
        <meshStandardMaterial color="#e4d09a" roughness={0.95} />
      </mesh>
      <Clouds />
      <Butterflies />
    </group>
  );
}
