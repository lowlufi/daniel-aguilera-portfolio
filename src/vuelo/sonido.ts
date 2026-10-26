import { juegoCallado, sampleOut } from '../game/audio';

/*
 * Recorded sound effects for the plane game: CC0 field recordings from
 * Freesound (see public/sonidos/CREDITOS.txt), trimmed and compressed. They
 * play through the same effects bus as the chiptune sounds, so mute and the
 * master chain apply. Until a sample has loaded, callers fall back to the
 * synthesized version.
 */

export type Muestra =
  | 'misil' | 'explosion-chica' | 'explosion-grande' | 'bomba' | 'antiaereo'
  | 'alarma' | 'bengalas' | 'impacto' | 'recoger';
export type Motor = 'motor-avioneta' | 'motor-jet' | 'motor-bombardero' | 'motor-tanque';

/** Loop length of each engine file; every file has 0.15 s of wrapped padding on both ends. */
const LOOP: Record<Motor, number> = { 'motor-avioneta': 4.5, 'motor-jet': 4, 'motor-bombardero': 4, 'motor-tanque': 4.4 };
const PAD = 0.15;
const NAMES: (Muestra | Motor)[] = [
  'misil', 'explosion-chica', 'explosion-grande', 'bomba', 'antiaereo', 'alarma', 'bengalas', 'impacto', 'recoger',
  'motor-avioneta', 'motor-jet', 'motor-bombardero', 'motor-tanque',
];

const buffers = new Map<string, AudioBuffer>();
let loading = false;

/** Starts fetching every sample. Call after initAudio (needs the context). */
export function cargarSonidos() {
  const o = sampleOut();
  if (!o || loading) return;
  loading = true;
  for (const n of NAMES) {
    fetch(`/sonidos/${n}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => o.ctx.decodeAudioData(b))
      .then((buf) => buffers.set(n, buf))
      .catch(() => {
        /* the synthesized fallback keeps playing */
      });
  }
}

type Voz = { n: Muestra; src: AudioBufferSourceNode; g: GainNode; t: number };
const voces = new Set<Voz>();
// At most this many copies of a sample at once; the oldest fades out to make room.
// Rapid-fire samples (flak, flares) get tight caps so a burst never stacks into a wall.
const TOPE: Partial<Record<Muestra, number>> = {
  misil: 3, 'explosion-chica': 3, 'explosion-grande': 3, bomba: 3, impacto: 2, antiaereo: 3, bengalas: 2, recoger: 2,
};
const ultima = new Map<Muestra, number>();
/*
 * Per-file trims, measured against the battle synth: the metallic hit came
 * in 20 dB under everything else (the plane's own damage was the quietest
 * sound in the game), and the coin drop has 98 % of its energy above 10 kHz,
 * which the master low-pass removes, so it is played lower (a coin «clink»
 * instead of a near-ultrasonic tick). The rest already sit where they belong.
 */
const AJUSTE: Partial<Record<Muestra, { vol?: number; rate?: number }>> = {
  impacto: { vol: 2 },
  recoger: { vol: 1, rate: 0.55 },
  misil: { vol: 1.25 },
};

function apaga(v: Voz, ctx: BaseAudioContext, tc = 0.03) {
  const t = ctx.currentTime;
  v.g.gain.cancelScheduledValues(t);
  v.g.gain.setValueAtTime(v.g.gain.value, t);
  v.g.gain.linearRampToValueAtTime(0, t + tc);
  try {
    v.src.stop(t + tc + 0.01);
  } catch {
    /* already stopped */
  }
  voces.delete(v);
}

/** Silences every one-shot still ringing (pause, game over). */
export function callar() {
  const out = sampleOut();
  if (!out) return;
  for (const v of [...voces]) apaga(v, out.ctx, 0.05);
}

/**
 * Plays a one-shot. Returns false if it isn't loaded yet. `dur` cuts it short
 * with a fade, for a snappy version of a long sample.
 */
export function suena(n: Muestra, o: { vol?: number; rate?: number; pan?: number; dur?: number } = {}) {
  const out = sampleOut();
  const buf = buffers.get(n);
  if (!out || !buf || out.ctx.state !== 'running') return !!buf;
  if (juegoCallado()) return true; // the title's self-playing game is silent
  const aj = AJUSTE[n];
  if (aj) o = { ...o, vol: (o.vol ?? 1) * (aj.vol ?? 1), rate: (o.rate ?? 1) * (aj.rate ?? 1) };
  const { ctx } = out;
  const now = ctx.currentTime;
  // Copies closer than 40 ms blur into one: skip them.
  if (now - (ultima.get(n) ?? -1) < 0.04) return true;
  ultima.set(n, now);
  const tope = TOPE[n];
  if (tope) {
    const mias = [...voces].filter((v) => v.n === n);
    if (mias.length >= tope) apaga(mias.reduce((a, b) => (a.t < b.t ? a : b)), ctx);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = o.rate ?? 1;
  const g = ctx.createGain();
  g.gain.value = o.vol ?? 1;
  if (o.dur) {
    g.gain.setValueAtTime(o.vol ?? 1, now + Math.max(0, o.dur - 0.08));
    g.gain.linearRampToValueAtTime(0, now + o.dur);
  }
  const v: Voz = { n, src, g, t: now };
  voces.add(v);
  src.onended = () => voces.delete(v);
  let node: AudioNode = src.connect(g);
  if (o.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    node = node.connect(p);
  }
  node.connect(out.dest);
  src.start();
  // Cut short with a fade (the stop must come after start).
  if (o.dur) src.stop(now + o.dur + 0.02);
  return true;
}

type Loop = { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | null; quieto?: number };
const loops = new Map<Motor, Loop>();

/**
 * Keeps an engine loop running at the given volume, pitch and pan; values
 * glide so they never click. Volume 0 fades it out but keeps it ready.
 */
export function motor(n: Motor, vol: number, rate: number, pan = 0) {
  const out = sampleOut();
  const buf = buffers.get(n);
  if (!out || !buf) return;
  const { ctx } = out;
  let l = loops.get(n);
  if (!l) {
    if (vol < 0.005) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = PAD;
    src.loopEnd = PAD + LOOP[n];
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(gain);
    (p ? gain.connect(p) : gain).connect(out.dest);
    src.start(ctx.currentTime, PAD + Math.random() * LOOP[n]);
    l = { src, gain, pan: p };
    loops.set(n, l);
  }
  const t = ctx.currentTime;
  // A loop left silent for a while is stopped and freed; it's rebuilt when needed.
  if (vol < 0.005) {
    l.quieto = (l.quieto ?? 0) + 1;
    if (l.quieto > 90) {
      try {
        l.src.stop();
      } catch {
        /* already stopped */
      }
      l.src.disconnect();
      l.gain.disconnect();
      l.pan?.disconnect();
      loops.delete(n);
      return;
    }
  } else l.quieto = 0;
  l.gain.gain.setTargetAtTime(Math.max(0, vol), t, 0.08);
  l.src.playbackRate.setTargetAtTime(Math.max(0.3, Math.min(2.5, rate)), t, 0.12);
  l.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
}

export function pararMotores() {
  for (const l of loops.values()) {
    try {
      l.src.stop();
    } catch {
      /* already stopped */
    }
    l.src.disconnect();
    l.gain.disconnect();
    l.pan?.disconnect();
  }
  loops.clear();
}
