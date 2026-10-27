import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { R } from './dibujo';

/*
 * Scene transitions for the trip between maps: a pixel-art "curtain" that
 * sweeps over the whole screen while the map is swapped and then clears away
 * over the new place. Each destination has its own curtain:
 *
 *   valle      – sunset clouds rolling in from the right (back home).
 *   oceano     – a big wave with a foam crest sweeping in from the right.
 *   valparaiso – a hill of colorful houses that rises from below, with gulls.
 *   tormenta   – dark storm clouds closing from both sides, a lightning flash.
 *
 * Before the curtain, speed streaks race past the plane as the nitro lights.
 *
 * `fase` runs 0 → 1 → 2:
 *   0..1  the trip (closing): streaks from ~0.25, the curtain sweeps in over
 *         0.60..0.97 and fully covers the screen from 0.97 to 1.08.
 *   1..2  the arrival (opening): the curtain holds until 1.08, then clears by
 *         1.85; the last streaks fade out.
 * Curtain canvases are painted once per (destination, screen size) and cached;
 * per frame it is a couple of drawImage calls plus a few dozen rects.
 */

export type MapaId = 'valle' | 'oceano' | 'valparaiso' | 'tormenta';
type Ctx = CanvasRenderingContext2D;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const rng = (seed: number) => {
  let a = seed * 9301 + 49297;
  return () => ((a = (a * 9301 + 49297) % 233280), a / 233280);
};

/** How much the curtain covers (0..1) for a phase; exactly 1 over 0.97..1.08. */
export function coberturaTransicion(fase: number): number {
  return fase <= 1 ? ss(0.6, 0.97, fase) : 1 - ss(1.08, 1.85, fase);
}

/* ── Cached curtains ─────────────────────────────────────────────────────── */

/** Width of the ragged edge painted beyond the solid body of a curtain. */
const E = 40;

type Telon = { a: HTMLCanvasElement; b?: HTMLCanvasElement };
const cache = new Map<string, Telon>();

function lienzo(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** Stepped vertical bands, like the sky's scanline gradient. */
function bandas(g: Ctx, x: number, y: number, w: number, h: number, cols: string[]) {
  const n = cols.length;
  for (let i = 0; i < n; i++) {
    const y0 = y + Math.round((h * i) / n), y1 = y + Math.round((h * (i + 1)) / n);
    R(g, x, y0, w, y1 - y0, cols[i]);
  }
}

/** Sunset clouds: wide canvas (vw + 2E) with puffy edges on both sides. */
function telonValle(vw: number, vh: number): Telon {
  const W = vw + 2 * E;
  const [c, g] = lienzo(W, vh);
  const rnd = rng(11);
  const shade = '#b04a78', mid = '#f08a8a', body = '#ffc0a0', light = '#fff0d0';
  bandas(g, E, 0, vw, vh, ['#6a3a8a', '#8a4a9a', '#b25a9a', '#d8688e', '#f07e84', '#ff9a78', '#ffb470', '#ffcc7a', '#ffe08e']);
  // A low sun glowing behind the clouds.
  const sx = E + Math.round(vw * 0.62), sy = Math.round(vh * 0.68);
  D.disc(g, sx, sy, 30, '#ffd890');
  D.disc(g, sx, sy, 24, '#ffeaa8');
  D.disc(g, sx, sy, 18, '#fff6d0');
  // Rows of long cloud banks across the body.
  for (let row = 0; row < 7; row++) {
    const y = Math.round((vh * (row + 0.6)) / 7);
    for (let x = E - 10 + Math.round(rnd() * 30); x < W - E + 10; x += 26 + Math.round(rnd() * 34)) {
      const w = 40 + Math.round(rnd() * 50);
      const k = row / 6;
      const cl = D.cloud(row * 31 + (x & 255), w, k > 0.6 ? '#ffd8a8' : body, light, k > 0.5 ? '#d8607a' : shade);
      g.drawImage(cl, x, y - (cl.height >> 1));
    }
  }
  // The rolling fronts: a column of big puffs on each side.
  for (const side of [0, 1]) {
    const puffs: [number, number, number][] = [];
    for (let y = -8; y < vh + 16; y += 14 + Math.round(rnd() * 8)) {
      const r = 14 + Math.round(rnd() * 12);
      const x = side ? W - E - 2 + Math.round(rnd() * 10) - (r >> 2) : E + 2 - Math.round(rnd() * 10) + (r >> 2);
      puffs.push([x, y, r]);
    }
    // Inner fill first, so nothing shows between the puffs and the body.
    R(g, side ? W - E - 6 : E, 0, 6, vh, mid);
    for (const [x, y, r] of puffs) D.disc(g, x, y, r + 1, shade);
    for (const [x, y, r] of puffs) D.disc(g, x, y, r, mid);
    for (const [x, y, r] of puffs) D.disc(g, x + 1, y - 1, r - 2, body);
    for (const [x, y, r] of puffs) R(g, x - Math.round(r * 0.45), y - Math.round(r * 0.6), Math.max(3, Math.round(r * 0.4)), 2, light);
  }
  return { a: c };
}

/** A big wave: wide canvas with a curling, foamy crest at the leading (left) edge. */
function telonOceano(vw: number, vh: number): Telon {
  const W = vw + 2 * E;
  const [c, g] = lienzo(W, vh);
  const rnd = rng(23);
  const AGUA = ['#74ccf8', '#5abcf0', '#46a8e8', '#3a94dc', '#2a78c8', '#2266b4', '#1c56a0', '#16468a', '#123a78'];
  const aguaEn = (y: number) => AGUA[Math.min(AGUA.length - 1, Math.floor((y * AGUA.length) / vh))];
  bandas(g, 0, 0, W, vh, ['#74ccf8', '#5abcf0', '#46a8e8', '#3a94dc', '#2a78c8', '#2266b4', '#1c56a0', '#16468a', '#123a78']);
  // Clear the edge zones again; they are drawn as wave fronts below.
  g.clearRect(0, 0, E, vh);
  g.clearRect(W - E, 0, E, vh);
  // Sweeping wave lines inside the water.
  for (let i = 0; i < 70; i++) {
    const y = Math.round(rnd() * vh), x = E + Math.round(rnd() * vw), w = 8 + Math.round(rnd() * 26);
    const col = y < vh * 0.4 ? P.w3 : y < vh * 0.7 ? P.w2 : P.w1;
    R(g, x, y, w, 1, col);
    R(g, x + 3, y - 1, Math.max(2, w - 8), 1, D.tone(col, 0.4));
  }
  for (let i = 0; i < 40; i++) R(g, E + Math.round(rnd() * vw), Math.round(rnd() * vh), 1, 1, P.white);
  // Leading crest: the water bulges left with a wobble, lighter towards the lip.
  const crest = (y: number) => Math.round(E * 0.42 + Math.sin(y * 0.045) * 7 + Math.sin(y * 0.13 + 1) * 3);
  for (let y = 0; y < vh; y++) {
    const x0 = crest(y);
    R(g, x0, y, E - x0 + 1, 1, aguaEn(y));
    R(g, x0, y, 6, 1, P.w2);
    R(g, x0 + 6, y, 3, 1, P.w1);
  }
  // Foam: a thick lip of white puffs, with spray ahead of it.
  for (let y = -4; y < vh + 6; y += 7 + Math.round(rnd() * 4)) {
    const x = crest(y), r = 4 + Math.round(rnd() * 4);
    D.disc(g, x, y, r + 1, P.w3);
    D.disc(g, x - 1, y, r, P.white);
  }
  for (let i = 0; i < 90; i++) {
    const y = Math.round(rnd() * vh), x = crest(y) - 4 - Math.round(rnd() * rnd() * (E * 0.4));
    R(g, x, y, 2, 2, i & 1 ? P.white : P.w3);
  }
  // Trailing edge: foamy back of the wave.
  const back = (y: number) => W - E + Math.round(E * 0.5 + Math.sin(y * 0.06 + 2) * 6);
  for (let y = 0; y < vh; y++) {
    const x1 = back(y);
    R(g, W - E, y, x1 - (W - E), 1, aguaEn(y));
    R(g, x1 - 3, y, 3, 1, P.w2);
  }
  for (let y = 0; y < vh; y += 6 + Math.round(rnd() * 4)) D.disc(g, back(y), y, 2 + Math.round(rnd() * 2), P.w3);
  return { a: c };
}

/** Valparaíso: stacked colorful houses on a hill (vw × vh + E), roofs at the top. */
function telonValpo(vw: number, vh: number): Telon {
  const H = vh + E;
  const [c, g] = lienzo(vw, H);
  const rnd = rng(37);
  const muros = ['#ffd84a', '#ff8ab4', '#3cc8b4', '#5a9aff', '#ff6a5a', '#b48af0', '#ff9a3c', '#8ade6a', '#fff4e0', '#4ad0f0'];
  const techos = ['#a02a4a', '#7a6a8a', '#c8503a', '#5a6488', '#8a4a1e'];
  R(g, 0, E, vw, vh, '#3a2e5a');
  const rowH = 26;
  // Rows from the back (top) to the front (bottom): each covers the foot of the one above.
  for (let row = 0, y = 14; y < H + rowH; row++, y += rowH - 4) {
    for (let x = -Math.round(rnd() * 16); x < vw; ) {
      const w = 16 + Math.round(rnd() * 16);
      const h = rowH + 6 + Math.round(rnd() * 8);
      const top = y + Math.round(rnd() * 6) - (row === 0 ? 6 : 0);
      const muro = muros[Math.floor(rnd() * muros.length)];
      const techo = techos[Math.floor(rnd() * techos.length)];
      const ink = D.tone(muro, -0.55);
      // Wall with an outline and a lit left side.
      R(g, x - 1, top - 1, w + 2, h + 2, ink);
      R(g, x, top, w, h, muro);
      R(g, x, top, 2, h, D.tone(muro, 0.35));
      R(g, x + w - 2, top, 2, h, D.tone(muro, -0.15));
      // Roof: a flat slab or a little gable, with corrugated stripes.
      if (rnd() < 0.55) {
        const rh = 4 + Math.round(rnd() * 3);
        for (let i = 0; i < rh; i++) R(g, x - 2 + i, top - rh + i, w + 4 - 2 * i, 1, i === 0 ? D.tone(techo, -0.4) : techo);
        for (let i = 2; i < w; i += 3) R(g, x + i, top - rh + 2, 1, rh - 2, D.tone(techo, 0.25));
      } else {
        R(g, x - 2, top - 3, w + 4, 3, techo);
        R(g, x - 2, top - 3, w + 4, 1, D.tone(techo, 0.3));
      }
      // Windows in a grid; some lit warm.
      for (let wy = top + 5; wy < top + rowH - 8; wy += 8) {
        for (let wx = x + 4; wx < x + w - 5; wx += 7) {
          const lit = rnd() < 0.25;
          R(g, wx, wy, 3, 4, lit ? '#fff0a0' : '#24206a');
          if (!lit) R(g, wx, wy, 1, 1, '#8ccaf8');
        }
      }
      x += w + (rnd() < 0.2 ? 2 : 0);
    }
  }
  return { a: c };
}

/** Storm: a left and a right half of dark rolling clouds; each edge bulges toward the middle. */
function telonTormenta(vw: number, vh: number): Telon {
  const half = Math.ceil(vw / 2);
  const W = half + E;
  const mk = (seed: number, flip: boolean) => {
    const [c, g] = lienzo(W, vh);
    const rnd = rng(seed);
    const x0 = flip ? E : 0;
    bandas(g, x0, 0, half, vh, ['#1e1a34', '#26223e', '#2e2a4a', '#363254', '#3c3860', '#423e66']);
    // Lumpy cloud masses inside.
    for (let i = 0; i < 46; i++) {
      const x = x0 + Math.round(rnd() * half), y = Math.round(rnd() * vh), r = 8 + Math.round(rnd() * 14);
      D.disc(g, x, y + 1, r, '#1a1630');
      D.disc(g, x, y, r - 1, i % 3 ? '#3c3860' : '#4a4670');
      R(g, x - Math.round(r * 0.5), y - Math.round(r * 0.6), Math.max(2, Math.round(r * 0.5)), 1, '#6a6890');
    }
    // The rolling front.
    const ex = flip ? E : W - E;
    const puffs: [number, number, number][] = [];
    for (let y = -6; y < vh + 14; y += 12 + Math.round(rnd() * 8)) {
      const r = 12 + Math.round(rnd() * 12);
      puffs.push([ex + (flip ? 1 : -1) * ((r >> 2) - Math.round(rnd() * 8)), y, r]);
    }
    R(g, flip ? E : W - E - 6, 0, 6, vh, '#3c3860');
    for (const [x, y, r] of puffs) D.disc(g, x, y, r + 1, '#14102a');
    for (const [x, y, r] of puffs) D.disc(g, x, y, r, '#3c3860');
    for (const [x, y, r] of puffs) D.disc(g, x, y - 1, r - 2, '#4e4a76');
    for (const [x, y, r] of puffs) R(g, x - Math.round(r * 0.45), y - Math.round(r * 0.65), Math.max(3, Math.round(r * 0.45)), 1, '#8a88b0');
    return c;
  };
  return { a: mk(51, false), b: mk(73, true) };
}

function telon(hacia: MapaId, vw: number, vh: number): Telon {
  const key = `${hacia}|${vw}|${vh}`;
  let t = cache.get(key);
  if (!t) {
    if (cache.size > 8) cache.clear();
    t = hacia === 'valle' ? telonValle(vw, vh) : hacia === 'oceano' ? telonOceano(vw, vh) : hacia === 'valparaiso' ? telonValpo(vw, vh) : telonTormenta(vw, vh);
    cache.set(key, t);
  }
  return t;
}

/** Paints the curtains for a destination ahead of time (e.g. when the trip starts). */
export function precalentarTransicion(hacia: MapaId, vw: number, vh: number) {
  telon(hacia, vw, vh);
}

/* ── Per-frame layers ────────────────────────────────────────────────────── */

const STREAK_COL: Record<MapaId, string[]> = {
  valle: [P.white, '#ffe0b0', '#ffb4a0'],
  oceano: [P.white, P.w3, P.w2],
  valparaiso: [P.white, '#ffe890', '#ffb4d8'],
  tormenta: [P.white, '#b8b4e0', '#8a88b0'],
};

/** Speed streaks racing to the left; `k` (0..1) sets how many and how bright. */
function estelas(g: Ctx, vw: number, vh: number, k: number, t: number, cols: string[]) {
  if (k <= 0) return;
  const n = Math.round(46 * k);
  g.globalAlpha = 0.35 + 0.55 * k;
  for (let i = 0; i < n; i++) {
    const y = Math.round(hash(i * 3 + 1) * vh);
    const len = 10 + Math.round(hash(i * 3 + 2) * 50 * (0.4 + k));
    const v = 380 + hash(i * 3 + 3) * 520;
    const span = vw + len + 20;
    const x = Math.round(vw + 10 - ((t * v + hash(i + 77) * span) % span));
    R(g, x, y, len, 1, cols[i % cols.length]);
    if (i % 5 === 0) R(g, x, y, 3, 1, P.white);
  }
  g.globalAlpha = 1;
}

/** A gull: two flapping wings, seen from the side, flying left. */
function gaviota(g: Ctx, x: number, y: number, flap: number) {
  x = Math.round(x);
  y = Math.round(y);
  const up = flap & 1;
  R(g, x, y, 4, 2, P.white);
  R(g, x - 1, y, 1, 1, P.gold0);
  R(g, x + 4, y, 2, 1, P.metal);
  if (up) {
    R(g, x + 1, y - 2, 2, 2, P.metal);
    R(g, x + 2, y - 4, 2, 2, P.metal0);
  } else {
    R(g, x + 1, y + 2, 3, 1, P.metal);
    R(g, x + 3, y + 3, 2, 1, P.metal0);
  }
}

/** A jagged lightning bolt from the top down to `y1` around column `x`. */
function rayo(g: Ctx, x: number, y1: number, seed: number) {
  let cx = x, cy = 0;
  let i = 0;
  while (cy < y1) {
    const ny = cy + 8 + Math.round(hash(seed + i) * 10);
    const nx = cx + Math.round((hash(seed + i + 40) - 0.5) * 22);
    const steps = ny - cy;
    for (let s = 0; s < steps; s++) {
      const px = Math.round(cx + ((nx - cx) * s) / steps);
      R(g, px - 2, cy + s, 5, 1, '#8ab0ff');
      R(g, px - 1, cy + s, 3, 1, P.white);
    }
    if (hash(seed + i + 90) < 0.3) {
      // A short fork.
      for (let s = 0; s < 10; s++) R(g, nx + s, ny + s, 1, 1, '#d8e8ff');
    }
    cx = nx;
    cy = ny;
    i++;
  }
}

const QUIETO_COL: Record<MapaId, string> = { valle: '#ffb470', oceano: '#2a78c8', valparaiso: '#ff8ab4', tormenta: '#2e2a4a' };

/**
 * Draws the scene transition on top of the finished world frame (screen space).
 *
 * @param g      the game canvas context, identity transform, virtual pixels.
 * @param vw,vh  the virtual screen size.
 * @param fase   0 → 1 during the trip (1 - transT / TRANS_T), 1 → 2 on arrival
 *               (2 - flashMap). At 1 the screen is fully covered. ≤ 0 or ≥ 2 draws nothing.
 * @param desde  the map being left (only tints nothing yet; kept for symmetry / future use).
 * @param hacia  the destination map: picks the curtain. Pass the same value on both halves.
 * @param t      a running time in seconds (s.t), for animation.
 * @param quieto reduced motion: a plain fade through the destination's color.
 */
export function dibujarTransicion(g: Ctx, vw: number, vh: number, fase: number, desde: MapaId, hacia: MapaId, t: number, quieto: boolean): void {
  void desde;
  if (!(fase > 0 && fase < 2)) return;
  const cubre = coberturaTransicion(fase);

  if (quieto) {
    if (cubre <= 0) return;
    g.globalAlpha = cubre;
    g.fillStyle = QUIETO_COL[hacia];
    g.fillRect(0, 0, vw, vh);
    g.globalAlpha = 1;
    return;
  }

  // Speed streaks: in with the nitro, out shortly after arrival.
  const k = fase <= 1 ? ss(0.22, 0.6, fase) : 1 - ss(1.05, 1.4, fase);
  estelas(g, vw, vh, k, t, STREAK_COL[hacia]);

  const cerrando = fase <= 1;
  const sale = cerrando ? 0 : ss(1.08, 1.85, fase);
  const tl = telon(hacia, vw, vh);

  if (hacia === 'valle' || hacia === 'oceano') {
    // Sweeps in from the right; on arrival keeps going and leaves to the left.
    const x = cerrando ? Math.round(vw - cubre * (vw + E)) : Math.round(-E - sale * (vw + E));
    // Outriders ahead of the front: loose puffs or spray, faster than the curtain.
    if (cerrando && fase > 0.45) {
      const a = ss(0.45, 0.7, fase);
      for (let i = 0; i < 7; i++) {
        const sp = 1.6 + hash(i + 5) * 1.4;
        const ox = Math.round(vw + 30 - ((fase - 0.45) / 0.55) * sp * (vw + 60) + hash(i + 9) * 60);
        const oy = Math.round(hash(i + 13) * (vh - 20)) + 6;
        if (ox < x - 4 && ox > -60) {
          if (hacia === 'valle') {
            const cl = D.cloud(200 + i, 28 + (i % 3) * 8, '#ffc0a0', '#fff0d0', '#b04a78');
            g.globalAlpha = a;
            g.drawImage(cl, ox, oy);
            g.globalAlpha = 1;
          } else {
            for (let j = 0; j < 4; j++) R(g, ox + j * 5 + (j & 1), oy + ((j * 3) % 5), 2, 2, j & 1 ? P.w3 : P.white);
          }
        }
      }
    }
    g.drawImage(tl.a, x, 0);
    if (hacia === 'oceano') {
      // Glints sliding over the water.
      for (let i = 0; i < 14; i++) {
        const gx = x + E + Math.round(((hash(i) * vw + t * 40 * (1 + (i & 3))) % vw));
        const gy = Math.round(hash(i + 30) * vh);
        if (gx > x + E && gx < x + E + vw && Math.floor(t * 6 + i) % 3 !== 0) R(g, gx, gy, 3, 1, P.white);
      }
    }
  } else if (hacia === 'valparaiso') {
    // The hill of houses rises from below, then sinks back down on arrival.
    const y = cerrando ? Math.round(vh - cubre * (vh + E)) : Math.round(-E + sale * (vh + E));
    g.drawImage(tl.a, 0, y);
    // Gulls crossing over the houses.
    const ga = fase > 0.55 && fase < 1.7;
    if (ga) {
      for (let i = 0; i < 9; i++) {
        const sp = 70 + hash(i + 3) * 60;
        const gx = vw + 20 - ((t * sp + hash(i) * (vw + 40)) % (vw + 40));
        const gy = Math.max(y - 30, 4) + hash(i + 20) * Math.min(vh * 0.6, vh - Math.max(y - 30, 4) - 8) + Math.sin(t * 2 + i) * 3;
        gaviota(g, gx, gy, Math.floor(t * 8 + i * 3));
      }
    }
  } else {
    // Storm: two cloud banks close like doors, then part.
    const half = Math.ceil(vw / 2);
    const open = cerrando ? 1 - cubre : sale;
    const d = Math.round(open * (half + E + 4));
    // The left bank's solid body ends at half; its puffy edge pokes past it.
    g.drawImage(tl.a, -d, 0);
    g.drawImage(tl.b!, vw - half - E + d, 0);
    // Rain over the clouds.
    const ra = cerrando ? ss(0.5, 0.8, fase) : 1 - ss(1.3, 1.8, fase);
    if (ra > 0) {
      const n = Math.round(70 * ra);
      for (let i = 0; i < n; i++) {
        const sp = 260 + hash(i + 7) * 120;
        const rx = Math.round((hash(i) * (vw + 60) - ((t * sp * 0.4) % (vw + 60)) + vw + 60) % (vw + 60)) - 30;
        const ry = Math.round((hash(i + 50) * vh + t * sp) % (vh + 10)) - 5;
        R(g, rx, ry, 1, 4, i % 3 ? '#8a9ad8' : '#c8d8ff');
        R(g, rx - 1, ry + 4, 1, 2, '#6a7ab8');
      }
    }
    // Lightning as the banks meet: a bolt down the seam and a white flash.
    const fl = 1 - Math.abs(fase - 1.0) / 0.07;
    if (fl > 0) {
      g.globalAlpha = Math.min(1, fl * 1.4) * 0.7;
      g.fillStyle = '#eef0ff';
      g.fillRect(0, 0, vw, vh);
      g.globalAlpha = 1;
      rayo(g, half + Math.round((hash(Math.floor(t)) - 0.5) * 30), Math.round(vh * 0.85), 1234);
    }
  }
}
