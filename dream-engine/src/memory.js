// memory.js — the episodic + semantic memory store.
//
// Neuroscience mapping:
//   episodic store  ~ hippocampus (fast, specific, recent experiences)
//   semantic store  ~ neocortex   (slow, generalized, archetypal knowledge)
// Consolidation (see consolidate.js) is the sleep-dependent transfer of
// episodic experience into semantic knowledge, exactly the process the
// hippocampal-neocortical replay literature describes.

let _counter = 0;
function nextId(prefix) {
  _counter += 1;
  return `${prefix}_${_counter}`;
}

/**
 * A single lived experience. In ClawArcade this is "I played a Snake match
 * and did X and the outcome was Y".
 */
export class Episode {
  constructor({ content, tags = [], salience = 0.5, outcome = null, ts = Date.now() }) {
    this.id = nextId('ep');
    this.content = content;         // human-readable description
    this.tags = normalizeTags(tags);// discrete features used for similarity
    this.salience = clamp01(salience); // how important/surprising it was (0..1)
    this.outcome = outcome;         // e.g. { reward: +1 } or { reward: -1 }
    this.ts = ts;                   // when it happened (ms epoch)
    this.accessCount = 0;           // how often replay has touched it
  }
}

/**
 * A generalized pattern distilled from many episodes.
 * "When the wall is 2 tiles ahead and food is left, turning early wins."
 */
export class Semantic {
  constructor({ content, tags = [], strength = 0.5, support = [], ts = Date.now() }) {
    this.id = nextId('sem');
    this.content = content;
    this.tags = normalizeTags(tags);
    this.strength = clamp01(strength); // confidence in the generalization
    this.support = support;            // episode ids that back this pattern
    this.ts = ts;
  }
}

export class MemoryStore {
  constructor() {
    this.episodic = [];
    this.semantic = [];
    this.journal = []; // append-only log of what happened each dream cycle
  }

  remember(episodeLike) {
    const ep = episodeLike instanceof Episode ? episodeLike : new Episode(episodeLike);
    this.episodic.push(ep);
    return ep;
  }

  learn(semanticLike) {
    const sem = semanticLike instanceof Semantic ? semanticLike : new Semantic(semanticLike);
    this.semantic.push(sem);
    return sem;
  }

  log(entry) {
    this.journal.push({ ts: Date.now(), ...entry });
  }

  stats() {
    return {
      episodic: this.episodic.length,
      semantic: this.semantic.length,
      journalEntries: this.journal.length,
    };
  }
}

// --- helpers ---------------------------------------------------------------

export function clamp01(x) {
  if (Number.isNaN(x) || x == null) return 0;
  return Math.max(0, Math.min(1, x));
}

export function normalizeTags(tags) {
  return [...new Set(tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean))];
}

/**
 * Jaccard similarity over discrete tags. This is a deliberately simple,
 * dependency-free stand-in for embedding cosine-similarity so the prototype
 * runs anywhere with `node`. In production swap this for real embeddings.
 */
export function similarity(a, b) {
  const A = new Set(a.tags);
  const B = new Set(b.tags);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
