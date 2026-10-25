/* 七曜牌局 — 规则引擎回归测试
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
  e.state.players.player.hand = [];
  e.state.players.ai.hand = [];
  e.state.players.player.deck = [];
  e.state.players.ai.deck = [];
  e.state.players.player.discard = [];
  e.state.players.ai.discard = [];
  e.state.phase = 'main';
  e.state.current = 'player';
  e.state.status = 'playing';
  e.state.cardPlayed = false;
  e.state.placed = false;
  e.state.skipPlace = false;
  e.state.forced = null;
  return e;
}

function give(e, side, cardId) {
  const entry = { uid: 'test-' + (++e.uid), id: cardId };
  e.state.players[side].hand.push(entry);
  return entry;
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

function setTurn(e, side, phase = 'main') {
  e.state.current = side;
  e.state.phase = phase;
  e.state.status = 'playing';
  e.state.cardPlayed = false;
  e.state.cardsPlayedThisTurn = 0;   // 和 startTurn 保持一致
  e.state.instantPlayed = 0;
  e.state.delayedPlayed = 0;
  e.state.placed = phase === 'post';
  e.state.moved = false;
  e.state.skipPlace = false;
}

console.log('\n七曜牌局 · 引擎测试\n');

test('七子连珠立即获胜', () => {
  const e = fresh();
  for (let c = 0; c < 6; c++) put(e, 'player', 6, c);
  const result = e.place('player', 6, 6);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(e.state.status, 'over');
  assert.strictEqual(e.state.winner, 'player');
  assert.strictEqual(e.state.winLine.cells.length, 7);
});

test('双生星按 2 枚计算并组成 7 连', () => {
  const e = fresh();
  for (let c = 1; c <= 5; c++) put(e, 'player', 6, c);
  const twin = give(e, 'player', 'twin');
  assert.strictEqual(e.playCard('player', twin.uid).ok, true);
  const result = e.place('player', 6, 6);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(e.state.winner, 'player');
  assert.strictEqual(e.state.winLine.weight, 7);
});

test('六合改命把胜利条件改为 6 并即时判定', () => {
  const e = fresh();
  for (let c = 0; c < 6; c++) put(e, 'player', 6, c);
  e.state.lastPlaced.player = '6,5';
  setTurn(e, 'player', 'post');
  const six = give(e, 'player', 'sixfold');
  const result = e.playCard('player', six.uid);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(e.state.players.player.winTarget, 6);
  assert.strictEqual(e.state.status, 'over');
  assert.strictEqual(e.state.winner, 'player');
});

test('四方封在落子后封锁四邻', () => {
  const e = fresh();
  const seal = give(e, 'player', 'sealOrtho');
  assert.strictEqual(e.playCard('player', seal.uid).ok, true);
  const result = e.place('player', 6, 6);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(e.isSealed(5, 6), true);
  assert.strictEqual(e.isSealed(7, 6), true);
  assert.strictEqual(e.isSealed(6, 5), true);
  assert.strictEqual(e.isSealed(6, 7), true);
  assert.strictEqual(e.isSealed(5, 5), false);
  e.state.phase = 'main';
  assert.strictEqual(e.canPlace('player', 5, 6), false);
});

test('斜四封在落子后封锁四个斜角', () => {
  const e = fresh();
  const seal = give(e, 'player', 'sealDiag');
  e.playCard('player', seal.uid);
  e.place('player', 6, 6);
  assert.strictEqual(e.isSealed(5, 5), true);
  assert.strictEqual(e.isSealed(7, 7), true);
  assert.strictEqual(e.isSealed(5, 7), true);
  assert.strictEqual(e.isSealed(7, 5), true);
  assert.strictEqual(e.isSealed(5, 6), false);
});

test('拓界将星盘扩大一圈并整体平移棋子', () => {
  const e = fresh();
  put(e, 'player', 6, 6);
  e.state.lastPlaced.player = '6,6';
  const expand = give(e, 'player', 'expand');
  const result = e.playCard('player', expand.uid);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(e.state.size, 15);
  assert.strictEqual(e.getStone(7, 7).owner, 'player');
  assert.strictEqual(e.getStone(6, 6), null);
  assert.strictEqual(e.state.lastPlaced.player, '7,7');
});

test('崩星摧毁自身与周围八格，金身免疫敌方爆裂', () => {
  const e = fresh();
  put(e, 'player', 5, 5);
  put(e, 'player', 5, 6, { shieldUntil: 999 });
  put(e, 'player', 6, 5);
  put(e, 'ai', 8, 8);
  setTurn(e, 'ai');
  e.state.players.ai.nextAura = { type: 'ruin', createdPly: 0 };
  const result = e.place('ai', 6, 6);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(e.getStone(6, 6), null);
  assert.strictEqual(e.getStone(5, 5), null);
  assert.strictEqual(e.getStone(5, 6).owner, 'player');
  assert.strictEqual(e.getStone(8, 8).owner, 'ai');
});

test('挪星步移动己方星子并代替落子', () => {
  const e = fresh();
  put(e, 'player', 6, 6);
  const shift = give(e, 'player', 'shift');
  const result = e.playCard('player', shift.uid, {
    from: { r: 6, c: 6 },
    to: { r: 6, c: 7 }
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(e.state.phase, 'post');
  assert.strictEqual(e.getStone(6, 6), null);
  assert.strictEqual(e.getStone(6, 7).owner, 'player');
  assert.strictEqual(e.canPlace('player', 5, 5), false);
});

test('逐客令推动敌子，金身目标不可选', () => {
  const e = fresh();
  put(e, 'ai', 6, 6);
  const repel = give(e, 'player', 'repel');
  assert.strictEqual(e.getCardTargets('player', 'repel').length, 1);
  const result = e.playCard('player', repel.uid, {
    from: { r: 6, c: 6 },
    to: { r: 6, c: 7 }
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(e.getStone(6, 7).owner, 'ai');

  const e2 = fresh();
  put(e2, 'ai', 6, 6, { shieldUntil: 999 });
  give(e2, 'player', 'repel');
  assert.strictEqual(e2.getCardTargets('player', 'repel').length, 0);
});

test('定身咒强制对方下一手落点', () => {
  const e = fresh();
  const pin = give(e, 'player', 'pin');
  assert.strictEqual(e.playCard('player', pin.uid, { r: 3, c: 3 }).ok, true);
  assert.deepStrictEqual({ r: e.state.forced.r, c: e.state.forced.c }, { r: 3, c: 3 });
  e.place('player', 6, 6);
  e.endTurn('player');
  assert.strictEqual(e.state.current, 'ai');
  const cells = e.getPlacementCells('ai');
  assert.strictEqual(cells.length, 1);
  assert.deepStrictEqual(cells[0], { r: 3, c: 3 });
  const bad = e.place('ai', 4, 4);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(e.place('ai', 3, 3).ok, true);
});

test('金身阻止敌方位移与爆裂', () => {
  const e = fresh();
  put(e, 'player', 6, 6);
  e.state.lastPlaced.player = '6,6';
  setTurn(e, 'player', 'post');
  const aegis = give(e, 'player', 'aegis');
  assert.strictEqual(e.playCard('player', aegis.uid, { r: 6, c: 6 }).ok, true);
  assert.ok(e.getStone(6, 6).shieldUntil > e.state.ply);

  setTurn(e, 'ai');
  give(e, 'ai', 'repel');
  assert.strictEqual(e.getCardTargets('ai', 'repel').length, 0);

  e.state.players.ai.nextAura = { type: 'ruin', createdPly: 0 };
  e.place('ai', 5, 6);
  assert.strictEqual(e.getStone(6, 6).owner, 'player');
});

test('换影交换对方新子与锚点', () => {
  const e = fresh();
  put(e, 'player', 6, 5);
  e.state.lastPlaced.player = '6,5';
  setTurn(e, 'player', 'post');
  const mirror = give(e, 'player', 'mirror');
  assert.strictEqual(e.playCard('player', mirror.uid).ok, true);
  assert.strictEqual(e.state.players.player.secrets.length, 1);

  setTurn(e, 'ai');
  assert.strictEqual(e.place('ai', 7, 7).ok, true);
  assert.strictEqual(e.getStone(7, 7).owner, 'player');
  assert.strictEqual(e.getStone(6, 5).owner, 'ai');
  assert.strictEqual(e.state.players.player.secrets.length, 0);
});

test('噤声使对方下一张牌失效并消耗', () => {
  const e = fresh();
  setTurn(e, 'player', 'post');
  const silence = give(e, 'player', 'silence');
  assert.strictEqual(e.playCard('player', silence.uid).ok, true);

  setTurn(e, 'ai');
  const twin = give(e, 'ai', 'twin');
  const result = e.playCard('ai', twin.uid);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.nullified, true);
  assert.strictEqual(e.state.players.ai.nextAura, null);
  assert.strictEqual(e.state.players.ai.hand.length, 0);
  assert.strictEqual(e.state.players.ai.discard.length, 1);
});

test('策反将对方落入 3×3 的星子转为我方', () => {
  const e = fresh();
  setTurn(e, 'player', 'post');
  const subvert = give(e, 'player', 'subvert');
  assert.strictEqual(e.playCard('player', subvert.uid, { r: 6, c: 6 }).ok, true);
  assert.strictEqual(e.state.zones.length, 1);

  setTurn(e, 'ai');
  assert.strictEqual(e.place('ai', 6, 7).ok, true);
  assert.strictEqual(e.getStone(6, 7).owner, 'player');
  assert.strictEqual(e.state.zones.length, 0);
});

test('牌库耗尽时洗回弃牌堆', () => {
  const e = fresh();
  e.state.players.player.deck = [];
  e.state.players.player.discard = [
    { uid: 'd1', id: 'twin' },
    { uid: 'd2', id: 'ruin' }
  ];
  const drawn = e.draw('player', 1);
  assert.strictEqual(drawn.length, 1);
  assert.strictEqual(e.state.players.player.hand.length, 1);
  assert.strictEqual(e.state.players.player.deck.length, 1);
  assert.strictEqual(e.state.players.player.discard.length, 0);
});

test('手牌上限会弃置新抽到的牌', () => {
  const e = fresh();
  for (let i = 0; i < 7; i++) give(e, 'player', 'twin');
  e.state.players.player.deck = [{ uid: 'extra', id: 'ruin' }];
  e.draw('player', 1);
  assert.strictEqual(e.state.players.player.hand.length, 7);
  assert.strictEqual(e.state.players.player.discard.length, 1);
});

test('定身目标格被占用后自动解除', () => {
  const e = fresh();
  e.state.forced = { target: 'player', r: 3, c: 3, by: 'ai', expiresPly: 99 };
  put(e, 'ai', 3, 3);
  e.checkForcedValidity();
  assert.strictEqual(e.state.forced, null);
  assert.ok(e.canPlace('player', 4, 4));
});

test('被定身时不能使用位移牌跳过落子', () => {
  const e = fresh();
  put(e, 'player', 6, 6);
  e.state.forced = { target: 'player', r: 3, c: 3, by: 'ai', expiresPly: 99 };
  const shift = give(e, 'player', 'shift');
  const check = e.canPlayCard('player', shift.uid);
  assert.strictEqual(check.ok, false);
  assert.match(check.reason, /定身/);
});


/* ---------------- 关卡权能 ---------------- */

function bossEngine(seed = 11) {
  const e = fresh(seed);
  e.state.bossSkills = ['campSwap', 'doubleCard'];
  return e;
}

test('权能·双术：偶数回合 BOSS 能出一张即时 + 一张延时', () => {
  const e = bossEngine();
  e.state.round = 2;              // 偶数回合
  setTurn(e, 'ai');
  const pin = give(e, 'ai', 'pin');
  assert.strictEqual(e.playCard('ai', pin.uid, { r: 3, c: 3 }).ok, true);
  // 同一个 AI 回合，落子之后还能再布一张延时牌
  e.place('ai', 6, 6);
  const aegis = give(e, 'ai', 'aegis');
  const second = e.playCard('ai', aegis.uid, { r: 6, c: 6 });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(e.state.cardsPlayedThisTurn, 2);
  // 第三张就没有配额了
  const extra = give(e, 'ai', 'sixfold');
  assert.strictEqual(e.playCard('ai', extra.uid).ok, false);
});

test('权能·双术：奇数回合只能出一张，玩家永远只有一张', () => {
  const e = bossEngine();
  e.state.round = 1;              // 奇数回合
  setTurn(e, 'ai');
  const pin = give(e, 'ai', 'pin');
  assert.strictEqual(e.playCard('ai', pin.uid, { r: 3, c: 3 }).ok, true);
  e.place('ai', 6, 6);
  const aegis = give(e, 'ai', 'aegis');
  assert.strictEqual(e.playCard('ai', aegis.uid, { r: 6, c: 6 }).ok, false);

  const p = bossEngine();
  p.state.round = 2;
  setTurn(p, 'player');
  const s1 = give(p, 'player', 'pin');
  assert.strictEqual(p.playCard('player', s1.uid, { r: 3, c: 3 }).ok, true);
  p.place('player', 6, 6);
  const s2 = give(p, 'player', 'aegis');
  assert.strictEqual(p.playCard('player', s2.uid, { r: 6, c: 6 }).ok, false);
});

test('权能·换营：玩家第 2 次连成五子时双方星子易主', () => {
  const e = bossEngine();
  e.state.round = 3;
  setTurn(e, 'player');
  for (let c = 1; c <= 4; c++) put(e, 'player', 2, c);
  e.place('player', 2, 5);                 // 第一条五连 → 计数 1，不换
  assert.strictEqual(e.state.campSwapCount, 1);
  assert.strictEqual(e.state.campSwaps, 0);
  assert.strictEqual(e.getStone(2, 5).owner, 'player');

  setTurn(e, 'player');
  for (let c = 1; c <= 4; c++) put(e, 'player', 9, c);
  e.place('player', 9, 5);                 // 第二条五连 → 计数 2 → 换营
  assert.strictEqual(e.state.campSwapCount, 2);
  assert.strictEqual(e.state.campSwaps, 1);
  assert.strictEqual(e.getStone(2, 5).owner, 'ai', '玩家的五连应当变成墨鸦的');
  assert.strictEqual(e.getStone(9, 5).owner, 'ai');
});

test('权能·换营：墨鸦已经占优时不发动', () => {
  const e = bossEngine();
  // 墨鸦一条六连、两头开着（4e6 级）；玩家这条五连被两头堵死（3e4 级）
  for (let c = 3; c <= 8; c++) put(e, 'ai', 5, c);
  put(e, 'ai', 2, 0);
  put(e, 'ai', 2, 6);
  setTurn(e, 'player');
  for (let c = 1; c <= 4; c++) put(e, 'player', 2, c);
  e.state.playerRuns = new Set();
  e.state.campSwapCount = 1;               // 假装已经连过一次
  e.place('player', 2, 5);                 // 这一次计数变 2，但墨鸦占优
  assert.strictEqual(e.state.campSwapCount, 2);
  assert.strictEqual(e.state.campSwaps, 0, '墨鸦占优时不该换营');
  assert.strictEqual(e.state.campSwapSuppressed, 1);
  assert.strictEqual(e.getStone(2, 5).owner, 'player');
});

test('权能·换营：没有这项权能的关卡不计数', () => {
  const e = fresh(12);
  setTurn(e, 'player');
  for (let c = 1; c <= 4; c++) put(e, 'player', 2, c);
  e.place('player', 2, 5);
  assert.strictEqual(e.state.campSwapCount, 0);
  assert.strictEqual(e.state.campSwaps, 0);
});

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
if (failed) process.exit(1);
