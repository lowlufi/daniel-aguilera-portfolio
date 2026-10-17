import { SPAWN, Vec3, type InteractableId } from './world';

// Mutable per-frame state shared between the island scene and the HUD.
// Lives outside React state so the render loop never triggers re-renders.
export type GameStore = {
  // x in tiles; z is the vertical position (feet), also in tiles. See world.ts.
  pos: Vec3;
  facing: number;
  speed: number;
  keys: Set<string>;
  joy: { x: number; z: number };
  cutHeld: boolean;
  target: Vec3 | null;
  targetId: InteractableId | null;
  frozen: boolean;
  started: boolean;
  nearId: InteractableId | null;
  grassTotal: number;
  // Garden: grows with each watering, resets on harvest.
  garden: { growth: number; wateredAt: number; harvestedAt: number };
  // Particle bursts requested by the UI (watering, harvest, party) or Dui (hearts).
  burst: (kind: 'water' | 'harvest' | 'party' | 'hearts', x: number, z: number) => void;
  meteo: Meteo | null;
  // Set by the scene; returns how many tufts were cut (or blocks dug).
  cutAt: (x: number, z: number, r: number) => number;
  // Set by the scene; reveals stars hidden under freshly cut grass or dug dirt.
  revealAt: (x: number, z: number, r: number) => void;
  // Notebook progress the scene draws: read project signs light up green,
  // collected stars stay gone after a reload.
  seenProjects: Set<number>;
  starsTaken: Set<number>;
  // The next missing notebook stamp: its name tag is highlighted on the map.
  goalId: InteractableId | null;
  // Seconds left of the current paw swipe (Dui's paw is out while it's > 0).
  swing: number;
};

export function createStore(): GameStore {
  return {
    pos: SPAWN.clone(),
    facing: 0,
    speed: 0,
    keys: new Set(),
    joy: { x: 0, z: 0 },
    cutHeld: false,
    target: null,
    targetId: null,
    frozen: true,
    started: false,
    nearId: null,
    grassTotal: 1,
    garden: { growth: 1, wateredAt: -99, harvestedAt: -99 },
    burst: () => {},
    meteo: null,
    cutAt: () => 0,
    revealAt: () => {},
    seenProjects: new Set(),
    starsTaken: new Set(),
    goalId: null,
    swing: 0,
  };
}

export type Meteo = { temp: number; hum: number; wind: number; code: number; isDay: boolean; sunset: number };

export type GameEvents = {
  onNear: (id: InteractableId | null) => void;
  onArrive: (id: InteractableId) => void;
  onCut: (count: number) => void;
  onStar: (index: number) => void;
  onStarRevealed: () => void;
  // Dui was petted.
  onPet: () => void;
  // The player has stood still for a while: time for a hint.
  onIdleHint: () => void;
};
