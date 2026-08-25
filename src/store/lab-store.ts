import { create } from "zustand";
import type { ChemistryId, MaterialId, Phase, Verdict } from "@/lib/contain/types";

export interface HudSnapshot {
  t: number;
  cellC: number;
  boxC: number;
  kPa: number;
  kW: number;
  phase: Phase;
}

interface LabState {
  chemistry: ChemistryId;
  material: MaterialId;
  status: "idle" | "running" | "ended";
  runId: number;
  muted: boolean;
  hud: HudSnapshot;
  verdict: Verdict | null;
  setChemistry: (id: ChemistryId) => void;
  setMaterial: (id: MaterialId) => void;
  start: () => void;
  reset: () => void;
  toggleMuted: () => void;
  patchHud: (hud: HudSnapshot) => void;
  setVerdict: (v: Verdict | null) => void;
}

const idleHud: HudSnapshot = {
  t: 0,
  cellC: 22,
  boxC: 22,
  kPa: 101.3,
  kW: 0,
  phase: "idle",
};

export const useLab = create<LabState>((set, get) => ({
  chemistry: "nmc",
  material: "steel",
  status: "idle",
  runId: 1,
  muted: false,
  hud: idleHud,
  verdict: null,
  setChemistry: (id) => {
    if (get().status === "running") return;
    set({ chemistry: id, verdict: null, hud: idleHud, status: "idle" });
  },
  setMaterial: (id) => {
    if (get().status === "running") return;
    set({
      material: id,
      verdict: null,
      hud: idleHud,
      status: "idle",
      runId: get().runId + 1,
    });
  },
  start: () => {
    if (get().status === "running") return;
    set({
      status: "running",
      verdict: null,
      hud: idleHud,
    });
  },
  reset: () => {
    set({
      status: "idle",
      verdict: null,
      hud: idleHud,
      runId: get().runId + 1,
    });
  },
  toggleMuted: () => set({ muted: !get().muted }),
  patchHud: (hud) => set({ hud }),
  setVerdict: (v) => set({ verdict: v, status: v ? "ended" : get().status }),
}));
