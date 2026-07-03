import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { UIScene } from './scenes/UIScene';
import { WorldScene } from './scenes/WorldScene';

/**
 * Wildkin entry point.
 *
 * Sets up the Phaser game with a responsive canvas:
 *  - Scale.FIT + CENTER_BOTH: the 1280x720 logical canvas scales to fill any
 *    screen or orientation without stretching or breaking layouts.
 *  - activePointers: 3 enables multi-touch, which pinch-to-zoom needs.
 *
 * Also handles the "rotate your phone" hint for cramped portrait screens —
 * that lives in plain HTML/CSS (see index.html) so it works even while the
 * game is still booting.
 */

new Phaser.Game({
  type: Phaser.AUTO, // WebGL with automatic Canvas fallback
  parent: 'game-root',
  backgroundColor: '#101c22',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  input: {
    activePointers: 3, // mouse/1st finger + two more fingers = pinch works
  },
  scene: [BootScene, WorldScene, UIScene],
});

// ---------------------------------------------------------------------------
// "Rotate for best experience" hint — shown on small portrait screens only.
// Never blocks anyone: there's a "Continue anyway" button, and once dismissed
// it stays dismissed for the rest of the visit.
// ---------------------------------------------------------------------------
let rotateHintDismissed = false;

function updateRotateHint(): void {
  const hint = document.getElementById('rotate-hint');
  if (!hint) return;
  const portrait = window.innerHeight > window.innerWidth;
  const small = window.innerWidth < 620;
  hint.style.display = portrait && small && !rotateHintDismissed ? 'flex' : 'none';
}

document.getElementById('rotate-dismiss')?.addEventListener('click', () => {
  rotateHintDismissed = true;
  updateRotateHint();
});
window.addEventListener('resize', updateRotateHint);
window.addEventListener('orientationchange', updateRotateHint);
updateRotateHint();
