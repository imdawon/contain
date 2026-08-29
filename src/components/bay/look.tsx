import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { listSamplers } from "@/lib/bay/probe";
import { ARENA_LOOK, sceneTheme, type ArenaTheme } from "@/lib/bay/arena";
import { useBay } from "@/store/bay-store";

const INK = "labInk4";

function injectInk(shader: { fragmentShader: string }) {
  const src = shader.fragmentShader;
  if (src.includes(INK)) return;
  if (!src.includes("#include <normal_fragment_maps>") || !src.includes("#include <opaque_fragment>")) return;
  shader.fragmentShader = src
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
  const gl = useThree((s) => s.gl);
  const installed = useRef(false);

  useLayoutEffect(() => {
    if (installed.current) return;
    installed.current = true;
    const proto = THREE.MeshStandardMaterial.prototype;
    const prevCompile = proto.onBeforeCompile;
    const prevKey = proto.customProgramCacheKey;
    proto.onBeforeCompile = function (shader, renderer) {
      if (typeof prevCompile === "function") prevCompile.call(this, shader, renderer);
      if (this.userData?.labSkip) return;
      injectInk(shader);
    };
    proto.customProgramCacheKey = function () {
      const base = typeof prevKey === "function" ? prevKey.call(this) : "";
      return base + (this.userData?.labSkip ? "|lab-skip" : `|${INK}`);
    };
    return () => {
      proto.onBeforeCompile = prevCompile;
      proto.customProgramCacheKey = prevKey;
      installed.current = false;
    };
  }, []);

  const stageN = useBay((s) => s.stageN);
  const nEnt = useBay((s) => s.entities.length);
  useLayoutEffect(() => {
    gl.shadowMap.enabled = false;
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
      // 800 m hangar floor receiving 2048² PCF shadows is what kills Chromium WebGL.
      mesh.castShadow = span < 8;
      mesh.receiveShadow = span < 16;
    });
  }, [scene, stageN, nEnt, gl]);

  const theme = useBay((s) => sceneTheme(s.scene));
  return (
    <>
      {theme ? null : <HangarLamps />}
      <LabLights theme={theme} />
    </>
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

function LabLights({ theme }: { theme: ArenaTheme | null }) {
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
    cam.left = -56;
    cam.right = 56;
    cam.top = 64;
    cam.bottom = -64;
    cam.near = 8;
    cam.far = 240;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    L.shadow.bias = -0.00018;
    L.shadow.normalBias = 0.03;
  });

  return (
    <>
      <hemisphereLight args={theme ? [ARENA_LOOK[theme].hemiSky, ARENA_LOOK[theme].hemiGround, ARENA_LOOK[theme].hemiI] : ["#fff4e4", "#4a433c", 0.78]} />
      <ambientLight intensity={theme ? ARENA_LOOK[theme].ambient : 0.52} color={theme ? ARENA_LOOK[theme].ambientC : "#efe6d8"} />
      <directionalLight
        ref={light}
        intensity={theme ? ARENA_LOOK[theme].sunI : 3.4}
        color={theme ? ARENA_LOOK[theme].sunC : "#fff6e4"}
        castShadow={false}
        shadow-bias={-0.00018}
        shadow-normalBias={0.03}
        shadow-camera-near={8}
        shadow-camera-far={240}
        shadow-camera-left={-56}
        shadow-camera-right={56}
        shadow-camera-top={64}
        shadow-camera-bottom={-64}
      />
      <primitive object={target} />
      <directionalLight position={[-20, 30, 24]} intensity={theme ? ARENA_LOOK[theme].fillI : 0.7} color={theme ? ARENA_LOOK[theme].fillC : "#c5d4e6"} />
    </>
  );
}
