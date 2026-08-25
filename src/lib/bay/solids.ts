/** Collider-kit shapes for stacking / tumbling tests. Not scenery. */

export const SOLID_SHAPES = [
  "cube",
  "ball",
  "cylinder",
  "capsule",
  "tetra",
  "octa",
  "dodeca",
  "ico",
  "plank",
] as const;

export type SolidShape = (typeof SOLID_SHAPES)[number];

export const SOLID = {
  cube: { label: "Cube", mass: 1.2, color: 0xb89b74, friction: 0.55, restitution: 0.12 },
  ball: { label: "Ball", mass: 0.8, color: 0x8a949c, friction: 0.35, restitution: 0.45 },
  cylinder: { label: "Cylinder", mass: 1.0, color: 0x7a8458, friction: 0.5, restitution: 0.18 },
  capsule: { label: "Capsule", mass: 0.7, color: 0xc4bcae, friction: 0.4, restitution: 0.22 },
  tetra: { label: "Tetra", mass: 0.55, color: 0xa85a42, friction: 0.5, restitution: 0.1 },
  octa: { label: "Octa", mass: 0.7, color: 0x6d787e, friction: 0.45, restitution: 0.14 },
  dodeca: { label: "Dodeca", mass: 1.1, color: 0x9a8b6a, friction: 0.5, restitution: 0.12 },
  ico: { label: "Ico", mass: 0.9, color: 0x6a7d5c, friction: 0.45, restitution: 0.16 },
  plank: { label: "Plank", mass: 1.4, color: 0x6a5340, friction: 0.65, restitution: 0.06 },
} as const satisfies Record<
  SolidShape,
  { label: string; mass: number; color: number; friction: number; restitution: number }
>;
