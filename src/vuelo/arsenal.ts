import * as D from '../game/dulce';
import { P } from '../game/dulce';
import * as AB from './audio-batalla';
import { R } from './dibujo';
import { GRAVEDAD } from './fisica-armas';
import type { Bomba, BombaNueva, BombaTipo } from './fisica-tipos';

/*
 * The second batch of bomb loads, in flight and on arrival:
 *
 *   napalm      tumbles down and carpets the ground (or the sea) with fire
 *   pista       chute, then a rocket straight down: goes off under the ground
 *               and leaves a deep crater the mice get stuck in
 *   humo        a grey wall: enemy missiles crossing it lose their target,
 *               batteries inside can't see to shoot
 *   mina        floats on the sea or waits on the ground; goes off when
 *               something drives or sails close
 *   planeadora  pops wings, glides far, then dives onto a target ahead
 *   pinata      bursts in the air: candies that pop where they land, confetti
 *   dardos      opens high and rains steel darts
 *   sismica     buries itself and shakes everything rolling nearby
 *
 * The game hands in what it knows through `Api` (motor.ts builds it once).
 * State lives in fixed pools reused all game long: nothing is allocated per
 * frame. World coordinates: y = altitude, up.
 */

type Ctx = CanvasRenderingContext2D;
type Pos = { x: number; y: number };

/** What arsenal.ts needs from a vehicle. */
export type Coche = { x: number; y: number; vx: number; hp: number; fireT: number; kind: string; mid: Pos };

export type Api = {
  blast(x: number, y: number, energia: number, dano: number): void;
  ground(x: number): number;
  sobreMar(x: number): boolean;
  nivelMar: number;
  coches(): readonly Coche[];
  /** Box of a vehicle (width and height). */
  caja(c: Coche): { w: number; h: number };
  hurtCar(c: Coche, dano: number): void;
  empujar(c: Coche, vx: number, vy: number): void;
  crater(x: number, y: number, r: number): void;
  puff(x: number, y: number, r: number, dark: boolean, life?: number, vx?: number, vy?: number): void;
  chapoteo(x: number, fuerza: number): void;
  luz(x: number, y: number, r: number, c: string, t: number): void;
  pop(x: number, y: number, text: string, c?: string): void;
  sacudir(n: number): void;
  later(fn: () => void, ms: number): void;
  /** Blinds the enemy missiles inside the box (the smoke screen); returns how many lost their target. */
  cegar(x0: number, x1: number, y0: number, y1: number): number;
  pan(x: number): number;
  /** The title screen's autopilot: no sounds, no messages. */
  mudo(): boolean;
};

const NUEVAS = new Set<BombaTipo>(['napalm', 'pista', 'humo', 'mina', 'planeadora', 'pinata', 'dardos', 'sismica']);
export const esNueva = (t: BombaTipo): t is BombaNueva => NUEVAS.has(t);

type BombaA = Bomba & { tipo: BombaTipo; t: number };

/* ── Pools ───────────────────────────────────────────────────────────────── */

type Fuego = { x: number; y: number; w: number; t: number; vida: number; tick: number; mar: boolean };
type Humo = { x: number; y: number; r: number; t: number; vida: number };
type Mina = { x: number; y: number; t: number; mar: boolean; viva: boolean };
type Sismo = { x: number; y: number; t: number };
type Part = { x: number; y: number; vx: number; vy: number; t: number; vida: number; c: number; activo: boolean };

const COLORES = ['#ff4a8a', '#ffd23a', '#3ad8ff', '#5ae84a', '#9a6aff', '#ff8a3a', '#ffffff'];

function pool(n: number): Part[] {
  return Array.from({ length: n }, () => ({ x: 0, y: 0, vx: 0, vy: 0, t: 0, vida: 0, c: 0, activo: false }));
}
function tomar(p: Part[]): Part | null {
  for (const q of p) if (!q.activo) return q;
  return null;
}

/** A filled pixel disc from a cache (D.disc is too slow for big clouds every frame). */
const discos = new Map<string, HTMLCanvasElement>();
function disco(g: Ctx, x: number, y: number, r: number, c: string) {
  const k = `${r}|${c}`;
  let cv = discos.get(k);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = r * 2 + 3;
    D.disc(cv.getContext('2d')!, r + 1, r + 1, r, c);
    discos.set(k, cv);
  }
  g.drawImage(cv, Math.round(x) - r - 1, Math.round(y) - r - 1);
}

/** Cheap deterministic 0..1 noise. */
function h01(a: number, b: number) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function crear(api: Api) {
  const fuegos: Fuego[] = [];
  const humos: Humo[] = [];
  const minas: Mina[] = [];
  const sismos: Sismo[] = [];
  const confeti = pool(140);
  const dardos = pool(48);
  const dulces = pool(16);
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const sonar = (tipo: BombaNueva, x: number) => {
    if (!api.mudo()) AB.bombaArsenal(tipo, api.pan(x));
  };

  /** The vehicle whose box contains (x, y), if any. */
  function cocheEn(x: number, y: number, m = 0): Coche | null {
    for (const c of api.coches()) {
      if (c.hp <= 0) continue;
      const b = api.caja(c);
      if (Math.abs(x - c.x) < b.w / 2 + m && y > c.y - 1 - m && y < c.y + b.h + m) return c;
    }
    return null;
  }

  function lanzarConfeti(x: number, y: number, n: number, fuerza: number) {
    for (let i = 0; i < n; i++) {
      const p = tomar(confeti);
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const v = fuerza * (0.3 + Math.random() * 0.7);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v + fuerza * 0.3;
      p.t = 0;
      p.vida = rnd(1.6, 3);
      p.c = Math.floor(Math.random() * COLORES.length);
      p.activo = true;
    }
  }

  /** The piñata bursts: candies fanned out, a cloud of confetti. */
  function reventarPinata(b: BombaA) {
    for (let i = 0; i < 9; i++) {
      const p = tomar(dulces);
      if (!p) break;
      const k = (i - 4) / 4;
      p.x = b.x;
      p.y = b.y;
      p.vx = b.vx * 0.6 + k * 90 + rnd(-12, 12);
      p.vy = b.vy * 0.5 + rnd(10, 60);
      p.t = 0;
      p.vida = 6;
      p.c = i % COLORES.length;
      p.activo = true;
    }
    lanzarConfeti(b.x, b.y, 50, 120);
    api.luz(b.x, b.y, 26, '#ff8ac0', 0.3);
    sonar('pinata', b.x);
    if (!api.mudo()) api.pop(b.x, b.y + 12, '¡Piñata!', '#ff6aa8');
  }

  /** The dart dispenser opens: thirty darts in a widening cone. */
  function abrirDardos(b: BombaA) {
    for (let i = 0; i < 30; i++) {
      const p = tomar(dardos);
      if (!p) break;
      p.x = b.x + rnd(-4, 4);
      p.y = b.y + rnd(-4, 4);
      p.vx = b.vx * 0.85 + rnd(-70, 70);
      p.vy = Math.min(b.vy, -60) * 1.1 - rnd(0, 80);
      p.t = 0;
      p.vida = 5;
      p.c = 0;
      p.activo = true;
    }
    api.puff(b.x, b.y, 2, false, 0.6);
    sonar('dardos', b.x);
  }

  /**
   * One bomb of the batch, while it falls: returns true when it's used up in
   * the air (piñata, darts) so the game drops it.
   */
  function vuelo(b: BombaA, dt: number): boolean {
    const alto = b.y - api.ground(b.x);
    switch (b.tipo) {
      case 'napalm':
        // The finless tank tumbles end over end.
        b.rumbo += dt * 9;
        return false;
      case 'pista':
        if (b.t > 0.25 && b.t < 0.85) {
          // Under the chute: it slows right down and swings nose-down.
          b.vx *= Math.max(0, 1 - dt * 3);
          b.vy += (-45 - b.vy) * Math.min(1, dt * 5);
          b.rumbo += (-Math.PI / 2 - b.rumbo) * Math.min(1, dt * 4);
        } else if (b.t >= 0.85) {
          // The rocket fires straight down.
          b.vy = Math.min(b.vy, -380);
          b.vx *= 0.9;
          b.rumbo = -Math.PI / 2;
          if (Math.random() < dt * 30) api.puff(b.x, b.y + 6, 1, false, 0.5, 0, 30);
        }
        return false;
      case 'planeadora':
        if (b.t > 0.3) {
          // Wings out: lift holds most of its weight and it keeps its speed.
          const dive = b.t > 5 || (alto < 140 && cocheBajo(b));
          if (!dive) {
            b.vy += GRAVEDAD * 0.82 * dt;
            b.vx += Math.sign(b.vx || 1) * 18 * dt;
            b.rumbo = Math.atan2(b.vy, b.vx);
          } else guiar(b, dt);
        }
        if (b.t > 0.3 && b.t - dt <= 0.3) sonar('planeadora', b.x);
        return false;
      case 'pinata':
        if (b.t > 0.4 && (alto < 120 || b.t > 1.4)) {
          reventarPinata(b);
          return true;
        }
        return false;
      case 'dardos':
        if (b.t > 0.35 && (alto < 160 || b.t > 1.6)) {
          abrirDardos(b);
          return true;
        }
        return false;
      case 'mina':
        // A small chute: it comes down gently.
        if (b.t > 0.3) {
          b.vy += (-70 - b.vy) * Math.min(1, dt * 3);
          b.vx *= Math.max(0, 1 - dt * 1.5);
        }
        return false;
      case 'sismica':
        // Heavy and streamlined: it falls faster than the rest.
        b.vy -= GRAVEDAD * 0.35 * dt;
        return false;
      default:
        return false;
    }
  }

  /** A vehicle ahead and below the glide bomb, within its reach. */
  function cocheBajo(b: BombaA) {
    const dir = Math.sign(b.vx || 1);
    for (const c of api.coches()) if (c.hp > 0 && (c.mid.x - b.x) * dir > -20 && Math.abs(c.mid.x - b.x) < 180) return true;
    return false;
  }

  /** The glide bomb's dive: it steers onto the nearest vehicle ahead. */
  function guiar(b: BombaA, dt: number) {
    let best: Coche | null = null, bd = 260;
    for (const c of api.coches()) {
      if (c.hp <= 0) continue;
      const d = Math.abs(c.mid.x - b.x);
      if (d < bd && c.mid.y < b.y) {
        bd = d;
        best = c;
      }
    }
    if (!best) return;
    const tiempo = Math.max(0.25, (b.y - best.mid.y) / Math.max(60, -b.vy));
    const quiere = (best.mid.x - b.x) / tiempo;
    b.vx += Math.max(-300 * dt, Math.min(300 * dt, quiere - b.vx));
    b.vy -= GRAVEDAD * 0.4 * dt;
    b.rumbo = Math.atan2(b.vy, b.vx);
    if (Math.random() < dt * 20) api.luz(b.x, b.y, 4, '#7af0ff', 0.05);
  }

  /** One bomb of the batch arriving. */
  function impacto(b: BombaA) {
    const x = b.x, y = Math.max(b.y, api.ground(b.x));
    const mar = api.sobreMar(x);
    switch (b.tipo as BombaNueva) {
      case 'napalm': {
        api.blast(x, y, 4, 1.4);
        // Napalm floats: it burns on the sea too.
        const yf = mar ? api.nivelMar : api.ground(x);
        if (fuegos.length < 6) fuegos.push({ x: x + b.vx * 0.25, y: yf, w: 230, t: 0, vida: 9, tick: 0, mar });
        api.luz(x, y, 70, '#ff7a2a', 0.6);
        sonar('napalm', x);
        break;
      }
      case 'pista': {
        api.blast(x, y, 2.5, 0.8);
        sonar('pista', x);
        // A beat later it goes off under the ground.
        api.later(() => {
          const g = api.ground(x);
          api.blast(x, g - 10, 9, 4.2);
          api.crater(x, g - 6, 24);
          api.crater(x - 14, g - 4, 14);
          api.crater(x + 14, g - 4, 14);
          api.sacudir(7);
        }, 260);
        break;
      }
      case 'humo':
        api.blast(x, y, 1, 0.1);
        if (humos.length < 5) humos.push({ x, y: (mar ? api.nivelMar : api.ground(x)) + 10, r: 120, t: 0, vida: 12 });
        sonar('humo', x);
        break;
      case 'mina':
        if (minas.length < 8) minas.push({ x, y: mar ? api.nivelMar : api.ground(x), t: 0, mar, viva: true });
        if (mar) api.chapoteo(x, 1.2);
        else api.puff(x, y, 2, false, 0.6);
        sonar('mina', x);
        if (!api.mudo()) api.pop(x, y + 16, mar ? 'Mina al agua' : 'Mina armada', '#ff6a6a');
        break;
      case 'planeadora':
        api.blast(x, y, 9, 4);
        break;
      case 'pinata':
        reventarPinata(b);
        break;
      case 'dardos':
        abrirDardos(b);
        api.blast(x, y, 2, 0.6);
        break;
      case 'sismica': {
        api.blast(x, y, 5, 1.8);
        sonar('sismica', x);
        api.later(() => {
          const g = api.ground(x);
          api.crater(x, g - 4, 30);
          if (sismos.length < 4) sismos.push({ x, y: g, t: 0 });
          api.sacudir(10);
          for (const c of api.coches()) {
            if (c.hp <= 0) continue;
            const d = Math.abs(c.mid.x - x);
            if (d > 280) continue;
            const k = 1 - d / 280;
            api.hurtCar(c, 2.6 * k);
            api.empujar(c, Math.sign(c.mid.x - x || 1) * 60 * k, 140 * k);
          }
        }, 320);
        break;
      }
    }
  }

  /** Fires, smoke, mines, quakes and the loose bits: once per frame. */
  function paso(dt: number, viento: number) {
    for (let i = fuegos.length - 1; i >= 0; i--) {
      const f = fuegos[i];
      f.t += dt;
      if (f.t > f.vida) {
        fuegos.splice(i, 1);
        continue;
      }
      if (Math.random() < dt * 10) api.puff(f.x + rnd(-f.w / 2, f.w / 2), f.y + rnd(8, 18), 2, true, 1.6, viento * 0.4 + rnd(-6, 6), rnd(24, 44));
      f.tick -= dt;
      if (f.tick > 0) continue;
      f.tick = 0.25;
      const k = 1 - f.t / f.vida;
      for (const c of api.coches()) {
        if (c.hp > 0 && Math.abs(c.mid.x - f.x) < f.w / 2 + 6 && c.mid.y - f.y < 26) api.hurtCar(c, 0.22 * (0.5 + 0.5 * k));
      }
    }
    for (let i = humos.length - 1; i >= 0; i--) {
      const h = humos[i];
      h.t += dt;
      h.x += viento * 0.25 * dt;
      if (h.t > h.vida) {
        humos.splice(i, 1);
        continue;
      }
      // Missiles crossing the wall lose their target; batteries inside can't see out.
      if (api.cegar(h.x - h.r * 0.6, h.x + h.r * 0.6, h.y - 20, h.y + h.r * 1.4) && !api.mudo()) api.pop(h.x, h.y + h.r, 'Misil ciego', '#c8ccd8');
      for (const c of api.coches()) if (Math.abs(c.mid.x - h.x) < h.r * 0.7) c.fireT = Math.max(c.fireT, 0.4);
    }
    for (let i = minas.length - 1; i >= 0; i--) {
      const m = minas[i];
      m.t += dt;
      if (m.mar) m.y = api.nivelMar + Math.sin(m.t * 2.2) * 1.2;
      const toca = m.t > 1 && cocheEn(m.x, m.y + 2, 10);
      if (toca || m.t > 30) {
        minas.splice(i, 1);
        if (toca) {
          api.blast(m.x, m.y + 2, 9, 4.6);
          if (m.mar) api.chapoteo(m.x, 3);
        } else api.puff(m.x, m.y + 4, 2, true, 0.8);
      }
    }
    for (let i = sismos.length - 1; i >= 0; i--) {
      const q = sismos[i];
      q.t += dt;
      if (q.t > 1.4) sismos.splice(i, 1);
    }
    for (const p of confeti) {
      if (!p.activo) continue;
      p.t += dt;
      // Paper flutters: heavy drag, a slow fall and a wobble.
      p.vx += (viento * 0.5 - p.vx) * Math.min(1, dt * 2.5);
      p.vy += (-26 - p.vy) * Math.min(1, dt * 2.5);
      p.x += (p.vx + Math.sin(p.t * 9 + p.c) * 14) * dt;
      p.y += p.vy * dt;
      if (p.t > p.vida || p.y < api.ground(p.x)) p.activo = false;
    }
    for (const p of dardos) {
      if (!p.activo) continue;
      p.t += dt;
      p.vy -= GRAVEDAD * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const c = cocheEn(p.x, p.y, 1);
      if (c) {
        api.hurtCar(c, 0.32);
        p.activo = false;
      } else if (p.y <= api.ground(p.x)) {
        if (api.sobreMar(p.x)) api.chapoteo(p.x, 0.3);
        else if (Math.random() < 0.3) api.puff(p.x, api.ground(p.x) + 1, 1, false, 0.4);
        p.activo = false;
      } else if (p.t > p.vida) p.activo = false;
    }
    for (const p of dulces) {
      if (!p.activo) continue;
      p.t += dt;
      p.vy -= GRAVEDAD * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y <= api.ground(p.x) || cocheEn(p.x, p.y, 2) || p.t > p.vida) {
        p.activo = false;
        const y = Math.max(p.y, api.ground(p.x));
        api.blast(p.x, y, 2.6, 1.3);
        lanzarConfeti(p.x, y + 4, 8, 70);
      }
    }
  }

  /* ── Drawing ── */

  /** Napalm: a long carpet of orange flame under thick black smoke. */
  function dibujarFuego(g: Ctx, f: Fuego, X: number, Y: number, t: number) {
    const k = Math.min(1, f.t / 0.3) * Math.min(1, (f.vida - f.t) / 1.5);
    if (k <= 0) return;
    const a0 = g.globalAlpha;
    const x0 = Math.round(X - f.w / 2);
    const n = Math.round(f.w / 4);
    for (let i = 0; i < n; i += 3) {
      const r = h01(i, x0);
      const life = (t * 0.5 + r) % 1;
      g.globalAlpha = a0 * k * 0.55 * (1 - life);
      disco(g, x0 + i * 4 + Math.round(Math.sin(t + i) * 3), Y - 8 - Math.round(life * 34), 2 + Math.round(life * 5), '#3a3036');
    }
    g.globalAlpha = a0 * (0.55 + 0.35 * k);
    R(g, x0, Y - 1, n * 4, 2, f.mar ? '#ff7a2a' : '#c8401a');
    g.globalAlpha = a0;
    for (let i = 0; i < n; i++) {
      const r = h01(i, x0 + 3);
      const fl = 0.55 + 0.45 * Math.sin(t * 11 + i * 1.3 + r * 6);
      const h = Math.max(1, Math.round((4 + r * 10) * k * fl));
      const fx = x0 + i * 4;
      R(g, fx, Y - h - 1, 4, h, '#e83a1a');
      R(g, fx, Y - Math.ceil(h * 0.7) - 1, 4, Math.ceil(h * 0.7), '#ff8a2a');
      R(g, fx + 1, Y - Math.ceil(h * 0.35) - 1, 2, Math.ceil(h * 0.35), '#ffe070');
    }
  }

  /** The smoke screen: a tall billowing grey wall. */
  function dibujarHumo(g: Ctx, h: Humo, X: number, Y: number, t: number) {
    const k = Math.min(1, h.t / 0.8) * Math.min(1, (h.vida - h.t) / 2);
    if (k <= 0) return;
    const a0 = g.globalAlpha;
    const crece = Math.min(1, h.t / 1.5);
    for (let i = 0; i < 14; i++) {
      const r = h01(i, 91);
      const px = X + Math.round((r - 0.5) * h.r * 1.2 + Math.sin(t * 0.7 + i) * 5);
      const py = Y - Math.round(((i % 7) / 7) * h.r * 1.5 * crece) - 6;
      g.globalAlpha = a0 * k * (i % 3 === 0 ? 0.55 : 0.75);
      disco(g, px, py, Math.round(10 + r * 10 * crece), i % 2 ? '#a8acb8' : '#c8ccd6');
    }
    g.globalAlpha = a0;
  }

  /** A mine bobbing on the sea or sitting on the ground, its lamp blinking. */
  function dibujarMina(g: Ctx, m: Mina, X: number, Y: number, t: number) {
    const y = m.mar ? Y : Y - 4;
    D.disc(g, X, y, 4, '#1a2a24');
    D.disc(g, X, y, 3, '#2e4a3e');
    R(g, X - 1, y - 2, 2, 1, '#4a6a5a');
    for (const [dx, dy] of [[0, -6], [-5, -2], [4, -2]]) R(g, X + dx, y + dy, 1, 2, '#8a9a92');
    if (Math.floor(t * (m.t > 1 ? 3 : 8)) % 2 === 0) R(g, X, y - 1, 1, 1, '#ff3a3a');
    if (m.mar) {
      g.globalAlpha = 0.6;
      R(g, X - 6, Y + 3, 13, 1, '#cfefff');
      g.globalAlpha = 1;
    }
  }

  function dibujar(g: Ctx, sx: (x: number) => number, sy: (y: number) => number, t: number, bombas: readonly BombaA[]) {
    for (const f of fuegos) dibujarFuego(g, f, sx(f.x), sy(f.y), t);
    for (const m of minas) dibujarMina(g, m, sx(m.x), sy(m.y), t);
    for (const q of sismos) {
      // A ring of dust rolling out along the ground.
      const k = q.t / 1.4;
      const r = 20 + k * 260;
      g.globalAlpha = 0.7 * (1 - k);
      for (const s of [-1, 1]) {
        const x = q.x + s * r;
        disco(g, sx(x), sy(Math.max(q.y, 0)) - 4, 4 + Math.round(k * 6), '#b4a088');
        R(g, sx(x) - 8, sy(q.y) - 1, 16, 2, '#8a7a64');
      }
      g.globalAlpha = 1;
    }
    for (const p of dardos) {
      if (!p.activo) continue;
      const v = Math.hypot(p.vx, p.vy) || 1;
      const ux = p.vx / v, uy = -p.vy / v;
      const X = sx(p.x), Y = sy(p.y);
      for (let i = 0; i < 5; i++) R(g, Math.round(X - ux * i), Math.round(Y - uy * i), 1, 1, i === 0 ? P.white : i < 4 ? '#a8b0bc' : '#ffd23a');
    }
    for (const p of dulces) {
      if (!p.activo) continue;
      const X = sx(p.x), Y = sy(p.y);
      const c = COLORES[p.c];
      R(g, X - 2, Y - 1, 4, 3, c);
      R(g, X - 1, Y - 1, 1, 1, P.white);
      // Twisted wrapper ends.
      const f = Math.floor(p.t * 10) % 2;
      R(g, X - 4, Y - f, 2, 1 + f, c);
      R(g, X + 2, Y - 1 + f, 2, 2 - f, c);
    }
    for (const p of confeti) {
      if (!p.activo) continue;
      const flip = Math.floor(p.t * 12 + p.c) % 3;
      g.globalAlpha = Math.min(1, (p.vida - p.t) * 2);
      R(g, sx(p.x), sy(p.y), flip === 0 ? 1 : 2, flip === 2 ? 1 : 2, COLORES[p.c]);
    }
    g.globalAlpha = 1;
    // In flight: the anti-runway bomb's chute and rocket, the mine's chute, the glide bomb's wings.
    for (const b of bombas) {
      if (!esNueva(b.tipo) || b.t < 0) continue;
      const X = sx(b.x), Y = sy(b.y);
      if ((b.tipo === 'pista' && b.t > 0.25 && b.t < 0.85) || (b.tipo === 'mina' && b.t > 0.3)) {
        const sw = Math.round(Math.sin(t * 5 + b.x) * 1.5);
        for (const dx of [-5, 5]) for (let i = 1; i < 6; i++) R(g, X + Math.round((dx * i) / 6) + sw, Y - 4 - i * 2, 1, 1, '#e8e0d0');
        D.oval(g, X + sw, Y - 16, 7, 3, '#3a2a4a');
        D.oval(g, X + sw, Y - 16, 6, 2, b.tipo === 'mina' ? '#ff9a5a' : '#e8dcb0');
        R(g, X + sw - 2, Y - 18, 4, 1, P.white);
      } else if (b.tipo === 'pista' && b.t >= 0.85) {
        const fl = 4 + (Math.floor(t * 30) % 3);
        R(g, X - 1, Y - 6 - fl, 3, fl, '#ff9a3c');
        R(g, X, Y - 6 - Math.ceil(fl / 2), 1, Math.ceil(fl / 2), P.gold1);
      } else if (b.tipo === 'planeadora' && b.t > 0.3) {
        // Wings popped out across its back.
        R(g, X - 8, Y - 1, 17, 1, '#5a5a6a');
        R(g, X - 7, Y - 1, 15, 1, '#c4c4d4');
      }
    }
  }

  /** Drawn after the vehicles: the smoke wall hides what's behind it. */
  function dibujarEncima(g: Ctx, sx: (x: number) => number, sy: (y: number) => number, t: number) {
    for (const h of humos) dibujarHumo(g, h, sx(h.x), sy(h.y), t);
  }

  function reiniciar() {
    fuegos.length = 0;
    humos.length = 0;
    minas.length = 0;
    sismos.length = 0;
    for (const p of confeti) p.activo = false;
    for (const p of dardos) p.activo = false;
    for (const p of dulces) p.activo = false;
  }

  return { vuelo, impacto, paso, dibujar, dibujarEncima, reiniciar };
}
