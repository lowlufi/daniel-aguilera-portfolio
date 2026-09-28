// Tiny synthesized sound kit — no audio files to download.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let waves: GainNode | null = null;
let muted = false;

export function initAudio(startMuted: boolean) {
  muted = startMuted;
  if (ctx) {
    ctx.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
  startWaves();
}

export function setMuted(m: boolean) {
  muted = m;
  if (!ctx || !master) return;
  master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.08);
}

function noiseBuffer(seconds: number) {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Soft ocean: looping filtered noise with a slow swell.
function startWaves() {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(4);
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  waves = c.createGain();
  waves.gain.value = 0.05;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.12;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.035;
  lfo.connect(lfoGain).connect(waves.gain);
  src.connect(lp).connect(waves).connect(master!);
  src.start();
  lfo.start();
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  snip() {
    if (!ctx || !master || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.12);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3200 + Math.random() * 1400;
    hp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    src.connect(hp).connect(g).connect(master);
    src.start(t);
  },
  step() {
    tone(180 + Math.random() * 40, 0.05, 'triangle', 0.035);
  },
  talk() {
    // "Villager-speak": a quick random-pitch blip per few letters.
    const notes = [523, 587, 659, 784, 880];
    tone(notes[Math.floor(Math.random() * notes.length)] * (Math.random() < 0.5 ? 1 : 0.75), 0.06, 'square', 0.025);
  },
  open() {
    tone(660, 0.09, 'sine', 0.12);
    tone(990, 0.12, 'sine', 0.1, 0.07);
  },
  close() {
    tone(740, 0.08, 'sine', 0.09);
    tone(494, 0.1, 'sine', 0.08, 0.06);
  },
  select() {
    tone(880, 0.05, 'triangle', 0.07);
  },
  star() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.18, 'sine', 0.1, i * 0.06));
  },
  reveal() {
    tone(1318, 0.25, 'sine', 0.06, 0, 1760);
  },
  achievement() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.09, i * 0.09));
  },
};
