# 🌿 Wildkin — Creature Sanctuary (vertical slice)

A browser-based isometric creature-sanctuary game. **Creatures evolve based on
how you raise and use them** — work them hard and they become sturdy Forgekin,
let them roam and they become swift Swiftkin, let them rest among your decor
and they bloom into serene Bloomkin.

This is the **world & core systems pass**: all creatures and art are
placeholder shapes, designed to be swapped for real art later without touching
game logic.

---

## ▶️ How to run it

You need [Node.js](https://nodejs.org) installed (any recent version). Then,
in this folder (`wildkin/`):

```bash
npm install     # one time only — downloads the game engine
npm run dev     # starts the game
```

Vite prints a link like `http://localhost:5173` — open it in your browser.
It also prints a **Network** link — open that one on your phone (same Wi-Fi)
to play the mobile version.

To make a production build (static files you can host anywhere):

```bash
npm run build   # output lands in wildkin/dist/
```

## 🎮 How to play

| Action | Desktop | Phone |
|---|---|---|
| Pan the camera | Click + drag | One-finger drag |
| Zoom | Scroll wheel | Pinch |
| Select a creature | Click it | Tap it |
| Assign work | Select creature, then click a tree/rock/flower | Same, with taps |
| Move a creature | Select it, then click open ground | Same |
| Deselect | Click the creature again (or water) | Same |
| Build decor | 🔨 Build → pick item → click a grass/dirt tile | Same |

- Working creatures deposit **wood / stone / herbs** into the counters at the
  top-left. Nodes run dry and **regenerate over time**.
- **Resonance:** place matching decor near a worker for bonus production —
  e.g. a **Hum Crystal** within 2 tiles of a creature mining a **Moon Rock**
  doubles its stone. Sparkles = it's working. All combos are listed in
  `src/config/resonance.json`.
- **Evolution:** select a creature to see its three activity bars. When one
  fills up, the creature evolves — **into the branch matching whatever it did
  most**. Everything it does counts: harvesting fills *Working*, walking fills
  *Exploring*, resting fills *Resting* (twice as fast near decor).
- Your sanctuary **saves automatically** (every 10s and on close) — refresh
  and everything is still there. Reset from the ⚙ settings panel.
- ⚙ settings also lets you force **Desktop / Phone** interface mode
  (Auto detects for you).

## 🧩 Everything is data-driven

The whole point of this pass: designers (you!) can tune the game by editing
JSON — no code changes needed.

| File | What it controls |
|---|---|
| `src/config/biomes.json` | Tile types, the four biomes, and terrain-generation knobs |
| `src/config/creatures.json` | Species (shape/color/speed), starting creatures, mobile creature cap |
| `src/config/nodes.json` | Resources (HUD counters), node yields, capacities, regen rates, build costs |
| `src/config/decor.json` | Decor items + costs |
| `src/config/resonance.json` | Resonance combos (decor + node → multiplier) — add rows to add combos |
| `src/config/evolution.json` | Evolution threshold, branch forms, stat changes |

Want a new resonance combo? Add one object to `resonance.json`. Want
evolution to take longer? Raise `threshold` in `evolution.json`. Want a new
landscape type? Add tiles + a biome entry to `biomes.json`.

## 🌍 Generated landscapes

There is no fixed map. Every new sanctuary **generates its own terrain** from
a random seed and one of four biomes:

- **Verdant Meadow** — grass, earth, calm ponds
- **Ember Dunes** — sand, red clay, one precious oasis
- **Frostreach** — snowfields, ice sheets, meltwater
- **Whispermire** — moss, mud, dark pools, boardwalks

The seed is stored in your save, so refreshing always brings back *your* land
exactly. **Reset** (⚙ settings) travels to a brand-new random land.

Preview any land via the URL, handy for testing:
`?fresh=1&biome=frost&seed=42` (fresh = ignore the save this visit;
biome = verdant / dunes / frost / mire; seed = any number).

## 🗂 Code tour (for the next developer / future art pass)

```
src/
  main.ts                  Phaser setup, responsive canvas, rotate-phone hint
  types.ts                 Shared TypeScript types mirroring the config files
  config/                  ALL game data (see table above)
  core/
    iso.ts                 Isometric grid ↔ pixel math
    GameState.ts           Global inventory + the event bus between scenes
    SaveManager.ts         localStorage save/load
    device.ts              Phone detection, UI-mode setting, performance caps
  systems/
    MapGenerator.ts        Seeded procedural landscape generation (biomes)
    Pathfinder.ts          BFS pathfinding on the tile grid
    CameraController.ts    Drag-pan, wheel-zoom, pinch-zoom, tap detection
    ResonanceSystem.ts     Pure resonance-recipe matching logic
  entities/
    Creature.ts            Wander AI, job work, activity counters, EVOLUTION
    ResourceNode.ts        Harvestable, regenerating nodes
    Decor.ts               Placed decor items
  scenes/
    BootScene.ts           Generates all placeholder textures from config
    WorldScene.ts          The sanctuary: map, entities, taps, saving
    UIScene.ts             Responsive HUD (desktop + phone modes)
```

**Swapping in real art later:** replace the texture generation in
`BootScene.ts` with a normal asset loader that registers the **same texture
keys** (`cr-glimmer`, `node-tree`, `decor-crystal`, …) — nothing else changes.

## 🚫 Deliberately not in this pass

Wallet / Solana / token, multiplayer, combat, final art, sound, narrative —
those are later layers on top of this foundation.
