import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { listSamplers } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

const INK = "labInk4";

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
       float ${INK}Sil = pow(1.0 - clamp(abs(${INK}N.z), 0.0, 1.0), 2.4);
       gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.22, 0.2, 0.18), ${INK}Sil * 0.28);`,
    );
}

function skipMesh(mesh: THREE.Mesh) {
  if (mesh.userData.labSkip || mesh.userData.labOutline) return true;
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

function trackPoint() {
  const trackId = useBay.getState().trackId;
  if (!trackId) return { x: 0, y: 20, z: 40 };
  const rec = listSamplers().get(trackId);
  if (!rec) {
    const ent = useBay.getState().entities.find((e) => e.id === trackId);
    if (!ent) return { x: 0, y: 20, z: 40 };
    return { x: ent.pos[0], y: ent.pos[1], z: ent.pos[2] };
  }
  return rec.sample();
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

  useFrame(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (skipMesh(mesh)) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        return;
      }
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const span = (mesh.geometry.boundingSphere?.radius ?? 1) * 2 * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z);
      mesh.castShadow = span < 10;
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
      const h = THREE.MathUtils.clamp((pos.getY(i) / 420) * 0.5 + 0.5, 0, 1);
      const nadir = [0.28, 0.25, 0.22];
      const horizon = [0.62, 0.55, 0.46];
      const zenith = [0.86, 0.8, 0.7];
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
  const zs = [0, 30, 60, 90, 120, 150];
  return (
    <group>
      {zs.map((z) => (
        <mesh key={z} position={[0, 58, z]} rotation={[Math.PI / 2, 0, 0]} userData={{ labSkip: true }}>
          <planeGeometry args={[22, 2.4]} />
          <meshBasicMaterial color="#f0e2c4" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function LabLights() {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const p = trackPoint();
    target.position.set(p.x, p.y + 0.2, p.z);
    target.updateMatrixWorld();
    const L = light.current;
    if (!L) return;
    L.target = target;
    L.position.set(p.x + 10, p.y + 42, p.z - 8);
    L.updateMatrixWorld();
    const cam = L.shadow.camera;
    cam.left = -28;
    cam.right = 28;
    cam.top = 34;
    cam.bottom = -34;
    cam.near = 8;
    cam.far = 120;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    L.shadow.bias = -0.00018;
    L.shadow.normalBias = 0.03;
  });

  return (
    <>
      <hemisphereLight args={["#fff4e4", "#4a433c", 0.78]} />
      <ambientLight intensity={0.52} color="#efe6d8" />
      <directionalLight
        ref={light}
        intensity={3.4}
        color="#fff6e4"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00018}
        shadow-normalBias={0.03}
        shadow-camera-near={8}
        shadow-camera-far={120}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
      />
      <primitive object={target} />
      <directionalLight position={[-20, 30, 24]} intensity={0.7} color="#c5d4e6" />
    </>
  );
}
