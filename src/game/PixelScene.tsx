import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameEvents, GameStore } from './store';
import { sfx } from './audio';
import { atmo, css, stepAtmosphere, type WeatherId } from './weather';
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
import {
  PAL,
  TILE,
  drawBoard,
  drawDaniel,
  drawDui,
  drawEarthBg,
  drawGear,
  drawHeart,
  drawMailbox,
  drawPlant,
  drawSign,
  drawStar,
  drawStation,
  drawTile,
  drawWelcomeSign,
  type DuiPose,
} from './sprites';

/*
 * The island as a side-scrolling world of blocks, Terraria style.
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

export default function PixelScene({ store, events, onWalkTo, weather, reduceMotion, paused }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const props = useRef({ weather, reduceMotion, onWalkTo });
  props.current = { weather, reduceMotion, onWalkTo };

  const view = useRef({ cssW: 0, cssH: 0, dpr: 1, scale: 3, vw: 320, vh: 240, camX: 0, camY: 0, camPx: 0, camPy: 0 });

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
    lift: 0,
    phase: 0,
    amt: 0,
    still: 0,
    blinkT: 2,
    blink: 0,
    squish: 0,
    tail: 0,
    stuck: { t: 0, d: Infinity, target: null as Vec3 | null },
    idle: 0,
    nearT: 0,
    lastStep: 0,
    cut: new Map<number, number>(),
    dug: new Map<number, { t: number; time: number }>(),
    stars: STAR_SPOTS.map((_, i) => ({ revealed: store.starsTaken.has(i), taken: store.starsTaken.has(i), t: 0 })),
    particles: [] as Particle[],
    drops: [] as Drop[],
    flies: [] as { x: number; y: number; k: number }[],
    smokeT: 0,
    dark: 0,
    under: 0,
    daniel: { wave: 0, waveT: 6, blink: 0, blinkT: 3, mutter: '', mutterT: 5, mutterUntil: 0 },
    labelEls: [] as HTMLDivElement[],
    bubbleEl: null as HTMLDivElement | null,
    terrain: null as HTMLCanvasElement | null,
    light: null as HTMLCanvasElement | null,
    glow: null as HTMLCanvasElement | null,
  });

  /* ── Terrain: painted once, repainted where it changes ───────────────── */

  const paintRegion = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const s = sim.current;
    const t = s.terrain?.getContext('2d');
    if (!t) return;
    x0 = clamp(x0, 0, WORLD_W - 1);
    x1 = clamp(x1, 0, WORLD_W - 1);
    y0 = clamp(y0, 0, WORLD_H - 1);
    y1 = clamp(y1, 0, WORLD_H - 1);
    t.save();
    t.beginPath();
    t.rect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    t.clip();
    t.clearRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    // One extra row below: its grass blades reach into this region.
    for (let y = y0; y <= Math.min(WORLD_H - 1, y1 + 1); y++)
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        const tile = tiles[i];
        const px = x * TILE;
        const py = y * TILE;
        if (tile === T.AIR) {
          if (inIsland(x) && y > SURFACE[x]) drawEarthBg(t, px, py, x, y);
          continue;
        }
        drawTile(t, tile, px, py, x, y, tileAt(x, y - 1), tile === T.TALLGRASS && s.cut.has(i));
      }
    t.restore();
  }, []);

  useEffect(() => {
    const s = sim.current;
    const terrain = document.createElement('canvas');
    terrain.width = WORLD_W * TILE;
    terrain.height = WORLD_H * TILE;
    s.terrain = terrain;
    s.light = document.createElement('canvas');
    s.glow = document.createElement('canvas');
    paintRegion(0, 0, WORLD_W - 1, WORLD_H - 1);
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
    c.width = v.vw;
    c.height = v.vh;
    // Size the element so each virtual pixel is exactly `scale` device pixels.
    c.style.width = `${(v.vw * scale) / dpr}px`;
    c.style.height = `${(v.vh * scale) / dpr}px`;
    const s = sim.current;
    if (s.light) {
      s.light.width = v.vw;
      s.light.height = v.vh;
    }
    if (import.meta.env.DEV) Object.assign(window as object, { __pixel: v, __pixelSpots: STAR_SPOTS, __pixelVec: Vec3, __pixelTile: tileAt });
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
      el.className = `absolute left-0 top-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-black text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)] ${
        l.tone === 'orange' ? 'bg-[#ffe3a3]/95' : 'bg-[#fff8e7]/95'
      }`;
      el.style.display = 'none';
      root.appendChild(el);
      return el;
    });
    const bubble = document.createElement('div');
    bubble.className = 'absolute left-0 top-0 whitespace-nowrap rounded-2xl rounded-bl-sm bg-[#fff8e7] px-2.5 py-1 text-[12px] font-bold text-[#6b4f3a] shadow-[0_3px_0_rgba(91,70,54,0.2)]';
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
    const groundBelow = (x: number, z: number) => {
      const ty = Math.floor(z + 0.02);
      for (let tx = Math.floor(x - HW); tx <= Math.floor(x + HW - 1e-4); tx++) if (solidAt(tx, ty)) return true;
      return false;
    };
    const dig = (tx: number, ty: number) => {
      const i = idx(tx, ty);
      const t = tiles[i];
      if (!isDiggableTile(t)) return false;
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
      events.current.onCut(1);
      return true;
    };
    // `at`: the block a tap landed on. A finger points at one block, so dig
    // that one; the paw's own rule (in front, then below) only knew about the
    // blocks at body height, and a tap on the ground ahead did nothing.
    const swipe = (down: boolean, at?: { tx: number; ty: number }) => {
      const st = store;
      st.swing = 0.3;
      s.still = 0;
      const fx = st.pos.x + s.facing * 1.1;
      const fz = st.pos.z - 0.5;
      const n = st.cutAt(fx, fz, 1.4);
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
          if (s.stuck.target !== st.target) s.stuck = { t: 0, d, target: st.target };
          if (d < s.stuck.d - 0.05) {
            s.stuck.t = 0;
            s.stuck.d = d;
          } else if ((s.stuck.t += dt) > 1.6) {
            const id = st.targetId;
            st.target = null;
            st.targetId = null;
            s.stuck = { t: 0, d: Infinity, target: null };
            if (id && d < 3) events.current.onArrive(id);
          }
          // A block in the way: hop over it.
          const ahead = Math.floor(st.pos.x + Math.sign(dx) * (HW + 0.3));
          if (solidAt(ahead, Math.floor(st.pos.z - 0.5)) || solidAt(ahead, Math.floor(st.pos.z - 1.5))) autoJump = true;
        }
      } else {
        s.stuck = { t: 0, d: Infinity, target: null };
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
      } else {
        s.vy += GRAVITY * dt;
      }
      s.vy = Math.min(s.vy, s.inWater ? 3.5 : MAX_FALL);

      // X, with a one-block step-up so hills are walkable.
      let nx = p.x + s.vx * dt;
      if (collide(nx, p.z)) {
        if ((s.onGround || s.inWater) && !collide(nx, p.z - 1) && !collide(p.x, p.z - 1)) {
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
      if (s.onGround) s.autoJumping = false;
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
      if (paw && st.swing <= 0) swipe(down);

      /* Stars: walk over a revealed one to take it. */
      s.stars.forEach((sp, i) => {
        if (!sp.revealed || sp.taken) return;
        sp.t += dt;
        const q = STAR_SPOTS[i];
        if ((p.x - (q.x + 0.5)) ** 2 + (p.z - 0.5 - (q.z - 0.7)) ** 2 < 1.2) {
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
        for (const [i, d] of s.dug) {
          if (s.time - d.time < REFILL_AFTER || tiles[i] !== T.AIR) continue;
          const tx = i % WORLD_W;
          const ty = Math.floor(i / WORLD_W);
          if (Math.abs(tx + 0.5 - p.x) < HW + 0.6 && ty >= Math.floor(p.z - H) - 1 && ty <= Math.floor(p.z)) continue;
          tiles[i] = d.t;
          s.dug.delete(i);
          paintRegion(tx - 1, ty - 2, tx + 1, ty + 1);
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

      /* Camera: a little ahead of where Dui looks, never past the world. */
      const vwT = v.vw / TILE;
      const vhT = v.vh / TILE;
      const tx = clamp(p.x + s.facing * 1.6 - vwT / 2, 0, Math.max(0, WORLD_W - vwT));
      const tz = clamp(p.z - vhT * 0.58, 0, Math.max(0, WORLD_H - vhT));
      const ck = 1 - Math.exp(-5 * dt);
      v.camX += (tx - v.camX) * ck;
      v.camY += (tz - v.camY) * ck;
      v.camPx = Math.round(v.camX * TILE);
      v.camPy = Math.round(v.camY * TILE);

      // How deep underground Dui is darkens the scene around him.
      const depth = p.z - SURFACE[clamp(Math.floor(p.x), 0, WORLD_W - 1)];
      s.under += (clamp((depth - 1.5) / 4, 0, 1) - s.under) * (1 - Math.exp(-3 * dt));

      draw();
    };

    const draw = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx || !s.terrain) return;
      // The first fit can run before the page settles (the route fades in):
      // re-fit whenever the box is not the size we measured.
      const box = c.parentElement;
      if (box && (box.clientWidth !== v.cssW || box.clientHeight !== v.cssH)) fit();
      const still = props.current.reduceMotion;
      const t = s.time;
      const { vw, vh, camPx, camPy } = v;
      const p = store.pos;
      ctx.imageSmoothingEnabled = false;

      /* Sky */
      const horizon = SEA_LEVEL * TILE - camPy;
      const g = ctx.createLinearGradient(0, horizon - 260, 0, horizon + 30);
      g.addColorStop(0, css(atmo.sky[0]));
      g.addColorStop(0.42, css(atmo.sky[1]));
      g.addColorStop(0.72, css(atmo.sky[2]));
      g.addColorStop(0.9, css(atmo.sky[3]));
      g.addColorStop(1, css(atmo.sky[4]));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);

      // Stars and moon at night, sun by day.
      if (atmo.stars > 0.02) {
        for (const sk of SKY_STARS) {
          const x = Math.round(((sk.x * 1400 - camPx * 0.05) % vw + vw) % vw);
          const y = Math.round(sk.y * Math.max(60, horizon - 30));
          const tw = still ? 0.8 : 0.5 + 0.5 * Math.sin(t * 2 + sk.k);
          ctx.globalAlpha = atmo.stars * (0.4 + 0.6 * tw);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, y, sk.k % 7 === 0 ? 2 : 1, sk.k % 7 === 0 ? 2 : 1);
        }
        ctx.globalAlpha = atmo.stars;
        const mx = Math.round(vw * 0.78 - camPx * 0.04);
        const my = Math.round(Math.max(40, horizon - 150));
        ctx.fillStyle = '#f4f1dc';
        circle(ctx, mx, my, 9);
        ctx.fillStyle = css(atmo.sky[0]);
        circle(ctx, mx - 4, my - 3, 8);
        ctx.globalAlpha = 1;
      }
      if (atmo.sunAmt > 0.02) {
        const sx = Math.round(vw * (0.5 + atmo.sunDir[0] * 0.45) - camPx * 0.04);
        const sy = Math.round(horizon - 30 - atmo.sunDir[1] * 150);
        ctx.globalAlpha = atmo.sunAmt * 0.25;
        ctx.fillStyle = css(atmo.sunColor);
        circle(ctx, sx, sy, 18);
        ctx.globalAlpha = atmo.sunAmt;
        circle(ctx, sx, sy, 9);
        ctx.globalAlpha = 1;
      }

      // Far and near hills, clouds between them.
      const hillColor = (k: number) => {
        const a = atmo.sky[2];
        const b = atmo.fog;
        return css([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
      };
      drawHills(ctx, HILLS_FAR, camPx * 0.18, horizon, vw, hillColor(0.55), 0.35);
      if (atmo.cloud) {
        for (const cl of CLOUDS) {
          const span = WORLD_W * TILE * 0.35 + vw + 300;
          const drift = still ? 0 : t * 5;
          const x = Math.round(((cl.x + drift - camPx * 0.35) % span + span) % span - 150);
          const y = Math.round(horizon - cl.y - camPy * 0.1);
          if (x > vw || x + cl.w < 0) continue;
          ctx.globalAlpha = 0.9;
          for (const [px, py, w, h] of cl.parts) {
            ctx.fillStyle = css(atmo.cloud);
            ctx.fillRect(x + px, y + py, w, h);
            ctx.fillStyle = css(atmo.cloudGlow);
            ctx.fillRect(x + px + 1, y + py, w - 2, 1);
          }
          ctx.globalAlpha = 1;
        }
      }
      drawHills(ctx, HILLS_NEAR, camPx * 0.42, horizon, vw, hillColor(0.3), 0.55);

      /* Ground */
      ctx.drawImage(s.terrain, camPx, camPy, vw, vh, 0, 0, vw, vh);

      // Water surface, moving.
      const x0 = Math.floor(camPx / TILE);
      const x1 = Math.ceil((camPx + vw) / TILE);
      const y0 = Math.floor(camPy / TILE);
      const y1 = Math.ceil((camPy + vh) / TILE);
      ctx.fillStyle = PAL.waterTop;
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= WORLD_W) continue;
        for (let y = Math.max(0, y0); y <= y1; y++) {
          if (tileAt(x, y) !== T.WATER || tileAt(x, y - 1) === T.WATER) continue;
          const w = still ? 0 : Math.round(Math.sin(t * 2.2 + x * 0.8) * 1.5);
          ctx.fillRect(x * TILE - camPx, y * TILE - camPy - 1 + w, TILE, 1);
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.35 + atmo.glitter * 0.4;
          ctx.fillRect(x * TILE - camPx + ((x * 5 + Math.floor(t * 3)) % 12), y * TILE - camPy + 1, 2, 1);
          ctx.globalAlpha = 1;
          ctx.fillStyle = PAL.waterTop;
          break;
        }
      }

      // Windows glow after dark.
      if (s.dark > 0.08) {
        ctx.fillStyle = `rgba(255,214,120,${Math.min(0.75, s.dark * 1.1)})`;
        for (const w of WINDOWS) {
          const px = w.x * TILE - camPx;
          const py = w.y * TILE - camPy;
          if (px < -TILE || px > vw || py < -TILE || py > vh) continue;
          ctx.fillRect(px + 2, py + 2, 12, 12);
        }
      }

      /* Things on the island */
      const sx = (x: number) => Math.round(x * TILE - camPx);
      const sy = (z: number) => Math.round(z * TILE - camPy);
      const inView = (x: number, m = 4) => x * TILE - camPx > -m * TILE && x * TILE - camPx < vw + m * TILE;

      if (inView(WORKSHOP.x)) drawGear(ctx, sx(WORKSHOP.x + 0.5) + 2, sy(SURFACE[WORKSHOP.x] - WORKSHOP.h + 1) - 2, still ? 0 : t * 0.9);
      for (const pl of GARDEN_PLOTS) if (inView(pl.x)) drawPlant(ctx, sx(pl.x + 0.5), sy(pl.z), pl.kind, store.garden.growth, t);
      if (inView(STATION.x)) drawStation(ctx, sx(STATION.x + 0.5), sy(STATION.z), t, !!store.meteo);
      for (const sg of PROJECT_SIGNS) if (inView(sg.x)) drawSign(ctx, sx(sg.x + 0.5), sy(sg.z), sg.color, store.seenProjects.has(sg.project.id));
      if (inView(PLAZA.x)) drawBoard(ctx, sx(PLAZA.x + 0.5), sy(PLAZA.z), t);
      if (inView(WELCOME.x)) drawWelcomeSign(ctx, sx(WELCOME.x + 0.5), sy(WELCOME.z));
      if (inView(MAILBOX.x)) drawMailbox(ctx, sx(MAILBOX.x + 0.5), sy(MAILBOX.z));
      if (inView(DANIEL.x)) drawDaniel(ctx, sx(DANIEL.x + 0.5), sy(DANIEL.z), { facing: p.x < DANIEL.x ? -1 : 1, t, wave: s.daniel.wave > 0, blink: s.daniel.blink > 0 });

      // Stars: a glint through the grass, then a floating star.
      s.stars.forEach((sp, i) => {
        const q = STAR_SPOTS[i];
        if (!inView(q.x)) return;
        if (sp.taken) {
          if (sp.t < 0.5) {
            sp.t += 0.016;
            drawStar(ctx, sx(q.x + 0.5), sy(q.z - 0.7) - Math.round(sp.t * 30), 2, '#ffe066');
          }
          return;
        }
        if (!sp.revealed) {
          if (!still && Math.sin(t * 2.2 + i * 1.7) > 0.9) drawStar(ctx, sx(q.x + 0.5), sy(q.z - 0.2), 1, '#fff6c0');
          return;
        }
        const bob = still ? 0 : Math.round(Math.sin(t * 2.5 + i) * 2);
        const size = sp.t < 0.4 ? 1 : 2;
        drawStar(ctx, sx(q.x + 0.5), sy(q.z - 0.7) + bob, size, (Math.floor(t * 6 + i) & 1) ? '#ffe066' : '#fff6c0');
      });

      for (const q of s.particles) {
        const px = sx(q.x);
        const py = sy(q.y);
        const a = clamp(q.life / q.max, 0, 1);
        if (q.kind === 'heart') {
          ctx.globalAlpha = Math.min(1, a * 1.5);
          drawHeart(ctx, px, py, q.c);
        } else if (q.kind === 'z') {
          ctx.globalAlpha = a;
          ctx.fillStyle = q.c;
          ctx.fillRect(px, py, 3, 1);
          ctx.fillRect(px + 1, py + 1, 1, 1);
          ctx.fillRect(px, py + 2, 3, 1);
        } else if (q.kind === 'smoke') {
          ctx.globalAlpha = a * 0.5;
          ctx.fillStyle = q.c;
          const r = 1 + Math.round((1 - a) * 3);
          ctx.fillRect(px - r, py - r, r * 2 + 1, r * 2 + 1);
        } else {
          ctx.globalAlpha = q.kind === 'px' && q.max > 2 ? 1 : Math.min(1, a * 2);
          ctx.fillStyle = q.c;
          ctx.fillRect(px, py, q.s, q.s);
        }
      }
      ctx.globalAlpha = 1;

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
      drawDui(ctx, sx(p.x), sy(p.z + s.lift * 0.6) + (s.inWater ? 4 : 0), pose);

      /* Weather on top of everything */
      if (!still) {
        const nRain = Math.round(atmo.rain * 90);
        while (s.drops.length < nRain) s.drops.push({ x: Math.random() * vw, y: Math.random() * vh, v: 140 + Math.random() * 60, k: 0 });
        if (s.drops.length > nRain) s.drops.length = nRain;
        ctx.fillStyle = 'rgba(190,215,255,0.75)';
        for (const d of s.drops) {
          d.y += d.v / 60;
          d.x -= d.v / 300;
          if (d.y > vh) {
            d.y = -6;
            d.x = Math.random() * vw;
          }
          if (d.x < 0) d.x += vw;
          ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 5);
        }
        const nSnow = Math.round(atmo.snow * 70);
        while (s.flies.length < nSnow + Math.round(atmo.fireflies * 18)) s.flies.push({ x: Math.random() * vw, y: Math.random() * vh, k: Math.random() * 10 });
        if (s.flies.length > nSnow + Math.round(atmo.fireflies * 18)) s.flies.length = nSnow + Math.round(atmo.fireflies * 18);
        s.flies.forEach((f, i) => {
          if (i < nSnow) {
            f.y += 0.4;
            f.x += Math.sin(t * 1.5 + f.k) * 0.3;
            if (f.y > vh) f.y = -2;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(Math.round(f.x), Math.round(f.y), 2, 2);
          } else {
            f.x += Math.sin(t * 0.7 + f.k) * 0.2;
            f.y += Math.cos(t * 0.9 + f.k * 1.3) * 0.2;
            const on = Math.sin(t * 3 + f.k * 4) > 0.3;
            if (on) {
              ctx.fillStyle = '#ffe97a';
              ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
            }
          }
        });
      }

      /* Darkness with light around Dui, the windows and the stars */
      const dark = Math.max(s.dark, s.under * 0.75);
      if (dark > 0.02 && s.light) {
        const l = s.light.getContext('2d')!;
        l.globalCompositeOperation = 'source-over';
        l.clearRect(0, 0, vw, vh);
        l.fillStyle = `rgba(8,10,40,${dark})`;
        l.fillRect(0, 0, vw, vh);
        l.globalCompositeOperation = 'destination-out';
        const lamp = (x: number, y: number, r: number, a: number) => {
          const rg = l.createRadialGradient(x, y, 0, x, y, r);
          rg.addColorStop(0, `rgba(0,0,0,${a})`);
          rg.addColorStop(1, 'rgba(0,0,0,0)');
          l.fillStyle = rg;
          l.fillRect(x - r, y - r, r * 2, r * 2);
        };
        lamp(sx(p.x), sy(p.z - 0.6), TILE * (5.5 + s.under * 1.5), 1);
        for (const w of WINDOWS) {
          const px = w.x * TILE - camPx + 8;
          const py = w.y * TILE - camPy + 8;
          if (px < -60 || px > vw + 60 || py < -60 || py > vh + 60) continue;
          lamp(px, py, TILE * 2.4, 0.9);
        }
        s.stars.forEach((sp, i) => {
          if (!sp.revealed || sp.taken) return;
          lamp(sx(STAR_SPOTS[i].x + 0.5), sy(STAR_SPOTS[i].z - 0.7), TILE * 1.6, 0.9);
        });
        if (inView(STATION.x)) lamp(sx(STATION.x + 0.5) + 2, sy(STATION.z) - 19, 10, 0.8);
        ctx.drawImage(s.light, 0, 0);
      }
      if (atmo.mist > 0.02) {
        ctx.fillStyle = css(atmo.fog, atmo.mist * 0.45);
        ctx.fillRect(0, 0, vw, vh);
        if (!still) {
          ctx.fillStyle = css(atmo.fog, atmo.mist * 0.18);
          for (let b = 0; b < 3; b++) {
            const by = Math.round(((t * 4 + b * 90) % (vh + 60)) - 30);
            ctx.fillRect(0, by, vw, 14 + b * 6);
          }
        }
      }

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
      const swipe = (store as unknown as { __swipe?: (down: boolean, at?: { tx: number; ty: number }) => void }).__swipe;
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
      <canvas ref={canvasRef} onPointerDown={onPointerDown} onContextMenu={(e) => e.preventDefault()} className="block cursor-pointer" style={{ touchAction: 'none', imageRendering: 'pixelated' }} />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 font-cozy" />
    </div>
  );
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // Pixel circle, row by row.
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.round(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}

function drawHills(ctx: CanvasRenderingContext2D, h: Float32Array, offset: number, horizon: number, vw: number, color: string, alpha: number) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let x = 0; x < vw; x += 2) {
    const i = ((Math.floor((x + offset) / 2) % h.length) + h.length) % h.length;
    const hh = Math.round(h[i]);
    ctx.fillRect(x, horizon - hh, 2, hh + 2);
  }
  ctx.globalAlpha = 1;
}

// Keep the island's edges in mind for anyone extending the map.
void ISLAND_X0;
void ISLAND_X1;
void CAVES;
