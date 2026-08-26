import { listSamplers } from "@/lib/bay/probe";
import type { Entity, Kind } from "@/store/bay-store";

/** Named arrangement of parts. Reset restages this, not a generic empty floor. */
export type LevelActor = {
  kind: Kind;
  pos: [number, number, number];
};

export type LevelTrack = { kind: Kind; part?: string };

export type Level = {
  id: string;
  name: string;
  blurb: string;
  select?: Kind;
  track?: LevelTrack;
  entities: LevelActor[];
  builtin?: boolean;
};

export const DEFAULT_LEVEL_ID = "pin-pull";

const KEY = "contain.clips.v1";

function actor(kind: Kind, x: number, y: number, z: number): LevelActor {
  return { kind, pos: [x, y, z] };
}

/** Built-in gags. Same kit: dummy, crate, grenade, can, grass, solids. */
export const BUILTIN_LEVELS: Level[] = [
  {
    id: "pin-pull",
    name: "Pin-pull",
    blurb: "Grenade on the crate. Dummy in front. Pull the pin.",
    select: "grenade",
    track: { kind: "dummy", part: "hips" },
    entities: [
      actor("crate", 0, 0, 0),
      actor("grenade", 0, 0.64, 0),
      actor("dummy", 0, 0, 1.22),
      actor("grass", 0, 0, 0.9),
    ],
    builtin: true,
  },
  {
    id: "shoes",
    name: "Shoes",
    blurb: "Grenade at the dummy's feet. No crate in the way.",
    select: "grenade",
    track: { kind: "dummy", part: "hips" },
    entities: [
      actor("dummy", 0, 0, 0),
      actor("grenade", 0, 0.09, 0.22),
      actor("grass", 0, 0, 0.05),
    ],
    builtin: true,
  },
  {
    id: "roost",
    name: "Roost",
    blurb: "Dummy on the crate. Blast yanks the box out from under it.",
    select: "grenade",
    track: { kind: "dummy", part: "hips" },
    entities: [
      actor("crate", 0, 0, 0),
      actor("dummy", 0, 0.58, 0),
      actor("grenade", 0.48, 0.09, 0),
      actor("grass", 0, 0, 1.05),
    ],
    builtin: true,
  },
  {
    id: "can-pop",
    name: "Can pop",
    blurb: "Grenade on the ammo can. Dummy watches the lid.",
    select: "grenade",
    track: { kind: "dummy", part: "hips" },
    entities: [
      actor("can", 0, 0, 0),
      actor("grenade", 0, 0.62, 0),
      actor("dummy", 0, 0, 1.35),
      actor("grass", 0, 0, 1.0),
    ],
    builtin: true,
  },
  {
    id: "twins",
    name: "Twins",
    blurb: "Two dummies, one crate, one bang.",
    select: "grenade",
    track: { kind: "dummy", part: "hips" },
    entities: [
      actor("crate", 0, 0, 0),
      actor("grenade", 0, 0.64, 0),
      actor("dummy", 0, 0, 1.22),
      actor("dummy", 0, 0, -1.22),
      actor("grass", 0, 0, 0),
    ],
    builtin: true,
  },
  {
    id: "jenga",
    name: "Jenga",
    blurb: "Cube stack, dummy beside, bang at the base.",
    select: "grenade",
    track: { kind: "dummy", part: "hips" },
    entities: [
      actor("cube", 0, 0.16, 0),
      actor("cube", 0, 0.48, 0),
      actor("cube", 0, 0.8, 0),
      actor("cube", 0, 1.12, 0),
      actor("grenade", 0.4, 0.09, 0),
      actor("dummy", 0, 0, 1.4),
      actor("grass", 0, 0, 1.1),
    ],
    builtin: true,
  },
  {
    id: "pins",
    name: "Pins",
    blurb: "Line of balls, dummy as the last pin, grenade as the ball.",
    select: "grenade",
    track: { kind: "dummy", part: "hips" },
    entities: [
      actor("grenade", 0, 0.09, -0.35),
      actor("ball", 0, 0.16, 0.15),
      actor("ball", 0, 0.16, 0.5),
      actor("ball", 0, 0.16, 0.85),
      actor("dummy", 0, 0, 1.45),
      actor("grass", 0, 0, 1.15),
    ],
    builtin: true,
  },
];

const KINDS = new Set<string>([
  "pack",
  "charge",
  "grenade",
  "can",
  "crate",
  "dummy",
  "grass",
  "cube",
  "ball",
  "cylinder",
  "capsule",
  "tetra",
  "octa",
  "dodeca",
  "ico",
  "plank",
]);

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

function slug(name: string) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return s || "clip";
}

function readCustom(): Level[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerceLevel).filter((l): l is Level => l != null);
  } catch {
    return [];
  }
}

function writeCustom(list: Level[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list.map(stripBuiltin)));
}

function stripBuiltin(level: Level): Level {
  const { builtin: _b, ...rest } = level;
  return rest;
}

function coerceLevel(raw: unknown): Level | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  if (!Array.isArray(o.entities) || o.entities.length === 0) return null;
  const entities: LevelActor[] = [];
  for (const a of o.entities) {
    if (!a || typeof a !== "object") continue;
    const e = a as Record<string, unknown>;
    if (typeof e.kind !== "string" || !KINDS.has(e.kind)) continue;
    const pos = e.pos;
    if (!Array.isArray(pos) || pos.length < 3) continue;
    const x = Number(pos[0]);
    const y = Number(pos[1]);
    const z = Number(pos[2]);
    if (![x, y, z].every(Number.isFinite)) continue;
    const kind = (e.kind === "charge" ? "grenade" : e.kind) as Kind;
    entities.push({ kind, pos: [round(x), round(y), round(z)] });
  }
  if (entities.length === 0) return null;
  const select = typeof o.select === "string" && KINDS.has(o.select) ? (o.select as Kind) : undefined;
  let track: LevelTrack | undefined;
  if (o.track && typeof o.track === "object") {
    const t = o.track as Record<string, unknown>;
    if (typeof t.kind === "string" && KINDS.has(t.kind)) {
      track = { kind: t.kind as Kind, part: typeof t.part === "string" ? t.part : undefined };
    }
  }
  return {
    id: o.id,
    name: o.name.slice(0, 40),
    blurb: typeof o.blurb === "string" ? o.blurb.slice(0, 120) : "Saved clip.",
    select,
    track,
    entities,
    builtin: false,
  };
}

export function listLevels(): Level[] {
  const custom = readCustom();
  const seen = new Set(BUILTIN_LEVELS.map((l) => l.id));
  return [...BUILTIN_LEVELS, ...custom.filter((l) => !seen.has(l.id))];
}

export function getLevel(id: string | null | undefined): Level | null {
  if (!id) return null;
  return listLevels().find((l) => l.id === id) ?? null;
}

export function materialize(level: Level, nextId: () => string): {
  entities: Entity[];
  selected: string | null;
  trackId: string | null;
  latch: "sealed";
  tool: "grab";
} {
  const entities: Entity[] = level.entities.map((a) => ({
    id: nextId(),
    kind: a.kind === "charge" ? "grenade" : a.kind,
    pos: [a.pos[0], a.pos[1], a.pos[2]] as [number, number, number],
  }));
  const selectKind = level.select ?? (entities.some((e) => e.kind === "grenade") ? "grenade" : entities[0]?.kind);
  const selected = entities.find((e) => e.kind === selectKind)?.id ?? entities[0]?.id ?? null;
  let trackId: string | null = selected;
  if (level.track) {
    const e = entities.find((x) => x.kind === level.track!.kind);
    if (e) trackId = level.track.part ? `${e.id}-${level.track.part}` : e.id;
  } else {
    const dummy = entities.find((e) => e.kind === "dummy");
    if (dummy) trackId = `${dummy.id}-hips`;
  }
  return { entities, selected, trackId, latch: "sealed", tool: "grab" };
}

function sampleOf(id: string) {
  return listSamplers().get(id)?.sample();
}

/** Live pose → restageable actor. Dummy/crate flatten back to a floor spawn. */
export function captureActors(entities: Entity[]): LevelActor[] {
  const out: LevelActor[] = [];
  for (const e of entities) {
    const kind = e.kind === "charge" ? "grenade" : e.kind;
    let pos: [number, number, number] = [e.pos[0], e.pos[1], e.pos[2]];
    if (kind === "dummy") {
      const hips = sampleOf(`${e.id}-hips`);
      if (hips) pos = [round(hips.x), round(Math.max(0, hips.y - 0.74)), round(hips.z)];
    } else if (kind === "crate") {
      const floor = sampleOf(`${e.id}-floor`);
      if (floor) pos = [round(floor.x), round(Math.max(0, floor.y - 0.018)), round(floor.z)];
    } else if (kind === "grass") {
      pos = [round(e.pos[0]), 0, round(e.pos[2])];
    } else {
      const p = sampleOf(e.id);
      if (p) pos = [round(p.x), round(p.y), round(p.z)];
    }
    out.push({ kind, pos });
  }
  return out;
}

export function trackFrom(entities: Entity[], trackId: string | null): LevelTrack | undefined {
  if (!trackId) return undefined;
  for (const e of entities) {
    if (trackId === e.id) return { kind: e.kind };
    if (!trackId.startsWith(`${e.id}-`)) continue;
    const part = trackId.slice(e.id.length + 1);
    return { kind: e.kind, part: part || undefined };
  }
  return undefined;
}

export function persistCustom(input: {
  name: string;
  blurb?: string;
  entities: LevelActor[];
  select?: Kind;
  track?: LevelTrack;
  replaceId?: string;
}): Level {
  const list = readCustom();
  const name = input.name.trim().slice(0, 40) || "Clip";
  const replace =
    (input.replaceId && list.find((l) => l.id === input.replaceId && !l.builtin)) ||
    list.find((l) => l.name.toLowerCase() === name.toLowerCase());
  const id = replace?.id ?? `u-${slug(name)}-${Date.now().toString(36).slice(-4)}`;
  const level: Level = {
    id,
    name,
    blurb: (input.blurb ?? "Saved clip.").slice(0, 120),
    select: input.select,
    track: input.track,
    entities: input.entities,
    builtin: false,
  };
  const next = replace ? list.map((l) => (l.id === id ? level : l)) : [...list, level];
  writeCustom(next);
  return level;
}

export function forgetCustom(id: string) {
  const level = getLevel(id);
  if (!level || level.builtin) return { ok: false as const, reason: "builtin" as const, id };
  writeCustom(readCustom().filter((l) => l.id !== id));
  return { ok: true as const, id };
}

export function levelCard(level: Level) {
  return { id: level.id, name: level.name, blurb: level.blurb, builtin: Boolean(level.builtin), n: level.entities.length };
}
