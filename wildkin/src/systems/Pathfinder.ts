import type { TileCoord } from '../types';

/**
 * Simple breadth-first-search pathfinding on the tile grid.
 *
 * BFS is plenty for a 20x20 map: it always finds the shortest path (in steps)
 * and runs in well under a millisecond. Creatures move in 4 directions
 * (no diagonals) which looks natural on an isometric grid.
 *
 * `isWalkable(tx, ty)` is supplied by the WorldScene and accounts for both
 * tile type (water blocks) and occupancy (nodes/decor block).
 */
export class Pathfinder {
  constructor(
    private width: number,
    private height: number,
    private isWalkable: (tx: number, ty: number) => boolean,
  ) {}

  private key(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  /**
   * Run BFS from `start` and return the visited map (tile -> previous tile),
   * used internally by both public methods.
   */
  private bfs(start: TileCoord): Map<number, number> {
    const prev = new Map<number, number>();
    prev.set(this.key(start.tx, start.ty), -1);
    const queue: TileCoord[] = [start];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const [dx, dy] of dirs) {
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
        const k = this.key(nx, ny);
        if (prev.has(k)) continue;
        if (!this.isWalkable(nx, ny)) continue;
        prev.set(k, this.key(cur.tx, cur.ty));
        queue.push({ tx: nx, ty: ny });
      }
    }
    return prev;
  }

  /** Rebuild the path list by walking the `prev` chain backwards from `goal`. Excludes the start tile. */
  private reconstruct(prev: Map<number, number>, goal: TileCoord): TileCoord[] {
    const path: TileCoord[] = [];
    let k = this.key(goal.tx, goal.ty);
    if (!prev.has(k)) return []; // unreachable
    while (prev.get(k) !== -1) {
      path.push({ tx: k % this.width, ty: Math.floor(k / this.width) });
      k = prev.get(k)!;
    }
    path.reverse();
    return path;
  }

  /** Shortest path from start to goal. Empty array if unreachable (or already there). */
  findPath(start: TileCoord, goal: TileCoord): TileCoord[] {
    if (start.tx === goal.tx && start.ty === goal.ty) return [];
    const prev = this.bfs(start);
    return this.reconstruct(prev, goal);
  }

  /**
   * Path to the closest walkable tile ADJACENT to `target` — used when a
   * creature is sent to work a resource node (the node's own tile is blocked,
   * the creature stands beside it). Returns null if no side is reachable.
   */
  findPathAdjacent(start: TileCoord, target: TileCoord): TileCoord[] | null {
    const prev = this.bfs(start);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let best: TileCoord | null = null;
    let bestLen = Infinity;
    for (const [dx, dy] of dirs) {
      const nx = target.tx + dx;
      const ny = target.ty + dy;
      if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
      // Already standing next to the node? Then there's nothing to walk.
      if (nx === start.tx && ny === start.ty) return [];
      if (!prev.has(this.key(nx, ny))) continue; // not reachable
      const len = this.reconstruct(prev, { tx: nx, ty: ny }).length;
      if (len < bestLen) {
        bestLen = len;
        best = { tx: nx, ty: ny };
      }
    }
    return best ? this.reconstruct(prev, best) : null;
  }
}
