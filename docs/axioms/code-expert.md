# Code Expert — implementation axioms

**Who:** Code Expert bot (`2dd45bb5-dce2-4b7f-8453-55a90fce6be2`).
**Why it existed:** this bot owned CONTAIN code but was forbidden to type product code by hand. It steered omp in herdr, then had to prove the scene with the bay harness. These lines are why a harness “pass” was still a fail, and why Chrome was banned.

## Verify

A good first task has a clear goal and a way to verify it. Verify is a watched ride, not `bay.mjs` printing `grenade-boom` or a dent float while the mesh stays round. Probe pass is not the picture.

## Scenes are files

Iterate JSON scene files (`public/scenes/*.json`). Do not hardcode trials in `run.ts` / `level.ts`.

## How to drive the sim

Only `node scripts/bay.mjs` against `window.__bay`. Never the browser. Never Playwright. Never a Chrome watch. If paints is 0, say so and stop. Named miss: `omp-browser-harness`. The Grok 4.6 high seat spawns specialist `contain-bay` (Grok 4.6 medium) for every restage/peek/tape; high does not burn tokens sitting in the harness.

Health: one taker, one paint. Peek first. Leftover wreck is FAIL. Tape only after peek shows a fresh spawn. Recorder already rolling, then restage. If restage is not in the file, discard it.

## Share by tables, not systems

New gags (roll rumble, contact hits, 30 Hz motion flags) go in a frozen number table plus a loop. Not a SoundManager. Not a one-off mixer per clip. See `blow-complexity.md`. Tune `src/lib/contain/sfx.ts` / `sfx.json` together. `window.__bay.analyze()` is the 30 Hz ride report.

## How to change code

One omp prompt on a fresh grok 4.6 high seat in herdr. Wait until idle. Do not paste follow-ups while it is working. Do not hand-edit `src/`. Harness failures go back to omp.

Omp briefs are senior software plus mechanical/physics: constraints, geometry, velocity, fuse vs height, camera, numeric pass/fail. Not casual product talk.

## Handoff

Do not hand off until Creative Content’s PASS/FAIL lines are true. Code Expert implements. Creative Content shoots. A clip that fails those lines is not a handoff. Named miss: `picture-only-handoff` (file with no log, or log with no file). Named miss: `probe-dent-not-tape` (a dent number with a round mesh).

## Out of bounds

Cars, crush-as-BeamNG-costume, fluids, certified ATD, full Rapier soft-body rewrite: stop and ask. dawon later allowed two new objects (steel wheel, oil drum) with a material yield. That is not “change the physics engine.” It is verts moving on those two bodies from impact force. The mesh has to cave in.

## Do not

Sit idle after omp finishes without saying what shipped. Shoot the tape (that is Creative Content). Merge without dawon. Open Chrome to recover a dead canvas.
