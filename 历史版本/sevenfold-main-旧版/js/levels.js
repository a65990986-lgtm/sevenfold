/* 七曜牌局 — 关卡设置
 *
 * 关卡 = 一组 BOSS 权能，和「棋力难度」正交：
 *   难度决定墨鸦算得多深，关卡决定墨鸦额外拥有哪些特权。
 *
 * 新增一关：往 LEVELS 里加一条，bossSkills 里填 BOSS_SKILLS 的 id 即可，
 * 引擎按 id 判断，不需要改 rules 引擎。
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.SEVENFOLD_LEVELS = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BOSS_SKILLS = {
    campSwap: {
      id: 'campSwap',
      name: '换营',
      tag: '夺子',
      desc: '你第 2、4、6… 次连成五子时，双方星子归属对调；若墨鸦本已占优，换营不发动。',
      hint: '连五子会喂给墨鸦。真要连，就连在墨鸦也压不住的地方。',
      detail: '只换棋盘上的星子：双生、金身跟着子走；手牌、暗牌、六合改命的胜利条件、封禁格与术式归属都不动。判定只在第 2、4、6… 次五连时进行一次，被「占优」压住的那一次就过去了，要等下一个偶数次。交换后如果墨鸦因此连成七子，当场判胜。'
    },
    doubleCard: {
      id: 'doubleCard',
      name: '双术',
      tag: '连牌',
      desc: '偶数回合（第 2、4、6… 回合）墨鸦可以发一张即时术式，落子后再布一张延时秘式。',
      hint: '偶数回合要防「即时 + 秘式」的组合，例如先封禁、再策反。',
      detail: '奇数回合仍是 1 张；玩家不受影响，永远只有 1 张。'
    }
  };

  const LEVELS = [
    {
      id: 'basic',
      name: '基础关',
      subtitle: '墨鸦执掌两项权能',
      bossSkills: ['campSwap', 'doubleCard']
    },
    {
      id: 'plain',
      name: '无技能关',
      subtitle: '按原始规则对局',
      bossSkills: []
    }
  ];

  const BY_ID = Object.fromEntries(LEVELS.map(level => [level.id, level]));
  const DEFAULT_LEVEL = 'basic';

  function skillsOf(levelId) {
    const level = BY_ID[levelId];
    if (!level || !level.bossSkills.length) return [];
    return level.bossSkills.map(id => BOSS_SKILLS[id]).filter(Boolean);
  }

  return { LEVELS, BY_ID, BOSS_SKILLS, DEFAULT_LEVEL, skillsOf };
});
