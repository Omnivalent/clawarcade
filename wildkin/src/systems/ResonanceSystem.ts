import recipesConfig from '../config/resonanceRecipes.json';
import { tileDistance } from '../core/iso';
import type { ResonanceRecipe } from '../types';

/**
 * The FUSED resonance-evolution matcher.
 *
 * Resonance is the verb, evolution is the outcome: when a creature works a
 * node with a matching decor within range, ONE recipe fires and delivers
 * both halves of the system —
 *   (a) NOW:   a production multiplier + particles (instant feedback), and
 *   (b) LATER: affinityPerTick toward that decor's branch (steering).
 *
 * All pairings live in src/config/resonanceRecipes.json. This module is pure
 * logic — the WorldScene applies the effects.
 */

const RECIPES = recipesConfig.recipes as ResonanceRecipe[];

/** Minimal view of a placed decor item, supplied by the WorldScene. */
export interface DecorPlacement {
  type: string;
  tx: number;
  ty: number;
}

/**
 * Find the recipe that fires for `baseId` working at (tx,ty), given the decor
 * on the map. If several match (e.g. both a Forge AND a Beacon nearby), the
 * one with the highest productionMultiplier wins — the player resolves the
 * ambiguity by moving decor, which is exactly the game.
 */
export function matchRecipe(
  baseId: string,
  tx: number,
  ty: number,
  decor: DecorPlacement[],
): ResonanceRecipe | null {
  let best: ResonanceRecipe | null = null;
  for (const recipe of RECIPES) {
    if (recipe.creatureBase !== baseId) continue;
    const near = decor.some(
      (d) => d.type === recipe.adjacentDecor && tileDistance(d.tx, d.ty, tx, ty) <= recipe.range,
    );
    if (!near) continue;
    if (!best || recipe.productionMultiplier > best.productionMultiplier) best = recipe;
  }
  return best;
}
