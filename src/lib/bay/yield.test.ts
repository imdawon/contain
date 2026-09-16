import assert from "node:assert/strict";
import { test } from "node:test";
import { coilInertia } from "./parts.ts";
import { applyPanelHit, applySteelHits, clampPanelVerts, crumpleDrum, makeBoxPanel, makeSteelShell, steelExtents, steelGeometry, steelMeshRim, steelRim } from "./yield.ts";

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
  const junk = makeSteelShell("wheel");
  const r0 = steelRim(junk);
  applySteelHits(junk, [
    { x: 0, y: 0, z: junk.radius, nx: 0, ny: 0, nz: 1, impulse: 2_400, closing: 14, otherMass: 180 },
  ]);
  assert.equal(steelRim(junk), r0);
  assert.equal(junk.maxTaken, 0);

  const tick = makeSteelShell("wheel");
  applySteelHits(tick, [
    { x: 0, y: 0, z: tick.radius, nx: 0, ny: 0, nz: 1, impulse: 40_000, closing: 1.1, otherMass: Infinity },
  ]);
  assert.ok(tick.maxTaken > 0 && tick.maxTaken < 0.06, `pipe tick maxTaken ${tick.maxTaken}`);
});

test("five seconds of pipe roll bruises the coil without pancaking", () => {
  const shell = makeSteelShell("wheel");
  const r0 = steelRim(shell);
  const hits = [];
  for (let i = 0; i < 300; i++) {
    const a = (i / 300) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    hits.push({
      x: c * shell.radius,
      y: 0,
      z: s * shell.radius,
      nx: c,
      ny: 0,
      nz: s,
      impulse: 40_000,
      closing: 1.1,
      otherMass: Infinity,
    });
  }
  applySteelHits(shell, hits);
  const rimDrop = r0 - steelRim(shell);
  assert.ok(
    shell.maxTaken >= 0.08 || rimDrop >= 0.05,
    `roll bruise maxTaken ${shell.maxTaken} rimDrop ${rimDrop}`,
  );
  assert.ok(shell.maxTaken < 0.35, `pancake maxTaken ${shell.maxTaken}`);
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
  assert.ok(I.y > 90_000 && I.y < 150_000, `Iy ${I.y}`);
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

test("a 200 t-scale panel hit folds roof down with wrinkles, not a uniform shrink", () => {
  const shell = makeBoxPanel(1.1, 0.55, 1.8, 10);
  const added = applyPanelHit(shell, { x: 0, y: 0.2, z: 1.4 }, { x: 0, y: 0, z: 1 }, 8e5);
  assert.ok(added > 0.25, `added ${added}`);
  assert.ok(shell.maxTaken >= 0.25, `maxTaken ${shell.maxTaken}`);
  let roofDy = 0;
  let floorDy = 0;
  let nRoof = 0;
  let nFloor = 0;
  let zVar = 0;
  let n = 0;
  for (let i = 0; i < shell.dent.length; i++) {
    const o = i * 3;
    const ry = shell.rest[o + 1]!;
    const dy = shell.live[o + 1]! - ry;
    const dz = shell.live[o + 2]! - shell.rest[o + 2]!;
    zVar += dz * dz;
    n++;
    if (ry > 0.05) {
      roofDy += dy;
      nRoof++;
    }
    if (ry < -0.05) {
      floorDy += dy;
      nFloor++;
    }
  }
  const roofMean = roofDy / Math.max(1, nRoof);
  const floorMean = floorDy / Math.max(1, nFloor);
  assert.ok(roofMean < floorMean - 0.02, `roof ${roofMean} vs floor ${floorMean}`);
  assert.ok(zVar / n > 1e-4, `wrinkle variance ${zVar / n}`);
});

test("a miss that moves no verts does not inflate panel maxTaken", () => {
  const shell = makeBoxPanel(0.4, 0.2, 0.4, 8);
  shell.maxDent = 0.0002;
  for (let i = 0; i < shell.dent.length; i++) shell.dent[i] = 0.0002;
  applyPanelHit(shell, { x: 0, y: 0, z: 0.4 }, { x: 0, y: 0, z: 1 }, 8e5);
  assert.equal(shell.maxTaken, 0);
});

test("panel verts stay within 1.35× rest extents after a huge slam", () => {
  const shell = makeBoxPanel(1.2, 1.1, 1.0, 10);
  for (let k = 0; k < 8; k++) {
    applyPanelHit(shell, { x: 0, y: 0.8, z: 0.6 }, { x: 0.2, y: -1, z: 0.4 }, 8e5);
    applyPanelHit(shell, { x: 0.5, y: 0.4, z: -0.4 }, { x: 1, y: -0.4, z: 0.2 }, 8e5);
  }
  clampPanelVerts(shell);
  let mx = 0, my = 0, mz = 0, rx = 0, ry = 0, rz = 0;
  const n = shell.rest.length / 3;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    rx = Math.max(rx, Math.abs(shell.rest[o]!));
    ry = Math.max(ry, Math.abs(shell.rest[o + 1]!));
    rz = Math.max(rz, Math.abs(shell.rest[o + 2]!));
    mx = Math.max(mx, Math.abs(shell.live[o]!));
    my = Math.max(my, Math.abs(shell.live[o + 1]!));
    mz = Math.max(mz, Math.abs(shell.live[o + 2]!));
  }
  assert.ok(mx <= rx * 1.35 + 1e-6, `x ${mx} vs ${rx * 1.35}`);
  assert.ok(my <= ry * 1.35 + 1e-6, `y ${my} vs ${ry * 1.35}`);
  assert.ok(mz <= rz * 1.35 + 1e-6, `z ${mz} vs ${rz * 1.35}`);
  assert.ok(mx < 8 && my < 8 && mz < 8, `chase fill ${mx},${my},${mz}`);
});
