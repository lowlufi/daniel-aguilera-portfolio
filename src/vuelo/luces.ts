/*
 * Luces y sombras «dulces» en pixel art: sin desenfoques ni degradados suaves.
 *
 * Luces: halos de corta vida (explosiones, fogonazos, motores de misil, nitro,
 * bengalas) pintados con `globalCompositeOperation = 'lighter'` a partir de
 * discos tramados precalculados: un centro lleno, un anillo en damero (50 %) y
 * un borde a 25 %. Cada sprite se cachea por color, radio y paridad de la trama
 * (así el damero queda fijo en pantalla aunque la luz se mueva). La intensidad
 * baja en pasos de 1/4 con la edad. `intensidadNoche` las hace más grandes y
 * fuertes de noche o en el espacio.
 *
 * Sombras: elipse tramada oscura sobre el suelo / mar, más chica y tenue cuanto
 * más alto vuela la cosa; desaparece por encima de ~220 px de altura.
 *
 * Rendimiento: estado en arreglos tipados de tamaño fijo, un drawImage por luz
 * y por sombra. ~60 luces cuestan muy por debajo de 1 ms.
 *
 * Coordenadas del mundo: x a la derecha, y = altitud hacia arriba.
 */

/* ── Constantes ─────────────────────────────────────────────────────────── */

const MAX_L = 64;
const MAX_RL = 48; // radio máximo de un halo, px
const MARGEN = 48;
const ALTURA_MAX = 220; // px de altura a los que la sombra ya no se ve
const MAX_RS = 40; // semieje máximo de una sombra
const SOMBRA = '#2a1f4e'; // violeta hondo de la paleta, nunca negro puro

export type Luces = {
  /** @internal */ n: number;
  /** @internal */ x: Float32Array;
  /** @internal */ y: Float32Array;
  /** @internal */ r: Float32Array;
  /** @internal */ edad: Float32Array;
  /** @internal */ vida: Float32Array;
  /** @internal */ col: Uint8Array;
  /** @internal */ sem: Uint8Array;
};

/* ── Sprites ────────────────────────────────────────────────────────────── */

const colores: string[] = [];
const indiceColor = new Map<string, number>();
function idColor(c: string): number {
  let i = indiceColor.get(c);
  if (i === undefined) {
    if (colores.length >= 255) return 0;
    i = colores.length;
    colores.push(c);
    indiceColor.set(c, i);
  }
  return i;
}

const sprLuz: (HTMLCanvasElement | undefined)[] = [];
/** Disco tramado: centro lleno, damero, borde a 25 %. `par` = fase de la trama. */
function halo(col: number, r: number, par: number): HTMLCanvasElement {
  const k = (col * (MAX_RL + 1) + r) * 2 + par;
  let s = sprLuz[k];
  if (!s) {
    s = document.createElement('canvas');
    s.width = s.height = 2 * r + 1;
    const g = s.getContext('2d')!;
    g.fillStyle = colores[col];
    const r1 = r * 0.4, r2 = r * 0.72;
    const rr = r * r + r * 0.6;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > rr) continue;
        const ch = (dx + dy + par) & 1;
        const d = Math.sqrt(d2);
        // 4×4: el borde solo enciende 1 de cada 4 (dos en diagonal).
        const cuarto = (dx & 1) === 0;
        if (d <= r1 || (d <= r2 && ch === 0) || (d > r2 && ch === 0 && cuarto)) g.fillRect(dx + r, dy + r, 1, 1);
      }
    sprLuz[k] = s;
  }
  return s;
}

const sprSombra: (HTMLCanvasElement | undefined)[] = [];
/** Elipse tramada: centro lleno, borde en damero. */
function elipse(rx: number, par: number): HTMLCanvasElement {
  const k = rx * 2 + par;
  let s = sprSombra[k];
  if (!s) {
    const ry = Math.max(1, Math.round(rx * 0.28));
    s = document.createElement('canvas');
    s.width = 2 * rx + 1;
    s.height = 2 * ry + 1;
    const g = s.getContext('2d')!;
    g.fillStyle = SOMBRA;
    for (let dy = -ry; dy <= ry; dy++)
      for (let dx = -rx; dx <= rx; dx++) {
        const u = (dx * dx) / (rx * rx + 0.5) + (dy * dy) / (ry * ry + 0.5);
        if (u > 1) continue;
        if (u < 0.45 || ((dx + dy + par) & 1) === 0) g.fillRect(dx + rx, dy + ry, 1, 1);
      }
    sprSombra[k] = s;
  }
  return s;
}

/* ── API ────────────────────────────────────────────────────────────────── */

let noche = 0;
/** 0 = día, 1 = noche cerrada / espacio: las luces crecen y pegan más fuerte. */
export function intensidadNoche(n: number): void {
  noche = Math.max(0, Math.min(1, n || 0));
}

export function crearLuces(): Luces {
  return {
    n: 0,
    x: new Float32Array(MAX_L),
    y: new Float32Array(MAX_L),
    r: new Float32Array(MAX_L),
    edad: new Float32Array(MAX_L),
    vida: new Float32Array(MAX_L),
    col: new Uint8Array(MAX_L),
    sem: new Uint8Array(MAX_L),
  };
}

let semilla = 1;
/**
 * Luz de corta vida en (x, y) del mundo: `radio` en px (≤ 48), `color` en
 * #rrggbb, `vida` en s. Para luces continuas (motor, nitro) llamar en cada
 * paso con una vida corta (~0,05 s). Siempre se dibuja al menos un cuadro.
 * Si no hay sitio, reemplaza a la más gastada.
 */
export function luz(L: Luces, x: number, y: number, radio: number, color: string, vida: number): void {
  let i = L.n;
  if (i >= MAX_L) {
    let peor = 0, pu = -1;
    for (let k = 0; k < MAX_L; k++) {
      const u = L.edad[k] / L.vida[k] + (L.r[k] < radio ? 0.25 : 0);
      if (u > pu) {
        pu = u;
        peor = k;
      }
    }
    i = peor;
  } else L.n++;
  semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
  L.x[i] = x;
  L.y[i] = y;
  L.r[i] = Math.max(1, Math.min(MAX_RL, radio));
  L.edad[i] = 0;
  L.vida[i] = Math.max(0.001, vida);
  L.col[i] = idColor(color);
  L.sem[i] = semilla >>> 24;
}

/** Envejece las luces; una luz se quita en el paso siguiente a cumplir su vida. */
export function pasoLuces(L: Luces, dt: number): void {
  for (let i = 0; i < L.n; ) {
    if (L.edad[i] >= L.vida[i]) {
      const u = --L.n;
      L.x[i] = L.x[u];
      L.y[i] = L.y[u];
      L.r[i] = L.r[u];
      L.edad[i] = L.edad[u];
      L.vida[i] = L.vida[u];
      L.col[i] = L.col[u];
      L.sem[i] = L.sem[u];
      continue;
    }
    L.edad[i] += dt;
    i++;
  }
}

/** Pinta todas las luces (sumando color). Llamar después de lo que iluminan. */
export function dibujarLuces(
  g: CanvasRenderingContext2D,
  L: Luces,
  toScreen: (x: number, y: number) => [number, number],
  t: number,
): void {
  if (L.n === 0 || typeof document === 'undefined') return;
  const op = g.globalCompositeOperation, alfa0 = g.globalAlpha;
  g.imageSmoothingEnabled = false;
  g.globalCompositeOperation = 'lighter';
  const W = g.canvas.width + MARGEN, H = g.canvas.height + MARGEN;
  const cuadro = Math.floor(t * 30);
  const base = 0.5 + 0.5 * noche, crece = 1 + 0.3 * noche;
  for (let i = 0; i < L.n; i++) {
    const u = Math.min(1, L.edad[i] / L.vida[i]);
    // Intensidad en pasos de 1/4; se apaga y encoge con la edad.
    const a = Math.ceil((1 - u * u) * 4) / 4;
    if (a <= 0) continue;
    const parpadeo = ((cuadro + L.sem[i]) & 3) === 0 ? 1 : 0;
    const r = Math.max(1, Math.min(MAX_RL, Math.round(L.r[i] * crece * (0.65 + 0.35 * (1 - u))) + parpadeo));
    const q = toScreen(L.x[i], L.y[i]);
    const x = Math.round(q[0]), y = Math.round(q[1]);
    if (x < -MARGEN || y < -MARGEN || x > W || y > H) continue;
    g.globalAlpha = alfa0 * a * base;
    g.drawImage(halo(L.col[i], r, (x + y) & 1), x - r, y - r);
  }
  g.globalCompositeOperation = op;
  g.globalAlpha = alfa0;
}

/** Nº de luces vivas (para depurar / medir). */
export function cuantasLuces(L: Luces): number {
  return L.n;
}

/**
 * Sombra tramada en el suelo / mar bajo algo que vuela: centrada en
 * (xPantalla, ySueloPantalla), `ancho` = envergadura en px, `altura` = px
 * entre la cosa y el suelo. Se achica y aclara al subir; nada sobre ~220 px.
 * Dibujar después del suelo y antes de vehículos / aviones.
 */
export function sombra(g: CanvasRenderingContext2D, xPantalla: number, ySueloPantalla: number, ancho: number, altura: number): void {
  if (typeof document === 'undefined') return;
  const k = Math.max(0, altura) / ALTURA_MAX;
  if (k >= 1) return;
  const rx = Math.min(MAX_RS, Math.round((ancho / 2) * (1 - 0.55 * k)));
  if (rx < 1) return;
  // Alfa en pasos de 1/4 del máximo (0,4), según la altura.
  const a = Math.ceil((1 - k) * 4) / 4;
  const x = Math.round(xPantalla), y = Math.round(ySueloPantalla);
  const s = elipse(rx, (x + y) & 1);
  const alfa0 = g.globalAlpha;
  g.globalAlpha = alfa0 * 0.4 * a;
  g.drawImage(s, x - rx, y - ((s.height - 1) >> 1));
  g.globalAlpha = alfa0;
}
