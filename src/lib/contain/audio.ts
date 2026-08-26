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

function setLoop(hissTo: number, roarTo: number, hold = 0) {
  if (!bus) return;
  const now = bus.ctx.currentTime;
  bus.hiss.gain.cancelScheduledValues(now);
  bus.roar.gain.cancelScheduledValues(now);
  bus.hiss.gain.setTargetAtTime(Math.max(0, hissTo), now, 0.06);
  bus.roar.gain.setTargetAtTime(Math.max(0, roarTo), now, 0.06);
  if (hold > 0) {
    bus.hiss.gain.setTargetAtTime(0, now + hold, 0.28);
    bus.roar.gain.setTargetAtTime(0, now + hold, 0.28);
  }
}

export function playEvent(type: string, chem: "nmc" | "lfp") {
  if (!bus) return;
  switch (type) {
    case "puncture":
      beep(180, 0.08, 0.16, "sawtooth");
      beep(920, 0.04, 0.08, "square");
      break;
    case "vent":
      setLoop(chem === "lfp" ? 0.12 : 0.08, 0, 1.2);
      break;
    case "runaway":
      setLoop(chem === "lfp" ? 0.18 : 0.1, chem === "nmc" ? 0.22 : 0.08, 1.4);
      break;
    case "jet":
      setLoop(0.06, 0.32, 0.7);
      beep(70, 0.3, 0.2, "sawtooth");
      break;
    case "burst":
      beep(42, 0.55, 0.38, "sawtooth");
      beep(90, 0.22, 0.22, "square");
      beep(180, 0.1, 0.1, "square");
      setLoop(0.1, 0.26, 0.55);
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

export function setFireMix(smoke: number, flame: number) {
  if (!bus) return;
  const now = bus.ctx.currentTime;
  bus.hiss.gain.cancelScheduledValues(now);
  bus.roar.gain.cancelScheduledValues(now);
  bus.hiss.gain.setTargetAtTime(Math.min(0.18, Math.max(0, smoke) * 0.16), now, 0.08);
  bus.roar.gain.setTargetAtTime(Math.min(0.22, Math.max(0, flame) * 0.07), now, 0.08);
}

export function silenceLoops() {
  if (!bus) return;
  const now = bus.ctx.currentTime;
  bus.hiss.gain.cancelScheduledValues(now);
  bus.roar.gain.cancelScheduledValues(now);
  bus.hiss.gain.setTargetAtTime(0, now, 0.12);
  bus.roar.gain.setTargetAtTime(0, now, 0.12);
}

export function loopLevels() {
  if (!bus) return { hiss: 0, roar: 0 };
  return {
    hiss: Math.round(bus.hiss.gain.value * 1000) / 1000,
    roar: Math.round(bus.roar.gain.value * 1000) / 1000,
  };
}
