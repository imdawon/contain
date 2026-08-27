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
  radius: 1.0,
  /** Coil face width. BeamNG 100 t roll is car-scale, not an 80 cm puck. */
  thick: 1.8,
  hub: 0.22,
  segs: 24,
  /** Default 100 t. Rapier is kg. Scene files may 10x this. */
  mass: 100_000,
  /** Slam bruise. Rolling contact is gated by closing speed, not this. */
  yieldJ: 400_000,
  stiff: 6e5,
  maxDent: 0.42,
  color: 0x6e7278,
};

/** Thin-wall oil drum. Side panels cave in; lids ride the dented ring. */
export const DRUM = {
  /** Half the 4x barrels (2x a 55-gal) so the 2 m coil still dwarfs them. */
  radius: 0.51,
  height: 1.28,
  wall: 0.06,
  segs: 24,
  /** Empty 2x 55-gal steel. Full drums would not pancake. */
  mass: 80,
  yieldJ: 0.02,
  stiff: 0.35,
  maxDent: 0.62,
  color: 0x4a5240,
};

/** Half-extents of the physical floor, meters. Visual grid is infinite. */
export const FLOOR = { half: 2000 };

/** Principal inertia of a thick-walled coil. Local Y is the bore. */
export function coilInertia(kg: number) {
  const ro = WHEEL.radius;
  const ri = WHEEL.hub;
  const h = WHEEL.thick;
  const ring = 0.5 * kg * (ro * ro + ri * ri);
  /** Tumble I must beat roll I or a squat coil flips like a glued toilet-paper roll. */
  const trans = (0.25 * kg * (ro * ro + ri * ri) + (kg * h * h) / 12) * 8;
  return { x: trans, y: ring, z: trans };
}

/** Principal inertia of a closed drum. Local Y is the axis. */
export function drumInertia(kg: number) {
  const r = DRUM.radius;
  const h = DRUM.height;
  const ring = 0.5 * kg * r * r;
  const trans = 0.25 * kg * r * r + (kg * h * h) / 12;
  return { x: trans, y: ring, z: trans };
}
