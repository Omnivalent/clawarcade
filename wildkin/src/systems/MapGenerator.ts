import biomesConfig from '../config/biomes.json';
import type { BiomeDef, GeneratedWorld, TileCoord, TileTypeDef } from '../types';

/**
 * Procedural landscape generation.
 *
 * Every sanctuary is generated from (biomeId, seed) — the same pair always
 * produces the exact same land, which is how a save can restore the world by
 * storing just those two numbers. A fresh game rolls a random biome + seed,
 * so no two sanctuaries look alike.
 *
 * The algorithm is deliberately simple and readable:
 *   1. Fill the map with the biome's base ground.
 *   2. Grow a few organic "blobs" of liquid (ponds / oasis / murk pools).
 *   3. Grow a few blobs of patch terrain (dirt / clay / ice / mud).
 *   4. Carve wandering trails across the land.
 *   5. Keep the center clear (that's where creatures start).
 *   6. Flood-fill from the center to find every REACHABLE tile, then place
 *      resource nodes and creature spawn points only on reachable ground —
 *      so nothing ever spawns cut off behind water.
 */

const TILE_TYPES = biomesConfig.tileTypes as Record<string, TileTypeDef>;
const BIOMES = biomesConfig.biomes as Record<string, BiomeDef>;
const SIZE = biomesConfig.mapSize;

/** All biome ids, for rolling a random one. */
export function biomeIds(): string[] {
  return Object.keys(BIOMES);
}

export function biomeDef(id: string): BiomeDef | undefined {
  return BIOMES[id];
}

export function tileTypeDef(id: string): TileTypeDef {
  return TILE_TYPES[id];
}

/**
 * Tiny deterministic random number generator (mulberry32). Math.random can't
 * be replayed, but this can: same seed -> same sequence -> same landscape.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateWorld(biomeId: string, seed: number): GeneratedWorld {
  const biome = BIOMES[biomeId] ?? BIOMES[biomeIds()[0]];
  const rng = mulberry32(seed);
  const randInt = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

  // 1) All base ground.
  const layout: string[][] = [];
  for (let y = 0; y < SIZE; y++) layout.push(new Array(SIZE).fill(biome.tiles.base));

  const center = Math.floor(SIZE / 2);

  /** Grow an organic blob of `tile`, starting near (but not on) the center area. */
  const growBlob = (tile: string, size: number) => {
    // Pick a start point away from the creature spawn area in the middle.
    let sx = 0;
    let sy = 0;
    for (let tries = 0; tries < 50; tries++) {
      sx = randInt(1, SIZE - 2);
      sy = randInt(1, SIZE - 2);
      if (Math.max(Math.abs(sx - center), Math.abs(sy - center)) > 4) break;
    }
    // Random-frontier growth gives natural, lumpy shapes.
    const frontier: TileCoord[] = [{ tx: sx, ty: sy }];
    const placed = new Set<string>();
    while (placed.size < size && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const cell = frontier.splice(idx, 1)[0];
      const key = `${cell.tx},${cell.ty}`;
      if (placed.has(key)) continue;
      if (cell.tx < 1 || cell.ty < 1 || cell.tx >= SIZE - 1 || cell.ty >= SIZE - 1) continue;
      placed.add(key);
      layout[cell.ty][cell.tx] = tile;
      frontier.push(
        { tx: cell.tx + 1, ty: cell.ty },
        { tx: cell.tx - 1, ty: cell.ty },
        { tx: cell.tx, ty: cell.ty + 1 },
        { tx: cell.tx, ty: cell.ty - 1 },
      );
    }
  };

  // 2) Liquid pools, 3) terrain patches.
  for (let i = 0; i < biome.gen.liquidBodies; i++) {
    growBlob(biome.tiles.liquid, randInt(biome.gen.liquidSize[0], biome.gen.liquidSize[1]));
  }
  for (let i = 0; i < biome.gen.patches; i++) {
    growBlob(biome.tiles.patch, randInt(biome.gen.patchSize[0], biome.gen.patchSize[1]));
  }

  // 4) Trails: wandering lines across the map (never through liquid — trails
  // politely stop at the shore). Alternate vertical / horizontal.
  for (let i = 0; i < biome.gen.trails; i++) {
    const vertical = i % 2 === 0;
    let pos = randInt(3, SIZE - 4); // the wandering coordinate
    for (let j = 0; j < SIZE; j++) {
      const tx = vertical ? pos : j;
      const ty = vertical ? j : pos;
      if (layout[ty][tx] !== biome.tiles.liquid) layout[ty][tx] = biome.tiles.trail;
      pos = Math.max(1, Math.min(SIZE - 2, pos + randInt(-1, 1)));
    }
  }

  // 5) Keep a clear 3x3 of base ground at the center — guaranteed spawn area.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) layout[center + dy][center + dx] = biome.tiles.base;
  }

  // 6) Flood-fill from center over walkable tiles -> the reachable region.
  const walkable = (tx: number, ty: number) =>
    tx >= 0 && ty >= 0 && tx < SIZE && ty < SIZE && TILE_TYPES[layout[ty][tx]].walkable;
  const reachable: TileCoord[] = [];
  const seen = new Set<string>([`${center},${center}`]);
  const queue: TileCoord[] = [{ tx: center, ty: center }];
  while (queue.length > 0) {
    const c = queue.shift()!;
    reachable.push(c);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = c.tx + dx;
      const ny = c.ty + dy;
      if (!seen.has(`${nx},${ny}`) && walkable(nx, ny)) {
        seen.add(`${nx},${ny}`);
        queue.push({ tx: nx, ty: ny });
      }
    }
  }

  // Place resource nodes on reachable, buildable ground, spaced apart and
  // away from the spawn area.
  const nodes: { type: string; tx: number; ty: number }[] = [];
  const nodeOk = (t: TileCoord) =>
    TILE_TYPES[layout[t.ty][t.tx]].buildable &&
    Math.max(Math.abs(t.tx - center), Math.abs(t.ty - center)) >= 3 &&
    nodes.every((n) => Math.max(Math.abs(n.tx - t.tx), Math.abs(n.ty - t.ty)) >= 2);
  for (const [type, count] of Object.entries(biome.nodes)) {
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const t = reachable[Math.floor(rng() * reachable.length)];
        if (nodeOk(t)) {
          nodes.push({ type, tx: t.tx, ty: t.ty });
          break;
        }
      }
    }
  }

  // Creature spawn points: reachable tiles close to the center, spread out.
  const nearCenter = reachable
    .filter((t) => Math.max(Math.abs(t.tx - center), Math.abs(t.ty - center)) <= 5)
    .filter((t) => !nodes.some((n) => n.tx === t.tx && n.ty === t.ty));
  const spawns: TileCoord[] = [];
  for (let i = 0; i < 8 && nearCenter.length > 0; i++) {
    const idx = Math.floor(rng() * nearCenter.length);
    spawns.push(nearCenter.splice(idx, 1)[0]);
  }

  return { biomeId, seed, size: SIZE, layout, nodes, spawns };
}
