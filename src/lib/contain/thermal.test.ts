import assert from "node:assert/strict";
import { test } from "node:test";
import { runUntilEnd } from "./thermal";

const cases = [
  ["nmc", "steel", "jet"],
  ["nmc", "plastic", "burst"],
  ["nmc", "cardboard", "ignited"],
  ["lfp", "steel", "contained"],
  ["lfp", "plastic", "breached"],
  ["lfp", "cardboard", "contained"],
] as const;

for (const [chem, mat, expect] of cases) {
  test(`${chem} in ${mat} → ${expect}`, () => {
    const s = runUntilEnd(chem, mat);
    assert.equal(s.verdict, expect, `${chem}/${mat} got ${s.verdict} at t=${s.t.toFixed(1)} cell=${s.cellC.toFixed(0)} box=${s.boxC.toFixed(0)} kPa=${s.kPa.toFixed(0)}`);
  });
}
