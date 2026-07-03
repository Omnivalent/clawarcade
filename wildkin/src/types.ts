/**
 * Shared TypeScript types for Wildkin (Build Pass 2 — fused resonance-evolution).
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

/** One tile type from the biomes.json registry (grass, sand, snow, murk…). */
export interface TileTypeDef {
  id: string;
  name: string;
  color: string;
  edgeColor: string;
  walkable: boolean;
  buildable: boolean;
}

/** One biome from biomes.json — a landscape "recipe". */
export interface BiomeDef {
  name: string;
  tagline: string;
  tiles: { base: string; patch: string; liquid: string; trail: string };
  gen: {
    liquidBodies: number;
    liquidSize: [number, number] | number[];
    patches: number;
    patchSize: [number, number] | number[];
    trails: number;
  };
  nodes: Record<string, number>;
}

/** The output of MapGenerator: a fully generated landscape. */
export interface GeneratedWorld {
  biomeId: string;
  seed: number;
  size: number;
  layout: string[][]; // [row][col] -> tile type id
  nodes: { type: string; tx: number; ty: number }[];
  spawns: TileCoord[];
}

/**
 * One base creature species from creatures.json.
 * `branches` are its two possible evolution paths (keys into
 * evolutionForms.json); `affinityThreshold` is how much branch affinity
 * triggers evolution in normal play.
 */
export interface SpeciesDef {
  name: string;
  shape: string; // 'circle' | 'square' | 'triangle' | 'diamond' | 'star'
  color: string;
  size: number;
  speed: number; // walk speed in pixels/second
  wanderRadius: number; // idle roaming range, in tiles
  flavor: string;
  branches: string[]; // exactly two branch ids
  affinityThreshold: number;
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
  activity: string;
  color: string;
  trunkColor: string;
  buildable: boolean;
  cost: Record<string, number>;
}

/** One decor item from decor.json. `branchId` is the evolution branch this decor channels — the heart of player steering. */
export interface DecorDef {
  name: string;
  shape: string;
  color: string;
  size: number;
  cost: Record<string, number>;
  branchId: string;
}

/**
 * One fused resonance recipe from resonanceRecipes.json:
 * base creature + nearby decor → production multiplier NOW, branch affinity
 * for LATER. Resonance is the verb; evolution is the outcome.
 */
export interface ResonanceRecipe {
  creatureBase: string;
  adjacentDecor: string;
  range: number; // Chebyshev tiles between worker and decor
  productionMultiplier: number;
  affinityPerTick: number;
  branchId: string;
  particleColor: string;
}

/** One evolved form (common or rare) from evolutionForms.json. */
export interface EvolvedFormDef {
  id: string;
  name: string;
  shape: string;
  color: string;
  sizeMult: number;
  stats: { workSpeedMult: number; moveSpeedMult: number };
}

/** One evolution branch: which base it belongs to, its two forms, the rare roll. */
export interface BranchDef {
  name: string;
  base: string;
  color: string;
  rareChance: number;
  common: EvolvedFormDef;
  rare: EvolvedFormDef;
}

/** An entry in the Build menu (either a decor item or a buildable node). */
export interface BuildItem {
  kind: 'decor' | 'node';
  id: string;
  name: string;
  cost: Record<string, number>;
  color: string;
}

/** Today's rotating boost, resolved from dailyModifier.json + the date. */
export interface DailyBoost {
  branchId: string;
  branchName: string;
  multiplier: number;
  bannerText: string;
}

/** Payload for the evolution celebration modal. */
export interface EvolutionEvent {
  creatureName: string;
  baseSpeciesId: string;
  baseSpeciesName: string;
  branchId: string;
  form: EvolvedFormDef;
  isRare: boolean;
}

/** Serialized creature state, as stored in localStorage. */
export interface SavedCreature {
  id: number;
  species: string;
  name: string;
  tile: [number, number];
  stage: number;
  formId: string | null; // evolved form id once evolved
  formRare: boolean;
  affinities: Record<string, number>; // branchId -> accumulated affinity
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
  /** Which landscape this sanctuary lives on — biome + seed fully determine the terrain, so we regenerate it identically on load. */
  world: { biome: string; seed: number };
  inventory: Record<string, number>;
  creatures: SavedCreature[];
  nodes: SavedNode[];
  decor: SavedDecor[];
  nextEntityId: number;
}
