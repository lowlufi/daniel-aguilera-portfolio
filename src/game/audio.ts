// Synthesized chiptune sound kit: one original looping song and a set of
// 16-bit style sound effects. Everything is generated with the Web Audio API
// (pulse and triangle waves, sample-and-hold noise, a short echo), so there
// are no audio files to download or license.

/**
 * 'alegre' is the bouncy daytime arrangement of the island song, 'calma' a
 * slower, softer one. 'vuelo' is a second, faster song for the plane game.
 * 'titulo' is the title-screen march of the plane game.
 */
export type MusicMood = 'alegre' | 'calma' | 'vuelo' | 'titulo';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let echoIn: GainNode | null = null;
// Every run of a song plays through its own pair of gains (dry and echo send),
// so switching songs can fade out whatever is still sounding from the old one.
let songOut: GainNode | null = null;
let songEcho: GainNode | null = null;
let muted = false;
let musicVolume = 0.5;
let mood: MusicMood = 'alegre';
let scheduler = 0;
// End of the music's first fade-in: a volume change before it keeps the fade.
let fadeEnd = 0;
// Level multiplier applied by blip()/crunch(): the plane game's effects and
// the title jingles run louder than the island's (see sfxVuelo, menu).
let volMul = 1;
let noise: AudioBuffer | null = null;
const pulses: Partial<Record<number, PeriodicWave>> = {};

export function initAudio(startMuted: boolean) {
  muted = startMuted;
  if (ctx) {
    if (out) out.gain.value = muted ? 0 : 1;
    ctx.resume().catch(() => {});
    startScheduler();
    return;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  out = ctx.createGain();
  out.gain.value = muted ? 0 : 1;
  // Master chain: gentle compression keeps peaks in check, and a lowpass
  // rounds off the pulse waves the way the SNES output filter did.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 16;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.25;
  out.connect(filter('lowpass', 9000, 0.5)).connect(comp).connect(ctx.destination);

  // SPC700-ish echo: a filtered feedback delay of three sixteenths.
  echoIn = gain(1);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.31;
  const fb = gain(0.32);
  const tone = filter('lowpass', 2400, 0.6);
  echoIn.connect(delay).connect(tone).connect(fb).connect(delay);
  tone.connect(gain(0.55)).connect(out);

  sfxBus = gain(0.3);
  sfxBus.connect(out);
  musicBus = ctx.createGain();
  // The music fades in instead of starting at full volume.
  musicBus.gain.setValueAtTime(0, ctx.currentTime);
  musicBus.gain.linearRampToValueAtTime(musicLevel(), ctx.currentTime + 2);
  fadeEnd = ctx.currentTime + 2;
  musicBus.connect(out);

  noise = makeChipNoise(1.5);
  song.next = 0;
  song.step = 0;
  newSongOutput();
  startScheduler();
}

// Fades out the current song's gains (cutting any held notes) and opens a
// fresh pair for the next one.
function newSongOutput() {
  const c = ctx!;
  if (songOut && songEcho) {
    const oldOut = songOut, oldEcho = songEcho;
    oldOut.gain.setTargetAtTime(0, c.currentTime, 0.015);
    oldEcho.gain.setTargetAtTime(0, c.currentTime, 0.015);
    window.setTimeout(() => {
      oldOut.disconnect();
      oldEcho.disconnect();
    }, 1500);
  }
  // The title march sits a little under its jingles (they are its climax).
  const lvl = ARRANGEMENT[mood].tune === TITULO ? 0.75 : 1;
  songOut = gain(lvl);
  songOut.connect(musicBus!);
  songEcho = gain(lvl);
  songEcho.connect(echoIn!);
}

// Starts the current mood's song from its first bar after `delay` seconds,
// silencing what was playing.
function restartSong(delay: number) {
  if (!ctx || !musicBus) return;
  newSongOutput();
  song.arr = ARRANGEMENT[mood];
  song.step = 0;
  song.next = ctx.currentTime + delay;
}

export function pauseAudio() {
  window.clearInterval(scheduler);
  scheduler = 0;
  ctx?.suspend().catch(() => {});
}

function startScheduler() {
  if (scheduler) return;
  // The interval only wakes the scheduler up; every note is placed on the
  // AudioContext clock a little ahead of time, so timing never drifts.
  scheduler = window.setInterval(tick, 50);
}

export function setMuted(m: boolean) {
  muted = m;
  if (!ctx || !out) return;
  out.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.08);
}

const musicLevel = () => musicVolume * musicVolume * 0.9;

export function setMusicVolume(v: number) {
  musicVolume = Math.min(1, Math.max(0, v));
  if (!ctx || !musicBus) return;
  // Drop whatever was scheduled: a pending fade-in ramp would otherwise pull
  // the level back to the old volume when it ends (the title music used to
  // stay 12 dB down on the first visit). During the fade-in, aim the same ramp
  // at the new level; afterwards glide there.
  const t = ctx.currentTime;
  const g = musicBus.gain;
  const v0 = g.value;
  g.cancelScheduledValues(t);
  g.setValueAtTime(v0, t);
  if (t < fadeEnd) g.linearRampToValueAtTime(musicLevel(), fadeEnd);
  else g.setTargetAtTime(musicLevel(), t, 0.1);
}

/**
 * Switches the arrangement. Another arrangement of the same song takes effect
 * at the start of the next bar; a different song cuts the old one off and
 * starts from its first bar right away (or when a pending jingle ends).
 */
export function setMusicMood(m: MusicMood) {
  mood = m;
  if (!ctx || ARRANGEMENT[m].tune === song.arr.tune) return;
  restartSong(Math.max(0.06, song.next - ctx.currentTime));
}

/**
 * The audio context and the effects bus, for recorded samples played by the
 * plane game. Null until initAudio has run. Mute applies after the bus.
 */
export function sampleOut(): { ctx: AudioContext; dest: AudioNode } | null {
  return ctx && sfxBus ? { ctx, dest: sfxBus } : null;
}

/* ---------------- building blocks ---------------- */

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

// Band-limited pulse wave with the given duty cycle (0.125, 0.25, 0.5).
function pulse(duty: number) {
  let w = pulses[duty];
  if (w) return w;
  const n = 40;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
  w = ctx!.createPeriodicWave(re, im);
  pulses[duty] = w;
  return w;
}

// Sample-and-hold noise: each random value is held for a few samples, which
// gives the gritty, "crunchy" texture of console noise channels.
function makeChipNoise(seconds: number) {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < d.length; i++) {
    if (i % 6 === 0) v = Math.random() * 2 - 1;
    d[i] = v;
  }
  return buf;
}

type Wave = OscillatorType | number; // a number is a pulse duty cycle

type NoteOpts = {
  slideTo?: number;
  attack?: number;
  vibrato?: number; // depth in cents
  echo?: number; // send level to the echo
  sustain?: number; // level kept until the release, as a fraction of vol
  echoTo?: AudioNode; // where the echo send goes (the shared echo by default)
};

function note(dest: AudioNode, t: number, freq: number, dur: number, wave: Wave, vol: number, o: NoteOpts = {}) {
  const c = ctx!;
  const osc = c.createOscillator();
  if (typeof wave === 'number') osc.setPeriodicWave(pulse(wave));
  else osc.type = wave;
  osc.frequency.setValueAtTime(freq, t);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + dur);
  const g = c.createGain();
  const a = o.attack ?? 0.005;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  if (o.sustain) {
    // Organ-like hold with a short release, like a sequenced chip note.
    g.gain.setTargetAtTime(vol * o.sustain, t + a, 0.06);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.85, 0.03);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  osc.connect(g).connect(dest);
  const echoDest = o.echoTo ?? echoIn;
  if (o.echo && echoDest) {
    const send = gain(o.echo);
    g.connect(send).connect(echoDest);
  }
  let lfo: OscillatorNode | null = null;
  if (o.vibrato && dur > 0.18) {
    // Delayed vibrato: the note starts straight and then starts to wobble.
    lfo = c.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = c.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(freq * (Math.pow(2, o.vibrato / 1200) - 1), t + Math.min(0.25, dur * 0.6));
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.1);
  }
  osc.start(t);
  osc.stop(t + dur + 0.1);
}

function hiss(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, vol: number, q = 0.8) {
  const s = ctx!.createBufferSource();
  s.buffer = noise!;
  const g = ctx!.createGain();
  // A 1 ms attack: noise starting at full level clicks.
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(filter(type, freq, q)).connect(g).connect(dest);
  s.start(t, Math.random() * (noise!.duration - dur - 0.05), dur + 0.03);
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/* ---------------- the song: "Isla de Dui" ---------------- */

// An original 16-bar loop in F major. A section: F – Dm – Bb – C, F – Am –
// Bb/C – F. B section: Bb – C – Am – Dm, Gm – C – Bb – C7. Each bar is eight
// eighth notes: a note name, '-' to hold the previous one, '.' for a rest.
const MELODY = [
  // A
  'C5 . A4 C5 F5 - E5 D5',
  'D5 - A4 . F4 A4 D5 E5',
  'F5 - D5 Bb4 . D5 F5 G5',
  'E5 - - C5 G4 . C5 E5',
  'A5 . G5 F5 C5 . F5 A5',
  'G5 - E5 C5 . E5 A5 G5',
  'F5 D5 Bb4 D5 E5 G5 C6 Bb5',
  'A5 - - - F5 . . .',
  // B
  'D5 - - F5 - - Bb5 -',
  'A5 - G5 - E5 - C5 -',
  'E5 - - A5 - - C6 -',
  'A5 - G5 F5 - D5 E5 F5',
  'G5 - - Bb5 - - D6 -',
  'C6 - Bb5 A5 - G5 E5 G5',
  'F5 - D5 F5 Bb5 - A5 G5',
  'E5 . G5 . Bb5 . C6 .',
];

// Chords as MIDI notes (root first); two chords in a bar split it in half.
const F = [53, 57, 60], Dm = [50, 53, 57], Bb = [46, 50, 53], C = [48, 52, 55], Am = [45, 48, 52], Gm = [43, 46, 50], C7 = [48, 52, 58];
const CHORDS: number[][][] = [[F], [Dm], [Bb], [C], [F], [Am], [Bb, C], [F], [Bb], [C], [Am], [Dm], [Gm], [C], [Bb], [C7]];

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parseNote(s: string) {
  const m = /^([A-G])(b|#)?(\d)$/.exec(s);
  if (!m) return null;
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
}

// Melody events per bar: [eighth index, midi, length in eighths].
const parseBar = (bar: string) => {
  const tokens = bar.split(/\s+/);
  const events: [number, number, number][] = [];
  tokens.forEach((tok, i) => {
    if (tok === '-') {
      const last = events[events.length - 1];
      if (last) last[2]++;
    } else if (tok !== '.') {
      const n = parseNote(tok);
      if (n !== null) events.push([i, n, 1]);
    }
  });
  return events;
};

type Tune = { lead: [number, number, number][][]; chords: number[][][]; counter?: [number, number, number][][] };
const ISLA: Tune = { lead: MELODY.map(parseBar), chords: CHORDS };

/* ---------------- the second song: "Escuadrón Dui" ---------------- */

// Also original: 16 bars in D minor, quick and heroic. A section: Dm – Bb –
// C – Dm, Dm – Bb – Gm – A. B section: F – C – Bb – A, Dm – Gm – A – A7.
const A = [45, 49, 52], A7 = [45, 49, 55];
const VUELO: Tune = {
  lead: [
    'D5 . D5 F5 A5 - G5 F5',
    'D5 - F5 . Bb5 - A5 G5',
    'E5 - G5 . C6 - Bb5 A5',
    'A5 - - F5 D5 . . .',
    'D5 . D5 F5 A5 - D6 C6',
    'Bb5 - A5 G5 F5 - D5 F5',
    'G5 - Bb5 - D6 - C6 Bb5',
    'A5 - - - C#6 - E6 .',
    'F5 - A5 - C6 - A5 F5',
    'E5 - G5 - C6 - G5 E5',
    'D5 - F5 - Bb5 - A5 G5',
    'A5 - - C#6 E6 - C#6 A5',
    'D6 - A5 - F5 - A5 D6',
    'D6 - Bb5 - G5 - Bb5 D6',
    'C#6 - E6 - A5 - C#6 E6',
    'G5 . E5 . C#5 . A4 .',
  ].map(parseBar),
  chords: [[Dm], [Bb], [C], [Dm], [Dm], [Bb], [Gm], [A], [F], [C], [Bb], [A], [Dm], [Gm], [A], [A7]],
};

/* ---------------- the title march: "¡Despegue, Escuadrón!" ---------------- */

// Original as well: a 32-bar march in G major for the title screen. A (bars
// 1–8) states the 4-bar hook – G, then the same figure a step down on F (the
// bright flat seventh) – and an answer that ends on D. A' repeats the hook
// and lands home on G. B (17–24) is the contrast: long, soaring lead notes in
// E minor over a busy broken-chord counter line. A'' brings the hook back in
// thirds and turns around to the top. Drum fills close every 8 bars.
const G = [43, 47, 50], Em = [40, 43, 47], D = [38, 42, 45];
const TITULO: Tune = {
  lead: [
    // A
    'D5 . D5 G5 - - B5 -',
    'A5 G5 F#5 G5 D5 - - .',
    'C5 . C5 F5 - - A5 -',
    'G5 F5 E5 G5 F#5 - A5 .',
    'B5 . B5 D6 - B5 G5 B5',
    'E5 - G5 B5 - A5 G5 E5',
    'C6 - B5 A5 G5 - E5 G5',
    'A5 - - - . . . .',
    // A'
    'D5 . D5 G5 - - B5 -',
    'A5 G5 F#5 G5 D5 - - .',
    'C5 . C5 F5 - - A5 -',
    'G5 F5 E5 G5 F#5 - A5 .',
    'B5 . B5 D6 - G6 F#6 E6',
    'E6 - D6 C6 G5 - E5 G5',
    'F#5 - A5 - D6 - C6 A5',
    'G5 - - D5 G5 . . .',
    // B
    'E5 - - - G5 - B5 -',
    'C6 - - - B5 - G5 -',
    'D6 - - - B5 - G5 -',
    'A5 - - - F#5 G5 A5 -',
    'B5 - - - E6 - D6 -',
    'C6 - B5 - C6 - E6 -',
    'C6 - B5 A5 E5 - A5 C6',
    'D6 - - - . . . .',
    // A''
    'D5 . D5 G5 - - B5 -',
    'A5 G5 F#5 G5 D5 - - .',
    'C5 . C5 F5 - - A5 -',
    'G5 F5 E5 G5 F#5 - A5 .',
    'B5 . B5 D6 - B5 G5 B5',
    'E5 - G5 B5 - A5 G5 E5',
    'E6 - D6 C6 A5 - B5 C6',
    'A5 - - - F#5 - . .',
  ].map(parseBar),
  // The counter-melody: answers in the hook's held notes, sustained thirds
  // under the answer, a rolling broken chord in B, and harmony in A''.
  counter: [
    '. . . . B4 - D5 -',
    '. . . . G4 A4 B4 D5',
    '. . . . A4 - C5 -',
    'E4 - G4 - F#4 - A4 -',
    'D5 - - - G4 - - -',
    'B4 - - - E5 - - -',
    'E5 - - - C5 - - -',
    '. . . . A4 B4 C5 C#5',
    '. . . . B4 - D5 -',
    '. . . . G4 A4 B4 D5',
    '. . . . A4 - C5 -',
    'E4 - G4 - F#4 - A4 -',
    'G4 - - - B4 - - -',
    'G4 - - - E4 - - -',
    'A4 - - - F#4 - - -',
    '. . . . . G4 A4 B4',
    'E4 B4 G4 B4 E4 B4 G4 B4',
    'E4 C5 G4 C5 E4 C5 G4 C5',
    'D4 B4 G4 B4 D4 B4 G4 B4',
    'D4 A4 F#4 A4 D4 A4 F#4 A4',
    'G4 B4 E5 B4 G4 B4 E5 B4',
    'G4 C5 E5 C5 G4 C5 E5 C5',
    'A4 C5 E5 C5 A4 C5 E5 C5',
    'D5 C5 A4 F#4 D4 . . .',
    'B4 . B4 D5 - - G5 -',
    'F#5 E5 D5 E5 B4 - - .',
    'A4 . A4 C5 - - F5 -',
    'E5 D5 C5 E5 D5 - F#5 .',
    'D5 - - - G4 - - -',
    'B4 - - - E5 - - -',
    'G4 - - - A4 - - -',
    'D5 - - - A4 B4 C5 C#5',
  ].map(parseBar),
  chords: [
    [G], [G], [F], [C, D], [G], [Em], [C], [D],
    [G], [G], [F], [C, D], [G], [C], [D], [G],
    [Em], [C], [G], [D], [Em], [C], [Am], [D],
    [G], [G], [F], [C, D], [G], [Em], [C, D], [D],
  ],
};

const ARRANGEMENT = {
  alegre: { bpm: 140, lead: 0.25, leadVol: 0.075, bass: 0.13, drums: 1, tune: ISLA },
  calma: { bpm: 96, lead: 0.5, leadVol: 0.05, bass: 0.1, drums: 0.45, tune: ISLA },
  vuelo: { bpm: 160, lead: 0.25, leadVol: 0.07, bass: 0.14, drums: 1.1, tune: VUELO },
  titulo: { bpm: 158, lead: 0.5, leadVol: 0.058, bass: 0.13, drums: 0.9, tune: TITULO },
} as const;

const song = { next: 0, step: 0, arr: ARRANGEMENT.alegre as (typeof ARRANGEMENT)[MusicMood] };

// Schedules one sixteenth-note step of the song at time t.
function playStep(t: number, step: number, sixteenth: number) {
  const a = song.arr;
  if (a.tune === TITULO) return playMarch(t, step, sixteenth);
  const bus = songOut!;
  const echoTo = songEcho!;
  const calm = a === ARRANGEMENT.calma;
  const bar = Math.floor(step / 16) % a.tune.lead.length;
  const s = step % 16;
  const chords = a.tune.chords[bar];
  const chord = chords.length > 1 && s >= 8 ? chords[1] : chords[0];
  const eighth = sixteenth * 2;

  // Lead: a pulse wave with delayed vibrato and some echo.
  if (s % 2 === 0) {
    for (const [i, midi, len] of a.tune.lead[bar]) {
      if (i * 2 !== s) continue;
      note(bus, t, hz(midi), len * eighth * 0.92, a.lead, a.leadVol, { vibrato: 18, echo: 0.5, echoTo, sustain: 0.7, attack: 0.004 });
    }
  }

  // Bass on the triangle: bouncing octaves by day, long roots at night.
  const root = chord[0] - 12;
  if (calm) {
    if (s === 0 || s === 8) note(bus, t, hz(s === 0 ? root : root + 7), eighth * 3.6, 'triangle', a.bass, { sustain: 0.8 });
  } else if (s % 2 === 0) {
    const pat = [0, 12, 0, 12, 7, 12, 0, 12];
    note(bus, t, hz(root + pat[s / 2]), eighth * 0.8, 'triangle', a.bass, { sustain: 0.85, attack: 0.003 });
  }

  // Harmony: off-beat stabs by day, a slow broken chord at night.
  if (calm) {
    if (s % 4 === 2) {
      const tone = chord[[0, 1, 2, 1][(s / 4) | 0]] + 12;
      note(bus, t, hz(tone), eighth * 2.5, 0.125, 0.03, { echo: 0.6, echoTo });
    }
  } else if (s % 4 === 2) {
    note(bus, t, hz(chord[1] + 12), eighth * 0.45, 0.125, 0.032, { echo: 0.35, echoTo });
    note(bus, t, hz(chord[2] + 12), eighth * 0.45, 0.125, 0.032, { echo: 0.35, echoTo });
  }

  // Drums: soft kick, noise snare and hats.
  const d = a.drums;
  if (s === 0 || (!calm && (s === 8 || (s === 11 && bar % 2 === 1)))) {
    note(bus, t, 140, 0.13, 'sine', 0.32 * d, { slideTo: 42, attack: 0.002 });
  }
  if (!calm && (s === 4 || s === 12)) {
    hiss(bus, t, 0.12, 'bandpass', 2000, 0.16 * d, 0.6);
    note(bus, t, 190, 0.06, 'triangle', 0.08 * d, { slideTo: 120, attack: 0.002 });
  }
  if (calm && s === 8) hiss(bus, t, 0.05, 'bandpass', 3000, 0.08 * d, 1.2);
  if (calm ? s % 4 === 2 : s % 2 === 0) hiss(bus, t, s % 4 === 2 ? 0.045 : 0.025, 'highpass', 7000, (s % 4 === 2 ? 0.07 : 0.045) * d);
  // A little fill on the last beat before the loop starts again.
  if (!calm && bar === a.tune.lead.length - 1 && s >= 13) hiss(bus, t, 0.07, 'bandpass', 1500 + s * 120, 0.1, 0.8);
}

// Moves a MIDI note by octaves into [lo, lo + 12).
const inOctave = (m: number, lo: number) => lo + ((((m - lo) % 12) + 12) % 12);

// One sixteenth of the title march: square lead, pulse counter-melody,
// octave-jumping triangle bass, off-beat stabs and a fuller drum kit.
function playMarch(t: number, step: number, sixteenth: number) {
  const bus = songOut!;
  const echoTo = songEcho!;
  const a = song.arr;
  const tune = a.tune;
  const bar = Math.floor(step / 16) % tune.lead.length;
  const s = step % 16;
  const chords = tune.chords[bar];
  const chord = chords.length > 1 && s >= 8 ? chords[1] : chords[0];
  const eighth = sixteenth * 2;
  const sectionB = bar >= 16 && bar < 24;
  // Fills on the last half of every 8th bar, a longer one before A' and the loop.
  const fillFrom = bar % 8 === 7 ? (bar % 16 === 15 ? 4 : 8) : 16;
  const d = a.drums;

  if (s % 2 === 0) {
    // Lead: a plain square in A for punch, a thinner pulse in B for contrast.
    for (const [i, midi, len] of tune.lead[bar]) {
      if (i * 2 !== s) continue;
      note(bus, t, hz(midi), len * eighth * 0.9, sectionB ? 0.25 : a.lead, a.leadVol, { vibrato: 16, echo: 0.35, echoTo, sustain: 0.65, attack: 0.003 });
    }
    for (const [i, midi, len] of tune.counter?.[bar] ?? []) {
      if (i * 2 !== s) continue;
      note(bus, t, hz(midi), len * eighth * (sectionB ? 0.6 : 0.85), 0.125, sectionB ? 0.026 : 0.032, { echo: 0.45, echoTo, sustain: 0.6, attack: 0.004 });
    }

    // Bass: root and octave on every eighth, with a fifth for a little swing.
    const root = inOctave(chord[0], 36);
    const pat = sectionB ? [0, 12, 7, 12, 0, 12, 7, 12] : [0, 12, 0, 12, 0, 12, 7, 12];
    note(bus, t, hz(root + pat[s / 2]), eighth * 0.75, 'triangle', a.bass, { sustain: 0.85, attack: 0.003 });
  }

  // Harmony: short off-beat stabs of the chord's upper two notes.
  if (s % 4 === 2) {
    note(bus, t, hz(inOctave(chord[1], 60)), eighth * 0.4, 0.125, 0.028, { echo: 0.3, echoTo });
    note(bus, t, hz(inOctave(chord[2], 60)), eighth * 0.4, 0.125, 0.028, { echo: 0.3, echoTo });
  }

  // Drums. A crash opens every 8-bar phrase.
  if (bar % 8 === 0 && s === 0) hiss(bus, t, 0.7, 'highpass', 5000, 0.08 * d);
  if (s < fillFrom) {
    // March beat: kick on 1 and 3 (four on the floor in B), snare on 2 and 4.
    if (s === 0 || s === 8 || (sectionB ? s % 4 === 0 : s === 10 && bar % 2 === 1)) {
      note(bus, t, 145, 0.13, 'sine', 0.32 * d, { slideTo: 44, attack: 0.002 });
    }
    if (s === 4 || s === 12) {
      hiss(bus, t, 0.12, 'bandpass', 2000, 0.15 * d, 0.6);
      note(bus, t, 200, 0.06, 'triangle', 0.08 * d, { slideTo: 125, attack: 0.002 });
    }
    if (s === 14 && bar % 2 === 1) hiss(bus, t, 0.05, 'bandpass', 2400, 0.05 * d, 0.8);
    // Hats on the eighths, a soft sixteenth before each beat, open hats in B.
    if (s % 2 === 0) hiss(bus, t, sectionB && s % 4 === 2 ? 0.07 : 0.028, 'highpass', 7000, (s % 4 === 2 ? 0.06 : 0.042) * d);
    else if (s % 4 === 3) hiss(bus, t, 0.02, 'highpass', 8000, 0.025 * d);
  } else {
    // Fill: a snare roll that climbs in level over falling toms.
    const k = (s - fillFrom) / (16 - fillFrom);
    hiss(bus, t, 0.07, 'bandpass', 1500 + k * 1200, (0.06 + 0.08 * k) * d, 0.7);
    if (s % 2 === 0) {
      const tom = 260 - k * 130;
      note(bus, t, tom, 0.1, 'triangle', 0.1 * d, { slideTo: tom * 0.6, attack: 0.002 });
    }
    if (s === 15) note(bus, t, 145, 0.13, 'sine', 0.3 * d, { slideTo: 44, attack: 0.002 });
  }
}

function tick() {
  if (!ctx || !musicBus || !songOut || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  // After a pause or a long stall, pick up from now instead of catching up.
  if (song.next < now - 0.2) song.next = now + 0.05;
  const silent = muted || musicVolume < 0.01;
  while (song.next < now + 0.2) {
    if (song.step % 16 === 0) {
      // A different song starts from its first bar.
      if (ARRANGEMENT[mood].tune !== song.arr.tune) song.step = 0;
      song.arr = ARRANGEMENT[mood];
    }
    const sixteenth = 60 / song.arr.bpm / 4;
    // Muted: keep the song moving but skip creating any nodes.
    if (!silent) playStep(song.next, song.step, sixteenth);
    song.step = (song.step + 1) % (song.arr.tune.lead.length * 16);
    song.next += sixteenth;
  }
}

/* ---------------- one-shot effects ---------------- */

function ready() {
  return !!ctx && !!sfxBus && !muted;
}

function blip(freq: number, dur: number, wave: Wave, vol: number, delay = 0, o: NoteOpts = {}) {
  if (!ready()) return;
  note(sfxBus!, ctx!.currentTime + delay, freq, dur, wave, vol * volMul, { attack: 0.003, ...o });
}

function crunch(dur: number, freq: number, vol: number, delay = 0, type: BiquadFilterType = 'bandpass') {
  if (!ready()) return;
  hiss(sfxBus!, ctx!.currentTime + delay, dur, type, freq, vol * volMul, 0.7);
}

/** Runs f with every blip/crunch scaled by k. */
function conNivel(k: number, f: () => void) {
  const prev = volMul;
  volMul = prev * k;
  try {
    f();
  } finally {
    volMul = prev;
  }
}

/* ---------------- title jingles ---------------- */

// Holds the song back for `seconds` (cutting what was sounding) and then
// starts the current mood from its first bar, so it enters after a jingle.
function holdMusic(seconds: number) {
  if (ctx && musicBus) restartSong(seconds);
}

// A big pulse chord hit: one note per MIDI number, with a triangle root below.
function chordHit(midis: number[], delay: number, dur: number, vol: number, wave: Wave = 0.25) {
  midis.forEach((m, i) => blip(hz(m), dur, i % 2 ? 0.5 : wave, vol, delay, { sustain: 0.6, vibrato: dur > 0.3 ? 18 : 0, echo: 0.3 }));
  blip(hz(midis[0] - 24), dur, 'triangle', 0.16, delay, { sustain: 0.8 });
}

function kick(delay: number, vol = 0.3) {
  blip(150, 0.14, 'sine', vol, delay, { slideTo: 44, attack: 0.002 });
}

/**
 * The title sting (about 3 s) for when the logo slams in: a rising G major
 * arpeggio over a snare roll, two F stabs and a bright G chord with a crash.
 * The current song waits and starts from its first bar right after it.
 */
export function jingleIntro(): void {
  holdMusic(3.1);
  if (!ready()) return;
  conNivel(JINGLE, jingleIntroNotas);
}
// The title jingles were 6–8 dB under the march they introduce.
const JINGLE = 1.6;
function jingleIntroNotas() {
  // Two and a half octaves up, speeding up as it climbs.
  const arp = [55, 59, 62, 67, 71, 74, 79, 83, 86, 91];
  arp.forEach((m, i) => {
    const at = i * 0.125 - i * i * 0.0035;
    blip(hz(m), 0.16, 0.25, 0.05 + i * 0.002, at, { sustain: 0.6, echo: 0.25 });
    blip(hz(m - 12), 0.1, 'triangle', 0.09, at, { sustain: 0.7 });
  });
  // Snare roll, quiet to loud.
  for (let i = 0; i < 28; i++) crunch(0.06, 1700 + i * 30, 0.05 + i * 0.006, i * 0.045);
  // F – F – G: the flat seventh pushing up to the tonic.
  chordHit([65, 69, 72, 77], 1.05, 0.11, 0.045);
  kick(1.05, 0.26);
  chordHit([65, 69, 72, 77], 1.2, 0.11, 0.045);
  kick(1.2, 0.26);
  chordHit([67, 71, 74, 79, 83], 1.4, 1.5, 0.045);
  kick(1.4, 0.34);
  crunch(1.2, 5500, 0.22, 1.4, 'highpass');
  crunch(0.18, 1900, 0.2, 1.4);
  // A little sparkle trailing off the hit.
  [91, 95, 98, 103].forEach((m, i) => blip(hz(m), 0.1, 0.125, 0.022, 1.55 + i * 0.07, { echo: 0.5 }));
}

/**
 * The Start sting (about 0.8 s): a quick upward flourish and a chord hit.
 * Call setMusicMood for the next song right after it; it enters when the
 * sting ends.
 */
export function jingleStart(): void {
  holdMusic(0.85);
  if (!ready()) return;
  conNivel(JINGLE, jingleStartNotas);
}
function jingleStartNotas() {
  [74, 79, 83].forEach((m, i) => blip(hz(m), 0.07, 0.125, 0.05, i * 0.05));
  blip(hz(67), 0.15, 0.5, 0.03, 0, { slideTo: hz(79) });
  chordHit([79, 83, 86], 0.16, 0.6, 0.045, 0.25);
  kick(0.16, 0.3);
  crunch(0.12, 2000, 0.18, 0.16);
  crunch(0.45, 6000, 0.14, 0.16, 'highpass');
}

export const sfx = {
  // Cutting grass: a short, gritty noise burst with a tiny click.
  snip() {
    crunch(0.07, rand(2600, 3600), 0.32);
    blip(rand(900, 1100), 0.03, 0.125, 0.05);
  },
  // Watering: a handful of rising bubbles.
  water() {
    for (let i = 0; i < 6; i++) {
      const f = rand(380, 720);
      blip(f, 0.07, 0.5, 0.05, i * 0.07 + rand(0, 0.03), { slideTo: f * 2.2 });
    }
  },
  // A small round "boing".
  pop() {
    blip(330, 0.13, 0.25, 0.08, 0, { slideTo: 880 });
    blip(660, 0.07, 0.125, 0.03, 0.05, { slideTo: 990 });
  },
  // Jump: a springy upward sweep.
  jump() {
    blip(260, 0.16, 0.25, 0.08, 0, { slideTo: 760 });
  },
  // Landing: a soft thud.
  land() {
    blip(180, 0.08, 'triangle', 0.12, 0, { slideTo: 70 });
    crunch(0.04, 900, 0.08, 0, 'lowpass');
  },
  // Digging: a crunchy scoop.
  dig() {
    crunch(0.09, 1200, 0.28, 0, 'lowpass');
    blip(220, 0.06, 0.5, 0.05, 0.02, { slideTo: 140 });
  },
  step() {
    blip(rand(200, 240), 0.03, 'triangle', 0.05);
  },
  talk() {
    // Text blips: a quick random note of the F major pentatonic.
    const notes = [698, 784, 880, 1047, 1175];
    blip(notes[Math.floor(Math.random() * notes.length)], 0.045, 0.125, 0.035);
  },
  open() {
    blip(784, 0.06, 0.25, 0.06);
    blip(1175, 0.1, 0.25, 0.06, 0.06);
  },
  close() {
    blip(1047, 0.06, 0.25, 0.055);
    blip(698, 0.09, 0.25, 0.055, 0.06);
  },
  select() {
    blip(1319, 0.04, 0.25, 0.05);
  },
  // Star pickup: a bright rising arpeggio with an echo.
  star() {
    const notes = [1047, 1319, 1568, 2093, 2637];
    notes.forEach((f, i) => {
      blip(f, 0.12, 0.125, 0.06, i * 0.045);
      blip(f, 0.12, 0.125, 0.02, i * 0.045 + 0.16);
    });
  },
  // Something hidden appears: a sparkly glide up and a twinkle.
  reveal() {
    blip(880, 0.22, 'triangle', 0.06, 0, { slideTo: 1760 });
    blip(2093, 0.08, 0.125, 0.03, 0.2);
    blip(2637, 0.1, 0.125, 0.03, 0.27);
  },
  // Achievement: a short, original fanfare with a bass line.
  achievement() {
    const lead: [number, number, number][] = [
      [523, 0, 0.08], [659, 0.08, 0.08], [784, 0.16, 0.08], [880, 0.26, 0.16], [784, 0.42, 0.1], [1047, 0.54, 0.5],
    ];
    lead.forEach(([f, t, d]) => blip(f, d, 0.25, 0.07, t, { sustain: 0.75, vibrato: d > 0.3 ? 20 : 0 }));
    blip(1319, 0.5, 0.125, 0.03, 0.54, { sustain: 0.6 });
    [[131, 0], [196, 0.26], [262, 0.54]].forEach(([f, t]) => blip(f, 0.24, 'triangle', 0.12, t, { sustain: 0.8 }));
  },
  // Dui purring: low pulse grains about 18 times a second.
  purr() {
    for (let i = 0; i < 18; i++) blip(rand(44, 54), 0.05, 0.25, 0.05, i * 0.055);
  },
  // Plane game: a missile leaving the rack, a rushing swoosh up.
  launch() {
    crunch(0.22, 1800, 0.22, 0, 'highpass');
    blip(300, 0.2, 0.125, 0.05, 0, { slideTo: 900 });
  },
  // A bomb falling away: a short whistle down.
  bomb() {
    blip(1400, 0.35, 'triangle', 0.05, 0, { slideTo: 500 });
  },
  // An enemy missile going up: a lower, grittier swoosh.
  enemyLaunch() {
    crunch(0.3, 900, 0.12, 0, 'bandpass');
    blip(180, 0.25, 0.5, 0.03, 0, { slideTo: 420 });
  },
  // Explosion: a crunchy noise burst over a falling thump.
  boom(big = false) {
    crunch(big ? 0.6 : 0.35, big ? 500 : 800, big ? 0.55 : 0.4, 0, 'lowpass');
    blip(big ? 120 : 160, big ? 0.4 : 0.25, 'triangle', 0.2, 0, { slideTo: 40 });
    crunch(0.12, 2400, 0.12, 0.03);
  },
  // The plane takes a hit.
  hurt() {
    blip(520, 0.18, 0.5, 0.07, 0, { slideTo: 140 });
    crunch(0.15, 1400, 0.2);
  },
  // A missile is locked on the plane: two short beeps.
  warn() {
    blip(1760, 0.05, 0.5, 0.035);
    blip(1760, 0.05, 0.5, 0.035, 0.1);
  },
  // Flares: a fizzing sparkle.
  flare() {
    crunch(0.4, 5000, 0.12, 0, 'highpass');
    for (let i = 0; i < 4; i++) blip(rand(1800, 2600), 0.05, 0.125, 0.025, i * 0.06);
  },
  // A vehicle got through to the pantry: a sad little descending riff.
  lose() {
    [784, 659, 523].forEach((f, i) => blip(f, 0.12, 0.25, 0.06, i * 0.1));
  },
  // Game over: a slower fall and a low note.
  gameOver() {
    [523, 494, 466, 440].forEach((f, i) => blip(f, 0.22, 0.25, 0.06, i * 0.2, { sustain: 0.7 }));
    blip(110, 0.8, 'triangle', 0.14, 0.8, { sustain: 0.8 });
  },
  // A chirpy two-part "mi-au" on a pulse wave.
  meow() {
    blip(700, 0.1, 0.25, 0.055, 0, { slideTo: 1050 });
    blip(1050, 0.2, 0.25, 0.055, 0.1, { slideTo: 620, vibrato: 30 });
  },
};

/* ---------------- the plane game's levels ---------------- */

type Sfx = typeof sfx;
/*
 * In the plane game the chip effects play next to the synthesized battle
 * sound (explosions, missiles, engines at -15 to -25 LUFS), where at the
 * island's levels they were 20–30 dB under and simply inaudible (the freeze
 * warning, a vehicle reaching the pantry, Margarita's voice). These gains
 * bring each one to where it belongs in that mix; the island keeps its own.
 */
const NIVEL_VUELO: Partial<Record<keyof Sfx, number>> = {
  warn: 12, lose: 7, star: 4, reveal: 3, talk: 6, jump: 5, select: 8, open: 4,
  achievement: 2, gameOver: 2,
  // Fallbacks for the recorded samples while they load: matched to the samples.
  launch: 6, bomb: 14, enemyLaunch: 8, boom: 1.6, hurt: 6, flare: 6, pop: 8, dig: 6,
};
let callado: () => boolean = () => false;

/**
 * The plane game's sounds stay quiet while `pred` is true (the self-playing
 * game behind the title menu): sfxVuelo, the battle synth and the samples
 * all ask juegoCallado(). Menus, jingles and music are not affected.
 */
export function callarJuegoSi(pred: (() => boolean) | null) {
  callado = pred ?? (() => false);
}
export const juegoCallado = () => callado();

/** The same effects as `sfx`, at the plane game's levels and silent behind the title. */
/*
 * Margarita's voice in the plane game: the island's blip (a 45 ms nasal 12.5 %
 * pulse at 700–1200 Hz, four in a row 70 ms apart) read as a sheep bleating
 * once it was loud enough to hear. Here each syllable is a short, dry triangle
 * «tik» with a little drop and gaps between them: chatter, not a vowel.
 */
const PROPIOS_VUELO: Partial<Sfx> = {
  talk() {
    const notes = [523, 659, 784, 880, 1047];
    const f = notes[Math.floor(Math.random() * notes.length)];
    blip(f, 0.028, 'triangle', 0.06, 0, { slideTo: f * 0.85 });
  },
  // A vehicle reached the pantry: the same falling riff, but on a hollow
  // square with a triangle under it instead of the nasal 25 % pulse.
  lose() {
    [784, 659, 523].forEach((f, i) => {
      blip(f, 0.1, 0.5, 0.045, i * 0.1);
      blip(f / 2, 0.1, 'triangle', 0.08, i * 0.1);
    });
  },
};

export const sfxVuelo = Object.fromEntries(
  (Object.keys(sfx) as (keyof Sfx)[]).map((k) => [
    k,
    (...a: unknown[]) => {
      if (callado()) return;
      conNivel(NIVEL_VUELO[k] ?? 1, () => ((PROPIOS_VUELO[k] ?? sfx[k]) as (...x: unknown[]) => void)(...a));
    },
  ]),
) as Sfx;

/*
 * Menu sounds for the plane game. They play over the title march (about
 * -19 LUFS), so they are much louder than the island's UI blips, and short
 * and dry so repeated navigation never tires.
 */
let ultimoMover = -1;
export const menu = {
  /** Focus moved to another button (keyboard or hover): a tiny tick, at most one every 60 ms. */
  mover() {
    if (!ready()) return;
    const t = ctx!.currentTime;
    if (t - ultimoMover < 0.06) return;
    ultimoMover = t;
    conNivel(8, () => blip(rand(1560, 1600), 0.03, 0.125, 0.04));
  },
  /** A button pressed: a bright two-note «ti-ding». */
  aceptar() {
    conNivel(10, () => {
      blip(1175, 0.05, 0.25, 0.05);
      blip(1760, 0.09, 0.25, 0.05, 0.045);
    });
  },
  /** Back / close: the same two notes falling. */
  volver() {
    conNivel(10, () => {
      blip(1319, 0.05, 0.25, 0.045);
      blip(880, 0.08, 0.25, 0.045, 0.045);
    });
  },
  /** Take off from the hangar: a quick upward swoosh and a chord. */
  despegar() {
    conNivel(5, () => {
      crunch(0.25, 2400, 0.12, 0, 'highpass');
      blip(392, 0.18, 0.25, 0.05, 0, { slideTo: 1175 });
      blip(784, 0.22, 0.5, 0.035, 0.12, { sustain: 0.6 });
      blip(1175, 0.22, 0.25, 0.03, 0.12, { sustain: 0.6 });
    });
  },
  /** Pause (true) or resume (false): a soft falling or rising pair. */
  pausa(on: boolean) {
    conNivel(8, () => {
      blip(on ? 988 : 659, 0.06, 0.5, 0.04);
      blip(on ? 659 : 988, 0.09, 0.5, 0.04, 0.07);
    });
  },
  /** One beat of the intro sequence (pilots, logo, «press start»). */
  paso() {
    conNivel(5, () => {
      blip(150, 0.12, 'sine', 0.22, 0, { slideTo: 50, attack: 0.002 });
      crunch(0.05, 2200, 0.08);
    });
  },
};
