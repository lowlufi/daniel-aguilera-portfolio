import * as D from '../game/dulce';
import { P } from '../game/dulce';
import type { ModeloAvion } from './fisica-tipos';

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

export type PlaneLook = {
  ink: string;
  w: number;
  h: number;
  /** Propeller hub or jet nozzle, relative to the centre. */
  prop?: [number, number, number];
  jet?: [number, number];
  /** Where the pilot's scarf starts flapping from, and its two colors. */
  scarf: [number, number];
  scarfC: [string, string];
  /** Where missiles and bombs leave the plane. */
  rack: [number, number];
};

export const LOOKS: Record<ModeloAvion, PlaneLook> = {
  avioneta: { ink: '#9a5a10', w: 50, h: 34, prop: [21, 0, 7], scarf: [-3, -8], scarfC: ['#8a5ad8', '#b48af4'], rack: [2, 6] },
  caza: { ink: P.o0, w: 62, h: 34, jet: [-23, 0], scarf: [-1, -9], scarfC: [P.r1, P.r2], rack: [0, 5] },
  bombardero: { ink: '#2a5a9a', w: 76, h: 46, prop: [16, 5, 6], scarf: [9, -13], scarfC: [P.p0, P.p1], rack: [-2, 8] },
};

function paintAvioneta(g: Ctx) {
  const Y = '#ffd84a', Y0 = '#e8a828', Y1 = '#fff2a8';
  // Tail fin and stabilizer.
  for (let i = 0; i < 8; i++) R(g, -20 + Math.floor(i / 2), -10 + i, 5, 1, Y);
  R(g, -19, -10, 2, 1, Y1);
  R(g, -22, -1, 10, 3, Y0);
  // Fuselage: shade, body, highlight, a red stripe.
  D.oval(g, 0, 0, 17, 5, Y0);
  D.oval(g, 0, -1, 16, 4, Y);
  R(g, -10, -4, 17, 1, Y1);
  R(g, -14, 1, 25, 1, P.r1);
  // Cowling and spinner.
  D.disc(g, 16, 0, 4, P.r1);
  D.disc(g, 16, -1, 3, P.r2);
  R(g, 15, -3, 2, 1, P.r3);
  R(g, 20, -1, 2, 3, P.metal);
  // Low wing seen a little from the front.
  D.oval(g, 2, 3, 11, 2, Y0);
  R(g, -7, 2, 18, 1, Y1);
  // Landing gear.
  R(g, 5, 5, 1, 4, P.metal0);
  D.disc(g, 5, 9, 2, '#4a3a5a');
  R(g, 5, 9, 1, 1, P.metal);
  // Open cockpit, windscreen and Lulu.
  R(g, -4, -5, 9, 2, Y0);
  luluHead(g, 0, -4);
  R(g, 7, -9, 1, 5, P.gl1);
  R(g, 6, -8, 1, 4, P.gl0);
}

function paintCaza(g: Ctx) {
  const O = P.o2, O0 = P.o1, O1 = P.o3;
  // Swept tail fin.
  for (let i = 0; i < 9; i++) R(g, -22 + Math.round(i * 0.6), -12 + i, 6 - Math.floor(i / 4), 1, i < 2 ? O1 : O);
  R(g, -24, 0, 10, 2, O0);
  // Fuselage and a pointed nose.
  D.oval(g, -2, 0, 20, 4, O0);
  D.oval(g, -2, -1, 19, 3, O);
  R(g, -14, -3, 20, 1, O1);
  R(g, 16, -3, 3, 6, O);
  R(g, 19, -2, 3, 4, O);
  R(g, 22, -1, 3, 2, O0);
  R(g, 25, 0, 2, 1, O0);
  R(g, 16, -3, 6, 1, O1);
  R(g, -16, 1, 30, 1, P.cream);
  // Swept wing.
  for (let i = 0; i < 6; i++) R(g, -6 - i, 2 + i, 13 - i, 1, i === 0 ? O1 : O0);
  // Missile under the wing.
  R(g, -3, 7, 9, 2, P.white);
  R(g, 6, 7, 2, 2, P.red);
  R(g, -4, 6, 2, 1, P.metal);
  // Nozzle.
  R(g, -23, -2, 3, 4, P.metal0);
  // Bubble canopy with Dui inside.
  D.oval(g, 6, -4, 7, 4, P.gl0);
  duiHead(g, 5, -1);
  g.globalAlpha = 0.45;
  D.oval(g, 6, -4, 6, 3, P.gl1);
  g.globalAlpha = 1;
  R(g, 8, -7, 3, 1, P.white);
}

function paintBombardero(g: Ctx) {
  const B = '#9ad0ff', B0 = '#5a9ae0', B1 = '#d8f0ff';
  // Big tail fin.
  for (let i = 0; i < 12; i++) R(g, -32 + Math.round(i * 0.5), -17 + i, 8, 1, i < 2 ? B1 : B);
  R(g, -34, -2, 13, 4, B0);
  // Fat fuselage.
  D.oval(g, 0, 0, 27, 8, B0);
  D.oval(g, 0, -1, 26, 7, B);
  R(g, -18, -7, 30, 2, B1);
  R(g, -24, 3, 46, 1, P.white);
  // Round windows.
  for (let k = 0; k < 4; k++) {
    D.disc(g, -15 + k * 7, -1, 2, P.gl0);
    R(g, -16 + k * 7, -2, 1, 1, P.white);
  }
  // Glass nose.
  D.disc(g, 23, 0, 5, P.gl0);
  D.disc(g, 23, -1, 4, P.gl1);
  R(g, 23, -4, 2, 1, P.white);
  // Wing, and the engine under it.
  D.oval(g, -2, 4, 17, 3, B0);
  R(g, -16, 3, 28, 1, B1);
  D.oval(g, 9, 5, 7, 3, P.metal0);
  D.oval(g, 9, 4, 6, 2, P.metal);
  // Bomb bay.
  R(g, -10, 8, 16, 1, B0);
  // Cockpit bump with Almendrita.
  D.oval(g, 10, -8, 6, 4, P.gl0);
  almendritaHead(g, 10, -5);
  g.globalAlpha = 0.45;
  D.oval(g, 10, -8, 5, 3, P.gl1);
  g.globalAlpha = 1;
}

const PAINT: Record<ModeloAvion, (g: Ctx) => void> = { avioneta: paintAvioneta, caza: paintCaza, bombardero: paintBombardero };

export function planeSprite(m: ModeloAvion) {
  const L = LOOKS[m];
  return D.outlined(`avion|${m}`, L.ink, L.w, L.h, L.w / 2, L.h / 2, PAINT[m]);
}

/**
 * The plane at (x, y) on screen, nose along `angle` (screen radians, y down),
 * flipped by `roll` (+1 canopy up, -1 rolled over). `t` animates the
 * propeller, the jet flame and the scarf; `gas` makes the flame bigger.
 */
export function drawPlane(g: Ctx, m: ModeloAvion, x: number, y: number, angle: number, roll: number, t: number, gas: number, blink = false) {
  const L = LOOKS[m];
  const img = planeSprite(m);
  g.save();
  g.translate(Math.round(x), Math.round(y));
  // Quantized so the nearest-neighbour rotation doesn't shimmer every frame.
  g.rotate(Math.round(angle / 0.05) * 0.05);
  const sy = Math.abs(roll) < 0.25 ? 0.25 * Math.sign(roll || 1) : Math.round(roll * 4) / 4;
  g.scale(1, sy);
  // The pilot's scarf flaps behind the cockpit.
  const [sx0, sy0] = L.scarf;
  for (let i = 0; i < 5; i++) {
    const wave = Math.round(Math.sin(t * 18 - i * 0.9) * (i * 0.4));
    R(g, sx0 - 3 - i * 2, sy0 + wave + (i > 2 ? 1 : 0), 3, 2, L.scarfC[i % 2]);
  }
  if (!blink) g.drawImage(img, -L.w / 2, -L.h / 2);
  if (L.prop) {
    const [px, py, r] = L.prop;
    const f = Math.floor(t * 40) % 3;
    g.globalAlpha = 0.7;
    R(g, px + 1, py - [r, r - 3, 2][f], 1, [r, r - 3, 2][f] * 2, P.metal);
    g.globalAlpha = 0.3;
    R(g, px + 1, py - r, 1, r * 2, P.white);
    g.globalAlpha = 1;
  }
  if (L.jet) {
    const [jx, jy] = L.jet;
    const len = 3 + Math.round(gas * 6) + (Math.floor(t * 30) % 2);
    D.oval(g, jx - len / 2, jy, Math.ceil(len / 2) + 1, 2, '#ff9a3c');
    D.oval(g, jx - len / 3, jy, Math.ceil(len / 3), 1, P.gold);
    R(g, jx - 1, jy, 2, 1, P.white);
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

export type VehiculoTipo = 'jeep' | 'camion' | 'tanque' | 'sam';

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

export const VEH_LOOK: Record<VehiculoTipo, { w: number; h: number; paint: (g: Ctx, f: number) => void }> = {
  jeep: { w: 24, h: 18, paint: paintJeep },
  camion: { w: 34, h: 18, paint: paintCamion },
  tanque: { w: 30, h: 18, paint: paintTanque },
  sam: { w: 34, h: 24, paint: paintSam },
};

function vehicleSprite(k: VehiculoTipo, f: number) {
  const L = VEH_LOOK[k];
  return D.outlined(`veh|${k}|${f}`, VINK, L.w + 6, L.h + 6, L.w / 2 + 3, L.h + 2, (g) => L.paint(g, f));
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
  g.drawImage(flash ? white(img) : img, -L.w / 2 - 3, -L.h - 2);
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

/** A missile pointing along `angle` (screen radians). */
export function drawMissile(g: Ctx, x: number, y: number, angle: number, enemy: boolean, burning: boolean, t: number) {
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(angle / 0.1) * 0.1);
  const body = enemy ? '#f4f0ff' : P.white;
  const tip = enemy ? P.p0 : P.red;
  const ink = enemy ? VINK : P.red0;
  R(g, -5, -2, 11, 4, ink);
  R(g, -4, -1, 9, 2, body);
  R(g, 4, -1, 2, 2, tip);
  R(g, -5, -3, 2, 6, ink);
  R(g, -4, -2, 1, 4, tip);
  if (burning) {
    const len = 2 + (Math.floor(t * 30) % 2);
    R(g, -6 - len, -1, len, 2, '#ff9a3c');
    R(g, -7, -1, 1, 1, P.gold);
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

/** A cartoon blast `k` (0…1) of the way through, with fireball radius r. */
export function drawBlast(g: Ctx, x: number, y: number, r: number, k: number) {
  if (k < 0.12) {
    D.disc(g, x, y, Math.max(2, Math.round(r * (0.5 + k * 4))), P.white);
    return;
  }
  if (k < 0.55) {
    const rr = Math.round(r * (0.9 + k * 0.4));
    D.disc(g, x, y, rr + 1, '#ff7090');
    D.disc(g, x, y, rr, '#ff9a3c');
    D.disc(g, x, y - 1, Math.round(rr * 0.75), P.gold);
    D.disc(g, x - 1, y - 2, Math.round(rr * 0.4), P.gold1);
    return;
  }
  // The ring breaks up into a few puffs.
  const rr = Math.round(r * (1.2 + k * 0.3));
  const pr = Math.max(1, Math.round(r * (1 - k) * 0.7));
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + 0.3;
    D.disc(g, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, pr, k < 0.75 ? '#ff9a3c' : '#ffd0a0');
  }
}

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
    const scal = 5 + (x % 8 < 4 ? 1 : x % 8 === 4 || x % 8 === 7 ? 0 : -1);
    R(g, x, y0, 1, scal + 1, P.g0);
    R(g, x, y0, 1, scal, P.g1);
    R(g, x, y0 + 1, 1, 2, P.g2);
    const hn = Math.round(heightAt(x + 1));
    // Outline along the top, joined where the slope steps.
    R(g, x, Math.min(y0, rowOf(hn)) - 1, 1, Math.abs(hn - h) + 1, P.g0);
    if (x % 6 === 2) R(g, x, y0 + 1, 1, 1, P.g3);
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

  // Scenery, kept clear of the pantry.
  const scenery: [number, number][] = [];
  for (let x = pantry.x1 + 30; x < length - 10; x += 14 + (hash(x, 1) % 40)) scenery.push([x, hash(x, 2) % 10]);
  for (const [x, kind] of scenery) {
    const y = rowOf(Math.round(heightAt(x))) + 1;
    if (kind < 3) {
      // Lollipop tree.
      const r = 6 + (hash(x, 3) % 4);
      const th = 8 + (hash(x, 4) % 6);
      R(g, x - 2, y - th, 4, th, P.k0);
      R(g, x - 1, y - th, 2, th, P.k1);
      const col = kind === 0 ? [P.p0, P.p1, P.p3] : [P.l0, P.l2, P.l3];
      D.disc(g, x, y - th - r + 2, r + 1, col[0]);
      D.disc(g, x, y - th - r + 2, r, col[1]);
      R(g, x - Math.round(r / 2), y - th - r - Math.round(r / 2) + 2, 3, 2, col[2]);
    } else if (kind < 7) {
      // Bush of three balls.
      for (const [dx, rr] of [[-4, 3], [4, 3], [0, 4]] as const) D.disc(g, x + dx, y - rr - 1, rr + 1, P.g0);
      for (const [dx, rr] of [[-4, 3], [4, 3], [0, 4]] as const) D.disc(g, x + dx, y - rr - 1, rr, P.g2);
      R(g, x - 2, y - 7, 2, 1, P.g4);
    } else {
      // Flowers.
      for (let i = 0; i < 3; i++) {
        const fx = x + i * 4 - 4;
        const col = [P.r2, P.gold, P.p1][(hash(x, 5 + i) % 3)];
        R(g, fx, y - 4, 1, 4, P.g0);
        R(g, fx - 1, y - 6, 3, 2, col);
        R(g, fx, y - 7, 1, 1, col);
        R(g, fx, y - 5, 1, 1, P.white);
      }
    }
  }

  // The pantry: a pink storehouse with a fish sign and crates of tins.
  const px = pantry.x0;
  const base = rowOf(Math.round(heightAt(px + 30))) + 1;
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
  return { canvas: c, top };
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
