/*
 * «Modo GORE» (opt-in, off by default): cartoon pixel blood for the mice.
 *
 *   · gotas: blood droplets (1–2 px) that fly with gravity; on the ground they
 *     leave a stain, on the sea a little red splash and a pink tint that fades.
 *     Blood from mid-air kills lives longer, so it rains down onto the ground.
 *   · niebla: a red mist (cockpits hit by gunfire, bodies blown apart)
 *   · trozos: a mouse blown apart into chunky pieces (head with its helmet,
 *     torso, limbs, tail, ears, eyeballs, buck teeth, whiskers, a ribcage and
 *     a loop of gut) that spin, bounce, slide leaving a smear, drip blood and
 *     lie on the ground for a while. A torso still pumps a few arterial spurts.
 *   · cuerpos: a limp mouse falling from the sky (a pilot who didn't bail out,
 *     a helicopter crewman) trailing a red streak; it bursts where it lands
 *   · emisores: arterial spurts that pulse a few times from a body, and slow
 *     drips from wrecks and bodies
 *   · manchas: blood stains and pools on the ground (ring buffer); pools are
 *     fed by whatever bleeds near them and keep spreading slowly, then dry
 *   · salpicones: splatter decals stuck to wrecks (a charred cabin with a
 *     bloody windshield) and to the air near the ground, with drips running down
 *   · tintes: red slicks on the water surface
 *   · pantalla: red droplets splattering on the «camera» when a burst happens
 *     right next to the player (screen space, quick fade; off with «Menos
 *     movimiento»)
 *
 * SNES look: no anti-aliasing, flat colours, alpha in steps of 1/4.
 *
 * Performance (phones): fixed pools in typed arrays (nothing allocated per
 * frame), hard caps everywhere, off-screen culling when drawing, and a level
 * of detail that thins out new droplets and mist as the pool fills. Gibs may
 * recycle the oldest droplet.
 *
 * World coordinates: x right, y = altitude up (as in efectos.ts).
 */

type Ctx = CanvasRenderingContext2D;

/* ── Constants ──────────────────────────────────────────────────────────── */

const MAX_P = 900; // droplets + mist + gibs + bodies + water drops
const MAX_MANCHAS = 900; // ground stains and pools
const MAX_TINTES = 40; // slicks on the water
const MAX_EMI = 40; // arterial spurts and drips
const MAX_SALP = 48; // splatter decals
const MAX_PANT = 28; // drops on the camera
const GRAV = 190; // px/s²
const VIDA_MANCHA = 140; // s
const VIDA_TROZO = 16; // s
const VIDA_TINTE = 40; // s
const VIDA_SALP = 45; // s
const MAX_HUESOS = 220; // bones lying on the ground (they outlast the blood)
const VIDA_HUESO = 200; // s
const MAX_ARR = 12; // wounded mice crawling
const MAX_AV = 16; // red specks on the player's plane
const VIDA_AV = 30; // s (faster in rain, at once in the sea)
/** `rebotes` value of a piece lying still. */
const REPOSO = 7;

// Particle kinds.
const T_GOTA = 0, T_TROZO = 1, T_AGUA = 2, T_NIEBLA = 3, T_CUERPO = 4;
// Gib shapes.
const CABEZA = 0, TORSO = 1, MIEMBRO = 2, COLA = 3, OREJA_G = 4, OJO_G = 5, DIENTE = 6, BIGOTE = 7, COSTILLAS = 8, TRIPA = 9;
// Bones (and half-bone pieces, brains, gut ropes).
const CRANEO = 10, FEMUR = 11, VERTEBRA = 12, MANDIBULA = 13, ASTILLA = 14, MEDIO = 15, SESO = 16, SOGA = 17;
/** A whole skeleton lying on the ground (bone decals only). */
const ESQUELETO = 20;
const esHueso = (f: number) => f === COSTILLAS || (f >= CRANEO && f <= ASTILLA);

/** Kinds of cry for `Gore.grito`: a death, a piece torn off, a crawling moan, a falling «¡noo!». */
export const L_MUERTE = 0, L_DESMEMBRAR = 1, L_HERIDO = 2, L_NOO = 3;
// Emitters.
const E_ARTERIA = 0, E_GOTEO = 1;
// Decals.
const S_SALPICON = 0, S_CHATARRA = 1;

// Blood: bright, mid, dark. Never brown: a cartoon red.
const ROJO = ['#ff3a4a', '#d01a34', '#8a0a24'];
const ROSA_AGUA = ['#ff8aa0', '#e85a78'];
const TINTE = '#e04a6a';

/** Colours of a mouse to tear apart: fur (head, limbs), clothes (torso), helmet. */
export type Pelaje = { piel: string; ropa: string; casco: string };
/** A foot soldier (gigantes.ts): pale fur, lilac fatigues, red helmet. */
export const SOLDADO: Pelaje = { piel: '#e0d8ec', ropa: '#b49af4', casco: '#e03a3a' };
/** A fighter or helicopter pilot (motor.ts `dibujarEyectado`). */
export const PILOTO: Pelaje = { piel: '#b8b0d0', ropa: '#9a90b8', casco: '#e03a3a' };
/** A vehicle crewman. */
export const TRIPULANTE: Pelaje = { piel: '#c8c0d8', ropa: '#8064d8', casco: '#e03a3a' };
/** A UFO crewman: space suit and a glass bubble helmet. */
export const ESPACIAL: Pelaje = { piel: '#d0c8e8', ropa: '#5ad0e0', casco: '#cfefff' };
const PELAJES = [SOLDADO, PILOTO, TRIPULANTE, ESPACIAL];
const COLA_C = '#ffb0c4';
const OJO = '#1a1428';
const OREJA = '#c9b4ff';
const OREJA_IN = '#ffb0c4';
const BLANCO = '#f4f0ff';
const HUESO = '#f4ecdc';
const DIENTE_C = '#fff4c0';
const BIGOTE_C = '#5a5068';
const TRIPA_C = ['#ff8aa8', '#d85a80'];
const CHAMUSCA = ['#3a3048', '#241c30', '#5a5068'];
const VIDRIO = '#9ad8ff';
const HUESO_SOMBRA = '#b8ac98';
/** Charred bone: black, soot, and a pale glint. */
const CARBON = ['#241c30', '#4a4048', '#9a9088'];
const SESO_C = ['#ffb4cc', '#e07898'];

export type Gore = {
  n: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  edad: Float32Array;
  vida: Float32Array;
  ang: Float32Array;
  giro: Float32Array;
  /** Gibs: time to the next arterial pulse. */
  aux: Float32Array;
  tipo: Uint8Array;
  /** Droplets/mist: size in px. Gibs: shape. */
  forma: Uint8Array;
  /** Droplets: colour index. Gibs: arterial pulses left. Bodies: fur index. */
  color: Uint8Array;
  rebotes: Uint8Array;
  /** Gib colour per slot (constant strings, nothing allocated). */
  tinta: string[];
  casco: string[];
  // Ground stains (ring buffer).
  mn: number;
  mi: number;
  mx: Float32Array;
  my: Float32Array;
  mw: Uint8Array;
  medad: Float32Array;
  // Water tints (ring buffer).
  tn: number;
  ti: number;
  tx: Float32Array;
  tedad: Float32Array;
  /** How much blood went into each patch (it spreads wider the more it gets). */
  tpeso: Float32Array;
  // Emitters (swap-remove pool).
  en: number;
  ex: Float32Array;
  ey: Float32Array;
  evx: Float32Array;
  evy: Float32Array;
  eedad: Float32Array;
  evida: Float32Array;
  et: Float32Array;
  /** Arteria: spurt direction (−1…1). Goteo: width. */
  edir: Float32Array;
  epulsos: Uint8Array;
  etipo: Uint8Array;
  // Splatter decals (ring buffer).
  sn: number;
  si: number;
  sx: Float32Array;
  sy: Float32Array;
  stam: Uint8Array;
  skind: Uint8Array;
  sedad: Float32Array;
  // Drops on the camera (ring buffer, screen fractions).
  pn: number;
  pi: number;
  px: Float32Array;
  py: Float32Array;
  ptam: Uint8Array;
  pedad: Float32Array;
  pvida: Float32Array;
  /** Camera: the player's position and whether drops may land on the lens. */
  camX: number;
  camY: number;
  camOn: boolean;
  camCd: number;
  // Bones lying on the ground (ring buffer): position, shape, quarter turn, charred.
  hn: number;
  hi: number;
  hx: Float32Array;
  hy: Float32Array;
  hforma: Uint8Array;
  hq: Uint8Array;
  hcarbon: Uint8Array;
  hedad: Float32Array;
  // Wounded mice crawling (swap-remove pool).
  an: number;
  ax: Float32Array;
  adir: Int8Array;
  aedad: Float32Array;
  avida: Float32Array;
  at: Float32Array;
  apelo: Uint8Array;
  // Red specks on the player's plane (ring buffer, along / across its body).
  vn: number;
  vi: number;
  vu: Float32Array;
  vv: Float32Array;
  vedad: Float32Array;
  vtam: Uint8Array;
  avOn: boolean;
  avLargo: number;
  avLavado: number;
  /** Cries: the engine plays a mouse's scream (kind L_*, at x, y). */
  grito: ((tipo: number, x: number, y: number) => void) | null;
  /** The world, as last seen by `actualizar` (for spawn-time ground checks). */
  suelo: (x: number) => number;
  esMar: (x: number) => boolean;
  nivelMar: number;
};

const sinSuelo = () => -1e9;
const nunca = () => false;

export function crearGore(): Gore {
  return {
    n: 0,
    x: new Float32Array(MAX_P),
    y: new Float32Array(MAX_P),
    vx: new Float32Array(MAX_P),
    vy: new Float32Array(MAX_P),
    edad: new Float32Array(MAX_P),
    vida: new Float32Array(MAX_P),
    ang: new Float32Array(MAX_P),
    giro: new Float32Array(MAX_P),
    aux: new Float32Array(MAX_P),
    tipo: new Uint8Array(MAX_P),
    forma: new Uint8Array(MAX_P),
    color: new Uint8Array(MAX_P),
    rebotes: new Uint8Array(MAX_P),
    tinta: new Array<string>(MAX_P).fill(''),
    casco: new Array<string>(MAX_P).fill(''),
    mn: 0,
    mi: 0,
    mx: new Float32Array(MAX_MANCHAS),
    my: new Float32Array(MAX_MANCHAS),
    mw: new Uint8Array(MAX_MANCHAS),
    medad: new Float32Array(MAX_MANCHAS),
    tn: 0,
    ti: 0,
    tx: new Float32Array(MAX_TINTES),
    tedad: new Float32Array(MAX_TINTES),
    tpeso: new Float32Array(MAX_TINTES),
    en: 0,
    ex: new Float32Array(MAX_EMI),
    ey: new Float32Array(MAX_EMI),
    evx: new Float32Array(MAX_EMI),
    evy: new Float32Array(MAX_EMI),
    eedad: new Float32Array(MAX_EMI),
    evida: new Float32Array(MAX_EMI),
    et: new Float32Array(MAX_EMI),
    edir: new Float32Array(MAX_EMI),
    epulsos: new Uint8Array(MAX_EMI),
    etipo: new Uint8Array(MAX_EMI),
    sn: 0,
    si: 0,
    sx: new Float32Array(MAX_SALP),
    sy: new Float32Array(MAX_SALP),
    stam: new Uint8Array(MAX_SALP),
    skind: new Uint8Array(MAX_SALP),
    sedad: new Float32Array(MAX_SALP),
    pn: 0,
    pi: 0,
    px: new Float32Array(MAX_PANT),
    py: new Float32Array(MAX_PANT),
    ptam: new Uint8Array(MAX_PANT),
    pedad: new Float32Array(MAX_PANT),
    pvida: new Float32Array(MAX_PANT),
    camX: 0,
    camY: 0,
    camOn: false,
    camCd: 0,
    hn: 0,
    hi: 0,
    hx: new Float32Array(MAX_HUESOS),
    hy: new Float32Array(MAX_HUESOS),
    hforma: new Uint8Array(MAX_HUESOS),
    hq: new Uint8Array(MAX_HUESOS),
    hcarbon: new Uint8Array(MAX_HUESOS),
    hedad: new Float32Array(MAX_HUESOS),
    an: 0,
    ax: new Float32Array(MAX_ARR),
    adir: new Int8Array(MAX_ARR),
    aedad: new Float32Array(MAX_ARR),
    avida: new Float32Array(MAX_ARR),
    at: new Float32Array(MAX_ARR),
    apelo: new Uint8Array(MAX_ARR),
    vn: 0,
    vi: 0,
    vu: new Float32Array(MAX_AV),
    vv: new Float32Array(MAX_AV),
    vedad: new Float32Array(MAX_AV),
    vtam: new Uint8Array(MAX_AV),
    avOn: false,
    avLargo: 10,
    avLavado: 1,
    grito: null,
    suelo: sinSuelo,
    esMar: nunca,
    nivelMar: -1e9,
  };
}

/** Empties everything (a new game, or the mode switched off). */
export function limpiar(e: Gore): void {
  e.n = 0;
  e.mn = 0;
  e.mi = 0;
  e.tn = 0;
  e.ti = 0;
  e.en = 0;
  e.sn = 0;
  e.si = 0;
  e.pn = 0;
  e.pi = 0;
  e.hn = 0;
  e.hi = 0;
  e.an = 0;
  e.vn = 0;
  e.vi = 0;
}

/** True when there is nothing to update or draw. */
export function vacio(e: Gore): boolean {
  return e.n === 0 && e.mn === 0 && e.tn === 0 && e.en === 0 && e.sn === 0 && e.pn === 0 && e.hn === 0 && e.an === 0 && e.vn === 0;
}

/** Live particles (to measure). */
export function vivos(e: Gore): number {
  return e.n;
}

/**
 * Where the player is, and whether blood may splatter on the camera (playing,
 * and not with «Menos movimiento»). Call it every frame before the hits.
 */
export function camara(e: Gore, x: number, y: number, on: boolean): void {
  e.camX = x;
  e.camY = y;
  e.camOn = on;
}

/**
 * The player's plane this frame: its length (px from the middle to the nose),
 * how fast specks wash off (1 dry air, more in rain, a lot in the sea), and
 * whether it is flying (blood only sticks to it then).
 */
export function avion(e: Gore, largo: number, lavado: number, on: boolean): void {
  e.avLargo = largo;
  e.avLavado = lavado;
  e.avOn = on;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A few red specks stuck on the plane's body. */
function manchaAvion(e: Gore, n: number) {
  if (!e.avOn) return;
  for (let k = 0; k < n; k++) {
    const i = e.vi;
    e.vi = (e.vi + 1) % MAX_AV;
    if (e.vn < MAX_AV) e.vn++;
    e.vu[i] = Math.round(rnd(-0.75, 0.6) * e.avLargo);
    e.vv[i] = Math.round(rnd(-1.4, 1.4));
    e.vedad[i] = 0;
    e.vtam[i] = Math.random() < 0.3 ? 2 : 1;
  }
}

/** Optional pieces (extra bones, scraps): skipped more often the fuller the pool. */
const opc = (e: Gore) => {
  const k = lod(e);
  return k >= 0.6 || Math.random() < k;
};
/** Level of detail: fewer new droplets the fuller the pool is. */
function lod(e: Gore): number {
  const k = e.n / MAX_P;
  return k < 0.45 ? 1 : k < 0.7 ? 0.6 : k < 0.85 ? 0.35 : 0.15;
}
const cuantos = (e: Gore, n: number) => Math.max(1, Math.round(n * lod(e)));

/** A free slot, or -1. A gib (`importante`) may take over the oldest droplet. */
function slot(e: Gore, importante: boolean): number {
  if (e.n < MAX_P) return e.n++;
  if (!importante) return -1;
  let best = -1, edad = -1;
  for (let i = 0; i < e.n; i++) {
    const t = e.tipo[i];
    if (t !== T_TROZO && t !== T_CUERPO && e.edad[i] > edad) {
      edad = e.edad[i];
      best = i;
    }
  }
  return best;
}

function quitar(e: Gore, i: number) {
  const j = --e.n;
  if (i === j) return;
  e.x[i] = e.x[j];
  e.y[i] = e.y[j];
  e.vx[i] = e.vx[j];
  e.vy[i] = e.vy[j];
  e.edad[i] = e.edad[j];
  e.vida[i] = e.vida[j];
  e.ang[i] = e.ang[j];
  e.giro[i] = e.giro[j];
  e.aux[i] = e.aux[j];
  e.tipo[i] = e.tipo[j];
  e.forma[i] = e.forma[j];
  e.color[i] = e.color[j];
  e.rebotes[i] = e.rebotes[j];
  e.tinta[i] = e.tinta[j];
  e.casco[i] = e.casco[j];
}

function gota(e: Gore, x: number, y: number, vx: number, vy: number, tipo = T_GOTA, vida = 0) {
  const i = slot(e, false);
  if (i < 0) return;
  e.x[i] = x;
  e.y[i] = y;
  e.vx[i] = vx;
  e.vy[i] = vy;
  e.edad[i] = 0;
  e.vida[i] = vida > 0 ? vida : tipo === T_AGUA ? rnd(0.35, 0.6) : tipo === T_NIEBLA ? rnd(0.5, 0.9) : rnd(1.6, 2.6);
  e.ang[i] = 0;
  e.giro[i] = 0;
  e.aux[i] = 0;
  e.tipo[i] = tipo;
  e.forma[i] = tipo === T_NIEBLA ? (Math.random() < 0.5 ? 3 : 2) : Math.random() < 0.3 ? 2 : 1;
  e.color[i] = tipo === T_AGUA ? (Math.random() < 0.5 ? 0 : 1) : tipo === T_NIEBLA ? (Math.random() < 0.6 ? 0 : 1) : Math.floor(Math.random() * 2.4);
  e.rebotes[i] = 0;
}

function trozo(e: Gore, x: number, y: number, vx: number, vy: number, forma: number, tinta: string, casco: string, pulsos = 0) {
  const i = slot(e, true);
  if (i < 0) return;
  e.x[i] = x;
  e.y[i] = y;
  e.vx[i] = vx;
  e.vy[i] = vy;
  e.edad[i] = 0;
  e.vida[i] = VIDA_TROZO + rnd(-2, 2);
  e.ang[i] = rnd(0, Math.PI * 2);
  e.giro[i] = rnd(-14, 14);
  e.aux[i] = rnd(0.15, 0.3);
  e.tipo[i] = T_TROZO;
  e.forma[i] = forma;
  e.color[i] = pulsos;
  e.rebotes[i] = 0;
  e.tinta[i] = tinta;
  e.casco[i] = casco;
}

const pelajeIdx = (p: Pelaje) => Math.max(0, PELAJES.indexOf(p));

/**
 * A spurt of blood at (x, y), thrown mostly along (dx, dy) (any length; 0, 0
 * sprays all round) with an upward bias. `n` droplets (fewer when busy).
 */
export function sangre(e: Gore, x: number, y: number, dx: number, dy: number, n: number, fuerza = 1, vida = 0): void {
  const d = Math.hypot(dx, dy);
  const ux = d > 0 ? dx / d : 0, uy = d > 0 ? dy / d : 0;
  n = cuantos(e, n);
  for (let k = 0; k < n; k++) {
    const v = rnd(30, 105) * fuerza;
    const a = Math.random() * Math.PI * 2;
    // Half along the given direction, half a round spray.
    const sx = ux * 0.65 + Math.cos(a) * 0.55, sy = uy * 0.65 + Math.sin(a) * 0.55 + 0.35;
    gota(e, x + rnd(-1, 1), y + rnd(-1, 1), sx * v, sy * v, T_GOTA, vida);
  }
}

/** A red mist puff (gunfire through a cockpit, a body bursting). */
export function niebla(e: Gore, x: number, y: number, vx: number, vy: number, n: number): void {
  n = cuantos(e, n);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, v = rnd(8, 40);
    gota(e, x + rnd(-2, 2), y + rnd(-2, 2), vx * 0.6 + Math.cos(a) * v, vy * 0.6 + Math.sin(a) * v, T_NIEBLA);
  }
}

/** One drop shed by something wounded on the move (a red streak behind it). */
export function rastro(e: Gore, x: number, y: number, vx: number, vy: number): void {
  if (lod(e) < 0.5 && Math.random() < 0.5) return;
  gota(e, x + rnd(-1, 1), y + rnd(-1, 1), vx * 0.35 + rnd(-10, 10), vy * 0.35 + rnd(-10, 10), T_GOTA, rnd(3, 5));
}

/**
 * Blood raining from a mid-air kill: droplets over `ancho` px that live long
 * enough to reach the ground (stains) or the sea (slicks).
 */
export function lluvia(e: Gore, x: number, y: number, vx: number, n: number, ancho = 20): void {
  n = cuantos(e, n);
  for (let k = 0; k < n; k++) gota(e, x + rnd(-ancho / 2, ancho / 2), y + rnd(-4, 4), vx * 0.3 + rnd(-25, 25), rnd(-10, 50), T_GOTA, rnd(5, 8));
}

/** A burst close to the player: red drops splatter on the camera. */
function cerca(e: Gore, x: number, y: number, fuerza: number) {
  const d = Math.hypot(x - e.camX, y - e.camY);
  // Right through it: the plane's body gets splashed.
  if (d < 50) manchaAvion(e, Math.round(2 + fuerza * 3 * (1 - d / 50)));
  if (!e.camOn || e.camCd > 0) return;
  if (d > 110) return;
  e.camCd = 0.7;
  const n = Math.max(1, Math.round(fuerza * (1 - d / 110) * 7));
  const lado = x >= e.camX ? 1 : -1;
  for (let k = 0; k < n; k++) {
    const i = e.pi;
    e.pi = (e.pi + 1) % MAX_PANT;
    if (e.pn < MAX_PANT) e.pn++;
    e.px[i] = 0.5 + lado * rnd(-0.1, 0.45);
    e.py[i] = rnd(0.12, 0.8);
    e.ptam[i] = Math.round(rnd(2, k === 0 ? 7 : 5));
    e.pedad[i] = 0;
    e.pvida[i] = rnd(1.1, 1.7);
  }
}

/** Specks thrown on the ground around a burst near it. */
function salpicarSuelo(e: Gore, x: number, y: number, n: number) {
  const s = e.suelo(x);
  if (y - s > 30 || e.esMar(x)) return;
  for (let k = 0; k < n; k++) {
    const xx = x + rnd(-26, 26);
    if (e.esMar(xx)) continue;
    mancha(e, xx, e.suelo(xx), Math.random() < 0.3 ? 3 : 1);
  }
}

/**
 * A mouse blown apart at (x, y) (its middle), moving with (vx, vy): head,
 * torso (still pumping), limbs (some torn to the bone), tail, ears, eyeballs,
 * buck teeth, whiskers, a ribcage, a skull, femurs, vertebrae, a jaw, bone
 * splinters and gut ropes fly off, with a fountain of blood and a mist.
 * `mult` (1–3) makes it heavier for big blasts.
 */
export function despedazar(e: Gore, x: number, y: number, vx: number, vy: number, pelo: Pelaje = SOLDADO, mult = 1): void {
  const ex = (k: number) => vx * 0.4 + rnd(-75, 75) * k * (0.8 + mult * 0.2);
  const ey = (k: number) => vy * 0.4 + rnd(55, 140) * k * (0.85 + mult * 0.15);
  trozo(e, x, y + 3, ex(1), ey(1.15), CABEZA, pelo.piel, pelo.casco);
  trozo(e, x, y, ex(0.6), ey(0.7), TORSO, pelo.ropa, pelo.casco, 4);
  for (let k = 0; k < 2; k++) trozo(e, x + rnd(-2, 2), y + rnd(-2, 2), ex(1.2), ey(1), MIEMBRO, k ? pelo.ropa : pelo.piel, pelo.casco);
  // Limbs torn to the bone.
  for (let k = 0; k < 2; k++) trozo(e, x + rnd(-2, 2), y + rnd(-2, 2), ex(1.2), ey(1), MEDIO, k ? pelo.piel : pelo.ropa, pelo.casco);
  // The tail in two segments.
  trozo(e, x, y - 2, ex(1), ey(0.9), COLA, COLA_C, pelo.casco);
  trozo(e, x, y - 2, ex(1.1), ey(0.8), COLA, COLA_C, pelo.casco);
  trozo(e, x, y + 4, ex(1.3), ey(1.2), OREJA_G, OREJA, pelo.casco);
  trozo(e, x, y + 4, ex(1.3), ey(1.2), OREJA_G, OREJA, pelo.casco);
  trozo(e, x, y + 3, ex(1.5), ey(1.3), OJO_G, BLANCO, pelo.casco);
  if (Math.random() < 0.6) trozo(e, x, y + 3, ex(1.5), ey(1.3), OJO_G, BLANCO, pelo.casco);
  trozo(e, x, y + 2, ex(1.6), ey(1.2), DIENTE, DIENTE_C, pelo.casco);
  trozo(e, x, y + 3, ex(1.6), ey(1.1), BIGOTE, BIGOTE_C, pelo.casco);
  trozo(e, x, y + 1, ex(0.8), ey(0.8), COSTILLAS, HUESO, pelo.casco);
  trozo(e, x, y, ex(0.9), ey(0.7), TRIPA, TRIPA_C[0], TRIPA_C[1]);
  trozo(e, x, y, ex(0.9), ey(0.6), SOGA, TRIPA_C[0], TRIPA_C[1]);
  // The bones.
  if (Math.random() < 0.4 + mult * 0.2) trozo(e, x, y + 3, ex(1.2), ey(1.2), CRANEO, HUESO, pelo.casco);
  trozo(e, x, y, ex(1.3), ey(1.1), FEMUR, HUESO, pelo.casco);
  if (opc(e)) trozo(e, x, y, ex(1.3), ey(1.1), FEMUR, HUESO, pelo.casco);
  trozo(e, x, y, ex(1), ey(0.9), VERTEBRA, HUESO, pelo.casco);
  if (opc(e)) trozo(e, x, y, ex(1.1), ey(0.9), VERTEBRA, HUESO, pelo.casco);
  if (opc(e)) trozo(e, x, y + 2, ex(1.4), ey(1.1), MANDIBULA, HUESO, pelo.casco);
  for (let k = 0; k < 3; k++) if (opc(e)) trozo(e, x, y, ex(1.7), ey(1.3), ASTILLA, HUESO, pelo.casco);
  // Bloody scraps of what was inside.
  for (let k = 0; k < 4; k++) trozo(e, x + rnd(-2, 2), y + rnd(-1, 2), ex(1.3), ey(0.8), MIEMBRO, k % 2 ? ROJO[1] : ROJO[2], ROJO[0]);
  // Big blasts: more of everything.
  const extra = Math.round((mult - 1) * 6);
  for (let k = 0; k < extra; k++) {
    if (!opc(e)) break;
    const f = k % 3 === 0 ? SOGA : k % 3 === 1 ? ASTILLA : MIEMBRO;
    trozo(e, x + rnd(-3, 3), y + rnd(-2, 2), ex(1.5), ey(1.2), f, f === SOGA ? TRIPA_C[0] : f === ASTILLA ? HUESO : ROJO[1], f === SOGA ? TRIPA_C[1] : ROJO[0]);
  }
  // A tall fountain up, a fast red ring all round and a mist.
  sangre(e, x, y, vx * 0.01, 1, Math.round(46 * (0.7 + mult * 0.3)), 1.6 + mult * 0.15);
  const n = cuantos(e, 20 * mult);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd(-0.2, 0.2);
    const v = rnd(90, 170) * (0.85 + mult * 0.15);
    gota(e, x, y, vx * 0.2 + Math.cos(a) * v, vy * 0.2 + Math.sin(a) * v);
  }
  niebla(e, x, y, vx * 0.2, vy * 0.2 + 10, Math.round(8 * mult));
  salpicarSuelo(e, x, y, Math.round(8 * mult));
  cerca(e, x, y, mult);
}

/** A headshot: brains, splinters of skull, an eye, and a red mist. */
export function sesos(e: Gore, x: number, y: number, vx: number, vy: number): void {
  trozo(e, x, y, vx * 0.4 + rnd(-40, 40), vy * 0.3 + rnd(70, 130), SESO, SESO_C[0], SESO_C[1]);
  if (Math.random() < 0.5) trozo(e, x, y, vx * 0.4 + rnd(-50, 50), vy * 0.3 + rnd(60, 120), SESO, SESO_C[0], SESO_C[1]);
  for (let k = 0; k < 3; k++) trozo(e, x, y, vx * 0.4 + rnd(-60, 60), vy * 0.3 + rnd(60, 140), ASTILLA, HUESO, ROJO[1]);
  if (Math.random() < 0.5) trozo(e, x, y, vx * 0.4 + rnd(-50, 50), vy * 0.3 + rnd(70, 120), OJO_G, BLANCO, ROJO[1]);
  sangre(e, x, y, vx, 2, 16, 1.4);
  niebla(e, x, y, vx * 0.3, 10, 7);
  cerca(e, x, y, 0.8);
}

/**
 * A shot tears an arm off a mouse still on its feet: the arm (bone sticking
 * out) flies off and the shoulder spurts. `dir`: away from the shot.
 */
export function amputar(e: Gore, x: number, y: number, dir: number, pelo: Pelaje = SOLDADO): void {
  trozo(e, x, y, dir * rnd(60, 110), rnd(70, 130), MEDIO, pelo.piel, pelo.casco);
  if (Math.random() < 0.4) trozo(e, x, y, dir * rnd(40, 90), rnd(60, 110), ASTILLA, HUESO, ROJO[1]);
  sangre(e, x, y, dir, 1, 16, 1.3);
  niebla(e, x, y, dir * 20, 8, 3);
  cerca(e, x, y, 0.5);
}

/**
 * A mouse whose legs a blast took off: the legs (bones out), the tail and a
 * gut rope fly, and what's left of him crawls away (`arrastrado`).
 */
export function partir(e: Gore, x: number, yGround: number, dir: number, pelo: Pelaje = SOLDADO): void {
  for (let k = 0; k < 2; k++) trozo(e, x, yGround + 3, rnd(-70, 70), rnd(70, 140), MEDIO, pelo.ropa, pelo.casco);
  trozo(e, x, yGround + 2, rnd(-60, 60), rnd(60, 120), COLA, COLA_C, pelo.casco);
  trozo(e, x, yGround + 3, rnd(-40, 40), rnd(40, 90), SOGA, TRIPA_C[0], TRIPA_C[1]);
  if (opc(e)) trozo(e, x, yGround + 3, rnd(-60, 60), rnd(60, 120), FEMUR, HUESO, ROJO[1]);
  sangre(e, x, yGround + 3, 0, 1, 26, 1.3);
  niebla(e, x, yGround + 3, 0, 10, 5);
  charco(e, x, yGround, 10);
  arrastrado(e, x, dir, pelo);
  cerca(e, x, yGround, 0.8);
}

/** What's left of a mouse drags itself along the ground for a few seconds, moaning. */
export function arrastrado(e: Gore, x: number, dir: number, pelo: Pelaje = SOLDADO): void {
  if (e.esMar(x)) return;
  let i = e.an;
  if (i >= MAX_ARR) {
    i = 0;
    for (let k = 1; k < e.an; k++) if (e.aedad[k] > e.aedad[i]) i = k;
  } else e.an++;
  e.ax[i] = x;
  e.adir[i] = dir >= 0 ? 1 : -1;
  e.aedad[i] = 0;
  e.avida[i] = rnd(5, 9);
  e.at[i] = rnd(0.2, 0.8);
  e.apelo[i] = pelajeIdx(pelo);
}

function quitarArrastrado(e: Gore, i: number) {
  const j = --e.an;
  if (i === j) return;
  e.ax[i] = e.ax[j];
  e.adir[i] = e.adir[j];
  e.aedad[i] = e.aedad[j];
  e.avida[i] = e.avida[j];
  e.at[i] = e.at[j];
  e.apelo[i] = e.apelo[j];
}

/** A blast catches the crawling wounded within `r`: they burst. */
export function reventarArrastrados(e: Gore, x: number, y: number, r: number): void {
  for (let i = e.an - 1; i >= 0; i--) {
    const ax = e.ax[i], ay = e.suelo(ax);
    if (Math.hypot(ax - x, ay - y) > r) continue;
    const pelo = PELAJES[e.apelo[i]] ?? SOLDADO;
    quitarArrastrado(e, i);
    despedazar(e, ax, ay + 3, (ax - x) * 2, 60, pelo);
  }
}

/** A skeleton lying on the ground at (x, yGround), charred by fire or clean. */
export function esqueleto(e: Gore, x: number, yGround: number, carbon: boolean): void {
  if (e.esMar(x)) return;
  hueso(e, x, yGround, ESQUELETO, Math.random() < 0.5 ? 0 : 2, carbon);
}

function hueso(e: Gore, x: number, y: number, forma: number, q: number, carbon: boolean) {
  const i = e.hi;
  e.hi = (e.hi + 1) % MAX_HUESOS;
  if (e.hn < MAX_HUESOS) e.hn++;
  e.hx[i] = Math.round(x);
  e.hy[i] = Math.round(y);
  e.hforma[i] = forma;
  e.hq[i] = q;
  e.hcarbon[i] = carbon ? 1 : 0;
  e.hedad[i] = 0;
}

/** A few small bits knocked off a mouse by a shot: an eyeball, a tooth, an ear, whiskers. */
export function trocitos(e: Gore, x: number, y: number, vx: number, vy: number, n = 2): void {
  for (let k = 0; k < n; k++) {
    const f = [OJO_G, DIENTE, OREJA_G, BIGOTE][Math.floor(Math.random() * 4)];
    const c = f === OJO_G ? BLANCO : f === DIENTE ? DIENTE_C : f === OREJA_G ? OREJA : BIGOTE_C;
    trozo(e, x, y, vx * 0.5 + rnd(-50, 50), vy * 0.5 + rnd(50, 110), f, c, ROJO[1]);
  }
}

/**
 * A red burst in the air (a pilot under his parachute caught by fire): a
 * ring of blood all round, a mist, blood raining down and the pieces.
 */
export function estallido(e: Gore, x: number, y: number, vx: number, vy: number, pelo: Pelaje = PILOTO): void {
  const n = cuantos(e, 20);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd(-0.15, 0.15);
    const v = rnd(55, 110);
    gota(e, x, y, vx * 0.3 + Math.cos(a) * v, vy * 0.3 + Math.sin(a) * v, T_GOTA, rnd(3, 6));
  }
  niebla(e, x, y, vx, vy, 10);
  lluvia(e, x, y, vx, 24, 26);
  despedazar(e, x, y, vx, vy, pelo);
}

/**
 * A limp mouse falling from the sky with a red streak behind it; it bursts
 * apart (or sinks in a slick) where it lands.
 */
export function cuerpo(e: Gore, x: number, y: number, vx: number, vy: number, pelo: Pelaje = PILOTO): void {
  const i = slot(e, true);
  if (i < 0) return;
  e.x[i] = x;
  e.y[i] = y;
  e.vx[i] = vx;
  e.vy[i] = vy;
  e.edad[i] = 0;
  e.vida[i] = 14;
  e.ang[i] = rnd(0, Math.PI * 2);
  e.giro[i] = rnd(-9, 9);
  e.aux[i] = 0;
  e.tipo[i] = T_CUERPO;
  e.forma[i] = 0;
  e.color[i] = pelajeIdx(pelo);
  e.rebotes[i] = 0;
  e.tinta[i] = pelo.ropa;
  e.casco[i] = pelo.casco;
}

function emisor(e: Gore, tipo: number, x: number, y: number, vx: number, vy: number, vida: number, dir: number, pulsos: number) {
  let i = e.en;
  if (i >= MAX_EMI) {
    // Full: take over the oldest.
    i = 0;
    for (let k = 1; k < e.en; k++) if (e.eedad[k] > e.eedad[i]) i = k;
  } else e.en++;
  e.etipo[i] = tipo;
  e.ex[i] = x;
  e.ey[i] = y;
  e.evx[i] = vx;
  e.evy[i] = vy;
  e.eedad[i] = 0;
  e.evida[i] = vida;
  e.et[i] = 0.05;
  e.edir[i] = dir;
  e.epulsos[i] = pulsos;
}

/**
 * Arterial spurts from a body knocked flying with (vx, vy): it pumps
 * `pulsos` times (weaker each time) as it flies and lies, feeding a pool.
 */
export function arteria(e: Gore, x: number, y: number, vx: number, vy: number, dir: number, pulsos = 5): void {
  emisor(e, E_ARTERIA, x, y, vx, vy, 3 + pulsos * 0.5, dir, pulsos);
}

/** Blood dripping slowly for `dur` s from `ancho` px at (x, y) (a wreck, a body). */
export function goteo(e: Gore, x: number, y: number, ancho: number, dur: number): void {
  emisor(e, E_GOTEO, x, y, 0, 0, dur, ancho, 0);
}

/** A splatter decal stuck at (x, y) (a wall of hull, the air near the ground). */
export function salpicon(e: Gore, x: number, y: number, tam = 3, kind = S_SALPICON): void {
  const i = e.si;
  e.si = (e.si + 1) % MAX_SALP;
  if (e.sn < MAX_SALP) e.sn++;
  e.sx[i] = Math.round(x);
  e.sy[i] = Math.round(y);
  e.stam[i] = tam;
  e.skind[i] = kind;
  e.sedad[i] = 0;
}

/**
 * A vehicle's crew didn't make it: the charred cabin left on the ground at
 * (x, yGround), its windshield splashed red and dripping, and a pool spreading
 * under it.
 */
export function chatarra(e: Gore, x: number, yGround: number, ancho: number): void {
  if (e.esMar(x)) {
    marea(e, x, 12, ancho);
    return;
  }
  salpicon(e, x, yGround, Math.max(8, Math.min(20, Math.round(ancho * 0.45))), S_CHATARRA);
  for (let k = 0; k < 2; k++) salpicon(e, x + rnd(-ancho / 2, ancho / 2), yGround + rnd(3, 9), Math.round(rnd(2, 4)));
  goteo(e, x, yGround + 5, Math.max(6, ancho * 0.4), 14);
  charco(e, x, yGround, 12);
  // Someone burnt to the bone beside it.
  if (Math.random() < 0.6) hueso(e, x + (Math.random() < 0.5 ? -1 : 1) * rnd(ancho * 0.4, ancho * 0.6 + 6), yGround, ESQUELETO, Math.random() < 0.5 ? 0 : 2, true);
}

/** A big red slick around a sinking boat (or a body in the sea). */
export function marea(e: Gore, x: number, peso: number, ancho = 30): void {
  tinte(e, x, peso);
  if (ancho > 12) {
    tinte(e, x - ancho * 0.6, peso * 0.5);
    tinte(e, x + ancho * 0.6, peso * 0.5);
  }
  const n = cuantos(e, 10);
  for (let k = 0; k < n; k++) gota(e, x + rnd(-ancho / 2, ancho / 2), e.nivelMar + 1, rnd(-40, 40), rnd(40, 110), T_AGUA);
}

function mancha(e: Gore, x: number, y: number, w: number) {
  // Full: overwrite the oldest small speck, sparing the big pools still fresh.
  if (e.mn === MAX_MANCHAS) {
    for (let k = 0; k < 8 && e.mw[e.mi] >= 8 && e.medad[e.mi] < 60; k++) e.mi = (e.mi + 1) % MAX_MANCHAS;
  }
  const i = e.mi;
  e.mi = (e.mi + 1) % MAX_MANCHAS;
  if (e.mn < MAX_MANCHAS) e.mn++;
  e.mx[i] = Math.round(x);
  e.my[i] = Math.round(y);
  e.mw[i] = w;
  e.medad[i] = 0;
}

/**
 * A drop landing at (x, y): onto a stain right there it just feeds it (so a
 * shower of drops builds pools instead of flooding the ring buffer).
 */
function manchaGota(e: Gore, x: number, y: number, w: number) {
  const m = Math.min(e.mn, 24);
  for (let k = 0; k < m; k++) {
    const i = (e.mi - 1 - k + MAX_MANCHAS) % MAX_MANCHAS;
    const mw = e.mw[i];
    if (e.medad[i] > 60 || Math.abs(e.my[i] - y) > 2 || Math.abs(e.mx[i] - x) > Math.max(3, (mw >> 1) + 2)) continue;
    if (mw < 9 || Math.random() < 0.2) e.mw[i] = Math.min(48, mw + 1);
    return;
  }
  mancha(e, x, y, w);
}

/** A pool at (x, y): feeds a fresh pool right there (wider), or starts one. */
export function charco(e: Gore, x: number, y: number, w: number): void {
  const m = Math.min(e.mn, 40);
  for (let k = 0; k < m; k++) {
    const i = (e.mi - 1 - k + MAX_MANCHAS) % MAX_MANCHAS;
    const mw = e.mw[i];
    if (mw < 5 || e.medad[i] > 60 || Math.abs(e.my[i] - y) > 3 || Math.abs(e.mx[i] - x) > (mw >> 1) + 3) continue;
    e.mw[i] = Math.min(48, mw + Math.max(1, w >> 2));
    return;
  }
  mancha(e, x, y, Math.max(5, Math.min(48, w)));
}

function tinte(e: Gore, x: number, peso = 1) {
  // Into a patch still on the water: it feeds it (wider, and it lasts longer).
  for (let k = 0; k < e.tn; k++) {
    if (e.tedad[k] < VIDA_TINTE - 2 && Math.abs(e.tx[k] - x) < 10 + e.tpeso[k] * 1.5) {
      e.tpeso[k] = Math.min(60, e.tpeso[k] + peso);
      e.tedad[k] = Math.min(e.tedad[k], VIDA_TINTE * 0.4);
      return;
    }
  }
  const i = e.ti;
  e.ti = (e.ti + 1) % MAX_TINTES;
  if (e.tn < MAX_TINTES) e.tn++;
  e.tx[i] = x;
  e.tedad[i] = 0;
  e.tpeso[i] = peso;
}

/** A red splash where something bloody hits the sea. */
function salpicaRojo(e: Gore, x: number, nivel: number, n: number) {
  for (let k = 0; k < n; k++) gota(e, x + rnd(-2, 2), nivel + 1, rnd(-30, 30), rnd(40, 90), T_AGUA);
  tinte(e, x, n >= 3 ? 3 : 0.5);
}

/** A falling body reached the ground or the sea. */
function aterriza(e: Gore, i: number, piso: number, mar: boolean) {
  const x = e.x[i], vx = e.vx[i], vy = e.vy[i];
  const pelo = PELAJES[e.color[i]] ?? PILOTO;
  if (mar) {
    marea(e, x, 10, 18);
    salpicaRojo(e, x, e.nivelMar, 6);
    return;
  }
  despedazar(e, x, piso + 3, vx * 0.3, Math.min(80, -vy * 0.25), pelo);
  charco(e, x, piso, 16);
  cerca(e, x, piso, 1.2);
}

function pasoEmisores(e: Gore, dt: number) {
  for (let i = e.en - 1; i >= 0; i--) {
    e.eedad[i] += dt;
    if (e.eedad[i] >= e.evida[i] || (e.etipo[i] === E_ARTERIA && e.epulsos[i] === 0)) {
      const j = --e.en;
      if (i !== j) {
        e.etipo[i] = e.etipo[j];
        e.ex[i] = e.ex[j];
        e.ey[i] = e.ey[j];
        e.evx[i] = e.evx[j];
        e.evy[i] = e.evy[j];
        e.eedad[i] = e.eedad[j];
        e.evida[i] = e.evida[j];
        e.et[i] = e.et[j];
        e.edir[i] = e.edir[j];
        e.epulsos[i] = e.epulsos[j];
      }
      continue;
    }
    const x = e.ex[i];
    if (e.etipo[i] === E_GOTEO) {
      e.et[i] -= dt;
      if (e.et[i] > 0) continue;
      e.et[i] = rnd(0.12, 0.3) / Math.max(0.3, lod(e));
      const w = e.edir[i];
      gota(e, x + rnd(-w / 2, w / 2), e.ey[i], rnd(-3, 3), 0, T_GOTA, 3);
      continue;
    }
    // An arteria: flies with the body, then lies where it lands.
    const mar = e.esMar(x);
    const piso = mar ? e.nivelMar : e.suelo(x);
    let quieto = e.evx[i] === 0 && e.evy[i] === 0;
    if (!quieto) {
      e.evy[i] -= GRAV * dt;
      e.ex[i] += e.evx[i] * dt;
      e.ey[i] += e.evy[i] * dt;
      if (e.ey[i] <= piso) {
        e.ey[i] = piso;
        e.evx[i] = e.evy[i] = 0;
        quieto = true;
        if (mar) {
          marea(e, x, 4, 8);
          e.epulsos[i] = 0;
          continue;
        }
      }
    }
    e.et[i] -= dt;
    if (e.et[i] > 0) continue;
    const p = e.epulsos[i]--;
    e.et[i] = rnd(0.3, 0.45);
    // A pulse: a jet thrown up and to one side, weaker each time.
    const f = 0.7 + p * 0.14;
    const n = cuantos(e, 5 + p);
    for (let k = 0; k < n; k++) {
      const v = rnd(60, 110) * f;
      gota(e, x, e.ey[i] + 1, e.evx[i] * 0.5 + (e.edir[i] * 0.55 + rnd(-0.15, 0.15)) * v, (0.8 + rnd(-0.1, 0.15)) * v);
    }
    if (quieto) charco(e, x, piso, 4);
  }
}

function pasoArrastrados(e: Gore, dt: number) {
  for (let i = e.an - 1; i >= 0; i--) {
    e.aedad[i] += dt;
    const x0 = e.ax[i];
    if (e.aedad[i] >= e.avida[i] || e.esMar(x0)) {
      // He stops for good: a pool, and the half body lies there a while.
      if (!e.esMar(x0)) {
        const y = e.suelo(x0);
        charco(e, x0, y, 12);
        const pelo = PELAJES[e.apelo[i]] ?? SOLDADO;
        trozo(e, x0, y + 2, 0, 10, TORSO, pelo.ropa, pelo.casco, 2);
        trozo(e, x0 + e.adir[i] * 3, y + 3, 0, 10, CABEZA, pelo.piel, pelo.casco);
        if (e.grito && Math.random() < 0.5) e.grito(L_HERIDO, x0, y);
      }
      quitarArrastrado(e, i);
      continue;
    }
    // Pulling with his arms: a jerk forward, a pause.
    const k = Math.max(0, Math.sin(e.aedad[i] * 5));
    const x1 = x0 + e.adir[i] * 8 * k * dt;
    e.ax[i] = x1;
    const y = e.suelo(x1);
    // The trail behind him, and his stumps still bleeding.
    if (Math.floor(x0 / 2) !== Math.floor(x1 / 2)) manchaGota(e, x1 - e.adir[i] * 3, y, 2);
    if (Math.random() < dt * 4 * lod(e)) gota(e, x1 - e.adir[i] * 3, y + 2, -e.adir[i] * rnd(10, 40), rnd(20, 50));
    e.at[i] -= dt;
    if (e.at[i] <= 0) {
      e.at[i] = rnd(1.4, 3);
      if (e.grito) e.grito(L_HERIDO, x1, y);
    }
  }
}

/**
 * Moves everything. `suelo(x)` is the ground altitude; over open sea
 * (`esMar(x)`) the surface is at `nivelMar`.
 */
export function actualizar(e: Gore, dt: number, suelo: (x: number) => number, esMar: (x: number) => boolean, nivelMar: number): void {
  e.suelo = suelo;
  e.esMar = esMar;
  e.nivelMar = nivelMar;
  e.camCd = Math.max(0, e.camCd - dt);
  for (let i = e.mn - 1; i >= 0; i--) e.medad[i] += dt;
  // Ring buffers: an expired entry is just hidden by the draw (age past its life).
  for (let i = 0; i < e.tn; i++) e.tedad[i] += dt;
  for (let i = 0; i < e.sn; i++) e.sedad[i] += dt;
  for (let i = 0; i < e.pn; i++) e.pedad[i] += dt;
  // Everything on the camera has run off: forget it.
  if (e.pn > 0) {
    let vivo = false;
    for (let i = 0; i < e.pn; i++) if (e.pedad[i] < e.pvida[i]) vivo = true;
    if (!vivo) e.pn = e.pi = 0;
  }
  for (let i = 0; i < e.hn; i++) e.hedad[i] += dt;
  if (e.vn > 0) {
    let vivo = false;
    for (let i = 0; i < e.vn; i++) {
      e.vedad[i] += dt * e.avLavado;
      if (e.vedad[i] < VIDA_AV) vivo = true;
    }
    if (!vivo) e.vn = e.vi = 0;
  }
  if (e.en > 0) pasoEmisores(e, dt);
  if (e.an > 0) pasoArrastrados(e, dt);
  const n0 = e.n;
  for (let i = n0 - 1; i >= 0; i--) {
    if (i >= e.n) continue;
    e.edad[i] += dt;
    if (e.edad[i] >= e.vida[i]) {
      quitar(e, i);
      continue;
    }
    const t = e.tipo[i];
    if (t === T_TROZO && e.rebotes[i] >= REPOSO) {
      // Lying on the ground: it slides to a stop, smearing a trail, and a
      // fresh torso still pumps a few times and drips into its pool. A bone
      // at rest joins the bones on the ground (they stay much longer).
      const oseo = esHueso(e.forma[i]);
      if (oseo && e.vx[i] === 0 && e.edad[i] > 1.5) {
        hueso(e, e.x[i], e.y[i], e.forma[i], ((Math.round(e.ang[i] / (Math.PI / 2)) % 4) + 4) % 4, false);
        quitar(e, i);
        continue;
      }
      if (e.vx[i] !== 0) {
        const x0 = e.x[i];
        e.x[i] += e.vx[i] * dt;
        e.vx[i] *= 1 - Math.min(1, dt * 3.5);
        if (Math.abs(e.vx[i]) < 6) e.vx[i] = 0;
        if (esMar(e.x[i])) {
          salpicaRojo(e, e.x[i], nivelMar, 3);
          quitar(e, i);
          continue;
        }
        e.y[i] = suelo(e.x[i]);
        if (!oseo && Math.floor(x0 / 4) !== Math.floor(e.x[i] / 4)) manchaGota(e, e.x[i], e.y[i], 3);
      }
      if (e.color[i] > 0) {
        e.aux[i] -= dt;
        if (e.aux[i] <= 0) {
          const p = e.color[i]--;
          e.aux[i] = rnd(0.32, 0.5);
          const n = cuantos(e, 3 + p);
          const dir = Math.random() < 0.5 ? -1 : 1;
          for (let k = 0; k < n; k++) {
            const v = rnd(50, 95) * (0.6 + p * 0.12);
            gota(e, e.x[i], e.y[i] + 1, (dir * 0.5 + rnd(-0.2, 0.2)) * v, 0.85 * v);
          }
          charco(e, e.x[i], e.y[i], 4);
        }
      }
      continue;
    }
    const grav = t === T_NIEBLA ? GRAV * 0.12 : GRAV;
    e.vy[i] -= grav * dt;
    const arr = 1 - Math.min(1, dt * (t === T_TROZO || t === T_CUERPO ? 0.3 : t === T_NIEBLA ? 4 : 0.8));
    e.vx[i] *= arr;
    if (t === T_NIEBLA) e.vy[i] *= arr;
    e.x[i] += e.vx[i] * dt;
    e.y[i] += e.vy[i] * dt;
    if (t === T_NIEBLA) continue;
    const x = e.x[i];
    const mar = esMar(x);
    const piso = mar ? nivelMar : suelo(x);
    if (t === T_AGUA) {
      if (e.y[i] < nivelMar && e.vy[i] < 0) quitar(e, i);
      continue;
    }
    // Flying through the blood: a drop that meets the plane sticks to it.
    if (t === T_GOTA && e.avOn && Math.abs(x - e.camX) < e.avLargo && Math.abs(e.y[i] - e.camY) < 4 && Math.random() < 0.5) {
      manchaAvion(e, 1);
      quitar(e, i);
      continue;
    }
    if (t === T_TROZO || t === T_CUERPO) {
      e.ang[i] += e.giro[i] * dt;
      // Fresh pieces drip as they fly; a falling body streaks red.
      if (t === T_CUERPO) {
        if (Math.random() < dt * 40 * lod(e)) gota(e, x + rnd(-1, 1), e.y[i] + rnd(-1, 1), e.vx[i] * 0.3 + rnd(-12, 12), e.vy[i] * 0.3 + rnd(-6, 12), T_GOTA, rnd(3, 6));
        if (Math.random() < dt * 8 * lod(e)) gota(e, x, e.y[i], e.vx[i] * 0.2, e.vy[i] * 0.2, T_NIEBLA);
      } else if (e.edad[i] < 2.5 && !esHueso(e.forma[i]) && Math.random() < dt * 7 * lod(e)) gota(e, x, e.y[i], e.vx[i] * 0.2, e.vy[i] * 0.2);
    }
    if (e.y[i] > piso) continue;
    if (t === T_CUERPO) {
      aterriza(e, i, piso, mar);
      quitar(e, i);
      continue;
    }
    if (mar) {
      // Into the sea: it sinks, leaving a red splash.
      salpicaRojo(e, x, nivelMar, t === T_TROZO ? 3 : 1);
      quitar(e, i);
      continue;
    }
    if (t === T_GOTA) {
      // A fast drop smears into a streak along the ground.
      manchaGota(e, x, piso, Math.min(9, e.forma[i] + (Math.random() < 0.6 ? 1 : 0) + Math.floor(Math.abs(e.vx[i]) / 35)));
      quitar(e, i);
      continue;
    }
    // A gib: bounces twice, smearing the ground, then slides to a stop.
    // A bone clatters: harder, bouncier, more times, and barely smears.
    e.y[i] = piso;
    const oseo = esHueso(e.forma[i]);
    if (oseo) {
      if (e.rebotes[i] === 0) manchaGota(e, x, piso, 2);
    } else if (e.rebotes[i] === 0) charco(e, x, piso, e.forma[i] === TORSO ? 10 : 7);
    else mancha(e, x, piso, 4);
    if (oseo ? e.rebotes[i] < 4 && e.vy[i] < -14 : e.rebotes[i] < 2 && e.vy[i] < -25) {
      e.vy[i] = -e.vy[i] * (oseo ? 0.56 : 0.38);
      e.vx[i] *= oseo ? 0.78 : 0.55;
      e.giro[i] *= oseo ? -0.9 : 0.5;
      e.rebotes[i]++;
    } else {
      e.vy[i] = e.giro[i] = 0;
      e.vx[i] *= oseo ? 0.5 : 0.8;
      e.ang[i] = Math.round(e.ang[i] / (Math.PI / 2)) * (Math.PI / 2);
      e.rebotes[i] = REPOSO;
    }
  }
}

const alfa = (k: number) => Math.max(0, Math.min(1, Math.ceil(k * 4) / 4));

/**
 * Ground stains and water tints: draw them over the ground, under the units.
 * `sx`, `sy`: world → screen. `vw`: screen width (off-screen stains are skipped).
 */
export function dibujarSuelo(g: Ctx, e: Gore, sx: (x: number) => number, sy: (y: number) => number, vw: number, nivelMar: number): void {
  if (e.mn === 0 && e.tn === 0 && e.hn === 0) return;
  let a = 1;
  for (let i = 0; i < e.mn; i++) {
    const ed = e.medad[i];
    if (ed >= VIDA_MANCHA) continue;
    const X = sx(e.mx[i]);
    if (X < -40 || X > vw + 40) continue;
    // Never over open sea (blood there is a slick on the surface instead).
    if (e.esMar(e.mx[i])) continue;
    const k = alfa(Math.min(1, (VIDA_MANCHA - ed) / 5) * 0.8);
    if (k <= 0) continue;
    if (k !== a) g.globalAlpha = a = k;
    // Follow the ground if a blast has dug a crater under the stain since.
    const Y = sy(Math.min(e.my[i], Math.round(e.suelo(e.mx[i]))));
    // Pools spread out during their first second and a half, keep creeping
    // wider for half a minute, then dry darker.
    const w0 = e.mw[i];
    const w = w0 >= 5 ? Math.max(3, Math.round(w0 * Math.min(1, 0.35 + ed * 0.45) * (1 + Math.min(ed, 30) / 60))) : w0;
    const seco = ed > 40;
    g.fillStyle = seco ? ROJO[2] : ROJO[1];
    g.fillRect(X - (w >> 1), Y - 1, w, 1);
    g.fillStyle = ROJO[2];
    g.fillRect(X - (w >> 1) - 1, Y, w + 2, 1);
    if (w >= 12) {
      // A deep pool bulges up a little.
      g.fillStyle = seco ? ROJO[2] : ROJO[1];
      g.fillRect(X - (w >> 2) - 1, Y - 2, (w >> 1) + 2, 1);
    }
    if (w >= 5) {
      // A wet shine on fresh pools and a few specks thrown around them.
      if (!seco) {
        g.fillStyle = ROJO[0];
        g.fillRect(X - (w >> 2), Y - (w >= 12 ? 2 : 1), Math.max(1, w >> 2), 1);
      }
      g.fillStyle = ROJO[1];
      const h = (i * 7919) % 13;
      g.fillRect(X - (w >> 1) - 2 - (h % 3), Y - 1, 1, 1);
      g.fillRect(X + (w >> 1) + 1 + (h % 2), Y - 1 + (h % 2), 1, 1);
      g.fillRect(X + (h % 5) - 2, Y - 2 - (w >= 12 ? 1 : 0), 1, 1);
    }
  }
  if (e.hn > 0) {
    dibujarHuesos(g, e, sx, sy, vw);
    a = 1;
  }
  const Ym = sy(nivelMar);
  for (let i = 0; i < e.tn; i++) {
    const ed = e.tedad[i];
    if (ed >= VIDA_TINTE) continue;
    const X = sx(e.tx[i]);
    if (X < -140 || X > vw + 140) continue;
    const k = alfa(Math.min(1, (VIDA_TINTE - ed) / 10) * 0.75);
    if (k <= 0) continue;
    if (k !== a) g.globalAlpha = a = k;
    // A patch that spreads on the surface (wider the more blood fed it) and a red
    // cloud sinking under it, drifting a little with the swell.
    const p = Math.sqrt(e.tpeso[i]);
    const w = Math.round(Math.min(130, (5 + Math.min(ed, 12) * 2.5) * (0.7 + p * 0.45)));
    const dx = Math.round(Math.sin(ed * 0.35 + i) * 3);
    g.fillStyle = TINTE;
    g.fillRect(X + dx - w, Ym, w * 2, 1);
    g.fillStyle = ROJO[1];
    g.fillRect(X + dx - Math.round(w * 0.7), Ym + 1, Math.round(w * 1.4), 1);
    const hondo = Math.min(9, 1 + Math.floor(ed * 0.6));
    for (let r = 2; r < 2 + hondo; r++) {
      const ww = Math.round(w * (0.6 - r * 0.05));
      if (ww < 1) break;
      g.fillStyle = r % 2 ? ROJO[2] : ROJO[1];
      g.fillRect(X + dx + Math.round(Math.sin(ed + r) * 2) - ww, Ym + r, ww * 2, 1);
    }
  }
  g.globalAlpha = 1;
}

/** A rect in a piece's own frame (dx, dy, w, h), turned by q quarter turns, at (X, Y). */
function rr(g: Ctx, X: number, Y: number, q: number, dx: number, dy: number, w: number, h: number) {
  if (q === 0) g.fillRect(X + dx, Y + dy, w, h);
  else if (q === 1) g.fillRect(X - dy - h, Y + dx, h, w);
  else if (q === 2) g.fillRect(X - dx - w, Y - dy - h, w, h);
  else g.fillRect(X + dy, Y - dx - w, h, w);
}

function dibujarSalpicones(g: Ctx, e: Gore, sx: (x: number) => number, sy: (y: number) => number, vw: number, vh: number) {
  let a = 1;
  for (let i = 0; i < e.sn; i++) {
    const ed = e.sedad[i];
    if (ed >= VIDA_SALP) continue;
    const X = sx(e.sx[i]), Y = sy(e.sy[i]);
    const t = e.stam[i];
    if (X < -t - 8 || X > vw + t + 8 || Y < -t - 12 || Y > vh + 12) continue;
    const k = alfa(Math.min(1, (VIDA_SALP - ed) / 4));
    if (k <= 0) continue;
    if (k !== a) g.globalAlpha = a = k;
    const h = (i * 7919 + 17) % 97;
    const seco = ed > 25;
    if (e.skind[i] === S_CHATARRA) {
      // The charred cabin shell left on the ground: a dark box, a cracked
      // windshield frame, red splashed across the glass and dripping down.
      const w = t, hh = Math.max(5, (t >> 1) + 1);
      const x0 = X - (w >> 1), y0 = Y - hh;
      g.fillStyle = CHAMUSCA[1];
      g.fillRect(x0, y0, w, hh);
      g.fillStyle = CHAMUSCA[0];
      g.fillRect(x0 + 1, y0 + 1, w - 2, hh - 2);
      // Windshield (the left half) with its frame.
      const ww = Math.max(3, (w >> 1) - 1), wy = y0 + 1;
      g.fillStyle = VIDRIO;
      g.fillRect(x0 + 2, wy, ww, Math.max(2, hh - 3));
      g.fillStyle = CHAMUSCA[2];
      g.fillRect(x0 + 2 + (h % ww), wy, 1, Math.max(2, hh - 3));
      // Splashed red over the glass.
      g.fillStyle = seco ? ROJO[2] : ROJO[1];
      g.fillRect(x0 + 2, wy, ww, 1);
      g.fillRect(x0 + 3, wy + 1, Math.max(1, ww - 2), 1);
      g.fillStyle = ROJO[0];
      if (!seco) g.fillRect(x0 + 2 + (h % 3), wy + 1, 1, 1);
      // The driver still at the wheel: a charred little skull behind the glass.
      g.fillStyle = CARBON[2];
      g.fillRect(x0 + 2 + (ww >> 1), wy + 1, 2, 2);
      g.fillStyle = CARBON[0];
      g.fillRect(x0 + 2 + (ww >> 1), wy + 1, 1, 1);
      // Specks on the hull.
      g.fillStyle = ROJO[1];
      g.fillRect(x0 + ww + 3, y0 + 1 + (h % 2), 1, 1);
      g.fillRect(x0 + w - 2, y0 + 2, 1, 1);
      // Drips running down the side, longer with time.
      const largo = Math.min(hh, 1 + Math.floor(ed * 0.8));
      g.fillStyle = ROJO[2];
      g.fillRect(x0 + 3, wy + 1, 1, largo);
      g.fillRect(x0 + 2 + (ww >> 1) + 1, wy + 1, 1, Math.max(1, largo - 2));
      continue;
    }
    // A splat: a blob, specks thrown round it and drips running down.
    g.fillStyle = seco ? ROJO[2] : ROJO[1];
    g.fillRect(X - (t >> 1), Y - (t >> 1), t, t);
    g.fillRect(X - (t >> 1) - 1, Y, t + 2, 1);
    if (!seco) {
      g.fillStyle = ROJO[0];
      g.fillRect(X - (t >> 1), Y - (t >> 1), 1, 1);
    }
    g.fillStyle = ROJO[1];
    g.fillRect(X - t - 1 - (h % 2), Y - 1 - (h % 3), 1, 1);
    g.fillRect(X + t + (h % 3), Y - (h % 2), 1, 1);
    g.fillRect(X + (h % 5) - 2, Y - t - 1, 1, 1);
    g.fillStyle = ROJO[2];
    const largo = Math.min(5 + t, 1 + Math.floor(ed * 1.2));
    g.fillRect(X - (t >> 1) + (h % Math.max(1, t)), Y + (t >> 1), 1, largo);
  }
  if (a !== 1) g.globalAlpha = 1;
}

/** One piece, at (X, Y) on screen, turned q quarter turns. */
function pintaTrozo(g: Ctx, X: number, Y: number, q: number, forma: number, c: string, casco: string) {
  switch (forma) {
    case CABEZA: {
      // A 3×3 head with an ear, an eye, a helmet strip and a bloody neck.
      g.fillStyle = c;
      g.fillRect(X - 1, Y - 1, 3, 3);
      const ox = q === 0 || q === 3 ? -1 : 1, oy = q < 2 ? -1 : 1;
      g.fillStyle = OREJA;
      g.fillRect(X + ox * 2, Y + oy * 2, 1, 1);
      g.fillStyle = casco;
      if (q % 2 === 0) g.fillRect(X - 1, Y + oy, 3, 1);
      else g.fillRect(X + ox, Y - 1, 1, 3);
      g.fillStyle = OJO;
      g.fillRect(X - ox, Y, 1, 1);
      g.fillStyle = ROJO[1];
      g.fillRect(X - ox, Y - oy * 2, 1, 1);
      break;
    }
    case TORSO: {
      const w = q % 2 ? 4 : 3, h = q % 2 ? 3 : 4;
      g.fillStyle = c;
      g.fillRect(X - 1, Y - 1, w, h);
      g.fillStyle = ROJO[1];
      if (q % 2) g.fillRect(q === 1 ? X - 1 : X + w - 2, Y - 1, 1, h);
      else g.fillRect(X - 1, q === 0 ? Y - 1 : Y + h - 2, w, 1);
      break;
    }
    case MIEMBRO: {
      g.fillStyle = c;
      if (q % 2) g.fillRect(X - 1, Y, 3, 1);
      else g.fillRect(X, Y - 1, 1, 3);
      g.fillStyle = ROJO[0];
      if (q % 2) g.fillRect(q === 1 ? X - 1 : X + 1, Y, 1, 1);
      else g.fillRect(X, q === 0 ? Y - 1 : Y + 1, 1, 1);
      break;
    }
    case OREJA_G: {
      // A round ear: lilac with its pink inside and a torn red edge.
      g.fillStyle = c;
      rr(g, X, Y, q, -1, -1, 3, 2);
      g.fillStyle = OREJA_IN;
      rr(g, X, Y, q, 0, -1, 1, 1);
      g.fillStyle = ROJO[1];
      rr(g, X, Y, q, -1, 1, 3, 1);
      break;
    }
    case OJO_G: {
      // An eyeball trailing its red stalk.
      g.fillStyle = c;
      rr(g, X, Y, q, 0, -1, 2, 2);
      g.fillStyle = OJO;
      rr(g, X, Y, q, 1, -1, 1, 1);
      g.fillStyle = ROJO[1];
      rr(g, X, Y, q, -1, 0, 1, 1);
      g.fillStyle = ROJO[2];
      rr(g, X, Y, q, -2, 1, 1, 1);
      break;
    }
    case DIENTE: {
      // A buck tooth with a red root.
      g.fillStyle = c;
      rr(g, X, Y, q, 0, -1, 1, 2);
      g.fillStyle = ROJO[1];
      rr(g, X, Y, q, 0, 1, 1, 1);
      break;
    }
    case BIGOTE: {
      g.fillStyle = c;
      rr(g, X, Y, q, -1, 0, 3, 1);
      rr(g, X, Y, q, 2, -1, 1, 1);
      break;
    }
    case COSTILLAS: {
      // A ribcage: bone bars over red, a dark spine down the middle.
      g.fillStyle = ROJO[1];
      rr(g, X, Y, q, -2, -1, 4, 3);
      g.fillStyle = c;
      rr(g, X, Y, q, -2, -1, 4, 1);
      rr(g, X, Y, q, -2, 1, 4, 1);
      g.fillStyle = ROJO[2];
      rr(g, X, Y, q, 0, -1, 1, 3);
      break;
    }
    case TRIPA: {
      // A loop of gut.
      g.fillStyle = c;
      rr(g, X, Y, q, -2, 0, 2, 1);
      rr(g, X, Y, q, 0, -1, 2, 1);
      rr(g, X, Y, q, 2, 0, 1, 1);
      g.fillStyle = casco;
      rr(g, X, Y, q, -1, 1, 2, 1);
      break;
    }
    case CRANEO: {
      // A tiny mouse skull: round cranium, dark eye socket, long snout with buck teeth.
      g.fillStyle = c;
      rr(g, X, Y, q, -1, -1, 3, 2);
      rr(g, X, Y, q, 2, 0, 1, 1);
      g.fillStyle = c === HUESO ? HUESO_SOMBRA : CARBON[0];
      rr(g, X, Y, q, -1, 1, 3, 1);
      g.fillStyle = CARBON[0];
      rr(g, X, Y, q, 0, 0, 1, 1);
      g.fillStyle = DIENTE_C;
      rr(g, X, Y, q, 2, 1, 1, 1);
      break;
    }
    case FEMUR: {
      // A long bone with a knob at each end.
      g.fillStyle = c;
      rr(g, X, Y, q, -2, 0, 5, 1);
      rr(g, X, Y, q, -2, -1, 1, 1);
      rr(g, X, Y, q, 2, 1, 1, 1);
      break;
    }
    case VERTEBRA: {
      g.fillStyle = c;
      rr(g, X, Y, q, -1, 0, 3, 1);
      rr(g, X, Y, q, 0, -1, 1, 1);
      g.fillStyle = c === HUESO ? HUESO_SOMBRA : CARBON[0];
      rr(g, X, Y, q, 0, 0, 1, 1);
      break;
    }
    case MANDIBULA: {
      // A jaw: a bone L with the buck teeth still in it.
      g.fillStyle = c;
      rr(g, X, Y, q, -1, 0, 3, 1);
      rr(g, X, Y, q, -1, -1, 1, 1);
      g.fillStyle = DIENTE_C;
      rr(g, X, Y, q, 2, -1, 1, 1);
      break;
    }
    case ASTILLA: {
      g.fillStyle = c;
      rr(g, X, Y, q, 0, 0, 1, 2);
      break;
    }
    case MEDIO: {
      // A limb torn to the bone: fur/cloth, a red end and the bone sticking out.
      g.fillStyle = c;
      rr(g, X, Y, q, -2, 0, 3, 1);
      g.fillStyle = ROJO[1];
      rr(g, X, Y, q, 1, 0, 1, 1);
      g.fillStyle = HUESO;
      rr(g, X, Y, q, 2, 0, 2, 1);
      rr(g, X, Y, q, 3, -1, 1, 1);
      break;
    }
    case SESO: {
      // A blob of brain: pink with darker folds.
      g.fillStyle = c;
      rr(g, X, Y, q, -1, -1, 3, 2);
      g.fillStyle = casco;
      rr(g, X, Y, q, 0, -1, 1, 1);
      rr(g, X, Y, q, -1, 0, 1, 1);
      g.fillStyle = ROJO[1];
      rr(g, X, Y, q, 1, 1, 1, 1);
      break;
    }
    case SOGA: {
      // A long rope of gut, looping.
      g.fillStyle = c;
      rr(g, X, Y, q, -4, 0, 2, 1);
      rr(g, X, Y, q, -2, -1, 2, 1);
      rr(g, X, Y, q, 0, 0, 2, 1);
      rr(g, X, Y, q, 2, 1, 2, 1);
      g.fillStyle = casco;
      rr(g, X, Y, q, -3, 1, 1, 1);
      rr(g, X, Y, q, 1, -1, 1, 1);
      g.fillStyle = ROJO[1];
      rr(g, X, Y, q, 4, 1, 1, 1);
      break;
    }
    default: {
      // The tail: a thin pink squiggle.
      g.fillStyle = c;
      if (q % 2) {
        g.fillRect(X - 1, Y, 2, 1);
        g.fillRect(X + 1, Y - 1, 1, 1);
      } else {
        g.fillRect(X, Y - 1, 1, 2);
        g.fillRect(X + 1, Y + 1, 1, 1);
      }
    }
  }
}

/** A rect at (dx, dy) from (X, Y), mirrored left–right when m < 0. */
function rm(g: Ctx, X: number, Y: number, m: number, dx: number, dy: number, w: number, h: number) {
  g.fillRect(m > 0 ? X + dx : X - dx - w, Y + dy, w, h);
}

/** A whole mouse skeleton lying on its side (head at +x, or −x when `m` = −1), its feet on Y. */
function pintaEsqueleto(g: Ctx, X: number, Y: number, m: number, carbon: boolean) {
  const hueso = carbon ? CARBON[1] : HUESO;
  const sombra = carbon ? CARBON[0] : HUESO_SOMBRA;
  // Skull with its socket, snout and teeth; the jaw dropped open.
  g.fillStyle = hueso;
  rm(g, X, Y, m, 4, -4, 3, 2);
  rm(g, X, Y, m, 7, -3, 1, 1);
  rm(g, X, Y, m, 5, -1, 3, 1);
  g.fillStyle = sombra;
  rm(g, X, Y, m, 4, -2, 3, 1);
  g.fillStyle = CARBON[0];
  rm(g, X, Y, m, 5, -3, 1, 1);
  g.fillStyle = DIENTE_C;
  rm(g, X, Y, m, 7, -2, 1, 1);
  // Spine, ribs, pelvis.
  g.fillStyle = hueso;
  rm(g, X, Y, m, -4, -2, 8, 1);
  rm(g, X, Y, m, -2, -4, 1, 2);
  rm(g, X, Y, m, 0, -4, 1, 2);
  rm(g, X, Y, m, 2, -4, 1, 2);
  rm(g, X, Y, m, -6, -3, 2, 2);
  // Legs and an arm along the ground.
  rm(g, X, Y, m, -10, -1, 4, 1);
  rm(g, X, Y, m, -9, -2, 1, 1);
  rm(g, X, Y, m, 1, -1, 3, 1);
  // The tail: a row of tiny vertebrae.
  rm(g, X, Y, m, -8, -3, 1, 1);
  rm(g, X, Y, m, -10, -4, 1, 1);
  rm(g, X, Y, m, -12, -4, 1, 1);
  if (carbon) {
    // A pale glint on the charred skull and ribs.
    g.fillStyle = CARBON[2];
    rm(g, X, Y, m, 5, -4, 1, 1);
    rm(g, X, Y, m, 0, -4, 1, 1);
  }
}

/** Bones on the ground (and skeletons): they stay well after the blood is gone. */
function dibujarHuesos(g: Ctx, e: Gore, sx: (x: number) => number, sy: (y: number) => number, vw: number) {
  let a = 1;
  for (let i = 0; i < e.hn; i++) {
    const ed = e.hedad[i];
    if (ed >= VIDA_HUESO) continue;
    const wx = e.hx[i];
    const X = sx(wx);
    if (X < -16 || X > vw + 16 || e.esMar(wx)) continue;
    const k = alfa(Math.min(1, (VIDA_HUESO - ed) / 6));
    if (k <= 0) continue;
    if (k !== a) g.globalAlpha = a = k;
    // Follow the ground if a blast has dug a crater under it since.
    const Y = sy(Math.min(e.hy[i], Math.round(e.suelo(wx))));
    const f = e.hforma[i];
    if (f === ESQUELETO) pintaEsqueleto(g, X, Y, e.hq[i] === 2 ? -1 : 1, e.hcarbon[i] === 1);
    else pintaTrozo(g, X, Y - 1, e.hq[i], f, e.hcarbon[i] ? CARBON[1] : HUESO, '');
  }
  g.globalAlpha = 1;
}

/** The crawling wounded: half a mouse dragging itself on its arms, stumps bleeding. */
function dibujarArrastrados(g: Ctx, e: Gore, sx: (x: number) => number, sy: (y: number) => number, vw: number) {
  for (let i = 0; i < e.an; i++) {
    const wx = e.ax[i];
    const X = sx(wx);
    if (X < -10 || X > vw + 10) continue;
    const Y = sy(e.suelo(wx));
    const d = e.adir[i];
    const pelo = PELAJES[e.apelo[i]] ?? SOLDADO;
    const tira = Math.sin(e.aedad[i] * 5) > 0;
    // Torso flat on the ground, head raised a little, helmet askew.
    g.fillStyle = pelo.ropa;
    rm(g, X, Y, d, -2, -2, 4, 2);
    g.fillStyle = pelo.piel;
    rm(g, X, Y, d, 2, -4, 3, 3);
    g.fillStyle = OREJA;
    rm(g, X, Y, d, 2, -5, 1, 1);
    g.fillStyle = pelo.casco;
    rm(g, X, Y, d, 2, -4, 2, 1);
    g.fillStyle = OJO;
    rm(g, X, Y, d, 4, -3, 1, 1);
    // The reaching arm: out in front, then pulling.
    g.fillStyle = pelo.piel;
    if (tira) rm(g, X, Y, d, 4, -1, 3, 1);
    else rm(g, X, Y, d, 5, -2, 2, 1);
    // Stumps and a dangling gut at the back.
    g.fillStyle = ROJO[1];
    rm(g, X, Y, d, -3, -2, 1, 2);
    g.fillStyle = ROJO[0];
    rm(g, X, Y, d, -3, -2, 1, 1);
    g.fillStyle = TRIPA_C[0];
    rm(g, X, Y, d, -5, -1, 2, 1);
  }
}

/**
 * Red specks on the player's plane, drawn over its sprite at (X, Y) on
 * screen; `rumbo` is the plane's heading (rad, y up). They darken and wash off.
 */
export function dibujarAvion(g: Ctx, e: Gore, X: number, Y: number, rumbo: number): void {
  if (e.vn === 0) return;
  const c = Math.cos(rumbo), s = Math.sin(rumbo);
  let a = 1;
  for (let i = 0; i < e.vn; i++) {
    const ed = e.vedad[i];
    if (ed >= VIDA_AV) continue;
    const k = alfa(Math.min(1, (VIDA_AV - ed) / 8));
    if (k <= 0) continue;
    if (k !== a) g.globalAlpha = a = k;
    const u = e.vu[i], v = e.vv[i];
    // Along the nose (c, −s) on screen, across it (s, c).
    const px = Math.round(X + c * u + s * v), py = Math.round(Y - s * u + c * v);
    const t = e.vtam[i];
    g.fillStyle = ed < 6 ? ROJO[0] : ed < 15 ? ROJO[1] : ROJO[2];
    g.fillRect(px, py, t, t);
    // Fresh blood streaks back along the body in the wind.
    if (ed < 4) {
      g.fillStyle = ROJO[1];
      g.fillRect(Math.round(px - c * 2), Math.round(py + s * 2), 1, 1);
    }
  }
  g.globalAlpha = 1;
}

/** Droplets, mist, gibs, bodies and decals: draw them with the other effects. */
export function dibujar(g: Ctx, e: Gore, sx: (x: number) => number, sy: (y: number) => number, vw = 1e5, vh = 1e5): void {
  if (e.sn > 0) dibujarSalpicones(g, e, sx, sy, vw, vh);
  if (e.an > 0) dibujarArrastrados(g, e, sx, sy, vw);
  if (e.n === 0) return;
  let a = 1;
  for (let i = 0; i < e.n; i++) {
    const t = e.tipo[i];
    const X = sx(e.x[i]), Y = sy(e.y[i]);
    if (X < -8 || X > vw + 8 || Y < -8 || Y > vh + 8) continue;
    if (t === T_GOTA || t === T_AGUA) {
      const s = e.forma[i];
      if (a !== 1) g.globalAlpha = a = 1;
      g.fillStyle = t === T_AGUA ? ROSA_AGUA[e.color[i]] : ROJO[e.color[i]];
      // Fast-falling rain draws as a short streak.
      g.fillRect(X, Y - s + 1, s, e.vy[i] < -120 ? s + 1 : s);
      continue;
    }
    if (t === T_NIEBLA) {
      const k = alfa((1 - e.edad[i] / e.vida[i]) * 0.6);
      if (k <= 0) continue;
      if (k !== a) g.globalAlpha = a = k;
      const s = e.forma[i];
      g.fillStyle = ROJO[e.color[i]];
      g.fillRect(X - (s >> 1), Y - (s >> 1), s, s);
      continue;
    }
    const rest = e.vida[i] - e.edad[i];
    const k = rest < 1.5 ? alfa(rest / 1.5) : 1;
    if (k !== a) g.globalAlpha = a = k;
    // Four orientations only: pixel art doesn't rotate smoothly.
    const q = ((Math.round(e.ang[i] / (Math.PI / 2)) % 4) + 4) % 4;
    const c = e.tinta[i];
    if (t === T_CUERPO) {
      // A limp mouse: torso, head with helmet and eye, an arm, the tail, a red wound.
      const pelo = PELAJES[e.color[i]] ?? PILOTO;
      g.fillStyle = c;
      rr(g, X, Y, q, -1, -1, 3, 4);
      g.fillStyle = pelo.piel;
      rr(g, X, Y, q, -1, -4, 3, 3);
      rr(g, X, Y, q, 2, 0, 2, 1);
      g.fillStyle = OREJA;
      rr(g, X, Y, q, -2, -5, 1, 1);
      g.fillStyle = e.casco[i];
      rr(g, X, Y, q, -1, -4, 3, 1);
      g.fillStyle = OJO;
      rr(g, X, Y, q, 1, -3, 1, 1);
      g.fillStyle = COLA_C;
      rr(g, X, Y, q, 0, 3, 1, 2);
      rr(g, X, Y, q, 1, 5, 1, 1);
      g.fillStyle = ROJO[1];
      rr(g, X, Y, q, -1, 0, 2, 2);
      g.fillStyle = ROJO[0];
      rr(g, X, Y, q, -1, 0, 1, 1);
      continue;
    }
    pintaTrozo(g, X, Y, q, e.forma[i], c, e.casco[i]);
  }
  g.globalAlpha = 1;
}

/**
 * Blood on the «camera»: screen-space drops that run down and fade quickly.
 * Draw over the world, under the HUD.
 */
export function dibujarPantalla(g: Ctx, e: Gore, vw: number, vh: number): void {
  if (e.pn === 0) return;
  let a = 1;
  // The lens is the same size whatever the resolution: scale the drops with the screen.
  const u = Math.max(1, Math.round(Math.min(vw, vh) / 180));
  for (let i = 0; i < e.pn; i++) {
    const ed = e.pedad[i], vida = e.pvida[i];
    if (ed >= vida) continue;
    const k = alfa(Math.min(0.85, ((vida - ed) / vida) * 1.6));
    if (k <= 0) continue;
    if (k !== a) g.globalAlpha = a = k;
    const r = e.ptam[i] * u;
    const X = Math.round(e.px[i] * vw), Y = Math.round(e.py[i] * vh + Math.min(10, ed * 7) * u);
    const h = (i * 7919 + 31) % 89;
    // A round blob (rows of u px, a little lumpy) with a dark rim, a wet
    // shine, specks, and a drip running down.
    for (let dy = -r; dy < r; dy += u) {
      const yy = dy + u / 2;
      const hw = Math.round(Math.sqrt(Math.max(0, r * r - yy * yy)) / u) * u + (((h + dy) & 3) === 0 ? u : 0);
      if (hw <= 0) continue;
      g.fillStyle = ROJO[2];
      g.fillRect(X - hw, Y + dy, hw * 2, u);
      if (hw > u) {
        g.fillStyle = ROJO[1];
        g.fillRect(X - hw + u, Y + dy, hw * 2 - 2 * u, u);
      }
    }
    g.fillStyle = ROJO[0];
    g.fillRect(X - r + u, Y - r + u, Math.max(u, r >> 1), u);
    g.fillStyle = ROJO[1];
    g.fillRect(X - r - (2 + (h % 3)) * u, Y - (h % 4) * u, u, u);
    g.fillRect(X + r + (1 + (h % 2)) * u, Y + (1 - (h % 3)) * u, u, u);
    g.fillRect(X + ((h % 5) - 2) * u, Y - r - 2 * u, u, u);
    g.fillStyle = ROJO[2];
    const largo = Math.min(14, Math.floor(ed * 10) + 1) * u;
    g.fillRect(X - u + (h % 2) * u, Y + r - u, Math.max(u, r >> 1), largo);
  }
  g.globalAlpha = 1;
}
