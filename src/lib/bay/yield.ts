import * as THREE from "three";
import { DRUM, WHEEL } from "@/lib/bay/parts";

/** Plastic dent on a cylindrical steel shell. Not FEA. Collision hulls follow the verts. */

export type SteelKind = "wheel" | "drum";

export type Slice = { idx: number[]; lid?: 1 | -1 };

export type SteelShell = {
  kind: SteelKind;
  radius: number;
  inner: number;
  halfH: number;
  segs: number;
  ringsY: number;
  ringsR: number;
  yieldJ: number;
  stiff: number;
  maxDent: number;
  rest: Float32Array;
  live: Float32Array;
  dent: Float32Array;
  slices: Slice[];
  lids: Slice[];
  outer: number[];
  strain: number;
  maxTaken: number;
  noted: number;
};

export type SteelHit = {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  impulse: number;
};

const _q = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _n = new THREE.Vector3();

function spec(kind: SteelKind) {
  return kind === "wheel" ? WHEEL : DRUM;
}

function vid(s: number, y: number, r: number, ringsY: number, ringsR: number) {
  return (s * ringsY + y) * ringsR + r;
}

export function makeSteelShell(kind: SteelKind): SteelShell {
  const s = spec(kind);
  const segs = kind === "wheel" ? 32 : 28;
  const ringsY = kind === "wheel" ? 5 : 8;
  const ringsR = kind === "wheel" ? 5 : 4;
  const radius = s.radius;
  const inner = kind === "wheel" ? WHEEL.hub : Math.max(0.04, DRUM.radius - DRUM.wall);
  const halfH = kind === "wheel" ? WHEEL.thick / 2 : DRUM.height / 2;
  const n = segs * ringsY * ringsR;
  const rest = new Float32Array(n * 3);
  const outer: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (let y = 0; y < ringsY; y++) {
      const yt = ringsY === 1 ? 0.5 : y / (ringsY - 1);
      const py = -halfH + yt * 2 * halfH;
      for (let r = 0; r < ringsR; r++) {
        const rt = ringsR === 1 ? 0 : r / (ringsR - 1);
        const rad = radius * (1 - rt) + inner * rt;
        const id = vid(i, y, r, ringsY, ringsR);
        const o = id * 3;
        rest[o] = rad * c;
        rest[o + 1] = py;
        rest[o + 2] = rad * sn;
        if (r === 0) outer.push(id);
      }
    }
  }
  const slices: Slice[] = [];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const idx: number[] = [];
    for (let y = 0; y < ringsY; y++) {
      idx.push(vid(i, y, 0, ringsY, ringsR), vid(j, y, 0, ringsY, ringsR));
    }
    slices.push({ idx });
  }
  const top: number[] = [];
  const bot: number[] = [];
  for (let i = 0; i < segs; i++) {
    bot.push(vid(i, 0, 0, ringsY, ringsR));
    top.push(vid(i, ringsY - 1, 0, ringsY, ringsR));
  }
  return {
    kind,
    radius,
    inner,
    halfH,
    segs,
    ringsY,
    ringsR,
    yieldJ: s.yieldJ,
    stiff: s.stiff,
    maxDent: s.maxDent,
    rest,
    live: rest.slice(),
    dent: new Float32Array(n),
    slices,
    lids: [
      { idx: bot, lid: -1 },
      { idx: top, lid: 1 },
    ],
    outer,
    strain: 0,
    maxTaken: 0,
    noted: 0,
  };
}

export function steelGeometry(shell: SteelShell) {
  const { segs, ringsY, ringsR, live } = shell;
  const geo = new THREE.BufferGeometry();
  const display = live.slice();
  const pos = new THREE.BufferAttribute(display, 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pos);
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    idx.push(a, b, c, a, c, d);
  };
  const v = (s: number, y: number, r: number) => vid(s, y, r, ringsY, ringsR);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    for (let y = 0; y < ringsY - 1; y++) {
      quad(v(i, y, 0), v(j, y, 0), v(j, y + 1, 0), v(i, y + 1, 0));
      const ir = ringsR - 1;
      quad(v(i, y, ir), v(i, y + 1, ir), v(j, y + 1, ir), v(j, y, ir));
    }
    for (const y of [0, ringsY - 1]) {
      const flip = y === 0;
      for (let r = 0; r < ringsR - 1; r++) {
        const a = v(i, y, r);
        const b = v(j, y, r);
        const c = v(j, y, r + 1);
        const d = v(i, y, r + 1);
        if (flip) quad(a, d, c, b);
        else quad(a, b, c, d);
      }
    }
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Collision panel = live outer skin + a thin inward offset. No origin fill. */
export function sliceHull(shell: SteelShell, slice: Slice) {
  const wall = shell.kind === "wheel" ? 0.05 : 0.042;
  const out = new Float32Array(slice.idx.length * 2 * 3);
  let w = 0;
  for (const i of slice.idx) {
    const o = i * 3;
    const x = shell.live[o]!;
    const y = shell.live[o + 1]!;
    const z = shell.live[o + 2]!;
    out[w++] = x;
    out[w++] = y;
    out[w++] = z;
    const r = Math.hypot(x, z);
    const s = r > 1e-4 ? Math.max(0.03, r - wall) / r : 1;
    out[w++] = x * s;
    out[w++] = y;
    out[w++] = z * s;
  }
  return out;
}

export function applySteelHits(shell: SteelShell, hits: SteelHit[]) {
  if (hits.length === 0) return 0;
  const { rest, live, dent, yieldJ, stiff, maxDent, inner, halfH, kind } = shell;
  const n = dent.length;
  let added = 0;
  for (const hit of hits) {
    const excess = hit.impulse - yieldJ;
    if (excess <= 0) continue;
    const step = Math.min(kind === "wheel" ? 0.2 : 0.16, excess / Math.max(0.2, stiff));
    const nlen = Math.hypot(hit.nx, hit.nz);
    const radial = nlen > 0.18;
    const nx = radial ? hit.nx / nlen : 0;
    const nz = radial ? hit.nz / nlen : 0;
    const hitAz = Math.atan2(hit.z, hit.x);
    const azScale = kind === "wheel" ? 0.52 : 0.62;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const rx = rest[o]!;
      const ry = rest[o + 1]!;
      const rz = rest[o + 2]!;
      const rad0 = Math.hypot(rx, rz);
      if (rad0 < 0.02) continue;
      let dAz = Math.atan2(rz, rx) - hitAz;
      while (dAz > Math.PI) dAz -= Math.PI * 2;
      while (dAz < -Math.PI) dAz += Math.PI * 2;
      const azFall = Math.max(0, Math.cos(dAz / azScale));
      if (azFall <= 0.04) continue;
      const dy = live[o + 1]! - hit.y;
      const yInf = kind === "wheel" ? halfH * 1.4 : 0.28;
      const yFall = Math.max(0, 1 - (dy * dy) / (yInf * yInf));
      if (yFall <= 0.04) continue;
      const room = maxDent - dent[i]!;
      if (room <= 0.0004) continue;
      const take = Math.min(room, step * azFall * azFall * yFall);
      if (take < 0.00012) continue;
      dent[i]! += take;
      added += take;
      if (radial) {
        const px = live[o]!;
        const pz = live[o + 2]!;
        const along = px * nx + pz * nz;
        const restAlong = rx * nx + rz * nz;
        if (restAlong > 0.02 && along > inner * 0.4) {
          const floor = kind === "wheel" ? 0.05 : Math.max(0.055, inner * 0.5);
          const nextAlong = Math.max(floor * Math.sign(restAlong || 1), along - take);
          const push = along - nextAlong;
          live[o]! = px - nx * push;
          live[o + 2]! = pz - nz * push;
        }
      } else {
        const py = live[o + 1]!;
        const sign = py >= 0 ? 1 : -1;
        live[o + 1]! -= sign * take;
      }
      const onCap = Math.abs(ry) > halfH * 0.62;
      if (kind === "wheel" && onCap) {
        const py = live[o + 1]!;
        const sign = py >= 0 ? 1 : -1;
        const nextY = py - sign * take * 0.7;
        live[o + 1]! = sign > 0 ? Math.max(0.04, nextY) : Math.min(-0.04, nextY);
      }
    }
  }
  if (added > 0) {
    shell.strain += added;
    shell.maxTaken = 0;
    for (let i = 0; i < n; i++) if (dent[i]! > shell.maxTaken) shell.maxTaken = dent[i]!;
  }
  return added;
}

export function worldHitsToLocal(
  body: { rotation: () => { x: number; y: number; z: number; w: number }; translation: () => { x: number; y: number; z: number } },
  worldHits: SteelHit[],
) {
  const r = body.rotation();
  const p = body.translation();
  _q.set(r.x, r.y, r.z, r.w);
  _inv.copy(_q).invert();
  const out: SteelHit[] = [];
  for (const h of worldHits) {
    _n.set(h.x - p.x, h.y - p.y, h.z - p.z).applyQuaternion(_inv);
    const x = _n.x;
    const y = _n.y;
    const z = _n.z;
    _n.set(h.nx, h.ny, h.nz).applyQuaternion(_inv);
    out.push({ x, y, z, nx: _n.x, ny: _n.y, nz: _n.z, impulse: h.impulse });
  }
  return out;
}

export function pushSteelHulls(
  shell: SteelShell,
  colliders: unknown[],
  ConvexPolyhedron: new (vertices: Float32Array) => unknown,
  liveArgs?: Float32Array[],
) {
  const parts = shell.slices;
  for (let i = 0; i < parts.length; i++) {
    const col = colliders[i] as { isValid?: () => boolean; setShape?: (shape: unknown) => void; raw?: () => { setShape?: (shape: unknown) => void } } | null | undefined;
    if (!col) continue;
    if (col.isValid && !col.isValid()) continue;
    const verts = sliceHull(shell, parts[i]!);
    const buf = liveArgs?.[i];
    if (buf && buf.length === verts.length) buf.set(verts);
    const target = col as { setShape?: (shape: unknown) => void; raw?: () => { setShape?: (shape: unknown) => void } };
    const setter = target.setShape ?? target.raw?.()?.setShape;
    if (!setter) continue;
    try {
      setter.call(target.setShape ? target : target.raw?.(), new ConvexPolyhedron(verts));
    } catch {
      try {
        col.setShape?.(new ConvexPolyhedron(verts));
      } catch {
        /* degenerate hull — keep last shape */
      }
    }
  }
}

export function steelRim(shell: SteelShell) {
  let minR = shell.radius;
  for (const i of shell.outer) {
    const o = i * 3;
    const r = Math.hypot(shell.live[o]!, shell.live[o + 2]!);
    if (r < minR) minR = r;
  }
  return minR;
}

/** Min outer radius from the BufferGeometry the GPU actually draws. */
export function steelMeshRim(geo: THREE.BufferGeometry, shell: SteelShell) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return shell.radius;
  const arr = pos.array as Float32Array;
  let minR = shell.radius;
  for (const i of shell.outer) {
    const o = i * 3;
    if (o + 2 >= arr.length) continue;
    const r = Math.hypot(arr[o]!, arr[o + 2]!);
    if (r < minR) minR = r;
  }
  return minR;
}

export function steelDish(shell: SteelShell) {
  let dish = 0;
  const { rest, live, halfH } = shell;
  const n = rest.length / 3;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (Math.abs(rest[o + 1]!) < halfH * 0.62) continue;
    const d = Math.abs(live[o + 1]! - rest[o + 1]!);
    if (d > dish) dish = d;
  }
  return dish;
}

export function refreshSteelMesh(geo: THREE.BufferGeometry, live?: Float32Array) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const dst = pos.array as Float32Array;
  if (live && live.length >= dst.length) {
    if (live !== dst) dst.set(live.subarray(0, dst.length));
  }
  pos.needsUpdate = true;
  pos.version += 1;
  geo.computeVertexNormals();
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (nrm) {
    nrm.needsUpdate = true;
    nrm.version += 1;
  }
  geo.computeBoundingSphere();
}
