/* 七曜牌局 — 人机「墨鸦」回归测试
 * 运行：node tests/ai.test.js
 *
 * 盯的是三类会直接送棋的错误：
 *   1. 有杀不杀 / 有杀不挡
 *   2. 看不见对方 pending 的双生星（下一子计 2 枚）
 *   3. 用「跳过落子」的位移牌去挡杀（等于弃守）
 */
'use strict';

const assert = require('assert');
const { Engine } = require('../js/engine.js');
const { AI } = require('../js/ai.js');

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) { tests.push({ name, fn }); }

function fresh(seed = 7) {
  const e = new Engine({ seed });
  for (const side of ['player', 'ai']) {
    const p = e.state.players[side];
    p.hand = [];
    p.deck = [];
    p.discard = [];
    p.secrets = [];
    p.nextAura = null;
    p.silenced = false;
    p.winTarget = 7;
  }
  e.state.phase = 'main';
  e.state.current = 'ai';   // 这些用例都是「轮到墨鸦」的局面
  e.state.status = 'playing';
  e.state.cardPlayed = false;
  e.state.placed = false;
  e.state.skipPlace = false;
  e.state.moved = false;
  e.state.forced = null;
  e.state.seals = {};
  e.state.zones = [];
  e.state.lastPlaced = { player: null, ai: null };
  return e;
}

function put(e, side, r, c, options = {}) {
  const stone = {
    uid: 'stone-' + (++e.uid),
    owner: side,
    doubled: !!options.doubled,
    shieldUntil: options.shieldUntil || 0,
    placedPly: e.state.ply
  };
  e.state.cells[r][c] = stone;
  return stone;
}

function give(e, side, cardId) {
  const entry = { uid: 'test-' + (++e.uid), id: cardId };
  e.state.players[side].hand.push(entry);
  return entry;
}

function makeAI(e, options = {}) {
  return new AI(e, { side: 'ai', difficulty: 'hard', seed: 12345, ...options });
}

const key = (r, c) => r + ',' + c;

test('有一步制胜的点时，直接落子取胜', () => {
  const e = fresh();
  for (let c = 3; c <= 8; c++) put(e, 'ai', 6, c);
  const ai = makeAI(e, { search: { depth: 4, timeMs: 0 } });
  const move = ai.choosePlacement();
  assert.ok(move, '应该给出落点');
  assert.ok(e.wouldWinAt(move.r, move.c, 'ai'), `落点 ${move.r},${move.c} 应该直接赢`);
});

test('对方下一步就能赢时，必须去挡', () => {
  const e = fresh();
  for (let c = 3; c <= 8; c++) put(e, 'player', 6, c);
  put(e, 'ai', 6, 2);           // 一头已经被堵，只剩 (6,9) 这一个杀点
  const ai = makeAI(e, { search: { depth: 4, timeMs: 0 } });
  const move = ai.choosePlacement();
  assert.deepStrictEqual({ r: move.r, c: move.c }, { r: 6, c: 9 });
});

test('看得见对方 pending 的双生星：五连 + 2 枚的杀点算进威胁', () => {
  const e = fresh();
  for (let c = 3; c <= 7; c++) put(e, 'player', 6, c);   // 五连
  put(e, 'ai', 6, 2);                                    // 左端堵死
  // 双生星待发：(6,8) 落下计 2 枚，5 + 2 = 7，对方下一手就赢。
  e.state.players.player.nextAura = { type: 'twin', createdPly: e.state.ply };
  const ai = makeAI(e, { search: { depth: 4, timeMs: 0 } });
  const wins = ai.getImmediateWins('player');
  assert.ok(wins.some(w => w.r === 6 && w.c === 8),
    '双生星待发时 (6,8) 就是对方的必胜点，威胁检测必须包含它');
  const move = ai.choosePlacement();
  assert.deepStrictEqual({ r: move.r, c: move.c }, { r: 6, c: 8 });
});

test('对方有杀时，即使有换位好棋也不打位移牌', () => {
  const e = fresh();
  for (let c = 3; c <= 8; c++) put(e, 'player', 6, c);
  put(e, 'ai', 6, 2);
  put(e, 'ai', 4, 4);
  put(e, 'ai', 4, 5);
  give(e, 'ai', 'shift');
  const ai = makeAI(e, { search: { depth: 4, timeMs: 0 } });
  // 固定随机数，让「打不打这张位移牌」变成确定性的判断，而不是 72% 的概率。
  ai.rng = () => 0;
  // 假装算到了一步「换位成双杀」的诱惑：门禁必须挡住它。
  ai.findForkMove = () => ({ from: { r: 4, c: 4 }, to: { r: 4, c: 6 } });
  const choice = ai.pickInstant();
  assert.ok(!choice || choice.entry.id !== 'shift',
    '对方下一手就能赢，这时换位等于弃守，不该打出去');
});

test('不会落在被封禁的格子上', () => {
  const e = fresh();
  for (let c = 4; c <= 8; c++) put(e, 'ai', 6, c);
  for (let c = 2; c <= 4; c++) put(e, 'player', 7, c);
  // 把最诱人的几个点封掉
  for (const [r, c] of [[6, 3], [6, 9], [5, 6], [7, 6]]) {
    e.state.seals[key(r, c)] = { by: 'player', untilPly: e.state.ply + 4, source: 'sealOrtho' };
  }
  const ai = makeAI(e, { search: { depth: 4, timeMs: 0 } });
  const move = ai.choosePlacement();
  assert.ok(!e.isSealed(move.r, move.c), `落点 ${move.r},${move.c} 是封禁格`);
  assert.ok(!e.state.cells[move.r][move.c], '落点不能已有子');
});

test('takeTurn 能走完一个完整回合（落子 → 结束回合）', async () => {
  const e = fresh(99);
  for (let c = 3; c <= 6; c++) put(e, 'ai', 6, c);
  for (let c = 3; c <= 6; c++) put(e, 'player', 7, c);
  put(e, 'ai', 5, 8);
  for (const id of ['sixfold', 'aegis', 'silence', 'subvert']) give(e, 'ai', id);
  e.state.current = 'ai';
  const ai = makeAI(e, { search: { depth: 2, timeMs: 0 } });
  await ai.takeTurn({ sleep: () => Promise.resolve() });
  const done = e.state.status !== 'playing' || (e.state.current === 'player' && e.state.ply > 0);
  assert.ok(done, `回合没有走完（status=${e.state.status} current=${e.state.current} ply=${e.state.ply}）`);
});

test('takeTurn 在没有必胜局面时也不会崩，并把回合交回', async () => {
  const e = fresh(31337);
  for (let r = 4; r <= 8; r++) put(e, 'ai', r, 6);
  for (let r = 4; r <= 8; r++) put(e, 'player', r, 7);
  put(e, 'player', 5, 5);
  for (const id of ['twin', 'sealOrtho', 'pin', 'expand', 'ruin', 'repel']) give(e, 'ai', id);
  give(e, 'ai', 'mirror');
  e.state.current = 'ai';
  const ai = makeAI(e, { search: { depth: 4, timeMs: 0 } });
  let thrown = null;
  try {
    await ai.takeTurn({ sleep: () => Promise.resolve() });
  } catch (err) {
    thrown = err;
  }
  assert.strictEqual(thrown, null, thrown ? thrown.stack : '');
  assert.ok(e.state.status !== 'playing' || e.state.current === 'player', '回合应当交回玩家');
});

test('偶数回合的 BOSS 会把「一张即时 + 一张延时」都用满', async () => {
  const e = fresh(4242);
  e.state.bossSkills = ['doubleCard', 'campSwap'];
  e.state.round = 2;                    // 偶数回合，双术生效
  for (let c = 5; c <= 7; c++) put(e, 'ai', 6, c);
  put(e, 'player', 7, 6);
  put(e, 'player', 7, 7);
  give(e, 'ai', 'pin');
  give(e, 'ai', 'aegis');
  e.state.current = 'ai';
  const ai = makeAI(e, { search: { depth: 2, timeMs: 0 } });
  ai.rng = () => 0;                     // 让「要不要出牌」变成确定性判断
  await ai.takeTurn({ sleep: () => Promise.resolve() });
  // 回合结束后 cardsPlayedThisTurn 会被重置，所以看累计值
  assert.strictEqual(e.state.stats.cardsPlayed, 2,
    `偶数回合应当打出两张牌，实际 ${e.state.stats.cardsPlayed}`);
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${t.name}`);
      console.error(`    ${err.message}`);
    }
  }
  console.log('');
  console.log(`结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})();
