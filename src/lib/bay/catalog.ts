export type Kind =
  | "nmc"
  | "lfp"
  | "laptop"
  | "ebike"
  | "cardboard"
  | "tote"
  | "can"
  | "drum"
  | "crate"
  | "debris";

export type Family = "pack" | "box" | "prop";

export interface Spec {
  id: Kind;
  family: Family;
  name: string;
  size: [number, number, number];
  mass: number;
  restitution: number;
  friction: number;
  color: number;
  metalness: number;
  roughness: number;
  chem?: "nmc" | "lfp";
  peakKW: number;
  cook: number;
  boom: number;
}

export const SPECS: Record<Kind, Spec> = {
  nmc: {
    id: "nmc",
    family: "pack",
    name: "Phone NMC",
    size: [0.12, 0.22, 0.02],
    mass: 0.22,
    restitution: 0.08,
    friction: 0.7,
    color: 0x1b1c1f,
    metalness: 0.65,
    roughness: 0.28,
    chem: "nmc",
    peakKW: 7.4,
    cook: 1.8,
    boom: 2.4,
  },
  lfp: {
    id: "lfp",
    family: "pack",
    name: "Phone LFP",
    size: [0.12, 0.22, 0.02],
    mass: 0.24,
    restitution: 0.08,
    friction: 0.7,
    color: 0x262a2e,
    metalness: 0.6,
    roughness: 0.32,
    chem: "lfp",
    peakKW: 2.2,
    cook: 3.4,
    boom: 0.7,
  },
  laptop: {
    id: "laptop",
    family: "pack",
    name: "Laptop pack",
    size: [0.42, 0.07, 0.28],
    mass: 0.55,
    restitution: 0.06,
    friction: 0.65,
    color: 0x2a3034,
    metalness: 0.4,
    roughness: 0.45,
    chem: "nmc",
    peakKW: 18,
    cook: 2.2,
    boom: 7.5,
  },
  ebike: {
    id: "ebike",
    family: "pack",
    name: "E-bike pack",
    size: [0.5, 0.28, 0.22],
    mass: 3.4,
    restitution: 0.05,
    friction: 0.7,
    color: 0x3a2418,
    metalness: 0.15,
    roughness: 0.7,
    chem: "nmc",
    peakKW: 42,
    cook: 2.8,
    boom: 14,
  },
  cardboard: {
    id: "cardboard",
    family: "box",
    name: "Cardboard",
    size: [0.55, 0.46, 0.42],
    mass: 0.6,
    restitution: 0.04,
    friction: 0.55,
    color: 0xc4a574,
    metalness: 0,
    roughness: 0.92,
    peakKW: 0,
    cook: 0,
    boom: 0,
  },
  tote: {
    id: "tote",
    family: "box",
    name: "Plastic tote",
    size: [0.62, 0.4, 0.48],
    mass: 1.4,
    restitution: 0.12,
    friction: 0.4,
    color: 0x2a3338,
    metalness: 0.08,
    roughness: 0.28,
    peakKW: 0,
    cook: 0,
    boom: 0,
  },
  can: {
    id: "can",
    family: "box",
    name: "Steel can",
    size: [0.42, 0.34, 0.3],
    mass: 2.8,
    restitution: 0.1,
    friction: 0.45,
    color: 0x8a9274,
    metalness: 0.62,
    roughness: 0.42,
    peakKW: 0,
    cook: 0,
    boom: 0,
  },
  drum: {
    id: "drum",
    family: "box",
    name: "Steel drum",
    size: [0.56, 0.72, 0.56],
    mass: 8,
    restitution: 0.12,
    friction: 0.4,
    color: 0x4a5240,
    metalness: 0.55,
    roughness: 0.45,
    peakKW: 0,
    cook: 0,
    boom: 0,
  },
  crate: {
    id: "crate",
    family: "prop",
    name: "Crate",
    size: [0.38, 0.38, 0.38],
    mass: 4,
    restitution: 0.08,
    friction: 0.6,
    color: 0x6a4a2a,
    metalness: 0.02,
    roughness: 0.85,
    peakKW: 0,
    cook: 0,
    boom: 0,
  },
  debris: {
    id: "debris",
    family: "prop",
    name: "Debris",
    size: [0.06, 0.03, 0.05],
    mass: 0.08,
    restitution: 0.2,
    friction: 0.5,
    color: 0x3a3a36,
    metalness: 0.2,
    roughness: 0.6,
    peakKW: 0,
    cook: 0,
    boom: 0,
  },
};

export const PACKS: Kind[] = ["nmc", "lfp", "laptop", "ebike"];
export const BOXES: Kind[] = ["cardboard", "tote", "can", "drum"];
export const PROPS: Kind[] = ["crate"];
