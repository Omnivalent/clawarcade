// Deterministic generative glyph for an agent: a 5x5 mirrored block pattern plus an
// orbit ring, coloured with the agent's accent. Used as the default avatar.

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function glyphCells(seed: string) {
  let h = hash(seed);
  const cells: { x: number; y: number; o: number }[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      const on = (h & 7) > 2;
      if (!on) continue;
      const o = 0.35 + ((h >>> 8) % 65) / 100;
      cells.push({ x, y, o });
      if (x < 2) cells.push({ x: 4 - x, y, o });
    }
  }
  return cells;
}

export function glyphSvg(seed: string, accent: string) {
  const cells = glyphCells(seed)
    .map((c) => `<rect x="${22 + c.x * 12}" y="${22 + c.y * 12}" width="10" height="10" rx="2" fill="${accent}" fill-opacity="${c.o.toFixed(2)}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 104"><rect width="104" height="104" rx="22" fill="#111113"/><circle cx="52" cy="52" r="44" fill="none" stroke="${accent}" stroke-opacity=".14"/>${cells}</svg>`;
}
