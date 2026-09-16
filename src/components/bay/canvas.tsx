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
import { StudioPlace } from "@/components/bay/studio-place";
import { MoveGizmo } from "@/components/bay/move-gizmo";
import { Drum, Wheel } from "@/components/bay/steel";
import { Vehicle } from "@/components/bay/vehicle";
import { Wagon } from "@/components/bay/wagon";
import { Wall } from "@/components/bay/wall";
import { isSolid } from "@/store/bay-store";
import { ProbeTick } from "@/components/bay/probe-tick";
import { FLOOR, isVehicleKind } from "@/lib/bay/parts";
import { CRATE_G, DUMMY_G, VEHICLE_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { actorMesh, listSamplers } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";
import { LabLook } from "@/components/bay/look";
import { Arena, ArenaLook } from "@/components/bay/arena";
import { sceneGravity, sceneTheme } from "@/lib/bay/arena";


const _trackP = new THREE.Vector3();
const _dumpP = new THREE.Vector3();
const _desEye = new THREE.Vector3();
const _desLook = new THREE.Vector3();
const _camRay = new THREE.Raycaster();
const _camDir = new THREE.Vector3();
const _chaseMeshes: THREE.Object3D[] = [];
const _dumpBox = new THREE.Box3();

function fillChaseMeshes(scene: THREE.Scene) {
  _chaseMeshes.length = 0;
  for (const [id, actor] of listSamplers()) {
    const k = actor.kind;
    if (k !== "ramp" && k !== "hill") continue;
    const m = actorMesh(id);
    if (!m) continue;
    _chaseMeshes.push(m);
    const body = m.parent;
    if (body) {
      body.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) _chaseMeshes.push(obj);
      });
    }
  }
  if (_chaseMeshes.length === 0) {
    for (const child of scene.children) _chaseMeshes.push(child);
  }
}

function chaseEyeBlocked(look: THREE.Vector3, eye: THREE.Vector3) {
  if (_chaseMeshes.length === 0) return false;
  _camDir.subVectors(eye, look);
  const span = _camDir.length();
  if (span < 1e-4) return false;
  _camDir.multiplyScalar(1 / span);
  _camRay.near = 0.05;
  _camRay.far = span + 0.02;
  _camRay.set(look, _camDir);
  const hits = _camRay.intersectObjects(_chaseMeshes, true);
  const clear = 1.2;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!hit) continue;
    const d = hit.distance;
    if (d > 2.6 && d < span - 0.12) return true;
    if (span - d < clear && d < span) return true;
  }
  _camDir.multiplyScalar(-1);
  _camRay.near = 0;
  _camRay.far = 1.35;
  _camRay.set(eye, _camDir);
  const inside = _camRay.intersectObjects(_chaseMeshes, true);
  if (inside.length && inside[0] && inside[0].distance < 1.25) return true;
  _camDir.subVectors(eye, look).normalize();
  _camRay.set(eye, _camDir);
  const rear = _camRay.intersectObjects(_chaseMeshes, true);
  return Boolean(rear.length && rear[0] && rear[0].distance < 1.25);
}

function dumpMeshes() {
  const out: THREE.Object3D[] = [];
  for (const [id, actor] of listSamplers()) {
    if (actor.kind !== "dumptruck") continue;
    const m = actorMesh(id);
    if (!m) continue;
    out.push(m);
    const body = m.parent;
    if (body) {
      body.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) out.push(obj);
      });
    }
  }
  return out;
}

function eyeTooCloseDump(eye: THREE.Vector3, look: THREE.Vector3, dx: number, dy: number, dz: number) {
  const sep = Math.hypot(eye.x - dx, eye.y - dy, eye.z - dz);
  if (sep < 6.5) return true;
  const meshes = dumpMeshes();
  if (!meshes.length) return false;
  _camDir.subVectors(look, eye);
  const span = _camDir.length();
  if (span < 1e-4) return false;
  _camDir.multiplyScalar(1 / span);
  _camRay.near = 0;
  _camRay.far = 3.4;
  _camRay.set(eye, _camDir);
  const hits = _camRay.intersectObjects(meshes, true);
  return Boolean(hits.length && hits[0] && hits[0].distance < 3.2);
}

function clearBakeEye(eye: THREE.Vector3, look: THREE.Vector3, scene: THREE.Scene) {
  fillChaseMeshes(scene);
  const keep = () => {
    eye.y = Math.min(6.4, Math.max(3.7, eye.y));
    if (Math.abs(eye.x) > 4.2) eye.x = Math.sign(eye.x || 1) * 4.2;
  };
  keep();
  for (let i = 0; i < 18; i++) {
    if (!chaseEyeBlocked(look, eye)) break;
    eye.z -= 0.85;
    keep();
  }
  if (chaseEyeBlocked(look, eye)) {
    eye.z = Math.min(eye.z, look.z) - 16;
    const side = eye.x >= look.x ? 2.55 : -2.55;
    eye.x = Math.max(-4.2, Math.min(4.2, look.x * 0.15 + side));
    keep();
  }
}

function pushEyeOutOfDump(eye: THREE.Vector3, dumpZ: number) {
  const meshes = dumpMeshes();
  if (!meshes.length) {
    if (eye.z > dumpZ - 10) eye.z = dumpZ - 18;
    return;
  }
  _dumpBox.makeEmpty();
  for (const m of meshes) {
    try {
      _dumpBox.expandByObject(m);
    } catch {
      /* */
    }
  }
  if (_dumpBox.isEmpty()) {
    if (eye.z > dumpZ - 10) eye.z = dumpZ - 18;
    return;
  }
  const cz = (_dumpBox.min.z + _dumpBox.max.z) * 0.5;
  if (Math.abs(cz - dumpZ) > 28) {
    if (eye.z > dumpZ - 10) eye.z = dumpZ - 18;
    return;
  }
  _dumpBox.expandByScalar(2.2);
  if (_dumpBox.containsPoint(eye) || eye.z > _dumpBox.min.z - 9) {
    eye.z = Math.min(eye.z, _dumpBox.min.z - 16);
    eye.y = Math.min(6.2, Math.max(4.0, eye.y));
  }
}


const CAM_OFF_DEF: [number, number, number] = [0, 2.2, -8];
const CAM_LOOK_DEF: [number, number, number] = [0, -0.3, 14];
const CAM_FOV_DEF = 48;
const PIPE_HALF_X = 10.6;
const PIPE_LIP_Y = 12;
const CAM_EYE_Y_MAX = 13.2;
const CAM_EYE_Y_MIN = 3.4;
const CAM_CLOSE_Z = -5;
/** Keep chase eye/look above the U-pipe inner floor. Matches ramp.tsx parabolaY trough (+0.9) and buildPipe flat. */
const TROUGH_CLEAR = 2;
const TROUGH_LOOK_CLEAR = 0.2;
const PIPE_FLOOR_LOCAL = 0.9;
const PIPE_FLAT_X = 4;

type PipeEnt = { kind: string; pos: [number, number, number]; size?: [number, number, number]; cut?: number };

function camTriple(src: number[] | undefined, fallback: [number, number, number]): [number, number, number] {
  const a = src?.[0];
  const b = src?.[1];
  const c = src?.[2];
  if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) return [a as number, b as number, c as number];
  return fallback;
}

function sampleTrackPos(id: string | undefined): boolean {
  if (!id) return false;
  const rec = listSamplers().get(id);
  const mesh = rec ? actorMesh(id) : null;
  if (mesh) {
    try {
      mesh.getWorldPosition(_trackP);
      if (Number.isFinite(_trackP.x) && Number.isFinite(_trackP.y) && Number.isFinite(_trackP.z)) return true;
    } catch {
      /* */
    }
  }
  if (rec) {
    const p = rec.sample();
    if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
      _trackP.set(p.x, p.y, p.z);
      return true;
    }
  }
  const ent = useBay.getState().entities.find((e) => e.id === id);
  if (ent) {
    _trackP.set(ent.pos[0], ent.pos[1], ent.pos[2]);
    return Number.isFinite(_trackP.x) && Number.isFinite(_trackP.y) && Number.isFinite(_trackP.z);
  }
  return false;
}

function coilTrackId(trackId: string | undefined, ents: { id: string; kind: string; name?: string }[]): string | undefined {
  if (trackId) return trackId;
  const hit = ents.find((e) => {
    const n = String(e.name ?? e.id ?? "").toLowerCase();
    return e.kind === "wheel" || e.kind === "coil" || n === "coil" || n === "wheel";
  });
  return hit?.id;
}

/** Keep chase eye with the U-pipe: no tan-void flyaway when the coil is airborne or wide. */
function pipeStayCam(ox: number, oy: number, oz: number, lx: number, ly: number, lz: number) {
  const tx = _trackP.x;
  const ty = _trackP.y;
  const tz = _trackP.z;
  let mix = 0;
  const air = ty - PIPE_LIP_Y;
  if (air > 0) mix = Math.min(1, air / 7);
  const out = Math.abs(tx + ox) - PIPE_HALF_X;
  if (out > 0) mix = Math.max(mix, Math.min(1, out / 5));
  const ozUse = oz + (CAM_CLOSE_Z - oz) * mix;
  const lyUse = ly + (0 - ly) * mix;
  let ex = tx + ox;
  if (Math.abs(ex) > PIPE_HALF_X) ex = Math.sign(ex || 1) * PIPE_HALF_X;
  let ey = ty + oy;
  if (mix > 0) ey = ey * (1 - mix) + (PIPE_LIP_Y + 1.6) * mix;
  ey = Math.min(CAM_EYE_Y_MAX, Math.max(CAM_EYE_Y_MIN, ey));
  _desEye.set(ex, ey, tz + ozUse);
  _desLook.set(tx + lx, ty + lyUse, tz + lz);
}

function pipeParabolaY(s: number, h: number) {
  const v = 0.5;
  const a = h / (v * v);
  const d = s - v;
  return a * d * d + PIPE_FLOOR_LOCAL;
}

function troughFloorAtX(x: number, ents: PipeEnt[]) {
  let best = Infinity;
  for (const e of ents) {
    if (e.kind !== "ramp" && e.kind !== "hill") continue;
    if ((e.cut ?? 0) < 0.99) continue;
    const w = e.size?.[0] ?? 24;
    const h = e.size?.[1] ?? 10;
    const lx = x - e.pos[0];
    const hw = w / 2;
    let local = PIPE_FLOOR_LOCAL;
    if (Math.abs(lx) > hw) local = pipeParabolaY(lx < 0 ? 0 : 1, h);
    else if (Math.abs(lx) > PIPE_FLAT_X) local = pipeParabolaY(Math.min(1, Math.max(0, lx / w + 0.5)), h);
    const y = e.pos[1] + local;
    if (y < best) best = y;
  }
  return Number.isFinite(best) ? best : 2;
}

function isHalfpipeTrack(sceneId: string | undefined, ents: PipeEnt[], followCoil: boolean) {
  if (String(sceneId ?? "").startsWith("halfpipe-")) return true;
  if (!followCoil) return false;
  return ents.some((e) => (e.kind === "ramp" || e.kind === "hill") && (e.cut ?? 0) >= 0.99);
}

/** After offset: never sit under the trough floor; keep chase behind the coil. */
function clampHalfpipeChase(ents: PipeEnt[]) {
  const ty = _trackP.y;
  const minEye = Math.max(ty + TROUGH_CLEAR, troughFloorAtX(_desEye.x, ents) + TROUGH_CLEAR);
  const minLook = Math.max(ty + TROUGH_LOOK_CLEAR, troughFloorAtX(_desLook.x, ents) + TROUGH_LOOK_CLEAR);
  if (_desEye.y < minEye) _desEye.y = minEye;
  if (_desLook.y < minLook) _desLook.y = minLook;
  if (_desEye.z > _trackP.z - 1.2) _desEye.z = _trackP.z - 4;
}

function liftEyeAbovePipe(scene: THREE.Scene) {
  fillChaseMeshes(scene);
  for (let i = 0; i < 16; i++) {
    if (!chaseEyeBlocked(_desLook, _desEye)) break;
    _desEye.y += 0.45;
  }
}

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
  const scene = useThree((s) => s.scene);
  const primed = useRef(false);
  useEffect(() => {
    primed.current = false;
  }, [trackId, stageN]);
  useFrame(() => {
    try {
      const bake = Boolean((globalThis as { __bayBake?: boolean }).__bayBake);
      const bay = useBay.getState();
      const ents = bay.entities;
      const dumpEnt = ents.find((e) => e.kind === "dumptruck");
      const trackRef = String(bay.scene?.track?.ref ?? "").toLowerCase();
      const tid = String(trackId ?? "").toLowerCase();
      const tracked = ents.find((e) => e.id === trackId);
      const followCoil =
        trackRef === "coil" ||
        trackRef === "wheel" ||
        tid.includes("coil") ||
        tid.includes("wheel") ||
        tracked?.kind === "wheel" ||
        tracked?.kind === "coil" ||
        String(tracked?.name ?? "").toLowerCase() === "coil" ||
        String(tracked?.name ?? "").toLowerCase() === "wheel";
      const chaseDump = !followCoil && (bake || Boolean(dumpEnt));
      if (followCoil) {
        const wantFov = fov || CAM_FOV_DEF;
        if ("fov" in camera && camera.fov !== wantFov) {
          camera.fov = wantFov;
          camera.updateProjectionMatrix();
        }
        const id = coilTrackId(trackId, ents);
        if (sampleTrackPos(id)) {
          const [ox, oy, oz] = camTriple(offset, CAM_OFF_DEF);
          const [lx, ly, lz] = camTriple(look, CAM_LOOK_DEF);
          pipeStayCam(ox, oy, oz, lx, ly, lz);
          if (isHalfpipeTrack(bay.scene?.id, ents, true)) {
            clampHalfpipeChase(ents);
            liftEyeAbovePipe(scene);
          }
          if (
            Number.isFinite(_desEye.x) &&
            Number.isFinite(_desEye.y) &&
            Number.isFinite(_desEye.z) &&
            Number.isFinite(_desLook.x) &&
            Number.isFinite(_desLook.y) &&
            Number.isFinite(_desLook.z)
          ) {
            camera.position.copy(_desEye);
            const controls = orbit.current;
            if (controls) controls.target.copy(_desLook);
            camera.lookAt(_desLook);
            camera.updateMatrixWorld();
            primed.current = true;
          }
        }
        return;
      }
      if (chaseDump && "fov" in camera) {
        const wantFov = bake ? 46 : fov || 48;
        if (camera.fov !== wantFov) {
          camera.fov = wantFov;
          camera.updateProjectionMatrix();
        }
      } else if (!bake && fov && "fov" in camera && camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      if (chaseDump) {
        const dumpId = dumpEnt?.id;
        let dx: number | null = null;
        let dy = 0;
        let dz = 0;
        if (dumpId) {
          const dMesh = actorMesh(dumpId);
          if (dMesh) {
            try {
              dMesh.getWorldPosition(_dumpP);
              const wx = _dumpP.x;
              const wy = _dumpP.y;
              const wz = _dumpP.z;
              const finite = Number.isFinite(wx) && Number.isFinite(wy) && Number.isFinite(wz);
              const ez = dumpEnt ? dumpEnt.pos[2] : 0;
              const unusable =
                !finite || (wz < 10 && ez >= 20) || Math.abs(wz - ez) > 25;
              if (!unusable) {
                dx = wx;
                dy = wy;
                dz = wz;
              } else if (dumpEnt) {
                dx = dumpEnt.pos[0];
                dy = dumpEnt.pos[1];
                dz = dumpEnt.pos[2];
              }
            } catch {
              /* */
            }
          }
          if (dx == null) {
            const dRec = listSamplers().get(dumpId);
            if (dRec) {
              const p = dRec.sample();
              if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
                dx = p.x;
                dy = p.y;
                dz = p.z;
              }
            } else if (dumpEnt) {
              dx = dumpEnt.pos[0];
              dy = dumpEnt.pos[1];
              dz = dumpEnt.pos[2];
            }
          }
        }
        let x = 0;
        let haveCoil = false;
        if (trackId) {
          const rec = listSamplers().get(trackId);
          const ent = rec ? null : ents.find((e) => e.id === trackId);
          const mesh = rec ? actorMesh(trackId) : null;
          if (mesh) {
            try {
              mesh.getWorldPosition(_trackP);
              if (Number.isFinite(_trackP.x) && Number.isFinite(_trackP.y) && Number.isFinite(_trackP.z)) {
                x = _trackP.x;
                haveCoil = true;
              }
            } catch {
              /* */
            }
          }
          if (!haveCoil) {
            const p = rec ? rec.sample() : ent ? { x: ent.pos[0], y: ent.pos[1], z: ent.pos[2] } : null;
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
              x = p.x;
              haveCoil = true;
            }
          }
        }
        const dumpW = 0.78;
        const coilW = 0.22;
        if (dx == null && dumpEnt) {
          dx = dumpEnt.pos[0];
          dy = dumpEnt.pos[1];
          dz = dumpEnt.pos[2];
        }
        if (dx == null) {
          dx = 1.8;
          dy = 3.6;
          dz = 40;
        }
        const lookX = haveCoil ? dx * dumpW + x * coilW : dx;
        const dumpZ = dz;
        const lookZ = dumpZ + 1.1;
        const lookY = 2.35;
        _desLook.set(Math.max(-4, Math.min(4, lookX)), lookY, lookZ);
        const eyeY = 5.6;
        _desEye.set(Math.max(-4.2, Math.min(4.2, lookX * 0.15 + 2.55)), eyeY, dumpZ - 16);
        _desEye.y = eyeY;
        if (_desEye.z > dz - 14) _desEye.z = dz - 16;
        pushEyeOutOfDump(_desEye, dumpZ);
        clearBakeEye(_desEye, _desLook, scene);
        if (eyeTooCloseDump(_desEye, _desLook, dx, dy, dz)) {
          _desEye.z = Math.min(_desEye.z, dz - 20);
          _desEye.y = Math.min(6.2, Math.max(4.0, _desEye.y));
        }
        _desEye.y = Math.min(6.4, Math.max(3.7, _desEye.y));
        if (Math.abs(_desEye.x) > 4.2) _desEye.x = Math.sign(_desEye.x || 1) * 4.2;
        if (
          Number.isFinite(_desEye.x) === false ||
          Number.isFinite(_desEye.y) === false ||
          Number.isFinite(_desEye.z) === false ||
          Number.isFinite(_desLook.x) === false ||
          Number.isFinite(_desLook.y) === false ||
          Number.isFinite(_desLook.z) === false
        ) {
          return;
        }
        camera.position.copy(_desEye);
        const controls = orbit.current;
        if (controls) controls.target.copy(_desLook);
        camera.lookAt(_desLook);
        camera.updateMatrixWorld();
        primed.current = true;
        return;
      }
      if (eye && look && !trackId) {
        camera.position.set(eye[0], eye[1], eye[2]);
        camera.lookAt(look[0], look[1], look[2]);
        camera.updateMatrixWorld();
        return;
      }
      if (!trackId) return;
      const rec = listSamplers().get(trackId);
      const ent = rec ? null : useBay.getState().entities.find((e) => e.id === trackId);
      if (!rec && !ent) return;
      const mesh = rec ? actorMesh(trackId) : null;
      let x: number;
      let y: number;
      let z: number;
      if (mesh) {
        mesh.getWorldPosition(_trackP);
        x = _trackP.x;
        y = _trackP.y;
        z = _trackP.z;
      } else {
        const p = rec ? rec.sample() : { x: ent!.pos[0], y: ent!.pos[1], z: ent!.pos[2] };
        x = p.x;
        y = p.y;
        z = p.z;
      }
      const controls = orbit.current;
      if (!controls) return;
      const t = controls.target;
      if (!primed.current) {
        t.set(x, y, z);
        if (offset) camera.position.set(x + offset[0], y + offset[1], z + offset[2]);
        primed.current = true;
        camera.updateMatrixWorld();
        return;
      }
      camera.position.x += x - t.x;
      camera.position.y += y - t.y;
      camera.position.z += z - t.z;
      t.set(x, y, z);
      camera.updateMatrixWorld();
    } catch {
      /* chase bake must not throw */
    }
  }, 1);
  return null;
}

function Present() {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera);
  }, 10);
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
    const g = window as unknown as { __bayKick?: () => void };
    g.__bayKick = () => {
      if (busy.current) return;
      busy.current = true;
      try {
        invalidate();
        advance(performance.now(), true);
      } catch {
        /* rAF-less kick is best-effort */
      } finally {
        busy.current = false;
        lastRaf.current = performance.now();
      }
    };
    const id = window.setInterval(() => {
      const now = performance.now();
      const hidden = typeof document !== "undefined" && document.hidden;
      if (!hidden) return;
      if (now - lastRaf.current < 80) return;
      g.__bayKick?.();
    }, 50);
    return () => {
      window.clearInterval(id);
      if (g.__bayKick) delete g.__bayKick;
    };
  }, [advance, invalidate, hangar]);
  return null;
}

function SlowMoDriver() {
  const slowMo = useBay((s) => s.slowMo);
  const { step } = useRapier();
  useFrame((_, dt) => {
    if (!slowMo || !useBay.getState().playing) return;
    step(Math.min(dt, 0.05) * 0.25);
  });
  return null;
}


type GrabWin = Window & {
  __bayWantGrab?: boolean;
  __bayGrabData?: string | null;
};

function GlHooks({ onLost }: { onLost: () => void }) {
  const gl = useThree((s) => s.gl);
  const lostRef = useRef(onLost);
  lostRef.current = onLost;
  useLayoutEffect(() => {
    const canvas = gl.domElement;
    const g = gl as THREE.WebGLRenderer & { __bayGrabWrap?: boolean };
    if (!g.__bayGrabWrap) {
      g.__bayGrabWrap = true;
      const orig = g.render.bind(g);
      g.render = ((scene: THREE.Object3D, camera: THREE.Camera) => {
        orig(scene, camera);
        const w = window as GrabWin;
        if (!w.__bayWantGrab) return;
        try {
          w.__bayGrabData = canvas.toDataURL("image/jpeg", 0.85);
        } catch {
          w.__bayGrabData = null;
        }
        w.__bayWantGrab = false;
      }) as typeof g.render;
    }
    const lost = (ev: Event) => {
      ev.preventDefault();
      lostRef.current();
    };
    canvas.addEventListener("webglcontextlost", lost, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost, false);
    };
  }, [gl]);
  return null;
}

function FitGl() {
  const gl = useThree((s) => s.gl);
  const setSize = useThree((s) => s.setSize);
  const applyRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const canvas = gl.domElement;
    const apply = () => {
      const parent = canvas.parentElement;
      const wWin = window as GrabWin & { __bayBake?: boolean };
      const bake = Boolean(wWin.__bayBake) || Boolean(wWin.__bayWantGrab);
      let w = parent?.clientWidth ?? 0;
      let h = parent?.clientHeight ?? 0;
      if (!parent || w < 2 || h < 2) return;
      // Bake used to force 720x1280 @ dpr 2 (often 2560x2560) and lose the GL context;
      // tape letterboxes to 9:16 after grab. Keep the painted buffer stable.
      void bake;
      const dpr = 1;
      if (canvas.width === Math.floor(w * dpr) && canvas.height === Math.floor(h * dpr)) return;
      gl.setPixelRatio(dpr);
      setSize(w, h);
    };
    applyRef.current = apply;
    apply();
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(apply);
    ro.observe(parent);
    return () => {
      ro.disconnect();
    };
  }, [gl, setSize]);
  useFrame(() => {
    applyRef.current();
  });
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
  const placing = Boolean(useBay((s) => s.placeKind));
  const playing = useBay((s) => s.playing);
  const garden = Boolean(sceneTheme(scene));

  return (
    <Physics key={stageN} gravity={sceneGravity(scene)} timeStep={slowMo ? "vary" : 1 / 60} paused={!playing || slowMo} interpolate numSolverIterations={24} numInternalPgsIterations={12} maxCcdSubsteps={1}>
      <SlowMoDriver />
      <TrackCam orbit={orbit} />
      <Present />
      <ProbeTick />
      <BlastBus />
      {scene ? <SceneRig key={`${scene.id}-${stageN}`} scene={scene} /> : null}
      <RigidBody type="fixed" colliders={false} friction={0.95} restitution={0}>
        <CuboidCollider args={[FLOOR.half, 0.25, FLOOR.half]} position={[0, -0.25, 0]} collisionGroups={interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G])} />
        {garden ? null : (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow={false} castShadow={false}>
            <planeGeometry args={[FLOOR.half * 2, FLOOR.half * 2]} />
            <meshStandardMaterial color="#4c463f" roughness={0.94} metalness={0.06} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
          </mesh>
        )}
      </RigidBody>
      {garden ? <Arena /> : (
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
        ) : isVehicleKind(e.kind) ? (
          <Vehicle key={e.id} id={e.id} kind={e.kind} pos={e.pos} rot={e.rot} size={e.size} mass={e.mass} grip={e.grip} />
        ) : isSolid(e.kind) ? (
          <Solid key={e.id} id={e.id} shape={e.kind} pos={e.pos} />
        ) : null,
      )}
      <OrbitControls
        ref={(el) => {
          orbit.current = el;
        }}
        makeDefault
        enabled={!dragging && !placing}
        enablePan
        enableZoom
        zoomSpeed={hangar ? 1.35 : 1}
        minDistance={hangar ? 2 : 0.5}
        maxDistance={hangar ? 2500 : 80}
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI - 0.12}
        target={[0, 0.7, 0.55]}
        enableDamping={false}
        dampingFactor={0.08}
      />
    </Physics>
  );
}


export function BayCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1800, h: 1280 });
  const [glGen, setGlGen] = useState(0);
  const lastLost = useRef(0);
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
    return () => {
      ro.disconnect();
    };
  }, []);
  const ready = box.w > 8 && box.h > 8;

  return (
    <div ref={wrap} className="lab-stage absolute inset-0 h-full w-full">
      {ready ? (
        <Canvas
          key={glGen}
          className="block h-full w-full touch-none"
          style={{ position: "absolute", inset: 0, width: box.w, height: box.h }}
          dpr={1}
          shadows={false}
          frameloop="always"
          camera={{ position: [3.4, 1.7, 3.6], fov: 42, near: 0.08, far: 2500 }}
          gl={{
            antialias: false,
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
            gl.shadowMap.enabled = false;
            gl.setClearColor("#8a7c6a", 1);
            state.setSize(box.w, box.h);
          }}
        >
          <GlHooks
            onLost={() => {
              const now = performance.now();
              if (now - lastLost.current < 2500) return;
              lastLost.current = now;
              setGlGen((n) => n + 1);
            }}
          />
          <FitGl />
          <KickFrames />
          <ArenaLook />
          <LabLook />
          <World />
          <StudioPlace />
          <MoveGizmo />
          <ScorePlate />
        </Canvas>
      ) : null}
    </div>
  );
}

export default BayCanvas;

