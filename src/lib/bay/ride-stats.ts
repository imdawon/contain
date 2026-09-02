/** Mean/median/stdev plus motion flags over a 30 Hz pose ring. Not a physics engine. */

export type PathSample = {
  t: number;
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  vx?: number | null;
  vy?: number | null;
  vz?: number | null;
};

export type NumStats = {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdev: number;
};

export type Anomaly = {
  t: number;
  kind: "teleport" | "pose-vel" | "spin-flip" | "nan" | "dt-gap";
  detail: string;
};

export type RideReport = {
  id: string;
  samples: number;
  dt: NumStats | null;
  speed: NumStats | null;
  x: NumStats | null;
  y: NumStats | null;
  z: NumStats | null;
  rx: NumStats | null;
  anomalies: Anomaly[];
};

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function stats(xs: number[]): NumStats | null {
  const v = xs.filter((n) => Number.isFinite(n));
  if (v.length === 0) return null;
  const sorted = v.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  let sum = 0;
  for (const x of v) sum += x;
  const mean = sum / n;
  const mid = n >> 1;
  const median = n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  let acc = 0;
  for (const x of v) {
    const d = x - mean;
    acc += d * d;
  }
  return {
    n,
    min: round(min),
    max: round(max),
    mean: round(mean),
    median: round(median),
    stdev: round(Math.sqrt(acc / n)),
  };
}

function speedOf(p: PathSample): number {
  return Math.hypot(p.vx ?? 0, p.vy ?? 0, p.vz ?? 0);
}

/**
 * Flag motion that a 30 Hz log should not show for a rigid body:
 * teleports, pose/velocity disagreement, Euler flips, NaNs, dropped ticks.
 */
export function analyzePath(id: string, path: PathSample[]): RideReport {
  const anomalies: Anomaly[] = [];
  const dts: number[] = [];
  const speeds: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const rxs: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    xs.push(p.x);
    ys.push(p.y);
    zs.push(p.z);
    if (p.rx != null) rxs.push(p.rx);
    speeds.push(speedOf(p));
    if (![p.t, p.x, p.y, p.z, p.vx, p.vy, p.vz].every((n) => n == null || Number.isFinite(n))) {
      anomalies.push({ t: p.t, kind: "nan", detail: "non-finite pose or vel" });
    }
    if (i === 0) continue;
    const prev = path[i - 1]!;
    const dt = p.t - prev.t;
    dts.push(dt);
    if (dt > 0.12) {
      anomalies.push({ t: p.t, kind: "dt-gap", detail: `dt ${round(dt)}s` });
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const dz = p.z - prev.z;
    const dist = Math.hypot(dx, dy, dz);
    const cap = Math.max(speedOf(prev), speedOf(p), 1) * Math.max(dt, 1 / 30) * 3 + 1.5;
    if (dist > cap) {
      anomalies.push({ t: p.t, kind: "teleport", detail: `moved ${round(dist)}m cap ${round(cap)}` });
    }
    if (dt > 1e-4) {
      const sx = dx / dt;
      const sy = dy / dt;
      const sz = dz / dt;
      const reported = [(p.vx ?? prev.vx) ?? 0, (p.vy ?? prev.vy) ?? 0, (p.vz ?? prev.vz) ?? 0];
      const err = Math.hypot(sx - reported[0], sy - reported[1], sz - reported[2]);
      if (err > 18 && dist > 0.4) {
        anomalies.push({ t: p.t, kind: "pose-vel", detail: `err ${round(err)} m/s` });
      }
    }
    if (p.rx != null && prev.rx != null) {
      const dRx = Math.abs(p.rx - prev.rx);
      if (dRx > 2.4 && dt < 0.08) {
        anomalies.push({ t: p.t, kind: "spin-flip", detail: `dRx ${round(dRx)} in ${round(dt)}s` });
      }
    }
  }
  return {
    id,
    samples: path.length,
    dt: stats(dts),
    speed: stats(speeds),
    x: stats(xs),
    y: stats(ys),
    z: stats(zs),
    rx: stats(rxs),
    anomalies: anomalies.slice(0, 40),
  };
}
