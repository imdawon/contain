import "@/lib/bay/raf";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

import { Grid, OrbitControls } from "@react-three/drei";
import { CuboidCollider, Physics, RigidBody, interactionGroups, useRapier } from "@react-three/rapier";
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
import { Cannon } from "@/components/bay/cannon";
import { ScorePlate } from "@/components/bay/score-plate";
import { Drum, Wheel } from "@/components/bay/steel";
import { Wagon } from "@/components/bay/wagon";
import { Wall } from "@/components/bay/wall";
import { isSolid } from "@/store/bay-store";
import { ProbeTick } from "@/components/bay/probe-tick";
import { FLOOR } from "@/lib/bay/parts";
import { CRATE_G, DUMMY_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { listSamplers } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";
import { LabLook } from "@/components/bay/look";
import { Green } from "@/components/bay/green";

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
    const ent = rec ? null : useBay.getState().entities.find((e) => e.id === trackId);
    if (!rec && !ent) return;
    const p = rec ? rec.sample() : { x: ent!.pos[0], y: ent!.pos[1], z: ent!.pos[2] };
    const controls = orbit.current;
    if (!controls) return;
    const t = controls.target;
    if (!primed.current) {
      t.set(p.x, p.y, p.z);
      if (offset) camera.position.set(p.x + offset[0], p.y + offset[1], p.z + offset[2]);
      primed.current = true;
      camera.updateMatrixWorld();
      return;
    }
    camera.position.x += p.x - t.x;
    camera.position.y += p.y - t.y;
    camera.position.z += p.z - t.z;
    t.set(p.x, p.y, p.z);
    camera.updateMatrixWorld();
  }, -1);
  return null;
}

function KickFrames() {
  const hangar = useBay((s) => s.entities.some((e) => e.kind === "ramp"));
  const advance = useThree((s) => s.advance);
  const invalidate = useThree((s) => s.invalidate);
  const lastRaf = useRef(performance.now());
  const busy = useRef(false);
  useFrame(() => {
    lastRaf.current = performance.now();
  });
  useEffect(() => {
    if (hangar) return;
    const id = window.setInterval(() => {
      if (busy.current) return;
      const now = performance.now();
      const quiet = typeof document !== "undefined" && document.hidden ? 18 : 80;
      if (now - lastRaf.current < quiet) return;
      busy.current = true;
      lastRaf.current = now;
      try {
        invalidate();
        advance(performance.now(), true);
      } catch {
        /* rAF-less kick is best-effort */
      } finally {
        busy.current = false;
      }
    }, 20);
    return () => window.clearInterval(id);
  }, [advance, invalidate, hangar]);
  return null;
}

function SlowMoDriver() {
  const slowMo = useBay((s) => s.slowMo);
  const { step } = useRapier();
  useFrame((_, dt) => {
    if (!slowMo) return;
    step(Math.min(dt, 0.05) * 0.25);
  });
  return null;
}

function gardenOn() {
  const ents = useBay.getState().entities;
  return ents.some((e) => e.kind === "cannon") && !ents.some((e) => e.kind === "ramp" || e.kind === "hill");
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

function BlastBus() {
  const { world } = useRapier();
  useEffect(() => {
    const onBlast = (ev: Event) => {
      const { x, y, z, power } = (ev as CustomEvent<{ x: number; y: number; z: number; power: number }>).detail;
      world.forEachRigidBody((b) => {
        if (b.isFixed() || b.isKinematic()) return;
        const mass = b.mass();
        if (mass > 12) return;
        const p = b.translation();
        const dx = p.x - x;
        const dy = p.y - y;
        const dz = p.z - z;
        const dist = Math.max(0.22, Math.hypot(dx, dy, dz));
        if (dist > 8) return;
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
  const slowMo = useBay((s) => s.slowMo);
  const orbit = useRef<{ target: THREE.Vector3 } | null>(null);
  const fire = useFireMap();
  const hangar = Boolean(scene?.cam?.offset || scene?.cam?.eye);
  const tracking = Boolean(useBay((s) => s.trackId));
  const garden = gardenOn();

  return (
    <Physics key={stageN} gravity={[0, -9.81, 0]} timeStep={slowMo ? "vary" : 1 / 60} paused={slowMo} interpolate numSolverIterations={24} numInternalPgsIterations={12} maxCcdSubsteps={1}>
      <SlowMoDriver />
      <TrackCam orbit={orbit} />
      <ProbeTick />
      <BlastBus />
      {scene ? <SceneRig key={`${scene.id}-${stageN}`} scene={scene} /> : null}
      <RigidBody type="fixed" colliders={false} friction={0.95} restitution={0}>
        <CuboidCollider args={[FLOOR.half, 0.25, FLOOR.half]} position={[0, -0.25, 0]} collisionGroups={interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G])} />
        {garden ? null : (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
            <planeGeometry args={[FLOOR.half * 2, FLOOR.half * 2]} />
            <meshStandardMaterial color="#4c463f" roughness={0.94} metalness={0.06} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
          </mesh>
        )}
      </RigidBody>
      {garden ? <Green /> : (
      <Grid
        infiniteGrid
        fadeDistance={34}
        fadeStrength={2.4}
        cellSize={20}
        cellThickness={0.2}
        cellColor="#5a544c"
        sectionSize={40}
        sectionThickness={1.05}
        sectionColor="#8f8678"
        position={[0, 0.012, 0]}
      />
      )}
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
          <Dummy key={e.id} id={e.id} pos={e.pos} rot={e.rot} live={e.live} vel={e.vel} />
        ) : e.kind === "wagon" ? (
          <Wagon key={e.id} id={e.id} pos={e.pos} rot={e.rot} grip={e.grip} bounce={e.bounce} mass={e.mass} />
        ) : e.kind === "hill" || e.kind === "ramp" ? (
          <Ramp key={e.id} id={e.id} pos={e.pos} rot={e.rot} size={e.size} grip={e.grip} bounce={e.bounce} cut={e.cut} grade={e.grade} />
        ) : e.kind === "wall" ? (
          <Wall key={e.id} id={e.id} pos={e.pos} />
        ) : e.kind === "doorway" ? (
          <Doorway key={e.id} id={e.id} pos={e.pos} />
        ) : e.kind === "grass" ? (
          <Grass key={e.id} id={e.id} pos={e.pos} />
        ) : e.kind === "cannon" ? (
          <Cannon key={e.id} id={e.id} pos={e.pos} rot={e.rot} size={e.size} />
        ) : e.kind === "wheel" ? (
          <Wheel key={e.id} id={e.id} pos={e.pos} rot={e.rot} grip={e.grip} bounce={e.bounce} mass={e.mass} vel={e.vel} />
        ) : e.kind === "drum" ? (
          <Drum key={e.id} id={e.id} pos={e.pos} rot={e.rot} grip={e.grip} bounce={e.bounce} mass={e.mass} />
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
        enablePan={!tracking}
        enableZoom
        zoomSpeed={hangar ? 1.35 : 1}
        minDistance={hangar ? 2 : 0.5}
        maxDistance={hangar ? 2500 : 80}
        maxPolarAngle={1.48}
        target={[0, 0.7, 0.55]}
        enableDamping
        dampingFactor={0.08}
      />
    </Physics>
  );
}

function GardenLook() {
  const garden = useBay((s) => s.entities.some((e) => e.kind === "cannon") && !s.entities.some((e) => e.kind === "ramp" || e.kind === "hill"));
  const sky = garden ? "#8ec8e8" : "#8a7c6a";
  return (
    <>
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={garden ? ["#b5dcec", 110, 260] : ["#8a7c6a", 90, 1400]} />
    </>
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
          className="block h-full w-full touch-none"
          style={{ position: "absolute", inset: 0, width: box.w, height: box.h }}
          dpr={[1, 1.5]}
          shadows
          frameloop="always"
          camera={{ position: [3.4, 1.7, 3.6], fov: 42, near: 0.08, far: 2500 }}
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
            gl.toneMappingExposure = 1.42;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.shadowMap.enabled = true;
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
            gl.setClearColor("#8a7c6a", 1);
            state.setSize(box.w, box.h);
          }}
        >
          <FitGl />
          <KickFrames />
          <GardenLook />
          <LabLook />
          <World />
          <ScorePlate />
        </Canvas>
      ) : null}
    </div>
  );
}

export default BayCanvas;

