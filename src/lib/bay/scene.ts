import type { Entity, Kind } from "@/store/bay-store";

export type Vec3 = [number, number, number];

export type SceneActor = {
  name: string;
  kind: Kind;
  pos: Vec3;
  rot?: Vec3;
  vel?: Vec3;
  grip?: number;
  bounce?: number;
  mass?: number;
  live?: boolean;
  fixed?: boolean;
  size?: Vec3;
  fuse?: number;
  cut?: number;
  grade?: number;
};

export type SceneTie = {
  a: string;
  b: string;
};

export type SceneTrack = { kind?: Kind; part?: string; ref?: string };

export type SceneAirborne = { minY?: number; minZ?: number };

export type SceneCam = { offset?: Vec3; look?: Vec3; eye?: Vec3; fov?: number };

export type Scene = {
  id: string;
  name: string;
  blurb: string;
  file?: string;
  select?: string;
  track?: SceneTrack;
  airborne?: SceneAirborne;
  cam?: SceneCam;
  entities: SceneActor[];
  ties: SceneTie[];
};

export const SCENE_INDEX = [
  { id: "v1", file: "scenes/v1.json", name: "Wagon hill" },
  { id: "v1-miss", file: "scenes/v1-miss.json", name: "Wagon miss" },
  { id: "v1-tight", file: "scenes/v1-tight.json", name: "Wagon tight" },
  { id: "v1-peak", file: "scenes/v1-peak.json", name: "Wagon peak" },
  { id: "v1-two", file: "scenes/v1-two.json", name: "Wagon two" },
  { id: "wheel-100", file: "scenes/wheel-100.json", name: "Wheel 100 t" },
  { id: "wheel-200", file: "scenes/wheel-200.json", name: "Wheel 200 t" },
  { id: "wheel-300", file: "scenes/wheel-300.json", name: "Wheel 300 t" },
] as const;

const KINDS = new Set<string>([
  "pack",
  "charge",
  "grenade",
  "can",
  "crate",
  "dummy",
  "grass",
  "wall",
  "doorway",
  "cube",
  "ball",
  "cylinder",
  "capsule",
  "tetra",
  "octa",
  "dodeca",
  "ico",
  "plank",
  "wagon",
  "hill",
  "ramp",
  "wheel",
  "drum",
]);

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

function vec3(raw: unknown, fallback?: Vec3): Vec3 | undefined {
  if (!Array.isArray(raw) || raw.length < 3) return fallback;
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  const z = Number(raw[2]);
  if (![x, y, z].every(Number.isFinite)) return fallback;
  return [round(x), round(y), round(z)];
}

function num(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function coerceScene(raw: unknown): Scene | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  if (!Array.isArray(o.entities) || o.entities.length === 0) return null;
  const used = new Set<string>();
  const entities: SceneActor[] = [];
  for (const item of o.entities) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.kind !== "string" || !KINDS.has(e.kind)) continue;
    const pos = vec3(e.pos);
    if (!pos) continue;
    const kind = (e.kind === "charge" ? "grenade" : e.kind) as Kind;
    const name =
      typeof e.name === "string" && e.name.trim()
        ? e.name.trim().slice(0, 40)
        : `${kind}-${entities.length + 1}`;
    if (used.has(name)) continue;
    used.add(name);
    const actor: SceneActor = { name, kind, pos };
    const rot = vec3(e.rot);
    const vel = vec3(e.vel);
    const size = vec3(e.size);
    if (rot) actor.rot = rot;
    if (vel) actor.vel = vel;
    if (size) actor.size = size;
    const grip = num(e.grip);
    const bounce = num(e.bounce);
    const mass = num(e.mass);
    if (grip != null) actor.grip = grip;
    if (bounce != null) actor.bounce = bounce;
    if (mass != null) actor.mass = mass;
    if (e.live === true) actor.live = true;
    if (e.fixed === true) actor.fixed = true;
    const fuse = num(e.fuse);
    if (fuse != null && fuse > 0) actor.fuse = fuse;
    const cut = num(e.cut);
    const grade = num(e.grade);
    if (cut != null && cut > 0.2) actor.cut = cut;
    if (grade != null) actor.grade = grade;
    entities.push(actor);
  }
  if (entities.length === 0) return null;
  const ties: SceneTie[] = [];
  if (Array.isArray(o.ties)) {
    for (const item of o.ties) {
      if (!item || typeof item !== "object") continue;
      const t = item as Record<string, unknown>;
      if (typeof t.a !== "string" || typeof t.b !== "string") continue;
      ties.push({ a: t.a, b: t.b });
    }
  }
  let track: SceneTrack | undefined;
  if (o.track && typeof o.track === "object") {
    const t = o.track as Record<string, unknown>;
    track = {};
    if (typeof t.ref === "string") track.ref = t.ref;
    if (typeof t.kind === "string" && KINDS.has(t.kind)) track.kind = t.kind as Kind;
    if (typeof t.part === "string") track.part = t.part;
  }
  const select = typeof o.select === "string" ? o.select : undefined;
  let airborne: SceneAirborne | undefined;
  if (o.airborne && typeof o.airborne === "object") {
    const a = o.airborne as Record<string, unknown>;
    airborne = {};
    const minY = num(a.minY);
    const minZ = num(a.minZ);
    if (minY != null) airborne.minY = minY;
    if (minZ != null) airborne.minZ = minZ;
  }
  let cam: SceneCam | undefined;
  if (o.cam && typeof o.cam === "object") {
    const c = o.cam as Record<string, unknown>;
    const off = vec3(c.offset);
    const look = vec3(c.look);
    const eye = vec3(c.eye);
    const fov = num(c.fov);
    if (off || look || eye || (fov != null && fov > 10)) {
      cam = {
        ...(off ? { offset: off } : {}),
        ...(look ? { look } : {}),
        ...(eye ? { eye } : {}),
        ...(fov != null && fov > 10 ? { fov } : {}),
      };
    }
  }
  return {
    id: o.id.slice(0, 48),
    name: o.name.slice(0, 40),
    blurb: typeof o.blurb === "string" ? o.blurb.slice(0, 160) : "JSON scene.",
    file: typeof o.file === "string" ? o.file.slice(0, 80) : undefined,
    select,
    track,
    airborne,
    cam,
    entities,
    ties,
  };
}

export function sceneCard(scene: Scene) {
  return {
    id: scene.id,
    name: scene.name,
    blurb: scene.blurb,
    file: scene.file ?? `scenes/${scene.id}.json`,
    n: scene.entities.length,
    ties: scene.ties.length,
  };
}

export function materializeScene(scene: Scene, nextId: () => string): {
  entities: Entity[];
  selected: string | null;
  trackId: string | null;
  latch: "sealed";
  tool: "grab";
  scene: Scene;
  levelId: string;
  runId: null;
  trial: 0;
} {
  const byName = new Map<string, string>();
  const entities: Entity[] = scene.entities.map((a) => {
    const id = nextId();
    byName.set(a.name, id);
    const e: Entity = {
      id,
      name: a.name,
      kind: a.kind === "charge" ? "grenade" : a.kind,
      pos: [a.pos[0], a.pos[1], a.pos[2]],
    };
    if (a.rot) e.rot = a.rot;
    if (a.vel) e.vel = a.vel;
    if (a.grip != null) e.grip = a.grip;
    if (a.bounce != null) e.bounce = a.bounce;
    if (a.mass != null) e.mass = a.mass;
    if (a.live) e.live = true;
    if (a.fixed) e.fixed = true;
    if (a.size) e.size = a.size;
    if (a.fuse != null) e.fuse = a.fuse;
    if (a.cut != null) e.cut = a.cut;
    if (a.grade != null) e.grade = a.grade;
    return e;
  });
  const selectName = scene.select;
  const selected =
    (selectName ? byName.get(selectName) : undefined) ??
    entities.find((e) => e.kind === selectName)?.id ??
    entities.find((e) => e.kind === "grenade")?.id ??
    entities[0]?.id ??
    null;
  let trackId: string | null = selected;
  if (scene.track?.ref) {
    const ref = scene.track.ref;
    let hit = byName.get(ref) ?? entities.find((e) => e.kind === ref)?.id;
    let part = scene.track.part;
    if (!hit && ref.includes("-")) {
      const cut = ref.lastIndexOf("-");
      const name = ref.slice(0, cut);
      part = part ?? ref.slice(cut + 1);
      hit = byName.get(name) ?? entities.find((e) => e.kind === name)?.id;
    }
    trackId = hit ?? selected;
    if (hit && part) trackId = `${hit}-${part}`;
  } else if (scene.track?.kind) {
    const e = entities.find((x) => x.kind === scene.track!.kind);
    if (e) trackId = scene.track.part ? `${e.id}-${scene.track.part}` : e.id;
  } else {
    const dummy = entities.find((e) => e.kind === "dummy");
    if (dummy) trackId = `${dummy.id}-hips`;
  }
  return {
    entities,
    selected,
    trackId,
    latch: "sealed",
    tool: "grab",
    scene,
    levelId: scene.id,
    runId: null,
    trial: 0,
  };
}

function sceneUrl(idOrPath: string) {
  const s = idOrPath.trim();
  if (s.startsWith("/") || s.startsWith("scenes/") || s.endsWith(".json")) {
    return s.startsWith("/") ? s : `/${s.replace(/^\.\//, "")}`;
  }
  const hit = SCENE_INDEX.find((x) => x.id === s);
  return `/${hit?.file ?? `scenes/${s}.json`}`;
}

export async function resolveScene(input: unknown): Promise<Scene | null> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const direct = coerceScene(input);
    if (direct) return direct;
  }
  if (typeof input !== "string" || !input.trim()) return null;
  const id = input.trim();
  const urls = [sceneUrl(id)];
  if (!id.includes("/") && !id.endsWith(".json")) urls.push(`/scenes/${id}.json`);
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const scene = coerceScene(await r.json());
      if (!scene) continue;
      if (!scene.file) scene.file = url.replace(/^\//, "");
      return scene;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function listSceneCards() {
  return SCENE_INDEX.map((s) => ({ id: s.id, name: s.name, file: s.file, blurb: "JSON scene.", n: 0, ties: 0 }));
}
