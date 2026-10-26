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
 * Presupuesto: ~46 nodos en el peor caso continuo (3 misiles × 3, tonos de
 * fijación 2 + 3 + 2 de la mira propia, viento 3, fuego 2, motor 2, latido 1,
 * ambiente de altitud 2–4, ovnis 2 × 3, bus 4 + 6 del ensanchador estéreo);
 * los efectos sueltos se recortan con un tope global y las explosiones se
 * roban por prioridad. Metralla, tiros enemigos y salpicaduras llevan además
 * su propio tope de 3 voces.
 *
 * Altitud: cada zona (campo, nubes, estratosfera, espacio) tiene su cama de
 * ambiente en bucle estéreo y se funden entre sí con potencia constante. Con
 * la altura el aire se adelgaza: el viento de velocidad baja, las explosiones
 * se apagan (en el espacio solo llega lo que transmite el fuselaje) y el motor
 * grabado se ahoga vía atenuacionMotor().
 *
 * Alarmas: mientras suena una fijación, las explosiones van por un bus que
 * se agacha, así el «bip» nunca queda tapado por un estallido lejano.
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

type Mezcla = { ctx: Ctx; dest: AudioNode; bus: GainNode; comp: DynamicsCompressorNode; tibio: BiquadFilterNode; explo: GainNode; ancho: AudioNode[] };
let inyectado: { ctx: Ctx; dest: AudioNode } | null = null;
let mz: Mezcla | null = null;
let vivos = 0; // nodos creados por este módulo que siguen conectados
const LIMITE = 50; // tope para efectos sueltos de baja prioridad (incluye los 10 nodos fijos del bus)
const LIMITE_AMB = 44; // los adornos de ambiente (pájaros, hielo, estrellas) ceden antes

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
  // Repisa suave en agudos: en sesiones largas lo que cansa son los 6–12 kHz.
  const tibio = ctx.createBiquadFilter();
  tibio.type = 'highshelf';
  tibio.frequency.value = 6500;
  tibio.gain.value = -3;
  // Siempre estéreo desde aquí: el ensanchador necesita los dos canales
  // aunque en ese momento solo suenen fuentes mono.
  tibio.channelCount = 2;
  tibio.channelCountMode = 'explicit';
  tibio.channelInterpretation = 'speakers';
  bus.connect(tibio);
  const ancho = ensanchar(ctx, tibio, comp);
  comp.connect(o.dest);
  // Bus de explosiones: se agacha mientras suena una alarma.
  const explo = ctx.createGain();
  explo.connect(bus);
  vivos += 4 + ancho.length;
  mz = { ctx, dest: o.dest, bus, comp, tibio, explo, ancho };
  return mz;
}

/**
 * Ensanchador M/S sutil: L' = (1+w)·L − w·R. El centro (lo mono) no cambia y
 * los lados ganan ~1.9 dB, así lo paneado se abre sin sumar nivel al centro.
 */
const ANCHO = 0.12;
function ensanchar(ctx: Ctx, de: AudioNode, a: AudioNode): AudioNode[] {
  const sep = ctx.createChannelSplitter(2);
  const jun = ctx.createChannelMerger(2);
  const g = (v: number) => {
    const x = ctx.createGain();
    x.gain.value = v;
    return x;
  };
  const ll = g(1 + ANCHO), rl = g(-ANCHO), rr = g(1 + ANCHO), lr = g(-ANCHO);
  de.connect(sep);
  sep.connect(ll, 0).connect(jun, 0, 0);
  sep.connect(rl, 1).connect(jun, 0, 0);
  sep.connect(rr, 1).connect(jun, 0, 1);
  sep.connect(lr, 0).connect(jun, 0, 1);
  jun.connect(a);
  return [sep, jun, ll, rl, rr, lr];
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
  | 'explo-chica' | 'explo-grande' | 'derribo' | 'pieza-metal' | 'pieza-cabina'
  | 'brisa' | 'nubes' | 'estrato' | 'espacio' | 'pajaro' | 'pajaro2' | 'hielo' | 'estrella'
  | 'whoosh' | 'whoosh-baja' | 'campanas' | 'ovni' | 'zap'
  | 'tk' | 'tk2' | 'tk-sordo' | 'siseo' | 'nitro' | 'nitro-fin' | 'mejora' | 'fanfarria'
  | 'gaviota' | 'ola' | 'chapuzon' | 'bocina' | 'caza';

const HORNO: Record<Nombre, (sr: number) => Float32Array | Float32Array[]> = {
  // Cohete: silbido agudo resonante + siseo + zumbido de tobera + rugido grave.
  silbido: (sr) => {
    const silb = new Bq(sr, 'bp', 3500, 16);
    const sis = new Bq(sr, 'bp', 2400, 2.5);
    const rug = new Bq(sr, 'lp', 320, 0.7);
    const zum = new Bq(sr, 'lp', 1100, 0.7);
    let fz = 0;
    return bucle(sr, 1, (i, t) => {
      fz += (150 + 6 * Math.sin(2 * Math.PI * 3 * t)) / sr;
      const saw = (fz % 1) * 2 - 1;
      const flutter = 1 + 0.18 * Math.sin(2 * Math.PI * 23 * t) + 0.08 * ruido();
      return (silb.run(ruido()) * 2.6 + sis.run(ruido()) * 0.7 + rug.run(ruido()) * 0.9 + zum.run(saw) * 0.35) * flutter;
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
  brisa: hornoBrisa,
  nubes: hornoNubes,
  estrato: hornoEstrato,
  espacio: hornoEspacio,
  pajaro: (sr) => hornoPajaro(sr, false),
  pajaro2: (sr) => hornoPajaro(sr, true),
  hielo: hornoHielo,
  estrella: hornoEstrella,
  whoosh: (sr) => hornoWhoosh(sr, true),
  'whoosh-baja': (sr) => hornoWhoosh(sr, false),
  campanas: hornoCampanas,
  ovni: hornoOvni,
  zap: hornoZap,
  tk: (sr) => hornoTk(sr, false),
  tk2: (sr) => hornoTk(sr, false),
  'tk-sordo': (sr) => hornoTk(sr, true),
  siseo: hornoSiseo,
  nitro: hornoNitro,
  'nitro-fin': hornoNitroFin,
  mejora: hornoMejora,
  fanfarria: hornoFanfarria,
  gaviota: hornoGaviota,
  ola: hornoOla,
  chapuzon: hornoChapuzon,
  bocina: hornoBocina,
  caza: hornoCaza,
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

/* ── hornos de altitud ── */

const TAU = 2 * Math.PI;

/** Escala varios canales juntos (sin fundir bordes: son bucles). */
function escala(chs: Float32Array[], pico: number) {
  let m = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  if (m > 0) for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= pico / m;
  return chs;
}

/** Normaliza un sonido suelto estéreo con bordes a cero. */
function normalizaEst(chs: Float32Array[], pico: number) {
  escala(chs, pico);
  for (const a of chs) {
    const f = Math.min(256, a.length >> 2);
    for (let i = 0; i < f; i++) {
      a[i] *= i / f;
      a[a.length - 1 - i] *= i / f;
    }
  }
  return chs;
}

/** Suma un mono en dos canales con paneo de potencia constante. */
function aEstereo(L: Float32Array, R: Float32Array, i: number, y: number, pan: number) {
  const p = clamp(pan, -1, 1);
  L[i] += y * Math.sqrt((1 - p) / 2);
  R[i] += y * Math.sqrt((1 + p) / 2);
}

/** Campo: brisa baja que respira, con un roce de hojas apenas presente. */
function hornoBrisa(sr: number) {
  const L = 6;
  return escala(
    [0, 1].map((c) => {
      const lp = new Bq(sr, 'lp', 500, 0.6);
      const hp = new Bq(sr, 'hp', 2600, 0.7);
      const lp2 = new Bq(sr, 'lp', 5000, 0.7);
      const ph = c * 1.7;
      return bucle(sr, L, (i, t) => {
        if ((i & 63) === 0) lp.f(360 + 280 * (0.5 + 0.5 * Math.sin((TAU * t) / L + ph)));
        const sw = 0.6 + 0.4 * Math.sin((TAU * t) / (L / 2) + ph);
        return lp.run(ruido()) * sw + lp2.run(hp.run(ruido())) * 0.06 * sw * sw;
      });
    }),
    0.9,
  );
}

/** Nubes: viento hueco (dos formantes que se mueven) y ráfagas, ancho. */
function hornoNubes(sr: number) {
  const L = 8;
  return escala(
    [0, 1].map((c) => {
      const b1 = new Bq(sr, 'bp', 320, 2.5);
      const b2 = new Bq(sr, 'bp', 820, 3);
      const lp = new Bq(sr, 'lp', 240, 0.7);
      const ph = c * 0.9;
      return bucle(sr, L, (i, t) => {
        if ((i & 63) === 0) {
          b1.f(300 + 90 * Math.sin((TAU * t) / L + ph));
          b2.f(760 + 220 * Math.sin((TAU * t) / (L / 2) + ph * 2));
        }
        const racha = 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin((TAU * t) / L - 1.2 + ph * 0.3), 3) + 0.25 * Math.pow(0.5 + 0.5 * Math.sin((TAU * t) / (L / 3) + ph), 4);
        return (b1.run(ruido()) * 1.4 + b2.run(ruido()) * 0.75 + lp.run(ruido()) * 0.9) * racha;
      });
    }),
    0.9,
  );
}

/** Estratosfera: viento delgado (sin graves) y un zumbido grave tenue que late. */
function hornoEstrato(sr: number) {
  const L = 8;
  const chs = [0, 1].map((c) => {
    const hp = new Bq(sr, 'hp', 1700, 0.7);
    const lp = new Bq(sr, 'lp', 4800, 0.7);
    const ph = c * 2.1;
    return bucle(sr, L, (_i, t) => lp.run(hp.run(ruido())) * (0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin((TAU * t) / (L / 2) + ph), 2)));
  });
  // Frecuencias múltiplo de 1/L: el zumbido es periódico y el bucle no tiene costura.
  chs.forEach((ch, c) => {
    const d = c ? 0.125 : -0.125;
    for (let i = 0; i < ch.length; i++) {
      const t = i / sr;
      const z = Math.sin(TAU * (46 + d) * t) * 0.5 + Math.sin(TAU * 69 * t) * 0.22 + Math.sin(TAU * (92 - d) * t) * 0.2 + Math.sin(TAU * 138 * t) * 0.06;
      ch[i] = ch[i] * 0.4 + z * (0.75 + 0.25 * Math.sin((TAU * t) / L));
    }
  });
  return escala(chs, 0.9);
}

/** Espacio: pad de acorde abierto (La–Mi–Si) sostenido, con coro lento. */
function hornoEspacio(sr: number) {
  const L = 12;
  const n = Math.round(sr * L);
  // [frecuencia, amplitud, ciclos de respiración por bucle, fase]
  const notas: [number, number, number, number][] = [
    [55, 0.5, 1, 0], [82.5, 0.34, 2, 1], [110, 0.34, 3, 2], [165, 0.22, 1, 3.5], [247.5, 0.11, 2, 4.2], [330, 0.05, 3, 5.1], [440, 0.025, 1, 0.7],
  ];
  return escala(
    [0, 1].map((c) => {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let s = 0;
        notas.forEach(([f, amp, k, ph], j) => {
          // Desafinación ±1/L Hz entre canales: batido lento y ancho, sin costura.
          const fd = f + ((c ? 1 : -1) * (j % 2 ? 1 : -1)) / L;
          const resp = 0.6 + 0.4 * Math.sin((TAU * k * t) / L + ph + c * 0.8);
          s += amp * resp * (Math.sin(TAU * fd * t) + 0.12 * Math.sin(TAU * 2 * fd * t));
        });
        a[i] = s;
      }
      return a;
    }),
    0.9,
  );
}

/** Pajarito lejano: trino o silbido de dos notas, ya filtrado por la distancia. */
function hornoPajaro(sr: number, silbo: boolean) {
  const a = new Float32Array(Math.floor(sr * 1.1));
  const lp = new Bq(sr, 'lp', 3800, 0.7);
  const notas = silbo ? 2 : 5 + Math.floor(Math.random() * 3);
  let t0 = 0.02;
  for (let k = 0; k < notas; k++) {
    const dur = silbo ? 0.22 : rand(0.04, 0.07);
    const fa = silbo ? (k ? 2300 : 2900) : rand(3000, 3600);
    const fb = silbo ? (k ? 2100 : 2800) : fa * rand(1.12, 1.25);
    let ph = 0;
    const i0 = Math.floor(t0 * sr);
    for (let j = 0; j < dur * sr && i0 + j < a.length; j++) {
      const u = j / (dur * sr);
      ph += (fa + (fb - fa) * u) / sr;
      a[i0 + j] += (Math.sin(TAU * ph) + 0.15 * Math.sin(2 * TAU * ph)) * Math.sin(Math.PI * u);
    }
    t0 += dur + (silbo ? 0.08 : rand(0.02, 0.04));
  }
  for (let i = 0; i < a.length; i++) a[i] = lp.run(a[i]);
  return normaliza(a, 0.8);
}

/** Crujido de hielo en el fuselaje: grietas finas + un quejido de chapa fría. */
function hornoHielo(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.8));
  chasquidos(sr, a, 0, 0.35, (t) => 220 * Math.exp(-t / 0.12), { hp: 2200, amp: 1, largo: [0.0006, 0.003] });
  friccion(sr, a, 0.05, 0.45, 130, 70, [600, 1300], 0.25);
  for (let k = 0; k < 4; k++) ping(sr, a, rand(0.02, 0.3), rand(1800, 3200), rand(0.01, 0.03), rand(0.05, 0.12));
  const lp = new Bq(sr, 'lp', 6000, 0.7);
  for (let i = 0; i < a.length; i++) a[i] = lp.run(a[i]);
  return normaliza(a, 0.85);
}

/** Estrella que titila: campanita suave con temblor y eco lejano. */
function hornoEstrella(sr: number) {
  const a = new Float32Array(Math.floor(sr * 2.4));
  const f = 1320;
  for (const [d, amp] of [[0, 1], [0.21, 0.32], [0.43, 0.12]]) {
    const i0 = Math.floor(d * sr);
    for (let j = 0; i0 + j < a.length; j++) {
      const t = j / sr;
      const env = Math.min(1, t / 0.015) * Math.exp(-t / 0.55) * (0.75 + 0.25 * Math.sin(TAU * 9 * t));
      a[i0 + j] += amp * env * (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.15) + 0.08 * Math.sin(TAU * 3 * f * t) * Math.exp(-t / 0.08));
    }
  }
  return normaliza(a, 0.8);
}

/** «Whoosh» de cambio de zona: ruido que barre hacia arriba (o abajo) y cruza el estéreo. */
function hornoWhoosh(sr: number, sube: boolean) {
  const n = Math.floor(sr * 2);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const bp = new Bq(sr, 'bp', 300, 1.4);
  const lp = new Bq(sr, 'lp', 180, 0.7);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const k = Math.min(1, u / 0.75);
    if ((i & 31) === 0) bp.f(sube ? 250 * Math.pow(9, k) : 2250 / Math.pow(9, k));
    const env = u < 0.45 ? Math.pow(u / 0.45, 2) : Math.exp(-(u - 0.45) / 0.12);
    aEstereo(L, R, i, (bp.run(ruido()) + lp.run(ruido()) * 0.6) * env, (sube ? -0.6 : 0.6) * (1 - 2 * u));
  }
  return normalizaEst([L, R], 0.9);
}

/** Llegada al espacio: campanitas FM en arpegio (del acorde del pad) con eco y un whoosh debajo. */
function hornoCampanas(sr: number) {
  const n = Math.floor(sr * 2.6);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const notas = [440, 550, 660, 825, 880];
  notas.forEach((f, k) => {
    const pan = -0.7 + (1.4 * k) / (notas.length - 1);
    for (const [d, amp, lado] of [[0, 0.5 * (1 - k * 0.08), pan], [0.27, 0.16, -pan], [0.55, 0.07, pan]]) {
      const i0 = Math.floor((0.08 + k * 0.13 + d) * sr);
      for (let j = 0; i0 + j < n && j < sr * 1.9; j++) {
        const t = j / sr;
        const mod = Math.sin(TAU * f * 3.5 * t) * 1.2 * Math.exp(-t / 0.25);
        aEstereo(L, R, i0 + j, Math.sin(TAU * f * t + mod) * Math.exp(-t / 0.7) * Math.min(1, t / 0.003) * amp, lado);
      }
    }
  });
  const [wl, wr] = hornoWhoosh(sr, true);
  for (let i = 0; i < n && i < wl.length; i++) {
    L[i] += wl[i] * 0.3;
    R[i] += wr[i] * 0.3;
  }
  return normalizaEst([L, R], 0.9);
}

/** Platillo volador: theremín que ondula + zumbido pulsante. Periódico en 4 s. */
function hornoOvni(sr: number) {
  const Lp = 4;
  const n = Math.round(sr * Lp);
  const a = new Float32Array(n);
  const f0 = 520; // f0·Lp entero, y todas las modulaciones dan ciclos enteros: bucle sin costura
  const w = TAU / Lp;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // Fase integrada analíticamente de f0·(1 + 0.18 sin ωt + 0.07 sin(3ωt+1) + 0.015 sin(2π6t)).
    const ph =
      f0 * t +
      ((f0 * 0.18) / w) * (1 - Math.cos(w * t)) +
      ((f0 * 0.07) / (3 * w)) * (Math.cos(1) - Math.cos(3 * w * t + 1)) +
      ((f0 * 0.015) / (TAU * 6)) * (1 - Math.cos(TAU * 6 * t));
    const ther = Math.sin(TAU * ph) + 0.22 * Math.sin(2 * TAU * ph) + 0.07 * Math.sin(3 * TAU * ph);
    const hum = (Math.sin(TAU * 110 * t) * 0.5 + Math.sin(TAU * 165 * t) * 0.18) * (0.55 + 0.45 * Math.sin(TAU * 8 * t));
    a[i] = ther * 0.55 + hum * 0.6;
  }
  return escala([a], 0.9)[0];
}

/** Rayo del ovni: «piuu» que cae, con vibrato, chisporroteo y un eco corto. */
function hornoZap(sr: number) {
  const n = Math.floor(sr * 0.75);
  const a = new Float32Array(n);
  const lp = new Bq(sr, 'lp', 4500, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = (220 + 1700 * Math.exp(-t / 0.09)) * (1 + 0.12 * Math.sin(TAU * 38 * t));
    ph += f / sr;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.16);
    a[i] = lp.run((Math.tanh(2.2 * Math.sin(TAU * ph)) * 0.7 + Math.sin(2 * TAU * ph) * 0.2) * env);
  }
  chasquidos(sr, a, 0, 0.25, () => 120, { hp: 2500, amp: 0.25, largo: [0.0008, 0.003] });
  const eco = Math.floor(sr * 0.11);
  for (let i = n - 1; i >= eco; i--) a[i] += a[i - eco] * 0.35;
  return normaliza(a, 0.85);
}

/* ── hornos de combate y eventos ── */

/**
 * Disparo de metralla: chasquido del percutor + estampido de boca + golpe
 * grave cortísimo. La energía se va en ~20 ms: a 60–75 ms entre tiros queda
 * aire entre uno y otro (ritmo, no un muro). «sordo» es el de un enemigo
 * lejano: sin brillo, más grave y con dos rebotes de eco.
 */
function hornoTk(sr: number, sordo: boolean) {
  const a = new Float32Array(Math.floor(sr * (sordo ? 0.24 : 0.085)));
  const hp = new Bq(sr, 'hp', sordo ? 500 : 1500, 0.7);
  const bp = new Bq(sr, 'bp', sordo ? 850 : rand(2300, 2900), 1.3);
  const lp = new Bq(sr, 'lp', sordo ? 1500 : 7500, 0.7);
  let f = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const click = hp.run(ruido()) * Math.exp(-t / (sordo ? 0.004 : 0.0014));
    const boca = bp.run(ruido()) * Math.exp(-t / (sordo ? 0.028 : 0.011)) * 2.6;
    f += ((sordo ? 70 : 115) + (sordo ? 90 : 190) * Math.exp(-t / 0.007)) / sr;
    const cuerpo = Math.sin(TAU * f) * Math.exp(-t / (sordo ? 0.04 : 0.016)) * Math.min(1, t / 0.0008);
    a[i] = lp.run(Math.tanh((click * 1.2 + boca + cuerpo * 1.1) * 1.6));
  }
  if (sordo) {
    // Rebotes en el valle: el tiro lejano «suena a campo abierto».
    const e1 = Math.floor(sr * 0.075), e2 = Math.floor(sr * 0.14);
    for (let i = a.length - 1; i >= e1; i--) a[i] += a[i - e1] * 0.3 + (i >= e2 ? a[i - e2] * 0.14 : 0);
  }
  return normaliza(a, 0.9);
}

/** Metralla recalentada: «clonc» del cerrojo, siseo de vapor y metal que crepita. */
function hornoSiseo(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.5));
  golpe(sr, a, 0, 150, 60, 0.045, 1, 1200);
  ping(sr, a, 0.004, 1850, 0.06, 0.25);
  ping(sr, a, 0.01, 2950, 0.04, 0.14);
  const hp = new Bq(sr, 'hp', 2600, 0.7);
  const lp = new Bq(sr, 'lp', 9000, 0.7);
  const i0 = Math.floor(sr * 0.04);
  for (let i = i0; i < a.length; i++) {
    const t = i / sr, u = t - 0.04;
    const env = Math.min(1, u / 0.05) * Math.exp(-u / 0.42) * (0.8 + 0.2 * Math.sin(TAU * 13 * t));
    a[i] += lp.run(hp.run(ruido())) * env * 0.75;
  }
  chasquidos(sr, a, 0.1, 1.3, (t) => 30 * Math.exp(-t / 0.5), { hp: 3000, amp: 0.3, largo: [0.0008, 0.003] });
  return normaliza(a, 0.85);
}

/**
 * Súper nitro (3 s, estéreo): fogonazo que barre hacia arriba y luego un
 * rugido de 2.5 s cuyo tono sube (tobera + llama que se abre), y se apaga.
 */
function hornoNitro(sr: number) {
  const n = Math.floor(sr * 3);
  const chs = [0, 1].map((c) => {
    const a = new Float32Array(n);
    const sw = new Bq(sr, 'bp', 300, 1.2);
    const rug = new Bq(sr, 'lp', 450, 0.8);
    const sis = new Bq(sr, 'bp', 2200, 0.9);
    const tono = new Bq(sr, 'lp', 700, 0.7);
    let fz = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const u = clamp(t / 2.5, 0, 1);
      if ((i & 31) === 0) {
        sw.f(300 * Math.pow(10, Math.min(1, t / 0.35)));
        rug.f(450 + 950 * u * u);
        sis.f(2200 + 1800 * u);
      }
      const ign = t < 0.8 ? Math.pow(Math.min(1, t / 0.22), 2) * Math.exp(-Math.max(0, t - 0.22) / 0.12) : 0;
      const burn = Math.min(1, Math.max(0, t - 0.06) / 0.25) * (t < 2.5 ? 1 : Math.exp(-(t - 2.5) / 0.14));
      fz += (52 + 50 * u * u + 3 * Math.sin(TAU * 9 * t + c)) / sr;
      const saw = (fz % 1) * 2 - 1;
      const flick = 1 + 0.12 * Math.sin(TAU * 31 * t + c * 2) + 0.1 * ruido();
      const y = sw.run(ruido()) * ign * 1.6 + (rug.run(ruido()) * 1.3 + sis.run(ruido()) * 0.35 * (0.4 + u) + tono.run(saw) * 0.5) * burn * flick;
      a[i] = Math.tanh(y * 1.3);
    }
    chasquidos(sr, a, 0.1, 2.5, () => 25, { hp: 2500, amp: 0.2, largo: [0.001, 0.004] });
    return a;
  });
  return normalizaEst(chs, 0.9);
}

/** Fin del nitro: petardeo, rugido que cae y chapa que se enfría. */
function hornoNitroFin(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.4));
  golpe(sr, a, 0, 170, 50, 0.055, 1, 2200);
  const lp = new Bq(sr, 'lp', 1200, 0.8);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) lp.f(250 + 950 * Math.exp(-t / 0.25));
    a[i] += lp.run(ruido()) * Math.exp(-t / 0.35) * Math.min(1, t / 0.01) * 0.9;
  }
  chasquidos(sr, a, 0.02, 0.5, (t) => 60 * Math.exp(-t / 0.15), { hp: 2000, amp: 0.35, largo: [0.001, 0.004] });
  for (let k = 0; k < 4; k++) ping(sr, a, rand(0.35, 1.1), rand(2200, 3600), rand(0.01, 0.025), rand(0.03, 0.07));
  return normaliza(a, 0.85);
}

/** Mejora especial: «blup» que sube, arpegio de campanitas FM y brillitos. */
function hornoMejora(sr: number) {
  const n = Math.floor(sr * 1.05);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < sr * 0.06; i++) {
    const t = i / sr;
    ph += (320 + 520 * (t / 0.06)) / sr;
    aEstereo(L, R, i, Math.sin(TAU * ph) * Math.sin((Math.PI * t) / 0.06) * 0.45, 0);
  }
  const notas = [1318.5, 1661.2, 1975.5, 2637];
  notas.forEach((f, k) => {
    const i0 = Math.floor((0.04 + k * 0.055) * sr);
    const pan = -0.45 + (0.9 * k) / (notas.length - 1);
    for (let j = 0; i0 + j < n; j++) {
      const t = j / sr;
      const mod = Math.sin(TAU * f * 2 * t) * 0.8 * Math.exp(-t / 0.08);
      aEstereo(L, R, i0 + j, Math.sin(TAU * f * t + mod) * Math.exp(-t / (k === 3 ? 0.4 : 0.22)) * Math.min(1, t / 0.002) * 0.4, pan);
    }
  });
  for (let k = 0; k < 14; k++) {
    const i0 = Math.floor(rand(0.18, 0.85) * sr);
    const f = rand(3200, 7000), tau = rand(0.01, 0.03), amp = rand(0.03, 0.09), pan = rand(-0.8, 0.8);
    for (let j = 0; i0 + j < n && j < tau * 6 * sr; j++) aEstereo(L, R, i0 + j, Math.sin((TAU * f * j) / sr) * Math.exp(-j / sr / tau) * amp, pan);
  }
  return normalizaEst([L, R], 0.85);
}

/** Nota de «metal» sintético: tres sierras desafinadas con un paso bajo que se abre al atacar. */
function bronce(sr: number, L: Float32Array, R: Float32Array, t0: number, f: number, dur: number, amp: number, pan: number) {
  const lp = new Bq(sr, 'lp', 600, 1.1);
  const i0 = Math.floor(t0 * sr);
  const fases = [0, 0.33, 0.67];
  const des = [0.996, 1, 1.005];
  for (let j = 0; i0 + j < L.length && j < (dur + 0.4) * sr; j++) {
    const t = j / sr;
    const env = (t < 0.02 ? t / 0.02 : t < dur ? 0.78 + 0.22 * Math.exp(-(t - 0.02) / 0.06) : 0.78 * Math.exp(-(t - dur) / 0.08));
    if ((j & 15) === 0) lp.f(400 + f * (1.4 + 4 * env * Math.exp(-t / 0.22)));
    const vib = 1 + 0.006 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / 0.3);
    let s = 0;
    for (let k = 0; k < 3; k++) {
      fases[k] = (fases[k] + (f * des[k] * vib) / sr) % 1;
      s += fases[k] * 2 - 1;
    }
    aEstereo(L, R, i0 + j, lp.run(s / 3) * env * amp, pan);
  }
}

/** Oleada superada: motivo corto de metales sintéticos en Fa, timbal y brillo (1.6 s). */
function hornoFanfarria(sr: number) {
  const n = Math.floor(sr * 1.6);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  bronce(sr, L, R, 0, 523.25, 0.09, 0.5, -0.15);
  bronce(sr, L, R, 0.12, 523.25, 0.09, 0.5, 0.15);
  bronce(sr, L, R, 0.24, 698.46, 0.2, 0.55, 0);
  bronce(sr, L, R, 0.5, 659.26, 0.07, 0.4, 0.1);
  // Acorde final abierto (Fa mayor), cada voz en su lugar del estéreo.
  for (const [f, a, p] of [[174.61, 0.35, 0], [349.23, 0.4, -0.5], [440, 0.38, 0.45], [523.25, 0.36, -0.2], [698.46, 0.42, 0.25]] as const)
    bronce(sr, L, R, 0.6, f, 0.62, a, p);
  const tim = new Float32Array(n);
  golpe(sr, tim, 0, 110, 73, 0.12, 0.6, 700);
  golpe(sr, tim, 0.6, 92, 58, 0.25, 0.9, 700);
  for (let i = 0; i < n; i++) {
    L[i] += tim[i];
    R[i] += tim[i];
  }
  for (let k = 0; k < 10; k++) {
    const i0 = Math.floor(rand(0.62, 1.3) * sr);
    const f = rand(2600, 5200), pan = rand(-0.8, 0.8);
    for (let j = 0; i0 + j < n && j < 0.15 * sr; j++) aEstereo(L, R, i0 + j, Math.sin((TAU * f * j) / sr) * Math.exp(-j / sr / 0.025) * 0.06, pan);
  }
  return normalizaEst([L, R], 0.88);
}

/** Gaviota: dos «kia» cortos y uno largo que cae, nasal y áspero. */
function hornoGaviota(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.15));
  const b1 = new Bq(sr, 'bp', 2100, 2.2);
  const b2 = new Bq(sr, 'bp', 3300, 3);
  const llamadas: [number, number, number, number][] = [[0.02, 0.15, 1650, 1250], [0.23, 0.15, 1720, 1300], [0.5, 0.48, 1550, 880]];
  for (const [t0, dur, fa, fb] of llamadas) {
    const i0 = Math.floor(t0 * sr);
    let ph = 0;
    for (let j = 0; j < dur * sr && i0 + j < a.length; j++) {
      const u = j / (dur * sr);
      const t = j / sr;
      ph += ((fa + (fb - fa) * Math.pow(u, 0.7)) * (1 + 0.02 * ruido())) / sr;
      let s = 0;
      for (let k = 1; k <= 5; k++) s += Math.sin(TAU * k * ph) / Math.pow(k, 0.8);
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.6) * (0.7 + 0.3 * Math.sin(TAU * 45 * t));
      a[i0 + j] += s * env;
    }
  }
  for (let i = 0; i < a.length; i++) a[i] = b1.run(a[i]) * 1.2 + b2.run(a[i]) * 0.6 + a[i] * 0.08;
  return normaliza(a, 0.8);
}

/** Ola: marejada que crece, rompe en espuma y burbujea (estéreo, 3.2 s). */
function hornoOla(sr: number) {
  const n = Math.floor(sr * 3.2);
  const chs = [0, 1].map((c) => {
    const a = new Float32Array(n);
    const lp = new Bq(sr, 'lp', 200, 0.7);
    const hp = new Bq(sr, 'hp', 1400, 0.7);
    const rompe = 1.35 + c * 0.07;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) lp.f(t < rompe ? 160 + 500 * Math.pow(t / rompe, 2) : 300 + 400 * Math.exp(-(t - rompe) / 0.5));
      const crece = t < rompe ? Math.pow(t / rompe, 2) : Math.exp(-(t - rompe) / 0.9);
      const espuma = t < rompe ? Math.pow(t / rompe, 6) * 0.3 : Math.exp(-(t - rompe) / 0.55);
      a[i] = lp.run(ruido()) * crece * 1.6 + hp.run(ruido()) * espuma * 0.55;
    }
    chasquidos(sr, a, rompe, 3.1, (t) => 220 * Math.exp(-(t - rompe) / 0.6), { hp: 2500, amp: 0.25, largo: [0.0006, 0.002] });
    return a;
  });
  return normalizaEst(chs, 0.85);
}

/** Salpicadura: «blup» que cae, chorro de agua desplazada y gotitas. */
function hornoChapuzon(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.1));
  const bp = new Bq(sr, 'bp', 1100, 0.8);
  const lp = new Bq(sr, 'lp', 320, 0.7);
  const hp = new Bq(sr, 'hp', 3000, 0.7);
  let ph = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    ph += (180 + 520 * Math.exp(-t / 0.025)) / sr;
    const blup = Math.sin(TAU * ph) * Math.exp(-t / 0.05) * Math.min(1, t / 0.002) * 0.7;
    const chorro = bp.run(ruido()) * Math.exp(-t / 0.09) * Math.min(1, t / 0.004) * 1.6;
    const masa = lp.run(ruido()) * Math.exp(-t / 0.16) * Math.min(1, t / 0.01) * 1.4;
    const lluvia = hp.run(ruido()) * Math.min(1, t / 0.08) * Math.exp(-t / 0.28) * 0.35;
    a[i] = Math.tanh(blup + chorro + masa) + lluvia;
  }
  for (let k = 0; k < 26; k++) ping(sr, a, 0.07 + Math.pow(Math.random(), 1.5) * 0.8, rand(1500, 4500), rand(0.008, 0.025), rand(0.03, 0.12));
  return normaliza(a, 0.9);
}

/**
 * Bocina del portaaviones de Margarita: «bu-¡BUAAAAMP!» grave (Mi1 + quinta
 * algo desafinada para que bata), con soplido al arrancar, tambaleo y una
 * caída cómica al final. Eco corto del casco.
 */
function hornoBocina(sr: number) {
  const n = Math.floor(sr * 2.2);
  const a = new Float32Array(n);
  const lp = new Bq(sr, 'lp', 750, 0.9);
  const sop = new Bq(sr, 'bp', 420, 1.5);
  const f0 = 82.4;
  let p1 = 0, p2 = 0;
  const tramos: [number, number][] = [[0, 0.09], [0.13, 1.75]];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let env = 0;
    for (const [a0, a1] of tramos) {
      if (t >= a0 && t < a1 + 0.2) {
        const u = t - a0;
        env = Math.max(env, Math.min(1, u / 0.05) * (t < a1 ? 1 : Math.exp(-(t - a1) / 0.06)));
      }
    }
    const subida = 0.88 + 0.12 * (1 - Math.exp(-Math.max(0, t - 0.13) / 0.05));
    const caida = t > 1.45 ? 1 - 0.22 * Math.min(1, (t - 1.45) / 0.35) : 1;
    const bend = (t < 0.13 ? 0.93 : subida * caida) * (1 + 0.012 * Math.sin(TAU * 4.5 * t));
    p1 = (p1 + (f0 * bend) / sr) % 1;
    p2 = (p2 + (f0 * 1.51 * bend) / sr) % 1;
    let s = 0;
    for (let k = 1; k <= 8; k++) s += (Math.sin(TAU * k * p1) + 0.6 * Math.sin(TAU * k * p2)) / k;
    const soplido = sop.run(ruido()) * Math.exp(-Math.max(0, t - 0.13) / 0.06) * (t >= 0.13 ? 0.8 : 0.3);
    a[i] = Math.tanh(lp.run(s) * env * 1.4) + soplido * env;
  }
  const eco = Math.floor(sr * 0.29);
  for (let i = n - 1; i >= eco; i--) a[i] += a[i - eco] * 0.22;
  return normaliza(a, 0.9);
}

/** Caza enemigo: rugido de turbina + siseo de aire + un silbido de compresor (bucle de 1 s). */
function hornoCaza(sr: number) {
  const lp = new Bq(sr, 'lp', 800, 0.7);
  const bp = new Bq(sr, 'bp', 3200, 3.5);
  let fw = 0;
  return bucle(sr, 1, (_i, t) => {
    fw += (2350 + 25 * Math.sin(TAU * 6 * t)) / sr;
    return lp.run(ruido()) * 1.2 + bp.run(ruido()) * 0.9 + Math.sin(TAU * fw) * 0.05;
  });
}

const hornos = new Map<Nombre, AudioBuffer>();
function buf(m: Mezcla, n: Nombre) {
  let b = hornos.get(n);
  if (!b) {
    const sr = m.ctx.sampleRate;
    const d = HORNO[n](sr);
    const chs = Array.isArray(d) ? d : [d];
    b = m.ctx.createBuffer(chs.length, chs[0].length, sr);
    chs.forEach((c, k) => b!.getChannelData(k).set(c));
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
  alarmaFij = d > 460 ? 0 : 0.5 + 0.5 * clamp(1 - (d - 40) / 420, 0, 1);
  actualizaAlarma(m, t);
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
  // Si suena la alarma fuerte, el bip normal da un paso atrás (no compiten).
  const nivel = (0.13 + 0.07 * cerca) * (1 - 0.6 * nivelFuerte);
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
  const k = rand(0.95, 1.05);
  const alto = (C_JUEGO / (C_JUEGO - v * 0.9)) * k;
  const bajo = (C_JUEGO / (C_JUEGO + v * 0.9)) * k;
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

const ambiente = () => 1 - 0.55 * Math.max(duck, alarma * 0.6);

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
  // Es el mismo motor: con la altura también se oye ahogado.
  const vol = n < 0.03 ? 0 : (0.08 + 0.42 * n) * ambiente() * (0.3 + 0.7 * atenMotor);
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
  const vol = i < 0.02 ? 0 : 0.6 * Math.pow(i, 0.8) * ambiente() * (0.5 + 0.5 * Math.sqrt(aire));
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
  const vol = (0.03 + 0.2 * v * v + 0.16 * w) * Math.sqrt(q) * 0.75 * ambiente() * Math.pow(aire, 0.7);
  vientoL = loop(m, vientoL, 'viento', vol, () => {
    const f = m.ctx.createBiquadFilter();
    f.type = 'bandpass';
    return f;
  });
  if (!vientoL || !vientoL.f) return;
  const t = m.ctx.currentTime;
  hacia(vientoL.g.gain, vol, t, 0.12);
  hacia(vientoL.f.frequency, (280 + 650 * v + 1900 * w) * (1 + 1.2 * (1 - aire)), t, 0.1);
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
  // Solo late en peligro real: un daño leve no debe sonar para siempre.
  if (n < 0.25) {
    pulsoProx = 0;
    return;
  }
  if (!pulsoG) {
    pulsoG = ganancia(m, 0);
    pulsoG.connect(m.bus);
    vivos++;
  }
  const periodo = 60 / (68 + 112 * n);
  const vol = (0.06 + 0.3 * n) * (1 - 0.3 * duck);
  if (pulsoProx < t) pulsoProx = t + 0.02;
  // «Pum-pum» como un corazón: el segundo golpe más suave y algo más agudo.
  while (pulsoProx < t + 0.15) {
    const b = pulsoProx;
    // Pequeñas variaciones: ningún golpe suena idéntico al anterior.
    const r = rand(0.97, 1.03);
    latido(m, b, vol * rand(0.92, 1), r);
    latido(m, b + Math.min(0.17, periodo * 0.32) * rand(0.96, 1.04), vol * rand(0.5, 0.6), 1.12 * r);
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
function unaVez(m: Mezcla, n: Nombre, vol: number, rate: number, t: number, pan = 0, tope = LIMITE, destino: AudioNode = m.bus) {
  if (vivos + 3 > tope) return null;
  const src = fuente(m, buf(m, n), false, rate);
  const g = ganancia(m, vol);
  const cadena: AudioNode[] = [g];
  if (pan) {
    const p = panner(m.ctx);
    panea(p, pan, t, 0.001);
    cadena.push(p);
  }
  const v = voz(src, cadena, destino, true);
  src.start(t);
  return { v, g };
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
  // Sin aire no hay onda expansiva: en el espacio solo llega lo que vibra el fuselaje.
  const vol = clamp((0.45 + 0.28 * size) / (1 + d / 320), 0, 1.1) * (1 - 0.75 * pesos.espacio);
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
  lp.frequency.value = Math.max(200, (350 + 17000 * Math.exp(-d / 200)) * (1 - 0.9 * pesos.espacio - 0.3 * pesos.estratosfera));
  lp.Q.value = 0.5;
  const g = ganancia(m, vol);
  const p = panner(m.ctx);
  panea(p, num(pan), t, 0.001);
  // Cerca del avión: repisa de graves (hasta +5 dB bajo 130 Hz), se siente en el pecho.
  const cerca = Math.exp(-d / 140) * aire;
  const cadena: AudioNode[] = [lp, g, p];
  if (cerca > 0.12) {
    const piso = m.ctx.createBiquadFilter();
    piso.type = 'lowshelf';
    piso.frequency.value = 130;
    piso.gain.value = 5 * cerca;
    cadena.unshift(piso);
  }
  const v = voz(src, cadena, m.explo, true);
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

/** Llega un jefe: golpe grave, barrido y campanas de alarma, por encima de todo. */
export function jefeLlega(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  unaVez(m, 'explo-grande', 0.5, 0.5, t, 0, LIMITE + 4);
  unaVez(m, 'whoosh-baja', 0.4, 0.7, t + 0.05, 0, LIMITE + 4);
  unaVez(m, 'campanas', 0.3, 0.75, t + 0.35, 0, LIMITE + 4);
}

/** Jefe vencido: estallido largo y luego campanas de fiesta. */
export function jefeVencido(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  unaVez(m, 'derribo', 0.55, 1.15, t, 0, LIMITE + 4);
  unaVez(m, 'campanas', 0.4, 1.2, t + 1.1, 0, LIMITE + 4);
}

/** Puente terminado: tres martillazos y un rechinido de tablas. */
export function puenteListo(pan: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  for (let i = 0; i < 3; i++) unaVez(m, 'pieza-metal', 0.3, 1.5 + i * 0.1, t + i * 0.14, pan);
  unaVez(m, 'rechinido', 0.2, 1.1, t + 0.45, pan);
}

/** Láser o rayo de la nave nodriza mientras dispara (llamar cada tick; se limita solo). */
let ultimoLaser = -1;
export function laserJefe(pan: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimoLaser < 0.18) return;
  ultimoLaser = t;
  unaVez(m, 'zap', 0.22, rand(0.6, 0.7), t, pan);
}

/* ────────────────────────── combate y eventos ────────────────────────── */

/*
 * Mezcla de estos efectos: lo repetitivo (metralla, tiros enemigos,
 * salpicaduras, cazas) va por el bus de explosiones, que se agacha con las
 * alarmas; lo de una vez (jingles, nitro, bocina) baja con `cede()`. Así el
 * tono de misil siempre queda encima.
 */
const cede = () => 1 - 0.4 * alarma;

type Corta = { v: Voz; g: GainNode };

/** Voz corta con tope propio: si ya hay `max` sonando, la más vieja se corta en ~25 ms. */
function corta(m: Mezcla, lista: Corta[], max: number, n: Nombre, vol: number, rate: number, t: number, pan: number, destino: AudioNode) {
  for (let i = lista.length - 1; i >= 0; i--) if (!lista[i].v.viva) lista.splice(i, 1);
  if (lista.length >= max) {
    const x = lista.shift()!;
    apagar(x.v, x.g, t, 0.004);
  }
  const r = unaVez(m, n, vol, rate, t, clamp(num(pan), -1, 1) || 0, LIMITE + 2, destino);
  if (r) lista.push(r);
}

const balas: Corta[] = [];
let ultimaBala = -1;
let nBala = 0;
/**
 * Un tiro de la metralla del jugador (llamar en cada disparo, cada 60–75 ms).
 * Tres voces como máximo, tono y volumen siempre un poco distintos.
 */
export function metralla(pan: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimaBala < 0.04) return;
  ultimaBala = t;
  nBala++;
  // Leve acento cada tercer tiro: se oye la cadencia del arma, no un zumbido.
  const acento = nBala % 3 === 0 ? 1 : 0.82;
  const vol = 0.27 * acento * rand(0.88, 1) * (0.5 + 0.5 * aire);
  corta(m, balas, 3, Math.random() < 0.5 ? 'tk' : 'tk2', vol, rand(0.92, 1.08), t, pan, m.explo);
}

const balasEnemigas: Corta[] = [];
let ultimaBalaEnemiga = -1;
/**
 * Ráfaga de un caza enemigo o del antiaéreo del portaaviones: sorda y
 * lejana. `disparos` (1–4) tiros seguidos por llamada; se limita solo a uno
 * cada 50 ms y a tres voces.
 */
export function metrallaEnemiga(pan: number, distancia: number, disparos = 1): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimaBalaEnemiga < 0.05) return;
  ultimaBalaEnemiga = t;
  const d = Math.max(0, num(distancia, 300));
  const vol = (0.24 / (1 + d / 300)) * (0.4 + 0.6 * aire);
  if (vol < 0.015) return;
  const t0 = t + Math.min(0.2, d / 1800);
  const k = clamp(Math.round(num(disparos, 1)), 1, 4);
  for (let i = 0; i < k; i++) corta(m, balasEnemigas, 3, 'tk-sordo', vol * rand(0.8, 1), rand(0.88, 1.05), t0 + i * rand(0.05, 0.065), pan, m.explo);
}

let ultimaRecalentada = -1;
/** La metralla se recalentó: clonc + siseo (una vez por recalentón; se limita a 0.6 s). */
export function recalentada(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimaRecalentada < 0.6) return;
  ultimaRecalentada = t;
  unaVez(m, 'siseo', 0.42 * cede(), rand(0.95, 1.05), t, 0, LIMITE + 4);
}

let nitroV: Corta | null = null;
let ultimoNitro = -10;
let ultimoNitroFin = -10;
/** Súper nitro encendido: fogonazo + 2.5 s de rugido que sube. */
export function nitro(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimoNitro < 0.5) return;
  ultimoNitro = t;
  if (nitroV) apagar(nitroV.v, nitroV.g, t, 0.03);
  nitroV = unaVez(m, 'nitro', 0.28 * cede(), 1, t, 0, LIMITE + 6);
}

/** Se acaba el nitro (o se corta antes): apaga el rugido y suelta la cola. */
export function nitroFin(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (nitroV) apagar(nitroV.v, nitroV.g, t, 0.05);
  nitroV = null;
  if (t - ultimoNitroFin < 0.5) return;
  ultimoNitroFin = t;
  unaVez(m, 'nitro-fin', 0.38 * cede(), rand(0.95, 1.05), t, 0, LIMITE + 4);
}

/* Tono de fijación propio (el jugador fija a un enemigo): más agudo, más
 * puro y más bajo que las alarmas de misil, para no confundirlos. */
type Mira = { v: Voz; osc: OscillatorNode; g: GainNode; prox: number; visto: number; solido: number };
let mira: Mira | null = null;

function miraViva(m: Mezcla, t: number): Mira {
  if (mira) return mira;
  const osc = m.ctx.createOscillator();
  osc.setPeriodicWave(m.ctx.createPeriodicWave(new Float32Array(3), new Float32Array([0, 1, 0.18])));
  osc.frequency.value = 1500;
  const g = ganancia(m, 0);
  const v = voz(osc, [g], m.bus, false);
  osc.start(t);
  mira = { v, osc, g, prox: 0, visto: t, solido: 0 };
  return mira;
}

/** Libera el tono de fijación tras 2 s sin uso. */
function mantenerMira(t: number) {
  if (mira && t - mira.visto > 2 && t > mira.solido + 0.5) {
    apagar(mira.v, mira.g, t);
    mira = null;
  }
}

/**
 * Fijando blanco: llamar cada cuadro con k 0…1 mientras se fija. Bips que
 * se aceleran (de ~3 a ~14 por segundo) y suben de tono. Al dejar de
 * llamarla se calla sola en ≤ 0.1 s.
 */
export function fijando(k: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const kk = clamp(num(k), 0, 1);
  const f = miraViva(m, t);
  f.visto = t;
  if (t < f.solido) return; // el tono sólido manda
  const intervalo = 0.3 - 0.23 * Math.pow(kk, 1.2);
  const largo = Math.min(0.05, intervalo * 0.45);
  const vol = (0.05 + 0.035 * kk) * (1 - 0.5 * alarma);
  hacia(f.osc.frequency, 1500 + 400 * kk, t, 0.02);
  if (f.prox < t) f.prox = t + 0.005;
  while (f.prox < t + 0.1) {
    const b = f.prox;
    f.g.gain.setValueAtTime(0, b);
    f.g.gain.linearRampToValueAtTime(vol, b + 0.004);
    f.g.gain.setValueAtTime(vol, b + largo - 0.005);
    f.g.gain.linearRampToValueAtTime(0, b + largo);
    f.prox += intervalo;
  }
}

/** Blanco fijado: tono sólido de ~0.5 s (una vez, en el momento de fijar). */
export function fijado(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const f = miraViva(m, t);
  if (t < f.solido - 0.3) return;
  const vol = 0.1 * (1 - 0.4 * alarma);
  sujeta(f.g.gain, t);
  f.g.gain.setTargetAtTime(0, t, 0.003);
  sujeta(f.osc.frequency, t);
  f.osc.frequency.setValueAtTime(1900, t + 0.012);
  f.g.gain.setValueAtTime(0, t + 0.012);
  f.g.gain.linearRampToValueAtTime(vol, t + 0.02);
  f.g.gain.setValueAtTime(vol, t + 0.5);
  f.g.gain.linearRampToValueAtTime(0, t + 0.54);
  f.solido = t + 0.56;
  f.prox = t + 0.6;
  f.visto = t;
}

let ultimaMejora = -1;
/** Recoge una mejora especial: jingle brillante de ~1 s. */
export function mejora(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimaMejora < 0.3) return;
  ultimaMejora = t;
  unaVez(m, 'mejora', 0.36 * cede(), rand(0.99, 1.01), t, 0, LIMITE + 4);
}

let ultimaFanfarria = -10;
/** Oleada superada: fanfarria sintética de 1.6 s. */
export function oleadaSuperada(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimaFanfarria < 1.5) return;
  ultimaFanfarria = t;
  unaVez(m, 'fanfarria', 0.42 * cede(), 1, t, 0, LIMITE + 6);
}

let ultimoRumbo = -10;
/** Cambio de mapa hacia el mar: whoosh, marejada que rompe y gaviotas. */
export function rumboAlMar(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimoRumbo < 3) return;
  ultimoRumbo = t;
  unaVez(m, 'whoosh', 0.3, 0.85, t, 0, LIMITE + 6);
  unaVez(m, 'ola', 0.34, 1, t + 0.5, 0, LIMITE + 6);
  unaVez(m, 'gaviota', 0.16, rand(0.97, 1.03), t + 1.3, 0.55, LIMITE + 6);
  unaVez(m, 'gaviota', 0.11, rand(1.1, 1.18), t + 2.1, -0.5, LIMITE + 6);
}

const chapuzones: Corta[] = [];
let ultimoChapuzon = -1;
/** Algo cae al agua (llamar en cada impacto en el mar; se limita a uno cada 50 ms y 3 voces). tamano ~0.3–4. */
export function salpicadura(pan: number, tamano: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimoChapuzon < 0.05) return;
  ultimoChapuzon = t;
  const s = clamp(num(tamano, 1), 0.2, 4);
  const vol = Math.min(0.55, 0.16 + 0.11 * s);
  corta(m, chapuzones, 3, 'chapuzon', vol, clamp(1.3 - 0.17 * s, 0.6, 1.3) * rand(0.94, 1.06), t, pan, m.explo);
}

let ultimaBocina = -10;
/** Bocina grave y cómica del portaaviones de Margarita (se limita a una cada 1.8 s). */
export function bocina(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimaBocina < 1.8) return;
  ultimaBocina = t;
  unaVez(m, 'bocina', 0.22 * cede(), rand(0.98, 1.02), t, 0, LIMITE + 6);
}

let ultimaCaza = -1;
const cazasCerca = new Map<number, number>(); // id → última vez visto dentro del radio
/**
 * Un caza enemigo pasa cerca (dx, dy relativos al jugador; velocidad
 * relativa en px/s): rugido con doppler que cruza el estéreo. Se puede
 * llamar cada tick. Con `id` (recomendado), una vez por pasada al entrar a
 * < 180 px (se rearma al alejarse a > 320 px); sin id, a < 260 px y como
 * mucho una cada 0.9 s.
 */
export function pasadaCaza(dx: number, dy: number, velocidad: number, id?: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const r = Math.hypot(num(dx), num(dy));
  if (id !== undefined) {
    for (const [k, v] of cazasCerca) if (t - v > 3) cazasCerca.delete(k);
    if (r > 320) {
      cazasCerca.delete(id);
      return;
    }
    if (r > 180) return; // espera a que esté encima: el pico del «fiuum» cae cerca
    const ya = cazasCerca.has(id);
    cazasCerca.set(id, t);
    if (ya || t - ultimaCaza < 0.3) return;
  } else if (r > 260 || t - ultimaCaza < 0.9) return;
  if (vivos + 3 > LIMITE) return;
  ultimaCaza = t;
  const v = clamp(num(velocidad, 200), 60, 420);
  const src = fuente(m, buf(m, 'caza'), true);
  const g = ganancia(m, 0);
  const p = panner(m.ctx);
  voz(src, [g, p], m.explo, true);
  const k = rand(0.94, 1.06);
  const alto = clamp((C_JUEGO / (C_JUEGO - v * 0.8)) * k, 0.6, 2.2);
  const bajo = clamp((C_JUEGO / (C_JUEGO + v * 0.8)) * k, 0.4, 1);
  src.playbackRate.setValueAtTime(alto, t);
  src.playbackRate.setTargetAtTime(bajo, t + 0.18, 0.15);
  const pico = 0.42 * clamp(1 - r / 260, 0.45, 1) * (0.35 + 0.65 * aire);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(pico, t + 0.18);
  g.gain.setTargetAtTime(0, t + 0.22, 0.2);
  const lado = clamp(num(dx) / 40, -1, 1);
  if ('pan' in p) {
    p.pan.setValueAtTime(lado * 0.75, t);
    p.pan.linearRampToValueAtTime(-lado * 0.65, t + 0.7);
  }
  src.start(t, Math.random());
  src.stop(t + 1.4);
}

/* ────────────────────────── altitud y ambiente ────────────────────────── */

export type Zona = 'campo' | 'nubes' | 'estratosfera' | 'espacio';
const ZONAS: Zona[] = ['campo', 'nubes', 'estratosfera', 'espacio'];
const suave = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

const capas: Record<Zona, { nombre: Nombre; l: Loop | null }> = {
  campo: { nombre: 'brisa', l: null },
  nubes: { nombre: 'nubes', l: null },
  estratosfera: { nombre: 'estrato', l: null },
  espacio: { nombre: 'espacio', l: null },
};
let pesos: Record<Zona, number> = { campo: 1, nubes: 0, estratosfera: 0, espacio: 0 };
let aire = 1; // densidad relativa: 1 a ras de suelo, ~0 en el espacio
let atenMotor = 1;
let alarma = 0; // 0…1: hay una fijación sonando (agacha explosiones y ambiente)
let alarmaFij = 0;
let ultimaEstrella = -1;

/**
 * Cama de ambiente según la altitud (llamar ~cada 80 ms). Las cuatro zonas se
 * funden en franjas de 160 px alrededor de 500, 1300 y 1900.
 */
export function altitud(alt: number, velocidad: number): void {
  const a = clamp(num(alt), 0, 5000);
  const v = clamp(num(velocidad) / 230, 0, 1.4);
  const s1 = suave(420, 580, a), s2 = suave(1220, 1380, a), s3 = suave(1820, 1980, a);
  pesos = { campo: 1 - s1, nubes: s1 * (1 - s2), estratosfera: s2 * (1 - s3), espacio: s3 };
  aire = Math.pow(clamp(1 - a / 2000, 0, 1), 1.2);
  const objetivo = 1 - 0.03 * pesos.nubes - 0.15 * pesos.estratosfera - 0.65 * pesos.espacio;
  atenMotor += (objetivo - atenMotor) * 0.15; // ~0.5 s de constante con llamadas cada 80 ms
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const amb = 1 - 0.6 * Math.max(duck, alarma * 0.7);
  const base: Record<Zona, number> = {
    campo: 0.11 + 0.03 * v,
    nubes: 0.12 + 0.08 * v,
    estratosfera: 0.1 + 0.02 * v,
    espacio: 0.065,
  };
  for (const z of ZONAS) {
    const c = capas[z];
    // Raíz del peso: cruce de potencia constante (sin bache a mitad del fundido).
    const vol = pesos[z] < 0.01 ? 0 : base[z] * Math.sqrt(pesos[z]) * (z === 'espacio' ? Math.sqrt(amb) : amb);
    c.l = loop(m, c.l, c.nombre, vol);
    if (!c.l || vol === 0) continue;
    hacia(c.l.g.gain, vol, t, 0.5);
    if (z === 'nubes') hacia(c.l.src.playbackRate, 0.9 + 0.18 * v, t, 0.4);
  }
  // Adornos sueltos, siempre con tono, volumen y paneo al azar.
  const tranquilo = duck < 0.15 && alarma < 0.1;
  if (pesos.campo > 0.6 && tranquilo && Math.random() < 0.012)
    unaVez(m, Math.random() < 0.6 ? 'pajaro' : 'pajaro2', rand(0.025, 0.05) * pesos.campo, rand(0.85, 1.2), t, rand(-0.8, 0.8), LIMITE_AMB);
  if (pesos.estratosfera > 0.5 && Math.random() < 0.018)
    unaVez(m, 'hielo', rand(0.06, 0.13) * amb, rand(0.8, 1.25), t, rand(-0.6, 0.6), LIMITE_AMB);
  if (pesos.espacio > 0.5 && Math.random() < 0.03) {
    // Notas del acorde del pad (pentatónica): titileo consonante, nunca la misma dos veces.
    const RAZONES = [0.5, 0.5625, 0.625, 0.75, 0.8333, 1, 1.125];
    let k = Math.floor(Math.random() * RAZONES.length);
    if (k === ultimaEstrella) k = (k + 1 + Math.floor(Math.random() * (RAZONES.length - 1))) % RAZONES.length;
    ultimaEstrella = k;
    unaVez(m, 'estrella', rand(0.025, 0.055), RAZONES[k] * rand(0.997, 1.003), t, rand(-0.9, 0.9), LIMITE_AMB);
  }
  mantenerOvnis(m, t);
  mantenerMira(t);
}

/** Factor 0..1 para el bucle del motor grabado: en el espacio se oye ahogado (~0.35). */
/** Densidad del aire que oye el piloto (1 en el suelo, ~0 en el espacio). */
export function aireActual(): number {
  return aire;
}

export function atenuacionMotor(): number {
  return clamp(atenMotor, 0, 1);
}

let ultimaZona: Zona | null = null;
let ultimoStinger = -10;

/** Stinger de ~2 s al cruzar a una zona nueva (ignora repeticiones y titubeos en el borde). */
export function zonaNueva(zona: Zona): void {
  if (!ZONAS.includes(zona) || zona === ultimaZona) return;
  const antes = ultimaZona;
  ultimaZona = zona;
  const m = salida();
  if (!m || antes === null) return; // la zona inicial no suena
  const t = m.ctx.currentTime;
  if (t - ultimoStinger < 1.5) return;
  ultimoStinger = t;
  const sube = ZONAS.indexOf(zona) > ZONAS.indexOf(antes);
  const k = rand(0.96, 1.04);
  if (zona === 'espacio' && sube) {
    unaVez(m, 'campanas', 0.34, k, t, 0, LIMITE + 4);
  } else if (sube) {
    unaVez(m, 'whoosh', 0.3, (zona === 'estratosfera' ? 1.12 : 0.95) * k, t, 0, LIMITE + 4);
  } else {
    unaVez(m, 'whoosh-baja', 0.26, (zona === 'campo' ? 0.8 : 0.92) * k, t, 0, LIMITE + 4);
  }
}

/* ────────────────────────── ovnis ────────────────────────── */

type VozOvni = { id: number; v: Voz; src: AudioBufferSourceNode; g: GainNode; p: Pan; r: number; tr: number; vr: number; visto: number; base: number; dx: number; libre: number };
const ovnis: VozOvni[] = [];
const MAX_OVNIS = 2;

/** Zumbido/theremín de un platillo (llamar cada tick por ovni; activo=false lo apaga). */
export function ovni(dx: number, dy: number, activo: boolean, id: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const x = num(dx), y = num(dy);
  const r = Math.hypot(x, y);
  let o = ovnis.find((q) => q.id === id);
  if (!activo || r > 900) {
    if (o && o.libre < 0) {
      o.libre = t;
      hacia(o.g.gain, 0, t, 0.15);
    }
    return;
  }
  if (!o) {
    if (ovnis.length >= MAX_OVNIS) {
      // Cede la voz que ya se apaga o, si no, la del platillo más lejano.
      const peor = ovnis.slice().sort((p, q) => (q.libre >= 0 ? 1e9 : q.r) - (p.libre >= 0 ? 1e9 : p.r))[0];
      if (peor.libre < 0 && peor.r <= r) return;
      apagar(peor.v, peor.g, t, 0.03);
      ovnis.splice(ovnis.indexOf(peor), 1);
    }
    const src = fuente(m, buf(m, 'ovni'), true);
    const g = ganancia(m, 0);
    const p = panner(m.ctx);
    const v = voz(src, [g, p], m.bus, false);
    // Cada platillo con su propio tono: dos a la vez no suenan al unísono.
    const base = (ovnis.some((q) => q.base > 0.92) ? 0.82 : 1) * rand(0.96, 1.04);
    src.playbackRate.value = base;
    src.start(t, rand(0, 4));
    o = { id, v, src, g, p, r, tr: t, vr: 0, visto: t, base, dx: x, libre: -1 };
    ovnis.push(o);
  }
  o.libre = -1;
  const dt = t - o.tr;
  if (dt > 0.02) {
    o.vr += (clamp((r - o.r) / dt, -600, 600) - o.vr) * 0.5;
    o.r = r;
    o.tr = t;
  }
  o.visto = t;
  o.dx = x;
  const dop = clamp(C_JUEGO / (C_JUEGO + o.vr), 0.6, 1.7);
  hacia(o.src.playbackRate, o.base * dop, t, 0.08);
  const prox = clamp(1 - r / 800, 0, 1);
  hacia(o.g.gain, (0.03 + 0.3 * prox * prox) * (1 - 0.35 * Math.max(duck, alarma)), t, 0.1);
  panea(o.p, (x / 320) * 0.9, t, 0.08);
}

/** Platillos que el juego dejó de reportar: se apagan solos. */
function mantenerOvnis(m: Mezcla, t: number) {
  void m;
  for (let i = ovnis.length - 1; i >= 0; i--) {
    const o = ovnis[i];
    if (o.libre < 0 && t - o.visto > 0.4) {
      o.libre = t;
      hacia(o.g.gain, 0, t, 0.15);
    } else if (o.libre >= 0 && t - o.libre > 1) {
      apagar(o.v, o.g, t);
      ovnis.splice(i, 1);
    }
  }
}

let ultimoRayo = -1;
/** Rayo láser de un ovni: sale del lado del platillo más cercano. */
export function rayoOvni(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimoRayo < 0.08) return;
  ultimoRayo = t;
  mantenerOvnis(m, t);
  const cerca = ovnis.filter((o) => o.libre < 0).sort((p, q) => p.r - q.r)[0];
  const pan = cerca ? clamp(cerca.dx / 320, -1, 1) * 0.8 : rand(-0.2, 0.2);
  const vol = cerca ? 0.28 + 0.24 * clamp(1 - cerca.r / 700, 0, 1) : 0.38;
  unaVez(m, 'zap', vol, rand(0.9, 1.1), t, pan || 0.001, LIMITE + 4);
}

/* ────────────────────────── fijación fuerte ────────────────────────── */

type Fuerte = { v: Voz; osc: OscillatorNode; g: GainNode; prox: number; paso: number; quieto: number; inicio: number; activo: boolean };
let fuerte: Fuerte | null = null;
let nivelFuerte = 0;

function actualizaAlarma(m: Mezcla, t: number) {
  alarma = Math.max(alarmaFij, nivelFuerte > 0 ? 0.7 + 0.3 * nivelFuerte : 0);
  hacia(m.explo.gain, 1 - 0.45 * alarma, t, 0.08);
}

/**
 * Alarma de amenaza difícil (misil de largo alcance o varios fijados):
 * «di-da-di-da ·» de dos tonos, más agudo y rápido con el nivel (llamar cada
 * tick; 0 la apaga). Pierde un poco de volumen si dura mucho, para no cansar.
 */
export function fijacionFuerte(nivel: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const n = clamp(num(nivel), 0, 1);
  if (n < 0.05) {
    nivelFuerte = 0;
    if (fuerte) {
      if (fuerte.activo) {
        sujeta(fuerte.g.gain, t);
        fuerte.g.gain.setTargetAtTime(0, t, 0.015);
        fuerte.activo = false;
        fuerte.quieto = t;
      } else if (t - fuerte.quieto > 2) {
        apagar(fuerte.v, fuerte.g, t);
        fuerte = null;
      }
    }
    actualizaAlarma(m, t);
    return;
  }
  nivelFuerte = n;
  if (!fuerte) {
    const osc = m.ctx.createOscillator();
    // Casi cuadrada pero con pocos armónicos y paso bajo: urgente sin chillar.
    osc.setPeriodicWave(m.ctx.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0, 0.22, 0, 0.08])));
    const lp = m.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.Q.value = 0.5;
    const g = ganancia(m, 0);
    const v = voz(osc, [lp, g], m.bus, false);
    osc.start(t);
    fuerte = { v, osc, g, prox: t + 0.01, paso: 0, quieto: t, inicio: t, activo: false };
  }
  const f = fuerte;
  if (!f.activo) {
    f.activo = true;
    f.inicio = t;
    f.paso = 0;
    f.prox = t + 0.01;
  }
  const intervalo = 0.15 - 0.075 * n;
  const lo = 640 + 220 * n;
  const hi = lo * 1.26;
  const fatiga = 1 - 0.3 * clamp((t - f.inicio - 5) / 8, 0, 1);
  const vol = (0.1 + 0.07 * n) * fatiga;
  if (f.prox < t) f.prox = t + 0.01;
  while (f.prox < t + 0.14) {
    const b = f.prox;
    const k = f.paso % 5; // cuatro notas y un silencio: ritmo, no un muro
    if (k < 4) {
      const largo = intervalo * 0.78;
      f.osc.frequency.setValueAtTime(k % 2 === 0 ? hi : lo, b);
      f.g.gain.setValueAtTime(0, b);
      f.g.gain.linearRampToValueAtTime(vol, b + 0.004);
      f.g.gain.setValueAtTime(vol, b + largo - 0.005);
      f.g.gain.linearRampToValueAtTime(0, b + largo);
    }
    f.paso++;
    f.prox += intervalo;
  }
  actualizaAlarma(m, t);
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
  for (const z of ZONAS) {
    const c = capas[z];
    if (c.l) apagar(c.l.v, c.l.g, t, tc * 3);
    c.l = null;
  }
  for (const o of ovnis) apagar(o.v, o.g, t, tc);
  ovnis.length = 0;
  if (fuerte) apagar(fuerte.v, fuerte.g, t, tc);
  fuerte = null;
  nivelFuerte = alarma = alarmaFij = 0;
  if (mira) apagar(mira.v, mira.g, t, tc);
  mira = null;
  if (nitroV) apagar(nitroV.v, nitroV.g, t, tc);
  nitroV = null;
  if (mz) {
    sujeta(mz.explo.gain, t);
    mz.explo.gain.setTargetAtTime(1, t, 0.05);
  }
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
  for (const z of ZONAS) {
    const c = capas[z];
    if (c.l) liberar(c.l.v);
    c.l = null;
  }
  for (const o of ovnis) liberar(o.v);
  ovnis.length = 0;
  if (fuerte) liberar(fuerte.v);
  fuerte = null;
  nivelFuerte = alarma = alarmaFij = 0;
  if (mira) liberar(mira.v);
  mira = null;
  nitroV = null;
  balas.length = balasEnemigas.length = chapuzones.length = 0;
  cazasCerca.clear();
  pulsoG?.disconnect();
  pulsoG = null;
  if (mz) {
    mz.bus.disconnect();
    mz.tibio.disconnect();
    mz.comp.disconnect();
    mz.explo.disconnect();
    for (const n of mz.ancho) n.disconnect();
  }
  mz = null;
  vivos = 0;
  hornos.clear();
  duck = 0;
  ultimoStinger = -10;
  ultimaPasada = ultimoRayo = ultimoLaser = -1;
  ultimaBala = ultimaBalaEnemiga = ultimaRecalentada = ultimaMejora = ultimoChapuzon = ultimaCaza = -1;
  ultimoNitro = ultimoNitroFin = ultimaFanfarria = ultimoRumbo = ultimaBocina = -10;
}

/** Solo para pruebas (render offline): usa este contexto y destino en vez del del sitio. */
export function __usarContexto(ctx: BaseAudioContext | null, dest?: AudioNode) {
  inyectado = ctx ? { ctx, dest: dest ?? ctx.destination } : null;
}
/** Solo para pruebas: nodos vivos creados por este módulo. */
export const __nodosVivos = () => vivos;
