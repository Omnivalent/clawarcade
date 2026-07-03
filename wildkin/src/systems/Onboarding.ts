import Phaser from 'phaser';
import decorConfig from '../config/decor.json';
import onboardingConfig from '../config/onboarding.json';
import { gameEvents } from '../core/GameState';
import * as SaveManager from '../core/SaveManager';
import { tileToWorld } from '../core/iso';
import type { Creature } from '../entities/Creature';
import type { ResourceNode } from '../entities/ResourceNode';
import type { BuildItem, DecorDef, TileCoord } from '../types';

/**
 * The scripted 90-second first-run (runs once ever; gated by the
 * `wildkin-onboarded` localStorage flag — see SaveManager).
 *
 * Flow:
 *   1. World spawns with ONE Cindling. This class highlights a tile beside a
 *      nearby tree and hands the player a FREE Forge, pre-selected.
 *   2. "Place the Forge on the glowing tile" → placement is only accepted on
 *      that exact tile, so the step can't be fumbled.
 *   3. "Tap Cindling, then tap the glowing tree" → the moment the job starts,
 *      resonance fires (Forge is in range by construction) and the affinity
 *      bar starts filling.
 *   4. Onboarding uses the LOW threshold from onboarding.json, so the first
 *      evolution bursts in well under 90 seconds.
 *   5. Evolution → celebration modal → two more wildkin arrive → done.
 *
 * While active: autosave is off (a mid-tutorial refresh restarts it cleanly),
 * the Build/Settings buttons are hidden, and the tutorial creature doesn't
 * wander off between steps.
 */

export type OnboardingStep = 'place' | 'assign' | 'work' | 'done';

/** What the Onboarding needs from the WorldScene — kept as a narrow interface so there's no circular import. */
export interface OnboardingHost {
  /** Called when the tutorial finishes (flag already set): spawn the other creatures + save. */
  completeOnboarding(): void;
}

export class Onboarding {
  step: OnboardingStep = 'place';
  readonly placeTile: TileCoord;
  readonly targetNode: ResourceNode;

  private highlight: Phaser.GameObjects.Image;
  private pulse: Phaser.Tweens.Tween;

  constructor(
    private scene: Phaser.Scene,
    private host: OnboardingHost,
    targetNode: ResourceNode,
    placeTile: TileCoord,
  ) {
    this.targetNode = targetNode;
    this.placeTile = placeTile;

    // The pulsing "glowing tile" marker (reused for the node in step 2).
    const pos = tileToWorld(placeTile.tx, placeTile.ty);
    this.highlight = scene.add.image(pos.x, pos.y, 'ghost-ok').setDepth(150_000);
    this.pulse = scene.tweens.add({
      targets: this.highlight,
      alpha: { from: 1, to: 0.25 },
      duration: 550,
      yoyo: true,
      repeat: -1,
    });
  }

  /** Kick off step 1: hand the player the free Forge, pre-selected in build mode. */
  start(): void {
    const scene = this.scene;
    scene.registry.set('wk-onboarding', true);
    gameEvents.emit('wk-onboarding-changed', true);
    this.setGuide(onboardingConfig.prompts.place);

    // Pre-load the free decor into the build selection (cost {} = free).
    const decorId = onboardingConfig.freeDecor;
    const def = (decorConfig.items as Record<string, DecorDef>)[decorId];
    const item: BuildItem = { kind: 'decor', id: decorId, name: def.name, cost: {}, color: def.color };
    scene.registry.set('wk-build', item);
    gameEvents.emit('wk-build-changed', item);
  }

  /** Step 1 gate: only the free decor, only on the glowing tile. */
  isPlacementAllowed(itemId: string, tile: TileCoord): boolean {
    return (
      itemId === onboardingConfig.freeDecor &&
      tile.tx === this.placeTile.tx &&
      tile.ty === this.placeTile.ty
    );
  }

  /** WorldScene calls this after the Forge lands. */
  onDecorPlaced(): void {
    if (this.step !== 'place') return;
    this.step = 'assign';
    const scene = this.scene;

    // Clear build mode and move the glow onto the target node's tile.
    scene.registry.set('wk-build', null);
    gameEvents.emit('wk-build-changed', null);
    const pos = tileToWorld(this.targetNode.tx, this.targetNode.ty);
    this.highlight.setPosition(pos.x, pos.y);
    this.setGuide(onboardingConfig.prompts.assign);
  }

  /** WorldScene calls this when a creature is assigned to a node. */
  onJobAssigned(_creature: Creature, node: ResourceNode): void {
    if (this.step !== 'assign') return;
    if (node.nodeId !== this.targetNode.nodeId) return; // wrong node — keep guiding
    this.step = 'work';
    this.highlight.setVisible(false);
    this.setGuide(onboardingConfig.prompts.working);
  }

  /** WorldScene calls this the moment the tutorial creature evolves. */
  onEvolved(): void {
    if (this.step === 'done') return;
    this.step = 'done';
    SaveManager.setOnboarded();

    const scene = this.scene;
    scene.registry.set('wk-onboarding', false);
    gameEvents.emit('wk-onboarding-changed', false);
    this.setGuide(onboardingConfig.prompts.done);
    // Let the arrival message breathe, then clear the guide panel.
    scene.time.delayedCall(7000, () => this.setGuide(null));

    this.pulse.stop();
    this.highlight.destroy();
    this.host.completeOnboarding();
  }


  /**
   * Show a guide prompt. Mirrored into the scene registry because the UIScene
   * is created AFTER the WorldScene — it reads the current prompt at startup
   * instead of missing the first event.
   */
  private setGuide(msg: string | null): void {
    this.scene.registry.set('wk-guide-text', msg);
    gameEvents.emit('wk-guide', msg);
  }

  /** The low tutorial threshold — THE key pacing number for the first 90 seconds. */
  static tutorialThreshold(): number {
    return onboardingConfig.affinityThreshold;
  }
}
