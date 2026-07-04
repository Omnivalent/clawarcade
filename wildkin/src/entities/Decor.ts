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

    // Real art if loaded, placeholder otherwise (same key). Bottom-center
    // origin, fitted to ~1.1 tiles tall so all decor reads at one scale.
    const sprite = scene.add.image(0, 12, `decor-${typeId}`).setOrigin(0.5, 1);
    sprite.setScale((TILE_H * 1.1) / sprite.height);
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
