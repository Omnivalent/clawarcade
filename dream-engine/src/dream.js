// dream.js — orchestrator. Runs a full dream cycle and emits a Wake Packet.
//
// A "Wake Packet" is the deliverable the protocol hands back to the agent the
// next time it acts: the new generalizations it learned while idle, the novel
// hypotheses to try, and what it chose to forget. This is the interface a
// ClawArcade bot (or any agent) consumes between matches.

import { nremConsolidate, forget, remRecombine } from './consolidate.js';

/**
 * Run one dream cycle over a MemoryStore.
 * @returns {WakePacket}
 */
export function dreamCycle(store, opts = {}) {
  const startedStats = store.stats();

  const newSemantics = nremConsolidate(store, opts.nrem);
  const forgotten = forget(store, opts.forget);
  const insights = remRecombine(store, opts.rem);

  const wakePacket = {
    version: '0.1.0',
    cycle: store.journal.filter((j) => j.phase === 'NREM').length,
    learned: newSemantics.map((s) => ({ id: s.id, content: s.content, strength: round(s.strength) })),
    hypotheses: insights
      .sort((a, b) => b.novelty * b.confidence - a.novelty * a.confidence)
      .map((h) => ({ content: h.content, novelty: round(h.novelty), confidence: round(h.confidence) })),
    forgot: forgotten.length,
    before: startedStats,
    after: store.stats(),
  };

  store.log({ phase: 'WAKE', learned: wakePacket.learned.length, hypotheses: wakePacket.hypotheses.length });
  return wakePacket;
}

function round(x) {
  return Math.round(x * 100) / 100;
}
