# 🌿 Wildkin — Game Summary & Gameplay Guide

*Build Pass 4 — real art: the Visual Bible sprites now render in-game (creatures, evolved forms, decor, nodes). Tiles/effects remain stylized placeholders.*

## What Wildkin is

A browser-based isometric **creature-sanctuary game** — no download, desktop
and phone. You raise a small band of wildkin, and **what each one becomes is
entirely up to you**: the decor you place next to a working creature decides
which evolution branch it takes.

**Resonance is the verb; evolution is the outcome.** One system:

1. A creature works a resource node **next to a matching decor** → it
   *resonates*: sparkles fly, production multiplies (×1.5–×2), **and** that
   decor's **branch affinity** fills.
2. Each base creature has **two branches**. Which decor you use = which
   branch fills. Fully player-steered, fully deterministic.
3. When affinity crosses the threshold, the creature **evolves** — screen
   flash, particle burst, celebration modal with before → after and a
   **COMMON (85%) or ✨RARE (15%)** roll. Rares are bigger, wilder-colored,
   gold-ringed — the "look what I got" moment. Share button captures a
   screenshot straight to the share sheet / download.

## The creatures (3 bases → 12 possible forms)

| Base | Decor → Branch A | Decor → Branch B |
|---|---|---|
| **Cindling** 🔥 | Forge → **Magmaton** (rare: *Obsidian Magmaton*) | Beacon → **Flarewisp** (rare: *Solar Flarewisp*) |
| **Sporeling** 🍄 | Bloombed → **Mycelord** (rare: *Elder Mycelord*) | Thornbed → **Toxifang** (rare: *Venom Toxifang*) |
| **Nimbling** 🌩 | Storm Rod → **Tempestcoil** (rare: *Voltaic Tempestcoil*) | Windvane → **Zephyrscout** (rare: *Gale Zephyrscout*) |

Every form changes the look and the stats (work speed / move speed); rare
variants are stronger still.

## Your first 90 seconds

First-ever visit runs a scripted intro: place a free **Forge** on the glowing
tile, tap **Cindling**, tap the glowing tree — resonance fires instantly, the
affinity bar above Cindling fills, and your **first evolution bursts in well
under 90 seconds** (measured ~15–20s of play). Then two more wildkin arrive
and the sanctuary is yours. It never replays (stored in the browser).

## The depth loop (Phase 0)

**Evolved creatures shape the next generation.** Every evolved form emits a
visible **influence aura** (a tinted diamond on the map — toggle with the 👁
button). Any wildkin working inside that aura gains affinity toward the
aura's branch, **stacking with decor** through the exact same rules. Evolve
one Magmaton and its fire aura nudges every Cindling working nearby toward
Magmaton too — chains are the fastest way to steer (aura + decor beats decor
alone), and rare forms have wider, stronger auras.

**Space is scarce, steering costs time.** The sanctuary holds at most
**8 decor** and **6 wildkin** (config: `sanctuaryLimits.json`) and nothing
can share a tile — hitting a cap tells you plainly to make room. The Build
menu's **🗑 Remove** mode demolishes decor for a 50% refund. After you assign
or move a creature it needs **20 seconds to settle** before it can be
redirected (countdown shown in its panel), so every placement and order is a
real decision.

**Summons.** The Build menu can invite another Cindling, Sporeling or
Nimbling (for resources) — you'll need more than three wildkin to fill the
dex.

**The Form Dex (📖 button)** is the long-term goal: all 12 evolved forms,
locked silhouettes until you discover them, COMMON/✨RARE✨ tags, NEW! badges
on fresh discoveries, and an X/12 counter. Dex progress is a lifetime record
— it survives refreshes AND traveling to a new land.

## Daily driver

Each real-world day one branch gets **+50% affinity gain**, announced in a
small banner: *"⚡ Today's Resonance: [Branch] — evolves +50% faster."* Same
for every player, rotates at midnight UTC. That's the whole feature.

## Controls

| Action | Desktop | Phone |
|---|---|---|
| Pan / Zoom | Drag / Scroll wheel | One-finger drag / Pinch |
| Select creature | Click | Tap |
| Assign work | Select creature → click a tree/rock/flower | Same |
| Move / Deselect | Click ground / click creature again | Same |
| Build decor | 🔨 Build → pick → click open ground | Same |

The build menu shows **which branch each decor steers**. Select a creature to
see its two affinity bars. Everything autosaves; refresh restores creatures,
affinities, evolved forms — workers walk right back to their posts.

Each sanctuary sits on a **generated landscape** (four biomes, seeded).
⚙ Settings: Desktop/Phone interface mode, land info, "Reset — start a new
land" (keeps your tutorial-done status).

## Everything is data-driven

| File | Controls |
|---|---|
| `src/config/creatures.json` | Bases, their two branches, affinity threshold |
| `src/config/decor.json` | Decor items + which branch each channels |
| `src/config/resonanceRecipes.json` | base+decor → multiplier, affinity/tick, particles |
| `src/config/evolutionForms.json` | The 12 forms, rare chance, stats |
| `src/config/dailyModifier.json` | Daily boost size + banner text |
| `src/config/onboarding.json` | Tutorial prompts + the low first-evolution threshold |
| `src/config/sanctuaryLimits.json` | Decor/creature caps, move cooldown, remove refund |
| `src/config/nodes.json`, `biomes.json` | Resources/nodes, landscape generation |

Auras live inside `evolutionForms.json` (`influence: {radius, branchId,
affinityPerTick}` per form); summon costs live in `creatures.json`. The dex
is generated from `evolutionForms.json` — add a branch and it grows itself.

URL testing helpers: `?fresh=1` (ignore save), `?biome=frost&seed=42`
(pin a landscape), `?rare=1` (force the rare roll), `?rich=1` (deep starting
pockets) — testing only.

## Deliberately not in this pass

Wallet/token/crypto, multiplayer, trading, combat, extra biomes or creatures,
sound, narrative. All later layers. (Creature/decor/node art is now real —
swap any single sprite by replacing its PNG in `public/assets/wildkin/`.)
