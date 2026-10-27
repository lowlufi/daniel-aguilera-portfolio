/**
 * Enemy fighters: mice flying real planes (the same flight physics as the
 * player's, through FV.pasoAvion; the stick is a wanted flight direction).
 * From wave 3 on they dogfight the plane with basic fighter manoeuvres, all
 * inside the side view (every "turn" is a pitch loop up or down):
 *
 *  - Pursuit by geometry and energy: LEAD (nose on the gun solution) inside
 *    gun range, PURE (nose on the plane) to close, LAG (nose behind it) when
 *    closing too fast or slow, so they don't overshoot or bleed their speed.
 *  - Energy: they approach from above (boom), slash through, then EXTEND and
 *    ZOOM-climb away instead of turning slow; the better pilots HIGH YO-YO
 *    (pull up out of the fight, then come down behind) and REVERSE hard.
 *  - Defence with the plane on their six (angle-off + range): a BREAK into
 *    the attacker, jinks against its guns, SCISSORS when it stays glued, and
 *    a beam-then-last-ditch break against a player missile (if the engine
 *    passes the missile list).
 *  - Guns only with a real firing solution (bullet speed VEL_BALA + gravity,
 *    the nose has to be on the lead point) after a short tell (nose light
 *    blinks), short bursts; missiles only from the rear hemisphere after a
 *    red "lock" blink.
 *  - Pairs: with 2+ fighters alive, odd ones fly as wingmen: formation while
 *    nothing happens, BRACKET the plane (other side of its path) while the
 *    leader attacks, and pounce when the plane commits on the leader.
 *  - Terrain look-ahead (never into the hills), the ceiling respected, and
 *    the commanded direction turns at a skill-limited rate: no snaps.
 *
 * Skill `hab` 0…1 grows with the wave; Margarita (`jefa`) is 1 and adds
 * feints, a supermaneuverable reversal and smarter missile timing.
 */
import * as FV from './fisica-vuelo';
import * as A from './dibujo';
import { drawPlaneGiro, framePara } from './giro';
import { GRAVEDAD } from './fisica-armas';
import { lineaLibre } from './ia';
import { P } from '../game/dulce';
import type { Avion, ModeloAvion, ModeloBase, Movil } from './fisica-tipos';

type Ctx = CanvasRenderingContext2D;
type Suelo = (x: number) => number;

export type Modo =
  | 'ataque' | 'extension' | 'yoyo' | 'reversa' | 'defensa' | 'tijera' | 'evasion' | 'bracket' | 'formacion' | 'retirada';

export type Caza = {
  id: number;
  a: Avion;
  /** Airframe it flies (Margarita: 'sukhoi' unless told otherwise). */
  modelo: ModeloAvion;
  hp: number;
  hpMax: number;
  /** Seconds to the next burst, shots left in it, and gap between shots. */
  gunCd: number;
  rafaga: number;
  rafT: number;
  misilCd: number;
  flash: number;
  /** Legacy fields (kept for compatibility). */
  escape: number;
  escDir: number;
  /** Muzzle flash left, s. */
  fogonazo: number;
  /** Storm aces: fragile but they dogfight hard. */
  agresivo: boolean;
  quiebre: number;
  /** Margarita herself at the stick: the boss duel over Valparaíso. */
  jefa?: boolean;
  /** Pilot skill 0…1 (reaction time, aim tolerance, manoeuvres used). */
  hab: number;
  /** Current manoeuvre and its timer; decT: time to the next decision. */
  modo: Modo;
  modoT: number;
  decT: number;
  /** Seconds in the current defensive fight (to escalate to scissors). */
  defT: number;
  /** Commanded flight-path angle (rate limited) and the loop sense it committed to. */
  dir: number;
  sentido: number;
  /** Tells: gun (nose light) and missile lock (red blink) before firing, s. */
  aviso: number;
  avisoMisil: number;
  /** Jink / scissors timer and side. */
  jinkT: number;
  lado: 1 | -1;
  /** Margarita's feint timer (breaks the wrong way first). */
  fintaT: number;
  /** Pursuit in use (for debugging): 'lead' | 'pure' | 'lag'. */
  pers: string;
  /** performance.now() of the last step (implicit registry when no `todos`). */
  ultimo: number;
};

export type Disparo = { x: number; y: number; vx: number; vy: number };
export type Orden = { disparos: Disparo[]; misil: boolean };
/** A player missile as the fighters see it (any Movil works). */
export type Amenaza = { x: number; y: number; vx: number; vy: number };

const VEL_BALA = 330;
export const PUNTOS = 350;
export const RADIO = 8;
/** Range the fighters like to fight from (they shoot from here), the one where they break off, and a hard floor. */
const DIST_TIRO = 240;
const DIST_MIN = 150;
const DIST_DURA = 115;
const G = GRAVEDAD;
const PI = Math.PI;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const angDif = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const ahora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let ids = 0;

/** How many fighters a wave brings (none before wave 3). */
export function cuantos(oleada: number): number {
  return oleada < 3 ? 0 : Math.min(4, 1 + Math.floor((oleada - 3) / 2));
}

/**
 * A new fighter. Toughness and skill grow with the wave:
 *  - mice: 2.4 hp at wave 3 → 4.5 hp from wave 13; skill 0.2 → 0.9.
 *  - storm aces (`agresivo`): 1.5 → 2.4 hp, skill +0.12.
 *  - Margarita (`jefa`): 16 → 28 hp, skill 1. `modelo` picks her airframe.
 */
export function crear(x: number, y: number, haciaDerecha: boolean, oleada: number, agresivo = false, jefa = false, modelo?: ModeloAvion): Caza {
  const m: ModeloAvion = modelo ?? (jefa ? 'sukhoi' : 'caza');
  const a = FV.nuevoAvion(m, x, y, haciaDerecha);
  const w = Math.max(0, fin(oleada, 3) - 3);
  const hab = jefa ? 1 : clamp(0.2 + w * 0.075 + (agresivo ? 0.12 : 0), 0.2, 0.92);
  const hp = jefa ? 16 + Math.min(12, w * 0.9) : agresivo ? 1.5 + Math.min(0.9, w * 0.1) : 2.4 + Math.min(2.1, w * 0.2);
  return {
    id: ++ids, a, modelo: m, hp, hpMax: hp,
    gunCd: jefa ? 1.4 : agresivo ? 1.2 : 2.2, rafaga: 0, rafT: 0,
    misilCd: jefa ? 4 : 6 + Math.random() * 4, flash: 0, escape: 0, escDir: 1, fogonazo: 0, agresivo, quiebre: 0,
    ...(jefa ? { jefa: true } : {}),
    hab, modo: 'ataque', modoT: 0, decT: 0.3, defT: 0, dir: a.rumbo, sentido: 0, aviso: 0, avisoMisil: 0,
    jinkT: 0, lado: Math.random() < 0.5 ? 1 : -1, fintaT: 0, pers: 'pure', ultimo: ahora(),
  };
}

/* ── Registry (wingmen without a `todos` list from the engine) ──────────── */

const registro = new Set<Caza>();
function vivos(c: Caza): Caza[] {
  c.ultimo = ahora();
  registro.add(c);
  const t = c.ultimo;
  const out: Caza[] = [];
  for (const o of registro) {
    // A fighter that hasn't flown for a while was removed by the engine.
    if (o.hp <= 0 || t - o.ultimo > 400) registro.delete(o);
    else out.push(o);
  }
  return out;
}

/* ── Geometry helpers ───────────────────────────────────────────────────── */

/**
 * Gun solution: the nose angle that puts a bullet (muzzle speed VEL_BALA on
 * top of the fighter's own velocity, falling with gravity) on the plane if it
 * keeps flying straight. Null if the time of flight is too long.
 */
function solucion(a: Avion, j: Movil): { ang: number; t: number } | null {
  const ox = a.x + Math.cos(a.rumbo) * 9, oy = a.y + Math.sin(a.rumbo) * 9;
  const rx = j.x - ox, ry = j.y - oy, vx = j.vx - a.vx, vy = j.vy - a.vy;
  let t = Math.hypot(rx, ry) / VEL_BALA;
  for (let i = 0; i < 4; i++) t = Math.hypot(rx + vx * t, ry + vy * t + 0.5 * G * t * t) / VEL_BALA;
  if (!(t < 1.1)) return null;
  return { ang: Math.atan2(ry + vy * t + 0.5 * G * t * t, rx + vx * t), t };
}

/** The most urgent player missile: time to go and the bearing missile → fighter. */
function misilCercano(a: Avion, misiles?: readonly Amenaza[]): { ttg: number; ang: number; d: number } | null {
  if (!misiles) return null;
  let best: { ttg: number; ang: number; d: number } | null = null;
  for (const m of misiles) {
    const rx = a.x - m.x, ry = a.y - m.y;
    const d = Math.hypot(rx, ry);
    if (!(d > 1) || d > 360) continue;
    const cierre = -(rx * (a.vx - m.vx) + ry * (a.vy - m.vy)) / d;
    if (cierre < 25) continue;
    const ttg = d / cierre;
    if (!best || ttg < best.ttg) best = { ttg, ang: Math.atan2(ry, rx), d };
  }
  return best;
}

function poner(c: Caza, m: Modo, t: number) {
  if (c.modo !== m) {
    if (m === 'defensa') {
      c.defT = 0;
      // Margarita sells a break the wrong way first.
      c.fintaT = c.jefa ? 0.35 : 0;
    }
    if (m === 'tijera') c.jinkT = 0;
  }
  c.modo = m;
  c.modoT = t;
}

/* ── The brain ──────────────────────────────────────────────────────────── */

/**
 * One step of a fighter's brain and flight. Optional (for the full effect):
 *  - `todos`: every fighter alive (wingman pairs and deconfliction). Without
 *    it the fighters find each other through an internal registry.
 *  - `misiles`: the player's missiles in flight (missile defence: beam, then
 *    a last-ditch break). Without it they only react to the plane's nose.
 */
export function paso(
  c: Caza, jugador: Movil, vivo: boolean, dt: number, suelo: Suelo, techo: number, oleada: number,
  todos?: readonly Caza[], misiles?: readonly Amenaza[],
): Orden {
  const out: Orden = { disparos: [], misil: false };
  const a = c.a;
  dt = clamp(fin(dt), 0, 0.1);
  c.flash = Math.max(0, c.flash - dt);
  c.fogonazo = Math.max(0, c.fogonazo - dt);
  const lista = todos ? todos.filter((o) => o.hp > 0) : vivos(c);
  if (todos) c.ultimo = ahora();
  if (dt === 0) return out;

  const pa = FV.PARAMS[c.modelo];
  const vStall = pa.velPerdida;
  const vCorner = clamp(vStall * Math.sqrt(pa.cargaMax), pa.velCrucero * 0.75, pa.velMax * 0.8);
  const h = c.hab;
  const jr = jugador as Movil & { rumbo?: number };

  const dx = jugador.x - a.x, dy = jugador.y - a.y;
  // Where the two will be in a moment: at merge speeds the break has to start early.
  const dFut = Math.hypot(dx + (jugador.vx - a.vx) * 0.6, dy + (jugador.vy - a.vy) * 0.6);
  const d = Math.hypot(dx, dy) || 1;
  const los = Math.atan2(dy, dx);
  const V = Math.hypot(a.vx, a.vy);
  const hdg = V > 5 ? Math.atan2(a.vy, a.vx) : a.rumbo;
  const pV = Math.hypot(jugador.vx, jugador.vy);
  const pHdg = pV > 5 ? Math.atan2(jugador.vy, jugador.vx) : fin(jr.rumbo ?? 0);
  const pNose = Number.isFinite(jr.rumbo) ? (jr.rumbo as number) : pHdg;
  /** Target off our flight path (0 = dead ahead). */
  const ata = Math.abs(angDif(los - hdg));
  /** Aspect: 0 = we sit right on its six. */
  const aa = Math.abs(angDif(los - pHdg));
  /** Its nose off us (0 = it points straight at us). */
  const pAta = Math.abs(angDif(los + PI - pNose));
  /** It sits behind us (0 = dead astern). */
  const cola = Math.abs(angDif(los - hdg - PI));
  const cierre = -(dx * (jugador.vx - a.vx) + dy * (jugador.vy - a.vy)) / d;
  const alto = a.y - fin(suelo(a.x));
  const pAlto = jugador.y - fin(suelo(jugador.x));
  const radioGiro = (V * V) / (G * Math.max(1.5, pa.cargaMax * 0.7 - 1));

  // Wingman: odd ones in id order fly with the one before.
  let lider: Caza | null = null;
  if (!c.jefa) {
    const par = lista.filter((o) => !o.jefa).sort((p, q) => p.id - q.id);
    const i = par.indexOf(c);
    if (i > 0 && i % 2 === 1) lider = par[i - 1];
  }

  // ── Decide (with a reaction time that shrinks with skill) ──
  c.modoT -= dt;
  c.decT -= dt;
  c.defT += c.modo === 'defensa' || c.modo === 'tijera' ? dt : 0;
  c.fintaT = Math.max(0, c.fintaT - dt);
  const amenaza = vivo ? misilCercano(a, misiles) : null;
  if (amenaza && amenaza.ttg < 0.6 && c.modo !== 'evasion') c.decT = Math.min(c.decT, lerp(0.25, 0.05, h));
  if (c.decT <= 0) {
    c.decT = lerp(0.5, 0.12, h) * (0.75 + 0.5 * Math.random());
    const bajoAtaque = pAta < lerp(0.35, 0.55, h) && d < lerp(250, 400, h) && cola < 1.35;
    const sobrepaso = ata > 1.75 && d < 190;
    // Too close for a real fighter pilot: break off and open the range before coming back.
    const muyCerca = (d < DIST_MIN && cierre > -20) || dFut < DIST_MIN;
    const liderEnganchado = lider && Math.hypot(lider.a.x - jugador.x, lider.a.y - jugador.y) < 460 && ['ataque', 'reversa', 'yoyo'].includes(lider.modo);
    if (!vivo) poner(c, 'retirada', 1);
    else if (amenaza && amenaza.ttg < lerp(0.9, 1.8, h)) poner(c, 'evasion', 0.7);
    else if (c.modo === 'evasion' && c.modoT > 0) {
      /* finish the evasion */
    } else if (bajoAtaque) {
      if ((c.modo === 'defensa' || c.modo === 'tijera') && c.defT > lerp(2.4, 1.1, h) && d < 230 && h > 0.3) {
        if (c.modo !== 'tijera') poner(c, 'tijera', 4);
      } else if (c.modo !== 'defensa' && c.modo !== 'tijera') poner(c, 'defensa', 2);
    } else if ((c.modo === 'extension' || c.modo === 'yoyo' || c.modo === 'reversa') && c.modoT > 0) {
      // A finished extension ends early once there's room to turn back in.
      if (c.modo === 'extension' && d > lerp(320, 420, h) && c.modoT < 1.2) poner(c, 'ataque', 0);
      // Margarita's feint: a short extension that turns into a hard reversal.
      else if (c.modo === 'extension' && c.jefa && c.modoT < 0.05) poner(c, 'reversa', 1);
    } else if (muyCerca && c.modo !== 'extension') {
      poner(c, c.jefa && Math.random() < 0.4 ? 'reversa' : 'extension', lerp(1.8, 1.2, h));
    } else if (sobrepaso) {
      if (c.jefa) poner(c, Math.random() < 0.45 ? 'extension' : 'reversa', Math.random() < 0.45 ? 0.8 : 1.1);
      else if (h > 0.6 && V > vCorner * 0.9 && Math.random() < h - 0.3) poner(c, 'reversa', 1.1);
      else poner(c, 'extension', lerp(2.6, 1.6, h));
    } else if ((c.jefa || h > 0.5) && c.modo === 'ataque' && cierre > 80 && d < 250 && ata > 0.45 && ata < 1.5 && alto > 120 && a.y < techo - 200) {
      poner(c, 'yoyo', c.jefa ? 0.6 : 0.75);
    } else if (lider && liderEnganchado && pAta > 0.6 && d > 160 && c.modo !== 'ataque') {
      // Bracket until in position (or the plane commits on the leader: then pounce).
      const enLider = Math.abs(angDif(Math.atan2(lider.a.y - jugador.y, lider.a.x - jugador.x) - pNose)) < 0.6;
      poner(c, enLider ? 'ataque' : 'bracket', enLider ? 0 : c.modo === 'bracket' ? c.modoT : 3);
      if (c.modo === 'bracket' && c.modoT <= 0) poner(c, 'ataque', 0);
    } else if (lider && !liderEnganchado && d > 480) poner(c, 'formacion', 1);
    else poner(c, 'ataque', 0);
  }

  // ── Where to fly ──
  let th = hdg;
  let gas = 0.6;
  const sx = Math.cos(hdg) >= 0 ? 1 : -1;
  switch (c.modo) {
    case 'retirada':
      th = Math.atan2(0.12, sx);
      gas = 0.5;
      break;
    case 'evasion': {
      const m = amenaza;
      if (!m) {
        th = hdg;
        gas = 1;
        break;
      }
      if (m.ttg < 0.45) {
        // Last-ditch: pull as hard as possible across the missile's path.
        const lado = Math.sin(m.ang - hdg) >= 0 ? -1 : 1;
        th = hdg + (alto < 160 ? (Math.cos(hdg) >= 0 ? 1 : -1) : lado) * 2;
      } else {
        // Beam it: fly perpendicular to its line of sight (fastest LOS rate).
        const p1 = m.ang + PI / 2, p2 = m.ang - PI / 2;
        const pick = (q: number) => Math.abs(angDif(q - hdg)) + (Math.sin(q) < 0 && alto < 200 ? 3 : 0);
        th = pick(p1) < pick(p2) ? p1 : p2;
      }
      gas = 1;
      break;
    }
    case 'defensa': {
      // Break into the attacker (towards the side of our path it sits on).
      let lado = Math.sin(los - hdg) >= 0 ? 1 : -1;
      if (c.fintaT > 0) lado = -lado;
      const arriba = Math.cos(hdg) >= 0 ? 1 : -1;
      if (lado !== arriba && alto < 220 + radioGiro) lado = arriba; // no breaking down into the hills
      th = hdg + lado * 1.5;
      // Jinks against its guns when it's tracking us.
      if (pAta < 0.25 && d < 300 && h > 0.25) {
        c.jinkT -= dt;
        if (c.jinkT <= 0) {
          c.lado = c.lado === 1 ? -1 : 1;
          c.jinkT = lerp(0.75, 0.4, h) * (0.8 + 0.4 * Math.random());
        }
        th += c.lado * lerp(0.2, 0.5, h);
      }
      gas = 1;
      // Guns defence: brakes to make a close pursuer fly past (the better pilots).
      if ((c.jefa || h > 0.7) && d < 130 && cierre > 50 && V > vStall * 2) gas = -1;
      break;
    }
    case 'tijera': {
      c.jinkT -= dt;
      if (c.jinkT <= 0) {
        c.lado = c.lado === 1 ? -1 : 1;
        c.jinkT = lerp(1.3, 0.85, h);
      }
      th = hdg + c.lado * 1.6;
      gas = V > vStall * 2.1 ? -0.7 : 0.8;
      if (cola > 1.8 || d > 300) poner(c, 'ataque', 0);
      break;
    }
    case 'extension': {
      // Run away fast; zoom up with speed to spare, unload to gain it otherwise.
      th = V > vCorner * 1.05 && alto > 150 && a.y < techo - 260 ? Math.atan2(0.55, sx * 0.84) : Math.atan2(alto > 160 ? -0.12 : 0.1, sx);
      gas = 1;
      break;
    }
    case 'yoyo': {
      // High yo-yo: up out of the fight to kill closure, then down behind.
      th = hdg + clamp(angDif(PI / 2 - hdg), -0.9, 0.9);
      gas = 0.5;
      if (c.modoT <= 0) poner(c, 'ataque', 0);
      break;
    }
    case 'reversa': {
      th = los;
      // Margarita's vectored jet pulls round at corner speed, idling to tighten.
      gas = c.jefa ? (V > vCorner * 1.1 ? -0.8 : 1) : V > vCorner * 1.2 ? -0.2 : 0.8;
      if (c.modoT <= 0 || ata < 0.35) poner(c, 'ataque', 0);
      break;
    }
    case 'bracket': {
      if (!lider) {
        poner(c, 'ataque', 0);
        break;
      }
      const nx = -Math.sin(pHdg), ny = Math.cos(pHdg);
      const sl = (lider.a.x - jugador.x) * nx + (lider.a.y - jugador.y) * ny >= 0 ? 1 : -1;
      let tx = jugador.x - nx * sl * 170 - jugador.vx * 0.25;
      let ty = jugador.y - ny * sl * 170 - jugador.vy * 0.25;
      ty = clamp(ty, fin(suelo(tx)) + 120, techo - 120);
      th = Math.atan2(ty - a.y, tx - a.x);
      gas = 1;
      if (Math.hypot(tx - a.x, ty - a.y) < 80) poner(c, 'ataque', 0);
      break;
    }
    case 'formacion': {
      if (!lider) {
        poner(c, 'ataque', 0);
        break;
      }
      const la = lider.a;
      const lh = Math.atan2(la.vy, la.vx);
      const tx = la.x - Math.cos(lh) * 50 - Math.sin(lh) * 26 * c.lado;
      const ty = la.y - Math.sin(lh) * 50 + Math.cos(lh) * 26 * c.lado;
      const dd = Math.hypot(tx - a.x, ty - a.y);
      th = dd > 30 ? Math.atan2(ty - a.y + la.vy * 0.4, tx - a.x + la.vx * 0.4) : lh;
      gas = clamp((dd - 20) / 60, -0.4, 1);
      break;
    }
    default: {
      // Attack: lead / pure / lag by geometry and energy.
      const sol = d < 420 ? solucion(a, jugador) : null;
      if (V < vCorner * 0.7 || (cierre > 90 && d < 300)) {
        const k = lerp(0.25, 0.4, h);
        th = Math.atan2(jugador.y - jugador.vy * k - a.y, jugador.x - jugador.vx * k - a.x);
        c.pers = 'lag';
      } else if (sol && d < 320 && cierre < 160) {
        th = sol.ang;
        c.pers = 'lead';
      } else {
        // Pure pursuit with an intercept bias; approach from above (boom and zoom).
        const tl = clamp(d / Math.max(80, V + cierre), 0, 1.4) * 0.5;
        let ty = jugador.y + jugador.vy * tl;
        if (d > 280 && !c.jefa) ty += clamp((d - 250) * 0.45, 0, 150);
        ty = Math.min(ty, techo - 80);
        th = Math.atan2(ty - a.y, jugador.x + jugador.vx * tl - a.x);
        c.pers = 'pure';
      }
      // Throttle for a closure rate that fits the range: fast from afar, a
      // slow overtake in gun range (the better pilots manage it tighter).
      // They hold a stand-off range and shoot from there instead of ramming in.
      const cierreObj = clamp((d - DIST_TIRO) * 0.7, -70, 260);
      gas = clamp((cierreObj - cierre) / lerp(110, 60, h), -1, 1);
      if (V < vCorner * 0.85) gas = 1;
    }
  }

  // Energy: never sit slow in a turn; unload (nose a bit low) to get speed back.
  if (V < vStall * 1.45 && c.modo !== 'evasion') {
    th = Math.atan2(alto > 140 ? -0.35 : 0.05, sx);
    gas = 1;
  }

  // Never fly into the player: inside the hard limit, steer away across the line of sight.
  if (vivo && (d < DIST_DURA || dFut < DIST_DURA)) {
    const lado = angDif(Math.atan2(dy, dx) - hdg) > 0 ? -1 : 1;
    th = Math.atan2(dy, dx) + lado * 1.9;
    gas = Math.max(gas, 0.6);
  }

  // ── Turn the commanded direction at a limited rate (no snaps) ──
  let diff = angDif(th - c.dir);
  if (Math.abs(diff) > 2.6) {
    if (c.sentido === 0) {
      // A reversal: over the top unless the ceiling is close or we're slow and high enough to go under.
      const arriba = Math.cos(c.dir) >= 0 ? 1 : -1;
      const cabeArriba = a.y + 2 * radioGiro < techo - 60 && V > vCorner * 0.7;
      const cabeAbajo = alto > 2.3 * radioGiro + 90;
      c.sentido = cabeArriba || !cabeAbajo ? arriba : -arriba;
    }
    if (Math.sign(diff) !== c.sentido) diff -= 2 * PI * Math.sign(diff);
  } else if (Math.abs(diff) < 1) c.sentido = 0;
  const tasa = c.jefa ? 6.5 : lerp(2.6, 5, h);
  c.dir += clamp(diff, -tasa * dt, tasa * dt);
  const adelante = angDif(c.dir - hdg);
  if (Math.abs(adelante) > 1.35) c.dir = hdg + Math.sign(adelante) * 1.35;
  c.dir = angDif(c.dir);

  let mx = Math.cos(c.dir), my = Math.sin(c.dir);
  // Deconfliction: keep clear of the other fighters.
  for (const o of lista) {
    if (o === c) continue;
    const ox = a.x - o.a.x, oy = a.y - o.a.y;
    const od = Math.hypot(ox, oy);
    if (od > 1 && od < 55) {
      mx += (ox / od) * ((55 - od) / 55) * 0.9;
      my += (oy / od) * ((55 - od) / 55) * 0.9;
    }
  }
  // Terrain look-ahead along the flight path and over the hills in front.
  let claro = alto;
  for (const tau of [0.3, 0.6, 1, 1.5, 2]) claro = Math.min(claro, a.y + a.vy * tau - fin(suelo(a.x + a.vx * tau)));
  let colina = -Infinity;
  for (let s = 30; s <= 210; s += 30) colina = Math.max(colina, fin(suelo(a.x + sx * s)));
  const necesita = 45 + radioGiro * Math.max(0, -Math.sin(hdg)) * 0.9;
  if (claro < necesita || alto < 55 || a.y < colina + 55) {
    const k = clamp(1 - Math.min(claro, a.y - colina) / necesita, 0.3, 1);
    const ang = 0.3 + 0.65 * k;
    mx = sx * Math.cos(ang);
    my = Math.sin(ang);
    c.dir = Math.atan2(my, mx);
    gas = 1;
  } else {
    // Dive no steeper than the height allows.
    const n = Math.hypot(mx, my) || 1;
    const lim = clamp((alto - 50) / 230, 0.15, 1);
    if (-my / n > lim) {
      my = -lim * n;
      mx = (mx >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, n * n - my * my));
    }
  }
  // Ceiling: level off before it.
  if (a.y > techo - 170 && my > 0) my *= clamp((techo - 50 - a.y) / 120, -0.6, 1);

  // Mice fly a little under full power; the better ones use it all.
  if (!c.jefa) gas = gas > 0 ? gas * lerp(0.82, 1, h) : gas;
  FV.pasoAvion(a, c.modelo, { x: mx, y: my, gas }, dt, suelo, techo);

  if (!vivo) {
    c.rafaga = 0;
    c.aviso = 0;
    c.avisoMisil = 0;
    return out;
  }

  // ── Guns: a tell, then a short burst only with the nose on the lead point ──
  c.gunCd -= dt;
  const alcance = c.jefa ? 320 : lerp(240, 300, h);
  const tol = c.jefa ? 0.05 : lerp(0.1, 0.055, h);
  const sol = d < alcance ? solucion(a, jugador) : null;
  const err = sol ? Math.abs(angDif(sol.ang - a.rumbo)) : 9;
  if (c.rafaga > 0) {
    c.rafT -= dt;
    // A pilot lets go of the trigger when the nose slides off.
    if (err > tol * 3.5) c.rafaga = 0;
    else if (c.rafT <= 0) {
      c.rafaga--;
      c.rafT = 0.07;
      c.fogonazo = 0.05;
      const disp = c.jefa ? 0.035 : lerp(0.07, 0.04, h);
      const ang = a.rumbo + (Math.random() - 0.5) * disp * 2;
      out.disparos.push({ x: a.x + Math.cos(a.rumbo) * 9, y: a.y + Math.sin(a.rumbo) * 9, vx: a.vx + Math.cos(ang) * VEL_BALA, vy: a.vy + Math.sin(ang) * VEL_BALA });
    }
  } else if (c.aviso > 0) {
    c.aviso -= dt;
    if (c.aviso <= 0) {
      c.aviso = 0;
      if (c.gunCd < 1 && sol && err < tol * 1.6 && lineaLibre(a.x, a.y, jugador.x, jugador.y, suelo)) {
        c.rafaga = c.jefa ? 7 : Math.round(lerp(4, 6, h));
        c.rafT = 0;
        c.gunCd = (c.jefa ? 0.7 : c.agresivo ? 0.9 : lerp(2.2, 1.2, h)) + Math.random() * (c.jefa ? 0.5 : 0.7);
      } else c.gunCd = 0.25;
    }
  } else if (c.gunCd <= 0 && sol && err < tol * 2 && sol.t < 0.95 && lineaLibre(a.x, a.y, jugador.x, jugador.y, suelo)) {
    c.aviso = c.jefa ? 0.16 : lerp(0.32, 0.2, h);
  }

  // ── Missiles: rear hemisphere only, after a red lock blink ──
  c.misilCd -= dt;
  if (c.avisoMisil > 0) {
    c.avisoMisil -= dt;
    if (c.avisoMisil <= 0) {
      c.avisoMisil = 0;
      if (c.misilCd < 1 && aa < 1.15 && d > 150 && d < 560) {
        out.misil = true;
        c.misilCd = c.jefa ? 4.5 + Math.random() * 2 : clamp(11 - fin(oleada, 3) * 0.3, 6, 11) - h * 1.5 + Math.random() * 3;
      } else c.misilCd = 1.2;
    }
  } else if (c.misilCd <= 0 && aa < (c.jefa ? 0.95 : 0.7) && ata < 0.4 && d > 200 && d < 500 && lineaLibre(a.x, a.y, jugador.x, jugador.y, suelo)) {
    // Margarita waits for a shot the plane can't easily dodge: slow, low, or
    // looking the other way (or right after it broke from her guns).
    const buena = !c.jefa || pV < 150 || pAlto < 240 || pAta > 2.2 || c.modo === 'reversa';
    if (buena) c.avisoMisil = c.jefa ? 0.35 : 0.5;
  }
  return out;
}

/** True if (x, y) with margin m touches the fighter. */
export function tocado(c: Caza, x: number, y: number, m = 2): boolean {
  return Math.hypot(c.a.x - x, c.a.y - y) < RADIO + m;
}

/* ── Drawing ────────────────────────────────────────────────────────────── */

const PILOTOS: ModeloBase[] = ['avioneta', 'caza', 'bombardero'];
const OW = 88, OH = 72, OX = OW / 2, OY = OH / 2;
let lienzo: HTMLCanvasElement | null = null;
function trabajo(): CanvasRenderingContext2D {
  if (!lienzo) {
    lienzo = document.createElement('canvas');
    lienzo.width = OW;
    lienzo.height = OH;
  }
  return lienzo.getContext('2d', { willReadFrequently: true })!;
}

/** Roll for each of the 7 frames of giro.ts (alabeo = cos φ). */
const ALABEO_FRAME = [0, 1, 2, 3, 4, 5, 6].map((f) => Math.cos((f * PI) / 6));

/** Head pixels: `fuera` stick out of the airframe (cleared), `dentro` sit in the canopy (glass). */
type Mascara = { fuera: Int32Array; dentro: Int32Array; cx: number; cy: number };
const mascaras = new Map<string, Mascara>();
/**
 * Pixels of the player's pilot head baked into the sprite for frame f: the
 * plane is drawn with each pilot and every pixel that changes is the head
 * (grown by 1 px). The enemy paints its own canopy and pilot over them.
 */
function mascara(m: ModeloAvion, f: number): Mascara {
  const key = `${m}|${f}`;
  let mk = mascaras.get(key);
  if (mk) return mk;
  const g = trabajo();
  const antes = A.pilotoActual();
  const capas: Uint8ClampedArray[] = [];
  for (const pl of PILOTOS) {
    A.fijarPiloto(pl);
    g.clearRect(0, 0, OW, OH);
    drawPlaneGiro(g, m, OX, OY, 0, ALABEO_FRAME[f], 1, 0, 0, false, []);
    capas.push(g.getImageData(0, 0, OW, OH).data);
  }
  A.fijarPiloto(antes);
  const dif = new Uint8Array(OW * OH);
  for (let i = 0; i < OW * OH; i++) {
    const o = i * 4;
    for (let k = 1; k < capas.length; k++) {
      const p = capas[0], q = capas[k];
      if (p[o] !== q[o] || p[o + 1] !== q[o + 1] || p[o + 2] !== q[o + 2] || p[o + 3] !== q[o + 3]) dif[i] = 1;
    }
  }
  const fuera: number[] = [], dentro: number[] = [];
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < OH; y++)
    for (let x = 0; x < OW; x++) {
      const i = y * OW + x;
      if (!dif[i]) continue;
      sx += x;
      sy += y;
      n++;
      // Transparent with some pilot: outside the airframe.
      if (capas.some((c) => c[i * 4 + 3] === 0)) fuera.push(i);
      else dentro.push(i);
    }
  mk = { fuera: Int32Array.from(fuera), dentro: Int32Array.from(dentro), cx: n ? Math.round(sx / n) : OX + 6, cy: n ? Math.round(sy / n) : OY - 4 };
  mascaras.set(key, mk);
  return mk;
}

type Paleta = { osc: number[]; med: number[]; luz: number[]; vidrio: number[] };
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Margarita: bright red. Mice: lilac. */
const ROJA: Paleta = { osc: hex('#4a0812'), med: hex('#f42a34'), luz: hex('#ffc8b8'), vidrio: hex('#6a2a3e') };
const LILA: Paleta = { osc: hex('#24164e'), med: hex('#7a5ad0'), luz: hex('#e0d4ff'), vidrio: hex('#3e3a72') };

/** Palette swap by luminance (pure white glints stay); the player's head goes, glass in its place. */
function recolorear(d: Uint8ClampedArray, pal: Paleta, mk: Mascara, blanco: boolean) {
  for (let o = 0; o < d.length; o += 4) {
    if (d[o + 3] === 0) continue;
    const r = d[o], g = d[o + 1], b = d[o + 2];
    if (blanco) {
      d[o] = d[o + 1] = d[o + 2] = 255;
      continue;
    }
    if (Math.min(r, g, b) > 245) continue;
    let L = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    L = clamp((L - 0.08) / 0.8, 0, 1);
    const [p, q, k] = L < 0.5 ? [pal.osc, pal.med, L / 0.5] : [pal.med, pal.luz, (L - 0.5) / 0.5];
    d[o] = p[0] + (q[0] - p[0]) * k;
    d[o + 1] = p[1] + (q[1] - p[1]) * k;
    d[o + 2] = p[2] + (q[2] - p[2]) * k;
  }
  for (const i of mk.fuera) d[i * 4 + 3] = 0;
  for (const i of mk.dentro) {
    const o = i * 4;
    d[o] = pal.vidrio[0];
    d[o + 1] = pal.vidrio[1];
    d[o + 2] = pal.vidrio[2];
    d[o + 3] = 255;
  }
}

/** Margarita in the cockpit: red beanie, grey curls, a scowl. (0, 0) is the head's middle. */
function cabezaMargarita(g: Ctx, arriba: boolean) {
  if (arriba) {
    // Seen from above: grey curls round a beanie with a white bobble.
    A.R(g, -3, -3, 5, 7, '#2a1a24');
    A.R(g, -3, -2, 5, 5, '#d8d0ca');
    A.R(g, -2, -2, 3, 4, '#c02a3a');
    A.R(g, -1, -1, 1, 2, '#ffffff');
    A.R(g, 2, -1, 1, 2, '#f0c8a8');
    return;
  }
  A.R(g, -3, -4, 6, 2, '#e03a3a');
  A.R(g, -1, -5, 2, 1, '#ff6a5a');
  A.R(g, -3, -2, 1, 3, '#d8d0ca');
  A.R(g, -2, -2, 4, 3, '#f0c8a8');
  A.R(g, 1, -1, 1, 1, '#2a2030');
  A.R(g, 0, 0, 2, 1, '#8a3a3a');
  A.R(g, -1, 1, 3, 1, '#d8d0ca');
}

/** A mouse pilot with a red helmet. (0, 0) is the head's middle. */
function cabezaRaton(g: Ctx, arriba: boolean) {
  if (arriba) {
    A.R(g, -2, -4, 2, 2, '#c9b4ff');
    A.R(g, -2, 2, 2, 2, '#c9b4ff');
    A.R(g, -2, -2, 4, 4, '#e04a5a');
    A.R(g, 2, -1, 1, 2, '#ffb0c8');
    return;
  }
  A.R(g, -3, -5, 2, 2, '#c9b4ff');
  A.R(g, 0, -5, 2, 2, '#c9b4ff');
  A.R(g, -2, -3, 4, 2, '#e04a5a');
  A.R(g, -2, -1, 4, 3, '#b8a8d8');
  A.R(g, 1, -1, 1, 1, '#2a2030');
  A.R(g, 2, 0, 1, 1, '#ffb0c8');
}

/** Draws the fighter at screen (x, y): rolled through the giro frames, re-tinted, with its own pilot. */
export function dibujar(g: Ctx, c: Caza, x: number, y: number, t: number): void {
  const a = c.a;
  const f = framePara(a.alabeo, a.carga);
  const mk = mascara(c.modelo, f);
  const w = trabajo();
  w.clearRect(0, 0, OW, OH);
  drawPlaneGiro(w, c.modelo, OX, OY, 0, a.alabeo, a.carga, t, a.gas, false, []);
  const img = w.getImageData(0, 0, OW, OH);
  recolorear(img.data, c.jefa ? ROJA : LILA, mk, c.flash > 0);
  w.putImageData(img, 0, 0);
  if (c.flash <= 0) {
    w.save();
    w.translate(mk.cx, mk.cy);
    if (f > 3) w.scale(1, -1);
    (c.jefa ? cabezaMargarita : cabezaRaton)(w, f >= 2 && f <= 4);
    w.restore();
  }
  const L = A.LOOKS[c.modelo];
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(-a.rumbo / 0.02) * 0.02);
  g.drawImage(w.canvas, -OX, -OY);
  // Afterburner flicker over the (re-tinted) jet flame.
  if (L.jet) {
    const len = 2 + Math.round(fin(a.gas) * 4) + (Math.floor(t * 30) % 2) * 2;
    const jy = Math.round(L.jet[1] * a.alabeo);
    A.R(g, L.jet[0] - len + 1, jy, len, 1, '#ff9a3c');
    A.R(g, L.jet[0] - 1, jy, 2, 1, P.gold);
  }
  const nx = Math.round(L.w / 2) + 1;
  // Gun tell: the nose light blinks before a burst.
  if (c.aviso > 0 && Math.floor(t * 24) % 2 === 0) {
    A.R(g, nx - 2, -1, 3, 3, '#fff2a8');
    A.R(g, nx - 1, -2, 1, 5, P.white);
  }
  // Missile lock: a red blink under the wing.
  if (c.avisoMisil > 0 && Math.floor(t * 16) % 2 === 0) {
    const s = a.alabeo >= 0 ? 1 : -1;
    A.R(g, -3, 3 * s, 4, 2, '#ff2a3a');
    A.R(g, -2, 3 * s, 2, 1, P.white);
  }
  // Machine-gun muzzle flash at the nose.
  if (c.fogonazo > 0) {
    A.R(g, nx, -1, 4, 3, P.gold);
    A.R(g, nx + 1, -2, 2, 5, '#fff2a8');
    A.R(g, nx + 4, 0, 2, 1, P.white);
  }
  g.restore();
  // Health pips once damaged (the boss has her bar on the HUD).
  if (c.hp < c.hpMax && !c.jefa) {
    const bw = 12;
    A.R(g, Math.round(x - bw / 2), Math.round(y - 12), bw, 2, '#3a2a6a');
    A.R(g, Math.round(x - bw / 2), Math.round(y - 12), Math.max(1, Math.round((bw * c.hp) / c.hpMax)), 2, '#ff4a5a');
  }
}

/** A fighter as a lock/aim target. */
export function pos(c: Caza): Movil {
  return c.a;
}
