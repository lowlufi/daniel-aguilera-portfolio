import * as D from '../game/dulce';
import { P } from '../game/dulce';
import type { ModeloAvion } from './fisica-tipos';
import { escribir } from './fondo';

/*
 * Sprites and scenery for the plane game, in the same "dulce" look as the
 * island: pastel colors, round shapes and outlines in a deeper shade of each
 * thing's own color. Sprites are painted once per frame of animation and
 * cached (D.outlined); everything is drawn at 1 unit = 1 virtual pixel.
 *
 * Plane sprites point their nose to +x with the origin at their centre.
 * Vehicle sprites face LEFT (they drive towards the pantry) with the origin at
 * the middle of their wheels' contact line.
 */

type Ctx = CanvasRenderingContext2D;

export const R = (g: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};

/* ── Dui in the cockpit ──────────────────────────────────────────────────── */

/** Dui's head with flying goggles, looking forward (+x). (x, y) is the chin. */
function duiHead(g: Ctx, x: number, y: number) {
  R(g, x - 4, y - 8, 2, 3, P.o1);
  R(g, x - 3, y - 9, 1, 1, P.o1);
  R(g, x + 2, y - 8, 2, 3, P.o1);
  R(g, x + 3, y - 9, 1, 1, P.o1);
  R(g, x + 2, y - 7, 1, 1, P.blush);
  D.disc(g, x, y - 3, 4, P.o2);
  R(g, x - 2, y - 6, 3, 1, P.o3);
  // Goggles: a leather strap and a round lens.
  R(g, x - 4, y - 4, 9, 1, P.k0);
  R(g, x + 1, y - 5, 3, 3, P.gl1);
  R(g, x + 2, y - 5, 1, 1, P.white);
  R(g, x + 3, y - 1, 1, 1, P.blush);
  R(g, x + 4, y - 2, 1, 1, P.cream);
}

/** Lulu: a black cat with big yellow eyes, goggles pushed up on her forehead. */
function luluHead(g: Ctx, x: number, y: number) {
  const K = '#2e2840', K1 = '#4e4668';
  R(g, x - 4, y - 8, 2, 3, K);
  R(g, x - 3, y - 9, 1, 1, K);
  R(g, x + 2, y - 8, 2, 3, K);
  R(g, x + 3, y - 9, 1, 1, K);
  R(g, x + 2, y - 7, 1, 1, P.p1);
  D.disc(g, x, y - 3, 4, K);
  R(g, x - 2, y - 6, 3, 1, K1);
  // Goggles up on the forehead.
  R(g, x - 4, y - 6, 9, 1, P.k0);
  R(g, x + 1, y - 7, 3, 2, P.gl1);
  // A yellow eye with a slit pupil.
  R(g, x + 1, y - 4, 3, 2, '#ffd23a');
  R(g, x + 2, y - 4, 1, 2, '#1a1428');
  R(g, x + 4, y - 2, 1, 1, P.p1);
  R(g, x + 3, y - 1, 2, 1, '#9a90b8');
}

/** Almendrita: a Yorkshire terrier, tan face, steel-blue top and a pink bow. */
function almendritaHead(g: Ctx, x: number, y: number) {
  const T = '#d8a060', T0 = '#b07838', T1 = '#f4cc90', B = '#7a8aa8';
  // Pointy ears.
  R(g, x - 4, y - 9, 2, 3, T0);
  R(g, x - 3, y - 10, 1, 1, T0);
  R(g, x + 2, y - 9, 2, 3, T0);
  R(g, x + 3, y - 10, 1, 1, T0);
  D.disc(g, x, y - 3, 4, T);
  // Steel-blue hair over the head and a fluffy muzzle.
  R(g, x - 4, y - 6, 6, 2, B);
  R(g, x - 4, y - 4, 2, 3, B);
  D.oval(g, x + 3, y - 2, 2, 2, T1);
  R(g, x + 5, y - 3, 1, 1, '#2a2030');
  R(g, x + 1, y - 5, 2, 2, P.eye);
  R(g, x + 1, y - 5, 1, 1, P.white);
  R(g, x + 3, y, 1, 1, P.p1);
  // A pink bow on the top-knot.
  R(g, x - 2, y - 9, 2, 2, P.r2);
  R(g, x + 1, y - 9, 2, 2, P.r2);
  R(g, x, y - 8, 1, 1, P.r0);
}

/* ── Planes ──────────────────────────────────────────────────────────────── */

/* ── Planes: small, detailed and built from parts that can be shot off ──── */

/** Parts of a plane that a hit can tear off, in the order they're listed per model. */
export type Parte = 'cola' | 'ala' | 'motor' | 'cabina' | 'bodega';

export type PlaneLook = {
  ink: string;
  w: number;
  h: number;
  /** Propeller hub [x, y, radius] or jet nozzle [x, y], relative to the centre. */
  prop?: [number, number, number];
  jet?: [number, number];
  /** Where the pilot's scarf starts flapping from, and its two colors. */
  scarf: [number, number];
  scarfC: [string, string];
  /** Where missiles and bombs leave the plane. */
  rack: [number, number];
  /** Parts this airframe has, and where each sits (for hits, smoke, debris). */
  parts: Partial<Record<Parte, [number, number]>>;
};

export const LOOKS: Record<ModeloAvion, PlaneLook> = {
  avioneta: {
    ink: '#9a5a10', w: 34, h: 22, prop: [12, 0, 4], scarf: [-2, -5], scarfC: ['#8a5ad8', '#b48af4'], rack: [1, 3],
    parts: { cola: [-11, -3], ala: [1, 2], motor: [9, 0], cabina: [3, -4] },
  },
  caza: {
    ink: P.o0, w: 36, h: 20, jet: [-14, 0], scarf: [0, -6], scarfC: [P.r1, P.r2], rack: [0, 3],
    parts: { cola: [-11, -4], ala: [-2, 2], motor: [-12, 0] },
  },
  bombardero: {
    ink: '#2a5a9a', w: 44, h: 26, prop: [10, 3, 3], scarf: [6, -7], scarfC: [P.p0, P.p1], rack: [-2, 5],
    parts: { cola: [-16, -6], ala: [-2, 2], motor: [6, 3], cabina: [14, -1], bodega: [-5, 4] },
  },
};

/** Small pilot heads for the cockpit (the big ones are for the hangar portraits). */
function miniHead(g: Ctx, m: ModeloAvion, x: number, y: number) {
  if (m === 'caza') {
    R(g, x - 3, y - 7, 2, 2, P.o1);
    R(g, x + 1, y - 7, 2, 2, P.o1);
    D.disc(g, x, y - 3, 3, P.o2);
    R(g, x - 2, y - 5, 2, 1, P.o3);
    R(g, x - 3, y - 4, 6, 1, P.k0);
    R(g, x + 1, y - 4, 2, 2, P.gl1);
    R(g, x + 2, y - 1, 1, 1, P.blush);
  } else if (m === 'avioneta') {
    const K = '#2e2840';
    R(g, x - 3, y - 7, 2, 2, K);
    R(g, x + 1, y - 7, 2, 2, K);
    D.disc(g, x, y - 3, 3, K);
    R(g, x - 2, y - 5, 2, 1, '#4e4668');
    R(g, x - 3, y - 5, 6, 1, P.k0);
    R(g, x + 1, y - 3, 2, 1, '#ffd23a');
    R(g, x + 2, y - 3, 1, 1, '#1a1428');
    R(g, x + 3, y - 1, 1, 1, P.p1);
  } else {
    R(g, x - 3, y - 7, 1, 2, '#b07838');
    R(g, x + 2, y - 7, 1, 2, '#b07838');
    D.disc(g, x, y - 3, 3, '#d8a060');
    R(g, x - 3, y - 5, 4, 2, '#7a8aa8');
    R(g, x - 1, y - 7, 3, 1, P.r2);
    R(g, x + 1, y - 4, 1, 1, P.eye);
    D.oval(g, x + 2, y - 2, 1, 1, '#f4cc90');
    R(g, x + 3, y - 2, 1, 1, '#2a2030');
  }
}

/** A torn, scorched edge where a part used to be. */
function stub(g: Ctx, x: number, y: number, w: number, h: number) {
  R(g, x, y, w, h, '#5a4a5a');
  for (let i = 0; i < h; i++) R(g, x + (i % 2 ? -1 : w), y + i, 1, 1, i % 3 ? '#3a2a3a' : '#ff9a3c');
  R(g, x + Math.floor(w / 2), y, 1, 1, P.gold);
}

/** Black scorch marks that grow with damage. */
function scorch(g: Ctx, n: number, seed: number) {
  for (let i = 0; i < n * 3; i++) {
    const h = (seed * 31 + i * 97) % 211;
    g.globalAlpha = i % 2 ? 0.5 : 0.8;
    R(g, (h % 18) - 9, ((h >> 3) % 5) - 2, 3, 2, '#3a2a3a');
  }
  g.globalAlpha = 1;
}

type Has = (p: Parte) => boolean;

function paintAvioneta(g: Ctx, has: Has) {
  const Y = '#ffd84a', Y0 = '#e8a828', Y1 = '#fff2a8';
  if (has('cola')) {
    for (let i = 0; i < 5; i++) R(g, -13 + Math.floor(i / 2), -7 + i, 3, 1, i < 2 ? Y1 : Y);
    R(g, -12, -7, 1, 5, P.r1);
    R(g, -14, -1, 6, 2, Y0);
    R(g, -14, -1, 6, 1, Y);
  } else stub(g, -10, -3, 2, 4);
  // Fuselage with panel lines and rivets.
  D.oval(g, 0, 0, 10, 3, Y0);
  D.oval(g, 0, -1, 9, 2, Y);
  R(g, -7, -2, 11, 1, Y1);
  R(g, -8, 1, 16, 1, P.r1);
  R(g, -3, -2, 1, 3, Y0);
  R(g, 5, -2, 1, 3, Y0);
  for (let x = -6; x < 7; x += 4) R(g, x, 2, 1, 1, '#c88a20');
  if (has('motor')) {
    D.disc(g, 9, 0, 2, P.r0);
    R(g, 8, -1, 2, 2, P.r2);
    R(g, 8, -1, 1, 1, P.r3);
    R(g, 11, -1, 2, 2, P.metal);
    R(g, 7, -2, 1, 1, P.metal0);
    R(g, 7, 2, 1, 1, P.metal0);
  } else stub(g, 7, -2, 2, 4);
  if (has('ala')) {
    D.oval(g, 1, 2, 7, 1, Y0);
    R(g, -5, 1, 12, 1, Y1);
    R(g, 6, 2, 2, 1, P.red);
    R(g, 2, 3, 1, 3, P.metal0);
    D.disc(g, 2, 6, 1, '#4a3a5a');
  } else stub(g, -1, 1, 3, 2);
  // Cockpit, windscreen and Lulu.
  R(g, -3, -3, 6, 1, Y0);
  miniHead(g, 'avioneta', 0, -2);
  if (has('cabina')) {
    R(g, 4, -6, 1, 4, P.gl1);
    R(g, 3, -5, 1, 3, P.gl0);
  } else R(g, 4, -4, 1, 1, P.gl0);
}

function paintCaza(g: Ctx, has: Has) {
  const O = P.o2, O0 = P.o1, O1 = P.o3;
  if (has('cola')) {
    for (let i = 0; i < 6; i++) R(g, -13 + Math.round(i * 0.6), -8 + i, 3 - Math.floor(i / 4), 1, i < 2 ? O1 : O);
    R(g, -12, -7, 1, 3, P.cream);
    R(g, -15, 0, 7, 2, O0);
  } else stub(g, -11, -3, 2, 4);
  // Fuselage, intake and a pointed nose.
  D.oval(g, -1, 0, 12, 3, O0);
  D.oval(g, -1, -1, 11, 2, O);
  R(g, -8, -2, 12, 1, O1);
  R(g, 10, -2, 2, 4, O);
  R(g, 12, -1, 3, 3, O);
  R(g, 15, 0, 2, 1, O0);
  R(g, 10, -2, 4, 1, O1);
  R(g, -10, 1, 18, 1, P.cream);
  R(g, 0, 0, 2, 2, '#7a3a2a');
  for (let x = -7; x < 8; x += 5) R(g, x, -1, 1, 2, O0);
  if (has('ala')) {
    for (let i = 0; i < 3; i++) R(g, -3 - i, 2 + i, 8 - i, 1, i === 0 ? O1 : O0);
    R(g, -2, 5, 5, 1, P.white);
    R(g, 3, 5, 1, 1, P.red);
  } else stub(g, -3, 2, 3, 2);
  if (has('motor')) {
    R(g, -15, -2, 3, 4, P.metal0);
    R(g, -15, -1, 1, 2, '#2a2438');
  } else stub(g, -13, -2, 2, 4);
  // Bubble canopy with Dui inside.
  D.oval(g, 4, -3, 4, 2, P.gl0);
  miniHead(g, 'caza', 3, -1);
  g.globalAlpha = 0.45;
  D.oval(g, 4, -3, 3, 1, P.gl1);
  g.globalAlpha = 1;
  R(g, 5, -5, 2, 1, P.white);
}

function paintBombardero(g: Ctx, has: Has) {
  const B = '#9ad0ff', B0 = '#5a9ae0', B1 = '#d8f0ff';
  if (has('cola')) {
    for (let i = 0; i < 7; i++) R(g, -19 + Math.round(i * 0.5), -10 + i, 5, 1, i < 2 ? B1 : B);
    R(g, -18, -9, 1, 6, P.r1);
    R(g, -21, -2, 9, 2, B0);
    R(g, -21, -2, 9, 1, B);
  } else stub(g, -15, -3, 2, 5);
  D.oval(g, 0, 0, 16, 5, B0);
  D.oval(g, 0, -1, 15, 4, B);
  R(g, -11, -4, 18, 1, B1);
  R(g, -15, 2, 29, 1, P.white);
  for (let k = 0; k < 3; k++) {
    D.disc(g, -9 + k * 5, -1, 1, P.gl0);
    R(g, -9 + k * 5, -2, 1, 1, P.white);
  }
  for (const x of [-13, -6, -1, 4, 10]) R(g, x, -3, 1, 6, B0);
  if (has('cabina')) {
    D.disc(g, 14, 0, 3, P.gl0);
    D.disc(g, 14, -1, 2, P.gl1);
    R(g, 14, -2, 2, 1, P.white);
  } else stub(g, 12, -2, 2, 4);
  if (has('ala')) {
    D.oval(g, -2, 2, 10, 2, B0);
    R(g, -10, 1, 16, 1, B1);
    R(g, 7, 2, 2, 1, P.red);
  } else stub(g, -3, 1, 3, 3);
  if (has('motor')) {
    D.oval(g, 6, 3, 4, 2, P.metal0);
    D.oval(g, 6, 2, 3, 1, P.metal);
    R(g, 3, 4, 1, 1, '#2a2438');
  } else stub(g, 4, 2, 3, 3);
  if (has('bodega')) {
    R(g, -7, 4, 9, 2, B0);
    R(g, -6, 4, 7, 1, P.metal);
  } else {
    R(g, -7, 4, 9, 2, '#2a2438');
    R(g, -5, 5, 2, 1, P.s1);
  }
  D.oval(g, 6, -5, 3, 2, P.gl0);
  miniHead(g, 'bombardero', 6, -3);
  g.globalAlpha = 0.45;
  D.oval(g, 6, -5, 2, 1, P.gl1);
  g.globalAlpha = 1;
}

const PAINT: Record<ModeloAvion, (g: Ctx, has: Has) => void> = { avioneta: paintAvioneta, caza: paintCaza, bombardero: paintBombardero };

/** The plane's sprite with the given parts missing (cached per combination). */
export function planeSprite(m: ModeloAvion, lost: readonly Parte[] = []) {
  const L = LOOKS[m];
  const key = lost.length ? [...lost].sort().join(',') : '';
  return D.outlined(`avion2|${m}|${key}`, L.ink, L.w, L.h, L.w / 2, L.h / 2, (g) => {
    PAINT[m](g, (p) => !lost.includes(p));
    if (lost.length) scorch(g, lost.length, m.length);
  });
}

/** Just one part, drawn alone: the piece that flies off when it's shot away. */
export function partSprite(m: ModeloAvion, part: Parte) {
  const L = LOOKS[m];
  return D.outlined(`pieza|${m}|${part}`, L.ink, L.w, L.h, L.w / 2, L.h / 2, (g) => {
    // Paint everything, then keep only a box around the part.
    const c = document.createElement('canvas');
    c.width = L.w;
    c.height = L.h;
    const cg = c.getContext('2d')!;
    cg.translate(L.w / 2, L.h / 2);
    PAINT[m](cg, (p) => p === part);
    const [ax, ay] = L.parts[part] ?? [0, 0];
    const bx = L.w / 2 + ax - 7;
    const by = L.h / 2 + ay - 6;
    g.drawImage(c, bx, by, 14, 12, ax - 7, ay - 6, 14, 12);
  });
}

/**
 * The plane at (x, y) on screen, nose along `angle` (screen radians, y down),
 * flipped by `roll` (+1 canopy up, -1 rolled over). `t` animates the
 * propeller, the jet flame and the scarf; `gas` makes the flame bigger.
 * `lost` lists the parts already shot off.
 */
export function drawPlane(g: Ctx, m: ModeloAvion, x: number, y: number, angle: number, roll: number, t: number, gas: number, blink = false, lost: readonly Parte[] = []) {
  const L = LOOKS[m];
  const img = planeSprite(m, lost);
  g.save();
  g.translate(Math.round(x), Math.round(y));
  // Quantized so the nearest-neighbour rotation doesn't shimmer every frame.
  // Without a wing it flies a little crooked.
  // Fine steps keep the turn smooth; the half roll is a clean flip, no squash.
  g.rotate(Math.round(angle / 0.02) * 0.02 + (lost.includes('ala') ? 0.05 : 0));
  g.scale(1, roll >= 0 ? 1 : -1);
  // The pilot's scarf flaps behind the cockpit.
  const [sx0, sy0] = L.scarf;
  for (let i = 0; i < 4; i++) {
    const wave = Math.round(Math.sin(t * 18 - i * 0.9) * (i * 0.4));
    R(g, sx0 - 3 - i * 2, sy0 + wave + (i > 1 ? 1 : 0), 2, 1, L.scarfC[i % 2]);
  }
  if (!blink) g.drawImage(img, -L.w / 2, -L.h / 2);
  const engine = !lost.includes('motor');
  if (L.prop && engine) {
    const [px, py, r] = L.prop;
    const f = Math.floor(t * 40) % 3;
    const hgt = [r, Math.max(1, r - 2), 1][f];
    g.globalAlpha = 0.7;
    R(g, px + 1, py - hgt, 1, hgt * 2, P.metal);
    g.globalAlpha = 0.3;
    R(g, px + 1, py - r, 1, r * 2, P.white);
    g.globalAlpha = 1;
  }
  if (L.jet && engine) {
    const [jx, jy] = L.jet;
    const len = 2 + Math.round(gas * 5) + (Math.floor(t * 30) % 2);
    D.oval(g, jx - len / 2, jy, Math.ceil(len / 2) + 1, 1, '#ff9a3c');
    R(g, jx - Math.ceil(len / 2), jy, Math.ceil(len / 2), 1, P.gold);
    R(g, jx - 1, jy, 1, 1, P.white);
  }
  // Torn edges keep sparking where each part used to be.
  for (const part of lost) {
    const [ax, ay] = L.parts[part] ?? [0, 0];
    const f = Math.floor(t * 16 + ax * 3) % 4;
    if (f === 3) continue;
    R(g, ax + (f - 1), ay - 1 + (f % 2), f === 0 ? 2 : 1, 1, f === 1 ? P.gold : '#ff4a3c');
    if (f === 0) R(g, ax, ay + 1, 1, 1, P.gold1);
  }
  g.restore();
}

const HEAD: Record<ModeloAvion, (g: Ctx, x: number, y: number) => void> = { avioneta: luluHead, caza: duiHead, bombardero: almendritaHead };
const INK: Record<ModeloAvion, string> = { avioneta: '#1a1428', caza: P.o0, bombardero: '#7a4a1e' };

/** The pilot's head alone, for the hangar cards. */
export function pilotPortrait(m: ModeloAvion) {
  return D.outlined(`piloto|${m}`, INK[m], 16, 16, 7, 13, (g) => HEAD[m](g, 0, 0));
}

/* ── Mice and their vehicles ─────────────────────────────────────────────── */

export type VehiculoTipo = 'jeep' | 'camion' | 'tanque' | 'sam' | 'margarita' | 'lancha' | 'fragata' | 'portaaviones' | 'trolebus' | 'bici' | 'micro' | 'portuario';

const V = '#b49af4', V0 = '#8064d8', V1 = '#e0d4ff', VINK = '#3a2a7a';
const TIRE = '#4a3a5a';

/** A mouse driver looking left: big round ears, pink nose. (x, y) is the chin. */
function mouse(g: Ctx, x: number, y: number) {
  D.disc(g, x + 1, y - 7, 2, '#c8c0d8');
  D.disc(g, x + 5, y - 6, 2, '#c8c0d8');
  R(g, x + 1, y - 7, 1, 1, P.p1);
  R(g, x + 5, y - 6, 1, 1, P.p1);
  D.oval(g, x, y - 3, 4, 3, '#e0d8ec');
  R(g, x - 5, y - 3, 2, 1, P.p0);
  R(g, x - 2, y - 4, 1, 1, P.eye);
  R(g, x + 1, y - 2, 1, 1, P.p2);
  // Little red helmet.
  R(g, x - 2, y - 6, 5, 1, P.r1);
}

function wheel(g: Ctx, x: number, y: number, r: number, f: number) {
  D.disc(g, x, y, r, TIRE);
  D.disc(g, x, y, Math.max(1, r - 2), P.metal);
  const a = (f * Math.PI) / 2;
  R(g, x + Math.round(Math.cos(a) * (r - 1)), y + Math.round(Math.sin(a) * (r - 1)), 1, 1, '#8a7a9a');
}

function paintJeep(g: Ctx, f: number) {
  R(g, -12, -10, 24, 6, V0);
  R(g, -12, -10, 24, 4, V);
  R(g, -11, -10, 22, 1, V1);
  R(g, -13, -8, 2, 3, P.gold);
  R(g, -5, -15, 1, 5, P.gl1);
  mouse(g, 0, -10);
  // Rocket pod on the back.
  R(g, 4, -14, 8, 4, P.metal0);
  R(g, 4, -14, 8, 2, P.metal);
  R(g, 3, -14, 2, 2, P.red);
  wheel(g, -7, -4, 3, f);
  wheel(g, 7, -4, 3, f);
}

function paintCamion(g: Ctx, f: number) {
  // Cab at the front (left).
  R(g, -16, -16, 11, 12, V0);
  R(g, -16, -16, 11, 10, V);
  R(g, -15, -16, 9, 1, V1);
  R(g, -15, -14, 6, 5, P.gl1);
  mouse(g, -11, -9);
  R(g, -17, -7, 2, 2, P.gold);
  // Flat bed and a missile on its launch rail.
  R(g, -5, -9, 21, 5, V0);
  R(g, -5, -9, 21, 3, V);
  R(g, 0, -12, 13, 3, P.metal0);
  R(g, 1, -15, 12, 3, P.white);
  R(g, -1, -15, 2, 3, P.red);
  R(g, 12, -16, 2, 1, P.red);
  wheel(g, -11, -4, 3, f);
  wheel(g, 3, -4, 3, f);
  wheel(g, 11, -4, 3, f);
}

function paintTanque(g: Ctx, f: number) {
  // Tracks: a rounded band with road wheels.
  D.oval(g, 0, -4, 15, 4, TIRE);
  for (let i = -2; i <= 2; i++) {
    D.disc(g, i * 6, -4, 2, P.metal);
    R(g, i * 6 + (f % 2 ? 1 : -1), -4, 1, 1, '#8a7a9a');
  }
  // Hull.
  R(g, -14, -11, 28, 5, V0);
  R(g, -13, -11, 26, 3, V);
  R(g, -12, -11, 24, 1, V1);
  // Turret with a mouse peeking out of the hatch.
  D.oval(g, 2, -13, 8, 4, V0);
  D.oval(g, 2, -14, 7, 3, V);
  R(g, -2, -16, 6, 1, V1);
  mouse(g, 5, -16);
}

function paintSam(g: Ctx, f: number) {
  R(g, -16, -15, 8, 11, V0);
  R(g, -16, -15, 8, 9, V);
  R(g, -15, -13, 5, 4, P.gl1);
  mouse(g, -12, -8);
  R(g, -8, -9, 24, 5, V0);
  R(g, -8, -9, 24, 3, V);
  // A launcher box tilted up and back with two missile noses.
  for (let i = 0; i < 9; i++) R(g, -3 + i, -12 - Math.round(i * 0.8), 5, 4, i === 8 ? V1 : V0);
  R(g, 5, -22, 2, 2, P.red);
  R(g, 8, -19, 2, 2, P.red);
  wheel(g, -11, -4, 3, f);
  wheel(g, 2, -4, 3, f);
  wheel(g, 11, -4, 3, f);
}

/**
 * Neighbour Margarita, the boss: a grumpy old lady in a red wool hat, glasses
 * and a grey cardigan, riding a motorised shopping trolley full of groceries.
 * Faces left like the mice. Her broom is drawn separately so it can shake.
 */
function paintMargarita(g: Ctx, f: number) {
  const M = P.metal, M0 = P.metal0;
  // The trolley basket: a wire grid, slightly wider at the top.
  for (let y = -30; y < -10; y++) {
    const inset = Math.round((y + 30) * 0.15);
    R(g, -24 + inset, y, 40 - inset, 1, (y + 30) % 4 === 0 ? M0 : M);
  }
  for (let x = -22; x < 16; x += 4) R(g, x, -30, 1, 20, M0);
  R(g, -25, -32, 43, 2, M0);
  R(g, -24, -32, 41, 1, P.white);
  // Groceries poking out: a lettuce, a leek and a loaf.
  D.disc(g, -13, -34, 6, P.g0);
  D.disc(g, -13, -35, 5, P.g2);
  R(g, -15, -38, 3, 2, P.g4);
  R(g, -5, -46, 3, 14, P.g4);
  R(g, -6, -50, 5, 5, P.g1);
  D.oval(g, 6, -34, 7, 3, P.k1);
  R(g, 2, -36, 8, 1, P.k3);
  // Engine box and the handle.
  R(g, 14, -12, 9, 7, M0);
  R(g, 15, -11, 7, 3, M);
  R(g, 16, -30, 2, 16, M0);
  // Margarita, behind the trolley: cardigan, skirt, legs, shoes.
  R(g, 16, -32, 12, 20, '#8a7a9a');
  R(g, 17, -31, 10, 18, '#a898b8');
  R(g, 21, -31, 1, 18, '#8a7a9a');
  R(g, 16, -13, 12, 6, '#6a4a7a');
  R(g, 18, -7, 2, 4, P.skin);
  R(g, 24, -7, 2, 4, P.skin);
  R(g, 17, -4, 4, 2, P.r0);
  R(g, 23, -4, 4, 2, P.r0);
  // Arm reaching to the handle.
  R(g, 15, -27, 4, 3, '#a898b8');
  R(g, 14, -26, 2, 2, P.skin);
  // Head: grey hair and bun, wrinkly face, big nose, glasses, a frown.
  D.disc(g, 24, -40, 6, '#d8d4e4');
  D.disc(g, 27, -44, 3, '#d8d4e4');
  D.disc(g, 21, -39, 5, P.skin);
  R(g, 15, -39, 3, 3, P.skin0);
  R(g, 16, -42, 7, 1, P.metal0);
  R(g, 16, -42, 3, 3, P.gl2);
  R(g, 20, -42, 3, 3, P.gl2);
  R(g, 17, -41, 1, 1, P.eye);
  R(g, 21, -41, 1, 1, P.eye);
  // Angry eyebrows sloping down to the nose.
  R(g, 16, -44, 2, 1, '#5a4a5a');
  R(g, 18, -43, 1, 1, '#5a4a5a');
  R(g, 21, -44, 2, 1, '#5a4a5a');
  R(g, 17, -36, 4, 1, P.r0);
  R(g, 16, -35, 1, 1, P.r0);
  R(g, 24, -37, 2, 1, P.blush);
  // The red wool hat with a pompom.
  D.oval(g, 22, -45, 8, 4, P.r0);
  D.oval(g, 22, -46, 7, 3, P.r1);
  R(g, 15, -43, 15, 2, P.r0);
  for (let x = 16; x < 30; x += 2) R(g, x, -43, 1, 2, P.r2);
  D.disc(g, 22, -51, 3, P.r2);
  R(g, 21, -52, 1, 1, P.r3);
  // Four casters.
  for (const x of [-18, -6, 6, 16]) wheel(g, x, -4, 3, f);
}

/* ── Boats: they float with the waterline at y = 0 and some hull below ───── */

// Lilac-grey warship paint, and the hull under the water seen through it.
const H = '#aaa0cc', H0 = '#7c70aa', H1 = '#d6d0ee';
const SUB = '#8a8cd0', SUB0 = '#6a70bc';

/** Foam at the stern and the bow, cycling with the frame `f`. */
function foam(g: Ctx, sx: number, bx: number, f: number, big: number) {
  for (let i = 0; i < 3 + big; i++) {
    const k = (i + f) % 4;
    R(g, sx + i * 2 - 1, -1 + (k % 2), 2, 1 + (k === 0 ? 1 : 0), k === 3 ? P.w2 : P.w3);
  }
  R(g, sx - 1, 0, 3 + big * 2, 1, P.white);
  R(g, bx - (f % 2), -2 - (f >> 1), 1, 1, P.w3);
  R(g, bx + 1, -1, 2, 1, P.white);
}

/** A mouse sailor standing on deck: stripy shirt and the usual head. (x, y) are its feet. */
function deckMouse(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 2, 1, 2, '#6a5a7a');
  R(g, x + 1, y - 2, 1, 2, '#6a5a7a');
  R(g, x - 2, y - 5, 5, 3, P.white);
  R(g, x - 2, y - 4, 5, 1, P.gl0);
  mouse(g, x, y - 5);
}

/** A hull row by row: `left(y)` / `right(y)` give its edges; y = 0 is the waterline. */
function hull(g: Ctx, y0: number, y1: number, left: (y: number) => number, right: (y: number) => number, top: string, body: string, low: string) {
  for (let y = y0; y <= y1; y++) {
    const l = Math.round(left(y));
    const w = Math.round(right(y)) - l + 1;
    R(g, l, y, w, 1, y === y0 ? top : y === 0 ? P.r2 : y > 0 ? (y % 3 === 2 ? SUB0 : SUB) : y === -1 ? low : body);
  }
}

function paintLancha(g: Ctx, f: number) {
  // Little outboard motor at the stern.
  R(g, 11, -9, 3, 5, P.metal0);
  R(g, 11, -9, 3, 1, P.metal);
  R(g, 12, -4, 1, 6, P.metal0);
  hull(g, -5, 4, (y) => -12 + Math.max(0, y + 3) * 1.1, (y) => 12 - (y > 2 ? 1 : 0), V1, P.white, V0);
  // The bow kicks up a little and a lilac racing stripe runs along.
  R(g, -14, -6, 5, 2, P.white);
  R(g, -14, -6, 5, 1, V1);
  R(g, -10, -3, 20, 1, V);
  R(g, -8, -4, 1, 1, P.r1);
  // Windscreen and the pilot.
  R(g, -6, -10, 1, 5, P.gl0);
  R(g, -5, -10, 1, 5, P.gl1);
  mouse(g, 0, -5);
  // Rocket rack: two rockets on a rail tilted up towards the bow.
  R(g, 4, -8, 7, 3, P.metal0);
  R(g, 5, -8, 5, 1, P.metal);
  for (let i = 0; i < 2; i++) {
    R(g, 4 + i * 2, -11 - i * 2, 7, 2, P.white);
    R(g, 3 + i * 2, -11 - i * 2, 2, 2, P.red);
    R(g, 10 + i * 2, -12 - i * 2, 1, 4, P.metal0);
  }
  foam(g, 10, -10, f, 0);
}

function paintFragata(g: Ctx, f: number) {
  // Superstructure, funnel and mast (behind the hull top).
  R(g, -6, -14, 16, 8, H0);
  R(g, -5, -14, 14, 7, H);
  R(g, -5, -14, 14, 1, H1);
  R(g, -4, -12, 7, 2, P.gl1);
  R(g, -4, -12, 1, 1, P.white);
  R(g, 5, -18, 4, 4, H0);
  R(g, 5, -18, 4, 1, P.r1);
  R(g, 6, -17, 2, 3, H);
  R(g, 1, -21, 1, 7, P.metal0);
  R(g, -1, -19, 5, 1, P.metal0);
  // Hull with a raised forecastle at the bow.
  hull(g, -6, 6, (y) => -21 + (y + 6) * 0.95, (y) => 21 - Math.max(0, y - 1), H1, H, H0);
  R(g, -22, -8, 10, 2, H);
  R(g, -22, -8, 10, 1, H1);
  for (let x = -14; x < 18; x += 5) R(g, x, -3, 2, 1, P.gl0);
  R(g, -18, -4, 3, 1, P.metal0);
  // Bow gun.
  D.disc(g, -13, -9, 2, H0);
  R(g, -14, -10, 2, 1, H1);
  R(g, -21, -10, 7, 1, P.metal0);
  // Missile launcher box at the stern, tilted up.
  for (let i = 0; i < 7; i++) R(g, 11 + i, -9 - Math.round(i * 0.6), 4, 3, i === 6 ? V1 : V0);
  R(g, 11, -10, 2, 2, P.red);
  R(g, 13, -11, 2, 1, P.red);
  // Two sailors: one at the bow, one waving from the bridge wing.
  deckMouse(g, -17, -8);
  deckMouse(g, 12, -14);
  foam(g, 17, -17, f, 1);
}

/** A parked mouse fighter on the carrier deck, nose left. (x, y) is under its wheels. */
function parkedJet(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 2, 1, 2, P.metal0);
  R(g, x + 5, y - 2, 1, 2, P.metal0);
  for (let i = 0; i < 5; i++) R(g, x + 6 + Math.round(i * 0.6), y - 7 - i, 3, 1, i < 2 ? V1 : V);
  D.oval(g, x + 1, y - 4, 8, 2, V0);
  D.oval(g, x + 1, y - 5, 7, 1, V);
  R(g, x - 9, y - 4, 3, 1, V0);
  R(g, x - 3, y - 3, 8, 1, V1);
  // Canopy with a pair of round ears poking out.
  D.oval(g, x - 1, y - 7, 3, 1, P.gl1);
  R(g, x - 2, y - 10, 2, 2, '#c8c0d8');
  R(g, x + 1, y - 10, 2, 2, '#c8c0d8');
  R(g, x + 1, y - 9, 1, 1, P.p1);
}

/** Margarita, small, up on the carrier's bridge behind the railing. (x, y) is the rail top. */
function bridgeMargarita(g: Ctx, x: number, y: number) {
  R(g, x - 4, y - 3, 9, 4, '#a898b8');
  R(g, x, y - 3, 1, 4, '#8a7a9a');
  D.disc(g, x + 2, y - 6, 3, '#d8d4e4');
  R(g, x + 4, y - 10, 2, 2, '#d8d4e4');
  D.disc(g, x, y - 6, 3, P.skin);
  R(g, x - 4, y - 6, 2, 2, P.skin0);
  // Glasses, eyes and the frown.
  R(g, x - 3, y - 8, 5, 1, P.metal0);
  R(g, x - 3, y - 7, 2, 2, P.gl2);
  R(g, x, y - 7, 2, 2, P.gl2);
  R(g, x - 3, y - 7, 1, 1, P.eye);
  R(g, x, y - 7, 1, 1, P.eye);
  R(g, x - 3, y - 4, 3, 1, P.r0);
  R(g, x + 2, y - 5, 1, 1, P.blush);
  // The red wool hat.
  D.oval(g, x, y - 10, 4, 2, P.r0);
  D.oval(g, x, y - 11, 3, 1, P.r1);
  R(g, x - 4, y - 9, 9, 1, P.r0);
  for (let i = -3; i < 5; i += 2) R(g, x + i, y - 9, 1, 1, P.r2);
  R(g, x - 1, y - 13, 2, 1, P.r2);
}

/** Carrier AA turrets (x, y-up) relative to the waterline centre; y is the dome centre. */
export const PORTAAVIONES_TORRETAS: [number, number][] = [[-58, 11], [4, 11], [62, 11]];
/** The flight deck span relative to the waterline centre (y up is its top surface). */
export const PORTAAVIONES_CUBIERTA = { x0: -74, x1: 24, y: 17 };

function paintPortaaviones(g: Ctx, f: number) {
  // Island tower on the right third, with the bridge windows.
  R(g, 28, -28, 22, 11, H0);
  R(g, 29, -28, 20, 10, H);
  R(g, 29, -28, 20, 1, H1);
  R(g, 30, -25, 18, 2, P.gl1);
  for (let x = 32; x < 48; x += 4) R(g, x, -25, 1, 2, P.gl0);
  R(g, 31, -21, 3, 2, P.gl0);
  R(g, 44, -21, 3, 2, P.gl0);
  R(g, 46, -38, 1, 10, P.metal0);
  R(g, 44, -35, 5, 1, P.metal0);
  bridgeMargarita(g, 38, -29);
  R(g, 27, -30, 25, 1, P.metal0);
  R(g, 27, -29, 25, 1, H1);
  for (let x = 28; x < 52; x += 3) R(g, x, -30, 1, 2, P.metal0);
  // Hull: a raked bow on the left, a square stern on the right.
  hull(g, -12, 8, (y) => -72 + (y + 12) * 1.1, (y) => 72 - Math.max(0, y - 2), H1, H, H0);
  // Hangar openings with warm lamps, portholes and an anchor.
  for (const x of [-44, -26, 22, 40]) {
    R(g, x, -10, 9, 4, '#4a3e6a');
    R(g, x + 4, -10, 1, 1, P.gold1);
  }
  for (let x = -60; x < 68; x += 6) R(g, x, -3, 2, 1, P.gl0);
  R(g, -64, -9, 1, 5, P.metal0);
  R(g, -66, -8, 5, 1, P.metal0);
  R(g, -66, -5, 1, 1, P.metal0);
  R(g, -62, -5, 1, 1, P.metal0);
  // Sponsons for the turrets (barrels are drawn live, they aim).
  for (const [tx] of PORTAAVIONES_TORRETAS) {
    R(g, tx - 5, -9, 11, 2, H0);
    D.disc(g, tx, -11, 3, H0);
    D.disc(g, tx, -12, 2, H);
    R(g, tx - 1, -13, 2, 1, H1);
  }
  // Flight deck, a little wider than the hull, with its lane markings.
  R(g, -76, -17, 151, 4, '#665a88');
  R(g, -76, -17, 151, 1, '#8e84b2');
  R(g, -75, -13, 149, 1, H0);
  for (let x = -72; x < 24; x += 7) R(g, x, -15, 4, 1, P.white);
  for (let x = -74; x < 72; x += 10) R(g, x, -16, 2, 1, P.gold);
  R(g, -70, -16, 1, 2, P.white);
  R(g, -68, -16, 1, 2, P.white);
  // Two fighters parked and ready.
  parkedJet(g, -34, -17);
  parkedJet(g, 2, -17);
  foam(g, 66, -61, f, 2);
}

/* ── Valparaíso: the old trolleybus and the downhill bikers ─────────────── */

/** A little mouse face peeking from a bus window; (x, y) is the window's bottom-left. */
function windowMouse(g: Ctx, x: number, y: number) {
  R(g, x, y - 5, 1, 1, '#c8c0d8');
  R(g, x + 3, y - 5, 1, 1, '#c8c0d8');
  R(g, x, y - 4, 4, 3, '#e0d8ec');
  R(g, x, y - 3, 1, 1, P.eye);
  R(g, x - 1, y - 2, 1, 1, P.p0);
}

/** The historic trolleybus: cream on top, green below, rounded nose, mice at the windows. */
function paintTrolebus(g: Ctx, f: number) {
  const G = '#5aa870', G0 = '#3a8050', CR = '#fff6e5', CR0 = '#e8dcc0';
  // Body with a rounded front (left) and back.
  D.oval(g, -15, -11, 5, 6, G0);
  D.oval(g, 15, -11, 4, 6, G0);
  R(g, -16, -17, 32, 12, G0);
  R(g, -15, -17, 30, 6, CR);
  R(g, -18, -11, 37, 6, G);
  D.oval(g, -15, -14, 4, 3, CR);
  D.oval(g, 15, -14, 3, 3, CR);
  R(g, -16, -17, 32, 1, CR0);
  R(g, -18, -11, 37, 1, G0);
  R(g, -18, -7, 37, 1, '#c8e8b0');
  // Windscreen with the driver, then side windows with passengers.
  R(g, -19, -15, 4, 4, P.gl1);
  mouse(g, -14, -10);
  for (let i = 0; i < 5; i++) {
    const wx = -9 + i * 5;
    R(g, wx, -15, 4, 4, P.gl1);
    if (i % 2 === 0) windowMouse(g, wx, -11);
  }
  // Route sign over the windscreen and a headlamp.
  R(g, -17, -19, 8, 2, '#3e4a6b');
  R(g, -16, -19, 6, 1, P.gold);
  R(g, -20, -9, 2, 2, P.gold1);
  // Roof base of the poles.
  R(g, 4, -19, 8, 2, P.metal0);
  wheel(g, -10, -4, 3, f);
  wheel(g, 10, -4, 3, f);
}

/** A mouse downhill biker in a full-face helmet; `f` turns the pedals. */
function paintBici(g: Ctx, f: number) {
  const FR = '#8fd3c8';
  for (const wx of [-5, 5]) {
    D.disc(g, wx, -4, 4, TIRE);
    D.disc(g, wx, -4, 3, '#d8d4e4');
    const a = (f * Math.PI) / 2 + wx;
    R(g, wx + Math.round(Math.cos(a) * 2), -4 + Math.round(Math.sin(a) * 2), 1, 1, '#8a7a9a');
    R(g, wx, -4, 1, 1, P.metal0);
  }
  // Frame: rear hub → seat → head tube → front hub, and the down tube to the cranks.
  for (let i = 0; i <= 4; i++) R(g, 5 - Math.round(i * 0.75), -4 - i, 1, 1, FR);
  for (let i = 0; i <= 5; i++) R(g, 2 - i, -8, 1, 1, FR);
  for (let i = 0; i <= 4; i++) R(g, -3 - Math.round(i * 0.5), -8 + i, 1, 1, FR);
  for (let i = 0; i <= 3; i++) R(g, 2 - Math.round(i * 0.6), -8 + i, 1, 1, FR);
  R(g, -5, -10, 3, 1, '#3e4a6b');
  // Cranks and pedals.
  const a = (f * Math.PI) / 2;
  const px = Math.round(Math.cos(a) * 2);
  const py = Math.round(Math.sin(a) * 2);
  R(g, px, -5 + py, 2, 1, '#3e4a6b');
  R(g, -px, -5 - py, 2, 1, '#6a5a7a');
  // Rider: jersey, a knee to the pedal, an arm to the bars, and a tail.
  D.oval(g, 1, -10, 3, 2, '#c9a7e0');
  R(g, 3, -12, 1, 2, '#e0d4ff');
  R(g, 1 + Math.round(px / 2), -8, 2, 2 + Math.max(0, py), '#6a5a7a');
  R(g, -3, -11, 3, 1, '#c9a7e0');
  R(g, 4, -9, 3, 1, '#e0d8ec');
  R(g, 7, -10, 1, 1, '#e0d8ec');
  // Full-face helmet with goggles.
  D.disc(g, -2, -12, 3, '#f4a7b9');
  R(g, -5, -12, 2, 2, '#f4a7b9');
  R(g, -5, -13, 3, 1, P.gl1);
  R(g, -6, -11, 1, 1, P.p0);
  R(g, -1, -15, 2, 1, '#ffd0dc');
}

/* ── San Antonio: the colectivo bus and the port truck ──────────────────── */

/** A lilac micro with its destination board, mice at every window. */
function paintMicro(g: Ctx, f: number) {
  R(g, -21, -21, 42, 7, VINK);
  R(g, -20, -20, 40, 5, P.cream);
  escribir(g, 'CARTAGENA', -18, -20, VINK);
  R(g, -20, -15, 40, 11, V0);
  R(g, -19, -15, 38, 8, V);
  R(g, -19, -15, 38, 1, V1);
  R(g, -19, -8, 38, 1, P.white);
  R(g, -21, -13, 3, 5, P.gl1);
  mouse(g, -15, -9);
  for (let i = 0; i < 5; i++) {
    const wx = -10 + i * 6;
    R(g, wx, -13, 5, 4, P.gl1);
    if (i % 2) windowMouse(g, wx + 1, -9);
  }
  R(g, 16, -14, 3, 8, P.gl0);
  R(g, -21, -7, 2, 2, P.gold1);
  wheel(g, -12, -4, 3, f);
  wheel(g, 11, -4, 3, f);
}

/** A port truck hauling a terracotta container. */
function paintPortuario(g: Ctx, f: number) {
  // Container with corrugated ribs.
  R(g, -8, -19, 29, 12, '#a04a3a');
  R(g, -7, -18, 27, 10, '#e07a5f');
  R(g, -7, -18, 27, 1, '#f4a890');
  for (let x = -5; x < 20; x += 3) R(g, x, -16, 1, 7, '#c05a45');
  // Chassis and the cab with a mouse driver.
  R(g, -10, -7, 31, 3, P.metal0);
  R(g, -21, -17, 12, 12, V0);
  R(g, -20, -17, 10, 10, V);
  R(g, -20, -17, 10, 1, V1);
  R(g, -20, -15, 5, 4, P.gl1);
  mouse(g, -14, -10);
  R(g, -22, -8, 2, 2, P.gold);
  R(g, -11, -21, 2, 6, P.metal0);
  wheel(g, -15, -4, 3, f);
  wheel(g, 6, -4, 3, f);
  wheel(g, 14, -4, 3, f);
}

/** `below`: px of hull painted under the waterline (boats only). */
export const VEH_LOOK: Record<VehiculoTipo, { w: number; h: number; paint: (g: Ctx, f: number) => void; ink?: string; below?: number }> = {
  jeep: { w: 24, h: 18, paint: paintJeep },
  camion: { w: 34, h: 18, paint: paintCamion },
  tanque: { w: 30, h: 18, paint: paintTanque },
  sam: { w: 34, h: 24, paint: paintSam },
  margarita: { w: 56, h: 54, paint: paintMargarita, ink: '#6a2a4a' },
  lancha: { w: 26, h: 14, paint: paintLancha, below: 5 },
  fragata: { w: 44, h: 22, paint: paintFragata, below: 7 },
  portaaviones: { w: 150, h: 40, paint: paintPortaaviones, below: 9 },
  trolebus: { w: 40, h: 20, paint: paintTrolebus, ink: '#2a5a3a' },
  bici: { w: 16, h: 14, paint: paintBici },
  micro: { w: 40, h: 20, paint: paintMicro },
  portuario: { w: 42, h: 22, paint: paintPortuario },
};

export function vehicleSprite(k: VehiculoTipo, f: number) {
  const L = VEH_LOOK[k];
  return D.outlined(`veh|${k}|${f}`, L.ink ?? VINK, L.w + 6, L.h + 6 + (L.below ?? 0), L.w / 2 + 3, L.h + 2, (g) => L.paint(g, f));
}

const flashCache = new Map<HTMLCanvasElement, HTMLCanvasElement>();
/** A white silhouette of a sprite, for the hit flash. */
function white(src: HTMLCanvasElement) {
  let c = flashCache.get(src);
  if (!c) {
    c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    flashCache.set(src, c);
  }
  return c;
}

/**
 * A vehicle with its wheels at (x, y) on screen, tilted by `tilt` (screen
 * radians). `wheel` is the distance driven (turns the wheels), `aim` the
 * screen angle of the tank's barrel or the radar sweep.
 */
export function drawVehicle(g: Ctx, k: VehiculoTipo, x: number, y: number, tilt: number, wheelTurn: number, aim: number, t: number, flash: boolean) {
  const L = VEH_LOOK[k];
  const f = ((Math.floor(wheelTurn / 3) % 4) + 4) % 4;
  const img = vehicleSprite(k, f);
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(tilt / 0.06) * 0.06);
  if (k === 'tanque') {
    // The barrel follows the plane.
    g.save();
    g.translate(0, -14);
    g.rotate(aim);
    R(g, 0, -2, 13, 4, VINK);
    R(g, 0, -1, 12, 2, P.metal);
    R(g, 10, -2, 3, 4, P.metal0);
    g.restore();
  }
  if (k === 'portaaviones') {
    // AA barrels follow the plane, under the turret domes.
    for (const [tx, ty] of PORTAAVIONES_TORRETAS) {
      g.save();
      g.translate(tx, -ty);
      g.rotate(aim);
      R(g, 0, -1, 9, 3, VINK);
      R(g, 0, 0, 8, 1, P.metal);
      g.restore();
    }
  }
  const src = flash ? white(img) : img;
  if (L.below) {
    // Boats: the hull under the waterline shows faintly through the water.
    const top = L.h + 3;
    g.drawImage(src, 0, 0, src.width, top, -L.w / 2 - 3, -L.h - 2, src.width, top);
    g.globalAlpha = 0.5;
    g.drawImage(src, 0, top, src.width, src.height - top, -L.w / 2 - 3, 1, src.width, src.height - top);
    g.globalAlpha = 1;
  } else g.drawImage(src, -L.w / 2 - 3, -L.h - 2);
  if (k === 'margarita') {
    // She shakes her broom at the sky.
    g.save();
    g.translate(13, -30);
    g.rotate(-0.5 + Math.sin(t * 9) * 0.35);
    R(g, -1, -24, 3, 26, '#6a2a4a');
    R(g, 0, -23, 1, 24, P.k1);
    R(g, -4, -31, 9, 8, '#6a2a4a');
    R(g, -3, -30, 7, 6, P.gold);
    for (let i = -3; i < 4; i += 2) R(g, i, -30, 1, 6, P.gold0);
    g.restore();
  }
  if (k === 'portaaviones') {
    // Margarita shakes a little broom from the bridge.
    g.save();
    g.translate(34, -31);
    g.rotate(-0.5 + Math.sin(t * 9) * 0.35);
    R(g, -1, -11, 2, 12, '#6a2a4a');
    R(g, 0, -10, 1, 11, P.k1);
    R(g, -3, -15, 6, 5, '#6a2a4a');
    R(g, -2, -14, 4, 3, P.gold);
    g.restore();
  }
  if (k === 'trolebus') {
    // Two poles up to the overhead wire, bouncing a little.
    const b = Math.round(Math.sin(t * 7) * 0.6);
    for (const dx of [0, 3]) {
      for (let i = 0; i < 14; i++) R(g, 6 + dx + i, -21 - Math.round(i * 0.9) + (i > 10 ? b : 0), 1, 1, '#3e4a6b');
      R(g, 19 + dx, -34 + b, 2, 1, P.metal0);
    }
  }
  if (k === 'fragata' || k === 'portaaviones') {
    // Radar on the mast, always turning.
    const [rx, ry] = k === 'fragata' ? [1, -22] : [46, -39];
    const w = Math.round(Math.abs(Math.cos(t * 3)) * 3) + 1;
    D.oval(g, rx, ry, w, 1, VINK);
    R(g, rx - Math.max(0, w - 1), ry, Math.max(1, w * 2 - 1), 1, P.metal);
  }
  if (k === 'sam') {
    // Spinning radar dish.
    const w = Math.round(Math.abs(Math.cos(t * 3)) * 4) + 1;
    R(g, 13, -21, 1, 6, VINK);
    D.oval(g, 13, -22, w, 2, VINK);
    D.oval(g, 13, -22, Math.max(1, w - 1), 1, P.metal);
  }
  g.restore();
}

/* ── Weapons, flares, crates ─────────────────────────────────────────────── */

export type MissileLook = { cuerpo: string; punta: string; aletas: string; largo: number };

/**
 * A missile pointing along `angle` (screen radians). Enemy missiles pass their
 * type's look (colors and length); `blink` flashes the body white.
 */
export function drawMissile(g: Ctx, x: number, y: number, angle: number, enemy: boolean, burning: boolean, t: number, look?: MissileLook, blink = false) {
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(angle / 0.1) * 0.1);
  // Drawn ~15% shorter than their nominal length; thickness follows the nominal size.
  const base = look?.largo ?? 11;
  const len = Math.max(5, Math.round(base * 0.85));
  const thick = base >= 14 ? 5 : base <= 7 ? 3 : 4;
  const body = blink ? P.white : look?.cuerpo ?? (enemy ? '#f4f0ff' : P.white);
  const tip = look?.punta ?? (enemy ? P.p0 : P.red);
  const fins = look?.aletas ?? tip;
  const ink = enemy ? (look ? D.tone(look.punta, -0.45) : VINK) : P.red0;
  const x0 = -Math.floor(len / 2);
  const h = Math.floor(thick / 2);
  R(g, x0, -h, len, thick, ink);
  R(g, x0 + 1, -h + 1, len - 2, thick - 2, body);
  R(g, x0 + len - 2, -h + 1, 2, thick - 2, tip);
  R(g, x0 + len - 1, -h + 1 + (thick > 4 ? 1 : 0), 1, Math.max(1, thick - 2 - (thick > 4 ? 2 : 0)), tip);
  R(g, x0, -h - 1, 2, thick + 2, ink);
  R(g, x0 + 1, -h, 1, thick, fins);
  if (thick >= 4) R(g, x0 + 2, -h + 1, len - 5, 1, P.white);
  if (burning) {
    const fl = 2 + (Math.floor(t * 30) % 2) + (thick > 4 ? 2 : 0);
    R(g, x0 - fl, -1, fl, 2, '#ff9a3c');
    R(g, x0 - 2, -1, 1, 1, P.gold1);
  }
  g.restore();
}

export function drawBomb(g: Ctx, x: number, y: number, angle: number) {
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(angle / 0.15) * 0.15);
  D.oval(g, 0, 0, 5, 3, P.s0);
  D.oval(g, 0, 0, 4, 2, P.s1);
  R(g, -2, -1, 3, 1, P.s3);
  R(g, -7, -3, 2, 6, P.s0);
  R(g, -6, -2, 1, 4, P.s2);
  g.restore();
}

/** Things Margarita throws: a slipper, a tomato or a flower pot, spinning. */
export function drawJunk(g: Ctx, kind: 'chancla' | 'tomate' | 'macetero', x: number, y: number, spin: number) {
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(spin / 0.4) * 0.4);
  if (kind === 'chancla') {
    D.oval(g, 0, 0, 6, 3, '#2a5a9a');
    D.oval(g, 0, 0, 5, 2, P.w2);
    R(g, -1, -3, 4, 2, P.p1);
    R(g, -2, -2, 1, 1, '#2a5a9a');
  } else if (kind === 'tomate') {
    D.disc(g, 0, 0, 4, P.red0);
    D.disc(g, 0, 0, 3, P.red);
    R(g, -1, -2, 2, 1, P.white);
    R(g, -2, -5, 5, 2, P.g1);
  } else {
    R(g, -5, -4, 11, 9, '#8a3a1e');
    R(g, -4, -3, 9, 7, '#e07a4a');
    R(g, -5, -4, 11, 2, '#c05a2e');
    D.disc(g, 0, -7, 3, P.g1);
    R(g, -1, -11, 3, 3, P.r2);
  }
  g.restore();
}

/**
 * A speech bubble with its tail pointing down at (x, y). Words are drawn with
 * the game's rounded font; the bubble wraps to two lines when it's long.
 */
export function drawBubble(g: Ctx, x: number, y: number, text: string, vw: number) {
  g.font = 'bold 8px "Fredoka", "Nunito", sans-serif';
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > 150 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 12;
  const h = lines.length * 9 + 6;
  // Clear of the altimeter strip on the right edge.
  const bx = Math.round(Math.min(vw - w - 14, Math.max(2, x - w / 2)));
  const by = Math.round(y - h - 6);
  R(g, bx + 1, by - 1, w - 2, h + 2, '#6a2a4a');
  R(g, bx - 1, by + 1, w + 2, h - 2, '#6a2a4a');
  R(g, bx, by, w, h, '#6a2a4a');
  R(g, bx + 1, by, w - 2, h, P.white);
  R(g, bx, by + 1, w, h - 2, P.white);
  // Tail.
  const tx = Math.round(Math.min(bx + w - 8, Math.max(bx + 6, x)));
  for (let i = 0; i < 5; i++) {
    R(g, tx - 3 + i, by + h + i - 1, 6 - i * 1.2, 1, '#6a2a4a');
    R(g, tx - 2 + i, by + h + i - 1, Math.max(1, 4 - i * 1.2), 1, P.white);
  }
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillStyle = '#6a2a4a';
  lines.forEach((l, i) => g.fillText(l, bx + 5, by + 3 + i * 9));
  g.textBaseline = 'alphabetic';
  g.textAlign = 'center';
}

/**
 * A mouse on foot with a yellow hard hat, walking (phase `t`), maybe with a
 * plank on its shoulder. (x, y) are its feet; `dir` -1 faces left.
 */
export function drawWorker(g: Ctx, x: number, y: number, t: number, plank: boolean, dir: 1 | -1) {
  const X = Math.round(x);
  const Y = Math.round(y);
  const step = Math.floor(t * 8) % 2;
  g.save();
  g.translate(X, Y);
  g.scale(dir, 1);
  R(g, -2 + step, -2, 1, 2, '#6a5a7a');
  R(g, 1 - step, -2, 1, 2, '#6a5a7a');
  D.oval(g, 0, -4, 2, 2, VINK);
  D.oval(g, 0, -4, 2, 1, '#c8c0d8');
  D.disc(g, 1, -8, 2, VINK);
  D.disc(g, 1, -8, 2, '#e0d8ec');
  R(g, -1, -11, 2, 2, '#c8c0d8');
  R(g, 3, -8, 1, 1, P.p0);
  R(g, 0, -11, 4, 1, P.gold0);
  R(g, 0, -12, 3, 1, P.gold);
  R(g, -3, -4, 1, 1, '#c8c0d8');
  if (plank) {
    R(g, -6, -11, 11, 2, P.k0);
    R(g, -6, -11, 11, 1, P.k2);
  }
  g.restore();
}

/** One plank of a mouse-built bridge with its rail post; (x, y) is the deck top. */
export function bridgeColumn(g: Ctx, x: number, y: number, x0: number) {
  const k = (x - x0) % 5;
  R(g, x, y, 1, 3, k === 0 ? P.k0 : k % 2 ? P.k2 : P.k1);
  R(g, x, y + 3, 1, 1, P.k0);
  if (k === 0) R(g, x, y - 5, 1, 5, P.k0);
  R(g, x, y - 5, 1, 1, P.k1);
}

/**
 * Battle damage painted over a vehicle: scorch marks, dents and glowing
 * embers that grow with `amount` (0…1). Stable per vehicle (`seed`).
 */
export function scorchMarks(g: Ctx, k: VehiculoTipo, x: number, y: number, seed: number, amount: number, t: number) {
  const L = VEH_LOOK[k];
  const n = Math.round(amount * (k === 'margarita' || k === 'portaaviones' ? 22 : 10));
  for (let i = 0; i < n; i++) {
    const h = (Math.imul(seed + 7, 2654435761) ^ Math.imul(i + 3, 40503)) >>> 0;
    const px = Math.round(x - L.w / 2 + 3 + (h % Math.max(1, L.w - 6)));
    const py = Math.round(y - 4 - ((h >>> 8) % Math.max(1, L.h - 8)));
    R(g, px, py, 2 + (h % 2), 1, i % 3 === 0 ? '#4a3a5a' : '#6a5a7a');
    if (amount > 0.5 && i % 4 === 0 && Math.floor(t * 6 + i) % 2) R(g, px, py - 1, 1, 1, i % 8 ? '#ff9a3c' : P.gold);
  }
  // A crack across the hull when badly hurt.
  if (amount > 0.6) {
    const cx = Math.round(x - L.w / 4 + (seed % 7));
    for (let i = 0; i < 5; i++) R(g, cx + i, Math.round(y - L.h * 0.6) + (i % 2), 1, 1, '#3a2a4a');
  }
}

/** What a reward balloon gives: one more slot of missiles, bombs or flares. */
export type Premio = 'misil' | 'bomba' | 'bengala' | 'reparar' | 'especial' | 'vida' | 'nuclear';
const PRIZE_COL: Record<Premio, [string, string, string]> = {
  reparar: [P.g0, P.g2, P.g3],
  especial: ['#c8507a', '#ff8ac8', '#ffe0f0'],
  vida: ['#2f6ab8', '#7ab8ff', '#e0f0ff'],
  nuclear: ['#4a5a1a', '#c8e048', '#f4ffc0'],
  misil: [P.r0, P.r1, P.r3],
  bomba: ['#2a5a9a', '#74b4f0', '#d8f0ff'],
  bengala: [P.gold0, P.gold, P.gold1],
};

/**
 * A reward balloon. (x, y) is where its string ends (tied to an enemy, or
 * hanging free). `big` draws the bigger free-floating one with a glow.
 */
export function drawPrize(g: Ctx, x: number, y: number, kind: Premio, t: number, big: boolean) {
  const [c0, c1, c2] = PRIZE_COL[kind];
  const X = Math.round(x);
  const Y = Math.round(y);
  const sway = Math.round(Math.sin(t * 2.4 + x * 0.05) * 1.5);
  const r = big ? 7 : 5;
  const by = Y - (big ? 14 : 10) - r;
  // String.
  for (let i = 0; i < (big ? 14 : 10); i++) R(g, X + Math.round((sway * i) / 12), Y - i, 1, 1, '#8a7a9a');
  if ((big || kind === 'especial' || kind === 'vida' || kind === 'nuclear') && Math.floor(t * 3) % 2) {
    g.globalAlpha = 0.5;
    D.disc(g, X + sway, by, r + 3, c2);
    g.globalAlpha = 1;
  }
  D.disc(g, X + sway, by, r + 1, c0);
  D.disc(g, X + sway, by, r, c1);
  R(g, X + sway - Math.round(r / 2), by - Math.round(r / 2), 2, 2, c2);
  R(g, X + sway - 1, by + r + 1, 3, 1, c0);
  // The icon inside.
  const ix = X + sway;
  if (kind === 'misil') {
    R(g, ix - 2, by, 5, 1, P.white);
    R(g, ix + 3, by, 1, 1, P.red0);
    R(g, ix - 3, by - 1, 1, 3, P.white);
  } else if (kind === 'bomba') {
    D.disc(g, ix, by + 1, 2, '#2a2438');
    R(g, ix + 1, by - 2, 1, 2, P.gold);
  } else if (kind === 'vida') {
    // A little plane: one more life.
    R(g, ix - 3, by, 7, 1, P.white);
    R(g, ix - 1, by - 2, 2, 5, P.white);
    R(g, ix + 3, by - 1, 1, 3, P.white);
  } else if (kind === 'nuclear') {
    // The radiation trefoil, tiny.
    R(g, ix, by, 1, 1, '#2a2438');
    R(g, ix - 2, by - 3, 2, 2, '#2a2438');
    R(g, ix + 1, by - 3, 2, 2, '#2a2438');
    R(g, ix - 1, by + 2, 3, 2, '#2a2438');
  } else if (kind === 'especial') {
    // A golden star: a special upgrade from a downed fighter.
    R(g, ix, by - 3, 1, 7, P.gold1);
    R(g, ix - 3, by - 1, 7, 1, P.gold1);
    R(g, ix - 1, by - 1, 3, 3, P.gold);
    R(g, ix - 2, by + 2, 1, 1, P.gold);
    R(g, ix + 2, by + 2, 1, 1, P.gold);
  } else if (kind === 'reparar') {
    // A little wrench.
    for (let i = 0; i < 4; i++) R(g, ix - 2 + i, by + 2 - i, 1, 1, P.white);
    R(g, ix + 1, by - 3, 1, 2, P.white);
    R(g, ix + 3, by - 2, 1, 2, P.white);
  } else {
    R(g, ix, by - 2, 1, 5, P.white);
    R(g, ix - 2, by, 5, 1, P.white);
  }
}

export function drawShell(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 1, 3, 3, VINK);
  R(g, x, y, 1, 1, P.gold);
}

export function drawFlare(g: Ctx, x: number, y: number, t: number) {
  const k = Math.floor(t * 20) % 2;
  D.disc(g, x, y, 2 + k, P.gold);
  R(g, x - 1, y - 1, 2, 2, P.white);
  if (k) {
    R(g, x - 4, y, 9, 1, P.gold1);
    R(g, x, y - 4, 1, 9, P.gold1);
  }
}

/** A tin of fish under a little parachute. (x, y) is the tin. */
export function drawCrate(g: Ctx, x: number, y: number, sway: number, chute: boolean) {
  const X = Math.round(x);
  const Y = Math.round(y);
  if (chute) {
    const s = Math.round(sway * 2);
    R(g, X - 5 + s, Y - 12, 1, 9, P.metal0);
    R(g, X + 4 + s, Y - 12, 1, 9, P.metal0);
    D.oval(g, X + s, Y - 15, 9, 5, P.r0);
    D.oval(g, X + s, Y - 15, 8, 4, P.r2);
    R(g, X - 8 + s, Y - 14, 16, 2, P.r2);
    R(g, X - 3 + s, Y - 18, 4, 1, P.r3);
    R(g, X - 8 + s, Y - 13, 16, 1, P.r0);
  }
  D.oval(g, X, Y, 6, 4, P.w0);
  D.oval(g, X, Y - 1, 5, 3, P.metal);
  R(g, X - 5, Y, 10, 2, P.w1);
  // A fish on the label.
  R(g, X - 3, Y - 2, 4, 2, P.o2);
  R(g, X + 1, Y - 3, 2, 1, P.o2);
  R(g, X + 1, Y, 2, 1, P.o2);
  R(g, X - 2, Y - 2, 1, 1, P.eye);
}

/* ── Explosions, smoke and sparks ────────────────────────────────────────── */

export function drawPuff(g: Ctx, x: number, y: number, r: number, dark: boolean, alpha: number) {
  g.globalAlpha = Math.round(alpha * 4) / 4;
  if (g.globalAlpha > 0) {
    D.disc(g, x, y, Math.max(1, Math.round(r)), dark ? '#8a7aa8' : '#c8c0e0');
    D.disc(g, x - 1, y - 1, Math.max(1, Math.round(r) - 1), dark ? '#a898c4' : '#f4f0ff');
  }
  g.globalAlpha = 1;
}

/* ── Ground, scenery and the pantry ──────────────────────────────────────── */

const hash = (x: number, s = 0) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(s | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

export const DECO_H = 48;
export const DIRT = 16;

/**
 * The whole level's ground as one strip, painted once: grass with a scalloped
 * edge and an outline, polka-dot dirt, bushes, lollipop trees, flowers and the
 * pantry at the left end. Row 0 is altitude `top`; the bottom row is -DIRT.
 */
export function groundStrip(length: number, heightAt: (x: number) => number, pantry: { x0: number; x1: number }) {
  let top = 0;
  for (let x = 0; x < length; x++) top = Math.max(top, heightAt(x));
  top = Math.ceil(top) + DECO_H;
  const c = document.createElement('canvas');
  c.width = length;
  c.height = top + DIRT;
  const g = c.getContext('2d')!;
  const rowOf = (alt: number) => top - alt;
  for (let x = 0; x < length; x++) {
    const h = Math.round(heightAt(x));
    const y0 = rowOf(h);
    // Dirt with world-anchored polka dots, deeper rows rosier.
    R(g, x, y0, 1, c.height - y0, P.d2);
    R(g, x, rowOf(4), 1, c.height - rowOf(4), P.e1);
    const sec = sectorSA(x);
    const hn = Math.round(heightAt(x + 1));
    let ink: string = P.g0;
    if (sec === 3) {
      // The port: paved quay with expansion joints.
      ink = '#7a7490';
      R(g, x, y0, 1, 6, ink);
      R(g, x, y0, 1, 5, x % 10 === 0 ? '#aaa6bc' : '#c8c4d4');
      R(g, x, y0, 1, 1, '#e4e0ee');
    } else if (sec === 4) {
      // Cartagena: grey sand, a little speckled.
      ink = '#a89c88';
      R(g, x, y0, 1, 7, '#c9bfae');
      R(g, x, y0, 1, 1, '#ddd4c4');
      if ((x * 7) % 5 === 0) R(g, x, y0 + 2 + (x % 3), 1, 1, '#ece6da');
    } else {
      const scal = 5 + (x % 8 < 4 ? 1 : x % 8 === 4 || x % 8 === 7 ? 0 : -1);
      // Llolleo's grass is a bit more olive (wetland), the rest bright.
      R(g, x, y0, 1, scal + 1, P.g0);
      R(g, x, y0, 1, scal, sec === 1 ? '#7cb85a' : P.g1);
      R(g, x, y0 + 1, 1, 2, sec === 1 ? '#a8cc70' : P.g2);
      if (x % 6 === 2) R(g, x, y0 + 1, 1, 1, P.g3);
    }
    // Outline along the top, joined where the slope steps.
    R(g, x, Math.min(y0, rowOf(hn)) - 1, 1, Math.abs(hn - h) + 1, ink);
  }
  // Polka dots on a staggered grid.
  for (let gy = 0; gy < c.height; gy += 8)
    for (let gx = (gy / 8) % 2 ? 4 : 0; gx < length; gx += 8) {
      const surf = rowOf(Math.round(heightAt(gx))) + 8;
      if (gy < surf) continue;
      const deep = gy > rowOf(4);
      R(g, gx + 1, gy, 2, 4, deep ? P.e2 : P.d3);
      R(g, gx, gy + 1, 4, 2, deep ? P.e2 : P.d3);
      if (!deep) R(g, gx + 1, gy + 1, 1, 1, P.white);
    }

  // Scenery by sector, kept clear of the pantry.
  const surfY = (x: number) => rowOf(Math.round(heightAt(x))) + 1;
  const libre = (x: number) => x > pantry.x1 + 30 && x < length - 12;
  // San Juan: two ponds (tranques), eucalyptus and a fence.
  for (const x of [210, 330]) if (libre(x)) tranque(g, x, surfY(x));
  for (let x = pantry.x1 + 34; x < 400; x += 16 + (hash(x, 1) % 22)) if (libre(x) && Math.abs(x - 210) > 16 && Math.abs(x - 330) > 16) eucaliptoCerca(g, x, surfY(x), 28 + (hash(x, 2) % 16));
  // Llolleo: totora reeds, little lagoons and white herons.
  for (let x = 410; x < 1100; x += 8 + (hash(x, 3) % 18)) {
    if (!libre(x)) continue;
    const k = hash(x, 4) % 10;
    if (k < 6) totoraCerca(g, x, surfY(x), x);
    else if (k < 8) charco(g, x, surfY(x));
    else garzaCerca(g, x, surfY(x));
  }
  // Barrancas: concrete stairs with railings, a corner store and lamp posts.
  for (const x of [1160, 1290, 1560, 1650]) if (libre(x)) escalinata(g, x, surfY(x));
  if (libre(1420)) almacen(g, 1420, surfY(1440));
  for (let x = 1120; x < 1700; x += 70) if (libre(x) && Math.abs(x - 1440) > 40) faro(g, x, surfY(x));
  // The port: containers, bollards, a fried-fish stall, sea lions and pelicans on posts.
  for (let x = 1730; x < 2700; x += 50 + (hash(x, 5) % 50)) {
    if (!libre(x) || Math.abs(x - 2200) < 60 || Math.abs(x - 2400) < 50) continue;
    pilaContenedores(g, x, surfY(x) + 1, 1 + (hash(x, 6) % 3), hash(x, 7));
  }
  for (let x = 1760; x < 2700; x += 37) if (libre(x)) {
    R(g, x, surfY(x) - 3, 3, 3, '#3e4a6b');
    R(g, x - 1, surfY(x) - 4, 5, 1, '#3e4a6b');
  }
  if (libre(2200)) fritura(g, 2180, surfY(2200));
  for (const x of [2380, 2410]) if (libre(x)) loboMarino(g, x, surfY(x), x === 2410);
  for (const x of [2300, 2470]) if (libre(x)) {
    R(g, x, surfY(x) - 10, 3, 10, P.k0);
    pelicanoCerca(g, x + 1, surfY(x) - 10);
  }
  // Cartagena: the white railing of the terrace, parasols and towels.
  for (let x = 2720; x < length - 4; x++) {
    const y = surfY(x);
    if (x % 6 === 0) R(g, x, y - 7, 1, 7, P.white);
    R(g, x, y - 8, 1, 1, P.white);
    R(g, x, y - 7, 1, 1, '#c8c4d4');
  }
  for (let x = 2760; x < length - 20; x += 46 + (hash(x, 8) % 40)) quitasol(g, x, surfY(x), hash(x, 9));

  paintPantry(g, pantry.x0, rowOf(Math.round(heightAt(pantry.x0 + 30))) + 1);
  return { canvas: c, top };
}

/**
 * The pantry: a pink storehouse with a fish sign and crates of tins.
 * `px` is its left wall, `base` the canvas row just under its floor.
 */
export function paintPantry(g: Ctx, px: number, base: number) {
  const W = 64;
  R(g, px, base - 30, W, 30, P.b0);
  R(g, px + 1, base - 29, W - 2, 29, P.b1);
  for (let yy = base - 27; yy < base; yy += 5) R(g, px + 1, yy, W - 2, 1, P.b2);
  // Rounded-tile roof.
  for (let i = 0; i < 8; i++) R(g, px - 4 + i, base - 31 - i, W + 8 - i * 2, 1, P.r0);
  for (let i = 0; i < 7; i++) R(g, px - 3 + i, base - 31 - i, W + 6 - i * 2, 1, i % 3 === 1 ? P.r2 : P.r1);
  // Big door.
  R(g, px + 22, base - 18, 20, 18, P.k0);
  R(g, px + 23, base - 17, 18, 17, P.k1);
  R(g, px + 31, base - 17, 1, 17, P.k0);
  // Fish sign.
  R(g, px + 18, base - 29, 28, 9, P.k0);
  R(g, px + 19, base - 28, 26, 7, P.cream);
  D.oval(g, px + 31, base - 25, 6, 2, P.w1);
  R(g, px + 37, base - 27, 2, 5, P.w1);
  R(g, px + 27, base - 26, 1, 1, P.eye);
  // Crates of tins by the door.
  for (const [dx, dy] of [[4, 0], [12, 0], [8, 7]] as const) {
    const cx = px + dx;
    const cy = base - 7 - dy;
    R(g, cx - 1, cy - 1, 9, 8, P.k0);
    R(g, cx, cy, 7, 6, P.k2);
    R(g, cx, cy + 2, 7, 1, P.k1);
    R(g, cx + 2, cy - 1, 3, 1, P.metal);
  }
}

/** Which San Antonio sector a world x is in (0 San Juan … 4 Cartagena), with a ragged border. */
function sectorSA(x: number) {
  const j = x + (hash(x, 99) % 13) - 6;
  return j < 400 ? 0 : j < 1100 ? 1 : j < 1700 ? 2 : j < 2700 ? 3 : 4;
}

function tranque(g: Ctx, x: number, y: number) {
  D.oval(g, x, y + 2, 13, 3, P.g0);
  D.oval(g, x, y + 2, 12, 2, P.w1);
  R(g, x - 8, y + 1, 10, 1, P.w2);
  R(g, x + 4, y + 2, 4, 1, P.w3);
  for (const dx of [-14, -12, 12, 14]) R(g, x + dx, y - 5, 1, 6, '#8a9a50');
}

function eucaliptoCerca(g: Ctx, x: number, y: number, alto: number) {
  R(g, x - 1, y - alto, 3, alto, '#b8a890');
  R(g, x, y - alto, 1, alto, '#f0e6d4');
  R(g, x - 1, y - alto + 8, 1, 3, '#8a7a68');
  const cy = Math.round(y - alto * 0.7);
  const ry = Math.round(alto * 0.36);
  D.oval(g, x, cy, 6, ry + 1, '#4e6e5e');
  D.oval(g, x - 4, cy + 6, 4, Math.round(ry * 0.55) + 1, '#4e6e5e');
  D.oval(g, x, cy, 5, ry, '#7f9c8a');
  D.oval(g, x - 4, cy + 6, 3, Math.round(ry * 0.55), '#7f9c8a');
  D.oval(g, x - 1, cy - Math.round(ry * 0.4), 2, Math.round(ry * 0.4), '#a8c0b0');
}

function totoraCerca(g: Ctx, x: number, y: number, seed: number) {
  for (let i = 0; i < 7; i++) {
    const h = 7 + (hash(seed, i) % 8);
    const xx = x + i * 2 - 6;
    R(g, xx, y - h, 1, h, i % 2 ? '#a7b46b' : '#7f8f48');
    if (i % 2 === 0) R(g, xx, y - h - 2, 1, 3, '#8a6a40');
  }
}

function charco(g: Ctx, x: number, y: number) {
  D.oval(g, x, y + 1, 7, 2, '#5a8a6a');
  D.oval(g, x, y + 1, 6, 1, P.w1);
  R(g, x - 3, y + 1, 4, 1, P.w3);
}

function garzaCerca(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 5, 1, 5, '#5a5a6a');
  R(g, x + 2, y - 5, 1, 5, '#5a5a6a');
  D.oval(g, x, y - 8, 4, 2, '#8a90b0');
  D.oval(g, x, y - 8, 3, 2, P.white);
  R(g, x + 3, y - 15, 2, 6, P.white);
  R(g, x + 3, y - 16, 3, 2, P.white);
  R(g, x + 6, y - 15, 3, 1, '#ffc040');
  R(g, x + 4, y - 16, 1, 1, P.eye);
}

/** Concrete stairs climbing a little wall, with a handrail. */
function escalinata(g: Ctx, x: number, y: number) {
  for (let i = 0; i < 5; i++) {
    R(g, x + i * 3, y - (i + 1) * 3, 16 - i * 3, 3, '#7a7490');
    R(g, x + i * 3, y - (i + 1) * 3, 16 - i * 3, 1, '#e4e0ee');
    R(g, x + i * 3, y - (i + 1) * 3 + 1, 16 - i * 3, 2, '#c8c4d4');
  }
  for (let i = 0; i < 15; i++) R(g, x + i, y - 9 - Math.round(i), 1, 1, '#3e4a6b');
  R(g, x, y - 9, 1, 6, '#3e4a6b');
  R(g, x + 14, y - 23, 1, 6, '#3e4a6b');
}

/** The corner store: pastel walls, an awning, a sign and goods in the window. */
function almacen(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 27, 42, 27, '#3e4a6b');
  R(g, x, y - 26, 40, 26, '#f2cc8f');
  for (let i = 0; i < 42; i++) R(g, x - 1 + i, y - 16, 1, 3, Math.floor(i / 4) % 2 ? P.white : '#e86a5c');
  R(g, x + 3, y - 12, 14, 9, P.white);
  R(g, x + 4, y - 11, 12, 7, P.gl1);
  for (let i = 0; i < 4; i++) R(g, x + 5 + i * 3, y - 7, 2, 3, [P.red, P.gold, P.g1, P.p1][i]);
  R(g, x + 24, y - 12, 9, 12, P.k0);
  R(g, x + 25, y - 11, 7, 11, P.k1);
  R(g, x + 30, y - 6, 1, 1, P.gold);
  R(g, x + 2, y - 25, 36, 8, P.cream);
  escribir(g, 'ALMACEN', x + 6, y - 24, '#3a5ab0');
  R(g, x - 2, y - 28, 44, 2, '#c0605a');
}

function faro(g: Ctx, x: number, y: number) {
  R(g, x, y - 16, 1, 16, '#3e4a6b');
  R(g, x, y - 17, 4, 1, '#3e4a6b');
  R(g, x + 2, y - 16, 3, 2, P.gold1);
}

/** A stack of shipping containers on the quay. */
function pilaContenedores(g: Ctx, x: number, y: number, n: number, seed: number) {
  const COLS = ['#e07a5f', '#3d85c6', '#f2cc8f', '#8fd3c8', '#c9a7e0'];
  for (let j = 0; j < n; j++) {
    const c = COLS[(seed >>> (j * 3)) % COLS.length];
    const xx = x + ((seed >>> (j + 5)) % 2) * 3;
    const yy = y - 9 * (j + 1);
    R(g, xx - 1, yy - 1, 22, 10, '#3e4a6b');
    R(g, xx, yy, 20, 8, c);
    R(g, xx, yy, 20, 1, D.tone(c, 0.3));
    for (let i = 2; i < 20; i += 3) R(g, xx + i, yy + 2, 1, 5, D.tone(c, -0.2));
  }
}

/** A fried-fish stall with a striped awning: «FRITURA». */
function fritura(g: Ctx, x: number, y: number) {
  R(g, x, y - 22, 2, 22, P.k0);
  R(g, x + 38, y - 22, 2, 22, P.k0);
  for (let i = 0; i < 44; i++) R(g, x - 2 + i, y - 26, 1, 5, Math.floor(i / 5) % 2 ? P.white : '#f4a7b9');
  R(g, x - 2, y - 27, 44, 1, '#c05a7a');
  R(g, x, y - 10, 40, 10, P.k0);
  R(g, x + 1, y - 9, 38, 9, P.k2);
  R(g, x + 6, y - 35, 28, 9, P.k0);
  R(g, x + 7, y - 34, 26, 7, P.cream);
  escribir(g, 'FRITURA', x + 8, y - 33, '#c05a7a');
  // Golden empanadas on the counter.
  for (let i = 0; i < 4; i++) {
    D.oval(g, x + 8 + i * 8, y - 11, 3, 1, P.gold0);
    R(g, x + 6 + i * 8, y - 12, 4, 1, P.gold);
  }
}

/** A sea lion napping on the quay (one of them sneezes in the motor, maybe). */
function loboMarino(g: Ctx, x: number, y: number, flip: boolean) {
  const d = flip ? -1 : 1;
  D.oval(g, x, y - 3, 8, 3, '#5a4030');
  D.oval(g, x, y - 3, 7, 2, '#8a6a55');
  D.disc(g, x + d * 8, y - 6, 3, '#5a4030');
  D.disc(g, x + d * 8, y - 6, 2, '#a88a70');
  R(g, x + d * 10, y - 6, 1, 1, P.eye);
  R(g, x + d * 9 + (flip ? -2 : 1), y - 4, 2, 1, '#e8dcc8');
  R(g, x - d * 9, y - 2, 3, 2, '#5a4030');
}

function pelicanoCerca(g: Ctx, x: number, y: number) {
  D.oval(g, x, y - 3, 4, 2, '#8a8090');
  D.oval(g, x, y - 3, 3, 2, '#b8b0bc');
  R(g, x + 2, y - 9, 3, 5, '#fff4e0');
  R(g, x + 5, y - 8, 5, 1, '#ffc040');
  R(g, x + 5, y - 7, 4, 1, '#e09a30');
  R(g, x + 3, y - 8, 1, 1, P.eye);
}

/** A beach parasol with a towel under it. */
function quitasol(g: Ctx, x: number, y: number, seed: number) {
  const c = ['#f4a7b9', '#ffd27f', '#8fd3c8', '#c9a7e0'][seed % 4];
  R(g, x, y - 16, 1, 16, '#8a7a9a');
  D.oval(g, x, y - 17, 8, 3, D.tone(c, -0.3));
  D.oval(g, x, y - 17, 7, 2, c);
  for (let i = -6; i <= 6; i += 4) R(g, x + i, y - 18, 2, 2, P.white);
  R(g, x + 3, y - 1, 10, 1, ['#9ec5e8', '#f6b38e'][seed % 2]);
}

/** The pantry's flag, flapping. (x, y) is the foot of the pole on screen. */
export function drawFlag(g: Ctx, x: number, y: number, t: number) {
  R(g, x, y - 34, 2, 34, P.metal0);
  R(g, x - 1, y - 36, 4, 2, P.gold0);
  for (let i = 0; i < 14; i++) {
    const w = Math.round(Math.sin(t * 6 - i * 0.6) * 1.5);
    R(g, x + 2 + i, y - 33 + w, 1, 9, i % 4 < 2 ? P.o2 : P.cream);
    R(g, x + 2 + i, y - 34 + w, 1, 1, P.o0);
    R(g, x + 2 + i, y - 24 + w, 1, 1, P.o0);
  }
}

/** A small paw-print target bracket around (x, y). */
export function drawLock(g: Ctx, x: number, y: number, r: number, t: number) {
  if (Math.floor(t * 6) % 2) return;
  const X = Math.round(x), Y = Math.round(y);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    R(g, X + sx * r - (sx < 0 ? 0 : 3), Y + sy * r - (sy < 0 ? 0 : 0), 4, 1, P.red);
    R(g, X + sx * r - (sx < 0 ? 0 : 0), Y + sy * r - (sy < 0 ? 0 : 3), 1, 4, P.red);
  }
}
