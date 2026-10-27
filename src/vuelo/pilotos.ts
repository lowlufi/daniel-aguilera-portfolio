import type { ModeloAvion, ModeloBase, Piloto } from './fisica-tipos';

/*
 * The squadron's pilots, apart from the planes: who they are, the plane each
 * one flies from home, and how old saves (which only knew the three animal
 * pilots, by their home plane) map onto them.
 */

/** Character-select order: Dui in the middle. */
export const PILOTOS: Piloto[] = ['naxo', 'lulu', 'dui', 'almendrita', 'nelo'];

export const NOMBRE: Record<Piloto, string> = { dui: 'Dui', lulu: 'Lulu', almendrita: 'Almendrita', naxo: 'Naxo', nelo: 'Ñelo' };

/** Each pilot's own plane: always free for them, even before the hangar unlocks it. */
export const CASA: Record<Piloto, ModeloAvion> = { dui: 'caza', lulu: 'avioneta', almendrita: 'bombardero', naxo: 'mustang', nelo: 'stuka' };

/** The two humans of the squadron (the others are two cats and a dog): bodies without tails. */
export const esHumano = (p: Piloto) => p === 'naxo' || p === 'nelo';

const ANTIGUO: Record<ModeloBase, Piloto> = { caza: 'dui', avioneta: 'lulu', bombardero: 'almendrita' };

/** A saved pilot id, new or old style (an old save stored the home plane), or null if unknown. */
export function pilotoGuardado(v: unknown): Piloto | null {
  if (typeof v !== 'string') return null;
  if ((PILOTOS as string[]).includes(v)) return v as Piloto;
  return ANTIGUO[v as ModeloBase] ?? null;
}
