import { ensureFuseClock } from "@/lib/bay/blast";
import { clearCooks, startCook } from "@/lib/bay/cook";
import { clearAllHeat } from "@/lib/bay/heat";
import { forgetCustom, getLevel, listLevels, levelCard } from "@/lib/bay/level";
import { GRENADE, PACK } from "@/lib/bay/parts";
import { clearLog, note } from "@/lib/bay/probe";
import { getRun, runCard, RUNS } from "@/lib/bay/run";
import { playEvent, silenceLoops } from "@/lib/contain/audio";
import { useBay, type Kind, type Tool } from "@/store/bay-store";

function isFuse(kind: Kind | undefined) {
  return kind === "pack" || kind === "grenade" || kind === "charge";
}

function arm(ent: { id: string; kind: Kind }) {
  if (ent.kind === "grenade" || ent.kind === "charge") {
    startCook(ent.id, "frag", GRENADE.fuse, GRENADE.peak, GRENADE.boom);
    note("pin-pull", { id: ent.id });
  } else {
    startCook(ent.id, "nmc", PACK.nmc.cook, PACK.nmc.peak, PACK.nmc.boom);
  }
  ensureFuseClock();
}

/** Pull every grenade pin on stage. A pack only cooks if it is the target. */
export function punctureId(id?: string | null) {
  const store = useBay.getState();
  const wanted = id ?? store.selected;
  const hit = store.entities.find((e) => e.id === wanted);
  if (hit?.kind === "pack") {
    store.select(hit.id);
    arm(hit);
    playEvent("puncture", "nmc");
    note("puncture", { id: hit.id, kind: "pack" });
    return { ok: true, id: hit.id, kind: hit.kind, n: 1 };
  }
  const nades = store.entities.filter((e) => e.kind === "grenade" || e.kind === "charge");
  const one = nades.find((e) => e.id === wanted);
  const list = id && one ? [one] : nades;
  if (list.length === 0) {
    const fuse = isFuse(hit?.kind) ? hit : store.entities.find((e) => isFuse(e.kind));
    if (!fuse || !isFuse(fuse.kind)) {
      return { ok: false, reason: "not-fuse" as const, id: wanted ?? null, kind: hit?.kind ?? null };
    }
    store.select(fuse.id);
    arm(fuse);
    playEvent("puncture", "nmc");
    note("puncture", { id: fuse.id, kind: fuse.kind });
    return { ok: true, id: fuse.id, kind: fuse.kind, n: 1 };
  }
  store.select(list[0]!.id);
  for (const ent of list) arm(ent);
  playEvent("puncture", "nmc");
  note("puncture", { id: list[0]!.id, kind: "grenade", n: list.length });
  return { ok: true, id: list[0]!.id, kind: "grenade" as const, n: list.length };
}

export function spawnKind(kind: string) {
  useBay.getState().spawn(kind as Kind);
  note("spawn", { kind: kind === "charge" ? "grenade" : kind });
  return { ok: true, kind: kind === "charge" ? "grenade" : kind, selected: useBay.getState().selected };
}

function quietStage() {
  clearCooks();
  clearAllHeat();
  clearLog();
  silenceLoops();
}

export function resetBay() {
  quietStage();
  const s = useBay.getState();
  note("reset", { id: s.runId ?? s.levelId, lv: s.trial });
  useBay.getState().reset();
  return stageInfo();
}

export function listBayLevels() {
  return listLevels().map(levelCard);
}

export function listBayRuns() {
  return RUNS.map((r) => runCard(r, 1));
}

export function loadBay(id: string) {
  const wanted = getLevel(id);
  if (!wanted) return { ok: false as const, reason: "missing" as const, id };
  quietStage();
  const r = useBay.getState().loadLevel(id);
  note("load-level", { id: r.id, name: r.name, n: r.n });
  return { ...r, ...stageInfo() };
}

export function loadRun(id: string, lv = 1) {
  const run = getRun(id);
  if (!run) return { ok: false as const, reason: "missing" as const, id };
  quietStage();
  const r = useBay.getState().loadRun(id, lv);
  note("load-run", { id: r.id, lv: r.lv, name: r.name });
  return { ...r, ...stageInfo() };
}

export function nextTrial() {
  const s = useBay.getState();
  const run = getRun(s.runId);
  if (!run) return { ok: false as const, reason: "no-run" as const };
  if (s.trial >= run.trials[run.trials.length - 1]!.lv) {
    return { ...stageInfo(), last: true as const };
  }
  quietStage();
  const r = useBay.getState().nextTrial();
  note("next-trial", { id: r.id, lv: r.lv });
  return { ...r, ...stageInfo() };
}

export function saveBay(name?: string) {
  const r = useBay.getState().saveLevel(name);
  note("save-level", { id: r.id, name: r.name, n: r.n });
  return r;
}

export function forgetBay(id: string) {
  const r = forgetCustom(id);
  if (!r.ok) return r;
  note("forget-level", { id });
  const s = useBay.getState();
  if (s.levelId === id) {
    quietStage();
    useBay.getState().loadRun(DEFAULT_RUN());
  }
  return { ...r, current: useBay.getState().levelId };
}

function DEFAULT_RUN() {
  return "nades";
}

function stageInfo() {
  const s = useBay.getState();
  const level = getLevel(s.levelId);
  const run = getRun(s.runId);
  return {
    ok: true as const,
    selected: s.selected,
    trackId: s.trackId,
    levelId: s.levelId,
    runId: s.runId,
    trial: s.trial,
    level: level ? levelCard(level) : null,
    run: run ? runCard(run, s.trial) : null,
    entities: s.entities.map((e) => ({ id: e.id, kind: e.kind, pos: e.pos })),
  };
}

export function setToolName(tool: string) {
  if (tool !== "grab" && tool !== "nail") return { ok: false, reason: "bad-tool" as const };
  useBay.getState().setTool(tool as Tool);
  note("tool", { tool });
  return { ok: true, tool };
}
