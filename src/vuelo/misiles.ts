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
 * Tipos auxiliares (no los elige ningún vehículo por sí solos):
 *  perdigon   submisil del racimo.
 *  cohete     cohete sin guía del jeep.
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
  | 'buscador' | 'dardo' | 'zigzag' | 'pesado' | 'racimo' | 'enjambre' | 'estratosferico' | 'perdigon' | 'cohete';

/** Tipos que eligen los vehículos (los otros dos son auxiliares). */
export const TIPOS_PRINCIPALES: readonly TipoMisil[] = ['buscador', 'dardo', 'zigzag', 'pesado', 'racimo', 'enjambre', 'estratosferico'];

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
};

export type EstadoMisil = 'vuela' | 'suelo' | 'agotado' | 'divide';

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
    estela: { nucleo: '#fff6dc', brillo: '#ff8fab', humo: '#f6eef6', ancho: 3, largo: 26, chispas: 1 },
    color: { cuerpo: '#f4f1ea', punta: '#ff6f91', aletas: '#c45b7a' },
    largo: 7,
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
    estela: { nucleo: '#ffffff', brillo: '#6fd6ff', humo: '#eaf7ff', ancho: 2, largo: 34, chispas: 2 },
    color: { cuerpo: '#e9f4ff', punta: '#3fa9f5', aletas: '#2b6fb3' },
    largo: 9,
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
    estela: { nucleo: '#fff8cc', brillo: '#b99bff', humo: '#f2edff', ancho: 3, largo: 30, chispas: 1, ondula: 1.5 },
    color: { cuerpo: '#f3efff', punta: '#9b7bff', aletas: '#6b54c9' },
    largo: 7,
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
    estela: { nucleo: '#fff1c4', brillo: '#ff9d5c', humo: '#ebe5ea', ancho: 5, largo: 38, chispas: 3, ondula: 0.8 },
    color: { cuerpo: '#d9d2c6', punta: '#ff7a3d', aletas: '#7d6b5a' },
    largo: 12,
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
    estela: { nucleo: '#ffffff', brillo: '#7ee8b5', humo: '#edfaf3', ancho: 3, largo: 24, chispas: 2 },
    color: { cuerpo: '#eefaf3', punta: '#3ccf8e', aletas: '#24936a' },
    largo: 9,
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
    estela: { nucleo: '#fffbe6', brillo: '#ffd166', humo: '#fbf6ea', ancho: 1.5, largo: 12, chispas: 1, ondula: 1 },
    color: { cuerpo: '#fff4d1', punta: '#ffb703', aletas: '#d18a00' },
    largo: 4,
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
    estela: { nucleo: '#ffffff', brillo: '#ff5d5d', humo: '#f3eef2', ancho: 3.5, largo: 44, chispas: 2 },
    color: { cuerpo: '#f2f2f4', punta: '#e63946', aletas: '#3d405b' },
    largo: 13,
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
    estela: { nucleo: '#ffffff', brillo: '#a8f0c8', humo: '#f0fbf5', ancho: 1.5, largo: 10, chispas: 1 },
    color: { cuerpo: '#eefaf3', punta: '#3ccf8e', aletas: '#24936a' },
    largo: 4,
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
    estela: { nucleo: '#fff3e0', brillo: '#ffb38a', humo: '#f5efe9', ancho: 2, largo: 14, chispas: 1 },
    color: { cuerpo: '#efe6dc', punta: '#ff8a5b', aletas: '#9c6b4e' },
    largo: 6,
  },
};

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

// caché por (tipo, nivel) para no crear objetos cada frame
const cacheOps = new Map<string, Required<OpcionesMisil>>();
function opsDe(tipo: TipoMisil, nivel: number) {
  const n = clamp(Math.floor(fin(nivel, 1)), 1, 15);
  const k = tipo + n;
  let o = cacheOps.get(k);
  if (!o) {
    o = opcionesMisil(tipo, n);
    cacheOps.set(k, o);
  }
  return o;
}

// comportamiento propio
/** Zigzag: aceleración lateral de serpenteo, px/s², y su frecuencia, rad/s. */
const ZIG_A = 6 * G;
const ZIG_W = 2 * Math.PI * 0.95;
/** Racimo: distancia al blanco a la que se abre, px, y nº de perdigones. */
const RACIMO_D = 110;
/** Enjambre: nerviosismo lateral, px/s². */
const ENJ_A = 2.2 * G;
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
  };
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
const RAMPA: Partial<Record<TipoMisil, number>> = { buscador: 2.2, zigzag: 2.2, pesado: 1.6, estratosferico: 1.8 };

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

/**
 * Integra un misil enemigo `dt` segundos. `nivel` se ignora (un misil no
 * cambia en vuelo); se usa el de lanzamiento.
 * Estados: 'vuela'; 'suelo' (tocó el terreno: explotar ahí); 'agotado' (se
 * acabó su vida: explosión pequeña en el aire, sin daño); 'divide' (racimo:
 * quitar el portador con un «puf» y añadir `hijos`).
 * `m.combustible > 0` ⇔ motor encendido (para dibujar la llama).
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
  const nTrozos = Math.max(1, Math.ceil(dt * 120 - 1e-9));
  const h = dt / nTrozos;
  // el blanco avanza dentro del frame
  const ob: Movil | null = objetivo
    ? { x: fin(objetivo.x), y: fin(objetivo.y), vx: fin(objetivo.vx), vy: fin(objetivo.vy) }
    : null;

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
    if (m.guiado && ob && m.t > 0.5) seguir(m, ob, h);
    const motor = m.combustible > 0;
    const d = ob ? Math.hypot(ob.x - m.x, ob.y - m.y) : Infinity;

    if (motor && m.t < RAMPA_T && ob && RAMPA[m.tipo]) rampa(m, ob, o, h);
    // las maniobras propias crecen con la velocidad (aletas) y tras salir de la rampa
    const sp = Math.hypot(m.vx, m.vy);
    const aletas = Math.min(1, (sp / (0.7 * vTipica(o))) ** 2);
    if (m.tipo === 'zigzag' && motor && m.guiado) {
      // serpentea tras la rampa, nunca pegado al suelo, y se endereza en los
      // últimos ~45 px para no fallar solo
      m.fase += ZIG_W * h;
      const cerca = clamp((d - 25) / 60, 0, 1);
      const entra = clamp((m.t - 1) / 0.6, 0, 1);
      const altura = clamp((m.y - fin(suelo(m.x)) - 20) / 40, 0, 1);
      empujeLateral(m, ZIG_A * Math.sin(m.fase) * cerca * aletas * entra * altura, h);
    } else if ((m.tipo === 'enjambre' || m.tipo === 'perdigon') && motor) {
      m.fase += h;
      const a = (m.tipo === 'enjambre' ? ENJ_A : ENJ_A * 0.5) * (0.6 * Math.sin(m.fase * 9.3 + m.id) + 0.4 * Math.sin(m.fase * 23.1 + 2 * m.id));
      empujeLateral(m, a * aletas * clamp((m.t - 0.3) / 0.4, 0, 1), h);
    } else if (m.tipo === 'racimo' && ob) {
      const dDiv = RACIMO_D + 20 * progreso(m.nivel);
      m.aviso = clamp(1 - (d - dDiv) / 80, 0, 1);
      if (m.t > 0.6 && (d <= dDiv || (!motor && (m.apagado > 1.2 || !m.guiado)))) {
        return { estado: 'divide', hijos: dividir(m, m.guiado ? ob : null) };
      }
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
      // el racimo que se queda sin vida igual se abre (no es un tiro perdido)
      if (m.tipo === 'racimo') return { estado: 'divide', hijos: dividir(m, null) };
      return { estado: 'agotado' };
    }
  }
  return { estado: 'vuela' };
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
  const k = ficha.engañable;
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
 * con antiaéreo) · 2 dardo · 3 zigzag · 4 enjambre · 5 racimo y pesado ·
 * 8 estratosférico. Si el avión vuela alto, los vehículos eligen lo que
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
      // el jeep es el tirador rápido: cohete → dardo
      return n < 2 ? (alto ? null : 'cohete') : elegir([['dardo', n < 4 ? 0.5 : 0.7], ['cohete', n < 4 ? 0.5 : 0.3]]);
    case 'camion':
      return elegir([
        ['buscador', n < 3 ? 1 : 0.4],
        ['dardo', n >= 2 ? (n < 3 ? 0.4 : alto ? 0.4 : 0.1) : 0],
        ['zigzag', n >= 3 ? (alto ? 0.4 : 0.25) : 0],
        ['racimo', n >= 5 ? 0.25 : 0],
        ['estratosferico', n >= 6 && alto ? 0.5 : n >= 10 ? 0.1 : 0],
      ]);
    case 'sam':
      // el SAM llama a lanzar() dos veces (pareja) salvo enjambre, que ya es salva
      return elegir([
        ['buscador', n < 4 ? 1 : 0.4],
        ['enjambre', n >= 4 ? 0.35 : 0],
        ['racimo', n >= 5 ? 0.15 : 0],
        ['zigzag', n >= 7 ? 0.15 : 0],
        ['estratosferico', alto ? (n >= 3 ? 2 : 0) : n >= 8 ? 0.2 : 0],
      ]);
    case 'tanque':
      // desde la 5 algunos tanques cambian el obús por el pesado
      return n < 5 ? null : elegir([['pesado', n < 10 ? 0.3 : 0.45], [null, n < 10 ? 0.7 : 0.55]]);
  }
}
