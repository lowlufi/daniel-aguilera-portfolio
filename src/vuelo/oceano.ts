import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { DECO_H, DIRT, R, paintPantry } from './dibujo';

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

/**
 * Wave crests and foam along the sea surface (screen row `ySuperficie`),
 * scrolling with the camera and rolling slowly left. Skips the island.
 */
export function dibujarOlas(g: Ctx, camX: number, ySuperficie: number, vw: number, t: number, quieto: boolean) {
  const tt = quieto ? 0 : t;
  const y = Math.round(ySuperficie);
  const roll = tt * 7;
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
    R(g, x - w, y - 1 + bob, w * 2 + 1, 1 - bob + 1, AGUA[0]);
    R(g, x - w + 2, top + 1, w * 2 - 3, y - top - 1, AGUA[0]);
    R(g, x - w + 3, top, w, 1, P.white);
    R(g, x - w + 2, top + 1, 2, 1, P.white);
    R(g, x + 2, top, w - 4, 1, INK);
    R(g, x + w - 2, top + 1, 2, 1, INK);
    R(g, x + w, y - 1 + bob, 1, 1, INK);
    if (big) R(g, x - w + 4, top - 1, 2, 1, P.white);
  }
  // Glints just under the surface, drifting the other way.
  g.fillStyle = P.w3;
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
    R(g, sx - 3 + k, y - 1, 6, 1, P.white);
    R(g, sx + 1 + k, y - 2, 3, 1, P.w3);
    R(g, sx + 4 + k, y - 1, 1, 1, INK);
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
