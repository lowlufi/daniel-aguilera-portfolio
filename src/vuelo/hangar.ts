/**
 * The hangar: every plane the pilots can fly, each with its own real-world
 * weapons (missile, gun, decoys and default bomb load), the bomb types, and
 * what unlocks them. Unlocks are kept across games in localStorage.
 */
import * as FA from './fisica-armas';
import type { MissileLook, Parte } from './dibujo';
import type { EstiloEstela } from './estelas';
import type { BombaTipo, ModeloAvion, Piloto } from './fisica-tipos';
import { CASA } from './pilotos';

const G = FA.GRAVEDAD;

/**
 * How a missile body is drawn: the home planes' toy rocket, a slim air-to-air
 * missile (with canards up front for the dogfight ones), a fat long-range or
 * air-to-ground one, the WWII rockets (RP-3 with its fat warhead, HVAR, the
 * huge Tiny Tim) and the cruise missile with its pop-out wings.
 */
export type FormaMisil = 'casero' | 'aam' | 'canard' | 'pesado' | 'rp3' | 'hvar' | 'tinytim' | 'crucero' | FormaNueva;
/**
 * The second batch (armas-dibujo.ts, drawMisilExtra): the practice and Hydra
 * rockets, the WGr 21 mortar tube, the 5-inch Zuni, Python 5 with its double
 * fins, MICA's long strakes, IRIS-T, Meteor with its ramjet scoops, the squat
 * Brimstone, the tiny R-60, the Super 530D, the faceted JSM and a firework.
 */
export type FormaNueva = 'mini' | 'wgr21' | 'zuni' | 'python' | 'mica' | 'iris' | 'meteor' | 'brimstone' | 'r60' | 's530' | 'jsm' | 'fuegos';
export type LookMisil = MissileLook & { forma: FormaMisil };

/** Launch sound: the sample, the saucer's orb, the B-2's drop, or a synthesized one per family. */
export type SonidoMisil = 'misil' | 'orbe' | 'crucero' | 'aam' | 'amraam' | 'cohete' | 'tinytim' | 'maverick' | SonidoMisilNuevo;
/** Launches of the second batch (audio-batalla.ts, «arsenal»): ramjet, ripple, Zuni, Hydra pod, firework, mortar tube. */
export type SonidoMisilNuevo = 'ramjet' | 'ripple' | 'zuni' | 'hydra' | 'fuegos' | 'mortero';

export type KitMisil = {
  nombre: string;
  /** One line for the hangar card: what it looks and sounds like. */
  nota: string;
  opts: Required<FA.OpcionesMisil>;
  /** Blast energy and damage on impact. */
  energia: number;
  dano: number;
  /** Seconds between launches. */
  cadencia: number;
  /** Drawn as a missile with this look, or as the saucer's plasma orb. */
  look: LookMisil | 'orbe';
  sonido: SonidoMisil;
  /** Pitch of its launch sound (playback rate, 1 = as baked). */
  tono?: number;
  /** Its own trail: smoke and flame colours, thickness, sparkle and sway. */
  estela: EstiloEstela;
  /**
   * An unguided rocket (WWII): never homes, wobbles on its motor and goes out
   * `salva` at a time, one from under each wing.
   */
  cohete?: { bamboleo: number; salva: number };
  /** A modern missile with its own seeker: finds a target ahead by itself (fire-and-forget). */
  buscador?: boolean;
  /** A guided ripple (Brimstone): this many leave together, each finding its own target. */
  salva?: number;
  /** Fireworks: each one leaves with one of these trails, picked at random. */
  estelas?: EstiloEstela[];
};

/**
 * The look of a gun's rounds and its firing: tracer head size and tail,
 * colours (hot head → tail), how many rounds are tracers, muzzle flash, hit
 * sparks, spread, barrels and spent cases.
 */
export type Trazadora = {
  /** Head size, px: 1 rifle bullet … 3 a 30 mm shell. */
  cabeza: 1 | 2 | 3;
  /** Tail: number of steps and px per step. */
  cola: number;
  paso: number;
  /** Tail width, px (1 thin, 2 thick). */
  grosor: 1 | 2;
  /** Hot head, middle and end of the tail. */
  c1: string;
  c2: string;
  c3: string;
  /** Every n-th round is a bright tracer; the rest are short dim streaks (1 = all tracers). */
  cada: number;
  /** Muzzle flash radius, px, and its colour. */
  boca: number;
  fogonazo: string;
  /** Hit: 0.6 a light ping … 2 a 30 mm shell bursting. */
  impacto: number;
  /** Random spread, radians. */
  dispersion: number;
  /** Side-by-side barrels (wing guns, twin turret): px either side of the nose, alternating. 0 = one in the nose. */
  ancho: number;
  /** Spent cases tumbling down. */
  casquillos?: boolean;
  /** Gun smoke at the muzzle (the A-10's grey cloud). */
  humo?: boolean;
};

export type SonidoMetralla = 'metralla' | 'rifle' | 'browning' | 'vulcan' | 'canon30' | 'gau8' | 'laser' | SonidoMetrallaNueva;
/** Guns of the second batch: minigun buzz, the big pom-pom (37–57 mm), revolver cannon, Hispano thump, the box's bean-shooter. */
export type SonidoMetrallaNueva = 'minigun' | 'pompom' | 'revolver' | 'hispano' | 'porotos';

export type KitMetralla = {
  nombre: string;
  nota: string;
  /** Muzzle speed px/s, seconds between shots, damage per hit (1 = the home planes' gun), heat per shot. */
  vel: number;
  cad: number;
  dano: number;
  calor: number;
  /** Gravity on the rounds, in g (0 = a laser). */
  gravedad: number;
  color: 'oro' | 'blanco' | 'laser';
  sonido: SonidoMetralla;
  /** Pitch of its shots (playback rate). */
  tono?: number;
  traza: Trazadora;
};

export type BengalaTipo = 'magnesio' | 'trampa' | 'holograma' | 'chaff';
export type KitBengala = {
  nombre: string;
  tipo: BengalaTipo;
  /** Decoys per salvo, and how many looks each seeker gets at each decoy (more = more convincing). */
  n: number;
  intentos: number;
};

export type Kit = { misil: KitMisil; metralla: KitMetralla | null; bengala: KitBengala };

/** What unlocks it: reaching a wave, saucers downed, enemies downed in total, or missions done (all kept across games). */
export type Desbloqueo = { tipo: 'oleada' | 'ovnis' | 'derribos' | 'misiones'; n: number; texto: string };

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
  kit: Kit;
  /** The bomb it carries unless the player picks another one. */
  bomba: BombaTipo;
  /** Stealth 0…1: the chance an enemy seeker never finds it. */
  sigilo: number;
  /** Real-world name shown in the hangar. */
  real?: string;
  desbloqueo?: Desbloqueo;
};

const misil = (o: Partial<FA.OpcionesMisil>): Required<FA.OpcionesMisil> => {
  const r = { ...FA.MISIL_JUGADOR, ...o };
  // Terminal speed stays vMax unless a drag is given.
  if (o.arrastre === undefined) r.arrastre = r.empuje / (r.vMax * r.vMax);
  return r;
};

/* ── Trails: every missile family leaves its own (colourful, sparkly, wavy) ── */

const E_MOSTAZA: EstiloEstela = { nucleo: '#fff6b0', brillo: '#ffc21a', humo: '#ffe680', ancho: 10, largo: 32, chispas: 44, ondula: 1.8 };
const E_MANDARINA: EstiloEstela = { nucleo: '#fff0c0', brillo: '#ff7a1a', humo: '#ffc8a0', ancho: 10, largo: 34, chispas: 48, ondula: 1.6 };
const E_NUBE: EstiloEstela = { nucleo: '#fff0f8', brillo: '#ff7ab4', humo: '#f4eeff', ancho: 13, largo: 32, chispas: 36, ondula: 2.3 };
/** AIM-120: clean, long, white-turquoise low-smoke plume. */
const E_AMRAAM: EstiloEstela = { nucleo: '#ffffff', brillo: '#3ad8c8', humo: '#e4fff8', ancho: 8, largo: 40, chispas: 46, ondula: 1.5, fuego: 1.25 };
/** Sidewinder: yellow-white flame and the snakiest trail of all. */
const E_SIDEWINDER: EstiloEstela = { nucleo: '#ffffff', brillo: '#ffe030', humo: '#fff6d0', ancho: 8, largo: 36, chispas: 64, ondula: 3 };
/** Vympel R-74 / R-73: red and crimson flames. */
const E_R74: EstiloEstela = { nucleo: '#fff0d0', brillo: '#ff4a2a', humo: '#ffd6c8', ancho: 9, largo: 34, chispas: 54, ondula: 2.2 };
const E_R73: EstiloEstela = { nucleo: '#ffe8f0', brillo: '#ff2a6a', humo: '#ffd0e4', ancho: 9, largo: 34, chispas: 54, ondula: 2.2 };
/** Phoenix: a big fat orange plume, long. */
const E_PHOENIX: EstiloEstela = { nucleo: '#fff4c0', brillo: '#ff8a2a', humo: '#ffe0c0', ancho: 13, largo: 44, chispas: 52, ondula: 1.8, fuego: 1.4 };
/** Maverick: heavy grey-brown smoke, amber flame. */
const E_MAVERICK: EstiloEstela = { nucleo: '#fff0b0', brillo: '#ffa020', humo: '#d8ccb8', ancho: 12, largo: 36, chispas: 44, ondula: 1.8 };
/** Cruise missile: a blue turbojet flame and a long thin vapour line. */
const E_CRUCERO: EstiloEstela = { nucleo: '#e8f4ff', brillo: '#6a9aff', humo: '#dce0f4', ancho: 7, largo: 46, chispas: 30, ondula: 1.6, fuego: 0.6 };
/** WWII rockets: thick dirty cordite smoke, crackling sparks, a long ragged flame. */
const E_RP3: EstiloEstela = { nucleo: '#ffe890', brillo: '#ff6a1a', humo: '#aca49a', ancho: 14, largo: 36, chispas: 76, ondula: 2.6, fuego: 1.5 };
const E_HVAR: EstiloEstela = { nucleo: '#fff0a0', brillo: '#ff9a20', humo: '#c4bcac', ancho: 12, largo: 36, chispas: 70, ondula: 2.4, fuego: 1.4 };
const E_STUKA: EstiloEstela = { nucleo: '#ffe0a0', brillo: '#ff4a20', humo: '#b4aca8', ancho: 13, largo: 34, chispas: 72, ondula: 2.6, fuego: 1.4 };
const E_TINYTIM: EstiloEstela = { nucleo: '#fff4b0', brillo: '#ff7a10', humo: '#8e8884', ancho: 16, largo: 40, chispas: 90, ondula: 2.8, fuego: 1.8 };
/** Plasma orb: violet and cyan sparkle. */
const E_ORBE: EstiloEstela = { nucleo: '#c8fff8', brillo: '#9a5aff', humo: '#dccaff', ancho: 10, largo: 34, chispas: 72, ondula: 3 };

const BASE_MISIL: KitMisil = {
  nombre: 'Misil casero', nota: 'Humo dorado y chispas', opts: FA.MISIL_JUGADOR, energia: FA.ENERGIA.misilJugador, dano: 2.5, cadencia: 0.22,
  look: { cuerpo: '#e8e0d0', punta: '#ff4a5a', aletas: '#7a6a8a', largo: 11, forma: 'casero' }, sonido: 'misil', estela: E_MOSTAZA,
};
/** WWII rockets: unguided, a pair at a time (one under each wing), wobbling on their motors. */
const COHETE = { bamboleo: 0.5, salva: 2 };

/* ── Guns: tracers, flash and hits per real weapon ── */

/** The home planes' gun: the old gold-to-red tracers. */
const T_CASA: Trazadora = { cabeza: 2, cola: 7, paso: 1.6, grosor: 2, c1: '#fff4a0', c2: '#ffc83a', c3: '#ff4a3c', cada: 1, boca: 3, fogonazo: '#ffe48a', impacto: 1, dispersion: 0.035, ancho: 0 };
/** .50 in the nose: orange, every 2nd round a long bright tracer. */
const T_50_CASA: Trazadora = { cabeza: 2, cola: 8, paso: 1.8, grosor: 2, c1: '#ffffff', c2: '#ffa030', c3: '#ff5a1a', cada: 2, boca: 4, fogonazo: '#ffd070', impacto: 1.2, dispersion: 0.03, ancho: 0 };
/** Twin .50 turret: red tracers in two streams. */
const T_TORRETA: Trazadora = { cabeza: 2, cola: 7, paso: 1.8, grosor: 2, c1: '#ffe0e0', c2: '#ff4a4a', c3: '#b01a3a', cada: 2, boca: 4, fogonazo: '#ffb070', impacto: 1.2, dispersion: 0.05, ancho: 3 };
/** M61 Vulcan 20 mm: a dense white-hot stream, long thin streaks. */
const T_VULCAN: Trazadora = { cabeza: 1, cola: 16, paso: 1.6, grosor: 1, c1: '#ffffff', c2: '#d8ecff', c3: '#7aa8ff', cada: 1, boca: 4, fogonazo: '#e8f4ff', impacto: 1, dispersion: 0.03, ancho: 0 };
/** GSh-30: big slow orange shells. */
const T_GSH30: Trazadora = { cabeza: 3, cola: 6, paso: 2, grosor: 2, c1: '#ffffff', c2: '#ff9a20', c3: '#e0401a', cada: 1, boca: 6, fogonazo: '#ffb040', impacto: 2, dispersion: 0.02, ancho: 0, casquillos: true };
/** GAU-8 Avenger: a hose of fat red-orange shells and a cloud of gun smoke. */
const T_GAU8: Trazadora = { cabeza: 3, cola: 7, paso: 1.9, grosor: 2, c1: '#fff0c0', c2: '#ff6a1a', c3: '#c8201a', cada: 1, boca: 7, fogonazo: '#ffa030', impacto: 2, dispersion: 0.06, ancho: 0, casquillos: true, humo: true };
/** .303 Browning: thin pale-yellow lines from the wings. */
const T_303: Trazadora = { cabeza: 1, cola: 7, paso: 1.5, grosor: 1, c1: '#ffffe0', c2: '#fff070', c3: '#e8c030', cada: 1, boca: 2, fogonazo: '#fff0a0', impacto: 0.6, dispersion: 0.05, ancho: 5 };
/** MG 17: thin amber-red tracers. */
const T_MG17: Trazadora = { cabeza: 1, cola: 6, paso: 1.5, grosor: 1, c1: '#fff0c0', c2: '#ffb060', c3: '#e04a2a', cada: 1, boca: 2, fogonazo: '#ffd090', impacto: 0.6, dispersion: 0.04, ancho: 4 };
/** Six .50s in the wings: every 5th round a long orange tracer, the rest brass glints. */
const T_50_ALAS: Trazadora = { cabeza: 2, cola: 10, paso: 1.8, grosor: 2, c1: '#ffffff', c2: '#ffb040', c3: '#ff5a1a', cada: 5, boca: 3, fogonazo: '#ffd070', impacto: 1.2, dispersion: 0.04, ancho: 5, casquillos: true };
const T_LASER: Trazadora = { cabeza: 1, cola: 10, paso: 1, grosor: 1, c1: '#ffffff', c2: '#8af4ff', c3: '#3ad8ff', cada: 1, boca: 3, fogonazo: '#7af0ff', impacto: 0.8, dispersion: 0.01, ancho: 0 };

const BASE_METRALLA: KitMetralla = {
  nombre: 'Ametralladora', nota: 'Trazadoras doradas, tac-tac', vel: 680, cad: 0.075, dano: 1, calor: 0.045, gravedad: 0.06, color: 'oro', sonido: 'metralla', traza: T_CASA,
};
const VULCAN: KitMetralla = {
  nombre: 'M61 Vulcan 20 mm', nota: 'Chorro blanco denso, «brrrt» rotatorio', vel: 780, cad: 0.045, dano: 0.8, calor: 0.03, gravedad: 0.05, color: 'blanco', sonido: 'vulcan', traza: T_VULCAN,
};
const BROWNING_ALAS: KitMetralla = {
  nombre: '6 ametralladoras .50', nota: 'Trazadora naranja cada cinco, golpe pesado', vel: 700, cad: 0.045, dano: 0.75, calor: 0.03, gravedad: 0.07, color: 'oro', sonido: 'browning', traza: T_50_ALAS,
};
const MAGNESIO: KitBengala = { nombre: 'Bengalas de magnesio', tipo: 'magnesio', n: 3, intentos: 1 };


/* ── The second batch: trails, tracers and kits ── */

/** Practice rockets: thin white smoke, a few pale sparks. */
const E_PRACTICA: EstiloEstela = { nucleo: '#ffffff', brillo: '#ffb0a0', humo: '#ffffff', ancho: 7, largo: 26, chispas: 30, ondula: 2.2, fuego: 0.9 };
/** Hydra 70: a fizzing pink-orange flame and thin grey smoke. */
const E_HYDRA: EstiloEstela = { nucleo: '#fff0d0', brillo: '#ff6a4a', humo: '#d8d0cc', ancho: 7, largo: 24, chispas: 50, ondula: 2.4, fuego: 1.1 };
/** Japanese Type 3 rockets: a green-gold flame and khaki smoke. */
const E_TIPO3: EstiloEstela = { nucleo: '#f8ffc0', brillo: '#c8d83a', humo: '#d8d4b0', ancho: 11, largo: 32, chispas: 64, ondula: 2.4, fuego: 1.3 };
/** WGr 21 mortar tube: a short fat lump of flame and black-brown smoke. */
const E_WGR21: EstiloEstela = { nucleo: '#ffe0a0', brillo: '#ff5a1a', humo: '#7a6a62', ancho: 15, largo: 30, chispas: 80, ondula: 2.8, fuego: 1.7 };
/** Bazooka M10 tubes: smoky, crackly, olive. */
const E_BAZOOKA: EstiloEstela = { nucleo: '#fff4b0', brillo: '#ff8a2a', humo: '#b4b09a', ancho: 11, largo: 30, chispas: 70, ondula: 2.5, fuego: 1.3 };
/** RP-3 60 lb from the Mosquito: deep red flame, sooty smoke. */
const E_RP3_ROJO: EstiloEstela = { nucleo: '#ffd0c0', brillo: '#e82a2a', humo: '#9a8a88', ancho: 14, largo: 34, chispas: 76, ondula: 2.6, fuego: 1.5 };
/** Zuni: a huge white-hot motor and a thick white column. */
const E_ZUNI: EstiloEstela = { nucleo: '#ffffff', brillo: '#ffd060', humo: '#f4f0e8', ancho: 16, largo: 38, chispas: 70, ondula: 1.6, fuego: 1.6 };
/** Python 5: violet-white flame, the tightest wriggle. */
const E_PYTHON: EstiloEstela = { nucleo: '#ffffff', brillo: '#b46aff', humo: '#efe4ff', ancho: 8, largo: 36, chispas: 60, ondula: 3.2 };
/** MICA: clean blue-white, long. */
const E_MICA: EstiloEstela = { nucleo: '#ffffff', brillo: '#4a8aff', humo: '#e0ecff', ancho: 8, largo: 40, chispas: 44, ondula: 1.6, fuego: 1.2 };
/** IRIS-T: lime-green flame and minty smoke, snaky. */
const E_IRIS: EstiloEstela = { nucleo: '#f4ffe0', brillo: '#5ae84a', humo: '#e4ffe0', ancho: 8, largo: 36, chispas: 58, ondula: 2.8 };
/** Meteor: a ramjet: short blue flame but a very long, thin, steady vapour line. */
const E_METEOR: EstiloEstela = { nucleo: '#e8f8ff', brillo: '#3ab8ff', humo: '#e8f4fc', ancho: 6, largo: 48, chispas: 26, ondula: 1, fuego: 0.7 };
/** Brimstone: hot magenta flame, short punchy smoke. */
const E_BRIMSTONE: EstiloEstela = { nucleo: '#fff0f8', brillo: '#ff3a9a', humo: '#f4dce8', ancho: 9, largo: 30, chispas: 56, ondula: 1.8, fuego: 1.2 };
/** R-60: tiny and quick, a yellow-orange spark trail. */
const E_R60: EstiloEstela = { nucleo: '#fff8d0', brillo: '#ffa83a', humo: '#fff0d8', ancho: 7, largo: 30, chispas: 66, ondula: 3 };
/** Super 530D: a big smoky motor, amber. */
const E_S530: EstiloEstela = { nucleo: '#fff4d0', brillo: '#ffb43a', humo: '#ece4d4', ancho: 13, largo: 42, chispas: 50, ondula: 1.6, fuego: 1.4 };
/** JSM: a turbojet's faint orange-blue flame and hardly any smoke. */
const E_JSM: EstiloEstela = { nucleo: '#fff0e0', brillo: '#ff9a5a', humo: '#e4e8f0', ancho: 6, largo: 44, chispas: 22, ondula: 1.2, fuego: 0.6 };
/** Fireworks: every one a different colour (the kit picks one per launch). */
const E_FUEGOS: EstiloEstela[] = [
  { nucleo: '#ffffff', brillo: '#ff3a6a', humo: '#ffd0e0', ancho: 9, largo: 30, chispas: 90, ondula: 3.4, fuego: 1.2 },
  { nucleo: '#ffffff', brillo: '#3affb4', humo: '#d0ffee', ancho: 9, largo: 30, chispas: 90, ondula: 3.4, fuego: 1.2 },
  { nucleo: '#ffffff', brillo: '#ffd23a', humo: '#fff4c0', ancho: 9, largo: 30, chispas: 90, ondula: 3.4, fuego: 1.2 },
  { nucleo: '#ffffff', brillo: '#7a6aff', humo: '#e0dcff', ancho: 9, largo: 30, chispas: 90, ondula: 3.4, fuego: 1.2 },
  { nucleo: '#ffffff', brillo: '#3ad8ff', humo: '#d0f4ff', ancho: 9, largo: 30, chispas: 90, ondula: 3.4, fuego: 1.2 },
];

/** GAU-2B minigun 7.62: a buzzing hose of thin red lines. */
const T_MINIGUN: Trazadora = { cabeza: 1, cola: 9, paso: 1.5, grosor: 1, c1: '#ffe0d0', c2: '#ff5a3a', c3: '#c81a2a', cada: 2, boca: 3, fogonazo: '#ffb080', impacto: 0.6, dispersion: 0.06, ancho: 0, casquillos: true };
/** .30 gun pod on the trainer: thin pale orange. */
const T_30_POD: Trazadora = { cabeza: 1, cola: 6, paso: 1.5, grosor: 1, c1: '#fff4e0', c2: '#ffb070', c3: '#ff6a3a', cada: 1, boca: 2, fogonazo: '#ffe0a0', impacto: 0.6, dispersion: 0.04, ancho: 0 };
/** Type 99 20 mm (Oerlikon): slow lobbing green-white shells from the wings. */
const T_TIPO99: Trazadora = { cabeza: 2, cola: 7, paso: 1.8, grosor: 2, c1: '#f4ffe0', c2: '#9ae85a', c3: '#4aa83a', cada: 1, boca: 4, fogonazo: '#e0ffb0', impacto: 1.4, dispersion: 0.05, ancho: 6 };
/** Vickers S 40 mm: two fat orange-red shells from the pods, far apart. */
const T_VICKERS: Trazadora = { cabeza: 3, cola: 7, paso: 2.2, grosor: 2, c1: '#ffffff', c2: '#ff7a2a', c3: '#c8301a', cada: 1, boca: 6, fogonazo: '#ffb050', impacto: 2, dispersion: 0.02, ancho: 6, casquillos: true };
/** MK 108 30 mm «air hammer»: slow, drooping, fat yellow shells. */
const T_MK108: Trazadora = { cabeza: 3, cola: 5, paso: 2, grosor: 2, c1: '#ffffff', c2: '#ffd23a', c3: '#e08a1a', cada: 1, boca: 6, fogonazo: '#ffe070', impacto: 2, dispersion: 0.04, ancho: 0 };
/** M9 37 mm + four .50s in the P-38's nose: a tight bundle, every 3rd a big shell. */
const T_P38: Trazadora = { cabeza: 2, cola: 9, paso: 1.8, grosor: 2, c1: '#ffffff', c2: '#ffb83a', c3: '#ff6a1a', cada: 3, boca: 5, fogonazo: '#ffd070', impacto: 1.6, dispersion: 0.025, ancho: 1, casquillos: true };
/** Four Hispano 20 mm: white-hot heads with pink-red tails. */
const T_HISPANO: Trazadora = { cabeza: 2, cola: 9, paso: 1.8, grosor: 2, c1: '#ffffff', c2: '#ff8aa0', c3: '#d02a4a', cada: 1, boca: 4, fogonazo: '#ffd0d8', impacto: 1.4, dispersion: 0.03, ancho: 2, casquillos: true };
/** Colt Mk 12 20 mm: amber streaks from the wing roots. */
const T_MK12: Trazadora = { cabeza: 2, cola: 8, paso: 1.8, grosor: 2, c1: '#ffffff', c2: '#ffc03a', c3: '#d87a1a', cada: 1, boca: 4, fogonazo: '#ffe090', impacto: 1.3, dispersion: 0.035, ancho: 3 };
/** M39 revolver 20 mm: fast yellow-white pairs. */
const T_M39: Trazadora = { cabeza: 2, cola: 10, paso: 1.7, grosor: 1, c1: '#ffffff', c2: '#fff07a', c3: '#e8b01a', cada: 1, boca: 4, fogonazo: '#fff4b0', impacto: 1.2, dispersion: 0.03, ancho: 2 };
/** GSh-23 twin-barrel: a buzzing red-orange stream. */
const T_GSH23: Trazadora = { cabeza: 2, cola: 10, paso: 1.7, grosor: 1, c1: '#fff0e0', c2: '#ff7a3a', c3: '#d83a1a', cada: 1, boca: 5, fogonazo: '#ffb070', impacto: 1.2, dispersion: 0.04, ancho: 0 };
/** GAU-12 / GAU-22 25 mm: a white-to-teal hose. */
const T_GAU12: Trazadora = { cabeza: 2, cola: 12, paso: 1.7, grosor: 1, c1: '#ffffff', c2: '#a0fff0', c3: '#2ab8a8', cada: 1, boca: 5, fogonazo: '#d0fff8', impacto: 1.4, dispersion: 0.035, ancho: 0, casquillos: true };
const T_GAU22: Trazadora = { ...T_GAU12, c2: '#c0f0ff', c3: '#3a9ad8', fogonazo: '#d8f4ff', dispersion: 0.025 };
/** DEFA 554 / GIAT 30 30 mm revolvers: big blue-white shells. */
const T_DEFA: Trazadora = { cabeza: 3, cola: 7, paso: 2, grosor: 2, c1: '#ffffff', c2: '#8ab4ff', c3: '#3a5ad8', cada: 1, boca: 6, fogonazo: '#c8dcff', impacto: 1.8, dispersion: 0.025, ancho: 0, casquillos: true };
const T_GIAT: Trazadora = { ...T_DEFA, c2: '#c89aff', c3: '#6a3ad8', fogonazo: '#e4d0ff' };
/** Mauser BK-27 27 mm: gold-white shells, crisp. */
const T_BK27: Trazadora = { cabeza: 3, cola: 8, paso: 2, grosor: 2, c1: '#ffffff', c2: '#ffe07a', c3: '#e0a01a', cada: 1, boca: 6, fogonazo: '#fff0b0', impacto: 1.8, dispersion: 0.02, ancho: 0, casquillos: true };
/** The box's bean-shooter: brown beans, no tracer at all, comic puffs. */
const T_POROTOS: Trazadora = { cabeza: 2, cola: 2, paso: 1, grosor: 2, c1: '#c88a4a', c2: '#8a5a2a', c3: '#5a3a1a', cada: 1, boca: 3, fogonazo: '#fff4d8', impacto: 0.8, dispersion: 0.08, ancho: 0 };

const BK27: KitMetralla = {
  nombre: 'Mauser BK-27 27 mm', nota: 'Revólver: obuses dorados nítidos, ¡ta-ta-ta! rápido', vel: 760, cad: 0.06, dano: 1.5, calor: 0.045, gravedad: 0.06, color: 'oro', sonido: 'revolver', traza: T_BK27,
};

/** The second batch of the hangar, in the order they unlock. */
const NUEVOS: PlaneSpec[] = [
  {
    id: 'pillan', pilot: '', name: 'Pillán', real: 'T-35 Pillán',
    blurb: 'El entrenador chileno: lento, noble y perdona todo. Ideal para aprender a pelear.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 2, bombRack: 2, flareRack: 3, reload: 1.1, bombCd: 0.6, bombs: 1, hit: 6,
    stats: { velocidad: 2, blindaje: 3, misiles: 2, bombas: 3 },
    kit: {
      misil: {
        nombre: 'Cohetes de práctica', nota: 'De a dos, sin guía: humito blanco y «fiu» agudo', cohete: COHETE, opts: misil({ vMax: 260, navegacion: 2.5, quemado: 1.8 }),
        energia: 3.4, dano: 2.2, cadencia: 0.16, look: { cuerpo: '#f4f4f4', punta: '#ff5a2a', aletas: '#c8c8d0', largo: 8, forma: 'mini' }, sonido: 'hydra', tono: 1.15, estela: E_PRACTICA,
      },
      metralla: { nombre: 'Góndola .30', nota: 'Una ametralladora bajo el ala: hilos naranjo pálido', vel: 640, cad: 0.07, dano: 0.7, calor: 0.035, gravedad: 0.08, color: 'oro', sonido: 'rifle', tono: 1.2, traza: T_30_POD },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
  },
  {
    id: 'zero', pilot: '', name: 'Zero', real: 'A6M Zero',
    blurb: 'Livianísimo y con un ala enorme: gira más cerrado que cualquier otro de hélice, pero aguanta poco.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 4, rack: 2, bombRack: 1, flareRack: 3, reload: 1.05, bombCd: 0.7, bombs: 1, hit: 6,
    stats: { velocidad: 3, blindaje: 1, misiles: 2, bombas: 2 },
    kit: {
      misil: {
        nombre: 'Cohetes Tipo 3', nota: 'De a dos, sin guía: llama verde-oro y humo caqui', cohete: COHETE, opts: misil({ vMax: 270, navegacion: 2.5, quemado: 2 }),
        energia: 4, dano: 2.5, cadencia: 0.18, look: { cuerpo: '#7a7a62', punta: '#c8d83a', aletas: '#4a4a3a', largo: 10, forma: 'hvar' }, sonido: 'cohete', tono: 1.12, estela: E_TIPO3,
      },
      metralla: {
        nombre: '2 cañones Tipo 99 20 mm', nota: 'Obuses verdes lentos que caen: ¡pum-pum! desde las alas', vel: 560, cad: 0.1, dano: 1.5, calor: 0.05, gravedad: 0.13, color: 'oro', sonido: 'hispano', tono: 1.08, traza: T_TIPO99,
      },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' },
  },
  {
    id: 'hurricane', pilot: '', name: 'Hurricane', real: 'Hurricane IID',
    blurb: 'El «abrelatas»: dos cañones de 40 mm bajo las alas que revientan tanques de un par de tiros.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 6, rack: 4, bombRack: 2, flareRack: 3, reload: 1.15, bombCd: 0.7, bombs: 1, hit: 7,
    stats: { velocidad: 2, blindaje: 4, misiles: 3, bombas: 3 },
    kit: {
      misil: {
        nombre: 'Cohetes RP-3 (de a cuatro)', nota: 'Cuatro de una vez, sin guía: cabeza gorda verde, humo sucio', cohete: { bamboleo: 0.5, salva: 4 }, opts: misil({ vMax: 270, navegacion: 2.5, quemado: 2 }),
        energia: 3.8, dano: 2.3, cadencia: 0.3, look: { cuerpo: '#6a6a5a', punta: '#6ac46a', aletas: '#4a4a3a', largo: 10, forma: 'rp3' }, sonido: 'cohete', tono: 0.96, estela: E_RP3,
      },
      metralla: {
        nombre: '2 cañones Vickers S 40 mm', nota: '¡POM… POM!: obuses gordos rojos, lentos y demoledores', vel: 600, cad: 0.2, dano: 3.6, calor: 0.09, gravedad: 0.09, color: 'oro', sonido: 'pompom', traza: T_VICKERS,
      },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' },
  },
  {
    id: 'bf109', pilot: '', name: 'Messerschmitt', real: 'Bf 109',
    blurb: 'Pequeño y trepador: un cañón de 30 mm que dispara por el buje como un martillo.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 2, bombRack: 1, flareRack: 3, reload: 1.1, bombCd: 0.7, bombs: 1, hit: 6,
    stats: { velocidad: 4, blindaje: 2, misiles: 2, bombas: 2 },
    kit: {
      misil: {
        nombre: 'Morteros-cohete WGr 21', nota: 'Tubos gordos bajo las alas: lentos, caen en arco y revientan grande', cohete: COHETE, opts: misil({ vMax: 210, navegacion: 2, quemado: 1.6 }),
        energia: 7, dano: 3.6, cadencia: 0.4, look: { cuerpo: '#5a5e52', punta: '#3a3a32', aletas: '#4a4e44', largo: 11, forma: 'wgr21' }, sonido: 'mortero', estela: E_WGR21,
      },
      metralla: {
        nombre: 'Cañón MK 108 30 mm', nota: '«Martillo neumático»: obuses amarillos gordos que caen, ¡tun-tun-tun!', vel: 500, cad: 0.1, dano: 2.6, calor: 0.06, gravedad: 0.16, color: 'oro', sonido: 'canon30', tono: 0.78, traza: T_MK108,
      },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' },
  },
  {
    id: 'a37', pilot: '', name: 'Dragonfly', real: 'A-37 Dragonfly',
    blurb: 'El «Libélula» de ataque ligero: lento para ser jet, gira cerrado y escupe una minigun.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 3, flareRack: 3, reload: 1, bombCd: 0.6, bombs: 1, hit: 6,
    stats: { velocidad: 3, blindaje: 3, misiles: 4, bombas: 4 },
    kit: {
      misil: {
        nombre: 'Cohetes Hydra 70 (pod LAU-68)', nota: 'Ráfagas de cuatro: llama rosada y siseo chispeante', cohete: { bamboleo: 0.35, salva: 4 }, opts: misil({ vMax: 300, navegacion: 2.5, quemado: 1.6 }),
        energia: 3, dano: 1.9, cadencia: 0.24, look: { cuerpo: '#e0e0d4', punta: '#3a6a3a', aletas: '#8a8a7a', largo: 9, forma: 'mini' }, sonido: 'hydra', estela: E_HYDRA,
      },
      metralla: {
        nombre: 'Minigun GAU-2B 7,62 mm', nota: 'Seis cañones, «bzzzz» agudo y una manguera de hilos rojos', vel: 660, cad: 0.022, dano: 0.42, calor: 0.018, gravedad: 0.08, color: 'oro', sonido: 'minigun', traza: T_MINIGUN,
      },
      bengala: MAGNESIO,
    },
    bomba: 'napalm', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' },
  },
  {
    id: 'f5', pilot: '', name: 'Tiger', real: 'F-5E Tiger II',
    blurb: 'El Tigre de la FACh: chico, barato y ágil, con misiles Python que no sueltan.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 4, rack: 4, bombRack: 2, flareRack: 3, reload: 0.82, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 4, blindaje: 2, misiles: 4, bombas: 2 },
    kit: {
      misil: {
        nombre: 'Python 5', buscador: true, opts: misil({ vMax: 330, navegacion: 5.6, cargaMax: 28, cono: (120 * Math.PI) / 180 }), energia: 4.2, dano: 2.7, cadencia: 0.18,
        look: { cuerpo: '#ececf0', punta: '#3a3a4a', aletas: '#6a6a7a', largo: 12, forma: 'python' }, sonido: 'aam', tono: 1.16,
        nota: 'Doble juego de aletas: llama violeta, el que más se retuerce', estela: E_PYTHON,
      },
      metralla: {
        nombre: '2 cañones M39 20 mm', nota: 'Revólveres en la nariz: parejas amarillas veloces', vel: 760, cad: 0.05, dano: 1.05, calor: 0.035, gravedad: 0.06, color: 'blanco', sonido: 'revolver', tono: 1.12, traza: T_M39,
      },
      bengala: MAGNESIO,
    },
    bomba: 'racimo', sigilo: 0,
    desbloqueo: { tipo: 'derribos', n: 25, texto: 'Derriba 25 enemigos (en total)' },
  },
  {
    id: 'p38', pilot: '', name: 'Lightning', real: 'P-38 Lightning',
    blurb: 'Dos motores y dos colas: todas las armas juntas en la nariz, un chorro que no se abre.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 6, rack: 3, bombRack: 3, flareRack: 3, reload: 1, bombCd: 0.7, bombs: 2, hit: 8,
    stats: { velocidad: 3, blindaje: 4, misiles: 3, bombas: 4 },
    kit: {
      misil: {
        nombre: 'Bazooka M10 (tubos de a tres)', nota: 'Tres de cada racimo de tubos: humo oliva y chisporroteo', cohete: { bamboleo: 0.45, salva: 3 }, opts: misil({ vMax: 280, navegacion: 2.5, quemado: 1.8 }),
        energia: 3.6, dano: 2.2, cadencia: 0.28, look: { cuerpo: '#6a7050', punta: '#c8b060', aletas: '#4a4e3a', largo: 10, forma: 'hvar' }, sonido: 'cohete', tono: 1.04, estela: E_BAZOOKA,
      },
      metralla: {
        nombre: 'Cañón M9 37 mm + 4 .50', nota: 'Todo en la nariz: un haz apretado y cada tres un obús gordo', vel: 700, cad: 0.04, dano: 1, calor: 0.03, gravedad: 0.07, color: 'oro', sonido: 'browning', tono: 0.88, traza: T_P38,
      },
      bengala: MAGNESIO,
    },
    bomba: 'napalm', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' },
  },
  {
    id: 'mosquito', pilot: '', name: 'Mosquito', real: 'DH Mosquito',
    blurb: 'El maravilla de madera: rápido para ser bimotor y la bomba de rebote como en las películas.',
    parts: ['cola', 'ala', 'motor', 'cabina', 'bodega'], hp: 5, rack: 3, bombRack: 4, flareRack: 3, reload: 1.05, bombCd: 0.7, bombs: 2, hit: 8,
    stats: { velocidad: 3, blindaje: 3, misiles: 3, bombas: 5 },
    kit: {
      misil: {
        nombre: 'Cohetes RP-3 de 60 lb', nota: 'De a dos, sin guía: llama roja oscura, hollín', cohete: COHETE, opts: misil({ vMax: 270, navegacion: 2.5, quemado: 2 }),
        energia: 4.6, dano: 2.8, cadencia: 0.2, look: { cuerpo: '#5a6a7a', punta: '#e82a2a', aletas: '#3a4a5a', largo: 10, forma: 'rp3' }, sonido: 'cohete', tono: 0.92, estela: E_RP3_ROJO,
      },
      metralla: {
        nombre: '4 cañones Hispano 20 mm', nota: 'Bajo la nariz: cabezas blancas y colas rosadas, golpe seco', vel: 720, cad: 0.05, dano: 1.25, calor: 0.04, gravedad: 0.07, color: 'oro', sonido: 'hispano', traza: T_HISPANO,
      },
      bengala: MAGNESIO,
    },
    bomba: 'rebote', sigilo: 0,
    desbloqueo: { tipo: 'misiones', n: 3, texto: 'Cumple 3 misiones (en total)' },
  },
  {
    id: 'a4', pilot: '', name: 'Skyhawk', real: 'A-4 Skyhawk',
    blurb: 'Chico, robusto y cargador: cohetes Zuni enormes y una bomba que rompe pistas.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 3, bombRack: 4, flareRack: 3, reload: 0.95, bombCd: 0.65, bombs: 2, hit: 7,
    stats: { velocidad: 4, blindaje: 3, misiles: 3, bombas: 5 },
    kit: {
      misil: {
        nombre: 'Cohetes Zuni de 5"', nota: 'De a dos, sin guía: tubos gordos, columna blanca y ¡FUUM!', cohete: { bamboleo: 0.3, salva: 2 }, opts: misil({ vMax: 330, navegacion: 2.5, quemado: 1.8 }),
        energia: 5.6, dano: 3.2, cadencia: 0.28, look: { cuerpo: '#d8d8cc', punta: '#5a5a5a', aletas: '#8a8a7a', largo: 14, forma: 'zuni' }, sonido: 'zuni', estela: E_ZUNI,
      },
      metralla: {
        nombre: '2 cañones Colt Mk 12 20 mm', nota: 'Desde la raíz de las alas: rayas ámbar, golpeteo grueso', vel: 700, cad: 0.065, dano: 1.2, calor: 0.04, gravedad: 0.07, color: 'oro', sonido: 'hispano', tono: 1.15, traza: T_MK12,
      },
      bengala: MAGNESIO,
    },
    bomba: 'pista', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' },
  },
  {
    id: 'mig21', pilot: '', name: 'Fishbed', real: 'MiG-21',
    blurb: 'Un dardo: rapidísimo en línea recta, pierde energía en los giros. Misiles R-60 diminutos.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 4, rack: 4, bombRack: 2, flareRack: 3, reload: 0.8, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 2, misiles: 4, bombas: 2 },
    kit: {
      misil: {
        nombre: 'R-60 «Pulgón»', buscador: true, opts: misil({ vMax: 310, navegacion: 6, cargaMax: 30, quemado: 2, cono: (110 * Math.PI) / 180, vida: 4 }), energia: 3.2, dano: 2.1, cadencia: 0.14,
        look: { cuerpo: '#d8dcd0', punta: '#4a5a4a', aletas: '#6a7a5a', largo: 9, forma: 'r60' }, sonido: 'aam', tono: 1.3,
        nota: 'Chiquitito y rapidísimo: chispas naranjas, alcance corto',  estela: E_R60,
      },
      metralla: {
        nombre: 'Cañón GSh-23L 23 mm', nota: 'Dos cañones en uno: chorro rojo-naranja zumbando', vel: 700, cad: 0.04, dano: 1, calor: 0.035, gravedad: 0.07, color: 'oro', sonido: 'vulcan', tono: 0.82, traza: T_GSH23,
      },
      bengala: { nombre: 'Trampas térmicas', tipo: 'trampa', n: 3, intentos: 1 },
    },
    bomba: 'fosforo', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 5, texto: 'Llega a la oleada 5' },
  },
  {
    id: 'harrier', pilot: '', name: 'Harrier', real: 'AV-8B Harrier II',
    blurb: 'Toberas que giran: casi no entra en pérdida y apunta la nariz donde quiera aunque vaya lentísimo.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 3, bombRack: 3, flareRack: 3, reload: 1, bombCd: 0.7, bombs: 1, hit: 7,
    stats: { velocidad: 3, blindaje: 3, misiles: 5, bombas: 4 },
    kit: {
      misil: {
        nombre: 'Brimstone (de a tres)', buscador: true, salva: 3, opts: misil({ vMax: 290, navegacion: 4, quemado: 3.2, cono: (100 * Math.PI) / 180 }), energia: 4, dano: 2.6, cadencia: 0.45,
        look: { cuerpo: '#e4e4dc', punta: '#2a2a32', aletas: '#7a7a72', largo: 11, forma: 'brimstone' }, sonido: 'ripple',
        nota: 'Salen tres juntos y cada uno busca su blanco: llama magenta',  estela: E_BRIMSTONE,
      },
      metralla: {
        nombre: 'Cañón GAU-12 Equalizer 25 mm', nota: 'Cinco cañones: manguera blanca y turquesa, «brrrm» grave', vel: 760, cad: 0.04, dano: 1.1, calor: 0.032, gravedad: 0.06, color: 'blanco', sonido: 'vulcan', tono: 0.88, traza: T_GAU12,
      },
      bengala: MAGNESIO,
    },
    bomba: 'planeadora', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 5, texto: 'Llega a la oleada 5' },
  },
  {
    id: 'mirage', pilot: '', name: 'Mirage', real: 'Mirage 2000',
    blurb: 'Delta puro: rápido y tira fuerte, pero se frena en los giros largos.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 2, flareRack: 3, reload: 0.85, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 3, misiles: 4, bombas: 2 },
    kit: {
      misil: {
        nombre: 'Super 530D', buscador: true, opts: misil({ vMax: 350, empuje: 3.6 * G, quemado: 4, navegacion: 4.2, vida: 7 }), energia: 5, dano: 3, cadencia: 0.28,
        look: { cuerpo: '#f0f0ec', punta: '#5a5a5a', aletas: '#7a7a8a', largo: 15, forma: 's530' }, sonido: 'amraam', tono: 0.9,
        nota: 'Grande y de largo alcance: aletas en cruz, pluma ámbar',  estela: E_S530,
      },
      metralla: {
        nombre: '2 cañones DEFA 554 30 mm', nota: 'Revólveres: obuses azules gordos, ¡ta-ta-ta! grave', vel: 720, cad: 0.07, dano: 1.8, calor: 0.05, gravedad: 0.07, color: 'oro', sonido: 'revolver', tono: 0.9, traza: T_DEFA,
      },
      bengala: MAGNESIO,
    },
    bomba: 'mina', sigilo: 0.1,
    desbloqueo: { tipo: 'oleada', n: 5, texto: 'Llega a la oleada 5' },
  },
  {
    id: 'gripen', pilot: '', name: 'Gripen', real: 'JAS 39 Gripen',
    blurb: 'Delta con canards, liviano y fácil de llevar. Misiles IRIS-T que giran como trompo.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 2, flareRack: 4, reload: 0.8, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 3, misiles: 5, bombas: 3 },
    kit: {
      misil: {
        nombre: 'IRIS-T', buscador: true, opts: misil({ vMax: 330, navegacion: 6, cargaMax: 32, cono: (130 * Math.PI) / 180 }), energia: 4.2, dano: 2.7, cadencia: 0.17,
        look: { cuerpo: '#ececec', punta: '#2a3a2a', aletas: '#5a6a5a', largo: 12, forma: 'iris' }, sonido: 'aam', tono: 1.05,
        nota: 'Tobera vectorial: gira como trompo, llama verde lima',  estela: E_IRIS,
      },
      metralla: BK27,
      bengala: { nombre: 'Bengalas BOL', tipo: 'magnesio', n: 4, intentos: 1 },
    },
    bomba: 'planeadora', sigilo: 0.1,
    desbloqueo: { tipo: 'derribos', n: 80, texto: 'Derriba 80 enemigos (en total)' },
  },
  {
    id: 'rafale', pilot: '', name: 'Rafale', real: 'Rafale',
    blurb: 'Bimotor con canards: ágil a baja velocidad y fuerte en todo. Misiles MICA.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 3, flareRack: 3, reload: 0.82, bombCd: 0.75, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 3, misiles: 5, bombas: 3 },
    kit: {
      misil: {
        nombre: 'MICA', buscador: true, opts: misil({ vMax: 340, empuje: 3.4 * G, quemado: 3.4, navegacion: 5, cargaMax: 26, vida: 6 }), energia: 4.4, dano: 2.8, cadencia: 0.18,
        look: { cuerpo: '#f4f4f8', punta: '#4a4a5a', aletas: '#6a6a8a', largo: 13, forma: 'mica' }, sonido: 'amraam', tono: 1.08,
        nota: 'Aletas largas a lo largo: pluma azul y blanca, limpia',  estela: E_MICA,
      },
      metralla: {
        nombre: 'Cañón GIAT 30M791 30 mm', nota: 'Revólver rapidísimo: obuses violetas, rugido de sierra', vel: 740, cad: 0.05, dano: 1.6, calor: 0.045, gravedad: 0.07, color: 'oro', sonido: 'revolver', tono: 0.96, traza: T_GIAT,
      },
      bengala: { nombre: 'Spectra (señuelos)', tipo: 'chaff', n: 3, intentos: 2 },
    },
    bomba: 'humo', sigilo: 0.15,
    desbloqueo: { tipo: 'oleada', n: 6, texto: 'Llega a la oleada 6' },
  },
  {
    id: 'typhoon', pilot: '', name: 'Typhoon', real: 'Eurofighter Typhoon',
    blurb: 'El bólido: empuje brutal y supercrucero. El misil Meteor llega más lejos que ningún otro.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 2, flareRack: 3, reload: 0.85, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 3, misiles: 5, bombas: 2 },
    kit: {
      misil: {
        nombre: 'Meteor', buscador: true, opts: misil({ vMax: 380, empuje: 2.6 * G, quemado: 7, navegacion: 4.4, cargaMax: 22, vida: 9 }), energia: 4.6, dano: 3, cadencia: 0.3,
        look: { cuerpo: '#f0f0f0', punta: '#5a5a6a', aletas: '#6a6a7a', largo: 15, forma: 'meteor' }, sonido: 'ramjet',
        nota: 'Estatorreactor: no se apaga, ruge parejo y deja una línea azul larguísima',  estela: E_METEOR,
      },
      metralla: { ...BK27, tono: 0.94 },
      bengala: MAGNESIO,
    },
    bomba: 'guiada', sigilo: 0.1,
    desbloqueo: { tipo: 'oleada', n: 7, texto: 'Llega a la oleada 7' },
  },
  {
    id: 'f35', pilot: '', name: 'Lightning II', real: 'F-35A Lightning II',
    blurb: 'Furtivo y lleno de sensores: lleva en la bodega el misil JSM, que vuela rasante y casi invisible.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 3, bombRack: 3, flareRack: 3, reload: 1, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 4, blindaje: 4, misiles: 4, bombas: 4 },
    kit: {
      misil: {
        nombre: 'JSM (misil furtivo)', buscador: true, opts: misil({ vMax: 250, empuje: 2.4 * G, quemado: 8, navegacion: 3.4, vida: 10 }), energia: 9, dano: 4.6, cadencia: 0.45,
        look: { cuerpo: '#5a5e68', punta: '#3a3e48', aletas: '#7a808c', largo: 15, forma: 'jsm' }, sonido: 'crucero', tono: 1.1,
        nota: 'Cae de la bodega, abre las alas y caza solo: casi sin humo',  estela: E_JSM,
      },
      metralla: {
        nombre: 'Cañón GAU-22/A 25 mm', nota: 'Cuatro cañones escondidos: hilos celestes cortos y precisos', vel: 780, cad: 0.05, dano: 1.15, calor: 0.04, gravedad: 0.05, color: 'blanco', sonido: 'vulcan', tono: 0.94, traza: T_GAU22,
      },
      bengala: { nombre: 'Bengalas MJU-61', tipo: 'magnesio', n: 3, intentos: 1 },
    },
    bomba: 'sismica', sigilo: 0.5,
    desbloqueo: { tipo: 'oleada', n: 8, texto: 'Llega a la oleada 8' },
  },
  {
    id: 'carton', pilot: '', name: 'Caja Voladora', real: 'Caja con ventilador',
    blurb: 'Una caja de cartón con un ventilador de escritorio. No debería volar. Vuela. Y dispara porotos.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 4, rack: 3, bombRack: 3, flareRack: 3, reload: 0.9, bombCd: 0.6, bombs: 1, hit: 8,
    stats: { velocidad: 1, blindaje: 2, misiles: 4, bombas: 4 },
    kit: {
      misil: {
        nombre: 'Fuegos artificiales', nota: 'Tres voladores de colores distintos: silban y chisporrotean', cohete: { bamboleo: 0.9, salva: 3 }, estelas: E_FUEGOS,
        opts: misil({ vMax: 250, navegacion: 2.2, quemado: 1.6 }), energia: 3.6, dano: 2.2, cadencia: 0.3,
        look: { cuerpo: '#ff4a6a', punta: '#ffd23a', aletas: '#8a5a2a', largo: 10, forma: 'fuegos' }, sonido: 'fuegos', estela: E_FUEGOS[0],
      },
      metralla: {
        nombre: 'Lanza-porotos', nota: 'Porotos con cerbatana a presión: ¡pfft-pfft! y algo duelen', vel: 520, cad: 0.06, dano: 0.75, calor: 0.03, gravedad: 0.22, color: 'oro', sonido: 'porotos', traza: T_POROTOS,
      },
      bengala: { nombre: 'Chaya y serpentinas', tipo: 'chaff', n: 3, intentos: 2 },
    },
    bomba: 'pinata', sigilo: 0,
    desbloqueo: { tipo: 'derribos', n: 150, texto: 'Derriba 150 enemigos (en total)' },
  },
];

export const HANGAR: PlaneSpec[] = [
  {
    id: 'avioneta', pilot: 'Lulu', name: 'Avioneta Mostaza',
    blurb: 'Ágil: gira cerrado y suelta bombas seguido.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 2, bombRack: 2, flareRack: 3, reload: 1.2, bombCd: 0.5, bombs: 1, hit: 7,
    stats: { velocidad: 3, blindaje: 3, misiles: 3, bombas: 4 },
    kit: {
      misil: { ...BASE_MISIL, nombre: 'Cohete Mostaza', nota: 'Humo mostaza, chispas doradas' },
      metralla: { ...BASE_METRALLA, nombre: 'Ametralladora .30' },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
  },
  {
    id: 'caza', pilot: 'Dui', name: 'Caza Mandarina',
    blurb: 'El más veloz de la casa: deja atrás a los misiles y dispara más.',
    parts: ['cola', 'ala', 'motor'], hp: 4, rack: 3, bombRack: 1, flareRack: 3, reload: 0.85, bombCd: 0.9, bombs: 1, hit: 6,
    stats: { velocidad: 4, blindaje: 2, misiles: 4, bombas: 2 },
    kit: {
      misil: {
        ...BASE_MISIL, nombre: 'Misil Mandarina', nota: 'Llama mandarina, humo durazno', tono: 1.08, estela: E_MANDARINA,
        look: { cuerpo: '#fff4e8', punta: '#ff7a1a', aletas: '#e05a1a', largo: 12, forma: 'casero' },
      },
      metralla: { ...BASE_METRALLA, nombre: 'Ametralladora .50', nota: 'Trazadoras naranjas, golpe grueso', sonido: 'browning', tono: 1.05, cad: 0.07, traza: T_50_CASA },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
  },
  {
    id: 'bombardero', pilot: 'Almendrita', name: 'Bombardero Nube',
    blurb: 'Lento pero blindado: suelta tres bombas de una vez.',
    parts: ['cola', 'ala', 'motor', 'cabina', 'bodega'], hp: 6, rack: 2, bombRack: 3, flareRack: 3, reload: 1.3, bombCd: 0.9, bombs: 3, hit: 9,
    stats: { velocidad: 2, blindaje: 5, misiles: 2, bombas: 5 },
    kit: {
      misil: {
        ...BASE_MISIL, nombre: 'Misil Nube', nota: 'Estela de nube rosada, gordita', tono: 0.9, estela: E_NUBE,
        look: { cuerpo: '#f4f0ff', punta: '#ff7ab4', aletas: '#9a8ad8', largo: 13, forma: 'casero' },
      },
      metralla: { ...BASE_METRALLA, nombre: 'Torreta de cola', nota: 'Dos .50 gemelas: chorros rojos, ta-ta-ta grave', sonido: 'browning', tono: 0.86, traza: T_TORRETA },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
  },
  {
    id: 'raptor', pilot: '', name: 'Raptor', real: 'F-22 Raptor',
    blurb: 'Caza furtivo: los radares casi no lo ven. Supercrucero y toberas vectoriales.',
    parts: ['cola', 'ala', 'motor'], hp: 4, rack: 4, bombRack: 2, flareRack: 3, reload: 0.8, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 3, misiles: 5, bombas: 2 },
    kit: {
      misil: {
        nombre: 'AIM-120 AMRAAM', buscador: true, opts: misil({ vMax: 340, empuje: 3.6 * G, quemado: 3.6, navegacion: 4.5, vida: 6 }),
        energia: 4.5, dano: 2.8, cadencia: 0.2, look: { cuerpo: '#f0f0f4', punta: '#8a8a9a', aletas: '#5a5a6a', largo: 13, forma: 'aam' }, sonido: 'amraam',
        nota: 'Cae de la bodega y enciende: pluma blanca y turquesa, larga', estela: E_AMRAAM,
      },
      metralla: VULCAN,
      bengala: { nombre: 'Bengalas MJU-10', tipo: 'magnesio', n: 3, intentos: 1 },
    },
    bomba: 'racimo', sigilo: 0.4,
    desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' },
  },
  {
    id: 'sukhoi', pilot: '', name: 'Sukhoi', real: 'Su-57',
    blurb: 'Supermaniobrable: gira en un pañuelo. Cañón de 30 mm que pega fuerte.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 2, flareRack: 3, reload: 0.85, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 3, misiles: 4, bombas: 3 },
    kit: {
      misil: {
        nombre: 'R-74 (corto alcance)', buscador: true, opts: misil({ vMax: 300, navegacion: 5.5, cargaMax: 26, cono: (110 * Math.PI) / 180 }),
        energia: 4, dano: 2.6, cadencia: 0.2, look: { cuerpo: '#d8dcc8', punta: '#3a4a3a', aletas: '#6a7a5a', largo: 11, forma: 'canard' }, sonido: 'aam', tono: 0.94,
        nota: 'Aletas delanteras, llama roja y siseo seco', estela: E_R74,
      },
      metralla: {
        nombre: 'Cañón GSh-30 30 mm', nota: 'Obuses naranjas gordos, ¡BUM-BUM! lento', vel: 640, cad: 0.11, dano: 2.2, calor: 0.06, gravedad: 0.07, color: 'oro', sonido: 'canon30', traza: T_GSH30,
      },
      bengala: { nombre: 'Trampas térmicas', tipo: 'trampa', n: 3, intentos: 1 },
    },
    bomba: 'fosforo', sigilo: 0.2,
    desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' },
  },
  {
    id: 'b2', pilot: '', name: 'Spirit', real: 'B-2 Spirit',
    blurb: 'Ala volante furtiva: bodega enorme y misiles crucero. Sin metralla.',
    parts: ['ala', 'motor', 'cabina', 'bodega'], hp: 5, rack: 2, bombRack: 5, flareRack: 3, reload: 1.6, bombCd: 1, bombs: 4, hit: 10,
    stats: { velocidad: 2, blindaje: 5, misiles: 3, bombas: 5 },
    kit: {
      misil: {
        nombre: 'Misil crucero', buscador: true, opts: misil({ vMax: 230, empuje: 2.4 * G, quemado: 7, navegacion: 3, vida: 9 }),
        energia: 10, dano: 5, cadencia: 0.5, look: { cuerpo: '#4a4a56', punta: '#2a2a32', aletas: '#6a6a7a', largo: 15, forma: 'crucero' }, sonido: 'crucero',
        nota: 'Despliega las alas, turbina de llama azul', estela: E_CRUCERO,
      },
      metralla: null,
      bengala: { nombre: 'Chaff (dipolos)', tipo: 'chaff', n: 3, intentos: 2 },
    },
    bomba: 'racimo', sigilo: 0.6,
    desbloqueo: { tipo: 'oleada', n: 5, texto: 'Llega a la oleada 5' },
  },
  {
    id: 'spitfire', pilot: '', name: 'Spitfire', real: 'Spitfire',
    blurb: 'El clásico de hélice: lento pero gira como nadie. Ocho ametralladoras en las alas.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 2, bombRack: 2, flareRack: 3, reload: 1.1, bombCd: 0.7, bombs: 1, hit: 6,
    stats: { velocidad: 3, blindaje: 3, misiles: 2, bombas: 3 },
    kit: {
      misil: {
        nombre: 'Cohetes RP-3', nota: 'De a dos, sin guía: humo sucio, cabeza gorda', cohete: COHETE, opts: misil({ vMax: 280, navegacion: 2.5, quemado: 2 }),
        energia: 4, dano: 2.6, cadencia: 0.18, look: { cuerpo: '#6a6a5a', punta: '#d8c070', aletas: '#4a4a3a', largo: 10, forma: 'rp3' }, sonido: 'cohete', estela: E_RP3,
      },
      metralla: {
        nombre: '8 ametralladoras .303', nota: 'Hilos amarillos finos, traqueteo rápido', vel: 640, cad: 0.04, dano: 0.6, calor: 0.03, gravedad: 0.08, color: 'oro', sonido: 'rifle', traza: T_303,
      },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' },
  },
  {
    id: 'stuka', pilot: '', name: 'Stuka', real: 'Junkers Ju 87',
    blurb: 'Bombardero en picada con su sirena aullando: se lanza en vertical y suelta la bomba justo encima.',
    parts: ['cola', 'ala', 'motor', 'cabina', 'bodega'], hp: 5, rack: 2, bombRack: 3, flareRack: 3, reload: 1.2, bombCd: 0.6, bombs: 2, hit: 7,
    stats: { velocidad: 2, blindaje: 4, misiles: 2, bombas: 5 },
    kit: {
      misil: {
        nombre: 'Cohetes bajo ala', nota: 'De a dos, sin guía: llama roja y humo gris', cohete: COHETE, opts: misil({ vMax: 260, navegacion: 2.2, quemado: 2 }),
        energia: 4.5, dano: 2.8, cadencia: 0.22, look: { cuerpo: '#6a6a5a', punta: '#c84a3a', aletas: '#4a4a3a', largo: 10, forma: 'hvar' }, sonido: 'cohete', tono: 0.9, estela: E_STUKA,
      },
      metralla: {
        nombre: 'MG 17 7,92 mm', nota: 'Trazadoras ámbar finas, repiqueteo agudo', vel: 600, cad: 0.06, dano: 0.6, calor: 0.035, gravedad: 0.09, color: 'oro', sonido: 'rifle', tono: 1.14, traza: T_MG17,
      },
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' },
  },
  {
    id: 'mustang', pilot: '', name: 'Mustang', real: 'P-51 Mustang',
    blurb: 'El clásico de hélice más rápido: seis ametralladoras .50 y mucho alcance.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 2, bombRack: 2, flareRack: 3, reload: 1, bombCd: 0.7, bombs: 1, hit: 6,
    stats: { velocidad: 3, blindaje: 3, misiles: 2, bombas: 3 },
    kit: {
      misil: {
        nombre: 'Cohetes HVAR', nota: 'De a dos, sin guía: humo gris y muchas chispas', cohete: COHETE, opts: misil({ vMax: 300, navegacion: 2.5, quemado: 2.2 }),
        energia: 4.2, dano: 2.7, cadencia: 0.18, look: { cuerpo: '#8a8a7a', punta: '#e8c050', aletas: '#5a5a4a', largo: 11, forma: 'hvar' }, sonido: 'cohete', tono: 1.06, estela: E_HVAR,
      },
      metralla: BROWNING_ALAS,
      bengala: MAGNESIO,
    },
    bomba: 'comun', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' },
  },
  {
    id: 'corsair', pilot: '', name: 'Corsair', real: 'F4U Corsair',
    blurb: 'Alas de gaviota y un motor enorme: trepa rápido y aguanta castigo.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 6, rack: 3, bombRack: 2, flareRack: 3, reload: 1.05, bombCd: 0.7, bombs: 1, hit: 7,
    stats: { velocidad: 3, blindaje: 4, misiles: 3, bombas: 3 },
    kit: {
      misil: {
        nombre: 'Cohetes Tiny Tim', nota: 'Uno enorme, sin guía: humo negro espeso y rugido', cohete: { bamboleo: 0.35, salva: 1 }, opts: misil({ vMax: 270, navegacion: 2.2, quemado: 2.5 }),
        energia: 6, dano: 3.4, cadencia: 0.3, look: { cuerpo: '#5a6a7a', punta: '#d8d8d8', aletas: '#3a4a5a', largo: 15, forma: 'tinytim' }, sonido: 'tinytim', estela: E_TINYTIM,
      },
      metralla: { ...BROWNING_ALAS, tono: 0.94 },
      bengala: MAGNESIO,
    },
    bomba: 'rebote', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' },
  },
  {
    id: 'f16', pilot: '', name: 'Falcon', real: 'F-16 Fighting Falcon',
    blurb: 'Ligero y ágil, aguanta 9 g y gira más rápido que nadie. Un todoterreno.',
    parts: ['cola', 'ala', 'motor'], hp: 4, rack: 4, bombRack: 2, flareRack: 3, reload: 0.8, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 2, misiles: 4, bombas: 3 },
    kit: {
      misil: { nombre: 'AIM-9X Sidewinder', buscador: true, opts: misil({ vMax: 320, navegacion: 5, cargaMax: 24, cono: (100 * Math.PI) / 180 }), energia: 4, dano: 2.6, cadencia: 0.18,
        look: { cuerpo: '#ececec', punta: '#5a5a6a', aletas: '#7a7a8a', largo: 11, forma: 'canard' }, sonido: 'aam', tono: 1.1,
        nota: 'Latigazo agudo: llama amarilla y la estela más serpenteante', estela: E_SIDEWINDER,
      },
      metralla: { ...VULCAN, tono: 1.04 },
      bengala: MAGNESIO,
    },
    bomba: 'guiada', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' },
  },
  {
    id: 'mig29', pilot: '', name: 'Fulcrum', real: 'MiG-29',
    blurb: 'Dos motores y mucho morro: apunta donde quiere aunque vaya lento. Cañón de 30 mm.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 2, flareRack: 3, reload: 0.85, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 4, blindaje: 3, misiles: 4, bombas: 2 },
    kit: {
      misil: { nombre: 'R-73', buscador: true, opts: misil({ vMax: 300, navegacion: 5.2, cargaMax: 25, cono: (110 * Math.PI) / 180 }), energia: 4, dano: 2.6, cadencia: 0.2,
        look: { cuerpo: '#c8d0c0', punta: '#8a2a3a', aletas: '#5a6a4a', largo: 11, forma: 'canard' }, sonido: 'aam', tono: 0.88,
        nota: 'Aletas delanteras, llama carmesí y siseo grave', estela: E_R73,
      },
      metralla: {
        nombre: 'Cañón GSh-30-1 30 mm', nota: 'Obuses naranjas, estampidos secos', vel: 640, cad: 0.1, dano: 2, calor: 0.06, gravedad: 0.07, color: 'oro', sonido: 'canon30', tono: 1.08, traza: T_GSH30,
      },
      bengala: { nombre: 'Trampas térmicas', tipo: 'trampa', n: 3, intentos: 1 },
    },
    bomba: 'fosforo', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' },
  },
  {
    id: 'tomcat', pilot: '', name: 'Tomcat', real: 'F-14 Tomcat',
    blurb: 'El de las películas: alas de geometría variable y misiles de muy largo alcance.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 2, flareRack: 3, reload: 0.9, bombCd: 0.8, bombs: 1, hit: 7,
    stats: { velocidad: 5, blindaje: 3, misiles: 5, bombas: 2 },
    kit: {
      misil: { nombre: 'AIM-54 Phoenix', buscador: true, opts: misil({ vMax: 360, empuje: 3.8 * G, quemado: 4.5, navegacion: 4, vida: 8 }), energia: 5.5, dano: 3.2, cadencia: 0.3,
        look: { cuerpo: '#f4f4f4', punta: '#ff8a3c', aletas: '#6a6a7a', largo: 16, forma: 'pesado' }, sonido: 'amraam', tono: 0.8,
        nota: 'Grandote: rugido hondo y pluma naranja ancha', estela: E_PHOENIX,
      },
      metralla: { ...VULCAN, vel: 760, cad: 0.05, calor: 0.035, tono: 0.97 },
      bengala: MAGNESIO,
    },
    bomba: 'guiada', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' },
  },
  {
    id: 'a10', pilot: '', name: 'Warthog', real: 'A-10 Warthog',
    blurb: 'Un tanque con alas: el cañón GAU-8 destroza blindados. Aguanta muchísimo.',
    parts: ['cola', 'ala', 'motor', 'cabina', 'bodega'], hp: 6, rack: 3, bombRack: 4, flareRack: 3, reload: 1, bombCd: 0.6, bombs: 2, hit: 8,
    stats: { velocidad: 2, blindaje: 5, misiles: 3, bombas: 5 },
    kit: {
      misil: { nombre: 'AGM-65 Maverick', buscador: true, opts: misil({ vMax: 260, navegacion: 3.5, quemado: 4 }), energia: 6, dano: 3.5, cadencia: 0.35,
        look: { cuerpo: '#c8c8b8', punta: '#3a3a3a', aletas: '#7a7a6a', largo: 13, forma: 'pesado' }, sonido: 'maverick',
        nota: 'Raspa el riel y ruge: humo pardo y llama ámbar', estela: E_MAVERICK,
      },
      metralla: {
        nombre: 'GAU-8 Avenger 30 mm', nota: '¡BRRRT!: manguera de obuses rojos y nube de humo', vel: 720, cad: 0.035, dano: 1.6, calor: 0.04, gravedad: 0.06, color: 'oro', sonido: 'gau8', traza: T_GAU8,
      },
      bengala: MAGNESIO,
    },
    bomba: 'racimo', sigilo: 0,
    desbloqueo: { tipo: 'oleada', n: 6, texto: 'Llega a la oleada 6' },
  },
  ...NUEVOS,
  {
    id: 'ovni', pilot: '', name: 'Platillo', real: 'OVNI',
    blurb: 'Tecnología de otro mundo: rayo láser, orbes de plasma y hologramas.',
    parts: ['cabina', 'motor', 'ala'], hp: 4, rack: 3, bombRack: 3, flareRack: 3, reload: 0.9, bombCd: 0.9, bombs: 1, hit: 7,
    stats: { velocidad: 4, blindaje: 4, misiles: 5, bombas: 4 },
    kit: {
      misil: {
        nombre: 'Orbe de plasma', buscador: true, opts: misil({ vMax: 300, quemado: 5, navegacion: 6, cargaMax: 30, cono: (150 * Math.PI) / 180, vida: 7 }),
        energia: 5, dano: 3, cadencia: 0.25, look: 'orbe', sonido: 'orbe',
        nota: 'Bola que zumba: estela violeta y celeste', estela: E_ORBE,
      },
      metralla: { nombre: 'Rayo láser', nota: 'Rayos celestes rectos, «piu»', vel: 1300, cad: 0.07, dano: 0.9, calor: 0.05, gravedad: 0, color: 'laser', sonido: 'laser', traza: T_LASER },
      bengala: { nombre: 'Hologramas', tipo: 'holograma', n: 3, intentos: 3 },
    },
    bomba: 'plasma', sigilo: 0.3,
    desbloqueo: { tipo: 'ovnis', n: 3, texto: 'Derriba 3 ovnis' },
  },
];

export const especDe = (id: ModeloAvion): PlaneSpec => HANGAR.find((p) => p.id === id) ?? HANGAR[1];


export type BombaInfo = { nombre: string; texto: string; desbloqueo?: Desbloqueo; soloOvni?: boolean };
export const BOMBAS: Record<BombaTipo, BombaInfo> = {
  comun: { nombre: 'Bomba común', texto: 'Una explosión grande y un cráter.' },
  racimo: { nombre: 'Racimo', texto: 'Se abre en el aire y siembra siete bombitas.', desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' } },
  fosforo: { nombre: 'Fósforo blanco', texto: 'Deja el suelo ardiendo unos segundos.', desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' } },
  gas: { nombre: 'Gas', texto: 'Una nube verde que se mueve con el viento y daña lo que toca.', desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' } },
  plasma: { nombre: 'Plasma', texto: 'La carga del platillo: un estallido violeta enorme.', soloOvni: true },
  guiada: { nombre: 'Guiada láser', texto: 'Corrige su caída hacia el enemigo más cercano.', desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' } },
  rebote: { nombre: 'De rebote', texto: 'Rebota hasta tres veces (¡sobre el agua también!) antes de estallar.', desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' } },
  crio: { nombre: 'Criogénica', texto: 'Congela los vehículos cercanos: se quedan quietos y sin disparar.', desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' } },
  emp: { nombre: 'Pulso EMP', texto: 'Apaga misiles enemigos y deja mudas las baterías un rato.', desbloqueo: { tipo: 'oleada', n: 5, texto: 'Llega a la oleada 5' } },
  termobarica: { nombre: 'Termobárica', texto: 'Una bola de fuego que chupa el aire y estalla dos veces.', desbloqueo: { tipo: 'oleada', n: 6, texto: 'Llega a la oleada 6' } },
  // The second batch (arsenal.ts).
  pinata: { nombre: 'Piñata', texto: 'Revienta en el aire: lluvia de dulces que estallan y mucho confeti.', desbloqueo: { tipo: 'derribos', n: 10, texto: 'Derriba 10 enemigos (en total)' } },
  napalm: { nombre: 'Napalm', texto: 'Un tambor que rueda y alfombra el suelo de fuego anaranjado.', desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' } },
  humo: { nombre: 'Cortina de humo', texto: 'Un muro gris: los misiles que lo cruzan pierden el blanco y las baterías no ven.', desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' } },
  dardos: { nombre: 'Lluvia de dardos', texto: 'Se abre arriba y suelta treinta dardos de acero que caen silbando.', desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' } },
  pista: { nombre: 'Rompepistas', texto: 'Paracaídas, cohete hacia abajo y estalla bajo tierra: deja un cráter que atasca.', desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' } },
  planeadora: { nombre: 'Planeadora', texto: 'Abre alas, planea lejísimo y se tira en picada sobre el blanco.', desbloqueo: { tipo: 'oleada', n: 5, texto: 'Llega a la oleada 5' } },
  mina: { nombre: 'Mina magnética', texto: 'Flota en el mar (o espera en el suelo) y estalla cuando algo pasa cerca.', desbloqueo: { tipo: 'misiones', n: 2, texto: 'Cumple 2 misiones (en total)' } },
  sismica: { nombre: 'Sísmica', texto: 'Se entierra y hace temblar el suelo: sacude y daña todo lo que rueda cerca.', desbloqueo: { tipo: 'oleada', n: 7, texto: 'Llega a la oleada 7' } },
};
/** Bomb types in the order they unlock (the saucer's own load last). */
export const TIPOS_BOMBA = (Object.keys(BOMBAS) as BombaTipo[]).sort(
  (a, b) => (BOMBAS[a].soloOvni ? 99 : rango(BOMBAS[a].desbloqueo)) - (BOMBAS[b].soloOvni ? 99 : rango(BOMBAS[b].desbloqueo)),
);
/** Roughly which wave an unlock comes around, to sort by it. */
function rango(d: Desbloqueo | undefined) {
  if (!d) return 0;
  return d.tipo === 'oleada' ? d.n : d.tipo === 'derribos' ? 1 + d.n / 25 : d.tipo === 'misiones' ? 1.5 + d.n : 6 + d.n;
}

/** Short lock text for small cards: «Oleada 3», «3 ovnis». */
export const corto = (d: Desbloqueo | undefined) =>
  !d ? '' : d.tipo === 'oleada' ? `Oleada ${d.n}` : d.tipo === 'ovnis' ? `${d.n} ovnis` : d.tipo === 'derribos' ? `${d.n} derribos` : `${d.n} misiones`;

/** A short list of what got unlocked: «F-22 Raptor, Su-57 y 3 más». */
export function resumirNuevos(n: string[]) {
  if (n.length <= 3) return n.join(', ');
  return `${n.slice(0, 2).join(', ')} y ${n.length - 2} más`;
}

/* ── Progress kept across games ── */

export type Progreso = { oleada: number; ovnis: number; derribos: number; misiones: number };
const CLAVE = 'escuadron-dui-hangar';

export function leerProgreso(): Progreso {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    const n = (x: unknown) => Math.max(0, Math.round(Number(x) || 0));
    return { oleada: Math.max(1, Math.round(+v.oleada || 1)), ovnis: n(v.ovnis), derribos: n(v.derribos), misiones: n(v.misiones) };
  } catch {
    return { oleada: 1, ovnis: 0, derribos: 0, misiones: 0 };
  }
}

function guardarProgreso(p: Progreso) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(p));
  } catch {
    /* private mode: unlocks just last this session */
  }
}

let prog: Progreso | null = null;
const actual = () => (prog ??= leerProgreso());

export const cumple = (d: Desbloqueo | undefined, p: Progreso = actual()) => !d || p[d.tipo] >= d.n;
export const avionLibre = (id: ModeloAvion) => cumple(especDe(id).desbloqueo);
/** Unlocked, or the pilot's own plane (Naxo has his Mustang from day one). */
export const avionLibrePara = (id: ModeloAvion, p: Piloto) => CASA[p] === id || avionLibre(id);
export const bombaLibre = (t: BombaTipo, avion: ModeloAvion) => (BOMBAS[t].soloOvni ? avion === 'ovni' : cumple(BOMBAS[t].desbloqueo));

/**
 * Records progress and returns the names of what it just unlocked (planes and
 * bombs), so the game can celebrate them.
 */
export function registrar(cambio: Partial<Progreso>): string[] {
  const antes = { ...actual() };
  const p = actual();
  if (cambio.oleada !== undefined) p.oleada = Math.max(p.oleada, cambio.oleada);
  if (cambio.ovnis !== undefined) p.ovnis += cambio.ovnis;
  if (cambio.derribos !== undefined) p.derribos += cambio.derribos;
  if (cambio.misiones !== undefined) p.misiones += cambio.misiones;
  if (p.oleada === antes.oleada && p.ovnis === antes.ovnis && p.derribos === antes.derribos && p.misiones === antes.misiones) return [];
  guardarProgreso(p);
  const nuevos: string[] = [];
  for (const a of HANGAR) if (a.desbloqueo && !cumple(a.desbloqueo, antes) && cumple(a.desbloqueo, p)) nuevos.push(a.real ?? a.name);
  for (const t of TIPOS_BOMBA) {
    const d = BOMBAS[t].desbloqueo;
    if (d && !cumple(d, antes) && cumple(d, p)) nuevos.push(`Bomba ${BOMBAS[t].nombre}`);
  }
  return nuevos;
}

/** Dev/playtest: unlock everything. */
export function desbloquearTodo() {
  prog = { oleada: 99, ovnis: 99, derribos: 999, misiones: 99 };
  guardarProgreso(prog);
}

/** Fireworks and the like: one copy of the kit per trail colour, made once, so a launch picks one without allocating. */
const variantes = new WeakMap<KitMisil, KitMisil[]>();
export function kitVariante(k: KitMisil): KitMisil {
  if (!k.estelas?.length) return k;
  let vs = variantes.get(k);
  if (!vs) {
    vs = k.estelas.map((estela) => ({ ...k, estela }));
    variantes.set(k, vs);
  }
  return vs[Math.floor(Math.random() * vs.length) % vs.length];
}
