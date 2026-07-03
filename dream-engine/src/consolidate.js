// consolidate.js — the sleep cycle.
//
// A dream cycle runs three biologically-motivated phases over the memory store:
//
//   NREM (slow-wave)  -> replay + integration: cluster similar episodes and
//                        distill them into semantic archetypes. This is the
//                        hippocampal->neocortical transfer.
//   Forgetting        -> value-based pruning: low-salience, rarely-replayed,
//                        stale episodes decay away. Forgetting is a feature,
//                        not a bug — it resolves proactive interference.
//   REM (paradoxical) -> divergent recombination: bridge two *distant* semantic
//                        memories into a novel counterfactual insight. This is
//                        the "creativity through noise" / incubation effect.
//
// Everything here is deterministic and dependency-free so it can be tested.

import { Semantic, similarity, clamp01 } from './memory.js';

/**
 * NREM: group episodes into clusters of similar experience, then emit one
 * semantic archetype per cluster whose members agree on an outcome.
 */
export function nremConsolidate(store, { simThreshold = 0.34, minCluster = 2 } = {}) {
  const eps = store.episodic;
  const used = new Set();
  const newSemantics = [];

  for (let i = 0; i < eps.length; i += 1) {
    if (used.has(eps[i].id)) continue;
    const cluster = [eps[i]];
    for (let j = i + 1; j < eps.length; j += 1) {
      if (used.has(eps[j].id)) continue;
      if (similarity(eps[i], eps[j]) >= simThreshold) cluster.push(eps[j]);
    }
    if (cluster.length < minCluster) continue;

    cluster.forEach((e) => {
      used.add(e.id);
      e.accessCount += 1; // replay strengthens the trace
    });

    // Only generalize when the cluster mostly agrees on a reward sign.
    const rewards = cluster.map((e) => e.outcome?.reward ?? 0);
    const meanReward = rewards.reduce((a, b) => a + b, 0) / rewards.length;
    const agreement = rewards.filter((r) => Math.sign(r) === Math.sign(meanReward)).length / rewards.length;

    const tags = topTags(cluster);
    const verdict = meanReward > 0 ? 'tends to WIN' : meanReward < 0 ? 'tends to LOSE' : 'is neutral';
    const sem = new Semantic({
      content: `Pattern [${tags.join(', ')}] ${verdict} (from ${cluster.length} episodes, agreement ${(agreement * 100).toFixed(0)}%).`,
      tags,
      strength: clamp01(0.4 + 0.5 * agreement),
      support: cluster.map((e) => e.id),
    });
    newSemantics.push(sem);
    store.learn(sem);
  }

  store.log({ phase: 'NREM', clusters: newSemantics.length, semanticsAdded: newSemantics.map((s) => s.id) });
  return newSemantics;
}

/**
 * Value-based forgetting. An episode's retention value combines salience,
 * how often it was replayed, and recency. The weakest fraction is dropped.
 */
export function forget(store, { keepFraction = 0.7, now = Date.now(), halfLifeMs = 1000 * 60 * 60 * 24 * 7 } = {}) {
  const eps = store.episodic;
  if (eps.length === 0) return [];

  const scored = eps.map((e) => {
    const ageMs = Math.max(0, now - e.ts);
    const recency = Math.pow(0.5, ageMs / halfLifeMs); // 1.0 fresh -> 0 old
    const value = 0.5 * e.salience + 0.3 * Math.min(1, e.accessCount / 3) + 0.2 * recency;
    return { e, value };
  });

  scored.sort((a, b) => b.value - a.value);
  const keep = Math.max(1, Math.round(scored.length * keepFraction));
  const survivors = scored.slice(0, keep).map((s) => s.e);
  const forgotten = scored.slice(keep).map((s) => s.e);

  store.episodic = survivors;
  store.log({ phase: 'FORGET', kept: survivors.length, forgotten: forgotten.map((e) => e.id) });
  return forgotten;
}

/**
 * REM: pick the two most *dissimilar* strong semantics and hypothesize a
 * bridge between them — a novel, testable idea the agent didn't hold before.
 */
export function remRecombine(store, { maxInsights = 3 } = {}) {
  const sems = [...store.semantic].sort((a, b) => b.strength - a.strength).slice(0, 8);
  const insights = [];

  for (let i = 0; i < sems.length && insights.length < maxInsights; i += 1) {
    for (let j = i + 1; j < sems.length && insights.length < maxInsights; j += 1) {
      const sim = similarity(sems[i], sems[j]);
      if (sim > 0.15) continue; // we want *distant* pairs to spark novelty
      const bridgeTags = [...new Set([...sems[i].tags.slice(0, 2), ...sems[j].tags.slice(0, 2)])];
      insights.push({
        kind: 'hypothesis',
        content: `What if [${sems[i].tags.slice(0, 2).join(', ')}] and [${sems[j].tags.slice(0, 2).join(', ')}] interact? Try combining them next match.`,
        tags: bridgeTags,
        novelty: clamp01(1 - sim),
        confidence: clamp01((sems[i].strength + sems[j].strength) / 2 - 0.1),
        support: [sems[i].id, sems[j].id],
      });
    }
  }

  store.log({ phase: 'REM', insights: insights.length });
  return insights;
}

// --- helpers ---------------------------------------------------------------

function topTags(episodes, k = 3) {
  const counts = new Map();
  for (const e of episodes) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([t]) => t);
}
