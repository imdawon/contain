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
  paint: Float32Array;
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

const WHEEL_PAINT: [number, number, number] = [0.62, 0.64, 0.68];
const DRUM_PAINT: [number, number, number] = [0.38, 0.42, 0.32];
const BRUISE: [number, number, number] = [0.18, 0.14, 0.11];

function spec(kind: SteelKind) {
  return kind === "wheel" ? WHEEL : DRUM;
}

function vid(s: number, y: number, r: number, ringsY: number, ringsR: number) {
  return (s * ringsY + y) * ringsR + r;
}

export function makeSteelShell(kind: SteelKind): SteelShell {
  const s = spec(kind);
  const segs = kind === "wheel" ? 40 : 32;
  const ringsY = kind === "wheel" ? 7 : 10;
  const ringsR = kind === "wheel" ? 5 : 4;
  const radius = s.radius;
  const inner = kind === "wheel" ? WHEEL.hub : Math.max(0.04, DRUM.radius - DRUM.wall);
  const halfH = kind === "wheel" ? WHEEL.thick / 2 : DRUM.height / 2;
  const n = segs * ringsY * ringsR;
  const rest = new Float32Array(n * 3);
  const paint = new Float32Array(n * 3);
  const base = kind === "wheel" ? WHEEL_PAINT : DRUM_PAINT;
  const outer: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (let y = 0; y < ringsY; y++) {
      const yt = y / (ringsY - 1);
      const py = -halfH + yt * 2 * halfH;
      for (let r = 0; r < ringsR; r++) {
        const rt = r / (ringsR - 1);
        const rad = radius * (1 - rt) + inner * rt;
        const id = vid(i, y, r, ringsY, ringsR);
        const o = id * 3;
        rest[o] = rad * c;
        rest[o + 1] = py;
        rest[o + 2] = rad * sn;
        paint[o] = base[0];
        paint[o + 1] = base[1];
        paint[o + 2] = base[2];
        if (r === 0) outer.push(id);
      }
    }
  }
  const slices: Slice[] = [];
  const hullN = kind === "wheel" ? 16 : 14;
  for (let h = 0; h < hullN; h++) {
    const i = Math.round((h / hullN) * segs) % segs;
    const j = Math.round(((h + 1) / hullN) * segs) % segs;
    slices.push({
      idx: [
        vid(i, 0, 0, ringsY, ringsR),
        vid(i, ringsY - 1, 0, ringsY, ringsR),
        vid(j, 0, 0, ringsY, ringsR),
        vid(j, ringsY - 1, 0, ringsY, ringsR),
      ],
    });
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
    paint,
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
  const { segs, ringsY, ringsR, live, paint } = shell;
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(live, 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pos);
  const col = new THREE.BufferAttribute(paint, 3);
  col.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("color", col);
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

function bruise(shell: SteelShell, i: number) {
  const base = shell.kind === "wheel" ? WHEEL_PAINT : DRUM_PAINT;
  const t = Math.min(1, shell.dent[i]! / Math.max(0.04, shell.maxDent * 0.55));
  const o = i * 3;
  shell.paint[o] = base[0] * (1 - t) + BRUISE[0] * t;
  shell.paint[o + 1] = base[1] * (1 - t) + BRUISE[1] * t;
  shell.paint[o + 2] = base[2] * (1 - t) + BRUISE[2] * t;
}

/** Project a contact onto the rest cylinder. Ignores Rapier normal sign. */
function craterOnShell(shell: SteelShell, hit: SteelHit) {
  const { radius, halfH } = shell;
  let hx = hit.x;
  let hy = hit.y;
  let hz = hit.z;
  let r = Math.hypot(hx, hz);
  if (r < 0.05 || r > radius * 1.45 || Math.abs(hy) > halfH * 1.45) {
    let ox = hit.nx;
    let oz = hit.nz;
    if (Math.hypot(ox, oz) < 0.12) {
      ox = hx;
      oz = hz;
    }
    const nl = Math.hypot(ox, oz);
    if (nl < 1e-4) return null;
    hx = (ox / nl) * radius;
    hz = (oz / nl) * radius;
    hy = Math.max(-halfH, Math.min(halfH, hy));
    r = radius;
  }
  const nx = hx / r;
  const nz = hz / r;
  return { x: nx * radius, y: Math.max(-halfH, Math.min(halfH, hy)), z: nz * radius, nx, nz };
}

export function applySteelHits(shell: SteelShell, hits: SteelHit[]) {
  if (hits.length === 0) return 0;
  const { rest, live, dent, yieldJ, stiff, maxDent, inner, kind } = shell;
  const n = dent.length;
  const sigma = kind === "wheel" ? 0.07 : 0.14;
  const twoSig = 2 * sigma * sigma;
  const floor =
    kind === "wheel"
      ? Math.max(shell.radius - maxDent, inner + 0.05)
      : Math.max(0.05, shell.radius - maxDent);
  const cap = kind === "wheel" ? 0.016 : 0.09;
  let added = 0;
  for (const hit of hits) {
    const excess = hit.impulse - yieldJ;
    if (excess <= 0) continue;
    const crater = craterOnShell(shell, hit);
    if (!crater) continue;
    const depth = Math.min(cap, maxDent, excess / Math.max(0.5, stiff));
    if (depth < 0.002) continue;
    const { nx, nz } = crater;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const rx = rest[o]!;
      const ry = rest[o + 1]!;
      const rz = rest[o + 2]!;
      const dx = rx - crater.x;
      const dy = ry - crater.y;
      const dz = rz - crater.z;
      const w = Math.exp(-(dx * dx + dy * dy + dz * dz) / twoSig);
      if (w < 0.04) continue;
      const room = maxDent - dent[i]!;
      if (room <= 0.0004) continue;
      const take = Math.min(room, depth * w);
      if (take < 0.0002) continue;
      const px = live[o]!;
      const pz = live[o + 2]!;
      const along = px * nx + pz * nz;
      if (along <= floor) continue;
      const nextAlong = Math.max(floor, along - take);
      const push = along - nextAlong;
      if (push <= 1e-5) continue;
      live[o] = px - nx * push;
      live[o + 2] = pz - nz * push;
      if (kind === "drum") {
        const rad = Math.hypot(live[o]!, live[o + 2]!);
        if (rad > floor + 0.002) {
          const nr = Math.max(floor, rad - take * 0.55);
          const s = nr / rad;
          live[o] *= s;
          live[o + 2] *= s;
        }
      }
      dent[i] += push;
      bruise(shell, i);
      added += push;
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
  if (live && live !== dst && live.length >= dst.length) dst.set(live.subarray(0, dst.length));
  pos.needsUpdate = true;
  pos.version += 1;
  const col = geo.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (col) {
    col.needsUpdate = true;
    col.version += 1;
  }
  geo.computeVertexNormals();
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (nrm) {
    nrm.needsUpdate = true;
    nrm.version += 1;
  }
  geo.computeBoundingSphere();
}
