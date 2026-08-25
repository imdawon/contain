import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls, useTexture } from "@react-three/drei";
import { CuboidCollider, Physics, RigidBody, useRapier } from "@react-three/rapier";
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { AmmoCan } from "@/components/bay/ammo-can";
import { Pack } from "@/components/bay/pack";
import { Solid } from "@/components/bay/solid";
import { isSolid } from "@/store/bay-store";
import { ProbeTick } from "@/components/bay/probe-tick";
import { FLOOR } from "@/lib/bay/parts";
import { listSamplers } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

function TrackCam({
  orbit,
}: {
  orbit: RefObject<{ target: THREE.Vector3 } | null>;
}) {
  const trackId = useBay((s) => s.trackId);
  useFrame(() => {
    if (!trackId || !orbit.current) return;
    const rec = listSamplers().get(trackId);
    if (!rec) return;
    const p = rec.sample();
    orbit.current.target.set(p.x, p.y, p.z);
  });
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
    return () => ro.disconnect();
  }, [gl, setSize]);
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
        const dist = Math.max(0.25, Math.hypot(dx, dy, dz));
        const m = Math.max(0.2, b.mass());
        const impulse = power / (dist * dist) / m;
        b.applyImpulse(
          {
            x: (dx / dist) * impulse,
            y: (dy / dist) * impulse + impulse * 0.12,
            z: (dz / dist) * impulse,
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

function World() {
  const entities = useBay((s) => s.entities);
  const dragging = useBay((s) => s.dragging);
  const orbit = useRef<{ target: THREE.Vector3 } | null>(null);
  const fire = useTexture("/textures/fire.jpg");
  fire.colorSpace = THREE.SRGBColorSpace;

  return (
    <Physics gravity={[0, -9.8, 0]} timeStep={1 / 60} interpolate>
      <ProbeTick />
      <TrackCam orbit={orbit} />
      <BlastBus />
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
        fadeDistance={90}
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
        ) : isSolid(e.kind) ? (
          <Solid key={e.id} id={e.id} shape={e.kind} pos={e.pos} />
        ) : null,
      )}
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
        target={[0, 0.28, 0]}
        enableDamping
        dampingFactor={0.08}
      />
    </Physics>
  );
}

export function BayCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const mark = () => {
      if (el.clientWidth > 8 && el.clientHeight > 8) setReady(true);
    };
    mark();
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrap} className="lab-stage absolute inset-0 h-full w-full">
      {ready ? (
        <Canvas
          className="block h-full w-full touch-none"
          style={{ position: "absolute", inset: 0 }}
          dpr={[1, 1.5]}
          frameloop="always"
          camera={{ position: [2.3, 1.45, 2.6], fov: 42, near: 0.08, far: 280 }}
          gl={{
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
            powerPreference: "default",
            failIfMajorPerformanceCaveat: false,
          }}
          onCreated={({ gl, size }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.38;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.setClearColor("#2c261e", 1);
            if (size.width > 0 && size.height > 0) gl.setSize(size.width, size.height, false);
          }}
        >
          <FitGl />
          <color attach="background" args={["#2c261e"]} />
          <fog attach="fog" args={["#2c261e", 16, 110]} />
          <hemisphereLight args={["#f2ebe0", "#3d372f", 1.35]} />
          <ambientLight intensity={0.28} color="#e8e0d4" />
          <directionalLight position={[6, 10, 4]} intensity={2.55} color="#fff3e4" />
          <directionalLight position={[-5, 3.5, -4]} intensity={0.95} color="#c5d0e4" />
          <directionalLight position={[0, 2.2, 7]} intensity={0.42} color="#ffe6c4" />
          <Suspense fallback={null}>
            <World />
          </Suspense>
        </Canvas>
      ) : null}
    </div>
  );
}

export default BayCanvas;
