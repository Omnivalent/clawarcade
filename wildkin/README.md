# 🌿 Wildkin — Creature Sanctuary (Build Pass 3 / Phase 0)

A browser-based isometric creature-sanctuary game built on ONE fused system:
**resonance drives evolution**. Working a creature next to a matching decor
multiplies production now AND fills that decor's evolution branch — so the
player literally steers each creature's destiny by arranging the sanctuary.
Three bases (Cindling, Sporeling, Nimbling) × two branches × common/rare
forms = 12 evolutions. First-ever visit runs a scripted 90-second onboarding
that lands the first evolution in ~15–20 seconds of play.

Phase 0 makes the loop deep: **evolved creatures emit influence auras** that
steer their neighbors through the same pipeline as decor (chains!), space is
scarce (decor/creature caps + a move cooldown make placement a real puzzle),
and the **Form Dex** tracks all 12 discoverable forms as the long-term goal.

ART: creatures, evolved forms, decor and resource nodes now use the real
transparent-PNG sprites in `public/assets/wildkin/` (extracted from the
Visual Bible). Every sprite is loaded by config (`sprite` fields) under the
same texture keys as before; a missing file logs a warning and falls back to
the old placeholder shape — art swaps are file drops, never code changes.
See `GAMEPLAY.md` for the full player guide.

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
- **Resonance drives evolution (the fused system):** a creature working next
  to a **matching decor** resonates — production multiplies with sparkles AND
  affinity accrues toward that decor's **evolution branch** (e.g. a Forge
  within 2 tiles of a working Cindling channels **Magmaton**). All pairings
  live in `src/config/resonanceRecipes.json`; the build menu labels which
  branch each decor steers.
- **Evolution:** select a creature to see its two branch bars. When one
  crosses the threshold, the creature evolves down that branch — with a
  **15% chance of the rare variant** (gold-ringed, stronger). Celebration
  modal shows before → after with a Share button.
- **First run:** a scripted onboarding delivers your first evolution in under
  90 seconds. It only ever runs once.
- **Daily boost:** one branch evolves +50% faster each real-world day
  (see the banner under the resource counters).
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
| `src/config/decor.json` | Decor items, costs, and which branch each channels |
| `src/config/resonanceRecipes.json` | The fused rules: base+decor → multiplier + affinity/tick + branch |
| `src/config/evolutionForms.json` | The 6 branches, 12 forms (common+rare), rare chance, stats |
| `src/config/dailyModifier.json` | Daily boost multiplier + banner text |
| `src/config/onboarding.json` | Tutorial prompts + the low first-evolution threshold |
| `src/config/sanctuaryLimits.json` | Decor/creature caps, move cooldown, remove refund |

Want a new resonance pairing? Add a row to `resonanceRecipes.json`. Want
evolution to take longer? Raise `affinityThreshold` in `creatures.json`. Want
a new landscape type? Add tiles + a biome entry to `biomes.json`.

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
    daily.ts               Date-seeded daily branch boost
    dex.ts                 Form Dex collection state (lifetime, own storage)
    share.ts               Canvas screenshot -> share sheet / download
    SaveManager.ts         localStorage save/load
    device.ts              Phone detection, UI-mode setting, performance caps
  systems/
    MapGenerator.ts        Seeded procedural landscape generation (biomes)
    Pathfinder.ts          BFS pathfinding on the tile grid
    CameraController.ts    Drag-pan, wheel-zoom, pinch-zoom, tap detection
    ResonanceSystem.ts     Fused recipe matcher (base + nearby decor -> recipe)
    Onboarding.ts          The scripted 90-second first-run
  entities/
    Creature.ts            Wander AI, job work, branch AFFINITIES + evolution
    ResourceNode.ts        Harvestable, regenerating nodes
    Decor.ts               Placed decor items
  scenes/
    BootScene.ts           Generates all placeholder textures from config
    WorldScene.ts          The sanctuary: map, entities, taps, saving
    UIScene.ts             Responsive HUD (desktop + phone modes)
```

**Swapping art:** drop a new transparent PNG over the existing file in
`public/assets/wildkin/{creatures,decor,nodes}/` (exact filenames — see the
`sprite` fields in the configs). BootScene preloads them under the stable
texture keys (`cr-cindling`, `cr-form-magmaton`, `node-tree`, `decor-forge`);
anything missing falls back to a generated placeholder shape with a console
warning. Rendering auto-fits every sprite to its category height (creatures
≈1.3 tiles, decor ≈1.1, nodes ≈1.3), so art can be any resolution.

## 🚫 Deliberately not in this pass

Wallet / Solana / token, multiplayer, combat, final art, sound, narrative —
those are later layers on top of this foundation.
