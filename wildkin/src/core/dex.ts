import formsConfig from '../config/evolutionForms.json';
import type { BranchDef } from '../types';

/**
 * The Form Dex — the player's long-term collection goal (PASS 3).
 *
 * Tracks which of the 12 evolved forms (6 branches × common+rare) have ever
 * been discovered. Generated entirely from evolutionForms.json — add a branch
 * there and the dex grows automatically.
 *
 * Stored under its OWN localStorage key, separate from the sanctuary save:
 * discoveries survive both refreshes AND "Reset — start a new land". The dex
 * is a lifetime achievement list, not sanctuary state.
 */

const DEX_KEY = 'wildkin-dex';

/** One dex record: discovered, whether it's the rare variant, and whether the player has seen it in the dex screen yet (drives the NEW! badge). */
interface DexRecord {
  rare: boolean;
  isNew: boolean;
}

type DexState = Record<string, DexRecord>;

const BRANCHES = formsConfig.branches as Record<string, BranchDef>;

function load(): DexState {
  try {
    return JSON.parse(localStorage.getItem(DEX_KEY) ?? '{}') as DexState;
  } catch {
    return {};
  }
}

function persist(state: DexState): void {
  try {
    localStorage.setItem(DEX_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[Wildkin] Could not save dex:', err);
  }
}

/** Every form that exists, in stable display order (by base, then branch, common before rare). */
export interface DexEntry {
  formId: string;
  formName: string;
  branchId: string;
  branchName: string;
  base: string;
  rare: boolean;
  color: string;
  discovered: boolean;
  isNew: boolean;
}

export function allEntries(): DexEntry[] {
  const state = load();
  const entries: DexEntry[] = [];
  // Group by base creature so the dex reads as three rows of four forms.
  const byBase = Object.entries(BRANCHES).sort(
    (a, b) => a[1].base.localeCompare(b[1].base) || a[0].localeCompare(b[0]),
  );
  for (const [branchId, br] of byBase) {
    for (const [form, rare] of [
      [br.common, false],
      [br.rare, true],
    ] as const) {
      entries.push({
        formId: form.id,
        formName: form.name,
        branchId,
        branchName: br.name,
        base: br.base,
        rare,
        color: br.color,
        discovered: form.id in state,
        isNew: state[form.id]?.isNew ?? false,
      });
    }
  }
  return entries;
}

export function totalForms(): number {
  return Object.keys(BRANCHES).length * 2;
}

export function discoveredCount(): number {
  return Object.keys(load()).length;
}

/** Record a discovery. Returns true if this form was NEW (first time ever). */
export function unlock(formId: string, rare: boolean): boolean {
  const state = load();
  if (formId in state) return false;
  state[formId] = { rare, isNew: true };
  persist(state);
  return true;
}

/** Called when the dex screen closes — clears the NEW! badges. */
export function markAllSeen(): void {
  const state = load();
  for (const rec of Object.values(state)) rec.isNew = false;
  persist(state);
}
