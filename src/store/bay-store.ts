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
  | "wheel"
  | "drum"
  | "cannon"
  | SolidShape;

export interface Entity {
  id: string;
  /** JSON actor name. Label only — not the React/Rapier id. */
  name?: string;
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
  /** 1 = full U, vertex at center. Wagon hill stays 0.75. */
  cut?: number;
  grade?: number;
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
  slowMo: boolean;
  levelId: string;
  runId: string | null;
  trial: number;
  scene: Scene | null;
  stageN: number;
  inspect: boolean;
  studio: boolean;
  playing: boolean;
  blueprint: Scene | null;
  placeKind: Kind | null;
  moveAxis: "x" | "y" | "z" | null;
  spawn: (kind: Kind) => void;
  patchEntity: (id: string, patch: Partial<Entity>) => void;
  removeEntity: (id: string) => void;
  setSceneMeta: (patch: Partial<Scene>) => void;
  setStudio: (on: boolean) => void;
  setPlaying: (on: boolean) => void;
  stampBlueprint: (scene: Scene) => void;
  setPlaceKind: (kind: Kind | null) => void;
  setMoveAxis: (axis: "x" | "y" | "z" | null) => void;
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
  toggleSlowMo: () => void;
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
  slowMo: false,
  inspect: true,
  studio: false,
  playing: false,
  blueprint: null,
  placeKind: null,
  moveAxis: null,
  spawn: (kind) => {
    if (kind === "charge") kind = "grenade";
    const r = () => (Math.random() - 0.5) * 1.4;
    const pos: [number, number, number] =
      kind === "cannon"
        ? [0, 0, -6]
        : kind === "wagon"
          ? [r(), 0.35, r()]
          : kind === "wheel"
            ? [r(), 1.05, r()]
            : kind === "drum"
              ? [r(), 0.64, r()]
              : kind === "ramp" || kind === "hill"
                ? [0, 0, 0]
                : kind === "can" || kind === "crate" || kind === "grass" || kind === "dummy" || kind === "wall" || kind === "doorway"
                  ? [r(), 0, r()]
                  : kind === "pack" || kind === "grenade"
                    ? [r() * 0.6, 1.15, r() * 0.6]
                    : [0.95 + r() * 0.4, 1.05, r() * 0.5];
    const e: Entity = { id: nid(), kind, pos, name: kind };
    if (kind === "ramp" || kind === "hill") {
      e.size = [8, 8, 22];
      e.fixed = true;
      e.grip = 0.08;
    }
    if (kind === "cannon") e.size = [1.4, 1.6, 3.2];
    if (kind === "wagon") e.vel = [0, 0, 4];
    if (kind === "wheel") {
      e.mass = 100_000;
      e.vel = [0, 0, 8];
    }
    if (kind === "drum") e.mass = 80;
    if (kind === "grenade") e.fuse = 1.7;
    const trackId =
      kind === "dummy"
        ? `${e.id}-chest`
        : kind === "crate"
          ? `${e.id}-lid`
          : kind === "doorway"
            ? `${e.id}-panel`
            : e.id;
    set({ entities: [...get().entities, e], selected: e.id, trackId });
    if (!get().playing) {
      void import("@/lib/bay/studio").then((m) => get().stampBlueprint(m.captureScene()));
    }
  },
  patchEntity: (id, patch) => {
    set({
      entities: get().entities.map((e) => (e.id === id ? { ...e, ...patch, id: e.id, kind: patch.kind ?? e.kind } : e)),
    });
  },
  removeEntity: (id) => {
    const s = get();
    const entities = s.entities.filter((e) => e.id !== id);
    set({
      entities,
      selected: s.selected === id ? (entities[0]?.id ?? null) : s.selected,
      trackId: s.trackId === id || s.trackId?.startsWith(`${id}-`) ? (entities[0]?.id ?? null) : s.trackId,
    });
  },
  setSceneMeta: (patch) => {
    const scene = get().scene;
    if (!scene) {
      const blank: Scene = {
        id: `studio-${Date.now().toString(36)}`,
        name: "Studio",
        blurb: "Studio scene.",
        entities: [],
        ties: [],
        inspect: true,
        ...patch,
      };
      set({ scene: blank });
      return;
    }
    set({ scene: { ...scene, ...patch } });
  },
  setStudio: (studio) => set({ studio, inspect: studio ? true : get().inspect, playing: studio ? false : get().playing }),
  setPlaying: (playing) => set({ playing, slowMo: playing ? get().slowMo : false }),
  stampBlueprint: (scene) => set({ blueprint: scene, scene: { ...(get().scene ?? scene), ...scene, entities: scene.entities, ties: scene.ties } }),
  setPlaceKind: (placeKind) => set({ placeKind }),
  setMoveAxis: (moveAxis) => set({ moveAxis }),
  clear: () => set({ entities: [], selected: null, trackId: null, latch: "sealed" }),
  reset: () => {
    const s = get();
    const stage = s.blueprint ?? s.scene;
    if (stage) {
      set({
        ...materializeScene(stage, nid),
        dragging: false,
        latch: "sealed",
        stageN: s.stageN + 1,
        slowMo: false,
        playing: false,
        studio: s.studio,
        inspect: s.inspect,
        blueprint: stage,
        placeKind: null,
        moveAxis: null,
      });
      return;
    }
    const run = getRun(s.runId);
    if (run) {
      set({ ...stageRun(run, s.trial), dragging: false, latch: "sealed", playing: false, blueprint: null });
      return;
    }
    set({ ...stageLevel(s.levelId), dragging: false, playing: false, blueprint: null });
  },
  loadLevel: (id) => {
    const staged = stageLevel(id);
    set({ ...staged, dragging: false, inspect: true, playing: false, blueprint: null });
    const level = getLevel(staged.levelId)!;
    return { ok: true, id: staged.levelId, n: staged.entities.length, name: level.name };
  },
  loadScene: (scene) => {
    const staged = materializeScene(scene, nid);
    const inspect = scene.inspect === true || get().studio;
    set({
      ...staged,
      dragging: false,
      latch: "sealed",
      inspect,
      tool: "grab",
      stageN: get().stageN + 1,
      placeKind: null,
      playing: false,
      blueprint: scene,
      moveAxis: null,
    });
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
    set({ ...staged, dragging: false, inspect: true, playing: false, blueprint: null });
    return { ok: true, id: run.id, lv: staged.trial, n: staged.entities.length, name: run.name };
  },
  nextTrial: () => {
    const s = get();
    const run = getRun(s.runId);
    if (!run) return { ok: false, id: "", lv: 0, n: 0, name: "" };
    const last = run.trials[run.trials.length - 1]!;
    if (s.trial >= last.lv) return { ok: true, id: run.id, lv: s.trial, n: s.entities.length, name: run.name, last: true };
    const staged = stageRun(run, s.trial + 1);
    set({ ...staged, dragging: false, playing: false, blueprint: null });
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
  toggleSlowMo: () => set({ slowMo: !get().slowMo }),
}));
