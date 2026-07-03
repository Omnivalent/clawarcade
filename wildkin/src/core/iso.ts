/**
 * Isometric math helpers.
 *
 * The world is a plain square grid (20x20 tiles), but it's DRAWN rotated 45°
 * and squashed — the classic "diamond" isometric look. These two functions
 * convert between grid coordinates (tile column/row) and world pixel
 * coordinates (where things are drawn on screen before camera transform).
 *
 * Tile (0,0) sits at world (0,0); columns extend down-right, rows down-left.
 */

/** On-screen width of one tile diamond, in pixels. */
export const TILE_W = 64;
/** On-screen height of one tile diamond, in pixels (half of width = 2:1 iso). */
export const TILE_H = 32;

/** Convert a tile coordinate to the world-pixel CENTER of that tile diamond. */
export function tileToWorld(tx: number, ty: number): { x: number; y: number } {
  return {
    x: (tx - ty) * (TILE_W / 2),
    y: (tx + ty) * (TILE_H / 2),
  };
}

/**
 * Convert a world-pixel position back to the tile under it.
 * This is the inverse of tileToWorld — used to figure out which tile the
 * player clicked/tapped.
 */
export function worldToTile(wx: number, wy: number): { tx: number; ty: number } {
  const fx = (wy / (TILE_H / 2) + wx / (TILE_W / 2)) / 2;
  const fy = (wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2;
  return { tx: Math.round(fx), ty: Math.round(fy) };
}

/** Chebyshev (chessboard) distance between two tiles — used for "adjacent within N tiles" checks like resonance range. */
export function tileDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
