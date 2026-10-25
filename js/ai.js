/* 七曜牌局 · 简化版 — 人机「墨鸦」
 *
 * 基础/进阶保持轻量决策；困难模式会在真实操作前搜索整回合，
 * 但所有试算都在可恢复的局面副本中进行，规则层与玩家完全一致。
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.SevenfoldAI = lib.AI;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const CARD_VALUE = {
    sixwin: 70,   // 永久把自己的目标降到 6，永远值得打
    twin: 58,
    ruin: 54,
    subvert: 52,
    swap: 45,
    sealAll: 38,
    sealOrtho: 30,
    shift: 34,
    silence: 44,
    extra: 18,
    charge: 16,
    store: 16,
    discount: 14
  };

  // 三档能力开关：困难档关闭随机失误，并额外启用整回合搜索。
  const DIFFICULTY = {
    easy: { cardChance: 0.42, random: 0.42, block: 0.2, sleep: 420,
      defend: false, search: false, budget: false, changeTiming: 'never' },
    normal: { cardChance: 0.78, random: 0.12, block: 0.7, sleep: 360,
      defend: true, search: false, budget: false, changeTiming: 'smart' },
    hard: { cardChance: 1, random: 0, block: 1, sleep: 300,
      defend: true, search: true, budget: true, changeTiming: 'rush',
      plan: true, beamWidth: 24, planDepth: 6, cardBranch: 14, cellBranch: 12 }
  };

  // 连段价值：gap = 还差几子；open = 两端有几端是空的
  function patternValue(len, open, target) {
    if (len >= target) return 1e7;
    const gap = target - len;
    if (gap <= 0) return 1e7;
    if (gap === 1) return open >= 2 ? 4.0e6 : open === 1 ? 1.2e6 : 0;
    if (gap === 2) return open >= 2 ? 2.6e5 : open === 1 ? 6.0e4 : 250;
    if (gap === 3) return open >= 2 ? 9.0e3 : open === 1 ? 1.6e3 : 90;
    if (gap === 4) return open >= 2 ? 420 : open === 1 ? 110 : 12;
    return len * len * 4 + open * 6;
  }

  class AI {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.difficulty = options.difficulty || 'normal';
      this.config = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
      this.rand = mulberry32(options.seed || Date.now());
      this.side = 'ai';
    }

    get state() { return this.engine.state; }
    get me() { return this.state.players.ai; }

    async takeTurn(options = {}) {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const step = typeof options.onAction === 'function' ? options.onAction : async () => {};
      if (this.state.status !== 'playing' || this.state.current !== 'ai') return;
      if (this.state.aiOffer && this.state.aiOffer.length) this.resolveAiOffer();
      if (this.state.phase === 'draft') return;

      if (this.config.plan) {
        await this.takeHardTurn(step, sleep);
        return;
      }

      await step({ type: 'start', hand: this.me.hand.length, mana: this.me.mana });
      await sleep(this.config.sleep);
      let guard = 0;
      while (this.state.status === 'playing' && this.me.mana > 0 && guard++ < 10) {
        const move = this.pickCard();
        if (!move) break;
        const entry = this.me.hand.find(item => item.uid === move.uid);
        const cardId = entry && entry.id;
        const result = this.engine.playCard('ai', move.uid, move.payload);
        if (!result.ok) break;
        await step({ type: 'card', cardId, result, mana: this.me.mana });
        await sleep(this.config.sleep);
        if (this.state.status !== 'playing') return;
      }

      const cell = this.pickPlacement();
      if (cell) {
        const placeResult = this.engine.place('ai', cell.r, cell.c);
        if (placeResult.ok) await step({ type: 'place', r: cell.r, c: cell.c, result: placeResult });
        await sleep(this.config.sleep);
      }
      if (this.state.status !== 'playing') return;

      guard = 0;
      while (this.state.status === 'playing' && this.me.mana > 0 && guard++ < 6) {
        const move = this.pickCard();
        if (!move) break;
        const entry = this.me.hand.find(item => item.uid === move.uid);
        const cardId = entry && entry.id;
        const result = this.engine.playCard('ai', move.uid, move.payload);
        if (!result.ok) break;
        await step({ type: 'card', cardId, result, mana: this.me.mana });
        await sleep(this.config.sleep);
      }
      if (this.state.status !== 'playing') return;

      const discarded = this.discardToLimit();
      if (discarded.length) await step({ type: 'discard', cards: discarded });
      await step({ type: 'end', cardCount: this.me.hand.length });
      this.engine.endTurn('ai');
    }

    resolveAiOffer() {
      const offer = this.state.aiOffer || [];
      const need = Math.min(this.engine.rules.draftPick, offer.length);
      if (!need) return;
      let picks;
      if (this.difficulty === 'easy') {
        picks = offer.map((_, index) => index)
          .sort(() => this.rand() - 0.5)
          .slice(0, need);
      } else if (this.difficulty === 'hard') {
        picks = this.bestDraftCombination(offer, need);
      } else {
        picks = offer.map((entry, index) => ({ index, value: CARD_VALUE[entry.id] || 0 }))
          .sort((a, b) => b.value - a.value)
          .slice(0, need)
          .map(item => item.index);
      }
      this.engine.chooseAiOffer(picks);
    }

    bestDraftCombination(offer, need) {
      let best = [];
      let bestScore = -Infinity;
      const visit = (start, chosen) => {
        if (chosen.length === need) {
          const entries = chosen.map(index => offer[index]);
          const score = entries.reduce((sum, entry) => sum + this.draftCardValue(entry), 0)
            + this.draftSynergy(entries);
          if (score > bestScore) {
            bestScore = score;
            best = chosen.slice();
          }
          return;
        }
        for (let i = start; i < offer.length; i++) {
          chosen.push(i);
          visit(i + 1, chosen);
          chosen.pop();
        }
      };
      visit(0, []);
      return best;
    }

    draftCardValue(entry) {
      let value = (CARD_VALUE[entry.id] || 0) * 100;
      const playerWins = this.countWinningPlacements('player', 3);
      if (playerWins && ['sealOrtho', 'sealAll', 'ruin', 'subvert'].includes(entry.id)) value += 8e6;
      if (entry.id === 'twin' && this.canTwinWin('ai')) value += 1e8;
      if (entry.id === 'shift' && this.canShiftWin('ai')) value += 1e8;
      if (entry.id === 'subvert' && this.canSubvertWin('ai')) value += 1e8;
      if (entry.id === 'sixwin' && this.shouldChangeWin()) value += 2e6;
      if (entry.id === 'silence' && this.potentialCardWinCount('player')) value += 8e5;
      return value;
    }

    draftSynergy(entries) {
      const ids = entries.map(entry => entry.id);
      let score = 0;
      if (ids.includes('discount')) {
        const expensive = entries.some(entry => entry.id !== 'discount'
          && (this.engine.cardById(entry.id)?.cost || 0) >= 2);
        if (expensive) score += 12000;
      }
      if (ids.includes('charge') && entries.some(entry => (this.engine.cardById(entry.id)?.cost || 0) >= 3)) score += 8000;
      if (new Set(ids).size < ids.length) score -= 1800;
      return score;
    }

    async takeHardTurn(step, sleep) {
      await step({ type: 'start', hand: this.me.hand.length, mana: this.me.mana });
      await sleep(this.config.sleep);

      const plan = this.planHardTurn();
      for (const action of plan) {
        if (this.state.status !== 'playing') return;
        if (action.type === 'card') {
          const entry = this.me.hand.find(item => item.uid === action.uid);
          if (!entry) continue;
          const result = this.engine.playCard('ai', action.uid, action.payload || {});
          if (!result.ok) continue;
          await step({ type: 'card', cardId: entry.id, result, mana: this.me.mana });
        } else if (action.type === 'place') {
          const result = this.engine.place('ai', action.r, action.c);
          if (!result.ok) continue;
          await step({ type: 'place', r: action.r, c: action.c, result });
        }
        await sleep(this.config.sleep);
      }

      // A defensive fallback keeps the turn legal if a future card rule changes
      // after the plan was generated.
      if (this.state.status !== 'playing') return;
      if (!this.state.placed) {
        const cell = this.pickPlacement();
        if (cell) {
          const result = this.engine.place('ai', cell.r, cell.c);
          if (result.ok) await step({ type: 'place', r: cell.r, c: cell.c, result });
        }
      }
      if (this.state.status !== 'playing') return;

      const discarded = this.discardToLimit();
      if (discarded.length) await step({ type: 'discard', cards: discarded });
      await step({ type: 'end', cardCount: this.me.hand.length });
      this.engine.endTurn('ai');
    }

    // Search the complete current turn. Cards may be played before or after the
    // single placement, and the player is allowed to continue after placing.
    planHardTurn() {
      const immediateCard = this.findImmediateCardWin();
      if (immediateCard) return [{ type: 'card', uid: immediateCard.uid, payload: immediateCard.payload }];
      if (!this.winningCells('ai').length) {
        const forcedDefense = this.findForcedDefensePlan();
        if (forcedDefense) return forcedDefense;
      }
      const root = {
        state: this.cloneState(this.state),
        uid: this.engine.uid,
        actions: [],
        score: this.evaluateState()
      };
      let beam = [root];
      const completed = [];
      const seen = new Map();

      for (let depth = 0; depth < this.config.planDepth; depth++) {
        const next = [];
        for (const node of beam) {
          if (node.state.status === 'over') {
            if (node.state.winner === 'ai') return node.actions;
            continue;
          }
          if (node.state.placed) completed.push(node);

          const actions = this.withSnapshot(node.state, node.uid, () => {
            const out = [];
            if (!this.state.placed) out.push(...this.hardPlacementActions());
            if (this.me.mana > 0) out.push(...this.hardCardActions());
            return out;
          });
          for (const action of actions) {
            const result = this.applySimulatedAction(node, action);
            if (!result) continue;
            const key = this.planStateKey(result.state);
            const previous = seen.get(key);
            if (previous && previous >= result.score) continue;
            seen.set(key, result.score);
            next.push(result);
          }
        }
        if (!next.length) break;
        next.sort((a, b) => b.score - a.score);
        beam = next.slice(0, this.config.beamWidth);
      }

      for (const node of beam) if (node.state.placed) completed.push(node);
      completed.sort((a, b) => b.score - a.score);
      let best = null;
      for (const node of completed.slice(0, 18)) {
        const deepScore = this.withSnapshot(node.state, node.uid, () => this.evaluateTurnOutcome());
        if (!best || deepScore > best.score) best = { node, score: deepScore };
      }
      return best ? best.node.actions : [];
    }

    // Covers wins caused by cards whose effect is not a plain placement
    // (especially swap and ruin), not only the three legacy fast paths.
    findImmediateCardWin() {
      const root = { state: this.cloneState(this.state), uid: this.engine.uid, actions: [], score: 0 };
      for (const entry of this.me.hand) {
        if (this.engine.cardCost(entry) > this.me.mana) continue;
        if (entry.id === 'sixwin' && !this.shouldChangeWin()) continue;
        for (const payload of this.candidatePayloads(entry)) {
          const result = this.applySimulatedAction(root, { type: 'card', uid: entry.uid, payload });
          if (result && result.state.status === 'over' && result.state.winner === 'ai') {
            return { type: 'card', uid: entry.uid, payload };
          }
        }
      }
      return null;
    }

    // If the opponent has multiple winning cells, ordinary placement scoring
    // is not enough: find a card-plus-placement line that removes every one.
    findForcedDefensePlan() {
      const threats = this.winningCells('player');
      if (threats.length < 2) return null;
      const root = { state: this.cloneState(this.state), uid: this.engine.uid, actions: [], score: 0 };
      const cards = this.hardCardActions();
      for (const card of cards) {
        const afterCard = this.applySimulatedAction(root, card);
        if (!afterCard || afterCard.state.status === 'over') continue;
        const cells = this.withSnapshot(afterCard.state, afterCard.uid, () => {
          const wins = this.winningCells('player');
          if (wins.length) return wins;
          return this.hardPlacementActions().map(action => ({ r: action.r, c: action.c }));
        });
        for (const cell of cells.slice(0, 28)) {
          const afterPlace = this.applySimulatedAction(afterCard, { type: 'place', r: cell.r, c: cell.c });
          if (!afterPlace || afterPlace.state.status === 'over') continue;
          const remaining = this.withSnapshot(afterPlace.state, afterPlace.uid,
            () => this.countWinningPlacements('player', 1));
          if (!remaining) return afterPlace.actions;
        }
      }
      return null;
    }

    applySimulatedAction(node, action) {
      return this.withSnapshot(node.state, node.uid, () => {
        let result;
        if (action.type === 'card') result = this.engine.playCard('ai', action.uid, action.payload || {});
        else result = this.engine.place('ai', action.r, action.c);
        if (!result || !result.ok) return null;
        return {
          state: this.cloneState(this.state),
          uid: this.engine.uid,
          actions: node.actions.concat([{ ...action, payload: action.payload ? { ...action.payload } : undefined }]),
          score: this.evaluateState()
        };
      });
    }

    hardPlacementActions() {
      const cells = this.legalCells('ai');
      if (!cells.length) return [];
      const winning = cells.filter(cell => this.isWinningCell('ai', cell));
      const blocking = cells.filter(cell => this.isWinningCell('player', cell));
      const ranked = cells
        .map(cell => ({ ...cell, value: this.hardPlaceValue(cell, winning, blocking) }))
        .sort((a, b) => b.value - a.value);
      const chosen = [];
      const add = cell => {
        if (!cell) return;
        const key = `${cell.r},${cell.c}`;
        if (!chosen.some(item => `${item.r},${item.c}` === key)) chosen.push(cell);
      };
      winning.forEach(add);
      blocking.forEach(add);
      ranked.slice(0, this.config.cellBranch).forEach(add);
      return chosen.slice(0, this.config.cellBranch).map(cell => ({ type: 'place', r: cell.r, c: cell.c }));
    }

    hardCardActions() {
      const primary = [];
      const extras = [];
      const affordable = this.me.hand.filter(entry => this.engine.cardCost(entry) <= this.me.mana
        && (entry.id !== 'sixwin' || this.shouldChangeWin()));
      for (const entry of affordable) {
        // Keep several targets per card, but reserve search slots for every
        // card in hand so a broad target list cannot starve another tactic.
        const payloads = this.candidatePayloads(entry);
        const count = ['cell', 'swap'].includes(this.engine.cardById(entry.id)?.target) ? 4 : 6;
        const actions = payloads.slice(0, count).map(payload => ({ type: 'card', uid: entry.uid, payload }));
        if (actions.length) primary.push(actions[0]);
        for (const action of actions.slice(1)) extras.push(action);
      }
      primary.sort((a, b) => this.cardActionValue(b) - this.cardActionValue(a));
      extras.sort((a, b) => this.cardActionValue(b) - this.cardActionValue(a));
      const moves = primary.slice(0, this.config.cardBranch);
      for (const action of extras) {
        if (moves.length >= this.config.cardBranch) break;
        moves.push(action);
      }
      return moves;
    }

    evaluateTurnOutcome() {
      const current = this.evaluateState()
        + this.potentialCardWinCount('ai') * 1.2e8
        - this.potentialCardWinCount('player') * 1.8e8;
      if (Math.abs(current) >= 1e11) return current;
      const replies = this.replyCandidates('player', 12);
      if (!replies.length) return current;
      let worst = Infinity;
      for (const reply of replies) {
        const previous = this.state.cells[reply.r][reply.c];
        this.state.cells[reply.r][reply.c] = {
          uid: 'sim-player-reply', owner: 'player', doubled: false, placedPly: this.state.ply + 1
        };
        if (this.engine.findWin('player')) {
          this.state.cells[reply.r][reply.c] = previous;
          return -9e11;
        }

        let bestAnswer = -Infinity;
        const answers = this.replyCandidates('ai', 10);
        for (const answer of answers) {
          const old = this.state.cells[answer.r][answer.c];
          this.state.cells[answer.r][answer.c] = {
            uid: 'sim-ai-answer', owner: 'ai', doubled: false, placedPly: this.state.ply + 2
          };
          const score = this.engine.findWin('ai') ? 8e11 : this.evaluateState();
          this.state.cells[answer.r][answer.c] = old;
          if (score > bestAnswer) bestAnswer = score;
        }
        this.state.cells[reply.r][reply.c] = previous;
        worst = Math.min(worst, bestAnswer);
      }
      return current * 0.35 + worst * 0.65;
    }

    replyCandidates(side, limit) {
      const other = side === 'ai' ? 'player' : 'ai';
      const cells = this.threatCells();
      const winning = cells.filter(cell => this.isWinningCell(side, cell));
      const ranked = cells.map(cell => ({
        ...cell,
        value: this.threatScore(side, cell.r, cell.c)
          + this.threatScore(other, cell.r, cell.c) * 0.96
          + Math.max(0, this.countWinningAfterPlacement(side, cell) - 1) * 5e7
      })).sort((a, b) => b.value - a.value);
      const out = [];
      const add = cell => {
        if (cell && !out.some(item => item.r === cell.r && item.c === cell.c)) out.push(cell);
      };
      winning.forEach(add);
      ranked.slice(0, limit).forEach(add);
      return out.slice(0, limit);
    }

    cardActionValue(action) {
      const entry = this.me.hand.find(item => item.uid === action.uid);
      if (!entry) return -Infinity;
      const value = CARD_VALUE[entry.id] || 0;
      if (entry.id === 'charge' || entry.id === 'store') return value - 8;
      if (entry.id === 'sixwin' && this.shouldChangeWin()) return value + 80;
      if (entry.id === 'twin' && this.findTwinWin()) return 1e8;
      if ((entry.id === 'subvert' || entry.id === 'shift') && this.findWinCard([entry])) return 1e8;
      return value;
    }

    hardPlaceValue(cell, winning, blocking) {
      const own = this.threatScore('ai', cell.r, cell.c);
      const foe = this.threatScore('player', cell.r, cell.c);
      const ownFork = this.countWinningAfterPlacement('ai', cell) - 1;
      const blocks = blocking.some(item => item.r === cell.r && item.c === cell.c) ? 1e8 : 0;
      const win = winning.some(item => item.r === cell.r && item.c === cell.c) ? 1e10 : 0;
      return win + blocks + ownFork * 4e6 + own * 1.2 + foe * 0.98 + this.placeScore('ai', cell.r, cell.c);
    }

    cloneState(state) {
      return JSON.parse(JSON.stringify(state));
    }

    // Simulations never leak events into the UI and always restore the exact
    // object reference held by the live game.
    withSnapshot(snapshot, uid, fn) {
      const liveState = this.engine.state;
      const liveUid = this.engine.uid;
      const liveListeners = this.engine.listeners;
      this.engine.state = this.cloneState(snapshot);
      this.engine.uid = uid;
      this.engine.listeners = [];
      try {
        return fn();
      } finally {
        this.engine.state = liveState;
        this.engine.uid = liveUid;
        this.engine.listeners = liveListeners;
      }
    }

    planStateKey(state) {
      const board = state.cells.map(row => row.map(stone => {
        if (!stone) return '.';
        return stone.owner === 'ai' ? (stone.doubled ? 'A2' : 'A') : (stone.doubled ? 'P2' : 'P');
      }).join('')).join('/');
      const hand = state.players.ai.hand.map(entry => `${entry.id}${entry.discount ? '*' : ''}`).sort().join(',');
      const seals = Object.keys(state.seals || {})
        .filter(key => state.seals[key] > state.ply)
        .sort()
        .map(key => `${key}:${state.seals[key]}`)
        .join(',');
      const ai = state.players.ai;
      const player = state.players.player;
      return `${state.status}|${state.placed ? 1 : 0}|${state.players.ai.mana}|${hand}|${board}`
        + `|${seals}|${ai.winTarget}|${player.winTarget}|${ai.silenced ? 1 : 0}`
        + `|${player.silenced ? 1 : 0}|${ai.nextMana || 0}|${ai.extraDraw || 0}`;
    }

    evaluateState() {
      const s = this.state;
      if (s.status === 'over') return s.winner === 'ai' ? 1e12 : s.winner === 'player' ? -1e12 : -1e8;
      const aiWins = this.countWinningPlacements('ai', 3);
      const playerWins = this.countWinningPlacements('player', 3);
      const aiMax = this.maxLineWeight('ai');
      const playerMax = this.maxLineWeight('player');
      const aiThreat = this.maxThreat('ai');
      const playerThreat = this.maxThreat('player');
      const aiCards = s.players.ai.hand.reduce((sum, entry) => sum + (CARD_VALUE[entry.id] || 0), 0);
      const resources = (s.players.ai.nextMana || 0) * 8e4
        + (s.players.ai.extraDraw || 0) * 4e4
        + (s.players.player.silenced ? 6e4 : 0);
      return aiWins * 7e8 - playerWins * 9e8
        + (aiWins > 1 ? 4e8 : 0) - (playerWins > 1 ? 6e8 : 0)
        + aiMax * 1800 - playerMax * 2200
        + aiThreat * 0.7 - playerThreat * 0.9
        + aiCards * 600 + s.players.ai.mana * 120 + resources;
    }

    // Assume the opponent could hold a tactical manipulation card. This is
    // deliberately pessimistic in hard mode and prevents cheap card ambushes.
    potentialCardWinCount(side) {
      let total = 0;
      if (this.canTwinWin(side)) total++;
      if (this.canShiftWin(side)) total++;
      if (this.canSubvertWin(side)) total++;
      return total;
    }

    canTwinWin(side) {
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const stone = this.state.cells[r][c];
        if (!stone || stone.owner !== side || stone.doubled) continue;
        stone.doubled = true;
        const win = this.engine.findWin(side);
        stone.doubled = false;
        if (win) return true;
      }
      return false;
    }

    canShiftWin(side) {
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const stone = this.state.cells[r][c];
        if (!stone || stone.owner !== side) continue;
        for (const to of this.engine.getMoveDestinations(r, c)) {
          this.state.cells[r][c] = null;
          this.state.cells[to.r][to.c] = stone;
          const win = this.engine.findWin(side);
          this.state.cells[to.r][to.c] = null;
          this.state.cells[r][c] = stone;
          if (win) return true;
        }
      }
      return false;
    }

    canSubvertWin(side) {
      const foe = side === 'ai' ? 'player' : 'ai';
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const changed = [];
        for (const [dr, dc] of ORTHO) {
          const stone = this.engine.getStone(r + dr, c + dc);
          if (stone && stone.owner === foe) {
            changed.push(stone);
            stone.owner = side;
          }
        }
        const win = changed.length && this.engine.findWin(side);
        changed.forEach(stone => { stone.owner = foe; });
        if (win) return true;
      }
      return false;
    }

    maxThreat(side) {
      let best = 0;
      for (const cell of this.threatCells()) best = Math.max(best, this.threatScore(side, cell.r, cell.c));
      return best;
    }

    legalCells() {
      const out = [];
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        if (!this.state.cells[r][c] && !this.engine.isSealed(r, c)) out.push({ r, c });
      }
      return out;
    }

    // A direct winning placement must touch an existing line, so distant empty
    // cells cannot be tactical candidates. This bounds the hard-mode search.
    threatCells() {
      const stones = [];
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        if (this.state.cells[r][c]) stones.push({ r, c });
      }
      if (!stones.length) {
        const mid = Math.floor(this.state.size / 2);
        return this.legalCells().filter(cell => Math.abs(cell.r - mid) <= 1 && Math.abs(cell.c - mid) <= 1);
      }
      return this.legalCells().filter(cell => stones.some(stone =>
        Math.abs(cell.r - stone.r) <= 2 && Math.abs(cell.c - stone.c) <= 2));
    }

    winningCells(side, limit = 0) {
      const out = [];
      for (const cell of this.threatCells()) {
        if (!this.isWinningCell(side, cell)) continue;
        out.push(cell);
        if (limit && out.length >= limit) break;
      }
      return out;
    }

    countWinningPlacements(side, limit = 0) {
      return this.winningCells(side, limit).length;
    }

    countWinningAfterPlacement(side, cell) {
      if (!cell || this.state.cells[cell.r][cell.c] || this.engine.isSealed(cell.r, cell.c)) return 0;
      const previous = this.state.cells[cell.r][cell.c];
      this.state.cells[cell.r][cell.c] = { uid: 'sim', owner: side, doubled: false, placedPly: this.state.ply };
      const count = this.countWinningPlacements(side, 0);
      this.state.cells[cell.r][cell.c] = previous;
      return count;
    }

    candidatePayloads(entry) {
      const card = this.engine.cardById(entry.id);
      if (!card) return [];
      if (card.target === 'none') return [{}];
      const out = [];
      const add = payload => {
        if (!payload) return;
        const key = JSON.stringify(payload);
        if (!out.some(item => JSON.stringify(item) === key)) out.push(payload);
      };
      const best = this.bestPayload(entry);
      add(best);

      if (card.target === 'handCard') {
        this.me.hand
          .filter(item => item.uid !== entry.uid && !item.discount)
          .sort((a, b) => this.engine.cardCost(b) - this.engine.cardCost(a))
          .slice(0, 4)
          .forEach(item => add({ uid: item.uid }));
      } else if (card.target === 'stoneOwn') {
        if (this.findTwinWin()) add(this.findTwinWin());
        this.ownStonesByValue().slice(0, 6).forEach(stone => add({ r: stone.r, c: stone.c }));
      } else if (card.target === 'moveOwn') {
        if (this.findShiftWin()) add(this.findShiftWin());
        this.moveCandidates().slice(0, 8).forEach(move => add(move));
      } else if (card.target === 'swap') {
        this.swapCandidates().slice(0, 12).forEach(move => add(move));
      } else if (card.target === 'cell') {
        const playerWins = this.winningCells('player', 8);
        playerWins.forEach(cell => {
          add(cell);
          for (const [dr, dc] of DIRS) {
            const r = cell.r + dr;
            const c = cell.c + dc;
            if (this.engine.inBounds(r, c)) add({ r, c });
          }
        });
        this.winningCells('ai', 8).forEach(cell => add(cell));
        this.tacticalCells().slice(0, 10).forEach(cell => add(cell));
      }
      return out.slice(0, 12);
    }

    tacticalCells() {
      const all = this.legalCells();
      const ranked = all.map(cell => ({ ...cell, value: this.placeValue(cell.r, cell.c) }))
        .sort((a, b) => b.value - a.value);
      return ranked;
    }

    ownStonesByValue() {
      const out = [];
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const stone = this.state.cells[r][c];
        if (stone && stone.owner === 'ai' && !stone.doubled) {
          out.push({ r, c, value: this.threatScore('ai', r, c) });
        }
      }
      return out.sort((a, b) => b.value - a.value);
    }

    moveCandidates() {
      const out = [];
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const stone = this.state.cells[r][c];
        if (!stone || stone.owner !== 'ai') continue;
        for (const to of this.engine.getMoveDestinations(r, c)) {
          const value = this.withSnapshot(this.cloneState(this.state), this.engine.uid, () => {
            const moving = this.state.cells[r][c];
            this.state.cells[r][c] = null;
            this.state.cells[to.r][to.c] = moving;
            const score = this.threatScore('ai', to.r, to.c);
            return score;
          });
          out.push({ from: { r, c }, to, value });
        }
      }
      return out.sort((a, b) => b.value - a.value);
    }

    swapCandidates() {
      const stones = [];
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        if (this.state.cells[r][c]) stones.push({ r, c, value: this.placeScore(this.state.cells[r][c].owner, r, c) });
      }
      const out = [];
      // Swap changes only two positions, so evaluate every pair exactly. The
      // old static ranking missed decisive exchanges involving an isolated
      // spare stone or an enemy blocker.
      for (let i = 0; i < stones.length; i++) for (let j = i + 1; j < stones.length; j++) {
        const first = stones[i];
        const second = stones[j];
        const snapshot = this.snapshot();
        const a = this.state.cells[first.r][first.c];
        const b = this.state.cells[second.r][second.c];
        this.state.cells[first.r][first.c] = b;
        this.state.cells[second.r][second.c] = a;
        const wins = this.engine.findWin('ai') ? 1 : 0;
        const loses = this.engine.findWin('player') ? 1 : 0;
        const value = wins * 1e10 - loses * 1e10
          + this.boardShapeScore('ai') - this.boardShapeScore('player') * 1.1;
        this.restore(snapshot);
        out.push({
          first: { r: first.r, c: first.c },
          second: { r: second.r, c: second.c },
          value
        });
      }
      return out.sort((a, b) => b.value - a.value);
    }

    boardShapeScore(side) {
      let total = 0;
      for (const cell of this.threatCells()) {
        const score = this.threatScore(side, cell.r, cell.c);
        if (score >= 1e7) total += 5e7;
        else total += Math.min(score, 5e6);
      }
      return total;
    }

    discardToLimit() {
      const hand = this.me.hand;
      if (hand.length <= this.engine.rules.handLimit) return [];
      const sorted = hand.slice().sort((a, b) => {
        const ca = this.config.plan ? this.hardDiscardValue(a) : (CARD_VALUE[a.id] || 0);
        const cb = this.config.plan ? this.hardDiscardValue(b) : (CARD_VALUE[b.id] || 0);
        return ca - cb;
      });
      const need = hand.length - this.engine.rules.handLimit;
      const removed = sorted.slice(0, need).map(entry => entry.id);
      this.engine.discard('ai', sorted.slice(0, need).map(entry => entry.uid));
      return removed;
    }

    hardDiscardValue(entry) {
      let value = (CARD_VALUE[entry.id] || 0) * 100;
      if (entry.discount) value += 12000;
      const playerWins = this.countWinningPlacements('player', 3);
      const playerCardThreat = this.potentialCardWinCount('player');
      if (playerWins && ['sealOrtho', 'sealAll', 'ruin', 'subvert'].includes(entry.id)) value += 1e7;
      if (playerCardThreat && ['silence', 'ruin', 'subvert', 'swap'].includes(entry.id)) value += 3e6;
      if (entry.id === 'twin' && this.canTwinWin('ai')) value += 1e8;
      if (entry.id === 'shift' && this.canShiftWin('ai')) value += 1e8;
      if (entry.id === 'subvert' && this.canSubvertWin('ai')) value += 1e8;
      if (entry.id === 'sixwin' && this.me.winTarget > 6 && this.maxLineWeight('ai') >= 4) value += 2e6;
      if (entry.id === 'discount' && this.me.hand.some(item => item.uid !== entry.uid && this.engine.cardCost(item) >= 2)) value += 4000;
      return value;
    }

    pickCard() {
      if (this.config.plan) return this.hardPickCard();
      if (this.rand() > this.config.cardChance) return null;
      const e = this.engine;
      const cfg = this.config;
      const affordable = this.me.hand.filter(entry => e.cardCost(entry) <= this.me.mana);
      if (!affordable.length) return null;
      // 改胜看时机：不到时候就从「泛用池」里排除，免得被 CARD_VALUE 顶到最前面
      const hand = affordable.filter(entry => entry.id !== 'sixwin' || !cfg.changeTiming || this.shouldChangeWin());

      const win = this.findWinCard(hand);
      if (win) return win;

      if (cfg.block > 0.5) {
        const block = this.findBlockCard(hand);
        if (block) return block;
      }

      if (cfg.random > this.rand()) {
        const entry = hand[Math.floor(this.rand() * hand.length)];
        const payload = this.autoPayload(entry);
        if (payload) return { uid: entry.uid, payload };
      }

      // 0 费牌先打：蓄力/储能不花体力，纯赚（有预算档才做，低档保持原样）
      if (cfg.budget) {
        const free = hand.find(entry => e.cardCost(entry) === 0 && (entry.id === 'charge' || entry.id === 'store'));
        if (free) return { uid: free.uid, payload: this.autoPayload(free) };
        // 省力只用在 ≥2 费的牌上，否则等于白花 1 点体力
        const discount = hand.find(entry => entry.id === 'discount');
        if (discount) {
          const target = this.me.hand
            .filter(item => item.uid !== discount.uid && !item.discount && e.cardCost(item) >= 2)
            .sort((a, b) => e.cardCost(b) - e.cardCost(a))[0];
          if (target) return { uid: discount.uid, payload: { uid: target.uid } };
        }
      }

      const sorted = hand
        .map(entry => ({ entry, value: (CARD_VALUE[entry.id] || 0) + this.cardBonus(entry) }))
        .sort((a, b) => b.value - a.value);
      for (const { entry } of sorted) {
        // 有预算档时，别为了「把体力花光」去打低价值牌
        if (cfg.budget && (CARD_VALUE[entry.id] || 0) < 16 && e.cardCost(entry) > 0) continue;
        const payload = this.bestPayload(entry);
        if (payload) return { uid: entry.uid, payload };
      }
      return null;
    }

    hardPickCard() {
      const affordable = this.me.hand.filter(entry => this.engine.cardCost(entry) <= this.me.mana);
      if (!affordable.length) return null;
      const win = this.findWinCard(affordable);
      if (win) return win;

      const threats = this.winningCells('player');
      const defensive = affordable
        .filter(entry => ['sealOrtho', 'sealAll', 'ruin', 'subvert', 'silence'].includes(entry.id))
        .map(entry => {
          const payload = this.bestPayload(entry);
          if (!payload) return null;
          const covers = this.withSnapshot(this.cloneState(this.state), this.engine.uid, () => {
            const before = this.winningCells('player').map(cell => `${cell.r},${cell.c}`);
            const result = this.engine.playCard('ai', entry.uid, payload);
            if (!result.ok) return -Infinity;
            const after = this.winningCells('player').map(cell => `${cell.r},${cell.c}`);
            return (before.length - after.length) * 1e7 - after.length * 1e5;
          });
          return { entry, payload, value: covers };
        })
        .filter(Boolean)
        .sort((a, b) => b.value - a.value);
      if (threats.length && defensive.length && defensive[0].value > 0) {
        return { uid: defensive[0].entry.uid, payload: defensive[0].payload };
      }

      const sorted = affordable
        .filter(entry => entry.id !== 'sixwin' || this.shouldChangeWin())
        .map(entry => ({ entry, value: (CARD_VALUE[entry.id] || 0) + this.cardBonus(entry) }))
        .sort((a, b) => b.value - a.value);
      for (const { entry } of sorted) {
        const payload = this.bestPayload(entry);
        if (payload) return { uid: entry.uid, payload };
      }
      return null;
    }

    // 改胜值不值得现在打：快赢了 / 手牌要满 / 中盘以后
    shouldChangeWin() {
      const me = this.me;
      if (me.winTarget <= 6) return false;
      if (this.maxLineWeight('ai') >= 5) return true;              // 已经有五连，改成六子立刻有威胁
      if (me.hand.length >= this.engine.rules.handLimit) return true; // 放着也会被弃掉
      return this.state.ply >= 8;                                   // 中盘再打，别开局浪费 3 点体力
    }

    cardBonus(entry) {
      if (entry.id === 'extra' && this.me.hand.length >= 7) return -20;
      if (entry.id === 'silence' && this.state.players.player.silenced) return -50;
      return 0;
    }

    findWinCard(hand) {
      // 改胜：看时机（见 shouldChangeWin），不再抽到就打
      const sixwin = hand.find(entry => entry.id === 'sixwin');
      if (sixwin && this.me.winTarget > 6 && this.shouldChangeWin()) return { uid: sixwin.uid, payload: {} };
      for (const entry of hand) {
        if (entry.id === 'twin') {
          const at = this.findTwinWin();
          if (at) return { uid: entry.uid, payload: at };
        }
        if (entry.id === 'subvert') {
          const at = this.findSubvertWin();
          if (at) return { uid: entry.uid, payload: at };
        }
        if (entry.id === 'shift') {
          const at = this.findShiftWin();
          if (at) return { uid: entry.uid, payload: at };
        }
      }
      return null;
    }

    findBlockCard(hand) {
      const threat = this.findPlayerThreat();
      if (!threat) return null;
      const byId = id => hand.find(entry => entry.id === id);
      if (threat.type === 'place') {
        const seal = byId('sealOrtho') || byId('sealAll');
        if (seal) return { uid: seal.uid, payload: this.sealPayloadNear(threat.cell) };
        const ruin = byId('ruin');
        if (ruin) return { uid: ruin.uid, payload: this.ruinPayloadNear(threat.cell) };
      }
      if (threat.type === 'five') {
        const subvert = byId('subvert');
        if (subvert) return { uid: subvert.uid, payload: this.subvertPayloadOn(threat.cells) };
      }
      return null;
    }

    autoPayload(entry) {
      const card = this.engine.cardById(entry.id);
      if (!card) return null;
      if (card.target === 'none') return {};
      return this.bestPayload(entry);
    }

    bestPayload(entry) {
      const card = this.engine.cardById(entry.id);
      if (!card) return null;
      if (card.target === 'none') return {};
      if (card.target === 'stoneOwn') {
        return this.findTwinWin() || this.bestOwnStone();
      }
      if (card.target === 'moveOwn') {
        return this.findShiftWin() || this.bestShift();
      }
      if (card.target === 'swap') {
        return this.bestSwap();
      }
      if (card.target === 'handCard') {
        const target = this.me.hand
          .filter(item => item.uid !== entry.uid && !item.discount)
          .sort((a, b) => this.engine.cardCost(b) - this.engine.cardCost(a))[0];
        return target ? { uid: target.uid } : null;
      }
      if (entry.id === 'subvert') {
        return this.findSubvertWin() || this.bestSubvert();
      }
      if (entry.id === 'ruin') {
        return this.bestRuin();
      }
      if (entry.id === 'sealOrtho' || entry.id === 'sealAll') {
        return this.bestSeal(entry.id);
      }
      if (entry.id === 'twin') return this.bestOwnStone();
      return null;
    }

    findTwinWin() {
      const e = this.engine;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const stone = this.state.cells[r][c];
        if (!stone || stone.owner !== 'ai' || stone.doubled) continue;
        stone.doubled = true;
        const win = e.findWin('ai');
        stone.doubled = false;
        if (win) return { r, c };
      }
      return null;
    }

    findSubvertWin() {
      const e = this.engine;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        if (!this.subvertWouldChange(r, c)) continue;
        const snapshot = this.snapshot();
        this.applySubvert(r, c);
        const win = e.findWin('ai');
        this.restore(snapshot);
        if (win) return { r, c };
      }
      return null;
    }

    findShiftWin() {
      const e = this.engine;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const stone = this.state.cells[r][c];
        if (!stone || stone.owner !== 'ai') continue;
        for (const [dr, dc] of DIRS) {
          const nr = r + dr;
          const nc = c + dc;
          if (!e.inBounds(nr, nc)) continue;
          if (e.getStone(nr, nc) || e.isSealed(nr, nc)) continue;
          const snapshot = this.snapshot();
          this.state.cells[r][c] = null;
          this.state.cells[nr][nc] = stone;
          const win = e.findWin('ai');
          this.restore(snapshot);
          if (win) return { from: { r, c }, to: { r: nr, c: nc } };
        }
      }
      return null;
    }

    findPlayerThreat() {
      const e = this.engine;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        if (e.getStone(r, c) || e.isSealed(r, c)) continue;
        this.state.cells[r][c] = { uid: 'threat', owner: 'player', doubled: false, placedPly: this.state.ply };
        const win = e.findWin('player');
        this.state.cells[r][c] = null;
        if (win) return { type: 'place', cell: { r, c } };
      }
      const win = e.findWin('player');
      if (win) return { type: 'five', cells: win.cells };
      return null;
    }

    sealPayloadNear(cell) {
      for (const [dr, dc] of DIRS) {
        const r = cell.r + dr;
        const c = cell.c + dc;
        if (this.engine.inBounds(r, c)) return { r, c };
      }
      return { r: cell.r, c: cell.c };
    }

    ruinPayloadNear(cell) {
      for (const [dr, dc] of DIRS) {
        const r = cell.r + dr;
        const c = cell.c + dc;
        if (this.engine.inBounds(r, c)) return { r, c };
      }
      return { r: cell.r, c: cell.c };
    }

    subvertPayloadOn(cells) {
      if (!cells || !cells.length) return null;
      const first = cells[0];
      return { r: first.r, c: first.c };
    }

    bestOwnStone() {
      let best = null;
      let bestScore = -Infinity;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const stone = this.state.cells[r][c];
        if (!stone || stone.owner !== 'ai' || stone.doubled) continue;
        const score = this.threatScore('ai', r, c) * 1.8;
        if (score > bestScore) {
          bestScore = score;
          best = { r, c };
        }
      }
      return best;
    }

    bestShift() {
      const e = this.engine;
      let best = null;
      let bestScore = -Infinity;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        const stone = this.state.cells[r][c];
        if (!stone || stone.owner !== 'ai') continue;
        for (const dest of e.getMoveDestinations(r, c)) {
          const score = this.placeScore('ai', dest.r, dest.c);
          if (score > bestScore) {
            bestScore = score;
            best = { from: { r, c }, to: dest };
          }
        }
      }
      return best;
    }

    bestSwap() {
      const best = this.swapCandidates()[0];
      return best ? { first: best.first, second: best.second } : null;
    }

    subvertWouldChange(r, c) {
      for (const [dr, dc] of ORTHO) {
        const stone = this.engine.getStone(r + dr, c + dc);
        if (stone && stone.owner === 'player') return true;
      }
      return false;
    }

    bestSubvert() {
      let best = null;
      let bestScore = -1;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        let score = 0;
        for (const [dr, dc] of ORTHO) {
          const stone = this.engine.getStone(r + dr, c + dc);
          if (stone && stone.owner === 'player') score += this.placeScore('ai', r + dr, c + dc);
        }
        if (score > bestScore) {
          bestScore = score;
          best = { r, c };
        }
      }
      return best;
    }

    applySubvert(r, c) {
      for (const [dr, dc] of ORTHO) {
        const stone = this.engine.getStone(r + dr, c + dc);
        if (stone && stone.owner === 'player') stone.owner = 'ai';
      }
    }

    bestRuin() {
      let best = null;
      let bestScore = -1;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        let score = 0;
        for (const [dr, dc] of DIRS) {
          const stone = this.engine.getStone(r + dr, c + dc);
          if (!stone) continue;
          score += stone.owner === 'player' ? 3 : -1.4;
        }
        if (score > bestScore) {
          bestScore = score;
          best = { r, c };
        }
      }
      return best;
    }

    bestSeal(cardId) {
      const dirs = cardId === 'sealOrtho'
        ? ORTHO
        : DIRS;
      let best = null;
      let bestScore = -Infinity;
      for (let r = 0; r < this.state.size; r++) for (let c = 0; c < this.state.size; c++) {
        let score = 0;
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (!this.engine.inBounds(nr, nc)) continue;
          if (this.state.cells[nr][nc] || this.engine.isSealed(nr, nc)) continue;
          const foe = this.threatScore('player', nr, nc);
          const mine = this.threatScore('ai', nr, nc);
          score += foe >= 1e7 ? 1e9 : Math.min(foe, 5e6);
          score -= mine >= 1e7 ? 8e8 : Math.min(mine, 5e6) * 0.72;
        }
        if (score > bestScore) {
          bestScore = score;
          best = { r, c };
        }
      }
      return best;
    }

    /* ---------------- 棋形评估与两层搜索 ---------------- */

    winTargetOf(side) {
      return this.state.players[side].winTarget;
    }

    // 假设 side 落在 (r,c)：四个方向的「连段权重 + 开放端数」
    lineRuns(side, r, c) {
      const e = this.engine;
      const target = this.winTargetOf(side);
      const runs = [];
      for (const [dr, dc] of DIRS) {
        let len = 1;
        let open = 0;
        for (const sign of [-1, 1]) {
          let rr = r + dr * sign;
          let cc = c + dc * sign;
          while (e.inBounds(rr, cc)) {
            const stone = e.getStone(rr, cc);
            if (!stone || stone.owner !== side) break;
            len += stone.doubled ? 2 : 1;
            rr += dr * sign;
            cc += dc * sign;
          }
          if (e.inBounds(rr, cc) && !e.getStone(rr, cc) && !e.isSealed(rr, cc)) open += 1;
        }
        runs.push({ len, open, target, dir: [dr, dc] });
      }
      return runs;
    }

    // 落在 (r,c) 对某一方的价值（只算这一方自己的进攻收益）
    threatScore(side, r, c) {
      let score = 0;
      for (const run of this.lineRuns(side, r, c)) {
        score += patternValue(run.len, run.open, run.target);
      }
      return score;
    }

    isWinningCell(side, cell) {
      return this.threatScore(side, cell.r, cell.c) >= 1e7;
    }

    // 动静结合：自己的收益 + 压住对手最想落的地方
    placeValue(r, c) {
      const mine = this.threatScore('ai', r, c);
      const foe = this.threatScore('player', r, c);
      const mid = (this.state.size - 1) / 2;
      const center = Math.max(0, 10 - (Math.abs(r - mid) + Math.abs(c - mid))) * 0.8;
      return mine + foe * 0.88 + center;
    }

    // 距已有棋子 2 格内的空位，按某一方的威胁分排序
    candidateCells(side, limit) {
      const e = this.engine;
      const n = this.state.size;
      const out = [];
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (this.state.cells[r][c] || e.isSealed(r, c)) continue;
          let near = false;
          for (let dr = -2; dr <= 2 && !near; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const rr = r + dr;
              const cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
              if (this.state.cells[rr][cc]) { near = true; break; }
            }
          }
          if (!near) continue;
          out.push({ r, c, score: this.threatScore(side, r, c) });
        }
      }
      out.sort((a, b) => b.score - a.score);
      return limit ? out.slice(0, limit) : out;
    }

    // 我落在 (r,c) 之后，对手一步能造出的最大威胁（两层搜索的第二层）
    replyThreat(move) {
      const e = this.engine;
      const cell = this.state.cells[move.r][move.c];
      this.state.cells[move.r][move.c] = { uid: 'sim-ai', owner: 'ai', doubled: false, placedPly: this.state.ply };
      const foeCells = this.candidateCells('player', 18);
      let worst = 0;
      for (const c of foeCells) {
        if (c.score <= worst) continue;
        // 对手若这一步直接赢，那就是最坏情况
        worst = Math.max(worst, c.score);
        if (worst >= 1e7) break;
      }
      this.state.cells[move.r][move.c] = cell;
      return worst;
    }

    // 最大连段权重（改胜时机、双生星目标都用它）
    maxLineWeight(side) {
      let best = 0;
      const n = this.state.size;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const stone = this.state.cells[r][c];
          if (!stone || stone.owner !== side) continue;
          for (const [dr, dc] of DIRS) {
            const prev = this.engine.getStone(r - dr, c - dc);
            if (prev && prev.owner === side) continue;
            let len = 0;
            let rr = r;
            let cc = c;
            while (this.engine.inBounds(rr, cc)) {
              const item = this.state.cells[rr][cc];
              if (!item || item.owner !== side) break;
              len += item.doubled ? 2 : 1;
              rr += dr;
              cc += dc;
            }
            best = Math.max(best, len);
          }
        }
      }
      return best;
    }

    pickPlacement() {
      const e = this.engine;
      const cfg = this.config;
      const cells = e.getPlacementCells('ai');
      if (!cells.length) return null;
      if (cfg.plan) {
        const planned = this.hardPlacementActions();
        return planned.length ? { r: planned[0].r, c: planned[0].c } : cells[0];
      }
      if (cfg.random > this.rand()) {
        return cells[Math.floor(this.rand() * cells.length)];
      }

      // A：能一手赢就赢；对手能一手赢就去挡（这是最便宜也最重要的一层）
      if (cfg.defend) {
        const myWin = cells.find(cell => this.isWinningCell('ai', cell));
        if (myWin) return myWin;
        const foeWins = cells.filter(cell => this.isWinningCell('player', cell));
        if (foeWins.length) {
          // 挡点里挑「顺手也最赚」的那个；两个以上本来就挡不住，尽力而为
          let bestBlock = foeWins[0];
          let bestScore = -Infinity;
          for (const cell of foeWins) {
            const score = this.threatScore('ai', cell.r, cell.c);
            if (score > bestScore) { bestScore = score; bestBlock = cell; }
          }
          return bestBlock;
        }
      }

      // 静态排序（B）
      const ranked = cells
        .map(cell => ({ ...cell, value: this.placeValue(cell.r, cell.c) }))
        .sort((a, b) => b.value - a.value);

      if (!cfg.search) return ranked[0];

      // 两层搜索（C）：在自己最好的若干个点里，扣掉「对手下一步最强回应」
      const top = ranked.slice(0, 22);
      let best = top[0];
      let bestScore = -Infinity;
      for (const move of top) {
        const risky = this.replyThreat(move);
        const value = move.value - risky * 0.92;
        if (value > bestScore) {
          bestScore = value;
          best = move;
        }
      }
      return { r: best.r, c: best.c };
    }

    placeScore(side, r, c) {
      const e = this.engine;
      let score = 0;
      for (const [dr, dc] of DIRS) {
        let mine = 0;
        let theirs = 0;
        for (let step = 1; step <= 5; step++) {
          const stone = e.getStone(r + dr * step, c + dc * step);
          if (!stone) break;
          if (stone.owner === side) mine++;
          else { theirs++; break; }
        }
        for (let step = 1; step <= 5; step++) {
          const stone = e.getStone(r - dr * step, c - dc * step);
          if (!stone) break;
          if (stone.owner === side) mine++;
          else { theirs++; break; }
        }
        score += mine * mine * 3 + theirs * theirs * 2;
      }
      const mid = (this.state.size - 1) / 2;
      score += 14 - (Math.abs(r - mid) + Math.abs(c - mid)) * 0.6;
      return score;
    }

    snapshot() {
      return this.state.cells.map(row => row.map(stone => stone ? { ...stone } : null));
    }

    restore(snapshot) {
      this.state.cells = snapshot;
    }
  }

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

  return { AI };
});
