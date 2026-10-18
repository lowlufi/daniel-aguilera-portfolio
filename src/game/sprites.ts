import { T } from './world';

/*
 * Pixel art drawn with code, at 1 unit = 1 virtual pixel (the canvas is
 * upscaled with nearest-neighbour, so every rect here lands on whole pixels).
 *
 * Drawing by hand instead of loading sprite sheets keeps the game at zero
 * assets and makes every animation a couple of numbers: leg phase, tail
 * angle, blink. Colors live in PAL so the whole island shares one palette.
 */

type Ctx = CanvasRenderingContext2D;

export const TILE = 16;

export const PAL = {
  // Dui
  fur: '#f49b3c',
  furDark: '#d47a24',
  furLight: '#ffb95e',
  cream: '#fff1dc',
  ink: '#2a1b12',
  pink: '#f7a1b4',
  eye: '#8fd14f',
  // Daniel
  skin: '#f1c9a5',
  hair: '#4a2d1b',
  beard: '#a9552b',
  beardLight: '#c9733d',
  hoodie: '#2f8f83',
  hoodieDark: '#226b62',
  jeans: '#3c4f78',
  shoe: '#3a2a1e',
  // World
  dirt: '#8a5a34',
  dirtDark: '#75492a',
  dirtLight: '#9c6a3e',
  earthBg: '#2f1f13',
  earthBgLight: '#3a2819',
  grass: '#5fb646',
  grassLight: '#7ccf5a',
  grassDark: '#3e8f36',
  // A warm grey: the cold blue-grey made the underground feel like a parking lot.
  stone: '#776d69',
  stoneDark: '#62595a',
  stoneLight: '#8a807a',
  sand: '#e8d59a',
  sandDark: '#d9c184',
  water: '#3b86b8',
  waterLight: '#5aa6d6',
  waterTop: '#9fd4ee',
  plank: '#b8824b',
  plankDark: '#946437',
  woodWall: '#a0693b',
  woodWallDark: '#8d5a32',
  brick: '#b5604a',
  mortar: '#d9b7a3',
  roof: '#c0503b',
  roofDark: '#9a3f2f',
  roofLight: '#d8705a',
  frame: '#5a3a24',
  glass: '#bfe3f5',
  door: '#6b4324',
  doorDark: '#54351c',
  gold: '#f2cf5b',
  trunk: '#6e4a2e',
  trunkDark: '#56381f',
  trunkLight: '#85603e',
  leaf: '#4fae45',
  leafDark: '#3c8f37',
  leafLight: '#6cc85e',
  blossom: '#f3a6c8',
  blossomDark: '#e889b4',
  blossomLight: '#fbd0e0',
  pine: '#2f7f55',
  pineDark: '#25663f',
  pineLight: '#3f9a68',
  fruit: '#e5484d',
  soil: '#5c3a22',
  soilLight: '#6d4529',
  ore: '#ffd34d',
  oreBlue: '#7ad7ff',
  chimney: '#8d6a5a',
  chimneyDark: '#6f5146',
  metal: '#9aa3ad',
  metalDark: '#6c757d',
  led: '#ff5252',
  ledOn: '#7cff6b',
  red: '#d63a3a',
  redDark: '#a82a2a',
  paper: '#fff8e7',
  tomato: '#e5484d',
  carrot: '#ff8a3c',
  sunflower: '#ffd23f',
  sunflowerCenter: '#6b4f3a',
  cabbage: '#9ed27a',
  cabbageDark: '#6faf55',
};

const R = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
};

/** A rect with the four corner pixels knocked off: pixel-rounded. */
function blob(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  R(ctx, x + 1, y, w - 2, h, c);
  R(ctx, x, y + 1, 1, h - 2, c);
  R(ctx, x + w - 1, y + 1, 1, h - 2, c);
}

/** Cheap stable hash for per-tile texture, so the ground never flickers. */
const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const speck = (ctx: Ctx, px: number, py: number, x: number, y: number, n: number, c: string, salt: number, size = 2) => {
  for (let i = 0; i < n; i++) {
    const h = hash(x, y, salt + i);
    R(ctx, px + (h % (TILE - size + 1)), py + ((h >>> 8) % (TILE - size + 1)), size, size, c);
  }
};

/* ── Tiles ───────────────────────────────────────────────────────────────── */

/**
 * Draws one tile at pixel (px, py). `above` is the tile over it (grass blades
 * poke into it) and `cut` marks tall grass that was cut (a short stubble).
 */
export function drawTile(ctx: Ctx, t: number, px: number, py: number, x: number, y: number, above: number, cut = false) {
  switch (t) {
    case T.DIRT:
      R(ctx, px, py, TILE, TILE, PAL.dirt);
      speck(ctx, px, py, x, y, 3, PAL.dirtDark, 1);
      speck(ctx, px, py, x, y, 2, PAL.dirtLight, 7);
      break;
    case T.GRASS:
      R(ctx, px, py, TILE, TILE, PAL.dirt);
      speck(ctx, px, py, x, y, 3, PAL.dirtDark, 1);
      R(ctx, px, py, TILE, 4, PAL.grass);
      R(ctx, px, py + 4, TILE, 1, PAL.grassDark);
      speck(ctx, px, py, x, y, 2, PAL.grassLight, 3, 1);
      // Blades into the tile above.
      if (above === T.AIR || above === T.TALLGRASS || above === T.FLOWER) {
        for (let i = 0; i < 4; i++) {
          const h = hash(x, y, 20 + i);
          const bx = px + (h % 14) + 1;
          const bh = 1 + (h >>> 4) % 3;
          R(ctx, bx, py - bh, 1, bh, (h >>> 7) & 1 ? PAL.grass : PAL.grassLight);
        }
      }
      break;
    case T.STONE:
      R(ctx, px, py, TILE, TILE, PAL.stone);
      speck(ctx, px, py, x, y, 3, PAL.stoneDark, 2);
      speck(ctx, px, py, x, y, 2, PAL.stoneLight, 9);
      R(ctx, px + (hash(x, y, 4) % 10), py + 6 + (hash(x, y, 5) % 6), 5, 1, PAL.stoneDark);
      break;
    case T.ORE:
      R(ctx, px, py, TILE, TILE, PAL.stone);
      speck(ctx, px, py, x, y, 3, PAL.stoneDark, 2);
      speck(ctx, px, py, x, y, 2, hash(x, y) & 1 ? PAL.ore : PAL.oreBlue, 11, 2);
      speck(ctx, px, py, x, y, 2, '#ffffff', 13, 1);
      break;
    case T.SAND:
      R(ctx, px, py, TILE, TILE, PAL.sand);
      speck(ctx, px, py, x, y, 4, PAL.sandDark, 1, 1);
      break;
    case T.WATER:
      R(ctx, px, py, TILE, TILE, PAL.water);
      R(ctx, px + (hash(x, y) % 8), py + 5 + (hash(x, y, 1) % 8), 6, 1, PAL.waterLight);
      if (above !== T.WATER && above !== T.POST) {
        R(ctx, px, py, TILE, 2, PAL.waterTop);
        R(ctx, px, py + 2, TILE, 1, PAL.waterLight);
      }
      break;
    case T.POST:
      R(ctx, px, py, TILE, TILE, PAL.water);
      R(ctx, px + 6, py, 4, TILE, PAL.plankDark);
      R(ctx, px + 7, py, 1, TILE, PAL.plank);
      break;
    case T.PLANK:
      R(ctx, px, py, TILE, TILE, PAL.water);
      R(ctx, px, py, TILE, 7, PAL.plank);
      R(ctx, px, py + 6, TILE, 1, PAL.plankDark);
      R(ctx, px, py + 3, TILE, 1, PAL.plankDark);
      R(ctx, px + 2, py + 1, 1, 1, PAL.plankDark);
      R(ctx, px + 13, py + 1, 1, 1, PAL.plankDark);
      break;
    case T.WOODWALL:
      R(ctx, px, py, TILE, TILE, PAL.woodWall);
      R(ctx, px, py + 3, TILE, 1, PAL.woodWallDark);
      R(ctx, px, py + 9, TILE, 1, PAL.woodWallDark);
      R(ctx, px + ((x & 1) ? 4 : 11), py + 4, 1, 5, PAL.woodWallDark);
      R(ctx, px + ((x & 1) ? 12 : 5), py + 10, 1, 6, PAL.woodWallDark);
      break;
    case T.BRICKWALL:
      R(ctx, px, py, TILE, TILE, PAL.brick);
      R(ctx, px, py + 3, TILE, 1, PAL.mortar);
      R(ctx, px, py + 7, TILE, 1, PAL.mortar);
      R(ctx, px, py + 11, TILE, 1, PAL.mortar);
      R(ctx, px, py + 15, TILE, 1, PAL.mortar);
      R(ctx, px + 7, py, 1, 3, PAL.mortar);
      R(ctx, px + 3, py + 4, 1, 3, PAL.mortar);
      R(ctx, px + 11, py + 4, 1, 3, PAL.mortar);
      R(ctx, px + 7, py + 8, 1, 3, PAL.mortar);
      R(ctx, px + 3, py + 12, 1, 3, PAL.mortar);
      R(ctx, px + 11, py + 12, 1, 3, PAL.mortar);
      break;
    case T.ROOF:
      R(ctx, px, py, TILE, TILE, PAL.roof);
      for (let row = 0; row < 4; row++) {
        const off = (row & 1) ? 4 : 0;
        R(ctx, px, py + row * 4 + 3, TILE, 1, PAL.roofDark);
        for (let k = -1; k < 3; k++) R(ctx, px + off + k * 8, py + row * 4, 1, 3, PAL.roofDark);
        R(ctx, px + off + 1, py + row * 4, 2, 1, PAL.roofLight);
        R(ctx, px + off + 9, py + row * 4, 2, 1, PAL.roofLight);
      }
      break;
    case T.WINDOW:
      R(ctx, px, py, TILE, TILE, PAL.frame);
      R(ctx, px + 2, py + 2, 12, 12, PAL.glass);
      R(ctx, px + 7, py + 2, 2, 12, PAL.frame);
      R(ctx, px + 2, py + 7, 12, 2, PAL.frame);
      R(ctx, px + 3, py + 3, 2, 2, '#ffffff');
      break;
    case T.DOOR:
      R(ctx, px, py, TILE, TILE, PAL.door);
      R(ctx, px, py, 1, TILE, PAL.doorDark);
      R(ctx, px + 15, py, 1, TILE, PAL.doorDark);
      R(ctx, px + 4, py + 2, 8, 5, PAL.doorDark);
      if (hash(x, y) & 1) R(ctx, px + 12, py + 9, 2, 2, PAL.gold);
      break;
    case T.CHIMNEY:
      R(ctx, px, py, TILE, TILE, PAL.chimney);
      R(ctx, px, py + 5, TILE, 1, PAL.chimneyDark);
      R(ctx, px, py + 11, TILE, 1, PAL.chimneyDark);
      R(ctx, px + 7, py, 1, 5, PAL.chimneyDark);
      R(ctx, px + 3, py + 6, 1, 5, PAL.chimneyDark);
      R(ctx, px + 11, py + 6, 1, 5, PAL.chimneyDark);
      break;
    case T.TRUNK:
      R(ctx, px + 4, py, 8, TILE, PAL.trunk);
      R(ctx, px + 4, py, 2, TILE, PAL.trunkDark);
      R(ctx, px + 9, py, 1, TILE, PAL.trunkLight);
      break;
    case T.LEAVES:
    case T.LEAVES_FRUIT:
      R(ctx, px, py, TILE, TILE, PAL.leaf);
      speck(ctx, px, py, x, y, 3, PAL.leafDark, 1, 3);
      speck(ctx, px, py, x, y, 3, PAL.leafLight, 5, 2);
      if (t === T.LEAVES_FRUIT && hash(x, y, 3) % 3 === 0) R(ctx, px + 4 + (hash(x, y, 6) % 8), py + 4 + (hash(x, y, 8) % 8), 3, 3, PAL.fruit);
      break;
    case T.LEAVES_BLOSSOM:
      R(ctx, px, py, TILE, TILE, PAL.blossom);
      speck(ctx, px, py, x, y, 3, PAL.blossomDark, 1, 3);
      speck(ctx, px, py, x, y, 3, PAL.blossomLight, 5, 2);
      break;
    case T.LEAVES_PINE:
      R(ctx, px, py, TILE, TILE, PAL.pine);
      speck(ctx, px, py, x, y, 3, PAL.pineDark, 1, 3);
      speck(ctx, px, py, x, y, 2, PAL.pineLight, 5, 2);
      break;
    case T.TALLGRASS: {
      const n = cut ? 3 : 4;
      for (let i = 0; i < n; i++) {
        const h = hash(x, y, 30 + i);
        const bx = px + 2 + ((h % 12) | 0);
        const bh = cut ? 2 + (h >>> 5) % 2 : 7 + (h >>> 5) % 6;
        R(ctx, bx, py + TILE - bh, 1, bh, (h >>> 9) & 1 ? PAL.grass : PAL.grassLight);
        if (!cut) R(ctx, bx + ((h >>> 11) & 1 ? 1 : -1), py + TILE - bh + 1, 1, 1, PAL.grassLight);
      }
      break;
    }
    case T.FLOWER: {
      const h = hash(x, y, 40);
      const bx = px + 5 + (h % 6);
      const col = ['#ff8fb1', '#ffd23f', '#ffffff', '#b28ee0'][h % 4];
      R(ctx, bx, py + 9, 1, 7, PAL.grass);
      R(ctx, bx - 1, py + 7, 3, 3, col);
      R(ctx, bx, py + 6, 1, 1, col);
      R(ctx, bx, py + 10, 1, 1, col);
      R(ctx, bx - 2, py + 8, 1, 1, col);
      R(ctx, bx + 2, py + 8, 1, 1, col);
      R(ctx, bx, py + 8, 1, 1, PAL.sunflowerCenter);
      break;
    }
    case T.FENCE:
      R(ctx, px, py + 5, TILE, 2, PAL.plank);
      R(ctx, px, py + 11, TILE, 2, PAL.plank);
      R(ctx, px + 7, py + 2, 2, 14, PAL.plankDark);
      break;
    case T.SOIL:
      R(ctx, px, py, TILE, TILE, PAL.soil);
      R(ctx, px, py + 4, TILE, 1, PAL.soilLight);
      R(ctx, px, py + 10, TILE, 1, PAL.soilLight);
      speck(ctx, px, py, x, y, 2, PAL.dirtDark, 2, 1);
      break;
  }
}

/** Dark earth behind caves and dug-out blocks. */
export function drawEarthBg(ctx: Ctx, px: number, py: number, x: number, y: number) {
  R(ctx, px, py, TILE, TILE, PAL.earthBg);
  speck(ctx, px, py, x, y, 2, PAL.earthBgLight, 17);
}

/* ── Dui ─────────────────────────────────────────────────────────────────── */

export type DuiPose = {
  facing: 1 | -1;
  /** Walk cycle, radians. */
  phase: number;
  /** 0 standing, 1 walking at full speed. */
  amt: number;
  /** Vertical speed when airborne (0 on the ground). */
  air: number;
  sit: boolean;
  sleep: boolean;
  blink: boolean;
  /** 0..1 how far the paw is out. */
  swing: number;
  /** Tail angle, radians. */
  tail: number;
  /** 0..1 squash from being petted. */
  squish: number;
  /** 0..1 swimming: body floats, legs paddle. */
  swim: number;
};

/** Dui, feet centered at (x, y). About 26 px long and 17 px tall. */
export function drawDui(ctx: Ctx, x: number, y: number, p: DuiPose) {
  ctx.save();
  ctx.translate(x | 0, y | 0);
  if (p.facing < 0) ctx.scale(-1, 1);

  const bob = p.sleep || p.sit ? 0 : Math.round(Math.abs(Math.sin(p.phase)) * p.amt);
  const sq = Math.round(p.squish * 2);

  // Shadow
  ctx.globalAlpha = 0.22;
  R(ctx, -12, 0, 22, 1, PAL.ink);
  ctx.globalAlpha = 1;

  if (p.sleep) {
    // Curled up: a flat loaf with the head resting on the paws.
    blob(ctx, -14, -9, 24, 9, PAL.fur);
    R(ctx, -10, -3, 14, 3, PAL.cream);
    R(ctx, -9, -9, 1, 3, PAL.furDark);
    R(ctx, -4, -9, 1, 3, PAL.furDark);
    R(ctx, 1, -9, 1, 3, PAL.furDark);
    blob(ctx, 2, -12, 12, 10, PAL.fur);
    R(ctx, 4, -14, 2, 2, PAL.fur);
    R(ctx, 10, -14, 2, 2, PAL.fur);
    R(ctx, 5, -13, 1, 1, PAL.pink);
    R(ctx, 11, -13, 1, 1, PAL.pink);
    R(ctx, 6, -8, 2, 1, PAL.ink);
    R(ctx, 10, -8, 2, 1, PAL.ink);
    R(ctx, 9, -6, 4, 3, PAL.cream);
    R(ctx, 13, -6, 1, 1, PAL.pink);
    // Tail wrapped around the front.
    R(ctx, -8, -1, 20, 1, PAL.furDark);
    R(ctx, 11, -2, 2, 2, PAL.cream);
    ctx.restore();
    return;
  }

  // Tail: three segments rising from the back, the tip swaying.
  const tw = Math.round(Math.sin(p.tail) * 2);
  if (p.sit) {
    R(ctx, -8, -1, 16, 1, PAL.furDark);
    R(ctx, 7, -2, 2, 2, PAL.cream);
  } else {
    R(ctx, -14, -9 - bob, 2, 2, PAL.fur);
    R(ctx, -16, -11 - bob + Math.round(tw / 2), 2, 3, PAL.fur);
    R(ctx, -18, -14 - bob + tw, 2, 3, PAL.furDark);
    R(ctx, -18, -15 - bob + tw, 2, 1, PAL.cream);
  }

  // Legs: front pair and back pair swing against each other.
  const step = Math.round(Math.sin(p.phase) * 2 * p.amt);
  const legH = 3;
  const tuck = p.air !== 0 ? 1 : 0;
  if (p.sit) {
    R(ctx, 0, -3, 2, 3, PAL.fur);
    R(ctx, 3, -3, 2, 3, PAL.fur);
    R(ctx, 0, 0, 2, 1, PAL.cream);
    R(ctx, 3, 0, 2, 1, PAL.cream);
    R(ctx, -9, -4, 7, 4, PAL.furDark);
    R(ctx, -9, -1, 3, 1, PAL.cream);
  } else if (p.swim > 0) {
    R(ctx, -9, -4, 2, 2, PAL.furDark);
    R(ctx, 2 + step, -4, 2, 2, PAL.fur);
  } else {
    R(ctx, -10 - step, -legH - bob + tuck, 2, legH + bob - tuck, PAL.furDark);
    R(ctx, -7 + step, -legH - bob, 2, legH + bob, PAL.furDark);
    R(ctx, 0 + step, -legH - bob + tuck, 2, legH + bob - tuck, PAL.fur);
    R(ctx, 3 - step, -legH - bob, 2, legH + bob, PAL.fur);
    R(ctx, -10 - step, 0, 2, 1, PAL.cream);
    R(ctx, -7 + step, 0, 2, 1, PAL.cream);
    R(ctx, 0 + step, 0, 2, 1, PAL.cream);
    R(ctx, 3 - step, 0, 2, 1, PAL.cream);
  }

  // Body: a round loaf; sitting makes it tall, petting squashes it.
  const by = (p.sit ? -16 : -12) - bob + sq;
  const bh = (p.sit ? 13 : 9) - sq;
  const bx = p.sit ? -10 : -13;
  const bw = p.sit ? 16 : 19 + sq;
  blob(ctx, bx, by, bw, bh, PAL.fur);
  R(ctx, bx + 2, by + bh - 3, bw - 4, 3, PAL.cream);
  R(ctx, bx + 1, by + 1, bw - 2, 1, PAL.furLight);
  for (let i = 0; i < 3; i++) R(ctx, bx + 3 + i * 4, by + 1, 1, 3, PAL.furDark);
  if (p.swim > 0) {
    R(ctx, bx - 2, by + bh - 1, bw + 4, 1, PAL.waterTop);
  }

  // Head
  const hx = p.sit ? 1 : 3;
  const hy = (p.sit ? -24 : -17) - bob + sq;
  blob(ctx, hx, hy, 12, 10, PAL.fur);
  R(ctx, hx + 1, hy + 1, 10, 1, PAL.furLight);
  // Ears
  R(ctx, hx + 1, hy - 2, 2, 2, PAL.fur);
  R(ctx, hx + 2, hy - 3, 1, 1, PAL.fur);
  R(ctx, hx + 8, hy - 2, 2, 2, PAL.fur);
  R(ctx, hx + 8, hy - 3, 1, 1, PAL.fur);
  R(ctx, hx + 2, hy - 1, 1, 1, PAL.pink);
  R(ctx, hx + 8, hy - 1, 1, 1, PAL.pink);
  // "M" on the forehead, like a real tabby.
  R(ctx, hx + 3, hy + 1, 1, 2, PAL.furDark);
  R(ctx, hx + 5, hy + 1, 1, 2, PAL.furDark);
  R(ctx, hx + 7, hy + 1, 1, 2, PAL.furDark);
  // Eyes
  if (p.blink) {
    R(ctx, hx + 3, hy + 5, 2, 1, PAL.ink);
    R(ctx, hx + 8, hy + 5, 2, 1, PAL.ink);
  } else {
    R(ctx, hx + 3, hy + 4, 2, 2, PAL.eye);
    R(ctx, hx + 8, hy + 4, 2, 2, PAL.eye);
    R(ctx, hx + 4, hy + 5, 1, 1, PAL.ink);
    R(ctx, hx + 9, hy + 5, 1, 1, PAL.ink);
  }
  // Muzzle, nose, mouth, whiskers
  R(ctx, hx + 7, hy + 7, 5, 3, PAL.cream);
  R(ctx, hx + 11, hy + 7, 1, 1, PAL.pink);
  R(ctx, hx + 9, hy + 9, 1, 1, PAL.ink);
  R(ctx, hx + 12, hy + 6, 2, 1, PAL.cream);
  R(ctx, hx + 12, hy + 8, 2, 1, PAL.cream);
  R(ctx, hx - 1, hy + 6, 1, 1, PAL.cream);

  // The paw out: front leg stretched forward with three scratch marks.
  if (p.swing > 0.01) {
    const reach = Math.round(p.swing * 8);
    R(ctx, 4, -9 - bob, 4 + reach, 2, PAL.fur);
    R(ctx, 8 + reach, -9 - bob, 2, 2, PAL.cream);
    ctx.globalAlpha = p.swing;
    R(ctx, 11 + reach, -12 - bob, 1, 2, '#ffffff');
    R(ctx, 12 + reach, -10 - bob, 2, 1, '#ffffff');
    R(ctx, 11 + reach, -7 - bob, 1, 2, '#ffffff');
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ── Daniel ──────────────────────────────────────────────────────────────── */

export type DanielPose = { facing: 1 | -1; t: number; wave: boolean; blink: boolean };

/** Daniel, feet centered at (x, y). 12 px wide, 27 px tall. */
export function drawDaniel(ctx: Ctx, x: number, y: number, p: DanielPose) {
  ctx.save();
  ctx.translate(x | 0, y | 0);
  if (p.facing < 0) ctx.scale(-1, 1);
  const bob = Math.round(Math.sin(p.t * 1.6) * 0.6);
  ctx.globalAlpha = 0.22;
  R(ctx, -6, 0, 12, 1, PAL.ink);
  ctx.globalAlpha = 1;
  // Shoes and jeans
  R(ctx, -4, -2, 4, 2, PAL.shoe);
  R(ctx, 1, -2, 4, 2, PAL.shoe);
  R(ctx, -3, -10, 3, 8, PAL.jeans);
  R(ctx, 1, -10, 3, 8, PAL.jeans);
  // Hoodie
  R(ctx, -4, -19 + bob, 8, 9, PAL.hoodie);
  R(ctx, -4, -12 + bob, 8, 2, PAL.hoodieDark);
  R(ctx, -1, -18 + bob, 2, 4, PAL.hoodieDark);
  // Arms
  R(ctx, -6, -18 + bob, 2, 7, PAL.hoodie);
  R(ctx, -6, -11 + bob, 2, 2, PAL.skin);
  if (p.wave) {
    const up = Math.round(Math.sin(p.t * 9) * 1.5);
    R(ctx, 4, -24 + bob + up, 2, 7, PAL.hoodie);
    R(ctx, 4, -26 + bob + up, 2, 2, PAL.skin);
  } else {
    R(ctx, 4, -18 + bob, 2, 7, PAL.hoodie);
    R(ctx, 4, -11 + bob, 2, 2, PAL.skin);
  }
  // Head, hair, beard (copper over brown)
  R(ctx, -3, -26 + bob, 7, 8, PAL.skin);
  R(ctx, -4, -28 + bob, 8, 3, PAL.hair);
  R(ctx, -4, -25 + bob, 1, 3, PAL.hair);
  R(ctx, -3, -20 + bob, 7, 2, PAL.beard);
  R(ctx, -2, -18 + bob, 5, 1, PAL.beard);
  R(ctx, 3, -21 + bob, 1, 2, PAL.beard);
  R(ctx, -1, -20 + bob, 2, 1, PAL.beardLight);
  R(ctx, 1, -22 + bob, 3, 1, PAL.beardLight);
  // Eyes
  if (!p.blink) {
    R(ctx, 0, -24 + bob, 1, 1, PAL.ink);
    R(ctx, 2, -24 + bob, 1, 1, PAL.ink);
  } else {
    R(ctx, 0, -24 + bob, 3, 1, PAL.hair);
  }
  ctx.restore();
}

/* ── Things ──────────────────────────────────────────────────────────────── */

export function drawSign(ctx: Ctx, x: number, y: number, color: string, read: boolean) {
  R(ctx, x - 1, y - 9, 2, 9, PAL.plankDark);
  R(ctx, x - 6, y - 17, 12, 8, PAL.frame);
  R(ctx, x - 5, y - 16, 10, 6, color);
  R(ctx, x - 4, y - 15, 8, 1, 'rgba(255,255,255,0.45)');
  if (read) {
    R(ctx, x + 1, y - 13, 1, 1, '#1e7a3a');
    R(ctx, x + 2, y - 12, 1, 1, '#1e7a3a');
    R(ctx, x + 3, y - 13, 1, 1, '#1e7a3a');
    R(ctx, x + 4, y - 14, 1, 1, '#1e7a3a');
  }
}

export function drawBoard(ctx: Ctx, x: number, y: number, t: number) {
  R(ctx, x - 9, y - 14, 2, 14, PAL.plankDark);
  R(ctx, x + 7, y - 14, 2, 14, PAL.plankDark);
  R(ctx, x - 12, y - 26, 24, 13, PAL.frame);
  R(ctx, x - 11, y - 25, 22, 11, PAL.plank);
  const papers = ['#fff8e7', '#ffe3a3', '#bfe3f5', '#f3a6c8', '#9fd67a'];
  for (let i = 0; i < 5; i++) {
    const px = x - 10 + i * 4 + (i % 2);
    const py = y - 24 + (i % 2) * 5 + ((i * 7) % 2);
    R(ctx, px, py, 3, 4, papers[i]);
    R(ctx, px + 1, py, 1, 1, PAL.red);
  }
  // A paper flaps now and then.
  if (Math.sin(t * 3) > 0.8) R(ctx, x + 6, y - 19, 1, 3, '#fff8e7');
}

export function drawWelcomeSign(ctx: Ctx, x: number, y: number) {
  R(ctx, x - 1, y - 10, 2, 10, PAL.plankDark);
  R(ctx, x - 8, y - 18, 16, 9, PAL.frame);
  R(ctx, x - 7, y - 17, 14, 7, PAL.plank);
  // A tiny heart.
  R(ctx, x - 3, y - 15, 2, 2, PAL.red);
  R(ctx, x + 1, y - 15, 2, 2, PAL.red);
  R(ctx, x - 2, y - 13, 4, 1, PAL.red);
  R(ctx, x - 1, y - 12, 2, 1, PAL.red);
}

export function drawMailbox(ctx: Ctx, x: number, y: number) {
  R(ctx, x - 1, y - 12, 2, 12, PAL.plankDark);
  blob(ctx, x - 5, y - 19, 11, 8, PAL.red);
  R(ctx, x - 4, y - 18, 9, 1, '#ef6b6b');
  R(ctx, x - 5, y - 13, 11, 1, PAL.redDark);
  R(ctx, x + 4, y - 17, 1, 3, PAL.ink);
  R(ctx, x + 5, y - 21, 1, 5, PAL.gold);
  R(ctx, x + 5, y - 22, 3, 2, PAL.gold);
}

export function drawStation(ctx: Ctx, x: number, y: number, t: number, online: boolean) {
  R(ctx, x - 1, y - 16, 2, 16, PAL.metalDark);
  R(ctx, x - 4, y - 24, 8, 8, '#3a3f47');
  R(ctx, x - 3, y - 23, 6, 1, PAL.metal);
  const on = Math.floor(t * 2) % 2 === 0;
  R(ctx, x + 1, y - 20, 2, 2, on ? (online ? PAL.ledOn : PAL.led) : '#2a2f36');
  R(ctx, x - 3, y - 20, 3, 1, PAL.metal);
  R(ctx, x - 3, y - 18, 3, 1, PAL.metal);
  R(ctx, x + 3, y - 31, 1, 7, PAL.metal);
  R(ctx, x + 2, y - 32, 3, 1, PAL.metal);
  // Solar panel
  R(ctx, x - 9, y - 28, 8, 4, '#2d5fa3');
  R(ctx, x - 8, y - 27, 6, 1, '#5b8fd8');
  R(ctx, x - 5, y - 24, 1, 2, PAL.metalDark);
}

export function drawGear(ctx: Ctx, x: number, y: number, angle: number) {
  ctx.fillStyle = PAL.metal;
  for (let i = 0; i < 8; i++) {
    const a = angle + (i * Math.PI) / 4;
    R(ctx, x + Math.round(Math.cos(a) * 6) - 1, y + Math.round(Math.sin(a) * 6) - 1, 3, 3, PAL.metalDark);
  }
  blob(ctx, x - 4, y - 4, 9, 9, PAL.metal);
  R(ctx, x - 1, y - 1, 3, 3, PAL.metalDark);
}

export function drawPlant(ctx: Ctx, x: number, y: number, kind: 'sunflower' | 'carrot' | 'tomato' | 'cabbage', growth: number, t: number) {
  // growth goes 1 (just planted) to 1.45 (ready to harvest).
  const g = Math.max(0, Math.min(1, (growth - 1) / 0.45));
  const sway = Math.round(Math.sin(t * 1.3 + x) * g);
  if (kind === 'sunflower') {
    const h = 4 + Math.round(g * 14);
    R(ctx, x, y - h, 1, h, PAL.grass);
    R(ctx, x - 2, y - Math.round(h / 2), 2, 1, PAL.grass);
    R(ctx, x + 1, y - Math.round(h * 0.7), 2, 1, PAL.grass);
    if (g > 0.3) {
      const r = g > 0.8 ? 3 : 2;
      blob(ctx, x + sway - r, y - h - r, r * 2 + 1, r * 2 + 1, PAL.sunflower);
      R(ctx, x + sway - 1, y - h - 1, 3, 3, PAL.sunflowerCenter);
    }
  } else if (kind === 'tomato') {
    const h = 3 + Math.round(g * 9);
    R(ctx, x - 3, y - h, 7, h, PAL.leafDark);
    R(ctx, x - 2, y - h, 5, 1, PAL.leaf);
    R(ctx, x - 1, y - h + 2, 1, h - 3, PAL.leafLight);
    if (g > 0.6) {
      R(ctx, x - 2, y - h + 3, 2, 2, PAL.tomato);
      R(ctx, x + 1, y - h + 5, 2, 2, PAL.tomato);
    }
    if (g > 0.9) R(ctx, x + 2, y - h + 1, 2, 2, PAL.tomato);
  } else if (kind === 'carrot') {
    const h = 2 + Math.round(g * 8);
    R(ctx, x - 2, y - h, 1, h, PAL.leaf);
    R(ctx, x, y - h - 1, 1, h + 1, PAL.leafLight);
    R(ctx, x + 2, y - h, 1, h, PAL.leaf);
    R(ctx, x - 1, y - Math.round(h / 2), 3, 1, PAL.leaf);
    if (g > 0.7) R(ctx, x - 1, y - 1, 3, 2, PAL.carrot);
  } else {
    const r = 1 + Math.round(g * 4);
    blob(ctx, x - r, y - r * 2, r * 2 + 1, r * 2, PAL.cabbage);
    R(ctx, x - r + 1, y - r * 2 + 1, r, 1, '#c7ee9f');
    R(ctx, x - r, y - r, r * 2 + 1, 1, PAL.cabbageDark);
  }
}

/** A small pixel heart, for Dui's "hearts" burst. */
export function drawHeart(ctx: Ctx, x: number, y: number, c: string) {
  R(ctx, x - 1, y - 1, 1, 1, c);
  R(ctx, x + 1, y - 1, 1, 1, c);
  R(ctx, x - 1, y, 3, 1, c);
  R(ctx, x, y + 1, 1, 1, c);
}

export function drawStar(ctx: Ctx, x: number, y: number, size: number, c: string) {
  R(ctx, x, y - size, 1, size * 2 + 1, c);
  R(ctx, x - size, y, size * 2 + 1, 1, c);
  if (size > 1) {
    R(ctx, x - 1, y - 1, 3, 3, c);
    R(ctx, x, y, 1, 1, '#ffffff');
  }
}
