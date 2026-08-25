import { resetBits } from "./bodies";
import { createThermal, puncture } from "./thermal";
import type { ChemistryId, MaterialId, ThermalState } from "./types";

export interface ShowState {
  timeScale: number;
  hitstop: number;
  slowmo: number;
  punch: number;
  bulge: number;
  glow: number;
  rattle: number;
  shock: number;
  nail: number;
  lidHinge: number;
  char: number;
}

export const runtime: {
  thermal: ThermalState;
  show: ShowState;
  frames: number;
} = {
  thermal: createThermal("nmc", "steel"),
  show: freshShow(),
  frames: 0,
};

export function freshShow(): ShowState {
  return {
    timeScale: 1,
    hitstop: 0,
    slowmo: 0,
    punch: 0,
    bulge: 0,
    glow: 0,
    rattle: 0,
    shock: 0,
    nail: 0,
    lidHinge: 1,
    char: 0,
  };
}

export function beginRun(chem: ChemistryId, mat: MaterialId) {
  runtime.thermal = createThermal(chem, mat);
  runtime.show = freshShow();
  runtime.show.lidHinge = 1;
  resetBits(mat);
  puncture(runtime.thermal);
  runtime.show.hitstop = 0.045;
  runtime.show.punch = 0.55;
}

export function resetIdle(chem: ChemistryId, mat: MaterialId) {
  runtime.thermal = createThermal(chem, mat);
  runtime.show = freshShow();
  resetBits(mat);
}
