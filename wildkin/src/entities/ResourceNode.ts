import Phaser from 'phaser';
import { tileToWorld } from '../core/iso';
import type { NodeTypeDef } from '../types';

/**
 * A resource node in the world: a tree, rock or flower that holds a stock of
 * a resource. Creatures assigned to it harvest from that stock, and the stock
 * regenerates over real time (rates come from src/config/nodes.json).
 *
 * Visuals are a placeholder sprite (generated in BootScene) plus a tiny
 * fill bar showing how much resource is left.
 */
export class ResourceNode extends Phaser.GameObjects.Container {
  /** Stable id — saved to localStorage so creature job assignments survive a refresh. */
  readonly nodeId: number;
  readonly typeId: string;
  readonly def: NodeTypeDef;
  readonly tx: number;
  readonly ty: number;

  /** Current stock (float — regen accumulates fractions between harvests). */
  amount: number;

  private bar: Phaser.GameObjects.Graphics;
  private lastDrawnFill = -1;

  constructor(
    scene: Phaser.Scene,
    nodeId: number,
    typeId: string,
    def: NodeTypeDef,
    tx: number,
    ty: number,
    amount?: number,
  ) {
    const pos = tileToWorld(tx, ty);
    super(scene, pos.x, pos.y);
    this.nodeId = nodeId;
    this.typeId = typeId;
    this.def = def;
    this.tx = tx;
    this.ty = ty;
    this.amount = amount ?? def.capacity;

    // Placeholder sprite, drawn once at boot (key: node-tree / node-rock / …).
    const sprite = scene.add.image(0, -14, `node-${typeId}`);
    this.add(sprite);

    // Little stock bar floating above the node.
    this.bar = scene.add.graphics();
    this.add(this.bar);
    this.redrawBar();

    // Draw order: things lower on screen render in front (classic iso sort).
    this.setDepth(pos.y);
    scene.add.existing(this);
  }

  /** Regenerate stock over time. Called every frame with delta seconds. */
  tickRegen(dtSeconds: number): void {
    if (this.amount < this.def.capacity) {
      this.amount = Math.min(this.def.capacity, this.amount + this.def.regenPerSecond * dtSeconds);
      this.redrawBar();
    }
  }

  /** A creature tries to harvest one "tick" worth. Returns how much it actually got (0 if the node is tapped out). */
  harvest(): number {
    if (this.amount >= this.def.yieldPerTick) {
      this.amount -= this.def.yieldPerTick;
      this.redrawBar();
      return this.def.yieldPerTick;
    }
    return 0;
  }

  /** Redraw the stock bar — but only when the visible fill actually changed, to keep draw calls down. */
  private redrawBar(): void {
    const fill = Math.round((this.amount / this.def.capacity) * 20);
    if (fill === this.lastDrawnFill) return;
    this.lastDrawnFill = fill;
    this.bar.clear();
    this.bar.fillStyle(0x0a1418, 0.7);
    this.bar.fillRect(-12, -40, 24, 5);
    this.bar.fillStyle(Phaser.Display.Color.HexStringToColor(this.def.color).color, 1);
    this.bar.fillRect(-11, -39, (22 * fill) / 20, 3);
  }
}
