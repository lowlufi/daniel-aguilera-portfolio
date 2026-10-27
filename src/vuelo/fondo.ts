/*
 * El fondo del juego de aviones: todo lo que está detrás del suelo.
 *
 * Estilo «dulce»: pixel art pastel, formas redondas, contornos en un tono más
 * oscuro del mismo color (nunca negro) y nada de anti-aliasing. Same sky,
 * clouds, stratosphere and space for every map; the land layers depend on
 * `paisaje`:
 *
 *   valle      → San Antonio: coastal range, then sectors by world x (San Juan,
 *                Llolleo, Barrancas, the port, Cartagena)
 *   oceano     → the sea, with the coast on the horizon (San Antonio → coast →
 *                Valparaíso, by `costa`), sailboats, gulls and glitter
 *   valparaiso → far ridges, the bay, cerros packed with houses, camanchaca
 *
 * Cada capa estática se pinta una sola vez por ambiente en una tira que se
 * repite en x (los colores salen de un material base «de día» que se tiñe
 * por ambiente y se funde con la bruma según la distancia). Por cuadro solo
 * hay drawImage y unos pocos rectángulos animados, sin crear objetos.
 */

export type Ambiente = 'dia' | 'tarde' | 'noche';

export type OpcionesFondo = {
  vw: number;
  vh: number;
  camX: number;
  camY: number;
  horizonte: number;
  t: number;
  ambiente: Ambiente;
  /** Movimiento reducido: nada se desplaza ni parpadea. */
  quieto?: boolean;
  /** Which landscape sits under the sky (default 'valle'). */
  paisaje?: Paisaje;
  /** Ocean only: where along the coast we are, 0 = off San Antonio … 1 = arriving at Valparaíso. */
  costa?: number;
  /** Ocean only: seconds of travel; the coast drifts right → left with it. */
  viaje?: number;
  /** The storm map (drawn over the ocean backdrop). If left out, it's guessed from paisaje 'oceano' + costa 0.5. */
  tormenta?: boolean;
  /** Storm map only: how far the storm has cleared, 0 = full storm … 1 = clear moonlit night. */
  despeje?: number;
};

type Ctx = CanvasRenderingContext2D;
type Cv = HTMLCanvasElement;
type RGB = [number, number, number];

/* ── Color ───────────────────────────────────────────────────────────────── */

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const lerp = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: RGB) => `rgb(${clamp(c[0])},${clamp(c[1])},${clamp(c[2])})`;
/** ABGR empaquetado para escribir en un ImageData (little-endian). */
const pack = (c: RGB) => ((255 << 24) | (clamp(c[2]) << 16) | (clamp(c[1]) << 8) | clamp(c[0])) >>> 0;

type Paleta = {
  /** Paradas del cielo: [altura sobre el horizonte, color]. */
  cielo: [number, string][];
  bruma: RGB;
  /** Tiñe un color de día al ambiente. */
  tinte: (c: RGB) => RGB;
  nube: { cuerpo: string; luz: string; sombra: string; tinta: string };
  ventana: string | null;
  ventanaLuz: number; // fracción de ventanas encendidas
  pajaro: string | null;
};

const PAL: Record<Ambiente, Paleta> = {
  dia: {
    cielo: [[0, '#f6fde6'], [26, '#e2f6f6'], [80, '#bce6ff'], [170, '#92ceff'], [290, '#6cb2f8'], [430, '#5296ec'], [560, '#4686e0']],
    bruma: hex('#e4f6f6'),
    tinte: (c) => c,
    nube: { cuerpo: '#ffffff', luz: '#ffffff', sombra: '#d6eafc', tinta: '#94c0ee' },
    ventana: null,
    ventanaLuz: 0,
    pajaro: '#5a6cb0',
  },
  tarde: {
    cielo: [[0, '#ffe8a6'], [26, '#ffcc92'], [72, '#ffaa9c'], [130, '#f490b4'], [210, '#c87ece'], [320, '#9472ce'], [450, '#6c5ebe'], [560, '#5a50b0']],
    bruma: hex('#ffcca6'),
    tinte: (c) => [c[0] * 0.82 + 58, c[1] * 0.76 + 22, c[2] * 0.72 + 36],
    nube: { cuerpo: '#ffe6ee', luz: '#fff8f4', sombra: '#ffc494', tinta: '#e290aa' },
    ventana: '#ffe48a',
    ventanaLuz: 0.45,
    pajaro: '#9a4a86',
  },
  noche: {
    cielo: [[0, '#9a64aa'], [26, '#7c54a0'], [84, '#5a4090'], [160, '#40307c'], [270, '#2c2266'], [410, '#1e1854'], [560, '#151044']],
    bruma: hex('#6e4e9e'),
    tinte: (c) => [c[0] * 0.3 + 26, c[1] * 0.28 + 20, c[2] * 0.42 + 70],
    nube: { cuerpo: '#5e5698', luz: '#8c80c8', sombra: '#4a4286', tinta: '#3a3274' },
    ventana: '#ffd870',
    ventanaLuz: 0.92,
    pajaro: null,
  },
};

/** Un material de día, teñido al ambiente y fundido con la bruma `k` (0 cerca, 1 lejos). */
const mat = (a: Ambiente, h: string, k: number): RGB => lerp(PAL[a].tinte(hex(h)), PAL[a].bruma, k);

/* ── Pintura de píxeles en memoria (repite en x) ─────────────────────────── */

class Buf {
  readonly img: ImageData;
  readonly d: Uint32Array;
  constructor(readonly w: number, readonly h: number) {
    this.img = new ImageData(w, h);
    this.d = new Uint32Array(this.img.data.buffer);
  }
  px(x: number, y: number, c: number) {
    y = Math.round(y);
    if (y < 0 || y >= this.h) return;
    x = ((Math.round(x) % this.w) + this.w) % this.w;
    this.d[y * this.w + x] = c;
  }
  at(x: number, y: number) {
    if (y < 0 || y >= this.h) return 0;
    x = ((x % this.w) + this.w) % this.w;
    return this.d[y * this.w + x];
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  /** Disco de píxeles, igual que `disc` de dulce.ts. */
  disc(cx: number, cy: number, r: number, c: number) {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.round(Math.sqrt(r * r - dy * dy + r * 0.6));
      this.rect(Math.round(cx) - w, Math.round(cy) + dy, w * 2 + 1, 1, c);
    }
  }
  oval(cx: number, cy: number, rx: number, ry: number, c: number) {
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + ry * 0.6))));
      this.rect(Math.round(cx) - w, Math.round(cy) + dy, w * 2 + 1, 1, c);
    }
  }
  /** Rodea con `c` todo lo pintado (contorno de 1 px). */
  outline(c: number) {
    const { w, h, d } = this;
    const add: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (d[y * w + x]) continue;
        if ((x > 0 && d[y * w + x - 1]) || (x < w - 1 && d[y * w + x + 1]) || (y > 0 && d[(y - 1) * w + x]) || (y < h - 1 && d[(y + 1) * w + x])) add.push(y * w + x);
      }
    for (const i of add) d[i] = c;
  }
  canvas(): Cv {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    c.getContext('2d')!.putImageData(this.img, 0, 0);
    return c;
  }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** ¿Se pinta este píxel con densidad `k` (0..1)? Tramado ordenado 4×4. */
const tramado = (x: number, y: number, k: number) => BAYER[(y & 3) * 4 + (x & 3)] < k * 16 - 0.01;

const rng = (seed: number) => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    a ^= a >>> 13;
    return (a >>> 0) / 4294967296;
  };
};
const TAU = Math.PI * 2;
const mod = (a: number, n: number) => ((a % n) + n) % n;

/* ── Capas ───────────────────────────────────────────────────────────────── */

const SKY_H = 560;

function capaCielo(a: Ambiente) {
  const st = PAL[a].cielo;
  const colorAt = (el: number): RGB => {
    for (let i = 0; i < st.length - 1; i++) {
      const [e0, c0] = st[i];
      const [e1, c1] = st[i + 1];
      if (el <= e1) return lerp(hex(c0), hex(c1), (el - e0) / (e1 - e0));
    }
    return hex(st[st.length - 1][1]);
  };
  // Bandas de 6 px con una fila tramada de transición: un degradado de consola.
  const W = 64;
  const b = new Buf(W, SKY_H);
  const BAND = 6;
  for (let y = 0; y < SKY_H; y++) {
    const el = SKY_H - 1 - y;
    const i = Math.floor(el / BAND);
    const p = el - i * BAND;
    const here = pack(colorAt(i * BAND + BAND / 2));
    const below = pack(colorAt(Math.max(0, (i - 1) * BAND + BAND / 2)));
    for (let x = 0; x < W; x++) b.d[y * W + x] = p === 0 && (x + y) % 2 === 0 ? below : p === 1 && (x + y) % 4 === 0 ? below : here;
  }
  return { cv: b.canvas(), top: css(colorAt(SKY_H)), bottom: css(colorAt(0)) };
}

function capaEstrellas(a: Ambiente) {
  if (a === 'dia') return null;
  const W = 512;
  const b = new Buf(W, SKY_H);
  const r = rng(77);
  const n = a === 'noche' ? 340 : 40;
  const cols = [pack(hex('#fff6d6')), pack(hex('#ffffff')), pack(hex('#d4ccff')), pack(hex('#ffd6ec'))];
  const tenue = pack(lerp(hex('#fff6d6'), hex('#2c2266'), 0.55));
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * W);
    // Más estrellas arriba; en la tarde solo muy arriba.
    const el = a === 'noche' ? 40 + Math.pow(r(), 0.7) * (SKY_H - 40) : 220 + r() * (SKY_H - 220);
    const y = SKY_H - 1 - Math.floor(el);
    const bright = r();
    if (a === 'tarde') {
      b.px(x, y, pack(lerp(hex('#fff0f6'), hex('#8a70cc'), 0.35 + 0.3 * (1 - el / SKY_H))));
    } else if (bright > 0.93) {
      b.px(x, y, cols[1]);
      b.px(x - 1, y, tenue);
      b.px(x + 1, y, tenue);
      b.px(x, y - 1, tenue);
      b.px(x, y + 1, tenue);
    } else b.px(x, y, el < 140 ? tenue : cols[i % 4]);
  }
  return b.canvas();
}

function capaAurora() {
  // Una cinta ondulada: bandas de color (rosa arriba, menta abajo), vetas
  // verticales suaves en dos tonos, punta tramada y borde brillante.
  const W = 600;
  const H = 120;
  const b = new Buf(W, H);
  const A = ['#c48ad6', '#a2a2de', '#84dcc6', '#b8ffe4'].map((h) => pack(hex(h)));
  const B = ['#d4a0e2', '#b4b8ea', '#9cecd4', '#d4fff0'].map((h) => pack(hex(h)));
  for (let x = 0; x < W; x++) {
    const u = (x / W) * TAU;
    const base = Math.round(96 + 12 * Math.sin(u * 2) + 6 * Math.sin(u * 5 + 1));
    const veta = 0.5 + 0.5 * Math.sin(u * 7) * Math.sin(u * 3 + 1);
    const alto = Math.round(24 + 44 * veta + 5 * Math.sin(u * 41));
    const cs = Math.sin(u * 53) > 0.2 ? B : A;
    for (let y = base - alto; y <= base; y++) {
      const v = (y - (base - alto)) / alto;
      if (!tramado(x, y, Math.min(1, 0.15 + v * 1.6))) continue;
      b.px(x, y, cs[v > 0.93 ? 3 : v > 0.6 ? 2 : v > 0.32 ? 1 : 0]);
    }
  }
  return b.canvas();
}

/** Sol con carita dormida, sol poniente a franjas o luna con cráteres. Con halo tramado. */
function capaAstro(a: Ambiente) {
  const S = a === 'tarde' ? 84 : 72;
  const b = new Buf(S, S);
  const c = S / 2;
  const halo = (r: number, k: number, col: RGB) => {
    const p = pack(col);
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r && tramado(x + c, y + c, k)) b.px(c + x, c + y, p);
  };
  if (a === 'dia') {
    halo(34, 0.25, hex('#fffbe0'));
    halo(26, 0.5, hex('#fff6c4'));
    // Rayitos redondos.
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * TAU;
      b.disc(c + Math.cos(ang) * 19, c + Math.sin(ang) * 19, 2, pack(hex('#ffe070')));
    }
    b.disc(c, c, 14, pack(hex('#ffae3c')));
    b.disc(c, c, 13, pack(hex('#ffe048')));
    b.disc(c - 3, c - 3, 7, pack(hex('#fff0a0')));
    b.rect(c - 7, c - 8, 3, 2, pack(hex('#ffffff')));
    // Carita: ojitos cerrados y mejillas.
    const ojo = pack(hex('#d0782a'));
    for (const s of [-1, 1]) {
      b.rect(c + s * 5 - 1, c + 1, 3, 1, ojo);
      b.px(c + s * 5 - 2, c, ojo);
      b.px(c + s * 5 + 2, c, ojo);
      b.rect(c + s * 7 - 1, c + 4, 3, 1, pack(hex('#ff9a7a')));
    }
    b.rect(c - 1, c + 5, 3, 1, ojo);
  } else if (a === 'tarde') {
    halo(41, 0.22, hex('#ffe0b0'));
    halo(32, 0.45, hex('#ffd6a0'));
    const R = 24;
    for (let y = -R; y <= R; y++) {
      // Franjas que se abren hacia abajo, como un atardecer de los 80.
      const gap = y > 2 && (y - 3) % 5 >= 5 - Math.min(3, Math.floor((y + 2) / 7));
      if (gap) continue;
      const w = Math.round(Math.sqrt(R * R - y * y + R * 0.6));
      const col = pack(lerp(hex('#fff2a4'), hex('#ff7e8c'), (y + R) / (2 * R)));
      b.rect(c - w, c + y, 2 * w + 1, 1, col);
    }
    b.rect(c - 12, c - 17, 5, 2, pack(hex('#fffbe0')));
  } else {
    halo(34, 0.18, hex('#b49ae8'));
    halo(25, 0.4, hex('#c4aef0'));
    b.disc(c, c, 16, pack(hex('#d6c0f2')));
    b.disc(c, c, 15, pack(hex('#fff4d4')));
    // Sombra suave a la derecha.
    for (let y = -15; y <= 15; y++)
      for (let x = 6; x <= 15; x++) if (b.at(c + x, c + y) === pack(hex('#fff4d4')) && x * x + y * y > 9 * 9 + y * 2 && (x + y) % 1 === 0) b.px(c + x, c + y, pack(hex('#f0e0c0')));
    for (const [x, y, r] of [[-5, -4, 3], [4, 5, 2], [-3, 7, 2], [6, -6, 1], [-9, 3, 1]] as const) {
      b.disc(c + x, c + y, r, pack(hex('#eedcb4')));
      b.rect(c + x - r + 1, c + y - r, Math.max(1, r), 1, pack(hex('#e0caa0')));
    }
    b.rect(c - 9, c - 10, 3, 2, pack(hex('#ffffff')));
  }
  return b.canvas();
}

type PalNube = { cuerpo: RGB; luz: RGB; sombra: RGB; tinta: RGB };
const palNube = (a: Ambiente, k: number): PalNube => {
  const n = PAL[a].nube;
  const f = (h: string) => lerp(hex(h), PAL[a].bruma, k);
  return { cuerpo: f(n.cuerpo), luz: f(n.luz), sombra: f(n.sombra), tinta: f(n.tinta) };
};

/** Un cúmulo de base plana: bolas arriba, ribete de sombra abajo y contorno suave. */
function nube(w: number, seed: number, p: PalNube, contorno = true) {
  const h = Math.round(w * 0.5);
  const b = new Buf(w + 4, h + 4);
  const r = rng(seed);
  const piso = h + 1;
  const bolas: [number, number, number][] = [];
  const rb = Math.max(3, Math.round(h * 0.28));
  for (let x = rb + 2; x <= w + 2 - rb; x += Math.max(3, Math.round(rb * 1.1))) bolas.push([x, piso - rb + 1, rb]);
  const n = 2 + Math.floor(w / 40);
  for (let i = 0; i < n; i++) {
    const rr = Math.round(h * (0.26 + r() * 0.16));
    const x = Math.round(2 + w * (0.22 + (0.56 * (i + 0.5)) / n) + (r() - 0.5) * w * 0.08);
    bolas.push([x, piso - rb - rr * 0.55 - r() * h * 0.12, rr]);
  }
  const S = pack(p.sombra);
  const C = pack(p.cuerpo);
  const L = pack(p.luz);
  for (const [x, y, rr] of bolas) b.disc(x, y, rr, S);
  for (const [x, y, rr] of bolas) b.disc(x, y - 2, rr - 1, C);
  for (const [x, y, rr] of bolas) if (rr > 4 && y < piso - rb) b.disc(x - rr * 0.35, y - rr * 0.45, Math.round(rr * 0.4), L);
  // Base plana.
  for (let y = piso + 1; y < b.h; y++) for (let x = 0; x < b.w; x++) b.d[y * b.w + x] = 0;
  for (let x = 0; x < b.w; x++) if (b.d[piso * b.w + x]) b.d[piso * b.w + x] = S;
  if (contorno) b.outline(pack(p.tinta));
  return b.canvas();
}

/** Cirro: una hebra larga y delgada, sin contorno. */
function cirro(w: number, seed: number, p: PalNube) {
  const b = new Buf(w, 8);
  const r = rng(seed);
  b.oval(w / 2, 4, w / 2 - 1, 2, pack(lerp(p.cuerpo, p.sombra, 0.5)));
  b.oval(w / 2 - w * 0.08, 3, Math.round(w * 0.36), 1, pack(p.luz));
  for (let i = 0; i < 3; i++) b.oval(w * (0.2 + r() * 0.6), 5, Math.round(w * 0.12), 1, pack(p.cuerpo));
  return b.canvas();
}

/** Banco de nubes en el horizonte, muy pálido. Base sólida. */
function capaBanco(a: Ambiente) {
  const W = 720;
  const H = 64;
  const b = new Buf(W, H);
  const p = palNube(a, 0.55);
  const r = rng(5);
  const bolas: [number, number, number][] = [];
  for (let x = 0; x < W; x += 14 + Math.floor(r() * 14)) {
    const rr = 10 + Math.floor(r() * 16);
    bolas.push([x, H - 8 - rr * 0.5 - r() * 10, rr]);
  }
  for (const [x, y, rr] of bolas) b.disc(x, y, rr + 1, pack(p.tinta));
  for (const [x, y, rr] of bolas) b.disc(x, y, rr, pack(p.sombra));
  for (const [x, y, rr] of bolas) b.disc(x - 1, y - 2, rr - 2, pack(p.cuerpo));
  b.rect(0, H - 10, W, 10, pack(p.sombra));
  return b.canvas();
}

/** Niebla: sólida abajo, tramada hacia arriba. */
function capaNiebla(a: Ambiente, k: number) {
  const W = 64;
  const H = 28;
  const b = new Buf(W, H);
  const col = pack(lerp(PAL[a].bruma, a === 'noche' ? hex('#9a80c8') : hex('#ffffff'), k));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const e = H - 1 - y;
      const dens = e < 8 ? 1 : Math.max(0, 1 - (e - 8) / 18);
      if (tramado(x, y, dens)) b.d[y * W + x] = col;
    }
  return b.canvas();
}

/** Perfil periódico suave: suma de senos con frecuencias enteras. */
const ondas = (W: number, base: number, terms: [number, number, number][]) => (x: number) => {
  let v = base;
  for (const [amp, f, ph] of terms) v += amp * Math.sin((x / W) * TAU * f + ph);
  return v;
};

/** Un tono más oscuro del mismo color, para contornos. */
function tone(h: string) {
  const c = hex(h);
  return '#' + [c[0] * 0.72, c[1] * 0.62, c[2] * 0.7 + 20].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
}

/** Globo aerostático a gajos, con canastito. */
function globo(a: Ambiente, i: number) {
  const pares = [['#ff9ab4', '#fff2dc', '#c05a7a'], ['#8ee0c0', '#fff6b8', '#4a9e88'], ['#c4a8f4', '#ffffff', '#7a5ab4']][i % 3];
  const b = new Buf(19, 26);
  const k = 0.3;
  const c0 = pack(mat(a, pares[0], k));
  const c1 = pack(mat(a, pares[1], k));
  b.oval(9, 9, 8, 8, c0);
  b.rect(5, 15, 9, 2, c0);
  b.rect(7, 17, 5, 1, c0);
  // Gajos verticales.
  for (let y = 0; y < 18; y++) for (let x = 0; x < 19; x++) if (b.at(x, y) && Math.floor((x - 9) / 2.5 + 20) % 2 === 0) b.d[y * 19 + x] = c1;
  b.outline(pack(mat(a, pares[2], k)));
  const cuerda = pack(mat(a, '#8a5a4a', k));
  b.px(6, 19, cuerda);
  b.px(12, 19, cuerda);
  b.px(7, 20, cuerda);
  b.px(11, 20, cuerda);
  b.rect(7, 21, 5, 3, pack(mat(a, '#8a5232', k)));
  b.rect(8, 21, 3, 2, pack(mat(a, '#d08a50', k)));
  b.disc(7, 5, 1, pack(mat(a, '#ffffff', k + 0.1)));
  return b.canvas();
}

function bocanadas(a: Ambiente) {
  const col = pack(lerp(mat(a, '#f6f2f6', 0.2), PAL[a].bruma, a === 'noche' ? 0.4 : 0));
  return [1, 2, 3].map((r) => {
    const b = new Buf(r * 2 + 3, r * 2 + 3);
    b.disc(r + 1, r + 1, r, col);
    return b.canvas();
  });
}

/* ── Gran altura: mar de nubes, estratosfera y espacio ──────────────────── */

/** Curva suave 0→1 entre `a` y `b`. */
const ss = (a: number, b: number, x: number) => {
  const k = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return k * k * (3 - 2 * k);
};
const P = (h: string) => pack(hex(h));

export type Zona = 'campo' | 'nubes' | 'estratosfera' | 'espacio';

/** Zona del cielo a una altitud (px sobre el suelo). */
export function zonaAltitud(alt: number): Zona {
  return alt < 950 ? 'campo' : alt < 1700 ? 'nubes' : alt < 2300 ? 'estratosfera' : 'espacio';
}

/*
 * The high sky (sea of clouds, stratosphere, space) is laid out in «sky
 * altitude». The game's real altitude maps onto it piecewise, so the low sky
 * lasts much longer: the sea of clouds only rises past ~950, the stratosphere
 * starts at 1700 and space at 2300 (the old layout had them at 500/1300/1900).
 */
const MAPA_CIELO: [number, number][] = [[300, 300], [950, 500], [1700, 1300], [2300, 1900], [2850, 2600]];
function altCielo(alt: number) {
  const m = MAPA_CIELO;
  if (alt <= m[0][0]) return alt;
  for (let i = 1; i < m.length; i++)
    if (alt <= m[i][0]) {
      const [a0, b0] = m[i - 1];
      const [a1, b1] = m[i];
      return b0 + ((alt - a0) * (b1 - b0)) / (a1 - a0);
    }
  return alt - m[m.length - 1][0] + m[m.length - 1][1];
}

const NOMBRES: Record<Zona, string> = {
  campo: 'Cielo del valle',
  nubes: 'Mar de nubes',
  estratosfera: 'Estratosfera',
  espacio: 'Espacio exterior',
};

/** Nombre bonito de una zona (o de la zona de una altitud) para un letrero. */
export type Paisaje = 'valle' | 'oceano' | 'valparaiso';
const CIELO_BAJO: Record<Paisaje, string> = { valle: 'Cielo de San Antonio', oceano: 'Cielo del mar', valparaiso: 'Cielo de Valparaíso' };

export function nombreZona(z: Zona | number, paisaje: Paisaje = 'valle'): string {
  const zona = typeof z === 'number' ? zonaAltitud(z) : z;
  return zona === 'campo' ? CIELO_BAJO[paisaje] : NOMBRES[zona];
}

/* El cielo alto se indexa por altitud real: fila 0 = ALTO_HI. Abajo se funde
 * (tramado) con el cielo de siempre, que va anclado al horizonte. */
const ALTO_LO = 420;
const ALTO_HI = 3600;
const ALTO_H = ALTO_HI - ALTO_LO;
const ALTO_OPACO = 920;

const CIELO_ALTO: Record<Ambiente, [number, string][]> = {
  dia: [[420, '#5ea4f2'], [800, '#4c8eea'], [1150, '#4278de'], [1450, '#4262c8'], [1700, '#454caa'], [1950, '#3a3686'], [2250, '#2c2560'], [2700, '#22194c'], [3600, '#1d1544']],
  tarde: [[420, '#7c66c8'], [700, '#9a6cc2'], [1000, '#8a5eb8'], [1300, '#6e50ac'], [1600, '#513c94'], [1950, '#3a2c72'], [2250, '#2b2158'], [2700, '#22194c'], [3600, '#1d1544']],
  noche: [[420, '#29216a'], [900, '#221c5c'], [1500, '#1f1852'], [2200, '#1e164a'], [3600, '#1d1544']],
};

function capaCieloAlto(a: Ambiente) {
  const st = CIELO_ALTO[a];
  const colorAt = (el: number): RGB => {
    if (el <= st[0][0]) return hex(st[0][1]);
    for (let i = 0; i < st.length - 1; i++) {
      const [e0, c0] = st[i];
      const [e1, c1] = st[i + 1];
      if (el <= e1) return lerp(hex(c0), hex(c1), (el - e0) / (e1 - e0));
    }
    return hex(st[st.length - 1][1]);
  };
  const W = 64;
  const b = new Buf(W, ALTO_H);
  const BAND = 10;
  for (let y = 0; y < ALTO_H; y++) {
    const el = ALTO_HI - y;
    const i = Math.floor(el / BAND);
    const p = el - i * BAND;
    const here = pack(colorAt(i * BAND + BAND / 2));
    const below = pack(colorAt((i - 1) * BAND + BAND / 2));
    const dens = ss(ALTO_LO + 10, ALTO_OPACO, el);
    for (let x = 0; x < W; x++) {
      if (!tramado(x, y, dens)) continue;
      b.d[y * W + x] = p === 0 && (x + y) % 2 === 0 ? below : p === 1 && (x + y) % 4 === 0 ? below : here;
    }
  }
  return { cv: b.canvas(), top: css(colorAt(ALTO_HI)) };
}

/** Mar de nubes visto desde arriba: una fila lejana y otra cercana de lomos esponjosos. */
function capaMar(a: Ambiente) {
  const W = 960;
  const fila = (seed: number, H: number, base: number, r0: number, r1: number, k: number, periodo: number) => {
    const p = palNube(a, k);
    const b = new Buf(W, H);
    const r = rng(seed);
    const S = pack(p.sombra);
    const C = pack(p.cuerpo);
    const L = pack(p.luz);
    const M = pack(lerp(p.cuerpo, p.sombra, 0.5));
    const bolas: [number, number, number][] = [];
    for (let x = 0; x < W - r0; ) {
      const rr = r0 + Math.floor(r() * (r1 - r0));
      bolas.push([x, base - Math.round(rr * (0.25 + r() * 0.55)), rr]);
      x += Math.max(4, Math.round(rr * (1 + r() * 0.7)));
    }
    for (const [x, y, rr] of bolas) b.disc(x, y, rr, S);
    b.rect(0, base, W, H - base, S);
    for (const [x, y, rr] of bolas) b.disc(x - 1, y - 1, rr - 1, C);
    b.rect(0, base + 2, W, H - base - 2, C);
    // Lomos de más cerca, en filas: un pliegue de sombra bajo cada uno.
    for (let fy = base + 6, j = 0; fy < H + 8; fy += periodo / 2, j++) {
      const rr = Math.round(r0 * 0.6);
      const paso = Math.round(W / Math.round(W / (rr * 2.6)));
      for (let x = (j % 2) * Math.round(paso / 2); x < W + paso; x += paso) {
        const dy = (x * 7) % 3;
        const yy = fy + dy;
        b.oval(x, yy, rr + 1, Math.max(1, Math.round(rr * 0.42)), M);
        b.oval(x - 1, yy - 1, rr, Math.max(1, Math.round(rr * 0.42)), C);
        b.rect(x - Math.round(rr * 0.5), yy - Math.round(rr * 0.42), Math.max(1, Math.round(rr * 0.5)), 1, L);
      }
    }
    for (const [x, y, rr] of bolas) if (rr > 5) b.disc(x - rr * 0.35 - 1, y - rr * 0.4 - 1, Math.max(1, Math.round(rr * 0.38)), L);
    // Solo el borde de arriba lleva contorno (el resto está lleno).
    b.outline(pack(p.tinta));
    return b.canvas();
  };
  const PER = 24;
  return {
    lejos: fila(93, 34, 18, 5, 11, 0.38, PER),
    cerca: fila(91, 30 + PER * 2, 30, 10, 21, 0.1, PER),
    base: 30,
    periodo: PER,
  };
}

/** Cirro alto, largo y deshilachado. */
function capaCirrosAltos(a: Ambiente) {
  const p = palNube(a, 0.3);
  const luz = pack(p.luz);
  const cuerpo = pack(lerp(p.cuerpo, p.sombra, 0.4));
  // Hebras finas que se deshilachan en tramado, con una colita curva.
  return [130, 170, 96, 150].map((w, i) => {
    const b = new Buf(w, 12);
    const r = rng(300 + i);
    for (let j = 0; j < 4; j++) {
      const x0 = Math.round(r() * w * 0.3);
      const x1 = Math.round(w * (0.6 + r() * 0.4)) - 1;
      const y = 3 + j * 2 + Math.round(r());
      const col = j % 2 ? cuerpo : luz;
      for (let x = x0; x <= x1; x++) {
        const k = Math.min(1, (x - x0) / 14, (x1 - x) / 22);
        const yy = y - Math.round(Math.sin((x / w) * Math.PI * 2 + j) * 0.8);
        if (tramado(x, yy, k * (j % 2 ? 0.7 : 1))) b.px(x, yy, col);
      }
      if (j % 2 === 0) {
        b.px(x1 + 1, y - 1, luz);
        b.px(x1 + 2, y - 2, luz);
      }
    }
    return b.canvas();
  });
}

type PalTierra = { glow: [string, string]; limbo: string; atm: string; mar: string[]; nube: string; nubeS: string; tierra: [string, string]; luces: string | null };
const TIERRA: Record<Ambiente, PalTierra> = {
  dia: { glow: ['#7cb4f0', '#b4e4ff'], limbo: '#f4fcff', atm: '#9ad8ff', mar: ['#78b4f2', '#6aa2ea', '#5c8ede', '#507ccc'], nube: '#f6fbff', nubeS: '#cfe0f6', tierra: ['#a2dcaa', '#8ccc9c'], luces: null },
  tarde: { glow: ['#c87ab8', '#ffc0b8'], limbo: '#fff0dc', atm: '#ffaabc', mar: ['#a088dc', '#8a76ce', '#7466be', '#6258ac'], nube: '#ffe6ee', nubeS: '#e6b8d6', tierra: ['#d0b4d4', '#bca2c8'], luces: '#ffe08a' },
  noche: { glow: ['#4e44a0', '#8a7ce0'], limbo: '#d4c8ff', atm: '#7c6cd4', mar: ['#423e9c', '#3a368e', '#322e80', '#2c2872'], nube: '#6c68b6', nubeS: '#55519e', tierra: ['#45508e', '#3e4884'], luces: '#ffd870' },
};

/** La Tierra vista desde arriba: un arco con atmósfera brillante, nubes y continentes. */
function capaTierra(a: Ambiente, y0: number, y1: number, b: Buf) {
  const W = b.w;
  const R = TIERRA_R;
  const ap = TIERRA_AP;
  const cx = W / 2;
  const pt = TIERRA[a];
  const g0 = P(pt.glow[0]);
  const g1 = P(pt.glow[1]);
  const limbo = P(pt.limbo);
  const atm = P(pt.atm);
  const mar = pt.mar.map(P);
  const nb = P(pt.nube);
  const nbS = P(pt.nubeS);
  const tie = pt.tierra.map(P);
  const luz = pt.luces ? P(pt.luces) : 0;
  const TH = [26, 62, 112];
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - (ap + R);
      const h = R - Math.sqrt(dx * dx + dy * dy);
      if (h < -20) continue;
      let c = 0;
      if (h < 0) {
        const k = 1 + h / 20;
        if (tramado(x, y, k * k * 0.9)) c = k > 0.6 ? g1 : g0;
      } else if (h < 2) c = limbo;
      else if (h < 7) c = h < 3 && (x + y) % 2 ? limbo : atm;
      else {
        let i = 0;
        for (let j = 0; j < 3; j++) {
          const th = TH[j];
          if (h > th + 5) i = j + 1;
          else if (h > th - 5 && tramado(x, y, (h - th + 5) / 10)) i = j + 1;
        }
        c = mar[i];
        const s = Math.sqrt(h - 7) * 9;
        const u = dx;
        const lt = Math.sin(u * 0.006 + 1) + Math.sin(u * 0.0115 + s * 0.028 + 2) + 0.5 * Math.sin(s * 0.05 - u * 0.004);
        if (lt > 1.3) {
          c = tie[lt > 1.62 ? 1 : 0];
          if (luz && ((x * 73856093) ^ (y * 19349663)) % 37 === 0) c = luz;
        }
        const f = Math.sin(u * 0.031 + Math.sin(s * 0.09) * 2) + Math.sin(u * 0.013 - s * 0.05 + 1.3) + 0.6 * Math.sin(u * 0.07 + s * 0.11);
        if (f > 1.25) c = f > 1.55 || h < 14 ? nb : nbS;
        else if (f > 1.0 && tramado(x, y, (f - 1.0) / 0.25)) c = nbS;
      }
      if (c) b.d[y * W + x] = c;
    }
}

/** Campo de estrellas que se repite en x e y. `capa` 0 = lejos, 2 = cerca. */
function campoEstrellas(capa: number) {
  const T = 256;
  const b = new Buf(T, T);
  const r = rng(500 + capa);
  if (capa === 0) {
    const cs = ['#4c4690', '#5e589e', '#6e66aa', '#5a5ca8'].map(P);
    for (let i = 0; i < 190; i++) b.px(r() * T, r() * T, cs[i % 4]);
  } else if (capa === 1) {
    const cs = ['#a49ad8', '#d8d0f4', '#f4c8e2', '#bfe4f4', '#fff0c8'].map(P);
    for (let i = 0; i < 70; i++) b.px(r() * T, r() * T, cs[i % 5]);
  } else {
    const c = P('#ffffff');
    const t = P('#9a8ed8');
    const cs = ['#fff6d6', '#ffd6ec', '#d4f4ff'].map(P);
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(r() * (T - 6)) + 3;
      const y = Math.floor(r() * (T - 6)) + 3;
      if (i % 3 === 0) {
        b.px(x, y, c);
        b.px(x - 1, y, t);
        b.px(x + 1, y, t);
        b.px(x, y - 1, t);
        b.px(x, y + 1, t);
      } else b.rect(x, y, i % 2 ? 2 : 1, i % 2 ? 1 : 2, cs[i % 3]);
    }
  }
  return b.canvas();
}

/** Nebulosa pastel tramada: nubes de gas en tres densidades y un corazón. */
function nebulosa(seed: number, cols: string[], W = 230, H = 136) {
  const b = new Buf(W, H);
  const r = rng(seed);
  const blobs = Array.from({ length: 8 }, () => ({ x: W * (0.18 + 0.64 * r()), y: H * (0.3 + 0.4 * r()), sx: 18 + 34 * r(), sy: 10 + 18 * r(), k: 0.45 + 0.55 * r() }));
  const cs = cols.map(P);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let d = 0;
      for (const o of blobs) {
        const u = (x - o.x) / o.sx;
        const v = (y - o.y) / o.sy;
        d += o.k * Math.exp(-(u * u + v * v));
      }
      d *= 0.78 + 0.22 * Math.sin(x * 0.11 + Math.sin(y * 0.08) * 2.4) * Math.sin(y * 0.15 - x * 0.03);
      let c = 0;
      if (d > 1.15) c = tramado(x, y, (d - 1.15) / 0.3) ? cs[3] : cs[2];
      else if (d > 0.75) c = tramado(x, y, (d - 0.75) / 0.25) ? cs[2] : cs[1];
      else if (d > 0.42) c = tramado(x, y, (d - 0.42) / 0.2) ? cs[1] : cs[0];
      else if (d > 0.16) c = tramado(x, y, ((d - 0.16) / 0.26) * 0.75) ? cs[0] : 0;
      if (c) b.d[y * W + x] = c;
    }
  const est = P('#fffaf0');
  for (let i = 0; i < 7; i++) b.px(W * (0.2 + 0.6 * r()), H * (0.25 + 0.5 * r()), est);
  return b.canvas();
}

/** Galaxia espiral inclinada, de dos brazos. */
function galaxia() {
  const W = 112;
  const H = 64;
  const b = new Buf(W, H);
  const cs = ['#3e3480', '#6450b0', '#9c84e0', '#e8b8e4', '#fff4e0'].map(P);
  const ang = -0.38;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - W / 2 + 0.5;
      const dy = y - H / 2 + 0.5;
      const gx = dx * ca + dy * sa;
      const gy = (-dx * sa + dy * ca) / 0.4;
      const rr = Math.sqrt(gx * gx + gy * gy);
      if (rr > 54) continue;
      const th = Math.atan2(gy, gx);
      const arm = 0.5 + 0.5 * Math.cos(2 * th - 3.4 * Math.log(rr + 1.5));
      const d = Math.exp(-rr / 17) * (0.15 + 1.1 * arm * arm * arm) + 1.3 * Math.exp(-(rr * rr) / 30);
      let c = -1;
      if (d > 1.0) c = tramado(x, y, (d - 1) / 0.25) ? 4 : 3;
      else if (d > 0.55) c = tramado(x, y, (d - 0.55) / 0.45) ? 3 : 2;
      else if (d > 0.3) c = tramado(x, y, (d - 0.3) / 0.25) ? 2 : 1;
      else if (d > 0.12) c = tramado(x, y, (d - 0.12) / 0.18) ? 1 : tramado(x, y, 0.35) ? 0 : -1;
      if (c >= 0) b.d[y * W + x] = cs[c];
    }
  return b.canvas();
}

/** Planeta durazno con anillos lila. */
function planeta() {
  const W = 76;
  const H = 46;
  const b = new Buf(W, H);
  const cx = 38;
  const cy = 23;
  const R = 14;
  const ang = -0.22;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const anillo = (frente: boolean) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const u = dx * ca + dy * sa;
        const v = -dx * sa + dy * ca;
        const q = Math.sqrt((u / 34) ** 2 + (v / 8.5) ** 2);
        if (q < 0.6 || q > 1) continue;
        if ((v > 0) !== frente) continue;
        if (frente === false && dx * dx + dy * dy <= R * R) continue;
        b.d[y * W + x] = q > 0.9 ? P('#b8a4ec') : q > 0.8 ? P('#e4d8ff') : q > 0.74 ? P('#8e7ccc') : P('#cbbcf6');
      }
  };
  anillo(false);
  b.disc(cx, cy, R + 1, P('#a8689a'));
  b.disc(cx, cy, R, P('#f6b8a0'));
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      if (b.at(cx + x, cy + y) !== P('#f6b8a0')) continue;
      const band = (y + 40) % 7;
      let c = band < 2 ? P('#ffd6b6') : band === 4 ? P('#e8a2a0') : 0;
      if (x * 0.8 + y * 0.6 > 6 && tramado(x + 40, y + 40, Math.min(1, (x * 0.8 + y * 0.6 - 6) / 6))) c = P('#d090b0');
      if (c) b.px(cx + x, cy + y, c);
    }
  b.rect(cx - 8, cy - 9, 3, 2, P('#fff0e0'));
  anillo(true);
  return b.canvas();
}

/** A small far planet: a teal ice world with a thin halo and a tiny moon. */
function planetaHielo() {
  const S = 44;
  const b = new Buf(S, S);
  const c = 20;
  const R = 11;
  for (let y = -R - 5; y <= R + 5; y++)
    for (let x = -R - 5; x <= R + 5; x++) if (x * x + y * y <= (R + 5) ** 2 && tramado(c + x, c + y, 0.18)) b.px(c + x, c + y, P('#4a6aa8'));
  b.disc(c, c, R + 1, P('#3a7a9a'));
  b.disc(c, c, R, P('#8ae0e0'));
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      if (x * x + y * y > R * R) continue;
      if ((y + 30) % 6 === 0 && Math.abs(x) < R - 2) b.px(c + x, c + y, P('#c4f6f0'));
      if (x * 0.7 + y * 0.7 > 3 && tramado(c + x, c + y, Math.min(1, (x * 0.7 + y * 0.7 - 3) / 6))) b.px(c + x, c + y, P('#4a9ab8'));
    }
  b.rect(c - 6, c - 7, 3, 2, P('#ffffff'));
  b.disc(c + 17, c - 12, 2, P('#d8d0e8'));
  b.px(c + 16, c - 13, P('#ffffff'));
  return b.canvas();
}

/** Luna grande con cráteres, fase gibosa tramada y carita dormida. */
function lunaGrande() {
  const S = 92;
  const b = new Buf(S, S);
  const c = S / 2;
  const R = 30;
  for (const [rr, k, h] of [[44, 0.14, '#3c3488'], [38, 0.26, '#564aa6'], [34, 0.4, '#7a6cc4']] as const)
    for (let y = -rr; y <= rr; y++)
      for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr && tramado(x + c, y + c, k)) b.px(c + x, c + y, P(h));
  b.disc(c, c, R + 1, P('#c8b0e4'));
  b.disc(c, c, R, P('#fff4dc'));
  const cuerpo = P('#fff4dc');
  for (const [x, y, r] of [[-12, -10, 6], [10, -14, 4], [-16, 8, 4], [6, 13, 5], [16, 0, 3], [-3, -19, 2], [19, 12, 2], [-20, -2, 2]] as const) {
    b.disc(c + x, c + y, r, P('#ecdcbc'));
    b.disc(c + x + 1, c + y + 1, Math.max(1, r - 1), P('#f6e8cc'));
    b.rect(c + x - r + 1, c + y - r, Math.max(1, r), 1, P('#dcc6a4'));
  }
  // Sombra de fase a la derecha, con borde tramado.
  for (let y = -R; y <= R; y++) {
    const w = Math.sqrt(R * R - y * y);
    for (let x = -R; x <= R; x++) {
      if (b.at(c + x, c + y) === 0 || x * x + y * y > R * R) continue;
      const e = x - w * 0.42;
      if (e > 3 || (e > -3 && tramado(c + x, c + y, (e + 3) / 6))) b.px(c + x, c + y, P('#d2bee6'));
    }
  }
  void cuerpo;
  // Carita.
  const ojo = P('#a6889a');
  for (const s of [-1, 1]) {
    b.rect(c + s * 7 - 2, c + 2, 4, 1, ojo);
    b.px(c + s * 7 - 3, c + 1, ojo);
    b.px(c + s * 7 + 2, c + 1, ojo);
    b.rect(c + s * 10 - 2, c + 6, 4, 2, P('#ffc4c8'));
  }
  b.rect(c - 1, c + 7, 3, 1, ojo);
  b.rect(c - 18, c - 20, 4, 2, P('#ffffff'));
  b.rect(c - 20, c - 17, 2, 3, P('#ffffff'));
  return b.canvas();
}

/** Sol de gran altura: más grande, halo amplio y núcleo casi blanco. */
function solAlto() {
  const S = 104;
  const b = new Buf(S, S);
  const c = S / 2;
  for (const [rr, k, h] of [[50, 0.14, '#fff8dc'], [42, 0.28, '#fffae4'], [33, 0.5, '#fffcec']] as const)
    for (let y = -rr; y <= rr; y++)
      for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr && tramado(x + c, y + c, k)) b.px(c + x, c + y, P(h));
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU;
    b.disc(c + Math.cos(ang) * 25, c + Math.sin(ang) * 25, i % 2 ? 2 : 3, P('#ffe888'));
  }
  b.disc(c, c, 18, P('#ffb848'));
  b.disc(c, c, 17, P('#fff09a'));
  b.disc(c - 2, c - 2, 12, P('#fffad8'));
  b.rect(c - 9, c - 10, 4, 2, P('#ffffff'));
  const ojo = P('#d08a3a');
  for (const s of [-1, 1]) {
    b.rect(c + s * 6 - 1, c + 2, 3, 1, ojo);
    b.px(c + s * 6 - 2, c + 1, ojo);
    b.px(c + s * 6 + 2, c + 1, ojo);
    b.rect(c + s * 9 - 1, c + 5, 3, 1, P('#ffa088'));
  }
  b.rect(c - 1, c + 6, 3, 1, ojo);
  return b.canvas();
}

/** Platillo volador con cúpula y un marcianito; las luces se pintan por cuadro. */
function ovni(chico: boolean) {
  if (chico) {
    const b = new Buf(15, 9);
    b.disc(7, 3, 2, P('#9ef0dc'));
    b.oval(7, 5, 6, 1, P('#c8c2ec'));
    b.rect(2, 6, 11, 1, P('#8e88c0'));
    b.outline(P('#5a5296'));
    return b.canvas();
  }
  const b = new Buf(32, 19);
  // Cúpula.
  for (let y = -6; y <= 0; y++) {
    const w = Math.round(Math.sqrt(36 - y * y + 3));
    b.rect(16 - w, 9 + y, w * 2 + 1, 1, P('#a6eedc'));
  }
  b.rect(14, 6, 4, 3, P('#94e08a'));
  b.rect(15, 5, 2, 1, P('#94e08a'));
  b.px(14, 7, P('#2e3a5a'));
  b.px(17, 7, P('#2e3a5a'));
  b.rect(12, 4, 2, 2, P('#eafffa'));
  b.px(11, 6, P('#eafffa'));
  // Platillo.
  b.oval(16, 12, 14, 3, P('#d6d2f2'));
  b.rect(4, 11, 25, 1, P('#f6f4ff'));
  b.rect(4, 13, 25, 2, P('#a8a2d4'));
  b.oval(16, 15, 6, 1, P('#8a84bc'));
  b.outline(P('#625a9c'));
  return b.canvas();
}

/** Rayo del ovni: un cono tramado de luz menta. */
function rayo() {
  const W = 46;
  const H = 64;
  const b = new Buf(W, H);
  const c1 = P('#d4ffee');
  const c0 = P('#9ef0d8');
  for (let y = 0; y < H; y++) {
    const w = 4 + (y / H) * 18;
    const k = 0.75 * (1 - y / H) + 0.1;
    for (let x = Math.round(W / 2 - w); x <= Math.round(W / 2 + w); x++) {
      const borde = Math.abs(x - W / 2) > w - 2;
      if (tramado(x, y, borde ? k * 1.2 : k)) b.px(x, y, borde || (y + x) % 9 < 2 ? c1 : c0);
    }
  }
  return b.canvas();
}

function satelite() {
  const b = new Buf(24, 11);
  const panel = P('#7ea8f0');
  const reja = P('#4c68b8');
  for (const x0 of [1, 15]) {
    b.rect(x0, 3, 8, 5, reja);
    for (let y = 4; y < 7; y++) for (let x = x0 + 1; x < x0 + 7; x++) if (x % 2 === 0 || y === 5) b.px(x, y, panel);
  }
  b.rect(9, 5, 6, 1, P('#a8a0c8'));
  b.rect(10, 3, 4, 5, P('#ffd68a'));
  b.rect(10, 6, 4, 2, P('#d8a050'));
  b.rect(11, 1, 1, 2, P('#c8c0e0'));
  b.px(11, 0, P('#ffffff'));
  return b.canvas();
}

/** Cometa: cabeza brillante y dos colas pastel que se deshacen en tramado. */
function cometa() {
  const W = 96;
  const H = 22;
  const b = new Buf(W, H);
  const menta = P('#a6f2dc');
  const rosa = P('#ffb4d6');
  const lila = P('#d6c8ff');
  for (let x = 8; x < W; x++) {
    const k = (x - 8) / (W - 8);
    const yc = 11 - k * 9;
    const w = 1 + k * 4;
    for (let y = Math.round(yc - w); y <= Math.round(yc + w); y++) {
      const dens = (1 - k) * (1 - Math.abs(y - yc) / (w + 1)) * 1.3;
      if (tramado(x, y, dens)) b.px(x, y, y < yc - 1 ? menta : y > yc + 1 ? rosa : lila);
    }
  }
  b.disc(6, 11, 4, P('#bff4ff'));
  b.disc(6, 11, 3, P('#f4fdff'));
  b.rect(5, 10, 2, 2, P('#ffffff'));
  return b.canvas();
}

/** Avión de pasajeros lejano (mira a la derecha) y su estela de condensación. */
function avionLejano() {
  const b = new Buf(34, 12);
  b.rect(4, 5, 26, 4, P('#ffffff'));
  b.rect(29, 6, 3, 3, P('#ffffff'));
  b.px(32, 7, P('#ffffff'));
  for (let x = 8; x < 28; x += 2) b.px(x, 6, P('#8cc4f0'));
  b.rect(29, 6, 2, 1, P('#6aa4e0'));
  b.rect(3, 1, 4, 4, P('#ff9ab4'));
  b.rect(2, 1, 2, 2, P('#ff9ab4'));
  b.rect(1, 6, 4, 1, P('#ff9ab4'));
  b.rect(13, 9, 9, 1, P('#d6dcf0'));
  b.rect(15, 10, 6, 1, P('#d6dcf0'));
  b.rect(17, 8, 3, 2, P('#c0c8e4'));
  b.rect(4, 8, 26, 1, P('#e4e8f6'));
  b.outline(P('#8a96c8'));
  const e = new Buf(170, 4);
  const blanco = P('#ffffff');
  for (let x = 0; x < 170; x++) {
    const k = x / 170;
    for (let y = 0; y < 4; y++) {
      const borde = y === 0 || y === 3;
      if (tramado(x, y, borde ? k * k * 0.5 : k * 0.95)) e.px(x, y, blanco);
    }
  }
  return { avion: b.canvas(), estela: e.canvas() };
}

/* ── Escenario fijo (posiciones de nubes, globos, estrellas) ─────────────── */

const NUBE_W = 2600;
type Nube = { x: number; el: number; i: number; v: number };
const mkNubes = (seed: number, n: number, el0: number, el1: number, sprites: number, v: number): Nube[] => {
  const r = rng(seed);
  return Array.from({ length: n }, (_, j) => ({ x: ((j + r() * 0.7) * NUBE_W) / n, el: el0 + r() * (el1 - el0), i: j % sprites, v: v * (0.7 + r() * 0.6) }));
};
const NUBES_LEJOS = mkNubes(3, 12, 70, 300, 6, 1.5);
const NUBES_MEDIO = mkNubes(9, 9, 110, 330, 5, 3);
const NUBES_CERCA = mkNubes(17, 5, 150, 320, 4, 5);
const CIRROS = mkNubes(29, 10, 170, 360, 4, 2);
const TITILA: { x: number; el: number; f: number }[] = (() => {
  const r = rng(55);
  return Array.from({ length: 18 }, () => ({ x: r() * 1, el: 110 + r() * 420, f: r() * 10 }));
})();
const LUCIERNAGAS: { x: number; e: number; f: number }[] = (() => {
  const r = rng(66);
  return Array.from({ length: 22 }, () => ({ x: r() * 1, e: 4 + r() * 30, f: r() * 10 }));
})();
/** Cirros altos: `el` es la altitud de cámara a la que pasan por el centro. */
const CIRROS_ALTOS = mkNubes(41, 9, 620, 1650, 4, 1.2);
const TITILA_ALTA: { x: number; y: number; f: number; c: number }[] = (() => {
  const r = rng(57);
  return Array.from({ length: 26 }, () => ({ x: r(), y: r(), f: r() * 10, c: Math.floor(r() * 4) }));
})();
const COLOR_TITILA = ['#ffffff', '#fff0c4', '#ffd6ec', '#d4f4ff'];
const LUCES_OVNI = ['#ff9ac8', '#fff09a', '#9ef0d8', '#c8b4ff'];
const OVNIS_LEJOS: { x: number; y: number; f: number }[] = [
  { x: 380, y: 0.42, f: 0 },
  { x: 1150, y: 0.2, f: 2.1 },
];
/** Nebulosas y galaxia: [sprite, x en el mundo, paralaje x, fila (fracción de vh), altitud ancla, paralaje y]. */
const DECOR: [number, number, number, number, number, number][] = [
  [0, 260, 0.03, 0.34, 2300, 0.08],
  [1, 920, 0.03, 0.56, 2650, 0.08],
  [2, 1330, 0.03, 0.3, 2050, 0.08],
  [3, 640, 0.05, 0.24, 2450, 0.12],
];

/* ── Caché ──────────────────────────────────────────────────────────────── */

type Capas = {
  cielo: { cv: Cv; top: string; bottom: string };
  estrellas: Cv | null;
  aurora: Cv | null;
  astro: Cv;
  banco: Cv;
  niebla1: Cv;
  lejos: Cv[];
  medio: Cv[];
  cerca: Cv[];
  cirros: Cv[];
  globos: Cv[];
  humo: Cv[];
  pajaro: string | null;
};

/** Capas de gran altura que dependen del ambiente. */
type Alto = {
  cielo: { cv: Cv; top: string };
  mar: ReturnType<typeof capaMar> & { fondo: string };
  cirros: Cv[];
  tierraBuf?: Buf;
  tierra: { cv: Cv; fondo: string };
};

/** Capas del espacio, iguales en todos los ambientes. */
type Espacio = {
  estrellas: Cv[];
  deco: Cv[];
  planeta: Cv;
  luna: Cv;
  sol: Cv;
  ovni: Cv;
  ovniChico: Cv;
  rayo: Cv;
  satelite: Cv;
  cometa: Cv;
  avion: Cv;
  estela: Cv;
  aurora: Cv;
  hielo: Cv;
};

type Tarea<T> = (c: Partial<T>) => void;

const tareas = (a: Ambiente): Tarea<Capas>[] => [
  (c) => (c.cielo = capaCielo(a)),
  (c) => (c.estrellas = capaEstrellas(a)),
  (c) => (c.aurora = a === 'noche' ? capaAurora() : null),
  (c) => (c.astro = capaAstro(a)),
  (c) => (c.banco = capaBanco(a)),
  (c) => ((c.niebla1 = capaNiebla(a, 0.3)), (c.humo = bocanadas(a))),
  (c) => {
    const pl = palNube(a, 0.5);
    c.lejos = [34, 44, 52, 60, 40, 70].map((w, i) => nube(w, 40 + i, pl));
    const pc = palNube(a, 0.35);
    c.cirros = [70, 96, 120, 84].map((w, i) => cirro(w, 80 + i, pc));
  },
  (c) => {
    const pm = palNube(a, 0.22);
    c.medio = [64, 80, 96, 72, 110].map((w, i) => nube(w, 50 + i, pm));
  },
  (c) => {
    const pn = palNube(a, 0.06);
    c.cerca = [96, 120, 108, 132].map((w, i) => nube(w, 60 + i, pn));
    c.globos = [0, 1, 2].map((i) => globo(a, i));
    c.pajaro = PAL[a].pajaro;
  },
];

/* The Earth is wide and tall enough that, on screens up to ~2800 px, its
 * bottom row is solid planet edge to edge: the flat fill under it never shows
 * a corner of space (that was the "cut" high up). */
const TIERRA_W = 2880;
const TIERRA_H = 380;
const TIERRA_AP = 22;
const TIERRA_R = 3600;
const TIERRA_PASO = 38;

const tareasAlto = (a: Ambiente): Tarea<Alto>[] => [
  (c) => (c.cielo = capaCieloAlto(a)),
  (c) => (c.mar = { ...capaMar(a), fondo: css(palNube(a, 0.1).cuerpo) }),
  (c) => (c.cirros = capaCirrosAltos(a)),
  // Painted in bands of rows, a few ms each.
  ...Array.from({ length: Math.ceil(TIERRA_H / TIERRA_PASO) }, (_, i): Tarea<Alto> => (c) => {
    if (i === 0) c.tierraBuf = new Buf(TIERRA_W, TIERRA_H);
    capaTierra(a, i * TIERRA_PASO, Math.min(TIERRA_H, (i + 1) * TIERRA_PASO), c.tierraBuf!);
    if ((i + 1) * TIERRA_PASO >= TIERRA_H) {
      c.tierra = { cv: c.tierraBuf!.canvas(), fondo: TIERRA[a].mar[3] };
      c.tierraBuf = undefined;
    }
  }),
];

const tareasEspacio = (): Tarea<Espacio>[] => [
  (c) => (c.estrellas = [0, 1, 2].map(campoEstrellas)),
  (c) => (c.deco = [nebulosa(611, ['#3c2c74', '#6a428e', '#b46aa8', '#f2a6c8'])]),
  (c) => c.deco!.push(nebulosa(612, ['#21305e', '#2e5a7a', '#4e9a98', '#9ae6c8'])),
  (c) => c.deco!.push(nebulosa(613, ['#2e2870', '#4c4296', '#7c6cc8', '#c4b0f0'], 200, 120)),
  (c) => c.deco!.push(galaxia()),
  (c) => ((c.planeta = planeta()), (c.luna = lunaGrande()), (c.sol = solAlto())),
  (c) => {
    c.ovni = ovni(false);
    c.ovniChico = ovni(true);
    c.rayo = rayo();
    c.satelite = satelite();
    c.cometa = cometa();
    const av = avionLejano();
    c.avion = av.avion;
    c.estela = av.estela;
  },
  (c) => ((c.aurora = capaAurora()), (c.hielo = planetaHielo())),
];

/** Una lista de tareas de pintura que se hace de a una. */
class Obra<T> {
  private c: Partial<T> = {};
  private n = 0;
  hecho: T | null = null;
  constructor(private readonly ts: Tarea<T>[]) {}
  paso(): boolean {
    if (this.hecho) return false;
    this.ts[this.n++](this.c);
    if (this.n >= this.ts.length) this.hecho = this.c as T;
    return true;
  }
  todo(): T {
    while (!this.hecho) this.paso();
    return this.hecho;
  }
}

/* ── The sea: the Chilean coast on the horizon, sailboats and bands of water ── */

const COSTA_W = 1800;
const COSTA_H = 100;

/** A tiny pixel font for signs: only the letters we need. */
const LETRAS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '–': ['..', '..', '##', '..', '..'],
  '-': ['..', '..', '##', '..', '..'],
  '.': ['.', '.', '.', '.', '#'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['#', '#', '#', '#', '#'],
  Í: ['#', '#', '#', '#', '#'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '.#.', '.#.'],
  Ó: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  Ñ: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  É: ['###', '#..', '##.', '#..', '###'],
  Á: ['.#.', '#.#', '###', '#.#', '#.#'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#', '##', '.#', '.#', '.#'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '→': ['....', '..#.', '####', '..#.', '....'],
  ' ': ['..', '..', '..', '..', '..'],
};
/** Letters that carry an acute accent above them. */
const ACENTO = 'ÍÓÉÁ';
const anchoTexto = (s: string) => [...s].reduce((w, ch) => w + (LETRAS[ch] ?? LETRAS[' '])[0].length + 1, -1);

/** Writes `s` with its top-left at (x, y), with a 1 px drop shadow. */
function letrero(b: Buf, s: string, x: number, y: number, col: number, sombra: number) {
  for (const ch of s) {
    const gl = LETRAS[ch] ?? LETRAS[' '];
    for (const [dx, c] of [[1, sombra], [0, col]] as const)
      gl.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '#') b.px(x + i + dx, y + j + dx, c);
      });
    if (ACENTO.includes(ch)) {
      const ax = x + Math.floor(gl[0].length / 2);
      b.px(ax, y - 2, col);
      b.px(ax + 1, y - 3, col);
    }
    if (ch === 'Ñ') for (let i = 0; i < 4; i++) b.px(x + i, y - 2 - (i % 2), col);
    x += gl[0].length + 1;
  }
}

/** Same pixel font on a canvas, for signs painted into other strips. Returns the width. */
export function escribir(g: Ctx, s: string, x: number, y: number, col: string, sombra?: string) {
  const x0 = x;
  for (const ch of s) {
    const gl = LETRAS[ch] ?? LETRAS[' '];
    for (const [dx, c] of sombra ? ([[1, sombra], [0, col]] as const) : ([[0, col]] as const)) {
      g.fillStyle = c;
      gl.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(x + i + dx, y + j + dx, 1, 1);
      });
      if (ACENTO.includes(ch)) {
        const ax = x + Math.floor(gl[0].length / 2);
        g.fillRect(ax + dx, y - 2 + dx, 1, 1);
        g.fillRect(ax + 1 + dx, y - 3 + dx, 1, 1);
      }
      if (ch === 'Ñ') for (let i = 0; i < 4; i++) g.fillRect(x + i + dx, y - 2 - (i % 2) + dx, 1, 1);
    }
    x += gl[0].length + 1;
  }
  return x - x0 - 1;
}
export const anchoLetrero = (s: string) => anchoTexto(s);

/** Fills a hill profile (`prof` = height above the bottom row) with a light rim and ink edge. */
function loma(b: Buf, prof: (x: number) => number, cuerpo: number, luz: number, tinta: number) {
  const { w: W, h: H } = b;
  for (let x = 0; x < W; x++) {
    const top = Math.round(H - prof(x));
    const nx = Math.round(H - prof(x + 1));
    for (let y = Math.max(0, top); y < H; y++) b.d[y * W + x] = cuerpo;
    b.px(x, top + 1, luz);
    for (let y = Math.min(top, nx); y <= Math.max(top, nx) - (nx > top ? 1 : 0); y++) b.px(x, y, tinta);
    b.px(x, top, tinta);
  }
}

/** Pastel walls for houses: corrugated zinc in every color, like the hills of Valparaíso. */
const MUROS_CASA = ['#f4a7b9', '#ffd27f', '#8fd3c8', '#9ec5e8', '#c9a7e0', '#f6b38e', '#b5d99c', '#e86a5c', '#fff6e5', '#ff8ac0'];
const TECHOS_CASA = ['#e86a5c', '#9a8aa8', '#5aa8a0', '#7a8ab0', '#d8a050'];

type Pinta = (h: string, kk?: number) => number;
type Ventana = () => number;

/** A small house standing on row `yb` (the row under its floor): wall, tin roof, windows. */
function casa(b: Buf, m: Pinta, x: number, yb: number, w: number, h: number, muro: string, techo: string, ventana: Ventana) {
  const y0 = yb - h;
  b.rect(x, y0, w, h, m(muro));
  b.rect(x + w - 1, y0 + 1, 1, h - 1, m(tone(muro)));
  b.rect(x - 1, y0 - 1, w + 2, 1, m(techo));
  b.rect(x, y0, w, 1, m(techo));
  for (let wx = x + 1; wx < x + w - 1; wx += 3) for (let wy = y0 + 2; wy < yb - 1; wy += 3) b.px(wx, wy, ventana());
}

/** The window pixel color for an ambiente: lit at dusk and night (fraction `frac`), else glass. */
function ventanas(a: Ambiente, m: Pinta, r: () => number, extra = 0): Ventana {
  const lit = PAL[a].ventana;
  const luz = lit ? pack(hex(lit)) : 0;
  const frac = Math.min(1, PAL[a].ventanaLuz + extra);
  const vidrio = m('#8ccaf8');
  return () => (lit && r() < frac ? luz : vidrio);
}

/** Corrugated containers: a stack of `n` at (x, yb) with ribs and a lighter top. */
function contenedores(b: Buf, a: Ambiente, k: number, r: () => number, x: number, yb: number, n: number) {
  const CONT = ['#ef6a6a', '#5a9ae0', '#4cc4a0', '#f4c040', '#f08ac0', '#a07ae0', '#ff9a50'];
  for (let j = 0; j < n; j++) {
    const c = mat(a, CONT[Math.floor(r() * CONT.length)], k);
    const y = yb - 4 * (j + 1);
    b.rect(x, y, 7, 4, pack(c));
    b.rect(x, y, 7, 1, pack(lerp(c, [255, 255, 255], 0.35)));
    b.px(x + 2, y + 2, pack(lerp(c, [40, 30, 80], 0.3)));
    b.px(x + 4, y + 2, pack(lerp(c, [40, 30, 80], 0.3)));
    b.rect(x + 6, y + 1, 1, 3, pack(lerp(c, [40, 30, 80], 0.3)));
  }
}

/** A red-and-white ship-to-shore crane whose boom reaches out to the left. (x, yb) is its left foot. */
function grua(b: Buf, m: Pinta, x: number, yb: number, alto: number, ventana: Ventana) {
  const rojo = m('#f07a8a');
  const blanco = m('#fff4f4');
  const tinta = m('#8a4a6a');
  const top = yb - alto;
  for (const lx of [x, x + 12])
    for (let y = top; y < yb; y++) {
      b.rect(lx - 1, y, 3, 1, tinta);
      b.px(lx, y, ((y - top) >> 2) % 2 ? rojo : blanco);
    }
  b.rect(x, yb - 16, 12, 2, rojo);
  for (let i = 0; i < 12; i++) b.px(x + i, yb - 16 - Math.round(i * 0.9), tinta);
  b.rect(x - 30, top - 1, 50, 4, tinta);
  b.rect(x - 29, top, 48, 2, rojo);
  for (let xx = x - 29; xx < x + 19; xx += 6) b.rect(xx, top, 3, 2, blanco);
  for (let i = 0; i < 12; i++) {
    b.px(x + Math.round(i * 0.45), top - 1 - i, tinta);
    b.px(x + 12 - Math.round(i * 0.45), top - 1 - i, tinta);
  }
  b.rect(x + 4, top - 14, 5, 2, rojo);
  b.rect(x - 14, top + 3, 5, 4, blanco);
  b.px(x - 13, top + 4, ventana());
  for (let y = top + 3; y < top + 18; y++) b.px(x - 21, y, tinta);
  b.rect(x - 24, top + 18, 7, 2, m('#f4c040'));
}

/** A striped lighthouse; (x, yb) is its foot. Returns the lantern position. */
function faro(b: Buf, m: Pinta, x: number, yb: number, alto: number): [number, number] {
  for (let y = yb - alto; y < yb; y++) b.rect(x - 1, y, 3, 1, Math.floor((y - yb) / 3) % 2 ? m('#ff7090') : m('#ffffff'));
  b.rect(x - 2, yb - alto - 2, 5, 2, m('#ffe048'));
  b.rect(x - 2, yb - alto - 3, 5, 1, m('#c04a6a'));
  b.px(x, yb - alto - 4, m('#c04a6a'));
  return [x, yb - alto - 2];
}

/** A little fishing boat on the water line. */
function bote(b: Buf, m: Pinta, x: number, yb: number, col: string) {
  b.rect(x, yb - 3, 11, 2, m(col));
  b.rect(x + 1, yb - 1, 9, 1, m(tone(col)));
  b.rect(x, yb - 3, 11, 1, m('#ffffff'));
  b.rect(x + 6, yb - 6, 3, 3, m('#fff4e0'));
  b.rect(x + 3, yb - 11, 1, 8, m('#8a5232'));
}

/** A pelican resting on a post (x, y = top of the post). */
function pelicano(b: Buf, m: Pinta, x: number, y: number) {
  b.rect(x - 2, y - 3, 4, 3, m('#a89a8a'));
  b.rect(x - 2, y - 3, 4, 1, m('#c8bcae'));
  b.rect(x + 1, y - 6, 2, 3, m('#fff4e0'));
  b.rect(x + 3, y - 5, 3, 1, m('#ffc040'));
  b.px(x + 3, y - 4, m('#e09a30'));
}

/** San Antonio: a working port — cranes, containers, a ship, the breakwater and its lighthouse. */
const FARO_SA: [number, number] = [1336, 0];
function capaSanAntonio(a: Ambiente) {
  const W = COSTA_W;
  const H = COSTA_H;
  const b = new Buf(W, H);
  const k = 0.3;
  const m: Pinta = (h, kk = k) => pack(mat(a, h, kk));
  const r = rng(1201);
  const ventana = ventanas(a, m, r);
  // Low dry hills behind the port, dotted with houses.
  const prof = ondas(W, 34, [[9, 2, 0.4], [6, 5, 1.2], [3, 11, 2.2]]);
  loma(b, prof, m('#bcd49a'), m('#dcecb4'), m('#8aa87a'));
  for (let x = 10; x < W - 10; x += 5 + Math.floor(r() * 9)) {
    if (r() < 0.3) continue;
    const yb = Math.round(H - prof(x)) + 5 + Math.floor(r() * 12);
    if (yb < H - 6) casa(b, m, x, yb, 4 + Math.floor(r() * 3), 3 + Math.floor(r() * 2), MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], TECHOS_CASA[Math.floor(r() * TECHOS_CASA.length)], ventana);
  }
  // The quay with stacks of containers.
  const Q0 = 250;
  const Q1 = 1120;
  const QY = H - 8;
  b.rect(Q0, QY, Q1 - Q0, 8, m('#c8c0d4'));
  b.rect(Q0, QY, Q1 - Q0, 1, m('#eeeaf6'));
  b.rect(Q0, H - 2, Q1 - Q0, 1, m('#9a90b0'));
  for (let x = Q0 + 10; x < 700; x += 8) {
    if (r() < 0.12) {
      x += 5;
      continue;
    }
    contenedores(b, a, k, r, x, QY, 1 + Math.floor(r() * 4));
  }
  // Gantry cranes and a container ship at the berth.
  for (const cx of [770, 860, 950, 1040]) grua(b, m, cx, QY, 44 + (cx % 3) * 3, ventana);
  const S0 = 720;
  const S1 = 1090;
  for (let y = H - 7; y < H; y++) {
    const inset = y > H - 3 ? (y - (H - 3)) * 2 : 0;
    b.rect(S0 + inset, y, S1 - S0 - inset, 1, y >= H - 2 ? m('#e06a7a') : m('#5a6aa8'));
  }
  b.rect(S0 - 2, H - 9, 14, 3, m('#5a6aa8'));
  b.rect(S0, H - 7, S1 - S0, 1, m('#8a9ad0'));
  for (let x = S0 + 16; x < S1 - 30; x += 8) contenedores(b, a, k, r, x, H - 7, 1 + Math.floor(r() * 3));
  b.rect(S1 - 22, H - 22, 12, 15, m('#fff4f4'));
  b.rect(S1 - 21, H - 20, 10, 1, ventana());
  b.rect(S1 - 21, H - 16, 10, 1, ventana());
  b.rect(S1 - 16, H - 27, 4, 5, m('#e06a7a'));
  // The breakwater, a line of rocks ending in a little lighthouse.
  for (let x = Q1; x < FARO_SA[0] + 4; x += 3) {
    b.disc(x, H - 2, 2 + (x % 2), m(x % 6 ? '#a8a0c0' : '#c4bcd8'));
    b.px(x - 1, H - 4, m('#e0dcf0'));
  }
  const [lx, ly] = faro(b, m, FARO_SA[0], H - 4, 14);
  FARO_SA[1] = ly;
  // A small «FARO» plate on the breakwater.
  b.rect(lx - 26, H - 13, anchoTexto('FARO') + 4, 7, m('#24427a'));
  letrero(b, 'FARO', lx - 24, H - 12, m('#ffffff', 0.15), m('#24427a'));
  // Fishing boats and a wooden jetty with pelicans.
  const COLS = ['#e05a5a', '#4a8ad8', '#f4c040', '#4cc4a0', '#ff8ac0'];
  for (let i = 0; i < 5; i++) bote(b, m, 1380 + i * 36 + Math.floor(r() * 10), H, COLS[i]);
  b.rect(1600, H - 6, 90, 2, m('#c48250'));
  for (let x = 1602; x < 1690; x += 10) b.rect(x, H - 6, 2, 6, m('#8a5232'));
  for (const x of [1612, 1642, 1672]) pelicano(b, m, x, H - 6);
  // The town sign up on the hill.
  {
    const txt = 'SAN ANTONIO';
    const w = anchoTexto(txt);
    const x = 120;
    const y = Math.round(H - prof(x + w / 2)) - 14;
    b.rect(x + 2, y + 9, 1, 8, m('#6a5a7a'));
    b.rect(x + w - 3, y + 9, 1, 8, m('#6a5a7a'));
    b.rect(x - 4, y - 4, w + 8, 13, m('#24427a'));
    b.rect(x - 3, y - 3, w + 6, 11, m('#3a6ab0'));
    letrero(b, txt, x, y, m('#ffffff', 0.15), m('#24427a'));
  }
  return b;
}

/** Open coast: cliffs with green tops, coves with beaches and a fishing village. */
const CALETAS: [number, number][] = [[380, 70], [1100, 120], [1560, 60]];
function capaCosta(a: Ambiente) {
  const W = COSTA_W;
  const H = COSTA_H;
  const b = new Buf(W, H);
  const k = 0.3;
  const m: Pinta = (h, kk = k) => pack(mat(a, h, kk));
  const r = rng(1301);
  const ventana = ventanas(a, m, r);
  const base = ondas(W, 46, [[12, 2, 1], [7, 6, 0.2], [3, 17, 1.5]]);
  const prof = (x: number) => {
    let v = base(x);
    for (const [cx, hw] of CALETAS) {
      const u = Math.abs(mod(x - cx + W / 2, W) - W / 2) / hw;
      if (u < 1) v *= 0.12 + 0.88 * u * u;
    }
    return v;
  };
  const roca = m('#d4a890');
  const rocaO = m('#b08478');
  const pasto = m('#8ac888');
  const pastoL = m('#b8e4a8');
  const tinta = m('#6a8a6a');
  const arena = m('#f4dca0');
  for (let x = 0; x < W; x++) {
    const p = prof(x);
    const top = Math.round(H - p);
    const nx = Math.round(H - prof(x + 1));
    for (let y = top; y < H; y++) {
      const d = y - top;
      b.d[y * W + x] = d < 3 && p > 8 ? (d === 1 ? pastoL : pasto) : (x + ((y * 3) >> 3)) % 11 === 0 || (d > 6 && (x * 5 + y * 3) % 41 === 0) ? rocaO : roca;
    }
    if (p < 10) b.rect(x, H - 3, 1, 3, arena);
    else if ((x * 7) % 5 === 0) b.px(x, H - 1, m('#ffffff'));
    for (let y = Math.min(top, nx); y <= Math.max(top, nx) - (nx > top ? 1 : 0); y++) b.px(x, y, tinta);
    b.px(x, top, tinta);
  }
  // Round trees and lonely houses on the cliff tops.
  for (let x = 20; x < W - 10; x += 14 + Math.floor(r() * 40)) {
    const p = prof(x);
    if (p < 20) continue;
    const y = Math.round(H - p);
    if (r() < 0.6) {
      b.rect(x, y - 4, 1, 4, m('#8a5232'));
      b.disc(x, y - 6, 3, m('#3a9a6a'));
      b.disc(x - 1, y - 7, 2, m('#5cc48a'));
    } else casa(b, m, x, y + 1, 5, 4, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], '#e86a5c', ventana);
  }
  // The fishing village in the big cove: houses on the slopes, boats on the sand, a chapel.
  const [cx, hw] = CALETAS[1];
  for (let x = cx - hw - 20; x < cx + hw + 20; x += 6 + Math.floor(r() * 3)) {
    const p = prof(x);
    if (p < 6 || p > 40) continue;
    const top = Math.round(H - p) + 2;
    for (let yb = top + 4; yb < H - 3; yb += 5) if (r() < 0.7) casa(b, m, x, yb, 5, 4, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], TECHOS_CASA[Math.floor(r() * TECHOS_CASA.length)], ventana);
  }
  {
    const x = cx + 26;
    const yb = Math.round(H - prof(x)) + 3;
    b.rect(x, yb - 8, 7, 8, m('#fff6e5'));
    b.rect(x + 2, yb - 14, 3, 6, m('#fff6e5'));
    b.rect(x + 2, yb - 16, 3, 2, m('#5a8ad8'));
    b.px(x + 3, yb - 18, m('#ffe048'));
    b.px(x + 3, yb - 17, m('#ffe048'));
    b.rect(x + 3, yb - 4, 1, 4, m('#8a5232'));
  }
  const COLS = ['#e05a5a', '#4a8ad8', '#f4c040', '#4cc4a0'];
  for (let i = 0; i < 4; i++) {
    const x = cx - 30 + i * 14;
    b.rect(x, H - 4, 8, 2, m(COLS[i]));
    b.rect(x, H - 4, 8, 1, m('#ffffff'));
  }
  // San Pedro's boat for the fishermen's feast: a mast strung with pennants.
  {
    const x = cx + 46;
    bote(b, m, x, H, '#4a8ad8');
    const banderas = ['#f4c040', '#ffffff', '#e05a5a', '#4cc4a0', '#4a8ad8'];
    for (let i = 0; i < 9; i++) {
      b.px(x - 4 + i, H - 11 + Math.round(Math.abs(i - 4) * 0.4) + 1, m(banderas[i % 5]));
      b.px(x + 4 + i, H - 11 + Math.round(i * 0.7) + 1, m(banderas[(i + 2) % 5]));
    }
  }
  return b;
}

/**
 * The hills of Valparaíso: stacked houses of every color climbing the slopes,
 * funiculars on their rails, steeples, the «collar de perlas» of lights after
 * dark and the waterfront. Shared by the coast panorama and the city map.
 */
function pintarCerros(b: Buf, a: Ambiente, k: number, prof: (x: number) => number, opt: { plan: number; seed: number; letrero: boolean; extra: number; densidad: number; escala?: number; desde?: number }) {
  const e = opt.escala ?? 1;
  const desde = opt.desde ?? 0;
  const W = b.w;
  const H = b.h;
  const m: Pinta = (h, kk = k) => pack(mat(a, h, kk));
  const r = rng(opt.seed);
  const ventana = ventanas(a, m, r, opt.extra);
  const yPlan = H - opt.plan;
  loma(b, prof, m('#b5d99c'), m('#d4ecbc'), m('#7aa070'));
  // Houses in staggered rows, only where the hill is under them; lower rows in front.
  let alto = 0;
  for (let x = 0; x < W; x++) alto = Math.max(alto, prof(x));
  for (let y = Math.round(H - alto) + 2; y < yPlan; y += 4 * e) {
    for (let x = Math.floor(r() * 4); x < W; ) {
      const w = (4 + Math.floor(r() * 4)) * e;
      const h = (4 + Math.floor(r() * 3)) * e;
      if (y >= H - prof(x) + 2 && y >= H - prof(x + w) + 2 && y + h <= yPlan + 1 && r() < opt.densidad) {
        casa(b, m, x, y + h, w, h, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], TECHOS_CASA[Math.floor(r() * TECHOS_CASA.length)], ventana);
        // Corrugated zinc: thin dark lines every 2 px on some walls.
        if (w > 5 && r() < 0.4) for (let lx = x + 1; lx < x + w - 1; lx += 2) b.px(lx, y + h - 1, m('#6a5a7a', k + 0.2));
      }
      x += w + (r() < 0.2 ? 1 + Math.floor(r() * 3) : 0);
    }
  }
  // «Collar de perlas»: rows of street lights tracing the hills after dark.
  if (PAL[a].ventana) {
    const perla = pack(hex(a === 'noche' ? '#ffd870' : '#ffe8a0'));
    for (const d of [9, 20, 32])
      for (let x = desde; x < W; x += 3) {
        const y = Math.round(H - prof(x)) + d * e + Math.round(Math.sin(x * 0.05) * 2);
        if (y < yPlan - 1 && (x * 7) % 11 !== 0) b.px(x, y, perla);
      }
  }
  // Funiculars: a rail up the slope, two cabins and a station at the top.
  for (let x0 = desde + 120 + Math.floor(r() * 80); x0 < W - 60; x0 += 260 + Math.floor(r() * 160)) {
    const L = 16 * e;
    const y0 = yPlan;
    const y1 = Math.round(H - prof(x0 + L)) + 3;
    if (y0 - y1 < 12) continue;
    const n = y0 - y1;
    for (let i = 0; i <= n; i++) {
      const px = x0 + Math.round((i / n) * L);
      b.rect(px - 1, y0 - i, 3, 1, m('#c8b8a0'));
      b.px(px, y0 - i, m('#5a4a6a'));
      if (i % 3 === 0) b.rect(px - 2, y0 - i, 5, 1, m('#8a6a5a'));
    }
    for (const [f, c] of [[0.3, '#e86a5c'], [0.72, '#ffd27f']] as const) {
      const px = x0 + Math.round(f * L);
      const py = y0 - Math.round(f * n);
      b.rect(px - 2, py - 4, 5, 4, m(c));
      b.rect(px - 2, py - 5, 5, 1, m('#8a5232'));
      b.px(px, py - 3, ventana());
    }
    casa(b, m, x0 + L - 3, y1 + 1, 7, 5, '#fff6e5', '#e86a5c', ventana);
  }
  // Church steeples.
  for (let x = desde + 300 + Math.floor(r() * 100); x < W - 40; x += 380 + Math.floor(r() * 200)) {
    const yb = Math.round(H - prof(x)) + 14 * e;
    if (yb > yPlan) continue;
    b.rect(x - 1, yb - 16, 5, 16, m('#c8b8b0'));
    b.rect(x, yb - 15, 3, 15, m('#fff6e5'));
    b.px(x + 1, yb - 12, ventana());
    for (let i = 0; i < 4; i++) b.rect(x - 1 + Math.floor(i / 2), yb - 17 - i, 5 - Math.floor(i / 2) * 2, 1, m('#7a8ab0'));
    b.px(x + 1, yb - 22, m('#ffe048'));
    b.rect(x, yb - 23, 3, 1, m('#ffe048'));
    b.px(x + 1, yb - 24, m('#ffe048'));
  }
  // El plan: taller buildings along the waterfront, palms and the promenade.
  if (opt.plan > 0) {
  for (let x = desde; x < W; ) {
    const w = 7 + Math.floor(r() * 8);
    const h = Math.min(opt.plan + 4, 7 + Math.floor(r() * (opt.plan - 2)));
    const muro = ['#fff6e5', '#d8d0e4', '#f4c8b8', '#c8dce8', '#f4e0a8'][Math.floor(r() * 5)];
    b.rect(x, H - 3 - h, w, h, m(muro));
    b.rect(x, H - 3 - h, w, 1, m(tone(muro)));
    for (let wy = H - 1 - h; wy < H - 4; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) b.px(wx, wy, ventana());
    x += w + (r() < 0.3 ? 2 : 0);
  }
  b.rect(desde, H - 3, W - desde, 3, m('#d8d4e4'));
  b.rect(desde, H - 3, W - desde, 1, m('#f4f0fa'));
  for (let x = desde + 10; x < W; x += 34 + Math.floor(r() * 20)) {
    b.rect(x, H - 11, 1, 8, m('#9a6a4a'));
    for (let j = -3; j <= 3; j++) b.px(x + j, H - 12 + (Math.abs(j) > 1 ? 1 : 0), m('#4ea870'));
    b.px(x, H - 13, m('#4ea870'));
  }
  }
  // The name on a hillside, white letters on a green patch.
  if (opt.letrero) {
    // Twice along the strip, so it's on screen whenever the city is.
    const txt = 'VALPARAÍSO';
    const w = anchoTexto(txt);
    for (const [f0, f1] of [[0.08, 0.3], [0.55, 0.8]]) {
      let best = Math.round(W * f0);
      for (let x = Math.round(W * f0); x < W * f1; x += 4) if (prof(x + w / 2) > prof(best + w / 2)) best = x;
      const y = Math.round(H - Math.min(prof(best), prof(best + w))) + 6;
      b.rect(best - 3, y - 4, w + 6, 11, m('#9cc888'));
      letrero(b, txt, best, y, m('#ffffff', 0.1), m('#5a8a5a'));
    }
  }
}

function capaValparaiso(a: Ambiente) {
  const b = new Buf(COSTA_W, COSTA_H);
  const prof = ondas(COSTA_W, 62, [[14, 3, 0.5], [9, 7, 1.7], [4, 15, 0.2]]);
  pintarCerros(b, a, 0.26, prof, { plan: 12, seed: 1401, letrero: true, extra: 0.2, densidad: 0.62 });
  // Ships waiting in the bay.
  const m: Pinta = (h, kk = 0.26) => pack(mat(a, h, kk));
  const r = rng(1402);
  const ventana = ventanas(a, m, r, 0.3);
  for (const [x, w, col] of [[300, 64, '#5a6aa8'], [1250, 52, '#fff6e5']] as const) {
    const H = COSTA_H;
    for (let y = H - 5; y < H; y++) b.rect(x + (y > H - 3 ? (y - H + 3) * 2 : 0), y, w - (y > H - 3 ? (y - H + 3) * 2 : 0), 1, y >= H - 1 ? m('#e06a7a') : m(col));
    b.rect(x + w - 16, H - 13, 10, 8, m('#fff4f4'));
    b.rect(x + w - 15, H - 11, 8, 1, ventana());
    for (let px = x + 4; px < x + w - 18; px += 4) b.px(px, H - 3, ventana());
    if (col !== '#fff6e5') for (let cx = x + 6; cx < x + w - 20; cx += 8) contenedores(b, a, 0.26, r, cx, H - 5, 1 + Math.floor(r() * 2));
  }
  return b;
}

/** Sea bands from far (0) to near (4): [color, light, trough, haze, height, crest spacing]. */
const BANDAS: [string, string, string, number, number, number][] = [
  ['#a6dcf6', '#e0f6ff', '#8ccaf0', 0.46, 10, 9],
  ['#8cd0f4', '#d4f2ff', '#72bcec', 0.34, 14, 13],
  ['#72c0f0', '#c4ecff', '#5aa8e6', 0.22, 18, 18],
  ['#5aaeea', '#b4e6ff', '#4896de', 0.12, 24, 24],
  ['#4a9ce2', '#a8e0ff', '#3a84d4', 0.04, 30, 30],
];

/** One band of sea: a scalloped crest line on top and wave dashes inside. Tiles in x. */
function capaBanda(a: Ambiente, i: number) {
  const [c0, c1, c2, k, H, lam] = BANDAS[i];
  const W = lam * Math.round(384 / lam);
  const b = new Buf(W, H);
  const cuerpo = pack(mat(a, c0, k));
  const luz = pack(mat(a, c1, k));
  const valle = pack(mat(a, c2, k));
  const amp = 1 + (i >= 2 ? 1 : 0) + (i >= 4 ? 1 : 0);
  for (let x = 0; x < W; x++) {
    const u = mod(x, lam) / lam;
    const y0 = Math.round(amp * (1 - Math.sin(u * Math.PI)));
    for (let y = y0; y < H; y++) b.d[y * W + x] = cuerpo;
    b.d[y0 * W + x] = luz;
    if (u > 0.55 && y0 + 1 < H) b.d[(y0 + 1) * W + x] = valle;
  }
  // Little wave marks: a light dash with its trough under it.
  const r = rng(500 + i);
  const n = Math.round((W * H) / (90 - i * 10));
  for (let j = 0; j < n; j++) {
    const x = Math.floor(r() * W);
    const y = amp + 3 + Math.floor(r() * (H - amp - 4));
    const len = 2 + i + Math.floor(r() * (2 + i));
    b.rect(x, y, len, 1, luz);
    b.rect(x + 1, y + 1, len, 1, valle);
  }
  return { cv: b.canvas(), fondo: css(mat(a, c0, k)), lejos: css(mat(a, '#bce6f8', 0.55)) };
}

/** A small sailboat: hull, mast and a striped sail. */
function velero(a: Ambiente, i: number) {
  const b = new Buf(16, 18);
  const k = 0.32;
  const m = (h: string) => pack(mat(a, h, k));
  const vela = [['#ffffff', '#ffb0c4'], ['#fff6d8', '#8ccaf8'], ['#ffffff', '#ffe048']][i % 3];
  b.rect(8, 1, 1, 13, m('#8a5232'));
  // Main sail (right of the mast) and jib (left), striped.
  for (let y = 2; y < 13; y++) {
    const w = Math.round((y - 1) * 0.55);
    b.rect(9, y, w, 1, m(Math.floor(y / 3) % 2 ? vela[1] : vela[0]));
  }
  for (let y = 5; y < 13; y++) b.rect(8 - Math.round((y - 4) * 0.5), y, Math.round((y - 4) * 0.5), 1, m(vela[0]));
  b.rect(2, 14, 13, 2, m('#c05a7a'));
  b.rect(3, 16, 11, 1, m('#a04a6a'));
  b.rect(2, 14, 13, 1, m('#ffffff'));
  b.outline(pack(mat(a, '#5a5a9a', k)));
  return b.canvas();
}

/** A far ship on the horizon, facing right: a container ship (0) or a fishing boat (1). Lights on after dark. */
function buque(a: Ambiente, i: number) {
  const k = 0.4;
  const m = (h: string) => pack(mat(a, h, k));
  const luz = PAL[a].ventana ? pack(hex(PAL[a].ventana!)) : m('#e8eef6');
  if (i === 0) {
    const b = new Buf(64, 16);
    // Hull with a raised bow, red below the waterline.
    b.rect(2, 10, 58, 4, m('#3e4a6b'));
    b.rect(56, 8, 6, 6, m('#3e4a6b'));
    b.rect(3, 13, 56, 1, m('#c05a5a'));
    // Stacks of containers.
    const cs = ['#e86a5c', '#3d85c6', '#f2cc8f', '#5aa8a0', '#c9a7e0', '#ffd27f'];
    for (let x = 14; x < 54; x += 5) {
      const n = 1 + ((x * 7) % 3);
      for (let j = 0; j < n; j++) b.rect(x, 9 - (j + 1) * 2, 4, 2, m(cs[(x + j * 3) % cs.length]));
    }
    // Bridge and funnel at the stern.
    b.rect(4, 3, 8, 7, m('#f4f0f4'));
    b.rect(5, 4, 6, 1, luz);
    b.rect(6, 0, 3, 3, m('#e07a5f'));
    b.outline(m('#2e3a5a'));
    return b.canvas();
  }
  const b = new Buf(26, 16);
  b.rect(2, 10, 20, 3, m('#4a8ad8'));
  b.rect(20, 8, 3, 5, m('#4a8ad8'));
  b.rect(2, 10, 20, 1, m('#ffffff'));
  b.rect(8, 5, 7, 5, m('#fff6e5'));
  b.rect(9, 6, 5, 1, luz);
  b.rect(16, 1, 1, 9, m('#8a5232'));
  for (let i = 0; i < 8; i++) b.px(16 - i, 2 + i, m('#9a9ab0'));
  b.outline(m('#2e3a5a'));
  return b.canvas();
}
/** Far ships: [world x, depth 0..1 (0 = horizon), speed, sprite]. */
const BUQUES: [number, number, number, number][] = [[300, 0.015, 2.2, 0], [1300, 0.05, -3.5, 1], [2200, 0.03, 1.4, 0]];

/** Sailboats: [world x, row (sea depth 0..1), drift speed]. */
const VELEROS: [number, number, number][] = [
  [260, 0.18, 1.6],
  [980, 0.32, -1.2],
  [1700, 0.12, 2.2],
  [2150, 0.46, 1.0],
];
/** Seagulls: [world x, height above the sea, flap phase]. */
const GAVIOTAS: [number, number, number][] = [
  [200, 120, 0],
  [240, 132, 1.3],
  [900, 96, 2.1],
  [1500, 150, 0.7],
  [1530, 140, 2.6],
  [2100, 108, 1.9],
];
/** Sun glitter on the water: [x spread −1..1, depth 0..1, phase, length]. */
const BRILLOS: [number, number, number, number][] = (() => {
  const r = rng(808);
  return Array.from({ length: 46 }, () => [r() * 2 - 1, Math.pow(r(), 0.8), r() * 10, 2 + Math.floor(r() * 4)] as [number, number, number, number]);
})();
const BRILLO: Record<Ambiente, [string, string]> = {
  dia: ['#fffbe0', '#ffffff'],
  tarde: ['#ffe0a0', '#fff4d4'],
  noche: ['#e8dcff', '#fff4d4'],
};

type Mar = {
  /** San Antonio, open coast and Valparaíso. */
  costas: Cv[];
  bandas: { cv: Cv; fondo: string; lejos: string }[];
  veleros: Cv[];
  buques: Cv[];
};

const tareasMar = (a: Ambiente): Tarea<Mar>[] => [
  (c) => (c.costas = [capaSanAntonio(a).canvas()]),
  (c) => c.costas!.push(capaCosta(a).canvas()),
  (c) => c.costas!.push(capaValparaiso(a).canvas()),
  (c) => (c.bandas = [0, 1, 2].map((i) => capaBanda(a, i))),
  (c) => c.bandas!.push(capaBanda(a, 3), capaBanda(a, 4)),
  (c) => ((c.veleros = [0, 1, 2].map((i) => velero(a, i))), (c.buques = [buque(a, 0), buque(a, 1)])),
];

/* ── San Antonio (the 'valle' map): sectors along the level ─────────────── */

/*
 * Left to right: San Juan (fields, eucalyptus, ponds) · Llolleo (wetland,
 * totora reeds, herons, the river mouth) · Barrancas (terraced houses) · the
 * port (giant cranes, containers, ships) · Cartagena (houses climbing a hill
 * like an amphitheatre, Huidobro's house on top, the grey beach). Each layer
 * is one wide canvas, so a sector shows up while the camera is over it.
 */
const SA_MID = 300;
/** Spare canvas on the left so wide screens never see the layer's edge. */
const SA_PAD = 640;
/** Canvas x in a layer of parallax `k` for world x. */
const enCapa = (X: number, k: number) => Math.round((X - SA_MID) * k + SA_MID + SA_PAD);
const delCapa = (x: number, k: number) => (x - SA_MID - SA_PAD) / k + SA_MID;
const SECTOR_FIN = [400, 1100, 1700, 2700, 3600];
const sectorDe = (X: number) => {
  const i = SECTOR_FIN.findIndex((f) => X < f);
  return i < 0 ? 4 : i;
};
const SA_LEVEL = 3600;
/** Wide enough for screens up to ~1700 px at any camera position. */
const anchoCapa = (k: number) => enCapa(SA_LEVEL, k) + 1800;

/** A tall, thin eucalyptus: pale trunk and a long blue-green crown. */
function eucalipto(b: Buf, m: Pinta, x: number, yb: number, alto: number) {
  const tinta = m('#5a7a6a');
  b.rect(x - 1, yb - alto, 3, alto, m('#b8a890'));
  b.rect(x, yb - alto, 1, alto, m('#e8dcc8'));
  const cy = Math.round(yb - alto * 0.68);
  const ry = Math.round(alto * 0.36);
  b.oval(x, cy, 5, ry + 1, tinta);
  b.oval(x - 3, cy + 4, 3, Math.round(ry * 0.6) + 1, tinta);
  b.oval(x, cy, 4, ry, m('#7f9c8a'));
  b.oval(x - 3, cy + 4, 2, Math.round(ry * 0.6), m('#7f9c8a'));
  b.oval(x - 1, cy - Math.round(ry * 0.4), 2, Math.round(ry * 0.4), m('#a8c0b0'));
}

/** A clump of totora reeds with brown tips. */
function totora(b: Buf, m: Pinta, x: number, yb: number, r: () => number) {
  for (let i = 0; i < 6; i++) {
    const h = 4 + Math.floor(r() * 6);
    const xx = x + i - 3;
    b.rect(xx, yb - h, 1, h, m(i % 2 ? '#a7b46b' : '#8a9a50'));
    if (i % 2 === 0) b.px(xx, yb - h - 1, m('#8a6a40'));
  }
}

/** A white heron standing in the shallows. */
function garza(b: Buf, m: Pinta, x: number, yb: number) {
  b.rect(x - 1, yb - 2, 1, 2, m('#5a5a6a'));
  b.rect(x + 1, yb - 2, 1, 2, m('#5a5a6a'));
  b.rect(x - 2, yb - 5, 5, 3, m('#ffffff'));
  b.rect(x + 2, yb - 8, 1, 3, m('#ffffff'));
  b.rect(x + 2, yb - 9, 2, 1, m('#ffffff'));
  b.rect(x + 4, yb - 9, 2, 1, m('#ffc040'));
}

/** A giant gantry crane (the port's), boom over the water to the left. (x, yb) is its left foot. */
function gruaGrande(b: Buf, m: Pinta, x: number, yb: number, alto: number, celeste: boolean, ventana: Ventana) {
  const col = m(celeste ? '#7ac0e8' : '#f07a8a');
  const blanco = m('#f4f0f4');
  const tinta = m(celeste ? '#3a6a9a' : '#8a4a6a');
  const top = yb - alto;
  const ancho = 22;
  for (const lx of [x, x + ancho])
    for (let y = top; y < yb; y++) {
      b.rect(lx - 1, y, 4, 1, tinta);
      b.rect(lx, y, 2, 1, ((y - top) >> 3) % 2 ? col : blanco);
    }
  for (const yy of [yb - 26, yb - 60]) b.rect(x, yy, ancho + 2, 3, col);
  for (let i = 0; i < ancho; i++) b.px(x + i, yb - 26 - Math.round(i * 1.5), tinta);
  b.rect(x - 64, top - 2, 100, 6, tinta);
  b.rect(x - 63, top - 1, 98, 4, col);
  for (let xx = x - 63; xx < x + 35; xx += 8) b.rect(xx, top - 1, 4, 4, blanco);
  for (let i = 0; i < 22; i++) {
    b.px(x + 2 + Math.round(i * 0.45), top - 2 - i, tinta);
    b.px(x + ancho - Math.round(i * 0.45), top - 2 - i, tinta);
    b.px(x + 12 - Math.round(i * 2.6), top - 2 - Math.round(i * 0.9), tinta);
  }
  b.rect(x + 8, top - 25, 8, 3, col);
  b.rect(x - 30, top + 4, 8, 6, blanco);
  b.rect(x - 29, top + 5, 6, 2, ventana());
  for (let y = top + 4; y < top + 34; y++) b.px(x - 46, y, tinta);
  b.rect(x - 51, top + 34, 11, 3, m('#c8a860'));
}

/** Far: the coastal range, with the river valley at Llolleo and the sea past the port. */
function capaSALejos(a: Ambiente) {
  const k = 0.1;
  const W = anchoCapa(k);
  const H = 110;
  const b = new Buf(W, H);
  const m: Pinta = (h, kk = 0.55) => pack(mat(a, h, kk));
  const base = ondas(W, 62, [[16, 2, 0.3], [9, 5, 1.6], [4, 13, 0.8]]);
  const prof = (x: number) => {
    const X = delCapa(x, k);
    const rio = 1 - 0.55 * Math.exp(-(((X - 760) / 260) ** 2));
    const costa = 1 - 0.35 * ss(1800, 3000, X);
    return base(x) * rio * costa;
  };
  loma(b, prof, m('#a8b8d0'), m('#c8d4e8'), m('#8494b8'));
  const mar = m('#6fa8c9', 0.45);
  const brillo = m('#cfe3ea', 0.4);
  for (let x = 0; x < W; x++) {
    const X = delCapa(x, k);
    if (X < 1650) continue;
    const h = Math.round(4 * ss(1650, 1900, X));
    if (h > 0) b.rect(x, H - h, 1, h, (x * 5) % 9 === 0 ? brillo : mar);
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#a8b8d0', 0.55)) };
}

/** The ground line of the mid layer (height above its bottom) at world x. */
function sueloMedio(X: number) {
  const barr = 30 * ss(1050, 1500, X) * (1 - ss(1650, 1800, X));
  const cristo = 22 * Math.exp(-(((X - 870) / 70) ** 2));
  const centinela = 52 * Math.exp(-(((X - 1790) / 120) ** 2));
  const cart = 76 * Math.exp(-(((X - 3150) / 340) ** 2));
  const ondula = 4 * Math.sin(X / 90) + 3 * Math.sin(X / 37 + 1);
  return 30 + barr + cristo + centinela + cart + ondula * (1 - ss(1850, 1950, X) * (1 - ss(2650, 2750, X)));
}

/** Mid: the sectors themselves, from the eucalyptus to Cartagena's hill. */
function capaSAMedio(a: Ambiente) {
  const k = 0.35;
  const W = anchoCapa(k);
  const H = 160;
  const b = new Buf(W, H);
  const kk = 0.3;
  const m: Pinta = (h, q = kk) => pack(mat(a, h, q));
  // Cranes further into the haze, so they never compete with the action.
  const mGrua: Pinta = (h) => pack(mat(a, h, 0.42));
  const r = rng(2101);
  const ventana = ventanas(a, m, r, 0.1);
  const at = (X: number) => enCapa(X, k);
  const prof = (x: number) => sueloMedio(delCapa(x, k));
  const surf = (X: number) => Math.round(H - prof(at(X)));
  const verdes = [m('#b5d99c'), m('#c4dc9a'), m('#a8d0a0'), m('#a8c898'), m('#c8d0a0')];
  const tintas = [m('#7aa070'), m('#8aa064'), m('#6a9a78'), m('#7a9a70'), m('#8a9a70')];
  for (let x = 0; x < W; x++) {
    const X = delCapa(x, k);
    const s = sectorDe(X);
    const top = Math.round(H - prof(x));
    const nx = Math.round(H - prof(x + 1));
    for (let y = top; y < H; y++) b.d[y * W + x] = verdes[s];
    b.px(x, top + 1, m('#ffffff', 0.6));
    for (let y = Math.min(top, nx); y <= Math.max(top, nx); y++) b.px(x, y, tintas[s]);
  }
  // San Juan: striped crop fields (lettuce, wheat, flowers) on the slope, a red barn.
  {
    const cultivos = [['#9ed27a', '#c4e89a'], ['#f2d27a', '#ffe8a8'], ['#f4a7b9', '#b5d99c'], ['#c9a7e0', '#a8d0a0']];
    for (let X = -380, j = 0; X < 400; X += 70 + Math.floor(r() * 40), j++) {
      const [c0, c1] = cultivos[j % cultivos.length];
      const w = 30 + Math.floor(r() * 24);
      for (let i = 0; i < w; i++) {
        const x = at(X) + i;
        const y = Math.round(H - prof(x)) + 3;
        for (let row = 0; row < 7; row++) b.px(x, y + row * 2, m(row % 2 ? c1 : c0));
        if (i % 4 === 0) b.px(x, y - 1, m(c0));
      }
    }
    const x = at(180);
    const yb = surf(180) + 4;
    b.rect(x, yb - 9, 12, 9, m('#c0605a'));
    for (let i = 0; i < 4; i++) b.rect(x - 1 + i, yb - 10 - i, 14 - i * 2, 1, m('#8a4a4a'));
    b.rect(x + 4, yb - 5, 4, 5, m('#fff6e5'));
    b.px(x + 5, yb - 4, m('#c0605a'));
    b.px(x + 6, yb - 3, m('#c0605a'));
  }
  // San Juan: eucalyptus groves, two ponds and scattered farmhouses.
  for (let X = -400; X < 420; X += 18 + Math.floor(r() * 20)) eucalipto(b, m, at(X), surf(X) + 2, 36 + Math.floor(r() * 26));
  for (const X of [140, 300]) {
    const x = at(X);
    b.oval(x, surf(X) + 4, 9, 2, m('#7aa8c8'));
    b.oval(x, surf(X) + 4, 8, 1, m('#a8d8f0'));
  }
  for (const X of [60, 230, 370]) casa(b, m, at(X), surf(X) + 3, 9, 6, '#f2cc8f', '#9a8aa8', ventana);
  // Llolleo: lagoons, reeds, herons, wooden houses; the Cristo del Maipo on its little hill.
  for (let X = 430; X < 1100; X += 6 + Math.floor(r() * 10)) {
    const x = at(X);
    const y = surf(X) + 2;
    if (Math.abs(X - 870) < 60) continue;
    if ((X > 560 && X < 680) || (X > 960 && X < 1040)) {
      b.rect(x - 3, y - 1, 7, 3, m('#7aa8c8'));
      b.rect(x - 2, y - 1, 5, 1, m('#a8d8f0'));
    } else if (r() < 0.7) totora(b, m, x, y, r);
  }
  for (const X of [600, 640, 990]) garza(b, m, at(X), surf(X) + 2);
  for (const X of [470, 1060]) {
    casa(b, m, at(X), surf(X) + 3, 10, 9, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], '#c0605a', ventana);
    for (let i = -2; i < 12; i += 2) b.rect(at(X) + i, surf(X), 1, 3, m('#ffffff'));
  }
  {
    const x = at(870);
    const y = surf(870) + 1;
    const bl = m('#f4f2ee');
    b.rect(x - 2, y - 4, 5, 4, m('#c8c0b0'));
    b.rect(x, y - 13, 2, 9, bl);
    b.rect(x - 4, y - 11, 10, 2, bl);
    b.disc(x + 1, y - 15, 1, bl);
    const txt = 'CRISTO DEL MAIPO';
    const w = anchoTexto(txt);
    // The plaque floats over the statue, so the near rooftops never cut it.
    b.rect(Math.round(x - w / 2) - 2, y - 28, w + 4, 8, m('#5a7a6a'));
    b.rect(x, y - 20, 1, 4, m('#6a5a4a'));
    letrero(b, txt, Math.round(x - w / 2), y - 27, m('#ffffff', 0.1), m('#3a5a4a'));
  }
  // Barrancas: paired houses in terraces up the slope, with stairs between.
  for (let X = 1120; X < 1660; X += 16 + Math.floor(r() * 8)) {
    const x = at(X);
    const top = surf(X) + 3;
    for (let row = 0; row < 3; row++) {
      const yb = top + row * 9;
      if (yb > H - 2) break;
      const c1 = MUROS_CASA[Math.floor(r() * MUROS_CASA.length)];
      casa(b, m, x, yb, 6, 7, c1, '#e86a5c', ventana);
      casa(b, m, x + 7, yb, 6, 7, c1, '#e86a5c', ventana);
      b.rect(x - 2, yb, 18, 1, m('#a8a0b4'));
    }
    if (r() < 0.4) for (let y = top - 6; y < H; y += 2) b.rect(x + 14, y, 2, 1, m('#ffffff'));
  }
  // Cerro Centinela behind the port, with its name on the slope.
  {
    const X = 1790;
    const txt = 'CERRO CENTINELA';
    const w = anchoTexto(txt);
    const x = at(X) - Math.round(w / 2);
    const y = surf(X) + 10;
    for (let X2 = 1700; X2 < 1880; X2 += 9) {
      const xx = at(X2);
      if (xx + 8 < x - 3 || xx > x + w + 3) casa(b, m, xx, surf(X2) + 5, 7, 6, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], '#e86a5c', ventana);
    }
    b.rect(x - 3, y - 3, w + 6, 10, m('#9cc888'));
    letrero(b, txt, x, y - 1, m('#ffffff', 0.1), m('#5a8a5a'));
  }
  // The port: giant cranes, containers, warehouses and a ship at the berth (raised to be seen).
  {
    const qy = surf(2200);
    for (let x = at(1900); x < at(2680); x += 9) {
      if (r() < 0.15) continue;
      contenedores(b, a, kk, r, x, qy + 1, 1 + Math.floor(r() * 5));
    }
    for (const [X, cel] of [[1960, false], [2120, true], [2280, false], [2440, true]] as const) gruaGrande(b, mGrua, at(X), qy + 1, 104, cel, ventana);
    const s0 = at(2470);
    const s1 = at(2660);
    const sb = qy - 2;
    for (let y = sb - 9; y < sb; y++) b.rect(s0 + (y > sb - 3 ? 2 : 0), y, s1 - s0, 1, y >= sb - 2 ? m('#e06a7a') : m('#3d85c6'));
    for (let x = s0 + 6; x < s1 - 22; x += 8) contenedores(b, a, kk, r, x, sb - 9, 1 + Math.floor(r() * 3));
    b.rect(s1 - 18, sb - 25, 12, 16, m('#fff4f4'));
    b.rect(s1 - 17, sb - 22, 10, 1, ventana());
    b.rect(s1 - 13, sb - 30, 4, 5, m('#e07a5f'));
    for (const X of [1880, 1925]) {
      const x = at(X);
      const yb = qy + 1;
      b.rect(x, yb - 12, 14, 12, m('#d8d0e4'));
      b.oval(x + 7, yb - 12, 7, 3, m('#9a8aa8'));
      b.rect(x + 4, yb - 7, 6, 7, m('#7a8ab0'));
    }
  }
  // Cartagena: rows of houses following the hill like an amphitheatre, with streets.
  {
    for (let row = 0; row < 6; row++) {
      for (let X = 2760 + (row % 2) * 12; X < 3540; X += 24 + Math.floor(r() * 10)) {
        if (Math.abs(X - 3150) < 30 && row < 2) continue;
        const x = at(X);
        const yb = surf(X) + 10 + row * 11;
        if (yb > H - 4) continue;
        casa(b, m, x, yb, 8 + Math.floor(r() * 3), 8, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], TECHOS_CASA[Math.floor(r() * TECHOS_CASA.length)], ventana);
      }
      // The street along this row of the amphitheatre.
      for (let x = at(2740); x < at(3560); x++) {
        const y = Math.round(H - prof(x)) + 11 + row * 11;
        if (y < H - 3) b.px(x, y, m('#d8d4c8'));
      }
    }
    {
      const x = at(2950);
      const yb = surf(2950) + 21;
      casa(b, m, x, yb, 14, 10, '#fff6e5', '#7a8ab0', ventana);
      b.rect(x + 10, yb - 18, 5, 8, m('#fff6e5'));
      for (let i = 0; i < 4; i++) b.rect(x + 9 + Math.floor(i / 2), yb - 19 - i, 7 - Math.floor(i / 2) * 2, 1, m('#7a8ab0'));
      b.px(x + 12, yb - 15, ventana());
    }
    {
      // Huidobro's house-museum on the hilltop, highlighted, with its plaque.
      const X = 3150;
      const x = at(X);
      const yb = surf(X) + 2;
      b.rect(x - 10, yb - 14, 20, 14, m('#5a4a6a', 0.15));
      b.rect(x - 9, yb - 13, 18, 13, m('#f6b38e', 0.12));
      for (let i = 0; i < 6; i++) b.rect(x - 11 + i, yb - 15 - i, 22 - i * 2, 1, m('#c0605a', 0.12));
      b.rect(x - 6, yb - 10, 4, 4, m('#fff6e5', 0.1));
      b.rect(x + 2, yb - 10, 4, 4, m('#fff6e5', 0.1));
      b.rect(x - 1, yb - 6, 3, 6, m('#8a5232', 0.12));
      b.rect(x + 13, yb - 3, 3, 3, m('#c8c4d4'));
      b.px(x + 14, yb - 4, m('#c8c4d4'));
      b.rect(x + 20, yb - 9, 1, 9, m('#8a5232'));
      b.disc(x + 20, yb - 12, 4, m('#5a9a6a'));
      b.disc(x + 19, yb - 13, 2, m('#8ac88a'));
      b.rect(x + 22, yb - 17, 2, 1, m('#3e4a6b'));
      b.px(x + 24, yb - 17, m('#ffc040'));
      const w = anchoTexto('HUIDOBRO');
      b.rect(x - Math.round(w / 2) - 2, yb - 27, w + 4, 8, m('#3e4a6b'));
      letrero(b, 'HUIDOBRO', x - Math.round(w / 2), yb - 26, m('#ffffff', 0.1), m('#3e4a6b'));
    }
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#b5d99c', kk)) };
}

/** Near: a lower band — eucalyptus, reeds and the river, houses, the station, and the sea from the port on. */
function capaSACerca(a: Ambiente) {
  const k = 0.55;
  const W = anchoCapa(k);
  const H = 90;
  const b = new Buf(W, H);
  const kk = 0.1;
  const m: Pinta = (h, q = kk) => pack(mat(a, h, q));
  const r = rng(2201);
  const ventana = ventanas(a, m, r, 0);
  const at = (X: number) => enCapa(X, k);
  const base = ondas(W, 26, [[5, 9, 0.4], [3, 23, 1.2]]);
  // The near band dips by the sea (port and Cartagena) so the water shows.
  const prof = (x: number) => {
    const X = delCapa(x, k);
    return base(x) * (1 - 0.45 * ss(1700, 1800, X)) + 8 * ss(1100, 1300, X) * (1 - ss(1600, 1750, X)) + 22 * Math.exp(-(((X - 3150) / 260) ** 2));
  };
  const verdes = [m('#8ccc84'), m('#a0c47c'), m('#90c890'), m('#b8b4c4'), m('#c9bfae')];
  for (let x = 0; x < W; x++) {
    const s = sectorDe(delCapa(x, k));
    const top = Math.round(H - prof(x));
    for (let y = top; y < H; y++) b.d[y * W + x] = verdes[s];
    b.px(x, top, m('#5a8a6a'));
  }
  const surf = (X: number) => Math.round(H - prof(at(X)));
  for (let X = -500; X < 420; X += 10 + Math.floor(r() * 14)) eucalipto(b, m, at(X), surf(X) + 1, 46 + Math.floor(r() * 22));
  for (let X = 420; X < 1100; X += 4 + Math.floor(r() * 8)) {
    if (Math.abs(X - 765) < 40) continue;
    if (r() < 0.75) totora(b, m, at(X), surf(X) + 1, r);
    else if (r() < 0.3) garza(b, m, at(X), surf(X) + 1);
  }
  // Llolleo's lagoons, the «Ojos de Mar», with their name on a little board.
  for (const [X, rx] of [[560, 26], [640, 18]] as const) {
    const x = at(X);
    const y = surf(X) + 3;
    b.oval(x, y, rx + 1, 3, m('#5a8a6a'));
    b.oval(x, y, rx, 2, m('#6fa8c9'));
    b.rect(x - Math.round(rx / 2), y - 1, rx, 1, m('#cfe3ea'));
  }
  // (Its name is on the foreground sign, by the path.)

  // The Maipo's mouth: water cutting through the reeds, and its sandbar.
  for (let x = at(725); x < at(805); x++) {
    const y = Math.round(H - prof(x)) + 1;
    b.rect(x, y, 1, H - y, m('#6fa8c9'));
    if ((x * 3) % 7 === 0) b.px(x, y + 3, m('#cfe3ea'));
  }
  b.rect(at(735), H - 22, at(795) - at(735), 3, m('#e8dcb0'));
  for (let X = 1110; X < 1640; X += 22 + Math.floor(r() * 14)) {
    const c = MUROS_CASA[Math.floor(r() * MUROS_CASA.length)];
    casa(b, m, at(X), surf(X) + 2, 9, 9, c, '#e86a5c', ventana);
    casa(b, m, at(X) + 10, surf(X) + 2, 9, 9, c, '#e86a5c', ventana);
  }

  // The sea from the port to Cartagena, with the pile pier and colourful boats.
  const marY = H - 26;
  for (let x = at(1760); x < W; x++) {
    b.rect(x, marY, 1, H - marY, m('#6fa8c9'));
    if ((x * 7) % 11 === 0) b.px(x, marY + 2 + (x % 5), m('#cfe3ea'));
    b.px(x, marY, m('#a8d4ea'));
  }
  {
    const p0 = at(2280);
    const p1 = at(2420);
    b.rect(p0, marY - 4, p1 - p0, 3, m('#c48250'));
    b.rect(p0, marY - 4, p1 - p0, 1, m('#e0a870'));
    for (let x = p0 + 2; x < p1; x += 8) b.rect(x, marY - 1, 2, 12, m('#8a5232'));
  }
  const COLS = ['#e05a5a', '#4a8ad8', '#f4c040', '#4cc4a0', '#ffffff'];
  for (let X = 2440; X < 2690; X += 26 + Math.floor(r() * 14)) {
    const x = at(X);
    b.rect(x, marY + 2, 12, 3, m(COLS[Math.floor(r() * COLS.length)]));
    b.rect(x + 1, marY + 5, 10, 1, m('#3e4a6b'));
    b.rect(x, marY + 2, 12, 1, m('#ffffff'));
  }
  // The quay and its containers, above the water line.
  for (let X = 1800; X < 2270; X += 9) if (r() < 0.6) contenedores(b, a, kk, r, at(X), marY, 1 + Math.floor(r() * 3));
  b.rect(at(1780), marY - 1, at(2270) - at(1780), 2, m('#c8c4d4'));
  // The old railway station on the way out of town: «1912».
  {
    const x = at(1690);
    const yb = surf(1690) + 1;
    b.rect(x - 20, yb - 2, 60, 2, m('#8a7a6a'));
    b.rect(x, yb - 14, 24, 12, m('#f2cc8f'));
    b.rect(x - 3, yb - 17, 30, 3, m('#8a5232'));
    for (let i = 2; i < 24; i += 6) b.rect(x + i, yb - 10, 3, 4, ventana());
    for (let xx = x - 20; xx < x + 40; xx += 3) b.px(xx, yb - 1, m('#5a4a3a'));
    b.rect(x + 3, yb - 25, anchoTexto('1912') + 4, 8, m('#5a4a3a'));
    letrero(b, '1912', x + 5, yb - 24, m('#fff6e5'), m('#5a4a3a'));
  }
  // Cartagena's houses on the hill above the beach.
  for (let X = 2760; X < 3600; X += 14 + Math.floor(r() * 8)) {
    const yb = Math.min(marY - 4, surf(X) + 8);
    casa(b, m, at(X), yb, 8 + Math.floor(r() * 3), 8, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], TECHOS_CASA[Math.floor(r() * TECHOS_CASA.length)], ventana);
  }
  b.rect(at(2720), marY - 3, W - at(2720), 3, m('#c9bfae'));
  return { cv: b.canvas(), fondo: css(mat(a, '#6fa8c9', kk)) };
}

type SA = { lejos: { cv: Cv; fondo: string }; medio: { cv: Cv; fondo: string }; cerca: { cv: Cv; fondo: string } };
const tareasSA = (a: Ambiente): Tarea<SA>[] => [
  (c) => (c.lejos = capaSALejos(a)),
  (c) => (c.medio = capaSAMedio(a)),
  (c) => (c.cerca = capaSACerca(a)),
];

/* ── The Valparaíso map's backdrop: the bay, far ridges and the cerros ─── */

/** Far ridges: a lilac-grey silhouette speckled with tiny houses (and lights after dark). */
function capaCerrosLejos(a: Ambiente) {
  const W = 1400;
  const H = 110;
  const b = new Buf(W, H);
  const k = 0.55;
  const m: Pinta = (h, kk = k) => pack(mat(a, h, kk));
  const prof = ondas(W, 70, [[18, 2, 0.3], [10, 5, 1.4], [4, 13, 2.6]]);
  loma(b, prof, m('#c9a7e0'), m('#dcc4f0'), m('#a888c8'));
  const r = rng(1501);
  const lit = PAL[a].ventana ? pack(hex(PAL[a].ventana!)) : 0;
  const motas = [m('#f4c8d8'), m('#e8dcf4'), m('#b498d4')];
  for (let i = 0; i < 2600; i++) {
    const x = Math.floor(r() * W);
    const y = Math.round(H - prof(x)) + 3 + Math.floor(r() * 60);
    if (y >= H) continue;
    b.px(x, y, lit && r() < PAL[a].ventanaLuz * 0.5 ? lit : motas[i % 3]);
    if (i % 3 === 0) b.px(x + 1, y, motas[(i + 1) % 3]);
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#c9a7e0', k)) };
}

/** Width of the bay (sea, ships, port cranes) at the left end of the mid layer. */
const BAHIA = 420;

/** Middle cerros, with the bay and its ships at the far left. */
function capaCerrosMedio(a: Ambiente) {
  const W = 1700;
  const H = 130;
  const b = new Buf(W, H);
  const k = 0.32;
  const m: Pinta = (h, kk = k) => pack(mat(a, h, kk));
  const base = ondas(W, 74, [[16, 3, 0.9], [10, 7, 0.1], [4, 17, 1.9]]);
  const prof = (x: number) => base(x) * ss(BAHIA - 120, BAHIA + 60, x);
  pintarCerros(b, a, k, prof, { plan: 10, seed: 1601, letrero: false, extra: 0.15, densidad: 0.72, desde: BAHIA - 40 });
  // The bay: water, the port cranes and ships at anchor.
  const r = rng(1602);
  const ventana = ventanas(a, m, r, 0.2);
  for (let x = 0; x < BAHIA - 40; x++) {
    b.rect(x, H - 6, 1, 6, m('#6fa8c9'));
    if ((x * 7) % 13 === 0) b.px(x, H - 4, m('#a8d4ea'));
  }
  for (const cx of [BAHIA - 110, BAHIA - 74]) grua(b, m, cx, H - 6, 40, ventana);
  b.rect(BAHIA - 140, H - 6, 110, 6, m('#c8c0d4'));
  b.rect(BAHIA - 140, H - 6, 110, 1, m('#eeeaf6'));
  for (const [x, w, col] of [[30, 70, '#5a6aa8'], [150, 48, '#fff6e5'], [220, 26, '#8a8aa8']] as const) {
    for (let y = H - 6; y < H - 1; y++) b.rect(x + (y > H - 3 ? (y - H + 3) * 2 : 0), y, w - (y > H - 3 ? (y - H + 3) * 2 : 0), 1, y >= H - 2 ? m('#e06a7a') : m(col));
    b.rect(x + w - 14, H - 14, 9, 8, m('#fff4f4'));
    b.rect(x + w - 13, H - 12, 7, 1, ventana());
    for (let px = x + 4; px < x + w - 16; px += 4) b.px(px, H - 4, ventana());
    if (w > 60) for (let cx = x + 6; cx < x + w - 18; cx += 8) contenedores(b, a, k, r, cx, H - 6, 1 + Math.floor(r() * 2));
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#6fa8c9', k)) };
}

/** Near cerros: bigger houses, funiculars and steeples, low by the bay. */
function capaCerrosCerca(a: Ambiente) {
  const W = 1800;
  const H = 160;
  const b = new Buf(W, H);
  const k = 0.14;
  const base = ondas(W, 96, [[22, 3, 2.1], [12, 7, 0.6], [5, 19, 1.1]]);
  const prof = (x: number) => base(x) * (0.25 + 0.75 * ss(BAHIA - 100, BAHIA + 200, x));
  pintarCerros(b, a, k, prof, { plan: 0, seed: 1701, letrero: false, extra: 0.1, densidad: 0.8, escala: 2 });
  return { cv: b.canvas(), fondo: css(mat(a, '#b5d99c', k)) };
}

/** World x where the Valparaíso level's backdrop turns from the cerros into the coast north (Avenida España). */
const COSTA_NORTE = 2810;

/** `corte`: x in `cv` where the hill is at full height (the cerros layer is cut there). */
type Norte = { cv: Cv; cola: Cv; fondo: string; corte: number };

/**
 * The coast north, seen past the end of the cerros: the Recreo hill dropping
 * to the sea (tall at its left, so it hides where the cerros layer is cut),
 * Viña's towers along the shore with its pier, Reñaca's white blocks stepping
 * up their hill and the Concón dunes, which carry on in `cola` (a seamless tile).
 * `e` = 1 for the mid layer, 2 for the near one.
 */
function capaNorte(a: Ambiente, e: 1 | 2): Norte {
  const k = e === 1 ? 0.32 : 0.14;
  const H = e === 1 ? 130 : 160;
  const PER = 45 * e;
  const W = e === 1 ? PER * 7 : PER * 4;
  const COLA = PER * 2;
  const m: Pinta = (h, kk = k) => pack(mat(a, h, kk));
  const r = rng(1811 + e);
  const ventana = ventanas(a, m, r, 0.2);
  const alto = e === 1 ? 122 : 150;
  const piso = 8 * e;
  const duna = (x: number) => (e === 1 ? 32 : 50) + 6 * e * Math.sin((x * TAU) / PER);
  // Landmarks along the layer, in its own x (the near layer packs them a little tighter).
  const X = (x: number) => Math.round(x * (e === 1 ? 1 : 1.3));
  const prof = (x: number) => {
    const cerro = 60 * e * (1 - ss(X(0), X(20), x)) + alto * ss(X(0), X(20), x) - (alto - piso) * ss(X(28), X(72), x);
    const ren = piso + 40 * e * ss(X(176), X(206), x);
    const d = ss(X(214), X(238), x);
    return x < X(100) ? Math.max(cerro, piso) : Math.max(piso, ren * (1 - d), duna(x) * d);
  };
  const ARENA = X(226);
  const pinta = (b: Buf, W: number, prof: (x: number) => number, x0: number) => {
    for (let x = 0; x < W; x++) {
      const wx = x + x0;
      const sand = wx >= ARENA;
      const top = Math.round(H - prof(wx));
      const nx = Math.round(H - prof(wx + 1));
      b.rect(x, Math.max(0, top), 1, H - Math.max(0, top), m(sand ? '#f2d49a' : '#b5d99c'));
      b.px(x, top + 1, m(sand ? '#fff0c8' : '#d4ecbc'));
      const tinta = m(sand ? '#c8a060' : '#7aa070');
      for (let y = Math.min(top, nx); y <= Math.max(top, nx) - (nx > top ? 1 : 0); y++) b.px(x, y, tinta);
      b.px(x, top, tinta);
      // Sparse scrub on the dunes.
      if (sand && r() < 0.06) b.px(x, top + 2 + Math.floor(r() * 3 * e), m('#7aa070'));
      // The sea in front of the shore (the mid layer stands on the bay).
      if (e === 1 && wx >= X(64)) {
        b.rect(x, H - 5, 1, 5, m('#6fa8c9'));
        if ((wx * 7) % 13 === 0) b.px(x, H - 4, m('#a8d4ea'));
        if (wx % 9 < 3) b.px(x, H - 5, m('#e4f2fa'));
      }
    }
  };

  const b = new Buf(W, H);
  pinta(b, W, prof, 0);
  const base = H - piso;
  // Recreo: little houses packed on the hill.
  for (let y = H - alto + 2; y < base - 2; y += 4 * e)
    for (let x = Math.floor(r() * 4); x < X(76); ) {
      const w = (4 + Math.floor(r() * 4)) * e;
      const h = (4 + Math.floor(r() * 3)) * e;
      if (y >= H - prof(x) + 2 && y >= H - prof(x + w) + 2 && y + h <= base && r() < 0.8)
        casa(b, m, x, y + h, w, h, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], TECHOS_CASA[Math.floor(r() * TECHOS_CASA.length)], ventana);
      x += w + (r() < 0.2 ? 1 : 0);
    }
  // Viña: towers along the shore, taller in the middle, and palms in front.
  for (let x = X(74); x < X(150); ) {
    const w = (5 + Math.floor(r() * 4)) * e;
    const mid = 1 - Math.abs(x - X(112)) / X(46);
    const h = Math.round((8 + r() * 10 + mid * 22) * e);
    const muro = ['#fff6e5', '#e8ecf4', '#f4e0c8', '#d8e4f0', '#fdfaf2'][Math.floor(r() * 5)];
    b.rect(x, base - h, w, h, m(muro));
    b.rect(x + w - 1, base - h, 1, h, m(tone(muro)));
    b.rect(x, base - h, w, 1, m(tone(muro)));
    for (let wy = base - h + 2; wy < base - 1; wy += 2 * e) for (let wx = x + 1; wx < x + w - 1; wx += 2) b.px(wx, wy, ventana());
    x += w + 1 + Math.floor(r() * 3);
  }
  for (let x = X(78); x < X(170); x += X(14) + Math.floor(r() * 8)) {
    const hp = 5 * e + Math.floor(r() * 3);
    b.rect(x, base - hp, 1, hp, m('#9a6a4a'));
    for (let j = -2 * e; j <= 2 * e; j++) b.px(x + j, base - hp - 1 + (Math.abs(j) > e ? 1 : 0), m('#4ea870'));
    b.px(x, base - hp - 2, m('#4ea870'));
  }
  // Muelle Vergara: a thin pier into the bay, with its tower at the end (mid layer only).
  if (e === 1) {
    const x0 = X(152);
    b.rect(x0, H - 7, 18, 1, m('#8a6a4a'));
    for (let x = x0 + 1; x < x0 + 18; x += 4) b.rect(x, H - 6, 1, 6, m('#5a6a7a'));
    b.rect(x0 + 15, H - 13, 1, 6, m('#4a6070'));
    b.rect(x0 + 18, H - 13, 1, 6, m('#4a6070'));
    b.rect(x0 + 11, H - 14, 9, 1, m('#4a6070'));
  }
  // Reñaca: white blocks stepping up the hill, a glass row on each.
  for (let x = X(172); x < X(222); x += 6 * e) {
    const yTop = Math.round(H - prof(x + 3 * e)) - 6 * e;
    const yBot = Math.min(base, Math.round(H - prof(x)) + 2);
    b.rect(x, yTop, 6 * e, yBot - yTop, m('#fdfaf2'));
    b.rect(x + 6 * e - 1, yTop, 1, yBot - yTop, m('#d8d4e4'));
    for (let wy = yTop + 2; wy < yBot - 1; wy += 3 * e) for (let wx = x + 1; wx < x + 6 * e - 1; wx++) b.px(wx, wy, wx % 2 ? ventana() : m('#8ccaf8'));
  }

  // The tail: more dunes, the same profile so it joins seamlessly.
  const c = new Buf(COLA, H);
  pinta(c, COLA, duna, W);
  return { cv: b.canvas(), cola: c.canvas(), fondo: css(mat(a, e === 1 ? '#6fa8c9' : '#f2d49a', k)), corte: X(24) };
}

type Valpo = {
  lejos: { cv: Cv; fondo: string };
  medio: { cv: Cv; fondo: string };
  cerca: { cv: Cv; fondo: string };
  bruma: Cv;
  norteMedio: Norte;
  norteCerca: Norte;
};

const tareasValpo = (a: Ambiente): Tarea<Valpo>[] => [
  (c) => (c.lejos = capaCerrosLejos(a)),
  (c) => (c.medio = capaCerrosMedio(a)),
  (c) => (c.cerca = capaCerrosCerca(a)),
  (c) => (c.bruma = capaNiebla(a, 0.7)),
  (c) => {
    c.norteMedio = capaNorte(a, 1);
    c.norteCerca = capaNorte(a, 2);
  },
];

/* ── Sky life: small cozy things that fill each altitude band ──────────── */

/*
 * Nothing here may read as an enemy or a missile: no lilac or pink, nothing
 * that rushes at the camera, low contrast (hazed toward the sky). Sprites are
 * painted once per ambiente; per frame it's a handful of drawImage/fillRect.
 */

/** Fades a canvas toward the haze color (`k` 0..1), in place. */
function brumar(cv: Cv, a: Ambiente, k: number) {
  const g = cv.getContext('2d')!;
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = k;
  g.fillStyle = css(PAL[a].bruma);
  g.fillRect(0, 0, cv.width, cv.height);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return cv;
}

/** A Chilean kite (volantín): a two-colour diamond with crossed sticks. */
function volantin(a: Ambiente, c0: string, c1: string) {
  const b = new Buf(13, 13);
  const k = 0.3;
  for (let y = 0; y <= 10; y++) {
    const w = y <= 4 ? y + 1 : 11 - y;
    for (let x = -w; x <= w; x++) b.px(6 + x, 1 + y, pack(mat(a, x < 0 ? c0 : c1, k)));
  }
  const palo = pack(mat(a, '#8a6a4a', k));
  for (let y = 1; y <= 11; y++) b.px(6, y, palo);
  for (let x = 1; x <= 11; x++) b.px(x, 5, palo);
  b.outline(pack(mat(a, '#5a5a7a', k)));
  return b.canvas();
}

/** A little cream airplane towing a banner. Faces right. */
function avionetaLetrero(a: Ambiente) {
  const cv = document.createElement('canvas');
  const txt = 'VUELA ALTO';
  const tw = anchoTexto(txt);
  cv.width = tw + 30;
  cv.height = 12;
  const g = cv.getContext('2d')!;
  const R = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  // Banner (left), tow line, then the plane.
  R(0, 2, tw + 6, 9, '#7a7a96');
  R(1, 3, tw + 4, 7, '#fff6e5');
  escribir(g, txt, 3, 4, '#5a6a9a');
  R(tw + 6, 6, 9, 1, '#9a9ab0');
  const px = tw + 15;
  R(px, 4, 12, 4, '#7a7a96');
  R(px + 1, 5, 10, 2, '#ffe9a8');
  R(px + 9, 3, 3, 1, '#7a7a96');
  R(px + 4, 7, 5, 2, '#d8c890');
  R(px + 12, 4, 1, 4, '#c8d0e8');
  R(px + 2, 1, 2, 4, '#d8c890');
  return brumar(cv, a, 0.35);
}

/** A tall cumulus tower (cumulus congestus) with a flat base. */
function torreNube(a: Ambiente, seed: number, w: number, h: number) {
  const p = palNube(a, 0.2);
  const b = new Buf(w + 4, h + 4);
  const r = rng(seed);
  const bolas: [number, number, number][] = [];
  for (let y = h - 6; y > 8; y -= 6) {
    const k = 1 - (h - y) / h;
    const ancho = (w / 2 - 4) * (0.45 + 0.55 * k);
    for (let i = 0; i < 3; i++) bolas.push([w / 2 + 2 + (i - 1) * ancho * 0.6 + (r() - 0.5) * 4, y, Math.round(4 + ancho * 0.35 + r() * 2)]);
  }
  for (const [x, y, rr] of bolas) b.disc(x, y, rr, pack(p.sombra));
  for (const [x, y, rr] of bolas) b.disc(x - 1, y - 2, rr - 1, pack(p.cuerpo));
  for (const [x, y, rr] of bolas) if (rr > 5) b.disc(x - rr * 0.4, y - rr * 0.5, Math.round(rr * 0.35), pack(p.luz));
  for (let y = h; y < b.h; y++) for (let x = 0; x < b.w; x++) b.d[y * b.w + x] = 0;
  b.outline(pack(p.tinta));
  return b.canvas();
}

/** A long, flat cloud bridge. */
function puenteNube(a: Ambiente, seed: number, w: number) {
  const p = palNube(a, 0.3);
  const b = new Buf(w, 18);
  const r = rng(seed);
  for (let x = 6; x < w - 6; x += 5) b.disc(x, 11 - Math.round(r() * 3), 4 + Math.round(r() * 2), pack(p.sombra));
  for (let x = 6; x < w - 6; x += 5) b.disc(x - 1, 9 - Math.round(r() * 3), 3 + Math.round(r() * 2), pack(p.cuerpo));
  for (let y = 15; y < 18; y++) for (let x = 0; x < w; x++) b.d[y * w + x] = 0;
  b.outline(pack(p.tinta));
  return b.canvas();
}

/** A dark storm cloud far away, and the same cloud lit from inside. */
function nubeTormenta(seed: number) {
  const oscura = { cuerpo: hex('#3c3a6e'), luz: hex('#4a4880'), sombra: hex('#302e5e'), tinta: hex('#262452') };
  const lit = { cuerpo: hex('#8a88c0'), luz: hex('#c4c2ec'), sombra: hex('#6a68a8'), tinta: hex('#4a4888') };
  return [nube(96, seed, oscura), nube(96, seed, lit)];
}

/** Slanted sun rays for the afternoon, dithered thin. */
function rayosSol() {
  const W = 220;
  const H = 260;
  const b = new Buf(W, H);
  const col = pack(hex('#fff0c8'));
  for (const [x0, ancho] of [[30, 12], [74, 8], [110, 16], [160, 9], [196, 6]] as const)
    for (let y = 0; y < H; y++) {
      const fade = 1 - y / H;
      for (let i = 0; i < ancho; i++) {
        const x = Math.round(x0 + i - y * 0.35);
        if (x >= 0 && x < W && tramado(x, y, 0.4 * fade)) b.d[y * W + x] = col;
      }
    }
  return b.canvas();
}

/** A weather balloon: a pale sphere with its little instrument box. */
function globoSonda(a: Ambiente) {
  const b = new Buf(11, 24);
  b.disc(5, 5, 4, pack(mat(a, '#e8eef6', 0.2)));
  b.disc(4, 4, 2, pack(mat(a, '#ffffff', 0.2)));
  for (let y = 10; y < 20; y++) b.px(5, y, pack(mat(a, '#9aa0b8', 0.2)));
  b.rect(4, 20, 3, 2, pack(mat(a, '#f2b060', 0.2)));
  b.outline(pack(mat(a, '#7a88a8', 0.3)));
  return b.canvas();
}

/** A high jet's contrail, thinning to nothing at the tail. */
function estelaAlta() {
  const W = 240;
  const b = new Buf(W, 3);
  const col = pack(hex('#f4f8ff'));
  for (let x = 0; x < W; x++) {
    const k = x / W;
    for (let y = 0; y < 3; y++) if (tramado(x, y, y === 1 ? k : k * 0.5)) b.d[y * W + x] = col;
  }
  return b.canvas();
}

/** A soft dithered haze band (the bright edge of the atmosphere). */
function bandaBruma(a: Ambiente) {
  const W = 64;
  const H = 24;
  const b = new Buf(W, H);
  const col = pack(hex(a === 'noche' ? '#5a5a98' : a === 'tarde' ? '#ffd8c0' : '#dceaff'));
  for (let y = 0; y < H; y++) {
    const k = 1 - Math.abs(y - H / 2) / (H / 2);
    for (let x = 0; x < W; x++) if (tramado(x, y, k * 0.55)) b.d[y * W + x] = col;
  }
  return b.canvas();
}

/** Noctilucent clouds: thin electric-blue ripples. */
function noctilucente(seed: number) {
  const W = 260;
  const H = 16;
  const b = new Buf(W, H);
  const r = rng(seed);
  const cs = [pack(hex('#7ab8e8')), pack(hex('#b4e0ff')), pack(hex('#e4f6ff'))];
  for (let j = 0; j < 4; j++) {
    const y0 = 3 + j * 3;
    const ph = r() * 6;
    for (let x = 0; x < W; x++) {
      const env = Math.sin((x / W) * Math.PI);
      const y = Math.round(y0 + Math.sin(x * 0.09 + ph) * 1.5);
      if (tramado(x, y, env * (0.5 + 0.4 * Math.sin(x * 0.05 + j)))) b.px(x, y, cs[(j + (x >> 4)) % 3]);
    }
  }
  return b.canvas();
}

/** The space station: a truss with modules and four wide solar arrays. */
function estacion() {
  const b = new Buf(27, 11);
  const panel = pack(hex('#5a72a8'));
  const rejilla = pack(hex('#8aa4d4'));
  for (const x of [1, 6, 17, 22])
    for (const y of [0, 7]) {
      b.rect(x, y, 4, 4, panel);
      b.px(x + 1, y + 1, rejilla);
      b.px(x + 3, y + 2, rejilla);
    }
  b.rect(0, 5, 27, 1, pack(hex('#b8bcd0')));
  b.rect(10, 3, 7, 5, pack(hex('#e4e6f0')));
  b.rect(12, 2, 3, 7, pack(hex('#c8ccdc')));
  b.px(11, 4, pack(hex('#ffffff')));
  return b.canvas();
}

/** A paraglider: a striped arc of canopy, its lines and the pilot hanging under it. */
function parapente(a: Ambiente, c0: string, c1: string) {
  const b = new Buf(19, 15);
  const k = 0.35;
  const A = pack(mat(a, c0, k));
  const B = pack(mat(a, c1, k));
  for (let x = 1; x <= 17; x++) {
    const y = Math.round(4 - 3.4 * Math.sin((Math.PI * (x - 1)) / 16));
    b.rect(x, y, 1, 3, Math.floor((x + 1) / 3) % 2 ? A : B);
  }
  b.outline(pack(mat(a, '#5a5a7a', k)));
  const linea = pack(mat(a, '#9a9ab4', k + 0.15));
  for (let i = 1; i < 6; i++) {
    b.px(Math.round(2 + i * 1.1), 6 + i, linea);
    b.px(Math.round(16 - i * 1.1), 6 + i, linea);
  }
  b.rect(8, 12, 3, 2, pack(mat(a, '#3e4a6b', k)));
  b.px(9, 11, pack(mat(a, '#ffd27f', k)));
  return b.canvas();
}

/** An old contrail spreading out: thin and bright at the head, wide and frayed toward the tail. */
function estelaVieja() {
  const W = 420;
  const H = 34;
  const b = new Buf(W, H);
  const c0 = pack(hex('#ffffff'));
  const c1 = pack(hex('#eef4ff'));
  for (let x = 0; x < W; x++) {
    const u = x / W; // 0 = tail (oldest), 1 = head
    const yc = H - 6 - u * (H - 10) + Math.sin(x * 0.03) * 1.5 * (1 - u);
    const half = 0.6 + (1 - u) * 3.4;
    for (let y = Math.floor(yc - half); y <= Math.ceil(yc + half); y++) {
      const e = 1 - Math.abs(y - yc) / (half + 0.5);
      if (tramado(x, y, e * (0.25 + 0.55 * u) * Math.min(1, x / 40))) b.px(x, y, e > 0.5 ? c0 : c1);
    }
  }
  return b.canvas();
}

type Vida = {
  cumulos: Cv[][];
  parapentes: Cv[];
  estelaVieja: Cv;
  volantines: Cv[];
  letrero: Cv;
  torres: Cv[];
  puentes: Cv[];
  tormenta: Cv[];
  rayos: Cv;
  sonda: Cv;
  estela: Cv;
  bruma: Cv;
  noctilucentes: Cv[];
  iss: Cv;
};

const tareasVida = (a: Ambiente): Tarea<Vida>[] => [
  (c) => {
    c.volantines = [volantin(a, '#f2cc8f', '#e07a5f'), volantin(a, '#8fd3c8', '#3d85c6'), volantin(a, '#b5d99c', '#ffd27f')];
    c.letrero = avionetaLetrero(a);
    c.parapentes = [parapente(a, '#e86a5c', '#ffd27f'), parapente(a, '#3d85c6', '#8fd3c8')];
    c.estelaVieja = estelaVieja();
  },
  (c) => {
    // Scattered cumulus for the long low sky, three depths (far ones paler).
    c.cumulos = [
      [34, 46, 30, 54].map((w, i) => nube(w, 720 + i, palNube(a, 0.5))),
      [58, 74, 88, 66].map((w, i) => nube(w, 730 + i, palNube(a, 0.3))),
    ];
  },
  (c) => c.cumulos!.push([96, 120, 108, 136].map((w, i) => nube(w, 740 + i, palNube(a, 0.14)))),
  (c) => {
    c.torres = [torreNube(a, 901, 60, 96), torreNube(a, 902, 46, 70)];
    c.puentes = [puenteNube(a, 903, 200), puenteNube(a, 904, 130)];
  },
  (c) => {
    c.tormenta = nubeTormenta(905);
    c.rayos = rayosSol();
    c.sonda = globoSonda(a);
    c.estela = estelaAlta();
    c.bruma = bandaBruma(a);
    c.noctilucentes = [noctilucente(906), noctilucente(907)];
    c.iss = estacion();
  },
];

/** Kites: [world x, height above the near hills, colour, string sway phase]. */
const VOLANTINES: [number, number, number, number][] = [[180, 70, 0, 0], [520, 92, 1, 1.7], [1300, 64, 2, 3.1], [2050, 84, 0, 4.4], [2900, 76, 1, 0.9]];
/** Cloud towers and bridges: [world x, altitude, sprite]. */
const TORRES: [number, number, number][] = [[300, 820, 0], [1150, 1000, 1], [1900, 760, 0], [2600, 1120, 1]];
const PUENTES: [number, number, number][] = [[700, 980, 0], [1600, 1180, 1], [2300, 900, 1]];
/** Ice crystals and mid-sky stars: [x 0..1, y 0..1, phase]. */
const CRISTALES: [number, number, number][] = (() => {
  const r = rng(909);
  return Array.from({ length: 22 }, () => [r(), r(), r() * 10] as [number, number, number]);
})();
/** Seeds and butterflies near the ground: [x 0..1, height, phase, butterfly?]. */
const SEMILLAS: [number, number, number, number][] = (() => {
  const r = rng(910);
  return Array.from({ length: 12 }, (_, i) => [r(), 10 + r() * 50, r() * 10, i % 4 === 0 ? 1 : 0] as [number, number, number, number]);
})();

/** Cumulus of the long low sky: [world x, real altitude, depth 0 far … 2 near, sprite]. */
const CUMULOS: [number, number, number, number][] = (() => {
  const r = rng(920);
  return Array.from({ length: 24 }, (_, i) => {
    const d = i % 3;
    return [r() * 3000, d === 0 ? 560 + r() * 1000 : d === 1 ? 480 + r() * 820 : 430 + r() * 620, d, Math.floor(r() * 4)] as [number, number, number, number];
  });
})();
/** Per depth: [vertical parallax, horizontal parallax, drift px/s]. */
const CUM_K: [number, number, number][] = [[0.32, 0.07, 0.9], [0.5, 0.14, 1.7], [0.74, 0.25, 2.8]];
/** Flocks, paragliders and condors of the mid sky: [world x, real altitude]. */
const AVES_MEDIAS: [number, number][] = [[400, 560], [1500, 720], [2400, 900]];
const PARAPENTES: [number, number][] = [[700, 520], [2100, 660]];
const CONDORES: [number, number][] = [[1200, 820], [2700, 1020]];

/** Screen row for something that lives at world altitude A (k = how fast it slides with the camera). */
const filaAlt = (o: OpcionesFondo, A: number, fy: number, k: number) => Math.round(o.vh * fy + (o.camY - A) * k);

/**
 * Low sky (in front of the landscape, behind the sea of clouds): kites,
 * a banner plane, extra flocks, seeds and butterflies; at sea an albatross,
 * pelicans and a far steamer's smoke; in Valparaíso far fireworks at night.
 */
function vidaBaja(g: Ctx, o: OpcionesFondo, C: Capas, V: Vida, t: number, ys: (k: number) => number) {
  const { vw, vh, camX, ambiente: a } = o;
  const mapa = o.paisaje ?? 'valle';
  const cy = o.camY;
  if (cy > 900) return;
  const quieto = !!o.quieto;

  // Kites over the hills (land maps), each on a long string that sways.
  if (mapa !== 'oceano' && a !== 'noche') {
    for (let i = 0; i < VOLANTINES.length; i++) {
      const [X, alto, ci, ph] = VOLANTINES[i];
      const x = Math.round(X - camX * 0.5 + Math.sin(t * 0.6 + ph) * 6);
      if (x < -20 || x > vw + 20) continue;
      const y = Math.round(ys(0.6) - alto + Math.sin(t * 0.9 + ph) * 3);
      if (y > vh || y < -20) continue;
      g.drawImage(V.volantines[ci], x - 6, y - 6);
      // Tail of little bows, and the string down toward the ground.
      g.fillStyle = '#8a8aa8';
      for (let j = 1; j <= 4; j++) g.fillRect(x - 1 + Math.round(Math.sin(t * 3 + j + ph) * 1.5), y + 6 + j * 3, 3, 1);
      for (let j = 1; j < 22; j++) {
        const sy = y + 6 + j * 4;
        if (sy > vh) break;
        g.fillRect(x + Math.round(j * 1.6 + Math.sin(j * 0.3 + t * 0.6 + ph) * 1.5), sy, 1, 1);
      }
    }
  }

  // A little plane towing a banner, slowly across the low sky.
  if (a !== 'noche' && !quieto) {
    const ciclo = 70;
    const f = mod(t / ciclo, 1);
    if (f < 0.6) {
      const s = V.letrero;
      const x = Math.round(-s.width + (f / 0.6) * (vw + s.width * 2) - camX * 0.05);
      const y = filaAlt(o, 340, 0.3, 0.5) + Math.round(Math.sin(t * 1.3) * 1.5);
      if (y > -20 && y < vh) g.drawImage(s, x, y);
    }
  }

  // Two more flocks in V, higher up.
  if (C.pajaro && mapa !== 'oceano') {
    for (let j = 0; j < 2; j++) {
      const bx = mod(600 + j * 1300 - t * (10 + j * 3) - camX * 0.3, 2600) - 200;
      const by = filaAlt(o, 260 + j * 170, 0.4, 0.55) + Math.round(Math.sin(t * 0.6 + j) * 3);
      if (bx > -40 && bx < vw + 40 && by > -10 && by < vh) bandada(g, C.pajaro, bx, by, t, 3 + j * 2);
    }
  }

  // Seeds drifting and butterflies, close above the ground (daytime, land).
  if (mapa !== 'oceano' && a === 'dia' && !quieto) {
    const base = ys(0.6);
    for (let i = 0; i < SEMILLAS.length; i++) {
      const [fx, el, ph, mari] = SEMILLAS[i];
      const x = Math.round(mod(fx * (vw + 40) + t * (mari ? 9 : 6) - camX * 0.6, vw + 40) - 20);
      const y = Math.round(base - el + Math.sin(t * (mari ? 2.4 : 0.8) + ph) * (mari ? 4 : 2));
      if (y > vh || y < 0) continue;
      if (mari) {
        g.fillStyle = '#f2d070';
        const up = Math.floor(t * 8 + ph) % 2;
        g.fillRect(x - 1, y - up, 1, 2);
        g.fillRect(x + 1, y - up, 1, 2);
        g.fillStyle = '#7a6a5a';
        g.fillRect(x, y, 1, 1);
      } else {
        g.fillStyle = '#f8f6ee';
        g.fillRect(x, y, 1, 1);
        g.fillRect(x - 1, y - 1, 3, 1);
      }
    }
  }

  // At sea: an albatross gliding, pelicans in a line and a far steamer's smoke.
  if (mapa === 'oceano') {
    if (a !== 'noche') {
      const x = Math.round(mod(900 - t * 7 - camX * 0.25, 2200) - 200);
      const y = filaAlt(o, 220, 0.35, 0.5) + Math.round(Math.sin(t * 0.5) * 4);
      if (x > -20 && x < vw + 20 && y > -10 && y < vh) {
        const tilt = Math.round(Math.sin(t * 0.5));
        g.fillStyle = '#6a7090';
        g.fillRect(x - 9, y + 1 - tilt, 7, 1);
        g.fillRect(x + 3, y + 1 + tilt, 7, 1);
        g.fillStyle = '#f4f4f0';
        g.fillRect(x - 8, y - tilt, 6, 1);
        g.fillRect(x + 3, y + tilt, 6, 1);
        g.fillRect(x - 2, y, 5, 2);
        g.fillStyle = '#e0b060';
        g.fillRect(x - 4, y + 1, 1, 1);
      }
      const px = Math.round(mod(1600 - t * 11 - camX * 0.4, 2400) - 200);
      const py = filaAlt(o, 120, 0.55, 0.6);
      if (px > -60 && px < vw + 20 && py > -10 && py < vh)
        for (let i = 0; i < 4; i++) {
          const xx = px + i * 9;
          const yy = py + i * 2 + Math.round(Math.sin(t * 1.2 + i * 0.7));
          g.fillStyle = '#7a7080';
          g.fillRect(xx - 3, yy, 7, 1);
          g.fillStyle = '#b8b0a8';
          g.fillRect(xx - 1, yy - 1, 3, 1);
          g.fillStyle = '#e0b060';
          g.fillRect(xx - 3, yy - 1, 2, 1);
        }
    }
    // A far steamer on the horizon puffing smoke.
    const yH = ys(0.04);
    const sx = Math.round(mod(2200 - camX * 0.06 - t * 1.5, 1800) - 100);
    if (sx > -20 && sx < vw + 20 && yH < vh && yH > 0) {
      g.fillStyle = a === 'noche' ? '#4a4a78' : '#6a6a8a';
      g.fillRect(sx - 6, yH - 3, 13, 3);
      g.fillRect(sx - 1, yH - 6, 3, 3);
      for (let j = 0; j < 3; j++) {
        const ph = quieto ? j / 3 : mod(t * 0.25 + j / 3, 1);
        const sp = C.humo[Math.min(2, Math.floor(ph * 3))];
        g.drawImage(sp, Math.round(sx + ph * 10 - sp.width / 2), Math.round(yH - 8 - ph * 14 - sp.height / 2));
      }
    }
  }

  // Valparaíso at night: now and then a far firework blooms over the hills.
  if (mapa === 'valparaiso' && a === 'noche' && !quieto) {
    const PER = 11;
    const ciclo = Math.floor(t / PER);
    const u = (t - ciclo * PER) / 1.6;
    if (u < 1) {
      const fx = Math.round(vw * (0.2 + ((ciclo * 37) % 60) / 100));
      const fy = Math.round(ys(0.5) - 90 - ((ciclo * 53) % 40));
      const rr = 3 + u * 15;
      g.globalAlpha = (1 - u) * 0.55;
      const cols = ['#ffe7a0', '#a8f0e0', '#ffffff'];
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * TAU;
        g.fillStyle = cols[(i + ciclo) % 3];
        g.fillRect(Math.round(fx + Math.cos(ang) * rr), Math.round(fy + Math.sin(ang) * rr + u * u * 6), 1, 1);
      }
      g.globalAlpha = 1;
    }
  }
}

/** A condor soaring in wide circles: black wings with white patches and fingered tips. */
function condor(g: Ctx, x: number, y: number, dir: number, t: number) {
  const tilt = Math.round(Math.sin(t * 0.7));
  g.fillStyle = '#3a3448';
  g.fillRect(x - 9, y + tilt, 8, 1);
  g.fillRect(x + 2, y - tilt, 8, 1);
  g.fillRect(x - 6, y - 1 + tilt, 5, 1);
  g.fillRect(x + 2, y - 1 - tilt, 5, 1);
  // Fingered tips.
  g.fillRect(x - 10, y - 1 + tilt, 1, 1);
  g.fillRect(x + 10, y - 1 - tilt, 1, 1);
  g.fillRect(x - 2, y - 1, 5, 2);
  g.fillStyle = '#e8e4f0';
  g.fillRect(x - 5, y + 1 + tilt, 3, 1);
  g.fillRect(x + 3, y + 1 - tilt, 3, 1);
  g.fillRect(x + (dir > 0 ? 2 : -2), y - 1, 1, 1);
  g.fillStyle = '#d88a7a';
  g.fillRect(x + (dir > 0 ? 3 : -3), y - 2, 1, 1);
}

/**
 * The long low sky between the landscape and the sea of clouds (real
 * altitude ~350–1500): cumulus at three depths (with light shafts under the
 * near ones in the afternoon), flocks, paragliders, condors circling, far
 * hot-air balloons, old contrails and a jet laying a new one (blinking
 * lights at night). Everything is a cached sprite or a few rects.
 */
function vidaMedia(g: Ctx, o: OpcionesFondo, C: Capas, V: Vida, t: number, altReal: number, f = 1) {
  const { vw, vh, camX, camY, ambiente: a } = o;
  const kM = f * ss(150, 420, altReal) * (1 - ss(1500, 1900, altReal));
  if (kM < 0.02) return;
  const quieto = !!o.quieto;
  const noche = a === 'noche';

  // Old contrails far up, crossing the sky at a slant.
  {
    const al = (noche ? 0.16 : 0.42) * kM;
    for (let i = 0; i < 2; i++) {
      const s = V.estelaVieja;
      const x = Math.round(mod(300 + i * 1300 - camX * 0.04 - t * 0.5, 2600) - 500);
      if (x > vw || x + s.width < 0) continue;
      const y = Math.round(vh * 0.3 + (camY - (1150 + i * 260)) * 0.28) - s.height;
      if (y > vh || y + s.height < 0) continue;
      g.globalAlpha = al;
      g.drawImage(s, x, y);
    }
    g.globalAlpha = 1;
  }

  // Cumulus, far to near.
  for (let d = 0; d < 3; d++) {
    const [ky, kx, v] = CUM_K[d];
    const spr = V.cumulos[d];
    for (let i = 0; i < CUMULOS.length; i++) {
      const c = CUMULOS[i];
      if (c[2] !== d) continue;
      const s = spr[c[3]];
      const x = Math.round(mod(c[0] - camX * kx - t * v, 3000) - 200);
      if (x > vw || x + s.width < 0) continue;
      const y = Math.round(vh * 0.32 + (camY - c[1]) * ky) - s.height;
      if (y > vh || y + s.height < 0) continue;
      if (kM < 1) g.globalAlpha = kM;
      g.drawImage(s, x, y);
      // Afternoon light shafts falling from under the near clouds.
      if (d === 2 && a === 'tarde') {
        g.globalAlpha = 0.11 * kM;
        g.drawImage(V.rayos, 0, 0, 70, 150, x + Math.round(s.width * 0.2), y + s.height - 4, 70, 150);
      }
      g.globalAlpha = 1;
    }
  }

  // Far hot-air balloons drifting high over the valley.
  if (o.paisaje !== 'oceano' && !noche) {
    g.globalAlpha = 0.8 * kM;
    for (let i = 0; i < 2; i++) {
      const s = C.globos[(i + 1) % C.globos.length];
      const x = Math.round(mod(900 + i * 1400 - camX * 0.12 - t * (1.2 + i * 0.5), 2800) - 100);
      if (x > vw || x + s.width < 0) continue;
      const y = Math.round(vh * 0.32 + (camY - (640 + i * 260)) * 0.45 + Math.sin(t * 0.6 + i) * 2) - s.height;
      if (y < vh && y + s.height > 0) g.drawImage(s, x, y);
    }
    g.globalAlpha = 1;
  }

  // Paragliders riding the coastal wind.
  if (!noche) {
    for (let i = 0; i < PARAPENTES.length; i++) {
      const [X, A] = PARAPENTES[i];
      const s = V.parapentes[i % V.parapentes.length];
      const x = Math.round(mod(X - camX * 0.3 + t * 3, 2800) - 200 + Math.sin(t * 0.3 + i) * 20);
      if (x > vw || x + s.width < 0) continue;
      const y = Math.round(vh * 0.32 + (camY - A) * 0.6 + Math.sin(t * 0.5 + i * 2) * 4);
      if (y > vh || y + s.height < 0) continue;
      g.drawImage(s, x, y);
    }
  }

  // Flocks crossing the mid sky, and condors circling on the thermals.
  if (C.pajaro) {
    for (let i = 0; i < AVES_MEDIAS.length; i++) {
      const [X, A] = AVES_MEDIAS[i];
      const bx = mod(X - t * (12 + i * 3) - camX * 0.35, 2800) - 200;
      const by = Math.round(vh * 0.32 + (camY - A) * 0.6 + Math.sin(t * 0.6 + i) * 3);
      if (bx > -40 && bx < vw + 40 && by > -10 && by < vh) bandada(g, C.pajaro, bx, by, t, 3 + (i % 3) * 2);
    }
    for (let i = 0; i < CONDORES.length; i++) {
      const [X, A] = CONDORES[i];
      const ang = (quieto ? 1 : t * 0.22) + i * 2.4;
      const x = Math.round(mod(X - camX * 0.3, 2800) - 200 + Math.cos(ang) * 50);
      const y = Math.round(vh * 0.32 + (camY - A) * 0.6 + Math.sin(ang) * 12);
      if (x < -20 || x > vw + 20 || y < -10 || y > vh) continue;
      condor(g, x, y, -Math.sin(ang) > 0 ? 1 : -1, t);
    }
  }

  // A jet crossing high: a fresh contrail by day, blinking lights at night.
  if (!quieto) {
    const f = mod(t / 46 + 0.4, 1);
    if (f < 0.75) {
      const u = f / 0.75;
      const jx = Math.round(vw + 40 - u * (vw + 400));
      const jy = Math.round(vh * 0.3 + (camY - 1300) * 0.3);
      if (jy > -5 && jy < vh) {
        if (!noche) {
          const e = V.estela;
          g.globalAlpha = 0.55 * kM;
          // The contrail trails to the right of a jet flying left: draw it mirrored.
          g.save();
          g.translate(jx + 3, jy);
          g.scale(-1, 1);
          g.drawImage(e, -e.width, 0);
          g.restore();
          g.globalAlpha = kM;
          g.fillStyle = '#e4e8f4';
          g.fillRect(jx, jy, 3, 2);
        } else {
          g.globalAlpha = kM;
          g.fillStyle = '#c8c8e0';
          g.fillRect(jx, jy + 1, 3, 1);
          if (Math.floor(t * 2) % 2) {
            g.fillStyle = '#ff6a8a';
            g.fillRect(jx - 1, jy, 1, 1);
            g.fillStyle = '#7affb0';
            g.fillRect(jx + 3, jy + 2, 1, 1);
          }
          if (Math.floor(t * 3) % 5 === 0) {
            g.fillStyle = '#ffffff';
            g.fillRect(jx + 1, jy, 1, 1);
          }
        }
        g.globalAlpha = 1;
      }
    }
  }
}

/**
 * Higher bands: cumulus towers and cloud bridges, sun rays in the afternoon,
 * a far storm flickering at night, a weather balloon, a jet contrail, ice
 * glints, a haze band, noctilucent clouds, the space station and the first
 * faint stars between the clouds and space.
 */
function vidaAlta(g: Ctx, o: OpcionesFondo, V: Vida, t: number, altMid: number, antes: boolean) {
  const { vw, vh, camX, ambiente: a } = o;
  const quieto = !!o.quieto;

  if (antes) {
    // Cloud towers rising out of the sea of clouds, and long cloud bridges.
    if (altMid > 450 && altMid < 1700) {
      for (let i = 0; i < TORRES.length; i++) {
        const [X, A, si] = TORRES[i];
        const s = V.torres[si];
        const x = Math.round(mod(X - camX * 0.12 - t * 0.6, 3000) - 200);
        if (x > vw || x + s.width < 0) continue;
        // Rooted in the sea of clouds (same top as in dibujarFondo), sinking a bit by altitude.
        const cyR = Math.round(o.camY);
        const topMar = Math.round(vh * 0.6 + (1 - ss(200, 750, cyR)) * vh * 0.45 + ss(1250, 1800, cyR) * vh * 0.55);
        const y = topMar + 10 + Math.round(Math.max(0, A - 800) * 0.04) - s.height;
        if (y > vh || y + s.height < 0) continue;
        g.drawImage(s, x, y);
      }
    }
    // Sun rays through the clouds in the afternoon.
    if (a === 'tarde') {
      const k = ss(300, 600, altMid) * (1 - ss(1100, 1400, altMid));
      if (k > 0.05) {
        g.globalAlpha = k * 0.28;
        g.drawImage(V.rayos, Math.round(vw * 0.7 - 40), Math.round(vh * 0.12));
        g.globalAlpha = 1;
      }
    }
    // A far storm cloud at night with a very soft flicker.
    if (a === 'noche' && altMid > 420 && altMid < 1500) {
      const [osc, luz] = V.tormenta;
      const x = Math.round(mod(1500 - camX * 0.08, 2400) - 200);
      const y = filaAlt(o, 900, 0.45, 0.5);
      if (x < vw && x + osc.width > 0 && y < vh && y + osc.height > 0) {
        g.drawImage(osc, x, y);
        const f = mod(t, 9.3);
        if (!quieto && (f < 0.08 || (f > 0.16 && f < 0.22))) {
          g.globalAlpha = 0.5;
          g.drawImage(luz, x, y);
          g.fillStyle = '#fff6c0';
          g.fillRect(x + 40, y + osc.height - 4, 1, 4);
          g.fillRect(x + 41, y + osc.height, 1, 3);
          g.fillRect(x + 40, y + osc.height + 3, 1, 3);
          g.globalAlpha = 1;
        }
      }
    }
    return;
  }

  // Long cloud bridges, in front of the sea of clouds.
  if (altMid > 650 && altMid < 1600) {
    for (let i = 0; i < PUENTES.length; i++) {
      const [X, A, si] = PUENTES[i];
      const s = V.puentes[si];
      const x = Math.round(mod(X - camX * 0.18 - t * 1.2, 2800) - 260);
      if (x > vw || x + s.width < 0) continue;
      const y = filaAlt(o, A, 0.5, 0.6);
      if (y > vh || y + s.height < 0) continue;
      g.drawImage(s, x, y);
    }
  }

  // The bright haze edge of the lower atmosphere.
  {
    const k = ss(1150, 1400, altMid) * (1 - ss(1700, 2000, altMid));
    if (k > 0.05) {
      g.globalAlpha = k * 0.3;
      tira(g, V.bruma, camX * 0.02, filaAlt(o, 1500, 0.55, 0.4), vw);
      g.globalAlpha = 1;
    }
  }

  // A weather balloon rising very slowly, and a high jet laying a contrail.
  if (altMid > 1050 && altMid < 2000) {
    const s = V.sonda;
    const A = 1200 + (quieto ? 250 : mod(t * 6, 600));
    const x = Math.round(mod(1100 - camX * 0.15, 2000) - 100 + Math.sin(t * 0.4) * 4);
    const y = filaAlt(o, A, 0.5, 0.7);
    if (x > -20 && x < vw && y > -30 && y < vh) g.drawImage(s, x, y);
    if (!quieto) {
      const f = mod(t / 50, 1);
      if (f < 0.7) {
        const e = V.estela;
        const jx = Math.round(-60 + (f / 0.7) * (vw + 300));
        const jy = filaAlt(o, 1600, 0.3, 0.35);
        if (jy > -5 && jy < vh) {
          g.globalAlpha = 0.6;
          g.drawImage(e, jx - e.width, jy);
          g.globalAlpha = 1;
          g.fillStyle = '#e4e8f4';
          g.fillRect(jx, jy, 3, 2);
        }
      }
    }
  }

  // Ice crystals glinting, and the first faint stars between clouds and space.
  {
    const kHielo = ss(1150, 1350, altMid) * (1 - ss(1800, 2050, altMid));
    const kEstr = ss(900, 1500, altMid) * (1 - ss(1700, 2100, altMid));
    if (kHielo > 0.05 || kEstr > 0.05) {
      for (let i = 0; i < CRISTALES.length; i++) {
        const [fx, fy, ph] = CRISTALES[i];
        const estrella = i % 2 === 0;
        const k = estrella ? kEstr : kHielo;
        if (k < 0.05) continue;
        const x = Math.round(mod(fx * (vw + 20) - camX * (estrella ? 0.03 : 0.1), vw + 20) - 10);
        const y = Math.round(mod(fy * vh * (estrella ? 0.6 : 1) + o.camY * (estrella ? 0.04 : 0.2), vh));
        const s = quieto ? 0.5 : Math.sin(t * (estrella ? 1.6 : 3.1) + ph * 6);
        if (!estrella && s < 0.82) continue;
        g.globalAlpha = k * (estrella ? 0.7 : 0.9);
        g.fillStyle = estrella ? '#fff8e4' : '#e8f8ff';
        g.fillRect(x, y, 1, 1);
        if (s > 0.9) {
          g.fillRect(x - 1, y, 3, 1);
          g.fillRect(x, y - 1, 1, 3);
        }
      }
      g.globalAlpha = 1;
    }
  }

  // Noctilucent clouds, brighter at dusk and night.
  {
    const k = ss(1700, 1900, altMid) * (1 - ss(2150, 2450, altMid)) * (a === 'dia' ? 0.5 : 1);
    if (k > 0.05) {
      g.globalAlpha = k * 0.6;
      for (let i = 0; i < V.noctilucentes.length; i++) {
        const s = V.noctilucentes[i];
        const x = Math.round(mod(400 + i * 900 - camX * 0.04 - t * 0.8, 1800) - 300);
        if (x > vw || x + s.width < 0) continue;
        g.drawImage(s, x, filaAlt(o, 1950 + i * 120, 0.35, 0.3));
      }
      g.globalAlpha = 1;
    }
  }

  // The space station crossing slowly, its light blinking.
  if (!quieto) {
    const k = ss(1850, 2150, altMid);
    if (k > 0.05) {
      const f = mod(t / 80, 1);
      if (f < 0.65) {
        const s = V.iss;
        const u = f / 0.65;
        const x = Math.round(-30 + u * (vw + 60));
        const y = Math.round(vh * 0.22 + u * vh * 0.05 + (o.camY - 2300) * 0.08);
        g.globalAlpha = k;
        g.drawImage(s, x, y);
        if (Math.floor(t * 1.5) % 2) {
          g.fillStyle = '#ffffff';
          g.fillRect(x + 13, y + 5, 1, 1);
        }
        g.globalAlpha = 1;
      }
    }
  }
}

/* ── The storm (ocean backdrop at night, heavy cloud and rain) and its clearing ── */

/** A ragged ceiling of storm cloud hanging from the top of the screen. Tiles in x. */
function techoTormenta(seed: number, cs: [string, string, string, string]) {
  const W = 512;
  const H = 128;
  const b = new Buf(W, H);
  const r = rng(seed);
  const [tinta, cuerpo, luz, sombra] = cs.map(P);
  b.rect(0, 0, W, 54, cuerpo);
  const bolas: [number, number, number][] = [];
  for (let x = 0; x < W; x += 10 + Math.floor(r() * 14)) bolas.push([x, 50 + r() * 34, 12 + Math.floor(r() * 20)]);
  for (const [x, y, rr] of bolas) b.disc(x, y, rr + 1, tinta);
  for (const [x, y, rr] of bolas) b.disc(x, y, rr, sombra);
  for (const [x, y, rr] of bolas) b.disc(x - 1, y - 3, rr - 2, cuerpo);
  // Lit rims on the lower lumps, and dithered mammatus pouches under them.
  for (const [x, y, rr] of bolas) {
    b.rect(x - Math.round(rr * 0.5), Math.round(y + rr - 2), Math.round(rr * 0.6), 1, luz);
    if (r() < 0.4) for (let i = 0; i < 5; i++) if (tramado(x + i, y + rr + 2, 0.5)) b.disc(x - 6 + i * 3, y + rr + 1, 2, sombra);
  }
  for (let y = 0; y < 30; y++) for (let x = 0; x < W; x++) if (tramado(x, y, 0.12) && (x * 7 + y * 3) % 5 === 0) b.d[y * W + x] = luz;
  return b.canvas();
}

/** The far storm bank on the horizon: cumulonimbus towers with flat anvils. */
function bancoTormenta(cs: [string, string, string, string]) {
  const W = 640;
  const H = 130;
  const b = new Buf(W, H);
  const r = rng(733);
  const [tinta, cuerpo, luz, sombra] = cs.map(P);
  const bolas: [number, number, number][] = [];
  for (let x = 0; x < W; x += 8 + Math.floor(r() * 10)) bolas.push([x, H - 14 - r() * 26, 12 + Math.floor(r() * 12)]);
  for (const cx of [90, 320, 500]) {
    const alto = 84 + Math.floor(r() * 26);
    // A broad cauliflower tower, widening as it climbs…
    for (let y = H - 24; y > H - alto + 14; y -= 7) {
      const k = (H - y) / alto;
      for (const dx of [-1, -0.35, 0.35, 1]) bolas.push([cx + dx * (18 + k * 14) + (r() - 0.5) * 6, y + (r() - 0.5) * 4, 11 + Math.floor(r() * 5)]);
    }
    // …under a billowing dome, with a soft shelf trailing downwind.
    for (let i = 0; i < 7; i++) {
      const ang = Math.PI * (0.1 + (0.8 * i) / 6);
      bolas.push([cx - Math.cos(ang) * 30, H - alto + 16 - Math.sin(ang) * 14, 12 + Math.floor(r() * 4)]);
    }
    for (let i = 0; i < 6; i++) bolas.push([cx + 34 + i * 9, H - alto + 14 + i * 3, 9 - i]);
  }
  for (const [x, y, rr] of bolas) b.disc(x, y, rr + 1, tinta);
  for (const [x, y, rr] of bolas) b.disc(x, y, rr, sombra);
  for (const [x, y, rr] of bolas) b.disc(x - 1, y - 2, rr - 2, cuerpo);
  // Rim light on the tops only (the far lightning catches the edges).
  for (let x = 0; x < W; x++)
    for (let y = 1; y < H; y++)
      if (b.d[y * W + x] === tinta && b.d[(y - 1) * W + x] === 0) {
        if (b.d[(y + 1) * W + x] === sombra || b.d[(y + 1) * W + x] === cuerpo) b.d[(y + 1) * W + x] = luz;
        break;
      }
  b.rect(0, H - 8, W, 8, sombra);
  return b.canvas();
}

/** A curtain of rain hanging under a cloud: slanted dithered streaks, fading toward the sea. */
function cortinaLluvia() {
  const W = 56;
  const H = 150;
  const b = new Buf(W, H);
  const c0 = P('#7a80bc');
  const c1 = P('#b8c0f0');
  const r = rng(61);
  // Short slanted streaks, thick under the cloud and thinning out toward the sea.
  for (let i = 0; i < 520; i++) {
    const x = r() * W;
    const y = r() * H;
    const e = Math.sin((x / W) * Math.PI) * (1 - (y / H) * 0.7);
    if (r() > e) continue;
    const col = r() < 0.2 ? c1 : c0;
    for (let j = 0; j < 5; j++) b.px(Math.round(x - j * 0.4), Math.round(y + j), col);
  }
  return b.canvas();
}

/** A far forked lightning bolt. */
function rayoLejano() {
  const W = 40;
  const H = 130;
  const b = new Buf(W, H);
  const r = rng(77);
  const borde = P('#8ab8ff');
  const nucleo = P('#ffffff');
  const trazo = (x: number, y: number, largo: number, rama: boolean) => {
    for (let i = 0; i < largo && y < H - 1; i++) {
      x += Math.round((r() - 0.5) * 3);
      y += 1 + Math.round(r());
      b.px(x - 1, y, borde);
      b.px(x + 1, y, borde);
      b.px(x, y, nucleo);
      if (!rama && r() < 0.05) trazo(x, y, 14 + Math.floor(r() * 16), true);
    }
  };
  trazo(W / 2, 0, 90, false);
  return b.canvas();
}

/** A big full moon with a wide soft halo, for the night after the storm. */
function lunaLlena() {
  const S = 150;
  const b = new Buf(S, S);
  const c = S / 2;
  for (const [rr, k, h] of [[72, 0.1, '#3a3a8a'], [60, 0.18, '#5a5aa8'], [50, 0.3, '#8a86d0'], [43, 0.5, '#b8b4ec']] as const)
    for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr && tramado(x + c, y + c, k)) b.px(c + x, c + y, P(h));
  const R = 36;
  b.disc(c, c, R + 1, P('#d8d0f4'));
  b.disc(c, c, R, P('#fffaf0'));
  for (const [x, y, r] of [[-12, -10, 8], [12, -15, 5], [-17, 10, 5], [8, 14, 7], [20, 0, 4], [-3, -22, 3], [22, 14, 3], [-24, -3, 3], [2, 2, 3]] as const) {
    b.disc(c + x, c + y, r, P('#ece4d4'));
    b.disc(c + x + 1, c + y + 1, Math.max(1, r - 1), P('#f6f0e2'));
    b.rect(c + x - r + 1, c + y - r, Math.max(1, r), 1, P('#ddd2c0'));
  }
  b.rect(c - 22, c - 24, 5, 2, P('#ffffff'));
  b.rect(c - 25, c - 20, 2, 4, P('#ffffff'));
  return b.canvas();
}

/** A distant whale: its back with the dorsal fin, and its fluke. Plain and bioluminescent versions. */
function ballenaLejos(glow: boolean) {
  const lomo = new Buf(26, 8);
  const cuerpo = P(glow ? '#1e2a5a' : '#4a5a8a');
  const luz = P(glow ? '#7af4ff' : '#9ab0d0');
  lomo.oval(13, 7, 12, 4, cuerpo);
  lomo.rect(16, 1, 2, 3, cuerpo);
  lomo.rect(15, 2, 1, 2, cuerpo);
  lomo.rect(6, 4, 12, 1, luz);
  lomo.outline(P(glow ? '#3ad8f0' : '#2e3a68'));
  const cola = new Buf(18, 14);
  cola.rect(8, 6, 3, 8, cuerpo);
  for (let i = 0; i < 7; i++) {
    cola.rect(9 - i - 1, 5 - Math.round(i * 0.6), 2, 2, cuerpo);
    cola.rect(9 + i, 5 - Math.round(i * 0.6), 2, 2, cuerpo);
  }
  cola.rect(3, 1, 3, 1, luz);
  cola.outline(P(glow ? '#3ad8f0' : '#2e3a68'));
  return [lomo.canvas(), cola.canvas()];
}

type Tormenta = { techo: Cv; techo2: Cv; techoLuz: Cv; banco: Cv; bancoLuz: Cv; cortina: Cv; rayo: Cv; luna: Cv; ballenas: Cv[]; ballenasGlow: Cv[] };
const NUBE_TORM: [string, string, string, string] = ['#141228', '#2a2848', '#6e6cae', '#1e1c38'];
const NUBE_TORM2: [string, string, string, string] = ['#1c1a36', '#3a3866', '#8a88c8', '#2a2850'];
const NUBE_LUZ: [string, string, string, string] = ['#5a5aa0', '#a8aee8', '#e6ecff', '#8088c8'];
const tareasTormenta = (): Tarea<Tormenta>[] => [
  (c) => ((c.techo = techoTormenta(801, NUBE_TORM)), (c.techoLuz = techoTormenta(801, NUBE_LUZ))),
  (c) => (c.techo2 = techoTormenta(802, NUBE_TORM2)),
  (c) => ((c.banco = bancoTormenta(NUBE_TORM2)), (c.bancoLuz = bancoTormenta(NUBE_LUZ))),
  (c) => ((c.cortina = cortinaLluvia()), (c.rayo = rayoLejano()), (c.luna = lunaLlena())),
  (c) => ((c.ballenas = ballenaLejos(false)), (c.ballenasGlow = ballenaLejos(true))),
];
const TORMENTA = new Obra(tareasTormenta());

/** Set by dibujarFondo each frame for the ocean backdrop: storm strength and how clear it is. */
let K_TORM = 0;
let K_DESP = 0;

/** Rain curtains on the horizon: [world x, width scale ×10, drift]. */
const CORTINAS: [number, number, number][] = [[120, 10, 3], [420, 14, 4], [760, 9, 2.5], [1150, 12, 3.5], [1500, 10, 4.5]];
/** Distant whales: [world x, depth 0..1, period s, phase]. */
const BALLENAS: [number, number, number, number][] = [[400, 0.1, 19, 0], [1300, 0.22, 23, 0.4], [2100, 0.14, 29, 0.75]];
/** Bioluminescent glints on the far sea: [x 0..1, depth 0..1, phase]. */
const BIOLUZ: [number, number, number][] = (() => {
  const r = rng(812);
  return Array.from({ length: 60 }, () => [r(), Math.pow(r(), 0.7), r() * 10] as [number, number, number]);
})();

const AMBIENTES: Ambiente[] = ['dia', 'tarde', 'noche'];
const BAJO = {} as Record<Ambiente, Obra<Capas>>;
const ALTO = {} as Record<Ambiente, Obra<Alto>>;
const MAR = {} as Record<Ambiente, Obra<Mar>>;
const VALPO = {} as Record<Ambiente, Obra<Valpo>>;
const SANANTONIO = {} as Record<Ambiente, Obra<SA>>;
const VIDA = {} as Record<Ambiente, Obra<Vida>>;
for (const a of AMBIENTES) {
  VIDA[a] = new Obra(tareasVida(a));
  SANANTONIO[a] = new Obra(tareasSA(a));
  VALPO[a] = new Obra(tareasValpo(a));
  BAJO[a] = new Obra(tareas(a));
  ALTO[a] = new Obra(tareasAlto(a));
  MAR[a] = new Obra(tareasMar(a));
}
const ESPACIO = new Obra(tareasEspacio());
const ORDEN: Obra<unknown>[] = [BAJO.dia, SANANTONIO.dia, BAJO.tarde, SANANTONIO.tarde, BAJO.noche, SANANTONIO.noche, ESPACIO, ALTO.dia, ALTO.tarde, ALTO.noche, MAR.dia, MAR.tarde, MAR.noche, VALPO.dia, VALPO.tarde, VALPO.noche, VIDA.dia, VIDA.tarde, VIDA.noche] as Obra<unknown>[];

ORDEN.push(TORMENTA as Obra<unknown>);

/**
 * Pinta por adelantado lo que falte, de a poco (unos ms por llamada; cada
 * tarea sola tarda menos de ~10 ms). `dibujarFondo` ya lo hace solo; sirve
 * para llamarlo en momentos tranquilos (menú, pausa).
 */
export function precalentarFondo(presupuestoMs = 6) {
  const t0 = performance.now();
  for (const ob of ORDEN)
    while (!ob.hecho) {
      ob.paso();
      if (performance.now() - t0 > presupuestoMs) return false;
    }
  return true;
}

/* ── Dibujo por cuadro ──────────────────────────────────────────────────── */

let VH = 0;

function tira(g: Ctx, c: Cv, off: number, yBase: number, vw: number) {
  const W = c.width;
  const y = Math.round(yBase - c.height);
  if (y >= VH || y + c.height <= 0) return;
  let x = -mod(Math.round(off), W);
  for (; x < vw; x += W) g.drawImage(c, x, y);
}

/** Repite `c` en x e y sobre las filas [0, y1), desplazado (ox, oy). */
function mosaico(g: Ctx, c: Cv, ox: number, oy: number, vw: number, y1: number) {
  const W = c.width;
  const H = c.height;
  const x0 = -mod(Math.round(ox), W);
  for (let y = -mod(Math.round(oy), H); y < y1; y += H) {
    const h = Math.min(H, y1 - y);
    for (let x = x0; x < vw; x += W) g.drawImage(c, 0, 0, W, h, x, y, W, h);
  }
}

function nubes(g: Ctx, lista: Nube[], spr: Cv[], par: number, base: number, o: OpcionesFondo, drift: number) {
  for (let i = 0; i < lista.length; i++) {
    const n = lista[i];
    const s = spr[n.i % spr.length];
    const x = mod(n.x - o.camX * par - drift * n.v, NUBE_W) - 170;
    if (x > o.vw) continue;
    const y = Math.round(base - n.el - s.height);
    if (y > o.vh || y + s.height < 0) continue;
    g.drawImage(s, Math.round(x), y);
  }
}

/** Sprite de fondo lejano: x envuelto en el mundo, y anclado a una altitud de cámara. */
function pon(g: Ctx, o: OpcionesFondo, s: Cv, X: number, kx: number, fy: number, A: number, k: number) {
  const x = Math.round(mod(X - o.camX * kx, 1500) - 200);
  if (x > o.vw || x + s.width < 0) return;
  const y = Math.round(o.vh * fy + (o.camY - A) * k - s.height / 2);
  if (y > o.vh || y + s.height < 0) return;
  g.drawImage(s, x, y);
}

/** Bandada en V de `n` pajaritos que aletean. */
function bandada(g: Ctx, col: string, bx: number, by: number, t: number, n: number) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const side = i === 0 ? 0 : i % 2 ? 1 : -1;
    const rank = Math.ceil(i / 2);
    const x = Math.round(bx + rank * 7);
    const y = by + side * rank * 5 + rank * 1;
    if (Math.floor(t * 5 + i * 1.3) % 2) {
      g.fillRect(x - 2, y - 1, 1, 1);
      g.fillRect(x + 2, y - 1, 1, 1);
      g.fillRect(x - 1, y, 1, 1);
      g.fillRect(x + 1, y, 1, 1);
      g.fillRect(x, y + 1, 1, 1);
    } else {
      g.fillRect(x - 2, y + 1, 2, 1);
      g.fillRect(x + 1, y + 1, 2, 1);
      g.fillRect(x, y, 1, 2);
    }
  }
}

/** Estrella fugaz / meteorito: cabeza y estela diagonal de 2 px. */
function fugaz(g: Ctx, x0: number, y0: number, cab: string, cola: string, largo: number) {
  g.fillStyle = cab;
  g.fillRect(x0, y0, 2, 1);
  g.fillStyle = cola;
  for (let i = 1; i < largo; i++) g.fillRect(x0 - i * 2, y0 - Math.round(i * 0.85), 2, 1);
}

/** Luces del ovni grande, que corren por el borde del platillo. */
function lucesOvni(g: Ctx, x: number, y: number, t: number) {
  for (let i = 0; i < 5; i++) {
    g.fillStyle = LUCES_OVNI[(i + Math.floor(t * 6)) % 4];
    g.fillRect(x + 6 + i * 5, y + 12, 2, 1);
  }
}

/** The options as the high sky sees them (camera in sky altitude); reused every frame. */
const OE: OpcionesFondo = { vw: 0, vh: 0, camX: 0, camY: 0, horizonte: 0, t: 0, ambiente: 'dia' };

export function dibujarFondo(g: Ctx, o: OpcionesFondo): void {
  const { vw, vh, camX, camY, ambiente: a } = o;
  VH = vh;
  const t = o.quieto ? 0 : o.t;
  const hz = Math.round(o.horizonte);
  /** Línea base de una capa con paralaje vertical k (0.5 = el horizonte). */
  const ys = (k: number) => Math.round(hz + camY * (k - 0.5));
  g.imageSmoothingEnabled = false;

  // Altitud «de cielo» (ver altCielo) del centro, la fila de arriba y la de abajo.
  // The landscape and the low sky keep the real camera; everything high uses `cy`.
  const altReal = camY + vh * 0.5;
  const altMid = altCielo(altReal);
  const cy = Math.round(altMid - vh * 0.5);
  const altTop = cy + vh - 16;
  const altBot = cy - 15;
  OE.vw = vw;
  OE.vh = vh;
  OE.camX = camX;
  OE.camY = cy;
  OE.ambiente = a;
  OE.quieto = o.quieto;
  OE.paisaje = o.paisaje;
  const C = BAJO[a].todo();
  // The storm map: how stormy (kT) and how clear (kD) the night is.
  const tormenta = o.tormenta ?? (o.paisaje === 'oceano' && o.costa === 0.5);
  const kD = tormenta ? Math.min(1, Math.max(0, o.despeje ?? 0)) : 0;
  const kT = tormenta ? 1 - kD : 0;
  const TO = tormenta ? TORMENTA.todo() : null;
  K_TORM = kT;
  K_DESP = kD;
  const alto = altTop > ALTO_LO - 30;
  const H = alto ? ALTO[a].todo() : null;
  const E = alto ? ESPACIO.todo() : null;

  // Cielo bajo (anclado al horizonte), mientras se vea.
  if (altBot < ALTO_OPACO) {
    const sky = C.cielo;
    const skyTop = hz - SKY_H;
    if (skyTop > 0) {
      g.fillStyle = sky.top;
      g.fillRect(0, 0, vw, skyTop);
    }
    if (skyTop < vh && hz > 0) for (let x = 0; x < vw; x += sky.cv.width) g.drawImage(sky.cv, x, skyTop);
    if (hz < vh) {
      g.fillStyle = sky.bottom;
      g.fillRect(0, hz, vw, vh - hz);
    }

    // Estrellas, aurora y estrellas que titilan (hidden while the storm lasts).
    const yEst = ys(0.2);
    g.globalAlpha = 1 - kT;
    if (C.estrellas && kT < 0.98) tira(g, C.estrellas, camX * 0.02, yEst, vw);
    if (a === 'noche' && kT < 0.98) {
      g.fillStyle = '#fffbe8';
      for (let i = 0; i < TITILA.length; i++) {
        const s = TITILA[i];
        const x = Math.round(mod(s.x * (vw + 20) - camX * 0.02, vw + 20)) - 10;
        const y = yEst - Math.round(s.el);
        if (y < -2 || y > vh) continue;
        const ph = Math.sin(t * 1.7 + s.f * 6);
        g.fillRect(x, y, 1, 1);
        if (ph > -0.2) {
          g.fillRect(x - 1, y, 3, 1);
          g.fillRect(x, y - 1, 1, 3);
        }
        if (ph > 0.75) {
          g.fillRect(x - 2, y, 5, 1);
          g.fillRect(x, y - 2, 1, 5);
        }
      }
      // Estrella fugaz de vez en cuando.
      if (!o.quieto) {
        const ciclo = Math.floor(t / 7);
        const f = t / 7 - ciclo;
        if (f < 0.1) {
          const k = f / 0.1;
          const sx = ((ciclo * 397) % 100) / 100;
          fugaz(g, Math.round(vw * (0.15 + sx * 0.6) + k * 70), yEst - 330 + ((ciclo * 53) % 120) + Math.round(k * 30), '#ffffff', '#e6dcff', 6);
        }
      }
    }
    g.globalAlpha = 1;
  }

  // The storm darkens the sky; as it clears, a big full moon comes out.
  if (TO) {
    if (kT > 0.01) {
      g.globalAlpha = 0.55 * kT;
      g.fillStyle = '#121026';
      g.fillRect(0, 0, vw, vh);
      g.globalAlpha = 1;
    }
  }

  // Cielo alto, indexado por altitud: se funde tramado con el de abajo.
  if (H) {
    const cv = H.cielo.cv;
    let sy = ALTO_HI - altTop;
    let dy = 0;
    if (sy < 0) {
      g.fillStyle = H.cielo.top;
      g.fillRect(0, 0, vw, Math.min(vh, -sy));
      dy = -sy;
      sy = 0;
    }
    const h = Math.min(vh - dy, ALTO_H - sy);
    if (h > 0) for (let x = 0; x < vw; x += cv.width) g.drawImage(cv, 0, sy, cv.width, h, x, dy, cv.width, h);
  }

  // Estrellas del espacio (3 profundidades), nebulosas y galaxia.
  const kEst = E ? ss(1250, 2050, altMid) : 0;
  const kEsp = E ? ss(1750, 2150, altMid) : 0;
  if (E && kEst > 0) {
    const yLim = Math.min(vh, altTop - 1200);
    if (yLim > 0) {
      g.globalAlpha = kEst;
      mosaico(g, E.estrellas[0], camX * 0.02, 40 - cy * 0.03, vw, yLim);
      mosaico(g, E.estrellas[1], camX * 0.05 + 97, 101 - cy * 0.07, vw, yLim);
      if (kEsp > 0) {
        g.globalAlpha = kEsp * 0.9;
        for (let i = 0; i < DECOR.length; i++) {
          const d = DECOR[i];
          pon(g, OE, E.deco[d[0]], d[1], d[2], d[3], d[4], d[5]);
        }
        g.globalAlpha = kEst;
      }
      mosaico(g, E.estrellas[2], camX * 0.1 + 31, 17 - cy * 0.14, vw, yLim);
      // Estrellas que titilan.
      for (let i = 0; i < TITILA_ALTA.length; i++) {
        const s = TITILA_ALTA[i];
        const x = Math.round(mod(s.x * (vw + 20) - camX * 0.06, vw + 20)) - 10;
        const y = Math.round(mod(s.y * (vh + 20) + cy * 0.1, vh + 20)) - 10;
        if (y >= yLim || y < -3) continue;
        const ph = Math.sin(t * 1.9 + s.f * 6);
        g.fillStyle = COLOR_TITILA[s.c];
        g.fillRect(x, y, 1, 1);
        if (ph > -0.1) {
          g.fillRect(x - 1, y, 3, 1);
          g.fillRect(x, y - 1, 1, 3);
        }
        if (ph > 0.8) {
          g.fillRect(x - 2, y, 5, 1);
          g.fillRect(x, y - 2, 1, 5);
        }
      }
      g.globalAlpha = 1;
    }
  }

  // Aurora pastel de la estratósfera.
  if (E) {
    const kA = ss(1300, 1600, altMid) * (1 - ss(1850, 2150, altMid));
    if (kA > 0.02) {
      g.globalAlpha = kA * (0.28 + 0.05 * Math.sin(t * 0.5));
      tira(g, E.aurora, camX * 0.03 + t * 3, Math.round(vh * 0.5 + (cy - 1750) * 0.3), vw);
      g.globalAlpha = 1;
    }
  }

  // Sol, sol poniente o luna: bajan con la cámara solo al principio.
  {
    const cE = camY > 0 ? 200 * (1 - Math.exp(-camY / 200)) : camY;
    const ysA = (k: number) => Math.round(hz - camY * 0.5 + cE * k);
    const s = C.astro;
    const x = Math.round(vw * (a === 'tarde' ? 0.7 : 0.8) - s.width / 2);
    const cyA = a === 'tarde' ? ysA(0.3) - 100 : a === 'dia' ? ysA(0.25) - 168 : ysA(0.22) - 172;
    const kSol = a === 'dia' && E ? ss(300, 1000, altMid) : 0;
    const kLuna = tormenta ? 0 : a === 'noche' ? 1 - ss(1500, 1950, altMid) : 1;
    if (kLuna > 0 && kSol < 1) {
      g.globalAlpha = kLuna;
      g.drawImage(s, x, Math.round(cyA - s.height / 2));
      g.globalAlpha = 1;
    }
    if (E && kSol > 0) {
      g.globalAlpha = kSol;
      const so = E.sol;
      g.drawImage(so, Math.round(vw * 0.8 - so.width / 2), Math.round(cyA - so.height / 2));
      g.globalAlpha = 1;
    }
  }

  // After the storm, a big full moon (in front of the high sky's dither).
  if (TO && kD > 0.01) {
    const lu = TO.luna;
    g.globalAlpha = kD;
    g.drawImage(lu, Math.round(vw * 0.72 - lu.width / 2), Math.round(Math.min(vh * 0.2, ys(0.2) - 260) - lu.height / 2 + (1 - kD) * 30));
    g.globalAlpha = 1;
  }

  // Planeta con anillos, Luna grande, cometa, satélite y meteoritos.
  if (E && kEsp > 0) {
    g.globalAlpha = kEsp;
    const dX = 1600 - camX;
    const pl = E.planeta;
    g.drawImage(pl, Math.round(vw * 0.13 + dX * 0.03 - pl.width / 2), Math.round(vh * 0.3 + (cy - 2300) * 0.12 - pl.height / 2));
    const lu = E.luna;
    g.drawImage(lu, Math.round(vw * 0.58 + dX * 0.05 - lu.width / 2), Math.round(vh * 0.24 + (cy - 2650) * 0.18 - lu.height / 2));
    const hi = E.hielo;
    g.drawImage(hi, Math.round(vw * 0.88 + dX * 0.02 - hi.width / 2), Math.round(vh * 0.5 + (cy - 2400) * 0.08 - hi.height / 2));
    if (!o.quieto) {
      const ciclo = Math.floor(t / 34);
      const f = t / 34 - ciclo;
      if (f < 0.7) {
        const k = f / 0.7;
        const co = E.cometa;
        g.drawImage(co, Math.round(vw + 40 - k * (vw + 180)), Math.round(vh * (0.05 + ((ciclo * 3) % 5) * 0.03) + k * vh * 0.2));
      }
    }
    g.globalAlpha = 1;
  }
  if (E && !o.quieto) {
    const kSat = ss(1550, 1850, altMid);
    if (kSat > 0) {
      const f = mod(t / 23, 1);
      if (f < 0.55) {
        const k = f / 0.55;
        const sa = E.satelite;
        const x = Math.round(vw + 20 - k * (vw + 50));
        const y = Math.round(vh * 0.1 + k * vh * 0.07);
        g.globalAlpha = kSat;
        g.drawImage(sa, x, y);
        if (Math.floor(t * 2) % 2) {
          g.fillStyle = '#ff7a9a';
          g.fillRect(x + 11, y, 1, 1);
        }
        g.globalAlpha = 1;
      }
    }
    // A train of small satellites gliding across in a line, catching the sun one by one.
    if (kEsp > 0.1) {
      const f = mod(t / 37, 1);
      if (f < 0.6) {
        const u = f / 0.6;
        const x0 = Math.round(-120 + u * (vw + 240));
        const y0 = Math.round(vh * 0.36 - u * vh * 0.12);
        g.globalAlpha = kEsp * 0.9;
        for (let i = 0; i < 14; i++) {
          const x = x0 - i * 9;
          const y = y0 + Math.round(i * 2.2);
          if (x < -2 || x > vw) continue;
          g.fillStyle = Math.floor(t * 4 - i * 0.5) % 6 === 0 ? '#ffffff' : '#b8c4e8';
          g.fillRect(x, y, 1, 1);
        }
        g.globalAlpha = 1;
      }
    }
    if (kEst > 0.15) {
      const ciclo = Math.floor(t / 4.3);
      const f = t / 4.3 - ciclo;
      if (f < 0.09) {
        const k = f / 0.09;
        const sx = ((ciclo * 397) % 100) / 100;
        const sy = ((ciclo * 211) % 100) / 100;
        g.globalAlpha = kEst;
        fugaz(g, Math.round(vw * (0.1 + sx * 0.7) + k * 80), Math.round(vh * (0.05 + sy * 0.4) + k * 34), '#ffffff', ciclo % 2 ? '#ffc8e4' : '#bfeeff', 7);
        g.globalAlpha = 1;
      }
    }
  }

  // Cirros altos (mar de nubes y estratósfera).
  if (H) {
    for (let i = 0; i < CIRROS_ALTOS.length; i++) {
      const n = CIRROS_ALTOS[i];
      const s = H.cirros[n.i];
      const y = Math.round(vh * 0.4 + (cy - n.el) * 0.4);
      if (y > vh || y + s.height < 0) continue;
      const x = mod(n.x - camX * 0.05 - t * n.v, NUBE_W) - 170;
      if (x > vw) continue;
      g.drawImage(s, Math.round(x), y);
    }
  }

  // La Tierra: un arco con atmósfera, abajo, desde la estratósfera.
  if (H) {
    const top = vh * 0.68 + (1 - ss(1150, 1750, cy)) * vh * 0.6 + ss(1900, 2900, cy) * vh * 0.12;
    const y = Math.round(top) - TIERRA_AP;
    if (y < vh) {
      g.drawImage(H.tierra.cv, Math.round(vw / 2 - TIERRA_W / 2 + (1600 - camX) * 0.02), y);
      if (y + TIERRA_H < vh) {
        g.fillStyle = H.tierra.fondo;
        g.fillRect(0, y + TIERRA_H, vw, vh - y - TIERRA_H);
      }
    }
  }

  // Todo el paisaje de abajo (solo si asoma).
  if (ys(0.2) - 380 < vh) {
    if (o.paisaje === 'oceano') dibujarOceano(g, o, C, MAR[a].todo(), t, ys);
    else if (o.paisaje === 'valparaiso') dibujarValpo(g, o, C, VALPO[a].todo(), t, ys);
    else dibujarCampo(g, o, C, SANANTONIO[a].todo(), t, ys);
  }

  // Sky life: kites, flocks and sea birds low; cloud towers, rays and a far storm higher.
  const VI = VIDA[a].todo();
  if (ys(0.2) - 380 < vh) vidaBaja(g, o, C, VI, t, ys);
  if (kT < 0.6) vidaMedia(g, o, C, VI, t, altReal, 1 - kT / 0.6);
  // The storm's cloud ceiling, rising and drifting away as it clears.
  if (TO && kT > 0.01) techoTormentaFrame(g, o, TO, t, kT, kD);
  vidaAlta(g, OE, VI, t, altMid, true);

  // Mar de nubes: sube a tapar el campo y se hunde al llegar a la estratósfera.
  if (H) {
    const m = H.mar;
    const top = Math.round(vh * 0.6 + (1 - ss(200, 750, cy)) * vh * 0.45 + ss(1250, 1800, cy) * vh * 0.55);
    if (top < vh) {
      tira(g, m.lejos, camX * 0.04 + t, top + m.lejos.height, vw);
      const yc = top + 14;
      const cc = m.cerca;
      tira(g, cc, camX * 0.09 + t * 2.2, yc + cc.height, vw);
      // Debajo, la textura de lomos se repite hacia abajo.
      const sy = cc.height - m.periodo;
      const off = -mod(Math.round(camX * 0.09 + t * 2.2), cc.width);
      for (let y = yc + cc.height; y < vh; y += m.periodo)
        for (let x = off; x < vw; x += cc.width) g.drawImage(cc, 0, sy, cc.width, m.periodo, x, y, cc.width, m.periodo);
    }
  }

  // Cosas que vuelan sobre el mar de nubes: globo, aves y un avión lejano.
  if (H && E) {
    const gl = C.globos[2];
    const yg = Math.round(vh * 0.45 + (cy - 880) * 0.6 + Math.sin(t * 0.8) * 2);
    if (yg < vh && yg + gl.height > 0) {
      const x = mod(700 - camX * 0.2 - t * 2, 2000) - 30;
      if (x < vw) g.drawImage(gl, Math.round(x), yg);
    }
    if (C.pajaro) {
      for (let j = 0; j < 2; j++) {
        const by = Math.round(vh * 0.4 + (cy - (760 + j * 330)) * 0.5 + Math.sin(t * 0.7 + j) * 4);
        if (by < -20 || by > vh + 20) continue;
        const bx = mod(1200 + j * 900 - t * 14 - camX * 0.3, 2200) - 200;
        if (bx > -40 && bx < vw + 40) bandada(g, C.pajaro, bx, by, t, 3 + j * 2);
      }
    }
    const ya = Math.round(vh * 0.35 + (cy - 1120) * 0.45);
    if (ya > -20 && ya < vh) {
      const av = E.avion;
      const x = Math.round(mod(t * 10 - camX * 0.12 + 300, 2000) - 200);
      if (x > -av.width && x - E.estela.width < vw) {
        g.globalAlpha = 0.75;
        g.drawImage(E.estela, x - E.estela.width + 2, ya + 5);
        g.globalAlpha = 1;
        g.drawImage(av, x, ya);
        if (Math.floor(t * 1.5) % 2) {
          g.fillStyle = '#ff6a8a';
          g.fillRect(x + 17, ya + 11, 1, 1);
        }
      }
    }
  }

  // Sky life above the sea of clouds: bridges, haze, balloon, contrail, glints, noctilucent clouds, the station.
  vidaAlta(g, OE, VI, t, altMid, false);

  // Ovnis: dos lejanos que flotan y uno que cruza (a veces con su rayo).
  if (E && kEsp > 0.05) {
    g.globalAlpha = kEsp;
    const oc = E.ovniChico;
    for (let i = 0; i < OVNIS_LEJOS.length; i++) {
      const u = OVNIS_LEJOS[i];
      const x = Math.round(mod(u.x - camX * 0.2 + Math.sin(t * 0.4 + u.f) * 20, 1500) - 200);
      if (x < -20 || x > vw) continue;
      const y = Math.round(vh * u.y + (cy - 2400) * 0.25 + Math.sin(t * 1.3 + u.f) * 3);
      g.drawImage(oc, x, y);
      g.fillStyle = LUCES_OVNI[(Math.floor(t * 3) + i) % 4];
      g.fillRect(x + 3 + (Math.floor(t * 3) % 3) * 4, y + 6, 1, 1);
    }
    if (!o.quieto) {
      const PER = 13;
      const ciclo = Math.floor(t / PER);
      const k = (t / PER - ciclo) / 0.62;
      if (k < 1) {
        const pos = 0.5 * ss(0, 0.38, k) + 0.5 * ss(0.62, 1, k);
        const dir = ciclo % 2 ? -1 : 1;
        const ov = E.ovni;
        const x = Math.round(dir > 0 ? -40 + pos * (vw + 80) : vw + 40 - pos * (vw + 80)) - 16;
        const y = Math.round(vh * (0.14 + ((ciclo * 7) % 5) * 0.05) + Math.sin(t * 3) * 2);
        if (k > 0.4 && k < 0.6 && ciclo % 3 !== 1) {
          const kr = Math.min(1, (k - 0.4) * 25, (0.6 - k) * 25);
          g.globalAlpha = kEsp * kr * (0.55 + 0.15 * Math.sin(t * 20));
          g.drawImage(E.rayo, x + 16 - 23, y + 16);
          g.globalAlpha = kEsp;
        }
        g.drawImage(ov, x, y);
        lucesOvni(g, x, y, t);
      }
    }
    g.globalAlpha = 1;
  }

  // Precalienta de a poco lo que falte (una tarea por cuadro).
  if (!ALTO[a].hecho) ALTO[a].paso();
  else if (!ESPACIO.hecho) ESPACIO.paso();
  else
    for (let i = 0; i < ORDEN.length; i++)
      if (!ORDEN[i].hecho) {
        ORDEN[i].paso();
        break;
      }
}

/** The storm ceiling: two layers of heavy cloud at the top, lit by far lightning now and then. */
function techoTormentaFrame(g: Ctx, o: OpcionesFondo, TO: Tormenta, t: number, kT: number, kD: number) {
  const { vw, camX } = o;
  const quieto = !!o.quieto;
  const sube = kD * kD * 150;
  const lejos = kD * kD * 700;
  // Hung low enough that its lumps show under the HUD.
  const y1 = Math.round(TO.techo.height + 40 - sube);
  const y2 = Math.round(TO.techo2.height * 0.85 - sube * 1.3);
  g.globalAlpha = Math.min(1, kT * 1.4);
  tira(g, TO.techo, camX * 0.05 + t * 3 + lejos, y1, vw);
  // A flash inside the cloud: the same ceiling, lit, for a blink.
  if (!quieto) {
    const f = mod(t, 6.7);
    if (f < 0.07 || (f > 0.14 && f < 0.19)) {
      g.globalAlpha = 0.35 * kT;
      tira(g, TO.techoLuz, camX * 0.05 + t * 3 + lejos, y1, vw);
    }
  }
  g.globalAlpha = Math.min(1, kT * 1.2) * 0.9;
  tira(g, TO.techo2, camX * 0.1 + t * 7 + lejos * 1.6, y2, vw);
  g.globalAlpha = 1;
}

/** The storm on the horizon of the sea: a far bank of cumulonimbus, rain curtains and far lightning. */
function tormentaHorizonte(g: Ctx, o: OpcionesFondo, TO: Tormenta, t: number, yH: number) {
  const { vw, camX } = o;
  const kT = K_TORM;
  const quieto = !!o.quieto;
  const off = camX * 0.04 + t * 1.5 + K_DESP * K_DESP * 500;
  const yb = yH - 4;
  g.globalAlpha = kT;
  tira(g, TO.banco, off, yb, vw);
  // Rain curtains hanging from the bank down to the sea.
  const cv = TO.cortina;
  for (let i = 0; i < CORTINAS.length; i++) {
    const [X, w10, v] = CORTINAS[i];
    const w = Math.round((cv.width * w10) / 10);
    const x = Math.round(mod(X - off * 1.1 - t * v, 1800) - 150);
    if (x > vw || x + w < 0) continue;
    const top = yb - 70;
    const h = yH - top + 2;
    g.globalAlpha = kT * 0.9;
    g.drawImage(cv, 0, mod(Math.round(-t * 60), cv.height - h), cv.width, h, x, top, w, h);
  }
  // Far lightning: the bank lights up and sometimes a bolt reaches the sea.
  if (!quieto) {
    const PER = 4.1;
    const ciclo = Math.floor(t / PER);
    const f = t - ciclo * PER;
    if (f < 0.09 || (f > 0.16 && f < 0.24)) {
      const x = Math.round(vw * (0.1 + ((ciclo * 41) % 80) / 100));
      g.globalAlpha = 0.5 * kT;
      g.save();
      g.beginPath();
      g.rect(x - 140, 0, 280, yH);
      g.clip();
      tira(g, TO.bancoLuz, off, yb, vw);
      g.restore();
      if (ciclo % 2 === 0) {
        g.globalAlpha = kT;
        const r = TO.rayo;
        g.drawImage(r, x - r.width / 2, yH - r.height);
      }
    }
  }
  g.globalAlpha = 1;
}

/** Whales far out at sea: a back rolling by, a spout, then the fluke going down. Glowing at night. */
function ballenasLejos(g: Ctx, o: OpcionesFondo, TO: Tormenta, t: number, yH: number, yCerca: number) {
  const { vw, camX, ambiente: a } = o;
  const [lomo, cola] = a === 'noche' ? TO.ballenasGlow : TO.ballenas;
  const k = 1 - K_TORM;
  if (k < 0.05) return;
  g.globalAlpha = k;
  for (let i = 0; i < BALLENAS.length; i++) {
    const [X, d, PER, ph] = BALLENAS[i];
    const u = mod(t / PER + ph, 1);
    if (u > 0.5) continue;
    const x = Math.round(mod(X - camX * (0.09 + d * 0.3) - t * 2, 2600) - 200);
    if (x < -30 || x > vw + 30) continue;
    const y = Math.round(yH + d * (yCerca - yH));
    if (u < 0.28) {
      // The back rolls up and down again.
      const v = u / 0.28;
      const h = Math.round(lomo.height * Math.sin(v * Math.PI));
      if (h > 0) g.drawImage(lomo, 0, 0, lomo.width, h, x - Math.round(v * 6), y - h, lomo.width, h);
      if (v > 0.15 && v < 0.6) {
        const s = (v - 0.15) / 0.45;
        const H = Math.round(14 * Math.sin(s * Math.PI));
        g.fillStyle = a === 'noche' ? '#9af6ff' : '#f4f8ff';
        for (let j = 0; j < H; j += 2) {
          const sp = Math.round((j / 14) * 3);
          g.fillRect(x + 20 - sp, y - 6 - j, 1, 1);
          g.fillRect(x + 20 + sp, y - 6 - j, 1, 1);
        }
        g.fillRect(x + 19, y - 7 - H, 3, 1);
      }
    } else if (u > 0.34 && u < 0.5) {
      // The fluke lifts and slips under.
      const v = (u - 0.34) / 0.16;
      const h = Math.round(cola.height * Math.sin(v * Math.PI));
      if (h > 0) g.drawImage(cola, 0, 0, cola.width, h, x + 4, y - h, cola.width, h);
      if (v > 0.5) {
        g.fillStyle = a === 'noche' ? '#7af4ff' : '#ffffff';
        g.fillRect(x + 4, y - 1, 18, 1);
      }
    }
  }
  g.globalAlpha = 1;
}

/** Seagull: white wings with an ink edge under them, flapping. */
function gaviota(g: Ctx, x: number, y: number, up: boolean, tinta: string) {
  const px = (dx: number, dy: number, w: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x + dx, y + dy, w, 1);
  };
  if (up) {
    px(-4, -1, 1, tinta);
    px(3, -1, 1, tinta);
    px(-3, 0, 2, tinta);
    px(1, 0, 2, tinta);
    px(-1, 1, 2, tinta);
    px(-4, -2, 1, '#ffffff');
    px(3, -2, 1, '#ffffff');
    px(-3, -1, 2, '#ffffff');
    px(1, -1, 2, '#ffffff');
    px(-1, 0, 2, '#ffffff');
  } else {
    px(-4, 1, 3, tinta);
    px(2, 1, 3, tinta);
    px(-1, 1, 2, tinta);
    px(-4, 0, 3, '#ffffff');
    px(2, 0, 3, '#ffffff');
    px(-1, -1, 2, '#ffffff');
    px(-1, 0, 2, '#ffffff');
  }
  px(-2, 0, 1, '#ffb43a');
}

/** A tiling strip with only its top `H - dy` rows shown, sitting on `yBase` (sunk by `dy`). */
function tiraHundida(g: Ctx, c: Cv, off: number, yBase: number, vw: number, dy: number) {
  const W = c.width;
  const h = c.height - Math.max(0, Math.round(dy));
  if (h <= 0 || yBase - h >= VH || yBase <= 0) return;
  for (let x = -mod(Math.round(off), W); x < vw; x += W) g.drawImage(c, 0, 0, W, h, x, yBase - h, W, h);
}

/** The sea under the sky: clouds, the coast, bands of water, glitter, boats and gulls. */
function dibujarOceano(g: Ctx, o: OpcionesFondo, C: Capas, M: Mar, t: number, ys: (k: number) => number) {
  const { vw, vh, camX, ambiente: a } = o;
  const drift = t;

  // All the clouds go behind the sea, so none ever sits on the water.
  nubes(g, CIRROS, C.cirros, 0.03, ys(0.2), o, drift);
  nubes(g, NUBES_LEJOS, C.lejos, 0.06, ys(0.3), o, drift);
  // A flat sea keeps its horizon near eye level: it barely sinks as we climb.
  // In the storm the sea's horizon is held up on screen (at most 70% down) so the
  // rain on the horizon, and later the moonlit sea and its whales, can be seen.
  const lift = K_TORM + K_DESP > 0 ? Math.max(0, ys(0.04) - Math.round(vh * 0.7)) : 0;
  const ysM = (k: number) => ys(k) - lift;
  const yH = ysM(0.04);
  tira(g, C.banco, camX * 0.04 + t * 0.5, yH + 3, vw);
  nubes(g, NUBES_MEDIO, C.medio, 0.13, ys(0.4), o, drift);
  nubes(g, NUBES_CERCA, C.cerca, 0.22, ys(0.62), o, drift);
  if (yH >= vh) return;
  const TO = TORMENTA.hecho;
  if (TO && K_TORM > 0.01) tormentaHorizonte(g, o, TO, t, yH);

  // The coast on the horizon, drifting by as the ships sail north; then the sea.
  const costa = Math.min(1, Math.max(0, o.costa ?? 0));
  const offI = camX * 0.05 + (o.quieto ? 0 : (o.viaje ?? 0) * 6);
  // Between two places, the one behind sinks under the horizon as the next one rises.
  {
    const c2 = costa * 2;
    const i = Math.min(1, Math.floor(c2));
    // The next coast rises first, then the old one sinks: there's always land.
    const u = ss(0.2, 0.8, c2 - i);
    const H = COSTA_H;
    const hundeA = ss(0.5, 1, u);
    const subeB = ss(0, 0.5, u);
    if (hundeA < 1) tiraHundida(g, M.costas[i], offI, yH, vw, hundeA * H);
    if (subeB > 0) tiraHundida(g, M.costas[i + 1], offI + 600 * (1 - u), yH, vw, (1 - subeB) * H);
  }
  g.fillStyle = M.bandas[0].lejos;
  g.fillRect(0, yH, vw, vh - yH);
  const tops = [ysM(0.08), ysM(0.16), ysM(0.3), ysM(0.5), ysM(0.78)];
  const kx = [0.07, 0.11, 0.18, 0.3, 0.46];
  for (let i = 0; i < M.bandas.length; i++) {
    const bd = M.bandas[i];
    const y = tops[i];
    if (y >= vh) break;
    tira(g, bd.cv, camX * kx[i] + t * (1 + i * 1.4), y + bd.cv.height, vw);
    const yf = y + bd.cv.height;
    if (yf < vh) {
      g.fillStyle = bd.fondo;
      g.fillRect(0, yf, vw, vh - yf);
    }
  }
  // A floating «VALPO →» sign on the way, when Valparaíso is getting close.
  {
    const k = ss(0.6, 0.65, costa) * (1 - ss(0.82, 0.88, costa));
    if (k > 0.02) {
      const sx = Math.round(mod(vw * 0.75 - (o.quieto ? 0 : (o.viaje ?? 0) * 9) - camX * 0.3, vw + 300) - 150);
      const sy = Math.round(yH + (ysM(0.5) - yH) * 0.7);
      if (sy < vh && sy > 0) {
        g.globalAlpha = k;
        const bob = o.quieto ? 0 : Math.round(Math.sin(t * 1.6));
        g.fillStyle = '#6a5a4a';
        g.fillRect(sx + 13, sy - 10 + bob, 2, 10);
        g.fillStyle = '#e86a5c';
        g.fillRect(sx + 6, sy - 1 + bob, 16, 3);
        g.fillStyle = '#ffffff';
        g.fillRect(sx + 6, sy - 1 + bob, 16, 1);
        g.fillStyle = '#24427a';
        g.fillRect(sx - 1, sy - 19 + bob, 31, 9);
        g.fillStyle = '#fff6e5';
        g.fillRect(sx, sy - 18 + bob, 29, 7);
        escribir(g, 'VALPO →', sx + 2, sy - 17 + bob, '#24427a');
        g.globalAlpha = 1;
      }
    }
  }

  // Under the storm the sea goes dark and grey.
  if (K_TORM > 0.01) {
    g.globalAlpha = 0.5 * K_TORM;
    g.fillStyle = '#16142e';
    g.fillRect(0, yH, vw, vh - yH);
    g.globalAlpha = 1;
  }

  // Far bioluminescence on a clear night after the storm (and faintly on any night at sea).
  {
    const k = a === 'noche' ? Math.max(K_DESP, TO ? 0.35 * (1 - K_TORM) : 0) : 0;
    if (k > 0.02 && !o.quieto) {
      const deep = vh - yH;
      for (let i = 0; i < BIOLUZ.length; i++) {
        const [fx, d, ph] = BIOLUZ[i];
        const s = Math.sin(t * (1.3 + (i % 5) * 0.3) + ph * 6);
        if (s < 0.3) continue;
        const x = Math.round(mod(fx * (vw + 40) - camX * (0.08 + d * 0.4), vw + 40) - 20);
        const y = Math.round(yH + 3 + d * deep * 0.85);
        g.globalAlpha = k * (s - 0.2);
        g.fillStyle = i % 3 ? '#5ae8ff' : '#c8fff8';
        g.fillRect(x, y, 1 + Math.round(d * 3), 1);
      }
      g.globalAlpha = 1;
    }
  }
  if (TO) ballenasLejos(g, o, TO, t, yH, ysM(0.3));

  // A bright line where the sea meets the sky.
  g.fillStyle = a === 'noche' ? '#a890d8' : a === 'tarde' ? '#ffe8c4' : '#eefaff';
  g.globalAlpha = 1 - K_TORM * 0.7;
  g.fillRect(0, yH, vw, 1);
  g.globalAlpha = 1;

  // Glitter under the sun or the moon, wider as it comes closer (none under the storm,
  // a long bright path under the full moon once it clears).
  if (K_TORM < 0.99) {
    const luna = K_DESP > 0;
    const ax = Math.round(vw * (luna ? 0.72 : a === 'tarde' ? 0.7 : 0.8));
    const deep = vh - yH;
    const [c0, c1] = BRILLO[a];
    for (let i = 0; i < BRILLOS.length; i++) {
      const [sx, d, f, len] = BRILLOS[i];
      const on = o.quieto ? i % 3 !== 0 : Math.sin(t * 3 + f * 7) > -0.1;
      if (!on) continue;
      const y = Math.round(yH + 2 + d * deep * 0.9);
      const x = Math.round(ax + sx * (4 + d * 46) - len / 2);
      g.fillStyle = Math.sin(t * 5 + f) > 0.6 ? c1 : c0;
      g.globalAlpha = 1 - K_TORM;
      g.fillRect(x, y, len + Math.round(d * 3), 1);
      if (luna) {
        // The moon path: a second, wider shimmer.
        const x2 = Math.round(ax - sx * (6 + d * 70) - len);
        g.fillStyle = Math.sin(t * 4 + f * 3) > 0.3 ? '#fffaf0' : '#d8d0ff';
        g.globalAlpha = K_DESP * 0.8;
        g.fillRect(x2, y + 1, len * 2, 1);
      }
    }
    g.globalAlpha = 1;
  }

  // San Antonio's lighthouse: a lantern that winks, and a sweeping beam after sunset.
  if (costa < 0.25) {
    const x0 = -mod(Math.round(offI), COSTA_W);
    for (let rep = x0; rep < vw; rep += COSTA_W) {
      const lx = rep + FARO_SA[0];
      if (lx < -40 || lx > vw + 40) continue;
      const ly = yH - COSTA_H + FARO_SA[1];
      if (a !== 'dia') {
        const sw = o.quieto ? 0 : Math.cos(t * 1.3);
        const len = Math.round(Math.abs(sw) * 34);
        if (len > 3) {
          g.globalAlpha = 0.45;
          g.fillStyle = '#fff2b0';
          const dir = sw > 0 ? 1 : -1;
          g.fillRect(dir > 0 ? lx + 3 : lx - 2 - len, ly, len, 2);
          g.fillRect(dir > 0 ? lx + 3 + len - 6 : lx - 2 - len, ly - 1, 6, 4);
          g.globalAlpha = 1;
        }
        g.fillStyle = '#fff6c0';
        g.fillRect(lx - 3, ly, 1, 2);
        g.fillRect(lx + 3, ly, 1, 2);
      }
      if (o.quieto || Math.floor(t * 2) % 3) {
        g.fillStyle = '#ffffff';
        g.fillRect(lx, ly, 1, 1);
      }
    }
  }

  // Far ships crossing near the horizon, a faint wake behind them (hidden by the storm).
  if (K_TORM < 0.7) {
    g.globalAlpha = 1 - K_TORM / 0.7;
    for (let i = 0; i < BUQUES.length; i++) {
      const [X, d, v, si] = BUQUES[i];
      const s = M.buques[si];
      const x = Math.round(mod(X - camX * (0.06 + d * 0.3) + t * v, 2600) - 200);
      if (x > vw || x + s.width < 0) continue;
      const y = Math.round(yH + d * (ysM(0.6) - yH)) + 2;
      const izq = v < 0;
      if (izq) {
        g.save();
        g.translate(x + s.width, 0);
        g.scale(-1, 1);
        g.drawImage(s, 0, y - s.height);
        g.restore();
      } else g.drawImage(s, x, y - s.height);
      g.fillStyle = a === 'noche' ? '#8a80c8' : '#eefaff';
      const wl = 20 + (i % 2) * 10;
      g.fillRect(izq ? x + s.width - 2 : x - wl + 2, y - 2, wl, 1);
    }
    g.globalAlpha = 1;
  }

  // Sailboats bobbing on the water (they stay in port during the storm).
  if (K_TORM + K_DESP === 0) for (let i = 0; i < VELEROS.length; i++) {
    const [X, d, v] = VELEROS[i];
    const s = M.veleros[i % M.veleros.length];
    const x = Math.round(mod(X - camX * (0.09 + d * 0.3) + t * v, 2600) - 200);
    if (x > vw || x + s.width < 0) continue;
    const y = Math.round(yH + d * (ysM(0.6) - yH)) + Math.round(Math.sin(t * 1.4 + i * 2) * 0.8) - s.height + 3;
    if (y > vh) continue;
    g.drawImage(s, x, y);
  }

  // Seagulls gliding over the sea (they sleep at night).
  if (a !== 'noche') {
    const tinta = a === 'tarde' ? '#9a5a8a' : '#6a7cb8';
    const base = ysM(0.5);
    for (let i = 0; i < GAVIOTAS.length; i++) {
      const [X, el, f] = GAVIOTAS[i];
      const x = Math.round(mod(X - t * 12 - camX * 0.35, 2400) - 200);
      if (x < -10 || x > vw + 10) continue;
      const y = Math.round(base - el + Math.sin(t * 0.9 + f) * 5);
      if (y < -10 || y > vh) continue;
      gaviota(g, x, y, Math.floor(t * 4 + f * 2) % 3 === 0, tinta);
    }
  }
}

/** Valparaíso: far ridges, the bay with ships, cerros packed with houses and camanchaca. */
function dibujarValpo(g: Ctx, o: OpcionesFondo, C: Capas, V: Valpo, t: number, ys: (k: number) => number) {
  const { vw, vh, camX, ambiente: a } = o;
  const drift = t;
  nubes(g, CIRROS, C.cirros, 0.03, ys(0.2), o, drift);
  nubes(g, NUBES_LEJOS, C.lejos, 0.06, ys(0.3), o, drift);
  tira(g, C.banco, camX * 0.04 + t * 0.5, ys(0.27) - 30, vw);

  const capa = (c: { cv: Cv; fondo: string }, off: number, y: number) => {
    tira(g, c.cv, off, y, vw);
    if (y < vh) {
      g.fillStyle = c.fondo;
      g.fillRect(0, y, vw, vh - y);
    }
  };
  // Past Valparaíso the cerros give way to the coast north: the layer is cut
  // where the Recreo hill of the coast layer (same parallax) stands at full height.
  const centro = camX + vw / 2;
  const capaCorte = (c: { cv: Cv; fondo: string }, n: Norte, k: number, y: number) => {
    const xn = Math.round(vw / 2 + (COSTA_NORTE - centro) * k);
    if (xn >= vw) {
      capa(c, camX * k, y);
      return;
    }
    const xc = Math.max(0, Math.min(vw, xn + n.corte));
    if (xc > 0) {
      g.save();
      g.beginPath();
      g.rect(0, 0, xc, vh);
      g.clip();
      capa(c, camX * k, y);
      g.restore();
    }
    const top = Math.round(y - n.cv.height);
    if (top < vh && y > 0) {
      g.drawImage(n.cv, xn, top);
      for (let x = xn + n.cv.width; x < vw; x += n.cola.width) if (x + n.cola.width > 0) g.drawImage(n.cola, x, top);
    }
    if (y < vh) {
      g.fillStyle = n.fondo;
      g.fillRect(xc, y, vw - xc, vh - y);
    }
  };

  capa(V.lejos, camX * 0.08, ys(0.3));
  nubes(g, NUBES_MEDIO, C.medio, 0.13, ys(0.4), o, drift);
  // Camanchaca: coastal fog lying in bands over the hills.
  g.globalAlpha = 0.55;
  tira(g, V.bruma, camX * 0.12 + t * 3, ys(0.36) + 4, vw);
  g.globalAlpha = 1;
  capaCorte(V.medio, V.norteMedio, 0.22, ys(0.42) + 6);
  g.globalAlpha = 0.45;
  tira(g, V.bruma, camX * 0.3 + t * 5 + 21, ys(0.48) - 30, vw);
  g.globalAlpha = 1;

  // Gulls over the bay.
  if (a !== 'noche') {
    const tinta = a === 'tarde' ? '#9a5a8a' : '#6a7cb8';
    for (let i = 0; i < GAVIOTAS.length; i++) {
      const [X, el, f] = GAVIOTAS[i];
      const x = Math.round(mod(X - t * 12 - camX * 0.35, 2400) - 200);
      if (x < -10 || x > vw + 10) continue;
      const y = Math.round(ys(0.5) - el + Math.sin(t * 0.9 + f) * 5);
      if (y < -10 || y > vh) continue;
      gaviota(g, x, y, Math.floor(t * 4 + f * 2) % 3 === 0, tinta);
    }
  }
  nubes(g, NUBES_CERCA, C.cerca, 0.22, ys(0.62), o, drift);
  capaCorte(V.cerca, V.norteCerca, 0.4, ys(0.62) + 26);
}

/** San Antonio: the coastal range, then the sectors (eucalyptus → wetland → Barrancas → port → Cartagena). */
function dibujarCampo(g: Ctx, o: OpcionesFondo, C: Capas, S: SA, t: number, ys: (k: number) => number) {
  const { vw, vh, camX, ambiente: a } = o;
  const capa = (c: { cv: Cv; fondo: string }, k: number, y: number) => {
    // Wide canvases indexed by world x: no tiling, the sector shows up where it belongs.
    // The sector under the screen centre is the one under the camera.
    const x = -Math.round(camX * k + (SA_MID - vw / 2) * (1 - k) + SA_PAD);
    const top = y - c.cv.height;
    if (top < vh && y > 0) g.drawImage(c.cv, x, top);
    if (y < vh) {
      g.fillStyle = c.fondo;
      g.fillRect(0, y, vw, vh - y);
    }
  };

  // Cirrus and far clouds, the cloud bank, the coastal range and a little haze.
  const drift = t;
  nubes(g, CIRROS, C.cirros, 0.03, ys(0.2), o, drift);
  nubes(g, NUBES_LEJOS, C.lejos, 0.06, ys(0.3), o, drift);
  tira(g, C.banco, camX * 0.04 + t * 0.5, ys(0.27) - 30, vw);
  const yM = ys(0.29) - 2;
  capa(S.lejos, 0.1, yM);
  tira(g, C.niebla1, camX * 0.1, yM + 6, vw);

  // Mid clouds and balloons, then the sectors.
  nubes(g, NUBES_MEDIO, C.medio, 0.13, ys(0.4), o, drift);
  {
    const base = ys(0.42);
    for (let i = 0; i < C.globos.length; i++) {
      const s = C.globos[i];
      const x = mod(400 + i * 870 - camX * 0.16 - t * (2 + i), 2600) - 30;
      if (x > vw) continue;
      const y = base - 110 - i * 34 - s.height + Math.round(Math.sin(t * 0.8 + i * 2) * 2);
      if (y > vh) continue;
      g.drawImage(s, Math.round(x), y);
    }
  }
  const yP = ys(0.46) - 12;
  capa(S.medio, 0.35, yP);

  // Birds: a V over the wetland and gulls over the port.
  if (C.pajaro) {
    const bx = mod(1800 - t * 16 - camX * 0.45, 2400) - 200;
    const by = ys(0.5) - 120 + Math.round(Math.sin(t * 0.7) * 4);
    if (bx > -40 && bx < vw + 40 && by < vh + 10) bandada(g, C.pajaro, bx, by, t, 5);
    const tinta = a === 'tarde' ? '#9a5a8a' : '#6a7cb8';
    for (let i = 0; i < GAVIOTAS.length; i++) {
      const [X, el, f] = GAVIOTAS[i];
      const x = Math.round(mod(X - t * 12 - camX * 0.35, 2400) - 200);
      if (x < -10 || x > vw + 10) continue;
      const y = Math.round(ys(0.5) - el + Math.sin(t * 0.9 + f) * 5);
      if (y < -10 || y > vh) continue;
      gaviota(g, x, y, Math.floor(t * 4 + f * 2) % 3 === 0, tinta);
    }
  }

  // Near clouds and the near band.
  nubes(g, NUBES_CERCA, C.cerca, 0.22, ys(0.62), o, drift);
  const yB = ys(0.6) - 2;
  capa(S.cerca, 0.55, yB);

  // Luciérnagas.
  if (a === 'noche' && yB - 70 < vh) {
    for (let i = 0; i < LUCIERNAGAS.length; i++) {
      const l = LUCIERNAGAS[i];
      const x = Math.round(mod(l.x * (vw + 40) - camX * 0.5, vw + 40) - 20 + Math.sin(t * 0.7 + l.f) * 6);
      const y = Math.round(yB - 30 - l.e + Math.cos(t * 0.9 + l.f * 2) * 4);
      if (y > vh || y < 0) continue;
      const ph = o.quieto ? 0.5 : Math.sin(t * 2.2 + l.f * 3);
      if (ph > 0.2) {
        g.fillStyle = '#b8b060';
        g.fillRect(x - 1, y, 3, 1);
        g.fillRect(x, y - 1, 1, 3);
      }
      g.fillStyle = ph > 0.2 ? '#fcffb0' : '#a8a070';
      g.fillRect(x, y, 1, 1);
    }
  }
}
