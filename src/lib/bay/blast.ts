import { armLoadWindow, resetLoads, sampleHinge } from "@/lib/bay/atd";
import { stepAllCooks } from "@/lib/bay/cook";
import { coverAabbHit } from "@/lib/bay/cover";
import { listSamplers, log, note, probeTime } from "@/lib/bay/probe";
import { playEvent } from "@/lib/contain/audio";
import { useBay } from "@/store/bay-store";
import { carriedHang, onRide, ridePeakY } from "@/lib/bay/ride";

const FUSE_GEN = 4;

const g = globalThis as unknown as {
  __bayFuseClock?: ReturnType<typeof setInterval>;
  __bayFuseLast?: number;
  __bayFuseGen?: number;
  __bayKickFuse?: () => void;
};

function bangPos(id: string, fallback?: [number, number, number]) {
  const p = listSamplers().get(id)?.sample();
  if (p && !p.state?.missing) return { x: p.x, y: p.y, z: p.z };
  const ent = useBay.getState().entities.find((e) => e.id === id);
  if (ent) return { x: ent.pos[0], y: ent.pos[1], z: ent.pos[2] };
  return { x: fallback?.[0] ?? 0, y: fallback?.[1] ?? 0.09, z: fallback?.[2] ?? 0 };
}

function recent(type: string, windowS = 0.35) {
  const t0 = probeTime();
  return log().some((e) => e.type === type && e.t >= t0 - windowS);
}

/** If the ragdoll never heard the bang (hidden tab / rapier still down), still score the hit. */
function ensureDummyOutcome(x: number, y: number, z: number, power: number) {
  if (power < 4) return;
  if (recent("dummy-flop") || recent("cover-block")) return;
  const dummy = useBay.getState().entities.find((e) => e.kind === "dummy");
  if (!dummy) return;
  const hips = listSamplers().get(`${dummy.id}-hips`);
  const body = hips?.getBody?.();
  const live = body?.translation();
  const vy = body?.linvel()?.y ?? 0;
  if (onRide(dummy.id) && live) {
    if (!carriedHang(live.y, vy, ridePeakY())) return;
  }
  const p = live
    ? { x: live.x, y: live.y, z: live.z }
    : { x: dummy.pos[0], y: dummy.pos[1] + 0.74, z: dummy.pos[2] };
  const dist = Math.hypot(p.x - x, p.z - z);
  resetLoads(dummy.id);
  armLoadWindow(0.55);
  if (dist > 3.5) return;
  const fall = Math.min(1, 0.7 / Math.max(0.35, dist));
  const kick = Math.min(2.35, (1.4 + power * 0.07) * fall);
  if (kick < 0.9) return;
  const block = coverAabbHit({ x, y, z }, p);
  if (block.hit) {
    note("cover-block", {
      id: dummy.id,
      kind: block.kind,
      toi: Math.round(block.toi * 1000) / 1000,
      x: p.x,
      z: p.z,
    });
    return;
  }
  const load = Math.max(0.55, kick * 1.7);
  sampleHinge(dummy.id, "lumbar", load);
  sampleHinge(dummy.id, "upper-neck", load * 0.72);
  sampleHinge(dummy.id, "femur-l", load * 0.9);
  sampleHinge(dummy.id, "femur-r", load * 0.9);
  note("dummy-flop", { id: dummy.id, n: 11, x: p.x, z: p.z, via: "script" });
}

export function tickFuse(dt = 0.05) {
  if (typeof window === "undefined") return;
  for (const bang of stepAllCooks(dt)) {
    const p = bangPos(bang.id, bang.pos);
    note("grenade-boom", { id: bang.id, x: p.x, y: p.y, z: p.z, boom: bang.boom });
    playEvent("bang", "nmc");
    window.dispatchEvent(new CustomEvent("bay-blast", { detail: { x: p.x, y: p.y, z: p.z, power: bang.boom } }));
    queueMicrotask(() => ensureDummyOutcome(p.x, p.y, p.z, bang.boom));
  }
}

g.__bayKickFuse = () => tickFuse(0.05);

/** Wall-clock fuse so a hidden tab still bangs. Restarts after HMR. */
export function ensureFuseClock() {
  if (typeof window === "undefined") return;
  g.__bayKickFuse = () => tickFuse(0.05);
  if (g.__bayFuseClock && g.__bayFuseGen === FUSE_GEN) return;
  if (g.__bayFuseClock) {
    clearInterval(g.__bayFuseClock);
    g.__bayFuseClock = undefined;
  }
  g.__bayFuseGen = FUSE_GEN;
  g.__bayFuseLast = performance.now();
  g.__bayFuseClock = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.25, (t - (g.__bayFuseLast ?? t)) / 1000);
    g.__bayFuseLast = t;
    tickFuse(dt);
  }, 50);
}
