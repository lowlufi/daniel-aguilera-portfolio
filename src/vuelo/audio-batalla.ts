import { juegoCallado, sampleOut } from '../game/audio';

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

function salida(ui = false): Mezcla | null {
  // The self-playing game behind the title menu stays silent (menus/UI don't).
  if (!ui && juegoCallado()) return null;
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

/** Quita la continua (paso alto de ~4 Hz): saturar con tanh asimétrico la deja. */
function sinContinua(a: Float32Array) {
  let x1 = 0, y1 = 0;
  for (let i = 0; i < a.length; i++) {
    const y = a[i] - x1 + 0.9995 * y1;
    x1 = a[i];
    y1 = y;
    a[i] = y;
  }
  return a;
}

function normaliza(a: Float32Array, pico: number) {
  sinContinua(a);
  // Entrada en 0.7 ms: conserva el golpe pero sin escalón en la primera muestra.
  for (let i = 0; i < 32 && i < a.length; i++) a[i] *= i / 32;
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
  sinContinua(a);
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
  // Deriva irregular del tono (no un vibrato periódico) y golpes con ±12 % de
  // desfase: con un vibrato regular de 7 Hz y estas resonancias de 1–2 kHz,
  // el rechinido a 250–420 Hz sonaba a balido de oveja.
  let deriva = 0, meta = 0;
  for (let k = 0; k < n; k++) {
    const u = k / n;
    if ((k & 511) === 0) meta = ruido();
    deriva += (meta - deriva) * 0.0015;
    const f = (f0 + (f1 - f0) * u) * (1 + 0.05 * deriva + 0.03 * ruido());
    fase += f / sr;
    let imp = 0;
    if (fase >= 1) {
      fase -= 1 + rand(-0.12, 0.12);
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
  | 'gaviota' | 'ola' | 'chapuzon' | 'bocina' | 'caza'
  | 'nuclear' | 'trueno-cerca' | 'trueno-lejos' | 'chispa' | 'lluvia' | 'escarcha' | 'hielo-alerta' | 'congelado' | 'deshielo'
  | 'mision' | 'uf' | 'vida' | 'nuke-recoge' | 'bumeran' | 'pista' | 'oleada'
  | 'rifle' | 'browning' | 'gau8' | 'lz-aam' | 'lz-amraam' | 'lz-cohete' | 'lz-tinytim' | 'lz-maverick'
  | 'vulcan' | 'canon30' | 'laser' | 'orbe' | 'crucero' | 'fosforo' | 'gas' | 'plasma-bomba' | 'chaff' | 'holograma' | 'trampa'
  | 'hangar-sel' | 'hangar-bloq' | 'desbloqueo'
  | 'zepelin-motor' | 'zepelin-sirena' | 'zepelin-cruje' | 'zepelin-cruje2' | 'zepelin-flak' | 'zepelin-cae'
  | 'sin-municion' | 'recargada' | 'nitro-no' | 'nitro-listo' | 'bengala-vacia' | 'radio' | 'eyeccion' | 'paracaidas'
  | 'sirena-picada' | 'silbo-picada' | 'rugido-picada' | 'estampido'
  | 'bocina-perdida' | 'tono-terreno' | 'master-caution' | 'aviso-lanza';

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
  nuclear: hornoNuclear,
  'trueno-cerca': (sr) => hornoTrueno(sr, true),
  'trueno-lejos': (sr) => hornoTrueno(sr, false),
  chispa: hornoChispa,
  lluvia: hornoLluvia,
  escarcha: hornoEscarcha,
  'bocina-perdida': hornoBocinaPerdida,
  'aviso-lanza': hornoAvisoLanza,
  'tono-terreno': hornoTerreno,
  'master-caution': hornoMaster,
  'sirena-picada': hornoSirena,
  'silbo-picada': hornoSilbo,
  'rugido-picada': hornoRugido,
  estampido: hornoEstampido,
  'hielo-alerta': hornoHieloAlerta,
  congelado: hornoCongelado,
  deshielo: hornoDeshielo,
  mision: hornoMision,
  uf: hornoUf,
  vida: hornoVida,
  'nuke-recoge': hornoNukeRecoge,
  bumeran: hornoBumeran,
  pista: hornoPista,
  oleada: hornoOleada,
  vulcan: hornoVulcan,
  canon30: hornoCanon30,
  rifle: hornoRifle,
  browning: hornoBrowning,
  gau8: hornoGau8,
  'lz-aam': hornoLanzaAam,
  'lz-amraam': hornoLanzaAmraam,
  'lz-cohete': hornoLanzaCohete,
  'lz-tinytim': hornoLanzaTinyTim,
  'lz-maverick': hornoLanzaMaverick,
  laser: hornoLaser,
  orbe: hornoOrbe,
  crucero: hornoCrucero,
  fosforo: hornoFosforo,
  gas: hornoGas,
  'plasma-bomba': hornoPlasmaBomba,
  chaff: hornoChaff,
  holograma: hornoHolograma,
  trampa: hornoTrampa,
  'hangar-sel': hornoHangarSel,
  'hangar-bloq': hornoHangarBloq,
  desbloqueo: hornoDesbloqueo,
  'zepelin-motor': hornoZepelinMotor,
  'zepelin-sirena': hornoZepelinSirena,
  'zepelin-cruje': (sr) => hornoZepelinCruje(sr, false),
  'zepelin-cruje2': (sr) => hornoZepelinCruje(sr, true),
  'zepelin-flak': hornoZepelinFlak,
  'zepelin-cae': hornoZepelinCae,
  'sin-municion': hornoSinMunicion,
  recargada: hornoRecargada,
  'nitro-no': hornoNitroNo,
  'nitro-listo': hornoNitroListo,
  'bengala-vacia': hornoBengalaVacia,
  radio: hornoRadio,
  eyeccion: hornoEyeccion,
  paracaidas: hornoParacaidas,
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
  for (const a of chs) sinContinua(a);
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
  // Agudas, cortas y sin trémolo: la versión anterior (llamada larga que caía
  // a 880 Hz con trémolo de 45 Hz y formante nasal en 2.1 kHz) sonaba a oveja.
  const b1 = new Bq(sr, 'bp', 3000, 1.4);
  const b2 = new Bq(sr, 'bp', 4200, 2);
  const llamadas: [number, number, number, number][] = [[0.02, 0.11, 2300, 1900], [0.2, 0.11, 2400, 1950], [0.42, 0.26, 2250, 1650]];
  for (const [t0, dur, fa, fb] of llamadas) {
    const i0 = Math.floor(t0 * sr);
    let ph = 0;
    for (let j = 0; j < dur * sr && i0 + j < a.length; j++) {
      const u = j / (dur * sr);
      const t = j / sr;
      ph += ((fa + (fb - fa) * Math.pow(u, 0.7)) * (1 + 0.02 * ruido())) / sr;
      let s = 0;
      for (let k = 1; k <= 3; k++) s += Math.sin(TAU * k * ph) / (k * k);
      void t;
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.6);
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


/* ── hornos nuevos: nuclear, tormenta, hielo y avisos ── */

/**
 * Bomba nuclear (7.5 s, estéreo): destello seco, golpe sub que cae de 55 a
 * 22 Hz, la onda de choque que crece hasta ~1 s y rueda, aullido de viento
 * que barre y lluvia de escombros. Los graves son mono (iguales en ambos
 * canales); el ruido es distinto en cada lado, así suena enorme y ancho.
 */
function hornoNuclear(sr: number) {
  const n = Math.floor(sr * 7.5);
  let fs = 0;
  const sub = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    fs += (22 + 33 * Math.exp(-t / 0.5)) / sr;
    sub[i] = Math.tanh(Math.sin(TAU * fs) * 1.8 * Math.exp(-t / 2.4) * Math.min(1, t / 0.01)) * 0.85;
  }
  const chs = [0, 1].map((c) => {
    const a = new Float32Array(n);
    const hp = new Bq(sr, 'hp', 1500, 0.7);
    const cuerpo = new Bq(sr, 'lp', 5000, 0.8);
    const onda = new Bq(sr, 'lp', 260, 0.7);
    const aullido = new Bq(sr, 'bp', 500, 3);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) {
        cuerpo.f(110 + 5000 * Math.exp(-t / 0.18));
        onda.f(170 + 480 * Math.exp(-Math.max(0, t - 1) / 1.4));
        aullido.f(380 + 520 * Math.sin(Math.PI * Math.min(1, t / 6)) + 60 * Math.sin(TAU * 0.4 * t + c));
      }
      const flash = t < 0.08 ? Math.tanh(hp.run(ruido()) * 4 * Math.exp(-t / 0.012)) : 0;
      const c1 = cuerpo.run(ruido()) * Math.exp(-t / 0.45) * Math.min(1, t / 0.004) * 2.4;
      // Onda de choque: llega a los 0.35 s, cresta a ~1 s, rueda con ondulaciones lentas.
      const ola = t < 0.35 ? 0 : Math.pow(Math.min(1, (t - 0.35) / 0.65), 2) * Math.exp(-Math.max(0, t - 1) / 1.9);
      const rueda = 0.65 + 0.35 * Math.sin(TAU * 1.3 * t + c * 1.7) * Math.sin(TAU * 0.45 * t);
      const o = onda.run(ruido()) * ola * rueda * 3.2;
      const w = aullido.run(ruido()) * Math.min(1, Math.max(0, t - 0.8) / 1.2) * Math.exp(-Math.max(0, t - 2.5) / 2) * 0.9;
      a[i] = Math.tanh(flash * 0.9 + c1 + o) * 0.8 + sub[i] + w * 0.5;
    }
    chasquidos(sr, a, 0.4, 6.5, (t) => 90 * Math.exp(-t / 1.6), { hp: 1600, amp: 0.25, largo: [0.002, 0.012] });
    for (let k = 0; k < 14; k++) golpe(sr, a, rand(0.9, 5), rand(90, 140), 40, rand(0.08, 0.2), rand(0.08, 0.22), 700);
    return a;
  });
  return normalizaEst(chs, 0.95);
}

/**
 * Trueno (estéreo). Cerca: el rasgón eléctrico (ráfagas brillantes en 120 ms),
 * un golpe grave y el rodar de 4–6 retumbos que se apagan. Lejos: solo el
 * rodar, sordo y con entrada lenta.
 */
function hornoTrueno(sr: number, cerca: boolean) {
  const n = Math.floor(sr * (cerca ? 5 : 5.5));
  const rollos: [number, number, number][] = [];
  let t0 = cerca ? 0.12 : 0.05;
  const nr = cerca ? 6 : 4;
  for (let k = 0; k < nr; k++) {
    rollos.push([t0, (cerca ? 1 : 0.8) * Math.pow(0.78, k) * rand(0.7, 1), rand(0.25, 0.55) * (cerca ? 1 : 1.4)]);
    t0 += rand(0.35, 0.8);
  }
  const chs = [0, 1].map((c) => {
    const a = new Float32Array(n);
    const lp = new Bq(sr, 'lp', cerca ? 380 : 210, 0.7);
    const medio = new Bq(sr, 'bp', 900, 0.8);
    const hp = new Bq(sr, 'hp', 2400, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let env = 0;
      for (const [r0, amp, tau] of rollos) {
        const u = t - r0 - c * 0.012;
        if (u > 0) env += amp * Math.min(1, u / (cerca ? 0.05 : 0.18)) * Math.exp(-u / tau);
      }
      const cola = Math.exp(-t / (cerca ? 1.8 : 2.2));
      let y = lp.run(ruido()) * env * 2.6 * (0.6 + 0.4 * cola) + medio.run(ruido()) * env * (cerca ? 0.35 : 0.08);
      if (cerca && t < 0.16) {
        // Rasgón: ráfagas de 2–6 ms, muy seguidas, que se apagan.
        const tren = Math.sin(TAU * (70 + 40 * Math.sin(TAU * 11 * t)) * t) > 0.3 ? 1 : 0.25;
        y += hp.run(ruido()) * tren * Math.exp(-t / 0.05) * 1.6;
      }
      a[i] = Math.tanh(y * 1.2);
    }
    if (cerca) golpe(sr, a, 0.01, 90, 32, 0.4, 0.75, 500);
    return a;
  });
  return normalizaEst(chs, 0.92);
}

/** Aviso de rayo (0.85 s): estática que se carga, zumbido que sube y un «tsss» final. */
function hornoChispa(sr: number) {
  const n = Math.floor(sr * 0.85);
  const a = new Float32Array(n);
  const bp = new Bq(sr, 'bp', 3200, 1.2);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / 0.8;
    ph += (100 + 60 * u * u) / sr;
    const saw = (ph % 1) * 2 - 1;
    const zumbido = Math.tanh(saw * 2) * 0.3 * u * u * (0.8 + 0.2 * Math.sin(TAU * 17 * t));
    const sis = bp.run(ruido()) * Math.pow(u, 3) * 0.9;
    a[i] = (zumbido + sis) * (t > 0.8 ? Math.exp(-(t - 0.8) / 0.01) : 1);
  }
  chasquidos(sr, a, 0, 0.8, (t) => 30 + 500 * Math.pow(t / 0.8, 2.5), { hp: 2500, amp: 0.9, largo: [0.0004, 0.002] });
  return normaliza(a, 0.85);
}

/** Lluvia con racheo (bucle estéreo de 6 s): gotas finas, cortina y viento hueco. */
function hornoLluvia(sr: number) {
  const L = 6;
  return escala(
    [0, 1].map((c) => {
      const n = Math.floor(sr * (L + 0.15));
      const gotas = new Float32Array(n);
      chasquidos(sr, gotas, 0, L + 0.15, () => 420, { hp: 2200, amp: 1, largo: [0.0004, 0.0018] });
      const lp = new Bq(sr, 'lp', 7000, 0.7);
      const cortina = new Bq(sr, 'bp', 1600, 0.6);
      const viento = new Bq(sr, 'bp', 420, 2.2);
      const ph = c * 1.3;
      return bucle(sr, L, (i, t) => {
        if ((i & 63) === 0) viento.f(380 + 160 * Math.sin((TAU * t) / L + ph) + 90 * Math.sin((TAU * 3 * t) / L));
        const racha = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin((TAU * 2 * t) / L + ph), 2);
        return lp.run(gotas[i] ?? 0) * 0.6 + cortina.run(ruido()) * 0.35 * (0.8 + 0.2 * racha) + viento.run(ruido()) * 0.9 * racha;
      });
    }),
    0.9,
  );
}

/** Escarcha (bucle de 4 s): brillo vidrioso que tiembla y un silbido frío, sin graves. */
function hornoEscarcha(sr: number) {
  const L = 4;
  return escala(
    [0, 1].map((c) => {
      const hp = new Bq(sr, 'hp', 3500, 0.7);
      const silbo = new Bq(sr, 'bp', 2200, 8);
      const ph = c * 2.2;
      // Parciales con ciclos enteros por bucle: sin costura.
      const parc = [2637, 3136, 3951].map((f) => Math.round(f * L) / L);
      return bucle(sr, L, (_i, t) => {
        let s = 0;
        parc.forEach((f, k) => (s += Math.sin(TAU * f * t + k + ph) * (0.5 + 0.5 * Math.sin((TAU * (k + 1) * t) / L + ph))));
        return s * 0.05 + hp.run(ruido()) * 0.18 + silbo.run(ruido()) * 0.9 * (0.6 + 0.4 * Math.sin((TAU * t) / L + ph));
      });
    }),
    0.9,
  );
}

/**
 * La sirena del bombardero en picada: un aullido ronco de hélice (dos tonos casi
 * iguales que baten, con muchos armónicos) y aire. Se le sube el tono con la velocidad.
 */
function hornoSirena(sr: number) {
  const L = 2;
  const bp = new Bq(sr, 'bp', 1400, 1.4);
  // Ciclos enteros por bucle: sin costura.
  const fs = [300, 301.5, 450];
  return bucle(sr, L, (_i, t) => {
    let s = 0;
    fs.forEach((f, k) => {
      const ph = TAU * f * t;
      let v = 0;
      for (let h = 1; h <= 7; h++) v += Math.sin(ph * h + k) / (h * 0.9);
      s += v * (k === 2 ? 0.25 : 0.5);
    });
    const aire = bp.run(ruido()) * 0.35;
    return Math.tanh(s * 0.6) + aire;
  });
}

/** Silbido de picada: el aire en las tomas del ala (el «Corsario» silbaba así) o la hélice pasada de vueltas. */
function hornoSilbo(sr: number) {
  const L = 2;
  const bp = new Bq(sr, 'bp', 2400, 14);
  const bp2 = new Bq(sr, 'bp', 1200, 6);
  return bucle(sr, L, (_i, t) => bp.run(ruido()) * 1.4 + bp2.run(ruido()) * 0.5 + Math.sin(TAU * 2400 * t) * 0.08 * (1 + Math.sin((TAU * t) / L)));
}

/** El rugido de un jet que baja a fondo: aire rasgado grave con un siseo encima. */
function hornoRugido(sr: number) {
  const L = 3;
  const lp = new Bq(sr, 'lp', 420, 0.9);
  const bp = new Bq(sr, 'bp', 1600, 0.8);
  return bucle(sr, L, (_i, t) => lp.run(ruido()) * 1.6 * (0.85 + 0.15 * Math.sin((TAU * 3 * t) / L)) + bp.run(ruido()) * 0.35);
}

/** Estampido al romper la barrera: dos golpes secos y graves (la onda en N). */
function hornoEstampido(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.4));
  const lp = new Bq(sr, 'lp', 260, 0.8);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const g1 = t < 0.02 ? 1 : Math.exp(-(t - 0.02) / 0.09);
    const t2 = t - 0.13;
    const g2 = t2 < 0 ? 0 : t2 < 0.02 ? 1 : Math.exp(-(t2 - 0.02) / 0.12);
    a[i] = lp.run(ruido()) * (g1 + g2 * 0.9) * 3 + Math.sin(TAU * 38 * t) * Math.exp(-t / 0.35) * 0.5;
  }
  return normaliza(a, 0.95);
}

/** Aviso de lanzamiento: tres pitidos rápidos que suben (el RWR detecta el disparo). */
function hornoAvisoLanza(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.42));
  for (const [t0, f] of [[0, 1180], [0.13, 1400], [0.26, 1660]] as const) {
    const i0 = Math.floor(t0 * sr);
    for (let j = 0; j < sr * 0.1 && i0 + j < a.length; j++) {
      const t = j / sr;
      const e = Math.min(1, t / 0.004) * Math.min(1, (0.1 - t) / 0.008);
      a[i0 + j] += (Math.sin(TAU * f * t) * 0.8 + Math.sign(Math.sin(TAU * f * t)) * 0.12) * e;
    }
  }
  return normaliza(a, 0.8);
}

/** Bocina de pérdida de sustentación: un zumbido áspero y continuo de cabina (~0,45 s). */
function hornoBocinaPerdida(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.45));
  const lp = new Bq(sr, 'lp', 1800, 0.7);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.01) * Math.min(1, (0.45 - t) / 0.02);
    const sq = Math.sign(Math.sin(TAU * 370 * t)) * 0.6 + Math.sign(Math.sin(TAU * 555 * t)) * 0.3;
    a[i] = lp.run(sq) * env;
  }
  return normaliza(a, 0.8);
}

/** Aviso de terreno: un «uuup» que sube (400 → 950 Hz) en 0,32 s, como el de las cabinas reales. */
function hornoTerreno(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.34));
  let ph = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const f = 400 + 550 * Math.min(1, t / 0.3);
    ph += f / sr;
    const env = Math.min(1, t / 0.01) * Math.min(1, (0.34 - t) / 0.03);
    a[i] = (Math.sin(TAU * ph) * 0.8 + Math.sin(TAU * ph * 2) * 0.2) * env;
  }
  return normaliza(a, 0.8);
}

/** «Master caution»: dos campanazos (do-sol bajando), el aviso general de daño. */
function hornoMaster(sr: number) {
  const n = Math.floor(sr * 0.9);
  const a = new Float32Array(n);
  for (const [t0, f] of [[0, 1047], [0.28, 784]] as const) {
    const i0 = Math.floor(t0 * sr);
    for (let j = 0; i0 + j < n; j++) {
      const t = j / sr;
      const e = Math.min(1, t / 0.003) * Math.exp(-t / 0.22);
      a[i0 + j] += (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2.01 * t) + 0.15 * Math.sin(TAU * f * 3.02 * t)) * e;
    }
  }
  return normaliza(a, 0.8);
}

/** Campanita FM (para los avisos y jingles nuevos). */
function campana(sr: number, L: Float32Array, R: Float32Array, t0: number, f: number, tau: number, amp: number, pan: number, indice = 1.4, razon = 3.5) {
  const i0 = Math.floor(t0 * sr);
  for (let j = 0; i0 + j < L.length && j < tau * 6 * sr; j++) {
    const t = j / sr;
    const mod = Math.sin(TAU * f * razon * t) * indice * Math.exp(-t / (tau * 0.4));
    aEstereo(L, R, i0 + j, Math.sin(TAU * f * t + mod) * Math.exp(-t / tau) * Math.min(1, t / 0.002) * amp, pan);
  }
}

/** Alerta de hielo: «tin-tin» vidrioso (Mi6 y Si5) con un crujido debajo. */
function hornoHieloAlerta(sr: number) {
  const n = Math.floor(sr * 0.9);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  campana(sr, L, R, 0, 1318.5, 0.18, 0.5, -0.3, 2.2, 2.76);
  campana(sr, L, R, 0.16, 987.8, 0.25, 0.5, 0.3, 2.2, 2.76);
  const cr = new Float32Array(n);
  chasquidos(sr, cr, 0, 0.4, (t) => 160 * Math.exp(-t / 0.15), { hp: 3000, amp: 0.5, largo: [0.0005, 0.002] });
  for (let i = 0; i < n; i++) {
    L[i] += cr[i];
    R[i] += cr[i];
  }
  return normalizaEst([L, R], 0.85);
}

/** ¡Congelado!: el hielo se cierra de golpe (crujido y vidrio), un golpe sordo y el motor que se ahoga. */
function hornoCongelado(sr: number) {
  const n = Math.floor(sr * 1.6);
  const a = new Float32Array(n);
  chasquidos(sr, a, 0, 0.25, (t) => 900 * Math.exp(-t / 0.08), { hp: 2500, amp: 1.1, largo: [0.0005, 0.003] });
  for (let k = 0; k < 16; k++) ping(sr, a, rand(0, 0.35), rand(2400, 6000), rand(0.01, 0.05), rand(0.05, 0.15));
  golpe(sr, a, 0, 120, 45, 0.09, 0.9, 900);
  // Motor que se ahoga: diente de sierra que cae y se apaga entre toses.
  const lp = new Bq(sr, 'lp', 650, 0.8);
  let ph = 0, corte = 1, tosG = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = Math.max(0, t - 0.08);
    ph += (45 + 120 * Math.exp(-u / 0.3)) / sr;
    const saw = (ph % 1) * 2 - 1;
    // Fallos de encendido irregulares (un corte periódico de 7 Hz a ~300 Hz balaba).
    if ((i & 1023) === 0) corte = Math.random() < 0.35 ? 0.15 : 1;
    tosG += (corte - tosG) * 0.01;
    const tos = tosG;
    void t;
    a[i] += lp.run(saw) * Math.min(1, u / 0.03) * Math.exp(-u / 0.45) * tos * 0.55;
  }
  friccion(sr, a, 0.2, 0.9, 140, 60, [700, 1500], 0.2);
  return normaliza(a, 0.9);
}

/** Descongelado: el hielo suelta (chasquido), gotas que caen y el motor que vuelve a arrancar. */
function hornoDeshielo(sr: number) {
  const n = Math.floor(sr * 1.5);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const cr = new Float32Array(n);
  chasquidos(sr, cr, 0, 0.12, () => 300, { hp: 2500, amp: 0.7, largo: [0.0005, 0.002] });
  // Arranque: petardeo y un tono que sube y se asienta.
  golpe(sr, cr, 0.18, 150, 50, 0.04, 0.8, 1800);
  const lp = new Bq(sr, 'lp', 1200, 0.8);
  let ph = 0;
  for (let i = Math.floor(0.2 * sr); i < n; i++) {
    const t = i / sr - 0.2;
    ph += (70 + 90 * (1 - Math.exp(-t / 0.25))) / sr;
    cr[i] += lp.run((ph % 1) * 2 - 1) * Math.min(1, t / 0.05) * Math.exp(-t / 0.5) * 0.5;
  }
  for (let i = 0; i < n; i++) {
    L[i] = cr[i];
    R[i] = cr[i];
  }
  // Gotas: «plip» con tono que sube (burbuja), repartidas en el estéreo.
  for (let k = 0; k < 9; k++) {
    const i0 = Math.floor(rand(0.05, 1.1) * sr);
    const f0 = rand(900, 1700), pan = rand(-0.8, 0.8), amp = rand(0.12, 0.25);
    let p = 0;
    for (let j = 0; j < 0.06 * sr && i0 + j < n; j++) {
      const t = j / sr;
      p += f0 * (1 + 2.2 * t / 0.06) / sr;
      aEstereo(L, R, i0 + j, Math.sin(TAU * p) * Math.exp(-t / 0.018) * Math.min(1, t / 0.001) * amp, pan);
    }
  }
  return normalizaEst([L, R], 0.85);
}

/** ¡Misión cumplida!: «ta-ta-taa» de metales en Sol con campanitas (1.5 s, distinto de la fanfarria de oleada). */
function hornoMision(sr: number) {
  const n = Math.floor(sr * 1.5);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  bronce(sr, L, R, 0, 587.33, 0.07, 0.45, -0.2);
  bronce(sr, L, R, 0.1, 783.99, 0.07, 0.45, 0.2);
  for (const [f, a, p] of [[392, 0.38, -0.4], [493.88, 0.36, 0.4], [587.33, 0.36, -0.1], [783.99, 0.42, 0.15]] as const)
    bronce(sr, L, R, 0.2, f, 0.5, a, p);
  [1567.98, 1975.53, 2349.32, 3135.96].forEach((f, k) => campana(sr, L, R, 0.22 + k * 0.06, f, 0.3, 0.16, -0.6 + k * 0.4));
  const tim = new Float32Array(n);
  golpe(sr, tim, 0.2, 100, 65, 0.15, 0.7, 700);
  for (let i = 0; i < n; i++) {
    L[i] += tim[i];
    R[i] += tim[i];
  }
  return normalizaEst([L, R], 0.88);
}

/** ¡Uf!: un «fffit» de aire que sube y dos notas suaves de alivio. */
function hornoUf(sr: number) {
  const n = Math.floor(sr * 0.6);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const bp = new Bq(sr, 'bp', 800, 2);
  for (let i = 0; i < 0.16 * sr; i++) {
    const t = i / sr;
    if ((i & 31) === 0) bp.f(800 * Math.pow(5, t / 0.16));
    aEstereo(L, R, i, bp.run(ruido()) * Math.sin((Math.PI * t) / 0.16) * 0.7, -0.6 + 7 * t);
  }
  campana(sr, L, R, 0.1, 1318.5, 0.12, 0.35, -0.15, 0.6, 2);
  campana(sr, L, R, 0.19, 1760, 0.22, 0.35, 0.15, 0.6, 2);
  return normalizaEst([L, R], 0.8);
}

/** ¡Avión extra!: arpegio ascendente de dos octavas, brillante, con un acorde final que respira. */
function hornoVida(sr: number) {
  const n = Math.floor(sr * 1.3);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const notas = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
  notas.forEach((f, k) => {
    const i0 = Math.floor(k * 0.055 * sr);
    const pan = -0.5 + k * 0.2;
    // Pulso blando (seno con un poco de 2.º y 3.º armónico) en vez de FM: suena a «1-up».
    for (let j = 0; i0 + j < n && j < 0.5 * sr; j++) {
      const t = j / sr;
      const y = (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t) + 0.12 * Math.sin(TAU * 3 * f * t)) * Math.exp(-t / (k === notas.length - 1 ? 0.35 : 0.09)) * Math.min(1, t / 0.003) * 0.32;
      aEstereo(L, R, i0 + j, y, pan);
    }
  });
  for (const [f, p] of [[1046.5, -0.4], [1318.5, 0.4], [1568, 0]] as const) campana(sr, L, R, 0.36, f, 0.4, 0.14, p, 0.8, 2);
  return normalizaEst([L, R], 0.85);
}

/** Bomba nuclear recogida: golpe sub, contador Geiger que se acelera y dos campanas graves en tercera menor. */
function hornoNukeRecoge(sr: number) {
  const n = Math.floor(sr * 1.4);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const sub = new Float32Array(n);
  golpe(sr, sub, 0, 70, 38, 0.25, 0.9, 400);
  const tic = new Float32Array(n);
  chasquidos(sr, tic, 0.05, 1.0, (t) => 8 + 60 * t, { hp: 3500, amp: 1.2, largo: [0.0003, 0.0009] });
  for (let i = 0; i < n; i++) {
    L[i] = sub[i] + tic[i] * 0.8;
    R[i] = sub[i] + tic[i] * 0.8;
  }
  campana(sr, L, R, 0.05, 220, 0.5, 0.4, -0.3, 2.5, 1.41);
  campana(sr, L, R, 0.3, 261.63, 0.6, 0.4, 0.3, 2.5, 1.41);
  return normalizaEst([L, R], 0.88);
}

/** ¡Vuelve!: el misil bumerán gira (soplido que baja y sube) y vuelve a encender con un «pff-fuum». */
function hornoBumeran(sr: number) {
  const n = Math.floor(sr * 1.2);
  const a = new Float32Array(n);
  const bp = new Bq(sr, 'bp', 1200, 2.5);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) bp.f(t < 0.45 ? 1600 - 1100 * (t / 0.45) : 500 + 2600 * Math.min(1, (t - 0.45) / 0.6));
    const env = t < 0.45 ? 0.3 + 0.5 * (t / 0.45) : Math.min(1.4, 0.8 + (t - 0.45) * 1.5) * Math.exp(-Math.max(0, t - 0.95) / 0.08);
    a[i] = bp.run(ruido()) * env * 1.4;
  }
  golpe(sr, a, 0.45, 180, 60, 0.05, 0.9, 2600);
  chasquidos(sr, a, 0.45, 0.7, () => 80, { hp: 2000, amp: 0.4, largo: [0.001, 0.004] });
  return normaliza(a, 0.88);
}

/** Pista nueva en pantalla: burbuja que sube y un «ding» suave. */
function hornoPista(sr: number) {
  const n = Math.floor(sr * 0.5);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < 0.07 * sr; i++) {
    const t = i / sr;
    p += (500 + 900 * (t / 0.07)) / sr;
    aEstereo(L, R, i, Math.sin(TAU * p) * Math.sin((Math.PI * t) / 0.07) * 0.4, 0);
  }
  campana(sr, L, R, 0.06, 1567.98, 0.16, 0.35, 0, 0.5, 2);
  return normalizaEst([L, R], 0.75);
}

/** ¡Empieza la oleada!: redoble que crece y un acorde grave de metales (Re–La). */
function hornoOleada(sr: number) {
  const n = Math.floor(sr * 1.3);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const bp = new Bq(sr, 'bp', 1900, 0.8);
  const red = new Float32Array(n);
  for (let k = 0; k < 14; k++) {
    const t0 = k * 0.032;
    const amp = 0.15 + 0.06 * k;
    const i0 = Math.floor(t0 * sr);
    for (let j = 0; j < 0.03 * sr && i0 + j < n; j++) red[i0 + j] += ruido() * Math.exp(-j / sr / 0.012) * amp;
  }
  for (let i = 0; i < n; i++) {
    const y = bp.run(red[i]);
    L[i] += y;
    R[i] += y;
  }
  for (const [f, a, p] of [[146.83, 0.5, 0], [220, 0.42, -0.35], [293.66, 0.38, 0.35]] as const) bronce(sr, L, R, 0.45, f, 0.45, a, p);
  const tim = new Float32Array(n);
  golpe(sr, tim, 0.45, 95, 55, 0.2, 0.8, 600);
  for (let i = 0; i < n; i++) {
    L[i] += tim[i];
    R[i] += tim[i];
  }
  return normalizaEst([L, R], 0.88);
}

/* ── hornos de armas por avión, bombas especiales y hangar ── */

/**
 * Cañón rotatorio (F-22, M61): cinco tiros a ~105 por segundo en 45 ms, así
 * una llamada cada 45 ms empalma un «brrrt» continuo. Cada tiro es un clic
 * muy corto + un golpe grave de 4 ms: el zumbido sale del ritmo, no de un tono.
 */
function hornoVulcan(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.1));
  const pulsos = new Float32Array(a.length);
  for (let k = 0; k < 5; k++) {
    const i0 = Math.max(0, Math.floor((k * 0.009 + rand(0, 0.0008)) * sr));
    const amp = rand(0.72, 1);
    let f = 0;
    for (let j = 0; i0 + j < a.length && j < 0.03 * sr; j++) {
      const t = j / sr;
      f += (95 + 160 * Math.exp(-t / 0.004)) / sr;
      pulsos[i0 + j] += (ruido() * Math.exp(-t / 0.0012) * 0.9 + Math.sin(TAU * f) * Math.exp(-t / 0.009) * 0.8) * Math.min(1, t / 0.0005) * amp;
    }
  }
  const hp = new Bq(sr, 'hp', 1800, 0.7);
  const bp = new Bq(sr, 'bp', 1400, 1.1);
  const lp = new Bq(sr, 'lp', 6000, 0.7);
  for (let i = 0; i < a.length; i++) {
    const x = pulsos[i];
    a[i] = lp.run(Math.tanh((hp.run(x) * 0.8 + bp.run(x) * 2.2 + x * 0.5) * 1.4));
  }
  return normaliza(a, 0.9);
}

/** Cañón de 30 mm (Su-57): estampido grave y largo, boca más oscura y el «clac» del cierre. */
function hornoCanon30(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.26));
  const hp = new Bq(sr, 'hp', 900, 0.7);
  const bp = new Bq(sr, 'bp', rand(1000, 1300), 1.2);
  const lp = new Bq(sr, 'lp', 5000, 0.7);
  let f = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const click = hp.run(ruido()) * Math.exp(-t / 0.002);
    const boca = bp.run(ruido()) * Math.exp(-t / 0.02) * 2.2;
    f += (55 + 140 * Math.exp(-t / 0.012)) / sr;
    const cuerpo = Math.sin(TAU * f) * Math.exp(-t / 0.06) * Math.min(1, t / 0.001);
    a[i] = lp.run(Math.tanh((click + boca + cuerpo * 1.4) * 1.7));
  }
  ping(sr, a, 0.035, 1650, 0.015, 0.1);
  return normaliza(a, 0.9);
}

/** Láser del platillo: «piu» corto que cae, sin vibrato. */
function hornoLaser(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.14));
  const lp = new Bq(sr, 'lp', 5000, 0.7);
  let ph = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    ph += (380 + 1500 * Math.exp(-t / 0.03)) / sr;
    const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.035);
    a[i] = lp.run((Math.tanh(1.6 * Math.sin(TAU * ph)) * 0.7 + 0.25 * Math.sin(2 * TAU * ph)) * env);
  }
  return normaliza(a, 0.85);
}

/**
 * Orbe de plasma: soplido cuyo filtro sube, ondula despacio (3.5 Hz, sobre el
 * ruido, no sobre el tono) y cae; debajo una quinta que se desliza hacia arriba
 * con un batido lento de 3 Hz entre las voces.
 */
function hornoOrbe(sr: number) {
  const d = 0.7;
  const a = new Float32Array(Math.floor(sr * d));
  const bp = new Bq(sr, 'bp', 500, 3);
  const lp = new Bq(sr, 'lp', 2500, 0.7);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr, u = t / d;
    if ((i & 31) === 0) bp.f((500 + 1500 * Math.sin(Math.PI * Math.min(1, u * 1.3))) * (1 + 0.12 * Math.sin(TAU * 3.5 * t)));
    const env = Math.min(1, t / 0.04) * Math.pow(1 - u, 1.5);
    const f = 200 + 260 * (1 - Math.exp(-t / 0.12));
    p1 += f / sr;
    p2 += (f * 1.5 + 3) / sr;
    a[i] = bp.run(ruido()) * 1.6 * env + lp.run((Math.sin(TAU * p1) + 0.45 * Math.sin(TAU * p2)) * 0.5) * env * 0.6;
  }
  return normaliza(a, 0.85);
}

/** Misil crucero desde la bodega: «clonc» grave al soltarlo y, 0.28 s después, el motor que enciende y ruge. */
function hornoCrucero(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.8));
  golpe(sr, a, 0, 110, 38, 0.09, 1, 700);
  ping(sr, a, 0.005, 620, 0.08, 0.12);
  const t0 = 0.28;
  golpe(sr, a, t0, 160, 50, 0.04, 0.7, 2400);
  const rug = new Bq(sr, 'lp', 350, 0.8);
  const sis = new Bq(sr, 'bp', 2200, 1);
  for (let i = Math.floor(t0 * sr); i < a.length; i++) {
    const u = i / sr - t0;
    if ((i & 31) === 0) rug.f(350 + 700 * Math.min(1, u / 0.5));
    const env = Math.min(1, u / 0.08) * (u < 0.9 ? 1 : Math.exp(-(u - 0.9) / 0.25));
    const fl = 1 + 0.1 * ruido();
    a[i] += Math.tanh((rug.run(ruido()) * 1.5 + sis.run(ruido()) * 0.35) * env * fl * 1.2) * 0.8;
  }
  chasquidos(sr, a, t0, 1.4, (t) => 50 * Math.exp(-(t - t0) / 0.5), { hp: 2200, amp: 0.3, largo: [0.001, 0.004] });
  return normaliza(a, 0.92);
}

/**
 * Ametralladora de calibre de fusil (.303, MG 17): chasquido seco y agudo, casi
 * sin cuerpo; a 40–60 ms entre tiros suena a traqueteo de máquina de coser.
 */
function hornoRifle(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.055));
  const hp = new Bq(sr, 'hp', 2200, 0.7);
  const bp = new Bq(sr, 'bp', 3400, 1.6);
  const lp = new Bq(sr, 'lp', 9000, 0.7);
  let f = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const click = hp.run(ruido()) * Math.exp(-t / 0.0009);
    const boca = bp.run(ruido()) * Math.exp(-t / 0.006) * 2.4;
    f += (170 + 260 * Math.exp(-t / 0.004)) / sr;
    const cuerpo = Math.sin(TAU * f) * Math.exp(-t / 0.008) * Math.min(1, t / 0.0005);
    a[i] = lp.run(Math.tanh((click * 1.4 + boca + cuerpo * 0.6) * 1.5));
  }
  // El cerrojo que vuelve: un tic metálico.
  ping(sr, a, 0.022, 2900, 0.004, 0.08);
  return normaliza(a, 0.85);
}

/**
 * Browning .50: golpe más hondo y redondo que la .30, boca a ~1.6 kHz y el
 * «clac» del cierre; cada tiro dura más y se nota el peso.
 */
function hornoBrowning(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.13));
  const hp = new Bq(sr, 'hp', 1200, 0.7);
  const bp = new Bq(sr, 'bp', 1600, 1.2);
  const lp = new Bq(sr, 'lp', 6000, 0.7);
  let f = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const click = hp.run(ruido()) * Math.exp(-t / 0.0016);
    const boca = bp.run(ruido()) * Math.exp(-t / 0.016) * 2.4;
    f += (78 + 170 * Math.exp(-t / 0.009)) / sr;
    const cuerpo = Math.sin(TAU * f) * Math.exp(-t / 0.03) * Math.min(1, t / 0.0008);
    a[i] = lp.run(Math.tanh((click + boca + cuerpo * 1.4) * 1.7));
  }
  ping(sr, a, 0.03, 1900, 0.008, 0.07);
  return normaliza(a, 0.9);
}

/**
 * GAU-8 Avenger: tres disparos de 30 mm cada 15 ms (≈65 por segundo, como el
 * real), cada uno un golpe grave saturado; llamado cada ~45 ms empalma el
 * «BRRRT» de motosierra. Debajo, un rugido grave que no se corta entre llamadas.
 */
function hornoGau8(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.16));
  const pulsos = new Float32Array(a.length);
  for (let k = 0; k < 3; k++) {
    const i0 = Math.floor((k * 0.0153 + rand(0, 0.0006)) * sr);
    const amp = rand(0.85, 1);
    let f = 0;
    for (let j = 0; i0 + j < a.length && j < 0.06 * sr; j++) {
      const t = j / sr;
      f += (58 + 120 * Math.exp(-t / 0.006)) / sr;
      pulsos[i0 + j] += (ruido() * Math.exp(-t / 0.002) * 0.9 + Math.sin(TAU * f) * Math.exp(-t / 0.02) * 1.1) * Math.min(1, t / 0.0006) * amp;
    }
  }
  const bp = new Bq(sr, 'bp', 900, 1);
  const lp = new Bq(sr, 'lp', 3800, 0.7);
  const rum = new Bq(sr, 'lp', 260, 0.7);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const x = pulsos[i];
    const cola = rum.run(ruido()) * 0.9 * Math.min(1, t / 0.01) * Math.exp(-t / 0.08);
    a[i] = lp.run(Math.tanh((bp.run(x) * 2 + x * 0.9 + cola) * 1.9));
  }
  return normaliza(a, 0.92);
}

/**
 * Misil aire-aire de corto alcance (Sidewinder, R-73/R-74) saliendo del riel:
 * clic del riel y un siseo agudo que sube como un latigazo y se aleja.
 */
function hornoLanzaAam(sr: number) {
  const d = 0.55;
  const a = new Float32Array(Math.floor(sr * d));
  ping(sr, a, 0, 2400, 0.006, 0.25);
  const bp = new Bq(sr, 'bp', 1500, 2.2);
  const hp = new Bq(sr, 'hp', 3000, 0.7);
  for (let i = Math.floor(0.012 * sr); i < a.length; i++) {
    const t = i / sr - 0.012, u = t / d;
    if ((i & 31) === 0) bp.f(1500 + 3800 * Math.min(1, t / 0.12) - 1400 * u);
    const env = Math.min(1, t / 0.015) * Math.exp(-t / 0.16);
    a[i] += (bp.run(ruido()) * 1.8 + hp.run(ruido()) * 0.5 * Math.exp(-t / 0.05)) * env;
  }
  chasquidos(sr, a, 0.02, 0.3, () => 70, { hp: 2500, amp: 0.25, largo: [0.0008, 0.003] });
  return normaliza(a, 0.85);
}

/**
 * AMRAAM / Phoenix desde la bodega o el pilón: «clonc» del eyector y, 0.1 s
 * después, el motor que enciende con un rugido hondo que se aleja.
 */
function hornoLanzaAmraam(sr: number) {
  const d = 1;
  const a = new Float32Array(Math.floor(sr * d));
  golpe(sr, a, 0, 140, 50, 0.05, 0.8, 900);
  ping(sr, a, 0.004, 880, 0.04, 0.08);
  const t0 = 0.1;
  const rug = new Bq(sr, 'lp', 500, 0.8);
  const sis = new Bq(sr, 'bp', 2600, 1.4);
  for (let i = Math.floor(t0 * sr); i < a.length; i++) {
    const u = i / sr - t0;
    const env = Math.min(1, u / 0.03) * Math.exp(-u / 0.32);
    a[i] += Math.tanh((rug.run(ruido()) * 2 + sis.run(ruido()) * 0.8 * Math.exp(-u / 0.15)) * env * 1.3) * 0.85;
  }
  return normaliza(a, 0.9);
}

/**
 * Cohete de la Segunda Guerra (RP-3, HVAR): estampido del encendido y un
 * chisporroteo áspero de pólvora que se aleja tosiendo.
 */
function hornoLanzaCohete(sr: number) {
  const d = 0.75;
  const a = new Float32Array(Math.floor(sr * d));
  golpe(sr, a, 0, 220, 70, 0.025, 0.9, 3000);
  const bp = new Bq(sr, 'bp', 900, 1.1);
  const lp = new Bq(sr, 'lp', 2400, 0.7);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    // Combustión despareja: el soplido tartamudea.
    const tos = 0.6 + 0.4 * Math.sin(TAU * 17 * t + 2 * Math.sin(TAU * 5 * t));
    const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.22);
    a[i] += lp.run(bp.run(ruido()) * 2.2 * tos) * env;
  }
  chasquidos(sr, a, 0.01, 0.6, (t) => 140 * Math.exp(-t / 0.25), { hp: 1500, amp: 0.9, largo: [0.001, 0.005] });
  return normaliza(a, 0.88);
}

/** Tiny Tim: suelta el cohetazo («clonc»), un instante de silencio y un BUM de encendido con rugido largo. */
function hornoLanzaTinyTim(sr: number) {
  const d = 1.3;
  const a = new Float32Array(Math.floor(sr * d));
  golpe(sr, a, 0, 120, 45, 0.05, 0.6, 700);
  const t0 = 0.16;
  golpe(sr, a, t0, 160, 40, 0.09, 1, 1800);
  const rug = new Bq(sr, 'lp', 380, 0.7);
  for (let i = Math.floor(t0 * sr); i < a.length; i++) {
    const u = i / sr - t0;
    const env = Math.min(1, u / 0.03) * Math.exp(-u / 0.4);
    a[i] += Math.tanh(rug.run(ruido()) * 2.6 * env) * 0.8;
  }
  chasquidos(sr, a, t0, 1, (t) => 120 * Math.exp(-(t - t0) / 0.35), { hp: 1200, amp: 0.8, largo: [0.0015, 0.007] });
  return normaliza(a, 0.92);
}

/** Maverick: el riel raspa (fricción metálica) mientras el motor ruge y lo empuja. */
function hornoLanzaMaverick(sr: number) {
  const d = 1;
  const a = new Float32Array(Math.floor(sr * d));
  friccion(sr, a, 0, 0.18, 260, 180, [1100, 1700, 2600], 0.5);
  const rug = new Bq(sr, 'lp', 600, 0.8);
  const sis = new Bq(sr, 'bp', 1800, 1.2);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.04) * Math.exp(-t / 0.35);
    a[i] += Math.tanh((rug.run(ruido()) * 1.8 + sis.run(ruido()) * 0.6) * env * 1.2) * 0.8;
  }
  return normaliza(a, 0.9);
}

/** Racimo: «pop» de la carcasa y n petarditos repartidos en ~0.6 s y en el estéreo. */
function hornoRacimo(sr: number, n: number) {
  const len = Math.floor(sr * 0.95);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const tmp = new Float32Array(Math.floor(sr * 0.25));
  const suma = (t0: number, pan: number, amp: number) => {
    const i0 = Math.floor(t0 * sr);
    for (let j = 0; j < tmp.length && i0 + j < len; j++) aEstereo(L, R, i0 + j, tmp[j] * amp, pan);
  };
  golpe(sr, tmp, 0, 200, 70, 0.025, 0.8, 2600);
  chasquidos(sr, tmp, 0, 0.05, () => 300, { hp: 2500, amp: 0.3, largo: [0.0005, 0.002] });
  suma(0, 0, 1);
  const tiempos = Array.from({ length: n }, () => 0.08 + Math.pow(Math.random(), 0.8) * 0.6).sort((p, q) => p - q);
  for (const t of tiempos) {
    tmp.fill(0);
    golpe(sr, tmp, 0, rand(220, 320), rand(70, 100), rand(0.018, 0.03), 1, 3000);
    chasquidos(sr, tmp, 0.002, 0.06, () => 400, { hp: 2500, amp: 0.3, largo: [0.0005, 0.002] });
    suma(t, rand(-0.6, 0.6), rand(0.45, 0.75));
  }
  return normalizaEst([L, R], 0.88);
}

/** Fósforo blanco: «fuump» de ignición, siseo brillante que chisporrotea y se apaga en ~1.5 s. */
function hornoFosforo(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.6));
  const lp = new Bq(sr, 'lp', 600, 0.7);
  const hp = new Bq(sr, 'hp', 2500, 0.7);
  const lp2 = new Bq(sr, 'lp', 10000, 0.7);
  const bp = new Bq(sr, 'bp', 5500, 2);
  let vivo = 1, meta = 1;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    // Chisporroteo irregular (no periódico): la llama «respira» al azar.
    if ((i & 255) === 0) meta = rand(0.45, 1);
    vivo += (meta - vivo) * 0.004;
    const env = Math.min(1, t / 0.03) * Math.exp(-t / 0.6);
    const ign = t < 0.4 ? lp.run(ruido()) * Math.min(1, t / 0.01) * Math.exp(-t / 0.08) * 1.2 : 0;
    a[i] = ign + (lp2.run(hp.run(ruido())) * 0.7 + bp.run(ruido()) * 0.5) * env * vivo;
  }
  chasquidos(sr, a, 0.02, 1.5, (t) => 160 * Math.exp(-t / 0.6), { hp: 2000, amp: 0.5, largo: [0.0005, 0.003] });
  return normaliza(a, 0.85);
}

/** Gas: «pof» sordo del bote y un siseo largo y suave que baja (~1.5 s). */
function hornoGas(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.7));
  golpe(sr, a, 0, 130, 50, 0.04, 0.9, 500);
  const bp = new Bq(sr, 'bp', 3500, 0.6);
  const lp = new Bq(sr, 'lp', 6000, 0.7);
  const t0 = 0.03;
  for (let i = Math.floor(t0 * sr); i < a.length; i++) {
    const u = i / sr - t0;
    if ((i & 31) === 0) bp.f(1800 + 1700 * Math.exp(-u / 0.6));
    a[i] += lp.run(bp.run(ruido())) * Math.min(1, u / 0.06) * Math.exp(-u / 0.7) * 0.5;
  }
  return normaliza(a, 0.85);
}

/** Bomba de plasma: zumbido que sube 0.5 s (sin vibrato) y un «uomp» sub-grave. */
function hornoPlasmaBomba(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.6));
  const tw = 0.5;
  let ph = 0;
  for (let i = 0; i < tw * sr; i++) {
    const t = i / sr, u = t / tw;
    ph += (300 + 1100 * u * u) / sr;
    const env = Math.pow(u, 1.5) * Math.min(1, (tw - t) / 0.015) * 0.5;
    a[i] = (Math.sin(TAU * ph) + 0.3 * Math.sin(2 * TAU * ph)) * env;
  }
  const lp = new Bq(sr, 'lp', 300, 0.7);
  let fs = 0;
  for (let i = Math.floor(tw * sr); i < a.length; i++) {
    const t = i / sr - tw;
    fs += (32 + 60 * Math.exp(-t / 0.06)) / sr;
    const sub = Math.sin(TAU * fs) * Math.min(1, t / 0.004) * Math.exp(-t / 0.35) * 1.2;
    a[i] += Math.tanh(sub * 1.4) * 0.9 + lp.run(ruido()) * Math.exp(-t / 0.15) * Math.min(1, t / 0.003) * 0.8;
  }
  chasquidos(sr, a, tw, tw + 0.4, (t) => 120 * Math.exp(-(t - tw) / 0.12), { hp: 3000, amp: 0.25, largo: [0.0005, 0.002] });
  return normaliza(a, 0.92);
}

/** Chaff: «pff» del eyector y un susurro de papel metálico (cintas finas, distinto en cada oído). */
function hornoChaff(sr: number) {
  const n = Math.floor(sr * 0.9);
  const chs = [0, 1].map(() => {
    const a = new Float32Array(n);
    const bp = new Bq(sr, 'bp', 1500, 1.2);
    for (let i = 0; i < 0.08 * sr; i++) {
      const t = i / sr;
      // Ataque de 12 ms y menos nivel: el eyector empuja en vez de chasquear (antes, cresta de 24 dB).
      a[i] = bp.run(ruido()) * Math.pow(Math.min(1, t / 0.012), 2) * Math.exp(-t / 0.03) * 0.45;
    }
    chasquidos(sr, a, 0.01, 0.85, (t) => 1200 * Math.exp(-t / 0.25), { hp: 3500, amp: 0.8, largo: [0.0008, 0.002] });
    for (let k = 0; k < 25; k++) ping(sr, a, rand(0.02, 0.6), rand(4000, 9000), rand(0.005, 0.015), rand(0.03, 0.08));
    return a;
  });
  return normalizaEst(chs, 0.8);
}

/** Hologramas: dos notas de cristal (Sol6–Re7) que se cruzan en el estéreo, con eco y brillitos. */
function hornoHolograma(sr: number) {
  const n = Math.floor(sr * 0.95);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  campana(sr, L, R, 0, 1568, 0.25, 0.45, -0.35, 1, 2);
  campana(sr, L, R, 0.09, 2349.3, 0.3, 0.45, 0.35, 1, 2);
  campana(sr, L, R, 0.24, 1568, 0.2, 0.14, 0.35, 1, 2);
  campana(sr, L, R, 0.33, 2349.3, 0.22, 0.14, -0.35, 1, 2);
  for (let k = 0; k < 10; k++) {
    const i0 = Math.floor(rand(0.1, 0.6) * sr);
    const f = rand(4000, 7000), tau = rand(0.01, 0.03), amp = rand(0.04, 0.08), pan = rand(-0.8, 0.8);
    for (let j = 0; i0 + j < n && j < tau * 6 * sr; j++) aEstereo(L, R, i0 + j, Math.sin((TAU * f * j) / sr) * Math.exp(-j / sr / tau) * amp, pan);
  }
  return normalizaEst([L, R], 0.8);
}

/** Salva de bengalas pesadas: cuatro estampidos con su soplido y una cola de chispas. */
function hornoTrampa(sr: number) {
  const a = new Float32Array(Math.floor(sr * 1.3));
  for (let k = 0; k < 4; k++) {
    const t0 = k * 0.075 + rand(0, 0.01);
    golpe(sr, a, t0, rand(170, 210), rand(60, 75), 0.03, rand(0.7, 1), 2200);
    const bp = new Bq(sr, 'bp', 2500, 1);
    const i0 = Math.floor(t0 * sr);
    for (let j = 0; j < 0.4 * sr && i0 + j < a.length; j++) {
      const t = j / sr;
      a[i0 + j] += bp.run(ruido()) * Math.min(1, t / 0.005) * Math.exp(-t / 0.12) * 0.35;
    }
  }
  chasquidos(sr, a, 0.05, 1.25, (t) => 90 * Math.exp(-t / 0.45), { hp: 2200, amp: 0.4, largo: [0.0008, 0.004] });
  return normaliza(a, 0.88);
}

/** Nota de pulso blando (seno con 2.º y 3.º armónico): los avisos del hangar. */
function nota(sr: number, L: Float32Array, R: Float32Array, t0: number, f: number, tau: number, amp: number, pan: number) {
  const i0 = Math.floor(t0 * sr);
  for (let j = 0; i0 + j < L.length && j < tau * 6 * sr; j++) {
    const t = j / sr;
    const y = (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.05) + 0.1 * Math.sin(TAU * 3 * f * t) * Math.exp(-t / 0.03)) * Math.exp(-t / tau) * Math.min(1, t / 0.003) * amp;
    aEstereo(L, R, i0 + j, y, pan);
  }
}

/** Hangar, avión elegido: «tin-tan» de quinta (Sol5–Re6). */
function hornoHangarSel(sr: number) {
  const n = Math.floor(sr * 0.6);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  nota(sr, L, R, 0, 783.99, 0.07, 0.4, -0.1);
  nota(sr, L, R, 0.075, 1174.66, 0.16, 0.42, 0.1);
  campana(sr, L, R, 0.075, 2349.3, 0.1, 0.06, 0.2, 0.6, 2);
  return normalizaEst([L, R], 0.75);
}

/** Hangar, avión bloqueado: zumbido grave corto y blando (sin trémolo ni vibrato). */
function hornoHangarBloq(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.24));
  const lp = new Bq(sr, 'lp', 700, 0.7);
  let ph = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    ph += (135 - 15 * Math.min(1, t / 0.2)) / sr;
    let s = 0;
    for (let k = 1; k <= 6; k++) s += Math.sin(TAU * k * ph) / k;
    const env = Math.min(1, t / 0.006) * (t < 0.17 ? 1 : Math.exp(-(t - 0.17) / 0.015));
    a[i] = lp.run(s * env);
  }
  return normaliza(a, 0.7);
}

/** ¡Desbloqueado!: arpegio Do–Mi–Sol–Do, acorde que brilla y un timbal suave (~0.9 s). */
function hornoDesbloqueo(sr: number) {
  const n = Math.floor(sr * 1);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => nota(sr, L, R, k * 0.065, f, 0.09, 0.34, -0.45 + k * 0.3));
  for (const [f, p] of [[1046.5, -0.35], [1318.5, 0.35], [1568, 0]] as const) nota(sr, L, R, 0.27, f, 0.3, 0.24, p);
  [2093, 2637, 3136].forEach((f, k) => campana(sr, L, R, 0.29 + k * 0.05, f, 0.25, 0.1, -0.5 + k * 0.5, 0.8, 2));
  const tim = new Float32Array(n);
  golpe(sr, tim, 0.27, 100, 65, 0.12, 0.45, 700);
  for (let i = 0; i < n; i++) {
    L[i] += tim[i];
    R[i] += tim[i];
  }
  return normalizaEst([L, R], 0.88);
}

/* ── hornos del zepelín de Margarita ── */

/**
 * Motor del zepelín (bucle de 8 s): cuatro motores de pistón casi al unísono
 * (36, 36.5, 37.25 y 37.75 explosiones/s). No hay vibrato: el «uom-uom» lento
 * sale solo del batido entre ellos (0.25–1.75 Hz), como en los dirigibles de
 * la Gran Guerra. Cada motor es un ciclo de dos explosiones algo desiguales
 * (armónicos impares débiles); encima, el soplo de las hélices y un retumbo.
 * Todas las frecuencias dan ciclos enteros en 8 s: bucle sin costura.
 */
function hornoZepelinMotor(sr: number) {
  const Lp = 8;
  const n = Math.round(sr * Lp);
  const crudo = new Float32Array(n);
  const TAB = 2048;
  [36, 36.5, 37.25, 37.75].forEach((f, k) => {
    const tab = new Float32Array(TAB);
    for (let h = 1; h <= 28; h++) {
      const amp = (h % 2 === 0 ? 1 : 0.28) / Math.pow(h, 0.85);
      const ph = Math.random() * TAU;
      for (let i = 0; i < TAB; i++) tab[i] += amp * Math.sin((TAU * h * i) / TAB + ph);
    }
    const fh = f / 2;
    const g = 1 - k * 0.08;
    for (let i = 0; i < n; i++) {
      const x = (((fh * i) / sr) % 1) * TAB;
      const i0 = Math.floor(x);
      const fr = x - i0;
      crudo[i] += (tab[i0] + (tab[(i0 + 1) % TAB] - tab[i0]) * fr) * g;
    }
  });
  // Paso bajo en régimen permanente: una vuelta de calentamiento y la segunda se guarda (sigue periódico).
  const lp = new Bq(sr, 'lp', 420, 0.8);
  const tonal = new Float32Array(n);
  for (let i = 0; i < 2 * n; i++) {
    const y = lp.run(crudo[i % n]);
    if (i >= n) tonal[i - n] = y;
  }
  escala([tonal], 1);
  const rum = new Bq(sr, 'lp', 140, 0.7);
  const soplo = new Bq(sr, 'bp', 480, 0.9);
  const aire = bucle(sr, Lp, (_i, t) => rum.run(ruido()) * 1.1 + soplo.run(ruido()) * (0.45 + 0.55 * Math.abs(Math.sin(Math.PI * 36 * t))) * 0.6);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const sub = Math.sin(TAU * 37.25 * t) * 0.18;
    a[i] = Math.tanh((tonal[i] * 0.8 + aire[i] * 0.35 + sub) * 1.3) * (0.86 + 0.14 * Math.sin(TAU * 0.25 * t));
  }
  return escala([a], 0.9)[0];
}

/**
 * Sirena antiaérea a manivela (7.5 s, estéreo): sube lenta de 150 a 470 Hz,
 * se sostiene y cae larga hasta ~120 Hz. Dos rotores a una tercera menor (el
 * intervalo inquietante) y un soplo de aire; la altura solo se desliza, nunca
 * ondula. Ecos tardíos distintos en cada lado: suena lejos, sobre la ciudad.
 */
function hornoZepelinSirena(sr: number) {
  const n = Math.floor(sr * 7.5);
  const altura = (t: number) =>
    t < 2.6 ? 150 + 320 * (1 - Math.pow(1 - t / 2.6, 2.2)) : t < 4.2 ? 470 - 15 * ((t - 2.6) / 1.6) : 120 + 335 * Math.exp(-(t - 4.2) / 1.1);
  const seco = new Float32Array(n);
  const lp = new Bq(sr, 'lp', 1800, 0.7);
  const sop = new Bq(sr, 'bp', 600, 2);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = altura(t);
    if ((i & 31) === 0) sop.f(f * 2);
    p1 = (p1 + f / sr) % 1;
    p2 = (p2 + (f * 1.19) / sr) % 1;
    let s = 0;
    for (let k = 1; k <= 10; k++) s += (Math.sin(TAU * k * p1) + 0.55 * Math.sin(TAU * k * p2)) / Math.pow(k, 1.2);
    const env = Math.min(1, t / 0.6) ** 2 * (t > 6.3 ? Math.max(0, 1 - (t - 6.3) / 1.1) : 1);
    seco[i] = (Math.tanh(lp.run(s) * 0.9) + sop.run(ruido()) * 0.35) * env;
  }
  const chs = [0, 1].map((c) => {
    const a = new Float32Array(n);
    const taps: [number, number][] = c ? [[0.29, 0.3], [0.56, 0.17], [0.83, 0.09]] : [[0.23, 0.3], [0.47, 0.18], [0.74, 0.1]];
    for (let i = 0; i < n; i++) {
      let y = seco[i];
      for (const [d, g] of taps) {
        const j = i - Math.floor(d * sr);
        if (j >= 0) y += seco[j] * g;
      }
      a[i] = y;
    }
    return a;
  });
  return normalizaEst(chs, 0.9);
}

/**
 * Crujido del casco (2.4 s): las vigas de un armazón enorme que se tuercen.
 * Fricción a 50–85 golpes/s por resonancias graves (190, 430, 780 Hz; sin
 * vibrato periódico), un gemido grave que baja y un asentamiento sordo.
 */
function hornoZepelinCruje(sr: number, variante: boolean) {
  const n = Math.floor(sr * 2.4);
  const a = new Float32Array(n);
  friccion(sr, a, 0.05, 1.5, variante ? 70 : 85, variante ? 48 : 60, [190, 430, 780], 1);
  friccion(sr, a, variante ? 1.1 : 0.85, 0.9, variante ? 120 : 145, 92, [520, 1150], 0.35);
  let fase = 0, deriva = 0, meta = 0;
  for (let i = 0; i < Math.floor(sr * 2); i++) {
    const t = i / sr;
    if ((i & 2047) === 0) meta = 0.6 + 0.4 * Math.random();
    deriva += (meta - deriva) * 0.0008;
    fase += (62 + 33 * Math.exp(-t / 0.7)) / sr;
    const env = Math.min(1, t / 0.3) * Math.exp(-Math.max(0, t - 0.4) / 0.6);
    a[i] += Math.tanh(Math.sin(TAU * fase) * 1.6) * env * deriva * 0.45;
  }
  golpe(sr, a, variante ? 1.75 : 1.55, 110, 40, 0.12, 0.4, 500);
  for (let k = 0; k < 5; k++) ping(sr, a, rand(0.2, 1.8), rand(900, 2200), rand(0.01, 0.03), rand(0.02, 0.06));
  return normaliza(a, 0.85);
}

/** Granada antiaérea (1.1 s): chasquido seco, «pom» hueco, soplo de esquirlas y un eco. */
function hornoZepelinFlak(sr: number) {
  const n = Math.floor(sr * 1.1);
  const a = new Float32Array(n);
  const hp = new Bq(sr, 'hp', 900, 0.7);
  const bp = new Bq(sr, 'bp', 2500, 1.4);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) bp.f(600 + 1900 * Math.exp(-t / 0.15));
    const crack = t < 0.03 ? Math.tanh(hp.run(ruido()) * 3 * Math.exp(-t / 0.006)) : 0;
    const silbo = bp.run(ruido()) * Math.exp(-t / 0.18) * Math.min(1, t / 0.01) * 0.5;
    a[i] = crack * 0.9 + silbo;
  }
  golpe(sr, a, 0, 150, 60, 0.09, 0.9, 1200);
  chasquidos(sr, a, 0.04, 0.6, (t) => 60 * Math.exp(-t / 0.15), { hp: 2500, amp: 0.25, largo: [0.001, 0.004] });
  const d = Math.floor(sr * 0.18);
  const lp = new Bq(sr, 'lp', 900, 0.7);
  const eco = new Float32Array(n);
  for (let i = d; i < n; i++) eco[i] = lp.run(a[i - d]) * 0.28;
  for (let i = 0; i < n; i++) a[i] += eco[i];
  return normaliza(a, 0.9);
}

/**
 * El zepelín se desploma en llamas (8.5 s, estéreo). Sigue la muerte del
 * jefe: cuatro «buuf» de celdas que se encienden (0.3, 1.15, 2.0, 2.85 s), el
 * armazón que gime al doblarse, el chasquido de la quilla al partirse (3.6 s)
 * y la caída: rugido de fuego creciente, chisporroteo y un retumbo largo.
 */
function hornoZepelinCae(sr: number) {
  const n = Math.floor(sr * 8.5);
  const sub = new Float32Array(n);
  let fs = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t < 3.6) continue;
    const u = t - 3.6;
    fs += (24 + 12 * Math.exp(-u / 1.2)) / sr;
    sub[i] = Math.sin(TAU * fs) * Math.min(1, u / 0.6) * Math.exp(-u / 2.6) * 0.55;
  }
  const chs = [0, 1].map((c) => {
    const a = new Float32Array(n);
    const fuego = new Bq(sr, 'lp', 300, 0.7);
    const caida = new Bq(sr, 'lp', 120, 0.7);
    const buuf = new Bq(sr, 'lp', 200, 0.8);
    const hp = new Bq(sr, 'hp', 1500, 0.7);
    let meta = 1, flam = 1;
    const celdas = [0.3, 1.15, 2.0, 2.85];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) fuego.f(300 + 600 * Math.min(1, t / 3));
      if ((i & 4095) === 0) meta = 0.7 + 0.3 * Math.random();
      flam += (meta - flam) * 0.0005;
      const envF = Math.min(1, t / 2.5) * (t > 7 ? Math.max(0, 1 - (t - 7) / 1.5) : 1);
      let y = fuego.run(ruido()) * envF * flam * 0.9;
      // Celdas de gas: un soplido grave que se abre («buuf»).
      let b = 0;
      for (const c0 of celdas) {
        const u = t - c0 - c * 0.015;
        if (u > 0 && u < 1.5) b += Math.min(1, u / 0.08) * Math.exp(-u / 0.45);
      }
      if ((i & 31) === 0) buuf.f(200 + 900 * Math.min(1, b));
      y += buuf.run(ruido()) * b * 1.4;
      // Quilla partida: chasquido brillante.
      const uq = t - 3.6;
      if (uq > 0 && uq < 0.06) y += Math.tanh(hp.run(ruido()) * 3 * Math.exp(-uq / 0.012)) * 0.9;
      // La caída: retumbo largo.
      if (uq > 0) y += caida.run(ruido()) * Math.min(1, uq / 0.9) * Math.exp(-uq / 2.5) * 2.2;
      a[i] = Math.tanh(y * 1.1) * 0.85 + sub[i];
    }
    for (const c0 of celdas) golpe(sr, a, c0 + c * 0.015, 80, 32, 0.4, 0.5, 500);
    golpe(sr, a, 3.6, 120, 30, 0.6, 0.8, 900);
    friccion(sr, a, 1.0, 2.7, 58, 36, [160, 360, 700], 0.45);
    chasquidos(sr, a, 0.4, 8, (t) => 30 + 90 * Math.min(1, t / 4), { hp: 1500, amp: 0.45, largo: [0.0015, 0.008] });
    for (let k = 0; k < 12; k++) ping(sr, a, rand(3.6, 5.5), rand(900, 2600), rand(0.02, 0.08), rand(0.02, 0.07));
    return a;
  });
  return normalizaEst(chs, 0.95);
}

/** Racimos ya horneados por número de petardos (dos variantes de cada uno). */
/* ── hornos de avisos de armas, nitro, radio y eyección ── */

/** Gatillo en vacío: «clack» seco de percutor y el rebote del cerrojo (sin disparo). */
function hornoSinMunicion(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.16));
  const hp = new Bq(sr, 'hp', 1800, 0.7);
  const bp = new Bq(sr, 'bp', 1650, 6);
  const bp2 = new Bq(sr, 'bp', 1150, 5);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    // Dos golpes: el gatillo (agudo, seco) y el percutor que cae sobre nada (más grave).
    const u = t - 0.032;
    const c1 = hp.run(ruido()) * Math.exp(-t / 0.0012);
    const c2 = u > 0 ? ruido() * Math.exp(-u / 0.0018) * Math.min(1, u / 0.0003) : 0;
    a[i] = Math.tanh(c1 * 0.9 + bp.run(c1) * 4 + bp2.run(c2) * 5 + c2 * 0.35);
  }
  ping(sr, a, 0.033, 2650, 0.012, 0.08);
  return normaliza(a, 0.8);
}

/** Arma lista: «chk» del cargador y un «ti-tin» corto que sube una cuarta. */
function hornoRecargada(sr: number) {
  const n = Math.floor(sr * 0.42);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const chk = new Float32Array(n);
  const hp = new Bq(sr, 'hp', 2200, 0.7);
  for (let i = 0; i < Math.floor(sr * 0.03); i++) chk[i] = hp.run(ruido()) * Math.exp(-i / sr / 0.003) * 0.6;
  ping(sr, chk, 0.002, 2100, 0.01, 0.12);
  for (let i = 0; i < n; i++) {
    L[i] += chk[i];
    R[i] += chk[i];
  }
  nota(sr, L, R, 0.04, 1046.5, 0.05, 0.36, -0.08);
  nota(sr, L, R, 0.1, 1396.9, 0.1, 0.4, 0.08);
  return normalizaEst([L, R], 0.7);
}

/** Nitro aún cargando: «bonk» blando y grave que cae (sin trémolo ni vibrato). */
function hornoNitroNo(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.22));
  const lp = new Bq(sr, 'lp', 900, 0.7);
  let ph = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    ph += (190 - 60 * Math.min(1, t / 0.16)) / sr;
    const s = Math.sin(TAU * ph) + 0.35 * Math.sin(TAU * 2 * ph) + 0.12 * Math.sin(TAU * 3 * ph);
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.07);
    a[i] = lp.run(s * env);
  }
  // Un soplo de tobera ahogada debajo: «quiere y no puede».
  const bp = new Bq(sr, 'bp', 500, 1.2);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    a[i] += bp.run(ruido()) * Math.min(1, t / 0.01) * Math.exp(-t / 0.05) * 0.25;
  }
  return normaliza(a, 0.7);
}

/** Nitro listo: siseo que sube abriéndose en estéreo y tres destellos FM en ascenso. */
function hornoNitroListo(sr: number) {
  const n = Math.floor(sr * 1.1);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const bpL = new Bq(sr, 'bp', 600, 3);
  const bpR = new Bq(sr, 'bp', 650, 3);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      const f = 600 * Math.pow(8, Math.min(1, t / 0.45));
      bpL.f(f);
      bpR.f(f * 1.06);
    }
    const env = Math.pow(Math.min(1, t / 0.4), 2) * (t < 0.45 ? 1 : Math.exp(-(t - 0.45) / 0.09));
    L[i] += bpL.run(ruido()) * env * 0.5;
    R[i] += bpR.run(ruido()) * env * 0.5;
  }
  [1174.66, 1567.98, 2349.3].forEach((f, k) => campana(sr, L, R, 0.3 + k * 0.07, f, 0.22 + k * 0.06, 0.2, -0.4 + k * 0.4, 0.9, 2));
  nota(sr, L, R, 0.44, 587.33, 0.25, 0.14, 0);
  return normalizaEst([L, R], 0.75);
}

/** Lanzabengalas vacío: «tic» hueco de plástico y un resorte que no empuja nada. */
function hornoBengalaVacia(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.14));
  const bp = new Bq(sr, 'bp', 900, 4);
  const hp = new Bq(sr, 'hp', 2500, 0.7);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const c = ruido() * Math.exp(-t / 0.0015);
    a[i] = bp.run(c) * 3 + hp.run(c) * 0.4;
  }
  ping(sr, a, 0.018, 3400, 0.018, 0.05);
  ping(sr, a, 0.02, 4700, 0.012, 0.03);
  return normaliza(a, 0.7);
}

/** Radio: chasquido de squelch, un soplo de estática de banda estrecha y el corte. */
function hornoRadio(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.2));
  const bp = new Bq(sr, 'bp', 1800, 1.1);
  const hp = new Bq(sr, 'hp', 600, 0.7);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const clic = ruido() * Math.exp(-t / 0.0008) * 1.5;
    const est = t > 0.004 && t < 0.15 ? Math.min(1, (t - 0.004) / 0.006) * (t < 0.13 ? 1 : 1 - (t - 0.13) / 0.02) : 0;
    // Estática áspera: ruido recortado (no un tono), con crujidos irregulares.
    const cruje = Math.random() < 0.004 ? ruido() * 3 : 0;
    a[i] = hp.run(clic + bp.run(Math.sign(ruido()) * 0.6 + cruje) * est * 0.8);
  }
  // Clic de cierre.
  const i1 = Math.floor(sr * 0.15);
  for (let k = 0; k < sr * 0.004 && i1 + k < a.length; k++) a[i1 + k] += ruido() * Math.exp(-k / sr / 0.0006) * 0.8;
  return normaliza(a, 0.6);
}

/** Eyección: la cúpula salta («pop» + cristal que vibra) y el cohete del asiento sopla y se aleja. */
function hornoEyeccion(sr: number) {
  const n = Math.floor(sr * 1.6);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const pop = new Float32Array(n);
  golpe(sr, pop, 0, 260, 90, 0.04, 1, 2600);
  ping(sr, pop, 0.006, 1900, 0.05, 0.12);
  ping(sr, pop, 0.009, 3100, 0.03, 0.08);
  const bp = new Bq(sr, 'bp', 400, 1.3);
  const rug = new Bq(sr, 'lp', 300, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t - 0.09;
    let y = pop[i];
    if (u > 0) {
      if ((i & 31) === 0) bp.f(400 * Math.pow(6, Math.min(1, u / 0.35)) / (1 + Math.max(0, u - 0.4) * 1.5));
      const env = Math.min(1, u / 0.03) * (u < 0.3 ? 1 : Math.exp(-(u - 0.3) / 0.28));
      y += (bp.run(ruido()) * 1.1 + rug.run(ruido()) * 0.9) * env;
      // El asiento sube y se va: el soplo cruza de abajo-centro hacia un lado.
      aEstereo(L, R, i, y, clamp(u * 0.5, 0, 0.35));
    } else aEstereo(L, R, i, y, 0);
  }
  return normalizaEst([L, R], 0.85);
}

/** Paracaídas: «fwump» de tela que se llena de aire y un aleteo irregular que se calma. */
function hornoParacaidas(sr: number) {
  const a = new Float32Array(Math.floor(sr * 0.9));
  const lp = new Bq(sr, 'lp', 350, 0.9);
  const bp = new Bq(sr, 'bp', 900, 1.2);
  let mod = 0, meta = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) lp.f(250 + 500 * Math.exp(-t / 0.06));
    // Golpe de aire: entra en ~25 ms y se va en ~0.15 s.
    const fw = Math.min(1, t / 0.025) * Math.exp(-t / 0.13);
    // Aleteo de la tela: deriva aleatoria lenta (no periódica), cada vez más suave.
    if ((i & 255) === 0) meta = Math.random();
    mod += (meta - mod) * 0.004;
    const ale = t > 0.08 ? Math.exp(-(t - 0.08) / 0.25) * (0.3 + 0.7 * mod) : 0;
    a[i] = Math.tanh(lp.run(ruido()) * fw * 3.2) + bp.run(ruido()) * ale * 0.35;
  }
  // Las cuerdas se tensan: un golpecito sordo al final del «fwump».
  golpe(sr, a, 0.06, 120, 70, 0.03, 0.35, 500);
  return normaliza(a, 0.8);
}

const hornosRacimo = new Map<string, AudioBuffer>();
function bufRacimo(m: Mezcla, n: number) {
  const clave = `${n}-${Math.random() < 0.5 ? 0 : 1}`;
  let b = hornosRacimo.get(clave);
  if (!b) {
    const [l, r] = hornoRacimo(m.ctx.sampleRate, n);
    b = m.ctx.createBuffer(2, l.length, m.ctx.sampleRate);
    b.getChannelData(0).set(l);
    b.getChannelData(1).set(r);
    hornosRacimo.set(clave, b);
  }
  return b;
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

/**
 * Bakes every one-shot ahead of time, a few per idle moment, so the first
 * explosion or missile of a game doesn't stall a frame while it's synthesized.
 */
let horneando = false;
let hornoPausa = false;
/**
 * While a game is being played, the baking waits (each sound can take tens of ms
 * on a phone, a visible hitch); it carries on in the menus and the pause.
 */
export function pausarHorneado(on: boolean) {
  hornoPausa = on;
}
export function precalentar() {
  const m = salida(true);
  if (!m || horneando) return;
  const pend = (Object.keys(HORNO) as Nombre[]).filter((n) => !hornos.has(n));
  if (!pend.length) return;
  horneando = true;
  // Safari (iPhone) has no idle callback: one sound per 150 ms tick instead.
  const ocioso = (f: (d?: IdleDeadline) => void) =>
    window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 3000 }) : window.setTimeout(() => f(), 150);
  const paso = (d?: IdleDeadline) => {
    // The context may have been replaced since: stop quietly.
    if (salida(true) !== m) {
      horneando = false;
      return;
    }
    if (hornoPausa) {
      window.setTimeout(() => ocioso(paso), 500);
      return;
    }
    do {
      const n = pend.shift();
      if (!n) break;
      if (!hornos.has(n)) buf(m, n);
    } while (pend.length && d && d.timeRemaining() > 12);
    if (pend.length) ocioso(paso);
    else horneando = false;
  };
  ocioso(paso);
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
  return unaVezBuf(m, buf(m, n), vol, rate, t, pan, destino);
}
function unaVezBuf(m: Mezcla, b: AudioBuffer, vol: number, rate: number, t: number, pan: number, destino: AudioNode) {
  const src = fuente(m, b, false, rate);
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
  if (t < exploMudasHasta) return; // dentro de la nuclear
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
  evento('puente', 1, (m, t) => {
    for (let i = 0; i < 3; i++) unaVez(m, 'pieza-metal', 0.15, 1.5 + i * 0.1, t + i * 0.14, pan);
    unaVez(m, 'rechinido', 0.1, 1.1, t + 0.45, pan);
  });
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
type Mira = { v: Voz; osc: OscillatorNode; g: GainNode; prox: number; visto: number; solido: number; paso: number };
let mira: Mira | null = null;

function miraViva(m: Mezcla, t: number): Mira {
  if (mira) return mira;
  const osc = m.ctx.createOscillator();
  // Áspero (varios armónicos) para que el gruñido del buscador suene a zumbido, no a pitido.
  osc.setPeriodicWave(m.ctx.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.5, 0.32, 0.18, 0.1])));
  osc.frequency.value = 1500;
  const g = ganancia(m, 0);
  const v = voz(osc, [g], m.bus, false);
  osc.start(t);
  mira = { v, osc, g, prox: 0, visto: t, solido: 0, paso: 0 };
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
 * Fijando blanco, como el buscador infrarrojo de un Sidewinder: mientras busca,
 * un gruñido grave y áspero (pulsos de ~30 por segundo con el tono temblando)
 * que sube y se hace más fuerte; con el blanco fijado (k = 1), el chillido agudo
 * y sostenido del buscador, con un leve trino, mientras se siga llamando.
 * Llamar cada cuadro; al dejar de llamarla se calla sola en ≤ 0.16 s.
 */
export function fijando(k: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const kk = clamp(num(k), 0, 1);
  const f = miraViva(m, t);
  f.visto = t;
  if (t < f.solido) return; // el «clic» de fijar manda
  if (f.prox < t) f.prox = t + 0.005;
  if (kk >= 1) {
    const vol = 0.07 * (1 - 0.4 * alarma);
    while (f.prox < t + 0.12) {
      f.osc.frequency.setValueAtTime(f.paso++ % 2 ? 1720 : 1640, f.prox);
      f.prox += 0.045;
    }
    sujeta(f.g.gain, t);
    f.g.gain.linearRampToValueAtTime(vol, t + 0.012);
    f.g.gain.setValueAtTime(vol, t + 0.12);
    f.g.gain.linearRampToValueAtTime(0, t + 0.16);
    return;
  }
  const vol = (0.035 + 0.05 * kk) * (1 - 0.5 * alarma);
  const base = 380 + 260 * kk;
  while (f.prox < t + 0.1) {
    const b = f.prox;
    const v = vol * rand(0.6, 1);
    f.osc.frequency.setValueAtTime(base * rand(0.94, 1.06), b);
    f.g.gain.setValueAtTime(0, b);
    f.g.gain.linearRampToValueAtTime(v, b + 0.004);
    f.g.gain.setValueAtTime(v, b + 0.018);
    f.g.gain.linearRampToValueAtTime(0, b + 0.024);
    f.prox += 0.032;
  }
}

/** Blanco fijado: un «clic» agudo corto; después sigue el tono sostenido de `fijando(1)`. */
export function fijado(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const f = miraViva(m, t);
  if (t < f.solido - 0.1) return;
  const vol = 0.1 * (1 - 0.4 * alarma);
  sujeta(f.g.gain, t);
  f.g.gain.setTargetAtTime(0, t, 0.003);
  sujeta(f.osc.frequency, t);
  f.osc.frequency.setValueAtTime(1900, t + 0.012);
  f.g.gain.setValueAtTime(0, t + 0.012);
  f.g.gain.linearRampToValueAtTime(vol, t + 0.02);
  f.g.gain.setValueAtTime(vol, t + 0.12);
  f.g.gain.linearRampToValueAtTime(0, t + 0.14);
  f.solido = t + 0.15;
  f.prox = t + 0.15;
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
/**
 * Viaje a otro mapa (el nitro del cambio): whoosh y lo que espera allá. Al
 * mar, marejada que rompe y gaviotas; a la tormenta, un trueno lejano y la
 * lluvia que se acerca (antes la tormenta también sonaba a gaviotas).
 */
export function rumboAlMar(destino = 'oceano'): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimoRumbo < 3) return;
  ultimoRumbo = t;
  unaVez(m, 'whoosh', 0.3, 0.85, t, 0, LIMITE + 6);
  if (destino === 'tormenta') {
    unaVez(m, 'trueno-lejos', 0.42, rand(0.92, 1), t + 0.7, -0.4, LIMITE + 6);
    const r = unaVez(m, 'lluvia', 0, 1, t + 0.6, 0, LIMITE + 6);
    if (r) {
      r.g.gain.setValueAtTime(0, t + 0.6);
      r.g.gain.linearRampToValueAtTime(0.24, t + 2.6);
      r.g.gain.linearRampToValueAtTime(0, t + 6.2);
    }
    return;
  }
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

/* ────────────────────────── nuclear, tormenta, hielo y avisos ────────────────────────── */

let ultimaNuclear = -10;
let exploMudasHasta = 0;
/**
 * ☢️ Detonación nuclear (7 s, el sonido más grande del juego). Los misiles
 * desaparecen, así que sus voces y alarmas se callan; las explosiones de lo
 * que la bomba barre (las llamadas a explosion() del siguiente segundo y
 * medio) quedan dentro de ella y no se suman.
 */
export function nuclear(): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimaNuclear < 1) return;
  ultimaNuclear = t;
  for (const vm of vocesMisil) apagar(vm.v, vm.g, t, 0.03);
  vocesMisil.length = 0;
  for (const x of explos) apagar(x.v, x.g, t, 0.03);
  explos.length = 0;
  exploMudasHasta = t + 1.5;
  unaVez(m, 'nuclear', 1.25 * (1 - 0.6 * pesos.espacio), 1, t, 0, LIMITE + 10);
}

const truenos: Corta[] = [];
/**
 * Trueno de un rayo a `distancia` px del avión (pan −1…1). La luz llega
 * antes: el sonido se retrasa hasta 1.2 s con la distancia. Cerca de 700 px
 * suena el rasgón eléctrico; más lejos solo el rodar, sordo. Dos a la vez como máximo.
 */
export function trueno(distancia: number, pan: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const d = Math.max(0, num(distancia, 600));
  const cerca = d < 700;
  const vol = (cerca ? 1.1 / (1 + d / 450) : 0.45 / (1 + (d - 700) / 900)) * (1 - 0.85 * pesos.espacio);
  if (vol < 0.02) return;
  for (let i = truenos.length - 1; i >= 0; i--) if (!truenos[i].v.viva) truenos.splice(i, 1);
  if (truenos.length >= 2) {
    const x = truenos.shift()!;
    apagar(x.v, x.g, t, 0.06);
  }
  if (vivos + 4 > LIMITE + 6) return;
  const src = fuente(m, buf(m, cerca ? 'trueno-cerca' : 'trueno-lejos'), false, rand(0.9, 1.08));
  const lp = m.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cerca ? 500 + 15000 * Math.exp(-d / 220) : 900;
  lp.Q.value = 0.5;
  const g = ganancia(m, vol);
  const p = panner(m.ctx);
  panea(p, num(pan), t, 0.001);
  const v = voz(src, [lp, g, p], m.explo, true);
  src.start(t + Math.min(1.2, d / 1100));
  truenos.push({ v, g });
}

let ultimoAviso = -1;
/** El rayo se carga (0.8 s antes de caer): estática y zumbido que suben. Llamar al crear el rayo. */
export function rayoAviso(pan: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - ultimoAviso < 0.5) return;
  ultimoAviso = t;
  unaVez(m, 'chispa', 0.34 * cede(), 1, t, clamp(num(pan), -1, 1) || 0.001, LIMITE + 4);
}

let tormentaL: Loop | null = null;
/** Lluvia y racheo de la tormenta (llamar cada tick: 1 en el mapa de tormenta, 0 fuera). */
export function tormenta(intensidad: number): void {
  const m = salida();
  if (!m) return;
  const k = clamp(num(intensidad), 0, 1);
  const vol = k < 0.02 ? 0 : 0.2 * k * ambiente() * (0.3 + 0.7 * Math.sqrt(aire));
  tormentaL = loop(m, tormentaL, 'lluvia', vol);
  if (!tormentaL || vol === 0) return;
  hacia(tormentaL.g.gain, vol, m.ctx.currentTime, 0.4);
}

let escarchaL: Loop | null = null;
let hieloAviso = 0;
let ultimoCrujido = -1;
/**
 * Hielo en el fuselaje (llamar cada tick con s.hielo 0…1): un brillo frío
 * que crece, crujidos cada vez más seguidos y dos avisos («tin-tin») al
 * 60 % y al 85 %, que se rearman cuando baja del 45 %.
 */
export function hielo(k: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const h = clamp(num(k), 0, 1);
  const vol = h < 0.08 ? 0 : 0.11 * Math.pow((h - 0.08) / 0.92, 1.5) * ambiente();
  escarchaL = loop(m, escarchaL, 'escarcha', vol);
  if (escarchaL && vol > 0) hacia(escarchaL.g.gain, vol, t, 0.3);
  if (h > 0.2 && t - ultimoCrujido > 0.25 && Math.random() < h * 0.12) {
    ultimoCrujido = t;
    unaVez(m, 'hielo', 0.08 + 0.2 * h, rand(0.8, 1.25), t, rand(-0.6, 0.6), LIMITE_AMB + 4);
  }
  if (h < 0.45) hieloAviso = 0;
  else if (h >= 0.85 && hieloAviso < 2) {
    hieloAviso = 2;
    unaVez(m, 'hielo-alerta', 0.4 * cede(), 1.19, t, 0, LIMITE + 4);
    unaVez(m, 'hielo-alerta', 0.4 * cede(), 1.19, t + 0.34, 0, LIMITE + 4);
  } else if (h >= 0.6 && hieloAviso < 1) {
    hieloAviso = 1;
    unaVez(m, 'hielo-alerta', 0.34 * cede(), 1, t, 0, LIMITE + 4);
  }
}

/** Un efecto de una vez con su propio intervalo mínimo (s). */
const ultimos = new Map<string, number>();
function evento(clave: string, intervalo: number, f: (m: Mezcla, t: number) => void) {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - (ultimos.get(clave) ?? -99) < intervalo) return;
  ultimos.set(clave, t);
  f(m, t);
}

/** ¡Congelado!: el hielo se cierra y el motor se ahoga (1.6 s). */
export function congelado(): void {
  evento('congelado', 1, (m, t) => {
    hieloAviso = 2;
    unaVez(m, 'congelado', 0.8 * cede(), 1, t, 0, LIMITE + 6);
  });
}
/** Descongelado: chasquido, gotas y el motor que vuelve a arrancar (1.5 s). */
export function deshielo(): void {
  evento('deshielo', 1, (m, t) => unaVez(m, 'deshielo', 0.42 * cede(), 1, t, 0, LIMITE + 6));
}
/** ¡Misión cumplida! (1.5 s; distinto de la fanfarria de fin de oleada). */
export function misionCumplida(): void {
  evento('mision', 1, (m, t) => unaVez(m, 'mision', 0.44 * cede(), 1, t, 0, LIMITE + 6));
}
/** ¡Uf!: premio por un misil que pasó rozando (0.5 s). */
export function uf(): void {
  evento('uf', 0.4, (m, t) => unaVez(m, 'uf', 0.22 * cede(), rand(0.98, 1.04), t, 0, LIMITE + 4));
}
/** ¡Avión extra! (1-up, 1.2 s). */
export function vidaExtra(): void {
  evento('vida', 0.5, (m, t) => unaVez(m, 'vida', 0.42 * cede(), 1, t, 0, LIMITE + 6));
}
/** Recoge una bomba nuclear: sub, Geiger y campanas graves (1.4 s). */
export function nuclearRecogida(): void {
  evento('nuke', 0.5, (m, t) => unaVez(m, 'nuke-recoge', 0.48 * cede(), 1, t, 0, LIMITE + 6));
}
/** ¡Vuelve!: un misil bumerán gira y se vuelve a encender (va por el bus principal: es una amenaza). */
export function bumeranVuelve(pan: number): void {
  evento('bumeran', 0.3, (m, t) => unaVez(m, 'bumeran', 0.4, rand(0.96, 1.04), t, clamp(num(pan), -1, 1) || 0.001, LIMITE + 6));
}
/** Aparece una pista nueva en pantalla: burbuja y «ding» suave (como mucho una cada 1.5 s). */
export function pista(): void {
  evento('pista', 1.5, (m, t) => unaVez(m, 'pista', 0.22 * cede(), 1, t, 0, LIMITE + 2));
}
/** Empieza la oleada (al terminar la pausa del cartel): redoble y acorde grave (1.2 s). */
export function oleadaInicio(): void {
  evento('oleada', 2, (m, t) => unaVez(m, 'oleada', 0.4 * cede(), 1, t, 0, LIMITE + 6));
}

/* ────────────────────────── armas por avión, bombas y hangar ────────────────────────── */

/*
 * Niveles respecto de la metralla (~0.22–0.27 por el bus de explosiones):
 * las armas de ráfaga quedan a la par o por debajo, los lanzamientos únicos
 * algo por encima (como un misil) y todo lo de combate va por el bus que se
 * agacha con las alarmas. En el aire fino todo pierde cuerpo, como la metralla.
 */
const enAire = () => 0.5 + 0.5 * aire;
const lado = (pan: number) => clamp(num(pan), -1, 1) || 0;
const tirosVulcan: Corta[] = [];
const tirosCanon: Corta[] = [];
const tirosLaser: Corta[] = [];

/** Cañón rotatorio del F-22 (llamar en cada tiro, ~cada 45 ms; se limita a uno cada 40 ms y 3 voces). */
export function vulcan(pan: number, tono = 1): void {
  evento('vulcan', 0.04, (m, t) => corta(m, tirosVulcan, 3, 'vulcan', 0.22 * rand(0.9, 1) * enAire(), rand(0.96, 1.04) * tono, t, pan, m.explo));
}
/** Cañón de 30 mm del Su-57 (llamar en cada tiro, ~cada 110 ms; se limita a uno cada 90 ms y 3 voces). */
export function canon30(pan: number, tono = 1): void {
  evento('canon30', 0.09, (m, t) => corta(m, tirosCanon, 3, 'canon30', 0.055 * rand(0.88, 1) * enAire(), rand(0.94, 1.05) * tono, t, pan, m.explo));
}
const tirosRifle: Corta[] = [];
const tirosBrowning: Corta[] = [];
const tirosGau8: Corta[] = [];
let nRifle = 0;
/** Ametralladoras de calibre de fusil (.303, MG 17), ~cada 40–60 ms: traqueteo liviano con acento cada 4 tiros. */
export function rifle(pan: number, tono = 1): void {
  evento('rifle', 0.035, (m, t) => {
    const acento = ++nRifle % 4 === 0 ? 1 : 0.78;
    corta(m, tirosRifle, 3, 'rifle', 0.2 * acento * rand(0.88, 1) * enAire(), rand(0.94, 1.06) * tono, t, pan, m.explo);
  });
}
/** Browning .50 (alas o torreta), ~cada 45–75 ms: golpe más grueso que la .30. */
export function browning(pan: number, tono = 1): void {
  evento('browning', 0.04, (m, t) => corta(m, tirosBrowning, 3, 'browning', 0.2 * rand(0.86, 1) * enAire(), rand(0.95, 1.05) * tono, t, pan, m.explo));
}
/** GAU-8 del A-10: cada llamada son tres tiros (se limita a una cada 45 ms y 3 voces): el «BRRRT». */
export function gau8(pan: number, tono = 1): void {
  evento('gau8', 0.045, (m, t) => corta(m, tirosGau8, 3, 'gau8', 0.17 * rand(0.92, 1) * enAire(), rand(0.97, 1.03) * tono, t, pan, m.explo));
}
const LANZA: Record<'aam' | 'amraam' | 'cohete' | 'tinytim' | 'maverick', [Nombre, number]> = {
  aam: ['lz-aam', 0.26],
  amraam: ['lz-amraam', 0.3],
  cohete: ['lz-cohete', 0.28],
  tinytim: ['lz-tinytim', 0.32],
  maverick: ['lz-maverick', 0.28],
};
/** Lanzamiento de un misil o cohete del jugador según su familia (como mucho uno cada 0.12 s). */
export function lanzamiento(tipo: keyof typeof LANZA, pan: number, tono = 1): void {
  const [n, vol] = LANZA[tipo];
  evento('lanza', 0.12, (m, t) => unaVez(m, n, vol * enAire(), rand(0.96, 1.04) * tono, t, lado(pan), LIMITE + 4, m.explo));
}
/** Láser del platillo (llamar en cada tiro, ~cada 70 ms; se limita a uno cada 60 ms y 3 voces). Suave. */
export function laser(pan: number): void {
  evento('laser', 0.06, (m, t) => corta(m, tirosLaser, 3, 'laser', 0.15 * rand(0.85, 1) * enAire(), rand(0.93, 1.07), t, pan, m.explo));
}
/** Orbe de plasma del platillo: soplido que ondula (0.7 s). */
export function orbe(pan: number): void {
  evento('orbe', 0.15, (m, t) => unaVez(m, 'orbe', 0.22 * enAire(), rand(0.95, 1.05), t, lado(pan), LIMITE + 4, m.explo));
}
/** Misil crucero desde la bodega del B-2: «clonc» y encendido del motor (1.6 s). */
export function crucero(pan: number): void {
  evento('crucero', 0.3, (m, t) => unaVez(m, 'crucero', 0.28 * enAire(), rand(0.96, 1.03), t, lado(pan), LIMITE + 4, m.explo));
}
/** Bomba de racimo que se abre: «pop» y n petarditos en ~0.6 s (n se limita a 1–12). */
export function racimo(pan: number, n: number): void {
  evento('racimo', 0.12, (m, t) => {
    if (vivos + 3 > LIMITE + 4) return;
    const k = clamp(Math.round(num(n, 6)), 1, 12);
    const vol = 0.26 * (0.85 + 0.15 * Math.min(1, k / 8)) * enAire();
    unaVezBuf(m, bufRacimo(m, k), vol, rand(0.94, 1.06), t, lado(pan), m.explo);
  });
}
/** Fósforo blanco: ignición, siseo brillante y chisporroteo que se apaga (~1.5 s). */
export function fosforo(pan: number): void {
  evento('fosforo', 0.25, (m, t) => unaVez(m, 'fosforo', 0.32 * enAire(), rand(0.96, 1.04), t, lado(pan), LIMITE + 4, m.explo));
}
/** Bote de gas: «pof» sordo y siseo largo y suave (~1.5 s). */
export function gas(pan: number): void {
  evento('gas', 0.25, (m, t) => unaVez(m, 'gas', 0.24 * enAire(), rand(0.95, 1.05), t, lado(pan), LIMITE + 4, m.explo));
}
/** Bomba de plasma del platillo: zumbido que sube y «uomp» sub-grave (1.2 s). */
export function plasmaBomba(pan: number): void {
  evento('plasma-bomba', 0.3, (m, t) => unaVez(m, 'plasma-bomba', 0.11 * enAire(), rand(0.97, 1.03), t, lado(pan), LIMITE + 4, m.explo));
}
/** Chaff del B-2: eyector y susurro de cintas metálicas (0.8 s). */
export function chaff(pan: number): void {
  evento('chaff', 0.25, (m, t) => unaVez(m, 'chaff', 0.45 * enAire(), rand(0.95, 1.05), t, lado(pan), LIMITE + 4, m.explo));
}
/** Señuelos holográficos del platillo: dos notas de cristal con brillitos (0.8 s). */
export function holograma(pan: number): void {
  evento('holograma', 0.3, (m, t) => unaVez(m, 'holograma', 0.2, 1, t, lado(pan), LIMITE + 4, m.explo));
}
/** Salva de bengalas pesadas del Su-57: cuatro estampidos y cola de chispas (1.2 s). */
export function trampa(pan: number): void {
  evento('trampa', 0.3, (m, t) => unaVez(m, 'trampa', 0.3 * enAire(), rand(0.96, 1.04), t, lado(pan), LIMITE + 4, m.explo));
}

/** Un sonido de interfaz: suena aunque el juego de fondo del menú esté callado. */
function interfaz(clave: string, intervalo: number, n: Nombre, vol: number) {
  const m = salida(true);
  if (!m) return;
  const t = m.ctx.currentTime;
  if (t - (ultimos.get(clave) ?? -99) < intervalo) return;
  ultimos.set(clave, t);
  unaVez(m, n, vol, 1, t, 0, LIMITE + 6);
}
/** Hangar: avión elegido («tin-tan» de quinta, 0.3 s). */
export function hangarSel(): void {
  interfaz('hangar-sel', 0.06, 'hangar-sel', 0.24);
}
/** Hangar: tocó un avión bloqueado (zumbido grave y blando, 0.2 s). */
export function hangarBloqueado(): void {
  interfaz('hangar-bloq', 0.15, 'hangar-bloq', 0.2);
}
/** ¡Nuevo avión o bomba desbloqueada!: arpegio ascendente y acorde (~0.9 s). */
export function desbloqueo(): void {
  interfaz('desbloqueo', 0.6, 'desbloqueo', 0.33);
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
  mantenerZepelin(t);
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

/* ────────────────────────── zepelín de Margarita ────────────────────────── */

type VozZep = { v: Voz; src: AudioBufferSourceNode; g: GainNode; lp: BiquadFilterNode; p: Pan; visto: number; libre: number; muere: number };
let zep: VozZep | null = null;

/**
 * Zumbido de los motores del zepelín: grave, pesado, con un batido lento
 * («uom… uom…»). Llamar cada tick con la posición del zepelín respecto al
 * avión (px, y hacia arriba); vivo=false (está cayendo) apaga los motores con
 * un quejido de ~3 s. Si se deja de llamar, se apaga solo en ~0.5 s.
 */
export function zepelinMotor(dx: number, dy: number, vivo: boolean): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  mantenerZepelin(t);
  const x = num(dx), y = num(dy);
  const r = Math.hypot(x, y);
  if (!zep) {
    if (!vivo || r > 1500 || vivos + 4 > LIMITE + 6) return;
    const src = fuente(m, buf(m, 'zepelin-motor'), true);
    const lp = m.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 0.5;
    const g = ganancia(m, 0);
    const p = panner(m.ctx);
    const v = voz(src, [lp, g, p], m.bus, false);
    src.start(t, rand(0, 8));
    zep = { v, src, g, lp, p, visto: t, libre: -1, muere: -1 };
  }
  const z = zep;
  z.visto = t;
  z.libre = -1;
  if (!vivo) {
    if (z.muere < 0) {
      // Los motores se ahogan: la marcha baja de una vez (un deslizamiento, no un vibrato) y se apaga.
      z.muere = t;
      sujeta(z.src.playbackRate, t);
      z.src.playbackRate.setTargetAtTime(0.6, t, 1.1);
      sujeta(z.g.gain, t);
      z.g.gain.setTargetAtTime(0, t + 0.4, 0.9);
    }
    return;
  }
  if (z.muere >= 0) {
    z.muere = -1;
    sujeta(z.src.playbackRate, t);
    hacia(z.src.playbackRate, 1, t, 0.3);
  }
  const prox = clamp(1 - r / 1500, 0, 1);
  const vol = (0.04 + 0.22 * Math.pow(prox, 1.5)) * (1 - 0.35 * Math.max(duck, alarma)) * (0.6 + 0.4 * aire);
  hacia(z.g.gain, vol, t, 0.25);
  hacia(z.lp.frequency, 260 + 900 * prox * prox, t, 0.3);
  panea(z.p, clamp(x / 450, -1, 1) * 0.85, t, 0.15);
}

/** El zepelín que el juego dejó de reportar (o que ya cayó) se apaga solo. */
function mantenerZepelin(t: number) {
  const z = zep;
  if (!z) return;
  if (z.libre < 0 && z.muere < 0 && t - z.visto > 0.5) {
    z.libre = t;
    hacia(z.g.gain, 0, t, 0.3);
  } else if ((z.libre >= 0 && t - z.libre > 1.5) || (z.muere >= 0 && t - z.muere > 5)) {
    apagar(z.v, z.g, t);
    zep = null;
  }
}

/** Llega el zepelín: sirena antiaérea larga y lejana sobre un golpe sordo (~7.5 s). Usar en vez de jefeLlega(). */
export function zepelinLlega(): void {
  evento('zepelin-llega', 5, (m, t) => {
    unaVez(m, 'explo-grande', 0.3, 0.45, t, 0, LIMITE + 6);
    unaVez(m, 'zepelin-sirena', 0.3 * cede(), 1, t + 0.15, 0, LIMITE + 8);
  });
}

/** El casco gime y cruje (~2.4 s; se limita a uno cada 1.2 s). `pan` −1…1 opcional. */
export function zepelinCruje(pan = 0): void {
  evento('zepelin-cruje', 1.2, (m, t) =>
    unaVez(m, Math.random() < 0.5 ? 'zepelin-cruje' : 'zepelin-cruje2', 0.24 * enAire(), rand(0.9, 1.06), t, lado(pan) || rand(-0.3, 0.3), LIMITE + 4),
  );
}

const flaks: Corta[] = [];
/** Estallido de una granada antiaérea del zepelín (se limita a uno cada 70 ms y 3 voces). */
export function zepelinFlak(pan: number): void {
  evento('zepelin-flak', 0.07, (m, t) => corta(m, flaks, 3, 'zepelin-flak', 0.42 * rand(0.85, 1) * enAire(), rand(0.9, 1.1), t, pan, m.explo));
}

/** El zepelín arde y se parte: celdas que estallan, quilla rota y caída (~8.5 s). Llamar al empezar su muerte. */
export function zepelinCae(): void {
  evento('zepelin-cae', 4, (m, t) => {
    if (zep && zep.muere < 0) zepelinMotor(0, 0, false);
    unaVez(m, 'zepelin-cae', 0.55, 1, t, 0, LIMITE + 8);
  });
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

/* ────────────────────────── avisos de armas, nitro y cabina ────────────────────────── */

/** Intenta lanzar misil o bomba con el soporte vacío o recargando: «clack» seco (máx. ~4/s). */
export function sinMunicion(pan = 0): void {
  evento('sin-municion', 0.25, (m, t) => unaVez(m, 'sin-municion', 0.3 * cede(), rand(0.95, 1.05), t, lado(pan) * 0.5, LIMITE + 4));
}

const TONO_RECARGA = { misil: 1, bomba: 0.84, bengala: 1.19 } as const;
/** Un arma volvió a estar lista: «chk ti-tin» corto, tono distinto por arma (máx. ~3/s por arma). */
export function armaRecargada(tipo: 'misil' | 'bomba' | 'bengala'): void {
  const r = TONO_RECARGA[tipo] ?? 1;
  evento('recargada-' + tipo, 0.33, (m, t) => unaVez(m, 'recargada', 0.2 * cede(), r, t, 0, LIMITE + 4));
}

/** Doble toque de nitro mientras se recarga: «bonk» blando de negación (máx. ~2/s). */
export function nitroNoListo(): void {
  evento('nitro-no', 0.5, (m, t) => unaVez(m, 'nitro-no', 0.26 * cede(), 1, t, 0, LIMITE + 4));
}

/** El nitro terminó de recargarse: siseo que sube con destellos (~1 s). */
export function nitroListo(): void {
  evento('nitro-listo', 1, (m, t) => unaVez(m, 'nitro-listo', 0.24 * cede(), 1, t, 0, LIMITE + 4));
}

/** Lanzabengalas vacío: «tic» hueco (máx. ~4/s). */
export function bengalaVacia(): void {
  evento('bengala-vacia', 0.25, (m, t) => unaVez(m, 'bengala-vacia', 0.26 * cede(), rand(0.96, 1.04), t, 0, LIMITE + 4));
}

/** Empieza una transmisión de radio: squelch + estática cortita (máx. ~1/s). */
export function radioRaton(): void {
  evento('radio', 1, (m, t) => unaVez(m, 'radio', 0.16, rand(0.97, 1.03), t, 0, LIMITE + 4));
}

/** Eyección: la cúpula salta y el cohete del asiento sopla (~1.5 s). */
export function eyeccion(pan = 0): void {
  evento('eyeccion', 1, (m, t) => unaVez(m, 'eyeccion', 0.42 * cede(), rand(0.97, 1.03), t, lado(pan) * 0.6, LIMITE + 6));
}

/** Se abre un paracaídas: «fwump» de tela (~0.8 s). */
export function paracaidas(pan = 0): void {
  evento('paracaidas', 1, (m, t) => unaVez(m, 'paracaidas', 0.32 * cede(), rand(0.95, 1.05), t, lado(pan) * 0.6, LIMITE + 4));
}

/*
 * Receptor de alerta radar (RWR): un misil nos persigue. Bips de un tono
 * propio (más grave y algo más áspero que la fijación y que la mira) que se
 * aceleran y suben con la cercanía; muy cerca, tono continuo. Sin vibrato:
 * el tono solo se desliza con `cerca`.
 */
type Rwr = { v: Voz; osc: OscillatorNode; g: GainNode; prox: number; continuo: boolean; quieto: number; activo: boolean; paso: number };
let rwr: Rwr | null = null;

/**
 * Llamar CADA CUADRO con 0…1 (0 = nadie nos persigue, 1 = impacto inminente).
 * En 0 se calla en ~50 ms; si se deja de llamar, los bips agendados se
 * acaban en ≤ 0.13 s y el tono continuo se corta solo en ≤ 0.2 s.
 */
export function alertaMisil(cerca: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const c = clamp(num(cerca), 0, 1);
  if (c < 0.02) {
    if (rwr) {
      if (rwr.activo) {
        sujeta(rwr.g.gain, t);
        rwr.g.gain.setTargetAtTime(0, t, 0.012);
        rwr.activo = rwr.continuo = false;
        rwr.quieto = t;
      } else if (t - rwr.quieto > 2) {
        apagar(rwr.v, rwr.g, t);
        rwr = null;
      }
    }
    return;
  }
  if (!rwr) {
    const osc = m.ctx.createOscillator();
    osc.setPeriodicWave(m.ctx.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.4, 0.2, 0.1, 0.05])));
    osc.frequency.value = 820;
    const lp = m.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.Q.value = 0.5;
    const g = ganancia(m, 0);
    const v = voz(osc, [lp, g], m.bus, false);
    osc.start(t);
    rwr = { v, osc, g, prox: t + 0.01, continuo: false, quieto: t, activo: false, paso: 0 };
  }
  const f = rwr;
  if (!f.activo) {
    f.activo = true;
    f.prox = t + 0.01;
  }
  // Si ya suena la alarma fuerte, el RWR da un paso atrás (no compiten).
  const vol = (0.07 + 0.05 * c) * (1 - 0.5 * nivelFuerte);
  if (c >= 0.93) {
    hacia(f.osc.frequency, 1300, t, 0.02);
    // Tono continuo que se sostiene mientras lo sigan llamando.
    sujeta(f.g.gain, t);
    if (!f.continuo) f.g.gain.linearRampToValueAtTime(vol, t + 0.01);
    else f.g.gain.setValueAtTime(vol, t + 0.01);
    f.g.gain.setValueAtTime(vol, t + 0.15);
    f.g.gain.linearRampToValueAtTime(0, t + 0.19);
    f.continuo = true;
    f.prox = t + 0.2;
    return;
  }
  if (f.continuo) {
    sujeta(f.g.gain, t);
    f.g.gain.setTargetAtTime(0, t, 0.01);
    f.continuo = false;
    f.prox = t + 0.06;
  }
  const intervalo = 0.07 + 0.55 * Math.pow(1 - c, 1.4);
  const largo = Math.min(0.09, intervalo * 0.5);
  if (f.prox < t) f.prox = t + 0.01;
  // Como un receptor de alerta real ante un lanzamiento: un trino de dos tonos
  // («di-du-di-du») que se apura con la cercanía.
  const lo = 820 + 420 * c;
  while (f.prox < t + 0.13) {
    const b = f.prox;
    f.osc.frequency.setValueAtTime(f.paso++ % 2 ? lo * 1.33 : lo, b);
    f.g.gain.setValueAtTime(0, b);
    f.g.gain.linearRampToValueAtTime(vol, b + 0.004);
    f.g.gain.setValueAtTime(vol, b + largo - 0.005);
    f.g.gain.linearRampToValueAtTime(0, b + largo);
    f.prox += intervalo;
  }
}

/* ────────────────────────── avisos de cabina ────────────────────────── */

/**
 * Avisos de cabina, llamar cada cuadro: `perdida` (el avión pierde sustentación:
 * bocina repetida), `terreno` 0…1 (picando rápido cerca del suelo: «uuup» cada vez
 * más seguido) y `critico` (casi sin vida: «master caution» cada 2,5 s).
 */
export function avisosCabina(perdida: boolean, terreno: number, critico: boolean): void {
  if (perdida) evento('aviso-perdida', 0.55, (m, t) => unaVez(m, 'bocina-perdida', 0.16 * cede(), 1, t, 0, LIMITE + 4));
  const k = clamp(num(terreno), 0, 1);
  if (k > 0.35) evento('aviso-terreno', 0.75 - 0.4 * k, (m, t) => unaVez(m, 'tono-terreno', (0.12 + 0.08 * k) * cede(), 1, t, 0, LIMITE + 4));
  if (critico) evento('aviso-master', 2.5, (m, t) => unaVez(m, 'master-caution', 0.17 * cede(), 1, t, 0, LIMITE + 4));
}

/** Un misil enemigo acaba de salir hacia el avión: aviso inmediato, desde su lado (máx. ~3/s). */
export function avisoLanzamiento(pan = 0): void {
  evento('aviso-lanza', 0.33, (m, t) => unaVez(m, 'aviso-lanza', 0.2 * cede(), 1, t, lado(pan) * 0.5, LIMITE + 4));
}

/* ────────────────────────── picada ────────────────────────── */

let picadaL: Loop | null = null;
let picadaNombre: Nombre | null = null;
let estampidoListo = true;

/** Cómo suena cada avión al lanzarse en picada. */
export type ClasePicada = 'sirena' | 'silbo' | 'helice' | 'jet' | null;
const PICADA: Record<Exclude<ClasePicada, null>, { n: Nombre; vol: number; rate: [number, number] }> = {
  sirena: { n: 'sirena-picada', vol: 0.5, rate: [0.62, 1.25] },
  silbo: { n: 'silbo-picada', vol: 0.32, rate: [0.8, 1.2] },
  helice: { n: 'silbo-picada', vol: 0.16, rate: [0.45, 0.7] },
  jet: { n: 'rugido-picada', vol: 0.3, rate: [0.8, 1.3] },
};

/**
 * La picada del avión: `k` 0…1 cuánto se está tirando hacia abajo (ángulo y
 * velocidad juntos), `v` la velocidad relativa a su máxima. El Stuka aúlla con su
 * sirena, el Corsario silba, las hélices chillan y los jets rugen; y los jets dan
 * un estampido al pasar de su velocidad máxima.
 */
export function picada(clase: ClasePicada, k: number, v: number): void {
  const m = salida();
  if (!m) return;
  const t = m.ctx.currentTime;
  const kk = clamp(num(k), 0, 1);
  const vv = clamp(num(v), 0, 1.3);
  const cfg = clase ? PICADA[clase] : null;
  if (picadaL && (!cfg || cfg.n !== picadaNombre)) {
    apagar(picadaL.v, picadaL.g, t, 0.15);
    picadaL = null;
  }
  picadaNombre = cfg?.n ?? null;
  const vol = cfg ? cfg.vol * Math.pow(kk, 1.3) * ambiente() * (0.4 + 0.6 * aire) : 0;
  if (cfg) {
    picadaL = loop(m, picadaL, cfg.n, vol);
    if (picadaL && vol > 0) {
      hacia(picadaL.g.gain, vol, t, 0.15);
      hacia(picadaL.src.playbackRate, cfg.rate[0] + (cfg.rate[1] - cfg.rate[0]) * clamp(vv, 0, 1) * (0.6 + 0.4 * kk), t, 0.25);
    }
  }
  if (clase === 'jet') {
    if (vv > 0.97 && estampidoListo) {
      estampidoListo = false;
      unaVez(m, 'estampido', 0.55 * ambiente(), 1, t, 0, LIMITE + 4);
    } else if (vv < 0.8) estampidoListo = true;
  }
}

/* ────────────────────────── apagar ────────────────────────── */

function apagarContinuos(t: number, tc: number) {
  for (const vm of vocesMisil) apagar(vm.v, vm.g, t, tc);
  vocesMisil.length = 0;
  for (const l of [motorL, fuegoL, vientoL, tormentaL, escarchaL, picadaL]) if (l) apagar(l.v, l.g, t, tc);
  motorL = fuegoL = vientoL = tormentaL = escarchaL = picadaL = null;
  hieloAviso = 0;
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
  if (zep) apagar(zep.v, zep.g, t, tc);
  zep = null;
  if (fuerte) apagar(fuerte.v, fuerte.g, t, tc);
  fuerte = null;
  nivelFuerte = alarma = alarmaFij = 0;
  if (mira) apagar(mira.v, mira.g, t, tc);
  mira = null;
  if (nitroV) apagar(nitroV.v, nitroV.g, t, tc);
  nitroV = null;
  if (rwr) apagar(rwr.v, rwr.g, t, tc);
  rwr = null;
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
  for (const l of [motorL, fuegoL, vientoL, tormentaL, escarchaL, picadaL]) if (l) liberar(l.v);
  motorL = fuegoL = vientoL = tormentaL = escarchaL = picadaL = null;
  truenos.length = 0;
  ultimos.clear();
  hieloAviso = 0;
  ultimaNuclear = -10;
  exploMudasHasta = 0;
  ultimoCrujido = ultimoAviso = -1;
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
  if (zep) liberar(zep.v);
  zep = null;
  flaks.length = 0;
  if (fuerte) liberar(fuerte.v);
  fuerte = null;
  nivelFuerte = alarma = alarmaFij = 0;
  if (mira) liberar(mira.v);
  mira = null;
  nitroV = null;
  if (rwr) liberar(rwr.v);
  rwr = null;
  balas.length = balasEnemigas.length = chapuzones.length = 0;
  tirosVulcan.length = tirosCanon.length = tirosLaser.length = 0;
  hornosRacimo.clear();
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
