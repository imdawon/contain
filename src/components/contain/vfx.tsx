import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { makeSmokeTexture, makeSparkTexture } from "@/lib/contain/textures";
import { runtime } from "@/lib/contain/runtime";

const FIRE_N = 620;
const SMOKE_N = 360;
const SPARK_N = 180;

type P = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  alive: boolean;
  jet: boolean;
};

function pool(n: number): P[] {
  return Array.from({ length: n }, () => ({
    x: 0,
    y: -40,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: 0,
    life: 1,
    size: 0.04,
    alive: false,
    jet: false,
  }));
}

const dummy = new THREE.Object3D();
const color = new THREE.Color();

function hideInstances(mesh: THREE.InstancedMesh | null) {
  if (!mesh) return;
  dummy.position.set(0, -40, 0);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.setScalar(0);
  dummy.updateMatrix();
  for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

const additive = {
  transparent: true,
  depthWrite: false,
  toneMapped: false as const,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
};

export function ExplosionFX({
  origin,
  fireMap,
}: {
  origin: [number, number, number];
  fireMap: THREE.Texture;
}) {
  const camera = useThree((s) => s.camera);
  const smokeTex = useMemo(() => makeSmokeTexture(), []);
  const sparkTex = useMemo(() => makeSparkTexture(), []);
  const fire = useMemo(() => pool(FIRE_N), []);
  const smoke = useMemo(() => pool(SMOKE_N), []);
  const sparks = useMemo(() => pool(SPARK_N), []);
  const fi = useRef(0);
  const si = useRef(0);
  const ki = useRef(0);
  const fireMesh = useRef<THREE.InstancedMesh>(null);
  const smokeMesh = useRef<THREE.InstancedMesh>(null);
  const sparkMesh = useRef<THREE.InstancedMesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const lastPhase = useRef(runtime.thermal.phase);
  const lastFail = useRef(runtime.thermal.failure);

  useEffect(
    () => () => {
      smokeTex.dispose();
      sparkTex.dispose();
    },
    [smokeTex, sparkTex],
  );

  useLayoutEffect(() => {
    hideInstances(fireMesh.current);
    hideInstances(smokeMesh.current);
    hideInstances(sparkMesh.current);
  }, []);

  function spawn(list: P[], cursor: { current: number }, n: number, setup: (p: P) => void) {
    const count = Math.floor(n);
    for (let i = 0; i < count; i++) {
      const p = list[cursor.current++ % list.length];
      p.alive = true;
      p.age = 0;
      p.jet = false;
      setup(p);
    }
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = runtime.thermal;
    const ox = origin[0];
    const oy = origin[1] + 0.02;
    const oz = origin[2] + 0.01;
    const nmc = s.chem === "nmc";
    const firePower = Math.max(s.flameKW, s.kW * 0.5, s.jet * 0.7);
    const torch = nmc && (s.jet > 0.5 || s.lidOpen > 0.35 || s.failure === "lid");
    const live =
      s.phase === "venting" ||
      s.phase === "runaway" ||
      s.phase === "spent" ||
      s.phase === "punctured";

    if (s.phase === "punctured" && lastPhase.current === "idle") {
      spawn(sparks, ki, 70, (p) => {
        p.x = ox + (Math.random() - 0.5) * 0.03;
        p.y = oy;
        p.z = oz;
        p.vx = (Math.random() - 0.5) * 2;
        p.vy = 1 + Math.random() * 2.4;
        p.vz = (Math.random() - 0.5) * 2;
        p.life = 0.35 + Math.random() * 0.4;
        p.size = 0.02 + Math.random() * 0.02;
      });
    }
    if (s.failure && s.failure !== lastFail.current) {
      spawn(fire, fi, 120, (p) => {
        p.x = ox + (Math.random() - 0.5) * 0.14;
        p.y = oy;
        p.z = oz + (Math.random() - 0.5) * 0.1;
        p.vx = (Math.random() - 0.5) * 1.4;
        p.vy = 1.6 + Math.random() * 3.2;
        p.vz = (Math.random() - 0.5) * 1.4;
        p.life = 0.45 + Math.random() * 0.5;
        p.size = 0.16 + Math.random() * 0.16;
      });
      spawn(sparks, ki, 90, (p) => {
        p.x = ox;
        p.y = oy;
        p.z = oz;
        p.vx = (Math.random() - 0.5) * 4.2;
        p.vy = 1.6 + Math.random() * 4.2;
        p.vz = (Math.random() - 0.5) * 4.2;
        p.life = 0.5 + Math.random() * 0.6;
        p.size = 0.016 + Math.random() * 0.02;
      });
      runtime.show.shock = 1;
    }
    lastPhase.current = s.phase;
    lastFail.current = s.failure;

    if (live) {
      const nFire = Math.min(28, 3 + firePower * (nmc ? 3.8 : 1.3) * dt * 60);
      spawn(fire, fi, nFire, (p) => {
        const jet = torch && Math.random() < 0.82;
        p.jet = jet;
        p.x = ox + (Math.random() - 0.5) * (jet ? 0.03 : 0.08);
        p.y = oy + (jet ? 0.04 : 0);
        p.z = oz + (Math.random() - 0.5) * (jet ? 0.03 : 0.06);
        p.vx = (Math.random() - 0.5) * (jet ? 0.18 : 0.28);
        p.vy = jet ? 3.4 + Math.random() * 4.2 : 0.45 + Math.random() * 0.8;
        p.vz = (Math.random() - 0.5) * (jet ? 0.18 : 0.22);
        p.life = jet ? 0.28 + Math.random() * 0.22 : 0.5 + Math.random() * 0.4;
        p.size = jet ? 0.14 + Math.random() * 0.14 : 0.09 + Math.random() * 0.08;
      });
      const nSmoke = Math.min(10, 1 + (s.smoke * 1.4 + firePower * 0.28) * dt * 60);
      spawn(smoke, si, nSmoke, (p) => {
        p.x = ox + (Math.random() - 0.5) * 0.1;
        p.y = oy + 0.1;
        p.z = oz + (Math.random() - 0.5) * 0.08;
        p.vx = (Math.random() - 0.5) * 0.14;
        p.vy = 0.55 + Math.random() * 0.7 + s.smoke * 0.2;
        p.vz = (Math.random() - 0.5) * 0.14;
        p.life = 1.1 + Math.random() * 1.3;
        p.size = 0.08 + Math.random() * 0.1;
      });
      if (nmc && firePower > 0.5) {
        spawn(sparks, ki, Math.min(12, firePower * 0.7 * dt * 60), (p) => {
          p.x = ox + (Math.random() - 0.5) * 0.03;
          p.y = oy + 0.08;
          p.z = oz;
          p.vx = (Math.random() - 0.5) * 1.4;
          p.vy = 2.2 + Math.random() * 3.4;
          p.vz = (Math.random() - 0.5) * 1.4;
          p.life = 0.4 + Math.random() * 0.5;
          p.size = 0.014 + Math.random() * 0.014;
        });
      }
      if (s.burning) {
        spawn(fire, fi, 8, (p) => {
          p.x = (Math.random() - 0.5) * 0.42;
          p.y = 0.04 + Math.random() * 0.22;
          p.z = (Math.random() - 0.5) * 0.36;
          p.vx = (Math.random() - 0.5) * 0.2;
          p.vy = 0.5 + Math.random() * 0.7;
          p.vz = (Math.random() - 0.5) * 0.2;
          p.life = 0.55 + Math.random() * 0.45;
          p.size = 0.1 + Math.random() * 0.1;
        });
      }
    }

    const cam = camera.position;
    const fm = fireMesh.current;
    const smk = smokeMesh.current;
    const km = sparkMesh.current;

    if (fm) {
      fm.visible = s.phase !== "idle";
      for (let i = 0; i < FIRE_N; i++) {
        const p = fire[i];
        if (p.alive) {
          p.age += dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vy += (p.jet ? 1.8 : 0.35) * dt;
          if (p.age >= p.life) {
            p.alive = false;
            p.y = -40;
          }
        }
        const u = p.alive ? p.age / p.life : 1;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.alive ? p.size * (0.8 + u * 1.1) : 0);
        dummy.lookAt(cam);
        dummy.updateMatrix();
        fm.setMatrixAt(i, dummy.matrix);
        if (nmc) color.setRGB(1, 0.58 - u * 0.4, 0.06 + (1 - u) * 0.18);
        else color.setRGB(1, 0.78 - u * 0.22, 0.42);
        fm.setColorAt(i, color);
      }
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    }

    if (smk) {
      smk.visible = s.phase !== "idle";
      for (let i = 0; i < SMOKE_N; i++) {
        const p = smoke[i];
        if (p.alive) {
          p.age += dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.size += dt * 0.09;
          if (p.age >= p.life) {
            p.alive = false;
            p.y = -40;
          }
        }
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.alive ? p.size : 0);
        dummy.lookAt(cam);
        dummy.updateMatrix();
        smk.setMatrixAt(i, dummy.matrix);
        const u = p.alive ? p.age / p.life : 1;
        const g = nmc ? 0.22 : 0.58;
        color.setRGB(g, g * 0.98, g * 0.92);
        color.multiplyScalar(Math.max(0, 1 - u));
        smk.setColorAt(i, color);
      }
      smk.instanceMatrix.needsUpdate = true;
      if (smk.instanceColor) smk.instanceColor.needsUpdate = true;
    }

    if (km) {
      km.visible = s.phase !== "idle";
      for (let i = 0; i < SPARK_N; i++) {
        const p = sparks[i];
        if (p.alive) {
          p.age += dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vy -= 7.4 * dt;
          if (p.y < 0.012) {
            p.y = 0.012;
            p.vy *= -0.2;
            p.vx *= 0.5;
          }
          if (p.age >= p.life) {
            p.alive = false;
            p.y = -40;
          }
        }
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.alive ? p.size : 0);
        dummy.lookAt(cam);
        dummy.updateMatrix();
        km.setMatrixAt(i, dummy.matrix);
        color.setRGB(1, 0.88, 0.4);
        km.setColorAt(i, color);
      }
      km.instanceMatrix.needsUpdate = true;
      if (km.instanceColor) km.instanceColor.needsUpdate = true;
    }

    if (core.current) {
      const glow =
        s.phase === "idle"
          ? 0
          : Math.max(s.flameKW, s.kW * 0.45, s.phase === "punctured" ? 0.5 : 0);
      core.current.visible = glow > 0.05;
      core.current.position.set(ox, oy + 0.03, oz);
      core.current.scale.setScalar(glow > 0.05 ? 0.11 + glow * 0.06 : 0);
      core.current.lookAt(cam);
      const mat = core.current.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(0.95, 0.4 + glow * 0.14);
    }

    if (ring.current) {
      if (runtime.show.shock > 0) {
        runtime.show.shock = Math.max(0, runtime.show.shock - dt * 1.8);
        const k = 1 - runtime.show.shock;
        ring.current.visible = true;
        ring.current.position.set(ox, 0.04, oz);
        ring.current.scale.setScalar(0.2 + k * 2.4);
        const mat = ring.current.material as THREE.MeshBasicMaterial;
        mat.opacity = runtime.show.shock * 0.55;
      } else {
        ring.current.visible = false;
      }
    }
  });

  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => plane.dispose(), [plane]);

  return (
    <>
      <instancedMesh
        ref={(m) => {
          if (fireMesh.current !== m) hideInstances(m);
          fireMesh.current = m;
        }}
        args={[plane, undefined, FIRE_N]}
        frustumCulled={false}
      >
        <meshBasicMaterial map={fireMap} vertexColors {...additive} />
      </instancedMesh>
      <instancedMesh
        ref={(m) => {
          if (smokeMesh.current !== m) hideInstances(m);
          smokeMesh.current = m;
        }}
        args={[plane, undefined, SMOKE_N]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          map={smokeTex}
          transparent
          depthWrite={false}
          opacity={0.92}
          vertexColors
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={(m) => {
          if (sparkMesh.current !== m) hideInstances(m);
          sparkMesh.current = m;
        }}
        args={[plane, undefined, SPARK_N]}
        frustumCulled={false}
      >
        <meshBasicMaterial map={sparkTex} vertexColors {...additive} />
      </instancedMesh>
      <mesh ref={core}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={fireMap} {...additive} color="#ffcc66" />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.42, 0.52, 32]} />
        <meshBasicMaterial color="#f4e0c0" transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}
