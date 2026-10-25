import { sampleOut } from '../game/audio';

/*
 * Audio de batalla del juego de aviones: todo sintetizado, sin archivos.
 *
 * Los sonidos se «hornean» una sola vez como AudioBuffers (ruido filtrado,
 * osciladores y saturación calculados en JS al primer uso), así cada voz en
 * vivo cuesta 2–4 nodos: fuente → ganancia → paneo. El efecto doppler sale de
 * playbackRate, que desplaza todo el espectro como en la realidad.
 *
 * Mezcla: todo pasa por un bus propio con un limitador antes del bus de
 * efectos del sitio (así el silencio y la cadena maestra se respetan). Lo que
 * importa para sobrevivir (misiles cerca y tono de fijación) va más fuerte y
 * baja («ducking») el viento, el fuego y el motor dañado.
 *
 * Presupuesto: ~21 nodos en el peor caso continuo (3 misiles × 3, tono 2,
 * viento 3, fuego 2, motor 2, latido 1, bus 2); los efectos sueltos se
 * recortan con un tope global y las explosiones se roban por prioridad.
 *
 * Todas las funciones son seguras de llamar siempre: si no hay contexto de
 * audio o no está corriendo, no hacen nada.
 */

export type Amenaza = { id: number; dx: number; dy: number; vx: number; vy: number; tipo: string; guiado: boolean };

type Ctx = BaseAudioContext;
type Pan = StereoPannerNode | GainNode;

/* ────────────────────────── utilidades ────────────────────────── */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Congela un parámetro en su valor actual para reprogramarlo sin clic. */
function sujeta(p: AudioParam, t: number) {
  const q = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (q.cancelAndHoldAtTime) q.cancelAndHoldAtTime(t);
  else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

const hacia = (p: AudioParam, v: number, t: number, tc: number) => p.setTargetAtTime(num(v), t, tc);

/* ────────────────────────── mezcla ────────────────────────── */

type Mezcla = { ctx: Ctx; dest: AudioNode; bus: GainNode; comp: DynamicsCompressorNode };
let inyectado: { ctx: Ctx; dest: AudioNode } | null = null;
let mz: Mezcla | null = null;
let vivos = 0; // nodos creados por este módulo que siguen conectados
const LIMITE = 25; // tope para efectos sueltos de baja prioridad

function salida(): Mezcla | null {
  const o = inyectado ?? sampleOut();
  if (!o) return null;
  if (!inyectado && o.ctx.state !== 'running') return null;
  if (mz && mz.ctx === o.ctx && mz.dest === o.dest) return mz;
  if (mz) reiniciar();
  const ctx = o.ctx;
  // Limitador: rápido y duro, solo actúa en los picos (explosiones encima
  // de explosiones); el resto del tiempo la mezcla pasa limpia.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -9;
  comp.knee.value = 3;
  comp.ratio.value = 20;
  comp.attack.value = 0.001;
  comp.release.value = 0.12;
  const bus = ctx.createGain();
  bus.gain.value = 0.85;
  bus.connect(comp).connect(o.dest);
  vivos += 2;
  mz = { ctx, dest: o.dest, bus, comp };
  return mz;
}

function panner(ctx: Ctx): Pan {
  return ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
}
function panea(p: Pan, v: number, t: number, tc = 0.05) {
  if ('pan' in p) hacia(p.pan, clamp(num(v), -1, 1), t, tc);
}

/** Una voz: fuente + cadena. liberar() la detiene y desconecta una sola vez. */
type Voz = { src: AudioScheduledSourceNode; nodos: AudioNode[]; viva: boolean };
const sueltos = new Set<Voz>();

function voz(src: AudioScheduledSourceNode, cadena: AudioNode[], destino: AudioNode, suelta: boolean): Voz {
  let n: AudioNode = src;
  for (const c of cadena) n = n.connect(c);
  n.connect(destino);
  const v: Voz = { src, nodos: [src, ...cadena], viva: true };
  vivos += v.nodos.length;
  if (suelta) {
    sueltos.add(v);
    src.onended = () => liberar(v);
  }
  return v;
}

function liberar(v: Voz) {
  if (!v.viva) return;
  v.viva = false;
  sueltos.delete(v);
  try {
    v.src.stop();
  } catch {
    /* ya detenida */
  }
  for (const n of v.nodos) n.disconnect();
  vivos -= v.nodos.length;
}

/** Baja una ganancia en ~40 ms y libera la voz después (sin clic). */
function apagar(v: Voz, g: GainNode, t: number, tc = 0.02) {
  if (!v.viva) return;
  sujeta(g.gain, t);
  g.gain.setTargetAtTime(0, t, tc);
  v.src.onended = () => liberar(v);
  try {
    v.src.stop(t + tc * 6);
  } catch {
    liberar(v);
  }
}

function fuente(m: Mezcla, b: AudioBuffer, loop = false, rate = 1) {
  const s = m.ctx.createBufferSource();
  s.buffer = b;
  s.loop = loop;
  s.playbackRate.value = rate;
  return s;
}
function ganancia(m: Mezcla, v: number) {
  const g = m.ctx.createGain();
  g.gain.value = v;
  return g;
}

/* ────────────────────────── horno de sonidos ────────────────────────── */

/** Biquad RBJ en JS para hornear (frecuencia ajustable por bloques). */
class Bq {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private sr: number, private tipo: 'lp' | 'hp' | 'bp', f: number, private q = 0.707) {
    this.f(f);
  }
  f(f: number) {
    const w = (2 * Math.PI * clamp(f, 10, this.sr * 0.45)) / this.sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * this.q);
    const a0 = 1 + al;
    if (this.tipo === 'lp') {
      this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0;
    } else if (this.tipo === 'hp') {
      this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0;
    } else {
      this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0;
    }
    this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const ruido = () => Math.random() * 2 - 1;

function normaliza(a: Float32Array, pico: number) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= pico / m;
  // Bordes a cero: ni un clic al empezar o terminar.
  const f = Math.min(64, a.length >> 2);
  for (let i = 0; i < f; i++) a[a.length - 1 - i] *= i / f;
  return a;
}

/** Genera n + cruce muestras y funde el final en el principio: bucle sin costura. */
function bucle(sr: number, seg: number, gen: (i: number, t: number) => number) {
  const n = Math.floor(sr * seg);
  const x = Math.floor(sr * 0.15);
  const a = new Float32Array(n + x);
  for (let i = 0; i < a.length; i++) a[i] = gen(i, i / sr);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i < x) {
      const k = i / x;
      o[i] = a[i] * Math.sqrt(k) + a[n + i] * Math.sqrt(1 - k);
    } else o[i] = a[i];
  }
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(o[i]));
  if (m > 0) for (let i = 0; i < n; i++) o[i] *= 0.9 / m;
  return o;
}

/** Pista de chasquidos sueltos (fuego, escombros, chispas). */
function chasquidos(sr: number, a: Float32Array, desde: number, hasta: number, densidad: (t: number) => number, o: { hp: number; amp: number; largo: [number, number] }) {
  const hp = new Bq(sr, 'hp', o.hp, 0.8);
  const pista = new Float32Array(a.length);
  let t = desde;
  while (t < hasta) {
    const d = Math.max(0.5, densidad(t));
    t += -Math.log(1 - Math.random() * 0.999) / d;
    if (t >= hasta) break;
    const i0 = Math.floor(t * sr);
    const tau = rand(o.largo[0], o.largo[1]);
    const amp = Math.pow(Math.random(), 1.8);
    const n = Math.min(a.length - i0, Math.floor(tau * 6 * sr));
    for (let k = 0; k < n; k++) pista[i0 + k] += ruido() * amp * Math.exp(-k / sr / tau);
  }
  for (let i = 0; i < a.length; i++) a[i] += hp.run(pista[i]) * o.amp;
}

/** Fricción metálica: tren de impulsos (stick-slip) por resonancias de chapa. */
function friccion(sr: number, a: Float32Array, t0: number, dur: number, f0: number, f1: number, res: number[], amp: number) {
  const bs = res.map((f, k) => new Bq(sr, 'bp', f, 9 + k * 3));
  const i0 = Math.floor(t0 * sr);
  const n = Math.min(a.length - i0, Math.floor(dur * sr));
  let fase = 0;
  for (let k = 0; k < n; k++) {
    const u = k / n;
    const f = (f0 + (f1 - f0) * u) * (1 + 0.04 * Math.sin(k / sr * 2 * Math.PI * 7) + 0.03 * ruido());
    fase += f / sr;
    let imp = 0;
    if (fase >= 1) {
      fase -= 1;
      imp = rand(0.4, 1);
    }
    const env = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.3);
    let y = 0;
    for (const b of bs) y += b.run(imp + ruido() * 0.02);
    a[i0 + k] += y * env * amp;
  }
}

/** Golpe grave: seno que cae de tono + ráfaga de ruido, saturado. */
function golpe(sr: number, a: Float32Array, t0: number, fa: number, fb: number, tau: number, amp: number, brillo = 1500) {
  const lp = new Bq(sr, 'lp', brillo, 0.7);
  const i0 = Math.floor(t0 * sr);
  const n = Math.min(a.length - i0, Math.floor(tau * 7 * sr));
  let fase = 0;
  for (let k = 0; k < n; k++) {
    const t = k / sr;
    fase += (fb + (fa - fb) * Math.exp(-t / (tau * 0.4))) / sr;
    const e = Math.exp(-t / tau) * Math.min(1, t / 0.002);
    const y = Math.sin(2 * Math.PI * fase) * 0.8 + lp.run(ruido()) * Math.exp(-t / (tau * 0.35)) * 1.2;
    a[i0 + k] += Math.tanh(y * e * 1.8) * amp;
  }
}

/** Ping metálico o de vidrio. */
function ping(sr: number, a: Float32Array, t0: number, f: number, tau: number, amp: number) {
  const i0 = Math.floor(t0 * sr);
  const n = Math.min(a.length - i0, Math.floor(tau * 6 * sr));
  for (let k = 0; k < n; k++) {
    const t = k / sr;
    a[i0 + k] += (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t)) * Math.exp(-t / tau) * amp;
  }
}

type Explo = { dur: number; tauCuerpo: number; tauSub: number; fSub: number; escombros: number; segundo: number; metal: boolean };

/** Explosión en capas: crack + cuerpo + sub-boom + cola de escombros. */
function explosionHorno(sr: number, e: Explo) {
  const a = new Float32Array(Math.floor(sr * e.dur));
  const crackHp = new Bq(sr, 'hp', 700, 0.7);
  const cuerpo = new Bq(sr, 'lp', 4000, 0.9);
  const rumor = new Bq(sr, 'lp', 220, 0.7);
  let fs = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    // crack: los primeros milisegundos, brillante y saturado
    const crack = t < 0.06 ? Math.tanh(crackHp.run(ruido()) * 3 * Math.exp(-t / 0.007)) * 0.9 : 0;
    // cuerpo: ruido cuyo paso bajo se cierra (de «¡pah!» a «ummm»)
    if ((i & 31) === 0) cuerpo.f(180 + 4200 * Math.exp(-t / 0.1));
    const c = cuerpo.run(ruido()) * Math.exp(-t / e.tauCuerpo) * Math.min(1, t / 0.003) * 2.2;
    // sub-boom: seno grave que cae, empuja el pecho
    fs += (e.fSub + 75 * Math.exp(-t / 0.07)) / sr;
    const sub = Math.sin(2 * Math.PI * fs) * Math.exp(-t / e.tauSub) * Math.min(1, t / 0.006) * 1.1;
    // rumor de escombros que se va apagando
    const r = rumor.run(ruido()) * Math.min(1, t / 0.15) * Math.exp(-t / (e.dur * 0.35)) * 1.6 * e.escombros;
    a[i] = Math.tanh(crack + c * 1.3) * 0.85 + Math.tanh(sub * 1.4) * 0.75 + r;
  }
  if (e.segundo > 0) golpe(sr, a, e.segundo, 120, 35, 0.35, 0.6, 900);
  chasquidos(sr, a, 0.12, e.dur * 0.9, (t) => 70 * Math.exp(-t / (e.dur * 0.3)) * e.escombros, { hp: 1800, amp: 0.35, largo: [0.002, 0.01] });
  if (e.metal) {
    friccion(sr, a, e.dur * 0.2, e.dur * 0.35, 190, 90, [700, 1500, 2600], 0.06);
    for (let k = 0; k < 18; k++) ping(sr, a, rand(0.3, e.dur * 0.85), rand(1400, 4200), rand(0.02, 0.07), rand(0.02, 0.08));
  }
  return normaliza(a, 0.95);
}

type Nombre =
  | 'silbido' | 'viento' | 'crepitar' | 'tos' | 'petardo' | 'rechinido' | 'latido'
  | 'explo-chica' | 'explo-grande' | 'derribo' | 'pieza-metal' | 'pieza-cabina';

const HORNO: Record<Nombre, (sr: number) => Float32Array> = {
  // Cohete: silbido agudo resonante + siseo + zumbido de tobera + rugido grave.
  silbido: (sr) => {
    const silb = new Bq(sr, 'bp', 3900, 16);
    const sis = new Bq(sr, 'bp', 2400, 2.5);
    const rug = new Bq(sr, 'lp', 320, 0.7);
    const zum = new Bq(sr, 'lp', 1100, 0.7);
    let fz = 0;
    return bucle(sr, 1, (i, t) => {
      fz += (150 + 6 * Math.sin(2 * Math.PI * 3 * t)) / sr;
      const saw = (fz % 1) * 2 - 1;
      const flutter = 1 + 0.18 * Math.sin(2 * Math.PI * 23 * t) + 0.08 * ruido();
      return (silb.run(ruido()) * 3.2 + sis.run(ruido()) * 0.7 + rug.run(ruido()) * 0.9 + zum.run(saw) * 0.35) * flutter;
    });
  },
  viento: (sr) => bucle(sr, 2, () => ruido()),
  // Llamas: rumor grave ondulante + chasquidos de brasas.
  crepitar: (sr) => {
    const lp = new Bq(sr, 'lp', 520, 0.7);
    const a = new Float32Array(Math.floor(sr * 2.15));
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = lp.run(ruido()) * 0.9 * (0.7 + 0.3 * Math.sin(2 * Math.PI * 1.5 * t) * Math.sin(2 * Math.PI * 0.5 * t + 1));
    }
    chasquidos(sr, a, 0, 2.15, () => 55, { hp: 1400, amp: 1.3, largo: [0.0015, 0.008] });
    chasquidos(sr, a, 0, 2.15, () => 6, { hp: 300, amp: 0.9, largo: [0.01, 0.03] });
    return bucle(sr, 2, (i) => a[i]);
  },
  // Motor herido: explosiones de cilindro irregulares con fallos + chispas.
  tos: (sr) => {
    const a = new Float32Array(Math.floor(sr * 2.15));
    let t = 0;
    while (t < 2.1) {
      t += (1 / 24) * rand(0.8, 1.25);
      if (Math.random() < 0.28) continue; // fallo de encendido
      golpe(sr, a, t, 95, 55, rand(0.008, 0.016), rand(0.4, 1), 600);
    }
    chasquidos(sr, a, 0, 2.15, () => 14, { hp: 3000, amp: 0.8, largo: [0.001, 0.004] });
    const lp = new Bq(sr, 'lp', 180, 0.7);
    for (let i = 0; i < a.length; i++) a[i] += lp.run(ruido()) * 0.5;
    return bucle(sr, 2, (i) => a[i]);
  },
  // Petardeo: estampido seco del escape.
  petardo: (sr) => {
    const a = new Float32Array(Math.floor(sr * 0.45));
    golpe(sr, a, 0, 160, 45, 0.05, 1, 2500);
    chasquidos(sr, a, 0.01, 0.2, () => 60, { hp: 2000, amp: 0.4, largo: [0.001, 0.004] });
    return normaliza(a, 0.95);
  },
  // Chapa que rechina y se dobla.
  rechinido: (sr) => {
    const a = new Float32Array(Math.floor(sr * 0.9));
    friccion(sr, a, 0, 0.88, 420, 250, [1100, 2300, 3700], 1);
    return normaliza(a, 0.8);
  },
  // Latido: bombo grave corto, sin tono reconocible.
  latido: (sr) => {
    const a = new Float32Array(Math.floor(sr * 0.28));
    const lp = new Bq(sr, 'lp', 2000, 0.7);
    let f = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      f += (46 + 70 * Math.exp(-t / 0.018)) / sr;
      a[i] = Math.tanh((Math.sin(2 * Math.PI * f) * Math.exp(-t / 0.09) + (t < 0.005 ? lp.run(ruido()) * 0.4 : 0)) * 1.6);
    }
    return normaliza(a, 0.95);
  },
  'explo-chica': (sr) => explosionHorno(sr, { dur: 1.7, tauCuerpo: 0.18, tauSub: 0.28, fSub: 48, escombros: 0.6, segundo: 0, metal: false }),
  'explo-grande': (sr) => explosionHorno(sr, { dur: 3.2, tauCuerpo: 0.4, tauSub: 0.7, fSub: 36, escombros: 1, segundo: 0.17, metal: false }),
  // El derribo: dos estallidos (el segundo es el tanque), gemido de metal y lluvia de piezas.
  derribo: (sr) => {
    const a = explosionHorno(sr, { dur: 5.5, tauCuerpo: 0.55, tauSub: 1.3, fSub: 30, escombros: 1.2, segundo: 0, metal: true });
    const b = explosionHorno(sr, { dur: 4.8, tauCuerpo: 0.7, tauSub: 1.5, fSub: 27, escombros: 1, segundo: 0.25, metal: false });
    const off = Math.floor(sr * 0.38);
    for (let i = 0; i + off < a.length && i < b.length; i++) a[i + off] = a[i + off] * 0.8 + b[i] * 1.0;
    for (let k = 0; k < 30; k++) ping(sr, a, rand(0.8, 4.8), rand(900, 3500), rand(0.03, 0.12), rand(0.02, 0.1));
    return normaliza(a, 0.98);
  },
  'pieza-metal': (sr) => pieza(sr, false),
  'pieza-cabina': (sr) => pieza(sr, true),
};

function pieza(sr: number, vidrio: boolean) {
  const a = new Float32Array(Math.floor(sr * (vidrio ? 1.6 : 1.2)));
  friccion(sr, a, 0, 0.32, 950, 480, [2000, 3400, 5100], 0.9); // chirrido: se arranca
  golpe(sr, a, 0.24, 140, 55, 0.07, 1.1, 1800); // golpe: se suelta
  for (let k = 0; k < 10; k++) ping(sr, a, 0.3 + Math.pow(Math.random(), 1.5) * 0.7, rand(1200, 3000), rand(0.01, 0.04), rand(0.05, 0.2));
  if (vidrio) {
    const hp = new Bq(sr, 'hp', 4500, 0.7);
    const i0 = Math.floor(sr * 0.24);
    for (let k = 0; k < sr * 0.4 && i0 + k < a.length; k++) a[i0 + k] += hp.run(ruido()) * Math.exp(-k / sr / 0.07) * 0.9;
    for (let k = 0; k < 70; k++) ping(sr, a, 0.25 + Math.pow(Math.random(), 2) * 1.2, rand(3000, 9000), rand(0.008, 0.05), rand(0.03, 0.18));
  }
  return normaliza(a, 0.9);
}

const hornos = new Map<Nombre, AudioBuffer>();
function buf(m: Mezcla, n: Nombre) {
  let b = hornos.get(n);
  if (!b) {
    const sr = m.ctx.sampleRate;
    const d = HORNO[n](sr);
    b = m.ctx.createBuffer(1, d.length, sr);
    b.getChannelData(0).set(d);
    hornos.set(n, b);
  }
  return b;
}

/* ────────────────────────── persecución ────────────────────────── */

const C_JUEGO = 480; // «velocidad del sonido» del juego, px/s: con misiles a 100–250 px/s el doppler se oye claro
const MAX_VOCES = 3;
const TONO: Record<string, number> = { buscador: 1, dardo: 1.3, zigzag: 1.08, pesado: 0.68, racimo: 0.85, enjambre: 1.45, perdigon: 1.55, cohete: 0.9 };

type VozMisil = { id: number; v: Voz; src: AudioBufferSourceNode; g: GainNode; p: Pan; libre: number };
const vocesMisil: VozMisil[] = [];
let duck = 0; // 0…1: cuánto baja el ambiente porque hay un misil encima

type Fijacion = { v: Voz; osc: OscillatorNode; g: GainNode; prox: number; continuo: boolean; quieto: number };
let fij: Fijacion | null = null;

export function persecucion(amenazas: Amenaza[], dt: number): void {
  void dt;
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  // Peligro: cercanía, y más si se acerca rápido.
  const lista = [];
  let dGuiado = Infinity;
  for (const a of amenazas) {
    const dx = num(a.dx), dy = num(a.dy), vx = num(a.vx), vy = num(a.vy);
    const r = Math.max(1, Math.hypot(dx, dy));
    if (r > 520) continue;
    const radial = (vx * dx + vy * dy) / r; // > 0 se aleja, < 0 se acerca
    const peligro = (1 / (r + 25)) * (1 + Math.max(0, -radial) / 180);
    lista.push({ a, dx, r, radial, peligro });
    if (a.guiado) dGuiado = Math.min(dGuiado, r);
  }
  lista.sort((x, y) => y.peligro - x.peligro);
  const top = lista.slice(0, MAX_VOCES);
  const ids = new Set(top.map((x) => x.a.id));

  // Voces cuyas amenazas ya no están: se apagan suave y quedan libres.
  for (let i = vocesMisil.length - 1; i >= 0; i--) {
    const vm = vocesMisil[i];
    if (ids.has(vm.id) && vm.libre < 0) continue;
    if (vm.libre < 0) {
      vm.libre = t;
      hacia(vm.g.gain, 0, t, 0.06);
    } else if (t - vm.libre > 0.6) {
      apagar(vm.v, vm.g, t);
      vocesMisil.splice(i, 1);
    }
  }

  let maxProx = 0;
  for (const x of top) {
    let vm = vocesMisil.find((v) => v.id === x.a.id && v.libre < 0);
    if (!vm) {
      vm = vocesMisil.filter((v) => v.libre >= 0 && t - v.libre > 0.12).sort((p, q) => p.libre - q.libre)[0];
      if (vm) {
        vm.id = x.a.id;
        vm.libre = -1;
      } else if (vocesMisil.length < MAX_VOCES) {
        const src = fuente(m, buf(m, 'silbido'), true);
        const g = ganancia(m, 0);
        const p = panner(m.ctx);
        const v = voz(src, [g, p], m.bus, false);
        src.start(t, Math.random());
        vm = { id: x.a.id, v, src, g, p, libre: -1 };
        vocesMisil.push(vm);
      } else continue;
      // Voz recién asignada: el tono salta al nuevo misil sin deslizarse.
      sujeta(vm.src.playbackRate, t);
    }
    const prox = clamp(1 - x.r / 480, 0, 1);
    maxProx = Math.max(maxProx, prox);
    // Doppler: f' = f·c / (c + v·r̂), r̂ del avión al misil.
    const dop = clamp(C_JUEGO / (C_JUEGO + x.radial), 0.55, 1.9);
    const rate = (TONO[x.a.tipo] ?? 1) * dop;
    hacia(vm.src.playbackRate, rate, t, 0.04);
    hacia(vm.g.gain, 0.04 + 0.78 * prox * prox, t, 0.05);
    panea(vm.p, (x.dx / 220) * 0.85, t);
  }
  duck = maxProx;
  fijacion(m, t, dGuiado);
}

/** Tono de fijación de cabina: bip-bip que se acelera hasta tono continuo. */
function fijacion(m: Mezcla, t: number, d: number) {
  if (d > 460) {
    if (fij) {
      if (fij.prox > 0) {
        sujeta(fij.g.gain, t);
        fij.g.gain.setTargetAtTime(0, t, 0.015);
        fij.prox = 0;
        fij.continuo = false;
        fij.quieto = t;
      } else if (t - fij.quieto > 2) {
        apagar(fij.v, fij.g, t);
        fij = null;
      }
    }
    return;
  }
  if (!fij) {
    const osc = m.ctx.createOscillator();
    // Seno con un poco de 3.º y 5.º armónico: corta la mezcla sin chillar.
    osc.setPeriodicWave(m.ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0, 0.35, 0, 0.15])));
    const g = ganancia(m, 0);
    const v = voz(osc, [g], m.bus, false);
    osc.start(t);
    fij = { v, osc, g, prox: 0, continuo: false, quieto: t };
  }
  const f = fij;
  const cerca = clamp(1 - (d - 40) / 420, 0, 1);
  const nivel = 0.13 + 0.07 * cerca;
  hacia(f.osc.frequency, d <= 40 ? 1320 : 980 + 160 * cerca, t, 0.02);
  if (d <= 40) {
    if (!f.continuo) {
      sujeta(f.g.gain, t);
      f.g.gain.setTargetAtTime(nivel, t, 0.01);
      f.continuo = true;
    }
    f.prox = t + 0.15;
    return;
  }
  if (f.continuo) {
    sujeta(f.g.gain, t);
    f.g.gain.setTargetAtTime(0, t, 0.01);
    f.continuo = false;
    f.prox = t + 0.06;
  }
  const intervalo = 0.065 + 0.5 * Math.pow(1 - cerca, 1.3);
  const largo = Math.min(0.085, intervalo * 0.5);
  if (f.prox < t) f.prox = t + 0.01;
  while (f.prox < t + 0.13) {
    const b = f.prox;
    f.g.gain.setValueAtTime(0, b);
    f.g.gain.linearRampToValueAtTime(nivel, b + 0.004);
    f.g.gain.setValueAtTime(nivel, b + largo - 0.005);
    f.g.gain.linearRampToValueAtTime(0, b + largo);
    f.prox += intervalo;
  }
}

/** Casi-impacto: un misil pasa rozando y falla. */
let ultimaPasada = -1;
export function pasada(dx: number, dy: number, velocidad: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimaPasada < 0.25) return;
  ultimaPasada = t;
  const v = clamp(num(velocidad, 150), 40, 420);
  const r = Math.hypot(num(dx), num(dy));
  const src = fuente(m, buf(m, 'silbido'), true);
  const g = ganancia(m, 0);
  const p = panner(m.ctx);
  voz(src, [g, p], m.bus, true);
  // Se acerca agudo y se aleja grave: la caída de tono es el «fiuuum».
  const alto = C_JUEGO / (C_JUEGO - v * 0.9);
  const bajo = C_JUEGO / (C_JUEGO + v * 0.9);
  src.playbackRate.setValueAtTime(clamp(alto, 0.5, 2.2) * 1.05, t);
  src.playbackRate.setTargetAtTime(clamp(bajo, 0.4, 1), t + 0.1, 0.13);
  const pico = 0.95 * clamp(1 - r / 90, 0.45, 1);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(pico, t + 0.1);
  g.gain.setTargetAtTime(0, t + 0.14, 0.16);
  const lado = clamp(num(dx) / 30, -1, 1);
  if ('pan' in p) {
    p.pan.setValueAtTime(lado * 0.7, t);
    p.pan.linearRampToValueAtTime(-lado * 0.6, t + 0.6);
  }
  src.start(t, Math.random());
  src.stop(t + 1.1);
}

/* ────────────────────────── continuos ────────────────────────── */

type Loop = { v: Voz; src: AudioBufferSourceNode; g: GainNode; f?: BiquadFilterNode; quieto: number };
let motorL: Loop | null = null;
let fuegoL: Loop | null = null;
let vientoL: Loop | null = null;
let tosHasta = 0;

const ambiente = () => 1 - 0.55 * duck;

/** Mantiene un bucle vivo; con volumen 0 se apaga y a los 1.5 s se libera. */
function loop(m: Mezcla, actual: Loop | null, nombre: Nombre, vol: number, filtro?: () => BiquadFilterNode): Loop | null {
  const t = m.ctx.currentTime;
  if (vol < 0.003) {
    if (!actual) return null;
    if (actual.quieto < 0) {
      actual.quieto = t;
      hacia(actual.g.gain, 0, t, 0.08);
    } else if (t - actual.quieto > 1.5) {
      apagar(actual.v, actual.g, t);
      return null;
    }
    return actual;
  }
  if (!actual) {
    const src = fuente(m, buf(m, nombre), true);
    const g = ganancia(m, 0);
    const f = filtro?.();
    const v = voz(src, f ? [f, g] : [g], m.bus, false);
    src.start(t, Math.random() * 1.5);
    actual = { v, src, g, f, quieto: -1 };
  }
  actual.quieto = -1;
  return actual;
}

export function motorDanado(nivel: number, aceleracion: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const n = clamp(num(nivel), 0, 1);
  const acc = clamp(num(aceleracion), 0, 1);
  const vol = n < 0.03 ? 0 : (0.08 + 0.42 * n) * ambiente();
  motorL = loop(m, motorL, 'tos', vol);
  if (!motorL || vol === 0) return;
  // Más dañado: más grave, más irregular.
  hacia(motorL.src.playbackRate, (0.75 + 0.45 * acc) * (1 - 0.15 * n) * rand(0.94, 1.06), t, 0.06);
  if (t >= tosHasta) {
    hacia(motorL.g.gain, vol, t, 0.06);
    // Tos: el motor se ahoga un instante y revienta con un petardeo.
    if (Math.random() < Math.pow(n, 1.5) * 0.25) {
      const corte = rand(0.06, 0.08 + 0.2 * n);
      const g = motorL.g.gain;
      sujeta(g, t);
      g.setTargetAtTime(vol * 0.08, t, 0.012);
      g.setTargetAtTime(vol * 1.2, t + corte, 0.02);
      tosHasta = t + corte + 0.12;
      unaVez(m, 'petardo', 0.3 + 0.45 * n, rand(0.8, 1.2), t + corte);
    }
  }
  // Rechinido de chapa, cada vez más frecuente.
  if (n > 0.35 && Math.random() < (n - 0.35) * 0.06) unaVez(m, 'rechinido', 0.12 + 0.2 * n, rand(0.7, 1.3), t);
}

export function fuego(intensidad: number): void {
  const m = salida();
  if (!m) return;
  const i = clamp(num(intensidad), 0, 1);
  const vol = i < 0.02 ? 0 : 0.6 * Math.pow(i, 0.8) * ambiente();
  fuegoL = loop(m, fuegoL, 'crepitar', vol);
  if (!fuegoL || vol === 0) return;
  const t = m.ctx.currentTime;
  hacia(fuegoL.g.gain, vol, t, 0.1);
  hacia(fuegoL.src.playbackRate, 0.85 + 0.4 * i, t, 0.2);
}

export function viento(velocidad: number, carga: number): void {
  const m = salida();
  if (!m) return;
  const v = clamp(num(velocidad) / 230, 0, 1.4);
  const w = clamp((Math.abs(num(carga)) - 2) / 4, 0, 1); // silba desde ~2 g
  const q = 0.8 + 8 * w;
  const vol = (0.03 + 0.2 * v * v + 0.16 * w) * Math.sqrt(q) * 0.75 * ambiente();
  vientoL = loop(m, vientoL, 'viento', vol, () => {
    const f = m.ctx.createBiquadFilter();
    f.type = 'bandpass';
    return f;
  });
  if (!vientoL || !vientoL.f) return;
  const t = m.ctx.currentTime;
  hacia(vientoL.g.gain, vol, t, 0.12);
  hacia(vientoL.f.frequency, 280 + 650 * v + 1900 * w, t, 0.1);
  hacia(vientoL.f.Q, q, t, 0.1);
  hacia(vientoL.src.playbackRate, 0.8 + 0.4 * v, t, 0.2);
}

/* ────────────────────────── latido de tensión ────────────────────────── */

let pulsoG: GainNode | null = null;
let pulsoProx = 0;

export function intensidad(nivel: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const n = clamp(num(nivel), 0, 1);
  if (n < 0.05) {
    pulsoProx = 0;
    return;
  }
  if (!pulsoG) {
    pulsoG = ganancia(m, 0);
    pulsoG.connect(m.bus);
    vivos++;
  }
  const periodo = 60 / (68 + 112 * n);
  const vol = (0.14 + 0.32 * n) * (1 - 0.3 * duck);
  if (pulsoProx < t) pulsoProx = t + 0.02;
  // «Pum-pum» como un corazón: el segundo golpe más suave y algo más agudo.
  while (pulsoProx < t + 0.15) {
    const b = pulsoProx;
    latido(m, b, vol, 1);
    latido(m, b + Math.min(0.17, periodo * 0.32), vol * 0.55, 1.12);
    pulsoProx += periodo;
  }
}

function latido(m: Mezcla, t: number, vol: number, rate: number) {
  if (!pulsoG || vivos + 1 > LIMITE) return;
  pulsoG.gain.setValueAtTime(vol, t);
  const src = fuente(m, buf(m, 'latido'), false, rate);
  voz(src, [], pulsoG, true);
  src.start(t);
}

/* ────────────────────────── eventos ────────────────────────── */

/** Un efecto suelto de baja prioridad (respeta el tope de nodos). */
function unaVez(m: Mezcla, n: Nombre, vol: number, rate: number, t: number, pan = 0) {
  if (vivos + 3 > LIMITE) return;
  const src = fuente(m, buf(m, n), false, rate);
  const g = ganancia(m, vol);
  const cadena: AudioNode[] = [g];
  if (pan) {
    const p = panner(m.ctx);
    panea(p, pan, t, 0.001);
    cadena.push(p);
  }
  voz(src, cadena, m.bus, true);
  src.start(t);
}

type VozExplo = { v: Voz; g: GainNode; prioridad: number; inicio: number; dur: number };
const explos: VozExplo[] = [];
const MAX_EXPLO = 2;

export function explosion(energia: number, distancia: number, pan: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const e = clamp(num(energia, 1), 0.2, 12);
  const d = Math.max(0, num(distancia));
  const size = Math.cbrt(e); // 0.6 … 2.3, como el radio de la explosión
  const vol = clamp((0.45 + 0.28 * size) / (1 + d / 320), 0, 1.1);
  if (vol < 0.02) return;
  const nombre: Nombre = e >= 3 ? 'explo-grande' : 'explo-chica';
  // Más energía: más grave y más larga (playbackRate baja).
  const rate = clamp(1.42 - 0.3 * size, 0.62, 1.3) * rand(0.94, 1.06);
  const b = buf(m, nombre);
  const dur = b.duration / rate;
  // Robo de voz: si no cabe, cae la que menos suena ahora.
  for (let i = explos.length - 1; i >= 0; i--) if (!explos[i].v.viva) explos.splice(i, 1);
  const resta = (x: VozExplo) => x.prioridad * clamp(1 - (t - x.inicio) / x.dur, 0, 1);
  if (explos.length >= MAX_EXPLO) {
    explos.sort((p, q) => resta(p) - resta(q));
    if (resta(explos[0]) > vol) return;
    const vieja = explos.shift()!;
    apagar(vieja.v, vieja.g, t, 0.012);
  }
  // Lejos: el sonido llega un poco tarde y sin agudos.
  const t0 = t + Math.min(0.25, d / 1800);
  const src = fuente(m, b, false, rate);
  const lp = m.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 350 + 17000 * Math.exp(-d / 200);
  lp.Q.value = 0.5;
  const g = ganancia(m, vol);
  const p = panner(m.ctx);
  panea(p, num(pan), t, 0.001);
  const v = voz(src, [lp, g, p], m.bus, true);
  src.start(t0);
  explos.push({ v, g, prioridad: vol, inicio: t0, dur });
}

export function piezaRota(parte: string): void {
  const m = salida();
  if (!m) return;
  const src = fuente(m, buf(m, parte === 'cabina' ? 'pieza-cabina' : 'pieza-metal'), false, rand(0.9, 1.1));
  const g = ganancia(m, 0.75);
  voz(src, [g], m.bus, true);
  src.start(m.ctx.currentTime);
}

export function derribo(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  // Todo lo demás se corta: el estallido final tiene la mezcla para él solo.
  apagarContinuos(t, 0.03);
  for (const x of explos) apagar(x.v, x.g, t, 0.03);
  explos.length = 0;
  const src = fuente(m, buf(m, 'derribo'));
  const g = ganancia(m, 1);
  voz(src, [g], m.bus, true);
  src.start(t + 0.01);
  // Y un último petardeo/rechinido entre los escombros.
  unaVez(m, 'rechinido', 0.25, 0.55, t + 1.2, -0.3);
}

/* ────────────────────────── apagar ────────────────────────── */

function apagarContinuos(t: number, tc: number) {
  for (const vm of vocesMisil) apagar(vm.v, vm.g, t, tc);
  vocesMisil.length = 0;
  for (const l of [motorL, fuegoL, vientoL]) if (l) apagar(l.v, l.g, t, tc);
  motorL = fuegoL = vientoL = null;
  if (fij) apagar(fij.v, fij.g, t, tc);
  fij = null;
  if (pulsoG) {
    sujeta(pulsoG.gain, t);
    pulsoG.gain.setTargetAtTime(0, t, tc);
  }
  pulsoProx = 0;
  duck = 0;
  tosHasta = 0;
}

/** Apaga todo (pausa o salir): fundido de ~50 ms y libera los nodos. */
export function detener(): void {
  if (!mz) return;
  const t = mz.ctx.currentTime;
  apagarContinuos(t, 0.012);
  for (const v of [...sueltos]) {
    const g = v.nodos.find((n): n is GainNode => n instanceof GainNode);
    if (g) apagar(v, g, t, 0.012);
    else liberar(v);
  }
  explos.length = 0;
}

/** Contexto nuevo: suelta todo lo del anterior. */
function reiniciar() {
  for (const vm of vocesMisil) liberar(vm.v);
  vocesMisil.length = 0;
  for (const l of [motorL, fuegoL, vientoL]) if (l) liberar(l.v);
  motorL = fuegoL = vientoL = null;
  if (fij) liberar(fij.v);
  fij = null;
  for (const v of [...sueltos]) liberar(v);
  explos.length = 0;
  pulsoG?.disconnect();
  pulsoG = null;
  if (mz) {
    mz.bus.disconnect();
    mz.comp.disconnect();
  }
  mz = null;
  vivos = 0;
  hornos.clear();
  duck = 0;
}

/** Solo para pruebas (render offline): usa este contexto y destino en vez del del sitio. */
export function __usarContexto(ctx: BaseAudioContext | null, dest?: AudioNode) {
  inyectado = ctx ? { ctx, dest: dest ?? ctx.destination } : null;
}
/** Solo para pruebas: nodos vivos creados por este módulo. */
export const __nodosVivos = () => vivos;
