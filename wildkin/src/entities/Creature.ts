import Phaser from 'phaser';
import { tileToWorld } from '../core/iso';
import type { EvolvedFormDef, InfluenceDef, SpeciesDef, TileCoord } from '../types';
import type { ResourceNode } from './ResourceNode';

/**
 * A creature living in the sanctuary (Build Pass 2 — fused system).
 *
 * Behavior is a small state machine:
 *
 *   idle ──(timer)──▶ wandering ──(arrive)──▶ idle          (default life)
 *   idle/any ──(player assigns job)──▶ toJob ──▶ working    (harvest loop)
 *   any ──(player taps a tile)──▶ toTile ──▶ idle           (tap-to-move)
 *
 * FUSED RESONANCE-EVOLUTION: this creature keeps an `affinities` record —
 * one number per evolution branch (each base has exactly two, see
 * creatures.json). Affinity ONLY accrues while it works next to a matching
 * decor (the WorldScene applies resonanceRecipes.json and calls
 * addAffinity). When a branch crosses the threshold, the WorldScene evolves
 * the creature via evolveToForm(). The creature itself never decides — the
 * player steers everything through decor placement.
 *
 * The little bar above the creature shows its LEADING branch's progress,
 * tinted in that branch's color, so you can see who's close to evolving at
 * a glance.
 */

/** Services the creature needs from the world — implemented by WorldScene. Keeping this as an interface means Creature.ts never imports the scene. */
export interface CreatureWorld {
  pathTo(start: TileCoord, goal: TileCoord): TileCoord[];
  pathToAdjacent(start: TileCoord, target: TileCoord): TileCoord[] | null;
  randomWanderTarget(from: TileCoord, radius: number): TileCoord | null;
  /** Perform one harvest tick (node stock, resonance, affinity, inventory, particles). Returns the amount actually harvested (0 if node empty). */
  workTick(creature: Creature, node: ResourceNode): number;
}

export type CreatureState = 'idle' | 'wandering' | 'toJob' | 'toTile' | 'working';

export class Creature extends Phaser.GameObjects.Container {
  readonly creatureId: number;
  readonly speciesId: string;
  readonly def: SpeciesDef;
  readonly creatureName: string;

  // --- Fused-system state ---------------------------------------------------
  stage = 1;
  /** Once evolved: which form this creature became (from evolutionForms.json). */
  formId: string | null = null;
  formRare = false;
  /** branchId -> accumulated affinity. Initialized to 0 for this base's two branches. */
  affinities: Record<string, number> = {};
  /** Stat multipliers, replaced by the evolved form's stats on evolution. */
  stats = { workSpeedMult: 1, moveSpeedMult: 1 };

  // --- Behavior state ---------------------------------------------------------
  state: CreatureState = 'idle';
  tx: number;
  ty: number;
  assignedNode: ResourceNode | null = null;
  /** Onboarding sets this false so the tutorial Cindling stays put between steps. */
  wanderEnabled = true;
  /**
   * PASS 3 — move cooldown: after being assigned/moved, the creature can't be
   * redirected until this hits 0. Counts down in update(); saved & restored.
   */
  cooldownMs = 0;

  private path: TileCoord[] = [];
  private idleTimer = 1000; // ms until next wander attempt
  private workElapsedMs = 0;
  private fractionalGain = 0; // carries fractional resonance yields (e.g. x1.5) between ticks

  // --- Visual children --------------------------------------------------------
  private sprite: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Ellipse;
  private nameLabel: Phaser.GameObjects.Text;
  private affinityBar: Phaser.GameObjects.Graphics;
  private workTween: Phaser.Tweens.Tween | null = null;
  /** PASS 3 — the influence aura drawn under an evolved creature. */
  private auraGfx: Phaser.GameObjects.Graphics | null = null;
  private auraTween: Phaser.Tweens.Tween | null = null;

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
    for (const b of def.branches) this.affinities[b] = 0;

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
      .text(0, -def.size - 26, name, {
        fontSize: '13px',
        fontFamily: 'Segoe UI, sans-serif',
        color: '#ffffff',
        stroke: '#0a1418',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.add(this.nameLabel);

    // Affinity progress bar — appears once any affinity accrues (stage 1 only).
    this.affinityBar = scene.add.graphics();
    this.add(this.affinityBar);

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
    if (this.state === 'working') this.state = 'idle';
  }

  // ==========================================================================
  // Move cooldown (PASS 3) — steering is deliberate, not free
  // ==========================================================================

  /** Can the player redirect this creature right now? */
  canRedirect(): boolean {
    return this.cooldownMs <= 0;
  }

  cooldownSeconds(): number {
    return Math.ceil(this.cooldownMs / 1000);
  }

  startCooldown(ms: number): void {
    this.cooldownMs = ms;
  }

  // ==========================================================================
  // Influence aura (PASS 3) — evolved creatures shape their neighbors
  // ==========================================================================

  /**
   * Draw the aura diamond for this creature's evolved influence. The diamond
   * exactly matches the Chebyshev tile radius the affinity check uses, so
   * what the player SEES is what the game COMPUTES.
   */
  showAura(influence: InfluenceDef, color: number, visible: boolean): void {
    this.hideAura();
    const g = this.scene.add.graphics();
    const rx = influence.radius * 64; // TILE_W * radius (half-width of the diamond)
    const ry = influence.radius * 32; // TILE_H * radius (half-height)
    g.fillStyle(color, 0.08);
    g.lineStyle(2, color, 0.4);
    g.beginPath();
    g.moveTo(0, -ry);
    g.lineTo(rx, 0);
    g.lineTo(0, ry);
    g.lineTo(-rx, 0);
    g.closePath();
    g.fillPath();
    g.strokePath();
    this.addAt(g, 0); // underneath the body
    this.auraGfx = g;
    g.setVisible(visible);
    // Slow breathing pulse so the aura reads as alive, not a UI overlay.
    this.auraTween = this.scene.tweens.add({
      targets: g,
      alpha: { from: 1, to: 0.45 },
      duration: 1300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  setAuraVisible(visible: boolean): void {
    this.auraGfx?.setVisible(visible);
  }

  private hideAura(): void {
    this.auraTween?.stop();
    this.auraGfx?.destroy();
    this.auraGfx = null;
    this.auraTween = null;
  }

  // ==========================================================================
  // Affinity + evolution (called by WorldScene — the fused system's outcome)
  // ==========================================================================

  /**
   * Add affinity toward one branch (from a resonance tick). Returns the new
   * total. The WorldScene compares it against the active threshold (normal or
   * onboarding) and triggers evolution.
   */
  addAffinity(branchId: string, amount: number): number {
    if (this.stage >= 2) return this.affinities[branchId] ?? 0;
    this.affinities[branchId] = (this.affinities[branchId] ?? 0) + amount;
    return this.affinities[branchId];
  }

  /** The branch this creature is currently closest to (for the progress bar and HUD). */
  leadingBranch(): { branchId: string; value: number } {
    let best = this.def.branches[0];
    for (const b of this.def.branches) {
      if ((this.affinities[b] ?? 0) > (this.affinities[best] ?? 0)) best = b;
    }
    return { branchId: best, value: this.affinities[best] ?? 0 };
  }

  /**
   * Apply an evolution result (also used when restoring from a save —
   * `silent` skips the pop animation; the WorldScene owns the big burst FX).
   */
  evolveToForm(form: EvolvedFormDef, isRare: boolean, silent = false): void {
    this.stage = 2;
    this.formId = form.id;
    this.formRare = isRare;
    this.stats = { ...form.stats };

    // Swap to the evolved placeholder sprite (generated at boot).
    this.sprite.setTexture(`cr-form-${form.id}`);
    this.sprite.y = -this.def.size * 0.7;
    this.affinityBar.clear(); // evolved creatures no longer show progress

    if (!silent) {
      this.scene.tweens.add({
        targets: this.sprite,
        scale: { from: 0.2, to: 1 },
        duration: 550,
        ease: 'Back.easeOut',
      });
    }
  }

  /** Redraw the little progress bar above the creature. Called by WorldScene after affinity changes. */
  updateAffinityBar(threshold: number, branchColor: number): void {
    this.affinityBar.clear();
    if (this.stage >= 2) return;
    const lead = this.leadingBranch();
    if (lead.value <= 0) return;
    const frac = Math.min(1, lead.value / threshold);
    const w = 34;
    const y = -this.def.size - 14;
    this.affinityBar.fillStyle(0x0a1418, 0.75);
    this.affinityBar.fillRoundedRect(-w / 2 - 1, y - 1, w + 2, 7, 3);
    this.affinityBar.fillStyle(branchColor, 1);
    this.affinityBar.fillRoundedRect(-w / 2, y, Math.max(3, w * frac), 5, 2);
  }

  // ==========================================================================
  // Per-frame update — the state machine
  // ==========================================================================

  update(dtMs: number): void {
    if (this.cooldownMs > 0) this.cooldownMs = Math.max(0, this.cooldownMs - dtMs);
    switch (this.state) {
      case 'idle': {
        // Occasionally wander somewhere nearby (disabled during onboarding).
        this.idleTimer -= dtMs;
        if (this.idleTimer <= 0) {
          if (this.wanderEnabled) {
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
          this.clearJob();
          this.state = 'idle';
          break;
        }
        // Work speed scales with the evolved form's stat.
        const interval = this.assignedNode.def.workIntervalMs / this.stats.workSpeedMult;
        this.workElapsedMs += dtMs;
        while (this.workElapsedMs >= interval) {
          this.workElapsedMs -= interval;
          // The WorldScene handles the whole fused tick: harvest, resonance
          // multiplier, affinity gain, threshold check, evolution.
          this.world.workTick(this, this.assignedNode);
          if (this.stage >= 2 && this.state !== 'working') break; // evolved mid-loop
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
      this.setPosition(target.x, target.y);
      this.tx = next.tx;
      this.ty = next.ty;
      this.path.shift();
    } else {
      this.x += ((target.x - this.x) / dist) * step;
      this.y += ((target.y - this.y) / dist) * step;
    }
    // Keep iso draw order correct while moving.
    this.setDepth(this.y);
    return this.path.length === 0;
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
