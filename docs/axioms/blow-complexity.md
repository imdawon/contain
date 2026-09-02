# Blow complexity — how CONTAIN shares code

**Who:** Jonathan Blow (Braid, The Witness, Jai). Distilled 2026-08-28 by the `researcher` agent from primary talks and notes, then applied to CONTAIN audio/physics logs.

**Why it is here:** dawon asked that new gags (roll rumble, contact hits, 30 Hz motion flags) not become one-offs *or* OOP soup. Blow is the named taste for that middle: tables of numbers and straight-line loops, not a SoundManager, not a new class per cue.

He did **not** publish an audio/physics coupling architecture. Do not invent Blow quotes about contact callbacks. Witness audio writeups are Andrew Lackey’s design, not a mixer spec. [Gamasutra / Game Developer](https://www.gamedeveloper.com/audio/the-minimalist-sound-design-of-i-the-witness-i-).

“Don’t abstract before you have three uses” is **Fowler’s Rule of Three**, not a Blow sentence. Blow’s wording: a generalized system is usually worse than a specific hard-coded one; two similar specifics can become one general later. [Berkeley 2011](http://the-witness.net/news/2011/06/how-to-program-independent-games/), [MagicalTimeBean notes](https://www.magicaltimebean.com/2011/07/the-specific-solution-thoughts-on-jonathan-blows-how-to-program-independent-games/).

## Axioms

1. **SPECIFIC-NOT-SYSTEM** — A generalized system is usually worse than a specific hard-coded one; adding a system is last resort; deleting code beats adding it. Do: hard-code the roll dead-zone, contact one-shot, and 30 Hz envelope as numbers used by the real consumers. Don’t: CueStrategy / IAudioEvent for cannon “someday.” Source: [Berkeley talk](http://the-witness.net/news/2011/06/how-to-program-independent-games/).

2. **ARRAY-OF-RECORDS** — Use arrays of records for nearly everything; fancy structures optimize seconds when you should optimize years. Do: one frozen table, loop it. Don’t: Map of class instances or an audio ECS. Source: [Berkeley notes](https://consideredharmful.tumblr.com/post/6834223902/summary-of-jonathan-blows-uc-berkeley-csua-talk).

3. **TWO-CONSUMERS** — Share when two real consumers already need the same numbers. Do: live Web Audio and ffmpeg mux read `SFX`. Don’t: a third abstraction layer before a third consumer exists. Source: [MagicalTimeBean on Blow](https://www.magicaltimebean.com/2011/07/the-specific-solution-thoughts-on-jonathan-blows-how-to-program-independent-games/) (not Fowler).

4. **DATA-LAYOUT-CONTRACT** — Member functions on shared types are anti-reuse; the contract is the data layout. Do: physics writes speed / impulse / contact; audio reads numbers. Don’t: `Wheel.playRoll()`. Source: [Witness language note](http://the-witness.net/news/2012/09/a-note-about-programming-language-design/).

5. **NO-VIRTUAL-MIXER** — No hidden control flow, no virtual inheritance as the mixer. Do: one `fillScore` / `setRollRumble` over the table. Don’t: virtual `play()` subclasses. Source: [Jai overview](https://github.com/Jai-Community/Jai-Community-Library/wiki/Overview), [SOA demo](https://www.youtube.com/watch?v=ZHqFrNyLlpA).

6. **ONE-PLACE-TICK** — Don’t extract a helper just because a function is long; one-use helpers invent fake generality. Do: one sequential sampler (snapshot → envelope → loop gains → one-shots). Don’t: PartialUpdate helpers on two clocks. Source: [Carmack inlined code, hosted by Blow](http://number-none.com/blow/john_carmack_on_inlined_code.html).

7. **TABLE-IS-THE-BAKE** — Games are machines that fill memory; bake constants, don’t build a framework. TypeScript has no `#run`; `src/lib/contain/sfx.ts` + `sfx.json` is the bake. Don’t: STL-like audio utils. Source: [JaiPrimer](https://github.com/BSVino/JaiPrimer/blob/master/JaiPrimer.md) (community; Blow has said it does not fully describe his intentions).

8. **ADD-A-ROW** — A new gag is a new row (impulse threshold, debounce, beep recipe). Don’t: a new system when cannon or ragdoll appears. Source: Berkeley “adding systems last resort.”

9. **KILL-INLINE-CONSTANTS** — Magic numbers out of `setRollRumble` / `writeSteelScoreWav`. Do: named table fields so the JPEG tape matches live. Don’t: duplicate literals in ffmpeg. Source: specific-system + table-of-records.

10. **GAMEPLAY-NOT-ARCHITECTURE** — Focus on the audible gag (dead-zone at rest, contact one-shots that read, 30 Hz envelope). Don’t: rathole on entity setup. Source: [Blow on ECS vs the interesting problem](https://news.ycombinator.com/item?id=28868904).

11. **NO-ENGINE-KNOB-LORE** — Abstraction has a corresponding loss of capability; extra layers replace knowledge with trivia. Do: table fields in physics units (m/s, N·s, Hz). Don’t: “toggle this middleware boolean.” Source: [Preventing the Collapse of Civilization](https://codigoyfika.github.io/site/preventing-collapse/).

12. **NOT-AN-ENGINE-COMPANY** — ECS “only starts to make sense when you are big enough to have multiple teams… or you are an engine company.” Do: Rapier bodies as data; audio as a loop over contacts. Don’t: an audio ECS. Source: [HN 28863079](https://news.ycombinator.com/item?id=28863079).

## What that is on disk

- `src/lib/contain/sfx.ts` + `sfx.json` — one table: `roll.dead` / `roll.full`, `hit.minImpulse` / `minClosing` / `debounceMs`, `bang.*`.
- Live: `setRollRumble` / `playSteelHit` read the table. Silence at and below `roll.dead`.
- Physics: `note("contact", {id, impulse, closing, …})` from `collectHits` when the hit clears the table. Dent stays geometry.
- Tape: `speedHz[]` + `contacts[]` on the same JPEG clock. `scripts/sfx-score.mjs` fills PCM from the JSON. No full-clip noise bed.
- Motion: `window.__bay.analyze(id?)` → mean / median / stdev + teleport / pose-vel / spin-flip flags over the 30 Hz ring (`src/lib/bay/ride-stats.ts`).
