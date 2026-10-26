import { ARRASTRE_BOMBA, GRAVEDAD, explosion, ENERGIA } from './fisica-armas';

/*
 * The mice's brains for the ground vehicles. Pure functions over a snapshot of
 * the world (`Vista`) that motor.ts builds once per frame and passes to every
 * vehicle. Each vehicle keeps a small `memoria` object (the engine stores it
 * next to the car) for states that last over several frames: "dodging until
 * t", "alerted at t", "scattering until t".
 *
 * Units as in fisica-tipos.ts: px, s, y is ALTITUDE (up). Vehicles drive to
 * the LEFT (negative velocity) towards the pantry.
 *
 * Difficulty grows smoothly with the wave: `nivelIA(ola)` goes 0 → ~1 and
 * tunes reaction time, how many mice dodge at all, how far apart they keep,
 * how hard they sprint, firing range and salvo rate.
 */

export type Vista = {
  avion: { x: number; y: number; vx: number; vy: number; vivo: boolean };
  bombas: { x: number; y: number; vx: number; vy: number }[];
  misilesJugador: { x: number; y: number; vx: number; vy: number }[];
  vecinos: { x: number; kind: string; vx: number }[];
  ola: number;
  t: number;
  suelo: (x: number) => number;
  /** Optional: wind at ground level, px/s (positive to the right). Bombs drift with it. */
  viento?: number;
  /** Optional: the plane's hit radius (aerial enemies use it to know when they rammed it). */
  radioAvion?: number;
};

export type Orden = {
  /** Wanted speed, px/s; negative = towards the pantry (left). Pass it to FA.pasoVehiculo. */
  velocidad: number;
  /** True when the shot makes sense now: reloaded, in range and with a clear line of fire. */
  disparar: boolean;
  /** Aim point with lead (where the plane will be when the shot arrives). */
  apuntarA?: { x: number; y: number };
  /** True while dodging a bomb or a missile (for a little "!" or dust puff, if wanted). */
  esquivar?: boolean;
  /** Reload multiplier for the next shot (1 normal, < 1 faster in high waves). */
  cadencia?: number;
};

export type VehiculoIA = { id: number; kind: string; x: number; y: number; vx: number; fireT: number };

/* ── Tuning per vehicle ─────────────────────────────────────────────────── */

type Ficha = { vel: number; medio: number; alcance: number; velBala: number; canon: number };
/** Base speed (same as motor's VEH), half length, range, projectile speed, cannon height. */
const FICHAS: Record<string, Ficha> = {
  jeep: { vel: 30, medio: 12, alcance: 250, velBala: 150, canon: 14 },
  camion: { vel: 19, medio: 17, alcance: 300, velBala: 130, canon: 14 },
  tanque: { vel: 13, medio: 15, alcance: 280, velBala: 230, canon: 14 },
  sam: { vel: 11, medio: 17, alcance: 360, velBala: 135, canon: 18 },
  margarita: { vel: 9, medio: 28, alcance: 240, velBala: 140, canon: 50 },
  lancha: { vel: 34, medio: 13, alcance: 250, velBala: 150, canon: 10 },
  fragata: { vel: 12, medio: 22, alcance: 360, velBala: 135, canon: 16 },
  portaaviones: { vel: 8, medio: 75, alcance: 420, velBala: 140, canon: 30 },
  trolebus: { vel: 16, medio: 20, alcance: 300, velBala: 130, canon: 14 },
  bici: { vel: 52, medio: 8, alcance: 220, velBala: 150, canon: 8 },
};
const ficha = (k: string) => FICHAS[k] ?? FICHAS.jeep;

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Deterministic 0…1 from an integer (each mouse has its own "talent"). */
const hash01 = (n: number, s = 0) => {
  let h = (Math.imul((n | 0) ^ 0x9e3779b9, 2654435761) + Math.imul(s | 0, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** 0 in wave 1, ~0.4 in wave 3, ~0.65 in wave 5, ~0.9 in wave 10. */
export function nivelIA(ola: number): number {
  return 1 - Math.exp(-Math.max(0, fin(ola, 1) - 1) / 4);
}

/* ── Threat prediction ──────────────────────────────────────────────────── */

type Amenaza = { x: number; t: number; r: number };

const G = GRAVEDAD;
const cacheAmenazas = new WeakMap<Vista, Amenaza[]>();

/** Where and when a bomb hits the ground (same drag model as FA.pasoBomba). */
function caidaBomba(b: { x: number; y: number; vx: number; vy: number }, suelo: Vista['suelo'], viento: number): Amenaza | null {
  let x = fin(b.x), y = fin(b.y), vx = fin(b.vx), vy = fin(b.vy);
  const h = 1 / 60;
  for (let t = 0; t < 5; t += h) {
    const hp = y - fin(suelo(x));
    const rvx = vx - viento;
    const s = Math.hypot(rvx, vy);
    vx += -ARRASTRE_BOMBA * s * rvx * h;
    vy += (-ARRASTRE_BOMBA * s * vy - G) * h;
    const nx = x + vx * h, ny = y + vy * h;
    const hn = ny - fin(suelo(nx));
    if (hn <= 0) {
      const f = hp / Math.max(1e-6, hp - hn);
      return { x: x + (nx - x) * f, t: t + h * f, r: 0 };
    }
    x = nx;
    y = ny;
  }
  return null;
}

/** Player rockets fly almost straight along the nose: extrapolate to the ground. */
function caidaMisil(m: { x: number; y: number; vx: number; vy: number }, suelo: Vista['suelo']): Amenaza | null {
  if (!(m.vy < -10)) return null;
  let x = fin(m.x), y = fin(m.y);
  const h = 1 / 30;
  for (let t = 0; t < 2.5; t += h) {
    x += m.vx * h;
    y += m.vy * h;
    if (y <= fin(suelo(x))) return { x, t, r: 0 };
  }
  return null;
}

// Danger radius: no damage at all beyond it (blast falloff, see FA.explosion).
const R_BOMBA = (() => {
  const ex = explosion(ENERGIA.bomba);
  let d = 0;
  while (d < 80 && 4 * ex.dano(d) >= 0.25) d += 0.5;
  return Math.sqrt(Math.max(0, d * d - 81)); // the hull's middle is ~9 px above the impact
})();
const R_MISIL = (() => {
  const ex = explosion(ENERGIA.misilJugador);
  let d = 0;
  while (d < 80 && 2.5 * ex.dano(d) >= 0.25) d += 0.5;
  return Math.sqrt(Math.max(0, d * d - 81));
})();

function amenazas(vista: Vista): Amenaza[] {
  let a = cacheAmenazas.get(vista);
  if (a) return a;
  a = [];
  const w = fin(vista.viento ?? 0);
  for (const b of vista.bombas) {
    const c = caidaBomba(b, vista.suelo, w);
    if (c) a.push({ ...c, r: R_BOMBA });
  }
  for (const m of vista.misilesJugador) {
    const c = caidaMisil(m, vista.suelo);
    if (c) a.push({ ...c, r: R_MISIL });
  }
  cacheAmenazas.set(vista, a);
  return a;
}

/** The vehicle's x after T seconds driving towards `vd` (same controller as FA.pasoVehiculo: kp 3, 0.55 g). */
function avance(x: number, v: number, vd: number, T: number): number {
  const h = 1 / 30;
  const aMax = 0.5 * G; // a bit under 0.55 g: slopes eat some traction
  let t = 0;
  for (; t + h <= T; t += h) {
    v += clamp(3 * (vd - v), -aMax, aMax) * h;
    x += v * h;
  }
  const r = T - t;
  if (r > 0) x += (v + clamp(3 * (vd - v), -aMax, aMax) * r) * r;
  return x;
}

/* ── Line of fire ───────────────────────────────────────────────────────── */

/** True if the terrain doesn't block the straight line from (x0, y0) to (x1, y1). */
export function lineaLibre(x0: number, y0: number, x1: number, y1: number, suelo: Vista['suelo']): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 6);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const x = x0 + (x1 - x0) * k;
    if (fin(suelo(x)) > y0 + (y1 - y0) * k - 1) return false;
  }
  return true;
}

/** Lead point: where the plane will be when a projectile at `vel` px/s gets there. */
export function adelanto(ox: number, oy: number, vel: number, a: Vista['avion']): { x: number; y: number; t: number } {
  let t = Math.hypot(a.x - ox, a.y - oy) / vel;
  for (let i = 0; i < 3; i++) t = Math.hypot(a.x + a.vx * t - ox, a.y + a.vy * t - oy) / vel;
  t = Math.min(t, 3);
  return { x: a.x + a.vx * t, y: a.y + a.vy * t, t };
}

function tiro(v: VehiculoIA, vista: Vista, k: number) {
  const F = ficha(v.kind);
  const a = vista.avion;
  const oy = v.y + F.canon;
  const p = adelanto(v.x, oy, F.velBala * lerp(1, 1.1, k), a);
  const alcance = F.alcance * lerp(1, 1.25, k);
  const dist = Math.hypot(a.x - v.x, a.y - oy);
  const libre = lineaLibre(v.x, oy, p.x, p.y, vista.suelo) || lineaLibre(v.x, oy, a.x, a.y, vista.suelo);
  // A plane high above is still a target: the long-range missiles climb
  // after it (more so in later waves), so flying high is no free escape.
  const arriba = Math.abs(a.x - v.x) < alcance * 0.9 && a.y - oy < lerp(1400, 3000, k);
  return { punto: { x: p.x, y: p.y }, ok: a.vivo && (dist < alcance || arriba) && p.y > oy - 10 && libre };
}

/* ── The brain ──────────────────────────────────────────────────────────── */

/**
 * Decide this frame's speed and whether to shoot. `memoria` is a per-vehicle
 * object the engine keeps (start with `{}`).
 */
export function pensar(v: VehiculoIA, vista: Vista, memoria: Record<string, number>): Orden {
  const F = ficha(v.kind);
  const k = nivelIA(vista.ola);
  const t = vista.t;
  const a = vista.avion;
  const boss = v.kind === 'margarita' || v.kind === 'portaaviones';
  const base = F.vel * Math.min(1.5, 1 + (vista.ola - 1) * 0.05);

  // 1. Cruise: drive to the pantry; sprint when the plane is far or behind us.
  let vd = -base;
  const dx = a.x - v.x;
  const lejos = !a.vivo || Math.abs(dx) > lerp(320, 240, k) || (dx > 100 && a.vx > 30);
  if (lejos && !boss) vd = -base * lerp(1.25, 1.65, k);

  // 2. Keep distance from the one ahead (bigger gaps later: one bomb, one mouse).
  let delante: Vista['vecinos'][number] | null = null;
  for (const o of vista.vecinos) if (o.x < v.x && (!delante || o.x > delante.x)) delante = o;
  const hueco = lerp(10, 22, k);
  if (delante) {
    const gap = v.x - delante.x - F.medio - ficha(delante.kind).medio;
    if (gap < hueco) vd = Math.max(vd, Math.min(0, delante.vx) * 0.9 + (hueco - gap) * 0.6);
  }

  // 3. Scatter when the plane dives on us: half speed up, half brake.
  const sobre = a.vivo && Math.abs(dx - a.vx * 0.6) < 90 && a.y - v.y < 170 && a.vy < -25;
  if (sobre && k > 0.15 && !boss) memoria.dispersa = t + 1.2;
  if ((memoria.dispersa ?? -1) > t) vd = (v.id & 1) === 0 ? -base * lerp(1.4, 1.8, k) : base * 0.3;

  // 4. Dodge what's falling on us (ballistic prediction + a little search over speeds).
  let esquivar = false;
  const talento = hash01(v.id, 7);
  const atento = talento < lerp(0.3, 0.6, k);
  const reaccion = lerp(0.4, 0.06, k) * (0.6 + 0.8 * hash01(v.id, 3));
  const peligros = atento ? amenazas(vista).filter((z) => z.t < 3.5 && Math.abs(z.x - (v.x + v.vx * z.t)) < F.medio + z.r + 50) : [];
  const libreCon = (vx: number) => {
    let peor = Infinity;
    for (const z of peligros) {
      const d = Math.abs(avance(v.x, v.vx, vx, z.t) - z.x) - F.medio - z.r;
      if (d < peor) peor = d;
    }
    return peor;
  };
  if (peligros.length) {
    if ((memoria.alerta ?? -1) < 0) memoria.alerta = t;
    const actual = libreCon(vd);
    if (actual < 6 && t - memoria.alerta >= reaccion) {
      // Re-plan at most every 0.15 s so the choice doesn't flicker.
      if (t >= (memoria.replan ?? -1) || (memoria.esqHasta ?? -1) < t) {
        const tope = boss ? base : base * lerp(1.5, 1.9, k);
        const cands = [vd, -tope, -tope * 0.7, -base * 0.4, 0, Math.min(25, base * 0.6), Math.min(30, base)];
        let mejor = vd, mejorP = -Infinity;
        for (const c of cands) {
          let p = Math.min(libreCon(c), 25) * 10 - Math.max(0, c) * 0.4 + -c * 0.05;
          if (delante && c < 0 && avance(v.x, v.vx, c, 1) - F.medio < delante.x + delante.vx + ficha(delante.kind).medio) p -= 80;
          if (p > mejorP) {
            mejorP = p;
            mejor = c;
          }
        }
        memoria.esqVel = mejor;
        memoria.replan = t + 0.15;
        memoria.esqHasta = t + Math.min(...peligros.map((z) => z.t)) + 0.15;
      }
    }
  } else memoria.alerta = -1;
  if ((memoria.esqHasta ?? -1) > t) {
    vd = memoria.esqVel ?? vd;
    esquivar = true;
  }

  // 5. Shooting: only with a clear line, in range, with lead.
  const tr = tiro(v, vista, k);
  return {
    velocidad: fin(vd),
    disparar: tr.ok && v.fireT <= 0,
    apuntarA: tr.punto,
    esquivar,
    cadencia: lerp(1, 0.7, k),
  };
}

/* ── Coordinated salvos ─────────────────────────────────────────────────── */

/**
 * Picks 2–3 vehicles that should fire together right now: one on each side
 * of the plane when possible (crossfire boxes it in), otherwise the closest
 * ones. Vehicles whose reload is nearly done (fireT ≤ 1.2 s) are hurried up
 * to join. Pass `mem` (one object for the whole game, e.g. `{ ultima: -99 }`)
 * so salvos keep a pause between them. Returns the ids; fire them all this
 * frame (aim with `apuntarSalva`) and reset their fireT.
 */
export function coordinarSalva(vehiculos: VehiculoIA[], vista: Vista, t: number, mem?: { ultima: number }): Set<number> {
  const out = new Set<number>();
  if (vista.ola < 2 || !vista.avion.vivo) return out;
  const k = nivelIA(vista.ola);
  if (mem && t - mem.ultima < lerp(6, 2.4, k)) return out;
  const a = vista.avion;
  const listos = vehiculos.filter((v) => v.kind !== 'margarita' && v.kind !== 'portaaviones' && v.fireT <= 1.2 && tiro(v, vista, k).ok);
  if (listos.length < 2) return out;
  const cerca = (v: VehiculoIA) => Math.hypot(v.x - a.x, v.y - a.y);
  listos.sort((p, q) => cerca(p) - cerca(q));
  const izq = listos.find((v) => v.x < a.x - 20);
  const der = listos.find((v) => v.x > a.x + 20);
  const elegidos: VehiculoIA[] = izq && der ? [izq, der] : listos.slice(0, 2);
  const max = vista.ola >= 4 ? 3 : 2;
  for (const v of listos) if (elegidos.length < max && !elegidos.includes(v)) elegidos.push(v);
  for (const v of elegidos) out.add(v.id);
  if (mem) mem.ultima = t;
  return out;
}

/**
 * Aim point for member `i` of an `n`-vehicle salvo fired from (ox, oy): the
 * first aims at the lead point, the others where the plane would be if it
 * pulled up or dived to dodge (a fan that closes the escape routes).
 */
export function apuntarSalva(i: number, n: number, ox: number, oy: number, vista: Vista, velBala = 140): { x: number; y: number } {
  const a = vista.avion;
  const p = adelanto(ox, oy, velBala, a);
  if (i === 0 || n < 2) return { x: p.x, y: p.y };
  const s = Math.hypot(a.vx, a.vy) || 1;
  // Perpendicular to the flight path, scaled by how far the plane can turn in the flight time.
  const desv = clamp(p.t * 45, 14, 50) * (i % 2 === 1 ? 1 : -1);
  return { x: p.x - (a.vy / s) * desv, y: Math.max(vista.suelo(p.x) + 15, p.y + (a.vx / s) * desv) };
}
