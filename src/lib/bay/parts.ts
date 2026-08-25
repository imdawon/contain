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
};

/** Half-extents of the physical floor, meters. Visual grid is infinite. */
export const FLOOR = { half: 200 };
