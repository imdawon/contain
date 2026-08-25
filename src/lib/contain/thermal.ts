import { AMBIENT_C, ATM_KPA, CHEMISTRIES, MATERIALS } from "./catalog";
import type {
  ChemistryId,
  FailureKind,
  MaterialId,
  ThermalState,
  Verdict,
} from "./types";

export function createThermal(
  chem: ChemistryId,
  mat: MaterialId,
): ThermalState {
  const material = MATERIALS[mat];
  return {
    chem,
    mat,
    t: 0,
    phase: "idle",
    cellC: AMBIENT_C,
    boxC: AMBIENT_C,
    kPa: ATM_KPA,
    kW: 0,
    flameKW: 0,
    smoke: 0,
    jet: 0,
    energyJ: CHEMISTRIES[chem].wh * 3600,
    energy0: CHEMISTRIES[chem].wh * 3600,
    ventArea: material.initialVent,
    sealed: material.sealed,
    lidOpen: 0,
    integrity: 1,
    burning: false,
    melted: false,
    burst: false,
    jetSeen: false,
    collapse: false,
    spentAt: -1,
    events: [],
    verdict: null,
    trauma: 0,
    failure: null,
  };
}

export function puncture(s: ThermalState) {
  if (s.phase !== "idle") return;
  s.phase = "punctured";
  s.t = 0;
  s.trauma = Math.max(s.trauma, 0.5);
  s.events.push({ type: "puncture" });
}

function emitFailure(s: ThermalState, kind: FailureKind) {
  if (s.failure) return;
  s.failure = kind;
  s.lidOpen = kind === "lid" ? 0.85 : 1;
  s.sealed = false;
  s.ventArea = Math.max(s.ventArea, 0.04);
  if (kind === "burst") {
    s.burst = true;
    s.integrity = 0.15;
    s.trauma = Math.max(s.trauma, 1);
    s.events.push({ type: "burst" });
  } else if (kind === "lid") {
    s.trauma = Math.max(s.trauma, 0.85);
    s.events.push({ type: "lid" });
  } else {
    s.collapse = true;
    s.integrity = 0.35;
    s.trauma = Math.max(s.trauma, 0.35);
    s.events.push({ type: "collapse" });
  }
}

function decideVerdict(s: ThermalState): Verdict {
  if (s.burst) return "burst";
  if (s.jetSeen && s.lidOpen > 0.4 && s.mat !== "cardboard") return "jet";
  if (s.burning) return "ignited";
  if (s.lidOpen > 0.45 || s.integrity < 0.5) return "breached";
  return "contained";
}

function coupleK(mat: MaterialId) {
  if (mat === "steel") return 0.18;
  if (mat === "plastic") return 0.1;
  return 0.06;
}

export function stepThermal(s: ThermalState, dt: number) {
  if (s.phase === "idle" || s.phase === "ended") {
    s.trauma = Math.max(0, s.trauma - dt * 1.6);
    return;
  }

  const chem = CHEMISTRIES[s.chem];
  const mat = MATERIALS[s.mat];
  s.t += dt;
  s.trauma = Math.max(0, s.trauma - dt * 1.6);

  if (s.phase === "punctured") {
    s.cellC += (64 * dt) / chem.cellHeatCap;
    if (s.t >= chem.ventDelay || s.cellC >= chem.ventC) {
      s.phase = "venting";
      s.events.push({ type: "vent" });
    }
  }

  if (s.phase === "venting") {
    s.cellC += (48 * dt) / chem.cellHeatCap;
    s.smoke = Math.min(1, s.smoke + dt * 0.4 * chem.smokeGain);
    s.kPa += dt * 8 * chem.gasGain * (s.sealed ? 1 : 0.06);
    if (s.t >= chem.runawayDelay || s.cellC >= chem.onsetC) {
      s.phase = "runaway";
      s.events.push({ type: "runaway" });
      s.trauma = Math.max(s.trauma, 0.28);
    }
  }

  if (s.phase === "runaway") {
    const remain = Math.max(0.001, s.energyJ / s.energy0);
    const age = Math.max(0, s.t - chem.runawayDelay);
    const pulse =
      s.chem === "nmc" ? 1.05 * Math.exp(-age / 2.1) + 0.42 : 0.92;
    const power = chem.peakKW * remain * pulse;
    const dE = power * 1000 * dt;
    s.energyJ = Math.max(0, s.energyJ - dE);
    s.kW = power;
    s.flameKW = power * chem.flameFrac;
    s.smoke = Math.min(
      1,
      s.smoke + dt * (0.22 + chem.smokeGain * (1.05 - chem.flameFrac) * 0.5),
    );
    s.cellC += (dE * 1.85) / chem.cellHeatCap;
    s.cellC = Math.min(s.chem === "nmc" ? 980 : 540, s.cellC);
    s.kPa += dt * (14 + power * 8) * chem.gasGain * (s.sealed ? 1 : 0.1);

    const jet = s.flameKW * (s.lidOpen > 0.3 || s.ventArea > 0.01 ? 1 : 0.12);
    s.jet = jet;
    if (jet >= chem.jetThreshold && !s.jetSeen && s.mat !== "cardboard") {
      s.jetSeen = true;
      s.events.push({ type: "jet" });
    }

    if (s.energyJ <= s.energy0 * 0.08 || age > (s.chem === "nmc" ? 6.4 : 11)) {
      s.phase = "spent";
      s.spentAt = s.t;
      s.events.push({ type: "spent" });
    }
  }

  if (s.phase === "spent") {
    s.kW *= Math.exp(-dt * 1.5);
    s.flameKW *= Math.exp(-dt * 1.15);
    s.jet *= Math.exp(-dt * 1.3);
    s.smoke = Math.max(0.04, s.smoke - dt * 0.07);
    s.cellC += (AMBIENT_C - s.cellC) * (1 - Math.exp(-dt * 0.06));
    if (s.spentAt >= 0 && s.t - s.spentAt > 2.6) {
      s.phase = "ended";
      s.verdict = decideVerdict(s);
      s.events.push({ type: "verdict", verdict: s.verdict });
    }
  }

  s.boxC += (s.cellC - s.boxC) * coupleK(s.mat) * dt;
  if (mat.igniteC && s.flameKW > 0.35) {
    s.boxC += s.flameKW * 8.2 * dt;
  }

  if (mat.meltC && s.boxC > mat.meltC && !s.melted) {
    s.melted = true;
    s.sealed = false;
    s.ventArea = Math.max(s.ventArea, 0.014);
    s.integrity = Math.min(s.integrity, 0.45);
    s.lidOpen = Math.max(s.lidOpen, 0.4);
    s.events.push({ type: "melt" });
  }

  if (mat.igniteC && s.boxC > mat.igniteC && s.flameKW > 0.45 && !s.burning) {
    s.burning = true;
    s.events.push({ type: "ignite" });
  }

  if (s.burning) {
    s.boxC += (1.8 * dt * 1000) / mat.heatCap;
    s.flameKW = Math.max(s.flameKW, 1.05);
    s.integrity = Math.max(0.12, s.integrity - dt * 0.16);
    s.smoke = Math.min(1, s.smoke + dt * 0.22);
    if (s.integrity < 0.5 && !s.failure && s.mat === "cardboard") {
      emitFailure(s, "collapse");
    }
  }

  const vent = s.ventArea * Math.max(0, s.kPa - ATM_KPA) * 2200;
  s.kPa = Math.max(ATM_KPA, s.kPa - vent * dt);
  s.boxC += (AMBIENT_C - s.boxC) * dt * 0.03;

  if ((s.phase === "runaway" || s.phase === "venting") && s.sealed && !s.failure) {
    if (s.kPa > mat.burstKPa) {
      if (s.mat === "plastic") emitFailure(s, "burst");
      else if (s.mat === "steel") emitFailure(s, "lid");
    }
  }
}

export function runUntilEnd(
  chem: ChemistryId,
  mat: MaterialId,
  maxT = 28,
): ThermalState {
  const s = createThermal(chem, mat);
  puncture(s);
  const dt = 1 / 60;
  while (s.t < maxT && s.phase !== "ended") stepThermal(s, dt);
  if (!s.verdict) s.verdict = decideVerdict(s);
  return s;
}
