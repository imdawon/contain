# CONTAIN

Live 16:9 **setup-then-watch** destruction bay. Graphic / toy. Video-game physics, not MATLAB.

This file is the **living axiom list**. Axioms are product rules that still matter after a compact. Implementation facts (tick rates, file maps, current spawn list, API dumps) do **not** get a number.

---

## What this is

You place objects, then let them play. BeamNG energy: one setup, one run, a readable ending.

**Now (v0):** dummy + crate + **grenade** + spreading grass. Phone pack still spawnable as a fire. Latch shears before the hinge.

**Not yet:** shields, crowds, film chrome.

---

## Axioms

1. **Clip machine, not a lab dashboard.** HUD stays thin. The 3D stage is the product.
2. **Setup, then watch.** Full spawn / grab. No cutscene that plays itself without the player staging it.
3. **Live play, 16:9.** You operate the camera. Orbit empty floor, or **track any object / sub-object**. Leaving frame is allowed. Do not glue the world to the camera.
4. **Graphic / toy, not photoreal.** Flat color, grid, readable silhouettes.
5. **Video-game physics.** Rigid bodies, joints, masses, break numbers. Not FEA, not electrochemical accuracy.
6. **Parts are the unit.** Assemblies (can, crate, dummy) are collections of bodies, not one mesh. Grab moves the whole assembly until the joints actually fail.
7. **Latch fails before hinge.** A phone cook pops the latch. Only a much bigger dump shears the pin.
8. **Thermal is juice + force.** Cook is an authored meter plus impulses. Phone NMC is a fire, not a charge: it must not loft a steel can. World blast is for actual explosives.
9. **Never `useFrame(fn, priority > 0)`.** That steals the R3F render loop and blanks the canvas.
10. **Probe, don’t screenshot.** Motion, latch, flop, and cook claims come from `window.__bay` (`peek`, `history`, `effects`, `until`). Screenshots are optional garnish.
11. **Only number major product rules.** Tick rates, file maps, spawn lists, and API dumps are facts. Do not add them as axioms.
12. **Commit when the bay actually moved.** Same turn as a verified slice. Message says what the bay does now.

---

## v0 proof (what “works” means)

- Default stage: **crate + grenade inside + dummy in front + grass under the dummy**. Grenade selected.
- **PULL PIN** → `pin-pull` → `grenade-boom` → `crate-break`. Crate panels leave the weld. Dummy hips/head move (flop, not a rigid statue).
- Grass `burning` count rises (`grass-ignite`) from the blast heat.
- Phone pack still spawnable; it is a **fire**, not a charge, and must **not** loft an 8 kg can.

---

## Layout (code)

| Path | Role |
| --- | --- |
| `README.md` | This axiom list |
| `src/lib/bay/parts.ts` | Masses, latch/hinge numbers, sizes |
| `src/lib/bay/cook.ts` | Pack / grenade cook phases |
| `src/lib/bay/probe.ts` | State stream (`window.__bay`) |
| `src/components/bay/ammo-can.tsx` | Body + lid + revolute hinge + breakable fixed latch |
| `src/components/bay/pack.tsx` | Grabbable pack, puncture, fire |
| `src/components/bay/grenade.tsx` | Pin, fuse tick, bang, fragments |
| `src/components/bay/probe-tick.tsx` | Camera frustum + per-frame snapshot |
| `src/store/bay-store.ts` | Spawn/select/tool/latch |
| `src/components/contain/inspector.tsx` | Live xyz / mass / grip / bounce editor for the tracked body |
| `src/lib/bay/solids.ts` | Collider-kit shapes |
| `src/components/bay/solid.tsx` | Spawnable cube / ball / cylinder / capsule / platonic hulls / plank |
| `src/components/bay/dummy.tsx` | Ragdoll dummy |
| `src/components/bay/crate.tsx` | Welded crate that shears on blast |
| `src/components/bay/grass.tsx` | Spreading grass fire |
| `src/lib/bay/heat.ts` | Toy heat field |
| `src/lib/bay/harness.ts` | Agent command API + 30s history |
| `scripts/bay.mjs` | POST `/__bay` → live `window.__bay` (no browser) |
| `src/lib/bay/actions.ts` | Puncture / spawn / reset without the DOM |

---

## How to play v0

1. Orbit-drag empty floor, or **Track** a part (body / lid / hinge / latch / pack). Inspector follows that part.
2. **Grab** a part: it stays where it is, then follows the mouse at that depth. Scroll to push or pull. **X-ray** (or `X`) ghosts the wall you are looking at. **Solid** drops a cube / ball / hull beside the can for stacking tests.
3. Grenade starts selected. **PULL PIN**. Grass should catch. Crate should come apart. Dummy should flop.
4. Spawn **Can** / **Pack** if you still want the quiet phone gag.
5. **Reset** restages the clip.

---

## Later (not v0)

Shields (cardboard, plastic, hood, bolted riot). Multiple pack sizes. Film chrome.
