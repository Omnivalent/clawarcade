import Phaser from 'phaser';
import creaturesConfig from '../config/creatures.json';
import decorConfig from '../config/decor.json';
import formsConfig from '../config/evolutionForms.json';
import nodesConfig from '../config/nodes.json';
import * as GameState from '../core/GameState';
import { gameEvents } from '../core/GameState';
import * as SaveManager from '../core/SaveManager';
import { getDailyBoost } from '../core/daily';
import { detectPhone, perfCaps } from '../core/device';
import { TILE_H, TILE_W, tileDistance, tileToWorld, worldToTile } from '../core/iso';
import { Creature, type CreatureWorld } from '../entities/Creature';
import { Decor } from '../entities/Decor';
import { ResourceNode } from '../entities/ResourceNode';
import { CameraController } from '../systems/CameraController';
import { biomeDef, biomeIds, generateWorld, tileTypeDef } from '../systems/MapGenerator';
import { Onboarding, type OnboardingHost } from '../systems/Onboarding';
import { Pathfinder } from '../systems/Pathfinder';
import { matchRecipe, type DecorPlacement } from '../systems/ResonanceSystem';
import type {
  BranchDef,
  BuildItem,
  DailyBoost,
  DecorDef,
  EvolutionEvent,
  GeneratedWorld,
  NodeTypeDef,
  SpeciesDef,
  TileCoord,
  TileTypeDef,
} from '../types';

/**
 * WorldScene — the sanctuary itself (Build Pass 2: fused resonance-evolution).
 *
 * Owns: the generated isometric map, all creatures / nodes / decor, the
 * camera, tap handling, the FUSED resonance-evolution tick (workTick), the
 * evolution burst, the scripted onboarding, the daily boost, and saving.
 * The HUD lives in UIScene; the scenes only talk through `gameEvents`.
 */

const BRANCHES = formsConfig.branches as Record<string, BranchDef>;

export class WorldScene extends Phaser.Scene implements CreatureWorld, OnboardingHost {
  // Map data — the landscape is GENERATED from (biome, seed); see MapGenerator.
  private world!: GeneratedWorld;
  private mapW = 0;
  private mapH = 0;
  private tiles: TileTypeDef[][] = [];
  private occupied = new Set<string>();

  // Entities
  private creatures: Creature[] = [];
  private nodes: ResourceNode[] = [];
  private decorItems: Decor[] = [];
  private nextEntityId = 1;

  // Interaction / systems state
  private pathfinder!: Pathfinder;
  private cameraCtl!: CameraController;
  private selected: Creature | null = null;
  private buildSelection: BuildItem | null = null;
  private hoverMarker!: Phaser.GameObjects.Image;
  private ghost!: Phaser.GameObjects.Image;
  private fx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private daily!: DailyBoost;
  private onboarding: Onboarding | null = null;
  /** Testing override (?rare=1 / ?rare=0): pins the evolution rare roll. Unset in normal play. */
  private forceRare: boolean | null = null;
  /** Which creature+branch combos already showed their "Resonance!" callout (so it doesn't spam every tick). */
  private resonanceAnnounced = new Set<string>();

  private beforeUnloadHandler = () => this.saveNow();

  constructor() {
    super('WorldScene');
  }

  // ==========================================================================
  // Scene lifecycle
  // ==========================================================================

  create(): void {
    // URL overrides for testing: ?fresh=1 (ignore save), ?biome=, ?seed=,
    // ?rare=1|0 (pin the evolution rare roll — used by the automated tests).
    const params = new URLSearchParams(window.location.search);
    if (params.has('rare')) this.forceRare = params.get('rare') === '1';
    // Until onboarding has been completed once, every load is a clean
    // tutorial run (autosave is also off until then — see saveNow).
    const save =
      params.has('fresh') || !SaveManager.hasOnboarded() ? null : SaveManager.load();
    GameState.initInventory(save?.inventory);

    // Today's rotating boost — one branch evolves faster all day.
    this.daily = getDailyBoost();
    this.registry.set('wk-daily', this.daily);

    // Which land are we on? A save pins it; otherwise roll a random one.
    const urlBiome = params.get('biome');
    const biome =
      save?.world.biome ??
      (urlBiome && biomeDef(urlBiome) ? urlBiome : biomeIds()[Math.floor(Math.random() * biomeIds().length)]);
    const seed =
      save?.world.seed ?? (Number(params.get('seed')) || Math.floor(Math.random() * 2 ** 31));
    this.world = generateWorld(biome, seed);

    this.buildMap();
    this.pathfinder = new Pathfinder(this.mapW, this.mapH, (tx, ty) => this.isWalkable(tx, ty));

    if (save) {
      this.restoreFromSave(save);
    } else {
      // Fresh land: nodes from the generator...
      for (const n of this.world.nodes) this.spawnNode(n.type, n.tx, n.ty, this.nextEntityId++);
      // ...and creatures: the full trio normally, or just the tutorial
      // Cindling if the player has never onboarded.
      let starters = creaturesConfig.startingCreatures;
      if (!SaveManager.hasOnboarded()) starters = starters.slice(0, 1);
      else if (detectPhone()) starters = starters.slice(0, creaturesConfig.maxCreaturesMobile);
      starters.forEach((c, i) => {
        const s = this.world.spawns[i % this.world.spawns.length] ?? { tx: 10, ty: 10 };
        this.spawnCreature(c.species, c.name, s.tx, s.ty, this.nextEntityId++);
      });
    }

    // Tell the HUD which land this is, and greet the player.
    const bdef = biomeDef(this.world.biomeId)!;
    this.registry.set('wk-world', { name: bdef.name, biome: this.world.biomeId, seed: this.world.seed });
    if (SaveManager.hasOnboarded()) {
      this.time.delayedCall(600, () => gameEvents.emit('wk-toast', `🌍 ${bdef.name} — ${bdef.tagline}`));
    }

    this.setupCamera();
    this.setupEffects();
    this.setupTimersAndEvents();

    // First-ever run: build and start the scripted tutorial.
    if (!SaveManager.hasOnboarded()) this.setupOnboarding();

    this.exposeDebugHook();
  }

  update(_time: number, dtMs: number): void {
    for (const c of this.creatures) c.update(dtMs);
    for (const n of this.nodes) n.tickRegen(dtMs / 1000);
  }

  // ==========================================================================
  // Save restore
  // ==========================================================================

  private restoreFromSave(save: NonNullable<ReturnType<typeof SaveManager.load>>): void {
    this.nextEntityId = save.nextEntityId;
    for (const n of save.nodes) this.spawnNode(n.type, n.tile[0], n.tile[1], n.id, n.amount);
    for (const d of save.decor) this.spawnDecor(d.type, d.tile[0], d.tile[1]);
    for (const c of save.creatures) {
      const cr = this.spawnCreature(c.species, c.name, c.tile[0], c.tile[1], c.id);
      if (!cr) continue;
      cr.affinities = { ...cr.affinities, ...c.affinities };
      if (c.formId) {
        // Find the form (common or rare) across this base's branches.
        const form = Object.values(BRANCHES)
          .flatMap((b) => [b.common, b.rare])
          .find((f) => f.id === c.formId);
        if (form) cr.evolveToForm(form, c.formRare, true); // silent on load
      } else {
        // Redraw the progress bar for partially-steered creatures.
        const lead = cr.leadingBranch();
        if (lead.value > 0) {
          cr.updateAffinityBar(cr.def.affinityThreshold, this.branchColor(lead.branchId));
        }
      }
      if (c.assignedNodeId !== null) {
        const node = this.nodes.find((n) => n.nodeId === c.assignedNodeId);
        if (node) cr.assignJob(node); // walks back to work after a refresh
      }
    }
  }

  // ==========================================================================
  // Map building
  // ==========================================================================

  private buildMap(): void {
    const layout = this.world.layout;
    this.mapH = this.world.size;
    this.mapW = this.world.size;

    for (let ty = 0; ty < this.mapH; ty++) {
      const row: TileTypeDef[] = [];
      for (let tx = 0; tx < this.mapW; tx++) {
        const def = tileTypeDef(layout[ty][tx]);
        row.push(def);
        const pos = tileToWorld(tx, ty);
        // Deterministic scatter of the darker '-b' shade breaks up big fields.
        const alt = ((tx * 73856093) ^ (ty * 19349663) ^ this.world.seed) % 5 === 0;
        this.add
          .image(pos.x, pos.y, `tile-${def.id}${alt ? '-b' : ''}`)
          .setDepth(pos.y - 100_000);
      }
      this.tiles.push(row);
    }
  }

  private inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.mapW && ty < this.mapH;
  }

  private isWalkable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.tiles[ty][tx].walkable && !this.occupied.has(`${tx},${ty}`);
  }

  // ==========================================================================
  // Entity spawning
  // ==========================================================================

  private spawnNode(typeId: string, tx: number, ty: number, id: number, amount?: number): ResourceNode | null {
    const def = (nodesConfig.nodeTypes as Record<string, NodeTypeDef>)[typeId];
    if (!def || !this.inBounds(tx, ty)) return null;
    const node = new ResourceNode(this, id, typeId, def, tx, ty, amount);
    this.nodes.push(node);
    this.occupied.add(`${tx},${ty}`);
    return node;
  }

  private spawnDecor(typeId: string, tx: number, ty: number): void {
    const def = (decorConfig.items as Record<string, DecorDef>)[typeId];
    if (!def || !this.inBounds(tx, ty)) return;
    const decor = new Decor(this, typeId, def, tx, ty);
    this.decorItems.push(decor);
    this.occupied.add(`${tx},${ty}`);
  }

  private spawnCreature(
    speciesId: string,
    name: string,
    tx: number,
    ty: number,
    id: number,
  ): Creature | null {
    const def = (creaturesConfig.species as Record<string, SpeciesDef>)[speciesId];
    if (!def) return null;
    const c = new Creature(this, this, id, speciesId, def, name, tx, ty);
    this.creatures.push(c);
    return c;
  }

  // ==========================================================================
  // Onboarding setup (first-ever run only)
  // ==========================================================================

  private setupOnboarding(): void {
    const cindling = this.creatures[0];
    if (!cindling) return;
    cindling.wanderEnabled = false; // stays put between tutorial steps

    // Target node: the reachable node nearest to the Cindling.
    let target: ResourceNode | null = null;
    let bestDist = Infinity;
    for (const n of this.nodes) {
      const d = tileDistance(n.tx, n.ty, cindling.tx, cindling.ty);
      const reachable = this.pathfinder.findPathAdjacent(
        { tx: cindling.tx, ty: cindling.ty },
        { tx: n.tx, ty: n.ty },
      );
      if (reachable !== null && d < bestDist) {
        bestDist = d;
        target = n;
      }
    }
    if (!target) return; // generator guarantees reachable nodes; belt & braces

    // Glowing tile: a free, buildable tile adjacent to the node — that way
    // the Forge is guaranteed within resonance range (2) of wherever the
    // creature ends up standing to work.
    let placeTile: TileCoord | null = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      const tx = target.tx + dx;
      const ty = target.ty + dy;
      if (this.canPlaceAt(tx, ty)) {
        placeTile = { tx, ty };
        break;
      }
    }
    if (!placeTile) return;

    // Frame the action: camera on the tutorial area.
    const mid = tileToWorld((target.tx + cindling.tx) / 2, (target.ty + cindling.ty) / 2);
    this.cameras.main.centerOn(mid.x, mid.y);

    this.onboarding = new Onboarding(this, this, target, placeTile);
    this.onboarding.start();
    this.buildSelection = this.registry.get('wk-build') as BuildItem; // Forge, free
  }

  /** Onboarding finished: the sanctuary grows. */
  completeOnboarding(): void {
    // Spawn the remaining two starters near the center with a little pop.
    const remaining = creaturesConfig.startingCreatures.slice(1);
    remaining.forEach((c, i) => {
      const s = this.world.spawns[(i + 1) % this.world.spawns.length] ?? { tx: 10, ty: 10 };
      const cr = this.spawnCreature(c.species, c.name, s.tx, s.ty, this.nextEntityId++);
      if (cr) {
        cr.setScale(0);
        this.tweens.add({ targets: cr, scale: 1, duration: 600, ease: 'Back.easeOut', delay: i * 250 });
        this.fx.particleTint = 0xffffff;
        this.fx.explode(perfCaps().sparkleParticles * 2, cr.x, cr.y - 10);
      }
    });
    for (const c of this.creatures) c.wanderEnabled = true;
    this.onboarding = null;
    this.saveNow(); // first save of the real sanctuary
  }

  // ==========================================================================
  // Camera, effects, timers
  // ==========================================================================

  private setupCamera(): void {
    const margin = 260;
    const left = tileToWorld(0, this.mapH - 1).x - TILE_W / 2;
    const right = tileToWorld(this.mapW - 1, 0).x + TILE_W / 2;
    const top = -TILE_H;
    const bottom = tileToWorld(this.mapW - 1, this.mapH - 1).y + TILE_H;
    this.cameras.main.setBounds(
      left - margin,
      top - margin,
      right - left + margin * 2,
      bottom - top + margin * 2,
    );

    const center = tileToWorld(this.mapW / 2, this.mapH / 2);
    this.cameras.main.centerOn(center.x, center.y);
    this.cameras.main.setZoom(detectPhone() ? 0.8 : 1.1);

    this.cameraCtl = new CameraController(this);
    this.cameraCtl.onTap = (wx, wy) => this.handleTap(wx, wy);
    this.cameraCtl.onHover = (wx, wy) => this.handleHover(wx, wy);
  }

  private setupEffects(): void {
    this.hoverMarker = this.add.image(0, 0, 'tile-hover').setVisible(false).setDepth(200_000);
    this.ghost = this.add.image(0, 0, 'ghost-ok').setVisible(false).setDepth(200_001);

    // One reusable particle emitter for everything, tinted per effect.
    this.fx = this.add.particles(0, 0, 'particle', {
      emitting: false,
      speed: { min: 40, max: 170 },
      lifespan: { min: 350, max: 750 },
      scale: { start: 0.9, end: 0 },
      gravityY: -40,
    });
    this.fx.setDepth(300_000);
  }

  private setupTimersAndEvents(): void {
    this.time.addEvent({ delay: 10_000, loop: true, callback: () => this.saveNow() });
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    document.addEventListener('visibilitychange', this.beforeUnloadHandler);

    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        if (this.selected) gameEvents.emit('wk-selected-update', this.creatureSnapshot(this.selected));
      },
    });

    gameEvents.on('wk-build-changed', this.onBuildChanged, this);
    gameEvents.on('wk-modal-closed', this.onModalClosed, this);

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      document.removeEventListener('visibilitychange', this.beforeUnloadHandler);
      gameEvents.off('wk-build-changed', this.onBuildChanged, this);
      gameEvents.off('wk-modal-closed', this.onModalClosed, this);
    });
  }

  private onBuildChanged(item: BuildItem | null): void {
    this.buildSelection = item;
    if (!item) this.ghost.setVisible(false);
  }

  private onModalClosed(): void {
    this.registry.set('wk-modal', false);
    // Ease the camera back out after the evolution close-up.
    this.cameras.main.zoomTo(detectPhone() ? 0.8 : 1.1, 600, 'Sine.easeInOut');
  }

  // ==========================================================================
  // Tap & hover handling
  // ==========================================================================

  private handleHover(wx: number, wy: number): void {
    const { tx, ty } = worldToTile(wx, wy);
    if (!this.inBounds(tx, ty)) {
      this.hoverMarker.setVisible(false);
      this.ghost.setVisible(false);
      return;
    }
    const pos = tileToWorld(tx, ty);

    if (this.buildSelection) {
      const ok = this.canPlaceAt(tx, ty) &&
        (!this.onboarding || this.onboarding.isPlacementAllowed(this.buildSelection.id, { tx, ty }));
      this.ghost.setTexture(ok ? 'ghost-ok' : 'ghost-bad');
      this.ghost.setPosition(pos.x, pos.y).setVisible(true);
      this.hoverMarker.setVisible(false);
    } else {
      this.hoverMarker.setPosition(pos.x, pos.y).setVisible(true);
    }
  }

  private handleTap(wx: number, wy: number): void {
    // The celebration modal blocks the world underneath.
    if (this.registry.get('wk-modal')) return;

    // 1) Build mode: taps place the selected item.
    if (this.buildSelection) {
      this.tryPlace(this.buildSelection, worldToTile(wx, wy));
      return;
    }

    // 2) Tap on a creature?
    const creature = this.pickCreature(wx, wy);
    if (creature) {
      this.select(creature === this.selected ? null : creature);
      return;
    }

    // 3) Tap on a resource node?
    const node = this.pickNode(wx, wy);
    if (node) {
      if (this.selected) {
        if (this.selected.assignJob(node)) {
          gameEvents.emit('wk-toast', `${this.selected.creatureName} → ${node.def.name}`);
          this.onboarding?.onJobAssigned(this.selected, node);
        } else {
          gameEvents.emit('wk-toast', `${this.selected.creatureName} can't reach that!`);
        }
      } else {
        gameEvents.emit(
          'wk-toast',
          `${node.def.name}: ${Math.floor(node.amount)}/${node.def.capacity} — select a creature first to assign it`,
        );
      }
      return;
    }

    // 4) Tap on the ground: send the selected creature there (tap-to-move).
    //    Disabled while the tutorial is scripting the flow.
    const t = worldToTile(wx, wy);
    if (!this.onboarding && this.selected && this.isWalkable(t.tx, t.ty)) {
      if (this.selected.moveToTile(t)) {
        gameEvents.emit('wk-toast', `${this.selected.creatureName} is heading over`);
      }
      return;
    }

    // 5) Nothing useful: deselect.
    this.select(null);
  }

  private pickCreature(wx: number, wy: number): Creature | null {
    let best: Creature | null = null;
    let bestDist = 30;
    for (const c of this.creatures) {
      const d = Phaser.Math.Distance.Between(wx, wy, c.x, c.y - 12);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  private pickNode(wx: number, wy: number): ResourceNode | null {
    const t = worldToTile(wx, wy);
    for (const n of this.nodes) {
      if (n.tx === t.tx && n.ty === t.ty) return n;
      if (Phaser.Math.Distance.Between(wx, wy, n.x, n.y - 18) < 32) return n;
    }
    return null;
  }

  private select(creature: Creature | null): void {
    if (this.selected) this.selected.setSelected(false);
    this.selected = creature;
    if (creature) {
      creature.setSelected(true);
      gameEvents.emit('wk-selected', this.creatureSnapshot(creature));
    } else {
      gameEvents.emit('wk-selected', null);
    }
  }

  /** Plain-data view of a creature for the HUD: its two branches, affinity progress, evolved form. */
  private creatureSnapshot(c: Creature) {
    return {
      name: c.creatureName,
      speciesName: c.def.name,
      flavor: c.def.flavor,
      stage: c.stage,
      state: c.state,
      formName: c.formId
        ? Object.values(BRANCHES).flatMap((b) => [b.common, b.rare]).find((f) => f.id === c.formId)?.name ?? null
        : null,
      formRare: c.formRare,
      branches: c.def.branches.map((id) => ({
        id,
        name: BRANCHES[id].name,
        color: BRANCHES[id].color,
        value: c.affinities[id] ?? 0,
        threshold: this.affinityThreshold(c),
        boosted: this.daily.branchId === id,
      })),
    };
  }

  // ==========================================================================
  // Build mode
  // ==========================================================================

  private canPlaceAt(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.tiles[ty][tx].buildable && !this.occupied.has(`${tx},${ty}`);
  }

  private tryPlace(item: BuildItem, t: TileCoord): void {
    // During the tutorial, only the free Forge on the glowing tile counts.
    if (this.onboarding && !this.onboarding.isPlacementAllowed(item.id, t)) {
      gameEvents.emit('wk-toast', '✨ Place it on the glowing tile');
      return;
    }
    if (!this.canPlaceAt(t.tx, t.ty)) {
      gameEvents.emit('wk-toast', 'Can’t place there — needs open buildable ground');
      return;
    }
    if (!GameState.spend(item.cost)) {
      const missing = Object.entries(item.cost)
        .filter(([id, amt]) => (GameState.inventory[id] ?? 0) < amt)
        .map(([id, amt]) => `${amt - (GameState.inventory[id] ?? 0)} more ${id}`)
        .join(', ');
      gameEvents.emit('wk-toast', `Not enough resources (need ${missing})`);
      return;
    }

    if (item.kind === 'decor') {
      this.spawnDecor(item.id, t.tx, t.ty);
    } else {
      this.spawnNode(item.id, t.tx, t.ty, this.nextEntityId++);
    }

    const pos = tileToWorld(t.tx, t.ty);
    this.fx.particleTint = 0xffffff;
    this.fx.explode(perfCaps().sparkleParticles * 2, pos.x, pos.y - 10);
    this.onboarding?.onDecorPlaced();
    this.saveNow();
  }

  // ==========================================================================
  // CreatureWorld implementation
  // ==========================================================================

  pathTo(start: TileCoord, goal: TileCoord): TileCoord[] {
    return this.pathfinder.findPath(start, goal);
  }

  pathToAdjacent(start: TileCoord, target: TileCoord): TileCoord[] | null {
    return this.pathfinder.findPathAdjacent(start, target);
  }

  randomWanderTarget(from: TileCoord, radius: number): TileCoord | null {
    for (let i = 0; i < 8; i++) {
      const tx = from.tx + Phaser.Math.Between(-radius, radius);
      const ty = from.ty + Phaser.Math.Between(-radius, radius);
      if ((tx !== from.tx || ty !== from.ty) && this.isWalkable(tx, ty)) return { tx, ty };
    }
    return null;
  }

  /** The active evolution threshold for this creature — the tutorial Cindling uses the low onboarding value. */
  private affinityThreshold(creature: Creature): number {
    if (this.onboarding && this.onboarding.step !== 'done' && creature === this.creatures[0]) {
      return Onboarding.tutorialThreshold();
    }
    return creature.def.affinityThreshold;
  }

  private branchColor(branchId: string): number {
    return Phaser.Display.Color.HexStringToColor(BRANCHES[branchId].color).color;
  }

  /**
   * THE FUSED TICK. One harvest = one pass through the whole system:
   *   harvest the node → match a resonance recipe (base + nearby decor) →
   *   multiply production NOW → add branch affinity for LATER → burst into
   *   evolution when the threshold is crossed.
   */
  workTick(creature: Creature, node: ResourceNode): number {
    const taken = node.harvest();
    if (taken <= 0) return 0; // node tapped out; it regenerates over time

    const decorPlacements: DecorPlacement[] = this.decorItems.map((d) => ({
      type: d.typeId,
      tx: d.tx,
      ty: d.ty,
    }));
    const recipe = matchRecipe(creature.speciesId, creature.tx, creature.ty, decorPlacements);

    // (a) NOW: production multiplier. Fractions carry across ticks.
    const gained = creature.bankYield(taken * (recipe?.productionMultiplier ?? 1));
    if (gained > 0) {
      GameState.addResource(node.def.resource, gained);
      this.floatText(creature.x, creature.y - 44, `+${gained}`, node.def.color);
    }

    if (recipe) {
      // Resonance sparkles every tick — the instant feedback half.
      this.fx.particleTint = Phaser.Display.Color.HexStringToColor(recipe.particleColor).color;
      this.fx.explode(perfCaps().sparkleParticles, creature.x, creature.y - 20);

      // (b) LATER: branch affinity — the steering half (stage-1 only; the
      // daily boost multiplies gains for its chosen branch).
      if (creature.stage === 1) {
        const boost = this.daily.branchId === recipe.branchId ? this.daily.multiplier : 1;
        const value = creature.addAffinity(recipe.branchId, recipe.affinityPerTick * boost);
        const threshold = this.affinityThreshold(creature);
        creature.updateAffinityBar(threshold, this.branchColor(recipe.branchId));

        const onceKey = `${creature.creatureId}:${recipe.branchId}`;
        if (!this.resonanceAnnounced.has(onceKey)) {
          this.resonanceAnnounced.add(onceKey);
          this.floatText(
            creature.x,
            creature.y - 66,
            `✨ Resonance! → ${BRANCHES[recipe.branchId].name}`,
            recipe.particleColor,
          );
        }

        if (value >= threshold) this.evolveCreature(creature, recipe.branchId);
      }
    }

    return taken;
  }

  // ==========================================================================
  // The evolution burst — the hero moment
  // ==========================================================================

  private evolveCreature(creature: Creature, branchId: string): void {
    const branch = BRANCHES[branchId];
    // The rare roll — 15% by default, straight from evolutionForms.json.
    const isRare = this.forceRare ?? Math.random() < branch.rareChance;
    const form = isRare ? branch.rare : branch.common;

    creature.evolveToForm(form, isRare);

    // Cinematic: pan + zoom onto the creature...
    const cam = this.cameras.main;
    this.registry.set('wk-modal', true); // freeze world taps right away
    cam.pan(creature.x, creature.y - 20, 450, 'Sine.easeInOut');
    cam.zoomTo(1.7, 450, 'Sine.easeInOut');

    // ...then flash, shake, and a two-tone particle burst...
    this.time.delayedCall(470, () => {
      cam.flash(220, 255, 255, 255);
      cam.shake(200, 0.008);
      const caps = perfCaps();
      this.fx.particleTint = this.branchColor(branchId);
      this.fx.explode(caps.burstParticles, creature.x, creature.y - 20);
      this.fx.particleTint = 0xffffff;
      this.fx.explode(Math.floor(caps.burstParticles / 2), creature.x, creature.y - 20);
    });

    // ...then the celebration modal (UIScene renders it inside the canvas so
    // the Share screenshot captures everything).
    this.time.delayedCall(1000, () => {
      const event: EvolutionEvent = {
        creatureName: creature.creatureName,
        baseSpeciesId: creature.speciesId,
        baseSpeciesName: creature.def.name,
        branchId,
        form,
        isRare,
      };
      gameEvents.emit('wk-evolution-modal', event);
    });

    this.onboarding?.onEvolved();
    if (this.selected === creature) gameEvents.emit('wk-selected', this.creatureSnapshot(creature));
    this.saveNow(); // an evolution is a milestone — never lose one
  }

  /** Small rising text used for +1s, resonance callouts, arrivals. */
  private floatText(x: number, y: number, msg: string, colorHex: string): void {
    const t = this.add
      .text(x, y, msg, {
        fontSize: '15px',
        fontFamily: 'Segoe UI, sans-serif',
        fontStyle: 'bold',
        color: colorHex,
        stroke: '#0a1418',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(400_000);
    this.tweens.add({
      targets: t,
      y: y - 34,
      alpha: 0,
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  // ==========================================================================
  // Saving
  // ==========================================================================

  private saveNow(): void {
    // No autosave until the tutorial is done — a mid-onboarding refresh
    // should restart the tutorial cleanly, not resume half of it.
    if (!SaveManager.hasOnboarded()) return;
    SaveManager.save({
      world: { biome: this.world.biomeId, seed: this.world.seed },
      inventory: { ...GameState.inventory },
      creatures: this.creatures.map((c) => ({
        id: c.creatureId,
        species: c.speciesId,
        name: c.creatureName,
        tile: [c.tx, c.ty] as [number, number],
        stage: c.stage,
        formId: c.formId,
        formRare: c.formRare,
        affinities: { ...c.affinities },
        assignedNodeId: c.assignedNode ? c.assignedNode.nodeId : null,
      })),
      nodes: this.nodes.map((n) => ({
        id: n.nodeId,
        type: n.typeId,
        tile: [n.tx, n.ty] as [number, number],
        amount: n.amount,
      })),
      decor: this.decorItems.map((d) => ({
        type: d.typeId,
        tile: [d.tx, d.ty] as [number, number],
      })),
      nextEntityId: this.nextEntityId,
    });
  }

  // ==========================================================================
  // Read-only debug hook for automated tests and devtools poking
  // ==========================================================================

  private exposeDebugHook(): void {
    (window as unknown as Record<string, unknown>).__wildkinDebug = () => ({
      camera: {
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
        zoom: this.cameras.main.zoom,
        width: this.cameras.main.width,
        height: this.cameras.main.height,
      },
      hasOnboarded: SaveManager.hasOnboarded(),
      onboardingStep: this.onboarding?.step ?? null,
      onboardingPlaceTile: this.onboarding ? { ...this.onboarding.placeTile } : null,
      onboardingNodeId: this.onboarding?.targetNode.nodeId ?? null,
      daily: { ...this.daily },
      modalOpen: !!this.registry.get('wk-modal'),
      selectedId: this.selected?.creatureId ?? null,
      creatures: this.creatures.map((c) => ({
        id: c.creatureId,
        name: c.creatureName,
        species: c.speciesId,
        x: c.x,
        y: c.y,
        tx: c.tx,
        ty: c.ty,
        state: c.state,
        stage: c.stage,
        formId: c.formId,
        formRare: c.formRare,
        affinities: { ...c.affinities },
        assignedNodeId: c.assignedNode?.nodeId ?? null,
      })),
      nodes: this.nodes.map((n) => ({
        id: n.nodeId,
        type: n.typeId,
        x: n.x,
        y: n.y,
        tx: n.tx,
        ty: n.ty,
        amount: n.amount,
      })),
      decor: this.decorItems.map((d) => ({ type: d.typeId, tx: d.tx, ty: d.ty })),
    });
  }
}
