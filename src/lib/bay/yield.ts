import * as THREE from "three";
import { DRUM, WHEEL } from "./parts.ts";

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
  /** Relative speed of the other body, m/s. Rolling sits near 0. */
  closing?: number;
  /** Other rigid mass, kg. Fixed ramps are Infinity. */
  otherMass?: number;
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
  const segs = kind === "wheel" ? 48 : 24;
  const ringsY = kind === "wheel" ? 9 : 7;
  const ringsR = kind === "wheel" ? 6 : 3;
  const radius = s.radius;
  // Drums close the lids: inner ~0 so the end faces are disks, not open washers.
  const inner = kind === "wheel" ? WHEEL.hub : 0.02;
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
    const mid = Math.floor(ringsY / 2);
    slices.push({
      idx: [
        vid(i, 0, 0, ringsY, ringsR),
        vid(i, mid, 0, ringsY, ringsR),
        vid(i, ringsY - 1, 0, ringsY, ringsR),
        vid(j, 0, 0, ringsY, ringsR),
        vid(j, mid, 0, ringsY, ringsR),
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
  const wall = shell.kind === "wheel" ? 0.05 : 0.08;
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

/** Keep the real contact, including rim corners and faces. Do not snap everything to the mid-tread. */
function craterOnShell(shell: SteelShell, hit: SteelHit) {
  const { radius, halfH } = shell;
  let hx = hit.x;
  let hy = hit.y;
  let hz = hit.z;
  hy = Math.max(-halfH, Math.min(halfH, hy));
  let r = Math.hypot(hx, hz);
  if (r > radius * 1.45 || Math.abs(hit.y) > halfH * 1.55) {
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
    r = radius;
  } else if (r > radius) {
    hx *= radius / r;
    hz *= radius / r;
    r = radius;
  } else if (r < 0.04) {
    let ox = hit.nx;
    let oz = hit.nz;
    const nl = Math.hypot(ox, oz);
    if (nl < 1e-4) {
      return { x: 0, y: hy, z: 0, nx: 0, nz: 1 };
    }
    hx = (ox / nl) * radius;
    hz = (oz / nl) * radius;
    r = radius;
  }
  const nx = r > 1e-4 ? hx / r : 0;
  const nz = r > 1e-4 ? hz / r : 1;
  return { x: hx, y: hy, z: hz, nx, nz };
}

export function steelExtents(shell: SteelShell) {
  let halfH = 0;
  let radius = 0;
  const n = shell.dent.length;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const h = Math.abs(shell.live[o + 1]!);
    const r = Math.hypot(shell.live[o]!, shell.live[o + 2]!);
    if (h > halfH) halfH = h;
    if (r > radius) radius = r;
  }
  return { halfH, radius };
}


/** Empty drum under a tonne coil: squash to a thin steel pancake. Not paper, not a leftover barrel. */
export function crumpleDrum(shell: SteelShell, hit?: SteelHit) {
  if (shell.kind !== "drum") return 0;
  if (shell.maxTaken >= 0.5) return 0;
  const { rest, live, dent, halfH, radius } = shell;
  const n = dent.length;
  let hx = hit?.nx ?? 0;
  let hz = hit?.nz ?? 0;
  if (Math.hypot(hx, hz) < 0.08) {
    hx = hit?.x ?? 0;
    hz = hit?.z ?? radius;
  }
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl;
  hz /= hl;
  let added = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const rx = rest[o]!;
    const ry = rest[o + 1]!;
    const rz = rest[o + 2]!;
    const facing = (rx * hx + rz * hz) / Math.max(1e-4, radius);
    const splay = 1.38 + 0.1 * Math.max(0, facing);
    const hFold = 0.05;
    const px = rx * splay;
    const py = ry * hFold;
    const pz = rz * splay;
    const push = Math.hypot(live[o]! - px, live[o + 1]! - py, live[o + 2]! - pz);
    if (push <= 1e-5) continue;
    live[o] = px;
    live[o + 1] = py;
    live[o + 2] = pz;
    dent[i] = Math.min(1.2, dent[i]! + push);
    bruise(shell, i);
    added += push;
  }
  if (added > 0) {
    shell.strain += added;
    shell.maxTaken = 0;
    for (let i = 0; i < n; i++) if (dent[i]! > shell.maxTaken) shell.maxTaken = dent[i]!;
  }
  return added;
}

export function applySteelHits(shell: SteelShell, hits: SteelHit[]) {
  if (hits.length === 0) return 0;
  const { rest, live, dent, yieldJ, stiff, maxDent, inner, kind, halfH } = shell;
  const n = dent.length;
  const sigma = kind === "wheel" ? 0.32 : 0.28;
  const floorR =
    kind === "wheel" ? Math.max(shell.radius - maxDent, inner + 0.05) : Math.max(0.08, shell.radius - maxDent);
  const floorH = kind === "wheel" ? Math.max(halfH * 0.42, halfH - maxDent) : 0.032;
  const cap = kind === "wheel" ? 0.055 : 0.9;
  let added = 0;
  for (const hit of hits) {
    if (kind === "wheel") {
      if (hit.otherMass != null && Number.isFinite(hit.otherMass) && hit.otherMass < 4000) continue;
    }
    const excess = hit.impulse - yieldJ;
    if (excess <= 0) continue;
    const crater = craterOnShell(shell, hit);
    if (!crater) continue;
    const onEdge = kind === "wheel" && Math.abs(crater.y) > halfH * 0.62;
    if (kind === "wheel") {
      const need = onEdge ? 8 : 12;
      if (hit.closing != null && hit.closing < need) continue;
    }
    const hitCap = kind === "wheel" ? (onEdge ? 0.08 : 0.05) : cap;
    const sigR = kind === "wheel" ? (onEdge ? 0.26 : 0.34) : sigma;
    const sigY = kind === "wheel" ? halfH * 0.55 : sigma;
    const twoR = 2 * sigR * sigR;
    const twoY = 2 * sigY * sigY;
    const depth = Math.min(hitCap, maxDent, excess / Math.max(0.5, stiff));
    if (kind !== "drum" && depth < 0.002) continue;

    if (kind === "drum") {
      const runOver = (hit.otherMass != null && Number.isFinite(hit.otherMass) && hit.otherMass >= 50_000) || hit.impulse >= 400;
      if (runOver) {
        added += crumpleDrum(shell, hit);
        continue;
      }
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const px = live[o]!;
        const pz = live[o + 2]!;
        const along = px * crater.nx + pz * crater.nz;
        if (along <= floorR) continue;
        const dx = px - crater.x;
        const dy = rest[o + 1]! - crater.y;
        const dz = pz - crater.z;
        const w = Math.exp(-(dx * dx + dz * dz) / twoR - (dy * dy) / twoY);
        if (w < 0.04) continue;
        const take = Math.min(along - floorR, Math.max(depth, 0.04) * w);
        if (take <= 1e-5) continue;
        live[o] = px - crater.nx * take;
        live[o + 2] = pz - crater.nz * take;
        dent[i] = Math.min(1.2, dent[i]! + take);
        bruise(shell, i);
        added += take;
      }
      continue;
    }

    const ix = -crater.x;
    const iy = kind === "wheel" && onEdge ? -crater.y * 0.78 : 0;
    const iz = -crater.z;
    const il = Math.hypot(ix, iy, iz) || 1;
    const ux = ix / il;
    const uy = iy / il;
    const uz = iz / il;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const rx = rest[o]!;
      const ry = rest[o + 1]!;
      const rz = rest[o + 2]!;
      const dx = rx - crater.x;
      const dy = ry - crater.y;
      const dz = rz - crater.z;
      // Wall slams crush a full-width stripe so both rims fold, not only the mid-tread.
      const w = Math.exp(
        kind === "wheel" && !onEdge
          ? -(dx * dx + dz * dz) / twoR
          : -(dx * dx + dz * dz) / twoR - (dy * dy) / twoY,
      );
      if (w < 0.04) continue;
      const room = maxDent - dent[i]!;
      if (room <= 0.0004) continue;
      const take = Math.min(room, depth * w);
      if (take < 0.0002) continue;
      let px = live[o]!;
      let py = live[o + 1]!;
      let pz = live[o + 2]!;
      const vertEdge = Math.abs(ry) > halfH * 0.62;
      px += ux * take;
      if (vertEdge) py += uy * take;
      pz += uz * take;
      let rad = Math.hypot(px, pz);
      if (rad < floorR && rad > 1e-4) {
        const s = floorR / rad;
        px *= s;
        pz *= s;
        rad = floorR;
      }
      if (vertEdge && Math.abs(py) < floorH) py = Math.sign(py || ry) * floorH;
      if (Math.abs(py) > halfH) py = Math.sign(py) * halfH;
      const pushed = Math.hypot(live[o]! - px, live[o + 1]! - py, live[o + 2]! - pz);
      if (pushed <= 1e-5) continue;
      live[o] = px;
      live[o + 1] = py;
      live[o + 2] = pz;
      dent[i] = Math.min(maxDent, dent[i]! + pushed);
      bruise(shell, i);
      added += pushed;
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
    out.push({ x, y, z, nx: _n.x, ny: _n.y, nz: _n.z, impulse: h.impulse, closing: h.closing, otherMass: h.otherMass });
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
