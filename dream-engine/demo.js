// demo.js — a ClawArcade Snake bot dreams between matches and wakes up smarter.
//
//   node demo.js
//
// Seeds a batch of episodic memories from simulated matches, runs a dream
// cycle, and prints the Wake Packet the bot would consume next match.

import { MemoryStore } from './src/memory.js';
import { dreamCycle } from './src/dream.js';

const store = new MemoryStore();

// --- a day of Snake matches (episodic memory) ------------------------------
// The bot logs what it did and whether the match was won (+1) or lost (-1).

const HOUR = 1000 * 60 * 60;
const now = Date.now();

// Cluster 1: hugging the wall early -> wins.
store.remember({ content: 'Turned away from wall 2 tiles early, ate food', tags: ['snake', 'wall-near', 'turn-early', 'food-left'], salience: 0.7, outcome: { reward: +1 }, ts: now - 6 * HOUR });
store.remember({ content: 'Left wall zone before boxing in, survived', tags: ['snake', 'wall-near', 'turn-early'], salience: 0.6, outcome: { reward: +1 }, ts: now - 5 * HOUR });
store.remember({ content: 'Early turn near wall, grabbed food safely', tags: ['snake', 'wall-near', 'turn-early', 'food-left'], salience: 0.65, outcome: { reward: +1 }, ts: now - 4 * HOUR });

// Cluster 2: chasing food into own tail -> losses.
store.remember({ content: 'Chased food into my own tail, crashed', tags: ['snake', 'greedy-food', 'long-body'], salience: 0.8, outcome: { reward: -1 }, ts: now - 3 * HOUR });
store.remember({ content: 'Ignored body length going for food, died', tags: ['snake', 'greedy-food', 'long-body'], salience: 0.75, outcome: { reward: -1 }, ts: now - 2.5 * HOUR });

// Cluster 3: a different game entirely — Chess. Controlling the center wins.
// REM will try to bridge distant knowledge (Chess <-> Snake) into a new idea.
store.remember({ content: 'Took the center early, dominated', tags: ['chess', 'center-control', 'tempo'], salience: 0.7, outcome: { reward: +1 }, ts: now - 8 * HOUR });
store.remember({ content: 'Fought for center files, won', tags: ['chess', 'center-control', 'tempo'], salience: 0.65, outcome: { reward: +1 }, ts: now - 7 * HOUR });

// Noise: one-off low-salience episodes (should be candidates for forgetting).
store.remember({ content: 'Opponent lagged, free win', tags: ['snake', 'opponent-lag'], salience: 0.1, outcome: { reward: +1 }, ts: now - 40 * HOUR });
store.remember({ content: 'Random wander, nothing happened', tags: ['snake', 'idle'], salience: 0.05, outcome: { reward: 0 }, ts: now - 50 * HOUR });

console.log('=== Before dreaming ===');
console.log(store.stats());

const wake = dreamCycle(store);

console.log('\n=== WAKE PACKET (what the bot knows next match) ===');
console.log(JSON.stringify(wake, null, 2));

console.log('\n=== After dreaming ===');
console.log(store.stats());
console.log('\nSemantic knowledge distilled:');
for (const s of store.semantic) console.log('  •', s.content);
