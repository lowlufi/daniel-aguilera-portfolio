import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { R, miniHead, pilotoActual, type Parte, type PlaneLook } from './dibujo';
import type { ModeloNuevo } from './fisica-tipos';

/*
 * The second batch of the hangar, seen from the left flank (nose to +x,
 * origin at the centre), in the same pixel style as dibujo.ts: the WWII
 * classics, the Chilean favourites, the modern jets and the cardboard box.
 * Original art, no national insignia: each plane wears its own colours.
 *
 * Only data (LOOKS_EXTRA) is read while this module loads; dibujo.ts's
 * helpers are used inside the painters, so the import cycle is harmless.
 * The banked and top views live in giro-extra.ts.
 */

type Ctx = CanvasRenderingContext2D;
type Has = (p: Parte) => boolean;

export const LOOKS_EXTRA: Record<ModeloNuevo, PlaneLook> = {
  pillan: {
    ink: '#3a3e4c', w: 34, h: 20, prop: [15, 0, 5], scarf: [-1, -6], scarfC: ['#ff5a2a', '#ffd0b0'], rack: [0, 3],
    parts: { cola: [-13, -4], ala: [1, 3], motor: [12, 0], cabina: [0, -4] },
  },
  zero: {
    ink: '#2c2e26', w: 36, h: 20, prop: [16, 0, 5], scarf: [-3, -6], scarfC: [P.white, '#ff4a5a'], rack: [0, 3],
    parts: { cola: [-14, -4], ala: [1, 3], motor: [12, 0], cabina: [0, -4] },
  },
  hurricane: {
    ink: '#3a2c1c', w: 38, h: 22, prop: [16, 0, 5], scarf: [-4, -7], scarfC: ['#e8e2d6', '#c8a870'], rack: [0, 4],
    parts: { cola: [-15, -4], ala: [1, 3], motor: [12, -1], cabina: [-1, -5] },
  },
  bf109: {
    ink: '#262a30', w: 36, h: 20, prop: [16, 0, 5], scarf: [-3, -6], scarfC: ['#ffd23a', P.white], rack: [0, 3],
    parts: { cola: [-14, -4], ala: [1, 3], motor: [12, 0], cabina: [0, -4] },
  },
  p38: {
    ink: '#3a404c', w: 44, h: 22, prop: [12, 2, 5], scarf: [2, -7], scarfC: ['#3a6ad8', P.white], rack: [-2, 4],
    parts: { cola: [-18, -3], ala: [-2, 3], motor: [9, 2], cabina: [5, -5] },
  },
  mosquito: {
    ink: '#24304a', w: 44, h: 22, prop: [12, 3, 5], scarf: [4, -7], scarfC: ['#ffd23a', '#fff2a8'], rack: [-2, 5],
    parts: { cola: [-18, -4], ala: [-1, 3], motor: [8, 3], cabina: [9, -4], bodega: [-3, 4] },
  },
  a37: {
    ink: '#2a3022', w: 36, h: 20, jet: [-15, 1], scarf: [2, -6], scarfC: ['#ffd23a', '#ff8a3a'], rack: [0, 4],
    parts: { cola: [-13, -5], ala: [-1, 3], motor: [-11, 1], cabina: [6, -4] },
  },
  a4: {
    ink: '#2e3238', w: 38, h: 20, jet: [-17, 0], scarf: [3, -6], scarfC: ['#ff6a3a', '#ffe0a0'], rack: [-1, 4],
    parts: { cola: [-14, -5], ala: [-3, 3], motor: [-15, 0], cabina: [7, -4] },
  },
  f5: {
    ink: '#262c3c', w: 38, h: 20, jet: [-18, 1], scarf: [4, -6], scarfC: ['#ff4a5a', '#ffd0d8'], rack: [-1, 3],
    parts: { cola: [-14, -5], ala: [-4, 3], motor: [-17, 1], cabina: [7, -4] },
  },
  mig21: {
    ink: '#30343c', w: 40, h: 20, jet: [-19, 0], scarf: [4, -6], scarfC: ['#ff4a3a', '#ffd23a'], rack: [-2, 3],
    parts: { cola: [-14, -5], ala: [-6, 3], motor: [-18, 0], cabina: [8, -4] },
  },
  harrier: {
    ink: '#2a3038', w: 38, h: 22, jet: [-5, 4], scarf: [6, -6], scarfC: ['#3ad8c8', '#e4fff8'], rack: [-2, 5],
    parts: { cola: [-15, -5], ala: [-3, 1], motor: [-4, 3], cabina: [9, -4] },
  },
  mirage: {
    ink: '#28303e', w: 40, h: 20, jet: [-19, 0], scarf: [5, -6], scarfC: ['#5a8aff', P.white], rack: [-2, 3],
    parts: { cola: [-13, -6], ala: [-6, 3], motor: [-18, 0], cabina: [8, -4] },
  },
  gripen: {
    ink: '#2a3038', w: 38, h: 20, jet: [-18, 0], scarf: [4, -6], scarfC: ['#ffd23a', '#3a8ad8'], rack: [-2, 3],
    parts: { cola: [-13, -6], ala: [-6, 3], motor: [-17, 0], cabina: [7, -4] },
  },
  rafale: {
    ink: '#222830', w: 40, h: 20, jet: [-19, 1], scarf: [5, -6], scarfC: ['#9a5aff', '#e0c8ff'], rack: [-2, 4],
    parts: { cola: [-13, -6], ala: [-6, 3], motor: [-18, 1], cabina: [8, -4] },
  },
  typhoon: {
    ink: '#2a3038', w: 40, h: 20, jet: [-19, 0], scarf: [5, -6], scarfC: ['#ff7ab4', P.white], rack: [-2, 4],
    parts: { cola: [-13, -6], ala: [-6, 3], motor: [-18, 0], cabina: [8, -4] },
  },
  f35: {
    ink: '#1c2028', w: 38, h: 20, jet: [-18, 0], scarf: [4, -6], scarfC: ['#ffb03a', '#ffe8b0'], rack: [-1, 3],
    parts: { cola: [-13, -5], ala: [-5, 3], motor: [-17, 0], cabina: [6, -4] },
  },
  carton: {
    ink: '#6a4a24', w: 36, h: 22, prop: [15, 0, 6], scarf: [-2, -8], scarfC: ['#ff4a5a', '#ffd23a'], rack: [0, 6],
    parts: { cola: [-14, -4], ala: [0, 3], motor: [12, 0], cabina: [-1, -6] },
  },
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** A row of pixels from x0 to x1 inclusive. */
const fila = (g: Ctx, y: number, x0: number, x1: number, c: string) => R(g, x0, y, x1 - x0 + 1, 1, c);

/** A torn, scorched edge where a part used to be (same look as dibujo.ts). */
function stub(g: Ctx, x: number, y: number, w: number, h: number) {
  R(g, x, y, w, h, '#5a4a5a');
  for (let i = 0; i < h; i++) R(g, x + (i % 2 ? -1 : w), y + i, 1, 1, i % 3 ? '#3a2a3a' : '#ff9a3c');
  R(g, x + Math.floor(w / 2), y, 1, 1, P.gold);
}

/**
 * A bubble canopy with the pilot in it, or (shot away) the bare cockpit rim.
 * `vidrio` tints the glass (the F-35's gold), `marco` draws a frame bar.
 */
function cupula(g: Ctx, has: Has, cx: number, cy: number, rx: number, ry: number, hx: number, borde: string, vidrio: [string, string] = [P.gl0, P.gl1], marco?: number) {
  if (has('cabina')) {
    D.oval(g, cx, cy, rx, ry, vidrio[0]);
    miniHead(g, pilotoActual(), hx, cy + 2);
    g.globalAlpha = 0.45;
    D.oval(g, cx, cy, Math.max(1, rx - 1), Math.max(1, ry - 1), vidrio[1]);
    g.globalAlpha = 1;
    if (marco !== undefined) R(g, marco, cy - ry + 1, 1, ry * 2 - 1, borde);
    R(g, cx + 1, cy - ry, 2, 1, P.white);
  } else {
    R(g, cx - rx, cy + 1, rx * 2 + 1, 1, borde);
    miniHead(g, pilotoActual(), hx, cy + 2);
    R(g, cx + rx, cy + 1, 1, 1, vidrio[0]);
  }
}

/** A propeller spinner: a rounded cone with a light glint (the prop blur is drawn live). */
function helice(g: Ctx, has: Has, x: number, y: number, c: string, c0: string, punta = P.cream) {
  if (!has('motor')) {
    stub(g, x - 3, y - 2, 2, 4);
    return;
  }
  D.oval(g, x, y, 2, 2, c);
  R(g, x - 1, y - 2, 1, 5, c0);
  R(g, x, y - 1, 1, 1, P.white);
  R(g, x + 2, y, 1, 1, punta);
}

/** A jet nozzle: a short dark tube with a lit rim. */
function tobera(g: Ctx, has: Has, x: number, y: number, h = 4) {
  if (!has('motor')) {
    stub(g, x + 2, y - (h >> 1), 2, h);
    return;
  }
  R(g, x, y - (h >> 1), 3, h, P.metal0);
  R(g, x, y - (h >> 1), 3, 1, P.metal);
  R(g, x, y - (h >> 1) + 1, 1, Math.max(1, h - 2), '#262a34');
}

/**
 * A swept fin, rows from its tip (y0) down to the spine: the leading edge
 * runs forward `slope` px per row, the trailing edge back `grow` px per row.
 */
function deriva(g: Ctx, y0: number, rows: number, xTop: number, wTop: number, slope: number, grow: number, c: string, cTop: string) {
  for (let i = 0; i < rows; i++) {
    const x0 = xTop - Math.round(i * grow);
    const x1 = xTop + wTop - 1 + Math.round(i * slope);
    fila(g, y0 + i, x0, x1, i === 0 ? cTop : c);
  }
}

/* ── Props ───────────────────────────────────────────────────────────────── */

/** T-35 Pillán: white trainer with red-orange flashes, a long two-seat bubble, low wing. */
function paintPillan(g: Ctx, has: Has) {
  const W0 = '#a8aebc', W = '#e4e8f0', W1 = '#ffffff', O = '#ff5a2a', O0 = '#c8401a', DK = '#2a2c34';
  if (has('cola')) {
    deriva(g, -8, 7, -16, 3, 0.5, 0.1, W, O);
    R(g, -15, -6, 2, 3, O);
    fila(g, 0, -17, -11, W1);
    fila(g, 1, -16, -13, W0);
  } else stub(g, -13, -3, 2, 4);
  fila(g, -3, -6, 9, W1);
  fila(g, -2, -14, 11, W);
  fila(g, -1, -16, 12, W);
  fila(g, 0, -16, 12, W);
  fila(g, 1, -15, 11, W0);
  fila(g, 2, -11, 8, W0);
  // The red-orange cheat line and a flash up the fin.
  fila(g, -1, -13, 9, O);
  fila(g, 0, -15, -12, O0);
  for (const x of [5, 7]) R(g, x, -2, 1, 1, DK);
  R(g, -4, -2, 1, 3, W0);
  if (has('ala')) {
    fila(g, 2, -5, 7, W1);
    fila(g, 3, -4, 6, W);
    fila(g, 4, -2, 3, W0);
    R(g, 6, 3, 1, 1, O);
  } else stub(g, 0, 2, 3, 2);
  helice(g, has, 13, 0, O, O0, P.white);
  // Long tandem canopy: the pilot up front, the empty instructor's seat behind.
  if (has('cabina')) {
    D.oval(g, 0, -4, 6, 2, P.gl0);
    R(g, -4, -5, 2, 1, '#6a7aa0');
    miniHead(g, pilotoActual(), 2, -2);
    g.globalAlpha = 0.45;
    D.oval(g, 0, -4, 5, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, -1, -6, 1, 3, W0);
    R(g, 3, -6, 2, 1, P.white);
  } else {
    fila(g, -3, -6, 6, W0);
    miniHead(g, pilotoActual(), 2, -2);
  }
}

/** A6M Zero: pale grey-green, a black round cowl, a long greenhouse, yellow wing leading edge. */
function paintZero(g: Ctx, has: Has) {
  const A0 = '#8a8c72', A = '#c4c4a6', A1 = '#e2e2c8', K = '#2a2c30', K1 = '#4a4c54', Y = '#ffd23a';
  if (has('cola')) {
    // Tall rounded fin.
    [[-17, 2], [-18, 4], [-18, 5], [-18, 5], [-18, 6], [-18, 6], [-18, 7]].forEach(([x, w], i) => R(g, x, -8 + i, w, 1, i === 0 ? A1 : A));
    R(g, -16, -6, 1, 5, A0);
    fila(g, 0, -19, -13, A1);
    fila(g, 1, -18, -14, A0);
  } else stub(g, -14, -3, 2, 4);
  fila(g, -3, -11, 5, A1);
  fila(g, -2, -15, 8, A);
  fila(g, -1, -17, 9, A);
  fila(g, 0, -17, 9, A);
  fila(g, 1, -16, 9, A0);
  fila(g, 2, -12, 6, A0);
  R(g, -6, -2, 1, 4, A0);
  // Black cowling round the radial, with its ring and exhaust.
  R(g, 9, -3, 5, 6, K);
  R(g, 9, -3, 5, 1, K1);
  R(g, 13, -2, 1, 4, K1);
  R(g, 9, 1, 1, 1, '#ff9a3c');
  if (has('ala')) {
    fila(g, 2, -6, 8, A1);
    fila(g, 3, -5, 7, A);
    fila(g, 4, -3, 4, A0);
    R(g, 7, 2, 2, 1, Y);
    // The 20 mm cannon barrel poking out ahead of the wing.
    R(g, 9, 3, 3, 1, P.metal0);
  } else stub(g, 0, 2, 3, 2);
  helice(g, has, 15, 0, '#6a6c74', K1);
  if (has('cabina')) {
    R(g, -7, -5, 12, 2, P.gl0);
    R(g, -5, -6, 8, 1, P.gl0);
    miniHead(g, pilotoActual(), 1, -2);
    g.globalAlpha = 0.45;
    R(g, -6, -5, 10, 1, P.gl1);
    g.globalAlpha = 1;
    for (const x of [-4, -1, 4]) R(g, x, -6, 1, 3, A0);
    R(g, 1, -6, 2, 1, P.white);
  } else {
    fila(g, -3, -6, 4, A0);
    miniHead(g, pilotoActual(), 1, -2);
  }
}

/** Hurricane IID: desert sand and brown over sky-blue, a humped back, the big 40 mm gun pods under the wings. */
function paintHurricane(g: Ctx, has: Has) {
  const S0 = '#9a7a4a', S = '#c8a870', S1 = '#e4cc98', BR = '#8a5a32', SK = '#a8c0d0', SK0 = '#7a94a8', DK = '#2a2620';
  if (has('cola')) {
    [[-18, 3], [-19, 5], [-19, 6], [-19, 6], [-19, 7], [-19, 7], [-19, 8]].forEach(([x, w], i) => R(g, x, -9 + i, w, 1, i === 0 ? S1 : S));
    R(g, -17, -7, 2, 3, BR);
    fila(g, 0, -20, -14, S1);
    fila(g, 1, -19, -15, SK0);
  } else stub(g, -15, -3, 2, 4);
  // Humped back rising to the cockpit, a deep chin radiator under the wing.
  fila(g, -4, -8, 4, S1);
  fila(g, -3, -12, 9, S);
  fila(g, -2, -16, 11, S);
  fila(g, -1, -18, 12, S);
  fila(g, 0, -18, 12, S);
  fila(g, 1, -17, 11, SK);
  fila(g, 2, -12, 8, SK0);
  for (const [x, y, w] of [[-14, -2, 4], [-6, -3, 3], [3, -2, 4], [-10, -1, 3]]) R(g, x, y, w, 1, BR);
  // Fabric frames along the rear fuselage.
  for (const x of [-15, -12, -9]) R(g, x, -1, 1, 2, S0);
  for (const x of [7, 9]) R(g, x, -1, 1, 1, DK);
  R(g, -3, 3, 6, 2, SK0);
  R(g, -3, 4, 6, 1, DK);
  if (has('ala')) {
    fila(g, 2, -6, 8, S1);
    fila(g, 3, -5, 7, SK);
    fila(g, 4, -3, 4, SK0);
    // The two Vickers S 40 mm pods: long barrels well ahead of the wing.
    R(g, 0, 5, 9, 2, '#5a5a4a');
    R(g, 0, 5, 9, 1, '#8a8a72');
    R(g, 9, 5, 5, 1, P.metal0);
    R(g, 14, 5, 1, 1, DK);
  } else stub(g, 0, 2, 3, 2);
  helice(g, has, 14, 0, '#3a3a30', '#22221c');
  cupula(g, has, -1, -5, 4, 2, -1, S0, undefined, 2);
}

/** Bf 109: two greys with a mottled flank, yellow nose underside and rudder, spiral spinner, angular canopy. */
function paintBf109(g: Ctx, has: Has) {
  const G0 = '#5a6068', G = '#8a929c', G1 = '#b8bec6', M = '#6c7480', B = '#a8bccc', Y = '#ffd23a', DK = '#22262c';
  if (has('cola')) {
    [[-17, 3], [-18, 4], [-18, 5], [-18, 5], [-18, 6], [-18, 6]].forEach(([x, w], i) => R(g, x, -8 + i, w, 1, i === 0 ? G1 : Y));
    R(g, -16, -6, 1, 4, G0);
    fila(g, -1, -19, -13, G1);
    R(g, -17, 0, 1, 2, G0);
  } else stub(g, -14, -3, 2, 4);
  fila(g, -3, -11, 10, G);
  fila(g, -2, -15, 11, G);
  fila(g, -1, -17, 12, G);
  fila(g, 0, -17, 12, B);
  fila(g, 1, -16, 11, B);
  fila(g, 2, -11, 6, B);
  // Mottle down the flank.
  for (const [x, y] of [[-13, -1], [-9, -2], [-5, -1], [-11, 0], [-2, -2], [6, -2]]) R(g, x, y, 2, 1, M);
  fila(g, -3, -11, -2, G1);
  // Yellow under the nose, the supercharger intake and the exhaust row.
  fila(g, 1, 7, 12, Y);
  fila(g, 2, 7, 10, Y);
  R(g, 5, -2, 2, 2, G0);
  for (const x of [8, 10, 12]) R(g, x, -2, 1, 1, DK);
  if (has('ala')) {
    fila(g, 2, -5, 6, G1);
    fila(g, 3, -4, 5, B);
    fila(g, 4, -2, 2, G0);
  } else stub(g, 0, 2, 3, 2);
  if (has('motor')) {
    // A spinner with a black-and-white spiral.
    D.oval(g, 14, 0, 2, 2, '#1e2226');
    R(g, 13, -1, 1, 1, P.white);
    R(g, 14, 0, 1, 1, P.white);
    R(g, 15, 1, 1, 1, P.white);
    R(g, 16, 0, 1, 1, '#1e2226');
  } else stub(g, 11, -2, 2, 4);
  // Angular framed canopy.
  if (has('cabina')) {
    fila(g, -5, -4, 3, P.gl0);
    fila(g, -4, -5, 4, P.gl0);
    miniHead(g, pilotoActual(), 0, -2);
    g.globalAlpha = 0.45;
    fila(g, -4, -4, 3, P.gl1);
    g.globalAlpha = 1;
    for (const x of [-2, 2]) R(g, x, -5, 1, 2, G0);
    R(g, 4, -5, 1, 2, G0);
    R(g, 0, -6, 2, 1, P.white);
  } else {
    fila(g, -3, -5, 4, G0);
    miniHead(g, pilotoActual(), 0, -2);
  }
}

/** P-38 Lightning: bare metal; the near boom with its engine and twin fins, the central pod with the guns and the bubble. */
function paintP38(g: Ctx, has: Has) {
  const M0 = '#6c7482', M = '#a4acb8', M1 = '#ccd2dc', M2 = '#eef1f5', DK = '#2a2c34', AZ = '#3a6ad8';
  if (has('cola')) {
    // Oval fins above and below the boom, the tailplane joining the booms.
    for (let i = 0; i < 6; i++) fila(g, -6 + i, -20 + (i === 0 ? 1 : 0), -16 - (i === 0 ? 1 : 0), i === 0 ? M1 : M);
    for (let i = 0; i < 3; i++) fila(g, 3 + i, -20 + (i === 2 ? 1 : 0), -17, M0);
    R(g, -19, -5, 1, 4, AZ);
    fila(g, 0, -21, -12, M1);
  } else stub(g, -17, -2, 2, 4);
  // The boom: slim to the tail, fat at the engine, a radiator bulge on its flank.
  fila(g, 0, -16, 2, M);
  fila(g, 1, -16, 4, M0);
  fila(g, 2, -14, 6, M);
  fila(g, 3, -6, 9, M0);
  R(g, -8, -1, 5, 1, M1);
  R(g, -8, 1, 5, 2, M0);
  R(g, -8, 1, 1, 2, DK);
  if (has('ala')) {
    fila(g, 2, -6, 6, M1);
    fila(g, 3, -5, 4, M);
  } else stub(g, -3, 2, 3, 2);
  // The central pod, higher, with the nose guns sticking out.
  fila(g, -4, -2, 12, M1);
  fila(g, -3, -6, 16, M);
  fila(g, -2, -7, 18, M);
  fila(g, -1, -6, 17, M0);
  R(g, 0, -3, 12, 1, M2);
  R(g, 18, -3, 3, 1, P.metal0);
  R(g, 17, -2, 4, 1, P.metal0);
  R(g, 19, -1, 2, 1, P.metal0);
  R(g, 14, -2, 1, 1, AZ);
  if (has('motor')) {
    // Engine cowl at the front of the boom, its spinner and the turbo hump.
    fila(g, 0, 3, 9, M);
    fila(g, 1, 4, 9, M1);
    R(g, 3, 3, 4, 1, M0);
    R(g, -2, -1, 3, 1, M1);
    D.oval(g, 11, 2, 2, 2, M);
    R(g, 10, 0, 1, 5, M0);
    R(g, 11, 1, 1, 1, P.white);
  } else stub(g, 7, 0, 2, 4);
  cupula(g, has, 5, -5, 4, 2, 5, M0);
}

/** DH Mosquito: PRU blue, wooden and smooth; side-by-side cockpit up front, the engine slung under the wing. */
function paintMosquito(g: Ctx, has: Has) {
  const B0 = '#3a5470', B = '#5a7a9a', B1 = '#88a6c4', B2 = '#b4cce0', DK = '#1c2430';
  if (has('cola')) {
    [[-19, 3], [-20, 5], [-20, 6], [-20, 6], [-20, 7], [-20, 7], [-20, 8]].forEach(([x, w], i) => R(g, x, -10 + i, w, 1, i === 0 ? B1 : B));
    R(g, -18, -8, 1, 6, B0);
    fila(g, -1, -21, -14, B1);
    fila(g, 0, -20, -15, B0);
  } else stub(g, -16, -4, 2, 4);
  fila(g, -3, -10, 12, B1);
  fila(g, -2, -16, 15, B);
  fila(g, -1, -18, 16, B);
  fila(g, 0, -18, 17, B);
  fila(g, 1, -16, 16, B0);
  fila(g, 2, -12, 12, B0);
  R(g, -14, -2, 10, 1, B2);
  R(g, -6, -2, 1, 4, B0);
  // Glazed nose (a bomber Mosquito) with a frame.
  R(g, 14, -2, 4, 3, P.gl0);
  R(g, 15, -2, 2, 1, P.gl1);
  R(g, 16, -2, 1, 3, B0);
  if (has('bodega')) {
    R(g, -6, 3, 8, 2, B0);
    R(g, -5, 4, 6, 1, DK);
  } else stub(g, -4, 3, 3, 2);
  if (has('ala')) {
    fila(g, 2, -8, 8, B1);
    fila(g, 3, -7, 6, B);
  } else stub(g, -3, 2, 3, 2);
  if (has('motor')) {
    // The Merlin nacelle under the wing, its exhaust stubs and the spinner.
    fila(g, 2, 0, 10, B);
    fila(g, 3, -2, 10, B0);
    fila(g, 4, 0, 9, B0);
    for (const x of [3, 5, 7]) R(g, x, 2, 1, 1, DK);
    D.oval(g, 11, 3, 2, 2, B1);
    R(g, 10, 1, 1, 5, B0);
    R(g, 11, 2, 1, 1, P.white);
  } else stub(g, 6, 2, 2, 3);
  cupula(g, has, 9, -4, 4, 2, 9, B0, undefined, 7);
}

/* ── Jets ────────────────────────────────────────────────────────────────── */

/** A-37 Dragonfly: South-East-Asia camo, side-by-side bubble, straight wing with tip tanks, twin jets in the roots. */
function paintA37(g: Ctx, has: Has) {
  const T = '#9a8a62', G = '#5a6a44', G0 = '#3a4630', U = '#c8ccc0', U0 = '#9aa094', DK = '#22261c';
  if (has('cola')) {
    deriva(g, -9, 8, -16, 3, 0.4, 0.15, G, T);
    fila(g, -3, -17, -12, T);
    fila(g, -2, -16, -13, G0);
  } else stub(g, -13, -4, 2, 4);
  fila(g, -3, -10, 8, T);
  fila(g, -2, -14, 11, G);
  fila(g, -1, -15, 13, G);
  fila(g, 0, -15, 14, U);
  fila(g, 1, -13, 12, U0);
  for (const [x, y, w] of [[-12, -2, 4], [-4, -3, 3], [2, -2, 4], [9, -1, 3]]) R(g, x, y, w, 1, T);
  for (const [x, y] of [[-8, -1], [5, -1], [11, -2]]) R(g, x, y, 2, 1, G0);
  // Nose probe and gun port.
  R(g, 15, 0, 3, 1, P.metal0);
  R(g, 13, 0, 1, 1, DK);
  if (has('motor')) {
    // Engine in the wing root: intake ahead of the wing, nozzle behind it.
    R(g, -1, 0, 5, 3, U0);
    R(g, 3, 0, 1, 3, DK);
    fila(g, 1, -12, -1, U0);
    tobera(g, has, -15, 1, 3);
  } else stub(g, -11, 0, 2, 3);
  if (has('ala')) {
    fila(g, 2, -6, 5, U);
    fila(g, 3, -5, 4, U0);
    // The tip tank.
    D.oval(g, 0, 4, 4, 1, T);
    R(g, -3, 4, 6, 1, G);
    R(g, 4, 4, 1, 1, P.white);
  } else stub(g, -1, 2, 3, 2);
  cupula(g, has, 6, -4, 4, 2, 6, G0);
}

/** A-4 Skyhawk: gull grey over white, the humped avionics spine, long nose and refuelling probe, small delta. */
function paintA4(g: Ctx, has: Has) {
  const G0 = '#707680', G = '#a6acb4', G1 = '#c8ccd2', W = '#f0f2f4', W0 = '#c4c8ce', DK = '#262a30', R0 = '#d8402a';
  if (has('cola')) {
    deriva(g, -10, 9, -15, 3, 0.55, 0.2, G, G1);
    R(g, -14, -9, 3, 1, R0);
    fila(g, 0, -18, -12, G1);
    fila(g, 1, -17, -13, W0);
  } else stub(g, -13, -4, 2, 4);
  // The hump behind the cockpit.
  fila(g, -4, -8, 2, G1);
  fila(g, -3, -11, 4, G);
  fila(g, -2, -14, 14, G);
  fila(g, -1, -16, 17, G);
  fila(g, 0, -16, 19, W);
  fila(g, 1, -14, 16, W0);
  fila(g, 2, -10, 6, W0);
  R(g, -6, -2, 1, 3, G0);
  // Intake under the cockpit and the refuelling probe.
  R(g, 0, 0, 6, 3, G0);
  R(g, 1, 0, 5, 1, G);
  R(g, 5, 0, 1, 3, DK);
  R(g, 12, -3, 8, 1, P.metal0);
  R(g, 20, -3, 1, 1, DK);
  if (has('ala')) {
    fila(g, 2, -10, 3, G1);
    fila(g, 3, -9, 1, G);
    fila(g, 4, -7, -2, G0);
    // The 20 mm muzzle at the wing root.
    R(g, 3, 2, 3, 1, P.metal0);
  } else stub(g, -4, 2, 3, 2);
  tobera(g, has, -18, 0, 4);
  cupula(g, has, 7, -4, 4, 2, 7, G0);
}

/** F-5 Tiger II: blue-grey ghost camo, shark nose, wingtip rails, twin nozzles, LERX. */
function paintF5(g: Ctx, has: Has) {
  const B0 = '#4e5c78', B = '#7a8aa8', B1 = '#a8b6cc', B2 = '#cfd8e4', DK = '#222838';
  if (has('cola')) {
    deriva(g, -10, 9, -15, 3, 0.6, 0.15, B, B1);
    fila(g, 0, -18, -12, B1);
    fila(g, 1, -17, -13, B0);
  } else stub(g, -13, -4, 2, 4);
  fila(g, -3, -11, 4, B1);
  fila(g, -2, -15, 11, B);
  fila(g, -1, -16, 15, B);
  fila(g, 0, -16, 18, B2);
  fila(g, 1, -15, 14, B0);
  fila(g, 2, -12, 2, B0);
  // A darker ghost patch, the flattened shark nose and the LERX running forward.
  R(g, -9, -2, 5, 2, B0);
  R(g, 3, -2, 3, 1, B0);
  fila(g, 0, 8, 14, B1);
  R(g, 19, 0, 1, 1, B0);
  // Small intake under the cockpit.
  R(g, -1, 1, 5, 2, B0);
  R(g, 3, 1, 1, 2, DK);
  if (has('ala')) {
    fila(g, 2, -9, 1, B1);
    fila(g, 3, -8, -1, B);
    fila(g, 4, -6, -3, B0);
    // Wingtip rail.
    R(g, -9, 5, 7, 1, P.metal0);
  } else stub(g, -4, 2, 3, 2);
  tobera(g, has, -19, 1, 3);
  cupula(g, has, 7, -4, 4, 2, 7, B0);
}

/** MiG-21: natural metal tube, the shock cone in the nose intake, a big swept fin and a delta. */
function paintMig21(g: Ctx, has: Has) {
  const M0 = '#7a808c', M = '#b4bac4', M1 = '#d4d8de', M2 = '#eef0f4', DK = '#262a32', V = '#3a6a4a';
  if (has('cola')) {
    deriva(g, -11, 10, -15, 3, 0.75, 0.15, M, M1);
    R(g, -13, -9, 2, 2, '#ff4a3a');
    fila(g, 0, -19, -13, M1);
    fila(g, 1, -18, -14, M0);
    // The ventral fin.
    R(g, -14, 2, 3, 2, M0);
  } else stub(g, -13, -4, 2, 4);
  // A long round tube with a spine behind the cockpit.
  fila(g, -3, -12, 6, M1);
  fila(g, -2, -16, 15, M);
  fila(g, -1, -17, 17, M);
  fila(g, 0, -17, 17, M);
  fila(g, 1, -16, 16, M0);
  fila(g, 2, -12, 8, M0);
  R(g, -14, -2, 12, 1, M2);
  for (const x of [-8, 0, 6]) R(g, x, -2, 1, 4, M0);
  // The open intake with its dark shock cone.
  R(g, 17, -2, 1, 4, DK);
  R(g, 18, -1, 2, 2, V);
  R(g, 20, 0, 1, 1, V);
  if (has('ala')) {
    fila(g, 2, -11, 0, M1);
    fila(g, 3, -10, -3, M);
    fila(g, 4, -8, -5, M0);
  } else stub(g, -6, 2, 3, 2);
  tobera(g, has, -20, 0, 4);
  cupula(g, has, 8, -4, 4, 2, 8, M0);
}

/** AV-8B Harrier II: two greys, shoulder wing, huge side intake, the swivelling nozzles under the body. */
function paintHarrier(g: Ctx, has: Has) {
  const G0 = '#4e5866', G = '#7a8494', G1 = '#a2acba', G2 = '#c8d0da', DK = '#22262e';
  if (has('cola')) {
    deriva(g, -10, 8, -16, 3, 0.6, 0.2, G, G1);
    fila(g, -2, -19, -13, G1);
    fila(g, -1, -18, -14, G0);
  } else stub(g, -14, -4, 2, 4);
  fila(g, -3, -12, 8, G1);
  fila(g, -2, -16, 12, G);
  fila(g, -1, -17, 15, G);
  fila(g, 0, -15, 17, G);
  fila(g, 1, -12, 14, G0);
  fila(g, 2, -8, 8, G0);
  fila(g, 3, -6, 4, G0);
  R(g, -12, -1, 4, 1, G0);
  R(g, 13, 0, 4, 1, G2);
  // The big round side intake under and behind the cockpit.
  D.oval(g, 3, 0, 3, 2, G0);
  R(g, 5, -1, 1, 3, DK);
  R(g, 4, -2, 2, 1, G2);
  if (has('ala')) {
    // Shoulder wing seen edge-on, drooping (anhedral) towards us.
    fila(g, -2, -9, 4, G2);
    fila(g, -1, -8, 3, G1);
    R(g, -6, 0, 6, 1, G);
  } else stub(g, -3, -2, 3, 2);
  if (has('motor')) {
    // The front and rear swivelling nozzles.
    R(g, 1, 3, 3, 3, P.metal0);
    R(g, 1, 3, 3, 1, P.metal);
    R(g, -6, 3, 3, 3, P.metal0);
    R(g, -6, 3, 3, 1, P.metal);
    R(g, -5, 5, 1, 1, DK);
  } else stub(g, -4, 3, 3, 2);
  cupula(g, has, 9, -4, 4, 2, 9, G0);
}

/** Mirage 2000: two blues, a pure delta, half-cone intakes beside the cockpit, a tall swept fin. */
function paintMirage(g: Ctx, has: Has) {
  const B0 = '#4a5a74', B = '#7488a6', B1 = '#9cb0ca', B2 = '#c4d2e2', DK = '#222a38';
  if (has('cola')) {
    deriva(g, -12, 11, -14, 3, 0.65, 0.3, B, B1);
    R(g, -12, -11, 2, 1, B2);
  } else stub(g, -12, -4, 2, 4);
  fila(g, -3, -12, 6, B1);
  fila(g, -2, -16, 12, B);
  fila(g, -1, -17, 15, B);
  fila(g, 0, -17, 19, B);
  fila(g, 1, -16, 14, B0);
  fila(g, 2, -12, 4, B0);
  R(g, -12, -2, 3, 2, B0);
  R(g, -2, -1, 3, 1, B0);
  R(g, 19, 0, 2, 1, P.metal0);
  // Half-cone intake.
  R(g, -1, -1, 5, 3, B0);
  R(g, 4, 0, 1, 2, DK);
  R(g, 5, 0, 1, 1, B2);
  if (has('ala')) {
    // The big delta seen edge-on: thick at the root, long chord.
    fila(g, 2, -15, 3, B1);
    fila(g, 3, -14, -1, B);
    fila(g, 4, -11, -5, B0);
  } else stub(g, -6, 2, 3, 2);
  tobera(g, has, -20, 0, 4);
  cupula(g, has, 8, -4, 4, 2, 8, B0);
}

/** JAS 39 Gripen: medium grey, canards beside the intakes, a small delta and one fin. */
function paintGripen(g: Ctx, has: Has) {
  const G0 = '#5e6670', G = '#8c949e', G1 = '#b2b9c2', G2 = '#d4d9df', DK = '#22262c';
  if (has('cola')) {
    deriva(g, -11, 10, -14, 3, 0.6, 0.25, G, G1);
  } else stub(g, -12, -4, 2, 4);
  fila(g, -3, -11, 5, G1);
  fila(g, -2, -15, 11, G);
  fila(g, -1, -16, 14, G);
  fila(g, 0, -16, 18, G);
  fila(g, 1, -15, 13, G0);
  fila(g, 2, -11, 3, G0);
  R(g, -10, -2, 8, 1, G2);
  R(g, 18, 0, 2, 1, G0);
  // Intake and the canard right above it.
  R(g, 0, 0, 4, 2, G0);
  R(g, 3, 0, 1, 2, DK);
  fila(g, -1, 0, 5, G2);
  R(g, 0, -1, 2, 1, G1);
  if (has('ala')) {
    fila(g, 2, -14, 1, G1);
    fila(g, 3, -12, -3, G);
    fila(g, 4, -9, -6, G0);
  } else stub(g, -6, 2, 3, 2);
  tobera(g, has, -19, 0, 4);
  cupula(g, has, 7, -4, 4, 2, 7, G0);
}

/** Rafale: dark grey, canards on the shoulders, intakes under the cockpit, twin engines, one fin. */
function paintRafale(g: Ctx, has: Has) {
  const G0 = '#3e4650', G = '#5e6874', G1 = '#848e9a', G2 = '#aab2bc', DK = '#1a1e24';
  if (has('cola')) {
    deriva(g, -11, 10, -14, 3, 0.55, 0.2, G, G1);
  } else stub(g, -12, -4, 2, 4);
  fila(g, -3, -11, 6, G1);
  fila(g, -2, -15, 12, G);
  fila(g, -1, -16, 15, G);
  fila(g, 0, -16, 18, G);
  fila(g, 1, -15, 14, G0);
  fila(g, 2, -12, 6, G0);
  R(g, -10, -2, 9, 1, G2);
  R(g, 18, -1, 2, 1, P.metal0);
  // Intake under the cockpit, the canard above it.
  R(g, -1, 1, 6, 2, G0);
  R(g, 4, 1, 1, 2, DK);
  fila(g, -1, -2, 4, G2);
  if (has('ala')) {
    fila(g, 2, -14, 0, G1);
    fila(g, 3, -12, -3, G);
    fila(g, 4, -9, -6, G0);
  } else stub(g, -6, 2, 3, 2);
  tobera(g, has, -19, 1, 4);
  cupula(g, has, 8, -4, 4, 2, 8, G0);
}

/** Eurofighter Typhoon: light grey, the big chin intake «smile», canards under the cockpit, one fin. */
function paintTyphoon(g: Ctx, has: Has) {
  const G0 = '#6a7480', G = '#98a2ae', G1 = '#bcc4ce', G2 = '#dde2e8', DK = '#22262c';
  if (has('cola')) {
    deriva(g, -11, 10, -14, 3, 0.6, 0.25, G, G1);
  } else stub(g, -12, -4, 2, 4);
  fila(g, -3, -11, 6, G1);
  fila(g, -2, -15, 12, G);
  fila(g, -1, -16, 16, G);
  fila(g, 0, -16, 19, G);
  fila(g, 1, -15, 12, G0);
  fila(g, 2, -12, 6, G0);
  R(g, -10, -2, 9, 1, G2);
  // Chin intake: a dark grin under the cockpit.
  R(g, 0, 2, 8, 2, G0);
  R(g, 1, 3, 6, 1, DK);
  R(g, 7, 2, 1, 1, G2);
  // Canards just behind the radome.
  fila(g, 0, 9, 13, G2);
  R(g, 10, 1, 2, 1, G1);
  if (has('ala')) {
    fila(g, 2, -14, -1, G1);
    fila(g, 3, -12, -4, G);
    fila(g, 4, -9, -6, G0);
  } else stub(g, -6, 2, 3, 2);
  tobera(g, has, -19, 0, 4);
  cupula(g, has, 8, -4, 4, 2, 8, G0);
}

/** F-35A: dark stealth grey with lighter panels, twin canted fins, DSI bump intake, gold-tinted canopy. */
function paintF35(g: Ctx, has: Has) {
  const G0 = '#3a3e48', G = '#555b66', G1 = '#727986', G2 = '#9097a2', DK = '#16181e';
  if (has('cola')) {
    // Twin canted fins: the far one ahead and higher.
    for (let i = 0; i < 6; i++) R(g, -12 + Math.round(i * 0.6), -9 + i, 3, 1, i ? G0 : G);
    for (let i = 0; i < 6; i++) R(g, -16 + Math.round(i * 0.6), -8 + i, 4, 1, i === 0 ? G2 : G1);
    fila(g, 0, -18, -12, G1);
    fila(g, 1, -17, -13, G0);
  } else stub(g, -13, -4, 2, 4);
  // A fat body, the panel lines in a lighter grey.
  fila(g, -3, -11, 5, G1);
  fila(g, -2, -15, 11, G);
  fila(g, -1, -16, 14, G);
  fila(g, 0, -16, 17, G);
  fila(g, 1, -16, 14, G0);
  fila(g, 2, -14, 8, G0);
  R(g, -8, -2, 4, 2, G1);
  R(g, 2, -1, 3, 1, G1);
  R(g, -13, 0, 2, 1, G2);
  // DSI bump and its caret intake.
  R(g, 1, 0, 5, 2, G0);
  D.oval(g, 3, 0, 2, 1, G1);
  R(g, 5, 0, 1, 2, DK);
  if (has('ala')) {
    fila(g, 2, -11, 2, G1);
    fila(g, 3, -10, -1, G);
    fila(g, 4, -8, -4, G0);
  } else stub(g, -4, 2, 3, 2);
  tobera(g, has, -19, 0, 4);
  cupula(g, has, 6, -4, 5, 2, 6, G0, ['#7a6a3a', '#ffd878']);
}

/* ── The fun one ─────────────────────────────────────────────────────────── */

/** A cardboard box with a desk fan strapped to the front, cardboard wings taped on and a cereal-box fin. */
function paintCarton(g: Ctx, has: Has) {
  const C0 = '#9a6a3a', C = '#c8965a', C1 = '#e4b880', T = '#e8dcb0', RJ = '#e03a3a', DK = '#4a3020';
  if (has('cola')) {
    // A flat cereal-box fin, taped on.
    fila(g, -8, -16, -13, '#ffd23a');
    for (let i = 1; i < 7; i++) fila(g, -8 + i, -17, -13 + (i > 4 ? 1 : 0), i % 3 === 0 ? '#ff7a3a' : '#ffd23a');
    R(g, -16, -5, 3, 1, P.white);
    R(g, -14, -2, 3, 1, T);
  } else stub(g, -13, -3, 2, 4);
  // The box: corrugated sides, a darker bottom, the tape seam and «frágil» marks.
  R(g, -12, -4, 22, 9, C);
  R(g, -12, -4, 22, 1, C1);
  R(g, -12, 4, 22, 1, C0);
  R(g, -12, -4, 1, 9, C0);
  R(g, 9, -4, 1, 9, C0);
  for (let x = -10; x < 9; x += 3) R(g, x, -3, 1, 7, '#b8864a');
  R(g, -12, 0, 22, 1, T);
  R(g, -6, 1, 3, 2, RJ);
  R(g, -5, 2, 1, 1, P.white);
  R(g, 2, 1, 1, 2, RJ);
  R(g, 3, 2, 2, 1, RJ);
  // The open flaps sticking up, the pilot sitting inside.
  R(g, -12, -6, 6, 2, C1);
  R(g, 4, -6, 6, 2, C1);
  R(g, -11, -7, 4, 1, C);
  if (has('cabina')) {
    // Swimming goggles as a windscreen, on a stick.
    R(g, 3, -8, 1, 4, DK);
    R(g, 3, -9, 3, 2, P.gl1);
  }
  miniHead(g, pilotoActual(), -1, -4);
  if (has('ala')) {
    // A flat sheet of cardboard taped across, bending a little.
    fila(g, 3, -8, 9, C1);
    fila(g, 4, -9, 8, C0);
    R(g, -1, 3, 3, 2, T);
  } else stub(g, -1, 3, 3, 2);
  if (has('motor')) {
    // The desk fan: its stand, the round guard and the hub.
    R(g, 10, 1, 2, 4, '#5a6a8a');
    D.disc(g, 13, 0, 4, '#8a9ab8');
    D.disc(g, 13, 0, 3, '#c8d4e8');
    for (let y = -3; y <= 3; y += 2) R(g, 13, y, 1, 1, '#5a6a8a');
    D.disc(g, 13, 0, 1, '#3a4a6a');
    R(g, 14, -1, 1, 1, P.white);
  } else stub(g, 10, -2, 2, 4);
}

export const PAINT_EXTRA: Record<ModeloNuevo, (g: Ctx, has: Has) => void> = {
  pillan: paintPillan, zero: paintZero, hurricane: paintHurricane, bf109: paintBf109, p38: paintP38, mosquito: paintMosquito,
  a37: paintA37, a4: paintA4, f5: paintF5, mig21: paintMig21, harrier: paintHarrier, mirage: paintMirage, gripen: paintGripen,
  rafale: paintRafale, typhoon: paintTyphoon, f35: paintF35, carton: paintCarton,
};
