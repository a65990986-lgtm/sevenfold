/* 七曜牌局 · 简化版 — 人机回归测试
 * 运行：node tests/ai.test.js
 */
'use strict';

const assert = require('assert');
const { Engine } = require('../js/engine.js');
const { AI } = require('../js/ai.js');

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function freshAI(seed = 7) {
  const e = new Engine({ seed });
  for (const side of ['player', 'ai']) {
    const p = e.state.players[side];
    p.hand = [];
    p.deck = [];
    p.discard = [];
    p.mana = 4;
    p.winTarget = 6;
    p.silenced = false;
    p.nextMana = 0;
    p.extraDraw = 0;
  }
  e.state.cells = e.makeBoard(e.state.size);
  e.state.current = 'ai';
  e.state.phase = 'main';
  e.state.status = 'playing';
  e.state.placed = false;
  e.state.seals = {};
  e.state.noDraft = true;
  e.state.lastMove = null;
  return e;
}

function put(e, side, r, c) {
  e.state.cells[r][c] = { uid: 's' + (++e.uid), owner: side, doubled: false, placedPly: 0 };
}

function give(e, side, id) {
  const entry = { uid: 't' + (++e.uid), id };
  e.state.players[side].hand.push(entry);
  return entry;
}

function aiFor(e, difficulty = 'hard') {
  const ai = new AI(e, { difficulty, seed: 12345 });
  ai.config = { ...ai.config, sleep: 0 };
  return ai;
}

console.log('\n七曜牌局 · 简化版 AI 测试\n');

test('AI 会落子并结束回合', async () => {
  const e = freshAI();
  const ai = aiFor(e, 'normal');
  await ai.takeTurn();
  assert.strictEqual(e.state.stats.stonesPlaced, 1);
  assert.strictEqual(e.state.current, 'player');
});

test('AI 会用双生星完成六连', async () => {
  const e = freshAI();
  for (let c = 0; c < 5; c++) put(e, 'ai', 10, c);
  give(e, 'ai', 'twin');
  const ai = aiFor(e, 'hard');
  await ai.takeTurn();
  assert.strictEqual(e.state.status, 'over');
  assert.strictEqual(e.state.winner, 'ai');
});

test('AI 会处理超过 4 张的手牌并结束回合', async () => {
  const e = freshAI();
  for (let i = 0; i < 7; i++) give(e, 'ai', 'charge');
  const ai = aiFor(e, 'normal');
  await ai.takeTurn();
  assert.ok(e.state.players.ai.hand.length <= 4);
});

test('AI 在三条难度下都不会破坏对局状态', async () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const e = freshAI(100 + difficulty.length);
    for (let c = 2; c <= 5; c++) put(e, 'ai', 8, c);
    give(e, 'ai', 'twin');
    give(e, 'ai', 'charge');
    const ai = aiFor(e, difficulty);
    await ai.takeTurn();
    assert.ok(['playing', 'over'].includes(e.state.status));
    assert.ok(e.state.players.ai.hand.length <= 4);
  }
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
    }
  }
  console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
  if (failed) process.exit(1);
})();
