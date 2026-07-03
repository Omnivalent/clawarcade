/**
 * Device / UI-mode detection.
 *
 * The game has two UI modes:
 *   - 'desktop': compact HUD, hover effects, mouse-first
 *   - 'phone':   bigger tap targets, collapsible menus, reduced particle counts
 *
 * On load we auto-detect, but the player can force either mode from the ⚙
 * settings panel; that choice is remembered in localStorage.
 */

const UI_MODE_KEY = 'wildkin-ui-mode';

export type UIMode = 'auto' | 'desktop' | 'phone';

/** Best-effort guess: is this a touch device with a smallish screen? */
export function detectPhone(): boolean {
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const small = Math.min(window.innerWidth, window.innerHeight) < 500;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return touch && (small || uaMobile);
}

/** The player's saved preference ('auto' if they never chose). */
export function getUIModeSetting(): UIMode {
  const v = localStorage.getItem(UI_MODE_KEY);
  return v === 'desktop' || v === 'phone' ? v : 'auto';
}

/** Save the player's preference. */
export function setUIModeSetting(mode: UIMode): void {
  localStorage.setItem(UI_MODE_KEY, mode);
}

/** Resolve the preference into the actual mode to use right now. */
export function effectiveUIMode(): 'desktop' | 'phone' {
  const setting = getUIModeSetting();
  if (setting === 'auto') return detectPhone() ? 'phone' : 'desktop';
  return setting;
}

/**
 * Performance caps — mobile browsers get fewer particles so mid-range phones
 * stay smooth. Read these at the moment of emitting effects, never cached, so
 * a mode switch takes effect immediately.
 */
export function perfCaps(): { burstParticles: number; sparkleParticles: number } {
  return effectiveUIMode() === 'phone'
    ? { burstParticles: 16, sparkleParticles: 3 }
    : { burstParticles: 40, sparkleParticles: 6 };
}
