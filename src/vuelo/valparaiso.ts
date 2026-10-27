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

// Zinc facades the way the cerros paint them: saturated pinks, yellows, blues and greens next to
// the pastels (the hillside is desaturated a bit at draw time, so these stay lively).
const MUROS = [
  '#ff7eb0', '#ffd23f', '#3fb0e8', '#5cc878', '#ff8a3d', '#a77bea', '#3fcfc0', '#e8504a', '#2f8ad8',
  '#f4a7b9', '#ffd27f', '#8fd3c8', '#9ec5e8', '#c9a7e0', '#f6b38e', '#b5d99c', '#fff6e5', '#c8e040', '#ffb0d8',
];
const TECHOS = ['#e86a5c', '#7a8ab0', '#5aa8a0', '#c0605a', '#9a8aa8', '#3a6ac8', '#e8a030', '#2f9a6a'];
/** Window frames and shutters: mostly white, now and then a bold color. */
const MARCOS = [P.white, P.white, P.white, '#ffd23f', '#3fcfc0', '#ff7eb0', '#2f8ad8'];
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
  // Playa Ancha: the climb, then a long flat top (El Roma, the stadium) and down to the Arco Británico.
  [2100, 152], [2160, 122], [2240, 118], [2286, 146], [2408, 144], [2492, 104], [2544, 92], [2620, 126],
  // The last hill (Recreo / Barón), then the cliff road down to the coast north.
  [2680, 128], [2810, 60],
  // Avenida España, Viña's waterfront, then inland: the racecourse, the botanical garden, up Miraflores,
  // down Reñaca's hill of flats to its beach; the Concón dunes are dunaAt().
  [2930, 52], [3168, 56], [3262, 56], [3302, 60], [3374, 104], [3406, 106], [3480, 56], [3520, 56], [3600, 80],
];
/** The coast north, by world x: Avenida España, Viña del Mar, Reñaca (beach, then the hill), the Concón dunes. */
const COSTA = 2810;
const VINA = 2930;
/** Inland Viña: the racecourse, the botanical garden, Miraflores' hill (its crest), Reñaca's flats going down. */
const SPORTING = 3168;
const BOTANICO = 3262;
const MIRAFLORES = 3302;
const CRESTA: [number, number] = [3374, 3406];
const RENACA = 3480;
const DUNAS = 3520;
/** Muelle Vergara: the pier's deck, over the sea. */
const MUELLE: [number, number] = [3106, 3168];
/** Castillo Wulff's left foot (its rock goes on down into the sea). */
const CASTILLO = 2994;
/** The Merval track along Avenida España: altitude of the rails, tunnel mouths [left, right]. */
const TREN_ALT = 30;
const TUNEL: [number, number] = [COSTA + 8, VINA - 12];
/** Stair-step slopes: [x0, x1, steps]. Each step is a flat tread and a short ramp. */
const ESCALERAS: [number, number, number][] = [[360, 456, 6], [1440, 1508, 4]];
/** Cerro Bellavista (around La Sebastiana): the open-air museum's murals, by world x. */
const BELLAVISTA: [number, number] = [2000, 2180];

const suave = (t: number) => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};
/** The Concón dunes: smooth rounded humps climbing gently from Reñaca's beach to the end of the level. */
function dunaAt(x: number) {
  const u = x - DUNAS;
  return 56 + 16 * suave(u / 80) + 5 * (1 - Math.cos((u * 2 * Math.PI) / 64));
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
const ASC_TOP: [number, number, string][] = [[760, 90, 'ASCENSOR 1883'], [1220, 100, 'REINA VICTORIA'], [2620, 92, 'ARTILLERÍA']];
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
function casa(g: Ctx, x: number, y: number, w: number, h: number, s: number, fila = 0, murales = 17) {
  // Lower rows sit deeper in the hill: a touch duller each.
  const muro = fila ? D.tone(MUROS[s % MUROS.length], -0.035 * fila) : MUROS[s % MUROS.length];
  const techo = fila ? D.tone(TECHOS[(s >>> 4) % TECHOS.length], -0.035 * fila) : TECHOS[(s >>> 4) % TECHOS.length];
  const marco = MARCOS[(s >>> 10) % MARCOS.length];
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
  // Some are two-toned: the lower floor painted another color.
  if ((s >>> 9) % 4 === 0 && h >= 20) {
    const bajo = MUROS[(s >>> 13) % MUROS.length];
    R(g, x, y + 13, w, h - 13, bajo);
    for (let lx = x + 1; lx < x + w; lx += 2) R(g, lx, y + 14, 1, h - 14, D.tone(bajo, -0.1));
    R(g, x, y + 13, w, 1, D.tone(bajo, -0.3));
  }
  if (s % murales === 0 && w > 16) {
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
      R(g, wx, wy, 5, 6, marco);
      R(g, wx + 1, wy + 1, 3, 4, (s + i + row) % 5 === 0 ? P.p2 : P.gl1);
      R(g, wx + 1, wy + 1, 1, 1, P.gl2);
      // Geraniums in a pot on some sills.
      if ((s >>> (11 + i)) % 4 === 0) {
        R(g, wx, wy + 6, 5, 1, '#c0603a');
        R(g, wx + 1, wy + 5, 1, 1, '#e8304a');
        R(g, wx + 3, wy + 5, 1, 1, (s >>> 15) % 2 ? '#ff7eb0' : '#e8304a');
        R(g, wx + 2, wy + 5, 1, 1, '#4aa060');
      }
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
  R(g, x, y, w, h, ['#fff6e5', '#2f8ad8', '#ffd23f', '#3fcfc0'][(s >>> 3) % 4]);
  const cols = ['#ff7eb0', '#3fcfc0', '#ffd23f', '#a77bea', '#3fb0e8', '#ff8a3d', '#5cc878', '#e8504a'];
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
const tilde = (txt: string) => (/[ÑÁÉÍÓ]/.test(txt) ? 4 : 0);

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

/** A rounded little tree: trunk and a two-tone canopy. (x, y): its foot. */
function arbol(g: Ctx, x: number, y: number, r: number, hoja: string, alto = r + 4) {
  R(g, x - 1, y - alto, 3, alto, NOCHE);
  R(g, x, y - alto, 1, alto, '#7a5a3a');
  D.disc(g, x, y - alto - r + 2, r + 1, NOCHE);
  D.disc(g, x, y - alto - r + 2, r, hoja);
  D.disc(g, x - Math.ceil(r / 3), y - alto - r + 1, Math.max(1, Math.floor(r / 2)), D.tone(hoja, 0.22));
}

/**
 * Estadio Elías Figueroa Brand, up on Playa Ancha by the sea: a stand full of
 * green-and-white fans under a white canopy, a floodlight tower at each end.
 * (x, y): left foot, `w` its width.
 */
function estadio(g: Ctx, x: number, y: number, w: number) {
  // Floodlight towers: lattice masts with a tilted panel of lamps on top.
  for (const mx of [x + 1, x + w - 4]) {
    R(g, mx - 1, y - 64, 5, 64, NOCHE);
    R(g, mx, y - 63, 3, 63, '#c8ccd8');
    for (let yy = y - 60; yy < y; yy += 4) R(g, mx + ((yy >> 2) % 2 ? 0 : 2), yy, 1, 2, '#8a8ea0');
    const px = mx - 4;
    R(g, px - 1, y - 75, 13, 11, NOCHE);
    R(g, px, y - 74, 11, 9, '#5a6070');
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) R(g, px + 1 + i * 3, y - 73 + j * 3, 2, 2, (i + j) % 3 ? '#fff6c8' : P.white);
  }
  // The stand: stepped tiers of seats, the crowd on them.
  const x0 = x + 7;
  const x1 = x + w - 7;
  const ancho = x1 - x0;
  R(g, x0 - 1, y - 33, ancho + 2, 33, NOCHE);
  for (let t = 0; t < 6; t++) {
    const yy = y - 31 + t * 4;
    const col = t % 2 ? '#2f9a6a' : '#f4f4f0';
    R(g, x0, yy, ancho, 4, col);
    R(g, x0, yy + 3, ancho, 1, D.tone(col, -0.2));
    // Fans: heads and raised arms in team colors.
    for (let i = 2 + (t % 2); i < ancho - 2; i += 3 + (hash(i, t) % 2)) {
      if (hash(i, t + 30) % 5 === 0) continue;
      const c = ['#2f9a6a', P.white, '#f6c8a0', '#e8c09a', '#3a8a4a', '#ffd23f'][hash(i, t + 50) % 6];
      R(g, x0 + i, yy - 1, 2, 2, c);
      if (hash(i, t + 70) % 6 === 0) R(g, x0 + i, yy - 3, 1, 2, c);
    }
  }
  // Canopy on slim columns, little flags on top.
  R(g, x0 - 3, y - 41, ancho + 6, 3, NOCHE);
  R(g, x0 - 2, y - 40, ancho + 4, 1, '#f4f6fa');
  for (let cx = x0 + 2; cx < x1; cx += 14) R(g, cx, y - 38, 1, 6, '#8a8ea0');
  for (let i = 0; i < 5; i++) {
    const fx = x0 + 4 + Math.round(((ancho - 10) * i) / 4);
    R(g, fx, y - 47, 1, 6, NOCHE);
    R(g, fx + 1, y - 47, 4, 2, i % 2 ? P.white : '#2f9a6a');
    R(g, fx + 1, y - 45, 3, 1, i % 2 ? '#2f9a6a' : P.white);
  }
  // Front wall with its name.
  const txt = 'ELÍAS FIGUEROA';
  const tw = anchoLetrero(txt);
  const e = tilde(txt);
  R(g, x0 - 1, y - 9 - e, ancho + 2, 9 + e, NOCHE);
  R(g, x0, y - 8 - e, ancho, 8 + e, '#2f9a6a');
  R(g, x0, y - 8 - e, ancho, 1, '#5cc878');
  escribir(g, txt, x0 + Math.round((ancho - tw) / 2), y - 7, P.white, '#1a5a3a');
  // Turnstile gate.
  R(g, x0 + 2, y - 7, 4, 7, '#2a2438');
}

/** «El Roma»: a corner fuente de soda of Playa Ancha, striped awning and a red sign on the roof. */
function elRoma(g: Ctx, x: number, y: number) {
  const W = 34;
  R(g, x - 1, y - 28, W + 2, 28, NOCHE);
  R(g, x, y - 27, W, 27, '#fff0d8');
  R(g, x, y - 27, W, 2, '#e8d0b0');
  // Upstairs windows with green shutters.
  for (const wx of [x + 4, x + 14, x + 24]) {
    R(g, wx - 1, y - 24, 1, 6, '#2f9a6a');
    R(g, wx, y - 24, 5, 6, P.gl1);
    R(g, wx, y - 24, 5, 1, P.white);
    R(g, wx + 5, y - 24, 1, 6, '#2f9a6a');
  }
  // Awning: green, white and red stripes, scalloped.
  for (let i = 0; i < W + 4; i++) {
    const c = ['#2f9a6a', P.white, '#e8504a'][Math.floor(i / 3) % 3];
    R(g, x - 2 + i, y - 16, 1, 4 + (i % 3 === 1 ? 1 : 0), c);
  }
  R(g, x - 2, y - 17, W + 4, 1, NOCHE);
  // Shop window with a cake and a schop, and the door.
  R(g, x + 3, y - 10, 18, 9, NOCHE);
  R(g, x + 4, y - 9, 16, 8, '#ffe8a0');
  R(g, x + 6, y - 5, 5, 3, '#f4a7b9');
  R(g, x + 6, y - 6, 5, 1, P.white);
  R(g, x + 14, y - 7, 3, 5, '#ffb43a');
  R(g, x + 14, y - 8, 3, 1, P.white);
  R(g, x + 24, y - 11, 7, 11, NOCHE);
  R(g, x + 25, y - 10, 5, 10, '#8a5a3a');
  R(g, x + 29, y - 5, 1, 1, P.gold);
  // Rooftop sign.
  const txt = 'EL ROMA';
  const tw = anchoLetrero(txt);
  const sx = x + Math.round((W - tw) / 2) - 3;
  R(g, sx + 3, y - 31, 1, 3, NOCHE);
  R(g, sx + tw + 2, y - 31, 1, 3, NOCHE);
  R(g, sx - 1, y - 40, tw + 8, 10, NOCHE);
  R(g, sx, y - 39, tw + 6, 8, '#e8504a');
  R(g, sx, y - 39, tw + 6, 1, '#ff8a7a');
  escribir(g, txt, sx + 3, y - 37, P.white, '#8a2a2a');
}

/** Paseo Gervasoni on Cerro Concepción: a vine pergola over a bench and a coin telescope at the railing. */
function paseoGervasoni(g: Ctx, x: number, y: number, w: number) {
  // Railing along the lookout.
  R(g, x, y - 7, w, 1, NOCHE);
  for (let px = x; px < x + w; px += 4) R(g, px, y - 6, 1, 6, NOCHE);
  R(g, x, y - 6, w, 1, '#e8ecf4');
  // Pergola: posts, beam and a mat of vine with purple and red flowers.
  for (const px of [x + 4, x + w - 6]) {
    R(g, px - 1, y - 24, 4, 24, NOCHE);
    R(g, px, y - 23, 2, 23, '#fff6e5');
  }
  R(g, x + 1, y - 26, w - 2, 3, NOCHE);
  R(g, x + 2, y - 25, w - 4, 1, '#c8a070');
  for (let i = 0; i < w - 4; i += 3) {
    const vy = y - 29 + (hash(x + i, 5) % 3);
    D.disc(g, x + 2 + i, vy, 2, '#3a8a4a');
    R(g, x + 2 + i, vy - 1, 1, 1, '#6ac070');
    if (hash(x + i, 6) % 3 === 0) R(g, x + 3 + i, vy + 1, 1, 1, '#a77bea');
    if (hash(x + i, 7) % 4 === 0) R(g, x + 1 + i, vy, 1, 1, '#ff7eb0');
    // Hanging tendrils.
    if (hash(x + i, 8) % 3 === 0) R(g, x + 2 + i, y - 23, 1, 2 + (hash(x + i, 9) % 4), '#3a8a4a');
  }
  // Bench.
  R(g, x + 10, y - 6, 14, 2, '#8a5a3a');
  R(g, x + 10, y - 10, 14, 2, '#8a5a3a');
  R(g, x + 11, y - 4, 1, 4, NOCHE);
  R(g, x + 22, y - 4, 1, 4, NOCHE);
  // Coin telescope looking out to the bay.
  const tx = x + w - 16;
  R(g, tx, y - 9, 2, 9, NOCHE);
  R(g, tx - 2, y - 14, 7, 5, NOCHE);
  R(g, tx - 1, y - 13, 5, 3, '#3fb0e8');
  R(g, tx + 4, y - 13, 3, 2, NOCHE);
}

/** Mercado Cardonal: a big market hall with arched windows and fruit crates at the door. */
function mercadoCardonal(g: Ctx, x: number, y: number, w: number) {
  R(g, x - 1, y - 32, w + 2, 32, NOCHE);
  R(g, x, y - 31, w, 31, '#f6d8a8');
  R(g, x, y - 31, w, 3, '#e8a030');
  R(g, x, y - 18, w, 1, '#d8b080');
  // Arched windows upstairs, iron-framed openings below.
  for (let wx = x + 3; wx + 6 <= x + w - 2; wx += 9) {
    R(g, wx, y - 25, 6, 6, P.gl1);
    R(g, wx + 1, y - 26, 4, 1, P.gl1);
    R(g, wx + 3, y - 25, 1, 6, '#5a6070');
    R(g, wx, y - 14, 6, 14, '#4a3a3a');
    R(g, wx + 1, y - 13, 4, 1, '#6a5a5a');
  }
  // Pediment with the name.
  const txt = 'MERCADO';
  const tw = anchoLetrero(txt);
  const cx = x + (w >> 1);
  R(g, cx - (tw >> 1) - 4, y - 41, tw + 8, 10, NOCHE);
  R(g, cx - (tw >> 1) - 3, y - 40, tw + 6, 9, '#fff6e5');
  escribir(g, txt, cx - (tw >> 1), y - 38, '#c0603a');
  // Fruit and vegetable crates out front.
  for (let i = 0; i < 4; i++) {
    const bx = x + 2 + i * 13;
    if (bx + 9 > x + w) break;
    R(g, bx, y - 6, 9, 6, P.k0);
    R(g, bx + 1, y - 5, 7, 4, P.k2);
    const c = ['#e8304a', '#ff8a3d', '#5cc878', '#ffd23f'][i];
    for (let j = 0; j < 4; j++) R(g, bx + 1 + j * 2, y - 8 + (j % 2), 2, 2, c);
  }
}

/** Cerro Cordillera's old colonial house (now a museum): whitewashed, tile roof, green shutters, a little cannon. */
function casaCordillera(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 20, 34, 20, NOCHE);
  R(g, x, y - 19, 32, 19, '#fff6e5');
  for (let i = 0; i < 5; i++) R(g, x - 3 + i, y - 21 - i, 38 - i * 2, 1, i === 0 ? NOCHE : i % 2 ? '#c0603a' : '#d8784a');
  for (const wx of [x + 3, x + 24]) {
    R(g, wx, y - 15, 5, 7, P.gl1);
    R(g, wx - 1, y - 15, 1, 7, '#2f9a6a');
    R(g, wx + 5, y - 15, 1, 7, '#2f9a6a');
  }
  R(g, x + 13, y - 13, 6, 13, '#6a4a3a');
  R(g, x + 14, y - 14, 4, 1, '#6a4a3a');
  // The cannon on its carriage, pointing at the bay.
  R(g, x + 36, y - 4, 8, 3, NOCHE);
  R(g, x + 44, y - 4, 2, 2, NOCHE);
  D.disc(g, x + 38, y - 1, 1, '#6a4a3a');
}

/** Iglesia San Francisco on Cerro Barón: a nave and a tall red-brick tower with a slim spire. */
function sanFrancisco(g: Ctx, x: number, y: number) {
  const ladrillo = '#c0603a';
  // Nave.
  R(g, x - 1, y - 18, 16, 18, NOCHE);
  R(g, x, y - 17, 14, 17, ladrillo);
  for (let i = 0; i < 4; i++) R(g, x - 1 + i, y - 19 - i, 16 - i * 2, 1, '#8a4a3a');
  R(g, x + 4, y - 13, 4, 7, P.gl1);
  // Tower, three stages.
  const tx = x + 14;
  R(g, tx - 1, y - 52, 18, 52, NOCHE);
  R(g, tx, y - 51, 16, 51, ladrillo);
  for (let yy = y - 49; yy < y; yy += 3) R(g, tx, yy, 16, 1, '#a84a2a');
  for (let yy = y - 49; yy < y; yy += 6) for (let xx = tx + 2; xx < tx + 16; xx += 5) R(g, xx, yy, 1, 2, '#e08a6a');
  for (const [yy, hh] of [[-44, 7], [-30, 6]] as const) {
    R(g, tx + 5, y + yy, 6, hh, '#3a2a3a');
    R(g, tx + 7, y + yy - 1, 2, 1, '#3a2a3a');
  }
  R(g, tx - 2, y - 36, 20, 2, '#e8d4b0');
  R(g, tx - 2, y - 22, 20, 2, '#e8d4b0');
  R(g, tx + 5, y - 10, 6, 10, '#5a3a2a');
  for (let i = 0; i < 8; i++) R(g, tx + 1 + i, y - 53 - i * 2, 14 - i * 2, 2, i === 0 ? NOCHE : '#7a8ab0');
  R(g, tx + 7, y - 72, 2, 6, NOCHE);
  R(g, tx + 6, y - 70, 4, 1, NOCHE);
}

/** The racecourse's grandstand: white, with a green roof, a clock and its name. (x, y): left foot. */
function tribunaHipodromo(g: Ctx, x: number, y: number) {
  const W = 40;
  R(g, x - 1, y - 24, W + 2, 24, NOCHE);
  R(g, x, y - 23, W, 23, '#fdfaf2');
  // Tiers seen from the side, with spectators in hats.
  for (let t = 0; t < 4; t++) {
    const yy = y - 20 + t * 4;
    R(g, x + 2, yy, W - 4, 1, '#d8d4e4');
    for (let i = 4 + (t % 2) * 2; i < W - 4; i += 4) {
      const c = ['#ff7eb0', '#3fb0e8', '#ffd23f', P.white, '#a77bea'][hash(i, t + 7) % 5];
      R(g, x + i, yy - 2, 2, 2, '#f6c8a0');
      R(g, x + i - 1, yy - 3, 4, 1, c);
    }
  }
  // Green roof with a scalloped edge and a little clock cupola.
  R(g, x - 3, y - 27, W + 6, 3, '#2f7a4a');
  for (let i = 0; i < W + 6; i += 3) R(g, x - 3 + i, y - 24, 2, 1, '#2f7a4a');
  R(g, x - 3, y - 28, W + 6, 1, NOCHE);
  const txt = 'HIPÓDROMO';
  const tw = anchoLetrero(txt);
  const e = tilde(txt);
  R(g, x + (W >> 1) - (tw >> 1) - 3, y - 38 - e, tw + 6, 10 + e, NOCHE);
  R(g, x + (W >> 1) - (tw >> 1) - 2, y - 37 - e, tw + 4, 8 + e, '#fdfaf2');
  escribir(g, txt, x + (W >> 1) - (tw >> 1), y - 35, '#2f7a4a');
  // The clock on its little gable, over the sign.
  const cx = x + (W >> 1);
  for (let i = 0; i < 5; i++) R(g, cx - 5 + i, y - 39 - e - i, 11 - i * 2, 1, NOCHE);
  D.disc(g, cx, y - 43 - e, 3, NOCHE);
  D.disc(g, cx, y - 43 - e, 2, P.white);
  R(g, cx, y - 44 - e, 1, 2, NOCHE);
}

/** Jardín Botánico: a Chilean palm, leafy trees and a white Victorian greenhouse. (x0, x1): its stretch. */
function jardinBotanico(g: Ctx, x0: number, x1: number, rowOf: (a: number) => number, hs: Int16Array) {
  // Greenhouse with a glass dome.
  const gx = x0 + 11;
  const yb = rowOf(Math.max(hs[gx], hs[gx + 18])) + 1;
  R(g, gx - 1, yb - 12, 20, 12, NOCHE);
  R(g, gx, yb - 11, 18, 11, '#bfe8f4');
  for (let xx = gx + 3; xx < gx + 18; xx += 4) R(g, xx, yb - 11, 1, 11, P.white);
  R(g, gx, yb - 6, 18, 1, P.white);
  cupula(g, gx + 9, yb - 11, 7, 5, NOCHE);
  cupula(g, gx + 9, yb - 11, 6, 4, '#d8f4fc');
  R(g, gx + 9, yb - 18, 1, 3, NOCHE);
  for (let i = 0; i < 4; i++) R(g, gx + 2 + i * 4, yb - 3, 2, 3, '#3a8a4a');
  // Trees, lush and varied.
  const verdes = ['#3a8a4a', '#5cb860', '#2f7a5a', '#7ac860'];
  for (let i = 0, x = gx + 22; x < x1 - 2; i++, x += 7 + (hash(x, 95) % 4)) {
    const y = rowOf(hs[x]) + 1;
    arbol(g, x, y, 4 + (hash(x, 96) % 3), verdes[i % verdes.length], 5 + (hash(x, 97) % 5));
  }
  // A Chilean wine palm: thick grey trunk and a round crown of fronds.
  {
    const px = x0 + 4;
    const y = rowOf(hs[px]) + 1;
    R(g, px - 2, y - 22, 6, 22, NOCHE);
    R(g, px - 1, y - 22, 4, 22, '#8a8478');
    for (let yy = y - 20; yy < y; yy += 3) R(g, px - 1, yy, 4, 1, '#6a6458');
    for (let j = -8; j <= 8; j++) {
      const yy = y - 24 + Math.round((j * j) / 12);
      R(g, px + j, yy, 1, 2, '#2f7a4a');
      R(g, px + j, yy - 1, 1, 1, '#5cb860');
    }
    D.disc(g, px, y - 25, 3, '#3a8a4a');
  }
}

/**
 * Depto. Katurris: a friendly little block of flats on Miraflores' crest, one
 * balcony overflowing with plants, and its name on a sign on the roof. (x, y): left foot.
 */
function deptoKaturris(g: Ctx, x: number, y: number) {
  const W = 28;
  const H = 40;
  const muro = '#ffc8a8';
  R(g, x - 1, y - H - 1, W + 2, H + 1, NOCHE);
  R(g, x, y - H, W, H, muro);
  R(g, x + W - 2, y - H, 2, H, D.tone(muro, -0.12));
  R(g, x - 2, y - H - 2, W + 4, 2, '#fdfaf2');
  // Three floors of windows; the door with its little canopy.
  for (let f = 0; f < 3; f++) {
    const wy = y - H + 4 + f * 11;
    for (const wx of [x + 3, x + 11]) {
      R(g, wx - 1, wy - 1, 7, 8, P.white);
      R(g, wx, wy, 5, 6, f === 1 && wx === x + 11 ? '#ffe8a0' : P.gl1);
      R(g, wx, wy, 1, 1, P.gl2);
    }
    R(g, x, wy + 9, W, 1, D.tone(muro, -0.18));
  }
  R(g, x + 4, y - 8, 7, 8, '#6a4a3a');
  R(g, x + 3, y - 9, 9, 1, '#e86a5c');
  R(g, x + 9, y - 4, 1, 1, P.gold);
  // The balcony (middle floor, right side), bursting with plants.
  const by = y - H + 23;
  const bx = x + 19;
  R(g, bx, by - 6, 1, 6, P.white);
  R(g, bx, by, 13, 2, P.white);
  for (let i = 1; i < 12; i += 2) R(g, bx + i, by - 4, 1, 4, P.white);
  R(g, bx, by - 5, 13, 1, P.white);
  // Pots.
  for (const [dx, c] of [[1, '#c0603a'], [5, '#3fb0e8'], [9, '#ffd23f']] as const) R(g, bx + dx, by - 3, 3, 3, c);
  // Big leaves spilling over the railing, vines hanging down.
  for (const [dx, dy, r, c] of [[2, -8, 3, '#3a8a4a'], [6, -10, 4, '#2f7a5a'], [10, -8, 3, '#5cb860'], [12, -12, 2, '#3a8a4a'], [0, -11, 2, '#5cb860']] as const) {
    D.disc(g, bx + dx, by + dy, r, c);
    R(g, bx + dx - 1, by + dy - 1, 1, 1, D.tone(c, 0.3));
  }
  for (const [dx, len] of [[1, 9], [4, 6], [8, 11], [11, 7], [13, 5]] as const)
    for (let j = 0; j < len; j++) R(g, bx + dx + (j % 3 === 2 ? 1 : 0), by + 2 + j, 1, 1, j % 4 === 3 ? '#5cb860' : '#2f7a5a');
  for (const [dx, dy, c] of [[3, -12, '#ff7eb0'], [7, -14, '#ffd23f'], [11, -10, '#ff7eb0'], [1, -7, P.white], [9, 6, '#ff7eb0'], [13, -14, '#a77bea']] as const)
    R(g, bx + dx, by + dy, 1, 1, c);
  // A cat watching from the roof edge.
  R(g, x + 3, y - H - 5, 4, 3, '#5a4a4a');
  R(g, x + 3, y - H - 6, 1, 1, '#5a4a4a');
  R(g, x + 6, y - H - 6, 1, 1, '#5a4a4a');
  R(g, x + 7, y - H - 3, 3, 1, '#5a4a4a');
  // Rooftop sign on two posts.
  const txt = 'DEPTO. KATURRIS';
  const tw = anchoLetrero(txt);
  const sx = x + (W >> 1) - (tw >> 1) - 3;
  R(g, x + 12, y - H - 8, 1, 6, NOCHE);
  R(g, x + 22, y - H - 8, 1, 6, NOCHE);
  R(g, sx - 1, y - H - 18, tw + 8, 10, NOCHE);
  R(g, sx, y - H - 17, tw + 6, 8, '#fff6e5');
  R(g, sx, y - H - 17, tw + 6, 1, '#ffd23f');
  escribir(g, txt, sx + 3, y - H - 15, '#c05a7a');
  // A heart on the sign's corner.
  R(g, sx + tw + 7, y - H - 20, 2, 1, '#e8304a');
  R(g, sx + tw + 10, y - H - 20, 2, 1, '#e8304a');
  R(g, sx + tw + 7, y - H - 19, 5, 1, '#e8304a');
  R(g, sx + tw + 8, y - H - 18, 3, 1, '#e8304a');
  R(g, sx + tw + 9, y - H - 17, 1, 1, '#e8304a');
}

/** A racehorse at full gallop with its jockey. (sx, y): hooves' row, `dir` heading, `paso` 0/1 legs. */
function caballoCarrera(g: Ctx, sx: number, y: number, dir: 1 | -1, paso: number, seda: string) {
  const Rf = (dx: number, dy: number, w: number, h: number, c: string) => R(g, dir > 0 ? sx + dx : sx - dx - w + 1, y + dy, w, h, c);
  const piel = '#7a4a2a';
  Rf(-6, -10, 13, 5, NOCHE);
  Rf(-5, -9, 11, 3, piel);
  Rf(5, -13, 4, 5, piel);
  Rf(7, -14, 4, 3, piel);
  Rf(10, -13, 1, 1, NOCHE);
  Rf(4, -13, 1, 4, '#2a1a1a');
  Rf(-8, -9, 3, 2, '#2a1a1a');
  // Legs: stretched out, then gathered.
  if (paso) {
    Rf(-6, -6, 1, 5, piel);
    Rf(-4, -6, 1, 4, piel);
    Rf(4, -6, 1, 5, piel);
    Rf(6, -6, 1, 4, piel);
  } else {
    Rf(-7, -6, 1, 3, piel);
    Rf(-8, -3, 1, 2, piel);
    Rf(6, -6, 1, 3, piel);
    Rf(7, -4, 1, 3, piel);
    Rf(-2, -6, 1, 5, piel);
    Rf(2, -6, 1, 5, piel);
  }
  // Jockey crouched, in bright silks.
  Rf(-1, -14, 5, 4, seda);
  Rf(2, -17, 3, 3, '#f6c8a0');
  Rf(2, -18, 3, 1, seda);
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
    } else if (x < SPORTING) {
      const yA = rowOf(26);
      piedraCol(g, x, yS, yA);
      arenaCol(g, x, yA, ySea);
      marCol(g, x, ySea, H, ySea);
    } else if (x < MIRAFLORES) {
      // Inland: the racecourse's turf and the garden's dark soil over the earth.
      const pasto = x < BOTANICO ? '#5cb860' : '#3a8a4a';
      R(g, x, yS, 1, H - yS, '#a8987a');
      R(g, x, yS, 1, 7, pasto);
      R(g, x, yS + 7, 1, 1, D.tone(pasto, -0.25));
      if (hash(x, 56) % 3 === 0) R(g, x, yS + 1 + (hash(x, 57) % 5), 1, 1, D.tone(pasto, 0.25));
      for (let y = yS + 12; y < H - 1; y += 6) if (hash(x, y) % 5 === 0) R(g, x, y, 1, 1, '#968668');
    } else if (x < RENACA) {
      R(g, x, yS, 1, H - yS, '#a8987a');
      if (hash(x, 56) % 4 === 0) R(g, x, yS + 1 + (hash(x, 57) % 4), 1, 1, '#5a8a5a');
    } else if (x < DUNAS) {
      arenaCol(g, x, yS, ySea);
      marCol(g, x, ySea, H, ySea);
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

  // Castillo Wulff's rock, from the street down into the surf: a lumpy outcrop
  // (each side bulges on its own), wet and bluish under the waterline.
  {
    const cx = CASTILLO + 16;
    let yTop = 1e9;
    for (let x = cx - 16; x <= cx + 16; x++) yTop = Math.min(yTop, rowOf(hs[x]) + 2);
    const lado = (y: number, sem: number) => {
      const k = Math.floor((y - yTop) / 3);
      return 15 + Math.floor((y - yTop) * 0.1) + (hash(k, sem) % 4) + Math.round(2 * Math.sin((y - yTop) / 7 + sem));
    };
    for (let y = yTop; y < H; y++) {
      const l = lado(y, 58);
      const r = lado(y, 77);
      const agua = y > ySea;
      R(g, cx - l - 1, y, l + r + 3, 1, agua ? '#2a3a58' : NOCHE);
      R(g, cx - l, y, l + r + 1, 1, agua ? '#5a6a84' : '#8a7e78');
      if (agua) {
        if ((y - yTop) % 5 === 0) R(g, cx - l + 2 + (hash(y, 59) % 6), y, 5, 1, '#6a7c98');
      } else {
        // Light on the upper faces, cracks and lichen.
        R(g, cx - l, y, 2, 1, '#a89c94');
        if ((y - yTop) % 5 === 0) R(g, cx - l + 3 + (hash(y, 59) % 10), y, 4 + (hash(y, 62) % 5), 1, '#a89c94');
        if ((y - yTop) % 5 === 2) R(g, cx - 6 + (hash(y, 60) % 14), y, 3, 1, '#6a5e5a');
        if (hash(y, 63) % 7 === 0) R(g, cx + r - 3, y, 2, 1, '#9aa070');
      }
    }
    // Foam only where the surf meets each side of the rock.
    const l = lado(ySea, 58);
    const r = lado(ySea, 77);
    R(g, cx - l - 5, ySea, 4, 1, P.white);
    R(g, cx - l - 3, ySea + 1, 2, 1, P.white);
    R(g, cx + r + 2, ySea, 4, 1, P.white);
    R(g, cx + r + 2, ySea + 1, 2, 1, P.white);
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

  // Miraflores: colorful houses stacked down its hillside, under the street.
  for (let x = MIRAFLORES + 4; x < CRESTA[1] - 4; ) {
    const w = Math.min(14 + (hash(x, 91) % 6), CRESTA[1] - 2 - x);
    if (w < 10) break;
    let minH = 1e9;
    for (let i = 0; i < w; i++) minH = Math.min(minH, hs[x + i]);
    let y = rowOf(minH) + 5 + (hash(x, 92) % 4);
    for (let fila = 0; y + 16 < H - 3; fila++) {
      const h = Math.min(16 + (hash(x, 93 + fila) % 8), H - 3 - y);
      if (h < 16) break;
      casa(g, x, y, w, h, hash(x, 94 + fila), fila, 13);
      y += h + 2;
    }
    x += w + 2;
  }

  // Reñaca: white blocks of flats stepping down the hill to the beach.
  for (let x = CRESTA[1] + 2; x < RENACA - 6; ) {
    const w = Math.min(15, RENACA - 2 - x);
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
      // Cerro Bellavista's open-air museum: murals on almost every other wall.
      casa(g, x, y, w, h, hash(x, 20 + fila), fila, x > BELLAVISTA[0] && x < BELLAVISTA[1] ? 2 : 11);
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
    } else if (x >= RENACA) {
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
  for (const [xT, hB, nombre] of ASC_TOP) {
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
        const txt = nombre;
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
  if (1300 < length) bomberos(g, 1266, rowOf(Math.min(hs[1266], hs[1310])) + 1);
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
    arcoBritanico(g, 2496, rowOf(Math.max(hs[2496], hs[2540])) + 1);
    placa(g, 2488, rowOf(hs[2508]) + 14, 'ARCO BRITÁNICO');
  }

  // More cerros: Cordillera's colonial house, Concepción's Paseo Gervasoni,
  // the Mercado Cardonal down in El Almendral, Bellavista's open-air museum,
  // and Iglesia San Francisco's brick tower on Cerro Barón.
  if (LEVEL <= length) {
    casaCordillera(g, 484, rowOf(Math.min(hs[484], hs[530])) + 1);
    letreroCalle(g, 540, rowOf(hs[540]) + 1, 'CORDILLERA');
    paseoGervasoni(g, 796, rowOf(Math.min(hs[796], hs[846])) + 1, 50);
    placa(g, 786, rowOf(hs[800]) + 12, 'GERVASONI');
    mercadoCardonal(g, 984, rowOf(Math.min(hs[984], hs[1036])) + 1, 52);
    placa(g, 984, rowOf(hs[1000]) + 12, 'CARDONAL');
    placa(g, 2070, rowOf(hs[2090]) + 12, 'MUSEO A CIELO ABIERTO');
    sanFrancisco(g, 2646, rowOf(Math.min(hs[2646], hs[2678])) + 1);
    placa(g, 2640, rowOf(hs[2660]) + 12, 'CERRO BARÓN');

    // Playa Ancha: its sign at the foot of the climb, «El Roma» and the stadium on top.
    placa(g, 2244, rowOf(hs[2262]) + 12, 'CERRO PLAYA ANCHA');
    elRoma(g, 2290, rowOf(Math.min(hs[2290], hs[2324])) + 1);
    estadio(g, 2328, rowOf(Math.min(hs[2328], hs[2406])) + 1, 78);
    placa(g, 2330, rowOf(hs[2350]) + 26, 'ESTADIO ELÍAS FIGUEROA');
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
    pancarta(g, VINA - 60, rowOf(Math.max(hs[VINA - 60], hs[VINA - 6])) + 1, 'VIÑA DEL MAR', '#5aa870');
    // Viña: the flower clock, palms, Castillo Wulff, the casino, Muelle Vergara.
    relojFlores(g, VINA + 2, rowOf(Math.max(hs[VINA + 2], hs[VINA + 36])) + 1);
    placa(g, VINA + 2, rowOf(hs[VINA + 20]) + 10, 'RELOJ DE FLORES');
    palmera(g, VINA + 46, rowOf(hs[VINA + 46]) + 1, 24, 1);
    castilloWulff(g, CASTILLO, rowOf(Math.max(hs[CASTILLO], hs[CASTILLO + 30])) + 1);
    casino(g, 3046, rowOf(Math.min(hs[3046], hs[3100])) + 1);
    palmera(g, 3035, rowOf(hs[3035]) + 1, 20, -1);
    palmera(g, 3104, rowOf(hs[3104]) + 1, 26, 1);
    torreMuelle(g, MUELLE[1] - 16, rowOf(hs[MUELLE[1] - 10]) + 1);
    for (const x of [MUELLE[0] + 2, MUELLE[1] - 2]) farol(g, x, rowOf(hs[x]) + 1);
    placa(g, MUELLE[0] + 4, rowOf(hs[MUELLE[0] + 10]) + 10, 'MUELLE VERGARA');
    // Inland Viña: the racecourse (grandstand, white rail, the finish post) and the botanical garden.
    tribunaHipodromo(g, SPORTING + 4, rowOf(Math.min(hs[SPORTING + 4], hs[SPORTING + 44])) + 1);
    for (let x = SPORTING + 48; x < BOTANICO - 4; x++) {
      const y0 = rowOf(hs[x]);
      R(g, x, y0 - 7, 1, 1, P.white);
      R(g, x, y0 - 6, 1, 1, '#c8c4d4');
      if (x % 6 === 0) R(g, x, y0 - 7, 1, 7, P.white);
    }
    {
      const x = BOTANICO - 10;
      const y0 = rowOf(hs[x]) + 1;
      R(g, x, y0 - 18, 1, 18, NOCHE);
      D.disc(g, x, y0 - 21, 4, NOCHE);
      D.disc(g, x, y0 - 21, 3, '#e8504a');
      R(g, x - 2, y0 - 21, 5, 1, P.white);
    }
    jardinBotanico(g, BOTANICO, MIRAFLORES, rowOf, hs);
    placa(g, BOTANICO + 2, rowOf(hs[BOTANICO + 20]) + 12, 'JARDÍN BOTÁNICO');
    // Miraflores: its sign on the wall under the climbing street, and Depto. Katurris on the crest.
    placa(g, MIRAFLORES + 8, rowOf(hs[MIRAFLORES + 8]) + 9, 'MIRAFLORES');
    for (const x of [MIRAFLORES + 14, MIRAFLORES + 40]) arbol(g, x, rowOf(hs[x]) + 1, 3, '#5cb860', 4);
    deptoKaturris(g, CRESTA[0] + 2, rowOf(Math.min(hs[CRESTA[0] + 2], hs[CRESTA[0] + 30])) + 1);
    // Reñaca: umbrellas on the beach and the sign; a palm at the foot of the hill.
    letreroCalle(g, RENACA + 2, rowOf(hs[RENACA + 2]) + 1, 'REÑACA');
    quitasol(g, RENACA + 14, rowOf(hs[RENACA + 14]) + 1, '#e86a5c', P.white);
    quitasol(g, RENACA + 30, rowOf(hs[RENACA + 30]) + 1, '#8fd3c8', '#ffd27f');
    palmera(g, RENACA - 4, rowOf(hs[RENACA - 4]) + 1, 22, -1);
    // Concón: sparse scrub on the dunes, the sign on the first crest and a boarder walking up.
    for (let x = DUNAS + 6; x < length - 4; x += 12 + (hash(x, 81) % 12)) matitaDuna(g, x, rowOf(hs[x]) + 1, hash(x, 82));
    letreroMadera(g, DUNAS + 10, rowOf(hs[DUNAS + 10]) + 1, 'DUNAS DE CONCÓN');
    {
      const x = DUNAS + 4;
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
    [1760, 2000], [1196, 1320], [860, 890], [2180, 2424], [1596, 1660], [740, 850], [2610, 2686], [456, 610],
    [976, 1060], [226, 356], [1512, 1562], [2486, 2546], [COSTA, VINA - 2], [VINA, MUELLE[1] + 6], [SPORTING, DUNAS],
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
      // The line turns off before Playa Ancha's top (no wires over El Roma and the stadium).
      if (x > 2268 && x < 2440) continue;
      const y = rowOf(Math.round(Math.max(media(x), hs[x] - 6)) + ALTO);
      R(g, x, y, 1, 1, '#4a4a6a');
      if (x % 96 === 0 || x === 2268 || x === 2440) {
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

  // Two racehorses galloping along the rail of the racecourse, neck and neck.
  {
    const a = SPORTING + 44;
    const b = BOTANICO - 4;
    if (vis(a, 40) || vis(b, 40)) {
      g.save();
      g.beginPath();
      g.rect(a - camX, 0, b - a, 99999);
      g.clip();
      for (const [i, seda] of [[0, '#ff7eb0'], [1, '#3fb0e8']] as const) {
        const PER = 5;
        const u = quieto ? 0.3 + i * 0.4 : ((tt + i * 1.1) % PER) / 2.6;
        if (u > 1.3) continue;
        const x = a - 14 + (b - a + 28) * u;
        caballoCarrera(g, Math.round(x - camX), sy(altura(x)) - 1 - i * 2, 1, quieto ? i : Math.floor(tt * 9 + i) % 2, seda);
      }
      g.restore();
    }
  }

  // A sandboarder sliding down a face of the Concón dunes.
  {
    const a = DUNAS + 38;
    const b = DUNAS + 60;
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
