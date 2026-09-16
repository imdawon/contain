import {
  actorMesh, assemblyMembers, listSamplers, log, probeTime, snapshot, type ProbeCamera,
} from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";
import * as THREE from "three";
import type { HistFrame, PoseSample } from "@/lib/bay/harness";
function round(n: number) { return Math.round(n * 1000) / 1000; }
type G = {
  __bayHist?: { frames: HistFrame[] };
  __bayWebglAlive?: boolean;
  __bayView?: { camera?: THREE.Camera; scene?: THREE.Scene };
};
const g = globalThis as unknown as G;
function glueNames() {
  const scene = useBay.getState().scene;
  const names = new Set<string>();
  for (const p of scene?.glue?.parts ?? []) names.add(p);
  for (const t of scene?.ties ?? []) { names.add(t.a); names.add(t.b); }
  return names;
}
function dummyParent(id: string, kind: string) {
  if (kind !== "dummy" && kind !== "dummy-bone") return null;
  const cut = id.indexOf("-");
  return cut > 0 ? id.slice(0, cut) : id;
}
function isGlued(id: string, kind: string) {
  const names = glueNames();
  if (names.has(id)) return true;
  const parent = dummyParent(id, kind);
  return Boolean(parent && names.has(parent));
}
function groundedOf(
  state: Record<string, string | number | boolean | null> | undefined,
  body: { numContacts?: (() => number) | number } | null | undefined,
): boolean | null {
  if (state && "grounded" in state) {
    const v = state.grounded;
    if (v == null) return null;
    return Number(v) > 0;
  }
  if (body && typeof body.numContacts === "function") {
    try { return body.numContacts() > 0; } catch { /* no contacts */ }
  } else if (body && typeof body.numContacts === "number") {
    return body.numContacts > 0;
  }
  return null;
}
function webglAlive(): boolean | null {
  if (typeof g.__bayWebglAlive === "boolean") return g.__bayWebglAlive;
  if (typeof document !== "undefined") return Boolean(document.querySelector("canvas"));
  return null;
}
export function census() {
  const store = useBay.getState();
  const s = snapshot();
  const entities = [];
  for (const [id, rec] of listSamplers()) {
    const p = rec.sample();
    if (p.state?.missing) continue;
    let vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
    const b = rec.getBody?.();
    if (b) {
      const lv = b.linvel(); vx = round(lv.x); vy = round(lv.y); vz = round(lv.z);
      const av = b.angvel(); wx = round(av.x); wy = round(av.y); wz = round(av.z);
    }
    entities.push({
      id, kind: rec.kind, x: round(p.x), y: round(p.y), z: round(p.z),
      speed: round(Math.hypot(vx, vy, vz)), omega: round(Math.hypot(wx, wy, wz)),
      glued: isGlued(id, rec.kind),
      grounded: groundedOf(p.state, b as { numContacts?: (() => number) | number } | null),
    });
  }
  const cam = s.camera;
  return {
    entities,
    camera: {
      x: cam?.x ?? 0, y: cam?.y ?? 0, z: cam?.z ?? 0,
      lookX: cam?.lookX ?? 0, lookY: cam?.lookY ?? 0, lookZ: cam?.lookZ ?? 0,
      fov: cam?.fov ?? 0, trackId: store.trackId,
    },
    renderer: { paints: null, takers: null, nobj: entities.length, webglAlive: webglAlive() },
    sim: { playing: store.playing, scene: store.scene?.id ?? store.levelId ?? null },
  };
}
function pickReportId(id?: string): string | null {
  if (id && id.length) return id;
  const store = useBay.getState();
  if (store.trackId) return store.trackId;
  const actors = listSamplers();
  for (const key of ["dummy-hips", "dummy", "wagon", "drum"] as const) if (actors.has(key)) return key;
  for (const [sid, rec] of actors) {
    if (sid.endsWith("-hips") || rec.kind === "dummy" || rec.kind === "wagon" || rec.kind === "drum") return sid;
  }
  return actors.keys().next().value ?? null;
}
function skipRayHit(obj: THREE.Object3D) {
  const data = obj.userData as { labSkip?: boolean; labOutline?: boolean; helper?: boolean };
  if (data?.labSkip || data?.labOutline || data?.helper) return true;
  if (obj.type.includes("Helper")) return true;
  const n = obj.name.toLowerCase();
  return n.includes("grid") || n.includes("helper");
}
function collectOwnMeshes(id: string) {
  const own = new Set<THREE.Object3D>();
  for (const mid of assemblyMembers(id)) {
    const mesh = actorMesh(mid);
    if (!mesh) continue;
    mesh.traverse((o) => own.add(o));
    own.add(mesh);
  }
  return own;
}
function actorLookup() {
  const byMesh = new Map<THREE.Object3D, { id: string; kind: string }>();
  const byName = new Map<string, { id: string; kind: string }>();
  for (const [id, rec] of listSamplers()) {
    const tag = { id, kind: rec.kind };
    byName.set(id, tag);
    const mesh = rec.getMesh?.();
    if (!mesh) continue;
    mesh.traverse((o) => byMesh.set(o, tag));
    byMesh.set(mesh, tag);
  }
  return { byMesh, byName };
}
function mapHit(
  obj: THREE.Object3D,
  byMesh: Map<THREE.Object3D, { id: string; kind: string }>,
  byName: Map<string, { id: string; kind: string }>,
) {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const data = cur.userData as { bayId?: string; bayKind?: string };
    if (typeof data?.bayId === "string" && data.bayId) {
      const known = byName.get(data.bayId);
      return { id: data.bayId, kind: data.bayKind ?? known?.kind ?? "mesh" };
    }
    const named = byName.get(cur.name);
    if (named) return named;
    const hit = byMesh.get(cur);
    if (hit) return hit;
    cur = cur.parent;
  }
  return { id: obj.name || "mesh", kind: "mesh" };
}
function targetPos(id: string) {
  const acc = new THREE.Vector3();
  let n = 0;
  for (const mid of assemblyMembers(id)) {
    const p = listSamplers().get(mid)?.sample();
    if (!p || p.state?.missing) continue;
    acc.x += p.x; acc.y += p.y; acc.z += p.z; n += 1;
  }
  if (n > 0) return acc.multiplyScalar(1 / n);
  const p = listSamplers().get(id)?.sample();
  return p ? new THREE.Vector3(p.x, p.y, p.z) : new THREE.Vector3();
}
function ndcFill(camera: THREE.Camera, box: THREE.Box3) {
  const pts = [
    [box.min.x, box.min.y, box.min.z], [box.min.x, box.min.y, box.max.z],
    [box.min.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z],
    [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, inView = false;
  const c = new THREE.Vector3();
  for (const [x, y, z] of pts) {
    c.set(x, y, z).project(camera);
    if (c.z > 0 && c.z < 1 && Math.abs(c.x) < 1 && Math.abs(c.y) < 1) inView = true;
    minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y);
  }
  const w = Math.max(0, Math.max(-1, Math.min(1, maxX)) - Math.max(-1, Math.min(1, minX)));
  const h = Math.max(0, Math.max(-1, Math.min(1, maxY)) - Math.max(-1, Math.min(1, minY)));
  return { fill: Math.max(0, Math.min(1, (w / 2) * (h / 2))), inView };
}
function fillFromDistance(distanceM: number, fov: number) {
  const f = fov > 0 ? fov : 50;
  const viewH = 2 * Math.max(0.01, distanceM) * Math.tan((f * Math.PI) / 360);
  const d = 0.6 / Math.max(viewH, 1e-3);
  return Math.max(0, Math.min(1, d * d));
}
function estimateCamera() {
  const snap = snapshot().camera;
  const cam = new THREE.PerspectiveCamera(snap?.fov || 50, 1, 0.1, 5000);
  if (snap) {
    cam.position.set(snap.x, snap.y, snap.z);
    cam.lookAt(snap.lookX, snap.lookY, snap.lookZ);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
  return cam;
}
export function report(id?: string) {
  const targetId = pickReportId(id);
  const rec = targetId ? listSamplers().get(targetId) : undefined;
  const kind = rec?.kind ?? "unknown";
  const pos = targetId ? targetPos(targetId) : new THREE.Vector3();
  const view = g.__bayView;
  const liveCam = view?.camera;
  const liveScene = view?.scene;
  const cam: THREE.Camera = liveCam ?? estimateCamera();
  const snapCam: ProbeCamera | null = snapshot().camera;
  const camPos = liveCam ? liveCam.position : new THREE.Vector3(snapCam?.x ?? 0, snapCam?.y ?? 0, snapCam?.z ?? 0);
  const distanceM = round(camPos.distanceTo(pos));
  const box = new THREE.Box3();
  box.makeEmpty();
  let hasMesh = false;
  if (targetId) {
    for (const mid of assemblyMembers(targetId)) {
      const mesh = actorMesh(mid);
      if (!mesh) continue;
      box.expandByObject(mesh);
      hasMesh = true;
    }
  }
  if (!hasMesh || box.isEmpty()) box.setFromCenterAndSize(pos, new THREE.Vector3(1.2, 1.2, 1.2));
  const ndc = ndcFill(cam, box);
  let screenFill = ndc.fill;
  if (!hasMesh && !liveCam) screenFill = fillFromDistance(distanceM, snapCam?.fov ?? 50);
  const inView = ndc.inView || Boolean(targetId && snapshot().inView?.includes(targetId));
  let occluded = false;
  let occluder: { id: string; kind: string } | null = null;
  if (liveCam && liveScene && targetId) {
    const dir = pos.clone().sub(camPos);
    const dist = dir.length();
    if (dist > 1e-4) {
      dir.multiplyScalar(1 / dist);
      const ray = new THREE.Raycaster(camPos.clone(), dir, 0.02, dist - 0.02);
      const hits = ray.intersectObjects(liveScene.children, true);
      const own = collectOwnMeshes(targetId);
      const { byMesh, byName } = actorLookup();
      for (const hit of hits) {
        let skip = skipRayHit(hit.object);
        let cur: THREE.Object3D | null = hit.object;
        while (!skip && cur) { if (own.has(cur) || skipRayHit(cur)) skip = true; cur = cur.parent; }
        if (skip) continue;
        occluded = true;
        occluder = mapHit(hit.object, byMesh, byName);
        break;
      }
    }
  }
  return {
    id: targetId ?? "", kind, inView,
    screenFill: round(Math.max(0, Math.min(1, screenFill))),
    occluded, occluder, distanceM,
    warn: screenFill < 0.1, weak: screenFill < 0.05,
  };
}
export function motion(seconds = 30) {
  const cut = probeTime() - seconds;
  const frames = (g.__bayHist?.frames ?? []).filter((f) => f.t >= cut);
  const ids = new Set<string>();
  for (const f of frames) for (const id of Object.keys(f.o)) ids.add(id);
  const logHits = log().filter((e) => e.type === "contact" && e.t >= cut);
  const bodies = [...ids].map((id) => {
    const path = frames.filter((f) => f.o[id]).map((f) => ({ t: f.t, ...f.o[id]! }));
    const first = path[0];
    const last = path[path.length - 1];
    let maxSpeed = 0, maxOmega = 0, airN = 0, groundN = 0;
    for (const p of path) {
      const s = Math.hypot(p.vx ?? 0, p.vy ?? 0, p.vz ?? 0);
      if (s > maxSpeed) maxSpeed = s;
      const om = p.omega != null ? p.omega : Math.hypot(p.wx ?? 0, p.wy ?? 0, p.wz ?? 0);
      if (om > maxOmega) maxOmega = om;
      if (p.grounded !== undefined && p.grounded != null) {
        groundN += 1;
        if (!p.grounded) airN += 1;
      }
    }
    let contacts = 0;
    for (const f of frames) for (const e of f.ev) if (e.type === "contact" && e.id === id) contacts += 1;
    for (const e of logHits) if (e.data.id === id || JSON.stringify(e.data).includes(id)) contacts += 1;
    return {
      id, samples: path.length,
      delta: first && last
        ? { x: round(last.x - first.x), y: round(last.y - first.y), z: round(last.z - first.z) }
        : { x: 0, y: 0, z: 0 },
      maxSpeed: round(maxSpeed), maxOmega: round(maxOmega),
      airborneFraction: groundN > 0 ? round(airN / groundN) : null, contacts,
    };
  });
  return { seconds, bodies };
}
