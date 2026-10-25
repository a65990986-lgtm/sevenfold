/* 七曜牌局 · 简化版 — 规则引擎
 *
 * 20×20 六子连珠；双方起手 4 张；每回合体力回满 4；
 * 双方每回合 4 选 2 补给（开局也进行）；手牌上限 4；每回合可出任意张牌，但只能落一子。
 * 全部卡牌为即时术式，没有暗牌与延迟结算。
 */
(function (root, factory) {
  const cards = (typeof module === 'object' && module.exports)
    ? require('./cards.js')
    : root.SEVENFOLD_CARDS;
  const lib = factory(cards);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.SevenfoldEngine = lib.Engine;
  root.SEVENFOLD_RULES = lib.RULES;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CARD_LIB) {
  'use strict';

  const CARDS = CARD_LIB.BASIC_CARDS || CARD_LIB.CARDS;
  const BY_ID = CARD_LIB.BY_ID;

  const RULES = {
    initialSize: 20,
    winLength: 7,   // v1.1 起改回七子连珠；「改胜」可把己方目标降到 6
    startingHand: 4,
    maxMana: 4,
    handLimit: 4,
    draftCount: 4,
    draftPick: 2
  };

  const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const DIRS8 = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ];
  const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const opposite = side => (side === 'player' ? 'ai' : 'player');

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const keyOf = (r, c) => r + ',' + c;
  const parseKey = key => {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  };

  class Engine {
    constructor(options = {}) {
      this.rules = { ...RULES, ...(options.rules || {}) };
      this.listeners = [];
      this.newGame(options);
    }

    onEvent(fn) {
      this.listeners.push(fn);
      return () => {
        const i = this.listeners.indexOf(fn);
        if (i >= 0) this.listeners.splice(i, 1);
      };
    }

    emit(type, data = {}) {
      const event = { type, ...data };
      for (const fn of this.listeners) fn(event);
      return event;
    }

    newGame(options = {}) {
      this.seed = Number.isFinite(options.seed) ? options.seed : (Date.now() & 0xffffffff);
      this.rand = mulberry32(this.seed);
      this.uid = 0;
      this.state = {
        size: this.rules.initialSize,
        cells: this.makeBoard(this.rules.initialSize),
        current: 'player',
        phase: 'main',
        status: 'playing',
        ply: 0,
        round: 1,
        placed: false,
        cardsPlayedThisTurn: 0,
        winner: null,
        winLine: null,
        offer: null,
        aiOffer: null,
        seals: {},
        lastMove: null,
        players: {
          player: this.makePlayer(),
          ai: this.makePlayer()
        },
        stats: { stonesPlaced: 0, cardsPlayed: 0, captures: 0 }
      };
      this.dealOpeningHands();
      this.startTurn('player', { opening: true });
      this.emit('gameStart', { seed: this.seed });
      return this.state;
    }

    makeBoard(size) {
      return Array.from({ length: size }, () => Array(size).fill(null));
    }

    makePlayer() {
      return {
        hand: [],
        deck: [],
        discard: [],
        mana: this.rules.maxMana,
        maxMana: this.rules.maxMana,
        winTarget: this.rules.winLength,
        silenced: false,
        nextMana: 0,
        extraDraw: 0
      };
    }

    makeDeck() {
      const deck = [];
      for (const card of CARDS) {
        for (let i = 0; i < 2; i++) deck.push({ uid: 'c' + (++this.uid), id: card.id });
      }
      return this.shuffle(deck);
    }

    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    dealOpeningHands() {
      for (const side of ['player', 'ai']) {
        const p = this.state.players[side];
        p.deck = this.makeDeck();
        p.hand = this.takeFromDeck(p, this.rules.startingHand);
      }
    }

    // 补给专用：优先挑「id 不重复」的牌，挑不够再按老办法补
    takeDistinctFromDeck(p, count) {
      const out = [];
      const used = new Set();
      const picked = new Set();
      for (let i = 0; i < p.deck.length && out.length < count; i++) {
        const entry = p.deck[i];
        if (used.has(entry.id)) continue;
        used.add(entry.id);
        picked.add(entry.uid);
        out.push(entry);
      }
      if (picked.size) p.deck = p.deck.filter(entry => !picked.has(entry.uid));
      if (out.length < count) out.push(...this.takeFromDeck(p, count - out.length));
      return out;
    }

    takeFromDeck(p, count) {
      const out = [];
      while (out.length < count) {
        if (!p.deck.length) {
          if (!p.discard.length) break;
          p.deck = this.shuffle(p.discard.splice(0));
        }
        out.push(p.deck.shift());
      }
      return out;
    }

    draw(side, count, meta = {}) {
      const p = this.state.players[side];
      const drawn = this.takeFromDeck(p, count);
      for (const entry of drawn) p.hand.push(entry);
      if (drawn.length) {
        this.emit('draw', {
          side,
          cards: drawn.map(card => card.id),
          entries: drawn.map(card => ({ uid: card.uid, id: card.id })),
          count: drawn.length,
          extra: !!meta.extra
        });
      }
      return drawn;
    }

    startTurn(side, meta = {}) {
      const s = this.state;
      if (s.status !== 'playing') return;
      if (this.boardFull()) {
        this.endInDraw();
        return;
      }
      s.current = side;
      s.phase = 'main';
      s.round = Math.floor(s.ply / 2) + 1;
      s.placed = false;
      s.cardsPlayedThisTurn = 0;
      s.offer = null;
      s.aiOffer = null;
      const p = s.players[side];
      p.mana = this.rules.maxMana + (p.nextMana || 0);
      p.nextMana = 0;
      this.expireSeals();
      this.emit('manaRefilled', { side, mana: p.mana, maxMana: p.maxMana });

      if (side === 'player' && !s.noDraft) {
        this.startDraft();
        return;
      }

      if (side === 'ai') {
        const offer = this.takeDistinctFromDeck(p, this.rules.draftCount);
        s.aiOffer = offer.map(entry => ({ uid: entry.uid, id: entry.id }));
        if (!s.aiOffer.length) {
          this.applyExtraDraw('ai');
          this.emit('turnStart', {
            side, round: s.round, mana: p.mana, hand: p.hand.length, placed: false
          });
        }
        return;
      } else {
        this.applyExtraDraw('player');
      }
      this.emit('turnStart', {
        side,
        round: s.round,
        mana: p.mana,
        hand: p.hand.length,
        placed: false
      });
    }

    chooseAiOffer(indices) {
      const s = this.state;
      if (s.status !== 'playing' || s.current !== 'ai' || !s.aiOffer) {
        return { ok: false, reason: '当前没有敌方补给' };
      }
      const picks = [...new Set((indices || []).map(Number))];
      const need = Math.min(this.rules.draftPick, s.aiOffer.length);
      if (picks.length !== need || picks.some(i => i < 0 || i >= s.aiOffer.length)) {
        return { ok: false, reason: `必须选择 ${need} 张牌` };
      }
      const p = s.players.ai;
      const chosen = [];
      const rejected = [];
      s.aiOffer.forEach((entry, index) => {
        if (picks.includes(index)) {
          p.hand.push(entry);
          chosen.push(entry);
        } else {
          p.discard.push(entry);
          rejected.push(entry);
        }
      });
      s.aiOffer = null;
      this.applyExtraDraw('ai');
      this.emit('draftChosen', {
        side: 'ai',
        chosen: chosen.map(entry => entry.id),
        rejected: rejected.map(entry => entry.id)
      });
      this.emit('turnStart', {
        side: 'ai', round: s.round, mana: p.mana, hand: p.hand.length, placed: false
      });
      return { ok: true, chosen, rejected };
    }

    startDraft() {
      const s = this.state;
      const p = s.players.player;
      const offer = this.takeDistinctFromDeck(p, this.rules.draftCount);
      if (!offer.length) {
        s.phase = 'main';
        this.applyExtraDraw('player');
        this.emit('turnStart', {
          side: 'player',
          round: s.round,
          mana: p.mana,
          hand: p.hand.length,
          placed: false
        });
        return;
      }
      s.offer = offer.map(entry => ({ uid: entry.uid, id: entry.id }));
      s.phase = 'draft';
      this.emit('offer', { side: 'player', cards: s.offer, count: s.offer.length });
    }

    chooseOffer(indices) {
      const s = this.state;
      if (s.status !== 'playing' || s.phase !== 'draft' || !s.offer) {
        return { ok: false, reason: '当前没有待选择的补给' };
      }
      const picks = [...new Set((indices || []).map(Number))];
      const need = Math.min(this.rules.draftPick, s.offer.length);
      if (picks.length !== need || picks.some(i => i < 0 || i >= s.offer.length)) {
        return { ok: false, reason: `必须选择 ${need} 张牌` };
      }
      const p = s.players.player;
      const chosen = [];
      const rejected = [];
      s.offer.forEach((entry, index) => {
        if (picks.includes(index)) {
          p.hand.push(entry);
          chosen.push(entry);
        } else {
          p.discard.push(entry);
          rejected.push(entry);
        }
      });
      s.offer = null;
      s.phase = 'main';
      this.applyExtraDraw('player');
      this.emit('draftChosen', {
        side: 'player',
        chosen: chosen.map(entry => entry.id),
        rejected: rejected.map(entry => entry.id)
      });
      this.emit('turnStart', {
        side: 'player',
        round: s.round,
        mana: p.mana,
        hand: p.hand.length,
        placed: false
      });
      return { ok: true, chosen, rejected };
    }

    applyExtraDraw(side) {
      const p = this.state.players[side];
      const extra = p.extraDraw || 0;
      if (extra <= 0) return;
      p.extraDraw = 0;
      this.draw(side, extra, { extra: true });
    }

    expireSeals() {
      const s = this.state;
      for (const [key, until] of Object.entries(s.seals)) {
        if (until <= s.ply) delete s.seals[key];
      }
    }

    isSealed(r, c) {
      const until = this.state.seals[keyOf(r, c)];
      return !!until && until > this.state.ply;
    }

    getStone(r, c) {
      if (!this.inBounds(r, c)) return null;
      return this.state.cells[r][c];
    }

    inBounds(r, c) {
      return r >= 0 && c >= 0 && r < this.state.size && c < this.state.size;
    }

    setStone(r, c, stone) {
      if (this.inBounds(r, c)) this.state.cells[r][c] = stone;
    }

    stoneWeight(stone) {
      if (!stone) return 0;
      return stone.doubled ? 2 : 1;
    }

    cardById(id) {
      return BY_ID[id];
    }

    cardCost(entry) {
      const card = BY_ID[entry.id];
      if (!card) return 0;
      return entry.discount ? 0 : card.cost;
    }

    canPlayCard(side, uid) {
      const s = this.state;
      if (s.status !== 'playing') return { ok: false, reason: '对局已经结束' };
      if (s.current !== side) return { ok: false, reason: '还没轮到你' };
      if (s.phase !== 'main') return { ok: false, reason: '请先完成补给选择' };
      const p = s.players[side];
      const entry = p.hand.find(item => item.uid === uid);
      if (!entry) return { ok: false, reason: '手牌中没有这张牌' };
      const card = BY_ID[entry.id];
      if (!card) return { ok: false, reason: '未知卡牌' };
      const cost = this.cardCost(entry);
      if (p.mana < cost) return { ok: false, reason: `体力不足（需要 ${cost}，当前 ${p.mana}）` };
      return { ok: true, card, entry, cost };
    }

    getCardTargets(side, cardId) {
      const s = this.state;
      const card = BY_ID[cardId];
      if (!card) return [];
      if (card.target === 'cell') {
        const out = [];
        for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) out.push({ r, c });
        return out;
      }
      if (card.target === 'stoneOwn') {
        const out = [];
        for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) {
          const stone = s.cells[r][c];
          if (stone && stone.owner === side) out.push({ r, c });
        }
        return out;
      }
      if (card.target === 'moveOwn') {
        const out = [];
        for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) {
          const stone = s.cells[r][c];
          if (stone && stone.owner === side) out.push({ r, c });
        }
        return out;
      }
      if (card.target === 'swap') {
        const out = [];
        for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) {
          if (s.cells[r][c]) out.push({ r, c });
        }
        return out;
      }
      return [];
    }

    getMoveDestinations(r, c) {
      const out = [];
      for (const [dr, dc] of DIRS8) {
        const nr = r + dr;
        const nc = c + dc;
        if (!this.inBounds(nr, nc)) continue;
        if (this.getStone(nr, nc) || this.isSealed(nr, nc)) continue;
        out.push({ r: nr, c: nc });
      }
      return out;
    }

    validatePayload(cardId, side, payload = {}) {
      const s = this.state;
      const card = BY_ID[cardId];
      if (!card) return { ok: false, reason: '未知卡牌' };
      if (card.target === 'none') return { ok: true };
      if (card.target === 'handCard') {
        const target = s.players[side].hand.find(entry => entry.uid === payload.uid);
        if (!target) return { ok: false, reason: '请选择一张手牌' };
        return { ok: true };
      }
      if (card.target === 'swap') {
        if (!payload.first || !payload.second) return { ok: false, reason: '请选择两枚棋子' };
        const a = this.getStone(payload.first.r, payload.first.c);
        const b = this.getStone(payload.second.r, payload.second.c);
        if (!a || !b) return { ok: false, reason: '目标格必须有棋子' };
        if (payload.first.r === payload.second.r && payload.first.c === payload.second.c) {
          return { ok: false, reason: '不能选择同一枚棋子' };
        }
        return { ok: true };
      }
      if (card.target === 'moveOwn') {
        if (!payload.from || !payload.to) return { ok: false, reason: '请选择起点与终点' };
        const stone = this.getStone(payload.from.r, payload.from.c);
        if (!stone || stone.owner !== side) return { ok: false, reason: '只能移动己方星子' };
        if (!this.getMoveDestinations(payload.from.r, payload.from.c)
          .some(cell => cell.r === payload.to.r && cell.c === payload.to.c)) {
          return { ok: false, reason: '目标格不可移动' };
        }
        return { ok: true };
      }
      if (card.target === 'stoneOwn') {
        const stone = this.getStone(payload.r, payload.c);
        if (!stone || stone.owner !== side) return { ok: false, reason: '请选择己方星子' };
        return { ok: true };
      }
      if (card.target === 'cell') {
        if (!this.inBounds(payload.r, payload.c)) return { ok: false, reason: '目标格不在棋盘内' };
        return { ok: true };
      }
      return { ok: true };
    }

    playCard(side, uid, payload = {}) {
      const check = this.canPlayCard(side, uid);
      if (!check.ok) return check;
      const targetCheck = this.validatePayload(check.card.id, side, payload);
      if (!targetCheck.ok) return targetCheck;

      const s = this.state;
      const p = s.players[side];
      const idx = p.hand.findIndex(entry => entry.uid === uid);
      const [entry] = p.hand.splice(idx, 1);
      const cost = this.cardCost(entry);
      p.mana -= cost;
      s.cardsPlayedThisTurn++;
      s.stats.cardsPlayed++;
      p.discard.push(entry);
      this.emit('manaSpent', { side, cost, mana: p.mana, cardId: entry.id });

      if (p.silenced) {
        p.silenced = false;
        this.emit('cardNullified', { side, cardId: entry.id, cost, mana: p.mana });
        return { ok: true, nullified: true, card: check.card, cost, mana: p.mana };
      }

      this.emit('cardPlayed', { side, cardId: entry.id, cost, mana: p.mana });
      let result = { ok: true, card: check.card, cost, mana: p.mana };
      switch (entry.id) {
        case 'sealOrtho':
        case 'sealAll': {
          const dirs = entry.id === 'sealOrtho' ? DIRS4 : DIRS8;
          const sealed = [];
          for (const [dr, dc] of dirs) {
            const nr = payload.r + dr;
            const nc = payload.c + dc;
            if (!this.inBounds(nr, nc)) continue;
            s.seals[keyOf(nr, nc)] = s.ply + 2;
            sealed.push({ r: nr, c: nc });
          }
          result.sealed = sealed;
          this.emit('sealed', { side, center: { r: payload.r, c: payload.c }, cells: sealed });
          break;
        }
        case 'twin': {
          const stone = this.getStone(payload.r, payload.c);
          stone.doubled = true;
          result.stone = { r: payload.r, c: payload.c };
          this.emit('twinApplied', { side, at: { r: payload.r, c: payload.c } });
          const win = this.resolveWins(side, 'twin');
          if (win) result.win = win;
          break;
        }
        case 'shift': {
          const stone = this.getStone(payload.from.r, payload.from.c);
          this.setStone(payload.from.r, payload.from.c, null);
          this.setStone(payload.to.r, payload.to.c, stone);
          stone.movedPly = s.ply;
          s.lastMove = { r: payload.to.r, c: payload.to.c, side, type: 'move' };
          result.from = { ...payload.from };
          result.to = { ...payload.to };
          this.emit('stoneMoved', { side, from: result.from, to: result.to });
          const win = this.resolveWins(side, 'move');
          if (win) result.win = win;
          break;
        }
        case 'ruin': {
          const removed = [];
          // 中心格 + 周围八格：cards.js 的牌面文案是「目标格及其周围八格」
          const centerStone = this.getStone(payload.r, payload.c);
          if (centerStone) {
            this.setStone(payload.r, payload.c, null);
            removed.push({ r: payload.r, c: payload.c, owner: centerStone.owner });
          }
          for (const [dr, dc] of DIRS8) {
            const nr = payload.r + dr;
            const nc = payload.c + dc;
            if (!this.inBounds(nr, nc)) continue;
            const stone = this.getStone(nr, nc);
            if (!stone) continue;
            this.setStone(nr, nc, null);
            removed.push({ r: nr, c: nc, owner: stone.owner });
          }
          result.removed = removed;
          s.stats.captures += removed.length;
          this.emit('detonated', { side, center: { r: payload.r, c: payload.c }, removed });
          const win = this.resolveWins(side, 'ruin');
          if (win) result.win = win;
          break;
        }
        case 'swap': {
          const a = this.getStone(payload.first.r, payload.first.c);
          const b = this.getStone(payload.second.r, payload.second.c);
          this.setStone(payload.first.r, payload.first.c, b);
          this.setStone(payload.second.r, payload.second.c, a);
          result.first = { ...payload.first };
          result.second = { ...payload.second };
          this.emit('swapped', { side, first: payload.first, second: payload.second });
          const win = this.resolveWins(side, 'swap');
          if (win) result.win = win;
          else {
            const oppWin = this.resolveWins(opposite(side), 'swap');
            if (oppWin) result.win = oppWin;
          }
          break;
        }
        case 'subvert': {
          const converted = [];
          // 中心格 + 上下左右四格
          {
            const center = this.getStone(payload.r, payload.c);
            if (center && center.owner !== side) {
              center.owner = side;
              converted.push({ r: payload.r, c: payload.c });
            }
          }
          for (const [dr, dc] of DIRS4) {
            const nr = payload.r + dr;
            const nc = payload.c + dc;
            if (!this.inBounds(nr, nc)) continue;
            const stone = this.getStone(nr, nc);
            if (!stone || stone.owner === side) continue;
            stone.owner = side;
            converted.push({ r: nr, c: nc });
          }
          result.converted = converted;
          this.emit('subverted', { side, center: { r: payload.r, c: payload.c }, cells: converted });
          const win = this.resolveWins(side, 'subvert');
          if (win) result.win = win;
          break;
        }
        case 'sixwin': {
          if (p.winTarget > 6) {
            p.winTarget = 6;
            result.winTarget = 6;
            this.emit('winTargetChanged', { side, winTarget: 6 });
            // 用后退役：双方手牌/牌库/弃牌堆里的这张牌全部移除，本局不再出现
            result.retired = this.retireCardEverywhere(entry.id);
            // 可能刚好已经凑够六连 → 立刻判胜
            const win = this.resolveWins(side, 'sixwin');
            if (win) result.win = win;
          }
          break;
        }
        case 'silence': {
          s.players[opposite(side)].silenced = true;
          result.silenced = true;
          this.emit('silenced', { side, target: opposite(side) });
          break;
        }
        case 'extra': {
          p.extraDraw = (p.extraDraw || 0) + 2;
          result.extraDraw = p.extraDraw;
          this.emit('extraDrawQueued', { side, count: p.extraDraw });
          break;
        }
        case 'charge': {
          p.mana = Math.min(5, p.mana + 1);
          result.mana = p.mana;
          this.emit('manaGained', { side, mana: p.mana });
          break;
        }
        case 'store': {
          p.nextMana = (p.nextMana || 0) + 1;
          result.nextMana = p.nextMana;
          this.emit('manaStored', { side, nextMana: p.nextMana });
          break;
        }
        case 'discount': {
          const target = p.hand.find(item => item.uid === payload.uid);
          if (target) target.discount = true;
          result.discount = payload.uid;
          this.emit('discountApplied', { side, uid: payload.uid });
          break;
        }
        default:
          break;
      }
      return result;
    }

    // 牌退役：把某个 id 的牌从双方的三个区域里彻底移除，并记入 retiredCards
    retireCardEverywhere(cardId) {
      const s = this.state;
      const removed = [];
      for (const side of ['player', 'ai']) {
        const p = s.players[side];
        for (const zone of ['hand', 'deck', 'discard']) {
          const keep = [];
          for (const entry of p[zone]) {
            if (entry.id === cardId) removed.push(entry);
            else keep.push(entry);
          }
          p[zone] = keep;
        }
      }
      if (!Array.isArray(s.retiredCards)) s.retiredCards = [];
      s.retiredCards.push(...removed);
      this.emit('cardRetired', { cardId, removed: removed.length });
      return removed.length;
    }

    // 旧接口保留：只清某一方
    retireCard(side, cardId) {
      const p = this.state.players[side];
      let removed = 0;
      for (const zone of ['hand', 'deck', 'discard']) {
        const before = p[zone].length;
        p[zone] = p[zone].filter(entry => entry.id !== cardId);
        removed += before - p[zone].length;
      }
      this.emit('cardRetired', { side, cardId, removed });
      return removed;
    }

    canPlace(side, r, c) {
      const s = this.state;
      if (s.status !== 'playing') return false;
      if (s.current !== side) return false;
      if (s.phase !== 'main') return false;
      if (s.placed) return false;
      if (!this.inBounds(r, c)) return false;
      if (this.getStone(r, c)) return false;
      if (this.isSealed(r, c)) return false;
      return true;
    }

    placementError(side, r, c) {
      const s = this.state;
      if (!this.inBounds(r, c)) return '该格不在棋盘内';
      if (this.getStone(r, c)) return '该格已有星子';
      if (this.isSealed(r, c)) return '该格已被封锁';
      if (s.phase !== 'main') return '请先完成补给选择';
      if (s.placed) return '本回合已经落子';
      return '现在不能落子';
    }

    getPlacementCells(side) {
      const s = this.state;
      if (s.status !== 'playing' || s.current !== side || s.phase !== 'main' || s.placed) return [];
      const out = [];
      for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) {
        if (!s.cells[r][c] && !this.isSealed(r, c)) out.push({ r, c });
      }
      return out;
    }

    place(side, r, c) {
      const s = this.state;
      if (s.status !== 'playing') return { ok: false, reason: '对局已经结束' };
      if (s.current !== side) return { ok: false, reason: '还没轮到你' };
      if (!this.canPlace(side, r, c)) return { ok: false, reason: this.placementError(side, r, c) };
      const p = s.players[side];
      const stone = {
        uid: 's' + (++this.uid),
        owner: side,
        doubled: false,
        placedPly: s.ply
      };
      this.setStone(r, c, stone);
      s.placed = true;
      s.stats.stonesPlaced++;
      s.lastMove = { r, c, side, type: 'place', stoneUid: stone.uid };
      this.emit('stonePlaced', { side, r, c, stone });
      const win = this.resolveWins(side, 'place');
      const result = { ok: true, stone, r, c };
      if (win) result.win = win;
      if (!win && this.boardFull()) {
        this.endInDraw();
        result.draw = true;
      }
      return result;
    }

    discard(side, uids) {
      const s = this.state;
      const p = s.players[side];
      const unique = [...new Set(uids || [])];
      const need = Math.max(0, p.hand.length - this.rules.handLimit);
      if (unique.length !== need) return { ok: false, reason: `需要弃置 ${need} 张牌` };
      const removed = [];
      for (const uid of unique) {
        const idx = p.hand.findIndex(entry => entry.uid === uid);
        if (idx < 0) continue;
        const [entry] = p.hand.splice(idx, 1);
        p.discard.push(entry);
        removed.push(entry.id);
      }
      if (removed.length) this.emit('handDiscarded', { side, cards: removed });
      return { ok: true, removed };
    }

    endTurn(side) {
      const s = this.state;
      if (s.status !== 'playing') return { ok: false, reason: '对局已经结束' };
      if (s.current !== side) return { ok: false, reason: '还没轮到你' };
      if (s.phase !== 'main') return { ok: false, reason: '请先完成补给选择' };
      if (!s.placed) return { ok: false, reason: '本回合必须落一子' };
      const p = s.players[side];
      if (p.hand.length > this.rules.handLimit) {
        return { ok: false, reason: `请先弃置 ${p.hand.length - this.rules.handLimit} 张手牌` };
      }
      if (p.silenced) p.silenced = false;
      p.mana = 0;
      s.ply++;
      this.emit('turnEnd', { side, ply: s.ply });
      this.startTurn(opposite(side));
      return { ok: true, current: s.current };
    }

    getSealCells() {
      return Object.keys(this.state.seals)
        .filter(key => this.state.seals[key] > this.state.ply)
        .map(parseKey);
    }

    boardFull() {
      const s = this.state;
      for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) if (!s.cells[r][c]) return false;
      return true;
    }

    endInDraw() {
      if (this.state.status !== 'playing') return;
      this.state.status = 'over';
      this.state.winner = null;
      this.state.winLine = null;
      this.emit('gameOver', { winner: null, draw: true, win: null });
    }

    resolveWins(prefer = 'player', reason = '') {
      const s = this.state;
      if (s.status !== 'playing') return null;
      const order = prefer === 'ai' ? ['ai', 'player'] : ['player', 'ai'];
      for (const side of order) {
        const win = this.findWin(side);
        if (win) {
          this.finishGame(side, win, reason);
          return win;
        }
      }
      return null;
    }

    findWin(side) {
      const s = this.state;
      const target = s.players[side].winTarget;
      for (let r = 0; r < s.size; r++) {
        for (let c = 0; c < s.size; c++) {
          const stone = s.cells[r][c];
          if (!stone || stone.owner !== side) continue;
          for (const [dr, dc] of DIRECTIONS) {
            const prev = this.getStone(r - dr, c - dc);
            if (prev && prev.owner === side) continue;
            const cells = [];
            let total = 0;
            let rr = r;
            let cc = c;
            while (this.inBounds(rr, cc)) {
              const item = this.getStone(rr, cc);
              if (!item || item.owner !== side) break;
              cells.push({ r: rr, c: cc });
              total += this.stoneWeight(item);
              if (total >= target) {
                return { side, target, cells, start: { r, c }, end: { r: rr, c: cc } };
              }
              rr += dr;
              cc += dc;
            }
          }
        }
      }
      return null;
    }

    finishGame(winner, win, reason) {
      const s = this.state;
      s.status = 'over';
      s.winner = winner;
      s.winLine = win;
      s.winReason = reason;
      this.emit('gameOver', { winner, win, reason, draw: false });
    }

    getPublicState() {
      const s = this.state;
      return {
        size: s.size,
        current: s.current,
        status: s.status,
        phase: s.phase,
        ply: s.ply,
        round: s.round,
        placed: s.placed,
        seals: { ...s.seals },
        winTargets: {
          player: s.players.player.winTarget,
          ai: s.players.ai.winTarget
        },
        hands: {
          player: s.players.player.hand.length,
          ai: s.players.ai.hand.length
        },
        mana: {
          player: s.players.player.mana,
          ai: s.players.ai.mana
        }
      };
    }
  }

  return { Engine, RULES, DIRECTIONS, DIRS8, DIRS4, opposite };
});
