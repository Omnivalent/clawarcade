import Phaser from 'phaser';

/**
 * Unified camera input for desktop AND touch:
 *
 *   Desktop:  click-drag = pan, mouse wheel = zoom (toward the cursor)
 *   Phone:    one-finger drag = pan, pinch = zoom, tap = select
 *
 * Taps vs drags: a pointer that moves less than TAP_SLOP pixels between
 * down and up counts as a tap and is forwarded to `onTap` (WorldScene uses
 * that for selecting creatures / assigning jobs / placing decor). Anything
 * that moved further is a pan and produces no tap. During and right after a
 * pinch, taps are suppressed so releasing two fingers never mis-selects.
 */

const TAP_SLOP = 12; // px of movement allowed before a press stops being a tap
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.5;

export class CameraController {
  /** WorldScene assigns this: called with world coordinates of a confirmed tap. */
  onTap?: (worldX: number, worldY: number) => void;
  /** Called whenever the pointer moves (world coords) — used for the build-mode ghost preview + tile hover marker. */
  onHover?: (worldX: number, worldY: number) => void;

  private cam: Phaser.Cameras.Scene2D.Camera;

  // Drag-to-pan bookkeeping
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private camStartX = 0;
  private camStartY = 0;
  private movedBeyondSlop = false;

  // Pinch-to-zoom bookkeeping
  private pinching = false;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private suppressTap = false;

  constructor(private scene: Phaser.Scene) {
    this.cam = scene.cameras.main;

    scene.input.on('pointerdown', this.handleDown, this);
    scene.input.on('pointermove', this.handleMove, this);
    scene.input.on('pointerup', this.handleUp, this);
    scene.input.on('wheel', this.handleWheel, this);
  }

  /** How many pointers (fingers/mouse) are currently pressed. */
  private downCount(): number {
    return this.scene.input.manager.pointers.filter((p) => p.isDown).length;
  }

  private downPointers(): Phaser.Input.Pointer[] {
    return this.scene.input.manager.pointers.filter((p) => p.isDown);
  }

  /**
   * Screen -> world conversion that only depends on the camera's scroll and
   * zoom (not on render matrices), so it's always up to date even mid-event.
   * A Phaser camera zooms around its CENTER, hence the width/height terms.
   */
  private toWorld(px: number, py: number): { x: number; y: number } {
    const z = this.cam.zoom;
    const wx = this.cam.scrollX + this.cam.width / 2 - this.cam.width / (2 * z) + px / z;
    const wy = this.cam.scrollY + this.cam.height / 2 - this.cam.height / (2 * z) + py / z;
    return { x: wx, y: wy };
  }

  private handleDown(pointer: Phaser.Input.Pointer): void {
    const down = this.downCount();
    if (down === 1) {
      // Begin a potential pan (or tap — we decide on release).
      this.dragging = true;
      this.movedBeyondSlop = false;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      this.camStartX = this.cam.scrollX;
      this.camStartY = this.cam.scrollY;
    } else if (down === 2) {
      // Second finger down: switch from panning to pinching.
      this.dragging = false;
      this.pinching = true;
      this.suppressTap = true; // no taps until all fingers lift
      const [a, b] = this.downPointers();
      this.pinchStartDist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      this.pinchStartZoom = this.cam.zoom;
    }
  }

  private handleMove(pointer: Phaser.Input.Pointer): void {
    // Report hover position (for ghost preview / tile highlight).
    if (this.onHover && !this.pinching) {
      const w = this.toWorld(pointer.x, pointer.y);
      this.onHover(w.x, w.y);
    }

    if (this.pinching && this.downCount() >= 2) {
      // Pinch: zoom proportionally to how far the fingers spread.
      const [a, b] = this.downPointers();
      const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (this.pinchStartDist > 0) {
        const target = this.pinchStartZoom * (dist / this.pinchStartDist);
        this.cam.setZoom(Phaser.Math.Clamp(target, MIN_ZOOM, MAX_ZOOM));
      }
      return;
    }

    if (this.dragging && pointer.isDown) {
      const dx = pointer.x - this.dragStartX;
      const dy = pointer.y - this.dragStartY;
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) this.movedBeyondSlop = true;
      // Divide by zoom so panning feels 1:1 with the finger at any zoom level.
      this.cam.scrollX = this.camStartX - dx / this.cam.zoom;
      this.cam.scrollY = this.camStartY - dy / this.cam.zoom;
    }
  }

  private handleUp(pointer: Phaser.Input.Pointer): void {
    const stillDown = this.downCount();

    if (this.pinching && stillDown < 2) this.pinching = false;

    if (stillDown === 0) {
      // All fingers lifted. Was this whole gesture a simple tap?
      if (this.dragging && !this.movedBeyondSlop && !this.suppressTap && this.onTap) {
        const w = this.toWorld(pointer.x, pointer.y);
        this.onTap(w.x, w.y);
      }
      this.dragging = false;
      this.suppressTap = false;
    }
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer,
    _over: unknown,
    _dx: number,
    deltaY: number,
  ): void {
    // Exponential factor gives smooth, consistent zoom steps.
    const factor = Math.exp(-deltaY * 0.001);
    const before = this.toWorld(pointer.x, pointer.y);
    this.cam.setZoom(Phaser.Math.Clamp(this.cam.zoom * factor, MIN_ZOOM, MAX_ZOOM));
    // Keep the world point under the cursor fixed while zooming ("zoom to cursor").
    const after = this.toWorld(pointer.x, pointer.y);
    this.cam.scrollX += before.x - after.x;
    this.cam.scrollY += before.y - after.y;
  }
}
