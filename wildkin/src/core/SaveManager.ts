import type { SaveData } from '../types';

/**
 * Save / load via localStorage.
 *
 * The WorldScene collects a plain-JSON snapshot of everything dynamic
 * (inventory, creatures + their activity counters, node fill levels, placed
 * decor) and hands it here. We save automatically every ~10 seconds, when the
 * tab is hidden, and just before the page unloads — so refreshing the browser
 * always brings your sanctuary back.
 */

const SAVE_KEY = 'wildkin-save';
/** Bump this if the save format ever changes incompatibly; old saves are then discarded instead of crashing the game. (v4: pass 3 — creatures carry move-cooldown state.) */
const SAVE_VERSION = 4;

/**
 * The onboarding flag lives OUTSIDE the save file on purpose: "Reset & new
 * land" wipes the sanctuary but must never replay the tutorial.
 */
const ONBOARDED_KEY = 'wildkin-onboarded';

export function hasOnboarded(): boolean {
  return localStorage.getItem(ONBOARDED_KEY) === '1';
}

export function setOnboarded(): void {
  localStorage.setItem(ONBOARDED_KEY, '1');
}

export function save(data: Omit<SaveData, 'version'>): void {
  try {
    const payload: SaveData = { version: SAVE_VERSION, ...data };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (err) {
    // localStorage can fail (private browsing, quota). The game keeps running;
    // it just won't persist. Log so it's visible in devtools.
    console.warn('[Wildkin] Could not save:', err);
  }
}

export function load(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION) {
      console.warn('[Wildkin] Save version mismatch — starting fresh.');
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[Wildkin] Could not load save:', err);
    return null;
  }
}

/** Wipe the save (used by the "Reset sanctuary" button in settings). */
export function clear(): void {
  localStorage.removeItem(SAVE_KEY);
}
