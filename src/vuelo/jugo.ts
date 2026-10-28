/*
 * «Jugo» de los textos flotantes (+puntos, ¡Doble!, premios).
 *
 * Por qué así:
 *  · Anticipación → impacto → continuidad (Disney/Swink): el texto nace un
 *    cuadro en blanco y 2 px más arriba (impacto), cae a su sitio y luego sube
 *    frenando (ease-out cúbico), no a velocidad constante: la vista lo sigue
 *    sin esfuerzo y «aterriza».
 *  · Legibilidad antes que adorno: contorno oscuro de 1 px horneado, sin
 *    escalados no enteros (borronearían el pixel art) y alfa en pasos de 1/4.
 *  · Proporción: los combos (×N) se quedan un poco más arriba y tiemblan
 *    1 px un instante; un premio pequeño no grita como uno grande.
 *  · Rendimiento: cada texto se pinta una vez a un lienzo (relleno + 4
 *    contornos) y se reutiliza; antes eran 5 fillText por texto por cuadro.
 */

type Pop = { x: number; y: number; t: number; text: string; c: string };

const FUENTE = 'bold 9px "Fredoka", "Nunito", sans-serif';
const TINTA = '#3a2a6a';
const VIDA = 1.3;

type Spr = { c: HTMLCanvasElement; w: number; h: number };
const cache = new Map<string, Spr>();
let medidor: CanvasRenderingContext2D | null = null;

function fuentesListas() {
  return typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded';
}

function texto(txt: string, color: string): Spr | null {
  const k = color + '|' + txt;
  const s = cache.get(k);
  if (s) return s;
  // Sin la fuente final no se cachea: quedaría para siempre con la de reserva.
  if (!fuentesListas() || typeof document === 'undefined') return null;
  if (cache.size > 96) cache.clear();
  if (!medidor) medidor = document.createElement('canvas').getContext('2d')!;
  medidor.font = FUENTE;
  const w = Math.ceil(medidor.measureText(txt).width) + 4;
  const h = 14;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.font = FUENTE;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const x = w / 2, y = 10;
  g.fillStyle = TINTA;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillText(txt, x + dx, y + dy);
  g.fillStyle = color;
  g.fillText(txt, x, y);
  const r = { c, w, h };
  cache.set(k, r);
  return r;
}

/** Cubic ease-out: fast start, gentle landing. */
const salida = (u: number) => 1 - (1 - u) * (1 - u) * (1 - u);

/**
 * Draws the floating texts. `sx`/`sy` map world → screen; the x is kept
 * inside [40, vw - 40] so a pop at the edge stays readable.
 */
export function dibujarPops(g: CanvasRenderingContext2D, pops: readonly Pop[], sx: (x: number) => number, sy: (y: number) => number, vw: number, quieto = false): void {
  const alfa0 = g.globalAlpha;
  // Same text state the engine always left here (later code may rely on it).
  g.font = FUENTE;
  g.textAlign = 'center';
  for (const q of pops) {
    const u = Math.min(1, q.t / VIDA);
    const combo = q.text.includes('×') || q.text.startsWith('¡');
    const sube = (combo ? 26 : 22) * salida(u);
    let x = Math.round(Math.min(vw - 40, Math.max(40, sx(q.x))));
    let y = Math.round(sy(q.y + sube));
    // Impacto: nace 2 px arriba y cae a su sitio en tres cuadros.
    if (!quieto && q.t < 0.05) y -= 2;
    else if (!quieto && q.t < 0.1) y -= 1;
    // Un combo tiembla 1 px un instante.
    if (combo && !quieto && q.t > 0.05 && q.t < 0.3) x += Math.floor(q.t * 40) % 2 ? 1 : -1;
    // Se apaga en pasos de 1/4 al final.
    const a = u < 0.7 ? 1 : u < 0.8 ? 0.75 : u < 0.9 ? 0.5 : 0.25;
    g.globalAlpha = alfa0 * a;
    const blanco = q.t < 0.05 && !quieto;
    const s = texto(q.text, blanco ? '#ffffff' : q.c);
    if (s) g.drawImage(s.c, x - (s.w >> 1), y - 10);
    else {
      // Fuente aún cargando: el camino de siempre.
      g.font = FUENTE;
      g.textAlign = 'center';
      g.fillStyle = TINTA;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillText(q.text, x + dx, y + dy);
      g.fillStyle = blanco ? '#ffffff' : q.c;
      g.fillText(q.text, x, y);
    }
  }
  g.globalAlpha = alfa0;
}
