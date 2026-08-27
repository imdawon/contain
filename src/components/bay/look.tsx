import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const INK = "labInk1";

function injectInk(shader: { fragmentShader: string }) {
  if (shader.fragmentShader.includes(INK)) return;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
       vec3 ${INK}N = normalize(normal);`,
    )
    .replace(
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
       float ${INK}Sil = pow(1.0 - clamp(abs(${INK}N.z), 0.0, 1.0), 4.0);
       gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.16, 0.15, 0.14), ${INK}Sil * 0.32);`,
    );
}

function skipMesh(mesh: THREE.Mesh) {
  if (mesh.userData.labSkip) return true;
  const raw = mesh.material;
  const mats = (Array.isArray(raw) ? raw : [raw]).filter(Boolean) as THREE.Material[];
  return mats.some(
    (m) =>
      Boolean(m.userData?.labSkip) ||
      m instanceof THREE.LineBasicMaterial ||
      m instanceof THREE.LineDashedMaterial ||
      m instanceof THREE.ShaderMaterial ||
      m instanceof THREE.MeshBasicMaterial ||
      m instanceof THREE.ShadowMaterial,
  );
}

/** One shader + one light. Walks the scene so objects do not opt into outlines or shadows. */
export function LabLook() {
  const scene = useThree((s) => s.scene);
  const installed = useRef(false);

  useLayoutEffect(() => {
    if (installed.current) return;
    installed.current = true;
    const proto = THREE.MeshStandardMaterial.prototype;
    const prevCompile = proto.onBeforeCompile;
    const prevKey = proto.customProgramCacheKey;
    proto.onBeforeCompile = function (shader, renderer) {
      prevCompile.call(this, shader, renderer);
      if (this.userData?.labSkip) return;
      injectInk(shader);
    };
    proto.customProgramCacheKey = function () {
      return prevKey.call(this) + (this.userData?.labSkip ? "|lab-skip" : `|${INK}`);
    };
    return () => {
      proto.onBeforeCompile = prevCompile;
      proto.customProgramCacheKey = prevKey;
      installed.current = false;
    };
  }, []);

  const size = useMemo(() => new THREE.Vector3(), []);
  const box = useMemo(() => new THREE.Box3(), []);

  useFrame(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const skip = skipMesh(mesh);
      if (skip) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        return;
      }
      box.setFromObject(mesh, true);
      box.getSize(size);
      const span = Math.max(size.x, size.y, size.z);
      mesh.castShadow = span < 8;
      mesh.receiveShadow = true;
    });
  });

  return (
    <>
      <LabSky />
      <HangarLamps />
      <LabLights />
    </>
  );
}

function LabSky() {
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(420, 32, 20);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const pos = g.attributes.position;
    for (let i = 0; i < n; i++) {
      const h = THREE.MathUtils.clamp(pos.getY(i) / 420 * 0.5 + 0.5, 0, 1);
      const nadir = [0.18, 0.16, 0.14];
      const horizon = [0.52, 0.46, 0.38];
      const zenith = [0.78, 0.72, 0.62];
      const a = h < 0.46 ? h / 0.46 : (h - 0.46) / 0.54;
      const from = h < 0.46 ? nadir : horizon;
      const to = h < 0.46 ? horizon : zenith;
      col[i * 3] = from[0] + (to[0] - from[0]) * a;
      col[i * 3 + 1] = from[1] + (to[1] - from[1]) * a;
      col[i * 3 + 2] = from[2] + (to[2] - from[2]) * a;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  useLayoutEffect(
    () => () => {
      geo.dispose();
    },
    [geo],
  );
  return (
    <mesh geometry={geo} frustumCulled={false} userData={{ labSkip: true }}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} depthWrite={false} depthTest={false} fog={false} toneMapped={false} />
    </mesh>
  );
}

function HangarLamps() {
  const zs = [0, 40, 80, 120];
  return (
    <group>
      {zs.map((z) => (
        <mesh key={z} position={[0, 58, z]} rotation={[Math.PI / 2, 0, 0]} userData={{ labSkip: true }}>
          <planeGeometry args={[22, 2.4]} />
          <meshBasicMaterial color="#e6d7b4" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function LabLights() {
  return (
    <>
      <hemisphereLight args={["#efe6d6", "#2e2a26", 0.42]} />
      <ambientLight intensity={0.18} color="#d8d0c6" />
      <directionalLight
        position={[24, 90, -10]}
        intensity={2.6}
        color="#fff2dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.04}
        shadow-camera-near={8}
        shadow-camera-far={240}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      >
        <object3D attach="target" position={[0, 16, 55]} />
      </directionalLight>
      <directionalLight position={[-22, 28, 40]} intensity={0.55} color="#9aadc4" />
    </>
  );
}
