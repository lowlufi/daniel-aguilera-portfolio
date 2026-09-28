import * as THREE from 'three';
import { PROJECTS } from '../data';

// Island layout. Units are roughly meters; the player is ~1.5 tall.
export const ISLAND_R = 26;
export const WALK_R = 24.6;
export const PLAYER_R = 0.4;
export const SPAWN = new THREE.Vector3(0, 0, 7);

export const SUN_DIR = new THREE.Vector3(-0.42, 0.13, -1).normalize();

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

export const HOUSE = { x: 11, z: -8 };
export const WORKSHOP = { x: -4, z: -22 };
export const PLAZA = { x: -4, z: -13 };
export const GARDEN = { x: -13, z: 0 };
export const MAILBOX = { x: 8, z: 10 };
export const WELCOME = { x: -2.6, z: 4.4 };
export const DANIEL = { x: 9, z: -3.6 };

export const PROJECT_COLORS = ['#f0a45d', '#7cc6e8', '#9fd67a', '#e37b8b', '#b28ee0', '#f2cf5b', '#6fd1c1', '#c9a27a'];

export const PROJECT_SIGNS = PROJECTS.map((p, i) => {
  // Fan the signs out in a half-ring in front of the workshop, facing the plaza.
  const a = Math.PI * (0.08 + (0.84 * i) / (PROJECTS.length - 1));
  const r = 6.2;
  const x = PLAZA.x + Math.cos(a) * r;
  const z = PLAZA.z - Math.sin(a) * r * 0.75;
  return { project: p, x, z, color: PROJECT_COLORS[i % PROJECT_COLORS.length], rot: Math.atan2(PLAZA.x - x, PLAZA.z - z) };
});

export type GardenPlot = { x: number; z: number; kind: 'sunflower' | 'carrot' | 'tomato' | 'cabbage' };
export const GARDEN_PLOTS: GardenPlot[] = [
  { x: GARDEN.x - 1.6, z: GARDEN.z - 1.6, kind: 'sunflower' },
  { x: GARDEN.x + 1.6, z: GARDEN.z - 1.6, kind: 'tomato' },
  { x: GARDEN.x - 1.6, z: GARDEN.z + 1.6, kind: 'carrot' },
  { x: GARDEN.x + 1.6, z: GARDEN.z + 1.6, kind: 'cabbage' },
];

export type InteractableId = 'welcome' | 'daniel' | 'board' | 'garden' | 'mailbox' | `project:${number}`;

export type Interactable = {
  id: InteractableId;
  label: string;
  verb: string;
  x: number;
  z: number;
  radius: number;
};

export const INTERACTABLES: Interactable[] = [
  { id: 'welcome', label: 'Letrero', verb: 'Leer', x: WELCOME.x, z: WELCOME.z, radius: 2.2 },
  { id: 'daniel', label: 'Daniel', verb: 'Hablar con', x: DANIEL.x, z: DANIEL.z, radius: 2.4 },
  { id: 'board', label: 'Tablón de proyectos', verb: 'Leer el', x: PLAZA.x, z: PLAZA.z, radius: 2.4 },
  { id: 'garden', label: 'Huerto de habilidades', verb: 'Mirar el', x: GARDEN.x, z: GARDEN.z + 3.6, radius: 2.6 },
  { id: 'mailbox', label: 'Buzón', verb: 'Abrir el', x: MAILBOX.x, z: MAILBOX.z, radius: 2.2 },
  ...PROJECT_SIGNS.map((s) => ({
    id: `project:${s.project.id}` as InteractableId,
    label: s.project.title,
    verb: 'Leer',
    x: s.x,
    z: s.z,
    radius: 1.7,
  })),
];

// Where the player stands when auto-walking to something.
export function approachPoint(it: Interactable): THREE.Vector3 {
  if (it.id === 'garden') return new THREE.Vector3(it.x, 0, it.z + 0.6);
  const toSpawn = new THREE.Vector2(SPAWN.x - it.x, SPAWN.z - it.z).normalize();
  if (it.id.startsWith('project:')) {
    const toPlaza = new THREE.Vector2(PLAZA.x - it.x, PLAZA.z - it.z).normalize();
    return new THREE.Vector3(it.x + toPlaza.x * 1.2, 0, it.z + toPlaza.y * 1.2);
  }
  return new THREE.Vector3(it.x + toSpawn.x * 1.4, 0, it.z + toSpawn.y * 1.4);
}

export type Collider = { x: number; z: number; r: number };

const STRUCTURE_COLLIDERS: Collider[] = [
  { x: HOUSE.x, z: HOUSE.z, r: 2.6 },
  { x: HOUSE.x + 1.2, z: HOUSE.z - 1, r: 2.2 },
  { x: HOUSE.x - 1.2, z: HOUSE.z - 1, r: 2.2 },
  { x: WORKSHOP.x, z: WORKSHOP.z, r: 2.6 },
  { x: WORKSHOP.x + 1.2, z: WORKSHOP.z - 0.6, r: 2.2 },
  { x: WORKSHOP.x - 1.2, z: WORKSHOP.z - 0.6, r: 2.2 },
  { x: PLAZA.x, z: PLAZA.z, r: 0.9 },
  { x: MAILBOX.x, z: MAILBOX.z, r: 0.45 },
  { x: WELCOME.x, z: WELCOME.z, r: 0.5 },
  { x: DANIEL.x, z: DANIEL.z, r: 0.45 },
  ...GARDEN_PLOTS.map((p) => ({ x: p.x, z: p.z, r: 1.15 })),
  ...PROJECT_SIGNS.map((s) => ({ x: s.x, z: s.z, r: 0.45 })),
];

const KEEP_CLEAR: Collider[] = [
  { x: SPAWN.x, z: SPAWN.z, r: 3 },
  { x: HOUSE.x, z: HOUSE.z, r: 5.5 },
  { x: WORKSHOP.x, z: WORKSHOP.z, r: 5 },
  { x: PLAZA.x, z: PLAZA.z, r: 7.5 },
  { x: GARDEN.x, z: GARDEN.z, r: 5 },
  { x: MAILBOX.x, z: MAILBOX.z, r: 2 },
  { x: WELCOME.x, z: WELCOME.z, r: 1.8 },
  { x: DANIEL.x, z: DANIEL.z, r: 2 },
];

// Dirt path from the spawn to every landmark.
const PATH_ENDS = [
  { x: HOUSE.x - 0.2, z: HOUSE.z + 2.8 },
  { x: PLAZA.x, z: PLAZA.z + 2 },
  { x: GARDEN.x + 2.8, z: GARDEN.z + 1 },
  { x: MAILBOX.x - 0.6, z: MAILBOX.z - 0.6 },
];

export const PATH_STONES: { x: number; z: number; r: number; rot: number }[] = (() => {
  const rnd = mulberry32(7);
  const out: { x: number; z: number; r: number; rot: number }[] = [];
  for (const end of PATH_ENDS) {
    const dx = end.x - SPAWN.x;
    const dz = end.z - SPAWN.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.floor(len / 1.25);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const bend = Math.sin(t * Math.PI) * 0.9;
      const nx = -dz / len;
      const nz = dx / len;
      out.push({
        x: SPAWN.x + dx * t + nx * bend + (rnd() - 0.5) * 0.25,
        z: SPAWN.z + dz * t + nz * bend + (rnd() - 0.5) * 0.25,
        r: 0.42 + rnd() * 0.14,
        rot: rnd() * Math.PI,
      });
    }
  }
  return out;
})();

function clearOf(x: number, z: number, list: Collider[], pad: number) {
  for (const c of list) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + pad) ** 2) return false;
  return true;
}

export type Tree = { x: number; z: number; scale: number; kind: 'round' | 'blossom' | 'pine'; fruit: boolean };

export const TREES: Tree[] = (() => {
  const rnd = mulberry32(42);
  const out: Tree[] = [];
  let guard = 0;
  while (out.length < 26 && guard++ < 4000) {
    const a = rnd() * Math.PI * 2;
    const r = 7 + Math.sqrt(rnd()) * 16.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!clearOf(x, z, KEEP_CLEAR, 1.6)) continue;
    if (!clearOf(x, z, PATH_STONES.map((s) => ({ ...s, r: 0.4 })), 1.6)) continue;
    if (!clearOf(x, z, out.map((t) => ({ x: t.x, z: t.z, r: 1.4 })), 1.4)) continue;
    // Keep the camera's line of sight to the spawn free of trunks.
    if (z > 8 && Math.abs(x) < 7) continue;
    const k = rnd();
    out.push({ x, z, scale: 0.85 + rnd() * 0.45, kind: k < 0.3 ? 'blossom' : k < 0.55 ? 'pine' : 'round', fruit: rnd() < 0.35 });
  }
  return out;
})();

export const COLLIDERS: Collider[] = [...STRUCTURE_COLLIDERS, ...TREES.map((t) => ({ x: t.x, z: t.z, r: 0.45 * t.scale }))];

export function blocksGrass(x: number, z: number) {
  if (x * x + z * z > (ISLAND_R - 0.8) ** 2) return true;
  if (!clearOf(x, z, STRUCTURE_COLLIDERS, 0.25)) return true;
  if (!clearOf(x, z, PATH_STONES, 0.2)) return true;
  if (!clearOf(x, z, TREES.map((t) => ({ x: t.x, z: t.z, r: 0.35 })), 0.2)) return true;
  if ((x - SPAWN.x) ** 2 + (z - SPAWN.z) ** 2 < 1.2) return true;
  if ((x - PLAZA.x) ** 2 + (z - PLAZA.z) ** 2 < 3.5 ** 2) return true;
  return false;
}

export function resolveCollisions(p: THREE.Vector3) {
  for (const c of COLLIDERS) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const min = c.r + PLAYER_R;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }
  }
  const r = Math.hypot(p.x, p.z);
  if (r > WALK_R) {
    p.x *= WALK_R / r;
    p.z *= WALK_R / r;
  }
}

export const STAR_COUNT = 12;
