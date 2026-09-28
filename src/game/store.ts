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
    cutAt: () => 0,
    revealAt: () => {},
  };
}

export type GameEvents = {
  onNear: (id: InteractableId | null) => void;
  onArrive: (id: InteractableId) => void;
  onCut: (count: number) => void;
  onStar: (index: number) => void;
  onStarRevealed: () => void;
};
