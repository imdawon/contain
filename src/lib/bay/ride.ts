/**
 * A nade locked onto the same wagon as the dummy is a carried charge.
 * Floor vs-runs still use planar range (dummy.tsx / blast.ts). This module
 * is only the ride: the seat holds him unless he is in the hang.
 */
const held = new Set<string>();
let peakY = 0;

export function holdRide(dummyId: string) {
  held.add(dummyId);
}

export function resetRide() {
  held.clear();
  peakY = 0;
}

export function onRide(dummyId: string) {
  return held.has(dummyId);
}

export function noteRideY(y: number) {
  if (y > peakY) peakY = y;
}

export function ridePeakY() {
  return peakY;
}

/**
 * Hang: already high, vertical speed dying, still near this ride's hips peak.
 * Climbing hard (tight) or falling back into the seat (miss) stays together.
 */
export function carriedHang(y: number, vy: number, peak = peakY) {
  if (peak < 8 || y < 8.8) return false;
  if (vy >= 5.5) return false;
  if (vy <= 1.25) return false;
  return y / peak >= 0.9;
}
