import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzePath, stats } from "./ride-stats.ts";

test("stats report mean median stdev", () => {
  const s = stats([1, 2, 3, 4, 5]);
  assert.equal(s?.mean, 3);
  assert.equal(s?.median, 3);
  assert.equal(s?.min, 1);
  assert.equal(s?.max, 5);
});

test("a smooth roll is clean; a teleport flags", () => {
  const path = [];
  for (let i = 0; i < 30; i++) {
    path.push({ t: i / 30, x: 0, y: 10 - i * 0.2, z: i, vx: 0, vy: -6, vz: 30 });
  }
  const ok = analyzePath("coil", path);
  assert.equal(ok.anomalies.length, 0);
  assert.ok((ok.speed?.mean ?? 0) > 20);

  path[20] = { ...path[20]!, x: 80, y: 4, z: 20 };
  const bad = analyzePath("coil", path);
  assert.ok(bad.anomalies.some((a) => a.kind === "teleport"));
});
