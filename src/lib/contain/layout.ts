import { MATERIALS, PHONE } from "./catalog";
import type { MaterialId } from "./types";

export type PieceId = "left" | "right" | "back" | "front" | "bottom" | "lid";

export interface Piece {
  id: PieceId;
  pos: [number, number, number];
  size: [number, number, number];
  glass?: boolean;
}

export interface ChamberLayout {
  inner: { w: number; h: number; d: number };
  t: number;
  pieces: Piece[];
  phone: { pos: [number, number, number]; size: [number, number, number] };
  origin: [number, number, number];
}

export function chamberLayout(mat: MaterialId): ChamberLayout {
  const m = MATERIALS[mat];
  const { w, h, d } = m.inner;
  const t = m.thickness;
  const bottomY = t / 2;
  const wallY = t + h / 2;
  const lidY = t + h + t / 2;
  const ox = (w + t) / 2;
  const oz = (d + t) / 2;

  const pieces: Piece[] = [
    {
      id: "bottom",
      pos: [0, bottomY, 0],
      size: [w + 2 * t, t, d + 2 * t],
    },
    {
      id: "left",
      pos: [-ox, wallY, 0],
      size: [t, h, d],
    },
    {
      id: "right",
      pos: [ox, wallY, 0],
      size: [t, h, d],
    },
    {
      id: "back",
      pos: [0, wallY, -oz],
      size: [w + 2 * t, h, t],
    },
    {
      id: "front",
      pos: [0, wallY, oz],
      size: [w + 2 * t, h, t],
      glass: true,
    },
    {
      id: "lid",
      pos: [0, lidY, 0],
      size: [w + 2 * t, t, d + 2 * t],
    },
  ];

  return {
    inner: m.inner,
    t,
    pieces,
    phone: {
      pos: [0, t + PHONE.h / 2 + 0.002, 0],
      size: [PHONE.w, PHONE.h, PHONE.d],
    },
    origin: [0, (t + h + t) / 2, 0],
  };
}

export function pieceFailsOn(
  id: PieceId,
  kind: "lid" | "burst" | "collapse",
): boolean {
  if (id === "front" || id === "bottom") return false;
  if (kind === "lid") return id === "lid";
  if (kind === "collapse") return id === "lid" || id === "left" || id === "right" || id === "back";
  return id === "lid" || id === "left" || id === "right" || id === "back";
}
