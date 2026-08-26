/** Toy heat field. Cook + burning grass write; grass reads. Not CFD. */

export type HeatSrc = { x: number; y: number; z: number; kW: number };

export const heats = new Map<string, HeatSrc>();

export function setHeat(id: string, src: HeatSrc) {
  heats.set(id, src);
}

export function clearHeat(id: string) {
  heats.delete(id);
}

export function heatAt(x: number, y: number, z: number) {
  let h = 0;
  for (const s of heats.values()) {
    const d = Math.hypot(s.x - x, s.y - y, s.z - z);
    if (d > 1.1) continue;
    h += s.kW / (1 + d * 3.4);
  }
  return h;
}

export function clearAllHeat() {
  heats.clear();
}
