import { CHEMISTRIES, MATERIALS } from "./catalog";
import { chamberLayout, type PieceId } from "./layout";
import { runtime } from "./runtime";
import type { FailureKind, MaterialId } from "./types";

export interface Bit {
  id: PieceId | "shard";
  pos: [number, number, number];
  rot: [number, number, number];
  vel: [number, number, number];
  ang: [number, number, number];
  size: [number, number, number];
  flying: boolean;
  rest: [number, number, number];
}

const GROUND = 0.02;
const G = 9.8;

export const bits: Bit[] = [];

export function resetBits(mat: MaterialId) {
  bits.length = 0;
  const layout = chamberLayout(mat);
  for (const piece of layout.pieces) {
    bits.push({
      id: piece.id,
      pos: [...piece.pos],
      rot: [0, 0, 0],
      vel: [0, 0, 0],
      ang: [0, 0, 0],
      size: [...piece.size],
      flying: false,
      rest: [...piece.pos],
    });
  }
}

export function bit(id: PieceId) {
  return bits.find((b) => b.id === id);
}

function rand(a: number) {
  return (Math.random() - 0.5) * a;
}

export function blow(kind: FailureKind, power: number) {
  const s = runtime.thermal;
  const chem = CHEMISTRIES[s.chem];
  const p = power;
  const origin = chamberLayout(s.mat).origin;

  if (kind === "lid") {
    const lid = bit("lid");
    if (!lid || lid.flying) return;
    lid.flying = true;
    lid.vel = [rand(1.1), 2.6 + Math.min(4.2, p * 0.45), rand(1.0)];
    lid.ang = [rand(12), rand(7), 6 + Math.random() * 8];
    runtime.show.shock = 1;
    runtime.show.hitstop = 0.09;
    runtime.show.slowmo = 0.55;
    runtime.show.punch = 1;
    runtime.thermal.trauma = Math.max(runtime.thermal.trauma, 0.95);
    return;
  }

  if (kind === "burst") {
    runtime.show.shock = 1;
    runtime.show.hitstop = 0.12;
    runtime.show.slowmo = 0.7;
    runtime.show.punch = 1.2;
    runtime.thermal.trauma = Math.max(runtime.thermal.trauma, 1);
    for (const b of bits) {
      if (b.id === "bottom") continue;
      b.flying = true;
      const dx = b.pos[0] - origin[0];
      const dy = b.pos[1] - origin[1];
      const dz = b.pos[2] - origin[2];
      const n = Math.max(0.08, Math.hypot(dx, dy, dz));
      const k = (0.9 + Math.min(2.2, p * 0.28)) / n;
      b.vel = [dx * k + rand(1.2), 1.8 + Math.min(3.4, p * 0.35), dz * k + rand(1.2)];
      b.ang = [rand(14), rand(14), rand(14)];
    }
    for (let i = 0; i < 10; i++) {
      bits.push({
        id: "shard",
        pos: [origin[0] + rand(0.08), origin[1] + rand(0.06), origin[2] + rand(0.08)],
        rot: [rand(6), rand(6), rand(6)],
        vel: [rand(4), 1.6 + Math.random() * 3.2, rand(4)],
        ang: [rand(20), rand(20), rand(20)],
        size: [0.04 + Math.random() * 0.05, 0.01 + Math.random() * 0.02, 0.03 + Math.random() * 0.04],
        flying: true,
        rest: [0, 0, 0],
      });
    }
    void chem;
    return;
  }

  // collapse: walls slump / peel
  for (const b of bits) {
    if (b.id === "bottom" || b.id === "lid") continue;
    b.flying = true;
    b.vel = [rand(0.8), 0.4 + Math.random() * 0.6, rand(0.8)];
    b.ang = [
      b.id === "back" ? 1.8 : rand(0.4),
      0,
      b.id === "left" ? 1.6 : b.id === "right" ? -1.6 : 0,
    ];
  }
  const lid = bit("lid");
  if (lid) {
    lid.flying = true;
    lid.vel = [rand(0.4), 0.8, rand(0.4)];
    lid.ang = [2.4, 0, 0.4];
  }
  runtime.show.hitstop = 0.05;
  runtime.show.punch = 0.45;
}

export function stepBits(dt: number) {
  const mat = MATERIALS[runtime.thermal.mat];
  const bounce = mat.restitution + 0.12;
  for (const b of bits) {
    if (!b.flying) continue;
    b.vel[1] -= G * dt;
    b.pos[0] += b.vel[0] * dt;
    b.pos[1] += b.vel[1] * dt;
    b.pos[2] += b.vel[2] * dt;
    b.rot[0] += b.ang[0] * dt;
    b.rot[1] += b.ang[1] * dt;
    b.rot[2] += b.ang[2] * dt;
    const floor = GROUND + b.size[1] * 0.15;
    if (b.pos[1] < floor) {
      b.pos[1] = floor;
      b.vel[1] *= -bounce;
      b.vel[0] *= 0.62;
      b.vel[2] *= 0.62;
      b.ang[0] *= 0.7;
      b.ang[2] *= 0.7;
      if (Math.abs(b.vel[1]) < 0.4) b.vel[1] = 0;
    }
  }
}

export function rattle(amount: number) {
  for (const b of bits) {
    if (b.flying) continue;
    b.pos[0] = b.rest[0] + rand(amount * 2);
    b.pos[1] = b.rest[1] + Math.abs(rand(amount));
    b.pos[2] = b.rest[2] + rand(amount * 2);
  }
}

export function seatResting() {
  for (const b of bits) {
    if (b.flying) continue;
    b.pos[0] += (b.rest[0] - b.pos[0]) * 0.35;
    b.pos[1] += (b.rest[1] - b.pos[1]) * 0.35;
    b.pos[2] += (b.rest[2] - b.pos[2]) * 0.35;
  }
}
