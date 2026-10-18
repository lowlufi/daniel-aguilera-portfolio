import { T, SURFACE, WORLD_W, tileAt, inIsland, isSolidTile } from './world';

/*
 * "Dulce": a cheerful 16-bit console look, all original. Pastel colors with
 * a lot of light, round shapes, and outlines in a darker shade of each
 * thing's own color (never black). Skies are smooth banded gradients, hills
 * are striped, trees are lollipops, clouds are big and puffy, and Dui is a
 * round orange ball of a cat.
 *
 * Drawn at 1 unit = 1 virtual pixel; the canvas is upscaled by a whole number
 * with nearest-neighbour so every pixel stays square and crisp.
 */

type Ctx = CanvasRenderingContext2D;
export const TILE = 16;

export const P = {
  white: '#ffffff',
  // Grass
  g0: '#1f8a4c',
  g1: '#3cbc5a',
  g2: '#6ade6a',
  g3: '#b4f48c',
  g4: '#e6ffc4',
  // Dirt (warm peach) and deep dirt (rose)
  d0: '#9a4a32',
  d1: '#e08a5a',
  d2: '#f4a874',
  d3: '#ffcc98',
  e0: '#7a3a4a',
  e1: '#c8706e',
  e2: '#dc8a84',
  // Cave background
  cave: '#5a3c6c',
  cave1: '#4a2e5c',
  // Stone (lavender)
  s0: '#5a4a96',
  s1: '#9a8ed8',
  s2: '#b8aeec',
  s3: '#e2dcff',
  // Sand
  a0: '#c08a3a',
  a1: '#f4d080',
  a2: '#fde6a8',
  a3: '#fff6d8',
  // Water
  w0: '#2a78c8',
  w1: '#46a8e8',
  w2: '#74ccf8',
  w3: '#bdf0ff',
  // Wood (honey)
  k0: '#8a4a1e',
  k1: '#d08440',
  k2: '#f0a85c',
  k3: '#ffd08a',
  // Walls and roof
  b0: '#b04a5a',
  b1: '#f08a94',
  b2: '#ffb0b4',
  b3: '#ffd8d8',
  r0: '#a02a4a',
  r1: '#e0486a',
  r2: '#ff7090',
  r3: '#ffb0c4',
  // Glass
  gl0: '#4a88d0',
  gl1: '#8ccaf8',
  gl2: '#e4f6ff',
  // Leaves
  l0: '#1f8a4c',
  l1: '#3cbc5a',
  l2: '#6ade6a',
  l3: '#c4f89c',
  p0: '#c04a8a',
  p1: '#ff8ac0',
  p2: '#ffb4d8',
  p3: '#ffe4f0',
  n0: '#1a7a6a',
  n1: '#2eb08e',
  n2: '#54d4a8',
  n3: '#a8f4d4',
  // Dui
  o0: '#a8420e',
  o1: '#e8742a',
  o2: '#ff9a3c',
  o3: '#ffc47a',
  o4: '#ffe2b4',
  cream: '#fff4e0',
  blush: '#ff7a9a',
  eye: '#24206a',
  eye1: '#4a5ad8',
  // Daniel
  skin: '#ffd2aa',
  skin0: '#c07a58',
  hair: '#5a3220',
  beard: '#c2601e',
  beard0: '#7a3410',
  teal: '#3cc8b4',
  teal0: '#1a7a70',
  teal1: '#8cf0e0',
  jeans: '#5a7ae0',
  jeans0: '#2a3a8a',
  // Misc
  gold: '#ffe048',
  gold0: '#e08a10',
  gold1: '#fff6b0',
  red: '#ff4a5a',
  red0: '#a01a3a',
  metal: '#c8d0e8',
  metal0: '#5a6488',
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

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const parse = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** Lighter (k > 0) or deeper (k < 0) shade of a color. Deeper keeps the hue. */
export function tone(h: string, k: number) {
  const c = parse(h);
  const to = k > 0 ? [255, 255, 255] : [c[0] * 0.35, c[1] * 0.3, c[2] * 0.55 + 20];
  return rgb(mix(c, to, Math.abs(k)));
}

/** A filled pixel disc, row by row (round shapes without anti-aliasing). */
export function disc(g: Ctx, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.round(Math.sqrt(r * r - dy * dy + r * 0.6));
    g.fillRect(Math.round(cx) - w, Math.round(cy) + dy, w * 2 + 1, 1);
  }
}
/** A filled pixel ellipse. */
export function oval(g: Ctx, cx: number, cy: number, rx: number, ry: number, col: string) {
  g.fillStyle = col;
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + ry * 0.6))));
    g.fillRect(Math.round(cx) - w, Math.round(cy) + dy, w * 2 + 1, 1);
  }
}

/* ── Sky: smooth bands, like a scanline gradient ─────────────────────────── */

let skyCache: { key: string; c: HTMLCanvasElement } | null = null;
export const SKY_H = 360;
/** The sky as a strip SKY_H tall ending at the horizon: 2 px bands from top to horizon. */
export function sky(vw: number, stops: number[][]): HTMLCanvasElement {
  const key = `${vw}|${stops.flat().join(',')}`;
  if (skyCache?.key === key) return skyCache.c;
  const c = document.createElement('canvas');
  c.width = vw;
  c.height = SKY_H;
  const g = c.getContext('2d')!;
  const at = (u: number) => {
    const f = u * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(f));
    return mix(stops[i], stops[i + 1], f - i);
  };
  for (let y = 0; y < SKY_H; y += 2) R(g, 0, y, vw, 2, rgb(at(y / SKY_H).map((v) => Math.round(v / 4) * 4)));
  skyCache = { key, c };
  return c;
}

/* ── Tiles ───────────────────────────────────────────────────────────────── */

/** Polka dots on a staggered grid anchored to the world, so tiles join up. */
function dots(g: Ctx, px: number, py: number, col: string, hi?: string) {
  for (let k = 0; k < 2; k++) {
    const ox = px + (k ? 10 : 2);
    const oy = py + (k ? 10 : 2);
    R(g, ox + 1, oy, 2, 4, col);
    R(g, ox, oy + 1, 4, 2, col);
    if (hi) R(g, ox + 1, oy + 1, 1, 1, hi);
  }
}

function dirt(g: Ctx, px: number, py: number, depth: number) {
  if (depth > 5) {
    R(g, px, py, TILE, TILE, P.e1);
    dots(g, px, py, P.e2);
  } else {
    R(g, px, py, TILE, TILE, P.d2);
    dots(g, px, py, P.d3, P.white);
  }
}

function stone(g: Ctx, px: number, py: number, y: number) {
  R(g, px, py, TILE, TILE, P.s0);
  // Two rows of rounded cobbles, staggered.
  const off = (y & 1) * 4;
  for (let row = 0; row < 2; row++)
    for (let k = -1; k < 2; k++) {
      const sx = px + k * 8 + (row ? off + 4 : off);
      const sy = py + row * 8;
      R(g, sx + 1, sy + 1, 6, 6, P.s1);
      R(g, sx + 2, sy, 4, 8, P.s1);
      R(g, sx, sy + 2, 8, 4, P.s1);
      R(g, sx + 2, sy + 1, 3, 2, P.s2);
      R(g, sx + 2, sy + 1, 1, 1, P.s3);
    }
}

function waterTile(g: Ctx, px: number, py: number, x: number, y: number, surface: boolean) {
  const deep = y - 44;
  R(g, px, py, TILE, TILE, deep > 4 ? P.w0 : P.w1);
  // Lighter wavy stripes, offset per row.
  const o = (y * 5 + (x & 1) * 8) % 16;
  R(g, px + ((o + 2) % 16), py + 5, 6, 1, deep > 4 ? P.w1 : P.w2);
  R(g, px + ((o + 10) % 16), py + 12, 5, 1, deep > 4 ? P.w1 : P.w2);
  if (surface) {
    R(g, px, py, TILE, 3, P.w2);
    // Foam scallops
    for (let i = 0; i < 4; i++) {
      R(g, px + i * 4, py, 3, 1, P.white);
      R(g, px + i * 4 + 1, py + 1, 2, 1, P.w3);
    }
  }
}

export function drawTile(g: Ctx, t: number, px: number, py: number, x: number, y: number) {
  const depth = y - SURFACE[Math.max(0, Math.min(WORLD_W - 1, x))];
  switch (t) {
    case T.DIRT:
      dirt(g, px, py, depth);
      break;
    case T.GRASS: {
      dirt(g, px, py, 0);
      // A thick, round-bottomed cap: two scallops per block hang into the dirt.
      R(g, px, py, TILE, 6, P.g2);
      R(g, px, py + 1, TILE, 1, P.g3);
      R(g, px, py, TILE, 1, P.g4);
      for (let k = 0; k < 2; k++) {
        const bx = px + k * 8;
        R(g, bx + 1, py + 6, 6, 2, P.g2);
        R(g, bx + 2, py + 8, 4, 1, P.g2);
        R(g, bx, py + 6, 1, 1, P.g1);
        R(g, bx + 7, py + 6, 1, 1, P.g1);
        R(g, bx, py + 7, 1, 1, P.g0);
        R(g, bx + 7, py + 7, 1, 1, P.g0);
        R(g, bx + 1, py + 8, 1, 1, P.g0);
        R(g, bx + 6, py + 8, 1, 1, P.g0);
        R(g, bx + 2, py + 9, 4, 1, P.g0);
      }
      R(g, px + 3, py + 3, 2, 1, P.g4);
      R(g, px + 11, py + 3, 2, 1, P.g4);
      break;
    }
    case T.STONE:
      stone(g, px, py, y);
      break;
    case T.ORE: {
      stone(g, px, py, y);
      const blue = hash(x, y, 2) & 1;
      const sx = px + 4 + (hash(x, y, 3) % 5);
      const sy = py + 4 + (hash(x, y, 4) % 5);
      // A little star-shaped gem.
      const c = blue ? '#7ae0ff' : P.gold;
      const d = blue ? '#2a8ac8' : P.gold0;
      R(g, sx + 2, sy - 1, 2, 8, d);
      R(g, sx - 1, sy + 2, 8, 2, d);
      R(g, sx + 2, sy, 2, 6, c);
      R(g, sx, sy + 2, 6, 2, c);
      R(g, sx + 2, sy + 1, 1, 1, P.white);
      break;
    }
    case T.SAND:
      R(g, px, py, TILE, TILE, P.a2);
      dots(g, px, py, P.a3);
      if (depth > 1) R(g, px, py + 14, TILE, 2, P.a1);
      break;
    case T.WATER: {
      const above = tileAt(x, y - 1);
      waterTile(g, px, py, x, y, above !== T.WATER && above !== T.POST);
      break;
    }
    case T.POST:
      waterTile(g, px, py, x, y, false);
      R(g, px + 5, py, 6, TILE, P.k1);
      R(g, px + 6, py, 2, TILE, P.k2);
      R(g, px + 4, py, 1, TILE, P.k0);
      R(g, px + 11, py, 1, TILE, P.k0);
      break;
    case T.PLANK:
      waterTile(g, px, py, x, y, tileAt(x, y + 1) !== T.WATER);
      R(g, px, py, TILE, 7, P.k2);
      R(g, px, py, TILE, 1, P.k3);
      R(g, px, py + 6, TILE, 1, P.k0);
      R(g, px + ((x & 1) ? 3 : 11), py + 1, 1, 5, P.k1);
      break;
    case T.WOODWALL:
      // Cream siding with honey trim lines.
      R(g, px, py, TILE, TILE, '#fff0c8');
      for (let i = 0; i < 4; i++) {
        R(g, px, py + i * 4 + 3, TILE, 1, '#f0c890');
        R(g, px, py + i * 4, TILE, 1, P.white);
      }
      break;
    case T.BRICKWALL:
      R(g, px, py, TILE, TILE, P.b2);
      for (let row = 0; row < 4; row++) {
        const yy = py + row * 4;
        R(g, px, yy + 3, TILE, 1, P.b3);
        const off = (row + y) & 1 ? 0 : 4;
        for (let k = 0; k < 3; k++) R(g, px + off + k * 8 - 1, yy, 1, 3, P.b3);
        R(g, px, yy, TILE, 1, P.b1);
      }
      break;
    case T.ROOF:
      // Round scallop shingles.
      R(g, px, py, TILE, TILE, P.r1);
      for (let row = 0; row < 2; row++) {
        const off = row ? 4 : 0;
        for (let k = -1; k < 2; k++) {
          const sx = px + k * 8 + off;
          const sy = py + row * 8;
          R(g, sx + 1, sy, 6, 6, P.r2);
          R(g, sx, sy, 8, 4, P.r2);
          R(g, sx + 2, sy + 6, 4, 1, P.r2);
          R(g, sx + 1, sy + 1, 3, 1, P.r3);
          R(g, sx + 2, sy + 7, 4, 1, P.r0);
        }
      }
      break;
    case T.WINDOW:
      R(g, px, py, TILE, TILE, P.k1);
      R(g, px + 1, py + 1, 14, 14, P.gl1);
      R(g, px + 2, py + 2, 3, 6, P.gl2);
      R(g, px + 5, py + 2, 2, 2, P.gl2);
      R(g, px + 1, py + 11, 14, 4, P.gl0);
      R(g, px + 7, py + 1, 2, 14, P.k2);
      R(g, px + 1, py + 7, 14, 2, P.k2);
      break;
    case T.DOOR:
      R(g, px, py, TILE, TILE, P.k1);
      R(g, px + 1, py, 14, TILE, P.k2);
      R(g, px + 3, py + 2, 10, 5, P.k3);
      R(g, px + 3, py + 9, 10, 5, P.k3);
      R(g, px + 1, py, 14, 1, P.k3);
      if (hash(x, y) & 1) {
        R(g, px + 11, py + 7, 3, 3, P.gold0);
        R(g, px + 11, py + 7, 2, 2, P.gold);
      }
      break;
    case T.CHIMNEY:
      R(g, px, py, TILE, TILE, P.b1);
      for (let row = 0; row < 4; row++) R(g, px, py + row * 4 + 3, TILE, 1, P.b2);
      R(g, px + 7, py, 1, 3, P.b2);
      R(g, px + 3, py + 4, 1, 3, P.b2);
      R(g, px + 11, py + 4, 1, 3, P.b2);
      break;
    case T.TALLGRASS:
      break;
    case T.FLOWER: {
      const h = hash(x, y, 40);
      const bx = px + 6 + (h % 4);
      const col = [P.p1, P.gold, P.white, '#c49aff'][h % 4];
      const dark = [P.p0, P.gold0, '#c0b8d8', '#7a4ad0'][h % 4];
      R(g, bx + 1, py + 9, 1, 7, P.g1);
      R(g, bx + 2, py + 12, 2, 2, P.g2);
      R(g, bx - 1, py + 4, 5, 5, dark);
      R(g, bx, py + 3, 3, 7, dark);
      R(g, bx - 2, py + 5, 7, 3, dark);
      R(g, bx, py + 4, 3, 5, col);
      R(g, bx - 1, py + 5, 5, 3, col);
      R(g, bx + 1, py + 6, 1, 1, P.gold0);
      break;
    }
    case T.FENCE:
      R(g, px, py + 5, TILE, 3, P.k0);
      R(g, px, py + 6, TILE, 1, P.white);
      R(g, px + 5, py + 2, 5, 14, P.k0);
      R(g, px + 6, py + 1, 3, 15, P.white);
      R(g, px + 6, py + 1, 3, 1, P.k0);
      break;
    case T.SOIL:
      R(g, px, py, TILE, TILE, P.d1);
      for (let row = 0; row < 3; row++) {
        R(g, px, py + row * 5 + 1, TILE, 2, P.d2);
        R(g, px + 2, py + row * 5 + 1, 3, 1, P.d3);
        R(g, px + 10, py + row * 5 + 1, 3, 1, P.d3);
      }
      break;
  }
}

const SOLIDISH = (t: number) => isSolidTile(t) || t === T.WATER;
const LEAFY = new Set<number>([T.LEAVES, T.LEAVES_FRUIT, T.LEAVES_BLOSSOM, T.LEAVES_PINE]);
/** Outline of each material: a deep shade of its own color. */
const INK: Record<number, string> = {
  [T.GRASS]: P.g0,
  [T.DIRT]: P.d0,
  [T.SAND]: P.a0,
  [T.STONE]: P.s0,
  [T.ORE]: P.s0,
  [T.WOODWALL]: P.k0,
  [T.BRICKWALL]: P.b0,
  [T.ROOF]: P.r0,
  [T.WINDOW]: P.k0,
  [T.DOOR]: P.k0,
  [T.CHIMNEY]: P.b0,
  [T.SOIL]: P.d0,
};

/** Paints one chunk of blocks into `g` (1 unit = 1 px), with outlines and round corners. */
export function paintChunk(g: Ctx, cx: number, cy: number, size: number, cutGrass: (i: number) => boolean) {
  const x0 = cx * size;
  const y0 = cy * size;
  g.setTransform(1, 0, 0, 1, -x0 * TILE, -y0 * TILE);
  g.clearRect(x0 * TILE, y0 * TILE, size * TILE, size * TILE);
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const t = tileAt(x, y);
      const px = x * TILE;
      const py = y * TILE;
      // Trees are drawn whole as sprites (tree()), not as blocks.
      if (t === T.AIR || t === T.TALLGRASS || t === T.TRUNK || LEAFY.has(t)) {
        if (inIsland(x) && y > SURFACE[x]) {
          // Cave wall: deep violet with big soft dots.
          R(g, px, py, TILE, TILE, P.cave);
          const k = (x + y) & 1;
          R(g, px + 4 + k * 6, py + 4, 3, 3, P.cave1);
          R(g, px + 10 - k * 6, py + 11, 2, 2, P.cave1);
        }
        if (t === T.TALLGRASS && cutGrass(y * WORLD_W + x)) {
          for (let i = 0; i < 3; i++) R(g, px + 3 + i * 4, py + TILE - 2, 2, 2, P.g1);
        }
        continue;
      }
      drawTile(g, t, px, py, x, y);
    }
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const t = tileAt(x, y);
      const solid = isSolidTile(t) && t !== T.PLANK;
      if (!solid) continue;
      const px = x * TILE;
      const py = y * TILE;
      const ink = INK[t] ?? P.d0;
      // Cave air below the surface counts as open too (the cave wall is behind).
      const open = (nx: number, ny: number) => {
        const n = tileAt(nx, ny);
        return !SOLIDISH(n) && n !== T.PLANK;
      };
      const openSky = (nx: number, ny: number) => open(nx, ny) && !(inIsland(nx) && ny > SURFACE[Math.max(0, Math.min(WORLD_W - 1, nx))]);
      const up = open(x, y - 1);
      const down = open(x, y + 1);
      const left = open(x - 1, y);
      const right = open(x + 1, y);
      if (up) R(g, px, py, TILE, 1, ink);
      if (left) R(g, px, py, 1, TILE, ink);
      if (right) R(g, px + TILE - 1, py, 1, TILE, ink);
      if (down) R(g, px, py + TILE - 1, TILE, 1, ink);
      // Round off corners that stick out into the open sky.
      const r = 3;
      const corner = (sx: number, sy: number) => {
        const ox = sx > 0 ? px : px + TILE - 1;
        const oy = sy > 0 ? py : py + TILE - 1;
        for (let i = 0; i < r; i++) {
          const w = Math.round(r - Math.sqrt(r * r - (r - i) * (r - i)));
          if (w <= 0) continue;
          g.clearRect(sx > 0 ? ox : ox - w + 1, oy + sy * i, w, 1);
          R(g, ox + sx * w, oy + sy * i, 1, 1, ink);
        }
      };
      if (up && left && openSky(x - 1, y - 1) && openSky(x, y - 1) && openSky(x - 1, y)) corner(1, 1);
      if (up && right && openSky(x + 1, y - 1) && openSky(x, y - 1) && openSky(x + 1, y)) corner(-1, 1);
    }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/* ── Sprites with a colored outline ──────────────────────────────────────── */

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Renders `draw` into a small canvas and rings its silhouette with `ink`. Cached by `key`. */
function outlined(key: string, ink: string, w: number, h: number, ox: number, oy: number, draw: (g: Ctx) => void) {
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
  g.fillStyle = ink;
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

/**
 * Dui: a round ball of orange cat (about 24 px), big tall eyes with a shine,
 * pink cheeks, cat ears, cream paws. Feet centered at (x, y).
 */
export function drawDui(g: Ctx, x: number, y: number, p: DuiPose) {
  const walking = !p.sit && !p.sleep && p.air === 0 && p.amt > 0.1;
  const step = walking ? Math.round(Math.sin(p.phase) * 2) : 0;
  const bob = walking ? Math.round(Math.abs(Math.cos(p.phase)) * 1) : 0;
  const tail = Math.round(Math.sin(p.tail) * 1.5);
  const sq = Math.round(p.squish * 3);
  const sw = p.swing > 0.2 ? 1 : 0;
  const air = p.air < -2 ? 1 : p.air > 2 ? 2 : 0;
  const pose = p.sleep ? 'z' : p.sit ? 's' : p.swim ? 'w' : 'n';
  const key = `dui|${pose}|${step}|${bob}|${tail}|${sq}|${sw}|${air}|${p.blink ? 1 : 0}`;
  const c = outlined(key, P.o0, 48, 40, 24, 36, (b) => duiBody(b, p, step, bob, tail, sq, sw, air));
  // A soft oval shadow on the ground.
  if (!p.swim && p.air === 0) {
    g.globalAlpha = 0.22;
    oval(g, Math.round(x), Math.round(y), 10, 1, '#3a2050');
    g.globalAlpha = 1;
  }
  g.save();
  g.translate(Math.round(x), Math.round(y));
  if (p.facing < 0) g.scale(-1, 1);
  g.drawImage(c, -24, -36);
  g.restore();
}

function duiBody(g: Ctx, p: DuiPose, step: number, bob: number, tail: number, sq: number, sw: number, air: number) {
  if (p.sleep) {
    // A squashed loaf ball, tail around, eyes shut.
    oval(g, -1, -7, 13, 7, P.o2);
    oval(g, -3, -9, 9, 4, P.o3);
    R(g, -6, -11, 3, 1, P.o4);
    R(g, 10, -3, 6, 3, P.o2);
    R(g, 14, -4, 3, 2, P.cream);
    // Ears
    R(g, -9, -16, 3, 3, P.o2);
    R(g, -8, -17, 1, 1, P.o2);
    R(g, 3, -16, 3, 3, P.o2);
    R(g, 4, -17, 1, 1, P.o2);
    R(g, -8, -15, 1, 2, P.blush);
    R(g, 4, -15, 1, 2, P.blush);
    // Closed eyes: little arcs
    R(g, -6, -8, 3, 1, P.eye);
    R(g, 1, -8, 3, 1, P.eye);
    R(g, -7, -9, 1, 1, P.eye);
    R(g, 4, -9, 1, 1, P.eye);
    oval(g, -9, -5, 2, 1, P.blush);
    oval(g, 7, -5, 2, 1, P.blush);
    R(g, -6, -1, 5, 1, P.cream);
    R(g, 1, -1, 5, 1, P.cream);
    return;
  }
  // Squish: wider and shorter.
  const rx = 11 + sq;
  const ry = 10 - sq;
  const cy = -ry - 1 - bob + (p.swim ? 2 : 0);
  // Tail, behind
  if (!p.swim) {
    R(g, -rx - 2, cy + 2, 3, 3, P.o2);
    R(g, -rx - 4, cy - 1 + tail, 3, 4, P.o2);
    R(g, -rx - 5, cy - 5 + tail * 2, 3, 5, P.o2);
    R(g, -rx - 5, cy - 6 + tail * 2, 3, 2, P.cream);
  }
  // Feet: cream ovals, apart when walking, tucked in the air.
  if (!p.swim) {
    const fy = air ? -3 : -1 - bob;
    if (p.sit) {
      oval(g, -3, -2, 4, 2, P.cream);
      oval(g, 6, -2, 4, 2, P.cream);
    } else {
      oval(g, -5 - step, fy, 4, 2, P.cream);
      oval(g, 5 + step, fy, 4, 2, P.cream);
      R(g, -8 - step, fy + 1, 7, 1, '#f0d8c0');
      R(g, 2 + step, fy + 1, 7, 1, '#f0d8c0');
    }
  }
  // Ears
  const ex = [-7, 4];
  for (const e of ex) {
    R(g, e, cy - ry - 2, 5, 4, P.o2);
    R(g, e + 1, cy - ry - 4, 3, 2, P.o2);
    R(g, e + 2, cy - ry - 5, 1, 1, P.o2);
    R(g, e + 1, cy - ry - 2, 3, 2, P.blush);
    R(g, e + 2, cy - ry - 3, 1, 1, P.blush);
  }
  // Body: the ball, lit from the top left.
  oval(g, 0, cy, rx, ry, P.o2);
  oval(g, -2, cy - 2, rx - 4, ry - 4, P.o3);
  oval(g, -1, cy - 1, rx - 4, ry - 4, P.o2);
  R(g, -rx + 4, cy - ry + 3, 3, 2, P.o4);
  R(g, -rx + 3, cy - ry + 5, 2, 1, P.o4);
  // Under-shade
  R(g, -rx + 4, cy + ry - 2, rx * 2 - 8, 1, P.o1);
  R(g, -rx + 6, cy + ry - 1, rx * 2 - 12, 1, P.o1);
  // Tabby stripes on top
  R(g, -3, cy - ry + 1, 2, 3, P.o1);
  R(g, 1, cy - ry + 1, 2, 4, P.o1);
  R(g, 5, cy - ry + 2, 2, 2, P.o1);
  // Face (it looks to the right; the sprite flips)
  const fx = 3;
  const fy = cy - 1;
  if (p.blink) {
    R(g, fx - 3, fy, 3, 1, P.eye);
    R(g, fx + 3, fy, 3, 1, P.eye);
  } else {
    for (const ex2 of [fx - 3, fx + 3]) {
      R(g, ex2, fy - 4, 3, 7, P.eye);
      R(g, ex2 - 1, fy - 3, 1, 5, P.eye);
      R(g, ex2 + 3, fy - 3, 1, 5, P.eye);
      R(g, ex2, fy + 1, 3, 2, P.eye1);
      R(g, ex2, fy - 3, 2, 2, P.white);
    }
  }
  // Cheeks
  oval(g, fx - 6, fy + 4, 2, 1, P.blush);
  oval(g, fx + 9, fy + 4, 2, 1, P.blush);
  // Nose and "w" mouth
  R(g, fx + 2, fy + 3, 2, 1, '#ff5a8a');
  R(g, fx + 1, fy + 5, 1, 1, P.o0);
  R(g, fx + 2, fy + 6, 1, 1, P.o0);
  R(g, fx + 3, fy + 5, 1, 1, P.o0);
  R(g, fx + 4, fy + 6, 1, 1, P.o0);
  R(g, fx + 5, fy + 5, 1, 1, P.o0);
  // Whiskers
  R(g, rx - 1, fy + 3, 4, 1, P.cream);
  R(g, rx - 1, fy + 5, 4, 1, P.cream);
  // Arms: little nubs; up when jumping, out when swiping.
  if (sw) {
    oval(g, rx + 2, cy + 2, 4, 3, P.o2);
    R(g, rx + 4, cy, 3, 4, P.cream);
    R(g, rx + 7, cy - 1, 2, 1, P.white);
    R(g, rx + 8, cy + 2, 2, 1, P.white);
    R(g, rx + 7, cy + 5, 2, 1, P.white);
  } else if (air === 1) {
    oval(g, -rx + 1, cy - 5, 2, 3, P.o2);
    oval(g, rx - 1, cy - 5, 2, 3, P.o2);
  } else {
    oval(g, -rx + 1, cy + 4, 3, 2, P.o2);
    oval(g, rx - 2, cy + 4, 3, 2, P.o2);
  }
  if (p.swim) {
    // Splash ring around the waterline.
    R(g, -rx - 2, -2, rx * 2 + 4, 2, P.w3);
    R(g, -rx - 4, -1, 3, 1, P.white);
    R(g, rx + 2, -1, 3, 1, P.white);
  }
}

export type DanielPose = { facing: 1 | -1; t: number; wave: boolean; blink: boolean };

/** Daniel, chibi: a big round head with the copper beard, small body. */
export function drawDaniel(g: Ctx, x: number, y: number, p: DanielPose) {
  const bob = Math.round(Math.sin(p.t * 1.6) * 0.6);
  const wave = p.wave ? (Math.sin(p.t * 9) > 0 ? 1 : 0) : 2;
  const key = `dan|${bob}|${wave}|${p.blink ? 1 : 0}`;
  const c = outlined(key, '#4a2a3a', 34, 46, 17, 44, (b) => {
    // Shoes and legs
    oval(b, -4, -2, 3, 2, '#6a3a5a');
    oval(b, 4, -2, 3, 2, '#6a3a5a');
    R(b, -5, -9, 4, 7, P.jeans);
    R(b, 1, -9, 4, 7, P.jeans);
    R(b, 0, -9, 1, 6, P.jeans0);
    // Body: a teal tee, rounded
    R(b, -7, -19 + bob, 14, 11, P.teal);
    R(b, -6, -20 + bob, 12, 1, P.teal);
    R(b, -5, -19 + bob, 4, 2, P.teal1);
    R(b, -7, -10 + bob, 14, 1, P.teal0);
    // Arms
    oval(b, -8, -13 + bob, 2, 3, P.teal);
    oval(b, -8, -10 + bob, 2, 1, P.skin);
    if (wave < 2) {
      oval(b, 9, -22 + bob - wave, 2, 4, P.teal);
      oval(b, 10, -27 + bob - wave, 2, 2, P.skin);
    } else {
      oval(b, 8, -13 + bob, 2, 3, P.teal);
      oval(b, 8, -10 + bob, 2, 1, P.skin);
    }
    // Head
    oval(b, 0, -29 + bob, 10, 9, P.skin);
    R(b, -6, -34 + bob, 4, 2, '#ffe6cc');
    // Hair cap
    oval(b, 0, -35 + bob, 10, 4, P.hair);
    R(b, -10, -34 + bob, 3, 6, P.hair);
    R(b, -3, -38 + bob, 6, 1, '#7a4a30');
    // Beard: round, from ear to ear
    oval(b, 1, -23 + bob, 8, 4, P.beard);
    R(b, -6, -27 + bob, 3, 4, P.beard);
    R(b, 6, -27 + bob, 3, 4, P.beard);
    R(b, -2, -20 + bob, 6, 1, P.beard0);
    R(b, -1, -25 + bob, 4, 1, '#ff8a8a');
    // Eyes
    if (p.blink) {
      R(b, -4, -29 + bob, 3, 1, P.eye);
      R(b, 3, -29 + bob, 3, 1, P.eye);
    } else {
      R(b, -3, -31 + bob, 2, 4, P.eye);
      R(b, 4, -31 + bob, 2, 4, P.eye);
      R(b, -3, -31 + bob, 1, 1, P.white);
      R(b, 4, -31 + bob, 1, 1, P.white);
    }
    oval(b, -6, -27 + bob, 1, 1, '#ff9aaa');
  });
  g.save();
  g.translate(Math.round(x), Math.round(y));
  if (p.facing < 0) g.scale(-1, 1);
  g.drawImage(c, -17, -44);
  g.restore();
}

/** Static props, outlined and cached. */
function prop(key: string, ink: string, w: number, h: number, ox: number, oy: number, x: number, y: number, g: Ctx, draw: (b: Ctx) => void) {
  g.drawImage(outlined(key, ink, w, h, ox, oy, draw), Math.round(x) - ox, Math.round(y) - oy);
}

export function sign(g: Ctx, x: number, y: number, color: string, read: boolean) {
  prop(`sign|${color}|${read}`, P.k0, 22, 26, 11, 24, x, y, g, (b) => {
    R(b, -1, -10, 3, 10, P.k1);
    R(b, -8, -20, 16, 11, P.k2);
    R(b, -9, -19, 18, 9, P.k2);
    R(b, -7, -19, 14, 9, color);
    R(b, -6, -18, 12, 7, color);
    R(b, -6, -19, 5, 1, P.white);
    if (read) {
      R(b, -3, -15, 2, 2, P.white);
      R(b, -1, -14, 2, 2, P.white);
      R(b, 1, -16, 2, 2, P.white);
      R(b, 3, -18, 2, 2, P.white);
    }
  });
}

export function board(g: Ctx, x: number, y: number) {
  prop('board', P.k0, 34, 38, 17, 36, x, y, g, (b) => {
    R(b, -11, -16, 3, 16, P.k1);
    R(b, 8, -16, 3, 16, P.k1);
    R(b, -14, -31, 28, 16, P.k2);
    R(b, -15, -30, 30, 14, P.k2);
    R(b, -13, -29, 26, 12, '#ffe6c0');
    const papers = [P.white, P.gold1, P.gl2, P.p3, '#d8ffc0'];
    for (let i = 0; i < 5; i++) {
      const px = -12 + i * 5;
      const py = -28 + (i % 2) * 4;
      R(b, px, py, 4, 6, papers[i]);
      R(b, px + 1, py, 2, 1, [P.red, '#4a9aff', P.g1, P.p1, P.gold0][i]);
    }
  });
}

export function welcome(g: Ctx, x: number, y: number) {
  prop('welcome', P.k0, 26, 28, 13, 26, x, y, g, (b) => {
    R(b, -1, -11, 3, 11, P.k1);
    R(b, -9, -22, 18, 12, P.k2);
    R(b, -10, -21, 20, 10, P.k2);
    R(b, -8, -21, 16, 10, '#ffe6c0');
    // A heart
    R(b, -4, -19, 3, 3, P.red);
    R(b, 1, -19, 3, 3, P.red);
    R(b, -4, -17, 8, 2, P.red);
    R(b, -3, -15, 6, 1, P.red);
    R(b, -2, -14, 4, 1, P.red);
    R(b, -1, -13, 2, 1, P.red);
    R(b, -3, -18, 1, 1, P.white);
  });
}

export function mailbox(g: Ctx, x: number, y: number) {
  prop('mail', P.red0, 22, 32, 11, 30, x, y, g, (b) => {
    R(b, -1, -13, 3, 13, P.k1);
    R(b, -7, -21, 14, 9, P.red);
    oval(b, 0, -21, 7, 3, P.red);
    R(b, -5, -23, 5, 1, '#ff9aa4');
    R(b, -7, -13, 14, 1, P.red0);
    R(b, 6, -27, 1, 7, P.gold0);
    R(b, 6, -27, 4, 3, P.gold);
  });
}

export function station(g: Ctx, x: number, y: number, led: string) {
  prop('station', P.metal0, 30, 42, 15, 40, x, y, g, (b) => {
    R(b, -1, -17, 3, 17, P.metal);
    R(b, -6, -27, 12, 10, '#7a88c8');
    R(b, -5, -26, 10, 1, '#b4c0f0');
    R(b, -4, -23, 3, 1, P.white);
    R(b, -4, -21, 3, 1, P.white);
    R(b, 3, -35, 1, 8, P.metal);
    disc(b, 3, -36, 1, P.red);
    R(b, -12, -31, 9, 5, '#4a9aff');
    R(b, -11, -30, 4, 1, P.gl2);
  });
  R(g, Math.round(x) + 2, Math.round(y) - 23, 2, 2, led);
}

export function lantern(g: Ctx, x: number, y: number, lit: boolean, t: number) {
  prop(`lantern|${lit}`, P.k0, 18, 30, 4, 28, x, y, g, (b) => {
    R(b, -1, -24, 2, 24, P.k1);
    R(b, -1, -24, 8, 2, P.k1);
    R(b, 2, -20, 8, 9, P.k2);
    R(b, 3, -19, 6, 7, lit ? P.gold : '#d8c8b8');
    R(b, 3, -19, 2, 2, P.white);
    R(b, 1, -21, 10, 1, P.r1);
  });
  if (lit && Math.sin(t * 7 + x) > 0.4) R(g, Math.round(x) + 6, Math.round(y) - 17, 1, 1, P.white);
}

export function campfire(g: Ctx, x: number, y: number, t: number, still: boolean) {
  prop('campseats', P.k0, 52, 14, 28, 12, x, y, g, (b) => {
    for (const dx of [-27, 13]) {
      R(b, dx, -7, 14, 7, P.k2);
      R(b, dx, -7, 14, 1, P.k3);
      oval(b, dx + 2, -4, 2, 3, '#ffe0b0');
      R(b, dx + 2, -4, 1, 1, P.k1);
    }
    for (let i = 0; i < 6; i++) disc(b, -8 + i * 3, -2, 1, i & 1 ? P.s1 : P.s2);
    R(b, -7, -5, 14, 2, P.k1);
  });
  const f = still ? 0 : Math.floor(t * 8) % 3;
  const X = Math.round(x);
  const Y = Math.round(y);
  const h = [11, 13, 12][f];
  // A round teardrop flame: red rim, orange body, yellow heart.
  oval(g, X, Y - 9, 5, 5, '#ff5a3a');
  R(g, X - 2 + (f - 1), Y - 5 - h, 4, h - 6, '#ff5a3a');
  oval(g, X, Y - 8, 4, 4, '#ffa03a');
  R(g, X - 1 + (f - 1), Y - 3 - h, 3, h - 7, '#ffa03a');
  oval(g, X, Y - 7, 2, 2, P.gold);
  R(g, X - 1, Y - 8, 1, 1, P.white);
}

export function gear(g: Ctx, x: number, y: number, angle: number) {
  for (let i = 0; i < 8; i++) {
    const a = angle + (i * Math.PI) / 4;
    disc(g, x + Math.cos(a) * 6, y + Math.sin(a) * 6, 1, P.metal0);
  }
  disc(g, x, y, 5, P.metal0);
  disc(g, x, y, 4, P.metal);
  disc(g, x, y, 1, P.metal0);
}

export function plant(g: Ctx, x: number, y: number, kind: 'sunflower' | 'carrot' | 'tomato' | 'cabbage', growth: number, t: number) {
  const k = Math.max(0, Math.min(1, (growth - 1) / 0.45));
  const X = Math.round(x);
  const Y = Math.round(y);
  const sway = Math.round(Math.sin(t * 1.3 + x) * k);
  // A seedling always shows, so an empty plot never looks bare.
  if (k < 0.15) {
    R(g, X, Y - 3, 1, 3, P.g1);
    R(g, X - 2, Y - 4, 2, 2, P.g2);
    R(g, X + 1, Y - 4, 2, 2, P.g2);
    return;
  }
  if (kind === 'sunflower') {
    const h = 6 + Math.round(k * 14);
    R(g, X, Y - h, 2, h, P.g1);
    oval(g, X - 2, Y - Math.round(h / 2), 2, 1, P.g2);
    oval(g, X + 3, Y - Math.round(h * 0.7), 2, 1, P.g2);
    disc(g, X + sway, Y - h - 3, 5, P.gold0);
    disc(g, X + sway, Y - h - 3, 4, P.gold);
    disc(g, X + sway, Y - h - 3, 2, P.k1);
    R(g, X - 1 + sway, Y - h - 4, 1, 1, P.k3);
  } else if (kind === 'tomato') {
    const h = 4 + Math.round(k * 10);
    oval(g, X, Y - h / 2, 5, Math.round(h / 2), P.l1);
    oval(g, X - 1, Y - h / 2 - 1, 3, Math.max(1, Math.round(h / 3)), P.l2);
    if (k > 0.6) {
      disc(g, X - 2, Y - h + 4, 2, P.red);
      disc(g, X + 2, Y - h + 7, 2, P.red);
      R(g, X - 3, Y - h + 3, 1, 1, P.white);
    }
  } else if (kind === 'carrot') {
    const h = 3 + Math.round(k * 9);
    R(g, X - 2, Y - h, 2, h, P.g2);
    R(g, X, Y - h - 2, 2, h + 2, P.g3);
    R(g, X + 2, Y - h, 2, h, P.g2);
    if (k > 0.7) oval(g, X, Y - 1, 2, 1, '#ff8a2a');
  } else {
    const r = 2 + Math.round(k * 4);
    oval(g, X, Y - r, r + 1, r, '#5ab84a');
    oval(g, X, Y - r, r, r - 1, '#a8ee88');
    R(g, X - 1, Y - r * 2 + 2, 2, 2, '#e0ffcc');
  }
}

/** A five-pointed star with a deep-gold outline and a shine. */
export function star(g: Ctx, x: number, y: number, size: number, c: string) {
  const X = Math.round(x);
  const Y = Math.round(y);
  if (size <= 1) {
    R(g, X, Y - 2, 1, 5, c);
    R(g, X - 2, Y, 5, 1, c);
    return;
  }
  const s = size;
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i & 1 ? s * 0.48 : s * 1.15;
    pts.push([X + Math.cos(a) * r, Y + Math.sin(a) * r]);
  }
  const fill = (col: string, grow: number) => {
    g.fillStyle = col;
    for (let yy = Math.floor(Y - s * 1.3) - grow; yy <= Math.ceil(Y + s) + grow; yy++) {
      // Scanline fill of the polygon (crisp pixels, no anti-aliasing).
      const xs: number[] = [];
      for (let i = 0; i < 10; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % 10];
        const yc = yy + 0.5;
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.round(xs[i]) - grow;
        const b = Math.round(xs[i + 1]) + grow;
        if (b > a) g.fillRect(a, yy, b - a, 1);
      }
    }
  };
  fill(P.gold0, 1);
  fill(c, 0);
  R(g, X - 1, Y - Math.round(s * 0.5), 1, 2, P.white);
  R(g, X - Math.round(s * 0.5), Y - 1, 1, 1, P.white);
}

export function heart(g: Ctx, x: number, y: number, c: string) {
  const X = Math.round(x);
  const Y = Math.round(y);
  R(g, X - 3, Y - 2, 3, 3, c);
  R(g, X + 1, Y - 2, 3, 3, c);
  R(g, X - 3, Y, 7, 1, c);
  R(g, X - 2, Y + 1, 5, 1, c);
  R(g, X - 1, Y + 2, 3, 1, c);
  R(g, X, Y + 3, 1, 1, c);
  R(g, X - 2, Y - 1, 1, 1, P.white);
}

/** Tall grass: round-tipped tufts with an outline, leaning with the wind. */
export function grass(g: Ctx, px: number, py: number, x: number, y: number, t: number, wind: number, push: number) {
  const base = Math.round(py) + TILE;
  for (let i = 0; i < 3; i++) {
    const h = hash(x, y, 30 + i);
    const bx = Math.round(px) + 2 + i * 5 + (h % 2);
    const bh = 8 + ((h >>> 5) % 5);
    const lean = Math.round(Math.sin(t * 1.6 + x * 0.45 + i) * wind + push);
    const mid = Math.round(bh / 2);
    const tipX = bx + lean;
    R(g, bx - 1, base - mid, 4, mid, P.g0);
    R(g, tipX - 1, base - bh - 1, 4, bh - mid + 1, P.g0);
    R(g, bx, base - mid, 2, mid, P.g1);
    R(g, tipX, base - bh, 2, bh - mid, P.g2);
    R(g, tipX, base - bh, 1, 2, P.g4);
  }
}

/** A big puffy cloud: round on every side, colored outline. Cached. */
const cloudCache = new Map<string, HTMLCanvasElement>();
export function cloud(seed: number, w: number, body: string, light: string, shade: string) {
  const key = `${seed}|${w}|${body}|${light}|${shade}`;
  let c = cloudCache.get(key);
  if (!c) {
    if (cloudCache.size > 40) cloudCache.clear();
    c = document.createElement('canvas');
    const h = Math.round(w * 0.5);
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    let a = seed * 9301 + 49297;
    const rnd = () => ((a = (a * 9301 + 49297) % 233280), a / 233280);
    // A row of puffs along the bottom, a couple of bigger ones on top.
    const puffs: [number, number, number][] = [];
    const rb = Math.round(h * 0.26);
    for (let px = rb + 1; px <= w - rb - 1; px += Math.max(4, Math.round(rb * 1.3))) puffs.push([px, h - rb - 2, rb]);
    for (let i = 0; i < 2; i++) {
      const r = Math.round(h * (0.3 + rnd() * 0.08));
      puffs.push([Math.round(w * (0.33 + i * 0.3 + rnd() * 0.06)), Math.round(h - r - rb * 0.9), r]);
    }
    // Outline, then a shaded rim, then the body nudged up: the rim shows
    // along the bottom of each puff.
    for (const [cx, cy, r] of puffs) disc(g, cx, cy, r + 1, shade);
    for (const [cx, cy, r] of puffs) disc(g, cx, cy, r, tone(shade, 0.55));
    for (const [cx, cy, r] of puffs) disc(g, cx, cy - 1, r - 1, body);
    for (const [cx, cy, r] of puffs) if (r > 3) R(g, cx - Math.round(r * 0.5), cy - Math.round(r * 0.6), Math.max(2, Math.round(r * 0.4)), 2, light);
    cloudCache.set(key, c);
  }
  return c;
}

/* ── Sun, moon and distant hills ─────────────────────────────────────────── */

export function sun(g: Ctx, x: number, y: number, t: number, still: boolean) {
  const X = Math.round(x);
  const Y = Math.round(y);
  const turn = still ? 0 : Math.floor(t * 2) % 2;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + (turn * Math.PI) / 8;
    disc(g, X + Math.cos(a) * 17, Y + Math.sin(a) * 17, 2, '#ffd23a');
  }
  disc(g, X, Y, 12, '#ff9a2a');
  disc(g, X, Y, 11, P.gold);
  disc(g, X - 3, Y - 3, 5, P.gold1);
  R(g, X - 6, Y - 7, 3, 2, P.white);
}

export function moon(g: Ctx, x: number, y: number) {
  const X = Math.round(x);
  const Y = Math.round(y);
  disc(g, X, Y, 10, '#c8b0ff');
  disc(g, X, Y, 9, '#fff4c0');
  // A crescent: the night sky bites a disc out of it.
  disc(g, X + 5, Y - 3, 7, '#c8b0ff');
  g.globalCompositeOperation = 'destination-out';
  disc(g, X + 6, Y - 3, 7, '#000');
  g.globalCompositeOperation = 'source-over';
}

const HILL_STEP = 3;
const hillCache = new Map<string, HTMLCanvasElement>();
let stripeTile: HTMLCanvasElement | null = null;
/**
 * A strip of rolling hills, one period wide, with diagonal stripes, a deep
 * outline along the top and, on the near layer, lollipop trees. The bottom
 * row of the strip sits on the horizon.
 */
export function hills(samples: Float32Array, color: string, trees: boolean) {
  const key = `${samples[3]}|${color}|${trees}`;
  let c = hillCache.get(key);
  if (c) return c;
  if (hillCache.size > 24) hillCache.clear();
  const n = samples.length;
  let top = 0;
  for (const v of samples) top = Math.max(top, v);
  const H = Math.ceil(top) + 22;
  c = document.createElement('canvas');
  c.width = n * HILL_STEP;
  c.height = H;
  const g = c.getContext('2d')!;
  const ink = tone(color, -0.35);
  const at = (x: number) => {
    const f = x / HILL_STEP;
    const i = Math.floor(f);
    const a = samples[i % n];
    const b = samples[(i + 1) % n];
    return Math.round(a + (b - a) * (f - i));
  };
  for (let x = 0; x < c.width; x++) R(g, x, H - at(x), 1, at(x), color);
  // Diagonal stripes in a lighter shade, only on the hills.
  if (!stripeTile) {
    stripeTile = document.createElement('canvas');
    stripeTile.width = stripeTile.height = 16;
    const s = stripeTile.getContext('2d')!;
    s.fillStyle = '#fff';
    for (let i = 0; i < 16; i++) s.fillRect((i + 16) % 16, i, 6, 1), s.fillRect(i - 16, i, 6, 1);
  }
  const st = document.createElement('canvas');
  st.width = c.width;
  st.height = H;
  const sg = st.getContext('2d')!;
  sg.fillStyle = sg.createPattern(stripeTile, 'repeat')!;
  sg.fillRect(0, 0, st.width, H);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = tone(color, 0.16);
  sg.fillRect(0, 0, st.width, H);
  g.globalCompositeOperation = 'source-atop';
  g.drawImage(st, 0, 0);
  g.globalCompositeOperation = 'source-over';
  // Outline along the top, joined where the slope steps.
  for (let x = 0; x < c.width; x++) {
    const y = H - at(x);
    const yn = H - at(x + 1);
    R(g, x, Math.min(y, yn), 1, Math.abs(yn - y) + 1, ink);
    R(g, x, y + 1, 1, 1, tone(color, 0.35));
  }
  if (trees) {
    for (let x = 9; x < c.width - 8; x += 26 + (hash(x, 3) % 40)) {
      const y = H - at(x);
      const r = 4 + (hash(x, 5) % 3);
      R(g, x - 1, y - 8, 3, 9, ink);
      R(g, x, y - 8, 1, 8, tone(color, -0.15));
      disc(g, x, y - 8 - r, r + 1, ink);
      disc(g, x, y - 8 - r, r, tone(color, 0.08));
      R(g, x - Math.round(r / 2), y - 8 - r - Math.round(r / 2), 2, 2, tone(color, 0.45));
    }
  }
  hillCache.set(key, c);
  return c;
}

/* ── Trees: lollipops, puffy blossoms and round-tiered pines ─────────────── */

const treeCache = new Map<string, HTMLCanvasElement>();
/**
 * A whole tree as one outlined sprite. `trunk` and `r` are in blocks, as in
 * world.ts; the sprite's anchor is the middle of the trunk's foot, (W / 2, H).
 */
export function tree(kind: 'round' | 'blossom' | 'pine', trunk: number, r: number, fruit: boolean, seed: number) {
  const key = `${kind}|${trunk}|${r}|${fruit}|${seed}`;
  let c = treeCache.get(key);
  if (c) return c;
  const H = (trunk + r * 2 + 4) * TILE;
  const W = (r + 2) * 2 * TILE + 24;
  const ox = W / 2;
  const pal = kind === 'blossom' ? [P.p0, P.p1, P.p2, P.p3] : kind === 'pine' ? [P.n0, P.n1, P.n2, P.n3] : [P.l0, P.l1, P.l2, P.l3];
  c = outlined(key, pal[0], W, H, ox, H, (g) => {
    const top = -trunk * TILE;
    // Trunk: a honey stick, a little wider at the foot.
    R(g, -4, top - 8, 8, trunk * TILE + 8, P.k1);
    R(g, -6, -4, 12, 4, P.k1);
    R(g, -2, top - 8, 3, trunk * TILE + 8, P.k2);
    R(g, -1, top - 8, 1, trunk * TILE + 4, P.k3);
    if (kind === 'pine') {
      // Three round-cornered tiers, smaller to the top.
      for (let i = 0; i < 3; i++) {
        const w = 22 - i * 6;
        const y = top - 6 - i * 13;
        oval(g, 0, y, w, 8, pal[0]);
        oval(g, 0, y - 1, w - 1, 7, pal[1]);
        oval(g, -2, y - 3, w - 6, 4, pal[2]);
        R(g, -w + 6, y - 5, 4, 2, pal[3]);
      }
      disc(g, 0, top - 50, 3, pal[2]);
      return;
    }
    // Canopy: a big round crown with bumps all around.
    const cx = 0;
    const cy = top - (r - 1) * TILE - 8;
    const rx = (r + 1) * TILE - 2;
    const ry = r * TILE + 4;
    let a = seed * 7919 + 13;
    const rnd = () => ((a = (a * 9301 + 49297) % 233280), a / 233280);
    const bumps: [number, number, number][] = [];
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2 + rnd() * 0.3;
      bumps.push([cx + Math.cos(ang) * rx * 0.72, cy + Math.sin(ang) * ry * 0.7, Math.round(Math.min(rx, ry) * (0.38 + rnd() * 0.08))]);
    }
    for (const [bx, by, br] of bumps) disc(g, bx, by, br, pal[1]);
    oval(g, cx, cy, Math.round(rx * 0.82), Math.round(ry * 0.8), pal[1]);
    // Light from the top left: lighter bumps there, a shine spot.
    for (const [bx, by, br] of bumps) if (by < cy + 2) disc(g, bx - 1, by - 2, br - 2, pal[2]);
    oval(g, cx - 4, cy - 5, Math.round(rx * 0.55), Math.round(ry * 0.5), pal[2]);
    disc(g, cx - rx * 0.4, cy - ry * 0.4, 3, pal[3]);
    R(g, Math.round(cx - rx * 0.4) + 4, Math.round(cy - ry * 0.4) - 2, 2, 2, pal[3]);
    if (fruit) {
      for (let i = 0; i < 4; i++) {
        const fx = cx + Math.round((rnd() - 0.5) * rx * 1.2);
        const fy = cy + Math.round((rnd() - 0.3) * ry * 0.9);
        disc(g, fx, fy, 3, P.red0);
        disc(g, fx, fy, 2, P.red);
        R(g, fx - 1, fy - 2, 1, 1, P.white);
        R(g, fx, fy - 4, 1, 2, P.k0);
      }
    }
    if (kind === 'blossom') {
      for (let i = 0; i < 7; i++) {
        const fx = cx + Math.round((rnd() - 0.5) * rx * 1.3);
        const fy = cy + Math.round((rnd() - 0.5) * ry * 1.1);
        R(g, fx - 1, fy, 3, 1, P.white);
        R(g, fx, fy - 1, 1, 3, P.white);
        R(g, fx, fy, 1, 1, P.gold);
      }
    }
  });
  treeCache.set(key, c);
  return c;
}
