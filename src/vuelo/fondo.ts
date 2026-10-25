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
export function nombreZona(z: Zona | number): string {
  return NOMBRES[typeof z === 'number' ? zonaAltitud(z) : z];
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

const AMBIENTES: Ambiente[] = ['dia', 'tarde', 'noche'];
const BAJO = {} as Record<Ambiente, Obra<Capas>>;
const ALTO = {} as Record<Ambiente, Obra<Alto>>;
for (const a of AMBIENTES) {
  BAJO[a] = new Obra(tareas(a));
  ALTO[a] = new Obra(tareasAlto(a));
}
const ESPACIO = new Obra(tareasEspacio());
const ORDEN: Obra<unknown>[] = [BAJO.dia, BAJO.tarde, BAJO.noche, ESPACIO, ALTO.dia, ALTO.tarde, ALTO.noche] as Obra<unknown>[];

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
  if (ys(0.2) - 380 < vh) dibujarCampo(g, o, C, t, ys);

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

/** El paisaje de siempre: nubes, cordillera, colinas, pueblito, bosque y luciérnagas. */
function dibujarCampo(g: Ctx, o: OpcionesFondo, C: Capas, t: number, ys: (k: number) => number) {
  const { vw, vh, camX, ambiente: a } = o;

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
      if (y > vh) continue;
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
  if (top - 50 < vh) {
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
  }

  // Pajaritos (bandada en V).
  if (C.pajaro) {
    const bx = mod(1800 - t * 16 - camX * 0.45, 2400) - 200;
    const by = ys(0.5) - 120 + Math.round(Math.sin(t * 0.7) * 4);
    if (bx > -40 && bx < vw + 40 && by < vh + 10) bandada(g, C.pajaro, bx, by, t, 5);
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
