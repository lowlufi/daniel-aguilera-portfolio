import { TREES, SURFACE, T, tiles, idx, WORLD_W, DANIEL, WELCOME, GARDEN, HOUSE } from './world';
import { PAL, TILE } from './sprites';
import type { WeatherId } from './weather';

/*
 * The cozy layer: everything that makes the island feel lived in rather than
 * merely drawn. A campfire with Daniel's log seats, lanterns that light up at
 * dusk, grass that sways in the breeze, petals drifting off the blossom trees,
 * butterflies by day and fireflies at night, sun rays, a warm color grade and
 * a soft vignette.
 *
 * Kept apart from PixelScene so the scene's physics and the mood can change
 * independently. Everything here is cheap: a handful of sprites in view, glow
 * sprites rendered once and reused, and nothing that runs when reduced motion
 * is on except the static warmth.
 */

type Ctx = CanvasRenderingContext2D;

/** The campfire sits between the welcome sign and Daniel, by his house. */
export const CAMPFIRE = { x: WELCOME.x + 7 };
/** Lantern posts: the plaza, the garden gate, the house porch, the path to the beach. */
export const LANTERNS = [GARDEN.x + 11, 111, HOUSE.x + 8, 182].map((x) => ({ x }));

const R = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
};

/* ── Glow sprites: a radial gradient rendered once per color and size ───── */

const glowCache = new Map<string, HTMLCanvasElement>();
function glowSprite(r: number, color: string) {
  const key = `${r}|${color}`;
  let c = glowCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = r * 2;
    const g = c.getContext('2d')!;
    const rg = g.createRadialGradient(r, r, 0, r, r, r);
    rg.addColorStop(0, color);
    rg.addColorStop(0.35, color.replace(/,\s*[\d.]+\)$/, ',0.45)'));
    rg.addColorStop(1, color.replace(/,\s*[\d.]+\)$/, ',0)'));
    g.fillStyle = rg;
    g.fillRect(0, 0, r * 2, r * 2);
    glowCache.set(key, c);
  }
  return c;
}

/** Additive warm light: brightens what's under it instead of painting over it. */
export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number) {
  if (alpha <= 0.01) return;
  const rr = Math.max(4, Math.round(r));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(glowSprite(rr, color), Math.round(x - rr), Math.round(y - rr));
  ctx.restore();
}

/* ── Campfire ────────────────────────────────────────────────────────────── */

export function drawCampfire(ctx: Ctx, x: number, y: number, t: number, still: boolean) {
  // Two log seats.
  for (const dx of [-24, 11]) {
    R(ctx, x + dx, y - 5, 10, 5, PAL.trunk);
    R(ctx, x + dx, y - 5, 10, 1, PAL.trunkLight);
    R(ctx, x + dx, y - 1, 10, 1, PAL.trunkDark);
    R(ctx, x + dx + 1, y - 4, 2, 2, '#c8a074');
  }
  // Stones ring.
  for (let i = 0; i < 6; i++) R(ctx, x - 8 + i * 3, y - 2 - (i === 0 || i === 5 ? 0 : 1), 3, 2, i & 1 ? PAL.stone : PAL.stoneLight);
  // Crossed logs.
  R(ctx, x - 6, y - 4, 12, 2, PAL.trunkDark);
  R(ctx, x - 4, y - 5, 8, 2, PAL.trunk);
  // Flames: three tongues that flicker.
  const f = still ? 0 : Math.floor(t * 10) % 4;
  const h1 = [7, 9, 8, 10][f];
  const h2 = [10, 8, 11, 9][f];
  const h3 = [6, 8, 7, 6][f];
  R(ctx, x - 4, y - 4 - h1, 3, h1, '#ff8a3c');
  R(ctx, x - 1, y - 4 - h2, 3, h2, '#ff8a3c');
  R(ctx, x + 2, y - 4 - h3, 3, h3, '#ff8a3c');
  R(ctx, x - 3, y - 4 - h1 + 3, 1, h1 - 3, '#ffd23f');
  R(ctx, x, y - 4 - h2 + 3, 1, h2 - 3, '#ffd23f');
  R(ctx, x + 3, y - 4 - h3 + 3, 1, h3 - 3, '#ffd23f');
  R(ctx, x - 1, y - 6, 3, 2, '#fff1b8');
}

/* ── Lanterns ────────────────────────────────────────────────────────────── */

export function drawLantern(ctx: Ctx, x: number, y: number, lit: number, t: number) {
  R(ctx, x - 1, y - 22, 2, 22, PAL.trunkDark);
  R(ctx, x - 1, y - 22, 7, 2, PAL.trunkDark);
  R(ctx, x + 4, y - 20, 1, 2, PAL.metalDark);
  // Lantern body.
  R(ctx, x + 2, y - 18, 5, 1, PAL.metalDark);
  R(ctx, x + 2, y - 17, 5, 5, PAL.metalDark);
  const warm = lit > 0.05 ? (Math.sin(t * 7 + x) > -0.6 ? '#ffd27a' : '#ffc45e') : '#5b5148';
  R(ctx, x + 3, y - 16, 3, 3, warm);
  R(ctx, x + 2, y - 12, 5, 1, PAL.metalDark);
}

/* ── Grass that moves with the wind ──────────────────────────────────────── */

const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/** Tall grass, drawn every frame so the tips can lean with the breeze. */
export function drawSwayingGrass(ctx: Ctx, px: number, py: number, x: number, y: number, t: number, wind: number, push: number) {
  for (let i = 0; i < 4; i++) {
    const h = hash(x, y, 30 + i);
    const bx = px + 2 + (h % 12);
    const bh = 7 + ((h >>> 5) % 6);
    // The wind is a slow wave across the island; Dui walking through pushes it too.
    const lean = Math.round(Math.sin(t * 1.6 + x * 0.45 + i) * wind + push);
    const col = (h >>> 9) & 1 ? PAL.grass : PAL.grassLight;
    const base = py + TILE;
    const mid = Math.round(bh * 0.55);
    R(ctx, bx, base - mid, 1, mid, col);
    R(ctx, bx + Math.round(lean / 2), base - bh + 2, 1, bh - mid - 1, col);
    R(ctx, bx + lean, base - bh, 1, 2, PAL.grassLight);
  }
}

/* ── Life: petals, leaves, butterflies, fireflies ────────────────────────── */

export type Mote = { x: number; y: number; vx: number; vy: number; life: number; kind: 'petal' | 'leaf' | 'butterfly' | 'firefly' | 'spark' | 'ember'; c: string; k: number };

const BLOSSOMS = TREES.filter((tr) => tr.kind === 'blossom');
const LEAFY = TREES.filter((tr) => tr.kind === 'round');
const FLOWERS: number[] = [];
for (let x = 0; x < WORLD_W; x++) if (tiles[idx(x, SURFACE[x] - 1)] === T.FLOWER) FLOWERS.push(x);

export type Mood = {
  /** 0..1 how much dusk/night it is: lanterns, fireflies, the fire's reach. */
  evening: number;
  /** 0..1 daylight: butterflies, sun rays. */
  day: number;
  wind: number;
};

export function moodFor(weather: WeatherId, dark: number): Mood {
  const evening = weather === 'noche' ? 1 : weather === 'atardecer' ? 0.65 : weather === 'lluvia' ? 0.45 : weather === 'niebla' ? 0.35 : Math.min(1, dark * 1.4);
  const day = weather === 'soleado' ? 1 : weather === 'atardecer' ? 0.6 : weather === 'nieve' ? 0.7 : weather === 'niebla' ? 0.3 : 0.1;
  const wind = weather === 'lluvia' ? 2.2 : weather === 'nieve' ? 1.4 : weather === 'atardecer' ? 1.2 : 1;
  return { evening, day, wind };
}

/**
 * Spawns ambient motes around the visible part of the world (in tiles).
 * `x0..x1` / `y0..y1` is the view; motes outside it are not created.
 */
export function spawnMotes(motes: Mote[], dt: number, x0: number, x1: number, y0: number, y1: number, mood: Mood, weather: WeatherId) {
  const r = Math.random;
  if (motes.length > 70) return;
  // Petals off the blossom trees, leaves off the round ones.
  for (const tr of BLOSSOMS) {
    if (tr.x < x0 - 4 || tr.x > x1 + 4) continue;
    if (r() < dt * 0.9) {
      const top = SURFACE[tr.x] - 1 - tr.trunk - tr.r;
      motes.push({ x: tr.x + (r() - 0.5) * (tr.r * 2 + 2), y: top + r() * tr.r * 2, vx: -0.3 - r() * 0.5, vy: 0.5 + r() * 0.4, life: 8, kind: 'petal', c: r() < 0.5 ? PAL.blossom : PAL.blossomLight, k: r() * 10 });
    }
  }
  if (weather !== 'nieve') {
    for (const tr of LEAFY) {
      if (tr.x < x0 - 4 || tr.x > x1 + 4) continue;
      if (r() < dt * 0.15 * mood.wind) {
        const top = SURFACE[tr.x] - 1 - tr.trunk - tr.r;
        motes.push({ x: tr.x + (r() - 0.5) * (tr.r * 2), y: top + r() * tr.r, vx: -0.6 - r() * 0.6, vy: 0.7 + r() * 0.4, life: 7, kind: 'leaf', c: r() < 0.5 ? '#d9a441' : PAL.leafLight, k: r() * 10 });
      }
    }
  }
  // Butterflies by day, near flowers and the garden.
  if (mood.day > 0.5 && weather !== 'lluvia') {
    const n = motes.filter((m) => m.kind === 'butterfly').length;
    if (n < 3 && r() < dt * 0.4) {
      const near = [...FLOWERS, GARDEN.x, GARDEN.x + 4].filter((fx) => fx >= x0 && fx <= x1);
      if (near.length) {
        const fx = near[Math.floor(r() * near.length)];
        motes.push({ x: fx + 0.5, y: SURFACE[fx] - 2 - r() * 2, vx: 0, vy: 0, life: 14, kind: 'butterfly', c: ['#ffd23f', '#ffffff', '#f3a6c8', '#7fc4ff'][Math.floor(r() * 4)], k: r() * 10 });
      }
    }
  }
  // Fireflies in the evening, low over the grass.
  if (mood.evening > 0.4 && weather !== 'lluvia' && weather !== 'nieve') {
    const n = motes.filter((m) => m.kind === 'firefly').length;
    if (n < Math.round(14 * mood.evening) && r() < dt * 3) {
      const fx = x0 + r() * (x1 - x0);
      const sx = Math.max(0, Math.min(WORLD_W - 1, Math.floor(fx)));
      motes.push({ x: fx, y: SURFACE[sx] - 1 - r() * 4, vx: 0, vy: 0, life: 6 + r() * 6, kind: 'firefly', c: '#fff2a0', k: r() * 10 });
    }
  }
  void y0;
  void y1;
}

export function stepMotes(motes: Mote[], dt: number, t: number, wind: number) {
  for (const m of motes) {
    m.life -= dt;
    if (m.kind === 'petal' || m.kind === 'leaf') {
      // Tumbling down: a sideways sway on top of the wind.
      m.x += (m.vx * wind + Math.sin(t * 2 + m.k) * 0.6) * dt;
      m.y += m.vy * dt;
      if (m.y > SURFACE[Math.max(0, Math.min(WORLD_W - 1, Math.floor(m.x)))] - 0.1) {
        m.vy = 0;
        m.vx = 0;
        m.life = Math.min(m.life, 1.2);
      }
    } else if (m.kind === 'butterfly') {
      m.x += Math.sin(t * 0.8 + m.k) * 1.2 * dt;
      m.y += Math.cos(t * 1.3 + m.k * 2) * 0.8 * dt;
    } else if (m.kind === 'firefly') {
      m.x += Math.sin(t * 0.5 + m.k) * 0.5 * dt;
      m.y += Math.cos(t * 0.7 + m.k * 1.7) * 0.35 * dt;
    } else {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.vy -= 0.3 * dt;
    }
  }
}

export function drawMotes(ctx: Ctx, motes: Mote[], t: number, camPx: number, camPy: number) {
  for (const m of motes) {
    const x = Math.round(m.x * TILE - camPx);
    const y = Math.round(m.y * TILE - camPy);
    const fade = Math.min(1, m.life / 1.2);
    if (m.kind === 'petal' || m.kind === 'leaf') {
      ctx.globalAlpha = fade;
      const flip = Math.sin(t * 5 + m.k) > 0;
      R(ctx, x, y, flip ? 2 : 1, flip ? 1 : 2, m.c);
    } else if (m.kind === 'butterfly') {
      ctx.globalAlpha = fade;
      const open = Math.sin(t * 14 + m.k) > 0;
      R(ctx, x, y, 1, 2, PAL.ink);
      if (open) {
        R(ctx, x - 2, y - 1, 2, 2, m.c);
        R(ctx, x + 1, y - 1, 2, 2, m.c);
      } else {
        R(ctx, x - 1, y - 1, 1, 2, m.c);
        R(ctx, x + 1, y - 1, 1, 2, m.c);
      }
    } else if (m.kind === 'firefly') {
      const on = 0.5 + 0.5 * Math.sin(t * 2.6 + m.k * 3);
      ctx.globalAlpha = fade * on;
      R(ctx, x, y, 1, 1, m.c);
      glow(ctx, x, y, 6, 'rgba(255,236,140,0.9)', fade * on * 0.6);
    } else {
      ctx.globalAlpha = fade;
      R(ctx, x, y, 1, 1, m.c);
    }
  }
  ctx.globalAlpha = 1;
}

/* ── Sky and screen-wide mood ────────────────────────────────────────────── */

/** Long soft beams from the sun, drifting slowly. */
export function drawSunRays(ctx: Ctx, sx: number, sy: number, vw: number, vh: number, amt: number, t: number, tint: string) {
  if (amt <= 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const a = -0.35 + i * 0.22 + Math.sin(t * 0.07 + i) * 0.03;
    const w = 10 + (i % 3) * 8;
    ctx.globalAlpha = amt * (0.05 + (i % 2) * 0.03);
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.sin(a) * vh * 1.6 - w, sy + Math.cos(a) * vh * 1.6);
    ctx.lineTo(sx + Math.sin(a) * vh * 1.6 + w, sy + Math.cos(a) * vh * 1.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  void vw;
}

/** A soft round cloud, rendered once per shape and color. */
const cloudCache = new Map<string, HTMLCanvasElement>();
export function cloudSprite(seed: number, w: number, body: string, light: string) {
  const key = `${seed}|${w}|${body}|${light}`;
  let c = cloudCache.get(key);
  if (!c) {
    if (cloudCache.size > 40) cloudCache.clear();
    c = document.createElement('canvas');
    const h = Math.round(w * 0.42);
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    let a = seed * 9301 + 49297;
    const rnd = () => ((a = (a * 9301 + 49297) % 233280), a / 233280);
    const puff = (cx: number, cy: number, r: number, col: string) => {
      g.fillStyle = col;
      for (let dy = -r; dy <= r; dy++) {
        const ww = Math.round(Math.sqrt(r * r - dy * dy));
        g.fillRect(cx - ww, cy + dy, ww * 2 + 1, 1);
      }
    };
    const n = 4 + Math.floor(rnd() * 3);
    const puffs: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.round(h * (0.22 + rnd() * 0.2));
      const cx = Math.round(r + rnd() * (w - r * 2));
      const cy = Math.round(h - r - 1 - rnd() * (h * 0.25));
      puffs.push([cx, cy, r]);
    }
    // Flat bottom, darker underside, lit tops.
    for (const [cx, cy, r] of puffs) puff(cx, cy, r, body);
    g.fillStyle = body;
    g.fillRect(Math.round(w * 0.12), Math.round(h * 0.62), Math.round(w * 0.76), Math.round(h * 0.38) - 1);
    for (const [cx, cy, r] of puffs) puff(cx, cy - 1, Math.max(1, r - 2), light);
    cloudCache.set(key, c);
  }
  return c;
}

/** Vignette and color grade, rendered once per screen size and mood. */
const gradeCache: { key: string; c: HTMLCanvasElement | null } = { key: '', c: null };
export function drawGrade(ctx: Ctx, vw: number, vh: number, weather: WeatherId, under: number) {
  const tone: Record<WeatherId, string> = {
    soleado: 'rgba(255,214,150,0.06)',
    atardecer: 'rgba(255,150,90,0.12)',
    lluvia: 'rgba(90,120,160,0.08)',
    niebla: 'rgba(220,210,230,0.06)',
    noche: 'rgba(60,70,160,0.10)',
    nieve: 'rgba(200,225,255,0.06)',
  };
  const key = `${vw}x${vh}|${weather}|${Math.round(under * 4)}`;
  if (gradeCache.key !== key) {
    const c = gradeCache.c ?? document.createElement('canvas');
    c.width = vw;
    c.height = vh;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, vw, vh);
    g.fillStyle = tone[weather];
    g.fillRect(0, 0, vw, vh);
    const r = Math.hypot(vw, vh) / 2;
    const vg = g.createRadialGradient(vw / 2, vh * 0.55, r * 0.45, vw / 2, vh * 0.55, r * 1.05);
    vg.addColorStop(0, 'rgba(20,10,30,0)');
    vg.addColorStop(1, `rgba(20,10,30,${0.32 + under * 0.25})`);
    g.fillStyle = vg;
    g.fillRect(0, 0, vw, vh);
    gradeCache.c = c;
    gradeCache.key = key;
  }
  if (gradeCache.c) ctx.drawImage(gradeCache.c, 0, 0);
}
