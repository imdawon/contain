import assert from "node:assert/strict";
import { test } from "node:test";
import { SFX, contactAudible, fillScore, hitVoice, rollGain } from "./sfx.ts";

test("roll is silent at and below the dead zone", () => {
  assert.equal(rollGain(0), 0);
  assert.equal(rollGain(SFX.roll.dead), 0);
  assert.ok(rollGain(SFX.roll.dead + 0.01) > 0);
  assert.equal(rollGain(SFX.roll.full), 1);
  assert.equal(rollGain(SFX.roll.full + 40), 1);
});

test("airborne roll is silence even at full speed", () => {
  assert.equal(rollGain(40, false), 0);
  assert.ok(rollGain(40, true) > 0);
});

test("hits need impulse AND closing — rolling scrape is not a tap", () => {
  assert.equal(contactAudible(1e6, SFX.hit.minClosing * 0.5), false);
  assert.equal(contactAudible(SFX.hit.minImpulse * 0.25, 20), false);
  assert.equal(contactAudible(SFX.hit.minImpulse, SFX.hit.minClosing), true);
});

test("a harder slam is lower and longer, not just louder", () => {
  const tap = hitVoice(2, 2)!;
  const slam = hitVoice(800, 14)!;
  assert.ok(slam.f0 < tap.f0 - 20, `slam ${slam.f0} vs tap ${tap.f0}`);
  assert.ok(slam.dur > tap.dur + 0.05, `slam dur ${slam.dur} vs ${tap.dur}`);
  assert.ok(slam.gain / tap.gain < 3, `gain ratio ${slam.gain / tap.gain}`);
});

test("score with no speed and no contacts is silence, not a noise bed", () => {
  const pcm = fillScore(1, [], []);
  let peak = 0;
  for (const s of pcm) peak = Math.max(peak, Math.abs(s));
  assert.equal(peak, 0);
});

test("a slam stamps near its timestamp; rest stays quiet without speed", () => {
  const pcm = fillScore(1, [], [{ tMs: 200, impulse: SFX.hit.refImpulse, closing: SFX.hit.refClosing }]);
  const sr = SFX.sr;
  const at = Math.floor(0.2 * sr);
  const early = pcm.slice(0, Math.floor(0.05 * sr));
  let earlyPeak = 0;
  for (const s of early) earlyPeak = Math.max(earlyPeak, Math.abs(s));
  let slamPeak = 0;
  for (let i = at; i < at + Math.floor(0.03 * sr) && i < pcm.length; i++) slamPeak = Math.max(slamPeak, Math.abs(pcm[i] ?? 0));
  assert.ok(slamPeak > 0.05, `slam around 200ms was ${slamPeak}`);
  assert.ok(earlyPeak < 0.001, `pre-hit hiss ${earlyPeak}`);
});

test("airborne 30Hz speed series is silence", () => {
  const pcm = fillScore(1, Array(30).fill(20), [], Array(30).fill(false));
  let peak = 0;
  for (const s of pcm) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak < 1e-6, `air rumble ${peak}`);
});

test("speed below the dead zone is silence even with a 30Hz series", () => {
  const pcm = fillScore(1, Array(30).fill(SFX.roll.dead), []);
  let peak = 0;
  for (const s of pcm) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak < 1e-6, `dead-zone bed ${peak}`);
});

test("sfx.json stays in lockstep with SFX", async () => {
  const { readFileSync } = await import("node:fs");
  const file = JSON.parse(readFileSync(new URL("./sfx.json", import.meta.url), "utf8"));
  assert.deepEqual(file, JSON.parse(JSON.stringify(SFX)));
});
