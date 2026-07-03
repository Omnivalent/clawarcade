import dailyConfig from '../config/dailyModifier.json';
import formsConfig from '../config/evolutionForms.json';
import type { BranchDef, DailyBoost } from '../types';

/**
 * The rotating daily driver — one branch gets boosted affinity gain today.
 *
 * Deterministic date seed: days-since-epoch modulo the number of branches
 * (alphabetical order), so every player worldwide sees the same "Today's
 * Resonance" and it rotates at midnight UTC. No servers, no state.
 */
export function getDailyBoost(): DailyBoost {
  const branches = formsConfig.branches as Record<string, BranchDef>;
  const ids = Object.keys(branches).sort();
  const dayNumber = Math.floor(Date.now() / 86_400_000);
  const branchId = ids[dayNumber % ids.length];
  const branchName = branches[branchId].name;
  return {
    branchId,
    branchName,
    multiplier: dailyConfig.affinityMultiplier,
    bannerText: dailyConfig.banner.replace('{branch}', branchName),
  };
}
