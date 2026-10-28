/*
 * Fuegos artificiales de los misiles enemigos: estallidos con forma (anillo,
 * peonía, sauce, palmera, crisantemo, mariposa, espiral, trueno…) y el
 * rastro de partículas de los misiles chicos y numerosos (bolas, estrellas,
 * frondas, chispas, abejas), que no llevan estela completa.
 *
 * Pixel art sin anti-aliasing: cada partícula es 1–3 px de color plano.
 *
 * Rendimiento (teléfonos): una sola reserva fija de partículas en
 * Float32Array/Uint8Array, recorrida como anillo (si se llena, la nueva pisa a
 * la más vieja); nada se crea por cuadro. Los colores se registran una vez en
 * una tabla (índice → string) para no armar strings al dibujar. Lo que queda
 * fuera de pantalla no se dibuja.
 *
 * Coordenadas del mundo: x a la derecha, y = altitud hacia arriba.
 */
import type { Estallido } from './misiles';

const N = 900;

// Clases de partícula.
const ESTRELLA = 0; // estrella del estallido: cruz → cuadrito → punto que titila
const SAUCE = 1; // brasa dorada que cuelga: punto con cola corta
const CRUJE = 2; // crepitar: invisible hasta su retardo, luego un fogonazo blanco
const ONDA = 3; // anillo de luz que se abre (uno por estallido)
const RASTRO = 4; // rastro de un misil chico
const PURPURINA = 5; // titila en su sitio

export type Fuegos = {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** s; negativa = todavía esperando (retardo). */
  edad: Float32Array;
  vida: Float32Array;
  /** Arrastre (1/s) y gravedad (px/s²) de cada una. */
  arr: Float32Array;
  grav: Float32Array;
  /** Color (índice en la tabla) al nacer y al envejecer. */
  c1: Uint8Array;
  c2: Uint8Array;
  clase: Uint8Array;
  tam: Uint8Array;
  /** Próxima ranura a usar (anillo). */
  i: number;
  /** Nº de partículas vivas aprox. (para saltarse el bucle cuando no hay nada). */
  vivas: number;
};

/* ── Tabla de colores ───────────────────────────────────────────────────── */

const COLORES: string[] = ['#ffffff'];
const indice = new Map<string, number>([['#ffffff', 0]]);
function colorId(c: string): number {
  let k = indice.get(c);
  if (k === undefined) {
    k = COLORES.length;
    if (k > 250) return 0;
    COLORES.push(c);
    indice.set(c, k);
  }
  return k;
}
/** Paleta → índices (cacheado por array: las paletas del catálogo son fijas). */
const idsDe = new WeakMap<readonly string[], Uint8Array>();
function ids(p: readonly string[]): Uint8Array {
  let r = idsDe.get(p);
  if (!r) {
    r = Uint8Array.from(p.length ? p.map(colorId) : [0]);
    idsDe.set(p, r);
  }
  return r;
}
const BLANCO = 0;
const AMARILLO = colorId('#fff6b0');

/* ── API ────────────────────────────────────────────────────────────────── */

export function crearFuegos(): Fuegos {
  return {
    x: new Float32Array(N),
    y: new Float32Array(N),
    vx: new Float32Array(N),
    vy: new Float32Array(N),
    edad: new Float32Array(N),
    vida: new Float32Array(N),
    arr: new Float32Array(N),
    grav: new Float32Array(N),
    c1: new Uint8Array(N),
    c2: new Uint8Array(N),
    clase: new Uint8Array(N),
    tam: new Uint8Array(N),
    i: 0,
    vivas: 0,
  };
}

export function limpiarFuegos(f: Fuegos): void {
  f.vida.fill(0);
  f.edad.fill(0);
  f.vivas = 0;
}

function una(
  f: Fuegos, x: number, y: number, vx: number, vy: number, vida: number, clase: number,
  c1: number, c2: number, tam: number, arr: number, grav: number, retardo = 0,
) {
  const k = f.i;
  f.i = (k + 1) % N;
  f.x[k] = x;
  f.y[k] = y;
  f.vx[k] = vx;
  f.vy[k] = vy;
  f.edad[k] = -retardo;
  f.vida[k] = vida;
  f.clase[k] = clase;
  f.c1[k] = c1;
  f.c2[k] = c2;
  f.tam[k] = tam;
  f.arr[k] = arr;
  f.grav[k] = grav;
  if (f.vivas < N) f.vivas++;
}

const azar = Math.random;
const TAU = Math.PI * 2;

/**
 * Un estallido de fuego artificial en (x, y), heredando un poco de la
 * velocidad (vx, vy) de lo que explotó. `escala` agranda velocidades (≈ radio).
 */
export function estallar(f: Fuegos, x: number, y: number, vx: number, vy: number, forma: Estallido, paleta: readonly string[], escala = 1): void {
  const P = ids(paleta);
  const n = P.length;
  const col = (k: number) => P[((k % n) + n) % n];
  const hx = vx * 0.25, hy = vy * 0.25;
  const s = escala;
  switch (forma) {
    case 'chispazo': {
      // los chicos: un puñadito de estrellas y un destello
      for (let k = 0; k < 5; k++) {
        const a = azar() * TAU, v = (30 + azar() * 50) * s;
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.25 + azar() * 0.2, ESTRELLA, col(k), BLANCO, 1, 3, 40);
      }
      una(f, x, y, 6 * s, 0, 0.12, ONDA, col(0), BLANCO, 1, 0, 0);
      break;
    }
    case 'anillo':
    case 'doble': {
      const m = 22;
      for (let k = 0; k < m; k++) {
        const a = (TAU * k) / m, v = 120 * s;
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.75 + azar() * 0.15, ESTRELLA, col(0), col(1), 2, 2.4, 30);
      }
      if (forma === 'doble') {
        // segundo anillo, interior y de otro color, un instante después
        for (let k = 0; k < 16; k++) {
          const a = (TAU * (k + 0.5)) / 16, v = 70 * s;
          una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.7, ESTRELLA, col(3), col(1), 2, 2.4, 30, 0.14);
        }
      }
      una(f, x, y, 60 * s, 0, 0.3, ONDA, col(1), BLANCO, 1, 0, 0);
      break;
    }
    case 'peonia': {
      // esfera de estrellas que cambian de color al apagarse
      for (let k = 0; k < 30; k++) {
        const a = azar() * TAU, v = (45 + 85 * Math.sqrt(azar())) * s;
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.6 + azar() * 0.4, ESTRELLA, col(k), col(k + 1), 2, 2.2, 45);
      }
      una(f, x, y, 50 * s, 0, 0.25, ONDA, col(0), BLANCO, 1, 0, 0);
      break;
    }
    case 'sauce': {
      // sauce: brasas que cuelgan y caen despacio, con cola
      for (let k = 0; k < 34; k++) {
        const a = azar() * TAU, v = (55 + 60 * azar()) * s;
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v + 20, 1.4 + azar() * 0.8, SAUCE, col(k), col(k + 2), 1, 1.6, 55);
      }
      una(f, x, y, 40 * s, 0, 0.25, ONDA, col(0), BLANCO, 1, 0, 0);
      break;
    }
    case 'palmera': {
      // pocas frondas gruesas: cada una es un hilo de brasas a distinta velocidad
      const m = 8;
      for (let k = 0; k < m; k++) {
        const a = (-10 + (200 * k) / (m - 1)) * (Math.PI / 180);
        for (let j = 0; j < 4; j++) {
          const v = (70 + 28 * j) * s;
          una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 1.3 + 0.15 * j, SAUCE, col(k + j), col(3), j === 3 ? 2 : 1, 1.3, 70);
        }
      }
      una(f, x, y, 45 * s, 0, 0.3, ONDA, col(2), BLANCO, 1, 0, 0);
      break;
    }
    case 'crisantemo': {
      // dos esferas de estrellas multicolor + purpurina en el centro
      for (let k = 0; k < 26; k++) {
        const a = (TAU * k) / 26 + azar() * 0.1, v = 140 * s;
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.8 + azar() * 0.2, ESTRELLA, col(k), col(k + 3), 2, 2.4, 35);
      }
      for (let k = 0; k < 14; k++) {
        const a = azar() * TAU, v = 70 * s * azar();
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.9 + azar() * 0.4, PURPURINA, col(k), BLANCO, 1, 2, 10);
      }
      una(f, x, y, 70 * s, 0, 0.3, ONDA, col(0), BLANCO, 1, 0, 0);
      break;
    }
    case 'mariposa': {
      // curva de mariposa: r = e^sen θ − 2·cos 4θ (dos alas de dos colores)
      for (let k = 0; k < 34; k++) {
        const a = (TAU * k) / 34;
        const r = Math.exp(Math.sin(a)) - 2 * Math.cos(4 * a);
        const v = 22 * r * s;
        const lado = Math.cos(a) >= 0 ? 0 : 1;
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.8, ESTRELLA, col(lado), col(lado + 2), 2, 2, 20);
      }
      una(f, x, y, 40 * s, 0, 0.25, ONDA, col(0), BLANCO, 1, 0, 0);
      break;
    }
    case 'espiral': {
      // molinillo: cuatro brazos que giran al abrirse
      for (let b = 0; b < 4; b++) {
        for (let j = 0; j < 7; j++) {
          const a = (TAU * b) / 4 + j * 0.22, v = (30 + 18 * j) * s;
          una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.6 + j * 0.05, ESTRELLA, col(b), col(b + 1), j < 3 ? 2 : 1, 2, 30);
        }
      }
      for (let k = 0; k < 10; k++) una(f, x + (azar() - 0.5) * 36 * s, y + (azar() - 0.5) * 36 * s, 0, 0, 0.08, CRUJE, BLANCO, AMARILLO, 2, 0, 0, 0.2 + azar() * 0.4);
      una(f, x, y, 50 * s, 0, 0.25, ONDA, col(1), BLANCO, 1, 0, 0);
      break;
    }
    case 'crepitar': {
      for (let k = 0; k < 8; k++) {
        const a = azar() * TAU, v = (40 + 40 * azar()) * s;
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.4, ESTRELLA, col(k), BLANCO, 1, 3, 40);
      }
      for (let k = 0; k < 16; k++) {
        const r = 26 * s * Math.sqrt(azar()), a = azar() * TAU;
        una(f, x + Math.cos(a) * r, y + Math.sin(a) * r, 0, -8, 0.07, CRUJE, BLANCO, col(k), 1 + (k & 1), 0, 0, 0.12 + azar() * 0.5);
      }
      break;
    }
    case 'trueno': {
      // petardo: fogonazo grande, anillo blanco y una traca de crujidos
      una(f, x, y, 50 * s, 0, 0.32, ONDA, BLANCO, col(2), 2, 0, 0);
      una(f, x, y, 30 * s, 0, 0.22, ONDA, col(0), col(3), 1, 0, 0, 0.05);
      for (let k = 0; k < 12; k++) {
        const a = (TAU * k) / 12, v = 160 * s;
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.35, ESTRELLA, BLANCO, col(k), 2, 5, 0);
      }
      for (let k = 0; k < 28; k++) {
        const r = 24 * s * Math.sqrt(azar()), a = azar() * TAU;
        una(f, x + Math.cos(a) * r, y + Math.sin(a) * r, 0, -6, 0.07, CRUJE, BLANCO, col(k), 1 + (k % 3 === 0 ? 1 : 0), 0, 0, 0.05 + azar() * 0.6);
      }
      break;
    }
    case 'cometa': {
      // estrellas hacia adelante y una nube de purpurina
      const a0 = Math.atan2(vy, vx);
      for (let k = 0; k < 16; k++) {
        const a = a0 + (azar() - 0.5) * 1.6, v = (60 + 90 * azar()) * s;
        una(f, x, y, Math.cos(a) * v, Math.sin(a) * v, 0.5 + azar() * 0.3, ESTRELLA, col(k), BLANCO, 2, 2.5, 30);
      }
      for (let k = 0; k < 22; k++) {
        const a = azar() * TAU, v = 50 * s * azar();
        una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.8 + azar() * 0.6, PURPURINA, col(k), BLANCO, 1, 2, 8);
      }
      una(f, x, y, 45 * s, 0, 0.22, ONDA, col(0), BLANCO, 1, 0, 0);
      break;
    }
    case 'arcoiris': {
      // anillos concéntricos, uno por color (de afuera hacia adentro)
      const anillos = Math.min(5, n);
      for (let r = 0; r < anillos; r++) {
        const m = 14, v = (150 - r * 24) * s;
        for (let k = 0; k < m; k++) {
          const a = (TAU * (k + (r & 1) * 0.5)) / m;
          una(f, x, y, hx + Math.cos(a) * v, hy + Math.sin(a) * v, 0.75, ESTRELLA, col(r), col(r + 1), 2, 2.4, 25);
        }
      }
      una(f, x, y, 70 * s, 0, 0.3, ONDA, BLANCO, col(0), 1, 0, 0);
      break;
    }
  }
}

/**
 * Rastro de un misil chico: llamar en cada paso (emite ~`ritmo` partículas por
 * segundo detrás de él, del color `tinte` de su paleta).
 */
export function rastro(f: Fuegos, x: number, y: number, vx: number, vy: number, paleta: readonly string[], tinte: number, ritmo: number, dt: number): void {
  const P = ids(paleta);
  const n = P.length;
  let k = ritmo * dt;
  // parte entera seguro, la fracción al azar (sin estado por misil)
  while (k > 0) {
    if (k < 1 && azar() > k) break;
    k -= 1;
    const c = P[((tinte % n) + n) % n];
    const lado = (azar() - 0.5) * 18;
    una(f, x, y, -vx * 0.08 + lado, -vy * 0.08 - lado * 0.3, 0.22 + azar() * 0.25, RASTRO, c, P[(tinte + 1) % n], azar() < 0.3 ? 2 : 1, 3, 25);
  }
}

/** Chispitas sueltas (decorado, sin daño): la mecha del petardo, la boca de la candela. */
export function chispitas(f: Fuegos, x: number, y: number, paleta: readonly string[], cuantas: number, fuerza = 60): void {
  const P = ids(paleta);
  for (let k = 0; k < cuantas; k++) {
    const a = azar() * TAU, v = fuerza * (0.4 + 0.6 * azar());
    una(f, x, y, Math.cos(a) * v, Math.sin(a) * v + 20, 0.18 + azar() * 0.2, ESTRELLA, P[k % P.length], BLANCO, 1, 4, 120);
  }
}

export function actualizarFuegos(f: Fuegos, dt: number, viento: number): void {
  if (f.vivas <= 0) return;
  let vivas = 0;
  const { x, y, vx, vy, edad, vida, arr, grav } = f;
  for (let k = 0; k < N; k++) {
    if (vida[k] <= 0) continue;
    edad[k] += dt;
    if (edad[k] >= vida[k]) {
      vida[k] = 0;
      continue;
    }
    vivas++;
    // la onda no se mueve (su vx es el radio)
    if (edad[k] < 0 || f.clase[k] === ONDA) continue;
    const a = Math.max(0, 1 - arr[k] * dt);
    vx[k] = vx[k] * a + viento * 0.3 * dt;
    vy[k] = vy[k] * a - grav[k] * dt;
    x[k] += vx[k] * dt;
    y[k] += vy[k] * dt;
  }
  f.vivas = vivas;
}

/**
 * Dibuja todas las partículas. `sx`/`sy` pasan del mundo a la pantalla; W/H es
 * el tamaño del lienzo (lo de afuera no se dibuja).
 */
export function dibujarFuegos(g: CanvasRenderingContext2D, f: Fuegos, sx: (x: number) => number, sy: (y: number) => number, t: number, W: number, H: number): void {
  if (f.vivas <= 0) return;
  const { x, y, vx, vy, edad, vida, c1, c2, clase, tam } = f;
  const tic = Math.floor(t * 20);
  let actual = -1;
  const pinta = (c: number) => {
    if (c !== actual) {
      actual = c;
      g.fillStyle = COLORES[c];
    }
  };
  for (let k = 0; k < N; k++) {
    if (vida[k] <= 0 || edad[k] < 0) continue;
    const u = edad[k] / vida[k];
    const X = Math.round(sx(x[k])), Y = Math.round(sy(y[k]));
    const cl = clase[k];
    if (cl === ONDA) {
      // anillo de 20 puntos que se abre (vx = radio final); el centro destella al principio
      const r = vx[k] * (cl === ONDA && vx[k] > 0 ? 0.5 : 1) * Math.sqrt(u);
      if (X + r < -4 || X - r > W + 4 || Y + r < -4 || Y - r > H + 4) continue;
      pinta(u < 0.5 ? c1[k] : c2[k]);
      const p = tam[k] + (u < 0.4 ? 1 : 0);
      for (let j = 0; j < 20; j++) {
        if (u > 0.6 && (j + tic) & 1) continue;
        const a = (TAU * j) / 20;
        g.fillRect(Math.round(X + Math.cos(a) * r), Math.round(Y - Math.sin(a) * r), p, p);
      }
      if (u < 0.3) {
        pinta(BLANCO);
        const q = Math.round(4 * (1 - u / 0.3)) + 1;
        g.fillRect(X - q, Y - 1, q * 2 + 1, 3);
        g.fillRect(X - 1, Y - q, 3, q * 2 + 1);
      }
      continue;
    }
    if (X < -4 || Y < -4 || X > W + 4 || Y > H + 4) continue;
    if (cl === ESTRELLA) {
      const c = u < 0.55 ? c1[k] : c2[k];
      if (u < 0.3 && tam[k] >= 2) {
        // cruz con centro blanco
        pinta(c);
        g.fillRect(X - 1, Y, 3, 1);
        g.fillRect(X, Y - 1, 1, 3);
        pinta(BLANCO);
        g.fillRect(X, Y, 1, 1);
      } else if (u < 0.7) {
        pinta(c);
        g.fillRect(X, Y, tam[k] >= 2 ? 2 : 1, tam[k] >= 2 ? 2 : 1);
      } else if ((tic + k) & 1) {
        pinta(c);
        g.fillRect(X, Y, 1, 1);
      }
    } else if (cl === SAUCE) {
      // brasa con cola corta hacia atrás (de donde viene)
      const c = u < 0.4 ? c1[k] : c2[k];
      if (u > 0.8 && (tic + k) & 1) continue;
      pinta(c);
      const w = tam[k];
      g.fillRect(X, Y, w, w);
      const cx = Math.round(sx(x[k] - vx[k] * 0.05)), cy = Math.round(sy(y[k] - vy[k] * 0.05));
      if (cx !== X || cy !== Y) g.fillRect(cx, cy, 1, 1);
      if (u < 0.25) {
        pinta(BLANCO);
        g.fillRect(X, Y, 1, 1);
      }
    } else if (cl === CRUJE) {
      // fogonazo de un instante
      const p = tam[k];
      pinta(u < 0.5 ? c1[k] : c2[k]);
      g.fillRect(X - p, Y, p * 2 + 1, 1);
      g.fillRect(X, Y - p, 1, p * 2 + 1);
      if (p >= 2 && u < 0.5) g.fillRect(X - 1, Y - 1, 3, 3);
    } else if (cl === RASTRO) {
      if (u > 0.6 && (tic + k) & 1) continue;
      pinta(u < 0.3 ? BLANCO : u < 0.65 ? c1[k] : c2[k]);
      const w = u < 0.5 ? tam[k] : 1;
      g.fillRect(X, Y, w, w);
    } else if (cl === PURPURINA) {
      const f4 = (tic + k * 3) & 3;
      if (f4 === 3) continue;
      pinta(f4 === 2 ? BLANCO : c1[k]);
      if (f4 === 0 && u < 0.6) {
        g.fillRect(X - 1, Y, 3, 1);
        g.fillRect(X, Y - 1, 1, 3);
      } else g.fillRect(X, Y, 1, 1);
    }
  }
}
