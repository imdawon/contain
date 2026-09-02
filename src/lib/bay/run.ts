import { materialize, type Level, type LevelActor } from "@/lib/bay/level";
import type { Entity } from "@/store/bay-store";

/** One bet: same victim, one variable ticks up. */
export type Trial = {
  lv: number;
  threat: string;
  victim: string;
  entities: LevelActor[];
};

export type Run = {
  id: string;
  name: string;
  blurb: string;
  victim: string;
  trials: Trial[];
};

export const DEFAULT_RUN_ID = "nades";

function actor(kind: LevelActor["kind"], x: number, y: number, z: number): LevelActor {
  return { kind, pos: [x, y, z] };
}

function ring(n: number, radius: number): LevelActor[] {
  const out: LevelActor[] = [actor("dummy", 0, 0, 0), actor("grass", 0, 0, 0.05)];
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : (i / n) * Math.PI * 2;
    out.push(actor("grenade", Math.sin(a) * radius, 0.09, Math.cos(a) * radius));
  }
  return out;
}

function trial(lv: number, n: number, radius: number, threat?: string): Trial {
  return {
    lv,
    threat: threat ?? (n === 1 ? "1 GRENADE" : `${n} GRENADES`),
    victim: "1 DUMMY",
    entities: ring(n, radius),
  };
}

/** Same dummy. Grenade count / range is the only knob. */
const NADES: Run = {
  id: "nades",
  name: "Grenades vs Dummy",
  blurb: "One dummy. More bangs. Same floor.",
  victim: "1 DUMMY",
  trials: [
    trial(1, 1, 3.4),
    trial(2, 1, 2.45),
    trial(3, 1, 1.82),
    trial(4, 1, 0.32),
    trial(5, 2, 0.38),
    trial(6, 3, 0.42),
    trial(7, 4, 0.46),
    trial(8, 8, 0.58),
    {
      lv: 9,
      threat: "4 GRENADES",
      victim: "1 DUMMY ON A CRATE",
      entities: [
        actor("crate", 0, 0, 0),
        actor("dummy", 0, 0.58, 0),
        actor("grass", 0, 0, 1.05),
        actor("grenade", 0.55, 0.09, 0.55),
        actor("grenade", -0.55, 0.09, 0.55),
        actor("grenade", 0.55, 0.09, -0.55),
        actor("grenade", -0.55, 0.09, -0.55),
      ],
    },
    {
      lv: 10,
      threat: "8 GRENADES",
      victim: "1 DUMMY ON A CRATE",
      entities: [
        actor("crate", 0, 0, 0),
        actor("dummy", 0, 0.58, 0),
        actor("grass", 0, 0, 1.05),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const a = (i / 8) * Math.PI * 2;
          return actor("grenade", Math.sin(a) * 0.7, 0.09, Math.cos(a) * 0.7);
        }),
      ],
    },
  ],
};

/** Same grenade. Cover ticks up. */
const ARMOR: Run = {
  id: "armor",
  name: "Dummy vs Cover",
  blurb: "One bang. Thicker box. Does the dummy walk away?",
  victim: "1 DUMMY",
  trials: [
    {
      lv: 1,
      threat: "1 GRENADE",
      victim: "1 DUMMY · NO COVER",
      entities: ring(1, 3.4),
    },
    {
      lv: 2,
      threat: "1 GRENADE",
      victim: "1 DUMMY · NO COVER",
      entities: ring(1, 0.32),
    },
    {
      lv: 3,
      threat: "1 GRENADE",
      victim: "1 DUMMY · 1 CRATE",
      entities: [
        actor("crate", 0, 0, 0),
        actor("dummy", 0, 0, 1.35),
        actor("grenade", 0, 0.09, -0.85),
        actor("grass", 0, 0, 1.1),
      ],
    },
    {
      lv: 4,
      threat: "1 GRENADE ON THE LID",
      victim: "1 DUMMY IN A CRATE",
      entities: [
        actor("crate", 0, 0, 0),
        actor("dummy", 0, 0.02, 0),
        actor("grenade", 0, 0.64, 0),
        actor("grass", 0, 0, 1.05),
      ],
    },
    {
      lv: 5,
      threat: "2 GRENADES ON THE LID",
      victim: "1 DUMMY IN A CRATE",
      entities: [
        actor("crate", 0, 0, 0),
        actor("dummy", 0, 0.02, 0),
        actor("grenade", 0.12, 0.64, 0.08),
        actor("grenade", -0.12, 0.64, -0.08),
        actor("grass", 0, 0, 1.05),
      ],
    },
    {
      lv: 6,
      threat: "1 GRENADE ON THE LID",
      victim: "1 DUMMY IN A CAN",
      entities: [
        actor("can", 0, 0, 0),
        actor("dummy", 0, 0.02, 0),
        actor("grenade", 0, 0.62, 0),
        actor("grass", 0, 0, 1.15),
      ],
    },
    {
      lv: 7,
      threat: "1 GRENADE",
      victim: "1 DUMMY ON JENGA",
      entities: [
        actor("cube", 0, 0.16, 0),
        actor("cube", 0, 0.48, 0),
        actor("cube", 0, 0.8, 0),
        actor("dummy", 0, 0.98, 0),
        actor("grenade", 0.42, 0.09, 0),
        actor("grass", 0, 0, 1.1),
      ],
    },
    {
      lv: 8,
      threat: "4 GRENADES",
      victim: "1 DUMMY ON JENGA",
      entities: [
        actor("cube", 0, 0.16, 0),
        actor("cube", 0, 0.48, 0),
        actor("cube", 0, 0.8, 0),
        actor("dummy", 0, 0.98, 0),
        actor("grenade", 0.5, 0.09, 0.5),
        actor("grenade", -0.5, 0.09, 0.5),
        actor("grenade", 0.5, 0.09, -0.5),
        actor("grenade", -0.5, 0.09, -0.5),
        actor("grass", 0, 0, 1.1),
      ],
    },
    {
      lv: 9,
      threat: "1 GRENADE",
      victim: "1 DUMMY · 1 WALL",
      entities: [
        actor("dummy", 0, 0, 0),
        actor("wall", 0, 0, 0.48),
        actor("grenade", 0, 0.09, 0.95),
        actor("grass", 1.35, 0, 0),
      ],
    },
    {
      lv: 10,
      threat: "1 GRENADE",
      victim: "1 DUMMY · 1 DOORWAY",
      entities: [
        actor("dummy", 0, 0, 0),
        actor("doorway", 0, 0, 0.52),
        actor("grenade", 0, 0.09, 1.02),
        actor("grass", 1.4, 0, 0),
      ],
    },
    {
      lv: 11,
      threat: "1 GRENADE",
      victim: "1 DUMMY · 1 CRATE",
      entities: [
        actor("dummy", 0, 0, -0.55),
        actor("crate", 0, 0, 0),
        actor("grenade", 0, 0.09, 0.72),
        actor("grass", 1.3, 0, 0),
      ],
    },
    {
      lv: 12,
      threat: "1 GRENADE",
      victim: "1 DUMMY · 1 CAN",
      entities: [
        actor("dummy", 0, 0, -0.58),
        actor("can", 0, 0, 0),
        actor("grenade", 0, 0.09, 0.78),
        actor("grass", 1.35, 0, 0),
      ],
    },
  ],
};

export const RUNS: Run[] = [NADES, ARMOR];

export function getRun(id: string | null | undefined): Run | null {
  if (!id) return null;
  return RUNS.find((r) => r.id === id) ?? null;
}

export function getTrial(runId: string | null | undefined, lv: number): Trial | null {
  const run = getRun(runId);
  if (!run) return null;
  return run.trials.find((t) => t.lv === lv) ?? null;
}

export function trialLevel(run: Run, trial: Trial): Level {
  return {
    id: `${run.id}-${trial.lv}`,
    name: `${trial.threat} vs ${trial.victim}`,
    blurb: run.blurb,
    select: "grenade",
    track: { kind: "dummy", part: "chest" },
    entities: trial.entities,
    builtin: true,
  };
}

export function materializeTrial(run: Run, trial: Trial, nextId: () => string): {
  entities: Entity[];
  selected: string | null;
  trackId: string | null;
  latch: "sealed";
  tool: "grab";
} {
  return materialize(trialLevel(run, trial), nextId);
}

export function runCard(run: Run, lv: number) {
  const trial = run.trials.find((t) => t.lv === lv) ?? run.trials[0];
  return {
    id: run.id,
    name: run.name,
    blurb: run.blurb,
    lv: trial.lv,
    n: run.trials.length,
    threat: trial.threat,
    victim: trial.victim,
    last: trial.lv >= run.trials[run.trials.length - 1]!.lv,
  };
}
