import { create } from "zustand";
import {
  captureActors,
  DEFAULT_LEVEL_ID,
  getLevel,
  materialize,
  persistCustom,
  trackFrom,
  type Level,
} from "@/lib/bay/level";
import { SOLID_SHAPES, type SolidShape } from "@/lib/bay/solids";

export type Tool = "grab" | "nail";
export type Kind = "pack" | "charge" | "grenade" | "can" | "crate" | "dummy" | "grass" | SolidShape;

export interface Entity {
  id: string;
  kind: Kind;
  pos: [number, number, number];
}

export function isSolid(kind: Kind): kind is SolidShape {
  return (SOLID_SHAPES as readonly string[]).includes(kind);
}

interface BayState {
  entities: Entity[];
  selected: string | null;
  trackId: string | null;
  tool: Tool;
  muted: boolean;
  dragging: boolean;
  latch: "sealed" | "hinged" | "free";
  cutaway: boolean;
  levelId: string;
  spawn: (kind: Kind) => void;
  clear: () => void;
  reset: () => void;
  loadLevel: (id: string) => { ok: boolean; id: string; n: number; name: string };
  saveLevel: (name?: string) => { ok: boolean; id: string; name: string; n: number };
  select: (id: string | null) => void;
  setTrack: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  toggleMuted: () => void;
  setDragging: (v: boolean) => void;
  setLatch: (latch: BayState["latch"]) => void;
  toggleCutaway: () => void;
}

let n = 1;
function nid() {
  n += 1;
  return `e${n}`;
}

function stageFrom(id: string) {
  const level = getLevel(id) ?? getLevel(DEFAULT_LEVEL_ID)!;
  return { ...materialize(level, nid), levelId: level.id };
}

const start = (): Pick<BayState, "entities" | "selected" | "trackId" | "latch" | "tool" | "levelId"> =>
  stageFrom(DEFAULT_LEVEL_ID);

export const useBay = create<BayState>((set, get) => ({
  ...start(),
  muted: false,
  dragging: false,
  cutaway: false,
  spawn: (kind) => {
    if (kind === "charge") kind = "grenade";
    const r = () => (Math.random() - 0.5) * 1.4;
    const pos: [number, number, number] =
      kind === "can" || kind === "crate" || kind === "grass" || kind === "dummy"
        ? [r(), 0, r()]
        : kind === "pack" || kind === "grenade"
          ? [r() * 0.6, 1.15, r() * 0.6]
          : [0.95 + r() * 0.4, 1.05, r() * 0.5];
    const e = { id: nid(), kind, pos };
    const trackId = kind === "dummy" ? `${e.id}-hips` : kind === "crate" ? `${e.id}-lid` : e.id;
    set({ entities: [...get().entities, e], selected: e.id, trackId });
  },
  clear: () => set({ entities: [], selected: null, trackId: null, latch: "sealed" }),
  reset: () => set({ ...stageFrom(get().levelId), dragging: false }),
  loadLevel: (id) => {
    const staged = stageFrom(id);
    set({ ...staged, dragging: false });
    const level = getLevel(staged.levelId)!;
    return { ok: true, id: staged.levelId, n: staged.entities.length, name: level.name };
  },
  saveLevel: (name) => {
    const s = get();
    const current = getLevel(s.levelId);
    const label = (name?.trim() || current?.name || "Clip").slice(0, 40);
    const replaceId = current && !current.builtin ? current.id : undefined;
    const saved: Level = persistCustom({
      name: label,
      blurb: current?.builtin ? `Copy of ${current.name}.` : (current?.blurb ?? "Saved clip."),
      entities: captureActors(s.entities),
      select: s.entities.find((e) => e.id === s.selected)?.kind,
      track: trackFrom(s.entities, s.trackId),
      replaceId,
    });
    set({ levelId: saved.id });
    return { ok: true, id: saved.id, name: saved.name, n: saved.entities.length };
  },
  select: (id) => set({ selected: id }),
  setTrack: (id) => set({ trackId: id }),
  setTool: (tool) => set({ tool }),
  toggleMuted: () => set({ muted: !get().muted }),
  setDragging: (dragging) => set({ dragging }),
  setLatch: (latch) => set({ latch }),
  toggleCutaway: () => set({ cutaway: !get().cutaway }),
}));
