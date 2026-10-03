import * as THREE from 'three';
import { SPAWN, type InteractableId } from './world';

// Mutable per-frame state shared between the 3D scene and the HUD.
// Lives outside React state so the render loop never triggers re-renders.
export type GameStore = {
  pos: THREE.Vector3;
  facing: number;
  speed: number;
  keys: Set<string>;
  joy: { x: number; z: number };
  cutHeld: boolean;
  target: THREE.Vector3 | null;
  targetId: InteractableId | null;
  frozen: boolean;
  started: boolean;
  nearId: InteractableId | null;
  grassTotal: number;
  // Orbit camera around the player (radians / world units).
  camYaw: number;
  camPitch: number;
  camDist: number;
  dragged: boolean;
  // Garden: grows with each watering, resets on harvest.
  garden: { growth: number; wateredAt: number; harvestedAt: number };
  // Particle bursts requested by the UI (watering, harvest, party) or Dui (hearts).
  burst: (kind: 'water' | 'harvest' | 'party' | 'hearts', x: number, z: number) => void;
  meteo: Meteo | null;
  // Set by <Grass>; returns how many tufts were cut.
  cutAt: (x: number, z: number, r: number) => number;
  // Set by <Stars>; reveals stars hidden under freshly cut grass.
  revealAt: (x: number, z: number, r: number) => void;
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
    camYaw: 0,
    camPitch: 0.5,
    camDist: 13,
    dragged: false,
    garden: { growth: 1, wateredAt: -99, harvestedAt: -99 },
    burst: () => {},
    meteo: null,
    cutAt: () => 0,
    revealAt: () => {},
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
};
