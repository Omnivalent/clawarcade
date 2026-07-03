import Phaser from 'phaser';
import evolutionConfig from '../config/evolution.json';
import { tileToWorld } from '../core/iso';
import type {
  ActivityCounters,
  EvolutionBranchDef,
  SpeciesDef,
  TileCoord,
} from '../types';
import type { ResourceNode } from './ResourceNode';

/**
 * A creature living in the sanctuary.
 *
 * Behavior is a small state machine:
 *
 *   idle ──(timer)──▶ wandering ──(arrive)──▶ idle          (default life)
 *   idle/any ──(player assigns job)──▶ toJob ──▶ working    (harvest loop)
 *   any ──(player taps a tile)──▶ toTile ──▶ idle           (tap-to-move)
 *
 * EVOLUTION-BY-USE (core hook #2): everything the creature does feeds one of
 * three counters —
 *   mining     +1 per successful harvest tick while working
 *   exploring  +1 per tile walked (any reason)
 *   sanctuary  +1 per few seconds spent idling (x2 near decor)
 * When any counter reaches the threshold in evolution.json the creature
 * evolves, and the branch is whichever counter is HIGHEST. The branch swaps
 * the placeholder sprite and applies stat multipliers. All numbers live in
 * src/config/evolution.json.
 */

/** Services the creature needs from the world — implemented by WorldScene. Keeping this as an interface means Creature.ts never imports the scene. */
export interface CreatureWorld {
  pathTo(start: TileCoord, goal: TileCoord): TileCoord[];
  pathToAdjacent(start: TileCoord, target: TileCoord): TileCoord[] | null;
  randomWanderTarget(from: TileCoord, radius: number): TileCoord | null;
  isDecorNear(tx: number, ty: number, range: number): boolean;
  /** Perform one harvest tick (node stock, resonance, inventory, particles). Returns the amount actually harvested (0 if node empty). */
  workTick(creature: Creature, node: ResourceNode): number;
  /** Fired once when a creature evolves — plays the burst effect + toast. */
  onEvolve(creature: Creature, branch: EvolutionBranchDef): void;
}

export type CreatureState = 'idle' | 'wandering' | 'toJob' | 'toTile' | 'working';

const BRANCHES = evolutionConfig.branches as Record<string, EvolutionBranchDef>;

export class Creature extends Phaser.GameObjects.Container {
  readonly creatureId: number;
  readonly speciesId: string;
  readonly def: SpeciesDef;
  readonly creatureName: string;

  // --- Evolution state -----------------------------------------------------
  stage = 1;
  branch: string | null = null; // branch key ('mining' | 'exploring' | 'sanctuary') once evolved
  counters: ActivityCounters = { mining: 0, exploring: 0, sanctuary: 0 };
  /** Stat multipliers, replaced by the branch's stats on evolution. */
  stats = { workSpeedMult: 1, moveSpeedMult: 1, resonanceBonus: 0 };

  // --- Behavior state ------------------------------------------------------
  state: CreatureState = 'idle';
  tx: number;
  ty: number;
  assignedNode: ResourceNode | null = null;

  private path: TileCoord[] = [];
  private idleTimer = 1000; // ms until next wander attempt
  private sanctuaryAccumMs = 0; // idle time building toward the next sanctuary point
  private workElapsedMs = 0;
  private fractionalGain = 0; // carries fractional resonance yields (e.g. x1.5) between ticks

  // --- Visual children -----------------------------------------------------
  private sprite: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Ellipse;
  private nameLabel: Phaser.GameObjects.Text;
  private workTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    private world: CreatureWorld,
    creatureId: number,
    speciesId: string,
    def: SpeciesDef,
    name: string,
    tx: number,
    ty: number,
  ) {
    const pos = tileToWorld(tx, ty);
    super(scene, pos.x, pos.y);
    this.creatureId = creatureId;
    this.speciesId = speciesId;
    this.def = def;
    this.creatureName = name;
    this.tx = tx;
    this.ty = ty;

    // Soft shadow so creatures feel grounded on the tile.
    const shadow = scene.add.ellipse(0, 0, def.size * 0.9, def.size * 0.4, 0x000000, 0.25);
    this.add(shadow);

    // Selection ring — hidden until the player taps this creature.
    this.ring = scene.add.ellipse(0, 0, def.size * 1.5, def.size * 0.7);
    this.ring.setStrokeStyle(2.5, 0xffffff, 0.9);
    this.ring.setFillStyle(0xffffff, 0.08);
    this.ring.setVisible(false);
    this.add(this.ring);

    // The placeholder body (texture generated at boot from creatures.json).
    this.sprite = scene.add.image(0, -def.size * 0.55, `cr-${speciesId}`);
    this.add(this.sprite);

    // Name tag, shown only while selected.
    this.nameLabel = scene.add
      .text(0, -def.size - 16, name, {
        fontSize: '13px',
        fontFamily: 'Segoe UI, sans-serif',
        color: '#ffffff',
        stroke: '#0a1418',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.add(this.nameLabel);

    this.setDepth(pos.y);
    scene.add.existing(this);
  }

  // ==========================================================================
  // Player commands
  // ==========================================================================

  setSelected(on: boolean): void {
    this.ring.setVisible(on);
    this.nameLabel.setVisible(on);
  }

  /** Send the creature to work a node. Returns false if it can't reach it. */
  assignJob(node: ResourceNode): boolean {
    const path = this.world.pathToAdjacent({ tx: this.tx, ty: this.ty }, { tx: node.tx, ty: node.ty });
    if (path === null) return false;
    this.stopWorkingVisuals();
    this.assignedNode = node;
    this.path = path;
    this.state = path.length === 0 ? 'working' : 'toJob';
    if (this.state === 'working') this.startWorkingVisuals();
    return true;
  }

  /** Tap-to-move: walk to a tile (clears any job). Returns false if unreachable. */
  moveToTile(goal: TileCoord): boolean {
    const path = this.world.pathTo({ tx: this.tx, ty: this.ty }, goal);
    if (path.length === 0 && !(goal.tx === this.tx && goal.ty === this.ty)) return false;
    this.clearJob();
    this.path = path;
    this.state = 'toTile';
    return true;
  }

  clearJob(): void {
    this.assignedNode = null;
    this.stopWorkingVisuals();
  }

  // ==========================================================================
  // Per-frame update — the state machine
  // ==========================================================================

  update(dtMs: number): void {
    switch (this.state) {
      case 'idle': {
        // Resting builds the `sanctuary` counter — twice as fast near decor,
        // so a creature you keep in a decorated garden drifts toward Bloomkin.
        const nearDecor = this.world.isDecorNear(this.tx, this.ty, 2);
        this.sanctuaryAccumMs += dtMs * (nearDecor ? 2 : 1);
        const tickMs = evolutionConfig.sanctuaryTickSeconds * 1000;
        while (this.sanctuaryAccumMs >= tickMs) {
          this.sanctuaryAccumMs -= tickMs;
          this.counters.sanctuary += 1;
          this.checkEvolution();
        }

        // Occasionally wander somewhere nearby.
        this.idleTimer -= dtMs;
        if (this.idleTimer <= 0) {
          const target = this.world.randomWanderTarget(
            { tx: this.tx, ty: this.ty },
            this.def.wanderRadius,
          );
          if (target) {
            const path = this.world.pathTo({ tx: this.tx, ty: this.ty }, target);
            if (path.length > 0) {
              this.path = path;
              this.state = 'wandering';
            }
          }
          this.idleTimer = Phaser.Math.Between(1500, 4500);
        }
        break;
      }

      case 'wandering':
      case 'toTile':
      case 'toJob': {
        const arrived = this.stepAlongPath(dtMs);
        if (arrived) {
          if (this.state === 'toJob' && this.assignedNode) {
            this.state = 'working';
            this.startWorkingVisuals();
          } else {
            this.state = 'idle';
            this.idleTimer = Phaser.Math.Between(2000, 5000);
          }
        }
        break;
      }

      case 'working': {
        if (!this.assignedNode || !this.assignedNode.active) {
          // Node was removed — go back to daily life.
          this.clearJob();
          this.state = 'idle';
          break;
        }
        // Work speed scales with the branch stat (Forgekin works 1.6x faster).
        const interval = this.assignedNode.def.workIntervalMs / this.stats.workSpeedMult;
        this.workElapsedMs += dtMs;
        while (this.workElapsedMs >= interval) {
          this.workElapsedMs -= interval;
          const gained = this.world.workTick(this, this.assignedNode);
          if (gained > 0) {
            this.counters.mining += 1;
            this.checkEvolution();
          }
        }
        break;
      }
    }
  }

  /** Move toward the next tile in the path. Returns true when the whole path is done. */
  private stepAlongPath(dtMs: number): boolean {
    if (this.path.length === 0) return true;
    const next = this.path[0];
    const target = tileToWorld(next.tx, next.ty);
    const speed = this.def.speed * this.stats.moveSpeedMult; // px per second
    const step = (speed * dtMs) / 1000;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y);

    if (dist <= step) {
      // Snap onto the tile and advance the path.
      this.setPosition(target.x, target.y);
      this.tx = next.tx;
      this.ty = next.ty;
      this.path.shift();
      // Every tile walked feeds the `exploring` counter (rate in evolution.json).
      this.counters.exploring += evolutionConfig.exploringPerTile;
      this.checkEvolution();
    } else {
      this.x += ((target.x - this.x) / dist) * step;
      this.y += ((target.y - this.y) / dist) * step;
    }
    // Keep iso draw order correct while moving.
    this.setDepth(this.y);
    return this.path.length === 0;
  }

  // ==========================================================================
  // Evolution — the heart of the game
  // ==========================================================================

  private checkEvolution(): void {
    if (this.stage >= evolutionConfig.maxStage) return;
    const { mining, exploring, sanctuary } = this.counters;
    const max = Math.max(mining, exploring, sanctuary);
    if (max < evolutionConfig.threshold) return;

    // The branch is decided by whichever counter is highest — the creature
    // becomes what you made it do. Ties break in this priority order.
    let branchKey: string = 'mining';
    if (exploring === max && exploring >= mining) branchKey = 'exploring';
    if (sanctuary === max && sanctuary >= mining && sanctuary >= exploring) branchKey = 'sanctuary';
    if (mining === max && mining >= exploring && mining >= sanctuary) branchKey = 'mining';

    this.evolve(branchKey);
  }

  /** Apply an evolution (also used when restoring an evolved creature from a save — `silent` skips the fanfare). */
  evolve(branchKey: string, silent = false): void {
    const branchDef = BRANCHES[branchKey];
    if (!branchDef) return;
    this.stage = 2;
    this.branch = branchKey;
    this.stats = { ...branchDef.stats };

    // Swap to the next-stage placeholder sprite (generated at boot).
    this.sprite.setTexture(`cr-${this.speciesId}-${branchKey}`);
    this.sprite.y = -this.def.size * 0.65;

    if (!silent) {
      // Little pop animation; the WorldScene adds the particle burst + toast.
      this.scene.tweens.add({
        targets: this.sprite,
        scale: { from: 0.3, to: 1 },
        duration: 500,
        ease: 'Back.easeOut',
      });
      this.world.onEvolve(this, branchDef);
    }
  }

  // ==========================================================================
  // Working animation (a happy little bounce)
  // ==========================================================================

  private startWorkingVisuals(): void {
    this.stopWorkingVisuals();
    this.workTween = this.scene.tweens.add({
      targets: this.sprite,
      scaleY: 0.85,
      scaleX: 1.1,
      duration: 260,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private stopWorkingVisuals(): void {
    if (this.workTween) {
      this.workTween.stop();
      this.workTween = null;
      this.sprite.setScale(1, 1);
    }
    this.workElapsedMs = 0;
  }

  // ==========================================================================
  // Resonance yield helper — carries fractions across ticks so a x1.5
  // multiplier really averages out to x1.5 over time.
  // ==========================================================================

  bankYield(rawAmount: number): number {
    this.fractionalGain += rawAmount;
    const whole = Math.floor(this.fractionalGain);
    this.fractionalGain -= whole;
    return whole;
  }
}
