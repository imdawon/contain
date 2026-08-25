export type ChemistryId = "nmc" | "lfp";
export type MaterialId = "cardboard" | "plastic" | "steel";
export type Phase =
  | "idle"
  | "punctured"
  | "venting"
  | "runaway"
  | "spent"
  | "ended";
export type Verdict = "contained" | "breached" | "burst" | "ignited" | "jet";
export type FailureKind = "lid" | "burst" | "collapse";

export type SimEvent =
  | { type: "puncture" }
  | { type: "vent" }
  | { type: "runaway" }
  | { type: "jet" }
  | { type: "ignite" }
  | { type: "melt" }
  | { type: "lid" }
  | { type: "burst" }
  | { type: "collapse" }
  | { type: "spent" }
  | { type: "verdict"; verdict: Verdict };

export interface Chemistry {
  id: ChemistryId;
  name: string;
  formula: string;
  blurb: string;
  wh: number;
  cellHeatCap: number;
  ventDelay: number;
  runawayDelay: number;
  ventC: number;
  onsetC: number;
  peakKW: number;
  tau: number;
  gasGain: number;
  flameFrac: number;
  smokeGain: number;
  spark: number;
  lidImpulse: number;
  explodeImpulse: number;
  jetThreshold: number;
}

export interface Material {
  id: MaterialId;
  name: string;
  blurb: string;
  heatCap: number;
  igniteC: number | null;
  meltC: number | null;
  burstKPa: number;
  initialVent: number;
  sealed: boolean;
  density: number;
  friction: number;
  restitution: number;
  color: number;
  roughness: number;
  metalness: number;
  inner: { w: number; h: number; d: number };
  thickness: number;
}

export interface ThermalState {
  chem: ChemistryId;
  mat: MaterialId;
  t: number;
  phase: Phase;
  cellC: number;
  boxC: number;
  kPa: number;
  kW: number;
  flameKW: number;
  smoke: number;
  jet: number;
  energyJ: number;
  energy0: number;
  ventArea: number;
  sealed: boolean;
  lidOpen: number;
  integrity: number;
  burning: boolean;
  melted: boolean;
  burst: boolean;
  jetSeen: boolean;
  collapse: boolean;
  spentAt: number;
  events: SimEvent[];
  verdict: Verdict | null;
  trauma: number;
  failure: FailureKind | null;
}
