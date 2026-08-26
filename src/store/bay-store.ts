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
import { DEFAULT_RUN_ID, getRun, getTrial, materializeTrial, type Run } from "@/lib/bay/run";
import { materializeScene, type Scene } from "@/lib/bay/scene";
import { SOLID_SHAPES, type SolidShape } from "@/lib/bay/solids";

export type Tool = "grab" | "nail";
export type Kind =
  | "pack"
  | "charge"
  | "grenade"
  | "can"
  | "crate"
  | "dummy"
  | "grass"
  | "wall"
  | "doorway"
  | "wagon"
  | "hill"
  | "ramp"
  | SolidShape;

export interface Entity {
  id: string;
  kind: Kind;
  pos: [number, number, number];
  rot?: [number, number, number];
  vel?: [number, number, number];
  grip?: number;
  bounce?: number;
  mass?: number;
  live?: boolean;
  fixed?: boolean;
  size?: [number, number, number];
  fuse?: number;
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
  runId: string | null;
  trial: number;
  scene: Scene | null;
  stageN: number;
  inspect: boolean;
  spawn: (kind: Kind) => void;
  clear: () => void;
  reset: () => void;
  loadLevel: (id: string) => { ok: boolean; id: string; n: number; name: string };
  loadScene: (scene: Scene) => { ok: boolean; id: string; n: number; name: string; file: string };
  loadRun: (id: string, lv?: number) => { ok: boolean; id: string; lv: number; n: number; name: string };
  nextTrial: () => { ok: boolean; id: string; lv: number; n: number; name: string; last?: boolean };
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

function stageLevel(id: string) {
  const level = getLevel(id) ?? getLevel(DEFAULT_LEVEL_ID)!;
  return { ...materialize(level, nid), levelId: level.id, runId: null as string | null, trial: 0, scene: null as Scene | null, stageN: 0 };
}

function stageRun(run: Run, lv: number) {
  const trial = getTrial(run.id, lv) ?? run.trials[0]!;
  return {
    ...materializeTrial(run, trial, nid),
    levelId: `${run.id}-${trial.lv}`,
    runId: run.id,
    trial: trial.lv,
    scene: null as Scene | null,
    stageN: 0,
  };
}

const start = () => {
  const run = getRun(DEFAULT_RUN_ID)!;
  return stageRun(run, 1);
};

export const useBay = create<BayState>((set, get) => ({
  ...start(),
  muted: false,
  dragging: false,
  cutaway: false,
  inspect: true,
  spawn: (kind) => {
    if (kind === "charge") kind = "grenade";
    const r = () => (Math.random() - 0.5) * 1.4;
    const pos: [number, number, number] =
      kind === "can" ||
      kind === "crate" ||
      kind === "grass" ||
      kind === "dummy" ||
      kind === "wall" ||
      kind === "doorway" ||
      kind === "wagon" ||
      kind === "hill" ||
      kind === "ramp"
        ? [r(), 0, r()]
        : kind === "pack" || kind === "grenade"
          ? [r() * 0.6, 1.15, r() * 0.6]
          : [0.95 + r() * 0.4, 1.05, r() * 0.5];
    const e = { id: nid(), kind, pos };
    const trackId =
      kind === "dummy"
        ? `${e.id}-hips`
        : kind === "crate"
          ? `${e.id}-lid`
          : kind === "doorway"
            ? `${e.id}-panel`
            : e.id;
    set({ entities: [...get().entities, e], selected: e.id, trackId });
  },
  clear: () => set({ entities: [], selected: null, trackId: null, latch: "sealed" }),
  reset: () => {
    const s = get();
    if (s.scene) {
      set({ ...materializeScene(s.scene), dragging: false, latch: "sealed", stageN: s.stageN + 1 });
      return;
    }
    const run = getRun(s.runId);
    if (run) {
      set({ ...stageRun(run, s.trial), dragging: false, latch: "sealed" });
      return;
    }
    set({ ...stageLevel(s.levelId), dragging: false });
  },
  loadLevel: (id) => {
    const staged = stageLevel(id);
    set({ ...staged, dragging: false, inspect: true });
    const level = getLevel(staged.levelId)!;
    return { ok: true, id: staged.levelId, n: staged.entities.length, name: level.name };
  },
  loadScene: (scene) => {
    const staged = materializeScene(scene);
    set({ ...staged, dragging: false, latch: "sealed", inspect: false, tool: "grab", stageN: get().stageN + 1 });
    return {
      ok: true,
      id: scene.id,
      n: staged.entities.length,
      name: scene.name,
      file: scene.file ?? `scenes/${scene.id}.json`,
    };
  },
  loadRun: (id, lv = 1) => {
    const run = getRun(id);
    if (!run) return { ok: false, id, lv: 0, n: 0, name: id };
    const staged = stageRun(run, lv);
    set({ ...staged, dragging: false, inspect: true });
    return { ok: true, id: run.id, lv: staged.trial, n: staged.entities.length, name: run.name };
  },
  nextTrial: () => {
    const s = get();
    const run = getRun(s.runId);
    if (!run) return { ok: false, id: "", lv: 0, n: 0, name: "" };
    const last = run.trials[run.trials.length - 1]!;
    if (s.trial >= last.lv) return { ok: true, id: run.id, lv: s.trial, n: s.entities.length, name: run.name, last: true };
    const staged = stageRun(run, s.trial + 1);
    set({ ...staged, dragging: false });
    return { ok: true, id: run.id, lv: staged.trial, n: staged.entities.length, name: run.name, last: staged.trial >= last.lv };
  },
  saveLevel: (name) => {
    const s = get();
    const current = getLevel(s.levelId);
    const run = getRun(s.runId);
    const label = (name?.trim() || current?.name || run?.name || "Clip").slice(0, 40);
    const replaceId = current && !current.builtin ? current.id : undefined;
    const saved: Level = persistCustom({
      name: label,
      blurb: run ? `${run.name} lv ${s.trial}.` : current?.builtin ? `Copy of ${current.name}.` : (current?.blurb ?? "Saved clip."),
      entities: captureActors(s.entities),
      select: s.entities.find((e) => e.id === s.selected)?.kind,
      track: trackFrom(s.entities, s.trackId),
      replaceId,
    });
    set({ levelId: saved.id, runId: null, trial: 0 });
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
