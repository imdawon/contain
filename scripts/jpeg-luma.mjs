/** Mean JPEG luminance from DC coefficients. Does not import bay-doctor. */
import { existsSync, readFileSync } from "node:fs";

class Bits {
  constructor(bytes, start, end) {
    this.unmarked = this.strip(bytes, start, end);
    this.p = 0;
  }
  strip(src, start, end) {
    const out = [];
    for (let i = start; i < end; i++) {
      const c = src[i];
      if (c === 0xff) {
        const n = src[i + 1];
        if (n === 0x00) {
          out.push(0xff);
          i += 1;
          continue;
        }
        if (n >= 0xd0 && n <= 0xd7) {
          i += 1;
          continue;
        }
        break;
      }
      out.push(c);
    }
    return Uint8Array.from(out);
  }
  bit() {
    const i = this.p >> 3;
    if (i >= this.unmarked.length) return 0;
    const v = (this.unmarked[i] >> (7 - (this.p & 7))) & 1;
    this.p += 1;
    return v;
  }
  bits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }
}

function buildHuff(counts, symbols) {
  const map = new Map();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    code <<= 1;
    const n = counts[len - 1] || 0;
    for (let i = 0; i < n; i++) {
      map.set(`${len}:${code}`, symbols[k++]);
      code += 1;
    }
  }
  return map;
}

function huffNext(bits, table) {
  let code = 0;
  for (let len = 1; len <= 16; len++) {
    code = (code << 1) | bits.bit();
    const hit = table.get(`${len}:${code}`);
    if (hit != null) return hit;
  }
  return 0;
}

function receive(bits, s) {
  if (s === 0) return 0;
  const v = bits.bits(s);
  const half = 1 << (s - 1);
  return v < half ? v - ((1 << s) - 1) : v;
}

function skipAc(bits, ac) {
  for (let k = 1; k < 64; ) {
    const rs = huffNext(bits, ac);
    const r = rs >> 4;
    const s = rs & 15;
    if (s === 0) {
      if (r === 15) k += 16;
      else break;
    } else {
      k += r + 1;
      bits.bits(s);
    }
  }
}

function jpegMean(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  const dqt = [];
  const dht = { dc: [], ac: [] };
  let sof = null;
  let sos = null;
  let scanAt = -1;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    while (i < buf.length && buf[i] === 0xff) i += 1;
    const m = buf[i++];
    if (m === 0xd9 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (m === 0x01) continue;
    if (i + 1 >= buf.length) break;
    const len = (buf[i] << 8) | buf[i + 1];
    const start = i + 2;
    const end = i + len;
    if (end > buf.length) break;
    if (m === 0xdb) {
      let p = start;
      while (p < end) {
        const pq = buf[p++];
        const id = pq & 15;
        const prec = pq >> 4;
        const t = [];
        for (let k = 0; k < 64; k++) {
          if (prec) {
            t[k] = (buf[p] << 8) | buf[p + 1];
            p += 2;
          } else t[k] = buf[p++];
        }
        dqt[id] = t;
      }
    } else if (m === 0xc4) {
      let p = start;
      while (p < end) {
        const tc = buf[p] >> 4;
        const th = buf[p] & 15;
        p += 1;
        const counts = [...buf.subarray(p, p + 16)];
        p += 16;
        const n = counts.reduce((a, b) => a + b, 0);
        const symbols = [...buf.subarray(p, p + n)];
        p += n;
        const table = buildHuff(counts, symbols);
        if (tc === 0) dht.dc[th] = table;
        else dht.ac[th] = table;
      }
    } else if (m === 0xc0) {
      const nf = buf[start + 5];
      const comps = [];
      for (let c = 0; c < nf; c++) {
        const off = start + 6 + c * 3;
        comps.push({ id: buf[off], samp: buf[off + 1], qt: buf[off + 2] });
      }
      sof = {
        p: buf[start],
        h: (buf[start + 1] << 8) | buf[start + 2],
        w: (buf[start + 3] << 8) | buf[start + 4],
        nf,
        comps,
      };
    } else if (m === 0xda) {
      const ns = buf[start];
      const comps = [];
      for (let c = 0; c < ns; c++) {
        const off = start + 1 + c * 2;
        const tdta = buf[off + 1];
        comps.push({ id: buf[off], dc: tdta >> 4, ac: tdta & 15 });
      }
      sos = { ns, comps };
      scanAt = end;
      break;
    }
    i = end;
  }
  if (!sof || !sos || scanAt < 0 || sof.p !== 8) return null;
  const bits = new Bits(buf, scanAt, buf.length);
  const order = sof.comps.map((c) => {
    const s = sos.comps.find((x) => x.id === c.id);
    return {
      ...c,
      hs: c.samp >> 4,
      vs: c.samp & 15,
      dcT: dht.dc[s?.dc ?? 0],
      acT: dht.ac[s?.ac ?? 0],
      q: dqt[c.qt] || Array(64).fill(1),
      pred: 0,
      sum: 0,
      n: 0,
    };
  });
  const hMax = Math.max(...order.map((c) => c.hs));
  const vMax = Math.max(...order.map((c) => c.vs));
  const mcusX = Math.ceil(sof.w / (8 * hMax));
  const mcusY = Math.ceil(sof.h / (8 * vMax));
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      for (const c of order) {
        const blocks = c.hs * c.vs;
        for (let b = 0; b < blocks; b++) {
          const ssss = huffNext(bits, c.dcT);
          const diff = receive(bits, ssss);
          c.pred += diff;
          const dc = c.pred * (c.q[0] || 1);
          c.sum += dc / 8 + 128;
          c.n += 1;
          skipAc(bits, c.acT);
        }
      }
    }
  }
  const yComp = order[0];
  const y = yComp.n ? yComp.sum / yComp.n : 0;
  let cb = 128;
  let cr = 128;
  if (order[1]) cb = order[1].sum / Math.max(1, order[1].n);
  if (order[2]) cr = order[2].sum / Math.max(1, order[2].n);
  const r = y + 1.402 * (cr - 128);
  const g = y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128);
  const b = y + 1.772 * (cb - 128);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const rgb = [clamp(r), clamp(g), clamp(b)].map((v) => Math.round(v));
  const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return { rgb, luma };
}

export function jpegMeanLuma(buf) {
  const mean = jpegMean(buf);
  return mean && Number.isFinite(mean.luma) ? mean.luma : null;
}

export function fileMeanLuma(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return jpegMeanLuma(readFileSync(path));
  } catch {
    return null;
  }
}
