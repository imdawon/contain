export type CookPhase = "idle" | "cook" | "boom" | "dead";
export type CookChem = "nmc" | "lfp" | "frag";

export interface Cook {
  phase: CookPhase;
  t: number;
  kW: number;
  jet: number;
  smoke: number;
  chem: CookChem;
  boom: number;
  peak: number;
  delay: number;
  pos?: [number, number, number];
}

const g = globalThis as unknown as { __bayCooks?: Map<string, Cook> };
export const cooks: Map<string, Cook> = (g.__bayCooks ??= new Map());

export function startCook(id: string, chem: CookChem, delay: number, peak: number, boom: number) {
  cooks.set(id, {
    phase: "cook",
    t: 0,
    kW: chem === "frag" ? 0.2 : 0.4,
    jet: 0,
    smoke: chem === "frag" ? 0.05 : 0.2,
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
    if (c.chem === "frag") {
      c.kW = 0.3 + u * 1.4;
      c.smoke = 0.06 + u * 0.12;
      c.jet = 0;
    } else {
      c.kW = c.peak * (0.22 + u * u * 1.05);
      c.smoke = Math.min(1, 0.18 + u * (c.chem === "lfp" ? 0.9 : 0.7));
      c.jet = c.chem === "nmc" ? u * u * c.peak * 0.2 : u * 0.12;
    }
    if (c.t >= c.delay) c.phase = "boom";
  } else if (c.phase === "boom") {
    const age = c.t - c.delay;
    if (c.chem === "frag") {
      c.kW = c.peak * Math.exp(-age * 3.2);
      c.jet = 0.08;
      c.smoke = Math.min(1, 0.35 + age * 0.8);
      if (age > 1.15) c.phase = "dead";
    } else {
      c.kW = c.peak * Math.exp(-age * 0.72);
      c.jet = c.chem === "nmc" ? c.kW * 0.28 : c.kW * 0.05;
      c.smoke = Math.min(1, c.smoke + dt * 0.55);
      if (age > 4.4) c.phase = "dead";
    }
  }
  return c;
}
