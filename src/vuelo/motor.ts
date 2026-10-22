import * as D from '../game/dulce';
import { P, SKY_H } from '../game/dulce';
import { sfx } from '../game/audio';
import * as S from './sonido';
import * as A from './dibujo';
import type { VehiculoTipo } from './dibujo';
import * as FV from './fisica-vuelo';
import * as FA from './fisica-armas';
import type { Avion, Cuerpo, Mando, Misil, ModeloAvion, Movil, Vehiculo, Bomba } from './fisica-tipos';

/*
 * The plane game: Dui, Lulu or Almendrita fly over a strip of hills while
 * mice drive towards the fish pantry at the left end, shooting at the plane. Stop them before
 * they get there.
 *
 * The physics lives in fisica-vuelo.ts (aerodynamics) and fisica-armas.ts
 * (missiles, bombs, blasts, vehicles); this file runs the rules, the waves
 * and the drawing. World units: x to the right, y is altitude (up), 1 unit =
 * 1 virtual pixel. The canvas is drawn at that resolution and upscaled by a
 * whole number so every pixel stays crisp.
 */

type Ctx = CanvasRenderingContext2D;

export type PlaneSpec = {
  id: ModeloAvion;
  pilot: string;
  name: string;
  blurb: string;
  hp: number;
  rack: number;
  reload: number;
  bombCd: number;
  bombs: number;
  /** Hit radius, px. */
  hit: number;
  stats: { velocidad: number; blindaje: number; misiles: number; bombas: number };
};

export const PLANES: PlaneSpec[] = [
  {
    id: 'avioneta',
    pilot: 'Lulu',
    name: 'Avioneta Mostaza',
    blurb: 'Lulu, la gatita negra de ojos amarillos. Ágil: gira cerrado y suelta bombas seguido.',
    hp: 4, rack: 3, reload: 1.2, bombCd: 0.5, bombs: 1, hit: 9,
    stats: { velocidad: 3, blindaje: 3, misiles: 3, bombas: 4 },
  },
  {
    id: 'caza',
    pilot: 'Dui',
    name: 'Caza Mandarina',
    blurb: 'Dui, el gato naranja. El más veloz: deja atrás a los misiles y dispara más.',
    hp: 3, rack: 5, reload: 0.85, bombCd: 0.9, bombs: 1, hit: 8,
    stats: { velocidad: 5, blindaje: 2, misiles: 5, bombas: 2 },
  },
  {
    id: 'bombardero',
    pilot: 'Almendrita',
    name: 'Bombardero Nube',
    blurb: 'Almendrita, la yorkshire. Lento pero blindado: suelta tres bombas de una vez.',
    hp: 6, rack: 2, reload: 1.7, bombCd: 0.9, bombs: 3, hit: 12,
    stats: { velocidad: 2, blindaje: 5, misiles: 2, bombas: 5 },
  },
];

export type Hud = {
  score: number;
  best: number;
  wave: number;
  hp: number;
  hpMax: number;
  meta: number;
  metaMax: number;
  ammo: number;
  rack: number;
  flares: number;
  flareMax: number;
  left: number;
  warn: boolean;
  banner: string;
};

export type Result = { pilot: string; score: number; best: number; wave: number; kills: number; reason: 'avion' | 'despensa'; record: boolean };

export type Controls = { x: number; y: number; gas: number; fire: boolean; bomb: boolean; flare: boolean };

/* ── The level ───────────────────────────────────────────────────────────── */

const LEVEL = 3600;
const PANTRY = { x0: 22, x1: 86 };
/** A vehicle that reaches this x gets into the pantry. */
const META_X = 98;
const META_MAX = 5;
const FLARE_MAX = 2;

const ground = (x: number) => {
  const hills = 28 + 8 * Math.sin(x / 170) + 4 * Math.sin(x / 53 + 2) + 1.5 * Math.sin(x / 23);
  // Flat around the pantry.
  const k = Math.min(1, Math.max(0, (x - 150) / 140));
  return 28 + (hills - 28) * k;
};

type VSpec = { speed: number; hp: number; masa: number; score: number; cd: number; color: string };
const VEH: Record<VehiculoTipo, VSpec> = {
  jeep: { speed: 30, hp: 1, masa: 1, score: 100, cd: 3.4, color: '#b49af4' },
  camion: { speed: 19, hp: 2, masa: 2, score: 150, cd: 4.6, color: '#b49af4' },
  tanque: { speed: 13, hp: 4, masa: 4, score: 250, cd: 2.8, color: '#b49af4' },
  sam: { speed: 11, hp: 3, masa: 2.5, score: 300, cd: 5.2, color: '#b49af4' },
};

/* Colors per sky theme (they change every wave). */
type Theme = 'dia' | 'tarde' | 'noche';
const THEMES: Theme[] = ['dia', 'tarde', 'noche'];
const SKY: Record<Theme, number[][]> = {
  dia: [[88, 168, 255], [112, 188, 255], [146, 210, 255], [186, 230, 255], [226, 246, 255]],
  tarde: [[150, 110, 220], [214, 128, 210], [255, 150, 170], [255, 188, 140], [255, 228, 160]],
  noche: [[28, 22, 84], [44, 36, 116], [66, 52, 146], [92, 72, 172], [124, 98, 196]],
};
const CLOUD: Record<Theme, [string, string, string]> = {
  dia: ['#ffffff', '#ffffff', '#6aaee8'],
  tarde: ['#fff0f4', '#ffffff', '#d07aaa'],
  noche: ['#9a8ad8', '#c8bcf4', '#4a3a96'],
};
const HILL_FAR: Record<Theme, string> = { dia: '#9ae0b4', tarde: '#e0a0c8', noche: '#5a4aa4' };
const HILL_NEAR: Record<Theme, string> = { dia: '#5cc87a', tarde: '#c47aa8', noche: '#46388a' };
const hillSamples = (seed: number, amp: number) => {
  const out = new Float32Array(512);
  for (let i = 0; i < 512; i++) out[i] = amp * (0.55 + 0.45 * Math.sin(i / 23 + seed) * Math.sin(i / 7.3 + seed * 2) + 0.3 * Math.sin(i / 51 + seed * 3));
  return out;
};
const HILLS_FAR = hillSamples(4, 60);
const HILLS_NEAR = hillSamples(7, 36);

/* ── Things in the world ─────────────────────────────────────────────────── */

type Car = Vehiculo & {
  kind: VehiculoTipo;
  hp: number;
  fireT: number;
  flash: number;
  wheel: number;
  aim: number;
  /** Centre of the hull, the point missiles steer to. */
  mid: Movil;
};
type Shot = { m: Misil; enemy: boolean; tgt: Movil | null; trail: number };
type Shell = Cuerpo & { fuse: number };
type Puff = Cuerpo & { r: number; life: number; dark: boolean };
type Shard = Cuerpo & { c: string };
type Crate = Cuerpo & { landed: number };
type Blast = { x: number; y: number; r: number; t: number; life: number };
type Pop = { x: number; y: number; t: number; text: string; c: string };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function readBest() {
  try {
    return Number(localStorage.getItem('vuelo-record')) || 0;
  } catch {
    return 0;
  }
}
function writeBest(v: number) {
  try {
    localStorage.setItem('vuelo-record', String(v));
  } catch {
    /* private mode */
  }
}

/* ── The game ────────────────────────────────────────────────────────────── */

export type Vuelo = ReturnType<typeof createVuelo>;

export function createVuelo(canvas: HTMLCanvasElement, box: HTMLElement, hooks: { onHud: (h: Hud) => void; onOver: (r: Result) => void }) {
  const g = canvas.getContext('2d')!;
  const view = { vw: 400, vh: 240, s: 2 };
  const strip = A.groundStrip(LEVEL, ground, PANTRY);
  const input: Controls = { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false };
  const keys = new Set<string>();

  const s = {
    mode: 'demo' as 'demo' | 'play' | 'over',
    paused: false,
    t: 0,
    spec: PLANES[0],
    plane: FV.nuevoAvion('avioneta', 240, 120, true) as Avion,
    hp: 0,
    inv: 0,
    dead: false,
    deadT: 0,
    ammo: 0,
    reloadT: 0,
    fireT: 0,
    bombT: 0,
    flares: FLARE_MAX,
    flareT: 0,
    flareCd: 0,
    flareWasDown: false,
    camX: 0,
    shake: 0,
    score: 0,
    best: readBest(),
    kills: 0,
    wave: 0,
    meta: META_MAX,
    queue: [] as VehiculoTipo[],
    spawnT: 0,
    phase: 'break' as 'break' | 'wave',
    breakT: 0,
    banner: '',
    warnT: 0,
    warn: false,
    overT: 0,
    reason: 'avion' as Result['reason'],
    cars: [] as Car[],
    shots: [] as Shot[],
    bombs: [] as Bomba[],
    shells: [] as Shell[],
    flareBodies: [] as Cuerpo[],
    puffs: [] as Puff[],
    shards: [] as Shard[],
    crates: [] as Crate[],
    blasts: [] as Blast[],
    pops: [] as Pop[],
    clouds: Array.from({ length: 12 }, (_, i) => ({ x: i * 160 + rand(0, 80), y: rand(0.45, 0.9), w: Math.round(rand(40, 76)), k: i * 7 + 3, v: rand(2, 6) })),
    hudKey: '',
    hudT: 0,
  };

  /* ── Sizing ── */

  function fit() {
    const cw = Math.max(1, box.clientWidth);
    const ch = Math.max(1, box.clientHeight);
    let sc = Math.max(1, Math.round(ch / 250));
    while (sc > 1 && cw / sc < 300) sc--;
    view.s = sc;
    view.vw = Math.ceil(cw / sc);
    view.vh = Math.ceil(ch / sc);
    canvas.width = view.vw;
    canvas.height = view.vh;
    canvas.style.width = `${view.vw * sc}px`;
    canvas.style.height = `${view.vh * sc}px`;
    g.imageSmoothingEnabled = false;
  }
  const ro = new ResizeObserver(fit);
  ro.observe(box);
  fit();

  // Room left at the top for the HUD chips, smaller on short (phone) screens.
  const ceiling = () => view.vh - A.DIRT - (view.vh < 220 ? 14 : 26);

  /* ── Sound: recorded samples placed in stereo, synth as a fallback ── */

  const panOf = (x: number) => clamp(((x - s.camX) / view.vw) * 2 - 1, -1, 1) * 0.7;
  const near = (x: number) => clamp(1 - Math.abs(x - (s.camX + view.vw / 2)) / (view.vw * 1.2), 0.15, 1);
  function fx(n: S.Muestra, synth: () => void, o: { vol?: number; rate?: number } = {}, x?: number) {
    const vol = (o.vol ?? 1) * (x === undefined ? 1 : near(x));
    if (!S.suena(n, { ...o, vol, pan: x === undefined ? 0 : panOf(x) })) synth();
  }
  const MOTOR: Record<ModeloAvion, S.Motor> = { avioneta: 'motor-avioneta', caza: 'motor-jet', bombardero: 'motor-bombardero' };
  const CRUISE: Record<ModeloAvion, number> = { avioneta: 100, caza: 150, bombardero: 85 };
  function engines() {
    const p = s.plane;
    const on = s.mode === 'play' && !s.paused && !s.dead;
    const id = s.spec.id;
    for (const m of Object.values(MOTOR)) if (m !== MOTOR[id]) S.motor(m, 0, 1);
    // The engine note rises with airspeed and throttle, like a real one.
    const v = Math.hypot(p.vx, p.vy);
    S.motor(MOTOR[id], on ? 0.32 + 0.3 * p.gas : 0, 0.8 + (v / CRUISE[id]) * 0.25 + p.gas * 0.15, panOf(p.x));
    let d = Infinity;
    for (const c of s.cars) d = Math.min(d, Math.abs(c.x - (s.camX + view.vw / 2)));
    S.motor('motor-tanque', on ? 0.35 * clamp(1 - d / (view.vw * 0.8), 0, 1) : 0, 0.9);
  }
  const toS = (alt: number) => view.vh - A.DIRT - alt;

  /* ── Starting and ending ── */

  function resetWorld() {
    s.cars = [];
    s.shots = [];
    s.bombs = [];
    s.shells = [];
    s.flareBodies = [];
    s.puffs = [];
    s.shards = [];
    s.crates = [];
    s.blasts = [];
    s.pops = [];
  }

  function start(id: ModeloAvion) {
    resetWorld();
    s.spec = PLANES.find((p) => p.id === id)!;
    s.plane = FV.nuevoAvion(id, 220, Math.min(130, ceiling() - 30), true);
    s.mode = 'play';
    s.hp = s.spec.hp;
    s.inv = 1.5;
    s.dead = false;
    s.ammo = s.spec.rack;
    s.reloadT = 0;
    s.fireT = 0;
    s.bombT = 0;
    s.flares = FLARE_MAX;
    s.flareT = 0;
    s.score = 0;
    s.kills = 0;
    s.wave = 0;
    s.meta = META_MAX;
    s.camX = 0;
    nextWave();
  }

  function demo() {
    resetWorld();
    s.mode = 'demo';
    s.dead = false;
    s.plane = FV.nuevoAvion('avioneta', 240, 120, true);
  }

  function nextWave() {
    s.wave++;
    s.queue = waveList(s.wave);
    s.phase = 'break';
    s.breakT = 2.6;
    s.banner = `Oleada ${s.wave}`;
    s.spawnT = 0;
  }

  function waveList(n: number): VehiculoTipo[] {
    const count = Math.min(26, 4 + n * 2);
    const w: Record<VehiculoTipo, number> =
      n === 1 ? { jeep: 0.7, camion: 0.3, tanque: 0, sam: 0 } :
      n === 2 ? { jeep: 0.45, camion: 0.35, tanque: 0.2, sam: 0 } :
      n === 3 ? { jeep: 0.35, camion: 0.35, tanque: 0.3, sam: 0 } :
      { jeep: 0.3, camion: 0.28, tanque: 0.24, sam: 0.18 };
    const out: VehiculoTipo[] = [];
    for (let i = 0; i < count; i++) {
      let r = Math.random();
      let k: VehiculoTipo = 'jeep';
      for (const kk of Object.keys(w) as VehiculoTipo[]) {
        r -= w[kk];
        if (r <= 0) {
          k = kk;
          break;
        }
      }
      out.push(k);
    }
    return out;
  }

  function gameOver(reason: Result['reason']) {
    if (s.mode !== 'play') return;
    s.mode = 'over';
    const record = s.score > s.best;
    if (record) {
      s.best = s.score;
      writeBest(s.best);
    }
    sfx.gameOver();
    hooks.onOver({ pilot: s.spec.pilot, score: s.score, best: s.best, wave: s.wave, kills: s.kills, reason, record });
  }

  /* ── Effects ── */

  function puff(x: number, y: number, r: number, dark: boolean, life = 1.2, vx = 0, vy = 0) {
    if (s.puffs.length > 260) s.puffs.shift();
    s.puffs.push({ x, y, vx, vy, t: 0, r, life, dark });
  }

  function pop(x: number, y: number, text: string, c: string = P.gold) {
    s.pops.push({ x, y, t: 0, text, c });
  }

  /**
   * A blast of the given energy. Blasts from the player hurt vehicles, blasts
   * from the mice hurt the plane, and every blast pushes everything nearby.
   */
  function blast(x: number, y: number, energy: number, from: 'jugador' | 'raton' | 'nadie', damage: number) {
    const ex = FA.explosion(energy);
    // Energies span 0.6 (flak) to 10 (bomb); effects scale with the cube root, like the blast.
    const size = Math.cbrt(energy);
    s.blasts.push({ x, y, r: Math.max(4, Math.round(ex.radio)), t: 0, life: 0.25 + size * 0.12 });
    for (const sh of FA.esquirlas(x, y, energy, Math.round(3 + size * 6), Math.random)) {
      if (s.shards.length > 200) s.shards.shift();
      s.shards.push({ ...sh, c: [P.gold, '#ff9a3c', '#8a7aa8', P.k1][Math.floor(Math.random() * 4)] });
    }
    for (let i = 0; i < 2 + size * 3; i++) puff(x + rand(-4, 4), y + rand(-2, 4), rand(2, 3) + size, true, rand(1, 1.8));
    s.shake = Math.min(6, s.shake + size * 1.5);
    fx(energy >= 3 ? 'explosion-grande' : 'explosion-chica', () => sfx.boom(energy >= 3), { vol: 0.35 + 0.2 * size, rate: rand(0.9, 1.1) }, x);
    for (const c of s.cars) {
      const d = Math.hypot(c.mid.x - x, c.mid.y - y);
      const imp = ex.impulso(d);
      if (imp > 0.5) FA.empujeVehiculo(c, ((c.mid.x - x) / (d || 1)) * imp, ((c.mid.y - y) / (d || 1)) * imp + imp * 0.5);
      if (from === 'jugador') {
        const dmg = damage * ex.dano(d);
        if (dmg >= 0.25) hurtCar(c, dmg);
      }
    }
    if (s.mode === 'play' && !s.dead) {
      const p = s.plane;
      const d = Math.hypot(p.x - x, p.y - y);
      const imp = ex.impulso(d);
      if (imp > 0.5) FV.empujar(p, s.spec.id, ((p.x - x) / (d || 1)) * imp, ((p.y - y) / (d || 1)) * imp);
      if (from === 'raton' && ex.dano(Math.max(0, d - s.spec.hit)) * damage >= 0.3) hurtPlane();
    }
  }

  function hurtCar(c: Car, dmg: number) {
    if (c.hp <= 0) return;
    c.hp -= dmg;
    c.flash = 0.12;
    if (c.hp > 0) return;
    const spec = VEH[c.kind];
    s.score += spec.score;
    s.kills++;
    pop(c.mid.x, c.mid.y + 14, `+${spec.score}`);
    // The wreck goes up a moment later: chain reactions are allowed.
    window.setTimeout(() => blast(c.mid.x, c.mid.y, FA.ENERGIA.vehiculo, 'jugador', 0.8), 60);
    if (Math.random() < 0.2) s.crates.push({ x: c.mid.x, y: c.mid.y + 6, vx: rand(-10, 10), vy: 70, t: 0, landed: 0 });
  }

  function hurtPlane() {
    if (s.inv > 0 || s.dead) return;
    s.hp--;
    s.inv = 1.4;
    s.shake = Math.min(7, s.shake + 4);
    fx('impacto', sfx.hurt, { vol: 0.8 });
    if (s.hp <= 0) {
      s.dead = true;
      s.deadT = 0;
    }
  }

  /* ── Firing ── */

  function firePlayer() {
    const p = s.plane;
    if (input.fire && s.ammo >= 1 && s.fireT <= 0) {
      const m = FA.misilJugador(p, s.wave);
      s.shots.push({ m, enemy: false, tgt: lockTarget()?.mid ?? null, trail: 0 });
      s.ammo--;
      s.fireT = 0.22;
      fx('misil', sfx.launch, { vol: 0.7, rate: rand(1, 1.15) });
    }
    if (input.bomb && s.bombT <= 0) {
      for (let i = 0; i < s.spec.bombs; i++) s.bombs.push(FA.soltarBomba(p, i));
      s.bombT = s.spec.bombCd;
      fx('bomba', sfx.bomb, { vol: 0.5 });
    }
    if (input.flare && !s.flareWasDown && s.flares > 0 && s.flareCd <= 0) {
      s.flares--;
      s.flareCd = 0.6;
      for (let i = 0; i < 3; i++) {
        const f = { x: p.x, y: p.y - 3, vx: p.vx * 0.5 + rand(-30, 30), vy: p.vy * 0.5 + rand(-10, 30), t: 0 };
        s.flareBodies.push(f);
        // Each seeker gets one look at each new flare: decoyed or not.
        for (const sh of s.shots) if (sh.enemy && sh.tgt === p && sh.m.guiado && FA.bengalaEngana(sh.m, f, p)) sh.tgt = f;
      }
      fx('bengalas', sfx.flare, { vol: 0.6 });
    }
    s.flareWasDown = input.flare;
  }

  /** The nearest vehicle ahead of the nose, if any: where missiles will go. */
  function lockTarget(): Car | null {
    const p = s.plane;
    const dir = Math.cos(p.rumbo) >= 0 ? 1 : -1;
    let best: Car | null = null;
    let bestScore = Infinity;
    for (const c of s.cars) {
      if (c.hp <= 0) continue;
      const dx = (c.mid.x - p.x) * dir;
      if (dx < -10 || dx > 320) continue;
      const score = dx + Math.abs(c.mid.y - p.y) * 0.4;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  function carFires(c: Car) {
    const p = s.plane;
    const lvl = s.wave;
    const ox = c.mid.x;
    const oy = c.y + 14;
    if (c.kind === 'jeep') {
      // Unguided rocket aimed ahead of the plane.
      const sol = FA.solucionTiro({ x: ox, y: oy }, 150, p, false);
      if (!sol) return;
      const m = FA.misilEnemigo(ox, oy, p, lvl);
      m.guiado = false;
      m.rumbo = Math.atan2(sol.vy, sol.vx);
      m.vx = sol.vx * 0.4;
      m.vy = sol.vy * 0.4;
      s.shots.push({ m, enemy: true, tgt: null, trail: 0 });
      FA.retroceso(c, m.rumbo, 4);
      fx('misil', sfx.enemyLaunch, { vol: 0.45, rate: 0.8 }, ox);
    } else if (c.kind === 'camion') {
      s.shots.push({ m: FA.misilEnemigo(ox, oy, p, lvl), enemy: true, tgt: p, trail: 0 });
      FA.retroceso(c, Math.PI / 2, 6);
      fx('misil', sfx.enemyLaunch, { vol: 0.45, rate: 0.8 }, ox);
    } else if (c.kind === 'sam') {
      for (const dv of [-0.3, 0.3]) s.shots.push({ m: FA.misilEnemigo(ox, oy + 4, p, lvl, dv), enemy: true, tgt: p, trail: 0 });
      FA.retroceso(c, Math.PI / 2, 8);
      fx('misil', sfx.enemyLaunch, { vol: 0.45, rate: 0.8 }, ox);
    } else {
      // Flak: a time-fused shell that bursts where the plane will be.
      const sol = FA.solucionTiro({ x: ox, y: oy }, FA.VEL_OBUS, p, true, FA.ARRASTRE_OBUS);
      if (!sol) return;
      s.shells.push({ x: ox, y: oy, vx: sol.vx, vy: sol.vy, t: 0, fuse: sol.tiempo });
      FA.retroceso(c, Math.atan2(sol.vy, sol.vx), 5);
      puff(ox, oy, 3, false, 0.5);
      fx('antiaereo', sfx.dig, { vol: 0.55, rate: rand(0.9, 1.1) }, ox);
    }
  }

  /* ── Simulation ── */

  function step(dt: number) {
    s.t += dt;
    const p = s.plane;
    const wind = FV.viento(s.t, p.x, p.y);
    const top = ceiling();

    // The plane: the player flies it; in the menu it flies itself.
    if (s.mode === 'demo') {
      const dir = p.x > LEVEL - 400 ? -1 : p.x < 300 ? 1 : Math.cos(p.rumbo) >= 0 ? 1 : -1;
      const ty = top * 0.6 + Math.sin(s.t * 0.6) * 25;
      FV.pasoAvion(p, 'avioneta', { x: dir, y: clamp((ty - p.y) / 40, -1, 1), gas: 0 }, dt, ground, top);
    } else if (!s.dead) {
      const mando: Mando = { x: input.x, y: input.y, gas: input.gas };
      for (const ev of FV.pasoAvion(p, s.spec.id, mando, dt, ground, top)) {
        if (ev.tipo === 'toqueSuelo' && ev.velocidad > 35 && s.mode === 'play') {
          hurtPlane();
          blast(p.x, p.y - 4, FA.ENERGIA.obus, 'nadie', 0);
        }
      }
      if (s.hp <= 1 && Math.random() < dt * 12) puff(p.x, p.y, 2, true, 1);
    } else {
      // Shot down: it tumbles and falls, trailing smoke.
      s.deadT += dt;
      p.vy -= FA.GRAVEDAD * dt;
      p.vx *= 1 - dt * 0.3;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rumbo -= dt * 4 * (p.vx >= 0 ? 1 : -1);
      if (Math.random() < dt * 30) puff(p.x, p.y, 3, true, 1.4);
      if (p.y <= ground(p.x) + 2 && s.overT === 0) {
        p.y = ground(p.x) + 2;
        p.vx = p.vy = 0;
        blast(p.x, p.y, FA.ENERGIA.vehiculo * 2, 'nadie', 0);
        s.overT = 1.4;
        s.reason = 'avion';
      }
    }
    p.x = clamp(p.x, 12, LEVEL - 12);
    if (s.overT > 0) {
      s.overT -= dt;
      if (s.overT <= 0) {
        s.overT = 0;
        gameOver(s.reason);
      }
    }

    if (s.mode === 'play' && !s.dead) {
      s.inv = Math.max(0, s.inv - dt);
      s.fireT -= dt;
      s.bombT -= dt;
      s.flareCd -= dt;
      if (s.ammo < s.spec.rack) {
        s.reloadT += dt;
        if (s.reloadT >= s.spec.reload) {
          s.ammo++;
          s.reloadT = 0;
        }
      }
      if (s.flares < FLARE_MAX) {
        s.flareT += dt;
        if (s.flareT >= 8) {
          s.flares++;
          s.flareT = 0;
        }
      }
      firePlayer();
    }

    // Waves.
    if (s.mode === 'play') {
      if (s.phase === 'break') {
        s.breakT -= dt;
        if (s.breakT <= 0) {
          s.phase = 'wave';
          s.banner = '';
        }
      } else {
        s.spawnT -= dt;
        if (s.queue.length && s.spawnT <= 0) {
          const kind = s.queue.shift()!;
          const v = FA.nuevoVehiculo(LEVEL + 20, ground, VEH[kind].masa);
          s.cars.push({
            ...v,
            kind,
            hp: VEH[kind].hp,
            fireT: VEH[kind].cd * rand(0.5, 1),
            flash: 0,
            wheel: 0,
            aim: -Math.PI * 0.75,
            mid: { x: v.x, y: v.y + 8, vx: 0, vy: 0 },
          });
          s.spawnT = Math.max(1.1, 4 - s.wave * 0.3) * rand(0.7, 1.3);
        }
        if (!s.queue.length && !s.cars.length && s.overT === 0) {
          const bonus = 250 * s.wave;
          s.score += bonus;
          if (s.hp < s.spec.hp && !s.dead) s.hp++;
          sfx.achievement();
          nextWave();
          s.banner = `¡Oleada ${s.wave - 1} superada! +${bonus}`;
          s.breakT = 3.4;
          window.setTimeout(() => {
            if (s.mode === 'play' && s.phase === 'break') s.banner = `Oleada ${s.wave}`;
          }, 1800);
        }
      }
    }

    // Vehicles: drive left, keep their distance, fire when the plane is near.
    const speedUp = Math.min(1.5, 1 + (s.wave - 1) * 0.05);
    s.cars.sort((a, b) => a.x - b.x);
    for (let i = 0; i < s.cars.length; i++) {
      const c = s.cars[i];
      const spec = VEH[c.kind];
      const look = A.VEH_LOOK[c.kind];
      let want = spec.speed * speedUp;
      const ahead = s.cars[i - 1];
      if (ahead && c.x - ahead.x < (look.w + A.VEH_LOOK[ahead.kind].w) / 2 + 8) want = Math.min(want, Math.max(0, -ahead.vx) * 0.9);
      const x0 = c.x;
      FA.pasoVehiculo(c, -want, dt, ground, look.w);
      c.wheel += Math.abs(c.x - x0);
      c.flash = Math.max(0, c.flash - dt);
      c.mid.x = c.x;
      c.mid.y = c.y + look.h / 2;
      c.mid.vx = c.vx;
      c.mid.vy = c.vy;
      const dx = p.x - c.x;
      const dy = p.y - (c.y + 14);
      if (c.kind === 'tanque') c.aim = -Math.atan2(dy, dx);
      const onScreen = c.x > s.camX - 10 && c.x < s.camX + view.vw + 10;
      if (s.mode === 'play' && !s.dead && onScreen && Math.abs(dx) < 300) {
        c.fireT -= dt;
        if (c.fireT <= 0) {
          carFires(c);
          c.fireT = Math.max(0.7, spec.cd * (1 - (s.wave - 1) * 0.04)) * rand(0.8, 1.2);
        }
      }
      if (c.x <= META_X && c.hp > 0) {
        c.hp = 0;
        c.x = -999;
        s.meta--;
        sfx.lose();
        s.shake = Math.min(6, s.shake + 3);
        pop(PANTRY.x1, ground(PANTRY.x1) + 40, '¡Se llevaron pescado!', P.red);
        if (s.meta <= 0 && s.overT === 0) {
          s.overT = 0.8;
          s.reason = 'despensa';
        }
      }
    }
    s.cars = s.cars.filter((c) => c.hp > 0);

    // Missiles.
    let warn = false;
    for (const sh of s.shots) {
      const m = sh.m;
      if (!sh.enemy && sh.tgt && !s.cars.some((c) => c.mid === sh.tgt)) sh.tgt = lockTarget()?.mid ?? null;
      const tgt = s.mode === 'play' || !sh.enemy ? sh.tgt : null;
      const res = FA.pasoMisil(m, s.dead && sh.tgt === s.plane ? null : tgt, dt, sh.enemy ? FA.MISIL_ENEMIGO(s.wave) : FA.MISIL_JUGADOR, ground);
      if (m.combustible > 0) {
        sh.trail -= dt;
        if (sh.trail <= 0) {
          sh.trail = 0.03;
          puff(m.x - Math.cos(m.rumbo) * 6, m.y - Math.sin(m.rumbo) * 6, 1.5, false, 0.7);
        }
      }
      if (res === 'suelo' || m.t > 8) {
        m.t = -1;
        blast(m.x, Math.max(m.y, ground(m.x)), sh.enemy ? FA.ENERGIA.misilEnemigo : FA.ENERGIA.misilJugador, sh.enemy ? 'raton' : 'jugador', sh.enemy ? 1 : 2.5);
        continue;
      }
      if (sh.enemy) {
        if (s.mode === 'play' && !s.dead) {
          const d = Math.hypot(m.x - p.x, m.y - p.y);
          if (d < s.spec.hit) {
            m.t = -1;
            blast(m.x, m.y, FA.ENERGIA.misilEnemigo, 'raton', 1);
            continue;
          }
          if (sh.tgt === p && d < 170 && m.guiado) warn = true;
        }
      } else {
        for (const c of s.cars) {
          const look = A.VEH_LOOK[c.kind];
          if (Math.abs(m.x - c.x) < look.w / 2 + 2 && m.y > c.y - 2 && m.y < c.y + look.h) {
            m.t = -1;
            blast(m.x, m.y, FA.ENERGIA.misilJugador, 'jugador', 2.5);
            break;
          }
        }
      }
    }
    s.shots = s.shots.filter((sh) => sh.m.t >= 0);
    if (warn) {
      s.warnT -= dt;
      if (s.warnT <= 0) {
        fx('alarma', sfx.warn, { vol: 0.3 });
        s.warnT = 0.6;
      }
    } else s.warnT = 0;
    s.warn = warn;

    // Bombs.
    for (const b of s.bombs) {
      FA.pasoBomba(b, dt, wind);
      let hit = b.y <= ground(b.x);
      for (const c of s.cars) {
        const look = A.VEH_LOOK[c.kind];
        if (Math.abs(b.x - c.x) < look.w / 2 && b.y < c.y + look.h && b.y > c.y) hit = true;
      }
      if (hit) {
        b.t = -1;
        blast(b.x, Math.max(b.y, ground(b.x)), FA.ENERGIA.bomba, 'jugador', 4);
      }
    }
    s.bombs = s.bombs.filter((b) => b.t >= 0 && b.x > 0 && b.x < LEVEL);

    // Flak shells burst when their fuse runs out.
    for (const sh of s.shells) {
      FA.pasoBalistico(sh, dt, FA.ARRASTRE_OBUS, wind);
      sh.t += dt;
      if (sh.t >= sh.fuse || sh.y <= ground(sh.x)) {
        sh.fuse = -1;
        blast(sh.x, sh.y, FA.ENERGIA.obus, 'raton', 1);
      }
    }
    s.shells = s.shells.filter((sh) => sh.fuse >= 0);

    // Flares, smoke, shards, crates.
    for (const f of s.flareBodies) {
      FV.pasoBengala(f, dt, wind);
      f.t += dt;
      if (Math.random() < dt * 20) puff(f.x, f.y, 1, false, 0.5);
    }
    s.flareBodies = s.flareBodies.filter((f) => f.t < 2.6 && f.y > ground(f.x));
    for (const h of s.puffs) {
      FA.pasoHumo(h, dt, wind);
      h.t += dt;
    }
    s.puffs = s.puffs.filter((h) => h.t < h.life);
    for (const e of s.shards) {
      FA.pasoEsquirla(e, dt, ground);
      e.t += dt;
    }
    s.shards = s.shards.filter((e) => e.t < 1.6);
    for (const c of s.crates) {
      c.t += dt;
      if (c.landed) c.landed += dt;
      else if (c.vy > 0) {
        c.vy -= FA.GRAVEDAD * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
      } else if (FV.pasoParacaidas(c, dt, wind, ground)) c.landed = 0.001;
      if (s.mode === 'play' && !s.dead && Math.hypot(c.x - p.x, c.y - p.y) < s.spec.hit + 6) {
        c.landed = 99;
        sfx.star();
        S.suena('recoger', { vol: 0.6 });
        if (s.hp < s.spec.hp) {
          s.hp++;
          pop(c.x, c.y + 10, '+1 vida', P.r2);
        } else {
          s.score += 200;
          pop(c.x, c.y + 10, '+200');
        }
      }
    }
    s.crates = s.crates.filter((c) => c.landed < 3);
    for (const b of s.blasts) b.t += dt;
    s.blasts = s.blasts.filter((b) => b.t < b.life);
    for (const q of s.pops) q.t += dt;
    s.pops = s.pops.filter((q) => q.t < 1.3);
    for (const c of s.clouds) c.x -= c.v * dt;

    // Camera: leads in the direction of flight.
    const lead = Math.cos(p.rumbo) * view.vw * 0.16;
    const want = clamp(p.x - view.vw / 2 + lead, 0, LEVEL - view.vw);
    s.camX += (want - s.camX) * Math.min(1, dt * 3);
    s.shake = Math.max(0, s.shake - dt * 14);
  }

  /* ── Drawing ── */

  function draw() {
    const { vw, vh } = view;
    const theme = THEMES[Math.max(0, s.wave - 1) % 3];
    const shx = s.shake > 0.3 ? Math.round(rand(-s.shake, s.shake)) : 0;
    const shy = s.shake > 0.3 ? Math.round(rand(-s.shake, s.shake)) : 0;
    const cam = Math.round(s.camX) - shx;
    const sx = (x: number) => Math.round(x - cam);
    const sy = (y: number) => Math.round(toS(y) + shy);

    // Sky, sun or moon, stars at night.
    const horizon = sy(18);
    const stops = SKY[theme];
    g.fillStyle = `rgb(${stops[0].join(',')})`;
    g.fillRect(0, 0, vw, vh);
    g.drawImage(D.sky(vw, stops), 0, horizon - SKY_H);
    if (theme === 'noche') {
      for (let i = 0; i < 40; i++) {
        const x = ((i * 97 + 13) % 997) / 997;
        const y = ((i * 61 + 7) % 991) / 991;
        if ((i + Math.floor(s.t * 2)) % 9 === 0) continue;
        g.fillStyle = i % 5 ? '#fff6d0' : '#ffffff';
        g.fillRect(Math.round(x * vw), Math.round(y * (horizon - 40)), 1, 1);
      }
      D.moon(g, vw * 0.8, 40);
    } else D.sun(g, vw * 0.78, theme === 'tarde' ? horizon - 50 : 44, s.t, false);

    // Clouds and two layers of hills with parallax.
    const [cf, cl, cs] = CLOUD[theme];
    for (const c of s.clouds) {
      const W = 12 * 160;
      const x = ((((c.x - s.camX * 0.25) % W) + W) % W) - 80;
      if (x > vw) continue;
      g.drawImage(D.cloud(c.k, c.w, cf, cl, cs), Math.round(x), Math.round(horizon - 40 - c.y * (horizon - 70)));
    }
    const hillLayer = (img: HTMLCanvasElement, off: number, base: number) => {
      const W = img.width;
      let x = -((Math.round(off) % W) + W) % W;
      for (; x < vw; x += W) g.drawImage(img, x, Math.round(base - img.height + 2));
    };
    hillLayer(D.hills(HILLS_FAR, HILL_FAR[theme], false), s.camX * 0.15, horizon);
    hillLayer(D.hills(HILLS_NEAR, HILL_NEAR[theme], true), s.camX * 0.35, horizon + 6);

    // Ground strip (painted once for the whole level) and the pantry's flag.
    g.drawImage(strip.canvas, cam, 0, vw, strip.canvas.height, 0, sy(strip.top), vw, strip.canvas.height);
    A.drawFlag(g, sx(PANTRY.x0 + 70), sy(ground(PANTRY.x0 + 70)), s.t);

    // Bomb sight: where a bomb dropped now would land.
    const p = s.plane;
    if (s.mode === 'play' && !s.dead) {
      const hit = FA.puntoImpacto(p, ground, FV.viento(s.t, p.x, p.y));
      const hx = sx(hit.x);
      const hy = sy(hit.y);
      if (hx > 0 && hx < vw && Math.floor(s.t * 4) % 2) {
        A.R(g, hx - 3, hy, 7, 1, P.red);
        A.R(g, hx, hy - 3, 1, 3, P.red);
      }
    }

    // Vehicles.
    for (const c of s.cars) {
      const x = sx(c.x);
      if (x < -40 || x > vw + 40) continue;
      A.drawVehicle(g, c.kind, x, sy(c.y + c.suspension), -c.angulo, c.wheel, c.aim, s.t, c.flash > 0);
    }
    const lock = s.mode === 'play' && !s.dead ? lockTarget() : null;
    if (lock) A.drawLock(g, sx(lock.mid.x), sy(lock.mid.y), 14, s.t);

    // Crates, smoke, flares, bombs, shells, missiles.
    for (const c of s.crates) A.drawCrate(g, sx(c.x), sy(c.y), Math.sin(c.t * 2.5), !c.landed && c.vy <= 0);
    for (const h of s.puffs) A.drawPuff(g, sx(h.x), sy(h.y), h.r, h.dark, 1 - h.t / h.life);
    for (const f of s.flareBodies) A.drawFlare(g, sx(f.x), sy(f.y), s.t);
    for (const b of s.bombs) A.drawBomb(g, sx(b.x), sy(b.y), -b.rumbo);
    for (const sh of s.shells) A.drawShell(g, sx(sh.x), sy(sh.y));
    for (const sh of s.shots) A.drawMissile(g, sx(sh.m.x), sy(sh.m.y), -sh.m.rumbo, sh.enemy, sh.m.combustible > 0, s.t);

    // The plane.
    const blink = s.inv > 0 && Math.floor(s.t * 14) % 2 === 0;
    if (!(s.dead && s.overT > 0 && s.overT < 1.3)) A.drawPlane(g, s.mode === 'demo' ? 'avioneta' : s.spec.id, sx(p.x), sy(p.y), -p.rumbo, p.alabeo, s.t, p.gas, blink);

    // Blasts and shards on top.
    for (const e of s.shards) A.R(g, sx(e.x), sy(e.y), 2, 2, e.c);
    for (const b of s.blasts) A.drawBlast(g, sx(b.x), sy(b.y), b.r, b.t / b.life);

    // Floating score text.
    g.font = 'bold 9px "Fredoka", "Nunito", sans-serif';
    g.textAlign = 'center';
    for (const q of s.pops) {
      const x = sx(q.x);
      const y = sy(q.y + q.t * 18);
      g.fillStyle = '#3a2a6a';
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillText(q.text, x + dx, y + dy);
      g.fillStyle = q.c;
      g.fillText(q.text, x, y);
    }

    // Missile warnings at the edge of the screen.
    if (s.mode === 'play' && !s.dead && Math.floor(s.t * 8) % 2) {
      for (const sh of s.shots) {
        if (!sh.enemy || sh.tgt !== p) continue;
        const x = sx(sh.m.x);
        const y = sy(sh.m.y);
        if (x >= 0 && x < vw && y >= 0 && y < vh) continue;
        const cx = clamp(x, 6, vw - 7);
        const cy = clamp(y, 30, vh - A.DIRT - 6);
        D.disc(g, cx, cy, 4, P.red0);
        D.disc(g, cx, cy, 3, P.red);
        A.R(g, cx, cy - 2, 1, 3, P.white);
        A.R(g, cx, cy + 2, 1, 1, P.white);
      }
    }

    // Radar along the bottom: the pantry, the mice, the plane and the view.
    const rx = 8;
    const rw = vw - 16;
    const ry = vh - 9;
    const at = (x: number) => rx + Math.round((x / LEVEL) * rw);
    g.globalAlpha = 0.55;
    A.R(g, rx - 1, ry - 2, rw + 2, 7, '#3a2a6a');
    g.globalAlpha = 1;
    A.R(g, at(s.camX), ry - 2, Math.max(2, Math.round((vw / LEVEL) * rw)), 7, 'rgba(255,255,255,0.25)');
    A.R(g, at(PANTRY.x0), ry - 1, 4, 5, P.b2);
    for (const c of s.cars) A.R(g, at(c.x), ry, 2, 3, P.p1);
    for (const sh of s.shots) if (sh.enemy) A.R(g, at(sh.m.x), ry - 1, 1, 1, P.red);
    A.R(g, at(p.x) - 1, ry, 3, 3, P.gold);
  }

  /* ── HUD ── */

  function hud() {
    const h: Hud = {
      score: s.score,
      best: s.best,
      wave: s.wave,
      hp: s.hp,
      hpMax: s.spec.hp,
      meta: s.meta,
      metaMax: META_MAX,
      ammo: s.ammo,
      rack: s.spec.rack,
      flares: s.flares,
      flareMax: FLARE_MAX,
      left: s.queue.length + s.cars.length,
      warn: s.warn,
      banner: s.mode === 'play' ? s.banner : '',
    };
    const key = JSON.stringify(h);
    if (key !== s.hudKey) {
      s.hudKey = key;
      hooks.onHud(h);
    }
  }

  /* ── Keyboard ── */

  const CODES: Record<string, string> = {
    ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd',
    Space: 'fire', KeyJ: 'fire', KeyK: 'bomb', KeyL: 'flare', ShiftLeft: 'gas', ShiftRight: 'gas',
  };
  const touch = { x: 0, y: 0, gas: 0, fire: false, bomb: false, flare: false };
  function syncInput() {
    const kx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
    const ky = (keys.has('u') ? 1 : 0) - (keys.has('d') ? 1 : 0);
    input.x = kx || touch.x;
    input.y = ky || touch.y;
    input.gas = keys.has('gas') ? 1 : touch.gas;
    input.fire = keys.has('fire') || touch.fire;
    input.bomb = keys.has('bomb') || touch.bomb;
    input.flare = keys.has('flare') || touch.flare;
  }
  const onKey = (e: KeyboardEvent) => {
    const k = CODES[e.code];
    if (!k || s.mode !== 'play') return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    e.preventDefault();
    if (e.type === 'keydown') keys.add(k);
    else keys.delete(k);
    syncInput();
  };
  const onBlur = () => {
    keys.clear();
    syncInput();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);

  /* ── Loop ── */

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!s.paused) {
      // Small fixed-ish substeps keep fast missiles from tunnelling.
      const n = Math.ceil(dt / (1 / 120));
      dt /= n;
      for (let i = 0; i < n; i++) step(dt);
    }
    draw();
    s.hudT -= dt;
    if (s.hudT <= 0) {
      s.hudT = 0.08;
      hud();
      engines();
    }
  };
  raf = requestAnimationFrame(frame);

  if (import.meta.env.DEV) (window as unknown as { __vuelo: unknown }).__vuelo = { s, input, view };

  return {
    start,
    demo,
    /** Touch controls write here; the keyboard is merged in. */
    touch(t: Partial<typeof touch>) {
      Object.assign(touch, t);
      syncInput();
    },
    setPaused(p: boolean) {
      s.paused = p;
      if (p) onBlur();
    },
    destroy() {
      cancelAnimationFrame(raf);
      S.pararMotores();
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    },
  };
}

export { A as dibujo };
