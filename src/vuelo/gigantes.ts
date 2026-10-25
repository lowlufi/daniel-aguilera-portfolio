import * as D from '../game/dulce';
import { P } from '../game/dulce';
import * as FA from './fisica-armas';
import type { Vehiculo } from './fisica-tipos';
import { adelanto, lineaLibre, nivelIA, type Vista } from './ia';
import { elegirArmamento, type TipoMisil } from './misiles';

/*
 * Ground units by size, all driven (or walked) by mice, in the "dulce" look:
 *
 *  - moto (small): a mouse on a lilac scooter. 1 hit. Comes in packs of 2–3,
 *    weaves (speed swings + little hops), dodges bombs and fires unguided
 *    rockets with lead after a short blink.
 *  - infanteria (small): 2–4 mice on foot, 1 hit each. Rifle (bursts of
 *    pellets with lead, ~200 px) or bazooka (kneels and aims 0.5 s, then a
 *    rocket). They run, take cover in craters / under bridges, scatter and hit
 *    the dirt when a bomb is coming, and fly through the air with blasts
 *    (simple ragdoll). Mice also jump out of wrecked vehicles: `desembarcar`.
 *  - tren (huge): armoured train, locomotive + 2–3 wagons (missile launcher,
 *    twin flak). Each car has its own hp; a destroyed wagon is left behind as
 *    a burning wreck and the rest of the train couples up and keeps going. A
 *    dead locomotive stops the train (its crew jumps off). Chimney smoke.
 *  - ratonzilla (giant, mini-boss): a ~120 px super-tank (4× a normal tank)
 *    with 5 parts: two missile turrets, the main cannon, the tracks and the
 *    command tower with a mouse general in a peaked cap. A dead part stays as
 *    a smoking stump and stops firing; dead tracks immobilise it (the crew
 *    bails out). Destroying the tower, or every other part, sets off a big
 *    chain of explosions.
 *
 * Visible damage, per part, from its hp fraction: < 75 % dents and scorch
 * marks, < 50 % grey smoke, < 25 % fire and sparks, 0 → torn-off stump with
 * dark smoke. Parts that die are thrown off as debris (`eventos.pieza`).
 *
 * Units as everywhere in /vuelo: px, s, y = ALTITUDE (up), angles CCW. Units
 * drive LEFT towards the pantry.
 *
 * ── Integration (motor.ts) ────────────────────────────────────────────────
 *   s.gigantes: G.Unidad[]
 *   spawn:   for (const t of G.elegirGrandes(ola)) s.gigantes.push(...G.crear(t, x, ground, Math.random, ola))
 *   step:    const r = G.paso(u, vista, dt, ground, { metaX: META_X, disparar: play && onScreen, coberturas })
 *            r.disparos → see `Disparo` (MS.lanzar / AE.nuevoProyectil / s.shells)
 *            r.eventos  → see `Evento` (VFX.pieza / blast / VFX.restos / desembarcar / VFX.fuego)
 *            r.llego    → like a car reaching META_X (s.meta -= G.ROBO[u.tipo])
 *            drop units with u.quitar
 *   hits:    player missile touching G.caja(u) (only if u.viva) → G.golpear(u, x, y, 2.5)
 *   blasts:  inside blast(): for (const u of s.gigantes) G.explotar(u, x, y, energy, from === 'jugador' ? damage : 0)
 *            (with damage 0 it only pushes: mice fly with any blast)
 *            both return { puntos, eventos, muerta } — award puntos, run eventos.
 *   draw:    G.dibujar(g, u, sx, sy, s.t, flash)   (sx, sy: world → screen)
 *   wrecks:  when a car hp <= 0 (or it's stuck, or the plane passes low):
 *            s.gigantes.push(...G.desembarcar(c.x, c.y, n, Math.random, s.wave))
 */

type Ctx = CanvasRenderingContext2D;

export type TipoGrande = 'moto' | 'infanteria' | 'tren' | 'ratonzilla';

/** What a part does: weapons fire, 'motor' drives, 'cabina' is the brain, the rest is armour. */
export type Rol = 'raton' | 'moto' | 'motor' | 'misil' | 'antiaereo' | 'canon' | 'orugas' | 'cabina';

export type Parte = {
  nombre: string;
  rol: Rol;
  /** Centre of the part relative to the unit's origin (dx right, dy up), px. For train cars dx is the coupling offset. */
  dx: number;
  dy: number;
  w: number;
  h: number;
  hp: number;
  hpMax: number;
  viva: boolean;
  /** World centre and tilt (updated by `paso`). */
  wx: number;
  wy: number;
  ang: number;
  /** Reload, telegraph (seconds left before the shot; draw a blink while > 0), hit flash, shots left in the burst. */
  cd: number;
  aviso: number;
  flash: number;
  tiros: number;
  /** Visual recoil of the barrel, px. */
  retro: number;
  /** Shots fired so far (the cannon fires a heavy missile every third time). */
  cuenta: number;
};

export type EstadoInf = 'corre' | 'apunta' | 'dispara' | 'cubre' | 'tierra' | 'aire' | 'muerto';

export type Unidad = {
  id: number;
  tipo: TipoGrande;
  /** Ground-contact point (for the train: the locomotive's). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Tilt, rad CCW. */
  ang: number;
  partes: Parte[];
  /** Alive (can be hit, shoots). Dead units may still animate (ragdoll, chain explosions). */
  viva: boolean;
  /** The engine should drop it from the list. */
  quitar: boolean;
  t: number;
  ola: number;
  semilla: number;
  rng: number;
  /** Wheel/track physics (moto, tren, ratonzilla). */
  veh: Vehiculo | null;
  /** Distance driven or walked (wheel and leg animation). */
  rueda: number;
  /** Main weapon aim, world angle (rad CCW). */
  aim: number;
  /** Infantry. */
  estado: EstadoInf;
  estadoT: number;
  mira: 1 | -1;
  arma: 'fusil' | 'bazuca' | null;
  giro: number;
  spin: number;
  huye: number;
  huyeT: number;
  reac: number;
  cubreX: number;
  /** Moto hop timer. */
  saltoT: number;
  /** Death sequence (tren / ratonzilla), and next chain explosion. */
  muerteT: number;
  sigExp: number;
  /** Crew already bailed out. */
  bajaron: boolean;
  /** One-off "jump off when the plane passes low". */
  sustoT: number;
};

/** Shots: the engine creates them. */
export type Disparo =
  /** A real missile: `MS.lanzar(tipo, x, y, plane, ola, rnd, desvio)` → s.shots (tgt: plane unless 'cohete'). */
  | { clase: 'misil'; tipo: TipoMisil; x: number; y: number; desvio: number }
  /** A pellet or an unguided rocket: `AE.nuevoProyectil({ x, y, vx, vy, tipo })` → s.proy. */
  | { clase: 'proyectil'; tipo: 'balin' | 'cohete'; x: number; y: number; vx: number; vy: number }
  /** A time-fused flak shell: s.shells.push({ x, y, vx, vy, t: 0, fuse }). */
  | { clase: 'obus'; x: number; y: number; vx: number; vy: number; fuse: number };

export type Evento = {
  /** A part thrown off: VFX.pieza(fx, x, y, vx, vy, sprite, color). */
  pieza?: { x: number; y: number; vx: number; vy: number; sprite: HTMLCanvasElement | null; color: string };
  /** An explosion: blast(x, y, energia, 'nadie', 0) (or 'jugador' with ~0.8 to let chains hurt neighbours). */
  explosion?: { x: number; y: number; energia: number };
  /** Burning scrap left on the ground: VFX.restos(fx, x, yAlt, ancho). */
  restos?: { x: number; y: number; ancho: number };
  /** Mice jumping out: s.gigantes.push(...desembarcar(x, y, n, rnd, ola)). */
  desembarco?: { x: number; y: number; n: number };
  /** Optional extra flames this frame from a badly hurt part: VFX.fuego(fx, x, y, 0, 0, k). */
  fuego?: { x: number; y: number; k: number };
};

export type ResultadoPaso = { disparos?: Disparo[]; eventos?: Evento[]; llego?: boolean };
export type ResultadoGolpe = { muerta: boolean; parte?: string; puntos: number; eventos: Evento[] };

export type OpcionesPaso = {
  /** x of the pantry: reaching it sets `llego`. */
  metaX?: number;
  /** false to hold fire (off screen, game over…). Default true. */
  disparar?: boolean;
  /** x positions where infantry can take cover (bridges, wrecks). Craters are found in `suelo`. */
  coberturas?: number[];
};

/** Score for killing the whole unit (infantry: per mouse). */
export const PUNTOS: Record<TipoGrande, number> = { moto: 80, infanteria: 50, tren: 1200, ratonzilla: 3000 };
/** Score for each part destroyed on the big ones. */
export const PUNTOS_PARTE = 150;
/** Fish crates each unit steals when it reaches the pantry. */
export const ROBO: Record<TipoGrande, number> = { moto: 1, infanteria: 0, tren: 3, ratonzilla: 3 };
/** Cruise speeds, px/s (to the left). */
export const VELOCIDAD: Record<TipoGrande, number> = { moto: 40, infanteria: 15, tren: 12, ratonzilla: 7 };

/* ── small helpers ──────────────────────────────────────────────────────── */

const G = FA.GRAVEDAD;
/** Cartoon gravity for flying mice (real gravity makes them float for 3 s). */
const G_RAG = FA.GRAVEDAD * 2.2;
const VEL_BALIN = 190;
const VEL_COHETE = 150;
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
let ids = 1;

function azar(u: Unidad): number {
  u.rng = (u.rng + 0x6d2b79f5) | 0;
  let t = u.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (u: Unidad, a: number, b: number) => a + (b - a) * azar(u);
const sueloOk = (suelo: (x: number) => number, x: number) => fin(suelo(x), 30);

function parte(nombre: string, rol: Rol, dx: number, dy: number, w: number, h: number, hp: number): Parte {
  return { nombre, rol, dx, dy, w, h, hp, hpMax: hp, viva: true, wx: 0, wy: 0, ang: 0, cd: 0, aviso: 0, flash: 0, tiros: 0, retro: 0, cuenta: 0 };
}

function nueva(tipo: TipoGrande, x: number, suelo: (x: number) => number, rnd: () => number, ola: number, partes: Parte[]): Unidad {
  const sem = clamp(fin(rnd(), 0.5), 0, 0.999);
  const y = sueloOk(suelo, x);
  return {
    id: ids++, tipo, x, y, vx: 0, vy: 0, ang: 0, partes, viva: true, quitar: false, t: 0, ola: Math.max(1, Math.floor(fin(ola, 1))),
    semilla: sem, rng: (sem * 4294967296) | 0, veh: null, rueda: 0, aim: Math.PI * 0.75,
    estado: 'corre', estadoT: 0, mira: -1, arma: null, giro: 0, spin: 0, huye: 0, huyeT: 0, reac: 0, cubreX: NaN,
    saltoT: 1 + sem * 2, muerteT: 0, sigExp: 0, bajaron: false, sustoT: 0,
  };
}

/** Local (lx right, ly up) → world, for a body at (x, y) tilted `a`. */
function aMundo(x: number, y: number, a: number, lx: number, ly: number) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: x + lx * c - ly * s, y: y + lx * s + ly * c };
}

/** 0 intact · 1 dents · 2 smoke · 3 fire · 4 destroyed. */
export function etapa(p: Parte): 0 | 1 | 2 | 3 | 4 {
  if (!p.viva) return 4;
  const r = p.hp / p.hpMax;
  return r > 0.75 ? 0 : r > 0.5 ? 1 : r > 0.25 ? 2 : 3;
}

/* ── Train layout ───────────────────────────────────────────────────────── */

const LARGO_LOCO = 46;
const LARGO_VAGON = 38;
const largoDe = (p: Parte) => (p.rol === 'motor' ? LARGO_LOCO : LARGO_VAGON);

/* ── Creation ───────────────────────────────────────────────────────────── */

function nuevoSoldado(x: number, suelo: (x: number) => number, rnd: () => number, ola: number, bazuca: boolean): Unidad {
  const u = nueva('infanteria', x, suelo, rnd, ola, [parte('raton', 'raton', 0, 5, 6, 10, 1)]);
  u.arma = bazuca ? 'bazuca' : 'fusil';
  u.partes[0].cd = 1 + u.semilla * 2.5;
  return u;
}

/**
 * Creates a unit (or a group) at x, standing on the ground. `moto` returns a
 * pack of 2–3, `infanteria` a squad of 2–4 (one bazooka from wave 3, or when
 * there are 3+), `tren` and `ratonzilla` a single unit.
 */
export function crear(tipo: TipoGrande, x: number, suelo: (x: number) => number, rnd: () => number = Math.random, ola = 1): Unidad[] {
  const r = () => clamp(fin(rnd(), 0.5), 0, 0.999);
  const n = Math.max(1, Math.floor(fin(ola, 1)));
  x = fin(x);
  if (tipo === 'infanteria') {
    const cuantos = 2 + Math.floor(r() * (n >= 3 ? 3 : 2));
    const out: Unidad[] = [];
    let xx = x;
    for (let i = 0; i < cuantos; i++) {
      out.push(nuevoSoldado(xx, suelo, rnd, n, (i === 1 && (cuantos >= 3 || n >= 3)) || r() < 0.12 * Math.min(n, 5)));
      xx += 8 + r() * 8;
    }
    return out;
  }
  if (tipo === 'moto') {
    const cuantos = 2 + (n >= 4 && r() < 0.6 ? 1 : 0);
    const out: Unidad[] = [];
    for (let i = 0; i < cuantos; i++) {
      const u = nueva('moto', x + i * (22 + r() * 14), suelo, rnd, n, [parte('moto', 'moto', 0, 9, 18, 16, 1)]);
      u.veh = FA.nuevoVehiculo(u.x, suelo, 0.6);
      u.partes[0].cd = 1.5 + r() * 2;
      out.push(u);
    }
    return out;
  }
  if (tipo === 'tren') {
    const vagones = n >= 7 ? 3 : 2 + (r() < 0.5 ? 1 : 0);
    const ps: Parte[] = [parte('locomotora', 'motor', 0, 16, LARGO_LOCO, 30, 4)];
    let off = LARGO_LOCO / 2 + 3;
    for (let i = 0; i < vagones; i++) {
      const rol: Rol = i % 2 === 0 ? 'antiaereo' : 'misil';
      ps.push(parte(`${rol}${i + 1}`, rol, off + LARGO_VAGON / 2, 14, LARGO_VAGON, 24, 3));
      off += LARGO_VAGON + 3;
      ps[ps.length - 1].cd = 2 + i * 1.3;
    }
    const u = nueva('tren', x, suelo, rnd, n, ps);
    u.veh = FA.nuevoVehiculo(u.x, suelo, 12);
    return [u];
  }
  // ratonzilla
  const ps = [
    parte('orugas', 'orugas', 0, 9, 120, 18, 4.5),
    parte('torreta1', 'misil', -40, 46, 18, 14, 2.5),
    parte('canon', 'canon', -12, 45, 30, 14, 3.5),
    parte('cabina', 'cabina', 19, 52, 24, 24, 5),
    parte('torreta2', 'misil', 44, 46, 18, 14, 2.5),
  ];
  ps[1].cd = 1.5;
  ps[2].cd = 3;
  ps[4].cd = 4;
  const u = nueva('ratonzilla', x, suelo, rnd, n, ps);
  u.veh = FA.nuevoVehiculo(u.x, suelo, 30);
  return [u];
}

/**
 * Mice bailing out of a vehicle at (x, y): `n` soldiers (1–3 is a good
 * number) hop out with a little jump and then fight on foot.
 */
export function desembarcar(x: number, y: number, n: number, rnd: () => number = Math.random, ola = 1): Unidad[] {
  const out: Unidad[] = [];
  const k = nivelIA(ola);
  const cuantos = clamp(Math.floor(fin(n, 1)), 1, 4);
  for (let i = 0; i < cuantos; i++) {
    const u = nuevoSoldado(fin(x) + (i - (cuantos - 1) / 2) * 5, () => fin(y), rnd, ola, fin(rnd(), 0.5) < 0.3 + 0.25 * k);
    u.y = fin(y) + 6;
    u.estado = 'aire';
    u.vx = (fin(rnd(), 0.5) - 0.5) * 60 + (i - (cuantos - 1) / 2) * 15;
    u.vy = 45 + fin(rnd(), 0.5) * 30;
    u.giro = (fin(rnd(), 0.5) - 0.5) * 6;
    u.partes[0].cd = 1.2 + fin(rnd(), 0.5) * 1.5;
    out.push(u);
  }
  return out;
}

/**
 * Ground groups for a wave (each entry is one `crear` call): infantry from
 * wave 1, motorbikes from 2, the train in 4 and then often, Ratonzilla as a
 * mini-boss in wave 6 and every 4 waves after (10, 14…).
 */
export function elegirGrandes(ola: number, rnd: () => number = Math.random): TipoGrande[] {
  const n = Math.max(1, Math.floor(fin(ola, 1)));
  const r = () => clamp(fin(rnd(), 0.5), 0, 0.999);
  const out: TipoGrande[] = ['infanteria'];
  if (n >= 3 && r() < 0.6) out.push('infanteria');
  if (n >= 2) out.push('moto');
  if (n >= 5 && r() < 0.5) out.push('moto');
  if (n === 4 || (n > 4 && r() < 0.55)) out.push('tren');
  if (n >= 6 && (n - 6) % 4 === 0) out.push('ratonzilla');
  return out;
}

/* ── Threats ────────────────────────────────────────────────────────────── */

/** Where (and in how long) the nearest bomb will land, as seen from x. */
function bombaCerca(x: number, vista: Vista, suelo: (x: number) => number): { x: number; t: number } | null {
  let best: { x: number; t: number } | null = null;
  const h = sueloOk(suelo, x);
  for (const b of vista.bombas ?? []) {
    const dy = fin(b.y) - h;
    if (dy < -2) continue;
    const vy = fin(b.vy);
    const t = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * Math.max(0, dy)))) / G;
    const xl = fin(b.x) + (fin(b.vx) + fin(vista.viento ?? 0) * 0.3) * t;
    if (t > 3) continue;
    if (!best || Math.abs(xl - x) < Math.abs(best.x - x)) best = { x: xl, t };
  }
  // Player missiles diving at the ground nearby count too.
  for (const m of vista.misilesJugador ?? []) {
    if (fin(m.vy) >= -20) continue;
    const t = (fin(m.y) - h) / -fin(m.vy);
    if (t < 0 || t > 1.2) continue;
    const xl = fin(m.x) + fin(m.vx) * t;
    if (!best || Math.abs(xl - x) < Math.abs(best.x - x)) best = { x: xl, t };
  }
  return best;
}

function enAlcance(ox: number, oy: number, vista: Vista, alcance: number, suelo: (x: number) => number) {
  const a = vista.avion;
  if (!a.vivo) return false;
  const d = Math.hypot(a.x - ox, a.y - oy);
  return d < alcance && a.y > oy + 8 && lineaLibre(ox, oy, a.x, a.y, suelo);
}

/* ── Step ───────────────────────────────────────────────────────────────── */

/** Moves one unit one frame. See `ResultadoPaso` and the integration notes at the top. */
export function paso(u: Unidad, vista: Vista, dt: number, suelo: (x: number) => number, op: OpcionesPaso = {}): ResultadoPaso {
  dt = clamp(fin(dt), 0, 0.1);
  const res: ResultadoPaso = {};
  if (u.quitar || dt <= 0) return res;
  u.t += dt;
  for (const p of u.partes) {
    p.flash = Math.max(0, p.flash - dt);
    p.retro = Math.max(0, p.retro - dt * 12);
  }
  const puede = op.disparar !== false && vista.avion.vivo;
  if (u.tipo === 'infanteria') pasoInfanteria(u, vista, dt, suelo, op, puede, res);
  else if (u.tipo === 'moto') pasoMoto(u, vista, dt, suelo, puede, res);
  else if (u.tipo === 'tren') pasoTren(u, vista, dt, suelo, puede, res);
  else pasoRatonzilla(u, vista, dt, suelo, puede, res);
  if (u.viva && op.metaX !== undefined && u.x <= op.metaX) {
    // Mice on foot just slip into the pantry (no crates stolen: ROBO.infanteria = 0).
    res.llego = true;
    u.viva = false;
    u.quitar = true;
  }
  // Last line of defence against NaN.
  if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) {
    u.x = fin(u.x, 0);
    u.y = sueloOk(suelo, u.x);
    u.vx = 0;
    u.vy = 0;
  }
  return res;
}

const push = <T>(arr: T[] | undefined, v: T): T[] => {
  const a = arr ?? [];
  a.push(v);
  return a;
};

/* moto */

function pasoMoto(u: Unidad, vista: Vista, dt: number, suelo: (x: number) => number, puede: boolean, res: ResultadoPaso) {
  const v = u.veh!;
  const p = u.partes[0];
  if (!u.viva) {
    u.quitar = true;
    return;
  }
  const k = nivelIA(u.ola);
  let vd = -VELOCIDAD.moto + Math.sin(u.t * 2.1 + u.semilla * 6.28) * 18;
  const b = bombaCerca(u.x, vista, suelo);
  if (b && Math.abs(b.x - u.x) < 45 && b.t < 2.2 && azar(u) < 0.6 + 0.4 * k) {
    // Sprint past the impact point or brake hard before it, whichever is shorter.
    vd = b.x < u.x - 10 ? 25 : -75;
  }
  const x0 = v.x;
  FA.pasoVehiculo(v, vd, dt, suelo, 12);
  u.rueda += Math.abs(v.x - x0);
  u.saltoT -= dt;
  if (u.saltoT <= 0) {
    u.saltoT = entre(u, 1.8, 4);
    if (!FA.enElAire(v)) FA.empujeVehiculo(v, -10 * v.masa, 38 * v.masa);
  }
  u.x = v.x;
  u.y = v.y + v.suspension;
  u.vx = v.vx;
  u.vy = v.vy;
  u.ang = v.angulo;
  const c = aMundo(u.x, u.y, u.ang, 0, 9);
  p.wx = c.x;
  p.wy = c.y;
  p.ang = u.ang;
  // Rocket: a 0.3 s blink, then fire with lead (unguided, a little off).
  const boca = aMundo(u.x, u.y, u.ang, 6, 15);
  if (p.aviso > 0) {
    p.aviso -= dt;
    if (p.aviso <= 0) {
      const ad = adelanto(boca.x, boca.y, VEL_COHETE, vista.avion);
      const ang = Math.atan2(ad.y - boca.y, ad.x - boca.x) + (azar(u) - 0.5) * lerp(0.3, 0.12, k);
      res.disparos = push(res.disparos, { clase: 'proyectil', tipo: 'cohete', x: boca.x, y: boca.y, vx: Math.cos(ang) * VEL_COHETE, vy: Math.sin(ang) * VEL_COHETE });
      p.cd = entre(u, 2.2, 3.6) * lerp(1, 0.7, k);
      p.retro = 2;
    }
  } else if (puede) {
    p.cd -= dt;
    if (p.cd <= 0 && enAlcance(boca.x, boca.y, vista, 270, suelo)) p.aviso = 0.3;
  }
}

/* infantry */

function buscarCobertura(u: Unidad, suelo: (x: number) => number, cob: number[] | undefined): number {
  let mejor = NaN, md = Infinity;
  for (const c of cob ?? []) {
    const d = Math.abs(c - u.x);
    if (d < 45 && d < md) (mejor = c), (md = d);
  }
  for (let x = u.x - 40; x <= u.x + 24; x += 4) {
    const dip = (sueloOk(suelo, x - 8) + sueloOk(suelo, x + 8)) / 2 - sueloOk(suelo, x);
    const d = Math.abs(x - u.x) + 6;
    if (dip > 2.5 && d < md) (mejor = x), (md = d);
  }
  return mejor;
}

function pasoInfanteria(u: Unidad, vista: Vista, dt: number, suelo: (x: number) => number, op: OpcionesPaso, puede: boolean, res: ResultadoPaso) {
  const p = u.partes[0];
  const k = nivelIA(u.ola);
  const a = vista.avion;
  // Ragdoll (alive or not): ballistic, bounces once, then lands.
  if (u.estado === 'aire') {
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      u.vy -= G_RAG * h;
      u.x += u.vx * h;
      u.y += u.vy * h;
      u.spin += u.giro * h;
      const gy = sueloOk(suelo, u.x);
      if (u.y <= gy) {
        u.y = gy;
        if (u.vy < -45) {
          u.vy *= -0.3;
          u.vx *= 0.5;
          u.giro *= 0.6;
        } else {
          u.vx = 0;
          u.vy = 0;
          u.spin = 0;
          u.giro = 0;
          u.estado = u.viva ? 'tierra' : 'muerto';
          u.estadoT = u.viva ? 0.7 : 0;
          break;
        }
      }
    }
  } else if (u.estado === 'muerto') {
    u.estadoT += dt;
    u.y = sueloOk(suelo, u.x);
    if (u.estadoT > 2.5) u.quitar = true;
  } else {
    // Bombs: react (after a short, wave-dependent delay), then flee or hit the dirt.
    const b = bombaCerca(u.x, vista, suelo);
    const peligro = b && Math.abs(b.x - u.x) < 50;
    if (peligro) u.reac += dt;
    else u.reac = 0;
    if (peligro && u.reac > lerp(0.35, 0.12, k) + u.semilla * 0.1 && u.estado !== 'tierra') {
      if (b!.t < 0.75 || Math.abs(b!.x - u.x) < 12) {
        u.estado = 'tierra';
        u.estadoT = Math.max(0.9, b!.t + 0.6);
      } else {
        u.estado = 'corre';
        u.huye = u.x >= b!.x ? 1 : -1;
        u.huyeT = b!.t;
      }
      p.aviso = 0;
    }
    u.huyeT -= dt;
    if (u.huyeT <= 0) u.huye = 0;
    p.cd -= dt;
    const oy = u.y + (u.arma === 'bazuca' && u.estado === 'apunta' ? 6 : 8);
    const alcance = u.arma === 'bazuca' ? 260 : 200;
    let vx = 0;
    switch (u.estado) {
      case 'corre': {
        vx = u.huye ? u.huye * 36 : -lerp(13, 18, u.semilla);
        u.mira = vx > 0 ? 1 : -1;
        if (!u.huye) {
          const cerca = a.vivo && Math.hypot(a.x - u.x, a.y - u.y) < 230;
          if (puede && p.cd <= 0 && enAlcance(u.x, oy, vista, alcance, suelo)) {
            u.estado = 'apunta';
            u.estadoT = u.arma === 'bazuca' ? 0.5 : 0.25;
            p.aviso = u.estadoT;
          } else if (cerca && p.cd > 0.8) {
            // Head for cover while reloading.
            if (!Number.isFinite(u.cubreX)) u.cubreX = buscarCobertura(u, suelo, op.coberturas);
            if (Number.isFinite(u.cubreX)) {
              const d = u.cubreX - u.x;
              if (Math.abs(d) < 2) {
                u.estado = 'cubre';
                u.estadoT = p.cd;
                vx = 0;
              } else vx = Math.sign(d) * 26;
            }
          } else u.cubreX = NaN;
        }
        break;
      }
      case 'apunta': {
        u.mira = a.x >= u.x ? 1 : -1;
        u.aim = Math.atan2(a.y - oy, a.x - u.x);
        u.estadoT -= dt;
        p.aviso = Math.max(0, u.estadoT);
        if (u.estadoT <= 0) {
          if (u.arma === 'bazuca') {
            const sol = FA.solucionTiro({ x: u.x, y: oy }, VEL_COHETE, a, false);
            const ang = (sol ? Math.atan2(sol.vy, sol.vx) : u.aim) + (azar(u) - 0.5) * lerp(0.14, 0.05, k);
            res.disparos = push(res.disparos, { clase: 'proyectil', tipo: 'cohete', x: u.x + Math.cos(ang) * 6, y: oy + Math.sin(ang) * 6, vx: Math.cos(ang) * VEL_COHETE, vy: Math.sin(ang) * VEL_COHETE });
            u.aim = ang;
            p.retro = 3;
            p.cd = entre(u, 3.5, 5) * lerp(1, 0.7, k);
            u.estado = 'corre';
          } else {
            u.estado = 'dispara';
            p.tiros = 3 + Math.floor(k * 2 + azar(u) * 1.5);
            u.estadoT = 0;
          }
        }
        break;
      }
      case 'dispara': {
        u.mira = a.x >= u.x ? 1 : -1;
        u.estadoT -= dt;
        if (u.estadoT <= 0 && p.tiros > 0) {
          u.estadoT += 0.09;
          p.tiros--;
          const sol = FA.solucionTiro({ x: u.x, y: oy }, VEL_BALIN, a, true);
          if (sol && puede) {
            const ang = Math.atan2(sol.vy, sol.vx) + (azar(u) - 0.5) * lerp(0.16, 0.07, k);
            u.aim = ang;
            res.disparos = push(res.disparos, { clase: 'proyectil', tipo: 'balin', x: u.x + Math.cos(ang) * 5, y: oy + Math.sin(ang) * 5, vx: Math.cos(ang) * VEL_BALIN, vy: Math.sin(ang) * VEL_BALIN });
            p.retro = 1;
          }
        }
        if (p.tiros <= 0) {
          p.cd = entre(u, 1.6, 2.6) * lerp(1, 0.75, k);
          u.estado = 'corre';
        }
        break;
      }
      case 'cubre': {
        u.estadoT -= dt;
        if (p.cd <= 0 && puede && enAlcance(u.x, oy, vista, alcance, suelo)) {
          u.estado = 'apunta';
          u.estadoT = u.arma === 'bazuca' ? 0.5 : 0.25;
          p.aviso = u.estadoT;
        } else if (u.estadoT < -1.5 || !a.vivo || Math.hypot(a.x - u.x, a.y - u.y) > 300) {
          u.estado = 'corre';
          u.cubreX = NaN;
        }
        break;
      }
      case 'tierra': {
        u.estadoT -= dt;
        if (u.estadoT <= 0) u.estado = 'corre';
        break;
      }
    }
    u.x += vx * dt;
    u.vx = vx;
    u.vy = 0;
    u.rueda += Math.abs(vx * dt);
    u.y = sueloOk(suelo, u.x);
  }
  const pose = poseInf(u);
  p.wx = u.x;
  p.wy = u.y + pose.h / 2;
  p.w = pose.w;
  p.h = pose.h;
}

function poseInf(u: Unidad) {
  switch (u.estado) {
    case 'tierra':
    case 'muerto':
      return { w: 11, h: 4 };
    case 'cubre':
      return { w: 7, h: 6 };
    case 'aire':
      return { w: 8, h: 8 };
    case 'apunta':
      return u.arma === 'bazuca' ? { w: 7, h: 8 } : { w: 6, h: 10 };
    default:
      return { w: 6, h: 10 };
  }
}

/* train */

function pasoTren(u: Unidad, vista: Vista, dt: number, suelo: (x: number) => number, puede: boolean, res: ResultadoPaso) {
  const v = u.veh!;
  const loco = u.partes[0];
  if (u.viva) {
    const x0 = v.x;
    FA.pasoVehiculo(v, loco.viva ? -VELOCIDAD.tren : 0, dt, suelo, 36);
    u.rueda += Math.abs(v.x - x0);
  }
  u.x = v.x;
  u.y = v.y;
  u.vx = u.viva ? v.vx : 0;
  u.ang = v.angulo;
  // Couple up: the live cars slide forward to close gaps (the locomotive, dead or not, stays first).
  let off = 0;
  for (let i = 0; i < u.partes.length; i++) {
    const p = u.partes[i];
    if (i > 0 && !p.viva) continue;
    const L = largoDe(p);
    const objetivo = i === 0 ? 0 : off + L / 2;
    if (i > 0) p.dx = p.dx > objetivo ? Math.max(objetivo, p.dx - 22 * dt) : objetivo;
    off = (i === 0 ? LARGO_LOCO / 2 : p.dx + L / 2) + 3;
    const cx = u.x + p.dx;
    const hb = sueloOk(suelo, cx - L / 2 + 5), hf = sueloOk(suelo, cx + L / 2 - 5);
    p.ang = i === 0 ? u.ang : Math.atan2(hf - hb, L - 10);
    const baseY = i === 0 ? u.y + v.suspension : (hb + hf) / 2;
    const c = aMundo(cx, baseY, p.ang, 0, p.dy);
    p.wx = c.x;
    p.wy = c.y;
  }
  if (!u.viva) {
    muerteEnCadena(u, dt, res, 1.4);
    return;
  }
  const k = nivelIA(u.ola);
  // Crew jumps off when the plane buzzes the train (once) — a little bonus target.
  u.sustoT -= dt;
  const a = vista.avion;
  if (!u.bajaron && u.sustoT <= 0 && a.vivo && Math.abs(a.x - u.x - 40) < 60 && a.y - u.y < 70) {
    u.sustoT = 5;
    if (azar(u) < 0.35) {
      const w = u.partes.find((p, i) => i > 0 && p.viva);
      if (w) res.eventos = push(res.eventos, { desembarco: { x: w.wx, y: w.wy, n: 1 } });
    }
  }
  for (let i = 1; i < u.partes.length; i++) {
    const p = u.partes[i];
    if (!p.viva) continue;
    const top = aMundo(u.x + p.dx, p.wy - p.dy, p.ang, p.rol === 'misil' ? -8 : 0, 26);
    if (p.rol === 'antiaereo') u.aim = Math.atan2(a.y - top.y, a.x - top.x);
    if (!puede) {
      p.aviso = 0;
      continue;
    }
    if (p.tiros > 0) {
      // Flak burst under way.
      p.aviso -= dt;
      if (p.aviso <= 0) {
        p.aviso = 0.16;
        p.tiros--;
        const sol = FA.solucionTiro(top, FA.VEL_OBUS, a, true, FA.ARRASTRE_OBUS);
        if (sol) {
          const e = (azar(u) - 0.5) * 0.08;
          const c = Math.cos(e), s = Math.sin(e);
          res.disparos = push(res.disparos, { clase: 'obus', x: top.x, y: top.y, vx: sol.vx * c - sol.vy * s, vy: sol.vx * s + sol.vy * c, fuse: sol.tiempo * entre(u, 0.95, 1.05) });
          p.retro = 2;
        }
        if (p.tiros <= 0) p.aviso = 0;
      }
      continue;
    }
    if (p.aviso > 0) {
      p.aviso -= dt;
      if (p.aviso <= 0) {
        if (p.rol === 'misil') {
          const tipo = elegirArmamento('camion', u.ola, () => azar(u), a.y) ?? 'buscador';
          res.disparos = push(res.disparos, { clase: 'misil', tipo, x: top.x, y: top.y, desvio: 0 });
          p.cd = entre(u, 4, 5.5) * lerp(1, 0.75, k);
        } else {
          p.tiros = 3;
          p.aviso = 0.01;
          p.cd = entre(u, 2.6, 3.6) * lerp(1, 0.75, k);
        }
      }
      continue;
    }
    p.cd -= dt;
    if (p.cd <= 0 && enAlcance(top.x, top.y, vista, p.rol === 'misil' ? 380 : 300, suelo)) p.aviso = p.rol === 'misil' ? 0.6 : 0.35;
  }
}

/* Ratonzilla */

function pasoRatonzilla(u: Unidad, vista: Vista, dt: number, suelo: (x: number) => number, puede: boolean, res: ResultadoPaso) {
  const v = u.veh!;
  const [orugas, , canon] = u.partes;
  if (u.viva) {
    const x0 = v.x;
    FA.pasoVehiculo(v, orugas.viva ? -VELOCIDAD.ratonzilla : 0, dt, suelo, 100);
    u.rueda += Math.abs(v.x - x0);
  }
  u.x = v.x;
  u.y = v.y + v.suspension * 0.5;
  u.vx = u.viva ? v.vx : 0;
  u.ang = v.angulo;
  for (const p of u.partes) {
    const c = aMundo(u.x, u.y, u.ang, p.dx, p.dy);
    p.wx = c.x;
    p.wy = c.y;
    p.ang = u.ang;
  }
  if (!u.viva) {
    muerteEnCadena(u, dt, res, 2);
    return;
  }
  const a = vista.avion;
  const k = nivelIA(u.ola);
  const piv = aMundo(u.x, u.y, u.ang, -22, 45);
  if (canon.viva) {
    let want = Math.atan2(a.y - piv.y, a.x - piv.x);
    want = clamp(want, 0.08, Math.PI - 0.08);
    let d = want - u.aim;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    u.aim += clamp(d, -1.2 * dt, 1.2 * dt);
  }
  for (const p of u.partes) {
    if (!p.viva || (p.rol !== 'misil' && p.rol !== 'canon')) continue;
    if (!puede) {
      p.aviso = 0;
      continue;
    }
    const boca =
      p.rol === 'canon'
        ? { x: piv.x + Math.cos(u.aim) * 34, y: piv.y + Math.sin(u.aim) * 34 }
        : aMundo(u.x, u.y, u.ang, p.dx - 6, p.dy + 8);
    if (p.tiros > 0) {
      p.aviso -= dt;
      if (p.aviso <= 0) {
        p.aviso = 0.2;
        p.tiros--;
        const sol = FA.solucionTiro(boca, FA.VEL_OBUS, a, true, FA.ARRASTRE_OBUS);
        if (sol) {
          const e = (p.tiros - 1) * 0.06;
          const c = Math.cos(e), s = Math.sin(e);
          res.disparos = push(res.disparos, { clase: 'obus', x: boca.x, y: boca.y, vx: sol.vx * c - sol.vy * s, vy: sol.vx * s + sol.vy * c, fuse: sol.tiempo });
          p.retro = 4;
          if (u.veh) FA.retroceso(u.veh, u.aim, 4);
        }
        if (p.tiros <= 0) p.aviso = 0;
      }
      continue;
    }
    if (p.aviso > 0) {
      p.aviso -= dt;
      if (p.aviso <= 0) {
        if (p.rol === 'misil') {
          const tipo = elegirArmamento('sam', u.ola, () => azar(u), a.y) ?? 'buscador';
          // Two-missile salvo unless the swarm (already a salvo).
          for (const dv of tipo === 'enjambre' ? [0] : [-0.25, 0.25]) res.disparos = push(res.disparos, { clase: 'misil', tipo, x: boca.x, y: boca.y, desvio: dv });
          p.cd = entre(u, 4.5, 6) * lerp(1, 0.7, k);
        } else {
          p.cuenta++;
          if (p.cuenta % 3 === 0) {
            res.disparos = push(res.disparos, { clase: 'misil', tipo: 'pesado', x: boca.x, y: boca.y, desvio: 0 });
            p.retro = 5;
          } else {
            p.tiros = 3;
            p.aviso = 0.01;
          }
          p.cd = entre(u, 2.8, 3.8) * lerp(1, 0.75, k);
        }
      }
      continue;
    }
    p.cd -= dt;
    if (p.cd <= 0 && enAlcance(boca.x, boca.y, vista, p.rol === 'misil' ? 400 : 320, suelo)) p.aviso = p.rol === 'misil' ? 0.7 : 0.45;
  }
}

/** Chain explosions after a big unit dies; then a final big one and the wreck. */
function muerteEnCadena(u: Unidad, dt: number, res: ResultadoPaso, dur: number) {
  u.muerteT += dt;
  const b = caja(u, true);
  while (u.muerteT >= u.sigExp && u.sigExp < dur) {
    u.sigExp += entre(u, 0.14, 0.28);
    const x = lerp(b.x0, b.x1, azar(u)), y = lerp(b.y0, b.y1, azar(u) * 0.8);
    res.eventos = push(res.eventos, { explosion: { x, y, energia: entre(u, 1.5, 3) } });
    if (azar(u) < 0.45) res.eventos = push(res.eventos, { pieza: { x, y, vx: entre(u, -80, 80), vy: entre(u, 50, 130), sprite: null, color: '#8064d8' } });
  }
  if (u.muerteT >= dur && !u.quitar) {
    u.quitar = true;
    const cx = (b.x0 + b.x1) / 2;
    res.eventos = push(res.eventos, { explosion: { x: cx, y: b.y0 + 8, energia: FA.ENERGIA.bomba } });
    res.eventos = push(res.eventos, { restos: { x: cx, y: b.y0, ancho: Math.min(120, b.x1 - b.x0) } });
  }
}

/* ── Damage ─────────────────────────────────────────────────────────────── */

/** Bounding box of the live parts (world, y up). With `todo`, dead parts too. */
export function caja(u: Unidad, todo = false): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of u.partes) {
    if (!todo && !p.viva && u.tipo !== 'tren') continue;
    if (u.tipo === 'tren' && !p.viva && p.rol !== 'motor') continue;
    x0 = Math.min(x0, p.wx - p.w / 2);
    x1 = Math.max(x1, p.wx + p.w / 2);
    y0 = Math.min(y0, p.wy - p.h / 2);
    y1 = Math.max(y1, p.wy + p.h / 2);
  }
  if (!Number.isFinite(x0)) return { x0: u.x - 4, x1: u.x + 4, y0: u.y, y1: u.y + 8 };
  return { x0, x1, y0, y1 };
}

/** Where a homing missile should steer: the most important live part. */
export function objetivo(u: Unidad): { x: number; y: number; vx: number; vy: number } {
  const p = u.partes.find((q) => q.viva && q.rol === 'cabina') ?? u.partes.find((q) => q.viva) ?? u.partes[0];
  return { x: p.wx, y: p.wy, vx: u.vx, vy: u.vy };
}

const distCaja = (p: Parte, x: number, y: number) => Math.hypot(Math.max(0, Math.abs(x - p.wx) - p.w / 2), Math.max(0, Math.abs(y - p.wy) - p.h / 2));

/** Infantry is harder to kill lying down or in cover. */
function factorPose(u: Unidad) {
  return u.estado === 'tierra' ? 0.3 : u.estado === 'cubre' ? 0.45 : u.estado === 'apunta' && u.arma === 'bazuca' ? 0.7 : 1;
}

function danarParte(u: Unidad, p: Parte, dmg: number, hx: number, hy: number, out: ResultadoGolpe) {
  if (!p.viva || !u.viva || dmg <= 0) return;
  p.flash = 0.12;
  if (u.tipo === 'infanteria') {
    if (dmg * factorPose(u) < 0.2) return;
    p.hp = 0;
    p.viva = false;
    u.viva = false;
    out.muerta = true;
    out.parte = p.nombre;
    out.puntos += PUNTOS.infanteria;
    // Knocked flying.
    u.estado = 'aire';
    u.vx = clamp((u.x - hx) * 6, -60, 60) + (u.x >= hx ? 25 : -25);
    u.vy = Math.max(u.vy, 50 + Math.min(40, dmg * 10));
    u.y += 1;
    u.giro = (u.x >= hx ? -1 : 1) * 9;
    return;
  }
  p.hp -= dmg;
  if (p.hp > 0) return;
  p.hp = 0;
  p.viva = false;
  out.parte = p.nombre;
  if (u.tipo === 'moto') {
    u.viva = false;
    out.muerta = true;
    out.puntos += PUNTOS.moto;
    out.eventos.push({ explosion: { x: p.wx, y: p.wy, energia: 1.5 } });
    out.eventos.push({ pieza: { x: p.wx, y: p.wy, vx: entre(u, -50, 50), vy: entre(u, 60, 110), sprite: spritePieza(u, p), color: '#b49af4' } });
    out.eventos.push({ desembarco: { x: p.wx, y: p.wy, n: 1 } });
    return;
  }
  out.puntos += PUNTOS_PARTE;
  out.eventos.push({ explosion: { x: p.wx, y: p.wy, energia: p.rol === 'orugas' ? 2 : 2.5 } });
  out.eventos.push({ pieza: { x: p.wx, y: p.wy + p.h / 2, vx: entre(u, -70, 70), vy: entre(u, 70, 140), sprite: spritePieza(u, p), color: '#8064d8' } });
  if (u.tipo === 'tren') {
    if (p.rol === 'motor') out.eventos.push({ desembarco: { x: p.wx, y: p.wy, n: 2 } });
    else out.eventos.push({ restos: { x: p.wx, y: p.wy - p.dy, ancho: LARGO_VAGON } });
    if (u.partes.every((q) => !q.viva)) matar(u, out);
  } else {
    if (p.rol === 'orugas' && !u.bajaron) {
      u.bajaron = true;
      out.eventos.push({ desembarco: { x: p.wx, y: p.wy + 10, n: 2 } });
    }
    if (p.rol === 'cabina' || u.partes.every((q) => !q.viva || q.rol === 'cabina')) matar(u, out);
  }
}

function matar(u: Unidad, out: ResultadoGolpe) {
  if (!u.viva) return;
  u.viva = false;
  out.muerta = true;
  out.puntos += PUNTOS[u.tipo];
  u.muerteT = 0;
  u.sigExp = 0;
  // Everything still attached flies off.
  for (const q of u.partes) {
    if (!q.viva) continue;
    q.viva = false;
    q.hp = 0;
    out.eventos.push({ pieza: { x: q.wx, y: q.wy, vx: entre(u, -90, 90), vy: entre(u, 80, 160), sprite: spritePieza(u, q), color: '#8064d8' } });
  }
}

/**
 * A direct hit at (x, y) (a missile touching `caja`): the nearest live part
 * takes `danio`. Infantry and motorbikes die from any real hit.
 */
export function golpear(u: Unidad, x: number, y: number, danio: number): ResultadoGolpe {
  const out: ResultadoGolpe = { muerta: false, puntos: 0, eventos: [] };
  if (!u.viva) return out;
  let best: Parte | null = null, bd = Infinity;
  for (const p of u.partes) {
    if (!p.viva) continue;
    const d = distCaja(p, fin(x), fin(y));
    if (d < bd) (bd = d), (best = p);
  }
  if (best) danarParte(u, best, Math.max(0, fin(danio)), fin(x), fin(y), out);
  return out;
}

/**
 * A blast of `energia` at (x, y): every live part takes `danio` × falloff
 * (FA.explosion) from its own distance, and the blast pushes the unit (mice
 * go flying, alive or dead; bikes hop; the giants rock). Call it for every
 * blast; pass danio 0 for blasts that shouldn't hurt mice.
 */
export function explotar(u: Unidad, x: number, y: number, energia: number, danio: number): ResultadoGolpe {
  const out: ResultadoGolpe = { muerta: false, puntos: 0, eventos: [] };
  if (u.quitar) return out;
  x = fin(x);
  y = fin(y);
  const ex = FA.explosion(fin(energia, 1));
  const dn = Math.max(0, fin(danio));
  if (dn > 0 && u.viva) {
    for (const p of u.partes) {
      if (!p.viva) continue;
      const dmg = dn * ex.dano(distCaja(p, x, y));
      if (dmg >= (u.tipo === 'infanteria' ? 0.05 : 0.25)) danarParte(u, p, dmg, x, y, out);
      if (!u.viva && u.tipo !== 'tren' && u.tipo !== 'ratonzilla') break;
    }
  }
  // Push.
  const c = u.partes[0];
  const d = Math.hypot(c.wx - x, c.wy - y);
  const imp = ex.impulso(d);
  const nx = (c.wx - x) / (d || 1), ny = (c.wy - y) / (d || 1);
  if (u.tipo === 'infanteria') {
    if (imp > 14 && u.estado !== 'muerto') {
      const dv = Math.min(110, imp / 0.5);
      if (u.estado !== 'aire') {
        u.estado = 'aire';
        u.y += 1;
        u.vx = 0;
        u.vy = 0;
      }
      u.vx = clamp(u.vx + nx * dv * 0.6, -70, 70);
      u.vy = Math.min(120, u.vy + Math.max(0, ny) * dv * 0.4 + dv * 0.5);
      u.giro = (nx >= 0 ? -1 : 1) * (5 + dv * 0.05);
    } else if (u.estado === 'muerto' && imp > 25) {
      u.estado = 'aire';
      u.y += 1;
      u.vx = nx * 60;
      u.vy = 70;
      u.giro = 8;
      u.estadoT = 0;
    }
  } else if (u.veh && u.viva && imp > 0.5) {
    FA.empujeVehiculo(u.veh, nx * imp, ny * imp + imp * 0.5);
  }
  return out;
}

/* ── Drawing ────────────────────────────────────────────────────────────── */

const V = '#b49af4', V0 = '#8064d8', V1 = '#e0d4ff', VINK = '#3a2a7a';
const TIRE = '#4a3a5a';
const CHAR = '#5a4a5a', CHAR2 = '#7a6a7a', DENT = '#6a54b8', HOT = '#ff9a3c';
const PLUM = '#6a3a8a', PLUM0 = '#4a2a6a';

const R = (g: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};
const hsh = (a: number, b: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/** A mouse driver looking left with a red helmet (as in dibujo.ts). (x, y) is the chin. */
function raton(g: Ctx, x: number, y: number, gorra = false) {
  D.disc(g, x + 1, y - 7, 2, '#c8c0d8');
  D.disc(g, x + 5, y - 6, 2, '#c8c0d8');
  R(g, x + 1, y - 7, 1, 1, P.p1);
  R(g, x + 5, y - 6, 1, 1, P.p1);
  D.oval(g, x, y - 3, 4, 3, '#e0d8ec');
  R(g, x - 5, y - 3, 2, 1, P.p0);
  R(g, x - 2, y - 4, 1, 1, P.eye);
  R(g, x + 1, y - 2, 1, 1, P.p2);
  if (gorra) {
    // The general: a plum peaked cap with a gold star, and a fine moustache.
    R(g, x - 2, y - 8, 6, 2, PLUM);
    R(g, x - 1, y - 9, 5, 1, PLUM);
    R(g, x - 5, y - 6, 4, 1, PLUM0);
    R(g, x - 2, y - 6, 6, 1, P.gold0);
    R(g, x + 1, y - 8, 1, 1, P.gold);
    R(g, x - 5, y - 2, 3, 1, '#a898b8');
    R(g, x - 4, y - 1, 1, 1, '#a898b8');
  } else R(g, x - 2, y - 6, 5, 1, P.r1);
}

function rueda(g: Ctx, x: number, y: number, r: number, f: number) {
  D.disc(g, x, y, r, TIRE);
  D.disc(g, x, y, Math.max(1, r - 2), P.metal);
  const a = (f * Math.PI) / 2;
  R(g, x + Math.round(Math.cos(a) * (r - 1)), y + Math.round(Math.sin(a) * (r - 1)), 1, 1, '#8a7a9a');
}

/** Dents, scorch, bullet holes and (stage 3) glowing cracks over a part's rectangle. */
function marcas(g: Ctx, x0: number, y0: number, w: number, h: number, st: number, seed: number) {
  if (st <= 0 || st >= 4) return;
  const n = st === 1 ? 4 : st === 2 ? 8 : 13;
  for (let i = 0; i < n; i++) {
    const hh = hsh(seed, i);
    const px = x0 + (hh % Math.max(1, w - 2)), py = y0 + ((hh >>> 8) % Math.max(1, h - 1));
    if (i % 3 === 0) {
      // A dent: dark top edge, light bottom edge.
      R(g, px, py, 2, 1, DENT);
      R(g, px, py + 1, 2, 1, V1);
    } else if (i % 3 === 1) R(g, px, py, 1 + ((hh >>> 4) % 3), 1, i % 2 ? CHAR : CHAR2);
    else R(g, px, py, 1, 1, '#4a3a5a');
  }
  if (st >= 2) for (let i = 0; i < st * 2; i++) {
    const hh = hsh(seed + 99, i);
    R(g, x0 + (hh % Math.max(1, w - 3)), y0 + ((hh >>> 9) % Math.max(1, h - 2)), 3, 2, CHAR2);
  }
  if (st >= 3)
    for (let i = 0; i < 4; i++) {
      const hh = hsh(seed + 7, i);
      const px = x0 + (hh % Math.max(1, w - 2)), py = y0 + ((hh >>> 8) % Math.max(1, h - 2));
      R(g, px, py, 1, 2, HOT);
      R(g, px + 1, py + 1, 1, 1, P.gold);
    }
}

/** A torn, glowing edge where something was ripped off. */
function desgarro(g: Ctx, x: number, y: number, w: number) {
  for (let i = 0; i < w; i++) R(g, x + i, y - ((i * 7) % 3), 1, 1 + ((i * 5) % 2), i % 4 === 1 ? HOT : i % 3 ? CHAR : CHAR2);
}

const flashCache = new Map<HTMLCanvasElement, HTMLCanvasElement>();
function blanco(src: HTMLCanvasElement) {
  let c = flashCache.get(src);
  if (!c) {
    if (flashCache.size > 200) flashCache.clear();
    c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    flashCache.set(src, c);
  }
  return c;
}

/* Ratonzilla layers, all on one 140×84 canvas with the origin at the ground contact. */
const RZ_W = 140, RZ_H = 84, RZ_OX = 70, RZ_OY = 78;

function rzOrugas(g: Ctx, f: number, st: number) {
  D.oval(g, 0, -9, 60, 9, TIRE);
  D.oval(g, 0, -9, 57, 6, '#5e4e70');
  for (let x = -56; x < 56; x += 4) {
    R(g, x + f, -18, 2, 1, '#6a5a7a');
    R(g, x + 3 - f, -1, 2, 1, '#6a5a7a');
  }
  for (const sx of [-54, 54]) {
    D.disc(g, sx, -9, 5, P.metal0);
    D.disc(g, sx, -9, 3, P.metal);
    R(g, sx + [1, 0, -1, 0][f], -9 + [0, 1, 0, -1][f], 1, 1, P.metal0);
  }
  for (let i = -4; i <= 4; i++) rueda(g, i * 11.5, -8, 4, (f + i + 8) % 4);
  marcas(g, -56, -16, 112, 14, st, 31);
  if (st === 4) {
    // Track snapped: a gap with loose links hanging, wheels bare and scorched.
    g.clearRect(6, -20, 16, 22);
    for (let i = 0; i < 6; i++) R(g, 6 + i, -18 + i * 2, 2, 1, '#6a5a7a');
    for (let i = 0; i < 5; i++) R(g, 21 - i, -1 - i, 2, 1, '#6a5a7a');
    D.disc(g, 14, -8, 4, CHAR);
    D.disc(g, 14, -8, 2, CHAR2);
    for (let i = 0; i < 6; i++) {
      const hh = hsh(77, i);
      R(g, -50 + (hh % 100), -16 + ((hh >>> 8) % 14), 3, 2, CHAR);
    }
    R(g, 6, -12, 1, 2, HOT);
    R(g, 22, -6, 1, 2, HOT);
  }
}

function rzCasco(g: Ctx, st: number) {
  // Fenders over the tracks.
  R(g, -60, -22, 120, 5, V0);
  R(g, -60, -22, 120, 2, V);
  R(g, -60, -22, 120, 1, V1);
  // Hull with a sloped front glacis.
  for (let i = 0; i < 18; i++) {
    const y = -40 + i;
    const left = -48 - Math.round(i * 0.45);
    R(g, left, y, 56 - left, 1, i < 2 ? V1 : i < 12 ? V : V0);
  }
  R(g, -55, -29, 111, 2, P.p1);
  R(g, -55, -27, 111, 1, P.p0);
  for (let x = -36; x < 56; x += 14) R(g, x, -38, 1, 9, V0);
  for (let x = -44; x < 56; x += 5) {
    R(g, x, -36, 1, 1, V0);
    R(g, x, -24, 1, 1, V0);
  }
  // A big cheese emblem.
  R(g, -6, -38, 10, 6, P.gold);
  R(g, -6, -39, 5, 1, P.gold);
  R(g, -6, -38, 10, 1, P.gold1);
  R(g, -4, -36, 2, 1, P.gold0);
  R(g, 1, -35, 1, 2, P.gold0);
  R(g, 2, -37, 1, 1, P.gold0);
  // Headlights, toolbox, exhaust.
  D.disc(g, -54, -33, 2, P.gold);
  R(g, -55, -34, 1, 1, P.gold1);
  R(g, 22, -26, 12, 3, V0);
  R(g, 55, -38, 3, 9, P.metal0);
  R(g, 54, -40, 5, 2, P.metal);
  marcas(g, -50, -40, 104, 17, st, 11);
}

function rzTorreta(g: Ctx, cx: number, st: number) {
  if (st === 4) {
    R(g, cx - 8, -42, 16, 3, CHAR);
    R(g, cx - 5, -45, 5, 3, '#6a5a7a');
    R(g, cx - 1, -47, 2, 3, CHAR2);
    R(g, cx + 3, -44, 3, 2, '#6a5a7a');
    desgarro(g, cx - 8, -43, 16);
    return;
  }
  // Base and launcher box.
  R(g, cx - 8, -42, 16, 3, V0);
  R(g, cx - 7, -48, 15, 6, V0);
  R(g, cx - 7, -48, 15, 4, V);
  R(g, cx - 7, -48, 15, 1, V1);
  // Two missiles on rails, noses up-left.
  for (let m = 0; m < 2; m++) {
    for (let i = 0; i < 11; i++) R(g, cx + 5 - i, -49 - m * 4 - Math.round(i * 0.55), 2, 2, i < 2 ? P.p1 : P.white);
    R(g, cx - 7, -56 - m * 4, 2, 2, P.red);
    R(g, cx + 6, -50 - m * 4, 1, 2, P.p0);
  }
  marcas(g, cx - 7, -48, 15, 7, st, Math.round(cx) + 50);
}

function rzCanon(g: Ctx, st: number) {
  if (st === 4) {
    D.oval(g, -12, -42, 13, 4, CHAR2);
    D.oval(g, -12, -43, 5, 2, CHAR);
    // Barrel snapped, drooping.
    for (let i = 0; i < 9; i++) R(g, -24 - i, -44 + Math.round(i * 0.4), 2, 3, i % 3 ? '#6a5a7a' : CHAR);
    desgarro(g, -24, -47, 22);
    return;
  }
  D.oval(g, -12, -44, 15, 7, V0);
  D.oval(g, -12, -45, 14, 6, V);
  R(g, -22, -50, 18, 1, V1);
  R(g, -10, -52, 7, 2, V0);
  R(g, -4, -55, 2, 3, P.metal0);
  R(g, -5, -56, 4, 1, P.gl1);
  // Mantlet.
  D.disc(g, -22, -45, 4, V0);
  D.disc(g, -22, -46, 3, V);
  marcas(g, -24, -50, 26, 10, st, 23);
}

function rzCabina(g: Ctx, st: number) {
  if (st === 4) {
    R(g, 8, -48, 24, 9, CHAR);
    for (let x = 8; x < 32; x++) R(g, x, -48 - ((x * 7) % 5), 1, (x * 7) % 5, x % 3 ? CHAR2 : CHAR);
    desgarro(g, 8, -49, 24);
    R(g, 30, -56, 1, 8, P.metal0);
    return;
  }
  R(g, 8, -60, 24, 21, V0);
  R(g, 9, -60, 22, 19, V);
  R(g, 9, -60, 22, 1, V1);
  R(g, 8, -61, 24, 2, V0);
  // Front window and rivets.
  R(g, 10, -55, 9, 6, P.gl1);
  R(g, 10, -55, 9, 1, P.gl2);
  R(g, 11, -54, 2, 1, P.white);
  for (let y = -58; y < -40; y += 4) R(g, 29, y, 1, 1, V0);
  // Antenna with a pink pennant.
  R(g, 30, -76, 1, 15, P.metal0);
  R(g, 31, -76, 5, 2, P.p1);
  R(g, 31, -74, 3, 1, P.p0);
  // The general standing in the hatch, shoulders with gold epaulettes.
  R(g, 14, -63, 9, 3, PLUM);
  R(g, 13, -63, 2, 1, P.gold);
  R(g, 22, -63, 2, 1, P.gold);
  raton(g, 17, -63, true);
  marcas(g, 9, -60, 22, 20, st, 41);
}

function rzSprite(capa: string, st: number, f = 0) {
  return D.outlined(`rz|${capa}|${st}|${f}`, VINK, RZ_W, RZ_H, RZ_OX, RZ_OY, (g) => {
    if (capa === 'orugas') rzOrugas(g, f, st);
    else if (capa === 'casco') rzCasco(g, st);
    else if (capa === 'torreta1') rzTorreta(g, -40, st);
    else if (capa === 'torreta2') rzTorreta(g, 44, st);
    else if (capa === 'canon') rzCanon(g, st);
    else rzCabina(g, st);
  });
}

/* Train cars, each on its own canvas (origin at the middle of its wheels). */
const TR_W = 58, TR_H = 46, TR_OX = 29, TR_OY = 42;

function pintarLoco(g: Ctx, f: number, st: number) {
  if (st === 4) {
    for (const x of [-12, 0, 12]) rueda(g, x, -5, 5, 0);
    R(g, -22, -10, 44, 3, CHAR);
    R(g, -20, -20, 26, 10, CHAR2);
    R(g, 6, -26, 16, 16, CHAR2);
    R(g, 8, -24, 7, 5, CHAR);
    desgarro(g, -20, -21, 42);
    R(g, -16, -24, 4, 4, CHAR);
    return;
  }
  rueda(g, -19, -3, 3, f);
  for (const x of [-11, 0, 11]) rueda(g, x, -5, 5, f);
  R(g, -14, -6, 26, 1, P.metal0);
  R(g, -22, -10, 44, 3, V0);
  // Red cowcatcher.
  for (let i = 0; i < 6; i++) R(g, -27 + i, -8 + i, 6 - i, 1, P.r1);
  // Armoured boiler with gold bands.
  R(g, -21, -22, 27, 12, V0);
  R(g, -21, -22, 27, 10, V);
  R(g, -20, -22, 25, 1, V1);
  for (const x of [-14, -6, 2]) R(g, x, -22, 1, 12, P.gold0);
  R(g, -23, -21, 3, 10, P.metal0);
  D.disc(g, -23, -16, 2, P.gold);
  // Chimney and dome.
  R(g, -18, -29, 5, 7, V0);
  R(g, -17, -29, 3, 6, V);
  R(g, -20, -31, 9, 2, V0);
  D.oval(g, -6, -23, 3, 2, P.gold);
  // Cab with the driver.
  R(g, 6, -32, 16, 23, V0);
  R(g, 7, -31, 14, 21, V);
  R(g, 4, -34, 20, 2, V0);
  R(g, 4, -34, 20, 1, V1);
  R(g, 9, -29, 9, 8, P.gl1);
  raton(g, 13, -21);
  R(g, 9, -29, 9, 1, P.gl2);
  for (let y = -30; y < -10; y += 4) R(g, 20, y, 1, 1, V0);
  marcas(g, -20, -22, 40, 13, st, 3);
}

function pintarVagon(g: Ctx, rol: Rol, f: number, st: number) {
  for (const x of [-14, -8, 8, 14]) rueda(g, x, -3, 3, f);
  R(g, -19, -8, 38, 3, V0);
  // Couplers.
  R(g, -21, -7, 2, 1, P.metal0);
  R(g, 19, -7, 2, 1, P.metal0);
  R(g, -18, -20, 36, 12, V0);
  R(g, -17, -20, 34, 10, V);
  R(g, -17, -20, 34, 1, V1);
  R(g, -17, -14, 34, 1, P.p1);
  for (let x = -15; x < 17; x += 5) R(g, x, -18, 1, 1, V0);
  for (const x of [-11, 3]) R(g, x, -12, 7, 1, '#5a4a8a');
  if (rol === 'misil') {
    // A launch rail tilted up-left with two missiles and a gunner.
    R(g, -8, -23, 18, 3, V0);
    for (let m = 0; m < 2; m++)
      for (let i = 0; i < 16; i++) R(g, 8 - i, -24 - m * 4 - Math.round(i * 0.5), 2, 2, i < 2 ? P.p1 : i > 13 ? P.red : P.white);
    raton(g, 13, -20);
  } else {
    // Turret ring for the twin flak gun (barrels are drawn live) and its gunner.
    D.oval(g, 0, -22, 8, 3, V0);
    D.oval(g, 0, -23, 7, 2, V);
    R(g, -2, -27, 5, 4, V0);
    raton(g, 11, -20);
  }
  marcas(g, -17, -20, 34, 12, st, rol === 'misil' ? 5 : 9);
}

function trSprite(p: Parte, f: number) {
  const st = etapa(p);
  return D.outlined(`tren|${p.rol}|${st}|${f}`, VINK, TR_W, TR_H, TR_OX, TR_OY, (g) => {
    if (p.rol === 'motor') pintarLoco(g, f, st);
    else pintarVagon(g, p.rol, f, st);
  });
}

/* Motorbike */
function pintarMoto(g: Ctx, f: number) {
  rueda(g, -7, -3, 3, f);
  rueda(g, 7, -3, 3, f);
  R(g, -5, -6, 11, 2, V0);
  R(g, -5, -6, 11, 1, V);
  D.oval(g, 5, -8, 5, 3, V0);
  D.oval(g, 5, -9, 4, 2, V);
  // Pink leg shield, handlebar, headlight.
  R(g, -10, -14, 3, 9, P.p0);
  R(g, -9, -14, 2, 8, P.p1);
  R(g, -11, -16, 4, 1, P.metal0);
  D.disc(g, -11, -11, 1, P.gold);
  // Rider.
  R(g, -1, -12, 5, 4, V0);
  R(g, 0, -12, 3, 3, V);
  R(g, -6, -11, 5, 1, '#e0d8ec');
  R(g, -2, -8, 4, 2, V0);
  raton(g, 0, -12);
  // Rocket tube on the back.
  R(g, 4, -18, 8, 3, P.metal0);
  R(g, 4, -18, 8, 1, P.metal);
  R(g, 2, -18, 2, 3, P.red);
  // A little curly tail.
  R(g, 5, -11, 2, 1, P.p1);
  R(g, 7, -12, 1, 1, P.p1);
}
function motoSprite(f: number) {
  return D.outlined(`moto|${f}`, VINK, 28, 26, 14, 22, (g) => pintarMoto(g, f));
}

/* Infantry (feet at the origin, facing left) */
type PoseInf = 'corre0' | 'corre1' | 'corre2' | 'corre3' | 'apunta' | 'rodilla' | 'cubre' | 'tierra' | 'muerto';

function cabecita(g: Ctx, x: number, y: number, muerto = false) {
  D.disc(g, x + 1, y - 6, 1, '#c8c0d8');
  D.disc(g, x + 4, y - 5, 1, '#c8c0d8');
  D.oval(g, x, y - 2, 3, 2, '#e0d8ec');
  R(g, x - 4, y - 2, 1, 1, P.p0);
  if (muerto) {
    R(g, x - 2, y - 3, 1, 1, P.eye);
    R(g, x - 1, y - 2, 1, 1, P.eye);
    R(g, x - 1, y - 3, 1, 1, P.eye);
    R(g, x - 2, y - 2, 1, 1, P.eye);
  } else R(g, x - 1, y - 3, 1, 1, P.eye);
  R(g, x - 2, y - 5, 5, 1, P.r1);
  R(g, x - 1, y - 6, 3, 1, P.r1);
}

function pintarSoldado(g: Ctx, pose: PoseInf, bazuca: boolean) {
  const arma = (x: number, y: number) => {
    if (bazuca) {
      R(g, x - 5, y, 11, 2, P.metal0);
      R(g, x - 5, y, 11, 1, P.metal);
      R(g, x - 6, y, 1, 2, P.red);
      R(g, x + 5, y, 1, 2, P.gold0);
    } else R(g, x - 5, y + 1, 6, 1, P.metal0);
  };
  if (pose === 'tierra' || pose === 'muerto') {
    // Lying flat: body along x, head to the left.
    R(g, -2, -3, 6, 3, V0);
    R(g, -2, -3, 6, 2, V);
    R(g, 4, -2, 3, 2, V0);
    R(g, 7, -1, 2, 1, P.p1);
    if (pose === 'muerto') {
      cabecita(g, -4, 0, true);
      R(g, 5, -5, 1, 3, V0);
      R(g, 7, -5, 1, 3, V0);
    } else {
      cabecita(g, -4, 0);
      R(g, -8, -4, 3, 1, '#e0d8ec');
      arma(2, -5);
    }
    return;
  }
  const baja = pose === 'rodilla' || pose === 'cubre' ? 3 : 0;
  // Legs.
  if (pose.startsWith('corre')) {
    const f = Number(pose[5]);
    const a = [-2, -1, 1, 0][f], b = [1, 0, -2, -1][f];
    R(g, a - 1, -3, 2, 3, V0);
    R(g, b, -3, 2, 3, V0);
    R(g, a - 2, -1, 2, 1, P.k0);
    R(g, b - 1, -1, 2, 1, P.k0);
  } else if (baja) {
    R(g, -3, -2, 4, 2, V0);
    R(g, 1, -3, 2, 3, V0);
    R(g, -4, -1, 2, 1, P.k0);
  } else {
    R(g, -2, -3, 2, 3, V0);
    R(g, 1, -3, 2, 3, V0);
    R(g, -3, -1, 2, 1, P.k0);
    R(g, 0, -1, 2, 1, P.k0);
  }
  // Body, belt, tail.
  R(g, -2, -7 + baja, 5, 4, V0);
  R(g, -1, -7 + baja, 3, 3, V);
  R(g, -2, -4 + baja, 5, 1, P.k1);
  R(g, 3, -5 + baja, 2, 1, P.p1);
  R(g, 5, -6 + baja, 1, 1, P.p1);
  cabecita(g, 0, -7 + baja);
  // The weapon is drawn live when aiming; otherwise carried.
  if (pose !== 'apunta' && pose !== 'rodilla') arma(1, bazuca ? -9 + baja : -6 + baja);
}

function soldadoSprite(pose: PoseInf, bazuca: boolean) {
  return D.outlined(`raton-inf|${pose}|${bazuca ? 1 : 0}`, VINK, 24, 18, 12, 15, (g) => pintarSoldado(g, pose, bazuca));
}

/** A crop of a part (for VFX.pieza). Null outside the browser. */
function spritePieza(u: Unidad, p: Parte): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  try {
    let full: HTMLCanvasElement, ox: number, oy: number, cx: number, cy: number;
    const w = Math.min(60, p.w + 4), h = Math.min(40, p.h + 4);
    if (u.tipo === 'ratonzilla') {
      full = rzSprite(p.nombre, 0, 0);
      ox = RZ_OX;
      oy = RZ_OY;
      cx = p.dx;
      cy = -p.dy;
    } else if (u.tipo === 'tren') {
      full = trSprite({ ...p, viva: true, hp: p.hpMax }, 0);
      ox = TR_OX;
      oy = TR_OY;
      cx = 0;
      cy = -14;
    } else {
      full = motoSprite(0);
      ox = 14;
      oy = 22;
      cx = 0;
      cy = -10;
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(full, ox + cx - w / 2, oy + cy - h / 2, w, h, 0, 0, w, h);
    return c;
  } catch {
    return null;
  }
}

/** Live smoke, fire and sparks above a damaged part (screen coords). */
function humoFuego(g: Ctx, x: number, y: number, st: number, t: number, seed: number, esc = 1) {
  if (st < 2) return;
  const n = st === 2 ? 3 : st === 3 ? 4 : 5;
  const oscuro = st >= 3;
  for (let i = 0; i < n; i++) {
    const ph = (t * (st >= 4 ? 0.55 : 0.75) + i / n + seed * 0.137) % 1;
    const px = x + ph * 9 * esc + Math.sin(t * 2 + i * 2.1 + seed) * 1.5;
    const py = y - 2 - ph * 22 * esc;
    const r = Math.max(1, Math.round((1 + ph * 3.2) * esc));
    g.globalAlpha = Math.round((1 - ph) * 4) / 4 * 0.9;
    if (g.globalAlpha > 0) {
      D.disc(g, px, py, r, oscuro ? '#7a6e8e' : '#a89cb8');
      D.disc(g, px - 1, py - 1, Math.max(1, r - 1), oscuro ? '#9a8eae' : '#d8d0e4');
    }
  }
  g.globalAlpha = 1;
  if (st >= 3) {
    const fr = Math.floor(t * 14);
    for (let i = -2; i <= 2; i++) {
      const hgt = 1 + (hsh(fr + seed * 31, i + 9) % (st === 4 ? 3 : 5));
      R(g, x + i, y - hgt, 1, hgt, i === 0 ? P.gold : HOT);
      R(g, x + i, y - hgt - 1, 1, 1, i % 2 ? P.gold1 : HOT);
    }
    for (let i = 0; i < 3; i++) {
      const ph = (t * 1.7 + i * 0.37 + seed * 0.21) % 1;
      const dx = ((hsh(Math.floor(t * 1.7 + i * 0.37 + seed), i) % 9) - 4) * ph * 3;
      R(g, x + dx, y - 3 - ph * 16 + ph * ph * 10, 1, 1, ph < 0.5 ? P.gold1 : P.gold);
    }
  }
}

const quant = (a: number) => Math.round(a / 0.06) * 0.06;

/** Red blinking telegraph light. */
function aviso(g: Ctx, x: number, y: number, t: number, grande = false) {
  const on = Math.floor(t * 16) % 2 === 0;
  if (grande) R(g, x - 2, y - 2, 5, 5, on ? P.r1 : P.r0);
  R(g, x - 1, y - 1, 3, 3, on ? P.red : P.r0);
  R(g, x, y, 1, 1, on ? P.white : P.r2);
}

/**
 * Draws a unit. `sx`, `sy` map world → screen (like motor's). `flash` paints
 * the whole unit white (hit flash); parts also flash on their own when hit.
 */
export function dibujar(g: Ctx, u: Unidad, sx: (x: number) => number, sy: (y: number) => number, t: number, flash = false): void {
  if (u.quitar) return;
  if (u.tipo === 'infanteria') return dibujarSoldado(g, u, sx, sy, t, flash);
  if (u.tipo === 'moto') {
    const p = u.partes[0];
    const img = motoSprite(Math.floor(u.rueda / 3) % 4);
    g.save();
    g.translate(sx(u.x), sy(u.y));
    g.rotate(-quant(u.ang));
    g.drawImage(flash || p.flash > 0 ? blanco(img) : img, -14, -22);
    if (p.aviso > 0) aviso(g, 3, -17, t);
    g.restore();
    return;
  }
  if (u.tipo === 'tren') return dibujarTren(g, u, sx, sy, t, flash);
  dibujarRatonzilla(g, u, sx, sy, t, flash);
}

function dibujarSoldado(g: Ctx, u: Unidad, sx: (x: number) => number, sy: (y: number) => number, t: number, flash: boolean) {
  const p = u.partes[0];
  const baz = u.arma === 'bazuca';
  let pose: PoseInf;
  switch (u.estado) {
    case 'tierra':
      pose = 'tierra';
      break;
    case 'muerto':
      pose = 'muerto';
      break;
    case 'cubre':
      pose = 'cubre';
      break;
    case 'apunta':
    case 'dispara':
      pose = baz ? 'rodilla' : 'apunta';
      break;
    case 'aire':
      pose = u.viva ? 'corre1' : 'muerto';
      break;
    default:
      pose = u.vx === 0 ? 'apunta' : (`corre${Math.floor(u.rueda / 2.5) % 4}` as PoseInf);
  }
  const img = soldadoSprite(pose, baz);
  const X = sx(u.x), Y = sy(u.y);
  if (u.estado === 'muerto' && u.estadoT > 1.8) g.globalAlpha = Math.round((1 - (u.estadoT - 1.8) / 0.7) * 4) / 4;
  g.save();
  g.translate(X, Y - (u.estado === 'aire' ? 4 : 0));
  if (u.estado === 'aire') g.rotate(Math.round(u.spin / 0.4) * 0.4);
  if (u.mira === 1) g.scale(-1, 1);
  g.drawImage(flash || p.flash > 0 ? blanco(img) : img, -12, -15 + (u.estado === 'aire' ? 4 : 0));
  g.restore();
  // Weapon pointed at the plane while aiming / firing.
  if (u.viva && (u.estado === 'apunta' || u.estado === 'dispara') && g.globalAlpha > 0) {
    const hy = baz ? 6 : 6;
    g.save();
    g.translate(X, Y - hy);
    g.rotate(-Math.round(u.aim / 0.2) * 0.2);
    const r = -Math.round(p.retro);
    if (baz) {
      R(g, -6 + r, -2, 13, 4, VINK);
      R(g, -5 + r, -1, 11, 2, P.metal0);
      R(g, -5 + r, -1, 11, 1, P.metal);
      R(g, 6 + r, -1, 1, 2, P.red);
    } else {
      R(g, 0 + r, -1, 8, 3, VINK);
      R(g, 1 + r, 0, 6, 1, P.metal0);
      if (u.estado === 'dispara' && Math.floor(t * 30) % 2 === 0) R(g, 8, -1, 2, 3, P.gold);
    }
    g.restore();
    if (p.aviso > 0 && baz) aviso(g, X + u.mira * 3, Y - 13, t);
  }
  g.globalAlpha = 1;
}

function dibujarTren(g: Ctx, u: Unidad, sx: (x: number) => number, sy: (y: number) => number, t: number, flash: boolean) {
  const f = Math.floor(u.rueda / 3) % 4;
  // Back to front so the locomotive overlaps the coupler.
  for (let i = u.partes.length - 1; i >= 0; i--) {
    const p = u.partes[i];
    if (i > 0 && !p.viva) continue;
    const base = aMundo(p.wx, p.wy, p.ang, 0, -p.dy);
    const img = trSprite(p, f);
    g.save();
    g.translate(sx(base.x), sy(base.y));
    g.rotate(-quant(p.ang));
    if (p.rol === 'antiaereo' && p.viva) {
      // Twin flak barrels on the turret.
      g.save();
      g.translate(0, -25);
      g.rotate(-(Math.round(clamp(u.aim, 0.1, Math.PI - 0.1) / 0.1) * 0.1) + p.ang);
      const r = -Math.round(p.retro);
      for (const oy of [-2, 1]) {
        R(g, r, oy - 1, 13, 3, VINK);
        R(g, r, oy, 12, 1, P.metal);
      }
      g.restore();
    }
    g.drawImage(flash || p.flash > 0 ? blanco(img) : img, -TR_OX, -TR_OY);
    if (p.viva && p.aviso > 0) aviso(g, p.rol === 'misil' ? -8 : 0, p.rol === 'misil' ? -36 : -29, t, true);
    g.restore();
  }
  // Chimney smoke (live locomotive), then damage smoke/fire.
  const loco = u.partes[0];
  if (loco.viva) {
    const c = aMundo(u.x, u.y, u.ang, -14, 32);
    for (let i = 0; i < 5; i++) {
      const ph = (t * 0.9 + i / 5) % 1;
      const r = Math.round(1 + ph * 4);
      g.globalAlpha = Math.round((1 - ph) * 4) / 4;
      if (g.globalAlpha > 0) {
        D.disc(g, sx(c.x) + ph * 16 + Math.sin(t * 3 + i) * 1.5, sy(c.y) - ph * 20, r, '#d8d0e8');
        D.disc(g, sx(c.x) + ph * 16 - 1 + Math.sin(t * 3 + i) * 1.5, sy(c.y) - ph * 20 - 1, Math.max(1, r - 1), '#f8f4ff');
      }
    }
    g.globalAlpha = 1;
  }
  for (let i = 0; i < u.partes.length; i++) {
    const p = u.partes[i];
    if (i > 0 && !p.viva) continue;
    humoFuego(g, sx(p.wx + (i * 7) % 9 - 4), sy(p.wy + p.h / 2 - 4), etapa(p), t, i + u.id);
  }
}

function dibujarRatonzilla(g: Ctx, u: Unidad, sx: (x: number) => number, sy: (y: number) => number, t: number, flash: boolean) {
  const [orugas, t1, canon, cabina, t2] = u.partes;
  const f = Math.floor(u.rueda / 2) % 4;
  // The hull shows the average state of the whole tank.
  const frac = u.partes.reduce((s, p) => s + p.hp, 0) / u.partes.reduce((s, p) => s + p.hpMax, 0);
  const stCasco = !u.viva ? 3 : frac > 0.75 ? 0 : frac > 0.5 ? 1 : frac > 0.25 ? 2 : 3;
  const img = (capa: string, p: Parte | null, st: number, fr = 0) => {
    const s = rzSprite(capa, st, fr);
    return flash || (p && p.flash > 0) ? blanco(s) : s;
  };
  g.save();
  g.translate(sx(u.x), sy(u.y));
  g.rotate(-quant(u.ang));
  g.drawImage(img('orugas', orugas, etapa(orugas), orugas.viva ? f : 0), -RZ_OX, -RZ_OY);
  g.drawImage(img('casco', null, stCasco), -RZ_OX, -RZ_OY);
  g.drawImage(img('cabina', cabina, etapa(cabina)), -RZ_OX, -RZ_OY);
  g.drawImage(img('torreta1', t1, etapa(t1)), -RZ_OX, -RZ_OY);
  g.drawImage(img('torreta2', t2, etapa(t2)), -RZ_OX, -RZ_OY);
  if (canon.viva) {
    // The main gun follows the plane.
    g.save();
    g.translate(-22, -45);
    g.rotate(-(Math.round(u.aim / 0.05) * 0.05) + quant(u.ang));
    const r = -Math.round(canon.retro);
    R(g, r, -3, 36, 6, VINK);
    R(g, r, -2, 35, 4, P.metal);
    R(g, r, -2, 35, 1, '#e8ecf8');
    R(g, r + 10, -3, 2, 6, V0);
    R(g, r + 31, -4, 5, 8, VINK);
    R(g, r + 32, -3, 3, 6, P.metal0);
    g.restore();
  }
  g.drawImage(img('canon', canon, etapa(canon)), -RZ_OX, -RZ_OY);
  if (t1.viva && t1.aviso > 0) aviso(g, -40, -60, t, true);
  if (t2.viva && t2.aviso > 0) aviso(g, 44, -60, t, true);
  if (canon.viva && canon.aviso > 0) aviso(g, -6, -58, t, true);
  g.restore();
  // Smoke and fire over damaged parts; the hull smokes too when it's mostly wrecked.
  u.partes.forEach((p, i) => {
    const st = etapa(p);
    if (p.rol === 'orugas') {
      if (st >= 2) {
        humoFuego(g, sx(p.wx - 30), sy(p.wy + 6), st, t, 3);
        humoFuego(g, sx(p.wx + 25), sy(p.wy + 6), st, t, 8);
      }
    } else humoFuego(g, sx(p.wx), sy(p.wy + p.h / 2 - 3), st, t, i * 3 + 1, 1.2);
  });
  if (stCasco >= 2) humoFuego(g, sx(u.x + 5), sy(u.y + 34), stCasco, t, 19, 1.3);
}
