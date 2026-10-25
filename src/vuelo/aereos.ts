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
 *
 * Physics in world units (px, s, y = ALTITUDE up, angles CCW). `paso` only
 * moves the one aircraft it's given (it reads `todos` for flocking) and
 * returns the projectiles it fired; the engine owns them (see `Proyectil`,
 * `pasoProyectil`, `dibujarProyectil` below, so integrating is a few lines).
 */

type Ctx = CanvasRenderingContext2D;

export type TipoAereo = 'helicoptero' | 'dron' | 'globo';

export type Aereo = {
  id: number;
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
};

export type Disparo = { x: number; y: number; vx: number; vy: number; tipo: 'balin' | 'cohete' | 'mina' };
export type Proyectil = Disparo & { t: number };

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const G = GRAVEDAD;
const TECHO = 360;

let siguienteId = 1;
let siguienteGrupo = 1;

const HP: Record<TipoAereo, number> = { helicoptero: 3, dron: 1, globo: 2 };

/** Collision radius, px. */
export function radio(a: Aereo): number {
  return a.tipo === 'helicoptero' ? 10 : a.tipo === 'dron' ? 5 : 10;
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

/** Which aircraft come in each wave (none in wave 1). Each `dron` entry is a whole swarm. */
export function elegirAereos(ola: number, rnd: () => number = Math.random): TipoAereo[] {
  const n = Math.floor(fin(ola, 1));
  if (n < 2) return [];
  const cuantos = Math.min(6, 1 + Math.floor((n - 2) * 0.6 + rnd() * 0.8));
  const out: TipoAereo[] = [];
  for (let i = 0; i < cuantos; i++) {
    const r = rnd();
    if (n === 2) out.push(i === 0 ? (r < 0.5 ? 'helicoptero' : 'dron') : 'helicoptero');
    else if (n < 4) out.push(r < 0.55 ? 'helicoptero' : 'dron');
    else out.push(r < 0.4 ? 'helicoptero' : r < 0.75 ? 'dron' : 'globo');
  }
  return out;
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
  if (a.y > TECHO) a.vy -= (a.y - TECHO) * 10 * dt;
}

function apuntar(desde: { x: number; y: number }, vel: number, grav: boolean, av: { x: number; y: number; vx: number; vy: number }, err: number) {
  const sol = solucionTiro(desde, vel, av, grav);
  if (!sol) return null;
  // A tiny, deterministic-ish wobble so bursts spread a little.
  const ang = Math.atan2(sol.vy, sol.vx) + err;
  return { vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel };
}

/* ── One step ───────────────────────────────────────────────────────────── */

export type ResultadoPaso = { disparos?: Disparo[]; embestida?: boolean };

export function paso(a: Aereo, todos: Aereo[], vista: Vista, dt: number): ResultadoPaso {
  dt = clamp(fin(dt), 0, 0.1);
  a.x = fin(a.x);
  a.y = fin(a.y, 150);
  a.vx = fin(a.vx);
  a.vy = fin(a.vy);
  a.t += dt;
  if (a.hp <= 0 || dt === 0) return {};
  const r = a.tipo === 'helicoptero' ? pasoHeli(a, todos, vista, dt) : a.tipo === 'dron' ? pasoDron(a, todos, vista, dt) : pasoGlobo(a, todos, vista, dt);
  a.x += a.vx * dt;
  a.y += a.vy * dt;
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
  const vMax = lerp(85, 115, k);
  // Hover point: on our side of the plane, at stand-off range, a bit above.
  const px = av.x + av.vx * 0.6, py = av.y + av.vy * 0.4;
  const lado = a.x >= px ? 1 : -1;
  const distDeseada = lerp(135, 95, k) + Math.sin(a.t * 0.7 + a.semilla * 6) * 20;
  const tx = px + lado * distDeseada;
  const ty = clamp(py + 20 + Math.sin(a.t * 1.3 + a.semilla * 9) * 12, fin(vista.suelo(tx)) + 40, TECHO - 10);
  let wx = (tx - a.x) * 1.5, wy = (ty - a.y) * 1.5;
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
  dirigir(a, wx, wy, lerp(110, 150, k), dt);
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
  if (a.rafaga <= 0 && a.cd <= 0 && av.vivo && dist < lerp(220, 270, k) && Math.sign(dx) === a.mira && lineaLibre(a.x, a.y, av.x, av.y, vista.suelo)) {
    a.salvas++;
    const cohetes = a.ola >= 3 && a.salvas % 2 === 0;
    a.rafaga = cohetes ? (a.ola >= 6 ? 3 : 2) : a.ola >= 5 ? 4 : 3;
    a.rafT = 0;
    a.cd = lerp(2.8, 1.5, k) + a.semilla * 0.6;
    a.faseT = cohetes ? 1 : 0; // remembers what this burst fires
  }
  if (a.rafaga > 0) {
    a.rafT -= dt;
    if (a.rafT <= 0) {
      const cohete = a.faseT === 1;
      const boca = { x: a.x + a.mira * 8, y: a.y - 4 };
      const n = a.rafaga;
      // Not snipers: the lead is partial and the burst fans out, so a plane
      // that keeps turning or jinks gets missed; one that flies straight, not.
      const err = (n % 2 === 0 ? 1 : -1) * (0.05 + 0.035 * n) * (1 - 0.4 * k);
      const f = lerp(0.45, 0.85, k) + 0.15 * Math.sin(a.salvas * 2.1 + a.semilla * 5);
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
  const rAvion = vista.radioAvion ?? 9;

  // Kamikaze hit.
  if (av.vivo && Math.hypot(av.x - a.x, av.y - a.y) < radio(a) + rAvion) {
    a.hp = 0;
    return { embestida: true };
  }

  // Phases: circle the plane → dive at it → pull away → circle…
  a.faseT -= dt;
  if (a.fase === 0 && a.faseT <= 0 && av.vivo) {
    a.fase = 1;
    a.faseT = 1.8;
  } else if (a.fase === 1 && (a.faseT <= 0 || !av.vivo)) {
    a.fase = 2;
    a.faseT = 0.7;
  } else if (a.fase === 2 && a.faseT <= 0) {
    a.fase = 0;
    a.faseT = lerp(3.2, 1.6, k) + a.semilla * 1.5;
  }

  let wx: number, wy: number, vMax: number;
  if (a.fase === 1) {
    // Pursuit with lead (intercept where the plane will be).
    vMax = Math.min(205, lerp(165, 195, k) + a.ola * 1.5);
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
    const fase = a.t * 1.4 * a.lado + a.grupo * 2.1;
    const ox = av.x + av.vx * 0.5 + Math.cos(fase) * radioOrbita;
    const oy = clamp(av.y + av.vy * 0.3 + Math.sin(fase) * radioOrbita * 0.6 + 25, fin(vista.suelo(av.x)) + 30, TECHO);
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
    wx += (cx / n - a.x) * 0.8 + (ax / n - a.vx) * 0.35;
    wy += (cy / n - a.y) * 0.8 + (ay / n - a.vy) * 0.35;
  }
  const sep = separacion(a, todos, 16);
  wx += sep.sx * 260;
  wy += sep.sy * 260;

  dirigir(a, wx, wy, lerp(240, 320, k), dt);
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
  const ty = clamp(av.y + 45, fin(vista.suelo(a.x)) + 70, TECHO - 20);
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
  if (a.cd <= 0 && av.vivo && Math.abs(dx) < 260) {
    a.cd = lerp(3.4, 2, k) + a.semilla;
    return { disparos: [{ x: a.x, y: a.y - 18, vx: a.vx + clamp(dx * 0.1, -15, 15), vy: -12, tipo: 'mina' }] };
  }
  return {};
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

type Hoja = { img: HTMLCanvasElement; ox: number; oy: number };
function hoja(tipo: TipoAereo, var_: number): Hoja {
  if (tipo === 'helicoptero') return { img: D.outlined('aereo|heli', VINK, 40, 24, 20, 12, pintarHeli), ox: 20, oy: 12 };
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

/** Spinning blade seen edge-on: its visible length cycles. */
function aspa(g: Ctx, cx: number, cy: number, largo: number, t: number, vel: number) {
  const f = Math.floor(t * vel) % 4;
  const L = Math.round(largo * [1, 0.6, 0.2, 0.6][f]);
  g.globalAlpha = 0.35;
  R(g, cx - largo, cy, largo * 2 + 1, 1, P.white);
  g.globalAlpha = 1;
  R(g, cx - L, cy, L * 2 + 1, 1, VINK);
  if (L > 2) R(g, cx - L + 1, cy, L * 2 - 1, 1, P.metal);
  R(g, cx - 1, cy - 1, 3, 2, P.metal0);
}

/**
 * Draws an aircraft centred on screen (sx, sy) (screen y down). `flash`
 * shows the white hit silhouette.
 */
export function dibujar(g: Ctx, a: Aereo, sx: number, sy: number, t: number, flash: boolean): void {
  const h = hoja(a.tipo, a.tipo === 'dron' && a.fase === 1 ? 1 : 0);
  g.save();
  g.translate(Math.round(sx), Math.round(sy + (a.tipo === 'globo' ? Math.round(Math.sin(t * 1.5 + a.semilla * 9)) : 0)));
  g.rotate(Math.round(-a.ang / 0.06) * 0.06);
  g.scale(a.mira, 1);
  g.drawImage(flash ? blanco(h.img) : h.img, -h.ox, -h.oy);
  if (a.tipo === 'helicoptero') {
    aspa(g, 1, -10, 13, t + a.semilla, 36);
    // Tail rotor: a little spinning cross.
    const f = Math.floor((t + a.semilla) * 30) % 2;
    R(g, -18, -10 + f, 1, 4 - f * 2, VINK);
    R(g, -19 - (1 - f), -8, 3 - f * 2 + 2, 1, P.metal);
  } else if (a.tipo === 'dron') {
    aspa(g, -5, -7, 3, t * 1.3 + a.semilla, 50);
    aspa(g, 4, -7, 3, t * 1.3 + a.semilla + 0.37, 50);
    if (a.fase === 1 && Math.floor(t * 12) % 2 === 0) R(g, -8, -1, 2, 2, P.gold);
  } else {
    // Burner flame flickers over the basket.
    const f = Math.floor(t * 10 + a.semilla * 5) % 3;
    R(g, 0, 11 - f, 2, 1 + f, P.gold);
    R(g, 0, 12, 2, 1, '#ff9a3c');
  }
  g.restore();
}

/** Draws a projectile from this module at screen (sx, sy). */
export function dibujarProyectil(g: Ctx, p: Proyectil, sx: number, sy: number, t: number): void {
  const x = Math.round(sx), y = Math.round(sy);
  if (p.tipo === 'balin') {
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
