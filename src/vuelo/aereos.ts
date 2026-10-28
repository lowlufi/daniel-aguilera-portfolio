import * as D from '../game/dulce';
import { P } from '../game/dulce';
import { GRAVEDAD, solucionTiro } from './fisica-armas';
import { lineaLibre, nivelIA, type Vista } from './ia';

/*
 * Aerial enemies, all flown by mice:
 *  - helicoptero: a lilac helicopter that hovers at a stand-off distance from
 *    the plane, tilts as it moves and fires bursts of pellets (and, later,
 *    little rockets) with lead. 3 hp.
 *  - dron: tiny "abejorro" drones in a swarm of 3–5. They flock (boids:
 *    separation, alignment, cohesion) around the plane and take turns diving
 *    at it kamikaze-style. 1 hp.
 *  - globo: a slow hot-air balloon that drifts above the plane's altitude and
 *    drops floating mines. 2 hp.
 *  - ovni: a pastel flying saucer (only in space, above ~1600 px). It slides
 *    in fast arcs or teleports to a spot above the plane, then either fires a
 *    laser (0.8 s of blinking aim line first) or switches on a tractor beam
 *    that slows the plane and drags it up (`ResultadoPaso.tractor`). 4 hp.
 *
 * Every enemy shot is telegraphed (`aviso`): helicopters blink before a
 * burst, drones flash red before diving, balloons blink the mine before the
 * drop, saucers draw the aim line / beam cone before firing.
 *
 * Each type has its own ceiling (`techoTipo`) and the engine should spawn
 * them near the plane's altitude (`alturaAparicion`).
 *
 * Physics in world units (px, s, y = ALTITUDE up, angles CCW). `paso` only
 * moves the one aircraft it's given (it reads `todos` for flocking) and
 * returns the projectiles it fired; the engine owns them (see `Proyectil`,
 * `pasoProyectil`, `dibujarProyectil` below, so integrating is a few lines).
 */

type Ctx = CanvasRenderingContext2D;

export type TipoAereo = 'helicoptero' | 'dron' | 'globo' | 'ovni';

export type Aereo = {
  id: number;
  /** A visitor (space UFOs that come on their own): it doesn't hold the wave up. */
  extra?: boolean;
  tipo: TipoAereo;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  /** Body tilt, rad CCW (the sprite is drawn rotated by it). */
  ang: number;
  /** Which way the sprite faces: 1 right, -1 left. */
  mira: 1 | -1;
  /** Age, s. */
  t: number;
  /** Seconds to the next burst / mine / dive. */
  cd: number;
  /** Shots left in the current burst, and time to the next one. */
  rafaga: number;
  rafT: number;
  /** Swarm id (drones of one swarm flock together). */
  grupo: number;
  /** Drone phase: 0 circling, 1 diving, 2 pulling away. */
  fase: 0 | 1 | 2;
  faseT: number;
  /** Orbit direction around the plane. */
  lado: 1 | -1;
  /** Per-aircraft 0…1 seed for variety. */
  semilla: number;
  /** The wave it was born in (difficulty). */
  ola: number;
  /** Bursts fired (every other one is rockets in later waves). */
  salvas: number;
  /** Set when it hit the ground (the engine should blow it up). */
  estrellado?: boolean;
  /** Seconds left of the visual warning before the next shot / dive / drop. */
  aviso?: number;
  /** Saucer-only state. */
  ov?: EstadoOvni;
  /** Helicopter: hp when first seen, and the hiding spot behind a hill (re-checked every `escRe`). */
  hp0?: number;
  escX?: number;
  escY?: number;
  escRe?: number;
};

/**
 * Saucer modes: 0 hover, 1 arc slide, 2 teleport out, 3 teleport in,
 * 4 laser charging (aim line), 5 laser firing, 6 tractor charging, 7 tractor on.
 */
export type EstadoOvni = {
  modo: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  modoT: number;
  /** Wanted offset from the plane. */
  ofX: number;
  ofY: number;
  /** Arc start and length. */
  x0: number;
  y0: number;
  dur: number;
  lado: 1 | -1;
  /** Beam angle (world, CCW) and its length to the ground / max range. */
  ang: number;
  largo: number;
  /** Locked aim point of the laser. */
  bx: number;
  by: number;
  /** 0…1 visibility (teleport). */
  alfa: number;
  acerto: boolean;
  atrapado: boolean;
  tractorCd: number;
  rng: number;
};

export type Disparo = { x: number; y: number; vx: number; vy: number; tipo: 'balin' | 'cohete' | 'mina'; trazador?: boolean };
export type Proyectil = Disparo & { t: number };

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const G = GRAVEDAD;

let siguienteId = 1;
let siguienteGrupo = 1;

const HP: Record<TipoAereo, number> = { helicoptero: 3, dron: 1, globo: 2, ovni: 4 };

/** Highest altitude each type flies at, px. */
const TECHOS: Record<TipoAereo, number> = { helicoptero: 1300, dron: 2000, globo: 1700, ovni: 2980 };
/** Saucers never come down into the clouds. */
export const PISO_OVNI = 1450;
/** Saucers only show up when the plane is above this. */
export const ALTURA_OVNI = 2000;
/** Laser / tractor warning time, s (constant: it's what makes them dodgeable). */
export const AVISO_RAYO = 0.8;
const DUR_LASER = 0.35;
const ALCANCE_LASER = 520;
const LARGO_TRACTOR = 240;
const APERTURA_TRACTOR = 0.3;

/** Altitude ceiling of each type, px (`paso` never lets them above it). */
export function techoTipo(tipo: TipoAereo): number {
  return TECHOS[tipo] ?? 900;
}

/**
 * Difficulty 0…~1.3: like `nivelIA` but ramps up harder from wave 3
 * (tighter aim, shorter pauses). Warnings stay as long as ever.
 */
export function dificultad(ola: number): number {
  const n = fin(ola, 1);
  return nivelIA(n) + (n >= 3 ? Math.min(0.35, (n - 2) * 0.07) : 0);
}
const k1 = (ola: number) => Math.min(1, dificultad(ola));

/**
 * Spawn altitude for a type near the plane's altitude, within its ceiling
 * (saucers: above the plane, never under ALTURA_OVNI + 50).
 */
export function alturaAparicion(tipo: TipoAereo, altitudJugador: number, rnd: () => number = Math.random): number {
  const alt = fin(altitudJugador, 220);
  const r = rnd();
  if (tipo === 'ovni') return clamp(alt + 90 + r * 90, ALTURA_OVNI + 50, techoTipo('ovni') - 30);
  if (tipo === 'globo') return clamp(alt + 30 + r * 80, 160, techoTipo(tipo) - 30);
  return clamp(alt - 50 + r * 130, 160, techoTipo(tipo) - 30);
}

/** Collision radius, px. */
export function radio(a: Aereo): number {
  return a.tipo === 'helicoptero' ? 10 : a.tipo === 'dron' ? 5 : a.tipo === 'ovni' ? 12 : 10;
}

/** Projectile speeds (exported so the engine can use them if it wants). */
export const VEL_BALIN = 190;
export const VEL_COHETE = 150;

function nuevo(tipo: TipoAereo, x: number, y: number, rnd: () => number, ola: number, grupo: number): Aereo {
  return {
    id: siguienteId++,
    tipo,
    x,
    y,
    vx: 0,
    vy: 0,
    hp: HP[tipo],
    ang: 0,
    mira: -1,
    t: 0,
    cd: 1.5 + rnd() * 1.5,
    rafaga: 0,
    rafT: 0,
    grupo,
    fase: 0,
    faseT: 0,
    lado: rnd() < 0.5 ? 1 : -1,
    semilla: rnd(),
    ola: Math.max(1, Math.floor(fin(ola, 1))),
    salvas: 0,
    ...(tipo === 'ovni'
      ? {
          ov: {
            modo: 0, modoT: 0.4 + rnd() * 0.4, ofX: (rnd() < 0.5 ? -1 : 1) * (40 + rnd() * 80), ofY: 110 + rnd() * 50,
            x0: x, y0: y, dur: 0.5, lado: 1, ang: -Math.PI / 2, largo: 0, bx: x, by: y, alfa: 1,
            acerto: false, atrapado: false, tractorCd: 3 + rnd() * 3, rng: (Math.floor(rnd() * 4294967296) >>> 0) || 1,
          } as EstadoOvni,
        }
      : {}),
  };
}

/**
 * Creates an aircraft at (x, y). A `dron` returns its whole swarm (3–5,
 * more in later waves) in a small cluster around (x, y).
 */
export function crear(tipo: TipoAereo, x: number, y: number, rnd: () => number = Math.random, ola = 2): Aereo[] {
  if (tipo !== 'dron') {
    const a = nuevo(tipo, x, y, rnd, ola, 0);
    a.vx = -30;
    return [a];
  }
  const grupo = siguienteGrupo++;
  const n = clamp(3 + Math.floor(rnd() * (ola >= 4 ? 3 : 2)), 3, 5);
  const out: Aereo[] = [];
  const lado: 1 | -1 = rnd() < 0.5 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = nuevo('dron', x + (i % 3) * 14 - 14, y + Math.floor(i / 3) * 14 - 7 + (i % 2) * 5, rnd, ola, grupo);
    a.lado = lado;
    a.vx = -60;
    // Staggered dives: one after another, never all at once.
    a.faseT = 2 + i * lerp(1.3, 0.7, nivelIA(ola)) + rnd() * 0.5;
    out.push(a);
  }
  return out;
}

/**
 * Which aircraft come in each wave. Each `dron` entry is a whole swarm.
 * Without `altitudJugador` it's the classic low-level mix (none in wave 1).
 * With it, only types that can reach that altitude: helicopters up to ~900,
 * balloons ~1300, drones ~1600, and saucers (only) above 1600 — saucers even
 * in wave 1, so a player who climbs to space always meets them.
 */
export function elegirAereos(ola: number, rnd: () => number = Math.random, altitudJugador?: number): TipoAereo[] {
  const n = Math.floor(fin(ola, 1));
  const alt = altitudJugador === undefined ? undefined : fin(altitudJugador, 0);
  if (alt !== undefined && alt > ALTURA_OVNI) {
    const cuantos = clamp(1 + Math.floor((n - 1) * 0.45 + rnd() * 0.8), 1, 5);
    return Array.from({ length: cuantos }, () => 'ovni' as TipoAereo);
  }
  if (n < 2) return [];
  const cuantos = Math.min(7, 1 + Math.floor((n - 2) * 0.7 + rnd() * 0.8));
  const out: TipoAereo[] = [];
  for (let i = 0; i < cuantos; i++) out.push(tipoParaAltura(n, rnd, alt, i));
  return out;
}

/**
 * One type that makes sense for this wave at this altitude (handy for the
 * engine to swap a queued type that can't reach the plane any more).
 */
export function tipoParaAltura(ola: number, rnd: () => number = Math.random, altitudJugador?: number, i = 1): TipoAereo {
  const n = Math.max(1, Math.floor(fin(ola, 1)));
  const alt = altitudJugador === undefined ? undefined : fin(altitudJugador, 0);
  if (alt !== undefined && alt > ALTURA_OVNI) return 'ovni';
  const r = rnd();
  let t: TipoAereo;
  if (n <= 2) t = i === 0 ? (r < 0.5 ? 'helicoptero' : 'dron') : 'helicoptero';
  else if (n < 4) t = r < 0.55 ? 'helicoptero' : 'dron';
  else t = r < 0.4 ? 'helicoptero' : r < 0.75 ? 'dron' : 'globo';
  if (alt === undefined) return t;
  // Too high for it? Pick one that can climb there (drones go highest).
  const llega = (x: TipoAereo) => alt <= techoTipo(x) + 60;
  if (llega(t)) return t;
  if (llega('globo') && n >= 3 && r < 0.4) return 'globo';
  return 'dron';
}

/* ── Steering helpers ───────────────────────────────────────────────────── */

/** Accelerates (vx, vy) towards the wanted velocity, limited to aMax. */
function dirigir(a: Aereo, wx: number, wy: number, aMax: number, dt: number) {
  let ax = (wx - a.vx) * 4, ay = (wy - a.vy) * 4;
  const m = Math.hypot(ax, ay);
  if (m > aMax) {
    ax *= aMax / m;
    ay *= aMax / m;
  }
  a.vx += ax * dt;
  a.vy += ay * dt;
}

function limitar(a: Aereo, vMax: number) {
  const s = Math.hypot(a.vx, a.vy);
  if (s > vMax) {
    a.vx *= vMax / s;
    a.vy *= vMax / s;
  }
}

/** Stay off the ground and below the ceiling. */
function evitarSuelo(a: Aereo, vista: Vista, margen: number, dt: number) {
  const h = a.y - fin(vista.suelo(a.x)) - margen;
  if (h < 0) a.vy += Math.min(300, -h * 12) * dt;
  // Look a little ahead for a rising hill.
  const hAdel = a.y + a.vy * 0.5 - fin(vista.suelo(a.x + a.vx * 0.5)) - margen;
  if (hAdel < 0 && a.vy < 40) a.vy += Math.min(200, -hAdel * 6) * dt;
  const techo = techoTipo(a.tipo) - 15;
  if (a.y > techo) a.vy -= (a.y - techo) * 10 * dt;
}

function apuntar(desde: { x: number; y: number }, vel: number, grav: boolean, av: { x: number; y: number; vx: number; vy: number }, err: number) {
  const sol = solucionTiro(desde, vel, av, grav);
  if (!sol) return null;
  // A tiny, deterministic-ish wobble so bursts spread a little.
  const ang = Math.atan2(sol.vy, sol.vx) + err;
  return { vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel };
}

/* ── One step ───────────────────────────────────────────────────────────── */

export type ResultadoPaso = {
  disparos?: Disparo[];
  /** A drone rammed the plane (it's gone). */
  embestida?: boolean;
  /** A saucer's laser (or a tractor zap) hit the plane at this point: 1 damage. */
  laser?: { x: number; y: number };
  /**
   * The plane is caught in a saucer's tractor beam: add this acceleration
   * (px/s², y up) to its velocity this frame: `p.vx += fx * dt; p.vy += fy * dt`.
   * It already includes the braking term (it pulls towards the saucer and
   * eats speed).
   */
  tractor?: { fx: number; fy: number };
};

export function paso(a: Aereo, todos: Aereo[], vista: Vista, dt: number): ResultadoPaso {
  dt = clamp(fin(dt), 0, 0.1);
  a.x = fin(a.x);
  a.y = fin(a.y, 150);
  a.vx = fin(a.vx);
  a.vy = fin(a.vy);
  a.t += dt;
  if (a.hp <= 0 || dt === 0) return {};
  const r =
    a.tipo === 'helicoptero' ? pasoHeli(a, todos, vista, dt)
    : a.tipo === 'dron' ? pasoDron(a, todos, vista, dt)
    : a.tipo === 'ovni' ? pasoOvni(a, todos, vista, dt)
    : pasoGlobo(a, todos, vista, dt);
  a.vx = fin(a.vx);
  a.vy = fin(a.vy);
  a.x += a.vx * dt;
  a.y += a.vy * dt;
  // Hard ceiling per type (and saucers never sink into the clouds).
  const techo = techoTipo(a.tipo);
  if (a.y > techo) {
    a.y = techo;
    a.vy = Math.min(0, a.vy);
  }
  if (a.tipo === 'ovni' && a.y < PISO_OVNI) {
    a.y = PISO_OVNI;
    a.vy = Math.max(0, a.vy);
  }
  if (a.tipo === 'dron') noSolapar(a, todos);
  if (a.y <= fin(vista.suelo(a.x)) + 1) {
    a.y = fin(vista.suelo(a.x)) + 1;
    a.vy = Math.max(0, a.vy);
    if (a.tipo === 'dron') {
      a.hp = 0;
      a.estrellado = true;
    }
  }
  return r;
}

/** Push away from other aircraft that are too close (all types). */
function separacion(a: Aereo, todos: Aereo[], dist: number) {
  let sx = 0, sy = 0;
  for (const o of todos) {
    if (o === a || o.hp <= 0) continue;
    const dx = a.x - o.x, dy = a.y - o.y;
    const d = Math.hypot(dx, dy);
    const lim = dist + (o.tipo === 'dron' ? 0 : 10);
    if (d < lim && d > 1e-3) {
      const f = (lim - d) / lim;
      sx += (dx / d) * f;
      sy += (dy / d) * f;
    }
  }
  return { sx, sy };
}

function pasoHeli(a: Aereo, todos: Aereo[], vista: Vista, dt: number): ResultadoPaso {
  const av = vista.avion;
  const k = nivelIA(a.ola);
  const kd = k1(a.ola);
  const vMax = lerp(85, 125, kd);
  if (a.hp0 === undefined) a.hp0 = a.hp;
  const herido = a.hp < a.hp0 * 0.5;
  // Hover point: on our side of the plane, at stand-off range, a bit above
  // (further off once hurt).
  const px = av.x + av.vx * 0.6, py = av.y + av.vy * 0.4;
  const lado = a.x >= px ? 1 : -1;
  const distDeseada = lerp(135, 95, k) + Math.sin(a.t * 0.7 + a.semilla * 6) * 20 + (herido ? 60 : 0);
  let tx = px + lado * distDeseada;
  let ty = clamp(py + 20 + Math.sin(a.t * 1.3 + a.semilla * 9) * 12, fin(vista.suelo(tx)) + 40, techoTipo('helicoptero') - 25);
  // Nap-of-the-earth: while reloading (always, once hurt) it ducks behind a
  // hill that masks it from the plane, and pops up again to fire.
  const recargando = a.rafaga <= 0 && !(a.aviso! > 0) && a.cd > (herido ? 0.3 : 0.9);
  if (av.vivo && recargando && kd > 0.15 && Math.abs(av.x - a.x) < 600) {
    if (a.t >= (a.escRe ?? -1)) {
      a.escRe = a.t + 0.5;
      a.escX = NaN;
      let mejor = Infinity;
      for (let off = -180; off <= 180; off += 20) {
        const x = a.x + off;
        const y = fin(vista.suelo(x)) + 34;
        if (Math.abs(x - av.x) < 90 || lineaLibre(x, y, av.x, av.y, vista.suelo)) continue;
        const coste = Math.abs(off) + Math.abs(y - a.y) * 0.5;
        if (coste < mejor) {
          mejor = coste;
          a.escX = x;
          a.escY = y;
        }
      }
    }
    if (Number.isFinite(a.escX)) {
      tx = a.escX!;
      ty = a.escY!;
    }
  }
  let wx = (tx - a.x) * 1.5, wy = (ty - a.y) * 1.5;
  // Strafing: it slides sideways across the plane's line while it fires (a
  // moving gun is harder to hit back).
  if (a.rafaga > 0 || a.aviso! > 0) {
    const d0 = Math.hypot(av.x - a.x, av.y - a.y) || 1;
    const sgn = a.semilla < 0.5 ? 1 : -1;
    wx += (-(av.y - a.y) / d0) * 55 * sgn;
    wy += ((av.x - a.x) / d0) * 55 * sgn;
  }
  const s = Math.hypot(wx, wy);
  if (s > vMax) {
    wx *= vMax / s;
    wy *= vMax / s;
  }
  if (!av.vivo) {
    wx = -20;
    wy = 0;
  }
  const sep = separacion(a, todos, 34);
  wx += sep.sx * 80;
  wy += sep.sy * 80;
  dirigir(a, wx, wy, lerp(110, 170, kd), dt);
  evitarSuelo(a, vista, 30, dt);
  limitar(a, vMax);
  // Lean into the motion (nose down when speeding up), smoothly.
  const angDeseado = clamp(-a.vx / vMax, -1, 1) * 0.38;
  a.ang += (angDeseado - a.ang) * Math.min(1, dt * 5);
  // Face the plane (with a little hysteresis).
  if (av.x > a.x + 12) a.mira = 1;
  else if (av.x < a.x - 12) a.mira = -1;

  // Bursts.
  const disparos: Disparo[] = [];
  const dx = av.x - a.x, dy = av.y - a.y;
  const dist = Math.hypot(dx, dy);
  a.cd -= dt;
  if (a.rafaga <= 0 && !(a.aviso! > 0) && a.cd <= 0 && av.vivo && dist < lerp(220, 290, kd) && Math.sign(dx) === a.mira && lineaLibre(a.x, a.y, av.x, av.y, vista.suelo)) {
    // Telegraph first: the nose light blinks (and a "!") before the burst.
    a.salvas++;
    a.faseT = a.ola >= 3 && a.salvas % 2 === 0 ? 1 : 0; // remembers what this burst fires
    a.aviso = lerp(0.6, 0.45, kd);
    a.cd = lerp(2.8, 1.2, kd) + a.semilla * 0.6;
  }
  if (a.aviso! > 0) {
    a.aviso! -= dt;
    if (a.aviso! <= 0) {
      a.aviso = 0;
      const cohetes = a.faseT === 1;
      a.rafaga = cohetes ? (a.ola >= 6 ? 3 : 2) : a.ola >= 5 ? 4 : 3;
      a.rafT = 0;
    }
  }
  if (a.rafaga > 0) {
    a.rafT -= dt;
    if (a.rafT <= 0) {
      const cohete = a.faseT === 1;
      const boca = { x: a.x + a.mira * 8, y: a.y - 4 };
      const n = a.rafaga;
      // Not snipers: the lead is partial and the burst fans out, so a plane
      // that keeps turning or jinks gets missed; one that flies straight, not.
      const err = (n % 2 === 0 ? 1 : -1) * (0.05 + 0.035 * n) * (1 - 0.55 * kd);
      const f = lerp(0.45, 0.95, kd) + 0.15 * Math.sin(a.salvas * 2.1 + a.semilla * 5);
      const blanco = { x: av.x, y: av.y, vx: av.vx * f, vy: av.vy * f };
      const v = apuntar(boca, cohete ? VEL_COHETE : VEL_BALIN, !cohete, blanco, err);
      if (v) disparos.push({ x: boca.x, y: boca.y, vx: v.vx, vy: v.vy, tipo: cohete ? 'cohete' : 'balin' });
      a.rafaga--;
      a.rafT = cohete ? 0.22 : 0.11;
      // Recoil nudges the helicopter back.
      if (v) {
        a.vx -= (v.vx / (cohete ? VEL_COHETE : VEL_BALIN)) * (cohete ? 8 : 3);
        a.vy -= (v.vy / (cohete ? VEL_COHETE : VEL_BALIN)) * (cohete ? 8 : 3);
      }
    }
  }
  return disparos.length ? { disparos } : {};
}

/** Hard rule: a drone never overlaps another one (it pushes itself out). */
function noSolapar(a: Aereo, todos: Aereo[]) {
  for (const o of todos) {
    if (o === a || o.hp <= 0 || o.tipo !== 'dron') continue;
    const dx = a.x - o.x, dy = a.y - o.y;
    const d = Math.hypot(dx, dy);
    const min = radio(a) * 2 + 2;
    if (d < min) {
      const ux = d > 1e-3 ? dx / d : Math.cos(a.id), uy = d > 1e-3 ? dy / d : Math.sin(a.id);
      a.x += ux * (min - d);
      a.y += uy * (min - d);
      // …and loses the speed it had towards the other one.
      const vr = a.vx * ux + a.vy * uy;
      if (vr < 0) {
        a.vx -= vr * ux;
        a.vy -= vr * uy;
      }
    }
  }
}

function pasoDron(a: Aereo, todos: Aereo[], vista: Vista, dt: number): ResultadoPaso {
  const av = vista.avion;
  const k = nivelIA(a.ola);
  const kd = k1(a.ola);
  const rAvion = vista.radioAvion ?? 9;

  // Kamikaze hit.
  if (av.vivo && Math.hypot(av.x - a.x, av.y - a.y) < radio(a) + rAvion) {
    a.hp = 0;
    return { embestida: true };
  }

  // Phases: circle the plane → dive at it → pull away → circle…
  a.faseT -= dt;
  // Before diving it flashes red for a moment (the warning).
  // Swarm mates, in id order: each gets its own slot round the plane, and only
  // one (two from wave 6) dives at a time.
  const enjambre = todos.filter((o) => o.tipo === 'dron' && o.hp > 0 && o.grupo === a.grupo).sort((p, q) => p.id - q.id);
  const iSlot = Math.max(0, enjambre.indexOf(a));
  const atacando = enjambre.filter((o) => o !== a && (o.fase === 1 || o.aviso! > 0)).length;
  if (a.fase === 0 && a.faseT <= 0 && av.vivo && !(a.aviso! > 0)) {
    if (atacando >= (a.ola >= 6 ? 2 : 1)) a.faseT = 0.35 + a.semilla * 0.3;
    else a.aviso = 0.4;
  }
  if (a.aviso! > 0) {
    a.aviso! -= dt;
    if (a.aviso! <= 0) {
      a.aviso = 0;
      a.fase = 1;
      a.faseT = 1.8;
    }
  } else if (a.fase === 1 && (a.faseT <= 0 || !av.vivo)) {
    a.fase = 2;
    a.faseT = 0.7;
  } else if (a.fase === 2 && a.faseT <= 0) {
    a.fase = 0;
    a.faseT = lerp(3.2, 1.3, kd) + a.semilla * 1.5;
  }

  let wx: number, wy: number, vMax: number;
  if (a.fase === 1) {
    // Pursuit with lead (intercept where the plane will be).
    vMax = Math.min(215, lerp(165, 200, kd) + a.ola * 1.5);
    const d = Math.hypot(av.x - a.x, av.y - a.y);
    const tl = clamp(d / vMax, 0, 1.2);
    wx = av.x + av.vx * tl - a.x;
    wy = av.y + av.vy * tl - a.y;
    const m = Math.hypot(wx, wy) || 1;
    wx = (wx / m) * vMax;
    wy = (wy / m) * vMax;
  } else {
    vMax = a.fase === 2 ? 150 : lerp(120, 145, k);
    // Orbit point around the plane, each swarm going its own way round.
    const radioOrbita = 75 + a.semilla * 20;
    const fase = a.t * 1.4 * a.lado + a.grupo * 2.1 + (iSlot / Math.max(1, enjambre.length)) * Math.PI * 2;
    const ox = av.x + av.vx * 0.5 + Math.cos(fase) * radioOrbita;
    const oy = clamp(av.y + av.vy * 0.3 + Math.sin(fase) * radioOrbita * 0.6 + 25, fin(vista.suelo(av.x)) + 30, techoTipo('dron') - 15);
    wx = (ox - a.x) * 2;
    wy = (oy - a.y) * 2;
    if (a.fase === 2) {
      // Pull up and away after the pass.
      wx = a.vx * 1.2;
      wy = Math.abs(a.vy) + 60;
    }
  }

  // Boids within the swarm.
  let n = 0, cx = 0, cy = 0, ax = 0, ay = 0;
  for (const o of todos) {
    if (o === a || o.hp <= 0 || o.tipo !== 'dron' || o.grupo !== a.grupo) continue;
    const d = Math.hypot(o.x - a.x, o.y - a.y);
    if (d < 60) {
      n++;
      cx += o.x;
      cy += o.y;
      ax += o.vx;
      ay += o.vy;
    }
  }
  if (n && a.fase === 0) {
    wx += (cx / n - a.x) * 0.25 + (ax / n - a.vx) * 0.35;
    wy += (cy / n - a.y) * 0.25 + (ay / n - a.vy) * 0.35;
  }
  const sep = separacion(a, todos, 16);
  wx += sep.sx * 260;
  wy += sep.sy * 260;

  dirigir(a, wx, wy, lerp(240, 340, kd), dt);
  evitarSuelo(a, vista, a.fase === 1 ? 8 : 22, dt);
  limitar(a, vMax);

  if (Math.abs(a.vx) > 8) a.mira = a.vx > 0 ? 1 : -1;
  // Tilt with the climb/dive, mirrored with the facing.
  const angDeseado = clamp(Math.atan2(a.vy, Math.abs(a.vx) + 1) * a.mira, -0.9, 0.9);
  a.ang += (angDeseado - a.ang) * Math.min(1, dt * 8);
  return {};
}

function pasoGlobo(a: Aereo, todos: Aereo[], vista: Vista, dt: number): ResultadoPaso {
  const av = vista.avion;
  const k = nivelIA(a.ola);
  // Drift to a spot a bit ahead of the plane's path and above its altitude.
  const tx = av.x + av.vx * 1.5;
  const ty = clamp(av.y + 45, fin(vista.suelo(a.x)) + 70, techoTipo('globo') - 20);
  const vMax = lerp(28, 40, k);
  let wx = clamp((tx - a.x) * 0.3, -vMax, vMax);
  let wy = clamp((ty - a.y) * 0.5, -22, 22);
  const sep = separacion(a, todos, 40);
  wx += sep.sx * 30;
  wy += sep.sy * 30;
  // Balloons are sluggish: low acceleration, a slow bob.
  dirigir(a, wx, wy + Math.sin(a.t * 1.1 + a.semilla * 7) * 4, 18, dt);
  evitarSuelo(a, vista, 60, dt);
  a.ang = clamp(-a.vx / 300, -0.08, 0.08);
  a.mira = av.x >= a.x ? 1 : -1;

  a.cd -= dt;
  const dx = av.x - a.x;
  // The hanging mine blinks before it drops.
  if (a.cd <= 0 && av.vivo && Math.abs(dx) < 260 && !(a.aviso! > 0)) {
    a.aviso = 0.5;
    a.cd = lerp(3.4, 1.7, k1(a.ola)) + a.semilla;
  }
  if (a.aviso! > 0) {
    a.aviso! -= dt;
    if (a.aviso! > 0) return {};
    a.aviso = 0;
    return { disparos: [{ x: a.x, y: a.y - 18, vx: a.vx + clamp(dx * 0.1, -15, 15), vy: -12, tipo: 'mina' }] };
  }
  return {};
}

/* ── Saucer ─────────────────────────────────────────────────────────────── */

/** Per-saucer pseudo-random 0…1 (deterministic, no global state). */
function azar(o: EstadoOvni): number {
  o.rng = (Math.imul(o.rng, 1664525) + 1013904223) >>> 0;
  return o.rng / 4294967296;
}

const envolver = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

/** Turns `desde` towards `hacia` by at most `max` rad. */
function girar(desde: number, hacia: number, max: number): number {
  const d = envolver(hacia - desde);
  return desde + clamp(d, -max, max);
}

/** Distance from (px, py) to the segment from (x0, y0) along `ang` with length L, and the closest point. */
function aSegmento(px: number, py: number, x0: number, y0: number, ang: number, L: number) {
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const s = clamp((px - x0) * ux + (py - y0) * uy, 0, L);
  const cx = x0 + ux * s, cy = y0 + uy * s;
  return { d: Math.hypot(px - cx, py - cy), x: cx, y: cy };
}

/** How far a beam from (x, y) along `ang` goes before it meets the ground (max `L`). */
function largoRayo(x: number, y: number, ang: number, L: number, suelo: Vista['suelo']): number {
  const ux = Math.cos(ang), uy = Math.sin(ang);
  for (let s = 6; s <= L; s += 6) if (y + uy * s <= fin(suelo(x + ux * s))) return s;
  return L;
}

function nuevoSitio(a: Aereo, o: EstadoOvni, av: Vista['avion']) {
  const r = azar(o);
  // Mostly ahead of the plane (where it's going), sometimes behind.
  const adelante = Math.abs(av.vx) > 20 ? Math.sign(av.vx) : a.x < av.x ? -1 : 1;
  const lado = r < 0.7 ? adelante : -adelante;
  o.ofX = lado * lerp(25, 140, azar(o));
  o.ofY = lerp(95, 165, azar(o));
}

function objetivoOvni(o: EstadoOvni, av: Vista['avion'], vista: Vista) {
  const x = av.x + o.ofX;
  return { x, y: clamp(av.y + o.ofY, Math.max(PISO_OVNI + 10, fin(vista.suelo(x)) + 60), techoTipo('ovni') - 20) };
}

function pasoOvni(a: Aereo, todos: Aereo[], vista: Vista, dt: number): ResultadoPaso {
  const av = vista.avion;
  const kd = k1(a.ola);
  const o = a.ov!;
  const rAvion = vista.radioAvion ?? 9;
  o.modoT -= dt;
  a.cd -= dt;
  o.tractorCd -= dt;
  o.atrapado = false;
  const dx = av.x - a.x, dy = av.y - a.y;
  const dist = Math.hypot(dx, dy);
  const angAvion = Math.atan2(dy, dx);
  const frenar = (k: number) => {
    const f = Math.exp(-k * dt);
    a.vx *= f;
    a.vy *= f;
  };
  let res: ResultadoPaso = {};

  switch (o.modo) {
    case 0: {
      // Hover above the plane with a little wobble; decide what's next.
      const tg = objetivoOvni(o, av, vista);
      const vMax = lerp(250, 320, kd);
      let wx = (tg.x - a.x) * 3 + Math.cos(a.t * 2.3 + a.semilla * 7) * 20;
      let wy = (tg.y - a.y) * 3 + Math.sin(a.t * 3.1 + a.semilla * 5) * 14;
      const sep = separacion(a, todos, 50);
      wx += sep.sx * 260;
      wy += sep.sy * 260;
      const m = Math.hypot(wx, wy);
      if (m > vMax) {
        wx *= vMax / m;
        wy *= vMax / m;
      }
      if (!av.vivo) {
        wx = -30;
        wy = 20;
      }
      dirigir(a, wx, wy, 700, dt);
      if (o.modoT > 0) break;
      // Only one saucer aims at a time: overlapping beams would be unfair.
      const otroApunta = todos.some((q) => q !== a && q.hp > 0 && q.ov && q.ov.modo >= 4);
      if (av.vivo && a.cd <= 0 && !otroApunta && dist < ALCANCE_LASER - 40) {
        if (o.tractorCd <= 0 && dist < LARGO_TRACTOR - 40 && dy < -40 && azar(o) < 0.4) {
          o.modo = 6;
          o.modoT = AVISO_RAYO;
          o.ang = clamp(angAvion, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
        } else {
          o.modo = 4;
          o.modoT = AVISO_RAYO;
          // Lock the aim: where the plane will be when the warning ends
          // (partial lead early on, full lead later). Fly straight = get hit.
          // Aimed a hair past the warning so a straight flyer crosses the beam while it's on.
          const tl = AVISO_RAYO + DUR_LASER * 0.4;
          const f = lerp(0.85, 1.02, kd) * (0.95 + 0.1 * azar(o));
          o.bx = av.x + av.vx * tl * f;
          o.by = av.y + av.vy * tl * f;
          o.ang = Math.atan2(o.by - a.y, o.bx - a.x);
        }
        o.acerto = false;
      } else if (azar(o) < 0.3) {
        o.modo = 2;
        o.modoT = 0.22;
      } else {
        o.modo = 1;
        o.x0 = a.x;
        o.y0 = a.y;
        nuevoSitio(a, o, av);
        o.dur = lerp(0.6, 0.4, kd);
        o.modoT = o.dur;
        o.lado = azar(o) < 0.5 ? 1 : -1;
      }
      break;
    }
    case 1: {
      // Fast arc to the new spot (it tracks the plane while it goes).
      const s = clamp(1 - o.modoT / o.dur, 0, 1);
      const e = s * s * (3 - 2 * s);
      const tg = objetivoOvni(o, av, vista);
      const ex = tg.x - o.x0, ey = tg.y - o.y0;
      const L = Math.hypot(ex, ey) || 1;
      const b = Math.min(90, L * 0.35) * Math.sin(Math.PI * s) * o.lado;
      const px = o.x0 + ex * e - (ey / L) * b;
      const py = o.y0 + ey * e + (ex / L) * b;
      a.vx = clamp((px - a.x) / dt, -900, 900);
      a.vy = clamp((py - a.y) / dt, -900, 900);
      if (o.modoT <= 0) {
        o.modo = 0;
        o.modoT = lerp(0.8, 0.45, kd) + azar(o) * 0.4;
      }
      break;
    }
    case 2: {
      // Fade out, then pop up somewhere else above the plane.
      frenar(6);
      o.alfa = clamp(o.modoT / 0.22, 0, 1);
      if (o.modoT <= 0) {
        nuevoSitio(a, o, av);
        const tg = objetivoOvni(o, av, vista);
        a.x = tg.x;
        a.y = tg.y;
        a.vx = av.vx * 0.8;
        a.vy = 0;
        o.modo = 3;
        o.modoT = 0.22;
        o.alfa = 0;
      }
      break;
    }
    case 3: {
      dirigir(a, av.vx, av.vy, 600, dt);
      o.alfa = clamp(1 - o.modoT / 0.22, 0, 1);
      if (o.modoT <= 0) {
        o.alfa = 1;
        o.modo = 0;
        o.modoT = lerp(0.6, 0.35, kd);
      }
      break;
    }
    case 4: {
      // Charging: it stops and the thin aim line blinks (locked aim).
      frenar(7);
      o.ang = Math.atan2(o.by - a.y, o.bx - a.x);
      o.largo = largoRayo(a.x, a.y - 6, o.ang, ALCANCE_LASER, vista.suelo);
      if (o.modoT <= 0) {
        o.modo = 5;
        o.modoT = DUR_LASER;
      }
      break;
    }
    case 5: {
      // Firing: later waves sweep the beam a little after the plane, slower than it can dodge.
      frenar(7);
      const barrido = clamp((dificultad(a.ola) - 0.3) * 0.5, 0, 0.35);
      o.ang = girar(o.ang, angAvion, barrido * dt);
      o.largo = largoRayo(a.x, a.y - 6, o.ang, ALCANCE_LASER, vista.suelo);
      if (av.vivo && !o.acerto) {
        const h = aSegmento(av.x, av.y, a.x, a.y - 6, o.ang, o.largo);
        if (h.d < rAvion + 2.5) {
          o.acerto = true;
          res = { laser: { x: h.x, y: h.y } };
        }
      }
      // Recoil.
      a.vx -= Math.cos(o.ang) * 30 * dt;
      a.vy -= Math.sin(o.ang) * 30 * dt;
      if (o.modoT <= 0) {
        o.modo = 0;
        o.modoT = 0.35;
        a.salvas++;
        a.cd = lerp(3.2, 1.3, kd) + a.semilla * 0.6;
      }
      break;
    }
    case 6: {
      // Tractor warming up: the cone outline flickers, the saucer holds still.
      frenar(5);
      o.ang = girar(o.ang, clamp(angAvion, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6), 0.8 * dt);
      if (o.modoT <= 0) {
        o.modo = 7;
        o.modoT = lerp(2.2, 3, kd);
      }
      break;
    }
    case 7: {
      // Tractor on: it shadows the plane (slower than it) and the cone turns after it.
      const vSig = lerp(80, 115, kd);
      const tx = av.x, ty = clamp(av.y + 110, PISO_OVNI + 10, techoTipo('ovni') - 20);
      dirigir(a, clamp((tx - a.x) * 2, -vSig, vSig), clamp((ty - a.y) * 2, -vSig, vSig), 250, dt);
      o.ang = girar(o.ang, clamp(angAvion, -Math.PI / 2 - 0.7, -Math.PI / 2 + 0.7), lerp(1, 1.5, kd) * dt);
      const dentro = av.vivo && dist < LARGO_TRACTOR && Math.abs(envolver(angAvion - o.ang)) < APERTURA_TRACTOR + Math.atan2(rAvion, Math.max(dist, 1));
      if (dentro) {
        o.atrapado = true;
        const ux = -dx / (dist || 1), uy = -dy / (dist || 1);
        // Pull towards the saucer and brake (stronger near the axis).
        const centro = 1 - Math.min(1, Math.abs(envolver(angAvion - o.ang)) / (APERTURA_TRACTOR + 0.1)) * 0.5;
        const tirar = lerp(85, 120, kd) * centro;
        const amort = lerp(1.0, 1.4, kd) * centro;
        res = { tractor: { fx: fin(ux * tirar - av.vx * amort), fy: fin(uy * tirar - av.vy * amort) } };
        // Dragged all the way in: a zap and it lets go.
        if (dist < radio(a) + rAvion + 8) {
          res = { laser: { x: av.x, y: av.y + 4 } };
          o.modoT = 0;
          a.vy += 120;
        }
      }
      if (o.modoT <= 0) {
        o.modo = 0;
        o.modoT = 0.4;
        o.tractorCd = lerp(8, 5, kd);
        a.cd = lerp(2.4, 1.2, kd);
      }
      break;
    }
  }
  if (!av.vivo && o.modo >= 4) {
    o.modo = 0;
    o.modoT = 1;
  }
  if (o.modo !== 2 && o.modo !== 3) o.alfa = 1;
  limitar(a, 900);
  a.ang += (clamp(-a.vx / 700, -0.3, 0.3) - a.ang) * Math.min(1, dt * 6);
  if (av.x > a.x + 6) a.mira = 1;
  else if (av.x < a.x - 6) a.mira = -1;
  return res;
}

/* ── Projectiles (for the engine) ───────────────────────────────────────── */

/** Lifetime per type, s. */
export const VIDA_PROYECTIL = { balin: 2.2, cohete: 3, mina: 9 } as const;
/** Hit radius per type, px (add the plane's radius). Mines go off by proximity. */
export const RADIO_PROYECTIL = { balin: 1.5, cohete: 2.5, mina: 7 } as const;

export function nuevoProyectil(d: Disparo): Proyectil {
  return { ...d, t: 0 };
}

/**
 * Moves a projectile: pellets fall ballistically, rockets fly straight (a
 * slight sag when slow), mines drift and sink slowly with a wobble. Returns
 * 'suelo' when it hits the ground, 'expira' when its life is over (mines
 * then burst), otherwise 'vuela'.
 */
export function pasoProyectil(p: Proyectil, dt: number, suelo: (x: number) => number, viento = 0): 'vuela' | 'suelo' | 'expira' {
  dt = clamp(fin(dt), 0, 0.1);
  p.t += dt;
  if (p.tipo === 'balin') p.vy -= G * dt;
  else if (p.tipo === 'cohete') p.vy -= G * 0.1 * dt;
  else {
    // Mine: drag towards drifting with the wind and sinking at 6 px/s.
    p.vx += (viento * 0.5 - p.vx) * Math.min(1, dt * 0.8);
    p.vy += (-6 + Math.sin(p.t * 2.3) * 5 - p.vy) * Math.min(1, dt * 1.2);
  }
  p.x += fin(p.vx) * dt;
  p.y += fin(p.vy) * dt;
  if (p.y <= fin(suelo(p.x))) return 'suelo';
  if (p.t >= VIDA_PROYECTIL[p.tipo]) return 'expira';
  return 'vuela';
}

/* ── Drawing ────────────────────────────────────────────────────────────── */

const V = '#b49af4', V0 = '#8064d8', V1 = '#e0d4ff', VINK = '#3a2a7a';

const R = (g: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};

/** A mouse looking RIGHT with its red helmet. (x, y) is the chin. */
function raton(g: Ctx, x: number, y: number) {
  D.disc(g, x - 1, y - 7, 2, '#c8c0d8');
  D.disc(g, x - 5, y - 6, 2, '#c8c0d8');
  R(g, x - 1, y - 7, 1, 1, P.p1);
  R(g, x - 5, y - 6, 1, 1, P.p1);
  D.oval(g, x, y - 3, 4, 3, '#e0d8ec');
  R(g, x + 4, y - 3, 2, 1, P.p0);
  R(g, x + 1, y - 4, 1, 1, P.eye);
  R(g, x - 1, y - 2, 1, 1, P.p2);
  R(g, x - 3, y - 6, 5, 1, P.r1);
  R(g, x - 3, y - 7, 4, 1, P.r1);
}

/** Helicopter body facing right, origin at its centre (no rotors). */
function pintarHeli(g: Ctx) {
  // Tail boom and fin.
  R(g, -16, -3, 12, 3, V0);
  R(g, -16, -3, 12, 1, V);
  R(g, -18, -8, 3, 7, V0);
  R(g, -17, -8, 1, 6, V);
  // Cabin.
  D.oval(g, 1, 0, 8, 6, V0);
  D.oval(g, 1, -1, 7, 5, V);
  R(g, -3, -5, 6, 1, V1);
  // Bubble window at the nose with the mouse pilot inside.
  D.oval(g, 6, -1, 5, 5, P.gl0);
  D.oval(g, 6, -1, 4, 4, P.gl1);
  raton(g, 3, 2);
  R(g, 8, -5, 2, 1, P.gl2);
  R(g, 10, -4, 1, 2, P.white);
  // Mast.
  R(g, 0, -9, 2, 4, P.metal0);
  // Rocket pod.
  R(g, -2, 4, 7, 2, P.metal0);
  R(g, 5, 4, 2, 2, P.red);
  // Skids.
  R(g, -3, 6, 1, 3, P.metal0);
  R(g, 4, 6, 1, 3, P.metal0);
  R(g, -6, 9, 13, 1, P.metal0);
  R(g, 7, 8, 1, 1, P.metal0);
}

/** Drone facing right, origin at its centre (no blades): a bumblebee pod with a mouse on top. */
function pintarDron(g: Ctx, enojado: boolean) {
  // Rotor struts.
  R(g, -5, -6, 1, 3, P.metal0);
  R(g, 5, -6, 1, 3, P.metal0);
  // Round pod with two gold stripes.
  D.oval(g, 0, 1, 5, 4, V0);
  D.oval(g, 0, 0, 5, 3, V);
  R(g, -3, -3, 2, 7, P.gold);
  R(g, 0, -3, 2, 7, P.gold);
  R(g, -3, 3, 2, 1, P.gold0);
  R(g, 0, 3, 2, 1, P.gold0);
  R(g, 2, -2, 2, 1, V1);
  // Stinger at the back, warhead nose at the front.
  R(g, -7, 1, 2, 1, VINK);
  R(g, 5, 0, 2, 2, enojado ? P.red : P.r2);
  // The mouse on top, helmet on.
  D.disc(g, -1, -6, 1, '#c8c0d8');
  R(g, -1, -6, 1, 1, P.p1);
  D.oval(g, 1, -4, 2, 1, '#e0d8ec');
  R(g, 3, -4, 1, 1, P.p0);
  R(g, 1, -5, 1, 1, enojado ? P.red : P.eye);
  R(g, -1, -6, 3, 1, P.r1);
}

/** Hot-air balloon, origin at the centre of the envelope. */
function pintarGlobo(g: Ctx) {
  // Envelope with pastel stripes.
  D.oval(g, 0, -2, 10, 11, P.p1);
  const fr = [P.p2, V, P.p2, V1];
  for (let y = -12; y <= 9; y++) {
    const w = Math.round(10 * Math.sqrt(Math.max(0, 1 - ((y + 2) * (y + 2)) / (11 * 11 + 6))));
    for (let x = -w; x <= w; x++) {
      const band = Math.floor(((x / Math.max(1, w)) * 2 + 2) * 1.0);
      if (Math.abs(x) <= w - 1) g.fillStyle = fr[clamp(band, 0, 3)];
      else continue;
      g.fillRect(x, y, 1, 1);
    }
  }
  R(g, -4, -11, 3, 2, P.white);
  // Skirt and ropes.
  R(g, -4, 9, 9, 2, P.p0);
  R(g, -4, 11, 1, 5, P.k0);
  R(g, 4, 11, 1, 5, P.k0);
  // Basket with the mouse.
  raton(g, 1, 15);
  R(g, -5, 15, 11, 5, P.k1);
  R(g, -5, 15, 11, 1, P.k3);
  R(g, -3, 17, 1, 2, P.k0);
  R(g, 1, 17, 1, 2, P.k0);
  R(g, 4, 17, 1, 2, P.k0);
  // A mine hanging, ready to drop.
  D.disc(g, -7, 19, 2, '#6a4a9a');
  R(g, -7, 19, 1, 1, P.red);
}

/** Saucer facing right, origin at the centre of the disc (no lights: they blink, drawn live). */
function pintarOvni(g: Ctx) {
  // Glass dome (behind the mouse) with a mint tint.
  D.oval(g, 0, -6, 10, 9, '#4aa8bc');
  D.oval(g, 0, -6, 9, 8, '#8ee0ec');
  D.oval(g, 1, -5, 7, 6, '#b8f4f8');
  // The mouse astronaut: round head, big pink ears, antennae with gold tips.
  R(g, -1, -13, 1, 4, '#5a4a96');
  R(g, 3, -13, 1, 4, '#5a4a96');
  R(g, -2, -15, 2, 2, P.gold);
  R(g, 3, -15, 2, 2, P.gold);
  R(g, -2, -15, 1, 1, P.gold1);
  D.disc(g, -5, -9, 3, '#8a7ab0');
  D.disc(g, -5, -9, 2, '#e6def2');
  R(g, -5, -9, 2, 2, P.p1);
  D.oval(g, 1, -5, 5, 4, '#8a7ab0');
  D.oval(g, 1, -5, 4, 3, '#eee8f8');
  R(g, 5, -5, 2, 2, '#eee8f8');
  R(g, 7, -5, 1, 1, P.p0);
  R(g, 1, -7, 1, 2, P.eye);
  R(g, 4, -7, 1, 2, P.eye);
  R(g, 1, -7, 1, 1, P.white);
  R(g, -2, -4, 2, 1, P.blush);
  R(g, 3, -3, 2, 1, P.p0);
  // Dome shine.
  R(g, -7, -11, 2, 1, P.white);
  R(g, -8, -9, 1, 2, P.white);
  // Disc: lilac top, pink rim band, darker belly.
  D.oval(g, 0, 2, 17, 5, '#8a5ac8');
  D.oval(g, 0, 1, 17, 4, P.p1);
  D.oval(g, 0, 0, 15, 3, '#d4b8ff');
  R(g, -13, -1, 26, 1, '#efe4ff');
  R(g, -9, -2, 18, 1, P.white);
  R(g, -16, 2, 33, 1, P.p0);
  // Belly and the beam emitter.
  D.oval(g, 0, 5, 9, 2, '#6a4aa8');
  D.oval(g, 0, 6, 4, 1, '#3a2a7a');
  R(g, -1, 7, 3, 1, '#8ff8e8');
}

/** A soft light halo around a sprite so it reads on the dark space sky. */
const halos = new Map<HTMLCanvasElement, HTMLCanvasElement>();
function halo(src: HTMLCanvasElement) {
  let c = halos.get(src);
  if (!c) {
    c = document.createElement('canvas');
    c.width = src.width + 4;
    c.height = src.height + 4;
    const g = c.getContext('2d')!;
    const capa = (offs: number[][], color: string, alfa: number) => {
      const t = document.createElement('canvas');
      t.width = c!.width;
      t.height = c!.height;
      const q = t.getContext('2d')!;
      for (const [dx, dy] of offs) q.drawImage(src, 2 + dx, 2 + dy);
      q.globalCompositeOperation = 'source-in';
      q.fillStyle = color;
      q.fillRect(0, 0, t.width, t.height);
      g.globalAlpha = alfa;
      g.drawImage(t, 0, 0);
    };
    // A faint lilac glow two pixels out and a bright rim one pixel out.
    capa([[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]], '#9a7af0', 0.45);
    capa([[-1, 0], [1, 0], [0, -1], [0, 1]], '#f4eeff', 0.9);
    halos.set(src, c);
  }
  return c;
}

const LUCES = ['#ff6a8a', '#ffe048', '#7af0c8', '#8ab8ff', '#ffb0f0'];

/** Blinking rim lights (running chase), in the sprite's frame. */
function lucesOvni(g: Ctx, t: number, semilla: number, alerta: boolean) {
  const xs = [-13, -7, -1, 5, 11];
  const paso_ = Math.floor(t * (alerta ? 14 : 6) + semilla * 10);
  for (let i = 0; i < xs.length; i++) {
    const on = (paso_ + i) % 3 !== 0;
    const c = alerta ? (paso_ % 2 ? P.red : P.white) : LUCES[(i + Math.floor(paso_ / 3)) % LUCES.length];
    R(g, xs[i], 3, 3, 2, on ? c : '#5a3a8a');
    if (on) R(g, xs[i], 3, 1, 1, P.white);
  }
}

/** "!" over an enemy that's about to fire (screen space, (x, y) is its top). */
function exclamacion(g: Ctx, x: number, y: number, t: number) {
  if (Math.floor(t * 10) % 2) return;
  x = Math.round(x);
  y = Math.round(y);
  R(g, x - 1, y - 1, 4, 7, P.white);
  R(g, x - 1, y + 7, 4, 4, P.white);
  R(g, x, y, 2, 5, P.red);
  R(g, x, y + 8, 2, 2, P.red);
}

type Hoja = { img: HTMLCanvasElement; ox: number; oy: number };
function hoja(tipo: TipoAereo, var_: number): Hoja {
  if (tipo === 'helicoptero') return { img: D.outlined('aereo|heli', VINK, 40, 24, 20, 12, pintarHeli), ox: 20, oy: 12 };
  if (tipo === 'ovni') return { img: D.outlined('aereo|ovni', VINK, 40, 30, 20, 17, pintarOvni), ox: 20, oy: 17 };
  if (tipo === 'dron') return { img: D.outlined(`aereo|dron|${var_}`, VINK, 20, 18, 10, 9, (g) => pintarDron(g, var_ === 1)), ox: 10, oy: 9 };
  return { img: D.outlined('aereo|globo', '#7a2a5a', 28, 38, 14, 15, pintarGlobo), ox: 14, oy: 15 };
}

const blancos = new Map<HTMLCanvasElement, HTMLCanvasElement>();
function blanco(src: HTMLCanvasElement) {
  let c = blancos.get(src);
  if (!c) {
    c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    blancos.set(src, c);
  }
  return c;
}

const ASPA_K = [1, 0.6, 0.2, 0.6];
/**
 * Spinning blade seen edge-on: its visible length cycles over 4 frames, over
 * a faint blur disc (the swept area, a row thick, flickering a row up and
 * down so it reads as a spinning disc and not a stick) with glints at the tips.
 */
function aspa(g: Ctx, cx: number, cy: number, largo: number, t: number, vel: number) {
  const f = Math.floor(t * vel) % 4;
  const L = Math.round(largo * ASPA_K[f]);
  const a0 = g.globalAlpha;
  g.globalAlpha = a0 * 0.35;
  R(g, cx - largo, cy, largo * 2 + 1, 1, P.white);
  if (largo > 4) {
    g.globalAlpha = a0 * 0.18;
    R(g, cx - largo + 2, cy + (f & 1 ? -1 : 1), largo * 2 - 3, 1, P.white);
  }
  g.globalAlpha = a0;
  R(g, cx - L, cy, L * 2 + 1, 1, VINK);
  if (L > 2) R(g, cx - L + 1, cy, L * 2 - 1, 1, P.metal);
  // Tip glints catch the light once a turn.
  if (f === 0 && largo > 4) {
    R(g, cx - largo - 1, cy, 1, 1, P.white);
    R(g, cx + largo + 1, cy, 1, 1, P.white);
  }
  R(g, cx - 1, cy - 1, 3, 2, P.metal0);
  R(g, cx - 1, cy - 1, 1, 1, P.metal);
}

/**
 * Draws an aircraft centred on screen (sx, sy) (screen y down). `flash`
 * shows the white hit silhouette.
 */
export function dibujar(g: Ctx, a: Aereo, sx: number, sy: number, t: number, flash: boolean): void {
  const avisando = (a.aviso ?? 0) > 0;
  const h = hoja(a.tipo, a.tipo === 'dron' && (a.fase === 1 || avisando) ? 1 : 0);
  g.save();
  g.translate(Math.round(sx), Math.round(sy + (a.tipo === 'globo' ? Math.round(Math.sin(t * 1.5 + a.semilla * 9)) : 0)));
  g.rotate(Math.round(-a.ang / 0.06) * 0.06);
  g.scale(a.mira, 1);
  if (a.tipo === 'ovni') {
    const o = a.ov;
    const alfa = o ? o.alfa : 1;
    if (alfa < 1) {
      // Teleport: it flickers and squashes into a line of light.
      g.globalAlpha = Math.floor(t * 30) % 2 ? alfa : alfa * 0.5;
      g.scale(1 + (1 - alfa) * 0.8, Math.max(0.15, alfa));
    }
    const bob = Math.round(Math.sin(t * 3 + a.semilla * 9));
    g.translate(0, bob);
    g.drawImage(halo(h.img), -h.ox - 2, -h.oy - 2);
    g.globalAlpha = alfa < 1 ? (Math.floor(t * 30) % 2 ? alfa : alfa * 0.5) : 1;
    g.drawImage(flash ? blanco(h.img) : h.img, -h.ox, -h.oy);
    const alerta = !!o && (o.modo === 4 || o.modo === 5 || o.modo === 6);
    if (!flash) lucesOvni(g, t, a.semilla, alerta);
    // The emitter glows while charging / firing.
    if (o && o.modo >= 4) {
      const c = o.modo <= 5 ? '#ff5a8a' : '#7af0c8';
      const f = Math.floor(t * 16) % 2;
      R(g, -2 - f, 6, 5 + f * 2, 2, c);
      R(g, -1, 6, 3, 1, P.white);
    }
    if (alfa < 1) {
      g.globalAlpha = 1;
      R(g, -18, 0, 37, 1, '#e8fcff');
    }
  } else {
    g.drawImage(flash ? blanco(h.img) : h.img, -h.ox, -h.oy);
  }
  if (a.tipo === 'helicoptero') {
    aspa(g, 1, -10, 13, t + a.semilla, 36);
    // Tail rotor: a little spinning cross.
    const f = Math.floor((t + a.semilla) * 30) % 2;
    R(g, -18, -10 + f, 1, 4 - f * 2, VINK);
    R(g, -19 - (1 - f), -8, 3 - f * 2 + 2, 1, P.metal);
    // Anti-collision beacon on the fin: a red double blink (aviation-style), with a halo.
    const fb = (t * 0.8 + a.semilla) % 1;
    if (!flash && (fb < 0.05 || (fb > 0.11 && fb < 0.16))) {
      g.globalAlpha = 0.4;
      R(g, -18, -10, 3, 3, P.red);
      g.globalAlpha = 1;
      R(g, -17, -9, 1, 1, P.white);
    }
    // Turbine exhaust: a heat puff drifting back off the engine.
    for (let i = 0; i < 2; i++) {
      const ph = (t * 1.8 + i * 0.5 + a.semilla) % 1;
      if (ph > 0.6) continue;
      g.globalAlpha = ph < 0.3 ? 0.45 : 0.22;
      R(g, Math.round(-5 - ph * 8), Math.round(-6 - ph * 3), ph < 0.25 ? 1 : 2, 1, '#d4cce4');
    }
    g.globalAlpha = 1;
    // About to fire: the gun blinks.
    if (avisando && Math.floor(t * 14) % 2 === 0) {
      R(g, 9, -6, 4, 4, P.white);
      R(g, 10, -5, 2, 2, P.red);
      R(g, 4, 3, 4, 4, P.white);
      R(g, 5, 4, 2, 2, P.red);
    }
  } else if (a.tipo === 'dron') {
    aspa(g, -5, -7, 3, t * 1.3 + a.semilla, 50);
    aspa(g, 4, -7, 3, t * 1.3 + a.semilla + 0.37, 50);
    if (a.fase === 1 && Math.floor(t * 12) % 2 === 0) R(g, -8, -1, 2, 2, P.gold);
    // A tiny status LED on the pod: slow green pulse while cruising.
    else if (!flash && a.fase !== 1 && Math.floor(t * 2 + a.semilla * 4) % 3 === 0) R(g, -3, 1, 1, 1, '#7af0c8');
    if (avisando && Math.floor(t * 16) % 2 === 0) {
      R(g, 6, -1, 3, 3, P.white);
      R(g, 7, 0, 1, 1, P.red);
    }
  } else if (a.tipo === 'globo') {
    // Burner flame flickers over the basket; every few seconds it roars (a taller
    // flame that lights the inside of the envelope from below, warm).
    const f = Math.floor(t * 10 + a.semilla * 5) % 3;
    const ruge = (t * 0.35 + a.semilla) % 1 < 0.14;
    if (ruge && !flash) {
      g.globalAlpha = 0.35 + (f === 1 ? 0.1 : 0);
      D.oval(g, 0, 6, 6, 3, '#ffb060');
      g.globalAlpha = 1;
      R(g, 0, 7 - f, 2, 5 + f, '#ff9a3c');
      R(g, 0, 8 - f, 2, 3 + f, P.gold);
      R(g, 0, 10, 1, 1, P.white);
    } else {
      R(g, 0, 11 - f, 2, 1 + f, P.gold);
      R(g, 0, 12, 2, 1, '#ff9a3c');
    }
    // The mine about to drop blinks red/white.
    if (avisando) {
      const on = Math.floor(t * 12) % 2 === 0;
      D.disc(g, -7, 19, 3, on ? P.white : P.red);
      R(g, -7, 19, 1, 1, on ? P.red : P.white);
    }
  }
  g.restore();
  if (avisando && a.tipo !== 'dron') exclamacion(g, sx - 1, sy - (a.tipo === 'globo' ? 30 : 22), t);
}

/**
 * Draws a saucer's laser (aim line while charging, the beam while firing)
 * or its tractor beam (flickering cone outline while charging, the cone
 * while on). Call it after `dibujar` with the same screen centre (sx, sy).
 * Does nothing for other types or when the saucer is idle.
 */
export function dibujarRayo(g: Ctx, a: Aereo, sx: number, sy: number, t: number): void {
  const o = a.ov;
  if (a.tipo !== 'ovni' || !o || o.modo < 4 || a.hp <= 0) return;
  const ox = Math.round(sx), oy = Math.round(sy + 7 + Math.round(Math.sin(t * 3 + a.semilla * 9)));
  // World angle (y up) → screen direction (y down).
  const ux = Math.cos(o.ang), uy = -Math.sin(o.ang);
  g.save();
  if (o.modo === 4) {
    // Aim line: thin, dashed, blinking faster as the shot gets closer.
    const k = 1 - clamp(o.modoT / AVISO_RAYO, 0, 1);
    const vel = 6 + k * 18;
    if (Math.floor(t * vel) % 2 === 0 || k > 0.85) {
      g.fillStyle = k > 0.7 ? P.white : '#ff6a9a';
      const L = o.largo;
      for (let s = 4; s < L; s += 4) if ((s / 4 + Math.floor(t * 20)) % 2 < 1) g.fillRect(Math.round(ox + ux * s), Math.round(oy + uy * s), 2, 2);
    }
    // Reticle on the locked point (if it's within reach).
    const L = Math.min(o.largo, Math.hypot(o.bx - a.x, o.by - a.y));
    const rx = Math.round(ox + ux * L), ry = Math.round(oy + uy * L);
    const r = Math.round(lerp(9, 4, k));
    g.fillStyle = Math.floor(t * 12) % 2 ? '#ff4a6a' : P.white;
    g.fillRect(rx - r, ry, 3, 1);
    g.fillRect(rx + r - 2, ry, 3, 1);
    g.fillRect(rx, ry - r, 1, 3);
    g.fillRect(rx, ry + r - 2, 1, 3);
    // Charging orb under the saucer.
    D.disc(g, ox, oy + 1, Math.round(1 + k * 3), '#ff7aa8');
    D.disc(g, ox, oy + 1, Math.round(k * 2), P.white);
  } else if (o.modo === 5) {
    const L = o.largo;
    const ex = ox + ux * L, ey = oy + uy * L;
    const f = Math.floor(t * 30) % 2;
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(255,74,138,0.35)';
    g.lineWidth = 9 + f * 2;
    linea(g, ox, oy, ex, ey);
    g.strokeStyle = '#ff5a96';
    g.lineWidth = 5;
    linea(g, ox, oy, ex, ey);
    g.strokeStyle = f ? P.white : '#ffe4f0';
    g.lineWidth = 2;
    linea(g, ox, oy, ex, ey);
    D.disc(g, ox, oy + 1, 4, '#ff5a96');
    D.disc(g, ox, oy + 1, 2, P.white);
    D.disc(g, Math.round(ex), Math.round(ey), 3 + f, '#ffb0d0');
    D.disc(g, Math.round(ex), Math.round(ey), 1 + f, P.white);
  } else {
    // Tractor cone.
    const L = LARGO_TRACTOR;
    const a1 = o.ang - APERTURA_TRACTOR, a2 = o.ang + APERTURA_TRACTOR;
    const p1 = { x: ox + Math.cos(a1) * L, y: oy - Math.sin(a1) * L };
    const p2 = { x: ox + Math.cos(a2) * L, y: oy - Math.sin(a2) * L };
    if (o.modo === 6) {
      if (Math.floor(t * 12) % 2 === 0) {
        g.fillStyle = '#7af0c8';
        for (let s = 6; s < L; s += 5) {
          for (const an of [a1, a2]) g.fillRect(Math.round(ox + Math.cos(an) * s), Math.round(oy - Math.sin(an) * s), 2, 2);
        }
      }
    } else {
      const grad = g.createLinearGradient(ox, oy, ox + ux * L, oy + uy * L);
      grad.addColorStop(0, o.atrapado ? 'rgba(160,255,220,0.55)' : 'rgba(122,240,200,0.4)');
      grad.addColorStop(1, 'rgba(122,240,200,0.04)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ox - 3, oy);
      g.lineTo(p1.x, p1.y);
      g.lineTo(p2.x, p2.y);
      g.lineTo(ox + 3, oy);
      g.closePath();
      g.fill();
      // Rings rising up the beam.
      g.fillStyle = 'rgba(220,255,245,0.8)';
      for (let i = 0; i < 5; i++) {
        const s = L * (1 - (((t * 0.9 + i / 5) % 1)));
        const w = Math.tan(APERTURA_TRACTOR) * s;
        const cx = ox + ux * s, cy = oy + uy * s;
        for (let j = -w; j <= w; j += 3) g.fillRect(Math.round(cx - uy * j), Math.round(cy + ux * j), 2, 1);
      }
      // Bright edges.
      g.fillStyle = '#c8fff0';
      for (let s = 4; s < L; s += 3) for (const an of [a1, a2]) g.fillRect(Math.round(ox + Math.cos(an) * s), Math.round(oy - Math.sin(an) * s), 1, 1);
    }
  }
  g.restore();
}

function linea(g: Ctx, x0: number, y0: number, x1: number, y1: number) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

/** Draws a projectile from this module at screen (sx, sy). */
export function dibujarProyectil(g: Ctx, p: Proyectil, sx: number, sy: number, t: number): void {
  const x = Math.round(sx), y = Math.round(sy);
  if (p.tipo === 'balin' && p.trazador) {
    // Machine-gun tracer: a hot streak along its flight.
    const v = Math.hypot(p.vx, p.vy) || 1;
    // Thicker, with a dark outline so it reads on sunset pinks and lilacs.
    for (let i = 1; i <= 5; i++) {
      const tx = Math.round(x - (p.vx / v) * i * 2), ty = Math.round(y + (p.vy / v) * i * 2);
      R(g, tx - 1, ty - 1, 3, 3, '#3a1a2a');
      R(g, tx, ty, 2, 1, i < 2 ? '#fff2a8' : i < 4 ? '#ff9a3c' : '#ff4a5a');
    }
    R(g, x - 1, y - 1, 4, 3, '#3a1a2a');
    R(g, x, y, 2, 1, P.white);
  } else if (p.tipo === 'balin') {
    R(g, x - 1, y - 1, 3, 3, '#a0402a');
    R(g, x - 1, y - 1, 2, 2, P.gold);
    R(g, x - 1, y - 1, 1, 1, P.gold1);
  } else if (p.tipo === 'cohete') {
    const ang = Math.atan2(-p.vy, p.vx);
    g.save();
    g.translate(x, y);
    g.rotate(Math.round(ang / 0.1) * 0.1);
    R(g, -3, -1, 6, 3, VINK);
    R(g, -2, -1, 5, 2, P.p2);
    R(g, 2, -1, 1, 2, P.r1);
    const f = Math.floor(t * 30) % 2;
    R(g, -5 - f, -1, 2 + f, 2, '#ff9a3c');
    R(g, -4, 0, 1, 1, P.gold);
    g.restore();
  } else {
    // A floating mine: a spiky lilac ball with a blinking light.
    D.disc(g, x, y, 3, VINK);
    D.disc(g, x, y, 2, '#8a6ac8');
    R(g, x - 1, y - 2, 1, 1, V1);
    for (const [dx, dy] of [[0, -5], [0, 4], [-5, 0], [4, 0]]) R(g, x + dx, y + dy, dx ? 2 : 1, dy ? 2 : 1, VINK);
    if (Math.floor(t * 4 + p.x * 0.01) % 2 === 0) R(g, x, y - 1, 1, 1, P.red);
  }
}
