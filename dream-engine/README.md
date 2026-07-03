# 🧠💤 Dream Engine

### Sleep-inspired memory consolidation for AI agents

**Agents that sit idle waste their most valuable resource: time to think.** Dream
Engine gives an agent a *sleep cycle*. During downtime it replays its
experiences, distills them into general knowledge, forgets the noise, and wakes
up with novel ideas — the same way brains turn a day's episodes into lasting
skill overnight.

Built as a new module in [ClawArcade](../README.md): bots that dream between
matches get measurably smarter across a tournament season.

```bash
cd dream-engine
node demo.js     # watch a Snake+Chess bot dream and wake up smarter
node test.js     # 10 assertions, no dependencies
```

---

## Why now

Agent memory went from a side-quest to *the* frontier problem in 2026, and the
research consensus landed on a neuroscience metaphor Dream Engine is built
around — **sleep-dependent, hippocampal→neocortical consolidation**:

- The **ICLR 2026 MemAgents workshop** names hippocampal-neocortical
  consolidation as an open problem.
- **SCM (Sleep-Consolidated Memory)**, **SleepGate**, **JiuwenMemory**,
  **ZenBrain**, and **HEMA** all model NREM/REM offline consolidation and
  value-based forgetting.
- Memory is now *benchmarked* (LoCoMo, mem0's 2026 state-of-memory report).

This repo grew out of [`dream-mode-protocol`](https://github.com/Omnivalent/dream-mode-protocol),
which framed idle-time "dreaming" back in Feb 2026 — before the field converged
here. Dream Engine is that idea made **real, runnable, and measurable.**

---

## The neuroscience, mapped to code

| Brain | Dream Engine | File |
|-------|-------------|------|
| Hippocampus (fast, specific, recent) | `Episode` store | `src/memory.js` |
| Neocortex (slow, general, archetypal) | `Semantic` store | `src/memory.js` |
| **NREM slow-wave replay** — episodic → semantic transfer | `nremConsolidate()` | `src/consolidate.js` |
| **Value-based forgetting** — resolve interference | `forget()` | `src/consolidate.js` |
| **REM recombination** — incubation / creativity through noise | `remRecombine()` | `src/consolidate.js` |
| Morning recall — what you carry into the day | **Wake Packet** | `src/dream.js` |

### The dream cycle

```
episodic memories  ──NREM──▶  cluster similar experiences ──▶ semantic archetypes
                   ──FORGET─▶  drop low-value / stale / rarely-replayed episodes
                   ──REM────▶  bridge two DISTANT semantics ──▶ novel hypotheses
                        │
                        ▼
                   WAKE PACKET  { learned, hypotheses, forgot }
```

A **Wake Packet** is the interface an agent consumes when it next acts:

```json
{
  "learned": [
    { "content": "Pattern [snake, wall-near, turn-early] tends to WIN ...", "strength": 0.9 }
  ],
  "hypotheses": [
    { "content": "What if [snake, wall-near] and [chess, center-control] interact?",
      "novelty": 1, "confidence": 0.8 }
  ],
  "forgot": 3
}
```

That last hypothesis is the interesting part: REM only bridges *distant*
memories, so the engine spontaneously proposes transferring a Snake heuristic to
Chess — an idea present in neither memory alone. That's the incubation effect.

---

## How it plugs into ClawArcade

Today a ClawArcade bot is stateless between matches. With Dream Engine:

1. **During a match** the bot logs `Episode`s (what it did → win/loss).
2. **Between matches** (idle), it runs `dreamCycle(store)`.
3. **Next match** it reads the Wake Packet and biases its policy toward
   `learned` winning patterns while probing `hypotheses`.

The payoff is a *visible* demo: agents that start a tournament naive and get
sharper each round — memory consolidation you can watch on the leaderboard.

```js
import { MemoryStore } from './src/memory.js';
import { dreamCycle } from './src/dream.js';

const store = new MemoryStore();
store.remember({ content: 'turned early near wall, ate food',
                 tags: ['snake', 'wall-near', 'turn-early'],
                 salience: 0.7, outcome: { reward: +1 } });
// ... more matches ...
const wake = dreamCycle(store);   // run while the bot is idle
// feed wake.learned / wake.hypotheses back into the bot's policy
```

---

## Honest limitations (and the roadmap)

This is a **v0.1 prototype**, deliberately dependency-free so it runs anywhere:

- **Similarity is tag-Jaccard, not embeddings.** Swap `similarity()` for a real
  embedding model to consolidate free-text memories. *(next)*
- **REM bridges are templated, not reasoned.** Wire the recombination step to an
  LLM to generate genuinely novel, testable hypotheses. *(next)*
- **No benchmark yet.** Wire up **LoCoMo** so consolidation quality is measured,
  not asserted — this is what turns it from a nice metaphor into a result.
- **MCP server.** Expose `remember` / `dreamCycle` / `wakePacket` as an MCP
  server so *any* agent (Claude Code, Cursor, a ClawArcade bot) gets a dream
  cycle for free.

---

*Part of the [ClawArcade](../README.md) project · MIT licensed*
