import * as L from './luces';
import { DIRT } from './dibujo';
import { NIVEL_MAR } from './oceano';

/*
 * Everything that happens where something meets the sea: bullet spouts and
 * ricochet skips, missile columns with their crowns, bomb domes and towering
 * columns with shock rings and drifting spray, the nuke's base surge, duds
 * that sink (and some bombs that go off down there a moment later), bubbles,
 * foam that lingers, wrecks, oil and fire on the water, wakes and fish.
 *
 * Pixel art, no anti-aliasing. Two fixed pools (events and bubbles) in typed
 * arrays: nothing is allocated per frame, offscreen events are skipped when
 * drawing, and spawns thin out as the pools fill (LOD for phones).
 *
 * Positions: world x; `y` is px relative to the sea surface, positive DOWN
 * (depth) for things under the water, negative up. Draw with the surface's
 * screen row `ys`, so everything rides the same line the waves use.
 */

type Ctx = CanvasRenderingContext2D;
export type Hora = 'dia' | 'tarde' | 'noche';

/* ── Palettes per hour: day, dusk, night (the front layer grades them on top) ── */

const HI = (a: Hora) => (a === 'dia' ? 0 : a === 'tarde' ? 1 : 2);
const ESPUMA = ['#ffffff', '#fff4ea', '#d4dcf4'];
const ESPUMA2 = ['#d4f4fc', '#f4dcd4', '#9aa8d4'];
const TINTA = ['#3a7ab8', '#6a5a98', '#2a3270'];
const AGUA_C = ['#a4ecf4', '#f0c4b4', '#6a7ab4'];
const BURBUJA = ['#eafcff', '#fff0e0', '#b4c4ec'];
const BRUMA = ['#f4fcff', '#ffe8dc', '#b8c0e0'];
const LLAMA = ['#fff4a0', '#ffb43a', '#ff5a2a'];
const IRIS = ['#c87ae0', '#5ad8c8', '#e8d85a', '#7a9aff'];
const ACEITE = '#24202e';
const MADERA = ['#8a5a3a', '#5a3a2a'];
const FONDO = NIVEL_MAR + DIRT - 8; // px of water down to where things settle on the sand

/* ── Events pool ── */

const enum T {
  Chorro = 1, // bullet spout: a = height, b = width
  Anillo, // flat foam ring: a = r0, b = r1, c = 1 shock ring
  Columna, // tall column with crown: a = height, b = width, c = 1 hot
  Domo, // white dome heaving up: a = radius
  Espuma, // lingering foam patch: a = half width
  Bruma, // spray mist drifting with the wind: a = size
  Vapor, // steam rising off hot metal: a = size
  Aceite, // oil slick: a = half width
  Fuego, // little fire on the water: a = size
  Oleada, // the nuke's base surge: a = reach
  Pez, // fish jump: a = direction
  Tabla, // floating debris: b = length, c = colour index
  Hundido, // sinking dud: c = 0 missile, 1 bomb, 2 round; b = length; f = fuse (s, 0 = none)
  Rebote, // the round skipping: a = dx to the next touch
  Destello, // underwater flash: a = radius
  Fondo, // a puff of sand on the seabed: a = size
}

const N = 176;
const NB = 220;

export type Mar = {
  /** @internal */ n: number;
  /** @internal */ tipo: Uint8Array;
  /** @internal */ x: Float32Array;
  /** @internal */ y: Float32Array;
  /** @internal */ vx: Float32Array;
  /** @internal */ vy: Float32Array;
  /** @internal */ t: Float32Array;
  /** @internal */ vida: Float32Array;
  /** @internal */ a: Float32Array;
  /** @internal */ b: Float32Array;
  /** @internal */ c: Float32Array;
  /** @internal */ ang: Float32Array;
  /** @internal */ giro: Float32Array;
  /** @internal */ f: Float32Array;
  /** @internal */ sem: Uint32Array;
  /** @internal */ col: string[];
  // Bubbles: x, depth, rise speed, age (negative = not yet), life, size.
  /** @internal */ nb: number;
  /** @internal */ bx: Float32Array;
  /** @internal */ by: Float32Array;
  /** @internal */ bv: Float32Array;
  /** @internal */ bt: Float32Array;
  /** @internal */ bvida: Float32Array;
  /** @internal */ br: Uint8Array;
  /** @internal */ ambT: number;
  /** @internal */ washT: number;
  /** Duds with a delayed fuse go off: world x, depth, kind (1 = bomb). */
  alDetonar: ((x: number, prof: number, tipo: number) => void) | null;
};

export function crearMar(): Mar {
  return {
    n: 0, tipo: new Uint8Array(N), x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N),
    t: new Float32Array(N), vida: new Float32Array(N), a: new Float32Array(N), b: new Float32Array(N), c: new Float32Array(N),
    ang: new Float32Array(N), giro: new Float32Array(N), f: new Float32Array(N), sem: new Uint32Array(N), col: new Array<string>(N).fill(''),
    nb: 0, bx: new Float32Array(NB), by: new Float32Array(NB), bv: new Float32Array(NB), bt: new Float32Array(NB), bvida: new Float32Array(NB), br: new Uint8Array(NB),
    ambT: 3, washT: 0, alDetonar: null,
  };
}

export function limpiarMar(m: Mar): void {
  m.n = 0;
  m.nb = 0;
}

let semilla = 0x9e3779b9;
const azar = () => {
  semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
  return semilla / 4294967296;
};
const entre = (a: number, b: number) => a + (b - a) * azar();
const hash = (a: number, b: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/** How full the pools are, 0…1: spawns thin out past half (phones, big fights). */
const carga = (m: Mar) => Math.max(m.n / N, m.nb / NB);
/** Optional details are skipped when the pool is busy. */
const sobra = (m: Mar, prio: number) => carga(m) < 0.5 || azar() < prio * (1 - carga(m)) * 2;

function nuevo(m: Mar, tipo: T, x: number, y: number, vida: number, a = 0, b = 0, c = 0, retraso = 0): number {
  if (m.n >= N) {
    // Full: reuse the oldest cosmetic one (never a sinking dud with a fuse).
    let peor = -1, pu = -1;
    for (let k = 0; k < N; k++) {
      if (m.tipo[k] === T.Hundido && m.f[k] > 0) continue;
      const u = m.t[k] / m.vida[k];
      if (u > pu) {
        pu = u;
        peor = k;
      }
    }
    if (peor < 0) return -1;
    m.n--;
    copiar(m, m.n, peor);
  }
  const i = m.n++;
  m.tipo[i] = tipo;
  m.x[i] = x;
  m.y[i] = y;
  m.vx[i] = 0;
  m.vy[i] = 0;
  m.t[i] = -retraso;
  m.vida[i] = Math.max(0.05, vida);
  m.a[i] = a;
  m.b[i] = b;
  m.c[i] = c;
  m.ang[i] = 0;
  m.giro[i] = 0;
  m.f[i] = 0;
  m.sem[i] = (azar() * 4294967295) >>> 0;
  m.col[i] = '';
  return i;
}
function copiar(m: Mar, de: number, a: number) {
  m.tipo[a] = m.tipo[de];
  m.x[a] = m.x[de];
  m.y[a] = m.y[de];
  m.vx[a] = m.vx[de];
  m.vy[a] = m.vy[de];
  m.t[a] = m.t[de];
  m.vida[a] = m.vida[de];
  m.a[a] = m.a[de];
  m.b[a] = m.b[de];
  m.c[a] = m.c[de];
  m.ang[a] = m.ang[de];
  m.giro[a] = m.giro[de];
  m.f[a] = m.f[de];
  m.sem[a] = m.sem[de];
  m.col[a] = m.col[de];
}

function burbuja(m: Mar, x: number, prof: number, sube: number, vida: number, r: number, retraso = 0) {
  if (m.nb >= NB) return;
  const i = m.nb++;
  m.bx[i] = x;
  m.by[i] = Math.min(FONDO, prof);
  m.bv[i] = sube;
  m.bt[i] = -retraso;
  m.bvida[i] = vida;
  m.br[i] = r;
}
/** A string of bubbles from (x, prof), rising. */
function rastro(m: Mar, x: number, prof: number, n: number, ancho: number) {
  for (let k = 0; k < n; k++) burbuja(m, x + entre(-ancho, ancho), prof + entre(-2, 2), entre(10, 22), entre(1, 2.2), azar() < 0.25 ? 2 : 1, k * 0.08);
}

/* ── Spawns ── */

/**
 * A gun round into the sea. `calibre` is the tracer's hit size (0.6 rifle …
 * 1.2 a .50 … 2 a 20/30 mm shell); (vx, vy) its velocity; `cortina` for the
 * GAU-8 (each shell throws a fat spout: in a burst they stand up as a curtain).
 * A shallow round may skip once or twice before it goes in; every one leaves a
 * short streak of bubbles sinking from where it entered.
 */
export function bala(m: Mar, x: number, vx: number, vy: number, calibre: number, laser = false, cortina = false): void {
  const cal = Math.max(0.4, Math.min(2.4, calibre));
  const v = Math.hypot(vx, vy) || 1;
  const dir = vx >= 0 ? 1 : -1;
  const rasante = Math.abs(vy) / v < 0.32;
  if (laser) {
    // A laser just boils a pinch of water: a hiss of steam and a ring.
    nuevo(m, T.Vapor, x, 0, 0.9, 2);
    nuevo(m, T.Anillo, x, 0, 0.4, 1, 5);
    return;
  }
  // Ricochet: a shallow round skims off, touching down again further on.
  if (rasante && cal < 2 && azar() < 0.6) {
    const dx = dir * entre(10, 22) * (0.7 + cal * 0.3);
    nuevo(m, T.Chorro, x, 0, 0.28, 2 + cal * 2, 1);
    const r = nuevo(m, T.Rebote, x, 0, 0.12, dx);
    if (r >= 0) m.b[r] = Math.min(10, 3 + cal * 3);
    if (azar() < 0.4 && sobra(m, 0.5)) {
      // A second, weaker skip.
      nuevo(m, T.Chorro, x + dx, 0, 0.24, 1 + cal * 1.5, 1, 0, 0.1);
      nuevo(m, T.Rebote, x + dx, 0, 0.1, dx * 0.6, 0, 0, 0.1);
      x += dx * 1.6;
    } else x += dx;
    nuevo(m, T.Chorro, x, 0, 0.32, 2 + cal * 3, 1, 0, 0.12);
    if (sobra(m, 0.4)) nuevo(m, T.Anillo, x, 0, 0.5, 1, 4 + cal * 2, 0, 0.12);
  } else {
    // A spout sized by the calibre: a rifle round's flick … a cannon shell's burst with a crown.
    const h = cortina ? entre(18, 28) : cal < 0.9 ? entre(4, 8) : cal < 1.6 ? entre(9, 14) : entre(15, 22);
    const w = cortina ? 3 : cal < 0.9 ? 1 : cal < 1.6 ? 1 : 2;
    nuevo(m, T.Chorro, x, 0, 0.3 + cal * 0.12, h, w, cal >= 1.6 ? 1 : 0);
    if (sobra(m, 0.6)) nuevo(m, T.Anillo, x, 0, 0.45 + cal * 0.15, 1, 3 + cal * 3);
    if (cortina && sobra(m, 0.3)) nuevo(m, T.Bruma, x, -6, 1.6, 4);
  }
  // The round itself sinks a little way, a bubble streak behind it.
  if (sobra(m, 0.7)) {
    const k = nuevo(m, T.Hundido, x, 1, 0.55, 0, 1 + (cal > 1.5 ? 1 : 0), 2);
    if (k >= 0) {
      m.vx[k] = dir * Math.min(60, Math.abs(vx) * 0.08);
      m.vy[k] = 40 + cal * 10;
      m.ang[k] = Math.atan2(-Math.abs(vy) - 40, vx * 0.3);
    }
    const nb = cal < 1 ? 2 : cal < 1.6 ? 3 : 5;
    for (let j = 0; j < nb; j++) burbuja(m, x + dir * j * 1.5, 2 + j * 2.4, entre(8, 16), entre(0.6, 1.2), 1, j * 0.05);
  }
}

/**
 * A blast at or just below the sea: a missile's tall white column with a
 * crown, falling droplets, a foam ring and steam if it was hot; a bomb's dome
 * heaving up first, then a towering column, a shock ring, spray drifting on
 * the wind, foam that lingers and bubbles. `alt` is the blast's height over
 * the surface (negative = under it: always starts with a dome).
 */
export function explosion(m: Mar, x: number, alt: number, energia: number, bomba: boolean, caliente: boolean): void {
  const e = Math.max(0.3, energia);
  const w = Math.cbrt(e);
  const bajo = alt < -1 || (!bomba && e >= 2 && e < 8 && azar() < 0.3);
  if (e < 1.5) {
    // Flak, small rockets: a stout spout and a ring.
    nuevo(m, T.Columna, x, 0, 0.8, 16 + 6 * w, 2, caliente ? 1 : 0);
    nuevo(m, T.Anillo, x, 0, 0.9, 3, 12 + 4 * w);
    rastro(m, x, 6, 3, 3);
    return;
  }
  const grande = bomba || e >= 8;
  const H = Math.min(150, grande ? 54 + 18 * w : 30 + 10 * w);
  const W = Math.min(9, grande ? 3 + w : 2 + w * 0.5);
  const retraso = bajo || grande ? 0.16 : 0;
  if (bajo || grande) {
    nuevo(m, T.Domo, x, 0, 0.42, Math.min(30, (grande ? 8 : 5) + 3 * w));
    nuevo(m, T.Destello, x, Math.max(3, -alt), 0.3, Math.min(26, 6 + 4 * w));
  }
  nuevo(m, T.Columna, x, 0, grande ? 2.4 : 1.5, H, W, caliente ? 1 : 0, retraso);
  nuevo(m, T.Anillo, x, 0, grande ? 2.2 : 1.4, 4, Math.min(70, (grande ? 30 : 16) + 6 * w), 0, retraso);
  if (grande) {
    // The shock ring races out over the surface ahead of everything else.
    nuevo(m, T.Anillo, x, 0, 0.5, 6, Math.min(140, 50 + 14 * w), 1);
    for (let k = 0; k < (sobra(m, 0.6) ? 4 : 2); k++) nuevo(m, T.Bruma, x + entre(-W * 3, W * 3), -entre(H * 0.3, H * 0.7), entre(2.6, 3.6), 8 + w * 2, 0, 0, 0.5 + k * 0.15);
    nuevo(m, T.Espuma, x, 0, entre(7, 10), Math.min(60, 18 + 5 * w));
    rastro(m, x, FONDO * 0.7, 10, W * 2);
  } else {
    nuevo(m, T.Espuma, x, 0, entre(4, 6), Math.min(30, 9 + 3 * w));
    if (sobra(m, 0.6)) nuevo(m, T.Bruma, x, -H * 0.5, 2.2, 5 + w, 0, 0, 0.4);
    rastro(m, x, 12, 5, 4);
  }
  if (caliente && sobra(m, 0.7)) for (let k = 0; k < 2; k++) nuevo(m, T.Vapor, x + entre(-4, 4), 0, 1.6, 3 + w, 0, 0, 0.3 + k * 0.2);
}

/** The nuke over the sea: a colossal column and a base surge rolling out both ways. */
export function nuclear(m: Mar, x: number): void {
  nuevo(m, T.Domo, x, 0, 0.7, 40);
  nuevo(m, T.Destello, x, 10, 0.6, 30);
  nuevo(m, T.Columna, x, 0, 4.2, 230, 16, 1, 0.3);
  nuevo(m, T.Columna, x - 26, 0, 3.4, 120, 7, 0, 0.45);
  nuevo(m, T.Columna, x + 26, 0, 3.4, 130, 7, 0, 0.5);
  nuevo(m, T.Anillo, x, 0, 0.9, 10, 260, 1);
  nuevo(m, T.Anillo, x, 0, 3.5, 20, 200);
  nuevo(m, T.Oleada, x, 0, 4.5, 240, 0, 0, 0.5);
  nuevo(m, T.Espuma, x, 0, 14, 120);
  for (let k = 0; k < 6; k++) nuevo(m, T.Bruma, x + entre(-60, 60), -entre(30, 110), entre(3.5, 5), 18, 0, 0, 0.8 + k * 0.2);
  rastro(m, x, FONDO * 0.8, 24, 40);
}

/**
 * Something that hits the water and doesn't go off: it plunges, tumbles down
 * through the water column getting bluer, trailing bubbles, and rests on the
 * sand. `tipo` 0 = a missile, 1 = a bomb; `mecha` > 0 = it goes off down there
 * after that many seconds (calls `alDetonar`). (vx, vy): its velocity.
 */
export function hundir(m: Mar, x: number, vx: number, vy: number, tipo: 0 | 1, largo: number, color: string, mecha = 0): void {
  nuevo(m, T.Columna, x, 0, 0.9, tipo ? 26 : 20, tipo ? 3 : 2, 0);
  nuevo(m, T.Anillo, x, 0, 1.2, 3, tipo ? 20 : 14);
  nuevo(m, T.Espuma, x, 0, 3.5, tipo ? 12 : 8);
  const k = nuevo(m, T.Hundido, x, 2, mecha > 0 ? mecha + 0.5 : 6, 0, largo, tipo);
  if (k < 0) return;
  m.vx[k] = Math.max(-70, Math.min(70, vx * 0.25));
  m.vy[k] = Math.min(70, 30 + Math.abs(vy) * 0.15);
  m.ang[k] = vy < -1 ? Math.atan2(-vy, vx) : vx < 0 ? Math.PI - 0.6 : 0.6; // screen angle, nose down
  m.giro[k] = tipo ? entre(-1.6, 1.6) : entre(-0.4, 0.4);
  m.f[k] = mecha;
  m.col[k] = color;
  rastro(m, x, 4, 4, 2);
}

/** A boat sunk at sea: planks floating a while, an oil slick, small fires on it. */
export function naufragio(m: Mar, x: number, ancho: number, color: string, grande = false): void {
  nuevo(m, T.Aceite, x, 0, grande ? 22 : 14, ancho * 0.6);
  const nf = grande ? 4 : 2;
  for (let k = 0; k < nf; k++) nuevo(m, T.Fuego, x + entre(-ancho * 0.5, ancho * 0.5), 0, entre(5, 9) * (grande ? 1.4 : 1), entre(2, 4), 0, 0, k * 0.4);
  const nt = grande ? 7 : 4;
  for (let k = 0; k < nt; k++) {
    const i = nuevo(m, T.Tabla, x + entre(-ancho * 0.6, ancho * 0.6), 0, entre(6, 11), 0, Math.round(entre(3, 8)), k % 3 === 0 ? 2 : k % 2);
    if (i >= 0) {
      m.vx[i] = entre(-8, 8);
      m.col[i] = color;
    }
  }
  nuevo(m, T.Espuma, x, 0, 8, ancho * 0.7);
  rastro(m, x, 8, 8, ancho * 0.4);
}

/**
 * The plane skimming low (call each step it's down there, `k` 0 high … 1 on
 * the water): a foam wake laid behind and ripples from the prop or jet wash.
 */
export function rasante(m: Mar, x: number, vx: number, k: number, dt: number): void {
  m.washT -= dt;
  if (m.washT > 0) return;
  m.washT = 0.07 - 0.03 * k;
  const tras = x - Math.sign(vx || 1) * 10;
  nuevo(m, T.Espuma, tras, 0, 1.4 + 2.2 * k, 3 + 6 * k);
  if (sobra(m, 0.6)) nuevo(m, T.Anillo, x + entre(-6, 6), 0, 0.7, 2, 8 + 10 * k);
  if (k > 0.7 && sobra(m, 0.4)) nuevo(m, T.Bruma, tras, -3, 1.1, 3 + 3 * k);
}

/** A pilot, a crate or a pellet dropping in: a small plop with a ring. */
export function plop(m: Mar, x: number, fuerza: number): void {
  nuevo(m, T.Columna, x, 0, 0.6, 8 + 10 * fuerza, fuerza > 1 ? 2 : 1, 0);
  nuevo(m, T.Anillo, x, 0, 0.9, 2, 8 + 8 * fuerza);
  rastro(m, x, 5, 2 + Math.round(fuerza * 2), 2);
}

/* ── Step ── */

/**
 * Ages everything. `viento` drifts the spray; `luces` gets the fires' glow (it
 * mirrors on the water); (x0, x1) is the visible world range, where the sea's
 * life happens (fish, rain); `orilla` is where open water starts; `lluvia` 0…1.
 */
export function actualizar(m: Mar, dt: number, viento: number, luces: L.Luces | null, x0: number, x1: number, orilla: number, lluvia: number, vivo: boolean): void {
  for (let i = 0; i < m.n; ) {
    m.t[i] += dt;
    const t = m.t[i];
    const tp = m.tipo[i];
    if (t > 0) {
      if (tp === T.Bruma || tp === T.Vapor) {
        m.x[i] += viento * (tp === T.Bruma ? 0.7 : 0.4) * dt;
        m.y[i] -= (tp === T.Vapor ? 14 : 4) * dt;
      } else if (tp === T.Tabla) {
        m.x[i] += (m.vx[i] + viento * 0.15) * dt;
        m.vx[i] *= 1 - Math.min(1, dt * 0.4);
        if (t > m.vida[i] * 0.7) m.y[i] += 6 * dt;
      } else if (tp === T.Fuego) {
        m.x[i] += viento * 0.05 * dt;
        if (luces && (hash(i, Math.floor(t * 10)) & 3) === 0) L.luz(luces, m.x[i], NIVEL_MAR + 3, 5 + m.a[i] * 1.5, '#ff9a3c', 0.12);
      } else if (tp === T.Hundido) {
        // Water drag: slows fast to a gentle sink, drifting less and less, tumbling (bombs) or tipping nose-down (missiles).
        const dr = Math.min(1, dt * 2.2);
        m.vx[i] -= m.vx[i] * dr;
        const term = m.c[i] === 2 ? 26 : m.c[i] === 1 ? 16 : 12;
        m.vy[i] += (term - m.vy[i]) * dr;
        m.x[i] += m.vx[i] * dt;
        if (m.y[i] < FONDO) {
          m.y[i] = Math.min(FONDO, m.y[i] + m.vy[i] * dt);
          if (m.c[i] === 0) m.ang[i] += ((Math.cos(m.ang[i]) >= 0 ? 1.2 : Math.PI - 1.2) - m.ang[i]) * Math.min(1, dt * 0.5);
          else if (m.c[i] === 1) m.ang[i] += m.giro[i] * dt;
          if (m.c[i] < 2 && (hash(i, Math.floor(t * 9)) % 3) === 0 && m.nb < NB * 0.8) burbuja(m, m.x[i] + entre(-2, 2), m.y[i] - 1, entre(12, 20), 1.6, azar() < 0.3 ? 2 : 1);
          if (m.y[i] >= FONDO && m.c[i] < 2) {
            nuevo(m, T.Fondo, m.x[i], FONDO, 0.9, m.c[i] ? 5 : 4);
            m.giro[i] = 0;
          }
        }
        // A delayed fuse: it goes off down there.
        if (m.f[i] > 0 && t >= m.f[i]) {
          const x = m.x[i], y = m.y[i], c = m.c[i];
          m.n--;
          copiar(m, m.n, i);
          if (m.alDetonar) m.alDetonar(x, y, c);
          continue;
        }
      }
    }
    if (t >= m.vida[i]) {
      m.n--;
      copiar(m, m.n, i);
      continue;
    }
    i++;
  }
  for (let i = 0; i < m.nb; ) {
    m.bt[i] += dt;
    if (m.bt[i] > 0) {
      m.by[i] -= m.bv[i] * dt;
      m.bv[i] += dt * 6;
    }
    if (m.bt[i] >= m.bvida[i] || m.by[i] <= 0) {
      const j = --m.nb;
      m.bx[i] = m.bx[j];
      m.by[i] = m.by[j];
      m.bv[i] = m.bv[j];
      m.bt[i] = m.bt[j];
      m.bvida[i] = m.bvida[j];
      m.br[i] = m.br[j];
      continue;
    }
    i++;
  }
  // The sea's own life on screen: now and then a fish jumps; rain dimples the surface.
  if (!vivo) return;
  const a = Math.max(x0, orilla + 20);
  if (a < x1) {
    m.ambT -= dt;
    if (m.ambT <= 0) {
      m.ambT = entre(4, 9);
      if (carga(m) < 0.4) {
        const x = entre(a, x1);
        const d = azar() < 0.5 ? -1 : 1;
        nuevo(m, T.Pez, x, 0, 0.8, d);
        nuevo(m, T.Anillo, x, 0, 0.6, 1, 5);
        nuevo(m, T.Anillo, x + d * 22, 0, 0.7, 1, 6, 0, 0.75);
        nuevo(m, T.Chorro, x + d * 22, 0, 0.25, 4, 1, 0, 0.75);
      }
    }
    if (lluvia > 0.05) {
      const n = lluvia * 40 * dt;
      for (let k = 0; k < 3 && azar() < n - k; k++) if (carga(m) < 0.55) {
        const x = entre(a, x1);
        nuevo(m, T.Anillo, x, 0, 0.5, 0, 4);
        if (azar() < 0.35) nuevo(m, T.Chorro, x, 0, 0.16, 2, 1);
      }
    }
  }
}

/* ── Drawing ── */

const tintes = new Map<string, string[]>();
const hex2 = (n: number) => (n < 16 ? '0' : '') + Math.round(n).toString(16);
/** A colour seen through 0…3 depth steps of water, per hour: 12 shades, built once per colour. */
function tinte(c: string): string[] {
  let r = tintes.get(c);
  if (r) return r;
  r = [];
  const p = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const base = c.length === 7 ? p(c) : [200, 200, 200];
  const aguas = ['#2a86c0', '#6a5a98', '#1e2a68'];
  for (const ag of aguas) {
    const w = p(ag);
    for (let k = 0; k < 4; k++) {
      const f = 0.12 + k * 0.15;
      r.push('#' + hex2(base[0] + (w[0] - base[0]) * f) + hex2(base[1] + (w[1] - base[1]) * f) + hex2(base[2] + (w[2] - base[2]) * f));
    }
  }
  tintes.set(c, r);
  return r;
}

function px(g: Ctx, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

const ease = (u: number) => 1 - (1 - u) * (1 - u);

/**
 * What's under the surface: sinking duds, bubbles, the flash of a blast
 * below, sand puffs. Clipped to the water. Call before `dibujarSobre`.
 */
export function dibujarBajo(g: Ctx, m: Mar, camX: number, ys: number, vw: number, vh: number, hora: Hora): void {
  if (ys > vh || (m.n === 0 && m.nb === 0)) return;
  const h = HI(hora);
  const fondoY = ys + FONDO + 4;
  g.save();
  g.beginPath();
  g.rect(0, ys + 1, vw, Math.max(0, Math.min(vh, fondoY + 2) - ys - 1));
  g.clip();
  for (let i = 0; i < m.n; i++) {
    const t = m.t[i];
    if (t < 0) continue;
    const tp = m.tipo[i];
    if (tp !== T.Hundido && tp !== T.Destello && tp !== T.Fondo) continue;
    const X = Math.round(m.x[i] - camX);
    if (X < -40 || X > vw + 40) continue;
    const u = t / m.vida[i];
    const Y = ys + m.y[i];
    if (tp === T.Destello) {
      // A blast under the water lights it up from inside for a moment.
      const r = Math.round(m.a[i] * (0.6 + 0.4 * ease(Math.min(1, u * 3))));
      g.globalAlpha = 0.55 * (1 - u);
      disco(g, X, Y, r, AGUA_C[h]);
      g.globalAlpha = 0.8 * (1 - u);
      disco(g, X, Y, Math.max(1, r >> 1), ESPUMA[h]);
      g.globalAlpha = 1;
    } else if (tp === T.Fondo) {
      g.globalAlpha = 0.6 * (1 - u);
      const r = Math.round(m.a[i] * (0.5 + u));
      for (let k = -r; k <= r; k += 2) px(g, X + k, Y - 1 - ((hash(k, m.sem[i]) % 3) * u), 2, 1, '#d8c8a0');
      g.globalAlpha = 1;
    } else {
      const d = m.y[i] / FONDO;
      const sombras = tinte(m.col[i] || '#8a8a9a');
      const s0 = h * 4 + Math.min(3, Math.floor(d * 4));
      g.globalAlpha = (1 - d * 0.3) * (u > 0.85 ? (1 - u) / 0.15 : 1);
      const ca = Math.cos(m.ang[i]), sa = Math.sin(m.ang[i]);
      const tipo = m.c[i];
      if (tipo === 2) {
        // A round: a bright sliver sinking, gone in half a second.
        g.globalAlpha = 0.9 * (1 - u);
        px(g, X, Y, m.b[i], 1, '#ffe8a0');
        px(g, X - Math.round(ca * 2), Y - Math.round(sa * 2), 1, 1, sombras[s0]);
      } else if (tipo === 0) {
        // Missile: body along its axis, darker nose, fins at the tail.
        const n = Math.max(5, m.b[i]);
        const tin = tinte('#283048')[s0];
        for (let k = 0; k < n; k++) px(g, X - ca * k - 1, Y - sa * k - 1, 4, 4, tin);
        for (let k = 0; k < n; k++) px(g, X - ca * k, Y - sa * k, 2, 2, k < 2 ? sombras[Math.min(11, s0 + 1)] : sombras[s0]);
        px(g, X - ca * (n >> 1), Y - sa * (n >> 1), 1, 1, '#ffffff');
        px(g, X - ca * (n - 1) - sa * 2, Y - sa * (n - 1) + ca * 2, 1, 1, sombras[Math.min(11, s0 + 1)]);
        px(g, X - ca * (n - 1) + sa * 2, Y - sa * (n - 1) - ca * 2, 1, 1, sombras[Math.min(11, s0 + 1)]);
      } else {
        // Bomb: a fat tumbling body with a tail box.
        const tin = tinte('#283048')[s0];
        for (let k = -3; k <= 3; k++) {
          const wd = k > 1 ? 1 : 2;
          for (let j = -wd; j < wd; j++) px(g, X + ca * k - sa * j - 1, Y + sa * k + ca * j - 1, 3, 3, tin);
        }
        for (let k = -3; k <= 3; k++) {
          const wd = k > 1 ? 1 : 2;
          for (let j = -wd; j < wd; j++) px(g, X + ca * k - sa * j, Y + sa * k + ca * j, 1, 1, j === -wd ? sombras[Math.max(h * 4, s0 - 1)] : sombras[s0]);
        }
        px(g, X - ca * 4 - sa * 2, Y - sa * 4 + ca * 2, 1, 1, sombras[Math.min(11, s0 + 1)]);
        px(g, X - ca * 4 + sa * 2, Y - sa * 4 - ca * 2, 1, 1, sombras[Math.min(11, s0 + 1)]);
        if (m.f[i] > 0 && Math.floor(t * 6) % 2 === 0) px(g, X + ca * 3, Y + sa * 3, 1, 1, '#ff6a5a');
      }
      g.globalAlpha = 1;
    }
  }
  // Bubbles: little rings with a lit corner, wobbling as they rise.
  const bc = BURBUJA[h];
  for (let i = 0; i < m.nb; i++) {
    if (m.bt[i] < 0) continue;
    const X = Math.round(m.bx[i] - camX + Math.sin(m.bt[i] * 9 + i) * 1.2);
    if (X < -4 || X > vw + 4) continue;
    const Y = Math.round(ys + m.by[i]);
    g.globalAlpha = Math.min(1, 0.4 + (1 - m.by[i] / FONDO) * 0.6) * Math.min(1, (m.bvida[i] - m.bt[i]) * 4);
    if (m.br[i] > 1) {
      px(g, X - 1, Y, 1, 1, bc);
      px(g, X + 1, Y, 1, 1, bc);
      px(g, X, Y - 1, 1, 1, '#ffffff');
      px(g, X, Y + 1, 1, 1, bc);
    } else px(g, X, Y, 1, 1, bc);
  }
  g.globalAlpha = 1;
  g.restore();
}

/** Filled pixel disc. */
function disco(g: Ctx, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy + r * 0.6)));
    g.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}
/** Dithered blob (soft edge without anti-aliasing): every other pixel at the rim. */
function nube(g: Ctx, cx: number, cy: number, r: number, col: string, fase: number) {
  g.fillStyle = col;
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.round(Math.sqrt(Math.max(0, r2 - dy * dy)));
    const wi = Math.max(0, w - 2);
    if (wi > 0) g.fillRect(cx - wi, cy + dy, wi * 2 + 1, 1);
    for (let x = wi + 1; x <= w; x++) if ((x + dy + fase) & 1) {
      g.fillRect(cx - x, cy + dy, 1, 1);
      g.fillRect(cx + x, cy + dy, 1, 1);
    }
  }
}

/**
 * What stands on and above the surface: rings, foam, oil, fire, spouts,
 * columns, domes, mist, steam, debris, fish. Call on the front layer (it takes
 * the hour's light), after `dibujarBajo`.
 */
export function dibujarSobre(g: Ctx, m: Mar, camX: number, ys: number, vw: number, vh: number, tiempo: number, hora: Hora): void {
  if (m.n === 0 || ys < -260 || ys > vh + 30) return;
  const h = HI(hora);
  const esp = ESPUMA[h], esp2 = ESPUMA2[h], tin = TINTA[h];
  // Flat things first (rings, foam, oil), then what stands up.
  for (let pasada = 0; pasada < 2; pasada++) {
    for (let i = 0; i < m.n; i++) {
      const t = m.t[i];
      if (t < 0) continue;
      const tp = m.tipo[i];
      const plano = tp === T.Anillo || tp === T.Espuma || tp === T.Aceite || tp === T.Oleada;
      if ((pasada === 0) !== plano || tp === T.Hundido || tp === T.Destello || tp === T.Fondo) continue;
      const X = Math.round(m.x[i] - camX);
      const alcance = tp === T.Anillo ? m.b[i] : tp === T.Oleada ? m.a[i] : tp === T.Espuma || tp === T.Aceite ? m.a[i] * 1.6 : 60;
      if (X < -alcance - 20 || X > vw + alcance + 20) continue;
      const u = Math.min(1, t / m.vida[i]);
      const s = m.sem[i];
      switch (tp) {
        case T.Anillo: {
          // A flat ring seen almost edge-on: a dotted ellipse that spreads and breaks up.
          const r = m.a[i] + (m.b[i] - m.a[i]) * ease(u);
          const ry = Math.max(1, Math.round(r * 0.1));
          const choque = m.c[i] === 1;
          const paso = r < 10 ? 1 : 2;
          g.globalAlpha = choque ? 0.85 * (1 - u) : u > 0.6 ? (1 - u) / 0.4 : 1;
          const n = Math.max(6, Math.round(r * 1.2));
          for (let k = 0; k < n; k++) {
            if (u > 0.4 && hash(k, s) % 10 < u * 8) continue;
            const a = (k / n) * Math.PI * 2;
            const ex = Math.round(Math.cos(a) * r), ey = Math.round(Math.sin(a) * ry);
            px(g, X + ex, ys + ey, paso, 1, choque ? (k & 1 ? tin : esp) : ey < 0 ? esp2 : esp);
          }
          break;
        }
        case T.Espuma: {
          // Lingering foam: a lacy patch that thins out, drifting a hair.
          const a = m.a[i] * (1 + u * 0.4);
          g.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 0.95;
          const n = Math.round(a * 0.9);
          for (let k = 0; k < n; k++) {
            const hh = hash(k, s);
            if ((hh & 255) / 255 < u * 0.9) continue;
            const dx = ((hh >>> 8) % 1000) / 1000 * 2 - 1;
            const ex = Math.round(X + dx * a + Math.sin(tiempo * 0.7 + k) * 0.8);
            const ey = ys + ((hh >>> 18) % 3) - 1;
            px(g, ex, ey, 1 + ((hh >>> 20) & 1) + (Math.abs(dx) < 0.4 ? 1 : 0), 1, (hh >>> 22) & 1 ? esp : esp2);
          }
          break;
        }
        case T.Aceite: {
          // An oil slick: dark, flat, spreading, a rainbow sheen sliding over it.
          const a = Math.round(m.a[i] * (1 + u * 0.8));
          g.globalAlpha = 0.75 * (u > 0.75 ? (1 - u) / 0.25 : 1);
          px(g, X - a, ys, a * 2, 1, ACEITE);
          px(g, X - a + 3, ys + 1, a * 2 - 6, 1, ACEITE);
          px(g, X - a + 6, ys - 1, Math.max(1, a * 2 - 12), 1, ACEITE);
          g.globalAlpha *= 0.9;
          for (let k = 0; k < a; k += 3) {
            const q = Math.floor(tiempo * 2 + k * 0.3 + (s & 7));
            px(g, X - a + 2 + ((k * 7 + q) % (a * 2 - 4)), ys + (k % 2), 2, 1, IRIS[(q + k) & 3]);
          }
          break;
        }
        case T.Oleada: {
          // Base surge: two walls of mist rolling out over the water.
          const r = m.a[i] * ease(u);
          const alto = Math.round(26 * (1 - u) + 6);
          g.globalAlpha = 0.75 * (1 - u * u);
          for (const lado of [-1, 1]) {
            const cx = Math.round(X + lado * r);
            for (let k = 0; k < 6; k++) nube(g, cx - lado * k * 6, ys - Math.round(alto * (0.3 + 0.12 * (k % 3))), Math.max(3, Math.round(alto * 0.45) - k), k & 1 ? esp2 : BRUMA[h], k);
          }
          px(g, Math.round(X - r), ys - 1, Math.round(r * 2), 1, esp2);
          break;
        }
        case T.Chorro: {
          // A bullet spout: a thin jet up and back down, a drop on top; cannon shells get a crown.
          const H = m.a[i], w = m.b[i];
          const hh = Math.round(H * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) * (1 - Math.max(0, u - 0.45) / 0.55));
          g.globalAlpha = u > 0.75 ? (1 - u) / 0.25 : 1;
          if (hh > 0) {
            px(g, X - (w >> 1) - 1, ys - hh, w + 2, hh, tin);
            px(g, X - (w >> 1), ys - hh, w, hh, esp2);
            px(g, X, ys - hh, 1, Math.max(1, hh - 1), esp);
          }
          const top = Math.round(H * Math.sin(Math.min(1, u * 1.5) * Math.PI));
          px(g, X - (w >> 1), ys - top - 2, w, 2, esp);
          if (m.c[i] === 1 && u < 0.6) {
            const sp = Math.round(2 + u * 8);
            px(g, X - sp - 1, ys - 2 - Math.round(3 * (1 - u)), 1, 2, esp);
            px(g, X + sp + 1, ys - 2 - Math.round(3 * (1 - u)), 1, 2, esp);
          }
          break;
        }
        case T.Rebote: {
          // The skipping round: a short bright arc to where it lands next.
          const dx = m.a[i];
          const k = Math.round(dx * u);
          const y = Math.round(-Math.sin(u * Math.PI) * m.b[i]);
          px(g, X + k, ys - 1 + y, 2, 1, '#fff4c0');
          px(g, X + k - Math.sign(dx), ys - 1 + y, 1, 1, '#ffb040');
          break;
        }
        case T.Columna:
          columna(g, X, ys, u, m.t[i], m.a[i], m.b[i], m.c[i] === 1, s, esp, esp2, tin, h);
          break;
        case T.Domo: {
          // The sea heaves up in a white dome before the column bursts through.
          const r = m.a[i];
          const k = Math.sin(Math.min(1, u * 1.4) * Math.PI);
          const hgt = Math.round(r * 0.7 * k);
          if (hgt <= 0) break;
          g.globalAlpha = 1;
          for (let dy = 0; dy <= hgt; dy++) {
            const f = dy / hgt;
            const wd = Math.round(r * (0.4 + 0.6 * k) * Math.sqrt(Math.max(0, 1 - f * f)));
            px(g, X - wd - 1, ys - dy, wd * 2 + 3, 1, tin);
            px(g, X - wd, ys - dy, wd * 2 + 1, 1, f > 0.6 ? esp : (dy + (s & 1)) % 3 === 0 ? AGUA_C[h] : esp2);
          }
          px(g, X - Math.round(r * 0.3), ys - hgt + 1, Math.max(1, Math.round(r * 0.3)), 1, '#ffffff');
          break;
        }
        case T.Bruma: {
          const r = Math.round(m.a[i] * (0.6 + u * 0.8));
          g.globalAlpha = 0.45 * (u < 0.15 ? u / 0.15 : 1 - u);
          nube(g, X, Math.round(ys + m.y[i]), r, BRUMA[h], s & 1);
          nube(g, X + Math.round(r * 0.8), Math.round(ys + m.y[i] + r * 0.3), Math.max(1, r - 2), BRUMA[h], (s >>> 1) & 1);
          break;
        }
        case T.Vapor: {
          const r = Math.round(m.a[i] * (0.5 + u));
          g.globalAlpha = 0.55 * (1 - u);
          nube(g, X + Math.round(Math.sin(t * 3 + s) * 2), Math.round(ys + m.y[i]), r, '#f4f8ff', Math.floor(t * 8) & 1);
          break;
        }
        case T.Fuego: {
          // Burning fuel on the water: flickering tongues and a thread of smoke.
          const a = m.a[i] * (u < 0.1 ? u / 0.1 : u > 0.7 ? (1 - u) / 0.3 : 1);
          g.globalAlpha = 1;
          const q = Math.floor(t * 12);
          for (let k = -1; k <= 1; k++) {
            const hf = Math.max(1, Math.round(a * (1.6 + (hash(q + k * 5, s) % 4) * 0.4) - Math.abs(k) * 2));
            const x = X + k * 2;
            px(g, x, ys - hf, 2, hf, LLAMA[2]);
            px(g, x, ys - Math.round(hf * 0.7), 1, Math.round(hf * 0.7), LLAMA[1]);
            px(g, x, ys - Math.round(hf * 0.3), 1, Math.round(hf * 0.3), LLAMA[0]);
          }
          g.globalAlpha = 0.4;
          for (let k = 1; k < 6; k++) px(g, X + Math.round(Math.sin(t * 2 + k) * k * 0.6), ys - Math.round(a * 2) - k * 4, 2 + (k >> 1), 2, '#5a5468');
          break;
        }
        case T.Pez: {
          // A silver fish arcing out and back in.
          const d = m.a[i];
          const x = X + Math.round(d * u * 22);
          const y = ys - Math.round(Math.sin(u * Math.PI) * 13);
          const nar = Math.cos(u * Math.PI); // nose up then down
          g.globalAlpha = 1;
          px(g, x - 1, y - 1, 4, 2, '#4a6a8a');
          px(g, x, y - 1, 2, 1, h === 2 ? '#a8b4d8' : '#e8f4ff');
          px(g, x - d * 2, y - 1 + Math.round(nar), 1, 1, '#4a6a8a');
          px(g, x - d * 3, y - 2 + Math.round(nar * 1.5), 1, 2, '#4a6a8a');
          if ((Math.floor(t * 20) & 1) === 0) px(g, x + d * 3, y + 1, 1, 1, esp);
          break;
        }
        case T.Tabla: {
          // Floating debris: planks and hull bits bobbing, then slipping under.
          const len = m.b[i];
          const y = Math.round(ys + m.y[i] - 1 + Math.sin(t * 2.2 + (s & 15)) * 0.8);
          const inc = Math.round(Math.sin(t * 1.6 + s) * 1);
          g.globalAlpha = m.y[i] > 3 ? Math.max(0, 1 - (m.y[i] - 3) / 6) : 1;
          const c = m.c[i] === 2 ? m.col[i] || MADERA[0] : MADERA[m.c[i] & 1];
          px(g, X - (len >> 1), y, len, 2, c);
          px(g, X - (len >> 1), y, len, 1, m.c[i] === 2 ? '#d8d0e8' : '#b4885a');
          if (inc) px(g, X + (len >> 1), y + inc, 1, 1, c);
          px(g, X - (len >> 1) - 1, ys, 1, 1, esp);
          px(g, X + (len >> 1) + 1, ys, 1, 1, esp);
          break;
        }
      }
    }
  }
  g.globalAlpha = 1;
}

/** A missile's or bomb's column: rises, crowns, then collapses into droplets. */
function columna(g: Ctx, X: number, ys: number, u: number, t: number, H: number, W: number, caliente: boolean, s: number, esp: string, esp2: string, tin: string, h: number) {
  const subida = ease(Math.min(1, u / 0.28));
  const caida = u > 0.35 ? Math.pow((u - 0.35) / 0.65, 1.4) : 0;
  const hh = Math.round(H * subida * (1 - caida));
  const wb = Math.max(1, Math.round(W * (1 - 0.35 * u)));
  g.globalAlpha = u > 0.8 ? (1 - u) / 0.2 : 1;
  if (hh > 0) {
    // Body: lumpy, inked, white core; wider at the foot, a skirt where it meets the sea.
    for (let y = 0; y < hh; y += 2) {
      const f = y / Math.max(1, hh);
      const j = Math.round(Math.sin(y * 0.3 + (s & 63) + t * 3) * (0.6 + f));
      const w = Math.max(1, Math.round(wb * (1.2 - f * 0.5) + (u > 0.3 ? j : 0)));
      px(g, X - w - 1 + j, ys - y - 2, w * 2 + 3, 2, tin);
      // Shaded in vertical bands (lit core, cooler shadow side), so it reads as one plume, not stacked slabs.
      px(g, X - w + j, ys - y - 2, w * 2 + 1, 2, esp);
      if (w > 1) px(g, X + j + Math.round(w * 0.35), ys - y - 2, Math.max(1, Math.round(w * 0.65)) + 1, 2, esp2);
      if (w > 2) px(g, X + j + w - 1, ys - y - 2, 1, 2, AGUA_C[h]);
      if (hash(y, s + 3) % 5 === 0) px(g, X - w + j - 1, ys - y - 2, 1, 1, esp);
    }
    // Crown: a cauliflower head while it's going up.
    if (u < 0.55) {
      const cr = Math.max(2, Math.round(wb * 1.4 + 2));
      const cy = ys - hh;
      disco(g, X, cy, cr + 1, tin);
      disco(g, X - Math.round(cr * 0.7), cy + 2, cr - 1, tin);
      disco(g, X + Math.round(cr * 0.7), cy + 1, cr - 1, tin);
      disco(g, X, cy, cr, esp);
      disco(g, X - Math.round(cr * 0.7), cy + 2, Math.max(1, cr - 2), esp2);
      disco(g, X + Math.round(cr * 0.7), cy + 1, Math.max(1, cr - 2), esp);
      px(g, X - 1, cy - cr + 1, 2, 1, '#ffffff');
    }
  }
  // The crown at its foot: a ring of spikes thrown out sideways.
  if (u < 0.4) {
    const k = u / 0.4;
    const n = Math.min(6, 2 + (W >> 1));
    for (let i = 0; i < n; i++) {
      const sp = Math.round(W + 2 + i * (2 + W * 0.4) * (0.5 + k));
      const hs = Math.max(1, Math.round((H * 0.18 / (i + 1)) * Math.sin(k * Math.PI)));
      px(g, X - sp, ys - hs, 1, hs, esp);
      px(g, X + sp, ys - hs, 1, hs, esp);
    }
  }
  // Droplets: thrown out of the column and falling back on parabolas.
  const nd = Math.min(18, 6 + Math.round(H / 8));
  const T0 = t;
  for (let i = 0; i < nd; i++) {
    const hh2 = hash(i, s);
    const vx = (((hh2 & 1023) / 1023) * 2 - 1) * (14 + W * 6);
    const vy = (0.4 + ((hh2 >>> 10) & 255) / 255 * 0.6) * Math.sqrt(H) * 9;
    const t0 = ((hh2 >>> 18) & 63) / 63 * 0.5;
    const tt = T0 - t0;
    if (tt <= 0) continue;
    const y = vy * tt - 0.5 * 140 * tt * tt;
    if (y < 0) continue;
    const x = X + Math.round(vx * tt);
    px(g, x, ys - Math.round(y) - 1, 1, 2, i & 1 ? esp : esp2);
  }
  if (caliente && u > 0.15 && u < 0.7) {
    // Hot metal: a wisp of steam curling off the top.
    g.globalAlpha = 0.4 * (1 - u);
    nube(g, X + 2, ys - Math.round(H * 0.6 * subida) - 4, Math.max(2, W), '#f8fbff', Math.floor(t * 8) & 1);
  }
  g.globalAlpha = 1;
}

/**
 * A boat's wake on the surface: a curling bow wave and a trail of foam with
 * little Kelvin wavelets behind the stern. (X = screen x of its middle,
 * `ancho` its length, `vx` world speed.)
 */
export function estelaBarco(g: Ctx, X: number, ys: number, vx: number, ancho: number, tiempo: number, hora: Hora): void {
  const h = HI(hora);
  const esp = ESPUMA[h], esp2 = ESPUMA2[h];
  const dir = vx >= 0 ? 1 : -1;
  const v = Math.min(1, Math.abs(vx) / 30);
  const proa = Math.round(X + dir * ancho * 0.5);
  const popa = Math.round(X - dir * ancho * 0.5);
  // Bow wave: a white curl pushed ahead, bobbing.
  const b = Math.round(1 + v * 2 + Math.sin(tiempo * 3) * 0.6);
  px(g, proa - (dir > 0 ? 0 : 3), ys - b, 4, b, esp);
  px(g, proa + dir * 3, ys - 1, 2, 1, esp2);
  // Hull foam along the waterline.
  px(g, Math.min(proa, popa), ys, Math.abs(proa - popa), 1, esp2);
  // Stern trail: foam thinning out behind, wavelets every few px.
  const largo = Math.round(18 + ancho * 0.6 + v * 50);
  for (let k = 0; k < largo; k += 2) {
    const f = k / largo;
    if (hash(k + Math.floor(tiempo * 6), 7) % 100 < f * 85) continue;
    const x = popa - dir * k;
    px(g, x, ys + ((k >> 1) % 2), 2, 1, f < 0.3 ? esp : esp2);
    if (k % 8 === 4 && f < 0.7) px(g, x, ys - 1 - Math.round((1 - f) * v * 2), 2, 1, esp);
  }
  g.globalAlpha = 1;
}

/**
 * The plane very low over the water: its downwash flattens and ruffles the
 * sea under it in a spreading fan of dashes. `k` 0 (high) … 1 (on the water).
 */
export function soplo(g: Ctx, X: number, ys: number, k: number, tiempo: number, hora: Hora): void {
  if (k <= 0.05) return;
  const h = HI(hora);
  const r = Math.round(8 + 18 * k);
  g.globalAlpha = 0.3 + 0.5 * k;
  const ph = (tiempo * 3) % 1;
  for (let i = 0; i < 3; i++) {
    const q = (ph + i / 3) % 1;
    const d = Math.round(r * q);
    g.globalAlpha = (0.3 + 0.5 * k) * (1 - q);
    px(g, X - d - 3, ys, 3, 1, ESPUMA2[h]);
    px(g, X + d, ys, 3, 1, ESPUMA2[h]);
  }
  // Right under it the surface goes dark and choppy.
  g.globalAlpha = 0.25 * k;
  px(g, X - Math.round(r * 0.4), ys + 1, Math.round(r * 0.8), 1, TINTA[h]);
  g.globalAlpha = 1;
}

/** A tracer over the water mirrored on it: a short faint streak under the surface line. */
export function reflejoTrazadora(g: Ctx, X: number, ys: number, alto: number, color: string): void {
  if (alto < 0 || alto > 80) return;
  const Y = ys + 2 + Math.round(alto * 0.35);
  if (Y > ys + 30) return;
  g.globalAlpha = 0.45 * (1 - alto / 80);
  px(g, X - 1, Y, 3, 1, color);
  g.globalAlpha = 1;
}

/** How many events and bubbles are live (debug / perf). */
export function cuantos(m: Mar): number {
  return m.n + m.nb;
}
