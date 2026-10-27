import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { solucionTiro } from './fisica-armas';
import { dificultad, VEL_BALIN, VEL_COHETE, type Disparo, type TipoAereo } from './aereos';
import type { TipoMisil } from './misiles';
import type { Vista } from './ia';

/*
 * JEFES AÉREOS (bosses), both crewed by mice:
 *
 *  - dirigible «Gran Queso» (cloud sea, ~650–1150 px): a ~220×100 px cheese
 *    zeppelin with holes, a gondola with the captain (monocle) in front.
 *    Parts: 3 flak turrets, 2 missile racks, 2 propellers (each lost one
 *    makes it slower), the gondola (weak point: armoured until the three
 *    turrets are down, except during "ventanas" when the captain opens the
 *    hatch to shout) and the envelope (casco: soaks hits at half damage).
 *      Fase 1 (100–60 %): turret bursts (blink 0.5 s before) + one missile
 *        every ~5 s (the rack blinks 0.8 s before).
 *      Fase 2 (60–30 %): also drops floating «quesitos bomba» (mines, the
 *        belly hatch blinks first) and launches drone swarms (escolta).
 *      Fase 3 (<30 %, furia): it tilts nose-down, loses gas (folds in the
 *        envelope, gas puffs, fire, smoke), sinks slowly, fires faster,
 *        missiles come in pairs and the gondola is always open.
 *      Death: it burns and falls nose-first with a chain of explosions
 *        (~4.5 s), shedding fins, turrets and propellers.
 *
 *  - nodriza (space, ~2050–2900 px): a ~250 px pastel mothership with the
 *    Mouse Emperor (crown and cape) under a glass dome. Parts: 4 laser
 *    cannons (aim line blinks 0.8 s before a 0.55 s beam), a central tractor
 *    emitter, 3 shield generators (while any stands, the dome has a visible
 *    bubble shield and hits on it are blocked) and the dome (weak point).
 *      Fase 1 (100–66 %): cannons fire one after another, each at where the
 *        plane will be (keep turning and they miss) + escort saucers.
 *      Fase 2 (66–33 %): «abanico» (all cannons at once on a row of points
 *        ~120 px apart around the plane: climb or dive along the gap), single
 *        shots, and the tractor beam (cone blinks 0.8 s, pulls ~3 s).
 *      Fase 3 (<33 %): abanico + doubles that sweep slowly after the plane,
 *        and the Emperor fires fans of 5 rockets from the dome (dome blinks).
 *      Death: it wobbles, lights die, explosions chain round the rim, a big
 *        flash and it sinks (~3.8 s).
 *
 * Life: every boss has a global life pool (`vida`, the big bar). Damage to a
 * part takes the same off the pool (hull hits count half, 40 % for the
 * saucer); destroying the core (gondola / dome) or emptying the pool kills
 * it. Parts are sub-goals: killing one silences that attack and shows.
 * Visible damage: every hit leaves a wound where it landed (tears in the
 * cheese, cracks in the saucer) that grows with more hits, smokes, and
 * burns from fase 2; destroyed parts leave burnt stumps and throw a piece
 * (`eventos[].pieza`, sprite from `spritePieza`).
 *
 * Units: world px, s, y = ALTITUDE (up), angles CCW, as in aereos.ts.
 * Local part coords (dx, dy) are sprite pixels with y DOWN, facing right;
 * `posParte` converts them to the world (the body tilts and turns).
 *
 * ── Integration in motor.ts (sketch) ──────────────────────────────────────
 *   import * as JF from './jefes';
 *   s.jefe: JF.Jefe | null
 *   spawn: s.jefe = JF.crear('dirigible', s.camX + view.vw + 140, clamp(p.y + 60, 700, 1100), s.wave)
 *   each frame:
 *     const r = JF.paso(j, vista, dt, s.aereos.length);
 *     r.disparos → s.proy.push(AE.nuevoProyectil(d))           (balín / cohete / mina)
 *     r.misiles  → MS.lanzar(m.tipo, m.x, m.y, p, s.wave, Math.random, m.desvio) → s.shots (enemy)
 *     r.laser    → hurtPlane(1, r.laser.x, r.laser.y)
 *     r.tractor  → p.vx += fx*dt; p.vy += fy*dt
 *     r.escolta  → spawnAir(AE.crear(e.tipo, e.x, e.y, Math.random, s.wave))
 *     r.eventos  → explosion: blast(x, y, energia, 'nadie', 0) · pieza: VFX.pieza(s.fx, x, y, vx, vy,
 *                  JF.spritePieza(j.tipo, nombre), JF.TINTA[j.tipo]) · dialogo: talk(texto, j.x, j.y)
 *     for (const f of JF.focos(j)) VFX.fuego(s.fx, f.x, f.y, j.vx, j.vy, f.intensidad)
 *     if (r.muerto) s.jefe = null
 *   player missile: if (JF.tocado(j, m.x, m.y, 3)) → blast(...) ; in blast('jugador'):
 *     if (s.jefe && JF.tocado(s.jefe, x, y, ex.radio)) { const h = JF.golpear(s.jefe, x, y, damage); award(h.puntos…) }
 *   plane vs body: if (JF.choque(j, p.x, p.y, s.spec.hit)) hurtPlane(1, p.x, p.y) (+ push away)
 *   draw (after aereos): JF.dibujar(g, j, sx(j.x), sy(j.y), s.t, flashTimer > 0); HUD: JF.dibujarBarra(g, j, x, y, w, s.t)
 */

type Ctx = CanvasRenderingContext2D;

export type TipoJefe = 'dirigible' | 'nodriza' | 'zepelin';

export type ClaseParte = 'casco' | 'nucleo' | 'torreta' | 'lanzador' | 'helice' | 'canon' | 'generador' | 'emisor' | 'celda' | 'reflector';

/** A laser cannon's beam: 1 aiming (blinking line, locked), 2 firing. */
/** `bx, by`: the locked aim point (the line re-aims at it as the ship drifts). */
export type Rayo = { modo: 1 | 2; t: number; ang: number; largo: number; acerto: boolean; barrido: number; bx: number; by: number };

export type ParteJefe = {
  nombre: string;
  clase: ClaseParte;
  /** Local position, sprite px (y down, facing right). */
  dx: number;
  dy: number;
  /** Hit radius, px (for 'casco' it's the half-width of the body ellipse). */
  r: number;
  hp: number;
  hpMax: number;
  viva: boolean;
  /** False while armoured / shielded (hits are blocked). */
  vulnerable: boolean;
  /** Hit flash, s. */
  flash: number;
  /** World aim angle (turrets, cannons). */
  ang: number;
  cd: number;
  /** Seconds of warning left before this part fires. */
  aviso: number;
  rafaga: number;
  rafT: number;
  rayo?: Rayo;
  /** Zepelin gas cell: seconds it has been burning (undefined = not on fire). */
  arde?: number;
};

/** Zepelin flak shell (time fuse), bomb and the black puff a burst leaves. World coords, y up. */
export type GranadaZ = { x: number; y: number; vx: number; vy: number; fuse: number };
export type BombaZ = { x: number; y: number; vx: number; vy: number; t: number };
export type NubeFlak = { x: number; y: number; t: number; sem: number };

export type Herida = { u: number; v: number; s: number; sem: number };

export type Tractor = { modo: 0 | 1 | 2; t: number; ang: number; atrapado: boolean; cd: number };

export type Jefe = {
  tipo: TipoJefe;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Body tilt, rad CCW. */
  ang: number;
  /** Facing (1 right, -1 left) and the current horizontal scale while it turns (-1…1). */
  mira: 1 | -1;
  giro: number;
  girarT: number;
  partes: ParteJefe[];
  vida: number;
  vidaMax: number;
  fase: 1 | 2 | 3;
  ola: number;
  t: number;
  /** -1 alive; otherwise seconds since it was defeated. */
  muriendo: number;
  muerto: boolean;
  heridas: Herida[];
  /** Gondola hatch open, s (dirigible). */
  ventana: number;
  ventanaCd: number;
  misilCd: number;
  siguienteLanzador: number;
  minaCd: number;
  minaAviso: number;
  escoltaCd: number;
  patronCd: number;
  patronN: number;
  orbeCd: number;
  orbeAviso: number;
  /** Shield bubble flash (blocked hit), s. */
  escudoFlash: number;
  tractor: Tractor;
  /** Pending events (flushed by `paso`). */
  cola: EventoJefe[];
  rng: number;
  hundir: number;
  /* Zepelin only (empty / idle on the others). */
  granadas: GranadaZ[];
  bombas: BombaZ[];
  nubes: NubeFlak[];
  bombasPend: number;
  bombaT: number;
  cazaCd: number;
  /** >0 while a searchlight has the plane in its beam (flak aims better). */
  iluminado: number;
  crujeCd: number;
  charlaCd: number;
  /** -1 whole; otherwise seconds since the hull broke in two (death). */
  roto: number;
};

export type EventoJefe = {
  pieza?: { x: number; y: number; vx: number; vy: number; nombre: string };
  explosion?: { x: number; y: number; energia: number };
  dialogo?: string;
  /** Zepelin: a flak shell burst here (sound + a small flash; the black puff is drawn by `dibujar`). */
  flak?: { x: number; y: number };
  /** Zepelin sound cues: 'cruje' → AB.zepelinCruje(), 'cae' → AB.zepelinCae(). */
  sonido?: 'cruje' | 'cae';
};

export type ResultadoJefe = {
  /** Projectiles for aereos.ts: `s.proy.push(AE.nuevoProyectil(d))`. */
  disparos?: Disparo[];
  /** Enemy missiles: `MS.lanzar(tipo, x, y, avion, ola, rnd, desvio)`. */
  misiles?: { tipo: TipoMisil; x: number; y: number; desvio: number }[];
  /** A laser (or a tractor zap) hit the plane here: 1 damage. */
  laser?: { x: number; y: number };
  /** Tractor beam acceleration on the plane this frame (px/s², y up). */
  tractor?: { fx: number; fy: number };
  /** Escorts to create with AE.crear (a 'dron' is a whole swarm). */
  escolta?: { tipo: TipoAereo; x: number; y: number }[];
  eventos?: EventoJefe[];
  /** The death sequence is over: remove the boss. */
  muerto?: boolean;
  /** Zepelin: a flak burst or a bomb hit the plane here: hurtPlane(1, x, y) (no laser sound). */
  impacto?: { x: number; y: number };
  /** Zepelin: tough escort fighters to launch: CZ.crear(x, y, haciaDerecha, ola, true) with hp = hpMax = `hp`. */
  cazas?: { x: number; y: number; haciaDerecha: boolean; hp: number }[];
};

export type ResultadoGolpe = {
  parte?: string;
  destruida?: boolean;
  /** The hit was stopped by armour or the shield. */
  bloqueado?: boolean;
  puntos?: number;
  /** This hit defeated the boss (the death sequence starts). */
  derrotado?: boolean;
};

export const NOMBRE: Record<TipoJefe, string> = {
  dirigible: 'Dirigible Gran Queso',
  nodriza: 'Nave nodriza del Emperador Ratón',
  zepelin: 'Zepelín de la vecina Margarita',
};
/** Outline / debris color per boss. */
export const TINTA: Record<TipoJefe, string> = { dirigible: '#8a4a12', nodriza: '#3a2a7a', zepelin: '#3a2a4a' };
/** Where each boss lives, px of altitude. */
export const ZONA: Record<TipoJefe, [number, number]> = { dirigible: [1050, 1600], nodriza: [2400, 2950], zepelin: [400, 900] };
/** Laser warning (constant: it's what makes beams dodgeable) and beam time, s. */
export const AVISO_LASER = 0.8;
export const DUR_LASER = 0.55;
const ALCANCE_LASER = 560;
const LARGO_TRACTOR = 270;
const APERTURA_TRACTOR = 0.3;
const PUNTOS_PARTE: Record<ClaseParte, number> = { casco: 0, nucleo: 0, torreta: 250, lanzador: 300, helice: 200, canon: 300, generador: 350, emisor: 400, celda: 300, reflector: 200 };
export const PUNTOS_JEFE: Record<TipoJefe, number> = { dirigible: 3000, nodriza: 5000, zepelin: 6000 };

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const envolver = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const girar = (desde: number, hacia: number, max: number) => desde + clamp(envolver(hacia - desde), -max, max);

function azar(j: Jefe): number {
  j.rng = (Math.imul(j.rng, 1664525) + 1013904223) >>> 0;
  return j.rng / 4294967296;
}

/* ── Construction ───────────────────────────────────────────────────────── */

function parte(nombre: string, clase: ClaseParte, dx: number, dy: number, r: number, hp: number): ParteJefe {
  return { nombre, clase, dx, dy, r, hp, hpMax: hp, viva: true, vulnerable: true, flash: 0, ang: -Math.PI / 2, cd: 1 + Math.random() * 2, aviso: 0, rafaga: 0, rafT: 0 };
}

/**
 * Creates a boss at (x, y). `ola` (wave) tunes its aim and pace a little
 * and adds a few % of life in later waves.
 */
export function crear(tipo: TipoJefe, x: number, y: number, ola = 4): Jefe {
  const n = Math.max(1, Math.floor(fin(ola, 4)));
  const extra = 1 + clamp((n - 4) * 0.04, 0, 0.4);
  const partes =
    tipo === 'zepelin'
      ? partesZepelin()
      : tipo === 'dirigible'
      ? [
          parte('casco', 'casco', 0, 0, 100, 80),
          parte('gondola', 'nucleo', 12, 44, 15, 40),
          parte('torreta1', 'torreta', 34, -31, 8, 9),
          parte('torreta2', 'torreta', -38, -30, 8, 9),
          parte('torreta3', 'torreta', -30, 30, 8, 9),
          parte('lanzador1', 'lanzador', 66, 18, 9, 11),
          parte('lanzador2', 'lanzador', -66, -18, 9, 11),
          parte('helice1', 'helice', -76, 30, 9, 7),
          parte('helice2', 'helice', -118, 0, 9, 7),
        ]
      : [
          parte('casco', 'casco', 0, 4, 122, 90),
          parte('cupula', 'nucleo', 0, -26, 22, 45),
          parte('canon1', 'canon', -90, 13, 8, 10),
          parte('canon2', 'canon', -38, 19, 8, 10),
          parte('canon3', 'canon', 38, 19, 8, 10),
          parte('canon4', 'canon', 90, 13, 8, 10),
          parte('generador1', 'generador', -64, -14, 8, 8),
          parte('generador2', 'generador', 64, -14, 8, 8),
          parte('generador3', 'generador', 0, -56, 7, 8),
          parte('emisor', 'emisor', 0, 24, 9, 14),
        ];
  for (const p of partes) {
    p.hp = p.hpMax = Math.round(p.hpMax * extra);
    p.cd = 1.5 + (partes.indexOf(p) % 3) * 0.9;
  }
  const vidaMax = Math.round((tipo === 'dirigible' ? 60 : tipo === 'zepelin' ? 100 : 62) * extra);
  const j: Jefe = {
    tipo, x: fin(x), y: fin(y, tipo === 'dirigible' ? 900 : tipo === 'zepelin' ? 650 : 2400), vx: tipo === 'dirigible' ? -20 : tipo === 'zepelin' ? -18 : -40, vy: 0, ang: 0, mira: -1, giro: -1, girarT: 0,
    partes, vida: vidaMax, vidaMax, fase: 1, ola: n, t: 0, muriendo: -1, muerto: false, heridas: [],
    ventana: 0, ventanaCd: 7, misilCd: 3, siguienteLanzador: 0, minaCd: 2, minaAviso: 0, escoltaCd: tipo === 'nodriza' ? 7 : 3,
    patronCd: 2, patronN: 0, orbeCd: 3, orbeAviso: 0, escudoFlash: 0,
    tractor: { modo: 0, t: 0, ang: -Math.PI / 2, atrapado: false, cd: 4 },
    cola: [], rng: ((x * 7919 + y * 104729 + n * 31) >>> 0) || 7, hundir: 0,
    granadas: [], bombas: [], nubes: [], bombasPend: 0, bombaT: 0, cazaCd: 14, iluminado: 0, crujeCd: 6, charlaCd: 0, roto: -1,
  };
  if (tipo === 'nodriza') j.giro = j.mira = 1;
  if (tipo === 'zepelin') {
    j.minaCd = 4;
    j.ventanaCd = 6;
    for (const p of partes) if (p.clase === 'reflector') p.ang = -Math.PI / 2;
  }
  actualizarVulnerables(j);
  j.cola.push({
    dialogo:
      tipo === 'dirigible' ? '¡Capitán Queso al ataque! ¡Esta nube es nuestra!'
      : tipo === 'zepelin' ? '¡Ricachones $&#%! ¡Ahora tengo zepelín, a ver quién se ríe!'
      : '¡Arrodíllate ante el Emperador Ratón!',
  });
  return j;
}

/* ── Geometry ───────────────────────────────────────────────────────────── */

function trig(j: Jefe) {
  const g = Math.abs(j.giro) < 0.3 ? (j.giro < 0 ? -0.3 : 0.3) : j.giro;
  return { c: Math.cos(j.ang), s: Math.sin(j.ang), g };
}
/** Local sprite point (u right, v down) → world. */
export function aMundo(j: Jefe, u: number, v: number): { x: number; y: number } {
  const { c, s, g } = trig(j);
  return { x: j.x + c * g * u + s * v, y: j.y + s * g * u - c * v };
}
function aLocal(j: Jefe, x: number, y: number): { u: number; v: number } {
  const { c, s, g } = trig(j);
  const wx = x - j.x, wy = y - j.y;
  return { u: (c * wx + s * wy) / g, v: s * wx - c * wy };
}
export function posParte(j: Jefe, p: ParteJefe) {
  return aMundo(j, p.dx, p.dy);
}
const parteDe = (j: Jefe, n: string) => j.partes.find((p) => p.nombre === n)!;
const vivas = (j: Jefe, c: ClaseParte) => j.partes.filter((p) => p.clase === c && p.viva);
const nucleo = (j: Jefe) => j.partes.find((p) => p.clase === 'nucleo')!;

/** Body ellipse half-axes (local). */
function cuerpo(j: Jefe) {
  return j.tipo === 'dirigible' ? { rx: 102, ry: 31, cv: 0 } : j.tipo === 'zepelin' ? { rx: ZL, ry: ZR, cv: 0 } : { rx: 122, ry: 15, cv: 6 };
}
function dentroCuerpo(j: Jefe, u: number, v: number, m: number) {
  if (j.tipo === 'zepelin') {
    // Rigid hull: a long cylinder with an ogive nose, a tapered tail and the control car below.
    if (Math.abs(u) <= ZL + m && Math.abs(v) <= altoZ(u) + m) return true;
    return u > 16 - m && u < 86 + m && v > 36 - m && v < 62 + m;
  }
  const b = cuerpo(j);
  const a = (u / (b.rx + m)) ** 2 + ((v - b.cv) / (b.ry + m)) ** 2 <= 1;
  if (a) return true;
  // The saucer's dome and the zeppelin's gondola are part of the body too.
  if (j.tipo === 'nodriza') return Math.hypot(u, v + 24) < 30 + m;
  return u > -24 - m && u < 40 + m && v > 30 - m && v < 54 + m;
}

/** Collision circles in the world (body ellipse approximated by circles + live parts). */
export function circulos(j: Jefe): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  const b = cuerpo(j);
  const n = j.tipo === 'dirigible' ? 7 : j.tipo === 'zepelin' ? 10 : 8;
  for (let i = 0; i < n; i++) {
    const u = -b.rx + b.ry + ((2 * b.rx - 2 * b.ry) * i) / (n - 1);
    const h = j.tipo === 'zepelin' ? Math.max(10, altoZ(u)) : b.ry * Math.sqrt(Math.max(0.2, 1 - (u / b.rx) ** 2));
    const w = aMundo(j, u, b.cv);
    out.push({ x: w.x, y: w.y, r: h });
  }
  for (const p of j.partes) if (p.viva && p.clase !== 'casco') out.push({ ...posParte(j, p), r: p.r });
  return out;
}
/** Rough radius of the whole boss (for culling / spawn spacing). */
export function radioColision(j: Jefe): number {
  return j.tipo === 'dirigible' ? 125 : j.tipo === 'zepelin' ? 180 : 130;
}

/** True if a point (with margin m, e.g. a missile's fuse or a blast radius) touches the boss. */
export function tocado(j: Jefe, x: number, y: number, m = 3): boolean {
  if (j.muerto || j.muriendo >= 0) return false;
  if (Math.hypot(x - j.x, y - j.y) > radioColision(j) + m + 20) return false;
  const { u, v } = aLocal(j, fin(x), fin(y));
  if (dentroCuerpo(j, u, v, m)) return true;
  for (const p of j.partes) if (p.viva && p.clase !== 'casco' && Math.hypot(u - p.dx, v - p.dy) < p.r + m) return true;
  return false;
}
/** The plane (radius r) rams the body. */
export function choque(j: Jefe, x: number, y: number, r: number): boolean {
  if (j.muerto) return false;
  if (Math.hypot(x - j.x, y - j.y) > radioColision(j) + r + 20) return false;
  const { u, v } = aLocal(j, fin(x), fin(y));
  return dentroCuerpo(j, u, v, r * 0.6);
}

/* ── Damage ─────────────────────────────────────────────────────────────── */

function actualizarVulnerables(j: Jefe) {
  const nu = nucleo(j);
  if (j.tipo === 'dirigible') nu.vulnerable = vivas(j, 'torreta').length === 0 || j.ventana > 0 || j.fase === 3;
  else if (j.tipo === 'zepelin') nu.vulnerable = flakVivos(j) === 0 || j.ventana > 0 || j.fase === 3;
  else nu.vulnerable = vivas(j, 'generador').length === 0;
}

function herir(j: Jefe, u: number, v: number, peso: number) {
  for (const h of j.heridas) {
    if (Math.hypot(h.u - u, h.v - v) < 8) {
      h.s = Math.min(4, h.s + peso);
      return;
    }
  }
  if (j.heridas.length >= 40) {
    const h = j.heridas[Math.floor(azar(j) * j.heridas.length)];
    h.s = Math.min(4, h.s + peso);
    return;
  }
  j.heridas.push({ u: Math.round(u), v: Math.round(v), s: peso, sem: azar(j) });
}

/**
 * A hit of `danio` at world (x, y) (a missile: 2.5; call it once per blast).
 * It goes to the nearest live part within reach, else to the hull.
 */
export function golpear(j: Jefe, x: number, y: number, danio: number): ResultadoGolpe {
  if (j.muerto || j.muriendo >= 0) return {};
  let d = Math.max(0, fin(danio));
  if (d <= 0) return {};
  const { u, v } = aLocal(j, fin(x), fin(y));
  let mejor: ParteJefe | null = null;
  let md = Infinity;
  for (const p of j.partes) {
    if (!p.viva || p.clase === 'casco') continue;
    const dd = Math.hypot(u - p.dx, v - p.dy) - p.r;
    if (dd < 6 && dd < md) {
      md = dd;
      mejor = p;
    }
  }
  // Parts sunk in the hull still feel a hit on the plating, at 70 %: nearby on
  // the airship, anywhere on the saucer (seen from the side they're all inside it).
  if (!mejor) {
    for (const p of j.partes) {
      if (!p.viva || !p.vulnerable || p.clase === 'casco') continue;
      const dd = Math.hypot(u - p.dx, v - p.dy) - p.r;
      if (dd < (j.tipo === 'nodriza' ? Infinity : 50) && dd < md) {
        md = dd;
        mejor = p;
      }
    }
    if (mejor) d *= 0.7;
  }
  const out: ResultadoGolpe = {};
  if (mejor) {
    out.parte = mejor.nombre;
    if (!mejor.vulnerable) {
      out.bloqueado = true;
      mejor.flash = 0.08;
      j.escudoFlash = 0.35;
      // Armour still gets scuffed.
      herir(j, u, v, 0.3);
      return out;
    }
    const q = Math.min(d, mejor.hp);
    mejor.hp -= d;
    mejor.flash = 0.15;
    j.vida -= mejor.clase === 'nucleo' ? d : Math.max(q, d * 0.5);
    herir(j, u, v, 1);
    if (mejor.hp <= 0) {
      romper(j, mejor);
      out.destruida = true;
      out.puntos = PUNTOS_PARTE[mejor.clase];
    }
  } else {
    const casco = parteDe(j, 'casco');
    out.parte = 'casco';
    const f = j.tipo === 'dirigible' ? 0.7 : 0.6;
    casco.hp = Math.max(0, casco.hp - d * f);
    casco.flash = 0.12;
    j.vida -= d * f;
    herir(j, u, v, 1);
  }
  const nu = nucleo(j);
  if (j.vida <= 0 || !nu.viva) {
    j.vida = 0;
    morir(j);
    out.derrotado = true;
    out.puntos = (out.puntos ?? 0) + PUNTOS_JEFE[j.tipo];
  }
  return out;
}

function romper(j: Jefe, p: ParteJefe) {
  p.hp = 0;
  p.viva = false;
  p.vulnerable = false;
  p.rayo = undefined;
  p.aviso = 0;
  p.rafaga = 0;
  const w = posParte(j, p);
  j.cola.push({ explosion: { x: w.x, y: w.y, energia: p.clase === 'nucleo' ? 6 : 3 } });
  j.cola.push({ pieza: { x: w.x, y: w.y, vx: j.vx + (azar(j) - 0.5) * 120, vy: 40 + azar(j) * 80, nombre: p.nombre } });
  herir(j, p.dx, p.dy, 2);
  if (j.tipo === 'zepelin') {
    romperZepelin(j, p);
    actualizarVulnerables(j);
    return;
  }
  if (p.clase === 'helice') j.cola.push({ dialogo: '¡Perdimos una hélice! ¡Más lento, más lento!' });
  if (p.clase === 'generador' && vivas(j, 'generador').length === 0) j.cola.push({ dialogo: '¡Mi escudo! ¡Guardias, protéjanme!' });
  if (p.clase === 'torreta' && vivas(j, 'torreta').length === 0) j.cola.push({ dialogo: '¡Sin torretas! ¡Cierren la góndola!… ¡Ah, no cierra!' });
  if (j.tipo === 'nodriza' && p.clase === 'emisor') j.tractor.modo = 0;
  actualizarVulnerables(j);
}

function morir(j: Jefe) {
  if (j.muriendo >= 0) return;
  j.muriendo = 0;
  for (const p of j.partes) {
    p.rayo = undefined;
    p.aviso = 0;
    p.rafaga = 0;
  }
  j.tractor.modo = 0;
  j.cola.push({
    dialogo: j.tipo === 'dirigible' ? '¡Mi queso! ¡Abandonen la nave!' : j.tipo === 'zepelin' ? '¡Mi zepelín! ¡Me las van a pagar, ricachones $&#%!' : '¡Imposible! ¡Mi imperio!',
  });
  if (j.tipo === 'zepelin') {
    j.cola.push({ sonido: 'cae' });
    // The cells that aren't burning yet catch fire one by one, tail to nose.
    const frescas = j.partes.filter((q) => q.clase === 'celda' && q.arde === undefined).sort((a, b) => a.dx - b.dx);
    frescas.forEach((q, i) => (q.cd = 0.3 + i * 0.85));
    j.bombasPend = 0;
    j.minaAviso = 0;
  }
  const nu = nucleo(j);
  const w = posParte(j, nu);
  j.cola.push({ explosion: { x: w.x, y: w.y, energia: 6 } });
}

/** 0…1 life left (for the big bar). */
export function hpTotal(j: Jefe): number {
  return clamp(j.vida / Math.max(1, j.vidaMax), 0, 1);
}

/** One row per part for a detailed bar (the hull is left out). */
export function barras(j: Jefe): { nombre: string; clase: ClaseParte; frac: number; viva: boolean; vulnerable: boolean }[] {
  return j.partes.filter((p) => p.clase !== 'casco').map((p) => ({ nombre: p.nombre, clase: p.clase, frac: clamp(p.hp / p.hpMax, 0, 1), viva: p.viva, vulnerable: p.vulnerable }));
}

/**
 * Burning / smoking spots in the world for VFX.fuego (call every frame):
 * grows with the damage, and everything burns while it dies.
 */
export function focos(j: Jefe): { x: number; y: number; intensidad: number }[] {
  if (j.muerto) return [];
  const k = 1 - hpTotal(j);
  const out: { x: number; y: number; intensidad: number }[] = [];
  if (j.tipo === 'zepelin') {
    // Burning gas cells first: two big flames each.
    for (const p of j.partes) {
      if (p.clase !== 'celda' || p.arde === undefined) continue;
      const s = 0.8 + Math.min(0.4, p.arde * 0.1);
      out.push({ ...aMundoVis(j, p.dx - 12, -altoZ(p.dx) * 0.6), intensidad: s });
      out.push({ ...aMundoVis(j, p.dx + 10, -altoZ(p.dx) * 0.3), intensidad: s * 0.9 });
    }
  }
  for (const h of j.heridas) {
    const arde = j.muriendo >= 0 ? 1 : h.s >= 2 && k > 0.35 ? (h.s - 1) * 0.3 * (0.5 + k) : 0;
    if (arde > 0.05) out.push({ ...aMundoVis(j, h.u, h.v), intensidad: clamp(arde, 0, 1.2) });
  }
  for (const p of j.partes) if (!p.viva && p.clase !== 'casco' && p.clase !== 'celda') out.push({ ...aMundoVis(j, p.dx, p.dy), intensidad: 0.6 });
  return out.slice(0, 10);
}

/* ── One step ───────────────────────────────────────────────────────────── */

/**
 * Moves the boss and runs its attacks. `escoltasVivas` = how many escorts
 * (aerial enemies) are alive now, so it doesn't flood the sky.
 */
export function paso(j: Jefe, vista: Vista, dt: number, escoltasVivas = 0, cazasVivos = 0): ResultadoJefe {
  dt = clamp(fin(dt), 0, 0.1);
  j.x = fin(j.x);
  j.y = fin(j.y, 900);
  j.vx = fin(j.vx);
  j.vy = fin(j.vy);
  j.ang = fin(j.ang);
  j.giro = fin(j.giro, j.mira);
  if (j.muerto) return { muerto: true };
  j.t += dt;
  j.escudoFlash = Math.max(0, j.escudoFlash - dt);
  for (const p of j.partes) p.flash = Math.max(0, p.flash - dt);
  let res: ResultadoJefe = {};
  if (dt === 0) return res;

  if (j.muriendo >= 0) {
    pasoMuerte(j, vista, dt);
  } else {
    const f = hpTotal(j);
    const nueva: 1 | 2 | 3 = j.tipo !== 'nodriza' ? (f > 0.6 ? 1 : f > 0.3 ? 2 : 3) : f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
    if (nueva > j.fase) {
      j.fase = nueva;
      const w = aMundo(j, (azar(j) - 0.5) * 120, 0);
      j.cola.push({ explosion: { x: w.x, y: w.y, energia: 3 } });
      j.cola.push({
        dialogo:
          j.tipo === 'dirigible'
            ? nueva === 2 ? '¡Suelten los quesitos! ¡Y los abejorros!' : '¡Perdemos gas! ¡Todo a babor… o a estribor!'
            : j.tipo === 'zepelin'
            ? nueva === 2 ? '¡Muchachos, a sus cazas! ¡Denles una lección! $&#%' : '¡Se me quema el zepelín! ¡Y no tiene seguro! #$%&'
            : nueva === 2 ? '¡Rayo tractor! ¡Tráiganmelo!' : '¡Basta! ¡Fuego con todo!',
      });
      if (j.tipo === 'zepelin') j.cola.push({ sonido: 'cruje' });
    }
    actualizarVulnerables(j);
    res =
      j.tipo === 'dirigible' ? pasoDirigible(j, vista, dt, escoltasVivas)
      : j.tipo === 'zepelin' ? pasoZepelin(j, vista, dt, cazasVivos)
      : pasoNodriza(j, vista, dt, escoltasVivas);
  }
  if (j.tipo === 'zepelin') proyectilesZepelin(j, vista, dt, res);
  j.vx = fin(j.vx);
  j.vy = fin(j.vy);
  j.x = clamp(j.x + j.vx * dt, 60, 3540);
  j.y += j.vy * dt;
  if (j.muriendo < 0) {
    const [lo, hi] = ZONA[j.tipo];
    j.y = clamp(j.y, lo - (j.tipo === 'dirigible' ? 120 : j.tipo === 'zepelin' ? 140 : 0), hi);
  }
  if (j.cola.length) res.eventos = j.cola.splice(0);
  if (j.muerto) res.muerto = true;
  return res;
}

function seguir(j: Jefe, tx: number, ty: number, vMax: number, acel: number, dt: number) {
  let wx = (tx - j.x) * 0.8, wy = (ty - j.y) * 0.8;
  const m = Math.hypot(wx, wy);
  if (m > vMax) {
    wx *= vMax / m;
    wy *= vMax / m;
  }
  let ax = wx - j.vx, ay = wy - j.vy;
  const a = Math.hypot(ax, ay);
  const lim = acel * dt;
  if (a > lim) {
    ax *= lim / a;
    ay *= lim / a;
  }
  j.vx += ax;
  j.vy += ay;
}

function apuntarTiro(desde: { x: number; y: number }, vel: number, grav: boolean, av: Vista['avion'], err: number) {
  const sol = solucionTiro(desde, vel, av, grav);
  const ang = sol ? Math.atan2(sol.vy, sol.vx) : Math.atan2(av.y - desde.y, av.x - desde.x);
  return { vx: Math.cos(ang + err) * vel, vy: Math.sin(ang + err) * vel };
}

function pasoDirigible(j: Jefe, vista: Vista, dt: number, escoltas: number): ResultadoJefe {
  const av = vista.avion;
  const k = Math.min(1, dificultad(j.ola));
  const furia = j.fase === 3;
  const res: ResultadoJefe = {};
  const disparos: Disparo[] = [];
  const misiles: NonNullable<ResultadoJefe['misiles']> = [];

  // Turn to face the plane (slowly, it's a zeppelin).
  const quiere: 1 | -1 = av.x >= j.x ? 1 : -1;
  if (quiere !== j.mira) {
    j.girarT += dt;
    if (j.girarT > 1.4) {
      j.mira = quiere;
      j.girarT = 0;
    }
  } else j.girarT = 0;
  j.giro += clamp(j.mira - j.giro, -dt * 2, dt * 2);

  // Drift: keep a stand-off point on its side of the plane, a bit above it.
  const helices = vivas(j, 'helice').length;
  const fv = 0.3 + 0.7 * (helices / 2);
  const lado = j.x >= av.x ? 1 : -1;
  if (furia) j.hundir = Math.min(260, j.hundir + dt * 7);
  const tx = av.x + lado * 165;
  const ty = clamp(av.y + 55 - j.hundir, ZONA.dirigible[0], ZONA.dirigible[1]);
  const lejos = Math.hypot(tx - j.x, ty - j.y) > 430;
  seguir(j, tx, ty + Math.sin(j.t * 0.6) * 10, lejos ? 150 : 40 * fv, lejos ? 90 : 26 * fv, dt);
  if (furia) j.vy -= 4 * dt;
  const angT = clamp(-j.vy / 260, -0.05, 0.05) + (furia ? -0.13 * j.mira : -0.02 * (2 - helices) * j.mira);
  j.ang += (angT - j.ang) * Math.min(1, dt * 1.2);
  if (!av.vivo) return res;

  const dist = Math.hypot(av.x - j.x, av.y - j.y);

  // Gondola hatch: the captain opens it to shout (a window to hit him).
  if (vivas(j, 'torreta').length && !furia) {
    j.ventanaCd -= dt;
    if (j.ventanaCd <= 0 && j.ventana <= 0) {
      j.ventana = 3.5;
      j.ventanaCd = lerp(9, 7, k) + 3.5;
      if (azar(j) < 0.5) j.cola.push({ dialogo: ['¡Ríndete, gatito volador!', '¡Este cielo es de queso!', '¡Más rápido, tripulación!'][Math.floor(azar(j) * 3)] });
    }
  }
  j.ventana = Math.max(0, j.ventana - dt);

  // Flak turrets: blink, then a burst of 3 (4 in fury) pellets with lead.
  for (const p of vivas(j, 'torreta')) {
    const w = posParte(j, p);
    const dx = av.x - w.x, dy = av.y - w.y;
    p.ang = girar(p.ang, Math.atan2(dy, dx), 3 * dt);
    p.cd -= dt;
    if (p.rafaga > 0) {
      p.rafT -= dt;
      if (p.rafT <= 0) {
        const v = apuntarTiro(w, VEL_BALIN, true, av, (azar(j) - 0.5) * lerp(0.3, 0.18, k));
        const bx = w.x + Math.cos(p.ang) * 8, by = w.y + Math.sin(p.ang) * 8;
        disparos.push({ x: bx, y: by, vx: v.vx, vy: v.vy, tipo: 'balin' });
        p.rafaga--;
        p.rafT = 0.13;
      }
    } else if (p.aviso > 0) {
      p.aviso -= dt;
      if (p.aviso <= 0) {
        p.aviso = 0;
        p.rafaga = furia ? 4 : 3;
        p.rafT = 0;
      }
    } else if (p.cd <= 0 && Math.hypot(dx, dy) < 340) {
      p.aviso = 0.5;
      p.cd = lerp(3.6, 2.2, k) * (furia ? 0.7 : 1) + azar(j) * 0.8;
    }
  }

  // Missile racks, taking turns: the rack blinks 0.8 s, then launches.
  const lz = vivas(j, 'lanzador');
  j.misilCd -= dt;
  for (const p of lz) {
    p.ang = girar(p.ang, Math.atan2(av.y - j.y, av.x - j.x), 2 * dt);
    if (p.aviso > 0) {
      p.aviso -= dt;
      if (p.aviso <= 0) {
        p.aviso = 0;
        const w = posParte(j, p);
        const r = azar(j);
        const tipo: TipoMisil = j.ola < 3 ? 'buscador' : r < 0.45 ? 'buscador' : r < 0.75 ? 'zigzag' : 'dardo';
        if (furia) {
          misiles.push({ tipo, x: w.x, y: w.y, desvio: -0.3 });
          misiles.push({ tipo: 'buscador', x: w.x, y: w.y, desvio: 0.3 });
        } else misiles.push({ tipo, x: w.x, y: w.y, desvio: 0 });
      }
    }
  }
  if (lz.length && j.misilCd <= 0 && dist < 480 && !lz.some((p) => p.aviso > 0)) {
    const p = lz[j.siguienteLanzador++ % lz.length];
    p.aviso = AVISO_LASER;
    j.misilCd = lerp(6.5, 4.2, k) * (furia ? 0.8 : 1) + azar(j);
  }

  // Phase 2+: «quesitos bomba» (floating mines) from the belly hatch, and drone swarms.
  if (j.fase >= 2) {
    j.minaCd -= dt;
    if (j.minaAviso > 0) {
      j.minaAviso -= dt;
      if (j.minaAviso <= 0) {
        j.minaAviso = 0;
        const w = aMundo(j, 4, 56);
        const n = furia ? 2 : 1;
        for (let i = 0; i < n; i++) disparos.push({ x: w.x, y: w.y, vx: j.vx + (n > 1 ? (i ? 28 : -28) : clamp((av.x - w.x) * 0.1, -20, 20)), vy: -15, tipo: 'mina' });
      }
    } else if (j.minaCd <= 0 && Math.abs(av.x - j.x) < 320) {
      j.minaAviso = 0.5;
      j.minaCd = lerp(4.8, 3.2, k) * (furia ? 0.75 : 1);
    }
    j.escoltaCd -= dt;
    if (j.escoltaCd <= 0 && escoltas < 4) {
      const w = aMundo(j, -20, 34);
      res.escolta = [{ tipo: 'dron', x: w.x, y: w.y - 10 }];
      j.escoltaCd = furia ? 13 : 17;
    }
  }
  if (disparos.length) res.disparos = disparos;
  if (misiles.length) res.misiles = misiles;
  return res;
}

/* ── Mothership ─────────────────────────────────────────────────────────── */

function aSegmento(px: number, py: number, x0: number, y0: number, ang: number, L: number) {
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const s = clamp((px - x0) * ux + (py - y0) * uy, 0, L);
  const cx = x0 + ux * s, cy = y0 + uy * s;
  return { d: Math.hypot(px - cx, py - cy), x: cx, y: cy };
}

/** Where a cannon's beam starts (the muzzle), world. */
export function bocaCanon(j: Jefe, p: ParteJefe) {
  const w = posParte(j, p);
  return { x: w.x + Math.cos(p.ang) * 7, y: w.y + Math.sin(p.ang) * 7 };
}

function cargar(j: Jefe, p: ParteJefe, bx: number, by: number, barrido = 0) {
  const w = posParte(j, p);
  // Cannons hang under the rim: they can't aim above the horizon.
  const ang = clamp(Math.atan2(by - w.y, bx - w.x), -Math.PI + 0.12, -0.12);
  p.ang = ang;
  p.rayo = { modo: 1, t: AVISO_LASER, ang, largo: ALCANCE_LASER, acerto: false, barrido, bx, by };
}

function pasoNodriza(j: Jefe, vista: Vista, dt: number, escoltas: number): ResultadoJefe {
  const av = vista.avion;
  const k = Math.min(1, dificultad(j.ola));
  const res: ResultadoJefe = {};
  const disparos: Disparo[] = [];
  const rAvion = vista.radioAvion ?? 9;
  j.giro = j.mira = 1;

  // Hover above the plane, sliding side to side.
  const tx = av.x + Math.sin(j.t * 0.35) * 110;
  const ty = clamp(av.y + 150, ZONA.nodriza[0] + 30, ZONA.nodriza[1]);
  const lejos = Math.hypot(tx - j.x, ty - j.y) > 450;
  const tr = j.tractor;
  const quieta = tr.modo === 2 ? 0.5 : 1;
  seguir(j, tx, ty + Math.sin(j.t * 1.3) * 6, (lejos ? 190 : 70) * quieta, lejos ? 160 : 60, dt);
  const angT = clamp(-j.vx / 600, -0.08, 0.08) + (j.fase === 3 ? Math.sin(j.t * 2.1) * 0.03 : 0);
  j.ang += (angT - j.ang) * Math.min(1, dt * 2);

  const canones = vivas(j, 'canon');
  // Beams: aim (locked) → fire; a beam hits once.
  for (const p of canones) {
    const ry = p.rayo;
    if (!ry) {
      // Idle cannons follow the plane loosely.
      const w = posParte(j, p);
      p.ang = girar(p.ang, clamp(Math.atan2(av.y - w.y, av.x - w.x), -Math.PI + 0.12, -0.12), 1.5 * dt);
      continue;
    }
    ry.t -= dt;
    if (ry.modo === 1 || !ry.barrido) {
      // Keep the line on its locked point while the ship drifts.
      const w = posParte(j, p);
      ry.ang = p.ang = clamp(Math.atan2(ry.by - w.y, ry.bx - w.x), -Math.PI + 0.12, -0.12);
    }
    if (ry.modo === 1) {
      if (ry.t <= 0) {
        ry.modo = 2;
        ry.t = ry.barrido ? 1.2 : DUR_LASER;
      }
    } else {
      if (ry.barrido) {
        const w = posParte(j, p);
        ry.ang = girar(ry.ang, Math.atan2(av.y - w.y, av.x - w.x), Math.abs(ry.barrido) * dt);
        p.ang = ry.ang;
      }
      const b = bocaCanon(j, p);
      if (av.vivo && !ry.acerto && !res.laser) {
        const h = aSegmento(av.x, av.y, b.x, b.y, ry.ang, ry.largo);
        if (h.d < rAvion + 2.5) {
          ry.acerto = true;
          res.laser = { x: h.x, y: h.y };
        }
      }
      if (ry.t <= 0) p.rayo = undefined;
    }
  }
  if (!av.vivo) {
    for (const p of canones) p.rayo = undefined;
    tr.modo = 0;
    return res;
  }

  const ocupados = canones.filter((p) => p.rayo).length;
  const libres = canones.filter((p) => !p.rayo);
  j.patronCd -= dt;
  if (j.patronCd <= 0 && libres.length && tr.modo === 0) {
    const lead = AVISO_LASER + DUR_LASER * 0.4;
    const f = lerp(0.85, 1.02, k);
    const px = av.x + av.vx * lead * f, py = av.y + av.vy * lead * f;
    const abanico = j.fase >= 2 && j.patronN % (j.fase === 3 ? 2 : 3) === (j.fase === 3 ? 1 : 2) && ocupados === 0;
    if (abanico) {
      // All at once on a row of points 120 px apart: climb / dive along a gap.
      const orden = [...libres].sort((a, b) => a.dx - b.dx);
      const n = orden.length;
      const desf = (azar(j) - 0.5) * 100;
      orden.forEach((p, i) => cargar(j, p, av.x + desf + (i - (n - 1) / 2) * 120, av.y));
      j.patronCd = lerp(3.2, 2.6, k);
      if (j.patronN < 3) j.cola.push({ dialogo: '¡Abanico imperial!' });
    } else if (j.fase === 3 && libres.length >= 2 && ocupados === 0) {
      // A pair that starts BEHIND the plane and sweeps after it, slower than
      // it flies: keep going and it never catches you (arrows show the way).
      const dir = Math.abs(av.vx) > 15 ? Math.sign(av.vx) : av.x >= j.x ? 1 : -1;
      const a = libres[0], b = libres[libres.length - 1];
      cargar(j, a, av.x - dir * 60, av.y, dir * 0.22);
      cargar(j, b, av.x - dir * 120, av.y - 25, dir * 0.22);
      j.patronCd = lerp(3, 2.4, k);
    } else if (ocupados < (j.fase === 1 ? 2 : 3)) {
      // One after another, each at where the plane will be.
      const p = libres[j.patronN % libres.length];
      cargar(j, p, px, py);
      j.patronCd = j.fase === 1 ? lerp(1.8, 1.3, k) : lerp(1.6, 1.15, k);
    } else j.patronCd = 0.3;
    j.patronN++;
  }

  // Tractor beam from the central emitter (phase 2+).
  const em = parteDe(j, 'emisor');
  tr.cd -= dt;
  tr.atrapado = false;
  if (em.viva) {
    const w = posParte(j, em);
    const dx = av.x - w.x, dy = av.y - w.y;
    const dist = Math.hypot(dx, dy);
    const angAv = Math.atan2(dy, dx);
    if (tr.modo === 0 && j.fase >= 2 && tr.cd <= 0 && dist < LARGO_TRACTOR - 30 && dy < -50 && ocupados === 0) {
      tr.modo = 1;
      tr.t = AVISO_LASER;
      tr.ang = clamp(angAv, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    } else if (tr.modo === 1) {
      tr.t -= dt;
      tr.ang = girar(tr.ang, clamp(angAv, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5), 0.8 * dt);
      if (tr.t <= 0) {
        tr.modo = 2;
        tr.t = lerp(2.6, 3.2, k);
      }
    } else if (tr.modo === 2) {
      tr.t -= dt;
      tr.ang = girar(tr.ang, clamp(angAv, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6), lerp(0.9, 1.3, k) * dt);
      const dentro = dist < LARGO_TRACTOR && Math.abs(envolver(angAv - tr.ang)) < APERTURA_TRACTOR + Math.atan2(rAvion, Math.max(dist, 1));
      if (dentro) {
        tr.atrapado = true;
        const ux = -dx / (dist || 1), uy = -dy / (dist || 1);
        const tirar = lerp(90, 125, k), amort = lerp(1, 1.4, k);
        res.tractor = { fx: fin(ux * tirar - av.vx * amort), fy: fin(uy * tirar - av.vy * amort) };
        if (dist < 26 + rAvion) {
          if (!res.laser) res.laser = { x: av.x, y: av.y + 4 };
          tr.t = 0;
        }
      }
      if (tr.t <= 0) {
        tr.modo = 0;
        tr.cd = lerp(9, 6, k);
      }
    }
  } else tr.modo = 0;

  // Phase 3: the Emperor fires fans of rockets from the dome (it blinks first).
  if (j.fase === 3) {
    j.orbeCd -= dt;
    if (j.orbeAviso > 0) {
      j.orbeAviso -= dt;
      if (j.orbeAviso <= 0) {
        j.orbeAviso = 0;
        const w = aMundo(j, 0, -10);
        const v = apuntarTiro(w, VEL_COHETE, false, av, 0);
        const a0 = Math.atan2(v.vy, v.vx);
        for (let i = -2; i <= 2; i++) disparos.push({ x: w.x, y: w.y, vx: Math.cos(a0 + i * 0.22) * VEL_COHETE, vy: Math.sin(a0 + i * 0.22) * VEL_COHETE, tipo: 'cohete' });
      }
    } else if (j.orbeCd <= 0) {
      j.orbeAviso = 0.6;
      j.orbeCd = lerp(5, 3.6, k);
    }
  }

  // Escort saucers.
  j.escoltaCd -= dt;
  if (j.escoltaCd <= 0 && escoltas < (j.fase === 3 ? 3 : 2)) {
    const a = aMundo(j, -80, 10), b = aMundo(j, 80, 10);
    res.escolta = j.fase === 3 ? [{ tipo: 'ovni', ...a }, { tipo: 'ovni', ...b }] : [{ tipo: 'ovni', ...(azar(j) < 0.5 ? a : b) }];
    j.escoltaCd = lerp(16, 12, k);
  }
  if (disparos.length) res.disparos = disparos;
  return res;
}

/* ── Death ──────────────────────────────────────────────────────────────── */

const DUR_MUERTE: Record<TipoJefe, number> = { dirigible: 4.6, nodriza: 3.8, zepelin: 7.2 };

function pasoMuerte(j: Jefe, vista: Vista, dt: number) {
  const t0 = j.muriendo;
  j.muriendo += dt;
  const T = j.muriendo;
  const dur = DUR_MUERTE[j.tipo];
  // Chain explosions round the body, faster and bigger towards the end.
  const cada = lerp(0.32, 0.12, clamp(T / dur, 0, 1));
  if (Math.floor(T / cada) !== Math.floor(t0 / cada)) {
    const b = cuerpo(j);
    const u = (azar(j) * 2 - 1) * b.rx * 0.9, v = b.cv + (azar(j) * 2 - 1) * b.ry * 0.8;
    const w = aMundoVis(j, u, v);
    j.cola.push({ explosion: { x: w.x, y: w.y, energia: 1.5 + azar(j) * 2.5 } });
    herir(j, u, v, 1);
    if (azar(j) < 0.4) {
      const p = j.partes.filter((q) => q.viva && q.clase !== 'casco' && q.clase !== 'nucleo' && q.clase !== 'celda')[0];
      if (p) {
        p.viva = false;
        p.hp = 0;
        const w2 = posParte(j, p);
        j.cola.push({ pieza: { x: w2.x, y: w2.y, vx: j.vx + (azar(j) - 0.5) * 160, vy: 60 + azar(j) * 90, nombre: p.nombre } });
      } else {
        const nombres = j.tipo === 'nodriza' ? ['placa', 'luz', 'placa', 'cristal'] : ['aleta', 'tela', 'aleta', 'viga'];
        j.cola.push({ pieza: { x: w.x, y: w.y, vx: j.vx + (azar(j) - 0.5) * 160, vy: 50 + azar(j) * 90, nombre: nombres[Math.floor(azar(j) * 4)] } });
      }
    }
  }
  if (j.tipo === 'zepelin') {
    muerteZepelin(j, t0, T, dt);
  } else if (j.tipo === 'dirigible') {
    // Burns and falls nose first.
    j.vy -= 38 * dt;
    j.vx *= Math.exp(-0.6 * dt);
    j.ang += (-0.55 * j.mira - j.ang) * Math.min(1, dt * 0.7);
  } else {
    j.vy += (-22 - T * 14 - j.vy) * Math.min(1, dt * 2);
    j.vx *= Math.exp(-1.2 * dt);
    j.ang = Math.sin(T * 7) * 0.08 * Math.min(1, T) + Math.sin(T * 1.7) * 0.05;
  }
  const suelo = fin(vista.suelo(j.x));
  if (T >= dur || j.y < suelo + (j.tipo === 'zepelin' ? 45 : 25)) {
    // Final blast: three big ones and a rain of debris.
    const sep = j.tipo === 'zepelin' ? 100 : 60;
    for (let i = 0; i < 3; i++) {
      const w = aMundoVis(j, (i - 1) * sep, 0);
      j.cola.push({ explosion: { x: w.x, y: Math.max(w.y, suelo + 4), energia: i === 1 ? 10 : 6 } });
    }
    const nombres =
      j.tipo === 'dirigible' ? ['aleta', 'gondola', 'tela', 'helice1', 'viga']
      : j.tipo === 'zepelin' ? ['aleta', 'gondola', 'tela', 'motor1', 'viga']
      : ['cupula', 'placa', 'luz', 'placa', 'cristal'];
    for (let i = 0; i < nombres.length; i++) {
      const w = aMundo(j, (i - 2) * 40, 0);
      j.cola.push({ pieza: { x: w.x, y: w.y, vx: (i - 2) * 50 + j.vx * 0.5, vy: 70 + azar(j) * 80, nombre: nombres[i] } });
    }
    j.muerto = true;
  }
}

/* ── Drawing ────────────────────────────────────────────────────────────── */

const R = (g: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** Scanline-filled polygon (crisp pixel edges). */
function poly(g: Ctx, pts: number[][], c: string) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  g.fillStyle = c;
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.round(xs[i]), xb = Math.round(xs[i + 1]);
      if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
    }
  }
}

function lineaPx(g: Ctx, x0: number, y0: number, x1: number, y1: number, c: string, w = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  g.fillStyle = c;
  for (let i = 0; i <= n; i++) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n - (w - 1) / 2), Math.round(y0 + ((y1 - y0) * i) / n - (w - 1) / 2), w, w);
}

const frac = (x: number) => x - Math.floor(x);
const parpadeo = (t: number, hz: number) => Math.floor(t * hz) % 2 === 0;

type Lienzos = { cuerpo: HTMLCanvasElement; out: HTMLCanvasElement; blanco: HTMLCanvasElement };
const LIENZOS = new WeakMap<Jefe, Lienzos>();
const TAM: Record<TipoJefe, { w: number; h: number; ox: number; oy: number }> = {
  dirigible: { w: 270, h: 150, ox: 138, oy: 66 },
  nodriza: { w: 300, h: 150, ox: 150, oy: 82 },
  zepelin: { w: 390, h: 170, ox: 198, oy: 84 },
};

function lienzos(j: Jefe): Lienzos {
  let l = LIENZOS.get(j);
  if (!l) {
    const T = TAM[j.tipo];
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = T.w;
      c.height = T.h;
      return c;
    };
    l = { cuerpo: mk(), out: mk(), blanco: mk() };
    LIENZOS.set(j, l);
  }
  return l;
}

/** Compose the body: paint, ring it with the ink, optional char tint. */
function componer(j: Jefe, l: Lienzos, pintar: (g: Ctx) => void, quemado: number) {
  const T = TAM[j.tipo];
  const b = l.cuerpo.getContext('2d')!;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, T.w, T.h);
  b.translate(T.ox, T.oy);
  pintar(b);
  b.setTransform(1, 0, 0, 1, 0, 0);
  const o = l.out.getContext('2d')!;
  o.clearRect(0, 0, T.w, T.h);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) o.drawImage(l.cuerpo, dx, dy);
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = TINTA[j.tipo];
  o.fillRect(0, 0, T.w, T.h);
  o.globalCompositeOperation = 'source-over';
  o.drawImage(l.cuerpo, 0, 0);
  if (quemado > 0.01) {
    o.globalCompositeOperation = 'source-atop';
    o.globalAlpha = clamp(quemado, 0, 0.6);
    o.fillStyle = j.tipo === 'dirigible' ? '#6a2e2a' : '#2a1a4a';
    o.fillRect(0, 0, T.w, T.h);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
  }
}

function silueta(l: Lienzos, T: { w: number; h: number }) {
  const w = l.blanco.getContext('2d')!;
  w.clearRect(0, 0, T.w, T.h);
  w.drawImage(l.out, 0, 0);
  w.globalCompositeOperation = 'source-in';
  w.fillStyle = '#ffffff';
  w.fillRect(0, 0, T.w, T.h);
  w.globalCompositeOperation = 'source-over';
  return l.blanco;
}

/* Small pixel props */

function llama(g: Ctx, x: number, y: number, s: number, t: number, sem: number) {
  const f = Math.floor(t * 14 + sem * 7) % 3;
  const h = Math.round(3 + s * 2 + f);
  x = Math.round(x);
  y = Math.round(y);
  const w = Math.round(2 + s);
  R(g, x - w, y - 1, w * 2 + 1, 2, '#e0486a');
  R(g, x - w + 1, y - Math.round(h * 0.6), w * 2 - 1, Math.round(h * 0.6), '#ff9a3c');
  R(g, x - Math.max(1, w - 2), y - h, Math.max(2, w * 2 - 3), Math.round(h * 0.75), P.gold);
  R(g, x - (f % 2), y - h - 1 - (f === 2 ? 1 : 0), 2, 2, P.gold1);
  R(g, x - 1, y - Math.round(h * 0.4), 2, 2, P.white);
}

function chispa(g: Ctx, x: number, y: number, t: number, sem: number) {
  const f = Math.floor(t * 18 + sem * 11) % 6;
  if (f > 2) return;
  const c = f === 0 ? P.white : f === 1 ? '#8ff8e8' : P.gold;
  R(g, x, y, 1, 1, c);
  R(g, x - 1 - f, y - f, 1, 1, c);
  R(g, x + 1 + f, y - 1, 1, 1, c);
  R(g, x + f, y + 1 + f, 1, 1, c);
}

function exclamacion(g: Ctx, x: number, y: number, t: number) {
  if (!parpadeo(t, 10)) return;
  x = Math.round(x);
  y = Math.round(y);
  R(g, x - 1, y - 1, 5, 9, P.white);
  R(g, x - 1, y + 9, 5, 5, P.white);
  R(g, x, y, 3, 7, P.red);
  R(g, x, y + 10, 3, 3, P.red);
}

/** Rising smoke from a world point (screen coords). */
function humo(g: Ctx, x: number, y: number, t: number, sem: number, k: number, oscuro: boolean) {
  for (let i = 0; i < 5; i++) {
    const a = frac(t * 0.55 + i / 5 + sem);
    const r = Math.round(2 + a * 5 * (0.6 + k * 0.5));
    g.globalAlpha = (1 - a) * 0.55 * Math.min(1, k + 0.3);
    D.disc(g, x - a * 16 + Math.sin(a * 6 + sem * 9) * 3, y - a * 34 * (0.6 + k * 0.4), r, oscuro ? '#6a5a7a' : '#b8acc8');
    if (r > 3) D.disc(g, x - a * 16 + Math.sin(a * 6 + sem * 9) * 3 - 1, y - a * 34 * (0.6 + k * 0.4) - 1, r - 2, oscuro ? '#8a7a98' : '#dcd2e8');
  }
  g.globalAlpha = 1;
}

/* ── Dirigible art ─────────────────────────────────────────────────────── */

const Q = { q0: '#c8781a', q1: '#f0a830', q2: '#ffd04a', q3: '#ffe680', q4: '#fff6c0', hoyo: '#e09624', hoyo0: '#b8701a' };
const HOYOS: number[][] = [
  [-62, -9, 7, 4], [-30, 9, 9, 5], [4, -15, 6, 3], [40, 5, 7, 5], [72, -9, 4, 3], [-84, 10, 4, 3],
  [16, 19, 5, 2], [-10, -21, 4, 2], [56, -21, 4, 2], [86, 6, 3, 3], [-48, 20, 4, 2], [-90, -8, 3, 2], [20, -2, 3, 2],
];

function envolturaRy(u: number, ry: number) {
  // Fuller at the nose, tapering at the tail.
  const k = u / 102;
  return ry * Math.sqrt(Math.max(0, 1 - k * k)) * (k < 0 ? 1 + k * 0.18 : 1);
}

function pintarDirigible(g: Ctx, j: Jefe, t: number) {
  const k = 1 - hpTotal(j);
  const muriendo = j.muriendo >= 0;
  const furia = j.fase === 3 || muriendo;
  const desinfla = muriendo ? Math.min(1, 0.4 + j.muriendo / DUR_MUERTE.dirigible) : furia ? 0.4 : 0;

  // Tail fins (behind the envelope), red and cream stripes.
  const finC = (pts: number[][], roto: boolean) => {
    poly(g, pts, P.r1);
    poly(g, pts.map(([x, y]) => [x + 2, y * 0.82]), P.r2);
    if (!roto) {
      const mx = (pts[1][0] + pts[2][0]) / 2;
      lineaPx(g, mx + 3, pts[1][1] * 0.95, mx + 6, pts[0][1] * 0.95, P.cream, 2);
    }
  };
  const aletaArriba = !muriendo || j.muriendo < 1.5;
  if (aletaArriba) finC([[-80, -20], [-102, -44], [-116, -44], [-112, -12]], false);
  finC([[-80, 20], [-102, 44], [-116, 44], [-112, 12]], false);
  // Middle fin seen edge-on.
  poly(g, [[-86, -3], [-122, -7], [-122, 7], [-86, 3]], P.r1);
  R(g, -120, -1, 30, 2, P.r2);

  // Struts to the gondola and the engine nacelle.
  for (const u of [-14, 6, 26]) lineaPx(g, u, 24, u + 2, 37, P.k0);
  lineaPx(g, -60, 24, -66, 30, P.k0, 2);

  // Envelope: shadow, body, light, shine, layered.
  const ryB = 31 * (1 - desinfla * 0.12);
  for (let v = -Math.ceil(ryB); v <= Math.ceil(ryB); v++) {
    for (let u = -102; u <= 102; u += 1) {
      const h = envolturaRy(u, ryB);
      // The tail sags as it loses gas.
      const sag = desinfla * Math.max(0, -u - 20) * 0.08;
      const vv = v - sag;
      if (Math.abs(vv) > h) continue;
      const n = vv / Math.max(1, h); // -1 top … 1 bottom
      const c = n > 0.62 ? Q.q0 : n > 0.3 ? Q.q1 : n < -0.55 && u > -70 ? Q.q3 : Q.q2;
      g.fillStyle = c;
      g.fillRect(u, v, 1, 1);
    }
  }
  // Shine streak on top.
  R(g, -40, -26, 70, 2, Q.q4);
  R(g, -20, -28, 40, 1, P.white);
  R(g, 40, -23, 22, 1, Q.q4);
  // Panel seams.
  for (const u of [-75, -45, -15, 15, 45, 75]) {
    const h = envolturaRy(u, ryB) - 2;
    for (let v = -h; v < h; v += 1) if ((v | 0) % 5 !== 0) R(g, u, v + desinfla * Math.max(0, -u - 20) * 0.08, 1, 1, Q.q1);
  }
  // Cheese holes.
  for (const [hu, hv, rx, ry] of HOYOS) {
    const sag = desinfla * Math.max(0, -hu - 20) * 0.08;
    D.oval(g, hu, hv + sag, rx, ry, Q.hoyo);
    D.oval(g, hu, hv + sag - 1, rx - 1, Math.max(1, ry - 1), Q.hoyo0);
    R(g, hu - rx + 2, hv + sag + ry - 1, rx * 2 - 3, 1, Q.q3);
  }
  // Pink mouse emblem near the nose.
  D.disc(g, 52, 2, 9, P.p0);
  D.disc(g, 52, 2, 8, P.p3);
  D.disc(g, 52, 4, 4, P.p1);
  D.disc(g, 47, -1, 3, P.p1);
  D.disc(g, 57, -1, 3, P.p1);
  R(g, 51, 5, 3, 1, P.p0);
  // Nose cap.
  D.oval(g, 99, 0, 4, 7, P.k1);
  R(g, 100, -3, 2, 3, P.k3);

  // Wrinkles when deflating.
  if (desinfla > 0) {
    for (const u of [-70, -55, -38, -22]) {
      const sag = desinfla * Math.max(0, -u - 20) * 0.08;
      const h = envolturaRy(u, ryB) - 3;
      for (let v = -h; v < h; v += 2) R(g, u + ((v / 2) & 1), v + sag, 1, 2, Q.q0);
    }
  }

  // Wounds: torn fabric with scorched edges.
  for (const hd of j.heridas) {
    const sag = desinfla * Math.max(0, -hd.u - 20) * 0.08;
    const u = hd.u, v = hd.v + sag;
    if (hd.v > 30) continue;
    const s = hd.s;
    const r = Math.round(1 + s * 1.6);
    D.oval(g, u, v, r + 3, r + 1, '#d8862a');
    D.oval(g, u, v, r + 1, r, '#a8582a');
    // Jagged hole into the frame (deep rose, never black).
    const sem = Math.floor(hd.sem * 1000);
    for (let i = -r; i <= r; i++) {
      const hh = Math.max(0, Math.round((r - Math.abs(i)) * 0.8 + ((sem >> (i & 7)) & 1)));
      R(g, u + i, v - hh, 1, hh * 2 + 1, '#5a2a3a');
    }
    if (s >= 2) {
      // Ribs showing and a flap of cloth.
      R(g, u - r + 1, v, r * 2 - 1, 1, P.k1);
      R(g, u + r, v - r - 1, 2, r + 1, Q.q3);
      R(g, u + r + 1, v - r - 1, 1, 1, Q.q4);
    }
  }

  // Engine nacelle.
  const h1 = parteDe(j, 'helice1');
  D.oval(g, -64, 31, 9, 4, P.metal0);
  D.oval(g, -64, 30, 8, 3, '#b8aeec');
  R(g, -66, 28, 8, 1, P.s3);
  if (!h1.viva) {
    D.oval(g, -70, 31, 4, 3, '#5a3a4a');
    R(g, -73, 30, 2, 2, '#7a4a3a');
  }

  // Gondola: honey wood with portholes, the captain at the front window.
  const nu = nucleo(j);
  if (nu.viva || !muriendo) {
    D.oval(g, 8, 45, 30, 10, P.k0);
    D.oval(g, 8, 44, 29, 9, P.k1);
    R(g, -20, 37, 56, 3, P.k2);
    R(g, -18, 36, 52, 1, P.k3);
    R(g, -22, 46, 60, 2, P.k0);
    R(g, -18, 50, 52, 2, '#6a3a1a');
    for (const u of [-12, -2, 8]) {
      D.disc(g, u, 42, 3, P.k0);
      D.disc(g, u, 42, 2, P.gl1);
      R(g, u - 1, 41, 1, 1, P.gl2);
    }
    // Belly hatch for the cheese bombs.
    R(g, -2, 51, 12, 3, P.k0);
    R(g, -1, 51, 10, 2, P.metal0);
    // Front window.
    poly(g, [[16, 37], [34, 37], [38, 43], [38, 48], [16, 48]], P.k0);
    const abierta = j.ventana > 0 || (nu.vulnerable && j.fase === 3);
    poly(g, [[17, 38], [33, 38], [37, 43], [37, 47], [17, 47]], abierta ? '#fff0c0' : P.gl1);
    capitan(g, 26, 45, abierta, t);
    if (!abierta) {
      R(g, 30, 39, 3, 1, P.gl2);
      R(g, 33, 40, 1, 2, P.white);
      g.globalAlpha = 0.35;
      poly(g, [[17, 38], [33, 38], [37, 43], [37, 47], [17, 47]], P.gl2);
      g.globalAlpha = 1;
    }
    // Railing and a little flag.
    for (let u = -18; u <= 30; u += 6) R(g, u, 33, 1, 3, P.k0);
    R(g, -18, 33, 49, 1, P.k0);
    // Armour plates over the gondola while it can't be hurt.
    if (!nu.vulnerable) {
      // Armour: bars over the window and a riveted band.
      for (const u of [20, 25, 30, 35]) R(g, u, 38, 1, 10, P.metal0);
      R(g, 17, 42, 20, 1, P.metal0);
      R(g, -21, 47, 60, 3, P.metal0);
      R(g, -21, 47, 60, 1, P.metal);
      for (let u = -18; u < 38; u += 6) R(g, u, 48, 1, 1, P.white);
    }
    if (!nu.viva) D.oval(g, 10, 44, 14, 6, '#6a3a3a');
  }

  // Static parts: turret bases, missile racks (destroyed = burnt stumps).
  for (const p of j.partes) {
    if (p.clase === 'torreta') {
      const arriba = p.dy < 0;
      if (p.viva) {
        D.oval(g, p.dx, p.dy + (arriba ? 2 : -2), 8, 4, '#5a4a96');
        D.disc(g, p.dx, p.dy, 6, '#8064d8');
        D.disc(g, p.dx, p.dy - 1, 5, '#b49af4');
        R(g, p.dx - 3, p.dy - 4, 3, 1, '#e0d4ff');
        R(g, p.dx - 1, p.dy - 1, 3, 3, P.p1);
      } else {
        D.oval(g, p.dx, p.dy + (arriba ? 2 : -2), 7, 3, '#5a3a4a');
        R(g, p.dx - 4, p.dy - (arriba ? 2 : -1), 3, 2, '#7a4a3a');
        R(g, p.dx + 1, p.dy - (arriba ? 4 : -2), 2, 3, '#8a5a4a');
        lineaPx(g, p.dx + 2, p.dy - 2, p.dx + 8, p.dy + (arriba ? -5 : 5), '#5a4a6a');
      }
    } else if (p.clase === 'lanzador') {
      if (p.viva) {
        R(g, p.dx - 10, p.dy - 5, 20, 10, '#5a4a96');
        R(g, p.dx - 9, p.dy - 4, 18, 8, '#9a8ed8');
        for (let i = 0; i < 3; i++) {
          R(g, p.dx - 8, p.dy - 3 + i * 3, 15, 2, P.metal);
          R(g, p.dx + 7, p.dy - 3 + i * 3, 2, 2, P.r1);
        }
      } else {
        R(g, p.dx - 9, p.dy - 3, 14, 7, '#5a3a4a');
        R(g, p.dx - 7, p.dy - 1, 8, 2, '#8a5a4a');
        R(g, p.dx + 3, p.dy - 5, 2, 3, '#7a6a8a');
      }
    }
  }
}

/** The captain: a grey mouse with a navy cap and a gold monocle, looking right. (x, y) is his chest. */
function capitan(g: Ctx, x: number, y: number, fuera: boolean, t: number) {
  const ly = fuera ? Math.round(Math.sin(t * 8)) - 1 : 0;
  y += ly;
  // Coat.
  R(g, x - 5, y - 3, 10, 3, '#3a4a8a');
  R(g, x - 1, y - 3, 2, 3, P.gold);
  // Ears.
  D.disc(g, x - 5, y - 13, 3, '#a8a0bc');
  D.disc(g, x - 5, y - 13, 2, P.p2);
  // Head.
  D.oval(g, x, y - 8, 5, 4, '#c8c0d8');
  D.oval(g, x + 1, y - 8, 4, 3, '#e6e0f0');
  R(g, x + 5, y - 8, 2, 2, '#e6e0f0');
  R(g, x + 7, y - 8, 1, 1, P.p0);
  // Whiskers.
  R(g, x + 4, y - 6, 4, 1, P.white);
  R(g, x + 3, y - 5, 4, 1, P.white);
  // Eye with monocle and its chain.
  R(g, x + 2, y - 10, 1, 1, P.eye);
  R(g, x + 1, y - 12, 4, 1, P.gold);
  R(g, x + 1, y - 9, 4, 1, P.gold);
  R(g, x + 1, y - 11, 1, 2, P.gold);
  R(g, x + 4, y - 11, 1, 2, P.gold);
  R(g, x + 3, y - 11, 1, 1, P.white);
  R(g, x + 2, y - 8, 1, 1, P.gold0);
  R(g, x + 1, y - 7, 1, 1, P.gold0);
  R(g, x - 1, y - 6, 1, 1, P.blush);
  // Captain's cap.
  R(g, x - 4, y - 14, 8, 2, '#3a4a8a');
  R(g, x - 3, y - 15, 6, 1, '#5a6ab0');
  R(g, x + 3, y - 12, 4, 1, '#2a3060');
  R(g, x, y - 14, 2, 1, P.gold);
  if (fuera) {
    // Shaking a fist out of the window.
    const f = Math.round(Math.sin(t * 12) * 2);
    R(g, x + 6, y - 4 + f, 4, 3, '#c8c0d8');
    R(g, x + 9, y - 5 + f, 2, 2, '#e6e0f0');
  }
}

/* ── Mothership art ─────────────────────────────────────────────────────── */

const N = { v0: '#5a3a9a', v1: '#8a5ac8', v2: '#b49af4', v3: '#d4b8ff', v4: '#efe4ff', b0: '#3a2a7a', b1: '#6a4aa8' };

function pintarNodriza(g: Ctx, j: Jefe, t: number) {
  const muriendo = j.muriendo >= 0;
  // Generator pylons on top of the disc (behind the dome).
  for (const p of vivasYMuertas(j, 'generador')) {
    const x = p.dx, y = p.dy;
    if (p.viva) {
      R(g, x - 4, y + 2, 9, 6, N.b1);
      R(g, x - 3, y + 2, 7, 1, N.v2);
      poly(g, [[x, y - 9], [x + 5, y - 2], [x, y + 3], [x - 5, y - 2]], '#2eb08e');
      poly(g, [[x, y - 7], [x + 3, y - 2], [x, y + 1], [x - 3, y - 2]], '#8ff8e8');
      R(g, x - 1, y - 5, 1, 3, P.white);
    } else {
      R(g, x - 4, y + 3, 9, 5, '#4a3a5a');
      poly(g, [[x - 3, y + 3], [x - 1, y - 2], [x + 1, y + 1], [x + 3, y - 1], [x + 4, y + 3]], '#2a6a6a');
    }
  }
  // Dome glass (behind the emperor).
  const nu = nucleo(j);
  D.oval(g, 0, -24, 31, 28, '#3a88a8');
  D.oval(g, 0, -24, 30, 27, '#6ad0e0');
  D.oval(g, 1, -22, 27, 24, '#9ae8f0');
  emperador(g, 0, -5, t, nu.vulnerable, muriendo);
  // Glass shine and cracks.
  g.globalAlpha = 0.3;
  D.oval(g, 0, -24, 28, 25, '#d8fcff');
  g.globalAlpha = 1;
  R(g, -20, -40, 5, 2, P.white);
  R(g, -24, -35, 2, 5, P.white);
  R(g, -17, -44, 3, 1, P.white);
  const kc = 1 - nu.hp / nu.hpMax;
  if (kc > 0.15) {
    lineaPx(g, 8, -46, 14, -36, P.white);
    lineaPx(g, 14, -36, 11, -28, P.white);
    lineaPx(g, 14, -36, 22, -32, P.white);
  }
  if (kc > 0.5) {
    lineaPx(g, -12, -48, -18, -38, P.white);
    lineaPx(g, -18, -38, -12, -30, P.white);
    lineaPx(g, -18, -38, -26, -30, P.white);
    lineaPx(g, 2, -50, 0, -42, P.white);
  }
  // Antenna generator on top of the dome.
  const g3 = parteDe(j, 'generador3');
  R(g, -1, -54, 2, 6, N.b1);
  if (g3.viva) {
    poly(g, [[0, -66], [5, -59], [0, -52], [-5, -59]], '#2eb08e');
    poly(g, [[0, -64], [3, -59], [0, -54], [-3, -59]], '#8ff8e8');
    R(g, -1, -62, 1, 3, P.white);
  } else {
    R(g, -2, -56, 4, 2, '#4a3a5a');
    R(g, 1, -58, 2, 2, '#2a6a6a');
  }

  // Disc: lilac top, pink rim band, darker belly.
  D.oval(g, 0, 8, 123, 15, N.b0);
  D.oval(g, 0, 7, 122, 14, N.v1);
  D.oval(g, 0, 4, 121, 12, P.p1);
  D.oval(g, 0, 1, 118, 10, N.v2);
  D.oval(g, 0, -1, 110, 8, N.v3);
  R(g, -90, -4, 180, 1, N.v4);
  R(g, -60, -6, 120, 1, P.white);
  // Dome ring (gold) where glass meets the disc.
  D.oval(g, 0, -3, 32, 2, P.gold0);
  R(g, -30, -4, 60, 1, P.gold);
  R(g, -22, -5, 44, 1, P.gold1);
  // Rim band (where the lights sit).
  R(g, -118, 7, 236, 3, P.p0);
  R(g, -116, 7, 232, 1, P.p2);
  // Belly.
  D.oval(g, 0, 15, 92, 9, N.b0);
  D.oval(g, 0, 14, 90, 8, N.b1);
  R(g, -80, 11, 160, 1, '#8a6ac8');
  // Panel seams on the top.
  for (const u of [-96, -72, -48, 48, 72, 96]) R(g, u, -2, 1, 7, N.v2);
  for (const u of [-60, -30, 30, 60]) R(g, u, 12, 1, 6, N.v1);

  // Wounds: cracks with scorch.
  for (const h of j.heridas) {
    const u = h.u, v = h.v;
    if (v < -12) continue;
    const r = Math.round(2 + h.s * 1.6);
    g.globalAlpha = 0.6;
    D.oval(g, u, v, r + 2, Math.max(2, Math.round(r * 0.6)), '#3a2a5a');
    g.globalAlpha = 1;
    D.oval(g, u, v, Math.max(1, r - 1), Math.max(1, Math.round(r * 0.4)), '#4a2a4a');
    const sem = Math.floor(h.sem * 997);
    // Crack lines.
    let x = u, y = v;
    for (let i = 0; i < 2 + h.s * 2; i++) {
      const nx = x + (((sem >> i) & 1) ? 3 : -3), ny = y + (((sem >> (i + 3)) & 1) ? 1 : -1);
      lineaPx(g, x, y, nx, ny, '#2a1a4a');
      x = nx;
      y = ny;
    }
    if (h.s >= 2) R(g, u - 1, v - 1, 2, 1, '#ff7aa8');
  }

  // Cannon housings and the tractor emitter.
  for (const p of vivasYMuertas(j, 'canon')) {
    if (p.viva) {
      D.oval(g, p.dx, p.dy, 8, 5, N.b0);
      D.oval(g, p.dx, p.dy - 1, 7, 4, N.v1);
      R(g, p.dx - 4, p.dy - 3, 5, 1, N.v3);
    } else {
      D.oval(g, p.dx, p.dy - 1, 6, 3, '#3a2a4a');
      R(g, p.dx - 2, p.dy + 1, 2, 3, '#5a4a6a');
    }
  }
  const em = parteDe(j, 'emisor');
  if (em.viva) {
    D.oval(g, 0, 24, 13, 6, N.b0);
    D.oval(g, 0, 23, 12, 5, N.v1);
    D.oval(g, 0, 25, 7, 3, '#1a7a6a');
    D.oval(g, 0, 25, 5, 2, '#54d4a8');
  } else {
    D.oval(g, 0, 23, 11, 4, '#3a2a4a');
    R(g, -3, 25, 6, 2, '#2a4a4a');
  }
}

function vivasYMuertas(j: Jefe, c: ClaseParte) {
  return j.partes.filter((p) => p.clase === c);
}

/** The Mouse Emperor on his throne: crown, purple cape with ermine. (x, y) is the base of the throne. */
function emperador(g: Ctx, x: number, y: number, t: number, sinEscudo: boolean, muriendo: boolean) {
  // Throne back.
  R(g, x - 12, y - 30, 24, 30, '#a02a4a');
  R(g, x - 10, y - 28, 20, 26, P.r1);
  R(g, x - 12, y - 32, 4, 3, P.gold);
  R(g, x + 8, y - 32, 4, 3, P.gold);
  // Cape and ermine collar.
  poly(g, [[x - 11, y], [x - 7, y - 14], [x + 7, y - 14], [x + 11, y]], '#6a3aa8');
  poly(g, [[x - 9, y], [x - 6, y - 12], [x + 6, y - 12], [x + 9, y]], '#8a5ac8');
  R(g, x - 8, y - 15, 16, 3, P.white);
  for (const d of [-6, -2, 2, 6]) R(g, x + d, y - 14, 1, 1, '#3a2a5a');
  // Ears.
  D.disc(g, x - 8, y - 25, 4, '#a8a0bc');
  D.disc(g, x - 8, y - 25, 2, P.p2);
  D.disc(g, x + 8, y - 25, 4, '#a8a0bc');
  D.disc(g, x + 8, y - 25, 2, P.p2);
  // Head.
  D.oval(g, x, y - 19, 7, 5, '#c8c0d8');
  D.oval(g, x, y - 19, 6, 4, '#e6e0f0');
  R(g, x - 1, y - 16, 3, 2, P.p1);
  const enojado = sinEscudo || muriendo;
  // Eyes (angry brows when exposed).
  R(g, x - 4, y - 21, 2, 2, P.eye);
  R(g, x + 3, y - 21, 2, 2, P.eye);
  R(g, x - 4, y - 21, 1, 1, P.white);
  R(g, x + 3, y - 21, 1, 1, P.white);
  if (enojado) {
    R(g, x - 5, y - 23, 3, 1, '#5a3a4a');
    R(g, x + 3, y - 23, 3, 1, '#5a3a4a');
    R(g, x - 2, y - 14, 4, 1, P.r0);
  } else {
    R(g, x - 5, y - 18, 2, 1, P.blush);
    R(g, x + 4, y - 18, 2, 1, P.blush);
  }
  // Whiskers.
  R(g, x - 11, y - 17, 5, 1, P.white);
  R(g, x + 7, y - 17, 5, 1, P.white);
  // Crown with gems.
  const by = y - 27 + (muriendo ? Math.round(Math.sin(t * 20)) : 0);
  R(g, x - 6, by - 2, 13, 3, P.gold);
  R(g, x - 6, by - 5, 2, 3, P.gold);
  R(g, x - 1, by - 6, 3, 4, P.gold);
  R(g, x + 5, by - 5, 2, 3, P.gold);
  R(g, x - 6, by, 13, 1, P.gold0);
  R(g, x, by - 1, 1, 1, P.red);
  R(g, x - 4, by - 1, 1, 1, '#4a88d0');
  R(g, x + 4, by - 1, 1, 1, '#2eb08e');
  R(g, x, by - 7, 1, 1, P.gold1);
  // Scepter.
  R(g, x + 10, y - 20, 1, 14, P.gold0);
  D.disc(g, x + 10, y - 22, 2, '#ff8ac0');
  R(g, x + 9, y - 23, 1, 1, P.white);
}

const LUCES = ['#ff6a8a', '#ffe048', '#7af0c8', '#8ab8ff', '#ffb0f0'];

/* ── Public drawing ─────────────────────────────────────────────────────── */

/**
 * Draws the boss centred on screen (sx, sy) (screen y down), with its
 * beams, smoke and warnings. `flash` = white silhouette (whole-boss hit
 * flash); parts flash on their own when hit.
 */
export function dibujar(g: Ctx, j: Jefe, sx: number, sy: number, t: number, flash: boolean): void {
  if (j.muerto) return;
  const l = lienzos(j);
  const T = TAM[j.tipo];
  const k = 1 - hpTotal(j);
  const muriendo = j.muriendo >= 0;
  const quemado = muriendo ? 0.15 + (j.muriendo / DUR_MUERTE[j.tipo]) * 0.35 : 0;
  componer(j, l, (b) => (j.tipo === 'dirigible' ? pintarDirigible(b, j, t) : j.tipo === 'zepelin' ? pintarZepelin(b, j, t) : pintarNodriza(b, j, t)), quemado);

  const x0 = Math.round(sx), y0 = Math.round(sy);
  const angQ = Math.round(-j.ang / 0.03) * 0.03;
  const sacude = muriendo ? Math.round(Math.sin(t * 40) * 1.5) : 0;
  // Searchlight beams go under the hull.
  if (j.tipo === 'zepelin' && !muriendo) hacesZepelin(g, j, x0, y0);
  g.save();
  g.translate(x0 + sacude, y0);
  g.rotate(angQ);
  g.scale(Math.abs(j.giro) < 0.08 ? 0.08 * Math.sign(j.giro || 1) : j.giro, 1);
  const pintaCuerpo = () => {
    g.drawImage(flash ? silueta(l, T) : l.out, -T.ox, -T.oy);

    // Per-part hit flashes.
    for (const p of j.partes) {
      if (p.flash <= 0 || p.clase === 'casco') continue;
      g.globalAlpha = 0.85;
      D.disc(g, p.dx, p.dy, p.r, P.white);
      g.globalAlpha = 1;
    }
    if (j.tipo === 'dirigible') vivoDirigible(g, j, t);
    else if (j.tipo === 'zepelin') vivoZepelin(g, j, t, angQ);
    else vivoNodriza(g, j, t);

    // Fire on wounds (in the body's frame so it sticks to it).
    const nf = muriendo ? 99 : k > 0.35 ? Math.floor((k - 0.3) * 14) : 0;
    let n = 0;
    for (const h of j.heridas) {
      if (n >= nf) break;
      if (h.s < 2 && !muriendo) continue;
      if (j.tipo === 'nodriza' && h.v < -12) continue;
      n++;
      g.save();
      g.translate(h.u, h.v);
      g.scale(Math.sign(j.giro || 1), 1);
      g.rotate(-angQ);
      llama(g, 0, 0, Math.min(3, h.s * 0.7 + (muriendo ? 1 : 0)), t, h.sem);
      g.restore();
    }
  };
  if (j.tipo === 'zepelin' && j.roto >= 0) {
    // Broken in two: each half folds down around the break, a gap opening between them.
    const { a, gap } = pliegue(j);
    for (const lado of [1, -1]) {
      g.save();
      g.translate(CORTE + lado * gap, 0);
      g.rotate(lado * a);
      g.translate(-CORTE, 0);
      g.beginPath();
      if (lado > 0) g.rect(CORTE, -T.oy, T.w, T.h);
      else g.rect(-T.ox, -T.oy, CORTE + T.ox, T.h);
      g.clip();
      pintaCuerpo();
      bordeRoto(g, lado, t);
      g.restore();
    }
  } else pintaCuerpo();
  g.restore();

  // Smoke from wounds and stumps (screen space: it always rises).
  const fuentes: { u: number; v: number; s: number; sem: number; osc: boolean }[] = [];
  for (const h of j.heridas) if (h.s >= 1.5 || muriendo) fuentes.push({ ...h, osc: h.s >= 3 || muriendo });
  for (const p of j.partes) if (!p.viva && p.clase !== 'casco') fuentes.push({ u: p.dx, v: p.dy, s: 3, sem: p.dx * 0.013, osc: true });
  for (const f of fuentes.slice(0, muriendo ? 14 : 10)) {
    const w = aMundoVis(j, f.u, f.v);
    humo(g, x0 + (w.x - j.x), y0 - (w.y - j.y), t, f.sem, Math.min(1, f.s / 3 + k * 0.5), f.osc);
  }
  if (j.tipo === 'dirigible' && (j.fase === 3 || muriendo)) {
    // Gas escaping from the tears: pale puffs blown out sideways.
    for (const h of j.heridas.slice(0, 6)) {
      if (h.v > 28) continue;
      const w = aMundo(j, h.u, h.v);
      for (let i = 0; i < 3; i++) {
        const a = frac(t * 1.6 + i / 3 + h.sem);
        g.globalAlpha = (1 - a) * 0.7;
        D.disc(g, x0 + (w.x - j.x) + (h.sem < 0.5 ? -1 : 1) * a * 14, y0 - (w.y - j.y) - a * 5, Math.round(1 + a * 3), '#fff8e0');
      }
      g.globalAlpha = 1;
    }
  }

  // Beams and warnings.
  if (j.tipo === 'nodriza') rayosNodriza(g, j, x0, y0, t);
  if (j.tipo === 'zepelin') proyectilesDib(g, j, x0, y0, t);
  if (!muriendo) avisos(g, j, x0, y0, t);
  if (muriendo && j.muriendo > DUR_MUERTE[j.tipo] - 0.5) {
    // Building up to the final blast: a white core grows.
    const a = (j.muriendo - (DUR_MUERTE[j.tipo] - 0.5)) / 0.5;
    g.globalAlpha = 0.5 + a * 0.5;
    D.disc(g, x0, y0, Math.round(6 + a * 40), P.white);
    g.globalAlpha = 1;
  }
}

/** Animated live parts of the zeppelin, in its local frame. */
function vivoDirigible(g: Ctx, j: Jefe, t: number) {
  const { c, s } = { c: Math.cos(j.ang), s: Math.sin(j.ang) };
  const sg = j.giro < 0 ? -1 : 1;
  // World aim angle → local direction (u right, v down).
  const local = (a: number) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    return { u: (c * dx + s * dy) * sg, v: s * dx - c * dy };
  };
  for (const p of j.partes) {
    if (!p.viva) continue;
    if (p.clase === 'torreta') {
      const d = local(p.ang);
      lineaPx(g, p.dx + d.u * 2, p.dy + d.v * 2, p.dx + d.u * 10, p.dy + d.v * 10, '#3a2a7a', 3);
      lineaPx(g, p.dx + d.u * 2, p.dy + d.v * 2, p.dx + d.u * 9, p.dy + d.v * 9, P.metal, 1);
      if (p.aviso > 0 && parpadeo(t, 14)) {
        D.disc(g, p.dx + d.u * 10, p.dy + d.v * 10, 3, P.white);
        D.disc(g, p.dx + d.u * 10, p.dy + d.v * 10, 1, P.red);
      }
      if (p.rafaga > 0 && parpadeo(t, 24)) D.disc(g, p.dx + d.u * 12, p.dy + d.v * 12, 2, P.gold1);
    } else if (p.clase === 'lanzador' && p.aviso > 0) {
      const on = parpadeo(t, 12);
      for (let i = 0; i < 3; i++) R(g, p.dx + 7, p.dy - 3 + i * 3, 3, 2, on ? P.white : P.red);
      if (on) {
        g.globalAlpha = 0.5;
        D.disc(g, p.dx, p.dy, 12, P.red);
        g.globalAlpha = 1;
      }
    } else if (p.clase === 'helice') {
      // Pusher prop seen side-on: a blade that cycles in length.
      const f = Math.floor(t * 30 + p.dx) % 4;
      const L = Math.round(9 * [1, 0.6, 0.2, 0.6][f]);
      g.globalAlpha = 0.35;
      R(g, p.dx - 1, p.dy - 9, 2, 19, P.white);
      g.globalAlpha = 1;
      R(g, p.dx - 1, p.dy - L, 2, L * 2 + 1, '#5a4a6a');
      if (L > 2) R(g, p.dx - 1, p.dy - L + 1, 1, L * 2 - 1, P.metal);
      D.disc(g, p.dx + 1, p.dy, 2, P.metal0);
    }
  }
  // Mine hatch blinking.
  if (j.minaAviso > 0 && parpadeo(t, 12)) {
    R(g, -2, 51, 12, 3, P.white);
    D.disc(g, 4, 56, 3, P.gold);
    R(g, 4, 56, 1, 1, P.red);
  }
  // Weak point marker: a pulsing target ring on the open gondola.
  const nu = nucleo(j);
  if (nu.viva && nu.vulnerable && j.muriendo < 0) {
    const r = 17 + (Math.floor(t * 6) % 2);
    g.fillStyle = parpadeo(t, 4) ? P.gold : P.red;
    for (let a = 0; a < 16; a++) {
      if (a % 4 === 3) continue;
      const an = (a / 16) * Math.PI * 2 + t;
      g.fillRect(Math.round(nu.dx + Math.cos(an) * r), Math.round(nu.dy + Math.sin(an) * r * 0.6), 2, 2);
    }
  }
}

/** Animated live parts of the mothership (lights, shield, barrels). */
function vivoNodriza(g: Ctx, j: Jefe, t: number) {
  const muriendo = j.muriendo >= 0;
  const k = 1 - hpTotal(j);
  // Running rim lights; dead ones stay dark (more with damage).
  const n = 22;
  const paso_ = Math.floor(t * (j.fase === 3 ? 12 : 6));
  for (let i = 0; i < n; i++) {
    const u = Math.round(-112 + (224 * i) / (n - 1));
    const muerta = (i * 7) % 11 < k * 11 * 0.8 || (muriendo && Math.floor(t * 9 + i) % 3 === 0);
    if (muerta) {
      R(g, u - 1, 8, 3, 2, '#4a2a5a');
      continue;
    }
    const on = (paso_ + i) % 3 !== 0;
    const col = j.fase === 3 && !muriendo ? (paso_ % 2 ? P.red : P.white) : LUCES[(i + Math.floor(paso_ / 3)) % LUCES.length];
    R(g, u - 1, 8, 3, 2, on ? col : '#7a4a9a');
    if (on) R(g, u - 1, 8, 1, 1, P.white);
  }
  // Generator glow pulses.
  for (const p of vivasYMuertas(j, 'generador')) {
    if (!p.viva) {
      chispa(g, p.dx, p.dy, t, p.dx * 0.1);
      continue;
    }
    const top = p.nombre === 'generador3' ? -59 : p.dy - 2;
    if (parpadeo(t + p.dx * 0.01, 3)) R(g, p.dx - 1, top - 1, 2, 2, P.white);
  }
  // Cannon barrels.
  const c = Math.cos(j.ang), s = Math.sin(j.ang);
  const local = (a: number) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    return { u: c * dx + s * dy, v: s * dx - c * dy };
  };
  for (const p of vivasYMuertas(j, 'canon')) {
    if (!p.viva) {
      chispa(g, p.dx, p.dy + 2, t, p.dx * 0.07);
      continue;
    }
    const d = local(p.ang);
    lineaPx(g, p.dx, p.dy, p.dx + d.u * 9, p.dy + d.v * 9, N.b0, 4);
    lineaPx(g, p.dx, p.dy, p.dx + d.u * 8, p.dy + d.v * 8, N.v2, 2);
    const ry = p.rayo;
    if (ry) {
      const on = ry.modo === 2 || parpadeo(t, 6 + (1 - ry.t / AVISO_LASER) * 18);
      D.disc(g, p.dx + d.u * 9, p.dy + d.v * 9, ry.modo === 2 ? 3 : 2, on ? '#ff5a96' : P.white);
    }
  }
  // Dome blinking before the rocket fan.
  if (j.orbeAviso > 0 && parpadeo(t, 12)) {
    g.globalAlpha = 0.5;
    D.oval(g, 0, -24, 30, 27, P.red);
    g.globalAlpha = 1;
  }
  // Shield bubble while any generator stands.
  if (vivas(j, 'generador').length && !muriendo) {
    const fl = j.escudoFlash > 0;
    const r = 40 + Math.round(Math.sin(t * 3));
    const ry = r - 5;
    g.globalAlpha = fl ? 0.5 : 0.22;
    D.oval(g, 0, -26, r, ry, fl ? P.white : '#b8fff0');
    // Bright rim (hidden where it dips under the disc) and a second inner rim.
    g.fillStyle = fl ? P.white : '#e8fffa';
    for (let a = 0; a < 96; a++) {
      const an = (a / 96) * Math.PI * 2;
      if (Math.sin(an) > 0.5) continue;
      g.globalAlpha = fl ? 1 : (a + Math.floor(t * 10)) % 12 < 2 ? 0.35 : 0.9;
      g.fillRect(Math.round(Math.cos(an) * r), Math.round(-26 + Math.sin(an) * ry), 2, 2);
      if (a % 2 === 0) {
        g.globalAlpha = 0.45;
        g.fillRect(Math.round(Math.cos(an) * (r - 3)), Math.round(-26 + Math.sin(an) * (ry - 3)), 1, 1);
      }
    }
    // Hexagon cells drifting over the bubble.
    g.globalAlpha = fl ? 0.9 : 0.5;
    g.fillStyle = fl ? P.white : '#8ff8e8';
    for (let i = 0; i < 9; i++) {
      const an = -Math.PI * (0.12 + (i / 8) * 0.76);
      const cx = Math.round(Math.cos(an) * r * 0.72), cy = Math.round(-26 + Math.sin(an) * ry * 0.72);
      if ((i + Math.floor(t * 2)) % 3 === 0) continue;
      g.fillRect(cx - 2, cy - 3, 4, 1);
      g.fillRect(cx - 2, cy + 3, 4, 1);
      g.fillRect(cx - 4, cy - 2, 1, 2);
      g.fillRect(cx + 3, cy - 2, 1, 2);
      g.fillRect(cx - 4, cy + 1, 1, 2);
      g.fillRect(cx + 3, cy + 1, 1, 2);
    }
    g.globalAlpha = 1;
    // Hex sparkle.
    for (let i = 0; i < 6; i++) {
      const a = frac(t * 0.4 + i / 6);
      const an = i * 1.1 + 0.3;
      g.globalAlpha = 0.7 * (1 - a);
      R(g, Math.cos(an) * r * 0.7, -24 - Math.abs(Math.sin(an)) * r * 0.7 + a * 3, 2, 2, P.white);
    }
    g.globalAlpha = 1;
    // Feed lines from the generators to the bubble.
    for (const p of vivas(j, 'generador')) {
      const ty = p.nombre === 'generador3' ? -60 : p.dy - 8;
      for (let i = 0; i < 4; i++) {
        const a = frac(t * 2 + i / 4);
        R(g, p.dx * (1 - a * 0.4), ty - a * 6, 1, 1, '#c8fff4');
      }
    }
  }
}

/** Laser aim lines, beams and the tractor cone (screen space). */
function rayosNodriza(g: Ctx, j: Jefe, x0: number, y0: number, t: number) {
  for (const p of j.partes) {
    const ry = p.rayo;
    if (!ry || !p.viva) continue;
    const b = bocaCanon(j, p);
    const ox = x0 + (b.x - j.x), oy = y0 - (b.y - j.y);
    const ux = Math.cos(ry.ang), uy = -Math.sin(ry.ang);
    const L = ry.largo;
    if (ry.modo === 1) {
      const kk = 1 - clamp(ry.t / AVISO_LASER, 0, 1);
      const vel = 6 + kk * 18;
      if (Math.floor(t * vel) % 2 === 0 || kk > 0.85) {
        g.fillStyle = kk > 0.7 ? P.white : '#ff6a9a';
        for (let s = 4; s < L; s += 4) if ((s / 4 + Math.floor(t * 20)) % 2 < 1) g.fillRect(Math.round(ox + ux * s), Math.round(oy + uy * s), 2, 2);
      }
      if (ry.barrido) {
        // Arrow marks: which way the beam will sweep.
        const sgn = Math.sign(ry.barrido);
        g.fillStyle = '#ffb0d0';
        const nx = uy * sgn, ny = -ux * sgn;
        for (let i = 1; i <= 3; i++) {
          const s = 55 * i;
          // A little chevron beside the line, pointing the way it will sweep.
          const cx = ox + ux * s + nx * 8, cy = oy + uy * s + ny * 8;
          for (let q = 0; q < 4; q++) {
            g.fillRect(Math.round(cx + nx * q - ux * (3 - q)), Math.round(cy + ny * q - uy * (3 - q)), 2, 2);
            g.fillRect(Math.round(cx + nx * q + ux * (3 - q)), Math.round(cy + ny * q + uy * (3 - q)), 2, 2);
          }
        }
      }
      D.disc(g, ox, oy, Math.round(1 + kk * 3), '#ff7aa8');
      D.disc(g, ox, oy, Math.round(kk * 2), P.white);
    } else {
      const ex = ox + ux * L, ey = oy + uy * L;
      const f = Math.floor(t * 30) % 2;
      g.save();
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(255,74,138,0.35)';
      g.lineWidth = 11 + f * 2;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ex, ey);
      g.stroke();
      g.strokeStyle = '#ff5a96';
      g.lineWidth = 6;
      g.stroke();
      g.strokeStyle = f ? P.white : '#ffe4f0';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
      D.disc(g, ox, oy, 5, '#ff5a96');
      D.disc(g, ox, oy, 3, P.white);
    }
  }
  const tr = j.tractor;
  if (tr.modo && parteDe(j, 'emisor').viva) {
    const w = posParte(j, parteDe(j, 'emisor'));
    const ox = x0 + (w.x - j.x), oy = y0 - (w.y - j.y) + 3;
    const L = LARGO_TRACTOR;
    const a1 = tr.ang - APERTURA_TRACTOR, a2 = tr.ang + APERTURA_TRACTOR;
    if (tr.modo === 1) {
      if (parpadeo(t, 12)) {
        g.fillStyle = '#7af0c8';
        for (let s = 6; s < L; s += 5) for (const an of [a1, a2]) g.fillRect(Math.round(ox + Math.cos(an) * s), Math.round(oy - Math.sin(an) * s), 2, 2);
      }
    } else {
      const ux = Math.cos(tr.ang), uy = -Math.sin(tr.ang);
      const grad = g.createLinearGradient(ox, oy, ox + ux * L, oy + uy * L);
      grad.addColorStop(0, tr.atrapado ? 'rgba(160,255,220,0.6)' : 'rgba(122,240,200,0.45)');
      grad.addColorStop(1, 'rgba(122,240,200,0.04)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ox - 5, oy);
      g.lineTo(ox + Math.cos(a1) * L, oy - Math.sin(a1) * L);
      g.lineTo(ox + Math.cos(a2) * L, oy - Math.sin(a2) * L);
      g.lineTo(ox + 5, oy);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(220,255,245,0.85)';
      for (let i = 0; i < 6; i++) {
        const s = L * (1 - ((t * 0.9 + i / 6) % 1));
        const wdt = Math.tan(APERTURA_TRACTOR) * s;
        const cx = ox + ux * s, cy = oy + uy * s;
        for (let q = -wdt; q <= wdt; q += 3) g.fillRect(Math.round(cx - uy * q), Math.round(cy + ux * q), 2, 1);
      }
      g.fillStyle = '#c8fff0';
      for (let s = 4; s < L; s += 3) for (const an of [a1, a2]) g.fillRect(Math.round(ox + Math.cos(an) * s), Math.round(oy - Math.sin(an) * s), 1, 1);
    }
  }
}

function avisos(g: Ctx, j: Jefe, x0: number, y0: number, t: number) {
  // A "!" over whatever is about to fire.
  const marcas: { u: number; v: number }[] = [];
  for (const p of j.partes) if (p.viva && (p.aviso > 0 || p.rayo?.modo === 1)) marcas.push({ u: p.dx, v: p.dy - p.r - 14 });
  if (j.minaAviso > 0) marcas.push(j.tipo === 'zepelin' ? { u: -19, v: 50 } : { u: 4, v: 40 });
  if (j.orbeAviso > 0) marcas.push({ u: 0, v: -70 });
  if (j.tractor.modo === 1) marcas.push({ u: 0, v: 10 });
  for (const m of marcas.slice(0, 4)) {
    const w = aMundo(j, m.u, m.v);
    exclamacion(g, x0 + (w.x - j.x) - 1, y0 - (w.y - j.y), t);
  }
}

/* ── Debris sprites for VFX.pieza ───────────────────────────────────────── */

/** A small sprite of a torn-off piece (by part name, or 'aleta', 'tela', 'viga', 'placa', 'luz', 'cristal'). */
export function spritePieza(tipo: TipoJefe, nombre: string): HTMLCanvasElement {
  const base = nombre.replace(/\d+$/, '');
  return D.outlined(`jefe|pieza|${tipo}|${base}`, TINTA[tipo], 18, 16, 9, 8, (g) => {
    if (tipo === 'zepelin' && piezaZepelin(g, base)) return;
    switch (base) {
      case 'torreta':
        D.disc(g, 0, 0, 5, '#8064d8');
        D.disc(g, 0, -1, 4, '#b49af4');
        R(g, 3, -2, 5, 2, P.metal);
        break;
      case 'lanzador':
        R(g, -7, -4, 14, 8, '#9a8ed8');
        for (let i = 0; i < 3; i++) R(g, -6, -3 + i * 3, 11, 2, P.metal);
        break;
      case 'helice':
        R(g, -1, -7, 2, 14, P.metal);
        D.disc(g, 0, 0, 2, P.metal0);
        break;
      case 'gondola':
        D.oval(g, 0, 1, 8, 4, P.k1);
        R(g, -6, -2, 12, 2, P.k2);
        D.disc(g, -2, 1, 1, P.gl1);
        break;
      case 'aleta':
        poly(g, [[-6, 4], [2, -6], [7, -6], [6, 5]], P.r1);
        R(g, 1, -3, 4, 2, P.cream);
        break;
      case 'tela':
        poly(g, [[-7, -3], [6, -5], [7, 3], [-4, 5]], Q.q2);
        D.oval(g, 0, 0, 2, 1, Q.hoyo0);
        break;
      case 'viga':
        R(g, -7, -1, 14, 2, P.k1);
        R(g, -7, -1, 14, 1, P.k3);
        break;
      case 'canon':
        D.oval(g, 0, 0, 6, 4, N.v1);
        R(g, 2, 1, 6, 3, N.b0);
        break;
      case 'generador':
      case 'cristal':
        poly(g, [[0, -7], [4, -1], [0, 5], [-4, -1]], '#54d4a8');
        R(g, -1, -4, 1, 3, P.white);
        break;
      case 'emisor':
        D.oval(g, 0, 0, 7, 4, N.v1);
        D.oval(g, 0, 1, 4, 2, '#54d4a8');
        break;
      case 'cupula':
        D.oval(g, 0, 0, 7, 5, '#6ad0e0');
        R(g, -3, -3, 2, 1, P.white);
        break;
      case 'luz':
        D.disc(g, 0, 0, 2, P.p1);
        R(g, 0, -1, 1, 1, P.white);
        break;
      default:
        poly(g, [[-6, -3], [5, -5], [7, 2], [-3, 5]], N.v2);
        R(g, -3, -2, 6, 1, N.v4);
    }
  });
}

/* ── HUD bar ────────────────────────────────────────────────────────────── */

/**
 * The boss bar: name, the big life bar, and one pip per part (filled =
 * alive, dimmed = armoured/shielded, crossed = destroyed). (x, y) top-left.
 */
export function dibujarBarra(g: Ctx, j: Jefe, x: number, y: number, w: number, t: number): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.max(60, Math.round(w));
  const f = hpTotal(j);
  g.save();
  g.font = 'bold 8px "Fredoka", "Nunito", sans-serif';
  g.textBaseline = 'top';
  g.textAlign = 'left';
  const tinta = TINTA[j.tipo];
  const nombre = NOMBRE[j.tipo] + (j.fase === 3 && j.muriendo < 0 ? ' · ¡FURIA!' : '');
  // Placa crema propia, para que se lea sobre cualquier cielo (y sobre el queso).
  g.globalAlpha = 0.88;
  R(g, x - 5, y - 3, w + 10, 37, tinta);
  R(g, x - 4, y - 2, w + 8, 35, '#fff8e7');
  g.globalAlpha = 1;
  g.fillStyle = tinta;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillText(nombre, x + dx, y + dy);
  g.fillStyle = j.fase === 3 && parpadeo(t, 3) ? P.r3 : P.white;
  g.fillText(nombre, x, y);
  const by = y + 11;
  R(g, x - 1, by - 1, w + 2, 8, tinta);
  R(g, x, by, w, 6, '#4a3a5a');
  const lw = Math.round(w * f);
  const col = j.tipo !== 'nodriza' ? (f > 0.6 ? '#e0486a' : f > 0.3 ? '#ff9a3c' : P.red) : f > 0.66 ? '#b49af4' : f > 0.33 ? P.p1 : P.red;
  R(g, x, by, lw, 6, col);
  R(g, x, by, lw, 2, P.white);
  // Phase ticks.
  for (const th of j.tipo !== 'nodriza' ? [0.6, 0.3] : [0.66, 0.33]) R(g, x + Math.round(w * th), by, 1, 6, tinta);
  // Part pips.
  let px = x;
  const py = by + 9;
  const estrecho = barras(j).length > 10;
  for (const b of barras(j)) {
    const ancho = b.clase === 'nucleo' ? 14 : estrecho ? 6 : 8;
    R(g, px, py, ancho, 5, tinta);
    if (b.viva) {
      R(g, px + 1, py + 1, ancho - 2, 3, '#4a3a5a');
      R(g, px + 1, py + 1, Math.max(1, Math.round((ancho - 2) * b.frac)), 3, b.vulnerable ? (b.clase === 'nucleo' ? P.red : P.n2) : '#9a90b8');
      if (b.clase === 'nucleo' && !b.vulnerable) R(g, px + ancho / 2 - 1, py + 1, 2, 3, P.white);
    } else {
      R(g, px + 1, py + 1, ancho - 2, 3, '#6a4a5a');
      R(g, px + 2, py + 2, ancho - 4, 1, P.r1);
    }
    px += ancho + 2;
  }
  // Qué romper, en palabras.
  g.fillStyle = tinta;
  g.font = 'bold 7px "Fredoka", "Nunito", sans-serif';
  g.textAlign = 'right';
  const abierto = nucleo(j).vulnerable;
  g.fillText(j.tipo === 'dirigible' ? (abierto ? '¡Dale a la góndola!' : 'Rompe las torretas') : j.tipo === 'zepelin' ? (abierto ? '¡Dale a la góndola de Margarita!' : 'Rompe los antiaéreos de arriba') : abierto ? '¡Dale a la cúpula!' : 'Rompe los generadores', x + w, py - 1);
  g.restore();
}

/* ══ ZEPELÍN DE MARGARITA ═════════════════════════════════════════════════
 *
 * zepelin (storm map, ~400–900 px): a ~310×76 px rigid airship (1.5× the
 * cheese dirigible), lilac-silver doped fabric with red bands, cruciform
 * tail, and grumpy neighbour Margarita (red beanie, glasses) at the front
 * window of the control car, always shaking her fist.
 * Parts: 4 gas cells inside the hull (they soak hull hits; a destroyed one
 * BURNS for good and the ship sags and tilts towards it), 3 flak guns on top
 * (time-fused shells that burst in black puffs: radius RADIO_FLAK), a tail
 * machine gun (balín bursts), 3 engine nacelles (each lost one slows it), a
 * bomb bay (sticks of bombs, mostly when the plane is below it, and now and
 * then a carpet run on the ground anyway), 2 searchlights that sweep the sky
 * below it (while one holds the plane, flak aims ~40 % tighter and reloads
 * faster: break the lights or stay above / out of the beam), and the control
 * car (core): armoured until the 3 flak guns are down, except while
 * Margarita opens the window to insult you (3.5 s), and always in fase 3.
 *   Fase 1 (100–60 %): flak, tail gun, bombs, searchlights, 1 escort fighter.
 *   Fase 2 (60–30 %): up to 2 tough escort fighters (hp 4+), hull creaks.
 *   Fase 3 (<30 %, furia): nose down, sinking, faster flak (3 per salvo),
 *     longer bomb sticks, the car always open.
 *   Death (~7.2 s): the cells catch fire one by one (tail → nose, each a
 *   blast), the hull breaks in two at 3.6 s (V-fold, gap opening) and both
 *   halves fall in flames until they hit the ground or time runs out.
 * The flak shells, bombs and puffs are simulated and drawn here; motor only
 * needs `res.impacto` (damage), `eventos[].flak` (sound/flash) and
 * `eventos[].explosion` (bombs hitting the ground).
 */

const ZL = 155; // hull half-length
const ZR = 38; // hull half-height (cylinder part)
const CORTE = 4; // where the hull breaks in two (local u)
const T_ROMPE = 3.6;
const VEL_FLAK = 240;
const RADIO_FLAK = 18;
const ALCANCE_FLAK = 470;
const ALCANCE_FOCO = 420;
const HAZ = 0.11; // searchlight half-angle, rad
const GRAV_BOMBA = 170;
const Z = { z0: '#5a4e78', z1: '#8478a4', z2: '#aea4cc', z3: '#d0c8e4', z4: '#eeeaf8', fondo: '#4a3a5a', carbon: '#5a2a3a' };
const CARDIGAN = '#a898b8';
const PELO = '#d8d4e4';

/** Hull half-height at local u: ogive nose, cylinder, long tapered tail. */
function altoZ(u: number): number {
  const k = u / ZL;
  if (k >= 1 || k <= -1) return 0;
  if (k > 0.5) return ZR * Math.sqrt(Math.max(0, 1 - ((k - 0.5) / 0.5) ** 2));
  if (k < -0.35) return ZR * Math.sqrt(Math.max(0, 1 - Math.pow((-k - 0.35) / 0.65, 1.8)));
  return ZR;
}

function partesZepelin(): ParteJefe[] {
  return [
    parte('casco', 'casco', 0, 0, ZL, 120),
    parte('gondola', 'nucleo', 50, 52, 16, 55),
    parte('celda1', 'celda', -105, 0, 22, 16),
    parte('celda2', 'celda', -35, 0, 22, 16),
    parte('celda3', 'celda', 35, 0, 22, 16),
    parte('celda4', 'celda', 102, 0, 20, 16),
    parte('flak1', 'torreta', -82, -41, 8, 12),
    parte('flak2', 'torreta', 12, -43, 8, 12),
    parte('flak3', 'torreta', 96, -40, 8, 12),
    parte('metralla', 'torreta', -136, 24, 7, 9),
    parte('motor1', 'helice', -118, 44, 9, 10),
    parte('motor2', 'helice', -62, 48, 9, 10),
    parte('motor3', 'helice', 110, 44, 9, 10),
    parte('bodega', 'lanzador', -19, 40, 10, 14),
    parte('reflector1', 'reflector', 140, 21, 6, 6),
    parte('reflector2', 'reflector', -90, 38, 6, 6),
  ];
}

const esFlak = (p: ParteJefe) => p.nombre.startsWith('flak');
function flakVivos(j: Jefe) {
  return j.partes.filter((p) => p.viva && esFlak(p)).length;
}

/** The fold of the broken hull: angle of each half and the gap. */
function pliegue(j: Jefe) {
  const r = Math.max(0, j.roto);
  return { a: Math.min(0.55, r * 0.32), gap: Math.min(9, r * 7) };
}
/** Local point → local point on the (maybe broken) hull. */
function plegar(j: Jefe, u: number, v: number) {
  if (j.tipo !== 'zepelin' || j.roto < 0) return { u, v };
  const { a, gap } = pliegue(j);
  const du = u - CORTE;
  const c = Math.cos(a), s = Math.sin(a);
  return du >= 0 ? { u: CORTE + gap + du * c - v * s, v: du * s + v * c } : { u: CORTE - gap + du * c + v * s, v: -du * s + v * c };
}
/** Like aMundo, but follows the broken halves while the zeppelin falls apart. */
function aMundoVis(j: Jefe, u: number, v: number) {
  const q = plegar(j, u, v);
  return aMundo(j, q.u, q.v);
}

const decir = (j: Jefe, texto: string) => j.cola.push({ dialogo: texto });
const INSULTOS = [
  '¡Ricachones $&#%!',
  '¡Bájense de mi cielo! #%&@',
  '¡Ese ruido a la hora de la siesta! &%$#',
  '¡Les tiro la chancla desde aquí arriba! $#@!',
  '¡Voy a reclamar a la junta de vecinos! %&#',
  '¡En mis tiempos se volaba en silencio! #&%',
  '¡Ese avión ni siquiera tiene permiso! @#$%',
];

function romperZepelin(j: Jefe, p: ParteJefe) {
  j.cola.push({ sonido: 'cruje' });
  if (p.clase === 'celda') {
    p.arde = 0;
    const quedan = vivas(j, 'celda').length;
    decir(j, quedan === 3 ? '¡Me pincharon una celda! ¡Ricachones $&#%!' : quedan === 0 ? '¡Se queman todas! ¡Llamen a los bomberos! #&%$' : '¡Otra celda! ¡Esto me lo pagan! &%#@');
  } else if (p.clase === 'helice') decir(j, '¡Mi motor! ¡Lo estoy pagando en cuotas! &%$#');
  else if (p.clase === 'reflector') decir(j, '¡Me apagaron la luz! ¡Peor que la compañía eléctrica! @#$%');
  else if (p.clase === 'lanzador') {
    decir(j, '¡Mis bombas! ¡Las tenía para el gato del vecino! $#@');
    j.bombasPend = 0;
    j.minaAviso = 0;
  } else if (esFlak(p) && flakVivos(j) === 0) decir(j, '¡Sin cañones! ¡Ahora sí que me enojé! #%&@');
}

/** A flak shell at where the plane will be, give or take (much less in a searchlight). */
function lanzarFlak(j: Jefe, w: { x: number; y: number }, av: Vista['avion'], k: number, luz: boolean) {
  if (j.granadas.length >= 14) return;
  const lead = lerp(0.5, 0.8, k);
  let tx = av.x, ty = av.y;
  for (let i = 0; i < 3; i++) {
    const T = Math.hypot(tx - w.x, ty - w.y) / VEL_FLAK;
    tx = av.x + av.vx * T * lead;
    ty = av.y + av.vy * T * lead;
  }
  const err = lerp(60, 42, k) * (luz ? 0.6 : 1);
  const a = azar(j) * Math.PI * 2, r = err * (0.45 + 0.55 * azar(j));
  tx += Math.cos(a) * r;
  ty += Math.sin(a) * r;
  const d = Math.hypot(tx - w.x, ty - w.y);
  const ang = Math.atan2(ty - w.y, tx - w.x);
  j.granadas.push({ x: w.x + Math.cos(ang) * 9, y: w.y + Math.sin(ang) * 9, vx: Math.cos(ang) * VEL_FLAK, vy: Math.sin(ang) * VEL_FLAK, fuse: clamp(d / VEL_FLAK, 0.25, 2.2) });
}

function pasoZepelin(j: Jefe, vista: Vista, dt: number, cazas: number): ResultadoJefe {
  const av = vista.avion;
  const k = Math.min(1, dificultad(j.ola));
  const furia = j.fase === 3;
  const res: ResultadoJefe = {};
  const disparos: Disparo[] = [];
  const rAv = vista.radioAvion ?? 9;

  // Turns very slowly: it's huge.
  const quiere: 1 | -1 = av.x >= j.x ? 1 : -1;
  if (quiere !== j.mira) {
    j.girarT += dt;
    if (j.girarT > 2.2) {
      j.mira = quiere;
      j.girarT = 0;
    }
  } else j.girarT = 0;
  j.giro += clamp(j.mira - j.giro, -dt * 1.2, dt * 1.2);

  // Drift: a stand-off point to one side and above the plane; burnt cells make it sag.
  const motores = vivas(j, 'helice').length;
  const fv = 0.35 + 0.65 * (motores / 3);
  const lado = j.x >= av.x ? 1 : -1;
  let sesgo = 0;
  for (const c of j.partes) if (c.clase === 'celda' && !c.viva) sesgo += c.dx > 0 ? 0.03 : -0.03;
  const hundeObj = (4 - vivas(j, 'celda').length) * 45 + (furia ? 120 : 0);
  j.hundir += clamp(hundeObj - j.hundir, -dt * 10, dt * 12);
  const [lo, hi] = ZONA.zepelin;
  const tx = av.x + lado * 210;
  const ty = clamp(av.y + 90 - j.hundir, lo - 100, hi);
  const lejos = Math.hypot(tx - j.x, ty - j.y) > 480;
  seguir(j, tx, ty + Math.sin(j.t * 0.4) * 12, lejos ? 120 : 34 * fv, lejos ? 60 : 20 * fv, dt);
  const angT = clamp(-j.vy / 300, -0.04, 0.04) - sesgo * j.mira + (furia ? -0.1 * j.mira : 0) + Math.sin(j.t * 0.3) * 0.01;
  j.ang += (angT - j.ang) * Math.min(1, dt * 0.8);

  j.charlaCd = Math.max(0, j.charlaCd - dt);
  j.crujeCd -= dt;
  if (j.fase >= 2 && j.crujeCd <= 0) {
    j.cola.push({ sonido: 'cruje' });
    j.crujeCd = furia ? 3 + azar(j) * 3 : 5 + azar(j) * 5;
  }
  if (!av.vivo) {
    j.bombasPend = 0;
    return res;
  }
  const dist = Math.hypot(av.x - j.x, av.y - j.y);

  // The window: Margarita leans out to insult you (the car is open meanwhile).
  if (flakVivos(j) && !furia) {
    j.ventanaCd -= dt;
    if (j.ventanaCd <= 0 && j.ventana <= 0) {
      j.ventana = 3.5;
      j.ventanaCd = lerp(10, 7.5, k) + 3.5;
      if (azar(j) < 0.75) decir(j, INSULTOS[Math.floor(azar(j) * INSULTOS.length)]);
    }
  }
  j.ventana = Math.max(0, j.ventana - dt);

  // Searchlights: sweep the sky below; once one catches the plane it follows it a while.
  let ilum = false;
  for (const p of vivas(j, 'reflector')) {
    const w = posParte(j, p);
    const dx = av.x - w.x, dy = av.y - w.y;
    const d = Math.hypot(dx, dy);
    const aAv = Math.atan2(dy, dx);
    const dentro = d < ALCANCE_FOCO && dy < 0 && Math.abs(envolver(aAv - p.ang)) < HAZ + Math.atan2(rAv, Math.max(d, 1));
    if (dentro) p.rafT = 1.4;
    if (p.rafT > 0) {
      p.rafT -= dt;
      if (dy < 0) p.ang = girar(p.ang, aAv, lerp(0.7, 1, k) * dt);
    } else {
      const base = -Math.PI / 2 + Math.sin(j.t * 0.45 + p.dx * 0.05) * 1.05;
      p.ang = girar(p.ang, base, 0.55 * dt);
    }
    p.ang = clamp(p.ang, -Math.PI + 0.15, -0.15);
    if (dentro) ilum = true;
  }
  if (ilum && j.iluminado <= 0 && j.charlaCd <= 0) {
    decir(j, azar(j) < 0.5 ? '¡Te vi, ricachón! ¡Fuego! $#&%' : '¡Ahí está! ¡Alumbren, alumbren! #%&');
    j.charlaCd = 12;
  }
  j.iluminado = ilum ? 0.4 : Math.max(0, j.iluminado - dt);
  const luz = j.iluminado > 0;

  // Flak guns (blink, then a salvo of time-fused shells) and the tail machine gun.
  j.patronCd -= dt;
  for (const p of vivas(j, 'torreta')) {
    const w = posParte(j, p);
    const dx = av.x - w.x, dy = av.y - w.y;
    p.ang = girar(p.ang, Math.atan2(dy, dx), 2.5 * dt);
    p.cd -= dt * (luz ? 1.35 : 1);
    const ametralladora = !esFlak(p);
    if (p.rafaga > 0) {
      p.rafT -= dt;
      if (p.rafT <= 0) {
        if (ametralladora) {
          const v = apuntarTiro(w, VEL_BALIN, true, av, (azar(j) - 0.5) * lerp(0.3, 0.18, k));
          disparos.push({ x: w.x + Math.cos(p.ang) * 8, y: w.y + Math.sin(p.ang) * 8, vx: v.vx, vy: v.vy, tipo: 'balin' });
          p.rafT = 0.11;
        } else {
          lanzarFlak(j, w, av, k, luz);
          p.rafT = 0.28;
        }
        p.rafaga--;
      }
    } else if (p.aviso > 0) {
      p.aviso -= dt;
      if (p.aviso <= 0) {
        p.aviso = 0;
        p.rafaga = ametralladora ? (furia ? 5 : 4) : furia ? 3 : 2;
        p.rafT = 0;
      }
    } else if (p.cd <= 0 && Math.hypot(dx, dy) < (ametralladora ? 330 : ALCANCE_FLAK) && (ametralladora || j.patronCd <= 0)) {
      // Flak guns take turns (one salvo every ~2 s at most): readable, not a wall.
      if (!ametralladora) j.patronCd = lerp(2.3, 1.8, k) * (furia ? 0.8 : 1);
      p.aviso = 0.55;
      p.cd = (ametralladora ? lerp(3.2, 2, k) : lerp(5, 3.6, k)) * (furia ? 0.75 : 1) + azar(j);
    }
  }

  // Bomb bay: a stick when the plane is below it; a carpet run on the ground now and then anyway.
  const bodega = parteDe(j, 'bodega');
  j.minaCd -= dt;
  if (bodega.viva) {
    if (j.minaAviso > 0) {
      j.minaAviso -= dt;
      if (j.minaAviso <= 0) {
        j.minaAviso = 0;
        j.bombasPend = furia ? 6 : 4;
        j.bombaT = 0;
      }
    } else if (j.bombasPend > 0) {
      j.bombaT -= dt;
      if (j.bombaT <= 0 && j.bombas.length < 12) {
        const w = aMundo(j, -19, 46);
        j.bombas.push({ x: w.x, y: w.y, vx: j.vx + (azar(j) - 0.5) * 14, vy: -20, t: 0 });
        j.bombasPend--;
        j.bombaT = 0.2;
      }
    } else if (j.minaCd <= 0) {
      const debajo = av.y < j.y - 30 && Math.abs(av.x - j.x) < 260;
      if (debajo || j.minaCd < -lerp(6, 4, k)) {
        j.minaAviso = 0.7;
        j.minaCd = lerp(4, 3, k) * (furia ? 0.75 : 1);
      }
    }
  }

  // Tough escort fighters, launched from under the hull.
  j.cazaCd -= dt;
  const maxCazas = j.fase === 1 ? 1 : 2;
  if (j.cazaCd <= 0 && cazas < maxCazas && dist < 900) {
    const n = j.fase === 3 && cazas === 0 ? 2 : 1;
    const hp = 4 + Math.min(2, Math.max(0, j.ola - 4) * 0.2);
    res.cazas = [];
    for (let i = 0; i < n; i++) {
      const w = aMundo(j, -30 + i * 44, 60);
      res.cazas.push({ x: w.x, y: w.y - 6, haciaDerecha: av.x > w.x, hp });
    }
    j.cazaCd = j.fase === 1 ? lerp(24, 20, k) : j.fase === 2 ? lerp(18, 15, k) : lerp(15, 12, k);
    if (j.charlaCd <= 0 && azar(j) < 0.6) {
      decir(j, azar(j) < 0.5 ? '¡Muchachos, a ellos! ¡Sin piedad! &%$#' : '¡Ahí van mis sobrinos! ¡Denles duro! $#@%');
      j.charlaCd = 8;
    }
  }
  if (disparos.length) res.disparos = disparos;
  return res;
}

/** Flak shells, bombs and puffs in flight (also while it dies). */
function proyectilesZepelin(j: Jefe, vista: Vista, dt: number, res: ResultadoJefe) {
  const av = vista.avion;
  const rAv = vista.radioAvion ?? 9;
  const pega = (x: number, y: number) => {
    if (!res.impacto) res.impacto = { x, y };
  };
  for (let i = j.granadas.length - 1; i >= 0; i--) {
    const q = j.granadas[i];
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.fuse -= dt;
    const contacto = av.vivo && Math.hypot(av.x - q.x, av.y - q.y) < rAv + 3;
    if (q.fuse > 0 && !contacto && q.y > fin(vista.suelo(q.x)) + 4) continue;
    j.granadas.splice(i, 1);
    if (j.nubes.length >= 16) j.nubes.shift();
    j.nubes.push({ x: q.x, y: q.y, t: 0, sem: azar(j) });
    j.cola.push({ flak: { x: q.x, y: q.y } });
    if (av.vivo && Math.hypot(av.x - q.x, av.y - q.y) < RADIO_FLAK + rAv) pega(av.x, av.y);
  }
  for (let i = j.nubes.length - 1; i >= 0; i--) {
    const n = j.nubes[i];
    n.t += dt;
    n.y += 6 * dt;
    if (n.t > 1.8) j.nubes.splice(i, 1);
  }
  for (let i = j.bombas.length - 1; i >= 0; i--) {
    const b = j.bombas[i];
    b.vy -= GRAV_BOMBA * dt;
    b.vx *= Math.exp(-0.3 * dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.t += dt;
    if (av.vivo && Math.hypot(av.x - b.x, av.y - b.y) < rAv + 4) {
      j.cola.push({ explosion: { x: b.x, y: b.y, energia: 2 } });
      pega(b.x, b.y);
      j.bombas.splice(i, 1);
      continue;
    }
    const s = fin(vista.suelo(b.x));
    if (b.y <= s + 2) {
      j.cola.push({ explosion: { x: b.x, y: s + 2, energia: 3.5 } });
      if (av.vivo && Math.hypot(av.x - b.x, av.y - s) < 40 + rAv) pega(av.x, av.y);
      j.bombas.splice(i, 1);
    } else if (b.t > 12) j.bombas.splice(i, 1);
  }
}

/** Death: cells catch fire one by one, the hull snaps, both halves fall burning. */
function muerteZepelin(j: Jefe, t0: number, T: number, dt: number) {
  for (const c of j.partes) {
    if (c.clase !== 'celda') continue;
    if (c.arde !== undefined) {
      c.arde += dt;
      continue;
    }
    if (T >= c.cd) {
      c.arde = 0;
      c.viva = false;
      c.hp = 0;
      const w = aMundoVis(j, c.dx, c.dy);
      j.cola.push({ explosion: { x: w.x, y: w.y, energia: 3.5 } });
      j.cola.push({ pieza: { x: w.x, y: w.y, vx: j.vx + (azar(j) - 0.5) * 120, vy: 60 + azar(j) * 60, nombre: 'tela' } });
      if (azar(j) < 0.6) j.cola.push({ sonido: 'cruje' });
      herir(j, c.dx, -10, 2);
    }
  }
  if (t0 < T_ROMPE && T >= T_ROMPE) {
    j.roto = 0;
    const w = aMundo(j, CORTE, 0);
    j.cola.push({ explosion: { x: w.x, y: w.y, energia: 7 } });
    j.cola.push({ sonido: 'cruje' });
    j.cola.push({ dialogo: '¡Se parte! ¡Mi zepelín se parte! #&%$' });
    for (let i = 0; i < 3; i++) j.cola.push({ pieza: { x: w.x, y: w.y, vx: (i - 1) * 70, vy: 50 + azar(j) * 60, nombre: 'viga' } });
  }
  if (j.roto >= 0) {
    j.roto += dt;
    j.vy -= 55 * dt;
    j.ang += (-0.05 * j.mira - j.ang) * Math.min(1, dt);
  } else {
    j.vy += (-14 - j.vy) * Math.min(1, dt * 0.8);
    j.ang += (-0.14 * j.mira - j.ang) * Math.min(1, dt * 0.6);
  }
  j.vx *= Math.exp(-0.5 * dt);
}

/* ── Zepelin art ─────────────────────────────────────────────────────────── */

let CASCO_Z: HTMLCanvasElement | null = null;
/** The bare hull and fins never change: painted once, reused by every zeppelin. */
function cascoZepelin(): HTMLCanvasElement {
  if (CASCO_Z) return CASCO_Z;
  const T = TAM.zepelin;
  const c = document.createElement('canvas');
  c.width = T.w;
  c.height = T.h;
  const g = c.getContext('2d')!;
  g.translate(T.ox, T.oy);
  // Cruciform tail fins (red with cream stripes, Margarita's colours).
  const aleta = (pts: number[][]) => {
    poly(g, pts, P.r0);
    poly(g, pts.map(([x, y]) => [x + 2, y * 0.84]), P.r1);
    const mx = (pts[1][0] + pts[2][0]) / 2;
    lineaPx(g, mx + 4, pts[1][1] * 0.92, mx + 9, pts[0][1] * 0.9, P.cream, 2);
  };
  aleta([[-112, -30], [-146, -60], [-172, -60], [-168, -14]]);
  aleta([[-112, 30], [-146, 60], [-172, 60], [-168, 14]]);
  poly(g, [[-118, -3], [-180, -6], [-180, 6], [-118, 3]], Z.z0);
  R(g, -178, -1, 56, 2, Z.z1);
  R(g, -180, -6, 8, 12, P.r0);
  // Hull, row by row.
  for (let u = -ZL; u <= ZL; u++) {
    const h = altoZ(u);
    for (let v = -Math.floor(h); v <= Math.floor(h); v++) {
      const n = v / Math.max(1, h);
      g.fillStyle = n < -0.72 && u > -125 ? Z.z4 : n < -0.3 ? Z.z3 : n < 0.3 ? Z.z2 : n < 0.68 ? Z.z1 : Z.z0;
      g.fillRect(u, v, 1, 1);
    }
  }
  // Longitudinal stringers and the frame rings.
  for (let u = -ZL + 6; u < ZL - 4; u++) {
    const h = altoZ(u);
    if (u % 2 === 0) {
      R(g, u, Math.round(-h * 0.5), 1, 1, Z.z2);
      R(g, u, Math.round(h * 0.5), 1, 1, Z.z0);
    }
  }
  for (let u = -140; u <= 140; u += 14) {
    const h = altoZ(u) - 1;
    const fuerte = u % 70 === 0;
    for (let v = -h; v < h; v++) if (fuerte || (Math.round(v) & 1)) R(g, u, v, 1, 1, fuerte ? Z.z1 : Z.z1);
    if (fuerte) for (let v = -h; v < h; v += 2) R(g, u + 1, v, 1, 1, Z.z3);
  }
  // Shine along the top.
  R(g, -100, -33, 190, 2, Z.z4);
  R(g, -60, -35, 120, 1, P.white);
  // Red bands near nose and tail.
  for (const [u0, w] of [[118, 5], [-116, 5]]) {
    for (let u = u0; u < u0 + w; u++) {
      const h = altoZ(u);
      R(g, u, -h, 1, h * 2 + 1, P.r1);
      R(g, u, -h, 1, Math.max(1, h * 0.5), P.r2);
      R(g, u, h * 0.6, 1, h * 0.4 + 1, P.r0);
    }
  }
  // Nose cap.
  for (let u = 146; u <= ZL; u++) {
    const h = altoZ(u);
    R(g, u, -h, 1, h * 2 + 1, P.metal0);
    if (h > 2) R(g, u, -h + 1, 1, Math.max(1, h * 0.6), P.metal);
  }
  // Emblem: a red beanie on a cream roundel.
  D.disc(g, -35, 2, 12, P.r0);
  D.disc(g, -35, 2, 11, P.cream);
  D.oval(g, -35, 3, 7, 5, P.r0);
  D.oval(g, -35, 2, 6, 4, P.r1);
  R(g, -43, 5, 17, 3, P.r0);
  for (let u = -42; u < -27; u += 2) R(g, u, 5, 1, 1, P.r2);
  D.disc(g, -35, -4, 2, P.r2);
  R(g, -36, -5, 1, 1, P.white);
  return (CASCO_Z = c);
}

function pintarZepelin(g: Ctx, j: Jefe, t: number) {
  const T = TAM.zepelin;
  g.drawImage(cascoZepelin(), -T.ox, -T.oy);
  const muriendo = j.muriendo >= 0;

  // Burnt gas cells: the fabric is gone, girders show, embers glow.
  for (const c of j.partes) {
    if (c.clase !== 'celda' || c.arde === undefined) continue;
    const h = altoZ(c.dx) - 3;
    const ext = Math.min(1, 0.55 + c.arde * 0.25);
    D.oval(g, c.dx, 0, Math.round(28 * ext) + 2, Math.round(h * ext) + 1, '#7a4a5a');
    D.oval(g, c.dx, 0, Math.round(26 * ext), Math.round(h * ext - 1), Z.carbon);
    for (const du of [-14, 0, 14]) R(g, c.dx + du, -h * ext + 2, 1, h * ext * 2 - 4, '#8a6a7a');
    lineaPx(g, c.dx - 18 * ext, -h * 0.6 * ext, c.dx + 18 * ext, h * 0.6 * ext, '#8a6a7a');
    lineaPx(g, c.dx - 18 * ext, h * 0.6 * ext, c.dx + 18 * ext, -h * 0.6 * ext, '#8a6a7a');
    for (let i = 0; i < 6; i++) {
      if (parpadeo(t + i * 0.13 + c.dx * 0.01, 5)) R(g, c.dx - 16 + ((i * 7) % 32), -8 + ((i * 11) % 18), 2, 1, i % 2 ? '#ff9a3c' : P.gold);
    }
  }
  // Wounds: torn fabric with scorched edges.
  for (const hd of j.heridas) {
    if (Math.abs(hd.v) > altoZ(hd.u) - 2) continue;
    const r = Math.round(1 + hd.s * 1.5);
    D.oval(g, hd.u, hd.v, r + 3, r + 1, Z.z1);
    D.oval(g, hd.u, hd.v, r + 1, r, '#7a4a5a');
    const sem = Math.floor(hd.sem * 1000);
    for (let i = -r; i <= r; i++) {
      const hh = Math.max(0, Math.round((r - Math.abs(i)) * 0.8 + ((sem >> (i & 7)) & 1)));
      R(g, hd.u + i, hd.v - hh, 1, hh * 2 + 1, Z.carbon);
    }
    if (hd.s >= 2) R(g, hd.u + r, hd.v - r - 1, 2, r + 1, Z.z3);
  }

  // Engine nacelles on struts.
  for (const p of vivasYMuertas(j, 'helice')) {
    const top = altoZ(p.dx) - 2;
    lineaPx(g, p.dx - 4, top, p.dx - 2, p.dy - 4, Z.fondo, 2);
    lineaPx(g, p.dx + 5, top, p.dx + 3, p.dy - 4, Z.fondo);
    if (p.viva) {
      D.oval(g, p.dx, p.dy, 11, 5, Z.fondo);
      D.oval(g, p.dx, p.dy - 1, 10, 4, Z.z1);
      R(g, p.dx - 6, p.dy - 4, 10, 1, Z.z3);
      R(g, p.dx - 2, p.dy + 1, 3, 2, P.gl1);
      R(g, p.dx + 9, p.dy - 1, 3, 2, P.metal0);
    } else {
      D.oval(g, p.dx, p.dy, 8, 3, '#5a3a4a');
      R(g, p.dx - 5, p.dy - 2, 4, 2, '#7a4a3a');
      R(g, p.dx + 2, p.dy - 3, 2, 3, '#8a5a4a');
    }
  }
  // Flak guns on top, the tail gun, the searchlights and the bomb bay.
  for (const p of j.partes) {
    if (p.clase === 'torreta') {
      const r = esFlak(p) ? 6 : 5;
      if (p.viva) {
        D.oval(g, p.dx, p.dy + (p.dy < 0 ? 3 : -3), r + 2, 3, Z.fondo);
        D.disc(g, p.dx, p.dy, r, '#6a5a8a');
        D.disc(g, p.dx, p.dy - 1, r - 1, '#9a8ec0');
        R(g, p.dx - 3, p.dy - r + 1, 3, 1, '#d8d0f0');
        R(g, p.dx - r + 2, p.dy + 1, r * 2 - 3, 1, P.r1);
      } else {
        D.oval(g, p.dx, p.dy, r, 3, '#5a3a4a');
        R(g, p.dx - 4, p.dy - 2, 3, 2, '#7a4a3a');
        lineaPx(g, p.dx + 1, p.dy - 1, p.dx + 7, p.dy + (p.dy < 0 ? -4 : 4), '#5a4a6a');
      }
    } else if (p.clase === 'reflector') {
      R(g, p.dx - 1, p.dy - 6, 2, 4, Z.fondo);
      D.disc(g, p.dx, p.dy, 5, Z.fondo);
      D.disc(g, p.dx, p.dy, 4, p.viva ? P.metal0 : '#5a3a4a');
      if (!p.viva) R(g, p.dx - 2, p.dy - 1, 3, 2, '#2a1a3a');
    } else if (p.clase === 'lanzador') {
      R(g, p.dx - 11, p.dy - 3, 22, 6, Z.fondo);
      if (p.viva) {
        const abierta = j.bombasPend > 0 || (j.minaAviso > 0 && parpadeo(t, 10));
        if (abierta) {
          R(g, p.dx - 10, p.dy - 2, 20, 4, '#3a2030');
          for (const du of [-6, 0, 6]) R(g, p.dx + du - 1, p.dy - 1, 3, 3, '#6a5a8a');
          R(g, p.dx - 13, p.dy + 1, 4, 4, P.metal0);
          R(g, p.dx + 9, p.dy + 1, 4, 4, P.metal0);
        } else {
          R(g, p.dx - 10, p.dy - 2, 9, 4, P.metal0);
          R(g, p.dx + 1, p.dy - 2, 9, 4, P.metal0);
          R(g, p.dx - 10, p.dy - 2, 20, 1, P.metal);
        }
      } else {
        R(g, p.dx - 9, p.dy - 2, 18, 4, '#5a3a4a');
        R(g, p.dx - 3, p.dy, 6, 2, '#8a5a4a');
      }
    }
  }

  // The control car with Margarita at the front window.
  const nu = nucleo(j);
  for (const u of [26, 50, 72]) lineaPx(g, u, 36, u, 44, Z.fondo);
  poly(g, [[16, 43], [74, 43], [87, 50], [83, 61], [24, 63], [14, 56]], Z.fondo);
  poly(g, [[17, 44], [73, 44], [85, 50], [81, 60], [25, 62], [16, 55]], Z.z1);
  R(g, 18, 44, 55, 2, Z.z3);
  R(g, 20, 57, 60, 2, Z.z0);
  for (let u = 22; u <= 58; u += 9) {
    R(g, u, 47, 6, 5, nu.vulnerable ? P.gl1 : '#6a7aa8');
    R(g, u, 47, 6, 1, P.gl2);
  }
  const abierta = j.ventana > 0 || (nu.vulnerable && j.fase === 3) || muriendo;
  poly(g, [[65, 46], [76, 46], [83, 51], [80, 56], [65, 56]], abierta ? '#fff0c0' : P.gl1);
  if (nu.viva || !muriendo) margarita(g, 72, 56, abierta, t, j.fase === 3 || muriendo);
  if (!abierta) {
    g.globalAlpha = 0.3;
    poly(g, [[65, 46], [76, 46], [83, 51], [80, 56], [65, 56]], P.gl2);
    g.globalAlpha = 1;
    R(g, 77, 47, 2, 1, P.white);
  }
  if (!nu.vulnerable) {
    // Armour: riveted shutters over the windows.
    for (let u = 22; u <= 58; u += 9) R(g, u, 47, 6, 5, P.metal0);
    for (const u of [68, 72, 76]) R(g, u, 46, 1, 10, P.metal0);
    R(g, 15, 54, 70, 3, P.metal0);
    R(g, 15, 54, 70, 1, P.metal);
    for (let u = 18; u < 84; u += 6) R(g, u, 55, 1, 1, P.white);
  }
  if (!nu.viva) D.oval(g, 48, 53, 16, 6, '#6a3a3a');
}

/** Margarita: red beanie, grey hair, glasses, lilac cardigan; shaking her fist. (x, y) = chest. */
function margarita(g: Ctx, x: number, y: number, fuera: boolean, t: number, furia: boolean) {
  y += fuera ? Math.round(Math.sin(t * 6)) - 2 : 0;
  // Cardigan.
  R(g, x - 5, y - 3, 10, 3, CARDIGAN);
  R(g, x - 1, y - 3, 1, 3, '#8a7a9a');
  // Hair bun behind, face.
  D.disc(g, x - 3, y - 8, 4, PELO);
  D.disc(g, x - 5, y - 11, 2, PELO);
  D.disc(g, x + 1, y - 8, 3, P.skin);
  R(g, x + 4, y - 8, 2, 2, P.skin0);
  // Glasses and angry brows.
  R(g, x - 1, y - 10, 6, 1, P.metal0);
  R(g, x, y - 9, 2, 2, P.gl2);
  R(g, x + 3, y - 9, 2, 2, P.gl2);
  R(g, x + 1, y - 9, 1, 1, P.eye);
  R(g, x + 4, y - 9, 1, 1, P.eye);
  R(g, x - 1, y - 12, 2, 1, '#5a4a5a');
  R(g, x + 1, y - 11, 1, 1, '#5a4a5a');
  R(g, x + 4, y - 12, 2, 1, '#5a4a5a');
  // Mouth: shouting while she's out of the window.
  if (fuera && parpadeo(t, 5)) R(g, x + 2, y - 6, 2, 2, P.r0);
  else R(g, x + 1, y - 5, 3, 1, P.r0);
  // The red wool beanie with its pompom.
  D.oval(g, x, y - 13, 5, 3, P.r0);
  D.oval(g, x, y - 14, 4, 2, P.r1);
  R(g, x - 5, y - 12, 11, 2, P.r0);
  for (let i = -4; i < 6; i += 2) R(g, x + i, y - 12, 1, 1, P.r2);
  D.disc(g, x - 1, y - 17, 2, P.r2);
  R(g, x - 2, y - 18, 1, 1, P.r3);
  // The fist.
  const f = Math.round(Math.sin(t * (furia ? 16 : 11)) * (fuera ? 3 : 1.5));
  if (fuera) {
    R(g, x + 4, y - 4, 4, 2, CARDIGAN);
    R(g, x + 7, y - 9 + f, 2, 6, CARDIGAN);
    R(g, x + 6, y - 13 + f, 4, 4, P.skin);
    R(g, x + 6, y - 13 + f, 4, 1, P.skin0);
  } else {
    R(g, x + 4, y - 4, 2, 3, CARDIGAN);
    R(g, x + 5, y - 7 + f, 3, 3, P.skin);
  }
}

/** Animated live parts of the zeppelin, in its local frame. */
function vivoZepelin(g: Ctx, j: Jefe, t: number, angQ: number) {
  const c = Math.cos(j.ang), s = Math.sin(j.ang);
  const sg = j.giro < 0 ? -1 : 1;
  const local = (a: number) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    return { u: (c * dx + s * dy) * sg, v: s * dx - c * dy };
  };
  const vivo = j.muriendo < 0;
  for (const p of j.partes) {
    if (!p.viva) continue;
    if (p.clase === 'torreta') {
      const d = local(p.ang);
      const L = esFlak(p) ? 12 : 9;
      lineaPx(g, p.dx + d.u * 2, p.dy + d.v * 2, p.dx + d.u * L, p.dy + d.v * L, '#3a2a4a', esFlak(p) ? 3 : 2);
      lineaPx(g, p.dx + d.u * 2, p.dy + d.v * 2, p.dx + d.u * (L - 1), p.dy + d.v * (L - 1), P.metal, 1);
      if (p.aviso > 0 && parpadeo(t, 14)) {
        D.disc(g, p.dx + d.u * L, p.dy + d.v * L, 3, P.white);
        D.disc(g, p.dx + d.u * L, p.dy + d.v * L, 1, P.red);
      }
      if (p.rafaga > 0 && parpadeo(t, 20)) D.disc(g, p.dx + d.u * (L + 2), p.dy + d.v * (L + 2), esFlak(p) ? 3 : 2, P.gold1);
    } else if (p.clase === 'helice' && vivo) {
      // Pusher prop behind the nacelle, seen side-on.
      const px = p.dx - 13;
      const f = Math.floor(t * 28 + p.dx) % 4;
      const L = Math.round(10 * [1, 0.6, 0.2, 0.6][f]);
      g.globalAlpha = 0.3;
      R(g, px - 1, p.dy - 10, 2, 21, P.white);
      g.globalAlpha = 1;
      R(g, px - 1, p.dy - L, 2, L * 2 + 1, Z.fondo);
      if (L > 2) R(g, px - 1, p.dy - L + 1, 1, L * 2 - 1, P.metal);
      D.disc(g, px + 1, p.dy, 2, P.metal0);
    } else if (p.clase === 'reflector' && vivo) {
      const d = local(p.ang);
      D.disc(g, p.dx + d.u * 2, p.dy + d.v * 2, 3, p.rafT > 0 && parpadeo(t, 8) ? P.white : P.gold1);
      R(g, p.dx + d.u * 2, p.dy + d.v * 2 - 1, 1, 1, P.white);
    }
  }
  // Burning cells: a row of flames along the top of each (upright whatever the tilt).
  for (const cel of j.partes) {
    if (cel.clase !== 'celda' || cel.arde === undefined) continue;
    const h = altoZ(cel.dx);
    for (let i = 0; i < 4; i++) {
      const u = cel.dx - 18 + i * 12;
      g.save();
      g.translate(u, -h * 0.75 + (i % 2) * 6);
      g.scale(Math.sign(j.giro || 1), 1);
      g.rotate(-angQ);
      llama(g, 0, 0, 2 + (i % 2) + Math.min(1, cel.arde * 0.3), t, i * 0.27 + cel.dx * 0.01);
      g.restore();
    }
  }
  // Weak point marker on the open car.
  const nu = nucleo(j);
  if (nu.viva && nu.vulnerable && vivo) {
    const r = 19 + (Math.floor(t * 6) % 2);
    g.fillStyle = parpadeo(t, 4) ? P.gold : P.red;
    for (let a = 0; a < 18; a++) {
      if (a % 4 === 3) continue;
      const an = (a / 18) * Math.PI * 2 + t;
      g.fillRect(Math.round(nu.dx + Math.cos(an) * r * 1.5), Math.round(nu.dy + Math.sin(an) * r * 0.6), 2, 2);
    }
  }
}

/** Jagged girders where the hull broke (drawn inside each half's clip). */
function bordeRoto(g: Ctx, lado: number, t: number) {
  for (let v = -ZR + 2; v < ZR - 2; v += 3) {
    const largo = 2 + ((v * 7 + 40) % 5);
    R(g, lado > 0 ? CORTE : CORTE - largo, v, largo, 1, '#8a6a7a');
  }
  for (let i = 0; i < 3; i++) {
    g.save();
    g.translate(CORTE + lado * 3, -20 + i * 18);
    llama(g, 0, 0, 3, t, i * 0.31 + (lado > 0 ? 0.5 : 0));
    g.restore();
  }
}

/** Searchlight cones (screen space). */
function hacesZepelin(g: Ctx, j: Jefe, x0: number, y0: number) {
  for (const p of vivas(j, 'reflector')) {
    const w = posParte(j, p);
    const ox = x0 + (w.x - j.x), oy = y0 - (w.y - j.y);
    const L = ALCANCE_FOCO;
    const ux = Math.cos(p.ang), uy = -Math.sin(p.ang);
    const fuerte = p.rafT > 0;
    const grad = g.createLinearGradient(ox, oy, ox + ux * L, oy + uy * L);
    grad.addColorStop(0, fuerte ? 'rgba(255,246,190,0.42)' : 'rgba(255,246,210,0.24)');
    grad.addColorStop(1, 'rgba(255,246,210,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(ox, oy);
    g.lineTo(ox + Math.cos(p.ang - HAZ) * L, oy - Math.sin(p.ang - HAZ) * L);
    g.lineTo(ox + Math.cos(p.ang + HAZ) * L, oy - Math.sin(p.ang + HAZ) * L);
    g.closePath();
    g.fill();
  }
}

/** Flak shells, their black puffs and the falling bombs (screen space). */
function proyectilesDib(g: Ctx, j: Jefe, x0: number, y0: number, t: number) {
  const sx = (x: number) => x0 + (x - j.x), sy = (y: number) => y0 - (y - j.y);
  for (const n of j.nubes) {
    const a = n.t / 1.8;
    const x = sx(n.x), y = sy(n.y);
    if (n.t < 0.12) {
      D.disc(g, x, y, Math.round(5 + n.t * 60), P.gold1);
      D.disc(g, x, y, Math.round(3 + n.t * 30), P.white);
    }
    g.globalAlpha = (1 - a) * 0.85;
    for (let i = 0; i < 4; i++) {
      const an = n.sem * 6 + i * 1.6;
      const r = Math.round(3 + a * 7 + (i % 2));
      D.disc(g, x + Math.cos(an) * (3 + a * 6), y + Math.sin(an) * (2 + a * 4), r, i % 2 ? '#4a4058' : '#5e5470');
    }
    D.disc(g, x - 1, y - 2, Math.round(2 + a * 4), '#7a7090');
    g.globalAlpha = 1;
  }
  for (const q of j.granadas) {
    const x = sx(q.x), y = sy(q.y);
    const n = Math.hypot(q.vx, q.vy) || 1;
    R(g, x - (q.vx / n) * 4, y + (q.vy / n) * 4, 1, 1, P.gold);
    R(g, x - 1, y - 1, 3, 3, '#3a2a4a');
    R(g, x, y, 1, 1, q.fuse < 0.25 && parpadeo(t, 16) ? P.red : P.metal);
  }
  for (const b of j.bombas) {
    const x = Math.round(sx(b.x)), y = Math.round(sy(b.y));
    R(g, x - 2, y - 5, 5, 1, '#6a5a8a');
    R(g, x - 1, y - 4, 3, 7, '#3a2a4a');
    R(g, x - 1, y - 2, 3, 1, P.r1);
    R(g, x, y + 3, 1, 1, '#3a2a4a');
    R(g, x - 1, y - 4, 1, 3, '#7a6a9a');
  }
}

/** Debris sprites of the zeppelin's own parts; false = use the shared ones. */
function piezaZepelin(g: Ctx, base: string): boolean {
  switch (base) {
    case 'flak':
    case 'metralla':
      D.disc(g, 0, 0, 5, '#6a5a8a');
      D.disc(g, 0, -1, 4, '#9a8ec0');
      R(g, 3, -2, 6, 2, P.metal);
      return true;
    case 'motor':
      D.oval(g, 0, 0, 8, 4, Z.z1);
      R(g, -5, -3, 8, 1, Z.z3);
      R(g, -9, -6, 2, 12, P.metal0);
      return true;
    case 'bodega':
      R(g, -7, -3, 14, 6, P.metal0);
      R(g, -7, -3, 14, 1, P.metal);
      return true;
    case 'reflector':
      D.disc(g, 0, 0, 4, P.metal0);
      D.disc(g, 1, 0, 2, P.gold1);
      return true;
    case 'gondola':
      D.oval(g, 0, 1, 8, 4, Z.z1);
      R(g, -6, -2, 12, 2, Z.z3);
      R(g, -3, 0, 2, 2, P.gl1);
      R(g, 2, 0, 2, 2, P.gl1);
      return true;
    case 'celda':
    case 'tela':
      poly(g, [[-7, -3], [6, -5], [7, 3], [-4, 5]], Z.z2);
      R(g, -2, -1, 3, 2, Z.carbon);
      return true;
    case 'aleta':
      poly(g, [[-6, 4], [2, -6], [7, -6], [6, 5]], P.r1);
      R(g, 1, -3, 4, 2, P.cream);
      return true;
    case 'viga':
      R(g, -8, -1, 16, 2, '#8a6a7a');
      for (let x = -7; x < 8; x += 3) R(g, x, -2, 1, 4, '#6a4a5a');
      return true;
  }
  return false;
}
