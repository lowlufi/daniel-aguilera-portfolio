import { tone } from '../game/dulce';
import { altoVista, anchoVista } from './lienzo';

/*
 * Estelas de misil en estilo «dulce»: pixel art pastel sin anti-aliasing.
 *
 * Cuatro capas, de atrás hacia adelante:
 *   1. Humo: bolitas redondas que nacen tibias, crecen, suben, derivan con el
 *      viento y ondulan. Al envejecer se encogen, se rompen en bolitas sueltas
 *      y se desvanecen con alfa en pasos de 1/4. Las bolitas opacas se pintan
 *      en dos pasadas (todos los contornos, luego todos los cuerpos) para que
 *      formen una sola nube con un único contorno de tono.
 *   2. Cinta de fuego: desde la tobera hacia atrás, gruesa y blanca junto al
 *      misil, que se afina pasando por `nucleo` y `brillo`.
 *   3. Chispas: estrellitas que saltan hacia atrás y caen con gravedad. Con
 *      `paleta` cada chispa toma un color (estelas de fuegos artificiales) y
 *      con `brillos` son purpurina: flotan, caen poco y titilan más rato.
 *   4. Fogonazo del motor que parpadea (con destello en cruz).
 * Con el motor apagado (o tras `soltar`) solo queda el humo. Con `arcoiris`
 * el humo va cambiando de color por la `paleta` (bandas de dos bolitas).
 *
 * Legibilidad: el humo va teñido del `brillo` de cada tipo (el jugador, dorado
 * tibio; cada enemigo, su color) y lleva un contorno de tono bien hondo para
 * leerse igual contra cielo de día, atardecer, noche, nubes, espacio o mar. Un
 * grosor mínimo evita estelas de 1–2 px que se pierden; MAX_R sigue tapando el
 * tamaño para no ocultar al avión.
 *
 * Coordenadas del mundo: x a la derecha, y = altitud hacia arriba.
 * Rendimiento: el estado vive en Float32Array de tamaño fijo por estela y no se
 * crean objetos por cuadro (salvo las tuplas que devuelva `aPantalla`). Cada
 * bolita es un solo drawImage de un sprite cacheado por paleta, etapa y radio.
 */

export type EstiloEstela = {
  /** Color caliente interior de la cinta de fuego (después del blanco). */
  nucleo: string;
  /** Color exterior de la cinta, del fogonazo y de las chispas. */
  brillo: string;
  /** Color pastel del humo. */
  humo: string;
  /** Diámetro máximo de una bolita de humo, en píxeles (máx. ~24). */
  ancho: number;
  /** Nº de puntos de humo (largo de la estela). Máximo 48. */
  largo: number;
  /** Chispas por segundo con el motor encendido. */
  chispas: number;
  /** Amplitud de la ondulación del humo, en píxeles. */
  ondula?: number;
  /**
   * Largo de la cinta de fuego respecto del normal (1): los cohetes de la
   * Segunda Guerra la llevan larga y desflecada, el crucero una llamita corta.
   */
  fuego?: number;
  /** Colores de las chispas (cada chispa toma uno) y, con `arcoiris`, del humo. */
  paleta?: string[];
  /** El humo cambia de color por la `paleta` a lo largo de la estela. */
  arcoiris?: boolean;
  /** Chispas de purpurina: flotan, caen poco y titilan más rato. */
  brillos?: boolean;
};

/** Misil del jugador: fuego blanco-dorado, humo dorado tibio. */
export const ESTELA_JUGADOR: EstiloEstela = {
  nucleo: '#fff6b0',
  brillo: '#ffb030',
  humo: '#ffe6a6',
  ancho: 10,
  largo: 32,
  chispas: 40,
  ondula: 1.5,
};

/** Misil enemigo por defecto: fuego rosa chicle, humo lila. */
export const ESTELA_ENEMIGA: EstiloEstela = {
  nucleo: '#ffe4f4',
  brillo: '#ff6eb4',
  humo: '#d4c4ff',
  ancho: 9,
  largo: 28,
  chispas: 26,
  ondula: 2,
};

/* ── Constantes ─────────────────────────────────────────────────────────── */

const INTERVALO = 0.045; // s entre muestras de humo
const MAX_PUNTOS = 60;
const VIDA_EXTRA = 1.3; // la estela dura un poco más que su `largo` nominal
const R_MIN = 1.5; // radio base mínimo del humo: finas, pero que no se pierdan
const MAX_CHISPAS = 16;
/** Con purpurina caben más (viven más). */
const MAX_BRILLOS = 28;
const GRAVEDAD_BRILLO = 22; // px/s² de la purpurina
/** Cuánto se exagera la ondulación del humo respecto de la amplitud de cada estilo. */
const ONDULA_MUL = 2.6;
const VIDA_FUEGO = 0.18; // s que un punto sigue siendo parte de la cinta de fuego
const COLA = 5; // px detrás del centro del misil donde está la tobera
const SUBE = 9; // px/s a los que tiende a subir el humo
const GRAVEDAD = 110; // px/s² de las chispas
const MAX_R = 8; // más grandes tapan al avión y a las amenazas
const MARGEN = 20; // px fuera de pantalla antes de descartar una bolita

// Campos de un punto de humo.
const PX = 0, PY = 1, PVX = 2, PVY = 3, PEDAD = 4, PRUMBO = 5, PSEMILLA = 6, PID = 7, PCOL = 8;
const PS = 9;
// Campos de una chispa.
const CX = 0, CY = 1, CVX = 2, CVY = 3, CEDAD = 4, CVIDA = 5, CCOL = 6;
const CS = 7;

// Tipos de sprite.
const HUMO_LINEA = 0, HUMO_CUERPO = 1, FUEGO_LINEA = 2, FUEGO_CUERPO = 3, CHISPA = 4, FOGONAZO = 5, HUMO_LUZ = 6;

type Paleta = {
  /** Por etapa (0 tibio, 1 humo, 2 pálido). */
  linea: string[];
  relleno: string[];
  luz: string[];
  fuegoLinea: string;
  brillo: string;
  nucleo: string;
  /** Sprites, índice ((tipo·4 + variante)·16 + radio). */
  spr: (HTMLCanvasElement | undefined)[];
  /** Una sub-paleta por color de `paleta` (chispas de colores, humo arcoíris). */
  subs: Paleta[];
};

export type Estela = {
  readonly estilo: EstiloEstela;
  /** @internal */ pal: Paleta;
  /** @internal */ cap: number;
  /** @internal */ vida: number;
  /** @internal */ p: Float32Array;
  /** @internal */ n: number; // puntos escritos (hasta cap)
  /** @internal */ cabeza: number; // índice del próximo punto a escribir
  /** @internal */ reloj: number; // tiempo desde la última muestra
  /** @internal */ c: Float32Array;
  /** @internal */ cn: number; // chispas vivas (compactas al inicio)
  /** @internal */ cAcum: number;
  /** @internal */ mx: number; // posición actual del misil
  /** @internal */ my: number;
  /** @internal */ mr: number;
  /** @internal */ encendido: boolean;
  /** @internal */ suelto: boolean;
  /** @internal */ semilla: number;
  /** @internal */ fase: number; // desfase fijo del parpadeo
  /** @internal */ cuenta: number; // nº de muestras emitidas
  /** @internal */ capC: number; // tope de chispas de esta estela
};

/* ── Sprites ────────────────────────────────────────────────────────────── */

/** Disco píxel a píxel igual a `disc` de dulce.ts, centrado en (c, c). */
function disco(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  if (r <= 0) {
    g.fillRect(cx, cy, 1, 1);
    return;
  }
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.min(r, Math.round(Math.sqrt(r * r - dy * dy + r * 0.6)));
    g.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}

function construir(pal: Paleta, tipo: number, v: number, r: number): HTMLCanvasElement {
  const R = tipo === HUMO_LINEA || tipo === FUEGO_LINEA ? r + 1 : tipo === FOGONAZO ? r + 4 : tipo === CHISPA ? 2 : r;
  const c = document.createElement('canvas');
  c.width = c.height = 2 * R + 1;
  const g = c.getContext('2d')!;
  switch (tipo) {
    case HUMO_LINEA:
      disco(g, R, R, r + 1, pal.linea[v]);
      break;
    case HUMO_CUERPO:
      disco(g, R, R, r, pal.relleno[v]);
      break;
    case HUMO_LUZ:
      disco(g, R, R, r, pal.luz[v]);
      break;
    case FUEGO_LINEA:
      disco(g, R, R, r + 1, pal.fuegoLinea);
      break;
    case FUEGO_CUERPO:
      disco(g, R, R, r, pal.brillo);
      if (v <= 1 && r >= 1) disco(g, R, R, r - 1, pal.nucleo);
      if (v === 0 && r >= 2) disco(g, R, R, r - 2, '#ffffff');
      // Junto a la tobera: núcleo blanco ancho, solo un aro de brillo afuera.
      if (v === 3) disco(g, R, R, Math.max(0, r - 1), '#ffffff');
      break;
    case CHISPA:
      if (v === 0) {
        // Estrellita: cruz de brillo con centro blanco y contorno de tono.
        g.fillStyle = pal.fuegoLinea;
        g.fillRect(0, 1, 5, 3);
        g.fillRect(1, 0, 3, 5);
        g.fillStyle = pal.brillo;
        g.fillRect(1, 2, 3, 1);
        g.fillRect(2, 1, 1, 3);
        g.fillStyle = '#ffffff';
        g.fillRect(2, 2, 1, 1);
      } else {
        g.fillStyle = pal.brillo;
        g.fillRect(1, 2, 3, 1);
        g.fillRect(2, 1, 1, 3);
        g.fillStyle = pal.nucleo;
        g.fillRect(2, 2, 1, 1);
      }
      break;
    case FOGONAZO: {
      disco(g, R, R, r + 1, pal.fuegoLinea);
      disco(g, R, R, r, pal.brillo);
      disco(g, R, R, r - 1, pal.nucleo);
      if (v === 1) {
        const l = r + 3;
        g.fillStyle = pal.nucleo;
        g.fillRect(R - l, R, l * 2 + 1, 1);
        g.fillRect(R, R - l, 1, l * 2 + 1);
        g.fillStyle = '#ffffff';
        g.fillRect(R - 1, R, 3, 1);
        g.fillRect(R, R - 1, 1, 3);
      }
      g.fillStyle = '#ffffff';
      g.fillRect(R - 1, R - 1, 2, 2);
      break;
    }
  }
  return c;
}

/** Dibuja el sprite (tipo, variante, radio) centrado en (x, y). */
function pon(g: CanvasRenderingContext2D, pal: Paleta, tipo: number, v: number, r: number, x: number, y: number) {
  if (r < 0) r = 0;
  else if (r > MAX_R) r = MAX_R;
  const k = ((tipo << 2) + v) * 16 + r;
  const s = pal.spr[k] ?? (pal.spr[k] = construir(pal, tipo, v, r));
  const o = (s.width - 1) >> 1;
  g.drawImage(s, x - o, y - o);
}

const paletas = new WeakMap<EstiloEstela, Paleta>();
function armarPaleta(humo: string, brillo: string, nucleo: string): Paleta {
  // Humo tibio (recién salido): bien teñido del brillo. Luego el humo con un
  // tinte del tipo (para reconocerlo) y al final pálido, pero nunca blanco.
  const etapas = [
    mezcla(humo, brillo, 0.7),
    mezcla(humo, brillo, 0.32),
    mezcla(mezcla(humo, '#ffffff', 0.3), brillo, 0.16),
  ];
  return {
    // Contorno hondo: es lo que separa la estela de un cielo claro o de nubes.
    linea: etapas.map((c, i) => tone(c, i === 2 ? -0.46 : -0.58)),
    relleno: etapas,
    luz: etapas.map((c) => tone(c, 0.6)),
    fuegoLinea: tone(brillo, -0.55),
    brillo,
    nucleo,
    spr: [],
    subs: [],
  };
}
function paleta(e: EstiloEstela): Paleta {
  let p = paletas.get(e);
  if (!p) {
    p = armarPaleta(e.humo, e.brillo, e.nucleo);
    // Cada color de la paleta: chispas de ese color y, en el arcoíris, humo
    // bien teñido (más color que el humo normal: se tiene que ver la franja).
    if (e.paleta) for (const c of e.paleta) p.subs.push(armarPaleta(e.arcoiris ? mezcla(e.humo, c, 0.45) : e.humo, c, mezcla(c, '#ffffff', 0.6)));
    paletas.set(e, p);
  }
  return p;
}

function mezcla(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  let out = '#';
  for (let s = 16; s >= 0; s -= 8) {
    const va = (pa >> s) & 255, vb = (pb >> s) & 255;
    out += Math.round(va + (vb - va) * k).toString(16).padStart(2, '0');
  }
  return out;
}

let semillaGlobal = 12345;
function azar(e: Estela) {
  e.semilla = (Math.imul(e.semilla, 1664525) + 1013904223) >>> 0;
  return e.semilla / 4294967296;
}

/* ── API ────────────────────────────────────────────────────────────────── */

export function crearEstela(estilo: EstiloEstela): Estela {
  const cap = Math.max(4, Math.min(MAX_PUNTOS, Math.floor(estilo.largo * VIDA_EXTRA)));
  semillaGlobal = (Math.imul(semillaGlobal, 69069) + 1) >>> 0;
  return {
    estilo,
    pal: paleta(estilo),
    cap,
    vida: cap * INTERVALO,
    p: new Float32Array(cap * PS),
    n: 0,
    cabeza: 0,
    reloj: INTERVALO,
    c: new Float32Array((estilo.brillos ? MAX_BRILLOS : MAX_CHISPAS) * CS),
    cn: 0,
    cAcum: 0,
    mx: 0,
    my: 0,
    mr: 0,
    encendido: false,
    suelto: false,
    semilla: semillaGlobal,
    fase: semillaGlobal & 7,
    cuenta: 0,
    capC: estilo.brillos ? MAX_BRILLOS : MAX_CHISPAS,
  };
}

/**
 * Llamar en cada paso con la posición (centro) y rumbo del misil. Muestrea humo
 * a su propio intervalo y lanza chispas mientras el motor está encendido.
 */
export function empujarPunto(e: Estela, x: number, y: number, rumbo: number, motorEncendido: boolean, dt: number): void {
  if (e.suelto) return;
  const cs = Math.cos(rumbo), sn = Math.sin(rumbo);
  const tx = x - cs * COLA, ty = y - sn * COLA;
  e.mx = x;
  e.my = y;
  e.mr = rumbo;
  e.encendido = motorEncendido;
  if (!motorEncendido) {
    e.reloj = INTERVALO;
    return;
  }
  e.reloj += dt;
  if (e.reloj >= INTERVALO) {
    e.reloj = e.reloj % INTERVALO;
    const o = e.cabeza * PS, p = e.p;
    const esc = 22 + azar(e) * 10, lado = (azar(e) - 0.5) * 12;
    p[o + PX] = tx;
    p[o + PY] = ty;
    p[o + PVX] = -cs * esc - sn * lado;
    p[o + PVY] = -sn * esc + cs * lado;
    p[o + PEDAD] = 0;
    p[o + PRUMBO] = rumbo;
    p[o + PSEMILLA] = azar(e) * 6.283;
    p[o + PID] = e.cuenta & 1023;
    // arcoíris: franjas de dos bolitas que recorren la paleta
    p[o + PCOL] = e.pal.subs.length ? (e.cuenta >> 1) % e.pal.subs.length : 0;
    e.cuenta++;
    e.cabeza = (e.cabeza + 1) % e.cap;
    if (e.n < e.cap) e.n++;
  }
  // Chispas.
  // misiles.ts da «chispas por frame» (0–3); aquí son por segundo.
  const ritmo = e.estilo.chispas < 6 ? e.estilo.chispas * 12 : e.estilo.chispas;
  e.cAcum += ritmo * dt;
  while (e.cAcum >= 1) {
    e.cAcum -= 1;
    if (e.cn >= e.capC) continue;
    const o = e.cn++ * CS, c = e.c;
    const brillo = e.estilo.brillos;
    const v = (brillo ? 15 : 30) + azar(e) * 50, l = (azar(e) - 0.5) * (brillo ? 90 : 70);
    c[o + CX] = tx;
    c[o + CY] = ty;
    c[o + CVX] = -cs * v - sn * l;
    c[o + CVY] = -sn * v + cs * l + 15;
    c[o + CEDAD] = 0;
    c[o + CVIDA] = brillo ? 0.55 + azar(e) * 0.6 : 0.25 + azar(e) * 0.35;
    // color: uno de la paleta (o el brillo del tipo, -1)
    c[o + CCOL] = e.pal.subs.length && azar(e) < 0.8 ? Math.floor(azar(e) * e.pal.subs.length) : -1;
  }
}

/** Avanza el humo (sube, se expande, deriva con `viento` en px/s) y las chispas. */
export function actualizarEstela(e: Estela, dt: number, viento: number): void {
  const p = e.p;
  const kv = Math.min(1, 2.2 * dt);
  for (let i = 0; i < e.n; i++) {
    const o = i * PS;
    if (p[o + PEDAD] >= e.vida) continue;
    p[o + PEDAD] += dt;
    p[o + PVX] += (viento - p[o + PVX]) * kv;
    p[o + PVY] += (SUBE - p[o + PVY]) * kv;
    p[o + PX] += p[o + PVX] * dt;
    p[o + PY] += p[o + PVY] * dt;
  }
  const c = e.c;
  for (let i = 0; i < e.cn; ) {
    const o = i * CS;
    c[o + CEDAD] += dt;
    if (c[o + CEDAD] >= c[o + CVIDA]) {
      // Quitar intercambiando con la última.
      const u = --e.cn * CS;
      for (let k = 0; k < CS; k++) c[o + k] = c[u + k];
      continue;
    }
    c[o + CVY] -= (e.estilo.brillos ? GRAVEDAD_BRILLO : GRAVEDAD) * dt;
    c[o + CVX] *= 1 - (e.estilo.brillos ? 2.4 : 1.5) * dt;
    if (e.estilo.brillos) c[o + CVY] *= 1 - 1.2 * dt;
    c[o + CX] += c[o + CVX] * dt;
    c[o + CY] += c[o + CVY] * dt;
    i++;
  }
}

/** El misil murió: la estela deja de crecer y se desvanece sola. */
export function soltar(e: Estela): void {
  e.suelto = true;
  e.encendido = false;
}

/** false cuando la estela ya se desvaneció del todo (se puede borrar). */
export function viva(e: Estela): boolean {
  if (!e.suelto) return true;
  if (e.cn > 0) return true;
  for (let i = 0; i < e.n; i++) if (e.p[i * PS + PEDAD] < e.vida) return true;
  return false;
}

/* ── Dibujo ─────────────────────────────────────────────────────────────── */

// Búfer de trabajo compartido: bolitas de humo ya resueltas en pantalla.
const MAX_B = MAX_PUNTOS * 4;
const bX = new Int16Array(MAX_B), bY = new Int16Array(MAX_B), bR = new Int8Array(MAX_B);
const bE = new Int8Array(MAX_B), bA = new Int8Array(MAX_B), bL = new Int8Array(MAX_B), bC = new Int8Array(MAX_B);
// Polilínea de la cinta de fuego (mundo y luego pantalla).
const MAX_F = 12;
const fX = new Float32Array(MAX_F), fY = new Float32Array(MAX_F);

export function dibujarEstela(
  g: CanvasRenderingContext2D,
  e: Estela,
  aPantalla: (x: number, y: number) => [number, number],
  t: number,
): void {
  const p = e.p, pal = e.pal;
  // Estelas finas: el humo nace delgado (los colores y la ondulación siguen igual de vivos).
  const rb = Math.min(MAX_R - 2, Math.max(R_MIN, e.estilo.ancho * 0.38));
  const amp = e.estilo.ondula ?? 0;
  const alfa0 = g.globalAlpha;
  const W = anchoVista(g) + MARGEN, H = altoVista(g) + MARGEN;
  g.imageSmoothingEnabled = false;

  const arco = e.estilo.arcoiris && pal.subs.length > 0;
  // 1) Resolver las bolitas de humo, de la más vieja a la más nueva.
  let nb = 0, px = 0, py = 0, pr = -1, pe = 0, pc = 0;
  for (let k = e.n - 1; k >= 0; k--) {
    const o = ((e.cabeza - 1 - k + e.cap) % e.cap) * PS;
    const edad = p[o + PEDAD];
    if (edad >= e.vida) {
      pr = -1;
      continue;
    }
    const u = edad / e.vida;
    const a = u < 0.6 ? 4 : u < 0.75 ? 3 : u < 0.88 ? 2 : 1;
    // Al desvanecerse, el humo se rompe en bolitas sueltas (una de cada dos).
    if (a < 4 && p[o + PID] % 2) {
      pr = -1;
      continue;
    }
    let r = rb * (0.4 + 0.75 * Math.min(1, u * 3.5));
    if (u > 0.62) r *= 1 - ((u - 0.62) / 0.38) * 0.75;
    // Ondulación perpendicular al rumbo con el que nació: bien visible, crece a medida
    // que el humo envejece y se abre, con ondas largas que se mecen como una serpiente.
    const w = amp * ONDULA_MUL * Math.min(1, u * 4) * (0.55 + 1.3 * u) * Math.sin(p[o + PSEMILLA] + edad * 4 + k * 0.32);
    const rm = p[o + PRUMBO];
    const q = aPantalla(p[o + PX] - Math.sin(rm) * w, p[o + PY] + Math.cos(rm) * w);
    const sx = Math.round(q[0]), sy = Math.round(q[1]);
    if (sx < -MARGEN || sy < -MARGEN || sx > W || sy > H) {
      pr = -1;
      continue;
    }
    const ri = Math.round(r);
    const et = u < 0.12 ? 0 : u < 0.45 ? 1 : 2;
    const col = arco ? p[o + PCOL] : 0;
    if (pr >= 0 && a === 4 && k > 0) {
      const dx = sx - px, dy = sy - py;
      const d = Math.abs(dx) + Math.abs(dy);
      // Misil lento: bolitas muy juntas; se salta las que no aportan.
      if (d < Math.max(2, ri * 0.7)) continue;
      // Misil rápido: se rellenan los huecos con bolitas intermedias.
      const m = Math.min(3, Math.ceil(d / Math.max(2, Math.min(ri, pr) * 1.7)) - 1);
      for (let j = 1; j <= m && nb < MAX_B; j++) {
        const f = j / (m + 1);
        bX[nb] = Math.round(px + dx * f);
        bY[nb] = Math.round(py + dy * f);
        bR[nb] = Math.round(pr + (ri - pr) * f);
        bE[nb] = f < 0.5 ? pe : et;
        bA[nb] = 4;
        bL[nb] = 0;
        bC[nb] = f < 0.5 ? pc : col;
        nb++;
      }
    }
    if (nb < MAX_B) {
      bX[nb] = sx;
      bY[nb] = sy;
      bR[nb] = ri;
      bE[nb] = et;
      bA[nb] = a;
      bL[nb] = p[o + PID] % 2 ? 0 : 1;
      bC[nb] = col;
      nb++;
    }
    px = sx;
    py = sy;
    pr = ri;
    pe = et;
    pc = col;
  }

  // 1a) Humo que se desvanece: bolitas sueltas con su alfa (detrás).
  for (let i = 0; i < nb; i++) {
    const a = bA[i];
    if (a === 4) continue;
    g.globalAlpha = alfa0 * a * 0.25;
    const q = arco ? pal.subs[bC[i]] : pal;
    pon(g, q, HUMO_LINEA, bE[i], bR[i], bX[i], bY[i]);
    pon(g, q, HUMO_CUERPO, bE[i], bR[i], bX[i], bY[i]);
  }
  g.globalAlpha = alfa0;
  // 1b) Humo opaco: todos los contornos, luego todos los cuerpos y por último
  // los brillos (uno de cada dos puntos: lomitos de nube, no una oruga).
  for (let i = 0; i < nb; i++) if (bA[i] === 4) pon(g, arco ? pal.subs[bC[i]] : pal, HUMO_LINEA, bE[i], bR[i], bX[i], bY[i]);
  for (let i = 0; i < nb; i++) if (bA[i] === 4) pon(g, arco ? pal.subs[bC[i]] : pal, HUMO_CUERPO, bE[i], bR[i], bX[i], bY[i]);
  for (let i = 0; i < nb; i++)
    if (bA[i] === 4 && bL[i] && bR[i] >= 3) pon(g, arco ? pal.subs[bC[i]] : pal, HUMO_LUZ, bE[i], bR[i] - 2, bX[i] - 1, bY[i] - 1);

  const motor = e.encendido && !e.suelto;
  const parpadeo = (Math.floor(t * 30) + e.fase) % 3;
  const cs = Math.cos(e.mr), sn = Math.sin(e.mr);

  // 2) Cinta de fuego: sigue la estela reciente y, si es corta, se prolonga
  // hacia atrás por el rumbo para tener siempre el mismo largo.
  if (motor) {
    const largoMax = (16 + rb * 2.4 + parpadeo * 3) * (e.estilo.fuego ?? 1);
    fX[0] = e.mx - cs * COLA;
    fY[0] = e.my - sn * COLA;
    let fn = 1, total = 0;
    for (let k = 0; k < e.n && fn < MAX_F - 1 && total < largoMax; k++) {
      const o = ((e.cabeza - 1 - k + e.cap) % e.cap) * PS;
      if (p[o + PEDAD] > VIDA_FUEGO) break;
      fX[fn] = p[o + PX];
      fY[fn] = p[o + PY];
      total += Math.hypot(fX[fn] - fX[fn - 1], fY[fn] - fY[fn - 1]);
      fn++;
    }
    if (total < largoMax) {
      const rest = largoMax - total;
      fX[fn] = fX[fn - 1] - cs * rest;
      fY[fn] = fY[fn - 1] - sn * rest;
      fn++;
    }
    for (let j = 0; j < fn; j++) {
      const q = aPantalla(fX[j], fY[j]);
      fX[j] = q[0];
      fY[j] = q[1];
    }
    const r0 = Math.max(2, rb * 0.72);
    for (let pasada = 0; pasada < 2; pasada++) {
      let rec = 0;
      for (let j = 1; j < fn && rec < largoMax; j++) {
        const ax = fX[j - 1], ay = fY[j - 1];
        const dx = fX[j] - ax, dy = fY[j] - ay;
        const d = Math.hypot(dx, dy);
        let s = 0;
        while (s < d && rec < largoMax) {
          const u = rec / largoMax;
          const r = Math.round(r0 * (1 - u * 0.8) + (u < 0.2 ? parpadeo * 0.4 : 0));
          const x = Math.round(ax + (dx * s) / d), y = Math.round(ay + (dy * s) / d);
          if (pasada === 0) pon(g, pal, FUEGO_LINEA, 0, r, x, y);
          else pon(g, pal, FUEGO_CUERPO, u < 0.22 ? 3 : u < 0.5 ? 0 : u < 0.72 ? 1 : 2, r, x, y);
          const paso = Math.max(2, r * 1.25);
          s += paso;
          rec += paso;
        }
      }
    }
  }

  // 3) Chispas (siguen aunque el motor se apague, hasta que caen).
  const c = e.c;
  const brillos = e.estilo.brillos;
  const tic = Math.floor(t * 20);
  for (let i = 0; i < e.cn; i++) {
    const o = i * CS;
    const u = c[o + CEDAD] / c[o + CVIDA];
    const q = aPantalla(c[o + CX], c[o + CY]);
    const x = Math.round(q[0]), y = Math.round(q[1]);
    const k = c[o + CCOL];
    const cp = k >= 0 && k < pal.subs.length ? pal.subs[k] : pal;
    if (brillos) {
      // purpurina: titila entre estrellita, punto blanco y nada
      const f = (tic + i * 3) % 4;
      if (u < 0.5 && f < 2) pon(g, cp, CHISPA, f === 0 ? 0 : 1, 0, x, y);
      else if (f !== 3) {
        g.fillStyle = f === 2 ? '#ffffff' : cp.brillo;
        g.fillRect(x, y, 1, 1);
      }
    } else if (u < 0.35) pon(g, cp, CHISPA, 0, 0, x, y);
    else if (u < 0.7) pon(g, cp, CHISPA, 1, 0, x, y);
    else if ((tic + i) % 2) {
      g.fillStyle = cp.brillo;
      g.fillRect(x, y, 1, 1);
    }
  }

  // 4) Fogonazo del motor.
  if (motor) {
    const q = aPantalla(e.mx - cs * (COLA + 2), e.my - sn * (COLA + 2));
    const f = (Math.floor(t * 24) + e.fase) % 4;
    const r = 3 + (f === 0 ? 1 : 0) + Math.round(rb / 5);
    pon(g, pal, FOGONAZO, f === 0 || f === 2 ? 1 : 0, r, Math.round(q[0]), Math.round(q[1]));
  }
}
