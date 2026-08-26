import { create } from "zustand";
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
  spawn: (kind: Kind) => void;
  clear: () => void;
  reset: () => void;
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

function stage() {
  const crateId = "crate0";
  const nadeId = "grenade0";
  const dummyId = "dummy0";
  const grassId = "grass0";
  return {
    entities: [
      { id: crateId, kind: "crate" as const, pos: [0, 0, 0] as [number, number, number] },
      { id: nadeId, kind: "grenade" as const, pos: [0, 0.64, 0] as [number, number, number] },
      { id: dummyId, kind: "dummy" as const, pos: [0, 0, 1.22] as [number, number, number] },
      { id: grassId, kind: "grass" as const, pos: [0, 0, 0.9] as [number, number, number] },
    ],
    selected: nadeId,
    trackId: `${dummyId}-hips`,
    latch: "sealed" as const,
    tool: "grab" as const,
  };
}

const start = (): Pick<BayState, "entities" | "selected" | "trackId" | "latch" | "tool"> => stage();

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
  reset: () => {
    const crateId = nid();
    const nadeId = nid();
    const dummyId = nid();
    const grassId = nid();
    set({
      entities: [
        { id: crateId, kind: "crate", pos: [0, 0, 0] },
        { id: nadeId, kind: "grenade", pos: [0, 0.64, 0] },
        { id: dummyId, kind: "dummy", pos: [0, 0, 1.22] },
        { id: grassId, kind: "grass", pos: [0, 0, 0.9] },
      ],
      selected: nadeId,
      trackId: `${dummyId}-hips`,
      latch: "sealed",
      tool: "grab",
      dragging: false,
    });
  },
  select: (id) => set({ selected: id }),
  setTrack: (id) => set({ trackId: id }),
  setTool: (tool) => set({ tool }),
  toggleMuted: () => set({ muted: !get().muted }),
  setDragging: (dragging) => set({ dragging }),
  setLatch: (latch) => set({ latch }),
  toggleCutaway: () => set({ cutaway: !get().cutaway }),
}));
