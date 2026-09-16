import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ensureFuseClock, tickFuse } from "@/lib/bay/blast";
import { bindHarnessPipe, bindHarnessWindow, recordHistory, tickDrags } from "@/lib/bay/harness";
import { listSamplers, markPerf, probeTime, writeSnap } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

const _proj = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _pt = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();

export function ProbeTick() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const latch = useBay((s) => s.latch);
  const selected = useBay((s) => s.selected);
  const trackId = useBay((s) => s.trackId);
  const tool = useBay((s) => s.tool);
  const cutaway = useBay((s) => s.cutaway);
  const setTrack = useBay((s) => s.setTrack);
  const toggleCutaway = useBay((s) => s.toggleCutaway);
  const fpsEma = useRef(0);
  const sampleAcc = useRef(0);

  useEffect(() => {
    bindHarnessWindow();
    bindHarnessPipe();
    ensureFuseClock();
    const w = window as unknown as {
      __baySetTrack: (id: string | null) => void;
      __bayToggleCutaway: () => void;
    };
    w.__baySetTrack = setTrack;
    w.__bayToggleCutaway = toggleCutaway;
  }, [setTrack, toggleCutaway]);

  useFrame((_, dt) => {
    (window as any).__bayView = { camera, scene };
    if (gl) {
      const ctx = typeof gl.getContext === "function" ? gl.getContext() : null;
      (globalThis as any).__bayWebglAlive = ctx?.isContextLost ? !ctx.isContextLost() : true;
    }
    const cap = Math.min(dt, 0.05);
    const inst = dt > 1e-4 ? 1 / dt : 0;
    fpsEma.current = fpsEma.current === 0 ? inst : fpsEma.current * 0.85 + inst * 0.15;
    markPerf(fpsEma.current, dt * 1000);
    tickDrags(cap);
    tickFuse(cap);
    sampleAcc.current += Math.max(dt, 1 / 60);
    if (sampleAcc.current < 1 / 30) return;
    sampleAcc.current = 0;
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
    camera.getWorldDirection(_dir);
    _look.copy(camera.position).addScaledVector(_dir, 2);

    const bake = Boolean((globalThis as { __bayBake?: boolean }).__bayBake);
    const objects = [];
    const inView: string[] = [];
    for (const [id, rec] of listSamplers()) {
      if (bake && rec.kind !== "wheel" && rec.kind !== "drum" && id !== trackId) continue;
      const s = rec.sample();
      if (s.state?.missing) continue;
      _pt.set(s.x, s.y, s.z);
      _sphere.center.copy(_pt);
      _sphere.radius = 0.35;
      const seen = _frustum.intersectsSphere(_sphere);
      if (seen) inView.push(id);
      const b = rec.getBody?.();
      let mass: number | null = null;
      let friction: number | null = null;
      let restitution: number | null = null;
      let vx: number | null = null;
      let vy: number | null = null;
      let vz: number | null = null;
      let wx: number | null = null;
      let wy: number | null = null;
      let wz: number | null = null;
      let omega: number | null = null;
      const state = { ...(s.state ?? {}) } as Record<string, unknown>;
      if (b) {
        mass = round(b.mass());
        const lv = b.linvel();
        vx = round(lv.x);
        vy = round(lv.y);
        vz = round(lv.z);
        const av = b.angvel();
        wx = round(av.x);
        wy = round(av.y);
        wz = round(av.z);
        omega = round(Math.hypot(av.x, av.y, av.z));
        if (b.numColliders() > 0) {
          const c = b.collider(0);
          friction = round(c.friction());
          restitution = round(c.restitution());
        }
        const contacts = (b as { numContacts?: () => number }).numContacts;
        if (typeof contacts === "function") state.grounded = contacts.call(b) > 0;
      }
      objects.push({
        id,
        kind: rec.kind,
        x: round(s.x),
        y: round(s.y),
        z: round(s.z),
        rx: round(s.rx),
        ry: round(s.ry),
        rz: round(s.rz),
        vx,
        vy,
        vz,
        wx,
        wy,
        wz,
        omega,
        inView: seen,
        mass,
        friction,
        restitution,
        editable: Boolean(b),
        state,
      });
    }

    writeSnap({
      latch,
      selected,
      trackId,
      tool,
      cutaway,
      camera: {
        x: round(camera.position.x),
        y: round(camera.position.y),
        z: round(camera.position.z),
        lookX: round(_look.x),
        lookY: round(_look.y),
        lookZ: round(_look.z),
        fov: "fov" in camera ? round((camera as THREE.PerspectiveCamera).fov) : 0,
      },
      objects,
      inView,
    });
    recordHistory(
      objects.filter(
        (o) =>
          o.kind === "wheel" ||
          o.kind === "dummy" ||
          o.kind === "dummy-bone" ||
          o.kind === "wagon" ||
          o.kind === "drum" ||
          o.id === trackId,
      ),
      probeTime(),
      {
        x: round(camera.position.x),
        y: round(camera.position.y),
        z: round(camera.position.z),
      },
    );
  });

  return null;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
