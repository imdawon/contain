#!/usr/bin/env npx tsx
/**
 * Headless tonne-roll stats. No canvas, no ffmpeg.
 *
 * In this repo "yield" means plastic deformation of steel (coil rim bruises,
 * oil-drum walls cave). It does NOT mean "yield the CPU" or "skip a trial".
 *
 *   --no-dents     skip that plastic pass. Rigid-body motion only.
 *                  Faster. Cannot answer "does the coil bruise?"
 *   --no-yield     old name for --no-dents. Same thing.
 *
 * PufferLib is not used here. It vectorizes tiny RL environments (CartPole /
 * Atari-scale: a few dozen multiplies per step). This is one Rapier contact
 * island with a 100 t cylinder, ~288 ramp hulls, and up to 528 drums.
 */
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { buildWorld, loadRapier, runTrial, summarize, type Actor, type DrumMode, type Trial } from "../src/lib/bay/headless.ts";

type Job = {
  scenePath: string;
  seeds: number[];
  jitter: number;
  maxSteps: number;
  solver: number;
  pgs: number;
  hullCols: number;
  drums: DrumMode;
  yieldHits: boolean;
  trace: boolean;
};

function help() {
  console.error(`eval-wheel — headless Rapier distributions (no tape)

Usage:
  npx tsx scripts/eval-wheel.ts --scene wheel-100 --n 64 --workers 8

Flags:
  --scene, -s     scene id or json path          (wheel-100)
  --n, -n         independent trials             (32)
  --workers, -w   OS processes, one Rapier each  (cpus-1)
  --jitter        spawn noise, meters            (0.04)
  --steps         physics-step cap               (2400 = 40s at 60 Hz)
  --dents         apply steel plastic dents      (default on)
  --no-dents      skip dents; rigid motion only
  --no-yield      alias of --no-dents
  --drums         lazy | always | off            (lazy = insert at z>92)
  --hulls         ramp convex slices             (16)
  --solver --pgs  Rapier iterations at smash     (8 / 2)
  --trace         print pose once per second
  --help          this text

"yield" here is materials-science yield: the coil/drums taking a permanent
dent. --no-dents turns that off so you can time the rigid solver alone.

Realtime is 60 steps/s per world. steps/s in the banner is across all workers.
`);
}

function parseArgs(argv: string[]) {
  const out = {
    scene: "wheel-100",
    n: 32,
    workers: Math.max(1, cpus().length - 1),
    jitter: 0.04,
    maxSteps: 2400,
    solver: 16,
    pgs: 10,
    hullCols: 48,
    drums: "lazy" as DrumMode,
    yieldHits: true,
    trace: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--scene" || a === "-s") out.scene = next();
    else if (a === "--n" || a === "-n") out.n = Math.max(1, Number(next()));
    else if (a === "--workers" || a === "-w") out.workers = Math.max(1, Number(next()));
    else if (a === "--jitter") out.jitter = Number(next());
    else if (a === "--steps") out.maxSteps = Math.max(60, Number(next()));
    else if (a === "--solver") out.solver = Math.max(1, Number(next()));
    else if (a === "--pgs") out.pgs = Math.max(1, Number(next()));
    else if (a === "--hulls") out.hullCols = Math.max(4, Number(next()));
    else if (a === "--drums") out.drums = next() as DrumMode;
    else if (a === "--always-drums") out.drums = "always";
    else if (a === "--dents") out.yieldHits = true;
    else if (a === "--no-dents" || a === "--no-yield") out.yieldHits = false;
    else if (a === "--fast") {
      out.solver = 4;
      out.pgs = 1;
    }
    else if (a === "--trace") out.trace = true;
    else if (!a.startsWith("-")) out.scene = a;
  }
  return out;
}

function sceneFile(id: string) {
  if (id.endsWith(".json")) return resolve(id);
  return resolve(`public/scenes/${id}.json`);
}

function loadActors(path: string): Actor[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { entities?: Actor[] };
  if (!Array.isArray(raw.entities)) throw new Error(`no entities in ${path}`);
  return raw.entities;
}

async function runJob(job: Job): Promise<Trial[]> {
  const R = await loadRapier();
  const actors = loadActors(job.scenePath);
  const sim = buildWorld(R, actors, {
    solver: job.solver,
    pgs: job.pgs,
    hullCols: job.hullCols,
    drums: job.drums,
  });
  if (job.trace) console.error(`# hulls ${sim.hulls} fail ${sim.hullFail} drums ${sim.drums.length} mode ${sim.drumMode}`);
  const out: Trial[] = [];
  for (const seed of job.seeds) {
    out.push(
      runTrial(sim, {
        maxSteps: job.maxSteps,
        jitter: job.jitter,
        seed,
        yieldHits: job.yieldHits,
        lazyDrums: job.drums === "lazy",
        trace: job.trace
          ? (row) => {
              console.error(`t=${(row.step / 60).toFixed(1)} x=${row.x.toFixed(2)} y=${row.y.toFixed(2)} z=${row.z.toFixed(2)} spd=${row.speed.toFixed(2)}`);
            }
          : undefined,
      }),
    );
  }
  sim.world.free();
  return out;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const size = Math.ceil(xs.length / n);
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out.filter((c) => c.length);
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function printStats(label: string, s: { n: number; mean: number; median: number; mode: number; std: number; min: number; max: number; p05: number; p95: number }) {
  if (!s.n) {
    console.error(`  ${label}: (none)`);
    return;
  }
  console.error(
    `  ${label}: mean ${fmt(s.mean)}  median ${fmt(s.median)}  mode ${fmt(s.mode)}  std ${fmt(s.std)}  p05 ${fmt(s.p05)}  p95 ${fmt(s.p95)}  min ${fmt(s.min)}  max ${fmt(s.max)}`,
  );
}

if (!isMainThread) {
  const job = workerData as Job;
  runJob(job)
    .then((trials) => parentPort?.postMessage(trials))
    .catch((err) => {
      throw err;
    });
} else {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    process.exit(0);
  }
  const scenePath = sceneFile(args.scene);
  const seeds = Array.from({ length: args.n }, (_, i) => i + 1);
  const workers = Math.min(args.workers, args.n);
  const t0 = performance.now();
  const jobs = chunk(seeds, workers).map((part) => ({
    scenePath,
    seeds: part,
    jitter: args.jitter,
    maxSteps: args.maxSteps,
    solver: args.solver,
    pgs: args.pgs,
    hullCols: args.hullCols,
    drums: args.drums,
    yieldHits: args.yieldHits,
    trace: args.trace,
  }));

  const self = fileURLToPath(import.meta.url);
  const execArgv = process.execArgv.length ? process.execArgv : ["--import", "tsx"];

  const trials: Trial[] =
    jobs.length === 1
      ? await runJob(jobs[0]!)
      : (
          await Promise.all(
            jobs.map(
              (job) =>
                new Promise<Trial[]>((resolveJob, reject) => {
                  const w = new Worker(self, { workerData: job, execArgv });
                  w.once("message", (msg) => {
                    resolveJob(msg as Trial[]);
                    void w.terminate();
                  });
                  w.once("error", reject);
                  w.once("exit", (code) => {
                    if (code !== 0) reject(new Error(`worker exit ${code}`));
                  });
                }),
            ),
          )
        ).flat();

  const elapsed = (performance.now() - t0) / 1000;
  const steps = trials.reduce((a, t) => a + t.steps, 0);
  const summary = summarize(trials);
  const perWorld = steps / elapsed / workers;
  console.log(
    JSON.stringify(
      {
        scene: args.scene,
        n: trials.length,
        workers,
        jitter: args.jitter,
        drums: args.drums,
        dents: args.yieldHits,
        elapsed_s: Number(elapsed.toFixed(3)),
        steps,
        steps_per_s: Math.round(steps / elapsed),
        steps_per_s_per_world: Math.round(perWorld),
        realtime_x_per_world: Number((perWorld / 60).toFixed(2)),
        trials_per_s: Number((trials.length / elapsed).toFixed(3)),
        summary,
        trials,
      },
      null,
      2,
    ),
  );
  console.error(`# ${args.scene} n=${trials.length} workers=${workers} drums=${args.drums} dents=${args.yieldHits}`);
  console.error(`# ${elapsed.toFixed(2)}s  ${Math.round(steps / elapsed)} steps/s total  ${Math.round(perWorld)} steps/s/world  ${(perWorld / 60).toFixed(1)}× realtime/world`);
  console.error(`# hitWall ${(summary.hitWall * 100).toFixed(1)}%`);
  printStats("rim", summary.rim);
  printStats("dent", summary.dent);
  printStats("strain", summary.strain);
  printStats("maxSpeed", summary.maxSpeed);
  printStats("z", summary.z);
  printStats("x", summary.x);
  printStats("drumsCrushed", summary.drumsCrushed);
  printStats("seconds", summary.seconds);
  printStats("tFloor", summary.tFloor);
}
