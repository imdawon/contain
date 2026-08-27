/** Parabola U hulls for headless Rapier. No mesh, no React. */
const THICK = 0.4;
const LIP = 1.4;
const COL = 48;

function parabolaY(s: number, h: number, cut: number) {
  const v = 0.5 / cut;
  const a = h / (v * v);
  const d = s - v;
  return a * d * d + 0.9;
}

function lipSlope(h: number, d: number, cut: number) {
  const v = 0.5 / cut;
  const a = h / (v * v);
  return (2 * a * (1 - v)) / d;
}

function surfaceY(z: number, h: number, d: number, cut: number) {
  const hd = d / 2;
  if (z <= hd) {
    const s = (z + hd) / d;
    return parabolaY(Math.min(1, Math.max(0, s)), h, cut);
  }
  if (cut >= 1) return parabolaY(1, h, cut);
  return parabolaY(1, h, cut) + lipSlope(h, d, cut) * (z - hd);
}

function thickAt(z: number, d: number, cut: number) {
  const hd = d / 2;
  if (z <= hd || cut >= 1) return THICK;
  const u = Math.min(1, Math.max(0, (z - hd) / LIP));
  return Math.max(0.05, THICK * (1 - 0.88 * u * u));
}

/** Local-space convex panels matching `ramp.tsx` hulls. grade is rise/run along local +X (travel after yaw). */
export function hillHulls(w: number, h: number, d: number, cut: number, cols = COL, grade = 0): Float32Array[] {
  const hw = w / 2;
  const hd = d / 2;
  const z0 = -hd;
  const z1 = cut >= 1 ? hd : hd + LIP;
  const span = z1 - z0;
  const hulls: Float32Array[] = [];
  for (let i = 0; i < cols; i++) {
    const u0 = Math.max(0, i / cols - 0.012);
    const u1 = Math.min(1, (i + 1) / cols + 0.012);
    const za = z0 + u0 * span;
    const zb = z0 + u1 * span;
    const ya0 = surfaceY(za, h, d, cut);
    const yb0 = surfaceY(zb, h, d, cut);
    const ta = thickAt(za, d, cut);
    const tb = thickAt(zb, d, cut);
    const yL0 = ya0 - hw * grade;
    const yR0 = ya0 + hw * grade;
    const yL1 = yb0 - hw * grade;
    const yR1 = yb0 + hw * grade;
    hulls.push(
      new Float32Array([
        -hw, yL0, za,
         hw, yR0, za,
        -hw, yL0 - ta, za,
         hw, yR0 - ta, za,
        -hw, yL1, zb,
         hw, yR1, zb,
        -hw, yL1 - tb, zb,
         hw, yR1 - tb, zb,
      ]),
    );
  }
  return hulls;
}
