# CONTAIN

Live hangar for toy destruction. Graphic, not MATLAB. Rigid bodies, joints, masses, break numbers.

You **stage**, then **Play**. Physics is frozen until Play. Reset restages the layout; it does not wipe it.

This file is the **living axiom list**. Axioms are product rules that still matter after a compact. Implementation facts (tick rates, file maps, spawn lists, API dumps) do **not** get a number.

---

## Controls

The hangar is an orbit camera around a tracked actor. It is not a locked chase cam and not a first-person game.

| Input | What it does |
| --- | --- |
| Drag empty stage | Orbit |
| Scroll | Dolly |
| **Track** | Sticky follow: camera *and* orbit target translate with that body. Empty = free orbit. Dummy default is **chest**. |
| **Studio** | Freeze. Pick a kit, click the floor to drop it (Shift: height of the camera). |
| RGB arrows | Screen-space move. Drag along the projected axis. Writes the RigidBody parent, never an inner mesh. |
| Hold **X** / **Y** / **Z** while grabbing | Lock that axis |
| **Grab** / **Nail** | Grab moves the whole assembly until the joints fail. Nail pins. |
| **Play** | Rapier starts. |
| **Reset** | Restage this clip / scene. |
| **Save** | Keep the arrangement as a named clip. |
| **Run** | vs ladders, JSON scenes, builtin gags. |
| **Next** / `N` | Next vs rung |
| **X-ray** / `X` | Ghost the wall facing the camera |
| **Slo-mo** / `S` | Quarter speed |
| **PULL PIN** / **PUNCTURE** | Arm grenades / cook a pack |

TrackCam only **translates** with the actor. Do not overwrite camera pose each frame — orbit dies. `OrbitControls` stay on while tracking. Restage snaps to the scene JSON camera.

---

## What this is

A **clip machine**. HUD stays thin. The 3D stage is the product.

Cast: dummy, wagon, grenade, pack, hill / ramp, cannon, steel wheel, drum, toy vehicles, crate, can, grass, wall, door, solids.

Clips are JSON (`public/scenes/`). Iterate the file. A **run** is a bet: same victim, one knob.

Live hangar fills the window. Tapes bake **9:16** (720×1280).

---

## Axioms

1. **Clip machine, not a lab dashboard.** HUD stays thin. The 3D stage is the product.
2. **Setup, then watch.** Frozen until Play. Full spawn / grab. No cutscene that plays itself without the player staging it.
3. **You operate the camera.** Orbit empty floor, or **track any object / sub-object**. Leaving frame is allowed. Do not glue the world to the camera.
4. **Graphic / toy, not photoreal.** Flat color, grid, readable silhouettes.
5. **Video-game physics.** Rigid bodies, joints, masses, break numbers. Not FEA, not electrochemical accuracy.
6. **Parts are the unit.** Assemblies (can, crate, dummy) are collections of bodies, not one mesh. Grab moves the whole assembly until the joints actually fail.
7. **Latch fails before hinge.** A phone cook pops the latch. Only a much bigger dump shears the pin.
8. **Thermal is juice + force.** Cook is an authored meter plus impulses. Phone NMC is a fire, not a charge: it must not loft a steel can. World blast is for actual explosives.
9. **Never `useFrame(fn, priority > 0)`.** That steals the R3F render loop and blanks the canvas.
10. **Proof is numbers and a picture from the same world.** Motion, latch, flop, dent, and cook claims come from `window.__bay` (`peek`, `history`, `effects`, `until`) **and** a shot JPEG of that tick. Peek xyz is not a picture.
11. **Only number major product rules.** Tick rates, file maps, spawn lists, and API dumps are facts. Do not add them as axioms.
12. **Commit when the bay actually moved.** Same turn as a verified slice. Message says what the bay does now.
13. **A clip is a level.** Named arrangement of parts. Reset restages that clip. Save keeps a gag. JSON scene files (`public/scenes/`) are the clips — iterate the file.
14. **A run is a bet.** Same victim. One variable. Premise on screen. Early rungs can fail. Next is the only loop.
15. **Cover is occlusion.** A crate, can, wall, or door on the line blocks that bone’s blast. Grass is not cover. Rapier will not occlude a scripted radial impulse by itself.

---

## Drive it

Human: the hangar on `:8080`.

Agents never open Chrome. `hangar.mjs` owns one painted page (`window.__bayOwned`). Talk to that world with `bay.mjs`:

```
node scripts/hangar.mjs start
node scripts/bay.mjs health          # wants takers>=1 paints>=1
node scripts/bay.mjs restage <scene>
node scripts/bay.mjs peek
node scripts/bay.mjs shot screenshots/foo.jpg
```

`paints: 0` is a second, headless Rapier world — blocked, not a pass. Named miss: `omp-browser-harness`.

Taste for takes: `docs/axioms/`. Distill the loop. Do not rip cars, maps, or a SURVIVAL CHANCE HUD from those refs.

---

## Layout (code)

| Path | Role |
| --- | --- |
| `README.md` | This axiom list + controls |
| `public/scenes/*.json` | Clips: layout, velocity, grip, ties, camera |
| `src/lib/bay/scene.ts` | JSON scene loader. Restage the file, do not hardcode a new trial. |
| `src/lib/bay/studio.ts` | Studio palette, place, patch, save |
| `src/components/contain/studio.tsx` | Studio panel |
| `src/components/bay/move-gizmo.tsx` | Screen-space RGB arrows |
| `src/components/bay/studio-place.tsx` | Click-floor drop |
| `src/components/bay/canvas.tsx` | R3F / Rapier world. TrackCam lives here. |
| `src/components/bay/look-cam.tsx` | Point-at-dummy helper for harness camera checks |
| `src/components/contain/lab-app.tsx` | Hangar chrome |
| `src/components/contain/inspector.tsx` | Live xyz / mass / grip for the tracked body |
| `src/store/bay-store.ts` | Spawn / select / tool / clip / playing |
| `src/lib/bay/harness.ts` | `window.__bay` command API |
| `scripts/hangar.mjs` | Vite + owned paint page |
| `scripts/bay.mjs` | POST `/__bay` → live `window.__bay` (no browser) |
| `src/lib/bay/parts.ts` | Masses, latch/hinge numbers, sizes |
| `src/lib/bay/actions.ts` | Puncture / spawn / reset without the DOM |
| `src/lib/bay/run.ts` | vs ladders |
| `src/lib/bay/level.ts` | Builtin gags + saved clips |
