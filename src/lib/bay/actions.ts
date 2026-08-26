import { cooks, startCook } from "@/lib/bay/cook";
import { clearAllHeat } from "@/lib/bay/heat";
import { PACK } from "@/lib/bay/parts";
import { clearLog, note } from "@/lib/bay/probe";
import { playEvent } from "@/lib/contain/audio";
import { useBay, type Kind, type Tool } from "@/store/bay-store";

function isFuse(kind: Kind | undefined) {
  return kind === "pack" || kind === "charge";
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
  const spec = ent.kind === "charge" ? PACK.charge : PACK.nmc;
  startCook(ent.id, "nmc", spec.cook, spec.peak, spec.boom);
  playEvent("puncture", "nmc");
  note("puncture", { id: ent.id, kind: ent.kind });
  return { ok: true, id: ent.id, kind: ent.kind };
}

export function spawnKind(kind: string) {
  useBay.getState().spawn(kind as Kind);
  note("spawn", { kind });
  return { ok: true, kind, selected: useBay.getState().selected };
}

export function resetBay() {
  cooks.clear();
  clearAllHeat();
  clearLog();
  note("reset", {});
  useBay.getState().reset();
  const s = useBay.getState();
  return {
    ok: true,
    selected: s.selected,
    trackId: s.trackId,
    entities: s.entities.map((e) => ({ id: e.id, kind: e.kind })),
  };
}

export function setToolName(tool: string) {
  if (tool !== "grab" && tool !== "nail") return { ok: false, reason: "bad-tool" as const };
  useBay.getState().setTool(tool as Tool);
  note("tool", { tool });
  return { ok: true, tool };
}
