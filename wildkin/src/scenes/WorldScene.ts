import Phaser from 'phaser';
import creaturesConfig from '../config/creatures.json';
import decorConfig from '../config/decor.json';
import evolutionConfig from '../config/evolution.json';
import nodesConfig from '../config/nodes.json';
import * as GameState from '../core/GameState';
import { gameEvents } from '../core/GameState';
import * as SaveManager from '../core/SaveManager';
import { detectPhone } from '../core/device';
import { perfCaps } from '../core/device';
import { TILE_H, TILE_W, tileDistance, tileToWorld, worldToTile } from '../core/iso';
import { Creature, type CreatureWorld } from '../entities/Creature';
import { Decor } from '../entities/Decor';
import { ResourceNode } from '../entities/ResourceNode';
import { CameraController } from '../systems/CameraController';
import { biomeDef, biomeIds, generateWorld, tileTypeDef } from '../systems/MapGenerator';
import { Pathfinder } from '../systems/Pathfinder';
import { checkResonance, type DecorPlacement } from '../systems/ResonanceSystem';
import type {
  BuildItem,
  DecorDef,
  EvolutionBranchDef,
  GeneratedWorld,
  NodeTypeDef,
  SpeciesDef,
  TileCoord,
  TileTypeDef,
} from '../types';

/**
 * WorldScene — the sanctuary itself.
 *
 * Owns: the isometric tile map, all creatures / nodes / decor, the camera,
 * tap handling (select / assign / move / build), the resonance + evolution
 * effects, and saving/loading. The HUD lives in UIScene; the two scenes only
 * talk through the `gameEvents` bus (see core/GameState.ts).
 */
export class WorldScene extends Phaser.Scene implements CreatureWorld {
  // Map data — the landscape is GENERATED from (biome, seed); see MapGenerator.
  private world!: GeneratedWorld;
  private mapW = 0;
  private mapH = 0;
  private tiles: TileTypeDef[][] = []; // [row][col]
  private occupied = new Set<string>(); // "tx,ty" of tiles blocked by nodes/decor

  // Entities
  private creatures: Creature[] = [];
  private nodes: ResourceNode[] = [];
  private decorItems: Decor[] = [];
  private nextEntityId = 1;

  // Interaction state
  private pathfinder!: Pathfinder;
  private cameraCtl!: CameraController;
  private selected: Creature | null = null;
  private buildSelection: BuildItem | null = null;
  private hoverMarker!: Phaser.GameObjects.Image;
  private ghost!: Phaser.GameObjects.Image;
  private fx!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Tracks which creature+recipe combos already showed their "Resonance!" callout this session (so it doesn't spam every tick). */
  private resonanceAnnounced = new Set<string>();

  private beforeUnloadHandler = () => this.saveNow();

  constructor() {
    super('WorldScene');
  }

  // ==========================================================================
  // Scene lifecycle
  // ==========================================================================

  create(): void {
    // URL overrides for testing/previewing lands:
    //   ?fresh=1            ignore the save this visit
    //   ?biome=frost        force a biome for a fresh start
    //   ?seed=12345         force a seed for a fresh start
    const params = new URLSearchParams(window.location.search);
    const save = params.has('fresh') ? null : SaveManager.load();
    GameState.initInventory(save?.inventory);

    // Which land are we on? A save pins it; otherwise roll a random one
    // (or honor the URL overrides). Same biome+seed => identical terrain.
    const urlBiome = params.get('biome');
    const biome =
      save?.world.biome ??
      (urlBiome && biomeDef(urlBiome) ? urlBiome : biomeIds()[Math.floor(Math.random() * biomeIds().length)]);
    const seed =
      save?.world.seed ?? (Number(params.get('seed')) || Math.floor(Math.random() * 2 ** 31));
    this.world = generateWorld(biome, seed);

    this.buildMap();
    this.pathfinder = new Pathfinder(this.mapW, this.mapH, (tx, ty) => this.isWalkable(tx, ty));

    // Restore a saved sanctuary, or populate the freshly generated land.
    if (save) {
      this.nextEntityId = save.nextEntityId;
      for (const n of save.nodes) this.spawnNode(n.type, n.tile[0], n.tile[1], n.id, n.amount);
      for (const d of save.decor) this.spawnDecor(d.type, d.tile[0], d.tile[1]);
      for (const c of save.creatures) {
        const cr = this.spawnCreature(c.species, c.name, c.tile[0], c.tile[1], c.id);
        if (!cr) continue;
        cr.counters = { ...c.counters };
        if (c.branch) cr.evolve(c.branch, true); // silent — no fanfare on load
        if (c.assignedNodeId !== null) {
          const node = this.nodes.find((n) => n.nodeId === c.assignedNodeId);
          if (node) cr.assignJob(node); // walks back to work after a refresh
        }
      }
    } else {
      // Node and spawn positions come from the generator (always reachable).
      for (const n of this.world.nodes) {
        this.spawnNode(n.type, n.tx, n.ty, this.nextEntityId++);
      }
      // On phones we spawn fewer creatures to keep mid-range devices smooth.
      let starters = creaturesConfig.startingCreatures;
      if (detectPhone()) starters = starters.slice(0, creaturesConfig.maxCreaturesMobile);
      starters.forEach((c, i) => {
        const s = this.world.spawns[i % this.world.spawns.length] ?? { tx: 10, ty: 10 };
        this.spawnCreature(c.species, c.name, s.tx, s.ty, this.nextEntityId++);
      });
    }

    // Tell the HUD which land this is (settings panel shows it), and greet
    // the player once the UI scene is up.
    const bdef = biomeDef(this.world.biomeId)!;
    this.registry.set('wk-world', { name: bdef.name, biome: this.world.biomeId, seed: this.world.seed });
    this.time.delayedCall(600, () =>
      gameEvents.emit('wk-toast', `🌍 ${bdef.name} — ${bdef.tagline}`),
    );

    this.setupCamera();
    this.setupEffects();
    this.setupTimersAndEvents();
    this.exposeDebugHook();
  }

  /**
   * Read-only debug hook for automated tests and devtools poking:
   * `__wildkinDebug()` in the browser console returns a plain-data snapshot
   * of where everything is (plus camera state, so tests can convert world
   * coordinates to screen pixels). It cannot mutate the game.
   */
  private exposeDebugHook(): void {
    (window as unknown as Record<string, unknown>).__wildkinDebug = () => ({
      camera: {
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
        zoom: this.cameras.main.zoom,
        width: this.cameras.main.width,
        height: this.cameras.main.height,
      },
      creatures: this.creatures.map((c) => ({
        id: c.creatureId,
        name: c.creatureName,
        x: c.x,
        y: c.y,
        tx: c.tx,
        ty: c.ty,
        state: c.state,
        stage: c.stage,
        branch: c.branch,
        counters: { ...c.counters },
      })),
      nodes: this.nodes.map((n) => ({
        id: n.nodeId,
        type: n.typeId,
        x: n.x,
        y: n.y,
        amount: n.amount,
      })),
    });
  }

  update(_time: number, dtMs: number): void {
    for (const c of this.creatures) c.update(dtMs);
    for (const n of this.nodes) n.tickRegen(dtMs / 1000);
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
        // Deterministic scatter of the darker '-b' shade breaks up big fields
        // of one terrain (same seed -> same scatter, so it's stable across loads).
        const alt = ((tx * 73856093) ^ (ty * 19349663) ^ this.world.seed) % 5 === 0;
        // Tiles never overlap entities, so push them far below in draw order.
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

  private spawnNode(typeId: string, tx: number, ty: number, id: number, amount?: number): void {
    const def = (nodesConfig.nodeTypes as Record<string, NodeTypeDef>)[typeId];
    if (!def || !this.inBounds(tx, ty)) return;
    const node = new ResourceNode(this, id, typeId, def, tx, ty, amount);
    this.nodes.push(node);
    this.occupied.add(`${tx},${ty}`);
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
  // Camera, effects, timers
  // ==========================================================================

  private setupCamera(): void {
    // World-pixel bounding box of the diamond-shaped map, plus breathing room.
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

    // Start centered on the middle of the map.
    const center = tileToWorld(this.mapW / 2, this.mapH / 2);
    this.cameras.main.centerOn(center.x, center.y);
    this.cameras.main.setZoom(detectPhone() ? 0.8 : 1.1);

    this.cameraCtl = new CameraController(this);
    this.cameraCtl.onTap = (wx, wy) => this.handleTap(wx, wy);
    this.cameraCtl.onHover = (wx, wy) => this.handleHover(wx, wy);
  }

  private setupEffects(): void {
    // Tile hover outline (desktop nicety; harmless on touch).
    this.hoverMarker = this.add.image(0, 0, 'tile-hover').setVisible(false).setDepth(200_000);
    // Build-mode ghost: shows where the item will land and whether it's valid.
    this.ghost = this.add.image(0, 0, 'ghost-ok').setVisible(false).setDepth(200_001);

    // One reusable particle emitter for everything (resonance sparkles,
    // evolution bursts, placement poofs) — tinted per effect.
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
    // Autosave every 10 seconds + when the tab is hidden/closed.
    this.time.addEvent({ delay: 10_000, loop: true, callback: () => this.saveNow() });
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    document.addEventListener('visibilitychange', this.beforeUnloadHandler);

    // Push fresh counter values to the HUD while a creature is selected.
    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        if (this.selected) gameEvents.emit('wk-selected-update', this.creatureSnapshot(this.selected));
      },
    });

    // The Build menu (UIScene) tells us what the player wants to place.
    gameEvents.on('wk-build-changed', this.onBuildChanged, this);

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      document.removeEventListener('visibilitychange', this.beforeUnloadHandler);
      gameEvents.off('wk-build-changed', this.onBuildChanged, this);
    });
  }

  private onBuildChanged(item: BuildItem | null): void {
    this.buildSelection = item;
    if (!item) this.ghost.setVisible(false);
  }

  // ==========================================================================
  // Tap & hover handling (both mouse and touch arrive here, already unified
  // by CameraController)
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
      const ok = this.canPlaceAt(tx, ty);
      this.ghost.setTexture(ok ? 'ghost-ok' : 'ghost-bad');
      this.ghost.setPosition(pos.x, pos.y).setVisible(true);
      this.hoverMarker.setVisible(false);
    } else {
      this.hoverMarker.setPosition(pos.x, pos.y).setVisible(true);
    }
  }

  private handleTap(wx: number, wy: number): void {
    // 1) Build mode takes priority: taps place the selected item.
    if (this.buildSelection) {
      this.tryPlace(this.buildSelection, worldToTile(wx, wy));
      return;
    }

    // 2) Tap on a creature? (nearest body within a finger-friendly radius)
    const creature = this.pickCreature(wx, wy);
    if (creature) {
      if (creature === this.selected) {
        this.select(null); // tapping the selected creature again deselects
      } else {
        this.select(creature);
      }
      return;
    }

    // 3) Tap on a resource node?
    const node = this.pickNode(wx, wy);
    if (node) {
      if (this.selected) {
        // Assign the selected creature to work this node.
        if (this.selected.assignJob(node)) {
          gameEvents.emit('wk-toast', `${this.selected.creatureName} → ${node.def.name}`);
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
    const t = worldToTile(wx, wy);
    if (this.selected && this.isWalkable(t.tx, t.ty)) {
      if (this.selected.moveToTile(t)) {
        gameEvents.emit('wk-toast', `${this.selected.creatureName} is heading over`);
      }
      return;
    }

    // 5) Tap on nothing useful (water, off-map): deselect.
    this.select(null);
  }

  /** Find the creature whose body is closest to the tap, within ~a finger's width. */
  private pickCreature(wx: number, wy: number): Creature | null {
    let best: Creature | null = null;
    let bestDist = 30; // world px — generous for touch
    for (const c of this.creatures) {
      const d = Phaser.Math.Distance.Between(wx, wy, c.x, c.y - 12);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /** Find a tapped node — matches either its tile or its sprite (which pokes up above the tile). */
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

  /** Plain-data view of a creature for the HUD (UIScene never touches game objects). */
  private creatureSnapshot(c: Creature) {
    const branches = evolutionConfig.branches as Record<string, EvolutionBranchDef>;
    return {
      name: c.creatureName,
      speciesName: c.def.name,
      flavor: c.def.flavor,
      stage: c.stage,
      branchName: c.branch ? branches[c.branch].name : null,
      state: c.state,
      counters: { ...c.counters },
      threshold: evolutionConfig.threshold,
    };
  }

  // ==========================================================================
  // Build mode
  // ==========================================================================

  private canPlaceAt(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.tiles[ty][tx].buildable && !this.occupied.has(`${tx},${ty}`);
  }

  private tryPlace(item: BuildItem, t: TileCoord): void {
    if (!this.canPlaceAt(t.tx, t.ty)) {
      gameEvents.emit('wk-toast', 'Can’t place there — needs open grass or dirt');
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

    // Placement poof + save right away (placements are precious).
    const pos = tileToWorld(t.tx, t.ty);
    this.fx.particleTint = 0xffffff;
    this.fx.explode(perfCaps().sparkleParticles * 2, pos.x, pos.y - 10);
    this.saveNow();
    // Build mode stays active so you can place several items in a row;
    // the ✕ button in the Build menu exits it.
  }

  // ==========================================================================
  // CreatureWorld implementation — services the creatures call back into
  // ==========================================================================

  pathTo(start: TileCoord, goal: TileCoord): TileCoord[] {
    return this.pathfinder.findPath(start, goal);
  }

  pathToAdjacent(start: TileCoord, target: TileCoord): TileCoord[] | null {
    return this.pathfinder.findPathAdjacent(start, target);
  }

  randomWanderTarget(from: TileCoord, radius: number): TileCoord | null {
    // A few random tries is plenty on a mostly-walkable map.
    for (let i = 0; i < 8; i++) {
      const tx = from.tx + Phaser.Math.Between(-radius, radius);
      const ty = from.ty + Phaser.Math.Between(-radius, radius);
      if ((tx !== from.tx || ty !== from.ty) && this.isWalkable(tx, ty)) return { tx, ty };
    }
    return null;
  }

  isDecorNear(tx: number, ty: number, range: number): boolean {
    return this.decorItems.some((d) => tileDistance(d.tx, d.ty, tx, ty) <= range);
  }

  /**
   * One harvest tick: pull from the node, apply resonance (CORE HOOK #1),
   * bank the yield into the global inventory, and show feedback.
   */
  workTick(creature: Creature, node: ResourceNode): number {
    const taken = node.harvest();
    if (taken <= 0) return 0; // node is tapped out; it regenerates over time

    const decorPlacements: DecorPlacement[] = this.decorItems.map((d) => ({
      type: d.typeId,
      tx: d.tx,
      ty: d.ty,
    }));
    const res = checkResonance(
      creature.speciesId,
      node.typeId,
      creature.tx,
      creature.ty,
      decorPlacements,
      creature.stats.resonanceBonus,
    );

    // Fractions (e.g. x1.5) accumulate across ticks so nothing is lost.
    const gained = creature.bankYield(taken * res.multiplier);
    if (gained > 0) {
      GameState.addResource(node.def.resource, gained);
      this.floatText(creature.x, creature.y - 40, `+${gained}`, node.def.color);
    }

    if (res.recipe) {
      // Resonance active: sparkles every tick, name callout the first time.
      this.fx.particleTint = Phaser.Display.Color.HexStringToColor(res.recipe.particleColor).color;
      this.fx.explode(perfCaps().sparkleParticles, creature.x, creature.y - 20);
      const onceKey = `${creature.creatureId}:${res.recipe.id}`;
      if (!this.resonanceAnnounced.has(onceKey)) {
        this.resonanceAnnounced.add(onceKey);
        this.floatText(creature.x, creature.y - 60, `✨ ${res.recipe.label}! x${res.multiplier}`, res.recipe.particleColor);
        gameEvents.emit('wk-toast', `Resonance: ${res.recipe.label} (x${res.multiplier} ${node.def.resource})`);
      }
    }

    return taken;
  }

  /** Evolution fanfare (CORE HOOK #2): burst, flash, toast. */
  onEvolve(creature: Creature, branch: EvolutionBranchDef): void {
    this.fx.particleTint = Phaser.Display.Color.HexStringToColor(branch.color).color;
    this.fx.explode(perfCaps().burstParticles, creature.x, creature.y - 20);
    this.cameras.main.flash(180, 255, 255, 255);
    this.floatText(creature.x, creature.y - 70, `✨ ${creature.creatureName} evolved!`, branch.color);
    gameEvents.emit('wk-evolved', {
      name: creature.creatureName,
      formName: branch.name,
      description: branch.description,
    });
    if (this.selected === creature) {
      gameEvents.emit('wk-selected', this.creatureSnapshot(creature));
    }
    this.saveNow(); // an evolution is a milestone — never lose one to a crash
  }

  /** Small rising text used for +1s, resonance callouts and evolutions. */
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
    SaveManager.save({
      world: { biome: this.world.biomeId, seed: this.world.seed },
      inventory: { ...GameState.inventory },
      creatures: this.creatures.map((c) => ({
        id: c.creatureId,
        species: c.speciesId,
        name: c.creatureName,
        tile: [c.tx, c.ty] as [number, number],
        stage: c.stage,
        branch: c.branch,
        counters: { ...c.counters },
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
}
