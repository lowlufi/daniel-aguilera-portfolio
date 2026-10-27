import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { R, drawBomb, drawFlare } from './dibujo';
import type { BombaTipo } from './fisica-tipos';

/*
 * Weapon visuals for the plane game: bomb loads, cluster bomblets, phosphorus
 * fire, gas clouds, the saucer's plasma orbs and lasers, chaff and decoys.
 * Screen coordinates (y grows DOWN), angles in screen radians. Sprites that
 * don't animate are painted once and cached through D.outlined; everything
 * else is a handful of rects per frame. Every function leaves g.globalAlpha
 * as it found it.
 */

type Ctx = CanvasRenderingContext2D;

/** Cheap deterministic 0..1 noise from two integers. */
function h01(a: number, b: number) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A filled pixel disc from a cache: D.disc paints row by row, too slow for big clouds every frame. */
const discos = new Map<string, HTMLCanvasElement>();
function disco(g: Ctx, x: number, y: number, r: number, c: string) {
  const k = `${r}|${c}`;
  let cv = discos.get(k);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = r * 2 + 3;
    D.disc(cv.getContext('2d')!, r + 1, r + 1, r, c);
    discos.set(k, cv);
  }
  g.drawImage(cv, x - r - 1, y - r - 1);
}

/* ── Bombs ───────────────────────────────────────────────────────────────── */

/** Sprites for the non-plain bombs, nose to +x, centred. */
const BOMB_SPRITE: Record<Exclude<BombaTipo, 'comun' | 'plasma'>, () => HTMLCanvasElement> = {
  // Fat cluster canister with yellow bands and a box tail.
  racimo: () => D.outlined('bomba|racimo', '#2e3a1e', 20, 12, 10, 6, (g) => {
    D.oval(g, 1, 0, 6, 4, '#4a5a2a');
    D.oval(g, 1, -1, 5, 3, '#6a7a3a');
    R(g, -3, -2, 6, 1, '#9aaa5a');
    R(g, -2, -4, 1, 9, P.gold);
    R(g, 3, -4, 1, 9, P.gold);
    R(g, 6, -1, 1, 2, '#2e3a1e');
    R(g, -8, -4, 3, 9, '#3a4a20');
    R(g, -7, -3, 1, 7, '#6a7a3a');
  }),
  // Slim white body with a red tip and band.
  fosforo: () => D.outlined('bomba|fosforo', '#7a6a7a', 18, 10, 9, 5, (g) => {
    D.oval(g, 0, 0, 6, 2, '#c8c8d4');
    D.oval(g, 0, -1, 5, 1, '#f4f4fa');
    D.disc(g, 5, 0, 2, P.red0);
    R(g, 5, -1, 2, 1, P.red);
    R(g, -2, -2, 1, 5, P.red);
    R(g, -8, -3, 2, 7, P.metal0);
    R(g, -7, -2, 1, 5, P.metal);
  }),
  // Green canister with a yellow-black hazard band.
  gas: () => D.outlined('bomba|gas', '#1e4a2a', 18, 12, 9, 6, (g) => {
    R(g, -5, -3, 11, 7, '#3a8a4a');
    R(g, -5, -3, 11, 2, '#6ac46a');
    R(g, -6, -2, 1, 5, '#3a8a4a');
    R(g, 6, -2, 1, 5, '#3a8a4a');
    for (let i = 0; i < 4; i++) {
      R(g, -1 + i, -3, 1, 7, i % 2 ? '#2a2a2a' : P.gold);
    }
    R(g, -8, -4, 2, 9, '#2a5a34');
    R(g, -7, -3, 1, 7, '#5aa45a');
  }),
  // Slim grey glide bomb with a seeker eye in the nose and long fins.
  guiada: () => D.outlined('bomba|guiada', '#3a3a4a', 20, 12, 10, 6, (g) => {
    D.oval(g, 0, 0, 7, 2, '#8a8a9a');
    D.oval(g, 0, -1, 6, 1, '#b4b4c4');
    D.disc(g, 6, 0, 2, '#3a3a4a');
    R(g, 6, -1, 1, 1, '#ff4a5a');
    R(g, -2, -4, 3, 2, '#6a6a7a');
    R(g, -2, 3, 3, 2, '#6a6a7a');
    R(g, -9, -3, 3, 7, '#5a5a6a');
  }),
  // A round drum, like the old bouncing mines, painted with a stripe.
  rebote: () => D.outlined('bomba|rebote', '#3a2a1a', 14, 14, 7, 7, (g) => {
    D.disc(g, 0, 0, 5, '#7a5a3a');
    D.disc(g, -1, -1, 3, '#a87a4a');
    R(g, -5, -1, 11, 2, P.gold);
    R(g, -1, -1, 2, 2, '#3a2a1a');
  }),
  // Pale-blue cryo canister with frost and a snowflake.
  crio: () => D.outlined('bomba|crio', '#2a4a7a', 18, 12, 9, 6, (g) => {
    D.oval(g, 0, 0, 6, 3, '#7ab8e8');
    D.oval(g, 0, -1, 5, 2, '#bfe8ff');
    R(g, -1, -2, 1, 5, P.white);
    R(g, -3, 0, 5, 1, P.white);
    R(g, -2, -1, 3, 3, '#e6f6ff');
    R(g, 5, -1, 2, 2, '#4a8ad8');
    R(g, -8, -3, 2, 7, '#4a6a9a');
  }),
  // Black EMP shell with a glowing cyan coil.
  emp: () => D.outlined('bomba|emp', '#1a1a2a', 18, 12, 9, 6, (g) => {
    D.oval(g, 0, 0, 6, 3, '#2a2a3a');
    D.oval(g, 0, -1, 5, 2, '#4a4a5a');
    for (let i = -3; i <= 3; i += 2) R(g, i, -3, 1, 7, '#7af0ff');
    R(g, 5, -1, 2, 2, '#ffd84a');
    R(g, -8, -3, 2, 7, '#3a3a4a');
  }),
  // Fat orange thermobaric bomb with a black band.
  termobarica: () => D.outlined('bomba|termobarica', '#5a2a1a', 20, 14, 10, 7, (g) => {
    D.oval(g, 0, 0, 7, 4, '#e86a2a');
    D.oval(g, 0, -1, 6, 3, '#ff9a4a');
    R(g, -1, -4, 2, 9, '#2a1a1a');
    R(g, 3, -2, 2, 1, '#ffe48a');
    R(g, -9, -4, 3, 9, '#7a3a1a');
  }),
};

/** A violet plasma charge, wobbling and throwing sparks. */
function plasmaBomb(g: Ctx, x: number, y: number) {
  const t = performance.now() / 1000;
  const a0 = g.globalAlpha;
  const X = Math.round(x), Y = Math.round(y);
  const p = Math.floor(t * 12) % 2;
  g.globalAlpha = a0 * 0.3;
  D.disc(g, X, Y, 6 + p, '#9a4aff');
  g.globalAlpha = a0 * 0.6;
  D.disc(g, X, Y, 4, '#b46aff');
  g.globalAlpha = a0;
  D.disc(g, X, Y, 3, '#d8a8ff');
  R(g, X - 1, Y - 1, 2, 2, P.white);
  for (let i = 0; i < 3; i++) {
    const a = t * 7 + i * 2.1;
    R(g, X + Math.round(Math.cos(a) * 6), Y + Math.round(Math.sin(a) * 5), 1, 1, i % 2 ? '#f0d8ff' : '#7ae8ff');
  }
}

/** A falling bomb of the given type, nose along `angle`. */
export function drawBombaTipo(g: Ctx, tipo: BombaTipo, x: number, y: number, angle: number): void {
  if (tipo === 'comun') {
    drawBomb(g, x, y, angle);
    return;
  }
  if (tipo === 'plasma') {
    plasmaBomb(g, x, y);
    return;
  }
  const img = BOMB_SPRITE[tipo]();
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(angle / 0.15) * 0.15);
  g.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2));
  g.restore();
}

/** A tiny cluster bomblet with a fluttering ribbon behind it. */
export function drawSubmunicion(g: Ctx, x: number, y: number, angle: number, t: number): void {
  const X = Math.round(x), Y = Math.round(y);
  const cx = Math.cos(angle), sy = Math.sin(angle);
  const f = Math.floor(t * 20 + x) % 2;
  R(g, X - Math.round(cx * 3) + f, Y - Math.round(sy * 3) - f, 1, 1, P.white);
  R(g, X - Math.round(cx * 2), Y - Math.round(sy * 2), 1, 1, P.r2);
  R(g, X - 1, Y - 1, 3, 3, '#2e3a1e');
  R(g, X - 1, Y - 1, 2, 2, '#6a7a3a');
  R(g, X + Math.round(cx), Y + Math.round(sy), 1, 1, P.gold);
}

/* ── Fire and gas on the ground ──────────────────────────────────────────── */

/**
 * White-phosphorus fire burning along the ground: white-hot core, yellow and
 * orange tongues, white smoke rising. Centred at x, w px wide, intensity k.
 */
export function drawFuego(g: Ctx, x: number, yGround: number, w: number, t: number, k: number): void {
  if (k <= 0 || w <= 0) return;
  const a0 = g.globalAlpha;
  const X0 = Math.round(x - w / 2), Y = Math.round(yGround);
  const n = Math.max(1, Math.round(w / 3));
  // White smoke wisps first, behind the flames.
  for (let i = 0; i < n; i += 2) {
    const r = h01(i, X0);
    const life = (t * 0.7 + r) % 1;
    const sx = X0 + i * 3 + Math.round(Math.sin(t * 2 + i) * 2 + life * 4);
    const sy = Y - 6 - Math.round(life * 26 * (0.6 + k * 0.4));
    g.globalAlpha = a0 * k * 0.45 * (1 - life);
    disco(g, sx, sy, 1 + Math.round(life * 3), '#f0f0f6');
  }
  // Glowing bed along the ground.
  g.globalAlpha = a0 * (0.5 + 0.4 * k);
  R(g, X0, Y - 1, n * 3, 2, '#ff9a3c');
  g.globalAlpha = a0;
  // Tongues, flickering.
  for (let i = 0; i < n; i++) {
    const r = h01(i, X0 + 7);
    const fl = 0.6 + 0.4 * Math.sin(t * 13 + i * 1.7 + r * 6);
    const hgt = Math.max(1, Math.round((3 + r * 7) * k * fl));
    const fx = X0 + i * 3;
    R(g, fx, Y - hgt - 1, 3, hgt, '#ff7a2a');
    R(g, fx, Y - Math.ceil(hgt * 0.75) - 1, 3, Math.ceil(hgt * 0.75), P.gold);
    R(g, fx + (i % 2), Y - Math.ceil(hgt * 0.45) - 1, 2, Math.ceil(hgt * 0.45), P.white);
    if (fl > 0.9) R(g, fx + 1, Y - hgt - 3, 1, 1, P.gold1);
  }
  g.globalAlpha = a0;
}

const GAS_C = ['#7ad84a', '#a8f06a', '#4aa83a'];

/** A green toxic cloud of radius r: swirling puffs, alpha follows k. */
export function drawGas(g: Ctx, x: number, y: number, r: number, t: number, k: number): void {
  if (k <= 0 || r <= 0) return;
  const a0 = g.globalAlpha;
  const X = Math.round(x), Y = Math.round(y);
  const pr = Math.max(2, Math.round(r * 0.45));
  g.globalAlpha = a0 * k * 0.3;
  disco(g, X, Y, Math.max(2, Math.round(r * 0.6)), '#3a8a3a');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + t * 0.6 * (i % 2 ? 1 : -1);
    const d = r * 0.55 * (0.7 + 0.3 * Math.sin(t * 1.3 + i));
    g.globalAlpha = a0 * k * (i % 3 === 1 ? 0.3 : 0.4);
    disco(g, X + Math.round(Math.cos(a) * d), Y + Math.round(Math.sin(a) * d * 0.7), pr, GAS_C[i % 3]);
  }
  // A few bright bubbles drifting up.
  g.globalAlpha = a0 * k * 0.7;
  for (let i = 0; i < 4; i++) {
    const life = (t * 0.5 + i * 0.25) % 1;
    R(g, X + Math.round(Math.sin(t + i * 2) * r * 0.5), Y - Math.round(life * r), 1, 1, '#d8ffb0');
  }
  g.globalAlpha = a0;
}

/* ── The saucer's weapons ────────────────────────────────────────────────── */

/** OVNI plasma-orb missile: a cyan/violet glowing ball throwing sparks. */
export function drawOrbe(g: Ctx, x: number, y: number, t: number): void {
  const a0 = g.globalAlpha;
  const X = Math.round(x), Y = Math.round(y);
  const p = Math.floor(t * 14) % 2;
  g.globalAlpha = a0 * 0.3;
  D.disc(g, X, Y, 6 + p, '#9a6aff');
  g.globalAlpha = a0 * 0.6;
  D.disc(g, X, Y, 4, '#5ae8ff');
  g.globalAlpha = a0;
  D.disc(g, X, Y, 2, '#c8fff8');
  R(g, X, Y, 1, 1, P.white);
  for (let i = 0; i < 4; i++) {
    const a = t * 8 + i * (Math.PI / 2);
    const d = 6 + ((Math.floor(t * 20) + i) % 3);
    R(g, X + Math.round(Math.cos(a) * d), Y + Math.round(Math.sin(a) * d), 1, 1, i % 2 ? '#e0b4ff' : '#5ae8ff');
  }
}

/** OVNI laser bolt: a short bright cyan streak along its velocity. */
export function drawLaser(g: Ctx, x: number, y: number, vx: number, vy: number, t: number): void {
  const a0 = g.globalAlpha;
  const v = Math.hypot(vx, vy) || 1;
  const dx = vx / v, dy = vy / v;
  const f = Math.floor(t * 30) % 2;
  for (let i = 0; i < 10; i++) {
    const px = Math.round(x - dx * i), py = Math.round(y - dy * i);
    if (i % 2 === f) {
      g.globalAlpha = a0 * 0.3;
      R(g, px - 1, py - 1, 3, 3, '#3ad8ff');
    }
    g.globalAlpha = a0;
    R(g, px, py, 1, 1, i < 3 ? P.white : i < 7 ? '#8af4ff' : '#3ad8ff');
  }
  g.globalAlpha = a0;
}

/* ── Countermeasures ─────────────────────────────────────────────────────── */

/** B-2 chaff: a small cloud of glinting silver strips. */
export function drawChaff(g: Ctx, x: number, y: number, t: number, seed: number): void {
  const X = Math.round(x), Y = Math.round(y);
  for (let i = 0; i < 12; i++) {
    const r1 = h01(seed, i), r2 = h01(i, seed + 3);
    const sx = X + Math.round((r1 - 0.5) * 14 + Math.sin(t * 3 + i) * 1.5);
    const sy = Y + Math.round((r2 - 0.5) * 10 + Math.cos(t * 2.3 + i * 1.7));
    const flat = (Math.floor(t * 10) + i) % 2 === 0;
    const glint = (Math.floor(t * 12) + i * 3) % 7 === 0;
    R(g, sx, sy, flat ? 2 : 1, flat ? 1 : 2, glint ? P.white : i % 2 ? '#b8c0d4' : '#8a92a8');
  }
}

/** A bigger orange flare trailing a long smoke column. */
function trampa(g: Ctx, x: number, y: number, t: number) {
  const a0 = g.globalAlpha;
  const X = Math.round(x), Y = Math.round(y);
  // A thin smoke thread above a small orange point.
  for (let i = 1; i <= 7; i++) {
    g.globalAlpha = a0 * 0.4 * (1 - i / 8);
    R(g, X + Math.round(Math.sin(t * 2 + i * 0.7) * i * 0.3), Y - i * 3, 1, 2, i < 3 ? '#e8d8c8' : '#c0b8c4');
  }
  g.globalAlpha = a0;
  const k = Math.floor(t * 18) % 2;
  R(g, X - 1, Y - 1, 3, 3, '#ff8a2a');
  R(g, X, Y, 1, 1, P.white);
  if (k) {
    R(g, X - 2, Y, 5, 1, '#ffc47a');
    R(g, X, Y - 2, 1, 5, '#ffc47a');
  }
}

/** A small plane silhouette in cyan for the hologram decoy, facing right. */
const holoSprite = () => D.outlined('holo|avion', '#2aa8d8', 26, 14, 13, 7, (g) => {
  for (let i = 0; i < 4; i++) R(g, -10 + Math.round(i * 0.6), -6 + i, 3, 1, '#5ae8ff');
  D.oval(g, 0, 0, 10, 2, '#5ae8ff');
  R(g, -6, -1, 12, 1, '#c8fff8');
  R(g, 10, 0, 2, 1, '#5ae8ff');
  R(g, -3, 2, 8, 1, '#8af4ff');
  R(g, -4, 3, 6, 1, '#5ae8ff');
  D.oval(g, 3, -2, 3, 1, '#c8fff8');
});

/** A flickering cyan ghost of a small plane, glitching in slices. */
function holograma(g: Ctx, x: number, y: number, t: number) {
  const a0 = g.globalAlpha;
  const img = holoSprite();
  const X = Math.round(x) - 13, Y = Math.round(y) - 7;
  const f = Math.floor(t * 20);
  g.globalAlpha = a0 * (f % 7 === 0 ? 0.15 : 0.45 + 0.2 * Math.sin(t * 9));
  // Three horizontal slices that jitter sideways now and then.
  for (let s = 0; s < 3; s++) {
    const off = (f + s * 5) % 9 === 0 ? (s % 2 ? 2 : -2) : 0;
    g.drawImage(img, 0, s * 5, 26, s === 2 ? 4 : 5, X + off, Y + s * 5, 26, s === 2 ? 4 : 5);
  }
  // Scanline sweeping down.
  g.globalAlpha = a0 * 0.5;
  R(g, X + 2, Y + (f % 14), 22, 1, '#c8fff8');
  g.globalAlpha = a0;
}

/** Decoys: magnesium flare, Russian-style trap flare, hologram, or chaff. */
export function drawBengalaTipo(g: Ctx, tipo: 'magnesio' | 'trampa' | 'holograma' | 'chaff', x: number, y: number, t: number): void {
  if (tipo === 'magnesio') drawFlare(g, x, y, t);
  else if (tipo === 'trampa') trampa(g, x, y, t);
  else if (tipo === 'holograma') holograma(g, x, y, t);
  else drawChaff(g, x, y, t, 7);
}
