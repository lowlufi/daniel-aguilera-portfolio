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
const BALLENA_W = 60;
const BALLENA_H = 24;

type Sprites = { glow: HTMLCanvasElement; ballena: HTMLCanvasElement[]; cria: HTMLCanvasElement };
let SPR: Sprites | null = null;

/** A whale facing right, painted at (0,0) of `g`: dark body, pale belly grooves, a glowing rim. */
function pintarBallena(g: Ctx, s: number) {
  const w = Math.round(BALLENA_W * s);
  const h = Math.round(17 * s);
  const cy = Math.round(BALLENA_H / 2 + 1);
  const body = (col: string, grow: number) => {
    // Tapered body: a long oval, the head a bit blunt, the tail stock thin.
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const th = u < 0.18 ? (u / 0.18) * 0.35 : u > 0.8 ? 1 - (u - 0.8) * 1.6 : 0.35 + ((u - 0.18) / 0.62) * 0.65;
      const hh = Math.max(1, Math.round((h / 2) * th)) + grow;
      g.fillStyle = col;
      g.fillRect(x + 6, cy - hh, 1, hh * 2);
    }
    // Fluke at the tail (left), a fork.
    g.fillStyle = col;
    g.fillRect(6 - grow, cy - 4 - grow, 3 + grow * 2, 3 + grow * 2);
    g.fillRect(6 - grow, cy + 2 - grow, 3 + grow * 2, 3 + grow * 2);
    g.fillRect(3 - grow, cy - 6 - grow, 4 + grow * 2, 2 + grow * 2);
    g.fillRect(3 - grow, cy + 5 - grow, 4 + grow * 2, 2 + grow * 2);
  };
  body('#5af0ff', 1);
  body('#2a3a78', 0);
  // Pale belly with grooves, a long pectoral fin, the eye, a sheen on the back.
  g.fillStyle = '#9ab0d8';
  for (let x = Math.round(w * 0.45); x < w - 2; x++) g.fillRect(x + 6, cy + Math.round(h * 0.18), 1, 1);
  g.fillStyle = '#6a80b8';
  for (let x = Math.round(w * 0.55); x < w - 4; x += 3) g.fillRect(x + 6, cy + Math.round(h * 0.28), 2, 1);
  g.fillStyle = '#2e3e78';
  g.fillRect(Math.round(w * 0.62) + 6, cy + 2, Math.round(10 * s), 2);
  g.fillRect(Math.round(w * 0.55) + 6, cy + 4, Math.round(8 * s), 1);
  g.fillStyle = '#7af4ff';
  g.fillRect(Math.round(w * 0.3) + 6, cy - Math.round(h * 0.38), Math.round(w * 0.45), 1);
  g.fillStyle = '#ffffff';
  g.fillRect(w + 6 - Math.round(7 * s), cy - 1, 1, 1);
}

function sprites(): Sprites {
  if (SPR) return SPR;
  const mk = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    return [c, g] as const;
  };
  // A tiling band of dithered glow just under the surface.
  const [glow, gg] = mk(128, 10);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 128; x++) {
      const h = hash(x, y + 40);
      const k = (1 - y / 10) * 0.75;
      if ((h % 1000) / 1000 < k * k + (y < 2 ? 0.25 : 0)) {
        gg.fillStyle = BIO[h % 3];
        gg.fillRect(x, y, 1, 1);
      }
    }
  // The whale at a few tilts for the breach (nose up → level → nose down).
  const [base, gb] = mk(BALLENA_W + 10, BALLENA_H + 4);
  pintarBallena(gb, 1);
  const ballena = [-0.9, -0.35, 0.15, 0.7].map((ang) => {
    const S = 80;
    const [c, g] = mk(S, S);
    g.translate(S / 2, S / 2);
    g.rotate(ang);
    g.drawImage(base, -base.width / 2, -base.height / 2);
    return c;
  });
  ballena.push(base);
  const [cria, gc] = mk(46, BALLENA_H + 4);
  pintarBallena(gc, 0.62);
  SPR = { glow, ballena, cria };
  return SPR;
}

/**
 * The sea after the storm clears: glowing bioluminescent crests and a band of
 * light just under the surface, sparkles (more where the water is stirred),
 * a whale and her calf gliding under the surface with glowing edges, spouts,
 * and now and then a whale breaching in a shower of glowing spray.
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
  g.globalAlpha = k * (0.75 + 0.2 * Math.sin(tt * 0.8));
  const gw = S.glow.width;
  for (let x = x0 - mod(Math.round(camX * 1 - tt * 3), gw); x < vw; x += gw) if (x + gw > x0) g.drawImage(S.glow, x, y + 1);

  // Whale and calf gliding under the surface (world-anchored, slowly swimming right).
  {
    const wx = mod(900 + tt * 9, 3400) - 200;
    const sx = Math.round(wx - camX);
    const wy = y + Math.round(fondo * 0.45) + Math.round(Math.sin(tt * 0.4) * 2);
    if (sx > -80 && sx < vw + 20 && sx > x0 - 60) {
      g.globalAlpha = k * 0.7;
      g.drawImage(S.ballena[4], sx, wy - 10);
      g.drawImage(S.cria, sx - 34, wy - 6 + Math.round(Math.sin(tt * 0.9) * 2));
      // A spout now and then when she comes up to breathe.
      const f = mod(tt / 9, 1);
      if (f < 0.18) {
        const u = f / 0.18;
        const hx = sx + BALLENA_W + 4;
        const H = Math.round(22 * Math.sin(u * Math.PI));
        g.globalAlpha = k * (1 - u * 0.6);
        for (let i = 0; i < H; i += 2) {
          const spread = Math.round((i / 22) * 4);
          g.fillStyle = BIO[(i >> 1) % 3];
          g.fillRect(hx - spread, y - i, 1, 1);
          g.fillRect(hx + spread, y - i, 1, 1);
          if (i % 4 === 0) g.fillRect(hx, y - i - 1, 1, 1);
        }
        g.fillStyle = '#ffffff';
        g.fillRect(hx - 1, y - H - 1, 3, 1);
      }
    }
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

  // Now and then, a whale breaches near the middle of the screen.
  if (!quieto) {
    const PER = 24;
    const ciclo = Math.floor(tt / PER);
    const u = (tt - ciclo * PER) / 3.2;
    const bx = Math.round(camX + vw * (0.35 + ((ciclo * 37) % 40) / 100));
    if (u < 1 && bx > orillaX + 60) {
      const sx = bx - camX;
      const alto = 46;
      const arc = Math.sin(Math.min(1, u * 1.25) * Math.PI);
      const cy = y + 10 - Math.round(arc * alto);
      const fr = u < 0.25 ? 0 : u < 0.45 ? 1 : u < 0.62 ? 2 : 3;
      const spr = S.ballena[fr];
      g.globalAlpha = k;
      // Only the part above the seabed shows; under the surface it's dimmer.
      g.save();
      g.beginPath();
      g.rect(0, 0, vw, y + fondo);
      g.clip();
      g.drawImage(spr, Math.round(sx + u * 40 - spr.width / 2), cy - spr.height / 2);
      g.restore();
      // Spray where it leaves and where it falls back.
      for (const [u0, ox] of [[0.05, 0], [0.8, 46]] as const) {
        const v = (u - u0) / 0.3;
        if (v < 0 || v > 1) continue;
        const H = Math.round(26 * Math.sin(v * Math.PI));
        for (let i = 0; i < 10; i++) {
          const side = i % 2 ? 1 : -1;
          const dx = Math.round(side * (3 + i * 2) * v * 1.6);
          const dy = Math.round(-H * (0.5 + ((i * 7) % 5) / 10) + 30 * v * v);
          if (dy > 0) continue;
          g.globalAlpha = k * (1 - v * 0.7);
          g.fillStyle = BIO[i % 3];
          g.fillRect(Math.round(sx + ox + dx), y + dy, 2, 1);
        }
        g.fillStyle = BIO[2];
        g.fillRect(Math.round(sx + ox - 8 - v * 10), y - 1, Math.round(16 + v * 20), 1);
      }
    }
  }
  g.globalAlpha = 1;
}
