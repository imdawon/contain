import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { actorMesh, assemblyMembers, listSamplers } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _box = new THREE.Box3();
const _ray = new THREE.Raycaster();
const _eye = new THREE.Vector3();
const _hitP = new THREE.Vector3();
const _eul = new THREE.Euler();
const YAW_STEPS = 24;

type LookAim = { id: string; offset: THREE.Vector3 };

export type CamRot = { x: number; y: number; z: number; unit: "deg"; order: "YXZ" };

export type PointCamResult = {
  ok: boolean;
  dummy: string | null;
  camera: { x: number; y: number; z: number; rot: CamRot };
  lookAt: { x: number; y: number; z: number };
  dummyXyz: { x: number; y: number; z: number } | null;
  occluded: boolean;
  inFrame: boolean;
  blocker: string | null;
  miss: string | null;
  rev?: number;
};

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function radToDeg(n: number) {
  return round3((n * 180) / Math.PI);
}

function dummyObjectSet(id: string) {
  const skip = new Set<THREE.Object3D>();
  for (const mid of assemblyMembers(id)) {
    actorMesh(mid)?.traverse((o) => skip.add(o));
  }
  actorMesh(id)?.traverse((o) => skip.add(o));
  return skip;
}

function skipHit(obj: THREE.Object3D, dummy: Set<THREE.Object3D>) {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (dummy.has(o)) return true;
    if (o.userData?.labSkip || o.userData?.labOutline) return true;
    const n = (o.name || "").toLowerCase();
    if (n.includes("grid") || n.includes("helper")) return true;
    o = o.parent;
  }
  return false;
}

function firstBlocker(scene: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, dummy: Set<THREE.Object3D>) {
  _dir.copy(to).sub(from);
  const dist = _dir.length();
  if (dist < 0.05) return { name: "too-close", dist: 0 };
  _dir.multiplyScalar(1 / dist);
  _ray.set(from, _dir);
  _ray.near = 0.25;
  _ray.far = Math.max(0.3, dist - 0.35);
  const hits = _ray.intersectObject(scene, true);
  for (const h of hits) {
    if (skipHit(h.object, dummy)) continue;
    _hitP.copy(h.point);
    if (_hitP.distanceTo(to) < 0.55) continue;
    return { name: h.object.name || h.object.type || "mesh", dist: h.distance };
  }
  return null;
}

function dummyChestPoint(id: string) {
  const chestId = `${id}-chest`;
  const rec =
    listSamplers().get(chestId) ??
    listSamplers().get(`${id}-hips`) ??
    listSamplers().get(id) ??
    [...listSamplers().entries()].find(([k, r]) => r.kind === "dummy-bone" && k.startsWith(`${id}-`) && k.endsWith("-chest"))?.[1];
  if (rec) {
    const p = rec.sample();
    return new THREE.Vector3(p.x, p.y, p.z);
  }
  const crew = assemblyMembers(id);
  const bone = crew.find((x) => x.endsWith("-chest")) ?? crew.find((x) => x.endsWith("-hips")) ?? crew[0] ?? id;
  const mesh = actorMesh(bone) ?? actorMesh(chestId) ?? actorMesh(id);
  if (mesh) {
    mesh.getWorldPosition(_to);
    return _to.clone();
  }
  const ent = useBay.getState().entities.find((e) => e.id === id || e.kind === "dummy");
  if (ent) return new THREE.Vector3(ent.pos[0], ent.pos[1] + 1.05, ent.pos[2]);
  return null;
}

function applyLook(camera: THREE.Camera, eye: THREE.Vector3, chest: THREE.Vector3) {
  camera.position.copy(eye);
  camera.lookAt(chest);
  camera.updateMatrixWorld();
  if ("updateProjectionMatrix" in camera) (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
}

function camRotDeg(camera: THREE.Camera): CamRot {
  _eul.setFromQuaternion(camera.quaternion, "YXZ");
  return { x: radToDeg(_eul.x), y: radToDeg(_eul.y), z: radToDeg(_eul.z), unit: "deg", order: "YXZ" };
}

function xyz(v: THREE.Vector3) {
  return { x: round3(v.x), y: round3(v.y), z: round3(v.z) };
}

function missResult(id: string, miss: string): PointCamResult {
  return {
    ok: false,
    dummy: id,
    camera: { x: 0, y: 0, z: 0, rot: { x: 0, y: 0, z: 0, unit: "deg", order: "YXZ" } },
    lookAt: { x: 0, y: 0, z: 0 },
    dummyXyz: null,
    occluded: true,
    inFrame: false,
    blocker: null,
    miss,
  };
}

type OrbitTarget = { target: THREE.Vector3 };

export function LookCam() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls) as unknown as OrbitTarget | null;
  const stageN = useBay((s) => s.stageN);
  const aim = useRef<LookAim | null>(null);
  const pointRef = useRef<(id: string) => PointCamResult>((id) => missResult(id, "no-camera"));

  useEffect(() => {
    aim.current = null;
  }, [stageN]);

  pointRef.current = (id: string) => {
    const chest = dummyChestPoint(id);
    if (!chest) return missResult(id, "dummy-missing");
    const dummy = dummyObjectSet(id);
    _eye.copy(camera.position).sub(chest);
    let radius = _eye.length();
    if (!Number.isFinite(radius) || radius < 16) radius = 34;
    if (radius > 48) radius = 48;
    let theta = Math.atan2(_eye.x, _eye.z);
    if (!Number.isFinite(theta)) theta = Math.PI;
    let phi = Math.asin(THREE.MathUtils.clamp(_eye.y / radius, -0.92, 0.92));
    if (!Number.isFinite(phi) || phi < 0.18) phi = 0.28;

    const place = (th: number, ph: number) => {
      const cp = Math.cos(ph);
      _eye.set(chest.x + radius * Math.sin(th) * cp, chest.y + radius * Math.sin(ph), chest.z + radius * Math.cos(th) * cp);
      applyLook(camera, _eye, chest);
      const hit = firstBlocker(scene, _eye, chest, dummy);
      _ndc.copy(chest).project(camera);
      const inFrame = Math.abs(_ndc.x) < 0.72 && Math.abs(_ndc.y) < 0.72 && _ndc.z > 0 && _ndc.z < 1;
      return { hit, inFrame };
    };

    let occluded = true;
    let blocker: string | null = "start";
    let inFrame = false;
    let chosen: THREE.Vector3 | null = null;
    const pitches = [phi, phi + 0.18, 0.42, 0.62];
    search: for (const ph of pitches) {
      for (let i = 0; i < YAW_STEPS; i++) {
        const th = theta + (i * Math.PI * 2) / YAW_STEPS;
        const judged = place(th, ph);
        inFrame = judged.inFrame;
        if (!judged.hit && judged.inFrame) {
          occluded = false;
          blocker = null;
          chosen = _eye.clone();
          break search;
        }
        blocker = judged.hit?.name ?? (judged.inFrame ? "tight" : "out-of-frame");
      }
    }

    if (!chosen) {
      place(theta, Math.max(0.55, phi));
      chosen = _eye.clone();
    }
    applyLook(camera, chosen, chest);
    aim.current = { id, offset: chosen.clone().sub(chest) };
    if (controls?.target) controls.target.copy(chest);
    try {
      (window as unknown as { __bayKick?: () => void }).__bayKick?.();
    } catch {
      /* kick is best-effort */
    }
    const rot = camRotDeg(camera);
    return {
      ok: !occluded && inFrame,
      dummy: id,
      camera: { ...xyz(chosen), rot },
      lookAt: xyz(chest),
      dummyXyz: xyz(chest),
      occluded,
      inFrame,
      blocker,
      miss: occluded ? "dummy-covered" : inFrame ? null : "dummy-out-of-frame",
      rev: 5,
    };
  };

  useFrame(() => {
    const w = window as unknown as { __bayPointCam?: (id: string) => PointCamResult };
    w.__bayPointCam = (id: string) => pointRef.current(id);
    const live = aim.current;
    if (!live) return;
    const chest = dummyChestPoint(live.id);
    if (!chest) return;
    camera.position.copy(chest).add(live.offset);
    camera.lookAt(chest);
    if (controls?.target) controls.target.copy(chest);
    camera.updateMatrixWorld();
  }, 2);

  return null;
}
