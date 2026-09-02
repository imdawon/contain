/**
 * Studio: capture the live bay as a JSON scene, persist in IndexedDB,
 * download as a file. Harness and the editor UI share this.
 */
import { listSamplers, note } from "@/lib/bay/probe";
import { coerceScene, type Scene, type SceneActor, type SceneCam, type SceneTie, type Vec3 } from "@/lib/bay/scene";
import { useBay, type Entity, type Kind } from "@/store/bay-store";

export const PALETTE: { kind: Kind; label: string }[] = [
  { kind: "dummy", label: "Dummy" },
  { kind: "wagon", label: "Wagon" },
  { kind: "grenade", label: "Grenade" },
  { kind: "pack", label: "Pack" },
  { kind: "hill", label: "Hill" },
  { kind: "ramp", label: "Ramp" },
  { kind: "cannon", label: "Cannon" },
  { kind: "wheel", label: "Wheel" },
  { kind: "drum", label: "Drum" },
  { kind: "crate", label: "Crate" },
  { kind: "can", label: "Can" },
  { kind: "grass", label: "Grass" },
  { kind: "wall", label: "Wall" },
  { kind: "doorway", label: "Door" },
  { kind: "cube", label: "Cube" },
  { kind: "ball", label: "Ball" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "capsule", label: "Capsule" },
  { kind: "tetra", label: "Tetra" },
  { kind: "octa", label: "Octa" },
  { kind: "dodeca", label: "Dodeca" },
  { kind: "ico", label: "Ico" },
  { kind: "plank", label: "Plank" },
];

export type ActorPatch = {
  pos?: Vec3;
  rot?: Vec3;
  vel?: Vec3;
  mass?: number;
  grip?: number;
  bounce?: number;
  fuse?: number;
  size?: Vec3;
  cut?: number;
  grade?: number;
  name?: string;
  live?: boolean;
  fixed?: boolean;
};

export type StudioRecord = {
  id: string;
  name: string;
  savedAt: number;
  scene: Scene;
};

const DB = "contain-studio";
const STORE = "scenes";
const DB_VER = 1;

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

function v3(a: number[]): Vec3 {
  return [round(a[0] ?? 0), round(a[1] ?? 0), round(a[2] ?? 0)];
}

function sampleOf(id: string) {
  return listSamplers().get(id)?.sample();
}

function livePos(e: Entity): Vec3 {
  if (e.kind === "dummy") {
    const hips = sampleOf(`${e.id}-hips`);
    if (hips) return v3([hips.x, Math.max(0, hips.y - 0.74), hips.z]);
  }
  const p = sampleOf(e.id);
  if (p) return v3([p.x, p.y, p.z]);
  return v3(e.pos);
}

function actorName(e: Entity, used: Set<string>) {
  const base = (e.name || e.kind).replace(/[^a-z0-9-]/gi, "").slice(0, 24) || e.kind;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  const n = `${base}-${i}`;
  used.add(n);
  return n;
}

export function captureScene(name?: string): Scene {
  const s = useBay.getState();
  const used = new Set<string>();
  const idToName = new Map<string, string>();
  const entities: SceneActor[] = s.entities.map((e) => {
    const nm = actorName(e, used);
    idToName.set(e.id, nm);
    const a: SceneActor = { name: nm, kind: e.kind === "charge" ? "grenade" : e.kind, pos: livePos(e) };
    if (e.rot) a.rot = v3(e.rot);
    if (e.vel) a.vel = v3(e.vel);
    if (e.grip != null) a.grip = e.grip;
    if (e.bounce != null) a.bounce = e.bounce;
    if (e.mass != null) a.mass = e.mass;
    if (e.live) a.live = true;
    if (e.fixed) a.fixed = true;
    if (e.size) a.size = v3(e.size);
    if (e.fuse != null) a.fuse = e.fuse;
    if (e.cut != null) a.cut = e.cut;
    if (e.grade != null) a.grade = e.grade;
    return a;
  });
  const resolve = (ref: string) => {
    if (idToName.has(ref)) return idToName.get(ref)!;
    const cut = ref.lastIndexOf("-");
    if (cut > 0) {
      const id = ref.slice(0, cut);
      const part = ref.slice(cut + 1);
      const nm = idToName.get(id);
      if (nm) return `${nm}-${part}`;
    }
    const ent = s.entities.find((e) => e.id === ref || e.name === ref || e.kind === ref);
    if (ent) return idToName.get(ent.id) ?? ent.name ?? ent.kind;
    return ref;
  };
  const ties: SceneTie[] = (s.scene?.ties ?? []).map((t) => ({ a: resolve(t.a), b: resolve(t.b) }));
  const label = (name?.trim() || s.scene?.name || "Studio").slice(0, 40);
  const id = (s.scene?.id && !s.scene.id.startsWith("studio-") ? `studio-${Date.now().toString(36)}` : s.scene?.id) || `studio-${Date.now().toString(36)}`;
  return {
    id,
    name: label,
    blurb: s.scene?.blurb ?? "Studio scene.",
    file: `scenes/${id}.json`,
    select: s.entities.find((e) => e.id === s.selected)?.name ?? s.scene?.select,
    track: s.scene?.track ?? (s.trackId?.includes("-chest") ? { ref: "dummy-chest" } : undefined),
    airborne: s.scene?.airborne,
    cam: s.scene?.cam,
    theme: s.scene?.theme,
    gravity: s.scene?.gravity,
    inspect: true,
    entities,
    ties,
  };
}

export function downloadScene(scene: Scene) {
  const blob = new Blob([JSON.stringify(scene, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${scene.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  note("studio-download", { id: scene.id, n: scene.entities.length });
  return { ok: true as const, id: scene.id, file: a.download, n: scene.entities.length };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveStudio(name?: string) {
  const scene = captureScene(name);
  const rec: StudioRecord = { id: scene.id, name: scene.name, savedAt: Date.now(), scene };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  note("studio-save", { id: rec.id, name: rec.name, n: scene.entities.length });
  return { ok: true as const, id: rec.id, name: rec.name, n: scene.entities.length, savedAt: rec.savedAt };
}

export async function listStudio() {
  const db = await openDb();
  const rows = await new Promise<StudioRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as StudioRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((r) => ({ id: r.id, name: r.name, savedAt: r.savedAt, n: r.scene.entities.length, ties: r.scene.ties.length }));
}

export async function loadStudio(id: string) {
  const db = await openDb();
  const rec = await new Promise<StudioRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as StudioRecord | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!rec) return { ok: false as const, reason: "missing" as const, id };
  const scene = coerceScene(rec.scene);
  if (!scene) return { ok: false as const, reason: "bad-scene" as const, id };
  const { restageScene } = await import("@/lib/bay/actions");
  note("studio-load", { id: scene.id, name: scene.name, n: scene.entities.length });
  return restageScene(scene);
}

export async function forgetStudio(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  note("studio-forget", { id });
  return { ok: true as const, id };
}

export function kindDefaults(kind: Kind): Partial<Entity> {
  if (kind === "ramp" || kind === "hill") return { size: [8, 8, 22], fixed: true, grip: 0.08 };
  if (kind === "wagon") return { pos: [0, 0.35, 0], rot: [0, 0, 0], vel: [0, 0, 4], grip: 0.06 };
  if (kind === "cannon") return { pos: [0, 0, -6], rot: [0.35, 0, 0], size: [1.4, 1.6, 3.2] };
  if (kind === "wheel") return { pos: [0, 1.05, 0], vel: [0, 0, 8], mass: 100_000 };
  if (kind === "drum") return { pos: [0, 0.64, 0], mass: 80 };
  if (kind === "grenade") return { pos: [0, 0.2, 0], fuse: 1.7 };
  if (kind === "dummy") return { pos: [0, 0, 0], live: false };
  return {};
}

export function placeActor(kind: string, x?: number, y?: number, z?: number) {
  const k = (kind === "charge" ? "grenade" : kind) as Kind;
  const bay = useBay.getState();
  const cam = (typeof window !== "undefined" && (window as unknown as { __bayCam?: { x: number; y: number; z: number } }).__bayCam) || null;
  const def = kindDefaults(k);
  const pos: Vec3 =
    x != null && y != null && z != null
      ? v3([x, y, z])
      : cam
        ? v3([cam.x, Math.max(0, y ?? def.pos?.[1] ?? 0), cam.z + 3.2])
        : v3(def.pos ?? [0, 0, 0]);
  bay.spawn(k);
  const id = useBay.getState().selected;
  if (!id) return { ok: false as const, reason: "no-id" as const };
  bay.patchEntity?.(id, { ...def, pos, name: k });
  bay.stampBlueprint?.(captureScene());
  note("place", { kind: k, id, x: pos[0], y: pos[1], z: pos[2] });
  return { ok: true as const, kind: k, id, pos };
}

export function patchActor(id: string, patch: ActorPatch & Record<string, unknown>) {
  const bay = useBay.getState();
  const hit = bay.entities.find((e) => e.id === id || e.name === id);
  if (!hit) return { ok: false as const, reason: "missing" as const, id };
  bay.patchEntity?.(hit.id, patch);
  if (!bay.playing) bay.stampBlueprint?.(captureScene());
  note("patch", { id: hit.id, ...Object.fromEntries(Object.keys(patch).map((k) => [k, 1])) });
  return { ok: true as const, id: hit.id };
}

export function removeActor(id: string) {
  const bay = useBay.getState();
  const hit = bay.entities.find((e) => e.id === id || e.name === id);
  if (!hit) return { ok: false as const, reason: "missing" as const, id };
  bay.removeEntity?.(hit.id);
  bay.stampBlueprint?.(captureScene());
  note("remove", { id: hit.id });
  return { ok: true as const, id: hit.id };
}

function refOf(raw: string) {
  const s = useBay.getState();
  const hit = s.entities.find((e) => e.id === raw || e.name === raw || `${e.name}` === raw || e.kind === raw);
  if (hit) return hit.name || hit.kind;
  if (raw.includes("-")) {
    const cut = raw.lastIndexOf("-");
    const left = raw.slice(0, cut);
    const part = raw.slice(cut + 1);
    const ent = s.entities.find((e) => e.id === left || e.name === left || e.kind === left);
    if (ent) return `${ent.name || ent.kind}-${part}`;
  }
  return raw;
}

export function tieActors(a: string, b: string) {
  const s = useBay.getState();
  const scene = s.scene;
  if (!scene) return { ok: false as const, reason: "no-scene" as const };
  const tie = { a: refOf(a), b: refOf(b) };
  const ties = [...scene.ties, tie];
  s.setSceneMeta?.({ ties });
  note("tie-edit", { a: tie.a, b: tie.b });
  return { ok: true as const, ...tie, n: ties.length };
}

export function untieActors(a?: string, b?: string) {
  const s = useBay.getState();
  const scene = s.scene;
  if (!scene) return { ok: false as const, reason: "no-scene" as const };
  const ties =
    !a && !b
      ? []
      : scene.ties.filter((t) => !(t.a === a && t.b === b) && !(t.a === b && t.b === a) && t.a !== a && t.b !== a);
  s.setSceneMeta?.({ ties });
  note("untie", { a: a ?? "", b: b ?? "", n: ties.length });
  return { ok: true as const, n: ties.length };
}

export function setCam(cam: SceneCam) {
  const s = useBay.getState();
  if (!s.scene) return { ok: false as const, reason: "no-scene" as const };
  s.setSceneMeta?.({ cam: { ...s.scene.cam, ...cam } });
  note("cam-edit", { fov: cam.fov ?? s.scene.cam?.fov ?? 0 });
  return { ok: true as const, cam: { ...s.scene.cam, ...cam } };
}

export function exportStudioScene(name?: string) {
  const scene = captureScene(name);
  return { ok: true as const, scene, json: JSON.stringify(scene, null, 2) };
}
