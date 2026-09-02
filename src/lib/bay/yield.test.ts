import assert from "node:assert/strict";
import { test } from "node:test";
import { coilInertia } from "./parts.ts";
import { applySteelHits, crumpleDrum, makeSteelShell, steelExtents, steelGeometry, steelMeshRim, steelRim } from "./yield.ts";

test("a hard slam caves the live rim, including inverted Rapier normals", () => {
  for (const nz of [1, -1]) {
    const shell = makeSteelShell("wheel");
    const r0 = steelRim(shell);
    const geo = steelGeometry(shell);
    applySteelHits(shell, [{ x: 0, y: 0, z: shell.radius, nx: 0, ny: 0, nz, impulse: 2_400_000, closing: 28, otherMass: Infinity }]);
    const r1 = steelRim(shell);
    const mesh = steelMeshRim(geo, shell);
    assert.ok(r1 < r0 - 0.002, `nz=${nz} rim ${r0.toFixed(3)} → ${r1.toFixed(3)}`);
    assert.equal(mesh, r1, `nz=${nz} GPU buffer lagged live verts`);
    assert.ok(shell.maxTaken > 0.002, `nz=${nz} maxTaken ${shell.maxTaken}`);
  }
});

test("rolling contact and a 55-gal hit leave the coil round", () => {
  const shell = makeSteelShell("wheel");
  const r0 = steelRim(shell);
  applySteelHits(shell, [
    { x: 0, y: 0, z: shell.radius, nx: 0, ny: 0, nz: 1, impulse: 40_000, closing: 1.1, otherMass: Infinity },
    { x: 0, y: 0, z: shell.radius, nx: 0, ny: 0, nz: 1, impulse: 2_400, closing: 14, otherMass: 180 },
  ]);
  assert.equal(steelRim(shell), r0);
  assert.equal(shell.maxTaken, 0);
});

test("a drum side hit caves the wall inward", () => {
  const shell = makeSteelShell("drum");
  const r0 = steelRim(shell);
  applySteelHits(shell, [{ x: shell.radius, y: 0, z: 0, nx: -1, ny: 0, nz: 0, impulse: 20 }]);
  assert.ok(steelRim(shell) < r0 - 0.06, `drum rim ${r0.toFixed(3)} → ${steelRim(shell).toFixed(3)}`);
});

test("a corner slam dents the rim edge, not only the mid-tread", () => {
  const shell = makeSteelShell("wheel");
  applySteelHits(shell, [
    {
      x: shell.radius,
      y: shell.halfH,
      z: 0,
      nx: 1,
      ny: 0.5,
      nz: 0,
      impulse: 2_400_000,
      closing: 28,
      otherMass: Infinity,
    },
  ]);
  let edge = 0;
  let mid = 0;
  const n = shell.dent.length;
  for (let i = 0; i < n; i++) {
    const y = shell.rest[i * 3 + 1]!;
    if (Math.abs(y) > shell.halfH * 0.78) edge = Math.max(edge, shell.dent[i]!);
    if (Math.abs(y) < shell.halfH * 0.18) mid = Math.max(mid, shell.dent[i]!);
  }
  assert.ok(edge > 0.01, `edge dent ${edge}`);
  assert.ok(edge > mid, `edge ${edge} should beat mid-tread ${mid}`);
});

test("a drum lid is a filled disk, not an open washer", () => {
  const shell = makeSteelShell("drum");
  let minR = shell.radius;
  for (let i = 0; i < shell.dent.length; i++) {
    const o = i * 3;
    if (Math.abs(shell.rest[o + 1]!) < shell.halfH * 0.95) continue;
    const r = Math.hypot(shell.rest[o]!, shell.rest[o + 2]!);
    if (r < minR) minR = r;
  }
  assert.ok(minR < 0.05, `lid inner ${minR}`);
});

test("a mid-tread slam also dents both rims at that azimuth", () => {
  const shell = makeSteelShell("wheel");
  applySteelHits(shell, [
    {
      x: 0,
      y: 0,
      z: shell.radius,
      nx: 0,
      ny: 0,
      nz: 1,
      impulse: 2_400_000,
      closing: 28,
      otherMass: Infinity,
    },
  ]);
  let edge = 0;
  let mid = 0;
  const n = shell.dent.length;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const y = shell.rest[o + 1]!;
    const z = shell.rest[o + 2]!;
    if (z < shell.radius * 0.7) continue;
    if (Math.abs(y) > shell.halfH * 0.78) edge = Math.max(edge, shell.dent[i]!);
    if (Math.abs(y) < shell.halfH * 0.18) mid = Math.max(mid, shell.dent[i]!);
  }
  assert.ok(mid > 0.01, `mid ${mid}`);
  assert.ok(edge > 0.008, `rim at same azimuth ${edge}`);
});

test("coilInertia is tonne-scale, not a 6 kg hull", () => {
  const I = coilInertia(100_000);
  assert.ok(I.y > 40_000 && I.y < 80_000, `Iy ${I.y}`);
  assert.ok(I.x > I.y * 4, `tumble Ix ${I.x} vs roll Iy ${I.y}`);
});

test("a tonne-scale hit flattens an empty drum into a thin steel pancake", () => {
  const shell = makeSteelShell("drum");
  const r0 = shell.radius;
  crumpleDrum(shell, {
    x: 0,
    y: 0,
    z: shell.radius,
    nx: 0,
    ny: 0,
    nz: 1,
    impulse: 8_000,
    closing: 12,
    otherMass: 1_000_000,
  });
  const ext = steelExtents(shell);
  assert.ok(ext.halfH < 0.08, `pancake height ${ext.halfH}`);
  assert.ok(ext.radius > r0 * 1.15, `splay ${ext.radius} vs ${r0}`);
});
