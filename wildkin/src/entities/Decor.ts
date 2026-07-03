import Phaser from 'phaser';
import { tileToWorld } from '../core/iso';
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

    // Placeholder sprite generated at boot (key: decor-crystal / decor-lantern / …).
    const sprite = scene.add.image(0, -10, `decor-${typeId}`);
    this.add(sprite);

    // Gentle bobbing so decor feels alive even as placeholder shapes.
    scene.tweens.add({
      targets: sprite,
      y: -14,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.setDepth(pos.y);
    scene.add.existing(this);
  }
}
