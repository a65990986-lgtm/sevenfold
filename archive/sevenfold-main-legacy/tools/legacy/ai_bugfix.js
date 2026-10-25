/* 七曜牌局 — 人机棋手「墨鸦」
 * 只读取公开信息与自己的暗牌；不会偷看玩家秘式。
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.SevenfoldAI = lib.AI;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIDES = ['player', 'ai'];
  const opposite = side => (side === 'player' ? 'ai' : 'player');
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  const DIFFICULTY = {
    easy: { noise: 0.38, top: 6, card: 0.3, delayed: 0.28, label: '见习' },
    normal: { noise: 0.08, top: 2, card: 0.62, delayed: 0.55, label: '棋师' },
    hard: { noise: 0.015, top: 1, card: 0.86, delayed: 0.78, label: '大棋士' }
  };

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

  class AI {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.side = options.side || 'ai';
      this.difficulty = DIFFICULTY[options.difficulty] ? options.difficulty : 'normal';
      this.rng = mulberry32(options.seed ?? ((Date.now() ^ 0x9e3779b9) >>> 0));
      this.planPlacement = null;
    }

    get config() { return DIFFICULTY[this.difficulty]; }
    // 「敌方」= 我这边的对面。原来多处写死 'player'，只有在 ai 一方才正确。
    get enemy() { return opposite(this.side); }
    get state() { return this.engine.state; }
    get board() { return this.state.cells; }

    inBounds(r, c) {
      return this.engine.inBounds(r, c);
    }

    getStone(r, c) {
      return this.engine.getStone(r, c);
    }

    wouldWinFor(side, r, c, weight = 1, target = 7) {
      if (!this.inBounds(r, c) || this.getStone(r, c)) return false;
      for (const [dr, dc] of DIRS) {
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

    getImmediateWins(side, target) {
      const t = target ?? this.state.players[side].winTarget;
      const wins = [];
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (this.getStone(r, c)) continue;
          if (this.engine.isSealed(r, c)) continue;
          if (this.wouldWinFor(side, r, c, 1, t)) wins.push({ r, c });
        }
      }
      return wins;
    }

    lineWindows(r, c, side, dr, dc, weight, target) {
      const span = target * 2 - 1;
      const center = target - 1;
      const line = [];
      for (let i = 0; i < span; i++) {
        const off = i - center;
        const nr = r + dr * off;
        const nc = c + dc * off;
        if (!this.inBounds(nr, nc)) {
          line.push({ type: 'block' });
        } else if (off === 0) {
          line.push({ type: 'self', weight });
        } else {
          const stone = this.getStone(nr, nc);
          if (!stone) line.push({ type: 'empty' });
          else if (stone.owner === side) line.push({ type: 'self', weight: stone.doubled ? 2 : 1 });
          else line.push({ type: 'block' });
        }
      }

      let score = 0;
      let bestOwn = 0;
      let near = 0;
      for (let start = 0; start <= target - 1; start++) {
        let own = 0;
        let empty = 0;
        let blocked = false;
        for (let j = start; j < start + target; j++) {
          const cell = line[j];
          if (cell.type === 'block') { blocked = true; break; }
          if (cell.type === 'self') own += cell.weight;
          else empty++;
        }
        if (blocked) continue;
        bestOwn = Math.max(bestOwn, own);
        if (own >= target - 2) near++;
        score += this.windowValue(own, empty, target);
      }
      return { score, bestOwn, near };
    }

    windowValue(own, empty, target) {
      const gap = target - own;
      if (gap <= 0) return 2400000;
      if (gap === 1) return 130000;
      if (gap === 2) return 9000;
      if (gap === 3) return 620;
      if (gap === 4) return 48;
      return own * own * 2 + empty;
    }

    scoreCell(r, c, side, weight = 1) {
      if (!this.inBounds(r, c) || this.getStone(r, c)) return { score: -Infinity };
      if (this.engine.isSealed(r, c)) return { score: -Infinity };
      const actor = side;
      const opp = opposite(side);
      const actorTarget = this.state.players[actor].winTarget;
      const oppTarget = this.state.players[opp].winTarget;

      if (this.wouldWinFor(actor, r, c, weight, actorTarget)) {
        return { score: 1e9, win: true, attack: 1e9, defense: 0, threats: 4, best: null };
      }

      let attack = 0;
      let defense = 0;
      let threatDirs = 0;
      let best = { bestOwn: 0, dir: DIRS[0] };

      for (const [dr, dc] of DIRS) {
        const atk = this.lineWindows(r, c, actor, dr, dc, weight, actorTarget);
        attack += atk.score;
        if (atk.bestOwn >= actorTarget - 2) threatDirs++;
        if (atk.bestOwn > best.bestOwn) best = { bestOwn: atk.bestOwn, dir: [dr, dc], near: atk.near };

        const def = this.lineWindows(r, c, opp, dr, dc, 1, oppTarget);
        defense += def.score;
        if (def.bestOwn >= oppTarget - 1) defense += 260000;
      }

      if (this.wouldWinFor(opp, r, c, 1, oppTarget)) {
        defense += 3e8;
      }

      let bonus = 0;
      const center = (this.state.size - 1) / 2;
      const dist = Math.abs(r - center) + Math.abs(c - center);
      bonus += Math.max(0, 10 - dist) * 1.8;
      let neighbors = 0;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const stone = this.inBounds(r + dr, c + dc) ? this.getStone(r + dr, c + dc) : null;
          if (stone && stone.owner === actor) neighbors += 2;
          if (stone && stone.owner !== actor) neighbors += 1;
        }
      }
      bonus += neighbors;
      if (threatDirs >= 2) attack += 90000 * (threatDirs - 1);

      const score = attack * 1.02 + defense * 0.92 + bonus;
      return { score, attack, defense, threats: threatDirs, best, win: false };
    }

    candidateCells() {
      const forced = this.state.forced;
      if (forced && forced.target === this.side) {
        return this.engine.canPlace(this.side, forced.r, forced.c) ? [{ r: forced.r, c: forced.c }] : [];
      }
      const all = this.engine.getPlacementCells(this.side);
      if (!all.length) return [];
      let hasStone = false;
      for (let r = 0; r < this.state.size && !hasStone; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (this.getStone(r, c)) { hasStone = true; break; }
        }
      }
      if (!hasStone) {
        const mid = Math.floor(this.state.size / 2);
        return [{ r: mid, c: mid }];
      }
      const near = [];
      for (const cell of all) {
        let close = false;
        for (let dr = -2; dr <= 2 && !close; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if ((dr || dc) && this.inBounds(cell.r + dr, cell.c + dc) && this.getStone(cell.r + dr, cell.c + dc)) {
              close = true;
              break;
            }
          }
        }
        if (close) near.push(cell);
      }
      return near.length ? near : all;
    }

    rankPlacements() {
      return this.candidateCells().map(cell => ({
        ...cell,
        ...this.scoreCell(cell.r, cell.c, this.side)
      })).sort((a, b) => b.score - a.score);
    }

    choosePlacement() {
      const forced = this.state.forced;
      if (forced && forced.target === this.side) {
        return this.engine.canPlace(this.side, forced.r, forced.c)
          ? { r: forced.r, c: forced.c } : null;
      }
      const wins = this.getImmediateWins(this.side);
      if (wins.length) return this.pickAmong(wins);
      const rank = this.rankPlacements();
      if (!rank.length) return null;
      const threats = this.getImmediateWins(this.enemy);
      if (threats.length) {
        const blocks = threats
          .filter(t => this.engine.canPlace(this.side, t.r, t.c))
          .map(t => ({ ...t, ...this.scoreCell(t.r, t.c, this.side) }))
          .sort((a, b) => b.score - a.score);
        if (blocks.length) {
          if (this.difficulty === 'easy' && this.rng() < 0.18) return this.pickAmong(rank.slice(0, 3));
          return blocks[0];
        }
      }
      const top = Math.min(this.config.top, rank.length);
      if (this.difficulty === 'easy' || this.difficulty === 'normal') {
        const pickPool = rank.slice(0, Math.max(top, this.difficulty === 'easy' ? 7 : 3));
        const weights = pickPool.map((_, i) => Math.exp(-i / (this.difficulty === 'easy' ? 2.2 : 1.1)));
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = this.rng() * total;
        for (let i = 0; i < pickPool.length; i++) {
          roll -= weights[i];
          if (roll <= 0) return pickPool[i];
        }
        return pickPool[0];
      }
      return rank[0];
    }

    pickAmong(list) {
      return list[Math.floor(this.rng() * list.length)];
    }

    handEntries(type) {
      const p = this.state.players[this.side];
      const seen = new Set();
      return p.hand.filter(entry => {
        const card = this.engine.cardById(entry.id);
        if (!card || card.type !== type || seen.has(card.id)) return false;
        seen.add(card.id);
        return this.engine.canPlayCard(this.side, entry.uid).ok;
      });
    }

    maxLineWeight(side) {
      let best = 0;
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          const stone = this.getStone(r, c);
          if (!stone || stone.owner !== side) continue;
          for (const [dr, dc] of DIRS) {
            const prev = this.getStone(r - dr, c - dc);
            if (prev && prev.owner === side) continue;
            let total = 0;
            let nr = r;
            let nc = c;
            while (this.inBounds(nr, nc)) {
              const item = this.getStone(nr, nc);
              if (!item || item.owner !== side) break;
              total += item.doubled ? 2 : 1;
              nr += dr;
              nc += dc;
            }
            best = Math.max(best, total);
          }
        }
      }
      return best;
    }

    simulateMoveWin(from, to, side) {
      const stone = this.getStone(from.r, from.c);
      if (!stone) return null;
      this.engine.setStone(from.r, from.c, null);
      this.engine.setStone(to.r, to.c, stone);
      const win = this.engine.findWin(side);
      this.engine.setStone(to.r, to.c, null);
      this.engine.setStone(from.r, from.c, stone);
      return win;
    }

    findWinningMoveCard(cardId) {
      const movers = this.engine.getCardTargets(this.side, cardId);
      const owner = cardId === 'repel' ? this.enemy : this.side;
      for (const from of movers) {
        for (const to of this.engine.getMoveDestinations(from.r, from.c)) {
          const win = this.simulateMoveWin(from, to, owner);
          if (win) return { from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c }, win };
        }
      }
      return null;
    }

    findForkMove(cardId) {
      const movers = this.engine.getCardTargets(this.side, cardId);
      for (const from of movers) {
        const stone = this.getStone(from.r, from.c);
        if (!stone) continue;
        for (const to of this.engine.getMoveDestinations(from.r, from.c)) {
          this.engine.setStone(from.r, from.c, null);
          this.engine.setStone(to.r, to.c, stone);
          const wins = this.getImmediateWins(this.side);
          // 换位会把己子挪走，可能正好让敌方的连子接上，必须复查。
          const danger = this.getImmediateWins(this.enemy).length;
          this.engine.setStone(to.r, to.c, null);
          this.engine.setStone(from.r, from.c, stone);
          if (wins.length >= 2 && danger === 0) {
            return { from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c } };
          }
        }
      }
      return null;
    }

    pickInstant() {
      const entries = this.handEntries('instant');
      if (!entries.length) return null;
      const byId = id => entries.find(entry => entry.id === id);
      const aiWins = this.getImmediateWins(this.side);
      if (aiWins.length) return null;
      const enemyWins = this.getImmediateWins(this.enemy);

      const shift = byId('shift');
      if (shift) {
        const winning = this.findWinningMoveCard('shift');
        if (winning) return { entry: shift, payload: { from: winning.from, to: winning.to } };
        // 换位牌不落子：敌方有杀时换位等于弃守，只能靠它直接赢。
        const fork = enemyWins.length ? null : this.findForkMove('shift');
        if (fork && this.rng() < 0.72) return { entry: shift, payload: fork };
      }

      const twin = byId('twin');
      if (twin) {
        const wins = [];
        for (const cell of this.candidateCells()) {
          if (this.wouldWinFor(this.side, cell.r, cell.c, 2)) wins.push(cell);
        }
        if (wins.length) {
          const cell = this.pickAmong(wins);
          this.planPlacement = cell;
          return { entry: twin, payload: {} };
        }
      }

      const rank = this.rankPlacements();
      const best = rank[0];
      const canSpend = !enemyWins.length && this.rng() < this.config.card;

      if (best && canSpend) {
        const sealOrtho = byId('sealOrtho');
        const sealDiag = byId('sealDiag');
        if (sealOrtho || sealDiag) {
          const enemyMax = this.maxLineWeight(this.enemy);
          const enemyBest = enemyMax >= 4 ? this.bestEnemyCell() : null;
          const pressured = best.threats >= 2 || (enemyMax >= 4 && best.threats >= 1);
          if (pressured && this.rng() < 0.58) {
            const dir = enemyBest && enemyBest.best ? enemyBest.best.dir : null;
            const diagonal = !!dir && dir[0] !== 0 && dir[1] !== 0;
            const entry = diagonal ? (sealDiag || sealOrtho) : (sealOrtho || sealDiag);
            this.planPlacement = { r: best.r, c: best.c };
            return { entry, payload: {} };
          }
        }
      }

      const ruin = byId('ruin');
      if (ruin && canSpend) {
        const center = this.pickRuinCenter();
        if (center) {
          this.planPlacement = center;
          return { entry: ruin, payload: {} };
        }
      }

      const repel = byId('repel');
      if (repel && canSpend && !enemyWins.length && this.rng() < 0.22) {
        const disruption = this.pickRepel();
        if (disruption) return { entry: repel, payload: disruption };
      }

      const pin = byId('pin');
      if (pin && canSpend && this.rng() < (this.difficulty === 'hard' ? 0.26 : 0.12)) {
        const target = this.pickPinTarget();
        if (target) return { entry: pin, payload: target };
      }

      const expand = byId('expand');
      if (expand && canSpend && this.state.size < 17 && this.rng() < 0.08) {
        return { entry: expand, payload: {} };
      }

      return null;
    }

    pickRuinCenter() {
      let best = null;
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (this.getStone(r, c) || this.engine.isSealed(r, c)) continue;
          let playerStones = 0;
          let aiStones = 0;
          let weighted = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const stone = this.inBounds(r + dr, c + dc) ? this.getStone(r + dr, c + dc) : null;
              if (!stone) continue;
              if (stone.owner === this.enemy) {
                playerStones++;
                if (stone.doubled) weighted += 2;
                weighted += 1;
              } else {
                aiStones++;
                if (stone.doubled) weighted -= 2;
                weighted -= 1;
              }
            }
          }
          if (playerStones < 3) continue;
          const score = playerStones * 100 + weighted * 22 - aiStones * 145;
          if (!best || score > best.score) best = { r, c, score, playerStones, aiStones };
        }
      }
      if (!best) return null;
      const threshold = this.difficulty === 'hard' ? 260 : 360;
      return best.score >= threshold ? { r: best.r, c: best.c } : null;
    }

    pickRepel() {
      const enemyMaxBefore = this.maxLineWeight(this.enemy);
      let best = null;
      for (const from of this.engine.getCardTargets(this.side, 'repel')) {
        const stone = this.getStone(from.r, from.c);
        if (!stone) continue;
        let local = 0;
        for (const [dr, dc] of DIRS) {
          let run = 1;
          for (const sign of [-1, 1]) {
            let nr = from.r + dr * sign;
            let nc = from.c + dc * sign;
            while (this.inBounds(nr, nc)) {
              const item = this.getStone(nr, nc);
              if (!item || item.owner !== this.enemy) break;
              run++;
              nr += dr * sign;
              nc += dc * sign;
            }
          }
          local = Math.max(local, run);
        }
        if (local < 4) continue;
        for (const to of this.engine.getMoveDestinations(from.r, from.c)) {
          // 试推：推子可能把敌方送成连珠（原来这里完全不检查）。
          this.engine.setStone(from.r, from.c, null);
          this.engine.setStone(to.r, to.c, stone);
          const enemyMaxAfter = this.maxLineWeight(this.enemy);
          const danger = this.getImmediateWins(this.enemy).length;
          const selfWin = this.getImmediateWins(this.side).length;
          this.engine.setStone(to.r, to.c, null);
          this.engine.setStone(from.r, from.c, stone);
          if (danger > 0 && selfWin === 0) continue;
          const gain = enemyMaxBefore - enemyMaxAfter;
          if (gain < 1) continue;
          const center = (this.state.size - 1) / 2;
          const score = gain * 220 + local * 46 - (Math.abs(to.r - center) + Math.abs(to.c - center)) * 2;
          if (!best || score > best.score) {
            best = { from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c }, score };
          }
        }
      }
      return best ? { from: best.from, to: best.to } : null;
    }

    pickPinTarget() {
      let best = null;
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (this.getStone(r, c) || this.engine.isSealed(r, c)) continue;
          const value = this.scoreCell(r, c, this.enemy).score || 0;
          const central = 12 - (Math.abs(r - (this.state.size - 1) / 2) + Math.abs(c - (this.state.size - 1) / 2));
          const score = central * 3 - value * 0.02 + this.rng() * 6;
          if (!best || score > best.score) best = { r, c, score };
        }
      }
      return best ? { r: best.r, c: best.c } : null;
    }

    bestEnemyCell() {
      const rank = this.rankPlacementsFor(this.enemy);
      return rank[0] || null;
    }

    rankPlacementsFor(side) {
      const list = [];
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (this.getStone(r, c) || this.engine.isSealed(r, c)) continue;
          if (this.state.forced && this.state.forced.target === side) continue;
          list.push({ r, c, ...this.scoreCell(r, c, side) });
        }
      }
      return list.sort((a, b) => b.score - a.score);
    }

    pickDelayed() {
      const entries = this.handEntries('delayed');
      if (!entries.length || this.rng() > this.config.delayed) return null;
      const byId = id => entries.find(entry => entry.id === id);

      const six = byId('sixfold');
      if (six && this.state.players[this.side].winTarget === 7) {
        const maxRun = this.maxLineWeight(this.side);
        if (maxRun >= 6 || (maxRun >= 5 && this.rng() < 0.7) || (maxRun >= 4 && this.rng() < 0.28)) {
          return { entry: six, payload: {} };
        }
      }

      const subvert = byId('subvert');
      if (subvert) {
        const best = this.bestEnemyCell();
        if (best && (best.score > 700 || this.rng() < 0.36)) {
          return { entry: subvert, payload: { r: best.r, c: best.c } };
        }
      }

      const silence = byId('silence');
      if (silence && this.state.players[this.enemy].hand.length >= 2 && this.rng() < 0.55) {
        return { entry: silence, payload: {} };
      }

      const aegis = byId('aegis');
      if (aegis) {
        const target = this.bestOwnStone();
        if (target && this.rng() < 0.45) return { entry: aegis, payload: target };
      }

      const mirror = byId('mirror');
      if (mirror && this.state.lastPlaced[this.side] && this.rng() < 0.34) {
        return { entry: mirror, payload: {} };
      }

      return null;
    }

    bestOwnStone() {
      let best = null;
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          const stone = this.getStone(r, c);
          if (!stone || stone.owner !== this.side || stone.shieldUntil > this.state.ply) continue;
          let adjacent = 0;
          for (const [dr, dc] of DIRS) {
            for (const sign of [-1, 1]) {
              const item = this.getStone(r + dr * sign, c + dc * sign);
              if (item && item.owner === this.side) adjacent += 1;
            }
          }
          const center = 8 - (Math.abs(r - (this.state.size - 1) / 2) + Math.abs(c - (this.state.size - 1) / 2));
          const score = adjacent * 12 + center;
          if (!best || score > best.score) best = { r, c, score };
        }
      }
      return best ? { r: best.r, c: best.c } : null;
    }

    pickSealForPlacement(rank) {
      // 保留接口：封印牌在形成双威胁时使用，具体逻辑在 pickInstant 内。
      return rank && rank.threats >= 2;
    }

    async takeTurn(options = {}) {
      const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
      const e = this.engine;
      if (e.state.status !== 'playing' || e.state.current !== this.side) return;
      this.planPlacement = null;
      await sleep(420);
      if (e.state.status !== 'playing' || e.state.current !== this.side) return;

      if (e.state.phase === 'main') {
        const choice = this.pickInstant();
        if (choice) {
          const result = e.playCard(this.side, choice.entry.uid, choice.payload);
          await sleep(500);
          if (e.state.status !== 'playing') return;
          if (!result.ok) this.planPlacement = null;
        }
      }

      if (e.state.phase === 'main') {
        let pos = this.planPlacement;
        if (pos && !e.canPlace(this.side, pos.r, pos.c)) pos = null;
        pos = pos || this.choosePlacement();
        if (pos) {
          e.place(this.side, pos.r, pos.c);
          await sleep(520);
          if (e.state.status !== 'playing') return;
        }
      }

      if (e.state.status === 'playing' && e.state.phase === 'post' && !e.state.cardPlayed) {
        const delayed = this.pickDelayed();
        if (delayed) {
          e.playCard(this.side, delayed.entry.uid, delayed.payload);
          await sleep(480);
          if (e.state.status !== 'playing') return;
        }
      }

      if (e.state.status === 'playing' && e.state.phase === 'post') {
        e.endTurn(this.side);
      }
    }
  }

  return { AI, DIFFICULTY };
});
