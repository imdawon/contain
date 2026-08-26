/** Toy heat field. Cook + burning grass write; grass reads. Not CFD. */

export type HeatSrc = { x: number; y: number; z: number; kW: number; until?: number };

export const heats = new Map<string, HeatSrc>();

export function setHeat(id: string, src: HeatSrc) {
  heats.set(id, src);
}

export function pulseHeat(id: string, src: Omit<HeatSrc, "until">, seconds: number) {
  heats.set(id, { ...src, until: performance.now() / 1000 + seconds });
}

export function clearHeat(id: string) {
  heats.delete(id);
}

export function heatAt(x: number, y: number, z: number) {
  const now = performance.now() / 1000;
  let h = 0;
  for (const [id, s] of heats) {
    if (s.until != null && now > s.until) {
      heats.delete(id);
      continue;
    }
    const d = Math.hypot(s.x - x, s.y - y, s.z - z);
    if (d > 1.35) continue;
    h += s.kW / (1 + d * 3.4);
  }
  return h;
}

export function clearAllHeat() {
  heats.clear();
}
