/**
 * Enemy fighters: mice flying real planes (the same flight physics as the
 * player's, a little slower). From wave 3 on they come after the plane:
 * they chase it from behind with some lead, fire short bursts when the nose
 * is on it, now and then launch a seeker missile, break away when too close
 * and pull up near the ground.
 */
import * as FV from './fisica-vuelo';
import * as A from './dibujo';
import { P } from '../game/dulce';
import type { Avion, Movil } from './fisica-tipos';

type Ctx = CanvasRenderingContext2D;
type Suelo = (x: number) => number;

export type Caza = {
  id: number;
  a: Avion;
  hp: number;
  hpMax: number;
  /** Seconds to the next burst, shots left in it, and gap between shots. */
  gunCd: number;
  rafaga: number;
  rafT: number;
  misilCd: number;
  flash: number;
  /** Breaking away after a pass: until this runs out it flies off, then turns back. */
  escape: number;
  escDir: number;
  /** Muzzle flash left, s. */
  fogonazo: number;
  /** Storm aces: fragile but they dogfight hard (break turns, quicker bursts). */
  agresivo: boolean;
  quiebre: number;
  /** Margarita herself at the stick: the boss duel over Valparaíso. */
  jefa?: boolean;
};

export type Disparo = { x: number; y: number; vx: number; vy: number };
export type Orden = { disparos: Disparo[]; misil: boolean };

const VEL_BALA = 330;
export const PUNTOS = 350;
export const RADIO = 8;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const angDif = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

let ids = 0;

/** How many fighters a wave brings (none before wave 3). */
export function cuantos(oleada: number): number {
  return oleada < 3 ? 0 : Math.min(4, 1 + Math.floor((oleada - 3) / 2));
}

export function crear(x: number, y: number, haciaDerecha: boolean, oleada: number, agresivo = false, jefa = false): Caza {
  const a = FV.nuevoAvion(jefa ? 'sukhoi' : 'caza', x, y, haciaDerecha);
  if (jefa) {
    const hp = 14 + Math.min(10, Math.max(0, oleada - 3) * 0.8);
    return { id: ++ids, a, hp, hpMax: hp, gunCd: 1.2, rafaga: 0, rafT: 0, misilCd: 4, flash: 0, escape: 0, escDir: 1, fogonazo: 0, agresivo: true, quiebre: 0, jefa: true };
  }
  const hp = agresivo ? 1.2 : 2 + Math.min(1.5, (oleada - 3) * 0.15);
  return { id: ++ids, a, hp, hpMax: hp, gunCd: agresivo ? 1 : 2, rafaga: 0, rafT: 0, misilCd: 6 + Math.random() * 4, flash: 0, escape: 0, escDir: 1, fogonazo: 0, agresivo, quiebre: 0 };
}

/** One step of a fighter's brain and flight. */
export function paso(c: Caza, jugador: Movil, vivo: boolean, dt: number, suelo: Suelo, techo: number, oleada: number): Orden {
  const out: Orden = { disparos: [], misil: false };
  const a = c.a;
  c.flash = Math.max(0, c.flash - dt);
  c.fogonazo = Math.max(0, c.fogonazo - dt);
  const dx = jugador.x - a.x, dy = jugador.y - a.y;
  const d = Math.hypot(dx, dy);

  // Where to point: the plane with some lead, or away after a close pass.
  let tx = jugador.x + jugador.vx * clamp(d / 300, 0.2, 1);
  let ty = jugador.y + jugador.vy * clamp(d / 300, 0.2, 1);
  if (c.escape > 0) {
    c.escape -= dt;
    tx = a.x + c.escDir * 300;
    ty = a.y + 80;
  } else if (d < 70) {
    c.escape = 1.4;
    c.escDir = Math.cos(a.rumbo) >= 0 ? 1 : -1;
  }
  // An ace with the player on its tail breaks hard to the side to shake it off.
  if (c.agresivo && vivo && c.escape <= 0) {
    const behind = -(dx * Math.cos(a.rumbo) + dy * Math.sin(a.rumbo)) / (d || 1);
    if (c.quiebre <= 0 && behind > 0.75 && d < 230) c.quiebre = 0.9 + Math.random() * 0.5;
    if (c.quiebre > 0) {
      c.quiebre -= dt;
      const side = c.id % 2 ? 1 : -1;
      tx = a.x - Math.sin(a.rumbo) * 300 * side;
      ty = a.y + Math.cos(a.rumbo) * 300 * side;
    }
  }
  if (!vivo) {
    tx = a.x + (Math.cos(a.rumbo) >= 0 ? 400 : -400);
    ty = a.y + 60;
  }
  let mx = tx - a.x, my = ty - a.y;
  // Never into the ground.
  const alto = a.y - suelo(a.x);
  if (alto < 80) my = Math.max(my, 160 - alto);
  const n = Math.hypot(mx, my) || 1;
  mx /= n;
  my /= n;
  const gas = d > 260 ? 1 : d < 120 ? -0.3 : 0.4;
  // Margarita flies a supermaneuverable jet at full stick; the mice fly slower.
  if (c.jefa) FV.pasoAvion(a, 'sukhoi', { x: mx, y: my, gas: d > 160 ? 1 : 0.3 }, dt, suelo, techo);
  else FV.pasoAvion(a, 'caza', { x: mx, y: my, gas: gas * 0.85 }, dt, suelo, techo);

  if (!vivo) return out;
  // Guns: a short burst when the nose is on the plane.
  const mira = Math.abs(angDif(Math.atan2(dy, dx) - a.rumbo));
  c.gunCd -= dt;
  if (c.rafaga > 0) {
    c.rafT -= dt;
    if (c.rafT <= 0) {
      c.rafaga--;
      c.rafT = 0.07;
      c.fogonazo = 0.05;
      const ang = a.rumbo + (Math.random() - 0.5) * 0.08;
      out.disparos.push({ x: a.x + Math.cos(a.rumbo) * 9, y: a.y + Math.sin(a.rumbo) * 9, vx: a.vx + Math.cos(ang) * VEL_BALA, vy: a.vy + Math.sin(ang) * VEL_BALA });
    }
  } else if (c.gunCd <= 0 && d < 280 && mira < 0.14) {
    c.rafaga = c.jefa ? 9 : 6;
    c.rafT = 0;
    c.gunCd = (c.jefa ? 0.8 : c.agresivo ? 1.1 : clamp(2.6 - oleada * 0.08, 1.3, 2.6)) + Math.random() * 0.8;
  }
  // Now and then a seeker missile from further out.
  c.misilCd -= dt;
  if (c.misilCd <= 0 && d > 180 && d < 480 && mira < 0.5) {
    out.misil = true;
    c.misilCd = c.jefa ? 5 + Math.random() * 2 : clamp(11 - oleada * 0.3, 6, 11) + Math.random() * 3;
  }
  return out;
}

/** True if (x, y) with margin m touches the fighter. */
export function tocado(c: Caza, x: number, y: number, m = 2): boolean {
  return Math.hypot(c.a.x - x, c.a.y - y) < RADIO + m;
}

const tintes = new Map<string, HTMLCanvasElement>();
/** The caza sprite tinted mouse-lilac (Margarita's Sukhoi: red), cached. */
function sprite(hit: boolean, jefa = false): HTMLCanvasElement {
  const key = (hit ? 'hit' : 'base') + (jefa ? '|jefa' : '');
  let t = tintes.get(key);
  if (!t) {
    const src = A.planeSprite(jefa ? 'sukhoi' : 'caza');
    t = document.createElement('canvas');
    t.width = src.width;
    t.height = src.height;
    const g = t.getContext('2d')!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = hit ? 0.85 : 0.55;
    g.fillStyle = hit ? '#ffffff' : jefa ? '#d02a3a' : '#7a5ad0';
    g.fillRect(0, 0, t.width, t.height);
    tintes.set(key, t);
  }
  return t;
}

/** Draws the fighter at screen (x, y); nose along -rumbo in screen space. */
export function dibujar(g: Ctx, c: Caza, x: number, y: number, t: number): void {
  const a = c.a;
  const img = sprite(c.flash > 0, c.jefa);
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.rotate(Math.round(-a.rumbo / 0.05) * 0.05);
  g.scale(1, a.alabeo >= 0 ? 1 : -1);
  g.drawImage(img, -Math.round(img.width / 2), -Math.round(img.height / 2));
  if (c.jefa) {
    // Margarita in the cockpit: grey curls under her red beanie, and a scowl.
    A.R(g, 1, -9, 6, 3, '#e03a3a');
    A.R(g, 3, -10, 2, 1, '#ff6a5a');
    A.R(g, 0, -6, 2, 2, '#d8d0ca');
    A.R(g, 6, -6, 2, 2, '#d8d0ca');
    A.R(g, 2, -6, 4, 3, '#f0c8a8');
    A.R(g, 4, -6, 1, 1, '#2a2030');
    A.R(g, 3, -4, 2, 1, '#8a3a3a');
  } else {
    // Mouse ears over the canopy.
    A.R(g, 1, -6, 2, 2, '#c9b4ff');
    A.R(g, 4, -6, 2, 2, '#c9b4ff');
  }
  // An afterburner flicker.
  const len = 2 + (Math.floor(t * 30) % 2) * 2;
  A.R(g, -Math.round(img.width / 2) - len + 2, 0, len, 1, '#ff9a3c');
  // Machine-gun muzzle flash at the nose.
  if (c.fogonazo > 0) {
    const nx = Math.round(img.width / 2) + 1;
    A.R(g, nx, -1, 4, 3, P.gold);
    A.R(g, nx + 1, -2, 2, 5, '#fff2a8');
    A.R(g, nx + 4, 0, 2, 1, P.white);
  }
  g.restore();
  // Health pips once damaged (the boss has her bar on the HUD).
  if (c.hp < c.hpMax && !c.jefa) {
    const w = 12;
    A.R(g, Math.round(x - w / 2), Math.round(y - 12), w, 2, '#3a2a6a');
    A.R(g, Math.round(x - w / 2), Math.round(y - 12), Math.max(1, Math.round((w * c.hp) / c.hpMax)), 2, '#ff4a5a');
  }
}

/** A fighter as a lock/aim target. */
export function pos(c: Caza): Movil {
  return c.a;
}
