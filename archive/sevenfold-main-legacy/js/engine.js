/* 七曜牌局 — 规则引擎
 * 不依赖 DOM，可在浏览器与 Node 中运行。
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

  const CARDS = CARD_LIB.CARDS;
  const BY_ID = CARD_LIB.BY_ID;

  const RULES = {
    initialSize: 13,
    maxSize: 19,
    winLength: 7,
    startingHand: 4,
    drawPerTurn: 1,
    handLimit: 7,
    aegisRounds: 3,
    campSwapRun: 5          // 换营权能：玩家连成 5 子算一次
  };

  const DIRECTIONS = [
    [0, 1], [1, 0], [1, 1], [1, -1]
  ];
  const SIDES = ['player', 'ai'];
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

  function keyOf(r, c) { return r + ',' + c; }
  function parseKey(key) {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  }

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
        phase: 'setup',
        status: 'playing',
        ply: 0,
        round: 1,
        cardPlayed: false,
        placed: false,
        moved: false,
        skipPlace: false,
        winner: null,
        winLine: null,
        winReason: '',
        forced: null,
        seals: {},
        zones: [],
        lastMove: null,
        lastPlaced: { player: null, ai: null },
        players: {
          player: this.makePlayer(),
          ai: this.makePlayer()
        },
        stats: { stonesPlaced: 0, cardsPlayed: 0, captures: 0 },
        // 关卡与 BOSS 权能（见 js/levels.js）
        bossSkills: [...(options.bossSkills || this.rules.bossSkills || [])],
        // 换营（campSwap）：玩家第 2、4、6… 次连成五子时触发
        playerRuns: new Set(),
        campSwapCount: 0,
        campSwaps: 0,
        campSwapSuppressed: 0,
        lastCampSwapPly: -1,
        // 本回合出牌配额（偶数回合 BOSS 可以两张：一张即时 + 一张延时）
        cardsPlayedThisTurn: 0,
        instantPlayed: 0,
        delayedPlayed: 0
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
        secrets: [],
        winTarget: this.rules.winLength,
        nextAura: null,
        silenced: false
      };
    }

    makeDeck() {
      const deck = [];
      for (const card of CARDS) {
        for (let i = 0; i < 2; i++) {
          deck.push({ uid: 'c' + (++this.uid), id: card.id });
        }
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
      for (const side of SIDES) {
        this.state.players[side].deck = this.makeDeck();
        for (let i = 0; i < this.rules.startingHand; i++) {
          this.state.players[side].hand.push(this.state.players[side].deck.pop());
        }
      }
    }

    get side() { return this.state.current; }
    get other() { return opposite(this.state.current); }

    inBounds(r, c) {
      return r >= 0 && c >= 0 && r < this.state.size && c < this.state.size;
    }

    cellAt(r, c) {
      return this.inBounds(r, c) ? this.state.cells[r][c] : null;
    }

    getStone(r, c) {
      const cell = this.cellAt(r, c);
      return cell && cell.owner ? cell : null;
    }

    setStone(r, c, stone) {
      this.state.cells[r][c] = stone;
    }

    sealAt(r, c) {
      const seal = this.state.seals[keyOf(r, c)];
      if (!seal) return null;
      if (seal.untilPly <= this.state.ply) {
        delete this.state.seals[keyOf(r, c)];
        return null;
      }
      return seal;
    }

    isSealed(r, c) {
      return !!this.sealAt(r, c);
    }

    cardById(id) {
      return BY_ID[id];
    }

    draw(side, count = 1, meta = {}) {
      const p = this.state.players[side];
      const drawn = [];
      for (let i = 0; i < count; i++) {
        if (!p.deck.length) {
          if (!p.discard.length) break;
          p.deck = this.shuffle(p.discard.splice(0));
        }
        const card = p.deck.pop();
        if (p.hand.length >= this.rules.handLimit) {
          p.discard.push(card);
          this.emit('cardBurned', { side, cardId: card.id });
          continue;
        }
        p.hand.push(card);
        drawn.push(card);
      }
      if (drawn.length) {
        this.emit('draw', {
          side,
          cards: drawn.map(card => card.id),
          count: drawn.length,
          opening: !!meta.opening
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
      s.cardPlayed = false;
      s.cardsPlayedThisTurn = 0;
      s.instantPlayed = 0;
      s.delayedPlayed = 0;
      s.placed = false;
      s.moved = false;
      s.skipPlace = false;
      s.round = Math.floor(s.ply / 2) + 1;
      this.checkForcedValidity();
      this.draw(side, this.rules.drawPerTurn, meta);
      this.emit('turnStart', {
        side,
        round: s.round,
        forced: s.forced ? { ...s.forced } : null,
        silenced: s.players[side].silenced
      });
    }

    checkForcedValidity() {
      const f = this.state.forced;
      if (!f) return;
      if (f.target !== this.state.current) return;
      const stone = this.getStone(f.r, f.c);
      if (!this.inBounds(f.r, f.c) || stone || this.isSealed(f.r, f.c)) {
        const old = { ...f };
        this.state.forced = null;
        this.emit('forceFizzle', { forced: old });
      }
    }

    getPlacementCells(side = this.state.current) {
      const cells = [];
      if (this.state.status !== 'playing' || this.state.current !== side || this.state.phase !== 'main') return cells;
      const forced = this.state.forced;
      if (forced && forced.target === side) {
        if (this.canPlace(side, forced.r, forced.c)) cells.push({ r: forced.r, c: forced.c });
        return cells;
      }
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (this.canPlace(side, r, c)) cells.push({ r, c });
        }
      }
      return cells;
    }

    canPlace(side, r, c) {
      const s = this.state;
      if (s.status !== 'playing' || s.current !== side || s.phase !== 'main') return false;
      if (!this.inBounds(r, c) || this.getStone(r, c)) return false;
      if (this.isSealed(r, c)) return false;
      const forced = s.forced;
      if (forced && forced.target === side && (forced.r !== r || forced.c !== c)) return false;
      return true;
    }

    hasBossSkill(id) {
      return (this.state.bossSkills || []).includes(id);
    }

    // 本回合能打几张牌。BOSS 的「双术」只在偶数回合生效，且限一张即时 + 一张延时。
    cardSlots(side) {
      const slots = { total: 1, instant: 1, delayed: 1 };
      if (side === 'ai' && this.hasBossSkill('doubleCard') && this.state.round % 2 === 0) {
        slots.total = 2;
      }
      return slots;
    }

    canPlayCard(side, uid) {
      const s = this.state;
      const p = s.players[side];
      if (s.status !== 'playing') return { ok: false, reason: '对局已经结束' };
      if (s.current !== side) return { ok: false, reason: '还没轮到你' };
      const entry = p.hand.find(card => card.uid === uid);
      if (!entry) return { ok: false, reason: '手牌中没有这张牌' };
      const card = BY_ID[entry.id];
      const slots = this.cardSlots(side);
      if ((s.cardsPlayedThisTurn || 0) >= slots.total) {
        return { ok: false, reason: slots.total > 1 ? '本回合的两张牌已经打完了' : '本回合已经打过一张牌了' };
      }
      if (card.type === 'instant' && (s.instantPlayed || 0) >= slots.instant) {
        return { ok: false, reason: '本回合已经发过即时术式' };
      }
      if (card.type === 'delayed' && (s.delayedPlayed || 0) >= slots.delayed) {
        return { ok: false, reason: '本回合已经布过延时秘式' };
      }
      if (card.type === 'instant' && s.phase !== 'main') {
        return { ok: false, reason: '即时术式需在落子前发动' };
      }
      if (card.type === 'delayed' && s.phase !== 'post') {
        return { ok: false, reason: '延时秘式需在落子后布下' };
      }
      if ((entry.id === 'repel' || entry.id === 'shift') && s.forced && s.forced.target === side) {
        return { ok: false, reason: '被定身时不能以位移术式跳过落子' };
      }
      if (entry.id === 'expand' && s.size >= this.rules.maxSize) {
        return { ok: false, reason: '星盘已达到最大边界' };
      }
      if (entry.id === 'mirror') {
        const anchorKey = s.lastPlaced[side];
        if (!anchorKey) return { ok: false, reason: '需要本回合刚落下的己方星子作为锚' };
        const anchor = parseKey(anchorKey);
        const anchorStone = this.getStone(anchor.r, anchor.c);
        if (!anchorStone || anchorStone.owner !== side) {
          return { ok: false, reason: '锚点星子已经消失' };
        }
      }
      if (card.target !== 'none' && this.getCardTargets(side, entry.id).length === 0) {
        return { ok: false, reason: '当前没有可用的目标' };
      }
      return { ok: true, card };
    }

    getCardTargets(side, cardId) {
      const card = BY_ID[cardId];
      if (!card || !card.target || card.target === 'none') return [];
      const s = this.state;
      const targets = [];
      for (let r = 0; r < s.size; r++) {
        for (let c = 0; c < s.size; c++) {
          const stone = this.getStone(r, c);
          if (card.target === 'cellEmpty') {
            if (!stone && !this.isSealed(r, c)) targets.push({ r, c });
          } else if (card.target === 'cellAny') {
            targets.push({ r, c });
          } else if (card.target === 'stoneOwn') {
            if (stone && stone.owner === side && !(stone.shieldUntil > s.ply)) targets.push({ r, c });
          } else if (card.target === 'moveEnemy') {
            if (stone && stone.owner !== side && !(stone.shieldUntil > s.ply) && this.getMoveDestinations(r, c).length) {
              targets.push({ r, c });
            }
          } else if (card.target === 'moveOwn') {
            if (stone && stone.owner === side && this.getMoveDestinations(r, c).length) {
              targets.push({ r, c });
            }
          }
        }
      }
      return targets;
    }

    getMoveDestinations(r, c) {
      const dests = [];
      if (!this.inBounds(r, c)) return dests;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (this.inBounds(nr, nc) && !this.getStone(nr, nc) && !this.isSealed(nr, nc)) {
          dests.push({ r: nr, c: nc, dr, dc });
        }
      }
      return dests;
    }

    validatePayload(cardId, side, payload = {}) {
      const card = BY_ID[cardId];
      if (!card) return { ok: false, reason: '未知卡牌' };
      const target = card.target;
      if (target === 'none') return { ok: true };
      if (target === 'cellEmpty' || target === 'cellAny') {
        const { r, c } = payload;
        if (!this.inBounds(r, c)) return { ok: false, reason: '目标不在星盘内' };
        if (target === 'cellEmpty' && this.getStone(r, c)) return { ok: false, reason: '该格已有星子' };
        if (target === 'cellEmpty' && this.isSealed(r, c)) return { ok: false, reason: '该格已被封禁' };
        return { ok: true };
      }
      if (target === 'stoneOwn') {
        const stone = this.getStone(payload.r, payload.c);
        if (!stone || stone.owner !== side) return { ok: false, reason: '必须选择己方星子' };
        if (stone.shieldUntil > this.state.ply) return { ok: false, reason: '该星子已在不灭状态' };
        return { ok: true };
      }
      if (target === 'moveEnemy' || target === 'moveOwn') {
        const from = payload.from || payload;
        const to = payload.to;
        const stone = this.getStone(from.r, from.c);
        if (!stone) return { ok: false, reason: '起点没有星子' };
        if (target === 'moveEnemy' && stone.owner === side) return { ok: false, reason: '必须选择敌方星子' };
        if (target === 'moveOwn' && stone.owner !== side) return { ok: false, reason: '必须选择己方星子' };
        if (target === 'moveEnemy' && stone.shieldUntil > this.state.ply) {
          return { ok: false, reason: '金身庇护，无法推动' };
        }
        if (!to) return { ok: false, reason: '请选择移动方向' };
        const dist = Math.abs(to.r - from.r) + Math.abs(to.c - from.c);
        if (dist !== 1) return { ok: false, reason: '只能移动一格' };
        if (!this.inBounds(to.r, to.c) || this.getStone(to.r, to.c)) return { ok: false, reason: '目标格不可进入' };
        if (this.isSealed(to.r, to.c)) return { ok: false, reason: '目标格已被封禁' };
        return { ok: true };
      }
      return { ok: false, reason: '目标类型未知' };
    }

    playCard(side, uid, payload = {}) {
      const check = this.canPlayCard(side, uid);
      if (!check.ok) return check;
      const card = check.card;
      const targetCheck = this.validatePayload(card.id, side, payload);
      if (!targetCheck.ok) return targetCheck;

      const p = this.state.players[side];
      const idx = p.hand.findIndex(entry => entry.uid === uid);
      const [entry] = p.hand.splice(idx, 1);
      p.discard.push(entry);
      this.state.cardPlayed = true;
      this.state.cardsPlayedThisTurn = (this.state.cardsPlayedThisTurn || 0) + 1;
      if (card.type === 'instant') this.state.instantPlayed = (this.state.instantPlayed || 0) + 1;
      else this.state.delayedPlayed = (this.state.delayedPlayed || 0) + 1;
      this.state.stats.cardsPlayed++;

      if (p.silenced) {
        p.silenced = false;
        const opp = this.state.players[opposite(side)];
        const secret = opp.secrets.find(sec => sec.cardId === 'silence');
        if (secret) this.removeSecret(opposite(side), secret.uid, 'triggered');
        this.emit('cardNullified', { side, cardId: card.id });
        return { ok: true, nullified: true, card };
      }

      if (card.type === 'instant') {
        this.emit('cardPlayed', { side, cardId: card.id });
      }

      let result = { ok: true, card };
      switch (card.id) {
        case 'sealOrtho':
        case 'sealDiag':
        case 'twin':
        case 'ruin':
          p.nextAura = { type: card.id, createdPly: this.state.ply };
          result.aura = p.nextAura;
          break;
        case 'expand':
          result = { ...result, ...this.expandBoard(side) };
          break;
        case 'repel':
          result = { ...result, ...this.applyMove(side, opposite(side), payload, card.id) };
          break;
        case 'shift':
          result = { ...result, ...this.applyMove(side, side, payload, card.id) };
          break;
        case 'pin': {
          this.state.forced = {
            target: opposite(side),
            r: payload.r,
            c: payload.c,
            by: side,
            createdPly: this.state.ply,
            expiresPly: this.state.ply + 2
          };
          result.forced = { ...this.state.forced };
          break;
        }
        case 'aegis': {
          const stone = this.getStone(payload.r, payload.c);
          stone.shieldUntil = this.state.ply + this.rules.aegisRounds * 2;
          const secret = this.addSecret(side, 'aegis', {
            anchor: { r: payload.r, c: payload.c },
            targetUid: stone.uid,
            expiresPly: stone.shieldUntil
          });
          result.secret = secret;
          break;
        }
        case 'mirror': {
          const anchor = parseKey(this.state.lastPlaced[side]);
          const secret = this.addSecret(side, 'mirror', {
            anchor,
            expiresPly: this.state.ply + 2
          });
          result.secret = secret;
          break;
        }
        case 'sixfold':
          p.winTarget = 6;
          result.secret = this.addSecret(side, 'sixfold', { expiresPly: null });
          break;
        case 'silence': {
          const target = this.state.players[opposite(side)];
          target.silenced = true;
          result.secret = this.addSecret(side, 'silence', { expiresPly: this.state.ply + 2 });
          break;
        }
        case 'subvert': {
          const secret = this.addSecret(side, 'subvert', {
            center: { r: payload.r, c: payload.c },
            expiresPly: this.state.ply + 2
          });
          const zone = {
            owner: side,
            center: { r: payload.r, c: payload.c },
            secretUid: secret.uid,
            expiresPly: this.state.ply + 2
          };
          this.state.zones.push(zone);
          result.zone = zone;
          result.secret = secret;
          break;
        }
        default:
          break;
      }

      if (card.type === 'delayed') {
        this.emit('secretSet', { side, cardId: card.id, secret: result.secret || null });
      }

      if (card.id === 'sixfold' && this.state.status === 'playing') {
        const win = this.resolveWins(side, 'sixfold');
        if (win) result.win = win;
      }
      return result;
    }

    applyMove(side, owner, payload, cardId) {
      const from = payload.from || payload;
      const to = payload.to;
      const stone = this.getStone(from.r, from.c);
      this.setStone(from.r, from.c, null);
      this.setStone(to.r, to.c, stone);
      stone.movedPly = this.state.ply;
      this.state.lastPlaced[owner] = keyOf(to.r, to.c);
      this.state.lastMove = { r: to.r, c: to.c, side: owner, type: 'move' };
      this.state.skipPlace = true;
      this.state.moved = true;
      this.state.phase = 'post';
      this.emit('stoneMoved', {
        by: side,
        owner,
        cardId,
        from: { r: from.r, c: from.c },
        to: { r: to.r, c: to.c },
        stone
      });
      const win = this.resolveWins(owner, 'move');
      if (win) return { moved: true, win };
      if (side === 'player') {
        const swap = this.maybeCampSwap('player');
        if (swap) {
          if (swap.win) return { moved: true, campSwap: swap, win: swap.win };
          return { moved: true, campSwap: swap, from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c } };
        }
      }
      if (this.boardFull()) {
        this.endInDraw();
        return { moved: true, draw: true };
      }
      return { moved: true, from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c } };
    }

    place(side, r, c) {
      const s = this.state;
      if (s.status !== 'playing') return { ok: false, reason: '对局已经结束' };
      if (s.current !== side) return { ok: false, reason: '还没轮到你' };
      if (s.phase !== 'main') return { ok: false, reason: '现在不是落子阶段' };
      if (!this.canPlace(side, r, c)) return { ok: false, reason: this.placementError(side, r, c) };

      const p = s.players[side];
      const aura = p.nextAura;
      const stone = {
        uid: 's' + (++this.uid),
        owner: side,
        doubled: !!(aura && aura.type === 'twin'),
        shieldUntil: 0,
        placedPly: s.ply
      };
      this.setStone(r, c, stone);
      s.stats.stonesPlaced++;
      s.lastPlaced[side] = keyOf(r, c);
      s.lastMove = { r, c, side, type: 'place', stoneUid: stone.uid };
      if (s.forced && s.forced.target === side) s.forced = null;
      p.nextAura = null;
      s.placed = true;
      s.phase = 'post';

      const result = { ok: true, stone, r, c, effects: [] };
      this.emit('stonePlaced', { side, r, c, stone });

      if (aura && aura.type === 'ruin') {
        result.effects.push(this.detonate(r, c, side));
        s.lastPlaced[side] = null;
      } else {
        if (aura && (aura.type === 'sealOrtho' || aura.type === 'sealDiag')) {
          result.effects.push(this.applySealAura(r, c, side, aura.type));
        }
        const conversion = this.triggerSubvert(side, r, c, stone);
        if (conversion) result.effects.push(conversion);
        const mirror = this.triggerMirror(side, r, c);
        if (mirror) result.effects.push(mirror);
      }

      const prefer = result.effects.find(e => e.type === 'subvert')?.owner || side;
      const win = this.resolveWins(prefer, 'place');
      if (win) result.win = win;
      if (!win) {
        const swap = this.maybeCampSwap(side);
        if (swap) {
          result.campSwap = swap;
          if (swap.win) result.win = swap.win;
        }
      }
      if (!result.win && this.boardFull()) {
        this.endInDraw();
        result.draw = true;
      }
      return result;
    }

    /* ---------------- 关卡权能：换营 ---------------- */

    // 某一方所有「合计 ≥ minLength 枚」的连段，key = 方向序号 + 段起点。
    // 同一段后来由 5 变 6 不换 key，所以不会重复计数。
    collectRuns(side, minLength) {
      const runs = new Set();
      const n = this.state.size;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const stone = this.getStone(r, c);
          if (!stone || stone.owner !== side) continue;
          for (let d = 0; d < DIRECTIONS.length; d++) {
            const [dr, dc] = DIRECTIONS[d];
            const prev = this.getStone(r - dr, c - dc);
            if (prev && prev.owner === side) continue;
            let total = 0;
            let rr = r;
            let cc = c;
            while (this.inBounds(rr, cc)) {
              const item = this.getStone(rr, cc);
              if (!item || item.owner !== side) break;
              total += item.doubled ? 2 : 1;
              rr += dr;
              cc += dc;
            }
            if (total >= minLength) runs.add(d + ':' + r + ',' + c);
          }
        }
      }
      return runs;
    }

    runScore(total, open, target) {
      const gap = target - total;
      if (gap <= 0) return 1e8;
      const table = [0, 4e6, 8e5, 5e4, 1.5e3, 90, 8];
      const base = table[Math.min(gap, 6)];
      const mult = open >= 2 ? 1 : open === 1 ? 0.16 : 0.03;
      return base * mult * (1 + 0.06 * total);
    }

    // 势力分：只用来判断「谁占优」，决定换营发不发动。规则层自己算，不依赖 AI。
    positionScore(side) {
      const target = this.state.players[side].winTarget;
      const n = this.state.size;
      let score = 0;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const stone = this.getStone(r, c);
          if (!stone || stone.owner !== side) continue;
          for (const [dr, dc] of DIRECTIONS) {
            const prev = this.getStone(r - dr, c - dc);
            if (prev && prev.owner === side) continue;
            let total = 0;
            let rr = r;
            let cc = c;
            while (this.inBounds(rr, cc)) {
              const item = this.getStone(rr, cc);
              if (!item || item.owner !== side) break;
              total += item.doubled ? 2 : 1;
              rr += dr;
              cc += dc;
            }
            let open = 0;
            if (this.inBounds(rr, cc) && !this.getStone(rr, cc)) open += 1;
            if (this.inBounds(r - dr, c - dc) && !this.getStone(r - dr, c - dc)) open += 1;
            score += this.runScore(total, open, target);
          }
        }
      }
      return score;
    }

    // 玩家自己落子/挪子之后调用。第偶数次连成五子才考虑换营，
    // 且只有「墨鸦不占优」时才真的换（玩家占优时给 BOSS 这一手）。
    maybeCampSwap(side) {
      const s = this.state;
      if (side !== 'player') return null;
      if (!this.hasBossSkill('campSwap')) return null;
      if (s.status !== 'playing') return null;
      let added = 0;
      for (const key of this.collectRuns('player', this.rules.campSwapRun || 5)) {
        if (!s.playerRuns.has(key)) {
          s.playerRuns.add(key);
          added += 1;
        }
      }
      if (!added) return null;
      s.campSwapCount += added;
      if (s.campSwapCount % 2 !== 0) return null;      // 只在第 2、4、6… 次触发
      const aiScore = this.positionScore('ai');
      const playerScore = this.positionScore('player');
      if (aiScore > playerScore) {
        s.campSwapSuppressed += 1;
        this.emit('campSwapSuppressed', { aiScore, playerScore, count: s.campSwapCount });
        return null;
      }
      return this.swapCamps({ aiScore, playerScore });
    }

    // 只交换棋盘上的星子归属：双生/金身跟着子走，手牌、暗牌、
    // 胜利条件、封禁格与术式归属都不动。
    swapCamps(meta = {}) {
      const s = this.state;
      if (s.status !== 'playing') return null;
      let flipped = 0;
      for (let r = 0; r < s.size; r++) {
        for (let c = 0; c < s.size; c++) {
          const stone = s.cells[r][c];
          if (!stone || !stone.owner) continue;
          stone.owner = opposite(stone.owner);
          flipped += 1;
        }
      }
      // 换影/金身的锚点跟着子走
      s.lastPlaced = { player: s.lastPlaced.ai, ai: s.lastPlaced.player };
      if (s.lastMove && s.lastMove.side) s.lastMove.side = opposite(s.lastMove.side);
      s.campSwaps += 1;
      s.lastCampSwapPly = s.ply;
      this.emit('campsSwapped', { flipped, ...meta });
      const win = this.resolveWins('ai', 'campswap');
      return { flipped, win, ...meta };
    }

    placementError(side, r, c) {
      if (!this.inBounds(r, c)) return '该格不在星盘内';
      if (this.getStone(r, c)) return '该格已有星子';
      if (this.isSealed(r, c)) return '该格已被封禁';
      const forced = this.state.forced;
      if (forced && forced.target === side) return '定身咒要求落在标记格';
      return '现在不能落子';
    }

    applySealAura(r, c, side, auraType) {
      const dirs = auraType === 'sealOrtho'
        ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
        : [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      const cells = [];
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (!this.inBounds(nr, nc)) continue;
        const untilPly = this.state.ply + 2;
        this.state.seals[keyOf(nr, nc)] = { by: side, untilPly, source: auraType };
        cells.push({ r: nr, c: nc });
      }
      this.emit('sealed', { side, cells, source: auraType });
      return { type: 'seal', owner: side, cells, source: auraType };
    }

    detonate(r, c, owner) {
      const removed = [];
      const shielded = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (!this.inBounds(nr, nc)) continue;
          const stone = this.getStone(nr, nc);
          if (!stone) continue;
          if (stone.owner !== owner && stone.shieldUntil > this.state.ply) {
            shielded.push({ r: nr, c: nc, owner: stone.owner });
            continue;
          }
          removed.push({ r: nr, c: nc, owner: stone.owner, doubled: stone.doubled });
          this.setStone(nr, nc, null);
          this.state.stats.captures++;
        }
      }
      this.emit('detonated', { owner, center: { r, c }, removed, shielded });
      return { type: 'burst', owner, center: { r, c }, removed, shielded };
    }

    triggerSubvert(side, r, c, stone) {
      const zone = this.state.zones.find(z => z.owner !== side && z.expiresPly > this.state.ply && this.inZone(z, r, c));
      if (!zone) return null;
      const previousOwner = stone.owner;
      stone.owner = zone.owner;
      stone.convertedFrom = previousOwner;
      this.removeZone(zone, 'triggered');
      const opp = this.state.players[zone.owner];
      const sec = opp.secrets.find(item => item.uid === zone.secretUid);
      if (sec) this.removeSecret(zone.owner, sec.uid, 'triggered');
      this.state.lastMove.stoneUid = stone.uid;
      this.emit('subverted', {
        owner: zone.owner,
        previousOwner,
        at: { r, c },
        stone
      });
      return { type: 'subvert', owner: zone.owner, previousOwner, at: { r, c } };
    }

    triggerMirror(side, r, c) {
      const oppSide = opposite(side);
      const p = this.state.players[oppSide];
      const secret = p.secrets.find(sec => sec.cardId === 'mirror' && sec.expiresPly > this.state.ply);
      if (!secret) return null;
      const anchor = secret.anchor;
      const anchorStone = this.getStone(anchor.r, anchor.c);
      const newStone = this.getStone(r, c);
      if (!anchorStone || !newStone) return null;
      if (anchorStone.owner !== oppSide) return null;
      if (anchorStone.shieldUntil > this.state.ply) {
        this.removeSecret(oppSide, secret.uid, 'blocked');
        this.emit('mirrorBlocked', { owner: oppSide, anchor });
        return { type: 'mirrorBlocked', owner: oppSide };
      }
      this.setStone(anchor.r, anchor.c, newStone);
      this.setStone(r, c, anchorStone);
      this.state.lastPlaced[oppSide] = keyOf(r, c);
      this.state.lastPlaced[side] = keyOf(anchor.r, anchor.c);
      this.state.lastMove = { r: anchor.r, c: anchor.c, side, type: 'mirror' };
      this.removeSecret(oppSide, secret.uid, 'triggered');
      this.emit('mirrored', {
        owner: oppSide,
        anchor,
        placed: { r, c },
        side
      });
      return { type: 'mirror', owner: oppSide, anchor, placed: { r, c } };
    }

    inZone(zone, r, c) {
      return Math.abs(zone.center.r - r) <= 1 && Math.abs(zone.center.c - c) <= 1;
    }

    removeZone(zone, status) {
      const idx = this.state.zones.indexOf(zone);
      if (idx >= 0) this.state.zones.splice(idx, 1);
      this.emit('zoneRemoved', { zone, status });
    }

    addSecret(side, cardId, extra = {}) {
      const secret = {
        uid: 'x' + (++this.uid),
        cardId,
        createdPly: this.state.ply,
        ...extra
      };
      this.state.players[side].secrets.push(secret);
      return secret;
    }

    removeSecret(side, uid, status = 'expired') {
      const p = this.state.players[side];
      const idx = p.secrets.findIndex(sec => sec.uid === uid);
      if (idx < 0) return null;
      const [secret] = p.secrets.splice(idx, 1);
      if (secret.cardId === 'silence' && status === 'expired') {
        this.state.players[opposite(side)].silenced = false;
      }
      this.emit('secretRemoved', { side, secret, status });
      return secret;
    }

    expireSecrets() {
      const now = this.state.ply;
      for (const side of SIDES) {
        const p = this.state.players[side];
        for (const secret of [...p.secrets]) {
          if (secret.expiresPly == null) continue;
          if (now < secret.expiresPly) continue;
          if (secret.cardId === 'subvert') {
            const zone = this.state.zones.find(z => z.secretUid === secret.uid);
            if (zone) this.removeZone(zone, 'expired');
          }
          this.removeSecret(side, secret.uid, 'expired');
          this.emit('secretExpired', { side, secret });
        }
      }
    }

    endTurn(side) {
      const s = this.state;
      if (s.status !== 'playing') return { ok: false, reason: '对局已经结束' };
      if (s.current !== side) return { ok: false, reason: '还没轮到你' };
      if (s.phase !== 'post') return { ok: false, reason: '请先落子或完成位移' };
      if (s.forced && s.forced.target === side) s.forced = null;
      if (s.players[side].silenced) {
        s.players[side].silenced = false;
        const opp = s.players[opposite(side)];
        const silentSecret = opp.secrets.find(sec => sec.cardId === 'silence');
        if (silentSecret) this.removeSecret(opposite(side), silentSecret.uid, 'expired');
      }
      s.ply++;
      s.round = Math.floor(s.ply / 2) + 1;
      this.expireSecrets();
      const next = opposite(side);
      this.emit('turnEnd', { side, next, round: s.round });
      this.startTurn(next);
      return { ok: true, next };
    }

    resolveWins(prefer, reason = '') {
      const order = prefer ? [prefer, opposite(prefer)] : [...SIDES];
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
          const stone = this.getStone(r, c);
          if (!stone || stone.owner !== side) continue;
          for (const [dr, dc] of DIRECTIONS) {
            const pr = r - dr;
            const pc = c - dc;
            const prev = this.getStone(pr, pc);
            if (prev && prev.owner === side) continue;
            let weight = 0;
            const cells = [];
            let nr = r;
            let nc = c;
            while (this.inBounds(nr, nc)) {
              const item = this.getStone(nr, nc);
              if (!item || item.owner !== side) break;
              weight += item.doubled ? 2 : 1;
              cells.push({ r: nr, c: nc });
              if (weight >= target) {
                return { side, cells, weight, target, dir: [dr, dc] };
              }
              nr += dr;
              nc += dc;
            }
          }
        }
      }
      return null;
    }

    wouldWinAt(r, c, side, weight = 1) {
      if (!this.inBounds(r, c) || this.getStone(r, c)) return false;
      const target = this.state.players[side].winTarget;
      for (const [dr, dc] of DIRECTIONS) {
        let total = weight;
        for (const sign of [-1, 1]) {
          let nr = r + dr * sign;
          let nc = c + dc * sign;
          while (this.inBounds(nr, nc)) {
            const stone = this.getStone(nr, nc);
            if (!stone || stone.owner !== side) break;
            total += stone.doubled ? 2 : 1;
            nr += dr * sign;
            nc += dc * sign;
          }
        }
        if (total >= target) return true;
      }
      return false;
    }

    lineInfoAt(r, c, side, weight = 1) {
      const target = this.state.players[side].winTarget;
      let best = null;
      for (const [dr, dc] of DIRECTIONS) {
        let total = weight;
        let openA = false;
        let openB = false;
        let lenA = 0;
        let lenB = 0;
        for (const sign of [-1, 1]) {
          let nr = r + dr * sign;
          let nc = c + dc * sign;
          let count = 0;
          let blocked = false;
          while (this.inBounds(nr, nc)) {
            const stone = this.getStone(nr, nc);
            if (stone && stone.owner === side) {
              total += stone.doubled ? 2 : 1;
              count++;
              nr += dr * sign;
              nc += dc * sign;
              continue;
            }
            if (!stone) {
              if (sign === -1) openA = true; else openB = true;
            } else {
              blocked = true;
            }
            break;
          }
          if (sign === -1) lenA = count; else lenB = count;
          if (blocked) {
            // 被敌子封住的一端不计为开放
          }
        }
        const info = {
          total,
          openA,
          openB,
          lenA,
          lenB,
          open: (openA ? 1 : 0) + (openB ? 1 : 0),
          target,
          dir: [dr, dc]
        };
        if (!best || info.total > best.total || (info.total === best.total && info.open > best.open)) best = info;
      }
      return best || { total: weight, open: 0, lenA: 0, lenB: 0, target, dir: [0, 1] };
    }

    getWinningCells(side, weight = 1) {
      const out = [];
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (!this.getStone(r, c) && !this.isSealed(r, c) && this.wouldWinAt(r, c, side, weight)) {
            out.push({ r, c });
          }
        }
      }
      return out;
    }

    boardFull() {
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (!this.getStone(r, c)) return false;
        }
      }
      return true;
    }

    finishGame(winner, win, reason) {
      const s = this.state;
      if (s.status !== 'playing') return;
      s.status = 'over';
      s.winner = winner;
      s.winLine = win;
      s.winReason = reason;
      s.phase = 'over';
      this.emit('gameOver', { winner, win, reason });
    }

    endInDraw() {
      const s = this.state;
      if (s.status !== 'playing') return;
      s.status = 'draw';
      s.winner = null;
      s.phase = 'over';
      this.emit('gameOver', { winner: null, draw: true });
    }

    expandBoard(side) {
      const s = this.state;
      if (s.size >= this.rules.maxSize) return { ok: false, reason: '星盘已达到最大边界' };
      const oldSize = s.size;
      const newSize = oldSize + 2;
      const next = this.makeBoard(newSize);
      for (let r = 0; r < oldSize; r++) {
        for (let c = 0; c < oldSize; c++) {
          if (s.cells[r][c]) next[r + 1][c + 1] = s.cells[r][c];
        }
      }
      s.cells = next;
      s.size = newSize;
      const seals = {};
      for (const [key, value] of Object.entries(s.seals)) {
        const { r, c } = parseKey(key);
        seals[keyOf(r + 1, c + 1)] = value;
      }
      s.seals = seals;
      if (s.forced) {
        s.forced.r += 1;
        s.forced.c += 1;
      }
      for (const zone of s.zones) {
        zone.center.r += 1;
        zone.center.c += 1;
      }
      for (const p of Object.values(s.players)) {
        for (const secret of p.secrets) {
          if (secret.anchor) {
            secret.anchor.r += 1;
            secret.anchor.c += 1;
          }
          if (secret.center) {
            secret.center.r += 1;
            secret.center.c += 1;
          }
        }
        p.nextAura = p.nextAura || null;
      }
      for (const owner of SIDES) {
        if (s.lastPlaced[owner]) {
          const { r, c } = parseKey(s.lastPlaced[owner]);
          s.lastPlaced[owner] = keyOf(r + 1, c + 1);
        }
      }
      if (s.lastMove) {
        s.lastMove.r += 1;
        s.lastMove.c += 1;
      }
      if (s.winLine) {
        s.winLine.cells = s.winLine.cells.map(cell => ({ r: cell.r + 1, c: cell.c + 1 }));
      }
      s.phase = 'main';
      this.emit('boardExpanded', { side, from: oldSize, to: newSize });
      return { expanded: true, from: oldSize, to: newSize };
    }

    getPublicState() {
      // 提供给 AI 的公开信息：不包含对方暗牌的具体内容。
      const s = this.state;
      return {
        size: s.size,
        cells: s.cells,
        current: s.current,
        phase: s.phase,
        status: s.status,
        ply: s.ply,
        round: s.round,
        forced: s.forced ? { ...s.forced } : null,
        seals: { ...s.seals },
        zones: s.zones.filter(z => z.owner === 'ai').map(z => ({ ...z, center: { ...z.center } })),
        lastPlaced: { ...s.lastPlaced },
        winTargets: { player: s.players.player.winTarget, ai: s.players.ai.winTarget },
        hands: { player: s.players.player.hand.length, ai: s.players.ai.hand.length },
        silenced: s.players.ai.silenced,
        aiSecrets: s.players.ai.secrets.map(sec => ({ ...sec })),
        aiAura: s.players.ai.nextAura,
        // 双方「下一子」的即时术式都是明牌（界面会显示），所以两边都算公开信息
        auras: { player: s.players.player.nextAura, ai: s.players.ai.nextAura },
        bossSkills: [...(s.bossSkills || [])],
        campSwapCount: s.campSwapCount,
        campSwaps: s.campSwaps,
        cardSlots: this.cardSlots(s.current),
        cardsPlayedThisTurn: s.cardsPlayedThisTurn
      };
    }
  }

  return { Engine, RULES, DIRECTIONS, opposite };
});
