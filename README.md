# CONTAIN

Live 16:9 **setup-then-watch** destruction bay. Graphic / toy. Video-game physics, not MATLAB.

This file is the **living axiom list**. If a rule matters after a compact, it belongs here. New major rules get a numbered axiom, not a chat recap.

---

## What this is

You place objects, then let them play. BeamNG energy: one setup, one run, a readable ending.

**Now (v0):** one hinged ammo can + one battery pack. Grab, throw, puncture. Latch shears before the hinge.

**Not yet:** dummies, grass, shields, crowds, multiple chemistries, film chrome.

---

## Axioms

1. **Clip machine, not a lab dashboard.** HUD stays thin. The 3D stage is the product.
2. **Setup, then watch.** Full spawn / grab. No cutscene that plays itself without the player staging it.
3. **Live play, 16:9.** You operate the camera. Orbit empty floor, or **track any object / sub-object**. Not auto-run shorts yet.
4. **Graphic / toy, not photoreal.** Flat color, grid, readable silhouettes. No tiny objects lost on a huge floor.
5. **Video-game physics.** The live bay is **Rapier** (`@react-three/rapier`), not Box3D. `box3d-wasm` is leftover from the old chamber and does not drive the stage. Parts have mass, a hinge axis, angle limits, and break numbers. Not FEA, not electrochemical accuracy.
6. **Parts are the unit.** A can is not one mesh. It is **body + lid + latch + hinge**, each with mass / range / tolerance.
7. **Latch fails before hinge.** Phone NMC cook should pop the front latch (`HINGED`). Only a much bigger dump shears the pin (`FREE`). Thresholds live in `src/lib/bay/parts.ts`.
8. **Thermal is juice + force.** Cook timer → fire sprites + accumulated “gas” + impulses. If a pack is inside the can AABB, that gas loads the lid.
9. **Leaving frame is allowed.** Debris, lids, and even the whole can may fly out of view. That is a valid clip. If you still want the shot, **track the part** — do not glue the world to the camera.
10. **Camera can track any registered part.** Assemblies are collections of bodies and points, not one mesh. A can exposes `body`, `lid`, `hinge`, `latch`. Track any of them (UI **Track**, or `window.__bay.track(id)`). Orbit still works around the tracked target. `snapshot().trackId` is the current follow.
11. **Never `useFrame(fn, priority > 0)`.** In R3F that steals the render loop and you get a blank canvas. Shake/VFX stay at default priority.
12. **Probe, don’t screenshot (agent axiom).** Do not use screenshots as the source of truth for physics, latch state, or “did the lid move.” Query the live stream:

    ```js
    window.__bay.snapshot()  // camera, objects xyz/rot/vel/mass, inView[], latch, selected, trackId
    window.__bay.log()       // event stream: puncture, latch-break, hinge-break, spawn, reset, set-prop
    window.__bay.dump()      // JSON string of the last snapshot
    window.__bay.track(id)   // follow a part, or track(null) for free orbit
    window.__bay.cutaway()   // toggle x-ray on the camera-facing can wall
    window.__bay.apply(id, { x, y, z, vx, vy, vz, mass, friction, restitution })
    ```

    **What the camera sees** = `snapshot().inView` (ids whose bounds intersect the active camera frustum).

    **Where everything is** = `snapshot().objects[]` with `x,y,z,rx,ry,rz,vx,vy,vz,mass,friction,restitution` plus `state` (cook phase, kW, latch, pressure). `editable` is true when the part is a real rigid body (body, lid, pack) — hinge/latch are sample points.

    Playwright / agent check:

    ```js
    await page.evaluate(() => window.__bay.dump())
    ```

    Screenshots are optional garnish for layout only. If a claim is about motion or state, it must be backed by `__bay`.
13. **Document every new major axiom in this file** the same turn it is invented. Compact recovery starts here, not in chat.
14. **Phone NMC is a fire, not a charge.** Thermal runaway vents, flames, and can pop a cheap latch. It does **not** apply a world blast and must **not** loft an 8 kg steel can into a 60 s ballistic arc. Latch-break is lid torque only. World `bay-blast` is reserved for actual explosives later. Thresholds: `src/lib/bay/parts.ts`.
15. **Inspector is live and writable.** The HUD shows the tracked object (else selected): **position** (meters), **velocity** (m/s), **mass** (kg), **grip** (friction), **bounce** (restitution). No Greek, no `vx`/`μ`/`e`. Edit a field and it commits on blur / Enter via `window.__bay.apply`. Hinge/latch points are read-only.
16. **Ground is a pad, not a postage stamp.** Infinite shader grid (1 m cells, 10 m sections) plus a 400 m floor collider. Camera far plane and fog cover that pad. Debris may leave the shot; it should still have ground under it unless you throw it hundreds of meters.
17. **Lighting exists to read height.** Key + cool fill + warm rim, contact shadows, and distance fog. If an object is airborne, its contact blob and the grid under it should make that obvious — not a flat gray soup.
18. **Commit when the bay actually moved.** After a verified slice of progress, `git commit` the same turn. Do not wait for “the whole sim is done.” Compact recovery is this README plus git, not a chat recap. The message says what the bay does now (phone cook pops the latch, inspector edits mass, …), not a file list. Do not commit a blank canvas or a known-broken probe; if it is only a save-point, say so in the message.
19. **Grab keeps its depth.** Pointer-down stores the click distance and the offset from the body. Drag slides on that depth; scroll pushes / pulls. Never snap the body to a point 1.4 m in front of the camera.
20. **The can is sealed until you ask.** Walls are opaque steel. **X-ray** (button, or key `X`) ghosts only the wall facing the camera so you can see inside. Orbit and the ghosted face follows. Off = fully sealed. The lid popping is still the physical open.
21. **Collider kit is how we test the sim.** Spawn platonic / primitive solids (cube, ball, cylinder, capsule, tetra, octa, dodeca, ico, plank) from **Solid**. Cube/plank = cuboid, ball = sphere, cylinder/capsule = native, the four platonic meshes = convex hull. Stack, tumble, throw. Not scenery.
22. **A 30-second pose ring buffer is next, not now.** When we debug lid jitter, sample the tracked body every tick into a last-30s log on `window.__bay`. Do not build it until a twitch needs a timeline.

---

## v0 proof (what “works” means)

- Pack starts **in** the can. Badge **SEALED**.
- **PUNCTURE** (pack selected) → cook → fire.
- Event `latch-break` fires. Badge **HINGED**. Lid `y` and/or `rx` change vs the pre-break sample.
- Hinge still exists until pressure hits `CAN.hinge` (phone run should not).
- Tracking `can0-lid` or `can0-hinge` moves `snapshot().camera` look toward that part.
- After a phone cook, `can0` body **y stays on the pad** (about `0.25`, under `1.0` at t+6s). `vy` near 0. Not still falling a minute later.
- Inspector shows that body’s xyz / mass; `apply({ y: 2 })` lifts it, then gravity brings it back.

---

## Layout (code)

| Path | Role |
| --- | --- |
| `README.md` | This axiom list |
| `src/lib/bay/parts.ts` | Masses, latch/hinge numbers, sizes |
| `src/lib/bay/cook.ts` | Pack cook phases |
| `src/lib/bay/probe.ts` | State stream (`window.__bay`) |
| `src/components/bay/ammo-can.tsx` | Body + lid + revolute hinge + breakable fixed latch |
| `src/components/bay/pack.tsx` | Grabbable pack, puncture, fire |
| `src/components/bay/probe-tick.tsx` | Camera frustum + per-frame snapshot |
| `src/store/bay-store.ts` | Spawn/select/tool/latch |
| `src/components/contain/inspector.tsx` | Live xyz / mass / grip / bounce editor for the tracked body |
| `src/lib/bay/solids.ts` | Collider-kit shapes |
| `src/components/bay/solid.tsx` | Spawnable cube / ball / cylinder / capsule / platonic hulls / plank |

---

## How to play v0

1. Orbit-drag empty floor, or **Track** a part (body / lid / hinge / latch / pack). Inspector follows that part.
2. **Grab** a part: it stays where it is, then follows the mouse at that depth. Scroll to push or pull. **X-ray** (or `X`) ghosts the wall you are looking at. **Solid** drops a cube / ball / hull beside the can for stacking tests.
3. Click the pack (**PUNCTURE** enables when a pack is selected).
4. **PUNCTURE**. Latch badge: sealed → hinged. The can stays on the pad; the lid hinges open. Track the lid if you want the shot.
5. **Reset** to restage.

---

## Later (not v0)

Explosives vs shields (cardboard, plastic, hood, bolted riot shield) and a crash dummy. Flammable props (dry grass). Multiple pack sizes. A 30-second pose ring buffer on the tracked body (`window.__bay.history`) for lid-jitter. Same axioms: parts, break numbers, setup-then-watch, probe the log.
