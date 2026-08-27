/** Rapier membership bits. Dummy bones occupy 3–13. */
export const WORLD_G = 0;
export const DUMMY_G = 1;
export const CRATE_G = 2;
export const COVER_G = 14;
export const WAGON_G = 15;
/** Wheel reuses the wagon bit — Rapier only has 16 membership slots. */
export const WHEEL_G = WAGON_G;
/** Drum reuses crate so it hits the wheel, other drums, and the track. */
export const DRUM_G = CRATE_G;
