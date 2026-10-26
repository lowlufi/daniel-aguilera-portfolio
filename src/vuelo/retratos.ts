import { P } from '../game/dulce';
import { planeSprite } from './dibujo';
import type { ModeloBase as ModeloAvion } from './fisica-tipos';

/*
 * Big pilot portraits for the character-select screen (Metal Slug style):
 * a 96×96 bust of each pilot, drawn in the game's pastel "dulce" look with
 * inked outlines, 2–3 shades per colour, fur texture and goggle glints.
 *
 *  - quieto:  idle loop (breathing, ear twitch, scarf flutter, a blink).
 *  - elegido: hover/selected (leans in, sparkly eyes, scarf flying).
 *  - listo:   confirmed; frames 0–1 anticipation, 2–3 the pose (hold on 3).
 *
 * Every frame is painted once and cached. Shapes are filled row by row so
 * nothing is anti-aliased; each part gets its own 1 px outline.
 */

export type Pose = 'quieto' | 'elegido' | 'listo';
export const FRAMES: Record<Pose, number> = { quieto: 4, elegido: 2, listo: 4 };
export const FPS: Record<Pose, number> = { quieto: 3, elegido: 5, listo: 8 };

type G = CanvasRenderingContext2D;
type Pt = [number, number];
const S = 96;

/* ── Pixel toolkit ───────────────────────────────────────────────────────── */

function lienzo(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const ctx = (c: HTMLCanvasElement) => c.getContext('2d')!;

function R(g: G, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
/** A filled ellipse, row by row. */
function ell(g: G, cx: number, cy: number, rx: number, ry: number, c: string) {
  g.fillStyle = c;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const w = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.round(cx - w), x1 = Math.round(cx + w);
    if (x1 > x0) g.fillRect(x0, y, x1 - x0, 1);
  }
}
/** A filled polygon (flat list of x, y), scanline style. */
function poly(g: G, p: number[], c: string) {
  g.fillStyle = c;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 1; i < p.length; i += 2) {
    y0 = Math.min(y0, p[i]);
    y1 = Math.max(y1, p[i]);
  }
  const n = p.length / 2;
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.round(xs[i]), b = Math.round(xs[i + 1]);
      if (b > a) g.fillRect(a, y, b - a, 1);
    }
  }
}
/** A line of square dots (w px wide). */
function line(g: G, x0: number, y0: number, x1: number, y1: number, c: string, w = 1) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  g.fillStyle = c;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    g.fillRect(Math.round(x - (w - 1) / 2), Math.round(y - (w - 1) / 2), w, w);
  }
}
/** A thick round-ended stroke through points (stamped discs). */
function tubo(g: G, pts: Pt[], r: number, c: string, dx = 0, dy = 0) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let k = 0; k <= n; k++) ell(g, ax + ((bx - ax) * k) / n + dx, ay + ((by - ay) * k) / n + dy, r, r, c);
  }
}
/** Quadratic curve sampled into points. */
function curva(a: Pt, c: Pt, b: Pt, n = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}
const hash = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Little fur strokes scattered in an ellipse (use inside `capa`'s shade so they stay on the shape). */
function pelaje(g: G, cx: number, cy: number, rx: number, ry: number, c: string, n: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i * 3) * Math.PI * 2, d = Math.sqrt(hash(seed + i * 3 + 1));
    const x = Math.round(cx + Math.cos(a) * rx * d), y = Math.round(cy + Math.sin(a) * ry * d);
    R(g, x, y, 1, 2, c);
    if (hash(seed + i * 3 + 2) > 0.5) R(g, x + 1, y + 1, 1, 1, c);
  }
}
/** Pointy fur tufts along an ellipse edge, from angle a0 to a1 (radians, 0 = right, y down). */
function mechones(g: G, cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number, len: number, c: string) {
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5)) / n, da = ((a1 - a0) / n) * 0.55;
    const p = (t: number, k: number) => [cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k];
    const [x0, y0] = p(a - da, 0.92), [x1, y1] = p(a + da * 0.4, 1 + len / Math.max(rx, ry)), [x2, y2] = p(a + da, 0.92);
    poly(g, [x0, y0, x1, y1, x2, y2], c);
  }
}

/**
 * Paints one part on its own layer, shades it (clipped to what `paint` drew)
 * and stamps it on `main` with a 1 px outline in `ink`.
 */
function capa(main: G, ink: string | null, paint: (g: G) => void, shade?: (g: G) => void) {
  const c = lienzo(S, S), g = ctx(c);
  paint(g);
  if (shade) {
    g.globalCompositeOperation = 'source-atop';
    shade(g);
    g.globalCompositeOperation = 'source-over';
  }
  if (ink) {
    const o = lienzo(S, S), q = ctx(o);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) q.drawImage(c, dx, dy);
    q.globalCompositeOperation = 'source-in';
    q.fillStyle = ink;
    q.fillRect(0, 0, S, S);
    main.drawImage(o, 0, 0);
  }
  main.drawImage(c, 0, 0);
}

/* ── Colours ─────────────────────────────────────────────────────────────── */

type Tono = { k0: string; k1: string; k2: string; k3: string; ink: string };
const CHAQUETA: Tono = { k0: '#4a2a26', k1: '#7a4632', k2: '#a0623e', k3: '#c8865a', ink: '#2a1418' };
const GORRO: Tono = { k0: '#4a3026', k1: '#6e4632', k2: '#93603e', k3: '#b8825a', ink: '#2a1612' };
const LANA = { k0: '#c8a07a', k1: '#ecd2b0', k2: '#fff4e0' };
const BRONCE = { k0: '#8a5a1e', k1: '#d8a040', k2: '#ffe08a', ink: '#3a2414' };
const CORREA = { k0: '#2e2026', k1: '#4a3634' };

/** Each plane's paint (the scarf and the card use it). */
const AVION: Record<ModeloAvion, Tono> = {
  caza: { k0: '#c8481a', k1: '#f2662a', k2: '#ff9858', k3: '#ffcca0', ink: '#6a1e08' },
  avioneta: { k0: '#e8a828', k1: '#ffd84a', k2: '#ffe880', k3: '#fff6c8', ink: '#8a5010' },
  bombardero: { k0: '#5a9ae0', k1: '#9ad0ff', k2: '#c4e4ff', k3: '#eef8ff', ink: '#2a5a9a' },
};

type Pelo = { k0: string; k1: string; k2: string; k3: string; ink: string };
const DUI: Pelo = { k0: P.o1, k1: P.o2, k2: P.o3, k3: P.o4, ink: '#5a220c' };
const RAYA = '#d2601c', RAYA0 = '#a8420e';
const BLANCO = { k0: '#e8c8a8', k1: '#fff4e0', k2: '#ffffff' };
const LULU: Pelo = { k0: '#211b2f', k1: '#2e2840', k2: '#443c5c', k3: '#625a84', ink: '#0e0a16' };
const TAN: Pelo = { k0: '#9a6030', k1: '#cc8c4c', k2: '#e8ae6c', k3: '#fad098', ink: '#3a1e0c' };
/** Almendrita's black saddle and her greying muzzle (she's a senior lady). */
const NEGRO = { k0: '#16121a', k1: '#2a2430', k2: '#443c4a', k3: '#6a6070' };
const GRIS = { k0: '#a0948e', k1: '#cfc6c0', k2: '#ebe5e0' };

/* ── Animation state ─────────────────────────────────────────────────────── */

type Boca = 'picara' | 'sonrisa' | 'mueca' | 'ladrido' | 'ladrido2' | 'firme' | 'o';
type Brazo = 'nada' | 'alcanza' | 'baja' | 'pulgar' | 'saludo1' | 'saludo';
type Estado = {
  by: number; // body offset (breathing / crouch)
  hy: number; // head offset
  hx: number;
  blink: boolean;
  squint: boolean; // happy ^ ^ eyes
  brillo: number; // 0 none, 1–2 sparkly eyes (two alternating glints)
  oreja: number; // ear twitch / ears back (-1) / ears up (+1, +2)
  bufanda: number; // scarf flutter phase 0..3
  vuelo: number; // 0 droops, 1 flies
  brazo: Brazo;
  gafas: number; // 0 up on the cap, 1 halfway, 2 over the eyes
  boca: Boca;
  ceja: 'nada' | 'picara' | 'firme' | 'timida';
  cola: number; // Lulu's tail: 0 hidden, 1 rising, 2 up, 3 up with a curl
};
const BASE: Estado = { by: 0, hy: 0, hx: 0, blink: false, squint: false, brillo: 0, oreja: 0, bufanda: 0, vuelo: 0, brazo: 'nada', gafas: 0, boca: 'sonrisa', ceja: 'nada', cola: 0 };

function estado(m: ModeloAvion, pose: Pose, f: number): Estado {
  const boca: Boca = m === 'caza' ? 'picara' : 'sonrisa';
  const ceja = m === 'caza' ? 'picara' : m === 'avioneta' ? 'timida' : 'nada';
  const b: Estado = { ...BASE, boca, ceja };
  if (pose === 'quieto') {
    return (<Estado[]>[
      { ...b, bufanda: 0 },
      { ...b, by: -1, hy: -1, bufanda: 1 },
      { ...b, oreja: 1, bufanda: 2 },
      { ...b, blink: true, bufanda: 3 },
    ])[f % 4];
  }
  if (pose === 'elegido') {
    const e: Estado = { ...b, by: 1, hy: 3, brillo: 1 + (f % 2), vuelo: 1, bufanda: f % 2 ? 2 : 0, oreja: m === 'bombardero' ? 1 : 0 };
    e.boca = m === 'caza' ? 'mueca' : m === 'avioneta' ? 'o' : 'ladrido2';
    if (m === 'avioneta') e.ceja = 'nada';
    return e;
  }
  f = Math.min(3, f);
  if (m === 'caza') {
    return (<Estado[]>[
      { ...b, by: 1, hy: 1, brazo: 'alcanza', boca: 'mueca', bufanda: 1 },
      { ...b, by: 0, hy: 0, brazo: 'baja', gafas: 1, boca: 'mueca', bufanda: 2, vuelo: 0.5 },
      { ...b, by: -1, hy: -2, brazo: 'pulgar', gafas: 2, boca: 'mueca', ceja: 'firme', bufanda: 3, vuelo: 1, brillo: 1 },
      { ...b, by: -1, hy: -1, brazo: 'pulgar', gafas: 2, boca: 'mueca', ceja: 'firme', bufanda: 0, vuelo: 1, brillo: 2 },
    ])[f];
  }
  if (m === 'avioneta') {
    return (<Estado[]>[
      { ...b, by: 2, hy: 3, squint: true, boca: 'firme', ceja: 'firme', cola: 1, oreja: -1 },
      { ...b, by: 0, hy: 0, brazo: 'saludo1', boca: 'firme', ceja: 'firme', cola: 2, bufanda: 1 },
      { ...b, by: -1, hy: -2, brazo: 'saludo', boca: 'firme', ceja: 'firme', cola: 3, bufanda: 2, vuelo: 1, brillo: 1, oreja: 1 },
      { ...b, by: -1, hy: -1, brazo: 'saludo', boca: 'sonrisa', ceja: 'firme', cola: 2, bufanda: 3, vuelo: 1, brillo: 2, oreja: 1 },
    ])[f];
  }
  return (<Estado[]>[
    { ...b, by: 2, hy: 4, squint: true, boca: 'sonrisa', oreja: -1 },
    { ...b, by: 0, hy: -1, brazo: 'saludo1', boca: 'ladrido2', oreja: 1, bufanda: 1 },
    { ...b, by: -1, hy: -3, brazo: 'saludo', boca: 'ladrido', oreja: 2, bufanda: 2, vuelo: 1, squint: true },
    { ...b, by: -1, hy: -2, brazo: 'saludo', boca: 'ladrido2', ceja: 'firme', oreja: 2, bufanda: 3, vuelo: 1, brillo: 1 },
  ])[f];
}

/* ── Shared gear: jacket, scarf, cap, goggles, arms ──────────────────────── */

type Cuerpo = { top: number; wt: number; wb: number; pecho: (g: G, x0: number, y0: number, x1: number, y1: number) => void; ink: string };

/** Leather flight jacket with a sheepskin collar, open over the pilot's chest fur. */
function chaqueta(g: G, m: ModeloAvion, c: Cuerpo, by: number) {
  const top = c.top + by, J = CHAQUETA, A = AVION[m];
  capa(g, J.ink, (q) => {
    ell(q, 48, top + 12, c.wt + 4, 13, J.k1);
    poly(q, [48 - c.wt - 4, top + 12, 48 + c.wt + 4, top + 12, 48 + c.wb, S + 2, 48 - c.wb, S + 2], J.k1);
  }, (q) => {
    // Light from the upper left: lit left shoulder, shaded right side.
    poly(q, [48 + c.wt - 6, top, S, top, S, S, 48 + c.wb - 8, S], J.k0);
    ell(q, 48 - c.wt + 2, top + 9, 8, 5, J.k2);
    R(q, 48 - c.wt - 1, top + 7, 5, 2, J.k3);
    // Seams and a pocket.
    line(q, 48 - c.wt + 2, top + 18, 48 - c.wb + 6, S, J.k0);
    line(q, 48 + c.wt - 2, top + 18, 48 + c.wb - 6, S, J.k0);
    R(q, 48 - c.wb + 8, S - 10, 9, 1, J.k0);
    R(q, 48 - c.wb + 8, S - 9, 9, 1, J.k2);
    // The open front: chest fur in a V.
    c.pecho(q, 48 - 9, top + 2, 48 + 9, S);
  });
  // Edges of the open front (zip teeth on the left side).
  for (let y = top + 8; y < S; y += 2) R(g, 48 - 7 - Math.round((y - top) * 0.09), y, 1, 1, P.metal);
  // Shoulder badge with the plane's colour and a star.
  const bx = 48 + c.wt - 3, bY = top + 17;
  capa(g, J.ink, (q) => ell(q, bx, bY, 5, 5, A.k1), (q) => {
    ell(q, bx + 1, bY + 1, 5, 5, A.k0);
    ell(q, bx - 1, bY - 1, 4, 4, A.k1);
    // A little five-point star.
    R(q, bx, bY - 3, 1, 2, P.white);
    R(q, bx - 3, bY - 1, 7, 1, P.white);
    R(q, bx - 1, bY - 1, 3, 2, P.white);
    R(q, bx - 2, bY + 1, 1, 2, P.white);
    R(q, bx + 2, bY + 1, 1, 2, P.white);
  });
  // Sheepskin collar folded down over the shoulders, and the lining along the opening.
  for (const s of [-1, 1]) line(g, 48 + s * 8, top + 6, 48 + s * 4, S, LANA.k1, 2);
  capa(g, '#9a7656', (q) => {
    for (const s of [-1, 1]) {
      const x = (v: number) => 48 + s * v;
      poly(q, [x(3), top - 3, x(c.wt + 3), top + 2, x(c.wt + 1), top + 9, x(c.wt - 7), top + 13, x(12), top + 10, x(7), top + 14, x(5), top + 4], LANA.k1);
      mechones(q, x(c.wt - 3), top + 9, 6, 4, Math.PI * 0.15, Math.PI * 0.85, 3, 2, LANA.k1);
    }
  }, (q) => {
    for (const s of [-1, 1]) line(q, 48 + s * (c.wt + 2), top + 7, 48 + s * (c.wt - 8), top + 12, LANA.k0, 2);
    line(q, 48 + c.wt + 2, top + 2, 48 + c.wt + 1, top + 9, LANA.k0, 2);
    line(q, 52, top + 3, 54, top + 10, LANA.k0, 2);
    ell(q, 48 - c.wt + 1, top + 3, 7, 3, LANA.k2);
    pelaje(q, 48, top + 6, c.wt + 2, 6, LANA.k0, 22, 7);
    pelaje(q, 48 - c.wt * 0.6, top + 4, 7, 3, LANA.k2, 8, 13);
  });
}

/** The scarf around the neck: a band, a knot and a tail that droops or flies. */
function bufanda(g: G, m: ModeloAvion, c: Cuerpo, e: Estado, side: 1 | -1) {
  const A = AVION[m], top = c.top + e.by;
  const kx = 48 + side * (c.wt * 0.35), ky = top + 6;
  // Tail: a ribbon along a wavy path.
  const L = 22 + e.vuelo * 12, ph = (e.bufanda * Math.PI) / 2;
  const ang = (1 - e.vuelo) * 1.15 + e.vuelo * -0.2; // radians below horizontal
  const dx = Math.cos(ang) * side, dy = Math.sin(ang);
  const nx = -dy, ny = dx * side;
  const up: number[] = [], dn: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, w = 6 - t * 1.5;
    const wav = Math.sin(t * 5 + ph) * (1 + t * (2 + e.vuelo * 2));
    const px = kx + dx * L * t + nx * wav * side, py = ky + dy * L * t + ny * wav;
    up.push(px + nx * w * 0.5 * side, py + ny * w * 0.5);
    dn.unshift(px - nx * w * 0.5 * side, py - ny * w * 0.5);
  }
  const ex = kx + dx * L, ey = ky + dy * L;
  capa(g, A.ink, (q) => {
    // The end is cut in a V.
    poly(q, [...up, ex - dx * 3, ey - dy * 3, ...dn], A.k1);
  }, (q) => {
    poly(q, dn.concat([ex, ey]).concat(up.slice(0, 2)), A.k0);
    for (let i = 1; i < 8; i += 3) {
      const t = i / 8;
      const px = kx + dx * L * t, py = ky + dy * L * t;
      line(q, px + nx * 4 * side, py + ny * 4, px - nx * 4 * side, py - ny * 4, A.k2);
    }
    // Two stripes near the end.
    for (const t of [0.78, 0.86]) {
      const px = kx + dx * L * t, py = ky + dy * L * t;
      line(q, px + nx * 4 * side, py + ny * 4, px - nx * 4 * side, py - ny * 4, A.k3);
    }
  });
  // Band around the neck and the knot.
  capa(g, A.ink, (q) => {
    ell(q, 48, top + 1, c.wt * 0.6, 4, A.k1);
    ell(q, kx, ky, 4, 4, A.k1);
    // The short front tail.
    poly(q, [kx - 3, ky + 1, kx + 3, ky + 1, kx + 2 + side * 2, ky + 13, kx - 2 + side * 2, ky + 14], A.k1);
  }, (q) => {
    R(q, 0, top + 3, S, 10, A.k0);
    ell(q, 48 - 4, top, c.wt * 0.5, 3, A.k1);
    R(q, 48 - c.wt * 0.4, top - 2, c.wt * 0.5, 1, A.k3);
    ell(q, kx - 1, ky - 1, 2, 2, A.k2);
    for (let x = 48 - c.wt; x < 48 + c.wt; x += 4) line(q, x, top - 3, x + 2, top + 5, A.k0);
    poly(q, [kx - 1, ky + 2, kx + 1, ky + 2, kx + 1 + side * 2, ky + 12, kx + side * 2, ky + 12], A.k2);
    R(q, kx - 3 + side * 2, ky + 10, 6, 1, A.k3);
  });
}

/** Leather cap: a dome down to `rim`, with a stitched seam and side flaps. */
function gorro(g: G, cx: number, cy: number, rx: number, ry: number, rim: number) {
  const Q = GORRO;
  capa(g, Q.ink, (q) => {
    ell(q, cx, cy, rx, ry, Q.k1);
    q.clearRect(0, rim + 1, S, S);
    ell(q, cx, rim, rx + 1, 2.5, Q.k2);
    // Ear flaps down the sides.
    for (const s of [-1, 1]) {
      const fx = cx + s * (rx - 2);
      ell(q, fx, rim + 5, 3.5, 7, Q.k1);
    }
  }, (q) => {
    ell(q, cx + 5, cy + 4, rx, ry, Q.k0);
    ell(q, cx - 2, cy - 1, rx - 2, ry - 2, Q.k1);
    ell(q, cx - rx * 0.4, cy - ry * 0.55, rx * 0.3, ry * 0.18, Q.k2);
    R(q, cx - rx * 0.45, cy - ry * 0.65, 3, 1, Q.k3);
    // Seam with stitches.
    line(q, cx, cy - ry, cx, rim - 2, Q.k0);
    for (let y = Math.round(cy - ry + 2); y < rim - 2; y += 2) R(q, cx + 1, y, 1, 1, Q.k2);
    // The rim.
    R(q, cx - rx - 2, rim - 2, rx * 2 + 4, 1, Q.k0);
    R(q, cx - rx - 2, rim - 1, rx * 2 + 4, 1, Q.k3);
    R(q, cx - rx - 2, rim, rx * 2 + 4, 1, Q.k2);
    R(q, cx - rx - 2, rim + 1, rx * 2 + 4, 1, Q.k1);
    // Flaps: shaded edge and a buckle.
    for (const s of [-1, 1]) {
      const fx = cx + s * (rx - 2);
      R(q, fx + (s > 0 ? 1 : -3), rim + 1, 2, 12, Q.k0);
      R(q, fx - 1, rim + 9, 2, 2, BRONCE.k1);
      R(q, fx - 1, rim + 9, 1, 1, BRONCE.k2);
    }
  });
}

/** Goggles: a strap and two brass-rimmed lenses. `see` keeps the eyes visible behind the glass. */
function gafas(g: G, cx: number, y: number, dx: number, r: number, strapL: number, see: boolean, glint: number) {
  capa(g, CORREA.k0, (q) => R(q, cx - strapL, y - 1, strapL * 2, 3, CORREA.k1), (q) => R(q, cx - strapL, y + 1, strapL * 2, 1, CORREA.k0));
  capa(g, BRONCE.ink, (q) => {
    for (const s of [-1, 1]) ell(q, cx + s * dx, y, r + 1.5, r + 1, BRONCE.k1);
    R(q, cx - dx + r, y - 1, (dx - r) * 2, 2, BRONCE.k1);
  }, (q) => {
    for (const s of [-1, 1]) {
      const x = cx + s * dx;
      ell(q, x + 1, y + 1, r + 1.5, r + 1, BRONCE.k0);
      ell(q, x - 0.5, y - 0.5, r + 1, r + 0.5, BRONCE.k1);
      R(q, x - r, y - r, 2, 1, BRONCE.k2);
    }
    R(q, cx - dx + r, y, (dx - r) * 2, 1, BRONCE.k0);
  });
  // Glass: drawn straight on top (no outline).
  for (const s of [-1, 1]) {
    const x = cx + s * dx;
    g.globalAlpha = see ? 0.55 : 1;
    ell(g, x, y, r - 0.5, r - 1, P.gl1);
    ell(g, x + 1, y + 1, r - 1.5, r - 2, see ? P.gl1 : P.gl0);
    ell(g, x - 1, y - 1, r - 2, r - 2.5, P.gl1);
    g.globalAlpha = 1;
    R(g, x - r + 2, y - r + 2, 2, 1, P.gl2);
    R(g, x - r + 2, y - r + 3, 1, 1, P.gl2);
    // Moving glint.
    const gx = x - 2 + glint * 2;
    line(g, gx - 1, y + 1, gx + 1, y - 1, P.white);
    R(g, x + r - 3, y + r - 3, 1, 1, P.white);
  }
}

/** A sleeve through `pts` ending in a paw. */
function brazo(g: G, pts: Pt[], pelo: { k0: string; k1: string; k2: string; ink: string }, mano: 'abierta' | 'puno' | 'pulgar' | 'saludo', k = 1) {
  const J = CHAQUETA;
  capa(g, J.ink, (q) => tubo(q, pts, 4 * k, J.k0), (q) => {
    tubo(q, pts, 4 * k - 1, J.k1, -1, -1);
    tubo(q, pts, 1, J.k2, -2, -2);
  });
  // Sheepskin cuff.
  const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1];
  const l = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / l, uy = (by - ay) / l;
  const cx = bx - ux * 3, cy = by - uy * 3;
  capa(g, '#9a7656', (q) => tubo(q, [[cx - ux * 2, cy - uy * 2], [cx, cy]], 4.5, LANA.k1), (q) => pelaje(q, cx, cy, 5, 5, LANA.k0, 10, 5));
  // The paw.
  capa(g, pelo.ink, (q) => {
    if (mano === 'pulgar') {
      ell(q, bx, by, 6 * k, 5 * k, pelo.k1);
      ell(q, bx + 1, by - 7 * k, 2.5 * k, 4 * k, pelo.k1);
    } else if (mano === 'saludo') {
      ell(q, bx, by, 5, 4, pelo.k1);
      ell(q, bx + ux * 3, by + uy * 3 - 1, 4, 3.5, pelo.k1);
    } else ell(q, bx, by, 5 * k, 4.5 * k, pelo.k1);
  }, (q) => {
    ell(q, bx + 2, by + 2, 6 * k, 5 * k, pelo.k0);
    ell(q, bx - 1, by - 2, 2.5 * k, 1.5 * k, pelo.k2);
    if (mano === 'pulgar') {
      for (const d of [-2, 0, 2]) R(q, bx - 5 * k, by + d * k, 6 * k, 1, pelo.k0);
      R(q, bx, by - 10 * k, 1, 3, pelo.k2);
    } else {
      for (const k of [-2, 1]) line(q, bx + ux * 5 + k * uy, by + uy * 5 - k * ux, bx + ux * 2 + k * uy, by + uy * 2 - k * ux, pelo.k0);
    }
  });
}

/** The big round eye shared by the cats; ^-shaped when squinting, a line when blinking. */
function ojoGato(g: G, x: number, y: number, rx: number, ry: number, iris: { k0: string; k1: string; k2: string }, ink: string, e: Estado, pupila: number, s: 1 | -1) {
  if (e.blink || e.squint) {
    for (let i = -rx; i <= rx; i++) {
      const k = i / rx;
      const yy = e.squint ? y - 1 + Math.round(k * k * 3) : y + 1 + Math.round((1 - k * k) * 1.5);
      R(g, x + i, yy, 1, 2, ink);
    }
    return;
  }
  capa(g, ink, (q) => ell(q, x, y, rx, ry, iris.k1), (q) => {
    ell(q, x, y + ry * 0.55, rx * 0.85, ry * 0.5, iris.k2);
    R(q, x - rx, y - ry, rx * 2 + 1, 2, iris.k0);
    R(q, x - rx, y - ry + 2, rx * 2 + 1, 1, iris.k0);
    const pw = e.brillo ? Math.max(pupila, rx * 0.55) : pupila;
    ell(q, x + s * 0.5, y + 0.5, pw, ry - 1, '#1a1428');
    // Catchlights (sparkle: bigger, and a star that alternates).
    R(q, x - rx * 0.5, y - ry * 0.45, e.brillo ? 3 : 2, e.brillo ? 3 : 2, P.white);
    R(q, x + rx * 0.35, y + ry * 0.3, 1, 1, P.white);
    if (e.brillo === 1) R(q, x + 1, y - 2, 1, 1, P.white);
    if (e.brillo === 2) R(q, x - 1, y + 2, 1, 1, P.white);
  });
  // A thick upper lid, longer at the outer corner.
  R(g, x - rx, y - ry - 1, rx * 2 + 1, 1, ink);
  R(g, x + s * rx, y - ry, 2 * s, 1, ink);
}

function chispas(g: G, x: number, y: number, f: number) {
  const st = (sx: number, sy: number, big: boolean) => {
    R(g, sx, sy - (big ? 2 : 1), 1, big ? 5 : 3, P.white);
    R(g, sx - (big ? 2 : 1), sy, big ? 5 : 3, 1, P.white);
  };
  if (f === 1) {
    st(x - 30, y - 14, true);
    st(x + 31, y + 4, false);
  } else {
    st(x + 29, y - 18, true);
    st(x - 32, y + 8, false);
  }
}

/* ── Dui: a fat orange tabby, cheeky ─────────────────────────────────────── */

function pintaDui(g: G, e: Estado) {
  const m: ModeloAvion = 'caza';
  const HX = 48 + e.hx, HY = 40 + e.hy, F = DUI;
  const cuerpo: Cuerpo = {
    top: 62, wt: 32, wb: 50, ink: F.ink,
    pecho: (q, x0, y0, x1, y1) => {
      poly(q, [x0 - 2, y0, x1 + 2, y0, 48 + 6, y1, 48 - 6, y1], BLANCO.k1);
      // A round belly showing at the bottom of the V.
      ell(q, 48, y1 + 2, 14, 12, BLANCO.k1);
      ell(q, 52, y1 + 4, 12, 10, BLANCO.k0);
      pelaje(q, 48, y0 + 14, 6, 10, BLANCO.k0, 12, 3);
    },
  };
  chaqueta(g, m, cuerpo, e.by);
  // The big belly, bulging out of the jacket, with a strained strap across it.
  const yb = S + 4 + e.by;
  capa(g, F.ink, (q) => ell(q, 48, yb, 22, 19, BLANCO.k1), (q) => {
    ell(q, 53, yb + 3, 22, 19, BLANCO.k0);
    ell(q, 46, yb - 2, 19, 15, BLANCO.k1);
    ell(q, 41, yb - 10, 7, 3, BLANCO.k2);
    pelaje(q, 48, yb - 6, 16, 8, BLANCO.k0, 16, 61);
    for (const [x, y] of [[-12, -12], [10, -11], [-4, -15], [4, -14]]) R(q, 48 + x, yb + y, 2, 1, '#f0c8a0');
  });
  capa(g, CHAQUETA.ink, (q) => {
    poly(q, [26, yb - 12, 70, yb - 12, 70, yb - 8, 26, yb - 8], CHAQUETA.k1);
  }, (q) => {
    R(q, 26, yb - 9, 44, 1, CHAQUETA.k0);
    R(q, 26, yb - 12, 44, 1, CHAQUETA.k2);
    ell(q, 48, yb - 10, 2.5, 2.5, BRONCE.k1);
    R(q, 47, yb - 11, 1, 1, BRONCE.k2);
  });
  for (const x of [24, 72]) line(g, x, yb - 13, x + (x < 48 ? 3 : -3), yb - 7, CHAQUETA.ink);
  bufanda(g, m, cuerpo, e, -1);
  // Head.
  capa(g, F.ink, (q) => {
    ell(q, HX, HY, 27, 20, F.k1);
    // Big round cheeks and a double chin.
    ell(q, HX - 17, HY + 9, 15, 11, F.k1);
    ell(q, HX + 17, HY + 9, 15, 11, F.k1);
    ell(q, HX, HY + 15, 17, 7, F.k1);
    ell(q, HX, HY + 20, 12, 4.5, F.k1);
    mechones(q, HX, HY + 7, 31, 13, Math.PI * 0.55, Math.PI * 1.05, 4, 4, F.k1);
    mechones(q, HX, HY + 7, 31, 13, -Math.PI * 0.05, Math.PI * 0.45, 4, 4, F.k1);
  }, (q) => {
    R(q, 0, 0, S, S, F.k0);
    ell(q, HX - 1, HY - 2, 25, 19, F.k1);
    ell(q, HX - 18, HY + 7, 14, 9, F.k1);
    ell(q, HX + 15, HY + 6, 13, 8, F.k1);
    ell(q, HX - 10, HY - 10, 10, 5, F.k2);
    ell(q, HX - 18, HY + 3, 5, 3, F.k2);
    R(q, HX - 13, HY - 13, 3, 1, F.k3);
    // Tabby stripes: the "M" on the forehead and bars on the cheeks.
    for (const [x, w] of [[-7, 3], [0, 3], [7, 3]]) poly(q, [HX + x - w / 2 - 0.5, HY - 15, HX + x + w / 2 + 0.5, HY - 15, HX + x + 0.5, HY - 5, HX + x - 0.5, HY - 5], RAYA);
    line(q, HX - 4, HY - 6, HX - 6, HY - 9, RAYA);
    line(q, HX + 4, HY - 6, HX + 6, HY - 9, RAYA);
    for (const s of [-1, 1]) {
      for (const [y, l] of [[HY + 2, 9], [HY + 7, 11], [HY + 12, 8]]) {
        poly(q, [HX + s * 33, y - 1.5, HX + s * (33 - l), y, HX + s * 33, y + 1.5], RAYA);
        line(q, HX + s * 32, y, HX + s * (34 - l * 0.6), y, RAYA0);
      }
      line(q, HX + s * 14, HY - 3, HX + s * 21, HY - 6, RAYA);
    }
    pelaje(q, HX, HY + 2, 22, 15, F.k0, 30, 21);
    pelaje(q, HX - 10, HY - 6, 10, 6, F.k2, 10, 41);
    // White muzzle and chin, with a stripe up the nose.
    poly(q, [HX - 2, HY + 1, HX + 2, HY + 1, HX + 4, HY + 8, HX - 4, HY + 8], BLANCO.k1);
    ell(q, HX - 6, HY + 11, 8, 5.5, BLANCO.k1);
    ell(q, HX + 6, HY + 11, 8, 5.5, BLANCO.k1);
    ell(q, HX, HY + 16, 9, 4, BLANCO.k1);
    ell(q, HX + 5, HY + 16, 8, 3, BLANCO.k0);
    // Double chin: a soft white roll under the first.
    ell(q, HX, HY + 21, 11, 3.5, BLANCO.k1);
    ell(q, HX + 3, HY + 22, 9, 2.5, BLANCO.k0);
    for (let i = -7; i <= 7; i++) R(q, HX + i, HY + 19 + Math.round((i * i) / 30), 1, 1, '#e0b898');
    ell(q, HX - 7, HY + 9, 3, 2, BLANCO.k2);
    for (const [x, y] of [[-8, 11], [-5, 12], [-9, 13], [8, 11], [5, 12], [9, 13]]) R(q, HX + x, HY + y, 1, 1, '#e0a880');
    // Blush.
    R(q, HX - 20, HY + 7, 5, 2, '#ff9aa0');
    R(q, HX + 15, HY + 7, 5, 2, '#ff9aa0');
  });
  // Cap, ears through it, goggles.
  gorro(g, HX, HY - 7, 25, 15, HY - 10);
  orejasGato(g, HX, HY, 22, 12, 28, F, P.p1, F.ink, e.oreja, 0);
  const gl = e.bufanda % 2;
  if (e.gafas === 0) gafas(g, HX, HY - 16, 9, 5, 25, false, gl);
  // Face.
  const eye = { k0: '#5a8a1a', k1: '#a8d040', k2: '#e4f480' };
  ojoGato(g, HX - 10, HY + 1, 5, 6, eye, F.ink, e, 1.5, -1);
  ojoGato(g, HX + 10, HY + 1, 5, 6, eye, F.ink, e, 1.5, 1);
  if (!e.blink && !e.squint && e.ceja === 'picara') {
    // Heavy half-lid on the left eye: the cheeky look.
    R(g, HX - 15, HY - 6, 11, 3, F.k1);
    R(g, HX - 15, HY - 3, 11, 1, F.ink);
    line(g, HX + 6, HY - 9, HX + 13, HY - 10, RAYA0);
  }
  if (e.ceja === 'firme') {
    line(g, HX - 15, HY - 8, HX - 7, HY - 6, F.ink);
    line(g, HX + 15, HY - 8, HX + 7, HY - 6, F.ink);
  }
  // Nose and mouth.
  poly(g, [HX - 3.5, HY + 6, HX + 3.5, HY + 6, HX, HY + 10], P.blush);
  R(g, HX - 3, HY + 6, 6, 1, '#c84a6a');
  R(g, HX - 1, HY + 7, 1, 1, '#ffc0d0');
  bocaGato(g, HX, HY + 10, e.boca, '#7a3418');
  if (e.gafas === 1) gafas(g, HX, HY - 8, 10, 6, 25, false, gl);
  if (e.gafas === 2) gafas(g, HX, HY + 1, 10, 6.5, 26, true, e.brillo);
  bigotes(g, HX, HY + 11, 13, 34, '#fff8ec');
  // Arm.
  const sh: Pt = [72, cuerpo.top + e.by + 14];
  if (e.brazo === 'alcanza') brazo(g, [sh, [84, cuerpo.top - 6], [HX + 12, HY - 15]], { ...BLANCO, ink: F.ink }, 'abierta', 1.3);
  if (e.brazo === 'baja') brazo(g, [sh, [86, cuerpo.top - 2], [HX + 14, HY - 6]], { ...BLANCO, ink: F.ink }, 'abierta', 1.3);
  if (e.brazo === 'pulgar') {
    brazo(g, [[78, S + 6], [80, 84], [72, 74]], { ...BLANCO, ink: F.ink }, 'pulgar', 1.3);
    if (e.brillo === 2) chispas(g, 48, HY + 30, 2);
  }
  if (e.brillo && e.brazo === 'nada') chispas(g, HX, HY, e.brillo);
}

function orejasGato(g: G, HX: number, HY: number, dx: number, dy: number, alto: number, F: Pelo, rosa: string, ink: string, oreja: number, abre: number) {
  capa(g, ink, (q) => {
    for (const s of [-1, 1]) {
      const tw = s > 0 && oreja === 1 ? 3 : 0, back = oreja < 0 ? 5 : 0, up = oreja > 1 ? 3 : 0;
      const bx = HX + s * dx;
      poly(q, [bx - s * 4, HY - dy + 6, bx + s * (2 + abre + back + tw), HY - alto - up + back + tw, bx - s * 10, HY - dy - 2], F.k1);
    }
  }, (q) => {
    for (const s of [-1, 1]) {
      const tw = s > 0 && oreja === 1 ? 3 : 0, back = oreja < 0 ? 5 : 0, up = oreja > 1 ? 3 : 0;
      const bx = HX + s * dx;
      if (s > 0) poly(q, [bx + 4, HY - alto, bx + 9, HY - alto, bx + 9, HY, bx + 2, HY], F.k0);
      poly(q, [bx - s * 1, HY - dy + 2, bx + s * (2 + abre + back + tw) - s * 1, HY - alto - up + back + tw + 4, bx - s * 7, HY - dy - 1], rosa);
      line(q, bx - s * 3, HY - dy, bx + s * (abre + back + tw), HY - alto - up + back + tw + 6, F.k3);
      line(q, bx - s * 5, HY - dy - 1, bx - s * 1 + s * (abre + back + tw), HY - alto - up + back + tw + 8, F.k3);
    }
  });
}

function bocaGato(g: G, x: number, y: number, b: Boca, ink: string) {
  R(g, x, y, 1, 1, ink);
  if (b === 'mueca') {
    // A wide grin with a fang.
    poly(g, [x - 7, y + 1, x + 8, y, x + 5, y + 5, x - 4, y + 5], '#6a2030');
    poly(g, [x - 5, y + 3, x + 4, y + 3, x + 3, y + 5, x - 3, y + 5], '#ff8aa8');
    R(g, x - 6, y + 1, 13, 1, P.white);
    R(g, x + 3, y + 2, 1, 1, P.white);
    R(g, x - 4, y + 2, 1, 1, P.white);
    line(g, x - 8, y, x - 7, y + 1, ink);
    line(g, x + 8, y, x + 9, y - 1, ink);
    return;
  }
  if (b === 'o') {
    ell(g, x, y + 3, 2, 2, '#6a2030');
    R(g, x - 1, y + 4, 2, 1, '#ff8aa8');
    return;
  }
  if (b === 'firme') {
    R(g, x - 3, y + 2, 7, 1, ink);
    return;
  }
  // The "w" (picara: one corner higher).
  for (const s of [-1, 1]) {
    R(g, x + s * 1, y + 1, 1, 1, ink);
    R(g, x + s * 2, y + 2, 1, 1, ink);
    R(g, x + s * 3, y + 2, 1, 1, ink);
    R(g, x + s * 4, y + 1, 1, 1, ink);
  }
  if (b === 'picara') {
    R(g, x + 5, y, 1, 1, ink);
    R(g, x + 6, y - 1, 1, 1, ink);
  }
}

function bigotes(g: G, x: number, y: number, x0: number, x1: number, c: string) {
  for (const s of [-1, 1]) {
    line(g, x + s * x0, y - 1, x + s * x1, y - 4, c);
    line(g, x + s * x0, y + 1, x + s * (x1 + 1), y + 1, c);
    line(g, x + s * x0, y + 3, x + s * x1, y + 6, c);
  }
}

/* ── Lulu: a small black cat with huge yellow eyes ───────────────────────── */

function pintaLulu(g: G, e: Estado) {
  const m: ModeloAvion = 'avioneta';
  const HX = 48 + e.hx, HY = 44 + e.hy, F = LULU;
  const cuerpo: Cuerpo = {
    top: 68, wt: 21, wb: 30, ink: F.ink,
    pecho: (q, x0, y0, x1, y1) => {
      poly(q, [x0, y0, x1, y0, 48 + 4, y1, 48 - 4, y1], F.k1);
      pelaje(q, 48, y0 + 14, 5, 10, F.k2, 10, 5);
    },
  };
  // Tail behind everything (listo).
  if (e.cola) {
    const tip: Pt = e.cola === 1 ? [84, 70] : [86, 42];
    const pts = e.cola === 3 ? curva([70, S + 4], [92, 70], [84, 40], 12).concat([[80, 36]]) : curva([70, S + 4], [92, 76], tip, 12).concat(e.cola === 2 ? [[82, 37] as Pt] : []);
    capa(g, F.ink, (q) => tubo(q, pts, 3, F.k1), (q) => {
      tubo(q, pts, 1.5, F.k2, -1, -1);
      tubo(q, pts.slice(3), 0.6, F.k3, -2, -1);
    });
  }
  chaqueta(g, m, cuerpo, e.by);
  bufanda(g, m, cuerpo, e, -1);
  capa(g, F.ink, (q) => {
    ell(q, HX, HY, 20, 17, F.k1);
    ell(q, HX, HY + 9, 15, 8, F.k1);
    mechones(q, HX, HY + 5, 20, 11, Math.PI * 0.6, Math.PI * 1.0, 3, 3, F.k1);
    mechones(q, HX, HY + 5, 20, 11, 0, Math.PI * 0.4, 3, 3, F.k1);
  }, (q) => {
    R(q, 0, 0, S, S, F.k0);
    ell(q, HX - 1, HY - 1, 19, 16, F.k1);
    ell(q, HX - 8, HY - 8, 9, 4, F.k2);
    R(q, HX - 11, HY - 11, 4, 1, F.k3);
    // Rim light on the left cheek.
    for (let y = -6; y < 10; y++) R(q, HX - 20 + Math.round((y * y) / 18), HY + y, 1, 1, F.k3);
    pelaje(q, HX, HY + 2, 17, 13, F.k2, 22, 11);
    // Muzzle, a shade lighter.
    ell(q, HX - 4, HY + 9, 5, 3.5, F.k2);
    ell(q, HX + 4, HY + 9, 5, 3.5, F.k2);
    ell(q, HX + 2, HY + 11, 6, 2, F.k1);
    // Shy blush.
    for (const s of [-1, 1]) for (let i = 0; i < 4; i += 2) R(q, HX + s * 13 - 1 + i, HY + 7, 1, 1, P.p1);
  });
  gorro(g, HX, HY - 9, 20, 12, HY - 9);
  orejasGato(g, HX, HY, 17, 10, 32, F, P.p0, F.ink, e.oreja, 1);
  const gl = e.bufanda % 2;
  gafas(g, HX, HY - 15, 8, 4.5, 20, false, gl);
  const eye = { k0: '#d88a10', k1: '#ffd23a', k2: '#fff4a0' };
  ojoGato(g, HX - 9, HY + 1, 5, 6, eye, F.ink, e, e.ceja === 'firme' ? 1.2 : 2.6, -1);
  ojoGato(g, HX + 9, HY + 1, 5, 6, eye, F.ink, e, e.ceja === 'firme' ? 1.2 : 2.6, 1);
  if (e.ceja === 'timida') {
    line(g, HX - 12, HY - 9, HX - 7, HY - 10, F.k3);
    line(g, HX + 12, HY - 9, HX + 7, HY - 10, F.k3);
  }
  if (e.ceja === 'firme' && !e.squint) {
    // A determined brow cuts the top of each eye.
    poly(g, [HX - 16, HY - 8, HX - 3, HY - 4, HX - 3, HY - 7, HX - 16, HY - 10], F.k1);
    poly(g, [HX + 16, HY - 8, HX + 3, HY - 4, HX + 3, HY - 7, HX + 16, HY - 10], F.k1);
    line(g, HX - 15, HY - 7, HX - 3, HY - 4, F.ink);
    line(g, HX + 15, HY - 7, HX + 3, HY - 4, F.ink);
  } else if (e.ceja === 'firme') {
    line(g, HX - 15, HY - 5, HX - 4, HY - 3, F.k3);
    line(g, HX + 15, HY - 5, HX + 4, HY - 3, F.k3);
  }
  poly(g, [HX - 2.5, HY + 7, HX + 2.5, HY + 7, HX, HY + 9.5], P.p1);
  R(g, HX - 1, HY + 7, 1, 1, P.p3);
  bocaGato(g, HX, HY + 9, e.boca, '#8a80a8');
  bigotes(g, HX, HY + 10, 10, 26, '#d8d0f0');
  const sh: Pt = [28, cuerpo.top + e.by + 12];
  if (e.brazo === 'saludo1') brazo(g, [sh, [14, cuerpo.top - 4], [26, HY - 4]], { ...F, ink: '#6e6890' }, 'abierta');
  if (e.brazo === 'saludo') brazo(g, [sh, [16, cuerpo.top - 8], [HX - 17, HY - 10]], { ...F, ink: '#6e6890' }, 'saludo');
  if (e.brillo && e.brazo === 'nada') chispas(g, HX, HY, e.brillo);
}

/* ── Almendrita: a tiny, proud, senior Yorkshire (brown with a black saddle) ── */

function pintaAlmendrita(g: G, e: Estado) {
  const m: ModeloAvion = 'bombardero';
  const HX = 48 + e.hx, HY = 46 + e.hy, F = TAN;
  const cuerpo: Cuerpo = {
    top: 70, wt: 20, wb: 28, ink: F.ink,
    pecho: (q, x0, y0, x1, y1) => {
      poly(q, [x0, y0, x1, y0, 48 + 4, y1, 48 - 4, y1], TAN.k1);
      pelaje(q, 48, y0 + 12, 6, 10, TAN.k2, 14, 9);
      pelaje(q, 48, y0 + 12, 6, 10, TAN.k0, 8, 19);
    },
  };
  chaqueta(g, m, cuerpo, e.by);
  bufanda(g, m, cuerpo, e, -1);
  // Long hair behind the face: brown at the top, then her black saddle over the shoulders.
  capa(g, NEGRO.k0, (q) => {
    for (const s of [-1, 1]) {
      const x = (v: number) => HX + s * v;
      poly(q, [x(9), HY - 8, x(19), HY - 6, x(23), HY + 4, x(24), HY + 14, x(23), HY + 22, x(20), HY + 19, x(18), HY + 25, x(15), HY + 20, x(12), HY + 23, x(9), HY + 16], NEGRO.k1);
    }
  }, (q) => {
    R(q, 0, HY - 10, S, 13, F.k1);
    for (let y = HY + 3; y < HY + 7; y++) for (let x = 0; x < S; x++) if ((x + y) % 2 === 0 || y === HY + 3) R(q, x, y, 1, 1, y < HY + 5 ? F.k0 : NEGRO.k2);
    for (const s of [-1, 1]) {
      const x = (v: number) => HX + s * v;
      poly(q, [x(9), HY + 7, x(14), HY + 7, x(14), HY + 26, x(9), HY + 26], NEGRO.k0);
      line(q, x(20), HY + 8, x(21), HY + 17, NEGRO.k2, 2);
      line(q, x(20), HY + 9, x(20), HY + 13, NEGRO.k3);
      line(q, x(17), HY + 13, x(18), HY + 23, NEGRO.k0);
      line(q, x(18), HY - 6, x(21), HY + 1, F.k2);
      line(q, x(16), HY - 4, x(17), HY + 2, F.k0);
    }
  });
  capa(g, F.ink, (q) => {
    ell(q, HX, HY, 17, 15, F.k1);
    mechones(q, HX, HY + 2, 17, 14, Math.PI * 0.55, Math.PI * 1.05, 4, 3, F.k1);
    mechones(q, HX, HY + 2, 17, 14, -Math.PI * 0.05, Math.PI * 0.45, 4, 3, F.k1);
    // The fluffy muzzle and a little beard, gone grey with the years.
    ell(q, HX, HY + 8, 10, 6, GRIS.k1);
    mechones(q, HX, HY + 9, 9, 6, Math.PI * 0.2, Math.PI * 0.8, 5, 4, GRIS.k1);
  }, (q) => {
    R(q, 0, 0, S, S, F.k0);
    ell(q, HX - 1, HY - 1, 16, 14, F.k1);
    ell(q, HX - 7, HY - 7, 7, 4, F.k2);
    R(q, HX - 10, HY - 10, 3, 1, F.k3);
    pelaje(q, HX, HY, 15, 12, F.k0, 6, 31);
    pelaje(q, HX - 4, HY - 4, 9, 6, F.k2, 12, 51);
    // Grey muzzle, lit from the left, with grey flecks creeping up the face.
    ell(q, HX, HY + 8, 10, 6, GRIS.k1);
    ell(q, HX + 3, HY + 12, 9, 4, GRIS.k0);
    mechones(q, HX, HY + 9, 9, 6, Math.PI * 0.2, Math.PI * 0.8, 5, 4, GRIS.k1);
    for (let i = -7; i <= 7; i += 3) line(q, HX + i, HY + 11, HX + i * 1.1, HY + 16, GRIS.k0);
    ell(q, HX - 4, HY + 5, 3, 2, GRIS.k2);
    pelaje(q, HX, HY + 3, 11, 3, GRIS.k1, 7, 71);
    R(q, HX - 13, HY + 4, 3, 2, '#ff9aa0');
    R(q, HX + 10, HY + 4, 3, 2, '#ff9aa0');
  });
  // Ears: pointy, upright, with fringes.
  const up = e.oreja > 1 ? 4 : e.oreja < 0 ? -6 : 0, out = e.oreja < 0 ? 6 : 0;
  capa(g, F.ink, (q) => {
    for (const s of [-1, 1]) {
      const tw = s > 0 && e.oreja === 1 ? 2 : 0;
      poly(q, [HX + s * 7, HY - 13, HX + s * (19 + out + tw), HY - 29 - up + tw, HX + s * 18, HY - 7], F.k1);
      mechones(q, HX + s * 18, HY - 14, 3, 6, s > 0 ? -1.2 : Math.PI - 1.2, s > 0 ? 1.4 : Math.PI + 1.4, 3, 2, F.k1);
    }
  }, (q) => {
    for (const s of [-1, 1]) {
      const tw = s > 0 && e.oreja === 1 ? 2 : 0;
      poly(q, [HX + s * 10, HY - 12, HX + s * (18 + out + tw), HY - 26 - up + tw, HX + s * 16, HY - 9], P.p1);
      line(q, HX + s * 12, HY - 12, HX + s * (17 + out + tw), HY - 22 - up + tw, F.k3);
      if (s > 0) line(q, HX + 19, HY - 12, HX + 19 + out + tw, HY - 27 - up + tw, F.k0);
      // Dark ear tips.
      const tx = HX + s * (19 + out + tw), ty = HY - 29 - up + tw;
      poly(q, [tx, ty - 2, tx + s * 3, ty + 9, tx - s * 9, ty + 7], NEGRO.k1);
      line(q, tx - s * 1, ty + 1, tx - s * 4, ty + 6, NEGRO.k3);
    }
  });
  gorro(g, HX, HY - 9, 17, 11, HY - 9);
  // Top-knot poking through the cap, with her pink bow.
  const bx = HX + 1, bY = HY - 23;
  capa(g, F.ink, (q) => {
    mechones(q, bx, bY + 2, 4, 4, -Math.PI * 0.95, -Math.PI * 0.05, 4, 3, F.k2);
    ell(q, bx, bY + 2, 4, 3, F.k2);
  }, (q) => R(q, bx, bY - 4, 5, 8, F.k1));
  capa(g, P.r0, (q) => {
    poly(q, [bx, bY, bx - 7, bY - 4, bx - 7, bY + 4], P.r2);
    poly(q, [bx, bY, bx + 7, bY - 4, bx + 7, bY + 4], P.r2);
    ell(q, bx, bY, 2, 2, P.r2);
  }, (q) => {
    R(q, bx - 7, bY + 1, 14, 4, P.r1);
    R(q, bx - 6, bY - 2, 2, 2, P.r3);
    R(q, bx + 4, bY - 2, 2, 1, P.r3);
    R(q, bx, bY - 1, 1, 1, P.r3);
  });
  gafas(g, HX, HY - 14, 7, 4, 17, false, e.bufanda % 2);
  // Eyes: dark and shiny, with fur fringe brows.
  for (const s of [-1, 1] as const) {
    const x = HX + s * 7, y = HY + 0;
    if (e.blink || e.squint) {
      for (let i = -3; i <= 3; i++) R(g, x + i, y - 1 + Math.round(((i * i) / 9) * 2), 1, 2, F.ink);
    } else {
      capa(g, F.ink, (q) => ell(q, x, y, 3.5, 4, '#2a1a18'), (q) => {
        ell(q, x + 1, y + 1, 3, 3, '#5a3a2a');
        ell(q, x - 0.5, y - 0.5, 2.5, 3, '#1a100e');
        R(q, x - 2, y - 1, e.brillo ? 3 : 2, e.brillo ? 3 : 2, P.white);
        R(q, x + 1, y + 2, 1, 1, e.brillo ? P.white : '#a07a60');
      });
      // Soft, droopy upper lids (lower at the outer corner).
      for (let i = -4; i <= 4; i++) {
        const lid = y - 4 + Math.max(0, Math.round((s * i + 1) * 0.5));
        R(g, x + i, y - 5, 1, lid - (y - 5), F.k1);
        R(g, x + i, lid, 1, 1, F.ink);
      }
      // A little bag under each eye.
      line(g, x - 2, y + 5, x + 2, y + 5, F.k0);
    }
    // Bushy grey eyebrows (lifted when she's being brave).
    const by = e.ceja === 'firme' ? -1 : 0;
    line(g, x - s * 3, y - 7 + by, x + s * 4, y - 5, GRIS.k2, 2);
    R(g, x + s * 4, y - 4, 1, 1, GRIS.k1);
  }
  // Nose and mouth.
  capa(g, '#100a14', (q) => ell(q, HX, HY + 6, 3, 2, '#2a2030'), (q) => {
    R(q, HX - 2, HY + 5, 2, 1, '#7a7090');
    R(q, HX - 1, HY + 7, 3, 1, '#18101c');
  });
  const my = HY + 10;
  if (e.boca === 'ladrido' || e.boca === 'ladrido2') {
    const h = e.boca === 'ladrido' ? 4 : 2.5;
    capa(g, F.ink, (q) => ell(q, HX, my + h * 0.6, 4, h, '#7a2a3a'), (q) => {
      ell(q, HX, my + h * 1.1, 3, h * 0.6, P.p1);
      R(q, HX - 3, my - 1, 6, 1, '#5a1a2a');
      R(q, HX - 1, my + h * 1.1, 1, 1, P.p2);
    });
    line(g, HX - 5, my - 1, HX - 3, my, F.ink);
    line(g, HX + 5, my - 1, HX + 3, my, F.ink);
  } else {
    line(g, HX, HY + 8, HX, my - 1, F.ink);
    for (const s of [-1, 1]) {
      R(g, HX + s * 1, my, 1, 1, F.ink);
      R(g, HX + s * 2, my + 1, 1, 1, F.ink);
      R(g, HX + s * 3, my, 1, 1, F.ink);
    }
  }
  const sh: Pt = [66, cuerpo.top + e.by + 12];
  if (e.brazo === 'saludo1') brazo(g, [sh, [82, cuerpo.top - 4], [70, HY - 2]], { ...F }, 'abierta');
  if (e.brazo === 'saludo') brazo(g, [sh, [80, cuerpo.top - 10], [HX + 16, HY - 10]], { ...F }, 'saludo');
  if (e.brillo && e.brazo === 'nada') chispas(g, HX, HY, e.brillo);
}

/* ── Public API ──────────────────────────────────────────────────────────── */

const PINTA: Record<ModeloAvion, (g: G, e: Estado) => void> = { caza: pintaDui, avioneta: pintaLulu, bombardero: pintaAlmendrita };
const cache = new Map<string, HTMLCanvasElement>();

/** A pilot's 96×96 portrait for the select screen (transparent background, cached). */
export function retrato(m: ModeloAvion, pose: Pose, frame: number): HTMLCanvasElement {
  const f = ((Math.floor(frame) % FRAMES[pose]) + FRAMES[pose]) % FRAMES[pose];
  const key = `${m}|${pose}|${f}`;
  let c = cache.get(key);
  if (c) return c;
  c = lienzo(S, S);
  PINTA[m](ctx(c), estado(m, pose, f));
  cache.set(key, c);
  return c;
}

/** A decorative pixel backdrop for a pilot's card: stripes, speed lines, the plane's silhouette, a riveted frame. */
export function fondoTarjeta(m: ModeloAvion, w: number, h: number): HTMLCanvasElement {
  const key = `fondo|${m}|${w}|${h}`;
  let c = cache.get(key);
  if (c) return c;
  c = lienzo(w, h);
  const g = ctx(c), A = AVION[m];
  // Diagonal stripes in two soft tints.
  R(g, 0, 0, w, h, A.k2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x + y) >> 3) % 2 === 0) R(g, x, y, 1, 1, A.k3);
  // A darker band at the bottom (where the bust sits) with a light edge.
  const bh = Math.round(h * 0.28);
  for (let y = h - bh; y < h; y++) for (let x = 0; x < w; x++) R(g, x, y, 1, 1, ((x + y) >> 3) % 2 ? A.k1 : A.k0);
  R(g, 0, h - bh - 2, w, 2, A.k3);
  R(g, 0, h - bh, w, 1, A.ink);
  // The plane, big and faded.
  const sp = planeSprite(m);
  const k = Math.max(2, Math.floor((w * 0.9) / sp.width));
  const t = lienzo(sp.width * k, sp.height * k), tq = ctx(t);
  tq.imageSmoothingEnabled = false;
  tq.drawImage(sp, 0, 0, t.width, t.height);
  tq.globalCompositeOperation = 'source-in';
  R(tq, 0, 0, t.width, t.height, A.k0);
  g.globalAlpha = 0.4;
  g.drawImage(t, Math.round((w - t.width) / 2), Math.round(h * 0.18));
  g.globalAlpha = 1;
  // Speed lines.
  for (let i = 0; i < 14; i++) {
    const y = Math.floor(hash(i * 7 + m.length) * h * 0.7) + 4, l = 8 + Math.floor(hash(i * 13 + 2) * 28);
    const x = Math.floor(hash(i * 5 + 9) * (w + l)) - l;
    R(g, x, y, l, 1, P.white);
    R(g, x + l, y, 3, 1, A.k3);
  }
  // Frame with corner brackets and rivets.
  R(g, 0, 0, w, 2, A.ink);
  R(g, 0, h - 2, w, 2, A.ink);
  R(g, 0, 0, 2, h, A.ink);
  R(g, w - 2, 0, 2, h, A.ink);
  R(g, 2, 2, w - 4, 1, A.k3);
  R(g, 2, 2, 1, h - 4, A.k3);
  for (const [cx, cy, sx, sy] of [[3, 3, 1, 1], [w - 4, 3, -1, 1], [3, h - 4, 1, -1], [w - 4, h - 4, -1, -1]]) {
    R(g, sx > 0 ? cx : cx - 9, cy, 10, 1, A.k0);
    R(g, cx, sy > 0 ? cy : cy - 9, 1, 10, A.k0);
    R(g, sx > 0 ? cx + 1 : cx - 9, sy > 0 ? cy + 1 : cy - 1, 9, 1, P.white);
    R(g, sx > 0 ? cx + 1 : cx - 1, sy > 0 ? cy + 1 : cy - 9, 1, 9, P.white);
  }
  const rivet = (x: number, y: number) => {
    R(g, x, y, 2, 2, A.k0);
    R(g, x, y, 1, 1, P.white);
  };
  for (let x = 14; x < w - 14; x += 10) {
    rivet(x, 5);
    rivet(x, h - 7);
  }
  for (let y = 14; y < h - 14; y += 10) {
    rivet(5, y);
    rivet(w - 7, y);
  }
  cache.set(key, c);
  return c;
}
