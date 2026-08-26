import type { RapierContext, RapierRigidBody } from "@react-three/rapier";

export type CoverKind = "crate" | "can" | "wall" | "doorway";

export type CoverTag = { cover: true; kind: CoverKind };

export type Occlusion = {
  hit: boolean;
  kind: CoverKind | null;
  toi: number;
};

function tagOf(b: RapierRigidBody | null | undefined): CoverTag | null {
  const data = b?.userData as CoverTag | undefined;
  if (data && data.cover === true) return data;
  return null;
}

/** Crate, can, wall, and doorway occlude blast. Grass has no collider. */
export function markCover(b: RapierRigidBody | null | undefined, kind: CoverKind) {
  if (!b) return;
  b.userData = { cover: true, kind } satisfies CoverTag;
}

export function isCoverBody(b: RapierRigidBody | null | undefined) {
  return tagOf(b) != null;
}

/**
 * Rapier will not occlude a scripted radial impulse by itself.
 * Ray from blast to a bone; first cover collider wins.
 */
export function lineOccluded(
  world: RapierContext["world"],
  rapier: RapierContext["rapier"],
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): Occlusion {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.05) return { hit: false, kind: null, toi: 0 };
  const inv = 1 / dist;
  const ray = new rapier.Ray({ x: from.x, y: from.y, z: from.z }, { x: dx * inv, y: dy * inv, z: dz * inv });
  const hit = world.castRay(
    ray,
    dist,
    true,
    rapier.QueryFilterFlags.EXCLUDE_FIXED,
    undefined,
    undefined,
    undefined,
    (col) => tagOf(col.parent() as RapierRigidBody | null) != null,
  );
  if (!hit) return { hit: false, kind: null, toi: dist };
  const toi = "timeOfImpact" in hit ? (hit as { timeOfImpact: number }).timeOfImpact : (hit as { toi: number }).toi;
  if (toi >= dist - 0.02) return { hit: false, kind: null, toi };
  const kind = tagOf(hit.collider.parent() as RapierRigidBody | null)?.kind ?? null;
  return { hit: true, kind, toi };
}
