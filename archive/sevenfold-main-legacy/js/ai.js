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

  // search：{ depth: 最大层数(偶数), timeMs: 每手时间上限 }
  // 见习档不加搜索，保留原来的随手性，给新手留活路。
  const DIFFICULTY = {
    // 实测：多搜两层几乎没有额外收益（深度 2/4/6 对旧版胜率都是 52~56%），
    // 所以档位主要靠搜索开关和出牌纪律区分，时间上限只是兜底。
    easy: { noise: 0.38, top: 6, card: 0.3, delayed: 0.28, label: '见习', search: { depth: 0, timeMs: 0 } },
    normal: { noise: 0.08, top: 2, card: 0.62, delayed: 0.55, label: '棋师', search: { depth: 2, timeMs: 80 } },
    hard: { noise: 0.015, top: 1, card: 0.86, delayed: 0.78, label: '大棋士', search: { depth: 4, timeMs: 600 } }
  };

  const WIN_SCORE = 1e9;
  const ROOT_BRANCH = 16;   // 根节点最多考虑的落点数
  const NODE_BRANCH = 8;   // 内层节点最多考虑的落点数

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
      // 对局场用固定层数复现；正式对局用默认预算。
      this.searchOptions = { ...this.config.search, ...(options.search || {}) };
      this.gridSize = 0;
      this.nodes = 0;
      this.deadline = 0;
      this.aborted = false;
    }

    targetOfNum(num) { return this.state.players[num === 1 ? 'player' : 'ai'].winTarget; }

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

    // 双方「下一子」的即时术式都是明牌：界面会显示对方 pending 的术式，
    // 所以双生星（下一子计 2 枚）必须算进威胁判断，原来完全没算。
    auraWeight(side) {
      const aura = this.state.players[side].nextAura;
      return aura && aura.type === 'twin' ? 2 : 1;
    }

    get myWeight() { return this.auraWeight(this.side); }
    get enemyWeight() { return this.auraWeight(this.enemy); }
    getImmediateWins(side, target, weight) {
      const t = target ?? this.state.players[side].winTarget;
      const w = weight ?? this.auraWeight(side);
      const wins = [];
      for (let r = 0; r < this.state.size; r++) {
        for (let c = 0; c < this.state.size; c++) {
          if (this.getStone(r, c)) continue;
          if (this.engine.isSealed(r, c)) continue;
          if (this.wouldWinFor(side, r, c, w, t)) wins.push({ r, c });
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

        const def = this.lineWindows(r, c, opp, dr, dc, this.enemyWeight, oppTarget);
        defense += def.score;
        if (def.bestOwn >= oppTarget - 1) defense += 260000;
      }

      if (this.wouldWinFor(opp, r, c, this.enemyWeight, oppTarget)) {
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

    rankPlacements(weight = 1) {
      return this.candidateCells().map(cell => ({
        ...cell,
        ...this.scoreCell(cell.r, cell.c, this.side, weight)
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
      // 浅层搜索：在候选点里做 αβ 搜到 2~6 层，看穿「我造双杀」「对方双杀」。
      const plan = this.searchOptions;
      if (plan && plan.depth > 0) {
        const found = this.searchPlacement({ weight: this.myWeight, depth: plan.depth, timeMs: plan.timeMs });
        if (found) return { r: found.r, c: found.c };
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

    /* ---------------- 浅层搜索 ----------------
     * 只搜「落子」这一步棋，不搜卡牌（卡牌仍由上面的启发式决定）。
     * 棋盘用一维 Int8Array 复制一份，落子/撤子都在这份拷贝上做，不动引擎状态。
     */

    rebuildGrid() {
      const n = this.state.size;
      if (this.gridSize !== n) {
        this.grid = new Int8Array(n * n);
        this.dbl = new Uint8Array(n * n);
        this.near = new Int16Array(n * n);
        this.blocked = new Uint8Array(n * n);
        this.gridSize = n;
      } else {
        this.grid.fill(0);
        this.dbl.fill(0);
        this.near.fill(0);
        this.blocked.fill(0);
      }
      const g = this.grid;
      const stones = [];
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const i = r * n + c;
          const stone = this.state.cells[r][c];
          if (stone && stone.owner) {
            g[i] = stone.owner === 'player' ? 1 : 2;
            this.dbl[i] = stone.doubled ? 1 : 0;
            stones.push(i);
          }
          if (this.engine.isSealed(r, c)) this.blocked[i] = 1;
        }
      }
      for (const i of stones) {
        const r = (i / n) | 0;
        const c = i % n;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && cc >= 0 && rr < n && cc < n) this.near[rr * n + cc]++;
          }
        }
      }
    }

    simPlace(r, c, num, doubled = false) {
      const n = this.gridSize;
      const i = r * n + c;
      this.grid[i] = num;
      this.dbl[i] = doubled ? 1 : 0;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < n && cc < n) this.near[rr * n + cc]++;
        }
      }
    }

    simUndo(r, c) {
      const n = this.gridSize;
      const i = r * n + c;
      this.grid[i] = 0;
      this.dbl[i] = 0;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < n && cc < n) this.near[rr * n + cc]--;
        }
      }
    }

    // 在 (r,c) 落一子后是否连成 num 的胜利线
    winAtNum(num, r, c, weight = 1) {
      const n = this.gridSize;
      const target = this.targetOfNum(num);
      const g = this.grid;
      for (const [dr, dc] of DIRS) {
        let total = weight;
        for (const sign of [-1, 1]) {
          let rr = r + dr * sign;
          let cc = c + dc * sign;
          while (rr >= 0 && cc >= 0 && rr < n && cc < n) {
            const i = rr * n + cc;
            if (g[i] !== num) break;
            total += this.dbl[i] ? 2 : 1;
            rr += dr * sign;
            cc += dc * sign;
          }
        }
        if (total >= target) return true;
      }
      return false;
    }

    immediateWinsNum(num, weight = 1) {
      const n = this.gridSize;
      const out = [];
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i] || this.blocked[i] || !this.near[i]) continue;
        const r = (i / n) | 0;
        const c = i % n;
        if (this.winAtNum(num, r, c, weight)) out.push({ r, c });
      }
      return out;
    }

    // 连段价值：k 枚（双生按 2 算）、open 个开放端
    runValue(k, open, target) {
      if (k >= target) return WIN_SCORE;
      const gap = target - k;
      const table = [0, 4.0e6, 8.0e5, 5.0e4, 1.5e3, 90, 8];
      const base = table[Math.min(gap, 6)];
      const mult = open >= 2 ? 1 : open === 1 ? 0.16 : 0.03;
      return base * mult * (1 + 0.06 * k);
    }

    // 叶子评价：按「连段 + 开放端」算，散子不再和连子同分
    boardEvalNum(num) {
      const n = this.gridSize;
      const g = this.grid;
      const opp = 3 - num;
      const myTarget = this.targetOfNum(num);
      const oppTarget = this.targetOfNum(opp);
      let mine = 0;
      let theirs = 0;
      for (const [dr, dc] of DIRS) {
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const owner = g[r * n + c];
            if (!owner) continue;
            const pr = r - dr;
            const pc = c - dc;
            if (pr >= 0 && pc >= 0 && pr < n && pc < n && g[pr * n + pc] === owner) continue;
            let k = 0;
            let rr = r;
            let cc = c;
            while (rr >= 0 && cc >= 0 && rr < n && cc < n && g[rr * n + cc] === owner) {
              k += this.dbl[rr * n + cc] ? 2 : 1;
              rr += dr;
              cc += dc;
            }
            let open = 0;
            if (rr >= 0 && cc >= 0 && rr < n && cc < n && !g[rr * n + cc]) open++;
            if (pr >= 0 && pc >= 0 && pr < n && pc < n && !g[pr * n + pc]) open++;
            const v = this.runValue(k, open, owner === num ? myTarget : oppTarget);
            if (owner === num) mine += v;
            else theirs += v;
          }
        }
      }
      return mine - theirs * 1.12;   // 略微偏防守
    }

    // 内层节点的排序分（要快，不能用 scoreCell）
    quickScore(num, r, c) {
      const n = this.gridSize;
      const g = this.grid;
      const opp = 3 - num;
      let s = 0;
      for (const [dr, dc] of DIRS) {
        let own = 0;
        let foe = 0;
        for (let step = 1; step <= 4; step++) {
          const gain = step === 1 ? 3 : 1;
          for (const sign of [-1, 1]) {
            const rr = r + dr * step * sign;
            const cc = c + dc * step * sign;
            if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
            const v = g[rr * n + cc];
            if (v === num) own += gain;
            else if (v === opp) foe += gain;
          }
        }
        s += own * own * 6 + foe * foe * 5;
      }
      return s;
    }

    orderedMovesNum(num, limit) {
      const n = this.gridSize;
      const cand = [];
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i] || this.blocked[i] || !this.near[i]) continue;
        const r = (i / n) | 0;
        const c = i % n;
        cand.push({ r, c, s: this.quickScore(num, r, c) });
      }
      cand.sort((a, b) => b.s - a.s);
      return cand.length > limit ? cand.slice(0, limit) : cand;
    }

    // moveWeight：本层落子权重（该方 pending 的双生星）；nextWeight：对方下一层权重
    // ext：地平线处为处理必挡而额外延长的层数（最多 4 层，避免死循环）
    negamax(num, depth, alpha, beta, moveWeight = 1, nextWeight = 1, ext = 0) {
      this.nodes++;
      if ((this.nodes & 127) === 0 && this.deadline && Date.now() > this.deadline) {
        this.aborted = true;
        return 0;
      }
      if (this.aborted) return 0;
      const opp = 3 - num;
      // 轮到谁，谁能一着制胜
      if (this.immediateWinsNum(num, moveWeight).length) return WIN_SCORE + depth * 10;
      if (depth <= 0) {
        // 地平线静止搜索：对方已经有两个杀点就是必败；有一个则延一层把这一挡算完。
        const horizonFoes = this.immediateWinsNum(opp, nextWeight);
        if (horizonFoes.length >= 2) return -WIN_SCORE - 10;
        if (horizonFoes.length === 1 && ext < 4) {
          depth = 1;
          ext += 1;
        } else {
          return this.boardEvalNum(num);
        }
      }
      const foeWins = this.immediateWinsNum(opp, nextWeight);
      if (foeWins.length >= 2) return -WIN_SCORE - depth * 10;   // 两个杀点，挡不全
      let moves;
      if (foeWins.length === 1) {
        moves = [foeWins[0]];                                     // 只能去挡
      } else {
        moves = this.orderedMovesNum(num, NODE_BRANCH);
      }
      if (!moves.length) return this.boardEvalNum(num);
      let best = -Infinity;
      for (const m of moves) {
        this.simPlace(m.r, m.c, num, moveWeight > 1);
        const v = -this.negamax(opp, depth - 1, -beta, -alpha, nextWeight, 1, ext);
        this.simUndo(m.r, m.c);
        if (this.aborted) return best === -Infinity ? 0 : best;
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }

    // 返回 { r, c, score }，score 是从我方视角的搜索值
    searchPlacement({ weight = 1, depth = 4, timeMs = 0 } = {}) {
      if (!this.state.cells || this.state.status !== 'playing') return null;
      this.rebuildGrid();
      const num = this.side === 'player' ? 1 : 2;
      const opp = 3 - num;
      const root = this.rankPlacements(weight).slice(0, ROOT_BRANCH);
      if (!root.length) return null;
      if (root.length === 1) return { r: root[0].r, c: root[0].c, score: 0 };

      this.deadline = timeMs > 0 ? Date.now() + timeMs : 0;
      this.aborted = false;
      this.nodes = 0;
      const enemyW = this.enemyWeight;
      let best = { r: root[0].r, c: root[0].c, score: 0 };
      for (let d = 2; d <= depth; d += 2) {
        let localBest = null;
        let alpha = -Infinity;
        for (const m of root) {
          this.simPlace(m.r, m.c, num, weight > 1);
          const v = -this.negamax(opp, d - 1, -Infinity, -alpha, enemyW, 1);
          this.simUndo(m.r, m.c);
          if (this.aborted) break;
          if (!localBest || v > localBest.score) {
            localBest = { r: m.r, c: m.c, score: v };
          }
          if (v > alpha) alpha = v;
        }
        if (this.aborted) break;
        if (localBest) best = localBest;
        if (best.score >= WIN_SCORE) break;   // 已经算到必胜
      }
      this.deadline = 0;
      return best;
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

    // 「双术」多出来的那个牌位（普通回合恒为 false，不能影响无技能关）
    spareCardSlot() {
      const slots = this.engine.cardSlots(this.side);
      if (slots.total <= 1) return false;
      return (slots.total - (this.state.cardsPlayedThisTurn || 0)) > 0;
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

    // 双生星：找一枚「计 2 枚」的落点，落下后我方出现两个以上必胜点
    findTwinFork() {
      const rank = this.rankPlacements(2).slice(0, 14);
      for (const cell of rank) {
        const probe = {
          uid: 'probe-' + cell.r + '-' + cell.c,
          owner: this.side,
          doubled: true,
          shieldUntil: 0,
          placedPly: this.state.ply
        };
        this.engine.setStone(cell.r, cell.c, probe);
        // 双击星已经落定，之后的新子按 1 枚算
        const wins = this.getImmediateWins(this.side, undefined, 1);
        this.engine.setStone(cell.r, cell.c, null);
        if (wins.length >= 2) return cell;
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
        // 双生星真正的用法：把一枚 2 权重的子落成「双杀」，逼对方下一手顾不过来。
        if (!enemyWins.length) {
          const fork = this.findTwinFork();
          if (fork) {
            this.planPlacement = { r: fork.r, c: fork.c };
            return { entry: twin, payload: {} };
          }
          // 有「双术」多出来的牌位时，双生星是纯赚：下一子直接计 2 枚，不必留手。
          if (this.spareCardSlot()) {
            this.planPlacement = null;
            return { entry: twin, payload: {} };
          }
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
          if ((pressured && this.rng() < 0.58) || this.spareCardSlot()) {
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
      if (pin && canSpend && (this.rng() < (this.difficulty === 'hard' ? 0.26 : 0.12) || this.spareCardSlot())) {
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
      if (!entries.length) return null;
      // 有「双术」多出来的一张配额时不要掷骰子：这张牌不打白不打（手牌满了也会被弃掉）。
      const slots = this.engine.cardSlots(this.side);
      const spareSlot = slots.total > 1
        && (slots.delayed - (this.state.delayedPlayed || 0)) > 0
        && (slots.total - (this.state.cardsPlayedThisTurn || 0)) > 0;
      if (!spareSlot && this.rng() > this.config.delayed) return null;
      const byId = id => entries.find(entry => entry.id === id);

      const six = byId('sixfold');
      if (six && this.state.players[this.side].winTarget === 7) {
        const maxRun = this.maxLineWeight(this.side);
        // 已经有六连：改命当回合直接判胜。
        if (maxRun >= 6) return { entry: six, payload: {} };
        // 按 6 子算已经有两个必胜点 → 改命等于白捡一个双杀，别再掷骰子。
        const winsAt6 = [];
        for (const cell of this.candidateCells()) {
          if (this.wouldWinFor(this.side, cell.r, cell.c, 1, 6)) winsAt6.push(cell);
        }
        if (winsAt6.length >= 2) return { entry: six, payload: {} };
        if ((maxRun >= 5 && this.rng() < 0.7) || (maxRun >= 4 && this.rng() < 0.28)) {
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

      // 即时术式：按本回合配额打（BOSS 的「双术」在偶数回合有一即时 + 一延时两个位子）
      for (let played = 0; played < 2; played++) {
        if (e.state.status !== 'playing' || e.state.phase !== 'main') break;
        const slots = e.cardSlots(this.side);
        if ((e.state.instantPlayed || 0) >= slots.instant) break;
        if ((e.state.cardsPlayedThisTurn || 0) >= slots.total) break;
        const choice = this.pickInstant();
        if (!choice) break;
        const result = e.playCard(this.side, choice.entry.uid, choice.payload);
        await sleep(500);
        if (e.state.status !== 'playing') return;
        if (!result.ok) { this.planPlacement = null; break; }
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

      for (let played = 0; played < 2; played++) {
        if (e.state.status !== 'playing' || e.state.phase !== 'post') break;
        const slots = e.cardSlots(this.side);
        if ((e.state.delayedPlayed || 0) >= slots.delayed) break;
        if ((e.state.cardsPlayedThisTurn || 0) >= slots.total) break;
        const delayed = this.pickDelayed();
        if (!delayed) break;
        const result = e.playCard(this.side, delayed.entry.uid, delayed.payload);
        await sleep(480);
        if (e.state.status !== 'playing') return;
        if (!result.ok) break;
      }

      if (e.state.status === 'playing' && e.state.phase === 'post') {
        e.endTurn(this.side);
      }
    }
  }

  return { AI, DIFFICULTY };
});
