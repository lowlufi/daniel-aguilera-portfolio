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

/** Cordillera: una fila trasera más pálida y una delantera con nieve en gotitas. */
function capaMontanas(a: Ambiente) {
  const W = 960;
  const H = 150;
  const b = new Buf(W, H);
  type Pico = { x: number; h: number; w: number; s: number };
  const picos = (seed: number, n: number, h0: number, h1: number): Pico[] => {
    const r = rng(seed);
    return Array.from({ length: n }, (_, i) => {
      const h = h0 + r() * (h1 - h0);
      return { x: ((i + 0.2 + r() * 0.6) * W) / n, h, w: h * (0.75 + r() * 0.45), s: r() * 10 };
    });
  };
  const atras = picos(11, 7, 72, 112);
  const frente = picos(23, 9, 36, 74);
  const perfil = (ps: Pico[], x: number, piso: number) => {
    let best = piso;
    let pk: Pico | null = null;
    let dx = 0;
    for (const p of ps) {
      const d = mod(x - p.x + W / 2, W) - W / 2;
      const u = Math.abs(d) / p.w;
      if (u >= 1) continue;
      const v = p.h * (1 - Math.pow(u, 1.55));
      if (v > best) {
        best = v;
        pk = p;
        dx = d;
      }
    }
    return { el: best, pk, dx };
  };
  const capa = (ps: Pico[], k: number, piso: number) => ({
    ps,
    piso,
    cuerpo: pack(mat(a, '#8ea8e4', k)),
    sombra: pack(mat(a, '#7590d2', k)),
    nieve: pack(mat(a, '#f6faff', k)),
    nieveS: pack(mat(a, '#cfdaf6', k)),
    tinta: pack(mat(a, '#5a70b8', k + 0.12)),
    luz: pack(mat(a, '#b0c6f2', k)),
  });
  const filas = [capa(atras, 0.6, 26), capa(frente, 0.4, 14)];
  for (const f of filas) {
    for (let x = 0; x < W; x++) {
      const { el, pk, dx } = perfil(f.ps, x, f.piso + 4 * Math.sin((x / W) * TAU * 9));
      const top = Math.round(H - el);
      for (let y = Math.max(0, top); y < H; y++) {
        const e = H - y;
        const sombra = pk !== null && dx > Math.round(1.5 * Math.sin(e * 0.35 + pk.s));
        let col = sombra ? f.sombra : f.cuerpo;
        if (pk && pk.h > 58 && e > pk.h * 0.76 + 3 * Math.abs(Math.sin(dx * 0.32 + pk.s))) col = sombra ? f.nieveS : f.nieve;
        else if (!sombra && y === top + 1) col = f.luz;
        b.d[y * W + x] = y === top ? f.tinta : col;
      }
      // Contorno unido donde la pendiente da saltos.
      const next = Math.round(H - perfil(f.ps, x + 1, f.piso + 4 * Math.sin(((x + 1) / W) * TAU * 9)).el);
      for (let y = Math.min(top, next); y < Math.max(top, next); y++) if (y >= 0) b.d[y * W + x] = f.tinta;
    }
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#8ea8e4', 0.42)) };
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

/** Colinas a rayas con arbolitos chupetín en las crestas. */
function capaColinas(a: Ambiente) {
  const W = 1100;
  const H = 92;
  const b = new Buf(W, H);
  const k = 0.3;
  const prof = ondas(W, 50, [[12, 3, 1], [7, 7, 2.2], [3, 13, 0.4]]);
  const cuerpo = pack(mat(a, '#86d6a6', k));
  const raya = pack(mat(a, '#a2e4b8', k));
  const tinta = pack(mat(a, '#4ea880', k));
  const luz = pack(mat(a, '#c4f2cc', k));
  for (let x = 0; x < W; x++) {
    const top = Math.round(H - prof(x));
    const nx = Math.round(H - prof(x + 1));
    for (let y = top; y < H; y++) b.d[y * W + x] = mod(x + y, 14) < 5 ? raya : cuerpo;
    b.d[(top + 1) * W + x] = luz;
    for (let y = Math.min(top, nx); y <= Math.max(top, nx) - (nx > top ? 1 : 0); y++) b.d[y * W + x] = tinta;
    b.d[top * W + x] = tinta;
  }
  // Arbolitos y alguna casita lejana.
  const r = rng(31);
  const hoja = pack(mat(a, '#5cc48a', k));
  const hojaL = pack(mat(a, '#9ae4ae', k));
  const rosa = pack(mat(a, '#f4a0c4', k));
  for (let x = 20; x < W - 10; x += 18 + Math.floor(r() * 50)) {
    const y = Math.round(H - prof(x));
    const rr = 3 + Math.floor(r() * 2);
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const tx = x + i * (rr * 2 + 1);
      const ty = Math.round(H - prof(tx));
      b.rect(tx - 1, ty - 4, 2, 5, tinta);
      b.disc(tx, ty - 4 - rr, rr + 1, tinta);
      b.disc(tx, ty - 4 - rr, rr, r() < 0.2 ? rosa : hoja);
      b.px(tx - 1, ty - 5 - rr, hojaL);
      b.px(tx - 2, ty - 4 - rr, hojaL);
    }
    void y;
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#86d6a6', k)) };
}

/* El pueblito: la geometría es la misma en todos los ambientes. */

const PUEBLO_W = 1280;
const PUEBLO_H = 104;
const puebloPerfil = ondas(PUEBLO_W, 38, [[10, 2, 0.5], [6, 5, 1.3], [3, 11, 2.1]]);
type Casa = { x: number; y: number; w: number; muro: number; techo: number; color: number; alta: boolean };
type Pueblo = { casas: Casa[]; chimeneas: Int16Array; molino: [number, number]; torre: [number, number]; arboles: [number, number, number, number][]; faroles: [number, number][] };
let puebloGeo: Pueblo | null = null;
function geoPueblo(): Pueblo {
  if (puebloGeo) return puebloGeo;
  const r = rng(101);
  const surf = (x: number) => Math.round(PUEBLO_H - puebloPerfil(x));
  // El molino en la loma más alta.
  let mx = 0;
  for (let x = 0; x < PUEBLO_W; x++) if (puebloPerfil(x) > puebloPerfil(mx)) mx = x;
  const casas: Casa[] = [];
  const chim: number[] = [];
  const arboles: [number, number, number, number][] = [];
  const faroles: [number, number][] = [];
  const centros = [120, 380, 560, 820, 1060];
  let torre: [number, number] = [0, 0];
  centros.forEach((cx, ci) => {
    const n = 3 + Math.floor(r() * 3);
    let x = cx - n * 9;
    for (let i = 0; i < n; i++) {
      const w = 10 + 2 * Math.floor(r() * 3);
      const alta = r() < 0.25;
      const muro = alta ? 13 : 7 + Math.floor(r() * 3);
      const xx = Math.round(x);
      // Asienta la casa en el punto más bajo de su base.
      let y = 0;
      for (let k = 0; k < w; k++) y = Math.max(y, surf(xx + k));
      if (Math.abs(xx - mx) > 30) {
        const c: Casa = { x: xx, y: y + 1, w, muro, techo: Math.floor(w / 2) + 1, color: Math.floor(r() * 4), alta };
        casas.push(c);
        if (r() < 0.8) chim.push(xx + w - 4, y + 1 - muro - Math.floor(w / 2) + 1);
        if (r() < 0.5) faroles.push([xx + w + 2, surf(xx + w + 2)]);
      }
      if (r() < 0.6) arboles.push([xx + w + 5, surf(xx + w + 5), 3 + Math.floor(r() * 3), Math.floor(r() * 4)]);
      x += w + 3 + Math.floor(r() * 6);
    }
    if (ci === 2) torre = [Math.round(x + 4), surf(Math.round(x + 8))];
  });
  for (let x = 30; x < PUEBLO_W; x += 26 + Math.floor(r() * 60)) {
    if (Math.abs(x - mx) < 16) continue;
    if (casas.some((c) => x > c.x - 8 && x < c.x + c.w + 8)) continue;
    arboles.push([x, surf(x), 4 + Math.floor(r() * 3), Math.floor(r() * 4)]);
  }
  puebloGeo = { casas, chimeneas: Int16Array.from(chim), molino: [mx, surf(mx)], torre, arboles, faroles };
  return puebloGeo;
}

function capaPueblo(a: Ambiente) {
  const geo = geoPueblo();
  const W = PUEBLO_W;
  const H = PUEBLO_H;
  const b = new Buf(W, H);
  const k = 0.16;
  const m = (h: string, kk = k) => pack(mat(a, h, kk));
  const r = rng(202);
  // Loma con parches de cultivo (tablero de campos con surcos y setos).
  const pasto = m('#88d47e');
  const tinta = m('#4ea866');
  const luz = m('#bcf0a0');
  const campos = [m('#7ccc7c'), m('#a6de80'), m('#f2dc8e'), m('#8ed8a6'), m('#c8e890')];
  const surco = [m('#6cbc70'), m('#94cc72'), m('#e0c878'), m('#7cc896'), m('#b4d880')];
  const seto = m('#5cae6a');
  const FW = 54;
  for (let x = 0; x < W; x++) {
    const top = Math.round(H - puebloPerfil(x));
    const nx = Math.round(H - puebloPerfil(x + 1));
    for (let y = top; y < H; y++) {
      const d = y - top;
      if (d < 3) {
        b.d[y * W + x] = pasto;
        continue;
      }
      const s = x + (y - 60) * 0.9;
      const id = Math.floor(s / FW);
      const t = (id * 7 + Math.floor((y + 2) / 22) * 3) % 5;
      const t2 = ((t % 5) + 5) % 5;
      const borde = mod(s, FW) < 1.2 || mod(y + 2, 22) === 0;
      b.d[y * W + x] = borde ? seto : t2 !== 0 && t2 !== 3 && y % 3 === 0 ? surco[t2] : campos[t2];
    }
    b.d[(top + 1) * W + x] = luz;
    for (let y = Math.min(top, nx); y <= Math.max(top, nx) - (nx > top ? 1 : 0); y++) b.d[y * W + x] = tinta;
    b.d[top * W + x] = tinta;
  }
  const lit = PAL[a].ventana;
  const luzV = lit ? pack(hex(lit)) : 0;
  const brillo = lit ? pack(lerp(hex(lit), mat(a, '#fff0dc', k), 0.55)) : 0;
  const vidrio = m('#8ccaf8');
  const vidrioL = m('#e4f6ff');
  const ventana = (x: number, y: number, w: number, h: number) => {
    if (lit && r() < PAL[a].ventanaLuz) {
      if (a === 'noche') b.rect(x - 1, y - 1, w + 2, h + 2, brillo);
      b.rect(x, y, w, h, luzV);
      b.px(x, y, pack(hex('#fff8d0')));
    } else {
      b.rect(x, y, w, h, vidrio);
      b.px(x, y, vidrioL);
    }
  };
  const MUROS = [['#fff2dc', '#f0d4b4'], ['#ffd6dc', '#f0b0bc'], ['#dceeff', '#b4ccec'], ['#fff6b8', '#ecd88c']];
  const TECHOS = [['#f0708e', '#ff9cb0', '#b04a6a'], ['#ff8aa4', '#ffb8c8', '#c0587a'], ['#f4986a', '#ffc090', '#b8603e'], ['#b48ae0', '#d4b4f4', '#7a5aac']];
  const madera = m('#c48250');
  const maderaO = m('#8a5232');
  // Árboles redondos (detrás de las casas).
  const HOJAS = [['#5cc48a', '#9ae4ae', '#3a9a6a'], ['#ff9ac8', '#ffcce4', '#c8609a'], ['#7cd47c', '#b8f0a0', '#4a9e5a'], ['#4cb8a0', '#8ee0c8', '#2e8a78']];
  for (const [x, y, rr, kind] of geo.arboles) {
    const [h0, h1, h2] = HOJAS[kind];
    b.rect(x - 1, y - 5, 3, 6, maderaO);
    b.rect(x, y - 5, 1, 5, madera);
    b.disc(x, y - 5 - rr, rr + 1, m(h2));
    b.disc(x, y - 5 - rr, rr, m(h0));
    b.disc(x - 1, y - 6 - rr, Math.max(1, rr - 2), m(h1));
    b.px(x - rr + 1, y - 6 - rr, m('#ffffff', 0.3));
  }
  // Casitas.
  for (const c of geo.casas) {
    const [w0, w1] = MUROS[c.color];
    const [t0, t1, t2] = TECHOS[(c.color + c.x) % 4];
    const muroI = m(w1);
    const yTop = c.y - c.muro;
    b.rect(c.x - 1, yTop - 1, c.w + 2, c.muro + 1, m(tone(w1)));
    b.rect(c.x, yTop, c.w, c.muro, m(w0));
    b.rect(c.x + c.w - 2, yTop, 2, c.muro, muroI);
    // Chimenea (antes del techo para que el techo la tape abajo).
    // Techo escalonado con alero.
    const th = c.techo;
    for (let i = 0; i <= th; i++) {
      const xx = c.x - 2 + i;
      const ww = c.w + 4 - i * 2;
      const yy = yTop - 1 - i;
      if (ww <= 0) break;
      b.rect(xx, yy, ww, 1, i % 3 === 1 ? m(t1) : m(t0));
      b.px(xx, yy, m(t2));
      b.px(xx + ww - 1, yy, m(t2));
      if (i === th || ww <= 2) b.rect(xx, yy, ww, 1, m(t2));
    }
    b.rect(c.x - 2, yTop - 1, c.w + 4, 1, m(t2));
    b.rect(c.x - 1, yTop - 2, 3, 1, m(t1));
    // Puerta y ventanas.
    const dx = c.x + Math.floor(c.w / 2) - 1;
    b.rect(dx - 1, c.y - 5, 4, 5, maderaO);
    b.rect(dx, c.y - 4, 2, 4, madera);
    if (c.w >= 12) {
      ventana(c.x + 2, c.y - 6, 2, 2);
      ventana(c.x + c.w - 4, c.y - 6, 2, 2);
    } else ventana(c.x + c.w - 4, c.y - 6, 2, 2);
    if (c.alta) {
      ventana(c.x + 2, yTop + 2, 2, 2);
      ventana(c.x + c.w - 4, yTop + 2, 2, 2);
    }
  }
  // Chimeneas.
  const ch = geo.chimeneas;
  for (let i = 0; i < ch.length; i += 2) {
    b.rect(ch[i] - 1, ch[i + 1] - 1, 4, 5, m('#8a4a5a'));
    b.rect(ch[i], ch[i + 1], 2, 4, m('#d07a7a'));
  }
  // Campanario con ventanita encendida.
  {
    const [tx, ty] = geo.torre;
    const w = 8;
    b.rect(tx - 1, ty - 22, w + 2, 23, m('#c0a6a0'));
    b.rect(tx, ty - 21, w, 22, m('#fff2dc'));
    b.rect(tx + w - 2, ty - 21, 2, 22, m('#f0d4b4'));
    for (let i = 0; i < 9; i++) b.rect(tx - 1 + Math.floor(i / 2), ty - 22 - i, w + 2 - Math.floor(i / 2) * 2, 1, i === 8 ? m('#4a8acc') : m(i % 3 === 1 ? '#a0d0ff' : '#6aaaf0'));
    b.rect(tx + 3, ty - 32, 2, 3, m('#e0a030'));
    b.rect(tx + 2, ty - 17, 4, 5, m('#8a5232'));
    if (lit) b.rect(tx + 3, ty - 16, 2, 4, luzV);
    else b.rect(tx + 3, ty - 16, 2, 3, m('#ffe048'));
    b.rect(tx + 3, ty - 4, 2, 4, madera);
  }
  // Faroles.
  for (const [x, y] of geo.faroles) {
    b.rect(x, y - 6, 1, 6, m('#6a5a7a'));
    if (lit) {
      b.rect(x - 1, y - 8, 3, 2, luzV);
      if (a === 'noche') {
        b.px(x - 2, y - 7, brillo);
        b.px(x + 2, y - 7, brillo);
        b.px(x, y - 9, brillo);
      }
    } else b.rect(x - 1, y - 8, 3, 2, m('#fff0c0'));
  }
  // Molino: torre cónica con tejadito; las aspas se dibujan aparte.
  {
    const [mx, my] = geo.molino;
    const hgt = 24;
    for (let i = 0; i < hgt; i++) {
      const ww = 12 - Math.floor((i * 5) / hgt);
      const x0 = mx - Math.floor(ww / 2);
      b.rect(x0 - 1, my - i, ww + 2, 1, m('#b08a70'));
      b.rect(x0, my - i, ww, 1, m('#fff0dc'));
      b.rect(x0 + ww - 2, my - i, 2, 1, m('#f0d4b4'));
    }
    b.disc(mx, my - hgt - 1, 5, m('#a04a6a'));
    b.disc(mx, my - hgt - 1, 4, m('#f0708e'));
    b.rect(mx - 2, my - hgt - 3, 2, 1, m('#ffb0c4'));
    b.rect(mx - 6, my - hgt + 1, 13, 2, m('#a04a6a'));
    b.rect(mx - 1, my - 4, 3, 5, maderaO);
    ventana(mx - 1, my - 14, 2, 2);
  }
  return { cv: b.canvas(), fondo: css(mat(a, '#88d47e', k)) };
}
/** Un tono más oscuro del mismo color, para contornos. */
function tone(h: string) {
  const c = hex(h);
  return '#' + [c[0] * 0.72, c[1] * 0.62, c[2] * 0.7 + 20].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
}

/** Aspas del molino en 6 fases de un cuarto de vuelta. */
function aspasMolino(a: Ambiente) {
  const frames: Cv[] = [];
  const k = 0.16;
  for (let f = 0; f < 6; f++) {
    const S = 33;
    const c = 16;
    const b = new Buf(S, S);
    const brazo = pack(mat(a, '#8a5232', k));
    const vela = pack(mat(a, '#fff6e6', k));
    const velaS = pack(mat(a, '#e8d4bc', k));
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2 + (f / 6) * (Math.PI / 2);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      for (let s = 4; s <= 14; s++) for (let o = 1; o <= 3; o++) b.px(c + ca * s - sa * o, c + sa * s + ca * o, s % 3 === 0 ? velaS : vela);
      for (let s = 0; s <= 14; s++) b.px(c + ca * s, c + sa * s, brazo);
    }
    b.outline(pack(mat(a, '#b08a70', k)));
    b.disc(c, c, 1, brazo);
    frames.push(b.canvas());
  }
  return frames;
}

/** Bosque: una fila trasera más pálida y otra delantera, árboles redondos, pinos y algún cerezo. */
function capaBosque(a: Ambiente) {
  const W = 900;
  const H = 56;
  const b = new Buf(W, H);
  const fila = (seed: number, k: number, y0: number, alto: number) => {
    const r = rng(seed);
    const piso = m2('#3e9a6e');
    function m2(h: string) {
      return pack(mat(a, h, k));
    }
    for (let x = 0; x < W; x += 8 + Math.floor(r() * 9)) {
      const t = r();
      const y = y0 - Math.floor(r() * alto);
      if (t < 0.22) {
        // Pino de pisos redondos.
        const cs = ['#3aa88a', '#5cc8a0', '#9ae8c8', '#24805e'].map(m2);
        for (let i = 0; i < 3; i++) {
          const w = 8 - i * 2;
          const yy = y + 6 - i * 6;
          b.oval(x, yy, w + 1, 4, cs[3]);
        }
        for (let i = 0; i < 3; i++) {
          const w = 8 - i * 2;
          const yy = y + 6 - i * 6;
          b.oval(x, yy, w, 3, cs[0]);
          b.oval(x - 1, yy - 1, w - 3, 1, cs[1]);
        }
        b.px(x - 2, y - 9, cs[2]);
      } else {
        const rose = t > 0.9;
        const cs = (rose ? ['#f490c0', '#ffbcdc', '#ffe4f0', '#c0588e'] : t > 0.6 ? ['#5cc48a', '#8edca4', '#c4f4cc', '#38946a'] : ['#4cb47c', '#76cc8e', '#b4ecbc', '#2e8a5e']).map(m2);
        const rr = 6 + Math.floor(r() * 4);
        b.disc(x - rr * 0.6, y + 3, rr - 2, cs[3]);
        b.disc(x + rr * 0.6, y + 3, rr - 2, cs[3]);
        b.disc(x, y, rr + 1, cs[3]);
        b.disc(x - rr * 0.6, y + 3, rr - 3, cs[0]);
        b.disc(x + rr * 0.6, y + 3, rr - 3, cs[0]);
        b.disc(x, y, rr, cs[0]);
        b.disc(x - 2, y - 2, rr - 3, cs[1]);
        b.disc(x - rr * 0.45, y - rr * 0.45, 1, cs[2]);
        b.px(x - rr * 0.45 + 2, y - rr * 0.45 - 1, cs[2]);
      }
    }
    return piso;
  };
  const p1 = fila(7, 0.24, 22, 8);
  b.rect(0, 26, W, H - 26, p1);
  const p2 = fila(13, 0.1, 34, 8);
  b.rect(0, 40, W, H - 40, p2);
  // Copas sueltas a ras del borde para cerrar huecos.
  return { cv: b.canvas(), fondo: css(mat(a, '#3e9a6e', 0.1)) };
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

/* ── Caché por ambiente ─────────────────────────────────────────────────── */

type Capas = {
  cielo: { cv: Cv; top: string; bottom: string };
  estrellas: Cv | null;
  aurora: Cv | null;
  astro: Cv;
  banco: Cv;
  montes: { cv: Cv; fondo: string };
  niebla1: Cv;
  niebla2: Cv;
  colinas: { cv: Cv; fondo: string };
  pueblo: { cv: Cv; fondo: string };
  aspas: Cv[];
  bosque: { cv: Cv; fondo: string };
  lejos: Cv[];
  medio: Cv[];
  cerca: Cv[];
  cirros: Cv[];
  globos: Cv[];
  humo: Cv[];
  pajaro: string | null;
};

type Tarea = (c: Partial<Capas>) => void;
const tareas = (a: Ambiente): Tarea[] => [
  (c) => (c.cielo = capaCielo(a)),
  (c) => (c.estrellas = capaEstrellas(a)),
  (c) => (c.aurora = a === 'noche' ? capaAurora() : null),
  (c) => (c.astro = capaAstro(a)),
  (c) => (c.banco = capaBanco(a)),
  (c) => (c.montes = capaMontanas(a)),
  (c) => ((c.niebla1 = capaNiebla(a, 0.25)), (c.niebla2 = capaNiebla(a, 0.45))),
  (c) => (c.colinas = capaColinas(a)),
  (c) => (c.pueblo = capaPueblo(a)),
  (c) => ((c.aspas = aspasMolino(a)), (c.humo = bocanadas(a))),
  (c) => (c.bosque = capaBosque(a)),
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

const listo = new Map<Ambiente, Capas>();
const parcial = new Map<Ambiente, { c: Partial<Capas>; n: number }>();
const AMBIENTES: Ambiente[] = ['dia', 'tarde', 'noche'];

function paso(a: Ambiente): boolean {
  if (listo.has(a)) return false;
  let p = parcial.get(a);
  if (!p) parcial.set(a, (p = { c: {}, n: 0 }));
  const ts = tareas(a);
  ts[p.n++](p.c);
  if (p.n >= ts.length) {
    listo.set(a, p.c as Capas);
    parcial.delete(a);
  }
  return true;
}
function capas(a: Ambiente): Capas {
  while (!listo.has(a)) paso(a);
  return listo.get(a)!;
}

/**
 * Pinta por adelantado los ambientes que falten, de a poco (unos ms por
 * llamada). `dibujarFondo` ya lo hace solo; sirve para llamarlo en momentos
 * tranquilos (menú, pausa).
 */
export function precalentarFondo(presupuestoMs = 6) {
  const t0 = performance.now();
  for (const a of AMBIENTES) while (!listo.has(a)) {
    paso(a);
    if (performance.now() - t0 > presupuestoMs) return false;
  }
  return true;
}

/* ── Dibujo por cuadro ──────────────────────────────────────────────────── */

function tira(g: Ctx, c: Cv, off: number, yBase: number, vw: number) {
  const W = c.width;
  let x = -mod(Math.round(off), W);
  const y = Math.round(yBase - c.height);
  for (; x < vw; x += W) g.drawImage(c, x, y);
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

export function dibujarFondo(g: Ctx, o: OpcionesFondo): void {
  const { vw, vh, camX, camY, ambiente: a } = o;
  const C = capas(a);
  const t = o.quieto ? 0 : o.t;
  const hz = Math.round(o.horizonte);
  /** Línea base de una capa con paralaje vertical k (0.5 = el horizonte). */
  const ys = (k: number) => Math.round(hz + camY * (k - 0.5));
  g.imageSmoothingEnabled = false;

  // Cielo.
  const sky = C.cielo;
  const skyTop = hz - SKY_H;
  if (skyTop > 0) {
    g.fillStyle = sky.top;
    g.fillRect(0, 0, vw, skyTop);
  }
  for (let x = 0; x < vw; x += sky.cv.width) g.drawImage(sky.cv, x, skyTop);
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
        const x0 = Math.round(vw * (0.15 + sx * 0.6) + k * 70);
        const y0 = yEst - 330 + ((ciclo * 53) % 120) + Math.round(k * 30);
        g.fillStyle = '#ffffff';
        g.fillRect(x0, y0, 2, 1);
        g.fillStyle = '#e6dcff';
        for (let i = 1; i < 6; i++) g.fillRect(x0 - i * 2, y0 - Math.round(i * 0.85), 2, 1);
      }
    }
  }

  // Sol, sol poniente o luna.
  {
    const s = C.astro;
    const x = Math.round(vw * (a === 'tarde' ? 0.7 : 0.8) - s.width / 2);
    const cy = a === 'tarde' ? ys(0.3) - 100 : a === 'dia' ? ys(0.25) - 168 : ys(0.22) - 172;
    g.drawImage(s, x, cy - s.height / 2);
  }

  // Cirros altos y nubes lejanas.
  const drift = t;
  nubes(g, CIRROS, C.cirros, 0.03, ys(0.2), o, drift);
  nubes(g, NUBES_LEJOS, C.lejos, 0.06, ys(0.3), o, drift);

  // Banco de nubes, cordillera y niebla.
  tira(g, C.banco, camX * 0.04 + t * 0.5, ys(0.27) - 30, vw);
  const yM = ys(0.29) - 2;
  tira(g, C.montes.cv, camX * 0.07, yM, vw);
  if (yM < vh) {
    g.fillStyle = C.montes.fondo;
    g.fillRect(0, yM, vw, vh - yM);
  }
  tira(g, C.niebla1, camX * 0.1, yM + 6, vw);

  // Nubes medianas y globos.
  nubes(g, NUBES_MEDIO, C.medio, 0.13, ys(0.4), o, drift);
  {
    const base = ys(0.42);
    for (let i = 0; i < C.globos.length; i++) {
      const s = C.globos[i];
      const x = mod(400 + i * 870 - camX * 0.16 - t * (2 + i), 2600) - 30;
      if (x > vw) continue;
      const y = base - 110 - i * 34 - s.height + Math.round(Math.sin(t * 0.8 + i * 2) * 2);
      g.drawImage(s, Math.round(x), y);
    }
  }

  // Colinas a rayas.
  const yC = ys(0.38) + 4;
  tira(g, C.colinas.cv, camX * 0.17, yC, vw);
  if (yC < vh) {
    g.fillStyle = C.colinas.fondo;
    g.fillRect(0, yC, vw, vh - yC);
  }
  tira(g, C.niebla2, camX * 0.22, yC + 2, vw);

  // Pueblito: tira, aspas del molino y humo de chimeneas.
  const yP = ys(0.5) + 8;
  const offP = camX * 0.3;
  tira(g, C.pueblo.cv, offP, yP, vw);
  if (yP < vh) {
    g.fillStyle = C.pueblo.fondo;
    g.fillRect(0, yP, vw, vh - yP);
  }
  const top = yP - PUEBLO_H;
  const x0 = -mod(Math.round(offP), PUEBLO_W);
  const geo = geoPueblo();
  for (let rep = x0; rep < vw; rep += PUEBLO_W) {
    const [mx, my] = geo.molino;
    const ax = rep + mx;
    if (ax > -20 && ax < vw + 20) {
      const f = C.aspas[Math.floor(t * 4) % C.aspas.length];
      g.drawImage(f, ax - 16, top + my - 24 - 16 + 3);
    }
    const ch = geo.chimeneas;
    for (let i = 0; i < ch.length; i += 2) {
      const cx = rep + ch[i];
      if (cx < -20 || cx > vw + 10) continue;
      for (let j = 0; j < 3; j++) {
        const ph = mod(t * 0.35 + j / 3 + i * 0.13, 1);
        const sp = C.humo[Math.min(2, Math.floor(ph * 3))];
        const hx = Math.round(cx + ph * 9 + Math.sin(ph * 6 + i) * 1.5 - sp.width / 2 + 1);
        const hy = Math.round(top + ch[i + 1] - 3 - ph * 16 - sp.height / 2);
        g.drawImage(sp, hx, hy);
      }
    }
  }

  // Pajaritos (bandada en V).
  if (C.pajaro) {
    g.fillStyle = C.pajaro;
    const bx = mod(1800 - t * 16 - camX * 0.45, 2400) - 200;
    const by = ys(0.5) - 120 + Math.round(Math.sin(t * 0.7) * 4);
    if (bx > -40 && bx < vw + 40)
      for (let i = 0; i < 5; i++) {
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

  // Nubes cercanas.
  nubes(g, NUBES_CERCA, C.cerca, 0.22, ys(0.62), o, drift);

  // Bosque.
  const yB = ys(0.62) + 24;
  tira(g, C.bosque.cv, camX * 0.45, yB, vw);
  if (yB < vh) {
    g.fillStyle = C.bosque.fondo;
    g.fillRect(0, yB, vw, vh - yB);
  }

  // Luciérnagas.
  if (a === 'noche') {
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

  // Precalienta de a poco los otros ambientes (una tarea por cuadro).
  for (const b of AMBIENTES) if (b !== a && !listo.has(b)) {
    paso(b);
    break;
  }
}
