// test.js — minimal dependency-free assertions. `node test.js`.
import { MemoryStore, similarity, Episode } from './src/memory.js';
import { nremConsolidate, forget, remRecombine } from './src/consolidate.js';
import { dreamCycle } from './src/dream.js';

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; console.error(`  FAIL ${name}`); }
}

// similarity
ok('identical tags -> similarity 1', similarity(new Episode({ content: 'a', tags: ['x', 'y'] }), new Episode({ content: 'b', tags: ['x', 'y'] })) === 1);
ok('disjoint tags -> similarity 0', similarity(new Episode({ content: 'a', tags: ['x'] }), new Episode({ content: 'b', tags: ['z'] })) === 0);

// NREM clusters similar winning episodes into one archetype
const s1 = new MemoryStore();
s1.remember({ content: 'w1', tags: ['snake', 'turn-early'], outcome: { reward: 1 } });
s1.remember({ content: 'w2', tags: ['snake', 'turn-early'], outcome: { reward: 1 } });
s1.remember({ content: 'w3', tags: ['snake', 'turn-early'], outcome: { reward: 1 } });
const sems = nremConsolidate(s1);
ok('NREM produces >=1 semantic', sems.length >= 1);
ok('NREM semantic is positive verdict', sems[0].content.includes('WIN'));
ok('NREM strengthens replayed episodes', s1.episodic.every((e) => e.accessCount >= 1));

// forgetting keeps high-value, drops low-value
const s2 = new MemoryStore();
s2.remember({ content: 'keep', tags: ['a'], salience: 0.9, ts: Date.now() });
s2.remember({ content: 'drop', tags: ['b'], salience: 0.01, ts: Date.now() - 1000 * 60 * 60 * 24 * 60 });
const forgotten = forget(s2, { keepFraction: 0.5 });
ok('FORGET drops the low-value episode', forgotten.length === 1 && forgotten[0].content === 'drop');
ok('FORGET keeps the high-value episode', s2.episodic.length === 1 && s2.episodic[0].content === 'keep');

// REM bridges distant semantics
const s3 = new MemoryStore();
s3.learn({ content: 'A', tags: ['aggro', 'early'], strength: 0.9 });
s3.learn({ content: 'B', tags: ['defense', 'late'], strength: 0.9 });
const insights = remRecombine(s3);
ok('REM generates a bridging hypothesis', insights.length >= 1 && insights[0].kind === 'hypothesis');

// full cycle returns a well-formed wake packet
const s4 = new MemoryStore();
for (let i = 0; i < 4; i += 1) s4.remember({ content: `e${i}`, tags: ['snake', 'turn-early'], outcome: { reward: 1 } });
const wake = dreamCycle(s4);
ok('wake packet has version', wake.version === '0.1.0');
ok('wake packet reports learned patterns', Array.isArray(wake.learned) && wake.learned.length >= 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
