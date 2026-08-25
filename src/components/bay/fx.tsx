import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Cook } from "@/lib/bay/cook";

const N = 220;
const dummy = new THREE.Object3D();
const color = new THREE.Color();

export function JetFire({ cook, map }: { cook: () => Cook | undefined; map: THREE.Texture }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const camera = useThree((s) => s.camera);
  const pool = useMemo(
    () =>
      Array.from({ length: N }, () => ({
        x: 0,
        y: -20,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 99,
        life: 1,
        size: 0.08,
        alive: false,
      })),
    [],
  );
  const cur = useRef(0);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const c = cook();
    const fm = mesh.current;
    if (!c || c.phase === "idle" || c.phase === "dead") {
      if (fm) fm.visible = false;
      if (light.current) light.current.intensity = 0;
      return;
    }
    if (fm) fm.visible = true;
    const n = Math.min(12, 2 + (c.jet + c.kW * 0.08) * dt * 50);
    for (let i = 0; i < n; i++) {
      const p = pool[cur.current++ % N];
      p.alive = true;
      p.age = 0;
      p.x = (Math.random() - 0.5) * 0.04;
      p.y = 0.04;
      p.z = (Math.random() - 0.5) * 0.04;
      const jet = c.chem === "nmc" && Math.random() < 0.7;
      p.vx = (Math.random() - 0.5) * (jet ? 0.2 : 0.3);
      p.vy = jet ? 2.8 + Math.random() * 3.4 : 0.4 + Math.random() * 0.8;
      p.vz = (Math.random() - 0.5) * (jet ? 0.2 : 0.3);
      p.life = jet ? 0.28 + Math.random() * 0.2 : 0.45 + Math.random() * 0.3;
      p.size = jet ? 0.12 + Math.random() * 0.1 : 0.07 + Math.random() * 0.06;
    }
    const cam = camera.position;
    if (fm) {
      for (let i = 0; i < N; i++) {
        const p = pool[i];
        if (p.alive) {
          p.age += dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          if (p.age >= p.life) p.alive = false;
        }
        dummy.position.set(p.x, p.alive ? p.y : -20, p.z);
        dummy.scale.setScalar(p.alive ? p.size : 0);
        dummy.lookAt(cam);
        dummy.updateMatrix();
        fm.setMatrixAt(i, dummy.matrix);
        const u = p.alive ? p.age / p.life : 1;
        if (c.chem === "nmc") color.setRGB(1, 0.55 - u * 0.35, 0.08);
        else color.setRGB(1, 0.78, 0.4);
        fm.setColorAt(i, color);
      }
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    }
    if (light.current) {
      const flicker = 0.75 + Math.sin(performance.now() * 0.04) * 0.25;
      light.current.intensity = (0.4 + c.kW * 0.18 + c.jet * 2) * flicker;
    }
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={map}
          transparent
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
          vertexColors
        />
      </instancedMesh>
      <pointLight ref={light} color="#ff6a22" distance={4} decay={2} intensity={0} />
    </group>
  );
}
