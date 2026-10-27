import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { DECO_H, DIRT, R, paintPantry } from './dibujo';
import { escribir } from './fondo';

/*
 * The ocean map's foreground: the sea strip (island, water body, seabed),
 * the wave crests along the surface and water splashes. Same "dulce" look as
 * the land: pastel colors, inked edges, no anti-aliasing.
 */

type Ctx = CanvasRenderingContext2D;

/** Sea level, in world px above altitude 0 (world y up). */
export const NIVEL_MAR = 18;

/** Fill for anything below the strip (altitude < -DIRT): the deep seabed. */
export const COLOR_LECHO = '#c4a672';
const LECHO = '#d6be88';

const hash = (x: number, s = 0) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(s | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

// Water from the surface down, and the same bands lit by a sun ray.
const AGUA = ['#9ee2ff', '#74ccf8', '#5ab4ee', '#4a9ce2', '#3e86d4', '#3672c4'];
const RAYO = ['#c4f0ff', '#9adcfc', '#7ec6f4', '#6cb0ea', '#5c9ade', '#5084d2'];
// Sand above water, and sand seen through the water (deeper = bluer).
const ARENA_BAJO = ['#dcd4a0', '#bccaae', '#a0bec0', '#8ab0cc'];

/** World x where the open sea starts (end of the island), set by aguaStrip. */
let orillaX = 0;

/**
 * The whole level's sea as one strip, painted once: the little island at the
 * left with the pantry and a palm tree, layered water with light rays, and a
 * sandy seabed with weeds and shells. Row 0 is altitude `top`; the bottom
 * row is -DIRT (same contract as groundStrip).
 */
export function aguaStrip(length: number, heightAt: (x: number) => number, pantry: { x0: number; x1: number }) {
  let top = 0;
  for (let x = 0; x < length; x++) top = Math.max(top, heightAt(x));
  top = Math.ceil(top) + DECO_H;
  const c = document.createElement('canvas');
  c.width = length;
  c.height = top + DIRT;
  const g = c.getContext('2d')!;
  const rowOf = (alt: number) => top - alt;
  const sea = rowOf(NIVEL_MAR);

  // Island heights, and an underwater slope that runs off its shore.
  const hs = new Float32Array(length);
  const slope = new Float32Array(length).fill(-1e9);
  orillaX = 0;
  for (let x = 0; x < length; x++) {
    hs[x] = Math.round(heightAt(x));
    if (hs[x] > NIVEL_MAR) {
      slope[x] = hs[x];
      orillaX = x + 1;
    }
  }
  for (let x = 1; x < length; x++) slope[x] = Math.max(slope[x], slope[x - 1] - 0.7);
  for (let x = length - 2; x >= 0; x--) slope[x] = Math.max(slope[x], slope[x + 1] - 0.7);
  const bed = (x: number) => -DIRT + 6 + Math.round(1.5 * Math.sin(x * 0.045) + Math.sin(x * 0.13 + 1));

  for (let x = 0; x < length; x++) {
    const land = hs[x] > NIVEL_MAR;
    const sand = Math.max(bed(x), Math.round(land ? hs[x] : Math.min(NIVEL_MAR - 1, slope[x])));
    const ySand = rowOf(sand);
    // Water: bands of blue getting deeper, with slanted light rays.
    if (!land)
      for (let y = sea; y < ySand; y++) {
        const d = y - sea;
        const band = Math.min(5, Math.floor(d / 6));
        const edge = d % 6 === 0 && band > 0 && (x + y) % 2 === 0;
        const b = edge ? band - 1 : band;
        const ray = (x + d * 0.6) % 52 < 7 - d * 0.15 && d > 1 && (x + y) % 3 !== 0;
        R(g, x, y, 1, 1, (ray ? RAYO : AGUA)[b]);
      }
    // Sand: dry on the island, then through the water and down to the seabed.
    for (let y = ySand; y < c.height; y++) {
      const alt = top - y;
      if (alt > NIVEL_MAR) R(g, x, y, 1, 1, P.a1);
      else {
        const k = Math.min(3, Math.floor((NIVEL_MAR - alt) / 9));
        const near = y - ySand < 2 && !land;
        R(g, x, y, 1, 1, near ? (k < 2 ? P.a2 : '#d8d0a8') : alt < bed(x) - 1 ? LECHO : ARENA_BAJO[k]);
      }
    }
    // Outline along the sand's top, joined where it steps.
    const nx = Math.min(length - 1, x + 1);
    const sandN = Math.max(bed(nx), Math.round(hs[nx] > NIVEL_MAR ? hs[nx] : Math.min(NIVEL_MAR - 1, slope[nx])));
    R(g, x, Math.min(ySand, rowOf(sandN)) - 1, 1, Math.abs(sandN - sand) + 1, land ? P.a0 : '#9a8a6a');
    if (land) {
      // Grass on the high ground, a pale beach near the water.
      if (hs[x] - NIVEL_MAR > 6) {
        const scal = 4 + (x % 8 < 4 ? 1 : x % 8 === 4 || x % 8 === 7 ? 0 : -1);
        R(g, x, ySand, 1, scal + 1, P.g0);
        R(g, x, ySand, 1, scal, P.g1);
        R(g, x, ySand + 1, 1, 2, P.g2);
        if (x % 6 === 2) R(g, x, ySand + 1, 1, 1, P.g3);
        R(g, x, Math.min(ySand, rowOf(sandN)) - 1, 1, Math.abs(sandN - sand) + 1, P.g0);
      } else R(g, x, ySand, 1, 1, P.a3);
      // Wet sand at the waterline.
      R(g, x, sea, 1, 2, P.a0);
    } else R(g, x, sea, 1, 1, P.w3);
  }

  // Polka dots in the dry sand (like the land's dirt), little stones under water.
  for (let gy = 0; gy < c.height; gy += 7)
    for (let gx = (gy / 7) % 2 ? 3 : 0; gx < length; gx += 7) {
      const alt = top - gy;
      if (gx < orillaX && alt < hs[gx] - 6 && alt > NIVEL_MAR + 2) {
        R(g, gx, gy, 2, 2, P.a2);
        R(g, gx, gy, 1, 1, P.white);
      } else if (alt < bed(gx) - 2 && hash(gx, gy) % 3 === 0) R(g, gx, gy, 2, 1, gy % 2 ? P.a2 : COLOR_LECHO);
    }

  // The seabed: weeds, shells, starfish and a few pebbles.
  for (let x = orillaX + 12; x < length - 6; x += 9 + (hash(x, 1) % 34)) {
    const y = rowOf(bed(x)) - 1;
    const kind = hash(x, 2) % 9;
    if (kind < 4) {
      // Seaweed: a wavy strand or two.
      const n = 1 + (kind % 2);
      for (let j = 0; j < n; j++) {
        const hgt = 6 + (hash(x, 3 + j) % 9);
        const col = j ? [P.n0, P.n2] : [P.g0, P.n1];
        for (let i = 0; i < hgt; i++) {
          const sx = x + j * 3 + Math.round(Math.sin(i * 0.7 + x) * 1.2);
          R(g, sx - 1, y - i, 3, 1, col[0]);
          R(g, sx, y - i, 1, 1, col[1]);
        }
      }
    } else if (kind < 6) {
      // Starfish.
      const col = kind === 4 ? P.p1 : P.o2;
      R(g, x - 2, y - 1, 5, 1, col);
      R(g, x, y - 3, 1, 3, col);
      R(g, x - 1, y, 1, 1, col);
      R(g, x + 1, y, 1, 1, col);
      R(g, x, y - 1, 1, 1, P.white);
    } else if (kind < 8) {
      // A scallop shell.
      D.oval(g, x, y - 1, 3, 1, P.p0);
      D.oval(g, x, y - 1, 2, 1, P.p2);
      R(g, x - 1, y - 2, 1, 2, P.p0);
      R(g, x + 1, y - 2, 1, 2, P.p0);
    } else {
      D.disc(g, x, y, 2, P.s0);
      D.disc(g, x, y, 1, P.s1);
      R(g, x - 1, y - 1, 1, 1, P.s3);
    }
  }
  // Bubbles here and there.
  for (let x = orillaX + 20; x < length; x += 40 + (hash(x, 9) % 60)) {
    const y = sea + 6 + (hash(x, 10) % 18);
    if (y < rowOf(bed(x)) - 3) {
      R(g, x, y, 2, 2, P.w3);
      R(g, x + 2, y - 4, 1, 1, P.w3);
    }
  }

  // Buoys out at sea: one says «BOYA», a gull rests on the other.
  for (const [x, gaviota] of [[700, false], [2300, true]] as const) if (x + 20 < length) boya(g, x, sea, gaviota);

  // Island: the pantry, a palm tree and a crab.
  if (orillaX > 0) {
    paintPantry(g, pantry.x0, rowOf(Math.round(heightAt(pantry.x0 + 30))) + 1);
    const px = Math.max(pantry.x0 + 84, Math.min(orillaX - 22, pantry.x0 + 100));
    if (px < orillaX - 4) palm(g, px, rowOf(hs[px]) + 1);
    const cx = orillaX - 7;
    if (cx > px + 6) crab(g, cx, rowOf(hs[cx]) + 1);
  }
  return { canvas: c, top };
}

/** A red-and-white buoy floating at the surface row `y`, maybe with a gull on top. */
function boya(g: Ctx, x: number, y: number, gaviota: boolean) {
  R(g, x - 1, y - 9, 20, 11, INK);
  R(g, x, y - 8, 18, 9, '#e05a5a');
  R(g, x, y - 8, 18, 1, '#ff8a8a');
  R(g, x, y + 1, 18, 1, '#a03a3a');
  escribir(g, 'BOYA', x + 2, y - 6, P.white);
  R(g, x + 7, y - 15, 4, 6, INK);
  R(g, x + 8, y - 14, 2, 4, P.metal);
  R(g, x + 8, y - 17, 2, 2, P.gold);
  if (gaviota) {
    R(g, x + 12, y - 12, 5, 3, P.white);
    R(g, x + 12, y - 12, 4, 1, '#9aa6c8');
    R(g, x + 15, y - 14, 2, 2, P.white);
    R(g, x + 17, y - 13, 1, 1, '#ffb43a');
    R(g, x + 13, y - 9, 1, 1, '#ffb43a');
  }
}

/** A palm tree leaning right; (x, y) is the foot of the trunk. */
function palm(g: Ctx, x: number, y: number) {
  const H = 26;
  for (let i = 0; i < H; i++) {
    const tx = x + Math.round((i * i) / 90);
    R(g, tx - 2, y - i, 4, 1, P.k0);
    R(g, tx - 1, y - i, 2, 1, i % 4 === 0 ? P.k3 : P.k1);
  }
  const hx = x + Math.round((H * H) / 90);
  const hy = y - H;
  // Fronds: drooping arcs to both sides, inked then filled.
  const frond = (dir: number, len: number, droop: number, col: string, dy: number) => {
    for (let i = 0; i < len; i++) {
      const fx = hx + dir * i;
      const fy = hy + dy + Math.round((i * i * droop) / len);
      R(g, fx, fy, 1, 2, col);
    }
  };
  for (const [dir, len, droop, dy] of [[-1, 14, 0.6, -2], [1, 14, 0.6, -2], [-1, 10, 1.1, 0], [1, 11, 1.0, 0], [1, 7, -0.4, -3]] as const) {
    frond(dir, len, droop, P.g0, dy + 1);
    frond(dir, len - 1, droop, dy < -1 ? P.g2 : P.g1, dy);
  }
  // Coconuts.
  D.disc(g, hx - 1, hy + 2, 1, P.k0);
  D.disc(g, hx + 2, hy + 2, 1, P.k0);
  R(g, hx - 1, hy + 1, 1, 1, P.k2);
}

/** A little red crab on the beach, claws up. */
function crab(g: Ctx, x: number, y: number) {
  D.oval(g, x, y - 2, 3, 1, P.r0);
  R(g, x - 2, y - 3, 5, 1, P.r2);
  R(g, x - 4, y - 5, 2, 2, P.r1);
  R(g, x + 3, y - 5, 2, 2, P.r1);
  R(g, x - 1, y - 4, 1, 1, P.eye);
  R(g, x + 1, y - 4, 1, 1, P.eye);
  R(g, x - 3, y - 1, 1, 1, P.r0);
  R(g, x + 3, y - 1, 1, 1, P.r0);
}

/* ── Per frame ───────────────────────────────────────────────────────────── */

const INK = '#3a6ab8';
const CREST_P = 28;

/** Wave colours per ambiente: [body, curl, ink, glint]. Night water never glows cyan. */
const OLAS: Record<'dia' | 'tarde' | 'noche', [string, string, string, string]> = {
  dia: ['#9ee2ff', '#ffffff', INK, '#bdf0ff'],
  tarde: ['#b8c8ea', '#fff4e8', '#5a6aa8', '#ffe8c8'],
  noche: ['#4a5a98', '#a8b0d8', '#2a3270', '#7080b8'],
};

/** Veil over the water body per ambiente: [colour, alpha, surface sheen, its alpha]. */
const VELO_AGUA: Record<'dia' | 'tarde' | 'noche', [string, number, string, number] | null> = {
  dia: null,
  tarde: ['#f08a6a', 0.3, '#ffd2a0', 0.35],
  noche: ['#1a1650', 0.42, '#6a5aa8', 0.25],
};

/**
 * Wave crests and foam along the sea surface (screen row `ySuperficie`),
 * scrolling with the camera and rolling slowly left. Skips the island.
 */
export function dibujarOlas(g: Ctx, camX: number, ySuperficie: number, vw: number, t: number, quieto: boolean, ambiente: 'dia' | 'tarde' | 'noche' = 'dia') {
  const tt = quieto ? 0 : t;
  const [cuerpo, rizo, tinta, brillo] = OLAS[ambiente];
  const y = Math.round(ySuperficie);
  const roll = tt * 7;
  // The water body is painted once in daylight colours: a veil warms it at
  // dusk and darkens it at night, from the surface down to the seabed.
  const velo = VELO_AGUA[ambiente];
  if (velo) {
    const x0 = Math.max(0, Math.round(orillaX - camX));
    if (x0 < vw) {
      g.globalAlpha = velo[1];
      g.fillStyle = velo[0];
      g.fillRect(x0, y, vw - x0, NIVEL_MAR + DIRT + 1);
      if (velo[2]) {
        g.globalAlpha = velo[3];
        g.fillStyle = velo[2];
        g.fillRect(x0, y, vw - x0, 4);
      }
      g.globalAlpha = 1;
    }
  }
  const i0 = Math.floor((camX + roll - 20) / CREST_P);
  const i1 = Math.ceil((camX + roll + vw + 20) / CREST_P);
  for (let i = i0; i <= i1; i++) {
    const h = hash(i, 77);
    const wx = i * CREST_P + (h % 9) - roll;
    if (wx < orillaX + 8) continue;
    const x = Math.round(wx - camX);
    const big = h % 3 === 0;
    const bob = Math.round(Math.sin(tt * 2.2 + i * 1.7) * 0.6 + 0.4);
    const top = y - (big ? 3 : 2) + bob;
    // A rounded hump with a white curl on top and an ink line on its back.
    const w = big ? 7 : 5;
    R(g, x - w, y - 1 + bob, w * 2 + 1, 1 - bob + 1, cuerpo);
    R(g, x - w + 2, top + 1, w * 2 - 3, y - top - 1, cuerpo);
    R(g, x - w + 3, top, w, 1, rizo);
    R(g, x - w + 2, top + 1, 2, 1, rizo);
    R(g, x + 2, top, w - 4, 1, tinta);
    R(g, x + w - 2, top + 1, 2, 1, tinta);
    R(g, x + w, y - 1 + bob, 1, 1, tinta);
    if (big) R(g, x - w + 4, top - 1, 2, 1, rizo);
  }
  // Glints just under the surface, drifting the other way.
  g.fillStyle = brillo;
  const j0 = Math.floor((camX - tt * 4) / 23);
  for (let j = j0; j <= j0 + Math.ceil(vw / 23) + 1; j++) {
    const h = hash(j, 31);
    const wx = j * 23 + (h % 11) + tt * 4;
    if (wx < orillaX + 4) continue;
    if (!quieto && Math.floor(tt * 2 + (h % 7)) % 4 === 0) continue;
    g.fillRect(Math.round(wx - camX), y + 3 + (h % 5), 2 + (h % 3), 1);
  }
  // Foam lapping on the island's shore.
  const sx = Math.round(orillaX - camX);
  if (orillaX > 0 && sx > -10 && sx < vw + 10) {
    const k = Math.round(Math.sin(tt * 2.5) * 2);
    R(g, sx - 3 + k, y - 1, 6, 1, rizo);
    R(g, sx + 1 + k, y - 2, 3, 1, brillo);
    R(g, sx + 4 + k, y - 1, 1, 1, tinta);
  }
}

/**
 * A splash where something hits the water: a column that shoots up and falls
 * back, drops flying out and a foam ring. (x, y) is the surface point on
 * screen; `k` is the life left, 1 fresh → 0 gone.
 */
export function dibujarSalpicadura(g: Ctx, x: number, y: number, k: number) {
  if (k <= 0) return;
  const u = Math.min(1, 1 - k);
  const X = Math.round(x);
  const Y = Math.round(y);
  g.globalAlpha = k < 0.3 ? Math.ceil((k / 0.3) * 3) / 3 : 1;
  // Column: rises fast, then sinks back.
  const H = Math.round(24 * Math.sin(Math.min(1, u * 1.8) * Math.PI * 0.5) * (1 - Math.max(0, u - 0.45) / 0.55));
  if (H > 1) {
    const w = H > 12 ? 2 : 1;
    R(g, X - w - 1, Y - H, w * 2 + 3, H, INK);
    R(g, X - w, Y - H, w * 2 + 1, H, P.w3);
    R(g, X, Y - H + 1, 1, H - 2, P.white);
    D.disc(g, X, Y - H, w + 2, INK);
    D.disc(g, X, Y - H, w + 1, P.white);
  }
  // Drops on little arcs.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const v = 0.6 + (i >> 1) * 0.35;
    const dx = Math.round(side * (4 + i * 2.2) * u * 1.6);
    const dy = Math.round(-30 * v * u + 38 * u * u);
    if (dy > 0) continue;
    R(g, X + dx - 1, Y + dy, 3, 2, INK);
    R(g, X + dx, Y + dy, 1, 1, P.white);
  }
  // Foam ring spreading on the surface.
  const r = Math.round(4 + u * 12);
  D.oval(g, X, Y, r + 1, 2, INK);
  D.oval(g, X, Y, r, 1, P.w3);
  R(g, X - r + 2, Y - 1, Math.max(1, r - 2), 1, P.white);
  g.globalAlpha = 1;
}

/* ── The magic sea: bioluminescence and whales (storm map, once it clears) ── */

const mod = (a: number, n: number) => ((a % n) + n) % n;
const BIO = ['#2ad8f0', '#7af4ff', '#c8fff8', '#5ab8ff'];
const ESPUMA = '#e8fff8';
const RIM = '#5af0ff';
const HALO = 'rgba(58,216,240,0.2)';

type Cv = HTMLCanvasElement;
/** A sprite and, per column, the first opaque row (-1 = empty column): used for the foam where it cuts the surface. */
type Spr = { c: Cv; top: Int16Array; bot: Int16Array };
/** A whale sprite plus where its blowhole is (sprite px). */
type Ballena = Spr & { soplo: [number, number] };

type Sprites = {
  glow: Cv;
  madre: Ballena[]; // swimming frames (tail up / level / down)
  cria: Ballena[];
  brecha: Spr[]; // the mother, pixel-rotated for the breach (nose up → nose down)
  colaAlta: Spr; // the fluke lifted out of the water as she dives, seen from behind
  delfin: Spr[]; // a dolphin at a few tilts for the arc
  gaviota: Cv[]; // a resting gull: facing right, left, and with its head tucked
};
let SPR: Sprites | null = null;

function lienzo(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return [c, g] as const;
}

/**
 * Paints a grid of colours (null = empty) into a sprite: a 1 px rim around the
 * shape and, outside that, a softer dithered halo (the bioluminescent edge).
 */
function grillaASprite(cols: (string | null)[], W: number, H: number, rim: string, halo: string | null): Spr {
  const [c, g] = lienzo(W, H);
  const lleno = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && cols[y * W + x] !== null;
  const borde = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!lleno(x, y) && (lleno(x - 1, y) || lleno(x + 1, y) || lleno(x, y - 1) || lleno(x, y + 1))) borde[y * W + x] = 1;
  const esBorde = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && borde[y * W + x] === 1;
  if (halo) {
    g.fillStyle = halo;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (!lleno(x, y) && !borde[y * W + x] && (esBorde(x - 1, y) || esBorde(x + 1, y) || esBorde(x, y - 1) || esBorde(x, y + 1)))
          g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = rim;
  for (let i = 0; i < W * H; i++) if (borde[i]) g.fillRect(i % W, (i / W) | 0, 1, 1);
  for (let i = 0; i < W * H; i++) {
    const col = cols[i];
    if (col === null) continue;
    g.fillStyle = col;
    g.fillRect(i % W, (i / W) | 0, 1, 1);
  }
  const top = new Int16Array(W).fill(-1);
  const bot = new Int16Array(W).fill(-1);
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      if (lleno(x, y) || borde[y * W + x]) {
        if (top[x] < 0) top[x] = y;
        bot[x] = y;
      }
  return { c, top, bot };
}

/** Rotates a pixel sprite by `ang` with nearest-neighbour sampling (crisp, no smoothing), centred in a square. */
function rotarPx(src: Cv, ang: number): Cv {
  const W = src.width, H = src.height;
  const S = Math.ceil(Math.hypot(W, H)) + 2;
  const sd = src.getContext('2d')!.getImageData(0, 0, W, H).data;
  const [c, g] = lienzo(S, S);
  const out = g.createImageData(S, S);
  const co = Math.cos(ang), si = Math.sin(ang);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - S / 2 + 0.5, dy = y - S / 2 + 0.5;
      const sx = Math.floor(co * dx + si * dy + W / 2);
      const sy = Math.floor(-si * dx + co * dy + H / 2);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const i = (sy * W + sx) * 4, o = (y * S + x) * 4;
      out.data[o] = sd[i];
      out.data[o + 1] = sd[i + 1];
      out.data[o + 2] = sd[i + 2];
      out.data[o + 3] = sd[i + 3];
    }
  g.putImageData(out, 0, 0);
  return c;
}

/**
 * A humpback facing right: knobbly head, long white pectoral fin, throat
 * grooves, a little dorsal hump, barnacle speckles, a forked fluke and a
 * glowing rim. `s` scales it (the calf is smaller, rounder and clean),
 * `flex` bends the tail stock (-1 up … 1 down) for a gentle swimming beat.
 */
function pintarJorobada(s: number, flex: number, cria: boolean): Ballena {
  const L = Math.round(62 * s); // tail stock → snout
  const F = Math.round(14 * s); // fluke reach behind the tail stock
  const T = 7 * s * (cria ? 1.18 : 1);
  const W = L + F + 8;
  const H = Math.round(32 * s) + 8;
  const X0 = F + 4;
  const cy = Math.round(13 * s) + 4;
  const C = cria
    ? { lomo: '#33408c', lado: '#4254a6', bajo: '#5668ba', vientre: '#c0ceef', surco: '#8a9cd6', brillo: '#6a86de', aleta: '#e6eeff', aletaS: '#acbce4', nodo: '#9aaade' }
    : { lomo: '#212a62', lado: '#2e3a88', bajo: '#3e4ea2', vientre: '#a6b8e4', surco: '#6a7ec4', brillo: '#4c68cc', aleta: '#d6e2fa', aletaS: '#93a6d8', nodo: '#8a9cd2' };
  const cols: (string | null)[] = new Array(W * H).fill(null);
  const set = (x: number, y: number, col: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 2 && y >= 2 && x < W - 2 && y < H - 2) cols[y * W + x] = col;
  };
  // Tail-stock bend: nothing at the front, growing towards the fluke.
  const curva = (x: number) => {
    const d = (X0 + L * 0.32 - x) / (L * 0.32 + F);
    return d > 0 ? flex * d * d * 3.2 * s : 0;
  };
  const ht = (u: number) => (u < 0.62 ? 1.4 + (T - 1.4) * Math.pow(Math.sin((u / 0.62) * Math.PI * 0.5), 1.3) : T - T * 0.55 * ((u - 0.62) / 0.38) ** 2);
  const Tb = T * 1.1;
  const hb = (u: number) => (u < 0.55 ? 1.4 + (Tb - 1.4) * Math.pow(Math.sin((u / 0.55) * Math.PI * 0.5), 1.2) : Tb - Tb * 0.6 * ((u - 0.55) / 0.45) ** 1.5);
  const tops: number[] = [];
  const bots: number[] = [];
  // Body.
  for (let x = X0; x <= X0 + L; x++) {
    const u = (x - X0) / L;
    const b = curva(x);
    const top = Math.round(cy - ht(u) + b);
    const bot = Math.round(cy + hb(u) + b);
    tops[x] = top;
    bots[x] = bot;
    for (let y = top; y <= bot; y++) {
      const f = (y - top) / Math.max(1, bot - top);
      let col = f < 0.22 ? C.lomo : f < 0.58 ? C.lado : C.bajo;
      // Throat grooves: pale pleats from the chin back to the belly.
      if (f >= 0.64 && u > 0.4 + (1 - f) * 0.35) col = (bot - y) % 2 === 0 ? C.vientre : C.surco;
      set(x, y, col);
    }
    if (u > 0.1 && u < 0.78) set(x, top + 1, C.brillo);
  }
  // Mouth line, curving down towards the back of the jaw.
  for (let x = X0 + Math.round(L * 0.8); x <= X0 + L - 1; x++) {
    const u = (x - X0) / L;
    set(x, cy + 1 + Math.round(Math.pow((1 - u) / 0.2, 1.4) * 2 * s), '#121848');
  }
  // Eye just above the corner of the mouth, with a moonlit catchlight.
  const ex = X0 + Math.round(L * 0.79);
  set(ex, cy + 1, '#0c1030');
  if (!cria) set(ex - 1, cy + 1, '#0c1030');
  set(ex, cy, '#e8f0ff');
  set(ex - 1, cy - 1, C.lado);
  // Knobs (tubercles) along the head and the chin.
  for (let x = X0 + Math.round(L * 0.74); x < X0 + L - 1; x += cria ? 4 : 3) {
    set(x, tops[x] - 1, C.lado);
    set(x, tops[x], C.nodo);
  }
  for (let x = X0 + Math.round(L * 0.9); x < X0 + L; x += 2) set(x, bots[x], C.nodo);
  // The small dorsal fin on its hump, swept back.
  const dx = X0 + Math.round(L * 0.3);
  const fin = cria ? [1, 2, 1, 1] : [2, 3, 2, 2, 1, 1];
  for (let i = 0; i < fin.length; i++) for (let k = 1; k <= fin[i]; k++) set(dx + i - 1, tops[dx + i - 1] - k, C.lomo);
  // Barnacles: pale speckle clusters on the chin, the head and the back.
  if (!cria) {
    const perc: [number, number][] = [[0.94, 0.72], [0.95, 0.8], [0.92, 0.84], [0.97, 0.62], [0.88, 0.9], [0.9, 0.78], [0.86, 0.12], [0.84, 0.2], [0.35, 0.12], [0.5, 0.3], [0.52, 0.34], [0.2, 0.4]];
    perc.forEach(([u, f], i) => {
      const x = X0 + Math.round(u * L);
      set(x, tops[x] + Math.round(f * (bots[x] - tops[x])), i % 3 === 0 ? '#b0bce0' : '#eef2ff');
    });
  }
  // Fluke: two lobes spreading behind the tail stock, tips hooked, pale underside, notched edge.
  for (let x = X0 - F; x <= X0 + 1; x++) {
    const d = (X0 - x) / F;
    const b = curva(x);
    const yc = Math.round(d * F * 0.46 + (d > 0.82 ? 1 : 0));
    const th = Math.max(1, Math.round((3.2 - 2.2 * d) * Math.max(0.7, s)));
    for (let k = 0; k < th; k++) {
      set(x, cy + b - yc - k + 1, k === th - 1 ? C.lomo : C.lado);
      set(x, cy + b + yc + k, k === 0 ? C.bajo : !cria && (x + k) % 4 === 0 ? C.vientre : C.bajo);
    }
    if (d > 0.4 && x % 2 === 0) {
      set(x, cy + b - yc - th, C.nodo);
      set(x, cy + b + yc + th, C.vientre);
    }
  }
  // The long pectoral fin (near side), white, angled down and back, knobbly leading edge.
  {
    const rx = X0 + L * 0.67, ry = cy + 2 * s + curva(X0 + L * 0.67);
    const lf = L * (cria ? 0.34 : 0.37);
    const dx2 = -Math.cos(0.45), dy2 = Math.sin(0.45);
    for (let i = 0; i <= lf; i++) {
      const px = rx + dx2 * i, py = ry + dy2 * i;
      const w = Math.max(0, Math.round((1 - i / lf) * 2.2 * s + 0.4));
      for (let k = -w; k <= w + 1; k++) set(px, py + k, k === -w ? C.aletaS : C.aleta);
      if (i % 3 === 1 && i > 2) set(px, py + w + 2, C.aleta);
    }
    if (!cria) {
      set(rx + dx2 * lf, ry + dy2 * lf + 1, '#8a96c8');
      set(rx + dx2 * (lf - 3), ry + dy2 * (lf - 3) + 2, '#8a96c8');
    }
  }
  const spr = grillaASprite(cols, W, H, RIM, HALO);
  const bx = X0 + Math.round(L * 0.7);
  return { ...spr, soplo: [bx, tops[bx] - 1] };
}

/** The fluke lifted out of the water as she dives, seen from behind: white underside, dark marks, notch. */
function pintarColaAlta(): Spr {
  const W = 38, H = 24, cx = 19;
  const cols: (string | null)[] = new Array(W * H).fill(null);
  const set = (x: number, y: number, col: string) => {
    if (x >= 2 && y >= 2 && x < W - 2 && y < H - 2) cols[y * W + x] = col;
  };
  for (let dx = -15; dx <= 15; dx++) {
    const a = Math.abs(dx) / 15;
    const yt = 6 - Math.round(4 * a * a) + (Math.abs(dx) < 2 ? 2 : 0);
    const yb = Math.max(yt + 1, 14 - Math.round(6 * Math.pow(a, 1.4)));
    for (let y = yt; y <= yb; y++) {
      const h = hash(dx * 31 + y, 909) % 9;
      let col = '#dae4fb';
      if (y >= yb - 1) col = '#2e3a88';
      else if (Math.abs(dx) > 3 && h < 2) col = '#3a4a96';
      else if (y === yt) col = '#ffffff';
      set(cx + dx, y, col);
    }
    // Serrated trailing edge.
    if (Math.abs(dx) % 3 === 1 && Math.abs(dx) > 2) cols[yt * W + cx + dx] = null;
  }
  for (let y = 12; y < H - 2; y++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, y, Math.abs(dx) === 2 ? '#212a62' : dx === -1 ? '#4c68cc' : '#2e3a88');
  return grillaASprite(cols, W, H, RIM, HALO);
}

/** A little dolphin facing right: beak, melon, sickle fin, pale belly, glowing rim. */
function pintarDelfin(): Cv {
  const W = 22, H = 13, cy = 6;
  const cols: (string | null)[] = new Array(W * H).fill(null);
  const set = (x: number, y: number, col: string) => {
    if (x >= 1 && y >= 1 && x < W - 1 && y < H - 1) cols[y * W + x] = col;
  };
  const arriba = [1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0];
  const abajo = [0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1];
  for (let i = 0; i < 16; i++) {
    const x = 3 + i;
    for (let y = cy - arriba[i]; y <= cy + abajo[i]; y++) {
      const belly = y > cy && i > 4 && i < 15;
      set(x, y, y <= cy - 2 ? '#3c4a8e' : belly ? '#c8d4f2' : '#5a6ab2');
    }
  }
  set(19, cy, '#5a6ab2');
  set(19, cy + 1, '#c8d4f2');
  // Sickle fin, eye with a smile, flipper, fluke.
  set(8, cy - 4, '#3c4a8e');
  set(9, cy - 4, '#3c4a8e');
  set(8, cy - 5, '#3c4a8e');
  set(7, cy - 6, '#3c4a8e');
  set(15, cy - 1, '#0c1030');
  set(15, cy - 2, '#e8f0ff');
  set(16, cy + 1, '#3c4a8e');
  set(12, cy + 3, '#5a6ab2');
  set(11, cy + 4, '#5a6ab2');
  for (let k = -3; k <= 3; k++) set(Math.abs(k) > 1 ? 2 : 3, cy + k, '#3c4a8e');
  return grillaASprite(cols, W, H, RIM, HALO).c;
}

/** A gull resting on the water, moonlit: white body, grey wing with a dark tip, a yellow beak. */
function pintarGaviota(dormida: boolean): Cv {
  const W = 13, H = 10;
  const cols: (string | null)[] = new Array(W * H).fill(null);
  const set = (x: number, y: number, col: string) => {
    if (x >= 1 && y >= 1 && x < W - 1 && y < H - 1) cols[y * W + x] = col;
  };
  for (let x = 3; x <= 9; x++) set(x, 5, '#eeeaf8');
  for (let x = 2; x <= 9; x++) set(x, 6, '#eeeaf8');
  for (let x = 3; x <= 8; x++) set(x, 7, '#cfc8e4');
  for (let x = 3; x <= 7; x++) set(x, 5, '#aaa6c8');
  for (let x = 4; x <= 7; x++) set(x, 6, '#aaa6c8');
  set(2, 5, '#3a3858');
  set(1, 5, '#3a3858');
  if (dormida) {
    // Head tucked into the back.
    set(7, 4, '#f6f4ff');
    set(8, 4, '#f6f4ff');
    set(8, 5, '#f6f4ff');
    set(7, 3, '#f6f4ff');
    set(6, 4, '#f0b040');
  } else {
    for (const [x, y] of [[8, 2], [9, 2], [8, 3], [9, 3], [9, 4], [8, 4]]) set(x, y, '#f6f4ff');
    set(9, 2, '#2a2840');
    set(10, 3, '#f0b040');
    set(11, 3, '#f0b040');
  }
  return grillaASprite(cols, W, H, '#3a3460', null).c;
}

function voltear(src: Cv): Cv {
  const [c, g] = lienzo(src.width, src.height);
  g.scale(-1, 1);
  g.drawImage(src, -src.width, 0);
  return c;
}

/** Breach tilts, nose up → nose down. */
const ANG_BRECHA = [-1.2, -0.85, -0.5, -0.17, 0.17, 0.5, 0.85, 1.2];
const ANG_DELFIN = [-0.8, -0.4, 0, 0.4, 0.8];

function sprites(): Sprites {
  if (SPR) return SPR;
  // A tiling band of dithered glow just under the surface.
  const [glow, gg] = lienzo(128, 10);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 128; x++) {
      const h = hash(x, y + 40);
      const k = (1 - y / 10) * 0.75;
      if ((h % 1000) / 1000 < k * k + (y < 2 ? 0.25 : 0)) {
        gg.fillStyle = BIO[h % 3];
        gg.fillRect(x, y, 1, 1);
      }
    }
  const madre = [-1, 0, 1].map((f) => pintarJorobada(1, f, false));
  const cria = [-1, 0, 1].map((f) => pintarJorobada(0.56, f, true));
  const VACIO = new Int16Array(0);
  const sinPerfil = (c: Cv): Spr => ({ c, top: VACIO, bot: VACIO });
  const brecha = ANG_BRECHA.map((a) => sinPerfil(rotarPx(madre[1].c, a)));
  const delfin0 = pintarDelfin();
  const delfin = ANG_DELFIN.map((a) => sinPerfil(a === 0 ? delfin0 : rotarPx(delfin0, a)));
  const g0 = pintarGaviota(false);
  const gaviota = [g0, voltear(g0), pintarGaviota(true)];
  SPR = { glow, madre, cria, brecha, colaAlta: pintarColaAlta(), delfin, gaviota };
  return SPR;
}

/** Breach state: the cycle it belongs to and where in the world it happens (latched, so it doesn't ride the camera). */
let brechaCiclo = -1;
let brechaX = 0;

/**
 * Draws a sprite cutting the surface: the part under water dimmed, the part
 * above at full strength, and a lip of foam where it breaks the surface.
 * (x, y) is the sprite's top-left on screen; ys the surface row.
 */
function aFlor(g: Ctx, sp: Spr, x: number, y: number, ys: number, k: number, aBajo: number, xMin: number, vw: number) {
  const { c } = sp;
  const encima = y < ys;
  const debajo = y + c.height > ys;
  const recorte = x < xMin;
  if (debajo) {
    g.save();
    g.beginPath();
    g.rect(Math.max(xMin, x), ys, vw, c.height);
    g.clip();
    g.globalAlpha = k * aBajo;
    g.drawImage(c, x, y);
    g.restore();
  }
  if (encima) {
    g.save();
    g.beginPath();
    g.rect(recorte ? xMin : x, y, c.width, ys - y);
    g.clip();
    g.globalAlpha = k;
    g.drawImage(c, x, y);
    g.restore();
    if (debajo && sp.top.length) {
      // Foam lip along the waterline.
      g.globalAlpha = k;
      let first = -1, last = -1;
      for (let i = 0; i < sp.top.length; i++) {
        if (sp.top[i] < 0 || y + sp.top[i] >= ys || y + sp.bot[i] < ys) continue;
        if (x + i < xMin) continue;
        if (first < 0) first = i;
        last = i;
        g.fillStyle = (i + Math.round(x)) % 3 ? ESPUMA : BIO[0];
        g.fillRect(x + i, ys - 1, 1, 1);
      }
      if (first >= 0) {
        g.fillStyle = ESPUMA;
        g.fillRect(x + first - 3, ys, 3, 1);
        g.fillRect(x + last + 1, ys, 3, 1);
        g.fillStyle = BIO[1];
        g.fillRect(x + first - 5, ys + 1, 2, 1);
        g.fillRect(x + last + 4, ys + 1, 2, 1);
      }
    }
  }
}

/**
 * A blow: a bushy column that grows, leans with the wind and drifts off as a
 * soft puff. (x, y) is the blowhole on screen, `u` the life 0→1.
 */
function soplido(g: Ctx, x: number, y: number, u: number, alto: number, k: number) {
  if (u <= 0 || u >= 1) return;
  const H = Math.round(alto * Math.sin(Math.min(1, u * 1.8) * Math.PI * 0.5));
  const viento = 2 + u * 7;
  const fade = u > 0.55 ? 1 - (u - 0.55) / 0.45 : 1;
  const salt = Math.floor(u * 10);
  for (let i = 0; i < H; i++) {
    const f = i / alto;
    const cx = x - Math.round(f * f * viento);
    const w = Math.round(f * alto * 0.16);
    g.globalAlpha = k * fade * (0.95 - f * 0.35);
    for (let j = -w; j <= w; j++) {
      if (j !== 0 && (hash(i * 7 + j, 333 + salt) & 3) === 0) continue;
      g.fillStyle = j === 0 && i < H - 2 ? '#ffffff' : BIO[1 + ((i + j) & 1)];
      g.fillRect(cx + j, y - i, 1, 1);
    }
  }
  if (H > 4) {
    // The top blooms into a dithered puff that drifts downwind.
    const px = x - Math.round(viento + u * 6), py = y - H - Math.round(u * 2);
    const r = 2 + Math.round(u * 3);
    g.globalAlpha = k * fade * 0.8;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d = (dx * dx) / ((r + 1) * (r + 1)) + (dy * dy) / (r * r);
        if (d > 1) continue;
        const h = hash(dx * 17 + dy, 444 + salt) % 100;
        if (h > 85 - d * 60) continue;
        g.fillStyle = d < 0.3 ? '#ffffff' : h % 3 ? BIO[2] : BIO[1];
        g.fillRect(px + dx, py + dy, 1, 1);
      }
    // Mist drifting down at the end.
    if (u > 0.4)
      for (let i = 0; i < 6; i++) {
        const h = hash(i, 71);
        g.fillStyle = BIO[2];
        g.fillRect(px - 4 - (h % 7) - Math.round((u - 0.4) * 10), py + 2 + ((h >> 4) % 6) + Math.round((u - 0.4) * 12), 1, 1);
      }
  }
  g.globalAlpha = 1;
}

/**
 * A splash on the surface: a spray column, a crown of drops and foam rings
 * spreading out. (x, y) is the surface point on screen, `a` the life 0→1,
 * `big` the size (1 = a breach).
 */
function corona(g: Ctx, x: number, y: number, a: number, big: number, k: number) {
  if (a <= 0 || a >= 1) return;
  const fade = 1 - a;
  // Foam rings (the far half above the waterline, the near half below).
  for (const [r0, rr, col] of [[6, 34, ESPUMA], [3, 18, BIO[1]]] as const) {
    const rx = (r0 + a * rr) * big, ry = 1.5 + a * 3 * big;
    const n = Math.max(12, Math.round(rx * 1.4));
    g.globalAlpha = k * fade;
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      if ((i + Math.floor(a * 9)) % 5 === 0) continue;
      const an = (i / n) * Math.PI * 2;
      g.fillRect(Math.round(x + Math.cos(an) * rx), Math.round(y + Math.sin(an) * ry), 2, 1);
    }
  }
  // The column: shoots up and sinks back, a ragged dithered spray (denser at the base).
  const Hc = Math.round(30 * big * Math.sin(Math.min(1, a * 2) * Math.PI * 0.5) * (1 - Math.max(0, a - 0.35) / 0.65));
  if (Hc > 1) {
    g.globalAlpha = k * Math.min(1, fade * 1.4);
    const w = Math.max(1, Math.round(3.5 * big));
    const salt = Math.floor(a * 12);
    for (let i = 0; i < Hc; i++) {
      const f = i / Hc;
      const ww = Math.round(w * (0.6 + f * 0.7));
      for (let j = -ww; j <= ww; j++) {
        const h = hash(i * 13 + j, 515 + salt) % 100;
        const dens = 92 - f * 45 - (Math.abs(j) / (ww + 1)) * 40;
        if (h > dens) continue;
        g.fillStyle = Math.abs(j) >= ww - 1 ? BIO[1] : h % 4 ? ESPUMA : BIO[2];
        g.fillRect(x + j, y - i, 1, 1);
      }
    }
    // A loose crown of spray at the top.
    for (let i = 0; i < 8; i++) {
      const h = hash(i, 616 + salt);
      g.fillStyle = i % 2 ? BIO[2] : ESPUMA;
      g.fillRect(x - w - 2 + (h % (w * 2 + 5)), y - Hc - 1 - ((h >> 5) % 4), 1, 1);
    }
  }
  // A crown of drops on arcs.
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const v = 0.5 + ((i * 7) % 6) * 0.12;
    const dx = Math.round(side * (4 + (i >> 1) * 2.6) * a * 1.7 * big);
    const dy = Math.round((-40 * v * a + 52 * a * a) * big);
    if (dy > 0) continue;
    g.globalAlpha = k * fade;
    g.fillStyle = i % 3 ? BIO[2] : '#ffffff';
    g.fillRect(x + dx, y + dy, 2, 1);
    g.fillRect(x + dx, y + dy + 1, 1, 1);
  }
  // Mist: a loose drift of fine spray hanging over the spot, blown downwind.
  g.globalAlpha = k * fade * 0.6;
  g.fillStyle = BIO[2];
  const rm = (4 + a * 10) * big;
  for (let i = 0; i < Math.round(10 * big) + 4; i++) {
    const h = hash(i, 838);
    const an = (h % 628) / 100;
    const rr = rm * (((h >> 10) % 100) / 100);
    g.fillRect(Math.round(x - a * 8 + Math.cos(an) * rr), Math.round(y - (6 + a * 10) * big + Math.sin(an) * rr * 0.6), 1, 1);
  }
  g.globalAlpha = 1;
}

/** Resting gulls on the open water: [world x, which sprite, phase]. */
const GAVIOTAS: [number, number, number][] = [[760, 0, 0], [790, 2, 1.7], [1420, 1, 0.8], [2240, 0, 2.3], [2262, 1, 0.3], [2930, 2, 1.1], [3330, 1, 2.9]];

/**
 * The sea after the storm clears: glowing bioluminescent crests and a band of
 * light just under the surface, moon glints and sparkles (more where the
 * water is stirred), a humpback and her calf cruising along the surface —
 * backs rolling up, blows drifting in the wind, the fluke lifted as she dives
 * — a pod of dolphins arcing, gulls asleep on the swell, and now and then a
 * whale breaching in a sheet of glowing water and a big splash.
 *
 * Call it right after the sea surface and the waves (dibujarOlas) are drawn,
 * every frame, with the same `camX` and `ySuperficie` (= sy(NIVEL_MAR)).
 * `k` is how clear the night is (0 = full storm: draws nothing … 1 = clear).
 * `agitados` are world x's where the water is being stirred (splashes, the
 * plane skimming low); optional.
 */
export function dibujarMarMagico(g: Ctx, camX: number, ySuperficie: number, vw: number, vh: number, t: number, k: number, quieto = false, agitados?: ArrayLike<number>) {
  if (k <= 0.01) return;
  const S = sprites();
  const tt = quieto ? 0 : t;
  const y = Math.round(ySuperficie);
  if (y > vh + 40) return;
  const x0 = Math.max(0, Math.round(orillaX - camX));
  const fondo = NIVEL_MAR + DIRT;

  // The glow band under the surface, breathing slowly.
  // (Clipped at the shore: the first tile used to spill over the island's sand.)
  g.save();
  g.beginPath();
  g.rect(x0, y + 1, vw, S.glow.height);
  g.clip();
  g.globalAlpha = k * (0.75 + 0.2 * Math.sin(tt * 0.8));
  const gw = S.glow.width;
  for (let x = x0 - mod(Math.round(camX * 1 - tt * 3), gw); x < vw; x += gw) if (x + gw > x0) g.drawImage(S.glow, x, y + 1);
  g.restore();

  // The humpback and her calf cruising right (world-anchored; the loop wraps well outside the level).
  {
    const wx = mod(900 + tt * 9, 4300) - 350;
    const sx = Math.round(wx - camX);
    const M = S.madre[1].c;
    if (sx > -M.width - 40 && sx < vw + 60 && sx + M.width > x0) {
      // One breath cycle: surface and blow, roll down, lift the fluke and dive, glide deep.
      const p = mod(tt / 18 + 0.05, 1);
      const sube = p < 0.36 ? Math.sin((p / 0.36) * Math.PI) : 0;
      const hondo = p > 0.42 ? Math.min(1, (p - 0.42) / 0.1) * (p > 0.9 ? (1 - p) / 0.1 : 1) : 0;
      const fr = Math.floor(tt * 1.6) % 4;
      // A slow tail beat; while she's up to breathe the tail hangs low, out of sight.
      const frame = sube > 0.25 ? 2 : fr === 0 ? 0 : fr === 2 ? 2 : 1;
      const mad = S.madre[frame];
      const my = y + 10 - Math.round(sube * 11) + Math.round(hondo * 6) + Math.round(Math.sin(tt * 0.5) * 1) - Math.round(mad.c.height / 2) + 4;
      const aB = 0.62 - hondo * 0.3;
      // The calf rides just above her flipper, surfacing a beat earlier.
      const pc = mod(p + 0.04, 1);
      const subeC = pc < 0.34 ? Math.sin((pc / 0.34) * Math.PI) : 0;
      const cri = S.cria[subeC > 0.25 ? 2 : (fr + 1) % 4 === 0 ? 0 : (fr + 1) % 4 === 2 ? 2 : 1];
      const cx = sx + 34 + Math.round(Math.sin(tt * 0.35) * 3);
      const cy = y + 7 - Math.round(subeC * 7) + Math.round(hondo * 4) + Math.round(Math.sin(tt * 0.9 + 1) * 1) - Math.round(cri.c.height / 2) + 3;
      aFlor(g, mad, sx, my, y, k, aB, x0, vw);
      aFlor(g, cri, cx, cy, y, k, aB + 0.08, x0, vw);
      // Blows, leaning with the wind.
      const um = (p - 0.08) / 0.16;
      if (um > 0 && um < 1 && sx + mad.soplo[0] > x0) soplido(g, sx + mad.soplo[0], y - 1, um, 22, k);
      const uc = (pc - 0.1) / 0.12;
      if (uc > 0 && uc < 1 && cx + cri.soplo[0] > x0) soplido(g, cx + cri.soplo[0], y - 1, uc, 11, k);
      // The fluke lifts out of the water as she dives, water streaming off its edge.
      const uf = (p - 0.4) / 0.17;
      if (uf > 0 && uf < 1) {
        const C = S.colaAlta;
        const h = Math.round(Math.sin(uf * Math.PI) * (C.c.height - 3));
        const fx = sx + 2, fy = y - h;
        if (fx > x0) {
          aFlor(g, C, fx, fy, y + 1, k, 0, x0, vw);
          if (uf > 0.3) {
            g.globalAlpha = k * 0.85;
            for (let i = 0; i < 9; i++) {
              const hx = fx + 5 + i * 3 + (i % 2);
              const hy = fy + 4 + Math.round(Math.abs(i - 4) * -0.6);
              const ln = 2 + ((i * 5 + Math.floor(tt * 8)) % 5);
              g.fillStyle = i % 2 ? BIO[1] : ESPUMA;
              for (let d = 0; d < ln; d += 2) if (hy + d + 2 < y) g.fillRect(hx, hy + d + 2, 1, 1);
            }
          }
        }
        corona(g, fx + 19, y, Math.max(0, (uf - 0.55) / 0.45), 0.45, k);
      }
    }
  }

  // Gulls asleep on the swell, bobbing, with a ring of light rippling under each.
  for (const [wx, i, ph] of GAVIOTAS) {
    if (wx < orillaX + 30) continue;
    const sx = Math.round(wx - camX);
    if (sx < -16 || sx > vw + 4 || sx < x0) continue;
    const spr = S.gaviota[i];
    const bob = Math.round(Math.sin(tt * 1.4 + ph) * 1.1);
    g.globalAlpha = k;
    g.drawImage(spr, sx - 6, y - 7 + bob);
    const r = mod(tt * 0.6 + ph, 1);
    g.globalAlpha = k * (1 - r) * 0.8;
    g.fillStyle = BIO[1];
    const rr = 4 + Math.round(r * 7);
    g.fillRect(sx - rr, y + 1 + bob, 2, 1);
    g.fillRect(sx + rr - 1, y + 1 + bob, 2, 1);
    g.globalAlpha = k * 0.35;
    g.fillStyle = '#eeeaf8';
    g.fillRect(sx - 3, y + 2 + bob, 6, 1);
  }

  // Glowing crests riding the surface.
  {
    const roll = tt * 7;
    const i0 = Math.floor((camX + roll - 20) / CREST_P);
    const i1 = Math.ceil((camX + roll + vw + 20) / CREST_P);
    for (let i = i0; i <= i1; i++) {
      const h = hash(i, 77);
      const wx = i * CREST_P + (h % 9) - roll;
      if (wx < orillaX + 8) continue;
      const x = Math.round(wx - camX);
      const p = 0.5 + 0.5 * Math.sin(tt * 1.7 + i * 1.3);
      g.globalAlpha = k * (0.35 + 0.65 * p);
      const w = h % 3 === 0 ? 7 : 5;
      g.fillStyle = BIO[0];
      g.fillRect(x - w, y - 1, w * 2 + 1, 1);
      g.fillStyle = BIO[2];
      g.fillRect(x - w + 3, y - 3 + Math.round(Math.sin(tt * 2.2 + i * 1.7) * 0.6 + 0.4), w, 1);
    }
  }

  // Moon glints twinkling on the surface.
  {
    const P = 19;
    const j0 = Math.floor(camX / P);
    for (let j = j0; j <= j0 + Math.ceil(vw / P) + 1; j++) {
      const h = hash(j, 612);
      const ph = Math.sin(tt * (1.1 + (h % 4) * 0.3) + (h % 53));
      if (ph < 0.8) continue;
      const x = Math.round(j * P + (h % P) - camX);
      if (x < x0) continue;
      const yy = y + 1 + ((h >> 6) % 3);
      g.globalAlpha = k * (ph - 0.7) * 3;
      g.fillStyle = '#fff6d8';
      g.fillRect(x - 1, yy, 3, 1);
      if (ph > 0.95) {
        g.fillRect(x, yy - 1, 1, 3);
        g.fillRect(x - 2, yy, 5, 1);
      }
    }
  }

  // Sparkles in the water, flickering on and off.
  {
    const n = Math.ceil(vw / 7);
    const j0 = Math.floor(camX / 7);
    for (let j = j0; j < j0 + n; j++) {
      const h = hash(j, 501);
      const ph = Math.sin(tt * (1.5 + (h % 5) * 0.4) + (h % 97));
      if (ph < 0.55) continue;
      const x = Math.round(j * 7 + (h % 7) - camX);
      if (x < x0) continue;
      const d = (h >> 8) % fondo;
      g.globalAlpha = k * (ph - 0.4) * (1 - d / (fondo + 6));
      g.fillStyle = BIO[(h >> 4) % 4];
      g.fillRect(x, y + 1 + d, 1, 1);
      if (ph > 0.92) {
        g.fillRect(x - 1, y + 1 + d, 3, 1);
        g.fillRect(x, y + d, 1, 3);
      }
    }
  }

  // Where the water is stirred, a burst of light.
  if (agitados)
    for (let i = 0; i < agitados.length; i++) {
      const cx = Math.round(agitados[i] - camX);
      if (cx < -20 || cx > vw + 20 || cx < x0) continue;
      for (let j = 0; j < 14; j++) {
        const h = hash(j, i * 31 + Math.floor(tt * 6));
        g.globalAlpha = k * (0.5 + (h % 50) / 100);
        g.fillStyle = BIO[h % 4];
        g.fillRect(cx - 12 + (h % 25), y - 1 + ((h >> 5) % 10), 1 + ((h >> 9) % 2), 1);
      }
    }

  if (!quieto) {
    // A pod of dolphins arcing along, leaping in turn (two pods, world-anchored).
    for (const [x0p, vel, sem] of [[1700, 30, 0], [300, 24, 0.5]] as const) {
      const px = mod(x0p + tt * vel, 4600) - 500;
      if (px - camX < -120 || px - camX > vw + 60) continue;
      for (let i = 0; i < 3; i++) {
        const p = mod(tt / 1.9 + i * 0.29 + sem, 1);
        const bx = px - i * 24 - (i === 2 ? 6 : 0);
        if (bx < orillaX + 20) continue;
        const ax = Math.round(bx - camX);
        if (ax < x0) continue;
        if (p < 0.44) {
          const s = p / 0.44;
          const h = Math.round(16 * Math.sin(s * Math.PI));
          const ang = Math.atan2(-16 * Math.PI * Math.cos(s * Math.PI), 22 / 0.44 * 0.6);
          let fi = 0;
          for (let q = 1; q < ANG_DELFIN.length; q++) if (Math.abs(ANG_DELFIN[q] - ang) < Math.abs(ANG_DELFIN[fi] - ang)) fi = q;
          const spr = S.delfin[fi];
          const dx = ax + Math.round(s * 22) - Math.round(spr.c.width / 2);
          const dy = y - h - Math.round(spr.c.height / 2) + 1;
          aFlor(g, spr, dx, dy, y, k, 0, x0, vw);
          // A thread of glowing drops trailing behind.
          g.fillStyle = BIO[1];
          for (let d = 1; d < 5; d++) {
            const sd = s - d * 0.05;
            if (sd <= 0) break;
            const hd = Math.round(16 * Math.sin(sd * Math.PI)) - 1;
            g.globalAlpha = k * (1 - d / 5);
            if (hd > 0) g.fillRect(ax + Math.round(sd * 22) - 2, y - hd + 2, 1, 1);
          }
        }
        // Little splashes where they leave and where they dive back.
        const a1 = p / 0.12, a2 = (p - 0.42) / 0.16;
        if (a1 > 0 && a1 < 1) corona(g, ax, y, a1, 0.28, k);
        if (a2 > 0 && a2 < 1) corona(g, ax + 22, y, a2, 0.3, k);
      }
    }

    // Now and then, a whale breaches near the middle of the screen: she bursts
    // out nose first, water sheeting off her, arcs over and crashes back down.
    const PER = 24;
    const ciclo = Math.floor(tt / PER);
    const e = tt - ciclo * PER;
    if (e < 5) {
      if (brechaCiclo !== ciclo) {
        brechaCiclo = ciclo;
        brechaX = camX + vw * (0.35 + ((ciclo * 37) % 40) / 100);
      }
      const bx = brechaX;
      if (bx > orillaX + 80) {
        const sx0 = bx - camX;
        const VUELO = 2.5, AV = 58, ALTO = 50;
        const pos = (v: number) => ({ x: sx0 + v * AV, y: y + 18 - ALTO * Math.sin(v * Math.PI) });
        const v = e / VUELO;
        if (v < 1) {
          const ang = Math.atan2(-ALTO * Math.PI * Math.cos(v * Math.PI), AV);
          let fi = 0;
          for (let q = 1; q < ANG_BRECHA.length; q++) if (Math.abs(ANG_BRECHA[q] - ang) < Math.abs(ANG_BRECHA[fi] - ang)) fi = q;
          const spr = S.brecha[fi];
          const c = pos(v);
          const dx = Math.round(c.x - spr.c.width / 2), dy = Math.round(c.y - spr.c.height / 2);
          aFlor(g, spr, dx, dy, y, k, 0.4, x0, vw);
          // Foam where her body cuts the surface.
          const ca = Math.cos(ANG_BRECHA[fi]), sa = Math.sin(ANG_BRECHA[fi]);
          if (Math.abs(sa) > 0.15) {
            const tw = (y - c.y) / sa; // along the axis, from the centre
            if (Math.abs(tw) < 36) {
              const wxp = Math.round(c.x + ca * tw);
              g.globalAlpha = k;
              g.fillStyle = ESPUMA;
              g.fillRect(wxp - 7, y - 1, 15, 2);
              g.fillStyle = BIO[1];
              g.fillRect(wxp - 10, y, 3, 1);
              g.fillRect(wxp + 8, y, 3, 1);
              g.fillStyle = '#ffffff';
              g.fillRect(wxp - 3, y - 3, 2, 2);
              g.fillRect(wxp + 2, y - 2, 2, 1);
            }
          }
          // Water sheeting off: streaks hanging under her body.
          if (v > 0.06 && v < 0.8) {
            const nx = -sa, ny = ca;
            for (let i = 0; i < 9; i++) {
              const f = (i / 8 - 0.5) * 52;
              const bxp = c.x + ca * f + nx * 6, byp = c.y + sa * f + ny * 6;
              if (byp >= y - 1) continue;
              const ln = 3 + (hash(i, Math.floor(e * 10)) % 6) + Math.round((1 - Math.abs(v - 0.4)) * 4);
              g.globalAlpha = k * 0.85;
              for (let d = 0; d < ln && byp + d < y; d++) {
                g.fillStyle = d === 0 ? ESPUMA : d % 2 ? BIO[1] : BIO[2];
                if (d < 3 || (d + i) % 2 === 0) g.fillRect(Math.round(bxp), Math.round(byp + d), 1, 1);
              }
            }
          }
        }
        // Drops shed along the way, falling back under gravity.
        for (let i = 0; i < 28; i++) {
          const ve = 0.04 + i * 0.026;
          const te = ve * VUELO;
          const dt = e - te;
          if (dt <= 0 || ve > 0.85) continue;
          const c0 = pos(ve);
          const h = hash(i, 4242);
          const ox = ((h % 41) - 20) * 0.9;
          const yy = c0.y + 4 + (h % 5) + 160 * dt * dt - 14 * dt;
          if (yy >= y) continue;
          const xx = c0.x + ox + (((h >> 6) % 30) - 10) * dt;
          g.globalAlpha = k * Math.max(0, 1 - dt * 0.6);
          g.fillStyle = h % 3 ? BIO[1] : ESPUMA;
          g.fillRect(Math.round(xx), Math.round(yy), 1, 2);
        }
        // Splash as she leaves the water, and a big one when she crashes back.
        corona(g, Math.round(sx0 + 4), y, (e - 0.05) / 1.6, 0.75, k);
        corona(g, Math.round(sx0 + AV * 0.86), y, (e - VUELO * 0.82) / 2.4, 1.15, k);
      }
    }
  }
  g.globalAlpha = 1;
}
