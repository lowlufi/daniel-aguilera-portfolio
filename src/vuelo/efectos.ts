import { tone } from '../game/dulce';

/*
 * Efectos «dulces»: explosiones, escombros, fuego y humo en pixel art pastel,
 * sin anti-aliasing (1 unidad = 1 px virtual) y con alfa en pasos de 1/4.
 *
 * Una explosión se arma en capas, todas escaladas con W = E^(1/3) (Hopkinson):
 *   · destello blanco de 1–3 cuadros (con rayos en cruz si es grande)
 *   · anillo de onda expansiva que se abre rápido (y otro plano si toca suelo)
 *   · bola de fuego: bolitas que nacen blancas y se enfrían
 *     blanco → amarillo → naranja → rosa → humo tibio → humo, crecen, suben y
 *     derivan con el viento; las grandes tienen «estallidos» secundarios
 *   · chispas brillantes con cola, que caen con gravedad
 *   · escombros que salen girando con estelita de humo y rebotan en el suelo
 *   · humo que queda flotando; hongo / columna si es grande; polvo si `suelo`
 *
 * Todas las bolitas de un grupo (humo / fuego) se pintan en pasadas: todos los
 * contornos, luego todos los cuerpos, luego los brillos, así una nube de muchas
 * bolitas tiene un único contorno de tono (como estelas.ts).
 *
 * Rendimiento: una sola reserva de partículas en arreglos tipados de tamaño
 * fijo (sin objetos por cuadro), sprites cacheados por color/tipo/radio, y
 * límite duro: si la reserva se llena, se recortan primero chispas y estelitas,
 * y las bolitas importantes pueden reciclar una chispa.
 *
 * Coordenadas del mundo: x a la derecha, y = altitud hacia arriba.
 */

/* ── Constantes ─────────────────────────────────────────────────────────── */

const MAX_P = 900; // partículas (bolitas + chispas + escombros)
const MAX_O = 48; // ondas y destellos
const MAX_PIEZAS = 6;
const MAX_RESTOS = 8;
const MAX_R = 24; // radio máximo de una bolita en sprite
const MAX_RA = 64; // radio máximo de un anillo
const MARGEN = 32;
const G_CHISPA = 150; // px/s²
const G_ESCOMBRO = 170;
const G_PIEZA = 140;

// Tipos de partícula.
const T_BOLA = 0, T_CHISPA = 1, T_ESCOMBRO = 2;
// Paletas calientes (secuencia de enfriamiento).
const F_FUEGO = 0, F_CHISPA = 1, F_AGUA = 2, F_NADA = 3;

// Colores de bolita: [cuerpo, contorno, brillo]. El contorno es siempre un
// tono más hondo del mismo color, nunca negro.
const C_BLANCO = 0, C_AMARILLO = 1, C_NARANJA = 2, C_ROSA = 3, C_TIBIO = 4, C_HUMO = 5, C_CLARO = 6;
const C_NEGRO = 7, C_POLVO = 8, C_AGUA = 9, C_ESPUMA = 10, C_CIAN = 11, C_LILA = 12;
const COLORES: [string, string, string][] = [
  ['#ffffff', '#ffd860', '#ffffff'],
  ['#ffe048', '#f08a20', '#fff6b0'],
  ['#ff9a3c', '#d8503a', '#ffc47a'],
  ['#ff7090', '#b03a6a', '#ffb0c4'],
  ['#c88aa8', '#84507e', '#ecb4cc'],
  ['#9a8ab8', '#5e4e84', '#bcb0d8'],
  ['#e0d8f0', '#9a8ec4', '#fbf8ff'],
  ['#64547e', '#3c3058', '#80709a'],
  ['#f6e2c8', '#cca482', '#fffaf0'],
  ['#74ccf8', '#2a78c8', '#bdf0ff'],
  ['#e8faff', '#78b8e8', '#ffffff'],
  ['#a4f2ff', '#3aa0d0', '#e4ffff'],
  ['#dca4ff', '#8a4ac8', '#f2dcff'],
];
// Secuencias de enfriamiento de cada paleta caliente.
const CALIENTE: number[][] = [
  [C_BLANCO, C_AMARILLO, C_NARANJA, C_ROSA],
  [C_BLANCO, C_CIAN, C_LILA, C_ROSA],
  [C_BLANCO, C_ESPUMA, C_AGUA, C_AGUA],
  [C_CLARO, C_CLARO, C_CLARO, C_CLARO],
];
// Cortes (fracción de la parte caliente) entre las etapas de la secuencia.
const CORTE0 = 0.14, CORTE1 = 0.42, CORTE2 = 0.78;
// Colores de las chispas por paleta: [cabeza, cola].
const CHISPAS: [string, string, string][] = [
  ['#ffffff', '#ffe048', '#ff9a3c'],
  ['#ffffff', '#a4f2ff', '#dca4ff'],
  ['#ffffff', '#bdf0ff', '#74ccf8'],
  ['#ffffff', '#e0d8f0', '#9a8ab8'],
];
// Escombros: [cuerpo, sombra].
const ESCOMBROS: [string, string][] = [
  ['#c8d0e8', '#5a6488'],
  ['#d08440', '#8a4a1e'],
  ['#f08a94', '#b04a5a'],
  ['#9a8ed8', '#5a4a96'],
  ['#ffe048', '#e08a10'],
];
const TIERRA: [string, string][] = [
  ['#e08a5a', '#9a4a32'],
  ['#3cbc5a', '#1f8a4c'],
  ['#c8706e', '#7a3a4a'],
];

export type OpcionesExplosion = { suelo?: boolean; color?: 'fuego' | 'humo' | 'chispa' | 'agua' };

type Pieza = {
  activa: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  giro: number;
  edad: number;
  ac: number;
  n: number;
  spr: HTMLCanvasElement[] | null; // 16 rotaciones
};

type Resto = { activo: boolean; x: number; y: number; ancho: number; edad: number; vida: number; acF: number; acH: number };

export type Efectos = {
  /** @internal */ n: number;
  /** @internal */ x: Float32Array;
  /** @internal */ y: Float32Array;
  /** @internal */ vx: Float32Array;
  /** @internal */ vy: Float32Array;
  /** @internal */ edad: Float32Array;
  /** @internal */ vida: Float32Array;
  /** @internal */ r0: Float32Array;
  /** @internal */ r1: Float32Array;
  /** @internal */ arr: Float32Array; // arrastre (1/s)
  /** @internal */ sube: Float32Array; // velocidad vertical a la que tiende
  /** @internal */ calor: Float32Array; // fracción de la vida que pasa caliente
  /** @internal */ ini: Float32Array; // etapa caliente inicial (0…1)
  /** @internal */ ac: Float32Array; // acumulador de estelita (escombros)
  /** @internal */ tipo: Uint8Array;
  /** @internal */ pal: Uint8Array; // paleta caliente / colores de chispa o escombro
  /** @internal */ humo: Uint8Array; // color del humo
  /** @internal */ sem: Uint8Array;
  /** @internal */ reb: Uint8Array; // rebotes (escombros) / ardiendo
  /** @internal */ on: number;
  /** @internal */ ox: Float32Array;
  /** @internal */ oy: Float32Array;
  /** @internal */ oedad: Float32Array;
  /** @internal */ ovida: Float32Array;
  /** @internal */ or0: Float32Array;
  /** @internal */ or1: Float32Array;
  /** @internal */ otipo: Uint8Array; // 0/1 anillo fino/grueso, 2 destello, 3 con rayos, 4 plano, 5/6 cúpula fina/gruesa
  /** @internal */ piezas: Pieza[];
  /** @internal */ restos: Resto[];
  /** @internal */ sacudida: number;
  /** @internal */ destello: number;
  /** @internal */ dt: number;
  /** @internal */ semilla: number;
  /** @internal */ suelo: ((x: number) => number) | null;
};

/* ── Sprites ────────────────────────────────────────────────────────────── */

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

function lienzo(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/*
 * Atlas: todas las bolitas y chispas viven en unas pocas hojas grandes, así
 * el navegador agrupa los drawImage de la misma textura. Se llena una sola vez
 * (`precalentar`) para que no haya tirones al crear sprites en pleno combate.
 */
type Spr = { h: HTMLCanvasElement; x: number; y: number; w: number; a: number; o: number };
const HOJA = 1024;
const hojas: HTMLCanvasElement[] = [];
let hx = 0, hy = 0, hfila = 0;
function reservar(w: number, a: number, pinta: (g: CanvasRenderingContext2D, x: number, y: number) => void): Spr {
  if (hx + w + 1 > HOJA) {
    hx = 0;
    hy += hfila + 1;
    hfila = 0;
  }
  if (!hojas.length || hy + a + 1 > HOJA) {
    hojas.push(lienzo(HOJA, HOJA));
    hx = hy = hfila = 0;
  }
  const h = hojas[hojas.length - 1];
  const s: Spr = { h, x: hx, y: hy, w, a, o: (w - 1) >> 1 };
  pinta(h.getContext('2d')!, hx, hy);
  hx += w + 1;
  hfila = Math.max(hfila, a);
  return s;
}

const K_CUERPO = 0, K_LINEA = 1, K_LUZ = 2, K_JUNTO = 3; // 0–2 = índice en COLORES; 3 = contorno + cuerpo
const sprBola: (Spr | undefined)[] = [];
/** Sprite de bolita (color, clase, radio), cacheado en el atlas. */
function bola(col: number, k: number, r: number): Spr {
  const i = (col * 4 + k) * (MAX_R + 1) + r;
  let s = sprBola[i];
  if (!s) {
    const R = k === K_LINEA || k === K_JUNTO ? r + 1 : r;
    s = reservar(2 * R + 1, 2 * R + 1, (g, x, y) => {
      if (k === K_JUNTO) {
        disco(g, x + R, y + R, R, COLORES[col][K_LINEA]);
        disco(g, x + R, y + R, r, COLORES[col][K_CUERPO]);
      } else disco(g, x + R, y + R, R, COLORES[col][k]);
    });
    sprBola[i] = s;
  }
  return s;
}

// Chispas: cola + cabeza en un solo sprite, por paleta, edad (0 joven, 1
// madura), dirección (16) y largo (0–5).
const sprChispa: (Spr | undefined)[] = [];
function chispaSpr(pal: number, edad: number, dir: number, largo: number): Spr {
  const i = ((pal * 2 + edad) * 16 + dir) * 6 + largo;
  let s = sprChispa[i];
  if (!s) {
    const cs = CHISPAS[pal];
    const a = (dir / 16) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    s = reservar(13, 13, (g, x, y) => {
      const c = x + 6, d = y + 6;
      g.fillStyle = edad === 0 ? cs[1] : cs[2];
      for (let k = 1; k <= largo; k++) g.fillRect(c + Math.round(dx * k), d + Math.round(dy * k), 1, 1);
      g.fillStyle = cs[0];
      if (edad === 0) g.fillRect(c - 1, d - 1, 2, 2);
      else g.fillRect(c, d, 1, 1);
    });
    sprChispa[i] = s;
  }
  return s;
}

let calentado = false;
function precalentar() {
  if (calentado || typeof document === 'undefined') return;
  calentado = true;
  for (let col = 0; col < COLORES.length; col++)
    for (let k = 0; k < 4; k++) for (let r = 0; r <= MAX_R; r++) bola(col, k, r);
  for (let p = 0; p < CHISPAS.length; p++)
    for (let e = 0; e < 2; e++) for (let d = 0; d < 16; d++) for (let l = 0; l < 6; l++) chispaSpr(p, e, d, l);
}

const sprAnillo: (HTMLCanvasElement | undefined)[] = [];
/** Anillo de onda: tipo 0 redondo, 1 plano (sobre el suelo), 2 cúpula (solo mitad de arriba); grosor 1–2. */
function anillo(tipo: number, r: number, grueso: number): HTMLCanvasElement {
  const i = ((tipo * 2 + grueso - 1) * (MAX_RA + 1)) + r;
  let s = sprAnillo[i];
  if (!s) {
    const ry = tipo === 1 ? Math.max(2, Math.round(r * 0.3)) : r;
    s = lienzo(2 * r + 3, 2 * ry + 3);
    const g = s.getContext('2d')!;
    const ancho = (rx: number, ryy: number, dy: number) =>
      Math.abs(dy) > ryy ? -1 : Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ryy * ryy + ryy * 0.6))));
    const cx = r + 1, cy = ry + 1;
    // Contorno exterior pálido, cuerpo blanco.
    for (let pasada = 0; pasada < 2; pasada++) {
      const e = pasada === 0 ? 1 : 0;
      g.fillStyle = pasada === 0 ? '#fff0b8' : '#ffffff';
      const rxo = r + e, ryo = ry + e;
      const rxi = r - grueso - e, ryi = Math.max(0, ry - grueso - e);
      for (let dy = -ryo; dy <= (tipo === 2 ? 0 : ryo); dy++) {
        const wo = ancho(rxo, ryo, dy);
        const wi = rxi < 0 ? -1 : ancho(rxi, ryi, dy);
        if (wo < 0) continue;
        if (wi < 0) g.fillRect(cx - wo, cy + dy, wo * 2 + 1, 1);
        else {
          g.fillRect(cx - wo, cy + dy, wo - wi, 1);
          g.fillRect(cx + wi + 1, cy + dy, wo - wi, 1);
        }
      }
    }
    sprAnillo[i] = s;
  }
  return s;
}

const piezasPorColor = new Map<string, HTMLCanvasElement>();
/** Ala genérica cuando la pieza no trae sprite. */
function piezaGenerica(color: string): HTMLCanvasElement {
  let s = piezasPorColor.get(color);
  if (!s) {
    s = lienzo(12, 6);
    const g = s.getContext('2d')!;
    const linea = tone(color, -0.45), luz = tone(color, 0.5);
    g.fillStyle = linea;
    g.fillRect(1, 1, 10, 4);
    g.fillRect(0, 2, 12, 2);
    g.fillStyle = color;
    g.fillRect(1, 2, 10, 2);
    g.fillRect(2, 1, 7, 1);
    g.fillStyle = luz;
    g.fillRect(2, 2, 6, 1);
    // Borde roto con un mordisco.
    g.clearRect(10, 1, 2, 1);
    g.clearRect(11, 4, 1, 1);
    piezasPorColor.set(color, s);
  }
  return s;
}

const rotaciones = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
/** 16 rotaciones del sprite, vecino más cercano (píxeles nítidos). */
function rotar(src: HTMLCanvasElement): HTMLCanvasElement[] {
  let out = rotaciones.get(src);
  if (out) return out;
  out = [];
  const w = src.width, h = src.height;
  let datos: Uint8ClampedArray | null = null;
  try {
    datos = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  } catch {
    datos = null;
  }
  const D = Math.ceil(Math.hypot(w, h)) + 2;
  for (let k = 0; k < 16; k++) {
    const c = lienzo(D, D);
    const g = c.getContext('2d')!;
    if (!datos) {
      g.imageSmoothingEnabled = false;
      g.translate(D / 2, D / 2);
      g.rotate((-k * Math.PI) / 8);
      g.drawImage(src, -w / 2, -h / 2);
    } else {
      const img = g.createImageData(D, D);
      const a = (k * Math.PI) / 8, cs = Math.cos(a), sn = Math.sin(a);
      for (let py = 0; py < D; py++)
        for (let px = 0; px < D; px++) {
          const dx = px + 0.5 - D / 2, dy = py + 0.5 - D / 2;
          // Rotación de pantalla (y hacia abajo): ángulo positivo = antihorario visto.
          const sx = Math.floor(cs * dx - sn * dy + w / 2), sy = Math.floor(sn * dx + cs * dy + h / 2);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          const o = (sy * w + sx) * 4, d = (py * D + px) * 4;
          if (datos[o + 3] < 128) continue;
          img.data[d] = datos[o];
          img.data[d + 1] = datos[o + 1];
          img.data[d + 2] = datos[o + 2];
          img.data[d + 3] = 255;
        }
      g.putImageData(img, 0, 0);
    }
    out.push(c);
  }
  rotaciones.set(src, out);
  return out;
}

/* ── Reserva ────────────────────────────────────────────────────────────── */

export function crearEfectos(): Efectos {
  precalentar();
  const f = () => new Float32Array(MAX_P);
  const u = () => new Uint8Array(MAX_P);
  const fo = () => new Float32Array(MAX_O);
  const piezas: Pieza[] = [];
  for (let i = 0; i < MAX_PIEZAS; i++) piezas.push({ activa: false, x: 0, y: 0, vx: 0, vy: 0, ang: 0, giro: 0, edad: 0, ac: 0, n: 0, spr: null });
  const restos: Resto[] = [];
  for (let i = 0; i < MAX_RESTOS; i++) restos.push({ activo: false, x: 0, y: 0, ancho: 0, edad: 0, vida: 0, acF: 0, acH: 0 });
  return {
    n: 0,
    x: f(), y: f(), vx: f(), vy: f(), edad: f(), vida: f(), r0: f(), r1: f(), arr: f(), sube: f(), calor: f(), ini: f(), ac: f(),
    tipo: u(), pal: u(), humo: u(), sem: u(), reb: u(),
    on: 0,
    ox: fo(), oy: fo(), oedad: fo(), ovida: fo(), or0: fo(), or1: fo(), otipo: new Uint8Array(MAX_O),
    piezas,
    restos,
    sacudida: 0,
    destello: 0,
    dt: 1 / 60,
    semilla: (Math.random() * 4294967296) >>> 0,
    suelo: null,
  };
}

const azar = Math.random;
const entre = (a: number, b: number) => a + (b - a) * azar();

/**
 * Reserva una partícula. Prioridad 0 = descartable (chispa, estelita), 1 =
 * importante (bola de fuego, humo): si no hay sitio, recicla una chispa.
 */
function nueva(e: Efectos, prio: number): number {
  if (e.n < MAX_P) return e.n++;
  if (prio === 0) return -1;
  const ini = (azar() * MAX_P) | 0;
  for (let k = 0; k < 96; k++) {
    const i = (ini + k * 7) % MAX_P;
    if (e.tipo[i] === T_CHISPA || (e.tipo[i] === T_BOLA && e.r1[i] <= 2)) return i;
  }
  return -1;
}

/** Fracción de llenado → factor para lo descartable (degradación suave). */
function holgura(e: Efectos) {
  const c = e.n / MAX_P;
  return c < 0.45 ? 1 : Math.max(0.15, 1 - (c - 0.45) * 1.7);
}

function bolita(
  e: Efectos, prio: number, x: number, y: number, vx: number, vy: number,
  vida: number, r0: number, r1: number, arr: number, sube: number,
  pal: number, calor: number, ini: number, humo: number, retraso: number,
): number {
  const i = nueva(e, prio);
  if (i < 0) return -1;
  e.tipo[i] = T_BOLA;
  e.x[i] = x;
  e.y[i] = y;
  e.vx[i] = vx;
  e.vy[i] = vy;
  e.edad[i] = -retraso;
  e.vida[i] = vida;
  e.r0[i] = r0;
  e.r1[i] = r1;
  e.arr[i] = arr;
  e.sube[i] = sube;
  e.pal[i] = pal;
  e.calor[i] = calor;
  e.ini[i] = ini;
  e.humo[i] = humo;
  e.sem[i] = (azar() * 256) | 0;
  e.reb[i] = 0;
  e.ac[i] = 0;
  return i;
}

function chispa(e: Efectos, x: number, y: number, vx: number, vy: number, vida: number, pal: number, retraso: number) {
  const i = nueva(e, 0);
  if (i < 0) return;
  e.tipo[i] = T_CHISPA;
  e.x[i] = x;
  e.y[i] = y;
  e.vx[i] = vx;
  e.vy[i] = vy;
  e.edad[i] = -retraso;
  e.vida[i] = vida;
  e.arr[i] = 1.2;
  e.pal[i] = pal;
  e.sem[i] = (azar() * 256) | 0;
  e.r0[i] = e.r1[i] = 0;
}

function escombro(e: Efectos, x: number, y: number, vx: number, vy: number, vida: number, color: number, ardiendo: boolean, tierra: boolean, estela: boolean) {
  const i = nueva(e, 1);
  if (i < 0) return;
  e.tipo[i] = T_ESCOMBRO;
  e.x[i] = x;
  e.y[i] = y;
  e.vx[i] = vx;
  e.vy[i] = vy;
  e.edad[i] = 0;
  e.vida[i] = vida;
  e.pal[i] = color + (tierra ? 16 : 0);
  e.reb[i] = (ardiendo ? 128 : 0) | (estela ? 0 : 64);
  e.sem[i] = (azar() * 256) | 0;
  e.ac[i] = azar() * 0.04;
  e.r0[i] = azar() < 0.5 ? 1 : 2; // tamaño
  e.r1[i] = 0;
}

function onda(e: Efectos, tipo: number, x: number, y: number, r0: number, r1: number, vida: number, retraso: number) {
  let i = e.on;
  if (i >= MAX_O) {
    // Recicla la más vieja (proporcionalmente).
    let peor = 0, pu = -1;
    for (let k = 0; k < MAX_O; k++) {
      const u = e.oedad[k] / e.ovida[k];
      if (u > pu) {
        pu = u;
        peor = k;
      }
    }
    i = peor;
  } else e.on++;
  e.otipo[i] = tipo;
  e.ox[i] = x;
  e.oy[i] = y;
  e.or0[i] = r0;
  e.or1[i] = r1;
  e.ovida[i] = vida;
  e.oedad[i] = -retraso;
}

/* ── API ────────────────────────────────────────────────────────────────── */

/**
 * Explosión de energía `energia` (0,6 obús … 10 bomba) en (x, y). Tamaños,
 * cantidades y duraciones escalan con E^(1/3). `suelo`: toca el piso (polvo,
 * terrones, anillo plano y hongo si es grande). `color` cambia la paleta.
 */
export function explosion(e: Efectos, x: number, y: number, energia: number, opts?: OpcionesExplosion): void {
  const E = Math.max(0.05, Math.min(40, energia || 1));
  const W = Math.cbrt(E);
  const R = 7 * W; // radio visual de la bola de fuego
  const suelo = !!opts?.suelo;
  const modo = opts?.color ?? 'fuego';
  const pal = modo === 'chispa' ? F_CHISPA : modo === 'agua' ? F_AGUA : modo === 'humo' ? F_NADA : F_FUEGO;
  const h = holgura(e);
  const agua = pal === F_AGUA;
  const soloHumo = pal === F_NADA;
  // Humo: grande y de fuego → humo oscuro con algo de negro; chico → claro.
  const humoBase = agua ? C_ESPUMA : soloHumo ? C_CLARO : W > 1.3 ? C_HUMO : C_CLARO;
  const cy = suelo ? y + R * 0.15 : y;
  const sube = 6 + 5 * W;

  // Destello y ondas.
  if (!soloHumo) {
    onda(e, W > 1.4 ? 3 : 2, x, cy, Math.round(R * 1.15), Math.round(R * 1.35), W > 1.4 ? 0.06 : 0.045, 0);
    const grueso = W > 1.2 ? 1 : 0;
    onda(e, suelo ? 5 + grueso : grueso, x, suelo ? y : cy, R * 0.6, R * entre(2.6, 3.1), 0.16 + 0.07 * W, 0.01);
    if (W > 1.5) onda(e, suelo ? 5 : 0, x, suelo ? y : cy, R * 0.4, R * entre(1.8, 2.1), 0.22 + 0.06 * W, 0.06);
    if (suelo) onda(e, 4, x, y, R * 0.8, R * entre(3.6, 4.2), 0.22 + 0.08 * W, 0.02);
  } else onda(e, 0, x, cy, R * 0.4, R * 1.6, 0.14, 0);

  // Bola de fuego.
  const nB = Math.round(4 + 4 * W + azar() * 2);
  const giro = azar() * 6.283;
  for (let k = 0; k < nB; k++) {
    const a = giro + (k / nB) * 6.283 + entre(-0.4, 0.4);
    const d = Math.sqrt(azar()) * R * 0.75 * (k === 0 ? 0 : 1);
    let dx = Math.cos(a), dy = Math.sin(a);
    if (suelo) dy = Math.abs(dy) * 0.9 + 0.15;
    const v = R * entre(2, 4);
    const humo = !soloHumo && !agua && W > 1.3 && azar() < 0.35 ? C_NEGRO : humoBase;
    const vida = (0.5 + 0.35 * W) * entre(0.8, 1.3);
    bolita(
      e, 1, x + dx * d, cy + dy * d, dx * v, dy * v + R * 0.8,
      vida, R * entre(0.3, 0.5), Math.min(MAX_R, R * (k === 0 ? 0.85 : entre(0.45, 0.8))),
      entre(4, 6.5), sube, pal, soloHumo ? 0 : entre(0.38, 0.52) - (0.16 * d) / R, k < 3 ? 0 : azar() * 0.12, humo,
      k < 3 ? 0 : azar() * 0.035 * W,
    );
  }

  // Estallidos secundarios (desordenan la silueta: ninguna se repite).
  if (!soloHumo && W > 1.1) {
    const nP = Math.round((W - 1) * 3 + azar() * 1.5);
    for (let k = 0; k < nP; k++) {
      const a = azar() * 6.283, d = R * entre(0.6, 1.25);
      const px = x + Math.cos(a) * d, py = cy + (suelo ? Math.abs(Math.sin(a)) : Math.sin(a)) * d;
      const ret = entre(0.05, 0.22);
      for (let j = 0; j < 3; j++)
        bolita(
          e, 1, px + entre(-2, 2), py + entre(-2, 2), entre(-20, 20), entre(-10, 25),
          entre(0.35, 0.6), R * 0.18, R * entre(0.3, 0.42), 5, sube, pal, 0.5, 0, humoBase, ret + j * 0.02,
        );
      if (k === 0) onda(e, 2, px, py, Math.round(R * 0.45), Math.round(R * 0.5), 0.034, ret);
    }
  }

  // Humo que queda flotando.
  const nS = Math.round((3 + 4 * W) * (0.6 + 0.4 * h));
  for (let k = 0; k < nS; k++) {
    const a = azar() * 6.283, d = Math.sqrt(azar()) * R * 0.8;
    bolita(
      e, 1, x + Math.cos(a) * d, cy + Math.abs(Math.sin(a)) * d * 0.8, Math.cos(a) * R * 0.6, R * 0.4,
      (1.1 + 0.7 * W) * entre(0.8, 1.25), R * 0.25, Math.min(MAX_R, R * entre(0.5, 0.75)),
      2.5, sube * 0.8, pal, agua ? 0.15 : 0, agua ? 0.5 : 0, !agua && W > 1.3 && azar() < 0.3 ? C_NEGRO : humoBase,
      entre(0.12, 0.3),
    );
  }

  // Hongo / columna si es grande.
  if (!agua && suelo && E >= 3) {
    const nT = Math.round(5 * W);
    for (let k = 0; k < nT; k++) {
      const f = k / nT;
      bolita(
        e, 1, x + entre(-2, 2), cy + 2, entre(-6, 6), R * entre(4, 9.5),
        (1.8 + 0.8 * W) * entre(0.85, 1.15), R * 0.22, Math.min(MAX_R, R * (0.3 + 0.2 * f)),
        2.4, 10, pal, soloHumo ? 0 : 0.14, 0.5, f > 0.6 && azar() < 0.5 ? C_NEGRO : humoBase, 0.04 + k * 0.025,
      );
    }
    const nC = Math.round(3 + 3 * W);
    for (let k = 0; k < nC; k++) {
      const lado = k % 2 ? 1 : -1;
      bolita(
        e, 1, x, cy + 2, lado * R * entre(0.6, 2.4), R * 10,
        (2 + 0.8 * W) * entre(0.85, 1.15), R * 0.3, Math.min(MAX_R, R * entre(0.55, 0.75)),
        2.4, 10, pal, soloHumo ? 0 : 0.12, 0.45, k % 3 === 0 ? C_NEGRO : humoBase, 0.06 + k * 0.012,
      );
    }
  } else if (!agua && W > 1.4) {
    // Columna corta de humo ascendente (explosiones medianas en el aire).
    for (let k = 0; k < 3; k++)
      bolita(
        e, 1, x + entre(-3, 3), cy, entre(-5, 5), R * entre(2.5, 4.5),
        1.6 + 0.5 * W, R * 0.25, R * 0.5, 2.5, 9, pal, 0.2, 0.5, humoBase, 0.08 + k * 0.05,
      );
  }

  // Chispas.
  const nC = Math.round((6 + 10 * W) * (pal === F_CHISPA ? 2 : 1) * (soloHumo ? 0.3 : 1) * h);
  const vC = 60 * Math.pow(W, 0.6);
  for (let k = 0; k < nC; k++) {
    const a = azar() * 6.283;
    const v = vC * entre(1, 3);
    const sy = suelo ? Math.abs(Math.sin(a)) * 1.2 + 0.2 : Math.sin(a);
    chispa(e, x + Math.cos(a) * R * 0.3, cy + sy * R * 0.3, Math.cos(a) * v, sy * v + 20, entre(0.25, 0.65), pal, azar() * 0.04);
  }
  // Gotas: el agua salpica una columna de chispas azules hacia arriba.
  if (agua) {
    for (let k = 0; k < 6 + 6 * W; k++) chispa(e, x + entre(-R, R) * 0.4, y, entre(-30, 30) * W, entre(90, 180) * W, entre(0.5, 0.9), pal, azar() * 0.08);
    for (let k = 0; k < 3 + 2 * W; k++)
      bolita(e, 1, x + entre(-2, 2), y, entre(-15, 15), R * entre(6, 11), entre(0.7, 1.1), R * 0.2, R * 0.4, 1.4, -70, pal, 0.5, 0.2, C_ESPUMA, k * 0.03);
  }

  // Escombros con estelita.
  if (!soloHumo && !agua) {
    const nD = Math.round((1.5 + 2.5 * W) * (0.5 + 0.5 * h));
    for (let k = 0; k < nD; k++) {
      const a = Math.PI / 2 + entre(-1.3, 1.3) + (suelo ? 0 : azar() < 0.3 ? Math.PI : 0);
      const v = entre(45, 110) * Math.sqrt(W);
      escombro(e, x, cy, Math.cos(a) * v, Math.sin(a) * v, entre(1.2, 2.2), (azar() * ESCOMBROS.length) | 0, k % 2 === 0, false, W > 1 && k % 3 !== 2);
    }
  }

  // Suelo: polvo que corre por el piso y terrones de tierra.
  if (suelo) {
    const nP = Math.round((4 + 4 * W) * (0.6 + 0.4 * h));
    for (let k = 0; k < nP; k++) {
      const lado = k % 2 ? 1 : -1;
      bolita(
        e, 1, x + lado * entre(0, R * 0.6), y + 1, lado * R * entre(2.5, 6), entre(4, 16),
        (0.8 + 0.45 * W) * entre(0.8, 1.2), R * 0.2, Math.min(MAX_R, R * entre(0.35, 0.55)),
        3, 5, F_NADA, 0, 0, agua ? C_ESPUMA : C_POLVO, azar() * 0.05,
      );
    }
    if (!agua) {
      const nT = Math.round((3 + 2.5 * W) * (0.5 + 0.5 * h));
      for (let k = 0; k < nT; k++) {
        const a = Math.PI / 2 + entre(-1, 1);
        const v = entre(70, 150) * Math.sqrt(W);
        escombro(e, x + entre(-3, 3), y + 1, Math.cos(a) * v, Math.sin(a) * v, entre(1, 2), (azar() * TIERRA.length) | 0, false, true, false);
      }
    }
  }

  // Cámara.
  e.sacudida = Math.min(10, e.sacudida + 1.1 * Math.pow(W, 1.6) * (suelo ? 1.25 : 1));
  if (E >= 3 && !soloHumo) e.destello = Math.min(0.65, Math.max(e.destello, 0.075 * W * W));
}

/**
 * Trozo grande (ala, cola) arrancado que cae girando, echando humo negro y
 * fuego; al tocar el suelo hace una explosioncita y queda ardiendo un rato.
 */
export function pieza(e: Efectos, x: number, y: number, vx: number, vy: number, sprite: HTMLCanvasElement | null, color: string): void {
  let p = e.piezas.find((q) => !q.activa);
  if (!p) {
    p = e.piezas[0];
    for (const q of e.piezas) if (q.edad > p.edad) p = q;
  }
  p.activa = true;
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.ang = azar() * 6.283;
  p.giro = (azar() < 0.5 ? -1 : 1) * entre(5, 11);
  p.edad = 0;
  p.ac = 0;
  p.spr = rotar(sprite ?? piezaGenerica(color));
}

/**
 * Llamas y humo negro desde un punto en movimiento (motor o fuselaje dañado).
 * Llamar en cada paso; `intensidad` ~0…1 (1 = ardiendo de lleno).
 */
export function fuego(e: Efectos, x: number, y: number, vx: number, vy: number, intensidad: number): void {
  const k = Math.max(0, Math.min(2, intensidad));
  if (k <= 0) return;
  const h = holgura(e);
  let n = (12 + 33 * k) * e.dt;
  while (n > 0) {
    if (azar() >= n) break;
    n -= 1;
    // Llama: nace blanca/amarilla, se encoge.
    bolita(
      e, 0, x + entre(-1.5, 1.5), y + entre(-1.5, 1.5), vx * 0.25 + entre(-12, 12), vy * 0.25 + entre(-6, 14),
      entre(0.14, 0.26) * (0.7 + 0.3 * k), entre(1, 2), 1 + 2 * k * entre(0.6, 1), 3, 20, F_FUEGO, 1, azar() * 0.35, C_NEGRO, 0,
    );
    if (azar() < 0.75 * h)
      bolita(
        e, 0, x, y, vx * 0.12 + entre(-6, 6), vy * 0.12 + entre(-4, 6),
        entre(0.7, 1.3) * (0.6 + 0.4 * k), 1.2, 2.5 + 2.5 * k, 2.2, 12, F_FUEGO, 0.12, 0.65, C_NEGRO, 0.04,
      );
    if (azar() < 0.12 * k * h) chispa(e, x, y, vx * 0.3 + entre(-40, 40), vy * 0.3 + entre(0, 50), entre(0.2, 0.4), F_FUEGO, 0);
  }
}

/** Chatarra ardiendo en el suelo (vehículo destruido): llamitas y humo ~6 s. */
export function restos(e: Efectos, x: number, yAlt: number, ancho: number): void {
  agregarRestos(e, x, yAlt, ancho, 6);
}

function agregarRestos(e: Efectos, x: number, y: number, ancho: number, vida: number) {
  let r = e.restos.find((q) => !q.activo);
  if (!r) {
    r = e.restos[0];
    for (const q of e.restos) if (q.edad / q.vida > r.edad / r.vida) r = q;
  }
  r.activo = true;
  r.x = x;
  r.y = y;
  r.ancho = Math.max(4, Math.min(48, ancho));
  r.edad = 0;
  r.vida = vida;
  r.acF = 0;
  r.acH = 0;
}

/** Sacudida de cámara acumulada (px); decae sola en `actualizar`. */
export function sacudida(e: Efectos): number {
  return e.sacudida;
}

/** 0…1 (en pasos de 1/4) para pintar un rect blanco a pantalla completa. */
export function destello(e: Efectos): number {
  return Math.floor(e.destello * 4) / 4;
}

/** Nº de partículas vivas (para depurar / medir). */
export function cuantas(e: Efectos): number {
  return e.n;
}

export function actualizar(e: Efectos, dt: number, viento: number, suelo: (x: number) => number): void {
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.05);
  e.dt = dt;
  e.suelo = suelo;
  e.sacudida = Math.max(0, e.sacudida - dt * (6 + e.sacudida * 2.5));
  e.destello = Math.max(0, e.destello - dt * 3.2);

  const X = e.x, Y = e.y, VX = e.vx, VY = e.vy, ED = e.edad, VI = e.vida;
  for (let i = 0; i < e.n; ) {
    let ed = ED[i];
    if (ed < 0) {
      ED[i] = ed + dt;
      i++;
      continue;
    }
    ed += dt;
    ED[i] = ed;
    if (ed >= VI[i]) {
      quitar(e, i);
      continue;
    }
    const tipo = e.tipo[i];
    if (tipo === T_BOLA) {
      const k = Math.min(1, e.arr[i] * dt);
      const caliente = ed < VI[i] * e.calor[i];
      const tv = caliente ? viento * 0.25 : viento;
      VX[i] += (tv - VX[i]) * k;
      VY[i] += (e.sube[i] - VY[i]) * k;
      X[i] += VX[i] * dt;
      Y[i] += VY[i] * dt;
      // El humo no atraviesa el suelo.
      const s = suelo(X[i]);
      if (Y[i] < s + 1) {
        Y[i] = s + 1;
        if (VY[i] < 0) VY[i] = 0;
      }
    } else if (tipo === T_CHISPA) {
      VY[i] -= G_CHISPA * dt;
      const k = 1 - e.arr[i] * dt;
      VX[i] *= k;
      VY[i] *= k;
      X[i] += VX[i] * dt;
      Y[i] += VY[i] * dt;
      if (Y[i] < suelo(X[i])) {
        // Chispa que pega en el suelo: rebota bajito una vez.
        if (e.sem[i] & 1) {
          quitar(e, i);
          continue;
        }
        e.sem[i] |= 1;
        Y[i] = suelo(X[i]);
        VY[i] = -VY[i] * 0.35;
        VX[i] *= 0.6;
      }
    } else {
      // Escombro.
      VY[i] -= G_ESCOMBRO * dt;
      VX[i] *= 1 - 0.4 * dt;
      X[i] += VX[i] * dt;
      Y[i] += VY[i] * dt;
      const s = suelo(X[i]);
      const rebotes = e.reb[i] & 63;
      if (Y[i] < s) {
        Y[i] = s;
        const fuerte = VY[i] < -45;
        if (rebotes >= 2 || VY[i] > -25) {
          VY[i] = 0;
          VX[i] *= 1 - Math.min(1, 6 * dt);
          e.reb[i] = (e.reb[i] & 192) | 3;
        } else {
          VY[i] = -VY[i] * 0.4;
          VX[i] *= 0.6;
          e.reb[i] = (e.reb[i] & 192) | (rebotes + 1);
          // Polvito al rebotar.
          if (fuerte && rebotes === 0) bolita(e, 0, X[i], s + 1, entre(-6, 6), 6, 0.3, 1, 2, 3, 4, F_NADA, 0, 0, C_POLVO, 0);
        }
      }
      // Estelita de humo mientras vuela (los que arden: fuego y humo negro).
      if (rebotes < 3 && !(e.reb[i] & 64) && ed < 0.65) {
        e.ac[i] += dt;
        const paso = 0.018 / holgura(e);
        if (e.ac[i] >= paso) {
          e.ac[i] -= paso;
          const arde = e.reb[i] & 128 && ed < 0.5;
          const f = 1 - ed / 0.65;
          bolita(
            e, 0, X[i], Y[i], 0, 0, (arde ? 0.34 : 0.26) * (0.5 + 0.5 * f), 0.6, 1 + 1.6 * f, 2, 8,
            arde ? F_FUEGO : F_NADA, arde ? 0.3 : 0, arde ? 0.3 : 0, e.reb[i] & 128 ? C_HUMO : C_CLARO, 0,
          );
        }
      }
    }
    i++;
  }

  // Ondas.
  for (let i = 0; i < e.on; ) {
    e.oedad[i] += dt;
    if (e.oedad[i] >= e.ovida[i]) {
      const u = --e.on;
      e.ox[i] = e.ox[u];
      e.oy[i] = e.oy[u];
      e.oedad[i] = e.oedad[u];
      e.ovida[i] = e.ovida[u];
      e.or0[i] = e.or0[u];
      e.or1[i] = e.or1[u];
      e.otipo[i] = e.otipo[u];
      continue;
    }
    i++;
  }

  // Piezas cayendo.
  for (const p of e.piezas) {
    if (!p.activa) continue;
    p.edad += dt;
    p.vy -= G_PIEZA * dt;
    p.vx *= 1 - 0.35 * dt;
    p.vy *= 1 - 0.15 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ang += p.giro * dt;
    // Echa fuego y humo negro todo el rato.
    p.ac += dt;
    while (p.ac >= 0.025) {
      p.ac -= 0.025;
      p.n = (p.n + 1) & 255;
      bolita(e, 0, p.x + entre(-2, 2), p.y + entre(-2, 2), p.vx * 0.15 + entre(-10, 10), p.vy * 0.15 + entre(0, 12), entre(0.16, 0.28), 1.5, entre(2.5, 4), 3, 18, F_FUEGO, 1, azar() * 0.3, C_NEGRO, 0);
      if (p.n & 1)
        bolita(e, 1, p.x + entre(-1, 1), p.y + entre(-1, 1), p.vx * 0.05 + entre(-8, 8), p.vy * 0.05 + entre(-4, 8), entre(1.1, 1.7), 2, entre(4.5, 7), 2, 12, F_FUEGO, 0.12, 0.6, azar() < 0.7 ? C_NEGRO : C_HUMO, 0.02);
    }
    const s = suelo(p.x);
    if (p.y <= s + 1 || p.edad > 12) {
      p.activa = false;
      if (p.edad <= 12) {
        explosion(e, p.x, s, 1.6, { suelo: true });
        agregarRestos(e, p.x, s, 8, 3);
      }
    }
  }

  // Restos ardiendo.
  for (const r of e.restos) {
    if (!r.activo) continue;
    r.edad += dt;
    if (r.edad >= r.vida) {
      r.activo = false;
      continue;
    }
    const resta = r.vida - r.edad;
    const k = Math.min(1, resta / 2.5, r.edad / 0.15 + 0.3);
    const ancho = r.ancho;
    const esc = Math.min(2, Math.max(0.6, ancho / 16));
    r.acF += dt * 22 * k * esc;
    while (r.acF >= 1) {
      r.acF -= 1;
      bolita(
        e, 0, r.x + entre(-0.45, 0.45) * ancho, r.y + 1, entre(-4, 4), entre(10, 26),
        entre(0.28, 0.5) * (0.6 + 0.4 * k), entre(1, 2), entre(2, 3.5) * (0.7 + 0.3 * esc), 2, 26, F_FUEGO, 1, entre(0.1, 0.5), C_NEGRO, 0,
      );
    }
    r.acH += dt * 8 * Math.max(0.35, k) * Math.max(0.8, esc);
    while (r.acH >= 1) {
      r.acH -= 1;
      bolita(
        e, 1, r.x + entre(-0.3, 0.3) * ancho, r.y + 4, entre(-3, 3), entre(14, 22),
        entre(2.4, 3.4), 2, Math.min(MAX_R, entre(4, 6.5) * (0.5 + 0.5 * esc)), 1.1, entre(16, 24), F_NADA, 0, 0,
        azar() < 0.75 ? C_NEGRO : C_HUMO, 0,
      );
    }
    if (azar() < dt * 5 * k) chispa(e, r.x + entre(-0.4, 0.4) * ancho, r.y + 3, entre(-25, 25), entre(40, 90), entre(0.3, 0.6), F_FUEGO, 0);
  }
}

function quitar(e: Efectos, i: number) {
  const u = --e.n;
  if (i === u) return;
  e.x[i] = e.x[u];
  e.y[i] = e.y[u];
  e.vx[i] = e.vx[u];
  e.vy[i] = e.vy[u];
  e.edad[i] = e.edad[u];
  e.vida[i] = e.vida[u];
  e.r0[i] = e.r0[u];
  e.r1[i] = e.r1[u];
  e.arr[i] = e.arr[u];
  e.sube[i] = e.sube[u];
  e.calor[i] = e.calor[u];
  e.ini[i] = e.ini[u];
  e.ac[i] = e.ac[u];
  e.tipo[i] = e.tipo[u];
  e.pal[i] = e.pal[u];
  e.humo[i] = e.humo[u];
  e.sem[i] = e.sem[u];
  e.reb[i] = e.reb[u];
}

/* ── Dibujo ─────────────────────────────────────────────────────────────── */

// Búfer de trabajo: bolitas resueltas en pantalla.
const bX = new Int16Array(MAX_P), bY = new Int16Array(MAX_P);
const bR = new Uint8Array(MAX_P), bC = new Uint8Array(MAX_P), bA = new Uint8Array(MAX_P);
const bL = new Uint8Array(MAX_P), bF = new Uint8Array(MAX_P); // brillo · grupo (0 humo, 1 fuego)
// Chispas y escombros resueltos.
const cI = new Uint16Array(MAX_P);

export function dibujar(
  g: CanvasRenderingContext2D,
  e: Efectos,
  aPantalla: (x: number, y: number) => [number, number],
  t: number,
): void {
  g.imageSmoothingEnabled = false;
  const alfa0 = g.globalAlpha;
  const Wc = g.canvas.width + MARGEN, Hc = g.canvas.height + MARGEN;
  const X = e.x, Y = e.y, ED = e.edad, VI = e.vida;
  const cuadro = Math.floor(t * 30);

  // 1) Resolver bolitas.
  let nb = 0, nc = 0;
  for (let i = 0; i < e.n; i++) {
    const ed = ED[i];
    if (ed < 0) continue;
    const tipo = e.tipo[i];
    if (tipo !== T_BOLA) {
      cI[nc++] = i;
      continue;
    }
    const q = aPantalla(X[i], Y[i]);
    const sx = Math.round(q[0]), sy = Math.round(q[1]);
    if (sx < -MARGEN || sy < -MARGEN || sx > Wc || sy > Hc) continue;
    const u = ed / VI[i];
    const calor = e.calor[i];
    let r: number, col: number, a = 4, fuegoG = 0;
    const sem = e.sem[i];
    if (u < calor) {
      // Caliente: avanza por la secuencia de enfriamiento.
      const v = calor >= 1 ? e.ini[i] + (0.76 - e.ini[i]) * u : e.ini[i] + (1 - e.ini[i]) * (u / calor);
      const sec = CALIENTE[e.pal[i]];
      col = v < CORTE0 ? sec[0] : v < CORTE1 ? sec[1] : v < CORTE2 ? sec[2] : sec[3];
      fuegoG = 1;
      const c = Math.min(1, (u / calor) * 2.2 + 0.1);
      r = e.r0[i] + (e.r1[i] - e.r0[i]) * c * (2 - c) * (calor < 1 ? 0.85 : 1);
      // Llamas puras: se encogen al final.
      if (calor >= 1 && u > 0.5) r *= 1 - (u - 0.5) * 1.5;
      // Parpadeo del fuego.
      if (((cuadro + sem) & 3) === 0) r += 1;
    } else {
      // Humo: primero tibio (si viene del fuego), luego su color; se desvanece.
      const w = calor > 0 ? (u - calor) / (1 - calor) : u;
      col = e.humo[i];
      if (calor > 0 && w < 0.14 && e.pal[i] === F_FUEGO) col = C_TIBIO;
      const c = calor > 0 ? 0.85 + 0.15 * Math.min(1, w * 3) : Math.min(1, w * 3.5);
      r = e.r0[i] + (e.r1[i] - e.r0[i]) * (calor > 0 ? c : c * (2 - c));
      if (w > 0.66) r *= 1 - ((w - 0.66) / 0.34) * 0.6;
      a = w < 0.62 ? 4 : w < 0.76 ? 3 : w < 0.89 ? 2 : 1;
      // Al desvanecerse, el humo se rompe en bolitas sueltas.
      if (a < 3 && sem & 2) continue;
    }
    let ri = Math.round(r);
    if (ri < 0) continue;
    if (ri > MAX_R) ri = MAX_R;
    bX[nb] = sx;
    bY[nb] = sy;
    bR[nb] = ri;
    bC[nb] = col;
    bA[nb] = a;
    bF[nb] = fuegoG;
    bL[nb] = sem & 1 && ri >= 4 ? 1 : 0;
    nb++;
  }

  // 2) Humo: el que se desvanece detrás, luego contornos, cuerpos y brillos.
  for (let a = 1; a <= 3; a++) {
    let puesto = false;
    for (let i = 0; i < nb; i++) {
      if (bF[i] || bA[i] !== a) continue;
      if (!puesto) {
        g.globalAlpha = alfa0 * a * 0.25;
        puesto = true;
      }
      pon(g, bola(bC[i], K_JUNTO, bR[i]), bX[i], bY[i]);
    }
  }
  g.globalAlpha = alfa0;
  for (let i = 0; i < nb; i++) if (!bF[i] && bA[i] === 4) pon(g, bola(bC[i], K_LINEA, bR[i]), bX[i], bY[i]);
  for (let i = 0; i < nb; i++) if (!bF[i] && bA[i] === 4) pon(g, bola(bC[i], K_CUERPO, bR[i]), bX[i], bY[i]);
  for (let i = 0; i < nb; i++)
    if (!bF[i] && bA[i] === 4 && bL[i]) pon(g, bola(bC[i], K_LUZ, bR[i] - 2), bX[i] - 1, bY[i] - 1);

  // 3) Restos: brasas en la base.
  for (const r of e.restos) {
    if (!r.activo) continue;
    const q = aPantalla(r.x, r.y);
    const x0 = Math.round(q[0] - r.ancho / 2), y0 = Math.round(q[1]);
    const k = Math.min(1, (r.vida - r.edad) / 2.5);
    const n = Math.max(2, Math.round((r.ancho / 3) * k));
    for (let j = 0; j < n; j++) {
      const h = ((j * 97 + 13) * 31) % 101;
      const px = x0 + ((h * r.ancho) / 101) | 0;
      const on = (cuadro + h) % 5;
      g.fillStyle = on < 2 ? '#ffe048' : on < 4 ? '#ff9a3c' : '#ff7090';
      g.fillRect(px, y0 - (h % 3), 2, 1);
    }
  }

  // 4) Escombros (debajo del fuego reciente para que parezcan salir de él).
  for (let j = 0; j < nc; j++) {
    const i = cI[j];
    if (e.tipo[i] !== T_ESCOMBRO) continue;
    const q = aPantalla(X[i], Y[i]);
    const x = Math.round(q[0]), y = Math.round(q[1]);
    if (x < -MARGEN || y < -MARGEN || x > Wc || y > Hc) continue;
    const pc = e.pal[i];
    const [c0, c1] = pc >= 16 ? TIERRA[pc - 16] : ESCOMBROS[pc];
    const quieto = (e.reb[i] & 63) >= 3;
    const fase = quieto ? 0 : (cuadro + e.sem[i]) & 3;
    const big = e.r0[i] > 1;
    // Desvanecer al final de la vida.
    const u = ED[i] / VI[i];
    if (u > 0.8 && (cuadro & 1)) continue;
    g.fillStyle = c1;
    if (big) {
      if (fase & 1) g.fillRect(x - 1, y - 2, 3, 4);
      else g.fillRect(x - 2, y - 1, 4, 3);
      g.fillStyle = c0;
      if (fase & 1) g.fillRect(x - 1, y - 2, 2, 3);
      else g.fillRect(x - 2, y - 1, 3, 2);
    } else {
      g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = c0;
      if (fase & 1) g.fillRect(x - 1, y - 1, 2, 2);
      else g.fillRect(x, y - 1, 2, 2);
    }
    if (e.reb[i] & 128 && u < 0.6) {
      g.fillStyle = (cuadro + e.sem[i]) & 2 ? '#ffe048' : '#ffffff';
      g.fillRect(x, y - 2, 1, 1);
    }
  }

  // 5) Piezas cayendo.
  for (const p of e.piezas) {
    if (!p.activa || !p.spr) continue;
    const q = aPantalla(p.x, p.y);
    let k = Math.round((p.ang / (Math.PI * 2)) * 16) % 16;
    if (k < 0) k += 16;
    const s = p.spr[k];
    g.drawImage(s, Math.round(q[0] - s.width / 2), Math.round(q[1] - s.height / 2));
  }

  // 6) Fuego: contornos, cuerpos del más frío al más caliente, brillos.
  for (let i = 0; i < nb; i++) if (bF[i]) pon(g, bola(bC[i], K_LINEA, bR[i]), bX[i], bY[i]);
  for (let pasada = 0; pasada < ORDEN_FUEGO.length; pasada++) {
    const c = ORDEN_FUEGO[pasada];
    for (let i = 0; i < nb; i++) if (bF[i] && bC[i] === c) pon(g, bola(c, K_CUERPO, bR[i]), bX[i], bY[i]);
  }
  for (let i = 0; i < nb; i++)
    if (bF[i] && bL[i] && bC[i] !== C_BLANCO) pon(g, bola(bC[i], K_LUZ, bR[i] - 2), bX[i] - 1, bY[i] - 1);

  // 7) Ondas y destellos.
  for (let i = 0; i < e.on; i++) {
    const ed = e.oedad[i];
    if (ed < 0) continue;
    const u = ed / e.ovida[i];
    const tipo = e.otipo[i];
    const q = aPantalla(e.ox[i], e.oy[i]);
    const x = Math.round(q[0]), y = Math.round(q[1]);
    if (tipo === 2 || tipo === 3) {
      const r = Math.min(MAX_R, Math.round(e.or0[i] + (e.or1[i] - e.or0[i]) * u));
      g.globalAlpha = alfa0;
      pon(g, bola(C_BLANCO, K_LINEA, r), x, y);
      pon(g, bola(C_BLANCO, K_CUERPO, r), x, y);
      if (tipo === 3) {
        // Rayos en cruz y en diagonal.
        const l = Math.round(r * 2.1), d = Math.round(r * 1.3);
        g.fillStyle = '#ffffff';
        g.fillRect(x - l, y - 1, l * 2 + 1, 3);
        g.fillRect(x - 1, y - l, 3, l * 2 + 1);
        for (let s = r; s <= d; s++) {
          g.fillRect(x + s, y + s, 2, 2);
          g.fillRect(x - s - 1, y + s, 2, 2);
          g.fillRect(x + s, y - s - 1, 2, 2);
          g.fillRect(x - s - 1, y - s - 1, 2, 2);
        }
      }
      continue;
    }
    const ease = 1 - (1 - u) * (1 - u);
    const r = Math.min(MAX_RA, Math.max(2, Math.round(e.or0[i] + (e.or1[i] - e.or0[i]) * ease)));
    const a = u < 0.45 ? 4 : u < 0.65 ? 3 : u < 0.85 ? 2 : 1;
    g.globalAlpha = alfa0 * a * 0.25;
    const s = anillo(tipo === 4 ? 1 : tipo >= 5 ? 2 : 0, r, (tipo === 1 || tipo === 6) && u < 0.5 ? 2 : 1);
    g.drawImage(s, x - ((s.width - 1) >> 1), y - ((s.height - 1) >> 1));
  }
  g.globalAlpha = alfa0;

  // 8) Chispas con cola (encima de todo).
  for (let j = 0; j < nc; j++) {
    const i = cI[j];
    if (e.tipo[i] !== T_CHISPA) continue;
    const q = aPantalla(X[i], Y[i]);
    const x = Math.round(q[0]), y = Math.round(q[1]);
    if (x < -MARGEN || y < -MARGEN || x > Wc || y > Hc) continue;
    const u = ED[i] / VI[i];
        // Cola: hacia atrás según la velocidad (y de pantalla invertida).
    const vx = e.vx[i], vy = e.vy[i];
    const vm = Math.abs(vx) + Math.abs(vy);
    const largo = Math.min(5, Math.round(vm * 0.022));
    if (u >= 0.75 && (cuadro + i) & 1) continue; // parpadea al apagarse
    // Dirección de la cola en pantalla: opuesta a la velocidad (y invertida).
    let dir = Math.round((Math.atan2(vy, -vx) / (Math.PI * 2)) * 16) % 16;
    if (dir < 0) dir += 16;
    pon(g, chispaSpr(e.pal[i], u < 0.3 ? 0 : 1, dir, largo), x, y);
  }
}

const ORDEN_FUEGO = [C_TIBIO, C_AGUA, C_ROSA, C_LILA, C_NARANJA, C_CIAN, C_ESPUMA, C_AMARILLO, C_BLANCO, C_CLARO];

function pon(g: CanvasRenderingContext2D, s: Spr, x: number, y: number) {
  g.drawImage(s.h, s.x, s.y, s.w, s.a, x - s.o, y - s.o, s.w, s.a);
}
