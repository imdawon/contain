type Bus = {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  hiss: GainNode;
  roar: GainNode;
  hissFilter: BiquadFilterNode;
  roarFilter: BiquadFilterNode;
  noise: AudioBufferSourceNode;
};

let bus: Bus | null = null;
let muted = false;
const fireSrc = new Map<string, { smoke: number; flame: number }>();

function noiseBuffer(ctx: AudioContext) {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function unlockAudio() {
  if (!bus) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: "interactive" });
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    const hiss = ctx.createGain();
    const roar = ctx.createGain();
    const hissFilter = ctx.createBiquadFilter();
    const roarFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 1800;
    hissFilter.Q.value = 0.7;
    roarFilter.type = "lowpass";
    roarFilter.frequency.value = 420;
    hiss.gain.value = 0;
    roar.gain.value = 0;
    sfx.gain.value = 0.9;
    master.gain.value = muted ? 0 : 0.55;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    src.connect(hissFilter);
    src.connect(roarFilter);
    hissFilter.connect(hiss);
    roarFilter.connect(roar);
    hiss.connect(master);
    roar.connect(master);
    sfx.connect(master);
    master.connect(ctx.destination);
    src.start();
    bus = { ctx, master, sfx, hiss, roar, hissFilter, roarFilter, noise: src };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void ctx.resume();
    });
  }
  if (bus.ctx.state === "suspended") void bus.ctx.resume();
}

export function setMuted(next: boolean) {
  muted = next;
  if (bus) bus.master.gain.setTargetAtTime(next ? 0 : 0.55, bus.ctx.currentTime, 0.02);
}

export function isMuted() {
  return muted;
}

function beep(freq: number, dur: number, gain = 0.12, type: OscillatorType = "square") {
  if (!bus || muted) return;
  const { ctx, sfx } = bus;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(g);
  g.connect(sfx);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

function pin(param: AudioParam, now: number) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
}

function rampTo(param: AudioParam, value: number, now: number, dur: number) {
  pin(param, now);
  param.linearRampToValueAtTime(Math.max(0, value), now + Math.max(0.02, dur));
}

function setLoop(hissTo: number, roarTo: number, hold = 0) {
  if (!bus) return;
  const now = bus.ctx.currentTime;
  rampTo(bus.hiss.gain, hissTo, now, 0.08);
  rampTo(bus.roar.gain, roarTo, now, 0.08);
  if (hold > 0) {
    const t = now + hold;
    bus.hiss.gain.linearRampToValueAtTime(0, t);
    bus.roar.gain.linearRampToValueAtTime(0, t);
  }
}

function mixFire() {
  let smoke = 0;
  let flame = 0;
  for (const s of fireSrc.values()) {
    smoke = Math.max(smoke, s.smoke);
    flame = Math.max(flame, s.flame);
  }
  if (smoke <= 0.001 && flame <= 0.001) {
    silenceLoops();
    return;
  }
  applyFireMix(smoke, flame);
}

export function reportFire(id: string, smoke: number, flame: number) {
  if (smoke <= 0.001 && flame <= 0.001) fireSrc.delete(id);
  else fireSrc.set(id, { smoke, flame });
  mixFire();
}

export function playEvent(type: string, chem: "nmc" | "lfp") {
  if (!bus) return;
  switch (type) {
    case "puncture":
      beep(180, 0.08, 0.16, "sawtooth");
      beep(920, 0.04, 0.08, "square");
      break;
    case "pin":
      beep(1480, 0.04, 0.1, "square");
      beep(420, 0.09, 0.08, "triangle");
      break;
    case "tick":
      beep(1680, 0.028, 0.05, "square");
      break;
    case "bang":
      beep(26, 0.55, 0.72, "sawtooth");
      beep(48, 0.22, 0.48, "sawtooth");
      beep(210, 0.07, 0.22, "square");
      setLoop(0.05, 0.18, 0.4);
      break;
    case "vent":
      setLoop(chem === "lfp" ? 0.12 : 0.08, 0, 1.2);
      break;
    case "runaway":
      beep(70, 0.22, 0.16, "sawtooth");
      beep(140, 0.18, 0.1, "square");
      break;
    case "jet":
      setLoop(0.06, 0.32, 0.7);
      beep(70, 0.3, 0.2, "sawtooth");
      break;
    case "burst":
      beep(28, 0.85, 0.55, "sawtooth");
      beep(52, 0.45, 0.42, "sawtooth");
      beep(90, 0.28, 0.28, "square");
      beep(160, 0.14, 0.16, "square");
      setLoop(0.16, 0.42, 1.8);
      break;
    case "lid":
      beep(160, 0.16, 0.2, "square");
      beep(70, 0.28, 0.18, "sawtooth");
      beep(320, 0.08, 0.08, "square");
      break;
    case "ignite":
      beep(240, 0.1, 0.1, "sawtooth");
      break;
    case "spent":
    case "verdict":
      silenceLoops();
      break;
    default:
      break;
  }
}

function applyFireMix(smoke: number, flame: number) {
  if (!bus) return;
  const now = bus.ctx.currentTime;
  rampTo(bus.hiss.gain, Math.min(0.24, Math.max(0, smoke) * 0.2), now, 0.08);
  rampTo(bus.roar.gain, Math.min(0.34, Math.max(0, flame) * 0.12), now, 0.08);
}

export function setFireMix(smoke: number, flame: number) {
  reportFire("mix", smoke, flame);
}

export function silenceLoops() {
  fireSrc.clear();
  if (!bus) return;
  const now = bus.ctx.currentTime;
  rampTo(bus.hiss.gain, 0, now, 0.12);
  rampTo(bus.roar.gain, 0, now, 0.12);
}

export function loopLevels() {
  if (!bus) return { hiss: 0, roar: 0 };
  return {
    hiss: Math.round(bus.hiss.gain.value * 1000) / 1000,
    roar: Math.round(bus.roar.gain.value * 1000) / 1000,
  };
}
