// Synthesized sound kit + ambient mixer. Everything is generated with the
// Web Audio API, so there are no audio files to download or license.

export type AmbientId = 'lluvia' | 'truenos' | 'viento' | 'pajaritos' | 'olas' | 'grillos' | 'fogata' | 'arroyo' | 'musica' | 'ruido';

export const AMBIENTS: { id: AmbientId; label: string; emoji: string }[] = [
  { id: 'lluvia', label: 'Lluvia', emoji: '🌧️' },
  { id: 'truenos', label: 'Truenos', emoji: '⛈️' },
  { id: 'viento', label: 'Viento', emoji: '🍃' },
  { id: 'pajaritos', label: 'Pajaritos', emoji: '🐦' },
  { id: 'olas', label: 'Olas', emoji: '🌊' },
  { id: 'grillos', label: 'Grillos', emoji: '🦗' },
  { id: 'fogata', label: 'Fogata', emoji: '🔥' },
  { id: 'arroyo', label: 'Arroyo', emoji: '💧' },
  { id: 'musica', label: 'Cajita musical', emoji: '🎶' },
  { id: 'ruido', label: 'Ruido de color', emoji: '🎚️' },
];

// Noise colors from the darkest (most bass) to the brightest spectrum.
export const NOISE_COLORS = [
  { label: 'Café', hex: '#8a5a3b' },
  { label: 'Rosa', hex: '#f08fb0' },
  { label: 'Blanco', hex: '#f4f1ea' },
  { label: 'Azul', hex: '#6fa8e8' },
  { label: 'Morado', hex: '#a07ae0' },
];

export type Mix = Partial<Record<AmbientId, number>>;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let sfxBus: GainNode | null = null;
let ambBus: GainNode | null = null;
let muted = false;
let ambientVolume = 0.8;
let scheduler = 0;
const levels: Record<AmbientId, number> = { lluvia: 0, truenos: 0, viento: 0, pajaritos: 0, olas: 0, grillos: 0, fogata: 0, arroyo: 0, musica: 0, ruido: 0 };
let noiseColor = 1;
const noiseGains: GainNode[] = [];
let white: AudioBuffer | null = null;
let pink: AudioBuffer | null = null;
let brown: AudioBuffer | null = null;

// Called when a thunder clap is scheduled, so the scene can flash.
let thunderListener: ((delayS: number) => void) | null = null;
export function onThunder(fn: ((delayS: number) => void) | null) {
  thunderListener = fn;
}

export function initAudio(startMuted: boolean) {
  muted = startMuted;
  if (ctx) {
    ctx.resume().catch(() => {});
    startScheduler();
    return;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  out = ctx.createGain();
  out.gain.value = muted ? 0 : 1;
  out.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.6;
  sfxBus.connect(out);
  ambBus = ctx.createGain();
  ambBus.gain.value = ambientVolume;
  ambBus.connect(out);
  white = makeNoise('white', 3);
  pink = makeNoise('pink', 4);
  brown = makeNoise('brown', 4);
  for (const id of Object.keys(levels) as AmbientId[]) applyLevel(id);
  startScheduler();
}

export function pauseAudio() {
  window.clearInterval(scheduler);
  scheduler = 0;
  ctx?.suspend().catch(() => {});
}

function startScheduler() {
  if (scheduler) return;
  scheduler = window.setInterval(tick, 100);
}

export function setMuted(m: boolean) {
  muted = m;
  if (!ctx || !out) return;
  out.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.08);
}

export function setAmbientVolume(v: number) {
  ambientVolume = v;
  if (ctx && ambBus) ambBus.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
}

export function setAmbient(id: AmbientId, v: number) {
  levels[id] = v;
  applyLevel(id);
}

// 0 = café, 1 = rosa, 2 = blanco, 3 = azul, 4 = morado; values in between blend.
export function setNoiseColor(c: number) {
  noiseColor = Math.min(4, Math.max(0, c));
  applyNoiseColor();
}

function applyNoiseColor() {
  if (!ctx || !noiseGains.length) return;
  noiseGains.forEach((g, i) => {
    const d = Math.abs(noiseColor - i);
    // Equal-power crossfade between the two nearest colors.
    const v = d >= 1 ? 0 : Math.cos((d * Math.PI) / 2);
    g.gain.setTargetAtTime(v, ctx!.currentTime, 0.12);
  });
}

export function setMix(mix: Mix) {
  for (const id of Object.keys(levels) as AmbientId[]) setAmbient(id, mix[id] ?? 0);
}

/* ---------------- building blocks ---------------- */

function makeNoise(kind: 'white' | 'pink' | 'brown', seconds: number) {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

// Blue and violet noise are the first difference of pink and white noise.
function differentiate(src: AudioBuffer) {
  const c = ctx!;
  const buf = c.createBuffer(1, src.length, c.sampleRate);
  const a = src.getChannelData(0);
  const d = buf.getChannelData(0);
  for (let i = 1; i < a.length; i++) d[i] = a[i] - a[i - 1];
  return buf;
}

function normalize(buf: AudioBuffer, rms: number) {
  const d = buf.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
  const k = rms / Math.sqrt(sum / d.length || 1);
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return buf;
}

function loop(buf: AudioBuffer) {
  const s = ctx!.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.loopStart = Math.random() * (buf.duration - 0.5);
  s.start(0, s.loopStart);
  return s;
}

function filter(type: BiquadFilterType, freq: number, q = 0.7) {
  const f = ctx!.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(v: number) {
  const g = ctx!.createGain();
  g.gain.value = v;
  return g;
}

function lfo(freq: number, depth: number, target: AudioParam) {
  const o = ctx!.createOscillator();
  o.frequency.value = freq;
  const g = gain(depth);
  o.connect(g).connect(target);
  o.start();
}

function panner(p: number): AudioNode {
  if (!ctx!.createStereoPanner) return gain(1);
  const s = ctx!.createStereoPanner();
  s.pan.value = p;
  return s;
}

function note(dest: AudioNode, t: number, freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, attack = 0.008) {
  const o = ctx!.createOscillator();
  const g = ctx!.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function burst(dest: AudioNode, t: number, dur: number, freq: number, vol: number, buf = white!) {
  const s = ctx!.createBufferSource();
  s.buffer = buf;
  const f = filter('bandpass', freq, 1.2);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random() * (buf.duration - 0.2), dur + 0.02);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/* ---------------- ambient channels ---------------- */

type Channel = { bus: GainNode | null; next: number; state: Record<string, number>; build: (bus: GainNode) => void; tick?: (ch: Channel, now: number) => void };

const channels: Record<AmbientId, Channel> = {
  lluvia: {
    bus: null,
    next: 0,
    state: {},
    build(bus) {
      loop(pink!).connect(filter('highpass', 280)).connect(filter('lowpass', 5200)).connect(gain(0.9)).connect(bus);
      loop(brown!).connect(filter('lowpass', 420)).connect(gain(0.35)).connect(bus);
    },
    tick(ch, now) {
      while (ch.next < now + 0.3) {
        const t = Math.max(ch.next, now);
        note(ch.bus!, t, rand(1600, 4200), 0.03, 'sine', rand(0.015, 0.06));
        ch.next = t + rand(0.02, 0.1);
      }
    },
  },
  truenos: {
    bus: null,
    next: 0,
    state: {},
    build() {},
    tick(ch, now) {
      if (!ch.next) ch.next = now + rand(2, 5);
      if (ch.next > now + 0.3) return;
      const t = Math.max(ch.next, now);
      const s = ctx!.createBufferSource();
      s.buffer = brown!;
      const f = ctx!.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1100, t);
      f.frequency.exponentialRampToValueAtTime(90, t + 1.6);
      const g = ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.3, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.8);
      s.connect(f).connect(g).connect(ch.bus!);
      s.start(t, rand(0, 1), 5);
      thunderListener?.(t - now);
      ch.next = t + rand(11, 26);
    },
  },
  viento: {
    bus: null,
    next: 0,
    state: {},
    build(bus) {
      const bp = filter('bandpass', 520, 0.9);
      const g = gain(0.7);
      loop(pink!).connect(bp).connect(g).connect(bus);
      lfo(0.07, 320, bp.frequency);
      lfo(0.11, 0.45, g.gain);
      const hi = filter('bandpass', 1400, 3);
      const g2 = gain(0.12);
      loop(white!).connect(hi).connect(g2).connect(bus);
      lfo(0.05, 500, hi.frequency);
    },
  },
  pajaritos: {
    bus: null,
    next: 0,
    state: {},
    build() {},
    tick(ch, now) {
      while (ch.next < now + 0.3) {
        const t = Math.max(ch.next, now);
        const p = panner(rand(-0.85, 0.85));
        p.connect(ch.bus!);
        const kind = Math.random();
        const vol = rand(0.05, 0.11);
        if (kind < 0.4) {
          const base = rand(3000, 4300);
          const n = Math.floor(rand(5, 10));
          for (let i = 0; i < n; i++) note(p, t + i * 0.06, base + (i % 2 ? 260 : -120), 0.045, 'sine', vol);
        } else if (kind < 0.7) {
          const a = rand(1800, 2400);
          note(p, t, a, 0.22, 'sine', vol, a * 1.4, 0.03);
          note(p, t + 0.3, a * 1.35, 0.28, 'sine', vol * 0.9, a * 1.05, 0.03);
        } else {
          const n = Math.floor(rand(2, 5));
          for (let i = 0; i < n; i++) note(p, t + i * 0.13, rand(2400, 2800), 0.06, 'sine', vol, rand(4000, 4800));
        }
        ch.next = t + rand(0.5, 2.6);
      }
    },
  },
  olas: {
    bus: null,
    next: 0,
    state: {},
    build(bus) {
      const body = gain(0.55);
      loop(brown!).connect(filter('lowpass', 650)).connect(body).connect(bus);
      lfo(0.085, 0.42, body.gain);
      const foam = gain(0.06);
      loop(white!).connect(filter('highpass', 2600)).connect(foam).connect(bus);
      lfo(0.085, 0.05, foam.gain);
    },
  },
  grillos: {
    bus: null,
    next: 0,
    state: { a: 0, b: 0 },
    build() {},
    tick(ch, now) {
      for (const k of ['a', 'b'] as const) {
        if (ch.state[k] > now + 0.3) continue;
        const t = Math.max(ch.state[k], now);
        const p = panner(k === 'a' ? -0.55 : 0.6);
        p.connect(ch.bus!);
        const f = k === 'a' ? 4350 : 4620;
        for (let i = 0; i < 3; i++) note(p, t + i * 0.042, f, 0.022, 'sine', 0.05, undefined, 0.004);
        ch.state[k] = t + rand(0.55, 0.9);
      }
    },
  },
  fogata: {
    bus: null,
    next: 0,
    state: {},
    build(bus) {
      loop(brown!).connect(filter('lowpass', 320)).connect(gain(0.7)).connect(bus);
    },
    tick(ch, now) {
      while (ch.next < now + 0.3) {
        const t = Math.max(ch.next, now);
        const pop = Math.random() < 0.08;
        burst(ch.bus!, t, pop ? rand(0.02, 0.05) : rand(0.004, 0.014), pop ? rand(600, 1400) : rand(1800, 5200), pop ? rand(0.4, 0.8) : rand(0.08, 0.35));
        ch.next = t - Math.log(1 - Math.random()) * 0.07;
      }
    },
  },
  arroyo: {
    bus: null,
    next: 0,
    state: {},
    build(bus) {
      const src = loop(white!);
      const bps = [700, 1400, 2300].map((f) => {
        const bp = filter('bandpass', f, 5);
        src.connect(bp).connect(gain(0.55)).connect(bus);
        return bp;
      });
      (channels.arroyo as Channel & { bps?: BiquadFilterNode[] }).bps = bps;
      loop(brown!).connect(filter('lowpass', 480)).connect(gain(0.3)).connect(bus);
    },
    tick(ch, now) {
      const bps = (ch as Channel & { bps?: BiquadFilterNode[] }).bps;
      bps?.forEach((bp, i) => bp.frequency.setTargetAtTime(rand(500, 1200) * (i + 1), now, 0.04));
    },
  },
  ruido: {
    bus: null,
    next: 0,
    state: {},
    build(bus) {
      const bufs = [
        normalize(makeNoise('brown', 4), 0.3),
        normalize(makeNoise('pink', 4), 0.24),
        normalize(makeNoise('white', 4), 0.18),
        normalize(differentiate(makeNoise('pink', 4)), 0.14),
        normalize(differentiate(makeNoise('white', 4)), 0.1),
      ];
      noiseGains.length = 0;
      bufs.forEach((b) => {
        const g = gain(0);
        loop(b).connect(g).connect(bus);
        noiseGains.push(g);
      });
      applyNoiseColor();
    },
  },
  musica: {
    bus: null,
    next: 0,
    state: { beat: 0 },
    build(bus) {
      // A little room: feedback delay into a soft lowpass.
      const wet = gain(1);
      const delay = ctx!.createDelay(1);
      delay.delayTime.value = 0.38;
      const fb = gain(0.38);
      wet.connect(delay).connect(fb).connect(delay);
      delay.connect(filter('lowpass', 2600)).connect(gain(0.6)).connect(bus);
      wet.connect(bus);
      (channels.musica as Channel & { wet?: GainNode }).wet = wet;
    },
    tick(ch, now) {
      const wet = (ch as Channel & { wet?: GainNode }).wet;
      if (!wet) return;
      // C – Am – F – G, gentle pentatonic melody on top.
      const chords = [
        [261.63, 329.63, 392.0, 523.25, 659.25],
        [220.0, 261.63, 329.63, 440.0, 523.25],
        [174.61, 261.63, 349.23, 440.0, 523.25],
        [196.0, 293.66, 392.0, 493.88, 587.33],
      ];
      const beatLen = 0.52;
      while (ch.next < now + 0.3) {
        const t = Math.max(ch.next, now);
        const beat = ch.state.beat++;
        const chord = chords[Math.floor(beat / 8) % chords.length];
        if (beat % 8 === 0) note(wet, t, chord[0] / 2, 3.2, 'sine', 0.07, undefined, 0.05);
        if (Math.random() < 0.72) {
          const f = chord[1 + Math.floor(Math.random() * 4)] * (Math.random() < 0.3 ? 2 : 1);
          note(wet, t, f, 1.8, 'triangle', 0.05);
          note(wet, t, f * 2, 0.9, 'sine', 0.015);
        }
        ch.next = t + beatLen * (Math.random() < 0.15 ? 2 : 1);
      }
    },
  },
};

function applyLevel(id: AmbientId) {
  if (!ctx || !ambBus) return;
  const ch = channels[id];
  const v = levels[id];
  if (!ch.bus) {
    if (v <= 0) return;
    ch.bus = gain(0);
    ch.bus.connect(ambBus);
    ch.build(ch.bus);
    ch.next = 0;
  }
  ch.bus.gain.setTargetAtTime(v * v, ctx.currentTime, 0.35);
}

function tick() {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  for (const id of Object.keys(channels) as AmbientId[]) {
    const ch = channels[id];
    if (!ch.bus || !ch.tick || levels[id] < 0.01) continue;
    if (ch.next < now - 1) ch.next = now;
    ch.tick(ch, now);
  }
}

/* ---------------- one-shot effects ---------------- */

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
  if (!ctx || !sfxBus || muted) return;
  note(sfxBus, ctx.currentTime + delay, freq, dur, type, vol, slideTo, 0.012);
}

export const sfx = {
  snip() {
    if (!ctx || !sfxBus || muted) return;
    burst(sfxBus, ctx.currentTime, 0.11, 3200 + Math.random() * 1400, 0.3);
  },
  water() {
    if (!ctx || !sfxBus || muted) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 18; i++) burst(sfxBus, t + i * 0.06 + Math.random() * 0.04, 0.05, rand(900, 2400), 0.12, pink!);
  },
  pop() {
    [523, 784, 1047].forEach((f, i) => tone(f, 0.12, 'triangle', 0.1, i * 0.05, f * 1.5));
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
