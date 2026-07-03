/**
 * Shared TypeScript types for Wildkin.
 *
 * These mirror the shapes of the JSON config files in src/config/. If you add
 * fields to a config file, add them here too so the compiler can check your
 * code against the data.
 */

/** A tile coordinate on the grid. `tx` is the column, `ty` is the row. */
export interface TileCoord {
  tx: number;
  ty: number;
}

/** One tile type from map.json (grass, dirt, water, path…). */
export interface TileTypeDef {
  id: string;
  name: string;
  color: string;
  edgeColor: string;
  walkable: boolean;
  buildable: boolean;
}

/** One creature species from creatures.json. */
export interface SpeciesDef {
  name: string;
  shape: string; // 'circle' | 'square' | 'triangle' | 'diamond' | 'star'
  color: string;
  size: number;
  speed: number; // walk speed in pixels/second
  wanderRadius: number; // how far it roams while idle, in tiles
  flavor: string;
}

/** One resource kind from nodes.json (wood, stone, herbs…). */
export interface ResourceDef {
  id: string;
  name: string;
  color: string;
  icon: string;
}

/** One resource node type from nodes.json (tree, rock, flower…). */
export interface NodeTypeDef {
  name: string;
  resource: string;
  capacity: number;
  regenPerSecond: number;
  workIntervalMs: number;
  yieldPerTick: number;
  activity: string; // which creature activity counter working here feeds
  color: string;
  trunkColor: string;
  buildable: boolean;
  cost: Record<string, number>;
}

/** One decor item from decor.json. */
export interface DecorDef {
  name: string;
  shape: string;
  color: string;
  size: number;
  cost: Record<string, number>;
}

/** One resonance recipe from resonance.json. */
export interface ResonanceRecipe {
  id: string;
  label: string;
  species: string; // species id or 'any'
  nodeType: string;
  decor: string;
  range: number; // in tiles (Chebyshev distance)
  multiplier: number;
  particleColor: string;
}

/** One evolution branch from evolution.json. */
export interface EvolutionBranchDef {
  id: string;
  name: string;
  description: string;
  shape: string;
  color: string;
  sizeMult: number;
  stats: {
    workSpeedMult: number;
    moveSpeedMult: number;
    resonanceBonus: number;
  };
}

/** The three activity counters every creature tracks (CORE HOOK #2). */
export interface ActivityCounters {
  mining: number;
  exploring: number;
  sanctuary: number;
}

/** An entry in the Build menu (either a decor item or a buildable node). */
export interface BuildItem {
  kind: 'decor' | 'node';
  id: string;
  name: string;
  cost: Record<string, number>;
  color: string;
}

/** Serialized creature state, as stored in localStorage. */
export interface SavedCreature {
  id: number;
  species: string;
  name: string;
  tile: [number, number];
  stage: number;
  branch: string | null;
  counters: ActivityCounters;
  assignedNodeId: number | null;
}

/** Serialized node state. */
export interface SavedNode {
  id: number;
  type: string;
  tile: [number, number];
  amount: number;
}

/** Serialized decor state. */
export interface SavedDecor {
  type: string;
  tile: [number, number];
}

/** The whole save file. */
export interface SaveData {
  version: number;
  inventory: Record<string, number>;
  creatures: SavedCreature[];
  nodes: SavedNode[];
  decor: SavedDecor[];
  nextEntityId: number;
}
