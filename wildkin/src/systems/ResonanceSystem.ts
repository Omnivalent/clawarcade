import recipesConfig from '../config/resonanceRecipes.json';
import { tileDistance } from '../core/iso';
import type { AffinityContribution, InfluenceDef, ResonanceRecipe } from '../types';

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

/** Minimal view of an evolved creature emitting an aura (PASS 3), supplied by the WorldScene. */
export interface AuraSource {
  tx: number;
  ty: number;
  influence: InfluenceDef;
  color: string; // branch color, for particles/UI
}

/**
 * PASS 3 — THE unified influence pipeline. Gathers every affinity source
 * affecting a worker at (tx,ty) in one tick:
 *   - the matched decor recipe (if any), and
 *   - every evolved creature whose aura covers the worker AND channels a
 *     branch this base actually has.
 * Decor and auras are not separate systems: both come out of here as the
 * same AffinityContribution shape, merged per branch, and the WorldScene
 * applies them identically. Returns the matched recipe too (it alone carries
 * the production multiplier).
 */
export function gatherInfluence(
  baseId: string,
  branches: string[],
  tx: number,
  ty: number,
  decor: DecorPlacement[],
  auras: AuraSource[],
): { recipe: ResonanceRecipe | null; contributions: AffinityContribution[] } {
  const contributions: AffinityContribution[] = [];

  const recipe = matchRecipe(baseId, tx, ty, decor);
  if (recipe) {
    contributions.push({
      branchId: recipe.branchId,
      amount: recipe.affinityPerTick,
      color: recipe.particleColor,
      fromAura: false,
    });
  }

  for (const aura of auras) {
    if (!branches.includes(aura.influence.branchId)) continue; // wrong base — a fire aura can't steer a sky spirit
    if (tileDistance(aura.tx, aura.ty, tx, ty) > aura.influence.radius) continue;
    contributions.push({
      branchId: aura.influence.branchId,
      amount: aura.influence.affinityPerTick,
      color: aura.color,
      fromAura: true,
    });
  }

  // Merge multiple sources of the same branch into one contribution (they stack).
  const merged = new Map<string, AffinityContribution>();
  for (const c of contributions) {
    const prev = merged.get(c.branchId);
    if (prev) {
      prev.amount += c.amount;
      // Keep the decor's color when mixing; auras only recolor pure-aura stacks.
      if (!c.fromAura) prev.color = c.color;
      prev.fromAura = prev.fromAura && c.fromAura;
    } else {
      merged.set(c.branchId, { ...c });
    }
  }
  return { recipe, contributions: [...merged.values()] };
}
