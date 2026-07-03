# 🌿 Wildkin — Game Summary & Gameplay Guide

*Vertical slice v0.1 — world & core systems complete, placeholder art.*

## What Wildkin is

A browser-based isometric **creature-sanctuary game** — no download, works on
desktop and phone. You tend a small pocket of wilderness: assign creatures to
gather resources, decorate the land, and shape who your creatures become.

The core identity: **creatures evolve based on how you raise and use them.**
Two creatures of the same species end up completely different depending on
what you had them do. Nothing is random — every evolution is earned.

Every sanctuary sits on a **procedurally generated landscape**: one of four
biomes, rolled from a random seed. No two players' lands look alike, and
refreshing the page always brings back *your* exact land.

## Where to play

| | |
|---|---|
| Live (GitHub Pages) | `https://omnivalent.github.io/clawarcade/games/wildkin/` |
| Main site (after surge deploy) | `https://clawarcade.surge.sh/games/wildkin/` |
| Locally | `cd wildkin && npm install && npm run dev` |

## Controls

| Action | Desktop | Phone |
|---|---|---|
| Pan the camera | Click + drag | One-finger drag |
| Zoom | Scroll wheel | Pinch |
| Select a creature | Click it | Tap it |
| Assign work | Select a creature, then click a tree / rock / flower | Same, with taps |
| Move a creature | Select it, then click open ground | Same |
| Deselect | Click the creature again (or water) | Same |
| Build | 🔨 Build → pick an item → click a grass/dirt tile | Same |
| Settings | ⚙ — Desktop/Phone interface mode, current land info, reset | Same |

## The gameplay loop

1. **Put your Wildkin to work.** Select a creature, tap a resource node. It
   walks over and harvests on its own: **Wisp Trees** give wood, **Moon
   Rocks** give stone, **Dream Blooms** give herbs. Counters tick up in the
   top-left HUD. Nodes run dry and slowly refill in real time, so spreading
   workers across nodes beats stacking them.
2. **Spend resources in Build mode.** Four decor items (Hum Crystal, Glow
   Lantern, Moss Stone, Petal Bed) plus plantable nodes — you can grow your
   own groves and quarries.
3. **Trigger Resonance.** Decor isn't just pretty. Place the *matching* decor
   within 2 tiles of a worker and production multiplies, with sparkles:
   - Hum Crystal near a rock-miner → **×2 stone**
   - Glow Lantern near a tree-worker → **×1.5 wood**
   - Petal Bed near a bloom-gatherer → **×2 herbs**
   - Moss Stone near a *Glimmer* gathering blooms → **×2.5 herbs** (species-specific combo)
4. **Shape your creatures.** Select any creature to see its three activity
   bars. Everything it does feeds one of them:
   - **Working** — +1 per harvest
   - **Exploring** — grows as it walks (deliberate journeys count most)
   - **Resting** — grows while idle, *twice as fast near decor*
5. **Witness evolution.** The first bar to fill (25 points) evolves the
   creature — down the branch of whichever bar is **highest**:

   | Branch | Form | What changes |
   |---|---|---|
   | Working | **Forgekin** | Works 1.6× faster |
   | Exploring | **Swiftkin** | Moves 1.7× faster |
   | Resting | **Bloomkin** | Resonance is stronger around it (+0.5 to multipliers) |

   A focused worker evolves in roughly a minute of play; idle creatures drift
   toward their own fates much more slowly. Your choices are the difference.

## The four lands

Each new sanctuary rolls one of these biomes with unique terrain every time:

- **Verdant Meadow** — rolling grass, warm earth, calm ponds
- **Ember Dunes** — endless sand, red clay, one precious oasis
- **Frostreach** — snowfields, ice sheets, cold meltwater
- **Whispermire** — soft moss, deep mud, dark pools, boardwalks

⚙ Settings shows your land's name and seed. **Reset** erases the sanctuary
and travels to a brand-new random land. (Preview any land with URL params:
`?fresh=1&biome=frost&seed=42`.)

## Saving

Automatic — every 10 seconds and whenever you close or hide the tab. Refresh
and everything returns: creatures, their progress bars and evolutions, decor,
node stock levels, even jobs (workers walk right back to their posts).

## Quick tips

- Give each starter a different life — one worker, one wanderer, one resting
  in a decorated corner — and you'll see all three evolutions.
- Build a Petal Bed next to a Dream Bloom early; herbs pay for more decor.
- A Bloomkin parked near your work sites quietly boosts everyone's resonance.

## Deliberately not in this slice

Wallet / token, multiplayer, combat, final art, sound, narrative — later
layers. All creatures and terrain are placeholder shapes generated in code,
built to be swapped for real art without touching game logic.
