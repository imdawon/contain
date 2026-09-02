/**
 * Seat glue: dummy bones (or anything else) stay locked to a lead body
 * until the dummy is hurt. Hang is only a pose hint, not the unglue gate.
 */
const held = new Set<string>();
let peakY = 0;

export function holdRide(dummyId: string) {
  held.add(dummyId);
}

export function letGoRide(dummyId?: string) {
  if (dummyId) held.delete(dummyId);
  else held.clear();
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
