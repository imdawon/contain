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

export const GRENADE = {
  radius: 0.052,
  mass: 0.46,
  /** Pin-to-bang, seconds. */
  fuse: 1.7,
  peak: 28,
  /** World-blast power. Bigger than a phone fire; not a truck bomb. */
  boom: 11,
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

export const WALL = {
  w: 1.35,
  h: 1.85,
  d: 0.1,
  mass: 36,
};

export const DOOR = {
  openW: 0.86,
  h: 2.05,
  frameT: 0.08,
  depth: 0.12,
  panelT: 0.046,
  frameMass: 22,
  panelMass: 9,
  latch: 2.4,
  hinge: 14,
  open: [-1.85, 0.04] as [number, number],
};

export const GRASS = {
  cols: 7,
  rows: 5,
  gap: 0.22,
  ignite: 4.2,
};

/** One rigid cart. Not a vehicle. Wheels are visual / collider bulk. */
export const WAGON = {
  deck: [0.78, 0.1, 1.12] as [number, number, number],
  wheelR: 0.11,
  wheelT: 0.08,
  mass: 18,
};

/** Machined steel wheel. Yields locally; Rapier still owns rigid motion. */
export const WHEEL = {
  radius: 0.4,
  /** Wide enough to face a 3-drum wall. Not a coin on the rail. */
  thick: 0.96,
  hub: 0.1,
  segs: 16,
  /** Default 100 t. Rapier is kg. */
  mass: 100_000,
  /** Contact impulse (N·s) before the rim takes a plastic bruise. */
  yieldJ: 18,
  stiff: 55,
  maxDent: 0.048,
  color: 0x6e7278,
};

/** Thin-wall oil drum. Side panels cave in; lids ride the dented ring. */
export const DRUM = {
  radius: 0.255,
  height: 0.64,
  wall: 0.042,
  segs: 16,
  /** Part-filled 55-gal. Empty 18 kg reads as air against a 100 t roll. */
  mass: 180,
  yieldJ: 0.22,
  stiff: 3.2,
  maxDent: 0.16,
  color: 0x4a5240,
};

/** Half-extents of the physical floor, meters. Visual grid is infinite. */
export const FLOOR = { half: 400 };
