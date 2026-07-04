# 🧪 Wildkin — 5-Person Playtest Kit (Phase 0)

**Build freeze is in effect.** Nothing gets built until five strangers have
played. This file is the whole kit: setup, script, per-session sheet, scoring,
and the parked ideas list.

**Game URL:** `https://omnivalent.github.io/clawarcade/games/wildkin/`
(or `clawarcade.surge.sh/games/wildkin/` after a surge deploy).

---

## Who

5 people who don't know you or the game. Mix: 2–3 who play games, 1–2 who
don't, **at least 1 non-crypto person**. One at a time. **At least 2 on a
phone** — everyone on the device they'd actually use.

## Setup

- **Fresh incognito/private window per tester** (guarantees the tutorial runs
  and no prior save/dex leaks in).
- Screen-record if possible; otherwise sit behind them and watch silently.
- Start a timer when the page loads.

## The one rule

**Say nothing.** No explaining, no hints, no rescues. If they ask "what do I
do?" answer: *"whatever you want."* Every moment you feel the urge to help,
write it down — that urge is a design bug you just found.

## The five tells (timestamp each)

| # | Watch for | Notes to capture |
|---|---|---|
| 1 | First evolution within ~90s, unaided | If the tutorial stalls, exactly which step |
| 2 | After the evolution burst — keep playing or put it down? | The moment engagement rises or dies |
| 3 | Do they open 📖 on their own? Does a locked silhouette **change what they do next**? | What they did right after closing the dex |
| 4 | A **deliberate aura chain** (use an evolved creature's aura to steer another) | vs. random placement |
| 5 | Do they ever **remove/reposition decor** to optimize a chain? | Deepest signal — unprompted = the puzzle fully landed |

## Three questions after (ask exactly these, don't lead)

1. *"In your own words, what was this game about?"*
2. *"Was there a moment you wanted to keep playing? Was there a moment you wanted to stop? When?"*
3. *"Would you open this again tomorrow — yes or no, and why?"*

## Per-session sheet (copy 5×)

```
Tester #___   Device: desktop / phone     Gamer: y/n   Crypto-native: y/n
t=____  first evolution reached (unaided? y/n)  stalled at: ____________
t=____  post-burst: kept playing / drifted / quit
t=____  opened dex unprompted? y/n   behavior change after? ______________
t=____  deliberate chain built? y/n  describe: ________________________
t=____  removed/repositioned decor for a chain? y/n
Q1 (game about): _______________________________________________
Q2 (keep-playing moment / stop moment): ________________________
Q3 (reopen tomorrow y/n + why): ________________________________
Helper-urge moments (design bugs): _____________________________
```

## Scoring

- **Pass:** 3+/5 reach *unprompted chasing* (dex-driven behavior change or an
  intentional chain) AND 3+/5 would reopen tomorrow.
- **Soft fail:** first evolution lands but they drift within ~10 min and can't
  name what they'd come back for → the loop lacks a *reason* → next work is
  the dex/purpose layer, not content.
- **Hard fail:** onboarding confuses them or they never grasp that *they*
  shape evolution → identity isn't legible → fix that before anything else.

Do **not** argue with confused testers or explain what they "should" have
understood. Their confusion is correct and yours to fix.

## Knobs the test will inform (all config, no code)

| Question the test answers | Knob | File |
|---|---|---|
| Does the aura *feel* powerful or just read as math? | `influence.affinityPerTick` / `radius` | `evolutionForms.json` |
| Do players spam-summon and flatten the spatial puzzle? | `summonCost` | `creatures.json` |
| Does the space cap bite? | `maxDecor`, `maxCreatures` | `sanctuaryLimits.json` |
| Is 20s settling annoying or meaningful? | `moveCooldownSeconds` | `sanctuaryLimits.json` |
| Is normal evolution too fast/slow? | `affinityThreshold` | `creatures.json` |

## 🅿️ Parked (do not build until the test says so)

1. **#1 Phase-1 candidate — aura-transformed decor:** an evolved creature's
   aura upgrades nearby decor over time (Forge → Molten Forge → Ancient
   Forge) instead of only adding flat affinity. Revisit *with test data*.
2. **The named cliff — dex completion:** the dex is finite; after 12/12 there
   is currently no reason to keep playing. Known, deliberate, next cliff —
   not this one.
3. Everything else ever suggested (world events, more biomes/creatures,
   personalities, legendaries, community discovery, weather, quests…): parked
   behind evidence.
