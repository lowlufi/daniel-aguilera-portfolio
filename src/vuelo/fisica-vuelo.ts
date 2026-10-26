/*
 * FLIGHT PHYSICS for the side-view plane game.
 *
 * Model: 2-D point mass with an orientation (nose angle `rumbo`) and a
 * second-order pitch axis. Forces: lift L = ½ρv²S·CL(α) perpendicular to the
 * relative wind, drag D = ½ρv²S·(CD0 + k·CL²) (+ separated-flow drag past the
 * stall), thrust along the nose, weight. α is measured between the nose and
 * the air-relative velocity (wind included). CL is linear up to the stall
 * angle, then drops; past the stall a nose-down moment appears and the
 * elevator loses authority, so the nose falls by itself and the wing
 * un-stalls while the plane gains speed in the dive.
 *
 * Out-of-plane roll: `alabeo` = cos(φ), φ the bank angle (0 or π). Only the
 * in-plane component of lift, L·cosφ, acts in our 2-D world, so during the
 * half-roll the wing briefly loses in-plane lift, as a real one would.
 *
 * SCALE (why these numbers). The sprites are drawn ~5× oversized for
 * readability, so the scale is chosen for the WORLD (distances, altitudes,
 * trajectories), not for the sprite size. With x_real = s·x_game and
 * t_real = k·t_game, any choice keeps the Froude number v²/(gL) of every
 * trajectory identical to the real one as long as g_game = 9.81·k²/s. We pick
 * s = 3.5 m/px and k = 5 (one game second shows five real seconds):
 *   g = 9.81·25/3.5 ≈ 70 px/s²
 *   avioneta 100 px/s → 70 m/s (aerobatic single, Extra-300-like)
 *   caza     150 px/s → 105 m/s (jet at low-level manoeuvring speed)
 *   bomber    85 px/s → 60 m/s
 * The screen (~450×250 px) spans ~1.6 km × 0.9 km. A free fall from 150 px
 * takes ~2.1 s, a 6-g half loop at 100 px/s has a radius of ~25 px; turns,
 * zooms and stalls are thus real manoeuvres, only fast-forwarded 5×.
 * Air density is in game units (ρ = 1 at sea level, scale height 1200 px
 * ≈ 4.2 km, close to the real ~8 km atmosphere compressed for drama).
 *
 * Fly-by-wire («apunta donde quieres ir»): the stick gives a desired flight
 * direction; an outer loop turns that into a path-turn rate, the needed
 * normal acceleration is converted into a lift coefficient → α command
 * (limited by g, by the stall angle and by available lift), and an inner PD
 * loop with dynamic inversion moves the nose through the real pitch inertia.
 * Thrust is an auto-throttle that holds cruise speed up to a cruise thrust
 * limit (so long climbs still bleed energy); `gas` raises target and limit.
 */

import type { Avion, Cuerpo, EventoVuelo, Mando, ModeloAvion, Suelo } from './fisica-tipos';

// ---------------------------------------------------------------- scale ----

const METROS_POR_PX = 3.5;
const SEGUNDO_REAL = 5;
const G = (9.81 * SEGUNDO_REAL * SEGUNDO_REAL) / METROS_POR_PX; // ≈ 70.07

export const ESCALA: { metrosPorPx: number; segundoReal: number; g: number } = {
  metrosPorPx: METROS_POR_PX,
  /** Real seconds represented by one game second. */
  segundoReal: SEGUNDO_REAL,
  /** Gravity in px/s². */
  g: G,
};

/** Air density (game units, 1 at y = 0). */
export function densidad(y: number): number {
  // A cartoon atmosphere: it thins slowly enough that the planes can still
  // fly up near space (≈ half the air at 3000 px), just slower to turn.
  return Math.exp(-Math.max(-200, Math.min(3600, y)) / 4500);
}
/** Altitude at which cruise parameters are trimmed. */
const ALT_REF = 100;

// ----------------------------------------------------------- parameters ----

export type ParamsAvion = {
  /** Mass (game units; impulses are divided by it). */
  masa: number;
  /** Max thrust with full `gas` (force: masa·px/s²). */
  empujeMax: number;
  /** Max thrust of the cruise auto-throttle (no gas). */
  empujeCrucero: number;
  /** Wing area (game units, so that L = W at cruise). */
  superficie: number;
  cl0: number;
  /** Lift slope, 1/rad. */
  clAlfa: number;
  /** Stall angle of attack (rad, body α). */
  alfaPerdida: number;
  cd0: number;
  /** Induced-drag factor k in CD = CD0 + k·CL². */
  kInducido: number;
  /** Positive load-factor limit (g). */
  cargaMax: number;
  /** Negative load-factor limit (g, negative number). */
  cargaMin: number;
  /** 1-g stall speed at the reference altitude, px/s. */
  velPerdida: number;
  velCrucero: number;
  /** Target speed with full gas, px/s. */
  velMax: number;
  /** Lift coefficient at cruise. */
  clCrucero: number;
  inerciaCabeceo: number;
  /** Max elevator moment at cruise dynamic pressure. */
  momentoMando: number;
  /** Fraction of elevator authority left at zero airspeed (prop wash). */
  mandoMinimo: number;
  /** Weathercock stability (moment per rad of α at cruise q). */
  rigidezCabeceo: number;
  /** Aerodynamic pitch damping (moment per rad/s at cruise speed). */
  amortCabeceo: number;
  /** Nose-down moment while stalled. */
  momentoPerdida: number;
  /** Natural frequency of the fly-by-wire pitch loop, rad/s. */
  wCabeceo: number;
  /** Time for the 180° half-roll, s. */
  tiempoTonel: number;
  /** Propeller (thrust falls with speed) vs jet. */
  helice: boolean;
  /** Distance from the plane's centre to its belly, px (ground contact). */
  panza: number;
};

type Base = {
  masa: number; velCrucero: number; velMax: number; clCrucero: number; cl0: number; clAlfa: number;
  alfaPerdida: number; cd0: number; kInducido: number; cargaMax: number; cargaMin: number;
  tpwCrucero: number; tpwMax: number; inercia: number; accMando: number; mandoMinimo: number;
  accRigidez: number; accAmort: number; accPerdida: number; wCabeceo: number; tiempoTonel: number;
  helice: boolean; panza: number;
};

function derivar(b: Base): ParamsAvion {
  const W = b.masa * G;
  const superficie = (2 * W) / (densidad(ALT_REF) * b.velCrucero * b.velCrucero * b.clCrucero);
  const clMax = b.cl0 + b.clAlfa * b.alfaPerdida;
  return {
    masa: b.masa,
    empujeMax: b.tpwMax * W,
    empujeCrucero: b.tpwCrucero * W,
    superficie,
    cl0: b.cl0,
    clAlfa: b.clAlfa,
    alfaPerdida: b.alfaPerdida,
    cd0: b.cd0,
    kInducido: b.kInducido,
    cargaMax: b.cargaMax,
    cargaMin: b.cargaMin,
    velPerdida: b.velCrucero * Math.sqrt(b.clCrucero / clMax),
    velCrucero: b.velCrucero,
    velMax: b.velMax,
    clCrucero: b.clCrucero,
    inerciaCabeceo: b.inercia,
    momentoMando: b.inercia * b.accMando,
    mandoMinimo: b.mandoMinimo,
    rigidezCabeceo: b.inercia * b.accRigidez,
    amortCabeceo: b.inercia * b.accAmort,
    momentoPerdida: b.inercia * b.accPerdida,
    wCabeceo: b.wCabeceo,
    tiempoTonel: b.tiempoTonel,
    helice: b.helice,
    panza: b.panza,
  };
}

export const PARAMS: Record<ModeloAvion, ParamsAvion> = {
  // Aerobatic single: light, big cambered wing, +7/-4 g, prop wash keeps the
  // elevator alive at low speed, snappy roll.
  avioneta: derivar({
    masa: 1, velCrucero: 100, velMax: 168, clCrucero: 0.22, cl0: 0.2, clAlfa: 7.5,
    alfaPerdida: 0.25, cd0: 0.028, kInducido: 0.045, cargaMax: 9.5, cargaMin: -3.5,
    tpwCrucero: 0.58, tpwMax: 1.05, inercia: 0.5, accMando: 48, mandoMinimo: 0.45,
    accRigidez: 25, accAmort: 3, accPerdida: 9, wCabeceo: 19, tiempoTonel: 0.22,
    helice: true, panza: 5,
  }),
  // Jet fighter: fast, thin low-aspect wing (high induced drag), afterburner
  // T/W > 1, structural limit caps the turn at high speed → wide circles.
  caza: derivar({
    masa: 1.6, velCrucero: 150, velMax: 265, clCrucero: 0.15, cl0: 0.05, clAlfa: 5.0,
    alfaPerdida: 0.3, cd0: 0.018, kInducido: 0.07, cargaMax: 11, cargaMin: -3,
    tpwCrucero: 0.7, tpwMax: 1.35, inercia: 1.2, accMando: 33, mandoMinimo: 0.2,
    accRigidez: 18, accAmort: 2.5, accPerdida: 7, wCabeceo: 15, tiempoTonel: 0.3,
    helice: false, panza: 5,
  }),
  // Heavy bomber: lots of mass and pitch inertia, low g limit, weak elevator,
  // slow roll. It cannot loop at cruise: reversals become stall turns.
  bombardero: derivar({
    masa: 4, velCrucero: 85, velMax: 130, clCrucero: 0.4, cl0: 0.35, clAlfa: 7,
    alfaPerdida: 0.24, cd0: 0.035, kInducido: 0.035, cargaMax: 5.5, cargaMin: -1.5,
    tpwCrucero: 0.4, tpwMax: 0.65, inercia: 6, accMando: 15, mandoMinimo: 0.3,
    accRigidez: 12, accAmort: 2.5, accPerdida: 5, wCabeceo: 8.5, tiempoTonel: 0.6,
    helice: true, panza: 7,
  }),
};

// ---------------------------------------------------------------- damage ---

/**
 * Battle damage as multipliers on the healthy airframe: a lost engine cuts
 * thrust, a torn wing loses lift (higher stall speed), a lost tail weakens
 * the elevator, broken panels add drag, and `temblor` shakes the nose.
 */
export type Dano = { empuje: number; sustentacion: number; mando: number; arrastre: number; temblor: number };
export const SANO: Dano = { empuje: 1, sustentacion: 1, mando: 1, arrastre: 1, temblor: 0 };
const danos = new WeakMap<Avion, Dano>();
export function fijarDano(a: Avion, d: Dano) {
  danos.set(a, d);
}

// --------------------------------------------------------------- helpers ---

const PI = Math.PI;
const TAU = 2 * PI;
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function wrap(a: number): number {
  if (!Number.isFinite(a)) return 0;
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}
function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Internal per-plane state that is not part of the shared `Avion` type. */
type Estado = {
  t: number;
  manteniendo: boolean;
  yRef: number;
  dirH: number;
  sentido: number; // remembered turn direction for a near-180° reversal (±1, 0 none)
  tonelObjetivo: number; // 0 (canopy up flying right) or π (rolled)
  tPerdida: number;
  contacto: boolean;
  enTecho: boolean;
  /** Work per unit mass done by all non-gravity forces (diagnostics). */
  trabajo: number;
};
const estados = new WeakMap<Avion, Estado>();
function estado(a: Avion): Estado {
  let e = estados.get(a);
  if (!e) {
    e = {
      t: 0, manteniendo: false, yRef: a.y, dirH: Math.cos(a.rumbo) >= 0 ? 1 : -1, sentido: 0,
      tonelObjetivo: a.alabeo >= 0 ? 0 : PI, tPerdida: 0, contacto: false, enTecho: false, trabajo: 0,
    };
    estados.set(a, e);
  }
  return e;
}

/**
 * Lift coefficient vs body angle of attack. Linear up to the stall, then a
 * drop to ~60 % of CLmax that fades to zero at 90°, flat-plate beyond (tail
 * slides). `perdida` uses the post-stall branch even slightly below αs
 * (hysteresis of separated flow).
 */
export function coefSustentacion(p: ParamsAvion, alfa: number, perdida: boolean): number {
  const a0 = -p.cl0 / p.clAlfa; // zero-lift angle
  const ae = alfa - a0;
  const as = p.alfaPerdida - a0; // stall measured from zero lift (symmetric)
  const abs = Math.abs(ae);
  if (abs >= PI / 2) return 0.8 * Math.sin(2 * ae);
  const clMax = p.clAlfa * as;
  if (abs <= as && !perdida) return p.clAlfa * ae;
  const sobre = Math.max(0, abs - as);
  const post =
    clMax * (0.6 + 0.4 * Math.exp(-sobre / 0.08)) * (perdida ? 0.85 : 1) *
    (Math.cos(abs) / Math.cos(Math.min(as, 1.3)));
  return Math.sign(ae) * Math.max(0, Math.min(post, p.clAlfa * abs));
}

export function coefArrastre(p: ParamsAvion, alfa: number, cl: number, perdida: boolean): number {
  const a0 = -p.cl0 / p.clAlfa;
  const ae = Math.abs(alfa - a0);
  const as = p.alfaPerdida - a0;
  const sep = perdida ? 1 : smooth(as * 0.9, as + 0.15, ae);
  const s = Math.sin(ae);
  return p.cd0 + p.kInducido * cl * cl + 1.3 * s * s * sep;
}

// ----------------------------------------------------------- public API ----

export function nuevoAvion(m: ModeloAvion, x: number, y: number, haciaDerecha = true): Avion {
  const p = PARAMS[m];
  const dir = haciaDerecha ? 1 : -1;
  const clTrim = p.clCrucero * (densidad(ALT_REF) / densidad(y));
  const alfaB = clamp((clTrim - p.cl0) / p.clAlfa, -0.1, p.alfaPerdida * 0.8);
  const gamma = haciaDerecha ? 0 : PI;
  const a: Avion = {
    x, y, vx: dir * p.velCrucero, vy: 0,
    rumbo: wrap(gamma + alfaB * dir), omega: 0, alabeo: dir, carga: 1, perdida: false, gas: 0,
  };
  estado(a);
  return a;
}

const H_MAX = 1 / 240;

export function pasoAvion(
  a: Avion, m: ModeloAvion, mando: Mando, dt: number, suelo: Suelo, techo: number,
): EventoVuelo[] {
  const ev: EventoVuelo[] = [];
  if (!(dt > 0)) return ev;
  dt = Math.min(dt, 0.1);
  sanear(a, m);
  const n = Math.max(1, Math.ceil(dt / H_MAX - 1e-9));
  const h = dt / n;
  const mx = clamp(fin(mando.x), -1, 1);
  const my = clamp(fin(mando.y), -1, 1);
  const gas = clamp(fin(mando.gas), -1, 1);
  const tch = Number.isFinite(techo) ? techo : 1e9;
  let impacto = -1;
  for (let i = 0; i < n; i++) {
    const r = subpaso(a, m, mx, my, gas, h, suelo, tch, ev);
    if (r > impacto) impacto = r;
  }
  if (impacto >= 0) ev.push({ tipo: 'toqueSuelo', velocidad: impacto });
  sanear(a, m);
  return ev;
}

/** One integration sub-step. Returns the ground impact speed (≥0) or -1. */
function subpaso(
  a: Avion, m: ModeloAvion, mx: number, my: number, gas: number, h: number,
  suelo: Suelo, techo: number, ev: EventoVuelo[],
): number {
  const p = PARAMS[m];
  const e = estado(a);
  const dn = danos.get(a) ?? SANO;
  e.t += h;
  const W = p.masa * G;

  // --- air data --------------------------------------------------------
  const w = viento(e.t, a.x, a.y);
  const vax = a.vx - w;
  const vay = a.vy;
  const V = Math.hypot(vax, vay);
  const gam = V > 1e-3 ? Math.atan2(vay, vax) : a.rumbo;
  const rho = densidad(a.y);
  const delgado = 1 - 0.8 * smooth(techo - 40, techo + 2, a.y); // thin air near the ceiling
  const q = 0.5 * rho * V * V;
  const qc = 0.5 * densidad(ALT_REF) * p.velCrucero * p.velCrucero;
  const qf = q / qc;
  const s = a.alabeo >= 0 ? 1 : -1;
  const alfaG = wrap(a.rumbo - gam);
  const alfaB = alfaG * s;

  // --- stall state (hysteresis) ---------------------------------------
  const as = p.alfaPerdida;
  if (!a.perdida && (alfaB > as || alfaB < -0.8 * as) && V > 2) {
    a.perdida = true;
    e.tPerdida = 0;
    ev.push({ tipo: 'perdida' });
  } else if (a.perdida) {
    e.tPerdida += h;
    if (e.tPerdida > 0.25 && alfaB < 0.75 * as && alfaB > -0.6 * as) {
      a.perdida = false;
      ev.push({ tipo: 'recupera' });
    }
  }

  // --- fly-by-wire: desired flight direction ----------------------------
  const mag = Math.hypot(mx, my);
  let thetaD: number;
  if (mag > 0.2) {
    e.manteniendo = false;
    thetaD = Math.atan2(my, mx);
  } else {
    if (!e.manteniendo) {
      e.manteniendo = true;
      e.yRef = a.y + clamp(a.vy, -60, 60) * 0.3;
      e.dirH = Math.abs(a.vx) > 10 ? Math.sign(a.vx) : Math.cos(a.rumbo) >= 0 ? 1 : -1;
    }
    let vyT = clamp(2 * (e.yRef - a.y), -0.35 * V, 0.35 * V);
    // Stall protection when hands-off: trade height for speed.
    if (V < 1.15 * p.velPerdida) vyT = Math.min(vyT, -(1.15 * p.velPerdida - V) * 1.2);
    // Follow the pilot's held altitude down if it was taken during a sink.
    if (vyT < 0 && a.y < e.yRef) e.yRef = Math.min(e.yRef, a.y + 40);
    thetaD = Math.atan2(vyT, e.dirH * Math.sqrt(Math.max(V * V - vyT * vyT, 1)));
  }
  // Ceiling: taper the allowed climb angle in thin air.
  const maxSin = clamp((techo - 6 - a.y) / 45, -0.4, 1);
  if (Math.sin(thetaD) > maxSin) {
    const c = Math.cos(thetaD);
    const sx = Math.abs(c) > 1e-3 ? Math.sign(c) : Math.cos(gam) >= 0 ? 1 : -1;
    thetaD = Math.atan2(maxSin, sx * Math.sqrt(1 - maxSin * maxSin));
  }
  let err = wrap(thetaD - gam);
  // Near-180° reversals: pick a sense (up = over the top unless the ceiling
  // is close) and keep it, so the wrap at ±π does not make it dither.
  if (Math.abs(err) > 1.4) {
    if (e.sentido === 0) {
      if (Math.abs(err) > 2.9) {
        const arriba = Math.cos(gam) >= 0 ? 1 : -1; // rotation sense that goes over the top
        const rEst = (V * V) / (G * Math.max(1, Math.min(p.cargaMax, p.velCrucero ** 2 / p.velPerdida ** 2) - 1));
        const cabeArriba = a.y + 2 * rEst < techo + 5;
        const cabeAbajo = a.y - 2.2 * rEst > fin(suelo(a.x + Math.sign(a.vx) * rEst), 0) + p.panza + 15;
        e.sentido = cabeArriba || !cabeAbajo ? arriba : -arriba;
      } else e.sentido = Math.sign(err) || 1;
    }
    if (Math.sign(err) !== e.sentido) err -= TAU * Math.sign(err);
  } else e.sentido = 0;

  const gamDotD = clamp(6 * err, -12, 12);

  // Half-roll target. Normally: canopy up for the direction the nose points
  // (cos(rumbo) < 0 → rolled), but only once the pull-through is nearly done,
  // as in an Immelmann (half loop, then half roll). For a reversal that has
  // to turn the "other" way (split-S, diving), roll first so the pull is
  // positive-g. Pilots unload (α → 0) to roll: a roll about the body axis
  // would turn +α into −α and snap the wing into a negative stall.
  const cg = Math.cos(gam);
  const cr = Math.cos(a.rumbo);
  if (mag > 0.2 && Math.abs(err) > 1.6) e.tonelObjetivo = err > 0 ? 0 : PI;
  else if (cr < -0.15 && (Math.abs(gamDotD) < 1.5 || cg < -0.95)) e.tonelObjetivo = PI;
  else if (cr > 0.15 && (Math.abs(gamDotD) < 1.5 || cg > 0.95)) e.tonelObjetivo = 0;
  let phi = Math.acos(clamp(a.alabeo, -1, 1));
  const rodando = Math.abs(e.tonelObjetivo - phi) > 1e-3;
  const aN = V * gamDotD + G * Math.cos(gam); // normal accel needed (CCW-positive)
  // Convert to a body lift coefficient through the in-plane roll factor.
  const eff = a.alabeo * delgado;
  const forzando = mag > 0.85 && Math.abs(err) > 0.3 && V < 1.25 * p.velPerdida;
  let alfaCmdB: number;
  if (Math.abs(eff) < 0.12 || q < 1e-3) {
    alfaCmdB = 0;
  } else {
    const qS = q * p.superficie * Math.abs(eff);
    let clB = (aN * s * p.masa) / qS; // sign → body "pull" positive
    clB = clamp(clB, (p.cargaMin * W) / qS, (p.cargaMax * W) / qS);
    alfaCmdB = (clB - p.cl0) / p.clAlfa;
  }
  const alfaLim = a.perdida ? 0.5 * as : forzando ? 1.15 * as : 0.92 * as;
  alfaCmdB = rodando ? 0 : clamp(alfaCmdB, -0.65 * as, alfaLim);
  const thetaCmd = gam + alfaCmdB * s;
  // Path rate that this α will actually produce: feed-forward for the nose,
  // so the nose turns with the path instead of racing ahead of it.
  const clCmd = coefSustentacion(p, alfaCmdB, false);
  const gamDotAlc = V > 5 ? ((q * p.superficie * clCmd * eff) / p.masa - G * Math.cos(gam)) / V : 0;
  const gamDotFF = clamp(gamDotAlc, -Math.abs(gamDotD) - 0.5, Math.abs(gamDotD) + 0.5);

  // --- pitch dynamics (second order) -----------------------------------
  const I = p.inerciaCabeceo;
  // Weathercock; when stalled the tail sits in the free stream at high α and
  // keeps working even at low q (floor), which guarantees self-recovery.
  const Ms = -p.rigidezCabeceo * (a.perdida ? Math.max(qf, 0.4) : qf) * Math.sin(alfaG);
  const Md = -p.amortCabeceo * Math.max(a.perdida ? 1.3 : 0.5, V / p.velCrucero) * a.omega;
  // Stall break: pitches the nose toward α = 0 (down in a normal stall, up in
  // an inverted one), fading as the wing re-attaches.
  const Mp = a.perdida ? -s * p.momentoPerdida * (0.4 + Math.min(qf, 2)) * clamp(alfaB / as, -1, 1) : 0;
  const wn = p.wCabeceo;
  const accD = wn * wn * wrap(thetaCmd - a.rumbo) + 2 * 0.85 * wn * (gamDotFF - a.omega);
  const autoridad = p.momentoMando * Math.max(p.mandoMinimo, Math.min(qf, 2.5)) * (a.perdida ? 0.3 : 1) * delgado * dn.mando;
  const Me = clamp(I * accD - Ms - Md, -autoridad, autoridad);
  // Damage buffeting: random pitch kicks.
  const Mt = dn.temblor ? (Math.random() - 0.5) * 2 * dn.temblor * p.momentoMando * 0.5 : 0;
  a.omega = clamp(a.omega + ((Me + Ms + Md + Mp + Mt) / I) * h, -15, 15);
  a.rumbo = wrap(a.rumbo + a.omega * h);

  // --- half-roll (rate slowed until the wing is unloaded) ---------------
  const descargado = clamp(1 - Math.abs(alfaG) / (0.6 * as), 0.25, 1);
  const vr = (PI / p.tiempoTonel) * h * descargado;
  phi += clamp(e.tonelObjetivo - phi, -vr, vr);
  a.alabeo = Math.cos(phi);

  // --- forces ---------------------------------------------------------
  const alfaB2 = wrap(a.rumbo - gam) * (a.alabeo >= 0 ? 1 : -1);
  const cl = coefSustentacion(p, alfaB2, a.perdida) * dn.sustentacion;
  const cd = coefArrastre(p, alfaB2, cl, a.perdida);
  const lIn = q * p.superficie * cl * a.alabeo * delgado; // in-plane lift (CCW of wind)
  // Braking (gas < 0) idles the engine and opens air brakes: extra parasite drag.
  const freno = Math.max(0, -gas);
  const dr = q * p.superficie * (cd * dn.arrastre + freno * p.cd0 * 4);
  const ux = V > 1e-3 ? vax / V : Math.cos(a.rumbo);
  const uy = V > 1e-3 ? vay / V : Math.sin(a.rumbo);

  // Auto-throttle: hold the target speed, limited by cruise or boost thrust.
  const vObj = gas >= 0 ? p.velCrucero + gas * (p.velMax - p.velCrucero) : p.velCrucero - freno * (p.velCrucero - 1.3 * p.velPerdida);
  let tLim = (p.empujeCrucero + Math.max(0, gas) * (p.empujeMax - p.empujeCrucero)) * delgado * (1 - 0.8 * freno);
  if (p.helice) tLim *= clamp(1.25 - 0.25 * (V / p.velCrucero), 0.55, 1.4);
  tLim *= dn.empuje;
  const tReq = dr + W * Math.sin(gam) + (p.masa * (vObj - V)) / 0.8;
  const T = clamp(tReq, 0, tLim);
  a.gas = clamp(T / (p.empujeMax * delgado + 1e-9), 0, 1);

  let fx = -dr * ux + lIn * -uy + T * Math.cos(a.rumbo);
  let fy = -dr * uy + lIn * ux + T * Math.sin(a.rumbo) - W;
  // Soft ceiling: thin air plus a gentle spring above `techo`.
  if (a.y > techo) fy += p.masa * (-(a.y - techo) * 60 - Math.max(0, a.vy) * 8);
  fx = fin(fx);
  fy = fin(fy);
  a.carga = fin((q * p.superficie * cl * Math.abs(a.alabeo) * delgado) / W, 0);

  // Semi-implicit Euler.
  const vx0 = a.vx, vy0 = a.vy;
  a.vx += (fx / p.masa) * h;
  a.vy += (fy / p.masa) * h;
  e.trabajo += ((fx * (vx0 + a.vx) + (fy + W) * (vy0 + a.vy)) / (2 * p.masa)) * h;
  a.x += a.vx * h;
  a.y += a.vy * h;

  // --- ceiling event ------------------------------------------------------
  if (!e.enTecho && a.y > techo - 3) {
    e.enTecho = true;
    ev.push({ tipo: 'techo' });
  } else if (e.enTecho && a.y < techo - 20) e.enTecho = false;

  // --- ground ---------------------------------------------------------
  return contactoSuelo(a, p, e, suelo);
}

/**
 * Specific energy ½v² + g·y (px²/s²) and the work per unit mass done on the
 * plane by thrust, drag and lift since it was created. Diagnostics: the
 * change of the first should track the second.
 */
export function energia(a: Avion): { especifica: number; trabajo: number } {
  return { especifica: 0.5 * (a.vx * a.vx + a.vy * a.vy) + G * a.y, trabajo: estado(a).trabajo };
}

function contactoSuelo(a: Avion, p: ParamsAvion, e: Estado, suelo: Suelo): number {
  const gy = fin(suelo(a.x), -1e9);
  if (a.y - p.panza >= gy) {
    if (a.y - p.panza > gy + 1.5) e.contacto = false;
    return -1;
  }
  const pend = (fin(suelo(a.x + 2), gy) - fin(suelo(a.x - 2), gy)) / 4;
  const nl = Math.hypot(pend, 1);
  const nx = -pend / nl;
  const ny = 1 / nl;
  a.y = gy + p.panza;
  let impacto = -1;
  const vn = a.vx * nx + a.vy * ny;
  if (vn < 0) {
    if (!e.contacto || vn < -20) impacto = -vn;
    const tx = a.vx - vn * nx;
    const ty = a.vy - vn * ny;
    const rest = 0.3;
    a.vx = tx * 0.92 + rest * -vn * nx;
    a.vy = ty * 0.92 + rest * -vn * ny;
  }
  // Nose cannot point into the ground: align it with the slope.
  const dn = Math.cos(a.rumbo) * nx + Math.sin(a.rumbo) * ny;
  if (dn < 0) {
    const ang = Math.atan2(ny, nx);
    const c1 = wrap(ang - PI / 2);
    const c2 = wrap(ang + PI / 2);
    a.rumbo = Math.abs(wrap(a.rumbo - c1)) < Math.abs(wrap(a.rumbo - c2)) ? c1 : c2;
    a.omega = 0;
  }
  e.contacto = true;
  return impacto;
}

function sanear(a: Avion, m: ModeloAvion): void {
  const p = PARAMS[m];
  const VMAX = 600;
  if (!Number.isFinite(a.rumbo)) a.rumbo = 0;
  if (!Number.isFinite(a.omega)) a.omega = 0;
  if (!Number.isFinite(a.alabeo)) a.alabeo = Math.cos(a.rumbo) >= 0 ? 1 : -1;
  if (!Number.isFinite(a.x)) a.x = 0;
  if (!Number.isFinite(a.y)) a.y = 100;
  if (!Number.isFinite(a.vx) || !Number.isFinite(a.vy)) {
    a.vx = Math.cos(a.rumbo) * p.velCrucero;
    a.vy = Math.sin(a.rumbo) * p.velCrucero;
  }
  const v = Math.hypot(a.vx, a.vy);
  if (v > VMAX) {
    a.vx *= VMAX / v;
    a.vy *= VMAX / v;
  }
  if (!Number.isFinite(a.carga)) a.carga = 1;
  if (!Number.isFinite(a.gas)) a.gas = 0;
}

/**
 * Impulse from an explosion or a hit. (ix, iy) is the velocity change in px/s
 * for a unit mass; heavier planes are shoved less. An off-axis kick also
 * tumbles the nose a bit (pitch impulse through the arm of the airframe).
 */
export function empujar(a: Avion, m: ModeloAvion, ix: number, iy: number): void {
  const p = PARAMS[m];
  ix = fin(ix);
  iy = fin(iy);
  a.vx += ix / p.masa;
  a.vy += iy / p.masa;
  const cruz = Math.cos(a.rumbo) * iy - Math.sin(a.rumbo) * ix; // perpendicular part
  const brazo = 0.01; // effective lever arm of the blast on the airframe
  a.omega = clamp(a.omega + (cruz * brazo) / p.inerciaCabeceo, -15, 15);
  sanear(a, m);
}

// ------------------------------------------------------ flares & crates ---

/** Implicit quadratic-drag step: stable for any dt and any drag. */
function pasoArrastre(c: Cuerpo, dt: number, vientoX: number, k: number, ax = 0): void {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const rx = c.vx - vientoX;
    const ry = c.vy;
    const sp = Math.hypot(rx, ry);
    const f = 1 / (1 + k * sp * h);
    c.vx = vientoX + (rx + ax * h) * f;
    c.vy = (ry - G * h) * f;
    c.x += c.vx * h;
    c.y += c.vy * h;
  }
}

/** Magnesium flare: light, huge drag (terminal ≈ 28 px/s), drifts with wind. */
export function pasoBengala(b: Cuerpo, dt: number, viento: number): void {
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);
  const vt = 28;
  pasoArrastre(b, dt, fin(viento), G / (vt * vt));
  b.t += dt;
  if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) {
    b.vx = 0;
    b.vy = -vt;
    if (!Number.isFinite(b.x)) b.x = 0;
    if (!Number.isFinite(b.y)) b.y = 0;
  }
}

/** Seconds of free fall before the canopy opens, and inflation time. */
const PARA_APERTURA = 0.35;
const PARA_INFLADO = 0.6;
const PARA_VT = 16; // terminal sink speed under canopy, px/s (≈ 11 m/s real-time-scaled)

/** Swing angle of the crate under its canopy (rad), for drawing. */
export function anguloParacaidas(c: Cuerpo): number {
  const abierto = smooth(PARA_APERTURA, PARA_APERTURA + PARA_INFLADO, c.t);
  return 0.3 * abierto * Math.cos(2.1 * c.t) * Math.exp(-0.05 * Math.max(0, c.t - 1));
}

/** Crate under a parachute. Returns true once it touches the ground. */
export function pasoParacaidas(c: Cuerpo, dt: number, viento: number, suelo: Suelo): boolean {
  if (!(dt > 0)) return false;
  dt = Math.min(dt, 0.1);
  const abierto = smooth(PARA_APERTURA, PARA_APERTURA + PARA_INFLADO, c.t + dt);
  const kCaida = G / (110 * 110);
  const kAbierto = G / (PARA_VT * PARA_VT);
  const k = kCaida + (kAbierto - kCaida) * abierto;
  // Pendulum swing: the canopy drags the crate side to side.
  const ax = -2.1 * 0.3 * abierto * Math.sin(2.1 * c.t) * 2.1 * 6;
  pasoArrastre(c, dt, fin(viento) * (0.4 + 0.5 * abierto), k, ax);
  c.t += dt;
  if (!Number.isFinite(c.x + c.y + c.vx + c.vy)) {
    c.vx = 0;
    c.vy = -PARA_VT;
    if (!Number.isFinite(c.x)) c.x = 0;
    if (!Number.isFinite(c.y)) c.y = 0;
  }
  const gy = fin(suelo(c.x), -1e9);
  if (c.y <= gy) {
    c.y = gy;
    c.vx = 0;
    c.vy = 0;
    return true;
  }
  return false;
}

// ----------------------------------------------------------------- wind ---

/**
 * Horizontal wind in px/s (positive = blowing to +x). Deterministic: a slow
 * prevailing breeze, a few travelling waves and occasional gusts, a bit
 * stronger aloft (boundary layer). Roughly within ±14 px/s.
 */
export function viento(t: number, x: number, y: number): number {
  t = fin(t);
  x = fin(x);
  y = fin(y);
  const base = 5 * Math.sin(t * 0.045 + 0.7);
  const ondas = 2.5 * Math.sin(0.31 * t + 0.011 * x) + 1.5 * Math.sin(0.73 * t - 0.023 * x + 1.3);
  const env = Math.max(0, Math.sin(0.13 * t + 0.004 * x));
  const rafaga = 5 * env * env * env * env * Math.sin(1.7 * t + 0.03 * x);
  const capa = 0.55 + 0.45 * clamp(y / 150, 0, 1);
  return (base + ondas + rafaga) * capa;
}
