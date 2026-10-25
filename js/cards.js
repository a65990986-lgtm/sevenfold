/* 七曜牌局 · 简化版 — 卡牌定义
 *
 * 规则来源：《棋类+卡牌游戏开发 (2)》
 * 13 张卡，体力费用 0–3，全部为即时术式。
 * 牌面图片沿用上上个版本的 10×10 像素图标语言。
 * 纯数据模块：浏览器挂载到 window.SEVENFOLD_CARDS，Node 通过 module.exports 引入。
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.SEVENFOLD_CARDS = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 10×10 像素图：0 透明，1 描边，2 暗部，3 中间色，4 主色，5 高光。
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
    ],
    silence: [
      '0001111000',
      '0010000100',
      '0010000100',
      '1111111111',
      '1444444441',
      '1445555441',
      '1445555441',
      '1444444441',
      '1111111111',
      '0000000000'
    ],
    sixwin: [
      '0000000000',
      '0011111100',
      '0144444410',
      '0141000000',
      '0141000000',
      '0141111100',
      '0141444410',
      '0141444410',
      '0141111100',
      '0011111100'
    ],
    draw: [
      '0000000000',
      '0111111000',
      '0144441000',
      '0145541000',
      '0144441000',
      '0111111000',
      '0000000000',
      '0011111100',
      '0014444100',
      '0011111100'
    ],
    bolt: [
      '0000010000',
      '0000110000',
      '0001110000',
      '0011111100',
      '0111110000',
      '0000110000',
      '0001100000',
      '0011000000',
      '0110000000',
      '0000000000'
    ],
    battery: [
      '0011111100',
      '0144444410',
      '0145555410',
      '0145555410',
      '0145555410',
      '0144444410',
      '0011111100',
      '0000110000',
      '0001111000',
      '0000110000'
    ],
    feather: [
      '0000100000',
      '0001110000',
      '0011111000',
      '0111111100',
      '0001110000',
      '0001110000',
      '0011111100',
      '0014444100',
      '0014444100',
      '0011111100'
    ]
  };

  const CARDS = [
    {
      id: 'sealOrtho',
      name: '四方封',
      glyph: '封',
      icon: ICONS.sealOrtho,
      cost: 1,
      target: 'cell',
      tag: '棋盘控制',
      short: '封锁目标上下左右四格 1 回合',
      desc: '指定一格，使其上下左右四格在 1 回合内不可落子。目标格本身不受影响。',
      accent: '#b45cff'
    },
    {
      id: 'sealAll',
      name: '八方封',
      glyph: '八',
      icon: ICONS.sealDiag,
      cost: 2,
      target: 'cell',
      tag: '棋盘控制',
      short: '封锁目标周围八格 1 回合',
      desc: '指定一格，使其周围八格在 1 回合内不可落子。目标格本身不受影响。',
      accent: '#8b5cf6'
    },
    {
      id: 'twin',
      name: '双生星',
      glyph: '双',
      icon: ICONS.twin,
      cost: 2,
      target: 'stoneOwn',
      tag: '棋子操作',
      short: '指定己方星子，永久计为 2 枚',
      desc: '指定一枚己方星子，使其在连线中永久计为 2 枚。',
      accent: '#f472ff'
    },
    {
      id: 'shift',
      name: '挪星步',
      glyph: '移',
      icon: ICONS.shift,
      cost: 1,
      target: 'moveOwn',
      tag: '棋子操作',
      short: '把一枚己方星子移动到相邻八格',
      desc: '指定一枚己方星子，再选择周围八格中的空格移动。',
      accent: '#5ce1ff'
    },
    {
      id: 'ruin',
      name: '崩星',
      glyph: '爆',
      icon: ICONS.ruin,
      cost: 3,
      target: 'cell',
      tag: '棋子操作',
      short: '清除目标及周围八格的所有棋子',
      desc: '指定一格，清除目标格及其周围八格内的所有棋子。',
      accent: '#ff5c8a'
    },
    {
      id: 'swap',
      name: '换影',
      glyph: '影',
      icon: ICONS.mirror,
      cost: 3,
      target: 'swap',
      tag: '棋子操作',
      short: '交换棋盘上任意两枚棋子的位置',
      desc: '依次选择两枚棋子，交换它们的位置。双方棋子都可以选择。',
      accent: '#c084fc'
    },
    {
      id: 'subvert',
      name: '策反',
      glyph: '策',
      icon: ICONS.subvert,
      cost: 2,
      target: 'cell',
      tag: '棋子操作',
      short: '目标及上下左右四格的棋子转为你方',
      desc: '指定一格，使其目标格及上下左右四格内的棋子转为你方。',
      accent: '#ff9de2'
    },
    {
      id: 'silence',
      name: '封锁',
      glyph: '锁',
      icon: ICONS.silence,
      cost: 1,
      target: 'none',
      tag: '特殊',
      short: '对手下回合首张牌无效',
      desc: '对手下一回合打出的第一张牌失效，但仍消耗体力。',
      accent: '#7c5cff'
    },
    {
      id: 'sixwin',
      name: '六子改胜',
      glyph: '六',
      icon: ICONS.sixwin,
      cost: 3,
      target: 'none',
      tag: '特殊',
      short: '胜利条件改为六子，使用后移出牌库',
      desc: '使用后，己方胜利条件由 7 子永久变为 6 子连珠；此牌随后移出双方牌库/弃牌堆，本局不再抽出。',
      accent: '#ff6bd6'
    },
    {
      id: 'extra',
      name: '额外抽牌',
      glyph: '抽',
      icon: ICONS.draw,
      cost: 2,
      target: 'none',
      tag: '特殊',
      short: '下回合额外获得 2 张手牌',
      desc: '下回合开始时，在正常 4 选 2 之外额外获得 2 张手牌。',
      accent: '#5cd6ff'
    },
    {
      id: 'charge',
      name: '蓄力',
      glyph: '力',
      icon: ICONS.bolt,
      cost: 0,
      target: 'none',
      tag: '体力',
      short: '本回合获得 1 点体力',
      desc: '立即获得 1 点体力；体力最多显示到 5。',
      accent: '#a78bfa'
    },
    {
      id: 'store',
      name: '储能',
      glyph: '储',
      icon: ICONS.battery,
      cost: 0,
      target: 'none',
      tag: '体力',
      short: '下回合额外获得 1 点体力',
      desc: '下回合开始时额外获得 1 点体力。',
      accent: '#818cf8'
    },
    {
      id: 'discount',
      name: '省力',
      glyph: '省',
      icon: ICONS.feather,
      cost: 1,
      target: 'handCard',
      tag: '体力',
      short: '指定一张手牌，其消耗变为 0',
      desc: '指定另一张手牌，使其体力消耗永久降为 0，直到被打出。',
      accent: '#c4b5fd'
    }
  ];

  const BY_ID = Object.fromEntries(CARDS.map(card => [card.id, card]));
  const BASIC_CARDS = CARDS.slice();

  return {
    CARDS,
    BASIC_CARDS,
    FINAL_CARDS: [],
    BY_ID,
    ICONS,
    TYPE_LABEL: { instant: '术式', delayed: '术式', final: '最终' },
    TARGET_LABEL: {
      cell: '选择棋盘格',
      stoneOwn: '选择己方星子',
      moveOwn: '选择己方星子',
      swap: '选择两枚棋子',
      handCard: '选择一张手牌',
      none: '无需目标'
    }
  };
});
