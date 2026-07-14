/* garlic.js — the anti-vamp brain, shared by the app and the demo.
 * Pure functions, no dependencies. Two jobs:
 *   1. similarity: catch look-alike / vampire names the on-chain charset check
 *      can't (doges, d0ge, doge-sol, homoglyphs already normalized to ascii).
 *   2. Garlic Score: an originality number (100 = unique) that drops as
 *      confusingly-similar names exist elsewhere.  */
(function (global) {
  // fold common homoglyph/leet substitutions to a canonical skeleton so
  // "d0ge" and "doge", "l1am"/"liam" collapse together.
  const LEET = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };
  function skeleton(label) {
    return (label || '').toLowerCase().replace(/[^a-z0-9]/g, '').split('').map(c => LEET[c] || c).join('');
  }
  // strip common vampire suffixes/prefixes people add to ride a ticker
  const AFFIXES = ['inu', 'coin', 'token', 'sol', 'eth', 'hood', '2', 'x', 'ai', 'fi', 'dao', 'v2', 'og', 'real', 'the'];
  function root(label) {
    let s = skeleton(label);
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of AFFIXES) {
        if (s.length - a.length >= 3 && s.endsWith(a)) { s = s.slice(0, -a.length); changed = true; }
        if (s.length - a.length >= 3 && s.startsWith(a)) { s = s.slice(a.length); changed = true; }
      }
    }
    return s;
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  // 0..1 similarity between two labels (1 = identical skeleton)
  function similarity(a, b) {
    const sa = skeleton(a), sb = skeleton(b);
    if (!sa || !sb) return 0;
    if (sa === sb) return 1;
    if (root(a) && root(a) === root(b)) return 0.95; // same root, different affix
    const dist = levenshtein(sa, sb);
    return 1 - dist / Math.max(sa.length, sb.length);
  }
  // nearest existing label to `label` among `others` (excluding itself)
  function nearest(label, others) {
    let best = null, bestSim = 0;
    for (const o of others) {
      if (o === label) continue;
      const s = similarity(label, o);
      if (s > bestSim) { bestSim = s; best = o; }
    }
    return best ? { label: best, sim: bestSim } : null;
  }
  // Garlic Score: 100 for a clearly-original name, dropping as look-alikes
  // exist. A near-identical twin costs the most; distant neighbours cost little.
  function garlicScore(label, others) {
    let score = 100;
    for (const o of others) {
      if (o === label) continue;
      const s = similarity(label, o);
      if (s >= 0.995) score -= 40;        // effectively the same name
      else if (s >= 0.9) score -= 18;     // one edit / shared root
      else if (s >= 0.75) score -= 8;     // clearly evocative
      else if (s >= 0.6) score -= 3;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }
  // severity label for a similarity warning at search time
  function similarityWarning(label, others) {
    const near = nearest(label, others);
    if (!near) return null;
    const pct = Math.round(near.sim * 100);
    if (near.sim >= 0.995) return { level: 'block', pct, other: near.label, text: `identical to ${near.label}.hood` };
    if (near.sim >= 0.8) return { level: 'warn', pct, other: near.label, text: `${pct}% similar to ${near.label}.hood — looks like a vampire of it` };
    if (near.sim >= 0.6) return { level: 'note', pct, other: near.label, text: `${pct}% similar to ${near.label}.hood` };
    return null;
  }

  global.GARLIC = { skeleton, root, levenshtein, similarity, nearest, garlicScore, similarityWarning };
})(typeof window !== 'undefined' ? window : globalThis);
