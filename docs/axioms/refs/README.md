# Axiom source clips

Dawon dropped these on 2026-08-28 as the pictures the watch/shorts axioms were distilled from. They are **taste sources**, not assets. Do not rip cars, BeamNG maps, series logos, or a `SURVIVAL CHANCE` HUD into CONTAIN. Cast stays dummy / coil / drums.

Full mp4s live on disk (gitignored, ~97 MB). Stills are under `frames/` so a session can watch without decoding video. Served at `http://192.168.1.5:8090/axioms/`.

| File | Source | Size | What it is |
|---|---|---|---|
| `which-series-container-ramp.mp4` | `/tmp/87EC67BA-25C4-4B32-95B0-0936919A3C71.MP4` | 69.5s · 720×1280 · 30fps · 15.3 MB | Six-series jump off a container tower |
| `speed-highway-waves.mp4` | `/tmp/101E3C79-84FC-4D19-80FB-45640F119C70.MP4` | 48.9s · 720×1280 · 30fps · 14.2 MB | One car vs a wave highway; speed is the score |
| `which-vehicles-survive.mp4` | `/tmp/95245A23-2CCE-4EB0-ADAD-A9EAD4D44531.MP4` | 60.1s · 1080×1920 · 60fps · 67.9 MB | “Which of these vehicles can survive” ladder |

md5: `73d6b3283a43252e67125570746ffe42` / `75bd959381950e877d7e953899377b1f` / `6711f70853d2253bd1679eabfc411503`.

---

## which-series-container-ramp

Hook is a comparison you can see without a sentence: six circular series chips across the top (NASCAR, DTM, WEC, Nürburgring, MotoGP, Porsche Carrera Cup). Green ring = current / still in. Red ring = already paid.

Beats watched:

- t0 chase, red stock car, giant pillar dead ahead, big **NA**
- t3 airborne off the container ramp (McQueen #95)
- t6 low hero up-shot, one wheel off the lip, wreck not started
- t10 chase on a bridge, yawed, barrier coming
- t16 inverted DTM car falling off the stack
- t22 / t40 more airborne GT cars, camera below then chase
- t50 MotoGP down the container ramp
- t68 linger: orange Porsche driving a coastal bridge, no cut on a hit

Steal: remaining-count as a game, camera that **changes with the beat** (chase → low hero at apex → high look-down on the fall). Do not steal the cars or the logo row.

## speed-highway-waves

One lime Audi-like car, rhythmic full-width road waves, overcast highway into a tunnel. Overlay is a single climbing number: **20 → 40 → 80 → 100 → 150 → 200 → 250**. That number is the sport.

Beats watched:

- t0–t1 chase, car lined up on the waves, **20**
- t3 airborne nose-down off a crest, still **20**
- t6 high look-down, already crumpled, **40**
- t10 chase, planted on the undulations, **80**
- t16 inverted airborne, **100**
- t22 intact again at speed, **150** (reset / another stretch)
- t30 high look-down, rollover over the guardrail, **200**
- t38 wreck wedged on the rail, **250**, linger
- t46 no overlay, wreck buried in trees

Steal: one readable number that moves every beat, chase that **hunts the wreck** (drops low, climbs high, swings to the rail). Do not steal the car or the speed-as-km/h HUD.

## which-vehicles-survive

This is the clip `creative-content-watch.md` was told not to copy HUD from. Opening card: **WHICH OF THESE** then **VEHICLES CAN SURVIVE**. Each attempt is a named contestant plus **SURVIVAL CHANCE: n%**.

Beats watched:

- t0 jet on a steep climb, “WHICH OF THESE”
- t1 empty hill, chevrons, “VEHICLES CAN SURVIVE”
- t6–t10 MiG-29 jet, **100%**, chase down the drop / through a truss
- t16 Gallardo, **100%**, chase down the same hill
- t22 Gallardo smashed in the bridge V, **0%**, close crash cam
- t30 dump truck, **98%**
- t40–t50 rally truck **100% → 96%**, chase on the cliff road
- t59 linger, rally truck still on the road, **88%**, no CTA

Steal: a question they cannot leave, a named next attempt already lining up, pay each try (100% → 0% is a joke you can feel). Do not steal `SURVIVAL CHANCE`, the cars, or the jet.

---

## What CONTAIN should take (not copy)

From `creative-content-watch.md` / `creative-content-shorts.md`, these three actually do:

1. **The first frame is a question.** Series chips / a climbing number / “which of these.” Golf’s dummy in a cannon is a setup, not a question, unless the HUD or the opposing coil is already the bet.
2. **The score is readable without thinking.** Rings, a big number, or chance. CONTAIN’s **POINTS / JOINTS** is the right *kind* of overlay. It has to move during the middle, not only after the smash.
3. **Camera is a beat, not a lock.** Chase while they close, hero-up at the lip, look-down on the fall, crash-cam on the hit. Scene JSON should be able to list those beats (`eye` / `look` / `offset` / when to switch) without a code change.
4. **Pay, then the next try.** Isolated one-bang is a light going out. These clips stack attempts. One cannon hole can still do it if the dummy almost makes it, then joints go, then the coil lands.
5. **Cut on the hit.** Two of three linger. The axioms say cut. CONTAIN tapes should die on the wreck, not on a parked coil.

Turbo Dismount’s fun that maps here: toy ragdoll, a score you root for, a camera that sells the height and the snap. The dummy is that toy. The 100 t coil is the joke. Do not turn CONTAIN into BeamNG with a fake chance bar.
