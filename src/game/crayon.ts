import {
  T,
  TREES,
  HOUSE,
  WORKSHOP,
  GARDEN,
  GARDEN_PLOTS,
  DOCK,
  SURFACE,
  SEA_LEVEL,
  WORLD_W,
  WORLD_H,
  tileAt,
  inIsland,
  isSolidTile,
} from './world';

/*
 * Crayon on paper.
 *
 * The island is drawn like a kid's drawing in a sketchbook: wobbly wax
 * strokes in two passes, hatched fills, and specks where the crayon skipped
 * over the paper grain. An original take on that hand-made look.
 *
 * Every wobble comes from a hash of the WORLD position of the point, never
 * from Math.random(): the same line looks the same every frame (no shimmer),
 * and an edge drawn by two neighbouring terrain chunks lands on the same
 * pixels, so chunk seams don't show.
 *
 * Units are the scene's virtual pixels (16 per block).
 */

type Ctx = CanvasRenderingContext2D;
export const TILE = 16;

export const INK = {
  paper: '#f7f1e3',
  paperDark: '#e9dfc8',
  rule: 'rgba(120,150,190,0.16)',
  graphite: '#4a4038',
  brown: '#7a4a2a',
  brownDark: '#5a3418',
  dirt: '#b07a4a',
  dirtDeep: '#8a5a36',
  grass: '#4caf3a',
  grassDark: '#2f8a2a',
  grassLight: '#8fd45c',
  sand: '#e8c86a',
  sandDark: '#c9a24a',
  stone: '#8a8a92',
  stoneDark: '#5e5e68',
  water: '#3f8fd8',
  waterLight: '#7cc0f0',
  sky: '#6fb4ee',
  orange: '#f28a2e',
  orangeDark: '#c8611a',
  orangeLight: '#ffb35c',
  cream: '#fff3dc',
  pink: '#f48fb1',
  red: '#e0463a',
  redDark: '#a82f26',
  yellow: '#ffd23f',
  wood: '#c08a52',
  woodDark: '#8a5a2e',
  brick: '#d4654a',
  roof: '#d6453a',
  glass: '#9fd4f5',
  leaf: '#4caf50',
  leafDark: '#2e8b3e',
  blossom: '#f6a3c9',
  blossomDark: '#e07aa8',
  pine: '#2f8f5a',
  pineDark: '#1f6a40',
  teal: '#2f9e8f',
  jeans: '#4a6aa8',
  skin: '#f4caa4',
  hair: '#4a2d1b',
  beard: '#b5602e',
  metal: '#9aa3ad',
  purple: '#9b7fd1',
};

/* ── Deterministic noise by position ─────────────────────────────────────── */

function hash(x: number, y: number, s: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** -1..1, stable for a given point (quantized to a quarter pixel). */
const jit = (x: number, y: number, salt: number) => hash(Math.round(x * 4), Math.round(y * 4), salt) * 2 - 1;

type Pt = [number, number];

/** Splits a polyline into ~4px steps and nudges each point a little. */
function wobble(pts: Pt[], amp: number, salt: number, closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(len / 4));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      out.push([x + jit(x, y, salt) * amp, y + jit(y, x, salt + 7) * amp]);
    }
  }
  if (!closed) {
    const [x, y] = pts[pts.length - 1];
    out.push([x + jit(x, y, salt) * amp, y + jit(y, x, salt + 7) * amp]);
  }
  return out;
}

function trace(ctx: Ctx, pts: Pt[], closed: boolean) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

/** A wax line: a firm pass and a lighter, thinner one slightly off. */
export function crayon(ctx: Ctx, pts: Pt[], color: string, width = 1.6, closed = false, salt = 1) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = width;
  ctx.beginPath();
  trace(ctx, wobble(pts, 0.55, salt, closed), closed);
  ctx.stroke();
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = width * 0.6;
  ctx.beginPath();
  trace(ctx, wobble(pts, 0.9, salt + 31, closed), closed);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Path of a lumpy closed shape (blob, cloud, canopy). */
export function blob(cx: number, cy: number, rx: number, ry: number, lumps: number, salt: number): Pt[] {
  const pts: Pt[] = [];
  const n = Math.max(10, Math.round((rx + ry) * 0.9));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const bump = 1 + 0.12 * Math.sin(a * lumps + salt) + 0.05 * jit(cx + i, cy, salt);
    pts.push([cx + Math.cos(a) * rx * bump, cy + Math.sin(a) * ry * bump]);
  }
  return pts;
}

export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 18): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/**
 * Hatching: parallel diagonal strokes over a box, to be used inside a clip.
 * Spacing and angle vary a touch per stroke so it reads as hand-made.
 */
export function hatch(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, alpha = 0.5, spacing = 3.2, angle = -0.95, width = 1.1, salt = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const reach = (w + h) / 2 + 4;
  ctx.beginPath();
  // Anchor the lines to the world grid of `spacing` so neighbours line up.
  const base = Math.floor((cx * nx + cy * ny) / spacing) * spacing;
  for (let k = -reach; k <= reach; k += spacing) {
    const o = base + k - (cx * nx + cy * ny);
    const px = cx + nx * o;
    const py = cy + ny * o;
    // Wobble by line number only: the same stroke drawn by two neighbouring
    // chunks must land in the same place, or the seam shows.
    const line = Math.round((base + k) / spacing);
    // Only a sideways nudge, never a tilt: a tilted line pivots around a
    // different point in each chunk and stops lining up at the seam.
    const j = jit(line, salt, salt) * 0.6;
    const a = angle;
    const ex = Math.cos(a) * reach;
    const ey = Math.sin(a) * reach;
    ctx.moveTo(px - ex + j, py - ey);
    ctx.lineTo(px + ex + j, py + ey);
  }
  ctx.stroke();
  ctx.restore();
}

/** Fill a shape like a crayon would: a pale wash, hatching, then the outline. */
export function filled(ctx: Ctx, pts: Pt[], fill: string, line: string, opts: { wash?: number; hatch?: number; spacing?: number; angle?: number; width?: number; salt?: number } = {}) {
  const salt = opts.salt ?? 5;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  ctx.save();
  ctx.beginPath();
  trace(ctx, wobble(pts, 0.5, salt, true), true);
  ctx.clip();
  ctx.globalAlpha = opts.wash ?? 0.35;
  ctx.fillStyle = fill;
  ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
  ctx.globalAlpha = 1;
  hatch(ctx, x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4, fill, opts.hatch ?? 0.75, opts.spacing ?? 2.6, opts.angle ?? -0.95, 1.2, salt);
  ctx.restore();
  crayon(ctx, pts, line, opts.width ?? 1.5, true, salt);
}

export function dot(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 0.95) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* ── Paper and wax grain ─────────────────────────────────────────────────── */

let paperCache: { key: string; c: HTMLCanvasElement } | null = null;
/** The sketchbook page: warm paper, fibres and faint ruled lines. Device pixels. */
export function paper(w: number, h: number, r: number): HTMLCanvasElement {
  const key = `${w}x${h}@${r}`;
  if (paperCache?.key === key) return paperCache.c;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = INK.paper;
  g.fillRect(0, 0, w, h);
  // Fibres and specks.
  let a = 12345;
  const rnd = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0), a / 4294967296);
  for (let i = 0; i < (w * h) / 90; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(160,130,90,0.07)' : 'rgba(255,255,255,0.35)';
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2 * r, r * 0.6);
  }
  // Ruled lines, like a notebook page.
  g.strokeStyle = INK.rule;
  g.lineWidth = Math.max(1, r * 0.6);
  const gap = 26 * r;
  for (let y = gap; y < h; y += gap) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  // Soft darker edges, like the page curves away.
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  vg.addColorStop(0, 'rgba(120,90,50,0)');
  vg.addColorStop(1, 'rgba(120,90,50,0.16)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  paperCache = { key, c };
  return c;
}

let grainCache: HTMLCanvasElement | null = null;
/** Little holes where wax didn't reach the paper. Used with destination-out. */
export function grain(): HTMLCanvasElement {
  if (grainCache) return grainCache;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  let a = 777;
  const rnd = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0), a / 4294967296);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.55})`;
    g.fillRect(Math.floor(rnd() * 96), Math.floor(rnd() * 96), 1 + (rnd() < 0.2 ? 1 : 0), 1);
  }
  grainCache = c;
  return c;
}

/* ── Terrain, painted once per chunk ─────────────────────────────────────── */

export const CHUNK = 8; // blocks per side
/** Default device px per virtual px in the chunk cache (the scene passes its own). */
export const CHUNK_RES = 2;

const SOIL_LIKE = new Set<number>([T.DIRT, T.GRASS, T.SOIL]);

function materialOf(t: number) {
  if (SOIL_LIKE.has(t)) return 'dirt';
  if (t === T.SAND) return 'sand';
  if (t === T.STONE || t === T.ORE) return 'stone';
  return null;
}

/** Paints the blocks of one chunk (cx, cy) into `g`, in world virtual units. */
export function paintChunk(g: Ctx, cx: number, cy: number, cutGrass: (i: number) => boolean, res = CHUNK_RES) {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const px0 = x0 * TILE;
  const py0 = y0 * TILE;
  const size = CHUNK * TILE;
  g.save();
  g.setTransform(res, 0, 0, res, -px0 * res, -py0 * res);
  g.clearRect(px0, py0, size, size);
  g.beginPath();
  g.rect(px0, py0, size, size);
  g.clip();

  // 1. Underground air (caves, dug holes): a dark, loose hatch behind.
  const bg = new Path2D();
  let anyBg = false;
  for (let y = y0; y < y0 + CHUNK; y++)
    for (let x = x0; x < x0 + CHUNK; x++) {
      const t = tileAt(x, y);
      if (inIsland(x) && y > SURFACE[Math.max(0, Math.min(WORLD_W - 1, x))] && !isSolidTile(t) && t !== T.WATER) {
        bg.rect(x * TILE, y * TILE, TILE, TILE);
        anyBg = true;
      }
    }
  if (anyBg) {
    g.save();
    g.clip(bg);
    // Opaque paper first: nothing behind the ground shows through.
    g.fillStyle = INK.paper;
    g.fillRect(px0, py0, size, size);
    g.globalAlpha = 0.35;
    g.fillStyle = INK.brownDark;
    g.fillRect(px0, py0, size, size);
    g.globalAlpha = 1;
    hatch(g, px0, py0, size, size, INK.brownDark, 0.45, 4.2, 0.8, 1, 11);
    g.restore();
  }

  // 2. Materials: a wash and a hatch for each, clipped to its blocks.
  const mats: Record<string, Path2D> = {};
  const water = new Path2D();
  let anyWater = false;
  for (let y = y0 - 1; y <= y0 + CHUNK; y++)
    for (let x = x0 - 1; x <= x0 + CHUNK; x++) {
      const t = tileAt(x, y);
      if (t === T.WATER || t === T.POST || t === T.PLANK) {
        if (t !== T.PLANK || tileAt(x, y + 1) === T.WATER) {
          water.rect(x * TILE, y * TILE + (t === T.PLANK ? 8 : 0), TILE, t === T.PLANK ? 8 : TILE);
          anyWater = true;
        }
      }
      const m = materialOf(t);
      if (!m) continue;
      (mats[m] ??= new Path2D()).rect(x * TILE - 0.5, y * TILE - 0.5, TILE + 1, TILE + 1);
    }
  if (anyWater) {
    g.save();
    g.clip(water);
    g.fillStyle = INK.paper;
    g.fillRect(px0, py0, size, size);
    g.globalAlpha = 0.3;
    g.fillStyle = INK.water;
    g.fillRect(px0, py0, size, size);
    g.globalAlpha = 1;
    // Horizontal, loose wavy strokes.
    g.strokeStyle = INK.water;
    g.lineWidth = 1.2;
    g.globalAlpha = 0.55;
    g.beginPath();
    for (let y = py0 + 3; y < py0 + size; y += 5) {
      const pts: Pt[] = [];
      for (let x = px0 - 4; x <= px0 + size + 4; x += 6) pts.push([x, y + Math.sin(x * 0.18 + y) * 1.2]);
      trace(g, wobble(pts, 0.6, 21, false), false);
    }
    g.stroke();
    g.globalAlpha = 1;
    g.restore();
  }
  const look: Record<string, { fill: string; deep: string; wash: number; angle: number; spacing: number }> = {
    dirt: { fill: INK.dirt, deep: INK.dirtDeep, wash: 0.32, angle: -0.95, spacing: 3 },
    sand: { fill: INK.sand, deep: INK.sandDark, wash: 0.38, angle: -0.7, spacing: 3.4 },
    stone: { fill: INK.stone, deep: INK.stoneDark, wash: 0.3, angle: -1.15, spacing: 2.8 },
  };
  for (const m of Object.keys(mats)) {
    const L = look[m];
    g.save();
    g.clip(mats[m]);
    // The ground is paper painted over: opaque, so the distant hills and the
    // sky don't show through the dirt.
    g.globalAlpha = 1;
    g.fillStyle = INK.paper;
    g.fillRect(px0, py0, size, size);
    g.globalAlpha = L.wash;
    g.fillStyle = L.fill;
    g.fillRect(px0, py0, size, size);
    g.globalAlpha = 1;
    hatch(g, px0, py0, size, size, L.fill, 0.6, L.spacing, L.angle, 1.2, m.length);
    // Deeper ground gets a second, crossing pass: darker the deeper it goes.
    if (m !== 'sand') hatch(g, px0, py0, size, size, L.deep, 0.32, 4.4, L.angle + 1.7, 1, m.length + 9);
    g.restore();
  }

  // 3. Edges: a crayon line wherever a block meets air or water.
  for (let y = y0; y < y0 + CHUNK; y++)
    for (let x = x0; x < x0 + CHUNK; x++) {
      const t = tileAt(x, y);
      const m = materialOf(t);
      if (!m) continue;
      const X = x * TILE;
      const Y = y * TILE;
      const open = (nx: number, ny: number) => !materialOf(tileAt(nx, ny)) && tileAt(nx, ny) !== T.SOIL;
      const line = m === 'stone' ? INK.stoneDark : m === 'sand' ? INK.sandDark : INK.brown;
      if (open(x, y - 1)) {
        if (t === T.GRASS) {
          crayon(g, [[X, Y], [X + TILE, Y]], INK.grass, 3.2, false, 4);
          crayon(g, [[X, Y + 2], [X + TILE, Y + 2]], INK.grassDark, 1.4, false, 6);
          // Little grass ticks, like a kid draws them.
          g.strokeStyle = INK.grassDark;
          g.lineWidth = 1;
          g.globalAlpha = 0.8;
          g.beginPath();
          for (let k = 0; k < 4; k++) {
            const bx = X + 2 + k * 4 + jit(X + k, Y, 3) * 1.2;
            g.moveTo(bx, Y + 0.5);
            g.lineTo(bx + jit(bx, Y, 8) * 1.5, Y - 2.5 - (hash(bx, Y, 2) * 2));
          }
          g.stroke();
          g.globalAlpha = 1;
        } else crayon(g, [[X, Y], [X + TILE, Y]], line, 1.8, false, 4);
      }
      if (open(x - 1, y)) crayon(g, [[X, Y], [X, Y + TILE]], line, 1.6, false, 5);
      if (open(x + 1, y)) crayon(g, [[X + TILE, Y], [X + TILE, Y + TILE]], line, 1.6, false, 5);
      if (open(x, y + 1)) crayon(g, [[X, Y + TILE], [X + TILE, Y + TILE]], line, 1.6, false, 4);
      if (t === T.ORE) {
        dot(g, X + 5 + hash(x, y, 1) * 6, Y + 5 + hash(x, y, 2) * 6, 1.6, hash(x, y, 3) < 0.5 ? INK.yellow : INK.waterLight);
        dot(g, X + 4 + hash(x, y, 4) * 8, Y + 4 + hash(x, y, 5) * 8, 1.2, INK.purple);
      }
      if (t === T.SOIL) {
        g.save();
        g.beginPath();
        g.rect(X, Y, TILE, TILE);
        g.clip();
        hatch(g, X, Y, TILE, TILE, INK.brownDark, 0.7, 2.4, -0.4, 1.2, 14);
        g.restore();
      }
    }

  // 4. Things drawn whole and clipped to this chunk, so seams line up.
  const inChunk = (wx0: number, wx1: number, wy0: number, wy1: number) => wx1 >= x0 && wx0 <= x0 + CHUNK && wy1 >= y0 && wy0 <= y0 + CHUNK;
  for (const tr of TREES) {
    const base = SURFACE[tr.x];
    if (inChunk(tr.x - 4, tr.x + 4, base - tr.trunk - tr.r * 2 - 3, base)) drawTree(g, tr);
  }
  for (const b of [HOUSE, WORKSHOP]) {
    const L = SURFACE[b.x];
    if (inChunk(b.x - b.w, b.x + b.w, L - b.h - 6, L)) drawBuilding(g, b, b === HOUSE);
  }
  if (inChunk(DOCK.x0 - 1, DOCK.x1 + 1, DOCK.y - 1, DOCK.y + 6)) drawDock(g);
  for (const fx of [GARDEN.x - 9, GARDEN.x + 9]) {
    const s = SURFACE[fx];
    if (inChunk(fx - 1, fx + 1, s - 2, s)) drawFence(g, fx, s);
  }
  for (let x = x0 - 1; x <= x0 + CHUNK; x++) {
    if (x < 0 || x >= WORLD_W) continue;
    const ty = SURFACE[x] - 1;
    if (ty < y0 - 1 || ty > y0 + CHUNK) continue;
    const t = tileAt(x, ty);
    if (t === T.FLOWER) drawFlower(g, x, ty);
    else if (t === T.TALLGRASS && cutGrass(ty * WORLD_W + x)) {
      // Stubble left after a swipe.
      g.strokeStyle = INK.grassDark;
      g.lineWidth = 1.1;
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const bx = x * TILE + 3 + k * 3.5;
        g.moveTo(bx, ty * TILE + TILE);
        g.lineTo(bx + 0.5, ty * TILE + TILE - 3);
      }
      g.stroke();
    }
  }
  void GARDEN_PLOTS;
  void SEA_LEVEL;
  void WORLD_H;
  g.restore();
}

function drawTree(g: Ctx, tr: (typeof TREES)[number]) {
  const base = SURFACE[tr.x] * TILE;
  const cx = tr.x * TILE + TILE / 2;
  const top = base - tr.trunk * TILE;
  // Trunk: two lines, a hatch, a knot.
  filled(g, [[cx - 4, base], [cx - 3, top + 4], [cx + 3, top + 4], [cx + 4, base]], INK.wood, INK.woodDark, { salt: tr.x, spacing: 2.4, angle: -1.4 });
  if (tr.kind === 'pine') {
    for (let k = 0; k < 3; k++) {
      const w = 18 - k * 4.5;
      const y = top + 8 - k * 13;
      filled(g, [[cx - w, y], [cx, y - 20], [cx + w, y]], INK.pine, INK.pineDark, { salt: tr.x + k, spacing: 2.2 });
    }
    return;
  }
  const r = tr.r * TILE * 0.95;
  const cy = top - r * 0.55;
  const fill = tr.kind === 'blossom' ? INK.blossom : INK.leaf;
  const line = tr.kind === 'blossom' ? INK.blossomDark : INK.leafDark;
  filled(g, blob(cx, cy, r * 1.15, r * 0.85, 5, tr.x), fill, line, { salt: tr.x, spacing: 2.4, wash: 0.45 });
  if (tr.fruit) for (let k = 0; k < 4; k++) dot(g, cx - r * 0.6 + hash(tr.x, k, 1) * r * 1.2, cy - r * 0.4 + hash(tr.x, k, 2) * r * 0.8, 2, INK.red);
  if (tr.kind === 'blossom') for (let k = 0; k < 6; k++) dot(g, cx - r * 0.8 + hash(tr.x, k, 3) * r * 1.6, cy - r * 0.5 + hash(tr.x, k, 4) * r, 1.4, '#ffffff', 0.9);
}

function drawBuilding(g: Ctx, b: { x: number; w: number; h: number }, house: boolean) {
  const L = SURFACE[b.x] * TILE;
  const x0 = (b.x - Math.floor(b.w / 2)) * TILE;
  const x1 = x0 + b.w * TILE;
  const top = L - b.h * TILE;
  // Walls
  filled(g, [[x0, L], [x0, top], [x1, top], [x1, L]], house ? INK.wood : INK.brick, house ? INK.woodDark : INK.redDark, { salt: b.x, spacing: house ? 3.2 : 2.8, angle: house ? -1.5 : -0.9, wash: 0.42 });
  if (house) {
    g.strokeStyle = INK.woodDark;
    g.globalAlpha = 0.5;
    g.lineWidth = 1;
    g.beginPath();
    for (let y = top + 12; y < L; y += 12) {
      g.moveTo(x0 + 2, y);
      g.lineTo(x1 - 2, y + jit(x0, y, 3));
    }
    g.stroke();
    g.globalAlpha = 1;
  } else {
    g.strokeStyle = INK.cream;
    g.globalAlpha = 0.7;
    g.lineWidth = 1;
    g.beginPath();
    for (let y = top + 6, row = 0; y < L; y += 6, row++) {
      g.moveTo(x0 + 1, y);
      g.lineTo(x1 - 1, y);
      for (let x = x0 + (row % 2 ? 6 : 12); x < x1; x += 12) {
        g.moveTo(x, y - 6);
        g.lineTo(x, y);
      }
    }
    g.stroke();
    g.globalAlpha = 1;
  }
  // Stepped roof, the same shape Dui can climb.
  const pts: Pt[] = [];
  const y = top;
  pts.push([x0 - TILE, y]);
  for (let step = 0; step < 3; step++) {
    const lx = x0 - TILE + step * 2 * TILE;
    pts.push([lx, y - step * TILE - TILE]);
    pts.push([lx + 2 * TILE, y - step * TILE - TILE]);
  }
  const rpts: Pt[] = [];
  for (let step = 2; step >= 0; step--) {
    const rx = x1 + TILE - step * 2 * TILE;
    rpts.push([rx - 2 * TILE, y - step * TILE - TILE]);
    rpts.push([rx, y - step * TILE - TILE]);
  }
  const roof: Pt[] = [[x0 - TILE, y], ...pts.slice(1), ...rpts, [x1 + TILE, y]];
  filled(g, roof, INK.roof, INK.redDark, { salt: b.x + 3, spacing: 2.4, angle: -0.6, wash: 0.5 });
  // Windows and door, from the block map.
  const wy = L - b.h * TILE + 2 * TILE;
  for (const wx of [x0 + TILE, x1 - 3 * TILE]) {
    filled(g, [[wx + 1, wy + 1], [wx + 2 * TILE - 1, wy + 1], [wx + 2 * TILE - 1, wy + 2 * TILE - 1], [wx + 1, wy + 2 * TILE - 1]], INK.glass, INK.woodDark, { salt: wx, spacing: 3.6, wash: 0.5, hatch: 0.4 });
    crayon(g, [[wx + TILE, wy + 2], [wx + TILE, wy + 2 * TILE - 2]], INK.woodDark, 1.4, false, 9);
    crayon(g, [[wx + 2, wy + TILE], [wx + 2 * TILE - 2, wy + TILE]], INK.woodDark, 1.4, false, 9);
  }
  const dx = (b.x - 1) * TILE;
  filled(g, [[dx + 1, L], [dx + 1, L - 2 * TILE + 3], [dx + 2 * TILE - 1, L - 2 * TILE + 3], [dx + 2 * TILE - 1, L]], house ? INK.brownDark : INK.woodDark, INK.brownDark, { salt: dx, spacing: 2.2, wash: 0.55 });
  dot(g, dx + 2 * TILE - 6, L - TILE, 1.6, INK.yellow);
  if (house) {
    const cx = x0 + (b.w - 2) * TILE;
    const cTop = top - 4 * TILE;
    filled(g, [[cx + 1, top - 2 * TILE], [cx + 1, cTop], [cx + TILE - 1, cTop], [cx + TILE - 1, top - 2 * TILE]], INK.stone, INK.stoneDark, { salt: cx, spacing: 2.4 });
  } else {
    // Sign on the workshop.
    g.save();
    g.font = 'bold 9px "Patrick Hand", "Comic Sans MS", cursive';
    g.fillStyle = INK.cream;
    g.textAlign = 'center';
    g.fillText('TALLER', b.x * TILE + TILE / 2, top + 11);
    g.restore();
  }
}

function drawDock(g: Ctx) {
  const y = DOCK.y * TILE;
  for (let x = DOCK.x0; x <= DOCK.x1; x++) {
    const X = x * TILE;
    filled(g, [[X, y], [X + TILE, y], [X + TILE, y + 6], [X, y + 6]], INK.wood, INK.woodDark, { salt: x, spacing: 2.6, angle: -1.5, width: 1.2 });
  }
  for (const px of [DOCK.x0 + 2, DOCK.x0 + 8, DOCK.x1 - 1]) {
    const X = px * TILE + 6;
    filled(g, [[X, y + 6], [X + 4, y + 6], [X + 4, y + 70], [X, y + 70]], INK.woodDark, INK.brownDark, { salt: px, spacing: 2 });
  }
}

function drawFence(g: Ctx, fx: number, s: number) {
  const X = fx * TILE;
  const Y = s * TILE;
  crayon(g, [[X + 3, Y], [X + 3, Y - 14]], INK.woodDark, 2, false, fx);
  crayon(g, [[X + 13, Y], [X + 13, Y - 14]], INK.woodDark, 2, false, fx + 1);
  crayon(g, [[X - 2, Y - 10], [X + 18, Y - 10]], INK.wood, 1.8, false, fx + 2);
  crayon(g, [[X - 2, Y - 5], [X + 18, Y - 5]], INK.wood, 1.8, false, fx + 3);
}

function drawFlower(g: Ctx, x: number, ty: number) {
  const cx = x * TILE + 5 + hash(x, ty, 40) * 6;
  const base = ty * TILE + TILE;
  const col = [INK.pink, INK.yellow, '#ffffff', INK.purple][Math.floor(hash(x, ty, 41) * 4)];
  crayon(g, [[cx, base], [cx + 0.5, base - 8]], INK.grassDark, 1.2, false, x);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    dot(g, cx + Math.cos(a) * 2.2, base - 9 + Math.sin(a) * 2.2, 1.6, col);
  }
  dot(g, cx, base - 9, 1.2, INK.orangeDark);
}

/* ── Things drawn every frame ────────────────────────────────────────────── */

/** Tall grass, leaning with the breeze; pushed aside when Dui walks through. */
export function crayonGrass(g: Ctx, x: number, ty: number, t: number, wind: number, push: number) {
  const base = ty * TILE + TILE;
  g.lineCap = 'round';
  g.lineWidth = 1.3;
  for (let k = 0; k < 4; k++) {
    const bx = x * TILE + 2 + k * 3.6 + jit(x, k, 30) * 1.2;
    const h = 8 + hash(x, k, 31) * 6;
    const lean = Math.sin(t * 1.6 + x * 0.45 + k) * wind + push;
    g.strokeStyle = k % 2 ? INK.grass : INK.grassDark;
    g.beginPath();
    g.moveTo(bx, base);
    g.quadraticCurveTo(bx + lean * 0.3, base - h * 0.6, bx + lean, base - h);
    g.stroke();
  }
}

export type DuiPose = {
  facing: 1 | -1;
  phase: number;
  amt: number;
  air: number;
  sit: boolean;
  sleep: boolean;
  blink: boolean;
  swing: number;
  tail: number;
  squish: number;
  swim: number;
};

/**
 * Dui, a chubby orange tabby, feet centered at (x, y).
 * About 30 units long and 22 tall: rounder than a block is wide.
 */
export function crayonDui(g: Ctx, x: number, y: number, p: DuiPose) {
  g.save();
  g.translate(x, y);
  if (p.facing < 0) g.scale(-1, 1);
  const sq = p.squish * 0.18;
  // Gentle bounce with each step (none when sitting or asleep).
  const bob = p.sit || p.sleep ? 0 : Math.abs(Math.sin(p.phase)) * 1.4 * p.amt;
  g.translate(0, -bob);
  g.scale(1 + sq, 1 - sq);

  // Ground shadow.
  g.globalAlpha = 0.18;
  g.fillStyle = INK.graphite;
  g.beginPath();
  g.ellipse(0, bob + 0.5, 15, 2, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;

  if (p.sleep) {
    // A round loaf with the tail wrapped around it.
    filled(g, ellipsePts(-1, -8, 15, 8.5), INK.orange, INK.orangeDark, { salt: 101, spacing: 2.2, wash: 0.55 });
    crayon(g, [[-14, -2], [-6, 0.5], [6, 0.5], [12, -2]], INK.orangeDark, 2.4, false, 102);
    filled(g, blob(9, -12, 6.5, 6, 3, 7), INK.orange, INK.orangeDark, { salt: 103, spacing: 2.2, wash: 0.55 });
    crayon(g, [[5, -17], [6.5, -21], [8.5, -17.5]], INK.orangeDark, 1.4, false, 104);
    crayon(g, [[10.5, -17.5], [12.5, -21], [13.5, -16.5]], INK.orangeDark, 1.4, false, 105);
    crayon(g, [[7, -12], [9, -11.2]], INK.graphite, 1.2, false, 106);
    crayon(g, [[11, -12], [13, -11.2]], INK.graphite, 1.2, false, 107);
    g.restore();
    return;
  }

  // Tail: a thick curve that sways; curls up when walking.
  const tw = Math.sin(p.tail) * 3;
  if (p.sit) crayon(g, [[-8, -1], [-2, 0.5], [5, 0], [9, -1.5]], INK.orangeDark, 3, false, 110);
  else {
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = INK.orange;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-13, -10);
    g.quadraticCurveTo(-20, -12, -20 + tw * 0.5, -19);
    g.quadraticCurveTo(-19 + tw, -24, -16 + tw, -23);
    g.stroke();
    g.restore();
    crayon(g, [[-13, -10], [-19, -12], [-20 + tw * 0.5, -19], [-16 + tw, -23]], INK.orangeDark, 1.2, false, 111);
  }

  // Legs: short and stubby, swinging in pairs.
  const step = Math.sin(p.phase) * 2.2 * p.amt;
  const tuck = p.air !== 0 ? 1.5 : 0;
  const leg = (lx: number, front: boolean, ph: number) => {
    const dx = front ? ph : -ph;
    filled(g, [[lx - 2 + dx, -5], [lx + 2 + dx, -5], [lx + 2 + dx * 1.3, -tuck], [lx - 2 + dx * 1.3, -tuck]], INK.orange, INK.orangeDark, { salt: 120 + lx, spacing: 2.4, width: 1.2 });
    dot(g, lx + dx * 1.3, -tuck - 0.4, 1.8, INK.cream);
  };
  if (p.sit) {
    leg(4, true, 0);
    leg(8, true, 0);
  } else if (p.swim > 0) {
    leg(-8, false, step);
    leg(6, true, step);
  } else {
    leg(-9, false, step);
    leg(-4, false, -step);
    leg(4, true, step);
    leg(9, true, -step);
  }

  // Body: big round belly that hangs a little.
  const body = p.sit ? ellipsePts(-1, -12, 10, 11) : ellipsePts(-1, -10, 14.5, 9);
  filled(g, body, INK.orange, INK.orangeDark, { salt: 130, spacing: 2.2, wash: 0.55, width: 1.7 });
  // Cream belly.
  g.save();
  g.beginPath();
  g.ellipse(p.sit ? 1 : 1, p.sit ? -7 : -5, p.sit ? 6 : 9, p.sit ? 6 : 4, 0, 0, Math.PI * 2);
  g.clip();
  g.globalAlpha = 0.85;
  g.fillStyle = INK.cream;
  g.fillRect(-12, -14, 24, 14);
  g.restore();
  g.globalAlpha = 1;
  // Tabby stripes on the back.
  for (let k = 0; k < 3; k++) {
    const sx = (p.sit ? -6 : -9) + k * 5;
    crayon(g, [[sx, p.sit ? -21 : -18], [sx + 1.5, p.sit ? -16 : -14]], INK.orangeDark, 1.5, false, 140 + k);
  }

  // Head
  const hx = p.sit ? 3 : 10;
  const hy = p.sit ? -24 : -17;
  filled(g, blob(hx, hy, 7.5, 6.8, 2, 9), INK.orange, INK.orangeDark, { salt: 150, spacing: 2.2, wash: 0.55, width: 1.6 });
  // Ears
  filled(g, [[hx - 6, hy - 3], [hx - 4.5, hy - 9.5], [hx - 1, hy - 5]], INK.orange, INK.orangeDark, { salt: 151, width: 1.3 });
  filled(g, [[hx + 1.5, hy - 5], [hx + 4.5, hy - 9.5], [hx + 6, hy - 3]], INK.orange, INK.orangeDark, { salt: 152, width: 1.3 });
  dot(g, hx - 4.2, hy - 5.5, 1, INK.pink);
  dot(g, hx + 4, hy - 5.5, 1, INK.pink);
  // "M" on the forehead.
  crayon(g, [[hx - 2.5, hy - 2], [hx - 1.5, hy - 4], [hx, hy - 2.5], [hx + 1.5, hy - 4], [hx + 2.5, hy - 2]], INK.orangeDark, 1, false, 153);
  // Muzzle
  dot(g, hx + 3.5, hy + 2.5, 3, INK.cream, 0.9);
  // Eyes
  if (p.blink) {
    crayon(g, [[hx - 3, hy + 0.5], [hx - 0.5, hy + 0.8]], INK.graphite, 1.2, false, 154);
    crayon(g, [[hx + 2.5, hy + 0.5], [hx + 5, hy + 0.8]], INK.graphite, 1.2, false, 155);
  } else {
    dot(g, hx - 1.7, hy, 1.7, '#7cc04a');
    dot(g, hx + 3.7, hy, 1.7, '#7cc04a');
    dot(g, hx - 1.4, hy + 0.2, 0.9, INK.graphite);
    dot(g, hx + 4, hy + 0.2, 0.9, INK.graphite);
    dot(g, hx - 2, hy - 0.6, 0.45, '#ffffff');
    dot(g, hx + 3.4, hy - 0.6, 0.45, '#ffffff');
  }
  // Nose, mouth, whiskers
  dot(g, hx + 5.5, hy + 2, 1, INK.pink);
  crayon(g, [[hx + 3.6, hy + 3.6], [hx + 4.6, hy + 4.3], [hx + 5.6, hy + 3.6]], INK.graphite, 0.8, false, 156);
  crayon(g, [[hx + 6.5, hy + 2.2], [hx + 11, hy + 1.2]], INK.graphite, 0.6, false, 157);
  crayon(g, [[hx + 6.5, hy + 3.4], [hx + 11, hy + 4]], INK.graphite, 0.6, false, 158);

  // Swipe: a paw out and three scratch marks.
  if (p.swing > 0.02) {
    const reach = p.swing * 9;
    crayon(g, [[hx + 2, -8], [hx + 4 + reach, -9]], INK.orange, 3.4, false, 160);
    dot(g, hx + 5 + reach, -9, 2, INK.cream);
    g.globalAlpha = p.swing;
    for (let k = 0; k < 3; k++) crayon(g, [[hx + 9 + reach + k * 2, -14 + k * 3], [hx + 12 + reach + k * 2, -11 + k * 3]], INK.graphite, 1, false, 161 + k);
    g.globalAlpha = 1;
  }
  if (p.swim > 0) {
    g.strokeStyle = INK.waterLight;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(-17, -3);
    g.quadraticCurveTo(-8, -6, 0, -3);
    g.quadraticCurveTo(8, 0, 17, -3);
    g.stroke();
  }
  g.restore();
}

export type DanielPose = { facing: 1 | -1; t: number; wave: boolean; blink: boolean };

/** Daniel: hoodie, jeans, brown hair and a copper beard. Feet at (x, y). */
export function crayonDaniel(g: Ctx, x: number, y: number, p: DanielPose) {
  g.save();
  g.translate(x, y);
  if (p.facing < 0) g.scale(-1, 1);
  const bob = Math.sin(p.t * 1.6) * 0.5;
  g.globalAlpha = 0.18;
  g.fillStyle = INK.graphite;
  g.beginPath();
  g.ellipse(0, 0.5, 8, 1.5, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  // Legs
  filled(g, [[-4, 0], [-4, -11], [-0.5, -11], [-0.5, 0]], INK.jeans, '#2e4578', { salt: 201, width: 1.2 });
  filled(g, [[0.5, 0], [0.5, -11], [4, -11], [4, 0]], INK.jeans, '#2e4578', { salt: 202, width: 1.2 });
  crayon(g, [[-5, 0], [-0.5, 0]], INK.graphite, 2.2, false, 203);
  crayon(g, [[0.5, 0], [5, 0]], INK.graphite, 2.2, false, 204);
  // Hoodie
  filled(g, [[-5.5, -10 + bob], [-5, -22 + bob], [5, -22 + bob], [5.5, -10 + bob]], INK.teal, '#1f6f64', { salt: 205, spacing: 2.2, wash: 0.5 });
  // Arms
  crayon(g, [[-5, -21 + bob], [-7, -14 + bob], [-6.5, -11 + bob]], INK.teal, 3, false, 206);
  dot(g, -6.5, -10.5 + bob, 1.6, INK.skin);
  if (p.wave) {
    const up = Math.sin(p.t * 9) * 2;
    crayon(g, [[5, -21 + bob], [8, -26 + bob + up], [8.5, -30 + bob + up]], INK.teal, 3, false, 207);
    dot(g, 8.6, -31 + bob + up, 1.7, INK.skin);
  } else {
    crayon(g, [[5, -21 + bob], [7, -14 + bob], [6.5, -11 + bob]], INK.teal, 3, false, 207);
    dot(g, 6.5, -10.5 + bob, 1.6, INK.skin);
  }
  // Head, hair, beard
  filled(g, blob(0, -27 + bob, 5.2, 5.6, 2, 3), INK.skin, '#b98a64', { salt: 208, spacing: 3, wash: 0.6, hatch: 0.35 });
  filled(g, [[-5.5, -27 + bob], [-5, -32.5 + bob], [0, -34 + bob], [5, -32 + bob], [5.5, -28 + bob], [3, -30 + bob], [-3, -30 + bob]], INK.hair, '#2e1a0e', { salt: 209, spacing: 1.8, wash: 0.7 });
  filled(g, [[-4.8, -26 + bob], [-3.5, -21.5 + bob], [0, -20.5 + bob], [3.5, -21.5 + bob], [4.8, -26 + bob], [2, -24 + bob], [-2, -24 + bob]], INK.beard, '#8a4520', { salt: 210, spacing: 1.8, wash: 0.7 });
  if (!p.blink) {
    dot(g, -1.8, -27.5 + bob, 0.8, INK.graphite);
    dot(g, 2, -27.5 + bob, 0.8, INK.graphite);
  } else {
    crayon(g, [[-2.6, -27.3 + bob], [3, -27.3 + bob]], INK.graphite, 0.8, false, 211);
  }
  crayon(g, [[-1, -24.5 + bob], [1, -24.2 + bob]], '#8a4520', 0.8, false, 212);
  g.restore();
}

export function crayonSign(g: Ctx, x: number, y: number, color: string, read: boolean) {
  crayon(g, [[x, y], [x, y - 12]], INK.woodDark, 2.2, false, Math.round(x));
  filled(g, [[x - 7, y - 11], [x - 7, y - 20], [x + 7, y - 20], [x + 7, y - 11]], color, INK.woodDark, { salt: Math.round(x) + 1, spacing: 2.2, wash: 0.55 });
  if (read) crayon(g, [[x - 3, y - 15.5], [x - 0.5, y - 13], [x + 4, y - 18]], '#1e7a3a', 1.8, false, Math.round(x) + 2);
}

export function crayonBoard(g: Ctx, x: number, y: number) {
  crayon(g, [[x - 9, y], [x - 9, y - 16]], INK.woodDark, 2.4, false, 301);
  crayon(g, [[x + 9, y], [x + 9, y - 16]], INK.woodDark, 2.4, false, 302);
  filled(g, [[x - 13, y - 14], [x - 13, y - 29], [x + 13, y - 29], [x + 13, y - 14]], INK.wood, INK.woodDark, { salt: 303, spacing: 2.6, wash: 0.5 });
  const papers = [INK.cream, '#ffe3a3', INK.glass, INK.blossom, '#b6e39a'];
  for (let i = 0; i < 5; i++) {
    const px = x - 11 + i * 4.6;
    const py = y - 27 + (i % 2) * 5;
    filled(g, [[px, py], [px + 4, py], [px + 4, py + 6], [px, py + 6]], papers[i], INK.graphite, { salt: 304 + i, spacing: 3, wash: 0.8, hatch: 0.3, width: 0.8 });
    dot(g, px + 2, py + 0.8, 0.9, INK.red);
  }
}

export function crayonWelcome(g: Ctx, x: number, y: number) {
  crayon(g, [[x, y], [x, y - 12]], INK.woodDark, 2.4, false, 401);
  filled(g, [[x - 9, y - 11], [x - 9, y - 21], [x + 9, y - 21], [x + 9, y - 11]], INK.wood, INK.woodDark, { salt: 402, spacing: 2.6, wash: 0.5 });
  // A heart.
  filled(g, [[x, y - 13], [x - 4, y - 17], [x - 2.5, y - 19.5], [x, y - 18], [x + 2.5, y - 19.5], [x + 4, y - 17]], INK.red, INK.redDark, { salt: 403, spacing: 1.8, width: 1 });
}

export function crayonMailbox(g: Ctx, x: number, y: number) {
  crayon(g, [[x, y], [x, y - 13]], INK.woodDark, 2.4, false, 501);
  filled(g, [[x - 6, y - 12], [x - 6, y - 19], [x - 3, y - 22], [x + 3, y - 22], [x + 6, y - 19], [x + 6, y - 12]], INK.red, INK.redDark, { salt: 502, spacing: 2, wash: 0.55 });
  crayon(g, [[x + 6, y - 17], [x + 6, y - 25], [x + 10, y - 24], [x + 6, y - 22.5]], INK.yellow, 1.6, false, 503);
}

export function crayonStation(g: Ctx, x: number, y: number, t: number, online: boolean) {
  crayon(g, [[x, y], [x, y - 17]], INK.metal, 2.2, false, 601);
  filled(g, [[x - 5, y - 16], [x - 5, y - 25], [x + 5, y - 25], [x + 5, y - 16]], '#4a5060', INK.graphite, { salt: 602, spacing: 2, wash: 0.6 });
  crayon(g, [[x + 3, y - 25], [x + 3, y - 33]], INK.metal, 1.4, false, 603);
  dot(g, x + 3, y - 34, 1.4, INK.metal);
  const on = Math.floor(t * 2) % 2 === 0;
  dot(g, x + 2, y - 21, 1.6, on ? (online ? '#5ee05a' : '#ff5252') : '#2a2f36');
  filled(g, [[x - 11, y - 25], [x - 3, y - 29], [x - 2, y - 26], [x - 10, y - 22]], '#3a6fc0', INK.graphite, { salt: 604, spacing: 1.8, width: 1 });
}

export function crayonGear(g: Ctx, x: number, y: number, angle: number) {
  const pts: Pt[] = [];
  for (let i = 0; i < 16; i++) {
    const a = angle + (i / 16) * Math.PI * 2;
    const r = i % 2 ? 5 : 7;
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  g.save();
  g.lineWidth = 1.6;
  g.strokeStyle = INK.graphite;
  g.fillStyle = INK.metal;
  g.globalAlpha = 0.85;
  g.beginPath();
  trace(g, pts, true);
  g.fill();
  g.stroke();
  g.globalAlpha = 1;
  g.restore();
  dot(g, x, y, 2, INK.graphite);
}

export function crayonPlant(g: Ctx, x: number, y: number, kind: 'sunflower' | 'carrot' | 'tomato' | 'cabbage', growth: number, t: number) {
  const k = Math.max(0, Math.min(1, (growth - 1) / 0.45));
  const sway = Math.sin(t * 1.3 + x) * k;
  if (kind === 'sunflower') {
    const h = 6 + k * 16;
    crayon(g, [[x, y], [x + sway, y - h]], INK.grassDark, 1.6, false, 701);
    crayon(g, [[x, y - h * 0.5], [x - 4, y - h * 0.62]], INK.grass, 1.4, false, 702);
    if (k > 0.3) {
      const r = 2.5 + k * 2.5;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        dot(g, x + sway + Math.cos(a) * r, y - h + Math.sin(a) * r, 1.8, INK.yellow);
      }
      dot(g, x + sway, y - h, r * 0.55, '#7a4a2a');
    }
  } else if (kind === 'tomato') {
    const h = 4 + k * 10;
    filled(g, blob(x, y - h / 2, 5, h / 2, 3, 703), INK.leaf, INK.leafDark, { salt: 703, spacing: 2, width: 1.1 });
    if (k > 0.6) {
      dot(g, x - 2, y - h * 0.4, 2.2, INK.red);
      dot(g, x + 2.5, y - h * 0.65, 2.2, INK.red);
    }
  } else if (kind === 'carrot') {
    const h = 3 + k * 9;
    for (let i = -1; i <= 1; i++) crayon(g, [[x, y], [x + i * 2.5 + sway * 0.5, y - h]], INK.grass, 1.4, false, 704 + i);
    if (k > 0.7) filled(g, [[x - 2.5, y], [x + 2.5, y], [x, y + 4]], INK.orange, INK.orangeDark, { salt: 707, width: 1 });
  } else {
    const r = 2 + k * 4;
    filled(g, blob(x, y - r, r * 1.2, r, 4, 708), '#9ed27a', INK.leafDark, { salt: 708, spacing: 2, width: 1.2 });
  }
}

/* ── Sky ─────────────────────────────────────────────────────────────────── */

export function crayonSun(g: Ctx, x: number, y: number, t: number, still: boolean) {
  filled(g, blob(x, y, 11, 11, 3, 801), INK.yellow, '#f0a020', { salt: 801, spacing: 2.4, wash: 0.6 });
  g.save();
  g.strokeStyle = '#f0a020';
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  const spin = still ? 0 : t * 0.12;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = spin + (i / 10) * Math.PI * 2;
    g.moveTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15);
    g.lineTo(x + Math.cos(a) * (20 + (i % 2) * 3), y + Math.sin(a) * (20 + (i % 2) * 3));
  }
  g.stroke();
  g.restore();
}

export function crayonMoon(g: Ctx, x: number, y: number) {
  filled(g, [...ellipsePts(x, y, 10, 10, 20).slice(5, 16), [x - 2, y + 6], [x + 1, y], [x - 2, y - 6]], '#f4ecc0', '#c8b870', { salt: 802, spacing: 2.2, wash: 0.7 });
}

export function crayonCloud(g: Ctx, x: number, y: number, w: number, salt: number, fill: string, line: string) {
  const pts: Pt[] = [];
  const bumps = 4 + (salt % 3);
  // Flat bottom, round bumps on top.
  pts.push([x, y]);
  for (let i = 0; i <= bumps * 6; i++) {
    const u = i / (bumps * 6);
    const bx = x + u * w;
    const b = Math.abs(Math.sin(u * Math.PI * bumps)) * (w * 0.12) + Math.sin(u * Math.PI) * w * 0.18;
    pts.push([bx, y - b]);
  }
  pts.push([x + w, y]);
  filled(g, pts, fill, line, { salt, spacing: 3.2, wash: 0.55, hatch: 0.35, width: 1.4 });
}

export function crayonStar(g: Ctx, x: number, y: number, r: number, color: string, line = '#e0a000') {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  filled(g, pts, color, line, { salt: Math.round(x * 3 + y), spacing: 1.8, wash: 0.8, width: 1.1 });
}

export function crayonHeart(g: Ctx, x: number, y: number, s: number, color: string) {
  filled(g, [[x, y + s], [x - s * 1.2, y - s * 0.1], [x - s * 0.7, y - s * 0.9], [x, y - s * 0.3], [x + s * 0.7, y - s * 0.9], [x + s * 1.2, y - s * 0.1]], color, '#c0405a', { salt: 901, spacing: 1.6, width: 1 });
}

/** Distant hills: just a soft crayon outline with a few hatch strokes. */
export function crayonHills(g: Ctx, heights: Float32Array, offset: number, horizon: number, vw: number, color: string, alpha: number) {
  const pts: Pt[] = [];
  for (let x = -4; x <= vw + 8; x += 8) {
    const i = ((Math.floor((x + offset) / 2) % heights.length) + heights.length) % heights.length;
    pts.push([x, horizon - heights[i]]);
  }
  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  g.moveTo(-4, horizon + 4);
  for (const [px, py] of pts) g.lineTo(px, py);
  g.lineTo(vw + 8, horizon + 4);
  g.closePath();
  g.clip();
  g.fillStyle = color;
  g.globalAlpha = alpha * 0.35;
  g.fillRect(-4, horizon - 120, vw + 12, 130);
  g.globalAlpha = alpha;
  hatch(g, -4 - (offset % 6), horizon - 120, vw + 20, 130, color, 0.35, 5, -0.9, 1, 17);
  g.restore();
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = 1.4;
  g.beginPath();
  trace(g, pts, false);
  g.stroke();
  g.restore();
}

export function crayonCampfire(g: Ctx, x: number, y: number, t: number, still: boolean) {
  // Log seats on both sides.
  for (const dx of [-24, 11]) filled(g, [[x + dx, y], [x + dx, y - 5], [x + dx + 12, y - 5], [x + dx + 12, y]], INK.wood, INK.woodDark, { salt: 1001 + dx, spacing: 2.4, angle: -1.5, width: 1.3 });
  // Stones and crossed logs.
  for (let i = 0; i < 5; i++) dot(g, x - 8 + i * 4, y - 1.5, 2.2, i % 2 ? INK.stone : INK.stoneDark);
  crayon(g, [[x - 7, y - 2], [x + 6, y - 5]], INK.woodDark, 2.6, false, 1003);
  crayon(g, [[x - 6, y - 5], [x + 7, y - 2]], INK.wood, 2.6, false, 1004);
  // Flames: a few tongues that flicker.
  const f = still ? 0 : t;
  const tongue = (dx: number, h: number, col: string, salt: number) => {
    const sway = Math.sin(f * 9 + salt) * 1.5;
    filled(g, [[x + dx - 3, y - 4], [x + dx + sway, y - 4 - h], [x + dx + 3, y - 4]], col, col === INK.yellow ? '#f0a020' : INK.orangeDark, { salt, spacing: 1.8, wash: 0.7, width: 1.1 });
  };
  tongue(-2.5, 9 + Math.sin(f * 11) * 1.5, INK.orange, 1005);
  tongue(2.5, 8 + Math.sin(f * 13 + 1) * 1.5, INK.orange, 1006);
  tongue(0, 12 + Math.sin(f * 10 + 2) * 2, INK.orange, 1007);
  tongue(0, 7 + Math.sin(f * 12 + 3), INK.yellow, 1008);
}

export function crayonLantern(g: Ctx, x: number, y: number, lit: number) {
  crayon(g, [[x, y], [x, y - 22], [x + 6, y - 22]], INK.woodDark, 2, false, Math.round(x));
  crayon(g, [[x + 5, y - 22], [x + 5, y - 19]], INK.graphite, 0.8, false, Math.round(x) + 1);
  filled(g, [[x + 2, y - 12], [x + 2, y - 18], [x + 8, y - 18], [x + 8, y - 12]], lit > 0.05 ? INK.yellow : '#b8ad98', INK.graphite, { salt: Math.round(x) + 2, spacing: 2, wash: lit > 0.05 ? 0.85 : 0.4, width: 1.2 });
}
