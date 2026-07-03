import Phaser from 'phaser';

/**
 * Share button plumbing: capture the game canvas (including the celebration
 * modal, which is rendered inside the canvas) and hand it to the browser.
 *
 * - On phones with the Web Share API (iOS Safari, Android Chrome): opens the
 *   native share sheet with the image attached.
 * - Everywhere else: downloads the image as a PNG.
 *
 * Real video-clip export is a future pass — a screenshot is the deliverable
 * for now.
 */
export function shareSnapshot(game: Phaser.Game, filename: string): void {
  game.renderer.snapshot((snap) => {
    const image = snap as HTMLImageElement;
    // Draw the snapshot image onto a canvas so we can get a PNG blob out.
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], filename, { type: 'image/png' });

      // Native share sheet where supported (mobile browsers).
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Wildkin' });
          return;
        } catch {
          // User dismissed the sheet or share failed — fall through to download.
        }
      }

      // Fallback: plain download.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  });
}
