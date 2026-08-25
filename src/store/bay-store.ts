import { create } from "zustand";
import { SOLID_SHAPES, type SolidShape } from "@/lib/bay/solids";

export type Tool = "grab" | "nail";
export type Kind = "pack" | "can" | SolidShape;

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
  spawn: (kind: Kind) => void;
  clear: () => void;
  reset: () => void;
  select: (id: string | null) => void;
  setTrack: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  toggleMuted: () => void;
  setDragging: (v: boolean) => void;
  setLatch: (latch: BayState["latch"]) => void;
}

let n = 1;
function nid() {
  n += 1;
  return `e${n}`;
}

const start = (): Pick<BayState, "entities" | "selected" | "trackId" | "latch" | "tool"> => ({
  entities: [
    { id: "can0", kind: "can", pos: [0, 0, 0] },
    { id: "pack0", kind: "pack", pos: [0, 0.2, 0] },
  ],
  selected: "pack0",
  trackId: "can0",
  latch: "sealed",
  tool: "grab",
});

export const useBay = create<BayState>((set, get) => ({
  ...start(),
  muted: false,
  dragging: false,
  spawn: (kind) => {
    const pos: [number, number, number] =
      kind === "can"
        ? [(Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6]
        : kind === "pack"
          ? [(Math.random() - 0.5) * 0.8, 1.25, (Math.random() - 0.5) * 0.8]
          : [0.95 + (Math.random() - 0.5) * 0.5, 1.05, (Math.random() - 0.5) * 0.8];
    const e = { id: nid(), kind, pos };
    set({ entities: [...get().entities, e], selected: e.id, trackId: e.id });
  },
  clear: () => set({ entities: [], selected: null, trackId: null, latch: "sealed" }),
  reset: () => {
    const canId = nid();
    const packId = nid();
    set({
      entities: [
        { id: canId, kind: "can", pos: [0, 0, 0] },
        { id: packId, kind: "pack", pos: [0, 0.2, 0] },
      ],
      selected: packId,
      trackId: canId,
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
}));
