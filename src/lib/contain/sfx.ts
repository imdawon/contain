/** Shared audio numbers. Live Web Audio, tape mux, and tests all read this table. Not a SoundManager. */
export const SFX = {
  sr: 44100,
  roll: { dead: 0.35, full: 36, hiss: 0.04, tone: 0.07, lp: 0.03, liveHiss: 0.01, liveRoar: 0.26 },
  hit: { minImpulse: 0.01, minClosing: 0.5, slamClosing: 8, refImpulse: 800, refClosing: 14, debounceMs: 70, max: 80 },
  bang: { dur: 0.24, durTap: 0.07, f0: 32, f1: 54, fTap: 92, fTapHi: 170, noise: 0.04, gain: 0.42 },
} as const;

export type ContactStamp = {
  tMs: number;
  impulse?: number;
  closing?: number;
  otherMass?: number;
};

/** Roll rumble only with speed AND a surface. Air is silence. */
export function rollGain(speed: number, grounded = true, roll = SFX.roll): number {
  if (!grounded) return 0;
  if (!(speed > roll.dead)) return 0;
  const span = Math.max(0.01, roll.full - roll.dead);
  return Math.min(1, (speed - roll.dead) / span);
}

/** 0..1 how hard the tap is. Closing speed is the driver; impulse is a floor. */
export function hitAmount(impulse: number, closing: number, hit = SFX.hit): number {
  if (!(impulse >= hit.minImpulse) || !(closing >= hit.minClosing)) return 0;
  const fromClose = Math.log1p(closing) / Math.log1p(hit.refClosing);
  const fromJ = Math.log1p(impulse / Math.max(1e-6, hit.refImpulse)) / Math.log1p(8);
  return Math.min(1, Math.max(0.12, fromClose * 0.75 + fromJ * 0.25));
}

/** Loudness is compressed. Harder hits go lower and longer, not 10× louder. */
export function hitVoice(impulse: number, closing: number, sfx = SFX) {
  const k = hitAmount(impulse, closing, sfx.hit);
  if (k <= 0) return null;
  const { bang } = sfx;
  return {
    k,
    dur: bang.durTap + (bang.dur - bang.durTap) * k,
    f0: bang.fTap + (bang.f0 - bang.fTap) * k,
    f1: bang.fTapHi + (bang.f1 - bang.fTapHi) * k,
    gain: bang.gain * (0.4 + 0.6 * k),
    noise: bang.noise * (0.4 + 0.6 * k),
  };
}

export function hitGain(impulse: number, closing: number): number {
  const v = hitVoice(impulse, closing);
  return v ? v.gain / SFX.bang.gain : 0;
}

export function contactAudible(impulse: number, closing: number, _otherMass?: number, hit = SFX.hit): boolean {
  return impulse >= hit.minImpulse && closing >= hit.minClosing;
}

/** Offline PCM. pass grounded[] (30 Hz) so air has no rumble. */
export function fillScore(
  durationSec: number,
  speedHz: number[],
  contacts: ContactStamp[],
  grounded?: Array<boolean | number>,
  sfx = SFX,
): Float32Array {
  const sr = sfx.sr;
  const n = Math.max(1, Math.floor(sr * Math.max(0.05, durationSec)));
  const samples = new Float32Array(n);
  const speeds = Array.isArray(speedHz) ? speedHz : [];
  const ground = Array.isArray(grounded) ? grounded : null;
  let lp = 0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const fi = t * 30;
    const i0 = Math.min(Math.max(speeds.length - 1, 0), Math.max(0, Math.floor(fi)));
    const i1 = Math.min(Math.max(speeds.length - 1, 0), i0 + 1);
    const u = fi - Math.floor(fi);
    const s0 = speeds[i0] ?? 0;
    const s1 = speeds[i1] ?? s0;
    const speed = s0 * (1 - u) + s1 * u;
    const on = ground ? Boolean(ground[Math.min(ground.length - 1, Math.max(0, Math.round(fi)))] ?? ground[i0] ?? 0) : true;
    const g = rollGain(speed, on, sfx.roll);
    if (g <= 0) {
      lp *= 0.88;
      continue;
    }
    const noise = Math.random() * 2 - 1;
    lp += sfx.roll.lp * (noise - lp);
    ph += (2 * Math.PI * (18 + 10 * g)) / sr;
    samples[i] = (lp * sfx.roll.hiss + Math.sin(ph) * sfx.roll.tone) * g;
  }
  const hits = Array.isArray(contacts) ? contacts : [];
  const cap = sfx.hit.max;
  let lastMs = -1e9;
  for (let h = 0; h < hits.length && h < cap; h++) {
    const c = hits[h]!;
    const voice = hitVoice(Number(c.impulse) || 0, Number(c.closing) || 0, sfx);
    if (!voice) continue;
    const tMs = Number(c.tMs) || 0;
    if (tMs - lastMs < sfx.hit.debounceMs) continue;
    lastMs = tMs;
    const t0 = Math.max(0, Math.min(n - 2, Math.floor((tMs / 1000) * sr)));
    const span = Math.floor(sr * voice.dur);
    for (let i = 0; i < span && t0 + i < n; i++) {
      const tt = i / sr;
      const env = Math.exp(-tt / (voice.dur * 0.38));
      const bang =
        Math.sin(2 * Math.PI * voice.f0 * tt) * 0.82 +
        Math.sin(2 * Math.PI * voice.f1 * tt) * 0.18 +
        (Math.random() * 2 - 1) * voice.noise;
      samples[t0 + i] = Math.max(-1, Math.min(1, samples[t0 + i]! + bang * env * voice.gain));
    }
  }
  return samples;
}
