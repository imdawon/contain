import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { actorMesh, assemblyMembers, listSamplers, note, translateAssembly } from "@/lib/bay/probe";
import { captureScene } from "@/lib/bay/studio";
import { useBay } from "@/store/bay-store";

const _hit = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _wp = new THREE.Vector3();
const AXES = [
  { id: "x" as const, color: "#e24a4a" },
  { id: "y" as const, color: "#4caf6a" },
  { id: "z" as const, color: "#4a7ae2" },
];

type AxisId = "x" | "y" | "z";

function entityIdOf(id: string) {
  const ents = useBay.getState().entities;
  if (ents.some((e) => e.id === id)) return id;
  const cut = id.lastIndexOf("-");
  if (cut > 0) {
    const left = id.slice(0, cut);
    if (ents.some((e) => e.id === left)) return left;
  }
  return id;
}

/** Visual world origin — same mesh TrackCam follows. Rapier sample can lag the dummy boxes. */
function livePos(id: string) {
  const mesh = actorMesh(id);
  if (mesh) {
    mesh.updateWorldMatrix(true, false);
    mesh.getWorldPosition(_wp);
    if (Number.isFinite(_wp.x)) return { x: _wp.x, y: _wp.y, z: _wp.z };
  }
  for (const mid of assemblyMembers(id)) {
    const m = actorMesh(mid);
    if (!m) continue;
    m.updateWorldMatrix(true, false);
    m.getWorldPosition(_wp);
    if (Number.isFinite(_wp.x)) return { x: _wp.x, y: _wp.y, z: _wp.z };
  }
  const rec = listSamplers().get(id);
  if (rec) {
    const p = rec.sample();
    if (!p.state?.missing) return { x: p.x, y: p.y, z: p.z };
  }
  const ent = useBay.getState().entities.find((e) => e.id === entityIdOf(id));
  return ent ? { x: ent.pos[0], y: ent.pos[1], z: ent.pos[2] } : { x: 0, y: 0, z: 0 };
}

function commitRoot(id: string) {
  const root = entityIdOf(id);
  const ent = useBay.getState().entities.find((e) => e.id === root);
  if (!ent) return;
  const hipsMesh = actorMesh(`${root}-hips`);
  if (hipsMesh) {
    hipsMesh.updateWorldMatrix(true, false);
    hipsMesh.getWorldPosition(_wp);
  } else {
    const p = livePos(id);
    _wp.set(p.x, p.y, p.z);
  }
  const y = ent.kind === "dummy" ? Math.max(0, _wp.y - 0.74) : _wp.y;
  useBay.getState().patchEntity(root, { pos: [_wp.x, y, _wp.z] });
  useBay.getState().stampBlueprint(captureScene());
}

type DragJob = {
  axis: AxisId;
  id: string;
  origin: THREE.Vector3;
  startX: number;
  startY: number;
  applied: number;
  ax: number;
  ay: number;
};

/** Screen pixels for +1 world meter on this axis. y is CSS-down. */
function axisPixels(camera: THREE.Camera, origin: THREE.Vector3, axis: THREE.Vector3, w: number, h: number) {
  _p0.copy(origin).project(camera);
  _p1.copy(origin).add(axis).project(camera);
  return {
    ax: (_p1.x - _p0.x) * 0.5 * w,
    ay: (_p0.y - _p1.y) * 0.5 * h,
  };
}

function metersAlong(dpx: number, dpy: number, ax: number, ay: number) {
  const denom = ax * ax + ay * ay;
  const minLen = 14;
  if (denom < minLen * minLen) {
    const len = Math.hypot(ax, ay) || 1e-6;
    return (dpx * (ax / len) + dpy * (ay / len)) / minLen;
  }
  return (dpx * ax + dpy * ay) / denom;
}

function clientOf(camera: THREE.Camera, world: THREE.Vector3, box: DOMRect) {
  _hit.copy(world).project(camera);
  return {
    x: box.left + (_hit.x * 0.5 + 0.5) * box.width,
    y: box.top + (0.5 - _hit.y * 0.5) * box.height,
  };
}

type GizmoApi = {
  drag: (axis: string, pixels?: number, camDist?: number) => {
    ok: boolean;
    reason?: string;
    axis?: AxisId;
    pixels?: number;
    meters?: number;
    camDist?: number;
    pxPerMeter?: number;
    origin?: { x: number; y: number; z: number };
  };
  live: (id?: string) => { x: number; y: number; z: number };
};

declare global {
  interface Window {
    __bayGizmo?: GizmoApi;
  }
}

/** Unity/Blender move gizmo: screen-space axis drag, frozen origin, visual mesh bind. */
export function MoveGizmo() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const selected = useBay((s) => s.selected);
  const playing = useBay((s) => s.playing);
  const group = useRef<THREE.Group>(null);
  const drag = useRef<DragJob | null>(null);

  const show = Boolean(!playing && selected);
  const mats = useMemo(
    () => AXES.map((a) => new THREE.MeshBasicMaterial({ color: a.color, depthTest: false, toneMapped: false })),
    [],
  );
  const hitMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, toneMapped: false }),
    [],
  );

  useEffect(() => {
    return () => {
      mats.forEach((m) => m.dispose());
      hitMat.dispose();
    };
  }, [mats, hitMat]);

  useEffect(() => {
    const el = gl.domElement;

    const begin = (axis: AxisId, id: string, clientX: number, clientY: number) => {
      const g = group.current;
      if (!g) return;
      const p = livePos(id);
      g.position.set(p.x, p.y, p.z);
      _origin.set(p.x, p.y, p.z);
      _axis.set(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
      const box = el.getBoundingClientRect();
      const { ax, ay } = axisPixels(camera, _origin, _axis, box.width, box.height);
      drag.current = {
        axis,
        id,
        origin: _origin.clone(),
        startX: clientX,
        startY: clientY,
        applied: 0,
        ax,
        ay,
      };
      useBay.getState().setDragging(true);
      useBay.getState().setMoveAxis(axis);
      note("gizmo-start", { id, axis });
    };

    const move = (clientX: number, clientY: number) => {
      const job = drag.current;
      const g = group.current;
      if (!job || !g) return;
      _axis.set(job.axis === "x" ? 1 : 0, job.axis === "y" ? 1 : 0, job.axis === "z" ? 1 : 0);
      const total = metersAlong(clientX - job.startX, clientY - job.startY, job.ax, job.ay);
      const dist = Math.max(0.4, camera.position.distanceTo(job.origin));
      const fov = "fov" in camera ? Number(camera.fov) : 42;
      const view = dist * Math.tan((fov * Math.PI) / 360);
      const cap = view * 1.15;
      const clamped = Math.max(-cap, Math.min(cap, total));
      let step = clamped - job.applied;
      const maxStep = Math.max(0.008, view * 0.12);
      if (step > maxStep) step = maxStep;
      if (step < -maxStep) step = -maxStep;
      if (Math.abs(step) < 1e-4) return;
      translateAssembly(job.id, _axis.x * step, _axis.y * step, _axis.z * step);
      job.applied += step;
      g.position.copy(job.origin).addScaledVector(_axis, job.applied);
    };

    const end = () => {
      const job = drag.current;
      if (!job) return;
      drag.current = null;
      useBay.getState().setDragging(false);
      useBay.getState().setMoveAxis(null);
      commitRoot(job.id);
      note("gizmo-end", { id: job.id, m: job.applied });
      el.style.cursor = "";
      return job;
    };

    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      end();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    window.__bayGizmo = {
      live: (id) => livePos(id ?? useBay.getState().selected ?? ""),
      drag: (axis, pixels = 40, camDist) => {
        const id = useBay.getState().selected;
        if (!id || useBay.getState().playing) return { ok: false, reason: "no-gizmo" };
        const axId: AxisId = axis === "y" || axis === "z" ? axis : "x";
        const p = livePos(id);
        _origin.set(p.x, p.y, p.z);
        _axis.set(axId === "x" ? 1 : 0, axId === "y" ? 1 : 0, axId === "z" ? 1 : 0);
        const saved = camera.position.clone();
        const want = Number(camDist);
        if (Number.isFinite(want) && want > 0.5) {
          const dir = saved.clone().sub(_origin);
          if (dir.lengthSq() < 1e-8) dir.set(0.5, 0.35, 1);
          dir.normalize();
          camera.position.copy(_origin).addScaledVector(dir, want);
          camera.updateMatrixWorld();
        }
        const box = el.getBoundingClientRect();
        const { ax, ay } = axisPixels(camera, _origin, _axis, box.width, box.height);
        const pxPer = Math.hypot(ax, ay);
        const start = clientOf(camera, _origin, box);
        begin(axId, id, start.x, start.y);
        const len = pxPer || 1;
        const nx = ax / len;
        const ny = ay / len;
        const steps = 8;
        const px = Number(pixels);
        for (let i = 1; i <= steps; i++) {
          const u = (px * i) / steps;
          move(start.x + nx * u, start.y + ny * u);
        }
        const job = end();
        const dist = camera.position.distanceTo(_origin);
        camera.position.copy(saved);
        camera.updateMatrixWorld();
        return {
          ok: true,
          axis: axId,
          pixels: px,
          meters: job?.applied ?? 0,
          camDist: dist,
          pxPerMeter: pxPer,
          origin: { x: p.x, y: p.y, z: p.z },
        };
      },
    };

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (window.__bayGizmo) delete window.__bayGizmo;
    };
  }, [camera, gl, selected, playing]);

  useFrame(() => {
    const g = group.current;
    if (!g || !selected || !show) return;
    if (!drag.current) {
      const p = livePos(selected);
      g.position.set(p.x, p.y, p.z);
    }
    const d = camera.position.distanceTo(g.position);
    const fov = "fov" in camera ? Number(camera.fov) : 42;
    const s = Math.max(0.35, Math.min(5.5, d * Math.tan((fov * Math.PI) / 360) * 0.28));
    g.scale.setScalar(s);
  });

  if (!show || !selected) return null;

  const start = (axis: AxisId) => (ev: { stopPropagation: () => void; nativeEvent?: PointerEvent; clientX?: number; clientY?: number }) => {
    ev.stopPropagation();
    const native = ev.nativeEvent;
    native?.preventDefault?.();
    if (!selected) return;
    const cx = native && "clientX" in native ? native.clientX : (ev.clientX ?? 0);
    const cy = native && "clientY" in native ? native.clientY : (ev.clientY ?? 0);
    const p = livePos(selected);
    group.current?.position.set(p.x, p.y, p.z);
    const box = gl.domElement.getBoundingClientRect();
    const beginX = Number.isFinite(cx) && cx !== 0 ? cx : clientOf(camera, _origin.set(p.x, p.y, p.z), box).x;
    const beginY = Number.isFinite(cy) && cy !== 0 ? cy : clientOf(camera, _origin.set(p.x, p.y, p.z), box).y;
    const jobAxis = axis;
    const id = selected;
    const g = group.current;
    if (!g) return;
    _origin.set(p.x, p.y, p.z);
    _axis.set(jobAxis === "x" ? 1 : 0, jobAxis === "y" ? 1 : 0, jobAxis === "z" ? 1 : 0);
    const { ax, ay } = axisPixels(camera, _origin, _axis, box.width, box.height);
    drag.current = {
      axis: jobAxis,
      id,
      origin: _origin.clone(),
      startX: beginX,
      startY: beginY,
      applied: 0,
      ax,
      ay,
    };
    useBay.getState().setDragging(true);
    useBay.getState().setMoveAxis(jobAxis);
    note("gizmo-start", { id, axis: jobAxis });
  };

  return (
    <group ref={group} renderOrder={30}>
      {AXES.map((a, i) => (
        <group key={a.id} rotation={a.id === "x" ? [0, 0, -Math.PI / 2] : a.id === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0]}>
          <mesh position={[0, 0.7, 0]} renderOrder={31} onPointerDown={start(a.id)}>
            <cylinderGeometry args={[0.035, 0.035, 1.35, 8]} />
            <primitive object={mats[i]!} attach="material" />
          </mesh>
          <mesh position={[0, 1.48, 0]} renderOrder={31} onPointerDown={start(a.id)}>
            <coneGeometry args={[0.1, 0.28, 10]} />
            <primitive object={mats[i]!} attach="material" />
          </mesh>
          <mesh
            position={[0, 0.85, 0]}
            renderOrder={32}
            onPointerDown={start(a.id)}
            onPointerOver={() => {
              gl.domElement.style.cursor = "grab";
            }}
            onPointerOut={() => {
              if (!drag.current) gl.domElement.style.cursor = "";
            }}
          >
            <cylinderGeometry args={[0.12, 0.12, 1.7, 8]} />
            <primitive object={hitMat} attach="material" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
