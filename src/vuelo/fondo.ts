/*
 * El fondo del juego de aviones: todo lo que está detrás del suelo.
 *
 * Estilo «dulce»: pixel art pastel, formas redondas, contornos en un tono más
 * oscuro del mismo color (nunca negro) y nada de anti-aliasing. Capas de
 * atrás hacia adelante:
 *
 *   cielo a bandas · estrellas y aurora (noche) · sol / sol poniente / luna
 *   · nubes lejanas y cirros · banco de nubes en el horizonte · cordillera
 *   con nieve · niebla · nubes medianas · colinas a rayas · niebla · globos
 *   · pueblito (casitas, campanario, molino, humo, faroles) · pajaritos
 *   · nubes cercanas · bosque de árboles redondos · luciérnagas (noche)
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
  return alt < 500 ? 'campo' : alt < 1300 ? 'nubes' : alt < 1900 ? 'estratosfera' : 'espacio';
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
  const R = 2600;
  const ap = 22;
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
  tierraBuf: Buf;
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

const TIERRA_W = 1600;
const TIERRA_H = 200;
const TIERRA_AP = 22;

const tareasAlto = (a: Ambiente): Tarea<Alto>[] => [
  (c) => (c.cielo = capaCieloAlto(a)),
  (c) => (c.mar = { ...capaMar(a), fondo: css(palNube(a, 0.1).cuerpo) }),
  (c) => (c.cirros = capaCirrosAltos(a)),
  (c) => {
    c.tierraBuf = new Buf(TIERRA_W, TIERRA_H);
    capaTierra(a, 0, 50, c.tierraBuf);
  },
  (c) => capaTierra(a, 50, 100, c.tierraBuf!),
  (c) => capaTierra(a, 100, 150, c.tierraBuf!),
  (c) => {
    capaTierra(a, 150, TIERRA_H, c.tierraBuf!);
    c.tierra = { cv: c.tierraBuf!.canvas(), fondo: TIERRA[a].mar[3] };
  },
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
  (c) => (c.aurora = capaAurora()),
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
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  ' ': ['..', '..', '..', '..', '..'],
};
const anchoTexto = (s: string) => [...s].reduce((w, ch) => w + (LETRAS[ch] ?? LETRAS[' '])[0].length + 1, -1);

/** Writes `s` with its top-left at (x, y), with a 1 px drop shadow. */
function letrero(b: Buf, s: string, x: number, y: number, col: number, sombra: number) {
  for (const ch of s) {
    const gl = LETRAS[ch] ?? LETRAS[' '];
    for (const [dx, c] of [[1, sombra], [0, col]] as const)
      gl.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '#') b.px(x + i + dx, y + j + dx, c);
      });
    if (ch === 'Í') {
      b.px(x, y - 2, col);
      b.px(x + 1, y - 3, col);
    }
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
      if (ch === 'Í') {
        g.fillRect(x + dx, y - 2 + dx, 1, 1);
        g.fillRect(x + 1 + dx, y - 3 + dx, 1, 1);
      }
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
  void lx;
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
    const txt = 'VALPARAÍSO';
    const w = anchoTexto(txt);
    let best = Math.round(W * 0.4);
    for (let x = Math.round(W * 0.3); x < W * 0.6; x += 4) if (prof(x + w / 2) > prof(best + w / 2)) best = x;
    const y = Math.round(H - Math.min(prof(best), prof(best + w))) + 6;
    b.rect(best - 3, y - 4, w + 6, 11, m('#9cc888'));
    letrero(b, txt, best, y, m('#ffffff', 0.1), m('#5a8a5a'));
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
};

const tareasMar = (a: Ambiente): Tarea<Mar>[] => [
  (c) => (c.costas = [capaSanAntonio(a).canvas()]),
  (c) => c.costas!.push(capaCosta(a).canvas()),
  (c) => c.costas!.push(capaValparaiso(a).canvas()),
  (c) => (c.bandas = [0, 1, 2].map((i) => capaBanda(a, i))),
  (c) => c.bandas!.push(capaBanda(a, 3), capaBanda(a, 4)),
  (c) => (c.veleros = [0, 1, 2].map((i) => velero(a, i))),
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
/** Canvas x in a layer of parallax `k` for world x (centred on screen). */
const enCapa = (X: number, k: number) => Math.round((X - SA_MID) * k + SA_MID);
const delCapa = (x: number, k: number) => (x - SA_MID) / k + SA_MID;
const SECTOR_FIN = [400, 1100, 1700, 2700, 3600];
const sectorDe = (X: number) => SECTOR_FIN.findIndex((f) => X < f) < 0 ? 4 : SECTOR_FIN.findIndex((f) => X < f);
const SA_LEVEL = 3600;
const anchoCapa = (k: number) => enCapa(SA_LEVEL, k) + 700;

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
  const blanco = m('#fff4f4');
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
  // The boom reaching far over the berth, and the back arm.
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
  b.rect(x - 51, top + 34, 11, 3, m('#f4c040'));
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
  // A sliver of sea at the foot of the hills from the port onwards.
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
  const cart = 72 * Math.exp(-(((X - 3150) / 330) ** 2));
  const ondula = 4 * Math.sin(X / 90) + 3 * Math.sin(X / 37 + 1);
  return 16 + barr + cart + ondula * (1 - ss(1750, 1850, X) * (1 - ss(2650, 2750, X)));
}

/** Mid: the sectors themselves, from the eucalyptus to Cartagena's hill. */
function capaSAMedio(a: Ambiente) {
  const k = 0.35;
  const W = anchoCapa(k);
  const H = 150;
  const b = new Buf(W, H);
  const kk = 0.26;
  const m: Pinta = (h, q = kk) => pack(mat(a, h, q));
  const r = rng(2101);
  const ventana = ventanas(a, m, r, 0.1);
  const at = (X: number) => enCapa(X, k);
  const prof = (x: number) => sueloMedio(delCapa(x, k));
  const surf = (X: number) => Math.round(H - prof(at(X)));
  // Ground: fields, wetland greens, the paved port and grey sand at Cartagena.
  const verdes = [m('#b5d99c'), m('#c4dc9a'), m('#a8d0a0'), m('#c8c4cc'), m('#d8d0c0')];
  const tintas = [m('#7aa070'), m('#8aa064'), m('#6a9a78'), m('#9a94a8'), m('#a8a090')];
  for (let x = 0; x < W; x++) {
    const X = delCapa(x, k);
    const s = sectorDe(X);
    const top = Math.round(H - prof(x));
    const nx = Math.round(H - prof(x + 1));
    for (let y = top; y < H; y++) b.d[y * W + x] = verdes[s];
    b.px(x, top + 1, m('#ffffff', 0.6));
    for (let y = Math.min(top, nx); y <= Math.max(top, nx); y++) b.px(x, y, tintas[s]);
  }
  // San Juan: eucalyptus groves, two ponds and scattered farmhouses.
  for (let X = 0; X < 420; X += 18 + Math.floor(r() * 20)) eucalipto(b, m, at(X), surf(X) + 2, 36 + Math.floor(r() * 26));
  for (const X of [140, 300]) {
    const x = at(X);
    b.oval(x, surf(X) + 4, 9, 2, m('#7aa8c8'));
    b.oval(x, surf(X) + 4, 8, 1, m('#a8d8f0'));
  }
  for (const X of [60, 230, 370]) casa(b, m, at(X), surf(X) + 3, 9, 6, '#f2cc8f', '#9a8aa8', ventana);
  // Llolleo: lagoons, reeds, herons, the river mouth with its sandbar, wooden houses.
  for (let X = 430; X < 1100; X += 6 + Math.floor(r() * 10)) {
    const x = at(X);
    const y = surf(X) + 2;
    if ((X > 560 && X < 680) || (X > 860 && X < 960)) {
      b.rect(x - 3, y - 1, 7, 3, m('#7aa8c8'));
      b.rect(x - 2, y - 1, 5, 1, m('#a8d8f0'));
    } else if (r() < 0.7) totora(b, m, x, y, r);
  }
  for (const X of [600, 640, 900]) garza(b, m, at(X), surf(X) + 2);
  {
    const x0 = at(730);
    const x1 = at(800);
    for (let x = x0; x < x1; x++) {
      const y = surf(delCapa(x, k));
      b.rect(x, y, 1, H - y, m('#6fa8c9'));
      if ((x * 3) % 7 === 0) b.px(x, y + 2, m('#cfe3ea'));
    }
    b.rect(x0 - 4, H - 3, x1 - x0 + 8, 3, m('#e8dcb0'));
  }
  for (const X of [470, 1000, 1060]) {
    casa(b, m, at(X), surf(X) + 3, 10, 9, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], '#c0605a', ventana);
    for (let i = -2; i < 12; i += 2) b.rect(at(X) + i, surf(X), 1, 3, m('#ffffff'));
  }
  // Barrancas: paired houses in terraces up the slope, with stairs between.
  for (let X = 1120; X < 1700; X += 16 + Math.floor(r() * 8)) {
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
  // The port: giant cranes, container stacks, warehouses and a ship at the berth.
  {
    const q0 = at(1760);
    const q1 = at(2680);
    const qy = surf(2200);
    for (let x = q0; x < q1; x += 9) {
      if (r() < 0.15) continue;
      contenedores(b, a, kk, r, x, qy + 1, 1 + Math.floor(r() * 6));
    }
    for (const [X, cel] of [[1900, false], [2080, true], [2260, false], [2440, true]] as const) gruaGrande(b, m, at(X), qy + 1, 104, cel, ventana);
    const s0 = at(2470);
    const s1 = at(2660);
    for (let y = H - 8; y < H; y++) b.rect(s0 + (y > H - 3 ? 2 : 0), y, s1 - s0, 1, y >= H - 2 ? m('#e06a7a') : m('#3d85c6'));
    for (let x = s0 + 6; x < s1 - 22; x += 8) contenedores(b, a, kk, r, x, H - 8, 1 + Math.floor(r() * 3));
    b.rect(s1 - 18, H - 24, 12, 16, m('#fff4f4'));
    b.rect(s1 - 17, H - 21, 10, 1, ventana());
    b.rect(s1 - 13, H - 29, 4, 5, m('#e07a5f'));
    // Warehouses with arched roofs.
    for (const X of [1780, 1830]) {
      const x = at(X);
      const yb = qy + 1;
      b.rect(x, yb - 12, 14, 12, m('#d8d0e4'));
      b.oval(x + 7, yb - 12, 7, 3, m('#9a8aa8'));
      b.rect(x + 4, yb - 7, 6, 7, m('#7a8ab0'));
    }
  }
  // Cartagena: houses climbing the hill, a chalet with a turret, Huidobro's house on top.
  {
    for (let X = 2760; X < 3560; X += 6 + Math.floor(r() * 5)) {
      const x = at(X);
      const top = surf(X) + 3;
      for (let yb = top + 5; yb < H - 10; yb += 6 + Math.floor(r() * 3))
        if (r() < 0.75) casa(b, m, x, yb, 5 + Math.floor(r() * 3), 5, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], TECHOS_CASA[Math.floor(r() * TECHOS_CASA.length)], ventana);
    }
    {
      const x = at(2950);
      const yb = surf(2950) + 12;
      casa(b, m, x, yb, 14, 10, '#fff6e5', '#7a8ab0', ventana);
      b.rect(x + 10, yb - 18, 5, 8, m('#fff6e5'));
      for (let i = 0; i < 4; i++) b.rect(x + 9 + Math.floor(i / 2), yb - 19 - i, 7 - Math.floor(i / 2) * 2, 1, m('#7a8ab0'));
      b.px(x + 12, yb - 15, ventana());
    }
    {
      // Huidobro's house-museum on the hilltop, a small headstone and a tree with a bird.
      const X = 3150;
      const x = at(X);
      const yb = surf(X) + 2;
      casa(b, m, x - 6, yb, 12, 8, '#f6b38e', '#c0605a', ventana);
      b.rect(x + 9, yb - 3, 3, 3, m('#c8c4d4'));
      b.px(x + 10, yb - 4, m('#c8c4d4'));
      b.rect(x + 16, yb - 9, 1, 9, m('#8a5232'));
      b.disc(x + 16, yb - 12, 4, m('#5a9a6a'));
      b.disc(x + 15, yb - 13, 2, m('#8ac88a'));
      b.rect(x + 18, yb - 17, 2, 1, m('#3e4a6b'));
      b.px(x + 20, yb - 17, m('#ffc040'));
    }
    // Grey beach with the white railing and a few parasols.
    const x0 = at(2720);
    const x1 = W;
    b.rect(x0, H - 5, x1 - x0, 5, m('#c9bfae'));
    b.rect(x0, H - 7, x1 - x0, 1, m('#ffffff'));
    for (let x = x0; x < x1; x += 3) b.px(x, H - 6, m('#ffffff'));
    for (let x = x0 + 6; x < x1; x += 22 + Math.floor(r() * 18)) {
      b.rect(x, H - 9, 1, 5, m('#8a7a9a'));
      b.oval(x, H - 10, 3, 1, m(['#f4a7b9', '#ffd27f', '#8fd3c8'][Math.floor(r() * 3)]));
    }
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#b5d99c', kk)) };
}

/** Near: a lower band — rows of eucalyptus, reeds, houses, the old railway station, containers, Cartagena's houses. */
function capaSACerca(a: Ambiente) {
  const k = 0.55;
  const W = anchoCapa(k);
  const H = 76;
  const b = new Buf(W, H);
  const kk = 0.1;
  const m: Pinta = (h, q = kk) => pack(mat(a, h, q));
  const r = rng(2201);
  const ventana = ventanas(a, m, r, 0);
  const at = (X: number) => enCapa(X, k);
  const base = ondas(W, 22, [[5, 9, 0.4], [3, 23, 1.2]]);
  const prof = (x: number) => base(x) + 8 * ss(1100, 1300, delCapa(x, k)) * (1 - ss(1600, 1750, delCapa(x, k))) + 16 * Math.exp(-(((delCapa(x, k) - 3100) / 260) ** 2));
  const verdes = [m('#8ccc84'), m('#a0c47c'), m('#90c890'), m('#b8b4c4'), m('#c9bfae')];
  for (let x = 0; x < W; x++) {
    const s = sectorDe(delCapa(x, k));
    const top = Math.round(H - prof(x));
    for (let y = top; y < H; y++) b.d[y * W + x] = verdes[s];
    b.px(x, top, m('#5a8a6a'));
  }
  const surf = (X: number) => Math.round(H - prof(at(X)));
  for (let X = 0; X < 420; X += 10 + Math.floor(r() * 14)) eucalipto(b, m, at(X), surf(X) + 1, 46 + Math.floor(r() * 22));
  for (let X = 420; X < 1100; X += 4 + Math.floor(r() * 8)) {
    if (r() < 0.75) totora(b, m, at(X), surf(X) + 1, r);
    else if (r() < 0.3) garza(b, m, at(X), surf(X) + 1);
  }
  for (let X = 1110; X < 1680; X += 22 + Math.floor(r() * 14)) {
    const c = MUROS_CASA[Math.floor(r() * MUROS_CASA.length)];
    casa(b, m, at(X), surf(X) + 2, 9, 9, c, '#e86a5c', ventana);
    casa(b, m, at(X) + 10, surf(X) + 2, 9, 9, c, '#e86a5c', ventana);
  }
  // The old railway station with its wooden roof, at the edge of the port.
  {
    const x = at(1720);
    const yb = surf(1720) + 1;
    b.rect(x - 20, yb - 2, 60, 2, m('#8a7a6a'));
    b.rect(x, yb - 14, 24, 12, m('#f2cc8f'));
    b.rect(x - 3, yb - 17, 30, 3, m('#8a5232'));
    for (let i = 2; i < 24; i += 6) b.rect(x + i, yb - 10, 3, 4, ventana());
    for (let xx = x - 20; xx < x + 40; xx += 3) b.px(xx, yb - 1, m('#5a4a3a'));
  }
  for (let X = 1800; X < 2680; X += 9) if (r() < 0.6) contenedores(b, a, kk, r, at(X), surf(X) + 1, 1 + Math.floor(r() * 3));
  for (let X = 2720; X < 3600; X += 9 + Math.floor(r() * 6)) {
    if (r() < 0.3) continue;
    casa(b, m, at(X), surf(X) + 2, 7 + Math.floor(r() * 3), 7, MUROS_CASA[Math.floor(r() * MUROS_CASA.length)], TECHOS_CASA[Math.floor(r() * TECHOS_CASA.length)], ventana);
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#8ccc84', kk)) };
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

type Valpo = {
  lejos: { cv: Cv; fondo: string };
  medio: { cv: Cv; fondo: string };
  cerca: { cv: Cv; fondo: string };
  bruma: Cv;
};

const tareasValpo = (a: Ambiente): Tarea<Valpo>[] => [
  (c) => (c.lejos = capaCerrosLejos(a)),
  (c) => (c.medio = capaCerrosMedio(a)),
  (c) => (c.cerca = capaCerrosCerca(a)),
  (c) => (c.bruma = capaNiebla(a, 0.7)),
];

const AMBIENTES: Ambiente[] = ['dia', 'tarde', 'noche'];
const BAJO = {} as Record<Ambiente, Obra<Capas>>;
const ALTO = {} as Record<Ambiente, Obra<Alto>>;
const MAR = {} as Record<Ambiente, Obra<Mar>>;
const VALPO = {} as Record<Ambiente, Obra<Valpo>>;
const SANANTONIO = {} as Record<Ambiente, Obra<SA>>;
for (const a of AMBIENTES) {
  SANANTONIO[a] = new Obra(tareasSA(a));
  VALPO[a] = new Obra(tareasValpo(a));
  BAJO[a] = new Obra(tareas(a));
  ALTO[a] = new Obra(tareasAlto(a));
  MAR[a] = new Obra(tareasMar(a));
}
const ESPACIO = new Obra(tareasEspacio());
const ORDEN: Obra<unknown>[] = [BAJO.dia, SANANTONIO.dia, BAJO.tarde, SANANTONIO.tarde, BAJO.noche, SANANTONIO.noche, ESPACIO, ALTO.dia, ALTO.tarde, ALTO.noche, MAR.dia, MAR.tarde, MAR.noche, VALPO.dia, VALPO.tarde, VALPO.noche] as Obra<unknown>[];

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

export function dibujarFondo(g: Ctx, o: OpcionesFondo): void {
  const { vw, vh, camX, camY, ambiente: a } = o;
  VH = vh;
  const t = o.quieto ? 0 : o.t;
  const hz = Math.round(o.horizonte);
  /** Línea base de una capa con paralaje vertical k (0.5 = el horizonte). */
  const ys = (k: number) => Math.round(hz + camY * (k - 0.5));
  g.imageSmoothingEnabled = false;

  // Altitud real de la fila de arriba, la de abajo y el centro de la vista.
  const cy = Math.round(camY);
  const altTop = cy + vh - 16;
  const altBot = cy - 15;
  const altMid = cy + vh * 0.5;
  const C = BAJO[a].todo();
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

    // Estrellas, aurora y estrellas que titilan.
    const yEst = ys(0.2);
    if (C.estrellas) tira(g, C.estrellas, camX * 0.02, yEst, vw);
    if (C.aurora) {
      const ya = ys(0.15) - 196;
      g.globalAlpha = 0.4 + 0.1 * Math.sin(t * 0.5);
      tira(g, C.aurora, camX * 0.03 + t * 3, ya, vw);
      g.globalAlpha = 1;
    }
    if (a === 'noche') {
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
      mosaico(g, E.estrellas[0], camX * 0.02, 40 - camY * 0.03, vw, yLim);
      mosaico(g, E.estrellas[1], camX * 0.05 + 97, 101 - camY * 0.07, vw, yLim);
      if (kEsp > 0) {
        g.globalAlpha = kEsp * 0.9;
        for (let i = 0; i < DECOR.length; i++) {
          const d = DECOR[i];
          pon(g, o, E.deco[d[0]], d[1], d[2], d[3], d[4], d[5]);
        }
        g.globalAlpha = kEst;
      }
      mosaico(g, E.estrellas[2], camX * 0.1 + 31, 17 - camY * 0.14, vw, yLim);
      // Estrellas que titilan.
      for (let i = 0; i < TITILA_ALTA.length; i++) {
        const s = TITILA_ALTA[i];
        const x = Math.round(mod(s.x * (vw + 20) - camX * 0.06, vw + 20)) - 10;
        const y = Math.round(mod(s.y * (vh + 20) + camY * 0.1, vh + 20)) - 10;
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
    const kLuna = a === 'noche' ? 1 - ss(1500, 1950, altMid) : 1;
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

  // Planeta con anillos, Luna grande, cometa, satélite y meteoritos.
  if (E && kEsp > 0) {
    g.globalAlpha = kEsp;
    const dX = 1600 - camX;
    const pl = E.planeta;
    g.drawImage(pl, Math.round(vw * 0.13 + dX * 0.03 - pl.width / 2), Math.round(vh * 0.3 + (cy - 2300) * 0.12 - pl.height / 2));
    const lu = E.luna;
    g.drawImage(lu, Math.round(vw * 0.58 + dX * 0.05 - lu.width / 2), Math.round(vh * 0.24 + (cy - 2650) * 0.18 - lu.height / 2));
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
  const yH = ys(0.04);
  tira(g, C.banco, camX * 0.04 + t * 0.5, yH + 3, vw);
  nubes(g, NUBES_MEDIO, C.medio, 0.13, ys(0.4), o, drift);
  nubes(g, NUBES_CERCA, C.cerca, 0.22, ys(0.62), o, drift);
  if (yH >= vh) return;

  // The coast on the horizon, drifting by as the ships sail north; then the sea.
  const costa = Math.min(1, Math.max(0, o.costa ?? 0));
  const offI = camX * 0.05 + (o.quieto ? 0 : (o.viaje ?? 0) * 6);
  // Between two places, the one behind sinks under the horizon as the next one rises.
  {
    const c2 = costa * 2;
    const i = Math.min(1, Math.floor(c2));
    const u = ss(0, 1, c2 - i);
    const H = COSTA_H;
    if (u < 1) tiraHundida(g, M.costas[i], offI, yH, vw, u * H);
    if (u > 0) tiraHundida(g, M.costas[i + 1], offI + 600 * (1 - u), yH, vw, (1 - u) * H);
  }
  g.fillStyle = M.bandas[0].lejos;
  g.fillRect(0, yH, vw, vh - yH);
  const tops = [ys(0.08), ys(0.16), ys(0.3), ys(0.5), ys(0.78)];
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
  // A bright line where the sea meets the sky.
  g.fillStyle = a === 'noche' ? '#a890d8' : a === 'tarde' ? '#ffe8c4' : '#eefaff';
  g.fillRect(0, yH, vw, 1);

  // Glitter under the sun or the moon, wider as it comes closer.
  {
    const ax = Math.round(vw * (a === 'tarde' ? 0.7 : 0.8));
    const deep = vh - yH;
    const [c0, c1] = BRILLO[a];
    for (let i = 0; i < BRILLOS.length; i++) {
      const [sx, d, f, len] = BRILLOS[i];
      const on = o.quieto ? i % 3 !== 0 : Math.sin(t * 3 + f * 7) > -0.1;
      if (!on) continue;
      const y = Math.round(yH + 2 + d * deep * 0.9);
      const x = Math.round(ax + sx * (4 + d * 46) - len / 2);
      g.fillStyle = Math.sin(t * 5 + f) > 0.6 ? c1 : c0;
      g.fillRect(x, y, len + Math.round(d * 3), 1);
    }
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

  // Sailboats bobbing on the water.
  for (let i = 0; i < VELEROS.length; i++) {
    const [X, d, v] = VELEROS[i];
    const s = M.veleros[i % M.veleros.length];
    const x = Math.round(mod(X - camX * (0.09 + d * 0.3) + t * v, 2600) - 200);
    if (x > vw || x + s.width < 0) continue;
    const y = Math.round(yH + d * (ys(0.6) - yH)) + Math.round(Math.sin(t * 1.4 + i * 2) * 0.8) - s.height + 3;
    if (y > vh) continue;
    g.drawImage(s, x, y);
  }

  // Seagulls gliding over the sea (they sleep at night).
  if (a !== 'noche') {
    const tinta = a === 'tarde' ? '#9a5a8a' : '#6a7cb8';
    const base = ys(0.5);
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
  capa(V.lejos, camX * 0.08, ys(0.3));
  nubes(g, NUBES_MEDIO, C.medio, 0.13, ys(0.4), o, drift);
  // Camanchaca: coastal fog lying in bands over the hills.
  g.globalAlpha = 0.55;
  tira(g, V.bruma, camX * 0.12 + t * 3, ys(0.36) + 4, vw);
  g.globalAlpha = 1;
  capa(V.medio, camX * 0.22, ys(0.42) + 6);
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
  capa(V.cerca, camX * 0.4, ys(0.62) + 26);
}

/** San Antonio: the coastal range, then the sectors (eucalyptus → wetland → Barrancas → port → Cartagena). */
function dibujarCampo(g: Ctx, o: OpcionesFondo, C: Capas, S: SA, t: number, ys: (k: number) => number) {
  const { vw, vh, camX, ambiente: a } = o;
  const capa = (c: { cv: Cv; fondo: string }, k: number, y: number) => {
    // Wide canvases indexed by world x: no tiling, the sector shows up where it belongs.
    const x = -Math.round(camX * k);
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
