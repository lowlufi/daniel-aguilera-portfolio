import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameEvents, GameStore } from './store';
import { sfx } from './audio';
import { atmo, css, stepAtmosphere, type WeatherId } from './weather';
import { CAMPFIRE, LANTERNS, drawGrade, drawMotes, glow, moodFor, spawnMotes, stepMotes, type Mote } from './ambiente';
import {
  CAVES,
  DANIEL,
  DOCK_END,
  GARDEN,
  GARDEN_PLOTS,
  HOUSE,
  INTERACTABLES,
  ISLAND_X0,
  ISLAND_X1,
  MAILBOX,
  PLAZA,
  PROJECT_SIGNS,
  SEA_LEVEL,
  STAR_SPOTS,
  STATION,
  SURFACE,
  T,
  TREES,
  Vec3,
  WELCOME,
  WORKSHOP,
  WORLD_H,
  WORLD_W,
  idx,
  inIsland,
  isDiggableTile,
  solidAt,
  tileAt,
  tiles,
  type InteractableId,
} from './world';
import { PAL } from './sprites';
import {
  CHUNK,
  CHUNK_RES,
  INK,
  TILE,
  crayonBoard,
  crayonCampfire,
  crayonCloud,
  crayonDaniel,
  crayonDui,
  crayonGear,
  crayonGrass,
  crayonHeart,
  crayonHills,
  crayonLantern,
  crayonMailbox,
  crayonMoon,
  crayonPlant,
  crayonSign,
  crayonStar,
  crayonStation,
  crayonSun,
  crayonWelcome,
  dot,
  grain,
  hatch,
  paintChunk,
  paper,
  type DuiPose,
} from './crayon';

/*
 * The island as a side-scrolling world of blocks, drawn in crayon on a
 * sketchbook page (crayon.ts). Physics and blocks are Terraria-like; the look
 * is hand-drawn.
 *
 * Everything is drawn on a small canvas (one unit = one virtual pixel) and
 * upscaled by a whole number with nearest-neighbour, so the pixel art stays
 * crisp and a phone pushes a few hundred thousand pixels per frame, not
 * millions. The ground is painted once into an off-screen canvas the size of
 * the world and copied each frame; only tiles that change (cut grass, dug
 * blocks) are repainted.
 *
 * It keeps the contract the earlier scenes had with IslandGame (store +
 * events): the notebook, dialogs, stamps, stars and achievements don't know
 * the island went 2D.
 */

type Props = {
  store: GameStore;
  events: MutableRefObject<GameEvents>;
  onWalkTo: (id: InteractableId) => void;
  weather: WeatherId;
  reduceMotion: boolean;
  paused: boolean;
};

// Dui's hitbox, in tiles: a long cat, one block tall.
const HW = 0.62;
const H = 0.95;
const GRAVITY = 36;
// Almost three blocks high: the hills have two-block steps here and there.
const JUMP_V = -14.4;
const WALK = 5.4;
const RUN = 8.4;
const MAX_FALL = 24;
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;
const IDLE_HINT_AFTER = 8;
const SIT_AFTER = 4;
const SLEEP_AFTER = 20;
const REGROW_AFTER = 45;
const REFILL_AFTER = 60;
// Seconds standing still underground before Dui digs his own way up.
const BURROW_AFTER = 6;

// How dark each weather is at ground level; caves add their own darkness.
const DARK: Record<WeatherId, number> = { soleado: 0, atardecer: 0.1, lluvia: 0.22, niebla: 0.12, noche: 0.62, nieve: 0.06 };

const MUTTERS = ['¡hola!', '¿café?', 'compilando…', '¡Dui, ven!', 'npm run dev', 'ya casi…', '¿y si lo hago en Rust?', 'commit y a dormir', 'funciona en mi PC', '¡miau también!'];

type Label = { text: string; x: number; z: number; goal?: InteractableId; nearOnly?: number; tone: 'cream' | 'orange' };
const LABELS: Label[] = [
  { text: 'Casa de Daniel', x: HOUSE.x, z: SURFACE[HOUSE.x] - HOUSE.h - 4.2, tone: 'cream' },
  { text: 'Taller', x: WORKSHOP.x, z: SURFACE[WORKSHOP.x] - WORKSHOP.h - 4.2, tone: 'cream' },
  { text: '📌 Proyectos', x: PLAZA.x, z: PLAZA.z - 2, goal: 'board', tone: 'orange' },
  { text: '🌻 Huerto de habilidades', x: GARDEN.x, z: GARDEN.z - 2.4, goal: 'garden', tone: 'orange' },
  { text: '✉️ Buzón', x: MAILBOX.x, z: MAILBOX.z - 1.8, goal: 'mailbox', tone: 'orange' },
  { text: '👋 ¡Bienvenid@!', x: WELCOME.x, z: WELCOME.z - 1.5, goal: 'welcome', tone: 'cream' },
  { text: '💬 Daniel', x: DANIEL.x, z: DANIEL.z - 2.3, goal: 'daniel', tone: 'orange' },
  { text: '📡 Estación ESP32', x: STATION.x, z: STATION.z - 2.6, tone: 'cream' },
  { text: '🌊 Muelle', x: DOCK_END.x, z: DOCK_END.z - 0.9, nearOnly: 5, tone: 'cream' },
  ...PROJECT_SIGNS.map((s) => ({ text: s.project.title, x: s.x, z: s.z - 1.5, nearOnly: 2.6, tone: 'cream' as const })),
];

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; kind: 'px' | 'heart' | 'z' | 'smoke' | 'petal'; c: string; s: number; g: number };
type Drop = { x: number; y: number; v: number; k: number };

const WINDOWS: { x: number; y: number }[] = [];
const CHIMNEYS: { x: number; y: number }[] = [];
for (let y = 0; y < WORLD_H; y++)
  for (let x = 0; x < WORLD_W; x++) {
    const t = tiles[idx(x, y)];
    if (t === T.WINDOW) WINDOWS.push({ x, y });
    if (t === T.CHIMNEY && tiles[idx(x, y - 1)] !== T.CHIMNEY) CHIMNEYS.push({ x, y });
  }

// Row of the water surface in each column (-1 when dry). Water never changes
// (paws can't dig it), so this replaces a tileAt() scan per visible column.
const WATER_TOP = new Int16Array(WORLD_W).fill(-1);
for (let x = 0; x < WORLD_W; x++)
  for (let y = SEA_LEVEL - 4; y < SEA_LEVEL + 3; y++)
    if (tiles[idx(x, y)] === T.WATER && tiles[idx(x, y - 1)] !== T.WATER && tiles[idx(x, y - 1)] !== T.POST) {
      WATER_TOP[x] = y;
      break;
    }

let lampCache: HTMLCanvasElement | null = null;
/** A radial falloff, opaque at the centre: punched out of the darkness layer. */
function lampSprite() {
  if (lampCache) return lampCache;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(0,0,0,1)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  lampCache = c;
  return c;
}

// Top-left block of each 2x2 window, for the evening glow.
const WINDOW_BLOCKS = WINDOWS.filter((w) => !WINDOWS.some((o) => (o.x === w.x - 1 && o.y === w.y) || (o.x === w.x && o.y === w.y - 1)));

/* Crayon colors per weather: the page tint, the sky scribble, clouds, hills. */
const PAGE_TINT: Record<WeatherId, string | null> = {
  soleado: null,
  atardecer: 'rgba(255,170,120,0.16)',
  lluvia: 'rgba(110,130,160,0.22)',
  niebla: 'rgba(225,225,232,0.28)',
  noche: 'rgba(30,40,95,0.5)',
  nieve: 'rgba(220,235,255,0.18)',
};
const SKY_CRAYON: Record<WeatherId, string | null> = {
  soleado: '#6fb4ee',
  atardecer: '#f2895a',
  lluvia: '#7d8ea8',
  niebla: null,
  noche: '#3a4a9a',
  nieve: '#a9c8ee',
};
const CLOUD_FILL: Record<WeatherId, string> = { soleado: '#ffffff', atardecer: '#ffd2b8', lluvia: '#a8b2c2', niebla: '#e8e8ee', noche: '#6a74a8', nieve: '#f4f8ff' };
const CLOUD_LINE: Record<WeatherId, string> = { soleado: '#7fa6d0', atardecer: '#d07a6a', lluvia: '#5f6b80', niebla: '#a8a8b8', noche: '#3a4478', nieve: '#9ab4d8' };
const HILL_FAR: Record<WeatherId, string> = { soleado: '#9cc7a0', atardecer: '#c98aa0', lluvia: '#8a9aa8', niebla: '#c8c8d0', noche: '#4a5288', nieve: '#c8d8e8' };
const HILL_NEAR: Record<WeatherId, string> = { soleado: '#6faa6a', atardecer: '#a87a8a', lluvia: '#6f8a7a', niebla: '#b0b4bc', noche: '#3a4478', nieve: '#a8c0d0' };

// Distant hills behind the island, two layers of parallax.
const hills = (seed: number, amp: number) => {
  const out = new Float32Array(512);
  for (let i = 0; i < 512; i++) out[i] = amp * (0.55 + 0.45 * Math.sin(i / 23 + seed) * Math.sin(i / 7.3 + seed * 2) + 0.3 * Math.sin(i / 51 + seed * 3));
  return out;
};
const HILLS_FAR = hills(1, 70);
const HILLS_NEAR = hills(2, 42);
const SKY_STARS = (() => {
  const out: { x: number; y: number; k: number }[] = [];
  let a = 17;
  for (let i = 0; i < 80; i++) {
    a = (a * 9301 + 49297) % 233280;
    const x = a / 233280;
    a = (a * 9301 + 49297) % 233280;
    const y = a / 233280;
    out.push({ x, y: y * 0.85, k: i });
  }
  return out;
})();
const CLOUDS = (() => {
  const out: { x: number; y: number; w: number; parts: [number, number, number, number][] }[] = [];
  let a = 5;
  const r = () => ((a = (a * 9301 + 49297) % 233280), a / 233280);
  for (let i = 0; i < 9; i++) {
    const w = 24 + Math.floor(r() * 40);
    const parts: [number, number, number, number][] = [];
    for (let k = 0; k < 4; k++) parts.push([Math.floor(r() * (w - 10)), -2 - Math.floor(r() * 6), 10 + Math.floor(r() * 14), 4 + Math.floor(r() * 5)]);
    out.push({ x: r() * 2200, y: 40 + r() * 130, w, parts });
  }
  return out;
})();

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Columns whose surface block can't be dug: what stands on them (Daniel, the
// signs, the trees) is drawn at a fixed height and would float over a hole.
const KEEP_GROUND = new Set<number>();
for (const it of INTERACTABLES) if (it.id !== 'dock' && it.id !== 'garden') for (let d = -1; d <= 1; d++) KEEP_GROUND.add(Math.round(it.x) + d);
for (const tr of TREES) KEEP_GROUND.add(tr.x);

export default function PixelScene({ store, events, onWalkTo, weather, reduceMotion, paused }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const props = useRef({ weather, reduceMotion, onWalkTo });
  props.current = { weather, reduceMotion, onWalkTo };

  const view = useRef({ cssW: 0, cssH: 0, dpr: 1, scale: 3, r: 2, vw: 320, vh: 240, camX: 0, camY: 0, camPx: 0, camPy: 0 });

  const sim = useRef({
    time: 0,
    vx: 0,
    vy: 0,
    facing: 1 as 1 | -1,
    onGround: false,
    wasOnGround: false,
    inWater: false,
    // Seconds since Dui was last in the water: a jump is still allowed then,
    // so climbing out onto the shore works.
    wet: 0,
    coyote: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    // A jump Dui decided on his own (a step in the way) is never cut short.
    autoJumping: false,
    climbing: false,
    lift: 0,
    phase: 0,
    amt: 0,
    still: 0,
    blinkT: 2,
    blink: 0,
    squish: 0,
    tail: 0,
    stuck: { t: 0, d: Infinity, z: 0, target: null as Vec3 | null },
    idle: 0,
    nearT: 0,
    lastStep: 0,
    cut: new Map<number, number>(),
    dug: new Map<number, { t: number; time: number }>(),
    stars: STAR_SPOTS.map((_, i) => ({ revealed: store.starsTaken.has(i), taken: store.starsTaken.has(i), t: 0 })),
    particles: [] as Particle[],
    motes: [] as Mote[],
    sparkT: 0,
    lastDraw: 0,
    drops: [] as Drop[],
    flies: [] as { x: number; y: number; k: number }[],
    smokeT: 0,
    dark: 0,
    under: 0,
    daniel: { wave: 0, waveT: 6, blink: 0, blinkT: 3, mutter: '', mutterT: 5, mutterUntil: 0 },
    labelEls: [] as HTMLDivElement[],
    bubbleEl: null as HTMLDivElement | null,
    // Ground painted in crayon, by 8x8-block chunks, most recently used last.
    chunks: new Map<number, HTMLCanvasElement>(),
    layer: null as HTMLCanvasElement | null,
    grainPattern: null as CanvasPattern | null,
    light: null as HTMLCanvasElement | null,
  });

  /* ── Terrain: painted once, repainted where it changes ───────────────── */

  const paintRegion = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    // Forget the chunks this touches (plus a block around: edges are drawn
    // from both sides); they are repainted the next time they're on screen.
    const s = sim.current;
    for (let cy = Math.floor((y0 - 1) / CHUNK); cy <= Math.floor((y1 + 1) / CHUNK); cy++)
      for (let cx = Math.floor((x0 - 1) / CHUNK); cx <= Math.floor((x1 + 1) / CHUNK); cx++) s.chunks.delete(cy * 1000 + cx);
  }, []);

  useEffect(() => {
    const s = sim.current;
    s.layer = document.createElement('canvas');
    s.light = document.createElement('canvas');
    s.chunks.clear();
    store.grassTotal = 0;
    for (let x = 0; x < WORLD_W; x++) if (tiles[idx(x, SURFACE[x] - 1)] === T.TALLGRASS) store.grassTotal++;
    return () => {
      // Dug blocks go back: the world array is shared by every mount.
      for (const [i, d] of s.dug) tiles[i] = d.t;
      s.dug.clear();
    };
  }, [paintRegion, store]);

  /* ── Hooks the UI calls into ─────────────────────────────────────────── */

  const spawn = useCallback((p: Omit<Particle, 'max'>) => {
    const s = sim.current;
    if (s.particles.length > 400) s.particles.shift();
    s.particles.push({ ...p, max: p.life });
  }, []);

  useEffect(() => {
    const s = sim.current;
    const R = Math.random;
    store.cutAt = (x, z, r) => {
      let n = 0;
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (tx < 0 || tx >= WORLD_W) continue;
        const ty = SURFACE[tx] - 1;
        const i = idx(tx, ty);
        if (tiles[i] !== T.TALLGRASS || s.cut.has(i)) continue;
        if ((tx + 0.5 - x) ** 2 + (ty + 0.5 - (z - 0.5)) ** 2 > r * r) continue;
        s.cut.set(i, s.time);
        paintRegion(tx, ty, tx, ty);
        n++;
        for (let k = 0; k < 3; k++) spawn({ x: tx + 0.5, y: ty + 0.6, vx: (R() - 0.5) * 4, vy: -3 - R() * 3, life: 0.6, kind: 'px', c: k ? PAL.grassLight : PAL.grass, s: 1, g: 20 });
      }
      return n;
    };
    store.revealAt = (x, z, r) => {
      s.stars.forEach((st, i) => {
        if (st.revealed) return;
        const p = STAR_SPOTS[i];
        if ((p.x + 0.5 - x) ** 2 + (p.z - 0.5 - z) ** 2 < (r + 0.5) ** 2) {
          st.revealed = true;
          st.t = 0;
          sfx.reveal();
          events.current.onStarRevealed();
        }
      });
    };
    store.burst = (kind, x, z) => {
      const still = props.current.reduceMotion;
      if (kind === 'hearts') {
        for (let k = 0; k < (still ? 3 : 7); k++) spawn({ x: x + (R() - 0.5) * 1.2, y: z - 1 - R() * 0.4, vx: (R() - 0.5) * 1.5, vy: -2.5 - R() * 2, life: 1.1, kind: 'heart', c: k % 2 ? '#ff7a9a' : '#ffb3c6', s: 1, g: 2 });
      } else if (kind === 'water') {
        for (let k = 0; k < (still ? 12 : 45); k++) spawn({ x: x + (R() - 0.5) * 12, y: z - 5 - R() * 2, vx: 0, vy: 4 + R() * 3, life: 1.2, kind: 'px', c: k % 2 ? '#7fd3ff' : '#bfeaff', s: 1, g: 6 });
      } else if (kind === 'harvest') {
        const veg = [PAL.carrot, PAL.tomato, PAL.sunflower, PAL.cabbage];
        for (let k = 0; k < (still ? 8 : 26); k++) spawn({ x: x + (R() - 0.5) * 10, y: z - 0.4, vx: (R() - 0.5) * 5, vy: -5 - R() * 4, life: 1.4, kind: 'px', c: veg[k % 4], s: 2, g: 18 });
      } else {
        const party = ['#ff6b9a', '#ffd23f', '#7ccf8a', '#7fc4ff', '#b28ee0', '#ff9a3c'];
        for (let k = 0; k < (still ? 20 : 90); k++) spawn({ x: x + (R() - 0.5) * 18, y: z - 8 - R() * 6, vx: (R() - 0.5) * 2, vy: 1 + R() * 2, life: 4, kind: 'px', c: party[k % 6], s: 2, g: 1.5 });
      }
    };
  }, [store, events, paintRegion, spawn]);

  /* ── Fit the canvas: whole-number upscale of a small frame ───────────── */

  const fit = useCallback(() => {
    const c = canvasRef.current;
    const box = c?.parentElement;
    if (!c || !box) return;
    const v = view.current;
    const cssW = box.clientWidth;
    const cssH = box.clientHeight;
    if (!cssW || !cssH) return;
    // The real ratio, not capped at 2: the virtual frame is the same size
    // either way (about `tilesWide` tiles across), and capping it made each
    // virtual pixel 4.5 device pixels on a 3x phone, so the pixel art came
    // out uneven and Dui shrank to 16 CSS px on a 320 px screen.
    const dpr = Math.min(window.devicePixelRatio || 1, 4);
    // Fewer tiles across on a phone, so Dui and the blocks stay chunky.
    const tilesWide = cssW < 700 ? 17 : cssW < 1100 ? 28 : 38;
    // A short viewport (a phone held sideways) would get only ~12 rows of
    // blocks, a third of them under the HUD: cap the scale so 16 rows fit.
    const scale = Math.max(2, Math.min(Math.round((cssW * dpr) / (tilesWide * TILE)), Math.floor((cssH * dpr) / (16 * TILE))));
    v.cssW = cssW;
    v.cssH = cssH;
    v.dpr = dpr;
    v.scale = scale;
    v.vw = Math.ceil((cssW * dpr) / scale);
    v.vh = Math.ceil((cssH * dpr) / scale);
    // Crayon lines want real resolution, not upscaled pixels. The backing
    // store is capped (2 on phones, 3 elsewhere): enough for soft wax lines,
    // and a phone doesn't push 3M pixels per frame.
    const r = Math.min(scale, cssW < 700 ? 2 : 3);
    // Chunks are painted at this resolution: a new one means repainting them.
    if (r !== v.r) sim.current.chunks.clear();
    v.r = r;
    c.width = Math.ceil(v.vw * v.r);
    c.height = Math.ceil(v.vh * v.r);
    c.style.width = `${(v.vw * scale) / dpr}px`;
    c.style.height = `${(v.vh * scale) / dpr}px`;
    const s = sim.current;
    if (s.layer) {
      s.layer.width = c.width;
      s.layer.height = c.height;
    }
    if (s.light) {
      s.light.width = v.vw;
      s.light.height = v.vh;
    }
    if (import.meta.env.DEV) Object.assign(window as object, { __pixel: v, __pixelSim: sim.current, __pixelSpots: STAR_SPOTS, __pixelVec: Vec3, __pixelTile: tileAt });
  }, []);

  useEffect(() => {
    fit();
    const box = canvasRef.current?.parentElement;
    const ro = new ResizeObserver(fit);
    if (box) ro.observe(box);
    return () => ro.disconnect();
  }, [fit]);

  /* ── Labels: one DOM layer, repositioned every frame ─────────────────── */

  useEffect(() => {
    const root = labelsRef.current;
    if (!root) return;
    const s = sim.current;
    s.labelEls = LABELS.map((l) => {
      const el = document.createElement('div');
      el.textContent = l.text;
      // The thin dark ring keeps the cream box visible on a pale sky (clear
      // day, fog), where box and sky measured under 1.5:1.
      el.className = `absolute left-0 top-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[15px] leading-none text-[#4a4038] shadow-[0_3px_0_rgba(91,70,54,0.2)] ring-1 ring-[#5b4636]/40 ${
        l.tone === 'orange' ? 'bg-[#ffe3a3]/95' : 'bg-[#fff8e7]/95'
      }`;
      el.style.display = 'none';
      root.appendChild(el);
      return el;
    });
    const bubble = document.createElement('div');
    bubble.className = 'absolute left-0 top-0 whitespace-nowrap rounded-2xl rounded-bl-sm bg-[#fff8e7] px-2.5 py-1 text-[15px] leading-none text-[#4a4038] shadow-[0_3px_0_rgba(91,70,54,0.2)] ring-1 ring-[#5b4636]/40';
    bubble.style.display = 'none';
    root.appendChild(bubble);
    s.bubbleEl = bubble;
    return () => {
      root.replaceChildren();
      s.labelEls = [];
      s.bubbleEl = null;
    };
  }, []);

  /* ── The loop ────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let last = performance.now();
    const s = sim.current;
    const v = view.current;
    atmo.target = props.current.weather;
    stepAtmosphere(1);
    s.dark = DARK[props.current.weather];

    const collide = (x: number, z: number) => {
      const x0 = Math.floor(x - HW);
      const x1 = Math.floor(x + HW - 1e-4);
      const y0 = Math.floor(z - H);
      const y1 = Math.floor(z - 1e-4);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) return true;
      return false;
    };
    // A wall touching either side of Dui's body (not just his feet).
    const wallBeside = (x: number, z: number) => {
      const y0 = Math.floor(z - H);
      const y1 = Math.floor(z - 0.2);
      // Reach of almost a block: in a shaft three blocks wide Dui, standing in
      // the middle, touches neither wall, and could never climb out.
      for (const side of [x - HW - 0.9, x + HW + 0.9]) for (let ty = y0; ty <= y1; ty++) if (solidAt(Math.floor(side), ty)) return true;
      return false;
    };
    const groundBelow = (x: number, z: number) => {
      const ty = Math.floor(z + 0.02);
      for (let tx = Math.floor(x - HW); tx <= Math.floor(x + HW - 1e-4); tx++) if (solidAt(tx, ty)) return true;
      return false;
    };
    const dig = (tx: number, ty: number) => {
      const i = idx(tx, ty);
      const t = tiles[i];
      if (!isDiggableTile(t)) return false;
      // The ground under Daniel, the signs and the trees stays: they're drawn
      // at a fixed height and would hover over the hole.
      if (ty === SURFACE[tx] && KEEP_GROUND.has(tx)) return false;
      tiles[i] = T.AIR;
      s.dug.set(i, { t, time: s.time });
      // Tall grass standing on this block has nothing to stand on.
      const above = idx(tx, ty - 1);
      if (tiles[above] === T.TALLGRASS || tiles[above] === T.FLOWER) tiles[above] = T.AIR;
      paintRegion(tx - 1, ty - 2, tx + 1, ty + 1);
      const R = Math.random;
      for (let k = 0; k < (props.current.reduceMotion ? 3 : 7); k++)
        spawn({ x: tx + 0.5, y: ty + 0.5, vx: (R() - 0.5) * 5, vy: -3 - R() * 4, life: 0.7, kind: 'px', c: t === T.SAND ? PAL.sandDark : k & 1 ? PAL.dirtDark : PAL.dirtLight, s: 2, g: 22 });
      sfx.pop();
      store.revealAt(tx + 0.5, ty + 0.5, 3.2);
      // Not an `onCut`: that counter (and the gardening achievements) is about
      // grass, and every block of dirt was inflating it.
      return true;
    };
    // Jump + paw while underground: Dui digs the block over his head (if there
    // is one) and climbs a block, scraping dirt together under his paws. It's
    // the only way up: a shaft dug with S+F or a cave is deeper than a jump,
    // and before this the way out of one was reloading the page.
    const burrowUp = () => {
      const p = store.pos;
      const body = Math.floor(p.z - 0.5);
      const head = body - 1;
      const x0 = Math.floor(p.x - HW);
      const x1 = Math.floor(p.x + HW - 1e-4);
      // Only with his body at or below ground level somewhere under him (a
      // hole or a cave; on a slope one column is enough): no dirt towers.
      let under = false;
      for (let tx = x0; tx <= x1; tx++) if (body >= SURFACE[tx]) under = true;
      if (!under) return false;
      let fill: number = T.DIRT;
      let dug = false;
      for (let tx = x0; tx <= x1; tx++) {
        const t = tiles[idx(tx, head)];
        if (!dig(tx, head)) continue;
        dug = true;
        if (t === T.SAND) fill = T.SAND;
      }
      // Stone over his head: the notch stays, Dui doesn't.
      if (collide(p.x, body)) return dug;
      if (!dug) sfx.pop();
      for (let tx = x0; tx <= x1; tx++) {
        const i = idx(tx, body);
        const d = s.dug.get(i);
        // His own hole gets its block back; a block left in natural air (a
        // cave) is remembered so the refill clears it later.
        if (d && d.t === fill) s.dug.delete(i);
        else if (!d) s.dug.set(i, { t: tiles[i], time: s.time });
        tiles[i] = fill;
      }
      p.z = body;
      s.vy = 0;
      s.lift = 1;
      paintRegion(x0 - 1, body - 1, x1 + 1, body + 1);
      return true;
    };
    // `at`: the block a tap landed on. A finger points at one block, so dig
    // that one; the paw's own rule (in front, then below) only knew about the
    // blocks at body height, and a tap on the ground ahead did nothing.
    const swipe = (down: boolean, at?: { tx: number; ty: number }, up = false) => {
      const st = store;
      st.swing = 0.3;
      s.still = 0;
      const fx = at ? at.tx + 0.5 : st.pos.x + s.facing * 1.1;
      const fz = at ? at.ty + 1 : st.pos.z - 0.5;
      const n = st.cutAt(fx, fz, at ? 0.9 : 1.4);
      st.revealAt(fx, fz, 1.4);
      if (n > 0) {
        sfx.snip();
        events.current.onCut(n);
        return;
      }
      if (at && dig(at.tx, at.ty)) return;
      // Nothing to cut: dig the block in front (or below, when crouching).
      // Dui is wider than a block, so "below" means every block under his paws:
      // taking out just the middle one left him standing on the neighbours.
      if (down) {
        const ty = Math.floor(st.pos.z + 0.02);
        for (let tx = Math.floor(st.pos.x - HW); tx <= Math.floor(st.pos.x + HW - 1e-4); tx++) dig(tx, ty);
      } else if (up && burrowUp()) {
        // Dui went up a block; nothing in front to dig.
      } else if (!dig(Math.floor(fx), Math.floor(fz))) dig(Math.floor(fx), Math.floor(st.pos.z - 1.5));
    };
    (store as unknown as { __swipe?: typeof swipe }).__swipe = swipe;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      s.time += dt;
      const st = store;
      const k = st.keys;
      const still = props.current.reduceMotion;

      // Weather drifts toward the chosen one.
      if (atmo.target !== props.current.weather) atmo.target = props.current.weather;
      stepAtmosphere(1 - Math.exp(-1.2 * dt));
      s.dark += (DARK[props.current.weather] - s.dark) * (1 - Math.exp(-1.2 * dt));

      // The dialog may have turned Dui toward something.
      const sf: 1 | -1 = st.facing < 0 ? -1 : 1;
      if (sf !== s.facing && !st.frozen) s.facing = sf;

      /* Input */
      let ix = 0;
      let jump = false;
      let run = false;
      let down = false;
      if (!st.frozen) {
        if (k.has('a') || k.has('arrowleft')) ix -= 1;
        if (k.has('d') || k.has('arrowright')) ix += 1;
        ix += st.joy.x;
        ix = clamp(ix, -1, 1);
        jump = k.has(' ') || k.has('w') || k.has('arrowup') || st.joy.z < -0.55;
        // Only a clearly downward thumb digs below: walking with the paw held
        // and the thumb drifting 35° down used to open a hole under Dui.
        down = k.has('s') || k.has('arrowdown') || (st.joy.z > 0.6 && st.joy.z > Math.abs(st.joy.x));
        run = k.has('shift') || Math.abs(st.joy.x) > 0.92;
      }
      if (Math.abs(ix) > 0.08) {
        st.target = null;
        st.targetId = null;
      }

      /* Walking to a place on its own: horizontal, jumping over steps. */
      let autoJump = false;
      if (st.target && !st.frozen && Math.abs(ix) < 0.08) {
        const dx = st.target.x - st.pos.x;
        const dz = st.target.z - st.pos.z;
        const d = Math.abs(dx);
        if (d < 0.35 && Math.abs(dz) < 1.6) {
          const id = st.targetId;
          st.target = null;
          st.targetId = null;
          if (id) events.current.onArrive(id);
        } else {
          ix = clamp(dx * 2, -1, 1);
          if (s.stuck.target !== st.target) s.stuck = { t: 0, d, z: st.pos.z, target: st.target };
          // Progress is getting closer, or getting higher (climbing out of a
          // hole doesn't change x).
          if (d < s.stuck.d - 0.05 || s.stuck.z - st.pos.z > 0.3) {
            s.stuck.t = 0;
            s.stuck.d = Math.min(s.stuck.d, d);
            s.stuck.z = st.pos.z;
          } else {
            s.stuck.t += dt;
            // Underground (a cave, a hole he dug): there is no path to plan,
            // so Dui digs his way toward the place, upward first when it's
            // above him, like a cat scratching out of a box.
            const depth = st.pos.z - SURFACE[clamp(Math.floor(st.pos.x), 0, WORLD_W - 1)];
            if (depth > 1 && s.stuck.t > 0.45 && st.swing <= 0) {
              const dir = Math.sign(dx) || s.facing;
              s.facing = dir > 0 ? 1 : -1;
              const fx = Math.floor(st.pos.x + dir * (HW + 0.3));
              const up = dz < -1;
              // Going up: clear the whole width of his (round) body for three
              // blocks above, lowest first; a one-block shaft is too narrow
              // for him. Otherwise: the block ahead, low then high.
              const order: [number, number][] = [];
              if (up) {
                const top = Math.floor(st.pos.z - H);
                for (let ty = top - 1; ty >= top - 3; ty--)
                  for (let tx = Math.floor(st.pos.x - HW); tx <= Math.floor(st.pos.x + HW - 1e-4); tx++) order.push([tx, ty]);
              }
              order.push([fx, Math.floor(st.pos.z - 0.5)], [fx, Math.floor(st.pos.z - 1.5)]);
              st.swing = 0.3;
              if (order.some(([tx, ty]) => solidAt(tx, ty) && dig(tx, ty))) s.stuck.t = 0.2;
            }
            if (s.stuck.t > (depth > 1 ? 8 : 1.6)) {
              const id = st.targetId;
              st.target = null;
              st.targetId = null;
              s.stuck = { t: 0, d: Infinity, z: 0, target: null };
              if (id && d < 3) events.current.onArrive(id);
            }
          }
          // A block in the way: hop over it.
          const ahead = Math.floor(st.pos.x + Math.sign(dx) * (HW + 0.3));
          if (solidAt(ahead, Math.floor(st.pos.z - 0.5)) || solidAt(ahead, Math.floor(st.pos.z - 1.5))) autoJump = true;
        }
      } else {
        s.stuck = { t: 0, d: Infinity, z: 0, target: null };
      }

      /* Physics */
      const p = st.pos;
      s.inWater = tileAt(Math.floor(p.x), Math.floor(p.z - 0.5)) === T.WATER;
      // Head under water too: fully submerged (no jumping out from here).
      const submerged = s.inWater && tileAt(Math.floor(p.x), Math.floor(p.z - 1.4)) === T.WATER;
      s.wet = s.inWater ? 0.22 : Math.max(0, s.wet - dt);
      const top = s.inWater ? 3.4 : run ? RUN : WALK;
      const want = ix * top;
      s.vx += (want - s.vx) * (1 - Math.exp(-(s.onGround || s.inWater ? 14 : 6) * dt));
      if (Math.abs(ix) > 0.08) s.facing = ix > 0 ? 1 : -1;

      s.coyote = s.onGround ? COYOTE : Math.max(0, s.coyote - dt);
      s.jumpBuffer = jump && !s.jumpHeld ? JUMP_BUFFER : Math.max(0, s.jumpBuffer - dt);
      if (jump || autoJump) {
        if (s.inWater && submerged) {
          // Deep down: holding jump swims up (handled with the buoyancy below).
        } else if ((s.jumpBuffer > 0 || autoJump) && (s.coyote > 0 || s.wet > 0)) {
          // On the ground, or at the water's surface: a real jump. That is how
          // Dui gets back onto the shore; before, leaving the water took his
          // jump away and he stayed stuck against the beach.
          s.vy = JUMP_V;
          s.coyote = 0;
          s.jumpBuffer = 0;
          s.still = 0;
          s.autoJumping = autoJump && s.jumpBuffer <= 0;
          sfx.select();
        }
      }
      s.jumpHeld = jump;
      // Letting go early cuts the jump short, like a platformer should.
      if (!jump && s.vy < -4 && !s.inWater && !s.autoJumping) s.vy += 30 * dt;

      if (s.inWater && s.vy > -6) {
        // Cats float: Dui bobs up to the surface on his own, swims up while
        // jump is held and only sinks when pushing down.
        const want = jump ? -4.5 : down ? 2.5 : submerged ? -1.2 : 0.35;
        s.vy += (want - s.vy) * (1 - Math.exp(-7 * dt));
      } else if ((jump || autoJump) && !s.onGround && s.vy > -7.5 && wallBeside(p.x, p.z)) {
        // Cats climb: holding jump against a wall goes up it. Without this a
        // shaft dug deeper than a jump (~2.75 blocks) was a trap with no way out.
        s.vy += (-6.5 - s.vy) * (1 - Math.exp(-10 * dt));
        s.climbing = true;
        // Head against an overhang (a shaft dug a little off-centre): slide
        // toward the open side instead of pawing at the lip forever.
        const row = Math.floor(p.z - H - 0.08);
        const left = solidAt(Math.floor(p.x - HW), row);
        const right = solidAt(Math.floor(p.x + HW - 1e-4), row);
        if (left !== right) s.vx += (left ? 1 : -1) * 40 * dt;
      } else {
        s.vy += GRAVITY * dt;
      }
      s.vy = Math.min(s.vy, s.inWater ? 3.5 : MAX_FALL);

      // X, with a one-block step-up so hills are walkable. It works in the
      // air too: a cat pulls himself onto a ledge he can reach, so a jump
      // (2.9 blocks) gets Dui out of a three-block hole instead of leaving
      // him pawing at the rim.
      let nx = p.x + s.vx * dt;
      if (collide(nx, p.z)) {
        // Climbing counts too: at the lip of a shaft Dui pulls himself up
        // onto the ledge instead of sliding back down (any airborne contact
        // does, not only while holding jump against the wall).
        if (!collide(nx, p.z - 1) && !collide(p.x, p.z - 1)) {
          p.z -= 1;
          s.lift = 1;
        } else if (s.inWater && !submerged && !collide(nx, p.z - 2) && !collide(p.x, p.z - 2)) {
          // The shore sits two blocks above where Dui floats: climb out.
          p.z -= 2;
          s.lift = 2;
        } else {
          nx = s.vx > 0 ? Math.floor(nx + HW) - HW - 1e-3 : Math.ceil(nx - HW) + HW + 1e-3;
          s.vx = 0;
        }
      }
      p.x = clamp(nx, HW + 1, WORLD_W - HW - 1);
      // Y
      let nz = p.z + s.vy * dt;
      s.wasOnGround = s.onGround;
      if (collide(p.x, nz)) {
        if (s.vy > 0) {
          nz = Math.floor(nz - 1e-4);
          if (!s.wasOnGround && s.vy > 9) {
            s.squish = Math.max(s.squish, 0.6);
            if (!still) for (let q = 0; q < 5; q++) spawn({ x: p.x + (Math.random() - 0.5) * 1.4, y: nz, vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random(), life: 0.4, kind: 'px', c: PAL.dirtLight, s: 1, g: 10 });
            sfx.pop();
          }
        } else {
          nz = Math.floor(nz - H) + 1 + H;
        }
        s.vy = 0;
      }
      p.z = clamp(nz, 2, WORLD_H - 1);
      s.onGround = groundBelow(p.x, p.z);
      if (s.onGround) {
        s.autoJumping = false;
        s.climbing = false;
      }
      if (s.lift > 0) s.lift = Math.max(0, s.lift - dt * 10);
      // Splash when entering water.
      const nowWater = tileAt(Math.floor(p.x), Math.floor(p.z - 0.5)) === T.WATER;
      if (nowWater && !s.inWater) {
        if (!still) for (let q = 0; q < 10; q++) spawn({ x: p.x + (Math.random() - 0.5) * 2, y: p.z - 0.5, vx: (Math.random() - 0.5) * 5, vy: -4 - Math.random() * 3, life: 0.6, kind: 'px', c: PAL.waterTop, s: 1, g: 20 });
        // A cat in the water has something to say about it.
        if (s.vy > 2) sfx.meow();
      }
      s.inWater = nowWater;
      st.speed = Math.abs(s.vx);
      st.facing = s.facing;

      /* Animation state */
      const moving = Math.abs(s.vx) > 0.3;
      s.amt += ((moving && s.onGround ? Math.min(Math.abs(s.vx) / WALK, 1.3) : 0) - s.amt) * (1 - Math.exp(-10 * dt));
      if (moving && (s.onGround || s.inWater)) s.phase += dt * (6 + Math.abs(s.vx) * 1.4);
      if (s.amt > 0.4 && s.onGround && Math.floor(s.phase / Math.PI) !== s.lastStep) {
        s.lastStep = Math.floor(s.phase / Math.PI);
        sfx.step();
      }
      s.tail += dt * (moving ? 7 : 2.2);
      s.still = moving || !s.onGround || st.swing > 0 ? 0 : s.still + dt;
      s.squish = Math.max(0, s.squish - dt * 2.2);
      s.blinkT -= dt;
      if (s.blinkT <= 0) {
        s.blink = 0.12;
        s.blinkT = 2 + Math.random() * 4;
      }
      s.blink = Math.max(0, s.blink - dt);
      if (s.still > SLEEP_AFTER && !still && Math.random() < dt * 1.2) spawn({ x: p.x + s.facing * 0.9, y: p.z - 1.2, vx: 0.3 * s.facing, vy: -0.8, life: 1.6, kind: 'z', c: '#fff8e7', s: 1, g: 0 });

      /* Paw: hold F or the button. */
      st.swing = Math.max(0, st.swing - dt);
      const paw = !st.frozen && (k.has('f') || st.cutHeld);
      if (paw && st.swing <= 0) swipe(down, undefined, jump);

      /* Stars: walk over a revealed one to take it. */
      s.stars.forEach((sp, i) => {
        const q = STAR_SPOTS[i];
        // A cave star shows itself once Dui is down there with it: breaking
        // in from the side or off-centre keeps the paw out of its reach.
        if (!sp.revealed && q.cave && (p.x - (q.x + 0.5)) ** 2 + (p.z - q.z) ** 2 < 9) st.revealAt(q.x + 0.5, q.z - 0.5, 0);
        if (!sp.revealed || sp.taken) return;
        sp.t += dt;
        // A generous reach (~1.4 blocks): Dui is wider than a block, and a star
        // over a step in the hillside sits where he can't stand right under it.
        if ((p.x - (q.x + 0.5)) ** 2 + (p.z - 0.5 - (q.z - 0.7)) ** 2 < 2) {
          sp.taken = true;
          sp.t = 0;
          sfx.star();
          events.current.onStar(i);
          if (!still) for (let m = 0; m < 10; m++) spawn({ x: q.x + 0.5, y: q.z - 0.7, vx: (Math.random() - 0.5) * 6, vy: -3 - Math.random() * 4, life: 0.8, kind: 'px', c: m & 1 ? '#ffe066' : '#ffffff', s: 1, g: 12 });
        }
      });

      /* Grass grows back; dug blocks fill in once Dui is out of them. */
      if (Math.floor(s.time) !== Math.floor(s.time - dt)) {
        for (const [i, t0] of s.cut)
          if (s.time - t0 > REGROW_AFTER) {
            s.cut.delete(i);
            paintRegion(i % WORLD_W, Math.floor(i / WORLD_W), i % WORLD_W, Math.floor(i / WORLD_W));
          }
        // Nothing fills in while Dui is below ground: the shaft over his head
        // closed behind him and sealed him in a pocket (only the blocks right
        // around his body were spared).
        const buried = p.z - SURFACE[clamp(Math.floor(p.x), 0, WORLD_W - 1)] > 0.5;
        for (const [i, d] of s.dug) {
          // Also the blocks Dui left behind while burrowing up: back to air.
          if (tiles[i] === d.t) {
            s.dug.delete(i);
            continue;
          }
          if (buried || s.time - d.time < REFILL_AFTER) continue;
          const tx = i % WORLD_W;
          const ty = Math.floor(i / WORLD_W);
          if (Math.abs(tx + 0.5 - p.x) < HW + 0.6) {
            // Dui's own columns. Anything above him waits (the shaft he came
            // down stays open), and the block he is in lifts him onto itself
            // instead of burying him: that is how he gets out of a hole too
            // deep to jump from, one block a second, until he is back on top.
            if (ty < Math.floor(p.z - H)) continue;
            if (ty <= Math.floor(p.z - 1e-4)) {
              if (collide(p.x, ty)) continue;
              p.z = ty;
              s.vy = Math.min(s.vy, 0);
              s.lift = 1;
            }
          }
          tiles[i] = d.t;
          s.dug.delete(i);
          paintRegion(tx - 1, ty - 2, tx + 1, ty + 1);
        }
        // Stuck underground (a cave, a hole too deep to jump from, a tunnel
        // that closed behind him) and standing still: Dui burrows up through
        // the dirt a block a second, the earth closing under his paws, until
        // he is back on the surface. Stone and ore stop him; so does the water.
        const cx = clamp(Math.floor(p.x), 0, WORLD_W - 1);
        if (s.onGround && !s.inWater && s.still > BURROW_AFTER && p.z > SURFACE[cx]) {
          const x0 = Math.floor(p.x - HW);
          const x1 = Math.floor(p.x + HW - 1e-4);
          const above = Math.floor(p.z - H) - 1;
          let canDig = true;
          for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, above) && !isDiggableTile(tileAt(tx, above))) canDig = false;
          if (canDig) {
            for (let tx = x0; tx <= x1; tx++) {
              const i = idx(tx, above);
              if (isDiggableTile(tiles[i])) {
                s.dug.set(i, { t: tiles[i], time: s.time });
                tiles[i] = T.AIR;
              }
              // The row he leaves fills in so he has something to stand on.
              const below = idx(tx, above + 1);
              if (tiles[below] === T.AIR && !STAR_SPOTS.some((q) => q.x === tx && q.z - 1 === above + 1)) {
                tiles[below] = above + 1 === SURFACE[tx] ? T.GRASS : T.DIRT;
                s.dug.delete(below);
              }
              paintRegion(tx - 1, above - 1, tx + 1, above + 2);
            }
            p.z -= 1;
            s.lift = 1;
            s.vy = 0;
            if (!still) for (let q = 0; q < 6; q++) spawn({ x: p.x + (Math.random() - 0.5) * 1.4, y: p.z - 1, vx: (Math.random() - 0.5) * 4, vy: -2 - Math.random() * 3, life: 0.6, kind: 'px', c: q & 1 ? PAL.dirtDark : PAL.dirtLight, s: 2, g: 22 });
            sfx.pop();
          }
        }
      }

      /* Idle hint and what's nearby */
      if (st.started && !st.frozen && !moving) {
        if (s.idle >= 0 && (s.idle += dt) > IDLE_HINT_AFTER) {
          s.idle = -1;
          events.current.onIdleHint?.();
        }
      } else if (moving) s.idle = 0;
      if ((s.nearT += dt) > 0.1) {
        s.nearT = 0;
        let best: InteractableId | null = null;
        let bestD = Infinity;
        for (const it of INTERACTABLES) {
          const d = Math.hypot(it.x - p.x, it.z - p.z);
          if (d < it.radius && d < bestD) {
            best = it.id;
            bestD = d;
          }
        }
        if (best !== st.nearId) {
          st.nearId = best;
          events.current.onNear(best);
        }
      }

      /* Daniel */
      const dn = s.daniel;
      const dNear = Math.abs(p.x - DANIEL.x) < 7 && Math.abs(p.z - DANIEL.z) < 4;
      dn.waveT -= dt;
      dn.wave = Math.max(0, dn.wave - dt);
      if (dn.waveT <= 0) {
        dn.waveT = 5 + Math.random() * 5;
        if (dNear) dn.wave = 1.3;
      }
      dn.blinkT -= dt;
      if (dn.blinkT <= 0) {
        dn.blink = 0.12;
        dn.blinkT = 2.5 + Math.random() * 4;
      }
      dn.blink = Math.max(0, dn.blink - dt);
      dn.mutterT -= dt;
      if (dn.mutterT <= 0) {
        dn.mutterT = 6 + Math.random() * 6;
        if (dNear && !st.frozen) {
          dn.mutter = MUTTERS[Math.floor(Math.random() * MUTTERS.length)];
          dn.mutterUntil = s.time + 2.6;
        }
      }

      /* Particles */
      for (const q of s.particles) {
        q.life -= dt;
        q.vy += q.g * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.kind === 'px' && q.g > 5 && q.vy > 0 && solidAt(Math.floor(q.x), Math.floor(q.y))) {
          q.vy = 0;
          q.vx *= 0.5;
        }
      }
      if (s.particles.length) s.particles = s.particles.filter((q) => q.life > 0);
      if (!still) {
        s.smokeT -= dt;
        if (s.smokeT <= 0) {
          s.smokeT = 0.45;
          for (const c of CHIMNEYS) if (Math.abs(c.x - p.x) < 60) spawn({ x: c.x + 0.5, y: c.y - 0.2, vx: 0.4 + Math.random() * 0.4, vy: -0.9, life: 3.5, kind: 'smoke', c: '#d9d4cc', s: 2, g: -0.1 });
        }
      }

      /* Ambient life: petals, leaves, butterflies, fireflies, campfire sparks. */
      if (!still) {
        const mood = moodFor(props.current.weather, s.dark);
        const vx0 = v.camX;
        const vx1 = v.camX + v.vw / TILE;
        spawnMotes(s.motes, dt, vx0, vx1, v.camY, v.camY + v.vh / TILE, mood, props.current.weather);
        stepMotes(s.motes, dt, s.time, mood.wind);
        if (s.motes.length) s.motes = s.motes.filter((m) => m.life > 0);
        if (CAMPFIRE.x > vx0 - 4 && CAMPFIRE.x < vx1 + 4 && (s.sparkT -= dt) <= 0) {
          s.sparkT = 0.12 + Math.random() * 0.2;
          spawn({ x: CAMPFIRE.x + 0.5 + (Math.random() - 0.5) * 0.4, y: SURFACE[CAMPFIRE.x] - 0.7, vx: (Math.random() - 0.5) * 0.6, vy: -1.6 - Math.random() * 1.2, life: 1 + Math.random() * 0.8, kind: 'px', c: Math.random() < 0.5 ? '#ffd23f' : '#ff8a3c', s: 1, g: -0.2 });
          if (Math.random() < 0.25) spawn({ x: CAMPFIRE.x + 0.5, y: SURFACE[CAMPFIRE.x] - 1.1, vx: 0.2 + Math.random() * 0.3, vy: -0.7, life: 3, kind: 'smoke', c: '#cfc6bb', s: 2, g: -0.05 });
        }
      } else if (s.motes.length) s.motes.length = 0;

      /* Camera: a little ahead of where Dui looks, never past the world. */
      const vwT = v.vw / TILE;
      const vhT = v.vh / TILE;
      const tx = clamp(p.x + s.facing * 1.6 - vwT / 2, 0, Math.max(0, WORLD_W - vwT));
      // Dui sits low in the frame: more sky and island, less underground.
      const tz = clamp(p.z - vhT * (s.under > 0.3 ? 0.55 : 0.66), 0, Math.max(0, WORLD_H - vhT));
      const ck = 1 - Math.exp(-5 * dt);
      v.camX += (tx - v.camX) * ck;
      v.camY += (tz - v.camY) * ck;
      v.camPx = Math.round(v.camX * TILE);
      v.camPy = Math.round(v.camY * TILE);

      // How deep underground Dui is darkens the scene around him.
      const depth = p.z - SURFACE[clamp(Math.floor(p.x), 0, WORLD_W - 1)];
      s.under += (clamp((depth - 1.5) / 4, 0, 1) - s.under) * (1 - Math.exp(-3 * dt));

      // Calm frames (Dui still, camera settled, nothing fast on screen) are
      // drawn at ~30 fps: the flames, grass and fireflies move slowly enough
      // that it looks the same, and it halves the raster work while idle or
      // reading a dialog. The simulation above still runs every frame.
      const camMoving = Math.abs(tx - v.camX) > 0.02 || Math.abs(tz - v.camY) > 0.02;
      // Campfire sparks, smoke and sleepy "z"s drift slowly: they don't count.
      let fast = false;
      for (const q of s.particles) if (q.kind === 'heart' || q.g > 5 || Math.abs(q.vx) > 2) { fast = true; break; }
      const busy = moving || !s.onGround || st.swing > 0 || camMoving || fast || atmo.rain > 0.05 || atmo.snow > 0.05;
      if (busy || now - s.lastDraw > 31) {
        s.lastDraw = now;
        draw();
      }
    };

    const draw = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx || !s.layer) return;
      // The first fit can run before the page settles (the route fades in):
      // re-fit whenever the box is not the size we measured.
      const box = c.parentElement;
      if (box && (box.clientWidth !== v.cssW || box.clientHeight !== v.cssH)) fit();
      const still = props.current.reduceMotion;
      const weather = props.current.weather;
      const t = s.time;
      const { vw, vh, camPx, camPy, r } = v;
      const p = store.pos;
      const mood = moodFor(weather, s.dark);
      const sx = (x: number) => x * TILE - camPx;
      const sy = (z: number) => z * TILE - camPy;
      const inView = (x: number, m = 4) => x * TILE - camPx > -m * TILE && x * TILE - camPx < vw + m * TILE;

      /* The page */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(paper(c.width, c.height, r), 0, 0);
      const tint = PAGE_TINT[weather];
      if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, c.width, c.height);
      }

      /* Everything drawn in crayon goes on its own layer first, so the wax
         grain can be punched out of it without touching the paper. */
      const L = s.layer;
      const g = L.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, L.width, L.height);
      g.setTransform(r, 0, 0, r, 0, 0);

      // Sky: a loose crayon wash at the top of the page.
      const horizon = SEA_LEVEL * TILE - camPy;
      const skyCol = SKY_CRAYON[weather];
      if (skyCol) {
        for (let band = 0; band < 3; band++) {
          const top = -10 + band * 40;
          g.save();
          g.beginPath();
          g.rect(0, top, vw, 46);
          g.clip();
          hatch(g, -(camPx * 0.1) % 12 - 12, top, vw + 24, 46, skyCol, 0.2 - band * 0.06, 5 + band * 2, -0.22, 1.6, 40 + band);
          g.restore();
        }
      }
      if (atmo.stars > 0.3) {
        for (const sk of SKY_STARS) {
          const x = ((sk.x * 1400 - camPx * 0.05) % vw + vw) % vw;
          const y = sk.y * Math.max(60, horizon - 40);
          const tw = still ? 1 : 0.6 + 0.4 * Math.sin(t * 2 + sk.k);
          g.globalAlpha = atmo.stars * tw;
          if (sk.k % 5 === 0) crayonStar(g, x, y, 3, '#fff6c0', '#e8d890');
          else dot(g, x, y, 0.9, '#fff6c0');
        }
        g.globalAlpha = 1;
        crayonMoon(g, vw * 0.78 - camPx * 0.04, Math.max(40, horizon - 150));
      } else if (atmo.sunAmt > 0.02) {
        crayonSun(g, vw * (0.5 + atmo.sunDir[0] * 0.45) - camPx * 0.04, horizon - 40 - atmo.sunDir[1] * 140, t, still);
      }
      for (const cl of CLOUDS) {
        const span = WORLD_W * TILE * 0.35 + vw + 300;
        const drift = still ? 0 : t * 4;
        const x = ((cl.x + drift - camPx * 0.35) % span + span) % span - 150;
        const y = horizon - cl.y - camPy * 0.1;
        if (x > vw || x + cl.w * 1.5 < 0) continue;
        crayonCloud(g, x, y, cl.w * 1.5, cl.parts.length * 13 + Math.round(cl.w), CLOUD_FILL[weather], CLOUD_LINE[weather]);
      }
      crayonHills(g, HILLS_FAR, camPx * 0.18, horizon, vw, HILL_FAR[weather], 0.7);
      crayonHills(g, HILLS_NEAR, camPx * 0.42, horizon, vw, HILL_NEAR[weather], 0.85);

      /* Ground, from the chunk cache (painted the first time it's seen). */
      const cx0 = Math.floor(camPx / (CHUNK * TILE));
      const cx1 = Math.floor((camPx + vw) / (CHUNK * TILE));
      const cy0 = Math.floor(camPy / (CHUNK * TILE));
      const cy1 = Math.floor((camPy + vh) / (CHUNK * TILE));
      // Painting a chunk takes a few ms: at most two new ones per frame, and
      // the ring just outside the view is painted ahead, before it shows.
      let budget = s.chunks.size === 0 ? 999 : 2;
      for (let cy = Math.max(0, cy0 - 1); cy <= Math.min(Math.ceil(WORLD_H / CHUNK) - 1, cy1 + 1); cy++)
        for (let cx = Math.max(0, cx0 - 1); cx <= Math.min(Math.ceil(WORLD_W / CHUNK) - 1, cx1 + 1); cx++) {
          const visible = cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1;
          const key = cy * 1000 + cx;
          let ch = s.chunks.get(key);
          if (!ch) {
            if (budget-- <= 0) continue;
            ch = document.createElement('canvas');
            // Painted at the canvas' own resolution and copied 1:1 at whole
            // device pixels: scaled or half-pixel copies blurred the chunk
            // edges into visible seams across the ground.
            ch.width = ch.height = Math.round(CHUNK * TILE * r);
            paintChunk(ch.getContext('2d')!, cx, cy, (i) => s.cut.has(i), r);
            // Bounded cache: forget the chunk used longest ago.
            if (s.chunks.size > 90) s.chunks.delete(s.chunks.keys().next().value!);
          } else s.chunks.delete(key);
          s.chunks.set(key, ch);
          if (!visible) continue;
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.drawImage(ch, Math.round((cx * CHUNK * TILE - camPx) * r), Math.round((cy * CHUNK * TILE - camPy) * r));
          g.setTransform(r, 0, 0, r, 0, 0);
        }

      // Water surface: a wavy crayon line that moves.
      const x0 = Math.floor(camPx / TILE);
      const x1 = Math.ceil((camPx + vw) / TILE);
      g.strokeStyle = INK.waterLight;
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.beginPath();
      for (let x = Math.max(0, x0); x <= Math.min(WORLD_W - 1, x1); x++) {
        let y = -1;
        y = WATER_TOP[x];
        if (y < 0) continue;
        for (let k = 0; k <= 4; k++) {
          const wx = x * TILE + k * 4;
          const wy = y * TILE + 1 + (still ? 0 : Math.sin(t * 2.2 + wx * 0.09) * 1.6);
          if (k === 0) g.moveTo(wx - camPx, wy - camPy);
          else g.lineTo(wx - camPx, wy - camPy);
        }
      }
      g.stroke();

      // Tall grass, leaning with the wind; Dui pushes it aside as he passes.
      g.save();
      g.translate(-camPx, -camPy);
      const wind = still ? 0 : mood.wind * 1.6;
      for (let x = Math.max(0, x0 - 1); x <= Math.min(WORLD_W - 1, x1); x++) {
        const ty = SURFACE[x] - 1;
        const i = idx(x, ty);
        if (tiles[i] !== T.TALLGRASS || s.cut.has(i)) continue;
        const dxD = x + 0.5 - p.x;
        const push = Math.abs(dxD) < 1.2 && Math.abs(p.z - SURFACE[x]) < 1.5 ? Math.sign(dxD || s.facing) * 4 : 0;
        crayonGrass(g, x, ty, t, wind, push);
      }
      g.restore();

      /* Things on the island */
      if (inView(WORKSHOP.x)) crayonGear(g, sx(WORKSHOP.x + 0.5) + 2, sy(SURFACE[WORKSHOP.x] - WORKSHOP.h + 1) - 4, still ? 0 : t * 0.9);
      for (const pl of GARDEN_PLOTS) if (inView(pl.x)) crayonPlant(g, sx(pl.x + 0.5), sy(pl.z), pl.kind, store.garden.growth, t);
      if (inView(STATION.x)) crayonStation(g, sx(STATION.x + 0.5), sy(STATION.z), t, !!store.meteo);
      for (const sg of PROJECT_SIGNS) if (inView(sg.x)) crayonSign(g, sx(sg.x + 0.5), sy(sg.z), sg.color, store.seenProjects.has(sg.project.id));
      if (inView(PLAZA.x)) crayonBoard(g, sx(PLAZA.x + 0.5), sy(PLAZA.z));
      if (inView(WELCOME.x)) crayonWelcome(g, sx(WELCOME.x + 0.5), sy(WELCOME.z));
      if (inView(MAILBOX.x)) crayonMailbox(g, sx(MAILBOX.x + 0.5), sy(MAILBOX.z));
      for (const ln of LANTERNS) if (inView(ln.x)) crayonLantern(g, sx(ln.x + 0.2), sy(SURFACE[ln.x]), mood.evening);
      if (inView(CAMPFIRE.x)) crayonCampfire(g, sx(CAMPFIRE.x + 0.5), sy(SURFACE[CAMPFIRE.x]), t, still);
      if (inView(DANIEL.x)) crayonDaniel(g, sx(DANIEL.x + 0.5), sy(DANIEL.z), { facing: p.x < DANIEL.x ? -1 : 1, t, wave: s.daniel.wave > 0, blink: s.daniel.blink > 0 });

      // Stars: a glint through the grass, then a floating star.
      s.stars.forEach((sp, i) => {
        const q = STAR_SPOTS[i];
        if (!inView(q.x)) return;
        if (sp.taken) {
          if (sp.t < 0.5) {
            sp.t += 0.016;
            crayonStar(g, sx(q.x + 0.5), sy(q.z - 0.7) - sp.t * 30, 5, INK.yellow);
          }
          return;
        }
        if (!sp.revealed) {
          if (!still && Math.sin(t * 2.2 + i * 1.7) > 0.88) crayonStar(g, sx(q.x + 0.5), sy(q.z - 0.3), 2.5, '#fff6c0', '#e8d890');
          return;
        }
        const bob = still ? 0 : Math.sin(t * 2.5 + i) * 2;
        crayonStar(g, sx(q.x + 0.5), sy(q.z - 0.8) + bob, sp.t < 0.4 ? 4 : 6, INK.yellow);
      });

      for (const q of s.particles) {
        const px = sx(q.x);
        const py = sy(q.y);
        const a = clamp(q.life / q.max, 0, 1);
        if (q.kind === 'heart') {
          g.globalAlpha = Math.min(1, a * 1.5);
          crayonHeart(g, px, py, 3, q.c);
        } else if (q.kind === 'z') {
          g.globalAlpha = a;
          g.fillStyle = INK.graphite;
          g.font = 'bold 9px "Patrick Hand", "Comic Sans MS", cursive';
          g.fillText('z', px, py);
        } else if (q.kind === 'smoke') {
          g.globalAlpha = a * 0.35;
          dot(g, px, py, 2 + (1 - a) * 4, '#9a948c', 1);
        } else {
          g.globalAlpha = q.kind === 'px' && q.max > 2 ? 1 : Math.min(1, a * 2);
          dot(g, px, py, Math.max(0.8, q.s * 0.7), q.c, 1);
        }
      }
      g.globalAlpha = 1;
      drawMotes(g, s.motes, t, camPx, camPy);

      /* Dui */
      const pose: DuiPose = {
        facing: s.facing,
        phase: s.phase,
        amt: s.amt,
        air: s.onGround || s.inWater ? 0 : s.vy,
        sit: (s.still > SIT_AFTER && s.still <= SLEEP_AFTER) || (store.frozen && store.started && s.onGround && !store.target),
        sleep: s.still > SLEEP_AFTER,
        blink: s.blink > 0,
        swing: store.swing > 0 ? Math.sin((store.swing / 0.3) * Math.PI) : 0,
        tail: s.tail,
        squish: s.squish,
        swim: s.inWater ? 1 : 0,
      };
      crayonDui(g, sx(p.x), sy(p.z + s.lift * 0.6) + (s.inWater ? 5 : 0), pose);

      /* Wax grain: specks where the crayon skipped over the paper. Anchored
         to the world, so it doesn't swim when the camera moves. */
      if (!s.grainPattern) s.grainPattern = g.createPattern(grain(), 'repeat');
      if (s.grainPattern) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        s.grainPattern.setTransform(new DOMMatrix([1, 0, 0, 1, -((camPx * r) % 96), -((camPy * r) % 96)]));
        g.globalCompositeOperation = 'destination-out';
        g.globalAlpha = 0.5;
        g.fillStyle = s.grainPattern;
        g.fillRect(0, 0, L.width, L.height);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(L, 0, 0);

      /* Light and weather, over the drawing */
      ctx.setTransform(r, 0, 0, r, 0, 0);
      const window_ = (x: number, y: number, a: number) => {
        ctx.fillStyle = `rgba(255,214,120,${a})`;
        ctx.fillRect(x, y, 2 * TILE - 2, 2 * TILE - 2);
      };
      if (s.dark > 0.08)
        for (const w of WINDOW_BLOCKS) {
          const px = w.x * TILE - camPx;
          const py = w.y * TILE - camPy;
          if (px < -40 || px > vw || py < -40 || py > vh) continue;
          window_(px + 1, py + 1, Math.min(0.55, s.dark * 0.9));
        }
      if (inView(CAMPFIRE.x)) {
        const fl = still ? 1 : 0.85 + Math.sin(t * 11) * 0.08 + Math.sin(t * 17) * 0.05;
        glow(ctx, sx(CAMPFIRE.x + 0.5), sy(SURFACE[CAMPFIRE.x]) - 8, 34, 'rgba(255,150,60,0.55)', (0.3 + mood.evening * 0.5) * fl);
      }
      for (const ln of LANTERNS) if (inView(ln.x)) glow(ctx, sx(ln.x + 0.2) + 5, sy(SURFACE[ln.x]) - 15, 22, 'rgba(255,210,120,0.6)', mood.evening * 0.85);

      if (!still) {
        const nRain = Math.round(atmo.rain * 70);
        while (s.drops.length < nRain) s.drops.push({ x: Math.random() * vw, y: Math.random() * vh, v: 140 + Math.random() * 60, k: 0 });
        if (s.drops.length > nRain) s.drops.length = nRain;
        ctx.strokeStyle = 'rgba(70,120,190,0.55)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const d of s.drops) {
          d.y += d.v / 60;
          d.x -= d.v / 300;
          if (d.y > vh) {
            d.y = -6;
            d.x = Math.random() * vw;
          }
          if (d.x < 0) d.x += vw;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - 1.5, d.y + 6);
        }
        ctx.stroke();
        const nSnow = Math.round(atmo.snow * 60);
        while (s.flies.length < nSnow) s.flies.push({ x: Math.random() * vw, y: Math.random() * vh, k: Math.random() * 10 });
        if (s.flies.length > nSnow) s.flies.length = nSnow;
        for (const f of s.flies) {
          f.y += 0.4;
          f.x += Math.sin(t * 1.5 + f.k) * 0.3;
          if (f.y > vh) f.y = -2;
          dot(ctx, f.x, f.y, 1.4, '#ffffff', 0.9);
        }
      }

      /* Darkness with light around Dui, the fire, lanterns, windows and stars */
      const dark = Math.max(s.dark, s.under * 0.7);
      if (dark > 0.02 && s.light) {
        const l = s.light.getContext('2d')!;
        l.globalCompositeOperation = 'source-over';
        l.clearRect(0, 0, vw, vh);
        l.fillStyle = `rgba(20,24,60,${dark * 0.85})`;
        l.fillRect(0, 0, vw, vh);
        l.globalCompositeOperation = 'destination-out';
        // One radial falloff for every lamp, scaled and faded with
        // globalAlpha: building a gradient per lamp per frame made a dozen
        // CanvasGradients every frame at night.
        const fall = lampSprite();
        const lamp = (x: number, y: number, rr: number, a: number) => {
          l.globalAlpha = a;
          l.drawImage(fall, x - rr, y - rr, rr * 2, rr * 2);
          l.globalAlpha = 1;
        };
        lamp(sx(p.x), sy(p.z - 0.6), TILE * (5.5 + s.under * 1.5), 1);
        for (const w of WINDOW_BLOCKS) {
          const px = w.x * TILE - camPx + TILE;
          const py = w.y * TILE - camPy + TILE;
          if (px < -60 || px > vw + 60 || py < -60 || py > vh + 60) continue;
          lamp(px, py, TILE * 2.6, 0.9);
        }
        s.stars.forEach((sp, i) => {
          if (!sp.revealed || sp.taken) return;
          lamp(sx(STAR_SPOTS[i].x + 0.5), sy(STAR_SPOTS[i].z - 0.8), TILE * 1.6, 0.9);
        });
        if (inView(STATION.x)) lamp(sx(STATION.x + 0.5) + 2, sy(STATION.z) - 21, 10, 0.8);
        if (inView(CAMPFIRE.x)) lamp(sx(CAMPFIRE.x + 0.5), sy(SURFACE[CAMPFIRE.x]) - 8, TILE * (4.2 + (still ? 0 : Math.sin(t * 9) * 0.25)), 1);
        for (const ln of LANTERNS) if (inView(ln.x)) lamp(sx(ln.x + 0.2) + 5, sy(SURFACE[ln.x]) - 15, TILE * 2.6, 0.95);
        ctx.drawImage(s.light, 0, 0, vw, vh);
      }
      if (atmo.mist > 0.02) {
        ctx.fillStyle = css(atmo.fog, atmo.mist * 0.4);
        ctx.fillRect(0, 0, vw, vh);
      }
      drawGrade(ctx, vw, vh, weather, s.under);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      /* Labels and Daniel's bubble, in the DOM */
      const toCss = v.scale / v.dpr;
      s.labelEls.forEach((el, i) => {
        const l = LABELS[i];
        const d = Math.hypot(l.x - p.x, l.z - p.z);
        const show = (!l.nearOnly || d < l.nearOnly) && inView(l.x, 2) && s.under < 0.6;
        if (!show) {
          if (el.style.display !== 'none') el.style.display = 'none';
          return;
        }
        if (el.style.display !== 'block') el.style.display = 'block';
        const bob = l.goal === 'daniel' && !still ? Math.sin(t * 2) * 3 : 0;
        // Only touch the style when it changed: a write per label per frame
        // kept the style recalc busy even with the camera still.
        const tf = `translate(${Math.round((l.x + 0.5) * TILE * toCss - camPx * toCss)}px, ${Math.round(l.z * TILE * toCss - camPy * toCss + bob)}px) translate(-50%, -100%)`;
        if (el.style.transform !== tf) el.style.transform = tf;
        const isGoal = !!l.goal && l.goal === store.goalId;
        if (isGoal !== el.classList.contains('label-meta')) el.classList.toggle('label-meta', isGoal);
      });
      const b = s.bubbleEl;
      if (b) {
        const show = s.daniel.mutterUntil > t && inView(DANIEL.x, 2);
        if (show) {
          if (b.textContent !== s.daniel.mutter) b.textContent = s.daniel.mutter;
          if (b.style.display !== 'block') b.style.display = 'block';
          const tf = `translate(${Math.round((DANIEL.x + 1.2) * TILE * toCss - camPx * toCss)}px, ${Math.round((DANIEL.z - 1.9) * TILE * toCss - camPy * toCss)}px) translate(0, -100%)`;
          if (b.style.transform !== tf) b.style.transform = tf;
        } else if (b.style.display !== 'none') b.style.display = 'none';
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [store, events, paused, paintRegion, spawn, fit]);

  /* ── Tap or click: pet Dui, dig a block, walk to a place or a spot ───── */

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (store.frozen) return;
    const v = view.current;
    const s = sim.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = (v.camPx + ((e.clientX - rect.left) * v.dpr) / v.scale) / TILE;
    const wy = (v.camPy + ((e.clientY - rect.top) * v.dpr) / v.scale) / TILE;
    const p = store.pos;
    if (Math.abs(wx - p.x) < 1.3 && wy > p.z - 1.6 && wy < p.z + 0.4) {
      s.squish = 1;
      s.still = 0;
      sfx.purr();
      if (Math.random() < 0.35) sfx.meow();
      store.burst('hearts', p.x, p.z);
      events.current.onPet?.();
      return;
    }
    let best: InteractableId | null = null;
    let bestD = 2.6;
    for (const it of INTERACTABLES) {
      const d = Math.hypot(it.x + 0.5 - wx, it.z - 0.8 - wy);
      if (d < bestD) {
        best = it.id;
        bestD = d;
      }
    }
    if (best) {
      props.current.onWalkTo(best);
      return;
    }
    // A block within reach: dig it (or cut the grass on it).
    const tx = Math.floor(wx);
    const ty = Math.floor(wy);
    const reach = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - (p.z - 0.5));
    if (reach < 2.4 && store.swing <= 0) {
      s.facing = tx + 0.5 >= p.x ? 1 : -1;
      store.facing = s.facing;
      const swipe = (store as unknown as { __swipe?: (down: boolean, at?: { tx: number; ty: number }, up?: boolean) => void }).__swipe;
      if (swipe) {
        swipe(ty > p.z - 0.5 && Math.abs(tx + 0.5 - p.x) < 1, { tx, ty });
        return;
      }
    }
    store.target = new Vec3(clamp(wx, 2, WORLD_W - 2), 0, SURFACE[clamp(Math.floor(wx), 0, WORLD_W - 1)]);
    store.targetId = null;
  };

  return (
    <div className={`pixel-isla absolute inset-0 overflow-hidden clima-${weather}`} aria-hidden="true">
      <canvas ref={canvasRef} onPointerDown={onPointerDown} onContextMenu={(e) => e.preventDefault()} className="block cursor-pointer" style={{ touchAction: 'none' }} />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 font-crayon" />
    </div>
  );
}

// Keep the island's edges in mind for anyone extending the map.
void ISLAND_X0;
void ISLAND_X1;
void CAVES;
