import { create } from "zustand";
import { SOLID_SHAPES, type SolidShape } from "@/lib/bay/solids";

export type Tool = "grab" | "nail";
export type Kind = "pack" | "charge" | "can" | "crate" | "dummy" | "grass" | SolidShape;

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

const start = (): Pick<BayState, "entities" | "selected" | "trackId" | "latch" | "tool"> => ({
  entities: [
    { id: "crate0", kind: "crate", pos: [0, 0, 0] },
    { id: "charge0", kind: "charge", pos: [0, 0.14, 0] },
    { id: "dummy0", kind: "dummy", pos: [0, 0, 1.22] },
    { id: "grass0", kind: "grass", pos: [0, 0, 0.9] },
  ],
  selected: "charge0",
  trackId: "dummy0-hips",
  latch: "sealed",
  tool: "grab",
});

export const useBay = create<BayState>((set, get) => ({
  ...start(),
  muted: false,
  dragging: false,
  cutaway: false,
  spawn: (kind) => {
    const r = () => (Math.random() - 0.5) * 1.4;
    const pos: [number, number, number] =
      kind === "can" || kind === "crate" || kind === "grass" || kind === "dummy"
        ? [r(), 0, r()]
        : kind === "pack" || kind === "charge"
          ? [r() * 0.6, 1.15, r() * 0.6]
          : [0.95 + r() * 0.4, 1.05, r() * 0.5];
    const e = { id: nid(), kind, pos };
    const trackId = kind === "dummy" ? `${e.id}-hips` : kind === "crate" ? `${e.id}-lid` : e.id;
    set({ entities: [...get().entities, e], selected: e.id, trackId });
  },
  clear: () => set({ entities: [], selected: null, trackId: null, latch: "sealed" }),
  reset: () => {
    const crateId = nid();
    const chargeId = nid();
    const dummyId = nid();
    const grassId = nid();
    set({
      entities: [
        { id: crateId, kind: "crate", pos: [0, 0, 0] },
        { id: chargeId, kind: "charge", pos: [0, 0.14, 0] },
        { id: dummyId, kind: "dummy", pos: [0, 0, 1.22] },
        { id: grassId, kind: "grass", pos: [0, 0, 0.9] },
      ],
      selected: chargeId,
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
