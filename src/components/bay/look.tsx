import { ContactShadows } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { listSamplers } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

const INK = "labInk3";

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
       float ${INK}Sil = pow(1.0 - clamp(abs(${INK}N.z), 0.0, 1.0), 1.35);
       gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.05, 0.045, 0.04), ${INK}Sil * 0.88);`,
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

function makeOutlineMat() {
  return new THREE.ShaderMaterial({
    uniforms: {
      labInkW: { value: 9.0 },
      labSize: { value: new THREE.Vector2(720, 1280) },
      labInkC: { value: new THREE.Color("#0d0a08") },
    },
    vertexShader: `
      uniform float labInkW;
      uniform vec2 labSize;
      void main() {
        vec4 tPosition = vec4(position, 1.0);
        vec4 tNormal = vec4(normal, 0.0);
        vec4 clipPosition = projectionMatrix * modelViewMatrix * tPosition;
        vec4 clipNormal = projectionMatrix * modelViewMatrix * tNormal;
        vec2 offset = normalize(clipNormal.xy + 0.0001) * labInkW / max(labSize.y, 1.0) * clipPosition.w;
        clipPosition.xy += offset;
        gl_Position = clipPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 labInkC;
      void main() {
        gl_FragColor = vec4(labInkC, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: true,
    toneMapped: false,
    fog: false,
  });
}

function attachOutline(mesh: THREE.Mesh, mat: THREE.ShaderMaterial) {
  const prev = mesh.userData.labOutline as THREE.Mesh | undefined;
  if (prev) {
    if (prev.geometry !== mesh.geometry) prev.geometry = mesh.geometry;
    return;
  }
  if (!mesh.geometry.getAttribute("normal")) return;
  const outline = new THREE.Mesh(mesh.geometry, mat);
  outline.userData.labSkip = true;
  outline.userData.labOutline = true;
  outline.frustumCulled = false;
  outline.castShadow = false;
  outline.receiveShadow = false;
  mesh.add(outline);
  mesh.userData.labOutline = outline;
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
  const ink = useMemo(() => makeOutlineMat(), []);
  const blob = useRef<[number, number]>([0, 40]);

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
      ink.dispose();
      installed.current = false;
    };
  }, [ink]);

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
    const p = trackPoint();
    blob.current[0] = p.x;
    blob.current[1] = p.z;
  });

  return (
    <>
      <LabSky />
      <HangarLamps />
      <LabLights />
      <LabGroundShadow blob={blob} />
    </>
  );
}

function LabGroundShadow({ blob }: { blob: { current: [number, number] } }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    group.current.position.set(blob.current[0], 0, blob.current[1]);
  });
  return (
    <group ref={group}>
      <ContactShadows
        position={[0, 0.018, 0]}
        opacity={0.72}
        scale={36}
        blur={1.6}
        far={14}
        resolution={1024}
        color="#1a1410"
        frames={1}
      />
    </group>
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
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const p = trackPoint();
    target.position.set(p.x, p.y + 0.15, p.z);
    target.updateMatrixWorld();
    const L = light.current;
    if (!L) return;
    L.target = target;
    L.position.set(p.x + 26, p.y + 9, p.z - 11);
    L.updateMatrixWorld();
    const cam = L.shadow.camera;
    cam.left = -18;
    cam.right = 18;
    cam.top = 22;
    cam.bottom = -22;
    cam.near = 4;
    cam.far = 96;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    L.shadow.bias = -0.0002;
    L.shadow.normalBias = 0.022;
  });

  return (
    <>
      <hemisphereLight args={["#efe6d6", "#2a2622", 0.32]} />
      <ambientLight intensity={0.14} color="#d8d0c6" />
      <directionalLight
        ref={light}
        intensity={3.2}
        color="#fff2dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.022}
        shadow-camera-near={4}
        shadow-camera-far={96}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      <primitive object={target} />
      <directionalLight position={[-18, 22, 28]} intensity={0.32} color="#9aadc4" />
    </>
  );
}
