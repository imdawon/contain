export type CookPhase = "idle" | "cook" | "boom" | "dead";

export interface Cook {
  phase: CookPhase;
  t: number;
  kW: number;
  jet: number;
  smoke: number;
  chem: "nmc" | "lfp";
  boom: number;
  peak: number;
  delay: number;
  pos?: [number, number, number];
}

export const cooks = new Map<string, Cook>();

export function startCook(id: string, chem: "nmc" | "lfp", delay: number, peak: number, boom: number) {
  cooks.set(id, {
    phase: "cook",
    t: 0,
    kW: 0.4,
    jet: 0,
    smoke: 0.2,
    chem,
    boom,
    peak,
    delay,
  });
}

export function stepCook(id: string, dt: number): Cook | undefined {
  const c = cooks.get(id);
  if (!c || c.phase === "dead" || c.phase === "idle") return c;
  c.t += dt;
  if (c.phase === "cook") {
    const u = Math.min(1, c.t / Math.max(0.2, c.delay));
    c.kW = c.peak * (0.25 + u * 0.9);
    c.smoke = Math.min(1, 0.15 + u * (c.chem === "lfp" ? 0.9 : 0.45));
    c.jet = c.chem === "nmc" ? u * c.peak * 0.12 : u * 0.1;
    if (c.t >= c.delay) {
      c.phase = "boom";
    }
  } else if (c.phase === "boom") {
    c.kW = c.peak * Math.exp(-(c.t - c.delay) * 1.4);
    c.jet = c.chem === "nmc" ? c.kW * 0.18 : c.kW * 0.04;
    c.smoke = Math.min(1, c.smoke + dt * 0.4);
    if (c.t - c.delay > 2.8) c.phase = "dead";
  }
  return c;
}
