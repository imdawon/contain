import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CHEMISTRIES } from "@/lib/contain/catalog";
import { blow, resetBits, rattle, seatResting, stepBits, bit } from "@/lib/contain/bodies";
import { chamberLayout } from "@/lib/contain/layout";
import { stepThermal } from "@/lib/contain/thermal";
import { beginRun, resetIdle, runtime } from "@/lib/contain/runtime";
import { playEvent, setFireMix } from "@/lib/contain/audio";
import { useLabTextures } from "@/lib/contain/textures";
import { ExplosionFX } from "@/components/contain/vfx";
import { NailRig, PhoneRig, VesselShell } from "@/components/contain/vessel";
import { useLab } from "@/store/lab-store";

const FIXED = 1 / 60;
const blown = { current: false };

function LabBay({ concrete }: { concrete: THREE.Texture }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial map={concrete} color="#8a8478" roughness={0.95} metalness={0.04} />
      </mesh>
      <mesh position={[0, 1.6, -4.2]}>
        <boxGeometry args={[18, 3.4, 0.2]} />
        <meshStandardMaterial color="#3a372f" roughness={0.92} />
      </mesh>
      <mesh position={[-5.4, 1.6, 0]}>
        <boxGeometry args={[0.2, 3.4, 10]} />
        <meshStandardMaterial color="#322f28" roughness={0.92} />
      </mesh>
      <mesh position={[5.4, 1.6, 0]}>
        <boxGeometry args={[0.2, 3.4, 10]} />
        <meshStandardMaterial color="#322f28" roughness={0.92} />
      </mesh>
      <mesh position={[0, 3.25, 0]}>
        <boxGeometry args={[18, 0.12, 10]} />
        <meshStandardMaterial color="#1c1a16" roughness={1} />
      </mesh>
      {[-1.6, 1.6].map((x) => (
        <mesh key={x} position={[x, 3.12, 0.2]}>
          <boxGeometry args={[1.8, 0.06, 0.36]} />
          <meshStandardMaterial
            color="#f4ead4"
            emissive="#f2e2b8"
            emissiveIntensity={2.6}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[1.7, 0.1, 1.15]} />
        <meshStandardMaterial color="#4a463e" roughness={0.88} metalness={0.08} />
      </mesh>
    </group>
  );
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
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [gl, setSize]);
  return null;
}

function Director() {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 0.16, 0));
  const pos = useRef(new THREE.Vector3(1.35, 0.78, 1.55));
  const desired = useRef(new THREE.Vector3());
  const lookTo = useRef(new THREE.Vector3());
  const orbit = useRef(0);
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useFrame((_, dt) => {
    const s = runtime.thermal;
    const sh = runtime.show;
    orbit.current += dt * (s.phase === "idle" ? 0.12 : 0.22);
    const dist = s.phase === "idle" ? 1.35 : s.failure ? 1.7 : 1.15;
    const height = s.phase === "idle" ? 0.58 : 0.52;
    const yaw = 0.7 + Math.sin(orbit.current) * 0.35;
    desired.current.set(Math.sin(yaw) * dist, height + sh.punch * 0.08, Math.cos(yaw) * dist);
    const k = 1 - Math.exp(-(s.phase === "idle" ? 1.8 : 4.2) * dt);
    pos.current.lerp(desired.current, k);
    lookTo.current.set(0, 0.14 + (s.failure ? 0.08 : 0), 0);
    look.current.lerp(lookTo.current, k);
    sh.punch = Math.max(0, sh.punch - dt * 1.8);
    const trauma = reduced ? 0 : s.trauma * s.trauma;
    camera.position.copy(pos.current);
    if (trauma > 0.002) {
      camera.position.x += (Math.random() - 0.5) * 0.08 * trauma;
      camera.position.y += (Math.random() - 0.5) * 0.06 * trauma;
      camera.rotation.z = (Math.random() - 0.5) * 0.04 * trauma;
    } else {
      camera.rotation.z *= 0.8;
    }
    camera.lookAt(look.current);
  });
  return null;
}

function Lights() {
  const fire = useRef<THREE.PointLight>(null);
  const torch = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const s = runtime.thermal;
    const flicker = 0.75 + Math.sin(state.clock.elapsedTime * 41) * 0.25;
    const power = Math.max(s.flameKW, s.jet, s.kW * 0.45);
    if (fire.current) {
      fire.current.intensity = (0.6 + power * 5.2) * flicker;
      fire.current.color.set(s.chem === "nmc" ? "#ff6a22" : "#e8d2a8");
    }
    if (torch.current) {
      torch.current.intensity = s.jet * 4.5 * flicker;
    }
  });
  return (
    <>
      <hemisphereLight args={["#c8c0b0", "#2a2218", 1.05]} />
      <ambientLight intensity={0.22} color="#d8d0c4" />
      <directionalLight position={[2.4, 3.6, 2]} intensity={2.2} color="#fff4e0" />
      <directionalLight position={[-2, 1.6, -1]} intensity={0.45} color="#8aa0b4" />
      <pointLight ref={fire} position={[0, 0.28, 0.05]} distance={6} decay={2} intensity={0.4} />
      <pointLight ref={torch} position={[0, 0.55, 0]} color="#ffcc66" distance={7} decay={2} />
    </>
  );
}

function Simulator() {
  const acc = useRef(0);
  const hudAcc = useRef(0);
  const lastWall = useRef(0);
  const rattleT = useRef(0);
  const chemistry = useLab((s) => s.chemistry);

  useFrame(() => {
    const now = performance.now();
    if (!lastWall.current) lastWall.current = now;
    const realDt = Math.min((now - lastWall.current) / 1000, 0.1);
    lastWall.current = now;
    const s = runtime.thermal;
    const sh = runtime.show;

    if (sh.hitstop > 0) {
      sh.hitstop -= realDt;
      return;
    }
    if (sh.slowmo > 0) {
      sh.slowmo -= realDt;
      sh.timeScale = 0.32;
    } else {
      sh.timeScale = 1;
    }
    const dt = realDt * sh.timeScale;

    acc.current += dt;
    let steps = 0;
    while (acc.current >= FIXED && steps < 24) {
      stepThermal(s, FIXED);
      acc.current -= FIXED;
      steps += 1;
    }
    stepBits(dt);

    const over = Math.max(0, s.kPa - 118);
    sh.bulge = s.failure ? Math.max(0, sh.bulge - dt * 2) : THREE.MathUtils.clamp(over / 90, 0, 1);
    sh.glow = THREE.MathUtils.clamp(Math.max(s.flameKW, s.kW * 0.35) / 6, 0, 1);
    sh.char = s.mat === "cardboard" ? THREE.MathUtils.clamp((s.boxC - 90) / 180, 0, 1) : 0;
    sh.rattle = s.phase === "runaway" || s.phase === "venting" ? THREE.MathUtils.clamp(s.kW / 8, 0.15, 1) : 0;

    const lid = bit("lid");
    if (lid && !lid.flying) {
      const targetHinge = s.phase === "idle" ? 1 : 0;
      sh.lidHinge += (targetHinge - sh.lidHinge) * Math.min(1, dt * 14);
      lid.rot[0] = -1.15 * sh.lidHinge;
      lid.pos[2] = lid.rest[2] + Math.sin(sh.lidHinge) * 0.08;
      lid.pos[1] = lid.rest[1] + (1 - Math.cos(sh.lidHinge)) * 0.06;
    }

    if ((s.phase === "runaway" || s.phase === "venting") && !s.failure) {
      rattleT.current += dt;
      if (rattleT.current > 0.05) {
        rattleT.current = 0;
        rattle(0.003 + s.kW * 0.0005 + sh.bulge * 0.006);
      }
    } else if (!s.failure) {
      seatResting();
    }

    if (s.failure && !blown.current) {
      blown.current = true;
      const chem = CHEMISTRIES[s.chem];
      const power = s.failure === "burst" ? chem.explodeImpulse : chem.lidImpulse;
      blow(s.failure, Math.max(0.7, power));
    }

    if (s.events.length) {
      const { setVerdict } = useLab.getState();
      for (const ev of s.events) {
        playEvent(ev.type, chemistry);
        if (ev.type === "verdict") setVerdict(ev.verdict);
      }
      s.events.length = 0;
    }

    setFireMix(s.smoke, s.flameKW);
    hudAcc.current += dt;
    if (hudAcc.current > 0.12) {
      hudAcc.current = 0;
      useLab.getState().patchHud({
        t: s.t,
        cellC: s.cellC,
        boxC: s.boxC,
        kPa: s.kPa,
        kW: s.kW,
        phase: s.phase,
      });
    }
  });

  return null;
}

function World() {
  const chemistry = useLab((s) => s.chemistry);
  const material = useLab((s) => s.material);
  const status = useLab((s) => s.status);
  const runId = useLab((s) => s.runId);
  const maps = useLabTextures();
  const layout = useMemo(() => chamberLayout(material), [material]);

  useLayoutEffect(() => {
    blown.current = false;
    resetBits(material);
    if (status === "running" && runtime.thermal.phase === "idle") {
      beginRun(chemistry, material);
    }
    if (status === "idle") resetIdle(chemistry, material);
  }, [status, runId, chemistry, material]);

  return (
    <>
      <Simulator />
      <LabBay concrete={maps.concrete} />
      <VesselShell materialId={material} maps={maps} />
      <PhoneRig chemistry={chemistry} origin={layout.phone.pos} />
      <NailRig />
      {status !== "idle" ? <ExplosionFX origin={layout.origin} fireMap={maps.fire} /> : null}
      <Director />
    </>
  );
}

export function LabCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const mark = () => {
      if (el.clientWidth > 8 && el.clientHeight > 8) setReady(true);
    };
    mark();
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    resetBits(useLab.getState().material);
  }, []);

  return (
    <div ref={wrapRef} className="lab-stage absolute inset-0 h-full w-full">
      {ready ? (
        <Canvas
          className="block h-full w-full touch-none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          dpr={[1, 1.5]}
          frameloop="always"
          camera={{ position: [1.35, 0.78, 1.55], fov: 38, near: 0.05, far: 40 }}
          gl={{
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
            powerPreference: "default",
            failIfMajorPerformanceCaveat: false,
          }}
          onCreated={({ gl, size }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.15;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.setClearColor("#241f18", 1);
            if (size.width > 0 && size.height > 0) gl.setSize(size.width, size.height, false);
          }}
        >
          <FitGl />
          <color attach="background" args={["#241f18"]} />
          <fog attach="fog" args={["#241f18", 8, 18]} />
          <Lights />
          <Suspense fallback={null}>
            <World />
          </Suspense>
        </Canvas>
      ) : null}
    </div>
  );
}

export default LabCanvas;
