import assert from "node:assert/strict";
import { test } from "node:test";
import {
  armSnaps,
  dummyScore,
  isSnapped,
  resetInjury,
  sampleHinge,
  sampleImpact,
  SNAP_N,
  takeSnap,
} from "./atd.ts";

test("a neck load under the line does not snap", () => {
  resetInjury("d1");
  assert.equal(takeSnap("d1", "upper-neck", SNAP_N["upper-neck"] - 0.2), false);
  assert.equal(isSnapped("d1", "upper-neck"), false);
});

test("the first over-line load snaps once and pays the score", () => {
  resetInjury("d2");
  armSnaps("d2", -1);
  sampleHinge("d2", "upper-neck", 12);
  assert.equal(takeSnap("d2", "upper-neck", 12), true);
  assert.equal(takeSnap("d2", "upper-neck", 40), false);
  assert.equal(isSnapped("d2", "upper-neck"), true);
  const a = dummyScore("d2");
  assert.equal(a.snaps, 1);
  assert.ok(a.score >= 2800);
  sampleImpact("d2", 200_000);
  const b = dummyScore("d2");
  assert.ok(b.score > a.score);
  assert.ok(b.impact > 0);
});

test("armSnaps holds the first 0.4s", () => {
  resetInjury("d3");
  armSnaps("d3", 10);
  sampleHinge("d3", "upper-neck", 40);
  assert.equal(takeSnap("d3", "upper-neck", 40), false);
  assert.equal(isSnapped("d3", "upper-neck"), false);
});
