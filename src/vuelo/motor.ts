import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { callarJuegoSi, sfxVuelo as sfx } from '../game/audio';
import * as S from './sonido';
import * as AB from './audio-batalla';
import * as IA from './ia';
import * as AE from './aereos';
import * as VFX from './efectos';
import * as G from './gigantes';
import * as JF from './jefes';
import * as CZ from './cazas';
import * as OC from './oceano';
import * as VP from './valparaiso';
import * as L from './luces';
import { drawPlaneGiro } from './giro';
import * as A from './dibujo';
import type { Parte, Premio, VehiculoTipo } from './dibujo';
import * as FV from './fisica-vuelo';
import * as FA from './fisica-armas';
import * as MS from './misiles';
import * as E from './estelas';
import { dibujarFondo, nombreZona, precalentarFondo, zonaAltitud } from './fondo';
import type { Avion, Cuerpo, Mando, Misil, ModeloAvion, ModeloBase, Movil, Vehiculo, Bomba, BombaTipo } from './fisica-tipos';
import * as HG from './hangar';
import * as AD from './armas-dibujo';
import { dibujarTransicion, precalentarTransicion, type MapaId } from './transiciones';

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

export type PlaneSpec = HG.PlaneSpec;

/** The pilots, each with the plane they fly from home (the character select). */
const PRESENTA: Record<ModeloBase, string> = {
  avioneta: 'Lulu, la gatita negra de ojos amarillos. Ágil: gira cerrado y suelta bombas seguido.',
  caza: 'Dui, el gato naranja. El más veloz: deja atrás a los misiles y dispara más.',
  bombardero: 'Almendrita, la yorkshire. Lenta pero blindada: suelta tres bombas de una vez.',
};
export const PLANES: (PlaneSpec & { id: ModeloBase })[] = (['avioneta', 'caza', 'bombardero'] as const).map((id) => ({ ...HG.especDe(id), id, blurb: PRESENTA[id] }));

/** What the hangar shows: the plane and bomb picked, and what's unlocked. */
export type HangarInfo = {
  avion: ModeloAvion;
  bomba: BombaTipo;
  piloto: ModeloBase;
  libres: ModeloAvion[];
  bombas: BombaTipo[];
};

export type Hud = {
  /** The mice's radio chatter on screen, if any. */
  radio: { quien: string; texto: string } | null;
  /** The plane, its weapons and the hangar picks. */
  hangar: HangarInfo;
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
  /** Special upgrade running, with seconds left. */
  boost: string;
  boostT: number;
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
  /** Nuclear bombs in the hold. */
  nukes: number;
  /** ⭐ upgrade points, levels, and whether the shop is open. */
  mejoras: { puntos: number; niv: Record<Mejorable, number>; tienda: boolean; coraza: number };
  /** Boarding or rolling on the home runway (the bottom-left must stay clear). */
  enTierra: boolean;
  /** Ice 0…1 near the ceiling, and whether the controls are frozen. */
  hielo: number;
  congelado: boolean;
  /** Zoom: how many levels there are and which one is on. */
  zoom: [number, number];
  /** Throttle input: -1 brake, 0 cruise, 1 full power. */
  throttle: number;
  boss: { name: string; hp: number } | null;
  banner: string;
  /** Current contextual hint text, and the wave's mini-mission. */
  pista: string;
  mision: { texto: string; prog: number; meta: number; hecha: boolean; fallida: boolean } | null;
  /** End-of-wave card while the break lasts, and whether the trip to a new map is on. */
  resumen: Resumen | null;
  viaje: boolean;
};

export type Result = { pilot: string; score: number; best: number; wave: number; kills: number; reason: 'avion' | 'despensa'; record: boolean };

export type Controls = { x: number; y: number; gas: number; fire: boolean; bomb: boolean; flare: boolean; gun: boolean; nuke: boolean; tonel: boolean };

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
const LIVES = 4;
/** Upgrades bought with ⭐ points between waves: each stat goes 0…5, a level costs level+1. */
export type Mejorable = 'dano' | 'salud' | 'defensa' | 'municion';
const NIVEL_MAX = 5;
/** The home runway on the San Antonio map (world x). */
const PISTA0 = 110;
const PISTA1 = 420;

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
type Arma = Exclude<Premio, 'reparar' | 'especial' | 'vida' | 'nuclear'>;
const CAP_MAX: Record<Arma, number> = { misil: 8, bomba: 6, bengala: 6 };
const PRIZE_NAME: Record<Arma, string> = { misil: 'misil', bomba: 'bomba', bengala: 'bengala' };
const BOMB_RELOAD = 2.2;
/** Special upgrades from a downed fighter's golden balloon. */
type Mejora = 'doble' | 'escudo' | 'cohetes' | 'chorrillana' | 'bombas' | 'bengalas' | 'furia' | 'iman' | 'lluvia';
const MEJORA: Record<Mejora, { nombre: string; t: number }> = {
  doble: { nombre: 'Metralla doble sin calentarse', t: 20 },
  escudo: { nombre: 'Escudo de burbuja', t: 10 },
  cohetes: { nombre: 'Misiles sin fin', t: 15 },
  chorrillana: { nombre: 'Chorrillana: misil triple', t: 10 },
  bombas: { nombre: 'Bombas ilimitadas', t: 15 },
  bengalas: { nombre: 'Bengalas sin fin', t: 15 },
  furia: { nombre: 'Furia: daño doble', t: 15 },
  iman: { nombre: 'Imán de premios', t: 20 },
  lluvia: { nombre: 'Lluvia de bombas: ×3', t: 12 },
};
/** Super nitro: how long it burns, its push, and the recharge time. */
const NITRO_T = 3;
const NITRO_ACC = 4.2 * FA.GRAVEDAD;
const NITRO_CD = 9;
/** A flare burst: how many flares, and the beat between them (s). */
const SALVA_N = 8;
const SALVA_DT = 0.075;
/** Seconds of free fall before the nuke's parachute opens. */
const NUKE_CAIDA = 0.55;
/** How long the engine-cooling glow lasts after braking hard, s. */
const ENFRIA_T = 1.4;
/** Seconds holding the nose on an enemy before the missiles lock on. */
const LOCK_TIME = 0.4;
/** The trip to a new map: seconds of autopilot, with the nitro lit one second in. */
const TRANS_T = 3.4;
const FLARE_RELOAD = 4;
/** Highest altitude the plane can fly: a tall sky, taller than the screen. */
const CEIL = 3000;
/** Freezing near the ceiling: where the cold starts, how fast the ice grows and melts. */
const FRIO_DESDE = CEIL - 380;
const HIELO_SUBE = 0.22;
const HIELO_BAJA = 0.35;

const sm = (a: number, b: number, v: number) => {
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** San Antonio from inland to the coast: San Juan, the flat Llolleo wetland,
 *  the Barrancas rise, the flat port quay and Cartagena's lower beach. */
const hillsAt = (x: number) => {
  const wob = 8 * Math.sin(x / 170) + 4 * Math.sin(x / 53 + 2) + 1.5 * Math.sin(x / 23);
  let h = 28 + wob * (1 - 0.6 * sm(400, 600, x) * (1 - sm(1000, 1150, x)));
  h += 26 * sm(1100, 1350, x) * (1 - sm(1550, 1750, x));
  const port = sm(1700, 1800, x) * (1 - sm(2650, 2750, x));
  h = h * (1 - port) + 30 * port - 6 * sm(2750, 2900, x);
  // Flat around the pantry.
  const k = Math.min(1, Math.max(0, (x - 150) / 140));
  return 28 + (h - 28) * k;
};
// The terrain as a height per column, so explosions can dig craters in it
// (like in Worms). Reset at the start of every game.
const HEIGHTS = new Float32Array(LEVEL + 2);
/** The two maps: the valley (hills) and, after the first boss, the open sea. */
type Mapa = 'valle' | 'oceano' | 'valparaiso' | 'tormenta';
/** One map per wave, then round again (harder): San Antonio → sea → Valparaíso → storm. */
/** «¿Sabías que…?» — verified facts about each place (sources in the research brief). */
const DATOS: Record<Mapa, string[]> = {
  valle: [
    'Mucho antes de los gatos, aquí vivieron las culturas Bato y Llolleo, ¡hace más de 1.500 años!',
    'Llolleo significaría «lugar de pesca» en mapudungun.',
    'En 1865 San Antonio reemplazó a Valparaíso como puerto principal durante la guerra con España.',
    'El 5 de mayo de 1912 se puso la primera piedra del puerto, y ese mismo día llegó el tren.',
    'Las piedras para construir los molos bajaban en tren desde el cerro Panul.',
    'Hoy San Antonio es el puerto n.º 1 de Chile en contenedores.',
    'Cartagena es comuna desde el 10 de agosto de 1901.',
    '¡Cartagena es el balneario más antiguo de Chile! Desde 1850 veraneaban aquí los santiaguinos.',
    'Antes del tren a Cartagena había «carritos de sangre»: carros tirados por caballos.',
    'El poeta Vicente Huidobro descansa en un cerro de Cartagena, mirando al mar.',
  ],
  oceano: [
    'Hoy San Antonio es el puerto n.º 1 de Chile en contenedores.',
    'Las piedras para construir los molos de San Antonio bajaban en tren desde el cerro Panul.',
    'Desde 1999 el borde costero de Cartagena es Zona Típica.',
    'Los fuegos de Año Nuevo en el Mar, en la bahía de Valparaíso, duran unos 20 minutos.',
  ],
  valparaiso: [
    'Desde 2003 el casco histórico de Valparaíso es Patrimonio Mundial de la UNESCO.',
    'El Ascensor Concepción funciona desde 1883: ¡el más antiguo de la ciudad!',
    'El primer cuerpo de bomberos de Chile se formó en Valparaíso, en 1851.',
    'El Mercurio de Valparaíso (1827) es el diario en castellano más antiguo que sigue circulando.',
    'Santiago Wanderers (1892) es «el Decano», el club profesional más antiguo de Chile.',
    'La primera bolsa de comercio de Chile abrió en Valparaíso.',
    'Neruda inauguró La Sebastiana el 18 de septiembre de 1961… ¡con empanadas!',
  ],
  tormenta: [
    'Los fuegos de Año Nuevo en el Mar, en la bahía de Valparaíso, duran unos 20 minutos.',
    'Desde 2003 el casco histórico de Valparaíso es Patrimonio Mundial de la UNESCO.',
  ],
};
const datoDe = (m: Mapa) => DATOS[m][Math.floor(Math.random() * DATOS[m].length)];
const SIGUIENTE: Record<Mapa, Mapa> = { valle: 'oceano', oceano: 'valparaiso', valparaiso: 'tormenta', tormenta: 'valle' };
const NOMBRE_MAPA: Record<Mapa, string> = { valle: 'San Antonio', oceano: 'el mar de San Antonio', valparaiso: 'los cerros de Valparaíso', tormenta: 'la tormenta: solo cazas' };
/** Most planes the player can bank. */
const MAX_VIDAS = 5;
/** End of the pantry's island on the sea map; past it there's only water. */
const ISLA = 150;
const islandAt = (x: number) => (x < 110 ? 30 : x < ISLA ? OC.NIVEL_MAR + (30 - OC.NIVEL_MAR) * (1 - (x - 110) / (ISLA - 110)) : OC.NIVEL_MAR);
let mapaActual: Mapa = 'valle';
/** The untouched terrain of the current map (craters dig below it). */
const baseAt = (x: number) => (mapaActual === 'oceano' || mapaActual === 'tormenta' ? islandAt(x) : mapaActual === 'valparaiso' ? VP.cerrosAt(x) : hillsAt(x));
const resetHeights = () => {
  for (let x = 0; x < HEIGHTS.length; x++) HEIGHTS[x] = baseAt(x);
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
  lancha: { speed: 34, hp: 0.8, masa: 1, score: 120, cd: 3, color: '#b49af4' },
  fragata: { speed: 12, hp: 1.8, masa: 4, score: 300, cd: 4.6, color: '#b49af4' },
  portaaviones: { speed: 8, hp: 30, masa: 20, score: 5000, cd: 99, color: '#f08a94' },
  trolebus: { speed: 16, hp: 1.4, masa: 3, score: 200, cd: 4.2, color: '#b49af4' },
  bici: { speed: 52, hp: 0.5, masa: 0.6, score: 150, cd: 3.6, color: '#b49af4' },
  micro: { speed: 22, hp: 1.2, masa: 2.5, score: 180, cd: 3.8, color: '#b49af4' },
  portuario: { speed: 15, hp: 1.6, masa: 4, score: 220, cd: 4.6, color: '#b49af4' },
};
/** Which land vehicle's missile catalogue each kind uses. */
const ARMA_DE: Record<VehiculoTipo, 'jeep' | 'camion' | 'tanque' | 'sam'> = {
  jeep: 'jeep', camion: 'camion', tanque: 'tanque', sam: 'sam', margarita: 'jeep', lancha: 'jeep', fragata: 'sam', portaaviones: 'sam', trolebus: 'camion', bici: 'jeep', micro: 'jeep', portuario: 'camion',
};
/** Margarita on foot or at the helm of her aircraft carrier. */
const isBoss = (k: VehiculoTipo) => k === 'margarita' || k === 'portaaviones';

/* The sky theme changes every wave. */
type Theme = 'dia' | 'tarde' | 'noche';
const THEMES: Theme[] = ['dia', 'tarde', 'noche'];

/* ── The boss: neighbour Margarita ──────────────────────────────────────── */

// She shows up when waves 2, 5, 8… are cleared, and comes back tougher.
const BOSS_EVERY = 3;
/** The mice's radio chatter and their cries when they bail out. */
const RADIO = {
  llegan: ['¡Escuadrilla Queso, al ataque!', '¡Ahí está el gato! ¡Rodéenlo!', '¡Formación cerrada, muchachos!', '¡Contacto! ¡Gato a las doce!', '¡Por el queso y la patria ratona!'],
  fox: ['¡Fox dos! ¡Misil en el aire!', '¡Lo tengo! ¡Disparo!', '¡Toma esto, minino!', '¡Misil fuera!'],
  fijado: ['¡Me tiene fijado! ¡Ayuda!', '¡Tengo al gato en la cola!', '¡Sáquenmelo de encima!', '¡Me fijó! ¡Me fijó!'],
  bengalas: ['¡Bengalas, bengalas!', '¡Misil en mi cola! ¡Bengalas!', '¡Rompo a la izquierda!'],
  caido: ['¡Me dieron! ¡Me eyecto!', '¡Perdimos a uno! ¡Paracaídas abierto!', '¡Noooo, mi avioncito!', '¡Ratón al aire, repito, ratón al aire!', '¡Base, nos derriban!'],
  grito: ['¡Noooo!', '¡Noooooo!', '¡Mi quesito!', '¡Auxilio!', '¡Me eyecto!'],
};

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
    '¡Bajen el volumen, que se me vuela la permanente!',
    '¡Esa micro pasa cuando quiere, igual que ustedes!',
    '¡Gaviota ladrona, devuélveme el pan amasado!',
    '¡Otra vez asado el domingo! ¡Mi ropa huele a choripán!',
    '¡Ciento veinte escalones para esto! $&#%',
    '¡Gatos voladores en MI cerro, nunca!',
    '¡Esta camanchaca me pasmó la ropa tendida!',
    '¡En Cartagena no cabe ni un quitasol más!',
    '¡Las grúas del puerto hacen menos ruido que ustedes!',
    '¡Les cobro el ascensor, gatitos!',
    '¡Mi chorrillana se enfría por su culpa!',
    '¡Feliz Año Nuevo… pero en silencio!',
  ],
  /** What the mice shout now and then. */
  ratones: [
    '¡Al abordaje, ratitas!', '¡Por el queso de Llolleo!', '¡Súbanse al ascensor!', '¡Cuidado, una gaviota!', '¡Se nos fue la micro!',
    '¡Retirada al contenedor!', '¡Viene Almendrita!', '¡Más rápido que un lobo marino!', '¡Escóndanse en la camanchaca!', '¡Queso con palta, ya!',
  ],
  hurt: ['¡Ay, mi cadera! $%&', '¡Mis tomates! #&%$', '¡Esto se lo cuento a todo el pasaje!', '¡Mis lentes! ¡No veo nada! &%#'],
  defeat: '¡Esto no se queda así! ¡Voy a llamar a los carabineros! #$%&',
  duelo: '¡Ahora en caza, ricachón! ¡Uno contra uno, como en mis tiempos! &%$#',
  dueloHurt: ['¡Mi caza nuevo! ¡Lo compré en cuotas! #&%', '¡No me rayes la pintura! $%&', '¡Te voy a acusar a la junta de vecinos!', '¡Con mi gorro no te metas! &%#'],
  dueloFin: '¡Me eyecto! ¡Esto lo arreglo en el almacén de la esquina! #$%&',
  /** At the helm of the aircraft carrier. */
  mar: '¡Ahoy, ricachones! ¡Este portaaviones es de la junta de vecinos! &%#',
  despegue: ['¡Despeguen, ratones! ¡Y sin hacer ruido!', '¡A ese gato naranjo, rápido! $#@', '¡Ni en el mar me dejan tranquila! &%#'],
  hundida: '¡Mi portaaviones! ¡Voy a llamar a la Armada! #&%$',
  /** At sea she complains about sea things. */
  tauntsMar: [
    '¡Ricachones voladores! ¡Esto es aguas de la junta de vecinos! &%#',
    '¡Mis misiles bumerán siempre vuelven! ¡Como el olor a pescado frito!',
    '¡Las gaviotas se comieron mi sánguche! $#@',
    '¡Bajen la velocidad, que me marean! %&#',
    '¡Este barco tiene más reglas que el edificio! #$%',
    '¡Gato naranjo! ¡Te vi en el techo de la caleta! &#',
  ],
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
const BOSS_MUL: Record<ModeloAvion, number> = { avioneta: 1.2, caza: 1, bombardero: 1.6, raptor: 1, sukhoi: 1, b2: 1.3, ovni: 1.1, tomcat: 1.1, a10: 1.5, spitfire: 1.1 };
// Enemy missiles carry their type (misiles.ts); the player's are plain rockets.
type Shot = ({ m: Misil; enemy: false; tgt: null; trail: number } | { m: MS.MisilEnemigo; enemy: true; tgt: Movil | null; trail: number }) & {
  estela?: E.Estela;
  /** Stable id for its chase sound, and whether its near-miss whoosh already played. */
  id?: number;
  pasada?: boolean;
  /** Seconds the plane has been outrunning it, and whether it gave up. */
  cola?: number;
  gap?: number;
  /** Boomerang missiles (the carrier's): loops left to come back after a miss, and the loop in progress. */
  vueltas?: number;
  girando?: number;
  /** Passed within a hair of the plane, and whether the «¡Uf!» was paid. */
  cerca?: boolean;
  uf?: boolean;
  /** The player's missile homes on this target when it was fired with a lock. */
  lock?: Fijable;
  gap2?: number;
  perdido?: boolean;
  /** The player's missile: which one of the plane's kit. Enemy seekers: already rolled against stealth. */
  k?: HG.KitMisil;
  sigilo?: boolean;
  /** A spent enemy missile falling under gravity. */
  cae?: boolean;
  /** Enemy seeker: timer for its next look at flares already in the air. */
  mira?: number;
  /** The player's missile: got its target over the datalink; seeker scan timer. */
  enlace?: boolean;
  busca?: number;
};
/** A falling bomb of the player's, with its load; bomblets are the cluster's children. */
type BombaJ = Bomba & { tipo: BombaTipo; sub?: boolean; rebotes?: number };
/** Burning phosphorus on the ground or a drifting gas cloud: hurts what's inside for a while. */
type Zona = { tipo: 'fuego' | 'gas' | 'hielo' | 'emp'; x: number; y: number; r: number; t: number; vida: number; tick: number };
type Bala = Cuerpo & { life: number; d: number; g: number; c: HG.KitMetralla['color'] };
let shotIds = 0;

// Trail style per missile type, shortened a little so phones keep 60 fps.
const trailStyles = new Map<string, E.EstiloEstela>();
const trailStyle = (sh: Shot) => {
  const bumeran = sh.enemy && sh.vueltas !== undefined;
  const key = bumeran ? 'bumeran' : sh.enemy ? sh.m.tipo : 'jugador';
  let st = trailStyles.get(key);
  if (!st) {
    // Margarita's boomerangs leave a white-and-yellow trail of their own.
    const base = bumeran
      ? { ...MS.MISILES.buscador.estela, nucleo: '#ffffff', brillo: '#ffe048', humo: '#fff6c8' }
      : sh.enemy ? MS.MISILES[sh.m.tipo].estela : E.ESTELA_JUGADOR;
    st = { ...base, largo: Math.min(base.largo + 8, sh.enemy ? 32 : 38) };
    trailStyles.set(key, st);
  }
  return st;
};
type Shell = Cuerpo & { fuse: number };
type Puff = Cuerpo & { r: number; life: number; dark: boolean };
type Shard = Cuerpo & { c: string };
/** What the end-of-wave card shows. */
export type Resumen = {
  oleada: number; enemigos: number; puntos: number; tiempo: number; pescado: number; aviones: number;
  /** The map the plane flies off to after this card, if any. */
  destino: '' | Mapa;
  /** The wave's mini-mission and whether it was done; what comes next. */
  mision: string; cumplida: boolean; siguiente: string;
  /** A verified local fact about the place, for the card. */
  dato: string;
  /** Planes or bombs this wave unlocked in the hangar. */
  nuevos?: string[];
};
/** A small optional goal for the current wave. */
type MisionId = 'despensa' | 'combo3' | 'misiles' | 'cazas' | 'piezas';
type Mision = { id: MisionId; texto: string; meta: number; prog: number; hecha: boolean; fallida: boolean };
/** Contextual hints, each shown until the player has done it twice. */
type PistaId = 'girar' | 'disparar' | 'fijar' | 'bengala' | 'nitro';
const PISTAS_KEY = 'vuelo-pistas';
function readPistas(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PISTAS_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
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
  pilot: ModeloBase;
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
  mapa?: Mapa;
  puntosMejora?: number;
  niv?: Record<Mejorable, number>;
  enValpo?: boolean;
  avion?: ModeloAvion;
  bomba?: BombaTipo;
  at: number;
};

export function readSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as SavedGame;
    if (g && g.bomba !== undefined && !(g.bomba in HG.BOMBAS)) g.bomba = undefined;
    if (g?.v !== 1 || !PLANES.some((p) => p.id === g.pilot) || (g.avion !== undefined && !HG.HANGAR.some((p) => p.id === g.avion)) || !(g.wave >= 1) || !(g.lives >= 1) || !(g.meta >= 1)) return null;
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
  const view = { vw: 400, vh: 240, s: 2, levels: [2], zi: 0, touch: false, want: 1 };
  mapaActual = 'valle';
  resetHeights();
  const valleStrip = A.groundStrip(LEVEL, ground, PANTRY);
  let strip = valleStrip;
  // An untouched copy, to repaint the ground when a new game starts.
  const pristine = document.createElement('canvas');
  pristine.width = strip.canvas.width;
  pristine.height = strip.canvas.height;
  pristine.getContext('2d')!.drawImage(strip.canvas, 0, 0);
  let sg = strip.canvas.getContext('2d')!;
  let marStrip: { canvas: HTMLCanvasElement; top: number } | null = null;
  let valpoStrip: { canvas: HTMLCanvasElement; top: number } | null = null;

  /** Switches the terrain, the painted strip and the backdrop to a map. */
  function cambiarMapa(m: Mapa) {
    mapaActual = m;
    s.mapa = m;
    resetHeights();
    if (m === 'oceano') {
      // A new voyage starts off San Antonio again.
      s.enValpo = false;
      s.costa = 0;
    }
    if (m === 'oceano' || m === 'tormenta') {
      // The storm is over the open sea, hidden under a floor of dark cloud.
      marStrip ??= OC.aguaStrip(LEVEL, ground, PANTRY);
      strip = marStrip;
    } else if (m === 'valparaiso') {
      // Painted fresh on every visit, so old craters don't linger on the hillside.
      valpoStrip = VP.valpoStrip(LEVEL, ground, PANTRY);
      strip = valpoStrip;
    } else {
      strip = valleStrip;
      strip.canvas.getContext('2d')!.clearRect(0, 0, strip.canvas.width, strip.canvas.height);
      strip.canvas.getContext('2d')!.drawImage(pristine, 0, 0);
    }
    sg = strip.canvas.getContext('2d')!;
    s.craters = [];
    s.bridges = [];
  }
  /** Splash columns where things hit the sea: screen-independent, world coords. */
  const splashes: { x: number; t: number }[] = [];
  /** The minimap's terrain, cached until the ground changes. */
  const miniTerreno = { clave: '', cv: document.createElement('canvas') };
  /** Scratch canvas to tint a sinking plane blue. */
  const aguaTinte = Object.assign(document.createElement('canvas'), { width: 80, height: 60 });
  /** True over open sea (not the island). */
  const sobreMar = (x: number) => (mapaActual === 'oceano' || mapaActual === 'tormenta') && x > ISLA;
  let chapoteoT = 0;
  let rozarT = 0;
  /** A small spout where a bullet or a pellet hits the water, with a quiet plop now and then. */
  function chapoteo(x: number, fuerza: number) {
    VFX.salpicar(s.fx, x, OC.NIVEL_MAR, fuerza, still || s.calma);
    if (splashes.length < 30 && Math.random() < 0.35) splashes.push({ x, t: 0.45 });
    if (!s.attract && chapoteoT <= 0) {
      chapoteoT = 0.12;
      AB.salpicadura(panOf(x), 0.4);
    }
  }

  /** Digs a round crater into the terrain and the painted ground strip. */
  function crater(x: number, y: number, r: number, log = true) {
    r = Math.round(r);
    if (r < 3 || x < PANTRY.x1 + 20) return;
    // The sea doesn't dig: it splashes.
    if (mapaActual === 'oceano' || mapaActual === 'tormenta') {
      if (splashes.length < 30) splashes.push({ x, t: 0 });
      VFX.salpicar(s.fx, x, OC.NIVEL_MAR, Math.min(3, r / 6), still || s.calma);
      if (!s.attract) AB.salpicadura(panOf(x), Math.min(4, r / 5));
      return;
    }
    if (log && s.craters.length < 400) s.craters.push([Math.round(x), Math.round(y), r]);
    const row = (alt: number) => strip.top - alt;
    sg.globalCompositeOperation = 'destination-out';
    D.disc(sg, x, row(y), r, '#000');
    sg.globalCompositeOperation = 'source-over';
    for (let xi = Math.max(0, Math.round(x - r)); xi <= Math.min(LEVEL, Math.round(x + r)); xi++) {
      const dx = xi - x;
      const bottom = y - Math.sqrt(Math.max(0, r * r - dx * dx));
      // Craters stay shallow enough for the mice to drive out of.
      if (HEIGHTS[xi] > bottom) HEIGHTS[xi] = Math.max(4, bottom, baseAt(xi) - 18);
      // A scorched rim of deep dirt along the new surface.
      const h = Math.round(HEIGHTS[xi]);
      // The disc may have cut below the capped floor: fill that back with deep earth.
      const hueco = row(Math.round(bottom)) - (row(h) + 3);
      if (hueco > 0) A.R(sg, xi, row(h) + 3, 1, hueco + 1, P.d1);
      A.R(sg, xi, row(h), 1, 1, P.d0);
      A.R(sg, xi, row(h) + 1, 1, 2, P.d1);
    }
  }
  const input: Controls = { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false, gun: false, nuke: false, tonel: false };
  const keys = new Set<string>();

  const s = {
    mode: 'demo' as 'demo' | 'play' | 'over',
    paused: false,
    t: 0,
    spec: PLANES[0] as PlaneSpec,
    piloto: 'avioneta' as ModeloBase,
    bomba: 'comun' as BombaTipo,
    zonas: [] as Zona[],
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
    flares: 3,
    /** Weapon slots (grow with reward balloons) and bombs in the bay. */
    cap: { misil: 2, bomba: 2, bengala: 3 } as Record<Arma, number>,
    bombAmmo: 2,
    bombReloadT: 0,
    /** Reward balloons: tied to enemies (by id) and floating free. */
    carPrize: new Map<number, Premio>(),
    airPrize: new Map<number, Premio>(),
    prizes: [] as (Cuerpo & { kind: Premio; hielo?: number })[],
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
    bombs: [] as BombaJ[],
    bullets: [] as Bala[],
    heat: 0,
    hot: false,
    gunT: 0,
    gunWasDown: false,
    mapa: 'valle' as Mapa,
    /** Along the coast at sea: 0 off San Antonio … 1 at Valparaíso; seconds sailed. */
    costa: 0,
    viaje: 0,
    enValpo: false,
    transT: 0,
    /** Silent help 0…1: rises when planes are lost, eases off on clean waves. */
    ayuda: 0,
    deathsWave: 0,
    slowT: 0,
    lastHit: 'misil' as 'misil' | 'bala' | 'suelo' | 'jefe' | 'choque',
    mision: null as Mision | null,
    wavePrizes: 0,
    waveSize: 0,
    pistas: readPistas(),
    pista: '' as '' | PistaId,
    usos: { girar: 0, disparar: 0, fijar: 0, bengala: 0, nitro: 0 } as Record<PistaId, number>,
    calma: false,
    /** Turns off the backdrop filter (debug / preference). */
    sinFiltro: false,
    /** Ice on the plane 0…1 near the top of the sky; at 1 the controls freeze until it thaws. */
    hielo: 0,
    /** Aerobatics: the barrel roll in progress (s), its cooldown, and the loop counter (rad). */
    tonelT: 0,
    tonelCd: 0,
    tonelUlt: -9,
    giroAcc: 0,
    giroQuieto: 0,
    tonelWasDown: false,
    /** ⭐ upgrade points and the levels bought; the shop holds the break open while it's up. */
    puntosMejora: 0,
    niv: { dano: 0, salud: 0, defensa: 0, municion: 0 } as Record<Mejorable, number>,
    coraza: 0,
    tienda: false,
    /** The mothership came because the plane lingered in space (not the level's boss). */
    jefeEspacio: false,
    /** Seconds the plane has been far below the UFOs: after a while they leave. */
    lejosT: 0,
    /** Bumped on every new game: deferred effects from an older one are dropped. */
    gen: 0,
    /** A new game starts at home: the pilot walks out and climbs in, then the player takes off from the runway. */
    despegue: '' as '' | 'subiendo' | 'pista',
    despT: 0,
    /** Seconds after lift-off with the nose held up and no ground crash. */
    gracia: 0,
    vrAvisado: false,
    gritoT: 0,
    /** Storm: seconds to the next strike, the bolt in progress, the sky flash. */
    rayoT: 6,
    rayo: null as { x: number; t: number; tope: number } | null,
    relampago: 0,
    /** Nuclear bombs in the hold (from UFOs) and the press edge. */
    nukes: 0,
    nukeWasDown: false,
    cargaSuave: 1,
    congelado: false,
    luces: L.crearLuces(),
    /** Attract mode: the title screen's background, a game flown by an autopilot. */
    attract: false,
    waveStartT: 0,
    resumen: null as Resumen | null,
    nuevos: [] as string[],
    flashMap: 0,
    /** The reveal after a map trip (1 → 0 over a second): the curtain clears off the new place. */
    revelar: 0,
    /** The map to fly off to at the next wave (the nitro trip), if any. */
    toMapa: '' as '' | Mapa,
    boost: '' as '' | Mejora,
    boostT: 0,
    nitroT: 0,
    /** Engine spooling down after braking hard (or cutting the nitro), s left; and whether the brake was already held. */
    enfriaT: 0,
    frenoAntes: false,
    nitroCd: 0,
    lockCand: null as Fijable | null,
    lockKey: null as object | null,
    lockT: 0,
    vaporT: 0,
    shells: [] as Shell[],
    flareBodies: [] as (Cuerpo & { tipo: HG.BengalaTipo })[],
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
    /** The one-on-one duel with Margarita's fighter is on: nothing else spawns. */
    duelo: false,
    /** Press edges of missile and bomb, for the dry click when they aren't ready. */
    fireWasDown: false,
    bombWasDown: false,
    /** Pilots who bailed out: popping up, then drifting down under a parachute. */
    eyectados: [] as { x: number; y: number; vx: number; vy: number; t: number; jefa: boolean }[],
    /** The mice's radio chatter: who's talking, the line, and how long it's been up. */
    radio: null as { quien: string; texto: string; t: number } | null,
    /** Seconds until a fighter may drop another special-upgrade balloon. */
    especialCd: 0,
    /** Flares the enemy pops to shake off the player's missiles, and each flyer's cooldown (by object). */
    bengalasR: [] as (Cuerpo & { t: number })[],
    bengalaCd: new Map<object, number>(),
    /** Phones: the gun fires by itself at whatever is in the sights. */
    autoGun: false,
    /** The storm clears halfway through its wave: 0 = full storm, 1 = clear moonlit night. */
    despeje: 0,
    tormentaTot: 0,
    /** A flare burst in progress: next flare, its timer, and seekers fooled so far. */
    salva: null as { i: number; t: number; enganados: number } | null,
    /** The nuclear bomb on its way down under a parachute. */
    nuke: null as { x: number; y: number; vx: number; vy: number; t: number } | null,
    /** Inside a blast that pays no points (a stray falling missile). */
    sinPremio: false,
    /** Inside a bomb's own blast (the carrier is weak to bombs, not to every big bang). */
    golpeBomba: false,
    /** The plane went into the sea: where it entered, and its heading as it sinks. */
    hundido: null as { x: number; vx: number; ang: number } | null,
    /** Where the last spent missile came down (dev checks). */
    caidaXY: [0, 0] as [number, number],
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
  // The self-playing game behind the title menu makes no sound.
  callarJuegoSi(() => s.attract || s.mode !== 'play');

  /* ── Sizing ── */

  function fit() {
    const cw = Math.max(1, box.clientWidth);
    const ch = Math.max(1, box.clientHeight);
    let sc = Math.max(1, Math.round(ch / 250));
    while (sc > 1 && cw / sc < 300) sc--;
    // Zooming out drops to smaller whole-number scales down to 1:1, plus one
    // farther step (half size on sharp screens, where it stays crisp).
    view.levels = [];
    for (let e = sc; e >= 1; e--) view.levels.push(e);
    view.levels.push((window.devicePixelRatio || 1) >= 2 ? 0.5 : 0.75);
    // Keep the scale the player chose (1:1 by default) when the window changes.
    let best = 0;
    for (let i = 0; i < view.levels.length; i++) if (Math.abs(view.levels[i] - view.want) < Math.abs(view.levels[best] - view.want)) best = i;
    view.zi = best;
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
    if (s.attract) return;
    // Thin air carries little sound: up in space the samples go quiet too.
    const vol = (o.vol ?? 1) * (x === undefined ? 1 : near(x)) * (0.25 + 0.75 * AB.aireActual());
    if (!S.suena(n, { ...o, vol, pan: x === undefined ? 0 : panOf(x) })) synth();
  }
  const MOTOR: Record<ModeloAvion, S.Motor> = { avioneta: 'motor-avioneta', caza: 'motor-jet', bombardero: 'motor-bombardero', raptor: 'motor-jet', sukhoi: 'motor-jet', b2: 'motor-jet', ovni: 'motor-jet', tomcat: 'motor-jet', a10: 'motor-jet', spitfire: 'motor-avioneta' };
  const CRUISE: Record<ModeloAvion, number> = { avioneta: 100, caza: 150, bombardero: 85, raptor: 165, sukhoi: 160, b2: 120, ovni: 130, tomcat: 160, a10: 110, spitfire: 115 };
  function engines() {
    const p = s.plane;
    const on = s.mode === 'play' && !s.paused && !s.dead && !s.attract;
    const id = s.spec.id;
    for (const m of new Set(Object.values(MOTOR))) if (m !== MOTOR[id]) S.motor(m, 0, 1);
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
    // Radar warning: beeps faster the closer the nearest guided missile chasing the plane.
    let cercaMisil = 0;
    for (const th of threats) if (th.guiado) cercaMisil = Math.max(cercaMisil, clamp(1 - Math.hypot(th.dx, th.dy) / 360, 0, 1));
    AB.alertaMisil(cercaMisil);
    // A harder alarm when several guided missiles, or a long-range one, are on the plane.
    let guided = 0;
    for (const th of threats) if (th.guiado && Math.hypot(th.dx, th.dy) < 300) guided++;
    AB.fijacionFuerte(clamp((guided - 1) / 3 + (threats.some((th) => th.tipo === 'cazador') ? 0.5 : 0), 0, 1));
    AB.viento(v, p.carga);
    AB.altitud(p.y, v);
    AB.zonaNueva(zonaAltitud(p.y));
    AB.tormenta(s.mapa === 'tormenta' ? 1 - s.despeje : 0);
    AB.hielo(s.hielo);
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
    cambiarMapa('valle');
    s.toMapa = '';
    valpoStrip = null;
    s.costa = 0;
    s.viaje = 0;
    s.enValpo = false;
    splashes.length = 0;
    s.cars = [];
    s.shots = [];
    s.bombs = [];
    s.shells = [];
    s.flareBodies = [];
    s.puffs = [];
    s.bullets = [];
    s.zonas = [];
    s.heat = 0;
    s.hot = false;
    s.shards = [];
    s.crates = [];
    s.pops = [];
    s.junk = [];
    s.fx = VFX.crearEfectos();
    s.luces = L.crearLuces();
    s.craters = [];
    s.bridges = [];
    s.prizes = [];
    s.carPrize.clear();
    s.airMax.clear();
    s.ufoMode.clear();
    s.airFlash.clear();
    s.airPrize.clear();
    s.aereos = [];
    s.airQueue = [];
    s.gigantes = [];
    s.fighters = [];
    s.fighterQueue = 0;
    s.hundido = null;
    s.duelo = false;
    s.salva = null;
    s.nuke = null;
    s.bengalasR = [];
    s.eyectados = [];
    s.radio = null;
    s.bengalaCd.clear();
    s.bigQueue = [];
    s.jefe = null;
    s.spaceT = 0;
    s.motherCd = 0;
    s.proy = [];
    s.airFlash.clear();
    s.estelas = [];
    s.say = null;
  }

  function start(id: ModeloBase, from?: SavedGame | null, autopiloto = false, avion?: ModeloAvion, bomba?: BombaTipo) {
    resetWorld();
    // Set before the first wave so the title screen's game never saves over the player's.
    s.attract = autopiloto;
    s.gen++;
    s.overT = 0;
    s.hitStop = 0;
    s.combo = 0;
    s.comboT = 0;
    // A clean slate: nothing carries over from the title screen's autopilot.
    Object.assign(input, { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false, gun: false, nuke: false, tonel: false });
    s.nukes = 0;
    keys.clear();
    Object.assign(touch, { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false, gun: false, nuke: false, tonel: false });
    s.boost = '';
    s.boostT = 0;
    s.nitroT = 0;
    s.nitroCd = 0;
    s.enfriaT = 0;
    s.hielo = 0;
    s.congelado = false;
    s.transT = 0;
    s.slowT = 0;
    s.ayuda = 0;
    s.lockT = 0;
    s.lockCand = null;
    s.lockKey = null;
    s.resumen = null;
    s.puntosMejora = 0;
    s.niv = { dano: 0, salud: 0, defensa: 0, municion: 0 };
    s.nuevos = [];
    s.coraza = 0;
    s.tienda = false;
    s.piloto = id;
    A.fijarPiloto(id);
    const quiere = avion ?? from?.avion ?? id;
    const modelo = autopiloto || HG.avionLibre(quiere) ? quiere : id;
    s.spec = { ...HG.especDe(modelo), pilot: HG.PILOTO[id] };
    const carga = bomba ?? (avion ? undefined : from?.bomba) ?? s.spec.bomba;
    s.bomba = HG.bombaLibre(carga, modelo) ? carga : s.spec.bomba;
    s.plane = FV.nuevoAvion(modelo, 220, Math.min(130, ceiling() - 30), true);
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
      // A boss that was on when the game was saved hasn't been beaten: it comes again.
      const bossOn = from.bossFor >= from.wave;
      s.bossFor = bossOn ? from.wave - 1 : from.bossFor;
      s.bossCount = bossOn ? Math.max(0, from.bossCount - 1) : from.bossCount;
      s.jefeFor = (from.jefeFor ?? 0) >= from.wave ? from.wave - 1 : from.jefeFor ?? 0;
      s.wave = from.wave - 1;
      s.lost = from.lost.filter((q) => s.spec.parts.includes(q)).slice(0, s.spec.parts.length);
      FV.fijarDano(s.plane, danoDe(s.lost));
      s.hp = s.spec.parts.length + 1 - s.lost.length;
      if (from.mapa && from.mapa !== 'valle') {
        cambiarMapa(from.mapa);
        // Above the hills / the storm's cloud floor, not inside them.
        s.plane.y = s.mapa === 'tormenta' ? 700 : Math.max(240, ground(s.plane.x) + 120);
      }
      s.enValpo = !!from.enValpo;
      s.puntosMejora = from.puntosMejora ?? 0;
      if (from.niv) for (const k of Object.keys(s.niv) as Mejorable[]) s.niv[k] = clamp(Math.round(from.niv[k] || 0), 0, NIVEL_MAX);
      aplicarMunicion();
      s.coraza = s.niv.salud;
      s.costa = s.enValpo ? 1 : 0;
      for (const [x, y, r] of from.craters) crater(x, y, r);
      for (const [x0, x1] of from.bridges ?? []) bridge(x0, x1);
      if (from.cap) {
        for (const k of ['misil', 'bomba', 'bengala'] as Arma[]) s.cap[k] = clamp(Math.round(from.cap[k] || 0), s.cap[k], capMax(k));
        s.ammo = s.cap.misil;
        s.bombAmmo = s.cap.bomba;
        s.flares = s.cap.bengala;
      }
    }
    nextWave();
    save();
    // At home in San Antonio the game opens on the ground: boarding, then a manual take-off.
    if (!autopiloto && s.mapa === 'valle') {
      const P = FV.PARAMS[s.spec.id];
      s.despegue = 'subiendo';
      s.despT = 0;
      const p = s.plane;
      p.x = PISTA0 + 30;
      p.y = ground(p.x) + P.panza;
      p.vx = 0;
      p.vy = 0;
      p.rumbo = 0;
      p.alabeo = 1;
      s.camX = 0;
    } else s.despegue = '';
  }

  /** The take-off run on the home runway: roll, gather speed, pull up to lift off. */
  function rodarPista(mando: Mando, dt: number) {
    const p = s.plane;
    const PA = FV.PARAMS[s.spec.id];
    const vRot = PA.velCrucero * 0.7;
    const acc = mando.gas > 0 ? 70 * mando.gas + 25 : mando.gas < 0 ? -100 : -14;
    p.vx = clamp(p.vx + acc * dt, 0, PA.velCrucero * 1.05);
    p.x += p.vx * dt;
    p.y = ground(p.x) + PA.panza;
    p.vy = 0;
    p.rumbo = Math.atan2(ground(p.x + 4) - ground(p.x - 4), 8);
    p.alabeo = 1;
    p.gas = mando.gas;
    // Rotate: fast enough and the nose pulled up (or the runway runs out).
    if ((p.vx >= vRot && mando.y > 0.3) || p.x > PISTA1 + 240) {
      s.despegue = '';
      s.gracia = 1.2;
      p.vy = 45;
      p.rumbo = 0.28;
      s.inv = Math.max(s.inv, 1.5);
      pop(p.x, p.y + 20, '🛫 ¡Despegue!', P.gold);
      sfx.achievement();
    } else if (p.vx >= vRot && Math.floor(s.t * 3) % 2 === 0 && !s.vrAvisado) {
      s.vrAvisado = true;
      pop(p.x, p.y + 20, '¡Ya! ¡Tira hacia arriba!', P.gold);
    }
  }

  function save() {
    if (s.mode !== 'play' || s.dead || s.attract) return;
    writeSave({
      v: 1, pilot: s.piloto, avion: s.spec.id, bomba: s.bomba, wave: s.wave, score: s.ckScore, kills: s.ckKills, lives: s.lives, lost: [...s.lost], cap: { ...s.cap }, bridges: s.bridges,
      meta: s.meta, bossFor: s.bossFor, bossCount: s.bossCount, jefeFor: s.jefeFor, craters: s.craters, puntosMejora: s.puntosMejora, niv: { ...s.niv }, mapa: s.toMapa || s.mapa, enValpo: s.toMapa === 'oceano' ? false : s.enValpo, at: Date.now(),
    });
  }

  /**
   * The title screen's background: a real game at a lively wave, valley or
   * sea, flown by an autopilot that never loses and never saves.
   */
  function attract() {
    const ids: ModeloBase[] = ['caza', 'avioneta', 'bombardero'];
    const aviones = HG.HANGAR.map((a) => a.id);
    start(ids[Math.floor(Math.random() * ids.length)], null, true, Math.random() < 0.5 ? undefined : aviones[Math.floor(Math.random() * aviones.length)]);
    const mapas: Mapa[] = ['valle', 'oceano', 'valparaiso', 'tormenta'];
    cambiarMapa(mapas[Math.floor(Math.random() * mapas.length)]);
    s.wave = 2 + Math.floor(Math.random() * 3);
    nextWave();
    s.phase = 'wave';
    s.banner = '';
    s.spawnT = 0.5;
    s.fighterT = 3;
    s.plane.y = 220;
  }

  /** The title screen's pilot: chases the nearest enemy, fires when lined up, dodges with flares. */
  function attractBot() {
    const p = s.plane;
    s.meta = META_MAX;
    s.lives = LIVES;
    let tx = p.x + 300, ty = 260;
    let best = Infinity;
    const consider = (x: number, y: number) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < best) {
        best = d;
        tx = x;
        ty = y;
      }
    };
    for (const f of s.fighters) consider(f.a.x + f.a.vx * 0.3, f.a.y + f.a.vy * 0.3);
    for (const a of s.aereos) consider(a.x, a.y);
    for (const c of s.cars) consider(c.mid.x, c.mid.y + 6);
    if (s.jefe) consider(s.jefe.x, s.jefe.y);
    const gnd = ground(p.x);
    // Never too low, never too high: the action stays on screen.
    let aimY = ty;
    if (best > 260) aimY = clamp(ty + 120, gnd + 90, 520);
    const dx = tx - p.x, dy = aimY - p.y;
    let mx = dx, my = dy;
    if (p.y - gnd < 60) my = Math.max(my, 120);
    const n = Math.hypot(mx, my) || 1;
    input.x = mx / n;
    input.y = my / n;
    input.gas = best > 250 ? 1 : 0.3;
    const want = Math.atan2(ty - p.y, tx - p.x);
    const off = Math.abs(((want - p.rumbo + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    input.fire = off < 0.16 && best < 360 && s.ammo > 0;
    input.gun = off < 0.12 && best < 220;
    const chased = s.shots.some((sh) => sh.enemy && sh.tgt === p && sh.m.t >= 0 && Math.hypot(sh.m.x - p.x, sh.m.y - p.y) < 110);
    input.flare = chased && s.flares > 0 && !s.flareWasDown;
    if (chased && s.flares === 0 && Math.random() < 0.02) startNitro();
  }

  function demo() {
    resetWorld();
    s.mode = 'demo';
    s.dead = false;
    s.plane = FV.nuevoAvion('avioneta', 240, 120, true);
  }

  function nextWave() {
    s.wave++;
    if (!s.attract && s.mode === 'play') celebrar(HG.registrar({ oleada: s.wave }));
    s.queue = waveList(s.wave);
    // What a resumed game gets back: the score as the wave began.
    s.ckScore = s.score;
    s.ckKills = s.kills;
    s.airQueue = AE.elegirAereos(s.wave, Math.random, s.plane.y);
    s.waveStartT = s.t;
    s.deathsWave = 0;
    s.wavePrizes = 0;
    s.waveSize = s.queue.length;
    s.mision = elegirMision();
    // First boss beaten: the plane lights the nitro and flies off to the sea.
    if (s.toMapa && s.toMapa !== s.mapa) {
      s.transT = TRANS_T;
      precalentarTransicion(s.toMapa as MapaId, view.vw, view.vh);
    }
    s.bigQueue = s.mapa === 'oceano' ? [] : G.elegirGrandes(s.wave, Math.random);
    s.fighterQueue = s.mapa === 'oceano' ? Math.max(1, CZ.cuantos(s.wave)) : CZ.cuantos(s.wave);
    // Later laps: extra fighters and a second air raid on top of the wave's own.
    const vuelta = Math.floor((s.wave - 1) / 4);
    if (vuelta > 0 && s.wave >= 3) s.fighterQueue += vuelta;
    if (vuelta > 0) s.airQueue.push(...AE.elegirAereos(s.wave, Math.random, s.plane.y).slice(0, 2 * vuelta));
    s.fighterT = rand(7, 12);
    if (s.mapa === 'tormenta') prepararTormenta();
    s.bigT = rand(3, 6);
    s.airT = rand(4, 7);
    s.phase = 'break';
    s.breakT = 2.6;
    s.banner = `Oleada ${s.wave}`;
    s.spawnT = 0;
    save();
  }

  /** Every full round of the four maps brings a bigger crowd: +35% per lap. */
  function masPorVuelta(n: number) {
    return 1 + 0.35 * Math.floor((n - 1) / 4);
  }

  function waveList(n: number): VehiculoTipo[] {
    if (s.mapa === 'tormenta') return []; // only fighters up here
    if (s.mapa === 'valparaiso') {
      // On the hills: downhill bikers, trolleybuses and the usual convoy.
      const count = Math.min(44, Math.round((5 + n * 2) * masPorVuelta(n)));
      const pool: VehiculoTipo[] = ['bici', 'bici', 'trolebus', 'jeep', 'camion', 'tanque', 'sam'];
      return Array.from({ length: count }, () => pool[Math.floor(Math.random() * Math.min(pool.length, 4 + Math.floor(n / 2)))]);
    }
    if (s.mapa === 'oceano') {
      // At sea: speedboats and missile frigates.
      const count = Math.min(40, Math.round((4 + n * 1.8) * masPorVuelta(n)));
      return Array.from({ length: count }, () => (Math.random() < Math.min(0.55, 0.25 + n * 0.04) ? 'fragata' : 'lancha'));
    }
    const count = n === 1 ? 4 : Math.min(50, Math.round((5 + n * 2.2) * masPorVuelta(n)));
    const w: Partial<Record<VehiculoTipo, number>> =
      n === 1 ? { jeep: 0.6, micro: 0.4 } :
      n === 2 ? { jeep: 0.3, micro: 0.2, portuario: 0.3, tanque: 0.2 } :
      n === 3 ? { jeep: 0.25, micro: 0.15, portuario: 0.3, tanque: 0.3 } :
      { jeep: 0.2, micro: 0.12, portuario: 0.26, tanque: 0.24, sam: 0.18 };
    const out: VehiculoTipo[] = [];
    for (let i = 0; i < count; i++) {
      let r = Math.random();
      let k: VehiculoTipo = 'jeep';
      for (const kk of Object.keys(w) as VehiculoTipo[]) {
        r -= w[kk] ?? 0;
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
    if (s.mision?.id === 'despensa') s.mision.fallida = true;
    pop(PANTRY.x1, ground(PANTRY.x1) + 40, '¡Se llevaron pescado!', P.red);
    s.stolenT = 2.2;
    s.banner = `🐟 ¡Robaron pescado! Quedan ${Math.max(0, s.meta)}`;
    window.setTimeout(() => {
      if (s.banner.startsWith('🐟')) s.banner = '';
    }, 2200);
  }

  function gameOver(reason: Result['reason']) {
    if (s.mode !== 'play') return;
    if (s.attract) {
      attract();
      return;
    }
    if (reason === 'avion') s.lives = 0;
    s.mode = 'over';
    S.callar();
    // From wave 2 on, a lost game can carry on from the same wave (score back to 0).
    writeSave(
      s.wave >= 2
        ? { v: 1, pilot: s.piloto, avion: s.spec.id, bomba: s.bomba, wave: s.wave, score: 0, kills: 0, lives: LIVES, lost: [], cap: { ...s.cap }, bridges: s.bridges, meta: META_MAX, bossFor: s.bossFor, bossCount: s.bossCount, craters: s.craters, mapa: s.mapa, enValpo: s.enValpo, jefeFor: s.jefeFor, at: Date.now() }
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
    if (s.sinPremio) return;
    s.combo = s.comboT > 0 ? s.combo + 1 : 1;
    s.comboT = 2.5;
    const mult = Math.min(5, s.combo);
    if (s.combo >= 3 && s.mision?.id === 'combo3') completaMision();
    s.score += points * mult;
    s.kills++;
    pop(x, y + 14, mult > 1 ? `+${points * mult} ×${mult}` : `+${points}`);
    const shout = ({ 2: '¡Doble!', 3: '¡Triple!', 5: '¡Imparable!', 8: '¡Leyenda!' } as Record<number, string>)[s.combo];
    if (shout) {
      pop(s.plane.x, s.plane.y + 26, shout, P.r2);
      sfx.select();
    }
    if (!s.calma && !still) s.hitStop = Math.max(s.hitStop, s.combo >= 3 ? 0.1 : 0.06);
  }

  function pop(x: number, y: number, text: string, c: string = P.gold) {
    s.pops.push({ x, y, t: 0, text, c });
  }

  /**
   * A blast of the given energy. Blasts from the player hurt vehicles, blasts
   * from the mice hurt the plane, and every blast pushes everything nearby.
   */
  function blast(x: number, y: number, energy: number, from: 'jugador' | 'raton' | 'nadie' | 'caida', damage: number) {
    // 'caida': a spent missile falling under gravity hurts whatever it lands on, mice and plane alike.
    const hiereRatones = from === 'jugador' || from === 'caida';
    // A stray falling missile wrecks mice but earns the player nothing.
    const premioAntes = s.sinPremio;
    if (from === 'caida') s.sinPremio = true;
    try {
      blastCuerpo(x, y, energy, from, damage, hiereRatones);
    } finally {
      s.sinPremio = premioAntes;
    }
  }
  function blastCuerpo(x: number, y: number, energy: number, from: 'jugador' | 'raton' | 'nadie' | 'caida', damage: number, hiereRatones: boolean) {
    if (from === 'jugador') damage *= danoMul();
    const ex = FA.explosion(energy);
    // Blasts that touch the ground leave a crater.
    if (y - ground(x) < ex.radio * 0.6 && from !== 'raton') crater(x, Math.min(y, ground(x) + 2), ex.radio * (energy >= 5 ? 1.1 : 0.8));
    // Energies span 0.6 (flak) to 10 (bomb); effects scale with the cube root, like the blast.
    const size = Math.cbrt(energy);
    const enAgua = sobreMar(x) && y - OC.NIVEL_MAR < ex.radio;
    VFX.explosion(s.fx, x, y, energy, { suelo: y - ground(x) < ex.radio * 0.6, quieto: still || s.calma, color: enAgua ? 'agua' : undefined });
    const ce = Math.cbrt(Math.max(0.1, energy));
    // The screen only shakes for powerful blasts close to the plane.
    if (energy >= 5 && s.mode === 'play') {
      const cerca = 1 - Math.hypot(x - s.plane.x, y - s.plane.y) / 220;
      if (cerca > 0) s.shake = Math.max(s.shake, cerca * Math.min(8, 1.6 * ce));
    }
    L.luz(s.luces, x, y, Math.min(48, 14 + 10 * ce), '#ffd27a', 0.25 + 0.08 * ce);
    L.luz(s.luces, x, y, 8 * ce, '#ffffff', 0.05);
    if (!s.attract) AB.explosion(energy, Math.hypot(x - s.plane.x, y - s.plane.y), panOf(x));
    // Missiles caught in a blast go off too: chain reactions.
    for (const sh of s.shots) {
      if (!sh.enemy || sh.m.t < 0) continue;
      const m = sh.m;
      // The player's blasts always finish an enemy missile; the others may only shake a heavy one.
      if (Math.hypot(m.x - x, m.y - y) < ex.radio * 1.6 + MS.MISILES[m.tipo].radioChoque && MS.golpear(m, from === 'jugador' ? 9 : 1)) {
        m.t = -1;
        const e = MS.MISILES[m.tipo].energia * 0.6;
        later(() => blast(m.x, m.y, e, 'nadie', 0), 50);
        if (from !== 'raton' && s.mode === 'play') {
          s.score += 50;
          pop(m.x, m.y + 8, '+50');
          if (from === 'jugador') avanzaMision('misiles');
        }
      }
    }
    for (const u of s.gigantes) if (u.viva) giantHit(u, G.explotar(u, x, y, energy, hiereRatones ? damage : 0));
    if (hiereRatones && s.jefe && JF.tocado(s.jefe, x, y, ex.radio)) {
      const h = JF.golpear(s.jefe, x, y, damage * BOSS_MUL[s.spec.id]);
      s.jefeFlash = 0.1;
      if (h.bloqueado) pop(x, y + 10, s.jefe.tipo === 'nodriza' ? '¡Escudo!' : '¡Blindado!', P.metal);
      else if (h.derrotado) award(h.puntos ?? 0, x, y);
      else if (h.puntos) {
        s.score += h.puntos;
        pop(x, y + 12, `+${h.puntos}`);
      }
    }
    if (hiereRatones) {
      for (const f of s.fighters) {
        if (f.jefa && from === 'caida') continue;
        const dmg = damage * ex.dano(Math.max(0, Math.hypot(f.a.x - x, f.a.y - y) - CZ.RADIO));
        if (dmg >= 0.25) hurtFighter(f, dmg);
      }
      for (const a of s.aereos) {
        if (a.hp <= 0) continue;
        const dmg = damage * ex.dano(Math.max(0, Math.hypot(a.x - x, a.y - y) - AE.radio(a)));
        if (dmg < 0.25) continue;
        a.hp -= dmg;
        s.airFlash.set(a.id, 0.12);
        if (a.hp <= 0) abatirAereo(a);
      }
    }
    for (const c of s.cars) {
      const d = Math.hypot(c.mid.x - x, c.mid.y - y);
      const imp = ex.impulso(d);
      if (imp > 0.5) FA.empujeVehiculo(c, ((c.mid.x - x) / (d || 1)) * imp, ((c.mid.y - y) / (d || 1)) * imp + imp * 0.5);
      if (hiereRatones) {
        let dmg = damage * ex.dano(d);
        if (c.kind === 'portaaviones') {
          // A huge hull: measure to its nearest plate, not its middle, and bombs (big
          // blasts) hit it extra hard — the deck and the hangar below are its weak spot.
          const look = A.VEH_LOOK[c.kind];
          const hx = Math.max(0, Math.abs(x - c.x) - look.w / 2);
          const hy = y < c.y ? c.y - y : Math.max(0, y - (c.y + look.h));
          dmg = damage * ex.dano(Math.hypot(hx, hy)) * (s.golpeBomba ? 2.2 : 1);
        }
        if (dmg >= 0.25) hurtCar(c, dmg);
      }
    }
    if (s.mode === 'play' && !s.dead) {
      const p = s.plane;
      const d = Math.hypot(p.x - x, p.y - y);
      const imp = ex.impulso(d);
      if (imp > 0.5) FV.empujar(p, s.spec.id, ((p.x - x) / (d || 1)) * imp, ((p.y - y) / (d || 1)) * imp);
      if ((from === 'raton' || from === 'caida') && ex.dano(Math.max(0, d - s.spec.hit)) * damage >= 0.3) {
        s.lastHit = 'misil';
        hurtPlane(from === 'caida' ? 1 : damage >= 2 ? 2 : 1, x, y);
      }
    }
  }

  const flyingNow = () => s.mode === 'play' && !s.dead;

  /**
   * The barrel roll (R / 🌀): a quick full roll that throws off guided missiles
   * close by (half the time) and gives a blink of invulnerability.
   */
  function tonel() {
    if (s.tonelCd > 0 || s.despegue || s.congelado) return;
    const p = s.plane;
    s.tonelT = 0.55;
    s.tonelCd = 1.4;
    s.inv = Math.max(s.inv, 0.35);
    let esquivados = 0;
    for (const sh of s.shots) {
      if (sh.enemy && sh.tgt === p && sh.m.guiado && Math.hypot(sh.m.x - p.x, sh.m.y - p.y) < 160 && Math.random() < 0.5) {
        sh.m.guiado = false;
        esquivados++;
      }
    }
    const doble = s.t - s.tonelUlt < 1.3;
    s.tonelUlt = s.t;
    const pts = doble ? 150 : 50;
    s.score += pts;
    pop(p.x, p.y + 22, doble ? `🌀 ¡Doble tonel! +${pts}` : esquivados ? `🌀 ¡Tonel! Esquivaste ${esquivados}` : `🌀 ¡Tonel! +${pts}`, '#7ad8ff');
    if (!s.attract) AB.uf();
  }

  /** Counts full loops (360° of pitch) and pays for them; a hesitant pull resets it. */
  function acrobacias(dt: number) {
    const p = s.plane;
    s.tonelT = Math.max(0, s.tonelT - dt);
    s.tonelCd = Math.max(0, s.tonelCd - dt);
    if (s.despegue) return;
    const w = p.omega ?? 0;
    if (Math.abs(w) < 0.6) {
      s.giroQuieto += dt;
      if (s.giroQuieto > 0.8) s.giroAcc = 0;
    } else {
      s.giroQuieto = 0;
      if (Math.sign(w) !== Math.sign(s.giroAcc) && Math.abs(s.giroAcc) > 0.5) s.giroAcc = 0;
      s.giroAcc += w * dt;
    }
    if (Math.abs(s.giroAcc) >= Math.PI * 2) {
      s.giroAcc = 0;
      s.score += 200;
      s.nitroCd = Math.max(0, s.nitroCd - 2);
      pop(p.x, p.y + 24, '🔄 ¡Rizo! +200', P.gold);
      if (!s.attract) AB.uf();
    }
  }
  /** Damage multiplier from the «daño» upgrade. */
  const danoMul = () => 1.35 * (1 + 0.15 * s.niv.dano) * (s.boost === 'furia' ? 2 : 1);
  /** Most slots a weapon can have: the base cap plus the «munición» upgrade. */
  const capMax = (k: Arma) => CAP_MAX[k] + s.niv.municion;
  /** Something new in the hangar: a cheer, and the names go on the wave card. */
  function celebrar(nuevos: string[]) {
    s.nuevos = [...s.nuevos, ...nuevos];
    if (!nuevos.length) return;
    AB.desbloqueo();
    later(() => pop(s.plane.x, s.plane.y + 40, `🔓 ¡Nuevo en el hangar: ${HG.resumirNuevos(nuevos)}!`, P.gold), 400);
  }
  /**
   * The hangar between waves (or before the first): swaps the airframe in
   * place, keeping position and speed. A fresh plane: whole, with full racks.
   */
  function cambiarAvion(id: ModeloAvion, bomba?: BombaTipo) {
    if (!HG.avionLibre(id)) return false;
    if (id !== s.spec.id) {
      const viejo = s.spec;
      s.spec = { ...HG.especDe(id), pilot: HG.PILOTO[s.piloto] };
      // Slots won from crates carry over; the rack itself is the new plane's.
      const extra = (k: Arma, base: number) => Math.max(0, s.cap[k] - base - s.niv.municion);
      s.cap = {
        misil: s.spec.rack + s.niv.municion + extra('misil', viejo.rack),
        bomba: s.spec.bombRack + s.niv.municion + extra('bomba', viejo.bombRack),
        bengala: s.spec.flareRack + s.niv.municion + extra('bengala', viejo.flareRack),
      };
      for (const k of ['misil', 'bomba', 'bengala'] as Arma[]) s.cap[k] = Math.min(s.cap[k], capMax(k));
      s.ammo = s.cap.misil;
      s.bombAmmo = s.cap.bomba;
      s.flares = s.cap.bengala;
      // Damage carries over to the parts the new plane also has: no free repair by swapping.
      s.lost = s.lost.filter((q) => s.spec.parts.includes(q));
      s.hp = s.spec.parts.length + 1 - s.lost.length;
      FV.fijarDano(s.plane, danoDe(s.lost));
      s.heat = 0;
      s.hot = false;
      if (!HG.bombaLibre(s.bomba, id)) s.bomba = s.spec.bomba;
      VFX.explosion(s.fx, s.plane.x, s.plane.y, 0.6, { quieto: true, color: 'agua' });
    }
    if (bomba && HG.bombaLibre(bomba, id)) s.bomba = bomba;
    s.hudKey = '';
    save();
    return true;
  }
  function hangarInfo(): HangarInfo {
    return {
      avion: s.spec.id,
      bomba: s.bomba,
      piloto: s.piloto,
      libres: HG.HANGAR.filter((a) => HG.avionLibre(a.id)).map((a) => a.id),
      bombas: HG.TIPOS_BOMBA.filter((b) => HG.bombaLibre(b, s.spec.id)),
    };
  }
  /** The «munición» upgrade adds one slot of each weapon per level (and fills them). */
  function aplicarMunicion() {
    s.cap = {
      misil: Math.max(s.cap.misil, s.spec.rack + s.niv.municion),
      bomba: Math.max(s.cap.bomba, s.spec.bombRack + s.niv.municion),
      bengala: Math.max(s.cap.bengala, s.spec.flareRack + s.niv.municion),
    };
    s.ammo = s.cap.misil;
    s.bombAmmo = s.cap.bomba;
    s.flares = s.cap.bengala;
  }
  /** Buys one level of an upgrade if there are enough ⭐. */
  function mejorar(k: Mejorable) {
    const costo = s.niv[k] + 1;
    if (s.niv[k] >= NIVEL_MAX || s.puntosMejora < costo) return false;
    s.puntosMejora -= costo;
    s.niv[k]++;
    if (k === 'municion') aplicarMunicion();
    if (k === 'salud') s.coraza = s.niv.salud;
    save();
    return true;
  }
  /** A delayed effect that only happens if the same game is still on. */
  function later(fn: () => void, ms: number) {
    const gen = s.gen;
    const run = () => {
      if (gen !== s.gen) return;
      // Paused: wait until the game runs again (no blasts or sounds while paused).
      if (s.paused) window.setTimeout(run, 100);
      else fn();
    };
    window.setTimeout(run, ms);
  }

  /** A flying mouse shot down by the player: points, its balloon, and UFOs leave a prize. */
  function abatirAereo(a: AE.Aereo) {
    award(AIR_SCORE[a.tipo], a.x, a.y);
    releasePrize(s.airPrize.get(a.id), a.x, a.y + 10);
    s.airPrize.delete(a.id);
    // A UFO always leaves something big: an extra plane or a nuclear bomb.
    if (a.tipo === 'ovni' && !s.attract) celebrar(HG.registrar({ ovnis: 1 }));
    if (a.tipo === 'ovni') releasePrize(s.lives < MAX_VIDAS && Math.random() < 0.5 ? 'vida' : 'nuclear', a.x + 12, a.y + 14);
    for (let i = 0; i < 2; i++) VFX.pieza(s.fx, a.x, a.y, a.vx * 0.5 + rand(-50, 50), rand(20, 80), null, '#a88af0');
    const ax = a.x, ay = a.y;
    later(() => blast(ax, ay, FA.ENERGIA.vehiculo, 'jugador', 0.8), 50);
  }

  /** The storm's wave: fighters only, a few at a time, coming quickly. */
  function prepararTormenta() {
    s.queue = [];
    s.airQueue = [];
    s.bigQueue = [];
    s.fighterQueue = 6 + 2 * Math.floor((s.wave - 1) / 4);
    s.tormentaTot = s.fighterQueue;
    s.despeje = 0;
    s.fighterT = 2;
    s.rayoT = rand(4, 7);
  }

  /**
   * ☢️ The nuclear bomb: everything on screen goes, missiles included; bosses
   * take a heavy blow. A white-out, a long shake and a deep boom.
   */
  /** The nuke leaves the bay; a moment later its parachute opens and it drifts down. */
  function soltarNuke() {
    const p = s.plane;
    s.nukes--;
    s.nuke = { x: p.x, y: p.y - 6, vx: p.vx * 0.6, vy: p.vy * 0.5 - 20, t: 0 };
    s.banner = '☢️ ¡Bomba nuclear lanzada! ¡Aléjate!';
    window.setTimeout(() => {
      if (s.banner.startsWith('☢️ ¡Bomba')) s.banner = '';
    }, 2400);
    if (!s.attract) sfx.warn();
    fx('bomba', sfx.bomb, { vol: 0.6, rate: 0.7 });
  }
  function stepNuke(dt: number) {
    const n = s.nuke;
    if (!n) return;
    n.t += dt;
    const abierto = n.t > NUKE_CAIDA;
    if (abierto) {
      // Under the canopy: a slow, swaying descent.
      n.vx += (-n.vx) * Math.min(1, dt * 1.5) + FV.viento(s.t, n.x, n.y) * 0.4 * dt;
      n.vy += (-38 - n.vy) * Math.min(1, dt * 2.5);
    } else n.vy -= FA.GRAVEDAD * dt;
    n.x = clamp(n.x + n.vx * dt, 20, LEVEL - 20);
    n.y += n.vy * dt;
    if (Math.floor(n.t * 4) % 2 === 0) L.luz(s.luces, n.x, n.y, 10, '#ff4a3c', 0.05);
    if (n.y <= ground(n.x) + 45 || n.t > 9) {
      s.nuke = null;
      detonarNuclear(n.x, Math.max(n.y, ground(n.x)));
    }
  }

  function detonarNuclear(nx = s.plane.x, ny = s.plane.y) {
    // The camera's view around the burst: everything in sight goes.
    const x0 = nx - view.vw * 0.6, x1 = nx + view.vw * 0.6;
    const seen = (x: number) => x > x0 && x < x1;
    for (const c of s.cars) if (seen(c.x)) hurtCar(c, isBoss(c.kind) ? s.bossMax * 0.35 : 99);
    for (const a of s.aereos) if (a.hp > 0 && seen(a.x)) {
      a.hp = 0;
      abatirAereo(a);
    }
    for (const f of s.fighters) if (seen(f.a.x)) hurtFighter(f, f.jefa ? f.hpMax * 0.35 : 99);
    for (const u of s.gigantes) if (u.viva && seen(u.x)) giantHit(u, G.golpear(u, u.x, u.y + 6, 99));
    for (const sh of s.shots) if (sh.enemy && sh.m.t >= 0) sh.m.t = -1;
    s.proy = [];
    if (s.jefe && seen(s.jefe.x)) for (let i = 0; i < 6; i++) {
      const h = JF.golpear(s.jefe, s.jefe.x + rand(-40, 40), s.jefe.y + rand(-20, 20), 6);
      if (h.derrotado) award(h.puntos ?? 0, s.jefe.x, s.jefe.y);
    }
    // The mushroom: a column of fireballs climbing from the ground zero, and a ring along the ground.
    for (let i = 0; i < 7; i++) VFX.explosion(s.fx, nx + rand(-12, 12), ny + i * 22, 9 - i * 0.6, { quieto: still || s.calma });
    for (const dx of [-90, -50, 50, 90]) VFX.explosion(s.fx, nx + dx, ground(nx + dx) + 4, 5, { quieto: still || s.calma, suelo: true });
    L.luz(s.luces, nx, ny + 60, 120, '#fff2c0', 0.8);
    s.flashMap = 1;
    s.shake = 12;
    pop(s.plane.x, s.plane.y + 30, '☢️ ¡BOMBA NUCLEAR!', P.gold);
    if (!s.attract) AB.nuclear();
  }

  /** A line on the mice's radio. Low-priority chatter waits its turn; urgent lines cut in. */
  function radio(quien: string, frases: string[], urgente = false) {
    if (s.attract || s.mode !== 'play') return;
    if (s.radio && s.radio.t < (urgente ? 1.2 : 3.2)) return;
    s.radio = { quien, texto: frases[Math.floor(Math.random() * frases.length)], t: 0 };
    AB.radioRaton();
    s.hudKey = '';
  }
  /** A pilot bails out of a downed plane: a cry, a pop upwards and a parachute. */
  function eyectar(x: number, y: number, vx: number, jefa: boolean) {
    s.eyectados.push({ x, y, vx: vx * 0.3, vy: 110, t: 0, jefa });
    if (!s.attract) AB.eyeccion(panOf(x));
    if (!jefa) pop(x, y + 16, RADIO.grito[Math.floor(Math.random() * RADIO.grito.length)], '#ffd0e8');
  }

  /** Damages a mouse fighter; at 0 it blows apart (scored only if the player did it). */
  function hurtFighter(f: CZ.Caza, dmg: number, byPlayer = true) {
    if (f.hp <= 0) return;
    // She doesn't crash on her own: the ground only scrapes her.
    if (f.jefa && !byPlayer) dmg = Math.min(dmg, 1);
    f.hp -= dmg;
    f.flash = 0.1;
    if (f.jefa && f.hp > 0 && Math.random() < 0.25 && (!s.say || s.say.t > 1.5)) talk(SAY.dueloHurt[Math.floor(Math.random() * SAY.dueloHurt.length)], f.a.x, f.a.y);
    if (f.hp > 0) return;
    if (f.jefa) {
      s.duelo = false;
      talk(SAY.dueloFin, f.a.x, f.a.y);
      award(4000, f.a.x, f.a.y);
      s.puntosMejora++;
      s.shake = 10;
      AB.jefeVencido();
      releasePrize('especial', f.a.x, f.a.y);
      for (const k of ['misil', 'bomba', 'bengala'] as Arma[]) releasePrize(k, f.a.x + rand(-30, 30), f.a.y);
      if (s.meta < META_MAX) {
        s.meta++;
        pop(f.a.x, f.a.y + 30, '¡+1 pescado recuperado! 🐟', P.gold);
      }
      eyectar(f.a.x, f.a.y, f.a.vx, true);
      // A little parachute: she bails out, of course.
      for (let i = 0; i < 6; i++) VFX.pieza(s.fx, f.a.x, f.a.y, f.a.vx * 0.4 + rand(-80, 80), rand(20, 110), null, i % 2 ? '#d02a3a' : '#e8e0d0');
      later(() => blast(f.a.x, f.a.y, FA.ENERGIA.bomba, 'nadie', 0), 40);
      return;
    }
    const { x, y, vx, vy } = f.a;
    if (byPlayer) {
      award(CZ.PUNTOS, x, y);
      avanzaMision('cazas');
      eyectar(x, y, vx, false);
      radio(`Ratón ${1 + (f.id % 4)}`, RADIO.caido, true);
      // Sometimes a downed fighter leaves a golden balloon with a special upgrade (not too often).
      if (s.especialCd <= 0 && Math.random() < 0.3) {
        releasePrize('especial', x, y + 10);
        s.especialCd = 25;
      }
    }
    for (let i = 0; i < 3; i++) VFX.pieza(s.fx, x, y, vx * 0.4 + rand(-60, 60), vy * 0.4 + rand(20, 90), null, '#7a5ad0');
    later(() => blast(x, y, FA.ENERGIA.vehiculo, 'jugador', 0.8), 30);
  }

  /**
   * Margarita's aircraft carrier: launches a mouse fighter off the deck every
   * few seconds and its AA guns fire tracer bursts at the plane.
   */
  function carrierStep(c: Car, dt: number) {
    if (s.mode !== 'play' || s.dead) return;
    // Iced over or knocked out by an EMP: no launches, no flak.
    if (c.mem.hielo > 0 || c.mem.emp > 0) return;
    const p = s.plane;
    c.mem.lanza = (c.mem.lanza ?? 4) - dt;
    if (c.mem.lanza <= 0 && s.fighters.length < 3) {
      const d = A.PORTAAVIONES_CUBIERTA;
      const f = CZ.crear(c.x + d.x0 + 8, c.y + d.y + 6, false, Math.max(3, s.wave));
      f.a.vx = -130;
      f.a.vy = 40;
      s.fighters.push(f);
      c.mem.lanza = rand(8, 12);
      if (!s.attract) AB.bocina();
      puff(c.x + d.x0 + 8, c.y + d.y + 4, 3, false, 0.8);
      if (!s.say || s.say.t > 1.5) talk(SAY.despegue[Math.floor(Math.random() * SAY.despegue.length)]);
      fx('misil', sfx.launch, { vol: 0.4, rate: 0.7, dur: 0.5 }, c.x);
    }
    // Her speciality: boomerang missiles. Dodge one and it loops back for
    // another go (twice), then burns out.
    c.mem.bumeran = (c.mem.bumeran ?? 3) - dt;
    if (c.mem.bumeran <= 0 && Math.hypot(p.x - c.x, p.y - c.y) < 600) {
      c.mem.bumeran = rand(5, 7.5);
      for (const m of MS.lanzar('buscador', c.x + 30, c.y + 26, p, Math.max(3, s.wave), Math.random)) {
        s.shots.push({ m, enemy: true, tgt: p, trail: 0, vueltas: 2 });
      }
      fx('misil', sfx.enemyLaunch, { vol: 0.5, rate: 0.75 }, c.x);
      if (!s.say || s.say.t > 1.5) talk('¡Mis misiles bumerán siempre vuelven! &%#');
    }
    c.mem.aa = (c.mem.aa ?? 2) - dt;
    if (c.mem.aa <= 0) {
      c.mem.aa = rand(1.4, 2.4);
      let fired = false;
      for (const [tx, ty] of A.PORTAAVIONES_TORRETAS) {
        const ox = c.x + tx, oy = c.y + ty;
        const d = Math.hypot(p.x - ox, p.y - oy);
        if (d > 420) continue;
        const v = 300;
        const lead = d / v;
        const ax = p.x + p.vx * lead - ox, ay = p.y + p.vy * lead - oy;
        const n = Math.hypot(ax, ay) || 1;
        for (let k = 0; k < 3; k++) {
          s.proy.push(AE.nuevoProyectil({ x: ox, y: oy, vx: (ax / n) * v + rand(-18, 18), vy: (ay / n) * v + rand(-18, 18), tipo: 'balin', trazador: true }));
        }
        fired = true;
      }
      if (fired && !s.attract) AB.metrallaEnemiga(panOf(c.x), Math.hypot(c.x - p.x, c.y - p.y), 3);
    }
  }

  function hurtCar(c: Car, dmg: number) {
    if (c.hp <= 0) return;
    c.hp -= dmg;
    c.flash = 0.12;
    if (isBoss(c.kind) && c.hp > 0 && Math.random() < 0.3 && (!s.say || s.say.t > 1.5)) talk(SAY.hurt[Math.floor(Math.random() * SAY.hurt.length)]);
    if (c.hp > 0) return;
    const spec = VEH[c.kind];
    if (isBoss(c.kind)) {
      talk(c.kind === 'portaaviones' ? SAY.hundida : SAY.defeat, c.mid.x, c.mid.y);
      if (c.kind === 'portaaviones') s.enValpo = true;
      s.puntosMejora++;
      releasePrize('especial', c.mid.x, c.mid.y + 30);
      // Beating her on land opens the way to the sea.
      s.shake = 8;
      for (let i = 0; i < 2; i++) s.crates.push({ x: c.mid.x + i * 10 - 5, y: c.mid.y + 10, vx: rand(-15, 15), vy: 80, t: 0, landed: 0 });
      later(() => blast(c.mid.x, c.mid.y, FA.ENERGIA.bomba, 'nadie', 0), 60);
    }
    award(spec.score, c.mid.x, c.mid.y);
    // Fuel and ammo cook off: a few smaller blasts after the big one.
    for (let i = 0; i < 3; i++) {
      const ex = c.mid.x + rand(-14, 14), ey = c.mid.y + rand(0, 16);
      later(() => blast(ex, ey, rand(0.8, 1.6), 'nadie', 0), 140 + i * 130 + rand(0, 80));
    }
    releasePrize(s.carPrize.get(c.id), c.mid.x, c.y + A.VEH_LOOK[c.kind].h + 6);
    s.carPrize.delete(c.id);
    VFX.restos(s.fx, c.mid.x, ground(c.mid.x), A.VEH_LOOK[c.kind].w);
    // The crew bails out and fights on foot.
    if (s.mapa !== 'oceano' && !isBoss(c.kind) && Math.random() < (s.wave < 4 ? 0.3 : 0.6)) s.gigantes.push(...G.desembarcar(c.x, c.y, 1 + Math.floor(Math.random() * 2), Math.random, s.wave));
    // It comes apart: chunks of hull fly off smoking.
    for (let i = 0; i < 3 + (isBoss(c.kind) ? 4 : 0); i++) VFX.pieza(s.fx, c.mid.x + rand(-6, 6), c.mid.y + 4, rand(-70, 70), rand(50, 110), null, i % 2 ? '#8064d8' : '#b49af4');
    // The wreck goes up a moment later: chain reactions are allowed.
    later(() => blast(c.mid.x, c.mid.y, FA.ENERGIA.vehiculo, 'jugador', 0.8), 60);
    if (Math.random() < 0.2) s.crates.push({ x: c.mid.x, y: c.mid.y + 6, vx: rand(-10, 10), vy: 70, t: 0, landed: 0 });
  }

  /**
   * A hit tears off the part nearest to where it struck; with every part
   * gone, the next hit blows the plane up. (hx, hy) is the impact point.
   */
  function hurtPlane(n = 1, hx = s.plane.x, hy = s.plane.y) {
    if (s.inv > 0 || s.dead || s.attract) return;
    // Defence: a chance to glance off; armour from «salud» soaks whole hits first.
    if (Math.random() < Math.min(0.5, 0.1 * s.niv.defensa)) {
      s.inv = 0.4;
      pop(s.plane.x, s.plane.y + 20, '🛡️ ¡Desviado!', '#9ad8ff');
      return;
    }
    if (s.coraza > 0) {
      s.coraza--;
      s.inv = 0.7;
      s.hurtFlash = 0.15;
      pop(s.plane.x, s.plane.y + 20, `❤️ Coraza (${s.coraza})`, '#ff9ad0');
      return;
    }
    if (s.mision?.id === 'piezas') s.mision.fallida = true;
    const p = s.plane;
    s.inv = 0.9;
    s.hurtFlash = 0.3;
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
    // The autopilot of the title screen never goes down: it bounces back up.
    if (s.attract) {
      p.vy = Math.abs(p.vy) + 90;
      p.y = Math.max(p.y, ground(p.x) + 20);
      return;
    }
    // A moment of slow motion to read what happened; the help rises a notch.
    if (!s.calma && !still) s.slowT = 1;
    s.ayuda = Math.min(1, s.ayuda + 0.34);
    s.deathsWave++;
    AB.derribo();
    s.dead = true;
    s.deadT = 0;
    s.hp = 0;
    // Into the sea: no fireball, a huge splash and the plane sinks out of sight.
    if (sobreMar(p.x) && p.y - OC.NIVEL_MAR < 30) {
      s.hundido = { x: p.x, vx: p.vx * 0.25, ang: p.rumbo };
      VFX.salpicar(s.fx, p.x, OC.NIVEL_MAR, 4, still || s.calma);
      for (let i = -2; i <= 2; i++) if (splashes.length < 30) splashes.push({ x: p.x + i * 9, t: Math.abs(i) * 0.08 });
      for (let i = 0; i < 8; i++) puff(p.x + rand(-16, 16), OC.NIVEL_MAR + rand(2, 10), rand(1.5, 3), false, 0.8, rand(-20, 20), rand(20, 50));
      AB.salpicadura(panOf(p.x), 4);
      s.shake = 3;
      s.overT = 1.8;
      s.reason = 'avion';
      return;
    }
    for (const part of s.spec.parts) {
      if (s.lost.includes(part)) continue;
      const at = partAt(part);
      VFX.pieza(s.fx, at.x, at.y, p.vx * 0.4 + rand(-70, 70), rand(10, 90), A.partSprite(s.spec.id, part), A.LOOKS[s.spec.id].ink);
    }
    VFX.pieza(s.fx, p.x, p.y, p.vx * 0.3, 30, A.planeSprite(s.spec.id, s.spec.parts), A.LOOKS[s.spec.id].ink);
    blast(p.x, p.y, FA.ENERGIA.bomba, 'nadie', 0);
    later(() => blast(p.x + rand(-8, 8), p.y + rand(-6, 6), FA.ENERGIA.vehiculo, 'nadie', 0), 120);
    later(() => blast(p.x + rand(-10, 10), p.y + rand(-6, 6), FA.ENERGIA.misilJugador, 'nadie', 0), 260);
    s.shake = 10;
    s.overT = 1.8;
    s.reason = 'avion';
  }

  /** A fresh plane after losing one: same pilot, all parts back, a moment of grace. */
  function respawn() {
    const right = Math.cos(s.plane.rumbo) >= 0;
    const rx = clamp(s.camX + view.vw * (right ? 0.3 : 0.7), 40, LEVEL - 40);
    const ry = s.mapa === 'tormenta' ? 700 : Math.min(CEIL - 60, Math.max(220, ground(rx) + 120));
    s.plane = FV.nuevoAvion(s.spec.id, rx, ry, right);
    s.hundido = null;
    // A fresh plane: not iced over, no nitro or cooling carried from the old one.
    s.hielo = 0;
    s.congelado = false;
    s.nitroT = 0;
    s.enfriaT = 0;
    s.lost = [];
    FV.fijarDano(s.plane, FV.SANO);
    s.hp = s.spec.hp;
    s.dead = false;
    s.inv = 3 + s.ayuda;
    s.ammo = s.cap.misil;
    s.bombAmmo = s.cap.bomba;
    s.flares = s.cap.bengala;
    // A concrete tip about what just got the plane, not a scolding.
    const tip = {
      misil: 'Tip: gira fuerte en el último momento o suelta bengalas (L / ✨)',
      bala: 'Tip: las ráfagas se esquivan cambiando de altura; usa la metralla contra los cazas',
      suelo: 'Tip: no bajes en picada; acelera para recuperar altura',
      jefe: 'Tip: rompe primero las piezas que disparan',
      choque: 'Tip: mantente lejos del jefe',
    }[s.lastHit];
    s.banner = `${s.lives === 1 ? '¡Último avión!' : `¡Otro avión! Quedan ${s.lives}`} · ${tip}`;
    window.setTimeout(() => {
      if (s.banner.startsWith('¡Otro') || s.banner.startsWith('¡Último')) s.banner = '';
    }, 3600);
    sfx.achievement();
  }

  /**
   * Badly broken ground ahead of a vehicle (it drives left): a crater deep or
   * wide enough to be worth a bridge. Returns its span, or null.
   */
  function brokenSpan(c: Car, ahead = 40): [number, number] | null {
    const half = A.VEH_LOOK[c.kind].w / 2;
    const deep = (x: number) => baseAt(x) - ground(x) > 2;
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
    for (let x = a; x <= b; x++) depth = Math.max(depth, baseAt(x) - ground(x));
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

  /** Before a boss: a repair balloon if the plane is hurt. */
  function prepJefe() {
    if (s.lost.length && !s.prizes.some((q) => q.kind === 'reparar')) releasePrize('reparar', s.plane.x + 70, s.plane.y - 30);
  }

  /** Margarita in her fighter: a one-on-one dogfight, nothing else in the sky. */
  function iniciarDuelo(mejor = false) {
    const p = s.plane;
    prepJefe();
    const fromRight = Math.cos(p.rumbo) >= 0;
    const f = CZ.crear(clamp(s.camX + (fromRight ? view.vw + 120 : -120), 40, LEVEL - 40), clamp(p.y + 80, 200, CEIL - 120), !fromRight, s.wave, true, true, mejor ? 'raptor' : 'sukhoi');
    if (mejor) f.hp = f.hpMax = f.hpMax * 1.3;
    s.fighters.push(f);
    s.bossMax = f.hpMax;
    s.duelo = true;
    talk(SAY.duelo, f.a.x, f.a.y);
    s.sayT = 5;
    s.banner = mejor ? '✈️ ¡Duelo: Margarita en su caza nuevo!' : '✈️ ¡Duelo: Margarita en su caza!';
    window.setTimeout(() => {
      if (s.banner.startsWith('✈️ ¡Duelo')) s.banner = '';
    }, 2600);
    AB.jefeLlega();
  }

  /** Brings in a flying boss just off screen, at a height in its own zone. */
  function spawnBoss(tipo: JF.TipoJefe) {
    const p = s.plane;
    const [lo, hi] = JF.ZONA[tipo];
    prepJefe();
    s.jefe = JF.crear(tipo, clamp(s.camX + view.vw + 140, 150, LEVEL - 150), clamp(p.y + 60, lo, hi), s.wave);
    s.banner = tipo === 'dirigible' ? '¡Se acerca el Gran Queso!' : tipo === 'zepelin' ? '¡Se acerca el zepelín de Margarita!' : '¡La nave nodriza del Emperador Ratón!';
    window.setTimeout(() => {
      if (s.banner.startsWith('¡Se acerca') || s.banner.startsWith('¡La nave')) s.banner = '';
    }, 2600);
    if (tipo === 'zepelin') AB.zepelinLlega();
    else AB.jefeLlega();
  }

  /** One step of the flying boss: its shots, beams, escorts and debris. */
  function stepBoss(dt: number, vista: IA.Vista) {
    const j = s.jefe;
    if (!j) return;
    const p = s.plane;
    const play = s.mode === 'play' && !s.dead;
    const r = JF.paso(j, vista, dt, s.aereos.length, s.fighters.length);
    if (j.tipo === 'zepelin' && !s.attract) AB.zepelinMotor(j.x - p.x, j.y - p.y, j.muriendo < 0);
    s.jefeFlash = Math.max(0, s.jefeFlash - dt);
    if (play) {
      for (const d of r.disparos ?? []) s.proy.push(AE.nuevoProyectil(d));
      for (const m of r.misiles ?? []) for (const mm of MS.lanzar(m.tipo, m.x, m.y, p, s.wave, Math.random, m.desvio)) s.shots.push({ m: mm, enemy: true, tgt: p, trail: 0 });
      if (r.laser) hurtPlane(1, r.laser.x, r.laser.y);
      if (r.laser || r.tractor) AB.laserJefe(panOf(j.x));
      if (r.impacto) hurtPlane(1, r.impacto.x, r.impacto.y);
      for (const c of r.cazas ?? []) {
        const f = CZ.crear(c.x, c.y, c.haciaDerecha, s.wave, true);
        f.hp = f.hpMax = c.hp;
        s.fighters.push(f);
      }
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
        later(() => blast(x, y, energia, 'nadie', 0), 20);
      }
      if (e.pieza) VFX.pieza(s.fx, e.pieza.x, e.pieza.y, e.pieza.vx, e.pieza.vy, JF.spritePieza(j.tipo, e.pieza.nombre), JF.TINTA[j.tipo]);
      if (e.dialogo) talk(e.dialogo, j.x, j.y);
      if (e.flak) {
        if (!s.attract) AB.zepelinFlak(panOf(e.flak.x));
        L.luz(s.luces, e.flak.x, e.flak.y, 10, '#ffb060', 0.12);
      }
      if (e.sonido === 'cruje' && !s.attract) AB.zepelinCruje(panOf(j.x));
      if (e.sonido === 'cae' && !s.attract) AB.zepelinCae();
    }
    for (const f of JF.focos(j)) if (Math.random() < dt * 12) VFX.fuego(s.fx, f.x, f.y, j.vx, j.vy, f.intensidad);
    if (r.muerto) {
      s.jefe = null;
      s.jefeEspacio = false;
      s.shake = 10;
      AB.jefeVencido();
      s.puntosMejora++;
      releasePrize('especial', j.x, j.y);
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
        later(() => blast(x, y, energia, 'nadie', 0), 30);
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
    if (Math.random() > 0.2) return null;
    const room = (['misil', 'bomba', 'bengala'] as Arma[]).filter((k) => s.cap[k] < capMax(k));
    if (!room.length) return null;
    room.sort((a, b) => s.cap[a] / capMax(a) - s.cap[b] / capMax(b));
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
    if (kind === 'vida') {
      s.lives = Math.min(MAX_VIDAS, s.lives + 1);
      pop(x, y + 16, '✈️ ¡Avión extra!', P.gold);
      AB.vidaExtra();
    } else if (kind === 'nuclear') {
      s.nukes = Math.min(3, s.nukes + 1);
      pop(x, y + 16, `☢️ ¡Bomba nuclear! (${view.touch ? 'botón ☢️' : 'tecla N'})`, P.gold);
      AB.nuclearRecogida();
    } else if (kind === 'especial') {
      // A special upgrade at random (or a full nitro).
      const opts: (Mejora | 'nitro')[] = ['doble', 'escudo', 'cohetes', 'chorrillana', 'bombas', 'bengalas', 'furia', 'iman', 'lluvia', 'nitro'];
      const pick = opts[Math.floor(Math.random() * opts.length)];
      if (pick === 'nitro') {
        s.nitroCd = 0;
        startNitro();
        s.banner = '⭐ ¡Super nitro gratis!';
      } else {
        // A new upgrade replaces the old one; a replaced shield stops protecting too.
        if (s.boost === 'escudo' && pick !== 'escudo') s.inv = Math.min(s.inv, 0.5);
        s.boost = pick;
        s.boostT = MEJORA[pick].t;
        if (pick === 'escudo') s.inv = Math.max(s.inv, MEJORA.escudo.t);
        s.banner = `⭐ ¡${MEJORA[pick].nombre}! (${MEJORA[pick].t} s)`;
      }
      AB.mejora();
      window.setTimeout(() => {
        if (s.banner.startsWith('⭐')) s.banner = '';
      }, 2200);
    } else if (kind === 'reparar') {
      // The empanada de mariscos: two parts back, and a moment to breathe.
      if (!repair()) {
        s.score += 300;
        pop(x, y + 16, '🥟 ¡Empanada de mariscos! +300', P.gold);
      } else {
        repair();
        pop(x, y + 28, '🥟 ¡Empanada de mariscos! Avión reparado', P.gold);
      }
      s.inv = Math.max(s.inv, 1);
    } else if (s.cap[kind] < capMax(kind)) {
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
    let bestA = 0.28;
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
      if (before < LOCK_TIME && s.lockT >= LOCK_TIME && !s.attract) {
        AB.fijado();
        if (s.fighters.some((f) => b.f.pos() === f.a)) radio('Ratón en apuros', RADIO.fijado, true);
      }
      else if (s.lockT < LOCK_TIME && s.lockT > 0.1 && !s.attract) AB.fijando(s.lockT / LOCK_TIME);
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
    const gk = s.spec.kit.metralla;
    if (!input.gun) s.gunWasDown = false;
    if (!input.gun || s.hot || s.gunT > 0) return;
    if (!gk) {
      // The B-2 has no gun: say so once per press.
      if (!s.gunWasDown && !s.attract) pop(s.plane.x, s.plane.y + 16, 'Sin metralla: usa bombas y misiles', P.metal);
      s.gunWasDown = true;
      return;
    }
    const doble = s.boost === 'doble';
    s.gunT = doble ? gk.cad * 0.8 : gk.cad;
    if (!doble) s.heat += gk.calor;
    if (s.heat >= 1) {
      s.hot = true;
      pop(p.x, p.y + 16, '¡Metralla caliente!', P.r3);
      if (!s.attract) AB.recalentada();
    }
    const a = p.rumbo + rand(-0.035, 0.035);
    const nose = s.spec.hit + 3;
    // Two guns side by side with the upgrade, one otherwise.
    for (const off of doble ? [-3, 3] : [0]) {
      const ox = -Math.sin(p.rumbo) * off, oy = Math.cos(p.rumbo) * off;
      s.bullets.push({
        x: p.x + Math.cos(p.rumbo) * nose + ox, y: p.y + Math.sin(p.rumbo) * nose + oy, vx: p.vx + Math.cos(a) * gk.vel, vy: p.vy + Math.sin(a) * gk.vel,
        t: 0, life: 1500 / gk.vel, d: gk.dano, g: gk.gravedad, c: gk.color,
      });
    }
    if (!s.attract) {
      const pan = panOf(p.x);
      if (gk.sonido === 'vulcan') AB.vulcan(pan);
      else if (gk.sonido === 'canon30') AB.canon30(pan);
      else if (gk.sonido === 'laser') AB.laser(pan);
      else AB.metralla(pan);
    }
    L.luz(s.luces, p.x + Math.cos(p.rumbo) * nose, p.y + Math.sin(p.rumbo) * nose, 6, gk.color === 'laser' ? '#7af0ff' : '#ffe48a', 0.04);
  }

  /** «Imán de premios»: balloons and crates drift to the plane. */
  function atraer(o: { x: number; y: number }, dt: number) {
    const p = s.plane;
    const dx = p.x - o.x, dy = p.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d > 320 || d < 1) return;
    const v = Math.min(d, 160 * dt);
    o.x += (dx / d) * v;
    o.y += (dy / d) * v;
  }

  /** A pilot hanging under a parachute (a mouse, or Margarita with her red beanie). */
  function dibujarEyectado(x: number, y: number, t: number, jefa: boolean) {
    const X = Math.round(x), Y = Math.round(y);
    const k = clamp((t - 0.55) / 0.3, 0, 1);
    if (k > 0) {
      const sw = Math.round(Math.sin(t * 2.2) * 1.5);
      const w = Math.round(3 + 5 * k), h = Math.round(1 + 3 * k);
      const cy = Y - 7 - Math.round(5 * k);
      for (const dx of [-w + 1, w - 1]) for (let i = 0; i <= 5; i++) A.R(g, Math.round(X + sw + (dx * (5 - i)) / 5), Math.round(cy + ((Y - 3 - cy) * i) / 5), 1, 1, '#e8e0d0');
      D.oval(g, X + sw, cy, w + 1, h + 1, '#3a2a4a');
      D.oval(g, X + sw, cy, w, h, jefa ? '#ffd84a' : P.white);
      for (let i = -w; i < w; i += 4) A.R(g, X + sw + i, cy - h + 1, 2, h, jefa ? '#e03a3a' : '#ff9ad0');
    }
    if (jefa) {
      A.R(g, X - 2, Y - 4, 4, 5, '#7a5ad0');
      A.R(g, X - 2, Y - 7, 4, 3, '#f0c8a8');
      A.R(g, X - 2, Y - 9, 4, 2, '#e03a3a');
      A.R(g, X - 3, Y - 7, 1, 2, '#d8d0ca');
      A.R(g, X + 2, Y - 7, 1, 2, '#d8d0ca');
    } else {
      // A grey mouse in a red flight helmet, legs kicking.
      A.R(g, X - 1, Y - 3, 3, 4, '#9a90b8');
      A.R(g, X - 2, Y - 7, 5, 4, '#b8b0d0');
      A.R(g, X - 3, Y - 8, 2, 2, '#c9b4ff');
      A.R(g, X + 2, Y - 8, 2, 2, '#c9b4ff');
      A.R(g, X - 1, Y - 8, 3, 1, '#e03a3a');
      A.R(g, X + 1, Y - 6, 1, 1, '#1a1428');
      A.R(g, X - 1 + (Math.floor(t * 6) % 2), Y + 1, 1, 1, '#9a90b8');
    }
  }

  /** The nuke: a fat dark-green bomb with the trefoil, under a red-and-white parachute once it opens. */
  function dibujarNuke(x: number, y: number, t: number) {
    const X = Math.round(x), Y = Math.round(y);
    const k = Math.min(1, Math.max(0, (t - NUKE_CAIDA) / 0.35));
    if (k > 0) {
      const sw = Math.round(Math.sin(t * 2.2) * 2);
      const w = Math.round(8 + 10 * k), h = Math.round(3 + 6 * k);
      const cy = Y - 14 - Math.round(12 * k);
      // Lines from the canopy edge to the bomb's tail.
      for (const dx of [-w + 1, -Math.round(w / 3), Math.round(w / 3), w - 1]) {
        const n = 10;
        for (let i = 0; i <= n; i++) A.R(g, Math.round(X + sw + dx + (-dx * i) / n), Math.round(cy + ((Y - 6 - cy) * i) / n), 1, 1, '#e8e0d0');
      }
      D.oval(g, X + sw, cy, w + 1, h + 1, '#5a2a2a');
      D.oval(g, X + sw, cy, w, h, P.white);
      for (let i = -w; i < w; i += 6) A.R(g, X + sw + i, cy - h + 1, 3, h, '#e03a3a');
      A.R(g, X + sw - w, cy, w * 2, 2, '#5a2a2a');
    }
    // The bomb, nose down.
    A.R(g, X - 4, Y - 6, 9, 13, '#1e3a24');
    A.R(g, X - 3, Y - 5, 7, 11, '#3a6a3a');
    D.disc(g, X, Y + 6, 4, '#3a6a3a');
    A.R(g, X - 2, Y - 4, 2, 9, '#5a8a4a');
    A.R(g, X - 5, Y - 9, 11, 3, '#2a4a2a');
    // The trefoil in a yellow disc, blinking red when close to the ground.
    D.disc(g, X, Y + 1, 3, Math.floor(t * 6) % 2 ? P.gold : '#ff4a3c');
    A.R(g, X, Y + 1, 1, 1, '#1a1a1a');
    A.R(g, X - 2, Y - 1, 1, 2, '#1a1a1a');
    A.R(g, X + 2, Y - 1, 1, 2, '#1a1a1a');
    A.R(g, X, Y + 3, 1, 1, '#1a1a1a');
  }

  /** The autopilot of the map trip: turns smoothly to fly right, holds a safe height, rolls upright. */
  function vueloGuiado(p: Avion, dt: number) {
    const ahead = ground(clamp(p.x + 120, 0, LEVEL));
    const alto = Math.max(260, ahead + 140, ground(p.x) + 140);
    const want = clamp(Math.atan2(alto - p.y, 260), -0.5, 0.5);
    const d = Math.atan2(Math.sin(want - p.rumbo), Math.cos(want - p.rumbo));
    p.rumbo += clamp(d, -2.6 * dt, 2.6 * dt);
    p.alabeo += (1 - p.alabeo) * Math.min(1, dt * 4);
    p.omega = 0;
    const sp = Math.max(170, Math.min(Math.hypot(p.vx, p.vy) + (s.nitroT > 0 ? 260 : 60) * dt, s.nitroT > 0 ? 420 : 260));
    p.vx = Math.cos(p.rumbo) * sp;
    p.vy = Math.sin(p.rumbo) * sp;
    p.x = clamp(p.x + p.vx * dt, 20, LEVEL - 20);
    p.y = Math.max(p.y + p.vy * dt, ground(p.x) + 60);
    p.carga = 1;
    p.perdida = false;
  }

  /**
   * An enemy (fighter, Margarita, helicopter) under attack pops flares when one of the
   * player's missiles homes on it and is close. Each flare may pull the missile off:
   * old rockets bite easily, modern seekers less (and may find the target again).
   */
  function defensaBengalas(quien: object, q: Movil, cd: number, n: number) {
    if ((s.bengalaCd.get(quien) ?? 0) > 0) return;
    let amenaza: Shot | null = null;
    for (const sh of s.shots) {
      if (sh.enemy || sh.m.t < 0 || !sh.lock || !sh.lock.vivo() || sh.lock.pos() !== q) continue;
      const d = Math.hypot(sh.m.x - q.x, sh.m.y - q.y);
      if (d < 210) amenaza = sh;
    }
    if (!amenaza) return;
    s.bengalaCd.set(quien, cd + Math.random() * 0.6);
    const sh = amenaza;
    const moderno = !!(sh.k ?? s.spec.kit.misil).buscador;
    let engano = false;
    for (let i = 0; i < n; i++) {
      const lado = i % 2 ? 1 : -1;
      const b = { x: q.x, y: q.y - 2, vx: q.vx * 0.4 + lado * (50 + i * 18), vy: q.vy * 0.4 - 20 - i * 6, t: 0 };
      s.bengalasR.push(b);
      if (!engano && Math.random() < (moderno ? 0.28 : 0.55)) {
        engano = true;
        sh.lock = { pos: () => b as Movil, vivo: () => b.t < 2.4 && s.bengalasR.includes(b), r: 3 };
      }
    }
    if (engano) pop(q.x, q.y + 14, '¡Bengalas! Misil engañado', '#ffb070');
    radio('Ratón en apuros', RADIO.bengalas, true);
    if (!s.attract) fx('bengalas', sfx.flare, { vol: 0.35, rate: 0.9 }, q.x);
  }

  /** A bomb reaching its target, by load. */
  function impactoBomba(b: BombaJ) {
    s.golpeBomba = true;
    try {
      impactoBombaCuerpo(b);
    } finally {
      s.golpeBomba = false;
    }
  }
  function impactoBombaCuerpo(b: BombaJ) {
    const x = b.x, y = Math.max(b.y, ground(b.x));
    const pan = panOf(x);
    const enSuelo = y - ground(x) < 30;
    if (b.tipo === 'racimo') blast(x, y, b.sub ? 5 : FA.ENERGIA.bombaJugador, 'jugador', b.sub ? 1.6 : 4);
    else if (b.tipo === 'fosforo') {
      blast(x, y, 10, 'jugador', 2);
      // White phosphorus keeps burning on land; the sea puts it out in a hiss of steam.
      if (enSuelo && !sobreMar(x)) s.zonas.push({ tipo: 'fuego', x, y: ground(x), r: 120, t: 0, vida: 7, tick: 0 });
      else for (let i = 0; i < 6; i++) puff(x + rand(-20, 20), y + rand(0, 10), 2, false, 0.9, rand(-20, 20), rand(20, 50));
      if (!s.attract) AB.fosforo(pan);
    } else if (b.tipo === 'gas') {
      blast(x, y, 3, 'jugador', 0.5);
      s.zonas.push({ tipo: 'gas', x, y: Math.max(y, ground(x) + 22), r: 90, t: 0, vida: 8, tick: 0 });
      if (!s.attract) AB.gas(pan);
    } else if (b.tipo === 'plasma') {
      blast(x, y, 34, 'jugador', 6);
      L.luz(s.luces, x, y, 60, '#c89aff', 0.5);
      if (!s.attract) AB.plasmaBomba(pan);
    } else if (b.tipo === 'termobarica') {
      // First the fuel cloud's blast, then the air rushing back in pulls everything to the middle and goes off again.
      blast(x, y, 30, 'jugador', 4.5);
      for (const c of s.cars) {
        const d = c.mid.x - x;
        if (Math.abs(d) < 140) FA.empujeVehiculo(c, -Math.sign(d) * 90, 30);
      }
      L.luz(s.luces, x, y, 70, '#ff9a3c', 0.6);
      later(() => blast(x, y + 8, 14, 'jugador', 3), 280);
    } else if (b.tipo === 'crio') {
      // Barely a pop: it's the cold that does the work.
      blast(x, y, 1.5, 'jugador', 0.1);
      for (const c of s.cars) if (Math.hypot(c.mid.x - x, c.mid.y - y) < 95 && !isBoss(c.kind)) c.mem.hielo = 5;
      for (const c of s.cars) if (isBoss(c.kind) && Math.hypot(c.mid.x - x, c.mid.y - y) < 120) c.mem.hielo = 1.5;
      s.zonas.push({ tipo: 'hielo', x, y: ground(x), r: 80, t: 0, vida: 5, tick: 0 });
      if (!s.attract) AB.holograma(pan);
    } else if (b.tipo === 'emp') {
      blast(x, y, 3, 'jugador', 0.6);
      const R2 = 200;
      for (const c of s.cars) if (Math.hypot(c.mid.x - x, c.mid.y - y) < R2) {
        c.mem.emp = 6;
        c.fireT = Math.max(c.fireT, 6);
      }
      for (const f of s.fighters) if (Math.hypot(f.a.x - x, f.a.y - y) < R2) {
        f.gunCd = Math.max(f.gunCd, 4);
        f.misilCd = Math.max(f.misilCd, 6);
      }
      let n = 0;
      for (const sh of s.shots) {
        if (!sh.enemy || sh.m.t < 0 || Math.hypot(sh.m.x - x, sh.m.y - y) > R2 * 1.4) continue;
        sh.m.guiado = false;
        sh.m.combustible = 0;
        sh.tgt = null;
        n++;
      }
      if (n) pop(x, y + 30, n > 1 ? `⚡ ¡${n} misiles apagados!` : '⚡ ¡Misil apagado!', '#7af0ff');
      s.zonas.push({ tipo: 'emp', x, y, r: R2, t: 0, vida: 1, tick: 0 });
      L.luz(s.luces, x, y, 80, '#7af0ff', 0.4);
      if (!s.attract) AB.rayoOvni();
    } else blast(x, y, FA.ENERGIA.bombaJugador, 'jugador', 4);
  }

  /** Steers a guided bomb: it can't climb, only glide sideways towards a target below. */
  function guiarBomba(b: BombaJ, dt: number) {
    let best: { x: number; y: number } | null = null, bd = 260;
    const pick = (x: number, y: number) => {
      const d = Math.abs(x - b.x);
      if (d < bd && y < b.y) {
        bd = d;
        best = { x, y };
      }
    };
    for (const c of s.cars) pick(c.mid.x, c.mid.y);
    for (const u of s.gigantes) if (u.viva) pick(u.x, ground(u.x));
    if (!best) return;
    const tgt = best as { x: number; y: number };
    const tiempo = Math.max(0.25, (b.y - tgt.y) / Math.max(40, -b.vy));
    const quiere = (tgt.x - b.x) / tiempo;
    b.vx += clamp(quiere - b.vx, -240 * dt, 240 * dt);
    if (Math.random() < dt * 20) L.luz(s.luces, b.x, b.y, 4, '#ff4a5a', 0.05);
  }

  /** Phosphorus fires and gas clouds: damage over time to what's inside. */
  function stepZonas(dt: number) {
    const wind = FV.viento(s.t, s.plane.x, 0);
    for (const z of s.zonas) {
      z.t += dt;
      if (z.tipo === 'gas') {
        // The cloud drifts with the wind, rises a little and spreads.
        z.x += wind * 0.6 * dt;
        z.y = Math.max(ground(z.x) + 18, z.y + 3 * dt);
        z.r = Math.min(180, z.r + 22 * dt);
      } else if (Math.random() < dt * 14) puff(z.x + rand(-z.r, z.r), z.y + rand(4, 14), 1, false, 0.9, rand(-8, 8), rand(20, 45));
      if (z.tipo === 'hielo' || z.tipo === 'emp') continue;
      z.tick -= dt;
      if (z.tick > 0) continue;
      z.tick = 0.25;
      const k = 1 - z.t / z.vida;
      const dmg = (z.tipo === 'fuego' ? 0.16 : 0.1) * (0.5 + 0.5 * k) * danoMul();
      const dentro = (x: number, y: number, m = 0) => (z.tipo === 'fuego' ? Math.abs(x - z.x) < z.r + m && y - z.y < 26 : Math.hypot(x - z.x, (y - z.y) * 1.4) < z.r + m);
      for (const c of s.cars) if (dentro(c.mid.x, c.mid.y, 6)) hurtCar(c, dmg);
      for (const u of s.gigantes) {
        if (!u.viva) continue;
        const bx = G.caja(u);
        const cx = (bx.x0 + bx.x1) / 2;
        if (dentro(cx, bx.y0, (bx.x1 - bx.x0) / 2)) giantHit(u, G.golpear(u, cx, bx.y0 + 2, dmg * 2));
      }
      if (z.tipo === 'gas') {
        for (const a of s.aereos) {
          if (a.hp <= 0 || !dentro(a.x, a.y)) continue;
          a.hp -= dmg;
          s.airFlash.set(a.id, 0.08);
          if (a.hp <= 0) abatirAereo(a);
        }
        for (const f of s.fighters) if (f.hp > 0 && dentro(f.a.x, f.a.y)) hurtFighter(f, dmg);
      }
    }
    s.zonas = s.zonas.filter((z) => z.t < z.vida);
  }

  /** Moves the tracers and hits whatever they touch. */
  function stepBullets(dt: number) {
    for (const b of s.bullets) {
      b.t += dt;
      b.vy -= FA.GRAVEDAD * b.g * dt;
      const bd = b.d * danoMul();
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let hit = false;
      if (b.y <= ground(b.x)) {
        hit = true;
        if (sobreMar(b.x)) chapoteo(b.x, 0.35);
        else puff(b.x, ground(b.x) + 1, 1, false, 0.4);
      }
      for (const c of s.cars) {
        if (hit) break;
        const look = A.VEH_LOOK[c.kind];
        if (Math.abs(b.x - c.x) < look.w / 2 + 1 && b.y > c.y - 1 && b.y < c.y + look.h) {
          hit = true;
          hurtCar(c, 0.11 * bd);
        }
      }
      for (const a of s.aereos) {
        if (hit || a.hp <= 0) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < AE.radio(a) + 2) {
          hit = true;
          a.hp -= 0.18 * bd;
          s.airFlash.set(a.id, 0.08);
          if (a.hp <= 0) abatirAereo(a);
        }
      }
      for (const u of s.gigantes) {
        if (hit || !u.viva) continue;
        const bx = G.caja(u);
        if (b.x > bx.x0 && b.x < bx.x1 && b.y > bx.y0 && b.y < bx.y1) {
          hit = true;
          giantHit(u, G.golpear(u, b.x, b.y, 0.25 * bd));
        }
      }
      for (const f of s.fighters) {
        if (hit || f.hp <= 0) continue;
        if (CZ.tocado(f, b.x, b.y, 1)) {
          hit = true;
          hurtFighter(f, 0.2 * bd);
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
            avanzaMision('misiles');
          }
        }
      }
      if (!hit && s.jefe && JF.tocado(s.jefe, b.x, b.y, 1)) {
        hit = true;
        const h = JF.golpear(s.jefe, b.x, b.y, 0.22 * BOSS_MUL[s.spec.id] * bd);
        s.jefeFlash = 0.06;
        if (h.derrotado) award(h.puntos ?? 0, b.x, b.y);
      }
      if (hit) {
        VFX.chispazo(s.fx, b.x, b.y, b.vx, b.vy, still || s.calma);
        L.luz(s.luces, b.x, b.y, 5, '#fff2c0', 0.05);
        b.t = b.life;
        s.shards.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(10, 60), t: 0, c: P.gold });
      }
    }
    s.bullets = s.bullets.filter((b) => b.t < b.life);
  }

  function firePlayer() {
    const p = s.plane;
    const km = s.spec.kit.misil;
    // Pressing a weapon that isn't ready: a dry click (once per press).
    if (!s.attract) {
      if (input.fire && !s.fireWasDown && (s.ammo < 1 || s.fireT > 0.05)) AB.sinMunicion(panOf(p.x));
      if (input.bomb && !s.bombWasDown && (s.bombAmmo < 1 || s.bombT > 0.05)) AB.sinMunicion(panOf(p.x));
      if (input.flare && !s.flareWasDown && s.flares <= 0) AB.bengalaVacia();
    }
    s.fireWasDown = input.fire;
    s.bombWasDown = input.bomb;
    if (input.fire && s.ammo >= 1 && s.fireT <= 0) {
      const m = FA.misilJugador(p, s.wave);
      m.combustible = km.opts.quemado;
      // No lock-on: the missile flies where the nose points.
      // Held the nose on an enemy long enough: this missile homes on it.
      const locked = s.lockT >= LOCK_TIME && s.lockCand && s.lockCand.vivo() ? s.lockCand : undefined;
      s.shots.push({ m, enemy: false, tgt: null, trail: 0, lock: locked, k: km });
      // Chorrillana: two more missiles fanned out either side of the nose.
      if (s.boost === 'chorrillana') {
        for (const da of [-0.14, 0.14]) {
          const extra = FA.misilJugador(p, s.wave);
          extra.combustible = km.opts.quemado;
          const sp = Math.hypot(extra.vx, extra.vy);
          extra.rumbo += da;
          extra.vx = Math.cos(extra.rumbo) * sp;
          extra.vy = Math.sin(extra.rumbo) * sp;
          s.shots.push({ m: extra, enemy: false, tgt: null, trail: 0, k: km });
        }
      }
      usar('disparar');
      if (locked) usar('fijar');
      s.ammo--;
      s.fireT = km.cadencia;
      if (km.sonido === 'orbe') { if (!s.attract) AB.orbe(panOf(p.x)); }
      else if (km.sonido === 'crucero') { if (!s.attract) AB.crucero(panOf(p.x)); }
      else fx('misil', sfx.launch, { vol: 0.4, rate: rand(0.95, 1.1), dur: 0.35 });
    }
    if (input.bomb && s.bombT <= 0 && s.bombAmmo >= 1) {
      s.bombAmmo--;
      for (let i = 0; i < s.spec.bombs; i++) {
        // A stick of bombs spreads out a little instead of falling as one blob.
        const sb = FA.soltarBomba(p, i);
        sb.vx += (i - (s.spec.bombs - 1) / 2) * 14;
        s.bombs.push({ ...sb, tipo: s.bomba });
        // «Lluvia de bombas»: two more fanned out either side of each one.
        if (s.boost === 'lluvia') for (const dv of [-35, 35]) {
          const b = FA.soltarBomba(p, i);
          b.vx += dv;
          s.bombs.push({ ...b, tipo: s.bomba });
        }
      }
      s.bombT = s.spec.bombCd * (s.boost === 'bombas' ? 0.5 : 1);
      fx('bomba', sfx.bomb, { vol: 0.5 });
    }
    if (input.flare && !s.flareWasDown && s.flares > 0 && s.flareCd <= 0) {
      usar('bengala');
      s.flares--;
      s.flareCd = 0.6;
      // Movie style: a burst of flares punched out one after another, alternating sides.
      s.salva = { i: 0, t: 0, enganados: 0 };
    }
    s.flareWasDown = input.flare;
  }

  /** Pops the next flare of a burst: out to the side, arcing down on a smoke trail, and a «tun». */
  function stepSalva(dt: number) {
    const sv = s.salva;
    if (!sv) return;
    const p = s.plane;
    if (s.dead) {
      s.salva = null;
      return;
    }
    sv.t -= dt;
    if (sv.t > 0) return;
    sv.t = SALVA_DT;
    const lado = sv.i % 2 ? 1 : -1;
    // Out of the belly, sideways and down, like a wing of fireworks.
    const ux = Math.cos(p.rumbo), uy = Math.sin(p.rumbo);
    const al = p.alabeo >= 0 ? 1 : -1;
    const nx = -uy * al, ny = ux * al;
    // Each pair flies out wider than the last: the burst opens like a firework fan.
    const fuerza = 110 + (sv.i >> 1) * 26;
    const f = {
      x: p.x - ux * 6, y: p.y - uy * 6 - 2, tipo: 'magnesio' as HG.BengalaTipo, t: 0,
      vx: p.vx * 0.35 - ux * 40 + nx * lado * fuerza,
      vy: p.vy * 0.35 - uy * 40 + ny * lado * fuerza + 30,
    };
    s.flareBodies.push(f);
    const kb = s.spec.kit.bengala;
    for (const sh of s.shots) {
      if (!(sh.enemy && sh.tgt === p && sh.m.guiado)) continue;
      for (let k = 0; k < kb.intentos; k++) {
        if (MS.engana(sh.m, f, p)) {
          sh.tgt = f;
          sv.enganados++;
          break;
        }
      }
    }
    L.luz(s.luces, f.x, f.y, 18, '#fff2c0', 0.12);
    fx('bengalas', sfx.flare, { vol: 0.32, rate: 1.05 + sv.i * 0.025, dur: 0.16 }, p.x);
    sv.i++;
    if (sv.i >= SALVA_N) {
      if (sv.enganados) {
        pop(p.x, p.y + 18, sv.enganados > 1 ? `¡${sv.enganados} misiles engañados!` : '¡Misil engañado!', P.gold);
        sfx.star();
      }
      s.salva = null;
    }
  }

  /* ── Mini-missions, hints and the silent help ── */

  function elegirMision(): Mision {
    const opts: [MisionId, string, number][] = [
      ['despensa', 'No pierdas pescado', 1],
      ['combo3', 'Haz un combo ×3', 1],
      ['misiles', 'Derriba 2 misiles enemigos', 2],
      ['piezas', 'Termina sin perder piezas', 1],
    ];
    if (s.fighterQueue >= 2) opts.push(['cazas', 'Derriba 2 cazas', 2]);
    // Only goals that can be met in this wave; the first wave keeps it easy.
    const pool = s.mapa === 'tormenta'
      ? ([['cazas', 'Derriba 4 cazas', 4], ['piezas', 'Termina sin perder piezas', 1], ['combo3', 'Haz un combo ×3', 1]] as [MisionId, string, number][])
      : s.wave === 1 ? opts.filter(([id]) => id === 'despensa') : opts;
    const [id, texto, meta] = pool[Math.floor(Math.random() * pool.length)];
    if (id === 'cazas' && meta > s.fighterQueue) {
      const m = Math.max(1, s.fighterQueue);
      return { id, texto: `Derriba ${m} caza${m > 1 ? 's' : ''}`, meta: m, prog: 0, hecha: false, fallida: false };
    }
    return { id, texto, meta, prog: 0, hecha: false, fallida: false };
  }
  function avanzaMision(id: MisionId) {
    const m = s.mision;
    if (!m || m.id !== id || m.hecha || m.fallida) return;
    m.prog++;
    if (m.prog >= m.meta) completaMision();
  }
  function completaMision() {
    const m = s.mision;
    if (!m || m.hecha || m.fallida || s.mode !== 'play') return;
    m.hecha = true;
    m.prog = m.meta;
    s.score += 300;
    pop(s.plane.x, s.plane.y + 26, '🏅 ¡Misión cumplida! +300 · +1 ⭐', P.gold);
    s.puntosMejora++;
    AB.misionCumplida();
  }
  /** Any balloon, even when every slot is full (the guaranteed one per wave). */
  function maybePrizeAny(): Premio {
    const room = (['misil', 'bomba', 'bengala'] as Arma[]).filter((k) => s.cap[k] < capMax(k));
    return room.length ? room[Math.floor(Math.random() * room.length)] : s.lost.length ? 'reparar' : 'bengala';
  }
  function usar(k: PistaId) {
    if (s.attract) return;
    s.usos[k]++;
    if (s.usos[k] >= 2 && !s.pistas.has(k)) {
      s.pistas.add(k);
      try {
        localStorage.setItem(PISTAS_KEY, JSON.stringify([...s.pistas]));
      } catch {
        /* private mode */
      }
    }
  }
  function textoPista(k: PistaId): string {
    const t = view.touch;
    return {
      girar: t ? 'Mantén izquierda o derecha para girar' : 'Flechas o WASD para pilotear',
      disparar: t ? 'Toca 🚀 Misil o 💥 Metralla para disparar' : 'Espacio: misil · H: metralla',
      fijar: 'Mantén la nariz 1 s sobre un enemigo: se fija y el misil lo persigue',
      bengala: t ? '¡Misil! Toca ✨ Bengalas o gira fuerte' : '¡Misil! L suelta bengalas, o gira fuerte',
      nitro: t ? 'Doble toque en la pantalla: super nitro 🔥' : 'Aprieta E dos veces: super nitro 🔥',
    }[k];
  }
  /** Picks the hint that fits the moment, if the player hasn't learned it yet. */
  function stepPistas(dt: number) {
    const p = s.plane;
    if (Math.abs(input.x) > 0.3 || Math.abs(input.y) > 0.3) {
      s.usos.girar += dt;
      if (s.usos.girar > 1.5 && !s.pistas.has('girar')) usar('girar'), usar('girar');
    }
    const learned = (k: PistaId) => s.pistas.has(k);
    const enemyAhead = s.cars.some((c) => Math.abs(c.x - p.x) < view.vw * 0.6) || s.fighters.length > 0 || s.aereos.length > 0;
    const chased = s.shots.some((sh) => sh.enemy && sh.tgt === p && sh.m.guiado && sh.m.t >= 0);
    let k: '' | PistaId = '';
    if (!learned('girar') && !view.touch && s.t - s.waveStartT > 1) k = 'girar';
    else if (chased && !learned('bengala')) k = 'bengala';
    else if (!learned('disparar') && enemyAhead) k = 'disparar';
    else if (learned('disparar') && !learned('fijar') && enemyAhead && s.wave >= 2) k = 'fijar';
    else if (!learned('nitro') && s.wave >= 2 && learned('bengala')) k = 'nitro';
    // The first time a guided missile comes, half a second of slow motion to read it.
    if (k === 'bengala' && s.pista !== 'bengala' && !s.calma && !still) s.slowT = Math.max(s.slowT, 0.5);
    if (k && k !== s.pista && !s.attract) AB.pista();
    s.pista = k;
  }

  function carFires(c: Car) {
    const p = s.plane;
    // Now and then a mouse shouts something.
    if (!s.attract && s.t > s.gritoT && Math.random() < 0.25 && !isBoss(c.kind)) {
      s.gritoT = s.t + rand(7, 12);
      pop(c.mid.x, c.y + A.VEH_LOOK[c.kind].h + 10, SAY.ratones[Math.floor(Math.random() * SAY.ratones.length)], '#c9b4ff');
    }
    // The first wave is a warm-up: nothing fires for 20 s, then one missile at a time.
    if (s.wave === 1 && (s.t - s.waveStartT < 20 || s.shots.some((sh) => sh.enemy && sh.m.t >= 0))) return;
    // How many guided missiles may chase the plane at once grows with the waves
    // (one fewer while the silent help is high).
    const maxGuided = Math.max(1, (s.wave <= 2 ? s.wave : Math.min(2 + Math.floor(s.wave / 3), 6)) - (s.ayuda > 0.6 ? 1 : 0));
    if (s.shots.filter((sh) => sh.enemy && sh.m.t >= 0 && sh.tgt === p && sh.m.guiado).length >= maxGuided) return;
    const lvl = s.wave;
    const ox = c.mid.x;
    const oy = c.y + 14;
    if (c.kind === 'portaaviones') return; // its guns and fighters run in carrierStep
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
    const pick = MS.elegirArmamento(ARMA_DE[c.kind], lvl, Math.random, above);
    if (!pick && above > 500) return;
    const tipo = pick ?? (c.kind === 'tanque' || c.kind === 'fragata' ? null : 'buscador');
    if (tipo) {
      // The SAM fires a pair (one salvo of the swarm); the rest, one at a time.
      const salvos = (c.kind === 'sam' || c.kind === 'fragata') && tipo !== 'enjambre' ? [-0.3, 0.3] : [0];
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
    // right half clockwise. It starts gentle (a tap nudges the nose) and tightens
    // while held, up to 90° off the nose: the tightest turn.
    if (turn && s.mode === 'play' && !s.dead) {
      turnK = Math.min(1, turnK + dt / 0.4);
      const off = turn * (0.35 + 1.1 * turnK * turnK);
      touch.x = Math.cos(p.rumbo + off);
      touch.y = Math.sin(p.rumbo + off);
      syncInput();
    } else turnK = 0;
    // Phones: the machine gun fires by itself whenever an enemy sits in the sights.
    if (s.autoGun && s.mode === 'play' && !s.dead && !s.attract) {
      const enMira = enemigoEnMira(p);
      if (enMira !== touch.gun) {
        touch.gun = enMira;
        syncInput();
      }
    }

    // The plane: the player flies it; in the menu it flies itself.
    if (s.mode === 'demo') {
      const dir = p.x > LEVEL - 400 ? -1 : p.x < 300 ? 1 : Math.cos(p.rumbo) >= 0 ? 1 : -1;
      const ty = 150 + Math.sin(s.t * 0.6) * 25;
      FV.pasoAvion(p, 'avioneta', { x: dir, y: clamp((ty - p.y) / 40, -1, 1), gas: 0 }, dt, ground, top);
    } else if (!s.dead) {
      if (s.attract) attractBot();
      const mando: Mando = { x: input.x, y: input.y, gas: input.gas };
      // Too high: the cold builds ice; full of it, the controls freeze and the
      // plane drops nose-down until it thaws lower down.
      if (s.mode === 'play' && !s.attract) {
        const frio = clamp((p.y - FRIO_DESDE) / 200, 0, 1);
        s.hielo = clamp(s.hielo + (frio > 0 ? HIELO_SUBE * (0.4 + frio) : -HIELO_BAJA) * dt, 0, 1);
        if (!s.congelado && s.hielo >= 1) {
          s.congelado = true;
          AB.congelado();
          pop(p.x, p.y + 20, '🧊 ¡Congelado!', '#bfe8ff');
        }
        if (s.congelado && s.hielo < 0.35) {
          s.congelado = false;
          pop(p.x, p.y + 20, '¡Descongelado!', P.gold);
          AB.deshielo();
        }
        if (s.congelado) {
          mando.x = Math.cos(p.rumbo) >= 0 ? 0.25 : -0.25;
          mando.y = -1;
          mando.gas = -1;
          s.nitroT = 0;
        }
      }
      // Trip to the new map: autopilot level to the right, nitro, then the sea.
      if (s.transT > 0 && s.mode === 'play') {
        const before = s.transT;
        if (!s.tienda) s.transT -= dt;
        s.inv = Math.max(s.inv, 1);
        mando.x = 1;
        mando.y = 0;
        mando.gas = 1;
        if (before > TRANS_T - 1 && s.transT <= TRANS_T - 1) {
          s.nitroCd = 0;
          startNitro();
          if (!s.attract && (s.toMapa === 'oceano' || s.toMapa === 'tormenta')) AB.rumboAlMar(s.toMapa);
        }
        if (s.transT <= 0) {
          s.transT = 0;
          const destino = s.toMapa || 'oceano';
          s.toMapa = '';
          cambiarMapa(destino);
          s.queue = waveList(s.wave);
          s.bigQueue = destino === 'oceano' ? [] : G.elegirGrandes(s.wave, Math.random);
          s.fighterQueue = Math.max(1, CZ.cuantos(s.wave)) + (s.wave >= 3 ? Math.floor((s.wave - 1) / 4) : 0);
          if (destino === 'tormenta') prepararTormenta();
          // Nothing follows the plane to the new map; the wave's goal suits the new map.
          s.jefe = null;
          s.jefeEspacio = false;
          s.aereos = [];
          s.fighters = [];
          s.mision = elegirMision();
          s.shots = [];
          s.proy = [];
          s.zonas = [];
          s.bombs = [];
          p.x = 260;
          p.y = 240;
          p.vx = 150;
          p.vy = 0;
          p.rumbo = 0;
          p.alabeo = 1;
          s.revelar = 1;
          // A moment of grace on arrival, so nothing there catches the plane off guard.
          s.inv = Math.max(s.inv, 2.5);
          s.gracia = Math.max(s.gracia, 1.2);
          s.banner = { oceano: '🌊 ¡Frente a San Antonio, mar adentro!', valparaiso: '🏘️ ¡Bienvenido a Valparaíso!', tormenta: '⛈️ ¡Tormenta! Solo cazas', valle: '🏠 ¡De vuelta en San Antonio!' }[destino];
          if (destino === 'tormenta') p.y = 700;
          window.setTimeout(() => {
            if (/^(🌊|🏘️|⛈️|🏠)/.test(s.banner)) s.banner = '';
          }, 2200);
        }
      }
      // The edges of the map turn the plane back (no flying off screen) — not during the trip.
      if (s.transT <= 0) {
        if (p.x < 90 && Math.cos(p.rumbo) < 0.3) mando.x = 1;
        if (p.x > LEVEL - 90 && Math.cos(p.rumbo) > -0.3) mando.x = -1;
        if (p.x < 90 || p.x > LEVEL - 90) mando.y = Math.max(mando.y, 0);
      }
      if (s.despegue === 'subiendo') {
        s.despT += dt;
        s.inv = Math.max(s.inv, 0.5);
        if (s.despT >= 2.4) {
          s.despegue = 'pista';
          s.vrAvisado = false;
        }
      } else if (s.despegue === 'pista') rodarPista(mando, dt);
      if (s.gracia > 0) {
        s.gracia -= dt;
        mando.y = Math.max(mando.y, 0.4);
      }
      // The trip to a new map is a guided, unbreakable flight: level, clear of the ground, to the right.
      const viaje = s.transT > 0 && s.mode === 'play' && !s.dead;
      if (viaje) vueloGuiado(p, dt);
      const vuela = !s.despegue && !viaje;
      for (const ev of vuela ? FV.pasoAvion(p, s.spec.id, mando, dt, ground, top, true) : []) {
        if (ev.tipo === 'toqueSuelo' && ev.velocidad > 35 && s.mode === 'play') {
          // A hard crash into the ground blows the plane up at once; a scrape costs a part.
          if (s.gracia > 0) {
            // Just off the runway: a bump, not a crash.
          } else if (ev.velocidad > 60) {
            s.lastHit = 'suelo';
            s.inv = 0;
            destroyPlane();
          } else {
            hurtPlane(1, p.x, p.y - 8);
            blast(p.x, p.y - 4, FA.ENERGIA.obus, 'nadie', 0);
          }
        }
      }
      // Braking (Q) cuts the nitro; braking hard at speed spools the engine down, glowing as it cools.
      const frena = input.gas < 0 && !s.despegue;
      if (frena && !s.frenoAntes) {
        const rapido = Math.hypot(p.vx, p.vy) > FV.PARAMS[s.spec.id].velMax * 0.7;
        if (s.nitroT > 0) apagarNitro();
        else if (rapido) s.enfriaT = ENFRIA_T;
      }
      s.frenoAntes = frena;
      if (s.enfriaT > 0) {
        s.enfriaT = Math.max(0, s.enfriaT - dt);
        const k = s.enfriaT / ENFRIA_T;
        const tx = p.x - Math.cos(p.rumbo) * (s.spec.hit + 3), ty = p.y - Math.sin(p.rumbo) * (s.spec.hit + 3);
        L.luz(s.luces, tx, ty, 6 + 8 * k, k > 0.5 ? '#ff7a3c' : '#c0405a', 0.04 * k);
        // Hot exhaust turning into grey smoke as it cools.
        if (Math.random() < dt * (10 + 20 * (1 - k))) puff(tx, ty, rand(0.8, 1.6), k < 0.4, 0.5 + 0.3 * (1 - k), -p.vx * 0.1 + rand(-8, 8), -p.vy * 0.1 + rand(4, 16));
      }
      // Super nitro: a hard shove along the nose, past the normal top speed.
      if (s.nitroT > 0) {
        s.nitroT -= dt;
        if (s.nitroT <= 0 && !s.attract) AB.nitroFin();
        L.luz(s.luces, p.x - Math.cos(p.rumbo) * (s.spec.hit + 4), p.y - Math.sin(p.rumbo) * (s.spec.hit + 4), 14, '#ffb347', 0.05);
        p.vx += Math.cos(p.rumbo) * NITRO_ACC * dt;
        p.vy += Math.sin(p.rumbo) * NITRO_ACC * dt;
        if (Math.random() < dt * 40) puff(p.x - Math.cos(p.rumbo) * 12, p.y - Math.sin(p.rumbo) * 12, rand(1, 2.5), false, 0.6, -p.vx * 0.2, -p.vy * 0.2);
      }
      // Stuck on the ground (too slow, too broken to take off): it's a crash.
      if (s.mode === 'play' && !s.despegue && p.y - ground(p.x) < 14 && Math.hypot(p.vx, p.vy) < 30) {
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
      // Skimming the sea: a spray wake behind the plane and a rooster tail when very low.
      chapoteoT -= dt;
      rozarT -= dt;
      const rasante = p.y - OC.NIVEL_MAR;
      if (sobreMar(p.x) && rasante < 34 && rasante > -2 && speed > 60 && rozarT <= 0) {
        const k = 1 - rasante / 34;
        rozarT = 0.05 - 0.025 * k;
        const tras = p.x - Math.sign(p.vx || 1) * (6 + Math.random() * 6);
        VFX.salpicar(s.fx, tras, OC.NIVEL_MAR, 0.25 + k * Math.min(1.2, speed / 260), still || s.calma);
        puff(tras, OC.NIVEL_MAR + 2 + Math.random() * 4 * k, 1, false, 0.35 + 0.4 * k, -p.vx * 0.15, 12 + 30 * k);
        if (k > 0.6 && splashes.length < 30 && Math.random() < 0.25) splashes.push({ x: tras, t: 0.3 });
        if (!s.attract && k > 0.4 && Math.random() < 0.08) AB.salpicadura(panOf(p.x), 0.3 + 0.5 * k);
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
      if (s.nitroCd > 0 && s.nitroCd - dt <= 0 && !s.attract) AB.nitroListo();
      s.nitroCd = Math.max(0, s.nitroCd - dt);
      s.especialCd = Math.max(0, s.especialCd - dt);
      if (s.boostT > 0) {
        s.boostT -= dt;
        if (s.boost === 'cohetes') s.ammo = s.cap.misil;
        if (s.boost === 'bombas') s.bombAmmo = s.cap.bomba;
        if (s.boost === 'bengalas') s.flares = s.cap.bengala;
        if (s.boostT <= 0) s.boost = '';
      }
      if (s.ammo < s.cap.misil) {
        s.reloadT += dt;
        if (s.reloadT >= s.spec.reload) {
          s.ammo++;
          s.reloadT = 0;
          if (!s.attract) AB.armaRecargada('misil');
        }
      }
      if (s.bombAmmo < s.cap.bomba) {
        s.bombReloadT += dt;
        if (s.bombReloadT >= BOMB_RELOAD) {
          s.bombAmmo++;
          s.bombReloadT = 0;
          if (!s.attract) AB.armaRecargada('bomba');
        }
      }
      if (s.flares < s.cap.bengala) {
        s.flareT += dt;
        if (s.flareT >= FLARE_RELOAD) {
          s.flares++;
          s.flareT = 0;
          if (!s.attract) AB.armaRecargada('bengala');
        }
      }
      if (!s.congelado) {
        firePlayer();
        fireGun(dt);
        if (input.nuke && !s.nukeWasDown && s.nukes > 0 && !s.nuke) soltarNuke();
        if (input.tonel && !s.tonelWasDown) tonel();
        acrobacias(dt);
      }
      s.nukeWasDown = input.nuke;
      s.tonelWasDown = input.tonel;
      stepLock(dt);
      stepPistas(dt);
    }

    // Waves (they wait until the plane is off the ground).
    if (s.mode === 'play' && !s.despegue) {
      if (s.phase === 'break') {
        if (!s.tienda) s.breakT -= dt;
        if (s.breakT <= 0) {
          s.phase = 'wave';
          s.banner = '';
          if (!s.attract) AB.oleadaInicio();
        }
      } else {
        s.spawnT -= dt;
        if (s.queue.length && s.spawnT <= 0 && !s.cars.some((c) => c.x > LEVEL - 30)) {
          const kind = s.queue.shift()!;
          const v = FA.nuevoVehiculo(LEVEL + 20, ground, VEH[kind].masa);
          s.cars.push({
            ...v,
            kind,
            // Every wave the mice come back tougher.
            hp: VEH[kind].hp * Math.min(2.2, 1 + 0.08 * (s.wave - 1)),
            fireT: VEH[kind].cd * rand(0.5, 1),
            flash: 0,
            wheel: 0,
            aim: -Math.PI * 0.75,
            mid: { x: v.x, y: v.y + 8, vx: 0, vy: 0 },
            id: ++carIds,
            mem: {},
          });
          const prize = maybePrize();
          // At least one balloon per wave, predictable: by the middle of the queue.
          const forced = !prize && s.wavePrizes === 0 && s.queue.length <= Math.floor(s.waveSize / 2);
          const give = prize ?? (forced ? maybePrizeAny() : null);
          if (give) {
            s.carPrize.set(carIds, give);
            s.wavePrizes++;
          }
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
        const tormenta = s.mapa === 'tormenta';
        if (s.fighterQueue > 0 && s.fighterT <= 0 && !s.jefe && (!tormenta || s.fighters.length < 3)) {
          s.fighterQueue--;
          const fromRight = Math.random() < 0.6;
          s.fighters.push(CZ.crear(clamp(s.camX + (fromRight ? view.vw + 80 : -80), 40, LEVEL - 40), clamp(p.y + rand(-40, 120), tormenta ? 360 : 150, CEIL - 100), !fromRight, s.wave, tormenta));
          radio('Ratón Líder', RADIO.llegan);
          s.fighterT = tormenta ? rand(2.5, 4) : rand(9, 15);
          if (!s.banner) {
            s.banner = '✈️ ¡Cazas ratón en el aire!';
            window.setTimeout(() => {
              if (s.banner.startsWith('✈️')) s.banner = '';
            }, 2000);
          }
          sfx.warn();
        }
        // Space is never empty: hang around up there and UFOs keep coming.
        if (!s.duelo && !s.airQueue.length && s.airT <= 0 && p.y > AE.ALTURA_OVNI && s.aereos.filter((a) => a.tipo === 'ovni').length < 2) {
          const visitas = AE.crear('ovni', clamp(s.camX + view.vw + 60, 40, LEVEL - 40), AE.alturaAparicion('ovni', p.y, Math.random), Math.random, s.wave);
          for (const a of visitas) a.extra = true;
          spawnAir(visitas);
          s.airT = rand(8, 12);
        }
        s.bigT -= dt;
        if (s.bigQueue.length && s.bigT <= 0) {
          s.gigantes.push(...G.crear(s.bigQueue.shift()!, LEVEL + 40, ground, Math.random, s.wave));
          s.bigT = rand(6, 11);
        }
        const clear =
          !s.queue.length && !s.cars.length && !s.aereos.some((a) => !a.extra) && !s.airQueue.length && !s.bigQueue.length &&
          !s.gigantes.some((u) => u.viva) && (!s.jefe || s.jefeEspacio) && !s.fighters.length && !s.fighterQueue && s.overT === 0;
        if (clear && s.mapa === 'oceano' && s.bossFor !== s.wave) {
          // At sea, Margarita comes back at the helm of an aircraft carrier.
          s.bossFor = s.wave;
          const v = FA.nuevoVehiculo(LEVEL + 90, ground, VEH.portaaviones.masa);
          const hp = VEH.portaaviones.hp * (1 + 0.4 * Math.max(0, s.bossCount - 1));
          s.bossMax = hp;
          s.cars.push({ ...v, kind: 'portaaviones', hp, fireT: 99, flash: 0, wheel: 0, aim: 0, mid: { x: v.x, y: v.y + 20, vx: 0, vy: 0 }, id: ++carIds, mem: {} });
          prepJefe();
          talk(SAY.mar);
          s.sayT = 5;
          s.bossCount++;
          s.banner = '⚓ ¡Margarita llega en su portaaviones!';
          AB.bocina();
          window.setTimeout(() => {
            if (s.banner.startsWith('⚓')) s.banner = '';
          }, 2600);
          AB.jefeLlega();
        } else
        if (clear && s.jefeFor !== s.wave && s.mapa === 'valparaiso') {
          // Airship after wave 3 (9, 15…), mothership after wave 6 (12, 18…).
          s.jefeFor = s.wave;
          // Her Su-57 the first time, a better jet (a red Raptor) the next, and so on.
          iniciarDuelo(Math.floor((s.wave - 1) / 4) % 2 === 1);
        } else
        if (clear && s.mapa === 'tormenta' && s.jefeFor !== s.wave) {
          // The storm's boss: Margarita's huge zeppelin, out of the clearing night.
          s.jefeFor = s.wave;
          spawnBoss('zepelin');
        } else
        if (clear && s.mapa === 'valle' && s.bossFor !== s.wave) {
          // The wave is clear… and here comes the neighbour.
          s.bossFor = s.wave;
          const v = FA.nuevoVehiculo(LEVEL + 40, ground, VEH.margarita.masa);
          const hp = VEH.margarita.hp * (1 + 0.5 * s.bossCount);
          s.bossMax = hp;
          s.cars.push({ ...v, kind: 'margarita', hp, fireT: 2, flash: 0, wheel: 0, aim: 0, mid: { x: v.x, y: v.y + 25, vx: 0, vy: 0 }, id: ++carIds, mem: {} });
          prepJefe();
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
          if (!s.attract) AB.oleadaSuperada();
          // The voyage: every wave ends by flying on to the next map, whether
          // its boss was beaten or got away.
          s.toMapa = SIGUIENTE[s.mapa];
          // ⭐ A point for the wave; the shop opens on the card if there are points to spend.
          s.puntosMejora++;
          s.coraza = s.niv.salud;
          if (!s.attract) s.tienda = true;
          // A plane for every wave survived.
          if (s.lives < MAX_VIDAS) {
            s.lives++;
            pop(s.plane.x, s.plane.y + 30, '✈️ ¡+1 avión!', P.gold);
          }
          // The wave's mini-mission: done if its goal was reached and nothing failed it.
          const ms = s.mision;
          if (ms && !ms.hecha && !ms.fallida && (ms.id === 'despensa' || ms.id === 'piezas')) completaMision();
          // A clean wave eases the silent help off a little.
          if (s.deathsWave === 0) s.ayuda = Math.max(0, s.ayuda - 0.1);
          const next = s.wave + 1;
          const destino: Resumen['destino'] = s.toMapa && s.toMapa !== s.mapa ? s.toMapa : '';
          const siguiente = destino ? NOMBRE_MAPA[destino] : 'más ratones';
          void next;
          // The end-of-wave card: what this wave was worth.
          s.resumen = {
            oleada: s.wave, enemigos: s.kills - s.ckKills, puntos: s.score - s.ckScore, tiempo: Math.round(s.t - s.waveStartT),
            pescado: s.meta, aviones: s.lives, destino,
            mision: ms ? ms.texto : '', cumplida: !!ms?.hecha, siguiente,
            dato: datoDe(destino || s.mapa),
          };
          nextWave();
          if (s.nuevos.length) s.resumen.nuevos = s.nuevos;
          s.nuevos = [];
          s.banner = '';
          s.breakT = s.resumen.destino ? TRANS_T + 1.6 : 4.2;
          window.setTimeout(() => {
            if (s.mode === 'play' && s.phase === 'break') s.banner = `Oleada ${s.wave}`;
          }, (s.breakT - 1.1) * 1000);
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
      const helado = c.mem.hielo > 0;
      if (helado) c.mem.hielo -= dt;
      if (c.mem.emp > 0) {
        c.mem.emp -= dt;
        if (Math.random() < dt * 6) VFX.chispazo(s.fx, c.mid.x + rand(-8, 8), c.mid.y + rand(0, 8), 0, 40, still || s.calma);
      }
      if (helado) c.vx *= Math.max(0, 1 - dt * 8);
      FA.pasoVehiculo(c, c.mem.puente > 0 || helado ? 0 : order.velocidad * speedUp, dt, ground, look.w);
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
      } else if (!isBoss(c.kind) && s.mapa !== 'oceano') {
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
      const life = c.hp / (isBoss(c.kind) ? s.bossMax : VEH[c.kind].hp);
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
      if (c.kind === 'portaaviones') carrierStep(c, dt);
      // Only fire when the player can see them: no shots from below the clouds.
      const onScreen = c.x > s.camX - 10 && c.x < s.camX + view.vw + 10 && c.y > s.camY - A.DIRT - 20;
      if (s.mode === 'play' && !s.dead && onScreen) {
        c.fireT -= dt;
        if (c.mem.hielo > 0 || c.mem.emp > 0) c.fireT = Math.max(c.fireT, 0.3);
        else if (salvo.has(c.id) || (order.disparar && c.fireT <= 0)) {
          carFires(c);
          c.fireT = Math.max(0.5, spec.cd * 0.8 * Math.max(0.45, 1 - (s.wave - 1) * 0.05)) * rand(0.7, 1.2) * (order.cadencia ?? 1) * (1 + 0.33 * s.ayuda);
        }
      }
      if (c.x <= META_X && c.hp > 0) {
        c.hp = 0;
        c.x = -999;
        // Margarita empties three crates at once.
        if (isBoss(c.kind)) talk(SAY.win, META_X, ground(META_X));
        s.meta -= isBoss(c.kind) ? 3 : 1;
        sfx.lose();
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
    // Back down from space: UFOs and a visiting mothership give up and fly off,
    // so nothing up there can hold a wave forever.
    s.lejosT = p.y < AE.ALTURA_OVNI - 300 && s.mode === 'play' ? s.lejosT + dt : 0;
    if (s.lejosT > 6) {
      s.lejosT = 0;
      const idos = s.aereos.filter((a) => a.tipo === 'ovni' && a.hp > 0);
      for (const a of idos) {
        a.hp = 0;
        puff(a.x, a.y, 3, false, 0.8);
      }
      if (idos.length) pop(p.x, p.y + 24, '🛸 Los ovnis se fueron', '#c9b4ff');
      if (s.jefe && s.jefeEspacio) {
        s.jefe = null;
        s.jefeEspacio = false;
        s.banner = '🛸 La nave nodriza se retiró';
        window.setTimeout(() => {
          if (s.banner.startsWith('🛸')) s.banner = '';
        }, 2200);
      }
    }
    s.spaceT = p.y > 2300 && s.mode === 'play' ? s.spaceT + dt : 0;
    if (s.spaceT > 12 && !s.jefe && !s.duelo && s.motherCd <= 0 && s.mode === 'play' && s.transT === 0 && s.phase === 'wave') {
      spawnBoss('nodriza');
      s.jefeEspacio = true;
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
    for (const a of s.aereos) {
      if (a.hp > 0) continue;
      s.airMax.delete(a.id);
      s.ufoMode.delete(a.id);
      s.airFlash.delete(a.id);
    }
    s.aereos = s.aereos.filter((a) => a.hp > 0);
    // Enemy fighters: fly, shoot, and crash if they hit the ground.
    const misJ = s.shots.filter((sh) => !sh.enemy && sh.m.t >= 0).map((sh) => sh.m);
    for (const f of s.fighters) {
      const r = CZ.paso(f, p, flyingNow(), dt, ground, CEIL, s.wave, s.fighters, misJ);
      for (const d of r.disparos) s.proy.push(AE.nuevoProyectil({ ...d, tipo: 'balin', trazador: true }));
      if (r.disparos.length) {
        if (!s.attract) AB.metrallaEnemiga(panOf(f.a.x), Math.hypot(f.a.x - p.x, f.a.y - p.y), r.disparos.length);
        L.luz(s.luces, f.a.x + Math.cos(f.a.rumbo) * 10, f.a.y + Math.sin(f.a.rumbo) * 10, 8, '#ff9ad0', 0.05);
      }
      if (!s.attract && flyingNow()) AB.pasadaCaza(f.a.x - p.x, f.a.y - p.y, Math.hypot(f.a.vx - p.vx, f.a.vy - p.vy), f.id);
      if (r.misil) {
        radio(`Ratón ${1 + (f.id % 4)}`, RADIO.fox);
        for (const mm of MS.lanzar('buscador', f.a.x, f.a.y, p, s.wave, Math.random)) s.shots.push({ m: mm, enemy: true, tgt: p, trail: 0 });
        fx('misil', sfx.enemyLaunch, { vol: 0.4, rate: 1.1 }, f.a.x);
      }
      f.a.x = clamp(f.a.x, 20, LEVEL - 20);
      if (f.a.y <= ground(f.a.x) + 3) hurtFighter(f, 99, false);
      if (f.hp > 0 && f.hp < f.hpMax * 0.5 && Math.random() < dt * 14) puff(f.a.x, f.a.y, rand(1, 2), true, 0.9);
    }
    s.fighters = s.fighters.filter((f) => f.hp > 0);
    // Enemy flyers defend themselves: a player missile closing in gets a burst of flares.
    for (const f of s.fighters) defensaBengalas(f.a, f.a, f.jefa ? 0.8 : 1.6, f.jefa ? 5 : 3);
    for (const a of s.aereos) if (a.tipo === 'helicoptero' && a.hp > 0) defensaBengalas(a, a, 2.4, 3);
    for (const b of s.bengalasR) {
      FV.pasoBengala(b, dt, wind);
      b.t += dt;
      L.luz(s.luces, b.x, b.y, 16, '#ffb070', 0.06);
      if (Math.random() < dt * 30) puff(b.x, b.y, rand(0.6, 1), false, 0.6, 0, 3);
    }
    s.bengalasR = s.bengalasR.filter((b) => b.t < 2.4 && b.y > ground(b.x));
    for (const [k, v] of s.bengalaCd) if (v - dt <= 0) s.bengalaCd.delete(k); else s.bengalaCd.set(k, v - dt);
    for (const q of s.proy) {
      const st = AE.pasoProyectil(q, dt, ground, wind);
      if (s.mode === 'play' && !s.dead && Math.hypot(q.x - p.x, q.y - p.y) < s.spec.hit + AE.RADIO_PROYECTIL[q.tipo]) {
        q.t = -1;
        if (q.tipo === 'balin') {
          s.lastHit = 'bala';
          // Small arms chip away: every third pellet tears off a part.
          s.chip++;
          s.hurtFlash = Math.max(s.hurtFlash, 0.12);
          if (s.chip >= 4) {
            s.chip = 0;
            hurtPlane(1, q.x, q.y);
          } else pop(q.x, q.y + 8, '¡Tic!', P.metal);
        }
        else blast(q.x, q.y, FA.ENERGIA.obus, 'raton', 1);
      } else if (st !== 'vuela') {
        if (q.tipo === 'mina') blast(q.x, q.y, FA.ENERGIA.obus, 'nadie', 0);
        else if (sobreMar(q.x) && q.y <= ground(q.x) + 3) chapoteo(q.x, q.tipo === 'balin' ? 0.3 : 0.8);
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
      if (m.combustible > 0) L.luz(s.luces, m.x - Math.cos(m.rumbo) * 6, m.y - Math.sin(m.rumbo) * 6, sh.enemy ? 7 : 9, sh.enemy ? MS.MISILES[sh.m.tipo].estela.brillo : '#ffb030', 0.05);
      E.empujarPunto(sh.estela, m.x, m.y, m.rumbo, m.combustible > 0, dt);
      E.actualizarEstela(sh.estela, dt, wind);
      if (sh.enemy && sh.cae) {
        // A spent enemy missile falling: ballistic, nose along its fall, explodes on whatever it meets.
        const em = sh.m;
        const F = MS.MISILES[em.tipo];
        FA.pasoBalistico(em, dt, FA.ARRASTRE_OBUS, wind);
        em.t += dt;
        em.rumbo = Math.atan2(em.vy, em.vx);
        const toca =
          em.y <= ground(em.x) ||
          s.cars.some((c) => Math.abs(em.x - c.x) < A.VEH_LOOK[c.kind].w / 2 + 2 && em.y > c.y - 2 && em.y < c.y + A.VEH_LOOK[c.kind].h) ||
          s.gigantes.some((u) => { if (!u.viva) return false; const b = G.caja(u); return em.x > b.x0 && em.x < b.x1 && em.y > b.y0 && em.y < b.y1; }) ||
          s.fighters.some((f) => CZ.tocado(f, em.x, em.y, 2)) ||
          s.aereos.some((a) => a.hp > 0 && Math.hypot(a.x - em.x, a.y - em.y) < AE.radio(a) + 2) ||
          (flying && Math.hypot(em.x - p.x, em.y - p.y) < s.spec.hit + 3);
        if (toca) {
          em.t = -1;
          s.caidaXY = [em.x, em.y];
          blast(em.x, Math.max(em.y, ground(em.x)), Math.max(3, F.energia), 'caida', Math.max(2, F.danio * 2));
        }
        continue;
      }
      if (sh.enemy) {
        const em = sh.m;
        const F = MS.MISILES[em.tipo];
        if (!sh.sigilo && sh.tgt === p) {
          sh.sigilo = true;
          if (em.guiado && s.spec.sigilo > 0 && Math.random() < s.spec.sigilo * 0.6) {
            sh.tgt = null;
            if (flying) pop(em.x, em.y + 10, '¡No te ve!', '#9ad8ff');
          }
        }
        const r = MS.paso(em, flying || sh.tgt !== p ? sh.tgt : null, dt, s.wave, ground);
        // Flares already in the air keep pulling the seekers that are still after the plane,
        // even ones launched after the flares went out.
        if (em.guiado && sh.tgt === p && s.flareBodies.length) {
          sh.mira = (sh.mira ?? 0) - dt;
          if (sh.mira <= 0) {
            sh.mira = 0.3;
            for (const fl of s.flareBodies) {
              if (fl.t > 2.2 || Math.hypot(fl.x - em.x, fl.y - em.y) > 260) continue;
              if (MS.engana(em, fl, p)) {
                sh.tgt = fl;
                pop(em.x, em.y + 10, '¡Misil engañado!', P.gold);
                break;
              }
            }
          }
        }
        // Friendly fire: a missile that brushes another mouse flyer goes off on it.
        if (em.t > 0.6 && r.estado === 'vuela') {
          const rc = MS.MISILES[em.tipo].radioChoque;
          const toca = s.fighters.some((f) => f.hp > 0 && CZ.tocado(f, em.x, em.y, rc)) || s.aereos.some((a) => a.hp > 0 && Math.hypot(a.x - em.x, a.y - em.y) < AE.radio(a) + rc);
          if (toca) {
            em.t = -1;
            blast(em.x, em.y, Math.max(3, F.energia), 'caida', Math.max(2, F.danio * 2));
            pop(em.x, em.y + 12, '¡Fuego amigo!', '#ffb070');
            continue;
          }
        }
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
          // A spent one coming down hurts the mice it lands on too.
          if (em.combustible <= 0) blast(em.x, Math.max(em.y, ground(em.x)), Math.max(3, F.energia), 'caida', Math.max(2, F.danio * 2));
          else blast(em.x, Math.max(em.y, ground(em.x)), F.energia, 'raton', F.danio);
          continue;
        }
        // Boomerang: a dodged one turns round (about a second), relights and chases again.
        // A flare only fools it for a while: once the flare burns out, it hunts again.
        if (sh.vueltas && sh.tgt !== p && flying && !s.flareBodies.some((f) => f === sh.tgt)) {
          sh.tgt = p;
          sh.pasada = true;
        }
        if (sh.vueltas && sh.tgt === p && flying) {
          const dd = Math.hypot(em.x - p.x, em.y - p.y);
          // Only a real miss counts: it went past and is now well away and leaving.
          const lejos = sh.pasada && dd > 120 && (em.vx * (p.x - em.x) + em.vy * (p.y - em.y)) < 0;
          if (!sh.girando && lejos) sh.girando = 1.5;
          if (sh.girando) {
            sh.girando -= dt;
            em.guiado = false;
            // A slow, wide loop the player can see coming.
            const sp = 140;
            const want = Math.atan2(p.y - em.y, p.x - em.x);
            const cur = Math.atan2(em.vy, em.vx);
            const turn = clamp(((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -3.2 * dt, 3.2 * dt);
            em.vx = Math.cos(cur + turn) * sp;
            em.vy = Math.sin(cur + turn) * sp;
            em.rumbo = cur + turn;
            em.combustible = Math.max(em.combustible, 1.5);
            em.t = Math.min(em.t, 2);
            if (sh.girando <= 0.4 && Math.abs(((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3) {
              sh.girando = 0;
              sh.vueltas--;
              sh.pasada = false;
              em.guiado = true;
              pop(em.x, em.y + 10, '¡Vuelve!', P.r3);
              if (!s.attract) AB.bumeranVuelve(panOf(em.x));
            }
          }
        }
        if (r.estado === 'agotado') {
          // Out of fuel and lost: it doesn't vanish, it drops like a stone and goes off where it lands.
          if (em.combustible <= 0 && em.y > ground(em.x) + 6) {
            sh.cae = true;
            sh.tgt = null;
            em.guiado = false;
            continue;
          }
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
        // A really close shave that didn't hit: a little reward for nerve.
        if (flying && dNow < s.spec.hit + 14) sh.cerca = true;
        if (sh.cerca && !sh.uf && dNow > 60) {
          sh.uf = true;
          s.score += 25;
          pop(p.x, p.y + 20, '¡Uf! +25', '#7ad8ff');
          if (!s.attract) AB.uf();
        }
      } else {
        // The player's rockets fly straight where the nose pointed.
        // A missile only homes on what the pilot locked: before launch, or over the
        // datalink if the lock comes while it's already flying. Unlocked, it flies straight.
        if (!(sh.lock && sh.lock.vivo())) {
          if (s.lockT >= LOCK_TIME && s.lockCand && s.lockCand.vivo()) {
            sh.lock = s.lockCand;
            if (!sh.enlace) pop(m.x, m.y + 10, '📡 ¡Enlace!', '#9ad8ff');
            sh.enlace = true;
          }
        }
        const lk = sh.lock && sh.lock.vivo() ? sh.lock.pos() : null;
        const kit = sh.k ?? s.spec.kit.misil;
        const res = FA.pasoMisil(m, lk, dt, kit.opts, ground, !lk);
        // Out of fuel it keeps flying ballistic and, nose down, dives until it hits something.
        if (res === 'suelo' || m.t > 30 || m.y > CEIL + 400) {
          m.t = -1;
          blast(m.x, Math.max(m.y, ground(m.x)), kit.energia, 'jugador', kit.dano);
          continue;
        }
        for (const c of s.cars) {
          const look = A.VEH_LOOK[c.kind];
          if (Math.abs(m.x - c.x) < look.w / 2 + 2 && m.y > c.y - 2 && m.y < c.y + look.h) {
            m.t = -1;
            blast(m.x, m.y, kit.energia, 'jugador', kit.dano);
            break;
          }
        }
        // …hit an enemy fighter…
        if (m.t >= 0) {
          for (const f of s.fighters) {
            if (CZ.tocado(f, m.x, m.y, 3)) {
              m.t = -1;
              blast(m.x, m.y, kit.energia, 'jugador', kit.dano);
              break;
            }
          }
        }
        // …hit the flying boss…
        if (m.t >= 0 && s.jefe && JF.tocado(s.jefe, m.x, m.y, 3)) {
          m.t = -1;
          blast(m.x, m.y, kit.energia, 'jugador', kit.dano);
        }
        // …hit mice of every size on the ground…
        if (m.t >= 0) {
          for (const u of s.gigantes) {
            if (!u.viva) continue;
            const b = G.caja(u);
            if (m.x > b.x0 && m.x < b.x1 && m.y > b.y0 && m.y < b.y1) {
              m.t = -1;
              giantHit(u, G.golpear(u, m.x, m.y, kit.dano));
              blast(m.x, m.y, kit.energia, 'jugador', kit.dano);
              break;
            }
          }
        }
        // …hit flying mice…
        if (m.t >= 0) {
          for (const a of s.aereos) {
            if (a.hp > 0 && Math.hypot(m.x - a.x, m.y - a.y) < AE.radio(a) + 3) {
              m.t = -1;
              blast(m.x, m.y, kit.energia, 'jugador', kit.dano);
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
              blast(m.x, m.y, kit.energia, 'jugador', kit.dano);
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
    const racimos: BombaJ[] = [];
    for (const b of s.bombs) {
      FA.pasoBomba(b, dt, wind);
      // A cluster canister opens over the target and sows its bomblets.
      if (b.tipo === 'racimo' && !b.sub && b.t > 0.3 && (b.y - ground(b.x) < 110 || b.t > 2.4)) {
        b.t = -1;
        for (let i = 0; i < 7; i++) {
          const k = (i - 3) / 3;
          racimos.push({ x: b.x, y: b.y, vx: b.vx * 0.8 + k * 70 + rand(-10, 10), vy: b.vy * 0.6 + rand(-15, 25), rumbo: b.rumbo, t: 0, tipo: 'racimo', sub: true });
        }
        puff(b.x, b.y, 2, false, 0.6);
        VFX.chispazo(s.fx, b.x, b.y, b.vx, b.vy, still || s.calma);
        if (!s.attract) AB.racimo(panOf(b.x), 7);
        continue;
      }
      // A laser-guided bomb nudges its fall towards the nearest ground target ahead.
      if (b.tipo === 'guiada') guiarBomba(b, dt);
      let hit = b.y <= ground(b.x);
      for (const c of s.cars) {
        const look = A.VEH_LOOK[c.kind];
        if (Math.abs(b.x - c.x) < look.w / 2 && b.y < c.y + look.h && b.y > c.y) hit = true;
      }
      // The bouncing bomb skips off the ground or the sea up to three times.
      if (b.tipo === 'rebote' && b.y <= ground(b.x) && (b.rebotes ?? 0) < 3 && !s.cars.some((c) => Math.abs(b.x - c.x) < A.VEH_LOOK[c.kind].w / 2)) {
        b.rebotes = (b.rebotes ?? 0) + 1;
        b.y = ground(b.x) + 1;
        b.vy = Math.abs(b.vy) * 0.55 + 25;
        b.vx *= 0.85;
        if (sobreMar(b.x)) chapoteo(b.x, 0.8);
        else puff(b.x, b.y, 2, false, 0.6);
        continue;
      }
      if (s.jefe && JF.tocado(s.jefe, b.x, b.y, 2)) hit = true;
      // Anything flying it runs into sets it off in mid-air.
      if (!hit && s.aereos.some((q) => q.hp > 0 && Math.hypot(q.x - b.x, q.y - b.y) < AE.radio(q) + 3)) hit = true;
      if (!hit && s.fighters.some((f) => f.hp > 0 && CZ.tocado(f, b.x, b.y, 3))) hit = true;
      // Bombs also catch enemy missiles on their way down.
      for (const o of s.shots) if (o.enemy && o.m.t >= 0 && Math.hypot(o.m.x - b.x, o.m.y - b.y) < 12 + MS.MISILES[o.m.tipo].radioChoque) hit = true;
      for (const u of s.gigantes) {
        if (!u.viva) continue;
        const bx = G.caja(u);
        if (b.x > bx.x0 && b.x < bx.x1 && b.y > bx.y0 && b.y < bx.y1) hit = true;
      }
      if (hit) {
        b.t = -1;
        impactoBomba(b);
      }
    }
    s.bombs.push(...racimos);
    s.bombs = s.bombs.filter((b) => b.t >= 0 && b.x > 0 && b.x < LEVEL);
    stepZonas(dt);
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

    // Bailed-out pilots under their parachutes; the radio line fading.
    if (s.radio) s.radio.t += dt;
    for (const e of s.eyectados) {
      if (e.t < 0.55 && e.t + dt >= 0.55 && !s.attract) AB.paracaidas(panOf(e.x));
      e.t += dt;
      if (e.t < 0.55) e.vy -= FA.GRAVEDAD * dt;
      else {
        // Canopy open: a slow swaying descent, drifting with the wind.
        e.vx += (wind * 0.5 - e.vx) * Math.min(1, dt * 1.2);
        e.vy += (-26 - e.vy) * Math.min(1, dt * 3);
      }
      e.x += (e.vx + Math.sin(e.t * 2.2) * 6) * dt;
      e.y += e.vy * dt;
    }
    s.eyectados = s.eyectados.filter((e) => {
      const llega = e.y <= ground(e.x) + 1;
      if (llega && sobreMar(e.x)) chapoteo(e.x, 0.6);
      return !llega && e.t < 16;
    });
    // Flares, smoke, shards, crates.
    stepSalva(dt);
    stepNuke(dt);
    for (const f of s.flareBodies) {
      FV.pasoBengala(f, dt, wind);
      f.t += dt;
      if (f.tipo === 'holograma') L.luz(s.luces, f.x, f.y, 14, '#7af0ff', 0.05);
      else if (f.tipo !== 'chaff') {
        L.luz(s.luces, f.x, f.y, f.tipo === 'trampa' ? 20 : 18, f.tipo === 'trampa' ? '#ffc070' : '#fff2c0', 0.07);
        // A thick white smoke trail: the arcs of the burst stay drawn in the sky for a moment.
        if (Math.random() < dt * 50) puff(f.x, f.y, rand(0.6, 1), false, 0.7, 0, 3);
      }
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
    const boss = s.cars.find((c) => isBoss(c.kind));
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
        const lista = boss?.kind === 'portaaviones' ? SAY.tauntsMar : SAY.taunts;
        let k = Math.floor(Math.random() * lista.length);
        if (k === s.lastTaunt) k = (k + 1) % lista.length;
        s.lastTaunt = k;
        talk(lista[k]);
        s.sayT = rand(3.8, 5.5);
      }
    }

    const iman = s.boost === 'iman' && s.mode === 'play' && !s.dead;
    for (const q of s.prizes) {
      q.t += dt;
      if (iman) atraer(q, dt);
      // Loose balloons never vanish: they rise (faster in thin air) until the cold
      // up high frosts them over, freezes them in place and they burst.
      const frio = q.y > FRIO_DESDE;
      if (frio) q.hielo = (q.hielo ?? 0) + dt;
      const sube = q.hielo ? 0 : 22 + Math.max(0, q.y) * 0.02;
      q.vy += (sube - q.vy) * Math.min(1, dt * 2);
      if (!q.hielo) q.x += (q.vx + wind * 0.4 + Math.sin(q.t * 2) * 6) * dt;
      q.y += q.vy * dt;
      if ((q.hielo ?? 0) > 1.5 && q.t < 99) {
        q.t = 99;
        for (let i = 0; i < 8; i++) s.shards.push({ x: q.x, y: q.y + 14, vx: rand(-60, 60), vy: rand(-20, 70), t: 0, c: i % 2 ? '#e6f6ff' : '#9ad8ff' });
        puff(q.x, q.y + 14, 2, false, 0.6);
        pop(q.x, q.y + 26, '❄️ ¡Pop!', '#bfe8ff');
        if (!s.attract) sfx.pop();
      }
      // Easy to catch: a wide grab radius and, close by, they drift toward the plane.
      const dq = Math.hypot(q.x - p.x, q.y + 12 - p.y);
      if (s.mode === 'play' && !s.dead && q.t < 99 && dq < 80) {
        const k = Math.min(1, dt * 3);
        q.x += (p.x - q.x) * k * 0.6;
        q.y += (p.y - 12 - q.y) * k * 0.6;
      }
      if (s.mode === 'play' && !s.dead && q.t < 99 && dq < s.spec.hit + 24) {
        q.t = 99;
        catchPrize(q.kind, q.x, q.y);
      }
    }
    s.prizes = s.prizes.filter((q) => q.t < 99);
    for (const c of s.crates) {
      c.t += dt;
      if (iman) atraer(c, dt);
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
    L.pasoLuces(s.luces, dt);
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
    s.cargaSuave += (s.plane.carga - s.cargaSuave) * Math.min(1, dt * 6);
    // The voyage up the coast: the shore drifts by; fighting the carrier brings Valparaíso near.
    if (s.mapa === 'oceano') {
      s.viaje += dt;
      const carrier = s.cars.find((c) => c.kind === 'portaaviones');
      const target = s.enValpo ? 1 : carrier ? 0.55 + 0.45 * (1 - clamp(carrier.hp / s.bossMax, 0, 1)) : clamp((s.wave - 2) * 0.22, 0, 0.5);
      s.costa += (target - s.costa) * Math.min(1, dt * 0.6);
    }
    for (const w of splashes) w.t += dt;
    s.relampago = Math.max(0, s.relampago - dt * 2.5);
    if (s.mapa === 'tormenta' && s.mode === 'play') {
      // Half the fighters down: the rain stops and the clouds part over a moonlit sea.
      const caidos = s.tormentaTot - s.fighterQueue - s.fighters.length;
      const quiere = s.tormentaTot > 0 && caidos >= s.tormentaTot / 2 ? 1 : 0;
      const antes = s.despeje;
      s.despeje = clamp(s.despeje + Math.sign(quiere - s.despeje) * dt / 6, 0, 1);
      if (antes === 0 && s.despeje > 0) {
        s.banner = '🌙 ¡Se despeja el cielo!';
        window.setTimeout(() => {
          if (s.banner.startsWith('🌙')) s.banner = '';
        }, 2400);
      }
      // No more lightning once it's clearing.
      if (s.despeje > 0.3) s.rayoT = Math.max(s.rayoT, 1);
      s.rayoT -= dt;
      const p = s.plane;
      if (!s.rayo && s.rayoT <= 0) {
        // A strike near the plane, with a glowing warning first; or a far flash.
        if (Math.random() < 0.6) {
          s.rayo = { x: p.x + rand(-140, 140), t: 0, tope: p.y + rand(120, 220) };
          if (!s.attract) AB.rayoAviso(panOf(s.rayo.x));
        }
        else {
          s.relampago = 0.35;
          const pan = rand(-1, 1);
          if (!s.attract) AB.trueno(rand(1100, 1800), pan);
        }
        s.rayoT = rand(3.5, 7);
      }
      if (s.rayo) {
        const r = s.rayo;
        const before = r.t;
        r.t += dt;
        if (before < 0.8 && r.t >= 0.8) {
          s.relampago = 0.9;
          if (!s.attract) AB.trueno(Math.abs(p.x - r.x), panOf(r.x));
          if (Math.abs(p.x - r.x) < 16 && p.y < r.tope && !s.dead) {
            s.lastHit = 'choque';
            hurtPlane(1, p.x, p.y);
            pop(p.x, p.y + 20, '⚡ ¡Rayo!', '#bfe8ff');
          }
          for (const f of s.fighters) if (Math.abs(f.a.x - r.x) < 16 && f.a.y < r.tope) hurtFighter(f, 99, false);
        }
        if (r.t > 1.05) s.rayo = null;
      }
    }
    for (let i = splashes.length - 1; i >= 0; i--) if (splashes[i].t > 0.9) splashes.splice(i, 1);
    s.flashMap = Math.max(0, s.flashMap - dt);
    s.revelar = Math.max(0, s.revelar - dt);
  }

  /* ── Drawing ── */

  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function draw() {
    const { vw, vh } = view;
    // At sea the carrier fight turns to sunset as Valparaíso comes into view.
    const carrierK = (() => {
      const c = s.cars.find((q) => q.kind === 'portaaviones');
      return c ? 1 - clamp(c.hp / s.bossMax, 0, 1) : 0;
    })();
    const atardecer = s.mapa === 'oceano' && (s.enValpo || carrierK > 0.35);
    const nocheTormenta = s.mapa === 'tormenta';
    const autoTheme: Theme = nocheTormenta ? 'noche'
      : s.mapa === 'oceano' ? (atardecer ? 'tarde' : 'dia')
      : s.mapa === 'valparaiso' && s.wave % 4 === 3 ? 'tarde'
      : THEMES[Math.max(0, s.wave - 1) % 3];
    const theme = s.themePick === 'auto' ? autoTheme : s.themePick;
    L.intensidadNoche(theme === 'noche' || s.plane.y > 2300 ? 1 : theme === 'tarde' ? 0.5 : 0);
    const shake = still || s.calma ? 0 : Math.min(9, s.shake);
    const shx = shake > 0.3 ? Math.round(rand(-shake, shake)) : 0;
    const shy = shake > 0.3 ? Math.round(rand(-shake, shake)) : 0;
    const cam = clamp(Math.round(s.camX) - shx, 0, LEVEL - vw);
    const sx = (x: number) => Math.round(x - cam);
    const sy = (y: number) => Math.round(toS(y) + shy);

    // The cozy backdrop: sky, clouds, mountains, the village and the woods.
    // The far layers move at half speed when the camera climbs.
    const horizon = Math.round(vh - A.DIRT - 18 + s.camY * 0.5 + shy);
    dibujarFondo(g, { vw, vh, camX: cam, camY: s.camY, horizonte: horizon, t: s.t, ambiente: theme, quieto: still, paisaje: s.mapa === 'tormenta' ? 'oceano' : s.mapa, costa: s.mapa === 'tormenta' ? 0.5 : s.costa, viaje: s.viaje, tormenta: s.mapa === 'tormenta', despeje: s.despeje });
    // Backdrop filter: a little less colour and a soft dusk veil, so planes,
    // missiles, enemies and effects stand out against any scenery.
    if (!s.sinFiltro) {
      g.globalCompositeOperation = 'saturation';
      g.globalAlpha = 0.45;
      g.fillStyle = '#808080';
      g.fillRect(0, 0, vw, vh);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = theme === 'noche' ? 0.1 : 0.18;
      g.fillStyle = '#2a2048';
      g.fillRect(0, 0, vw, vh);
      g.globalAlpha = 1;
    }

    // Ground strip (painted once for the whole level) and the pantry's flag.
    g.drawImage(strip.canvas, cam, 0, vw, strip.canvas.height, 0, sy(strip.top), vw, strip.canvas.height);
    // The ground takes the light of the hour too (night, dusk), and the busy
    // Valparaíso hillside is toned down so the mice on it stay readable.
    {
      const veil = theme === 'noche' ? 0.38 : theme === 'tarde' ? 0.14 : 0;
      const desat = s.mapa === 'valparaiso' && !s.sinFiltro ? 0.15 : 0;
      if (veil > 0 || desat > 0) {
        g.save();
        g.beginPath();
        g.moveTo(0, vh);
        for (let x = 0; x <= vw; x += 4) g.lineTo(x, sy(Math.max(ground(x + cam), s.mapa === 'oceano' || s.mapa === 'tormenta' ? OC.NIVEL_MAR : 0)) - 2);
        g.lineTo(vw, vh);
        g.closePath();
        g.clip();
        if (desat > 0) {
          g.globalCompositeOperation = 'saturation';
          g.globalAlpha = desat;
          g.fillStyle = '#808080';
          g.fillRect(0, 0, vw, vh);
          g.globalCompositeOperation = 'source-over';
        }
        if (veil > 0) {
          g.globalAlpha = veil;
          g.fillStyle = theme === 'noche' ? '#2a2048' : '#5a3048';
          g.fillRect(0, 0, vw, vh);
        }
        g.restore();
      }
    }
    if (s.mapa === 'valparaiso') VP.dibujarDetallesValpo(g, cam, (alt: number) => sy(alt), vw, s.t, still);
    // The storm: the sea is lost under a heaving floor of dark cloud.
    if (s.mapa === 'tormenta' && s.despeje < 1) {
      g.globalAlpha = 1 - s.despeje;
      for (let x = 0; x < vw; x += 2) {
        const wx = x + cam;
        const top = sy(250 + 14 * Math.sin(wx / 37 + s.t * 0.4) + 8 * Math.sin(wx / 13 - s.t * 0.7));
        if (top < vh) {
          A.R(g, x, top, 2, vh - top, '#2b2a48');
          A.R(g, x, top, 2, 2, '#4a4870');
        }
      }
    }
    g.globalAlpha = 1;
    const marTormenta = s.mapa === 'tormenta' && s.despeje > 0;
    if (s.mapa === 'oceano' || marTormenta) {
      OC.dibujarOlas(g, cam, sy(OC.NIVEL_MAR), vw, s.t, still, marTormenta ? 'noche' : theme);
      for (const w of splashes) OC.dibujarSalpicadura(g, sx(w.x), sy(OC.NIVEL_MAR), 1 - w.t / 0.9);
      // The cleared storm: bioluminescent sea and whales under the moon.
      if (marTormenta) {
        const agitados = splashes.map((w) => w.x);
        if (sobreMar(s.plane.x) && s.plane.y - OC.NIVEL_MAR < 40) agitados.push(s.plane.x);
        OC.dibujarMarMagico(g, cam, sy(OC.NIVEL_MAR), vw, vh, s.t, s.despeje, still, agitados);
      }
    }
    const below = sy(-A.DIRT);
    if (below < vh) A.R(g, 0, below, vw, vh - below, s.mapa === 'oceano' || s.mapa === 'tormenta' ? OC.COLOR_LECHO : P.e1);
    A.drawFlag(g, sx(PANTRY.x0 + 70), sy(ground(PANTRY.x0 + 70)), s.t);
    // The home runway: asphalt with a dashed centre line, at the start of San Antonio.
    if (s.mapa === 'valle') {
      for (let wx = PISTA0; wx < PISTA1; wx += 2) {
        const x = sx(wx);
        if (x < -2 || x > vw) continue;
        const y = sy(ground(wx));
        A.R(g, x, y - 1, 2, 3, '#5a5868');
        if (Math.floor(wx / 10) % 2 === 0) A.R(g, x, y, 2, 1, '#fff8e7');
      }
    }

    const p = s.plane;

    // Shadows on the ground or the sea under everything that flies.
    const sombraDe = (x: number, y: number, w: number) => {
      const gy = Math.max(ground(x), s.mapa === 'oceano' ? OC.NIVEL_MAR : -99);
      if (y - gy < 220) L.sombra(g, sx(x), sy(gy), w, y - gy);
    };
    if (s.mode !== 'demo' && !s.dead) sombraDe(p.x, p.y, 22);
    for (const f of s.fighters) sombraDe(f.a.x, f.a.y, 18);
    for (const a of s.aereos) sombraDe(a.x, a.y, 16);
    if (s.jefe) sombraDe(s.jefe.x, s.jefe.y, 70);
    for (const sh of s.shots) if (sh.m.t >= 0) sombraDe(sh.m.x, sh.m.y, 6);

    // Vehicles.
    for (const c of s.cars) {
      const x = sx(c.x);
      if (x < -40 || x > vw + 40) continue;
      A.drawVehicle(g, c.kind, x, sy(c.y + c.suspension), -c.angulo, c.wheel, c.aim, s.t, c.flash > 0);
      if (c.mem.hielo > 0) {
        // Iced over: a pale blue glaze and a few icicles.
        const lk = A.VEH_LOOK[c.kind];
        const top = sy(c.y + c.suspension + lk.h);
        g.globalAlpha = 0.45 * Math.min(1, c.mem.hielo);
        A.R(g, Math.round(x - lk.w / 2), top, lk.w, lk.h, '#bfe8ff');
        g.globalAlpha = 1;
        for (let i = -lk.w / 2 + 2; i < lk.w / 2; i += 5) A.R(g, Math.round(x + i), sy(c.y + c.suspension) - 1, 1, 2 + (Math.abs(i) % 2), '#e6f6ff');
      }
      const life = c.hp / (isBoss(c.kind) ? s.bossMax : VEH[c.kind].hp);
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
    for (const q of s.prizes) {
      A.drawPrize(g, sx(q.x), sy(q.y), q.kind, s.t, true);
      // Frost creeping over a balloon that reached the cold.
      if (q.hielo) {
        const k = Math.min(1, q.hielo / 1.5);
        const bx = sx(q.x), by = sy(q.y) - 21;
        g.globalAlpha = 0.35 + 0.45 * k;
        A.R(g, bx - 6, by - 6, 13, 12, '#bfe8ff');
        g.globalAlpha = 1;
        for (let i = 0; i < Math.round(10 * k); i++) A.R(g, bx - 6 + ((i * 7) % 13), by - 6 + ((i * 5) % 12), 1, 1, '#ffffff');
      }
    }
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
    for (const z of s.zonas) {
      const k = Math.min(1, z.t / 0.4) * Math.min(1, (z.vida - z.t) / 1.2);
      if (z.tipo === 'fuego') AD.drawFuego(g, sx(z.x), sy(z.y), z.r * 2, s.t, k);
      else if (z.tipo === 'gas') {
        // The cloud stays above the surface: clip it at the ground under its middle.
        g.save();
        g.beginPath();
        g.rect(0, 0, vw, sy(ground(z.x)) + 2);
        g.clip();
        AD.drawGas(g, sx(z.x), sy(z.y), z.r, s.t, k);
        g.restore();
      }
      else if (z.tipo === 'hielo') {
        // Frost spread on the ground: pale crystals glinting.
        g.globalAlpha = 0.85 * k;
        // A continuous white-blue mantle hugging the ground, then the crystals on it.
        for (let i = -z.r; i <= z.r; i++) {
          const gy = sy(ground(z.x + i));
          const edge = 1 - Math.abs(i) / z.r;
          A.R(g, sx(z.x + i), gy - 1 - Math.round(edge * 2), 1, 2 + Math.round(edge * 2), i % 3 ? '#e6f6ff' : '#bfe8ff');
        }
        for (let i = -z.r; i <= z.r; i += 3) {
          const hgt = 1 + ((i * 7 + 13) & 3);
          A.R(g, sx(z.x + i), sy(ground(z.x + i)) - hgt, 2, hgt, i % 2 ? '#bfe8ff' : '#e6f6ff');
          if (((i * 13) & 7) === 0 && Math.floor(s.t * 4 + i) % 3 === 0) A.R(g, sx(z.x + i), sy(ground(z.x + i)) - hgt - 2, 1, 1, P.white);
        }
        g.globalAlpha = 1;
      } else {
        // The EMP: a cyan ring racing out, crackling.
        const k = Math.min(1, z.t / z.vida);
        g.globalAlpha = 0.9 * (1 - k);
        for (const [rr, c] of [[z.r * Math.sqrt(k), '#7af0ff'], [z.r * k * 0.7, '#e6fbff']] as const) {
          const n = Math.max(40, Math.round(rr * 0.9));
          for (let a = 0; a < n; a++) {
            const an = (a / n) * Math.PI * 2;
            const j = (a + Math.floor(s.t * 30)) % 3;
            A.R(g, Math.round(sx(z.x) + Math.cos(an) * rr), Math.round(sy(z.y) + Math.sin(an) * rr * 0.9) + j - 1, 2, 2, j ? c : P.white);
          }
        }
        g.globalAlpha = 1;
      }
    }
    for (const f of s.flareBodies) AD.drawBengalaTipo(g, f.tipo, sx(f.x), sy(f.y), s.t + f.t);
    for (const b of s.bengalasR) AD.drawBengalaTipo(g, 'trampa', sx(b.x), sy(b.y), s.t + b.t);
    if (s.nuke) dibujarNuke(sx(s.nuke.x), sy(s.nuke.y), s.nuke.t);
    for (const b of s.bombs) {
      if (b.sub) AD.drawSubmunicion(g, sx(b.x), sy(b.y), -b.rumbo, s.t);
      else AD.drawBombaTipo(g, b.tipo, sx(b.x), sy(b.y), -b.rumbo);
    }
    // Machine-gun tracers: a glowing white-hot head and a long gold-to-red tail,
    // easy to see on any sky.
    for (const b of s.bullets) {
      if (b.c === 'laser') {
        AD.drawLaser(g, sx(b.x), sy(b.y), b.vx, -b.vy, s.t);
        continue;
      }
      const v = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / v, uy = -b.vy / v;
      const hx = sx(b.x), hy = sy(b.y);
      const blanco = b.c === 'blanco';
      g.globalAlpha = 0.45;
      A.R(g, hx - 2, hy - 2, 5, 5, '#ffe48a');
      g.globalAlpha = 1;
      for (let i = 1; i <= 7; i++) {
        const c = blanco ? (i <= 3 ? P.white : i <= 5 ? '#d8e8ff' : '#9ab8e8') : i <= 2 ? P.gold1 : i <= 4 ? P.gold : i <= 6 ? '#ff9a3c' : '#ff4a3c';
        A.R(g, Math.round(hx - ux * i * 1.6), Math.round(hy - uy * i * 1.6), i <= 3 ? 2 : 1, i <= 3 ? 2 : 1, c);
      }
      A.R(g, hx - 1, hy - 1, 3, 3, '#3a2a6a');
      A.R(g, hx, hy, 2, 2, P.white);
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
      } else {
        const look = (sh.k ?? s.spec.kit.misil).look;
        if (look === 'orbe') AD.drawOrbe(g, sx(sh.m.x), sy(sh.m.y), s.t);
        else A.drawMissile(g, sx(sh.m.x), sy(sh.m.y), -sh.m.rumbo, false, sh.m.combustible > 0, s.t, look);
      }
    }

    for (const j of s.junk) A.drawJunk(g, j.kind, sx(j.x), sy(j.y), j.spin);

    // Blasts and shards, then the plane over them so it never gets lost.
    for (const e of s.shards) A.R(g, sx(e.x), sy(e.y), 2, 2, e.c);
    VFX.dibujar(g, s.fx, (x, y) => [sx(x), sy(y)], s.t);
    L.dibujarLuces(g, s.luces, toScreen, s.t);
    const blink = s.inv > 0 && Math.floor(s.t * 14) % 2 === 0;
    // Boarding: the pilot walks out of the house to the plane and hops in.
    if (s.despegue === 'subiendo') {
      const k = Math.min(1, s.despT / 2);
      const x0 = PANTRY.x0 + 34, x1 = p.x - 4;
      const wx = x0 + (x1 - x0) * k;
      const hop = s.despT > 2 ? Math.sin(Math.min(1, (s.despT - 2) / 0.4) * Math.PI) * 12 : 0;
      if (s.despT < 2.35) {
        const gy = sy(ground(wx)) - Math.round(hop);
        const paso = Math.floor(s.t * 8) % 2;
        A.R(g, sx(wx) - 3, gy - 7, 6, 5, '#6b4f3a');
        A.R(g, sx(wx) - 2, gy - 2, 1, 2 + paso, '#3a2a3a');
        A.R(g, sx(wx) + 1, gy - 2, 1, 3 - paso, '#3a2a3a');
        const head = A.pilotPortrait(s.piloto);
        g.drawImage(head, sx(wx) - 8, gy - 22 + paso);
      }
    }
    // Banked and top-view frames as it rolls or pulls hard (g smoothed so they don't flicker).
    // During a barrel roll the drawn bank spins a full turn (the physics keep flying straight).
    const giroVisual = s.tonelT > 0 ? Math.cos(Math.PI * 2 * (1 - s.tonelT / 0.55)) * (p.alabeo >= 0 ? 1 : -1) : p.alabeo;
    if (!s.dead) drawPlaneGiro(g, s.mode === 'demo' ? 'avioneta' : s.spec.id, sx(p.x), sy(p.y), -p.rumbo, giroVisual, s.cargaSuave, s.t, p.gas, blink, s.mode === 'demo' ? [] : s.lost);
    else if (s.hundido) {
      // Sinking: under the surface, nose dropping, tinted by the water, trailing bubbles.
      const h = s.hundido;
      const k = Math.min(1, s.deadT / 2.4);
      const hx = sx(h.x + h.vx * Math.min(s.deadT, 1.5));
      const surf = sy(OC.NIVEL_MAR);
      const hy = surf + 4 + k * 26;
      const nose = h.ang + (Math.cos(h.ang) >= 0 ? -1 : 1) * k * 0.9;
      g.save();
      g.beginPath();
      g.rect(0, surf + 1, vw, vh - surf);
      g.clip();
      // Tint only the plane's own pixels: paint it on a scratch canvas, wash it blue, then lay it down.
      const tg = aguaTinte.getContext('2d')!;
      tg.globalCompositeOperation = 'source-over';
      tg.clearRect(0, 0, 80, 60);
      drawPlaneGiro(tg, s.spec.id, 40, 30, -nose, p.alabeo, 1, s.t, 0, false, s.lost);
      tg.globalCompositeOperation = 'source-atop';
      tg.globalAlpha = 0.35 + k * 0.45;
      tg.fillStyle = '#2a6a9a';
      tg.fillRect(0, 0, 80, 60);
      tg.globalAlpha = 1;
      g.globalAlpha = 1 - k * 0.55;
      g.drawImage(aguaTinte, Math.round(hx - 40), Math.round(hy - 30));
      g.restore();
      g.globalAlpha = 1;
      // Bubbles rising to the surface.
      for (let i = 0; i < 9; i++) {
        const ph = (s.deadT * 0.9 + i * 0.37) % 1;
        const by = hy - ph * (hy - surf);
        if (by <= surf + 1) continue;
        A.R(g, Math.round(hx + Math.sin(i * 2.3 + s.deadT * 3) * 6), Math.round(by), i % 3 ? 1 : 2, i % 3 ? 1 : 2, '#cfefff');
      }
    }
    // Bubble shield from the special upgrade: a shimmering ring around the plane.
    if (s.boost === 'escudo' && !s.dead) {
      const cx = sx(p.x), cy = sy(p.y);
      const r = s.spec.hit + 6;
      g.globalAlpha = s.boostT < 2 && Math.floor(s.t * 8) % 2 ? 0.25 : 0.6;
      for (let a = 0; a < 28; a++) {
        const t = (a / 28) * Math.PI * 2 + s.t * 2;
        A.R(g, cx + Math.round(Math.cos(t) * r), cy + Math.round(Math.sin(t) * r), 1, 1, a % 3 ? '#9ad8ff' : P.white);
      }
      g.globalAlpha = 1;
    }
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
    // Engine cooling: the jet shrinks and reddens, the nozzle glows and fades, heat shimmers behind.
    if (s.enfriaT > 0 && s.nitroT <= 0 && !s.dead) {
      const k = s.enfriaT / ENFRIA_T;
      const ux = Math.cos(p.rumbo), uy = -Math.sin(p.rumbo);
      const bx = sx(p.x) - ux * (s.spec.hit + 2), by = sy(p.y) - uy * (s.spec.hit + 2);
      const len = Math.round(9 * k * k) + (Math.random() < 0.5 ? 1 : 0);
      const cols = k > 0.6 ? ['#ffe48a', '#ff9a3c', '#e05a3a'] : k > 0.3 ? ['#ff9a3c', '#e05a3a', '#8a3a5a'] : ['#e05a3a', '#8a3a5a', '#4a3a5a'];
      for (let i = 0; i < len; i++) A.R(g, Math.round(bx - ux * i - 1), Math.round(by - uy * i - 1), i < 3 ? 2 : 1, i < 3 ? 2 : 1, cols[Math.min(2, Math.floor((i / Math.max(1, len)) * 3))]);
      // The nozzle ring, cherry red going dark, with a blue flicker of the last fuel.
      g.globalAlpha = 0.5 + 0.5 * k;
      A.R(g, Math.round(bx - 1), Math.round(by - 2), 3, 4, k > 0.4 ? '#ff5a3c' : '#a8304a');
      if (Math.random() < 0.3 * k) A.R(g, Math.round(bx), Math.round(by - 1), 1, 2, '#7ad8ff');
      // Heat shimmer: a few wavering pale pixels trailing behind.
      g.globalAlpha = 0.35 * k;
      for (let i = 0; i < 6; i++) {
        const d = 5 + i * 3;
        const w = Math.sin(s.t * 30 + i * 1.7) * 2;
        A.R(g, Math.round(bx - ux * d - uy * w), Math.round(by - uy * d + ux * w), 1, 1, '#fff2e0');
      }
      g.globalAlpha = 1;
    }
    for (const e of s.eyectados) dibujarEyectado(sx(e.x), sy(e.y), e.t, e.jefa);
    if (s.say) A.drawBubble(g, sx(s.say.x), sy(s.say.y + 60), s.say.text, vw);

    if (s.mapa === 'tormenta') dibujarTormenta(vw, vh, sx, sy);

    // Sense of speed with the nitro: a few soft air streaks at the edges of the frame, fading
    // out at the tail and kept clear of the plane so they never clutter the action.
    if (s.mode === 'play' && !s.dead && s.nitroT > 0 && !(still || s.calma)) {
      const v = Math.hypot(p.vx, p.vy);
      const ux = p.vx / (v || 1), uy = -p.vy / (v || 1);
      const px = sx(p.x), py = sy(p.y);
      const libre = Math.min(vw, vh) * 0.32;
      const fade = Math.min(1, s.nitroT / 0.4);
      for (let i = 0; i < 22; i++) {
        const seed = i * 97.31;
        const len = 18 + ((i * 37) % 26);
        const off = (s.t * 1100 + seed * 13) % (vw + vh);
        const cx = ((seed * 7.3) % vw) - ux * off * 0.6;
        const cy = ((seed * 3.1) % vh) - uy * off * 0.6;
        const x0 = ((cx % vw) + vw) % vw, y0 = ((cy % vh) + vh) % vh;
        if (Math.hypot(x0 - px, y0 - py) < libre) continue;
        // Head bright, tail dissolving in 2-px steps: reads as pixel art, not as a vector line.
        for (let j = 0; j < len; j += 2) {
          g.globalAlpha = fade * 0.35 * (1 - j / len);
          A.R(g, Math.round(x0 - ux * j), Math.round(y0 - uy * j), 1, 1, i % 3 ? '#ffffff' : '#cfeeff');
        }
      }
      // A warm edge glow, like the air burning at the frame.
      g.globalAlpha = 0.1 * fade;
      g.fillStyle = '#ffb347';
      g.fillRect(0, 0, vw, 3);
      g.fillRect(0, vh - 3, vw, 3);
      g.globalAlpha = 1;
    }

    // Enemy markers: a small red chevron over every enemy in view, so none blends into the scenery.
    if (s.mode === 'play' && !s.dead) {
      const marca = (x: number, y: number) => {
        const X = sx(x), Y = sy(y);
        if (X < -10 || X > vw + 10 || Y < -10 || Y > vh + 10) return;
        const b = Math.floor(s.t * 3) % 2;
        A.R(g, X - 3, Y - 1 + b, 7, 1, '#3a1a2a');
        A.R(g, X - 2, Y + b, 5, 1, '#ff4a5a');
        A.R(g, X - 1, Y + 1 + b, 3, 1, '#ff4a5a');
        A.R(g, X, Y + 2 + b, 1, 1, '#3a1a2a');
      };
      for (const c of s.cars) marca(c.mid.x, c.y + A.VEH_LOOK[c.kind].h + 7);
      for (const a of s.aereos) marca(a.x, a.y + 14);
      for (const f of s.fighters) marca(f.a.x, f.a.y + 14);
      for (const u of s.gigantes) if (u.viva) marca(u.x, u.y + 22);
    }

    // Frost creeping in from the edges as the ice grows; cracks when frozen.
    if (s.hielo > 0.05 && s.mode === 'play') dibujarEscarcha(vw, vh);

    // The jump between maps: a curtain in the destination's style sweeps in, hides
    // the swap, and clears off the new place (transiciones.ts).
    const fase = s.transT > 0 ? 1 - s.transT / TRANS_T : s.revelar > 0 ? 2 - s.revelar : 0;
    if (fase > 0) {
      const hacia = (s.transT > 0 ? s.toMapa || 'oceano' : s.mapa) as MapaId;
      dibujarTransicion(g, vw, vh, fase, s.mapa as MapaId, hacia, s.t, still || s.calma);
    }
    // A plain white flash (the nuke).
    const white = s.flashMap;
    if (white > 0) {
      g.globalAlpha = white;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, vw, vh);
      g.globalAlpha = 1;
    }
    // A red flash when the plane is hit.
    if (s.hurtFlash > 0) {
      g.globalAlpha = Math.round(s.hurtFlash * 4) / 4 * (still || s.calma ? 0.2 : 0.6);
      g.fillStyle = '#ff4a5a';
      g.fillRect(0, 0, vw, vh);
      g.globalAlpha = 1;
    }
    // White flash for big blasts.
    const flash = VFX.destello(s.fx);
    if (flash > 0) {
      g.globalAlpha = still || s.calma ? flash * 0.3 : flash;
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
      for (const z of [950, 1700, 2300]) A.R(g, ax - 2, altY(z), 6, 1, 'rgba(255,255,255,0.5)');
      for (const sh of s.shots) if (sh.enemy && sh.tgt === p) A.R(g, ax, altY(sh.m.y), 2, 1, P.red);
      for (const a of s.aereos) A.R(g, ax, altY(a.y), 2, 1, P.p0);
      A.R(g, ax - 2, altY(p.y) - 1, 6, 3, P.gold);
    }

    // Minimap along the bottom: the whole map side-on, with the terrain, the pantry,
    // every enemy at its height, missiles, the plane and the view. It keeps the same
    // size on screen at every zoom (u = virtual pixels per screen pixel step).
    {
      const u = clamp(Math.round(2 / view.s), 1, 3);
      const H = 17 * u;
      const rx = 8 * u;
      const rw = vw - 16 * u - 8;
      const top = vh - H - 3 * u;
      const at = (x: number) => rx + Math.round((x / LEVEL) * rw);
      // Height on a square-root scale: the low sky, where the fight is, gets more room.
      const ht = (alt: number) => top + H - 1 - Math.round(Math.sqrt(clamp(alt, 0, CEIL) / CEIL) * (H - 2));
      // A dot with a dark outline so it reads on any terrain.
      const punto = (x: number, y: number, w: number, h: number, c: string) => {
        A.R(g, x - u, y - u, w + 2 * u, h + 2 * u, '#1a1438');
        A.R(g, x, y, w, h, c);
      };
      g.globalAlpha = 0.85;
      A.R(g, rx - 2 * u, top - 2 * u, rw + 4 * u, H + 4 * u, '#3a2a6a');
      g.globalAlpha = 1;
      A.R(g, rx - u, top - u, rw + 2 * u, H + 2 * u, '#262048');
      for (const z of [950, 1700, 2300]) A.R(g, rx, ht(z), rw, 1, 'rgba(255,255,255,0.12)');
      // Terrain silhouette, painted once into a small canvas, redone only when the ground changes.
      const clave = `${mapaActual}|${rw}|${H}|${s.craters.length}|${s.bridges.length}|${s.gen}`;
      if (miniTerreno.clave !== clave) {
        miniTerreno.clave = clave;
        miniTerreno.cv.width = Math.max(1, rw);
        miniTerreno.cv.height = H;
        const mg = miniTerreno.cv.getContext('2d')!;
        mg.clearRect(0, 0, rw, H);
        const conMar = mapaActual === 'oceano' || mapaActual === 'tormenta';
        for (let c = 0; c < rw; c++) {
          const gx = ((c + 0.5) / rw) * LEVEL;
          const gy = ht(Math.max(0, ground(gx))) - top;
          const sea = conMar && gx > ISLA;
          const ciudad = mapaActual === 'valparaiso';
          A.R(mg, c, gy, 1, H - gy, sea ? '#3a6ab8' : ciudad ? '#8a6a9a' : '#4f8a5a');
          A.R(mg, c, gy, 1, u, sea ? '#9ad8ff' : ciudad ? '#f4a7b9' : '#8fd48a');
        }
      }
      g.drawImage(miniTerreno.cv, rx, top);
      // The view the camera shows.
      const v0 = at(s.camX);
      const vwid = Math.max(3 * u, Math.round((vw / LEVEL) * rw));
      const vt = ht(s.camY - A.DIRT + vh);
      const vb = ht(Math.max(0, s.camY - A.DIRT));
      g.globalAlpha = 0.16;
      A.R(g, v0, vt, vwid, Math.max(2, vb - vt + 1), '#ffffff');
      g.globalAlpha = 0.75;
      A.R(g, v0, vt, vwid, u, '#ffffff');
      A.R(g, v0, vb, vwid, u, '#ffffff');
      A.R(g, v0, vt, u, vb - vt + 1, '#ffffff');
      A.R(g, v0 + vwid - u, vt, u, vb - vt + 1, '#ffffff');
      g.globalAlpha = 1;
      // The pantry, with its fish left.
      const px0 = at(PANTRY.x0);
      const pyy = ht(ground(PANTRY.x0)) - 4 * u;
      punto(px0, pyy, 4 * u, 3 * u, P.b2);
      for (let i = 0; i < s.meta; i++) A.R(g, px0 + 5 * u + i * 2 * u, pyy + u, u, u, '#9ad8ff');
      // Enemies: ground ones lilac, flyers pink, fighters magenta, bosses big and blinking.
      const blink = Math.floor(s.t * 4) % 2 === 0;
      for (const c of s.cars) {
        const jefe = isBoss(c.kind);
        const w = (c.kind === 'portaaviones' ? 7 : jefe ? 4 : 2) * u;
        punto(at(c.x) - Math.floor(w / 2), ht(c.y) - 2 * u, w, (jefe ? 3 : 2) * u, jefe ? (blink ? P.red : P.r3) : '#c9b4ff');
      }
      for (const v of s.gigantes) if (v.viva) punto(at(v.x) - u, ht(v.y) - 2 * u, (v.tipo === 'tren' || v.tipo === 'ratonzilla' ? 4 : 2) * u, 2 * u, P.r2);
      for (const a of s.aereos) if (a.hp > 0) punto(at(a.x), ht(a.y), 2 * u, 2 * u, a.tipo === 'ovni' ? '#7af0ff' : P.p1);
      for (const f of s.fighters) punto(at(f.a.x) - u, ht(f.a.y) - u, 3 * u, 2 * u, f.jefa ? (blink ? P.red : '#ff6ad5') : '#ff6ad5');
      if (s.jefe) punto(at(s.jefe.x) - 3 * u, ht(s.jefe.y) - 2 * u, 6 * u, 4 * u, blink ? P.red : P.gold);
      for (const q of s.prizes) A.R(g, at(q.x), ht(q.y), u, u, P.gold1);
      // Missiles: the ones chasing the plane blink red.
      for (const sh of s.shots) {
        if (!sh.enemy || sh.m.t < 0) continue;
        if (sh.tgt === p && !blink) continue;
        A.R(g, at(sh.m.x), ht(sh.m.y), u + (sh.tgt === p ? u : 0), u + (sh.tgt === p ? u : 0), sh.tgt === p ? P.red : '#ff9a3c');
      }
      // The plane: a bright arrow pointing where it heads.
      const ppx = at(p.x);
      const ppy = ht(p.y);
      const dir = Math.cos(p.rumbo) >= 0 ? 1 : -1;
      punto(ppx - 2 * u, ppy - u, 4 * u, 3 * u, P.gold);
      A.R(g, ppx + dir * 2 * u - (dir < 0 ? u : 0), ppy, u, u, P.white);
    }
  }

  /** Rain, the lightning bolt (and its warning glow) and the sky flashing white. */
  function dibujarTormenta(vw: number, vh: number, sx: (x: number) => number, sy: (y: number) => number) {
    const calm = still || s.calma;
    const llueve = 1 - s.despeje;
    // A darker, wetter sky.
    g.globalAlpha = 0.3 * llueve;
    g.fillStyle = '#141226';
    g.fillRect(0, 0, vw, vh);
    // Rain: fine and faint, but it reacts — it falls with the wind, slides past with the
    // plane's speed (streaks lean along the relative wind), brightens in a lightning flash,
    // patters on the plane and pocks the sea.
    const p = s.plane;
    const viento = FV.viento(s.t, p.x, p.y);
    const rvx = viento * 0.6 - p.vx, rvy = -360 - p.vy;
    const rv = Math.hypot(rvx, rvy) || 1;
    const ux = rvx / rv, uy = -rvy / rv;
    const largo = clamp(rv / 90, 2, 7);
    g.globalAlpha = (0.16 + 0.35 * s.relampago) * llueve;
    const n = Math.round(((vw * vh) / 1500) * llueve);
    const W = vw + 40, H = vh + 40;
    for (let i = 0; i < n; i++) {
      // World-anchored drops: the camera's motion shows in them, not just the clock.
      const bx = i * 73.13 - s.camX + (calm ? 0 : s.t * viento * 0.6);
      const by = i * 151.7 + s.camY + (calm ? 0 : s.t * 360);
      const x = (((bx % W) + W) % W) - 20;
      const y = (((by % H) + H) % H) - 20;
      const L2 = largo * (0.7 + ((i * 7) % 5) * 0.12);
      for (let j = 0; j < L2; j += 1.5) A.R(g, Math.round(x - ux * j), Math.round(y - uy * j), 1, 1, i % 4 ? '#9ab4e0' : '#c8daf8');
    }
    // Drops bursting on the plane's nose and wings.
    if (!s.dead && !calm && llueve > 0.3) {
      g.globalAlpha = 0.5;
      const px = sx(p.x), py = sy(p.y);
      for (let i = 0; i < 4; i++) {
        const ph = (s.t * 9 + i * 0.27) % 1;
        A.R(g, Math.round(px + Math.cos(p.rumbo) * 6 - ux * ph * 6 + (i - 2) * 3), Math.round(py - Math.sin(p.rumbo) * 6 - uy * ph * 6 - 3), 1, 1, '#e6f0ff');
      }
    }
    // Rings on the sea surface.
    g.globalAlpha = 0.35 * llueve;
    const mar = sy(OC.NIVEL_MAR);
    if (mar < vh) for (let i = 0; i < 14; i++) {
      const ph = (s.t * 1.7 + i * 0.37) % 1;
      const x = ((((i * 97.3 - s.camX) % vw) + vw) % vw);
      A.R(g, Math.round(x - ph * 3), mar + 1, 1 + Math.round(ph * 6), 1, '#cfe3f0');
    }
    g.globalAlpha = 1;
    const r = s.rayo;
    if (r) {
      const x = sx(r.x);
      if (r.t < 0.8) {
        // Warning: the cloud above glows and a faint guide line shows where it will fall.
        g.globalAlpha = 0.25 + 0.25 * (Math.floor(s.t * 12) % 2);
        for (let y = 0; y < sy(r.tope); y += 4) A.R(g, x, y, 1, 2, '#bfe8ff');
        A.R(g, x - 10, 0, 21, 6, '#e6f6ff');
        g.globalAlpha = 1;
      } else {
        // The bolt: a jagged white line with a blue glow.
        let px = x, py = 0;
        const bottom = sy(r.tope);
        while (py < bottom) {
          const nx = px + Math.round(rand(-5, 5));
          const ny = Math.min(bottom, py + Math.round(rand(6, 12)));
          g.strokeStyle = '#9ad8ff';
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(nx, ny);
          g.stroke();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(nx, ny);
          g.stroke();
          px = nx;
          py = ny;
        }
      }
    }
    if (s.relampago > 0) {
      g.globalAlpha = (calm ? 0.25 : 0.7) * s.relampago;
      g.fillStyle = '#e6f0ff';
      g.fillRect(0, 0, vw, vh);
      g.globalAlpha = 1;
    }
  }

  /**
   * Frost on the screen: ice crystals from a fixed pattern, reaching further
   * in from each edge as the ice grows; frozen solid adds cracks and a blink.
   */
  const escarcha: [number, number, number][] = [];
  for (let i = 0; i < 900; i++) escarcha.push([Math.random(), Math.random(), Math.random()]);
  function dibujarEscarcha(vw: number, vh: number) {
    const k = s.hielo;
    const reach = 0.06 + k * 0.32;
    for (const [u, v, r] of escarcha) {
      const edge = Math.min(u, 1 - u, v, 1 - v);
      if (edge > reach * (0.55 + r * 0.45)) continue;
      const x = Math.round(u * vw), y = Math.round(v * vh);
      g.globalAlpha = clamp((reach - edge) / reach, 0, 1) * 0.85;
      A.R(g, x, y, r > 0.7 ? 2 : 1, 1, r > 0.5 ? '#ffffff' : '#bfe8ff');
      if (r > 0.85) {
        A.R(g, x - 1, y, 3, 1, '#e6f6ff');
        A.R(g, x, y - 1, 1, 3, '#e6f6ff');
      }
    }
    // A cold blue tint over everything.
    g.globalAlpha = k * 0.18;
    g.fillStyle = '#9ad8ff';
    g.fillRect(0, 0, vw, vh);
    if (s.congelado) {
      // Cracks across the glass and a slow pulse.
      g.globalAlpha = 0.55 + 0.25 * Math.sin(s.t * 6);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.beginPath();
      const cx = vw * 0.5, cy = vh * 0.45;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        let x = cx, y = cy;
        g.moveTo(Math.round(x), Math.round(y));
        for (let j = 0; j < 5; j++) {
          x += Math.cos(a + (j % 2 ? 0.35 : -0.25)) * vw * 0.07;
          y += Math.sin(a + (j % 2 ? 0.35 : -0.25)) * vh * 0.09;
          g.lineTo(Math.round(x), Math.round(y));
        }
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /* ── HUD ── */

  function hud() {
    const h: Hud = {
      hangar: hangarInfo(),
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
      boost: s.boost ? MEJORA[s.boost].nombre : '',
      boostT: Math.ceil(s.boostT),
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
      zone: s.mapa === 'tormenta' ? 'Tormenta' : nombreZona(zonaAltitud(s.plane.y), s.mapa),
      warn: s.warn,
      stall: s.mode === 'play' && !s.dead && s.stallT > 0 && s.inv <= 0 && !s.congelado,
      hielo: Math.round(s.hielo * 20) / 20,
      nukes: s.nukes,
      mejoras: { puntos: s.puntosMejora, niv: { ...s.niv }, tienda: s.tienda, coraza: s.coraza },
      enTierra: !!s.despegue,
      congelado: s.congelado,
      zoom: [view.levels.length, view.zi],
      throttle: Math.sign(input.gas),
      boss: (() => {
        const jefa = s.fighters.find((f) => f.jefa);
        if (jefa) return { name: 'Margarita en su caza', hp: clamp(Math.round((jefa.hp / jefa.hpMax) * 100) / 100, 0, 1) };
        const b = s.cars.find((c) => isBoss(c.kind));
        return b ? { name: b.kind === 'portaaviones' ? 'Portaaviones de Margarita' : 'Vecina Margarita', hp: clamp(Math.round((b.hp / s.bossMax) * 100) / 100, 0, 1) } : null;
      })(),
      banner: s.mode === 'play' ? s.banner : '',
      resumen: s.mode === 'play' && s.phase === 'break' && s.breakT > 1 ? s.resumen : null,
      viaje: s.transT > 0,
      pista: s.mode !== 'play' || s.dead ? '' : s.despegue === 'subiendo' ? `${s.spec.pilot} sube al avión…` : s.despegue === 'pista'
        ? (view.touch ? 'Mantén ⏩ Acelerar y, con velocidad, mantén la mitad izquierda para despegar' : 'Mantén E para acelerar y, con velocidad, ↑ para despegar')
        : s.pista ? textoPista(s.pista) : '',
      radio: s.mode === 'play' && s.radio && s.radio.t < 3.8 ? { quien: s.radio.quien, texto: s.radio.texto } : null,
      mision: s.mode === 'play' && s.mision ? { texto: s.mision.texto, prog: s.mision.prog, meta: s.mision.meta, hecha: s.mision.hecha, fallida: s.mision.fallida } : null,
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
    Space: 'fire', KeyJ: 'fire', KeyK: 'bomb', KeyL: 'flare', Enter: 'flare', NumpadEnter: 'flare', KeyH: 'gun', KeyF: 'gun', KeyN: 'nuke', KeyR: 'tonel',
    KeyE: 'acc', ShiftLeft: 'acc', ShiftRight: 'acc', KeyQ: 'brake', ControlLeft: 'brake', ControlRight: 'brake', KeyZ: 'zoom',
  };
  const touch = { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false, gun: false, nuke: false, tonel: false };
  /** Touch turning: +1 counterclockwise (left half held), -1 clockwise (right half), 0 none; and how far into the hold (0…1). */
  let turn = 0;
  let turnK = 0;
  /** True if an enemy is right in front of the nose, within gun range (the auto gun on phones). */
  function enemigoEnMira(p: Avion) {
    const cx = Math.cos(p.rumbo), cy = Math.sin(p.rumbo);
    const ok = (x: number, y: number, r: number) => {
      const dx = x - p.x, dy = y - p.y;
      const along = dx * cx + dy * cy;
      if (along < 20 || along > 520) return false;
      // Within the target's size (plus a little) of the line of fire.
      return Math.abs(dx * cy - dy * cx) < r + 6 + along * 0.03;
    };
    for (const c of s.cars) if (c.hp > 0 && ok(c.mid.x, c.mid.y, 10)) return true;
    for (const a of s.aereos) if (a.hp > 0 && ok(a.x, a.y, AE.radio(a))) return true;
    for (const f of s.fighters) if (f.hp > 0 && ok(f.a.x, f.a.y, CZ.RADIO)) return true;
    for (const u of s.gigantes) if (u.viva && ok(u.x, u.y + 8, 10)) return true;
    if (s.jefe && ok(s.jefe.x, s.jefe.y, 30)) return true;
    for (const sh of s.shots) if (sh.enemy && sh.m.t >= 0 && ok(sh.m.x, sh.m.y, 4)) return true;
    return false;
  }
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
    input.nuke = keys.has('nuke') || touch.nuke;
    input.tonel = keys.has('tonel') || touch.tonel;
  }
  const onKey = (e: KeyboardEvent) => {
    const k = CODES[e.code];
    // Menus (the title's self-playing game) and the pause keep their keys for the buttons.
    if (!k || s.mode !== 'play' || ((s.attract || s.paused) && e.type === 'keydown')) return;
    // With the wave card's shop (and its hangar) open, Enter presses the focused button.
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && s.tienda) return;
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
    if (now - lastAcc < 350 && s.nitroT > 0) {
      apagarNitro();
      lastAcc = -1e9;
      return;
    }
    if (now - lastAcc < 350 && startNitro()) {
      lastAcc = -1e9;
      return;
    }
    if (now - lastAcc < 350 && s.nitroCd > 0 && s.mode === 'play' && !s.attract) AB.nitroNoListo();
    lastAcc = now;
  }
  /** Cuts the super nitro short: the unused part comes back as charge. */
  function apagarNitro() {
    if (s.nitroT <= 0) return;
    const resto = s.nitroT / NITRO_T;
    s.nitroT = 0;
    s.nitroCd = NITRO_CD * Math.max(0.35, 1 - resto * 0.6);
    s.enfriaT = ENFRIA_T;
    pop(s.plane.x, s.plane.y + 18, 'Nitro apagado', '#9ad8ff');
    if (!s.attract) AB.nitroFin();
  }
  /** Fires the super nitro if it's charged; false if it isn't. */
  function startNitro() {
    if (s.nitroT > 0 || s.nitroCd > 0 || s.mode !== 'play' || s.dead) return false;
    s.nitroT = NITRO_T;
    s.nitroCd = NITRO_CD;
    usar('nitro');
    pop(s.plane.x, s.plane.y + 18, '¡SUPER NITRO!', '#7ad8ff');
    if (!s.attract) AB.nitro();
    // Ignition: a sonic ring and a flash behind the plane.
    VFX.explosion(s.fx, s.plane.x - Math.cos(s.plane.rumbo) * 14, s.plane.y - Math.sin(s.plane.rumbo) * 14, 1.2, { quieto: still || s.calma, color: 'humo' });
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
    view.want = view.levels[view.zi];
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
    } else if (s.slowT > 0) {
      // Slow motion when the plane is lost.
      s.slowT -= dt;
      dt *= 0.35;
    }
    const dtCuadro = dt;
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
    s.hudT -= dtCuadro;
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

  if (import.meta.env.DEV) (window as unknown as { __vuelo: unknown }).__vuelo = { s, input, view, JF, HG, cambiarMapa, prepararTormenta, cambiarAvion, impactoBomba, hurtFighter, MS };

  return {
    start,
    demo,
    attract,
    /** Touch controls write here; the keyboard is merged in. */
    /** The upgrade shop on the end-of-wave card. */
    mejorar(k: Mejorable) {
      const ok = mejorar(k);
      s.hudKey = '';
      return ok;
    },
    cerrarTienda() {
      s.tienda = false;
      s.hudKey = '';
    },
    /** The hangar on the end-of-wave card: another plane and/or bomb load. */
    elegirAvion(id: ModeloAvion, bomba?: BombaTipo) {
      return cambiarAvion(id, bomba);
    },
    /** Super nitro from a double tap on the sky (phones). */
    nitro() {
      return startNitro();
    },
    touch(t: Partial<typeof touch>) {
      if (t.gas === 1 && touch.gas !== 1) tapAccel();
      Object.assign(touch, t);
      syncInput();
    },
    /** «Menos movimiento»: no shake, no hit-stop or slow motion, softer flashes. */
    setCalma(on: boolean) {
      s.calma = on;
    },
    setPaused(p: boolean) {
      s.paused = p;
      if (p) AB.detener();
      if (p) S.callar();
      if (p) {
        // Nothing stays held across a pause: fingers lifted while paused never send their «up».
        Object.assign(touch, { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false, gun: false, nuke: false, tonel: false });
        turn = 0;
        onBlur();
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      s.gen++;
      save();
      S.pararMotores();
      AB.detener();
      callarJuegoSi(null);
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
      // On a phone the camera starts closer (×2), so the plane and the mice read well.
      if (t && !view.touch) {
        view.want = Math.max(view.want, 2);
        fit();
      }
      view.touch = t;
      s.autoGun = t;
    },
  };
}

export { A as dibujo };
