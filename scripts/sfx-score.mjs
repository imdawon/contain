/** Offline score for JPEG tapes. Numbers live in src/lib/contain/sfx.json (must match sfx.ts). */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SFX = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/lib/contain/sfx.json"), "utf8"));

function rollGain(speed, grounded = true, roll = SFX.roll) {
  if (!grounded) return 0;
  if (!(speed > roll.dead)) return 0;
  const span = Math.max(0.01, roll.full - roll.dead);
  return Math.min(1, (speed - roll.dead) / span);
}

function hitAmount(impulse, closing, hit = SFX.hit) {
  if (!(impulse >= hit.minImpulse) || !(closing >= hit.minClosing)) return 0;
  const fromClose = Math.log1p(closing) / Math.log1p(hit.refClosing);
  const fromJ = Math.log1p(impulse / Math.max(1e-6, hit.refImpulse)) / Math.log1p(8);
  return Math.min(1, Math.max(0.12, fromClose * 0.75 + fromJ * 0.25));
}

function hitVoice(impulse, closing, sfx = SFX) {
  const k = hitAmount(impulse, closing, sfx.hit);
  if (k <= 0) return null;
  const bang = sfx.bang;
  return {
    k,
    dur: bang.durTap + (bang.dur - bang.durTap) * k,
    f0: bang.fTap + (bang.f0 - bang.fTap) * k,
    f1: bang.fTapHi + (bang.f1 - bang.fTapHi) * k,
    gain: bang.gain * (0.4 + 0.6 * k),
    noise: bang.noise * (0.4 + 0.6 * k),
  };
}

export function fillScore(durationSec, speedHz, contacts, grounded, sfx = SFX) {
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
    const c = hits[h];
    const voice = hitVoice(Number(c?.impulse) || 0, Number(c?.closing) || 0, sfx);
    if (!voice) continue;
    const tMs = Number(c.tMs) || 0;
    if (tMs - lastMs < sfx.hit.debounceMs) continue;
    lastMs = tMs;
    const t0 = Math.max(0, Math.min(n - 2, Math.floor((tMs / 1000) * sr)));
    const span = Math.floor(sr * voice.dur);
    for (let i = 0; i < span && t0 + i < n; i++) {
      const tt = i / sr;
      const env = Math.exp(-tt / (voice.dur * 0.38));
      const bang = Math.sin(2 * Math.PI * voice.f0 * tt) * 0.82 + Math.sin(2 * Math.PI * voice.f1 * tt) * 0.18 + (Math.random() * 2 - 1) * voice.noise;
      samples[t0 + i] = Math.max(-1, Math.min(1, samples[t0 + i] + bang * env * voice.gain));
    }
  }
  return samples;
}

export function writeScoreWav(path, durationSec, speedHz, contacts, grounded) {
  const samples = fillScore(durationSec, speedHz, contacts, grounded);
  const n = samples.length;
  const sr = SFX.sr;
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(sr, 24);
  pcm.writeUInt32LE(sr * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  writeFileSync(path, pcm);
  return { n, sr, silent: !speedHz?.length && !contacts?.length };
}
