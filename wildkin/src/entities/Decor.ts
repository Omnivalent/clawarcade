import Phaser from 'phaser';
import { TILE_H, tileToWorld } from '../core/iso';
import type { DecorDef } from '../types';

/**
 * A placed decor item (crystal, lantern, moss stone, petal bed…).
 *
 * Decor is not just cosmetic:
 *  - Resonance recipes check for decor near working creatures (ResonanceSystem).
 *  - Creatures idling near any decor build up their `sanctuary` activity
 *    counter twice as fast (see Creature.ts), nudging them toward the
 *    Bloomkin evolution branch.
 */
export class Decor extends Phaser.GameObjects.Container {
  readonly typeId: string;
  readonly def: DecorDef;
  readonly tx: number;
  readonly ty: number;

  constructor(scene: Phaser.Scene, typeId: string, def: DecorDef, tx: number, ty: number) {
    const pos = tileToWorld(tx, ty);
    super(scene, pos.x, pos.y);
    this.typeId = typeId;
    this.def = def;
    this.tx = tx;
    this.ty = ty;

    // GROUNDING PASS — occupied-tile marker + contact shadow + the sprite
    // standing on the tile floor (bottom-center origin, ~1.1 tiles tall).
    this.add(scene.add.image(0, 0, 'tile-occupied').setAlpha(0.9));
    const sprite = scene.add.image(0, 12, `decor-${typeId}`).setOrigin(0.5, 1);
    sprite.setScale((TILE_H * 1.1) / sprite.height);
    const footW = sprite.width * sprite.scaleX;
    this.add(scene.add.ellipse(0, 11, footW * 0.7, Math.max(5, footW * 0.18), 0x000000, 0.2));
    this.add(sprite);

    // Gentle bobbing so decor feels alive.
    scene.tweens.add({
      targets: sprite,
      y: 9,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.setDepth(pos.y);
    scene.add.existing(this);
  }
}
