import type { InteractableId } from './world';

/*
 * Daniel's notebook: five stamps, one per section of the portfolio.
 *
 * The island used to reward cutting grass (the biggest number on the HUD)
 * and never said what to do next. The notebook gives one goal that maps onto
 * what the site is for: who Daniel is, his work, his skills, how to reach him.
 *
 * The first stamp comes free on arrival: a card that starts with progress gets
 * finished more often than an empty one (Nunes & Drèze, 2006).
 */

export type StampId = 'llegada' | 'daniel' | 'proyectos' | 'huerto' | 'buzon';

export type Stamp = {
  id: StampId;
  icon: string;
  title: string;
  hint: string;
  // Where to walk to earn it (the notebook's "Ir" buttons and Dui's guiding use this).
  target: InteractableId;
};

export const STAMPS: Stamp[] = [
  { id: 'llegada', icon: '👋', title: 'Llegaste a la isla', hint: 'Ya está: bienvenid@.', target: 'welcome' },
  { id: 'daniel', icon: '🧑‍💻', title: 'Conociste a Daniel', hint: 'Habla con Daniel, frente a su casa.', target: 'daniel' },
  { id: 'proyectos', icon: '📌', title: 'Viste sus proyectos', hint: 'Lee el tablón o cualquier letrero de la plaza.', target: 'board' },
  { id: 'huerto', icon: '🌻', title: 'Recorriste el huerto', hint: 'Mira el huerto: cada planta es una habilidad.', target: 'garden' },
  { id: 'buzon', icon: '✉️', title: 'Abriste el buzón', hint: 'Ábrelo para ver cómo escribirle. No hace falta enviar nada.', target: 'mailbox' },
];

/** Which stamp, if any, a visit to this place earns. */
export function stampFor(id: InteractableId): StampId | null {
  if (id === 'daniel') return 'daniel';
  if (id === 'board' || id.startsWith('project:')) return 'proyectos';
  if (id === 'garden') return 'huerto';
  if (id === 'mailbox') return 'buzon';
  if (id === 'welcome') return 'llegada';
  return null;
}

export type Progress = {
  stamps: StampId[];
  // Ids of the projects whose sign has been read (data.ts PROJECTS[].id): their lantern turns green.
  projects: number[];
  // Indices into STAR_SPOTS already collected, so stars don't come back on reload.
  stars: number[];
};

const KEY = 'island-progress-v1';
const EMPTY: Progress = { stamps: [], projects: [], stars: [] };
const STAMP_IDS = new Set<string>(STAMPS.map((s) => s.id));

const ints = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 0))] : [];

/** Reads saved progress, dropping anything malformed instead of failing. */
export function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const v = JSON.parse(raw) as Partial<Record<keyof Progress, unknown>>;
    return {
      stamps: Array.isArray(v.stamps) ? [...new Set(v.stamps.filter((s): s is StampId => typeof s === 'string' && STAMP_IDS.has(s)))] : [],
      projects: ints(v.projects),
      stars: ints(v.stars),
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveProgress(p: Progress) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage full: the notebook still works for this visit.
  }
}

/** The next stamp still missing, in notebook order. */
export function nextStamp(stamps: readonly StampId[]): Stamp | null {
  return STAMPS.find((s) => !stamps.includes(s.id)) ?? null;
}
