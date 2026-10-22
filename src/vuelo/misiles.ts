/*
 * Catálogo de misiles enemigos (vista lateral). Unidades como `fisica-tipos.ts`:
 * px de juego, s, y = ALTITUD (crece hacia arriba), rad CCW.
 *
 * Cada tipo tiene UNA lectura clara y UNA respuesta del piloto:
 *
 *  tipo       cómo vuela                                   cómo se esquiva
 *  ---------  -------------------------------------------  --------------------------------------
 *  buscador   navegación proporcional clásica              giro cerrado en el último momento / bengalas
 *  dardo      rapidísimo, tiro con adelanto, poco ágil     cambio brusco de dirección justo antes
 *  zigzag     serpentea (±12 px), lento                 gas a fondo y alejarse: no te alcanza
 *  pesado     lento, grande, 2 de vida, ignora bengalas    no se engaña: correr y girar (gira ancho)
 *  racimo     sube y a ~110 px se abre en 3–5 perdigones   romper giro justo cuando parpadea/se abre
 *  enjambre   salva de 4–6 cohetitos nerviosos, vida corta giro sostenido: no pueden seguirlo y se apagan
 *
 * Tipos auxiliares (no los elige ningún vehículo por sí solos):
 *  perdigon   submisil del racimo.
 *  cohete     cohete sin guía del jeep (lo que ya hacía `motor.ts`).
 *
 * La física base es `pasoMisil` (fisica-armas): empuje, arrastre cuadrático,
 * gravedad y navegación proporcional limitada en g. Aquí sólo se elige la
 * configuración por tipo y se añade el comportamiento propio (serpenteo,
 * división, nerviosismo) integrando en trozos de ≤ 1/120 s.
 */
import { GRAVEDAD, pasoMisil, probBengala, solucionTiro, type OpcionesMisil } from './fisica-armas';
import type { Misil, Movil, Suelo, Vec } from './fisica-tipos';

const G = GRAVEDAD;
const GRAD = Math.PI / 180;
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// tipos públicos
// ---------------------------------------------------------------------------

export type TipoMisil = 'buscador' | 'dardo' | 'zigzag' | 'pesado' | 'racimo' | 'enjambre' | 'perdigon' | 'cohete';

/** Tipos que eligen los vehículos (los otros dos son auxiliares). */
export const TIPOS_PRINCIPALES: readonly TipoMisil[] = ['buscador', 'dardo', 'zigzag', 'pesado', 'racimo', 'enjambre'];

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
  /** Opciones de `pasoMisil` en la oleada 1. */
  opciones: Required<OpcionesMisil>;
  /** Lo que ganan a la oleada 15 (interpolación lineal desde la 1). */
  escala: { vMax: number; cargaMax: number };
  /** Vida máxima, s (después `paso` devuelve 'agotado'). */
  vida: number;
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
    opciones: ops({ navegacion: 3.5, cargaMax: 4, empujeG: 1.8, quemado: 4.5, vMax: 135, conoGrados: 70, vida: 6.5 }),
    escala: { vMax: 25, cargaMax: 1.5 },
    vida: 6.5,
    hp: 1,
    radioImpacto: 0,
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
    opciones: ops({ navegacion: 3, cargaMax: 1.8, empujeG: 3.5, quemado: 2.2, vMax: 205, conoGrados: 17, vida: 3.5 }),
    escala: { vMax: 35, cargaMax: 0.5 },
    vida: 3.5,
    hp: 1,
    radioImpacto: -1,
    radioChoque: 6,
    energia: 1.6,
    danio: 1,
    engañable: 0.5,
    estela: { nucleo: '#ffffff', brillo: '#6fd6ff', humo: '#eaf7ff', ancho: 2, largo: 34, chispas: 2 },
    color: { cuerpo: '#e9f4ff', punta: '#3fa9f5', aletas: '#2b6fb3' },
    largo: 9,
  },
  zigzag: {
    nombre: 'Zigzag',
    opciones: ops({ navegacion: 3.5, cargaMax: 5, empujeG: 1.9, quemado: 6, vMax: 112, conoGrados: 110, vida: 7 }),
    escala: { vMax: 22, cargaMax: 1 },
    vida: 7,
    hp: 1,
    radioImpacto: 1,
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
    opciones: ops({ navegacion: 3, cargaMax: 3, empujeG: 2.2, quemado: 8, vMax: 88, conoGrados: 85, vida: 9 }),
    escala: { vMax: 17, cargaMax: 0.6 },
    vida: 9,
    hp: 2,
    radioImpacto: 6,
    radioChoque: 11,
    energia: 6,
    danio: 2,
    engañable: 0,
    estela: { nucleo: '#fff1c4', brillo: '#ff9d5c', humo: '#ebe5ea', ancho: 5, largo: 38, chispas: 3, ondula: 0.8 },
    color: { cuerpo: '#d9d2c6', punta: '#ff7a3d', aletas: '#7d6b5a' },
    largo: 12,
  },
  racimo: {
    nombre: 'Racimo',
    opciones: ops({ navegacion: 3.5, cargaMax: 3.5, empujeG: 1.9, quemado: 5, vMax: 122, conoGrados: 75, vida: 6.5 }),
    escala: { vMax: 20, cargaMax: 0.6 },
    vida: 6.5,
    hp: 1,
    radioImpacto: 0,
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
    opciones: ops({ navegacion: 2.5, cargaMax: 2.8, empujeG: 2.6, quemado: 2, vMax: 140, conoGrados: 45, vida: 2.8 }),
    escala: { vMax: 25, cargaMax: 0.6 },
    vida: 2.8,
    hp: 1,
    radioImpacto: -1,
    radioChoque: 5,
    energia: 0.8,
    danio: 1,
    engañable: 0.9,
    estela: { nucleo: '#fffbe6', brillo: '#ffd166', humo: '#fbf6ea', ancho: 1.5, largo: 12, chispas: 1, ondula: 1 },
    color: { cuerpo: '#fff4d1', punta: '#ffb703', aletas: '#d18a00' },
    largo: 4,
  },
  perdigon: {
    nombre: 'Perdigón',
    opciones: ops({ navegacion: 3, cargaMax: 2.6, empujeG: 3, quemado: 0.9, vMax: 175, conoGrados: 40, vida: 1.1 }),
    escala: { vMax: 25, cargaMax: 0.7 },
    vida: 1.1,
    hp: 1,
    radioImpacto: -1,
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
    opciones: ops({ navegacion: 0, cargaMax: 0, empujeG: 2.5, quemado: 1.5, vMax: 150, conoGrados: 0, vida: 4 }),
    escala: { vMax: 20, cargaMax: 0 },
    vida: 4,
    hp: 1,
    radioImpacto: 0,
    radioChoque: 6,
    energia: 1.6,
    danio: 1,
    engañable: 0,
    estela: { nucleo: '#fff3e0', brillo: '#ffb38a', humo: '#f5efe9', ancho: 2, largo: 14, chispas: 1 },
    color: { cuerpo: '#efe6dc', punta: '#ff8a5b', aletas: '#9c6b4e' },
    largo: 6,
  },
};

/** 0 en la oleada 1 … 1 en la 15 (y se queda ahí). */
const progreso = (nivel: number) => clamp((Math.floor(fin(nivel, 1)) - 1) / 14, 0, 1);

/** Opciones de `pasoMisil` de un tipo en una oleada. */
export function opcionesMisil(tipo: TipoMisil, nivel: number): Required<OpcionesMisil> {
  const f = MISILES[tipo];
  const e = progreso(nivel);
  const o = f.opciones;
  const vMax = o.vMax + f.escala.vMax * e;
  return { ...o, vMax, cargaMax: o.cargaMax + f.escala.cargaMax * e, arrastre: o.empuje / (vMax * vMax) };
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
const ZIG_A = 6 * G; // ⇒ ±12 px de serpenteo, ±36° de rumbo
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
    guiado: tipo !== 'cohete',
    tipo,
    hp: MISILES[tipo].hp,
    fase,
    id: siguienteId++,
    grupo,
    px: fin(x),
    py: fin(y),
    aviso: 0,
    nivel: clamp(Math.floor(fin(nivel, 1)), 1, 15),
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
 * array: `enjambre` devuelve 4–6 cohetitos, el resto uno. `desvio` gira la
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
  const o = opsDe(tipo, nivel);
  const e = progreso(nivel);
  const grupo = siguienteGrupo++;
  const dv = fin(desvio);
  switch (tipo) {
    case 'dardo': {
      // Sale disparado con adelanto: ya va rápido, por eso apenas corrige.
      const ang = anguloRampa(x, y, objetivo, o.vMax * 0.95, 12 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 120, nivel, grupo, 0)];
    }
    case 'pesado': {
      const ang = anguloRampa(x, y, objetivo, o.vMax * 0.8, 35 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 25, nivel, grupo, 0)];
    }
    case 'racimo': {
      // Sube empinado: el portador busca altura antes de abrirse.
      const haciaX = Math.sign(fin(objetivo.x) - x) || 1;
      const ang = (haciaX > 0 ? 70 * GRAD : Math.PI - 70 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 45, nivel, grupo, 0)];
    }
    case 'enjambre': {
      const n = 4 + (e >= 0.45 ? 1 : 0) + (e >= 0.8 ? 1 : 0);
      const base = anguloRampa(x, y, objetivo, o.vMax * 0.8, 20 * GRAD) + dv;
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
      const sol = solucionTiro({ x, y }, o.vMax * 0.85, objetivo, false);
      const ang = (sol ? Math.atan2(sol.vy, sol.vx) : anguloRampa(x, y, objetivo, o.vMax, 15 * GRAD)) + dv;
      return [nuevo(tipo, x, y, ang, 60, nivel, grupo, 0)];
    }
    case 'zigzag': {
      const ang = anguloRampa(x, y, objetivo, o.vMax * 0.75, 35 * GRAD) + dv;
      return [nuevo(tipo, x, y, ang, 40, nivel, grupo, r() < 0.5 ? 0 : Math.PI)];
    }
    case 'perdigon':
    case 'buscador':
    default: {
      const ang = anguloRampa(x, y, objetivo, o.vMax * 0.85, 15 * GRAD) + dv;
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
    const sol = solucionTiro(m, opsDe('perdigon', m.nivel).vMax * 0.8, objetivo, false);
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
const RAMPA: Partial<Record<TipoMisil, number>> = { buscador: 2.2, zigzag: 2.2, pesado: 1.6 };

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
  const tgo = Math.hypot(rx, ry) / Math.max(o.vMax * 0.8, 1);
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
 * Integra un misil enemigo `dt` segundos. `nivel` se ignora si es menor al de
 * lanzamiento (un misil no cambia en vuelo); se usa el de lanzamiento.
 * Estados: 'vuela'; 'suelo' (tocó el terreno: explotar ahí); 'agotado' (se
 * acabó su vida: explosión pequeña en el aire, sin daño); 'divide' (racimo:
 * quitar el portador con un «puf» y añadir `hijos`).
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
    const res = pasoMisil(m, m.tipo === 'cohete' ? null : ob, h, o, suelo);
    if (res === 'suelo') return { estado: 'suelo' };
    const motor = m.combustible > 0;
    const d = ob ? Math.hypot(ob.x - m.x, ob.y - m.y) : Infinity;

    if (motor && m.t < RAMPA_T && ob && RAMPA[m.tipo]) rampa(m, ob, o, h);
    // las maniobras propias crecen con la velocidad (aletas) y tras salir de la rampa
    const sp = Math.hypot(m.vx, m.vy);
    const aletas = Math.min(1, (sp / (0.6 * o.vMax)) ** 2);
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
      if (m.t > 0.6 && (d <= dDiv || (!motor && m.t < ficha.vida))) {
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
      return { estado: 'agotado' };
    }
    if (m.t > ficha.vida || res === 'agotado') {
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
 * ¿Lo engaña esta bengala? Tirar UNA vez por par (misil, bengala) al soltarla.
 * Usa `probBengala` con el cono del tipo × `engañable` (pesado y cohete: nunca).
 */
export function engana(m: MisilEnemigo, bengala: Vec, avion: Vec, rnd: () => number = Math.random): boolean {
  const k = MISILES[m.tipo].engañable;
  if (k <= 0 || !m.guiado) return false;
  return fin(rnd(), 1) < k * probBengala(m, bengala, avion, opsDe(m.tipo, m.nivel).cono);
}

// ---------------------------------------------------------------------------
// qué dispara cada vehículo
// ---------------------------------------------------------------------------

/**
 * Arma de cada vehículo según la oleada. Presentación gradual:
 * oleada 1 sólo buscador (el jeep sigue con su cohete sin guía y el tanque
 * con antiaéreo) · 2 dardo · 3 zigzag · 4 enjambre · 5 racimo y pesado.
 * Devuelve null cuando el vehículo debe usar su arma clásica (tanque: obús
 * antiaéreo).
 */
export function elegirArmamento(
  vehiculo: 'camion' | 'sam' | 'tanque' | 'jeep',
  nivel: number,
  rnd: () => number = Math.random,
): TipoMisil | null {
  const n = Math.max(1, Math.floor(fin(nivel, 1)));
  const r = clamp(fin(rnd(), 0.5), 0, 0.999999);
  const elegir = (tabla: [TipoMisil | null, number][]): TipoMisil | null => {
    const tot = tabla.reduce((s, [, p]) => s + p, 0);
    let x = r * tot;
    for (const [t, p] of tabla) {
      if (x < p) return t;
      x -= p;
    }
    return tabla[tabla.length - 1][0];
  };
  switch (vehiculo) {
    case 'jeep':
      // el jeep es el tirador rápido: cohete → dardo
      return n < 2 ? 'cohete' : elegir([['dardo', n < 4 ? 0.5 : 0.7], ['cohete', n < 4 ? 0.5 : 0.3]]);
    case 'camion':
      return elegir([
        ['buscador', n < 3 ? 1 : 0.45],
        ['zigzag', n >= 3 ? 0.3 : 0],
        ['racimo', n >= 5 ? 0.25 : 0],
        ['dardo', n >= 2 && n < 3 ? 0.4 : 0],
      ]);
    case 'sam':
      // el SAM llama a lanzar() dos veces (pareja) salvo enjambre, que ya es salva
      return elegir([
        ['buscador', n < 4 ? 1 : 0.4],
        ['enjambre', n >= 4 ? 0.35 : 0],
        ['racimo', n >= 5 ? 0.15 : 0],
        ['zigzag', n >= 7 ? 0.15 : 0],
      ]);
    case 'tanque':
      // desde la 6 algunos tanques cambian el obús por el pesado
      return n < 5 ? null : elegir([['pesado', n < 10 ? 0.3 : 0.45], [null, n < 10 ? 0.7 : 0.55]]);
  }
}
