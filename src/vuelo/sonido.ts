import { sampleOut } from '../game/audio';

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

/** Plays a one-shot. Returns false if it isn't loaded yet. */
export function suena(n: Muestra, o: { vol?: number; rate?: number; pan?: number } = {}) {
  const out = sampleOut();
  const buf = buffers.get(n);
  if (!out || !buf || out.ctx.state !== 'running') return !!buf;
  const { ctx } = out;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = o.rate ?? 1;
  const g = ctx.createGain();
  g.gain.value = o.vol ?? 1;
  let node: AudioNode = src.connect(g);
  if (o.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    node = node.connect(p);
  }
  node.connect(out.dest);
  src.start();
  return true;
}

type Loop = { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | null };
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
