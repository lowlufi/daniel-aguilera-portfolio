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
  [2100, 152], [2160, 122], [2260, 118], [2340, 146], [2460, 140], [2540, 100], [2600, 92], [2700, 132],
  [2800, 138], [2900, 150], [2980, 110], [3060, 104], [3152, 150], [3300, 156], [3400, 120], [3500, 96], [3600, 90],
];
/** Stair-step slopes: [x0, x1, steps]. Each step is a flat tread and a short ramp. */
const ESCALERAS: [number, number, number][] = [[360, 456, 6], [1440, 1508, 4], [3060, 3152, 5]];

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
  let k = clamp((xc - PUERTO) / 60, 0, 1);
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
const ASC_TOP: [number, number][] = [[760, 90], [2700, 92]];
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
function placa(g: Ctx, x: number, y: number, txt: string) {
  const w = anchoLetrero(txt) + 4;
  R(g, x - 1, y - 1, w + 2, 9, P.gold0);
  R(g, x, y, w, 7, NOCHE);
  escribir(g, txt, x + 2, y + 1, P.white);
}

/** A blue street sign on a pole. */
function letreroCalle(g: Ctx, x: number, y: number, txt: string) {
  const w = anchoLetrero(txt) + 6;
  R(g, x, y - 20, 1, 20, NOCHE);
  R(g, x - 1, y - 28, w + 2, 9, P.white);
  R(g, x, y - 27, w, 7, '#3a5ab0');
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
  R(g, x, y - 14, 1, 14, NOCHE);
  R(g, x + w + 1, y - 14, 1, 14, NOCHE);
  R(g, x, y - 13, w + 2, 9, NOCHE);
  R(g, x + 1, y - 12, w, 7, fondo);
  escribir(g, txt, x + 4, y - 11, P.white, NOCHE);
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
  for (let x = PUERTO + 8; x < length - 12; ) {
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
      if (hash(x, 40 + fila) % 5 === 0) ROPAS.push([x + 2, top - (y + h - 2), w - 4]);
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

  // The street on top: cobbles, an ink edge joined where the slope steps.
  for (let x = PUERTO + 1; x < length; x++) {
    const h = hs[x];
    const y0 = rowOf(h);
    R(g, x, y0, 1, 4, '#b8b0c8');
    R(g, x, y0 + 1, 1, 1, '#d8d4e4');
    if (x % 5 === 0) R(g, x, y0 + 2, 1, 1, '#9a92ac');
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
      if (xT === ASC_TOP[0][0]) {
        const txt = 'ASCENSOR 1883';
        const w = anchoLetrero(txt);
        R(g, xT + 9 - Math.ceil(w / 2) - 3, yb - 30, w + 6, 9, NOCHE);
        R(g, xT + 9 - Math.ceil(w / 2) - 2, yb - 29, w + 4, 7, P.cream);
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
  if (2800 < length) picada(g, 2738, rowOf(Math.min(hs[2738], hs[2782])) + 1);
  if (1620 < length) letreroCalle(g, 1604, rowOf(hs[1604]) + 1, 'CERRO ALEGRE');
  // A small plaque on a wall just under the street.
  if (1720 < length) placa(g, 1690, rowOf(hs[1700]) + 12, 'UNESCO 2003');

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
  const sinFarol: [number, number][] = [[1760, 2000], [1230, 1290], [860, 890], [2730, 2790], [1596, 1660], [740, 790], [2690, 2730]];
  for (let x = PUERTO + 40; x < length - 6; x += 60 + (hash(x, 7) % 30)) {
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
    for (let x = PUERTO + 1; x < length; x++) {
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
}
