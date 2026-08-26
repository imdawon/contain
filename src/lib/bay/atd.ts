import { note, probeTime } from "@/lib/bay/probe";

/**
 * Toy Hybrid III 50th names mapped onto the 1-axis hinges we already have.
 * Video-game physics. Not a certified ATD.
 */
export const HINGE_IDS = [
  "upper-neck",
  "lumbar",
  "shoulder-l",
  "shoulder-r",
  "humerus-lower-l",
  "humerus-lower-r",
  "femur-l",
  "femur-r",
  "knee-l",
  "knee-r",
] as const;

export type HingeId = (typeof HINGE_IDS)[number];

export const HINGE_LABEL: Record<HingeId, string> = {
  "upper-neck": "Upper neck",
  lumbar: "Lumbar",
  "shoulder-l": "Shoulder L",
  "shoulder-r": "Shoulder R",
  "humerus-lower-l": "Humerus lower L",
  "humerus-lower-r": "Humerus lower R",
  "femur-l": "Femur L",
  "femur-r": "Femur R",
  "knee-l": "Knee L",
  "knee-r": "Knee R",
};

type Peak = { mag: number; n: number; noted: boolean };

const g = globalThis as unknown as {
  __bayLoads?: { peaks: Map<string, Peak>; until: number };
};
const store = (g.__bayLoads ??= { peaks: new Map<string, Peak>(), until: 0 });

function key(dummyId: string, hinge: string) {
  return `${dummyId}:${hinge}`;
}

export function armLoadWindow(seconds = 0.5) {
  store.peaks.clear();
  store.until = probeTime() + seconds;
}

export function resetLoads(dummyId: string) {
  for (const id of HINGE_IDS) store.peaks.delete(key(dummyId, id));
  store.peaks.delete(key(dummyId, "femur-l-contact"));
  store.peaks.delete(key(dummyId, "femur-r-contact"));
  store.peaks.delete(key(dummyId, "humerus-l-contact"));
  store.peaks.delete(key(dummyId, "humerus-r-contact"));
}

type JointLike = {
  isValid(): boolean;
  body1(): { linvel(): Vec; angvel(): Vec; invMass(): number } | null;
  body2(): { linvel(): Vec; angvel(): Vec; invMass(): number } | null;
  impulse?: () => number | Vec;
};

type Vec = { x: number; y: number; z: number };

/** Rapier JS does not bind ImpulseJoint.impulse; this is the solver-equivalent toy load. */
export function toyJointImpulse(joint: JointLike): number {
  if (typeof joint.impulse === "function") {
    try {
      const v = joint.impulse();
      if (typeof v === "number") return Math.abs(v);
      if (v && typeof v === "object") return Math.hypot(v.x ?? 0, v.y ?? 0, v.z ?? 0);
    } catch {
      /* fall through */
    }
  }
  if (!joint.isValid()) return 0;
  const a = joint.body1();
  const b = joint.body2();
  if (!a || !b) return 0;
  const va = a.linvel();
  const vb = b.linvel();
  const wa = a.angvel();
  const wb = b.angvel();
  const dv = Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
  const dw = Math.hypot(wb.x - wa.x, wb.y - wa.y, wb.z - wa.z);
  const inv = a.invMass() + b.invMass();
  const mu = inv > 1e-6 ? 1 / inv : 0;
  return mu * dv + 0.12 * dw;
}

export function sampleHinge(dummyId: string, hinge: HingeId, mag: number) {
  if (!Number.isFinite(mag) || mag <= 0) return;
  const k = key(dummyId, hinge);
  const prev = store.peaks.get(k) ?? { mag: 0, n: 0, noted: false };
  prev.n += 1;
  if (mag > prev.mag) prev.mag = mag;
  store.peaks.set(k, prev);
  if (!prev.noted && mag > 0.04 && probeTime() <= store.until) {
    prev.noted = true;
    note("hinge-load", {
      id: dummyId,
      hinge,
      label: HINGE_LABEL[hinge],
      mag: Math.round(mag * 1000) / 1000,
    });
  }
}

export function sampleContact(dummyId: string, hinge: HingeId, mag: number) {
  if (!Number.isFinite(mag) || mag <= 0.05) return;
  const k = key(dummyId, `${hinge}-contact`);
  const prev = store.peaks.get(k) ?? { mag: 0, n: 0, noted: false };
  prev.n += 1;
  if (mag > prev.mag) prev.mag = mag;
  store.peaks.set(k, prev);
  if (!prev.noted && probeTime() <= store.until) {
    prev.noted = true;
    note("contact-load", {
      id: dummyId,
      hinge,
      mag: Math.round(mag * 1000) / 1000,
      via: "contact",
    });
  }
}

export function hingeSnapshot(dummyId?: string) {
  const out: Record<string, number> = {};
  for (const [k, v] of store.peaks) {
    if (dummyId && !k.startsWith(`${dummyId}:`)) continue;
    const colon = k.indexOf(":");
    const hinge = colon >= 0 ? k.slice(colon + 1) : k;
    const mag = Math.round(v.mag * 1000) / 1000;
    out[hinge] = Math.max(out[hinge] ?? 0, mag);
  }
  return out;
}
