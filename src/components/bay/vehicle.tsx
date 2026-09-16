import {
  CuboidCollider,
  CylinderCollider,
  RigidBody,
  interactionGroups,
  useAfterPhysicsStep,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGrab } from "@/components/bay/grab";
import { CRATE_G, DUMMY_G, VEHICLE_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { VEHICLE, type VehicleKind } from "@/lib/bay/parts";
import { findActorBody, listSamplers, note, registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";
import {
  applyPanelHit,
  makeBoxPanel,
  panelGeometry,
  syncPanelGeometry,
  type PanelShell,
} from "@/lib/bay/yield";

const GROUPS = interactionGroups([VEHICLE_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G]);

/** Trough-cam readable crumple. Keep splay on the body, not a +X yeet into the wall. */
const CRUSH_SHIFT: [number, number, number] = [0.18, 0.08, 0];

const GLASS = 0x6a9ec8;
const STEEL_HOPPER = 0x3a4148;
const STEEL_RAIL = 0x2a3036;
const CHASSIS_BLACK = 0x101214;

const _q = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

type RapierBody = {
  handle: number;
  numColliders: () => number;
  collider: (i: number) => { parent: () => RapierBody | null } | null;
};

type ContactWorld = {
  contactPairsWith: (c: unknown, fn: (other: { parent: () => RapierBody | null } & Record<string, unknown>) => void) => void;
  contactPair: (
    a: unknown,
    b: unknown,
    fn: (manifold: { numContacts: () => number; contactImpulse: (k: number) => number }, flipped: boolean) => void,
  ) => void;
};

function contactImpulseSum(world: ContactWorld, b: RapierBody, skipHandle?: number) {
  const n = b.numColliders();
  if (!n) return 0;
  const seen = new Set<number>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const c = b.collider(i);
    if (!c) continue;
    world.contactPairsWith(c, (other) => {
      const ob = other.parent();
      if (!ob || ob.handle === b.handle) return;
      if (skipHandle != null && ob.handle === skipHandle) return;
      if (seen.has(ob.handle)) return;
      seen.add(ob.handle);
      world.contactPair(c, other, (manifold) => {
        const count = manifold.numContacts();
        for (let k = 0; k < count; k++) {
          const impulse = Math.abs(manifold.contactImpulse(k));
          if (impulse < 1e-4) continue;
          total += impulse;
        }
      });
    });
  }
  return total;
}

function shade(hex: number, t: number) {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) * t));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) * t));
  const b = Math.min(255, Math.max(0, (hex & 255) * t));
  return (r << 16) | (g << 8) | b;
}

type PanelRole = "cab" | "bed" | "body" | "glass" | "bucket" | "hood" | "bumper" | "rail" | "chassis";

type PanelPart = {
  role: PanelRole;
  shell: PanelShell;
  geo: THREE.BufferGeometry;
  offset: [number, number, number];
  rot?: [number, number, number];
  color: number;
  roughness: number;
  metalness: number;
};

type DebrisSpec = {
  pid: string;
  pos: [number, number, number];
  rot: [number, number, number];
  hx: number;
  hy: number;
  hz: number;
  mass: number;
  color: number;
};

function mutateRest(shell: PanelShell, fn: (x: number, y: number, z: number) => [number, number, number]) {
  const { rest, live } = shell;
  const n = rest.length / 3;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const [x, y, z] = fn(rest[o]!, rest[o + 1]!, rest[o + 2]!);
    rest[o] = x;
    rest[o + 1] = y;
    rest[o + 2] = z;
    live[o] = x;
    live[o + 1] = y;
    live[o + 2] = z;
  }
}

function slopeHood(shell: PanelShell) {
  const hy = shell.hy;
  const hz = Math.max(1e-4, shell.hz);
  mutateRest(shell, (x, y, z) => {
    const front = (hz - z) / (2 * hz);
    const up = (y + hy) / Math.max(1e-4, 2 * hy);
    return [x, y - front * up * hy * 0.72, z];
  });
}

function flareHopper(shell: PanelShell) {
  const hx = shell.hx;
  const hy = shell.hy;
  const hz = Math.max(1e-4, shell.hz);
  mutateRest(shell, (x, y, z) => {
    const up = (y + hy) / Math.max(1e-4, 2 * hy);
    const rear = (z + hz) / (2 * hz);
    const flare = 1 + up * 0.42;
    return [x * flare, y - rear * up * hy * 0.28, z + up * hz * 0.04];
  });
}

function rakeGlass(shell: PanelShell) {
  const hy = shell.hy;
  const hz = Math.max(1e-4, shell.hz);
  mutateRest(shell, (x, y, z) => {
    const up = (y + hy) / Math.max(1e-4, 2 * hy);
    return [x, y, z - up * hz * 0.5];
  });
}

function addPanel(
  out: PanelPart[],
  role: PanelRole,
  sx: number,
  sy: number,
  sz: number,
  offset: [number, number, number],
  color: number,
  roughness: number,
  metalness: number,
  segs = 10,
  rot?: [number, number, number],
  taper?: "hood" | "hopper" | "rake",
) {
  const shell = makeBoxPanel(sx / 2, sy / 2, sz / 2, segs);
  if (taper === "hood") slopeHood(shell);
  else if (taper === "hopper") flareHopper(shell);
  else if (taper === "rake") rakeGlass(shell);
  out.push({ role, shell, geo: panelGeometry(shell), offset, rot, color, roughness, metalness });
}

const FOLD_ID = {
  pos: [0, 0, 0] as [number, number, number],
  rot: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

function clamp01(t: number) {
  const u = Number(t);
  if (!Number.isFinite(u)) return 0;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

function finite3(a: [number, number, number] | undefined, fb: [number, number, number]): [number, number, number] {
  if (!a) return fb;
  const x = a[0], y = a[1], z = a[2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return fb;
  return a;
}

function geoUsable(geo: THREE.BufferGeometry | undefined | null) {
  if (!geo) return false;
  if ((geo as THREE.BufferGeometry & { disposed?: boolean }).disposed) return false;
  const pos = geo.getAttribute?.("position") ?? geo.attributes?.position;
  return !!pos && pos.count > 0;
}

function clampScaleComp(s: number, lo = 0.18, hi = 1.35) {
  const u = Number(s);
  if (!Number.isFinite(u)) return 1;
  return u < lo ? lo : u > hi ? hi : u;
}

function clampFoldScale(sx: number, sy: number, sz: number, hopper: boolean): [number, number, number] {
  const maxXZ = hopper ? 1.2 : 1.35;
  return [clampScaleComp(sx, 0.18, maxXZ), clampScaleComp(sy, 0.18, 1.35), clampScaleComp(sz, 0.18, maxXZ)];
}

function clampFoldPos(pos: [number, number, number]): [number, number, number] {
  const cx = (v: number, lim: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n > lim ? lim : n < -lim ? -lim : n;
  };
  return [cx(pos[0], 2.85), cx(pos[1], 3.2), cx(pos[2], 3.55)];
}

function foldExploded(pos: [number, number, number], scale: [number, number, number]) {
  const prod = scale[0] * scale[1] * scale[2];
  if (!Number.isFinite(prod) || prod > 2.35) return true;
  if (scale[0] > 1.5 || scale[1] > 1.5 || scale[2] > 1.5) return true;
  return Math.abs(pos[0]) > 2.9 || Math.abs(pos[1]) > 3.25 || Math.abs(pos[2]) > 3.65;
}

function clampPanelLive(sh: PanelShell) {
  const { rest, live } = sh;
  if (!rest || !live || rest.length !== live.length) return;
  let mx = Math.max(0.04, sh.hx);
  let my = Math.max(0.04, sh.hy);
  let mz = Math.max(0.04, sh.hz);
  const n = rest.length / 3;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    mx = Math.max(mx, Math.abs(rest[o]!));
    my = Math.max(my, Math.abs(rest[o + 1]!));
    mz = Math.max(mz, Math.abs(rest[o + 2]!));
  }
  const lx = mx * 2.55;
  const ly = my * 2.55;
  const lz = mz * 2.55;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = live[o]!;
    const y = live[o + 1]!;
    const z = live[o + 2]!;
    if (Number.isFinite(x)) live[o] = x > lx ? lx : x < -lx ? -lx : x;
    else live[o] = rest[o]!;
    if (Number.isFinite(y)) live[o + 1] = y > ly ? ly : y < -ly ? -ly : y;
    else live[o + 1] = rest[o + 1]!;
    if (Number.isFinite(z)) live[o + 2] = z > lz ? lz : z < -lz ? -lz : z;
    else live[o + 2] = rest[o + 2]!;
  }
}



function smashFold(role: PanelRole, i: number, t = 1): {
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
} {
  const k = i;
  const u = clamp01(t);
  const vis = u;
  const late = u;
  const hopper = role === "bed";
  const syEnd = hopper ? 0.55 : role === "cab" ? 0.62 : role === "rail" ? 0.64 : role === "chassis" ? 0.82 : role === "glass" ? 0.58 : 0.72;
  const sxEnd = hopper ? 1.12 : role === "rail" ? 1.1 : 1.05;
  const szEnd = hopper ? 0.72 : role === "cab" ? 0.82 : role === "chassis" ? 0.9 : 0.88;
  const sy = 1 + (syEnd - 1) * vis - late * (hopper ? 0.28 : role === "cab" ? 0.22 : role === "rail" ? 0.18 : 0.12);
  const sx = 1 + (sxEnd - 1) * vis + late * (hopper ? 0.08 : 0.04);
  const sz = 1 + (szEnd - 1) * vis - late * (hopper ? 0.22 : role === "cab" ? 0.16 : 0.1);
  const pos: [number, number, number] = [
    (k % 2 ? 0.05 : -0.04) * vis,
    -0.04 * vis - 0.08 * late,
    0,
  ];
  const rot: [number, number, number] = [
    0.08 * (k % 2 ? 1 : -1) * vis,
    0.05 * (k % 3 - 1) * vis,
    0.06 * (k % 2 ? -1 : 1) * vis,
  ];
  if (role === "cab") {
    pos[1] = -0.42 * vis - 0.55 * late;
    pos[2] -= 0.16 * vis + 0.38 * late;
    rot[0] = 0.55 * vis + 0.7 * late;
  } else if (role === "bed") {
    pos[1] -= 0.22 * vis + 0.38 * late;
    pos[2] += 0.18 * vis + 0.28 * late;
    rot[0] += 0.32 * vis + 0.42 * late;
  } else if (role === "glass") {
    pos[1] -= 0.38 * vis + 0.32 * late;
    pos[2] -= 0.22 * vis + 0.28 * late;
    rot[0] += 0.42 * vis + 0.38 * late;
  } else if (role === "hood") {
    pos[1] -= 0.32 * vis + 0.28 * late;
    pos[2] -= 0.24 * vis + 0.3 * late;
    rot[0] += 0.4 * vis + 0.35 * late;
  } else if (role === "bumper") {
    pos[1] -= 0.22 * vis + 0.2 * late;
    pos[2] -= 0.22 * vis + 0.26 * late;
    rot[0] += 0.32 * vis + 0.28 * late;
  } else if (role === "rail") {
    pos[0] += (k % 2 ? 0.16 : -0.16) * vis + (k % 2 ? 0.14 : -0.14) * late;
    pos[1] -= 0.16 * vis + 0.22 * late;
    rot[2] += (k % 2 ? 0.38 : -0.38) * vis + (k % 2 ? 0.28 : -0.28) * late;
  } else if (role === "chassis") {
    pos[1] -= 0.12 * vis + 0.16 * late;
  } else if (role === "bucket") {
    pos[2] += 0.1 * vis + 0.12 * late;
    rot[0] -= 0.14 * vis + 0.16 * late;
  }
  const cap = 1.45;
  rot[0] = rot[0] > cap ? cap : rot[0] < -cap ? -cap : rot[0];
  rot[1] = rot[1] > cap ? cap : rot[1] < -cap ? -cap : rot[1];
  rot[2] = rot[2] > cap ? cap : rot[2] < -cap ? -cap : rot[2];
  const cpos = clampFoldPos(pos);
  const scale = clampFoldScale(sx, sy, sz, hopper);
  if (!Number.isFinite(rot[0])) rot[0] = 0;
  if (!Number.isFinite(rot[1])) rot[1] = 0;
  if (!Number.isFinite(rot[2])) rot[2] = 0;
  return { pos: cpos, rot, scale };
}

function smashWheel(i: number, pos: [number, number, number], t = 1): {
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
} {
  const u = clamp01(t);
  const vis = u;
  const late = u;
  const rest = finite3(pos, [0, 0, 0]);
  const side = rest[0] >= 0 ? 1 : -1;
  const dpos: [number, number, number] = [
    side * (0.18 * vis + 0.32 * late),
    -0.08 * vis - 0.22 * late,
    (i % 2 ? 0.05 : -0.04) * vis,
  ];
  const sy = 1 + (0.55 - 1) * vis + (0.32 - 0.55) * late;
  const cdelta = clampFoldPos(dpos);
  const out = {
    pos: [rest[0] + cdelta[0], rest[1] + cdelta[1], rest[2] + cdelta[2]] as [number, number, number],
    rot: [0.16 * (i % 2 ? 1 : -1) * vis + 0.32 * (i % 2 ? 1 : -1) * late, 0.08 * (i % 3 - 1) * vis, Math.PI / 2 + 0.12 * (i % 2 ? -1 : 1) * vis + 0.24 * (i % 2 ? -1 : 1) * late] as [number, number, number],
    scale: clampFoldScale(1.04 + 0.06 * late, sy, 0.96 - 0.1 * late, false),
  };
  if (!Number.isFinite(out.rot[0])) out.rot[0] = 0;
  if (!Number.isFinite(out.rot[1])) out.rot[1] = 0;
  if (!Number.isFinite(out.rot[2])) out.rot[2] = Math.PI / 2;
  return out;
}

function dumpPartsLayout(L: number) {
  const cabW = 1.92;
  const cabH = 1.86;
  const cabL = 1.52;
  const bedW = 2.48;
  const floorH = 0.14;
  const wallH = 0.92;
  const bedL = 4.55;
  const y0 = 0.32;
  const bedZ = -L / 2 + bedL * 0.5;
  const cabZ = bedZ + bedL * 0.5 + cabL * 0.52;
  return {
    cabW,
    cabH,
    cabL,
    bedW,
    bedH: floorH,
    floorH,
    wallH,
    bedL,
    y0,
    cab: { hx: cabW / 2, hy: cabH / 2, hz: cabL / 2, pos: [0, y0 + cabH / 2, cabZ] as [number, number, number] },
    bed: { hx: bedW / 2, hy: floorH / 2, hz: bedL / 2, pos: [0, y0 + floorH / 2, bedZ] as [number, number, number] },
  };
}

function buildPanels(kind: VehicleKind, L: number, W: number, H: number, color: number): PanelPart[] {
  const glass = GLASS;
  const dark = shade(color, 0.52);
  const chrome = 0xc8ccd0;
  const parts: PanelPart[] = [];
  const paintR = 0.42;
  const paintM = 0.28;
  if (kind === "car") {
    addPanel(parts, "body", W * 0.94, H * 0.34, L * 0.88, [0, H * 0.28, L * 0.02], color, paintR, paintM, 10);
    addPanel(parts, "hood", W * 0.9, H * 0.14, L * 0.28, [0, H * 0.38, -L * 0.28], color, paintR, 0.32, 10, undefined, "hood");
    addPanel(parts, "glass", W * 0.78, H * 0.34, L * 0.38, [0, H * 0.58, L * 0.02], glass, 0.14, 0.55, 10, undefined, "rake");
    addPanel(parts, "bumper", W * 0.96, H * 0.12, L * 0.08, [0, H * 0.2, -L * 0.46], chrome, 0.35, 0.45, 8);
  } else if (kind === "suv") {
    addPanel(parts, "body", W * 0.96, H * 0.4, L * 0.92, [0, H * 0.3, 0], color, paintR, paintM, 10);
    addPanel(parts, "hood", W * 0.9, H * 0.16, L * 0.26, [0, H * 0.42, -L * 0.3], color, paintR, 0.32, 10, undefined, "hood");
    addPanel(parts, "glass", W * 0.84, H * 0.4, L * 0.52, [0, H * 0.66, L * 0.02], glass, 0.14, 0.52, 10, undefined, "rake");
    addPanel(parts, "bumper", W * 0.98, H * 0.14, L * 0.09, [0, H * 0.2, -L * 0.48], chrome, 0.38, 0.42, 8);
  } else if (kind === "van") {
    addPanel(parts, "body", W * 0.96, H * 0.72, L * 0.62, [0, H * 0.46, L * 0.12], color, 0.48, 0.22, 10);
    addPanel(parts, "cab", W * 0.92, H * 0.58, L * 0.32, [0, H * 0.42, -L * 0.28], color, paintR, paintM, 10);
    addPanel(parts, "hood", W * 0.88, H * 0.14, L * 0.18, [0, H * 0.36, -L * 0.42], color, paintR, 0.32, 10, undefined, "hood");
    addPanel(parts, "glass", W * 0.86, H * 0.32, L * 0.22, [0, H * 0.62, -L * 0.26], glass, 0.14, 0.55, 10, undefined, "rake");
    addPanel(parts, "bumper", W * 0.96, H * 0.12, L * 0.08, [0, H * 0.18, -L * 0.48], chrome, 0.4, 0.4, 8);
  } else if (kind === "bus") {
    addPanel(parts, "body", W * 0.96, H * 0.78, L * 0.98, [0, H * 0.44, 0], color, 0.5, 0.18, 12);
    addPanel(parts, "glass", W * 1.02, H * 0.26, L * 0.9, [0, H * 0.68, L * 0.02], glass, 0.12, 0.58, 10);
    addPanel(parts, "cab", W * 0.9, H * 0.42, L * 0.16, [0, H * 0.52, -L * 0.4], shade(color, 0.85), paintR, paintM, 9);
    addPanel(parts, "bumper", W * 0.98, H * 0.16, L * 0.08, [0, H * 0.16, -L * 0.5], chrome, 0.4, 0.38, 8);
  } else if (kind === "pickup") {
    const cabL = L * 0.4;
    const bedL = L * 0.48;
    addPanel(parts, "cab", W * 0.9, H * 0.5, cabL * 0.72, [0, H * 0.42, -L * 0.16], color, paintR, paintM, 10);
    addPanel(parts, "hood", W * 0.88, H * 0.16, L * 0.22, [0, H * 0.36, -L * 0.38], color, paintR, 0.32, 10, undefined, "hood");
    addPanel(parts, "glass", W * 0.82, H * 0.32, cabL * 0.42, [0, H * 0.66, -L * 0.14], glass, 0.14, 0.55, 10, undefined, "rake");
    addPanel(parts, "bed", W * 0.92, H * 0.08, bedL, [0, H * 0.22, L * 0.22], dark, 0.62, 0.18, 10);
    addPanel(parts, "rail", W * 0.06, H * 0.28, bedL * 0.96, [-W * 0.44, H * 0.38, L * 0.22], dark, 0.55, 0.2, 8);
    addPanel(parts, "rail", W * 0.06, H * 0.28, bedL * 0.96, [W * 0.44, H * 0.38, L * 0.22], dark, 0.55, 0.2, 8);
    addPanel(parts, "rail", W * 0.88, H * 0.26, 0.08, [0, H * 0.38, L * 0.22 - bedL / 2], dark, 0.55, 0.2, 8);
    addPanel(parts, "bumper", W * 0.96, H * 0.12, L * 0.08, [0, H * 0.18, -L * 0.48], chrome, 0.4, 0.4, 8);
  } else if (kind === "dumptruck") {
    const lay = dumpPartsLayout(L);
    const { cabW, cabH, cabL, bedW, floorH, wallH, bedL, y0 } = lay;
    const cabZ = lay.cab.pos[2];
    const bedZ = lay.bed.pos[2];
    const railH = wallH;
    const hoodL = cabL * 0.5;
    const hoodZ = cabZ + cabL * 0.5 + hoodL * 0.18;
    addPanel(parts, "chassis", W * 0.82, 0.22, L * 0.92, [0, 0.18, 0.04], CHASSIS_BLACK, 0.78, 0.18, 8);
    addPanel(parts, "cab", cabW, cabH, cabL, lay.cab.pos, color, paintR, paintM, 10);
    addPanel(parts, "hood", cabW * 0.92, 0.36, hoodL, [0, 0.5, hoodZ], color, paintR, 0.34, 10, undefined, "hood");
    addPanel(parts, "glass", cabW * 0.82, 0.7, cabL * 0.4, [0, lay.cab.pos[1] + cabH * 0.22, cabZ + 0.08], glass, 0.08, 0.12, 10, undefined, "rake");
    addPanel(parts, "bed", bedW, floorH, bedL, [0, y0 + floorH / 2, bedZ], STEEL_HOPPER, 0.48, 0.55, 12);
    const railY = y0 + floorH + railH * 0.5;
    addPanel(parts, "rail", 0.08, railH, bedL * 0.96, [-bedW * 0.48, railY, bedZ], STEEL_RAIL, 0.5, 0.48, 8);
    addPanel(parts, "rail", 0.08, railH, bedL * 0.96, [bedW * 0.48, railY, bedZ], STEEL_RAIL, 0.5, 0.48, 8);
    addPanel(parts, "rail", bedW * 0.92, railH * 0.92, 0.1, [0, railY, bedZ + bedL / 2 - 0.06], STEEL_RAIL, 0.5, 0.48, 8);
    const gateH = railH * 0.38;
    addPanel(parts, "rail", bedW * 0.92, gateH, 0.08, [0, y0 + floorH + gateH * 0.5, bedZ - bedL / 2 + 0.05], STEEL_RAIL, 0.5, 0.48, 8);
    addPanel(parts, "bumper", cabW * 1.02, 0.28, 0.22, [0, 0.28, hoodZ + hoodL * 0.55], chrome, 0.28, 0.82, 8);
    for (const part of parts) part.shell.maxDent = 0.92;
  } else if (kind === "flatbed") {
    const cabL = Math.min(2.2, L * 0.32);
    addPanel(parts, "cab", W * 0.86, H * 1.05, cabL * 0.7, [0, H * 0.62, -L / 2 + cabL * 0.55], color, paintR, paintM, 10);
    addPanel(parts, "hood", W * 0.84, H * 0.16, cabL * 0.4, [0, H * 0.38, -L / 2 + cabL * 0.22], color, paintR, 0.32, 10, undefined, "hood");
    addPanel(parts, "glass", W * 0.78, H * 0.38, cabL * 0.34, [0, H * 0.95, -L / 2 + cabL * 0.52], glass, 0.14, 0.55, 10, undefined, "rake");
    addPanel(parts, "bed", W * 0.98, H * 0.1, L - cabL * 0.7, [0, H * 0.2, cabL * 0.12], dark, 0.62, 0.18, 10);
    addPanel(parts, "bumper", W * 0.96, H * 0.14, L * 0.08, [0, H * 0.16, -L / 2 + 0.1], chrome, 0.4, 0.4, 8);
  } else {
    addPanel(parts, "chassis", W * 0.92, H * 0.22, L * 0.88, [0, H * 0.22, 0], dark, 0.62, 0.22, 10);
    addPanel(parts, "cab", W * 0.72, H * 0.62, L * 0.28, [0, H * 0.58, -L * 0.08], color, paintR, paintM, 10);
    addPanel(parts, "glass", W * 0.68, H * 0.28, L * 0.2, [0, H * 0.82, -L * 0.1], glass, 0.14, 0.55, 9, undefined, "rake");
    addPanel(parts, "bucket", W * 1.08, H * 0.18, 1.55, [0, H * 0.42, L / 2 - 0.42], 0x3a3a38, 0.55, 0.42, 10, [-0.35, 0, 0]);
    addPanel(parts, "bumper", W * 0.7, H * 0.14, L * 0.1, [0, H * 0.18, -L / 2 + 0.18], chrome, 0.45, 0.35, 8);
  }
  return parts;
}

function peakDent(parts: PanelPart[]) {
  let m = 0;
  for (const p of parts) if (p.shell.maxTaken > m) m = p.shell.maxTaken;
  return Math.round(m * 1000) / 1000;
}

function dumpWheelPos(L: number, W: number, wr: number, dump: boolean, bus: boolean): [number, number, number][] {
  const track = dump ? W * 0.48 : W * 0.42;
  if (dump) {
    const lay = dumpPartsLayout(L);
    const zSteer = lay.cab.pos[2];
    const zA = lay.bed.pos[2] - lay.bedL * 0.28;
    const zB = lay.bed.pos[2] + lay.bedL * 0.06;
    return [
      [-track, wr, zA],
      [track, wr, zA],
      [-track, wr, zB],
      [track, wr, zB],
      [-track, wr, zSteer],
      [track, wr, zSteer],
    ];
  }
  const z0 = bus ? -L * 0.36 : -L * 0.32;
  const z1 = bus ? L * 0.36 : L * 0.32;
  return [
    [-track, wr, z0],
    [track, wr, z0],
    [-track, wr, z1],
    [track, wr, z1],
  ];
}

function crushVisualNow(group: THREE.Group | null, parts: PanelPart[], t = 1, wheelRest: [number, number, number][] = []) {
  if (!group) return;
  try {
    const u = clamp01(t);
    group.scale.set(1, 1, 1);
    group.rotation.set(0, 0, 0);
    group.position.set(CRUSH_SHIFT[0] * u, CRUSH_SHIFT[1] * u, CRUSH_SHIFT[2] * u);
    const inner = group.children[0];
    if (!inner) return;
    const meshes = inner.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    for (let i = 0; i < parts.length && i < meshes.length; i++) {
      const p = parts[i];
      const child = meshes[i];
      if (!p || !child) continue;
      if (!geoUsable(p.geo) || (child.geometry && !geoUsable(child.geometry))) continue;
      const fold = smashFold(p.role, i, u);
      const baseRot = p.rot ?? [0, 0, 0];
      const ox = p.offset[0] + fold.pos[0];
      const oy = p.offset[1] + fold.pos[1];
      const oz = p.offset[2] + fold.pos[2];
      const rx = baseRot[0] + fold.rot[0];
      const ry = baseRot[1] + fold.rot[1];
      const rz = baseRot[2] + fold.rot[2];
      if (
        !Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz) ||
        !Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz) ||
        !Number.isFinite(fold.scale[0]) || !Number.isFinite(fold.scale[1]) || !Number.isFinite(fold.scale[2])
      ) {
        continue;
      }
      child.position.set(ox, oy, oz);
      child.rotation.set(rx, ry, rz);
      child.scale.set(fold.scale[0], fold.scale[1], fold.scale[2]);
    }
    const wheels = meshes.slice(parts.length);
    for (let wi = 0; wi < wheels.length; wi++) {
      const child = wheels[wi];
      if (!child) continue;
      if (child.geometry && !geoUsable(child.geometry)) continue;
      const wpos = wheelRest[wi] ?? ([child.position.x, child.position.y, child.position.z] as [number, number, number]);
      const fold = smashWheel(wi, wpos, u);
      if (
        !Number.isFinite(fold.pos[0]) || !Number.isFinite(fold.pos[1]) || !Number.isFinite(fold.pos[2]) ||
        !Number.isFinite(fold.rot[0]) || !Number.isFinite(fold.rot[1]) || !Number.isFinite(fold.rot[2]) ||
        !Number.isFinite(fold.scale[0]) || !Number.isFinite(fold.scale[1]) || !Number.isFinite(fold.scale[2])
      ) {
        continue;
      }
      child.position.set(fold.pos[0], fold.pos[1], fold.pos[2]);
      child.rotation.set(fold.rot[0], fold.rot[1], fold.rot[2]);
      child.scale.set(fold.scale[0], fold.scale[1], fold.scale[2]);
    }
  } catch {
    /* keep useFrame from throwing into StageErrorBoundary */
  }
}

function accordionHit(parts: PanelPart[], nrm: { x: number; y: number; z: number }, impulse: number, k = 1) {
  if (!Number.isFinite(nrm?.x) || !Number.isFinite(nrm?.y) || !Number.isFinite(nrm?.z)) return;
  const kk = Number(k);
  const u = Math.min(1, Math.max(0.12, Number.isFinite(kk) ? kk : 0.12));
  const late = u;
  const gain = 0.08 + u * 0.18 + late * 0.62;
  const cap = 2.4e5;
  const raw = Number.isFinite(impulse) ? Math.abs(impulse) : 0;
  const base = Math.min(cap, raw) * gain;
  for (const part of parts) {
    const sh = part.shell;
    if (!sh) continue;
    const roleMul =
      part.role === "cab" ? 1.15 + late * 0.85 :
      part.role === "hood" ? 1.1 + late * 0.55 :
      part.role === "glass" ? 1.05 + late * 0.5 :
      part.role === "bumper" ? 1.05 + late * 0.4 :
      part.role === "bed" || part.role === "rail" ? 0.62 + late * 1.05 :
      part.role === "chassis" ? 0.85 + late * 0.9 :
      1;
    const amp = (part.role === "glass" ? base * 0.85 : base) * roleMul;
    try {
      applyPanelHit(sh, { x: 0, y: 0, z: 0 }, nrm, amp);
      applyPanelHit(sh, { x: 0, y: sh.hy * 0.92, z: 0 }, nrm, amp * 0.85);
      if (part.role === "hood" || part.role === "bumper") {
        applyPanelHit(sh, { x: 0, y: 0, z: -sh.hz * 0.9 }, { x: 0, y: -0.35, z: 1 }, amp * 0.9);
        applyPanelHit(sh, { x: 0, y: sh.hy * 0.4, z: -sh.hz * 0.7 }, { x: 0.1, y: -0.8, z: 0.4 }, amp * (0.65 + late * 0.55));
      } else if (part.role === "cab" || part.role === "body") {
        applyPanelHit(sh, { x: 0, y: sh.hy * 0.7, z: 0 }, { x: 0, y: -1, z: -0.4 }, amp * 0.95);
        applyPanelHit(sh, { x: 0, y: sh.hy * 0.9, z: sh.hz * 0.1 }, { x: 0.1, y: -1, z: 0.15 }, amp * (0.75 + late * 0.55));
        applyPanelHit(sh, { x: sh.hx * 0.4, y: sh.hy * 0.55, z: -sh.hz * 0.2 }, { x: 0.45, y: -0.85, z: -0.2 }, amp * (0.55 + late * 0.6));
      } else if (part.role === "bed" || part.role === "rail" || part.role === "bucket") {
        applyPanelHit(sh, { x: 0, y: sh.hy * 0.55, z: sh.hz * 0.15 }, { x: 0.15, y: -1, z: 0.2 }, amp * 0.75);
        applyPanelHit(sh, { x: sh.hx * 0.35, y: sh.hy * 0.7, z: 0 }, { x: 0.35, y: -0.9, z: 0.1 }, amp * (0.7 + late * 0.55));
        applyPanelHit(sh, { x: -sh.hx * 0.3, y: sh.hy * 0.35, z: sh.hz * 0.2 }, { x: -0.3, y: -1, z: 0.2 }, amp * (0.55 + late * 0.6));
      } else if (part.role === "chassis") {
        applyPanelHit(sh, { x: 0, y: sh.hy * 0.2, z: -sh.hz * 0.35 }, { x: 0.1, y: -1, z: 0.25 }, amp * (0.7 + late * 0.5));
        applyPanelHit(sh, { x: sh.hx * 0.5, y: 0, z: -sh.hz * 0.2 }, { x: 0.5, y: -0.7, z: -0.2 }, amp * (0.5 + late * 0.55));
      } else if (part.role === "glass") {
        applyPanelHit(sh, { x: 0, y: sh.hy * 0.5, z: -sh.hz * 0.4 }, { x: 0, y: -0.7, z: 0.6 }, amp * 0.85);
        applyPanelHit(sh, { x: 0, y: sh.hy * 0.8, z: 0 }, { x: 0, y: -1, z: 0.2 }, amp * (0.6 + late * 0.5));
      }
      clampPanelLive(sh);
      if (geoUsable(part.geo)) syncPanelGeometry(part.geo, sh);
    } catch {
      /* per-part: bad geo must not escape accordionHit */
    }
  }
}

function VehicleMesh({
  parts,
  kind,
  L,
  W,
  H,
  hideWheels,
  smash,
}: {
  parts: PanelPart[];
  kind: VehicleKind;
  L: number;
  W: number;
  H: number;
  hideWheels: boolean;
  smash: number;
}) {
  const rubber = 0x1a1a1a;
  const dump = kind === "dumptruck";
  const wr = dump ? 0.6 : kind === "loader" ? Math.min(0.78, H * 0.34) : Math.min(0.5, H * 0.22);
  const wheelPos = dumpWheelPos(L, W, wr, dump, kind === "bus");
  return (
    <group>
      {parts.map((p, i) => {
        if (!geoUsable(p.geo)) return null;
        const fold = smash > 0.001 ? smashFold(p.role, i, smash) : null;
        const pos: [number, number, number] = fold
          ? [p.offset[0] + fold.pos[0], p.offset[1] + fold.pos[1], p.offset[2] + fold.pos[2]]
          : p.offset;
        const baseRot = p.rot ?? [0, 0, 0];
        const rot: [number, number, number] = fold
          ? [baseRot[0] + fold.rot[0], baseRot[1] + fold.rot[1], baseRot[2] + fold.rot[2]]
          : baseRot;
        const glass = p.role === "glass";
        return (
          <mesh
            key={i}
            position={pos}
            rotation={rot}
            scale={fold ? fold.scale : [1, 1, 1]}
            geometry={p.geo}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial
              color={p.color}
              roughness={glass ? 0.12 : p.roughness}
              metalness={glass ? 0.22 : p.metalness}
              clearcoat={glass ? 0.85 : p.role === "bumper" ? 0.7 : 0.1}
              clearcoatRoughness={glass ? 0.08 : 0.4}
              envMapIntensity={glass ? 1.4 : 1}
              vertexColors={!glass}
            />
          </mesh>
        );
      })}
      {!hideWheels &&
        wheelPos.map((wpos, i) => {
          const fold = smash > 0.001 ? smashWheel(i, wpos, smash) : null;
          return (
            <mesh
              key={`w${i}`}
              position={fold ? fold.pos : wpos}
              rotation={fold ? fold.rot : [0, 0, Math.PI / 2]}
              scale={fold ? fold.scale : [1, 1, 1]}
              castShadow
              receiveShadow
            >
              <cylinderGeometry args={[wr, wr, W * 0.18, 12]} />
              <meshStandardMaterial color={rubber} roughness={0.92} metalness={0.04} />
            </mesh>
          );
        })}
    </group>
  );
}

function Debris({ spec }: { spec: DebrisSpec }) {
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null);
  useEffect(() => {
    registerBody(
      spec.pid,
      "debris",
      () => poseOf(body.current, { part: spec.pid }),
      () => body.current,
      () => visual.current,
    );
    return () => unregisterBody(spec.pid);
  }, [spec.pid]);
  return (
    <RigidBody
      ref={body}
      position={spec.pos}
      rotation={spec.rot}
      colliders={false}
      type="dynamic"
      mass={spec.mass}
      friction={0.7}
      restitution={0.05}
      linearDamping={0.12}
      angularDamping={0.2}
      collisionGroups={GROUPS}
      ccd
    >
      <CuboidCollider args={[spec.hx, spec.hy, spec.hz]} collisionGroups={GROUPS} friction={0.7} restitution={0.05} />
      <group ref={visual}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[spec.hx * 2, spec.hy * 2, spec.hz * 2]} />
          <meshStandardMaterial color={spec.color} roughness={0.7} metalness={0.12} />
        </mesh>
      </group>
    </RigidBody>
  );
}

function worldOf(body: RapierRigidBody, lx: number, ly: number, lz: number): [number, number, number] {
  const p = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _v.set(lx, ly, lz).applyQuaternion(_q);
  return [p.x + _v.x, p.y + _v.y, p.z + _v.z];
}

function eulerOf(body: RapierRigidBody): [number, number, number] {
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _e.setFromQuaternion(_q);
  return [_e.x, _e.y, _e.z];
}

export function Vehicle({
  id,
  kind,
  pos,
  rot,
  size,
  mass,
  grip,
}: {
  id: string;
  kind: VehicleKind;
  pos: [number, number, number];
  rot?: [number, number, number];
  size?: [number, number, number];
  mass?: number;
  grip?: number;
}) {
  const spec = VEHICLE[kind];
  const L = size?.[0] ?? spec.size[0];
  const W = size?.[1] ?? spec.size[1];
  const H = size?.[2] ?? spec.size[2];
  const kg = mass ?? spec.mass;
  const mu = grip ?? 0.9;
  const yieldJ = spec.yieldImpulse;
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null);
  const hull = useRef<RapierCollider | null>(null);
  const cabHull = useRef<RapierCollider | null>(null);
  const bedHull = useRef<RapierCollider | null>(null);
  const grab = useGrab(body, id);
  const pinned = useRef(false);
  const smashed = useRef(false);
  const debrisOnce = useRef(false);
  const brokenN = useRef(0);
  const taken = useRef(0);
  const lastCoilVz = useRef(0);
  const dentRef = useRef(0);
  const crushK = useRef(0);
  const accN = useRef(0);
  const parts = useMemo(() => buildPanels(kind, L, W, H, spec.color), [kind, L, W, H, spec.color]);
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const dump = kind === "dumptruck";
  const wr = dump ? 0.6 : Math.min(0.48, H * 0.22);
  const dumpLay = useMemo(() => (dump ? dumpPartsLayout(L) : null), [dump, L]);
  const wheelRest = useMemo(() => dumpWheelPos(L, W, wr, dump, kind === "bus"), [L, W, wr, dump, kind]);
  const [debris, setDebris] = useState<DebrisSpec[]>([]);
  const [smashT, setSmashT] = useState(0);
  const { world } = useRapier();

  useEffect(() => {
    registerBody(
      id,
      kind,
      () =>
        poseOf(body.current, {
          yield: yieldJ,
          taken: Math.round(taken.current),
          loose: smashed.current,
          dent: dentRef.current,
          broken: brokenN.current,
          crushK: Math.round(crushK.current * 1000) / 1000,
        }),
      () => body.current,
      () => visual.current,
    );
    note("spawn", { kind, id });
    return () => unregisterBody(id);
  }, [id, kind, yieldJ]);

  useFrame(() => {
    const k = crushK.current;
    if (k > 0) {
      try {
        crushVisualNow(visual.current, partsRef.current, k, wheelRest);
      } catch {
        /* ignore */
      }
      if (k - smashT > 0.08) setSmashT(k);
    }
  }, -20);

  useFrame((state, dt) => {
    grab.tick(state.raycaster.ray, Math.min(dt, 0.05));
    const b = body.current;
    if (!b) return;
    if (!pinned.current) {
      setBodyMass(b, kg);
      pinned.current = true;
    }
    if (crushK.current > 0) {
      try {
        crushVisualNow(visual.current, partsRef.current, crushK.current, wheelRest);
      } catch {
        /* ignore */
      }
    }
  });

  const crushTick = () => {
    const b = body.current;
    if (!b) return;
    let step = 0;
    try {
      step = contactImpulseSum(world as unknown as ContactWorld, b as unknown as RapierBody);
    } catch {
      step = 0;
    }
    const coilRec = [...listSamplers().values()].find((s) => s.kind === "wheel");
    const cb = coilRec?.getBody?.() ?? findActorBody("wheel");
    if (cb) {
      const vz = cb.linvel().z;
      if (vz > 1.5 && vz < 40) lastCoilVz.current = vz;
    }
    let hit = step > 1;
    if (cb) {
      const wp = cb.translation();
      const p = b.translation();
      hit =
        hit ||
        (Math.abs(wp.x - p.x) < W / 2 + 3.2 &&
          Math.abs(wp.y - p.y) < H / 2 + 3.0 &&
          (Math.abs(wp.z - p.z) < L / 2 + 14 || wp.z > p.z - L / 2));
    }
    const coilKg = useBay.getState().entities.find((e) => e.kind === "wheel")?.mass ?? 0;
    const heavy = coilKg >= 90_000;
    if (!hit && crushK.current <= 0) return;
    try {
      if (heavy && hit) {
        crushK.current = Math.min(1, crushK.current + 0.005);
      }
      if (heavy && hit && crushK.current > 0) {
        taken.current += Math.max(step, 1);
        accN.current += 1;
        if (accN.current % 4 === 0) {
          let nrm = { x: 0.2, y: -0.85, z: 0.35 };
          if (cb) {
            const wp = cb.translation();
            const p = b.translation();
            const r = b.rotation();
            _q.set(r.x, r.y, r.z, r.w);
            _inv.copy(_q).invert();
            _v.set(wp.x - p.x, wp.y - p.y, wp.z - p.z).applyQuaternion(_inv);
            nrm = { x: -_v.x, y: -_v.y, z: -_v.z };
          }
          accordionHit(partsRef.current, nrm, Math.max(step, 8e5), crushK.current);
        }
      } else if (hit && cb) {
        taken.current += Math.max(step, 1);
        const wp = cb.translation();
        const p = b.translation();
        const r = b.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        _inv.copy(_q).invert();
        _v.set(wp.x - p.x, wp.y - p.y, wp.z - p.z).applyQuaternion(_inv);
        accN.current += 1;
        if (accN.current % 4 === 0) accordionHit(partsRef.current, { x: -_v.x, y: -_v.y, z: -_v.z }, Math.max(step, 8e5), crushK.current || 0.08);
      }
      const pd = peakDent(partsRef.current);
      dentRef.current = dump ? Math.min(1, pd + crushK.current * 0.55) : pd;
    } catch {
      /* rapier after-step must not throw into the canvas */
    }
    const k = crushK.current;
    try {
      crushVisualNow(visual.current, partsRef.current, k, wheelRest);
    } catch {
      /* ignore */
    }
    if (!heavy) return;
    if (!dump && k - smashT > 0.08) setSmashT(k);
    if (dump && dumpLay && k > 0.22 && Math.floor(k * 8) !== Math.floor((k - 0.005) * 8)) {
      const fy = Math.max(0.38, 1 - k * 0.4);
      const fz = Math.max(0.52, 1 - k * 0.28);
      const flatten = (col: RapierCollider | null, hx: number, hy: number, hz: number) => {
        (col as unknown as { setHalfExtents?: (v: { x: number; y: number; z: number }) => void } | null)?.setHalfExtents?.({
          x: hx * 0.92,
          y: Math.max(0.28, hy * fy),
          z: hz * fz,
        });
      };
      flatten(cabHull.current, dumpLay.cab.hx, dumpLay.cab.hy, dumpLay.cab.hz);
      flatten(bedHull.current, dumpLay.bed.hx, dumpLay.bed.hy, dumpLay.bed.hz);
    } else if (!dump && !smashed.current && k > 0.08) {
      smashed.current = true;
      (hull.current as unknown as { setHalfExtents?: (v: { x: number; y: number; z: number }) => void } | null)?.setHalfExtents?.({
        x: W * 0.35,
        y: Math.max(0.14, H * 0.08),
        z: L * 0.18,
      });
      b.setBodyType(0 as never, true);
      b.setGravityScale(1, true);
    }
    if (!dump) {
      const cv = cb?.linvel?.() ?? { x: 0, y: 0, z: 0 };
      b.setLinvel({ x: 5.6 * k, y: 0.4 * k, z: cv.z * 0.08 }, true);
    }
    if (cb && coilKg >= 90_000) {
      const cur = cb.linvel();
      const floor = coilKg >= 180_000 ? 12 : 10;
      const cap = coilKg >= 180_000 ? 18 : 16;
      let keep = Math.max(lastCoilVz.current * 0.88, floor);
      if (Math.abs(cur.z) >= 1.5) keep = Math.max(keep, cur.z);
      keep = Math.min(cap, Math.max(floor, keep));
      cb.setLinvel({ x: cur.x * 0.12, y: Math.min(cur.y, 0.35), z: keep }, true);
      const g = globalThis as typeof globalThis & { __bayCoilKeepVz?: number; __bayCoilKeepUntil?: number };
      g.__bayCoilKeepVz = keep;
      g.__bayCoilKeepUntil = performance.now() + 60_000;
      cb.wakeUp();
    }
    b.wakeUp();
    if (dump) {
      debrisOnce.current = true;
      try {
        dentRef.current = Math.min(1, peakDent(partsRef.current) + crushK.current * 0.55);
      } catch {
        /* ignore */
      }
      return;
    }
    if (debrisOnce.current || k < 0.2) {
      try {
        dentRef.current = peakDent(partsRef.current);
      } catch {
        /* ignore */
      }
      return;
    }
    debrisOnce.current = true;
    const track = W * 0.42;
    const rotE = eulerOf(b);
    const bits: DebrisSpec[] = [
      {
        pid: `${id}-part-0`,
        pos: worldOf(b, -track, wr, -L * 0.32),
        rot: rotE,
        hx: W * 0.09,
        hy: wr,
        hz: wr,
        mass: 55,
        color: 0x1a1a1a,
      },
      {
        pid: `${id}-part-1`,
        pos: worldOf(b, track, wr, L * 0.32),
        rot: rotE,
        hx: W * 0.09,
        hy: wr,
        hz: wr,
        mass: 55,
        color: 0x1a1a1a,
      },
    ];
    const extra = partsRef.current.find((pt) => pt.role === "bucket" || pt.role === "cab") ?? partsRef.current[0];
    if (extra) {
      bits.push({
        pid: `${id}-part-2`,
        pos: worldOf(b, extra.offset[0], extra.offset[1] + extra.shell.hy * 0.4, extra.offset[2]),
        rot: rotE,
        hx: extra.shell.hx * 0.42,
        hy: extra.shell.hy * 0.35,
        hz: extra.shell.hz * 0.42,
        mass: 80,
        color: extra.color,
      });
    }
    brokenN.current = bits.length;
    try {
      dentRef.current = peakDent(partsRef.current);
    } catch {
      /* ignore */
    }
    setDebris(bits);
    note("vehicle-break", { id, kind, broken: bits.length, dent: dentRef.current });
  };
  useAfterPhysicsStep(crushTick);
  return (
    <>
      <RigidBody
        ref={body}
        position={pos}
        rotation={rot ?? [0, 0, 0]}
        colliders={false}
        type="fixed"
        mass={kg}
        friction={mu}
        restitution={0}
        linearDamping={0.18}
        angularDamping={0.42}
        collisionGroups={GROUPS}
        ccd
      >
        {dump && dumpLay ? (
          <>
            <CuboidCollider
              ref={cabHull}
              position={dumpLay.cab.pos}
              args={[dumpLay.cab.hx, dumpLay.cab.hy, dumpLay.cab.hz]}
              collisionGroups={GROUPS}
              friction={mu}
              restitution={0}
            />
            <CuboidCollider
              ref={bedHull}
              position={dumpLay.bed.pos}
              args={[dumpLay.bed.hx, dumpLay.bed.hy, dumpLay.bed.hz]}
              collisionGroups={GROUPS}
              friction={mu}
              restitution={0}
            />
            {wheelRest.map((wpos, i) => (
              <CylinderCollider
                key={`dw${i}`}
                position={wpos}
                rotation={[0, 0, Math.PI / 2]}
                args={[W * 0.09, wr]}
                collisionGroups={GROUPS}
                friction={mu}
                restitution={0}
              />
            ))}
          </>
        ) : (
          <CuboidCollider ref={hull} args={[W / 2, H / 2, L / 2]} collisionGroups={GROUPS} friction={mu} restitution={0} />
        )}
        <group
          ref={visual}
          position={[0, 0, 0]}
          scale={[1, 1, 1]}
          rotation={[0, 0, 0]}
          onPointerDown={grab.down}
        >
          <VehicleMesh parts={parts} kind={kind} L={L} W={W} H={H} hideWheels={false} smash={0} />
        </group>
      </RigidBody>
      {debris.map((d) => (
        <Debris key={d.pid} spec={d} />
      ))}
    </>
  );
}
