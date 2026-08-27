import "@/lib/bay/raf";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import { CuboidCollider, Physics, RigidBody, useRapier } from "@react-three/rapier";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { AmmoCan } from "@/components/bay/ammo-can";
import { Crate } from "@/components/bay/crate";
import { Doorway } from "@/components/bay/doorway";
import { Dummy } from "@/components/bay/dummy";
import { Grass } from "@/components/bay/grass";
import { Grenade } from "@/components/bay/grenade";
import { Ramp } from "@/components/bay/ramp";
import { Pack } from "@/components/bay/pack";
import { SceneRig } from "@/components/bay/scene-rig";
import { Solid } from "@/components/bay/solid";
import { Drum, Wheel } from "@/components/bay/steel";
import { Wagon } from "@/components/bay/wagon";
import { Wall } from "@/components/bay/wall";
import { isSolid } from "@/store/bay-store";
import { ProbeTick } from "@/components/bay/probe-tick";
import { FLOOR } from "@/lib/bay/parts";
import { DUMMY_G } from "@/lib/bay/groups";
import { listSamplers } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

const _chase = new THREE.Vector3();

function TrackCam({
  orbit,
}: {
  orbit: RefObject<{ target: THREE.Vector3 } | null>;
}) {
  const trackId = useBay((s) => s.trackId);
  const stageN = useBay((s) => s.stageN);
  const offset = useBay((s) => s.scene?.cam?.offset);
  const look = useBay((s) => s.scene?.cam?.look);
  const eye = useBay((s) => s.scene?.cam?.eye);
  const fov = useBay((s) => s.scene?.cam?.fov);
  const camera = useThree((s) => s.camera);
  const primed = useRef(false);
  useEffect(() => {
    primed.current = false;
  }, [trackId, stageN]);
  useFrame(() => {
    if (fov && "fov" in camera && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (eye && look) {
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.lookAt(look[0], look[1], look[2]);
      camera.updateMatrixWorld();
      return;
    }
    if (!trackId) return;
    const rec = listSamplers().get(trackId);
    if (!rec) {
      const ent = useBay.getState().entities.find((e) => e.id === trackId);
      if (!ent || !offset) return;
      camera.position.set(ent.pos[0] + offset[0], ent.pos[1] + offset[1], ent.pos[2] + offset[2]);
      camera.lookAt(ent.pos[0], ent.pos[1] + 0.2, ent.pos[2] + 2.4);
      camera.updateMatrixWorld();
      return;
    }
    const p = rec.sample();
    if (orbit.current) orbit.current.target.set(p.x, p.y, p.z);
    if (offset) {
      _chase.set(p.x + offset[0], p.y + offset[1], p.z + offset[2]);
      if (!primed.current) {
        camera.position.copy(_chase);
        primed.current = true;
      } else {
        camera.position.lerp(_chase, 0.22);
      }
      const lx = look?.[0] ?? 0;
      const ly = look?.[1] ?? 0.2;
      const lz = look?.[2] ?? 2.4;
      camera.lookAt(p.x + lx, p.y + ly, p.z + lz);
      camera.updateMatrixWorld();
    }
  }, -1);
  return null;
}

function FitGl() {
  const gl = useThree((s) => s.gl);
  const setSize = useThree((s) => s.setSize);
  useLayoutEffect(() => {
    const canvas = gl.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;
    const apply = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 2 || h < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (canvas.width === Math.floor(w * dpr) && canvas.height === Math.floor(h * dpr)) return;
      gl.setPixelRatio(dpr);
      setSize(w, h);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(parent);
    const iv = window.setInterval(apply, 250);
    return () => {
      ro.disconnect();
      window.clearInterval(iv);
    };
  }, [gl, setSize]);
  return null;
}

function KickFrames() {
  const advance = useThree((s) => s.advance);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        invalidate();
        advance(now, true);
      } catch {
        /* rAF-less kick is best-effort */
      }
      void dt;
    }, 50);
    return () => window.clearInterval(id);
  }, [advance, invalidate]);
  return null;
}

function BlastBus() {
  const { world } = useRapier();
  useEffect(() => {
    const onBlast = (ev: Event) => {
      const { x, y, z, power } = (ev as CustomEvent<{ x: number; y: number; z: number; power: number }>).detail;
      world.forEachRigidBody((b) => {
        if (b.isFixed() || b.isKinematic()) return;
        const p = b.translation();
        const dx = p.x - x;
        const dy = p.y - y;
        const dz = p.z - z;
        const dist = Math.max(0.22, Math.hypot(dx, dy, dz));
        const nCol = b.numColliders();
        if (nCol > 0) {
          const membership = b.collider(0).collisionGroups() >>> 16;
          if (membership & (1 << DUMMY_G)) return;
        }
        let j = Math.min(2.4, (power * 0.18) / dist);
        if (p.y < 0.1) j *= 0.22;
        const lift = p.y < 0.1 ? j * 0.12 : j * 0.28;
        b.applyImpulse(
          {
            x: (dx / dist) * j,
            y: lift,
            z: (dz / dist) * j,
          },
          true,
        );
        b.wakeUp();
      });
    };
    window.addEventListener("bay-blast", onBlast);
    return () => window.removeEventListener("bay-blast", onBlast);
  }, [world]);
  return null;
}

function useFireMap() {
  const [map, setMap] = useState<THREE.Texture>(() => {
    const t = new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    let alive = true;
    loader.load("/textures/fire.jpg", (tex) => {
      if (!alive) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      setMap(tex);
    });
    return () => {
      alive = false;
    };
  }, []);
  return map;
}

function World() {
  const entities = useBay((s) => s.entities);
  const dragging = useBay((s) => s.dragging);
  const scene = useBay((s) => s.scene);
  const stageN = useBay((s) => s.stageN);
  const orbit = useRef<{ target: THREE.Vector3 } | null>(null);
  const fire = useFireMap();

  return (
    <Physics key={stageN} gravity={[0, -6.4, 0]} timeStep={1 / 60} interpolate numSolverIterations={12} numInternalPgsIterations={8}>
      <TrackCam orbit={orbit} />
      <ProbeTick />
      <BlastBus />
      {scene ? <SceneRig key={`${scene.id}-${stageN}`} scene={scene} /> : null}
      <RigidBody type="fixed" colliders={false} friction={0.95} restitution={0.02}>
        <CuboidCollider args={[FLOOR.half, 0.25, FLOOR.half]} position={[0, -0.25, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[FLOOR.half * 2, FLOOR.half * 2]} />
          <meshStandardMaterial color="#4a443c" roughness={0.92} metalness={0.04} />
        </mesh>
      </RigidBody>
      <Grid
        infiniteGrid
        followCamera
        fadeDistance={240}
        fadeStrength={0.85}
        cellSize={1}
        cellThickness={0.55}
        cellColor="#6e675c"
        sectionSize={10}
        sectionThickness={1.15}
        sectionColor="#a8a094"
        position={[0, 0.004, 0]}
      />
      <ContactShadows
        position={[0, 0.006, 0]}
        opacity={0.62}
        scale={28}
        blur={2.1}
        far={9}
        resolution={512}
        color="#1a1612"
      />
      {entities.map((e) =>
        e.kind === "can" ? (
          <AmmoCan key={e.id} id={e.id} pos={e.pos} />
        ) : e.kind === "pack" ? (
          <Pack key={e.id} id={e.id} pos={e.pos} fireMap={fire} />
        ) : e.kind === "grenade" || e.kind === "charge" ? (
          <Grenade key={e.id} id={e.id} pos={e.pos} rot={e.rot} fireMap={fire} />
        ) : e.kind === "crate" ? (
          <Crate key={e.id} id={e.id} pos={e.pos} />
        ) : e.kind === "dummy" ? (
          <Dummy key={e.id} id={e.id} pos={e.pos} rot={e.rot} live={e.live} />
        ) : e.kind === "wagon" ? (
          <Wagon key={e.id} id={e.id} pos={e.pos} rot={e.rot} grip={e.grip} bounce={e.bounce} mass={e.mass} />
        ) : e.kind === "hill" || e.kind === "ramp" ? (
          <Ramp key={e.id} id={e.id} pos={e.pos} rot={e.rot} size={e.size} grip={e.grip} cut={e.cut} />
        ) : e.kind === "wall" ? (
          <Wall key={e.id} id={e.id} pos={e.pos} />
        ) : e.kind === "doorway" ? (
          <Doorway key={e.id} id={e.id} pos={e.pos} />
        ) : e.kind === "grass" ? (
          <Grass key={e.id} id={e.id} pos={e.pos} />
        ) : e.kind === "wheel" ? (
          <Wheel key={e.id} id={e.id} pos={e.pos} rot={e.rot} grip={e.grip} bounce={e.bounce} mass={e.mass} />
        ) : e.kind === "drum" ? (
          <Drum key={e.id} id={e.id} pos={e.pos} rot={e.rot} grip={e.grip} bounce={e.bounce} mass={e.mass} />
        ) : isSolid(e.kind) ? (
          <Solid key={e.id} id={e.id} shape={e.kind} pos={e.pos} />
        ) : null,
      )}
      {scene?.cam?.offset ? null : (
        <OrbitControls
          ref={(el) => {
            orbit.current = el;
          }}
          makeDefault
          enabled={!dragging}
          enablePan
          minDistance={0.5}
          maxDistance={80}
          maxPolarAngle={1.48}
          target={[0, 0.7, 0.55]}
          enableDamping
          dampingFactor={0.08}
        />
      )}
    </Physics>
  );
}

export function BayCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const mark = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 8 && h > 8) setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    mark();
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    const iv = window.setInterval(mark, 250);
    return () => {
      ro.disconnect();
      window.clearInterval(iv);
    };
  }, []);
  const ready = box.w > 8 && box.h > 8;

  return (
    <div ref={wrap} className="lab-stage absolute inset-0 h-full w-full">
      {ready ? (
        <Canvas
          key={`${box.w}x${box.h}`}
          className="block h-full w-full touch-none"
          style={{ position: "absolute", inset: 0, width: box.w, height: box.h }}
          dpr={[1, 1.5]}
          frameloop="always"
          camera={{ position: [3.4, 1.7, 3.6], fov: 42, near: 0.08, far: 800 }}
          gl={{
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
            powerPreference: "default",
            failIfMajorPerformanceCaveat: false,
          }}
          onCreated={(state) => {
            const { gl } = state;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.38;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.setClearColor("#2c261e", 1);
            state.setSize(box.w, box.h);
          }}
        >
          <FitGl />
          <KickFrames />
          <color attach="background" args={["#2c261e"]} />
          <fog attach="fog" args={["#2c261e", 40, 320]} />
          <hemisphereLight args={["#f2ebe0", "#3d372f", 1.35]} />
          <ambientLight intensity={0.28} color="#e8e0d4" />
          <directionalLight position={[6, 10, 4]} intensity={2.55} color="#fff3e4" />
          <directionalLight position={[-5, 3.5, -4]} intensity={0.95} color="#c5d0e4" />
          <directionalLight position={[0, 2.2, 7]} intensity={0.42} color="#ffe6c4" />
          <World />
        </Canvas>
      ) : null}
    </div>
  );
}

export default BayCanvas;

