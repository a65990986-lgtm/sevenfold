/* 七曜牌局 — 卡牌定义
 * 纯数据模块：浏览器挂载到 window.SEVENFOLD_CARDS，Node 通过 module.exports 引入。
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.SEVENFOLD_CARDS = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 10x10 像素图标。0 透明，1 描边，2 暗部，3 中间色，4 主色，5 高光。
  const ICONS = {
    sealOrtho: [
      '0000000000',
      '0000440000',
      '0000440000',
      '1111441111',
      '1444444441',
      '1444444441',
      '1111551111',
      '0000440000',
      '0000440000',
      '0000000000'
    ],
    sealDiag: [
      '1100000011',
      '1410000141',
      '0141001410',
      '0014114100',
      '0001444100',
      '0001444100',
      '0014114100',
      '0141001410',
      '1410000141',
      '1100000011'
    ],
    expand: [
      '5500000055',
      '5500000055',
      '0011111100',
      '0010000100',
      '0010000100',
      '0010000100',
      '0010000100',
      '0011111100',
      '5500000055',
      '5500000055'
    ],
    twin: [
      '0000000000',
      '0001100000',
      '0014410000',
      '0145541000',
      '0014410000',
      '0001100000',
      '0000000000',
      '0001100000',
      '0014410000',
      '0001100000'
    ],
    ruin: [
      '0000100000',
      '0000100000',
      '0011111100',
      '0001441000',
      '0114554110',
      '0114554110',
      '0001441000',
      '0011111100',
      '0000100000',
      '0000100000'
    ],
    repel: [
      '0000000000',
      '0000011000',
      '0110014100',
      '0141114410',
      '0144444441',
      '0144444441',
      '0141114410',
      '0110014100',
      '0000011000',
      '0000000000'
    ],
    shift: [
      '0000000000',
      '0011000000',
      '0144100000',
      '0011011100',
      '0000144100',
      '0000014410',
      '0000001110',
      '0000000000',
      '0011001100',
      '0000000000'
    ],
    pin: [
      '0000100000',
      '0000100000',
      '0011111100',
      '0014444100',
      '1114544111',
      '0014444100',
      '0011111100',
      '0000100000',
      '0000100000',
      '0000000000'
    ],
    aegis: [
      '0011111100',
      '0122222210',
      '0124444210',
      '0124554210',
      '0124444210',
      '0012444210',
      '0001244100',
      '0000121000',
      '0000010000',
      '0000000000'
    ],
    mirror: [
      '0000000000',
      '0011001100',
      '0141014410',
      '0144144410',
      '0014441100',
      '0001441000',
      '0000110000',
      '0000000000',
      '0011001100',
      '0000000000'
    ],
    sixfold: [
      '0001100000',
      '0014100000',
      '0141000000',
      '0141111100',
      '0141444410',
      '0141444410',
      '0141444410',
      '0014444100',
      '0001111000',
      '0000000000'
    ],
    silence: [
      '0000000000',
      '0011000000',
      '0114100000',
      '1114110110',
      '1114111010',
      '1114110110',
      '0114100000',
      '0011000000',
      '0000000000',
      '0000000000'
    ],
    subvert: [
      '0011111100',
      '0144444410',
      '1441111441',
      '1414444141',
      '1414554141',
      '1414444141',
      '1441111441',
      '0144444410',
      '0011111100',
      '0000000000'
    ]
  };

  const CARDS = [
    {
      id: 'sealOrtho',
      name: '四方封',
      epithet: '铁壁',
      type: 'instant',
      accent: '#5eead4',
      icon: ICONS.sealOrtho,
      target: 'none',
      tag: '封锁',
      desc: '己方下一枚星子落定后，封禁其上下左右四格 1 回合。封禁格双方均不可落子。',
      short: '落子后封锁四邻'
    },
    {
      id: 'sealDiag',
      name: '斜四封',
      epithet: '断翼',
      type: 'instant',
      accent: '#7dd3fc',
      icon: ICONS.sealDiag,
      target: 'none',
      tag: '封锁',
      desc: '己方下一枚星子落定后，封禁其四个斜向格 1 回合。封禁格双方均不可落子。',
      short: '落子后封锁斜角'
    },
    {
      id: 'expand',
      name: '拓界',
      epithet: '星图外环',
      type: 'instant',
      accent: '#fbbf24',
      icon: ICONS.expand,
      target: 'none',
      tag: '星盘',
      desc: '星盘向四周各扩展一圈，所有棋子随星盘移动。上限 19×19。',
      short: '星盘扩展一圈'
    },
    {
      id: 'twin',
      name: '双生星',
      epithet: '重影',
      type: 'instant',
      accent: '#c084fc',
      icon: ICONS.twin,
      target: 'none',
      tag: '强化',
      desc: '己方下一枚星子计为 2 枚，同时参与横、竖、斜所有连线。',
      short: '下一子计为两子'
    },
    {
      id: 'ruin',
      name: '崩星',
      epithet: '寂灭',
      type: 'instant',
      accent: '#fb7185',
      icon: ICONS.ruin,
      target: 'none',
      tag: '破坏',
      desc: '己方下一枚星子落下后爆裂，摧毁自身与周围八格内的全部星子。',
      short: '下一子落点爆裂'
    },
    {
      id: 'repel',
      name: '逐客令',
      epithet: '斥候',
      type: 'instant',
      accent: '#60a5fa',
      icon: ICONS.repel,
      target: 'moveEnemy',
      tag: '位移',
      desc: '指定一枚敌方星子，向相邻空格移动一格。使用后本回合不能落子。金身可免疫。',
      short: '推动敌子，放弃落子'
    },
    {
      id: 'shift',
      name: '挪星步',
      epithet: '换位',
      type: 'instant',
      accent: '#86efac',
      icon: ICONS.shift,
      target: 'moveOwn',
      tag: '位移',
      desc: '指定一枚己方星子，向相邻空格移动一格。使用后本回合不能落子。',
      short: '移动己子，放弃落子'
    },
    {
      id: 'pin',
      name: '定身咒',
      epithet: '钉星',
      type: 'instant',
      accent: '#facc15',
      icon: ICONS.pin,
      target: 'cellEmpty',
      tag: '控制',
      desc: '指定一个空格。对方下回合必须将星子落在该格；若该格失效则咒术解除。',
      short: '强制对方落点'
    },
    {
      id: 'aegis',
      name: '金身',
      epithet: '不灭',
      type: 'delayed',
      accent: '#fde68a',
      icon: ICONS.aegis,
      target: 'stoneOwn',
      tag: '守护',
      desc: '指定一枚己方星子，3 轮内免疫敌方术式：不可被推动、交换或炸毁。',
      short: '己子免疫敌术 3 轮'
    },
    {
      id: 'mirror',
      name: '换影',
      epithet: '镜界',
      type: 'delayed',
      accent: '#d8b4fe',
      icon: ICONS.mirror,
      target: 'none',
      tag: '诡计',
      desc: '以本回合刚落下的己方星子为锚。对方下回合落子后，两枚星子交换位置。',
      short: '与对方新子换位'
    },
    {
      id: 'sixfold',
      name: '六合改命',
      epithet: '短歌',
      type: 'delayed',
      accent: '#f0abfc',
      icon: ICONS.sixfold,
      target: 'none',
      tag: '改命',
      desc: '己方胜利条件改为 6 子连珠，持续到对局结束。双生星仍按 2 枚计算。',
      short: '己方改为六子连珠'
    },
    {
      id: 'silence',
      name: '噤声',
      epithet: '封喉',
      type: 'delayed',
      accent: '#94a3b8',
      icon: ICONS.silence,
      target: 'none',
      tag: '封印',
      desc: '对方下回合使用的第一张卡牌失效，但仍会消耗该牌。',
      short: '封印对方下一张牌'
    },
    {
      id: 'subvert',
      name: '策反',
      epithet: '星蚀',
      type: 'delayed',
      accent: '#a3e635',
      icon: ICONS.subvert,
      target: 'cellAny',
      tag: '策反',
      desc: '指定一格，其周围 3×3 成为策反区。对方下回合落入区内的星子转为你方。',
      short: '3×3 策反区'
    }
  ];

  const BY_ID = Object.fromEntries(CARDS.map(card => [card.id, card]));

  return {
    CARDS,
    BY_ID,
    ICONS,
    TYPE_LABEL: { instant: '即时术式', delayed: '延时秘式' },
    TARGET_LABEL: {
      none: '无需目标',
      cellEmpty: '选择一个空格',
      cellAny: '选择中心格',
      moveEnemy: '选择敌方星子',
      moveOwn: '选择己方星子',
      stoneOwn: '选择己方星子'
    }
  };
});
