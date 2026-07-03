import resonanceConfig from '../config/resonance.json';
import { tileDistance } from '../core/iso';
import type { ResonanceRecipe } from '../types';

/**
 * Resonance — CORE HOOK #1.
 *
 * When a creature works a node with a matching decor item placed nearby, the
 * combo "resonates": production is multiplied and sparkles fly. All combos
 * live in src/config/resonance.json — add rows there to create new ones.
 *
 * This module is pure logic (no rendering): given who is working, where, and
 * what decor exists, it answers "what multiplier applies right now?".
 * The WorldScene handles the particle effects.
 */

const RECIPES = resonanceConfig.recipes as ResonanceRecipe[];

/** Minimal view of a placed decor item, supplied by the WorldScene. */
export interface DecorPlacement {
  type: string;
  tx: number;
  ty: number;
}

export interface ResonanceResult {
  /** Combined production multiplier (1 = no resonance active). */
  multiplier: number;
  /** The recipe that fired (the strongest one, if several match). */
  recipe: ResonanceRecipe | null;
}

/**
 * Check resonance for a creature working at tile (tx,ty) on a node of
 * `nodeType`. `resonanceBonus` comes from the creature's evolution branch
 * (Bloomkin gets +0.5 to any active multiplier).
 */
export function checkResonance(
  speciesId: string,
  nodeType: string,
  tx: number,
  ty: number,
  decor: DecorPlacement[],
  resonanceBonus: number,
): ResonanceResult {
  let best: ResonanceRecipe | null = null;

  for (const recipe of RECIPES) {
    // Recipe must match this creature (or be species-agnostic) and this node.
    if (recipe.species !== 'any' && recipe.species !== speciesId) continue;
    if (recipe.nodeType !== nodeType) continue;
    // ...and a matching decor item must be within range of the worker.
    const near = decor.some(
      (d) => d.type === recipe.decor && tileDistance(d.tx, d.ty, tx, ty) <= recipe.range,
    );
    if (!near) continue;
    if (!best || recipe.multiplier > best.multiplier) best = recipe;
  }

  if (!best) return { multiplier: 1, recipe: null };
  return { multiplier: best.multiplier + resonanceBonus, recipe: best };
}
