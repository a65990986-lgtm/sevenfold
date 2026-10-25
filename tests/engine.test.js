/* 七曜牌局 · 简化版 — 规则测试
 * 运行：node tests/engine.test.js
 */
'use strict';

const assert = require('assert');
const { Engine } = require('../js/engine.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

function fresh(seed = 7) {
  const e = new Engine({ seed });
  for (const side of ['player', 'ai']) {
    const p = e.state.players[side];
    p.hand = [];
    p.deck = [];
    p.discard = [];
    p.mana = 4;
    p.maxMana = 4;
    p.winTarget = 7;
    p.silenced = false;
    p.nextMana = 0;
    p.extraDraw = 0;
  }
  e.state.current = 'player';
  e.state.phase = 'main';
  e.state.status = 'playing';
  e.state.placed = false;
  e.state.cardsPlayedThisTurn = 0;
  e.state.seals = {};
  e.state.noDraft = true;
  e.state.lastMove = null;
  return e;
}

function put(e, side, r, c, doubled = false) {
  const stone = { uid: 's' + (++e.uid), owner: side, doubled, placedPly: e.state.ply };
  e.state.cells[r][c] = stone;
  return stone;
}

function give(e, side, id) {
  const entry = { uid: 't' + (++e.uid), id };
  e.state.players[side].hand.push(entry);
  return entry;
}

function clearBoard(e) {
  e.state.cells = e.makeBoard(e.state.size);
}

console.log('\n七曜牌局 · 简化版规则测试\n');

test('开局：20×20、起手 4 张、体力 4，并立即 4 选 2', () => {
  const e = new Engine({ seed: 1 });
  assert.strictEqual(e.state.size, 20);
  assert.strictEqual(e.state.players.player.hand.length, 4);
  assert.strictEqual(e.state.players.player.deck.length, 18);
  assert.strictEqual(e.state.players.player.mana, 4);
  assert.strictEqual(e.state.round, 1);
  assert.strictEqual(e.state.phase, 'draft');
  assert.strictEqual(e.state.offer.length, 4);
  assert.strictEqual(e.rules.draftPick, 2);
  assert.strictEqual(e.state.players.player.winTarget, 7);
});

test('七子连珠获胜', () => {
  const e = fresh();
  clearBoard(e);
  for (let c = 0; c < 6; c++) put(e, 'player', 10, c);
  const r = e.place('player', 10, 6);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(e.state.status, 'over');
  assert.strictEqual(e.state.winner, 'player');
  assert.strictEqual(e.state.winLine.cells.length, 7);
});

test('双生星使一枚星子计为 2 枚', () => {
  const e = fresh();
  clearBoard(e);
  for (let c = 0; c < 5; c++) put(e, 'player', 10, c);
  put(e, 'player', 10, 5, true);
  assert.strictEqual(e.findWin('player').target, 7);
  const card = give(e, 'player', 'twin');
  e.state.cells[10][5].doubled = false;
  const r = e.playCard('player', card.uid, { r: 10, c: 5 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(e.state.status, 'over');
});

test('四方封封锁上下左右四格', () => {
  const e = fresh();
  clearBoard(e);
  const card = give(e, 'player', 'sealOrtho');
  const r = e.playCard('player', card.uid, { r: 10, c: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(e.isSealed(9, 10), true);
  assert.strictEqual(e.isSealed(10, 9), true);
  assert.strictEqual(e.isSealed(10, 10), false);
});

test('八方封封锁周围八格', () => {
  const e = fresh();
  clearBoard(e);
  const card = give(e, 'player', 'sealAll');
  e.playCard('player', card.uid, { r: 5, c: 5 });
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    assert.strictEqual(e.isSealed(5 + dr, 5 + dc), true);
  }
});

test('挪星步移动己方星子', () => {
  const e = fresh();
  clearBoard(e);
  put(e, 'player', 10, 10);
  const card = give(e, 'player', 'shift');
  const r = e.playCard('player', card.uid, { from: { r: 10, c: 10 }, to: { r: 9, c: 10 } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(e.getStone(10, 10), null);
  assert.strictEqual(e.getStone(9, 10).owner, 'player');
});

test('崩星清除目标及周围八格', () => {
  const e = fresh();
  clearBoard(e);
  put(e, 'ai', 9, 9);
  put(e, 'ai', 9, 10);
  put(e, 'ai', 10, 10);
  const card = give(e, 'player', 'ruin');
  const r = e.playCard('player', card.uid, { r: 10, c: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(e.getStone(10, 10), null);
  assert.strictEqual(e.getStone(9, 9), null);
  assert.strictEqual(e.getStone(9, 10), null);
});

test('换影交换任意两枚棋子', () => {
  const e = fresh();
  clearBoard(e);
  put(e, 'player', 5, 5);
  put(e, 'ai', 6, 6);
  const card = give(e, 'player', 'swap');
  const r = e.playCard('player', card.uid, { first: { r: 5, c: 5 }, second: { r: 6, c: 6 } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(e.getStone(5, 5).owner, 'ai');
  assert.strictEqual(e.getStone(6, 6).owner, 'player');
});

test('策反转化目标及上下左右四格', () => {
  const e = fresh();
  clearBoard(e);
  put(e, 'ai', 10, 10);
  put(e, 'ai', 9, 10);
  put(e, 'ai', 11, 10);
  put(e, 'ai', 10, 9);
  put(e, 'ai', 10, 11);
  put(e, 'ai', 9, 9);
  const card = give(e, 'player', 'subvert');
  const r = e.playCard('player', card.uid, { r: 10, c: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(e.getStone(10, 10).owner, 'player');
  assert.strictEqual(e.getStone(9, 10).owner, 'player');
  assert.strictEqual(e.getStone(11, 10).owner, 'player');
  assert.strictEqual(e.getStone(10, 9).owner, 'player');
  assert.strictEqual(e.getStone(10, 11).owner, 'player');
  assert.strictEqual(e.getStone(9, 9).owner, 'ai');
});

test('封锁让对手下一张牌失效，但仍扣体力', () => {
  const e = fresh();
  clearBoard(e);
  const silence = give(e, 'player', 'silence');
  e.playCard('player', silence.uid, {});
  assert.strictEqual(e.state.players.ai.silenced, true);
  e.state.current = 'ai';
  const card = give(e, 'ai', 'charge');
  e.state.players.ai.mana = 4;
  const r = e.playCard('ai', card.uid, {});
  assert.strictEqual(r.nullified, true);
  assert.strictEqual(e.state.players.ai.silenced, false);
});

test('六子改胜把胜利条件永久改为 6', () => {
  const e = fresh();
  clearBoard(e);
  for (let c = 0; c < 5; c++) put(e, 'player', 10, c);
  const card = give(e, 'player', 'sixwin');
  e.playCard('player', card.uid, {});
  assert.strictEqual(e.state.players.player.winTarget, 6);
  e.place('player', 10, 5);
  assert.strictEqual(e.state.status, 'over');
  assert.strictEqual(e.state.winner, 'player');
});

test('六子改胜成功后移出双方牌库/弃牌堆，后续不再抽出', () => {
  const e = fresh();
  clearBoard(e);
  e.state.players.player.deck = [{ uid: 'sw1', id: 'sixwin' }];
  e.state.players.ai.deck = [{ uid: 'sw2', id: 'sixwin' }];
  const card = give(e, 'player', 'sixwin');
  const r = e.playCard('player', card.uid, {});
  assert.strictEqual(r.ok, true);
  const all = [
    ...e.state.players.player.deck,
    ...e.state.players.player.discard,
    ...e.state.players.ai.deck,
    ...e.state.players.ai.discard
  ];
  assert.strictEqual(all.some(entry => entry.id === 'sixwin'), false);
  assert.strictEqual(e.state.retiredCards.filter(entry => entry.id === 'sixwin').length, 3);
});

test('额外抽牌与储能进入下回合资源', () => {
  const e = fresh();
  clearBoard(e);
  const extra = give(e, 'player', 'extra');
  const store = give(e, 'player', 'store');
  e.playCard('player', extra.uid, {});
  e.playCard('player', store.uid, {});
  e.state.players.player.deck = [{ uid: 'd1', id: 'sealOrtho' }, { uid: 'd2', id: 'charge' }];
  e.state.ply = 1;
  e.startTurn('player');
  assert.strictEqual(e.state.players.player.hand.length, 2);
  assert.strictEqual(e.state.players.player.mana, 5);
});

test('蓄力本回合 +1 体力，省力使一张牌费用为 0', () => {
  const e = fresh();
  clearBoard(e);
  e.state.players.player.mana = 3;
  const charge = give(e, 'player', 'charge');
  e.playCard('player', charge.uid, {});
  assert.strictEqual(e.state.players.player.mana, 4);
  const discount = give(e, 'player', 'discount');
  const target = give(e, 'player', 'ruin');
  e.state.players.player.mana = 4;
  e.playCard('player', discount.uid, { uid: target.uid });
  assert.strictEqual(e.cardCost(target), 0);
});

test('补给给出的四张卡牌不重复', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const e = new Engine({ seed });
    const ids = e.state.offer.map(entry => entry.id);
    assert.strictEqual(ids.length, 4);
    assert.strictEqual(new Set(ids).size, 4);
  }
});

test('4 选 2 补给后加入手牌，未选牌进弃牌堆', () => {
  const e = fresh();
  clearBoard(e);
  e.state.players.player.deck = [
    { uid: 'o1', id: 'sealOrtho' },
    { uid: 'o2', id: 'twin' },
    { uid: 'o3', id: 'shift' },
    { uid: 'o4', id: 'ruin' }
  ];
  e.startDraft();
  assert.strictEqual(e.state.offer.length, 4);
  const r = e.chooseOffer([0, 1]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(e.state.players.player.hand.length, 2);
  assert.strictEqual(e.state.players.player.discard.length, 2);
  assert.strictEqual(e.state.phase, 'main');
});

test('手牌超过 4 张必须弃牌；未落子不能结束回合', () => {
  const e = fresh();
  clearBoard(e);
  for (let i = 0; i < 5; i++) give(e, 'player', 'charge');
  e.state.players.player.hand.push({ uid: 'x', id: 'charge' });
  e.state.current = 'player';
  e.state.placed = false;
  const noPlace = e.endTurn('player');
  assert.strictEqual(noPlace.ok, false);
  e.place('player', 10, 10);
  const noDiscard = e.endTurn('player');
  assert.strictEqual(noDiscard.ok, false);
  e.discard('player', [e.state.players.player.hand[0].uid, e.state.players.player.hand[1].uid]);
  assert.strictEqual(e.state.players.player.hand.length, 4);
});

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
if (failed) process.exit(1);
