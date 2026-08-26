import { cooks, startCook } from "@/lib/bay/cook";
import { clearAllHeat } from "@/lib/bay/heat";
import { forgetCustom, getLevel, listLevels, levelCard } from "@/lib/bay/level";
import { GRENADE, PACK } from "@/lib/bay/parts";
import { clearLog, note } from "@/lib/bay/probe";
import { playEvent, silenceLoops } from "@/lib/contain/audio";
import { useBay, type Kind, type Tool } from "@/store/bay-store";

function isFuse(kind: Kind | undefined) {
  return kind === "pack" || kind === "grenade" || kind === "charge";
}

export function punctureId(id?: string | null) {
  const store = useBay.getState();
  const wanted = id ?? store.selected;
  const hit = store.entities.find((e) => e.id === wanted);
  const ent = isFuse(hit?.kind) ? hit : store.entities.find((e) => isFuse(e.kind));
  if (!ent || !isFuse(ent.kind)) {
    return { ok: false, reason: "not-fuse" as const, id: wanted ?? null, kind: hit?.kind ?? null };
  }
  store.select(ent.id);
  if (ent.kind === "grenade" || ent.kind === "charge") {
    startCook(ent.id, "frag", GRENADE.fuse, GRENADE.peak, GRENADE.boom);
    note("pin-pull", { id: ent.id });
  } else {
    startCook(ent.id, "nmc", PACK.nmc.cook, PACK.nmc.peak, PACK.nmc.boom);
  }
  playEvent("puncture", "nmc");
  note("puncture", { id: ent.id, kind: ent.kind === "charge" ? "grenade" : ent.kind });
  return { ok: true, id: ent.id, kind: ent.kind };
}

export function spawnKind(kind: string) {
  useBay.getState().spawn(kind as Kind);
  note("spawn", { kind: kind === "charge" ? "grenade" : kind });
  return { ok: true, kind: kind === "charge" ? "grenade" : kind, selected: useBay.getState().selected };
}

function quietStage() {
  cooks.clear();
  clearAllHeat();
  clearLog();
  silenceLoops();
}

export function resetBay() {
  quietStage();
  note("reset", { id: useBay.getState().levelId });
  useBay.getState().reset();
  return stageInfo();
}

export function listBayLevels() {
  return listLevels().map(levelCard);
}

export function loadBay(id: string) {
  const wanted = getLevel(id);
  if (!wanted) return { ok: false as const, reason: "missing" as const, id };
  quietStage();
  const r = useBay.getState().loadLevel(id);
  note("load-level", { id: r.id, name: r.name, n: r.n });
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
    useBay.getState().loadLevel("pin-pull");
  }
  return { ...r, current: useBay.getState().levelId };
}

function stageInfo() {
  const s = useBay.getState();
  const level = getLevel(s.levelId);
  return {
    ok: true as const,
    selected: s.selected,
    trackId: s.trackId,
    levelId: s.levelId,
    level: level ? levelCard(level) : null,
    entities: s.entities.map((e) => ({ id: e.id, kind: e.kind, pos: e.pos })),
  };
}

export function setToolName(tool: string) {
  if (tool !== "grab" && tool !== "nail") return { ok: false, reason: "bad-tool" as const };
  useBay.getState().setTool(tool as Tool);
  note("tool", { tool });
  return { ok: true, tool };
}
