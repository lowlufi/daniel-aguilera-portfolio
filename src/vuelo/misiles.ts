/*
 * Catálogo de misiles enemigos (vista lateral). Unidades como `fisica-tipos.ts`:
 * px de juego, s, y = ALTITUD (crece hacia arriba), rad CCW.
 *
 * Cada tipo tiene UNA lectura clara y UNA respuesta del piloto. Todos son
 * claramente más rápidos que cualquier avión: volar recto = te dan (≥ 90 %).
 * Se esquivan con la maniobra correcta EN EL MOMENTO JUSTO (medido con
 * pilotos automáticos, ver el reporte de balance):
 *
 *  tipo           cómo vuela                                   cómo se esquiva
 *  -------------  -------------------------------------------  --------------------------------------
 *  buscador       navegación proporcional, planea guiado       de frente: bengalas a ~0,5 s; de cola:
 *                                                              tirón hacia arriba + bengalas a ~0,7 s
 *  dardo          rapidísimo, cono estrecho, gira mal          tirón brusco a ~0,6–1 s (antes no sirve)
 *  zigzag         serpentea, motor largo, llega alto           bengalas de frente; tirón+bengala de cola;
 *                                                              el caza puede subir/correr
 *  pesado         lento, 2 de vida, ignora bengalas, sin       tirón a ~0,6–0,8 s, o subir: se apaga y
 *                 planeo, espoleta grande                      se queda abajo (el bombardero: tirón temprano)
 *  racimo         sube y a ~110 px se abre en 3–5 perdigones   romper ANTES de que se abra (~2 s) o picar
 *  enjambre       salva de 3–5 cohetitos nerviosos, vida corta tirón a ~1 s / alejarse: se apagan antes
 *  estratosferico 2 etapas: quema, PLANEA (sin llama) y se     igual que el buscador; arriba gira peor:
 *                 reenciende; persigue hasta el techo          mejor esquivarlo alto y mientras planea
 *
 * Qué decide un esquive (además de la carga máxima de cada misil):
 *  - límite de seguimiento del buscador (`seguimiento`, rad/s de línea de
 *    mira): recto no se supera nunca; un tirón cerca sí ⇒ pierde el blanco.
 *    Demasiado pronto no basta y demasiado tarde la espoleta ya lo atrapa;
 *  - espoleta de proximidad (`radioImpacto`): un casi-roce también explota;
 *  - calidad de cada ejemplar (0,8–1,25): ningún esquive es seguro al 100 %;
 *  - bengalas: probabilidad por bengala según momento, aspecto y oleada.
 *
 * Fuegos artificiales (desde la oleada 2; cada uno se lee de lejos por su
 * forma y su estela, y tiene su respuesta):
 *
 *  tipo        ol. cómo vuela                                  cómo se esquiva
 *  ----------  --  -------------------------------------------  --------------------------------------
 *  cometa       2  rapidísimo y casi recto, cola de purpurina   cambiar de rumbo/altura ~1 s antes: no dobla
 *  candela      3  tubo que escupe bolas de colores con          las bolas van con adelanto: cambiar de rumbo
 *                  adelanto (la boca brilla del color que sale)  al ver el brillo; derribar el tubo
 *  serpiente    3  ondas anchas y lentas, estela arcoíris        bengalas (se las cree todas) o tirón
 *  palmera      4  sube por encima del avión y se abre en        no quedarse debajo: salir de lado; derribarla
 *                  frondas doradas que caen (no se engañan)      antes de que se abra
 *  mariposa     4  pareja que se cruza una y otra vez            bengalas (comparten el dado) o tirón
 *  girandola    5  rueda lenta que gira y lanza chispas          alejarse/correr (es lenta), 2 de vida
 *  petardo      5  al acercarse prende la mecha, frena y         al oír el chisporroteo, virar y alejarse:
 *                  revienta en un radio grande                   revienta ~0,5 s después donde esté
 *  crisantemo   6  a ~150 px estalla en una esfera de            romper antes; cruzar por un hueco; las
 *                  estrellas; 1–3 «corazones» buscan             estrellas guiadas caen con bengalas
 *  abeja        6  enjambre de 5–8 abejitas zumbonas, vida corta alejarse o tirón: se apagan solas
 *  fugaz        7  sube muy alto, destella y pica desde arriba   virar en horizontal al picar (a esa
 *                  con purpurina                                 velocidad gira mal), o bengalas
 *  enredadera   8  a ~190 px se abre en 3–4 zarcillos que se     bengalas (zarcillos muy engañables) o tirón
 *                  enroscan hacia el avión
 *  arcoiris     9  cambia de color: en cálidos (rojo, naranja,   soltar las bengalas cuando está cálido
 *                  amarillo) se cree las bengalas, en fríos no   (las que ya están en el aire también sirven)
 *
 * Tipos auxiliares (no los elige ningún vehículo por sí solos):
 *  perdigon   submisil del racimo.
 *  cohete     cohete sin guía del jeep.
 *  bola       bola de la candela romana.      fronda   brasa dorada de la palmera.
 *  estrella   estrella del crisantemo.        chispa   chispa de la girándola.
 *  zarcillo   brote guiado de la enredadera.
 * Los auxiliares chicos son «efímeros»: sin combustible se apagan en el aire
 * en vez de caer como piedra, y dibujan un rastro de partículas (fuegos.ts)
 * en lugar de una estela completa.
 *
 * La física base es `pasoMisil` (fisica-armas): empuje, arrastre cuadrático,
 * gravedad y navegación proporcional limitada en g. Aquí se elige la
 * configuración por tipo y se añade:
 *  - aire que se adelgaza (`densidad(y)`): arriba el misil corre más y gira
 *    peor (sustentación ∝ ρv²);
 *  - planeo guiado: tras apagarse el motor sigue guiando, perdiendo velocidad
 *    y agilidad, hasta que no le queda energía (`vMinGuia`) o se acaba la vida;
 *  - la 2.ª etapa del estratosférico;
 *  - el comportamiento propio (serpenteo, división, nerviosismo),
 * integrando en trozos de ≤ 1/120 s.
 */
import { GRAVEDAD, pasoMisil, probBengala, solucionTiro, type OpcionesMisil } from './fisica-armas';
import { densidad } from './fisica-vuelo';
import type { Misil, Movil, Suelo, Vec } from './fisica-tipos';

const G = GRAVEDAD;
const GRAD = Math.PI / 180;
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// tipos públicos
// ---------------------------------------------------------------------------

export type TipoMisil =
  | 'buscador' | 'dardo' | 'zigzag' | 'pesado' | 'racimo' | 'enjambre' | 'estratosferico' | 'perdigon' | 'cohete'
  | 'candela' | 'palmera' | 'crisantemo' | 'girandola' | 'cometa' | 'serpiente' | 'petardo' | 'fugaz'
  | 'mariposa' | 'abeja' | 'enredadera' | 'arcoiris'
  | 'bola' | 'fronda' | 'estrella' | 'chispa' | 'zarcillo';

/** Tipos que eligen los vehículos (los demás son auxiliares). */
export const TIPOS_PRINCIPALES: readonly TipoMisil[] = [
  'buscador', 'dardo', 'zigzag', 'pesado', 'racimo', 'enjambre', 'estratosferico',
  'candela', 'palmera', 'crisantemo', 'girandola', 'cometa', 'serpiente', 'petardo', 'fugaz', 'mariposa', 'abeja', 'enredadera', 'arcoiris',
];

/** Tipos que ya salen en salva desde un solo `lanzar` (el SAM no los dobla). */
export const SALVAS: ReadonlySet<TipoMisil> = new Set<TipoMisil>(['enjambre', 'abeja', 'mariposa']);

/**
 * Descripción de la estela para `estelas.ts`.
 *  nucleo: color del chorro caliente pegado a la tobera (casi blanco).
 *  brillo: halo de color del tipo (lo que hace reconocible al misil).
 *  humo:   humo claro que queda atrás y se disipa.
 *  ancho:  grosor del humo en px al nacer.  largo: nº de puntos de la estela.
 *  chispas: chispas por frame (0–3).  ondula: amplitud px del temblor del humo.
 */
export type EstiloEstela = {
  nucleo: string;
  brillo: string;
  humo: string;
  ancho: number;
  largo: number;
  chispas: number;
  ondula?: number;
  /** Largo de la cinta de fuego respecto del normal (1). */
  fuego?: number;
  /** Colores de las chispas (cada chispa toma uno): estelas de fuegos artificiales. */
  paleta?: string[];
  /** El humo va cambiando de color por la `paleta` (estela arcoíris). */
  arcoiris?: boolean;
  /** Chispas de purpurina: flotan, caen poco y titilan más rato. */
  brillos?: boolean;
};

/** Forma del estallido al morir (fuegos.ts). */
export type Estallido =
  | 'anillo' | 'doble' | 'peonia' | 'sauce' | 'crepitar' | 'palmera' | 'crisantemo' | 'mariposa' | 'trueno'
  | 'chispazo' | 'cometa' | 'arcoiris' | 'espiral';
/** Silueta del cuerpo (misiles-dibujo.ts). */
export type FormaMisil =
  | 'cohete' | 'tubo' | 'bulbo' | 'bola' | 'estrella' | 'rueda' | 'brasa' | 'chispa' | 'cabeza' | 'segmentos'
  | 'petardo' | 'astro' | 'mariposa' | 'abeja' | 'hoja' | 'brote';

/** Lo que lo hace un fuego artificial: colores, estallido, silueta. */
export type LookFuego = {
  /** Colores del tipo: chispas, estrellas del estallido, bolas, arcoíris. */
  paleta: string[];
  estallido: Estallido;
  forma: FormaMisil;
  /** Color de las bandas/franjas del cuerpo. */
  banda: string;
  /** Sin estela completa: deja un rastro de partículas (los chicos y numerosos). */
  rastro?: boolean;
  /** Sin combustible se apaga en el aire (no cae como piedra). */
  efimero?: boolean;
};

export type FichaMisil = {
  nombre: string;
  /** Opciones de `pasoMisil` en la oleada 1 (a nivel del mar; `quemado` = 1.ª etapa). */
  opciones: Required<OpcionesMisil>;
  /** Lo que ganan a la oleada 15 (curva de `progreso` desde la 1). */
  escala: { vMax: number; cargaMax: number; navegacion?: number; quemado?: number; vida?: number; seguimiento?: number };
  /** Vida máxima en la oleada 1, s (después `paso` devuelve 'agotado'). */
  vida: number;
  /** ¿Sigue guiando sin motor (planeo)? */
  planeo: boolean;
  /** En planeo pierde el guiado al bajar de esta fracción de su vMax local. */
  vMinGuia: number;
  /**
   * Velocidad máxima de seguimiento del buscador, rad/s de línea de mira (λ̇)
   * en la oleada 1 (×1,35 en la 15). Contra un avión que vuela recto la
   * navegación proporcional deja λ̇ ≈ 0; un giro cerrado cerca la dispara y el
   * buscador se suelta. Lejos el giro no basta (λ̇ = v⊥/r pequeña) y muy cerca
   * ya no da tiempo a desplazarse: el momento justo importa.
   */
  seguimiento: number;
  /** 2.ª etapa: s de planeo mínimo antes de reencender y s de quemado. */
  etapa2?: { espera: number; quemado: number };
  /** Impactos que aguanta (choque con otro misil, metralla, etc.). */
  hp: number;
  /** Espoleta de proximidad: px EXTRA sobre el radio de impacto del avión (`spec.hit`). */
  radioImpacto: number;
  /** Radio para chocar con otros misiles, px (se suman los dos). */
  radioChoque: number;
  /** Energía de su explosión (para `FA.explosion` / `blast`). */
  energia: number;
  /** Daño al avión, en puntos de vida. */
  danio: number;
  /** 0…1: multiplica la probabilidad de que una bengala lo engañe. */
  engañable: number;
  estela: EstiloEstela;
  color: { cuerpo: string; punta: string; aletas: string };
  /** Largo del dibujo, px. */
  largo: number;
  /** Oleada desde la que lo dispara algún vehículo (los auxiliares, la de su padre). */
  oleada: number;
  fuego: LookFuego;
};

export type MisilEnemigo = Misil & {
  tipo: TipoMisil;
  hp: number;
  /** Fase interna (serpenteo/nerviosismo), rad. */
  fase: number;
  id: number;
  /** Misiles de la misma salva/racimo comparten grupo y no chocan entre sí. */
  grupo: number;
  /** Posición al empezar el último `paso` (para choques barridos). */
  px: number;
  py: number;
  /** Racimo: 0…1 al acercarse a la división (para hacerlo parpadear). 0 en los demás. */
  aviso: number;
  /** Oleada con la que se lanzó (escalado). */
  nivel: number;
  /** s de quemado de la 2.ª etapa que quedan (0 si no tiene o ya la gastó). */
  etapa2: number;
  /** s desde que se apagó el motor (planeo). */
  apagado: number;
  /** s seguidos con la línea de mira girando más rápido que el buscador. */
  exceso: number;
  /**
   * Calidad de este ejemplar (0,8…1,25): multiplica el límite de seguimiento
   * del buscador y (en raíz) la carga máxima. Ningún misil es igual: el mismo
   * giro a veces basta y a veces no.
   */
  calidad: number;
  /** Color actual dentro de la `paleta` (bola, estrella, arcoíris, candela: la próxima bola). */
  tinte: number;
  /** Candela: bolas que quedan · girándola: chispas · fugaz: 0 sube, 1 pica · estrella: 1 = corazón guiado. */
  cuenta: number;
  /** Reloj propio (candela/girándola: s hasta el próximo tiro; fugaz: destello al picar). */
  reloj: number;
  /** Petardo: s con la mecha prendida (0 = apagada). */
  mecha: number;
};

/**
 * 'revienta': el petardo explotó por su mecha (daña en `RADIO_TRUENO`).
 * Con 'vuela' puede traer `hijos` (bolas de la candela, chispas de la
 * girándola) que se suman sin quitar al padre.
 */
export type EstadoMisil = 'vuela' | 'suelo' | 'agotado' | 'divide' | 'revienta';

/** Radio de daño del reventón del petardo, px (más el `hit` del avión). */
export const RADIO_TRUENO = 46;

// ---------------------------------------------------------------------------
// catálogo
// ---------------------------------------------------------------------------

function ops(o: {
  navegacion: number;
  cargaMax: number;
  empujeG: number;
  quemado: number;
  vMax: number;
  conoGrados: number;
  vida: number;
}): Required<OpcionesMisil> {
  const empuje = o.empujeG * G;
  return {
    navegacion: o.navegacion,
    cargaMax: o.cargaMax,
    empuje,
    quemado: o.quemado,
    vMax: o.vMax,
    arrastre: empuje / (o.vMax * o.vMax),
    cono: o.conoGrados * GRAD,
    caida: 0,
    vida: o.vida,
  };
}

// Paletas de los fuegos artificiales (chispas, estrellas, bolas y estallidos).
const P_CANDELA = ['#ff4f6d', '#ffd23f', '#3ee07a', '#3fb6ff', '#c66bff', '#ff8c2b'];
const P_ORO = ['#ffd36b', '#ffb02e', '#fff2b8', '#ff8a1f'];
const P_CRIS = ['#ff5ca8', '#5ce1ff', '#ffe95c', '#7dff8a', '#b78cff', '#ff9d4d'];
const P_GIR = ['#ff3d8b', '#ffe14d', '#4dffd2', '#ff8a3d', '#ffffff'];
const P_COMETA = ['#9ff3ff', '#ffffff', '#5ad0ff', '#d4fbff'];
const P_ARCO = ['#ff4d4d', '#ff9f2e', '#ffe44d', '#4dff7a', '#4dc3ff', '#b06bff'];
const P_PETARDO = ['#ff3b30', '#ffffff', '#ffd60a', '#ff9500'];
const P_FUGAZ = ['#fff7c2', '#ffffff', '#ffe066', '#c9d6ff'];
const P_MARIPOSA = ['#ff7ad9', '#5cf2e0', '#ffe0f7', '#b0fff6'];
const P_ABEJA = ['#ffd60a', '#fff3a0', '#ffb000', '#ffffff'];
const P_ENRED = ['#5ee06b', '#b8ff7a', '#ff8fc7', '#2fa84f'];

export const MISILES: Record<TipoMisil, FichaMisil> = {
  buscador: {
    nombre: 'Buscador',
    // Long-range: a sustainer motor keeps it chasing for a long, long time (outrun it or flare it).
    opciones: ops({ navegacion: 3.5, cargaMax: 10, empujeG: 4, quemado: 25, vMax: 380, conoGrados: 45, vida: 35 }),
    escala: { vMax: 20, cargaMax: 0.5, quemado: 0.3, vida: 2 },
    vida: 35,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 0.7,
    hp: 1,
    radioImpacto: 3,
    radioChoque: 9,
    energia: 2,
    danio: 1,
    engañable: 1,
    estela: { nucleo: '#fff6dc', brillo: '#ff8fab', humo: '#f6eef6', ancho: 3, largo: 26, chispas: 1, ondula: 1.2, paleta: ['#ff8fab', '#ffd1dc', '#ff5c8a'] },
    color: { cuerpo: '#f4f1ea', punta: '#ff6f91', aletas: '#c45b7a' },
    largo: 7,
    oleada: 1,
    fuego: { paleta: ['#ff8fab', '#ffd1dc', '#ff5c8a', '#fff0f5'], estallido: 'anillo', forma: 'cohete', banda: '#ff5c8a' },
  },
  dardo: {
    nombre: 'Dardo',
    opciones: ops({ navegacion: 3, cargaMax: 7, empujeG: 8, quemado: 10, vMax: 600, conoGrados: 22, vida: 20 }),
    escala: { vMax: 60, cargaMax: 1.5, quemado: 0.3, vida: 2 },
    vida: 20,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 0.5,
    hp: 1,
    radioImpacto: 1,
    radioChoque: 6,
    energia: 1.6,
    danio: 1,
    engañable: 0.7,
    estela: { nucleo: '#ffffff', brillo: '#6fd6ff', humo: '#eaf7ff', ancho: 2, largo: 34, chispas: 2, ondula: 0.8, paleta: ['#6fd6ff', '#ffffff', '#3fa9f5'] },
    color: { cuerpo: '#e9f4ff', punta: '#3fa9f5', aletas: '#2b6fb3' },
    largo: 9,
    oleada: 2,
    fuego: { paleta: ['#6fd6ff', '#bff0ff', '#3fa9f5', '#ffffff'], estallido: 'crepitar', forma: 'cohete', banda: '#3fa9f5' },
  },
  zigzag: {
    nombre: 'Zigzag',
    opciones: ops({ navegacion: 3.5, cargaMax: 9, empujeG: 3, quemado: 18, vMax: 330, conoGrados: 80, vida: 25 }),
    escala: { vMax: 30, cargaMax: 1.5, quemado: 1.5, vida: 2 },
    vida: 25,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 1.0,
    hp: 1,
    radioImpacto: 3,
    radioChoque: 8,
    energia: 2,
    danio: 1,
    engañable: 0.8,
    estela: { nucleo: '#fff8cc', brillo: '#b99bff', humo: '#f2edff', ancho: 3, largo: 30, chispas: 1, ondula: 2.4, paleta: ['#b99bff', '#ffb3f0', '#e3d6ff'] },
    color: { cuerpo: '#f3efff', punta: '#9b7bff', aletas: '#6b54c9' },
    largo: 7,
    oleada: 3,
    fuego: { paleta: ['#b99bff', '#e3d6ff', '#8a6bff', '#ffb3f0'], estallido: 'peonia', forma: 'cohete', banda: '#ffb3f0' },
  },
  pesado: {
    nombre: 'Pesado',
    opciones: ops({ navegacion: 3, cargaMax: 3.5, empujeG: 2.4, quemado: 20, vMax: 240, conoGrados: 85, vida: 30 }),
    escala: { vMax: 15, cargaMax: 0.5, quemado: 1.5 },
    vida: 30,
    planeo: false,
    vMinGuia: 1,
    seguimiento: 0.9,
    hp: 2,
    radioImpacto: 4,
    radioChoque: 11,
    energia: 6,
    danio: 2,
    engañable: 0.4,
    estela: { nucleo: '#fff1c4', brillo: '#ff9d5c', humo: '#ebe5ea', ancho: 5, largo: 38, chispas: 3, ondula: 1.2, paleta: ['#ff9d5c', '#ffd27a', '#ff6a2a'] },
    color: { cuerpo: '#d9d2c6', punta: '#ff7a3d', aletas: '#7d6b5a' },
    largo: 12,
    oleada: 5,
    fuego: { paleta: ['#ff9d5c', '#ffd27a', '#ff6a2a', '#fff1c4'], estallido: 'sauce', forma: 'cohete', banda: '#5a4636' },
  },
  racimo: {
    nombre: 'Racimo',
    opciones: ops({ navegacion: 3.5, cargaMax: 9, empujeG: 3.5, quemado: 12, vMax: 360, conoGrados: 70, vida: 20 }),
    escala: { vMax: 30, cargaMax: 1, quemado: 0.5 },
    vida: 20,
    planeo: true,
    vMinGuia: 0.25,
    seguimiento: 0.8,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 8,
    energia: 2.5,
    danio: 1,
    engañable: 0.7,
    estela: { nucleo: '#ffffff', brillo: '#7ee8b5', humo: '#edfaf3', ancho: 3, largo: 24, chispas: 2, ondula: 1.2, paleta: ['#7ee8b5', '#fff7a8', '#3ccf8e'] },
    color: { cuerpo: '#eefaf3', punta: '#3ccf8e', aletas: '#24936a' },
    largo: 9,
    oleada: 5,
    fuego: { paleta: ['#7ee8b5', '#c6ffe2', '#3ccf8e', '#fff7a8'], estallido: 'peonia', forma: 'cohete', banda: '#fff7a8' },
  },
  enjambre: {
    nombre: 'Enjambre',
    opciones: ops({ navegacion: 3, cargaMax: 5, empujeG: 6, quemado: 6, vMax: 400, conoGrados: 45, vida: 8 }),
    escala: { vMax: 20, cargaMax: 1, quemado: 0.1, vida: 0.4 },
    vida: 8,
    planeo: true,
    vMinGuia: 0.35,
    seguimiento: 0.7,
    hp: 1,
    radioImpacto: 0,
    radioChoque: 5,
    energia: 0.8,
    danio: 1,
    engañable: 1,
    estela: { nucleo: '#fffbe6', brillo: '#ffd166', humo: '#fbf6ea', ancho: 1.5, largo: 12, chispas: 1, ondula: 1.4, paleta: ['#ffd166', '#ff8c42'] },
    color: { cuerpo: '#fff4d1', punta: '#ffb703', aletas: '#d18a00' },
    largo: 4,
    oleada: 4,
    fuego: { paleta: ['#ffd166', '#fff0b3', '#ffb703', '#ff8c42'], estallido: 'crepitar', forma: 'cohete', banda: '#ff8c42' },
  },
  estratosferico: {
    nombre: 'Estratosférico',
    opciones: ops({ navegacion: 4, cargaMax: 7, empujeG: 5, quemado: 1.6, vMax: 600, conoGrados: 40, vida: 35 }),
    escala: { vMax: 40, cargaMax: 1 },
    vida: 35,
    planeo: true,
    vMinGuia: 0.15,
    seguimiento: 0.6,
    etapa2: { espera: 1.2, quemado: 22 },
    hp: 1,
    radioImpacto: 2,
    radioChoque: 10,
    energia: 3,
    danio: 2,
    engañable: 0.8,
    estela: { nucleo: '#ffffff', brillo: '#ff5d5d', humo: '#f3eef2', ancho: 3.5, largo: 44, chispas: 2, ondula: 1, paleta: ['#ff5d5d', '#ffffff', '#5d7bff'] },
    color: { cuerpo: '#f2f2f4', punta: '#e63946', aletas: '#3d405b' },
    largo: 13,
    oleada: 8,
    fuego: { paleta: ['#ff5d5d', '#ffffff', '#ffc2c2', '#5d7bff'], estallido: 'doble', forma: 'cohete', banda: '#3d405b' },
  },
  perdigon: {
    nombre: 'Perdigón',
    opciones: ops({ navegacion: 3, cargaMax: 7, empujeG: 6, quemado: 0.5, vMax: 450, conoGrados: 40, vida: 1.4 }),
    escala: { vMax: 40, cargaMax: 1 },
    vida: 1.4,
    planeo: true,
    vMinGuia: 0.35,
    seguimiento: 0.8,
    hp: 1,
    radioImpacto: 1,
    radioChoque: 5,
    energia: 0.8,
    danio: 1,
    engañable: 0.7,
    estela: { nucleo: '#ffffff', brillo: '#a8f0c8', humo: '#f0fbf5', ancho: 1.5, largo: 10, chispas: 1, ondula: 1, paleta: ['#a8f0c8', '#fff7a8'] },
    color: { cuerpo: '#eefaf3', punta: '#3ccf8e', aletas: '#24936a' },
    largo: 4,
    oleada: 5,
    fuego: { paleta: ['#a8f0c8', '#3ccf8e', '#ffffff'], estallido: 'chispazo', forma: 'cohete', banda: '#3ccf8e' },
  },
  cohete: {
    nombre: 'Cohete',
    opciones: ops({ navegacion: 2.5, cargaMax: 6, empujeG: 3.5, quemado: 8, vMax: 300, conoGrados: 60, vida: 15 }),
    escala: { vMax: 30, cargaMax: 0 },
    vida: 15,
    planeo: false,
    vMinGuia: 1,
    seguimiento: 0,
    hp: 1,
    radioImpacto: 0,
    radioChoque: 6,
    energia: 1.6,
    danio: 1,
    engañable: 0.9,
    estela: { nucleo: '#fff3e0', brillo: '#ffb38a', humo: '#f5efe9', ancho: 2, largo: 14, chispas: 1, ondula: 1, paleta: ['#ffb38a', '#ffe0c9'] },
    color: { cuerpo: '#efe6dc', punta: '#ff8a5b', aletas: '#9c6b4e' },
    largo: 6,
    oleada: 1,
    fuego: { paleta: ['#ffb38a', '#ffe0c9', '#ff8a5b'], estallido: 'peonia', forma: 'cohete', banda: '#9c6b4e' },
  },

  /* ── Fuegos artificiales ── */

  candela: {
    nombre: 'Candela romana',
    // Un tubo que persigue sin apuro y escupe bolas de colores con adelanto.
    opciones: ops({ navegacion: 3, cargaMax: 6, empujeG: 3, quemado: 10, vMax: 300, conoGrados: 75, vida: 16 }),
    escala: { vMax: 20, cargaMax: 1, quemado: 1 },
    vida: 16,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 0.8,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 8,
    energia: 2,
    danio: 1,
    engañable: 0.8,
    estela: { nucleo: '#fffbe0', brillo: '#ff4f6d', humo: '#fff0f3', ancho: 3, largo: 26, chispas: 2, ondula: 1.8, paleta: P_CANDELA },
    color: { cuerpo: '#ffe9d6', punta: '#ff4f6d', aletas: '#b8324c' },
    largo: 10,
    oleada: 3,
    fuego: { paleta: P_CANDELA, estallido: 'peonia', forma: 'tubo', banda: '#ff4f6d' },
  },
  bola: {
    nombre: 'Bola de candela',
    opciones: ops({ navegacion: 2.5, cargaMax: 4, empujeG: 2.5, quemado: 1.1, vMax: 320, conoGrados: 60, vida: 2.2 }),
    escala: { vMax: 20, cargaMax: 1 },
    vida: 2.2,
    planeo: false,
    vMinGuia: 1,
    seguimiento: 0.6,
    hp: 1,
    radioImpacto: 1,
    radioChoque: 4,
    energia: 0.6,
    danio: 1,
    engañable: 0.5,
    estela: { nucleo: '#ffffff', brillo: '#ff4f6d', humo: '#fff0f3', ancho: 1.5, largo: 8, chispas: 1 },
    color: { cuerpo: '#ffffff', punta: '#ff4f6d', aletas: '#b8324c' },
    largo: 4,
    oleada: 3,
    fuego: { paleta: P_CANDELA, estallido: 'chispazo', forma: 'bola', banda: '#ffffff', rastro: true, efimero: true },
  },
  palmera: {
    nombre: 'Palmera',
    // Sube por encima del avión y se abre: no busca chocar, busca llover.
    opciones: ops({ navegacion: 3, cargaMax: 7, empujeG: 4.5, quemado: 3.2, vMax: 380, conoGrados: 85, vida: 7 }),
    escala: { vMax: 20, cargaMax: 1, quemado: 0.4 },
    vida: 7,
    planeo: true,
    vMinGuia: 0.2,
    seguimiento: 1.6,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 9,
    energia: 2.4,
    danio: 1,
    engañable: 0.3,
    estela: { nucleo: '#fffbe0', brillo: '#ffb02e', humo: '#fff6dc', ancho: 3, largo: 26, chispas: 3, ondula: 2, paleta: P_ORO, brillos: true },
    color: { cuerpo: '#8a5a32', punta: '#ffd36b', aletas: '#c98a2e' },
    largo: 10,
    oleada: 4,
    fuego: { paleta: P_ORO, estallido: 'palmera', forma: 'tubo', banda: '#ffd36b' },
  },
  fronda: {
    nombre: 'Fronda',
    opciones: ops({ navegacion: 0, cargaMax: 0, empujeG: 0.6, quemado: 0, vMax: 120, conoGrados: 10, vida: 2.6 }),
    escala: { vMax: 0, cargaMax: 0, vida: 0.3 },
    vida: 2.6,
    planeo: false,
    vMinGuia: 1,
    seguimiento: 0,
    hp: 1,
    radioImpacto: 0,
    radioChoque: 3,
    energia: 0.35,
    danio: 1,
    engañable: 0,
    estela: { nucleo: '#ffffff', brillo: '#ffb02e', humo: '#fff6dc', ancho: 1, largo: 6, chispas: 1 },
    color: { cuerpo: '#ffd36b', punta: '#fff2b8', aletas: '#ff8a1f' },
    largo: 3,
    oleada: 4,
    fuego: { paleta: P_ORO, estallido: 'chispazo', forma: 'brasa', banda: '#ff8a1f', rastro: true, efimero: true },
  },
  crisantemo: {
    nombre: 'Crisantemo',
    // Estalla cerca en una esfera de estrellas; algunas («corazones») buscan.
    opciones: ops({ navegacion: 3.5, cargaMax: 9, empujeG: 4, quemado: 9, vMax: 360, conoGrados: 60, vida: 14 }),
    escala: { vMax: 30, cargaMax: 1, quemado: 0.5 },
    vida: 14,
    planeo: true,
    vMinGuia: 0.25,
    seguimiento: 0.8,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 9,
    energia: 2.4,
    danio: 1,
    engañable: 0.8,
    estela: { nucleo: '#ffffff', brillo: '#ff5ca8', humo: '#fff0f8', ancho: 3, largo: 28, chispas: 3, ondula: 2, paleta: P_CRIS },
    color: { cuerpo: '#fff4fb', punta: '#ff5ca8', aletas: '#7a3fd1' },
    largo: 10,
    oleada: 6,
    fuego: { paleta: P_CRIS, estallido: 'crisantemo', forma: 'bulbo', banda: '#5ce1ff' },
  },
  estrella: {
    nombre: 'Estrella',
    opciones: ops({ navegacion: 3, cargaMax: 7, empujeG: 3, quemado: 1, vMax: 280, conoGrados: 80, vida: 1.8 }),
    escala: { vMax: 20, cargaMax: 1 },
    vida: 1.8,
    planeo: false,
    vMinGuia: 1,
    seguimiento: 0.9,
    hp: 1,
    radioImpacto: 1,
    radioChoque: 4,
    energia: 0.5,
    danio: 1,
    engañable: 1,
    estela: { nucleo: '#ffffff', brillo: '#ff5ca8', humo: '#fff0f8', ancho: 1, largo: 6, chispas: 1 },
    color: { cuerpo: '#ffffff', punta: '#ff5ca8', aletas: '#7a3fd1' },
    largo: 4,
    oleada: 6,
    fuego: { paleta: P_CRIS, estallido: 'chispazo', forma: 'estrella', banda: '#ffffff', rastro: true, efimero: true },
  },
  girandola: {
    nombre: 'Girándola',
    // Rueda lenta y dura que gira lanzando chispas: se le escapa corriendo.
    opciones: ops({ navegacion: 3, cargaMax: 4, empujeG: 2, quemado: 13, vMax: 175, conoGrados: 120, vida: 14 }),
    escala: { vMax: 20, cargaMax: 0.5, quemado: 1 },
    vida: 14,
    planeo: false,
    vMinGuia: 1,
    seguimiento: 2.5,
    hp: 2,
    radioImpacto: 3,
    radioChoque: 10,
    energia: 2.5,
    danio: 1,
    engañable: 0.3,
    estela: { nucleo: '#ffffff', brillo: '#ff3d8b', humo: '#f6eefa', ancho: 3, largo: 22, chispas: 3, ondula: 3, paleta: P_GIR },
    color: { cuerpo: '#3a3060', punta: '#ff3d8b', aletas: '#ffe14d' },
    largo: 12,
    oleada: 5,
    fuego: { paleta: P_GIR, estallido: 'espiral', forma: 'rueda', banda: '#ffe14d' },
  },
  chispa: {
    nombre: 'Chispa',
    opciones: ops({ navegacion: 0, cargaMax: 0, empujeG: 0.5, quemado: 0, vMax: 220, conoGrados: 10, vida: 0.6 }),
    escala: { vMax: 0, cargaMax: 0 },
    vida: 0.6,
    planeo: false,
    vMinGuia: 1,
    seguimiento: 0,
    hp: 1,
    radioImpacto: 0,
    radioChoque: 3,
    energia: 0.3,
    danio: 1,
    engañable: 0,
    estela: { nucleo: '#ffffff', brillo: '#ffe14d', humo: '#fffbe8', ancho: 1, largo: 4, chispas: 0 },
    color: { cuerpo: '#ffffff', punta: '#ffe14d', aletas: '#ff3d8b' },
    largo: 2,
    oleada: 5,
    fuego: { paleta: P_GIR, estallido: 'chispazo', forma: 'chispa', banda: '#ffffff', rastro: true, efimero: true },
  },
  cometa: {
    nombre: 'Cometa',
    // Rapidísimo y casi recto, con una cola larga de purpurina.
    opciones: ops({ navegacion: 2, cargaMax: 3.5, empujeG: 10, quemado: 3, vMax: 720, conoGrados: 18, vida: 7 }),
    escala: { vMax: 50, cargaMax: 1, quemado: 0.3 },
    vida: 7,
    planeo: false,
    vMinGuia: 1,
    seguimiento: 0.35,
    hp: 1,
    radioImpacto: 1,
    radioChoque: 6,
    energia: 1.6,
    danio: 1,
    engañable: 0.5,
    estela: { nucleo: '#ffffff', brillo: '#7fe8ff', humo: '#e8fbff', ancho: 4, largo: 44, chispas: 3, ondula: 0.8, fuego: 1.8, paleta: P_COMETA, brillos: true },
    color: { cuerpo: '#ffffff', punta: '#9ff3ff', aletas: '#5ad0ff' },
    largo: 7,
    oleada: 2,
    fuego: { paleta: P_COMETA, estallido: 'cometa', forma: 'cabeza', banda: '#5ad0ff' },
  },
  serpiente: {
    nombre: 'Serpiente',
    // Ondas anchas y lentas con estela arcoíris; se cree cualquier bengala.
    opciones: ops({ navegacion: 3.5, cargaMax: 11, empujeG: 3, quemado: 16, vMax: 320, conoGrados: 85, vida: 22 }),
    escala: { vMax: 30, cargaMax: 1.5, quemado: 1.5, vida: 2 },
    vida: 22,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 1.1,
    hp: 1,
    radioImpacto: 3,
    radioChoque: 8,
    energia: 2,
    danio: 1,
    engañable: 1,
    estela: { nucleo: '#ffffff', brillo: '#ff9f2e', humo: '#fff6ea', ancho: 3, largo: 34, chispas: 2, ondula: 4, paleta: P_ARCO, arcoiris: true },
    color: { cuerpo: '#4dff7a', punta: '#ff4d4d', aletas: '#9b6bff' },
    largo: 12,
    oleada: 3,
    fuego: { paleta: P_ARCO, estallido: 'peonia', forma: 'segmentos', banda: '#ffe44d' },
  },
  petardo: {
    nombre: 'Petardo',
    // Cerca prende la mecha (chisporrotea y frena) y revienta en un radio grande.
    opciones: ops({ navegacion: 3.5, cargaMax: 8, empujeG: 4, quemado: 10, vMax: 340, conoGrados: 60, vida: 14 }),
    escala: { vMax: 30, cargaMax: 1, quemado: 1 },
    vida: 14,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 0.9,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 8,
    energia: 3,
    danio: 1,
    engañable: 0.7,
    estela: { nucleo: '#fffbe0', brillo: '#ff3b30', humo: '#f2ece8', ancho: 3, largo: 24, chispas: 3, ondula: 1.5, paleta: P_PETARDO },
    color: { cuerpo: '#e8322a', punta: '#fff4d6', aletas: '#8a1c16' },
    largo: 9,
    oleada: 5,
    fuego: { paleta: P_PETARDO, estallido: 'trueno', forma: 'petardo', banda: '#ffd60a' },
  },
  fugaz: {
    nombre: 'Estrella fugaz',
    // Sube muy por encima del avión, destella y pica desde arriba.
    opciones: ops({ navegacion: 4, cargaMax: 6, empujeG: 6, quemado: 2.4, vMax: 540, conoGrados: 90, vida: 16 }),
    escala: { vMax: 40, cargaMax: 1 },
    vida: 16,
    planeo: true,
    vMinGuia: 0.15,
    seguimiento: 0.7,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 8,
    energia: 2.4,
    danio: 1,
    engañable: 0.8,
    estela: { nucleo: '#ffffff', brillo: '#ffe066', humo: '#fffbe8', ancho: 2.5, largo: 40, chispas: 3, ondula: 1, fuego: 1.4, paleta: P_FUGAZ, brillos: true },
    color: { cuerpo: '#fff7c2', punta: '#ffffff', aletas: '#c9d6ff' },
    largo: 8,
    oleada: 7,
    fuego: { paleta: P_FUGAZ, estallido: 'sauce', forma: 'astro', banda: '#ffe066' },
  },
  mariposa: {
    nombre: 'Mariposa',
    // Siempre en pareja: se cruzan una y otra vez camino al avión.
    opciones: ops({ navegacion: 3.5, cargaMax: 9, empujeG: 3.5, quemado: 14, vMax: 340, conoGrados: 70, vida: 20 }),
    escala: { vMax: 25, cargaMax: 1, quemado: 1, vida: 2 },
    vida: 20,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 0.85,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 7,
    energia: 1.8,
    danio: 1,
    engañable: 0.9,
    estela: { nucleo: '#ffffff', brillo: '#ff7ad9', humo: '#fff0fb', ancho: 2.5, largo: 28, chispas: 2, ondula: 2.5, paleta: P_MARIPOSA },
    color: { cuerpo: '#fff0fb', punta: '#ff7ad9', aletas: '#5cf2e0' },
    largo: 7,
    oleada: 4,
    fuego: { paleta: P_MARIPOSA, estallido: 'mariposa', forma: 'mariposa', banda: '#5cf2e0' },
  },
  abeja: {
    nombre: 'Abeja',
    // Enjambre de abejitas zumbonas: muchas, chicas y de vida corta.
    opciones: ops({ navegacion: 3, cargaMax: 6, empujeG: 5, quemado: 4, vMax: 330, conoGrados: 60, vida: 5.5 }),
    escala: { vMax: 20, cargaMax: 1, quemado: 0.2, vida: 0.5 },
    vida: 5.5,
    planeo: true,
    vMinGuia: 0.35,
    seguimiento: 0.75,
    hp: 1,
    radioImpacto: 0,
    radioChoque: 4,
    energia: 0.6,
    danio: 1,
    engañable: 1,
    estela: { nucleo: '#ffffff', brillo: '#ffd60a', humo: '#fffbe0', ancho: 1, largo: 8, chispas: 1 },
    color: { cuerpo: '#ffd60a', punta: '#2b2118', aletas: '#ffffff' },
    largo: 4,
    oleada: 6,
    fuego: { paleta: P_ABEJA, estallido: 'chispazo', forma: 'abeja', banda: '#2b2118', rastro: true, efimero: true },
  },
  enredadera: {
    nombre: 'Enredadera',
    // A media distancia se abre en zarcillos que se enroscan hacia el avión.
    opciones: ops({ navegacion: 3.5, cargaMax: 8, empujeG: 3.5, quemado: 10, vMax: 330, conoGrados: 70, vida: 14 }),
    escala: { vMax: 30, cargaMax: 1, quemado: 0.5 },
    vida: 14,
    planeo: true,
    vMinGuia: 0.25,
    seguimiento: 0.8,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 8,
    energia: 2.2,
    danio: 1,
    engañable: 0.7,
    estela: { nucleo: '#f6ffe0', brillo: '#5ee06b', humo: '#eefbe6', ancho: 3, largo: 28, chispas: 2, ondula: 2.6, paleta: P_ENRED },
    color: { cuerpo: '#d8f7c9', punta: '#ff8fc7', aletas: '#2fa84f' },
    largo: 10,
    oleada: 8,
    fuego: { paleta: P_ENRED, estallido: 'sauce', forma: 'hoja', banda: '#2fa84f' },
  },
  zarcillo: {
    nombre: 'Zarcillo',
    opciones: ops({ navegacion: 3.5, cargaMax: 9, empujeG: 4, quemado: 2.4, vMax: 380, conoGrados: 70, vida: 3.4 }),
    escala: { vMax: 20, cargaMax: 1 },
    vida: 3.4,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 0.8,
    hp: 1,
    radioImpacto: 1,
    radioChoque: 4,
    energia: 0.7,
    danio: 1,
    engañable: 1,
    estela: { nucleo: '#ffffff', brillo: '#5ee06b', humo: '#effbe8', ancho: 1.5, largo: 16, chispas: 2, ondula: 3, paleta: P_ENRED },
    color: { cuerpo: '#b8ff7a', punta: '#ff8fc7', aletas: '#2fa84f' },
    largo: 5,
    oleada: 8,
    fuego: { paleta: P_ENRED, estallido: 'chispazo', forma: 'brote', banda: '#ff8fc7', efimero: true },
  },
  arcoiris: {
    nombre: 'Arcoíris',
    // Cambia de color: en cálidos se cree las bengalas, en fríos no.
    opciones: ops({ navegacion: 3.8, cargaMax: 10, empujeG: 4.5, quemado: 18, vMax: 400, conoGrados: 50, vida: 25 }),
    escala: { vMax: 30, cargaMax: 1, quemado: 1, vida: 2 },
    vida: 25,
    planeo: true,
    vMinGuia: 0.3,
    seguimiento: 0.75,
    hp: 1,
    radioImpacto: 2,
    radioChoque: 8,
    energia: 2.2,
    danio: 1,
    engañable: 1,
    estela: { nucleo: '#ffffff', brillo: '#ffe44d', humo: '#ffffff', ancho: 3, largo: 34, chispas: 3, ondula: 2.6, paleta: P_ARCO, arcoiris: true },
    color: { cuerpo: '#ffffff', punta: '#ff4d4d', aletas: '#4dc3ff' },
    largo: 9,
    oleada: 9,
    fuego: { paleta: P_ARCO, estallido: 'arcoiris', forma: 'cohete', banda: '#ffe44d' },
  },
};

/** Estelas por tinte (la mariposa turquesa lleva la suya); se arman una vez. */
const ESTELA_TINTE: Partial<Record<TipoMisil, EstiloEstela[]>> = {
  mariposa: [
    MISILES.mariposa.estela,
    { ...MISILES.mariposa.estela, brillo: '#5cf2e0', humo: '#effffd', paleta: ['#5cf2e0', '#b0fff6', '#ff7ad9'] },
  ],
};

/** Estilo de estela de este ejemplar (el mismo objeto siempre: sirve de clave de caché). */
export function estelaDe(m: MisilEnemigo): EstiloEstela {
  const v = ESTELA_TINTE[m.tipo];
  return v ? v[(m.tinte >>> 0) % v.length] : MISILES[m.tipo].estela;
}

/** Arcoíris: en los colores fríos (verde, azul, violeta) no se cree las bengalas. */
export const enFrio = (m: MisilEnemigo) => m.tipo === 'arcoiris' && m.tinte >= 3;

/**
 * 0 en la oleada 1 … 1 en la 15 (y se queda ahí). Curva cóncava: la 1 es de
 * práctica y desde la 3 ya se nota (3 ≈ 0,31 · 5 ≈ 0,44 · 10 ≈ 0,75).
 */
export const progreso = (nivel: number) => Math.pow(clamp((Math.floor(fin(nivel, 1)) - 1) / 14, 0, 1), 0.6);

/** Opciones de `pasoMisil` de un tipo en una oleada (a nivel del mar). */
export function opcionesMisil(tipo: TipoMisil, nivel: number): Required<OpcionesMisil> {
  const f = MISILES[tipo];
  const e = progreso(nivel);
  const o = f.opciones;
  const vMax = o.vMax + f.escala.vMax * e;
  return {
    ...o,
    vMax,
    cargaMax: o.cargaMax + f.escala.cargaMax * e,
    navegacion: o.navegacion + (f.escala.navegacion ?? 0) * e,
    quemado: o.quemado + (f.escala.quemado ?? 0) * e,
    vida: f.vida + (f.escala.vida ?? 0) * e,
    arrastre: o.empuje / (vMax * vMax),
  };
}

/**
 * Velocidad típica en vuelo, px/s: la que alcanza al acabar de quemar (el
 * `vMax` del catálogo es la terminal teórica, que casi nunca alcanza). Se usa
 * para apuntar con adelanto.
 */
export function vTipica(o: Required<OpcionesMisil>): number {
  return Math.max(60, Math.min(o.vMax * 0.85, 40 + o.empuje * o.quemado * 0.8));
}

// caché por (tipo, nivel) para no crear objetos (ni claves de texto) cada frame
const cacheOps: Partial<Record<TipoMisil, Required<OpcionesMisil>[]>> = {};
function opsDe(tipo: TipoMisil, nivel: number) {
  const n = clamp(Math.floor(fin(nivel, 1)), 1, 15);
  const fila = (cacheOps[tipo] ??= []);
  return (fila[n] ??= opcionesMisil(tipo, n));
}

// comportamiento propio
/** Zigzag: aceleración lateral de serpenteo, px/s², y su frecuencia, rad/s. */
const ZIG_A = 6 * G;
const ZIG_W = 2 * Math.PI * 0.95;
/** Racimo: distancia al blanco a la que se abre, px, y nº de perdigones. */
const RACIMO_D = 110;
/** Enjambre: nerviosismo lateral, px/s². */
const ENJ_A = 2.2 * G;
/** Serpiente: ondas más anchas y lentas que el zigzag. */
const SERP_A = 8 * G;
const SERP_W = 2 * Math.PI * 0.6;
/** Mariposa: aleteo lateral de la pareja (en contrafase: se cruzan). */
const MARI_A = 5 * G;
const MARI_W = 2 * Math.PI * 1.1;
/** Abeja: zumbido lateral, px/s². */
const ABEJA_A = 3.2 * G;
/** Zarcillo: enrosque lateral, px/s². */
const ZARC_A = 4.5 * G;
/** Crisantemo y enredadera: distancia a la que se abren, px. */
const CRIS_D = 150;
const ENRED_D = 190;
/** Petardo: distancia a la que prende la mecha y s hasta que revienta (oleada 1 → 15). */
const MECHA_D = 115;
const MECHA_T: [number, number] = [0.55, 0.42];
/** Fugaz: altura sobre el avión a la que apunta mientras sube, y desde la que pica. */
const FUGAZ_ALTO = 320;
const FUGAZ_PICA = 210;
/** Palmera: altura sobre el avión a la que apunta y a la que se abre. */
const PALMA_ALTO = 150;
const PALMA_ABRE = 80;
/** Arcoíris: s que dura cada color. */
const ARCO_T = 0.55;
/** Segundos tras el lanzamiento en que un misil todavía no puede chocar con otro. */
export const ARMADO_CHOQUE = 0.45;

// ---------------------------------------------------------------------------
// lanzamiento
// ---------------------------------------------------------------------------

let siguienteId = 1;
let siguienteGrupo = 1;
/** Dado del lanzamiento en curso (para la calidad de cada ejemplar). */
let dadoLanzar: () => number = Math.random;
const CALIDAD_MIN = 0.8;
const CALIDAD_MAX = 1.25;

function nuevo(tipo: TipoMisil, x: number, y: number, ang: number, v0: number, nivel: number, grupo: number, fase: number): MisilEnemigo {
  const o = opsDe(tipo, nivel);
  return {
    x: fin(x),
    y: fin(y),
    vx: Math.cos(ang) * v0,
    vy: Math.sin(ang) * v0,
    rumbo: ang,
    t: 0,
    combustible: o.quemado,
    guiado: true,
    tipo,
    hp: MISILES[tipo].hp,
    fase,
    id: siguienteId++,
    grupo,
    px: fin(x),
    py: fin(y),
    aviso: 0,
    nivel: clamp(Math.floor(fin(nivel, 1)), 1, 15),
    etapa2: MISILES[tipo].etapa2?.quemado ?? 0,
    apagado: 0,
    exceso: 0,
    calidad: lerp(CALIDAD_MIN, CALIDAD_MAX, clamp(fin(dadoLanzar(), 0.5), 0, 1)),
    tinte: 0,
    cuenta: 0,
    reloj: 0,
    mecha: 0,
  };
}

/** Hijo de un misil (bola, chispa, estrella…): misma salva, misma calidad, nace donde está el padre. */
function hijo(m: MisilEnemigo, tipo: TipoMisil, ang: number, v0: number, fase = 0): MisilEnemigo {
  const h = nuevo(tipo, m.x, m.y, ang, v0, m.nivel, m.grupo, fase);
  h.px = m.x;
  h.py = m.y;
  h.calidad = m.calidad;
  // los que no tienen motor salen sin buscador (balísticos)
  if (h.combustible <= 0) h.guiado = false;
  return h;
}

/** Ángulo de rampa hacia el punto de intercepción, con elevación mínima. */
function anguloRampa(x: number, y: number, objetivo: Movil, vel: number, minElev: number): number {
  const sol = solucionTiro({ x, y }, vel, objetivo, false);
  let ang = sol ? Math.atan2(sol.vy, sol.vx) : Math.atan2(fin(objetivo.y) - y, fin(objetivo.x) - x);
  ang = fin(ang, Math.PI / 2);
  if (Math.sin(ang) < Math.sin(minElev)) ang = Math.cos(ang) >= 0 ? minElev : Math.PI - minElev;
  return ang;
}

/**
 * Lanza un misil (o una salva) desde (x, y) contra `objetivo`. Devuelve un
 * array: `enjambre` devuelve 3–5 cohetitos, el resto uno. `desvio` gira la
 * rampa (rad), útil para la pareja de un SAM.
 */
export function lanzar(
  tipo: TipoMisil,
  x: number,
  y: number,
  objetivo: Movil,
  nivel: number,
  rnd: () => number = Math.random,
  desvio = 0,
): MisilEnemigo[] {
  const r = () => clamp(fin(rnd(), 0.5), 0, 1);
  dadoLanzar = r;
  const o = opsDe(tipo, nivel);
  const e = progreso(nivel);
  const grupo = siguienteGrupo++;
  const dv = fin(desvio);
  switch (tipo) {
    case 'dardo': {
      // Sale disparado con adelanto: ya va rápido, por eso apenas corrige.
      const ang = anguloRampa(x, y, objetivo, vTipica(o), 12 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 120, nivel, grupo, 0)];
    }
    case 'estratosferico': {
      // Sale casi vertical: lo primero es ganar altura, luego busca.
      const ang = anguloRampa(x, y, objetivo, vTipica(o), 55 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 50, nivel, grupo, 0)];
    }
    case 'pesado': {
      const ang = anguloRampa(x, y, objetivo, vTipica(o) * 0.9, 35 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 25, nivel, grupo, 0)];
    }
    case 'racimo': {
      // Sube empinado: el portador busca altura antes de abrirse.
      const haciaX = Math.sign(fin(objetivo.x) - x) || 1;
      const ang = (haciaX > 0 ? 70 * GRAD : Math.PI - 70 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 45, nivel, grupo, 0)];
    }
    case 'enjambre': {
      const n = 3 + (e >= 0.4 ? 1 : 0) + (e >= 0.75 ? 1 : 0);
      const base = anguloRampa(x, y, objetivo, vTipica(o) * 0.9, 20 * GRAD) + dv;
      const abanico = 0.55; // rad, total
      const out: MisilEnemigo[] = [];
      for (let i = 0; i < n; i++) {
        const a = base + (n > 1 ? (i / (n - 1) - 0.5) * abanico : 0) + (r() - 0.5) * 0.12;
        out.push(nuevo(tipo, x, y, a, lerp(55, 95, r()), nivel, grupo, r() * 2 * Math.PI));
      }
      return out;
    }
    case 'cohete': {
      // Sin guía: apunta con adelanto y ya.
      const sol = solucionTiro({ x, y }, vTipica(o), objetivo, false);
      const ang = (sol ? Math.atan2(sol.vy, sol.vx) : anguloRampa(x, y, objetivo, vTipica(o), 15 * GRAD)) + dv;
      return [nuevo(tipo, x, y, ang, 60, nivel, grupo, 0)];
    }
    case 'zigzag': {
      const ang = anguloRampa(x, y, objetivo, vTipica(o) * 0.85, 35 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 40, nivel, grupo, r() < 0.5 ? 0 : Math.PI)];
    }
    case 'cometa': {
      // Sale con adelanto y ya rápido, como el dardo: apenas corrige.
      const ang = anguloRampa(x, y, objetivo, vTipica(o), 10 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 160, nivel, grupo, 0)];
    }
    case 'palmera':
    case 'fugaz': {
      // Suben empinados: la palmera hasta encima del avión, la fugaz mucho más.
      const haciaX = Math.sign(fin(objetivo.x) - x) || 1;
      const el = (tipo === 'fugaz' ? 80 : 72) * GRAD;
      const ang = (haciaX > 0 ? el : Math.PI - el) + dv;
      return [nuevo(tipo, x, y, ang, 50, nivel, grupo, 0)];
    }
    case 'candela': {
      const ang = anguloRampa(x, y, objetivo, vTipica(o) * 0.9, 30 * GRAD) + dv;
      const m = nuevo(tipo, x, y, ang, 40, nivel, grupo, 0);
      m.cuenta = 4 + (e >= 0.45 ? 1 : 0) + (e >= 0.85 ? 1 : 0);
      m.reloj = 0.8;
      m.tinte = Math.floor(r() * MISILES.candela.fuego.paleta.length);
      return [m];
    }
    case 'girandola': {
      const ang = anguloRampa(x, y, objetivo, vTipica(o), 40 * GRAD) + dv;
      const m = nuevo(tipo, x, y, ang, 60, nivel, grupo, r() * 2 * Math.PI);
      m.cuenta = 36 + Math.round(16 * e);
      m.reloj = 0.6;
      return [m];
    }
    case 'mariposa': {
      // La pareja: alas en contrafase, rosada y turquesa.
      const base = anguloRampa(x, y, objetivo, vTipica(o) * 0.9, 25 * GRAD) + dv;
      const a = nuevo(tipo, x, y, base + 0.12, 45, nivel, grupo, 0);
      const b = nuevo(tipo, x, y, base - 0.12, 45, nivel, grupo, Math.PI);
      b.tinte = 1;
      return [a, b];
    }
    case 'abeja': {
      const n = 5 + (e >= 0.4 ? 1 : 0) + (e >= 0.75 ? 2 : 0);
      const base = anguloRampa(x, y, objetivo, vTipica(o) * 0.9, 25 * GRAD) + dv;
      const abanico = 0.9;
      const out: MisilEnemigo[] = [];
      for (let i = 0; i < n; i++) {
        const a = base + (i / (n - 1) - 0.5) * abanico + (r() - 0.5) * 0.2;
        out.push(nuevo(tipo, x, y, a, lerp(50, 100, r()), nivel, grupo, r() * 2 * Math.PI));
      }
      return out;
    }
    case 'arcoiris': {
      const ang = anguloRampa(x, y, objetivo, vTipica(o), 20 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 40, nivel, grupo, 0)];
    }
    case 'serpiente': {
      const ang = anguloRampa(x, y, objetivo, vTipica(o) * 0.85, 35 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 40, nivel, grupo, r() < 0.5 ? 0 : Math.PI)];
    }
    case 'perdigon':
    case 'buscador':
    default: {
      const ang = anguloRampa(x, y, objetivo, vTipica(o), 15 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 40, nivel, grupo, 0)];
    }
  }
}

/** Abre un racimo: 3–5 perdigones en abanico hacia el blanco (o hacia donde iba). */
function dividir(m: MisilEnemigo, objetivo: Movil | null): MisilEnemigo[] {
  const e = progreso(m.nivel);
  const n = 3 + (e >= 0.3 ? 1 : 0) + (e >= 0.75 ? 1 : 0);
  let base = Math.atan2(m.vy, m.vx);
  if (objetivo) {
    // apunta al punto de intercepción con la velocidad de los perdigones
    const sol = solucionTiro(m, vTipica(opsDe('perdigon', m.nivel)), objetivo, false);
    base = sol ? Math.atan2(sol.vy, sol.vx) : Math.atan2(fin(objetivo.y) - m.y, fin(objetivo.x) - m.x);
  }
  const sp = Math.hypot(m.vx, m.vy);
  const abanico = 70 * GRAD;
  const out: MisilEnemigo[] = [];
  for (let i = 0; i < n; i++) {
    const a = base + (i / (n - 1) - 0.5) * abanico;
    const h = nuevo('perdigon', m.x, m.y, a, Math.max(60, sp * 0.7) + 30, m.nivel, m.grupo, 0);
    h.px = m.x;
    h.py = m.y;
    h.calidad = m.calidad;
    out.push(h);
  }
  return out;
}

/** Palmera: frondas doradas hacia arriba y a los lados, que caen en arco (balísticas). */
function dividirPalmera(m: MisilEnemigo): MisilEnemigo[] {
  const e = progreso(m.nivel);
  const n = 7 + (e >= 0.4 ? 1 : 0) + (e >= 0.75 ? 2 : 0);
  const out: MisilEnemigo[] = [];
  for (let i = 0; i < n; i++) {
    // de -10° a 190°: un abanico que se abre arriba y cae por los lados
    const a = (-10 + (200 * i) / (n - 1)) * GRAD + (dadoLanzar() - 0.5) * 0.12;
    const v = 120 + 45 * dadoLanzar();
    const h = hijo(m, 'fronda', a, v, 0);
    h.vx += m.vx * 0.25;
    h.vy += m.vy * 0.25;
    h.tinte = i;
    out.push(h);
  }
  return out;
}

/**
 * Crisantemo: esfera de estrellas en todas direcciones. Las 1–3 que salen más
 * de frente al blanco son «corazones» guiados (titilan blancos); el resto son
 * balísticas y frenan como estrellas de verdad.
 */
function dividirCrisantemo(m: MisilEnemigo, objetivo: Movil | null): MisilEnemigo[] {
  const e = progreso(m.nivel);
  const n = 10 + (e >= 0.4 ? 2 : 0) + (e >= 0.8 ? 2 : 0);
  const guiadas = objetivo ? 1 + (e >= 0.3 ? 1 : 0) + (e >= 0.7 ? 1 : 0) : 0;
  const haciaBlanco = objetivo ? Math.atan2(fin(objetivo.y) - m.y, fin(objetivo.x) - m.x) : 0;
  const giro = dadoLanzar() * 2 * Math.PI;
  const out: MisilEnemigo[] = [];
  for (let i = 0; i < n; i++) {
    const a = giro + (2 * Math.PI * i) / n;
    const h = hijo(m, 'estrella', a, 150, 0);
    h.vx += m.vx * 0.4;
    h.vy += m.vy * 0.4;
    h.rumbo = Math.atan2(h.vy, h.vx);
    h.tinte = i % MISILES.estrella.fuego.paleta.length;
    h.combustible = 0;
    h.guiado = false;
    out.push(h);
  }
  // los corazones: los que salen más alineados con el blanco
  for (let k = 0; k < guiadas; k++) {
    let mejor: MisilEnemigo | null = null, mejorCos = -2;
    for (const h of out) {
      if (h.cuenta) continue;
      const c = Math.cos(Math.atan2(h.vy, h.vx) - haciaBlanco);
      if (c > mejorCos) {
        mejorCos = c;
        mejor = h;
      }
    }
    if (!mejor) break;
    mejor.cuenta = 1;
    mejor.guiado = true;
    mejor.combustible = opsDe('estrella', m.nivel).quemado;
  }
  return out;
}

/** Enredadera: 3–4 zarcillos guiados en abanico hacia el blanco, que se enroscan. */
function dividirEnredadera(m: MisilEnemigo, objetivo: Movil | null): MisilEnemigo[] {
  const e = progreso(m.nivel);
  const n = 3 + (e >= 0.6 ? 1 : 0);
  const base = objetivo ? Math.atan2(fin(objetivo.y) - m.y, fin(objetivo.x) - m.x) : Math.atan2(m.vy, m.vx);
  const sp = Math.hypot(m.vx, m.vy);
  const out: MisilEnemigo[] = [];
  for (let i = 0; i < n; i++) {
    const a = base + (i / (n - 1) - 0.5) * 75 * GRAD;
    const h = hijo(m, 'zarcillo', a, Math.max(90, sp * 0.6), i * 2.1);
    if (!objetivo) h.guiado = false;
    out.push(h);
  }
  return out;
}

/** Candela romana: una bola con adelanto hacia el blanco, del color que brillaba en la boca. */
function bolaDe(m: MisilEnemigo, ob: Movil): MisilEnemigo {
  const v0 = 230;
  const sol = solucionTiro(m, vTipica(opsDe('bola', m.nivel)), ob, false);
  const ang = sol ? Math.atan2(sol.vy, sol.vx) : Math.atan2(ob.y - m.y, ob.x - m.x);
  const h = hijo(m, 'bola', ang, v0, 0);
  h.tinte = m.tinte;
  return h;
}

// ---------------------------------------------------------------------------
// paso
// ---------------------------------------------------------------------------

/** Gira la velocidad por una aceleración lateral `a` (px/s²) durante h (conserva la rapidez). */
function empujeLateral(m: Misil, a: number, h: number) {
  const sp = Math.hypot(m.vx, m.vy);
  if (sp < 5) return;
  const d = (a / sp) * h;
  const c = Math.cos(d), s = Math.sin(d);
  const vx = m.vx * c - m.vy * s;
  m.vy = m.vx * s + m.vy * c;
  m.vx = vx;
}

/** Segundos de «rampa»: el lanzador guía el misil hacia el blanco mientras acelera. */
const RAMPA_T = 1.1;
/** Tipos con guiado de rampa (el dardo y el cohete salen ya apuntados). */
const RAMPA: Partial<Record<TipoMisil, number>> = {
  buscador: 2.2, zigzag: 2.2, pesado: 1.6, estratosferico: 1.8,
  candela: 2, palmera: 2.6, crisantemo: 2.2, girandola: 1.6, serpiente: 2.2, petardo: 2.2, fugaz: 2.6, mariposa: 2.2, enredadera: 2.2, arcoiris: 2.2,
};

/**
 * Guiado de rampa: mientras el misil es lento las aletas no muerden y el
 * buscador perdería el blanco al cruzar el avión por encima. El lanzador lo
 * apunta (giro limitado, rad/s) y mantiene el cono abierto.
 */
function rampa(m: MisilEnemigo, ob: Movil, o: Required<OpcionesMisil>, h: number) {
  const w = RAMPA[m.tipo] ?? 0;
  const rx = ob.x - m.x, ry = ob.y - m.y;
  const sp = Math.hypot(m.vx, m.vy);
  if (sp < 1 || rx * rx + ry * ry < 1) return;
  // a dónde apuntar: hacia el punto de intercepción aproximado, pero sin
  // alejarse más de medio cono de la línea de mira (al soltar la rampa el
  // buscador tiene que seguir viendo al avión)
  const tgo = Math.hypot(rx, ry) / Math.max(vTipica(o) * 0.9, 1);
  const ax = rx + ob.vx * tgo, ay = ry + ob.vy * tgo;
  const los = Math.atan2(ry, rx);
  let adelanto = Math.atan2(ay, ax) - los;
  adelanto = Math.atan2(Math.sin(adelanto), Math.cos(adelanto));
  const meta = los + clamp(adelanto, -0.5 * o.cono, 0.5 * o.cono);
  let err = meta - Math.atan2(m.vy, m.vx);
  err = Math.atan2(Math.sin(err), Math.cos(err));
  const giro = clamp(err, -w * h, w * h);
  const c = Math.cos(giro), s = Math.sin(giro);
  const vx = m.vx * c - m.vy * s;
  m.vy = m.vx * s + m.vy * c;
  m.vx = vx;
  m.rumbo += giro;
  m.guiado = true;
}

/**
 * Perillas globales del buscador (las usan las simulaciones de balance).
 *  excesoMax: s por encima del límite de seguimiento antes de soltarse.
 *  tComprometido: a menos de estos s del impacto el misil ya está
 *    comprometido (la espoleta decide): no se comprueba el seguimiento.
 *  brilloV / brilloExp: brillo IR del blanco según su velocidad (ver abajo).
 */
export const AJUSTE_BUSCADOR = { excesoMax: 0.05, tComprometido: 0.2, brilloV: 115, brilloExp: 1 };

/** Límite de seguimiento del buscador (rad/s) de este misil; en planeo un 20 % menos. */
function limiteSeguimiento(m: MisilEnemigo): number {
  const f = MISILES[m.tipo];
  const base = f.seguimiento * (1 + (f.escala.seguimiento ?? 0.3) * progreso(m.nivel)) * clamp(fin(m.calidad, 1), CALIDAD_MIN, CALIDAD_MAX);
  return m.combustible > 0 ? base : base * 0.8;
}

/**
 * Un blanco rápido brilla más en infrarrojo (motor a fondo, postcombustión,
 * piel caliente): el buscador lo sigue mejor. ×1 a 115 px/s, ×1,6 a 185.
 */
const brilloBlanco = (v: number) =>
  clamp(Math.pow(Math.max(0, fin(v)) / AJUSTE_BUSCADOR.brilloV, AJUSTE_BUSCADOR.brilloExp), 0.85, 2.6);

/** Comprueba si la línea de mira gira más rápido de lo que el buscador puede seguir. */
function seguir(m: MisilEnemigo, ob: Movil, h: number) {
  const lim = limiteSeguimiento(m) * brilloBlanco(Math.hypot(ob.vx, ob.vy));
  if (!(lim > 0)) return;
  const rx = ob.x - m.x, ry = ob.y - m.y;
  const r2 = rx * rx + ry * ry;
  const r = Math.sqrt(r2);
  const rvx = ob.vx - m.vx, rvy = ob.vy - m.vy;
  const vc = -(rx * rvx + ry * rvy) / Math.max(r, 1e-6);
  if (r < 6 || (vc > 0 && r < vc * AJUSTE_BUSCADOR.tComprometido)) {
    m.exceso = 0;
    return;
  }
  const lamDot = (rx * rvy - ry * rvx) / r2;
  if (Math.abs(lamDot) > lim) {
    m.exceso += h;
    if (m.exceso > AJUSTE_BUSCADOR.excesoMax) m.guiado = false;
  } else m.exceso = Math.max(0, m.exceso - h);
}

/** Opciones locales (densidad / motor) reutilizadas entre llamadas. */
const local: Required<OpcionesMisil> = { ...opcionesMisil('buscador', 1) };
/** Combustible ficticio para que `pasoMisil` guíe en planeo (se restaura a 0). */
const PLANEO = 1e6;

/** Resultado sin novedades (compartido: `paso` no crea un objeto por frame). */
const R_VUELA: { estado: EstadoMisil; hijos?: MisilEnemigo[] } = Object.freeze({ estado: 'vuela' as EstadoMisil });
/** El blanco, copiado y avanzado dentro del frame (reutilizado). */
const obTmp: Movil = { x: 0, y: 0, vx: 0, vy: 0 };

/**
 * Integra un misil enemigo `dt` segundos. `nivel` se ignora (un misil no
 * cambia en vuelo); se usa el de lanzamiento.
 * Estados: 'vuela' (con `hijos` si soltó bolas/chispas sin morir); 'suelo'
 * (tocó el terreno: explotar ahí); 'agotado' (se acabó su vida: explosión
 * pequeña en el aire, sin daño); 'divide' (racimo, palmera, crisantemo,
 * enredadera: quitar el portador con su estallido y añadir `hijos`);
 * 'revienta' (petardo: daña en `RADIO_TRUENO`).
 * `m.combustible > 0` ⇔ motor encendido (para dibujar la llama).
 * No compartir ni guardar el objeto devuelto: puede ser el mismo cada vez.
 */
export function paso(
  m: MisilEnemigo,
  objetivo: Movil | null,
  dt: number,
  nivel: number,
  suelo: Suelo,
): { estado: EstadoMisil; hijos?: MisilEnemigo[] } {
  m.px = fin(m.x);
  m.py = fin(m.y);
  m.etapa2 = fin(m.etapa2);
  m.apagado = fin(m.apagado);
  m.exceso = fin(m.exceso);
  dt = clamp(fin(dt), 0, 0.25);
  void nivel;
  const o = opsDe(m.tipo, m.nivel);
  const ficha = MISILES[m.tipo];
  const e = progreso(m.nivel);
  const nTrozos = Math.max(1, Math.ceil(dt * 120 - 1e-9));
  const h = dt / nTrozos;
  // el blanco avanza dentro del frame
  let ob: Movil | null = null;
  if (objetivo) {
    ob = obTmp;
    ob.x = fin(objetivo.x);
    ob.y = fin(objetivo.y);
    ob.vx = fin(objetivo.vx);
    ob.vy = fin(objetivo.vy);
  }
  // La palmera y la fugaz (mientras sube) apuntan a un punto por encima del avión.
  let alzado = 0;
  if (ob && (m.tipo === 'palmera' || (m.tipo === 'fugaz' && m.cuenta === 0))) {
    alzado = m.tipo === 'palmera' ? PALMA_ALTO : FUGAZ_ALTO;
    ob.y += alzado;
  }
  let hijos: MisilEnemigo[] | null = null;

  for (let i = 0; i < nTrozos; i++) {
    // aire local: arriba menos arrastre (más rápido) y menos sustentación
    const rho = densidad(m.y);
    Object.assign(local, o);
    local.arrastre = o.arrastre * rho;
    local.vMax = o.vMax / Math.sqrt(rho);
    local.cargaMax = o.cargaMax * Math.sqrt(clamp(fin(m.calidad, 1), CALIDAD_MIN, CALIDAD_MAX));
    const ardia = m.combustible > 0;
    // 2.ª etapa: tras planear un rato, se reenciende
    if (!ardia && m.etapa2 > 0 && ficha.etapa2 && m.apagado >= ficha.etapa2.espera) {
      m.combustible = m.etapa2;
      m.etapa2 = 0;
      m.apagado = 0;
    }
    const enMotor = m.combustible > 0;
    const planea = !enMotor && ficha.planeo && m.guiado && m.tipo !== 'cohete';
    if (planea) {
      local.empuje = 0;
      m.combustible = PLANEO;
    }
    const guiadoAntes = m.guiado;
    const res = pasoMisil(m, ob, h, local, suelo);
    if (planea) m.combustible = 0;
    if (enMotor && m.combustible <= 0) {
      // se acaba de apagar: `pasoMisil` lo deja ciego, pero si planea (o va a
      // reencender) conserva el buscador
      if (ficha.planeo || m.etapa2 > 0) m.guiado = guiadoAntes;
      m.apagado = 0;
    }
    if (!enMotor) {
      m.apagado += h;
      // sin energía para maniobrar: el buscador se rinde
      if (m.guiado && Math.hypot(m.vx, m.vy) < ficha.vMinGuia * local.vMax) m.guiado = false;
    }
    if (res === 'suelo') return { estado: 'suelo' };
    // la palmera no persigue (busca altura) y la fugaz todavía no mira mientras sube
    if (m.guiado && ob && m.t > 0.5 && !alzado) seguir(m, ob, h);
    const motor = m.combustible > 0;
    const d = ob ? Math.hypot(ob.x - m.x, ob.y - alzado - m.y) : Infinity;

    if (motor && m.t < RAMPA_T && ob && RAMPA[m.tipo]) rampa(m, ob, o, h);
    // las maniobras propias crecen con la velocidad (aletas) y tras salir de la rampa
    const sp = Math.hypot(m.vx, m.vy);
    const aletas = Math.min(1, (sp / (0.7 * vTipica(o))) ** 2);
    if ((m.tipo === 'zigzag' || m.tipo === 'serpiente') && motor && m.guiado) {
      // serpentea tras la rampa, nunca pegado al suelo, y se endereza en los
      // últimos ~45 px para no fallar solo
      const serp = m.tipo === 'serpiente';
      m.fase += (serp ? SERP_W : ZIG_W) * h;
      const cerca = clamp((d - 25) / 60, 0, 1);
      const entra = clamp((m.t - 1) / 0.6, 0, 1);
      const altura = clamp((m.y - fin(suelo(m.x)) - 20) / 40, 0, 1);
      empujeLateral(m, (serp ? SERP_A : ZIG_A) * Math.sin(m.fase) * cerca * aletas * entra * altura, h);
    } else if ((m.tipo === 'enjambre' || m.tipo === 'perdigon' || m.tipo === 'abeja') && motor) {
      m.fase += h;
      const a =
        m.tipo === 'abeja'
          ? ABEJA_A * (0.55 * Math.sin(m.fase * 13.1 + m.id) + 0.45 * Math.sin(m.fase * 29.7 + 3 * m.id))
          : (m.tipo === 'enjambre' ? ENJ_A : ENJ_A * 0.5) * (0.6 * Math.sin(m.fase * 9.3 + m.id) + 0.4 * Math.sin(m.fase * 23.1 + 2 * m.id));
      empujeLateral(m, a * aletas * clamp((m.t - 0.3) / 0.4, 0, 1), h);
    } else if (m.tipo === 'mariposa' && motor && m.guiado) {
      // la pareja aletea en contrafase: se cruzan y se vuelven a separar
      const cerca = clamp((d - 30) / 70, 0, 1);
      const entra = clamp((m.t - 0.8) / 0.5, 0, 1);
      empujeLateral(m, MARI_A * Math.sin(MARI_W * m.t + m.fase) * cerca * aletas * entra, h);
    } else if (m.tipo === 'zarcillo' && motor && m.guiado) {
      m.fase += 6 * h;
      empujeLateral(m, ZARC_A * Math.sin(m.fase) * clamp((d - 25) / 70, 0, 1) * aletas, h);
    } else if (m.tipo === 'arcoiris') {
      m.tinte = Math.floor(m.t / ARCO_T) % 6;
    } else if (m.tipo === 'candela' && ob) {
      // escupe bolas con adelanto; la boca brilla del color de la próxima
      m.reloj -= h;
      m.aviso = m.cuenta > 0 && d < 460 ? clamp(1 - m.reloj / 0.3, 0, 1) : 0;
      if (m.cuenta > 0 && m.t > 1 && d < 420 && d > 40 && m.reloj <= 0) {
        m.reloj = lerp(0.62, 0.45, e);
        m.cuenta--;
        (hijos ??= []).push(bolaDe(m, ob));
        m.tinte = (m.tinte + 1) % ficha.fuego.paleta.length;
      }
    } else if (m.tipo === 'girandola') {
      // gira siempre; cerca del avión lanza chispas por sus dos brazos
      m.fase += 9 * h;
      m.reloj -= h;
      if (motor && ob && d < 240 && m.cuenta > 0 && m.reloj <= 0) {
        m.reloj = lerp(0.13, 0.09, e);
        m.cuenta--;
        const a = m.fase + (m.cuenta & 1 ? Math.PI : 0);
        const c = hijo(m, 'chispa', a, 200, 0);
        c.vx += m.vx * 0.5;
        c.vy += m.vy * 0.5;
        c.tinte = m.cuenta % ficha.fuego.paleta.length;
        (hijos ??= []).push(c);
      }
    } else if (m.tipo === 'petardo' && ob) {
      if (m.mecha <= 0 && m.t > 0.8 && d < MECHA_D) m.mecha = 1e-3;
      if (m.mecha > 0) {
        // la mecha chisporrotea: frena en seco y revienta donde esté
        m.mecha += h;
        m.aviso = 1;
        const k = Math.max(0, 1 - 3 * h);
        m.vx *= k;
        m.vy *= k;
        if (m.mecha >= lerp(MECHA_T[0], MECHA_T[1], e)) return { estado: 'revienta' };
      }
    } else if (m.tipo === 'fugaz') {
      if (m.cuenta === 0) {
        const sobre = ob ? m.y - (ob.y - alzado) : 0;
        m.aviso = ob ? clamp(sobre / FUGAZ_PICA, 0, 1) : 0;
        if (ob && m.t > 0.6 && (sobre > FUGAZ_PICA || m.t > 3.4 || (!motor && m.vy < 40))) {
          // destello en lo alto: da la vuelta hacia el avión y pica con motor nuevo
          m.cuenta = 1;
          ob.y -= alzado;
          alzado = 0;
          const v = Math.max(140, Math.hypot(m.vx, m.vy) * 0.6);
          const a = Math.atan2(ob.y - m.y, ob.x - m.x);
          m.vx = Math.cos(a) * v;
          m.vy = Math.sin(a) * v;
          m.rumbo = a;
          m.guiado = true;
          m.exceso = 0;
          m.combustible = 2.6 + e;
          m.apagado = 0;
          m.reloj = 0.45;
          m.aviso = 0;
        }
      } else if (m.reloj > 0) m.reloj -= h;
    } else if ((m.tipo === 'racimo' || m.tipo === 'crisantemo' || m.tipo === 'enredadera') && ob) {
      const dDiv = (m.tipo === 'racimo' ? RACIMO_D : m.tipo === 'crisantemo' ? CRIS_D : ENRED_D) + 20 * e;
      m.aviso = clamp(1 - (d - dDiv) / 80, 0, 1);
      if (m.t > 0.6 && (d <= dDiv || (!motor && (m.apagado > 1.2 || !m.guiado)))) {
        const ob2 = m.guiado ? ob : null;
        return {
          estado: 'divide',
          hijos: m.tipo === 'racimo' ? dividir(m, ob2) : m.tipo === 'crisantemo' ? dividirCrisantemo(m, ob2) : dividirEnredadera(m, ob2),
        };
      }
    } else if (m.tipo === 'palmera') {
      const sobre = ob ? m.y - (ob.y - alzado) : -Infinity;
      m.aviso = ob ? clamp((sobre + 40) / (PALMA_ABRE + 40), 0, 1) : 0;
      const encima = !!ob && sobre > PALMA_ABRE && Math.abs(ob.x - m.x) < 200;
      if (m.t > 0.8 && (encima || (!motor && m.vy < 30) || m.t > 5.5)) return { estado: 'divide', hijos: dividirPalmera(m) };
    }
    if (ob) {
      ob.x += ob.vx * h;
      ob.y += ob.vy * h;
    }
    if (!Number.isFinite(m.x + m.y + m.vx + m.vy + m.rumbo)) {
      m.x = fin(m.x, m.px);
      m.y = fin(m.y, m.py);
      m.vx = 0;
      m.vy = 0;
      m.rumbo = fin(m.rumbo);
      m.combustible = 0;
      return { estado: 'agotado' };
    }
    // vida: la de su oleada; un misil sin guía y sin motor tampoco dura para siempre
    if (m.t > o.vida || res === 'agotado' || (!motor && !m.guiado && m.etapa2 <= 0 && m.apagado > 2.5)) {
      // los que se abren igual se abren al quedarse sin vida (no es un tiro perdido)
      if (m.tipo === 'racimo') return { estado: 'divide', hijos: dividir(m, null) };
      if (m.tipo === 'crisantemo') return { estado: 'divide', hijos: dividirCrisantemo(m, null) };
      if (m.tipo === 'enredadera') return { estado: 'divide', hijos: dividirEnredadera(m, null) };
      if (m.tipo === 'palmera') return { estado: 'divide', hijos: dividirPalmera(m) };
      if (m.tipo === 'petardo') return { estado: 'revienta' };
      return { estado: 'agotado' };
    }
  }
  return hijos ? { estado: 'vuela', hijos } : R_VUELA;
}

// ---------------------------------------------------------------------------
// impactos y choques
// ---------------------------------------------------------------------------

/** Distancia mínima entre dos segmentos que se recorren a la vez (movimiento relativo lineal). */
function minRelativo(ax0: number, ay0: number, ax1: number, ay1: number, bx0: number, by0: number, bx1: number, by1: number) {
  const px = ax0 - bx0, py = ay0 - by0;
  const qx = ax1 - bx1 - px, qy = ay1 - by1 - py;
  const qq = qx * qx + qy * qy;
  const s = qq > 1e-9 ? clamp(-(px * qx + py * qy) / qq, 0, 1) : 0;
  return Math.hypot(px + qx * s, py + qy * s);
}

/**
 * Distancia mínima entre el misil y `o` durante el último `paso` (barrido:
 * no se pierden impactos aunque el misil avance 8 px por frame). `o` se
 * supone en línea recta a su velocidad durante `dt`.
 * Impacto si `distanciaMinima(...) < spec.hit + MISILES[m.tipo].radioImpacto`.
 */
export function distanciaMinima(m: MisilEnemigo, o: Movil, dt: number): number {
  const d = fin(dt);
  const ox = fin(o.x), oy = fin(o.y);
  return minRelativo(m.px, m.py, m.x, m.y, ox - fin(o.vx) * d, oy - fin(o.vy) * d, ox, oy);
}

/** Radio de impacto contra el avión, dado el `hit` del avión. */
export const radioImpacto = (m: MisilEnemigo, hitAvion: number) => Math.max(2, hitAvion + MISILES[m.tipo].radioImpacto);

/**
 * Pares [i, j] (i < j) de misiles que se tocaron durante el último paso.
 * Ignora misiles de la misma salva (`grupo`) y los recién lanzados
 * (< ARMADO_CHOQUE s). `radioExtra` se suma a cada par.
 */
export function choques(misiles: MisilEnemigo[], radioExtra = 0): [number, number][] {
  const out: [number, number][] = [];
  const extra = fin(radioExtra);
  const n = misiles.length;
  for (let i = 0; i < n; i++) {
    const a = misiles[i];
    if (a.t < ARMADO_CHOQUE) continue;
    const ra = MISILES[a.tipo].radioChoque;
    for (let j = i + 1; j < n; j++) {
      const b = misiles[j];
      if (b.t < ARMADO_CHOQUE || a.grupo === b.grupo) continue;
      const r = ra + MISILES[b.tipo].radioChoque + extra;
      // descarte rápido por caja
      const lim = r + Math.abs(a.x - a.px) + Math.abs(b.x - b.px) + Math.abs(a.y - a.py) + Math.abs(b.y - b.py);
      if (Math.abs(a.x - b.x) > lim || Math.abs(a.y - b.y) > lim) continue;
      if (minRelativo(a.px, a.py, a.x, a.y, b.px, b.py, b.x, b.y) < r) out.push([i, j]);
    }
  }
  return out;
}

/** Resta vida a un misil (choque, metralla). Devuelve true si queda destruido. */
export function golpear(m: MisilEnemigo, dmg = 1): boolean {
  m.hp -= fin(dmg, 1);
  if (m.hp > 0) {
    // el pesado se tambalea: pierde un poco de rumbo y velocidad
    m.vx *= 0.8;
    m.vy *= 0.8;
    m.rumbo += 0.25;
    return false;
  }
  return true;
}

/**
 * Probabilidad máxima por bengala (el motor suelta 3 por pulsación). Una
 * pulsación bien soltada engaña a un buscador ≈ 65–75 % en la oleada 1 y
 * ≈ 55–65 % en la 10 (de lado más, de frente/cola menos).
 */
const BENGALA_MAX = 0.95;

/**
 * Probabilidad de que UNA bengala engañe a este misil. Parte de `probBengala`
 * (la bengala y el avión dentro del cono del buscador) y la ajusta:
 *  - momento: a 0,35–0,9 s del impacto rinde al máximo; a 1,7 s la mitad;
 *    soltada a > 2,5 s el buscador ve separarse la bengala y no se la cree;
 *    a < 0,2 s ya es tarde;
 *  - aspecto: si el avión cruza de lado frente al misil (tras un giro) la
 *    bengala queda en la línea de mira y el avión sale de ella: rinde más; de
 *    cola (motor caliente a la vista) o de frente rinde menos;
 *  - oleada: los buscadores mejoran (×1 → ×0,75);
 *  - en planeo (sin motor el misil no puede corregir) rinde ×1,3.
 * `avion` puede ser el `Avion` (se usa su velocidad si la trae).
 */
export function probEngano(m: MisilEnemigo, bengala: Vec, avion: Vec): number {
  const ficha = MISILES[m.tipo];
  // el arcoíris en sus colores fríos no se cree ninguna; en los cálidos, más que nadie
  if (enFrio(m)) return 0;
  const k = ficha.engañable * (m.tipo === 'arcoiris' ? 1.25 : 1);
  if (k <= 0 || !m.guiado) return 0;
  const av = avion as Vec & { vx?: number; vy?: number };
  const avx = fin(av.vx ?? 0), avy = fin(av.vy ?? 0);
  const rx = fin(avion.x) - m.x, ry = fin(avion.y) - m.y;
  const r = Math.max(1, Math.hypot(rx, ry));
  // A missile already closing on the plane sees the flare blossom right next to it:
  // within ~500 px it counts as in the seeker's view even off the exact cone.
  const enCono = probBengala(m, bengala, avion, opsDe(m.tipo, m.nivel).cono) / 0.9; // 0…1
  const base = r < 500 ? Math.max(enCono, 0.65) : enCono;
  if (!(base > 0)) return 0;
  const rvx = avx - m.vx, rvy = avy - m.vy;
  const vc = -(rx * rvx + ry * rvy) / r;
  const tgo = vc > 1 ? r / vc : 99;
  // Mejor con el misil encima, pero soltarla antes también sirve (piso 0,35).
  const fT = tgo < 0.15 ? 0.45 : tgo <= 0.35 ? lerp(0.6, 1, (tgo - 0.15) / 0.2) : tgo <= 1.2 ? 1 : clamp(1 - (tgo - 1.2) / 2.5, 0.6, 1);
  const va = Math.hypot(avx, avy);
  const lado = va > 1 ? Math.abs(avx * ry - avy * rx) / (va * r) : 0.5; // |sen| del ángulo vel-avión / línea de mira
  const fA = 0.8 + 0.2 * lado;
  const fN = lerp(1, 0.85, progreso(m.nivel));
  const fP = m.combustible > 0 ? 1 : 1.3;
  return clamp(BENGALA_MAX * k * Math.min(1, base * 1.5) * fT * fA * fN * fP, 0, 0.95);
}

/** Dado compartido por (bengala, salva): los misiles de una salva miran la misma escena. */
const tiradas = new WeakMap<object, Map<number, number>>();

/**
 * ¿Lo engaña esta bengala? Tirar UNA vez por par (misil, bengala) al soltarla.
 * Ver `probEngano` (pesado y cohete: nunca). Los misiles de la misma salva
 * (`grupo`: enjambre, perdigones de un racimo) comparten el dado de cada
 * bengala: o la bengala se lleva a casi toda la salva o a casi ninguno.
 */
export function engana(m: MisilEnemigo, bengala: Vec, avion: Vec, rnd: () => number = Math.random): boolean {
  const p = probEngano(m, bengala, avion);
  if (!(p > 0)) return false;
  let tirada: number;
  if (bengala && typeof bengala === 'object') {
    let porGrupo = tiradas.get(bengala);
    if (!porGrupo) tiradas.set(bengala, (porGrupo = new Map()));
    const t = porGrupo.get(m.grupo);
    tirada = t ?? fin(rnd(), 1);
    if (t === undefined) porGrupo.set(m.grupo, tirada);
  } else tirada = fin(rnd(), 1);
  return tirada < p;
}

// ---------------------------------------------------------------------------
// qué dispara cada vehículo
// ---------------------------------------------------------------------------

/**
 * Techo práctico de cada tipo lanzado desde el suelo, px de altura sobre el
 * lanzador (oleada 1 → 15): la mayor altura a la que todavía acierta ≥ 50 %
 * a un avión que vuela recto (medido en simulación). Más arriba llega sin
 * energía o ni llega: no vale la pena lanzarlo. Útil para la IA.
 */
export const TECHO_TIPO: Record<TipoMisil, [number, number]> = {
  buscador: [900, 1200],
  dardo: [700, 1200],
  zigzag: [1200, 1500],
  pesado: [700, 900],
  racimo: [900, 1200],
  enjambre: [300, 500],
  estratosferico: [2900, 3200],
  perdigon: [150, 150],
  cohete: [300, 350],
  candela: [800, 1000],
  bola: [200, 200],
  palmera: [900, 1100],
  fronda: [100, 100],
  crisantemo: [900, 1200],
  estrella: [150, 150],
  girandola: [500, 650],
  chispa: [80, 80],
  cometa: [900, 1300],
  serpiente: [1000, 1300],
  petardo: [800, 1000],
  fugaz: [1800, 2400],
  mariposa: [900, 1200],
  abeja: [350, 500],
  enredadera: [1000, 1300],
  zarcillo: [200, 200],
  arcoiris: [1100, 1400],
};

/** Techo práctico de un tipo en una oleada (ver `TECHO_TIPO`). */
export function techoPractico(tipo: TipoMisil, nivel: number): number {
  const [a, b] = TECHO_TIPO[tipo];
  return lerp(a, b, progreso(nivel));
}

/**
 * Arma de cada vehículo según la oleada y la altura del avión sobre el
 * vehículo (`altura`, px; 0 si no se sabe). Presentación gradual:
 * oleada 1 sólo buscador (el jeep sigue con su cohete sin guía y el tanque
 * con antiaéreo) · 2 dardo y cometa · 3 zigzag, candela y serpiente ·
 * 4 enjambre, palmera y mariposa · 5 racimo, pesado, petardo y girándola ·
 * 6 crisantemo y abeja · 7 fugaz · 8 estratosférico y enredadera · 9 arcoíris.
 * Los nuevos entran con poco peso y ganan presencia en las oleadas siguientes. Si el avión vuela alto, los vehículos eligen lo que
 * llega: subir es una defensa válida contra enjambre/pesado/buscador, pero
 * desde la oleada 3 el SAM responde con el estratosférico (y desde la 6 el
 * camión también), así que esconderse arriba no es gratis.
 * Devuelve null cuando el vehículo debe usar su arma clásica (tanque: obús
 * antiaéreo) o no tiene nada que llegue.
 */
export function elegirArmamento(
  vehiculo: 'camion' | 'sam' | 'tanque' | 'jeep',
  nivel: number,
  rnd: () => number = Math.random,
  altura = 0,
): TipoMisil | null {
  const n = Math.max(1, Math.floor(fin(nivel, 1)));
  const h = Math.max(0, fin(altura));
  const r = clamp(fin(rnd(), 0.5), 0, 0.999999);
  const elegir = (tabla: [TipoMisil | null, number][]): TipoMisil | null => {
    // sólo lo que llega a esa altura (con un 10 % de margen)
    const util = tabla.filter(([t, p]) => p > 0 && (t === null || h <= techoPractico(t, n) * 1.1));
    if (!util.length) return null;
    const tot = util.reduce((s, [, p]) => s + p, 0);
    let x = r * tot;
    for (const [t, p] of util) {
      if (x < p) return t;
      x -= p;
    }
    return util[util.length - 1][0];
  };
  const alto = h > 600;
  switch (vehiculo) {
    case 'jeep':
      // el jeep es el tirador rápido: cohete → dardo y cometa; luego petardos y abejas
      return n < 2
        ? alto ? null : 'cohete'
        : elegir([
            ['dardo', n < 4 ? 0.5 : 0.55],
            ['cohete', n < 4 ? 0.4 : 0.25],
            ['cometa', n < 4 ? 0.15 : 0.3],
            ['petardo', n >= 5 ? 0.15 : 0],
            ['abeja', n >= 6 ? 0.15 : 0],
          ]);
    case 'camion':
      // los fuegos artificiales entran de a poco: un toque nuevo por oleada
      return elegir([
        ['buscador', n < 3 ? 1 : 0.4],
        ['dardo', n >= 2 ? (n < 3 ? 0.4 : alto ? 0.4 : 0.1) : 0],
        ['cometa', n >= 2 ? (n < 4 ? 0.12 : 0.15) : 0],
        ['zigzag', n >= 3 ? (alto ? 0.4 : 0.25) : 0],
        ['candela', n >= 3 ? (n < 5 ? 0.15 : 0.22) : 0],
        ['serpiente', n >= 3 ? (n < 5 ? 0.12 : 0.18) : 0],
        ['palmera', n >= 4 ? (n < 6 ? 0.15 : 0.2) : 0],
        ['racimo', n >= 5 ? 0.25 : 0],
        ['petardo', n >= 5 ? 0.15 : 0],
        ['fugaz', n >= 7 ? (alto ? 0.35 : 0.1) : 0],
        ['enredadera', n >= 8 ? 0.2 : 0],
        ['arcoiris', n >= 9 ? 0.2 : 0],
        ['estratosferico', n >= 6 && alto ? 0.5 : n >= 10 ? 0.1 : 0],
      ]);
    case 'sam':
      // el SAM llama a lanzar() dos veces (pareja) salvo las `SALVAS`, que ya salen juntas
      return elegir([
        ['buscador', n < 4 ? 1 : 0.4],
        ['enjambre', n >= 4 ? 0.35 : 0],
        ['mariposa', n >= 4 ? (n < 6 ? 0.2 : 0.25) : 0],
        ['racimo', n >= 5 ? 0.15 : 0],
        ['crisantemo', n >= 6 ? 0.22 : 0],
        ['abeja', n >= 6 ? 0.18 : 0],
        ['zigzag', n >= 7 ? 0.15 : 0],
        ['fugaz', n >= 7 ? (alto ? 1 : 0.15) : 0],
        ['arcoiris', n >= 9 ? 0.2 : 0],
        ['estratosferico', alto ? (n >= 3 ? 2 : 0) : n >= 8 ? 0.2 : 0],
      ]);
    case 'tanque':
      // desde la 5 algunos tanques cambian el obús por el pesado o la girándola
      return n < 5
        ? null
        : elegir([['pesado', n < 10 ? 0.3 : 0.4], ['girandola', n < 8 ? 0.12 : 0.18], [null, n < 10 ? 0.6 : 0.45]]);
  }
}
