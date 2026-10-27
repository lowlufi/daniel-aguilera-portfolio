import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { LOOKS, R, drawPlane, miniHead, ovniGlow, ovniLuces, pilotoActual, spriteParaDibujar, type Parte } from './dibujo';
import type { ModeloAvion, Piloto } from './fisica-tipos';

/*
 * Roll and hard-pull frames for every player plane. The cockpit always shows
 * the current pilot (dibujo.ts's fijarPiloto), who is part of the cache key.
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
const GIRO_H: Record<ModeloAvion, number> = { avioneta: 38, caza: 30, bombardero: 50, raptor: 32, sukhoi: 34, b2: 48, ovni: 36, tomcat: 34, a10: 46, spitfire: 38,
  stuka: 42, mustang: 36, corsair: 38, f16: 34, mig29: 36,
};

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

/** Side head for the 30° frame: the same cockpit head as the side sprite. */
const sideHead = (g: Ctx, x: number, y: number) => miniHead(g, pilotoActual(), x, y);

/**
 * The pilot's head seen from above, facing +x; (x, y) is the head's centre.
 * `tilt` (0 or 1) lets the 60° frame show a sliver of the face's flank.
 */
function topHead(g: Ctx, x: number, y: number, tilt: number, m: Piloto = pilotoActual()) {
  if (m === 'naxo') {
    // Naxo: short dark hair, ears to both sides, the round dark lenses and the mustache in front.
    const S = '#9a5c30', S0 = '#6e3e1e';
    R(g, x - 1, y - 4, 2, 1, S0);
    R(g, x - 1, y + 4, 2, 1, S0);
    D.disc(g, x, y, 3, '#2a1e1a');
    R(g, x - 1, y - 1, 2, 1, '#4a3a32');
    R(g, x + 2, y - 2, 2, 5, S);
    R(g, x + 2, y - 2, 1, 2, '#1c1622');
    R(g, x + 2, y + 1, 1, 2, '#1c1622');
    R(g, x + 4, y, 1, 1, S);
    if (tilt) R(g, x + 3, y + 2, 2, 1, '#2a1e1a');
  } else if (m === 'nelo') {
    // Ñelo: the black cap from above, its visor forward, the hood behind.
    const C = '#1e1c24';
    R(g, x - 5, y - 2, 2, 5, '#26242c');
    R(g, x - 1, y - 4, 2, 1, '#6e3e1e');
    R(g, x - 1, y + 4, 2, 1, '#6e3e1e');
    D.disc(g, x, y, 3, C);
    R(g, x + 3, y - 2, 2, 5, C);
    R(g, x + 5, y - 1, 1, 3, C);
    R(g, x - 1, y - 1, 2, 2, '#3e3c4a');
    if (tilt) R(g, x + 2, y + 3, 2, 1, '#9a5c30');
  } else if (m === 'lulu') {
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
  } else if (m === 'dui') {
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
    sideHead(g, 0, -2);
    if (has('cabina')) {
      R(g, 4, -5, 1, 3, P.gl1);
      R(g, 3, -4, 1, 2, P.gl0);
    } else R(g, 4, -3, 1, 1, P.gl0);
  } else {
    const hyC = -ri(3 * c);
    R(g, -4, hyC - 2, 7, 5, Y0);
    topHead(g, -1, hyC, k === 2 ? 1 : 0);
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
    sideHead(g, 3, -1);
    g.globalAlpha = 0.45;
    D.oval(g, 4, -3, 3, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 5, -5, 2, 1, P.white);
  } else {
    const cy = -ri(3 * c);
    D.oval(g, 3, cy, 5, 3, P.gl0);
    topHead(g, 2, cy, k === 2 ? 1 : 0);
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
    sideHead(g, 6, -3);
    g.globalAlpha = 0.45;
    D.oval(g, 6, -5, 2, 1, P.gl1);
    g.globalAlpha = 1;
  } else {
    const cy = -ri(4 * c);
    D.oval(g, 6, cy, 5, 3, P.gl0);
    topHead(g, 5, cy, k === 2 ? 1 : 0);
    g.globalAlpha = 0.4;
    D.oval(g, 7, cy - 1, 3, 1, P.gl1);
    g.globalAlpha = 1;
  }
}

/* ── The stealth jets, the flying wing and the saucer ───────────────────── */

const GOLD_GL = '#7a6a3a', GOLD_HI = '#ffd878', GOLD_W = '#fff6b0';

/** Gold-tinted bubble canopy in frame k: centre x, pilot's chin hx in the side view. */
function goldCanopyGiro(g: Ctx, v: View, x: number, hx: number) {
  if (v.k === 1) {
    D.oval(g, x, -3, 5, 2, GOLD_GL);
    sideHead(g, hx, -1);
    g.globalAlpha = 0.45;
    D.oval(g, x, -3, 4, 1, GOLD_HI);
    g.globalAlpha = 1;
    R(g, x + 1, -5, 2, 1, GOLD_W);
  } else {
    const cy = -ri(3 * v.c);
    D.oval(g, x - 1, cy, 5, 3, GOLD_GL);
    topHead(g, hx - 1, cy, v.k === 2 ? 1 : 0);
    g.globalAlpha = 0.45;
    D.oval(g, x, cy - 1, 3, 1, GOLD_HI);
    g.globalAlpha = 1;
    R(g, x + 1, cy - 2, 2, 1, GOLD_W);
  }
}

/**
 * A fin canted outwards, standing on the fuselage at spanwise d (− far, + near)
 * and height hBase. base/top = [trailing x, leading x] at its root and tip.
 */
function cantedFin(
  g: Ctx, v: View, d: number, hBase: number, h: number,
  base: [number, number], top: [number, number], col: string, colTop: string,
) {
  const yb = -ri(hBase * v.c) + ri(d * v.s);
  const yt = yb - ri(h * v.c) + Math.sign(d) * ri(2 * v.s);
  if (yt === yb) {
    R(g, base[0], yb, base[1] - base[0] + 1, 1, col);
    return;
  }
  trap(g, yt, yb, top[0], top[1], base[0], base[1], col);
  R(g, top[0], yt, top[1] - top[0] + 1, 1, colTop);
}

function raptorGiro(g: Ctx, v: View, has: Has) {
  const G0 = '#4e5666', G = '#7c8698', G1 = '#a4adbd', CAM = '#68717f', DK = '#262a36';
  const WING: [string, string, string] = [G0, G, G1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(12 * s);
  const tspan = ri(5 * s);
  const hy = bodyH(v, 3, 3);
  if (has('cola')) {
    wing(g, ri(c), -1, tspan, [-18, -12], [-17, -15], WING);
    cantedFin(g, v, -3, 2, 5, [-13, -10], [-17, -14], G0, G);
  }
  // Diamond wing: swept leading edge, forward-swept trailing edge, clipped tip.
  wing(g, wy, -1, span, [-11, 4], [-8, -5], WING);
  D.oval(g, -1, 0, 15, hy, G0);
  D.oval(g, -1, -ri(c), 14, Math.max(1, hy - 1), G);
  R(g, -11, -ri((hy - 1) * c), 15, 1, G1);
  R(g, -10, -ri(c) - 1, 6, 2, CAM);
  R(g, -2, ri(c), 3, 1, CAM);
  // Chined nose, a sharp diamond from any angle.
  const nose = Math.max(1, hy - 1);
  for (let x = 13; x <= 17; x++) {
    const h = ri(nose * (1 - (x - 13) / 5));
    R(g, x, -h, 1, h * 2 + 1, x < 16 ? G : G0);
  }
  if (k === 1) R(g, 7, 1, 8, 1, G1);
  if (has('motor')) {
    R(g, -18, -hy + 1, 3, hy * 2 - 1, G0);
    if (k === 1) R(g, -18, -1, 1, 2, DK);
    else {
      R(g, -18, -ri(2 * s), 1, 1, DK);
      R(g, -18, ri(2 * s), 1, 1, DK);
    }
  } else stub(g, -16, -2, 2, 4);
  if (k > 1) {
    R(g, 1, -hy, 3, 1, DK);
    R(g, 1, hy, 3, 1, DK);
  } else R(g, 2, 0, 3, 2, DK);
  if (has('cola')) {
    wing(g, ri(c), 1, tspan, [-18, -12], [-17, -15], WING);
    cantedFin(g, v, 3, 2, 5, [-13, -10], [-17, -14], G, G1);
  } else stub(g, -13, -1, 2, 3);
  if (has('ala')) wing(g, wy, 1, span, [-11, 4], [-8, -5], WING);
  else stub(g, -3, wy + 1, 3, 2);
  goldCanopyGiro(g, v, 6, 5);
}

function sukhoiGiro(g: Ctx, v: View, has: Has) {
  const B0 = '#46546e', B = '#7888a6', B1 = '#a6b4cc', S1 = '#5a6a8a', S2 = '#93a3be', DK = '#262a36';
  const WING: [string, string, string] = [B0, B, B1];
  const { s, c, k } = v;
  const wy = ri(3 * c);
  const span = ri(13 * s);
  const tspan = ri(6 * s);
  const lspan = ri(5 * s);
  const hy = bodyH(v, 3, 2);
  // Engines far apart under the body.
  const eY = ri(2 * c);
  const eFar = eY - ri(4 * s), eNear = eY + ri(4 * s);
  const nacelle = (y: number) => {
    D.oval(g, -9, y, 9, 1, B0);
    R(g, -16, y - 1, 14, 1, B);
    R(g, -19, y - 1, 2, 3, P.metal0);
    R(g, -19, y, 1, 1, DK);
    R(g, 0, y - 1, 2, 3, DK);
  };
  if (has('cola')) {
    wing(g, eFar, -1, tspan, [-19, -13], [-18, -16], WING);
    cantedFin(g, v, -4, 2, 4, [-15, -12], [-17, -14], B0, B);
  }
  wing(g, wy, -1, span, [-12, 3], [-9, -5], WING);
  // Leading-edge extension: a sharp triangle reaching for the cockpit.
  wing(g, wy, -1, lspan, [3, 11], [3, 4], WING);
  if (has('motor') && k > 1) nacelle(eFar);
  D.oval(g, 0, 0, 16, hy, B0);
  D.oval(g, 0, -ri(c), 15, Math.max(1, hy - 1), B);
  R(g, -8, -ri((hy - 1) * c), 13, 1, B1);
  // Splinter camo.
  R(g, -12, -ri(c), 4, 1, S1);
  R(g, -11, -ri(c) + 1, 4, 1, S1);
  R(g, -4, -ri(c) - (hy > 2 ? 1 : 0), 5, 1, S2);
  R(g, 9, -ri(c), 3, 1, S1);
  const nose = Math.max(1, hy - 1);
  for (let x = 15; x <= 18; x++) {
    const h = ri(nose * (1 - (x - 15) / 4));
    R(g, x, -h, 1, h * 2 + 1, x < 17 ? B : B0);
  }
  if (k > 1) R(g, -19, 0, 4, 1, B);
  if (has('cola')) {
    wing(g, eNear, 1, tspan, [-19, -13], [-18, -16], WING);
    cantedFin(g, v, 4, 2, 4, [-15, -12], [-17, -14], B, B1);
  } else stub(g, -14, -1, 2, 3);
  if (has('ala')) {
    wing(g, wy, 1, span, [-12, 3], [-9, -5], WING);
    R(g, -7, wy + ri(span * 0.5), 3, 1, S1);
  } else stub(g, -3, wy + 1, 3, 2);
  wing(g, wy, 1, lspan, [3, 11], [3, 4], WING);
  if (has('motor')) nacelle(eNear);
  else stub(g, -14, eNear - 1, 2, 3);
  if (has('cabina')) goldCanopyGiro(g, v, 8, 7);
  else if (k === 1) sideHead(g, 7, -1);
  else topHead(g, 6, -ri(3 * c), k === 2 ? 1 : 0);
}

/** B-2 trailing edge x at spanwise distance d (0 centre … 20 tip): the W sawtooth. */
const B2_TE: [number, number][] = [[0, -17], [3, -12], [8, -18], [13, -11], [20, -24]];
function b2Te(d: number) {
  for (let i = 1; i < B2_TE.length; i++) {
    const [d1, x1] = B2_TE[i];
    if (d <= d1) {
      const [d0, x0] = B2_TE[i - 1];
      return x0 + ((x1 - x0) * (d - d0)) / (d1 - d0);
    }
  }
  return -24;
}

/** One half of the B-2's wing, `rows` screen rows from y0 towards dir, out to maxD. */
function b2Wing(g: Ctx, y0: number, dir: 1 | -1, rows: number, maxD: number, col: [string, string, string, string]) {
  const [K0, K, K1, K3] = col;
  for (let i = 0; i <= rows; i++) {
    const d = rows ? (20 * i) / rows : 0;
    if (d > maxD) break;
    const x0 = ri(b2Te(d)), x1 = ri(17 - 2 * d);
    if (x1 < x0) continue;
    const y = y0 + i * dir;
    R(g, x0, y, x1 - x0 + 1, 1, K1);
    if (x1 - x0 > 5) R(g, x0 + 1, y, 2, 1, K);
    R(g, x0, y, 1, 1, K0);
    R(g, x1, y, 1, 1, K3);
  }
}

function b2Giro(g: Ctx, v: View, has: Has) {
  const K0 = '#22242c', K = '#3a3d4a', K1 = '#555a6a', K2 = '#737a8e', K3 = '#9aa2b8';
  const COL: [string, string, string, string] = [K0, K, K1, K3];
  const { s, c, k } = v;
  const rows = ri(20 * s);
  const y0 = ri(c);
  // The boomerang: both halves of the wing, then the hump on top of them.
  b2Wing(g, y0, -1, rows, 20, COL);
  if (has('ala')) b2Wing(g, y0, 1, rows, 20, COL);
  else {
    b2Wing(g, y0, 1, rows, 6, COL);
    stub(g, -16, y0 + ri(rows * 0.3) + 1, 3, 2);
  }
  const hh = bodyH(v, 3, 5);
  D.oval(g, 3, -ri(2 * c), 14, hh, K1);
  D.oval(g, 4, -ri(3 * c), 10, Math.max(1, hh - 2), K2);
  for (let x = 18; x <= 20; x++) {
    const h = Math.min(20 - x, Math.max(0, hh - 2));
    R(g, x, -ri(c) - h, 1, h * 2 + 1, K1);
  }
  if (has('motor')) {
    for (const sg of [-1, 1]) {
      const iy = -ri(4 * c) + sg * ri(3 * s);
      R(g, -1, iy, 5, 1, '#121218');
      R(g, 4, iy, 1, 1, K3);
      const ey = -ri(c) + sg * ri(6 * s);
      R(g, -15, ey, 6, 1, K0);
      R(g, -15, ey, 2, 1, P.metal0);
    }
  } else stub(g, 0, -ri(4 * c) - 1, 3, 2);
  // The cockpit at the front of the hump.
  const glass = has('cabina');
  if (k === 1) {
    if (glass) D.oval(g, 11, -3, 4, 2, '#3a4a6a');
    sideHead(g, 11, -1);
    if (glass) {
      g.globalAlpha = 0.4;
      D.oval(g, 11, -3, 3, 1, P.gl1);
      g.globalAlpha = 1;
    }
    R(g, 14, -3, 2, 1, glass ? P.gl1 : '#14141c');
  } else {
    const cy = -ri(4 * c);
    if (glass) D.oval(g, 11, cy, 4, 3, '#3a4a6a');
    topHead(g, 10, cy, k === 2 ? 1 : 0);
    if (glass) {
      g.globalAlpha = 0.4;
      D.oval(g, 12, cy - 1, 2, 1, P.gl1);
      g.globalAlpha = 1;
    }
    R(g, 14, cy - 2, 2, 1, glass ? P.gl1 : '#14141c');
    R(g, 14, cy + 2, 2, 1, glass ? P.gl1 : '#14141c');
  }
}

const OM0 = '#7a8098', OM = '#b8c0d4', OM1 = '#e0e6f0';

/** Height of the saucer's disc ellipse in frame k: a flat lens turning into a full circle. */
const ovniRy = (v: View) => bodyH(v, 3, 15);

function ovniGiro(g: Ctx, v: View, has: Has) {
  const { c, k } = v;
  const ry = ovniRy(v);
  // Underside lip below the rim, the top plate, then the raised centre.
  D.oval(g, 0, ri(2 * c), 15, ry, OM0);
  D.oval(g, 0, 0, 15, ry, OM);
  D.oval(g, 0, -ri(c), 11, Math.max(1, ri(ry * 0.72)), OM1);
  D.oval(g, 0, -ri(c), 9, Math.max(1, ri(ry * 0.58)), OM);
  if (!has('ala')) {
    g.clearRect(-16, -2, 4, 5);
    stub(g, -12, -1, 2, 3);
  }
  // The glass dome, sliding to the middle as we look down on it.
  const dy = -ri(4 * c);
  if (has('cabina')) D.oval(g, 0, dy, 7, 6, P.gl0);
  else {
    R(g, -7, dy, 2, 3, P.gl0);
    R(g, 5, dy - 1, 2, 3, P.gl0);
  }
  if (k === 1) sideHead(g, 1, dy + 2);
  else topHead(g, 0, dy, k === 2 ? 1 : 0);
  if (has('cabina')) {
    g.globalAlpha = 0.4;
    D.oval(g, 0, dy - 1, 6, 4, P.gl1);
    g.globalAlpha = 1;
    R(g, -4, dy - 4, 2, 1, P.white);
    R(g, -5, dy - 3, 1, 1, P.white);
  }
}

/* ── Tomcat, Warthog and Spitfire ───────────────────────────────────────── */

function tomcatGiro(g: Ctx, v: View, has: Has) {
  const G0 = '#56627a', G = '#8a97ab', G1 = '#b2bdcc', G2 = '#d6dde7', DK = '#262a36';
  const WING: [string, string, string] = [G0, G, G1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(14 * s);
  const gspan = ri(4 * s);
  const tspan = ri(6 * s);
  const hy = bodyH(v, 3, 4);
  const FIN_B: [number, number] = [-16, -11], FIN_T: [number, number] = [-17, -14];
  if (has('cola')) {
    wing(g, ri(c), -1, tspan, [-19, -13], [-18, -16], WING);
    cantedFin(g, v, -3, 2, 6, FIN_B, FIN_T, G0, G);
  }
  // Swing wing fully swept back (tip far behind the root) and the fixed glove ahead of it.
  wing(g, wy, -1, span, [-10, 0], [-16, -13], WING);
  wing(g, wy, -1, gspan, [-4, 8], [-3, -1], WING);
  D.oval(g, -1, 0, 16, hy, G0);
  D.oval(g, -1, -ri(c), 15, Math.max(1, hy - 1), G);
  R(g, -12, -ri((hy - 1) * c), 14, 1, G1);
  const nose = Math.max(1, hy - 1);
  for (let x = 15; x <= 18; x++) {
    const h = ri(nose * (1 - (x - 15) / 4));
    R(g, x, -h, 1, h * 2 + 1, x < 17 ? G : G0);
  }
  if (k === 1) R(g, -14, hy - 1, 22, 1, G2);
  // Big boxy intakes on both flanks once we look down on it.
  if (k > 1) {
    for (const y of [-hy - 1, hy]) {
      R(g, -4, y, 8, 2, G0);
      R(g, 3, y, 1, 2, DK);
    }
  } else {
    R(g, -4, 0, 8, 3, G0);
    R(g, 4, 0, 1, 3, G2);
    R(g, 3, 1, 1, 2, DK);
  }
  // Twin nozzles far apart, the far one showing above the near one from 30° on.
  if (has('motor')) {
    for (const sg of [-1, 1]) {
      const y = sg * ri(3 * s);
      R(g, -19, y - 1, 3, 3, P.metal0);
      R(g, -18, y - 1, 2, 1, P.metal);
      R(g, -19, y, 1, 1, DK);
    }
  } else stub(g, -17, -2, 2, 4);
  if (has('cola')) {
    wing(g, ri(c), 1, tspan, [-19, -13], [-18, -16], WING);
    cantedFin(g, v, 3, 2, 6, FIN_B, FIN_T, G, G1);
  } else stub(g, -14, -1, 2, 3);
  if (has('ala')) wing(g, wy, 1, span, [-10, 0], [-16, -13], WING);
  else stub(g, -7, wy + 1, 3, 2);
  wing(g, wy, 1, gspan, [-4, 8], [-3, -1], WING);
  // Long two-seat canopy.
  const glass = has('cabina');
  if (k === 1) {
    if (glass) {
      D.oval(g, 7, -4, 6, 2, P.gl0);
      R(g, 2, -5, 2, 3, '#3a4258');
    } else R(g, 1, -3, 12, 1, G0);
    sideHead(g, 9, -2);
    if (glass) {
      R(g, 5, -6, 1, 4, G0);
      g.globalAlpha = 0.45;
      D.oval(g, 7, -4, 5, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 10, -6, 2, 1, P.white);
    }
  } else {
    const cy = -ri(3 * c);
    if (glass) {
      D.oval(g, 6, cy, 7, 3, P.gl0);
      R(g, 1, cy - 1, 3, 3, '#6a7690');
      R(g, 1, cy - 1, 1, 3, '#4a5470');
    }
    topHead(g, 9, cy, k === 2 ? 1 : 0);
    if (glass) {
      R(g, 5, cy - 3, 1, 7, G0);
      g.globalAlpha = 0.4;
      D.oval(g, 8, cy - 1, 4, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 10, cy - 2, 2, 1, P.white);
    }
  }
}

/** Spanwise (d) and height (e) of the Warthog's pod engines, high on the rear fuselage. */
const A10_ENG = { d: 4, e: 6 };

function a10Giro(g: Ctx, v: View, has: Has) {
  const A0 = '#4c5644', A = '#77826a', A1 = '#a2ac92', A2 = '#c9d0bb', CM = '#5d684f', DK = '#262a2a';
  const WING: [string, string, string] = [A0, A, A1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(18 * s);
  const tspan = ri(7 * s);
  const ty = -ri(2 * c);
  const hy = bodyH(v, 3, 3);
  // Square fin standing on a tip of the tailplane, at spanwise d.
  const fin = (d: number, col: string, top: string) => {
    const yb = ty + ri(d * s);
    const yt = yb - ri(7 * c);
    if (yt === yb) {
      R(g, -20, yb, 5, 1, col);
      R(g, -20, yb, 1, 1, top);
      return;
    }
    R(g, -20, yt, 4, yb - yt + 2, col);
    R(g, -20, yt, 4, 1, top);
    R(g, -19, yt + 1, 1, yb - yt + 1, A0);
  };
  const pod = (y: number) => {
    D.oval(g, -8, y, 5, 2, A0);
    D.oval(g, -8, y - 1, 4, 1, A);
    R(g, -11, y - 2, 6, 1, A2);
    R(g, -2, y - 1, 1, 3, A2);
    R(g, -3, y - 1, 1, 3, DK);
    R(g, -14, y - 1, 2, 3, P.metal0);
    R(g, -14, y, 1, 1, DK);
  };
  const podY = (sg: number) => -ri(A10_ENG.e * c) + sg * ri(A10_ENG.d * s);
  if (has('cola')) {
    wing(g, ty, -1, tspan, [-20, -14], [-20, -15], WING);
    fin(-7, A0, A);
  }
  // Long, straight wing.
  wing(g, wy, -1, span, [-6, 4], [-4, 2], WING);
  D.oval(g, -1, 0, 17, hy, A0);
  D.oval(g, -1, -ri(c), 16, Math.max(1, hy - 1), A);
  R(g, -12, -ri((hy - 1) * c), 22, 1, A1);
  R(g, -11, -ri(c), 5, 1, CM);
  R(g, 1, -ri(c) + (hy > 2 ? 1 : 0), 4, 1, CM);
  // Blunt nose, the grin under it and the long cannon barrel.
  for (let x = 16; x <= 17; x++) {
    const h = Math.max(0, hy - 1 - (x - 16));
    R(g, x, -h, 1, h * 2 + 1, A);
  }
  if (k === 1) {
    R(g, 10, hy - 2, 1, 1, '#3a2228');
    R(g, 11, hy - 1, 5, 1, '#3a2228');
    R(g, 12, hy - 1, 1, 1, P.white);
    R(g, 14, hy - 1, 1, 1, P.white);
  }
  R(g, 16, ri(2 * c), 4, 1, P.metal0);
  R(g, 19, ri(2 * c), 1, 1, '#2a2438');
  if (has('cola')) {
    wing(g, ty, 1, tspan, [-20, -14], [-20, -15], WING);
    fin(7, A, A1);
  } else stub(g, -16, -2, 2, 3);
  if (has('ala')) {
    wing(g, wy, 1, span, [-6, 4], [-4, 2], WING);
    R(g, -4, wy + ri(span * 0.5), 3, 1, CM);
  } else stub(g, -1, wy + 1, 3, 2);
  // Both pod engines sit on the back, facing the camera from 30° on.
  if (has('motor')) {
    pod(podY(-1));
    pod(podY(1));
  } else stub(g, -9, podY(1) - 1, 3, 2);
  const glass = has('cabina');
  if (k === 1) {
    if (glass) D.oval(g, 10, -4, 4, 2, P.gl0);
    else R(g, 6, -3, 8, 1, A0);
    sideHead(g, 10, -2);
    if (glass) {
      g.globalAlpha = 0.45;
      D.oval(g, 10, -4, 3, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 11, -6, 2, 1, P.white);
    }
  } else {
    const cy = -ri(4 * c);
    if (glass) D.oval(g, 10, cy, 4, 3, P.gl0);
    topHead(g, 10, cy, k === 2 ? 1 : 0);
    if (glass) {
      g.globalAlpha = 0.4;
      D.oval(g, 11, cy - 1, 2, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 12, cy - 2, 2, 1, P.white);
    }
  }
}

/**
 * An elliptical wing seen from above: `rows` rows from y0 towards dir, chord
 * shrinking like an ellipse from [xc-back, xc+fwd] at the root to a round tip.
 * `camo` paints hard-edged blotches over the upper surface.
 */
function ellWing(
  g: Ctx, y0: number, dir: 1 | -1, rows: number, xc: number, back: number, fwd: number,
  col: [string, string, string], camo?: string,
) {
  const [d, m, l] = col;
  if (rows < 1) {
    R(g, xc - back, y0, back + fwd + 1, 1, d);
    return;
  }
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    const f = Math.sqrt(Math.max(0, 1 - u * u * 0.94));
    const x0 = ri(xc - back * f), x1 = ri(xc + fwd * f);
    const y = y0 + i * dir;
    R(g, x0, y, x1 - x0 + 1, 1, m);
    if (camo) {
      for (let x = x0 + 1; x < x1; x++) {
        const cell = Math.floor((x + 40 + Math.floor(i / 3)) / 4) + Math.floor(i / 3) * 2;
        if (cell % 3 === 0) R(g, x, y, 1, 1, camo);
      }
    }
    R(g, x1, y, 1, 1, l);
    R(g, x0, y, 1, 1, d);
  }
}

function spitfireGiro(g: Ctx, v: View, has: Has) {
  const GR0 = '#45583a', GR = '#647c4c', GR1 = '#88a066', BR = '#8a6a42', SK = '#c6d0bc', DK = '#2a2a26';
  const WING: [string, string, string] = [GR0, GR, GR1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(15 * s);
  const tspan = ri(6 * s);
  const hy = bodyH(v, 3, 3);
  if (has('cola')) ellWing(g, 0, -1, tspan, -15, 2, 3, WING);
  ellWing(g, wy, -1, span, 0, 7, 5, WING, BR);
  D.oval(g, -2, 0, 15, hy, GR0);
  D.oval(g, -2, -ri(c), 14, Math.max(1, hy - 1), GR);
  R(g, -11, -ri((hy - 1) * c), 8, 1, GR1);
  R(g, 4, -ri((hy - 1) * c), 8, 1, GR1);
  R(g, -10, -ri(c), 4, 1, BR);
  R(g, -1, -ri(c) + (hy > 2 ? 1 : 0), 4, 1, BR);
  R(g, 6, -ri(c) - (hy > 2 ? 1 : 0), 3, 1, BR);
  if (k === 1) R(g, -16, hy - 1, 28, 1, SK);
  // Exhaust stubs: one row in the side view, both rows from above.
  for (const x of [6, 8, 10]) {
    if (k === 1) R(g, x, -1, 1, 1, DK);
    else {
      R(g, x, -hy + 1, 1, 1, DK);
      R(g, x, hy - 1, 1, 1, DK);
    }
  }
  if (has('motor')) {
    D.disc(g, 13, 0, 2, P.cream);
    R(g, 12, -2, 1, 5, '#b8ae98');
    R(g, 15, 0, 1, 1, P.cream);
    R(g, 13, -1, 1, 1, P.white);
  } else stub(g, 10, -2, 2, 4);
  if (has('cola')) {
    ellWing(g, 0, 1, tspan, -15, 2, 3, WING);
    // Rounded fin standing towards us.
    const top = -ri(8 * c), base = -ri(2 * c);
    if (top === base) R(g, -17, 0, 6, 1, GR0);
    else {
      const n = base - top;
      for (let j = 0; j <= n; j++) {
        const u = j / n;
        const w = 1 + ri(5 * Math.sqrt(Math.max(0, 1 - (1 - u) ** 2)));
        R(g, -17, top + j, w, 1, j === 0 ? GR1 : GR);
      }
      R(g, -15, top + 1, 1, Math.max(1, n - 1), GR0);
    }
  } else stub(g, -13, -1, 2, 3);
  if (has('ala')) {
    ellWing(g, wy, 1, span, 0, 7, 5, WING, BR);
    R(g, 5, wy + ri(span * 0.3), 3, 1, P.metal0);
    if (k > 1) R(g, 5, wy - ri(span * 0.3), 3, 1, P.metal0);
  } else stub(g, -1, wy + 1, 3, 2);
  const glass = has('cabina');
  if (k === 1) {
    if (glass) D.oval(g, 1, -4, 3, 2, P.gl0);
    else R(g, -3, -3, 7, 1, GR0);
    sideHead(g, 0, -2);
    if (glass) {
      g.globalAlpha = 0.45;
      D.oval(g, 1, -4, 2, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 4, -5, 1, 3, GR0);
      R(g, 1, -6, 2, 1, P.white);
    }
  } else {
    const cy = -ri(3 * c);
    if (glass) D.oval(g, 1, cy, 4, 3, P.gl0);
    topHead(g, 0, cy, k === 2 ? 1 : 0);
    if (glass) {
      g.globalAlpha = 0.4;
      D.oval(g, 2, cy - 1, 2, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 3, cy - 2, 2, 1, P.white);
    }
  }
}

/* ── Stuka, Mustang, Corsair, Falcon and Fulcrum ────────────────────────── */

/**
 * An inverted gull wing (Stuka, Corsair) seen rolled. Spanwise station d runs
 * 0..span; its height below the spine h(d) drops from h[0] at the root to h[1]
 * at the crank (bendAt) and climbs back to h[2] at the tip, so each station
 * lands at y = h·cos φ + dir·d·sin φ. root/bend/tip = [trailing x, leading x].
 * The crank shows as a shaded crease; `camo` lays slanted splinter stripes.
 */
function gullWing(
  g: Ctx, v: View, dir: 1 | -1, span: number, bendAt: number, h: [number, number, number],
  root: [number, number], bend: [number, number], tip: [number, number],
  col: [string, string, string], camo?: string,
) {
  const [d, m, l] = col;
  const rows = new Map<number, [number, number, boolean]>();
  for (let q = 0; q <= span * 4; q++) {
    const u = q / 4;
    const inner = u <= bendAt;
    const f = inner ? u / bendAt : (u - bendAt) / (span - bendAt);
    const a = inner ? root : bend, b = inner ? bend : tip;
    const hh = inner ? h[0] + (h[1] - h[0]) * f : h[1] + (h[2] - h[1]) * f;
    let x0 = a[0] + (b[0] - a[0]) * f, x1 = a[1] + (b[1] - a[1]) * f;
    if (u > span - 1) {
      // Rounded tip.
      const t = u - (span - 1);
      x0 += t;
      x1 -= t;
    }
    const y = ri(hh * v.c + dir * u * v.s);
    const crease = Math.abs(u - bendAt) < 0.4;
    const r = rows.get(y);
    if (!r) rows.set(y, [ri(x0), ri(x1), crease]);
    else {
      r[0] = Math.min(r[0], ri(x0));
      r[1] = Math.max(r[1], ri(x1));
      r[2] = r[2] || crease;
    }
  }
  for (const [y, [x0, x1, crease]] of rows) {
    R(g, x0, y, x1 - x0 + 1, 1, m);
    if (camo) for (let x = x0 + 1; x < x1; x++) if ((((x + y * 2 + 64) >> 2) % 3) === 0) R(g, x, y, 1, 1, camo);
    if (crease) for (let x = x0 + 1; x < x1; x += 2) R(g, x, y, 1, 1, d);
    R(g, x1, y, 1, 1, l);
    R(g, x0, y, 1, 1, d);
  }
}

/** Ju-87 gull wing: crank at d=5, low at the crank; the trousered gear hangs from there. */
const STUKA_W = { span: 17, bend: 5, h: [2, 4, 1] as [number, number, number] };

function stukaGiro(g: Ctx, v: View, has: Has) {
  const G0 = '#3c4a2e', G = '#5a6b42', G1 = '#7c8c56', S = '#46563a', SK = '#b4c2c8', DK = '#262a22';
  const WING: [string, string, string] = [G0, G, G1];
  const { s, c, k } = v;
  const tspan = ri(6 * s);
  const ty = -ri(c);
  const hy = bodyH(v, 3, 3);
  const { span, bend, h } = STUKA_W;
  const gull = (dir: 1 | -1) => gullWing(g, v, dir, span, bend, h, [-7, 6], [-7, 5], [-4, 3], WING, S);
  // A trouser spat at the crank: from the wing down to the wheel.
  const spat = (sg: number) => {
    const yw = ri(h[1] * c + sg * bend * s), yb = ri(9 * c + sg * bend * s);
    if (yb <= yw) return;
    for (let y = yw; y <= yb; y++) {
      const u = (y - yw) / (yb - yw);
      R(g, 3, y, 3 + ri(u * 2), 1, u > 0.7 ? G0 : G);
    }
    R(g, 4, yb, 3, 1, DK);
  };
  if (has('cola')) wing(g, ty, -1, tspan, [-20, -14], [-19, -16], WING);
  if (has('ala')) spat(-1);
  gull(-1);
  // The bomb and the chin radiator hang below: they show while tilted.
  const yB = ri(5 * c);
  if (has('bodega') && k < 3) {
    D.oval(g, -3, yB, 4, 1, '#4c4c44');
    R(g, -6, yB - 1, 7, 1, '#7a7a6a');
    R(g, -9, yB - 1, 2, 3, '#4c4c44');
  }
  R(g, 9, ri(3 * c), 6, 2, G0);
  R(g, 10, ri(3 * c) + 1, 4, 1, DK);
  D.oval(g, -1, 0, 17, hy, G0);
  D.oval(g, -1, -ri(c), 16, Math.max(1, hy - 1), G);
  R(g, -14, -ri((hy - 1) * c), 24, 1, G1);
  for (const x0 of [-15, -7, 6]) {
    R(g, x0, -ri(c), 3, 1, S);
    R(g, x0 + 1, -ri(c) + (hy > 2 ? 1 : 0), 3, 1, S);
  }
  if (k === 1) R(g, -17, hy - 1, 30, 1, SK);
  for (const x of [9, 11, 13]) {
    if (k === 1) R(g, x, -1, 1, 1, DK);
    else {
      R(g, x, -hy + 1, 1, 1, DK);
      R(g, x, hy - 1, 1, 1, DK);
    }
  }
  if (has('motor')) {
    D.disc(g, 16, 0, 2, G);
    R(g, 15, -2, 1, 5, G0);
    R(g, 16, -1, 1, 1, G1);
    R(g, 18, 0, 1, 1, P.cream);
  } else stub(g, 13, -2, 2, 4);
  if (has('cola')) {
    wing(g, ty, 1, tspan, [-20, -14], [-19, -16], WING);
    // Square-topped fin standing towards us.
    const top = -ri(9 * c), base = -ri(2 * c);
    if (top === base) R(g, -19, 0, 7, 1, G0);
    else {
      R(g, -18, top, 3, 1, G1);
      for (let y = top + 1; y <= base; y++) R(g, -19, y, 6, 1, G);
      R(g, -19, top + 1, 3, Math.max(1, ri((base - top) / 3)), S);
      R(g, -16, top + 1, 1, base - top, G0);
    }
  } else stub(g, -15, -1, 2, 3);
  if (has('ala')) {
    gull(1);
    if (k < 3) spat(1);
  } else stub(g, -1, ri(2 * c) + 1, 3, 2);
  // Long framed greenhouse with the rear gun pointing back.
  const glass = has('cabina');
  if (k === 1) {
    if (glass) {
      R(g, -9, -5, 3, 1, P.metal0);
      R(g, -7, -5, 13, 2, P.gl0);
      R(g, -6, -6, 11, 1, P.gl0);
    } else R(g, -7, -3, 14, 1, G0);
    sideHead(g, 3, -2);
    if (glass) {
      g.globalAlpha = 0.45;
      R(g, -6, -5, 11, 1, P.gl1);
      g.globalAlpha = 1;
      for (const x of [-5, -2]) R(g, x, -6, 1, 3, G0);
      R(g, 6, -5, 1, 2, G0);
      R(g, -4, -6, 2, 1, P.white);
    }
  } else {
    const cy = -ri(3 * c);
    if (glass) {
      R(g, -10, cy, 3, 1, P.metal0);
      R(g, -7, cy - 2, 13, 5, P.gl0);
      R(g, -7, cy - 2, 1, 1, G);
      R(g, -7, cy + 2, 1, 1, G);
    }
    topHead(g, 3, cy, k === 2 ? 1 : 0);
    if (glass) {
      for (const x of [-5, -2]) R(g, x, cy - 2, 1, 5, G0);
      R(g, 6, cy - 2, 1, 5, G0);
      g.globalAlpha = 0.4;
      R(g, -4, cy - 1, 4, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, -1, cy - 2, 2, 1, P.white);
    }
  }
}

function mustangGiro(g: Ctx, v: View, has: Has) {
  const M0 = '#6c7482', M = '#a0a8b6', M1 = '#c8ced8', M2 = '#eef1f5', DK = '#2a2c34', CK = '#ff4a5a';
  const WING: [string, string, string] = [M0, M, M1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(15 * s);
  const tspan = ri(6 * s);
  const hy = bodyH(v, 3, 3);
  if (has('cola')) wing(g, 0, -1, tspan, [-18, -13], [-17, -15], WING);
  // Laminar-flow wing: straight leading edge, gentle taper, squared tips.
  wing(g, wy, -1, span, [-6, 5], [-3, 1], WING);
  // Belly scoop, showing below the fuselage while tilted.
  const ys = ri(3 * c);
  R(g, -12, ys, 8, 2, M0);
  R(g, -4, ys, 1, 2, DK);
  D.oval(g, -1, 0, 16, hy, M0);
  D.oval(g, -1, -ri(c), 15, Math.max(1, hy - 1), M);
  R(g, -14, -ri((hy - 1) * c), 9, 1, M2);
  R(g, 4, -ri((hy - 1) * c), 6, 1, M2);
  R(g, -6, -hy + 1, 1, hy * 2 - 1, M0);
  // The checkered band wraps all the way round the nose.
  for (let y = -hy; y <= hy; y++) for (let x = 10; x <= 12; x++) R(g, x, y, 1, 1, (x + y) & 1 ? CK : P.white);
  for (const x of [6, 8]) {
    if (k === 1) R(g, x, -1, 1, 1, DK);
    else {
      R(g, x, -hy + 1, 1, 1, DK);
      R(g, x, hy - 1, 1, 1, DK);
    }
  }
  if (has('motor')) {
    D.disc(g, 14, 0, 2, CK);
    R(g, 13, -2, 1, 5, '#c0303c');
    R(g, 14, -1, 1, 1, '#ffb0b8');
    R(g, 16, 0, 1, 1, CK);
  } else stub(g, 11, -2, 2, 4);
  if (has('cola')) {
    wing(g, 0, 1, tspan, [-18, -13], [-17, -15], WING);
    const top = -ri(8 * c), base = -ri(2 * c);
    if (top === base) R(g, -17, 0, 6, 1, M0);
    else {
      trap(g, top, base, -17, -15, -17, -9, M);
      R(g, -17, top, 3, 1, CK);
      R(g, -15, top + 1, 1, Math.max(1, base - top - 1), M0);
    }
  } else stub(g, -14, -1, 2, 3);
  if (has('ala')) {
    wing(g, wy, 1, span, [-6, 5], [-3, 1], WING);
    R(g, 3, wy + ri(span * 0.4), 2, 1, P.metal0);
    if (k > 1) R(g, 3, wy - ri(span * 0.4), 2, 1, P.metal0);
  } else stub(g, 0, wy + 1, 3, 2);
  const glass = has('cabina');
  if (k === 1) {
    if (glass) D.oval(g, -1, -4, 4, 2, P.gl0);
    else R(g, -5, -3, 8, 1, M0);
    sideHead(g, -1, -2);
    if (glass) {
      g.globalAlpha = 0.45;
      D.oval(g, -1, -4, 3, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 3, -5, 1, 3, M0);
      R(g, -1, -6, 2, 1, P.white);
    }
  } else {
    const cy = -ri(3 * c);
    if (glass) D.oval(g, -1, cy, 5, 3, P.gl0);
    topHead(g, -1, cy, k === 2 ? 1 : 0);
    if (glass) {
      g.globalAlpha = 0.4;
      D.oval(g, 0, cy - 1, 3, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 2, cy - 2, 2, 1, P.white);
    }
  }
}

/** F4U gull wing: a deeper crank close to the body, broad chord, round tips. */
const CORSAIR_W = { span: 16, bend: 5, h: [2, 5, 1] as [number, number, number] };

function corsairGiro(g: Ctx, v: View, has: Has) {
  const N0 = '#1c2a4a', N = '#2c426e', N1 = '#45619a', N2 = '#7090c8', DK = '#121826';
  const WING: [string, string, string] = [N0, N, N1];
  const { s, c, k } = v;
  const tspan = ri(6 * s);
  const hy = bodyH(v, 3, 3);
  const { span, bend, h } = CORSAIR_W;
  const gull = (dir: 1 | -1) => gullWing(g, v, dir, span, bend, h, [-7, 7], [-7, 6], [-4, 2], WING);
  if (has('cola')) ellWing(g, 0, -1, tspan, -16, 2, 3, WING);
  gull(-1);
  D.oval(g, -2, 0, 16, hy, N0);
  D.oval(g, -2, -ri(c), 15, Math.max(1, hy - 1), N);
  R(g, -12, -ri((hy - 1) * c), 7, 1, N2);
  R(g, 2, -ri((hy - 1) * c), 6, 1, N2);
  R(g, -7, -hy + 1, 1, hy * 2 - 1, N0);
  // Big round cowl, wider than the fuselage, and its ring.
  // The long nose keeps its full depth right up to the cowl.
  R(g, 0, -hy, 10, hy * 2 + 1, N0);
  R(g, 0, -ri(c) - Math.max(1, hy - 1), 10, Math.max(1, hy - 1) * 2 + 1, N);
  R(g, 2, -ri((hy - 1) * c), 6, 1, N2);
  const cr = hy;
  R(g, 10, -cr, 4, cr * 2 + 1, N0);
  R(g, 10, -cr + 1, 3, cr * 2 - 1, N);
  R(g, 13, -cr + 1, 1, cr * 2 - 1, N1);
  R(g, 9, -cr + 1, 1, 1, DK);
  R(g, 9, cr - 1, 1, 1, DK);
  if (has('motor')) {
    D.disc(g, 15, 0, 2, N);
    R(g, 15, -1, 1, 1, N2);
    R(g, 17, 0, 1, 1, N1);
  } else stub(g, 12, -2, 2, 4);
  if (has('cola')) {
    ellWing(g, 0, 1, tspan, -16, 2, 3, WING);
    const top = -ri(8 * c), base = -ri(2 * c);
    if (top === base) R(g, -18, 0, 6, 1, N0);
    else {
      const n = base - top;
      for (let j = 0; j <= n; j++) {
        const u = j / n;
        const w = 2 + ri(5 * Math.sqrt(Math.max(0, 1 - (1 - u) ** 2)));
        R(g, -18, top + j, w, 1, j === 0 ? N1 : N);
      }
      R(g, -16, top + 1, 1, Math.max(1, n - 1), N0);
    }
  } else stub(g, -15, -1, 2, 3);
  if (has('ala')) {
    gull(1);
  } else stub(g, 0, ri(2 * c) + 1, 3, 2);
  const glass = has('cabina');
  if (k === 1) {
    if (glass) D.oval(g, -2, -4, 3, 2, P.gl0);
    else R(g, -6, -3, 7, 1, N0);
    sideHead(g, -3, -2);
    if (glass) {
      g.globalAlpha = 0.45;
      D.oval(g, -2, -4, 2, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 1, -5, 1, 3, N0);
      R(g, -2, -6, 2, 1, P.white);
    }
  } else {
    const cy = -ri(3 * c);
    if (glass) D.oval(g, -2, cy, 4, 3, P.gl0);
    topHead(g, -3, cy, k === 2 ? 1 : 0);
    if (glass) {
      R(g, 1, cy - 2, 1, 5, N0);
      g.globalAlpha = 0.4;
      D.oval(g, -1, cy - 1, 2, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 0, cy - 2, 2, 1, P.white);
    }
  }
}

function f16Giro(g: Ctx, v: View, has: Has) {
  const F0 = '#68727f', F = '#9ba5b2', F1 = '#c2c9d3', F2 = '#e2e6ec', DK = '#262a34';
  const WING: [string, string, string] = [F0, F, F1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(12 * s);
  const lspan = ri(4 * s);
  const tspan = ri(6 * s);
  const hy = bodyH(v, 3, 3);
  // Cropped delta with a missile rail on the clipped tip.
  const delta = (dir: 1 | -1) => {
    wing(g, wy, dir, span, [-12, 1], [-9, -6], WING);
    wing(g, wy, dir, lspan, [0, 10], [0, 1], WING);
    if (span > 1) R(g, -11, wy + dir * (span + 1), 6, 1, P.metal0);
  };
  if (has('cola')) wing(g, ri(c), -1, tspan, [-19, -13], [-19, -16], WING);
  delta(-1);
  // Chin intake, showing under the belly while tilted.
  const yi = ri(3 * c);
  R(g, 1, yi, 7, 2, F0);
  R(g, 7, yi, 1, 2, DK);
  D.oval(g, -1, 0, 16, hy, F0);
  D.oval(g, -1, -ri(c), 15, Math.max(1, hy - 1), F);
  R(g, -12, -ri((hy - 1) * c), 16, 1, F1);
  R(g, -8, -hy + 1, 1, hy * 2 - 1, F0);
  const nose = Math.max(1, hy - 1);
  for (let x = 15; x <= 18; x++) {
    const hh = ri(nose * (1 - (x - 15) / 4));
    R(g, x, -hh, 1, hh * 2 + 1, x < 17 ? F : F0);
  }
  if (k === 1) R(g, 0, 0, 12, 1, F2);
  if (has('motor')) {
    R(g, -19, -1, 2, 3, P.metal0);
    R(g, -19, -1, 2, 1, P.metal);
    R(g, -19, 0, 1, 1, DK);
  } else stub(g, -17, -2, 2, 4);
  if (has('cola')) {
    wing(g, ri(c), 1, tspan, [-19, -13], [-19, -16], WING);
    const top = -ri(9 * c), base = -ri(2 * c);
    if (top === base) R(g, -17, 0, 7, 1, F0);
    else {
      trap(g, top, base, -17, -15, -16, -10, F);
      R(g, -17, top, 3, 1, F2);
      R(g, -15, top + 2, 1, Math.max(1, base - top - 3), F0);
    }
  } else stub(g, -14, -1, 2, 3);
  if (has('ala')) delta(1);
  else stub(g, -5, wy + 1, 3, 2);
  const glass = has('cabina');
  if (k === 1) {
    if (glass) D.oval(g, 6, -4, 5, 2, P.gl0);
    else R(g, 1, -3, 11, 1, F0);
    sideHead(g, 7, -2);
    if (glass) {
      g.globalAlpha = 0.45;
      D.oval(g, 6, -4, 4, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 8, -6, 2, 1, P.white);
    }
  } else {
    const cy = -ri(3 * c);
    if (glass) D.oval(g, 6, cy, 6, 3, P.gl0);
    topHead(g, 7, cy, k === 2 ? 1 : 0);
    if (glass) {
      g.globalAlpha = 0.4;
      D.oval(g, 8, cy - 1, 4, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 10, cy - 2, 2, 1, P.white);
    }
  }
}

/** MiG-29 engines: spanwise (d) and below-spine (e) position of the nacelles. */
const MIG_ENG = { d: 4, e: 2 };

function mig29Giro(g: Ctx, v: View, has: Has) {
  const B0 = '#4e5c70', B = '#7c8ca4', B1 = '#a4b2c6', BC = '#66788f', DK = '#242a36';
  const WING: [string, string, string] = [B0, B, B1];
  const { s, c, k } = v;
  const wy = ri(2 * c);
  const span = ri(14 * s);
  const lspan = ri(5 * s);
  const tspan = ri(6 * s);
  const hy = bodyH(v, 3, 3);
  const eY = ri(MIG_ENG.e * c);
  const eFar = eY - ri(MIG_ENG.d * s), eNear = eY + ri(MIG_ENG.d * s);
  const nacelle = (y: number) => {
    D.oval(g, -8, y, 10, 1, B0);
    R(g, -17, y - 1, 17, 1, B);
    R(g, -20, y - 1, 3, 3, P.metal0);
    R(g, -20, y, 1, 1, DK);
    R(g, 1, y - 1, 2, 3, DK);
    R(g, 3, y - 1, 1, 3, B1);
  };
  if (has('cola')) {
    wing(g, eFar, -1, tspan, [-20, -14], [-19, -17], WING);
    cantedFin(g, v, -4, 2, 6, [-15, -11], [-18, -15], B0, B);
  }
  wing(g, wy, -1, span, [-12, 1], [-9, -6], WING);
  wing(g, wy, -1, lspan, [1, 11], [1, 2], WING);
  if (has('motor') && k > 1) nacelle(eFar);
  D.oval(g, 0, 0, 16, hy, B0);
  D.oval(g, 0, -ri(c), 15, Math.max(1, hy - 1), B);
  R(g, -12, -ri((hy - 1) * c), 18, 1, B1);
  R(g, -10, -ri(c), 4, 1, BC);
  R(g, 0, -ri(c) + (hy > 2 ? 1 : 0), 4, 1, BC);
  if (k === 1) R(g, -16, hy - 1, 33, 1, '#cfd7e0');
  const nose = Math.max(1, hy - 1);
  for (let x = 15; x <= 19; x++) {
    const hh = ri(nose * (1 - (x - 15) / 5));
    R(g, x, -hh, 1, hh * 2 + 1, x < 18 ? B : B0);
  }
  if (has('cola')) {
    wing(g, eNear, 1, tspan, [-20, -14], [-19, -17], WING);
    cantedFin(g, v, 4, 2, 6, [-15, -11], [-18, -15], B, B1);
  } else stub(g, -14, -1, 2, 3);
  if (has('ala')) {
    wing(g, wy, 1, span, [-12, 1], [-9, -6], WING);
    R(g, -8, wy + ri(span * 0.5), 3, 1, BC);
  } else stub(g, -4, wy + 1, 3, 2);
  wing(g, wy, 1, lspan, [1, 11], [1, 2], WING);
  if (has('motor')) nacelle(eNear);
  else stub(g, -14, eNear - 1, 2, 3);
  const glass = has('cabina');
  if (k === 1) {
    if (glass) D.oval(g, 8, -4, 4, 2, P.gl0);
    else R(g, 4, -3, 9, 1, B0);
    sideHead(g, 8, -2);
    if (glass) {
      g.globalAlpha = 0.45;
      D.oval(g, 8, -4, 3, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 9, -6, 2, 1, P.white);
      R(g, 13, -3, 1, 1, P.gl1);
    }
  } else {
    const cy = -ri(3 * c);
    if (glass) D.oval(g, 8, cy, 5, 3, P.gl0);
    topHead(g, 8, cy, k === 2 ? 1 : 0);
    if (glass) {
      g.globalAlpha = 0.4;
      D.oval(g, 9, cy - 1, 3, 1, P.gl1);
      g.globalAlpha = 1;
      R(g, 11, cy - 2, 2, 1, P.white);
      R(g, 14, cy, 1, 1, P.gl1);
    }
  }
}

const GIRO: Record<ModeloAvion, (g: Ctx, v: View, has: Has) => void> = {
  avioneta: avionetaGiro, caza: cazaGiro, bombardero: bombarderoGiro,
  raptor: raptorGiro, sukhoi: sukhoiGiro, b2: b2Giro, ovni: ovniGiro,
  tomcat: tomcatGiro, a10: a10Giro, spitfire: spitfireGiro,
  stuka: stukaGiro, mustang: mustangGiro, corsair: corsairGiro, f16: f16Giro, mig29: mig29Giro,
};

/** The banked sprite for frame k (1..3) with the given parts missing. */
export function giroSprite(m: ModeloAvion, k: 1 | 2 | 3, lost: readonly Parte[] = []) {
  const L = LOOKS[m];
  const H = GIRO_H[m];
  const key = lost.length ? [...lost].sort().join(',') : '';
  const v = VIEWS[k];
  return D.outlined(`giro|${m}|${k}|${pilotoActual()}|${key}`, L.ink, L.w, H, L.w / 2, H / 2, (g) => {
    GIRO[m](g, v, (p) => !lost.includes(p));
    if (lost.length) scorch(g, lost.length, m.length + k, bodyH(v, 3, 2));
  });
}

/* ── Live parts: propellers, flame, scarf, sparks ───────────────────────── */

/** Propeller hubs [x, y, r] in banked frame k. */
function propsFor(m: ModeloAvion, v: View): [number, number, number][] {
  if (m === 'avioneta') return [[12, 0, 4]];
  if (m === 'spitfire') return [[15, 0, 5]];
  if (m === 'stuka' || m === 'mustang' || m === 'corsair') return [LOOKS[m].prop!];
  if (m === 'bombardero') {
    const { d, e } = BOMB_ENG;
    const near: [number, number, number] = [10, ri(e * v.c + d * v.s), 3];
    // At 30° the far engine hides behind the fuselage.
    return v.k === 1 ? [near] : [[10, ri(e * v.c - d * v.s), 3], near];
  }
  return [];
}

/** Jet flames [x, y] in banked frame k; twin-engine jets far apart show two. */
const JET_D: Partial<Record<ModeloAvion, number>> = { sukhoi: 4, b2: 6, tomcat: 3, a10: A10_ENG.d, mig29: MIG_ENG.d };
function jetsFor(m: ModeloAvion, v: View): [number, number][] {
  const L = LOOKS[m];
  if (!L.jet) return [];
  const [jx, jy] = L.jet;
  const d = JET_D[m];
  const y = m === 'b2' ? -ri(v.c) : ri(jy * v.c);
  return d ? [[jx, y - ri(d * v.s)], [jx, y + ri(d * v.s)]] : [[jx, y]];
}

/** Top-view head centre x and its height above the spine, per airframe. */
const TOP_HEAD: Record<ModeloAvion, [number, number]> = {
  avioneta: [-1, 3], caza: [2, 3], bombardero: [5, 4], raptor: [4, 3], sukhoi: [6, 3], b2: [10, 4], ovni: [0, 4],
  tomcat: [9, 3], a10: [10, 4], spitfire: [0, 3],
  stuka: [3, 3], mustang: [-1, 3], corsair: [-3, 3], f16: [7, 3], mig29: [8, 3],
};

/** Where the scarf starts in banked frame k. */
function scarfAt(m: ModeloAvion, v: View): [number, number] {
  if (v.k === 1) {
    const [x, y] = LOOKS[m].scarf;
    return [x, ri(y * v.c)];
  }
  const [hx, hh] = TOP_HEAD[m];
  return [hx - 3, -ri(hh * v.c) + 1];
}

/** Lost-part anchor projected into banked frame k. */
function anchorAt(m: ModeloAvion, part: Parte, v: View): [number, number] {
  const [ax, ay] = LOOKS[m].parts[part] ?? [0, 0];
  if (m === 'ovni') return [ax, ri(ay * v.c)];
  if (part === 'ala') return m === 'b2' ? [ax, ri(v.c) + ri(6 * v.s)] : [ax, ri(2 * v.c) + 2];
  if (part === 'motor' && m === 'bombardero') return [ax, ri(BOMB_ENG.e * v.c + BOMB_ENG.d * v.s)];
  if (part === 'motor' && m === 'sukhoi') return [ax, ri(2 * v.c) + ri(4 * v.s)];
  if (part === 'motor' && m === 'mig29') return [ax, ri(MIG_ENG.e * v.c) + ri(MIG_ENG.d * v.s)];
  if (part === 'motor' && m === 'a10') return [ax, -ri(A10_ENG.e * v.c) + ri(A10_ENG.d * v.s)];
  if (part === 'motor' && m === 'b2') return [ax, -ri(4 * v.c) + ri(3 * v.s)];
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
  const engine = !lost.includes('motor');
  // The saucer's underglow: below the disc while tilted, a halo round it from above.
  if (L.glow && engine) ovniGlow(g, 0, ri(6 * v.c), 6 + ri(10 * v.s), 2 + ri(14 * v.s), t);
  if (k === 1 && !L.cupula) scarf();
  if (!blink) g.drawImage(spriteParaDibujar(img), -L.w / 2, -H / 2);
  if (k > 1 && !L.cupula) scarf();
  if (m === 'ovni' && !blink && !lost.includes('ala')) ovniLuces(g, 0, ovniRy(v) - 1, t, true);
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
    for (const [jx, jy] of jetsFor(m, v)) {
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
