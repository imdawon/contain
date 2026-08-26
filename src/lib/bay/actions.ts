import { cooks, startCook } from "@/lib/bay/cook";
import { clearAllHeat } from "@/lib/bay/heat";
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

export function resetBay() {
  cooks.clear();
  clearAllHeat();
  clearLog();
  silenceLoops();
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
