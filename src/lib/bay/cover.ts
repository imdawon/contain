import type { RapierContext, RapierRigidBody } from "@react-three/rapier";
import { CAN, CRATE, DOOR, WALL } from "@/lib/bay/parts";
import { useBay, type Kind } from "@/store/bay-store";

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

function isCoverKind(kind: Kind): kind is CoverKind {
  return kind === "crate" || kind === "can" || kind === "wall" || kind === "doorway";
}

function aabbFor(kind: CoverKind, pos: [number, number, number]): { min: [number, number, number]; max: [number, number, number] } {
  if (kind === "wall") {
    const { w, h, d } = WALL;
    return { min: [pos[0] - w / 2, pos[1], pos[2] - d / 2], max: [pos[0] + w / 2, pos[1] + h, pos[2] + d / 2] };
  }
  if (kind === "doorway") {
    const { openW, h, frameT, depth } = DOOR;
    const w = openW + 2 * frameT;
    return { min: [pos[0] - w / 2, pos[1], pos[2] - depth / 2], max: [pos[0] + w / 2, pos[1] + h, pos[2] + depth / 2] };
  }
  if (kind === "crate") {
    const { w, h, d, lid } = CRATE;
    return { min: [pos[0] - w / 2, pos[1], pos[2] - d / 2], max: [pos[0] + w / 2, pos[1] + h + lid, pos[2] + d / 2] };
  }
  const { w, h, d, lid } = CAN;
  return { min: [pos[0] - w / 2, pos[1], pos[2] - d / 2], max: [pos[0] + w / 2, pos[1] + h + lid, pos[2] + d / 2] };
}

function segmentHitsAabb(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  min: [number, number, number],
  max: [number, number, number],
): { hit: boolean; toi: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  const p = [from.x, from.y, from.z];
  const d = [dx, dy, dz];
  let tmin = 0;
  let tmax = 1;
  for (let i = 0; i < 3; i++) {
    const a = min[i]! - 0.02;
    const b = max[i]! + 0.02;
    if (Math.abs(d[i]!) < 1e-8) {
      if (p[i]! < a || p[i]! > b) return { hit: false, toi: dist };
      continue;
    }
    let t1 = (a - p[i]!) / d[i]!;
    let t2 = (b - p[i]!) / d[i]!;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return { hit: false, toi: dist };
  }
  if (tmin < 0 || tmin > 1) return { hit: false, toi: dist };
  return { hit: true, toi: tmin * dist };
}

export function coverAabbHit(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): Occlusion {
  const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  let best: Occlusion = { hit: false, kind: null, toi: dist };
  for (const e of useBay.getState().entities) {
    if (!isCoverKind(e.kind)) continue;
    const box = aabbFor(e.kind, e.pos);
    const hit = segmentHitsAabb(from, to, box.min, box.max);
    if (hit.hit && hit.toi < best.toi) best = { hit: true, kind: e.kind, toi: hit.toi };
  }
  return best;
}

/**
 * Rapier will not occlude a scripted radial impulse by itself.
 * Ray from blast to a bone; first cover collider wins.
 * AABB fallback covers the case where userData tags are not on yet.
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
    undefined,
    undefined,
    undefined,
    undefined,
    (col) => tagOf(col.parent() as RapierRigidBody | null) != null,
  );
  if (hit) {
    const toi = "timeOfImpact" in hit ? (hit as { timeOfImpact: number }).timeOfImpact : (hit as { toi: number }).toi;
    if (toi < dist - 0.02) {
      const kind = tagOf(hit.collider.parent() as RapierRigidBody | null)?.kind ?? null;
      return { hit: true, kind, toi };
    }
  }
  return coverAabbHit(from, to);
}
