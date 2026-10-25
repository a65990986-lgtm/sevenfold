/* 七曜牌局 · LLM 模块测试（不需要真密钥：全部用假的 fetch）
 * 运行：node tests/llm.test.js
 */
'use strict';

const assert = require('assert');
const { Engine } = require('../js/engine.js');
const LLM = require('../js/llm.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch(err => { failed++; console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); });
}

function fakeFetch(reply, capture) {
  return async (url, init) => {
    if (capture) {
      capture.url = url;
      capture.body = init && init.body ? JSON.parse(init.body) : null;
      capture.headers = init && init.headers;
    }
    if (typeof reply === 'function') return reply(url, init);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] })
    };
  };
}

function reply(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] })
  };
}

function errorReply(status, text) {
  return {
    ok: false,
    status,
    text: async () => text || '',
    json: async () => ({})
  };
}

function freshEngine() {
  const e = new Engine({ seed: 3 });
  e.state.noDraft = true;
  e.state.phase = 'main';
  e.state.current = 'ai';
  e.state.offer = null;
  e.state.cells = e.makeBoard(20);
  e.state.players.ai.mana = 4;
  e.state.players.ai.hand = [
    { uid: 'h1', id: 'twin' },
    { uid: 'h2', id: 'charge' }
  ];
  e.state.cells[9][9] = { uid: 's1', owner: 'ai', doubled: false, placedPly: 0 };
  e.state.cells[8][9] = { uid: 's2', owner: 'player', doubled: false, placedPly: 0 };
  return e;
}

(async () => {
  console.log('\n七曜牌局 · LLM 模块测试\n');

  await test('extractJson 能吃下代码围栏、全角标点、尾逗号', () => {
    const a = LLM.extractJson('```json\n{"place": 3, "cards": [],}\n```');
    assert.deepStrictEqual(a, { place: 3, cards: [] });
    const b = LLM.extractJson('好的：｛"place"：5，"cards"：［］｝');
    assert.deepStrictEqual(b, { place: 5, cards: [] });
    assert.strictEqual(LLM.extractJson('完全不是 JSON'), null);
  });

  await test('chat 会关掉思考模式，并读出正文', async () => {
    const cap = {};
    const out = await LLM.chat({
      baseURL: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'demo',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fakeFetch('{"place":1}', cap)
    });
    assert.strictEqual(cap.url, 'https://example.com/v1/chat/completions');
    assert.strictEqual(cap.body.thinking.type, 'disabled');
    assert.strictEqual(cap.body.max_tokens, 3000);
    assert.strictEqual(cap.headers.Authorization, 'Bearer sk-test');
    assert.strictEqual(out.text, '{"place":1}');
  });

  await test('chat 遇到 401 会给出密钥提示', async () => {
    let msg = '';
    try {
      await LLM.chat({
        baseURL: 'https://example.com/v1', apiKey: 'bad', model: 'demo',
        messages: [], fetchImpl: async () => errorReply(401, 'unauthorized')
      });
    } catch (err) { msg = err.message; }
    assert.ok(msg.includes('401'), msg);
    assert.ok(msg.includes('密钥'), msg);
  });

  await test('chat 遇到 finish_reason=length 会明确说被截断', async () => {
    let code = '';
    try {
      await LLM.chat({
        baseURL: 'https://example.com/v1', apiKey: 'k', model: 'demo', messages: [],
        fetchImpl: async () => ({
          ok: true, status: 200,
          json: async () => ({ choices: [{ message: { content: '{"pl' }, finish_reason: 'length' }] })
        })
      });
    } catch (err) { code = err.code + '|' + err.message; }
    assert.ok(code.startsWith('parse'), code);
    assert.ok(code.includes('截断'), code);
  });

  await test('提示词里有棋盘、手牌、编号落点', () => {
    const e = freshEngine();
    const msgs = LLM.buildTurnMessages(e, 'ai');
    const user = msgs[1].content;
    assert.ok(user.includes('第 1 回合'), '缺少回合');
    assert.ok(user.includes('体力 4/4'), '缺少体力');
    assert.ok(user.includes('(9,9)'), '缺少己方棋子');
    assert.ok(user.includes('1. ('), '缺少编号落点');
    assert.ok(user.includes('「双生星」'), '缺少手牌');
    assert.ok(msgs[0].content.includes('JSON'), 'system 没要求 JSON');
  });

  await test('normalizeTurn 接受编号落点 + 卡牌坐标', () => {
    const e = freshEngine();
    const cells = LLM.candidateCells(e.state, 40);
    const norm = LLM.normalizeTurn(e.state, e, 'ai', {
      why: '测试',
      place: 1,
      cards: [{ id: 'twin', r: 9, c: 9 }],
      discard: []
    }, cells);
    assert.strictEqual(norm.ok, true, norm.reason);
    assert.deepStrictEqual(norm.place, { r: cells[0].r, c: cells[0].c });
    assert.strictEqual(norm.cards.length, 1);
    assert.strictEqual(norm.cards[0].id, 'twin');
    assert.deepStrictEqual(norm.cards[0].payload, { r: 9, c: 9 });
  });

  await test('normalizeTurn 会拒掉越界编号 / 没有的牌 / 体力不够', () => {
    const e = freshEngine();
    const cells = LLM.candidateCells(e.state, 40);
    const bad1 = LLM.normalizeTurn(e.state, e, 'ai', { place: 999 }, cells);
    assert.strictEqual(bad1.ok, false);
    const bad2 = LLM.normalizeTurn(e.state, e, 'ai', { place: 1, cards: [{ id: 'ruin', r: 1, c: 1 }] }, cells);
    assert.strictEqual(bad2.ok, false, '手里没有崩星，应当拒绝');
    const bad3 = LLM.normalizeTurn(e.state, e, 'ai', { cards: [] }, cells);
    assert.strictEqual(bad3.ok, false, '缺少 place 应当拒绝');
    e.state.players.ai.hand = [{ uid: 'h9', id: 'ruin' }];
    e.state.players.ai.mana = 2;
    const bad4 = LLM.normalizeTurn(e.state, e, 'ai', { place: 1, cards: [{ id: 'ruin', r: 1, c: 1 }] }, cells);
    assert.strictEqual(bad4.ok, false, '体力 2 不够崩星（3 点），应当拒绝');
  });

  await test('normalizeTurn 也能用 uid / 手牌序号 / 卡名 指定卡牌', () => {
    const e = freshEngine();
    const cells = LLM.candidateCells(e.state, 40);
    // 用 uid
    const byUid = LLM.normalizeTurn(e.state, e, 'ai', { place: 1, cards: [{ id: 'h1', r: 9, c: 9 }] }, cells);
    assert.strictEqual(byUid.ok, true, byUid.reason);
    assert.strictEqual(byUid.cards[0].id, 'twin');
    // 用 1 起的序号（第 1 张是双生星）
    const byIndex = LLM.normalizeTurn(e.state, e, 'ai', { place: 1, cards: [{ id: 1, r: 9, c: 9 }] }, cells);
    assert.strictEqual(byIndex.ok, true, byIndex.reason);
    assert.strictEqual(byIndex.cards[0].id, 'twin');
    // 用中文卡名
    const byName = LLM.normalizeTurn(e.state, e, 'ai', { place: 1, cards: [{ id: '双生星', r: 9, c: 9 }] }, cells);
    assert.strictEqual(byName.ok, true, byName.reason);
    assert.strictEqual(byName.cards[0].id, 'twin');
    // 真没有的牌，报错里要列出手里有什么
    const bad = LLM.normalizeTurn(e.state, e, 'ai', { place: 1, cards: [{ id: 'c999' }] }, cells);
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.reason.includes('双生星'), bad.reason);
  });

  await test('normalizeDraft 只收 2 个合法编号', () => {
    const e = freshEngine();
    e.state.offer = [
      { uid: 'o1', id: 'twin' }, { uid: 'o2', id: 'ruin' },
      { uid: 'o3', id: 'swap' }, { uid: 'o4', id: 'charge' }
    ];
    const good = LLM.normalizeDraft(e.state, { pick: [1, 3] });
    assert.strictEqual(good.ok, true);
    assert.deepStrictEqual(good.picks, [0, 2]);
    assert.strictEqual(LLM.normalizeDraft(e.state, { pick: [1] }).ok, false);
    assert.strictEqual(LLM.normalizeDraft(e.state, { pick: [1, 9] }).ok, false);
  });

  await test('LLMSeat 第一次不合法会自动重问一次', async () => {
    const e = freshEngine();
    let call = 0;
    const seat = new LLM.LLMSeat(e, 'ai', {
      baseURL: 'https://example.com/v1', apiKey: 'k', model: 'm'
    }, {
      fetchImpl: async () => {
        call += 1;
        return call === 1 ? reply('{"place": 999}') : reply('{"place": 1}');
      }
    });
    const plan = await seat.decideTurn();
    assert.strictEqual(call, 2, '应当重试一次');
    assert.ok(plan.place);
  });

  await test('LLMSeat 连续不合法会抛 illegal', async () => {
    const e = freshEngine();
    const seat = new LLM.LLMSeat(e, 'ai', {
      baseURL: 'https://example.com/v1', apiKey: 'k', model: 'm'
    }, { fetchImpl: async () => reply('{"place": 999}') });
    let code = '';
    try { await seat.decideTurn(); } catch (err) { code = err.code; }
    assert.strictEqual(code, 'illegal');
  });

  await test('LLMSeat 遇到网络错误会抛 network，不偷偷换成本地 AI', async () => {
    const e = freshEngine();
    const seat = new LLM.LLMSeat(e, 'ai', {
      baseURL: 'https://example.com/v1', apiKey: 'k', model: 'm'
    }, { fetchImpl: async () => { throw new Error('boom'); } });
    let code = '';
    try { await seat.decideTurn(); } catch (err) { code = err.code; }
    assert.strictEqual(code, 'network');
  });

  await test('listModels 会取出 id 列表', async () => {
    const ids = await LLM.listModels({
      baseURL: 'https://example.com/v1', apiKey: 'k',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'a' }, { id: 'b' }] }) })
    });
    assert.deepStrictEqual(ids, ['a', 'b']);
  });

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed) process.exitCode = 1;
})();
