#!/usr/bin/env npx tsx
/** Time one downhill with different world costs. Not a tape. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildWorld, loadRapier, runTrial, type Actor } from "../src/lib/bay/headless.ts";

const actors = JSON.parse(readFileSync(resolve("public/scenes/wheel-100.json"), "utf8")).entities as Actor[];

function bench(label: string, ms: number, steps: number) {
  const sps = steps / (ms / 1000);
  console.log(`${label.padEnd(42)} ${ms.toFixed(0).padStart(6)} ms  ${Math.round(sps).toString().padStart(7)} steps/s  ${(sps / 60).toFixed(1)}× realtime`);
}

const R = await loadRapier();

const configs = [
  { label: "wheel+ramps only, solver 4/1, no dents", drums: "off" as const, solver: 4, pgs: 1, hullCols: 16, yieldHits: false, lazyDrums: true },
  { label: "wheel+ramps only, solver 16/10, no dents", drums: "off" as const, solver: 16, pgs: 10, hullCols: 16, yieldHits: false, lazyDrums: true },
  { label: "lazy drums, solver 4/1, no dents", drums: "lazy" as const, solver: 4, pgs: 1, hullCols: 16, yieldHits: false, lazyDrums: true },
  { label: "lazy drums, solver 4/1, dents", drums: "lazy" as const, solver: 4, pgs: 1, hullCols: 16, yieldHits: true, lazyDrums: true },
  { label: "all 528 drums on, solver 16/10, dents", drums: "always" as const, solver: 16, pgs: 10, hullCols: 48, yieldHits: true, lazyDrums: false },
];

for (const c of configs) {
  const sim = buildWorld(R, actors, {
    solver: c.solver,
    pgs: c.pgs,
    hullCols: c.hullCols,
    drums: c.drums,
  });
  const t0 = performance.now();
  const trial = runTrial(sim, { maxSteps: 1200, jitter: 0, seed: 1, yieldHits: c.yieldHits, lazyDrums: c.lazyDrums });
  const ms = performance.now() - t0;
  bench(c.label, ms, trial.steps);
  console.log(
    `    z=${trial.z.toFixed(1)} spd=${trial.maxSpeed.toFixed(1)} rim=${trial.rim.toFixed(3)} dent=${trial.dent.toFixed(3)} crushed=${trial.drumsCrushed} hulls=${sim.hulls} drums=${sim.drums.length}`,
  );
  sim.world.free();
}
