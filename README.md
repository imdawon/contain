# CONTAIN

Live 16:9 **setup-then-watch** destruction bay. Graphic / toy. Video-game physics, not MATLAB.

This file is the **living axiom list**. Axioms are product rules that still matter after a compact. Implementation facts (tick rates, file maps, current spawn list, API dumps) do **not** get a number.

---

## What this is

You place objects, then let them play. BeamNG energy: one setup, one run, a readable ending.

**Now (v0):** dummy + crate + **grenade** + **vs runs** (same victim, one knob ticks up). Phone pack still spawnable as a fire.

**Not yet:** cars, ramps, shields, film chrome.

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
13. **A clip is a level.** Named arrangement of parts. Reset restages that clip. Save keeps a gag.
14. **A run is a bet.** Same victim. One variable. Premise on screen. Early rungs can fail. Next is the only loop.

---

## v0 proof (what “works” means)

- Default stage: **Grenades vs Dummy lv 1** — one grenade far enough that the dummy stays a T-statue.
- **PULL PIN** arms every grenade. Fuse → `grenade-boom`. Lv 1–3 miss. Lv 4 at the feet flops.
- **Next** restages lv+1 with more bangs / closer range. Same dummy.
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
| `src/store/bay-store.ts` | Spawn/select/tool/latch/clip |
| `src/lib/bay/level.ts` | Builtin gags + saved clips |
| `src/lib/bay/run.ts` | vs ladders (grenades vs dummy, dummy vs cover) |
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

1. Read the overlay: **N GRENADES vs 1 DUMMY**. That is the bet.
2. **PULL PIN**. Watch whether the dummy stays up. **Next** (or `N`) is the next rung.
3. Pick **Dummy vs Cover** to tick armor instead of grenade count. Gags (Pin-pull, Shoes, …) are still under Run.
4. **Grab** a part to cheat the setup. **Save** keeps a layout. **Reset** restages this rung.

---

## Later (not v0)

Shields (cardboard, plastic, hood, bolted riot). Multiple pack sizes. Film chrome.
