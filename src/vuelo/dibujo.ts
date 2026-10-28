import * as D from '../game/dulce';
import { P } from '../game/dulce';
import type { ModeloAvion, Piloto } from './fisica-tipos';
import { anchoLetrero, escribir } from './fondo';
import { LOOKS_EXTRA, PAINT_EXTRA } from './aviones-extra';

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
  // Fat cheeks and a double chin.
  D.oval(g, x, y - 1, 5, 2, P.o2);
  R(g, x - 2, y + 1, 5, 1, P.o1);
  R(g, x + 2, y, 3, 1, P.cream);
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

/** Almendrita: a senior Yorkshire, warm brown face, black saddle, grey muzzle and a pink bow. */
function almendritaHead(g: Ctx, x: number, y: number) {
  const T = '#cc8c4c', T0 = '#9a6030', GR = '#d8d0ca', N = '#2a2430';
  // Pointy ears with dark tips.
  R(g, x - 4, y - 9, 2, 3, T0);
  R(g, x - 3, y - 10, 1, 1, N);
  R(g, x - 4, y - 9, 1, 1, N);
  R(g, x + 2, y - 9, 2, 3, T0);
  R(g, x + 3, y - 10, 1, 1, N);
  R(g, x + 3, y - 9, 1, 1, N);
  D.disc(g, x, y - 3, 4, T);
  // Black saddle down the back of the head, and a greying muzzle.
  R(g, x - 4, y - 5, 3, 2, N);
  R(g, x - 4, y - 3, 2, 3, N);
  D.oval(g, x + 3, y - 2, 2, 2, GR);
  R(g, x + 5, y - 3, 1, 1, '#2a2030');
  // A soft, droopy eye under a grey brow.
  R(g, x + 1, y - 6, 2, 1, GR);
  R(g, x + 1, y - 5, 2, 2, P.eye);
  R(g, x + 1, y - 5, 2, 1, T0);
  R(g, x + 1, y - 4, 1, 1, P.white);
  R(g, x + 3, y, 1, 1, P.p1);
  // A pink bow on the top-knot.
  R(g, x - 2, y - 9, 2, 2, P.r2);
  R(g, x + 1, y - 9, 2, 2, P.r2);
  R(g, x, y - 8, 1, 1, P.r0);
}

/** Brown skin for the two humans of the squadron: shadow, base, light. */
const PIEL = ['#6e3e1e', '#9a5c30', '#c07c48'] as const;

/**
 * Naxo: CESFAM nurse with a luchador's build, a round face, a punk crest
 * over buzzed sides, a big mustache and round dark Ozzy-style glasses on a
 * thin wire. Looking forward (+x); (x, y) is the chin.
 */
function naxoHead(g: Ctx, x: number, y: number) {
  const [S0, S, S1] = PIEL, H = '#2a1e1a', L = '#1c1622', RAP = '#5e3820';
  D.disc(g, x, y - 3, 4, S);
  // Full round cheeks and a round jaw.
  D.oval(g, x + 1, y - 1, 5, 3, S);
  R(g, x - 2, y - 2, 2, 2, S0);
  R(g, x + 1, y - 6, 3, 1, S1);
  R(g, x + 3, y - 2, 1, 1, '#b85a40');
  // Buzzed side of the head and the spiky crest along the top.
  R(g, x - 4, y - 7, 7, 1, RAP);
  R(g, x - 4, y - 6, 2, 3, RAP);
  R(g, x - 3, y - 6, 1, 1, H);
  R(g, x - 4, y - 4, 1, 1, H);
  R(g, x - 3, y - 8, 6, 1, H);
  R(g, x - 4, y - 10, 1, 2, H);
  R(g, x - 2, y - 11, 1, 3, H);
  R(g, x, y - 12, 1, 4, H);
  R(g, x + 2, y - 10, 1, 2, H);
  R(g, x, y - 11, 1, 1, '#5a4a42');
  R(g, x - 2, y - 5, 2, 2, S0);
  // The round dark lens and its wire to the ear.
  R(g, x - 1, y - 5, 2, 1, '#9a8a7a');
  D.disc(g, x + 2, y - 4, 1, L);
  R(g, x + 2, y - 5, 1, 1, '#6a6a8e');
  // A broad nose and the mustache, drooping at the corner.
  R(g, x + 4, y - 3, 2, 2, S);
  R(g, x + 5, y - 2, 1, 1, S0);
  R(g, x + 1, y - 1, 5, 1, H);
  R(g, x + 1, y, 2, 1, H);
  R(g, x + 3, y, 2, 1, '#5a2a24');
}

/** Ñelo: black jockey cap with the visor forward, black sunglasses, round cheeks, the hood behind. */
function neloHead(g: Ctx, x: number, y: number) {
  const [S0, S, S1] = PIEL, C = '#1e1c24', C1 = '#3e3c4a', N = '#0c0a10';
  // The hoodie's hood bunched behind the neck.
  D.oval(g, x - 3, y - 1, 3, 3, '#26242c');
  D.disc(g, x, y - 3, 4, S);
  D.oval(g, x + 1, y - 1, 5, 2, S);
  D.oval(g, x + 1, y + 1, 3, 1, S);
  R(g, x - 2, y - 2, 2, 2, S0);
  R(g, x + 3, y - 2, 2, 1, S1);
  // The cap: crown, a light seam and the visor sticking out in front.
  R(g, x - 4, y - 9, 8, 3, C);
  R(g, x - 3, y - 10, 6, 1, C);
  R(g, x - 2, y - 9, 3, 1, C1);
  R(g, x + 3, y - 7, 5, 1, C);
  R(g, x + 3, y - 6, 4, 1, N);
  R(g, x - 4, y - 6, 2, 1, C);
  // Black sunglasses with a cold glint.
  R(g, x - 2, y - 5, 2, 1, N);
  R(g, x, y - 5, 5, 2, N);
  R(g, x + 2, y - 5, 2, 1, '#6a7aa8');
  R(g, x + 4, y - 3, 2, 2, S);
  R(g, x + 2, y, 3, 1, '#5a2a24');
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
  /** Saucer underglow centre [x, y]: pulses where a jet would have its flame. */
  glow?: [number, number];
  /** Pilot sits under a closed dome: no scarf flapping in the wind. */
  cupula?: boolean;
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
  raptor: {
    ink: '#323846', w: 38, h: 20, jet: [-17, 0], scarf: [2, -6], scarfC: ['#3a6ad8', '#8ab4ff'], rack: [0, 2],
    parts: { cola: [-12, -5], ala: [-3, 3], motor: [-16, 0] },
  },
  sukhoi: {
    ink: '#28324a', w: 40, h: 20, jet: [-18, 2], scarf: [4, -6], scarfC: [P.red, P.gold], rack: [-2, 4],
    parts: { cola: [-13, -5], ala: [-3, 4], motor: [-16, 2], cabina: [8, -3] },
  },
  b2: {
    ink: '#121218', w: 52, h: 18, jet: [-15, 0], scarf: [8, -6], scarfC: [P.teal0, P.teal], rack: [0, 3],
    parts: { ala: [-19, 0], motor: [2, -5], cabina: [14, -3], bodega: [1, 3] },
  },
  ovni: {
    ink: '#3a3e58', w: 34, h: 18, glow: [0, 7], cupula: true, scarf: [-3, -6], scarfC: ['#5affc8', '#c8fff0'], rack: [0, 5],
    parts: { cabina: [0, -4], motor: [0, 5], ala: [-12, 2] },
  },
  tomcat: {
    ink: '#2c3240', w: 40, h: 20, jet: [-18, 0], scarf: [6, -6], scarfC: ['#3a8ad8', '#ffe048'], rack: [-2, 4],
    parts: { cola: [-14, -5], ala: [-8, 3], motor: [-17, 0], cabina: [7, -4] },
  },
  a10: {
    ink: '#2c3426', w: 42, h: 20, jet: [-13, -6], scarf: [7, -6], scarfC: ['#d86a3a', '#ffd08a'], rack: [0, 4],
    parts: { cola: [-17, -4], ala: [0, 3], motor: [-8, -6], cabina: [10, -4], bodega: [-2, 6] },
  },
  spitfire: {
    ink: '#2c3222', w: 36, h: 20, prop: [15, 0, 5], scarf: [-3, -6], scarfC: ['#e8e2d6', P.white], rack: [0, 3],
    parts: { cola: [-14, -4], ala: [0, 3], motor: [11, -1], cabina: [1, -4] },
  },
  stuka: {
    ink: '#232c1c', w: 40, h: 22, prop: [18, 0, 5], scarf: [0, -6], scarfC: ['#ffd23a', '#fff2a8'], rack: [-3, 5],
    parts: { cola: [-16, -4], ala: [0, 3], motor: [15, 0], cabina: [0, -5], bodega: [-3, 5] },
  },
  mustang: {
    ink: '#3a3e4c', w: 36, h: 20, prop: [16, 0, 5], scarf: [-4, -6], scarfC: ['#ff4a5a', P.white], rack: [0, 3],
    parts: { cola: [-14, -4], ala: [1, 3], motor: [13, 0], cabina: [-1, -4] },
  },
  corsair: {
    ink: '#101830', w: 38, h: 20, prop: [17, 0, 6], scarf: [-6, -6], scarfC: [P.white, '#ffd23a'], rack: [0, 3],
    parts: { cola: [-15, -4], ala: [1, 3], motor: [14, 0], cabina: [-2, -4] },
  },
  f16: {
    ink: '#2e3440', w: 38, h: 20, jet: [-19, 0], scarf: [4, -6], scarfC: ['#ff6a9a', '#ffd0e0'], rack: [-2, 3],
    parts: { cola: [-13, -5], ala: [-4, 3], motor: [-18, 0], cabina: [6, -4] },
  },
  mig29: {
    ink: '#262e3e', w: 40, h: 20, jet: [-20, 2], scarf: [5, -6], scarfC: ['#ffb03a', '#fff0a0'], rack: [-2, 4],
    parts: { cola: [-15, -5], ala: [-5, 3], motor: [-17, 2], cabina: [8, -4] },
  },
  // The second batch: classics, Chilean favourites, modern jets and the box (aviones-extra.ts).
  ...LOOKS_EXTRA,
};

/* ── Who's flying: any pilot can take any plane ─────────────────────────── */

let piloto: Piloto = 'dui';

/** Sets the pilot drawn in every cockpit from now on (part of every sprite cache key). */
export function fijarPiloto(p: Piloto) {
  piloto = p;
}

/** The pilot currently drawn in the cockpits. */
export function pilotoActual(): Piloto {
  return piloto;
}

/** Small pilot heads for the cockpit (the big ones are for the hangar portraits). (x, y) is the chin. */
export function miniHead(g: Ctx, m: Piloto, x: number, y: number) {
  if (m === 'naxo') {
    // Round face, buzzed side, the punk crest's spikes on top.
    const [S0, S] = PIEL, H = '#2a1e1a';
    D.disc(g, x, y - 3, 3, S);
    D.oval(g, x + 1, y - 1, 3, 2, S);
    R(g, x - 3, y - 6, 3, 2, '#4e3222');
    R(g, x - 3, y - 7, 5, 1, H);
    R(g, x - 2, y - 8, 1, 1, H);
    R(g, x, y - 9, 1, 2, H);
    R(g, x + 2, y - 8, 1, 1, H);
    R(g, x - 2, y - 4, 1, 2, S0);
    R(g, x - 1, y - 4, 2, 1, '#9a8a7a');
    R(g, x + 1, y - 5, 2, 2, '#1c1622');
    R(g, x + 1, y - 5, 1, 1, '#6a6a8e');
    R(g, x + 3, y - 3, 1, 2, S);
    R(g, x + 1, y - 1, 4, 1, H);
    R(g, x + 1, y, 1, 1, H);
  } else if (m === 'nelo') {
    const [S0, S] = PIEL, C = '#1e1c24';
    D.disc(g, x, y - 3, 3, S);
    D.oval(g, x + 1, y - 1, 4, 1, S);
    R(g, x - 4, y - 3, 1, 3, '#26242c');
    R(g, x - 2, y - 3, 1, 2, S0);
    R(g, x - 3, y - 7, 6, 2, C);
    R(g, x - 2, y - 8, 4, 1, C);
    R(g, x - 1, y - 7, 2, 1, '#3e3c4a');
    R(g, x + 3, y - 6, 3, 1, C);
    R(g, x, y - 4, 4, 1, '#0c0a10');
    R(g, x + 1, y - 4, 1, 1, '#6a7aa8');
    R(g, x + 2, y - 1, 2, 1, '#5a2a24');
  } else if (m === 'dui') {
    R(g, x - 3, y - 7, 2, 2, P.o1);
    R(g, x + 1, y - 7, 2, 2, P.o1);
    D.disc(g, x, y - 3, 3, P.o2);
    D.oval(g, x, y - 1, 4, 1, P.o2);
    R(g, x - 1, y, 3, 1, P.o1);
    R(g, x - 2, y - 5, 2, 1, P.o3);
    R(g, x - 3, y - 4, 6, 1, P.k0);
    R(g, x + 1, y - 4, 2, 2, P.gl1);
    R(g, x + 2, y - 1, 1, 1, P.blush);
  } else if (m === 'lulu') {
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
    R(g, x - 3, y - 7, 1, 2, '#9a6030');
    R(g, x + 2, y - 7, 1, 2, '#9a6030');
    R(g, x - 3, y - 7, 1, 1, '#2a2430');
    R(g, x + 2, y - 7, 1, 1, '#2a2430');
    D.disc(g, x, y - 3, 3, '#cc8c4c');
    R(g, x - 3, y - 5, 3, 2, '#2a2430');
    R(g, x - 1, y - 7, 3, 1, P.r2);
    R(g, x + 1, y - 5, 1, 1, '#d8d0ca');
    R(g, x + 1, y - 4, 1, 1, P.eye);
    D.oval(g, x + 2, y - 2, 1, 1, '#d8d0ca');
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
  miniHead(g, piloto, 0, -2);
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
  miniHead(g, piloto, 3, -1);
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
  miniHead(g, piloto, 6, -3);
  g.globalAlpha = 0.45;
  D.oval(g, 6, -5, 2, 1, P.gl1);
  g.globalAlpha = 1;
}

/** Gold-tinted bubble canopy (stealth jets) with the pilot inside; (hx, hy) is the chin. */
function goldCanopy(g: Ctx, cx: number, cy: number, rx: number, ry: number, hx: number, hy: number) {
  D.oval(g, cx, cy, rx, ry, '#7a6a3a');
  miniHead(g, piloto, hx, hy);
  g.globalAlpha = 0.45;
  D.oval(g, cx, cy, rx - 1, Math.max(1, ry - 1), '#ffd878');
  g.globalAlpha = 1;
  R(g, cx + 1, cy - ry, 2, 1, '#fff6b0');
}

/** F-22: low-vis two-tone grey, twin canted fins, chined nose, flat 2D nozzle. */
function paintRaptor(g: Ctx, has: Has) {
  const G0 = '#4e5666', G = '#7c8698', G1 = '#a4adbd', G2 = '#c8cfdb', CAM = '#68717f', DK = '#262a36';
  if (has('cola')) {
    // Twin canted fins: the far one peeks out ahead of and above the near one.
    for (let i = 0; i < 6; i++) R(g, -14 + Math.round(i * 0.7), -9 + i, 3, 1, i ? G0 : G);
    for (let i = 0; i < 6; i++) R(g, -17 + Math.round(i * 0.7), -8 + i, 4, 1, i === 0 ? G2 : i < 3 ? G1 : G);
    R(g, -15, -6, 1, 3, CAM);
    // Diamond tailplane, low at the back.
    R(g, -18, 1, 7, 1, G);
    R(g, -17, 2, 5, 1, G0);
  } else stub(g, -13, -4, 2, 4);
  // Flat, broad fuselage with a sharp chine running into the nose.
  R(g, -11, -3, 15, 1, G1);
  R(g, -15, -2, 24, 1, G);
  R(g, -16, -1, 28, 1, G);
  R(g, -16, 0, 31, 1, G);
  R(g, -16, 1, 33, 1, G0);
  R(g, -14, 2, 20, 1, G0);
  R(g, 7, 0, 8, 1, G1);
  // Two-tone camo patches and panel lines.
  R(g, -10, -2, 6, 2, CAM);
  R(g, -15, 0, 3, 1, CAM);
  R(g, -2, 0, 3, 1, CAM);
  R(g, -6, -2, 1, 3, G0);
  // Caret intake under the canopy.
  R(g, 1, 0, 1, 2, G2);
  R(g, 2, 0, 3, 2, DK);
  if (has('ala')) {
    // Diamond wing seen edge-on: swept leading edge, forward-swept trailing edge.
    R(g, -9, 2, 13, 1, G1);
    R(g, -10, 3, 11, 1, G);
    R(g, -8, 4, 7, 1, G0);
    R(g, -6, 5, 3, 1, G0);
  } else stub(g, -3, 2, 3, 2);
  if (has('motor')) {
    // Flat thrust-vectoring nozzle: two paddles and a dark slot.
    R(g, -18, -2, 3, 4, G0);
    R(g, -18, -2, 3, 1, G);
    R(g, -18, -1, 1, 2, DK);
  } else stub(g, -16, -2, 2, 4);
  goldCanopy(g, 6, -3, 5, 2, 5, -1);
}

/** Su-57: long and slender, blue-grey splinter camo, twin engines far apart, LEVCONs. */
function paintSukhoi(g: Ctx, has: Has) {
  const B0 = '#46546e', B = '#7888a6', B1 = '#a6b4cc', S1 = '#5a6a8a', S2 = '#93a3be', DK = '#262a36';
  if (has('cola')) {
    for (let i = 0; i < 6; i++) R(g, -14 + Math.round(i * 0.6), -8 + i, 3, 1, i ? B0 : B);
    for (let i = 0; i < 5; i++) R(g, -17 + Math.round(i * 0.6), -7 + i, 4, 1, i === 0 ? B1 : i < 2 ? S2 : B);
    R(g, -16, -5, 2, 1, S1);
    R(g, -19, 0, 6, 1, B);
    R(g, -18, 1, 4, 1, B0);
  } else stub(g, -14, -3, 2, 4);
  // Long, slender fuselage and a slightly drooped nose.
  R(g, -8, -3, 13, 1, B1);
  R(g, -15, -2, 25, 1, B);
  R(g, -16, -1, 29, 1, B);
  R(g, -16, 0, 32, 1, B);
  R(g, 12, 1, 5, 1, B0);
  R(g, 17, 1, 1, 1, P.metal0);
  // Splinter camo: hard-edged angular patches.
  R(g, -12, -2, 4, 1, S1);
  R(g, -11, -1, 4, 1, S1);
  R(g, -10, 0, 3, 1, S1);
  R(g, -4, -2, 5, 1, S2);
  R(g, -3, -1, 3, 1, S2);
  R(g, 9, -1, 3, 1, S1);
  R(g, 10, 0, 3, 1, S1);
  // Twin engine nacelles slung low and wide apart.
  if (has('motor')) {
    R(g, -17, 1, 18, 3, B0);
    R(g, -16, 1, 16, 1, B);
    R(g, -8, 2, 4, 1, S1);
    R(g, -19, 1, 3, 3, P.metal0);
    R(g, -18, 1, 2, 1, P.metal);
    R(g, -19, 2, 1, 1, DK);
  } else {
    R(g, -12, 1, 13, 2, B0);
    stub(g, -14, 1, 2, 3);
  }
  if (has('ala')) {
    R(g, -10, 3, 14, 1, B1);
    R(g, -11, 4, 12, 1, B);
    R(g, -9, 5, 7, 1, B0);
    R(g, -6, 4, 3, 1, S1);
  } else stub(g, -3, 3, 3, 2);
  // Intake under the big leading-edge extension, its edge running to the cockpit.
  R(g, 1, 1, 3, 2, DK);
  R(g, 4, 1, 1, 2, B1);
  R(g, 2, 0, 10, 1, B1);
  if (has('cabina')) goldCanopy(g, 8, -3, 5, 2, 7, -1);
  else {
    R(g, 4, -3, 8, 1, B0);
    miniHead(g, piloto, 7, -1);
    R(g, 12, -3, 1, 1, P.gl0);
  }
}

/** Top and bottom of the B-2's side profile at column x: a thin wedge with a hump. */
function b2Top(x: number) {
  if (x < -10) return 1 - Math.floor((x + 24) / 7);
  if (x <= 17) return -1 - Math.round(4 * Math.max(0, 1 - ((x - 5) / 13) ** 2));
  return [-1, -1, 0, 0, 1][x - 18] ?? 1;
}

/** B-2: a flying wing seen from the side, charcoal, humped centre, no tail. */
function paintB2(g: Ctx, has: Has) {
  const K0 = '#22242c', K = '#3a3d4a', K1 = '#555a6a', K2 = '#737a8e', K3 = '#9aa2b8';
  const x0 = has('ala') ? -24 : -14;
  for (let x = x0; x <= 22; x++) {
    const top = b2Top(x), bot = x >= 21 ? 1 : 2;
    R(g, x, top, 1, bot - top + 1, K1);
    R(g, x, top, 1, 1, x < -10 || x > 17 ? K3 : K2);
    if (bot - top >= 2) R(g, x, bot - 1, 1, 1, K);
    R(g, x, bot, 1, 1, K0);
  }
  // The wing's leading edge running past the hump, and the sawtooth's seams.
  R(g, -10, 0, 28, 1, K2);
  for (const x of [-22, -18, -14]) if (x >= x0) R(g, x, 1, 1, 1, K0);
  if (!has('ala')) stub(g, -15, 0, 2, 3);
  // Bomb bay doors on the belly.
  if (has('bodega')) {
    R(g, -4, 2, 10, 1, K);
    R(g, 1, 2, 1, 1, K0);
  } else {
    R(g, -4, 2, 10, 1, '#14141c');
    R(g, -5, 3, 2, 1, K1);
    R(g, 6, 3, 2, 1, K1);
  }
  // Dorsal intakes on the hump and the exhaust trough on the wing's back.
  if (has('motor')) {
    R(g, -1, -6, 6, 1, K3);
    R(g, -1, -5, 1, 1, K1);
    R(g, 0, -5, 4, 1, '#121218');
    R(g, -15, 0, 6, 1, K0);
    R(g, -15, 0, 2, 1, P.metal0);
  } else stub(g, 1, -6, 3, 2);
  // Small cockpit windows at the front of the hump.
  if (has('cabina')) {
    D.oval(g, 11, -3, 4, 2, '#3a4a6a');
    miniHead(g, piloto, 11, -1);
    g.globalAlpha = 0.4;
    D.oval(g, 11, -3, 3, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 14, -3, 2, 1, P.gl1);
    R(g, 15, -2, 1, 1, P.gl0);
  } else {
    miniHead(g, piloto, 11, -1);
    R(g, 14, -3, 2, 1, '#14141c');
    R(g, 15, -3, 1, 1, P.gold);
  }
}

const OM0 = '#7a8098', OM = '#b8c0d4', OM1 = '#e0e6f0';

/** The flying saucer: silver disc, glass dome with the pilot, emitter underneath. */
function paintOvni(g: Ctx, has: Has) {
  if (has('cabina')) D.oval(g, 0, -2, 7, 6, P.gl0);
  miniHead(g, piloto, 1, -1);
  if (has('cabina')) {
    g.globalAlpha = 0.4;
    D.oval(g, 0, -3, 6, 4, P.gl1);
    g.globalAlpha = 1;
    R(g, -4, -6, 2, 1, P.white);
    R(g, -5, -5, 1, 1, P.white);
  } else {
    // Shattered dome: a few shards left standing round the pilot.
    R(g, -7, -3, 2, 3, P.gl0);
    R(g, -6, -5, 1, 2, P.gl1);
    R(g, 5, -4, 2, 4, P.gl0);
    R(g, 6, -6, 1, 2, P.gl1);
  }
  D.oval(g, 0, 2, 15, 3, OM0);
  D.oval(g, 0, 1, 14, 2, OM);
  R(g, -10, 0, 20, 1, OM1);
  R(g, -14, 2, 29, 1, '#8a90a8');
  for (const x of [-8, -3, 2, 7]) R(g, x, 4, 2, 1, '#5a5f78');
  if (has('motor')) {
    D.oval(g, 0, 5, 6, 1, OM0);
    R(g, -3, 6, 7, 1, '#3affb0');
    R(g, -1, 6, 3, 1, '#c8fff0');
  } else stub(g, -2, 4, 4, 2);
  if (!has('ala')) {
    // A bite out of the rim.
    g.clearRect(-16, -1, 5, 8);
    stub(g, -11, 0, 2, 4);
  }
}

const LUZ = ['#ff5a7a', '#ffe048', '#5affc8', '#7ab8ff'];

/**
 * The saucer's ring of blinking lights, spinning round the rim: an ellipse of
 * radii (14, ry) centred at (0, cy). `all` false hides the back half (side view).
 */
export function ovniLuces(g: Ctx, cy: number, ry: number, t: number, all: boolean) {
  const a0 = g.globalAlpha;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + t * 1.6;
    const sn = Math.sin(a);
    if (!all && sn < -0.05) continue;
    const x = Math.round(Math.cos(a) * 14);
    const y = cy + Math.round(sn * ry);
    const on = (Math.floor(t * 8) + i) % 3 !== 0;
    const col = LUZ[i % 4];
    if (on) {
      g.globalAlpha = a0 * 0.35;
      R(g, x - 1, y, 3, 1, col);
      R(g, x, y - 1, 1, 3, col);
      g.globalAlpha = a0;
    }
    R(g, x, y, 1, 1, on ? col : '#5a5f78');
  }
}

/** The saucer's pulsing green/cyan underglow, centred at (x, y). */
export function ovniGlow(g: Ctx, x: number, y: number, rx: number, ry: number, t: number) {
  const a0 = g.globalAlpha;
  const p = 0.5 + 0.5 * Math.sin(t * 7);
  g.globalAlpha = a0 * (0.16 + 0.14 * p);
  D.oval(g, x, y + 1, rx + 2 + Math.round(p), ry + 1, '#3affb0');
  g.globalAlpha = a0 * (0.3 + 0.2 * p);
  D.oval(g, x, y, rx, ry, '#7affe0');
  g.globalAlpha = a0 * 0.7;
  R(g, x - 2, y, 5, 1, '#e0fff8');
  g.globalAlpha = a0;
}

/** F-14: navy grey, twin fins, wings swept fully back, long two-seat canopy, big twin nozzles. */
function paintTomcat(g: Ctx, has: Has) {
  const G0 = '#56627a', G = '#8a97ab', G1 = '#b2bdcc', G2 = '#d6dde7', DK = '#262a36';
  if (has('cola')) {
    // Twin fins: the far one peeks out ahead of the near one.
    for (let i = 0; i < 7; i++) R(g, -13 + Math.round(i * 0.5), -9 + i, 3, 1, i ? G0 : G);
    for (let i = 0; i < 7; i++) R(g, -17 + Math.round(i * 0.6), -9 + i, 4, 1, i === 0 ? G2 : i < 3 ? G1 : G);
    R(g, -17, -9, 3, 1, P.gold);
    // Stabilators low at the back, a ventral fin underneath.
    R(g, -19, 1, 8, 1, G);
    R(g, -18, 2, 5, 1, G0);
    R(g, -13, 3, 2, 2, G0);
  } else stub(g, -14, -4, 2, 4);
  // Long fuselage tapering into a pointed radome, light belly.
  R(g, -12, -3, 14, 1, G1);
  R(g, -15, -2, 28, 1, G);
  R(g, -16, -1, 31, 1, G);
  R(g, -16, 0, 33, 1, G);
  R(g, -16, 1, 34, 1, G0);
  R(g, -14, 2, 22, 1, G2);
  R(g, 12, -1, 3, 1, G1);
  R(g, 18, 1, 1, 1, P.metal0);
  R(g, -7, -2, 1, 3, G0);
  R(g, -11, -2, 3, 1, G0);
  // The fixed glove running forward, and the big boxy intake under it.
  R(g, 4, 1, 8, 1, G1);
  R(g, -4, 0, 8, 3, G0);
  R(g, -4, 0, 8, 1, G);
  R(g, 4, 0, 1, 3, G2);
  R(g, 3, 1, 1, 2, DK);
  if (has('ala')) {
    // The swing wing fully swept back, seen edge-on.
    R(g, -12, 2, 10, 1, G1);
    R(g, -14, 3, 9, 1, G);
    R(g, -15, 4, 4, 1, G0);
  } else stub(g, -7, 2, 3, 2);
  if (has('motor')) {
    // Big round nozzle with its petals.
    R(g, -19, -2, 3, 5, P.metal0);
    R(g, -18, -2, 2, 1, P.metal);
    R(g, -19, -1, 1, 3, DK);
  } else stub(g, -17, -2, 2, 4);
  // Long two-seat canopy: an empty back seat and the pilot up front.
  if (has('cabina')) {
    D.oval(g, 7, -4, 6, 2, P.gl0);
    R(g, 2, -5, 2, 3, '#3a4258');
    miniHead(g, piloto, 9, -2);
    R(g, 5, -6, 1, 4, G0);
    g.globalAlpha = 0.45;
    D.oval(g, 7, -4, 5, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 10, -6, 2, 1, P.white);
  } else {
    R(g, 1, -3, 12, 1, G0);
    miniHead(g, piloto, 9, -2);
    R(g, 13, -3, 1, 1, P.gl0);
  }
}

/** A-10: olive grey, straight wing, two pod engines high on the back, twin square fins, nose gun. */
function paintA10(g: Ctx, has: Has) {
  const A0 = '#4c5644', A = '#77826a', A1 = '#a2ac92', A2 = '#c9d0bb', CM = '#5d684f', DK = '#262a2a';
  if (has('cola')) {
    // Square fins on the tailplane's tips: the far one peeks out above and ahead.
    R(g, -16, -9, 3, 7, A0);
    R(g, -16, -9, 3, 1, A);
    R(g, -20, -8, 4, 9, A);
    R(g, -20, -8, 4, 1, A1);
    R(g, -19, -7, 1, 8, A0);
    R(g, -20, -2, 8, 1, A1);
  } else stub(g, -16, -3, 2, 4);
  // Chunky fuselage, blunt nose.
  R(g, -12, -3, 22, 1, A1);
  R(g, -16, -2, 29, 1, A);
  R(g, -17, -1, 32, 1, A);
  R(g, -17, 0, 34, 1, A);
  R(g, -16, 1, 33, 1, A0);
  R(g, -13, 2, 27, 1, A0);
  R(g, 13, -2, 2, 1, A1);
  // Camo blotches.
  R(g, -11, -2, 5, 2, CM);
  R(g, 1, -1, 4, 2, CM);
  R(g, -16, 0, 3, 1, CM);
  // A friendly painted grin under the nose.
  R(g, 10, 0, 1, 1, '#3a2228');
  R(g, 11, 1, 5, 1, '#3a2228');
  R(g, 16, 0, 1, 1, '#3a2228');
  R(g, 12, 1, 1, 1, P.white);
  R(g, 14, 1, 1, 1, P.white);
  // The long cannon barrel poking out of the nose.
  R(g, 15, 2, 5, 1, P.metal0);
  R(g, 19, 2, 1, 1, '#2a2438');
  if (has('ala')) {
    // Straight, thick wing seen edge-on, with the gear pod.
    R(g, -6, 2, 13, 1, A1);
    R(g, -6, 3, 12, 1, A);
    R(g, -5, 4, 9, 1, A0);
    R(g, 3, 4, 3, 2, A0);
  } else stub(g, -1, 2, 3, 2);
  if (has('bodega')) {
    // Stores hanging under the wing.
    R(g, -2, 5, 1, 1, A0);
    R(g, -5, 6, 7, 2, '#8a8a72');
    R(g, -5, 6, 7, 1, '#b0b098');
    R(g, -6, 6, 1, 2, A0);
    R(g, 2, 7, 1, 1, '#5a5a4a');
  } else {
    R(g, -2, 5, 2, 1, DK);
    R(g, -1, 6, 1, 1, P.gold);
  }
  if (has('motor')) {
    // Pod engine on a short pylon high on the back.
    R(g, -9, -4, 3, 1, A0);
    D.oval(g, -8, -6, 5, 2, A0);
    D.oval(g, -8, -7, 4, 1, A);
    R(g, -11, -8, 6, 1, A2);
    R(g, -2, -7, 1, 3, A2);
    R(g, -3, -7, 1, 3, DK);
    R(g, -14, -7, 2, 3, P.metal0);
    R(g, -14, -6, 1, 1, DK);
  } else stub(g, -9, -5, 3, 2);
  if (has('cabina')) {
    D.oval(g, 10, -4, 4, 2, P.gl0);
    miniHead(g, piloto, 10, -2);
    g.globalAlpha = 0.45;
    D.oval(g, 10, -4, 3, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 11, -6, 2, 1, P.white);
  } else {
    R(g, 6, -3, 8, 1, A0);
    miniHead(g, piloto, 10, -2);
    R(g, 14, -3, 1, 1, P.gl0);
  }
}

/** Spitfire: green/brown camo over a light belly, rounded fin, long nose, bubble canopy. */
function paintSpitfire(g: Ctx, has: Has) {
  const GR0 = '#45583a', GR = '#647c4c', GR1 = '#88a066', BR = '#8a6a42', SK = '#c6d0bc', SK0 = '#98a496', DK = '#2a2a26';
  if (has('cola')) {
    // Rounded fin and rudder.
    const FIN: [number, number][] = [[-16, 2], [-17, 4], [-17, 5], [-17, 6], [-17, 6], [-17, 7]];
    FIN.forEach(([x, w], i) => R(g, x, -8 + i, w, 1, i === 0 ? GR1 : GR));
    R(g, -14, -6, 2, 2, BR);
    R(g, -15, -7, 1, 5, GR0);
    // Elliptical tailplane edge-on.
    R(g, -17, 0, 6, 1, GR1);
    R(g, -16, 1, 4, 1, SK0);
  } else stub(g, -13, -3, 2, 4);
  // Slim fuselage, the long engine cowling rising a little ahead of the cockpit.
  R(g, -12, -2, 24, 1, GR);
  R(g, -16, -1, 28, 1, GR);
  R(g, -17, 0, 29, 1, GR);
  R(g, -16, 1, 28, 1, SK);
  R(g, -12, 2, 21, 1, SK0);
  R(g, 4, -3, 8, 1, GR1);
  R(g, -11, -2, 8, 1, GR1);
  // Camo patches.
  R(g, -10, -1, 4, 2, BR);
  R(g, -1, -2, 4, 2, BR);
  R(g, 6, -3, 3, 2, BR);
  R(g, -16, -1, 2, 1, BR);
  // Exhaust stubs along the cowling.
  for (const x of [6, 8, 10]) R(g, x, -1, 1, 1, DK);
  if (has('ala')) {
    // Thin elliptical wing edge-on, the radiator under it, cannon ahead.
    R(g, -7, 2, 14, 1, GR1);
    R(g, -6, 3, 12, 1, SK);
    R(g, -4, 4, 6, 1, SK0);
    R(g, -3, 5, 4, 1, SK0);
    R(g, -3, 5, 1, 1, DK);
    R(g, 7, 2, 3, 1, P.metal0);
  } else stub(g, -1, 2, 3, 2);
  if (has('motor')) {
    // Pointed spinner.
    D.oval(g, 13, 0, 2, 2, P.cream);
    R(g, 12, -2, 1, 5, '#b8ae98');
    R(g, 15, 0, 1, 1, P.cream);
    R(g, 13, -1, 1, 1, P.white);
  } else stub(g, 10, -2, 2, 4);
  if (has('cabina')) {
    D.oval(g, 1, -4, 3, 2, P.gl0);
    miniHead(g, piloto, 0, -2);
    g.globalAlpha = 0.45;
    D.oval(g, 1, -4, 2, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 4, -5, 1, 3, GR0);
    R(g, 1, -6, 2, 1, P.white);
  } else {
    R(g, -3, -3, 7, 1, GR0);
    miniHead(g, piloto, 0, -2);
    R(g, 4, -3, 1, 1, P.gl0);
  }
}

/** Ju-87: splinter greens over a pale belly, inverted gull wing, trousered gear, long greenhouse, a bomb on the belly. */
function paintStuka(g: Ctx, has: Has) {
  const G0 = '#3c4a2e', G = '#5a6b42', G1 = '#7c8c56', S = '#46563a', SK = '#b4c2c8', SK0 = '#8a9aa4', DK = '#262a22';
  if (has('cola')) {
    // Square-topped fin with a rounded leading corner, braced tailplane.
    const FIN: [number, number][] = [[-18, 3], [-19, 5], [-19, 6], [-19, 6], [-19, 6], [-19, 7], [-19, 8]];
    FIN.forEach(([x, w], i) => R(g, x, -9 + i, w, 1, i === 0 ? G1 : G));
    R(g, -19, -6, 3, 2, S);
    R(g, -16, -8, 1, 6, G0);
    R(g, -20, -2, 7, 1, G1);
    R(g, -19, -1, 5, 1, SK0);
    R(g, -17, 0, 1, 2, G0);
  } else stub(g, -15, -3, 2, 4);
  // Angular fuselage, deepest at the engine.
  R(g, -14, -3, 26, 1, G1);
  R(g, -18, -2, 32, 1, G);
  R(g, -18, -1, 33, 1, G);
  R(g, -18, 0, 34, 1, G);
  R(g, -17, 1, 32, 1, SK);
  R(g, -14, 2, 27, 1, SK0);
  // Splinter camo: hard-edged slanted patches.
  for (const [x0, y0] of [[-15, -2], [-7, -2], [6, -3]]) for (let i = 0; i < 3; i++) R(g, x0 + i, y0 + i, 3, 1, S);
  // Cowling, exhaust stubs and the big chin radiator.
  R(g, 10, -3, 4, 1, G1);
  for (const x of [9, 11, 13]) R(g, x, -1, 1, 1, DK);
  R(g, 9, 2, 6, 2, G0);
  R(g, 10, 3, 4, 1, DK);
  if (has('ala')) {
    // Inverted gull wing edge-on: the root drops to the crank, the outer panel climbs back.
    R(g, -7, 2, 15, 1, G1);
    R(g, -6, 3, 14, 1, G);
    R(g, -4, 4, 10, 1, SK0);
    // Trousered gear hanging from the crank.
    R(g, 3, 5, 3, 1, G);
    R(g, 3, 6, 4, 1, G);
    R(g, 3, 7, 5, 1, G0);
    R(g, 4, 5, 1, 2, G1);
    R(g, 4, 8, 3, 2, DK);
    R(g, 5, 8, 1, 1, P.metal0);
  } else stub(g, -1, 2, 3, 2);
  if (has('bodega')) {
    // The big bomb on its crutch under the belly.
    R(g, -3, 3, 1, 1, G0);
    D.oval(g, -3, 5, 4, 1, '#5c5c50');
    R(g, -6, 4, 7, 1, '#a0a08a');
    R(g, 1, 5, 1, 1, '#c8c8b0');
    R(g, -9, 4, 2, 3, '#5c5c50');
    R(g, -9, 5, 1, 1, P.gold);
  } else {
    R(g, -5, 3, 4, 1, DK);
    R(g, -3, 4, 1, 1, P.gold);
  }
  if (has('motor')) {
    D.oval(g, 16, 0, 2, 2, G);
    R(g, 15, -2, 1, 5, G0);
    R(g, 16, -1, 1, 1, G1);
    R(g, 18, 0, 1, 1, P.cream);
  } else stub(g, 13, -2, 2, 4);
  // Long framed greenhouse: the pilot up front, the rear gun pointing back.
  if (has('cabina')) {
    R(g, -9, -5, 3, 1, P.metal0);
    R(g, -7, -5, 13, 2, P.gl0);
    R(g, -6, -6, 11, 1, P.gl0);
    miniHead(g, piloto, 3, -2);
    g.globalAlpha = 0.45;
    R(g, -6, -5, 11, 1, P.gl1);
    g.globalAlpha = 1;
    for (const x of [-5, -2]) R(g, x, -6, 1, 3, G0);
    R(g, 6, -5, 1, 2, G0);
    R(g, -4, -6, 2, 1, P.white);
  } else {
    R(g, -7, -3, 14, 1, G0);
    miniHead(g, piloto, 3, -2);
    R(g, 6, -3, 1, 1, P.gl0);
  }
}

/** P-51: bare metal, bubble canopy, belly scoop, a checkered nose band and a red spinner. */
function paintMustang(g: Ctx, has: Has) {
  const M0 = '#6c7482', M = '#a0a8b6', M1 = '#c8ced8', M2 = '#eef1f5', DK = '#2a2c34', CK = '#ff4a5a';
  if (has('cola')) {
    // Tall straight-edged fin running into a dorsal fillet, a red tip.
    [3, 3, 4, 4, 5, 7, 9].forEach((w, i) => R(g, -17, -8 + i, w, 1, i === 0 ? CK : i === 1 ? M1 : M));
    R(g, -15, -6, 1, 4, M0);
    R(g, -18, 0, 6, 1, M1);
    R(g, -17, 1, 4, 1, M0);
  } else stub(g, -14, -3, 2, 4);
  R(g, -12, -3, 8, 1, M1);
  R(g, 3, -3, 8, 1, M1);
  R(g, -16, -2, 29, 1, M);
  R(g, -17, -1, 31, 1, M);
  R(g, -17, 0, 31, 1, M);
  R(g, -16, 1, 29, 1, M0);
  R(g, -12, 2, 20, 1, M0);
  // Polished shine and panel lines.
  R(g, -14, -2, 9, 1, M2);
  R(g, 4, -2, 6, 1, M2);
  R(g, -6, -2, 1, 4, M0);
  R(g, 5, -1, 1, 3, M0);
  for (const x of [6, 8]) R(g, x, -1, 1, 1, DK);
  // Checkered band round the nose.
  for (let y = -3; y <= 1; y++) for (let x = 10; x <= 12; x++) R(g, x, y, 1, 1, (x + y) & 1 ? CK : P.white);
  if (has('ala')) {
    R(g, -5, 2, 13, 1, M1);
    R(g, -4, 3, 11, 1, M);
    R(g, -2, 4, 6, 1, M0);
    R(g, 8, 2, 2, 1, P.metal0);
  } else stub(g, 1, 2, 3, 2);
  // The belly air scoop, its mouth just behind the wing.
  R(g, -12, 2, 8, 2, M0);
  R(g, -11, 2, 7, 1, M);
  R(g, -4, 2, 1, 2, DK);
  R(g, -13, 2, 1, 1, M0);
  if (has('motor')) {
    D.oval(g, 14, 0, 2, 2, CK);
    R(g, 13, -2, 1, 5, '#c0303c');
    R(g, 14, -1, 1, 1, '#ffb0b8');
    R(g, 16, 0, 1, 1, CK);
  } else stub(g, 11, -2, 2, 4);
  if (has('cabina')) {
    D.oval(g, -1, -4, 4, 2, P.gl0);
    miniHead(g, piloto, -1, -2);
    g.globalAlpha = 0.45;
    D.oval(g, -1, -4, 3, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 3, -5, 1, 3, M0);
    R(g, -1, -6, 2, 1, P.white);
  } else {
    R(g, -5, -3, 8, 1, M0);
    miniHead(g, piloto, -1, -2);
    R(g, 3, -3, 1, 1, P.gl0);
  }
}

/** F4U: deep navy blue, inverted gull wing, cockpit far back behind a long nose, big round cowl and prop. */
function paintCorsair(g: Ctx, has: Has) {
  const N0 = '#1c2a4a', N = '#2c426e', N1 = '#45619a', N2 = '#7090c8', DK = '#121826';
  if (has('cola')) {
    const FIN: [number, number][] = [[-17, 3], [-18, 5], [-18, 5], [-18, 6], [-18, 6], [-18, 7]];
    FIN.forEach(([x, w], i) => R(g, x, -8 + i, w, 1, i === 0 ? N1 : N));
    R(g, -16, -7, 1, 5, N0);
    R(g, -19, 0, 6, 1, N1);
    R(g, -18, 1, 4, 1, N0);
    R(g, -15, 2, 1, 1, N0);
    R(g, -15, 3, 1, 1, DK);
  } else stub(g, -15, -3, 2, 4);
  R(g, -13, -3, 8, 1, N1);
  R(g, 1, -3, 9, 1, N1);
  R(g, -17, -2, 28, 1, N);
  R(g, -18, -1, 30, 1, N);
  R(g, -18, 0, 31, 1, N);
  R(g, -17, 1, 29, 1, N0);
  R(g, -13, 2, 22, 1, N0);
  R(g, -12, -2, 7, 1, N2);
  R(g, 2, -2, 6, 1, N2);
  R(g, -7, -2, 1, 4, N0);
  R(g, 4, -1, 1, 3, N0);
  // Big round cowl with its ring and cowl flaps.
  R(g, 10, -4, 4, 7, N0);
  R(g, 10, -3, 3, 5, N);
  R(g, 13, -3, 1, 5, N1);
  R(g, 11, -4, 2, 1, N1);
  R(g, 9, -2, 1, 4, DK);
  if (has('ala')) {
    // Inverted gull wing edge-on: lowest at the crank.
    R(g, -6, 2, 15, 1, N1);
    R(g, -5, 3, 13, 1, N);
    R(g, -3, 4, 8, 1, N0);
    R(g, -1, 5, 4, 1, N0);
    R(g, 9, 3, 2, 1, P.metal0);
  } else stub(g, 0, 2, 3, 2);
  if (has('motor')) {
    D.oval(g, 15, 0, 2, 2, N);
    R(g, 15, -1, 1, 1, N2);
    R(g, 17, 0, 1, 1, N1);
  } else stub(g, 12, -2, 2, 4);
  if (has('cabina')) {
    D.oval(g, -2, -4, 3, 2, P.gl0);
    miniHead(g, piloto, -3, -2);
    g.globalAlpha = 0.45;
    D.oval(g, -2, -4, 2, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 1, -5, 1, 3, N0);
    R(g, -2, -6, 2, 1, P.white);
  } else {
    R(g, -6, -3, 7, 1, N0);
    miniHead(g, piloto, -3, -2);
    R(g, 1, -3, 1, 1, P.gl0);
  }
}

/** F-16: light grey, one swept fin, chin intake under a long bubble canopy, cropped delta, single nozzle. */
function paintF16(g: Ctx, has: Has) {
  const F0 = '#68727f', F = '#9ba5b2', F1 = '#c2c9d3', F2 = '#e2e6ec', DK = '#262a34';
  if (has('cola')) {
    for (let i = 0; i < 8; i++) {
      const x0 = -17 + Math.round(i * 0.2), x1 = -15 + Math.round(i * 0.75);
      R(g, x0, -9 + i, x1 - x0 + 1, 1, i === 0 ? F2 : i < 3 ? F1 : F);
    }
    R(g, -17, -9, 1, 1, F0);
    R(g, -15, -6, 1, 4, F0);
    R(g, -19, 1, 7, 1, F1);
    R(g, -18, 2, 4, 1, F0);
    R(g, -11, 3, 2, 1, F0);
  } else stub(g, -14, -4, 2, 4);
  // Blended body running into a sharp radome.
  R(g, -12, -3, 16, 1, F1);
  R(g, -16, -2, 26, 1, F);
  R(g, -17, -1, 32, 1, F);
  R(g, -17, 0, 35, 1, F);
  R(g, -16, 1, 30, 1, F0);
  R(g, -14, 2, 14, 1, F0);
  R(g, 15, -1, 1, 1, F0);
  R(g, 17, 0, 1, 1, F0);
  // The strake running forward to the cockpit, panel lines.
  R(g, 0, 0, 12, 1, F2);
  R(g, -8, -2, 1, 3, F0);
  R(g, -12, -2, 2, 1, F0);
  // Chin intake under the cockpit.
  R(g, 1, 2, 7, 2, F0);
  R(g, 1, 2, 6, 1, F);
  R(g, 7, 2, 1, 2, DK);
  R(g, 2, 4, 5, 1, F0);
  if (has('ala')) {
    R(g, -11, 2, 11, 1, F1);
    R(g, -10, 3, 8, 1, F);
    R(g, -8, 4, 4, 1, F0);
  } else stub(g, -5, 2, 3, 2);
  if (has('motor')) {
    R(g, -19, -2, 2, 4, P.metal0);
    R(g, -19, -2, 2, 1, P.metal);
    R(g, -19, -1, 1, 2, DK);
  } else stub(g, -17, -2, 2, 4);
  if (has('cabina')) {
    D.oval(g, 6, -4, 5, 2, P.gl0);
    miniHead(g, piloto, 7, -2);
    g.globalAlpha = 0.45;
    D.oval(g, 6, -4, 4, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 8, -6, 2, 1, P.white);
  } else {
    R(g, 1, -3, 11, 1, F0);
    miniHead(g, piloto, 7, -2);
    R(g, 12, -3, 1, 1, P.gl0);
  }
}

/** MiG-29: blue-grey over a pale belly, twin fins, a humped spine, two engines far apart under the wing roots. */
function paintMig29(g: Ctx, has: Has) {
  const B0 = '#4e5c70', B = '#7c8ca4', B1 = '#a4b2c6', BC = '#66788f', W = '#cfd7e0', W0 = '#a8b2be', DK = '#242a36';
  if (has('cola')) {
    // Twin fins: the far one peeks out ahead of the near one.
    for (let i = 0; i < 7; i++) R(g, -14 + Math.round(i * 0.6), -9 + i, 3, 1, i ? B0 : B);
    for (let i = 0; i < 7; i++) R(g, -18 + Math.round(i * 0.6), -9 + i, 4, 1, i === 0 ? B1 : i < 3 ? BC : B);
    R(g, -20, 0, 7, 1, B);
    R(g, -19, 1, 4, 1, B0);
  } else stub(g, -14, -3, 2, 4);
  R(g, -12, -3, 18, 1, B1);
  R(g, -16, -2, 26, 1, B);
  R(g, -17, -1, 31, 1, B);
  R(g, -17, 0, 34, 1, B);
  R(g, -16, 1, 35, 1, W);
  R(g, -14, 2, 18, 1, W0);
  R(g, 19, 1, 1, 1, B0);
  R(g, -10, -2, 4, 2, BC);
  R(g, 0, -1, 4, 1, BC);
  R(g, -5, -2, 1, 3, B0);
  if (has('motor')) {
    // Engine nacelles slung low, the intake ramp under the wing root, nozzles far back.
    R(g, -17, 2, 19, 2, B0);
    R(g, -16, 2, 17, 1, B);
    R(g, 1, 2, 2, 3, DK);
    R(g, 3, 2, 1, 3, W);
    R(g, -20, 1, 3, 3, P.metal0);
    R(g, -19, 1, 2, 1, P.metal);
    R(g, -20, 2, 1, 1, DK);
  } else stub(g, -15, 2, 3, 2);
  if (has('ala')) {
    // Swept wing edge-on and the long root extension reaching for the cockpit.
    R(g, -11, 2, 12, 1, B1);
    R(g, -10, 4, 9, 1, B);
    R(g, -8, 5, 5, 1, B0);
    R(g, 1, 1, 9, 1, B1);
  } else stub(g, -5, 3, 3, 2);
  if (has('cabina')) {
    D.oval(g, 8, -4, 4, 2, P.gl0);
    miniHead(g, piloto, 8, -2);
    g.globalAlpha = 0.45;
    D.oval(g, 8, -4, 3, 1, P.gl1);
    g.globalAlpha = 1;
    R(g, 9, -6, 2, 1, P.white);
    R(g, 13, -3, 1, 1, P.gl1);
  } else {
    R(g, 4, -3, 9, 1, B0);
    miniHead(g, piloto, 8, -2);
    R(g, 12, -3, 1, 1, P.gl0);
  }
}

const PAINT: Record<ModeloAvion, (g: Ctx, has: Has) => void> = {
  avioneta: paintAvioneta, caza: paintCaza, bombardero: paintBombardero,
  raptor: paintRaptor, sukhoi: paintSukhoi, b2: paintB2, ovni: paintOvni,
  tomcat: paintTomcat, a10: paintA10, spitfire: paintSpitfire,
  stuka: paintStuka, mustang: paintMustang, corsair: paintCorsair, f16: paintF16, mig29: paintMig29,
  ...PAINT_EXTRA,
};

/** The plane's sprite with the given parts missing (cached per combination). */
export function planeSprite(m: ModeloAvion, lost: readonly Parte[] = []) {
  const L = LOOKS[m];
  const key = lost.length ? [...lost].sort().join(',') : '';
  return D.outlined(`avion2|${m}|${piloto}|${key}`, L.ink, L.w, L.h, L.w / 2, L.h / 2, (g) => {
    PAINT[m](g, (p) => !lost.includes(p));
    if (lost.length) scorch(g, lost.length, m.length);
  });
}

/** Just one part, drawn alone: the piece that flies off when it's shot away. */
export function partSprite(m: ModeloAvion, part: Parte) {
  const L = LOOKS[m];
  return D.outlined(`pieza|${m}|${part}|${piloto}`, L.ink, L.w, L.h, L.w / 2, L.h / 2, (g) => {
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
 * Who supplies the airframe sprite to drawPlane/drawPlaneGiro. Normally the
 * cached canvas itself; cazas.ts swaps in CPU copies while it paints into its
 * read-back canvas, so getImageData there never waits on a GPU readback.
 */
let fuenteSprite: ((c: HTMLCanvasElement) => CanvasImageSource) | null = null;
export function spriteParaDibujar(c: HTMLCanvasElement): CanvasImageSource {
  return fuenteSprite ? fuenteSprite(c) : c;
}
/** Runs `fn` with the airframe sprites taken from `f` (see spriteParaDibujar). */
export function conFuenteSprite<T>(f: (c: HTMLCanvasElement) => CanvasImageSource, fn: () => T): T {
  const antes = fuenteSprite;
  fuenteSprite = f;
  try {
    return fn();
  } finally {
    fuenteSprite = antes;
  }
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
  const engine = !lost.includes('motor');
  // The saucer's underglow sits behind the disc.
  if (L.glow && engine) ovniGlow(g, L.glow[0], L.glow[1], 6, 2, t);
  // The pilot's scarf flaps behind the cockpit (not under a closed dome).
  const [sx0, sy0] = L.scarf;
  if (!L.cupula) {
    for (let i = 0; i < 4; i++) {
      const wave = Math.round(Math.sin(t * 18 - i * 0.9) * (i * 0.4));
      R(g, sx0 - 3 - i * 2, sy0 + wave + (i > 1 ? 1 : 0), 2, 1, L.scarfC[i % 2]);
    }
  }
  if (!blink) g.drawImage(spriteParaDibujar(img), -L.w / 2, -L.h / 2);
  if (m === 'ovni' && !blink && !lost.includes('ala')) ovniLuces(g, 2, 1, t, false);
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

const HEAD: Record<Piloto, (g: Ctx, x: number, y: number) => void> = { lulu: luluHead, dui: duiHead, almendrita: almendritaHead, naxo: naxoHead, nelo: neloHead };
const INK: Record<Piloto, string> = { lulu: '#1a1428', dui: P.o0, almendrita: '#7a4a1e', naxo: '#3a1e0c', nelo: '#0a0810' };

/** The pilot's head alone, for the hangar cards. */
export function pilotPortrait(m: Piloto) {
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

/*
 * Ground units share one light: from the top-left, warm. Lit edges take a
 * pale, slightly pink rim (VW); faces turned away drop to a cooler, bluer
 * violet (VS) instead of just a darker lilac (hue shift: light warm, shade
 * cool). Fine 1 px lines (panel seams, rails, antennas) carry the detail.
 */
const VS = '#5a46b4', VW = '#f8eeff';
const TIRE0 = '#2c2240', TIRE1 = '#6a5a82';

/** A tyre with tread notches and a hub: 4 frames per turn (f), lit from the top-left. */
function wheel(g: Ctx, x: number, y: number, r: number, f: number) {
  D.disc(g, x, y, r, TIRE);
  // Tread: four notches on the rim, a quarter-step further each frame.
  for (let i = 0; i < 4; i++) {
    const a = ((i + f / 4) * Math.PI) / 2;
    R(g, x + Math.round(Math.cos(a) * r), y + Math.round(Math.sin(a) * r), 1, 1, TIRE0);
  }
  R(g, x - r + 1, y - r + 1, 1, 1, TIRE1);
  D.disc(g, x, y, Math.max(1, r - 2), P.metal);
  // Hub: a dark nut and a lit spoke that turns.
  R(g, x, y, 1, 1, P.metal0);
  const a = (f * Math.PI) / 2;
  R(g, x + Math.round(Math.cos(a) * (r - 2)), y + Math.round(Math.sin(a) * (r - 2)), 1, 1, P.white);
}

function paintJeep(g: Ctx, f: number) {
  // Spare tyre on the tailgate.
  D.disc(g, 11, -8, 2, TIRE);
  R(g, 11, -8, 1, 1, P.metal0);
  // Body: lit top and nose, cool shade underneath.
  R(g, -12, -10, 24, 6, V0);
  R(g, -12, -10, 24, 4, V);
  R(g, -11, -10, 22, 1, V1);
  R(g, -12, -9, 1, 3, VW);
  R(g, -11, -5, 22, 1, VS);
  // Wheel arches, a door seam and its handle.
  R(g, -10, -6, 7, 1, VS);
  R(g, 4, -6, 7, 1, VS);
  R(g, -2, -9, 1, 4, V0);
  R(g, 0, -8, 2, 1, V1);
  // Headlight with a glint, bumper.
  R(g, -13, -8, 2, 3, P.gold);
  R(g, -13, -8, 1, 1, P.white);
  R(g, -14, -5, 3, 1, P.metal0);
  // Windscreen: a fine frame and the glass.
  R(g, -6, -15, 1, 5, P.metal0);
  R(g, -5, -15, 1, 5, P.gl1);
  R(g, -5, -15, 1, 1, P.white);
  mouse(g, 0, -10);
  // Rocket pod on the back.
  R(g, 4, -14, 8, 4, P.metal0);
  R(g, 4, -14, 8, 2, P.metal);
  R(g, 5, -14, 6, 1, VW);
  R(g, 5, -11, 6, 1, VS);
  R(g, 3, -14, 2, 2, P.red);
  R(g, 3, -14, 1, 1, P.r3);
  wheel(g, -7, -4, 3, f);
  wheel(g, 7, -4, 3, f);
}

function paintCamion(g: Ctx, f: number) {
  // Exhaust stack behind the cab.
  R(g, -4, -19, 2, 6, P.metal0);
  R(g, -4, -19, 1, 6, P.metal);
  // Cab at the front (left).
  R(g, -16, -16, 11, 12, V0);
  R(g, -16, -16, 11, 10, V);
  R(g, -15, -16, 9, 1, V1);
  R(g, -16, -15, 1, 8, VW);
  R(g, -15, -7, 10, 1, VS);
  R(g, -15, -14, 6, 5, P.gl1);
  R(g, -15, -14, 6, 1, P.gl2);
  mouse(g, -11, -9);
  // Grille: three fine bars, and a headlight.
  for (let i = 0; i < 3; i++) R(g, -17, -10 + i * 2, 1, 1, P.metal0);
  R(g, -17, -7, 2, 2, P.gold);
  R(g, -17, -7, 1, 1, P.white);
  // Flat bed with slats and a missile on its launch rail.
  R(g, -5, -9, 21, 5, V0);
  R(g, -5, -9, 21, 3, V);
  R(g, -5, -9, 21, 1, V1);
  R(g, -5, -5, 21, 1, VS);
  for (let x = -2; x < 16; x += 4) R(g, x, -8, 1, 2, V0);
  R(g, 0, -12, 13, 3, P.metal0);
  R(g, 0, -12, 13, 1, P.metal);
  R(g, 1, -15, 12, 3, P.white);
  R(g, 1, -13, 12, 1, P.metal);
  R(g, -1, -15, 2, 3, P.red);
  R(g, -1, -15, 1, 1, P.r3);
  R(g, 12, -16, 2, 1, P.red);
  wheel(g, -11, -4, 3, f);
  wheel(g, 3, -4, 3, f);
  wheel(g, 11, -4, 3, f);
}

function paintTanque(g: Ctx, f: number) {
  // Tracks: a rounded band; the links run forward on top and back below.
  D.oval(g, 0, -4, 15, 4, TIRE);
  D.oval(g, 0, -4, 13, 2, '#3e3252');
  for (let x = -12; x <= 12; x += 4) {
    R(g, x + (f % 4) - 2, -8, 2, 1, TIRE1);
    R(g, x - (f % 4) + 1, 0, 2, 1, TIRE0);
  }
  // Road wheels with turning hubs, a drive sprocket at the front and an idler at the back.
  for (let i = -2; i <= 2; i++) {
    D.disc(g, i * 6, -4, 2, P.metal);
    R(g, i * 6 - 1, -5, 1, 1, P.white);
    R(g, i * 6 + (f % 2 ? 1 : 0), -4 + (f >> 1 ? 1 : 0), 1, 1, P.metal0);
  }
  for (const [x, c] of [[-14, P.metal0], [14, P.metal0]] as const) {
    D.disc(g, x, -5, 1, c);
    R(g, x + (f % 2 ? 1 : -1), -5, 1, 1, P.metal);
  }
  // Hull with a side skirt and rivets.
  R(g, -14, -11, 28, 5, V0);
  R(g, -13, -11, 26, 3, V);
  R(g, -12, -11, 24, 1, V1);
  R(g, -14, -10, 1, 3, VW);
  R(g, -13, -7, 26, 1, VS);
  for (let x = -10; x <= 10; x += 5) R(g, x, -9, 1, 1, V1);
  // Exhaust grille at the back.
  R(g, 10, -10, 3, 1, V0);
  // Turret with a hatch, a periscope and a mouse peeking out.
  D.oval(g, 2, -13, 8, 4, V0);
  D.oval(g, 2, -14, 7, 3, V);
  R(g, -2, -16, 6, 1, V1);
  R(g, -4, -15, 1, 2, VW);
  R(g, -3, -11, 11, 1, VS);
  R(g, 8, -17, 2, 2, P.metal0);
  R(g, 8, -17, 1, 1, P.gl1);
  mouse(g, 5, -16);
}

function paintSam(g: Ctx, f: number) {
  R(g, -16, -15, 8, 11, V0);
  R(g, -16, -15, 8, 9, V);
  R(g, -16, -15, 8, 1, V1);
  R(g, -16, -14, 1, 7, VW);
  R(g, -15, -13, 5, 4, P.gl1);
  R(g, -15, -13, 5, 1, P.gl2);
  mouse(g, -12, -8);
  R(g, -8, -9, 24, 5, V0);
  R(g, -8, -9, 24, 3, V);
  R(g, -8, -9, 24, 1, V1);
  R(g, -8, -5, 24, 1, VS);
  // Outrigger legs folded on the bed.
  R(g, -6, -6, 3, 1, P.metal0);
  R(g, 12, -6, 3, 1, P.metal0);
  // A launcher box tilted up and back with two missile noses, its lit top edge and a cool underside.
  for (let i = 0; i < 9; i++) {
    const y = -12 - Math.round(i * 0.8);
    R(g, -3 + i, y, 5, 4, i === 8 ? V1 : V0);
    R(g, -3 + i, y, 1, 1, V);
    R(g, 1 + i, y + 3, 1, 1, VS);
  }
  R(g, 5, -22, 2, 2, P.red);
  R(g, 5, -22, 1, 1, P.r3);
  R(g, 8, -19, 2, 2, P.red);
  R(g, 8, -19, 1, 1, P.r3);
  wheel(g, -11, -4, 3, f);
  wheel(g, 2, -4, 3, f);
  wheel(g, 11, -4, 3, f);
}

/** Margarita's black hair (shadow, base, shine) and the wart on her witch's nose. Shared by all her sprites. */
export const MARGA_PELO = ['#141018', '#2a2232', '#4a4058'] as const;
export const MARGA_VERRUGA = '#9a5a4a';
/** Her cart's ink, to outline the nose where it sticks out over the basket. */
const VINK_MARGA = '#6a2a4a';

/**
 * Neighbour Margarita, the boss: a short, grumpy old lady with black hair, a
 * hooked witch's nose and a red wool hat, glasses
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
  D.oval(g, 0, -34, 6, 3, P.k1);
  R(g, -3, -36, 7, 1, P.k3);
  // Engine box and the handle.
  R(g, 14, -12, 9, 7, M0);
  R(g, 15, -11, 7, 3, M);
  R(g, 16, -30, 2, 16, M0);
  // Margarita, behind the trolley: short and round, her head barely clears the
  // basket. Cardigan, skirt, stubby legs, shoes.
  R(g, 15, -28, 14, 16, '#8a7a9a');
  R(g, 16, -27, 12, 14, '#a898b8');
  R(g, 22, -27, 1, 14, '#8a7a9a');
  R(g, 15, -13, 14, 7, '#6a4a7a');
  R(g, 18, -6, 2, 3, P.skin);
  R(g, 24, -6, 2, 3, P.skin);
  R(g, 17, -4, 4, 2, P.r0);
  R(g, 23, -4, 4, 2, P.r0);
  // Arm stretched out over the basket, holding up the broom.
  R(g, 9, -24, 9, 3, '#a898b8');
  R(g, 6, -24, 3, 3, P.skin);
  // Head: black hair and bun, a big hooked witch's nose with a wart, glasses, a frown.
  D.disc(g, 24, -35, 6, MARGA_PELO[1]);
  D.disc(g, 28, -39, 3, MARGA_PELO[1]);
  R(g, 27, -41, 2, 1, MARGA_PELO[2]);
  R(g, 25, -39, 3, 1, MARGA_PELO[2]);
  R(g, 28, -31, 2, 2, MARGA_PELO[0]);
  D.disc(g, 21, -34, 5, P.skin);
  R(g, 16, -37, 7, 1, P.metal0);
  R(g, 16, -37, 3, 3, P.gl2);
  R(g, 20, -37, 3, 3, P.gl2);
  R(g, 17, -36, 1, 1, P.eye);
  R(g, 21, -36, 1, 1, P.eye);
  // Angry eyebrows sloping down to the nose.
  R(g, 16, -39, 2, 1, MARGA_PELO[0]);
  R(g, 18, -38, 1, 1, MARGA_PELO[0]);
  R(g, 21, -39, 2, 1, MARGA_PELO[0]);
  // The nose: out from between the eyes, then a fat round tip hooking down.
  R(g, 12, -36, 4, 1, VINK_MARGA);
  R(g, 13, -35, 4, 2, P.skin);
  D.oval(g, 10, -31, 4, 3, VINK_MARGA);
  D.oval(g, 10, -31, 3, 2, P.skin);
  R(g, 12, -34, 2, 1, P.skin);
  R(g, 9, -32, 1, 1, '#fff0dc');
  R(g, 8, -29, 5, 1, P.skin0);
  R(g, 8, -28, 2, 1, P.skin0);
  R(g, 8, -27, 1, 1, VINK_MARGA);
  R(g, 12, -32, 1, 1, MARGA_VERRUGA);
  // Grumpy mouth tucked under the nose.
  R(g, 16, -30, 4, 1, P.r0);
  R(g, 20, -29, 1, 1, P.r0);
  R(g, 23, -32, 2, 1, P.blush);
  // The red wool hat with a pompom.
  D.oval(g, 22, -40, 8, 4, P.r0);
  D.oval(g, 22, -41, 7, 3, P.r1);
  R(g, 15, -38, 15, 2, P.r0);
  for (let x = 16; x < 30; x += 2) R(g, x, -38, 1, 2, P.r2);
  D.disc(g, 22, -46, 3, P.r2);
  R(g, 21, -47, 1, 1, P.r3);
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
  // Short: only her head and shoulders peek over the rail.
  R(g, x - 4, y - 2, 9, 3, '#a898b8');
  R(g, x, y - 2, 1, 3, '#8a7a9a');
  D.disc(g, x + 2, y - 5, 3, MARGA_PELO[1]);
  R(g, x + 4, y - 9, 2, 2, MARGA_PELO[1]);
  R(g, x + 3, y - 6, 2, 1, MARGA_PELO[2]);
  D.disc(g, x, y - 5, 3, P.skin);
  // Glasses, eyes and the frown.
  R(g, x - 3, y - 7, 5, 1, P.metal0);
  R(g, x - 3, y - 6, 2, 2, P.gl2);
  R(g, x, y - 6, 2, 2, P.gl2);
  R(g, x - 3, y - 6, 1, 1, P.eye);
  R(g, x, y - 6, 1, 1, P.eye);
  // The witch's nose: a fat hooked blob sticking out to the left.
  R(g, x - 5, y - 5, 2, 1, P.skin);
  R(g, x - 7, y - 4, 4, 2, P.skin);
  R(g, x - 7, y - 3, 3, 1, P.skin0);
  R(g, x - 7, y - 2, 1, 1, P.skin0);
  R(g, x - 6, y - 4, 1, 1, MARGA_VERRUGA);
  R(g, x - 2, y - 2, 3, 1, P.r0);
  R(g, x + 2, y - 4, 1, 1, P.blush);
  // The red wool hat.
  D.oval(g, x, y - 9, 4, 2, P.r0);
  D.oval(g, x, y - 10, 3, 1, P.r1);
  R(g, x - 4, y - 8, 9, 1, P.r0);
  for (let i = -3; i < 5; i += 2) R(g, x + i, y - 8, 1, 1, P.r2);
  R(g, x - 1, y - 12, 2, 1, P.r2);
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
 * A whip antenna: a fine 1 px line from (x, y) up `len` px whose tip lags and
 * swings (secondary motion), with a tip light or a little pennant.
 */
function antena(g: Ctx, x: number, y: number, len: number, t: number, seed: number, punta: 'luz' | 'banderin') {
  // One fillStyle and one rect per straight run of the line (fill state changes are the cost here).
  const sw = Math.sin(t * 4.2 + seed) * 1.6;
  g.fillStyle = '#4a3a6a';
  let tx = x, runX = x, runY = y - 1, runN = 0;
  for (let i = 1; i <= len; i++) {
    const k = (i * i) / (len * len);
    tx = x + Math.round(sw * k + k);
    if (tx !== runX && runN) {
      g.fillRect(runX, runY - runN + 1, 1, runN);
      runN = 0;
    }
    if (!runN) {
      runX = tx;
      runY = y - i;
    }
    runN++;
  }
  g.fillRect(runX, runY - runN + 1, 1, runN);
  const ty = y - len;
  if (punta === 'luz') {
    const on = Math.floor(t * 2 + seed) % 2 === 0;
    R(g, tx, ty - 1, 1, 1, on ? P.red : P.r0);
  } else {
    // A pennant streaming back, rippling over three frames.
    const fr = Math.floor(t * 9 + seed) % 3;
    R(g, tx + 1, ty, 3, 1, P.r1);
    R(g, tx + 1, ty + 1, 2 + (fr === 1 ? 1 : 0), 1, P.r1);
    R(g, tx + 4, ty + (fr === 2 ? 1 : 0), 1, 1, P.r2);
    R(g, tx + 1, ty, 1, 1, P.r3);
  }
}

/** Exhaust: three small puffs drifting back and up, fading in quarter steps. No particles, no allocation. */
function humito(g: Ctx, x: number, y: number, t: number, seed: number, dx: number, oscuro = false) {
  for (let i = 0; i < 3; i++) {
    const ph = (t * 1.5 + i / 3 + seed) % 1;
    if (ph >= 0.75) continue;
    const px = Math.round(x + ph * 7 * dx), py = Math.round(y - ph * 6);
    g.drawImage(puffSpr(oscuro, ph >= 0.3, ph >= 0.45), px, py);
  }
}

const puffs: HTMLCanvasElement[] = [];
/** Smoke puffs (1 px or 2×2 with a lit top-left pixel) with their alpha baked in: one blit, no state changes. */
function puffSpr(oscuro: boolean, grande: boolean, tenue: boolean): HTMLCanvasElement {
  const i = (oscuro ? 4 : 0) + (grande ? 2 : 0) + (tenue ? 1 : 0);
  let c = puffs[i];
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = grande ? 2 : 1;
    const q = c.getContext('2d')!;
    q.globalAlpha = tenue ? 0.25 : 0.5;
    q.fillStyle = oscuro ? '#6a5e80' : '#d4cce4';
    q.fillRect(0, 0, c.width, c.height);
    q.fillStyle = oscuro ? '#8a7ea0' : '#f4f0fc';
    q.clearRect(0, 0, 1, 1);
    q.fillRect(0, 0, 1, 1);
    puffs[i] = c;
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
    R(g, 0, -2, 14, 4, VINK);
    R(g, 0, -1, 12, 2, P.metal0);
    R(g, 0, -1, 12, 1, P.metal);
    // Muzzle brake: a wider ring with a lit edge and a dark bore.
    R(g, 11, -2, 3, 4, P.metal0);
    R(g, 11, -2, 3, 1, P.metal);
    R(g, 13, 0, 1, 1, VINK);
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
  // Secondary motion: antennas that lag and swing, exhaust, beacons.
  const sd = (Math.abs(x) * 0.013) % 6.28;
  if (k === 'jeep') {
    antena(g, 10, -14, 9, t, sd, 'luz');
    humito(g, 13, -5, t, sd, 1);
  } else if (k === 'camion') {
    humito(g, -3, -20, t, sd, 1);
  } else if (k === 'tanque') {
    antena(g, 8, -15, 10, t, sd, 'banderin');
    humito(g, 14, -10, t * 1.3, sd, 1);
  } else if (k === 'sam') {
    // Rotating beacon on the cab: a red flash with a soft halo every half second.
    if (Math.floor(t * 4 + sd) % 2 === 0) {
      g.globalAlpha = 0.35;
      R(g, -14, -18, 3, 3, P.red);
      g.globalAlpha = 1;
      R(g, -13, -17, 1, 1, P.white);
    } else R(g, -13, -17, 1, 1, P.r0);
  } else if (k === 'lancha') {
    antena(g, 6, -8, 6, t * 1.4, sd, 'banderin');
  }
  if (k === 'margarita') {
    // She shakes her broom at the sky.
    g.save();
    g.translate(7, -23);
    g.rotate(-0.5 + Math.sin(t * 9) * 0.35);
    R(g, -1, -24, 3, 26, '#6a2a4a');
    R(g, 0, -23, 1, 24, P.k1);
    R(g, -4, -31, 9, 8, '#6a2a4a');
    R(g, -3, -30, 7, 6, P.gold);
    for (let i = -3; i < 4; i += 2) R(g, i, -30, 1, 6, P.gold0);
    g.restore();
  }
  if (k === 'portaaviones') {
    // Margarita shakes a little broom from the bridge (behind her, clear of her nose).
    g.save();
    g.translate(43, -31);
    g.rotate(0.5 + Math.sin(t * 9) * 0.35);
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
export function drawBubble(g: Ctx, x: number, y: number, text: string, vw: number, escala = 1, arriba = false, ancho = 1) {
  // Big and readable: 12px text (times the zoom factor so it keeps its size on screen).
  const fs = 12 * escala, lh = fs + 2 * escala, pad = (ancho > 1 ? 5 : 7) * escala;
  g.font = `bold ${fs}px "Fredoka", "Nunito", sans-serif`;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > Math.min(210 * escala * ancho, vw * 0.6) && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + pad * 2;
  const h = lines.length * lh + pad;
  // Clear of the altimeter strip on the right edge.
  // `arriba`: pinned with its top at y, centred (phones, where the thumbs cover the bottom).
  const bx = arriba ? Math.round(vw / 2 - w / 2) : Math.round(Math.min(vw - w - 14, Math.max(2, x - w / 2)));
  const by = arriba ? Math.round(y) : Math.round(y - h - 6);
  R(g, bx + 1, by - 1, w - 2, h + 2, '#6a2a4a');
  R(g, bx - 1, by + 1, w + 2, h - 2, '#6a2a4a');
  R(g, bx, by, w, h, '#6a2a4a');
  R(g, bx + 1, by, w - 2, h, P.white);
  R(g, bx, by + 1, w, h - 2, P.white);
  // Tail (pointing down at the speaker; none when pinned at the top).
  const tx = Math.round(Math.min(bx + w - 8, Math.max(bx + 6, x)));
  for (let i = 0; i < (arriba ? 0 : 5); i++) {
    R(g, tx - 3 + i, by + h + i - 1, 6 - i * 1.2, 1, '#6a2a4a');
    R(g, tx - 2 + i, by + h + i - 1, Math.max(1, 4 - i * 1.2), 1, P.white);
  }
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillStyle = '#6a2a4a';
  lines.forEach((l, i) => g.fillText(l, bx + pad, by + Math.round(pad / 2) + i * lh));
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
  // Damage you can read at a glance: a thin grey wisp once hurt, a dark plume when it's nearly done.
  if (amount > 0.35 && k !== 'portaaviones' && k !== 'margarita') {
    const sx = Math.round(x - L.w / 6 + (seed % 5));
    const top = Math.round(y - L.h + 4);
    humito(g, sx, top, t * 0.8, (seed % 13) * 0.07, 0.6, amount > 0.7);
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
export function drawPrize(g: Ctx, x: number, y: number, kind: Premio, t: number, big: boolean, escala = 1) {
  // Scaled from the string's foot, so it stays tied to whatever carries it.
  if (escala !== 1) {
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.scale(escala, escala);
    drawPrize(g, 0, 0, kind, t + x * 0.001, big);
    g.restore();
    return;
  }
  const c2 = PRIZE_COL[kind][2];
  const X = Math.round(x);
  const Y = Math.round(y);
  const sway = Math.round(Math.sin(t * 2.4 + x * 0.05) * 1.5);
  const r = big ? 7 : 5;
  const by = Y - (big ? 14 : 10) - r;
  // String: a fine line that curves with the sway (the knot end lags the balloon).
  const n = big ? 14 : 10;
  g.fillStyle = '#8a7a9a';
  for (let i = 0; i < n; i++) g.fillRect(X + Math.round((sway * i * i) / (n * n)), Y - i, 1, 1);
  if ((big || kind === 'especial' || kind === 'vida' || kind === 'nuclear') && Math.floor(t * 3) % 2) {
    const a0 = g.globalAlpha;
    g.globalAlpha = a0 * 0.5;
    g.drawImage(prizeHalo(c2, r + 3), X + sway - r - 3, by - r - 3);
    g.globalAlpha = a0;
  }
  const body = prizeBody(kind, big);
  g.drawImage(body, X + sway - r - 3, by - r - 3);
  // Now and then a glint runs over it: an anticipation cue that says «grab me».
  const ph = (((t * 0.55 + x * 0.013) % 1) + 1) % 1;
  if (ph < 0.14) {
    const tam = ph < 0.035 ? 1 : ph < 0.09 ? 2 : 1;
    const gx = X + sway - Math.round(r * 0.6), gy = by - Math.round(r * 0.7);
    R(g, gx - tam, gy, tam * 2 + 1, 1, P.white);
    R(g, gx, gy - tam, 1, tam * 2 + 1, P.white);
  }
}

const prizeHalos = new Map<string, HTMLCanvasElement>();
function prizeHalo(col: string, r: number): HTMLCanvasElement {
  const key = col + r;
  let c = prizeHalos.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 2 * r + 1;
    D.disc(c.getContext('2d')!, r, r, r, col);
    prizeHalos.set(key, c);
  }
  return c;
}

const prizeBodies = new Map<string, HTMLCanvasElement>();
/** The balloon itself (skin, shading, shine, knot and icon), baked once per kind and size. */
function prizeBody(kind: Premio, big: boolean): HTMLCanvasElement {
  const key = kind + (big ? '|g' : '|p');
  let c = prizeBodies.get(key);
  if (c) return c;
  const [c0, c1, c2] = PRIZE_COL[kind];
  const r = big ? 7 : 5;
  c = document.createElement('canvas');
  c.width = 2 * r + 7;
  c.height = 2 * r + 8;
  const g = c.getContext('2d')!;
  g.translate(r + 3, r + 3);
  const by = 0, ix = 0;
  D.disc(g, 0, 0, r + 1, c0);
  D.disc(g, 0, 0, r, c1);
  // Cool core shadow on the lower right (toward the dark tone), lit body top-left.
  g.globalAlpha = 0.45;
  D.disc(g, 1, 1, r - 1, c0);
  g.globalAlpha = 1;
  D.disc(g, -1, -1, r - 1, c1);
  // Shine: a thin arc and a hot point.
  R(g, -r + 2, -1, 1, 2, c2);
  R(g, -r + 3, -Math.round(r / 2) - 1, 1, 1, c2);
  R(g, -Math.round(r / 2), -Math.round(r / 2), 2, 2, c2);
  R(g, -Math.round(r / 2), -Math.round(r / 2), 1, 1, P.white);
  // Knot.
  R(g, -1, r + 1, 3, 1, c0);
  R(g, 0, r + 2, 1, 1, c0);
  // The icon inside.
  if (kind === 'misil') {
    R(g, ix - 2, by, 5, 1, P.white);
    R(g, ix + 3, by, 1, 1, P.red0);
    R(g, ix - 3, by - 1, 1, 3, P.white);
  } else if (kind === 'bomba') {
    D.disc(g, ix, by + 1, 2, '#2a2438');
    R(g, ix - 1, by, 1, 1, '#5a5470');
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
  prizeBodies.set(key, c);
  return c;
}

export function drawShell(g: Ctx, x: number, y: number) {
  R(g, x - 1, y - 1, 3, 3, VINK);
  R(g, x, y, 1, 1, P.gold);
}

export function drawFlare(g: Ctx, x: number, y: number, t: number) {
  // Small and fine: a hot white point in a thin gold halo, twinkling.
  const k = Math.floor(t * 20) % 2;
  const X = Math.round(x), Y = Math.round(y);
  R(g, X - 1, Y - 1, 3, 3, P.gold);
  R(g, X, Y, 1, 1, P.white);
  if (k) {
    R(g, X - 2, Y, 5, 1, P.gold1);
    R(g, X, Y - 2, 1, 5, P.gold1);
  }
}

/**
 * A tin of fish under a little parachute. (x, y) is the tin. The canopy has
 * striped gores lit from the top-left, a scalloped hem that breathes with the
 * sway, and four fine shroud lines down to the tin.
 */
export function drawCrate(g: Ctx, x: number, y: number, sway: number, chute: boolean) {
  const s = chute ? Math.round(sway * 2) : 0;
  // The canopy breathes: 1 px narrower at the ends of the swing.
  const w = Math.abs(sway) > 0.75 ? 8 : 9;
  g.drawImage(crateSprite(chute, s, w), Math.round(x) - CRATE_OX, Math.round(y) - CRATE_OY);
}

const CRATE_W = 28, CRATE_H = 29, CRATE_OX = 14, CRATE_OY = 23;
const crates = new Map<number, HTMLCanvasElement>();
/** Every pose of the crate is baked once (≤ 11 small canvases) and blitted. */
function crateSprite(chute: boolean, s: number, w: number): HTMLCanvasElement {
  const key = chute ? (s + 2) * 2 + (w - 8) + 1 : 0;
  let c = crates.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = CRATE_W;
  c.height = CRATE_H;
  paintCrate(c.getContext('2d')!, CRATE_OX, CRATE_OY, chute, s, w);
  crates.set(key, c);
  return c;
}

function paintCrate(g: Ctx, X: number, Y: number, chute: boolean, s: number, w: number) {
  if (chute) {
    const cx = X + s, cy = Y - 14;
    // Shroud lines.
    g.fillStyle = '#7a6a8a';
    for (const ax of SHROUDS) {
      const x0 = Math.round(cx + ax * w), y0 = cy + 1, x1 = X + Math.sign(ax) * 2, y1 = Y - 3;
      const n = y1 - y0;
      for (let i = 1; i < n; i++) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), y0 + i, 1, 1);
    }
    // Dome, row by row: gores alternate red and cream; the right side is in shade.
    for (let dy = -5; dy <= 0; dy++) {
      const hw = Math.round(w * Math.sqrt(1 - ((dy + 0.5) * (dy + 0.5)) / 30));
      for (let dx = -hw; dx <= hw; dx++) {
        const gore = Math.floor(((dx + w) * 5) / (2 * w + 1)) % 2;
        const shade = dx > hw * 0.4 || dy === 0;
        const lit = dx < -hw * 0.3 && dy <= -3;
        g.fillStyle = gore ? (shade ? '#c8b4c8' : lit ? '#ffffff' : P.cream) : shade ? P.r0 : lit ? P.r3 : P.r2;
        g.fillRect(cx + dx, cy + dy, 1, 1);
      }
    }
    // Outline on top and the scalloped hem.
    R(g, cx - 3, cy - 6, 7, 1, P.r0);
    for (let dx = -w; dx <= w; dx++) if ((dx + w) % 3 !== 1) R(g, cx + dx, cy + 1, 1, 1, P.r0);
    R(g, cx - 2, cy - 5, 2, 1, P.white);
  }
  // The tin: lit lid, cool shadow on the right, a fish on the label.
  D.oval(g, X, Y, 6, 4, P.w0);
  D.oval(g, X, Y - 1, 5, 3, P.metal);
  R(g, X - 4, Y - 3, 3, 1, P.white);
  R(g, X - 5, Y, 10, 2, P.w1);
  R(g, X + 3, Y, 2, 2, P.w0);
  R(g, X - 3, Y - 2, 4, 2, P.o2);
  R(g, X + 1, Y - 3, 2, 1, P.o2);
  R(g, X + 1, Y, 2, 1, P.o2);
  R(g, X - 2, Y - 2, 1, 1, P.eye);
}
/** Where the shroud lines leave the hem, as a fraction of the canopy half-width. */
const SHROUDS = [-0.9, -0.33, 0.33, 0.9];

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
    const sec = sectorSA(x);
    // Dirt with world-anchored polka dots, deeper rows rosier; concrete at the port, grey sand at the beach.
    const [cuerpo, hondo] = sec === 3 ? ['#b8b4c4', '#9a96aa'] : sec === 4 ? ['#c9bfae', '#b0a690'] : [P.d2, P.e1];
    R(g, x, y0, 1, c.height - y0, cuerpo);
    R(g, x, rowOf(4), 1, c.height - rowOf(4), hondo);
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
      // Wildflowers dotted along the grass: more in San Juan's fields.
      const hf = hash(x, 55);
      if (hf % (sec === 0 ? 7 : 13) === 0 && x > pantry.x1 + 4) {
        R(g, x, y0 - 2, 1, 2, P.g0);
        R(g, x, y0 - 3, 1, 1, FLORES[(hf >> 4) % FLORES.length]);
      }
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
      const sec = sectorSA(gx);
      if (sec >= 3) {
        // Concrete joints at the port, darker grains in the beach sand.
        R(g, gx, gy, sec === 3 ? 6 : 2, 1, sec === 3 ? '#a8a4b8' : '#b4aa94');
        continue;
      }
      // A dot that would spill into the next sector (port concrete) is skipped.
      if (sectorSA(gx + 3) !== sec) continue;
      R(g, gx + 1, gy, 2, 4, deep ? P.e2 : P.d3);
      R(g, gx, gy + 1, 4, 2, deep ? P.e2 : P.d3);
      if (!deep) R(g, gx + 1, gy + 1, 1, 1, P.white);
    }

  // Scenery by sector, kept clear of the pantry.
  const surfY = (x: number) => rowOf(Math.round(heightAt(x))) + 1;
  const libre = (x: number) => x > pantry.x1 + 30 && x < length - 12;
  // San Juan: two ponds (tranques), eucalyptus and a fence.
  for (let x = 236; x < 306; x += 6) if (libre(x)) cerco(g, x, surfY(x), x + 6 < 306);
  for (const x of [210, 330]) if (libre(x)) tranque(g, x, surfY(x));
  for (let x = pantry.x1 + 34; x < 400; x += 16 + (hash(x, 1) % 22)) if (libre(x) && Math.abs(x - 210) > 16 && Math.abs(x - 330) > 16 && Math.abs(x - 268) > 14) eucaliptoCerca(g, x, surfY(x), 28 + (hash(x, 2) % 16));
  if (libre(268)) vaca(g, 268, surfY(268));
  // Llolleo: totora reeds, little lagoons and white herons.
  for (let x = 410; x < 1100; x += 8 + (hash(x, 3) % 18)) {
    if (!libre(x) || (x > 615 && x < 760)) continue;
    const k = hash(x, 4) % 10;
    if (k < 6) totoraCerca(g, x, surfY(x), x);
    else if (k < 8) charco(g, x, surfY(x));
    else garzaCerca(g, x, surfY(x));
  }
  // Llolleo: the «Ojos de Mar» lagoon by the path, with its sign.
  if (libre(660)) {
    laguna(g, 660, surfY(660));
    pato(g, 648, surfY(660) + 1, false);
    pato(g, 672, surfY(660) + 2, true);
    cartel(g, 690, surfY(700), 'OJOS DE MAR', '#3d85c6');
  }

  // Barrancas: concrete stairs with railings, a corner store and lamp posts.
  for (const x of [1160, 1290, 1630]) if (libre(x)) {
    escalinata(g, x, surfY(x));
    casasPareadas(g, x + 16, surfY(x) - 15, surfY, hash(x, 11));
  }
  if (libre(1420)) almacen(g, 1420, surfY(1440));
  if (libre(1200)) cartel(g, 1196, surfY(1196), 'JUANASPE', '#c0605a');
  if (libre(1490)) casaNelo(g, 1486, surfY(1510));
  // Beside Ñelo's house: three tall poplars and the neighbourhood's luchador, flexing.
  for (const [i, x] of [1546, 1558, 1570].entries()) if (libre(x)) alamo(g, x, surfY(x), i);
  if (libre(1590)) luchador(g, 1590, surfY(1590));
  if (libre(1610)) perro(g, 1610, surfY(1610));
  for (let x = 1120; x < 1700; x += 70) if (libre(x) && Math.abs(x - 1440) > 40 && Math.abs(x - 1510) > 34 && Math.abs(x - 1220) > 26) faro(g, x, surfY(x));
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
  if (libre(2120)) carrito(g, 2110, surfY(2120), 'EMPANADAS', '#f2cc8f');
  if (libre(2330)) arcoLetrero(g, 2310, surfY(2330), 'PASEO BELLAMAR');
  if (libre(2560)) {
    cartel(g, 2556, surfY(2556), 'CALETA', '#3d85c6');
    bote(g, 2580, surfY(2590));
  }
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
  // A crowded Playa Grande (parasols elbow to elbow), quieter Playa Chica.
  for (let x = 2860; x < length - 20; x += x < 3160 ? 12 + (hash(x, 8) % 5) : 46 + (hash(x, 8) % 40)) if (Math.abs(x - 3050) > 14 && Math.abs(x - 3200) > 20 && Math.abs(x - 3310) > 18) quitasol(g, x, surfY(x), hash(x, 9));
  if (libre(3310)) salvavidas(g, 3310, surfY(3310));
  if (libre(2760)) estacion(g, 2740, surfY(2760));
  if (libre(2900)) cartel(g, 2836, surfY(2836), 'PLAYA GRANDE', '#3d85c6');
  if (libre(3420)) cartel(g, 3420, surfY(3420), 'PLAYA CHICA', '#3d85c6');
  if (libre(3050)) carrito(g, 3044, surfY(3050), 'HELADOS', '#8fd3c8');
  if (libre(3200)) carritoSangre(g, 3192, surfY(3200));

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

const FLORES = ['#ff8ac0', '#ffd27f', '#ffffff', '#c9a7e0', '#ff6a5c', '#8fd3f8'];

/** A post-and-rail fence segment (6 px), with the rail on to the next post. */
function cerco(g: Ctx, x: number, y: number, riel: boolean) {
  R(g, x, y - 8, 2, 8, '#8a5a3a');
  R(g, x, y - 8, 1, 8, '#b07a4a');
  if (riel) {
    R(g, x + 2, y - 7, 4, 1, '#b07a4a');
    R(g, x + 2, y - 4, 4, 1, '#8a5a3a');
  }
}

/** A spotted cow grazing, head down to the left. */
function vaca(g: Ctx, x: number, y: number) {
  const N = '#3a3448';
  R(g, x - 6, y - 4, 1, 4, N);
  R(g, x - 3, y - 4, 1, 4, N);
  R(g, x + 3, y - 4, 1, 4, N);
  R(g, x + 6, y - 4, 1, 4, N);
  R(g, x - 8, y - 11, 16, 8, N);
  R(g, x - 7, y - 10, 14, 6, P.white);
  R(g, x - 4, y - 10, 4, 3, N);
  R(g, x + 3, y - 8, 3, 3, N);
  R(g, x + 6, y - 10, 1, 2, N);
  // Head down at the grass, pink muzzle, a little horn.
  R(g, x - 12, y - 8, 5, 6, N);
  R(g, x - 11, y - 7, 3, 4, P.white);
  R(g, x - 12, y - 3, 4, 2, '#f4a7b9');
  R(g, x - 10, y - 9, 1, 1, '#f2e6c8');
  R(g, x - 9, y - 6, 1, 1, N);
  // Udder and the tail.
  R(g, x + 1, y - 4, 3, 1, '#f4a7b9');
  R(g, x + 8, y - 10, 1, 5, N);
  R(g, x + 8, y - 5, 2, 1, N);
}

/** A duck paddling in the lagoon. */
function pato(g: Ctx, x: number, y: number, flip: boolean) {
  const d = flip ? -1 : 1;
  R(g, x - 3, y - 3, 7, 3, '#7a6a5a');
  R(g, x - 3, y - 3, 7, 1, '#b8a890');
  R(g, x + d * 3 - (flip ? 1 : 0), y - 6, 2, 3, '#3a8a5a');
  R(g, x + d * 5 - (flip ? 1 : 0), y - 5, 2, 1, '#f2b040');
  R(g, x - 4, y, 9, 1, P.w3);
}

/** A neighbourhood dog sitting, wagging its tail. */
function perro(g: Ctx, x: number, y: number) {
  R(g, x - 4, y - 5, 7, 5, '#c08a5a');
  R(g, x + 1, y - 9, 4, 4, '#c08a5a');
  R(g, x + 1, y - 10, 1, 2, '#8a5a3a');
  R(g, x + 4, y - 7, 2, 1, '#3a3448');
  R(g, x + 3, y - 8, 1, 1, '#3a3448');
  R(g, x - 5, y - 4, 1, 3, '#8a5a3a');
  R(g, x - 6, y - 5, 1, 1, '#8a5a3a');
  R(g, x, y - 5, 2, 1, '#e86a5c');
  R(g, x - 3, y - 1, 2, 1, '#8a5a3a');
}

/** The lifeguard's tower on the beach: stilts, a red hut and a flag. */
function salvavidas(g: Ctx, x: number, y: number) {
  for (const dx of [-6, 5]) R(g, x + dx, y - 14, 2, 14, '#8a5a3a');
  for (let i = 0; i < 12; i++) R(g, x - 6 + i, y - 2 - i, 1, 1, '#b07a4a');
  R(g, x - 9, y - 16, 19, 2, '#8a5a3a');
  R(g, x - 8, y - 27, 17, 11, '#3e4a6b');
  R(g, x - 7, y - 26, 15, 10, '#e05a5a');
  R(g, x - 5, y - 24, 11, 4, P.gl1);
  R(g, x - 7, y - 26, 15, 1, '#ff8a8a');
  R(g, x - 10, y - 29, 21, 2, P.white);
  R(g, x + 8, y - 38, 1, 10, '#3e4a6b');
  R(g, x + 9, y - 38, 5, 3, '#ffd84a');
  R(g, x + 9, y - 36, 5, 1, '#e05a5a');
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
  escribir(g, 'ALMACÉN', x + 6, y - 24, '#3a5ab0');
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
  const w = anchoLetrero('PESCADO FRITO');
  R(g, x + 20 - Math.ceil(w / 2) - 3, y - 35, w + 6, 9, P.k0);
  R(g, x + 20 - Math.ceil(w / 2) - 2, y - 34, w + 4, 7, P.cream);
  escribir(g, 'PESCADO FRITO', x + 20 - Math.ceil(w / 2), y - 33, '#c05a7a');
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

/** Paired two-storey houses on a stone terrace at the top of a stair; `y` is the terrace top. */
function casasPareadas(g: Ctx, x: number, y: number, surfY: (x: number) => number, seed: number) {
  for (let i = 0; i < 46; i++) {
    const yb = surfY(x + i);
    if (yb > y) {
      R(g, x + i, y, 1, yb - y, '#b4a492');
      if ((i + (seed % 3)) % 6 === 0) R(g, x + i, y + 2, 1, yb - y - 2, '#cdbfae');
    }
  }
  R(g, x, y, 46, 1, '#7a7490');
  const col = ['#f4a7b9', '#ffd27f', '#8fd3c8', '#9ec5e8', '#f6b38e', '#b5d99c'][seed % 6];
  for (const dx of [1, 24]) {
    R(g, x + dx - 1, y - 23, 23, 23, '#3e4a6b');
    R(g, x + dx, y - 22, 21, 22, col);
    for (let i = 0; i < 25; i++) R(g, x + dx - 2 + i, y - 25 - Math.round(Math.abs(i - 12) < 2 ? 1 : 0), 1, 3, '#e86a5c');
    for (const [wx, wy] of [[3, 17], [13, 17], [3, 8], [13, 8]] as const) {
      R(g, x + dx + wx, y - wy, 5, 5, P.white);
      R(g, x + dx + wx + 1, y - wy + 1, 3, 3, P.gl1);
    }
    R(g, x + dx + 9, y - 6, 4, 6, P.k1);
  }
}

/** A sign board on a post. */
function cartel(g: Ctx, x: number, y: number, txt: string, fondo: string) {
  const w = anchoLetrero(txt) + 6;
  R(g, x + Math.floor(w / 2), y - 14, 2, 14, '#5a4a3a');
  R(g, x - 1, y - 24, w + 2, 11, '#24427a');
  R(g, x, y - 23, w, 9, fondo);
  escribir(g, txt, x + 3, y - 21, P.white, '#24427a');
}

/** An arched entrance sign over a promenade. */
function arcoLetrero(g: Ctx, x: number, y: number, txt: string) {
  const w = anchoLetrero(txt) + 10;
  R(g, x, y - 26, 2, 26, P.white);
  R(g, x + w - 2, y - 26, 2, 26, P.white);
  R(g, x - 1, y - 35, w + 2, 11, '#24427a');
  R(g, x, y - 34, w, 9, '#8fd3c8');
  escribir(g, txt, x + 5, y - 32, P.white, '#24427a');
}

/** A rowboat pulled up on the quay. */
function bote(g: Ctx, x: number, y: number) {
  R(g, x, y - 5, 16, 3, '#e05a5a');
  R(g, x + 1, y - 2, 14, 2, '#a03a3a');
  R(g, x, y - 5, 16, 1, P.white);
  R(g, x + 6, y - 7, 1, 2, P.k0);
}

/** A little street cart with a parasol and a sign. */
function carrito(g: Ctx, x: number, y: number, txt: string, toldo: string) {
  const w = anchoLetrero(txt) + 6;
  R(g, x, y - 12, w, 9, P.k0);
  R(g, x + 1, y - 11, w - 2, 7, P.cream);
  escribir(g, txt, x + 3, y - 10, '#c05a7a');
  D.disc(g, x + 4, y - 2, 2, '#4a3a5a');
  D.disc(g, x + w - 5, y - 2, 2, '#4a3a5a');
  R(g, x + Math.floor(w / 2), y - 22, 1, 10, '#5a4a3a');
  D.oval(g, x + Math.floor(w / 2), y - 23, Math.floor(w / 2) + 2, 2, D.tone(toldo, -0.3));
  D.oval(g, x + Math.floor(w / 2), y - 23, Math.floor(w / 2) + 1, 1, toldo);
}

/** A «carrito de sangre»: a small cart pulled by a patient horse. */
function carritoSangre(g: Ctx, x: number, y: number) {
  // Horse.
  R(g, x - 1, y - 7, 2, 7, '#6a4a3a');
  R(g, x + 7, y - 7, 2, 7, '#6a4a3a');
  R(g, x - 2, y - 13, 12, 6, '#6a4a3a');
  R(g, x - 1, y - 12, 10, 4, '#a8785a');
  R(g, x - 6, y - 18, 5, 7, '#6a4a3a');
  R(g, x - 5, y - 17, 3, 5, '#a8785a');
  R(g, x - 8, y - 16, 3, 3, '#a8785a');
  R(g, x - 4, y - 19, 1, 2, '#6a4a3a');
  R(g, x - 5, y - 16, 1, 1, P.eye);
  R(g, x + 10, y - 12, 2, 5, '#4a3a2a');
  // Cart with two big wheels and a striped canopy.
  R(g, x + 9, y - 11, 10, 1, P.k0);
  R(g, x + 16, y - 14, 18, 7, P.k0);
  R(g, x + 17, y - 13, 16, 5, P.k2);
  for (let i = 0; i < 18; i++) R(g, x + 16 + i, y - 22, 1, 3, Math.floor(i / 3) % 2 ? P.white : '#e86a5c');
  R(g, x + 17, y - 19, 1, 5, P.k0);
  R(g, x + 32, y - 19, 1, 5, P.k0);
  D.disc(g, x + 25, y - 4, 4, '#4a3a5a');
  D.disc(g, x + 25, y - 4, 2, P.k2);
}

/** The old railway platform with a wooden roof: «ESTACIÓN» and a «1912» plaque. */
function estacion(g: Ctx, x: number, y: number) {
  R(g, x, y - 4, 70, 4, '#a8a0b4');
  R(g, x, y - 4, 70, 1, '#d8d4e4');
  for (const px of [4, 34, 64]) R(g, x + px, y - 26, 2, 22, P.k0);
  for (let i = 0; i < 6; i++) R(g, x - 2 + i, y - 28 - i, 74 - i * 2, 1, i % 2 ? P.k1 : P.k0);
  const w = anchoLetrero('ESTACIÓN');
  R(g, x + 35 - Math.ceil(w / 2) - 3, y - 24, w + 6, 9, P.k0);
  R(g, x + 35 - Math.ceil(w / 2) - 2, y - 23, w + 4, 7, P.cream);
  escribir(g, 'ESTACIÓN', x + 35 - Math.ceil(w / 2), y - 22, '#3a5ab0');
  R(g, x + 10, y - 13, 15, 7, '#5a4a3a');
  escribir(g, '1912', x + 11, y - 12, P.gold1);
  R(g, x + 44, y - 9, 12, 2, P.k1);
  R(g, x + 45, y - 7, 1, 3, P.k0);
  R(g, x + 54, y - 7, 1, 3, P.k0);
}

/** A wider lagoon set into the grass, rimmed with reeds. */
function laguna(g: Ctx, x: number, y: number) {
  D.oval(g, x, y + 2, 28, 4, '#5a8a6a');
  D.oval(g, x, y + 2, 27, 3, P.w1);
  R(g, x - 18, y + 1, 22, 1, P.w2);
  R(g, x + 8, y + 2, 8, 1, P.w3);
  for (const dx of [-30, -27, -24, 24, 27, 30]) {
    const h = 6 + ((dx * 7) & 3);
    R(g, x + dx, y - h + 2, 1, h, '#8a9a50');
    R(g, x + dx, y - h, 1, 2, '#8a6a40');
  }
}

/** A Lombardy poplar: a tall, narrow column of leaves on a short trunk. */
function alamo(g: Ctx, x: number, y: number, seed: number) {
  const H = 40 + ((seed * 5) % 3) * 4;
  R(g, x - 1, y - 7, 2, 7, '#6a4a32');
  R(g, x - 1, y - 7, 1, 7, '#8a6a48');
  // The crown, widest a third of the way up, tapering to a point.
  for (let j = 0; j < H; j++) {
    const k = j / H;
    const w = Math.max(1, Math.round(4 * Math.sin(Math.PI * Math.min(1, k * 1.25 + 0.05))));
    const yy = y - 6 - j;
    R(g, x - w - 1, yy, w * 2 + 2, 1, '#2e5a32');
    R(g, x - w, yy, w * 2, 1, '#4a8a3e');
    // Light from the left, darker leaf clumps on the right.
    if ((j + seed) % 3 === 0) R(g, x - w, yy, Math.max(1, w - 1), 1, '#7ab84e');
    if ((j * 7 + seed) % 5 === 0) R(g, x + w - 2, yy, 2, 1, '#3a6e34');
  }
}

/** An original masked luchador with a big Mexican moustache, double-biceps pose. */
function luchador(g: Ctx, x: number, y: number) {
  const PIEL = '#d89a6a', PIEL0 = '#a86a42', MASK = '#d0306a', MASK1 = '#ffd84a', N = '#2a2030';
  // Boots and tights.
  R(g, x - 5, y - 4, 4, 4, MASK);
  R(g, x + 1, y - 4, 4, 4, MASK);
  R(g, x - 5, y - 1, 4, 1, MASK1);
  R(g, x + 1, y - 1, 4, 1, MASK1);
  R(g, x - 5, y - 10, 10, 6, '#3a5ab0');
  R(g, x - 5, y - 10, 10, 1, MASK1);
  R(g, x - 1, y - 9, 2, 5, '#2a3a80');
  // Broad chest, abs and a belt buckle.
  R(g, x - 7, y - 20, 14, 10, PIEL);
  R(g, x - 6, y - 19, 5, 3, '#e8b088');
  R(g, x + 1, y - 19, 5, 3, '#e8b088');
  R(g, x, y - 19, 1, 9, PIEL0);
  for (const yy of [-15, -13]) R(g, x - 3, y + yy, 6, 1, PIEL0);
  R(g, x - 2, y - 11, 4, 2, MASK1);
  // Arms up, flexing: shoulders, big biceps, fists by the head.
  for (const s of [-1, 1]) {
    const sx = x + s * 8;
    R(g, s < 0 ? sx - 3 : sx, y - 21, 4, 4, PIEL);
    D.disc(g, sx + s * 3, y - 24, 3, PIEL);
    R(g, sx + s * 3 - 1, y - 26, 2, 1, '#e8b088');
    R(g, sx + s * 2 - 1, y - 31, 3, 6, PIEL);
    R(g, sx + s * 2 - 2, y - 33, 4, 3, PIEL0);
  }
  // The mask: pink with gold flames around the eyes, laces at the back.
  D.disc(g, x, y - 26, 5, MASK);
  R(g, x - 5, y - 27, 10, 2, MASK);
  R(g, x - 4, y - 28, 3, 2, MASK1);
  R(g, x + 1, y - 28, 3, 2, MASK1);
  R(g, x - 3, y - 28, 2, 1, P.white);
  R(g, x + 2, y - 28, 2, 1, P.white);
  R(g, x - 2, y - 28, 1, 1, N);
  R(g, x + 2, y - 28, 1, 1, N);
  R(g, x - 1, y - 32, 2, 3, MASK1);
  R(g, x, y - 31, 1, 2, '#ff8a3c');
  // Open mouth area of the mask with a thick horseshoe moustache.
  R(g, x - 3, y - 25, 6, 3, PIEL);
  R(g, x - 4, y - 25, 8, 1, N);
  R(g, x - 4, y - 24, 1, 3, N);
  R(g, x + 3, y - 24, 1, 3, N);
  R(g, x - 1, y - 23, 2, 1, '#8a3a3a');
}

/** A friendly little house with a garden fence and its name plate: «CASA DEL ÑELO». */
function casaNelo(g: Ctx, x: number, y: number) {
  const W = 46;
  // Walls, gable roof and a chimney.
  R(g, x - 1, y - 23, W + 2, 23, '#3e4a6b');
  R(g, x, y - 22, W, 22, '#b5d99c');
  R(g, x, y - 22, W, 1, '#d8f0c4');
  for (let i = 0; i < 12; i++) R(g, x - 3 + i * 2, y - 24 - i, W + 6 - i * 4, 1, i % 3 === 1 ? '#ff8a7a' : '#e86a5c');
  R(g, x + 34, y - 36, 5, 8, '#c0605a');
  R(g, x + 33, y - 37, 7, 2, '#8a3a3a');
  // A round window, a door with a heart, flower boxes.
  D.disc(g, x + 10, y - 13, 4, '#3e4a6b');
  D.disc(g, x + 10, y - 13, 3, P.gl1);
  R(g, x + 9, y - 15, 1, 1, P.white);
  R(g, x + 20, y - 15, 9, 15, '#3e4a6b');
  R(g, x + 21, y - 14, 7, 14, P.k1);
  R(g, x + 23, y - 11, 1, 1, P.r2);
  R(g, x + 25, y - 11, 1, 1, P.r2);
  R(g, x + 23, y - 10, 3, 1, P.r2);
  R(g, x + 24, y - 9, 1, 1, P.r2);
  R(g, x + 26, y - 6, 1, 1, P.gold);
  R(g, x + 33, y - 17, 9, 7, P.white);
  R(g, x + 34, y - 16, 7, 5, P.gl1);
  R(g, x + 33, y - 9, 9, 2, P.k0);
  for (const fx of [34, 37, 40]) R(g, x + fx, y - 11, 2, 2, fx === 37 ? P.gold : P.r2);
  // Name plate over the door.
  const txt = 'CASA DEL ÑELO';
  const w = anchoLetrero(txt) + 4;
  const px = x + Math.round(W / 2) - Math.round(w / 2);
  R(g, px - 1, y - 36, w + 2, 12, '#5a3a2a');
  R(g, px, y - 35, w, 10, P.cream);
  escribir(g, txt, px + 2, y - 31, '#3a5ab0');
  // A little white fence.
  for (let i = -6; i < W + 6; i++) {
    if (i >= 20 && i < 29) continue;
    if ((i + 6) % 3 === 0) R(g, x + i, y - 5, 1, 5, P.white);
  }
  R(g, x - 6, y - 4, 26, 1, P.white);
  R(g, x + 29, y - 4, 23, 1, P.white);
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
