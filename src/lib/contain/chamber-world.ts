import type { Box3DBody, Box3DModule, Box3DWorld, Vec3 } from "box3d-wasm/standard";
import { MATERIALS, PHONE } from "./catalog";
import { chamberLayout, pieceFailsOn, type PieceId } from "./layout";
import type { FailureKind, MaterialId } from "./types";

export interface BodyPiece {
  id: PieceId;
  body: Box3DBody;
  size: [number, number, number];
  glass?: boolean;
}

export interface ChamberHandle {
  world: Box3DWorld;
  phone: Box3DBody;
  pieces: BodyPiece[];
  failed: boolean;
  blow(kind: FailureKind, power: number): void;
  rattle(amount: number): void;
  step(dt: number): void;
  destroy(): void;
}

let modulePromise: Promise<Box3DModule> | null = null;

function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

async function loadBox3D() {
  if (!modulePromise) {
    modulePromise = import("box3d-wasm/standard").then((m) => m.default());
  }
  return modulePromise;
}

export async function createChamber(mat: MaterialId): Promise<ChamberHandle> {
  const b3 = await loadBox3D();
  const world = new b3.World({
    gravity: { x: 0, y: -9.8, z: 0 },
    enableSleep: true,
    enableContinuous: true,
  });

  const ground = world.createBody({
    type: "static",
    position: vec(0, -0.2, 0),
  });
  ground.createBox({
    halfExtents: vec(6, 0.2, 6),
    friction: 0.85,
    restitution: 0.02,
  });

  const layout = chamberLayout(mat);
  const material = MATERIALS[mat];
  const pieces: BodyPiece[] = [];

  for (const piece of layout.pieces) {
    const body = world.createBody({
      type: "static",
      position: vec(piece.pos[0], piece.pos[1], piece.pos[2]),
      angularDamping: 0.12,
    });
    body.createBox({
      halfExtents: vec(piece.size[0] / 2, piece.size[1] / 2, piece.size[2] / 2),
      density: material.density,
      friction: material.friction,
      restitution: material.restitution,
    });
    pieces.push({
      id: piece.id,
      body,
      size: piece.size,
      glass: piece.glass,
    });
  }

  const phone = world.createBody({
    type: "dynamic",
    position: vec(layout.phone.pos[0], layout.phone.pos[1], layout.phone.pos[2]),
    angularDamping: 0.08,
  });
  phone.createBox({
    halfExtents: vec(PHONE.w / 2, PHONE.h / 2, PHONE.d / 2),
    density: PHONE.density,
    friction: 0.6,
    restitution: 0.04,
  });
  phone.setBullet(true);

  let failed = false;

  const handle: ChamberHandle = {
    world,
    phone,
    pieces,
    get failed() {
      return failed;
    },
    blow(kind, power) {
      if (failed) return;
      failed = true;
      const p = power;
      for (const piece of pieces) {
        if (!pieceFailsOn(piece.id, kind)) continue;
        piece.body.setType("dynamic");
        piece.body.applyMassFromShapes();
        piece.body.setAwake(true);
        if (piece.id === "lid") {
          piece.body.applyLinearImpulseToCenter(
            vec(
              (Math.random() - 0.5) * 0.15 * p,
              0.85 * p,
              (Math.random() - 0.5) * 0.12 * p,
            ),
            true,
          );
          piece.body.applyAngularImpulse(vec(0.08 * p, 0.04 * p, 0.1 * p), true);
        }
      }
      const origin = layout.origin;
      if (kind === "burst") {
        world.explode({
          position: vec(origin[0], origin[1], origin[2]),
          radius: 0.7,
          falloff: 1.4,
          impulsePerArea: 1.1 * p,
        });
        phone.applyLinearImpulseToCenter(vec(0.04 * p, 0.35 * p, 0.12 * p), true);
      } else if (kind === "collapse") {
        world.explode({
          position: vec(origin[0], origin[1], origin[2]),
          radius: 0.45,
          falloff: 2,
          impulsePerArea: 0.22 * p,
        });
      }
    },
    rattle(amount) {
      phone.applyLinearImpulseToCenter(
        vec((Math.random() - 0.5) * amount, amount * 0.35, (Math.random() - 0.5) * amount),
        true,
      );
      phone.applyAngularImpulse(
        vec((Math.random() - 0.5) * amount * 0.02, (Math.random() - 0.5) * amount * 0.02, (Math.random() - 0.5) * amount * 0.02),
        true,
      );
    },
    step(dt) {
      world.step(dt, 4);
    },
    destroy() {
      try {
        world.destroy();
      } catch {
        /* already gone */
      }
    },
  };

  return handle;
}
