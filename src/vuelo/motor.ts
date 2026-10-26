import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { sfx } from '../game/audio';
import * as S from './sonido';
import * as AB from './audio-batalla';
import * as IA from './ia';
import * as AE from './aereos';
import * as VFX from './efectos';
import * as G from './gigantes';
import * as JF from './jefes';
import * as CZ from './cazas';
import * as A from './dibujo';
import type { Parte, Premio, VehiculoTipo } from './dibujo';
import * as FV from './fisica-vuelo';
import * as FA from './fisica-armas';
import * as MS from './misiles';
import * as E from './estelas';
import { dibujarFondo, nombreZona, precalentarFondo, zonaAltitud } from './fondo';
import type { Avion, Cuerpo, Mando, Misil, ModeloAvion, Movil, Vehiculo, Bomba } from './fisica-tipos';

/*
 * The plane game: Dui, Lulu or Almendrita fly over a strip of hills while
 * mice drive towards the fish pantry at the left end, shooting at the plane. Stop them before
 * they get there.
 *
 * The physics lives in fisica-vuelo.ts (aerodynamics) and fisica-armas.ts
 * (missiles, bombs, blasts, vehicles); this file runs the rules, the waves
 * and the drawing. World units: x to the right, y is altitude (up), 1 unit =
 * 1 virtual pixel. The canvas is drawn at that resolution and upscaled by a
 * whole number so every pixel stays crisp.
 */

type Ctx = CanvasRenderingContext2D;

export type PlaneSpec = {
  id: ModeloAvion;
  pilot: string;
  name: string;
  blurb: string;
  /** Parts a hit can tear off, in no particular order; one more hit after the last one destroys the plane. */
  parts: Parte[];
  hp: number;
  rack: number;
  /** Starting slots for bombs and flares (missile slots are `rack`). */
  bombRack: number;
  flareRack: number;
  reload: number;
  bombCd: number;
  bombs: number;
  /** Hit radius, px. */
  hit: number;
  stats: { velocidad: number; blindaje: number; misiles: number; bombas: number };
};

export const PLANES: PlaneSpec[] = [
  {
    id: 'avioneta',
    pilot: 'Lulu',
    name: 'Avioneta Mostaza',
    blurb: 'Lulu, la gatita negra de ojos amarillos. Ágil: gira cerrado y suelta bombas seguido.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 2, bombRack: 2, flareRack: 1, reload: 1.2, bombCd: 0.5, bombs: 1, hit: 7,
    stats: { velocidad: 3, blindaje: 3, misiles: 3, bombas: 4 },
  },
  {
    id: 'caza',
    pilot: 'Dui',
    name: 'Caza Mandarina',
    blurb: 'Dui, el gato naranja. El más veloz: deja atrás a los misiles y dispara más.',
    parts: ['cola', 'ala', 'motor'], hp: 4, rack: 3, bombRack: 1, flareRack: 1, reload: 0.85, bombCd: 0.9, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 2, misiles: 5, bombas: 2 },
  },
  {
    id: 'bombardero',
    pilot: 'Almendrita',
    name: 'Bombardero Nube',
    blurb: 'Almendrita, la yorkshire. Lento pero blindado: suelta tres bombas de una vez.',
    parts: ['cola', 'ala', 'motor', 'cabina', 'bodega'], hp: 6, rack: 2, bombRack: 3, flareRack: 1, reload: 1.3, bombCd: 0.9, bombs: 3, hit: 9,
    stats: { velocidad: 2, blindaje: 5, misiles: 2, bombas: 5 },
  },
];

export type Hud = {
  /** Fish was just stolen: the pantry chip flashes. */
  stolen: boolean;
  score: number;
  best: number;
  wave: number;
  hp: number;
  hpMax: number;
  /** Planes left, counting the one flying. */
  lives: number;
  /** Parts already shot off. */
  lost: string[];
  meta: number;
  metaMax: number;
  ammo: number;
  /** Machine-gun heat 0…1, and whether it overheated (cools down before firing again). */
  heat: number;
  hot: boolean;
  /** Super nitro: 'listo' (double-tap accelerate), 'activo', or recharging with `nitroK` 0…1. */
  nitro: 'listo' | 'activo' | 'carga';
  nitroK: number;
  rack: number;
  flares: number;
  flareMax: number;
  bombs: number;
  bombMax: number;
  left: number;
  /** Wind at the plane, px/s (positive blows to the right). */
  wind: number;
  /** Plane altitude in metres (1 px = 3.5 m) and the sky picked. */
  altitude: number;
  sky: string;
  /** Name of the layer of sky the plane is in («Mar de nubes», «Espacio exterior»…). */
  zone: string;
  warn: boolean;
  /** The wing is stalled. */
  stall: boolean;
  /** Zoom: how many levels there are and which one is on. */
  zoom: [number, number];
  /** Throttle input: -1 brake, 0 cruise, 1 full power. */
  throttle: number;
  boss: { name: string; hp: number } | null;
  banner: string;
};

export type Result = { pilot: string; score: number; best: number; wave: number; kills: number; reason: 'avion' | 'despensa'; record: boolean };

export type Controls = { x: number; y: number; gas: number; fire: boolean; bomb: boolean; flare: boolean; gun: boolean };

/* ── Battle damage ─────────────────────────────────────────────────────── */

// What losing each part does to the airframe (multiplied together).
const PART_EFFECT: Record<Parte, Partial<FV.Dano>> = {
  cola: { mando: 0.8, temblor: 0.25 },
  ala: { sustentacion: 0.8, arrastre: 1.15, temblor: 0.1 },
  motor: { empuje: 0.55, temblor: 0.05 },
  cabina: { arrastre: 1.05, temblor: 0.05 },
  bodega: { arrastre: 1.2 },
};
const PART_NAME: Record<Parte, string> = { cola: 'la cola', ala: 'un ala', motor: 'el motor', cabina: 'la cabina', bodega: 'la bodega' };
const LIVES = 3;

function danoDe(lost: readonly Parte[]): FV.Dano {
  const d = { ...FV.SANO };
  for (const p of lost) {
    const e = PART_EFFECT[p];
    d.empuje *= e.empuje ?? 1;
    d.sustentacion *= e.sustentacion ?? 1;
    d.mando *= e.mando ?? 1;
    d.arrastre *= e.arrastre ?? 1;
    d.temblor += e.temblor ?? 0;
  }
  return d;
}

/* ── The level ───────────────────────────────────────────────────────────── */

const LEVEL = 3600;
const PANTRY = { x0: 22, x1: 86 };
/** A vehicle that reaches this x gets into the pantry. */
const META_X = 98;
const META_MAX = 5;
/** Most slots a reward balloon can raise each weapon to. */
type Arma = Exclude<Premio, 'reparar'>;
const CAP_MAX: Record<Arma, number> = { misil: 8, bomba: 6, bengala: 4 };
const PRIZE_NAME: Record<Arma, string> = { misil: 'misil', bomba: 'bomba', bengala: 'bengala' };
const BOMB_RELOAD = 2.2;
/** Super nitro: how long it burns, its push, and the recharge time. */
const NITRO_T = 2.5;
const NITRO_ACC = 2.6 * FA.GRAVEDAD;
const NITRO_CD = 9;
/** Seconds holding the nose on an enemy before the missiles lock on. */
const LOCK_TIME = 1;
const FLARE_RELOAD = 4;
/** Highest altitude the plane can fly: a tall sky, taller than the screen. */
const CEIL = 3000;

const hillsAt = (x: number) => {
  const hills = 28 + 8 * Math.sin(x / 170) + 4 * Math.sin(x / 53 + 2) + 1.5 * Math.sin(x / 23);
  // Flat around the pantry.
  const k = Math.min(1, Math.max(0, (x - 150) / 140));
  return 28 + (hills - 28) * k;
};
// The terrain as a height per column, so explosions can dig craters in it
// (like in Worms). Reset at the start of every game.
const HEIGHTS = new Float32Array(LEVEL + 2);
const resetHeights = () => {
  for (let x = 0; x < HEIGHTS.length; x++) HEIGHTS[x] = hillsAt(x);
};
resetHeights();
const ground = (x: number) => {
  const xc = Math.min(LEVEL, Math.max(0, x));
  const i = Math.floor(xc);
  return HEIGHTS[i] + (HEIGHTS[i + 1] - HEIGHTS[i]) * (xc - i);
};

type VSpec = { speed: number; hp: number; masa: number; score: number; cd: number; color: string };
const VEH: Record<VehiculoTipo, VSpec> = {
  jeep: { speed: 30, hp: 1, masa: 1, score: 100, cd: 3.4, color: '#b49af4' },
  camion: { speed: 19, hp: 1, masa: 2, score: 150, cd: 4.6, color: '#b49af4' },
  tanque: { speed: 13, hp: 1.8, masa: 4, score: 250, cd: 2.8, color: '#b49af4' },
  sam: { speed: 11, hp: 1.3, masa: 2.5, score: 300, cd: 5.2, color: '#b49af4' },
  margarita: { speed: 14, hp: 12, masa: 8, score: 2000, cd: 1.4, color: '#f08a94' },
};

/* The sky theme changes every wave. */
type Theme = 'dia' | 'tarde' | 'noche';
const THEMES: Theme[] = ['dia', 'tarde', 'noche'];

/* ── The boss: neighbour Margarita ──────────────────────────────────────── */

// She shows up when waves 2, 5, 8… are cleared, and comes back tougher.
const BOSS_EVERY = 3;
const SAY = {
  intro: '¡¿Qué es tanto ruido?! ¡Ricachones $&#%"/&!',
  back: '¡Volví, ricachones! ¡Y traje más chanclas! &%#',
  taunts: [
    '¡Ricachones $&#%"/&!',
    '¡Hagan asados con parrilla eléctrica!! ""/&"3',
    '¡Bajen esa música! ¡Son las tres de la tarde! #%&',
    '¡Ese gato naranjo se hace pipí en mis cardenales!',
    '¡Esa perrita chica ladra todo el día! @#$%',
    '¡La gata negra me mira feo! ¡Mala suerte! %&#',
    '¡Voy a llamar a la junta de vecinos! &%$#',
    '¡Estacionaron en MI vereda! ¡Siempre lo mismo!',
    '¡En mis tiempos los aviones no hacían ruido! #&%',
    '¡Les voy a cortar el cable del internet!',
    '¡Con mi escoba los bajo a todos! $#@!',
    '¡Paguen los gastos comunes, ricachones! &#$',
  ],
  hurt: ['¡Ay, mi cadera! $%&', '¡Mis tomates! #&%$', '¡Esto se lo cuento a todo el pasaje!', '¡Mis lentes! ¡No veo nada! &%#'],
  defeat: '¡Esto no se queda así! ¡Voy a llamar a los carabineros! #$%&',
  win: '¡Me llevo todo el pescado! ¡Ja! #$%&',
};

/* ── Things in the world ─────────────────────────────────────────────────── */

type Car = Vehiculo & {
  kind: VehiculoTipo;
  hp: number;
  fireT: number;
  flash: number;
  wheel: number;
  aim: number;
  /** Centre of the hull, the point missiles steer to. */
  mid: Movil;
  /** Identity and private memory for its brain (ia.ts). */
  id: number;
  mem: Record<string, number>;
};
let carIds = 0;
// Points for shooting down each kind of flying mouse.
const AIR_SCORE: Record<AE.TipoAereo, number> = { helicoptero: 300, dron: 80, globo: 150, ovni: 150 };
// How hard each plane's missiles hit a flying boss: the bomber has few, so they count more.
const BOSS_MUL: Record<ModeloAvion, number> = { avioneta: 1.2, caza: 1, bombardero: 1.6 };
// Enemy missiles carry their type (misiles.ts); the player's are plain rockets.
type Shot = ({ m: Misil; enemy: false; tgt: null; trail: number } | { m: MS.MisilEnemigo; enemy: true; tgt: Movil | null; trail: number }) & {
  estela?: E.Estela;
  /** Stable id for its chase sound, and whether its near-miss whoosh already played. */
  id?: number;
  pasada?: boolean;
  /** Seconds the plane has been outrunning it, and whether it gave up. */
  cola?: number;
  gap?: number;
  /** The player's missile homes on this target when it was fired with a lock. */
  lock?: Fijable;
  gap2?: number;
  perdido?: boolean;
};
let shotIds = 0;

// Trail style per missile type, shortened a little so phones keep 60 fps.
const trailStyles = new Map<string, E.EstiloEstela>();
const trailStyle = (sh: Shot) => {
  const key = sh.enemy ? sh.m.tipo : 'jugador';
  let st = trailStyles.get(key);
  if (!st) {
    const base = sh.enemy ? MS.MISILES[sh.m.tipo].estela : E.ESTELA_JUGADOR;
    st = { ...base, largo: Math.min(base.largo + 8, sh.enemy ? 32 : 38) };
    trailStyles.set(key, st);
  }
  return st;
};
type Shell = Cuerpo & { fuse: number };
type Puff = Cuerpo & { r: number; life: number; dark: boolean };
type Shard = Cuerpo & { c: string };
/** Something the player's missiles can lock on to: where it is and whether it's still alive. */
type Fijable = { pos: () => Movil; vivo: () => boolean; r: number };
type Crate = Cuerpo & { landed: number };
type Pop = { x: number; y: number; t: number; text: string; c: string };
type Junk = Cuerpo & { kind: 'chancla' | 'tomate' | 'macetero'; spin: number; fuse: number };
type Say = { text: string; t: number; x: number; y: number };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ── Saved game ──────────────────────────────────────────────────────────── */

// The game in progress is kept in localStorage so a visit later picks it up
// where it was: pilot, wave, score, planes, damage, pantry, the boss's visits
// and the craters dug in the ground. A wave in progress restarts from its start.
const SAVE_KEY = 'vuelo-partida';
export type SavedGame = {
  v: 1;
  pilot: ModeloAvion;
  wave: number;
  score: number;
  kills: number;
  lives: number;
  lost: Parte[];
  meta: number;
  bossFor: number;
  bossCount: number;
  jefeFor?: number;
  craters: [number, number, number][];
  cap?: Record<Arma, number>;
  bridges?: [number, number][];
  at: number;
};

export function readSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as SavedGame;
    if (g?.v !== 1 || !PLANES.some((p) => p.id === g.pilot) || !(g.wave >= 1) || !(g.lives >= 1) || !(g.meta >= 1)) return null;
    return g;
  } catch {
    return null;
  }
}
function writeSave(g: SavedGame | null) {
  try {
    if (g) localStorage.setItem(SAVE_KEY, JSON.stringify(g));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* private mode: nothing to keep */
  }
}

function readBest() {
  try {
    return Number(localStorage.getItem('vuelo-record')) || 0;
  } catch {
    return 0;
  }
}
function writeBest(v: number) {
  try {
    localStorage.setItem('vuelo-record', String(v));
  } catch {
    /* private mode */
  }
}

/* ── The game ────────────────────────────────────────────────────────────── */

export type Vuelo = ReturnType<typeof createVuelo>;

export function createVuelo(canvas: HTMLCanvasElement, box: HTMLElement, hooks: { onHud: (h: Hud) => void; onOver: (r: Result) => void }) {
  const g = canvas.getContext('2d')!;
  // `levels` are the zoom steps (whole-number pixel scales), `zi` the current one.
  const view = { vw: 400, vh: 240, s: 2, levels: [2], zi: 0, touch: false };
  const strip = A.groundStrip(LEVEL, ground, PANTRY);
  // An untouched copy, to repaint the ground when a new game starts.
  const pristine = document.createElement('canvas');
  pristine.width = strip.canvas.width;
  pristine.height = strip.canvas.height;
  pristine.getContext('2d')!.drawImage(strip.canvas, 0, 0);
  const sg = strip.canvas.getContext('2d')!;

  /** Digs a round crater into the terrain and the painted ground strip. */
  function crater(x: number, y: number, r: number, log = true) {
    r = Math.round(r);
    if (r < 3 || x < PANTRY.x1 + 20) return;
    if (log && s.craters.length < 400) s.craters.push([Math.round(x), Math.round(y), r]);
    const row = (alt: number) => strip.top - alt;
    sg.globalCompositeOperation = 'destination-out';
    D.disc(sg, x, row(y), r, '#000');
    sg.globalCompositeOperation = 'source-over';
    for (let xi = Math.max(0, Math.round(x - r)); xi <= Math.min(LEVEL, Math.round(x + r)); xi++) {
      const dx = xi - x;
      const bottom = y - Math.sqrt(Math.max(0, r * r - dx * dx));
      // Craters stay shallow enough for the mice to drive out of.
      if (HEIGHTS[xi] > bottom) HEIGHTS[xi] = Math.max(4, bottom, hillsAt(xi) - 18);
      // A scorched rim of deep dirt along the new surface.
      const h = Math.round(HEIGHTS[xi]);
      A.R(sg, xi, row(h), 1, 1, P.d0);
      A.R(sg, xi, row(h) + 1, 1, 2, P.d1);
    }
  }
  const input: Controls = { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false, gun: false };
  const keys = new Set<string>();

  const s = {
    mode: 'demo' as 'demo' | 'play' | 'over',
    paused: false,
    t: 0,
    spec: PLANES[0],
    plane: FV.nuevoAvion('avioneta', 240, 120, true) as Avion,
    hp: 0,
    inv: 0,
    dead: false,
    deadT: 0,
    lives: LIVES,
    lost: [] as Parte[],
    smokeT: 0,
    combo: 0,
    /** Sky chosen by the player, or 'auto' (it changes with every wave). */
    themePick: 'auto' as Theme | 'auto',
    ckScore: 0,
    ckKills: 0,
    stuckT: 0,
    stallT: 0,
    hurtFlash: 0,
    stolenT: 0,
    chip: 0,
    comboT: 0,
    hitStop: 0,
    audioOn: false,
    ammo: 0,
    reloadT: 0,
    fireT: 0,
    bombT: 0,
    flares: 1,
    /** Weapon slots (grow with reward balloons) and bombs in the bay. */
    cap: { misil: 2, bomba: 2, bengala: 1 } as Record<Arma, number>,
    bombAmmo: 2,
    bombReloadT: 0,
    /** Reward balloons: tied to enemies (by id) and floating free. */
    carPrize: new Map<number, Premio>(),
    airPrize: new Map<number, Premio>(),
    prizes: [] as (Cuerpo & { kind: Premio })[],
    flareT: 0,
    flareCd: 0,
    flareWasDown: false,
    camX: 0,
    /** Altitude shown at the bottom of the play area: the camera climbs with the plane. */
    camY: 0,
    shake: 0,
    score: 0,
    best: readBest(),
    kills: 0,
    wave: 0,
    meta: META_MAX,
    queue: [] as VehiculoTipo[],
    spawnT: 0,
    phase: 'break' as 'break' | 'wave',
    breakT: 0,
    banner: '',
    warnT: 0,
    warn: false,
    overT: 0,
    reason: 'avion' as Result['reason'],
    cars: [] as Car[],
    shots: [] as Shot[],
    bombs: [] as Bomba[],
    bullets: [] as (Cuerpo & { life: number })[],
    heat: 0,
    hot: false,
    gunT: 0,
    nitroT: 0,
    nitroCd: 0,
    lockCand: null as Fijable | null,
    lockKey: null as object | null,
    lockT: 0,
    vaporT: 0,
    shells: [] as Shell[],
    flareBodies: [] as Cuerpo[],
    puffs: [] as Puff[],
    shards: [] as Shard[],
    crates: [] as Crate[],
    pops: [] as Pop[],
    junk: [] as Junk[],
    /** Explosions, fire, smoke and falling pieces (efectos.ts). */
    fx: VFX.crearEfectos(),
    craters: [] as [number, number, number][],
    /** Bridges the mice built over craters, [from x, to x]. */
    bridges: [] as [number, number][],
    saveT: 0,
    aereos: [] as AE.Aereo[],
    airQueue: [] as AE.TipoAereo[],
    airT: 0,
    airFlash: new Map<number, number>(),
    ufoMode: new Map<number, number>(),
    airMax: new Map<number, number>(),
    /** Mice of every size on the ground: bikes, foot soldiers, the armoured train, Ratonzilla. */
    gigantes: [] as G.Unidad[],
    fighters: [] as CZ.Caza[],
    fighterQueue: 0,
    fighterT: 0,
    bigQueue: [] as G.TipoGrande[],
    /** The flying boss (cheese airship or UFO mothership), if one is here. */
    jefe: null as JF.Jefe | null,
    jefeFlash: 0,
    jefeFor: 0,
    spaceT: 0,
    motherCd: 0,
    bigT: 0,
    proy: [] as AE.Proyectil[],
    salvaMem: { ultima: -99 },
    /** Trails left behind by missiles that are gone, fading out. */
    estelas: [] as E.Estela[],
    /** The wave whose boss already came (so she comes once per wave). */
    bossFor: 0,
    bossCount: 0,
    bossMax: 1,
    throws: 0,
    say: null as Say | null,
    sayT: 0,
    lastTaunt: -1,
    hudKey: '',
    hudT: 0,
  };

  /* ── Sizing ── */

  function fit() {
    const cw = Math.max(1, box.clientWidth);
    const ch = Math.max(1, box.clientHeight);
    let sc = Math.max(1, Math.round(ch / 250));
    while (sc > 1 && cw / sc < 300) sc--;
    // Zooming out drops to smaller whole-number scales, all the way to 1:1.
    view.levels = [];
    for (let e = sc; e >= 1; e--) view.levels.push(e);
    view.zi = Math.min(view.zi, view.levels.length - 1);
    sc = view.levels[view.zi];
    view.s = sc;
    view.vw = Math.ceil(cw / sc);
    view.vh = Math.ceil(ch / sc);
    canvas.width = view.vw;
    canvas.height = view.vh;
    canvas.style.width = `${view.vw * sc}px`;
    canvas.style.height = `${view.vh * sc}px`;
    g.imageSmoothingEnabled = false;
  }
  const ro = new ResizeObserver(fit);
  ro.observe(box);
  fit();

  const ceiling = () => CEIL;

  /* ── Sound: recorded samples placed in stereo, synth as a fallback ── */

  const panOf = (x: number) => clamp(((x - s.camX) / view.vw) * 2 - 1, -1, 1) * 0.9;
  const near = (x: number) => clamp(1 - Math.abs(x - (s.camX + view.vw / 2)) / (view.vw * 1.2), 0.15, 1);
  function fx(n: S.Muestra, synth: () => void, o: { vol?: number; rate?: number; dur?: number } = {}, x?: number) {
    // Thin air carries little sound: up in space the samples go quiet too.
    const vol = (o.vol ?? 1) * (x === undefined ? 1 : near(x)) * (0.25 + 0.75 * AB.aireActual());
    if (!S.suena(n, { ...o, vol, pan: x === undefined ? 0 : panOf(x) })) synth();
  }
  const MOTOR: Record<ModeloAvion, S.Motor> = { avioneta: 'motor-avioneta', caza: 'motor-jet', bombardero: 'motor-bombardero' };
  const CRUISE: Record<ModeloAvion, number> = { avioneta: 100, caza: 150, bombardero: 85 };
  function engines() {
    const p = s.plane;
    const on = s.mode === 'play' && !s.paused && !s.dead;
    const id = s.spec.id;
    for (const m of Object.values(MOTOR)) if (m !== MOTOR[id]) S.motor(m, 0, 1);
    // The engine note rises with airspeed and throttle, like a real one.
    const v = Math.hypot(p.vx, p.vy);
    S.motor(MOTOR[id], on ? (0.45 + 0.3 * p.gas) * AB.atenuacionMotor() : 0, 0.8 + (v / CRUISE[id]) * 0.25 + p.gas * 0.15, panOf(p.x));
    let d = Infinity;
    for (const c of s.cars) d = Math.min(d, Math.abs(c.x - (s.camX + view.vw / 2)));
    S.motor('motor-tanque', on ? 0.35 * clamp(1 - d / (view.vw * 0.8), 0, 1) : 0, 0.9);

    // Battle sound: missiles chasing the plane, wind, a hurt engine, fire, tension.
    if (!on) {
      if (s.audioOn) AB.detener();
      s.audioOn = false;
      return;
    }
    s.audioOn = true;
    const threats: AB.Amenaza[] = [];
    for (const sh of s.shots) {
      if (!sh.enemy || sh.tgt !== p || sh.m.t < 0) continue;
      sh.id ??= ++shotIds;
      threats.push({ id: sh.id, dx: sh.m.x - p.x, dy: sh.m.y - p.y, vx: sh.m.vx - p.vx, vy: sh.m.vy - p.vy, tipo: sh.m.tipo, guiado: sh.m.guiado });
    }
    AB.persecucion(threats, 0.08);
    // A harder alarm when several guided missiles, or a long-range one, are on the plane.
    let guided = 0;
    for (const th of threats) if (th.guiado && Math.hypot(th.dx, th.dy) < 300) guided++;
    AB.fijacionFuerte(clamp((guided - 1) / 3 + (threats.some((th) => th.tipo === 'cazador') ? 0.5 : 0), 0, 1));
    AB.viento(v, p.carga);
    AB.altitud(p.y, v);
    AB.zonaNueva(zonaAltitud(p.y));
    for (const a of s.aereos) {
      if (a.tipo !== 'ovni') continue;
      AB.ovni(a.x - p.x, a.y - p.y, a.hp > 0, a.id);
      // The beam's zap when a UFO starts firing.
      const mode = a.ov?.modo ?? 0;
      if (mode === 5 && s.ufoMode.get(a.id) !== 5) AB.rayoOvni();
      s.ufoMode.set(a.id, mode);
    }
    const hurt = s.lost.length / Math.max(1, s.spec.parts.length);
    AB.motorDanado(s.lost.includes('motor') ? Math.max(0.6, hurt) : hurt * 0.5, p.gas);
    AB.fuego(s.lost.includes('motor') ? 0.4 + hurt * 0.6 : hurt * 0.3);
    let close = 0;
    for (const th of threats) close = Math.max(close, clamp(1 - Math.hypot(th.dx, th.dy) / 250, 0, 1));
    AB.intensidad(clamp(close * 0.7 + (s.lost.length >= s.spec.parts.length - 1 ? 0.35 : 0) + (s.cars.some((c) => c.kind === 'margarita') ? 0.2 : 0), 0, 1));
  }
  const toS = (alt: number) => view.vh - A.DIRT - (alt - s.camY);

  /* ── Starting and ending ── */

  function resetWorld() {
    resetHeights();
    sg.clearRect(0, 0, strip.canvas.width, strip.canvas.height);
    sg.drawImage(pristine, 0, 0);
    s.cars = [];
    s.shots = [];
    s.bombs = [];
    s.shells = [];
    s.flareBodies = [];
    s.puffs = [];
    s.bullets = [];
    s.heat = 0;
    s.hot = false;
    s.shards = [];
    s.crates = [];
    s.pops = [];
    s.junk = [];
    s.fx = VFX.crearEfectos();
    s.craters = [];
    s.bridges = [];
    s.prizes = [];
    s.carPrize.clear();
    s.airPrize.clear();
    s.aereos = [];
    s.airQueue = [];
    s.gigantes = [];
    s.fighters = [];
    s.fighterQueue = 0;
    s.bigQueue = [];
    s.jefe = null;
    s.spaceT = 0;
    s.motherCd = 0;
    s.proy = [];
    s.airFlash.clear();
    s.estelas = [];
    s.say = null;
  }

  function start(id: ModeloAvion, from?: SavedGame | null) {
    resetWorld();
    s.spec = PLANES.find((p) => p.id === id)!;
    s.plane = FV.nuevoAvion(id, 220, Math.min(130, ceiling() - 30), true);
    s.mode = 'play';
    s.hp = s.spec.hp;
    s.lives = LIVES;
    s.lost = [];
    FV.fijarDano(s.plane, FV.SANO);
    s.inv = 1.5;
    s.dead = false;
    s.cap = { misil: s.spec.rack, bomba: s.spec.bombRack, bengala: s.spec.flareRack };
    s.ammo = s.cap.misil;
    s.bombAmmo = s.cap.bomba;
    s.reloadT = 0;
    s.fireT = 0;
    s.bombT = 0;
    s.flares = s.cap.bengala;
    s.flareT = 0;
    s.score = 0;
    s.kills = 0;
    s.wave = 0;
    s.meta = META_MAX;
    s.camX = 0;
    s.bossFor = 0;
    s.bossCount = 0;
    s.jefeFor = 0;
    if (from) {
      // Pick the saved game back up: same state, the wave starts again.
      s.score = from.score;
      s.kills = from.kills;
      s.lives = from.lives;
      s.meta = from.meta;
      s.bossFor = from.bossFor;
      s.bossCount = from.bossCount;
      s.jefeFor = from.jefeFor ?? 0;
      s.wave = from.wave - 1;
      s.lost = from.lost.filter((q) => s.spec.parts.includes(q)).slice(0, s.spec.parts.length);
      FV.fijarDano(s.plane, danoDe(s.lost));
      s.hp = s.spec.parts.length + 1 - s.lost.length;
      for (const [x, y, r] of from.craters) crater(x, y, r);
      for (const [x0, x1] of from.bridges ?? []) bridge(x0, x1);
      if (from.cap) {
        for (const k of ['misil', 'bomba', 'bengala'] as Arma[]) s.cap[k] = clamp(Math.round(from.cap[k] || 0), s.cap[k], CAP_MAX[k]);
        s.ammo = s.cap.misil;
        s.bombAmmo = s.cap.bomba;
        s.flares = s.cap.bengala;
      }
    }
    nextWave();
    save();
  }

  function save() {
    if (s.mode !== 'play' || s.dead) return;
    writeSave({
      v: 1, pilot: s.spec.id, wave: s.wave, score: s.ckScore, kills: s.ckKills, lives: s.lives, lost: [...s.lost], cap: { ...s.cap }, bridges: s.bridges,
      meta: s.meta, bossFor: s.bossFor, bossCount: s.bossCount, jefeFor: s.jefeFor, craters: s.craters, at: Date.now(),
    });
  }

  function demo() {
    resetWorld();
    s.mode = 'demo';
    s.dead = false;
    s.plane = FV.nuevoAvion('avioneta', 240, 120, true);
  }

  function nextWave() {
    s.wave++;
    s.queue = waveList(s.wave);
    // What a resumed game gets back: the score as the wave began.
    s.ckScore = s.score;
    s.ckKills = s.kills;
    s.airQueue = AE.elegirAereos(s.wave, Math.random, s.plane.y);
    s.bigQueue = G.elegirGrandes(s.wave, Math.random);
    s.fighterQueue = CZ.cuantos(s.wave);
    s.fighterT = rand(7, 12);
    s.bigT = rand(3, 6);
    s.airT = rand(4, 7);
    s.phase = 'break';
    s.breakT = 2.6;
    s.banner = `Oleada ${s.wave}`;
    s.spawnT = 0;
    save();
  }

  function waveList(n: number): VehiculoTipo[] {
    const count = n === 1 ? 6 : Math.min(34, 5 + Math.round(n * 2.2));
    const w: Record<VehiculoTipo, number> =
      n === 1 ? { jeep: 0.7, camion: 0.3, tanque: 0, sam: 0, margarita: 0 } :
      n === 2 ? { jeep: 0.45, camion: 0.35, tanque: 0.2, sam: 0, margarita: 0 } :
      n === 3 ? { jeep: 0.35, camion: 0.35, tanque: 0.3, sam: 0, margarita: 0 } :
      { jeep: 0.3, camion: 0.28, tanque: 0.24, sam: 0.18, margarita: 0 };
    const out: VehiculoTipo[] = [];
    for (let i = 0; i < count; i++) {
      let r = Math.random();
      let k: VehiculoTipo = 'jeep';
      for (const kk of Object.keys(w) as VehiculoTipo[]) {
        r -= w[kk];
        if (r <= 0) {
          k = kk;
          break;
        }
      }
      out.push(k);
    }
    return out;
  }

  /** The mice reached the pantry: say it loud, the pantry is usually off screen. */
  function stolen() {
    pop(PANTRY.x1, ground(PANTRY.x1) + 40, '¡Se llevaron pescado!', P.red);
    s.stolenT = 2.2;
    s.banner = `🐟 ¡Robaron pescado! Quedan ${Math.max(0, s.meta)}`;
    window.setTimeout(() => {
      if (s.banner.startsWith('🐟')) s.banner = '';
    }, 2200);
  }

  function gameOver(reason: Result['reason']) {
    if (s.mode !== 'play') return;
    if (reason === 'avion') s.lives = 0;
    s.mode = 'over';
    S.callar();
    // From wave 3 on, a lost game can carry on from the same wave (score back to 0).
    writeSave(
      s.wave >= 3
        ? { v: 1, pilot: s.spec.id, wave: s.wave, score: 0, kills: 0, lives: 3, lost: [], cap: { ...s.cap }, bridges: s.bridges, meta: META_MAX, bossFor: s.bossFor, bossCount: s.bossCount, craters: s.craters, at: Date.now() }
        : null,
    );
    const record = s.score > s.best;
    if (record) {
      s.best = s.score;
      writeBest(s.best);
    }
    sfx.gameOver();
    hooks.onOver({ pilot: s.spec.pilot, score: s.score, best: s.best, wave: s.wave, kills: s.kills, reason, record });
  }

  /* ── Effects ── */

  function puff(x: number, y: number, r: number, dark: boolean, life = 1.2, vx = 0, vy = 0) {
    if (s.puffs.length > 260) s.puffs.shift();
    s.puffs.push({ x, y, vx, vy, t: 0, r, life, dark });
  }

  /** Margarita says something; the bubble follows her while she's alive. */
  function talk(text: string, x = 0, y = 0) {
    s.say = { text, t: 0, x, y };
    for (let i = 0; i < 4; i++) window.setTimeout(() => sfx.talk(), i * 70);
  }

  /**
   * Points for a kill, multiplied by the combo: kills less than 2.5 s apart
   * chain up to ×5, with a shout at 2, 3, 5 and 8. Each kill also freezes the
   * action for a blink (hit-stop) so it lands with weight.
   */
  function award(points: number, x: number, y: number) {
    s.combo = s.comboT > 0 ? s.combo + 1 : 1;
    s.comboT = 2.5;
    const mult = Math.min(5, s.combo);
    s.score += points * mult;
    s.kills++;
    pop(x, y + 14, mult > 1 ? `+${points * mult} ×${mult}` : `+${points}`);
    const shout = ({ 2: '¡Doble!', 3: '¡Triple!', 5: '¡Imparable!', 8: '¡Leyenda!' } as Record<number, string>)[s.combo];
    if (shout) {
      pop(s.plane.x, s.plane.y + 26, shout, P.r2);
      sfx.select();
    }
    s.hitStop = Math.max(s.hitStop, 0.06);
  }

  function pop(x: number, y: number, text: string, c: string = P.gold) {
    s.pops.push({ x, y, t: 0, text, c });
  }

  /**
   * A blast of the given energy. Blasts from the player hurt vehicles, blasts
   * from the mice hurt the plane, and every blast pushes everything nearby.
   */
  function blast(x: number, y: number, energy: number, from: 'jugador' | 'raton' | 'nadie', damage: number) {
    const ex = FA.explosion(energy);
    // Blasts that touch the ground leave a crater.
    if (y - ground(x) < ex.radio * 0.6 && from !== 'raton') crater(x, Math.min(y, ground(x) + 2), ex.radio * (energy >= 5 ? 1.1 : 0.8));
    // Energies span 0.6 (flak) to 10 (bomb); effects scale with the cube root, like the blast.
    const size = Math.cbrt(energy);
    VFX.explosion(s.fx, x, y, energy, { suelo: y - ground(x) < ex.radio * 0.6 });
    AB.explosion(energy, Math.hypot(x - s.plane.x, y - s.plane.y), panOf(x));
    // Missiles caught in a blast go off too: chain reactions.
    for (const sh of s.shots) {
      if (!sh.enemy || sh.m.t < 0) continue;
      const m = sh.m;
      // The player's blasts always finish an enemy missile; the others may only shake a heavy one.
      if (Math.hypot(m.x - x, m.y - y) < ex.radio * 1.6 + MS.MISILES[m.tipo].radioChoque && MS.golpear(m, from === 'jugador' ? 9 : 1)) {
        m.t = -1;
        const e = MS.MISILES[m.tipo].energia * 0.6;
        window.setTimeout(() => blast(m.x, m.y, e, 'nadie', 0), 50);
        if (from !== 'raton' && s.mode === 'play') {
          s.score += 50;
          pop(m.x, m.y + 8, '+50');
        }
      }
    }
    for (const u of s.gigantes) if (u.viva) giantHit(u, G.explotar(u, x, y, energy, from === 'jugador' ? damage : 0));
    if (from === 'jugador' && s.jefe && JF.tocado(s.jefe, x, y, ex.radio)) {
      const h = JF.golpear(s.jefe, x, y, damage * BOSS_MUL[s.spec.id]);
      s.jefeFlash = 0.1;
      if (h.bloqueado) pop(x, y + 10, s.jefe.tipo === 'nodriza' ? '¡Escudo!' : '¡Blindado!', P.metal);
      else if (h.derrotado) award(h.puntos ?? 0, x, y);
      else if (h.puntos) {
        s.score += h.puntos;
        pop(x, y + 12, `+${h.puntos}`);
      }
    }
    if (from === 'jugador') {
      for (const f of s.fighters) {
        const dmg = damage * ex.dano(Math.max(0, Math.hypot(f.a.x - x, f.a.y - y) - CZ.RADIO));
        if (dmg >= 0.25) hurtFighter(f, dmg);
      }
      for (const a of s.aereos) {
        if (a.hp <= 0) continue;
        const dmg = damage * ex.dano(Math.max(0, Math.hypot(a.x - x, a.y - y) - AE.radio(a)));
        if (dmg < 0.25) continue;
        a.hp -= dmg;
        s.airFlash.set(a.id, 0.12);
        if (a.hp <= 0) {
          award(AIR_SCORE[a.tipo], a.x, a.y);
          releasePrize(s.airPrize.get(a.id), a.x, a.y + 10);
          for (let i = 0; i < 2; i++) VFX.pieza(s.fx, a.x, a.y, a.vx * 0.5 + rand(-50, 50), rand(20, 80), null, '#a88af0');
          s.airPrize.delete(a.id);
          const ax = a.x, ay = a.y;
          window.setTimeout(() => blast(ax, ay, FA.ENERGIA.vehiculo, 'jugador', 0.8), 50);
        }
      }
    }
    for (const c of s.cars) {
      const d = Math.hypot(c.mid.x - x, c.mid.y - y);
      const imp = ex.impulso(d);
      if (imp > 0.5) FA.empujeVehiculo(c, ((c.mid.x - x) / (d || 1)) * imp, ((c.mid.y - y) / (d || 1)) * imp + imp * 0.5);
      if (from === 'jugador') {
        const dmg = damage * ex.dano(d);
        if (dmg >= 0.25) hurtCar(c, dmg);
      }
    }
    if (s.mode === 'play' && !s.dead) {
      const p = s.plane;
      const d = Math.hypot(p.x - x, p.y - y);
      const imp = ex.impulso(d);
      if (imp > 0.5) FV.empujar(p, s.spec.id, ((p.x - x) / (d || 1)) * imp, ((p.y - y) / (d || 1)) * imp);
      if (from === 'raton' && ex.dano(Math.max(0, d - s.spec.hit)) * damage >= 0.3) hurtPlane(damage >= 2 ? 2 : 1, x, y);
    }
  }

  const flyingNow = () => s.mode === 'play' && !s.dead;

  /** Damages a mouse fighter; at 0 it blows apart (scored only if the player did it). */
  function hurtFighter(f: CZ.Caza, dmg: number, byPlayer = true) {
    if (f.hp <= 0) return;
    f.hp -= dmg;
    f.flash = 0.1;
    if (f.hp > 0) return;
    const { x, y, vx, vy } = f.a;
    if (byPlayer) {
      award(CZ.PUNTOS, x, y);
      const prize = maybePrize();
      if (prize) releasePrize(prize, x, y + 10);
    }
    for (let i = 0; i < 3; i++) VFX.pieza(s.fx, x, y, vx * 0.4 + rand(-60, 60), vy * 0.4 + rand(20, 90), null, '#7a5ad0');
    window.setTimeout(() => blast(x, y, FA.ENERGIA.vehiculo, 'jugador', 0.8), 30);
  }

  function hurtCar(c: Car, dmg: number) {
    if (c.hp <= 0) return;
    c.hp -= dmg;
    c.flash = 0.12;
    if (c.kind === 'margarita' && c.hp > 0 && Math.random() < 0.3 && (!s.say || s.say.t > 1.5)) talk(SAY.hurt[Math.floor(Math.random() * SAY.hurt.length)]);
    if (c.hp > 0) return;
    const spec = VEH[c.kind];
    if (c.kind === 'margarita') {
      talk(SAY.defeat, c.mid.x, c.mid.y);
      s.shake = 8;
      for (let i = 0; i < 2; i++) s.crates.push({ x: c.mid.x + i * 10 - 5, y: c.mid.y + 10, vx: rand(-15, 15), vy: 80, t: 0, landed: 0 });
      window.setTimeout(() => blast(c.mid.x, c.mid.y, FA.ENERGIA.bomba, 'nadie', 0), 60);
    }
    award(spec.score, c.mid.x, c.mid.y);
    // Fuel and ammo cook off: a few smaller blasts after the big one.
    for (let i = 0; i < 3; i++) {
      const ex = c.mid.x + rand(-14, 14), ey = c.mid.y + rand(0, 16);
      window.setTimeout(() => blast(ex, ey, rand(0.8, 1.6), 'nadie', 0), 140 + i * 130 + rand(0, 80));
    }
    releasePrize(s.carPrize.get(c.id), c.mid.x, c.y + A.VEH_LOOK[c.kind].h + 6);
    s.carPrize.delete(c.id);
    VFX.restos(s.fx, c.mid.x, ground(c.mid.x), A.VEH_LOOK[c.kind].w);
    // The crew bails out and fights on foot.
    if (c.kind !== 'margarita' && Math.random() < (s.wave < 4 ? 0.3 : 0.6)) s.gigantes.push(...G.desembarcar(c.x, c.y, 1 + Math.floor(Math.random() * 2), Math.random, s.wave));
    // It comes apart: chunks of hull fly off smoking.
    for (let i = 0; i < 3 + (c.kind === 'margarita' ? 4 : 0); i++) VFX.pieza(s.fx, c.mid.x + rand(-6, 6), c.mid.y + 4, rand(-70, 70), rand(50, 110), null, i % 2 ? '#8064d8' : '#b49af4');
    // The wreck goes up a moment later: chain reactions are allowed.
    window.setTimeout(() => blast(c.mid.x, c.mid.y, FA.ENERGIA.vehiculo, 'jugador', 0.8), 60);
    if (Math.random() < 0.2) s.crates.push({ x: c.mid.x, y: c.mid.y + 6, vx: rand(-10, 10), vy: 70, t: 0, landed: 0 });
  }

  /**
   * A hit tears off the part nearest to where it struck; with every part
   * gone, the next hit blows the plane up. (hx, hy) is the impact point.
   */
  function hurtPlane(n = 1, hx = s.plane.x, hy = s.plane.y) {
    if (s.inv > 0 || s.dead) return;
    const p = s.plane;
    s.inv = 0.9;
    s.hurtFlash = 0.3;
    s.shake = Math.min(8, s.shake + 4);
    fx('impacto', sfx.hurt, { vol: 0.9 });
    for (let k = 0; k < n && !s.dead; k++) {
      const left = s.spec.parts.filter((q) => !s.lost.includes(q));
      if (!left.length) {
        destroyPlane();
        break;
      }
      // Impact point in the plane's own frame (nose = +x, sprite y down).
      const dx = hx - p.x;
      const dy = hy - p.y;
      const c = Math.cos(p.rumbo);
      const sn = Math.sin(p.rumbo);
      const lx = dx * c + dy * sn;
      const ly = -(-dx * sn + dy * c) * (p.alabeo >= 0 ? 1 : -1);
      const anchors = A.LOOKS[s.spec.id].parts;
      let part = left[0];
      let best = Infinity;
      for (const q of left) {
        const [ax, ay] = anchors[q] ?? [0, 0];
        const d = Math.hypot(ax - lx, ay - ly);
        if (d < best) {
          best = d;
          part = q;
        }
      }
      s.lost.push(part);
      FV.fijarDano(p, danoDe(s.lost));
      tearOff(part);
    }
    s.hp = s.spec.parts.length + 1 - s.lost.length;
    if (s.dead) s.hp = 0;
  }

  /** World position of one of the plane's parts. */
  function partAt(part: Parte) {
    const p = s.plane;
    const [ax, ay] = A.LOOKS[s.spec.id].parts[part] ?? [0, 0];
    const ly = -ay * (p.alabeo >= 0 ? 1 : -1);
    return { x: p.x + ax * Math.cos(p.rumbo) - ly * Math.sin(p.rumbo), y: p.y + ax * Math.sin(p.rumbo) + ly * Math.cos(p.rumbo) };
  }

  /** A part flies off: sparks, smoke, a spinning piece and a shout. */
  function tearOff(part: Parte) {
    const p = s.plane;
    AB.piezaRota(part);
    const at = partAt(part);
    VFX.pieza(s.fx, at.x, at.y, p.vx * 0.5 + rand(-40, 40), p.vy * 0.5 + rand(20, 60), A.partSprite(s.spec.id, part), A.LOOKS[s.spec.id].ink);
    for (let i = 0; i < 8; i++) s.shards.push({ x: at.x, y: at.y, vx: rand(-60, 60), vy: rand(-20, 70), t: 0, c: [P.gold, '#ff9a3c', P.metal, P.white][i % 4] });
    for (let i = 0; i < 4; i++) puff(at.x, at.y, rand(2, 4), true, rand(0.8, 1.4));
    pop(at.x, at.y + 12, `¡Perdiste ${PART_NAME[part]}!`, P.red);
  }

  /** The last hit: the whole plane goes up in one big blast. */
  function destroyPlane() {
    const p = s.plane;
    AB.derribo();
    s.dead = true;
    s.deadT = 0;
    s.hp = 0;
    for (const part of s.spec.parts) {
      if (s.lost.includes(part)) continue;
      const at = partAt(part);
      VFX.pieza(s.fx, at.x, at.y, p.vx * 0.4 + rand(-70, 70), rand(10, 90), A.partSprite(s.spec.id, part), A.LOOKS[s.spec.id].ink);
    }
    VFX.pieza(s.fx, p.x, p.y, p.vx * 0.3, 30, A.planeSprite(s.spec.id, s.spec.parts), A.LOOKS[s.spec.id].ink);
    blast(p.x, p.y, FA.ENERGIA.bomba, 'nadie', 0);
    window.setTimeout(() => blast(p.x + rand(-8, 8), p.y + rand(-6, 6), FA.ENERGIA.vehiculo, 'nadie', 0), 120);
    window.setTimeout(() => blast(p.x + rand(-10, 10), p.y + rand(-6, 6), FA.ENERGIA.misilJugador, 'nadie', 0), 260);
    s.shake = 10;
    s.overT = 1.8;
    s.reason = 'avion';
  }

  /** A fresh plane after losing one: same pilot, all parts back, a moment of grace. */
  function respawn() {
    const right = Math.cos(s.plane.rumbo) >= 0;
    s.plane = FV.nuevoAvion(s.spec.id, clamp(s.camX + view.vw * (right ? 0.3 : 0.7), 40, LEVEL - 40), Math.min(CEIL - 60, 220), right);
    s.lost = [];
    FV.fijarDano(s.plane, FV.SANO);
    s.hp = s.spec.hp;
    s.dead = false;
    s.inv = 3;
    s.ammo = s.cap.misil;
    s.bombAmmo = s.cap.bomba;
    s.flares = s.cap.bengala;
    s.banner = s.lives === 1 ? '¡Último avión!' : `¡Otro avión! Quedan ${s.lives}`;
    window.setTimeout(() => {
      if (s.banner.startsWith('¡Otro') || s.banner.startsWith('¡Último')) s.banner = '';
    }, 2200);
    sfx.achievement();
  }

  /**
   * Badly broken ground ahead of a vehicle (it drives left): a crater deep or
   * wide enough to be worth a bridge. Returns its span, or null.
   */
  function brokenSpan(c: Car, ahead = 40): [number, number] | null {
    const half = A.VEH_LOOK[c.kind].w / 2;
    const deep = (x: number) => hillsAt(x) - ground(x) > 2;
    let x0 = -1;
    for (let x = Math.round(c.x + half); x > c.x - half - ahead; x--) {
      if (deep(x)) {
        x0 = x;
        break;
      }
    }
    if (x0 < 0) return null;
    let a = x0;
    let b = x0;
    while (a > PANTRY.x1 && deep(a - 1)) a--;
    while (b < LEVEL - 1 && deep(b + 1)) b++;
    let depth = 0;
    for (let x = a; x <= b; x++) depth = Math.max(depth, hillsAt(x) - ground(x));
    return b - a >= 6 && (depth >= 6 || b - a >= 22) ? [a - 2, b + 2] : null;
  }

  /** A plank bridge from x0 to x1: the deck becomes ground, painted into the strip. */
  function bridge(x0: number, x1: number, log = true) {
    x0 = Math.max(0, Math.round(x0));
    x1 = Math.min(LEVEL, Math.round(x1));
    if (x1 - x0 < 4) return;
    if (log && s.bridges.length < 120) s.bridges.push([x0, x1]);
    const y0 = HEIGHTS[x0];
    const y1 = HEIGHTS[x1];
    for (let x = x0; x <= x1; x++) {
      const h = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      if (HEIGHTS[x] < h) HEIGHTS[x] = h;
      A.bridgeColumn(sg, x, strip.top - Math.round(h), x0);
    }
  }

  /** Brings in a flying boss just off screen, at a height in its own zone. */
  function spawnBoss(tipo: JF.TipoJefe) {
    const p = s.plane;
    const [lo, hi] = JF.ZONA[tipo];
    s.jefe = JF.crear(tipo, clamp(s.camX + view.vw + 140, 150, LEVEL - 150), clamp(p.y + 60, lo, hi), s.wave);
    s.banner = tipo === 'dirigible' ? '¡Se acerca el Gran Queso!' : '¡La nave nodriza del Emperador Ratón!';
    window.setTimeout(() => {
      if (s.banner.startsWith('¡Se acerca') || s.banner.startsWith('¡La nave')) s.banner = '';
    }, 2600);
    AB.jefeLlega();
  }

  /** One step of the flying boss: its shots, beams, escorts and debris. */
  function stepBoss(dt: number, vista: IA.Vista) {
    const j = s.jefe;
    if (!j) return;
    const p = s.plane;
    const play = s.mode === 'play' && !s.dead;
    const r = JF.paso(j, vista, dt, s.aereos.length);
    s.jefeFlash = Math.max(0, s.jefeFlash - dt);
    if (play) {
      for (const d of r.disparos ?? []) s.proy.push(AE.nuevoProyectil(d));
      for (const m of r.misiles ?? []) for (const mm of MS.lanzar(m.tipo, m.x, m.y, p, s.wave, Math.random, m.desvio)) s.shots.push({ m: mm, enemy: true, tgt: p, trail: 0 });
      if (r.laser) hurtPlane(1, r.laser.x, r.laser.y);
      if (r.laser || r.tractor) AB.laserJefe(panOf(j.x));
      if (r.tractor) {
        p.vx += r.tractor.fx * dt;
        p.vy += r.tractor.fy * dt;
      }
      if (JF.choque(j, p.x, p.y, s.spec.hit)) {
        hurtPlane(1, p.x, p.y);
        p.vy += (p.y >= j.y ? 1 : -1) * 80 * dt * 10;
      }
    }
    for (const e of r.escolta ?? []) spawnAir(AE.crear(e.tipo, e.x, e.y, Math.random, s.wave));
    for (const e of r.eventos ?? []) {
      if (e.explosion) {
        const { x, y, energia } = e.explosion;
        window.setTimeout(() => blast(x, y, energia, 'nadie', 0), 20);
      }
      if (e.pieza) VFX.pieza(s.fx, e.pieza.x, e.pieza.y, e.pieza.vx, e.pieza.vy, JF.spritePieza(j.tipo, e.pieza.nombre), JF.TINTA[j.tipo]);
      if (e.dialogo) talk(e.dialogo, j.x, j.y);
    }
    for (const f of JF.focos(j)) if (Math.random() < dt * 12) VFX.fuego(s.fx, f.x, f.y, j.vx, j.vy, f.intensidad);
    if (r.muerto) {
      s.jefe = null;
      s.shake = 10;
      AB.jefeVencido();
      // A beaten mothership gives the sky a long break before the next one.
      if (j.tipo === 'nodriza') s.motherCd = Math.max(s.motherCd, 90);
      if (s.meta < META_MAX) {
        s.meta++;
        pop(j.x, j.y + 30, '¡+1 pescado recuperado! 🐟', P.gold);
      }
      for (let i = 0; i < 3; i++) s.crates.push({ x: j.x + i * 14 - 14, y: j.y, vx: rand(-20, 20), vy: 60, t: 0, landed: 0 });
      for (const k of ['misil', 'bomba', 'bengala'] as Arma[]) releasePrize(k, j.x + rand(-30, 30), j.y);
    }
  }

  /** Turns what a ground unit did (gigantes.ts) into missiles, shells, debris and blasts. */
  function giantShots(list: G.Disparo[] | undefined) {
    const p = s.plane;
    if (!list || s.mode !== 'play' || s.dead) return;
    for (const d of list) {
      if (d.clase === 'misil') {
        for (const m of MS.lanzar(d.tipo, d.x, d.y, p, s.wave, Math.random, d.desvio)) s.shots.push({ m, enemy: true, tgt: d.tipo === 'cohete' ? null : p, trail: 0 });
        fx('misil', sfx.enemyLaunch, { vol: 0.4, rate: 0.85 }, d.x);
      } else if (d.clase === 'proyectil') s.proy.push(AE.nuevoProyectil(d));
      else s.shells.push({ x: d.x, y: d.y, vx: d.vx, vy: d.vy, t: 0, fuse: d.fuse });
    }
  }
  function giantEvents(list: G.Evento[] | undefined) {
    for (const e of list ?? []) {
      if (e.pieza) VFX.pieza(s.fx, e.pieza.x, e.pieza.y, e.pieza.vx, e.pieza.vy, e.pieza.sprite, e.pieza.color);
      if (e.explosion) {
        const { x, y, energia } = e.explosion;
        window.setTimeout(() => blast(x, y, energia, 'nadie', 0), 30);
      }
      if (e.restos) VFX.restos(s.fx, e.restos.x, e.restos.y, e.restos.ancho);
      if (e.desembarco) s.gigantes.push(...G.desembarcar(e.desembarco.x, e.desembarco.y, e.desembarco.n, Math.random, s.wave));
      if (e.fuego) VFX.fuego(s.fx, e.fuego.x, e.fuego.y, 0, 0, e.fuego.k);
    }
  }
  function giantHit(u: G.Unidad, r: G.ResultadoGolpe) {
    giantEvents(r.eventos);
    if (r.muerta) award(r.puntos, u.x, u.y + 10);
    else if (r.puntos) {
      s.score += r.puntos;
      pop(u.x, u.y + 20, `+${r.puntos}`);
    }
  }

  /** Some enemies carry a reward balloon: more often whatever the plane is short of. */
  function maybePrize(): Premio | null {
    // A battered plane gets a way out of the spiral: a repair balloon.
    if (s.lost.length >= 2 && !s.prizes.some((q) => q.kind === 'reparar') && Math.random() < 0.5) return 'reparar';
    if (Math.random() > 0.32) return null;
    const room = (['misil', 'bomba', 'bengala'] as Arma[]).filter((k) => s.cap[k] < CAP_MAX[k]);
    if (!room.length) return null;
    room.sort((a, b) => s.cap[a] / CAP_MAX[a] - s.cap[b] / CAP_MAX[b]);
    return Math.random() < 0.6 ? room[0] : room[Math.floor(Math.random() * room.length)];
  }

  /** The enemy is down: its balloon floats up, free to catch. */
  function releasePrize(kind: Premio | undefined, x: number, y: number) {
    if (!kind) return;
    s.prizes.push({ x, y, vx: rand(-8, 8), vy: 28, t: 0, kind });
  }

  /** Caught a balloon: one more slot of that weapon, filled up. */
  function catchPrize(kind: Premio, x: number, y: number) {
    sfx.star();
    sfx.reveal();
    S.suena('recoger', { vol: 1 });
    if (kind === 'reparar') {
      // Two parts back, and a moment to breathe.
      if (!repair()) {
        s.score += 300;
        pop(x, y + 16, '+300', P.gold);
      } else repair();
      s.inv = Math.max(s.inv, 1);
    } else if (s.cap[kind] < CAP_MAX[kind]) {
      s.cap[kind]++;
      if (kind === 'misil') s.ammo = s.cap.misil;
      else if (kind === 'bomba') s.bombAmmo = s.cap.bomba;
      else s.flares = s.cap.bengala;
      pop(x, y + 16, `¡+1 ${PRIZE_NAME[kind]}! (${s.cap[kind]})`, P.gold);
    } else {
      s.score += 300;
      pop(x, y + 16, '+300', P.gold);
    }
  }

  function spawnAir(list: AE.Aereo[]) {
    // Flyers are a little fragile: their missiles are the hard part.
    for (const a of list) a.hp = Math.max(1, Math.round(a.hp * 0.7 * 10) / 10);
    s.aereos.push(...list);
    for (const a of list) s.airMax.set(a.id, a.hp);
    // Drone swarms don't carry balloons; one per group otherwise.
    const a = list[0];
    if (a && a.tipo !== 'dron') {
      const prize = maybePrize();
      if (prize) s.airPrize.set(a.id, prize);
    }
  }

  /** Repairs one lost part (crates, end of a wave). */
  function repair() {
    const part = s.lost.pop();
    if (!part) return false;
    FV.fijarDano(s.plane, danoDe(s.lost));
    s.hp = s.spec.parts.length + 1 - s.lost.length;
    pop(s.plane.x, s.plane.y + 14, `¡Reparaste ${PART_NAME[part]}!`, P.g2);
    return true;
  }


  /* ── Firing ── */

  /**
   * Lock-on: keep the nose on one enemy (within ~11°, up to 420 px) for a
   * second and it locks; the next missile homes on it.
   */
  function stepLock(dt: number) {
    const p = s.plane;
    let best: { key: object; f: Fijable } | null = null;
    let bestA = 0.2;
    const consider = (key: object, f: Fijable) => {
      const q = f.pos();
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 40 || d > 420) return;
      const a = Math.abs(((Math.atan2(dy, dx) - p.rumbo + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (a < bestA) {
        bestA = a;
        best = { key, f };
      }
    };
    for (const c of s.cars) if (c.hp > 0) consider(c, { pos: () => c.mid, vivo: () => c.hp > 0 && s.cars.includes(c), r: 8 });
    for (const a of s.aereos) if (a.hp > 0) consider(a, { pos: () => a, vivo: () => a.hp > 0 && s.aereos.includes(a), r: 8 });
    for (const u of s.gigantes) if (u.viva) consider(u, { pos: () => ({ x: u.x, y: u.y + 8, vx: u.vx, vy: 0 }), vivo: () => u.viva, r: 8 });
    for (const f of s.fighters) if (f.hp > 0) consider(f, { pos: () => f.a, vivo: () => f.hp > 0 && s.fighters.includes(f), r: 8 });
    const j = s.jefe;
    if (j) consider(j, { pos: () => j, vivo: () => s.jefe === j, r: 30 });
    const b = best as { key: object; f: Fijable } | null;
    if (b && b.key === s.lockKey) {
      const before = s.lockT;
      s.lockT += dt;
      s.lockCand = b.f;
      if (before < LOCK_TIME && s.lockT >= LOCK_TIME) sfx.select();
    } else if (b) {
      s.lockKey = b.key;
      s.lockCand = b.f;
      s.lockT = 0;
    } else {
      s.lockT = Math.max(0, s.lockT - dt * 3);
      if (s.lockT === 0) {
        s.lockKey = null;
        s.lockCand = null;
      }
    }
  }

  /** The machine gun: fast tracers from the nose, it overheats if held too long. */
  function fireGun(dt: number) {
    const p = s.plane;
    s.gunT -= dt;
    s.heat = Math.max(0, s.heat - dt * (s.hot ? 0.45 : 0.3));
    if (s.hot && s.heat < 0.35) s.hot = false;
    if (!input.gun || s.hot || s.gunT > 0) return;
    s.gunT = 0.075;
    s.heat += 0.045;
    if (s.heat >= 1) {
      s.hot = true;
      pop(p.x, p.y + 16, '¡Metralla caliente!', P.r3);
    }
    const a = p.rumbo + rand(-0.035, 0.035);
    const nose = s.spec.hit + 3;
    s.bullets.push({ x: p.x + Math.cos(p.rumbo) * nose, y: p.y + Math.sin(p.rumbo) * nose, vx: p.vx + Math.cos(a) * 480, vy: p.vy + Math.sin(a) * 480, t: 0, life: 0.85 });
    fx('antiaereo', sfx.step, { vol: 0.16, rate: rand(1.7, 1.95), dur: 0.07 });
  }

  /** Moves the tracers and hits whatever they touch. */
  function stepBullets(dt: number) {
    for (const b of s.bullets) {
      b.t += dt;
      b.vy -= FA.GRAVEDAD * 0.25 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let hit = false;
      if (b.y <= ground(b.x)) {
        hit = true;
        puff(b.x, ground(b.x) + 1, 1, false, 0.4);
      }
      for (const c of s.cars) {
        if (hit) break;
        const look = A.VEH_LOOK[c.kind];
        if (Math.abs(b.x - c.x) < look.w / 2 + 1 && b.y > c.y - 1 && b.y < c.y + look.h) {
          hit = true;
          hurtCar(c, 0.11);
        }
      }
      for (const a of s.aereos) {
        if (hit || a.hp <= 0) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < AE.radio(a) + 2) {
          hit = true;
          a.hp -= 0.18;
          s.airFlash.set(a.id, 0.08);
          if (a.hp <= 0) blast(a.x, a.y, 0.4, 'jugador', 1);
        }
      }
      for (const u of s.gigantes) {
        if (hit || !u.viva) continue;
        const bx = G.caja(u);
        if (b.x > bx.x0 && b.x < bx.x1 && b.y > bx.y0 && b.y < bx.y1) {
          hit = true;
          giantHit(u, G.golpear(u, b.x, b.y, 0.25));
        }
      }
      for (const f of s.fighters) {
        if (hit || f.hp <= 0) continue;
        if (CZ.tocado(f, b.x, b.y, 1)) {
          hit = true;
          hurtFighter(f, 0.2);
        }
      }
      for (const o of s.shots) {
        if (hit || !o.enemy || o.m.t < 0) continue;
        if (Math.hypot(o.m.x - b.x, o.m.y - b.y) < 4 + MS.MISILES[o.m.tipo].radioChoque) {
          hit = true;
          if (MS.golpear(o.m, 1)) {
            o.m.t = -1;
            blast(o.m.x, o.m.y, MS.MISILES[o.m.tipo].energia * 0.6, 'nadie', 0);
            s.score += 50;
            pop(o.m.x, o.m.y + 8, '¡Derribado! +50', P.gold);
          }
        }
      }
      if (!hit && s.jefe && JF.tocado(s.jefe, b.x, b.y, 1)) {
        hit = true;
        const h = JF.golpear(s.jefe, b.x, b.y, 0.22 * BOSS_MUL[s.spec.id]);
        s.jefeFlash = 0.06;
        if (h.derrotado) award(h.puntos ?? 0, b.x, b.y);
      }
      if (hit) {
        b.t = b.life;
        s.shards.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(10, 60), t: 0, c: P.gold });
      }
    }
    s.bullets = s.bullets.filter((b) => b.t < b.life);
  }

  function firePlayer() {
    const p = s.plane;
    if (input.fire && s.ammo >= 1 && s.fireT <= 0) {
      const m = FA.misilJugador(p, s.wave);
      // No lock-on: the missile flies where the nose points.
      // Held the nose on an enemy long enough: this missile homes on it.
      const locked = s.lockT >= LOCK_TIME && s.lockCand && s.lockCand.vivo() ? s.lockCand : undefined;
      s.shots.push({ m, enemy: false, tgt: null, trail: 0, lock: locked });
      s.ammo--;
      s.fireT = 0.22;
      fx('misil', sfx.launch, { vol: 0.4, rate: rand(0.95, 1.1), dur: 0.35 });
    }
    if (input.bomb && s.bombT <= 0 && s.bombAmmo >= 1) {
      s.bombAmmo--;
      for (let i = 0; i < s.spec.bombs; i++) s.bombs.push(FA.soltarBomba(p, i));
      s.bombT = s.spec.bombCd;
      fx('bomba', sfx.bomb, { vol: 0.5 });
    }
    if (input.flare && !s.flareWasDown && s.flares > 0 && s.flareCd <= 0) {
      s.flares--;
      s.flareCd = 0.6;
      let fooled = 0;
      for (let i = 0; i < 3; i++) {
        const f = { x: p.x, y: p.y - 3, vx: p.vx * 0.5 + rand(-30, 30), vy: p.vy * 0.5 + rand(-10, 30), t: 0 };
        s.flareBodies.push(f);
        // Each seeker gets one look at each new flare: decoyed or not.
        for (const sh of s.shots) {
          if (sh.enemy && sh.tgt === p && sh.m.guiado && MS.engana(sh.m, f, p)) {
            sh.tgt = f;
            fooled++;
          }
        }
      }
      fx('bengalas', sfx.flare, { vol: 0.6 });
      if (fooled) {
        pop(p.x, p.y + 18, fooled > 1 ? `¡${fooled} misiles engañados!` : '¡Misil engañado!', P.gold);
        sfx.star();
      }
    }
    s.flareWasDown = input.flare;
  }

  function carFires(c: Car) {
    const p = s.plane;
    // The first wave is a warm-up: one missile in the air at a time.
    if (s.wave === 1 && s.shots.some((sh) => sh.enemy && sh.m.t >= 0)) return;
    // How many guided missiles may chase the plane at once grows with the waves.
    const maxGuided = s.wave <= 2 ? s.wave : Math.min(2 + Math.floor(s.wave / 3), 6);
    if (s.shots.filter((sh) => sh.enemy && sh.m.t >= 0 && sh.tgt === p && sh.m.guiado).length >= maxGuided) return;
    const lvl = s.wave;
    const ox = c.mid.x;
    const oy = c.y + 14;
    if (c.kind === 'margarita') {
      // A slipper or a tomato, and every third throw a flower pot that bursts.
      s.throws++;
      const kind = s.throws % 3 === 0 ? 'macetero' : Math.random() < 0.5 ? 'chancla' : 'tomate';
      const from = { x: c.x + 12, y: c.y + 50 };
      const sol = FA.solucionTiro(from, 140, p, true, FA.ARRASTRE_OBUS);
      const vx = sol ? sol.vx : Math.sign(p.x - from.x) * 70;
      const vy = sol ? sol.vy : 120;
      s.junk.push({ x: from.x, y: from.y, vx: vx + rand(-6, 6), vy: vy + rand(-6, 6), t: 0, kind, spin: 0, fuse: kind === 'macetero' && sol ? sol.tiempo : 99 });
      FA.retroceso(c, Math.atan2(vy, vx), 3);
      sfx.jump();
      return;
    }
    // Each vehicle picks from the missile catalogue for this wave; the
    // tank keeps its flak cannon when it doesn't get a missile.
    // Only weapons that can reach the plane's height; nothing to fire if none can.
    const above = p.y - c.y;
    const pick = MS.elegirArmamento(c.kind, lvl, Math.random, above);
    if (!pick && above > 500) return;
    const tipo = pick ?? (c.kind === 'tanque' ? null : 'buscador');
    if (tipo) {
      // The SAM fires a pair (one salvo of the swarm); the rest, one at a time.
      const salvos = c.kind === 'sam' && tipo !== 'enjambre' ? [-0.3, 0.3] : [0];
      for (const dv of salvos) for (const m of MS.lanzar(tipo, ox, oy + (c.kind === 'sam' ? 4 : 0), p, lvl, Math.random, dv)) s.shots.push({ m, enemy: true, tgt: tipo === 'cohete' ? null : p, trail: 0 });
      FA.retroceso(c, Math.PI / 2, c.kind === 'jeep' ? 4 : 7);
      fx('misil', sfx.enemyLaunch, { vol: 0.45, rate: tipo === 'dardo' ? 1.2 : tipo === 'pesado' ? 0.65 : 0.8 }, ox);
    } else {
      // Flak: a time-fused shell that bursts where the plane will be.
      const sol = FA.solucionTiro({ x: ox, y: oy }, FA.VEL_OBUS, p, true, FA.ARRASTRE_OBUS);
      if (!sol) return;
      s.shells.push({ x: ox, y: oy, vx: sol.vx, vy: sol.vy, t: 0, fuse: sol.tiempo });
      FA.retroceso(c, Math.atan2(sol.vy, sol.vx), 5);
      puff(ox, oy, 3, false, 0.5);
      fx('antiaereo', sfx.dig, { vol: 0.55, rate: rand(0.9, 1.1) }, ox);
    }
  }

  /* ── Simulation ── */

  function step(dt: number) {
    s.t += dt;
    const p = s.plane;
    const wind = FV.viento(s.t, p.x, p.y);
    const top = ceiling();

    // Touch turning: holding the left half turns the nose counterclockwise, the
    // right half clockwise (commanding 90° off the nose: the tightest turn).
    if (turn && s.mode === 'play' && !s.dead) {
      touch.x = Math.cos(p.rumbo + turn * 1.45);
      touch.y = Math.sin(p.rumbo + turn * 1.45);
      syncInput();
    }

    // The plane: the player flies it; in the menu it flies itself.
    if (s.mode === 'demo') {
      const dir = p.x > LEVEL - 400 ? -1 : p.x < 300 ? 1 : Math.cos(p.rumbo) >= 0 ? 1 : -1;
      const ty = 150 + Math.sin(s.t * 0.6) * 25;
      FV.pasoAvion(p, 'avioneta', { x: dir, y: clamp((ty - p.y) / 40, -1, 1), gas: 0 }, dt, ground, top);
    } else if (!s.dead) {
      const mando: Mando = { x: input.x, y: input.y, gas: input.gas };
      // The edges of the map turn the plane back (no flying off screen).
      if (p.x < 90 && Math.cos(p.rumbo) < 0.3) mando.x = 1;
      if (p.x > LEVEL - 90 && Math.cos(p.rumbo) > -0.3) mando.x = -1;
      if (p.x < 90 || p.x > LEVEL - 90) mando.y = Math.max(mando.y, 0);
      for (const ev of FV.pasoAvion(p, s.spec.id, mando, dt, ground, top)) {
        if (ev.tipo === 'toqueSuelo' && ev.velocidad > 35 && s.mode === 'play') {
          // A hard crash into the ground blows the plane up at once; a scrape costs a part.
          if (ev.velocidad > 60) {
            s.inv = 0;
            destroyPlane();
          } else {
            hurtPlane(1, p.x, p.y - 8);
            blast(p.x, p.y - 4, FA.ENERGIA.obus, 'nadie', 0);
          }
        }
      }
      // Super nitro: a hard shove along the nose, past the normal top speed.
      if (s.nitroT > 0) {
        s.nitroT -= dt;
        p.vx += Math.cos(p.rumbo) * NITRO_ACC * dt;
        p.vy += Math.sin(p.rumbo) * NITRO_ACC * dt;
        if (Math.random() < dt * 40) puff(p.x - Math.cos(p.rumbo) * 12, p.y - Math.sin(p.rumbo) * 12, rand(1, 2.5), false, 0.6, -p.vx * 0.2, -p.vy * 0.2);
        s.shake = Math.max(s.shake, 1.5);
      }
      // Stuck on the ground (too slow, too broken to take off): it's a crash.
      if (s.mode === 'play' && p.y - ground(p.x) < 14 && Math.hypot(p.vx, p.vy) < 30) {
        s.stuckT += dt;
        if (s.stuckT > 2.5) {
          s.stuckT = 0;
          destroyPlane();
        }
      } else s.stuckT = 0;
      s.stallT = p.perdida ? 1.4 : Math.max(0, s.stallT - dt);
      // Wingtip vapor when flying fast or pulling hard: white streaks behind the plane.
      s.vaporT -= dt;
      const speed = Math.hypot(p.vx, p.vy);
      if (s.vaporT <= 0 && (speed > FV.PARAMS[s.spec.id].velMax * 0.8 || p.carga > 3.5) && p.y > ground(p.x) + 20) {
        s.vaporT = 0.035;
        const bx = -Math.cos(p.rumbo) * 7, by = -Math.sin(p.rumbo) * 7;
        const nx = -Math.sin(p.rumbo) * 4, ny = Math.cos(p.rumbo) * 4;
        puff(p.x + bx + nx, p.y + by + ny, 1, false, 0.7, p.vx * 0.1, p.vy * 0.1);
        puff(p.x + bx - nx, p.y + by - ny, 1, false, 0.7, p.vx * 0.1, p.vy * 0.1);
      }
      // Torn-off parts smoke: black and fiery from the engine, grey elsewhere.
      s.smokeT -= dt;
      if (s.lost.length && s.smokeT <= 0) {
        s.smokeT = 0.05;
        for (const part of s.lost) {
          const at = partAt(part);
          if (part === 'motor') VFX.fuego(s.fx, at.x, at.y, p.vx, p.vy, s.hp <= 1 ? 1 : 0.6);
          else puff(at.x, at.y, rand(1, 2), s.lost.length > 2, 0.8);
        }
      }
    } else s.deadT += dt;
    p.x = clamp(p.x, 12, LEVEL - 12);
    if (s.overT > 0) {
      s.overT -= dt;
      if (s.overT <= 0) {
        s.overT = 0;
        // Shot down with planes to spare: a fresh one takes off.
        if (s.reason === 'avion' && s.lives > 1) {
          s.lives--;
          respawn();
        } else gameOver(s.reason);
      }
    }

    if (s.mode === 'play' && !s.dead) {
      s.inv = Math.max(0, s.inv - dt);
      s.fireT -= dt;
      s.bombT -= dt;
      s.flareCd -= dt;
      s.nitroCd = Math.max(0, s.nitroCd - dt);
      if (s.ammo < s.cap.misil) {
        s.reloadT += dt;
        if (s.reloadT >= s.spec.reload) {
          s.ammo++;
          s.reloadT = 0;
        }
      }
      if (s.bombAmmo < s.cap.bomba) {
        s.bombReloadT += dt;
        if (s.bombReloadT >= BOMB_RELOAD) {
          s.bombAmmo++;
          s.bombReloadT = 0;
        }
      }
      if (s.flares < s.cap.bengala) {
        s.flareT += dt;
        if (s.flareT >= FLARE_RELOAD) {
          s.flares++;
          s.flareT = 0;
        }
      }
      firePlayer();
      fireGun(dt);
      stepLock(dt);
    }

    // Waves.
    if (s.mode === 'play') {
      if (s.phase === 'break') {
        s.breakT -= dt;
        if (s.breakT <= 0) {
          s.phase = 'wave';
          s.banner = '';
        }
      } else {
        s.spawnT -= dt;
        if (s.queue.length && s.spawnT <= 0) {
          const kind = s.queue.shift()!;
          const v = FA.nuevoVehiculo(LEVEL + 20, ground, VEH[kind].masa);
          s.cars.push({
            ...v,
            kind,
            hp: VEH[kind].hp,
            fireT: VEH[kind].cd * rand(0.5, 1),
            flash: 0,
            wheel: 0,
            aim: -Math.PI * 0.75,
            mid: { x: v.x, y: v.y + 8, vx: 0, vy: 0 },
            id: ++carIds,
            mem: {},
          });
          const prize = maybePrize();
          if (prize) s.carPrize.set(carIds, prize);
          s.spawnT = Math.max(0.6, 2.8 - s.wave * 0.25) * rand(0.6, 1.3);
        }
        // Flying mice come in a few at a time from wherever the plane is.
        s.airT -= dt;
        if (s.airQueue.length && s.airT <= 0 && !s.jefe) {
          let tp = s.airQueue.shift()!;
          // Send something that can reach the plane where it is (UFOs only up in space).
          if (p.y > AE.techoTipo(tp) + 60 || (tp === 'ovni') !== (p.y > AE.ALTURA_OVNI)) tp = AE.tipoParaAltura(s.wave, Math.random, p.y);
          const fromRight = Math.random() < 0.6;
          spawnAir(AE.crear(tp, clamp(s.camX + (fromRight ? view.vw + 60 : -60), 40, LEVEL - 40), AE.alturaAparicion(tp, p.y, Math.random), Math.random, s.wave));
          s.airT = rand(5, 9) * Math.max(0.5, 1 - s.wave * 0.04);
        }
        // Mouse fighters, from wave 3 on, one at a time from the edge of the view.
        s.fighterT -= dt;
        if (s.fighterQueue > 0 && s.fighterT <= 0 && !s.jefe) {
          s.fighterQueue--;
          const fromRight = Math.random() < 0.6;
          s.fighters.push(CZ.crear(clamp(s.camX + (fromRight ? view.vw + 80 : -80), 40, LEVEL - 40), clamp(p.y + rand(-40, 120), 150, CEIL - 100), !fromRight, s.wave));
          s.fighterT = rand(9, 15);
          if (!s.banner) {
            s.banner = '✈️ ¡Cazas ratón en el aire!';
            window.setTimeout(() => {
              if (s.banner.startsWith('✈️')) s.banner = '';
            }, 2000);
          }
          sfx.warn();
        }
        // Space is never empty: hang around up there and UFOs keep coming.
        if (!s.airQueue.length && s.airT <= 0 && p.y > AE.ALTURA_OVNI && s.aereos.filter((a) => a.tipo === 'ovni').length < 2) {
          spawnAir(AE.crear('ovni', clamp(s.camX + view.vw + 60, 40, LEVEL - 40), AE.alturaAparicion('ovni', p.y, Math.random), Math.random, s.wave));
          s.airT = rand(8, 12);
        }
        s.bigT -= dt;
        if (s.bigQueue.length && s.bigT <= 0) {
          s.gigantes.push(...G.crear(s.bigQueue.shift()!, LEVEL + 40, ground, Math.random, s.wave));
          s.bigT = rand(6, 11);
        }
        const clear =
          !s.queue.length && !s.cars.length && !s.aereos.length && !s.airQueue.length && !s.bigQueue.length &&
          !s.gigantes.some((u) => u.viva) && !s.jefe && !s.fighters.length && !s.fighterQueue && s.overT === 0;
        if (clear && s.jefeFor !== s.wave && (s.wave % 6 === 3 || s.wave % 6 === 0)) {
          // Airship after wave 3 (9, 15…), mothership after wave 6 (12, 18…).
          s.jefeFor = s.wave;
          spawnBoss(s.wave % 6 === 3 ? 'dirigible' : 'nodriza');
        } else
        if (clear && s.wave % BOSS_EVERY === 1 && s.bossFor !== s.wave) {
          // The wave is clear… and here comes the neighbour.
          s.bossFor = s.wave;
          const v = FA.nuevoVehiculo(LEVEL + 40, ground, VEH.margarita.masa);
          const hp = VEH.margarita.hp * (1 + 0.5 * s.bossCount);
          s.bossMax = hp;
          s.cars.push({ ...v, kind: 'margarita', hp, fireT: 2, flash: 0, wheel: 0, aim: 0, mid: { x: v.x, y: v.y + 25, vx: 0, vy: 0 }, id: ++carIds, mem: {} });
          talk(s.bossCount ? SAY.back : SAY.intro);
          s.sayT = 5;
          s.bossCount++;
          s.banner = '¡Cuidado! Llega la vecina Margarita';
          window.setTimeout(() => {
            if (s.banner.startsWith('¡Cuidado')) s.banner = '';
          }, 2600);
          AB.jefeLlega();
        } else if (clear) {
          const bonus = 250 * s.wave;
          s.score += bonus;
          if (!s.dead) repair();
          sfx.achievement();
          nextWave();
          s.banner = `¡Oleada ${s.wave - 1} superada! +${bonus}`;
          s.breakT = 3.4;
          window.setTimeout(() => {
            if (s.mode === 'play' && s.phase === 'break') s.banner = `Oleada ${s.wave}`;
          }, 1800);
        }
      }
    }

    // Vehicles: each mouse thinks (ia.ts): dodge bombs, scatter, sprint,
    // hold fire without a clear shot, and fire together in salvos.
    const speedUp = Math.min(1.5, 1 + (s.wave - 1) * 0.05);
    s.cars.sort((a, b) => a.x - b.x);
    const vista: IA.Vista = {
      avion: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, vivo: s.mode === 'play' && !s.dead },
      bombas: s.bombs,
      misilesJugador: s.shots.filter((sh) => !sh.enemy).map((sh) => sh.m),
      vecinos: s.cars.map((c) => ({ x: c.x, kind: c.kind, vx: c.vx })),
      ola: s.wave,
      t: s.t,
      suelo: ground,
      viento: wind,
      radioAvion: s.spec.hit,
    };
    const salvo = s.mode === 'play' && !s.dead ? IA.coordinarSalva(s.cars, vista, s.t, s.salvaMem) : new Set<number>();
    for (let i = 0; i < s.cars.length; i++) {
      const c = s.cars[i];
      const spec = VEH[c.kind];
      const look = A.VEH_LOOK[c.kind];
      const order = IA.pensar(c, vista, c.mem);
      const x0 = c.x;
      FA.pasoVehiculo(c, c.mem.puente > 0 ? 0 : order.velocidad * speedUp, dt, ground, look.w);
      c.wheel += Math.abs(c.x - x0);
      // Stuck in broken ground: the mice get out and build a plank bridge
      // across it (if there's no crater to bridge, they just bounce out).
      if (c.mem.puente > 0) {
        c.mem.puente -= dt;
        if (c.mem.puente <= 0) {
          bridge(c.mem.px0, c.mem.px1);
          AB.puenteListo(panOf(c.x));
          FA.empujeVehiculo(c, -25, 55);
          c.mem.atascado = 0;
        }
      } else if (c.kind !== 'margarita') {
        // Every half second each driver looks ahead for badly broken ground;
        // a vehicle that's stuck anyway looks right under itself.
        c.mem.atascado = Math.abs(c.x - x0) < dt * 2 ? (c.mem.atascado ?? 0) + dt : 0;
        c.mem.mira = (c.mem.mira ?? 0) - dt;
        if (c.mem.mira <= 0 || c.mem.atascado > 1.6) {
          c.mem.mira = 0.5;
          const span = brokenSpan(c, c.mem.atascado > 1.6 ? 60 : 30);
          if (span) {
            c.mem.px0 = span[0];
            c.mem.px1 = span[1];
            c.mem.puente = 1.2 + (span[1] - span[0]) * 0.03;
            c.mem.puenteT = c.mem.puente;
            c.mem.atascado = 0;
          } else if (c.mem.atascado > 1.6) {
            c.mem.atascado = 0;
            FA.empujeVehiculo(c, -40, 70);
          }
        }
      }
      c.flash = Math.max(0, c.flash - dt);
      // Visible damage: grey smoke once hurt, black smoke and fire when nearly gone.
      const life = c.hp / (c.kind === 'margarita' ? s.bossMax : VEH[c.kind].hp);
      if (life < 0.99) {
        c.mem.humoT = (c.mem.humoT ?? 0) - dt;
        if (c.mem.humoT <= 0) {
          c.mem.humoT = life < 0.4 ? 0.06 : 0.16;
          const topY = c.y + look.h * 0.8;
          if (life < 0.4) VFX.fuego(s.fx, c.x + rand(-look.w / 4, look.w / 4), topY, c.vx, 0, 0.5);
          else puff(c.x + rand(-5, 5), topY, rand(1.5, 2.5), life < 0.6, 0.9, 0, 14);
        }
      }
      c.mid.x = c.x;
      c.mid.y = c.y + look.h / 2;
      c.mid.vx = c.vx;
      c.mid.vy = c.vy;
      const dx = p.x - c.x;
      const dy = p.y - (c.y + 14);
      if (c.kind === 'tanque') c.aim = -Math.atan2(dy, dx);
      // Only fire when the player can see them: no shots from below the clouds.
      const onScreen = c.x > s.camX - 10 && c.x < s.camX + view.vw + 10 && c.y > s.camY - A.DIRT - 20;
      if (s.mode === 'play' && !s.dead && onScreen) {
        c.fireT -= dt;
        if (salvo.has(c.id) || (order.disparar && c.fireT <= 0)) {
          carFires(c);
          c.fireT = Math.max(0.6, spec.cd * 0.8 * (1 - (s.wave - 1) * 0.04)) * rand(0.7, 1.2) * (order.cadencia ?? 1);
        }
      }
      if (c.x <= META_X && c.hp > 0) {
        c.hp = 0;
        c.x = -999;
        // Margarita empties three crates at once.
        if (c.kind === 'margarita') talk(SAY.win, META_X, ground(META_X));
        s.meta -= c.kind === 'margarita' ? 3 : 1;
        sfx.lose();
        s.shake = Math.min(6, s.shake + 3);
        stolen();
        if (s.meta <= 0 && s.overT === 0) {
          s.overT = 0.8;
          s.reason = 'despensa';
        }
      }
    }
    s.cars = s.cars.filter((c) => c.hp > 0);

    // Ground units of every size.
    for (const u of s.gigantes) {
      const onScreen = u.x > s.camX - 30 && u.x < s.camX + view.vw + 30 && u.y > s.camY - A.DIRT - 20;
      const r = G.paso(u, vista, dt, ground, { metaX: META_X, disparar: s.mode === 'play' && !s.dead && onScreen });
      giantShots(r.disparos);
      giantEvents(r.eventos);
      if (r.llego && G.ROBO[u.tipo] > 0) {
        s.meta -= G.ROBO[u.tipo];
        sfx.lose();
        stolen();
        if (s.meta <= 0 && s.overT === 0) {
          s.overT = 0.8;
          s.reason = 'despensa';
        }
      }
    }
    s.gigantes = s.gigantes.filter((u) => !u.quitar);
    stepBoss(dt, vista);
    // Hang around in space too long and the mothership comes looking.
    s.motherCd = Math.max(0, s.motherCd - dt);
    s.spaceT = p.y > 1900 && s.mode === 'play' ? s.spaceT + dt : 0;
    if (s.spaceT > 12 && !s.jefe && s.motherCd <= 0 && s.mode === 'play') {
      spawnBoss('nodriza');
      s.motherCd = 60;
      s.spaceT = 0;
    }

    // Flying mice: helicopters, drone swarms and balloons with mines.
    for (const a of s.aereos) {
      const r = AE.paso(a, s.aereos, vista, dt);
      s.airFlash.set(a.id, Math.max(0, (s.airFlash.get(a.id) ?? 0) - dt));
      const airLife = a.hp / (s.airMax.get(a.id) ?? a.hp);
      if (airLife < 0.99 && Math.random() < dt * (airLife < 0.5 ? 20 : 8)) {
        if (airLife < 0.5) VFX.fuego(s.fx, a.x, a.y, a.vx, a.vy, 0.4);
        else puff(a.x, a.y, rand(1.5, 2.5), false, 0.8);
      }
      if (s.mode === 'play' && !s.dead) {
        for (const d of r.disparos ?? []) s.proy.push(AE.nuevoProyectil(d));
        // UFO laser and tractor beam.
        if (r.laser) hurtPlane(1, r.laser.x, r.laser.y);
        if (r.tractor) {
          p.vx += r.tractor.fx * dt;
          p.vy += r.tractor.fy * dt;
        }
      }
      if (r.embestida) {
        a.hp = 0;
        blast(a.x, a.y, FA.ENERGIA.misilEnemigo, 'raton', 1);
      } else if (a.estrellado && a.hp > 0) {
        a.hp = 0;
        blast(a.x, a.y, FA.ENERGIA.vehiculo, 'nadie', 0);
      }
    }
    s.aereos = s.aereos.filter((a) => a.hp > 0);
    // Enemy fighters: fly, shoot, and crash if they hit the ground.
    for (const f of s.fighters) {
      const r = CZ.paso(f, p, flyingNow(), dt, ground, CEIL, s.wave);
      for (const d of r.disparos) s.proy.push(AE.nuevoProyectil({ ...d, tipo: 'balin' }));
      if (r.misil) {
        for (const mm of MS.lanzar('buscador', f.a.x, f.a.y, p, s.wave, Math.random)) s.shots.push({ m: mm, enemy: true, tgt: p, trail: 0 });
        fx('misil', sfx.enemyLaunch, { vol: 0.4, rate: 1.1 }, f.a.x);
      }
      f.a.x = clamp(f.a.x, 20, LEVEL - 20);
      if (f.a.y <= ground(f.a.x) + 3) hurtFighter(f, 99, false);
      if (f.hp > 0 && f.hp < f.hpMax * 0.5 && Math.random() < dt * 14) puff(f.a.x, f.a.y, rand(1, 2), true, 0.9);
    }
    s.fighters = s.fighters.filter((f) => f.hp > 0);
    for (const q of s.proy) {
      const st = AE.pasoProyectil(q, dt, ground, wind);
      if (s.mode === 'play' && !s.dead && Math.hypot(q.x - p.x, q.y - p.y) < s.spec.hit + AE.RADIO_PROYECTIL[q.tipo]) {
        q.t = -1;
        if (q.tipo === 'balin') {
          // Small arms chip away: every third pellet tears off a part.
          s.chip++;
          s.hurtFlash = Math.max(s.hurtFlash, 0.12);
          if (s.chip >= 3) {
            s.chip = 0;
            hurtPlane(1, q.x, q.y);
          } else pop(q.x, q.y + 8, '¡Tic!', P.metal);
        }
        else blast(q.x, q.y, FA.ENERGIA.obus, 'raton', 1);
      } else if (st !== 'vuela') {
        if (q.tipo === 'mina') blast(q.x, q.y, FA.ENERGIA.obus, 'nadie', 0);
        q.t = -1;
      }
    }
    s.proy = s.proy.filter((q) => q.t >= 0);

    // Missiles.
    let warn = false;
    const born: Shot[] = [];
    const flying = s.mode === 'play' && !s.dead;
    for (const sh of s.shots) {
      if (sh.m.t < 0) continue;
      const m = sh.m;
      sh.estela ??= E.crearEstela(trailStyle(sh));
      E.empujarPunto(sh.estela, m.x, m.y, m.rumbo, m.combustible > 0, dt);
      E.actualizarEstela(sh.estela, dt, wind);
      if (sh.enemy) {
        const em = sh.m;
        const F = MS.MISILES[em.tipo];
        const r = MS.paso(em, flying || sh.tgt !== p ? sh.tgt : null, dt, s.wave, ground);
        // Outrunning: fast and not flying into it, the missile bleeds energy (it
        // can't keep pulling lead); if the gap keeps growing it gives up.
        if (flying && sh.tgt === p && em.t > 0.6 && !sh.perdido) {
          const pv = Math.hypot(p.vx, p.vy);
          const lx = p.x - em.x, ly = p.y - em.y;
          const ld = Math.hypot(lx, ly) || 1;
          const away = pv > 1 ? (p.vx * lx + p.vy * ly) / (pv * ld) : 0;
          if (away > -0.2 && pv > FV.PARAMS[s.spec.id].velMax * 0.7) {
            const ms = Math.hypot(em.vx, em.vy);
            const cap = pv * (away > 0.5 ? 0.8 : 0.95);
            if (ms > cap) {
              const k = Math.max(cap / ms, 1 - dt * 1.5);
              em.vx *= k;
              em.vy *= k;
            }
            if (ld > (sh.gap ?? Infinity)) sh.cola = (sh.cola ?? 0) + dt;
            if ((sh.cola ?? 0) > 0.8 && ld > 120) {
              sh.perdido = true;
              em.guiado = false;
              pop(p.x, p.y + 18, '¡Lo dejaste atrás!', P.gold);
            }
          } else sh.cola = Math.max(0, (sh.cola ?? 0) - dt);
          sh.gap = ld;
        }
        if (r.estado === 'divide') {
          // The cluster opens: a pop and its bomblets carry on.
          em.t = -1;
          puff(em.x, em.y, 4, false, 0.6);
          fx('bengalas', sfx.pop, { vol: 0.35, rate: 1.4 }, em.x);
          for (const h of r.hijos ?? []) born.push({ m: h, enemy: true, tgt: sh.tgt, trail: 0 });
          continue;
        }
        if (r.estado === 'suelo') {
          em.t = -1;
          blast(em.x, Math.max(em.y, ground(em.x)), F.energia, 'raton', F.danio);
          continue;
        }
        if (r.estado === 'agotado') {
          em.t = -1;
          blast(em.x, em.y, Math.min(F.energia, 1.5), 'nadie', 0);
          continue;
        }
        if (flying && MS.distanciaMinima(em, p, dt) < MS.radioImpacto(em, s.spec.hit)) {
          em.t = -1;
          blast(em.x, em.y, F.energia, 'raton', F.danio);
          continue;
        }
        const dNow = Math.hypot(em.x - p.x, em.y - p.y);
        // Warn by time to impact (fast missiles cover 170 px in half a second).
        const closing = dNow > 1 ? -((em.x - p.x) * (em.vx - p.vx) + (em.y - p.y) * (em.vy - p.vy)) / dNow : 0;
        if (flying && sh.tgt === p && em.guiado && (dNow < 120 || (closing > 0 && dNow / closing < 1.6))) warn = true;
        // A near miss: the whoosh of it going past.
        if (flying && !sh.pasada && dNow < MS.radioImpacto(em, s.spec.hit) * 3) {
          sh.pasada = true;
          AB.pasada(em.x - p.x, em.y - p.y, Math.hypot(em.vx - p.vx, em.vy - p.vy));
        }
      } else {
        // The player's rockets fly straight where the nose pointed.
        const lk = sh.lock && sh.lock.vivo() ? sh.lock.pos() : null;
        const res = FA.pasoMisil(m, lk, dt, FA.MISIL_JUGADOR, ground, !lk);
        // Out of fuel it keeps flying ballistic and, nose down, dives until it hits something.
        if (res === 'suelo' || m.t > 30 || m.y > CEIL + 400) {
          m.t = -1;
          blast(m.x, Math.max(m.y, ground(m.x)), FA.ENERGIA.misilJugador, 'jugador', 2.5);
          continue;
        }
        for (const c of s.cars) {
          const look = A.VEH_LOOK[c.kind];
          if (Math.abs(m.x - c.x) < look.w / 2 + 2 && m.y > c.y - 2 && m.y < c.y + look.h) {
            m.t = -1;
            blast(m.x, m.y, FA.ENERGIA.misilJugador, 'jugador', 2.5);
            break;
          }
        }
        // …hit an enemy fighter…
        if (m.t >= 0) {
          for (const f of s.fighters) {
            if (CZ.tocado(f, m.x, m.y, 3)) {
              m.t = -1;
              blast(m.x, m.y, FA.ENERGIA.misilJugador, 'jugador', 2.5);
              break;
            }
          }
        }
        // …hit the flying boss…
        if (m.t >= 0 && s.jefe && JF.tocado(s.jefe, m.x, m.y, 3)) {
          m.t = -1;
          blast(m.x, m.y, FA.ENERGIA.misilJugador, 'jugador', 2.5);
        }
        // …hit mice of every size on the ground…
        if (m.t >= 0) {
          for (const u of s.gigantes) {
            if (!u.viva) continue;
            const b = G.caja(u);
            if (m.x > b.x0 && m.x < b.x1 && m.y > b.y0 && m.y < b.y1) {
              m.t = -1;
              giantHit(u, G.golpear(u, m.x, m.y, 2.5));
              blast(m.x, m.y, FA.ENERGIA.misilJugador, 'jugador', 2.5);
              break;
            }
          }
        }
        // …hit flying mice…
        if (m.t >= 0) {
          for (const a of s.aereos) {
            if (a.hp > 0 && Math.hypot(m.x - a.x, m.y - a.y) < AE.radio(a) + 3) {
              m.t = -1;
              blast(m.x, m.y, FA.ENERGIA.misilJugador, 'jugador', 2.5);
              break;
            }
          }
        }
        // …and can shoot enemy missiles down.
        if (m.t >= 0) {
          for (const o of s.shots) {
            if (!o.enemy || o.m.t < 0) continue;
            if (Math.hypot(o.m.x - m.x, o.m.y - m.y) < 14 + MS.MISILES[o.m.tipo].radioChoque) {
              m.t = -1;
              blast(m.x, m.y, FA.ENERGIA.misilJugador, 'jugador', 2.5);
              pop(m.x, m.y + 10, '¡Derribado!', P.gold);
              break;
            }
          }
        }
      }
    }
    // Enemy missiles that run into each other both go off.
    const foes = s.shots.filter((sh): sh is Extract<Shot, { enemy: true }> => sh.enemy && sh.m.t >= 0).map((sh) => sh.m);
    for (const [i, j] of MS.choques(foes)) {
      for (const m of [foes[i], foes[j]]) {
        if (m.t >= 0 && MS.golpear(m)) {
          m.t = -1;
          blast(m.x, m.y, MS.MISILES[m.tipo].energia * 0.6, 'nadie', 0);
        }
      }
      if (s.mode === 'play') {
        s.score += 150;
        pop(foes[i].x, foes[i].y + 12, '¡Choque! +150', P.gold);
      }
    }
    s.shots.push(...born);
    // Trails of missiles that are gone stay behind and fade.
    for (const sh of s.shots) {
      if (sh.m.t < 0 && sh.estela) {
        E.soltar(sh.estela);
        s.estelas.push(sh.estela);
        sh.estela = undefined;
      }
    }
    if (s.estelas.length > 28) s.estelas.splice(0, s.estelas.length - 28);
    for (const e of s.estelas) E.actualizarEstela(e, dt, wind);
    s.estelas = s.estelas.filter(E.viva);
    s.shots = s.shots.filter((sh) => sh.m.t >= 0);
    if (warn) {
      s.warnT -= dt;
      if (s.warnT <= 0) {
        fx('alarma', sfx.warn, { vol: 0.3 });
        s.warnT = 0.6;
      }
    } else s.warnT = 0;
    s.warn = warn;

    // Bombs.
    for (const b of s.bombs) {
      FA.pasoBomba(b, dt, wind);
      let hit = b.y <= ground(b.x);
      for (const c of s.cars) {
        const look = A.VEH_LOOK[c.kind];
        if (Math.abs(b.x - c.x) < look.w / 2 && b.y < c.y + look.h && b.y > c.y) hit = true;
      }
      if (s.jefe && JF.tocado(s.jefe, b.x, b.y, 2)) hit = true;
      // Bombs also catch enemy missiles on their way down.
      for (const o of s.shots) if (o.enemy && o.m.t >= 0 && Math.hypot(o.m.x - b.x, o.m.y - b.y) < 12 + MS.MISILES[o.m.tipo].radioChoque) hit = true;
      for (const u of s.gigantes) {
        if (!u.viva) continue;
        const bx = G.caja(u);
        if (b.x > bx.x0 && b.x < bx.x1 && b.y > bx.y0 && b.y < bx.y1) hit = true;
      }
      if (hit) {
        b.t = -1;
        blast(b.x, Math.max(b.y, ground(b.x)), FA.ENERGIA.bombaJugador, 'jugador', 4);
      }
    }
    s.bombs = s.bombs.filter((b) => b.t >= 0 && b.x > 0 && b.x < LEVEL);
    stepBullets(dt);

    // Flak shells burst when their fuse runs out.
    for (const sh of s.shells) {
      FA.pasoBalistico(sh, dt, FA.ARRASTRE_OBUS, wind);
      sh.t += dt;
      if (sh.t >= sh.fuse || sh.y <= ground(sh.x)) {
        sh.fuse = -1;
        blast(sh.x, sh.y, FA.ENERGIA.obus, 'raton', 1);
      }
    }
    s.shells = s.shells.filter((sh) => sh.fuse >= 0);

    // Flares, smoke, shards, crates.
    for (const f of s.flareBodies) {
      FV.pasoBengala(f, dt, wind);
      f.t += dt;
      if (Math.random() < dt * 20) puff(f.x, f.y, 1, false, 0.5);
    }
    s.flareBodies = s.flareBodies.filter((f) => f.t < 2.6 && f.y > ground(f.x));
    for (const h of s.puffs) {
      FA.pasoHumo(h, dt, wind);
      h.t += dt;
    }
    s.puffs = s.puffs.filter((h) => h.t < h.life);
    for (const e of s.shards) {
      FA.pasoEsquirla(e, dt, ground);
      e.t += dt;
    }
    s.shards = s.shards.filter((e) => e.t < 1.6);
    for (const j of s.junk) {
      FA.pasoBalistico(j, dt, FA.ARRASTRE_OBUS, wind);
      j.t += dt;
      j.spin += dt * 12;
      const d = Math.hypot(j.x - p.x, j.y - p.y);
      if (s.mode === 'play' && !s.dead && d < s.spec.hit + 4) {
        j.fuse = -1;
        hurtPlane(1, j.x, j.y);
        for (let i = 0; i < 6; i++) puff(j.x, j.y, 2, false, 0.6, rand(-30, 30), rand(-30, 30));
      } else if (j.t >= j.fuse) {
        j.fuse = -1;
        blast(j.x, j.y, FA.ENERGIA.obus, 'raton', 1);
      } else if (j.y <= ground(j.x)) {
        j.fuse = -1;
        puff(j.x, j.y + 2, 3, j.kind === 'macetero', 0.8);
      }
    }
    s.junk = s.junk.filter((j) => j.fuse >= 0 && j.t < 8);
    const boss = s.cars.find((c) => c.kind === 'margarita');
    if (s.say) {
      s.say.t += dt;
      if (boss) {
        s.say.x = boss.mid.x;
        s.say.y = boss.y;
      }
      if (s.say.t > 3.2) s.say = null;
    }
    if (boss && s.mode === 'play') {
      s.sayT -= dt;
      if (s.sayT <= 0) {
        let k = Math.floor(Math.random() * SAY.taunts.length);
        if (k === s.lastTaunt) k = (k + 1) % SAY.taunts.length;
        s.lastTaunt = k;
        talk(SAY.taunts[k]);
        s.sayT = rand(3.8, 5.5);
      }
    }

    for (const q of s.prizes) {
      q.t += dt;
      q.vy += (22 - q.vy) * Math.min(1, dt * 2);
      q.x += (q.vx + wind * 0.4 + Math.sin(q.t * 2) * 6) * dt;
      q.y += q.vy * dt;
      if (s.mode === 'play' && !s.dead && Math.hypot(q.x - p.x, q.y + 12 - p.y) < s.spec.hit + 10) {
        q.t = 99;
        catchPrize(q.kind, q.x, q.y);
      }
    }
    s.prizes = s.prizes.filter((q) => q.t < 25 && q.y < CEIL + 100);
    for (const c of s.crates) {
      c.t += dt;
      if (c.landed) c.landed += dt;
      else if (c.vy > 0) {
        c.vy -= FA.GRAVEDAD * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
      } else if (FV.pasoParacaidas(c, dt, wind, ground)) c.landed = 0.001;
      if (s.mode === 'play' && !s.dead && Math.hypot(c.x - p.x, c.y - p.y) < s.spec.hit + 12) {
        c.landed = 99;
        sfx.star();
        S.suena('recoger', { vol: 0.6 });
        if (!repair()) {
          s.score += 200;
          pop(c.x, c.y + 10, '+200');
        }
      }
    }
    s.crates = s.crates.filter((c) => c.landed < 6);
    VFX.actualizar(s.fx, dt, wind, ground);
    for (const q of s.pops) q.t += dt;
    s.pops = s.pops.filter((q) => q.t < 1.3);

    // Camera: leads in the direction of flight, and climbs with the plane
    // once it's above the middle of the screen.
    const lead = Math.cos(p.rumbo) * view.vw * 0.16;
    const want = clamp(p.x - view.vw / 2 + lead, 0, LEVEL - view.vw);
    s.camX += (want - s.camX) * Math.min(1, dt * 3);
    // The ground sits a little above the bottom edge (more on touch screens,
    // where the buttons are), and on tall screens the spare sky is shared out.
    const playH = view.vh - A.DIRT;
    const lift = Math.max(view.touch ? 70 : 14, (playH - (CEIL + 40)) * 0.5);
    // Low down the ground stays in view; higher up the plane is centred.
    const frame = 0.72 - 0.22 * clamp((p.y - 200) / 500, 0, 1);
    const wantY = clamp(p.y - playH * frame, -lift, Math.max(-lift, CEIL + 40 - playH));
    s.camY += (wantY - s.camY) * Math.min(1, dt * 4);
    s.shake = Math.max(0, s.shake - dt * 14);
    s.hurtFlash = Math.max(0, s.hurtFlash - dt);
    s.stolenT = Math.max(0, s.stolenT - dt);
  }

  /* ── Drawing ── */

  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function draw() {
    const { vw, vh } = view;
    const theme = s.themePick === 'auto' ? THEMES[Math.max(0, s.wave - 1) % 3] : s.themePick;
    const shake = still ? 0 : Math.min(9, Math.max(s.shake, VFX.sacudida(s.fx)));
    const shx = shake > 0.3 ? Math.round(rand(-shake, shake)) : 0;
    const shy = shake > 0.3 ? Math.round(rand(-shake, shake)) : 0;
    const cam = clamp(Math.round(s.camX) - shx, 0, LEVEL - vw);
    const sx = (x: number) => Math.round(x - cam);
    const sy = (y: number) => Math.round(toS(y) + shy);

    // The cozy backdrop: sky, clouds, mountains, the village and the woods.
    // The far layers move at half speed when the camera climbs.
    const horizon = Math.round(vh - A.DIRT - 18 + s.camY * 0.5 + shy);
    dibujarFondo(g, { vw, vh, camX: cam, camY: s.camY, horizonte: horizon, t: s.t, ambiente: theme, quieto: still });

    // Ground strip (painted once for the whole level) and the pantry's flag.
    g.drawImage(strip.canvas, cam, 0, vw, strip.canvas.height, 0, sy(strip.top), vw, strip.canvas.height);
    const below = sy(-A.DIRT);
    if (below < vh) A.R(g, 0, below, vw, vh - below, P.e1);
    A.drawFlag(g, sx(PANTRY.x0 + 70), sy(ground(PANTRY.x0 + 70)), s.t);

    const p = s.plane;

    // Vehicles.
    for (const c of s.cars) {
      const x = sx(c.x);
      if (x < -40 || x > vw + 40) continue;
      A.drawVehicle(g, c.kind, x, sy(c.y + c.suspension), -c.angulo, c.wheel, c.aim, s.t, c.flash > 0);
      const life = c.hp / (c.kind === 'margarita' ? s.bossMax : VEH[c.kind].hp);
      if (life < 0.99) A.scorchMarks(g, c.kind, x, sy(c.y + c.suspension), c.id, 1 - life, s.t);
    }

    // Mice building a bridge: they come from the right (the truck's side), so
    // the planks reach out leftwards from the near edge as they work.
    for (const c of s.cars) {
      if (!(c.mem.puente > 0)) continue;
      const k = 1 - c.mem.puente / c.mem.puenteT;
      const x0 = c.mem.px0;
      const x1 = c.mem.px1;
      const done = Math.round(x1 - (x1 - x0) * k);
      const y0 = ground(x0);
      const y1 = ground(x1);
      for (let x = x1; x >= done; x--) A.bridgeColumn(g, sx(x), sy(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)), x0);
      // Two workers: one carrying planks from the truck, one hammering at the edge.
      const trip = (s.t * 0.8 + c.id * 0.37) % 1;
      const carryX = trip < 0.5 ? c.x - (c.x - done) * (trip * 2) : done + (c.x - done) * ((trip - 0.5) * 2);
      A.drawWorker(g, sx(carryX), sy(ground(carryX)), s.t, trip < 0.5, trip < 0.5 ? -1 : 1);
      A.drawWorker(g, sx(done + 3), sy(ground(done + 3) + 2), s.t * 0.3, false, -1);
      if (Math.floor(s.t * 6) % 2) A.R(g, sx(done) - 1, sy(ground(done)) - 4, 2, 1, P.gold);
    }
    for (const u of s.gigantes) {
      if (u.x < s.camX - 160 || u.x > s.camX + vw + 160) continue;
      G.dibujar(g, u, sx, sy, s.t, false);
    }
    for (const c of s.cars) {
      const prize = s.carPrize.get(c.id);
      if (prize) A.drawPrize(g, sx(c.x) + 4, sy(c.y + A.VEH_LOOK[c.kind].h - 2), prize, s.t, false);
    }
    for (const q of s.prizes) A.drawPrize(g, sx(q.x), sy(q.y), q.kind, s.t, true);
    for (const a of s.aereos) {
      const prize = s.airPrize.get(a.id);
      if (prize) A.drawPrize(g, sx(a.x), sy(a.y + 6), prize, s.t, false);
      AE.dibujar(g, a, sx(a.x), sy(a.y), s.t, (s.airFlash.get(a.id) ?? 0) > 0);
      AE.dibujarRayo(g, a, sx(a.x), sy(a.y), s.t);
    }
    for (const f of s.fighters) CZ.dibujar(g, f, sx(f.a.x), sy(f.a.y), s.t);
    if (s.jefe) JF.dibujar(g, s.jefe, sx(s.jefe.x), sy(s.jefe.y), s.t, s.jefeFlash > 0);
    for (const q of s.proy) AE.dibujarProyectil(g, q, sx(q.x), sy(q.y), s.t);

    // Crates, smoke, flares, bombs, shells, missiles.
    for (const c of s.crates) A.drawCrate(g, sx(c.x), sy(c.y), Math.sin(c.t * 2.5), !c.landed && c.vy <= 0);
    for (const h of s.puffs) A.drawPuff(g, sx(h.x), sy(h.y), h.r, h.dark, 1 - h.t / h.life);
    for (const f of s.flareBodies) A.drawFlare(g, sx(f.x), sy(f.y), s.t);
    for (const b of s.bombs) A.drawBomb(g, sx(b.x), sy(b.y), -b.rumbo);
    // Machine-gun tracers: a bright head and a short orange tail.
    for (const b of s.bullets) {
      const v = Math.hypot(b.vx, b.vy) || 1;
      const hx = sx(b.x), hy = sy(b.y);
      for (let i = 1; i <= 3; i++) A.R(g, Math.round(hx - (b.vx / v) * i * 2), Math.round(hy + (b.vy / v) * i * 2), 1, 1, i === 1 ? P.gold : '#ff9a3c');
      A.R(g, hx, hy, 2, 1, P.white);
    }
    for (const sh of s.shells) A.drawShell(g, sx(sh.x), sy(sh.y));
    const tup: [number, number] = [0, 0];
    const toScreen = (x: number, y: number) => {
      tup[0] = x - cam;
      tup[1] = toS(y) + shy;
      return tup;
    };
    for (const e of s.estelas) E.dibujarEstela(g, e, toScreen, s.t);
    for (const sh of s.shots) if (sh.estela) E.dibujarEstela(g, sh.estela, toScreen, s.t);
    for (const sh of s.shots) {
      if (sh.enemy) {
        const F = MS.MISILES[sh.m.tipo];
        A.drawMissile(g, sx(sh.m.x), sy(sh.m.y), -sh.m.rumbo, true, sh.m.combustible > 0, s.t, { ...F.color, largo: F.largo }, sh.m.aviso > 0 && Math.floor(s.t * (8 + sh.m.aviso * 16)) % 2 === 0);
      } else A.drawMissile(g, sx(sh.m.x), sy(sh.m.y), -sh.m.rumbo, false, sh.m.combustible > 0, s.t);
    }

    for (const j of s.junk) A.drawJunk(g, j.kind, sx(j.x), sy(j.y), j.spin);

    // Blasts and shards, then the plane over them so it never gets lost.
    for (const e of s.shards) A.R(g, sx(e.x), sy(e.y), 2, 2, e.c);
    VFX.dibujar(g, s.fx, (x, y) => [sx(x), sy(y)], s.t);
    const blink = s.inv > 0 && Math.floor(s.t * 14) % 2 === 0;
    if (!s.dead) A.drawPlane(g, s.mode === 'demo' ? 'avioneta' : s.spec.id, sx(p.x), sy(p.y), -p.rumbo, p.alabeo, s.t, p.gas, blink, s.mode === 'demo' ? [] : s.lost);
    // The nitro flame: a long flickering jet out of the tail.
    if (s.nitroT > 0 && !s.dead) {
      const ux = Math.cos(p.rumbo), uy = -Math.sin(p.rumbo);
      const bx = sx(p.x) - ux * (s.spec.hit + 2), by = sy(p.y) - uy * (s.spec.hit + 2);
      const len = 14 + Math.floor(Math.random() * 6);
      const cols = [P.white, P.white, '#bfe8ff', P.gold, P.gold, '#ff9a3c', '#ff9a3c', P.red];
      for (let i = 0; i < len; i++) {
        const w = i < 3 ? 3 : i < 9 ? 2 : 1;
        A.R(g, Math.round(bx - ux * i - w / 2), Math.round(by - uy * i - w / 2), w, w, cols[Math.min(cols.length - 1, Math.floor((i / len) * cols.length))]);
      }
    }
    if (s.say) A.drawBubble(g, sx(s.say.x), sy(s.say.y + 60), s.say.text, vw);

    // A red flash when the plane is hit.
    if (s.hurtFlash > 0) {
      g.globalAlpha = Math.round(s.hurtFlash * 4) / 4 * (still ? 0.2 : 0.6);
      g.fillStyle = '#ff4a5a';
      g.fillRect(0, 0, vw, vh);
      g.globalAlpha = 1;
    }
    // White flash for big blasts.
    const flash = VFX.destello(s.fx);
    if (flash > 0) {
      g.globalAlpha = still ? flash * 0.3 : flash;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, vw, vh);
      g.globalAlpha = 1;
    }

    // Floating score text.
    g.font = 'bold 9px "Fredoka", "Nunito", sans-serif';
    g.textAlign = 'center';
    for (const q of s.pops) {
      const x = clamp(sx(q.x), 40, vw - 40);
      const y = sy(q.y + q.t * 18);
      g.fillStyle = '#3a2a6a';
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillText(q.text, x + dx, y + dy);
      g.fillStyle = q.c;
      g.fillText(q.text, x, y);
    }

    // Missile warnings at the edge of the screen.
    if (s.mode === 'play' && !s.dead && Math.floor(s.t * 8) % 2) {
      for (const sh of s.shots) {
        if (!sh.enemy || sh.tgt !== p) continue;
        const x = sx(sh.m.x);
        const y = sy(sh.m.y);
        if (x >= 0 && x < vw && y >= 0 && y < vh) continue;
        const cx = clamp(x, 6, vw - 7);
        const cy = clamp(y, 30, vh - A.DIRT - 6);
        D.disc(g, cx, cy, 4, P.red0);
        D.disc(g, cx, cy, 3, P.red);
        A.R(g, cx, cy - 2, 1, 3, P.white);
        A.R(g, cx, cy + 2, 1, 1, P.white);
      }
    }

    // Flyers hidden behind the HUD pills get a pink marker just below them.
    if (s.mode === 'play' && !s.dead) {
      const band = Math.ceil(56 / view.s);
      for (const a of s.aereos) {
        const x = sx(a.x);
        const y = sy(a.y);
        if (x < 4 || x > vw - 4 || y > band || y < -40) continue;
        const k = Math.floor(s.t * 6) % 2;
        for (let i = 0; i < 4; i++) A.R(g, x - 3 + i, band + 2 + i + k, 7 - 2 * i, 1, i ? P.p1 : '#3a2a6a');
      }
    }

    // Lock-on reticle: brackets close in on the target, red and blinking once locked.
    if (s.mode === 'play' && !s.dead && s.lockCand && s.lockT > 0.1 && s.lockCand.vivo()) {
      const q = s.lockCand.pos();
      const cx = sx(q.x), cy = sy(q.y);
      const k = Math.min(1, s.lockT / LOCK_TIME);
      const locked = k >= 1;
      if (!locked || Math.floor(s.t * 8) % 2) {
        const r = Math.round(s.lockCand.r + 6 + (1 - k) * 14);
        const col = locked ? P.red : P.gold;
        for (const [ux, uy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          A.R(g, cx + ux * r - (ux > 0 ? 3 : 0), cy + uy * r - (uy > 0 ? 0 : 0), 4, 1, col);
          A.R(g, cx + ux * r - (ux > 0 ? 0 : 0), cy + uy * r - (uy > 0 ? 3 : 0), 1, 4, col);
        }
        if (locked) {
          g.font = 'bold 7px "Fredoka", "Nunito", sans-serif';
          g.textAlign = 'center';
          g.fillStyle = P.red;
          g.fillText('FIJADO', cx, cy - r - 3);
        }
      }
    }

    // No enemy in view: an arrow at the edge points to the nearest one, with the distance.
    if (s.mode === 'play' && !s.dead) {
      const seen = (x: number, y: number) => sx(x) >= 0 && sx(x) < vw && sy(y) >= 0 && sy(y) < vh;
      const foes: { x: number; y: number }[] = [...s.cars, ...s.aereos, ...s.gigantes.filter((u) => u.viva), ...s.fighters.map((f) => f.a)];
      if (s.jefe) foes.push(s.jefe);
      if (foes.length && !foes.some((f) => seen(f.x, f.y))) {
        let best = foes[0];
        for (const f of foes) if (Math.hypot(f.x - p.x, f.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = f;
        const right = best.x > p.x;
        const ax = right ? vw - 22 : 14;
        // On phones the weapon buttons cover the lower right: keep the arrow above them.
        const ay = clamp(sy(best.y), 40, view.touch ? Math.round(vh * 0.55) : vh - A.DIRT - 22);
        const bob = Math.round(Math.sin(s.t * 6) * 2) * (right ? 1 : -1);
        g.globalAlpha = 0.9;
        A.R(g, ax - 9 + bob, ay - 5, 18, 10, '#3a2a6a');
        g.globalAlpha = 1;
        for (let i = 0; i < 4; i++) A.R(g, ax + bob + (right ? 3 + i : -3 - i), ay - 3 + i, 1, 7 - 2 * i, P.p1);
        A.R(g, ax - 6 + bob + (right ? 0 : 6), ay - 1, 6, 2, P.p1);
        g.font = 'bold 7px "Fredoka", "Nunito", sans-serif';
        g.textAlign = right ? 'right' : 'left';
        g.fillStyle = '#fff8e7';
        g.fillText(`${Math.round(Math.hypot(best.x - p.x, best.y - p.y) * 3.5)} m`, right ? ax - 11 : ax + 11, ay + 3);
        g.textAlign = 'center';
      }
    }

    // The boss bar sits below the HUD pills.
    if (s.jefe) {
      const bw = Math.min(170, vw - 40);
      JF.dibujarBarra(g, s.jefe, Math.round((vw - bw) / 2), Math.ceil(64 / view.s) + 4, bw, s.t);
    }

    // Altimeter along the right edge: the plane and the missiles after it.
    if (s.mode === 'play') {
      const ax = vw - 6;
      const top = 30;
      const bot = vh - A.DIRT - 6;
      const altY = (alt: number) => Math.round(bot - (clamp(alt, 0, CEIL) / CEIL) * (bot - top));
      g.globalAlpha = 0.5;
      A.R(g, ax - 1, top - 1, 4, bot - top + 2, '#3a2a6a');
      g.globalAlpha = 1;
      for (const z of [500, 1300, 1900]) A.R(g, ax - 2, altY(z), 6, 1, 'rgba(255,255,255,0.5)');
      for (const sh of s.shots) if (sh.enemy && sh.tgt === p) A.R(g, ax, altY(sh.m.y), 2, 1, P.red);
      for (const a of s.aereos) A.R(g, ax, altY(a.y), 2, 1, P.p0);
      A.R(g, ax - 2, altY(p.y) - 1, 6, 3, P.gold);
    }

    // Minimap along the bottom: the whole valley side-on, with the terrain,
    // the pantry, every enemy at its height, missiles, the plane and the view.
    {
      const H = 13;
      const rx = 8;
      const rw = vw - 24;
      const top = vh - H - 3;
      const at = (x: number) => rx + Math.round((x / LEVEL) * rw);
      // Height on a square-root scale: the low sky, where the fight is, gets more room.
      const ht = (alt: number) => top + H - 1 - Math.round(Math.sqrt(clamp(alt, 0, CEIL) / CEIL) * (H - 2));
      g.globalAlpha = 0.72;
      A.R(g, rx - 2, top - 2, rw + 4, H + 4, '#3a2a6a');
      g.globalAlpha = 1;
      A.R(g, rx - 1, top - 1, rw + 2, H + 2, '#262048');
      for (const z of [500, 1300, 1900]) A.R(g, rx, ht(z), rw, 1, 'rgba(255,255,255,0.08)');
      // Terrain silhouette, sampled once per column.
      for (let c = 0; c < rw; c++) {
        const gy = ht(Math.max(0, ground(((c + 0.5) / rw) * LEVEL)));
        A.R(g, rx + c, gy, 1, top + H - gy, '#4f8a5a');
        A.R(g, rx + c, gy, 1, 1, '#8fd48a');
      }
      // The view the camera shows.
      const v0 = at(s.camX);
      const vwid = Math.max(3, Math.round((vw / LEVEL) * rw));
      const vt = ht(s.camY - A.DIRT + vh);
      const vb = ht(Math.max(0, s.camY - A.DIRT));
      g.globalAlpha = 0.18;
      A.R(g, v0, vt, vwid, Math.max(2, vb - vt + 1), '#ffffff');
      g.globalAlpha = 0.6;
      A.R(g, v0, vt, vwid, 1, '#ffffff');
      A.R(g, v0, vb, vwid, 1, '#ffffff');
      A.R(g, v0, vt, 1, vb - vt + 1, '#ffffff');
      A.R(g, v0 + vwid - 1, vt, 1, vb - vt + 1, '#ffffff');
      g.globalAlpha = 1;
      // The pantry, with its fish left.
      const px0 = at(PANTRY.x0);
      A.R(g, px0, ht(ground(PANTRY.x0)) - 3, 4, 3, P.b2);
      for (let i = 0; i < s.meta; i++) A.R(g, px0 + 5 + i * 2, ht(ground(PANTRY.x0)) - 2, 1, 1, '#9ad8ff');
      // Enemies: ground ones lilac, flyers pink, big ones and bosses bigger.
      const blink = Math.floor(s.t * 4) % 2 === 0;
      for (const c of s.cars) A.R(g, at(c.x) - 1, ht(c.y) - 2, c.kind === 'margarita' ? 4 : 2, c.kind === 'margarita' ? 3 : 2, c.kind === 'margarita' ? (blink ? P.red : P.r3) : '#c9b4ff');
      for (const u of s.gigantes) if (u.viva) A.R(g, at(u.x) - 1, ht(u.y) - 2, u.tipo === 'tren' || u.tipo === 'ratonzilla' ? 4 : 1, 2, P.r2);
      for (const a of s.aereos) A.R(g, at(a.x), ht(a.y), 2, 1, P.p1);
      for (const f of s.fighters) A.R(g, at(f.a.x) - 1, ht(f.a.y) - 1, 3, 2, '#ff6ad5');
      if (s.jefe) {
        const jx = at(s.jefe.x) - 2;
        const jy = ht(s.jefe.y) - 1;
        A.R(g, jx, jy, 5, 3, blink ? P.red : P.gold);
      }
      for (const q of s.prizes) A.R(g, at(q.x), ht(q.y), 1, 1, P.gold1);
      for (const sh of s.shots) if (sh.enemy && sh.m.t >= 0) A.R(g, at(sh.m.x), ht(sh.m.y), 1, 1, sh.tgt === p ? P.red : '#ff9a3c');
      // The plane: a little arrow showing where it heads.
      const ppx = at(p.x);
      const ppy = ht(p.y);
      const dir = Math.cos(p.rumbo) >= 0 ? 1 : -1;
      A.R(g, ppx - 1, ppy - 1, 3, 3, '#3a2a6a');
      A.R(g, ppx - 1, ppy, 3, 1, P.gold);
      A.R(g, ppx + dir, ppy - 1, 1, 3, P.gold);
    }
  }

  /* ── HUD ── */

  function hud() {
    const h: Hud = {
      score: s.score,
      best: s.best,
      wave: s.wave,
      stolen: s.stolenT > 0,
      hp: s.hp,
      hpMax: s.spec.hp,
      lives: s.lives,
      lost: s.lost.map((q) => PART_NAME[q]),
      meta: s.meta,
      metaMax: META_MAX,
      ammo: s.ammo,
      heat: Math.round(s.heat * 20) / 20,
      hot: s.hot,
      nitro: s.nitroT > 0 ? 'activo' : s.nitroCd > 0 ? 'carga' : 'listo',
      nitroK: s.nitroCd > 0 ? Math.round((1 - s.nitroCd / NITRO_CD) * 20) / 20 : 1,
      rack: s.cap.misil,
      flares: s.flares,
      flareMax: s.cap.bengala,
      bombs: s.bombAmmo,
      bombMax: s.cap.bomba,
      left: (s.jefe ? 1 : 0) + s.queue.length + s.cars.length + s.aereos.length + s.airQueue.length + s.bigQueue.length + s.gigantes.filter((u) => u.viva).length,
      wind: Math.round(FV.viento(s.t, s.plane.x, s.plane.y)),
      altitude: Math.round((s.plane.y * FV.ESCALA.metrosPorPx) / 50) * 50,
      sky: s.themePick,
      zone: nombreZona(zonaAltitud(s.plane.y)),
      warn: s.warn,
      stall: s.mode === 'play' && !s.dead && s.stallT > 0 && s.inv <= 0,
      zoom: [view.levels.length, view.zi],
      throttle: Math.sign(input.gas),
      boss: (() => {
        const b = s.cars.find((c) => c.kind === 'margarita');
        return b ? { name: 'Vecina Margarita', hp: clamp(Math.round((b.hp / s.bossMax) * 100) / 100, 0, 1) } : null;
      })(),
      banner: s.mode === 'play' ? s.banner : '',
    };
    const key = JSON.stringify(h);
    if (key !== s.hudKey) {
      s.hudKey = key;
      hooks.onHud(h);
    }
  }

  /* ── Keyboard ── */

  const CODES: Record<string, string> = {
    ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd',
    Space: 'fire', KeyJ: 'fire', KeyK: 'bomb', KeyL: 'flare', KeyH: 'gun', KeyF: 'gun',
    KeyE: 'acc', ShiftLeft: 'acc', ShiftRight: 'acc', KeyQ: 'brake', ControlLeft: 'brake', ControlRight: 'brake', KeyZ: 'zoom',
  };
  const touch = { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false, gun: false };
  /** Touch turning: +1 counterclockwise (left half held), -1 clockwise (right half), 0 none. */
  let turn = 0;
  function syncInput() {
    const kx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
    const ky = (keys.has('u') ? 1 : 0) - (keys.has('d') ? 1 : 0);
    input.x = kx || touch.x;
    input.y = ky || touch.y;
    input.gas = (keys.has('acc') ? 1 : 0) - (keys.has('brake') ? 1 : 0) || touch.gas;
    input.fire = keys.has('fire') || touch.fire;
    input.bomb = keys.has('bomb') || touch.bomb;
    input.flare = keys.has('flare') || touch.flare;
    input.gun = keys.has('gun') || touch.gun;
  }
  const onKey = (e: KeyboardEvent) => {
    const k = CODES[e.code];
    if (!k || s.mode !== 'play') return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    e.preventDefault();
    if (k === 'zoom') {
      if (e.type === 'keydown' && !e.repeat) zoom();
      return;
    }
    if (e.type === 'keydown' && !e.repeat && k === 'acc') tapAccel();
    if (e.type === 'keydown') keys.add(k);
    else keys.delete(k);
    syncInput();
  };
  /** Two taps on accelerate in quick succession fire the super nitro. */
  let lastAcc = -1e9;
  function tapAccel() {
    const now = performance.now();
    if (now - lastAcc < 350 && startNitro()) {
      lastAcc = -1e9;
      return;
    }
    lastAcc = now;
  }
  /** Fires the super nitro if it's charged; false if it isn't. */
  function startNitro() {
    if (s.nitroT > 0 || s.nitroCd > 0 || s.mode !== 'play' || s.dead) return false;
    s.nitroT = NITRO_T;
    s.nitroCd = NITRO_CD;
    pop(s.plane.x, s.plane.y + 18, '¡SUPER NITRO!', '#7ad8ff');
    fx('misil', sfx.launch, { vol: 0.6, rate: 0.6, dur: 0.9 });
    return true;
  }
  const onHide = () => {
    if (document.visibilityState === 'hidden') save();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', save);
  const onBlur = () => {
    keys.clear();
    syncInput();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);

  /** Steps the zoom: +1 out, -1 in, 0 cycles through every level. */
  function zoom(dir = 0) {
    const n = view.levels.length;
    view.zi = dir === 0 ? (view.zi + 1) % n : clamp(view.zi + dir, 0, n - 1);
    fit();
    s.hudKey = '';
  }
  const onWheel = (e: WheelEvent) => {
    if (s.mode !== 'play' || Math.abs(e.deltaY) < 4) return;
    zoom(e.deltaY > 0 ? 1 : -1);
  };
  box.addEventListener('wheel', onWheel, { passive: true });

  /* ── Loop ── */

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (s.hitStop > 0) {
      // Hit-stop: a quarter-speed blink after a kill.
      s.hitStop -= dt;
      dt *= 0.25;
    }
    if (!s.paused) {
      s.comboT = Math.max(0, s.comboT - dt);
      // Small fixed-ish substeps keep fast missiles from tunnelling.
      const n = Math.ceil(dt / (1 / 120));
      dt /= n;
      for (let i = 0; i < n; i++) step(dt);
    }
    draw();
    // Build the other skies ahead of time while nobody is flying.
    if (s.mode !== 'play' || s.paused) precalentarFondo(4);
    s.hudT -= dt;
    if (s.hudT <= 0) {
      s.hudT = 0.08;
      hud();
      engines();
      s.saveT -= 0.08;
      if (s.saveT <= 0) {
        s.saveT = 5;
        save();
      }
    }
  };
  raf = requestAnimationFrame(frame);

  if (import.meta.env.DEV) (window as unknown as { __vuelo: unknown }).__vuelo = { s, input, view, JF };

  return {
    start,
    demo,
    /** Touch controls write here; the keyboard is merged in. */
    /** Super nitro from a double tap on the sky (phones). */
    nitro() {
      return startNitro();
    },
    touch(t: Partial<typeof touch>) {
      if (t.gas === 1 && touch.gas !== 1) tapAccel();
      Object.assign(touch, t);
      syncInput();
    },
    setPaused(p: boolean) {
      s.paused = p;
      if (p) AB.detener();
      if (p) S.callar();
      if (p) onBlur();
    },
    destroy() {
      cancelAnimationFrame(raf);
      save();
      S.pararMotores();
      AB.detener();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      box.removeEventListener('wheel', onWheel);
    },
    zoom,
    /** Cycles the sky: auto → día → tarde → noche. */
    cycleSky() {
      const order: (Theme | 'auto')[] = ['auto', 'dia', 'tarde', 'noche'];
      s.themePick = order[(order.indexOf(s.themePick) + 1) % order.length];
      s.hudKey = '';
    },
    /** Touch screens lift the ground above the on-screen buttons. */
    /** Touch turning: +1 turns the nose counterclockwise, -1 clockwise, 0 lets go. */
    steer(dir: number) {
      turn = Math.sign(dir);
      if (!turn) {
        touch.x = touch.y = 0;
        syncInput();
      }
    },
    setTouch(t: boolean) {
      view.touch = t;
    },
  };
}

export { A as dibujo };
