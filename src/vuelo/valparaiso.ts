import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { DIRT, R } from './dibujo';
import { escribir, anchoLetrero } from './fondo';

/*
 * The Valparaíso map: steep hills seen from the side. The ground strip is the
 * city itself — the street on top, and under it rows of corrugated-zinc houses
 * of every color stacked down the slope, retaining walls, staircases, murals,
 * the funiculars (ascensores) and the downhill race decorations. Animated bits
 * (cabins, laundry, the dog, gulls) are drawn per frame by dibujarDetallesValpo.
 */

type Ctx = CanvasRenderingContext2D;

const LEVEL = 3600;
/** Room above the highest street for buildings that stand on it. */
const DECO = 64;
/** The flat pier at the left end (fish market). */
const PUERTO = 150;

// Brief palette: pink, yellow, turquoise, sky, lilac, apricot, pistachio, zinc red, cream, night blue.
const MUROS = ['#f4a7b9', '#ffd27f', '#8fd3c8', '#9ec5e8', '#c9a7e0', '#f6b38e', '#b5d99c', '#e86a5c', '#fff6e5'];
const TECHOS = ['#e86a5c', '#7a8ab0', '#5aa8a0', '#c0605a', '#9a8aa8'];
const NOCHE = '#3e4a6b';
const PIEDRA = '#cdbfae';
const PIEDRA0 = '#b4a492';
const PIEDRA1 = '#e2d6c6';

const hash = (x: number, s = 0) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(s | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/* ── Terrain ─────────────────────────────────────────────────────────────── */

/** The hills' outline: [x, height]; straight between points, plus a gentle wobble. */
const PUNTOS: [number, number][] = [
  [0, 30], [150, 30], [230, 70], [300, 74], [360, 72], [456, 120], [520, 128], [600, 96], [640, 90],
  [760, 150], [860, 156], [900, 150], [980, 104], [1040, 100], [1120, 140], [1220, 160], [1300, 158],
  [1380, 120], [1440, 116], [1508, 150], [1640, 154], [1720, 110], [1800, 96], [1880, 130], [2000, 160],
  [2100, 152], [2160, 122], [2260, 118], [2340, 146], [2460, 140], [2540, 100], [2600, 92], [2680, 126],
  // The last hill (Recreo), then the cliff road down to the coast north.
  [2740, 128], [2870, 60],
  // Avenida España, Viña del Mar, Reñaca's beach and its hill; the Concón dunes are dunaAt().
  [3000, 52], [3240, 56], [3290, 54], [3410, 120], [3600, 150],
];
/** The coast north, by world x: Avenida España, Viña del Mar, Reñaca (beach, then the hill), the Concón dunes. */
const COSTA = 2870;
const VINA = 3000;
const RENACA = 3240;
const SUBIDA = 3290;
const DUNAS = 3410;
/** Muelle Vergara: the pier's deck, over the sea. */
const MUELLE: [number, number] = [3176, 3238];
/** The Merval track along Avenida España: altitude of the rails, tunnel mouths [left, right]. */
const TREN_ALT = 30;
const TUNEL: [number, number] = [COSTA + 8, VINA - 12];
/** Stair-step slopes: [x0, x1, steps]. Each step is a flat tread and a short ramp. */
const ESCALERAS: [number, number, number][] = [[360, 456, 6], [1440, 1508, 4]];

const suave = (t: number) => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};
/** The Concón dunes: smooth rounded humps climbing gently to the end of the level. */
function dunaAt(x: number) {
  const u = x - DUNAS;
  return 120 + 24 * suave(u / 170) + 10 * (1 - Math.cos((u * 2 * Math.PI) / 140));
}

function lineal(x: number) {
  for (let i = 1; i < PUNTOS.length; i++) {
    const [x1, h1] = PUNTOS[i];
    if (x <= x1) {
      const [x0, h0] = PUNTOS[i - 1];
      return h0 + ((h1 - h0) * (x - x0)) / (x1 - x0);
    }
  }
  return PUNTOS[PUNTOS.length - 1][1];
}

/** Cerro Abajo kickers: lip x (the bikes ride down to the left and launch off it). */
const RAMPAS = [1872, 1918, 1962];
const RAMPA_W = 20;
const RAMPA_H = 6;
/** Height a kicker adds at x: full at the lip, nothing at its tail. */
function rampaAt(x: number) {
  for (const r0 of RAMPAS) if (x >= r0 && x < r0 + RAMPA_W) return RAMPA_H * (1 - (x - r0) / RAMPA_W);
  return 0;
}

/**
 * Terrain height of the Valparaíso level at world x (y up). Slopes stay ≤ ~45°,
 * except the drop off each Cerro Abajo kicker's lip (that's the jump).
 */
export function cerrosAt(x: number): number {
  return sueloAt(x) + rampaAt(clamp(x, 0, LEVEL));
}

function sueloAt(x: number): number {
  const xc = clamp(x, 0, LEVEL);
  if (xc >= DUNAS) return dunaAt(xc);
  // The coast road is nearly flat: the wobble fades out past the cliff, and to nothing at the dunes.
  let k = clamp((xc - PUERTO) / 60, 0, 1) * (1 - 0.7 * clamp((xc - COSTA + 60) / 60, 0, 1)) * clamp((DUNAS - xc) / 40, 0, 1);
  for (const [a, b, n] of ESCALERAS) {
    if (xc >= a && xc < b) {
      const h0 = lineal(a);
      const h1 = lineal(b);
      const s = ((xc - a) / (b - a)) * n;
      const i = Math.floor(s);
      return h0 + ((h1 - h0) / n) * (i + clamp((s - i - 0.5) * 2, 0, 1));
    }
    k = Math.min(k, clamp(Math.min(Math.abs(xc - a), Math.abs(xc - b)) / 24, 0, 1));
  }
  return lineal(xc) + k * (2 * Math.sin(xc / 29) + 1.5 * Math.sin(xc / 11 + 1));
}

/* ── What the strip remembers for the animated details ──────────────────── */

let alturas: Int16Array = new Int16Array(0);
const altura = (x: number) => alturas[clamp(Math.round(x), 0, alturas.length - 1)] ?? 0;
/** Funiculars on their own ~40° rail cut into the hill: [top station x, bottom altitude]. */
const ASC_TOP: [number, number][] = [[760, 90], [2680, 92]];
const ASC_PEND = 0.84;
/** Resolved rails: [bottom x, bottom altitude, top x, top altitude]. */
const ASCENSORES: [number, number, number, number][] = [];
/** The vertical lift: tower x, foot and top altitudes. */
let polanco: [number, number, number] = [1046, 100, 150];
/** Laundry lines [x, altitude, width] and the dog on the stairs [x, altitude]. */
const ROPAS: [number, number, number][] = [];
let perro: [number, number] = [0, 0];
const FAROLES: number[] = [];

/* ── The strip ───────────────────────────────────────────────────────────── */

/** A house facade built into the hillside: zinc walls, single-slope roof, windows. */
function casa(g: Ctx, x: number, y: number, w: number, h: number, s: number, fila = 0) {
  // Lower rows sit deeper in the hill: a touch duller each.
  const muro = fila ? D.tone(MUROS[s % MUROS.length], -0.05 * fila) : MUROS[s % MUROS.length];
  const techo = fila ? D.tone(TECHOS[(s >>> 4) % TECHOS.length], -0.05 * fila) : TECHOS[(s >>> 4) % TECHOS.length];
  R(g, x - 1, y, w + 2, h + 1, NOCHE);
  R(g, x - 1, y, w + 2, 2, PIEDRA);
  R(g, x, y + 2, w, h - 2, muro);
  // Corrugated zinc: thin darker lines every 2 px.
  const raya = D.tone(muro, -0.1);
  for (let lx = x + 1; lx < x + w; lx += 2) R(g, lx, y + 3, 1, h - 3, raya);
  // Single-slope roof, higher on one side.
  const alto = (s >>> 3) % 2;
  for (let i = 0; i < w + 2; i++) {
    const dy = Math.round(((alto ? i : w + 1 - i) / (w + 1)) * 2);
    R(g, x - 1 + i, y + dy, 1, 3 - dy, techo);
  }
  R(g, x, y + 3, w, 1, D.tone(muro, -0.25));
  if (s % 17 === 0 && w > 16) {
    mural(g, x + 1, y + 4, w - 2, h - 5, s);
    return;
  }
  // White-framed windows, one or two rows.
  const n = Math.max(1, Math.floor((w - 3) / 7));
  const gap = Math.floor((w - n * 5) / (n + 1));
  for (let row = 0; row < (h >= 20 ? 2 : 1); row++)
    for (let i = 0; i < n; i++) {
      const wx = x + gap + i * (5 + gap);
      const wy = y + 6 + row * 8;
      R(g, wx, wy, 5, 6, P.white);
      R(g, wx + 1, wy + 1, 3, 4, (s + i + row) % 5 === 0 ? P.p2 : P.gl1);
      R(g, wx + 1, wy + 1, 1, 1, P.gl2);
    }
  // Some have a little balcony, a few with a Chilean flag.
  if ((s >>> 5) % 3 === 0) {
    R(g, x + 2, y + h - 4, w - 4, 1, P.white);
    for (let bx = x + 2; bx < x + w - 2; bx += 3) R(g, bx, y + h - 3, 1, 2, P.white);
    if ((s >>> 7) % 5 === 0) {
      const fx = x + w - 7;
      R(g, fx, y + h - 11, 1, 8, NOCHE);
      R(g, fx + 1, y + h - 11, 5, 2, P.white);
      R(g, fx + 1, y + h - 9, 5, 2, P.red);
      R(g, fx + 1, y + h - 11, 2, 2, '#3a5ab0');
    }
  }
}

/** Open-air museum: flat blobs of color with an eye or a fish. */
function mural(g: Ctx, x: number, y: number, w: number, h: number, s: number) {
  R(g, x, y, w, h, '#fff6e5');
  const cols = ['#f4a7b9', '#8fd3c8', '#ffd27f', '#c9a7e0', '#9ec5e8', '#f6b38e'];
  for (let i = 0; i < 6; i++) {
    const cx = x + (hash(s, i) % w);
    const cy = y + (hash(s, i + 9) % h);
    const r = 2 + (hash(s, i + 20) % 4);
    for (let dy = -r; dy <= r; dy++) {
      const ww = Math.round(Math.sqrt(r * r - dy * dy));
      const y0 = cy + dy;
      if (y0 < y || y0 >= y + h) continue;
      const x0 = Math.max(x, cx - ww);
      const x1 = Math.min(x + w, cx + ww + 1);
      if (x1 > x0) R(g, x0, y0, x1 - x0, 1, cols[(s + i) % cols.length]);
    }
  }
  const mx = x + Math.floor(w / 2);
  const my = y + Math.floor(h / 2);
  if (s % 2) {
    // A big eye.
    D.oval(g, mx, my, 5, 2, P.white);
    D.disc(g, mx, my, 2, '#3a5ab0');
    R(g, mx, my, 1, 1, NOCHE);
    R(g, mx - 5, my - 3, 11, 1, NOCHE);
  } else {
    // A fish.
    D.oval(g, mx, my, 5, 2, P.o2);
    R(g, mx + 5, my - 2, 2, 5, P.o2);
    R(g, mx - 3, my - 1, 1, 1, NOCHE);
  }
}

/** A gap where the hill shows: earth and scrub, sometimes a house up on stilts. */
function matorral(g: Ctx, x: number, y0: number, y1: number, w: number, s: number) {
  R(g, x - 1, y0, w + 2, y1 - y0, '#a8987a');
  for (let y = y0 + 3; y < y1; y += 5) R(g, x + ((y >> 2) % 3), y, w - 3, 1, '#968668');
  for (let i = 0; i < 4; i++) {
    const bx = x + 3 + ((s >>> (i * 3)) % Math.max(1, w - 6));
    const by = y0 + 8 + ((s >>> (i * 2 + 5)) % Math.max(1, y1 - y0 - 12));
    D.disc(g, bx, by, 3, '#5a8a5a');
    D.disc(g, bx - 1, by - 1, 2, '#8ac07a');
  }
  if (s % 2) {
    // A house on stilts, hanging over the slope.
    casa(g, x + 1, y0 + 2, w - 2, 18, s >>> 3);
    for (let px = x + 2; px < x + w - 2; px += 6) R(g, px, y0 + 21, 2, Math.min(26, y1 - y0 - 21), '#6a5a4a');
  }
}

/** A staircase in a gap between houses: zigzag steps and a handrail. */
function escalera(g: Ctx, x: number, y0: number, y1: number, w: number) {
  R(g, x, y0, w, y1 - y0, PIEDRA0);
  for (let y = y0; y < y1; y++) {
    const k = (y - y0) % 4;
    R(g, x + 1, y, w - 2, 1, k === 0 ? P.white : k === 1 ? '#d8d4e4' : PIEDRA);
  }
  R(g, x, y0, 1, y1 - y0, NOCHE);
}

/** The fish market stall on the pier (the pantry here). (px, base) like paintPantry. */
function puestoPescado(g: Ctx, px: number, base: number) {
  // Posts and a striped awning.
  R(g, px + 2, base - 26, 2, 26, P.k0);
  R(g, px + 58, base - 26, 2, 26, P.k0);
  for (let i = 0; i < 64; i++) {
    const c = Math.floor(i / 6) % 2 ? P.white : '#f4a7b9';
    R(g, px + i - 1, base - 31, 1, 6, c);
    R(g, px + i - 1, base - 25 + (i % 6 < 3 ? 1 : 0), 1, 1, c);
  }
  R(g, px - 2, base - 32, 66, 1, '#c05a7a');
  // Counter with fish on crushed ice.
  R(g, px, base - 12, 62, 12, P.k0);
  R(g, px + 1, base - 11, 60, 11, P.k1);
  for (let x = px + 1; x < px + 61; x += 6) R(g, x, base - 11, 1, 11, P.k2);
  R(g, px + 1, base - 14, 60, 3, P.w3);
  for (let i = 0; i < 6; i++) {
    const fx = px + 6 + i * 9;
    const c = i % 3 === 0 ? P.o2 : i % 3 === 1 ? '#9ec5e8' : '#f4a7b9';
    D.oval(g, fx, base - 15, 3, 1, c);
    R(g, fx + 3, base - 16, 2, 3, c);
    R(g, fx - 2, base - 15, 1, 1, NOCHE);
  }
  // Sign: PESCADO.
  const w = anchoLetrero('PESCADO');
  R(g, px + 31 - Math.ceil(w / 2) - 3, base - 42, w + 6, 9, P.k0);
  R(g, px + 31 - Math.ceil(w / 2) - 2, base - 41, w + 4, 7, P.cream);
  escribir(g, 'PESCADO', px + 31 - Math.ceil(w / 2), base - 40, '#3a5ab0');
  R(g, px + 30, base - 33, 1, 2, P.k0);
  // Crates.
  for (const dx of [-12, -4]) {
    R(g, px + dx, base - 7, 7, 7, P.k0);
    R(g, px + dx + 1, base - 6, 5, 5, P.k2);
  }
}

/** A small plaque with white letters. (x, y) is its top-left. */
/** Extra rows a sign needs on top for accents and the tilde of Ñ. */
const tilde = (txt: string) => (/[ÑÁÉÍÓ]/.test(txt) ? 3 : 0);

function placa(g: Ctx, x: number, y: number, txt: string) {
  const w = anchoLetrero(txt) + 4;
  const e = tilde(txt);
  R(g, x - 1, y - 1 - e, w + 2, 9 + e, P.gold0);
  R(g, x, y - e, w, 7 + e, NOCHE);
  escribir(g, txt, x + 2, y + 1, P.white);
}

/** A blue street sign on a pole. */
function letreroCalle(g: Ctx, x: number, y: number, txt: string) {
  const w = anchoLetrero(txt) + 6;
  const e = tilde(txt);
  R(g, x, y - 20, 1, 20, NOCHE);
  R(g, x - 1, y - 28 - e, w + 2, 9 + e, P.white);
  R(g, x, y - 27 - e, w, 7 + e, '#3a5ab0');
  escribir(g, txt, x + 3, y - 26, P.white);
}

/** The fire brigade's station: cream walls, a big red door and a bell tower. */
function bomberos(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 30, 46, 30, NOCHE);
  R(g, x, y - 29, 44, 29, '#fff6e5');
  R(g, x - 2, y - 31, 48, 2, '#c0605a');
  R(g, x + 4, y - 18, 16, 18, '#c0403a');
  R(g, x + 5, y - 17, 14, 17, '#e05a4a');
  for (let i = 0; i < 4; i++) R(g, x + 5, y - 15 + i * 4, 14, 1, '#c0403a');
  R(g, x + 26, y - 16, 6, 6, P.gl1);
  R(g, x + 35, y - 16, 6, 6, P.gl1);
  // Bell tower with its bell.
  R(g, x + 30, y - 44, 12, 14, NOCHE);
  R(g, x + 31, y - 43, 10, 13, '#fff6e5');
  R(g, x + 33, y - 41, 6, 7, '#5a4a3a');
  D.oval(g, x + 36, y - 37, 2, 2, P.gold);
  R(g, x + 29, y - 46, 14, 2, '#c0605a');
  const txt = 'BOMBEROS 1851';
  const w = anchoLetrero(txt);
  R(g, x + 22 - Math.ceil(w / 2) - 2, y - 27, w + 4, 7, '#c0403a');
  escribir(g, txt, x + 22 - Math.ceil(w / 2), y - 26, P.white);
}

/** A clock tower on the street (a generic one, like the city's old clocks). */
function relojTorre(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 44, 16, 44, NOCHE);
  R(g, x, y - 43, 14, 43, '#f2e0c8');
  R(g, x + 11, y - 43, 3, 43, '#e0c8a8');
  for (let yy = y - 30; yy < y - 4; yy += 7) R(g, x + 5, yy, 4, 4, P.gl1);
  D.disc(g, x + 7, y - 37, 5, NOCHE);
  D.disc(g, x + 7, y - 37, 4, P.white);
  R(g, x + 7, y - 40, 1, 3, NOCHE);
  R(g, x + 7, y - 37, 3, 1, NOCHE);
  for (let i = 0; i < 6; i++) R(g, x - 1 + i, y - 45 - i, 16 - i * 2, 1, '#7a8ab0');
  R(g, x + 6, y - 53, 2, 3, P.gold);
}

/** A tiny eatery with an awning: «CHORRILLANA». */
function picada(g: Ctx, x: number, y: number) {
  const txt = 'CHORRILLANA';
  const w = Math.max(42, anchoLetrero(txt) + 8);
  R(g, x - 1, y - 24, w + 2, 24, NOCHE);
  R(g, x, y - 23, w, 23, '#ffd27f');
  for (let i = 0; i < w + 4; i++) R(g, x - 2 + i, y - 14, 1, 3, Math.floor(i / 4) % 2 ? P.white : '#5aa870');
  R(g, x + 4, y - 9, 8, 9, P.k1);
  R(g, x + 16, y - 9, 12, 6, P.gl1);
  R(g, x + 17, y - 6, 4, 2, P.gold);
  R(g, x + 22, y - 6, 4, 2, '#e07a5f');
  R(g, x + 2, y - 22, w - 4, 7, P.cream);
  escribir(g, txt, x + Math.round((w - anchoLetrero(txt)) / 2), y - 21, '#c05a3a');
}

/** A street lamp; (x, y) is its foot. */
function farol(g: Ctx, x: number, y: number) {
  R(g, x, y - 13, 1, 13, NOCHE);
  R(g, x, y - 14, 4, 1, NOCHE);
  R(g, x + 2, y - 13, 3, 2, P.gold1);
  R(g, x + 3, y - 12, 1, 1, P.white);
}

/** A fence banner with a generic race name. */
function pancarta(g: Ctx, x: number, y: number, txt: string, fondo: string) {
  const w = anchoLetrero(txt) + 6;
  const e = tilde(txt);
  R(g, x, y - 14 - e, 1, 14 + e, NOCHE);
  R(g, x + w + 1, y - 14 - e, 1, 14 + e, NOCHE);
  R(g, x, y - 13 - e, w + 2, 9 + e, NOCHE);
  R(g, x + 1, y - 12 - e, w, 7 + e, fondo);
  escribir(g, txt, x + 4, y - 11, P.white, NOCHE);
}

/** The upper half of an oval standing on row `yb` (its flat side down). */
function cupula(g: Ctx, cx: number, yb: number, rx: number, ry: number, col: string) {
  for (let dy = 0; dy <= ry; dy++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
    R(g, cx - w, yb - 1 - dy, w * 2 + 1, 1, col);
  }
}

/** Stone blocks in one column, rows [y0, y1): courses of 5 with staggered joints. */
function piedraCol(g: Ctx, x: number, y0: number, y1: number) {
  if (y1 <= y0) return;
  R(g, x, y0, 1, y1 - y0, PIEDRA);
  for (let y = y0, i = 0; y < y1; y += 5, i++) {
    if (y + 4 < y1) R(g, x, y + 4, 1, 1, PIEDRA1);
    if ((x + (i % 2) * 6) % 12 === 0) R(g, x, y, 1, Math.min(4, y1 - y), PIEDRA0);
  }
}

/** Sea water in one column from row y down to yB; `ySup` is the waterline (foam on it). */
function marCol(g: Ctx, x: number, y: number, yB: number, ySup: number) {
  if (yB <= y) return;
  R(g, x, y, 1, yB - y, '#6fa8c9');
  if (ySup >= y && ySup + 2 <= yB) {
    R(g, x, ySup, 1, 2, '#9ec5e8');
    if (x % 9 < 4) R(g, x, ySup, 1, 1, P.white);
  }
  for (let yy = ySup + 6 + (hash(x, 61) % 5); yy < yB - 1; yy += 9) if (hash(x, yy) % 7 === 0) R(g, x, yy, 1, 1, '#a8d4ea');
}

/** Sand in one column from row y0 down to y1, darker with depth and with wind ripples. */
function arenaCol(g: Ctx, x: number, y0: number, y1: number) {
  if (y1 <= y0) return;
  R(g, x, y0, 1, y1 - y0, '#f0cc84');
  R(g, x, y0, 1, Math.min(8, y1 - y0), '#f8dca0');
  if (y1 - y0 > 30) R(g, x, y0 + 30, 1, y1 - y0 - 30, '#e4b870');
  for (let y = y0 + 9; y < y1 - 1; y += 7) R(g, x, y + Math.round(1.5 * Math.sin(x / 7 + y * 0.7)), 1, 1, '#d8a860');
}

/** A palm tree on row y (its foot), the trunk leaning a little to `dir`. */
function palmera(g: Ctx, x: number, y: number, alto: number, dir: 1 | -1) {
  let tx = x;
  for (let i = 0; i < alto; i++) {
    tx = x + Math.round(Math.sin((i / alto) * 1.3) * 3 * dir);
    R(g, tx - 1, y - 1 - i, 4, 1, NOCHE);
    R(g, tx, y - 1 - i, 2, 1, i % 3 === 0 ? '#7a5a3a' : '#a87a4a');
  }
  const cx = tx + 1;
  const cy = y - alto;
  // Fronds: each one a little arc that droops at the tip.
  for (const [dx, sube] of [[-1, 0.7], [-1, 0.1], [-1, -0.4], [1, 0.7], [1, 0.1], [1, -0.4], [0.3, 1.1], [-0.3, 1.1]] as const)
    for (let j = 1; j <= 8; j++) {
      const px = cx + Math.round(dx * j);
      const py = cy - Math.round(sube * j * 0.7) + Math.round(j * j * 0.07);
      R(g, px, py + 1, 2, 1, '#2a6a4a');
      R(g, px, py, 2, 1, j < 4 ? '#5ab870' : '#4aa060');
    }
  R(g, cx - 1, cy + 1, 2, 2, '#7a4a2a');
  R(g, cx + 1, cy + 2, 2, 2, '#8a5a2a');
}

/** Viña's flower clock on its lawn bank: a dial of flowers with big black hands. (x, y): left foot. */
function relojFlores(g: Ctx, x: number, y: number) {
  const cx = x + 17;
  cupula(g, cx, y, 18, 12, NOCHE);
  cupula(g, cx, y, 17, 11, '#5aa870');
  cupula(g, cx, y - 9, 13, 3, '#4a9860');
  D.oval(g, cx, y - 8, 13, 5, '#e86a5c');
  D.oval(g, cx, y - 8, 11, 4, '#ffd27f');
  D.oval(g, cx, y - 8, 9, 3, '#b5d99c');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    R(g, cx + Math.round(Math.cos(a) * 12), y - 8 + Math.round(Math.sin(a) * 4.4), 1, 1, i % 3 === 0 ? P.white : '#c9a7e0');
  }
  R(g, cx, y - 11, 1, 3, NOCHE);
  R(g, cx, y - 8, 7, 1, NOCHE);
  R(g, cx, y - 8, 1, 1, P.gold);
  // A few flower beds around it.
  for (let i = 0; i < 9; i++) R(g, x + 2 + i * 4, y - 2 - (i % 2), 1, 1, ['#f4a7b9', P.white, '#ffd27f'][i % 3]);
}

/** Castillo Wulff: stone house with a half-timbered upper floor and a crenellated tower, on its rock. */
function castilloWulff(g: Ctx, x: number, y: number) {
  // The rock it stands on (it carries on under the street, into the sea).
  R(g, x - 3, y - 5, 38, 5, NOCHE);
  R(g, x - 2, y - 4, 36, 4, '#8a7e78');
  R(g, x, y - 4, 30, 1, '#a89c94');
  const yb = y - 4;
  // Main house.
  R(g, x - 1, yb - 21, 22, 21, NOCHE);
  R(g, x, yb - 20, 20, 20, '#b8b0b0');
  for (let yy = yb - 10; yy < yb; yy += 4) R(g, x, yy, 20, 1, '#a09898');
  R(g, x, yb - 20, 20, 9, '#fff6e5');
  for (let bx = x; bx < x + 20; bx += 5) R(g, bx, yb - 20, 1, 9, '#6a4a3a');
  R(g, x, yb - 16, 20, 1, '#6a4a3a');
  for (let i = 0; i < 6; i++) R(g, x - 2 + i, yb - 22 - i, 24 - i * 2, 1, i === 0 ? NOCHE : '#5a6a8a');
  R(g, x + 2, yb - 9, 4, 5, P.gl1);
  R(g, x + 14, yb - 9, 4, 5, P.gl1);
  R(g, x + 8, yb - 7, 4, 7, '#6a4a3a');
  R(g, x + 9, yb - 8, 2, 1, '#6a4a3a');
  // The tower, crenellated, with slit windows and a little flag.
  R(g, x + 19, yb - 31, 13, 31, NOCHE);
  R(g, x + 20, yb - 30, 11, 30, '#c8c0bc');
  for (let yy = yb - 26; yy < yb; yy += 4) R(g, x + 20, yy, 11, 1, '#b0a8a4');
  for (let i = 0; i < 4; i++) {
    R(g, x + 19 + i * 3, yb - 34, 3, 3, NOCHE);
    R(g, x + 20 + i * 3, yb - 33, 1, 2, '#c8c0bc');
  }
  R(g, x + 24, yb - 25, 2, 4, NOCHE);
  R(g, x + 24, yb - 15, 2, 4, NOCHE);
  R(g, x + 30, yb - 42, 1, 8, NOCHE);
  R(g, x + 31, yb - 42, 5, 2, P.white);
  R(g, x + 31, yb - 40, 5, 2, P.red);
  R(g, x + 31, yb - 42, 2, 2, '#3a5ab0');
}

/** The casino: a white neoclassical palace with pilasters and a raised centre. (x, y): left foot. */
function casino(g: Ctx, x: number, y: number) {
  const blanco = '#fdfaf2';
  const sombra = '#e4ded0';
  R(g, x - 1, y - 26, 56, 26, NOCHE);
  R(g, x, y - 25, 54, 25, blanco);
  R(g, x - 2, y - 27, 58, 2, sombra);
  R(g, x - 2, y - 28, 58, 1, NOCHE);
  for (let px = x + 3; px < x + 52; px += 7) {
    R(g, px, y - 24, 1, 22, sombra);
    if (px > x + 12 && px < x + 40) continue;
    R(g, px + 2, y - 20, 3, 7, P.gl1);
    R(g, px + 2, y - 20, 1, 1, blanco);
    R(g, px + 4, y - 20, 1, 1, blanco);
  }
  // Raised centre with its name and a balustrade.
  R(g, x + 13, y - 36, 28, 9, NOCHE);
  R(g, x + 14, y - 35, 26, 8, blanco);
  R(g, x + 12, y - 38, 30, 2, NOCHE);
  for (let bx = x + 13; bx < x + 42; bx += 2) R(g, bx, y - 40, 1, 2, sombra);
  R(g, x + 12, y - 41, 30, 1, NOCHE);
  const w = anchoLetrero('CASINO');
  escribir(g, 'CASINO', x + 27 - Math.ceil(w / 2), y - 34, '#3a5ab0');
  // Arched door, tall windows and the steps.
  R(g, x + 22, y - 18, 10, 16, NOCHE);
  R(g, x + 23, y - 17, 8, 15, '#c8a060');
  R(g, x + 26, y - 17, 2, 15, '#a88040');
  R(g, x + 16, y - 20, 3, 8, P.gl1);
  R(g, x + 35, y - 20, 3, 8, P.gl1);
  R(g, x - 2, y - 2, 58, 2, '#d8d4e4');
  R(g, x + 18, y - 3, 18, 1, '#d8d4e4');
}

/** The iron loading tower at the end of Muelle Vergara. (x, y): left foot on the deck. */
function torreMuelle(g: Ctx, x: number, y: number) {
  const c = '#4a6070';
  R(g, x, y - 32, 2, 32, c);
  R(g, x + 10, y - 32, 2, 32, c);
  for (let yy = y - 32; yy < y; yy += 8) {
    R(g, x, yy, 12, 1, c);
    for (let i = 0; i < 8; i++) {
      R(g, x + 1 + i, yy + i, 1, 1, c);
      R(g, x + 10 - i, yy + i, 1, 1, c);
    }
  }
  // The arm reaching out over the sea, with its hook.
  R(g, x - 20, y - 35, 34, 3, NOCHE);
  R(g, x - 19, y - 34, 32, 1, '#6a8090');
  for (let i = 0; i < 10; i++) R(g, x - 1 - i * 2, y - 32 + i, 1, 1, c);
  R(g, x - 17, y - 32, 1, 10, NOCHE);
  R(g, x - 18, y - 22, 3, 1, NOCHE);
  R(g, x - 18, y - 23, 1, 1, NOCHE);
  R(g, x + 3, y - 38, 6, 3, '#e86a5c');
}

/** A striped beach umbrella with a towel. (x, y): the pole's foot. */
function quitasol(g: Ctx, x: number, y: number, c0: string, c1: string) {
  R(g, x, y - 12, 1, 12, NOCHE);
  for (const [dy, w] of [[0, 3], [1, 5], [2, 6], [3, 7], [4, 7]] as const)
    for (let i = -w; i <= w; i++) R(g, x + i, y - 16 + dy, 1, 1, dy === 4 ? D.tone((i + 8) >> 1 & 1 ? c0 : c1, -0.2) : (i + 8) >> 1 & 1 ? c0 : c1);
  R(g, x - 7, y - 11, 15, 1, NOCHE);
  R(g, x + 2, y - 1, 8, 1, c1);
  R(g, x + 2, y - 2, 8, 1, D.tone(c1, 0.2));
}

/** A white block of flats stepping down the hill: floors of glass and balconies. */
function edificioBlanco(g: Ctx, x: number, y: number, w: number, h: number, s: number) {
  R(g, x - 1, y, w + 2, h, NOCHE);
  R(g, x, y + 1, w, h - 1, '#fdfaf2');
  R(g, x + w - 2, y + 1, 2, h - 1, '#e4e0d8');
  R(g, x, y + 1, w, 1, '#d8d4e4');
  for (let yy = y + 3, f = 0; yy + 5 < y + h; yy += 7, f++) {
    R(g, x + 1, yy, w - 3, 3, '#8ccaf8');
    for (let mx = x + 4; mx < x + w - 2; mx += 4) R(g, mx, yy, 1, 3, '#d8e8f4');
    R(g, x + 1, yy, 2, 1, P.gl2);
    R(g, x, yy + 4, w, 1, NOCHE);
    R(g, x, yy + 3, w, 1, '#fdfaf2');
    if (hash(s, f) % 3 === 0) R(g, x + 2 + (hash(s, f + 9) % Math.max(1, w - 6)), yy + 2, 2, 1, '#5aa870');
  }
}

/** Vegetation on the dunes: a green clump or a dry tuft. (x, y): its foot. */
function matitaDuna(g: Ctx, x: number, y: number, s: number) {
  if (s % 3) {
    for (const [dx, h] of [[-2, 2], [0, 4], [2, 3], [1, 2]] as const) R(g, x + dx, y - h, 1, h, '#4a7a4a');
    R(g, x - 2, y - 3, 1, 1, '#8ac07a');
    R(g, x, y - 5, 1, 1, '#8ac07a');
    R(g, x + 2, y - 4, 1, 1, s % 2 ? '#ffd27f' : '#8ac07a');
  } else {
    for (const [dx, h] of [[-1, 3], [0, 5], [1, 4], [3, 2]] as const) R(g, x + dx, y - h, 1, h, '#a8885a');
  }
}

/** A wooden sign on a post. */
function letreroMadera(g: Ctx, x: number, y: number, txt: string) {
  const w = anchoLetrero(txt) + 6;
  R(g, x, y - 20, 2, 20, '#6a4a2a');
  const e = tilde(txt);
  R(g, x - 1, y - 29 - e, w + 2, 10 + e, '#6a4a2a');
  R(g, x, y - 28 - e, w, 8 + e, '#d8a860');
  R(g, x, y - 28 - e, w, 1, '#f0c880');
  escribir(g, txt, x + 3, y - 26, '#5a3a1a');
}

/** Edificio de la Armada: a grey-white French-style palace with a mansard roof and a clock dome. */
function edificioArmada(g: Ctx, x: number, y: number) {
  const muro = '#e8ecf4';
  R(g, x - 1, y - 34, 48, 34, NOCHE);
  R(g, x, y - 33, 46, 33, muro);
  R(g, x - 2, y - 35, 50, 2, '#c8d0e0');
  R(g, x - 1, y - 40, 48, 5, NOCHE);
  R(g, x, y - 39, 46, 4, '#6a7a9a');
  for (const dx of [4, 11, 32, 39]) R(g, x + dx, y - 38, 3, 3, P.gl1);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 7; col++) {
      if (col === 3 && row === 2) continue;
      R(g, x + 3 + col * 6, y - 31 + row * 9, 3, 5, P.gl1);
      R(g, x + 3 + col * 6, y - 31 + row * 9, 3, 1, '#c8d0e0');
    }
  R(g, x + 20, y - 11, 6, 11, '#5a4a3a');
  // Central tower with the clock and a dome.
  R(g, x + 16, y - 52, 14, 13, NOCHE);
  R(g, x + 17, y - 51, 12, 12, muro);
  D.disc(g, x + 23, y - 46, 3, NOCHE);
  D.disc(g, x + 23, y - 46, 2, P.white);
  R(g, x + 23, y - 47, 1, 2, NOCHE);
  cupula(g, x + 23, y - 51, 7, 5, NOCHE);
  cupula(g, x + 23, y - 52, 6, 4, '#6a7a9a');
  R(g, x + 23, y - 64, 1, 7, NOCHE);
  R(g, x + 24, y - 64, 5, 2, P.white);
  R(g, x + 24, y - 62, 5, 2, P.red);
  R(g, x + 24, y - 64, 2, 2, '#3a5ab0');
}

/** The monument to the heroes of Iquique: a pedestal, a tall plinth and a bronze figure with a raised sword. */
function monumentoIquique(g: Ctx, x: number, y: number) {
  R(g, x - 3, y - 3, 24, 3, PIEDRA0);
  R(g, x - 1, y - 11, 20, 8, NOCHE);
  R(g, x, y - 10, 18, 7, '#e2d6c6');
  R(g, x + 4, y - 28, 10, 17, NOCHE);
  R(g, x + 5, y - 27, 8, 16, '#e2d6c6');
  R(g, x + 6, y - 22, 6, 5, '#b07a3a');
  R(g, x + 7, y - 21, 4, 3, '#d09a5a');
  // Anchors at the corners.
  for (const ax of [x + 1, x + 15]) {
    R(g, ax + 1, y - 18, 1, 6, '#5a4a4a');
    R(g, ax, y - 17, 3, 1, '#5a4a4a');
    R(g, ax - 1, y - 13, 1, 1, '#5a4a4a');
    R(g, ax + 3, y - 13, 1, 1, '#5a4a4a');
    R(g, ax, y - 12, 3, 1, '#5a4a4a');
  }
  // The figure.
  R(g, x + 6, y - 36, 6, 8, '#8a5a2a');
  R(g, x + 7, y - 35, 2, 6, '#b07a3a');
  R(g, x + 8, y - 39, 3, 3, '#8a5a2a');
  R(g, x + 11, y - 39, 1, 4, '#8a5a2a');
  R(g, x + 12, y - 44, 1, 5, '#d8d8e4');
}

/** An old port bar with a gold-lettered sign (a generic one). */
function barPuerto(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 25, 36, 25, NOCHE);
  R(g, x, y - 24, 34, 24, '#3a6a5a');
  R(g, x - 2, y - 26, 38, 2, '#c0a060');
  R(g, x + 6, y - 22, 22, 8, '#2a2438');
  const w = anchoLetrero('BAR');
  escribir(g, 'BAR', x + 17 - Math.ceil(w / 2), y - 21, P.gold, '#8a5a1a');
  R(g, x + 3, y - 12, 13, 8, NOCHE);
  R(g, x + 4, y - 11, 11, 6, '#ffd27f');
  R(g, x + 9, y - 11, 1, 6, NOCHE);
  R(g, x + 4, y - 9, 11, 1, NOCHE);
  R(g, x + 20, y - 13, 9, 13, NOCHE);
  R(g, x + 21, y - 12, 7, 12, '#8a5a3a');
  R(g, x + 26, y - 7, 1, 1, P.gold);
}

/** Iglesia La Matriz: whitewashed nave, tile roof and a wooden bell tower. */
function laMatriz(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 22, 38, 22, NOCHE);
  R(g, x, y - 21, 36, 21, '#fff6e5');
  R(g, x - 2, y - 24, 40, 3, '#c0605a');
  R(g, x - 2, y - 24, 40, 1, NOCHE);
  R(g, x + 3, y - 16, 4, 7, P.gl1);
  R(g, x + 29, y - 16, 4, 7, P.gl1);
  R(g, x + 11, y - 46, 14, 24, NOCHE);
  R(g, x + 12, y - 45, 12, 24, '#fff6e5');
  R(g, x + 22, y - 45, 2, 24, '#ede0c8');
  R(g, x + 15, y - 42, 6, 7, '#5a4a3a');
  D.oval(g, x + 18, y - 38, 2, 2, P.gold);
  for (let i = 0; i < 7; i++) R(g, x + 11 + i, y - 47 - i, 14 - i * 2, 1, '#7a8ab0');
  R(g, x + 17, y - 59, 1, 6, NOCHE);
  R(g, x + 16, y - 57, 3, 1, NOCHE);
  R(g, x + 15, y - 11, 6, 11, '#6a4a3a');
  R(g, x + 16, y - 12, 4, 1, '#6a4a3a');
}

/** Arco Británico: a sandstone arch with a lion on top. Vehicles drive through it. */
function arcoBritanico(g: Ctx, x: number, y: number) {
  const pied = '#e8d4b0';
  const cx = x + 22;
  const r = 11;
  // Two pillars, and the body with a round-topped opening above them (cleared, so the sky shows through).
  R(g, x - 1, y - 36, 46, 21, NOCHE);
  R(g, x, y - 35, 44, 20, pied);
  for (const px of [x, cx + r + 1]) {
    R(g, px - 1, y - 16, r, 16, NOCHE);
    R(g, px, y - 16, r - 2, 16, pied);
  }
  for (let yy = y - 32; yy < y; yy += 5) {
    R(g, x, yy, 9, 1, '#d4bc94');
    R(g, x + 35, yy, 9, 1, '#d4bc94');
  }
  for (let dy = 0; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy));
    const yy = y - 16 - dy;
    R(g, cx - w - 1, yy, w * 2 + 3, 1, NOCHE);
    g.clearRect(cx - w, yy, w * 2 + 1, 1);
  }
  R(g, x - 2, y - 38, 48, 3, '#d4bc94');
  R(g, x - 2, y - 38, 48, 1, NOCHE);
  // The lion, lying on top.
  D.oval(g, cx, y - 41, 5, 2, P.gold0);
  D.disc(g, cx + 5, y - 43, 2, P.gold0);
  R(g, cx + 6, y - 43, 1, 1, NOCHE);
  R(g, cx - 7, y - 42, 2, 1, P.gold0);
}

/**
 * Under the street on the coast north. Avenida España: a seawall down to the
 * Merval track (with a tunnel mouth at each end), a rock embankment and the
 * surf. Viña: a low seawall, a strip of beach and the sea; Castillo Wulff's
 * rock and Muelle Vergara's iron legs standing in it. Reñaca: the beach, then
 * the white blocks of flats stepping down the hill. Concón: dune sand.
 */
function costaNorte(g: Ctx, hs: Int16Array, rowOf: (a: number) => number, H: number, length: number) {
  if (length < LEVEL) return;
  const ySea = rowOf(14);
  const yT = rowOf(TREN_ALT);
  for (let x = COSTA; x < length; x++) {
    const yS = rowOf(hs[x]) + 4;
    if (x < TUNEL[1] + 12) {
      piedraCol(g, x, yS, yT - 1);
      R(g, x, yT - 3, 1, 2, PIEDRA0);
      R(g, x, yT - 1, 1, 1, '#5a5a6a');
      R(g, x, yT, 1, 1, '#8a8a9a');
      R(g, x, yT + 1, 1, 4, '#9a8a7a');
      if (x % 5 === 0) R(g, x, yT, 1, 2, P.k0);
      if (hash(x, 51) % 3 === 0) R(g, x, yT + 2 + (x % 3), 1, 1, '#7a6a5a');
      R(g, x, yT + 5, 1, ySea - yT - 5, '#7a6e6a');
      if (hash(x, 52) % 4 === 0) R(g, x, yT + 7 + (hash(x, 53) % 8), 1, 2, '#9a8e88');
      marCol(g, x, ySea, H, ySea);
    } else if (x >= MUELLE[0] && x < MUELLE[1]) {
      R(g, x, yS, 1, ySea - yS, '#9ec5e8');
      if (hash(x, 54) % 9 === 0) R(g, x, yS + 6 + (hash(x, 55) % Math.max(1, ySea - yS - 8)), 1, 1, '#c4e0f4');
      marCol(g, x, ySea, H, ySea);
    } else if (x < RENACA) {
      const yA = rowOf(26);
      piedraCol(g, x, yS, yA);
      arenaCol(g, x, yA, ySea);
      marCol(g, x, ySea, H, ySea);
    } else if (x < SUBIDA) {
      arenaCol(g, x, yS, ySea);
      marCol(g, x, ySea, H, ySea);
    } else if (x < DUNAS) {
      R(g, x, yS, 1, H - yS, '#a8987a');
      if (hash(x, 56) % 4 === 0) R(g, x, yS + 1 + (hash(x, 57) % 4), 1, 1, '#5a8a5a');
    } else {
      arenaCol(g, x, yS, H);
    }
  }

  // Merval's tunnel mouths: dark arches in the seawall at both ends of the track.
  for (const [x0, lado] of [[TUNEL[0] - 11, 1], [TUNEL[1] + 1, -1]] as const) {
    const yb = yT - 1;
    R(g, x0 - 2, yb - 17, 14, 17, PIEDRA0);
    R(g, x0 - 1, yb - 16, 12, 16, PIEDRA1);
    R(g, x0, yb - 14, 10, 14, '#2a2438');
    R(g, x0 + 1, yb - 15, 8, 1, '#2a2438');
    R(g, lado > 0 ? x0 + 7 : x0, yb - 13, 3, 13, '#3a3450');
  }

  // Castillo Wulff's rock, from the street down into the surf.
  {
    const cx = 3080;
    let yTop = 1e9;
    for (let x = cx - 16; x <= cx + 16; x++) yTop = Math.min(yTop, rowOf(hs[x]) + 2);
    for (let y = yTop; y < H; y++) {
      const half = 16 + Math.floor((y - yTop) * 0.12) + (hash(y, 58) % 2);
      R(g, cx - half - 1, y, half * 2 + 3, 1, NOCHE);
      R(g, cx - half, y, half * 2 + 1, 1, '#8a7e78');
      if ((y - yTop) % 6 === 0) R(g, cx - half + 3 + (hash(y, 59) % 8), y, 8, 1, '#a89c94');
      if ((y - yTop) % 6 === 3) R(g, cx - 4 + (hash(y, 60) % 12), y, 6, 1, '#6a5e5a');
    }
    const half = 16 + Math.floor((ySea - yTop) * 0.12);
    R(g, cx - half - 4, ySea, half * 2 + 9, 1, P.white);
    R(g, cx - half - 2, ySea + 1, 2, 1, P.white);
    R(g, cx + half + 1, ySea + 1, 2, 1, P.white);
  }

  // Rocks along the shore of Avenida España, with foam around them.
  for (let x = COSTA + 2; x < TUNEL[1] + 10; x += 6 + (hash(x, 62) % 6)) {
    const r = 2 + (hash(x, 63) % 3);
    const y = ySea - 1 + (hash(x, 64) % 3);
    D.disc(g, x, y, r + 1, NOCHE);
    D.disc(g, x, y, r, '#8a7e78');
    R(g, x - 1, y - r + 1, 2, 1, '#b0a49c');
    R(g, x - r - 2, ySea + 1, 2, 1, P.white);
    R(g, x + r + 1, ySea + 2, 2, 1, P.white);
  }

  // Muelle Vergara: a deck beam and iron legs with cross braces down into the sea.
  for (let x = MUELLE[0]; x < MUELLE[1]; x++) R(g, x, rowOf(hs[x]) + 4, 1, 2, '#3a4a5a');
  for (let lx = MUELLE[0] + 2; lx < MUELLE[1]; lx += 12) {
    const yd = rowOf(hs[lx]) + 6;
    R(g, lx, yd, 2, H - yd, '#4a6070');
    R(g, lx + 1, yd, 1, H - yd, '#6a8090');
    if (lx + 12 < MUELLE[1]) {
      const n = ySea - yd;
      for (let i = 0; i < n; i++) {
        const dx = Math.round((i / n) * 11);
        R(g, lx + 1 + dx, yd + i, 1, 1, '#4a6070');
        R(g, lx + 12 - dx, yd + i, 1, 1, '#4a6070');
      }
    }
    R(g, lx - 2, ySea, 6, 1, P.white);
  }

  // Reñaca: white blocks of flats stepping down the hill.
  for (let x = SUBIDA + 2; x < DUNAS - 6; ) {
    const w = Math.min(15, DUNAS - 2 - x);
    let minH = 1e9;
    for (let i = 0; i < w; i++) minH = Math.min(minH, hs[x + i]);
    const y = rowOf(minH) + 6;
    edificioBlanco(g, x, y, w, H - 3 - y, hash(x, 90));
    x += w + 2;
  }
}

/**
 * The whole Valparaíso level's ground as one strip, painted once. Row 0 is
 * altitude `top`; the bottom row is -DIRT (same contract as groundStrip).
 */
export function valpoStrip(length: number, heightAt: (x: number) => number, pantry: { x0: number; x1: number }) {
  let top = 0;
  for (let x = 0; x < length; x++) top = Math.max(top, heightAt(x));
  top = Math.ceil(top) + DECO;
  const c = document.createElement('canvas');
  c.width = length;
  c.height = top + DIRT;
  const g = c.getContext('2d')!;
  const rowOf = (alt: number) => top - alt;
  alturas = new Int16Array(length + 1);
  for (let x = 0; x <= length; x++) alturas[x] = Math.round(heightAt(x));
  const hs = alturas;
  ROPAS.length = 0;
  FAROLES.length = 0;

  // The pier: planks over the water and its piles; the seabed at the bottom.
  for (let x = 0; x < Math.min(length, PUERTO + 1); x++) {
    const y0 = rowOf(hs[x]);
    R(g, x, y0 + 3, 1, c.height - y0 - 3, '#6fa8c9');
    R(g, x, y0 + 3, 1, 2, '#9ec5e8');
    if (x % 14 < 3) R(g, x, y0 + 3, 1, c.height - y0 - 6, x % 14 === 1 ? P.k1 : P.k0);
    R(g, x, c.height - 4, 1, 4, '#c9bfae');
    R(g, x, y0, 1, 3, x % 6 === 0 ? P.k0 : P.k2);
    R(g, x, y0, 1, 1, P.k0);
  }

  // Under the streets: stone retaining walls with mortar lines.
  for (let x = PUERTO + 1; x < length; x++) {
    const y0 = rowOf(hs[x]);
    R(g, x, y0, 1, c.height - y0, PIEDRA);
  }
  for (let gy = 0; gy < c.height; gy += 5)
    for (let gx = PUERTO + 1 + ((gy / 5) % 2) * 6; gx < length; gx += 12) {
      if (gy < rowOf(hs[gx]) + 4) continue;
      R(g, gx, gy, 9, 1, PIEDRA1);
      R(g, gx + 9, gy - 4, 1, 4, PIEDRA0);
    }

  // Houses stacked down the slope, in columns staggered in height so they read
  // as a hillside, not a wall. Every few columns the hill shows through, with
  // scrub or a house up on stilts; some gaps hold staircases.
  const bottom = c.height - 3;
  let columna = 0;
  for (let x = PUERTO + 8; x < Math.min(length - 12, COSTA - 10); ) {
    const s = hash(x, 3);
    const w = 18 + (s % 10);
    let minH = 1e9;
    for (let i = 0; i < w; i++) minH = Math.min(minH, hs[Math.min(length - 1, x + i)]);
    const calle = rowOf(minH);
    columna++;
    if (columna % 5 === 0) {
      matorral(g, x, calle + 4, bottom, w, s);
      x += w + 2;
      continue;
    }
    // A roof from the row behind peeks over the street on the crests.
    const xm = Math.min(length - 1, x + (w >> 1));
    if (hs[xm] >= Math.max(hs[Math.max(0, xm - 50)], hs[Math.min(length - 1, xm + 50)]) - 3 && s % 3 !== 0) {
      const ww = w - 6;
      R(g, x + 2, calle - 10, ww + 2, 10, NOCHE);
      R(g, x + 3, calle - 9, ww, 9, D.tone(MUROS[(s >>> 2) % MUROS.length], -0.12));
      R(g, x + 2, calle - 11, ww + 2, 2, D.tone(TECHOS[(s >>> 6) % TECHOS.length], -0.1));
      R(g, x + 6, calle - 7, 3, 3, P.gl1);
      if (ww > 12) R(g, x + ww - 4, calle - 7, 3, 3, P.gl1);
    }
    let y = calle + 5 + (hash(x, 4) % 6);
    let fila = 0;
    while (y + 16 < bottom) {
      const h = Math.min(18 + (hash(x, 10 + fila) % 11), bottom - y);
      if (h < 16) break;
      casa(g, x, y, w, h, hash(x, 20 + fila), fila);
      if (hash(x, 40 + fila) % 5 === 0 && x + w < COSTA) ROPAS.push([x + 2, top - (y + h - 2), w - 4]);
      y += h + 3;
      fila++;
    }
    const gap = s % 4 === 0 ? 8 : 2;
    if (gap > 2) {
      let mh = 1e9;
      for (let i = 0; i < gap; i++) mh = Math.min(mh, hs[Math.min(length - 1, x + w + i)]);
      escalera(g, x + w + 1, rowOf(mh) + 3, bottom, gap - 1);
    }
    x += w + gap;
  }

  // The coast north: Avenida España, Viña del Mar, Reñaca and the Concón dunes.
  costaNorte(g, hs, rowOf, c.height, length);

  // The street on top: cobbles (asphalt on the coast road, planks on the pier,
  // sand on the beach and the dunes), an ink edge joined where the slope steps.
  for (let x = PUERTO + 1; x < length; x++) {
    const h = hs[x];
    const y0 = rowOf(h);
    if (x < COSTA) {
      R(g, x, y0, 1, 4, '#b8b0c8');
      R(g, x, y0 + 1, 1, 1, '#d8d4e4');
      if (x % 5 === 0) R(g, x, y0 + 2, 1, 1, '#9a92ac');
    } else if (x >= MUELLE[0] && x < MUELLE[1]) {
      R(g, x, y0, 1, 3, x % 6 === 0 ? P.k0 : P.k2);
      R(g, x, y0 + 3, 1, 1, P.k0);
    } else if ((x >= RENACA && x < SUBIDA) || x >= DUNAS) {
      R(g, x, y0, 1, 4, '#f8dca0');
      R(g, x, y0 + 1, 1, 1, '#fff0c8');
      if (hash(x, 71) % 6 === 0) R(g, x, y0 + 2, 1, 1, '#d8a860');
    } else {
      R(g, x, y0, 1, 4, '#8a889a');
      R(g, x, y0 + 1, 1, 1, '#a8a6b8');
      R(g, x, y0 + 3, 1, 1, PIEDRA1);
    }
    const hn = hs[Math.min(length, x + 1)];
    R(g, x, Math.min(y0, rowOf(hn)) - 1, 1, Math.abs(hn - h) + 1, NOCHE);
  }
  // Escalera Piano: the first stair slope painted as black and white keys.
  {
    const [a, b] = ESCALERAS[0];
    for (let x = a; x < b; x++) {
      const y0 = rowOf(hs[x]);
      R(g, x, y0, 1, 4, Math.floor((x - a) / 8) % 2 ? '#2a2438' : P.white);
    }
    // The dog naps on the middle of a tread (each step: flat half, then its ramp).
    const paso = (b - a) / ESCALERAS[0][2];
    const px = Math.round(a + paso * 2 + paso * 0.25);
    perro = [px, hs[px]];
  }
  // The second stair slope: each step painted a different color, like the city's rainbow stairs.
  {
    const [a, b, n] = ESCALERAS[1];
    const cols = ['#e86a5c', '#f6b38e', '#ffd27f', '#b5d99c', '#8fd3c8', '#9ec5e8', '#c9a7e0'];
    for (let x = a; x < b && x < length; x++) {
      const i = Math.floor(((x - a) / (b - a)) * n * 2);
      const y0 = rowOf(hs[x]);
      R(g, x, y0, 1, 4, cols[i % cols.length]);
      R(g, x, y0 + 1, 1, 1, D.tone(cols[i % cols.length], 0.25));
    }
  }

  // Funiculars: their own ~40° rail cut into the hill behind the street, with a
  // station embedded at the bottom and another on the street at the top.
  ASCENSORES.length = 0;
  for (const [xT, hB] of ASC_TOP) {
    if (xT + 20 >= length) continue;
    const hT = hs[xT];
    const xB = Math.round(xT - (hT - hB) / ASC_PEND);
    ASCENSORES.push([xB, hB, xT, hT]);
    for (let x = xB; x <= xT; x++) {
      const y = rowOf(hB + (x - xB) * ASC_PEND);
      R(g, x, y - 1, 1, 6, '#8a7a6a');
      R(g, x, y + 1, 1, 3, '#a8987a');
      R(g, x, y, 1, 1, NOCHE);
      if (x % 3 === 0) R(g, x, y + 1, 1, 2, '#6a4a3a');
    }
    // Bottom station, set into the hillside.
    {
      const yb = rowOf(hB) + 2;
      R(g, xB - 19, yb - 16, 20, 17, NOCHE);
      R(g, xB - 18, yb - 15, 18, 15, '#fff6e5');
      R(g, xB - 20, yb - 18, 22, 3, '#e86a5c');
      R(g, xB - 14, yb - 9, 5, 9, P.k1);
      R(g, xB - 7, yb - 12, 4, 4, P.gl1);
    }
    // Top station on the street, with its sign.
    {
      const yb = rowOf(Math.min(hT, hs[xT + 18])) + 1;
      R(g, xT - 1, yb - 17, 20, 17, NOCHE);
      R(g, xT, yb - 16, 18, 16, '#fff6e5');
      for (let i = 0; i < 22; i++) R(g, xT - 2 + i, yb - 19 + Math.round(Math.abs(i - 10.5) / 5), 1, 2, '#e86a5c');
      R(g, xT + 2, yb - 10, 5, 10, P.k1);
      R(g, xT + 10, yb - 12, 5, 4, P.gl1);
      {
        const txt = xT === ASC_TOP[0][0] ? 'ASCENSOR 1883' : 'ARTILLERÍA';
        const w = anchoLetrero(txt);
        const e = tilde(txt);
        R(g, xT + 9 - Math.ceil(w / 2) - 3, yb - 30 - e, w + 6, 9 + e, NOCHE);
        R(g, xT + 9 - Math.ceil(w / 2) - 2, yb - 29 - e, w + 4, 7 + e, P.cream);
        escribir(g, txt, xT + 9 - Math.ceil(w / 2), yb - 28, '#3a5ab0');
        R(g, xT + 8, yb - 21, 1, 2, NOCHE);
      }
    }
  }

  // Ascensor Polanco: a tall tower in the valley with a footbridge to the next hill.
  {
    const tx = 1046;
    if (tx + 110 < length) {
      const h0 = hs[tx];
      const h1 = h0 + 52;
      polanco = [tx, h0, h1];
      const yb = rowOf(h0) + 1;
      const yt = rowOf(h1);
      R(g, tx - 1, yt, 12, yb - yt, NOCHE);
      R(g, tx, yt + 1, 10, yb - yt - 1, '#fff6e5');
      R(g, tx + 3, yt + 4, 4, yb - yt - 6, '#b8b0c8');
      for (let y = yt + 6; y < yb - 4; y += 6) R(g, tx + 1, y, 1, 3, P.gl1);
      R(g, tx - 2, yt - 2, 14, 3, '#e86a5c');
      // Footbridge to where the hill reaches the same height.
      let bx = tx + 11;
      while (bx < tx + 160 && hs[bx] < h1 - 2) bx++;
      R(g, tx + 10, yt + 2, bx - tx - 10, 3, NOCHE);
      R(g, tx + 10, yt + 3, bx - tx - 10, 1, '#d8d4e4');
      for (let x = tx + 12; x < bx; x += 4) R(g, x, yt - 2, 1, 4, NOCHE);
      R(g, tx + 10, yt - 2, bx - tx - 10, 1, NOCHE);
    }
  }

  // La Sebastiana: a narrow, tall house with a round lookout on top.
  {
    const x = 2030;
    if (x + 30 < length) {
      const yb = rowOf(Math.min(hs[x], hs[x + 22])) + 1;
      R(g, x - 1, yb - 44, 24, 44, NOCHE);
      R(g, x, yb - 43, 22, 43, '#ffd8d0');
      for (let y = yb - 38; y < yb - 4; y += 9) {
        R(g, x + 3, y, 5, 6, P.white);
        R(g, x + 4, y + 1, 3, 4, P.gl1);
        R(g, x + 13, y, 5, 6, P.white);
        R(g, x + 14, y + 1, 3, 4, P.gl1);
      }
      D.disc(g, x + 11, yb - 48, 9, NOCHE);
      D.disc(g, x + 11, yb - 48, 8, '#fff6e5');
      D.oval(g, x + 11, yb - 49, 6, 3, P.gl1);
      R(g, x + 7, yb - 51, 3, 1, P.gl2);
      R(g, x + 2, yb - 57, 18, 2, '#e86a5c');
      R(g, x + 7, yb - 59, 8, 2, '#e86a5c');
      placa(g, x + 25, yb - 16, 'LA SEBASTIANA');
    }
  }

  // Street buildings with a story: the fire brigade, the clock tower, a «picada».
  if (1300 < length) bomberos(g, 1236, rowOf(Math.min(hs[1236], hs[1280])) + 1);
  if (900 < length) relojTorre(g, 866, rowOf(Math.min(hs[866], hs[882])) + 1);
  if (2240 < length) picada(g, 2186, rowOf(Math.min(hs[2186], hs[2230])) + 1);
  if (1620 < length) letreroCalle(g, 1604, rowOf(hs[1604]) + 1, 'CERRO ALEGRE');
  // A small plaque on a wall just under the street.
  if (1720 < length) placa(g, 1690, rowOf(hs[1700]) + 12, 'UNESCO 2003');
  if (900 < length) placa(g, 846, rowOf(hs[860]) + 12, 'RELOJ TURRI');

  // The port end: Muelle Prat, Plaza Sotomayor with the Armada building and the
  // monument to the heroes of Iquique, and an old port bar.
  if (400 < length) {
    letreroCalle(g, 96, rowOf(hs[96]) + 1, 'MUELLE PRAT');
    edificioArmada(g, 236, rowOf(Math.min(hs[236], hs[282])) + 1);
    monumentoIquique(g, 292, rowOf(Math.min(hs[292], hs[310])) + 1);
    barPuerto(g, 318, rowOf(Math.min(hs[318], hs[352])) + 1);
    placa(g, 232, rowOf(hs[250]) + 12, 'PLAZA SOTOMAYOR');
  }
  // Iglesia La Matriz up on the flat past the rainbow stairs; the Arco Británico in the last valley.
  if (1560 < length) {
    laMatriz(g, 1520, rowOf(Math.min(hs[1520], hs[1556])) + 1);
    placa(g, 1520, rowOf(hs[1530]) + 12, 'LA MATRIZ');
  }
  if (2600 < length) {
    arcoBritanico(g, 2548, rowOf(Math.max(hs[2548], hs[2592])) + 1);
    placa(g, 2540, rowOf(hs[2560]) + 14, 'ARCO BRITÁNICO');
  }

  // The coast north, above the street.
  if (LEVEL <= length) {
    // Avenida España: the seawall's white railing, the street sign, a welcome board.
    for (let x = COSTA + 4; x < VINA - 2; x++) {
      const y0 = rowOf(hs[x]);
      R(g, x, y0 - 6, 1, 1, '#f4f0fa');
      R(g, x, y0 - 3, 1, 1, '#d8d4e4');
      if (x % 6 === 0) R(g, x, y0 - 6, 1, 6, '#f4f0fa');
    }
    letreroCalle(g, COSTA + 14, rowOf(hs[COSTA + 14]) + 1, 'AV. ESPAÑA');
    pancarta(g, 2938, rowOf(Math.max(hs[2938], hs[2992])) + 1, 'VIÑA DEL MAR', '#5aa870');
    // Viña: the flower clock, palms, Castillo Wulff, the casino, Muelle Vergara.
    relojFlores(g, VINA + 2, rowOf(Math.max(hs[VINA + 2], hs[VINA + 36])) + 1);
    placa(g, VINA + 2, rowOf(hs[VINA + 20]) + 10, 'RELOJ DE FLORES');
    palmera(g, VINA + 46, rowOf(hs[VINA + 46]) + 1, 24, 1);
    castilloWulff(g, 3064, rowOf(Math.max(hs[3064], hs[3094])) + 1);
    casino(g, 3116, rowOf(Math.min(hs[3116], hs[3170])) + 1);
    palmera(g, 3105, rowOf(hs[3105]) + 1, 20, -1);
    palmera(g, 3174, rowOf(hs[3174]) + 1, 26, 1);
    torreMuelle(g, MUELLE[1] - 16, rowOf(hs[MUELLE[1] - 10]) + 1);
    for (const x of [MUELLE[0] + 2, MUELLE[1] - 2]) farol(g, x, rowOf(hs[x]) + 1);
    placa(g, MUELLE[0] + 4, rowOf(hs[MUELLE[0] + 10]) + 10, 'MUELLE VERGARA');
    // Reñaca: umbrellas on the beach and the sign; palms on the corner.
    letreroCalle(g, RENACA + 4, rowOf(hs[RENACA + 4]) + 1, 'REÑACA');
    quitasol(g, RENACA + 10, rowOf(hs[RENACA + 10]) + 1, '#e86a5c', P.white);
    quitasol(g, RENACA + 26, rowOf(hs[RENACA + 26]) + 1, '#8fd3c8', '#ffd27f');
    quitasol(g, RENACA + 42, rowOf(hs[RENACA + 42]) + 1, '#c9a7e0', P.white);
    palmera(g, SUBIDA - 2, rowOf(hs[SUBIDA - 2]) + 1, 22, -1);
    // Concón: sparse scrub on the dunes, the sign on the first crest and a boarder walking up.
    for (let x = DUNAS + 6; x < length - 4; x += 14 + (hash(x, 81) % 16)) matitaDuna(g, x, rowOf(hs[x]) + 1, hash(x, 82));
    letreroMadera(g, 3478, rowOf(hs[3478]) + 1, 'DUNAS DE CONCÓN');
    {
      const x = 3446;
      const y = rowOf(hs[x]) + 1;
      R(g, x - 1, y - 3, 1, 3, '#3a3a5a');
      R(g, x + 1, y - 3, 1, 3, '#3a3a5a');
      R(g, x - 1, y - 8, 3, 5, '#e86a5c');
      R(g, x - 1, y - 11, 3, 3, '#f6c8a0');
      R(g, x - 1, y - 12, 3, 1, '#3a5ab0');
      for (let i = 0; i < 9; i++) R(g, x - 4 + i, y - 13 + Math.round(i * 0.6), 1, 2, i ? '#ffd27f' : NOCHE);
    }
  }

  // Cerro Abajo: wooden kickers (lip on the left: bikes go downhill to the left),
  // fence banners and a finish arch at the bottom of the valley (no brands).
  {
    if (1990 < length) {
      pancarta(g, 1830, rowOf(hs[1830]) + 1, 'VALPO DH', '#8fd3c8');
      pancarta(g, 1939, rowOf(hs[1939]) + 1, 'CERRO ABAJO', '#c9a7e0');
    }
    for (const r0 of RAMPAS) {
      if (r0 + RAMPA_W >= length) continue;
      for (let x = r0; x < r0 + RAMPA_W; x++) {
        const yTop = rowOf(hs[x]);
        const yBase = rowOf(Math.round(sueloAt(x)));
        R(g, x, yTop, 1, Math.max(1, yBase - yTop + 1), (x - r0) % 4 === 0 ? P.k0 : P.k2);
        R(g, x, yTop, 1, 1, P.k0);
      }
      R(g, r0, rowOf(hs[r0]), 1, RAMPA_H + 2, P.k0);
      R(g, r0 + 1, rowOf(hs[r0]) + 1, 1, RAMPA_H, P.k1);
    }
    const ax = 1780;
    if (ax + 40 < length) {
      const yb = rowOf(hs[ax + 16]) + 1;
      for (const px of [ax, ax + 32]) {
        R(g, px - 1, yb - 26, 6, 26, NOCHE);
        R(g, px, yb - 25, 4, 25, '#ffd27f');
        R(g, px + 1, yb - 25, 1, 25, '#fff0c0');
      }
      R(g, ax - 1, yb - 32, 38, 8, NOCHE);
      R(g, ax, yb - 31, 36, 6, '#f4a7b9');
      escribir(g, 'META', ax + 11, yb - 31, P.white, '#c05a7a');
    }
  }

  // Street lamps, kept off the race course and the signs.
  const sinFarol: [number, number][] = [
    [1760, 2000], [1230, 1290], [860, 890], [2180, 2240], [1596, 1660], [740, 790], [2670, 2706],
    [226, 356], [1512, 1562], [2540, 2598], [COSTA, 2998], [VINA, MUELLE[1] + 6], [RENACA, SUBIDA + 4],
  ];
  for (let x = PUERTO + 40; x < Math.min(length - 6, DUNAS); x += 60 + (hash(x, 7) % 30)) {
    if (sinFarol.some(([a0, a1]) => x > a0 && x < a1)) continue;
    farol(g, x, rowOf(hs[x]) + 1);
    FAROLES.push(x);
  }

  // The trolleybus wire, ~34 px over the street, on poles.
  {
    const ALTO = 34;
    // A centred moving average, so the wire follows the street without lagging.
    const acum = new Float64Array(length + 1);
    for (let x = 0; x < length; x++) acum[x + 1] = acum[x] + hs[x];
    const media = (x: number) => {
      const a0 = Math.max(0, x - 24);
      const a1 = Math.min(length, x + 25);
      return (acum[a1] - acum[a0]) / (a1 - a0);
    };
    // It ends where the cliff road drops to the coast (no trolleybuses past Valparaíso).
    for (let x = PUERTO + 1; x < Math.min(length, Math.floor((COSTA - 40) / 96) * 96 + 1); x++) {
      const y = rowOf(Math.round(Math.max(media(x), hs[x] - 6)) + ALTO);
      R(g, x, y, 1, 1, '#4a4a6a');
      if (x % 96 === 0) {
        const yb = rowOf(hs[x]) + 1;
        R(g, x, y, 1, yb - y, '#5a5a7a');
        R(g, x - 3, y, 4, 1, '#5a5a7a');
      }
    }
  }

  // The pantry: a fish market stall on the pier.
  puestoPescado(g, pantry.x0, rowOf(Math.round(heightAt(pantry.x0 + 30))) + 1);
  return { canvas: c, top };
}

/* ── Per frame ───────────────────────────────────────────────────────────── */

/**
 * A wooden funicular cabin riding its slanted rail: vertical walls, a stepped
 * floor that follows the rail. `x` is its middle on screen, `yAt(x)` the rail row.
 */
function cabina(g: Ctx, x: number, yAt: (x: number) => number, col: string) {
  for (let i = -6; i <= 6; i++) {
    const cx = x + i;
    const yb = yAt(cx) - 1;
    const borde = i === -6 || i === 6;
    R(g, cx, yb - 11, 1, 11, borde ? NOCHE : col);
    if (!borde) {
      R(g, cx, yb - 12, 1, 1, NOCHE);
      R(g, cx, yb - 13, 1, 1, '#e86a5c');
      if (i !== 0 && Math.abs(i) < 5) R(g, cx, yb - 9, 1, 3, P.gl1);
      R(g, cx, yb - 1, 1, 1, P.k0);
    }
  }
}

/**
 * Animated details drawn every frame over the Valparaíso strip: funicular
 * cabins going up and down, the Polanco lift, laundry flapping, a dog on the
 * piano stairs and gulls on the lamp posts. `sy` turns an altitude into a row.
 */
export function dibujarDetallesValpo(g: Ctx, camX: number, sy: (alt: number) => number, vw: number, t: number, quieto: boolean) {
  if (!alturas.length) return;
  const tt = quieto ? 0 : t;
  const vis = (x: number, m = 20) => x - camX > -m && x - camX < vw + m;

  // Two cabins on each funicular, one up while the other comes down.
  ASCENSORES.forEach(([xB, hB, xT], i) => {
    if (!vis(xB, 40) && !vis(xT, 40)) return;
    const p = quieto ? 0.3 : 0.5 + 0.5 * Math.sin(tt * 0.35 + i * 2);
    const yAt = (sx: number) => sy(hB + (sx + camX - xB) * ASC_PEND);
    for (const [k, col] of [[p, '#f6b38e'], [1 - p, '#ffd27f']] as const) {
      const x = xB + 8 + (xT - xB - 16) * k;
      cabina(g, Math.round(x - camX), yAt, col);
    }
  });

  // Polanco: the cabin rides up and down the tower.
  {
    const [x, h0, h1] = polanco;
    if (vis(x)) {
      const p = quieto ? 0.5 : 0.5 + 0.5 * Math.sin(tt * 0.5);
      const y = sy(h0 + 4 + (h1 - h0 - 14) * p);
      const sx = Math.round(x - camX);
      R(g, sx + 1, y - 9, 8, 9, NOCHE);
      R(g, sx + 2, y - 8, 6, 7, '#f6b38e');
      R(g, sx + 3, y - 7, 4, 3, P.gl1);
    }
  }

  // Laundry on a line, swaying in the sea breeze.
  for (let i = 0; i < ROPAS.length; i++) {
    const [x, h, w] = ROPAS[i];
    if (!vis(x, w)) continue;
    const sx = Math.round(x - camX);
    const y = sy(h);
    R(g, sx, y, w, 1, '#8a7a9a');
    const cols = [P.white, '#f4a7b9', '#9ec5e8', '#ffd27f'];
    for (let j = 0; j < Math.floor(w / 5); j++) {
      const sway = quieto ? 0 : Math.round(Math.sin(tt * 3 + j + i) * 1);
      const ch = 3 + ((i + j) % 2);
      R(g, sx + 2 + j * 5 + sway, y + 1, 3, ch, cols[(i + j) % cols.length]);
    }
  }

  // A street dog napping on a landing of the piano stairs, tail wagging.
  if (vis(perro[0])) {
    const sx = Math.round(perro[0] - camX);
    const y = sy(perro[1]);
    R(g, sx - 4, y - 4, 9, 4, '#5a3a2a');
    R(g, sx - 3, y - 3, 7, 3, '#c89060');
    R(g, sx + 4, y - 6, 4, 4, '#5a3a2a');
    R(g, sx + 5, y - 5, 3, 3, '#c89060');
    R(g, sx + 5, y - 6, 1, 2, '#5a3a2a');
    R(g, sx + 7, y - 4, 1, 1, NOCHE);
    const wag = quieto ? 0 : Math.floor(tt * 6) % 2;
    R(g, sx - 6, y - 3 - wag, 2, 1, '#c89060');
  }

  // Gulls resting on some lamp posts, now and then turning their heads.
  for (let i = 0; i < FAROLES.length; i += 3) {
    const x = FAROLES[i];
    if (!vis(x)) continue;
    const sx = Math.round(x - camX);
    const y = sy(altura(x)) - 15;
    const look = quieto ? 1 : Math.floor(tt * 0.7 + i) % 3 === 0 ? -1 : 1;
    R(g, sx, y - 3, 5, 3, '#6a7cb8');
    R(g, sx, y - 3, 4, 2, P.white);
    R(g, sx + (look > 0 ? 3 : 0), y - 5, 2, 2, P.white);
    R(g, sx + (look > 0 ? 5 : -1), y - 4, 1, 1, '#ffb43a');
    R(g, sx + 4, y - 2, 1, 1, '#9aa6c8');
  }
  // Lanchas moored at Muelle Prat, bobbing between the piles.
  for (const [i, x, col] of [[0, 100, '#3a8ac8'], [1, 130, '#e86a5c']] as const) {
    if (!vis(x)) continue;
    const sx = Math.round(x - camX);
    const y = sy(12) + (quieto ? 0 : Math.round(Math.sin(tt * 1.4 + i * 2)));
    R(g, sx - 9, y - 4, 19, 1, NOCHE);
    R(g, sx - 8, y - 3, 17, 1, P.white);
    R(g, sx - 8, y - 2, 17, 2, col);
    R(g, sx - 6, y, 13, 1, col);
    R(g, sx - 5, y + 1, 11, 1, NOCHE);
    R(g, sx + 8, y - 6, 2, 3, col);
    R(g, sx - 4, y - 10, 1, 6, NOCHE);
    R(g, sx + 3, y - 10, 1, 6, NOCHE);
    R(g, sx - 6, y - 11, 13, 2, i ? '#ffd27f' : P.white);
    R(g, sx - 6, y - 12, 13, 1, NOCHE);
  }

  // The Merval train along Avenida España: out of one tunnel and into the other.
  {
    const [a, b] = TUNEL;
    if (b - camX > -10 && a - camX < vw + 10) {
      const L = 64;
      const PER = 16;
      const ciclo = Math.floor(tt / PER);
      const u = quieto ? 0.45 : (tt - ciclo * PER) / 9;
      if (u < 1) {
        const dir = ciclo % 2 ? -1 : 1;
        const d = (b - a + L) * u;
        const x0 = Math.round((dir > 0 ? a - L + d : b - d) - camX);
        const yb = sy(TREN_ALT + 1);
        g.save();
        g.beginPath();
        g.rect(a - camX, yb - 20, b - a, 22);
        g.clip();
        vagon(g, x0, yb, true, false, true);
        vagon(g, x0 + 33, yb, false, true, false);
        R(g, x0 + 31, yb - 7, 2, 2, NOCHE);
        g.restore();
      }
    }
  }

  // A horse-drawn victoria going up and down Viña's waterfront.
  {
    const a = VINA + 42;
    const S = MUELLE[0] - 8 - a;
    const ph = quieto ? 10 : (tt * 10) % (2 * S);
    const x = ph < S ? a + ph : a + 2 * S - ph;
    const dir = quieto || ph < S ? 1 : -1;
    if (vis(x, 40)) victoria(g, Math.round(x - camX), sy(altura(x)), dir, quieto ? 0 : Math.floor(tt * 6) % 2);
  }

  // A sandboarder sliding down a face of the Concón dunes.
  {
    const a = 3498;
    const b = 3548;
    const PER = 6;
    const u = quieto ? 0.3 : (tt % PER) / 3.5;
    if (u < 1 && vis(a, 30)) {
      const x = a + (b - a) * u;
      const sx = Math.round(x - camX);
      for (let i = -5; i <= 5; i++) R(g, sx + i, sy(altura(x + i)) - 1, 1, 1, i === 5 ? NOCHE : '#3a8ac8');
      const by = sy(altura(x)) - 1;
      R(g, sx - 2, by - 4, 1, 3, '#3a3a5a');
      R(g, sx + 1, by - 4, 1, 3, '#3a3a5a');
      R(g, sx - 2, by - 8, 4, 4, '#ffd27f');
      R(g, sx - 5, by - 7, 3, 1, '#ffd27f');
      R(g, sx + 2, by - 9, 3, 1, '#ffd27f');
      R(g, sx - 1, by - 11, 3, 3, '#f6c8a0');
      R(g, sx - 1, by - 12, 3, 1, '#e86a5c');
      if (!quieto)
        for (let j = 0; j < 4; j++) {
          const k = (tt * 5 + j * 0.25) % 1;
          R(g, sx - 6 - Math.round(k * 8), by - 2 - Math.round(Math.sin(k * Math.PI) * 5), 1, 1, '#f0cc84');
        }
    }
  }
}

/**
 * One Merval car, 31 px long: white body, blue window band and a red stripe.
 * (x, yb): left end and the rail row. `izq`/`der`: rounded cab at that end.
 */
function vagon(g: Ctx, x: number, yb: number, izq: boolean, der: boolean, panto: boolean) {
  const W = 31;
  const NARIZ = [3, 2, 1, 1, 0, 0, 0, 0, 0, 0];
  const FILAS = [NOCHE, '#e4e4ec', '#f4f4f8', '#3a5ab0', '#3a5ab0', '#3a5ab0', '#f4f4f8', '#e05a4a', '#f4f4f8', NOCHE];
  const top = yb - 11;
  for (let r = 0; r < 10; r++) {
    const l = izq ? NARIZ[r] : 0;
    const d = der ? NARIZ[r] : 0;
    R(g, x + l, top + r, W - l - d, 1, FILAS[r]);
    R(g, x + l, top + r, 1, 1, NOCHE);
    R(g, x + W - 1 - d, top + r, 1, 1, NOCHE);
  }
  for (let i = x + 5; i < x + W - 6; i += 5) R(g, i, top + 3, 3, 2, P.gl1);
  if (izq) R(g, x + 2, top + 3, 2, 2, P.gl2);
  if (der) R(g, x + W - 4, top + 3, 2, 2, P.gl2);
  for (const bx of [x + 4, x + W - 10]) {
    R(g, bx, yb - 1, 6, 1, NOCHE);
    R(g, bx + 1, yb - 1, 1, 1, '#8a8a9a');
    R(g, bx + 4, yb - 1, 1, 1, '#8a8a9a');
  }
  if (panto) {
    R(g, x + 11, top - 3, 8, 1, NOCHE);
    R(g, x + 13, top - 2, 1, 1, NOCHE);
    R(g, x + 16, top - 2, 1, 1, NOCHE);
    R(g, x + 14, top - 1, 2, 1, NOCHE);
  }
}

/** A victoria: a horse pulling a little black carriage with a coachman. (sx, y): wheels' row, `dir` its heading. */
function victoria(g: Ctx, sx: number, y: number, dir: 1 | -1, paso: number) {
  const Rf = (dx: number, dy: number, w: number, h: number, c: string) => R(g, dir > 0 ? sx + dx : sx - dx - w + 1, y + dy, w, h, c);
  const piel = '#f6c8a0';
  // Horse.
  const caballo = '#9a6a42';
  Rf(10, -13, 11, 6, NOCHE);
  Rf(11, -12, 9, 4, caballo);
  Rf(18, -18, 4, 7, caballo);
  Rf(19, -19, 6, 3, caballo);
  Rf(17, -18, 1, 6, '#3a2a1a');
  Rf(9, -12, 2, 5, '#3a2a1a');
  Rf(23, -18, 1, 1, NOCHE);
  for (const [dx, k] of [[11, 0], [13, 1], [17, 1], [19, 0]] as const) Rf(dx, -8 + (k === paso ? 1 : 0), 1, 7 - (k === paso ? 1 : 0), '#6a4a2a');
  Rf(6, -9, 6, 1, '#6a4a2a');
  // Carriage, folded hood at the back, seat and box.
  Rf(-7, -11, 12, 5, NOCHE);
  Rf(-6, -10, 10, 3, '#2a2438');
  Rf(-5, -12, 6, 1, '#c03a3a');
  Rf(-9, -17, 3, 8, '#2a2438');
  Rf(-8, -18, 4, 1, '#2a2438');
  Rf(-4, -15, 3, 3, '#f4a7b9');
  Rf(-4, -18, 3, 3, piel);
  Rf(-5, -19, 5, 1, '#ffd27f');
  Rf(3, -15, 3, 4, '#2a2438');
  Rf(3, -19, 3, 4, '#3a3a5a');
  Rf(3, -22, 3, 3, piel);
  Rf(2, -23, 5, 1, NOCHE);
  Rf(3, -25, 3, 2, NOCHE);
  // Wheels: a big one at the back, a small one in front.
  const rueda = (dx: number, r: number) => {
    const cx = dir > 0 ? sx + dx : sx - dx;
    D.disc(g, cx, y - r - 1, r, NOCHE);
    D.disc(g, cx, y - r - 1, r - 1, '#e8c040');
    R(g, cx, y - r - 1, 1, 1, NOCHE);
  };
  rueda(-4, 4);
  rueda(5, 3);
}
