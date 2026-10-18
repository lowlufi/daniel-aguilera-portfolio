import { PROJECTS } from '../data';

/*
 * The island, seen from the side: a Terraria-style world of blocks.
 *
 * Units are tiles. x grows to the right, y grows DOWN (y = 0 is the top of the
 * sky). The UI keeps using `pos.x` / `pos.z` for distances, so the scene
 * stores the vertical position in `z` and leaves `y` alone: that way
 * IslandGame's `Math.hypot(it.x - pos.x, it.z - pos.z)` keeps meaning
 * "how far is Dui from this thing" without touching it.
 */

/** Tiny vector so the game no longer needs three.js. */
export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  clone() {
    return new Vec3(this.x, this.y, this.z);
  }
  copy(v: Vec3) {
    return this.set(v.x, v.y, v.z);
  }
}

// Deterministic PRNG so the island looks the same on every visit.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Size and tiles ──────────────────────────────────────────────────────── */

export const WORLD_W = 220;
export const WORLD_H = 80;
/** Rows at or below this are sea outside the island. */
export const SEA_LEVEL = 44;
/** The island's land runs between these columns (beaches included). */
export const ISLAND_X0 = 14;
export const ISLAND_X1 = 196;

export const T = {
  AIR: 0,
  DIRT: 1,
  GRASS: 2,
  STONE: 3,
  SAND: 4,
  WATER: 5,
  PLANK: 6,
  WOODWALL: 7,
  BRICKWALL: 8,
  ROOF: 9,
  WINDOW: 10,
  DOOR: 11,
  TRUNK: 12,
  LEAVES: 13,
  TALLGRASS: 14,
  FLOWER: 15,
  FENCE: 16,
  SOIL: 17,
  ORE: 18,
  POST: 19,
  CHIMNEY: 20,
  LEAVES_BLOSSOM: 21,
  LEAVES_PINE: 22,
  LEAVES_FRUIT: 23,
} as const;
export type Tile = (typeof T)[keyof typeof T];

const SOLID = new Set<number>([T.DIRT, T.GRASS, T.STONE, T.SAND, T.PLANK, T.ROOF, T.SOIL, T.ORE, T.CHIMNEY]);
/** What Dui's paws can dig. Stone and ore stay put. */
const DIGGABLE = new Set<number>([T.DIRT, T.GRASS, T.SAND]);

export const isSolidTile = (t: number) => SOLID.has(t);
export const isDiggableTile = (t: number) => DIGGABLE.has(t);

export const tiles = new Uint8Array(WORLD_W * WORLD_H);
export const idx = (x: number, y: number) => y * WORLD_W + x;
export function tileAt(x: number, y: number): number {
  if (x < 0 || x >= WORLD_W) return T.STONE;
  if (y < 0) return T.AIR;
  if (y >= WORLD_H) return T.STONE;
  return tiles[idx(x, y)];
}
export function solidAt(x: number, y: number) {
  return isSolidTile(tileAt(x, y));
}

/** Feet level of the ground at each column (the first solid row from the top). */
export const SURFACE = new Int16Array(WORLD_W);

/* ── Landmarks (x in tiles, left to right) ───────────────────────────────── */

export const WORKSHOP = { x: 34, w: 11, h: 6 };
export const GARDEN = { x: 56, z: 0 };
export const STATION = { x: 70, z: 0 };
export const PLAZA = { x: 106, z: 0 }; // the bulletin board
export const WELCOME = { x: 118, z: 0 };
export const DANIEL = { x: 134, z: 0 };
export const HOUSE = { x: 143, w: 11, h: 6 };
export const MAILBOX = { x: 158, z: 0 };
export const DOCK = { x0: 196, x1: 212, y: SEA_LEVEL - 1 };
export const DOCK_END = { x: 210, z: SEA_LEVEL - 1 };
export const SPAWN = new Vec3(121, 0, 0);

export const PROJECT_COLORS = ['#f0a45d', '#7cc6e8', '#9fd67a', '#e37b8b', '#b28ee0', '#f2cf5b', '#6fd1c1', '#c9a27a'];

/** Project signs in a row west of the bulletin board. */
export const PROJECT_SIGNS = PROJECTS.map((p, i) => ({
  project: p,
  x: 78 + i * 2.2,
  z: 0,
  color: PROJECT_COLORS[i % PROJECT_COLORS.length],
}));

export type GardenPlot = { x: number; z: number; kind: 'sunflower' | 'carrot' | 'tomato' | 'cabbage' };
export const GARDEN_PLOTS: GardenPlot[] = [
  { x: GARDEN.x - 6, z: 0, kind: 'sunflower' },
  { x: GARDEN.x - 2, z: 0, kind: 'tomato' },
  { x: GARDEN.x + 2, z: 0, kind: 'carrot' },
  { x: GARDEN.x + 6, z: 0, kind: 'cabbage' },
];

/* ── Terrain ─────────────────────────────────────────────────────────────── */

// Areas kept flat so buildings and signs sit on level ground.
const FLATS: { x0: number; x1: number }[] = [
  { x0: WORKSHOP.x - 7, x1: WORKSHOP.x + 7 },
  { x0: GARDEN.x - 9, x1: GARDEN.x + 9 },
  { x0: STATION.x - 2, x1: STATION.x + 2 },
  { x0: 75, x1: 109 },
  // Wide enough for the campfire and its log seats (ambiente.ts).
  { x0: WELCOME.x - 4, x1: WELCOME.x + 10 },
  { x0: DANIEL.x - 3, x1: HOUSE.x + 8 },
  { x0: MAILBOX.x - 2, x1: MAILBOX.x + 2 },
];

function rawHeight(x: number) {
  // Gentle hills: the slope never passes one tile per tile, so Dui can walk
  // the whole island without jumping. Jumping is for roofs and holes.
  const h = 2.2 * Math.sin(x / 11) + 1.6 * Math.sin(x / 5.3 + 2) + 3 * Math.sin(x / 31 + 1);
  // Between 30 and 42: always above the sea (44), with the beaches as the lowest ground.
  return 36 - h;
}

(function buildSurface() {
  const raw = new Float32Array(WORLD_W);
  for (let x = 0; x < WORLD_W; x++) raw[x] = rawHeight(x);
  // Flats: level inside, blended over 5 tiles outside.
  for (const f of FLATS) {
    const level = Math.round(raw[Math.floor((f.x0 + f.x1) / 2)]);
    for (let x = f.x0 - 5; x <= f.x1 + 5; x++) {
      if (x < 0 || x >= WORLD_W) continue;
      const d = x < f.x0 ? f.x0 - x : x > f.x1 ? x - f.x1 : 0;
      const k = Math.max(0, 1 - d / 5);
      raw[x] = raw[x] + (level - raw[x]) * k;
    }
  }
  // Beaches: the land dips to the sea at both ends.
  for (let x = 0; x < WORLD_W; x++) {
    let y = raw[x];
    const edge = Math.min(x - ISLAND_X0, ISLAND_X1 - x);
    if (edge < 10) {
      const k = Math.max(0, edge) / 10;
      y = (SEA_LEVEL - 1) + (y - (SEA_LEVEL - 1)) * k * k;
    }
    SURFACE[x] = Math.min(SEA_LEVEL - 1, Math.round(y));
  }
  // The beach curve and two flats at different levels side by side (the
  // plaza and the campfire) left two-block steps that stopped Dui dead when
  // walking with A/D held. Sweep west to east keeping every step at one
  // block, which the walk's step-up climbs on its own. Going this way the
  // west beach stays low by the sea (the hill behind it eases down instead).
  for (let x = ISLAND_X0 + 1; x <= ISLAND_X1; x++) SURFACE[x] = Math.max(SURFACE[x - 1] - 1, Math.min(SURFACE[x], SURFACE[x - 1] + 1));
})();

export const isBeach = (x: number) => Math.min(x - ISLAND_X0, ISLAND_X1 - x) < 7;
export const inIsland = (x: number) => x >= ISLAND_X0 && x <= ISLAND_X1;

/* ── Trees, grass, stars, caves ──────────────────────────────────────────── */

export type Tree = { x: number; kind: 'round' | 'blossom' | 'pine'; trunk: number; r: number; fruit: boolean };

const KEEP_CLEAR: { x0: number; x1: number }[] = [
  { x0: WORKSHOP.x - 7, x1: WORKSHOP.x + 7 },
  { x0: GARDEN.x - 10, x1: GARDEN.x + 10 },
  { x0: STATION.x - 3, x1: STATION.x + 3 },
  { x0: 75, x1: 110 },
  { x0: WELCOME.x - 4, x1: WELCOME.x + 11 },
  { x0: DANIEL.x - 4, x1: HOUSE.x + 9 },
  { x0: MAILBOX.x - 3, x1: MAILBOX.x + 3 },
];
const clear = (x: number, pad = 0) => !KEEP_CLEAR.some((k) => x >= k.x0 - pad && x <= k.x1 + pad);

export const TREES: Tree[] = (() => {
  const rnd = mulberry32(42);
  const out: Tree[] = [];
  let guard = 0;
  while (out.length < 22 && guard++ < 3000) {
    const x = ISLAND_X0 + 8 + Math.floor(rnd() * (ISLAND_X1 - ISLAND_X0 - 16));
    if (!clear(x, 1) || isBeach(x)) continue;
    if (out.some((t) => Math.abs(t.x - x) < 7)) continue;
    const k = rnd();
    const kind = k < 0.3 ? 'blossom' : k < 0.55 ? 'pine' : 'round';
    out.push({ x, kind, trunk: 3 + Math.floor(rnd() * 3), r: kind === 'pine' ? 2 : 2 + Math.floor(rnd() * 2), fruit: kind === 'round' && rnd() < 0.5 });
  }
  return out.sort((a, b) => a.x - b.x);
})();

/** Small pockets underground; a star waits in some of them. Dig down to get there. */
export const CAVES: { x: number; depth: number; w: number; h: number; star: boolean }[] = [
  // Not under the garden: its soil can't be dug, so the star would be unreachable.
  { x: 67, depth: 6, w: 6, h: 3, star: true },
  { x: 96, depth: 7, w: 5, h: 3, star: false },
  { x: 128, depth: 6, w: 8, h: 4, star: true },
  { x: 170, depth: 7, w: 6, h: 3, star: true },
  { x: 46, depth: 9, w: 4, h: 3, star: true },
];

export const STAR_COUNT = 12;

(function buildTiles() {
  const rnd = mulberry32(7);
  // Ground and sea.
  for (let x = 0; x < WORLD_W; x++) {
    const s = SURFACE[x];
    const dirtDepth = 7 + Math.floor(2.5 * Math.sin(x / 13) + rnd() * 2);
    for (let y = 0; y < WORLD_H; y++) {
      let t: number = T.AIR;
      if (!inIsland(x)) {
        if (y >= SEA_LEVEL) t = y >= SEA_LEVEL + 10 + Math.floor(rnd() * 3) ? T.STONE : T.WATER;
      } else if (y === s) t = isBeach(x) ? T.SAND : T.GRASS;
      else if (y > s) {
        if (y < s + dirtDepth) t = isBeach(x) && y < s + 3 ? T.SAND : T.DIRT;
        else t = rnd() < 0.06 ? T.ORE : T.STONE;
      }
      tiles[idx(x, y)] = t;
    }
    // The beach below sea level is wet sand under water.
    if (inIsland(x) && isBeach(x) && s >= SEA_LEVEL) {
      for (let y = SEA_LEVEL; y < s; y++) tiles[idx(x, y)] = T.WATER;
    }
  }
  // Caves: a pocket of air below the surface. Everything between the grass
  // and the pocket is dirt, never stone, so paws can always dig down to it.
  for (const c of CAVES) {
    const top = SURFACE[c.x] + c.depth;
    for (let x = c.x - Math.floor(c.w / 2); x < c.x + Math.ceil(c.w / 2); x++) {
      for (let y = SURFACE[x] + 1; y < top; y++) tiles[idx(x, y)] = T.DIRT;
      for (let y = top; y < top + c.h; y++) tiles[idx(x, y)] = T.AIR;
    }
  }
  // Trees: trunk and canopy are background tiles (Dui walks in front of them).
  for (const tr of TREES) {
    const base = SURFACE[tr.x] - 1;
    for (let y = base; y > base - tr.trunk; y--) tiles[idx(tr.x, y)] = T.TRUNK;
    const cy = base - tr.trunk - (tr.kind === 'pine' ? 1 : tr.r - 1);
    const leaf = tr.kind === 'blossom' ? T.LEAVES_BLOSSOM : tr.kind === 'pine' ? T.LEAVES_PINE : tr.fruit ? T.LEAVES_FRUIT : T.LEAVES;
    if (tr.kind === 'pine') {
      for (let row = 0; row < 5; row++) {
        const half = row < 2 ? 0 + row : row - 1;
        for (let dx = -half; dx <= half; dx++) {
          const x = tr.x + dx;
          const y = cy - 4 + row;
          if (tiles[idx(x, y)] === T.AIR) tiles[idx(x, y)] = leaf;
        }
      }
    } else {
      for (let dy = -tr.r; dy <= tr.r; dy++)
        for (let dx = -tr.r - 1; dx <= tr.r + 1; dx++) {
          if ((dx / (tr.r + 1)) ** 2 + (dy / tr.r) ** 2 > 1.05) continue;
          const x = tr.x + dx;
          const y = cy + dy;
          if (y >= 0 && x >= 0 && x < WORLD_W && tiles[idx(x, y)] === T.AIR) tiles[idx(x, y)] = leaf;
        }
    }
  }
  // Buildings: background walls, a stepped roof you can climb, windows, a door.
  const building = (b: { x: number; w: number; h: number }, wall: number, chimney: boolean) => {
    const L = SURFACE[b.x];
    const x0 = b.x - Math.floor(b.w / 2);
    for (let x = x0; x < x0 + b.w; x++) for (let y = L - b.h; y < L; y++) tiles[idx(x, y)] = wall;
    for (let step = 0; step < 3; step++) {
      const y = L - b.h - 1 - step;
      for (let x = x0 - 1 + step * 2; x < x0 + b.w + 1 - step * 2; x++) tiles[idx(x, y)] = T.ROOF;
    }
    const wy = L - b.h + 2;
    for (const wx of [x0 + 1, x0 + b.w - 3]) for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) tiles[idx(wx + dx, wy + dy)] = T.WINDOW;
    const dx0 = b.x - 1;
    tiles[idx(dx0, L - 1)] = T.DOOR;
    tiles[idx(dx0 + 1, L - 1)] = T.DOOR;
    tiles[idx(dx0, L - 2)] = T.DOOR;
    tiles[idx(dx0 + 1, L - 2)] = T.DOOR;
    if (chimney) {
      const cx = x0 + b.w - 2;
      tiles[idx(cx, L - b.h - 3)] = T.CHIMNEY;
      tiles[idx(cx, L - b.h - 4)] = T.CHIMNEY;
    }
  };
  building(HOUSE, T.WOODWALL, true);
  building(WORKSHOP, T.BRICKWALL, false);
  // Garden: soil plots with a fence at both ends.
  for (const p of GARDEN_PLOTS) {
    const s = SURFACE[p.x];
    for (let dx = -1; dx <= 1; dx++) tiles[idx(p.x + dx, s)] = T.SOIL;
  }
  for (const fx of [GARDEN.x - 9, GARDEN.x + 9]) tiles[idx(fx, SURFACE[fx] - 1)] = T.FENCE;
  // Dock: planks over the water, posts underneath.
  for (let x = DOCK.x0; x <= DOCK.x1; x++) tiles[idx(x, DOCK.y)] = T.PLANK;
  for (const px of [DOCK.x0 + 2, DOCK.x0 + 8, DOCK.x1 - 1]) for (let y = DOCK.y + 1; y < DOCK.y + 5; y++) if (tiles[idx(px, y)] === T.WATER) tiles[idx(px, y)] = T.POST;
  // Tall grass and flowers on the surface, where nothing is built.
  const grass = mulberry32(99);
  for (let x = ISLAND_X0 + 7; x < ISLAND_X1 - 7; x++) {
    const s = SURFACE[x];
    if (tiles[idx(x, s)] !== T.GRASS || tiles[idx(x, s - 1)] !== T.AIR) continue;
    if (!clear(x) && !(x >= 110 && x <= 113)) continue;
    const k = grass();
    if (k < 0.5) tiles[idx(x, s - 1)] = T.TALLGRASS;
    else if (k < 0.58) tiles[idx(x, s - 1)] = T.FLOWER;
  }
})();

export const GARDEN_Z = SURFACE[GARDEN.x];
GARDEN.z = GARDEN_Z;
STATION.z = SURFACE[STATION.x];
PLAZA.z = SURFACE[PLAZA.x];
WELCOME.z = SURFACE[WELCOME.x];
DANIEL.z = SURFACE[DANIEL.x];
MAILBOX.z = SURFACE[MAILBOX.x];
SPAWN.z = SURFACE[Math.round(SPAWN.x)];
for (const s of PROJECT_SIGNS) s.z = SURFACE[Math.round(s.x)];
for (const p of GARDEN_PLOTS) p.z = SURFACE[p.x];

/** Where the stars hide: 8 under tall grass, 4 in caves you have to dig to. */
export const STAR_SPOTS: { x: number; z: number; cave: boolean }[] = (() => {
  const rnd = mulberry32(2024);
  const out: { x: number; z: number; cave: boolean }[] = [];
  // `z` is the row Dui stands on (the cave floor), like `SURFACE[x]` for the
  // grass ones: the star floats the same height over both, so walking up to
  // it takes it. With the last air row here, cave stars hung a block higher
  // and only a jump reached them.
  for (const c of CAVES) if (c.star) out.push({ x: c.x, z: SURFACE[c.x] + c.depth + c.h, cave: true });
  const tall: number[] = [];
  for (let x = 0; x < WORLD_W; x++) if (tiles[idx(x, SURFACE[x] - 1)] === T.TALLGRASS) tall.push(x);
  // Keep the grass stars apart from each other (the cave ones are deep
  // underground and don't crowd the surface), and shrink the spacing when the
  // island runs out of room: how much tall grass grows depends on the terrain,
  // and a fixed nine-block gap once left eleven stars on an island that
  // promises twelve.
  for (const gap of [9, 7, 5, 3, 1]) {
    let guard = 0;
    while (out.length < STAR_COUNT && guard++ < 2000) {
      const x = tall[Math.floor(rnd() * tall.length)];
      if (out.some((s) => !s.cave && Math.abs(s.x - x) < gap)) continue;
      out.push({ x, z: SURFACE[x], cave: false });
    }
  }
  return out;
})();

/* ── Things Dui can interact with ────────────────────────────────────────── */

export type InteractableId = 'welcome' | 'daniel' | 'board' | 'garden' | 'mailbox' | 'station' | 'dock' | `project:${number}`;

export type Interactable = {
  id: InteractableId;
  label: string;
  verb: string;
  x: number;
  z: number;
  radius: number;
};

export const INTERACTABLES: Interactable[] = [
  { id: 'welcome', label: 'Letrero', verb: 'Leer', x: WELCOME.x, z: WELCOME.z, radius: 2.4 },
  { id: 'daniel', label: 'Daniel', verb: 'Hablar con', x: DANIEL.x, z: DANIEL.z, radius: 2.6 },
  { id: 'board', label: 'Tablón de proyectos', verb: 'Leer el', x: PLAZA.x, z: PLAZA.z, radius: 2.6 },
  { id: 'garden', label: 'Huerto de habilidades', verb: 'Mirar el', x: GARDEN.x, z: GARDEN.z, radius: 4 },
  { id: 'mailbox', label: 'Buzón', verb: 'Abrir el', x: MAILBOX.x, z: MAILBOX.z, radius: 2.4 },
  { id: 'station', label: 'Estación ESP32', verb: 'Mirar la', x: STATION.x, z: STATION.z, radius: 2.2 },
  { id: 'dock', label: 'muelle', verb: 'Sentarse en el', x: DOCK_END.x, z: DOCK_END.z, radius: 2 },
  ...PROJECT_SIGNS.map((s) => ({
    id: `project:${s.project.id}` as InteractableId,
    label: s.project.title,
    verb: 'Leer',
    x: s.x,
    z: s.z,
    radius: 1.4,
  })),
];

// Where Dui stands when walking to something on his own: one step to the
// side that faces the spawn, so he doesn't end up inside the sign.
export function approachPoint(it: Interactable): Vec3 {
  if (it.id === 'dock') return new Vec3(it.x - 0.6, 0, it.z);
  const side = SPAWN.x >= it.x ? 1 : -1;
  const x = it.x + side * (it.id.startsWith('project:') ? 0.9 : 1.6);
  return new Vec3(x, 0, SURFACE[Math.round(x)]);
}
