import { T, SURFACE, WORLD_W, tileAt, inIsland, isSolidTile } from './world';

/*
 * Pixel art in the style of mid-90s PC games (SimCity 2000, RollerCoaster
 * Tycoon): a rich fixed palette, three-tone shading, 4x4 ordered dithering
 * for gradients, and a dark outline wherever a shape meets the air.
 *
 * Drawn at 1 unit = 1 virtual pixel; the canvas is upscaled by a whole number
 * with nearest-neighbour so every pixel stays square and crisp.
 */

type Ctx = CanvasRenderingContext2D;
export const TILE = 16;

export const P = {
  outline: '#20140e',
  // Grass
  g0: '#2f6b1f',
  g1: '#3f8f2a',
  g2: '#5fb43a',
  g3: '#8fd65a',
  // Dirt
  d0: '#4a2a16',
  d1: '#6e4022',
  d2: '#8f5a30',
  d3: '#b07a44',
  // Stone
  s0: '#3c3a44',
  s1: '#5c5866',
  s2: '#7d7887',
  s3: '#a39ead',
  // Sand
  a0: '#b08a44',
  a1: '#d4b064',
  a2: '#ead08a',
  a3: '#fbe9b4',
  // Water
  w0: '#14406e',
  w1: '#1f6aa8',
  w2: '#3a92d0',
  w3: '#8ad0f4',
  // Wood
  k0: '#4a2c14',
  k1: '#7a4a24',
  k2: '#a46a36',
  k3: '#cc9454',
  // Brick and roof
  b0: '#6a2218',
  b1: '#9c3a26',
  b2: '#c45a3a',
  b3: '#e08a64',
  r0: '#5a1a14',
  r1: '#8e2a20',
  r2: '#c2402c',
  r3: '#e8705a',
  // Glass
  gl0: '#2a5a8a',
  gl1: '#5aa0d8',
  gl2: '#bfe6fa',
  // Leaves
  l0: '#1f4a1a',
  l1: '#2f7a2a',
  l2: '#4aa23a',
  l3: '#7fd25a',
  // Blossom
  p0: '#8a3a6a',
  p1: '#d0689c',
  p2: '#f09ac0',
  p3: '#ffd0e4',
  // Pine
  n0: '#123a24',
  n1: '#1f5a36',
  n2: '#2f7e4a',
  n3: '#4fa66a',
  // Dui (orange tabby)
  o0: '#6a2e0e',
  o1: '#b8561a',
  o2: '#ec8a2e',
  o3: '#ffb860',
  cream: '#fff0d8',
  cream1: '#e8cfa8',
  pink: '#f48aa4',
  eye: '#7ed04a',
  // Daniel
  skin: '#f0c49c',
  skin1: '#c8946c',
  hair: '#3e2414',
  beard: '#a8501e',
  beard1: '#7a3612',
  teal: '#2a9a8a',
  teal1: '#1c6e62',
  jeans: '#3a5a9a',
  jeans1: '#283e6e',
  // Misc
  white: '#ffffff',
  gold: '#ffd23f',
  gold1: '#c89a1a',
  red: '#e0402c',
  red1: '#9a2418',
  metal: '#a8b0ba',
  metal1: '#6a7280',
  earth0: '#21140c',
  earth1: '#2e1d12',
};

const R = (g: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
};

const hash = (x: number, y: number, s = 0) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/* ── Ordered dithering ───────────────────────────────────────────────────── */

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const patCache = new Map<string, HTMLCanvasElement>();
/** A 4x4 tile with `color` on the cells below `level` (0..16), transparent elsewhere. */
function ditherTile(color: string, level: number) {
  const key = `${color}|${level}`;
  let c = patCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 4;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    for (let i = 0; i < 16; i++) if (BAYER[i] < level) g.fillRect(i % 4, (i / 4) | 0, 1, 1);
    patCache.set(key, c);
  }
  return c;
}
/** Covers a box with `color` at a dither `level` (0..16), aligned to the world grid. */
export function dither(g: Ctx, x: number, y: number, w: number, h: number, color: string, level: number) {
  if (level <= 0) return;
  if (level >= 16) return R(g, x, y, w, h, color);
  const tile = ditherTile(color, level);
  // Pattern anchored at 0,0 of the current transform: neighbouring boxes match.
  const pat = g.createPattern(tile, 'repeat')!;
  g.fillStyle = pat;
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
}

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const hex = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const quant = (c: number[]) => c.map((v) => Math.round(v / 12) * 12);

/* ── Sky: dithered bands, cached per weather and width ───────────────────── */

let skyCache: { key: string; c: HTMLCanvasElement } | null = null;
export const SKY_H = 360;
/**
 * The sky as a strip SKY_H tall that ends at the horizon. Colors go from the
 * top of the sky to the horizon in five stops; each step is a band, and the
 * band edge is dithered into the next color like old VGA skies.
 */
export function sky(vw: number, stops: number[][]): HTMLCanvasElement {
  const q = stops.map(quant);
  const key = `${vw}|${q.flat().join(',')}`;
  if (skyCache?.key === key) return skyCache.c;
  const c = document.createElement('canvas');
  c.width = vw;
  c.height = SKY_H;
  const g = c.getContext('2d')!;
  const bands = 18;
  const bh = SKY_H / bands;
  const at = (u: number) => {
    const f = u * (q.length - 1);
    const i = Math.min(q.length - 2, Math.floor(f));
    return mix(q[i], q[i + 1], f - i);
  };
  for (let b = 0; b < bands; b++) {
    const y = Math.round(b * bh);
    const h = Math.round((b + 1) * bh) - y;
    R(g, 0, y, vw, h, hex(at(b / bands)));
    // Dither the bottom third of each band into the next one.
    const next = hex(at((b + 1) / bands));
    dither(g, 0, y + Math.round(h * 0.45), vw, Math.ceil(h * 0.3), next, 4);
    dither(g, 0, y + Math.round(h * 0.75), vw, h - Math.round(h * 0.75), next, 10);
  }
  skyCache = { key, c };
  return c;
}

/* ── Tiles ───────────────────────────────────────────────────────────────── */

function dirt(g: Ctx, px: number, py: number, x: number, y: number, depth: number) {
  R(g, px, py, TILE, TILE, depth > 5 ? P.d1 : P.d2);
  dither(g, px, py, TILE, TILE, P.d1, depth > 5 ? 6 : 3);
  // Pebbles: light top, dark bottom.
  for (let i = 0; i < 2; i++) {
    const h = hash(x, y, i + 1);
    const sx = px + 2 + (h % 11);
    const sy = py + 2 + ((h >>> 8) % 11);
    R(g, sx, sy, 3, 2, P.d3);
    R(g, sx, sy + 2, 3, 1, P.d0);
  }
  if (hash(x, y, 9) % 3 === 0) R(g, px + (hash(x, y, 5) % 13), py + (hash(x, y, 6) % 13), 2, 1, P.d0);
}

function stone(g: Ctx, px: number, py: number, x: number, y: number) {
  R(g, px, py, TILE, TILE, P.s1);
  // Cobbles: two rows of rounded stones with light tops and dark seams.
  const off = (y & 1) * 4;
  for (let row = 0; row < 2; row++) {
    for (let k = -1; k < 2; k++) {
      const sx = px + k * 8 + (row ? off + 4 : off);
      const sy = py + row * 8;
      R(g, sx + 1, sy + 1, 6, 6, P.s2);
      R(g, sx + 1, sy + 1, 6, 1, P.s3);
      R(g, sx + 1, sy + 1, 1, 5, P.s3);
      R(g, sx + 1, sy + 7, 7, 1, P.s0);
      R(g, sx + 7, sy + 1, 1, 7, P.s0);
    }
  }
}

export function drawTile90(g: Ctx, t: number, px: number, py: number, x: number, y: number, cut: boolean) {
  const depth = y - SURFACE[Math.max(0, Math.min(WORLD_W - 1, x))];
  switch (t) {
    case T.DIRT:
      dirt(g, px, py, x, y, depth);
      break;
    case T.GRASS: {
      dirt(g, px, py, x, y, 0);
      // A thick grass cap with a ragged, dithered lower edge.
      R(g, px, py, TILE, 5, P.g2);
      R(g, px, py, TILE, 1, P.g3);
      dither(g, px, py + 1, TILE, 2, P.g3, 4);
      for (let i = 0; i < TILE; i++) {
        const drop = 5 + (hash(x * 16 + i, y, 3) % 3);
        R(g, px + i, py + 5, 1, drop - 5, P.g1);
        R(g, px + i, py + drop, 1, 1, P.g0);
      }
      break;
    }
    case T.STONE:
      stone(g, px, py, x, y);
      break;
    case T.ORE: {
      stone(g, px, py, x, y);
      const gem = hash(x, y, 2) & 1 ? P.gold : P.w3;
      const dark = hash(x, y, 2) & 1 ? P.gold1 : P.w1;
      for (let i = 0; i < 3; i++) {
        const h = hash(x, y, 10 + i);
        const sx = px + 2 + (h % 10);
        const sy = py + 2 + ((h >>> 6) % 10);
        R(g, sx, sy, 3, 3, dark);
        R(g, sx, sy, 2, 2, gem);
        R(g, sx, sy, 1, 1, P.white);
      }
      break;
    }
    case T.SAND:
      R(g, px, py, TILE, TILE, P.a2);
      dither(g, px, py, TILE, TILE, P.a1, depth > 1 ? 6 : 3);
      if (hash(x, y, 4) % 4 === 0) {
        const sx = px + 3 + (hash(x, y, 5) % 9);
        R(g, sx, py + 6, 3, 2, P.a3);
        R(g, sx + 1, py + 8, 1, 1, P.a0);
      }
      break;
    case T.WATER: {
      const above = tileAt(x, y - 1);
      const deep = Math.min(1, Math.max(0, (y - 43) / 8));
      R(g, px, py, TILE, TILE, deep > 0.5 ? P.w0 : P.w1);
      dither(g, px, py, TILE, TILE, deep > 0.5 ? P.w1 : P.w2, Math.round(10 - deep * 8));
      if (above !== T.WATER && above !== T.POST) {
        R(g, px, py, TILE, 2, P.w3);
        dither(g, px, py + 2, TILE, 2, P.w3, 6);
      }
      if (hash(x, y, 7) % 3 === 0) R(g, px + (hash(x, y, 8) % 9), py + 6 + (hash(x, y, 9) % 6), 5, 1, P.w2);
      break;
    }
    case T.POST:
      drawTile90(g, T.WATER, px, py, x, y, false);
      R(g, px + 5, py, 6, TILE, P.k1);
      R(g, px + 5, py, 2, TILE, P.k2);
      R(g, px + 10, py, 1, TILE, P.k0);
      break;
    case T.PLANK:
      drawTile90(g, T.WATER, px, py, x, y, false);
      R(g, px, py, TILE, 7, P.k2);
      R(g, px, py, TILE, 1, P.k3);
      R(g, px, py + 6, TILE, 1, P.k0);
      R(g, px + ((x & 1) ? 3 : 11), py + 1, 1, 5, P.k1);
      R(g, px + 2, py + 3, 1, 1, P.k0);
      R(g, px + 13, py + 3, 1, 1, P.k0);
      break;
    case T.WOODWALL:
      R(g, px, py, TILE, TILE, P.k2);
      for (let i = 0; i < 4; i++) {
        R(g, px, py + i * 4, TILE, 1, P.k3);
        R(g, px, py + i * 4 + 3, TILE, 1, P.k1);
      }
      R(g, px + ((y & 1) ? 6 : 12), py, 1, TILE, P.k1);
      break;
    case T.BRICKWALL:
      R(g, px, py, TILE, TILE, P.b2);
      for (let row = 0; row < 4; row++) {
        const yy = py + row * 4;
        R(g, px, yy + 3, TILE, 1, P.b0);
        const off = (row + y) & 1 ? 0 : 4;
        for (let k = 0; k < 3; k++) R(g, px + off + k * 8 - 1, yy, 1, 3, P.b0);
        R(g, px, yy, TILE, 1, P.b3);
      }
      break;
    case T.ROOF:
      R(g, px, py, TILE, TILE, P.r2);
      for (let row = 0; row < 4; row++) {
        const yy = py + row * 4;
        const off = row & 1 ? 2 : 0;
        for (let k = 0; k < 4; k++) {
          R(g, px + off + k * 4, yy, 3, 1, P.r3);
          R(g, px + off + k * 4 + 3, yy, 1, 3, P.r1);
        }
        R(g, px, yy + 3, TILE, 1, P.r0);
      }
      break;
    case T.WINDOW:
      R(g, px, py, TILE, TILE, P.k0);
      R(g, px + 1, py + 1, 14, 14, P.gl1);
      dither(g, px + 1, py + 8, 14, 7, P.gl0, 8);
      R(g, px + 2, py + 2, 4, 1, P.gl2);
      R(g, px + 2, py + 2, 1, 4, P.gl2);
      R(g, px + 7, py + 1, 2, 14, P.k1);
      R(g, px + 1, py + 7, 14, 2, P.k1);
      break;
    case T.DOOR:
      R(g, px, py, TILE, TILE, P.k1);
      R(g, px + 2, py + 2, 12, 5, P.k0);
      R(g, px + 2, py + 9, 12, 5, P.k0);
      R(g, px + 3, py + 3, 10, 3, P.k2);
      R(g, px + 3, py + 10, 10, 3, P.k2);
      if (hash(x, y) & 1) R(g, px + 12, py + 8, 2, 2, P.gold);
      break;
    case T.CHIMNEY:
      R(g, px, py, TILE, TILE, P.s2);
      for (let row = 0; row < 4; row++) R(g, px, py + row * 4 + 3, TILE, 1, P.s0);
      R(g, px + 7, py, 1, 3, P.s0);
      R(g, px + 3, py + 4, 1, 3, P.s0);
      R(g, px + 11, py + 4, 1, 3, P.s0);
      break;
    case T.TRUNK:
      R(g, px + 4, py, 8, TILE, P.k1);
      R(g, px + 4, py, 2, TILE, P.k2);
      R(g, px + 10, py, 2, TILE, P.k0);
      R(g, px + 7, py + (hash(x, y) % 10), 2, 3, P.k0);
      break;
    case T.LEAVES:
    case T.LEAVES_FRUIT:
    case T.LEAVES_BLOSSOM:
    case T.LEAVES_PINE: {
      const pal = t === T.LEAVES_BLOSSOM ? [P.p0, P.p1, P.p2, P.p3] : t === T.LEAVES_PINE ? [P.n0, P.n1, P.n2, P.n3] : [P.l0, P.l1, P.l2, P.l3];
      R(g, px, py, TILE, TILE, pal[1]);
      // Clusters: round lumps, lit from the top left.
      for (let k = 0; k < 4; k++) {
        const h = hash(x, y, 20 + k);
        const cx = px + (k % 2) * 8 + (h % 3);
        const cy = py + ((k / 2) | 0) * 8 + ((h >>> 4) % 3);
        R(g, cx + 1, cy, 5, 6, pal[2]);
        R(g, cx, cy + 1, 7, 4, pal[2]);
        R(g, cx + 1, cy + 1, 2, 2, pal[3]);
        R(g, cx + 1, cy + 6, 5, 1, pal[0]);
      }
      if (t === T.LEAVES_FRUIT && hash(x, y, 3) % 3 === 0) {
        const fx = px + 4 + (hash(x, y, 6) % 8);
        const fy = py + 4 + (hash(x, y, 8) % 8);
        R(g, fx, fy, 3, 3, P.red);
        R(g, fx, fy, 1, 1, P.white);
      }
      break;
    }
    case T.TALLGRASS:
      if (cut) {
        for (let i = 0; i < 4; i++) R(g, px + 2 + i * 4, py + TILE - 2, 1, 2, P.g1);
      }
      break;
    case T.FLOWER: {
      const h = hash(x, y, 40);
      const bx = px + 5 + (h % 6);
      const col = [P.p2, P.gold, P.white, '#b090e0'][h % 4];
      R(g, bx, py + 9, 1, 7, P.g1);
      R(g, bx + 1, py + 12, 2, 1, P.g2);
      R(g, bx - 1, py + 6, 3, 3, col);
      R(g, bx, py + 5, 1, 5, col);
      R(g, bx - 2, py + 7, 5, 1, col);
      R(g, bx, py + 7, 1, 1, P.d1);
      break;
    }
    case T.FENCE:
      R(g, px, py + 4, TILE, 2, P.k2);
      R(g, px, py + 10, TILE, 2, P.k2);
      R(g, px, py + 6, TILE, 1, P.k0);
      R(g, px, py + 12, TILE, 1, P.k0);
      R(g, px + 6, py + 1, 3, 15, P.k1);
      R(g, px + 6, py + 1, 1, 15, P.k3);
      break;
    case T.SOIL:
      R(g, px, py, TILE, TILE, P.d1);
      for (let row = 0; row < 3; row++) {
        R(g, px, py + row * 5 + 1, TILE, 2, P.d2);
        R(g, px, py + row * 5 + 3, TILE, 1, P.d0);
      }
      break;
  }
}

const SOLIDISH = (t: number) => isSolidTile(t) || t === T.WATER;
const LEAFY = new Set<number>([T.LEAVES, T.LEAVES_FRUIT, T.LEAVES_BLOSSOM, T.LEAVES_PINE]);
const LEAF_INK: Record<number, string> = { [T.LEAVES]: P.l0, [T.LEAVES_FRUIT]: P.l0, [T.LEAVES_BLOSSOM]: P.p0, [T.LEAVES_PINE]: P.n0 };

/** Paints one 8x8 chunk of blocks into `g` (1 unit = 1 px), with outlines. */
export function paintChunk90(g: Ctx, cx: number, cy: number, size: number, cutGrass: (i: number) => boolean) {
  const x0 = cx * size;
  const y0 = cy * size;
  g.setTransform(1, 0, 0, 1, -x0 * TILE, -y0 * TILE);
  g.clearRect(x0 * TILE, y0 * TILE, size * TILE, size * TILE);
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const t = tileAt(x, y);
      const px = x * TILE;
      const py = y * TILE;
      if (t === T.AIR || (t === T.TALLGRASS && !cutGrass(y * WORLD_W + x))) {
        if (inIsland(x) && y > SURFACE[x]) {
          R(g, px, py, TILE, TILE, P.earth1);
          dither(g, px, py, TILE, TILE, P.earth0, 8);
        }
        continue;
      }
      drawTile90(g, t, px, py, x, y, t === T.TALLGRASS);
    }
  // Outlines: a dark line where ground or leaves meet the air, and corners
  // that stick out into the air rounded off (stair-stepped, like the era).
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const t = tileAt(x, y);
      const solid = isSolidTile(t) && t !== T.PLANK;
      const leaf = LEAFY.has(t);
      if (!solid && !leaf) continue;
      const px = x * TILE;
      const py = y * TILE;
      const ink = leaf ? LEAF_INK[t] : P.outline;
      const open = (nx: number, ny: number) => {
        const n = tileAt(nx, ny);
        if (leaf) return !LEAFY.has(n) && n !== T.TRUNK;
        // Air below the surface is the dark earth behind: not "open" for rounding.
        return !SOLIDISH(n) && n !== T.PLANK && !(inIsland(nx) && ny > SURFACE[Math.max(0, Math.min(WORLD_W - 1, nx))]);
      };
      const up = open(x, y - 1);
      const down = open(x, y + 1);
      const left = open(x - 1, y);
      const right = open(x + 1, y);
      if (up) R(g, px, py, TILE, 1, ink);
      if (left) R(g, px, py, 1, TILE, ink);
      if (right) R(g, px + TILE - 1, py, 1, TILE, ink);
      if (down) R(g, px, py + TILE - 1, TILE, 1, ink);
      const r = leaf ? 4 : 2;
      const corner = (sx: number, sy: number) => {
        const ox = sx > 0 ? px : px + TILE - 1;
        const oy = sy > 0 ? py : py + TILE - 1;
        for (let i = 0; i < r; i++) {
          const w = r - i;
          g.clearRect(sx > 0 ? ox : ox - w + 1, oy + sy * i, w, 1);
          R(g, ox + sx * w, oy + sy * i, 1, 1, ink);
        }
      };
      if (up && left && open(x - 1, y - 1)) corner(1, 1);
      if (up && right && open(x + 1, y - 1)) corner(-1, 1);
      if (leaf && down && left && open(x - 1, y + 1)) corner(1, -1);
      if (leaf && down && right && open(x + 1, y + 1)) corner(-1, -1);
    }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/* ── Sprites with an outline ─────────────────────────────────────────────── */

const spriteCache = new Map<string, HTMLCanvasElement>();
/**
 * Renders `draw` into a small canvas, then stamps a 1 px dark outline around
 * its silhouette (the 90s look). Cached by `key`: poses are quantized.
 */
function outlined(key: string, w: number, h: number, ox: number, oy: number, draw: (g: Ctx) => void) {
  let c = spriteCache.get(key);
  if (c) return c;
  if (spriteCache.size > 400) spriteCache.clear();
  const body = document.createElement('canvas');
  body.width = w;
  body.height = h;
  const b = body.getContext('2d')!;
  b.translate(ox, oy);
  draw(b);
  c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.drawImage(body, dx, dy);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = P.outline;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(body, 0, 0);
  spriteCache.set(key, c);
  return c;
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

/** Dui: a chubby orange tabby, about 30x22 px. Feet centered at (x, y). */
export function drawDui90(g: Ctx, x: number, y: number, p: DuiPose) {
  const step = p.sit || p.sleep ? 0 : Math.round(Math.sin(p.phase) * 2 * Math.min(1, p.amt));
  const bob = p.sit || p.sleep ? 0 : Math.round(Math.abs(Math.sin(p.phase)) * Math.min(1, p.amt));
  const tail = Math.round(Math.sin(p.tail) * 2);
  const sq = Math.round(p.squish * 2);
  const sw = Math.round(p.swing * 3);
  const air = p.air !== 0 ? 1 : 0;
  const key = `dui|${p.sleep ? 'z' : p.sit ? 's' : 'w'}|${step}|${bob}|${tail}|${sq}|${sw}|${air}|${p.blink ? 1 : 0}|${p.swim ? 1 : 0}`;
  const c = outlined(key, 46, 36, 22, 32, (g2) => duiBody(g2, p, step, bob, tail, sq, sw, air));
  // Shadow
  g.globalAlpha = 0.25;
  R(g, x - 13, y, 26, 1, P.outline);
  g.globalAlpha = 1;
  g.save();
  g.translate(Math.round(x), Math.round(y));
  if (p.facing < 0) g.scale(-1, 1);
  g.drawImage(c, -22, -32);
  g.restore();
}

function duiBody(g: Ctx, p: DuiPose, step: number, bob: number, tail: number, sq: number, sw: number, air: number) {
  if (p.sleep) {
    // A round loaf, tail wrapped, eyes shut.
    R(g, -15, -9, 28, 9, P.o2);
    R(g, -14, -10, 26, 1, P.o2);
    R(g, -13, -11, 22, 1, P.o2);
    R(g, -14, -9, 24, 2, P.o3);
    R(g, -10, -3, 18, 3, P.cream);
    R(g, -15, -2, 28, 2, P.o1);
    for (let k = 0; k < 4; k++) R(g, -11 + k * 5, -10, 2, 4, P.o1);
    R(g, 3, -14, 12, 11, P.o2);
    R(g, 4, -15, 10, 1, P.o2);
    R(g, 4, -14, 9, 2, P.o3);
    R(g, 4, -17, 3, 3, P.o2);
    R(g, 11, -17, 3, 3, P.o2);
    R(g, 5, -16, 1, 1, P.pink);
    R(g, 12, -16, 1, 1, P.pink);
    R(g, 6, -9, 3, 1, P.o0);
    R(g, 10, -9, 3, 1, P.o0);
    R(g, 10, -7, 5, 3, P.cream);
    R(g, 14, -7, 1, 1, P.pink);
    return;
  }
  g.translate(0, -bob + sq);
  // Tail
  if (p.sit) {
    R(g, -9, 1 - bob, 18, 2, P.o1);
    R(g, 8, 0 - bob, 3, 2, P.cream);
  } else {
    R(g, -16, -12, 3, 3, P.o2);
    R(g, -18, -15 + tail, 3, 4, P.o2);
    R(g, -19, -19 + tail * 2, 3, 5, P.o1);
    R(g, -19, -20 + tail * 2, 3, 1, P.cream);
  }
  // Legs (stubby)
  const leg = (lx: number, front: boolean, ph: number) => {
    const dx = front ? ph : -ph;
    R(g, lx + dx, -4 + air, 3, 4 - air + bob - sq, front ? P.o2 : P.o1);
    R(g, lx + dx, -1 + bob - sq, 3, 1, P.cream);
  };
  if (p.sit) {
    leg(2, true, 0);
    leg(6, true, 0);
  } else if (p.swim) {
    leg(-10, false, step);
    leg(5, true, step);
  } else {
    leg(-11, false, step);
    leg(-6, false, -step);
    leg(3, true, step);
    leg(8, true, -step);
  }
  // Body: a big round belly.
  const bw = (p.sit ? 22 : 28) + sq * 2;
  const bh = (p.sit ? 17 : 12) - sq;
  const bx = p.sit ? -12 : -15 - sq;
  const by = (p.sit ? -18 : -15) + sq;
  if (p.sit) {
    // Sitting: a pear, narrow at the shoulders and wide at the haunches.
    for (let i = 0; i < bh; i++) {
      const u = i / (bh - 1);
      const half = Math.round((bw / 2) * Math.sqrt(Math.max(0, 1 - (1 - u) ** 2 * 0.75)) * (i === bh - 1 ? 0.92 : 1));
      R(g, bx + bw / 2 - half, by + i, half * 2, 1, P.o2);
    }
  } else {
    R(g, bx + 2, by, bw - 4, bh, P.o2);
    R(g, bx, by + 2, bw, bh - 4, P.o2);
    R(g, bx + 1, by + 1, bw - 2, bh - 2, P.o2);
  }
  // Shading: light back, dark underside, cream belly. Kept inside the
  // silhouette (the sitting pear is narrower than these boxes).
  g.globalCompositeOperation = 'source-atop';
  R(g, bx + 3, by + 1, bw - 7, 2, P.o3);
  R(g, bx + 1, by + bh - 3, bw - 2, 2, P.o1);
  R(g, bx + 5, by + bh - 4, bw - 10, 3, P.cream);
  R(g, bx + 6, by + bh - 2, bw - 12, 1, P.cream1);
  for (let k = 0; k < (p.sit ? 3 : 4); k++) R(g, bx + (p.sit ? 6 : 4) + k * 4, by + (p.sit ? 5 : 1), 2, 4, P.o1);
  g.globalCompositeOperation = 'source-over';
  if (p.sit) {
    // Front paws, side by side under the chest.
    R(g, 0, -4, 4, 4, P.cream);
    R(g, 5, -4, 4, 4, P.cream);
    R(g, 4, -4, 1, 4, P.o1);
    R(g, 0, -1, 9, 1, P.cream1);
  }
  // Head
  const hx = p.sit ? -3 : 5;
  const hy = p.sit ? -29 : -21;
  R(g, hx + 1, hy, 13, 12, P.o2);
  R(g, hx, hy + 1, 15, 10, P.o2);
  R(g, hx + 2, hy + 1, 8, 2, P.o3);
  // Ears
  R(g, hx + 1, hy - 3, 3, 3, P.o2);
  R(g, hx + 2, hy - 4, 1, 1, P.o2);
  R(g, hx + 10, hy - 3, 3, 3, P.o2);
  R(g, hx + 11, hy - 4, 1, 1, P.o2);
  R(g, hx + 2, hy - 2, 1, 2, P.pink);
  R(g, hx + 11, hy - 2, 1, 2, P.pink);
  // Forehead "M"
  R(g, hx + 4, hy + 1, 1, 3, P.o1);
  R(g, hx + 7, hy + 1, 1, 2, P.o1);
  R(g, hx + 10, hy + 1, 1, 3, P.o1);
  // Eyes
  if (p.blink) {
    R(g, hx + 3, hy + 5, 3, 1, P.o0);
    R(g, hx + 9, hy + 5, 3, 1, P.o0);
  } else {
    R(g, hx + 3, hy + 4, 3, 3, P.eye);
    R(g, hx + 9, hy + 4, 3, 3, P.eye);
    R(g, hx + 4, hy + 4, 1, 3, P.outline);
    R(g, hx + 10, hy + 4, 1, 3, P.outline);
    R(g, hx + 3, hy + 4, 1, 1, P.white);
    R(g, hx + 9, hy + 4, 1, 1, P.white);
  }
  // Muzzle, nose, whiskers
  R(g, hx + 8, hy + 7, 6, 4, P.cream);
  R(g, hx + 12, hy + 7, 2, 1, P.pink);
  R(g, hx + 10, hy + 10, 2, 1, P.o0);
  R(g, hx + 15, hy + 7, 3, 1, P.cream);
  R(g, hx + 15, hy + 9, 3, 1, P.cream);
  // Paw out
  if (sw > 0) {
    R(g, hx + 4, -9, 6 + sw * 2, 3, P.o2);
    R(g, hx + 9 + sw * 2, -9, 3, 3, P.cream);
    R(g, hx + 13 + sw * 2, -13, 1, 3, P.white);
    R(g, hx + 15 + sw * 2, -11, 1, 3, P.white);
    R(g, hx + 13 + sw * 2, -7, 1, 3, P.white);
  }
}

export type DanielPose = { facing: 1 | -1; t: number; wave: boolean; blink: boolean };

export function drawDaniel90(g: Ctx, x: number, y: number, p: DanielPose) {
  const bob = Math.round(Math.sin(p.t * 1.6) * 0.6);
  const wave = p.wave ? Math.round(Math.sin(p.t * 9)) : 9;
  const key = `dan|${bob}|${wave}|${p.blink ? 1 : 0}`;
  const c = outlined(key, 24, 40, 12, 38, (b) => {
    R(b, -5, -3, 4, 3, P.outline);
    R(b, 1, -3, 4, 3, P.outline);
    R(b, -4, -12, 4, 9, P.jeans);
    R(b, 0, -12, 4, 9, P.jeans1);
    R(b, -5, -23 + bob, 10, 12, P.teal);
    R(b, -5, -23 + bob, 10, 2, '#3cbcaa');
    R(b, -5, -13 + bob, 10, 2, P.teal1);
    R(b, -1, -22 + bob, 2, 5, P.teal1);
    R(b, -7, -22 + bob, 2, 9, P.teal1);
    R(b, -7, -13 + bob, 2, 2, P.skin);
    if (p.wave) {
      R(b, 5, -29 + bob + wave, 2, 8, P.teal);
      R(b, 5, -31 + bob + wave, 2, 2, P.skin);
    } else {
      R(b, 5, -22 + bob, 2, 9, P.teal);
      R(b, 5, -13 + bob, 2, 2, P.skin);
    }
    R(b, -4, -32 + bob, 8, 9, P.skin);
    R(b, -4, -24 + bob, 8, 1, P.skin1);
    R(b, -5, -35 + bob, 10, 4, P.hair);
    R(b, -5, -31 + bob, 1, 3, P.hair);
    R(b, -4, -26 + bob, 8, 3, P.beard);
    R(b, -3, -23 + bob, 6, 1, P.beard1);
    R(b, 2, -28 + bob, 2, 2, P.beard);
    R(b, -1, -27 + bob, 2, 1, P.skin1);
    if (p.blink) R(b, -2, -29 + bob, 5, 1, P.hair);
    else {
      R(b, -2, -30 + bob, 1, 2, P.outline);
      R(b, 2, -30 + bob, 1, 2, P.outline);
    }
  });
  g.save();
  g.translate(Math.round(x), Math.round(y));
  if (p.facing < 0) g.scale(-1, 1);
  g.drawImage(c, -12, -38);
  g.restore();
}

/** Static props, outlined and cached. */
function prop(key: string, w: number, h: number, ox: number, oy: number, x: number, y: number, g: Ctx, draw: (b: Ctx) => void) {
  g.drawImage(outlined(key, w, h, ox, oy, draw), Math.round(x) - ox, Math.round(y) - oy);
}

export function sign90(g: Ctx, x: number, y: number, color: string, read: boolean) {
  prop(`sign|${color}|${read}`, 18, 24, 9, 22, x, y, g, (b) => {
    R(b, -1, -10, 3, 10, P.k1);
    R(b, -7, -19, 14, 10, P.k1);
    R(b, -6, -18, 12, 8, color);
    R(b, -6, -18, 12, 2, 'rgba(255,255,255,0.4)');
    if (read) {
      R(b, -2, -13, 2, 2, '#1e7a3a');
      R(b, 0, -14, 2, 2, '#1e7a3a');
      R(b, 2, -16, 2, 2, '#1e7a3a');
    }
  });
}

export function board90(g: Ctx, x: number, y: number) {
  prop('board', 32, 36, 16, 34, x, y, g, (b) => {
    R(b, -10, -15, 3, 15, P.k1);
    R(b, 7, -15, 3, 15, P.k1);
    R(b, -14, -30, 28, 16, P.k1);
    R(b, -13, -29, 26, 14, P.k3);
    const papers = [P.white, '#ffe3a3', P.gl2, P.p3, '#c8f0a0'];
    for (let i = 0; i < 5; i++) {
      const px = -12 + i * 5;
      const py = -28 + (i % 2) * 5;
      R(b, px, py, 4, 6, papers[i]);
      R(b, px, py + 5, 4, 1, P.cream1);
      R(b, px + 1, py, 2, 1, P.red);
    }
  });
}

export function welcome90(g: Ctx, x: number, y: number) {
  prop('welcome', 24, 26, 12, 24, x, y, g, (b) => {
    R(b, -1, -11, 3, 11, P.k1);
    R(b, -9, -21, 18, 11, P.k1);
    R(b, -8, -20, 16, 9, P.k3);
    R(b, -4, -17, 3, 3, P.red);
    R(b, 1, -17, 3, 3, P.red);
    R(b, -3, -14, 6, 1, P.red);
    R(b, -2, -13, 4, 1, P.red);
    R(b, -1, -12, 2, 1, P.red);
  });
}

export function mailbox90(g: Ctx, x: number, y: number) {
  prop('mail', 20, 30, 10, 28, x, y, g, (b) => {
    R(b, -1, -13, 3, 13, P.k1);
    R(b, -6, -21, 13, 9, P.red);
    R(b, -5, -22, 11, 1, P.red);
    R(b, -5, -21, 10, 2, '#f07060');
    R(b, -6, -13, 13, 1, P.red1);
    R(b, 5, -25, 1, 6, P.gold);
    R(b, 5, -25, 4, 3, P.gold);
  });
}

export function station90(g: Ctx, x: number, y: number, led: string) {
  prop('station', 28, 40, 14, 38, x, y, g, (b) => {
    R(b, -1, -17, 2, 17, P.metal1);
    R(b, -5, -26, 10, 9, '#3a4050');
    R(b, -4, -25, 8, 1, P.metal);
    R(b, -4, -22, 3, 1, P.metal);
    R(b, -4, -20, 3, 1, P.metal);
    R(b, 3, -34, 1, 8, P.metal);
    R(b, 2, -35, 3, 1, P.metal);
    R(b, -11, -30, 9, 5, '#2d5fa3');
    R(b, -10, -29, 7, 1, '#6a9ce0');
  });
  R(g, Math.round(x) + 2, Math.round(y) - 22, 2, 2, led);
}

export function lantern90(g: Ctx, x: number, y: number, lit: boolean, t: number) {
  prop(`lantern|${lit}`, 16, 28, 4, 26, x, y, g, (b) => {
    R(b, -1, -23, 2, 23, P.k0);
    R(b, -1, -23, 8, 2, P.k0);
    R(b, 5, -21, 1, 2, P.metal1);
    R(b, 2, -19, 7, 8, P.metal1);
    R(b, 3, -18, 5, 6, lit ? P.gold : '#5b5148');
    R(b, 3, -18, 2, 2, lit ? P.white : '#7a7064');
  });
  if (lit && Math.sin(t * 7 + x) > 0.4) R(g, Math.round(x) + 3, Math.round(y) - 18, 1, 1, P.white);
}

export function campfire90(g: Ctx, x: number, y: number, t: number, still: boolean) {
  prop('campseats', 48, 12, 26, 10, x, y, g, (b) => {
    for (const dx of [-25, 11]) {
      R(b, dx, -6, 13, 6, P.k1);
      R(b, dx, -6, 13, 1, P.k3);
      R(b, dx + 1, -5, 3, 4, '#d8b080');
      R(b, dx + 2, -4, 1, 2, P.k1);
    }
    for (let i = 0; i < 6; i++) R(b, -9 + i * 3, -3 - (i === 0 || i === 5 ? 0 : 1), 3, 3, i & 1 ? P.s1 : P.s2);
    R(b, -7, -5, 14, 2, P.k0);
    R(b, -5, -6, 10, 2, P.k1);
  });
  const f = still ? 0 : Math.floor(t * 10) % 4;
  const hs = [[8, 11, 7], [10, 9, 8], [9, 12, 7], [11, 10, 9]][f];
  const X = Math.round(x);
  const Y = Math.round(y);
  [[-4, hs[0]], [-1, hs[1]], [2, hs[2]]].forEach(([dx, h]) => {
    R(g, X + dx, Y - 5 - h, 3, h, '#ff7a1a');
    R(g, X + dx + 1, Y - 5 - h + 3, 1, h - 3, P.gold);
  });
  R(g, X - 1, Y - 8, 3, 3, '#fff1b8');
}

export function gear90(g: Ctx, x: number, y: number, angle: number) {
  for (let i = 0; i < 8; i++) {
    const a = angle + (i * Math.PI) / 4;
    R(g, Math.round(x + Math.cos(a) * 6) - 1, Math.round(y + Math.sin(a) * 6) - 1, 3, 3, P.metal1);
  }
  R(g, Math.round(x) - 4, Math.round(y) - 3, 9, 7, P.metal);
  R(g, Math.round(x) - 3, Math.round(y) - 4, 7, 9, P.metal);
  R(g, Math.round(x) - 1, Math.round(y) - 1, 3, 3, P.metal1);
}

export function plant90(g: Ctx, x: number, y: number, kind: 'sunflower' | 'carrot' | 'tomato' | 'cabbage', growth: number, t: number) {
  const k = Math.max(0, Math.min(1, (growth - 1) / 0.45));
  const X = Math.round(x);
  const Y = Math.round(y);
  const sway = Math.round(Math.sin(t * 1.3 + x) * k);
  if (kind === 'sunflower') {
    const h = 5 + Math.round(k * 14);
    R(g, X, Y - h, 1, h, P.g1);
    R(g, X - 3, Y - Math.round(h / 2), 3, 2, P.g2);
    R(g, X + 1, Y - Math.round(h * 0.7), 3, 2, P.g2);
    if (k > 0.3) {
      R(g, X - 3 + sway, Y - h - 3, 7, 7, P.gold);
      R(g, X - 2 + sway, Y - h - 4, 5, 9, P.gold);
      R(g, X - 1 + sway, Y - h - 1, 3, 3, P.k0);
      R(g, X - 2 + sway, Y - h - 3, 2, 1, P.white);
    }
  } else if (kind === 'tomato') {
    const h = 3 + Math.round(k * 10);
    R(g, X - 4, Y - h, 9, h, P.l1);
    R(g, X - 3, Y - h, 7, 2, P.l2);
    if (k > 0.6) {
      R(g, X - 3, Y - h + 3, 3, 3, P.red);
      R(g, X + 1, Y - h + 6, 3, 3, P.red);
      R(g, X - 3, Y - h + 3, 1, 1, P.white);
    }
  } else if (kind === 'carrot') {
    const h = 2 + Math.round(k * 9);
    R(g, X - 2, Y - h, 1, h, P.g2);
    R(g, X, Y - h - 1, 1, h + 1, P.g3);
    R(g, X + 2, Y - h, 1, h, P.g2);
    if (k > 0.7) R(g, X - 1, Y - 1, 3, 2, '#ff8a2a');
  } else {
    const r = 1 + Math.round(k * 4);
    R(g, X - r, Y - r * 2, r * 2 + 1, r * 2, '#9ed27a');
    R(g, X - r + 1, Y - r * 2, r, 1, '#c8f0a0');
    R(g, X - r, Y - 1, r * 2 + 1, 1, '#5f9a4a');
  }
}

export function star90(g: Ctx, x: number, y: number, size: number, c: string) {
  const X = Math.round(x);
  const Y = Math.round(y);
  R(g, X, Y - size - 1, 1, size * 2 + 3, P.outline);
  R(g, X - size - 1, Y, size * 2 + 3, 1, P.outline);
  R(g, X, Y - size, 1, size * 2 + 1, c);
  R(g, X - size, Y, size * 2 + 1, 1, c);
  if (size > 1) {
    R(g, X - 1, Y - 1, 3, 3, c);
    R(g, X, Y, 1, 1, P.white);
  }
}

export function heart90(g: Ctx, x: number, y: number, c: string) {
  const X = Math.round(x);
  const Y = Math.round(y);
  R(g, X - 2, Y - 1, 2, 2, c);
  R(g, X + 1, Y - 1, 2, 2, c);
  R(g, X - 2, Y, 5, 1, c);
  R(g, X - 1, Y + 1, 3, 1, c);
  R(g, X, Y + 2, 1, 1, c);
}

/** Tall grass, drawn every frame so the tips lean with the wind. */
export function grass90(g: Ctx, px: number, py: number, x: number, y: number, t: number, wind: number, push: number) {
  for (let i = 0; i < 5; i++) {
    const h = hash(x, y, 30 + i);
    const bx = Math.round(px) + 1 + (h % 14);
    const bh = 7 + ((h >>> 5) % 6);
    const lean = Math.round(Math.sin(t * 1.6 + x * 0.45 + i) * wind + push);
    const base = Math.round(py) + TILE;
    const mid = Math.round(bh * 0.55);
    const col = (h >>> 9) & 1 ? P.g2 : P.g1;
    R(g, bx, base - mid, 1, mid, col);
    R(g, bx + Math.round(lean / 2), base - bh + 2, 1, bh - mid - 1, col);
    R(g, bx + lean, base - bh, 1, 2, P.g3);
  }
}

/** A 90s pixel cloud: flat bottom, round lit tops. Cached by shape and colors. */
const cloudCache = new Map<string, HTMLCanvasElement>();
export function cloud90(seed: number, w: number, body: string, light: string, shade: string) {
  const key = `${seed}|${w}|${body}|${light}|${shade}`;
  let c = cloudCache.get(key);
  if (!c) {
    if (cloudCache.size > 40) cloudCache.clear();
    c = document.createElement('canvas');
    const h = Math.round(w * 0.45);
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    let a = seed * 9301 + 49297;
    const rnd = () => ((a = (a * 9301 + 49297) % 233280), a / 233280);
    const puffs: [number, number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const r = Math.round(h * (0.24 + rnd() * 0.18));
      puffs.push([Math.round(r + rnd() * (w - r * 2)), Math.round(h - r - 2 - rnd() * h * 0.2), r]);
    }
    const disc = (cx: number, cy: number, r: number, col: string) => {
      g.fillStyle = col;
      for (let dy = -r; dy <= r; dy++) {
        const ww = Math.round(Math.sqrt(r * r - dy * dy));
        g.fillRect(cx - ww, cy + dy, ww * 2 + 1, 1);
      }
    };
    for (const [cx, cy, r] of puffs) disc(cx, cy, r + 1, P.outline);
    R(g, Math.round(w * 0.1) - 1, Math.round(h * 0.6), Math.round(w * 0.8) + 2, Math.round(h * 0.4) - 1, P.outline);
    for (const [cx, cy, r] of puffs) disc(cx, cy, r, body);
    R(g, Math.round(w * 0.1), Math.round(h * 0.6), Math.round(w * 0.8), Math.round(h * 0.4) - 2, body);
    for (const [cx, cy, r] of puffs) disc(cx - 1, cy - 1, Math.max(1, r - 3), light);
    dither(g, Math.round(w * 0.1), Math.round(h * 0.75), Math.round(w * 0.8), Math.round(h * 0.25) - 2, shade, 8);
    cloudCache.set(key, c);
  }
  return c;
}

/* ── Sun, moon and distant hills ─────────────────────────────────────────── */

function disc(g: Ctx, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.round(Math.sqrt(r * r - dy * dy));
    g.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}

export function sun90(g: Ctx, x: number, y: number, t: number, still: boolean) {
  const X = Math.round(x);
  const Y = Math.round(y);
  // Rays: short dashes that turn slowly.
  const turn = still ? 0 : Math.floor(t * 2) % 2;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + (turn * Math.PI) / 8;
    R(g, X + Math.round(Math.cos(a) * 15) - 1, Y + Math.round(Math.sin(a) * 15) - 1, 3, 3, '#ffe27a');
  }
  disc(g, X, Y, 11, '#f0a02a');
  disc(g, X, Y, 10, P.gold);
  disc(g, X - 2, Y - 2, 6, '#ffe98a');
  R(g, X - 5, Y - 6, 3, 2, P.white);
}

export function moon90(g: Ctx, x: number, y: number) {
  const X = Math.round(x);
  const Y = Math.round(y);
  disc(g, X, Y, 9, '#b8bcd8');
  disc(g, X - 1, Y - 1, 8, '#eef0ff');
  disc(g, X + 3, Y + 2, 2, '#c8cce4');
  disc(g, X - 3, Y - 3, 1, '#c8cce4');
  R(g, X - 4, Y + 3, 2, 2, '#c8cce4');
}

function tone(hexc: string, k: number) {
  const n = parseInt(hexc.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const to = k > 0 ? [255, 255, 255] : [10, 8, 30];
  return hex(mix(c, to, Math.abs(k)));
}

const HILL_STEP = 3;
const hillCache = new Map<string, HTMLCanvasElement>();
/**
 * A strip of hills, one period wide (samples.length * HILL_STEP px), with a
 * lit rim, a dithered shaded base and, on the near layer, little trees.
 * The bottom row of the strip sits on the horizon.
 */
export function hills90(samples: Float32Array, color: string, trees: boolean) {
  const key = `${samples[3]}|${color}|${trees}`;
  let c = hillCache.get(key);
  if (c) return c;
  if (hillCache.size > 24) hillCache.clear();
  const n = samples.length;
  let top = 0;
  for (const v of samples) top = Math.max(top, v);
  const H = Math.ceil(top) + 12;
  c = document.createElement('canvas');
  c.width = n * HILL_STEP;
  c.height = H;
  const g = c.getContext('2d')!;
  const light = tone(color, 0.25);
  const shade = tone(color, -0.22);
  const at = (x: number) => {
    const f = x / HILL_STEP;
    const i = Math.floor(f);
    const a = samples[i % n];
    const b = samples[(i + 1) % n];
    return Math.round(a + (b - a) * (f - i));
  };
  for (let x = 0; x < c.width; x++) {
    const h = at(x);
    const y = H - h;
    R(g, x, y, 1, h, color);
    const rising = at(x + 2) > h;
    R(g, x, y, 1, 1, rising ? color : light);
    if (!rising) R(g, x, y + 1, 1, 1, light);
  }
  // Lower part in shade, dithered so it fades in.
  g.globalCompositeOperation = 'source-atop';
  dither(g, 0, Math.round(H * 0.55), c.width, Math.round(H * 0.15), shade, 4);
  dither(g, 0, Math.round(H * 0.7), c.width, H, shade, 10);
  g.globalCompositeOperation = 'source-over';
  if (trees) {
    const dark = tone(color, -0.4);
    for (let x = 7; x < c.width - 4; x += 11 + (hash(x, 3) % 23)) {
      const y = H - at(x + 1);
      R(g, x, y - 5, 3, 5, dark);
      R(g, x + 1, y - 7, 1, 2, dark);
      R(g, x, y - 5, 1, 2, tone(color, 0.1));
    }
  }
  hillCache.set(key, c);
  return c;
}
