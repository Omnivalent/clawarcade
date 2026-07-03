import Phaser from 'phaser';
import creaturesConfig from '../config/creatures.json';
import decorConfig from '../config/decor.json';
import evolutionConfig from '../config/evolution.json';
import mapConfig from '../config/map.json';
import { TILE_H, TILE_W } from '../core/iso';
import type { DecorDef, EvolutionBranchDef, NodeTypeDef, SpeciesDef, TileTypeDef } from '../types';
import nodesConfig from '../config/nodes.json';

/**
 * BootScene runs once at startup. Because all art is placeholder for now,
 * there is nothing to download — instead we DRAW every texture with the
 * Graphics API, straight from the config files:
 *
 *   tile-grass, tile-dirt, …          map tiles (colored diamonds)
 *   cr-glimmer, cr-thorn, …           stage-1 creatures (colored shapes)
 *   cr-glimmer-mining, …              stage-2 evolved forms (species x branch)
 *   node-tree, node-rock, …           resource nodes
 *   decor-crystal, decor-lantern, …   decor items
 *   particle, tile-hover, ghost-*     effects & UI helpers
 *
 * When real art lands later, this scene becomes a normal asset loader and the
 * texture keys stay the same — nothing else in the game needs to change.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.makeTileTextures();
    this.makeCreatureTextures();
    this.makeNodeTextures();
    this.makeDecorTextures();
    this.makeEffectTextures();

    // Hide the HTML "loading" message now that we're ready to render.
    document.getElementById('loading')?.remove();

    // WorldScene = the sanctuary; UIScene = the HUD layered on top of it.
    this.scene.start('WorldScene');
    this.scene.launch('UIScene');
  }

  // --------------------------------------------------------------------------
  // Tiles: the classic isometric diamond, one texture per tile type.
  // --------------------------------------------------------------------------
  private makeTileTextures(): void {
    const g = this.add.graphics();
    const types = mapConfig.tileTypes as Record<string, TileTypeDef>;

    for (const def of Object.values(types)) {
      g.clear();
      const fill = Phaser.Display.Color.HexStringToColor(def.color).color;
      const edge = Phaser.Display.Color.HexStringToColor(def.edgeColor).color;
      g.fillStyle(fill, 1);
      g.lineStyle(1.5, edge, 1);
      this.diamondPath(g, TILE_W / 2, TILE_H / 2, TILE_W, TILE_H);
      g.fillPath();
      g.strokePath();
      g.generateTexture(`tile-${def.id}`, TILE_W, TILE_H);
    }

    // Hover highlight: just the outline.
    g.clear();
    g.lineStyle(2, 0xffffff, 0.85);
    this.diamondPath(g, TILE_W / 2, TILE_H / 2, TILE_W - 4, TILE_H - 2);
    g.strokePath();
    g.generateTexture('tile-hover', TILE_W, TILE_H);

    // Build-mode ghost overlays (valid = green, invalid = red).
    for (const [key, color] of [
      ['ghost-ok', 0x4ade80],
      ['ghost-bad', 0xef4444],
    ] as const) {
      g.clear();
      g.fillStyle(color, 0.4);
      this.diamondPath(g, TILE_W / 2, TILE_H / 2, TILE_W, TILE_H);
      g.fillPath();
      g.generateTexture(key, TILE_W, TILE_H);
    }

    g.destroy();
  }

  /** Trace a diamond (isometric tile) path centered at (cx, cy). */
  private diamondPath(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number): void {
    g.beginPath();
    g.moveTo(cx, cy - h / 2);
    g.lineTo(cx + w / 2, cy);
    g.lineTo(cx, cy + h / 2);
    g.lineTo(cx - w / 2, cy);
    g.closePath();
  }

  // --------------------------------------------------------------------------
  // Creatures: one texture per species (stage 1), plus one per
  // species x evolution-branch (stage 2). Stage-2 forms use the BRANCH's shape
  // and color but keep an outline in the species color, so an evolved Pip is
  // still recognizably Pip.
  // --------------------------------------------------------------------------
  private makeCreatureTextures(): void {
    const species = creaturesConfig.species as Record<string, SpeciesDef>;
    const branches = evolutionConfig.branches as Record<string, EvolutionBranchDef>;

    for (const [spId, sp] of Object.entries(species)) {
      const spColor = Phaser.Display.Color.HexStringToColor(sp.color).color;

      // Stage 1: the species' own shape and color.
      this.shapeTexture(`cr-${spId}`, sp.shape, sp.size, spColor, 0x10201c);

      // Stage 2: one variant per branch.
      for (const [brKey, br] of Object.entries(branches)) {
        const brColor = Phaser.Display.Color.HexStringToColor(br.color).color;
        this.shapeTexture(
          `cr-${spId}-${brKey}`,
          br.shape,
          Math.round(sp.size * br.sizeMult),
          brColor,
          spColor, // species-colored outline preserves identity
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // Resource nodes: slightly composed placeholder drawings.
  // --------------------------------------------------------------------------
  private makeNodeTextures(): void {
    const types = nodesConfig.nodeTypes as Record<string, NodeTypeDef>;
    const g = this.add.graphics();

    for (const [id, def] of Object.entries(types)) {
      g.clear();
      const main = Phaser.Display.Color.HexStringToColor(def.color).color;
      const trunk = Phaser.Display.Color.HexStringToColor(def.trunkColor).color;
      const W = 48;
      const H = 52;

      if (id === 'tree') {
        // Trunk + triangular canopy.
        g.fillStyle(trunk, 1);
        g.fillRect(W / 2 - 4, H - 16, 8, 16);
        g.fillStyle(main, 1);
        g.fillTriangle(W / 2, 2, W / 2 - 18, H - 14, W / 2 + 18, H - 14);
      } else if (id === 'rock') {
        // Chunky boulder.
        g.fillStyle(trunk, 1);
        g.fillEllipse(W / 2, H - 10, 40, 16);
        g.fillStyle(main, 1);
        g.fillEllipse(W / 2, H - 22, 34, 28);
      } else {
        // Flower (and any future node type falls back to this look):
        // stem + round bloom in the node's color.
        g.fillStyle(trunk, 1);
        g.fillRect(W / 2 - 2, H - 20, 4, 20);
        g.fillStyle(main, 1);
        g.fillCircle(W / 2, H - 28, 12);
        g.fillStyle(0xffffff, 0.85);
        g.fillCircle(W / 2, H - 28, 4);
      }

      g.generateTexture(`node-${id}`, W, H);
    }
    g.destroy();
  }

  // --------------------------------------------------------------------------
  // Decor: single shapes with a soft white outline (feels "placed"/crafted).
  // --------------------------------------------------------------------------
  private makeDecorTextures(): void {
    const items = decorConfig.items as Record<string, DecorDef>;
    for (const [id, def] of Object.entries(items)) {
      const color = Phaser.Display.Color.HexStringToColor(def.color).color;
      this.shapeTexture(`decor-${id}`, def.shape, def.size, color, 0xffffff);
    }
  }

  // --------------------------------------------------------------------------
  // Effects: a tiny white dot, tinted at emit time for every particle effect.
  // --------------------------------------------------------------------------
  private makeEffectTextures(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('particle', 8, 8);
    g.destroy();
  }

  /**
   * Draw one of the placeholder shapes ('circle' | 'square' | 'triangle' |
   * 'diamond' | 'star') into its own texture. Used for creatures and decor.
   */
  private shapeTexture(key: string, shape: string, size: number, fill: number, stroke: number): void {
    const g = this.add.graphics();
    const pad = 4;
    const S = size + pad * 2;
    const c = S / 2;
    const r = size / 2;
    g.fillStyle(fill, 1);
    g.lineStyle(2.5, stroke, 1);

    switch (shape) {
      case 'square':
        g.fillRect(c - r, c - r, size, size);
        g.strokeRect(c - r, c - r, size, size);
        break;
      case 'triangle':
        g.fillTriangle(c, c - r, c - r, c + r, c + r, c + r);
        g.strokeTriangle(c, c - r, c - r, c + r, c + r, c + r);
        break;
      case 'diamond': {
        g.beginPath();
        g.moveTo(c, c - r);
        g.lineTo(c + r * 0.7, c);
        g.lineTo(c, c + r);
        g.lineTo(c - r * 0.7, c);
        g.closePath();
        g.fillPath();
        g.strokePath();
        break;
      }
      case 'star': {
        // Classic 5-point star from alternating outer/inner radius points.
        const pts: Phaser.Types.Math.Vector2Like[] = [];
        for (let i = 0; i < 10; i++) {
          const rad = i % 2 === 0 ? r : r * 0.45;
          const ang = -Math.PI / 2 + (i * Math.PI) / 5;
          pts.push({ x: c + Math.cos(ang) * rad, y: c + Math.sin(ang) * rad });
        }
        g.fillPoints(pts, true);
        g.strokePoints(pts, true);
        break;
      }
      case 'circle':
      default:
        g.fillCircle(c, c, r);
        g.strokeCircle(c, c, r);
        break;
    }

    g.generateTexture(key, S, S);
    g.destroy();
  }
}
