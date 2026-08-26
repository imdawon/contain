/** Game-level part axioms. Not FEA. */

export const CAN = {
  w: 0.72,
  h: 0.5,
  d: 0.52,
  wall: 0.04,
  lid: 0.06,
  /** Empty steel can, kg. Phone NMC must not loft this. */
  bodyMass: 8,
  lidMass: 1.2,
  /** Latch shears at this accumulated cook force. Phone NMC should beat it. */
  latch: 2.4,
  /** Hinge pin shears at this. E-bike should; phone should not. */
  hinge: 14,
  /** Lid swing, radians. 0 = closed, negative = open up. */
  open: [-2.05, 0.02] as [number, number],
};

export const PACK = {
  /** Phone-size NMC. Fire + vent, not a charge. No world blast. */
  nmc: { size: [0.16, 0.28, 0.04] as [number, number, number], mass: 0.28, cook: 1.6, peak: 8, boom: 3.2 },
  /** Directed charge. Dispatches world blast. */
  charge: { size: [0.2, 0.16, 0.12] as [number, number, number], mass: 1.6, cook: 0.85, peak: 36, boom: 14 },
};

export const CRATE = {
  w: 0.64,
  h: 0.5,
  d: 0.52,
  wall: 0.036,
  lid: 0.04,
  floorMass: 1.1,
  wallMass: 0.7,
  lidMass: 0.85,
};

export const DUMMY = {
  hipMass: 2.2,
  chestMass: 3.2,
  headMass: 0.85,
  thighMass: 1.05,
  shinMass: 0.65,
  uarmMass: 0.5,
  larmMass: 0.38,
};

export const GRASS = {
  cols: 7,
  rows: 5,
  gap: 0.22,
  ignite: 4.2,
};

/** Half-extents of the physical floor, meters. Visual grid is infinite. */
export const FLOOR = { half: 200 };
