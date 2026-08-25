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

export function playEvent(type: string, chem: "nmc" | "lfp") {
  if (!bus) return;
  const { ctx, hiss, roar } = bus;
  const now = ctx.currentTime;
  switch (type) {
    case "puncture":
      beep(180, 0.08, 0.16, "sawtooth");
      beep(920, 0.04, 0.08, "square");
      break;
    case "vent":
      hiss.gain.setTargetAtTime(chem === "lfp" ? 0.12 : 0.08, now, 0.08);
      break;
    case "runaway":
      roar.gain.setTargetAtTime(chem === "nmc" ? 0.22 : 0.08, now, 0.12);
      hiss.gain.setTargetAtTime(chem === "lfp" ? 0.18 : 0.1, now, 0.1);
      break;
    case "jet":
      roar.gain.setTargetAtTime(0.32, now, 0.04);
      beep(70, 0.3, 0.2, "sawtooth");
      break;
    case "burst":
      beep(42, 0.7, 0.38, "sawtooth");
      beep(90, 0.28, 0.22, "square");
      beep(180, 0.12, 0.1, "square");
      roar.gain.setTargetAtTime(0.05, now, 0.4);
      hiss.gain.setTargetAtTime(0.04, now, 0.4);
      break;
    case "lid":
      beep(160, 0.16, 0.2, "square");
      beep(70, 0.28, 0.18, "sawtooth");
      beep(320, 0.08, 0.08, "square");
      break;
    case "ignite":
      hiss.gain.setTargetAtTime(0.14, now, 0.1);
      break;
    case "spent":
    case "verdict":
      roar.gain.setTargetAtTime(0.0, now, 0.35);
      hiss.gain.setTargetAtTime(0.02, now, 0.5);
      break;
    default:
      break;
  }
}

export function setFireMix(smoke: number, flame: number) {
  if (!bus) return;
  const now = bus.ctx.currentTime;
  bus.hiss.gain.setTargetAtTime(Math.min(0.22, smoke * 0.18), now, 0.08);
  bus.roar.gain.setTargetAtTime(Math.min(0.3, flame * 0.08), now, 0.08);
}

export function silenceLoops() {
  if (!bus) return;
  const now = bus.ctx.currentTime;
  bus.hiss.gain.setTargetAtTime(0, now, 0.2);
  bus.roar.gain.setTargetAtTime(0, now, 0.2);
}
