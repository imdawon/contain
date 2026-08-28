import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Cook } from "@/lib/bay/cook";

const N = 96;
const dummy = new THREE.Object3D();
const color = new THREE.Color();

export function JetFire({ cook, map }: { cook: () => Cook | undefined; map: THREE.Texture }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const flash = useRef<THREE.PointLight>(null);
  const camera = useThree((s) => s.camera);
  const boomFlash = useRef(0);
  const lastPhase = useRef<Cook["phase"]>("idle");
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
        smoke: false,
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
      if (flash.current) flash.current.intensity = 0;
      lastPhase.current = c?.phase ?? "idle";
      boomFlash.current = Math.max(0, boomFlash.current - dt * 8);
      return;
    }
    if (fm) fm.visible = true;
    const frag = c.chem === "frag";
    if (c.phase === "boom" && lastPhase.current !== "boom") {
      boomFlash.current = frag ? 1.4 : 1;
      const burst = frag ? 24 : 36;
      for (let i = 0; i < burst; i++) {
        const p = pool[cur.current++ % N];
        p.alive = true;
        p.age = 0;
        p.smoke = Math.random() < (frag ? 0.22 : 0.35);
        const a = Math.random() * Math.PI * 2;
        const elev = frag ? (Math.random() - 0.35) * Math.PI : 0;
        const sp = frag ? 2.4 + Math.random() * 5.5 : 1.2 + Math.random() * 4.8;
        p.x = (Math.random() - 0.5) * 0.08;
        p.y = 0.06;
        p.z = (Math.random() - 0.5) * 0.08;
        p.vx = Math.cos(a) * Math.cos(elev) * (frag ? sp : sp * 0.55);
        p.vy = frag ? Math.sin(elev) * sp + 0.8 : 3.4 + Math.random() * 5.2;
        p.vz = Math.sin(a) * Math.cos(elev) * (frag ? sp : sp * 0.55);
        p.life = p.smoke ? 0.7 + Math.random() * 0.5 : frag ? 0.22 + Math.random() * 0.22 : 0.35 + Math.random() * 0.35;
        p.size = p.smoke ? 0.18 + Math.random() * 0.16 : frag ? 0.1 + Math.random() * 0.12 : 0.18 + Math.random() * 0.18;
      }
    }
    lastPhase.current = c.phase;
    boomFlash.current = Math.max(0, boomFlash.current - dt * (frag ? 3.6 : 2.4));

    const n = frag
      ? c.phase === "boom"
        ? Math.min(10, 4 + c.kW * 0.08)
        : Math.min(4, 1 + c.kW * dt * 8)
      : c.phase === "boom"
        ? Math.min(22, 8 + c.kW * 0.12)
        : Math.min(18, 3 + (c.jet + c.kW * 0.1) * dt * 70);
    for (let i = 0; i < n; i++) {
      const p = pool[cur.current++ % N];
      p.alive = true;
      p.age = 0;
      p.smoke = frag ? Math.random() < 0.7 : c.phase === "cook" ? Math.random() < 0.45 : Math.random() < 0.25;
      p.x = (Math.random() - 0.5) * 0.06;
      p.y = 0.05;
      p.z = (Math.random() - 0.5) * 0.06;
      const jet = !frag && !p.smoke && c.chem === "nmc" && Math.random() < 0.75;
      p.vx = (Math.random() - 0.5) * (jet ? 0.35 : frag ? 0.35 : 0.55);
      p.vy = jet ? 3.4 + Math.random() * 4.6 : frag ? 0.35 + Math.random() * 0.55 : 0.7 + Math.random() * 1.4;
      p.vz = (Math.random() - 0.5) * (jet ? 0.35 : frag ? 0.35 : 0.55);
      p.life = jet ? 0.32 + Math.random() * 0.28 : frag ? 0.4 + Math.random() * 0.35 : 0.55 + Math.random() * 0.45;
      p.size = jet ? 0.16 + Math.random() * 0.14 : frag ? 0.07 + Math.random() * 0.06 : 0.12 + Math.random() * 0.12;
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
          p.vy += p.smoke ? dt * 0.4 : -dt * 1.1;
          if (p.age >= p.life) p.alive = false;
        }
        dummy.position.set(p.x, p.alive ? p.y : -20, p.z);
        dummy.scale.setScalar(p.alive ? p.size : 0);
        dummy.lookAt(cam);
        dummy.updateMatrix();
        fm.setMatrixAt(i, dummy.matrix);
        const u = p.alive ? p.age / p.life : 1;
        if (p.smoke) color.setRGB(0.35 - u * 0.2, 0.32 - u * 0.18, 0.28 - u * 0.16);
        else if (c.chem === "frag") color.setRGB(1, 0.92 - u * 0.35, 0.55 - u * 0.4);
        else if (c.chem === "nmc") color.setRGB(1, 0.62 - u * 0.42, 0.1);
        else color.setRGB(1, 0.78, 0.4);
        fm.setColorAt(i, color);
      }
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    }
    if (light.current) {
      const flicker = 0.72 + Math.sin(performance.now() * 0.05) * 0.28;
      light.current.intensity = frag ? (0.2 + c.kW * 0.06) * flicker : (1.1 + c.kW * 0.22 + c.jet * 2.4) * flicker;
    }
    if (flash.current) {
      flash.current.intensity = boomFlash.current * (frag ? 28 : 18);
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
      <pointLight ref={light} color="#ff6a22" distance={9} decay={2} intensity={0} />
      <pointLight ref={flash} color="#fff2c8" distance={14} decay={2} intensity={0} />
    </group>
  );
}
