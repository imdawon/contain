import type { Scene } from "@/lib/bay/scene";

export type ArenaTheme = "golf" | "medieval" | "beach" | "forest" | "space";

export type ArenaLook = {
  bg: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  nadir: [number, number, number];
  horizon: [number, number, number];
  zenith: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  ambient: number;
  ambientC: string;
  sunI: number;
  sunC: string;
  fillI: number;
  fillC: string;
};

export const ARENA_LOOK: Record<ArenaTheme, ArenaLook> = {
  golf: {
    bg: "#8ec8e8",
    fog: "#b5dcec",
    fogNear: 110,
    fogFar: 260,
    nadir: [0.42, 0.62, 0.38],
    horizon: [0.72, 0.86, 0.92],
    zenith: [0.45, 0.72, 0.95],
    hemiSky: "#d8f0ff",
    hemiGround: "#5a8a48",
    hemiI: 0.95,
    ambient: 0.7,
    ambientC: "#e7f6ff",
    sunI: 2.8,
    sunC: "#fff6d2",
    fillI: 1.05,
    fillC: "#9ad0ff",
  },
  medieval: {
    bg: "#c47a48",
    fog: "#c99468",
    fogNear: 40,
    fogFar: 160,
    nadir: [0.28, 0.16, 0.1],
    horizon: [0.82, 0.48, 0.28],
    zenith: [0.22, 0.24, 0.42],
    hemiSky: "#ffc090",
    hemiGround: "#4a3020",
    hemiI: 0.85,
    ambient: 0.55,
    ambientC: "#ffd2a0",
    sunI: 2.2,
    sunC: "#ffb060",
    fillI: 0.55,
    fillC: "#6a80b0",
  },
  beach: {
    bg: "#7ec8f0",
    fog: "#f2d9a8",
    fogNear: 70,
    fogFar: 220,
    nadir: [0.9, 0.74, 0.42],
    horizon: [0.95, 0.88, 0.7],
    zenith: [0.28, 0.68, 0.95],
    hemiSky: "#fff4cc",
    hemiGround: "#d2b06a",
    hemiI: 1.05,
    ambient: 0.8,
    ambientC: "#fff0d0",
    sunI: 3.2,
    sunC: "#fff2c4",
    fillI: 1.2,
    fillC: "#7ec8ff",
  },
  forest: {
    bg: "#3a5538",
    fog: "#4a6844",
    fogNear: 18,
    fogFar: 90,
    nadir: [0.12, 0.2, 0.1],
    horizon: [0.38, 0.5, 0.3],
    zenith: [0.4, 0.52, 0.48],
    hemiSky: "#b8d0a0",
    hemiGround: "#2a4020",
    hemiI: 0.7,
    ambient: 0.45,
    ambientC: "#c8e0b0",
    sunI: 1.6,
    sunC: "#e8f0c0",
    fillI: 0.4,
    fillC: "#6a8860",
  },
  space: {
    bg: "#05060c",
    fog: "#0a0c16",
    fogNear: 80,
    fogFar: 280,
    nadir: [0.02, 0.02, 0.05],
    horizon: [0.05, 0.06, 0.12],
    zenith: [0.01, 0.02, 0.06],
    hemiSky: "#a0b8ff",
    hemiGround: "#12141c",
    hemiI: 0.25,
    ambient: 0.18,
    ambientC: "#c8d4ff",
    sunI: 3.8,
    sunC: "#ffffff",
    fillI: 0.35,
    fillC: "#6080ff",
  },
};

export function sceneTheme(scene?: Pick<Scene, "id" | "theme"> | null): ArenaTheme | null {
  const raw = `${scene?.theme ?? ""} ${scene?.id ?? ""}`.toLowerCase();
  if (raw.includes("medieval") || raw.includes("keep")) return "medieval";
  if (raw.includes("beach")) return "beach";
  if (raw.includes("forest") || raw.includes("grove")) return "forest";
  if (raw.includes("space") || raw.includes("mare") || raw.includes("moon")) return "space";
  if (raw.includes("golf") || raw.includes("cannon")) return "golf";
  return null;
}

export function sceneGravity(scene?: Pick<Scene, "gravity" | "id" | "theme"> | null): [number, number, number] {
  if (scene?.gravity) return scene.gravity;
  if (sceneTheme(scene) === "space") return [0, -3.2, 0];
  return [0, -9.81, 0];
}
