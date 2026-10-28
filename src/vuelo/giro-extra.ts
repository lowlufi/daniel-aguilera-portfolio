import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { R, type Parte } from './dibujo';
import type { ModeloNuevo } from './fisica-tipos';
import { bodyH, cantedFin, ellWing, sideHead, stub, topHead, trap, wing, type View } from './giro';

/*
 * Banked (30°, 60°) and plan views for the second batch of the hangar
 * (aviones-extra.ts has their side views). Instead of one hand-written painter
 * per plane, each airframe is described by its planform: fuselage, wings,
 * tail plane, fin(s), canards, nacelles and canopy, and one painter draws any
 * of them far side first, near side last, exactly like the painters in
 * giro.ts. A plane with something special (the P-38's booms, the box) adds
 * a hook. Only data is read while this module loads, so the import cycle with
 * giro.ts is harmless.
 */

type Ctx = CanvasRenderingContext2D;
type Has = (p: Parte) => boolean;
type Col = [string, string, string];
const ri = Math.round;

/** A wing-like surface: root and tip chords [trailing x, leading x], span (px at 90°), height on the body. */
type Sup = { root: [number, number]; tip: [number, number]; span: number; y?: number; tipC?: string };

type Spec = {
  /** Dark, mid and light of the airframe. */
  col: Col;
  /** Belly colour along the bottom edge at 30°. */
  vientre?: string;
  /** Fuselage: centre x, half length, half height (a) and half width (b). */
  body: { cx: number; rx: number; a: number; b: number };
  /** Pointed jet nose from x0 to x1. */
  nariz?: [number, number];
  ala: Sup;
  /** Rounded (elliptic) wing instead: centre x, chord behind and ahead of it. */
  elip?: { xc: number; back: number; fwd: number };
  lerx?: Sup;
  canard?: Sup;
  cola?: Sup;
  /** Fin: tip and base chords, height; `doble` = twin canted fins this far apart. */
  deriva?: { top: [number, number]; base: [number, number]; h: number; tope?: string; doble?: number };
  /** Canopy centre x, half length, the pilot's head x; tinted glass. */
  cabina: { x: number; rx: number; hx: number; vidrio?: [string, string] };
  /** Spinner at the nose (props). */
  spinner?: { x: number; c: string; c0: string };
  /** Single nozzle at x (jets). */
  tobera?: number;
  /** Twin nacelles: spanwise d, height e on the body, from x0 to x1, half thickness. */
  motores?: { d: number; e: number; x0: number; x1: number; r: number; col: Col; boca?: boolean; tobera?: boolean };
  extra?: (g: Ctx, v: View, has: Has, fase: 'lejos' | 'cuerpo' | 'cerca') => void;
};

function nacelle(g: Ctx, m: NonNullable<Spec['motores']>, y: number) {
  const [d, mm, l] = m.col;
  const cx = (m.x0 + m.x1) / 2, rx = (m.x1 - m.x0) / 2;
  D.oval(g, ri(cx), y, ri(rx), m.r, d);
  R(g, m.x0 + 2, y - m.r, m.x1 - m.x0 - 3, m.r, mm);
  R(g, m.x0 + 3, y - m.r, m.x1 - m.x0 - 6, 1, l);
  if (m.boca) {
    R(g, m.x1 - 1, y - m.r + 1, 1, Math.max(1, m.r * 2 - 1), '#22262c');
  }
  if (m.tobera) {
    R(g, m.x0 - 1, y - 1, 2, 3, P.metal0);
    R(g, m.x0 - 1, y, 1, 1, '#22262c');
  }
}

function giroGenerico(sp: Spec, g: Ctx, v: View, has: Has) {
  const [d, m, l] = sp.col;
  const { s, c, k } = v;
  const WING = sp.col;
  const hy = bodyH(v, sp.body.a, sp.body.b);
  const wy = ri((sp.ala.y ?? 2) * c);
  const span = ri(sp.ala.span * s);
  const sup = (q: Sup, dir: 1 | -1) => wing(g, ri((q.y ?? 2) * c), dir, ri(q.span * s), q.root, q.tip, WING, q.tipC);
  const ala = (dir: 1 | -1) => {
    if (sp.elip) ellWing(g, wy, dir, span, sp.elip.xc, sp.elip.back, sp.elip.fwd, WING);
    else wing(g, wy, dir, span, sp.ala.root, sp.ala.tip, WING, sp.ala.tipC);
    if (sp.lerx) sup(sp.lerx, dir);
  };
  const mot = sp.motores;
  const eY = mot ? ri(mot.e * c) : 0;
  const eFar = mot ? eY - ri(mot.d * s) : 0, eNear = mot ? eY + ri(mot.d * s) : 0;
  const fin = sp.deriva;
  // Far side first.
  if (has('cola')) {
    if (sp.cola) sup(sp.cola, -1);
    if (fin?.doble) cantedFin(g, v, -fin.doble, 2, fin.h, fin.base, fin.top, d, m);
  }
  sp.extra?.(g, v, has, 'lejos');
  ala(-1);
  if (sp.canard) sup(sp.canard, -1);
  if (mot && has('motor') && k > 1) nacelle(g, mot, eFar);
  // The fuselage, lit from above, the spine moving to the middle as it rolls.
  const { cx, rx } = sp.body;
  D.oval(g, cx, 0, rx, hy, d);
  D.oval(g, cx, -ri(c), rx - 1, Math.max(1, hy - 1), m);
  R(g, cx - rx + 4, -ri((hy - 1) * c), rx, 1, l);
  if (sp.nariz) {
    const [n0, n1] = sp.nariz;
    const nose = Math.max(1, hy - 1);
    for (let x = n0; x <= n1; x++) {
      const h = ri(nose * (1 - (x - n0) / (n1 - n0 + 1)));
      R(g, x, -h, 1, h * 2 + 1, x < n1 - 1 ? m : d);
    }
  }
  if (k === 1 && sp.vientre) R(g, cx - rx + 3, hy - 1, rx * 2 - 5, 1, sp.vientre);
  if (sp.tobera !== undefined) {
    if (has('motor')) {
      R(g, sp.tobera, -1, 3, 3, P.metal0);
      R(g, sp.tobera, -1, 3, 1, P.metal);
      R(g, sp.tobera, 0, 1, 1, '#262a34');
    } else stub(g, sp.tobera + 2, -2, 2, 4);
  }
  if (sp.spinner) {
    const { x, c: sc, c0 } = sp.spinner;
    if (has('motor')) {
      D.disc(g, x, 0, 2, sc);
      R(g, x - 1, -2, 1, 5, c0);
      R(g, x, -1, 1, 1, P.white);
      R(g, x + 2, 0, 1, 1, P.cream);
    } else stub(g, x - 3, -2, 2, 4);
  }
  sp.extra?.(g, v, has, 'cuerpo');
  // Near side.
  if (has('cola')) {
    if (sp.cola) sup(sp.cola, 1);
    if (fin?.doble) cantedFin(g, v, fin.doble, 2, fin.h, fin.base, fin.top, m, l);
    else if (fin) {
      const top = -ri(fin.h * c), base = -ri(2 * c);
      if (top === base) R(g, fin.base[0], 0, fin.base[1] - fin.base[0] + 1, 1, d);
      else {
        trap(g, top, base, fin.top[0], fin.top[1], fin.base[0], fin.base[1], m);
        R(g, fin.top[0], top, fin.top[1] - fin.top[0] + 1, 1, fin.tope ?? l);
        R(g, fin.top[0] + 1, top + 1, 1, Math.max(1, base - top - 1), d);
      }
    }
  } else stub(g, cx - rx + 3, -1, 2, 3);
  if (has('ala')) ala(1);
  else stub(g, ri((sp.ala.root[0] + sp.ala.root[1]) / 2), wy + 1, 3, 2);
  if (sp.canard) sup(sp.canard, 1);
  if (mot) {
    if (has('motor')) nacelle(g, mot, k === 1 ? eY + 1 : eNear);
    else stub(g, mot.x0 + 4, eNear - 1, 2, 3);
  }
  sp.extra?.(g, v, has, 'cerca');
  // Canopy and pilot.
  const cab = sp.cabina;
  const [v0, v1] = cab.vidrio ?? [P.gl0, P.gl1];
  const glass = has('cabina');
  if (k === 1) {
    if (glass) D.oval(g, cab.x, -4, cab.rx, 2, v0);
    else R(g, cab.x - cab.rx, -3, cab.rx * 2 + 1, 1, d);
    sideHead(g, cab.hx, -2);
    if (glass) {
      g.globalAlpha = 0.45;
      D.oval(g, cab.x, -4, Math.max(1, cab.rx - 1), 1, v1);
      g.globalAlpha = 1;
      R(g, cab.x + 1, -6, 2, 1, P.white);
    }
  } else {
    const cy = -ri(3 * c);
    if (glass) D.oval(g, cab.x, cy, cab.rx + 1, 3, v0);
    topHead(g, cab.hx, cy, k === 2 ? 1 : 0);
    if (glass) {
      g.globalAlpha = 0.4;
      D.oval(g, cab.x + 1, cy - 1, Math.max(1, cab.rx - 1), 1, v1);
      g.globalAlpha = 1;
      R(g, cab.x + 2, cy - 2, 2, 1, P.white);
    }
  }
}

/* ── The airframes ───────────────────────────────────────────────────────── */

const SPECS: Record<ModeloNuevo, Spec> = {
  pillan: {
    col: ['#a8aebc', '#e4e8f0', '#ffffff'], vientre: '#ff5a2a', body: { cx: -2, rx: 14, a: 3, b: 3 },
    ala: { root: [-5, 7], tip: [-2, 3], span: 15, tipC: '#ff5a2a' },
    cola: { root: [-17, -12], tip: [-16, -14], span: 6, y: 0 },
    deriva: { top: [-16, -14], base: [-17, -11], h: 8, tope: '#ff5a2a' },
    cabina: { x: 0, rx: 6, hx: 2 }, spinner: { x: 14, c: '#ff5a2a', c0: '#c8401a' },
  },
  zero: {
    col: ['#8a8c72', '#c4c4a6', '#e2e2c8'], body: { cx: -3, rx: 15, a: 3, b: 3 },
    ala: { root: [-6, 8], tip: [-2, 3], span: 17, tipC: '#ffd23a' },
    elip: { xc: 1, back: 7, fwd: 7 },
    cola: { root: [-19, -13], tip: [-18, -15], span: 6, y: 0 },
    deriva: { top: [-18, -16], base: [-18, -12], h: 8 },
    cabina: { x: -1, rx: 6, hx: 1 }, spinner: { x: 15, c: '#6a6c74', c0: '#2a2c30' },
    extra: (g, v, has, f) => {
      // Black cowl ring round the radial.
      if (f !== 'cuerpo') return;
      const h = bodyH(v, 3, 3);
      R(g, 9, -h, 5, h * 2 + 1, '#2a2c30');
      R(g, 9, -h, 5, 1, '#4a4c54');
    },
  },
  hurricane: {
    col: ['#9a7a4a', '#c8a870', '#e4cc98'], vientre: '#a8c0d0', body: { cx: -3, rx: 16, a: 4, b: 3 },
    ala: { root: [-6, 8], tip: [-3, 3], span: 17 },
    cola: { root: [-20, -14], tip: [-19, -16], span: 6, y: 0 },
    deriva: { top: [-19, -17], base: [-19, -12], h: 9 },
    cabina: { x: -1, rx: 4, hx: -1 }, spinner: { x: 14, c: '#3a3a30', c0: '#22221c' },
    extra: (g, v, has, f) => {
      // Camo blotches over the back, and the 40 mm pod under each wing.
      if (f === 'cuerpo') for (const x of [-14, -6, 3]) R(g, x, -ri(v.c), 3, 1, '#8a5a32');
      if (f === 'lejos' || f === 'cerca') {
        const dir = f === 'lejos' ? -1 : 1;
        if (dir === 1 && !has('ala')) return;
        const y = ri(4 * v.c) + dir * ri(5 * v.s);
        R(g, 0, y, 9, 2, '#5a5a4a');
        R(g, 0, y, 9, 1, '#8a8a72');
        R(g, 9, y, 5, 1, P.metal0);
      }
    },
  },
  bf109: {
    col: ['#5a6068', '#8a929c', '#b8bec6'], vientre: '#a8bccc', body: { cx: -2, rx: 15, a: 3, b: 3 },
    ala: { root: [-5, 6], tip: [-2, 2], span: 15 },
    cola: { root: [-19, -13], tip: [-18, -15], span: 5, y: -1 },
    deriva: { top: [-17, -15], base: [-18, -13], h: 8, tope: '#ffd23a' },
    cabina: { x: 0, rx: 4, hx: 0 }, spinner: { x: 14, c: '#1e2226', c0: '#0e1012' },
    extra: (g, v, has, f) => {
      if (f !== 'cuerpo') return;
      // Mottle along the back and the yellow nose band.
      for (const x of [-13, -8, -3]) R(g, x, -ri(v.c), 2, 1, '#6c7480');
      const h = bodyH(v, 3, 3);
      R(g, 10, -h + 1, 2, h * 2 - 1, '#ffd23a');
    },
  },
  p38: {
    col: ['#6c7482', '#a4acb8', '#ccd2dc'], body: { cx: 5, rx: 12, a: 3, b: 3 },
    nariz: [17, 20],
    ala: { root: [-6, 6], tip: [-3, 2], span: 18, y: 1 },
    cabina: { x: 5, rx: 4, hx: 5 },
    motores: { d: 7, e: 2, x0: -19, x1: 9, r: 2, col: ['#6c7482', '#a4acb8', '#eef1f5'] },
    extra: (g, v, has, f) => {
      // The tail plane joins the booms; each boom carries its oval fin and its prop's spinner.
      const { s, c } = v;
      const e = ri(2 * c);
      const yF = e - ri(7 * s), yN = e + ri(7 * s);
      if (f === 'lejos') {
        if (has('cola')) {
          if (v.k > 1) R(g, -21, Math.min(yF, yN), 6, Math.abs(yN - yF) + 1, '#a4acb8');
          fin(g, v, -20, yF, '#6c7482');
        }
        if (v.k > 1 && has('motor')) spin(g, 11, yF);
      } else if (f === 'cerca') {
        if (has('cola')) fin(g, v, -20, v.k === 1 ? e + 1 : yN, '#a4acb8');
        if (has('motor')) spin(g, 11, v.k === 1 ? e + 1 : yN);
      }
    },
  },
  mosquito: {
    col: ['#3a5470', '#5a7a9a', '#88a6c4'], body: { cx: -2, rx: 18, a: 3, b: 3 },
    ala: { root: [-8, 7], tip: [-4, 2], span: 19, y: 1 },
    cola: { root: [-21, -15], tip: [-20, -17], span: 7, y: 0 },
    deriva: { top: [-20, -18], base: [-20, -13], h: 10 },
    cabina: { x: 9, rx: 4, hx: 9 },
    motores: { d: 7, e: 3, x0: -2, x1: 10, r: 2, col: ['#3a5470', '#5a7a9a', '#b4cce0'] },
    extra: (g, v, has, f) => {
      const { s, c } = v;
      const e = ri(3 * c);
      if (f === 'lejos' && v.k > 1 && has('motor')) spin(g, 11, e - ri(7 * s));
      if (f === 'cerca' && has('motor')) spin(g, 11, v.k === 1 ? e + 1 : e + ri(7 * s));
      if (f === 'cuerpo') {
        // Glazed nose.
        const h = Math.max(1, bodyH(v, 3, 3) - 1);
        R(g, 14, -h, 3, h * 2 + 1, P.gl0);
        R(g, 15, -h, 1, 1, P.gl1);
      }
    },
  },
  a37: {
    col: ['#3a4630', '#5a6a44', '#9a8a62'], vientre: '#c8ccc0', body: { cx: -1, rx: 15, a: 3, b: 4 },
    nariz: [14, 17],
    ala: { root: [-6, 5], tip: [-4, 2], span: 16 },
    cola: { root: [-18, -12], tip: [-17, -14], span: 6, y: -3 },
    deriva: { top: [-16, -14], base: [-17, -11], h: 9, tope: '#9a8a62' },
    cabina: { x: 6, rx: 4, hx: 6 }, tobera: -16,
    extra: (g, v, has, f) => {
      // Tip tanks at the wingtips.
      if (f === 'cuerpo') return;
      const dir = f === 'lejos' ? -1 : 1;
      if (dir === 1 && !has('ala')) return;
      const y = ri(2 * v.c) + dir * (ri(16 * v.s) + 1);
      D.oval(g, 0, y, 4, 1, '#9a8a62');
      R(g, 4, y, 1, 1, P.white);
    },
  },
  a4: {
    col: ['#707680', '#a6acb4', '#c8ccd2'], vientre: '#f0f2f4', body: { cx: -1, rx: 15, a: 3, b: 3 },
    nariz: [14, 18],
    ala: { root: [-11, 3], tip: [-9, -5], span: 12, tipC: '#d8402a' },
    cola: { root: [-18, -13], tip: [-18, -15], span: 5, y: -2 },
    deriva: { top: [-15, -13], base: [-17, -10], h: 10, tope: '#d8402a' },
    cabina: { x: 7, rx: 4, hx: 7 }, tobera: -18,
  },
  f5: {
    col: ['#4e5c78', '#7a8aa8', '#a8b6cc'], vientre: '#cfd8e4', body: { cx: 0, rx: 16, a: 3, b: 3 },
    nariz: [15, 19],
    ala: { root: [-9, 1], tip: [-8, -4], span: 12 },
    lerx: { root: [0, 9], tip: [0, 1], span: 3 },
    cola: { root: [-19, -13], tip: [-19, -16], span: 6, y: 0 },
    deriva: { top: [-15, -13], base: [-16, -9], h: 9 },
    cabina: { x: 7, rx: 4, hx: 7 },
    extra: (g, v, has, f) => {
      if (f === 'cuerpo') {
        // Twin nozzles side by side.
        if (has('motor')) for (const sg of [-1, 1]) {
          const y = ri(1 * v.c) + sg * ri(2 * v.s);
          R(g, -19, y - 1, 3, 2, P.metal0);
          R(g, -19, y - 1, 1, 1, '#262a34');
        } else stub(g, -17, -2, 2, 4);
      } else {
        // Wingtip rail.
        const dir = f === 'lejos' ? -1 : 1;
        if (dir === 1 && !has('ala')) return;
        const sp = ri(12 * v.s);
        if (sp > 1) R(g, -9, ri(2 * v.c) + dir * (sp + 1), 7, 1, P.metal0);
      }
    },
  },
  mig21: {
    col: ['#7a808c', '#b4bac4', '#d4d8de'], body: { cx: 0, rx: 18, a: 3, b: 3 },
    ala: { root: [-12, 1], tip: [-11, -9], span: 12 },
    cola: { root: [-19, -14], tip: [-19, -17], span: 5, y: 0 },
    deriva: { top: [-15, -13], base: [-17, -8], h: 11, tope: '#ff4a3a' },
    cabina: { x: 8, rx: 4, hx: 8 }, tobera: -20,
    extra: (g, v, has, f) => {
      if (f !== 'cuerpo') return;
      // The round intake and its shock cone.
      const h = Math.max(1, bodyH(v, 3, 3) - 1);
      R(g, 17, -h, 1, h * 2 + 1, '#262a32');
      R(g, 18, -1, 2, 3, '#3a6a4a');
      R(g, 20, 0, 1, 1, '#3a6a4a');
    },
  },
  harrier: {
    col: ['#4e5866', '#7a8494', '#a2acba'], body: { cx: -1, rx: 16, a: 3, b: 4 },
    nariz: [14, 17],
    ala: { root: [-9, 4], tip: [-7, -4], span: 14, y: -2 },
    cola: { root: [-19, -14], tip: [-19, -16], span: 6, y: -1 },
    deriva: { top: [-16, -14], base: [-17, -11], h: 8 },
    cabina: { x: 9, rx: 4, hx: 9 },
    extra: (g, v, has, f) => {
      const { s, c } = v;
      if (f !== 'cuerpo') return;
      // The big side intakes and the four nozzles, showing on both flanks from above.
      const h = bodyH(v, 3, 4);
      for (const sg of v.k > 1 ? [-1, 1] : [1]) {
        const y = v.k > 1 ? sg * (h + 1) : 1;
        D.oval(g, 3, y, 3, 1, '#4e5866');
        R(g, 5, y - 1, 1, 2, '#22262e');
        if (has('motor')) {
          R(g, 0, y + (v.k > 1 ? sg : 2), 3, 2, P.metal0);
          R(g, -6, y + (v.k > 1 ? sg : 2), 3, 2, P.metal0);
        }
      }
      if (!has('motor')) stub(g, -4, ri(3 * c) + ri(4 * s), 3, 2);
    },
  },
  mirage: {
    col: ['#4a5a74', '#7488a6', '#9cb0ca'], body: { cx: 0, rx: 17, a: 3, b: 3 },
    nariz: [16, 20],
    ala: { root: [-16, 3], tip: [-15, -11], span: 13 },
    deriva: { top: [-13, -11], base: [-16, -6], h: 12 },
    cabina: { x: 8, rx: 4, hx: 8 }, tobera: -20,
    extra: (g, v, has, f) => {
      if (f !== 'cuerpo') return;
      // Half-cone intakes on both flanks.
      const h = bodyH(v, 3, 3);
      for (const sg of v.k > 1 ? [-1, 1] : [1]) {
        const y = v.k > 1 ? sg * h : 0;
        R(g, -1, y - (v.k > 1 ? 0 : 1), 5, 2, '#4a5a74');
        R(g, 4, y - (v.k > 1 ? 0 : 1), 1, 2, '#222a38');
      }
    },
  },
  gripen: {
    col: ['#5e6670', '#8c949e', '#b2b9c2'], body: { cx: 0, rx: 16, a: 3, b: 3 },
    nariz: [16, 19],
    ala: { root: [-15, 2], tip: [-13, -9], span: 12 },
    canard: { root: [-1, 5], tip: [-1, 2], span: 6, y: 0 },
    deriva: { top: [-13, -11], base: [-15, -7], h: 11 },
    cabina: { x: 7, rx: 4, hx: 7 }, tobera: -19,
  },
  rafale: {
    col: ['#3e4650', '#5e6874', '#848e9a'], body: { cx: 0, rx: 17, a: 3, b: 4 },
    nariz: [16, 19],
    ala: { root: [-15, 1], tip: [-13, -9], span: 13 },
    canard: { root: [-1, 5], tip: [-2, 2], span: 6, y: -1 },
    deriva: { top: [-13, -11], base: [-15, -7], h: 11 },
    cabina: { x: 8, rx: 4, hx: 8 },
    extra: (g, v, has, f) => {
      if (f !== 'cuerpo') return;
      if (has('motor')) for (const sg of [-1, 1]) {
        const y = ri(v.c) + sg * ri(2 * v.s);
        R(g, -20, y - 1, 3, 2, P.metal0);
        R(g, -20, y - 1, 1, 1, '#1a1e24');
      } else stub(g, -18, -2, 2, 4);
    },
  },
  typhoon: {
    col: ['#6a7480', '#98a2ae', '#bcc4ce'], vientre: '#dde2e8', body: { cx: 0, rx: 17, a: 3, b: 4 },
    nariz: [16, 20],
    ala: { root: [-15, 0], tip: [-13, -9], span: 13 },
    canard: { root: [9, 13], tip: [9, 11], span: 5, y: 0 },
    deriva: { top: [-13, -11], base: [-15, -7], h: 11 },
    cabina: { x: 8, rx: 4, hx: 8 },
    extra: (g, v, has, f) => {
      if (f !== 'cuerpo') return;
      if (has('motor')) for (const sg of [-1, 1]) {
        const y = sg * ri(2 * v.s);
        R(g, -20, y - 1, 3, 2, P.metal0);
        R(g, -20, y - 1, 1, 1, '#22262c');
      } else stub(g, -18, -2, 2, 4);
      // The chin intake under the cockpit, showing at 30°.
      if (v.k === 1) {
        R(g, 0, 2, 8, 2, '#6a7480');
        R(g, 1, 3, 6, 1, '#22262c');
      }
    },
  },
  f35: {
    col: ['#3a3e48', '#555b66', '#727986'], body: { cx: -1, rx: 16, a: 3, b: 4 },
    nariz: [15, 18],
    ala: { root: [-11, 2], tip: [-9, -5], span: 12 },
    cola: { root: [-18, -13], tip: [-18, -15], span: 6, y: 0 },
    deriva: { top: [-16, -13], base: [-14, -10], h: 6, doble: 3 },
    cabina: { x: 6, rx: 5, hx: 6, vidrio: ['#7a6a3a', '#ffd878'] }, tobera: -19,
    extra: (g, v, has, f) => {
      if (f !== 'cuerpo') return;
      // Lighter panel lines (the stealth coating), the DSI bumps on both flanks.
      R(g, -8, -ri(v.c), 4, 1, '#9097a2');
      const h = bodyH(v, 3, 4);
      for (const sg of v.k > 1 ? [-1, 1] : [1]) D.oval(g, 3, v.k > 1 ? sg * h : 1, 2, 1, '#727986');
    },
  },
  carton: {
    col: ['#9a6a3a', '#c8965a', '#e4b880'], body: { cx: -1, rx: 11, a: 4, b: 4 },
    ala: { root: [-8, 9], tip: [-8, 9], span: 15, y: 3, tipC: '#e8dcb0' },
    deriva: { top: [-17, -13], base: [-17, -13], h: 7, tope: '#ffd23a' },
    cabina: { x: -1, rx: 3, hx: -1 },
    extra: (g, v, has, f) => {
      const { s, c } = v;
      if (f === 'cuerpo') {
        // A box is square from every side: redraw it as a block, with flaps and tape.
        const h = Math.max(2, ri(4 * c + 4 * s));
        R(g, -12, -h, 22, h * 2 + 1, '#c8965a');
        R(g, -12, -h, 22, 1, '#e4b880');
        R(g, -12, h, 22, 1, '#9a6a3a');
        R(g, -12, -h, 1, h * 2 + 1, '#9a6a3a');
        R(g, 9, -h, 1, h * 2 + 1, '#9a6a3a');
        R(g, -12, 0, 22, 1, '#e8dcb0');
        R(g, -6, -h + 1, 3, 2, '#e03a3a');
        // The flaps opened out, flat from above.
        if (v.k > 1) {
          R(g, -12, -h - 3, 22, 2, '#e4b880');
          R(g, -12, h + 2, 22, 2, '#e4b880');
        }
      } else if (f === 'cerca' && has('motor')) {
        // The desk fan's round guard.
        D.disc(g, 13, 0, 4, '#8a9ab8');
        D.disc(g, 13, 0, 3, '#c8d4e8');
        D.disc(g, 13, 0, 1, '#3a4a6a');
      }
    },
  },
};

/** A P-38 boom's oval fin, standing towards us as it rolls. */
function fin(g: Ctx, v: View, x: number, y: number, col: string) {
  const top = y - ri(6 * v.c), bot = y + ri(3 * v.c);
  if (top === bot) {
    R(g, x - 1, y, 6, 1, col);
    return;
  }
  for (let yy = top; yy <= bot; yy++) R(g, x + (yy === top || yy === bot ? 1 : 0), yy, yy === top || yy === bot ? 3 : 5, 1, col);
  R(g, x + 1, top, 3, 1, '#ccd2dc');
}

/** A twin's spinner on a nacelle. */
function spin(g: Ctx, x: number, y: number) {
  D.disc(g, x, y, 2, '#ccd2dc');
  R(g, x - 1, y - 2, 1, 5, '#6c7482');
  R(g, x, y - 1, 1, 1, P.white);
}

export const GIRO_EXTRA: Record<ModeloNuevo, (g: Ctx, v: View, has: Has) => void> = Object.fromEntries(
  (Object.keys(SPECS) as ModeloNuevo[]).map((m) => [m, (g: Ctx, v: View, has: Has) => giroGenerico(SPECS[m], g, v, has)]),
) as Record<ModeloNuevo, (g: Ctx, v: View, has: Has) => void>;

/** Banked sprite heights (the wings spread vertically). */
export const GIRO_H_EXTRA: Record<ModeloNuevo, number> = {
  pillan: 38, zero: 42, hurricane: 42, bf109: 38, p38: 46, mosquito: 48, a37: 40, a4: 32, f5: 34, mig21: 32,
  harrier: 36, mirage: 34, gripen: 32, rafale: 34, typhoon: 34, f35: 32, carton: 44,
};

/** Top-view head x and its height above the spine. */
export const TOP_HEAD_EXTRA: Record<ModeloNuevo, [number, number]> = {
  pillan: [2, 3], zero: [1, 3], hurricane: [-1, 4], bf109: [0, 3], p38: [5, 3], mosquito: [9, 3], a37: [6, 3], a4: [7, 3],
  f5: [7, 3], mig21: [8, 3], harrier: [9, 3], mirage: [8, 3], gripen: [7, 3], rafale: [8, 3], typhoon: [8, 3], f35: [6, 3], carton: [-1, 5],
};

/** Twin-engine nacelles (spanwise d, height e) and their props: [x, r] or null for jets. */
export const MOTORES_EXTRA: Partial<Record<ModeloNuevo, { d: number; e: number; prop?: [number, number] }>> = {
  p38: { d: 7, e: 2, prop: [12, 5] },
  mosquito: { d: 7, e: 3, prop: [12, 5] },
};

/** Twin nozzles side by side (half spacing), for the flames. */
export const JET_D_EXTRA: Partial<Record<ModeloNuevo, number>> = { f5: 2, rafale: 2, typhoon: 2, harrier: 4 };
