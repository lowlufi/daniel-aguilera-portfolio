/*
 * «Modo GORE» (opt-in, off by default): cartoon pixel blood for the mice.
 *
 *   · gotas: blood droplets (1–2 px) that fly with gravity; on the ground they
 *     leave a stain, on the sea a little red splash and a pink tint that fades
 *   · trozos: a mouse blown apart into a few chunky pieces (head with its ear
 *     and helmet, torso, limbs, tail) that spin, bounce twice, drip blood and
 *     lie on the ground for a while before fading
 *   · manchas: blood stains on the ground, kept for a while (ring buffer)
 *   · tintes: reddish patches on the water surface
 *
 * SNES look: no anti-aliasing, flat colours, alpha in steps of 1/4.
 *
 * Performance (phones): one fixed pool in typed arrays (no objects per frame),
 * hard caps everywhere; when the pool is full, droplets are dropped and a gib
 * may recycle the oldest droplet.
 *
 * World coordinates: x right, y = altitude up (as in efectos.ts).
 */

type Ctx = CanvasRenderingContext2D;

/* ── Constants ──────────────────────────────────────────────────────────── */

const MAX_P = 220; // droplets + gibs + water drops
const MAX_MANCHAS = 160; // ground stains
const MAX_TINTES = 12; // patches on the water
const GRAV = 190; // px/s²
const VIDA_MANCHA = 22; // s
const VIDA_TROZO = 7; // s
const VIDA_TINTE = 4.5; // s

// Particle kinds.
const T_GOTA = 0, T_TROZO = 1, T_AGUA = 2;
// Gib shapes.
const CABEZA = 0, TORSO = 1, MIEMBRO = 2, COLA = 3;

// Blood: bright, mid, dark. Never brown: a cartoon red.
const ROJO = ['#ff3a4a', '#d01a34', '#8a0a24'];
const ROSA_AGUA = ['#ff8aa0', '#e85a78'];
const TINTE = '#e04a6a';

/** Colours of a mouse to tear apart: fur (head, limbs), clothes (torso), helmet. */
export type Pelaje = { piel: string; ropa: string; casco: string };
/** A foot soldier (gigantes.ts): pale fur, lilac fatigues, red helmet. */
export const SOLDADO: Pelaje = { piel: '#e0d8ec', ropa: '#b49af4', casco: '#e03a3a' };
/** A fighter or helicopter pilot (motor.ts `dibujarEyectado`). */
export const PILOTO: Pelaje = { piel: '#b8b0d0', ropa: '#9a90b8', casco: '#e03a3a' };
/** A vehicle crewman. */
export const TRIPULANTE: Pelaje = { piel: '#c8c0d8', ropa: '#8064d8', casco: '#e03a3a' };
const COLA_C = '#ffb0c4';
const OJO = '#1a1428';
const OREJA = '#c9b4ff';

export type Gore = {
  n: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  edad: Float32Array;
  vida: Float32Array;
  ang: Float32Array;
  giro: Float32Array;
  tipo: Uint8Array;
  /** Droplets: size in px (1–2) and colour index. Gibs: shape. */
  forma: Uint8Array;
  color: Uint8Array;
  rebotes: Uint8Array;
  /** Gib colour per slot (constant strings, nothing allocated). */
  tinta: string[];
  casco: string[];
  // Ground stains (ring buffer).
  mn: number;
  mi: number;
  mx: Float32Array;
  my: Float32Array;
  mw: Uint8Array;
  medad: Float32Array;
  // Water tints (ring buffer).
  tn: number;
  ti: number;
  tx: Float32Array;
  tedad: Float32Array;
};

export function crearGore(): Gore {
  return {
    n: 0,
    x: new Float32Array(MAX_P),
    y: new Float32Array(MAX_P),
    vx: new Float32Array(MAX_P),
    vy: new Float32Array(MAX_P),
    edad: new Float32Array(MAX_P),
    vida: new Float32Array(MAX_P),
    ang: new Float32Array(MAX_P),
    giro: new Float32Array(MAX_P),
    tipo: new Uint8Array(MAX_P),
    forma: new Uint8Array(MAX_P),
    color: new Uint8Array(MAX_P),
    rebotes: new Uint8Array(MAX_P),
    tinta: new Array<string>(MAX_P).fill(''),
    casco: new Array<string>(MAX_P).fill(''),
    mn: 0,
    mi: 0,
    mx: new Float32Array(MAX_MANCHAS),
    my: new Float32Array(MAX_MANCHAS),
    mw: new Uint8Array(MAX_MANCHAS),
    medad: new Float32Array(MAX_MANCHAS),
    tn: 0,
    ti: 0,
    tx: new Float32Array(MAX_TINTES),
    tedad: new Float32Array(MAX_TINTES),
  };
}

/** Empties everything (a new game, or the mode switched off). */
export function limpiar(e: Gore): void {
  e.n = 0;
  e.mn = 0;
  e.mi = 0;
  e.tn = 0;
  e.ti = 0;
}

/** True when there is nothing to update or draw. */
export function vacio(e: Gore): boolean {
  return e.n === 0 && e.mn === 0 && e.tn === 0;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A free slot, or -1. A gib (`importante`) may take over the oldest droplet. */
function slot(e: Gore, importante: boolean): number {
  if (e.n < MAX_P) return e.n++;
  if (!importante) return -1;
  let best = -1, edad = -1;
  for (let i = 0; i < e.n; i++) {
    if (e.tipo[i] !== T_TROZO && e.edad[i] > edad) {
      edad = e.edad[i];
      best = i;
    }
  }
  return best;
}

function quitar(e: Gore, i: number) {
  const j = --e.n;
  if (i === j) return;
  e.x[i] = e.x[j];
  e.y[i] = e.y[j];
  e.vx[i] = e.vx[j];
  e.vy[i] = e.vy[j];
  e.edad[i] = e.edad[j];
  e.vida[i] = e.vida[j];
  e.ang[i] = e.ang[j];
  e.giro[i] = e.giro[j];
  e.tipo[i] = e.tipo[j];
  e.forma[i] = e.forma[j];
  e.color[i] = e.color[j];
  e.rebotes[i] = e.rebotes[j];
  e.tinta[i] = e.tinta[j];
  e.casco[i] = e.casco[j];
}

function gota(e: Gore, x: number, y: number, vx: number, vy: number, tipo = T_GOTA) {
  const i = slot(e, false);
  if (i < 0) return;
  e.x[i] = x;
  e.y[i] = y;
  e.vx[i] = vx;
  e.vy[i] = vy;
  e.edad[i] = 0;
  e.vida[i] = tipo === T_AGUA ? rnd(0.35, 0.6) : rnd(1.2, 2.2);
  e.ang[i] = 0;
  e.giro[i] = 0;
  e.tipo[i] = tipo;
  e.forma[i] = Math.random() < 0.3 ? 2 : 1;
  e.color[i] = tipo === T_AGUA ? (Math.random() < 0.5 ? 0 : 1) : Math.floor(Math.random() * 2.4);
  e.rebotes[i] = 0;
}

function trozo(e: Gore, x: number, y: number, vx: number, vy: number, forma: number, tinta: string, casco: string) {
  const i = slot(e, true);
  if (i < 0) return;
  e.x[i] = x;
  e.y[i] = y;
  e.vx[i] = vx;
  e.vy[i] = vy;
  e.edad[i] = 0;
  e.vida[i] = VIDA_TROZO + rnd(-1, 1);
  e.ang[i] = rnd(0, Math.PI * 2);
  e.giro[i] = rnd(-14, 14);
  e.tipo[i] = T_TROZO;
  e.forma[i] = forma;
  e.color[i] = 0;
  e.rebotes[i] = 0;
  e.tinta[i] = tinta;
  e.casco[i] = casco;
}

/**
 * A spurt of blood at (x, y), thrown mostly along (dx, dy) (any length; 0, 0
 * sprays all round) with an upward bias. `n` droplets.
 */
export function sangre(e: Gore, x: number, y: number, dx: number, dy: number, n: number, fuerza = 1): void {
  const d = Math.hypot(dx, dy);
  const ux = d > 0 ? dx / d : 0, uy = d > 0 ? dy / d : 0;
  for (let k = 0; k < n; k++) {
    const v = rnd(30, 105) * fuerza;
    const a = Math.random() * Math.PI * 2;
    // Half along the given direction, half a round spray.
    const sx = ux * 0.65 + Math.cos(a) * 0.55, sy = uy * 0.65 + Math.sin(a) * 0.55 + 0.35;
    gota(e, x + rnd(-1, 1), y + rnd(-1, 1), sx * v, sy * v);
  }
}

/**
 * A mouse blown apart at (x, y) (its middle), moving with (vx, vy): head,
 * torso, two arms, two legs and the tail fly off, plus a burst of blood.
 */
export function despedazar(e: Gore, x: number, y: number, vx: number, vy: number, pelo: Pelaje = SOLDADO): void {
  const ex = (k: number) => vx * 0.4 + rnd(-70, 70) * k;
  const ey = (k: number) => vy * 0.4 + rnd(50, 130) * k;
  trozo(e, x, y + 3, ex(1), ey(1.1), CABEZA, pelo.piel, pelo.casco);
  trozo(e, x, y, ex(0.6), ey(0.7), TORSO, pelo.ropa, pelo.casco);
  for (let k = 0; k < 4; k++) trozo(e, x + rnd(-2, 2), y + rnd(-2, 2), ex(1.2), ey(1), MIEMBRO, k < 2 ? pelo.ropa : pelo.piel, pelo.casco);
  trozo(e, x, y - 2, ex(1), ey(0.9), COLA, COLA_C, pelo.casco);
  sangre(e, x, y, vx * 0.01, 1, 16, 1.25);
}

/**
 * A red burst in the air (a pilot under his parachute caught by fire): a
 * ring of blood all round and a few pieces falling.
 */
export function estallido(e: Gore, x: number, y: number, vx: number, vy: number, pelo: Pelaje = PILOTO): void {
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + rnd(-0.15, 0.15);
    const v = rnd(55, 95);
    gota(e, x, y, vx * 0.3 + Math.cos(a) * v, vy * 0.3 + Math.sin(a) * v);
  }
  despedazar(e, x, y, vx, vy, pelo);
}

function mancha(e: Gore, x: number, y: number, w: number) {
  const i = e.mi;
  e.mi = (e.mi + 1) % MAX_MANCHAS;
  if (e.mn < MAX_MANCHAS) e.mn++;
  e.mx[i] = Math.round(x);
  e.my[i] = Math.round(y);
  e.mw[i] = w;
  e.medad[i] = 0;
}

function tinte(e: Gore, x: number) {
  // Close to a fresh patch: freshen it instead of piling up another.
  for (let k = 0; k < e.tn; k++) {
    if (Math.abs(e.tx[k] - x) < 8 && e.tedad[k] < 1.5) {
      e.tedad[k] = Math.min(e.tedad[k], 0.3);
      return;
    }
  }
  const i = e.ti;
  e.ti = (e.ti + 1) % MAX_TINTES;
  if (e.tn < MAX_TINTES) e.tn++;
  e.tx[i] = x;
  e.tedad[i] = 0;
}

/** A red splash where something bloody hits the sea. */
function salpicaRojo(e: Gore, x: number, nivel: number, n: number) {
  for (let k = 0; k < n; k++) gota(e, x + rnd(-2, 2), nivel + 1, rnd(-30, 30), rnd(40, 90), T_AGUA);
  tinte(e, x);
}

/**
 * Moves everything. `suelo(x)` is the ground altitude; over open sea
 * (`esMar(x)`) the surface is at `nivelMar`.
 */
export function actualizar(e: Gore, dt: number, suelo: (x: number) => number, esMar: (x: number) => boolean, nivelMar: number): void {
  for (let i = e.mn - 1; i >= 0; i--) e.medad[i] += dt;
  // Ring buffers: an expired entry is just hidden by the draw (age past its life).
  for (let i = 0; i < e.tn; i++) e.tedad[i] += dt;
  const n0 = e.n;
  for (let i = n0 - 1; i >= 0; i--) {
    if (i >= e.n) continue;
    e.edad[i] += dt;
    if (e.edad[i] >= e.vida[i]) {
      quitar(e, i);
      continue;
    }
    const t = e.tipo[i];
    const quieto = t === T_TROZO && e.rebotes[i] >= 3;
    if (quieto) continue;
    e.vy[i] -= GRAV * dt;
    const arr = 1 - Math.min(1, dt * (t === T_TROZO ? 0.3 : 0.8));
    e.vx[i] *= arr;
    e.x[i] += e.vx[i] * dt;
    e.y[i] += e.vy[i] * dt;
    const x = e.x[i];
    const mar = esMar(x);
    const piso = mar ? nivelMar : suelo(x);
    if (t === T_AGUA) {
      if (e.y[i] < nivelMar && e.vy[i] < 0) quitar(e, i);
      continue;
    }
    if (t === T_TROZO) {
      e.ang[i] += e.giro[i] * dt;
      // Fresh pieces drip as they fly.
      if (e.edad[i] < 1.2 && Math.random() < dt * 10) gota(e, x, e.y[i], e.vx[i] * 0.2, e.vy[i] * 0.2);
    }
    if (e.y[i] > piso) continue;
    if (mar) {
      // Into the sea: it sinks, leaving a red splash.
      salpicaRojo(e, x, nivelMar, t === T_TROZO ? 3 : 1);
      quitar(e, i);
      continue;
    }
    if (t === T_GOTA) {
      if (Math.random() < 0.7) mancha(e, x, piso, e.forma[i] + (Math.random() < 0.4 ? 1 : 0));
      quitar(e, i);
      continue;
    }
    // A gib: bounces twice, smearing the ground, then lies still.
    e.y[i] = piso;
    if (e.rebotes[i] === 0) mancha(e, x, piso, 3);
    if (e.rebotes[i] < 2 && e.vy[i] < -25) {
      e.vy[i] = -e.vy[i] * 0.38;
      e.vx[i] *= 0.55;
      e.giro[i] *= 0.5;
      e.rebotes[i]++;
    } else {
      e.vx[i] = e.vy[i] = e.giro[i] = 0;
      e.ang[i] = Math.round(e.ang[i] / (Math.PI / 2)) * (Math.PI / 2);
      e.rebotes[i] = 3;
    }
  }
}

const alfa = (k: number) => Math.max(0, Math.min(1, Math.ceil(k * 4) / 4));

/**
 * Ground stains and water tints: draw them over the ground, under the units.
 * `sx`, `sy`: world → screen. `vw`: screen width (off-screen stains are skipped).
 */
export function dibujarSuelo(g: Ctx, e: Gore, sx: (x: number) => number, sy: (y: number) => number, vw: number, nivelMar: number): void {
  if (e.mn === 0 && e.tn === 0) return;
  let a = 1;
  for (let i = 0; i < e.mn; i++) {
    const ed = e.medad[i];
    if (ed >= VIDA_MANCHA) continue;
    const X = sx(e.mx[i]);
    if (X < -4 || X > vw + 4) continue;
    const k = alfa(Math.min(1, (VIDA_MANCHA - ed) / 5) * 0.75);
    if (k <= 0) continue;
    if (k !== a) g.globalAlpha = a = k;
    const Y = sy(e.my[i]);
    const w = e.mw[i];
    g.fillStyle = ROJO[1];
    g.fillRect(X - (w >> 1), Y - 1, w, 1);
    g.fillStyle = ROJO[2];
    g.fillRect(X - (w >> 1), Y, w + 1, 1);
  }
  const Ym = sy(nivelMar);
  for (let i = 0; i < e.tn; i++) {
    const ed = e.tedad[i];
    if (ed >= VIDA_TINTE) continue;
    const X = sx(e.tx[i]);
    if (X < -20 || X > vw + 20) continue;
    const k = alfa((1 - ed / VIDA_TINTE) * 0.5);
    if (k <= 0) continue;
    if (k !== a) g.globalAlpha = a = k;
    // A flat patch that spreads out on the surface.
    const w = Math.round(6 + ed * 3);
    g.fillStyle = TINTE;
    g.fillRect(X - w, Ym, w * 2, 1);
    g.fillRect(X - (w >> 1), Ym + 1, w, 1);
  }
  g.globalAlpha = 1;
}

/** Droplets and gibs: draw them with the other effects. */
export function dibujar(g: Ctx, e: Gore, sx: (x: number) => number, sy: (y: number) => number): void {
  if (e.n === 0) return;
  let a = 1;
  for (let i = 0; i < e.n; i++) {
    const t = e.tipo[i];
    const X = sx(e.x[i]), Y = sy(e.y[i]);
    if (t !== T_TROZO) {
      const s = e.forma[i];
      if (a !== 1) g.globalAlpha = a = 1;
      g.fillStyle = t === T_AGUA ? ROSA_AGUA[e.color[i]] : ROJO[e.color[i]];
      g.fillRect(X, Y - s + 1, s, s);
      continue;
    }
    const rest = e.vida[i] - e.edad[i];
    const k = rest < 1.5 ? alfa(rest / 1.5) : 1;
    if (k !== a) g.globalAlpha = a = k;
    // Four orientations only: pixel art doesn't rotate smoothly.
    const q = ((Math.round(e.ang[i] / (Math.PI / 2)) % 4) + 4) % 4;
    const c = e.tinta[i];
    switch (e.forma[i]) {
      case CABEZA: {
        // A 3×3 head with an ear, an eye, a helmet strip and a bloody neck.
        g.fillStyle = c;
        g.fillRect(X - 1, Y - 1, 3, 3);
        const ox = q === 0 || q === 3 ? -1 : 1, oy = q < 2 ? -1 : 1;
        g.fillStyle = OREJA;
        g.fillRect(X + ox * 2, Y + oy * 2, 1, 1);
        g.fillStyle = e.casco[i];
        if (q % 2 === 0) g.fillRect(X - 1, Y + oy, 3, 1);
        else g.fillRect(X + ox, Y - 1, 1, 3);
        g.fillStyle = OJO;
        g.fillRect(X - ox, Y, 1, 1);
        g.fillStyle = ROJO[1];
        g.fillRect(X - ox, Y - oy * 2, 1, 1);
        break;
      }
      case TORSO: {
        const w = q % 2 ? 4 : 3, h = q % 2 ? 3 : 4;
        g.fillStyle = c;
        g.fillRect(X - 1, Y - 1, w, h);
        g.fillStyle = ROJO[1];
        if (q % 2) g.fillRect(q === 1 ? X - 1 : X + w - 2, Y - 1, 1, h);
        else g.fillRect(X - 1, q === 0 ? Y - 1 : Y + h - 2, w, 1);
        break;
      }
      case MIEMBRO: {
        g.fillStyle = c;
        if (q % 2) g.fillRect(X - 1, Y, 3, 1);
        else g.fillRect(X, Y - 1, 1, 3);
        g.fillStyle = ROJO[0];
        if (q % 2) g.fillRect(q === 1 ? X - 1 : X + 1, Y, 1, 1);
        else g.fillRect(X, q === 0 ? Y - 1 : Y + 1, 1, 1);
        break;
      }
      default: {
        // The tail: a thin pink squiggle.
        g.fillStyle = c;
        if (q % 2) {
          g.fillRect(X - 1, Y, 2, 1);
          g.fillRect(X + 1, Y - 1, 1, 1);
        } else {
          g.fillRect(X, Y - 1, 1, 2);
          g.fillRect(X + 1, Y + 1, 1, 1);
        }
      }
    }
  }
  g.globalAlpha = 1;
}
