import assert from "node:assert/strict";
import { test } from "node:test";
import { applySteelHits, makeSteelShell, steelGeometry, steelMeshRim, steelRim } from "./yield.ts";

test("a front hit caves the live rim, including inverted Rapier normals", () => {
  for (const nz of [1, -1]) {
    const shell = makeSteelShell("wheel");
    const r0 = steelRim(shell);
    const geo = steelGeometry(shell);
    applySteelHits(shell, [{ x: 0, y: 0, z: shell.radius, nx: 0, ny: 0, nz, impulse: 40 }]);
    const r1 = steelRim(shell);
    const mesh = steelMeshRim(geo, shell);
    assert.ok(r1 < r0 - 0.01, `nz=${nz} rim ${r0.toFixed(3)} → ${r1.toFixed(3)}`);
    assert.equal(mesh, r1, `nz=${nz} GPU buffer lagged live verts`);
    assert.ok(shell.maxTaken > 0.01, `nz=${nz} maxTaken ${shell.maxTaken}`);
  }
});

test("a drum side hit caves the wall inward", () => {
  const shell = makeSteelShell("drum");
  const r0 = steelRim(shell);
  applySteelHits(shell, [{ x: shell.radius, y: 0, z: 0, nx: -1, ny: 0, nz: 0, impulse: 20 }]);
  assert.ok(steelRim(shell) < r0 - 0.06, `drum rim ${r0.toFixed(3)} → ${steelRim(shell).toFixed(3)}`);
});
