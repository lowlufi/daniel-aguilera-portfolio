import * as D from '../game/dulce';
import { P } from '../game/dulce';
import * as A from './dibujo';
import type { ModeloAvion, Piloto } from './fisica-tipos';
import { CASA } from './pilotos';
import type { EscenaId, Hablante } from './historia';

/*
 * The story's scenes, painted in pixels on a small 256×144 stage (the
 * cutscene player scales it up crisp and moves a camera over it). Each scene
 * has a static backdrop, painted once and cached, and a few animated things
 * drawn on top every frame from the time `t` in seconds. The game's own
 * sprites are reused: planes, pilots' heads, the mice's vehicles, Margarita
 * on her cart, the pantry and the little workers.
 */

type G = CanvasRenderingContext2D;
export const ESC_W = 256;
export const ESC_H = 144;

const R = A.R;
const lienzo = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/* ── Small helpers ───────────────────────────────────────────────────────── */

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** A sky in flat bands (stops: [row, colour]), like the game's scanline skies. */
function cielo(g: G, stops: [number, string][], bandas = 10) {
  const cs = stops.map(([y, c]) => [y, hex(c)] as const);
  for (let y = 0; y < ESC_H; y++) {
    let i = 0;
    while (i < cs.length - 2 && y > cs[i + 1][0]) i++;
    const [y0, c0] = cs[i];
    const [y1, c1] = cs[Math.min(i + 1, cs.length - 1)];
    let k = y1 === y0 ? 0 : Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
    k = Math.round(k * bandas) / bandas;
    g.fillStyle = `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    g.fillRect(0, y, ESC_W, 1);
  }
}
/** Seeded random, so backdrops are the same every time. */
function azar(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function estrellas(g: G, n: number, hasta: number, seed: number, t = 0) {
  const r = azar(seed);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * ESC_W), y = Math.floor(r() * hasta), f = r();
    const on = Math.sin(t * 2 + f * 20) > -0.6;
    R(g, x, y, 1, 1, on ? (f > 0.8 ? '#fff6b0' : '#e8e0ff') : '#8a80b0');
  }
}
/** A silhouette of hills along `base`, `alto` px tall at most. */
function cerros(g: G, base: number, alto: number, color: string, seed: number, paso = 18) {
  const r = azar(seed);
  let h = alto * 0.5;
  for (let x = 0; x < ESC_W; x++) {
    if (x % paso === 0) h = alto * (0.35 + r() * 0.65);
    const k = (x % paso) / paso;
    const y = Math.round(base - h * (1 - 0.15 * Math.sin(k * Math.PI)));
    R(g, x, y, 1, base - y + 1, color);
  }
}
/** The sea from row `y` down, with moving wave dashes. */
function mar(g: G, y: number, t: number, c: [string, string, string], seed = 3) {
  R(g, 0, y, ESC_W, ESC_H - y, c[0]);
  for (let yy = y + 3; yy < ESC_H; yy += 4) R(g, 0, yy, ESC_W, 1, c[1]);
  const r = azar(seed);
  for (let i = 0; i < 26; i++) {
    const yy = y + 2 + Math.floor(r() * (ESC_H - y - 2));
    const x = Math.floor((r() * ESC_W + t * (6 + (yy - y) * 0.4)) % (ESC_W + 10)) - 5;
    R(g, x, yy, 3 + Math.floor(r() * 4), 1, c[2]);
  }
}
function nube(g: G, x: number, y: number, w: number, c = '#fff4ff', s = '#d8c8f0') {
  D.oval(g, x, y + 1, w, 3, s);
  D.oval(g, x, y, w, 3, c);
  D.disc(g, x - w * 0.3, y - 2, Math.max(2, Math.round(w * 0.35)), c);
  D.disc(g, x + w * 0.2, y - 3, Math.max(2, Math.round(w * 0.45)), c);
}
function gaviota(g: G, x: number, y: number, t: number) {
  const up = Math.sin(t * 8) > 0;
  const c = '#fff8e7';
  R(g, x, y, 1, 1, c);
  R(g, x - 2, y - (up ? 1 : 0), 2, 1, c);
  R(g, x + 1, y - (up ? 1 : 0), 2, 1, c);
  R(g, x - 3, y - (up ? 2 : -1), 1, 1, c);
  R(g, x + 3, y - (up ? 2 : -1), 1, 1, c);
}
/** A port crane (the San Antonio skyline). */
function grua(g: G, x: number, base: number, alto: number, luz: boolean) {
  const c = '#3a2a5a';
  R(g, x, base - alto, 2, alto, c);
  R(g, x + 8, base - alto, 2, alto, c);
  for (let y = base - alto + 4; y < base; y += 6) R(g, x, y, 10, 1, c);
  R(g, x - 18, base - alto - 2, 40, 3, c);
  R(g, x + 3, base - alto - 8, 4, 6, c);
  R(g, x - 16, base - alto + 1, 1, 10, c);
  R(g, x - 17, base - alto + 11, 3, 2, c);
  if (luz) R(g, x + 4, base - alto - 9, 2, 1, '#ff5a6a');
}
/** A small fish, `dir` 1 facing right. */
function pez(g: G, x: number, y: number, dir = 1, c = '#8cc8f8') {
  R(g, x - 2, y - 1, 5, 3, c);
  R(g, x - 1, y - 2, 3, 5, c);
  R(g, x - 4 * dir - (dir < 0 ? 0 : 0), y - 1, 1, 3, c);
  R(g, x - 3 * dir, y, 1, 1, c);
  R(g, x + 1 * dir, y - 1, 1, 1, '#24206a');
}
function cajaPescado(g: G, x: number, y: number) {
  R(g, x - 1, y - 1, 12, 7, P.k0);
  R(g, x, y, 10, 5, P.k2);
  R(g, x, y + 2, 10, 1, P.k1);
  pez(g, x + 3, y - 2, 1);
  pez(g, x + 7, y - 2, -1, '#a8dcff');
}
/** The runway: a grey strip with dashes. */
function pista(g: G, x0: number, x1: number, y: number) {
  R(g, x0, y, x1 - x0, 5, '#6a6080');
  R(g, x0, y, x1 - x0, 1, '#8a80a0');
  for (let x = x0 + 3; x < x1 - 4; x += 10) R(g, x, y + 2, 5, 1, '#fff8e7');
}
function manga(g: G, x: number, y: number, t: number) {
  R(g, x, y - 16, 1, 16, '#c8c0e0');
  const k = Math.round(Math.sin(t * 3));
  R(g, x + 1, y - 16, 4, 3, '#ff5a6a');
  R(g, x + 5, y - 16 + (k > 0 ? 1 : 0), 3, 2, '#fff8e7');
  R(g, x + 8, y - 15 + (k > 0 ? 1 : 0), 2, 2, '#ff5a6a');
}

const suaveK = (k: number) => k * k * (3 - 2 * k);

/** Sprites borrowed from the game: plane `m` with pilot `p` in the cockpit (their own plane by default). */
function avionDe(p: Piloto, m: ModeloAvion = CASA[p]) {
  const antes = A.pilotoActual();
  A.fijarPiloto(p);
  const c = A.planeSprite(m);
  A.fijarPiloto(antes);
  return c;
}
function dibujarRot(g: G, img: HTMLCanvasElement, x: number, y: number, ang: number, flip = false) {
  g.save();
  g.translate(Math.round(x), Math.round(y));
  if (ang) g.rotate(ang);
  if (flip) g.scale(-1, 1);
  g.drawImage(img, -Math.round(img.width / 2), -Math.round(img.height / 2));
  g.restore();
}
/** A vehicle sprite with its wheels (or waterline) at (x, y). */
function vehiculo(g: G, k: A.VehiculoTipo, x: number, y: number, f = 0, flip = false) {
  const L = A.VEH_LOOK[k];
  const img = A.vehicleSprite(k, f);
  const ox = L.w / 2 + 3, oy = L.h + 2;
  g.save();
  g.translate(Math.round(x), Math.round(y));
  if (flip) g.scale(-1, 1);
  g.drawImage(img, -ox, -oy);
  g.restore();
}

/** Margarita's fighter: the fighter sprite painted in her pink (made once). */
let suCaza: HTMLCanvasElement | null = null;
function cazaMargarita() {
  if (suCaza) return suCaza;
  const src = avionDe('dui');
  const c = lienzo(src.width, src.height);
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.55;
  g.fillStyle = '#d0609a';
  g.fillRect(0, 0, c.width, c.height);
  suCaza = c;
  return c;
}

/** The animal pilots on foot: a round little body and the game's own head. */
const CUERPO: Record<'dui' | 'lulu' | 'almendrita', { c: string; s: string; raya?: string }> = {
  dui: { c: P.o2, s: P.o1, raya: P.o1 },
  lulu: { c: '#3a3252', s: '#2a2440' },
  almendrita: { c: '#b07a40', s: '#2a2030' },
};
const PIEL = '#9a5c30', PIEL0 = '#6e3e1e';
/**
 * The humans on foot, feet at (0, 0) facing +x; returns the chin's height.
 * Naxo: short, built like a luchador (V torso), teal CESFAM scrubs, tattooed arms, white
 * clogs. Ñelo: a little taller, black hoodie, grey track pants with a stripe,
 * white sneakers.
 */
function humano(g: G, m: 'naxo' | 'nelo', t: number): number {
  const paso = Math.floor(t * 3) % 2;
  if (m === 'naxo') {
    const T = '#3aa0aa', T0 = '#246a74', TA = '#2a3a5a';
    R(g, -4, -1, 3, 1, '#f4f4f4');
    R(g, 1, -1, 3, 1, '#f4f4f4');
    R(g, -4, -5, 3, 4, T0);
    R(g, 1, -5, 3, 4, T0);
    // A luchador's V: wide shoulders and traps tapering to a narrow waist.
    R(g, -7, -14, 14, 1, T0);
    R(g, -7, -13, 14, 3, T0);
    R(g, -6, -10, 12, 2, T0);
    R(g, -5, -8, 10, 3, T0);
    R(g, -6, -13, 12, 2, T);
    R(g, -5, -11, 10, 3, T);
    R(g, -4, -8, 8, 2, T);
    R(g, 0, -11, 1, 3, T0);
    R(g, -1, -14, 3, 2, PIEL);
    R(g, 0, -13, 1, 1, PIEL0);
    // Pens in the pocket and the stethoscope round the neck.
    R(g, 2, -12, 1, 2, '#e03a3a');
    R(g, 3, -12, 1, 2, '#3a6ae0');
    R(g, -3, -13, 1, 4, '#4a4a5a');
    R(g, -3, -9, 2, 1, '#c8d0dc');
    // Big tattooed arms out of short sleeves, white tape round the wrists.
    for (const sx of [-1, 1]) {
      const ax = sx < 0 ? -10 : 7;
      const l = 5 - (sx > 0 ? paso : 0);
      R(g, ax, -14, 4, 3, T);
      R(g, ax, -11, 4, l, PIEL);
      R(g, ax + (sx < 0 ? 0 : 3), -11, 1, l, PIEL0);
      R(g, ax + 1, -10, 1, 2, TA);
      R(g, ax + 2, -8, 1, 1, TA);
      R(g, ax, -11 + l, 4, 1, '#f2eee4');
    }
    return -14;
  }
  const K = '#24222a', K0 = '#0e0c12', B = '#5a5a68';
  R(g, -5, -2, 4, 2, '#f4f4f4');
  R(g, 1, -2, 4, 2, '#f4f4f4');
  R(g, -5, -1, 4, 1, '#c8c8d0');
  R(g, 1, -1, 4, 1, '#c8c8d0');
  R(g, -4, -8, 3, 6, B);
  R(g, 1, -8, 3, 6, B);
  R(g, -4, -8, 1, 6, '#e8e8f0');
  R(g, 3, -8, 1, 6, '#e8e8f0');
  D.oval(g, 0, -12, 7, 6, K0);
  D.oval(g, 0, -12, 6, 5, K);
  R(g, -3, -10, 7, 2, K0);
  // Hood bunched behind the neck and the white drawstrings swinging.
  R(g, -5, -18, 8, 2, K0);
  const cuerda = Math.round(Math.sin(t * 5));
  R(g, -1, -16, 1, 3 + cuerda, '#e8e8f0');
  R(g, 2, -16, 1, 3 - cuerda, '#e8e8f0');
  for (const ax of [-9, 7]) {
    R(g, ax, -16, 3, 7 - (ax > 0 ? paso : 0), K);
    R(g, ax, -9 - (ax > 0 ? paso : 0), 3, 2, PIEL);
  }
  return -17;
}
/** A pilot standing with feet at (x, y). `dir` -1 faces left; `salto` lifts them. */
export function piloto(g: G, m: Piloto, x: number, y: number, t: number, dir: 1 | -1 = 1, salto = 0) {
  const bob = Math.round(Math.abs(Math.sin(t * 3)) * 1) + Math.round(salto);
  const X = Math.round(x), Y = Math.round(y) - bob;
  g.save();
  g.translate(X, Y);
  g.scale(dir, 1);
  if (m === 'naxo' || m === 'nelo') {
    const menton = humano(g, m, t);
    g.drawImage(A.pilotPortrait(m), -7, menton - 13);
    g.restore();
    return;
  }
  const b = CUERPO[m];
  // Tail.
  const cola = Math.round(Math.sin(t * 4) * 2);
  if (m === 'almendrita') {
    R(g, -7, -9 + cola * 0.5, 2, 3, b.s);
  } else {
    R(g, -8, -6, 2, 2, b.s);
    R(g, -9, -9 + cola, 2, 4, b.s);
    R(g, -10, -11 + cola, 2, 2, b.c);
  }
  D.oval(g, 0, -5, 6, 5, b.s);
  D.oval(g, 0, -5, 5, 4, b.c);
  if (m === 'dui') for (const dx of [-3, 0, 3]) R(g, dx, -9, 1, 3, P.o1);
  if (m === 'almendrita') D.oval(g, -1, -7, 4, 2, b.s);
  R(g, -3, -1, 2, 2, b.s);
  R(g, 2, -1, 2, 2, b.s);
  // Scarf.
  R(g, -3, -10, 7, 2, m === 'dui' ? P.r1 : m === 'lulu' ? '#8a5ad8' : '#e8e2d6');
  R(g, -5 - Math.round(Math.sin(t * 6)), -10, 2, 2, m === 'dui' ? P.r2 : m === 'lulu' ? '#b48af4' : P.white);
  const head = A.pilotPortrait(m);
  g.drawImage(head, -7, -10 - 13);
  g.restore();
}

/** Margarita small (parachute, barbecue): short and round, black hair, the red beanie, a big witch's nose, a flowery dress. */
function margaritaChica(g: G, x: number, y: number, t: number) {
  const X = Math.round(x), Y = Math.round(y);
  const [H0, H1, H2] = A.MARGA_PELO;
  R(g, X - 4, Y - 6, 9, 6, '#c04a8a');
  R(g, X - 3, Y - 5, 7, 4, '#ff8ac0');
  R(g, X - 1, Y - 4, 1, 1, P.white);
  R(g, X + 2, Y - 2, 1, 1, P.white);
  D.disc(g, X, Y - 10, 4, P.skin);
  R(g, X - 5, Y - 12, 2, 5, H1);
  R(g, X + 4, Y - 12, 2, 5, H1);
  R(g, X - 5, Y - 12, 1, 2, H2);
  R(g, X + 5, Y - 8, 1, 1, H0);
  R(g, X - 4, Y - 15, 9, 3, '#e0304a');
  R(g, X - 5, Y - 13, 11, 2, '#a01a3a');
  R(g, X, Y - 17, 2, 2, P.white);
  R(g, X - 2, Y - 11, 2, 1, '#24206a');
  R(g, X + 1, Y - 11, 2, 1, '#24206a');
  R(g, X - 2, Y - 7 + (Math.sin(t * 9) > 0 ? 0 : 1), 5, 1, P.r0);
  // The witch's nose, turned a bit to one side so it pokes out past her cheek:
  // a fat round tip hooking down, with a wart.
  R(g, X - 3, Y - 11, 2, 1, P.skin0);
  R(g, X - 4, Y - 10, 3, 1, P.skin);
  R(g, X - 7, Y - 11, 3, 3, P.skin);
  R(g, X - 8, Y - 10, 1, 2, P.skin);
  R(g, X - 6, Y - 11, 1, 1, '#fff0dc');
  R(g, X - 8, Y - 8, 4, 1, P.skin0);
  R(g, X - 8, Y - 7, 2, 1, P.skin0);
  R(g, X - 4, Y - 9, 1, 1, A.MARGA_VERRUGA);
  R(g, X - 5, Y - 5 + Math.round(Math.sin(t * 7)), 2, 2, P.skin);
  R(g, X + 4, Y - 5 - Math.round(Math.sin(t * 7)), 2, 2, P.skin);
}
/** The mice's mothership / the Emperor's UFO. */
function ovni(g: G, x: number, y: number, s: number, t: number, rayo: boolean) {
  const X = Math.round(x), Y = Math.round(y);
  if (rayo) {
    g.globalAlpha = 0.25 + 0.1 * Math.sin(t * 6);
    g.fillStyle = '#9af0b0';
    g.beginPath();
    g.moveTo(X - 4 * s, Y + 2 * s);
    g.lineTo(X + 4 * s, Y + 2 * s);
    g.lineTo(X + 14 * s, ESC_H);
    g.lineTo(X - 14 * s, ESC_H);
    g.fill();
    g.globalAlpha = 1;
  }
  D.oval(g, X, Y - 3 * s, 6 * s, 4 * s, '#8ae0ff');
  D.oval(g, X - s, Y - 4 * s, 3 * s, 2 * s, '#d8f8ff');
  D.oval(g, X, Y, 16 * s, 4 * s, '#5a4a96');
  D.oval(g, X, Y - 1, 15 * s, 3 * s, '#9a8ed8');
  for (let i = 0; i < 7; i++) {
    const on = Math.floor(t * 6 + i) % 3 === 0;
    R(g, X - 12 * s + i * 4 * s, Y, Math.max(1, s), Math.max(1, s), on ? '#ffe048' : '#4a3a7a');
  }
  // The Emperor's crown on the dome.
  R(g, X - 2 * s, Y - 8 * s, 4 * s, s, P.gold);
  R(g, X - 2 * s, Y - 9 * s, s, s, P.gold);
  R(g, X + s, Y - 9 * s, s, s, P.gold);
}
function zepelin(g: G, x: number, y: number, t: number, sombra = false) {
  const X = Math.round(x), Y = Math.round(y + Math.sin(t * 1.2) * 2);
  const c = sombra ? '#3a2a4a' : '#c87aa0', c2 = sombra ? '#2a1e3a' : '#8a3a6a';
  D.oval(g, X, Y, 46, 13, c2);
  D.oval(g, X, Y - 1, 45, 11, c);
  for (let i = -30; i <= 30; i += 15) R(g, X + i, Y - 11, 1, 22, c2);
  for (const s of [-1, 1]) {
    R(g, X - 50, Y + s * 7 - 3, 10, 6, c2);
    R(g, X - 54, Y + s * 9 - 3, 6, 6, c2);
  }
  R(g, X - 12, Y + 12, 24, 6, c2);
  R(g, X - 10, Y + 13, 20, 3, sombra ? '#5a4a6a' : '#ffd84a');
  if (!sombra) {
    // Her red beanie painted on the side.
    R(g, X + 14, Y - 5, 12, 6, '#e0304a');
    R(g, X + 13, Y + 1, 14, 2, '#a01a3a');
    R(g, X + 19, Y - 8, 2, 3, P.white);
  }
}

/* ── Backdrops (cached) ─────────────────────────────────────────────────── */

const fondos = new Map<string, HTMLCanvasElement>();
function fondo(id: string, pinta: (g: G) => void) {
  let c = fondos.get(id);
  if (!c) {
    c = lienzo(ESC_W, ESC_H);
    pinta(c.getContext('2d')!);
    fondos.set(id, c);
  }
  return c;
}

const SUELO = 112;

function fondoAtardecer(g: G) {
  cielo(g, [[0, '#4a3a8a'], [40, '#c86aa0'], [80, '#ffa070'], [96, '#ffd08a']]);
  D.disc(g, 62, 86, 12, '#ffe6a0');
  D.disc(g, 62, 86, 10, '#fff6c8');
  cerros(g, 100, 34, '#7a4a8a', 11, 22);
  cerros(g, 106, 20, '#5a3a7a', 21, 14);
  // The sea on the left, the port in front of it.
  R(g, 0, 96, 120, ESC_H - 96, '#5a6ab8');
  for (let y = 99; y < ESC_H; y += 4) R(g, 0, y, 120, 1, '#7a8ad0');
  for (let y = 98; y < 110; y += 3) R(g, 52 + (y % 2) * 3, y, 20 - (y - 98), 1, '#ffd8a0');
  grua(g, 18, 104, 30, false);
  grua(g, 52, 104, 26, false);
  grua(g, 90, 104, 34, false);
  R(g, 0, 104, 120, 4, '#4a3a6a');
  // Containers on the dock.
  const cont = ['#ff6a7a', '#7ad8ff', '#ffd84a', '#7af0a0'];
  for (let i = 0; i < 9; i++) R(g, 4 + i * 12, 100 - (i % 3 === 1 ? 4 : 0), 10, 4, cont[i % 4]);
  // Land on the right: grass, the runway and the little house/pantry.
  R(g, 112, 104, ESC_W - 112, ESC_H - 104, '#4a8a5a');
  R(g, 112, 104, ESC_W - 112, 2, '#6aae6a');
  R(g, 112, SUELO + 6, ESC_W - 112, ESC_H, '#3a6a4a');
  pista(g, 120, 250, SUELO + 2);
  A.paintPantry(g, 168, SUELO);
}
function fondoDespensa(g: G) {
  cielo(g, [[0, '#2a2060'], [60, '#7a4a9a'], [110, '#e08aa0']]);
  estrellas(g, 30, 60, 4);
  cerros(g, 104, 26, '#4a3a7a', 5, 26);
  R(g, 0, 104, ESC_W, ESC_H, '#3a7a4a');
  R(g, 0, 104, ESC_W, 2, '#5aa05a');
  R(g, 0, 126, ESC_W, ESC_H, '#2e6040');
  // The pantry, big and close.
  g.save();
  g.translate(128, 120);
  g.scale(1.5, 1.5);
  A.paintPantry(g, -32, 0);
  g.restore();
  // A warm light in the door.
  R(g, 118, 94, 26, 26, '#ffe6a0');
  R(g, 120, 96, 22, 24, '#fff2c8');
  // Shelves of fish inside.
  for (let r = 0; r < 3; r++) {
    R(g, 120, 100 + r * 7, 22, 1, P.k0);
    for (let i = 0; i < 4; i++) pez(g, 123 + i * 5, 98 + r * 7, i % 2 ? -1 : 1, i % 2 ? '#8cc8f8' : '#ffb0b4');
  }
  for (const [x, y] of [[96, 118], [100, 111], [160, 118]] as const) cajaPescado(g, x, y);
}
function fondoVecina(g: G) {
  cielo(g, [[0, '#5a8ae0'], [70, '#a8d8ff'], [100, '#e8f6ff']]);
  nube(g, 40, 22, 14);
  nube(g, 200, 14, 18);
  cerros(g, 100, 20, '#8ab0d8', 31, 30);
  R(g, 0, 100, ESC_W, ESC_H, '#5aa05a');
  R(g, 0, 100, ESC_W, 2, '#8ad07a');
  pista(g, 0, 110, 106);
  // Margarita's house: pink walls, a little window with a curtain, a gate.
  R(g, 150, 58, 90, 48, '#e8a0b8');
  R(g, 152, 60, 86, 46, '#ffc8d8');
  for (let i = 0; i < 12; i++) R(g, 144 + i, 58 - i, 102 - i * 2, 1, i % 3 === 1 ? '#c04a5a' : '#a02a4a');
  R(g, 160, 70, 22, 16, '#6a2a4a');
  R(g, 162, 72, 18, 12, '#bde8ff');
  R(g, 162, 72, 6, 12, '#ff8ac0');
  R(g, 210, 74, 18, 32, '#8a4a2a');
  R(g, 211, 75, 16, 31, '#c07a4a');
  R(g, 224, 90, 2, 2, P.gold);
  // Flowers (the «cardenales») by the wall.
  for (let x = 152; x < 208; x += 5) {
    R(g, x, 100, 1, 6, '#2e7a3a');
    R(g, x - 1, 98, 3, 3, x % 2 ? '#ff4a5a' : '#ff8ac0');
  }
  // Her fence and the open gate.
  for (let x = 100; x < 150; x += 6) {
    R(g, x, 96, 2, 14, '#fff8e7');
    R(g, x, 96, 2, 1, '#c8c0e0');
  }
  R(g, 100, 100, 50, 1, '#fff8e7');
  R(g, 100, 105, 50, 1, '#fff8e7');
  R(g, 136, 98, 1, 12, '#c8c0e0');
}
function fondoNoche(g: G) {
  cielo(g, [[0, '#120c24'], [80, '#2a2060'], [112, '#4a3a7a']]);
  estrellas(g, 60, 90, 7);
  D.disc(g, 40, 22, 8, '#fff6c8');
  D.disc(g, 44, 20, 7, '#2a2060');
  cerros(g, 104, 30, '#22183f', 9, 24);
  R(g, 0, 104, ESC_W, ESC_H, '#1e3a30');
  R(g, 0, 104, ESC_W, 2, '#2e5a40');
  pista(g, 0, ESC_W, SUELO + 6);
  A.paintPantry(g, 30, SUELO);
  // The night tints everything a little.
  g.globalAlpha = 0.35;
  g.fillStyle = '#120c40';
  g.fillRect(0, 60, ESC_W, ESC_H);
  g.globalAlpha = 1;
  // Door wide open, dark inside.
  R(g, 52, 94, 20, 18, '#120c24');
}
function fondoAmanecer(g: G) {
  cielo(g, [[0, '#8ab0f0'], [70, '#ffd0d8'], [100, '#fff0c8']]);
  D.disc(g, 210, 92, 14, '#fff6c8');
  nube(g, 60, 30, 16);
  nube(g, 170, 20, 12);
  cerros(g, 104, 28, '#a08ac8', 13, 24);
  R(g, 0, 104, ESC_W, ESC_H, '#5aa05a');
  R(g, 0, 104, ESC_W, 2, '#8ad07a');
  pista(g, 0, ESC_W, 130);
  g.save();
  g.translate(128, 120);
  g.scale(1.5, 1.5);
  A.paintPantry(g, -32, 0);
  g.restore();
  // The door hangs open on an empty room; only a fishbone left.
  R(g, 118, 94, 26, 26, '#3a2a3a');
  for (let r = 0; r < 3; r++) R(g, 120, 100 + r * 7, 22, 1, P.k0);
  R(g, 128, 115, 7, 1, P.white);
  for (let i = 0; i < 3; i++) R(g, 129 + i * 2, 114, 1, 3, P.white);
  // Tracks: tiny mouse prints and two tyre lines to the right.
  for (let x = 146; x < 250; x += 5) {
    R(g, x, 123 + ((x / 5) % 2), 1, 1, '#3a6a3a');
    R(g, x + 2, 125 - ((x / 5) % 2), 1, 1, '#3a6a3a');
  }
  R(g, 150, 133, 106, 1, '#3a5a3a');
  R(g, 150, 137, 106, 1, '#3a5a3a');
  A.drawJunk(g, 'chancla', 186, 126, 0.4);
}
function fondoHangar(g: G) {
  R(g, 0, 0, ESC_W, ESC_H, '#4a3040');
  for (let x = 0; x < ESC_W; x += 16) R(g, x, 0, 1, ESC_H, '#3a2434');
  for (let y = 10; y < 100; y += 22) R(g, 0, y, ESC_W, 2, '#5a3a4a');
  // Open doors: the runway and the sky.
  R(g, 70, 20, 116, 96, '#ffd0a0');
  cielo(g, [[0, '#ffb0a0'], [144, '#ffe6b0']]);
  R(g, 0, 0, 70, ESC_H, '#4a3040');
  R(g, 186, 0, 70, ESC_H, '#4a3040');
  R(g, 0, 0, ESC_W, 20, '#4a3040');
  for (let x = 0; x < 70; x += 16) R(g, x, 0, 1, ESC_H, '#3a2434');
  for (let x = 186; x < ESC_W; x += 16) R(g, x, 0, 1, ESC_H, '#3a2434');
  R(g, 70, 90, 116, 26, '#7aae6a');
  pista(g, 70, 186, 100);
  R(g, 66, 18, 4, 100, '#2a1a2a');
  R(g, 186, 18, 4, 100, '#2a1a2a');
  R(g, 0, 116, ESC_W, ESC_H, '#6a5060');
  for (let x = 0; x < ESC_W; x += 24) R(g, x, 116, 1, ESC_H, '#5a4050');
  // Tools on the wall and an old poster of the squadron.
  R(g, 10, 40, 40, 30, '#fff4e0');
  R(g, 12, 42, 36, 26, '#ffd08a');
  R(g, 20, 50, 20, 4, '#e8742a');
  R(g, 28, 46, 4, 12, '#e8742a');
  R(g, 200, 44, 2, 12, '#c8d0e8');
  R(g, 210, 46, 6, 2, '#c8d0e8');
  R(g, 222, 42, 2, 14, '#c8d0e8');
}
function fondoMar(g: G) {
  cielo(g, [[0, '#4a8ae0'], [60, '#9ad0ff'], [84, '#e8f6ff']]);
  nube(g, 50, 26, 18);
  nube(g, 180, 18, 14);
  nube(g, 230, 40, 10);
  // San Antonio far away on the left.
  R(g, 0, 78, 50, 6, '#8aa0c8');
  for (let i = 0; i < 4; i++) R(g, 6 + i * 11, 70, 1, 8, '#8aa0c8');
}
function fondoValpo(g: G) {
  cielo(g, [[0, '#ff9ab0'], [50, '#ffc8a0'], [90, '#fff0c8']]);
  nube(g, 200, 20, 16);
  const r = azar(77);
  const cols = ['#ff6a7a', '#7ad8ff', '#ffd84a', '#7af0a0', '#ff9ac4', '#b48aff', '#f0a45d', '#fff8e7'];
  // Two hills covered in little coloured houses.
  for (const [cx, alto, w] of [[70, 80, 120], [190, 70, 130]] as const) {
    for (let x = cx - w / 2; x < cx + w / 2; x++) {
      const k = (x - cx) / (w / 2);
      const top = Math.round(130 - alto * (1 - k * k));
      R(g, x, top, 1, ESC_H - top, '#7a5a8a');
    }
    // Rows of little houses hugging the slope, packed like the real cerros.
    for (let y = 40; y < 128; y += 6) {
      for (let x = cx - w / 2 + (Math.floor(y / 6) % 2) * 3; x < cx + w / 2 - 6; x += 7) {
        const k = (x + 3 - cx) / (w / 2);
        const top = 130 - alto * (1 - k * k);
        if (y < top + 3 || r() < 0.12) continue;
        const c = cols[Math.floor(r() * cols.length)];
        const xx = Math.round(x + r() * 2);
        R(g, xx, y, 6, 5, c);
        R(g, xx - 1, y - 1, 8, 1, r() < 0.5 ? '#a02a4a' : '#5a4a7a');
        R(g, xx + 2, y + 2, 1, 2, '#3a2a5a');
      }
    }
  }
  // The sea at the foot of the hills.
  R(g, 0, 128, ESC_W, ESC_H - 128, '#3a6ab8');
  for (let y = 130; y < ESC_H; y += 3) R(g, 0, y, ESC_W, 1, '#5a8ad0');
  // The funicular's rails.
  for (let i = 0; i < 46; i++) R(g, 110 + i, 128 - i * 1.3, 1, 1, '#3a2a5a');
}
function fondoTormenta(g: G) {
  cielo(g, [[0, '#120c24'], [70, '#3a3060'], [100, '#5a5080']]);
  for (const [x, y, w] of [[40, 20, 30], [130, 14, 40], [220, 26, 30], [80, 46, 26], [190, 52, 34]] as const) nube(g, x, y, w, '#4a4070', '#2a2048');
  // Viña's lights on the far coast.
  R(g, 0, 100, ESC_W, 6, '#22183f');
  const r = azar(5);
  for (let i = 0; i < 40; i++) R(g, Math.floor(r() * ESC_W), 100 + Math.floor(r() * 4), 1, 1, r() > 0.5 ? '#ffd84a' : '#fff8e7');
}
function fondoCielo(g: G) {
  cielo(g, [[0, '#3a7ad8'], [100, '#9ad0ff'], [144, '#e8f6ff']]);
  nube(g, 40, 100, 26);
  nube(g, 200, 120, 30);
  nube(g, 150, 30, 14);
}
function fondoPaz(g: G) {
  cielo(g, [[0, '#1a1438'], [90, '#3a2a6a'], [112, '#6a4a8a']]);
  estrellas(g, 50, 90, 12);
  cerros(g, 104, 22, '#22183f', 17, 26);
  R(g, 0, 104, ESC_W, ESC_H, '#2e5a40');
  R(g, 0, 104, ESC_W, 2, '#3e7a50');
  A.paintPantry(g, 20, SUELO);
  R(g, 0, 128, ESC_W, ESC_H, '#24483a');
}

/* ── Scenes (backdrop + animated layer) ─────────────────────────────────── */

type Pinta = (g: G, t: number, p: Piloto, calma: boolean) => void;

/** The three planes of a scene's squadron, the picked pilot last (in front). */
function escuadra(p: Piloto): Piloto[] {
  return (['lulu', 'dui', 'almendrita'] as Piloto[]).filter((m) => m !== p).slice(0, 2).concat(p);
}

const ESCENAS: Record<EscenaId, Pinta> = {
  atardecer(g, t) {
    g.drawImage(fondo('atardecer', fondoAtardecer), 0, 0);
    // Crane lights, gulls, the camanchaca drifting in.
    for (const x of [22, 56, 94]) if (Math.floor(t * 1.5 + x) % 2) R(g, x, 104 - (x === 94 ? 34 : x === 56 ? 26 : 30) - 9, 2, 1, '#ff5a6a');
    for (let i = 0; i < 4; i++) gaviota(g, ((t * 14 + i * 70) % 300) - 20, 40 + i * 9 + Math.sin(t + i) * 3, t + i);
    g.globalAlpha = 0.35;
    for (let i = 0; i < 3; i++) {
      const x = ((t * 5 + i * 110) % 360) - 80;
      D.oval(g, x, 86 + i * 6, 40, 3, '#fff0f8');
    }
    g.globalAlpha = 1;
    manga(g, 236, SUELO + 2, t);
    // A warm lamp over the pantry door.
    R(g, 199, SUELO - 32, 2, 2, Math.floor(t * 0.7) % 4 ? '#ffe6a0' : '#ffd08a');
  },
  despensa(g, t) {
    g.drawImage(fondo('despensa', fondoDespensa), 0, 0);
    estrellas(g, 12, 50, 99, t);
    // Dui counting fish (and eating one), Lulu watching, Almendrita wagging.
    const salto = Math.max(0, Math.sin(t * 5)) * 3;
    piloto(g, 'dui', 80, 128, t, 1, salto);
    if (Math.sin(t * 2.5) > 0) pez(g, 90, 108 - Math.round(salto), 1, '#ffb0b4');
    piloto(g, 'lulu', 186, 128, t * 0.5, -1);
    piloto(g, 'almendrita', 164, 130, t * 1.6, -1);
    if (Math.floor(t * 2) % 2) R(g, 150, 118, 2, 1, P.p1);
  },
  vecina(g, t) {
    g.drawImage(fondo('vecina', fondoVecina), 0, 0);
    // The planes' noise from the runway: rings rippling out.
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.8 + i / 3) % 1;
      g.globalAlpha = 1 - k;
      g.strokeStyle = '#fff8e7';
      g.beginPath();
      g.arc(40, 96, 6 + k * 40, -1.2, 0.3);
      g.stroke();
    }
    g.globalAlpha = 1;
    dibujarRot(g, avionDe('dui'), 40, 98, 0);
    // Margarita on her cart, rocking with anger.
    const f = Math.floor(t * 4) % 4;
    g.save();
    g.translate(190, 108);
    g.rotate(Math.sin(t * 6) * 0.03);
    vehiculo(g, 'margarita', 0, 0, f, true);
    g.restore();
    // A mouse peeking through the fence.
    const asoma = Math.max(0, Math.sin(t * 0.9)) * 6;
    A.drawWorker(g, 118 - asoma, 110, t, false, 1);
    if (Math.floor(t * 3) % 2) for (const [dx, dy] of [[0, 0], [4, -3], [8, 1]] as const) R(g, 176 + dx, 52 + dy, 2, 2, '#ff4a5a');
  },
  robo(g, t) {
    g.drawImage(fondo('noche', fondoNoche), 0, 0);
    estrellas(g, 14, 60, 41, t);
    ovni(g, 200 + Math.sin(t * 0.7) * 6, 28 + Math.sin(t * 1.3) * 2, 1, t, true);
    vehiculo(g, 'camion', 176, SUELO + 2, Math.floor(t * 2) % 4);
    vehiculo(g, 'jeep', 226, SUELO + 2, Math.floor(t * 3) % 4);
    // A line of mice carrying fish on planks to the truck, and back.
    for (let i = 0; i < 6; i++) {
      const k = ((t * 0.18 + i / 6) % 1);
      const ida = k < 0.5;
      const x = ida ? 66 + k * 2 * 92 : 158 - (k - 0.5) * 2 * 92;
      A.drawWorker(g, x, SUELO + 1, t + i, ida, ida ? 1 : -1);
      if (ida) pez(g, x - 1, SUELO - 12, 1, i % 2 ? '#8cc8f8' : '#ffb0b4');
    }
  },
  amanecer(g, t) {
    g.drawImage(fondo('amanecer', fondoAmanecer), 0, 0);
    piloto(g, 'almendrita', 96, 132, t * 2, 1, Math.max(0, Math.sin(t * 8)) * 2);
    piloto(g, 'lulu', 186, 130, t * 0.6, -1);
    piloto(g, 'dui', 160, 134, t, -1, Math.max(0, Math.sin(t * 4)) * 4);
    // The neighbours come running: Naxo straight from his shift, Ñelo from Juanaspe.
    const llega = Math.min(1, t / 2.5);
    piloto(g, 'naxo', 30 + llega * 34, 133, t * (llega < 1 ? 3 : 1), 1);
    piloto(g, 'nelo', 262 - llega * 50, 132, t * (llega < 1 ? 3 : 0.8), -1);
    // Exclamation marks over their heads.
    if (Math.floor(t * 2) % 2) {
      R(g, 159, 96, 2, 5, '#ff4a5a');
      R(g, 159, 102, 2, 2, '#ff4a5a');
      R(g, 95, 96, 2, 5, '#ff4a5a');
      R(g, 95, 102, 2, 2, '#ff4a5a');
    }
  },
  hangar(g, t, p) {
    g.drawImage(fondo('hangar', fondoHangar), 0, 0);
    // Three planes, the picked pilot's in the middle; the tarp slides off theirs.
    const orden: Piloto[] = p === 'naxo' || p === 'nelo' ? ['lulu', p, 'almendrita'] : ['lulu', 'dui', 'almendrita'];
    orden.forEach((m, i) => {
      const x = 52 + i * 76, y = 106;
      const img = avionDe(m);
      g.save();
      g.translate(x, y);
      g.scale(1.6, 1.6);
      g.drawImage(img, -Math.round(img.width / 2), -Math.round(img.height / 2));
      g.restore();
      // A dusty tarp over each plane; the picked one's is pulled off upwards.
      const quita = m === p ? suaveK(Math.min(1, t / 2.2)) : 0;
      if (quita < 1) {
        g.globalAlpha = 1 - quita * 0.8;
        const ty = y - quita * 50;
        const rx = Math.max(26, Math.round(img.width * 0.8) + 3);
        D.oval(g, x, ty - 4, rx, 12, '#6a5a40');
        D.oval(g, x, ty - 5, rx - 1, 11, '#9a8a62');
        R(g, x - rx + 1, ty - 4, rx * 2 - 2, 14, '#9a8a62');
        R(g, x - rx, ty + 10, rx * 2, 2, '#6a5a40');
        for (const dx of [-14, -2, 10]) R(g, x + dx, ty - 8, 1, 18, '#7a6a4a');
        R(g, x - 18, ty - 12, 10, 1, '#b8a87a');
        g.globalAlpha = 1;
      }
      piloto(g, m, x + (i === 1 ? 18 : -18), 134, t + i, i === 1 ? -1 : 1, m === p ? Math.max(0, Math.sin(t * 5)) * 3 : 0);
    });
    // Dust in the light from the door.
    const r = azar(3);
    for (let i = 0; i < 26; i++) {
      const x = 70 + ((r() * 116 + t * (2 + r() * 4)) % 116);
      const y = 20 + ((r() * 90 + Math.sin(t + i) * 4 + 90) % 90);
      R(g, x, y, 1, 1, '#fff6d8');
    }
  },
  despegue(g, t, p) {
    g.drawImage(fondo('amanecer-cielo', (c) => {
      cielo(c, [[0, '#6aa0f0'], [90, '#ffd0d8'], [120, '#fff0c8']]);
      cerros(c, 120, 26, '#a08ac8', 13, 24);
      R(c, 0, 120, ESC_W, ESC_H, '#5aa05a');
      pista(c, 0, ESC_W, 124);
      A.paintPantry(c, 10, 122);
    }), 0, 0);
    for (let i = 0; i < 3; i++) nube(g, ((i * 100 - t * 10) % 300 + 300) % 300 - 30, 24 + i * 16, 12);
    // The squadron rolls and climbs away, the picked pilot in front.
    escuadra(p).forEach((m, i) => {
      const k = Math.max(0, t - (2 - i) * 0.5) % 7;
      const x = 40 + k * 46 + i * 14;
      const sube = Math.max(0, x - 90);
      const y = 120 - sube * 0.45 - i * 2;
      const ang = sube > 0 ? -0.35 : 0;
      dibujarRot(g, avionDe(m), x, y, ang);
      if (k > 0) for (let j = 1; j < 6; j++) R(g, x - 16 - j * 5, y + 2 + j * (sube > 0 ? 1.6 : 0), 3, 1, j % 2 ? '#fff8e7' : '#ffd84a');
    });
  },
  mar(g, t) {
    g.drawImage(fondo('mar', fondoMar), 0, 0);
    mar(g, 84, t, ['#2a6ac8', '#3a7ad8', '#bdf0ff']);
    const bob = Math.round(Math.sin(t * 1.4) * 1);
    vehiculo(g, 'portaaviones', 170, 104 + bob, 0, true);
    vehiculo(g, 'lancha', 70 + ((t * 12) % 60), 112 + Math.round(Math.sin(t * 2) * 1), Math.floor(t * 4) % 4, false);
    vehiculo(g, 'fragata', 40, 96, 0, false);
    for (let i = 0; i < 3; i++) gaviota(g, ((t * 18 + i * 90) % 300) - 20, 30 + i * 12, t + i);
  },
  naufragio(g, t) {
    g.drawImage(fondo('mar', fondoMar), 0, 0);
    // The carrier tips and sinks; bubbles; lifeboats full of mice row away.
    const hunde = Math.min(16, t * 1.1);
    g.save();
    g.beginPath();
    g.rect(0, 0, ESC_W, 92);
    g.clip();
    g.translate(150, 98 + hunde);
    g.rotate(-0.05 - Math.min(0.2, t * 0.02));
    vehiculo(g, 'portaaviones', 0, 0, 0, true);
    g.restore();
    mar(g, 90, t, ['#2a6ac8', '#3a7ad8', '#bdf0ff']);
    for (let i = 0; i < 8; i++) {
      const k = (t * 0.7 + i / 8) % 1;
      D.disc(g, 130 + i * 6 + Math.sin(t * 3 + i) * 2, 92 - k * 10, 1, '#bdf0ff');
    }
    for (let i = 0; i < 2; i++) {
      const x = 90 - t * 6 - i * 26;
      R(g, x - 8, 100 + i * 8, 16, 3, '#ff8a3a');
      A.drawWorker(g, x - 3, 100 + i * 8, t + i, false, -1);
      A.drawWorker(g, x + 4, 100 + i * 8, t + i + 1, false, -1);
    }
    // Margarita bobbing in a life ring.
    D.disc(g, 200, 98, 6, '#ff4a5a');
    R(g, 195, 97, 11, 2, P.white);
    margaritaChica(g, 200, 96 + Math.round(Math.sin(t * 2)), t);
  },
  valparaiso(g, t) {
    g.drawImage(fondo('valpo', fondoValpo), 0, 0);
    // The funicular going up and down, the Gran Queso waiting up high.
    const k = (Math.sin(t * 0.5) + 1) / 2;
    const x = 110 + k * 40, y = 128 - k * 52;
    R(g, x - 4, y - 8, 9, 8, '#ff5a3a');
    R(g, x - 3, y - 7, 7, 3, '#bdf0ff');
    R(g, x - 3, y - 2, 7, 1, '#a02a2a');
    pez(g, x + 1, y - 10, 1);
    const qx = 200 + Math.sin(t * 0.6) * 4, qy = 26 + Math.sin(t) * 2;
    D.oval(g, qx, qy, 26, 10, '#e0a020');
    D.oval(g, qx, qy - 1, 25, 8, '#ffd84a');
    for (const [dx, dy, r] of [[-12, -2, 2], [4, 2, 3], [14, -3, 2], [-2, -5, 1]] as const) D.disc(g, qx + dx, qy + dy, r, '#e0a020');
    R(g, qx - 6, qy + 10, 12, 4, '#8a5a1e');
    for (let i = 0; i < 3; i++) gaviota(g, ((t * 16 + i * 80) % 300) - 20, 40 + i * 10, t + i);
  },
  tormenta(g, t, _p, calma) {
    g.drawImage(fondo('tormenta', fondoTormenta), 0, 0);
    // Lightning now and then (not with reduced motion).
    const rayo = !calma && t % 4.2 > 3.9;
    if (rayo) {
      g.globalAlpha = 0.5;
      R(g, 0, 0, ESC_W, ESC_H, '#e8e0ff');
      g.globalAlpha = 1;
      let x = 60, y = 0;
      while (y < 100) {
        const nx = x + (Math.floor(t * 50 + y) % 2 ? 4 : -4), ny = y + 8;
        g.fillStyle = '#fff8e7';
        for (let i = 0; i <= 8; i++) g.fillRect(Math.round(x + ((nx - x) * i) / 8), Math.round(y + i), 2, 1);
        x = nx;
        y = ny;
      }
    }
    zepelin(g, 160 + Math.sin(t * 0.4) * 8, 50, t);
    mar(g, 106, t * 1.8, ['#1a2a5a', '#22386a', '#6a8ac8']);
    // Rain.
    g.fillStyle = '#9aa8e0';
    for (let i = 0; i < (calma ? 30 : 70); i++) {
      const x = (i * 37 + t * 40) % ESC_W, y = (i * 53 + t * 220) % ESC_H;
      g.fillRect(Math.round(x), Math.round(y), 1, 4);
    }
  },
  caida(g, t, p) {
    g.drawImage(fondo('cielo', fondoCielo), 0, 0);
    // Her fighter spirals away smoking; she floats down under a red parachute.
    const fx = 180 + t * 8, fy = 30 + t * 12;
    for (let j = 1; j < 8; j++) D.disc(g, fx - j * 3, fy - j * 5, 1 + (j % 3), j % 2 ? '#6a6080' : '#8a80a0');
    dibujarRot(g, cazaMargarita(), fx, fy, 1 + t * 0.8, true);
    const mx = 110 + Math.sin(t * 1.2) * 6, my = 40 + Math.min(40, t * 4);
    D.oval(g, mx, my - 18, 18, 8, '#a01a3a');
    D.oval(g, mx, my - 19, 17, 6, '#e0304a');
    for (const dx of [-10, 0, 10]) R(g, mx + dx, my - 18, 1, 2, P.white);
    g.strokeStyle = '#fff8e7';
    g.beginPath();
    g.moveTo(mx - 16, my - 16);
    g.lineTo(mx - 2, my - 8);
    g.moveTo(mx + 16, my - 16);
    g.lineTo(mx + 2, my - 8);
    g.stroke();
    margaritaChica(g, mx, my + 6, t);
    // The winner flies past.
    dibujarRot(g, avionDe(p), ((t * 60) % 400) - 60, 100, -0.1);
  },
  granqueso(g, t) {
    g.drawImage(fondo('cielo', fondoCielo), 0, 0);
    const k = Math.max(0.35, 1 - t * 0.08);
    const qx = 128 + Math.sin(t * 7) * 3 * (1 - k), qy = 50 + (1 - k) * 40;
    D.oval(g, qx, qy, Math.round(40 * k), Math.round(15 * k), '#e0a020');
    D.oval(g, qx, qy - 1, Math.round(39 * k), Math.round(13 * k), '#ffd84a');
    for (const [dx, dy, r] of [[-18, -3, 3], [6, 3, 4], [22, -4, 3], [-4, -7, 2]] as const) D.disc(g, qx + dx * k, qy + dy * k, Math.max(1, Math.round(r * k)), '#e0a020');
    // Air puffing out of a hole.
    for (let i = 0; i < 4; i++) {
      const s = (t * 2 + i / 4) % 1;
      g.globalAlpha = 1 - s;
      D.disc(g, qx + 40 * k + s * 30, qy - s * 8, 2 + Math.round(s * 3), '#fff8e7');
    }
    g.globalAlpha = 1;
    // Mice parachuting with little cheese parachutes.
    for (let i = 0; i < 4; i++) {
      const x = 40 + i * 50 + Math.sin(t + i) * 5, y = ((t * 12 + i * 30) % 120) + 20;
      D.oval(g, x, y - 12, 6, 3, '#ffd84a');
      A.drawWorker(g, x, y, t + i, false, 1);
    }
  },
  nodriza(g, t, p) {
    g.drawImage(fondo('nodriza', (c) => {
      cielo(c, [[0, '#0a0818'], [100, '#2a2060'], [144, '#4a3a7a']]);
      estrellas(c, 90, 140, 31);
      cerros(c, 144, 24, '#22183f', 3, 26);
    }), 0, 0);
    estrellas(g, 20, 100, 55, t);
    const s = Math.max(1, Math.round(3 - t * 0.3));
    const y = Math.max(16, 80 - t * 9);
    ovni(g, 128 + Math.sin(t * 2) * 4, y, s, t, false);
    // The squadron below, the picked pilot in the middle.
    const [a, b, c] = escuadra(p);
    [a, c, b].forEach((m, i) => dibujarRot(g, avionDe(m), 60 + i * 60, 118 - (i === 1 ? 8 : 0) + Math.sin(t * 2 + i) * 2, 0));
  },
  paz(g, t) {
    g.drawImage(fondo('paz', fondoPaz), 0, 0);
    estrellas(g, 16, 80, 61, t);
    // String lights.
    for (let x = 90; x < 250; x += 8) {
      const y = 70 + Math.round(Math.sin((x - 90) / 50) * 6);
      R(g, x, y, 2, 2, Math.floor(t * 2 + x / 8) % 3 ? '#ffd84a' : '#ff8ac0');
    }
    // A charcoal grill with fish, smoke curling up.
    R(g, 150, 110, 30, 4, '#3a2a3a');
    R(g, 152, 114, 2, 12, '#3a2a3a');
    R(g, 176, 114, 2, 12, '#3a2a3a');
    R(g, 151, 108, 28, 2, Math.floor(t * 4) % 2 ? '#ff8a3a' : '#ffd84a');
    for (let i = 0; i < 3; i++) pez(g, 157 + i * 8, 106, 1, '#e8a060');
    for (let i = 0; i < 4; i++) {
      const s = (t * 0.5 + i / 4) % 1;
      g.globalAlpha = 0.6 * (1 - s);
      D.disc(g, 165 + Math.sin(t * 2 + i) * 4, 102 - s * 40, 2 + Math.round(s * 4), '#d8d0e8');
    }
    g.globalAlpha = 1;
    piloto(g, 'dui', 140, 128, t, 1, Math.max(0, Math.sin(t * 3)) * 2);
    piloto(g, 'lulu', 112, 128, t * 0.6, 1);
    piloto(g, 'almendrita', 206, 128, t * 1.5, -1);
    // Ñelo at the grill with the tongs, Naxo keeping an eye on Dui's plate.
    piloto(g, 'nelo', 188, 128, t * 0.8, -1);
    R(g, 176 + (Math.floor(t * 2) % 2), 112, 5, 1, '#c8d0dc');
    piloto(g, 'naxo', 88, 128, t * 0.7, 1);
    margaritaChica(g, 222, 128, t * 0.7);
  },
};

/** Paints scene `id` at time `t` (seconds) on a 256×144 context. */
export function pintarEscena(g: G, id: EscenaId, t: number, p: Piloto, calma: boolean) {
  g.imageSmoothingEnabled = false;
  ESCENAS[id](g, t, p, calma);
}

/* ── Portraits for the dialog box ───────────────────────────────────────── */

const caras = new Map<string, HTMLCanvasElement>();
/** A 32×32 bust for the speakers that have no big portrait. `boca` opens the mouth, `parpado` blinks. */
export function retratoExtra(quien: Extract<Hablante, 'margarita' | 'raton' | 'emperador'>, boca: boolean, parpado: boolean): HTMLCanvasElement {
  const key = `${quien}|${boca}|${parpado}`;
  let c = caras.get(key);
  if (c) return c;
  c = lienzo(32, 32);
  const g = c.getContext('2d')!;
  if (quien === 'margarita') {
    D.oval(g, 16, 30, 12, 5, '#c04a8a');
    D.oval(g, 16, 30, 11, 4, '#ff8ac0');
    R(g, 10, 28, 2, 2, P.white);
    R(g, 21, 29, 2, 2, P.white);
    // Black hair puffing out under the beanie.
    for (const [x, y] of [[6, 16], [26, 16], [7, 21], [25, 21], [8, 12], [24, 12]] as const) D.disc(g, x, y, 3, A.MARGA_PELO[1]);
    for (const [x, y] of [[5, 15], [25, 15], [6, 20], [24, 20]] as const) R(g, x, y, 2, 1, A.MARGA_PELO[2]);
    R(g, 6, 23, 2, 1, A.MARGA_PELO[0]);
    R(g, 24, 23, 2, 1, A.MARGA_PELO[0]);
    D.disc(g, 16, 18, 9, '#c07a58');
    D.disc(g, 16, 18, 8, P.skin);
    // The red beanie and its pompom.
    D.oval(g, 16, 9, 10, 6, '#a01a3a');
    D.oval(g, 16, 8, 9, 5, '#e0304a');
    R(g, 6, 11, 20, 3, '#a01a3a');
    for (let x = 8; x < 25; x += 3) R(g, x, 11, 1, 3, '#c0203a');
    D.disc(g, 16, 2, 2, P.white);
    // Glasses, cross eyebrows.
    R(g, 9, 16, 6, 4, '#5a3a6a');
    R(g, 17, 16, 6, 4, '#5a3a6a');
    R(g, 10, 17, 4, 2, parpado ? P.skin : '#e8f6ff');
    R(g, 18, 17, 4, 2, parpado ? P.skin : '#e8f6ff');
    if (!parpado) {
      R(g, 12, 17, 1, 2, '#24206a');
      R(g, 19, 17, 1, 2, '#24206a');
    }
    R(g, 15, 17, 2, 1, '#5a3a6a');
    R(g, 9, 14, 5, 1, '#8a8aa8');
    R(g, 18, 14, 5, 1, '#8a8aa8');
    R(g, 13, 15, 1, 1, '#8a8aa8');
    R(g, 18, 15, 1, 1, '#8a8aa8');
    R(g, 8, 21, 2, 1, P.blush);
    R(g, 22, 21, 2, 1, P.blush);
    // Grumpy mouth, pushed to one side by the nose.
    if (boca) {
      R(g, 16, 23, 6, 3, P.r0);
      R(g, 17, 25, 4, 1, P.r2);
    } else R(g, 16, 24, 6, 1, P.r0);
    R(g, 22, 25, 1, 1, P.r0);
    // The witch's nose: a big, chubby hooked blob with a wart.
    R(g, 14, 18, 1, 2, P.skin0);
    R(g, 15, 18, 2, 2, P.skin);
    D.disc(g, 15, 21, 3, P.skin0);
    D.disc(g, 15, 21, 2, P.skin);
    R(g, 13, 23, 4, 1, '#e8a888');
    R(g, 13, 24, 3, 1, P.skin0);
    R(g, 13, 25, 1, 1, P.skin0);
    R(g, 14, 20, 1, 1, '#fff0dc');
    R(g, 17, 20, 1, 1, A.MARGA_VERRUGA);
  } else {
    const emp = quien === 'emperador';
    const piel = emp ? '#c8b4f0' : '#e0d8ec', sombra = emp ? '#8a70c8' : '#b8aed0';
    if (emp) {
      D.oval(g, 16, 30, 13, 5, '#a01a3a');
      D.oval(g, 16, 30, 11, 4, '#e0304a');
      R(g, 10, 27, 12, 2, P.white);
    } else {
      D.oval(g, 16, 30, 10, 4, '#7a6aa0');
    }
    D.disc(g, 7, 9, 5, sombra);
    D.disc(g, 25, 9, 5, sombra);
    D.disc(g, 7, 9, 3, P.p1);
    D.disc(g, 25, 9, 3, P.p1);
    D.oval(g, 16, 18, 9, 8, sombra);
    D.oval(g, 16, 18, 8, 7, piel);
    D.oval(g, 16, 23, 4, 3, P.white);
    R(g, 15, 21, 3, 2, P.p0);
    for (const s of [-1, 1]) {
      R(g, 16 + s * 6 - (s < 0 ? 4 : 0), 22, 5, 1, '#8a80a0');
      R(g, 16 + s * 6 - (s < 0 ? 4 : 0), 24, 5, 1, '#8a80a0');
    }
    if (parpado) {
      R(g, 11, 17, 3, 1, '#24206a');
      R(g, 19, 17, 3, 1, '#24206a');
    } else {
      R(g, 11, 16, 3, 3, '#24206a');
      R(g, 19, 16, 3, 3, '#24206a');
      R(g, 12, 16, 1, 1, P.white);
      R(g, 20, 16, 1, 1, P.white);
    }
    if (boca) R(g, 15, 25, 3, 2, P.r0);
    if (emp) {
      // Crown and monocle.
      R(g, 9, 7, 14, 4, P.gold0);
      R(g, 10, 7, 12, 3, P.gold);
      for (const x of [9, 15, 21]) R(g, x, 3, 2, 4, P.gold);
      R(g, 15, 8, 2, 2, P.r1);
      g.strokeStyle = P.gold;
      g.strokeRect(18.5, 14.5, 5, 5);
    } else {
      // The yellow hard hat.
      D.oval(g, 16, 10, 9, 4, P.gold0);
      D.oval(g, 16, 9, 8, 3, P.gold);
      R(g, 6, 11, 20, 2, P.gold0);
      R(g, 15, 6, 2, 4, P.gold1);
    }
  }
  caras.set(key, c);
  return c;
}
