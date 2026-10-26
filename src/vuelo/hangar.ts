/**
 * The hangar: every plane the pilots can fly, each with its own real-world
 * weapons (missile, gun, decoys and default bomb load), the bomb types, and
 * what unlocks them. Unlocks are kept across games in localStorage.
 */
import * as FA from './fisica-armas';
import type { MissileLook, Parte } from './dibujo';
import type { BombaTipo, ModeloAvion, ModeloBase } from './fisica-tipos';

const G = FA.GRAVEDAD;

export type KitMisil = {
  nombre: string;
  opts: Required<FA.OpcionesMisil>;
  /** Blast energy and damage on impact. */
  energia: number;
  dano: number;
  /** Seconds between launches. */
  cadencia: number;
  /** Drawn as a missile with this look, or as the saucer's plasma orb. */
  look: MissileLook | 'orbe';
  sonido: 'misil' | 'orbe' | 'crucero';
};

export type KitMetralla = {
  nombre: string;
  /** Muzzle speed px/s, seconds between shots, damage per hit (1 = the home planes' gun), heat per shot. */
  vel: number;
  cad: number;
  dano: number;
  calor: number;
  /** Gravity on the rounds, in g (0 = a laser). */
  gravedad: number;
  color: 'oro' | 'blanco' | 'laser';
  sonido: 'metralla' | 'vulcan' | 'canon30' | 'laser';
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

const BASE_MISIL: KitMisil = {
  nombre: 'Misil casero', opts: FA.MISIL_JUGADOR, energia: FA.ENERGIA.misilJugador, dano: 2.5, cadencia: 0.22,
  look: { cuerpo: '#e8e0d0', punta: '#ff4a5a', aletas: '#7a6a8a', largo: 11 }, sonido: 'misil',
};
const BASE_METRALLA: KitMetralla = { nombre: 'Ametralladora', vel: 680, cad: 0.075, dano: 1, calor: 0.045, gravedad: 0.06, color: 'oro', sonido: 'metralla' };
const MAGNESIO: KitBengala = { nombre: 'Bengalas de magnesio', tipo: 'magnesio', n: 3, intentos: 1 };

export const HANGAR: PlaneSpec[] = [
  {
    id: 'avioneta', pilot: 'Lulu', name: 'Avioneta Mostaza',
    blurb: 'Ágil: gira cerrado y suelta bombas seguido.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 2, bombRack: 2, flareRack: 3, reload: 1.2, bombCd: 0.5, bombs: 1, hit: 7,
    stats: { velocidad: 3, blindaje: 3, misiles: 3, bombas: 4 },
    kit: { misil: { ...BASE_MISIL, nombre: 'Cohete Mostaza' }, metralla: { ...BASE_METRALLA, nombre: 'Ametralladora .30' }, bengala: MAGNESIO },
    bomba: 'comun', sigilo: 0,
  },
  {
    id: 'caza', pilot: 'Dui', name: 'Caza Mandarina',
    blurb: 'El más veloz de la casa: deja atrás a los misiles y dispara más.',
    parts: ['cola', 'ala', 'motor'], hp: 4, rack: 3, bombRack: 1, flareRack: 3, reload: 0.85, bombCd: 0.9, bombs: 1, hit: 6,
    stats: { velocidad: 4, blindaje: 2, misiles: 4, bombas: 2 },
    kit: { misil: { ...BASE_MISIL, nombre: 'Misil Mandarina' }, metralla: { ...BASE_METRALLA, nombre: 'Ametralladora .50' }, bengala: MAGNESIO },
    bomba: 'comun', sigilo: 0,
  },
  {
    id: 'bombardero', pilot: 'Almendrita', name: 'Bombardero Nube',
    blurb: 'Lento pero blindado: suelta tres bombas de una vez.',
    parts: ['cola', 'ala', 'motor', 'cabina', 'bodega'], hp: 6, rack: 2, bombRack: 3, flareRack: 3, reload: 1.3, bombCd: 0.9, bombs: 3, hit: 9,
    stats: { velocidad: 2, blindaje: 5, misiles: 2, bombas: 5 },
    kit: { misil: { ...BASE_MISIL, nombre: 'Misil Nube' }, metralla: { ...BASE_METRALLA, nombre: 'Torreta de cola' }, bengala: MAGNESIO },
    bomba: 'comun', sigilo: 0,
  },
  {
    id: 'raptor', pilot: '', name: 'Raptor', real: 'F-22 Raptor',
    blurb: 'Caza furtivo: los radares casi no lo ven. Supercrucero y toberas vectoriales.',
    parts: ['cola', 'ala', 'motor'], hp: 4, rack: 4, bombRack: 2, flareRack: 4, reload: 0.8, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 3, misiles: 5, bombas: 2 },
    kit: {
      misil: {
        nombre: 'AIM-120 AMRAAM', opts: misil({ vMax: 340, empuje: 3.6 * G, quemado: 3.6, navegacion: 4.5, vida: 6 }),
        energia: 4.5, dano: 2.8, cadencia: 0.2, look: { cuerpo: '#f0f0f4', punta: '#8a8a9a', aletas: '#5a5a6a', largo: 13 }, sonido: 'misil',
      },
      metralla: { nombre: 'M61 Vulcan 20 mm', vel: 780, cad: 0.045, dano: 0.8, calor: 0.03, gravedad: 0.05, color: 'blanco', sonido: 'vulcan' },
      bengala: { nombre: 'Bengalas MJU-10', tipo: 'magnesio', n: 4, intentos: 1 },
    },
    bomba: 'racimo', sigilo: 0.4,
    desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' },
  },
  {
    id: 'sukhoi', pilot: '', name: 'Sukhoi', real: 'Su-57',
    blurb: 'Supermaniobrable: gira en un pañuelo. Cañón de 30 mm que pega fuerte.',
    parts: ['cola', 'ala', 'motor', 'cabina'], hp: 5, rack: 4, bombRack: 2, flareRack: 4, reload: 0.85, bombCd: 0.8, bombs: 1, hit: 6,
    stats: { velocidad: 5, blindaje: 3, misiles: 4, bombas: 3 },
    kit: {
      misil: {
        nombre: 'R-74 (corto alcance)', opts: misil({ vMax: 300, navegacion: 5.5, cargaMax: 26, cono: (110 * Math.PI) / 180 }),
        energia: 4, dano: 2.6, cadencia: 0.2, look: { cuerpo: '#d8dcc8', punta: '#3a4a3a', aletas: '#6a7a5a', largo: 11 }, sonido: 'misil',
      },
      metralla: { nombre: 'Cañón GSh-30 30 mm', vel: 640, cad: 0.11, dano: 2.2, calor: 0.06, gravedad: 0.07, color: 'oro', sonido: 'canon30' },
      bengala: { nombre: 'Trampas térmicas', tipo: 'trampa', n: 5, intentos: 1 },
    },
    bomba: 'fosforo', sigilo: 0.2,
    desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' },
  },
  {
    id: 'b2', pilot: '', name: 'Spirit', real: 'B-2 Spirit',
    blurb: 'Ala volante furtiva: bodega enorme y misiles crucero. Sin metralla.',
    parts: ['ala', 'motor', 'cabina', 'bodega'], hp: 7, rack: 2, bombRack: 5, flareRack: 4, reload: 1.6, bombCd: 1, bombs: 4, hit: 10,
    stats: { velocidad: 2, blindaje: 5, misiles: 3, bombas: 5 },
    kit: {
      misil: {
        nombre: 'Misil crucero', opts: misil({ vMax: 230, empuje: 2.4 * G, quemado: 7, navegacion: 3, vida: 9 }),
        energia: 10, dano: 5, cadencia: 0.5, look: { cuerpo: '#4a4a56', punta: '#2a2a32', aletas: '#6a6a7a', largo: 15 }, sonido: 'crucero',
      },
      metralla: null,
      bengala: { nombre: 'Chaff (dipolos)', tipo: 'chaff', n: 4, intentos: 2 },
    },
    bomba: 'racimo', sigilo: 0.6,
    desbloqueo: { tipo: 'oleada', n: 5, texto: 'Llega a la oleada 5' },
  },
  {
    id: 'ovni', pilot: '', name: 'Platillo', real: 'OVNI',
    blurb: 'Tecnología de otro mundo: rayo láser, orbes de plasma y hologramas.',
    parts: ['cabina', 'motor', 'ala'], hp: 5, rack: 3, bombRack: 3, flareRack: 4, reload: 0.9, bombCd: 0.9, bombs: 1, hit: 7,
    stats: { velocidad: 4, blindaje: 4, misiles: 5, bombas: 4 },
    kit: {
      misil: {
        nombre: 'Orbe de plasma', opts: misil({ vMax: 300, quemado: 5, navegacion: 6, cargaMax: 30, cono: (150 * Math.PI) / 180, vida: 7 }),
        energia: 5, dano: 3, cadencia: 0.25, look: 'orbe', sonido: 'orbe',
      },
      metralla: { nombre: 'Rayo láser', vel: 1300, cad: 0.07, dano: 0.9, calor: 0.05, gravedad: 0, color: 'laser', sonido: 'laser' },
      bengala: { nombre: 'Hologramas', tipo: 'holograma', n: 2, intentos: 3 },
    },
    bomba: 'plasma', sigilo: 0.3,
    desbloqueo: { tipo: 'ovnis', n: 3, texto: 'Derriba 3 ovnis' },
  },
];

export const especDe = (id: ModeloAvion): PlaneSpec => HANGAR.find((p) => p.id === id) ?? HANGAR[1];

/** Pilot names by their home plane. */
export const PILOTO: Record<ModeloBase, string> = { avioneta: 'Lulu', caza: 'Dui', bombardero: 'Almendrita' };

export type BombaInfo = { nombre: string; texto: string; desbloqueo?: Desbloqueo; soloOvni?: boolean };
export const BOMBAS: Record<BombaTipo, BombaInfo> = {
  comun: { nombre: 'Bomba común', texto: 'Una explosión grande y un cráter.' },
  racimo: { nombre: 'Racimo', texto: 'Se abre en el aire y siembra siete bombitas.', desbloqueo: { tipo: 'oleada', n: 2, texto: 'Llega a la oleada 2' } },
  fosforo: { nombre: 'Fósforo blanco', texto: 'Deja el suelo ardiendo unos segundos.', desbloqueo: { tipo: 'oleada', n: 3, texto: 'Llega a la oleada 3' } },
  gas: { nombre: 'Gas', texto: 'Una nube verde que se mueve con el viento y daña lo que toca.', desbloqueo: { tipo: 'oleada', n: 4, texto: 'Llega a la oleada 4' } },
  plasma: { nombre: 'Plasma', texto: 'La carga del platillo: un estallido violeta enorme.', soloOvni: true },
};
export const TIPOS_BOMBA = Object.keys(BOMBAS) as BombaTipo[];

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
    if (d && !cumple(d, antes) && cumple(d, p)) nuevos.push(`Bomba ${BOMBAS[t].nombre.toLowerCase()}`);
  }
  return nuevos;
}

/** Dev/playtest: unlock everything. */
export function desbloquearTodo() {
  prog = { oleada: 99, ovnis: 99 };
  guardarProgreso(prog);
}
