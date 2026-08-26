import { cooks, startCook } from "@/lib/bay/cook";
import { clearAllHeat } from "@/lib/bay/heat";
import { PACK } from "@/lib/bay/parts";
import { note } from "@/lib/bay/probe";
import { playEvent } from "@/lib/contain/audio";
import { useBay, type Kind, type Tool } from "@/store/bay-store";

export function punctureId(id?: string | null) {
  const store = useBay.getState();
  const target = id ?? store.selected;
  if (!target) return { ok: false, reason: "no-id" as const };
  const ent = store.entities.find((e) => e.id === target);
  if (!ent || (ent.kind !== "pack" && ent.kind !== "charge")) {
    return { ok: false, reason: "not-fuse" as const, id: target, kind: ent?.kind ?? null };
  }
  store.select(target);
  const spec = ent.kind === "charge" ? PACK.charge : PACK.nmc;
  startCook(target, "nmc", spec.cook, spec.peak, spec.boom);
  playEvent("puncture", "nmc");
  note("puncture", { id: target, kind: ent.kind });
  return { ok: true, id: target, kind: ent.kind };
}

export function spawnKind(kind: string) {
  useBay.getState().spawn(kind as Kind);
  note("spawn", { kind });
  return { ok: true, kind, selected: useBay.getState().selected };
}

export function resetBay() {
  cooks.clear();
  clearAllHeat();
  note("reset", {});
  useBay.getState().reset();
  return { ok: true };
}

export function setToolName(tool: string) {
  if (tool !== "grab" && tool !== "nail") return { ok: false, reason: "bad-tool" as const };
  useBay.getState().setTool(tool as Tool);
  note("tool", { tool });
  return { ok: true, tool };
}
