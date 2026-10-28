/*
 * La vida en tierra: lo pequeño y animado que vive sobre la tira del suelo de
 * San Antonio y de Valparaíso, y que crece oleada a oleada.
 *
 * Every sprite here is painted once (pre-rendered canvases, toned down like the
 * ground strip so the enemies still stand out); each frame only moves them with
 * drawImage and a few fillRects, with no allocations. The cast is chosen when a
 * map is entered (`prepararVida`), from the wave number:
 *
 *   every wave   mice in the street (strolling, cheering the plane when it
 *                passes low, fleeing from enemy cars), neighbours peeking out
 *                of windows, quiltros, cats on the roofs, pelicans gliding over
 *                the port, laundry, colectivos / trolleybuses — more each wave
 *   lap 2 (5–8)  Fiestas Patrias: Chilean flags, strings of banderines, a fonda
 *                with a couple dancing cueca, «VIVA CHILE»
 *   lap 3 (9–12) Año Nuevo: fireworks over Cartagena and over Valparaíso's
 *                bay, «FELIZ AÑO NUEVO»
 *   any lap > 1  the damage from the last visit: scorched ground, rubble and
 *                smoke still rising where the craters were
 */
import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { R } from './dibujo';
import { apagarLienzo, anchoLetrero, escribir } from './fondo';
import { VENTANAS_SA } from './dibujo';
import { VENTANAS_VALPO } from './valparaiso';

type Ctx = CanvasRenderingContext2D;
type Cv = HTMLCanvasElement;
type MapaVida = 'valle' | 'oceano' | 'valparaiso' | 'tormenta';

export type OpcionesVida = {
  mapa: MapaVida;
  /** World x at the screen's left edge. */
  cam: number;
  vw: number;
  vh: number;
  /** Screen y of the ground strip's row 0. */
  yTop: number;
  /** Altitude → screen y. */
  sy: (alt: number) => number;
  /** Terrain altitude at world x. */
  suelo: (x: number) => number;
  t: number;
  quieto: boolean;
  /** 0 day … 1 night. */
  noche: number;
  avionX: number;
  avionY: number;
  /** Enemy vehicles on the ground (the mice run from them). */
  peligros: readonly { x: number }[];
};

/* ── Sprites (painted once) ───────────────────────────────────────────────── */

const APAGADO = { desat: 0.26, velo: 0.04, oscuro: 0.07 };

function lienzo(w: number, h: number, pinta: (g: Ctx) => void): Cv {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  pinta(g);
  return apagarLienzo(c, APAGADO);
}
/** The same sprite facing the other way. */
function espejo(c: Cv): Cv {
  const o = document.createElement('canvas');
  o.width = c.width;
  o.height = c.height;
  const g = o.getContext('2d')!;
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(c, 0, 0);
  return o;
}

const PIELES = ['#b4aabc', '#c8a07a', '#ece6f0', '#8a8094'];
const POLERAS = ['#e86a5c', '#5aa8a0', '#ffd27f', '#9ec5e8', '#c9a7e0', '#2f9a6a', '#f4a7b9', '#d8343a'];
const PANTALON = '#4a4a6a';
/** Mouse frames: 0 stand, 1 cheer (arms up), 2–3 run, 4 cueca (handkerchief up). */
const RAT_F = 5;
const RAT_W = 11;
const RAT_H = 13;

function raton(g: Ctx, piel: string, polera: string, f: number) {
  const tinta = D.tone(piel, -0.4);
  const ox = 2;
  // Tail, behind.
  R(g, ox - 1, 9, 1, 1, tinta);
  R(g, ox - 2, 8, 1, 1, tinta);
  // Ears.
  R(g, ox + 1, 0, 3, 3, tinta);
  R(g, ox + 2, 1, 1, 1, '#f4a7b9');
  R(g, ox + 4, 0, 3, 3, tinta);
  R(g, ox + 5, 1, 1, 1, '#f4a7b9');
  // Head and snout.
  R(g, ox + 1, 2, 6, 4, piel);
  R(g, ox + 7, 4, 1, 1, piel);
  R(g, ox + 8, 4, 1, 1, '#f48aa0');
  R(g, ox + 5, 3, 1, 1, P.eye);
  R(g, ox + 1, 5, 6, 1, tinta);
  // Shirt.
  R(g, ox + 2, 6, 4, 4, polera);
  R(g, ox + 2, 9, 4, 1, D.tone(polera, -0.3));
  // Arms.
  if (f === 1 || f === 4) {
    R(g, ox + 1, 3, 1, 3, piel);
    R(g, ox + 6, 3, 1, 3, piel);
    R(g, ox + 1, 2, 1, 1, piel);
    R(g, ox + 6, 2, 1, 1, piel);
    if (f === 4) {
      R(g, ox + 6, 0, 2, 2, P.white);
      R(g, ox + 8, 1, 1, 1, P.white);
    }
  } else if (f === 0) {
    R(g, ox + 1, 7, 1, 2, piel);
    R(g, ox + 6, 7, 1, 2, piel);
  } else {
    R(g, ox + (f === 2 ? 1 : 6), 7, 1, 2, piel);
    R(g, ox + (f === 2 ? 6 : 1), 6, 2, 1, piel);
  }
  // Legs.
  if (f === 2) {
    R(g, ox + 1, 10, 2, 1, PANTALON);
    R(g, ox + 0, 11, 1, 1, PANTALON);
    R(g, ox + 5, 10, 1, 2, PANTALON);
    R(g, ox + 6, 12, 1, 1, tinta);
  } else if (f === 3) {
    R(g, ox + 3, 10, 1, 2, PANTALON);
    R(g, ox + 4, 10, 2, 1, PANTALON);
    R(g, ox + 6, 11, 1, 1, PANTALON);
    R(g, ox + 3, 12, 1, 1, tinta);
  } else {
    R(g, ox + 2, 10, 1, 2, PANTALON);
    R(g, ox + 5, 10, 1, 2, PANTALON);
    R(g, ox + 2, 12, 2, 1, tinta);
    R(g, ox + 5, 12, 2, 1, tinta);
  }
}

/** A quiltro: 0–1 walk, 2 sit (wagging tail). */
function perro(g: Ctx, c: string, f: number) {
  const tinta = D.tone(c, -0.4);
  if (f === 2) {
    R(g, 2, 4, 6, 4, c);
    R(g, 6, 1, 4, 4, c);
    R(g, 6, 0, 1, 2, tinta);
    R(g, 10, 2, 1, 1, P.eye);
    R(g, 8, 2, 1, 1, P.eye);
    R(g, 7, 5, 2, 1, '#e86a5c');
    R(g, 1, 3, 1, 3, tinta);
    R(g, 2, 8, 2, 1, tinta);
    R(g, 6, 8, 2, 1, tinta);
    return;
  }
  R(g, 2, 3, 7, 3, c);
  R(g, 8, 1, 3, 3, c);
  R(g, 8, 0, 1, 2, tinta);
  R(g, 11, 2, 1, 1, P.eye);
  R(g, 10, 2, 1, 1, P.eye);
  R(g, 1, 1 + f, 1, 2, tinta);
  R(g, 2, 6, 1, 2 - f, tinta);
  R(g, 4, 6, 1, 1 + f, tinta);
  R(g, 7, 6, 1, 2 - f, tinta);
  R(g, 8, 6, 1, 1 + f, tinta);
  R(g, 3, 3, 3, 1, D.tone(c, 0.25));
}

/** A cat sitting on a roof: 0–1 tail, 2 blink. */
function gato(g: Ctx, c: string, f: number) {
  const tinta = D.tone(c, -0.45);
  R(g, 1, 4, 5, 5, c);
  R(g, 1, 1, 5, 4, c);
  R(g, 1, 0, 1, 1, c);
  R(g, 5, 0, 1, 1, c);
  if (f === 2) {
    R(g, 2, 2, 1, 1, tinta);
    R(g, 4, 2, 1, 1, tinta);
  } else {
    R(g, 2, 2, 1, 1, '#d8e860');
    R(g, 4, 2, 1, 1, '#d8e860');
  }
  R(g, 3, 3, 1, 1, '#f48aa0');
  R(g, 1, 8, 5, 1, tinta);
  if (f === 1) {
    R(g, 6, 7, 2, 1, c);
    R(g, 8, 5, 1, 2, c);
  } else {
    R(g, 6, 8, 3, 1, c);
    R(g, 9, 7, 1, 1, c);
  }
}

/** The Chilean flag on a pole, 3 frames of breeze. */
function bandera(g: Ctx, f: number) {
  R(g, 0, 0, 1, 22, '#7a7490');
  R(g, 0, 0, 2, 1, '#ffd27f');
  for (let c = 0; c < 11; c++) {
    const dy = Math.round(Math.sin(c * 0.8 - f * 2.1) * (c / 11) * 1.4);
    const x = 1 + c;
    const y = 1 + dy;
    R(g, x, y, 1, 3, c < 4 ? '#2a4ab0' : '#f8f6fa');
    R(g, x, y + 3, 1, 3, '#d8343a');
    if (c === 1) R(g, x + 0, y + 1, 1, 1, P.white);
  }
}

/** A string of banderines between two posts, 2 frames. */
const BANDERIN_W = 62;
function banderines(g: Ctx, f: number) {
  const cols = ['#2a4ab0', '#f8f6fa', '#d8343a'];
  for (let x = 1; x < BANDERIN_W - 1; x++) {
    const u = x / (BANDERIN_W - 1);
    const y = Math.round(1 + 5 * 4 * u * (1 - u) + f * Math.sin(u * Math.PI));
    R(g, x, y, 1, 1, '#5a5468');
    if (x % 5 === 2) {
      const c = cols[Math.floor(x / 5) % 3];
      R(g, x - 1, y + 1, 3, 1, c);
      R(g, x - 1, y + 2, 3, 1, c);
      R(g, x, y + 3, 1, 1, c);
    }
  }
}

/** A fonda: a ramada of branches on posts, flags on top and its sign. */
const FONDA_W = 50;
const FONDA_H = 34;
function fonda(g: Ctx) {
  const y0 = FONDA_H;
  for (const x of [2, 24, 46]) {
    R(g, x, y0 - 24, 2, 24, '#8a5a3a');
    R(g, x, y0 - 24, 1, 24, '#b07a4a');
  }
  // Roof of leafy branches.
  for (let x = 0; x < FONDA_W; x++) {
    const h = 5 + ((x * 7) % 3);
    R(g, x, y0 - 25 - h + 3, 1, h, x % 3 ? '#5a9a4a' : '#3e7a3a');
    if (x % 4 === 1) R(g, x, y0 - 26 - h + 3, 1, 1, '#8ac860');
  }
  R(g, 0, y0 - 22, FONDA_W, 1, '#3e6a32');
  // Little flags along the front.
  for (let x = 3; x < FONDA_W - 3; x += 6) {
    R(g, x, y0 - 21, 3, 1, '#2a4ab0');
    R(g, x, y0 - 20, 3, 1, P.white);
    R(g, x, y0 - 19, 3, 1, '#d8343a');
  }
  // Sign.
  const txt = 'FONDA';
  const w = anchoLetrero(txt) + 6;
  const sx = Math.floor((FONDA_W - w) / 2);
  R(g, sx - 1, y0 - 37 + 3, w + 2, 10, '#5a3a2a');
  R(g, sx, y0 - 36 + 3, w, 8, '#fff4e0');
  escribir(g, txt, sx + 3, y0 - 35 + 3, '#d8343a');
  // A bar with a barrel, a pot of chicha and anticuchos.
  R(g, 6, y0 - 9, 16, 2, '#b07a4a');
  R(g, 7, y0 - 7, 1, 7, '#8a5a3a');
  R(g, 20, y0 - 7, 1, 7, '#8a5a3a');
  D.oval(g, 33, y0 - 5, 4, 5, '#8a5a3a');
  R(g, 29, y0 - 7, 9, 1, '#5a3a2a');
  R(g, 29, y0 - 3, 9, 1, '#5a3a2a');
  R(g, 9, y0 - 12, 3, 3, '#c05a3a');
  for (let i = 0; i < 3; i++) R(g, 14 + i * 2, y0 - 13, 1, 4, '#c08050');
  // Paper lanterns (they glow after dark).
  for (const x of [12, 38]) {
    R(g, x, y0 - 18, 1, 2, '#5a5468');
    R(g, x - 1, y0 - 16, 3, 3, '#ffd870');
  }
}

/** A colectivo: a black sedan with its yellow roof sign. 2 frames (wheels). */
function colectivo(g: Ctx, f: number) {
  R(g, 4, 2, 10, 4, '#2a2838');
  R(g, 5, 3, 3, 2, '#7a8aa8');
  R(g, 9, 3, 3, 2, '#7a8aa8');
  R(g, 1, 5, 18, 4, '#2a2838');
  R(g, 1, 5, 18, 1, '#4a4858');
  R(g, 7, 0, 5, 2, '#ffd23f');
  R(g, 8, 1, 3, 1, '#2a2838');
  R(g, 18, 6, 1, 1, '#fff6d0');
  R(g, 1, 6, 1, 1, '#e8404a');
  for (const x of [4, 14]) {
    R(g, x - 1, 8, 3, 3, '#1a1828');
    R(g, x + (f ? -1 : 0), 9, 1, 1, '#8a8aa0');
  }
}

/** Valparaíso's trolleybus: green below, cream above, its two poles up to the wire. */
const TROLE_W = 34;
const TROLE_H = 40;
function trolebus(g: Ctx, f: number) {
  const y0 = TROLE_H - 1;
  R(g, 1, y0 - 13, 30, 12, '#2a4a3a');
  R(g, 2, y0 - 12, 28, 6, '#f2e6c8');
  R(g, 2, y0 - 6, 28, 5, '#3a9a6a');
  R(g, 2, y0 - 6, 28, 1, '#2f7a52');
  for (let x = 4; x < 28; x += 5) R(g, x, y0 - 11, 4, 3, '#7a9ab8');
  R(g, 28, y0 - 11, 2, 7, '#7a9ab8');
  R(g, 29, y0 - 4, 2, 1, '#fff6d0');
  R(g, 3, y0 - 13, 26, 1, '#d8ccb0');
  // Poles, trailing back to the wire ~34 px over the street.
  for (let i = 0; i < 22; i++) {
    R(g, 8 - Math.round(i * 0.33), y0 - 14 - i, 1, 1, '#3a3a50');
    R(g, 13 - Math.round(i * 0.33), y0 - 14 - i, 1, 1, '#3a3a50');
  }
  for (const x of [7, 24]) {
    R(g, x - 2, y0 - 2, 5, 3, '#1a1828');
    R(g, x + (f ? -1 : 1), y0 - 1, 1, 1, '#8a8aa0');
  }
}

/** A pelican gliding: 2 frames. */
function pelicano(g: Ctx, f: number) {
  const ala = f ? 1 : 0;
  R(g, 4, 3, 7, 3, '#8a8090');
  R(g, 5, 3, 5, 2, '#b8b0bc');
  R(g, 11, 2, 2, 2, '#fff4e0');
  R(g, 13, 3, 4, 1, '#ffc040');
  R(g, 13, 4, 3, 1, '#e09a30');
  R(g, 0, 3 - ala * 2, 5, 1, '#6a6070');
  R(g, 5, 2 - ala * 2, 4, 1, '#6a6070');
  R(g, 1, 4, 3, 1, '#6a6070');
}

/** Laundry on a line between two posts: 2 frames of sway. */
const ROPA_W = 30;
function ropa(g: Ctx, f: number) {
  R(g, 0, 0, 1, 14, '#7a7490');
  R(g, ROPA_W - 1, 0, 1, 14, '#7a7490');
  for (let x = 1; x < ROPA_W - 1; x++) R(g, x, 1 + (x > 6 && x < 23 ? 1 : 0), 1, 1, '#5a5468');
  const prendas: [number, number, number, string][] = [[3, 4, 5, '#9ec5e8'], [9, 3, 6, '#f4a7b9'], [14, 5, 4, P.white], [21, 4, 5, '#ffd27f']];
  for (const [x, w, h, c] of prendas) {
    const sw = f && x % 2 ? 1 : 0;
    R(g, x + sw, 2, w, h, c);
    R(g, x + sw, 2, w, 1, D.tone(c, -0.2));
  }
}

/** A text banner on two poles. */
function pancarta(txt: string, fondo: string): Cv {
  const w = anchoLetrero(txt) + 8;
  return lienzo(w + 2, 12, (g) => {
    R(g, 1, 1, w, 11, D.tone(fondo, -0.35));
    R(g, 1, 2, w, 9, fondo);
    escribir(g, txt, 5, 4, P.white, D.tone(fondo, -0.45));
  });
}

type Sprites = {
  rat: Cv[][]; // [variant][frame*2 + dir]
  perro: Cv[][];
  gato: Cv[][];
  bandera: Cv[];
  banderines: Cv[];
  fonda: Cv;
  colectivo: Cv[];
  trole: Cv[];
  pelicano: Cv[];
  ropa: Cv[];
  pancartas: Map<string, Cv>;
};
let SP: Sprites | null = null;

const PANCARTAS: [string, string][] = [
  ['¡VAMOS ESCUADRÓN!', '#3d85c6'],
  ['¡GRACIAS DUI!', '#e86a5c'],
  ['¡VIVA CHILE!', '#d8343a'],
  ['¡FELIZ 18!', '#2a4ab0'],
  ['¡FELIZ AÑO NUEVO!', '#8a5ab0'],
  ['¡VAMOS DECANO!', '#2f8a5a'],
  ['¡VAMOS SAN ANTONIO!', '#5aa8a0'],
];

/** Paints every sprite once (a few ms; called when a land map is first entered). */
export function precalentarVida() {
  if (SP) return;
  const doble = (w: number, h: number, pinta: (g: Ctx) => void) => {
    const c = lienzo(w, h, pinta);
    return [c, espejo(c)];
  };
  const rat: Cv[][] = [];
  for (let i = 0; i < PIELES.length * POLERAS.length; i++) {
    const fr: Cv[] = [];
    for (let f = 0; f < RAT_F; f++) fr.push(...doble(RAT_W, RAT_H, (g) => raton(g, PIELES[i % PIELES.length], POLERAS[Math.floor(i / PIELES.length)], f)));
    rat.push(fr);
  }
  const perros = ['#c08a5a', '#4a3a40', '#e8dcc8', '#a87a4a'].map((c) => {
    const fr: Cv[] = [];
    for (let f = 0; f < 3; f++) fr.push(...doble(13, 9, (g) => perro(g, c, f)));
    return fr;
  });
  const gatos = ['#3a3448', '#e8a050', '#9a94a8', '#f4f0f8'].map((c) => {
    const fr: Cv[] = [];
    for (let f = 0; f < 3; f++) fr.push(lienzo(10, 9, (g) => gato(g, c, f)));
    return fr;
  });
  const pancartas = new Map<string, Cv>();
  for (const [t, c] of PANCARTAS) pancartas.set(t, pancarta(t, c));
  SP = {
    rat,
    perro: perros,
    gato: gatos,
    bandera: [0, 1, 2].map((f) => lienzo(13, 22, (g) => bandera(g, f))),
    banderines: [0, 1].map((f) => lienzo(BANDERIN_W, 16, (g) => banderines(g, f))),
    fonda: lienzo(FONDA_W, FONDA_H, fonda),
    colectivo: [0, 1].flatMap((f) => doble(20, 11, (g) => colectivo(g, f))),
    trole: [0, 1].flatMap((f) => doble(TROLE_W, TROLE_H, (g) => trolebus(g, f))),
    pelicano: [0, 1].map((f) => lienzo(17, 7, (g) => pelicano(g, f))),
    ropa: [0, 1].map((f) => lienzo(ROPA_W, 10, (g) => ropa(g, f))),
    pancartas,
  };
}

/* ── The cast of the current map ──────────────────────────────────────────── */

const K = {
  Raton: 0,
  Perro: 1,
  Gato: 2,
  Bandera: 3,
  Banderines: 4,
  Fonda: 5,
  Cueca: 6,
  Colectivo: 7,
  Trole: 8,
  Pelicano: 9,
  Ropa: 10,
  Pancarta: 11,
  Humo: 12,
  Ventana: 13,
} as const;
type K = (typeof K)[keyof typeof K];

type Actor = {
  k: K;
  /** World x (moving actors update it). */
  x: number;
  /** Home range. */
  x0: number;
  x1: number;
  /** Facing: 1 right, -1 left. */
  d: number;
  /** Phase / seed. */
  f: number;
  /** Sprite variant. */
  v: number;
  /** Flee timer (s). */
  huye: number;
  /** Strip row (window mice, roof cats) or altitude offset (flyers); NaN = on the ground. */
  fila: number;
  /** Banner text. */
  txt: string;
};

let cast: Actor[] = [];
let mapaVida: MapaVida = 'valle';
let vuelta = 0;
let fuegos = false;
let tPrev = 0;

const h32 = (a: number, b: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

function actor(k: K, x: number, extra: Partial<Actor> = {}): Actor {
  return { k, x, x0: x - 20, x1: x + 20, d: 1, f: (h32(x, k) % 1000) / 159, v: 0, huye: 0, fila: NaN, txt: '', ...extra };
}

/** Where the street mice live, per map: [x0, x1] stretches. */
const CALLES: Record<'valle' | 'valparaiso', [number, number][]> = {
  valle: [[120, 380], [985, 1090], [1130, 1700], [2240, 2640], [2740, 2860], [2900, 3460]],
  valparaiso: [[170, 360], [460, 760], [880, 1260], [1330, 1600], [2030, 2240], [2810, 2930], [3170, 3260], [3480, 3530]],
};
/** Dogs, cats and laundry spots. */
const PERROS: Record<'valle' | 'valparaiso', number[]> = {
  valle: [1330, 2520, 3080, 940, 1680],
  valparaiso: [300, 600, 1100, 1480, 2080, 2860, 3200],
};
const ROPAS: Record<'valle' | 'valparaiso', number[]> = { valle: [1204, 1334, 1674, 360], valparaiso: [] };
/** Banners by map: [x, text, from wave, until lap (exclusive, 99 = always)]. */
const BANNERS: Record<'valle' | 'valparaiso', [number, string, number, number][]> = {
  valle: [[1900, '¡VAMOS SAN ANTONIO!', 2, 99], [2650, '¡GRACIAS DUI!', 3, 99], [2040, '¡VIVA CHILE!', 5, 2], [2880, '¡FELIZ 18!', 5, 2], [2040, '¡FELIZ AÑO NUEVO!', 9, 99]],
  valparaiso: [[2410, '¡VAMOS DECANO!', 1, 99], [620, '¡VAMOS ESCUADRÓN!', 2, 99], [1330, '¡VIVA CHILE!', 7, 2], [2850, '¡FELIZ AÑO NUEVO!', 11, 99], [160, '¡GRACIAS DUI!', 4, 99]],
};

/**
 * Picks the cast for a map at a wave. `cicatrices` are the biggest craters of
 * the last visit (world x, altitude, radius): they keep smoking.
 */
export function prepararVida(mapa: MapaVida, oleada: number, cicatrices: readonly [number, number, number][] = []) {
  mapaVida = mapa;
  cast = [];
  if (mapa !== 'valle' && mapa !== 'valparaiso') return;
  precalentarVida();
  const w = Math.max(1, oleada);
  vuelta = Math.floor((w - 1) / 4);
  fuegos = vuelta >= 2;
  const rnd = (i: number, s: number) => h32(i * 31 + w * 7, s);

  // Street mice: more every wave.
  const calles = CALLES[mapa];
  const nRat = Math.min(30, 5 + 3 * (w - 1));
  for (let i = 0; i < nRat; i++) {
    const [a, b] = calles[i % calles.length];
    const x = a + (rnd(i, 1) % Math.max(1, b - a));
    // Valparaíso's green jerseys (the Decano) turn up more often.
    const polera = mapa === 'valparaiso' && rnd(i, 4) % 3 === 0 ? 5 : vuelta === 1 && rnd(i, 4) % 2 === 0 ? 7 : rnd(i, 3) % POLERAS.length;
    cast.push(actor(K.Raton, x, { x0: Math.max(a, x - 40), x1: Math.min(b, x + 40), v: polera * PIELES.length + (rnd(i, 2) % PIELES.length), d: rnd(i, 5) % 2 ? 1 : -1 }));
  }
  // Neighbours at the windows: more lean out each wave.
  const ven = mapa === 'valle' ? VENTANAS_SA : VENTANAS_VALPO;
  const nVen = Math.min(ven.length / 2, Math.round((mapa === 'valle' ? 3 : 10) + w * (mapa === 'valle' ? 1.5 : 5)));
  const paso = Math.max(1, Math.floor(ven.length / 2 / Math.max(1, nVen)));
  for (let i = 0, n = 0; i < ven.length / 2 && n < nVen; i += paso, n++) {
    const j = (i + (rnd(n, 9) % paso)) * 2;
    cast.push(actor(K.Ventana, ven[j], { fila: ven[j + 1], v: rnd(n, 10) % PIELES.length, f: rnd(n, 11) % 100 }));
  }
  // Cats on the roofs (just over a window).
  const nGato = Math.min(8, 2 + Math.floor(w / 2));
  for (let n = 0; n < nGato && ven.length; n++) {
    const j = (rnd(n, 12) % (ven.length / 2)) * 2;
    cast.push(actor(K.Gato, ven[j] - 1, { fila: ven[j + 1] - (mapa === 'valle' ? 9 : 7), v: rnd(n, 13) % 4 }));
  }
  // Quiltros.
  const perros = PERROS[mapa];
  for (let i = 0; i < Math.min(perros.length, 1 + Math.ceil(w / 2)); i++) cast.push(actor(K.Perro, perros[i], { x0: perros[i] - 50, x1: perros[i] + 50, v: i % 4 }));
  for (const x of ROPAS[mapa]) cast.push(actor(K.Ropa, x));
  // Pelicans over the port; colectivos in San Antonio, trolleybuses in Valparaíso.
  if (mapa === 'valle') {
    for (let i = 0; i < Math.min(7, 2 + Math.floor(w / 2)); i++) cast.push(actor(K.Pelicano, 1800 + i * 150, { fila: 70 + (rnd(i, 14) % 50) }));
    if (w >= 2) cast.push(actor(K.Colectivo, 1400, { x0: 1130, x1: 1700 }));
    if (w >= 6) cast.push(actor(K.Colectivo, 3100, { x0: 2760, x1: 3450, d: -1 }));
  } else {
    cast.push(actor(K.Trole, 900, { x0: 170, x1: 2240, d: -1 }));
    if (w >= 5) cast.push(actor(K.Trole, 1800, { x0: 170, x1: 2240, d: 1 }));
  }
  // Fiestas Patrias (second lap) and on: flags, banderines, the fonda and its cueca.
  if (vuelta >= 1) {
    const nb = Math.min(16, 6 + 2 * (w - 5));
    for (let i = 0; i < nb; i++) {
      const [a, b] = calles[(i * 3) % calles.length];
      cast.push(actor(K.Bandera, a + (rnd(i, 15) % Math.max(1, b - a))));
    }
    for (let i = 0; i < Math.min(6, 2 + (w - 5)); i++) {
      const [a, b] = calles[(i * 2 + 1) % calles.length];
      cast.push(actor(K.Banderines, a + (rnd(i, 16) % Math.max(1, b - a - BANDERIN_W))));
    }
    if (mapa === 'valle') {
      cast.push(actor(K.Fonda, 924));
      cast.push(actor(K.Cueca, 945, { v: 7 * PIELES.length + 1, d: 1 }));
      cast.push(actor(K.Cueca, 945, { v: 6 * PIELES.length + 2, d: -1, f: Math.PI }));
    } else {
      cast.push(actor(K.Cueca, 3200, { v: 7 * PIELES.length, d: 1 }));
      cast.push(actor(K.Cueca, 3200, { v: 3 * PIELES.length + 2, d: -1, f: Math.PI }));
    }
  }
  for (const [x, txt, desde, hasta] of BANNERS[mapa]) if (w >= desde && vuelta < hasta) cast.push(actor(K.Pancarta, x, { txt }));
  // The last visit's damage, still smoking.
  for (const [x] of cicatrices) cast.push(actor(K.Humo, x));
}

/**
 * The scorch marks of the last visit, painted once into the ground strip
 * (`top` = the strip's row-0 altitude).
 */
export function chamuscar(g: Ctx, top: number, cicatrices: readonly [number, number, number][], suelo: (x: number) => number) {
  for (const [x, , r] of cicatrices) {
    const rr = Math.max(6, Math.min(18, Math.round(r)));
    for (let dx = -rr; dx <= rr; dx++) {
      const xx = Math.round(x + dx);
      const y = top - Math.round(suelo(xx));
      const k = 1 - Math.abs(dx) / (rr + 1);
      const hondo = Math.round(1 + k * 4);
      for (let dy = 0; dy < hondo; dy++) if ((xx + dy) % 3 || k > 0.6) R(g, xx, y + dy, 1, 1, k > 0.55 ? '#3a3040' : '#6a5a64');
      // Rubble and charred sticks.
      if (h32(xx, 77) % 7 === 0 && k > 0.3) R(g, xx, y - 1, 2, 1, h32(xx, 78) % 2 ? '#8a7a80' : '#4a3a40');
    }
  }
}

/** Biggest craters of a list (to remember the damage). */
export function peoresCrateres(cr: readonly [number, number, number][], n = 5): [number, number, number][] {
  const out = [...cr].sort((a, b) => b[2] - a[2]);
  const elegidos: [number, number, number][] = [];
  for (const c of out) {
    if (elegidos.length >= n) break;
    if (elegidos.some((e) => Math.abs(e[0] - c[0]) < 50)) continue;
    elegidos.push([c[0], c[1], c[2]]);
  }
  return elegidos;
}

/* ── Per frame ────────────────────────────────────────────────────────────── */

const LUZ_FAROL = ['#ffd870', '#fff4c0'];
const FAROLITOS = [12, 38];

/** Two poles from a banner's top down to the ground at each end (the street may slope). */
function postes(g: Ctx, x0: number, x1: number, top: number, y0: number, y1: number) {
  g.fillStyle = '#7a7490';
  g.fillRect(x0, top, 1, y0 - top);
  g.fillRect(x1, top, 1, y1 - top);
}

/** The cast on the ground strip (after the strip, before the enemies). */
export function dibujarVida(g: Ctx, o: OpcionesVida) {
  if (!SP || o.mapa !== mapaVida || !cast.length) return;
  const S = SP;
  const { cam, vw, t } = o;
  const dt = o.quieto ? 0 : Math.max(0, Math.min(0.1, t - tPrev));
  tPrev = t;
  const avionBajo = o.avionY - o.suelo(o.avionX) < 90;
  for (let i = 0; i < cast.length; i++) {
    const a = cast[i];
    const reach = a.k === K.Trole || a.k === K.Colectivo ? a.x1 - a.x0 : 0;
    // Movers update even off screen (cheap), drawing only when visible.
    if (a.k === K.Raton || a.k === K.Perro) {
      let peligro = 99999;
      for (let j = 0; j < o.peligros.length; j++) {
        const dx = o.peligros[j].x - a.x;
        if (Math.abs(dx) < Math.abs(peligro)) peligro = dx;
      }
      if (Math.abs(peligro) < 70 && a.huye <= 0) {
        a.huye = 2.5;
        a.d = peligro > 0 ? -1 : 1;
      }
      if (a.huye > 0) {
        a.huye -= dt;
        a.x += a.d * 42 * dt;
      } else {
        // Strolling with pauses, turning at the ends of home.
        const anda = Math.sin(t * 0.35 + a.f * 3) > -0.1;
        if (anda) a.x += a.d * (a.k === K.Perro ? 9 : 5) * dt;
        if (a.x < a.x0) a.d = 1;
        if (a.x > a.x1) a.d = -1;
      }
    } else if (reach) {
      const vel = a.k === K.Trole ? 18 : 30;
      a.x += a.d * vel * dt;
      if (a.x < a.x0) a.d = 1;
      if (a.x > a.x1) a.d = -1;
    } else if (a.k === K.Pelicano) {
      a.x -= 16 * dt;
      if (a.x < 1650) a.x += 1150;
    }
    const sx = Math.round(a.x - cam);
    if (sx < -80 || sx > vw + 80) continue;
    switch (a.k) {
      case K.Raton: {
        const y = o.sy(o.suelo(a.x));
        const cerca = avionBajo && Math.abs(o.avionX - a.x) < 70;
        let f = 0;
        let salto = 0;
        if (a.huye > 0) f = 2 + (Math.floor(t * 10 + a.f) & 1);
        else if (cerca || (vuelta >= 1 && Math.sin(t * 1.3 + a.f * 5) > 0.75)) {
          f = 1;
          salto = Math.abs(Math.sin(t * 9 + a.f)) > 0.5 ? 2 : 0;
        } else if (Math.sin(t * 0.35 + a.f * 3) > -0.1) f = 2 + (Math.floor(t * 4 + a.f) & 1);
        const spr = S.rat[a.v][f * 2 + (a.d > 0 ? 0 : 1)];
        g.drawImage(spr, sx - 5, y - RAT_H + 1 - salto);
        break;
      }
      case K.Perro: {
        const y = o.sy(o.suelo(a.x));
        const quieto = a.huye <= 0 && Math.sin(t * 0.35 + a.f * 3) <= -0.1;
        const f = quieto ? 2 : Math.floor(t * (a.huye > 0 ? 10 : 5) + a.f) & 1;
        g.drawImage(S.perro[a.v][f * 2 + (a.d > 0 ? 0 : 1)], sx - 6, y - 9 + (quieto && Math.floor(t * 6) & 1 ? 0 : 0));
        break;
      }
      case K.Gato: {
        const y = o.yTop + a.fila;
        const f = Math.sin(t * 2.3 + a.f) > 0.92 ? 2 : Math.floor(t * 1.5 + a.f) & 1;
        g.drawImage(S.gato[a.v][f], sx, y);
        break;
      }
      case K.Ventana: {
        // A neighbour leans out while the plane flies near (and ducks if a car comes).
        const y = o.yTop + a.fila;
        const cerca = Math.abs(o.avionX - a.x) < 140;
        const siempre = (a.f % 3) === 0;
        if (!cerca && !siempre) break;
        let peligro = false;
        for (let j = 0; j < o.peligros.length; j++) if (Math.abs(o.peligros[j].x - a.x) < 60) peligro = true;
        if (peligro) break;
        const piel = PIELES[a.v];
        const tinta = '#5a5070';
        R(g, sx, y - 1, 1, 1, tinta);
        R(g, sx + 2, y - 1, 1, 1, tinta);
        R(g, sx, y, 3, 2, piel);
        R(g, sx + 1, y, 1, 1, P.eye);
        if (cerca && Math.sin(t * 8 + a.f) > 0) {
          R(g, sx - 1, y - 1, 1, 2, piel);
          R(g, sx + 3, y - 1, 1, 2, piel);
        }
        break;
      }
      case K.Bandera: {
        const y = o.sy(o.suelo(a.x));
        g.drawImage(S.bandera[o.quieto ? 0 : Math.floor(t * 5 + a.f) % 3], sx, y - 22);
        break;
      }
      case K.Banderines: {
        const yL = o.sy(o.suelo(a.x));
        const yR = o.sy(o.suelo(a.x + BANDERIN_W - 1));
        const top = Math.min(yL, yR) - 16;
        postes(g, sx, sx + BANDERIN_W - 1, top, yL, yR);
        g.drawImage(S.banderines[o.quieto ? 0 : Math.floor(t * 2 + a.f) & 1], sx, top);
        break;
      }
      case K.Ropa: {
        const y = o.sy(o.suelo(a.x));
        g.drawImage(S.ropa[o.quieto ? 0 : Math.floor(t * 2.5 + a.f) & 1], sx, y - 14);
        break;
      }
      case K.Fonda: {
        const y = o.sy(o.suelo(a.x + FONDA_W / 2));
        g.drawImage(S.fonda, sx, y - FONDA_H);
        if (o.noche > 0.3) {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = Math.min(1, o.noche);
          for (const lx of FAROLITOS) {
            g.fillStyle = '#4a3010';
            g.fillRect(sx + lx - 3, y - FONDA_H + 15, 7, 7);
            g.fillStyle = LUZ_FAROL[Math.floor(t * 3 + lx) & 1];
            g.fillRect(sx + lx - 1, y - FONDA_H + 17, 3, 3);
          }
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
        break;
      }
      case K.Cueca: {
        // Circling each other, handkerchief up, hopping to the guitar.
        const u = o.quieto ? 0 : t * 1.4 + a.f;
        const x = sx + Math.round(Math.sin(u) * 9);
        const y = o.sy(o.suelo(a.x)) - (Math.floor(t * 4) & 1);
        const dir = Math.cos(u) > 0 ? a.d : -a.d;
        g.drawImage(S.rat[a.v][4 * 2 + (dir > 0 ? 0 : 1)], x - 5, y - RAT_H + 1);
        break;
      }
      case K.Colectivo: {
        const y = o.sy(o.suelo(a.x));
        g.drawImage(S.colectivo[(Math.floor(t * 8) & 1) * 2 + (a.d > 0 ? 0 : 1)], sx - 10, y - 10);
        break;
      }
      case K.Trole: {
        const y = o.sy(o.suelo(a.x));
        g.drawImage(S.trole[(Math.floor(t * 6) & 1) * 2 + (a.d > 0 ? 1 : 0)], sx - TROLE_W / 2, y - TROLE_H + 1);
        break;
      }
      case K.Pelicano: {
        const y = o.sy(o.suelo(a.x) + a.fila + Math.sin(t * 0.8 + a.f) * 3);
        g.drawImage(S.pelicano[Math.sin(t * 3 + a.f) > 0.6 ? 1 : 0], sx, y);
        break;
      }
      case K.Pancarta: {
        const c = S.pancartas.get(a.txt);
        if (!c) break;
        const yL = o.sy(o.suelo(a.x));
        const yR = o.sy(o.suelo(a.x + c.width - 1));
        const top = Math.min(yL, yR) - 24;
        postes(g, sx, sx + c.width - 1, top, yL, yR);
        g.drawImage(c, sx, top);
        break;
      }
      case K.Humo: {
        // Grey puffs rising and widening from the old crater.
        const y0 = o.sy(o.suelo(a.x));
        for (let j = 0; j < 5; j++) {
          const k = o.quieto ? j / 5 : (t * 0.3 + j / 5 + a.f) % 1;
          const r = 1 + Math.round(k * 4);
          const yy = y0 - 2 - Math.round(k * 46);
          const xx = sx + Math.round(Math.sin(k * 5 + a.f) * 3 + k * 10);
          g.globalAlpha = 0.75 * (1 - k);
          D.disc(g, xx, yy, r, o.noche > 0.5 ? '#4a4458' : '#8a8494');
          D.disc(g, xx - 1, yy - 1, Math.max(0, r - 1), o.noche > 0.5 ? '#5a546a' : '#aaa4b4');
        }
        g.globalAlpha = 1;
        // Embers glow after dark.
        if (o.noche > 0.4 && Math.floor(t * 3 + a.f) % 2) {
          g.fillStyle = '#ff8a3a';
          g.fillRect(sx - 1, y0 - 1, 1, 1);
          g.fillRect(sx + 2, y0, 1, 1);
        }
        break;
      }
    }
  }
}

/* ── Año Nuevo: fireworks over the bay (drawn behind the ground strip) ──── */

const RAYOS = 20;
const COS = Array.from({ length: RAYOS }, (_, i) => Math.cos((i / RAYOS) * Math.PI * 2));
const SIN = Array.from({ length: RAYOS }, (_, i) => Math.sin((i / RAYOS) * Math.PI * 2));
const COLORES_FUEGO = ['#ff6a8a', '#ffd23f', '#7ae0ff', '#b4ff8a', '#ffffff', '#d08aff'];
/** Rockets: [world x, burst altitude above the city, period s, burst radius]. */
const COHETES: [number, number, number, number][] = [
  [180, 230, 3.1, 34], [330, 290, 3.7, 44], [520, 250, 2.9, 30], [700, 300, 4.1, 48], [880, 240, 3.3, 36],
  [1060, 280, 3.9, 40], [1250, 250, 3.0, 32], [1440, 300, 4.3, 50], [1640, 260, 3.5, 38], [1840, 240, 3.2, 34],
  [2040, 290, 3.6, 44], [2240, 250, 3.1, 36], [2440, 280, 4.0, 46], [2640, 240, 3.4, 34], [2840, 300, 3.8, 48],
  [3040, 260, 3.0, 36], [3240, 250, 3.6, 40], [3440, 280, 3.3, 42],
];

/** Fireworks in the sky when it's Año Nuevo (third lap and on) after dusk. */
export function dibujarFuegos(g: Ctx, o: OpcionesVida) {
  if (!fuegos || o.noche < 0.3 || o.mapa !== mapaVida || o.quieto) return;
  const base = o.mapa === 'valparaiso' ? 140 : 60;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < COHETES.length; i++) {
    const [X, alt, per0, rad] = COHETES[i];
    const per = per0 * 0.8;
    // A little parallax: they burst far off over the bay.
    const x = Math.round(X - o.cam * 0.85 - 0.15 * o.vw * 0.5);
    if (x < -60 || x > o.vw + 60) continue;
    const u = (o.t + i * 0.71) % per;
    const ciclo = Math.floor((o.t + i * 0.71) / per);
    const col = COLORES_FUEGO[(ciclo * 3 + i) % COLORES_FUEGO.length];
    const yB = o.sy(base + alt);
    if (u < 0.7) {
      // The rocket going up, a spark with a short trail.
      const k = u / 0.7;
      const y = Math.round(o.sy(base) + (yB - o.sy(base)) * (1 - (1 - k) * (1 - k)));
      g.globalAlpha = 0.9;
      g.fillStyle = '#fff4c0';
      g.fillRect(x, y, 1, 2);
      g.fillStyle = '#8a5a2a';
      g.fillRect(x, y + 2, 1, 3);
    } else if (u < 2.6) {
      const k = (u - 0.7) / 1.9;
      const r = rad * (1 - (1 - k) * (1 - k) * (1 - k));
      const caida = 16 * k * k;
      // A soft glow at the heart of the burst, then the stars with their trails.
      if (k < 0.35) {
        g.globalAlpha = 0.35 * (1 - k / 0.35);
        g.fillStyle = col;
        const gr = Math.round(r * 0.7);
        g.fillRect(x - gr, yB - (gr >> 1), gr * 2 + 1, gr + 1);
        g.fillRect(x - (gr >> 1), yB - gr, gr + 1, gr * 2 + 1);
      }
      g.globalAlpha = Math.max(0, 1 - k * k);
      g.fillStyle = col;
      const s = k < 0.6 ? 2 : 1;
      for (let j = 0; j < RAYOS; j++) {
        const px = Math.round(x + COS[j] * r);
        const py = Math.round(yB + SIN[j] * r + caida);
        // Twinkling at the end (the crackle).
        if (k > 0.7 && (j + Math.floor(o.t * 14)) % 3 === 0) continue;
        g.fillRect(px - (s >> 1), py - (s >> 1), s, s);
        if (k < 0.8) {
          g.fillRect(Math.round(x + COS[j] * r * 0.82), Math.round(yB + SIN[j] * r * 0.82 + caida * 0.8), 1, 1);
          g.fillRect(Math.round(x + COS[j] * r * 0.66), Math.round(yB + SIN[j] * r * 0.66 + caida * 0.6), 1, 1);
        }
      }
      if (k < 0.08) {
        g.globalAlpha = 1;
        g.fillStyle = '#ffffff';
        g.fillRect(x - 2, yB - 2, 5, 5);
      }
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}
