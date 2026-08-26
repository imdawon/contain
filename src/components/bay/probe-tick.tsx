import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { bindHarnessWindow, recordHistory, tickDrags } from "@/lib/bay/harness";
import { listSamplers, probeTime, writeSnap } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

const _proj = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _pt = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();

export function ProbeTick() {
  const camera = useThree((s) => s.camera);
  const latch = useBay((s) => s.latch);
  const selected = useBay((s) => s.selected);
  const trackId = useBay((s) => s.trackId);
  const tool = useBay((s) => s.tool);
  const cutaway = useBay((s) => s.cutaway);
  const setTrack = useBay((s) => s.setTrack);
  const toggleCutaway = useBay((s) => s.toggleCutaway);

  useEffect(() => {
    bindHarnessWindow();
    const w = window as unknown as {
      __baySetTrack: (id: string | null) => void;
      __bayToggleCutaway: () => void;
    };
    w.__baySetTrack = setTrack;
    w.__bayToggleCutaway = toggleCutaway;
  }, [setTrack, toggleCutaway]);

  useFrame((_, dt) => {
    tickDrags(Math.min(dt, 0.05));
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
    camera.getWorldDirection(_dir);
    _look.copy(camera.position).addScaledVector(_dir, 2);

    const objects = [];
    const inView: string[] = [];
    for (const [id, rec] of listSamplers()) {
      const s = rec.sample();
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
      if (b) {
        mass = round(b.mass());
        const lv = b.linvel();
        vx = round(lv.x);
        vy = round(lv.y);
        vz = round(lv.z);
        if (b.numColliders() > 0) {
          const c = b.collider(0);
          friction = round(c.friction());
          restitution = round(c.restitution());
        }
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
        inView: seen,
        mass,
        friction,
        restitution,
        editable: Boolean(b),
        state: s.state ?? {},
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
    recordHistory(objects, probeTime());
  });

  return null;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
