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
export type FormaMisil = 'casero' | 'aam' | 'canard' | 'pesado' | 'rp3' | 'hvar' | 'tinytim' | 'crucero';
export type LookMisil = MissileLook & { forma: FormaMisil };

/** Launch sound: the sample, the saucer's orb, the B-2's drop, or a synthesized one per family. */
export type SonidoMisil = 'misil' | 'orbe' | 'crucero' | 'aam' | 'amraam' | 'cohete' | 'tinytim' | 'maverick';

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

export type SonidoMetralla = 'metralla' | 'rifle' | 'browning' | 'vulcan' | 'canon30' | 'gau8' | 'laser';

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

export type Desbloqueo = { tipo: 'oleada' | 'ovnis'; n: number; texto: string };

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
};
/** Bomb types in the order they unlock (the saucer's own load last). */
export const TIPOS_BOMBA = (Object.keys(BOMBAS) as BombaTipo[]).sort(
  (a, b) => (BOMBAS[a].soloOvni ? 99 : BOMBAS[a].desbloqueo?.n ?? 0) - (BOMBAS[b].soloOvni ? 99 : BOMBAS[b].desbloqueo?.n ?? 0),
);

/** Short lock text for small cards: «Oleada 3», «3 ovnis». */
export const corto = (d: Desbloqueo | undefined) => (!d ? '' : d.tipo === 'oleada' ? `Oleada ${d.n}` : `${d.n} ovnis`);

/** A short list of what got unlocked: «F-22 Raptor, Su-57 y 3 más». */
export function resumirNuevos(n: string[]) {
  if (n.length <= 3) return n.join(', ');
  return `${n.slice(0, 2).join(', ')} y ${n.length - 2} más`;
}

/* ── Progress kept across games ── */

export type Progreso = { oleada: number; ovnis: number };
const CLAVE = 'escuadron-dui-hangar';

export function leerProgreso(): Progreso {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    return { oleada: Math.max(1, Math.round(+v.oleada || 1)), ovnis: Math.max(0, Math.round(+v.ovnis || 0)) };
  } catch {
    return { oleada: 1, ovnis: 0 };
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

export const cumple = (d: Desbloqueo | undefined, p: Progreso = actual()) => !d || (d.tipo === 'oleada' ? p.oleada >= d.n : p.ovnis >= d.n);
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
  if (p.oleada === antes.oleada && p.ovnis === antes.ovnis) return [];
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
  prog = { oleada: 99, ovnis: 99 };
  guardarProgreso(prog);
}
