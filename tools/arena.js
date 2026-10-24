/* 七曜牌局 — 无界面 AI 对局场（Node）
 *
 * 用途：给「提升 AI 水平」这件事提供可重复的度量。它回答两个问题：
 *   1. 新版 AI 对旧版 AI 的胜率是多少（--a/--b）
 *   2. 输棋是怎么输的：漏挡单威胁 / 被双威胁打死 / 卡牌翻盘
 *
 * 用法：
 *   node tools/arena.js --a new:hard --b old:hard --games 20 --seed 1
 *   node tools/arena.js --self old:hard --games 20 --seed 1   # 种子对照
 *   node tools/arena.js --a new:hard --b old:hard --log       # 打印每局走法
 *
 * 规格字符串 <引擎>:<难度>
 *   引擎 = old  改动前的启发式（tools/legacy/ai_heuristic.js）
 *        | new  当前 js/ai.js
 */
'use strict';

const { Engine } = require('../js/engine.js');
const LEVEL_LIB = require('../js/levels.js');

// --level 把关卡权能带进引擎，用来做集成冒烟测试
function bossSkillsOf(levelId) {
  const level = LEVEL_LIB.BY_ID[levelId];
  if (!level) throw new Error('未知关卡: ' + levelId + '（可选 ' + Object.keys(LEVEL_LIB.BY_ID).join('/') + '）');
  return level.bossSkills;
}

const ENGINES = {
  old: './legacy/ai_heuristic.js',   // 改动前（只补了敌方/胜利条件两处，才能在双方正确工作）
  mid: './legacy/ai_bugfix.js',      // 修完 bug、还没有搜索
  new: '../js/ai.js'                 // 当前版本
};

function loadAI(engineName) {
  const file = ENGINES[engineName];
  if (!file) throw new Error('未知引擎: ' + engineName + '（可选 ' + Object.keys(ENGINES).join('/') + '）');
  return require(file).AI;
}

function parseSpec(text) {
  // <引擎>:<难度>[:<搜索层数>]  给了层数就用固定层数（关掉时间上限，便于复现）
  const [engineName, difficulty = 'hard', depth] = String(text).split(':');
  return { text, engineName, difficulty, depth: depth ? Number(depth) : 0 };
}

function makeAI(spec, engine, side, seed) {
  const opts = { difficulty: spec.difficulty, seed, side };
  if (spec.depth) opts.search = { depth: spec.depth, timeMs: 0 };
  return new (loadAI(spec.engineName))(engine, opts);
}

// 该方「下一手就赢」的所有落点（只看公开信息，和 AI 自己看到的一样）。
function winsFor(engine, side) {
  const out = [];
  const n = engine.state.size;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (engine.state.cells[r][c] || engine.isSealed(r, c)) continue;
      if (engine.wouldWinAt(r, c, side)) out.push({ r, c });
    }
  }
  return out;
}

const nextSide = side => (side === 'player' ? 'ai' : 'player');

async function playGame(seed, first, second, opts) {
  const engine = new Engine({ seed, bossSkills: opts.bossSkills || [] });
  if (opts.noCards) {
    // 关掉卡牌：只比落子，用来判断强弱到底来自棋形还是卡牌。
    for (const side of ['player', 'ai']) {
      const p = engine.state.players[side];
      p.hand = []; p.deck = []; p.discard = [];
    }
  }
  // first 执 player（先手），second 执 ai（后手）；先后手由调用方交替。
  const ais = {
    player: makeAI(first, engine, 'player', seed ^ 0x1234567),
    ai: makeAI(second, engine, 'ai', seed ^ 0x7654321)
  };
  // 关卡权能是否真的发动了（集成冒烟：光看胜负不够）
  const skills = { campSwap: 0, campSwapSuppressed: 0, doubleCardTurns: 0 };
  let cardsThisTurn = 0;
  engine.onEvent(ev => {
    if (ev.type === 'turnStart') {
      if (cardsThisTurn >= 2) skills.doubleCardTurns++;
      cardsThisTurn = 0;
    } else if (ev.type === 'cardPlayed' || ev.type === 'secretSet') cardsThisTurn++;
    else if (ev.type === 'campsSwapped') skills.campSwap++;
    else if (ev.type === 'campSwapSuppressed') skills.campSwapSuppressed++;
  });
  const perSide = { player: { ms: 0, turns: 0 }, ai: { ms: 0, turns: 0 } };
  const turns = [];
  const log = [];
  const noSleep = () => Promise.resolve();
  let abortReason = null;

  while (engine.state.status === 'playing' && engine.state.ply < opts.maxPly) {
    const side = engine.state.current;
    const myWins = winsFor(engine, side).length;
    const theirWins = winsFor(engine, nextSide(side)).length;
    const pinned = !!(engine.state.forced && engine.state.forced.target === side);
    turns.push({ side, myWins, theirWins, ply: engine.state.ply, pinned });
    if (opts.log) log.push(`  ${side.padEnd(6)} 手${String(engine.state.ply).padStart(3)}  我杀${myWins} 敌杀${theirWins}  ${JSON.stringify(engine.state.lastMove)}`);
    perSide[side].turns++;
    const t0 = Date.now();
    try {
      await ais[side].takeTurn({ sleep: noSleep });
    } catch (err) {
      abortReason = `${side} 异常: ${err && err.stack ? err.stack.split('\n')[0] : err}`;
      break;
    }
    perSide[side].ms += Date.now() - t0;
    if (engine.state.status !== 'playing') break;
    if (engine.state.current === side) { abortReason = `${side} 没有结束回合`; break; }
  }

  if (cardsThisTurn >= 2) skills.doubleCardTurns++;
  const st = engine.state;
  const winner = st.status === 'over' ? st.winner : (st.ply >= opts.maxPly ? 'draw' : null);
  // 输棋归因：看输方最后一手开始时，赢方已经有几个必胜点。
  let cause;
  if (winner === 'player' || winner === 'ai') {
    const loser = nextSide(winner);
    cause = 'unknown';
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].side !== loser) continue;
      const w = turns[i].theirWins;
      // 被定身时无法去挡必胜点，不算漏挡。
      cause = turns[i].pinned ? 'pinned' : w >= 2 ? 'double' : w === 1 ? 'single' : 'card';
      break;
    }
  } else {
    cause = 'unfinished';
  }
  if (abortReason) cause = 'abort';
  return {
    winner, cause, abortReason,
    plies: st.ply, rounds: st.round, reason: st.winReason,
    perSide, log, size: st.size,
    cards: st.stats.cardsPlayed, stones: st.stats.stonesPlaced, skills
  };
}

const CAUSE_LABEL = {
  double: '被双威胁打死（更早就该防）',
  single: '漏挡单威胁',
  card: '卡牌/自毁',
  pinned: '被定身钉住（无法去挡）',
  unfinished: '未分胜负',
  abort: '异常中止',
  unknown: '未归类'
};

async function run(opts) {
  // 配对设计：同一个 seed 打两盘，先后手互换。牌序相同，只换 AI 的执子方，
  // 这样抽牌运气在 a/b 之间相互抵消，方差小得多（同棋力自我对照应该接近 50%）。
  const pairs = [];
  for (let k = 0; k < opts.games / 2; k++) {
    pairs.push({ seed: (opts.seed + k * 7919) >>> 0, first: opts.a, second: opts.b, swap: false });
    pairs.push({ seed: (opts.seed + k * 7919) >>> 0, first: opts.b, second: opts.a, swap: true });
  }
  const stat = {
    a: { win: 0, loss: 0, draw: 0, ms: 0, turns: 0 },
    b: { win: 0, loss: 0, draw: 0, ms: 0, turns: 0 },
    cause: {}, reason: {}, lossCause: { a: {}, b: {} }, plies: [], cards: [], stones: [],
    skills: { campSwap: 0, campSwapSuppressed: 0, doubleCardTurns: 0 }
  };
  // 同一棋力自对局时 a/b 无法区分，改为按执子方统计，避免出现「100% 胜率」的假象。
  const mirror = opts.a.text === opts.b.text;
  const bucketOf = (p, side) => mirror
    ? (side === 'player' ? 'a' : 'b')
    : ((side === 'player' ? p.first : p.second).text === opts.a.text ? 'a' : 'b');

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const r = await playGame(p.seed, p.first, p.second, opts);
    stat.cause[r.cause] = (stat.cause[r.cause] || 0) + 1;
    if (r.winner === 'player' || r.winner === 'ai') {
      stat.reason[r.reason || '?'] = (stat.reason[r.reason || '?'] || 0) + 1;
    }
    const res = (r.winner === 'player' || r.winner === 'ai') ? bucketOf(p, r.winner) : 'draw';
    if (res !== 'draw') {
      stat[res].win++;
      stat[res === 'a' ? 'b' : 'a'].loss++;
      // 输的那一方是哪种死法
      const loserBucket = res === 'a' ? 'b' : 'a';
      stat.lossCause[loserBucket][r.cause] = (stat.lossCause[loserBucket][r.cause] || 0) + 1;
    } else {
      stat.a.draw++;
      stat.b.draw++;
    }
    for (const side of ['player', 'ai']) {
      const k = bucketOf(p, side);
      stat[k].ms += r.perSide[side].ms;
      stat[k].turns += r.perSide[side].turns;
    }
    stat.skills.campSwap += r.skills.campSwap;
    stat.skills.campSwapSuppressed += r.skills.campSwapSuppressed;
    stat.skills.doubleCardTurns += r.skills.doubleCardTurns;
    stat.plies.push(r.plies);
    stat.cards.push(r.cards);
    stat.stones.push(r.stones);

    const who = res === 'draw' ? '和棋' : `${res === 'a' ? opts.a.text : opts.b.text} 胜`;
    console.log(`#${String(i + 1).padStart(2)} s${String(p.seed).padStart(6)} ${who.padEnd(14)} ${String(r.rounds).padStart(3)} 回合 ${String(r.plies).padStart(3)} 手`
      + ` 盘${r.size} 牌${String(r.cards).padStart(3)} 子${String(r.stones).padStart(3)}`
      + ` ${(CAUSE_LABEL[r.cause] || r.cause).split('（')[0]}`);
    if (r.abortReason) console.log(`     ⚠ ${r.abortReason}`);
    if (opts.log) for (const l of r.log) console.log(l);
  }

  const avg = arr => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);
  const n = opts.games;
  const pct = v => `${((100 * v) / Math.max(1, n)).toFixed(0)}%`;
  console.log('');
  console.log(`【${opts.a.text}】 vs 【${opts.b.text}】 ${n} 局，先后手交替，seed=${opts.seed}`);
  console.log(`  ${opts.a.text}: ${stat.a.win} 胜 ${stat.a.loss} 负 ${stat.a.draw} 和  胜率 ${pct(stat.a.win)}`);
  console.log(`  ${opts.b.text}: ${stat.b.win} 胜 ${stat.b.loss} 负 ${stat.b.draw} 和  胜率 ${pct(stat.b.win)}`);
  if (opts.bossSkills.length) {
    console.log(`  关卡权能: ${opts.bossSkills.join(' + ')}  →  换营发动 ${stat.skills.campSwap} 次、`
      + `被占优压住 ${stat.skills.campSwapSuppressed} 次、双术回合 ${stat.skills.doubleCardTurns} 次`);
  }
  console.log(`  平均 ${avg(stat.plies).toFixed(1)} 手（${(avg(stat.plies) / 2).toFixed(1)} 回合）`
    + `、出牌 ${avg(stat.cards).toFixed(1)} 张、落子 ${avg(stat.stones).toFixed(1)} 枚`);
  console.log(`  每手耗时  a=${(stat.a.ms / Math.max(1, stat.a.turns)).toFixed(2)}ms  b=${(stat.b.ms / Math.max(1, stat.b.turns)).toFixed(2)}ms`);
  console.log('  制胜方式:', Object.entries(stat.reason).map(([k, v]) => `${k}=${v}`).join(' ') || '无');
  console.log('  终局归因（全部局）:');
  for (const [k, v] of Object.entries(stat.cause).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${(CAUSE_LABEL[k] || k).padEnd(22)} ${String(v).padStart(3)} 局`);
  }
  for (const k of ['a', 'b']) {
    const spec = k === 'a' ? opts.a : opts.b;
    const entries = Object.entries(stat.lossCause[k]).sort((x, y) => y[1] - x[1]);
    console.log(`  ${spec.text} 输棋方式: ${entries.map(([c, v]) => `${(CAUSE_LABEL[c] || c).split('（')[0]}×${v}`).join('、') || '无'}`);
  }
  return stat;
}

function parseArgs(argv) {
  const opts = { games: 10, seed: 1, maxPly: 400, log: false, noCards: false, bossSkills: [], a: null, b: null, self: null };
  // --games 会被取整成偶数（配对设计）。
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--games') opts.games = Number(argv[++i]);
    else if (arg === '--seed') opts.seed = Number(argv[++i]);
    else if (arg === '--max-ply') opts.maxPly = Number(argv[++i]);
    else if (arg === '--a') opts.a = parseSpec(argv[++i]);
    else if (arg === '--b') opts.b = parseSpec(argv[++i]);
    else if (arg === '--self') opts.self = parseSpec(argv[++i]);
    else if (arg === '--log') opts.log = true;
    else if (arg === '--no-cards') opts.noCards = true;
    else if (arg === '--level') opts.bossSkills = bossSkillsOf(argv[++i]);
    else if (arg === '--help' || arg === '-h') { console.log('见文件头注释'); process.exit(0); }
    else throw new Error('未知参数: ' + arg);
  }
  if (opts.self) { opts.a = opts.self; opts.b = opts.self; }
  if (!opts.a || !opts.b) throw new Error('需要 --a/--b 或 --self');
  opts.games = Math.max(2, Math.round(opts.games / 2) * 2);
  return opts;
}

if (require.main === module) {
  run(parseArgs(process.argv)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { playGame, run, parseArgs, winsFor };
