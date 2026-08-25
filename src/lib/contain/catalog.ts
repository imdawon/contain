import type { Chemistry, ChemistryId, Material, MaterialId } from "./types";

export const CHEMISTRIES: Record<ChemistryId, Chemistry> = {
  nmc: {
    id: "nmc",
    name: "NMC",
    formula: "LiNiMnCoO₂",
    blurb: "Jets. High pressure. Typical phone cell.",
    wh: 14.2,
    cellHeatCap: 92,
    ventDelay: 0.55,
    runawayDelay: 1.15,
    ventC: 108,
    onsetC: 168,
    peakKW: 7.4,
    tau: 1.65,
    gasGain: 1,
    flameFrac: 0.84,
    smokeGain: 0.7,
    spark: 1,
    lidImpulse: 4.8,
    explodeImpulse: 6.4,
    jetThreshold: 1.8,
  },
  lfp: {
    id: "lfp",
    name: "LFP",
    formula: "LiFePO₄",
    blurb: "Sulks. Smokes. Harder to run away.",
    wh: 11,
    cellHeatCap: 110,
    ventDelay: 1.7,
    runawayDelay: 3.4,
    ventC: 128,
    onsetC: 248,
    peakKW: 3.1,
    tau: 5.8,
    gasGain: 0.12,
    flameFrac: 0.14,
    smokeGain: 1.15,
    spark: 0.05,
    lidImpulse: 0.55,
    explodeImpulse: 0.9,
    jetThreshold: 3.5,
  },
};

export const MATERIALS: Record<MaterialId, Material> = {
  cardboard: {
    id: "cardboard",
    name: "Cardboard",
    blurb: "Fuel. No seal. Burns, does not bomb.",
    heatCap: 220,
    igniteC: 218,
    meltC: null,
    burstKPa: 400,
    initialVent: 0.018,
    sealed: false,
    density: 0.55,
    friction: 0.55,
    restitution: 0.05,
    color: 0xc4a574,
    roughness: 0.92,
    metalness: 0,
    inner: { w: 0.34, h: 0.36, d: 0.28 },
    thickness: 0.012,
  },
  plastic: {
    id: "plastic",
    name: "Plastic tote",
    blurb: "Melts. Sealed. Can become a bomb.",
    heatCap: 320,
    igniteC: 360,
    meltC: 158,
    burstKPa: 168,
    initialVent: 0.00008,
    sealed: true,
    density: 1.15,
    friction: 0.4,
    restitution: 0.12,
    color: 0x2a3338,
    roughness: 0.28,
    metalness: 0.08,
    inner: { w: 0.42, h: 0.3, d: 0.36 },
    thickness: 0.01,
  },
  steel: {
    id: "steel",
    name: "Steel can",
    blurb: "Holds. Conducts. Lid can yield.",
    heatCap: 980,
    igniteC: null,
    meltC: null,
    burstKPa: 236,
    initialVent: 0.00005,
    sealed: true,
    density: 6.2,
    friction: 0.45,
    restitution: 0.08,
    color: 0x8a9274,
    roughness: 0.42,
    metalness: 0.62,
    inner: { w: 0.3, h: 0.26, d: 0.2 },
    thickness: 0.007,
  },
};

export const PHONE = {
  w: 0.078,
  h: 0.155,
  d: 0.012,
  density: 3.4,
};

export const AMBIENT_C = 22;
export const ATM_KPA = 101.3;

export const PHASE_COPY: Record<string, string> = {
  idle: "Ready",
  punctured: "Nail in",
  venting: "Off-gassing",
  runaway: "Thermal runaway",
  spent: "Cooking down",
  ended: "Call",
};

export function verdictLabel(v: string): string {
  switch (v) {
    case "contained":
      return "CONTAINED";
    case "breached":
      return "BREACHED";
    case "burst":
      return "BURST";
    case "ignited":
      return "IGNITED";
    case "jet":
      return "JET FIRE";
    default:
      return v.toUpperCase();
  }
}
