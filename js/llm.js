/* 七曜牌局 · LLM 对战模块
 *
 * 只走 OpenAI 兼容的 /chat/completions，不内置本地模型、不自动退回本地 AI：
 * 云端不通就明确报错，由玩家决定重试还是结束对局。
 *
 * 一份配置 = 一个「座位」：
 *   { label, baseURL, model, apiKey, thinking }
 *
 * 浏览器直接调云端要过 CORS：DeepSeek / MiniMax / 小米会回 CORS 头，
 * 智谱（bigmodel.cn）不回，直连会被浏览器拦掉。
 */
(function (root) {
  'use strict';

  // 2026-10 核对过的现役端点与模型名（模型名会变，报 404 就点「测试连接」看列表）
  const PRESETS = [
    {
      id: 'deepseek', name: 'DeepSeek', recommended: true,
      baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash',
      cors: true,
      note: '推荐：便宜、中文好、回 CORS。更强可以用 deepseek-v4-pro'
    },
    {
      id: 'zhipu', name: '智谱 GLM',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3',
      cors: false,
      note: '不返回 CORS 头，浏览器直连会被拦；GLM-5.3 强制思考，会慢一些'
    },
    {
      id: 'xiaomi', name: '小米 MiMo',
      baseURL: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-flash',
      cors: true,
      note: '回 CORS，可直连。更强可以用 mimo-v2.6-pro；V2.5 已停用'
    },
    {
      id: 'minimax', name: 'MiniMax',
      baseURL: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3.1-Flash',
      cors: true,
      note: '国内站；国际站换成 api.minimax.io/v1'
    },
    {
      id: 'openai', name: 'OpenAI',
      baseURL: 'https://api.openai.com/v1', model: 'gpt-5-mini',
      cors: true,
      note: '模型名随账号/地区变化，点「测试连接」可列出可用模型'
    },
    {
      id: 'custom', name: '自定义',
      baseURL: '', model: '', cors: null,
      note: '任何 OpenAI 兼容端点，例如自建的 vLLM / one-api / 硅基流动'
    }
  ];

  // 首次打开设置面板时的预填值（只预填地址和模型，密钥必须自己填）
  const DEFAULT_SEAT = {
    preset: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    apiKey: '',
    thinking: false
  };


  const DEFAULT_TIMEOUT = 90000;
  const MAX_TOKENS = 3000;

  class LLMError extends Error {
    constructor(code, message, detail) {
      super(message);
      this.name = 'LLMError';
      this.code = code;      // network | http | parse | illegal | config
      this.detail = detail;
    }
  }

  function joinURL(baseURL, path) {
    const base = String(baseURL || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    return base + path;
  }

  // 把各种「像 JSON 但又不是」的输出拉回来：全角标点、代码围栏、单引号、尾逗号
  function extractJson(text) {
    if (!text) return null;
    let raw = String(text).trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    raw = raw
      .replace(/[\uFF0C\u3001]/g, ',')   // ，、
      .replace(/[\uFF1A]/g, ':')          // ：
      .replace(/[\uFF1B]/g, ';')          // ；
      .replace(/[\u201C\u201D]/g, '"')    // “”
      .replace(/[\u2018\u2019]/g, "'")    // ‘’
      .replace(/[\uFF5B]/g, '{')
      .replace(/[\uFF5D]/g, '}')
      .replace(/[\uFF3B]/g, '[')
      .replace(/[\uFF3D]/g, ']')
      .replace(/[\uFF08]/g, '(')
      .replace(/[\uFF09]/g, ')');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let body = raw.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(body);
    } catch (err) {
      // 单引号 JSON
      try {
        return JSON.parse(body.replace(/'/g, '"'));
      } catch (err2) {
        return null;
      }
    }
  }

  async function chat(options) {
    const {
      baseURL, apiKey, model, messages,
      temperature = 0.7, maxTokens = MAX_TOKENS, timeoutMs = DEFAULT_TIMEOUT,
      thinking = false, fetchImpl = null
    } = options || {};
    const impl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!impl) throw new LLMError('env', '当前环境没有 fetch，无法请求模型（浏览器太旧或被策略禁用）');
    if (!baseURL || !model || !apiKey) throw new LLMError('config', '还没填完 baseURL / 模型名 / 密钥');
    const url = joinURL(baseURL, '/chat/completions');
    if (!url) throw new LLMError('config', 'baseURL 不合法');

    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };
    // 思考模式会吃掉 max_tokens 并拖慢响应；默认关掉，个别服务商不支持就自动重试
    if (thinking) body.thinking = { type: 'enabled' };
    else body.thinking = { type: 'disabled' };

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
      res = await impl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey
        },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      throw new LLMError('network', '请求没发出去：' + (err && err.message ? err.message : '网络错误'), url);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (err) { detail = ''; }
      // 有些服务商不认 thinking 字段，去掉再试一次
      if ([400, 422].includes(res.status) && /thinking/i.test(detail) && !options._retried) {
        return chat({ ...options, thinking: null, _retried: true });
      }
      const hint = res.status === 401 ? '（密钥不对？）'
        : res.status === 403 ? '（密钥没有权限？）'
          : res.status === 429 ? '（额度/频率超限）'
            : res.status === 404 ? '（baseURL 或模型名不对？）' : '';
      throw new LLMError('http', `HTTP ${res.status} ${hint}`, detail.slice(0, 400));
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new LLMError('parse', '返回的不是 JSON', '');
    }
    const choice = data && data.choices && data.choices[0];
    const text = choice && choice.message && choice.message.content;
    if (!text) throw new LLMError('parse', '模型没有返回内容', JSON.stringify(data).slice(0, 300));
    if (choice.finish_reason === 'length') {
      throw new LLMError('parse', '输出被截断了（max_tokens 不够），再试一次或换个模型', '');
    }
    return { text, usage: data.usage || null, raw: data };
  }

  async function listModels({ baseURL, apiKey, fetchImpl = null, timeoutMs = 20000 }) {
    const impl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!impl) throw new LLMError('env', '当前环境没有 fetch');
    const url = joinURL(baseURL, '/models');
    if (!url) throw new LLMError('config', 'baseURL 不合法');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await impl(url, {
        headers: { Authorization: 'Bearer ' + apiKey },
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) throw new LLMError('http', `HTTP ${res.status}`, '');
      const data = await res.json();
      const list = (data && (data.data || data.models)) || [];
      return list.map(item => (typeof item === 'string' ? item : item.id || item.name)).filter(Boolean);
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError('network', '连不上：' + (err && err.message ? err.message : '网络错误'), url);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------------ 提示词 */

  const SIDE_NAME = { player: '星火', ai: '墨鸦' };
  const TARGET_HINT = {
    cell: '指定一个格子',
    stoneOwn: '指定一枚己方星子',
    moveOwn: '指定己方星子的起点和终点',
    swap: '指定两枚棋子',
    handCard: '指定一张手牌',
    none: '不需要目标'
  };

  function boardText(state) {
    const size = state.size;
    const rows = [];
    for (let r = 0; r < size; r++) {
      let line = String(r).padStart(2, '0') + ' ';
      for (let c = 0; c < size; c++) {
        const stone = state.cells[r][c];
        line += !stone ? '.' : stone.owner === 'player' ? 'X' : 'O';
      }
      rows.push(line);
    }
    return rows.join('\n');
  }

  function stonesText(state, side) {
    const out = [];
    for (let r = 0; r < state.size; r++) {
      for (let c = 0; c < state.size; c++) {
        const stone = state.cells[r][c];
        if (stone && stone.owner === side) out.push(`(${r},${c})${stone.doubled ? '[双倍]' : ''}`);
      }
    }
    return out.length ? out.join(' ') : '（还没有子）';
  }

  // 合法落点太多，模型会瞎选；只给「已有棋子附近 2 格内」的，按靠近中心的顺序截断
  function candidateCells(state, limit = 40) {
    const size = state.size;
    const mid = (size - 1) / 2;
    const hasStone = [];
    const out = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (state.cells[r][c]) { hasStone.push([r, c]); continue; }
        if (state.seals && state.seals[r + ':' + c]) continue;
        let near = hasStone.length === 0;
        if (!near) {
          for (const [sr, sc] of hasStone) {
            if (Math.abs(sr - r) <= 2 && Math.abs(sc - c) <= 2) { near = true; break; }
          }
        }
        if (!near) continue;
        out.push({ r, c, d: Math.abs(r - mid) + Math.abs(c - mid) });
      }
    }
    if (!out.length) out.push({ r: Math.floor(mid), c: Math.floor(mid), d: 0 });
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, limit);
  }

  function handText(state, engine, side) {
    const p = state.players[side];
    if (!p.hand.length) return '（没有手牌）';
    return p.hand.map((entry, i) => {
      const card = engine.cardById(entry.id);
      if (!card) return `${i + 1}. ${entry.id}`;
      const cost = engine.cardCost(entry);
      return `${i + 1}. uid=${entry.uid} 「${card.name}」 体力 ${cost} · ${TARGET_HINT[card.target] || ''} · ${card.short || card.desc || ''}`;
    }).join('\n');
  }

  function buildTurnMessages(engine, side, options = {}) {
    const state = engine.state;
    const me = state.players[side];
    const foe = side === 'player' ? 'ai' : 'player';
    const foeName = SIDE_NAME[foe];
    const cells = candidateCells(state, 40);
    const list = cells.map((cell, i) => `${i + 1}. (${cell.r},${cell.c})`).join('  ');
    const hand = handText(state, engine, side);
    const target = me.winTarget;
    const mana = me.mana;
    const system = [
      `你是「七曜牌局」的棋手，执${SIDE_NAME[side]}（${side === 'player' ? 'X' : 'O'}）。`,
      `棋盘 ${state.size}×${state.size}，横、竖、斜先连成 ${target} 子者胜（双倍星子算 2 枚）。`,
      '每回合：体力回满 4，可以先打任意张术式（花体力），然后落 1 枚子；回合结束手牌最多 4 张。',
      '你只能从给出的编号落点里选；卡牌只能用手里的牌。',
      '只输出一个 JSON 对象，不要解释、不要代码围栏。'
    ].join('\n');

    const hint = options.errorHint ? `\n上一次的输出有错：${options.errorHint}\n请改正后重新输出。` : '';
    const user = [
      `第 ${state.round} 回合，体力 ${mana}/4，手牌 ${me.hand.length} 张，目标 ${target} 子。`,
      '',
      `棋盘（. 空，X 你，O ${foeName}）：`,
      boardText(state),
      '',
      `你的子：${stonesText(state, side)}`,
      `${foeName}的子：${stonesText(state, foe)}`,
      '',
      `可选落点（编号 → 坐标）：${list}`,
      '',
      '你的手牌：',
      hand,
      '',
      '输出格式：',
      '{"why":"一句话理由","place":3,"cards":[{"id":"twin","r":9,"c":9}],"discard":[]}',
      '- place：必填，上面编号里的一个数字（落子）。',
      '- cards：可选，按顺序施放的术式；target 需要的坐标写在 r/c（单格）或 from/to（移动）或 first/second（换影）或 targetUid（指定手牌）里。',
      '- discard：回合结束时手牌超过 4 张，填要弃掉的手牌 uid，否则留空数组。',
      '- 体力不够的牌不要写进去。',
      hint
    ].join('\n');

    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }

  function buildDraftMessages(engine, side, options = {}) {
    const state = engine.state;
    const offer = state.offer || [];
    const cards = offer.map((entry, i) => {
      const card = engine.cardById(entry.id);
      return `${i + 1}. 「${card ? card.name : entry.id}」 体力 ${card ? card.cost : '?'} · ${card ? card.short || card.desc : ''}`;
    }).join('\n');
    const system = [
      '你是「七曜牌局」的棋手。每回合开始会给你 4 张补给，你选 2 张，另外 2 张进弃牌堆。',
      '只输出一个 JSON 对象，不要解释、不要代码围栏。'
    ].join('\n');
    const hint = options.errorHint ? `\n上一次的输出有错：${options.errorHint}\n` : '';
    const user = [
      `可选补给：`,
      cards,
      '',
      '输出格式：{"pick":[1,3],"why":"一句话理由"}',
      '- pick 填 1-4 里的两个不同编号。',
      hint
    ].join('\n');
    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }

  /* ------------------------------------------------------------------ 归一化 */

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function coord(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const r = num(obj.r !== undefined ? obj.r : obj.row);
    const c = num(obj.c !== undefined ? obj.c : obj.col !== undefined ? obj.col : obj.column);
    if (r === null || c === null) return null;
    return { r, c };
  }

  function normalizeDraft(state, obj) {
    if (!obj || !Array.isArray(obj.pick)) return { ok: false, reason: '缺少 pick 数组' };
    const offer = state.offer || [];
    const picks = [...new Set(obj.pick.map(n => num(n) - 1).filter(n => n !== null))]
      .filter(n => n >= 0 && n < offer.length);
    if (picks.length !== 2) return { ok: false, reason: `pick 需要 2 个 1-${offer.length} 的编号` };
    return { ok: true, picks, why: String(obj.why || '') };
  }

  // 把模型输出转成引擎能执行的动作；任何一项不合法就整体拒绝，让上层重试
  function normalizeTurn(state, engine, side, obj, cells) {
    if (!obj || typeof obj !== 'object') return { ok: false, reason: '不是 JSON 对象' };
    const me = state.players[side];
    let place = null;
    if (obj.place !== undefined && obj.place !== null) {
      const idx = num(obj.place);
      if (idx === null) {
        const direct = coord(obj.place);
        if (direct) {
          if (!cells.some(cell => cell.r === direct.r && cell.c === direct.c)) {
            return { ok: false, reason: '落点不在候选列表里' };
          }
          place = direct;
        }
      } else {
        const cell = cells[idx - 1];
        if (!cell) return { ok: false, reason: `place 编号超出范围（1-${cells.length}）` };
        place = { r: cell.r, c: cell.c };
      }
    }
    if (!place) return { ok: false, reason: '缺少 place（必须落一子）' };

    const cards = [];
    if (obj.cards !== undefined && obj.cards !== null) {
      if (!Array.isArray(obj.cards)) return { ok: false, reason: 'cards 必须是数组' };
      for (const item of obj.cards) {
        if (!item || typeof item !== 'object') return { ok: false, reason: 'cards 里有一项不是对象' };
        const raw = item.id !== undefined ? item.id : (item.card !== undefined ? item.card : item.uid);
        const id = String(raw === undefined || raw === null ? '' : raw).trim();
        const byIndex = /^\d+$/.test(id) ? me.hand[Number(id) - 1] : null;   // 手牌序号（1 起）
        const entry = byIndex
          || me.hand.find(e => e.id === id)
          || me.hand.find(e => e.uid === id)
          || me.hand.find(e => e.uid === String(item.uid || ''))
          || me.hand.find(e => engine.cardById(e.id)?.name === id);
        if (!entry) {
          const names = me.hand.map((e, i) => `${i + 1}.${engine.cardById(e.id)?.name || e.id}(uid=${e.uid})`).join(' ');
          return { ok: false, reason: `手里没有这张牌：${id || '(空)'}。可选：${names}` };
        }
        const card = engine.cardById(entry.id);
        if (engine.cardCost(entry) > me.mana - cards.reduce((sum, c) => sum + c.cost, 0)) {
          return { ok: false, reason: `体力不够施放「${card ? card.name : entry.id}」` };
        }
        let payload = {};
        if (card.target === 'cell' || card.target === 'stoneOwn') {
          const at = coord(item) || coord(item.at);
          if (!at) return { ok: false, reason: `「${card.name}」需要 r/c 坐标` };
          payload = at;
        } else if (card.target === 'moveOwn') {
          const from = coord(item.from);
          const to = coord(item.to);
          if (!from || !to) return { ok: false, reason: '「挪星步」需要 from 和 to' };
          payload = { from, to };
        } else if (card.target === 'swap') {
          const first = coord(item.first);
          const second = coord(item.second);
          if (!first || !second) return { ok: false, reason: '「换影」需要 first 和 second' };
          payload = { first, second };
        } else if (card.target === 'handCard') {
          const uid = String(item.targetUid || item.uid2 || '');
          if (!uid) return { ok: false, reason: '「省力」需要 targetUid' };
          payload = { uid };
        }
        cards.push({ uid: entry.uid, id: entry.id, payload, cost: engine.cardCost(entry) });
      }
    }

    const discard = Array.isArray(obj.discard)
      ? obj.discard.map(x => String(x)).filter(Boolean)
      : [];
    return { ok: true, place, cards, discard, why: String(obj.why || '') };
  }

  /* ------------------------------------------------------------------ 座位 */

  class LLMSeat {
    constructor(engine, side, config, options = {}) {
      this.engine = engine;
      this.side = side;
      this.config = config;
      this.fetchImpl = options.fetchImpl || null;
    }

    get name() {
      return this.config.label || this.config.model || 'LLM';
    }

    async ask(messages) {
      const res = await chat({
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey,
        model: this.config.model,
        messages,
        temperature: this.config.temperature === undefined ? 0.7 : this.config.temperature,
        thinking: !!this.config.thinking,
        fetchImpl: this.fetchImpl
      });
      const json = extractJson(res.text);
      if (!json) throw new LLMError('parse', '没有从输出里解析出 JSON', res.text.slice(0, 300));
      return json;
    }

    async decideDraft() {
      const messages = buildDraftMessages(this.engine, this.side);
      const json = await this.ask(messages);
      const norm = normalizeDraft(this.engine.state, json);
      if (!norm.ok) {
        const retry = buildDraftMessages(this.engine, this.side, { errorHint: norm.reason });
        const json2 = await this.ask(retry);
        const norm2 = normalizeDraft(this.engine.state, json2);
        if (!norm2.ok) throw new LLMError('illegal', '补给选择不合法：' + norm2.reason, JSON.stringify(json2));
        return norm2;
      }
      return norm;
    }

    async decideTurn() {
      const cells = candidateCells(this.engine.state, 40);
      let lastReason = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const messages = buildTurnMessages(this.engine, this.side, { errorHint: lastReason });
        const json = await this.ask(messages);
        const norm = normalizeTurn(this.engine.state, this.engine, this.side, json, cells);
        if (norm.ok) return norm;
        lastReason = norm.reason;
        // 候选点可能因为别的原因变了（例如手牌被弃），重新算
        cells.length = 0;
        cells.push(...candidateCells(this.engine.state, 40));
      }
      throw new LLMError('illegal', '模型的落点/出牌不合法：' + lastReason, '');
    }
  }

  const lib = {
    PRESETS,
    DEFAULT_SEAT,
    LLMError,
    chat,
    listModels,
    extractJson,
    buildTurnMessages,
    buildDraftMessages,
    candidateCells,
    normalizeDraft,
    normalizeTurn,
    LLMSeat
  };
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.SevenfoldLLM = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this);
