import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { LOOKS, R, drawPlane, type Parte } from './dibujo';
import type { ModeloAvion } from './fisica-tipos';

/*
 * Roll and hard-pull frames for the three player planes.
 *
 * The side sprites in dibujo.ts show the plane from its left flank. When it
 * rolls about its long axis the canopy turns towards the camera: at ~30° the
 * far wing peeks above the fuselage, at ~60° both wings spread apart, and at
 * 90° we look straight down on it (plan view: both wings, tail plane, the
 * pilot's head from above). Past 90° the same drawings are mirrored
 * vertically, since a roll of 180°−φ is the vertical mirror of φ.
 *
 * Frame index (see framePara):
 *   0 upright side · 1 bank 30° · 2 bank 60° · 3 plan view
 *   4 = mirrored 2 · 5 = mirrored 1 · 6 inverted side
 * Frames 0 and 6 are drawn by drawPlane itself.
 *
 * Banked frames are painted once per (model, frame, lost parts) and cached
 * through D.outlined, so drawing costs one drawImage plus a few rects, like
 * drawPlane.
 */

type Ctx = CanvasRenderingContext2D;
type Has = (p: Parte) => boolean;
/** One banked view: k = 1..3, s = sin φ, c = cos φ. */
type View = { k: 1 | 2 | 3; s: number; c: number };

const VIEWS: Record<1 | 2 | 3, View> = {
  1: { k: 1, s: 0.5, c: Math.cos(Math.PI / 6) },
  2: { k: 2, s: Math.sin(Math.PI / 3), c: 0.5 },
  3: { k: 3, s: 1, c: 0 },
};

/** Banked sprites are taller than the side ones: the wings spread vertically. */
const GIRO_H: Record<ModeloAvion, number> = { avioneta: 38, caza: 30, bombardero: 50 };

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const ri = Math.round;

/* ── Small drawing helpers ───────────────────────────────────────────────── */

/** A torn, scorched edge where a part used to be (same look as dibujo.ts). */
function stub(g: Ctx, x: number, y: number, w: number, h: number) {
  R(g, x, y, w, h, '#5a4a5a');
  for (let i = 0; i < h; i++) R(g, x + (i % 2 ? -1 : w), y + i, 1, 1, i % 3 ? '#3a2a3a' : '#ff9a3c');
  R(g, x + Math.floor(w / 2), y, 1, 1, P.gold);
}

/** Scorch marks over the fuselage, squashed to its visible height. */
function scorch(g: Ctx, n: number, seed: number, hy: number) {
  for (let i = 0; i < n * 3; i++) {
    const h = (seed * 31 + i * 97) % 211;
    g.globalAlpha = i % 2 ? 0.5 : 0.8;
    R(g, (h % 18) - 9, clamp(((h >> 3) % 5) - 2, -hy, hy - 1), 3, 2, '#3a2a3a');
  }
  g.globalAlpha = 1;
}

/** Rows from y=ya to y=yb, x span going linearly from [a0,a1] to [b0,b1]. */
function trap(g: Ctx, ya: number, yb: number, a0: number, a1: number, b0: number, b1: number, col: string) {
  const n = Math.abs(yb - ya);
  const dir = yb >= ya ? 1 : -1;
  for (let i = 0; i <= n; i++) {
    const u = n ? i / n : 0;
    const x0 = ri(a0 + (b0 - a0) * u);
    const x1 = ri(a1 + (b1 - a1) * u);
    R(g, x0, ya + i * dir, x1 - x0 + 1, 1, col);
  }
}

/**
 * A wing (or tail plane) seen from above and foreshortened: `rows` pixel rows
 * from the root at y0 towards dir (-1 up, +1 down). root/tip = [trailing x,
 * leading x]. Leading edge lit, trailing edge and aileron shaded, rounded tip.
 */
function wing(
  g: Ctx, y0: number, dir: 1 | -1, rows: number,
  root: [number, number], tip: [number, number],
  col: [string, string, string], tipC?: string,
) {
  const [d, m, l] = col;
  if (rows < 1) {
    R(g, root[0], y0, root[1] - root[0] + 1, 1, d);
    return;
  }
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    let x0 = ri(root[0] + (tip[0] - root[0]) * u);
    let x1 = ri(root[1] + (tip[1] - root[1]) * u);
    if (i === rows) {
      x0++;
      x1--;
    }
    const y = y0 + i * dir;
    const w = x1 - x0 + 1;
    R(g, x0, y, w, 1, m);
    R(g, x1, y, 1, 1, l);
    // Aileron on the outer half, a plain shaded trailing edge inboard.
    R(g, x0, y, u > 0.45 && i < rows ? 2 : 1, 1, d);
    if (tipC && i >= rows - 1) R(g, x1, y, 1, 1, tipC);
  }
}

/** Fuselage of an elliptic section a (tall) × b (wide), seen rolled by φ. */
function bodyH(v: View, a: number, b: number) {
  return Math.max(1, ri(Math.sqrt(a * a * v.c * v.c + b * b * v.s * v.s)));
}

/* ── Pilots ─────────────────────────────────────────────────────────────── */

/** Side heads (a copy of dibujo.ts's cockpit heads) for the 30° frame. */
function sideHead(g: Ctx, m: ModeloAvion, x: number, y: number) {
  if (m === 'caza') {
    R(g, x - 3, y - 7, 2, 2, P.o1);
    R(g, x + 1, y - 7, 2, 2, P.o1);
    D.disc(g, x, y - 3, 3, P.o2);
    D.oval(g, x, y - 1, 4, 1, P.o2);
    R(g, x - 1, y, 3, 1, P.o1);
    R(g, x - 2, y - 5, 2, 1, P.o3);
    R(g, x - 3, y - 4, 6, 1, P.k0);
    R(g, x + 1, y - 4, 2, 2, P.gl1);
    R(g, x + 2, y - 1, 1, 1, P.blush);
  } else if (m === 'avioneta') {
    const K = '#2e2840';
    R(g, x - 3, y - 7, 2, 2, K);
    R(g, x + 1, y - 7, 2, 2, K);
    D.disc(g, x, y - 3, 3, K);
    R(g, x - 2, y - 5, 2, 1, '#4e4668');
    R(g, x - 3, y - 5, 6, 1, P.k0);
    R(g, x + 1, y - 3, 2, 1, '#ffd23a');
    R(g, x + 2, y - 3, 1, 1, '#1a1428');
    R(g, x + 3, y - 1, 1, 1, P.p1);
  } else {
    R(g, x - 3, y - 7, 1, 2, '#9a6030');
    R(g, x + 2, y - 7, 1, 2, '#9a6030');
    R(g, x - 3, y - 7, 1, 1, '#2a2430');
    R(g, x + 2, y - 7, 1, 1, '#2a2430');
    D.disc(g, x, y - 3, 3, '#cc8c4c');
    R(g, x - 3, y - 5, 3, 2, '#2a2430');
    R(g, x - 1, y - 7, 3, 1, P.r2);
    R(g, x + 1, y - 5, 1, 1, '#d8d0ca');
    R(g, x + 1, y - 4, 1, 1, P.eye);
    D.oval(g, x + 2, y - 2, 1, 1, '#d8d0ca');
    R(g, x + 3, y - 2, 1, 1, '#2a2030');
  }
}

/**
 * The pilot's head seen from above, facing +x; (x, y) is the head's centre.
 * `tilt` (0 or 1) lets the 60° frame show a sliver of the face's flank.
 */
function topHead(g: Ctx, m: ModeloAvion, x: number, y: number, tilt: number) {
  if (m === 'avioneta') {
    // Lulu: black cat, ears to both sides, goggles strap across the brow.
    const K = '#2e2840', K1 = '#4e4668';
    R(g, x - 2, y - 4, 2, 2, K);
    R(g, x - 2, y + 3, 2, 2, K);
    R(g, x - 1, y - 3, 1, 1, P.p1);
    R(g, x - 1, y + 3, 1, 1, P.p1);
    D.disc(g, x, y, 3, K);
    R(g, x - 2, y - 1, 2, 1, K1);
    R(g, x + 1, y - 3, 1, 7, P.k0);
    R(g, x + 2, y - 2, 1, 2, P.gl1);
    R(g, x + 2, y + 1, 1, 2, P.gl1);
    if (tilt) R(g, x + 2, y + 2, 2, 1, '#ffd23a');
    R(g, x + 4, y, 1, 1, P.p1);
  } else if (m === 'caza') {
    // Dui: orange tabby, goggles strap and lens.
    R(g, x - 2, y - 4, 2, 2, P.o1);
    R(g, x - 2, y + 3, 2, 2, P.o1);
    R(g, x - 1, y - 3, 1, 1, P.blush);
    R(g, x - 1, y + 3, 1, 1, P.blush);
    D.oval(g, x, y, 3, 4, P.o2);
    R(g, x - 2, y - 1, 1, 3, P.o1);
    R(g, x - 1, y - 2, 2, 1, P.o3);
    R(g, x + 1, y - 3, 1, 7, P.k0);
    R(g, x + 2, y - 2, 1, 2, P.gl1);
    R(g, x + 2, y + 1, 1, 2, P.gl1);
    if (tilt) R(g, x + 2, y + 3, 1, 1, P.blush);
    R(g, x + 4, y, 1, 1, P.cream);
  } else {
    // Almendrita: brown face, black saddle, grey muzzle, pink bow on the top-knot.
    const T = '#cc8c4c', T0 = '#9a6030', T1 = '#d8d0ca', B = '#2a2430';
    R(g, x - 2, y - 5, 2, 2, T0);
    R(g, x - 2, y + 4, 2, 2, T0);
    R(g, x - 2, y - 5, 1, 1, B);
    R(g, x - 2, y + 5, 1, 1, B);
    D.disc(g, x, y, 3, T);
    D.oval(g, x - 1, y, 2, 3, B);
    D.oval(g, x + 3, y, 2, 1, T1);
    R(g, x + 5, y, 1, 1, '#2a2030');
    R(g, x - 1, y - 2, 2, 1, P.r2);
    R(g, x - 1, y + 1, 2, 1, P.r2);
    R(g, x - 1, y - 1, 2, 2, P.r0);
    if (tilt) R(g, x + 2, y + 2, 1, 1, P.eye);
  }
}

/* ── Banked frames, one painter per plane ───────────────────────────────── */

function avionetaGiro(g: Ctx, v: View, has: Has) {
  const Y = '#ffd84a', Y0 = '#e8a828', Y1 = '#fff2a8';
  const WING: [string, string, string] = [Y0, Y, Y1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(15 * s);
  const tspan = ri(6 * s);
  const hy = bodyH(v, 3, 2);
  // Far side first: the hidden half of the tail plane and the far wing.
  if (has('cola')) wing(g, 0, -1, tspan, [-14, -9], [-13, -11], WING);
  wing(g, wy, -1, span, [-5, 6], [-4, 4], WING, P.red);
  // Fuselage: lit from above, the spine moving to the middle as it rolls.
  D.oval(g, 0, 0, 10, hy, Y0);
  D.oval(g, 0, -ri(c), 9, Math.max(1, hy - 1), Y);
  R(g, -7, -ri((hy - 1) * c), 11, 1, Y1);
  if (k === 1) R(g, -8, hy - 1, 16, 1, P.r1);
  else if (k === 2) R(g, -8, hy, 14, 1, P.r1);
  for (const x of [-3, 5]) R(g, x, -hy + 1, 1, hy * 2 - 1, Y0);
  // Near half of the tail plane, then the fin standing towards us.
  if (has('cola')) {
    wing(g, 0, 1, tspan, [-14, -9], [-13, -11], WING);
    const top = -ri(7 * c), base = -ri(2 * c);
    if (top === base) {
      R(g, -14, 0, 5, 1, Y0);
      R(g, -12, 0, 1, 1, P.r1);
    } else {
      trap(g, top, base, -13, -11, -14, -10, Y);
      R(g, -13, top, 3, 1, Y1);
      trap(g, top, base, -12, -12, -12, -12, P.r1);
    }
  } else stub(g, -11, -1, 2, 3);
  if (has('motor')) {
    D.disc(g, 9, 0, 2, P.r0);
    R(g, 8, -1, 2, 2, P.r2);
    R(g, 8, -1, 1, 1, P.r3);
    R(g, 11, -1, 2, 2, P.metal);
    R(g, 7, -2, 1, 1, P.metal0);
    R(g, 7, 1, 1, 1, P.metal0);
  } else stub(g, 7, -2, 2, 4);
  if (has('ala')) wing(g, wy, 1, span, [-5, 6], [-4, 4], WING, P.red);
  else stub(g, -1, wy + 1, 3, 2);
  // Cockpit: the rim, Lulu and the windscreen.
  if (k === 1) {
    R(g, -3, -3, 6, 1, Y0);
    sideHead(g, 'avioneta', 0, -2);
    if (has('cabina')) {
      R(g, 4, -5, 1, 3, P.gl1);
      R(g, 3, -4, 1, 2, P.gl0);
    } else R(g, 4, -3, 1, 1, P.gl0);
  } else {
    const hyC = -ri(3 * c);
    R(g, -4, hyC - 2, 7, 5, Y0);
    topHead(g, 'avioneta', -1, hyC, k === 2 ? 1 : 0);
    if (has('cabina')) {
      R(g, 4, hyC - 2, 1, 5, P.gl0);
      R(g, 5, hyC - 1, 1, 3, P.gl1);
    } else R(g, 4, hyC, 1, 1, P.gl0);
  }
}

function cazaGiro(g: Ctx, v: View, has: Has) {
  const O = P.o2, O0 = P.o1, O1 = P.o3;
  const WING: [string, string, string] = [O0, O, O1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(11 * s);
  const tspan = ri(5 * s);
  const hy = bodyH(v, 3, 2);
  if (has('cola')) wing(g, 0, -1, tspan, [-15, -10], [-14, -12], WING);
  // Swept delta wing: long root chord, short tip well behind it.
  wing(g, wy, -1, span, [-9, 5], [-8, -5], WING, P.red);
  if (has('motor')) {
    R(g, -15, -2, 3, 4, P.metal0);
    R(g, -15, -1, 1, 2, '#2a2438');
  } else stub(g, -13, -2, 2, 4);
  D.oval(g, -1, 0, 12, hy, O0);
  D.oval(g, -1, -ri(c), 11, Math.max(1, hy - 1), O);
  R(g, -8, -ri((hy - 1) * c), 12, 1, O1);
  // Pointed nose, symmetric from above.
  const nose = Math.max(1, hy - 1);
  for (let x = 10; x <= 16; x++) {
    const h = ri(nose * (1 - (x - 10) / 7));
    R(g, x, -h, 1, h * 2 + 1, x < 15 ? O : O0);
  }
  R(g, 10, -ri(c) - (k === 1 ? 1 : 0), 4, 1, O1);
  if (k === 1) R(g, -10, hy - 1, 18, 1, P.cream);
  // Intakes on both flanks once we look down on it.
  if (k > 1) {
    R(g, -1, -hy, 3, 1, '#7a3a2a');
    R(g, -1, hy, 3, 1, '#7a3a2a');
  } else R(g, 0, 0, 2, 2, '#7a3a2a');
  if (has('cola')) {
    wing(g, 0, 1, tspan, [-15, -10], [-14, -12], WING);
    const top = -ri(8 * c), base = -ri(2 * c);
    if (top === base) {
      R(g, -14, 0, 5, 1, O0);
      R(g, -13, 0, 2, 1, P.cream);
    } else {
      trap(g, top, base, -13, -11, -14, -10, O);
      R(g, -13, top, 3, 1, O1);
      R(g, -12, top + 1, 1, Math.max(1, base - top - 2), P.cream);
    }
  } else stub(g, -11, -1, 2, 3);
  if (has('ala')) {
    wing(g, wy, 1, span, [-9, 5], [-8, -5], WING, P.red);
    // White chevron on the near wing.
    const y = wy + ri(span * 0.6);
    R(g, -6, y, 4, 1, P.white);
  } else stub(g, -3, wy + 1, 3, 2);
  // Bubble canopy with Dui inside.
  if (k === 1) {
    D.oval(g, 4, -3, 4, 2, P.gl0);
    sideHead(g, 'caza', 3, -1);
    g.globalAlpha = 0.45;
    D.oval(g, 4, -3, 3, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 5, -5, 2, 1, P.white);
  } else {
    const cy = -ri(3 * c);
    D.oval(g, 3, cy, 5, 3, P.gl0);
    topHead(g, 'caza', 2, cy, k === 2 ? 1 : 0);
    g.globalAlpha = 0.4;
    D.oval(g, 4, cy - 1, 3, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 6, cy - 2, 2, 1, P.white);
  }
}

/** Bombardero engine nacelle on a wing, centred at (x, y). */
function nacelle(g: Ctx, y: number, top: boolean) {
  D.oval(g, 7, y, 4, top ? 1 : 2, P.metal0);
  D.oval(g, 7, y - (top ? 0 : 1), 3, 1, P.metal);
  R(g, 3, y, 1, 1, '#2a2438');
}

/** Spanwise (d) and below-wing (e) position of the bombardero's engines. */
const BOMB_ENG = { d: 8, e: 3 };

function bombarderoGiro(g: Ctx, v: View, has: Has) {
  const B = '#9ad0ff', B0 = '#5a9ae0', B1 = '#d8f0ff';
  const WING: [string, string, string] = [B0, B, B1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(20 * s);
  const tspan = ri(9 * s);
  const hy = bodyH(v, 5, 4);
  const eFar = ri(BOMB_ENG.e * c - BOMB_ENG.d * s);
  const eNear = ri(BOMB_ENG.e * c + BOMB_ENG.d * s);
  if (has('cola')) wing(g, -1, -1, tspan, [-21, -13], [-19, -16], WING);
  wing(g, wy, -1, span, [-10, 5], [-7, 1], WING, P.red);
  if (has('motor')) nacelle(g, eFar, k === 3);
  else if (k > 1) stub(g, 5, eFar - 1, 3, 2);
  D.oval(g, 0, 0, 16, hy, B0);
  D.oval(g, 0, -ri(c), 15, Math.max(1, hy - 1), B);
  R(g, -11, -ri((hy - 1) * c), 18, 1, B1);
  if (k === 1) {
    R(g, -15, hy - 2, 29, 1, P.white);
    for (let i = 0; i < 3; i++) {
      D.disc(g, -9 + i * 5, -1, 1, P.gl0);
      R(g, -9 + i * 5, -2, 1, 1, P.white);
    }
  }
  for (const x of [-13, -6, -1, 10]) R(g, x, -hy + 1, 1, hy * 2 - 1, B0);
  if (has('cabina')) {
    D.disc(g, 14, 0, 3, P.gl0);
    D.disc(g, 14, -ri(c), 2, P.gl1);
    R(g, 14, -ri(2 * c) - (k === 3 ? 1 : 0), 2, 1, P.white);
  } else stub(g, 12, -2, 2, 4);
  if (has('cola')) {
    wing(g, -1, 1, tspan, [-21, -13], [-19, -16], WING);
    const top = -ri(10 * c), base = -ri(4 * c);
    if (top === base) {
      R(g, -20, 0, 7, 1, B0);
      R(g, -18, 0, 3, 1, P.r1);
    } else {
      trap(g, top, base, -19, -15, -16, -12, B);
      R(g, -19, top, 5, 1, B1);
      trap(g, top, base, -18, -18, -15, -15, P.r1);
    }
  } else stub(g, -15, -2, 2, 4);
  if (has('ala')) wing(g, wy, 1, span, [-10, 5], [-7, 1], WING, P.red);
  else stub(g, -3, wy + 1, 3, 3);
  if (has('motor')) nacelle(g, eNear, k === 3);
  else stub(g, 5, eNear - 1, 3, 2);
  if (!has('bodega') && k === 1) R(g, -7, hy - 1, 9, 1, '#2a2438');
  // Dorsal cockpit with Almendrita.
  if (k === 1) {
    D.oval(g, 6, -5, 3, 2, P.gl0);
    sideHead(g, 'bombardero', 6, -3);
    g.globalAlpha = 0.45;
    D.oval(g, 6, -5, 2, 1, P.gl1);
    g.globalAlpha = 1;
  } else {
    const cy = -ri(4 * c);
    D.oval(g, 6, cy, 5, 3, P.gl0);
    topHead(g, 'bombardero', 5, cy, k === 2 ? 1 : 0);
    g.globalAlpha = 0.4;
    D.oval(g, 7, cy - 1, 3, 1, P.gl1);
    g.globalAlpha = 1;
  }
}

const GIRO: Record<ModeloAvion, (g: Ctx, v: View, has: Has) => void> = {
  avioneta: avionetaGiro, caza: cazaGiro, bombardero: bombarderoGiro,
};

/** The banked sprite for frame k (1..3) with the given parts missing. */
export function giroSprite(m: ModeloAvion, k: 1 | 2 | 3, lost: readonly Parte[] = []) {
  const L = LOOKS[m];
  const H = GIRO_H[m];
  const key = lost.length ? [...lost].sort().join(',') : '';
  const v = VIEWS[k];
  return D.outlined(`giro|${m}|${k}|${key}`, L.ink, L.w, H, L.w / 2, H / 2, (g) => {
    GIRO[m](g, v, (p) => !lost.includes(p));
    if (lost.length) scorch(g, lost.length, m.length + k, bodyH(v, 3, 2));
  });
}

/* ── Live parts: propellers, flame, scarf, sparks ───────────────────────── */

/** Propeller hubs [x, y, r] in banked frame k. */
function propsFor(m: ModeloAvion, v: View): [number, number, number][] {
  if (m === 'avioneta') return [[12, 0, 4]];
  if (m === 'bombardero') {
    const { d, e } = BOMB_ENG;
    const near: [number, number, number] = [10, ri(e * v.c + d * v.s), 3];
    // At 30° the far engine hides behind the fuselage.
    return v.k === 1 ? [near] : [[10, ri(e * v.c - d * v.s), 3], near];
  }
  return [];
}

/** Where the scarf starts in banked frame k. */
function scarfAt(m: ModeloAvion, v: View): [number, number] {
  if (v.k === 1) {
    const [x, y] = LOOKS[m].scarf;
    return [x, ri(y * v.c)];
  }
  const head = m === 'avioneta' ? [-1, -ri(3 * v.c)] : m === 'caza' ? [2, -ri(3 * v.c)] : [5, -ri(4 * v.c)];
  return [head[0] - 3, head[1] + 1];
}

/** Lost-part anchor projected into banked frame k. */
function anchorAt(m: ModeloAvion, part: Parte, v: View): [number, number] {
  const [ax, ay] = LOOKS[m].parts[part] ?? [0, 0];
  if (part === 'ala') return [ax, ri(2 * v.c) + 2];
  if (part === 'motor' && m === 'bombardero') return [ax, ri(BOMB_ENG.e * v.c + BOMB_ENG.d * v.s)];
  return [ax, ri(ay * v.c)];
}

/**
 * Which frame is drawn: 0 upright side, 1/2 banked 30°/60°, 3 plan view,
 * 4/5 the mirrored 60°/30°, 6 inverted side. `alabeo` = cos(roll); a hard
 * pull (|carga| from 3.5 g up) leans the plane towards the plan view so tight
 * loops show both wings.
 */
export function framePara(alabeo: number, carga: number): number {
  let phi = Math.acos(clamp(Number.isFinite(alabeo) ? alabeo : 1, -1, 1));
  const g = Number.isFinite(carga) ? Math.abs(carga) : 1;
  const lean = clamp((g - 3.5) / 2, 0, 1) * (Math.PI / 2);
  phi = phi <= Math.PI / 2 ? Math.max(phi, lean) : Math.min(phi, Math.PI - lean);
  return clamp(ri(phi / (Math.PI / 6)), 0, 6);
}

/**
 * The plane at (x, y) on screen, nose along `angle` (screen radians, y down),
 * rolled by `alabeo` = cos φ and leaning into hard pulls (`carga`, in g).
 * Same contract as drawPlane: `t` animates the propeller, the flame and the
 * scarf, `gas` sizes the flame, `blink` hides the airframe, `lost` lists the
 * parts already shot off.
 */
export function drawPlaneGiro(
  g: Ctx, m: ModeloAvion, x: number, y: number, angle: number, alabeo: number,
  carga: number, t: number, gas: number, blink: boolean, lost: readonly Parte[],
): void {
  const f = framePara(alabeo, carga);
  if (f === 0 || f === 6) {
    drawPlane(g, m, x, y, angle, f === 0 ? 1 : -1, t, gas, blink, lost);
    return;
  }
  const k = (f > 3 ? 6 - f : f) as 1 | 2 | 3;
  const v = VIEWS[k];
  const L = LOOKS[m];
  const H = GIRO_H[m];
  const img = giroSprite(m, k, lost);
  g.save();
  g.translate(ri(x), ri(y));
  g.rotate(ri(angle / 0.02) * 0.02 + (lost.includes('ala') ? 0.05 : 0));
  if (f > 3) g.scale(1, -1);
  // Scarf flapping behind the pilot (sideways in the plan view). From 60° on it
  // lies over the fuselage's back, so it goes on top of the sprite.
  const [sx0, sy0] = scarfAt(m, v);
  const scarf = () => {
    for (let i = 0; i < 4; i++) {
      const wave = ri(Math.sin(t * 18 - i * 0.9) * (i * 0.4));
      R(g, sx0 - 3 - i * 2, sy0 + wave + (i > 1 ? 1 : 0), 2, 1, L.scarfC[i % 2]);
    }
  };
  if (k === 1) scarf();
  if (!blink) g.drawImage(img, -L.w / 2, -H / 2);
  if (k > 1) scarf();
  const engine = !lost.includes('motor');
  if (engine) {
    // The prop disc is always seen edge-on: a flickering blade over a blur.
    const ph = Math.floor(t * 40) % 3;
    for (const [px, py, r] of propsFor(m, v)) {
      const hgt = [r, Math.max(1, r - 2), 1][ph];
      g.globalAlpha = 0.7;
      R(g, px + 1, py - hgt, 1, hgt * 2, P.metal);
      g.globalAlpha = 0.3;
      R(g, px + 1, py - r, 1, r * 2, P.white);
      g.globalAlpha = 1;
    }
    if (L.jet) {
      const [jx, jy] = L.jet;
      const len = 2 + ri(gas * 5) + (Math.floor(t * 30) % 2);
      D.oval(g, jx - len / 2, jy, Math.ceil(len / 2) + 1, 1, '#ff9a3c');
      R(g, jx - Math.ceil(len / 2), jy, Math.ceil(len / 2), 1, P.gold);
      R(g, jx - 1, jy, 1, 1, P.white);
    }
  }
  for (const part of lost) {
    const [ax, ay] = anchorAt(m, part, v);
    const fl = Math.floor(t * 16 + ax * 3) % 4;
    if (fl === 3) continue;
    R(g, ax + (fl - 1), ay - 1 + (fl % 2), fl === 0 ? 2 : 1, 1, fl === 1 ? P.gold : '#ff4a3c');
    if (fl === 0) R(g, ax, ay + 1, 1, 1, P.gold1);
  }
  g.restore();
}
