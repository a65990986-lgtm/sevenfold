/* 七曜牌局 · 简化版 — 界面与对局控制 */
(function () {
  'use strict';

  const CARD_LIB = window.SEVENFOLD_CARDS;
  const BY_ID = CARD_LIB.BY_ID;
  const Engine = window.SevenfoldEngine;
  const AI = window.SevenfoldAI;
  const SoundManager = window.SevenfoldSound && window.SevenfoldSound.SoundManager;

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const MODE_LABEL = { easy: '基础', normal: '进阶', hard: '困难', boss: 'Boss', tutorial: '教程', llm: '挑战 LLM', llmpk: 'LLM 对战' };
  // 每个模式里两个座位分别由谁操作：human / ai（本地） / llm（云端）
  const MODE_SEATS = {
    easy: { player: 'human', ai: 'ai' },
    normal: { player: 'human', ai: 'ai' },
    hard: { player: 'human', ai: 'ai' },
    boss: { player: 'human', ai: 'ai' },
    tutorial: { player: 'human', ai: 'ai' },
    llm: { player: 'human', ai: 'llm' },
    llmpk: { player: 'llm', ai: 'llm' }
  };
  const LLM_STORE = 'sevenfold.llm';
  // 难度 → 立绘（第 4/5/6 张图分别是 基础/困难/进阶，Boss 用自己的）
  const MODE_ART = {
    easy: 'easy', normal: 'middle', hard: 'hard', boss: 'boss',
    llm: 'hard', llmpk: 'hard', tutorial: 'middle'
  };

  const TUTORIAL_INTRO = [
    {
      title: '界面 1 / 5 · 获胜目标',
      text: '默认七子连珠获胜；“六子改胜”可把目标改为六子。双倍、封锁、移动、转化都能改写棋局，先看清获胜条件再行动。',
      selector: '#playerGoal'
    },
    {
      title: '界面 2 / 5 · 体力',
      text: '蓝条是你的体力。打牌会消耗体力；回合结束时多余的体力不会留到下一回合，但体力在每回合开始时都会自动补满。',
      selector: '#staminaHud'
    },
    {
      title: '界面 3 / 5 · 棋盘',
      text: '20×20 七子棋。选择一个空格子落子，横、竖、斜连成七子获胜；双击手牌即可发动卡牌。',
      selector: '.board-frame'
    },
    {
      title: '界面 4 / 5 · 手牌',
      text: '左侧是手牌：牌面、费用、类型和说明都在这里。两列排布，牌多时在区域内上下滚动。',
      selector: '.hand-zone'
    },
    {
      title: '界面 5 / 5 · 结束回合',
      text: '完成出牌和落子后点“结束回合”。未落子不能结束；手牌超过 4 张会先进入弃牌。',
      selector: '#endTurnBtn'
    }
  ];

  const TUTORIAL_CHAPTERS = [
    {
      id: 'seal',
      title: '第 1 章 · 体力与封锁',
      intro: '先学会看费用：用一张封锁牌，再落子，最后结束回合。',
      stones: [],
      hand: ['sealOrtho', 'sealAll', 'charge', 'twin'],
      aiHand: ['charge', 'sealOrtho'],
      stages: {
        seal: {
          title: '第 1 步 · 使用封锁',
          text: '双击【四方封】或点“发动”，目标选闪烁的 H10。费用 1，体力 4 → 3。',
          card: 'sealOrtho',
          target: { r: 9, c: 7 },
          next: 'place'
        },
        place: {
          title: '第 2 步 · 落子',
          text: '封锁已生效，紫色虚线的格子本回合不能落子。点击 G11 落一枚己方星子。',
          place: { r: 10, c: 6 },
          next: 'end'
        },
        end: {
          title: '第 3 步 · 结束回合',
          text: '行动完成，点击“结束回合”。下一章会演示移动与双倍计数。'
        }
      },
      enemy: { kind: 'place', r: 9, c: 9 }
    },
    {
      id: 'move',
      title: '第 2 章 · 移动与双倍',
      intro: '移动会改变棋子的位置，双倍计数会让一枚棋子算两枚。',
      stones: [
        [10, 5, 'player'], [10, 7, 'player'],
        [9, 7, 'ai'], [9, 8, 'ai']
      ],
      hand: ['shift', 'twin', 'charge', 'sealAll'],
      aiHand: ['sealAll', 'charge'],
      stages: {
        shiftFrom: {
          title: '第 1 步 · 选择要移动的棋子',
          text: '双击【挪星步】或点“发动”，再点己方 F11 的星子。费用 1，移动后仍可继续出牌。',
          card: 'shift',
          target: { r: 10, c: 5 },
          next: 'shiftTo'
        },
        shiftTo: {
          title: '第 2 步 · 选择落点',
          text: '点闪烁的 G11。移动后星子会真正换到新位置，连线也随位置改变。',
          card: 'shift',
          target: { r: 10, c: 6 },
          next: 'twin'
        },
        twin: {
          title: '第 3 步 · 双倍计数',
          text: '双击【双生星】或点“发动”，点 G11。此子以后在连珠中永久算 2 枚。',
          card: 'twin',
          target: { r: 10, c: 6 },
          next: 'place'
        },
        place: {
          title: '第 4 步 · 落子',
          text: '再在 I11 落一子，观察双倍棋子对连线进度的帮助。',
          place: { r: 10, c: 8 },
          next: 'end'
        },
        end: {
          title: '第 5 步 · 结束回合',
          text: '点击结束回合，墨鸦会用一张封锁牌回应。'
        }
      },
      enemy: { kind: 'card', cardId: 'sealAll', target: { r: 8, c: 8 } }
    },
    {
      id: 'control',
      title: '第 3 章 · 封锁与补给',
      intro: '封锁对手的下一张牌，再用额外抽牌为下一回合准备资源。',
      stones: [
        [10, 6, 'player'], [10, 7, 'player'], [10, 8, 'player'],
        [9, 7, 'ai'], [9, 8, 'ai']
      ],
      hand: ['silence', 'extra', 'discount', 'charge'],
      aiHand: ['ruin', 'charge'],
      stages: {
        silence: {
          title: '第 1 步 · 封锁手牌',
          text: '双击【封锁】发动：费用 1，墨鸦下一张牌会失效，但仍会消耗体力。',
          card: 'silence',
          next: 'extra'
        },
        extra: {
          title: '第 2 步 · 额外抽牌',
          text: '再发动【额外抽牌】：费用 2，下回合额外获得 2 张手牌。也可以选择省力，但本教程演示抽牌。',
          card: 'extra',
          next: 'place'
        },
        place: {
          title: '第 3 步 · 落子与结束',
          text: '在 J11 落子后结束回合，观察被封锁的墨鸦术式如何失效。',
          place: { r: 10, c: 9 },
          next: 'end'
        },
        end: {
          title: '第 4 步 · 结束回合',
          text: '点击结束回合。'
        }
      },
      enemy: { kind: 'nullified', cardId: 'ruin', place: { r: 9, c: 10 } }
    },
    {
      id: 'final',
      title: '第 4 章 · 六子改胜',
      intro: '默认七子获胜；用六子改胜把目标改为六子，再落下最后一子。',
      stones: [
        [10, 1, 'player'], [10, 2, 'player'], [10, 3, 'player'], [10, 4, 'player'], [10, 5, 'player'],
        [8, 8, 'ai'], [8, 9, 'ai']
      ],
      hand: ['sixwin', 'charge', 'twin', 'sealAll'],
      aiHand: ['charge'],
      stages: {
        sixwin: {
          title: '第 1 步 · 改为六子',
          text: '双击【六子改胜】或点“发动”：胜利条件由 7 子改为 6 子，此牌随后移出牌库。',
          card: 'sixwin',
          next: 'place'
        },
        place: {
          title: '第 2 步 · 最后一子',
          text: '五枚己方星子已就位。在 G11 落下最后一子，连成六子，完成教程。',
          place: { r: 10, c: 6 },
          next: 'end'
        }
      },
      enemy: null
    }
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad2 = n => String(n).padStart(2, '0');
  const escapeHtml = text => String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 右下角卡牌效果演示：7×7 迷你棋盘 + 资源区，统一 6.2 秒循环。
  const FX_CELLS = '<i class="fx-cell"></i>'.repeat(49);
  const fxCellAt = (r, c, cls, delay = 0) =>
    `<span class="${cls}" style="--r:${r};--c:${c};--d:${delay}s"></span>`;
  const fxStone = (side, r, c, cls = '', delay = 0) =>
    `<span class="fx-stone ${side} ${cls}" style="--r:${r};--c:${c};--d:${delay}s"><i></i></span>`;
  const fxLock = (r, c, i) =>
    `<span class="fx-lock" style="--r:${r};--c:${c};--d:${i * 0.14}s">✕</span>`;
  const fxTarget = (r, c, cls = '') => fxCellAt(r, c, `fx-target ${cls}`);
  const fxBlast = (r, c) => fxCellAt(r, c, 'fx-blast');
  const fxCaption = text => `<span class="fx-caption">${text}</span>`;
  const fxBoard = inner => `<div class="fx-board"><div class="fx-grid">${FX_CELLS}${inner}</div></div>`;

  const CARD_FX = {
    sealOrtho: () => fxBoard(`
      ${fxTarget(4, 4)}
      ${[[3, 4], [5, 4], [4, 3], [4, 5]].map(([r, c], i) => fxLock(r, c, i)).join('')}
      ${fxCaption('封锁上下左右 · 1 回合')}
    `),
    sealAll: () => fxBoard(`
      ${fxTarget(4, 4)}
      ${[[3, 3], [3, 4], [3, 5], [4, 5], [5, 5], [5, 4], [5, 3], [4, 3]]
        .map(([r, c], i) => fxLock(r, c, i)).join('')}
      ${fxCaption('封锁周围八格 · 1 回合')}
    `),
    twin: () => fxBoard(`
      ${fxTarget(4, 4, 'is-twin-target')}
      ${fxStone('p', 4, 4, 'is-double')}
      ${fxCellAt(4, 4, 'fx-twin-ring')}
      ${fxCaption('己方星子 · 永久计 2 枚')}
    `),
    shift: () => fxBoard(`
      ${fxTarget(4, 4)}
      ${fxStone('p', 4, 3, 'shift-from')}
      ${fxStone('p', 4, 4, 'shift-to')}
      ${fxCellAt(4, 4, 'fx-arrow-cell')}
      ${fxCaption('移动 1 枚 · 相邻八格')}
    `),
    ruin: () => fxBoard(`
      ${fxTarget(4, 4)}
      ${fxBlast(4, 4)}
      ${fxStone('e', 4, 4, 'ruin-stone')}
      ${[[3, 3], [3, 4], [3, 5], [4, 3], [4, 5], [5, 3], [5, 4], [5, 5]]
        .map(([r, c], i) => fxStone('e', r, c, 'ruin-stone', (i + 1) * 0.045)).join('')}
      ${fxCaption('目标及周围八格 · 全部清除')}
    `),
    swap: () => fxBoard(`
      ${fxTarget(4, 2)}${fxTarget(4, 5)}
      ${fxStone('p', 4, 2, 'swap-a')}
      ${fxStone('e', 4, 5, 'swap-b')}
      ${fxStone('e', 4, 2, 'swap-a-in')}
      ${fxStone('p', 4, 5, 'swap-b-in')}
      ${fxCaption('交换两枚棋子的位置')}
    `),
    subvert: () => fxBoard(`
      ${fxTarget(4, 4)}
      ${[[4, 4], [3, 4], [4, 3], [4, 5], [5, 4]].map(([r, c], i) => fxStone('e', r, c, 'subvert-out', i * 0.13)).join('')}
      ${[[4, 4], [3, 4], [4, 3], [4, 5], [5, 4]].map(([r, c], i) => fxStone('p', r, c, 'subvert-in', i * 0.13)).join('')}
      ${fxCaption('目标及上下左右 · 转为你方')}
    `),
    silence: () => `
      <div class="fx-ritual fx-silence">
        <div class="fx-card-back"><span>✦</span><i></i></div>
        <div class="fx-silence-lock">封</div>
        <div class="fx-ritual-label">对手下一张牌无效</div>
      </div>`,
    extra: () => `
      <div class="fx-ritual fx-extra">
        <div class="fx-deck-stack"><i></i><i></i><i></i></div>
        <div class="fx-fly-card fx-fly-one">✦</div>
        <div class="fx-fly-card fx-fly-two">✦</div>
        <div class="fx-extra-plus">+2</div>
        <div class="fx-ritual-label">下回合额外抽 2 张</div>
      </div>`,
    charge: () => `
      <div class="fx-ritual fx-mana">
        <div class="fx-mana-pips"><i></i><i></i><i></i><i class="fx-charge-pip"></i></div>
        <div class="fx-mana-plus">+1</div>
        <div class="fx-ritual-label">本回合获得 1 点体力</div>
      </div>`,
    store: () => `
      <div class="fx-ritual fx-mana fx-store">
        <div class="fx-mana-pips"><i></i><i></i><i></i><i class="fx-store-pip"></i></div>
        <div class="fx-store-arrow">↻</div>
        <div class="fx-mana-plus">+1</div>
        <div class="fx-ritual-label">下回合额外获得 1 点</div>
      </div>`,
    discount: () => `
      <div class="fx-ritual fx-discount">
        <div class="fx-cost-card">
          <span>术式</span>
          <b class="fx-cost-old">3</b>
          <b class="fx-cost-new">0</b>
        </div>
        <div class="fx-discount-slash"></div>
        <div class="fx-ritual-label">选中一张牌 · 消耗降至 0</div>
      </div>`,
    sixwin: () => fxBoard(`
      ${[1, 2, 3, 4, 5, 6].map((c, i) => fxStone('p', 3, c, 'sixwin-stone', i * 0.1)).join('')}
      <span class="fx-rule-change">7 → 6</span>
      ${fxCaption('改为六子 · 用后移出牌库')}
    `)
  };

  class GameApp {
    constructor() {
      this.engine = null;
      this.ai = null;
      this.mode = 'normal';
      this.sessionId = 0;
      this.busy = false;
      this.aiRunning = false;
      this.abandoned = false;
      this.selection = null;
      this.hoverCard = null;
      this.tutorial = null;
      this.offerPicks = new Set();
      this.offerHighlight = -1;
      this.offerAutoTimer = null;
      this.offerIsTutorial = false;
      this.offerBaseHint = '';
      this.discardPicks = new Set();
      this.offerCards = [];
      this.showcaseCardId = null;
      this.handClickTimer = null;
      this._suppressDblActivate = false;
      this.resultShown = false;
      this.resultTimer = null;
      this.logs = [];
      this.seatKind = { player: 'human', ai: 'ai' };
      this.llmConfig = this.loadLLMConfig();
      this.llmRunning = false;
      this.llmError = null;
      this._renderRaf = null;
      this._lastBoardSize = 0;
      this.boardEls = [];
      this.soundMuted = localStorage.getItem('sevenfold.muted') === '1';
      this.sound = SoundManager ? new SoundManager({ muted: this.soundMuted }) : null;

      this.cacheDom();
      this.dom.app.classList.add('is-title');
      this.renderStars();
      this.renderTitleDeco();
      this.bindEvents();
      this.applyArt('normal');
      this.renderLLMState();
      this.renderAll();
    }

    cacheDom() {
      this.dom = {
        app: $('#app'),
        roundLabel: $('#roundLabel'),
        turnBadge: $('#turnBadge'),
        backBtn: $('#backBtn'),
        aiModeLabel: $('#aiModeLabel'),
        aiAvatar: $('#aiAvatar'),
        bossHpBox: $('#bossHpBox'),
        bossHp: $('#bossHp'),
        aiHandCount: $('#aiHandCount'),
        aiRailCount: $('#aiRailCount'),
        aiRailDeckCount: $('#aiRailDeckCount'),
        aiManaText: $('#aiManaText'),
        aiGoal: $('#aiGoal'),
        aiStatus: $('#aiStatus'),
        boardStage: $('.board-stage'),
        boardFrame: $('.board-frame'),
        coordTop: $('#coordTop'),
        coordLeft: $('#coordLeft'),
        board: $('#board'),
        boardFx: $('#boardFx'),
        fxToast: $('#fxToast'),
        winLine: $('#winLine'),
        winLineGlow: $('#winLineGlow'),
        winLineCore: $('#winLineCore'),
        staminaHud: $('#staminaHud'),
        playerManaPips: $('#playerManaPips'),
        playerManaText: $('#playerManaText'),
        boardHint: $('#boardHint'),
        boardSizeLabel: $('#boardSizeLabel'),
        hand: $('#hand'),
        playerHandCount: $('#playerHandCount'),
        playerGoal: $('#playerGoal'),
        playerDeckCount: $('#playerDeckCount'),
        playerDiscardCount: $('#playerDiscardCount'),
        phaseChip: $('#phaseChip'),
        actionHint: $('#actionHint'),
        cancelBtn: $('#cancelBtn'),
        playBtn: $('#playBtn'),
        endTurnBtn: $('#endTurnBtn'),
        logStrip: $('#logStrip'),
        fxShowcase: $('#fxShowcase'),
        fxBody: $('#fxBody'),
        fxCardName: $('#fxCardName'),
        fxLoopBadge: $('#fxLoopBadge'),
        cardTip: $('#cardTip'),
        enemyAction: $('#enemyAction'),
        enemyActionKicker: $('#enemyActionKicker'),
        enemyActionArt: $('#enemyActionArt'),
        enemyActionTitle: $('#enemyActionTitle'),
        enemyActionMeta: $('#enemyActionMeta'),
        enemyActionText: $('#enemyActionText'),
        tutorialHud: $('#tutorialHud'),
        tutorialTitle: $('#tutorialTitle'),
        tutorialText: $('#tutorialText'),
        tutorialProgress: $('#tutorialProgress'),
        tutorialNext: $('#tutorialNext'),
        tutorialSkip: $('#tutorialSkip'),
        tutorialHelp: $('#tutorialHelp'),
        tutorialRestart: $('#tutorialRestart'),
        tutorialExit: $('#tutorialExit'),
        titleScreen: $('#titleScreen'),
        tutorialBtn: $('#tutorialBtn'),
        codexBtn: $('#codexBtn'),
        offerScreen: $('#offerScreen'),
        offerGrid: $('#offerGrid'),
        offerTitle: $('#offerTitle'),
        offerDesc: $('#offerDesc'),
        offerHint: $('#offerHint'),
        offerCounter: $('#offerCounter'),
        offerConfirm: $('#offerConfirm'),
        discardScreen: $('#discardScreen'),
        discardGrid: $('#discardGrid'),
        discardHint: $('#discardHint'),
        discardCounter: $('#discardCounter'),
        discardConfirm: $('#discardConfirm'),
        resultScreen: $('#resultScreen'),
        resultKicker: $('#resultKicker'),
        resultTitle: $('#resultTitle'),
        resultSub: $('#resultSub'),
        resultLine: $('#resultLine'),
        resultStats: $('#resultStats'),
        rematchBtn: $('#rematchBtn'),
        backTitleBtn: $('#backTitleBtn'),
        modal: $('#modal'),
        modalTitle: $('#modalTitle'),
        modalKicker: $('#modalKicker'),
        modalBody: $('#modalBody'),
        toastLayer: $('#toastLayer'),
        bgStars: $('#bgStars')
      };
    }

    renderStars() {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < 90; i++) {
        const star = document.createElement('span');
        star.className = 'star';
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.animationDelay = `${Math.random() * 6}s`;
        star.style.opacity = String(0.2 + Math.random() * 0.7);
        frag.appendChild(star);
      }
      this.dom.bgStars.replaceChildren(frag);
    }

    renderTitleDeco() {
      $$('.deco-card[data-card]').forEach(el => {
        const card = BY_ID[el.dataset.card];
        const art = el.querySelector('span');
        if (card && art) art.innerHTML = this.renderIcon(card, 'deco-icon');
      });
    }

    renderIcon(card, cls = '') {
      if (!card || !Array.isArray(card.icon)) return '';
      const palette = { 1: '#08040f', 2: '#2b1d40', 3: card.accent, 4: card.accent, 5: '#fff5d6' };
      const groups = { 1: '', 2: '', 3: '', 4: '', 5: '' };
      card.icon.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === '0' || !Object.prototype.hasOwnProperty.call(groups, ch)) return;
          groups[ch] += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        });
      });
      const fill = key => groups[key]
        ? `<g fill="${palette[key]}"${key === '3' ? ' opacity=".62"' : ''}>${groups[key]}</g>`
        : '';
      return `<svg class="pixel-icon ${cls}" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true">${fill('1')}${fill('2')}${fill('3')}${fill('4')}${fill('5')}</svg>`;
    }

    bindEvents() {
      document.addEventListener('click', e => {
        const button = e.target.closest('button');
        if (!button || button.disabled) return;
        if (button.matches('.mode-btn, #tutorialBtn, #tutorialRestart, #rematchBtn, #backTitleBtn, #codexBtn, [data-close-modal], #offerConfirm, #discardConfirm, #endTurnBtn')) return;
        this.playSound('select');
      });
      $$('.mode-btn[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => this.startGame(btn.dataset.mode));
        const preview = () => this.applyArt(btn.dataset.mode);
        btn.addEventListener('mouseenter', preview);
        btn.addEventListener('focus', preview);
      });
      if (this.dom.titleScreen) {
        this.dom.titleScreen.addEventListener('mouseleave', () => this.applyArt(this.mode));
      }
      this.dom.tutorialBtn.addEventListener('click', () => this.startTutorial());
      this.dom.backBtn.addEventListener('click', () => this.backToTitle());
      if (this.dom.soundBtn) {
        const paint = () => {
          const muted = !!(this.sound && this.sound.muted);
          this.dom.soundBtn.textContent = muted ? '♪ 静音' : '♪ 音乐';
          this.dom.soundBtn.setAttribute('aria-pressed', String(!muted));
        };
        paint();
        this.dom.soundBtn.addEventListener('click', () => {
          if (!this.sound) return;
          this.sound.setMuted(!this.sound.muted);
          localStorage.setItem('sevenfold.muted', this.sound.muted ? '1' : '0');
          paint();
          if (!this.sound.muted) this.playSound('select');
        });
      }
      if (this.dom.llmSettingsBtn) this.dom.llmSettingsBtn.addEventListener('click', () => this.openLLMSettings());
      if (this.dom.llmRetryBtn) this.dom.llmRetryBtn.addEventListener('click', () => this.retryLLM());
      if (this.dom.llmAbortBtn) this.dom.llmAbortBtn.addEventListener('click', () => this.abortLLM());
      this.dom.tutorialRestart.addEventListener('click', () => this.startTutorial());
      this.dom.tutorialExit.addEventListener('click', () => this.backToTitle());
      this.dom.tutorialNext.addEventListener('click', () => this.tutorialNext());
      this.dom.tutorialSkip.addEventListener('click', () => this.skipTutorialIntro());
      this.dom.tutorialHelp.addEventListener('click', () => this.showTutorialIntro(true));
      document.addEventListener('click', e => {
        if (!this.tutorial || this.tutorial.mode !== 'intro') return;
        if (e.target.closest('.tutorial-actions') || e.target.closest('#backBtn')) return;
        e.preventDefault();
        e.stopPropagation();
        this.tutorialNext();
      }, true);
      document.addEventListener('keydown', e => {
        if (!this.tutorial || this.tutorial.mode !== 'intro') return;
        if (e.repeat) return;
        if (e.target.closest && e.target.closest('.tutorial-actions, #backBtn')) return;
        e.preventDefault();
        this.tutorialNext();
      }, true);
      if (this.dom.codexBtn) this.dom.codexBtn.addEventListener('click', () => this.openCodex());
      this.dom.modal.addEventListener('click', e => {
        if (e.target === this.dom.modal || e.target.closest('[data-close-modal]')) this.closeModal();
      });
      this.dom.modalBody.addEventListener('click', e => {
        const card = e.target.closest('[data-codex-id]');
        if (card) this.showCodexDemo(card.dataset.codexId);
      });

      this.dom.hand.addEventListener('click', e => {
        const card = e.target.closest('.card');
        if (!card) return;
        const uid = card.dataset.uid;
        if (this.selection && this.selection.cardId === 'discount' && this.selection.stage === 'handTarget') {
          if (e.detail === 1) {
            this._suppressDblActivate = true;
            setTimeout(() => { this._suppressDblActivate = false; }, 420);
            this.onHandCardClick(uid);
          }
          return;
        }
        if (e.detail > 1) {
          clearTimeout(this.handClickTimer);
          this.handClickTimer = null;
          return;
        }
        clearTimeout(this.handClickTimer);
        this.handClickTimer = setTimeout(() => {
          this.handClickTimer = null;
          this.onHandCardClick(uid);
        }, 230);
      });
      this.dom.hand.addEventListener('dblclick', e => {
        const card = e.target.closest('.card');
        if (!card) return;
        e.preventDefault();
        clearTimeout(this.handClickTimer);
        this.handClickTimer = null;
        if (this._suppressDblActivate) return;
        this.activateHandCard(card.dataset.uid);
      });
      this.dom.hand.addEventListener('pointerover', e => {
        const card = e.target.closest('.card');
        if (!card) return;
        if (e.relatedTarget && card.contains(e.relatedTarget)) return;
        this.playSound('hover', { throttle: 70, volume: 0.8 });
        this.hoverCard = card.dataset.uid;
        this.renderTip();
      });
      this.dom.hand.addEventListener('pointerout', e => {
        if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.card')) {
          this.hoverCard = null;
          this.renderTip();
        }
      });
      this.dom.board.addEventListener('click', e => {
        const cell = e.target.closest('.cell');
        if (!cell) return;
        this.onBoardClick(Number(cell.dataset.r), Number(cell.dataset.c));
      });
      this.dom.board.addEventListener('contextmenu', e => {
        e.preventDefault();
        const cell = e.target.closest('.cell');
        if (!cell) return;
        this.onBoardRightClick(Number(cell.dataset.r), Number(cell.dataset.c));
      });

      this.dom.playBtn.addEventListener('click', () => this.playSelected({}));
      this.dom.cardTip.addEventListener('click', e => {
        const btn = e.target.closest('[data-tip-action]');
        if (!btn) return;
        if (btn.dataset.tipAction === 'play') this.playSelected({});
        if (btn.dataset.tipAction === 'cancel') this.cancelSelection();
      });
      this.dom.cancelBtn.addEventListener('click', () => this.cancelSelection());
      this.dom.endTurnBtn.addEventListener('click', () => this.endPlayerTurn());
      this.dom.discardConfirm.addEventListener('click', () => this.confirmDiscard());
      this.dom.offerConfirm.addEventListener('click', () => this.confirmOffer());

      this.dom.offerGrid.addEventListener('click', e => {
        const card = e.target.closest('[data-offer-index]');
        if (!card) return;
        this.handleOfferClick(Number(card.dataset.offerIndex));
      });
      this.dom.discardGrid.addEventListener('click', e => {
        const card = e.target.closest('[data-discard-uid]');
        if (!card) return;
        this.toggleDiscardPick(card.dataset.discardUid);
      });

      this.dom.rematchBtn.addEventListener('click', () => {
        this.dom.resultScreen.hidden = true;
        if (this.tutorial) this.startTutorial();
        else this.startGame(this.mode);
      });
      this.dom.backTitleBtn.addEventListener('click', () => {
        this.playSound('modal');
        this.backToTitle();
      });

      document.addEventListener('keydown', e => {
        if (!this.dom.modal.hidden) {
          if (e.key === 'Escape') this.closeModal();
          return;
        }
        if (!this.dom.offerScreen.hidden || !this.dom.discardScreen.hidden) return;
        if (e.key === 'Escape') {
          if (this.selection) { this.cancelSelection(); return; }
        }
        if (e.key === 'e' || e.key === 'E') {
          if (!this.dom.endTurnBtn.disabled) {
            e.preventDefault();
            this.endPlayerTurn();
          }
        }
        if (/^[1-9]$/.test(e.key) && this.engine && !this.busy) {
          const idx = Number(e.key) - 1;
          const entry = this.engine.state.players.player.hand[idx];
          if (entry) {
            e.preventDefault();
            this.playSound('select');
            this.onHandCardClick(entry.uid);
          }
        }
      });
    }

    openCodex() {
      this.playSound('modal');
      this.dom.modalKicker.textContent = 'CARD CODEX';
      this.dom.modalTitle.textContent = '卡牌图鉴 · 13';
      this.dom.modalBody.innerHTML = `
        <div class="codex-demo">
          <div class="codex-demo-head"><span>术式演示</span><b id="codexDemoName">选择一张卡</b><i>循环</i></div>
          <div class="codex-demo-body" id="codexDemoBody">
            <div class="codex-demo-idle">点击下方卡牌查看 6.2 秒循环效果</div>
          </div>
        </div>
        <div class="codex-grid">${CARD_LIB.CARDS.map(card => `
        <button type="button" class="codex-card" data-codex-id="${card.id}" style="--accent:${card.accent}">
          <div class="codex-art">${this.renderIcon(card)}</div>
          <div class="codex-head"><b>${card.name}</b><span>${card.cost} 体力</span></div>
          <div class="codex-tag">${card.tag}</div>
          <p>${escapeHtml(card.desc)}</p>
        </button>`).join('')}</div>`;
      this.dom.modal.hidden = false;
      this.showCodexDemo('sixwin');
    }

    showCodexDemo(cardId) {
      const card = BY_ID[cardId];
      const build = CARD_FX[cardId];
      if (!card || !build) return;
      const name = this.dom.modalBody.querySelector('#codexDemoName');
      const body = this.dom.modalBody.querySelector('#codexDemoBody');
      if (name) name.textContent = `${card.name} · ${card.cost} 体力`;
      if (body) body.innerHTML = `<div class="fx-stage">${build()}</div>`;
      this.dom.modalBody.querySelectorAll('[data-codex-id]').forEach(el => {
        el.classList.toggle('is-selected', el.dataset.codexId === cardId);
      });
    }

    closeModal() {
      if (!this.dom.modal.hidden) this.playSound('modal');
      this.dom.modal.hidden = true;
    }

    startGame(mode) {
      this.playSound('start');
      this.mode = MODE_LABEL[mode] ? mode : 'normal';
      this.seatKind = { ...(MODE_SEATS[this.mode] || MODE_SEATS.normal) };
      // LLM 模式必须先配好座位，否则不开局（绝不偷偷退回本地 AI）
      const needLLM = ['player', 'ai'].filter(side => this.seatKind[side] === 'llm');
      const missing = needLLM.filter(side => !this.llmReady(side));
      if (missing.length) {
        this.openLLMSettings(missing);
        this.toast('先填好 LLM 的接口和密钥', 'danger');
        return;
      }
      this.closeOverlays();
      this.dom.app.classList.remove('is-title');
      window.scrollTo(0, 0);
      this.dom.titleScreen.classList.add('is-leaving');
      setTimeout(() => { this.dom.titleScreen.hidden = true; }, 260);
      this.engine = new Engine({
        seed: (Date.now() ^ 0x5f3759df) >>> 0,
        mode: this.mode === 'boss' ? 'boss' : 'normal'
      });
      this.ai = new AI(this.engine, {
        difficulty: ['boss', 'llm', 'llmpk'].includes(this.mode) ? 'hard' : this.mode,
        seed: (Date.now() ^ 0xa5a5a5a5) >>> 0
      });
      this.engineSub = this.engine.onEvent(event => this.onEngineEvent(event));
      this.sessionId++;
      this.busy = false;
      this.aiRunning = false;
      this.abandoned = false;
      this.selection = null;
      this.hoverCard = null;
      this.resultShown = false;
      this.tutorial = null;
      this.logs = [];
      this.dom.tutorialHud.hidden = true;
      this.dom.resultScreen.hidden = true;
      this.dom.winLine.classList.remove('is-show');
      this.dom.fxToast.classList.remove('is-show');
      this.dom.board.classList.remove('is-shaking');
      this.renderAll();
      this.applyArt(this.mode);
      if (this.sound) this.sound.playBgm('battle');
      this.addLog(`模式：${MODE_LABEL[this.mode]} · 20×20 · 13 张牌`, 'system');
      if (this.mode === 'boss') {
        this.addLog('Boss 关：墨鸦有两条命。你每拆掉它一条命，连珠会被一并拆散；第 2、4、6… 次连成五子时它会跟你换营——除非它已经占优。', 'system');
      }
      this.addLog('你执星火，先手。每回合 4 选 2，体力 4 点，落一子。', 'system');
      this.toast(`对局开始 · ${MODE_LABEL[this.mode]}`, 'player');
      const openingOffer = this.seatKind.player === 'human' && this.engine.state.phase === 'draft'
        ? this.engine.state.offer
        : null;
      const session = this.sessionId;
      if (openingOffer) {
        setTimeout(() => {
          if (this.abandoned || this.sessionId !== session || !this.engine) return;
          if (this.engine.state.phase === 'draft' && this.engine.state.offer) {
            this.openOffer(this.engine.state.offer);
          }
        }, 320);
      }
      this.maybeDriveTurn();
    }

    startTutorial() {
      this.playSound('start');
      this.mode = 'tutorial';
      this.closeOverlays();
      this.dom.app.classList.remove('is-title');
      window.scrollTo(0, 0);
      this.dom.titleScreen.classList.add('is-leaving');
      setTimeout(() => { this.dom.titleScreen.hidden = true; }, 260);
      this.tutorial = null;
      this.loadTutorialChapter(0);
      this.showTutorialIntro(false);
      this.toast('教程开始 · 先认识界面', 'player');
    }

    loadTutorialChapter(index) {
      const chapter = TUTORIAL_CHAPTERS[index];
      if (!chapter) return;
      this.engine = new Engine({ seed: 20261024 + index * 97 });
      this.ai = null;
      this.engineSub = this.engine.onEvent(event => this.onEngineEvent(event));
      this.sessionId++;
      this.busy = false;
      this.aiRunning = false;
      this.abandoned = false;
      this.selection = null;
      this.hoverCard = null;
      this.resultShown = false;
      this.logs = [];
      this.dom.resultScreen.hidden = true;
      this.dom.winLine.classList.remove('is-show');
      this.dom.fxToast.classList.remove('is-show');
      this.dom.board.classList.remove('is-shaking');
      this.hideEnemyAction();

      const s = this.engine.state;
      const p = s.players.player;
      const a = s.players.ai;
      const makeStone = (owner, r, c, i) => ({
        uid: `tut-${index}-${owner}-${i}`,
        owner,
        doubled: false,
        placedPly: 0
      });
      s.cells = Array.from({ length: s.size }, () => Array(s.size).fill(null));
      (chapter.stones || []).forEach(([r, c, owner], i) => {
        s.cells[r][c] = makeStone(owner, r, c, i);
      });
      const makeHand = (ids, side) => ids.map((id, i) => ({ uid: `tut-${index}-${side}-${i}`, id }));
      p.hand = makeHand(chapter.hand, 'p');
      a.hand = makeHand(chapter.aiHand || [], 'a');
      p.deck = [];
      a.deck = [];
      p.discard = [];
      a.discard = [];
      p.mana = 4;
      a.mana = 4;
      p.winTarget = 7;
      a.winTarget = 7;
      p.silenced = false;
      a.silenced = false;
      p.nextMana = 0;
      a.nextMana = 0;
      p.extraDraw = 0;
      a.extraDraw = 0;
      s.current = 'player';
      s.phase = 'main';
      s.status = 'playing';
      s.round = index + 1;
      s.ply = 0;
      s.placed = false;
      s.cardsPlayedThisTurn = 0;
      s.offer = null;
      s.seals = {};
      s.lastMove = null;
      s.winner = null;
      s.winLine = null;
      s.noDraft = true;
      s.stats = {
        stonesPlaced: (chapter.stones || []).filter(item => item[2] === 'player').length,
        cardsPlayed: 0,
        captures: 0
      };

      const firstStage = Object.keys(chapter.stages)[0];
      const priorCards = this.tutorial?.cardsPlayed || 0;
      this.tutorial = {
        mode: 'guided',
        chapter: index,
        stage: firstStage,
        playerTurns: index + 1,
        cardsPlayed: priorCards,
        completed: false,
        from: null,
        returnStage: null,
        draftShown: false,
        draft: false
      };
      this.dom.tutorialHud.hidden = false;
      this.renderAll();
      this.updateTutorialHud();
      this.addLog(`${chapter.title}：${chapter.intro}`, 'system');
    }

    showTutorialIntro(review = false) {
      if (!this.tutorial) return;
      if (review && this.tutorial.mode !== 'intro') {
        this.tutorial.returnStage = this.tutorial.stage;
      }
      this.tutorial.mode = 'intro';
      this.tutorial.introStep = this.tutorial.introStep || 0;
      if (!review) this.tutorial.introStep = 0;
      this.dom.app.classList.add('is-tutorial-intro');
      this.dom.tutorialHud.hidden = false;
      this.updateTutorialHud();
      this.renderAll();
    }

    tutorialNext() {
      if (!this.tutorial || this.tutorial.mode !== 'intro') return;
      this.tutorial.introStep = (this.tutorial.introStep || 0) + 1;
      if (this.tutorial.introStep >= TUTORIAL_INTRO.length) {
        this.finishTutorialIntro();
        return;
      }
      this.updateTutorialHud();
    }

    skipTutorialIntro() {
      if (!this.tutorial || this.tutorial.mode !== 'intro') return;
      this.finishTutorialIntro();
    }

    finishTutorialIntro() {
      if (!this.tutorial) return;
      document.querySelectorAll('.is-intro-focus').forEach(el => el.classList.remove('is-intro-focus'));
      const wasReview = !!this.tutorial.returnStage;
      this.tutorial.mode = 'guided';
      if (this.tutorial.returnStage) this.tutorial.stage = this.tutorial.returnStage;
      this.tutorial.returnStage = null;
      this.tutorial.introStep = 0;
      this.dom.app.classList.remove('is-tutorial-intro');
      window.scrollTo(0, 0);
      this.updateTutorialHud();
      this.renderAll();
      if (!wasReview && this.tutorial.chapter === 0 && !this.tutorial.draftShown) {
        this.openTutorialDraft();
        return;
      }
      const chapter = TUTORIAL_CHAPTERS[this.tutorial.chapter];
      this.toast(`${chapter.title} · 开始`, 'gold');
    }

    applyIntroFocus(step) {
      document.querySelectorAll('.is-intro-focus').forEach(el => el.classList.remove('is-intro-focus'));
      if (!step || !step.selector) return;
      const el = document.querySelector(step.selector);
      if (el) {
        el.classList.add('is-intro-focus');
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }

    closeOverlays() {
      if (this.resultTimer) {
        clearTimeout(this.resultTimer);
        this.resultTimer = null;
      }
      if (this.offerAutoTimer) {
        clearTimeout(this.offerAutoTimer);
        this.offerAutoTimer = null;
      }
      this.dom.offerScreen.hidden = true;
      this.dom.discardScreen.hidden = true;
      this.dom.resultScreen.hidden = true;
      this.dom.cardTip.hidden = true;
      this.hideEnemyAction();
    }

    backToTitle() {
      if (this.sound) this.sound.stopBgm({ fade: 300 });
      this.applyArt(this.mode);
      this.abandoned = true;
      this.sessionId++;
      this.busy = false;
      this.aiRunning = false;
      this.selection = null;
      this.tutorial = null;
      this.dom.tutorialHud.hidden = true;
      this.closeOverlays();
      if (this.engine && this.engine.state.status === 'playing') this.engine.state.status = 'abandoned';
      this.dom.titleScreen.hidden = false;
      this.dom.titleScreen.classList.remove('is-leaving');
      this.dom.app.classList.add('is-title');
      window.scrollTo(0, 0);
      this.renderAll();
    }

    onEngineEvent(event) {
      if (this.abandoned) return;
      switch (event.type) {
        case 'manaRefilled':
          if (event.side === 'player') this.playSound('manaRefill');
          break;
        case 'turnStart':
          if (event.side === 'player') this.playSound('turn');
          this.addLog(`—— 第 ${event.round} 回合 · 体力 ${event.mana} ——`, 'system');
          this.renderAll();
          break;
        case 'turnEnd':
          if (event.side === 'player') this.playSound('turnEnd');
          break;
        case 'offer':
          this.openOffer(event.cards);
          break;
        case 'draftChosen': {
          if (event.side === 'player') this.playSound('draftPick');
          const names = (event.chosen || []).map(id => BY_ID[id]?.name).filter(Boolean).join('、');
          if (names) this.addLog(`补给选择：${names}。`, 'player');
          this.renderAll();
          break;
        }
        case 'draw':
          this.playSound('draw');
          if (event.extra) {
            const names = (event.cards || []).map(id => BY_ID[id]?.name).filter(Boolean).join('、');
            this.addLog(`额外抽牌：${names}。`, event.side === 'player' ? 'player' : 'ai');
          }
          this.renderAll();
          break;
        case 'cardPlayed': {
          const card = BY_ID[event.cardId];
          if (card) this.addLog(`发动【${card.name}】${event.cost ? `（体力 ${event.cost}）` : ''}。`, event.side);
          this.renderAll();
          break;
        }
        case 'cardNullified': {
          this.playSound('nullify');
          const card = BY_ID[event.cardId];
          this.addLog(`【${card?.name || '术式'}】被封锁，效果无效。`, 'system');
          this.toast('封锁！首张牌失效', 'danger');
          this.renderAll();
          break;
        }
        case 'stonePlaced':
          this.playSound(event.side === 'player' ? 'placePlayer' : 'placeAi');
          this.addLog(`${event.side === 'player' ? '你' : '墨鸦'}在 ${this.coordName(event.r, event.c)} 落下星子。`, event.side);
          this.renderAll();
          break;
        case 'sealed':
          this.playSound('seal');
          this.addLog(`封锁生效：${event.cells.length} 格暂时不可落子。`, event.side);
          this.showBoardFx('封锁 · 棋盘控制');
          this.renderAll();
          break;
        case 'twinApplied':
          this.playSound('twin');
          this.addLog(`双生星：${this.coordName(event.at.r, event.at.c)} 的星子计为 2 枚。`, event.side);
          this.renderAll();
          break;
        case 'stoneMoved':
          this.playSound('move');
          this.addLog(`挪星步：${this.coordName(event.from.r, event.from.c)} → ${this.coordName(event.to.r, event.to.c)}。`, event.side);
          this.renderAll();
          break;
        case 'detonated':
          this.playSound('ruin');
          this.addLog(`崩星爆裂，${event.removed.length} 枚星子被清除。`, event.side);
          this.showBoardFx('崩星 · 寂灭');
          this.shakeBoard();
          this.renderAll();
          break;
        case 'swapped':
          this.playSound('swap');
          this.addLog(`换影：${this.coordName(event.first.r, event.first.c)} 与 ${this.coordName(event.second.r, event.second.c)} 交换。`, event.side);
          this.renderAll();
          break;
        case 'subverted':
          this.playSound('subvert');
          this.addLog(`策反：${event.cells.length} 枚棋子转投${event.side === 'player' ? '你' : '墨鸦'}。`, event.side);
          this.showBoardFx('策反 · 星蚀');
          this.renderAll();
          break;
        case 'silenced':
          this.playSound('silence');
          this.addLog(`${event.side === 'player' ? '你' : '墨鸦'}封锁了${event.target === 'player' ? '你的' : '墨鸦的'}下一张牌。`, event.side);
          this.renderAll();
          break;
        case 'winTargetChanged':
          this.playSound('sixwin');
          this.addLog(`${event.side === 'player' ? '你' : '墨鸦'}的胜利条件变为 6 子。`, 'reveal');
          this.showBoardFx('六子改胜');
          this.renderAll();
          break;
        case 'cardRetired':
          this.playSound('retire');
          this.addLog('【六子改胜】已移出牌库，本局不再抽出。', 'reveal');
          this.renderAll();
          break;
        case 'extraDrawQueued':
          this.playSound('extra');
          this.addLog(`${event.side === 'player' ? '你' : '墨鸦'}下回合额外抽 2 张。`, event.side);
          this.renderAll();
          break;
        case 'manaGained':
          this.playSound('charge');
          this.addLog(`蓄力：体力 ${event.mana}/4。`, event.side);
          this.renderAll();
          break;
        case 'manaStored':
          this.playSound('store');
          this.addLog(`储能：下回合 +${event.nextMana} 体力。`, event.side);
          this.renderAll();
          break;
        case 'discountApplied':
          this.playSound('discount');
          this.addLog('省力：一张手牌的费用降为 0。', event.side);
          this.renderAll();
          break;
        case 'handDiscarded':
          this.playSound('discard');
          this.addLog(`弃置了 ${event.cards.length} 张手牌。`, event.side);
          this.renderAll();
          break;
        case 'gameOver':
          this.playSound(event.draw ? 'drawGame' : event.winner === 'player' ? 'win' : 'lose');
          this.handleGameOver(event);
          break;
        default:
          break;
      }
      this.requestRender();
    }

    handleGameOver(event) {
      if (this.resultShown || this.abandoned) return;
      if (this.sound) this.sound.stopBgm({ fade: 900 });
      this.busy = false;
      this.aiRunning = false;
      this.selection = null;
      this.renderAll();
      if (event.draw) {
        this.addLog('棋盘已满，平局。', 'system');
      } else {
        this.addLog(`<em>${event.winner === 'player' ? '你' : '墨鸦'}完成了 ${event.win.target} 子连珠。</em>`, 'reveal');
        this.animateWinLine(event.win);
      }
      this.resultTimer = setTimeout(() => {
        if (this.tutorial) this.showTutorialResult(event);
        else this.showResult(event);
      }, 900);
    }

    animateWinLine(win) {
      if (!win || !win.cells || win.cells.length < 2) return;
      const first = win.cells[0];
      const last = win.cells[win.cells.length - 1];
      const n = this.engine.state.size;
      const x1 = ((first.c + 0.5) / n) * 100;
      const y1 = ((first.r + 0.5) / n) * 100;
      const x2 = ((last.c + 0.5) / n) * 100;
      const y2 = ((last.r + 0.5) / n) * 100;
      for (const id of ['winLineGlow', 'winLineCore']) {
        const line = document.getElementById(id);
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
      }
      this.dom.winLine.classList.add('is-show');
    }

    showResult(event) {
      if (this.resultShown) return;
      this.resultShown = true;
      const state = this.engine.state;
      const won = event.winner === 'player';
      const lost = event.winner === 'ai';
      const target = event.win?.target || 7;
      const bossClear = won && state.mode === 'boss';
      this.dom.resultKicker.textContent = bossClear ? 'BOSS CLEARED' : won ? 'VICTORY' : lost ? 'DEFEAT' : 'DRAW';
      this.dom.resultTitle.textContent = bossClear
        ? '两条命都打穿了'
        : won ? (target === 6 ? '六星归位' : '七星归位') : lost ? '星火熄灭' : '星盘无声';
      this.dom.resultTitle.className = `result-title${lost ? ' is-loss' : ''}`;
      this.dom.resultSub.textContent = won
        ? (bossClear ? `你在第 ${state.round} 回合把墨鸦的两条命都打掉了（最后一击 ${target} 子连珠）。` : `你在第 ${state.round} 回合完成 ${target} 子连珠。`)
        : lost
          ? `墨鸦在第 ${state.round} 回合完成 ${target} 子连珠。`
          : '棋盘已满，双方都没能改写结局。';
      this.dom.resultStats.innerHTML = `
        <div class="result-stat"><span>回合</span><b>${pad2(state.round)}</b></div>
        <div class="result-stat"><span>施术</span><b>${state.stats.cardsPlayed}</b></div>
        <div class="result-stat"><span>落子</span><b>${state.stats.stonesPlaced}</b></div>`;
      const pips = [];
      for (let i = 0; i < Math.min(7, target); i++) pips.push(`<i class="${lost ? 'is-loss' : ''}" style="--d:${i * 0.06}s"></i>`);
      this.dom.resultLine.innerHTML = event.win ? pips.join('') : '';
      this.dom.rematchBtn.textContent = '再来一局';
      this.dom.backTitleBtn.textContent = '返回标题';
      this.dom.resultScreen.hidden = false;
      this.playSound('modal');
    }

    showTutorialResult(event) {
      if (this.resultShown) return;
      this.resultShown = true;
      const won = event && event.winner === 'player';
      this.dom.resultKicker.textContent = won ? 'TUTORIAL CLEAR' : 'TUTORIAL RETRY';
      this.dom.resultTitle.textContent = won ? '新手教程完成' : '再试一次';
      this.dom.resultTitle.className = `result-title${won ? '' : ' is-loss'}`;
      this.dom.resultSub.textContent = won
        ? '看费用、管理体力、理解目标、抓住胜机。你已经完成界面认识与四章引导对局。'
        : '教程还未完成，重试一次吧。';
      this.dom.resultStats.innerHTML = `
        <div class="result-stat"><span>章节</span><b>${this.tutorial.playerTurns}</b></div>
        <div class="result-stat"><span>施术</span><b>${this.tutorial.cardsPlayed || this.engine.state.stats.cardsPlayed}</b></div>
        <div class="result-stat"><span>关键落子</span><b>1</b></div>`;
      this.dom.resultLine.innerHTML = won
        ? '<i></i><i></i><i></i><i></i><i></i><i></i>'
        : '';
      this.dom.rematchBtn.textContent = '重试教程';
      this.dom.backTitleBtn.textContent = '返回标题';
      this.dom.resultScreen.hidden = false;
      this.playSound('modal');
      this.dom.tutorialHud.hidden = true;
    }

    requestRender() {
      if (this._renderRaf) return;
      this._renderRaf = requestAnimationFrame(() => {
        this.seatKind = { player: 'human', ai: 'ai' };
      this.llmConfig = this.loadLLMConfig();
      this.llmRunning = false;
      this.llmError = null;
      this._renderRaf = null;
        this.renderAll();
      });
    }

    renderAll() {
      if (!this.engine) return;
      const state = this.engine.state;
      const aiTurn = state.status === 'playing' && (state.current === 'ai' || this.aiRunning);
      this.dom.app.classList.toggle('is-ai-turn', aiTurn);
      this.dom.app.classList.toggle('is-tutorial-intro', !!(this.tutorial && this.tutorial.mode === 'intro'));
      this.renderTopbar();
      this.ensureBoard();
      this.renderBoard();
      this.renderOpponent();
      this.renderMana();
      if (aiTurn) {
        if (!this._aiHandRendered) {
          this.renderHand();
          this._aiHandRendered = true;
        }
      } else {
        this.renderHand();
        this._aiHandRendered = false;
      }
      this.renderTip();
      this.renderActions();
      this.renderLogs();
      this.dom.app.classList.toggle('is-tutorial', !!this.tutorial);
      if (this.tutorial) this.updateTutorialHud();
      this.syncCardShowcase();
    }

    renderTopbar() {
      const s = this.engine.state;
      this.dom.roundLabel.textContent = `ROUND ${pad2(s.round)}`;
      if (s.status !== 'playing') {
        this.dom.turnBadge.className = 'turn-badge is-over';
        this.dom.turnBadge.innerHTML = '<i></i>对局结束';
      } else if (s.current === 'ai') {
        this.dom.turnBadge.className = 'turn-badge is-ai';
        const thinking = this.aiRunning || this.llmRunning;
        const who = this.getSeatKind('ai') === 'llm'
          ? (this.llmConfig.ai?.model || 'LLM')
          : '墨鸦';
        this.dom.turnBadge.innerHTML = `<i></i>${thinking ? `${who} 思考中` : `${who}回合`}`;
      } else if (s.phase === 'draft') {
        this.dom.turnBadge.className = 'turn-badge is-draft';
        this.dom.turnBadge.innerHTML = '<i></i>补给选择';
      } else {
        this.dom.turnBadge.className = 'turn-badge';
        this.dom.turnBadge.innerHTML = '<i></i>你的回合';
      }
    }

    ensureBoard() {
      const n = this.engine.state.size;
      if (this._lastBoardSize === n && this.boardEls.length === n * n) return;
      this._lastBoardSize = n;
      this.dom.board.style.setProperty('--n', n);
      this.dom.board.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
      this.dom.board.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
      this.dom.coordTop.style.setProperty('--n', n);
      this.dom.coordTop.innerHTML = Array.from({ length: n }, (_, c) => `<span>${LETTERS[c]}</span>`).join('');
      this.dom.coordLeft.innerHTML = Array.from({ length: n }, (_, r) => `<span>${r + 1}</span>`).join('');
      this.dom.boardSizeLabel.textContent = `${n} × ${n}`;
      const frag = document.createDocumentFragment();
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'cell';
          if ((r === 5 || r === 14 || r === 10) && (c === 5 || c === 14 || c === 10)) cell.classList.add('is-star');
          cell.dataset.r = String(r);
          cell.dataset.c = String(c);
          cell.setAttribute('aria-label', `${this.coordName(r, c)} 空`);
          const stone = document.createElement('span');
          stone.className = 'stone-layer';
          cell.appendChild(stone);
          const mark = document.createElement('span');
          mark.className = 'cell-mark';
          cell.appendChild(mark);
          frag.appendChild(cell);
        }
      }
      this.dom.board.replaceChildren(frag);
      this.boardEls = [...this.dom.board.children];
    }

    coordName(r, c) {
      return `${LETTERS[c] || '?'}${r + 1}`;
    }

    renderBoard() {
      const s = this.engine.state;
      const n = s.size;
      const targets = this.getTargets();
      const playable = this.getPlayableCells();
      const focus = this.tutorial ? this.tutorialFocus() : null;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const cell = this.boardEls[r * n + c];
          if (!cell) continue;
          const stone = s.cells[r][c];
          const isTarget = targets.some(t => t.r === r && t.c === c);
          const isPlayable = playable.some(t => t.r === r && t.c === c);
          const sealed = this.engine.isSealed(r, c);
          const last = s.lastMove && s.lastMove.r === r && s.lastMove.c === c;
          const winCell = s.winLine && s.winLine.cells.some(t => t.r === r && t.c === c);
          const isFocus = focus && focus.r === r && focus.c === c;
          const star = (r === 5 || r === 14 || r === 10) && (c === 5 || c === 14 || c === 10);
          cell.className = 'cell'
            + (star ? ' is-star' : '')
            + (isTarget ? ' is-target' : '')
            + (isPlayable ? ' is-playable' : '')
            + (sealed ? ' is-sealed' : '')
            + (last ? ' is-last' : '')
            + (winCell ? ' is-win' : '')
            + (isFocus ? ' is-tutorial-focus' : '');
          cell.querySelector('.stone-layer').innerHTML = stone
            ? `<span class="stone ${stone.owner}${stone.doubled ? ' is-double' : ''}" aria-label="${stone.owner === 'player' ? '你的' : '墨鸦的'}星子"></span>`
            : '';
          cell.querySelector('.cell-mark').textContent = sealed ? '×' : isFocus ? '◎' : last ? '·' : '';
          cell.setAttribute('aria-label', `${this.coordName(r, c)} ${stone ? (stone.owner === 'player' ? '你的星子' : '墨鸦星子') : sealed ? '封锁' : '空'}`);
        }
      }
    }

    tutorialStep() {
      if (!this.tutorial || this.tutorial.mode === 'intro') return null;
      const chapter = TUTORIAL_CHAPTERS[this.tutorial.chapter];
      return chapter && chapter.stages[this.tutorial.stage] || null;
    }

    getPlayableCells() {
      if (this.tutorial) {
        if (this.tutorial.mode === 'intro') return [];
        const step = this.tutorialStep();
        return step && step.place ? [step.place] : [];
      }
      if (!this.engine || this.engine.state.current !== 'player' || this.busy) return [];
      return this.engine.getPlacementCells('player');
    }

    getTargets() {
      if (!this.selection || !this.engine || this.busy) return [];
      if (this.tutorial) {
        if (this.tutorial.mode === 'intro') return [];
        const step = this.tutorialStep();
        return step && step.target ? [step.target] : [];
      }
      const card = BY_ID[this.selection.cardId];
      if (!card) return [];
      if (card.target === 'cell') return this.engine.getCardTargets('player', card.id);
      if (card.target === 'stoneOwn') return this.engine.getCardTargets('player', card.id);
      if (card.target === 'moveOwn') {
        if (this.selection.stage === 'moveDest') {
          return this.engine.getMoveDestinations(this.selection.from.r, this.selection.from.c);
        }
        return this.engine.getCardTargets('player', card.id);
      }
      if (card.target === 'swap') {
        const all = this.engine.getCardTargets('player', card.id);
        if (this.selection.stage === 'swapSecond' && this.selection.first) {
          return all.filter(cell => cell.r !== this.selection.first.r || cell.c !== this.selection.first.c);
        }
        return all;
      }
      return [];
    }

    tutorialFocus() {
      const step = this.tutorialStep();
      if (!step) return null;
      return step.target || step.place || null;
    }

    tutorialRequiredCard() {
      const step = this.tutorialStep();
      return step && step.card ? step.card : null;
    }

    renderOpponent() {
      const s = this.engine.state;
      const a = s.players.ai;
      const avatar = this.dom.aiAvatar || this.dom.oppAvatar;
      if (avatar) {
        const isBoss = this.mode === 'boss';
        avatar.classList.toggle('is-boss', isBoss);
        avatar.textContent = isBoss ? '' : '✦';
      }
      const aiSeat = this.getSeatKind('ai');
      if (aiSeat === 'llm') {
        this.dom.aiModeLabel.textContent = `云端 · ${this.llmConfig.ai?.model || '未配置'}`;
        this.dom.aiModeLabel.hidden = false;
      } else {
        this.dom.aiModeLabel.textContent = '';     // 难度只在顶栏徽章上标，名字下面不重复
        this.dom.aiModeLabel.hidden = true;
      }
      if (this.dom.bossHpBox) {
        const boss = s.boss;
        this.dom.bossHpBox.hidden = !boss;
        if (boss) {
          if (this.dom.bossHp) {
            this.dom.bossHp.textContent = '◆'.repeat(Math.max(0, boss.hp)) + '◇'.repeat(Math.max(0, boss.maxHp - boss.hp));
          }
        }
      }
      this.dom.aiHandCount.textContent = a.hand.length;
      if (this.dom.aiRailCount) this.dom.aiRailCount.textContent = a.hand.length;
      if (this.dom.aiRailDeckCount) this.dom.aiRailDeckCount.textContent = a.deck.length;
      this.dom.aiManaText.textContent = `${a.mana}/${this.engine.rules.maxMana}`;
      this.dom.aiGoal.textContent = a.winTarget === 6 ? '六子' : '七子';
      if (a.silenced) this.dom.aiStatus.textContent = '被封锁 · 下一张牌失效';
      else if (s.current === 'ai') {
        this.dom.aiStatus.textContent = this.llmRunning ? '云端思考中…'
          : this.aiRunning ? '正在推演' : '墨鸦回合';
      }
      else this.dom.aiStatus.textContent = a.winTarget === 6 ? '六子连珠' : '静静等待';
    }

    renderMana() {
      const p = this.engine.state.players.player;
      if (this.dom.playerGoal) this.dom.playerGoal.textContent = p.winTarget === 6 ? '六子' : '七子';
      const max = this.engine.rules.maxMana;
      const pips = Math.max(max, Math.min(5, p.mana));
      this.dom.playerManaPips.innerHTML = Array.from({ length: pips }, (_, i) =>
        `<span class="stamina-pip${i < p.mana ? ' is-full' : ''}"></span>`).join('');
      this.dom.playerManaText.textContent = `${p.mana}/${max}`;
      this.dom.playerManaText.classList.toggle('is-low', p.mana === 0);
    }

    renderHand() {
      const s = this.engine.state;
      const hand = s.players.player.hand;
      this.dom.playerHandCount.textContent = hand.length;
      this.dom.playerHandCount.classList.toggle('is-over', hand.length > 4);
      this.dom.playerDeckCount.textContent = s.players.player.deck.length;
      this.dom.playerDiscardCount.textContent = s.players.player.discard.length;
      if (!hand.length) {
        this.dom.hand.classList.remove('is-targeting');
        this.dom.hand.innerHTML = '<span class="hand-empty">手牌已空</span>';
        return;
      }
      const tutorialCard = this.tutorial ? this.tutorialRequiredCard() : null;
      const canAct = s.current === 'player' && s.phase === 'main' && !this.busy && !this.aiRunning
        && this.getSeatKind('player') === 'human';
      const targetingHand = !!(this.selection
        && BY_ID[this.selection.cardId]
        && BY_ID[this.selection.cardId].target === 'handCard'
        && this.selection.stage === 'handTarget');
      this.dom.hand.classList.toggle('is-targeting', targetingHand);
      const html = hand.map((entry, index) => {
        const card = BY_ID[entry.id];
        if (!card) return '';
        const cost = this.engine.cardCost(entry);
        const blocked = !!this.tutorial && card.id !== tutorialCard;
        const selected = this.selection && this.selection.uid === entry.uid;
        const handTarget = targetingHand && !selected;
        const hint = !!this.tutorial && card.id === tutorialCard;
        const disabled = !canAct || blocked || s.players.player.mana < cost;
        return `<button class="card${selected ? ' is-selected' : ''}${handTarget ? ' is-hand-target' : ''}${disabled ? ' is-disabled' : ''}${hint ? ' is-tutorial-hint' : ''}${entry.discount ? ' is-discount' : ''}"
          type="button" data-uid="${entry.uid}" role="listitem"
          style="--accent:${card.accent};--i:${index}"
          aria-label="${card.name}，体力 ${cost}，${card.short}">
          <span class="card-cost">${cost}</span>
          <span class="card-art">${this.renderIcon(card)}</span>
          <span class="card-name">${card.name}</span>
          <span class="card-tag">${card.tag}</span>
          <span class="card-short">${escapeHtml(card.short)}</span>
          ${entry.discount ? '<span class="discount-mark">0</span>' : ''}
        </button>`;
      }).join('');
      this.dom.hand.innerHTML = html;
      this.dom.hand.scrollLeft = 0;
    }

    renderTip() {
      const uid = this.selection ? this.selection.uid : this.hoverCard;
      if (!uid || !this.engine) {
        this.dom.cardTip.hidden = true;
        this.dom.cardTip.classList.remove('is-inspector');
        return;
      }
      const entry = this.engine.state.players.player.hand.find(item => item.uid === uid);
      if (!entry) {
        this.dom.cardTip.hidden = true;
        this.dom.cardTip.classList.remove('is-inspector');
        return;
      }
      const card = BY_ID[entry.id];
      const cost = this.engine.cardCost(entry);
      const selected = !!this.selection && this.selection.uid === uid;
      const canPlay = selected && this.engine.state.status === 'playing'
        && this.engine.state.current === 'player' && !this.busy && !this.aiRunning;
      const action = selected
        ? (card.target === 'none'
          ? `<div class="tip-actions">
               <button type="button" class="pixel-btn primary" data-tip-action="play"${canPlay ? '' : ' disabled'}>发动</button>
               <button type="button" class="pixel-btn ghost" data-tip-action="cancel">取消</button>
             </div>`
          : `<div class="tip-actions tip-hint">${escapeHtml(CARD_LIB.TARGET_LABEL[card.target])} · ${card.target === 'handCard' ? '点击手牌' : '点击棋盘'}</div>`)
        : '';
      this.dom.cardTip.innerHTML = `
        <div class="tip-main">
          <span class="tip-art">${this.renderIcon(card)}</span>
          <div class="tip-copy">
            <div class="tip-name">${card.name}<span>${cost} 体力</span></div>
            <div class="tip-tag">${card.tag}</div>
            <p>${escapeHtml(card.desc)}</p>
          </div>
        </div>
        ${action}`;
      this.dom.cardTip.classList.toggle('is-inspector', selected);
      this.dom.cardTip.hidden = false;
    }

    renderActions() {
      const s = this.engine.state;
      const p = s.players.player;
      const canAct = s.status === 'playing' && s.current === 'player' && s.phase === 'main' && !this.busy && !this.aiRunning
        && this.getSeatKind('player') === 'human';
      const canEnd = canAct && s.placed && !this.selection;
      this.dom.endTurnBtn.disabled = !canEnd;
      this.dom.cancelBtn.hidden = !this.selection;
      this.dom.playBtn.hidden = !this.selection || BY_ID[this.selection.cardId]?.target !== 'none';
      this.dom.playBtn.disabled = !canAct;
      this.dom.phaseChip.textContent = s.phase === 'draft' ? '补给' : s.placed ? '已落子' : '可落子';
      this.dom.phaseChip.className = `phase-chip ${s.phase === 'draft' ? 'is-draft' : s.placed ? 'is-placed' : 'is-open'}`;
      if (s.status !== 'playing') {
        this.dom.actionHint.textContent = '对局已经结束。';
        this.dom.boardHint.textContent = '终局';
      } else if (s.phase === 'draft') {
        this.dom.actionHint.textContent = '先从 4 张补给中选择 2 张。';
        this.dom.boardHint.textContent = '补给 · 4 选 2';
      } else if (s.current === 'ai') {
        this.dom.actionHint.textContent = '墨鸦正在行动……';
        this.dom.boardHint.textContent = '对手回合';
      } else if (this.selection) {
        const card = BY_ID[this.selection.cardId];
        if (card.target === 'handCard') {
          this.dom.actionHint.textContent = '选择另一张手牌，使其费用变为 0。';
          this.dom.boardHint.textContent = '省力 · 选择手牌';
        } else if (card.target === 'swap') {
          this.dom.actionHint.textContent = this.selection.stage === 'swapSecond' ? '选择第二枚棋子。' : '选择第一枚棋子。';
          this.dom.boardHint.textContent = '换影 · 两枚棋子';
        } else if (card.target === 'moveOwn') {
          this.dom.actionHint.textContent = this.selection.stage === 'moveDest' ? '选择周围八格中的空格。' : '选择一枚己方星子。';
          this.dom.boardHint.textContent = '挪星步';
        } else if (card.target === 'none') {
          this.dom.actionHint.textContent = `已选【${card.name}】，点击“发动”。`;
          this.dom.boardHint.textContent = '确认发动';
        } else {
          this.dom.actionHint.textContent = `已选【${card.name}】，点击目标格。`;
          this.dom.boardHint.textContent = '选择目标';
        }
      } else if (s.placed) {
        this.dom.actionHint.textContent = '本回合已落子。可以双击手牌发动，或结束回合。';
        this.dom.boardHint.textContent = '双击手牌发动 · 左键落子';
      } else if (p.mana > 0) {
        this.dom.actionHint.textContent = '双击手牌发动；也可直接点棋盘落子。';
        this.dom.boardHint.textContent = '双击手牌发动 · 左键落子';
      } else {
        this.dom.actionHint.textContent = '体力耗尽。点棋盘落子，然后结束回合。';
        this.dom.boardHint.textContent = '请落子';
      }
      if (s.players.player.silenced) {
        this.dom.boardHint.textContent = '封锁：你的下一张牌会失效。';
      }
      if (p.hand.length > 4) {
        this.dom.actionHint.textContent = `手牌 ${p.hand.length} 张，结束回合前需弃到 4 张。`;
      }
    }

    renderLogs() {
      this.dom.logStrip.innerHTML = this.logs.slice(-4).map(item =>
        `<span class="log-item ${item.side}">${item.text}</span>`).join('');
    }

    addLog(text, side = 'system') {
      this.logs.push({ text, side });
      if (this.logs.length > 20) this.logs.shift();
      this.renderLogs();
    }

    showCardShowcase(cardId) {
      const card = BY_ID[cardId];
      const build = CARD_FX[cardId];
      if (!card || !build || !this.dom.fxBody) return;
      this.showcaseCardId = cardId;
      this.dom.fxCardName.textContent = card.name;
      this.dom.fxLoopBadge.hidden = false;
      this.dom.fxBody.innerHTML = `<div class="fx-stage" data-fx="${card.id}">${build()}</div>`;
    }

    hideCardShowcase() {
      if (!this.dom.fxBody) return;
      if (!this.showcaseCardId) return;
      this.showcaseCardId = null;
      this.dom.fxCardName.textContent = '待选';
      this.dom.fxLoopBadge.hidden = true;
      this.dom.fxBody.innerHTML = `<div class="fx-idle">
        <span class="fx-idle-glyph">✦</span>
        <b>选中手牌</b>
        <small>在此循环预览卡牌效果</small>
      </div>`;
    }

    syncCardShowcase() {
      const cardId = this.selection && this.selection.cardId;
      if (!cardId) {
        this.hideCardShowcase();
        return;
      }
      if (this.showcaseCardId !== cardId) this.showCardShowcase(cardId);
    }

    activateHandCard(uid) {
      if (!this.engine || this.busy || this.engine.state.phase !== 'main') return;
      if (this.engine.state.current !== 'player') return;
      const entry = this.engine.state.players.player.hand.find(item => item.uid === uid);
      if (!entry) return;
      const card = BY_ID[entry.id];
      if (!card) return;
      if (!this.selection || this.selection.uid !== uid) {
        this.selectCard(uid);
      }
      if (!this.selection || this.selection.uid !== uid) return;
      if (card.target === 'none') {
        this.playSelected({});
        return;
      }
      this.toast(`双击选中【${card.name}】· 请点击${CARD_LIB.TARGET_LABEL[card.target]}`, 'player');
    }

    onHandCardClick(uid) {
      if (this.getSeatKind('player') !== 'human') return;

      if (!this.engine || this.busy || this.engine.state.phase !== 'main') return;
      if (this.engine.state.current !== 'player') return;
      if (this.selection && this.selection.cardId === 'discount' && this.selection.stage === 'handTarget') {
        if (uid !== this.selection.uid) this.playSelected({ uid });
        return;
      }
      if (this.tutorial) {
        const required = this.tutorialRequiredCard();
        const entry = this.engine.state.players.player.hand.find(item => item.uid === uid);
        if (!entry || !required || entry.id !== required) {
          this.toast('教程：先完成当前步骤。', 'gold');
          return;
        }
      }
      this.selectCard(uid);
    }

    selectCard(uid) {
      if (!this.engine) return;
      const s = this.engine.state;
      const entry = s.players.player.hand.find(item => item.uid === uid);
      if (!entry) return;
      const card = BY_ID[entry.id];
      this.hoverCard = null;
      if (this.selection && this.selection.uid === uid) {
        this.cancelSelection();
        return;
      }
      const can = this.engine.canPlayCard('player', uid);
      if (!can.ok) {
        this.playSound('deny');
        this.toast(can.reason, 'danger');
        return;
      }
      if (this.tutorial) {
        const required = this.tutorialRequiredCard();
        if (!required || card.id !== required) {
          this.playSound('deny');
          this.toast('教程：先完成当前步骤。', 'gold');
          return;
        }
      }
      let stage = 'target';
      if (card.target === 'none') stage = 'ready';
      if (card.target === 'handCard') stage = 'handTarget';
      if (card.target === 'moveOwn') stage = 'movePiece';
      if (card.target === 'swap') stage = 'swapFirst';
      this.selection = { uid, cardId: card.id, stage };
      if (card.target === 'moveOwn') this.selection.from = null;
      if (card.target === 'swap') this.selection.first = null;
      this.renderAll();
      if (card.target !== 'none') {
        this.toast(`已选【${card.name}】· ${CARD_LIB.TARGET_LABEL[card.target]}`, 'player');
      }
    }

    cancelSelection() {
      if (!this.selection) return;
      this.selection = null;
      this.renderAll();
    }

    onBoardClick(r, c) {
      if (this.getSeatKind('player') !== 'human') return;

      if (!this.engine || this.busy) return;
      if (this.tutorial) {
        this.onTutorialBoardClick(r, c);
        return;
      }
      const s = this.engine.state;
      if (s.status !== 'playing' || s.current !== 'player' || s.phase !== 'main') return;
      if (this.selection) {
        const card = BY_ID[this.selection.cardId];
        const targets = this.getTargets();
        const hit = targets.some(cell => cell.r === r && cell.c === c);
        if (card.target === 'cell' || card.target === 'stoneOwn') {
          if (!hit) { this.playSound('deny'); this.toast('这个目标不符合术式条件。', 'danger'); return; }
          this.playSelected({ r, c });
          return;
        }
        if (card.target === 'moveOwn') {
          if (this.selection.stage === 'movePiece') {
            if (!hit) { this.playSound('deny'); this.toast('请选择己方星子。', 'danger'); return; }
            this.selection.from = { r, c };
            this.selection.stage = 'moveDest';
            this.renderAll();
            return;
          }
          if (!hit) { this.playSound('deny'); this.toast('目标格不可移动。', 'danger'); return; }
          this.playSelected({ from: { ...this.selection.from }, to: { r, c } });
          return;
        }
        if (card.target === 'swap') {
          if (!hit) { this.playSound('deny'); this.toast('请选择棋盘上的棋子。', 'danger'); return; }
          if (this.selection.stage === 'swapFirst') {
            this.selection.first = { r, c };
            this.selection.stage = 'swapSecond';
            this.renderAll();
            return;
          }
          this.playSelected({ first: { ...this.selection.first }, second: { r, c } });
          return;
        }
        this.playSound('deny');
        this.toast('这张牌不需要棋盘目标。', 'danger');
        return;
      }
      this.placeStone(r, c);
    }

    onBoardRightClick(r, c) {
      if (!this.engine || this.busy || this.selection) return;
      if (this.tutorial) return;
      const s = this.engine.state;
      if (s.status !== 'playing' || s.current !== 'player' || s.phase !== 'main') return;
      this.placeStone(r, c);
    }

    placeStone(r, c) {
      const result = this.engine.place('player', r, c);
      if (!result.ok) {
        this.playSound('deny');
        this.toast(result.reason || '无法落子', 'danger');
        return;
      }
      this.selection = null;
      this.renderAll();
      if (this.tutorial && this.tutorial.mode === 'guided') {
        const step = this.tutorialStep();
        if (step && step.place && r === step.place.r && c === step.place.c && step.next) {
          this.tutorial.stage = step.next;
          this.updateTutorialHud();
          this.renderAll();
        }
      }
    }

    playSelected(payload) {
      if (!this.engine || !this.selection || this.busy) return;
      const { uid, cardId } = this.selection;
      const card = BY_ID[cardId];
      const result = this.engine.playCard('player', uid, payload);
      if (!result.ok) {
        this.playSound('deny');
        this.toast(result.reason || '术式发动失败', 'danger');
        return;
      }
      this.selection = null;
      this.renderAll();
      if (result.nullified) {
        this.toast('封锁！这张牌失效了', 'danger');
        return;
      }
      if (this.tutorial && this.tutorial.mode === 'guided') {
        this.tutorial.cardsPlayed = (this.tutorial.cardsPlayed || 0) + 1;
        const step = this.tutorialStep();
        if (step && step.card === card.id && step.next) {
          this.tutorial.stage = step.next;
          this.updateTutorialHud();
          this.renderAll();
        }
      }
    }

    endPlayerTurn() {
      if (this.getSeatKind('player') !== 'human') return;

      if (!this.engine || this.busy) return;
      const s = this.engine.state;
      if (s.current !== 'player' || s.phase !== 'main') return;
      if (this.tutorial && this.tutorial.stage !== 'end') {
        this.playSound('deny');
        this.toast('教程：先完成当前步骤。', 'gold');
        return;
      }
      if (!s.placed) {
        this.playSound('deny');
        this.toast('本回合必须落一子。', 'danger');
        return;
      }
      this.selection = null;
      this.hoverCard = null;
      if (this.tutorial) {
        this.playSound('turnEnd');
        this.runTutorialAI();
        return;
      }
      if (s.players.player.hand.length > 4) {
        this.openDiscard();
        return;
      }
      this.doEndTurn();
    }

    doEndTurn() {
      const result = this.engine.endTurn('player');
      if (!result.ok) {
        this.playSound('deny');
        this.toast(result.reason, 'danger');
        return;
      }
      this.selection = null;
      this.hoverCard = null;
      this.renderAll();
      if (this.tutorial) this.runTutorialAI();
      else this.maybeDriveTurn();
    }

    openDiscard() {
      this.playSound('modal');
      const p = this.engine.state.players.player;
      this.discardPicks = new Set();
      this.dom.discardHint.textContent = `当前 ${p.hand.length} 张，请弃置 ${p.hand.length - 4} 张。`;
      this.renderDiscard();
      this.dom.discardScreen.hidden = false;
    }

    renderDiscard() {
      const p = this.engine.state.players.player;
      const need = p.hand.length - 4;
      this.dom.discardGrid.innerHTML = p.hand.map(entry => {
        const card = BY_ID[entry.id];
        const picked = this.discardPicks.has(entry.uid);
        return `<button type="button" class="offer-card${picked ? ' is-picked' : ''}" data-discard-uid="${entry.uid}" style="--accent:${card.accent}">
          <span class="offer-art">${this.renderIcon(card)}</span>
          <b>${card.name}</b><small>${this.engine.cardCost(entry)} 体力 · ${card.tag}</small>
        </button>`;
      }).join('');
      this.dom.discardCounter.textContent = `已选择 ${this.discardPicks.size} / ${need}`;
      this.dom.discardConfirm.disabled = this.discardPicks.size !== need;
    }

    toggleDiscardPick(uid) {
      const p = this.engine.state.players.player;
      const need = p.hand.length - 4;
      if (this.discardPicks.has(uid)) this.discardPicks.delete(uid);
      else if (this.discardPicks.size < need) this.discardPicks.add(uid);
      this.renderDiscard();
    }

    confirmDiscard() {
      const p = this.engine.state.players.player;
      const need = p.hand.length - 4;
      if (this.discardPicks.size !== need) return;
      const result = this.engine.discard('player', [...this.discardPicks]);
      if (!result.ok) {
        this.toast(result.reason, 'danger');
        return;
      }
      this.dom.discardScreen.hidden = true;
      this.playSound('modal', { delay: 80 });
      this.doEndTurn();
    }

    openOffer(cards) {
      this.playSound('modal');
      this.playSound('offer', { delay: 70 });
      this.offerIsTutorial = false;
      this.offerCards = cards;
      this.offerPickLimit = Math.min(2, cards.length);
      this.offerPicks = new Set();
      this.offerBaseHint = '单击卡牌选择，再次单击取消选择；选满 2 张后点击确认。';
      this.dom.offerTitle.textContent = '补给 · 4 选 2';
      this.dom.offerDesc.textContent = '选择 2 张加入手牌，剩下的会进入弃牌堆。';
      this.dom.offerDesc.hidden = false;
      this.dom.offerHint.hidden = false;
      this.renderOffer();
      this.dom.offerScreen.hidden = false;
    }

    openTutorialDraft() {
      this.playSound('modal');
      this.playSound('offer', { delay: 70 });
      if (!this.tutorial) return;
      this.offerIsTutorial = true;
      this.offerCards = ['sealOrtho', 'sealAll', 'charge', 'twin']
        .map((id, index) => ({ uid: `tut-draft-${index}`, id }));
      this.offerPickLimit = 2;
      this.offerPicks = new Set();
      this.offerBaseHint = '';
      this.dom.offerTitle.textContent = '教程补给 · 4 选 2';
      this.dom.offerDesc.textContent = '';
      this.dom.offerDesc.hidden = true;
      this.dom.offerHint.textContent = '';
      this.dom.offerHint.hidden = true;
      this.tutorial.draft = true;
      this.tutorial.draftShown = true;
      this.renderOffer();
      this.dom.offerScreen.hidden = false;
    }

    renderOffer() {
      this.dom.offerGrid.innerHTML = this.offerCards.map((entry, index) => {
        const card = BY_ID[entry.id];
        const picked = this.offerPicks.has(index);
        return `<button type="button" class="offer-card${picked ? ' is-picked' : ''}" data-offer-index="${index}" style="--accent:${card.accent}">
          <span class="offer-art">${this.renderIcon(card)}</span>
          <b>${card.name}</b><small>${card.cost} 体力 · ${card.tag}</small>
          <span class="offer-short">${escapeHtml(card.short)}</span>
        </button>`;
      }).join('');
      this.dom.offerCounter.textContent = `已选择 ${this.offerPicks.size} / ${this.offerPickLimit}`;
      this.dom.offerConfirm.disabled = this.offerPicks.size !== this.offerPickLimit;
      if (!this.offerIsTutorial) {
        this.dom.offerHint.textContent = this.offerBaseHint;
      }
    }

    handleOfferClick(index) {
      if (this.getSeatKind('player') !== 'human') return;

      if (index < 0 || index >= this.offerCards.length) return;
      if (this.offerPicks.has(index)) {
        this.offerPicks.delete(index);
      } else if (this.offerPicks.size < this.offerPickLimit) {
        this.offerPicks.add(index);
      }
      this.renderOffer();
    }

    confirmOffer() {
      if (this.offerPicks.size !== this.offerPickLimit) return;
      if (this.offerIsTutorial) {
        this.dom.offerScreen.hidden = true;
        this.playSound('draftPick');
        this.playSound('modal', { delay: 80 });
        this.offerIsTutorial = false;
        if (this.tutorial) {
          this.tutorial.draft = false;
          this.renderAll();
          this.updateTutorialHud();
          this.addLog('教程补给完成。', 'system');
          this.toast('补给完成 · 开始第 1 章', 'gold');
        }
        return;
      }
      const result = this.engine.chooseOffer([...this.offerPicks]);
      if (!result.ok) {
        this.toast(result.reason, 'danger');
        return;
      }
      this.dom.offerScreen.hidden = true;
      this.playSound('modal', { delay: 80 });
      this.renderAll();
    }

    /* ---------------- LLM 座位 ---------------- */

    loadLLMConfig() {
      try {
        const raw = localStorage.getItem(LLM_STORE);
        const data = raw ? JSON.parse(raw) : {};
        return {
          player: data.player || null,
          ai: data.ai || null
        };
      } catch (err) {
        return { player: null, ai: null };
      }
    }

    saveLLMConfig(config) {
      this.llmConfig = { player: config.player, ai: config.ai };
      try { localStorage.setItem(LLM_STORE, JSON.stringify(this.llmConfig)); } catch (err) { /* 隐私模式下写不了就算了 */ }
    }

    // 标题屏背景 + 墨鸦卡背跟着模式换
    applyArt(mode) {
      const art = MODE_ART[mode] || 'middle';
      const url = `url('assets/bg/${art}.webp')`;
      if (this.dom.titleArt) this.dom.titleArt.style.setProperty('--title-art', url);
      if (this.dom.oppDeckPanel) this.dom.oppDeckPanel.style.setProperty('--card-art', url);
      if (this.dom.modeBadge) {
        const label = MODE_LABEL[mode] || MODE_LABEL.normal;
        this.dom.modeBadge.textContent = label;
        this.dom.modeBadge.className = `mode-badge${mode === 'boss' ? ' is-boss' : ''}${mode === 'llm' || mode === 'llmpk' ? ' is-llm' : ''}`;
      }
    }

    getSeatKind(side) {
      return (this.seatKind && this.seatKind[side]) || 'human';
    }

    llmReady(side) {
      const cfg = this.llmConfig[side];
      return !!(cfg && cfg.baseURL && cfg.model && cfg.apiKey);
    }

    // 轮到谁：本地 AI 就走 AI，云端就走 LLM，人类就等点击
    maybeDriveTurn() {
      if (!this.engine || this.abandoned || this.resultShown) return;
      const s = this.engine.state;
      if (s.status !== 'playing') return;
      const kind = this.getSeatKind(s.current);
      if (kind === 'ai') this.runAI();
      else if (kind === 'llm') this.runLLMTurn(s.current);
    }

    async runLLMTurn(side) {
      if (this.llmRunning || !this.engine) return;
      const cfg = this.llmConfig[side];
      if (!cfg || !cfg.baseURL || !cfg.model || !cfg.apiKey) {
        this.openLLMSettings();
        this.toast('先填好 LLM 的接口和密钥', 'danger');
        return;
      }
      const session = this.sessionId;
      const label = side === 'player' ? '星火' : '墨鸦';
      const seat = new window.SevenfoldLLM.LLMSeat(this.engine, side, cfg);
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      this.llmRunning = true;
      this.busy = true;
      this.llmError = null;
      this.dom.llmError.hidden = true;
      this.renderAll();
      try {
        // 补给（只有玩家侧会进 draft 阶段）
        if (this.engine.state.phase === 'draft' && this.engine.state.offer) {
          const draft = await seat.decideDraft();
          if (session !== this.sessionId) return;
          const res = this.engine.chooseOffer(draft.picks);
          if (!res.ok) throw new window.SevenfoldLLM.LLMError('illegal', res.reason);
          await sleep(420);
        }
        const plan = await seat.decideTurn();
        if (session !== this.sessionId) return;
        this.addLog(`${label}（${cfg.model}）：${plan.why || '（没写理由）'}`, side);
        for (const card of plan.cards) {
          if (this.engine.state.status !== 'playing') break;
          const res = this.engine.playCard(side, card.uid, card.payload);
          if (!res.ok) throw new window.SevenfoldLLM.LLMError('illegal', `引擎拒绝了 ${card.id}：${res.reason}`);
          await sleep(620);
        }
        if (this.engine.state.status === 'playing' && plan.place) {
          const res = this.engine.place(side, plan.place.r, plan.place.c);
          if (!res.ok) throw new window.SevenfoldLLM.LLMError('illegal', `落子被拒：${res.reason}`);
          await sleep(420);
        }
        if (this.engine.state.status === 'playing') {
          const p = this.engine.state.players[side];
          const limit = this.engine.rules.handLimit;
          if (p.hand.length > limit) {
            const need = p.hand.length - limit;
            const want = (plan.discard || []).filter(uid => p.hand.some(entry => entry.uid === uid));
            for (const entry of p.hand) {
              if (want.length >= need) break;
              if (!want.includes(entry.uid)) want.push(entry.uid);
            }
            this.engine.discard(side, want.slice(0, need));
          }
          this.engine.endTurn(side);
        }
      } catch (err) {
        if (session === this.sessionId) this.showLLMError(side, err);
      } finally {
        if (session === this.sessionId) {
          this.llmRunning = false;
          this.busy = false;
          this.renderAll();
          if (!this.llmError) this.maybeDriveTurn();
        }
      }
    }

    showLLMError(side, err) {
      const label = side === 'player' ? '星火' : '墨鸦';
      const code = err && err.code ? err.code : 'unknown';
      const titles = {
        config: '配置不完整',
        network: '连不上模型',
        http: '接口返回错误',
        parse: '输出解析失败',
        illegal: '模型下出了非法的一步',
        unknown: '出了点问题'
      };
      this.llmError = { side, code, message: err && err.message ? err.message : String(err) };
      this.dom.llmErrorTitle.textContent = `${label} · ${titles[code] || titles.unknown}`;
      this.dom.llmErrorText.textContent = this.llmError.message + (err && err.detail ? `\n${String(err.detail).slice(0, 200)}` : '');
      this.dom.llmError.hidden = false;
      this.playSound('deny');
      this.addLog(`${label} 出错：${this.llmError.message}`, 'system');
    }

    retryLLM() {
      this.dom.llmError.hidden = true;
      this.llmError = null;
      this.maybeDriveTurn();
    }

    abortLLM() {
      if (this.sound) this.sound.stopBgm({ fade: 600 });
      this.dom.llmError.hidden = true;
      this.llmError = null;
      this.abandoned = true;
      this.aiRunning = false;
      this.llmRunning = false;
      this.busy = false;
      this.addLog('LLM 掉线，本局中止。', 'system');
      this.toast('本局中止', 'danger');
      this.renderAll();
    }

    openLLMSettings(focus = []) {
      const LLM = window.SevenfoldLLM;
      if (!LLM) return;
      const presets = LLM.PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      const seatForm = (side, title, hint) => {
        const cfg = this.llmConfig[side] || {};
        return `
        <section class="llm-seat" data-seat="${side}">
          <header><b>${title}</b><small>${hint}</small></header>
          <label class="llm-field"><span>服务商</span>
            <select data-preset="${side}">${presets}</select>
          </label>
          <label class="llm-field"><span>Base URL</span>
            <input data-base="${side}" value="${escapeHtml(cfg.baseURL || '')}" placeholder="https://api.deepseek.com/v1" spellcheck="false">
          </label>
          <label class="llm-field"><span>模型</span>
            <input data-model="${side}" value="${escapeHtml(cfg.model || '')}" placeholder="deepseek-chat" spellcheck="false">
          </label>
          <label class="llm-field"><span>API Key</span>
            <input data-key="${side}" type="password" value="${escapeHtml(cfg.apiKey || '')}" placeholder="sk-..." spellcheck="false" autocomplete="off">
          </label>
          <label class="llm-check"><input type="checkbox" data-thinking="${side}" ${cfg.thinking ? 'checked' : ''}> 开启思考模式（更慢，更容易被截断）</label>
          <div class="llm-seat-actions">
            <button type="button" data-test="${side}">测试连接</button>
            <span class="llm-status" data-status="${side}"></span>
          </div>
        </section>`;
      };
      this.dom.modalKicker.textContent = 'LLM SEATS';
      this.dom.modalTitle.textContent = 'LLM 对战设置';
      this.dom.modalBody.innerHTML = `
        <p class="llm-warn">密钥只存在你这台机器的浏览器里（localStorage），不会上传到任何服务器；但 GitHib Pages 是公开页面，别把密钥分享给别人。</p>
        <div class="llm-form">
          ${seatForm('player', '星火（你 / 左）', '人 vs LLM 时用不到这一栏')}
          ${seatForm('ai', '墨鸦（对面 / 右）', '人 vs LLM / LLM 对战都要填')}
        </div>
        <p class="llm-note">浏览器直连需要服务商返回 CORS 头：DeepSeek / MiniMax / 小米可用，智谱直连会被浏览器拦。</p>
        <div class="llm-form-actions">
          <button type="button" id="llmSaveBtn">保存</button>
          <span class="llm-status" id="llmSaveHint"></span>
        </div>`;
      this.dom.modal.hidden = false;
      this.playSound('modal');
      this.bindLLMForm();
      if (focus.length) {
        const first = focus[0];
        const input = this.dom.modalBody.querySelector(`[data-base="${first}"]`);
        if (input) input.focus();
      }
    }

    bindLLMForm() {
      const LLM = window.SevenfoldLLM;
      const body = this.dom.modalBody;
      body.querySelectorAll('[data-preset]').forEach(select => {
        const side = select.dataset.preset;
        const cfg = this.llmConfig[side];
        if (cfg && cfg.preset) select.value = cfg.preset;
        select.addEventListener('change', () => {
          const preset = LLM.PRESETS.find(p => p.id === select.value);
          if (!preset) return;
          const base = body.querySelector(`[data-base="${side}"]`);
          const model = body.querySelector(`[data-model="${side}"]`);
          if (base && preset.baseURL) base.value = preset.baseURL;
          if (model && preset.model) model.value = preset.model;
        });
      });
      body.querySelectorAll('[data-test]').forEach(btn => {
        const side = btn.dataset.test;
        btn.addEventListener('click', async () => {
          const status = body.querySelector(`[data-status="${side}"]`);
          const cfg = this.readLLMSeat(side);
          if (!cfg.baseURL || !cfg.apiKey) {
            status.textContent = '先填 Base URL 和密钥';
            status.className = 'llm-status is-bad';
            return;
          }
          btn.disabled = true;
          status.textContent = '连接中…';
          status.className = 'llm-status';
          try {
            const models = await LLM.listModels({ baseURL: cfg.baseURL, apiKey: cfg.apiKey });
            status.textContent = `连上了，${models.length} 个模型可用（${models.slice(0, 3).join(' / ')}${models.length > 3 ? ' …' : ''}）`;
            status.className = 'llm-status is-good';
          } catch (err) {
            status.textContent = (err.message || '连不上') + (err.code === 'network' ? '（可能是 CORS 或地址不对）' : '');
            status.className = 'llm-status is-bad';
          } finally {
            btn.disabled = false;
          }
        });
      });
      const saveBtn = body.querySelector('#llmSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const next = { player: this.readLLMSeat('player'), ai: this.readLLMSeat('ai') };
          this.saveLLMConfig(next);
          const hint = body.querySelector('#llmSaveHint');
          if (hint) { hint.textContent = '已保存'; hint.className = 'llm-status is-good'; }
          this.dom.modal.hidden = true;
          this.applyArt('normal');
      this.renderLLMState();
          this.toast('LLM 设置已保存', 'player');
        });
      }
    }

    readLLMSeat(side) {
      const body = this.dom.modalBody;
      const q = sel => body.querySelector(`[data-${sel}="${side}"]`);
      const presetEl = q('preset');
      return {
        preset: presetEl ? presetEl.value : 'custom',
        baseURL: (q('base')?.value || '').trim(),
        model: (q('model')?.value || '').trim(),
        apiKey: (q('key')?.value || '').trim(),
        thinking: !!(q('thinking') && q('thinking').checked)
      };
    }

    renderLLMState() {
      const el = this.dom.llmSettingsState;
      if (!el) return;
      const ready = [this.llmReady('player'), this.llmReady('ai')].filter(Boolean).length;
      el.textContent = ready === 2 ? '两台已配置' : ready === 1 ? '一台已配置' : '未配置';
    }

    async runAI() {
      if (!this.engine || !this.ai || this.aiRunning) return;
      const s = this.engine.state;
      if (s.status !== 'playing' || s.current !== 'ai') return;
      const session = this.sessionId;
      this.aiRunning = true;
      this.busy = true;
      this.renderAll();
      try {
        await this.ai.takeTurn({
          onAction: event => this.showEnemyAction(event, session)
        });
      } finally {
        if (session !== this.sessionId) return;
        this.aiRunning = false;
        this.busy = false;
        this.hideEnemyAction();
        this.renderAll();
      }
    }

    hideEnemyAction() {
      if (this.dom.enemyAction) this.dom.enemyAction.hidden = true;
      document.querySelectorAll('.cell.is-enemy-fx, .cell.is-enemy-danger, .cell.is-enemy-seal, .cell.is-ai-drop')
        .forEach(cell => cell.classList.remove('is-enemy-fx', 'is-enemy-danger', 'is-enemy-seal', 'is-ai-drop'));
      this.dom.board.classList.remove('is-enemy-glow');
    }

    async showEnemyAction(event, session) {
      if (!event || this.abandoned || session !== this.sessionId) return;
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const el = this.dom.enemyAction;
      if (!el) return;
      const card = event.cardId ? BY_ID[event.cardId] : null;
      const delay = 2000;
      if (event.type === 'start') {
        this.dom.enemyActionKicker.textContent = '墨鸦回合';
        this.dom.enemyActionArt.textContent = '✦';
        this.dom.enemyActionArt.className = 'enemy-action-art';
        this.dom.enemyActionTitle.textContent = `抽取 ${this.engine.rules.draftPick} 张`;
        this.dom.enemyActionMeta.textContent = `手牌 ${event.hand} · 体力 ${event.mana}/4`;
        this.dom.enemyActionText.textContent = '墨鸦开始行动，观察它接下来的每一步。';
      } else if (event.type === 'card' && card) {
        this.dom.enemyActionKicker.textContent = event.result?.nullified ? '术式被封锁' : '墨鸦发动卡牌';
        this.dom.enemyActionArt.innerHTML = this.renderIcon(card);
        this.dom.enemyActionArt.className = 'enemy-action-art is-card';
        this.dom.enemyActionArt.style.setProperty('--accent', card.accent);
        this.dom.enemyActionTitle.textContent = card.name;
        this.dom.enemyActionMeta.textContent = `${card.cost} 体力 · 剩余 ${event.mana}/4`;
        this.dom.enemyActionText.textContent = event.result?.nullified ? '卡牌效果被封锁，白白消耗体力。' : card.desc;
        this.highlightEnemyEffect(event.cardId, event.result);
      } else if (event.type === 'place') {
        this.dom.enemyActionKicker.textContent = '墨鸦落子';
        this.dom.enemyActionArt.textContent = '✦';
        this.dom.enemyActionArt.className = 'enemy-action-art';
        this.dom.enemyActionTitle.textContent = this.coordName(event.r, event.c);
        this.dom.enemyActionMeta.textContent = '棋盘位置';
        this.dom.enemyActionText.textContent = `墨鸦在 ${this.coordName(event.r, event.c)} 放置了一枚星子。`;
        this.markEnemyCells([{ r: event.r, c: event.c }], 'is-enemy-fx');
        const dropCell = this.dom.board.querySelector(`.cell[data-r="${event.r}"][data-c="${event.c}"]`);
        if (dropCell) {
          dropCell.classList.add('is-ai-drop');
          setTimeout(() => dropCell.classList.remove('is-ai-drop'), 700);
        }
      } else if (event.type === 'discard') {
        this.dom.enemyActionKicker.textContent = '墨鸦弃牌';
        this.dom.enemyActionArt.textContent = '▤';
        this.dom.enemyActionArt.className = 'enemy-action-art';
        this.dom.enemyActionTitle.textContent = `弃置 ${event.cards.length} 张`;
        this.dom.enemyActionMeta.textContent = '手牌调整';
        this.dom.enemyActionText.textContent = event.cards.map(id => BY_ID[id]?.name).filter(Boolean).join('、');
      } else if (event.type === 'end') {
        this.dom.enemyActionKicker.textContent = '墨鸦结束回合';
        this.dom.enemyActionArt.textContent = '◇';
        this.dom.enemyActionArt.className = 'enemy-action-art';
        this.dom.enemyActionTitle.textContent = '回合结束';
        this.dom.enemyActionMeta.textContent = `剩余手牌 ${event.cardCount}`;
        this.dom.enemyActionText.textContent = '墨鸦收手，准备把回合交给你。';
      } else {
        return;
      }
      // 对手每一步固定停留 2 秒，保证玩家能看清卡牌与棋盘效果。
      el.hidden = false;
      await wait(delay);
      if (this.abandoned || session !== this.sessionId) return;
      el.hidden = true;
      this.dom.board.classList.remove('is-enemy-glow');
      document.querySelectorAll('.cell.is-enemy-fx, .cell.is-enemy-danger, .cell.is-enemy-seal, .cell.is-ai-drop')
        .forEach(cell => cell.classList.remove('is-enemy-fx', 'is-enemy-danger', 'is-enemy-seal', 'is-ai-drop'));
    }

    markEnemyCells(cells, cls) {
      for (const { r, c } of cells || []) {
        const cell = this.dom.board.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
        if (cell) cell.classList.add(cls);
      }
    }

    highlightEnemyEffect(cardId, result) {
      if (!result) return;
      const mark = (cells, cls = 'is-enemy-fx') => this.markEnemyCells(cells || [], cls);
      if (result.removed) mark(result.removed, 'is-enemy-danger');
      if (result.sealed) mark(result.sealed, 'is-enemy-seal');
      if (result.converted) mark(result.converted, 'is-enemy-fx');
      if (result.first && result.second) mark([result.first, result.second], 'is-enemy-fx');
      if (result.from && result.to) mark([result.from, result.to], 'is-enemy-fx');
      if (result.stone) mark([result.stone], 'is-enemy-fx');
      if (cardId === 'sixwin' || cardId === 'silence' || cardId === 'extra') {
        this.dom.board.classList.add('is-enemy-glow');
      }
    }

    onTutorialBoardClick(r, c) {
      if (!this.tutorial || this.tutorial.mode === 'intro') return;
      const step = this.tutorialStep();
      const stage = this.tutorial.stage;
      if (!step) return;
      if (step.place) {
        if (r === step.place.r && c === step.place.c) this.placeStone(r, c);
        else this.toast(`教程：请点击 ${this.coordName(step.place.r, step.place.c)}。`, 'gold');
        return;
      }
      if (step.target) {
        if (!this.selection) {
          this.toast(`教程：先双击【${BY_ID[step.card]?.name || '指定卡牌'}】。`, 'gold');
          return;
        }
        if (r !== step.target.r || c !== step.target.c) {
          this.toast(`教程：目标在 ${this.coordName(step.target.r, step.target.c)}。`, 'gold');
          return;
        }
        if (stage === 'shiftFrom') {
          this.tutorial.from = { r, c };
          this.tutorial.stage = step.next;
          this.updateTutorialHud();
          this.renderAll();
          this.toast('已选起点 · 现在选择落点', 'gold');
          return;
        }
        if (stage === 'shiftTo') {
          this.playSelected({ from: { ...this.tutorial.from }, to: { r, c } });
          return;
        }
        this.playSelected({ r, c });
        return;
      }
      this.toast('教程：双击手牌或点“发动”，再按顶部提示操作。', 'gold');
    }

    updateTutorialHud() {
      if (!this.tutorial) {
        this.dom.tutorialHud.hidden = true;
        return;
      }
      document.querySelectorAll('.is-intro-focus').forEach(el => el.classList.remove('is-intro-focus'));
      if (this.tutorial.mode === 'intro') {
        const intro = TUTORIAL_INTRO[this.tutorial.introStep || 0] || TUTORIAL_INTRO[0];
        this.dom.tutorialTitle.textContent = intro.title;
        this.dom.tutorialText.textContent = intro.text;
        this.dom.tutorialProgress.textContent = `界面 ${Math.min((this.tutorial.introStep || 0) + 1, TUTORIAL_INTRO.length)} / ${TUTORIAL_INTRO.length}`;
        this.applyIntroFocus(intro);
        this.dom.tutorialNext.hidden = false;
        this.dom.tutorialSkip.hidden = false;
        this.dom.tutorialHelp.hidden = true;
        this.dom.tutorialRestart.hidden = true;
      } else {
        const chapter = TUTORIAL_CHAPTERS[this.tutorial.chapter];
        const step = this.tutorialStep();
        this.dom.tutorialTitle.textContent = step?.title || chapter?.title || '教程';
        this.dom.tutorialText.textContent = step?.text || chapter?.intro || '';
        this.dom.tutorialProgress.textContent = `第 ${(this.tutorial.chapter || 0) + 1} / ${TUTORIAL_CHAPTERS.length} 章`;
        this.dom.tutorialNext.hidden = true;
        this.dom.tutorialSkip.hidden = true;
        this.dom.tutorialHelp.hidden = false;
        this.dom.tutorialRestart.hidden = false;
      }
      this.dom.tutorialHud.hidden = this.resultShown;
    }

    async runTutorialAI() {
      if (!this.tutorial) return;
      const chapter = TUTORIAL_CHAPTERS[this.tutorial.chapter];
      if (!chapter || !chapter.enemy) return;
      const session = this.sessionId;
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      this.busy = true;
      this.tutorial.stage = 'wait';
      this.dom.tutorialTitle.textContent = '墨鸦行动';
      this.dom.tutorialText.textContent = '观察墨鸦的卡牌与棋盘效果，稍后会进入下一章。';
      this.dom.tutorialProgress.textContent = `章节 ${this.tutorial.chapter + 1} / ${TUTORIAL_CHAPTERS.length}`;
      this.renderAll();
      await sleep(350);
      if (!this.engine || this.abandoned || session !== this.sessionId) return;

      if (chapter.enemy.kind === 'place') {
        const { r, c } = chapter.enemy;
        this.engine.state.cells[r][c] = {
          uid: `tut-enemy-${this.tutorial.chapter}`,
          owner: 'ai',
          doubled: false,
          placedPly: 0
        };
        this.engine.state.lastMove = { r, c, side: 'ai', type: 'place' };
        this.renderAll();
        await this.showEnemyAction({ type: 'place', r, c }, session);
      } else if (chapter.enemy.kind === 'card') {
        const card = BY_ID[chapter.enemy.cardId];
        const sealed = [];
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
          const nr = chapter.enemy.target.r + dr;
          const nc = chapter.enemy.target.c + dc;
          if (this.engine.inBounds(nr, nc)) sealed.push({ r: nr, c: nc });
        }
        await this.showEnemyAction({
          type: 'card',
          cardId: chapter.enemy.cardId,
          result: { sealed },
          mana: 2
        }, session);
      } else if (chapter.enemy.kind === 'nullified') {
        await this.showEnemyAction({
          type: 'card',
          cardId: chapter.enemy.cardId,
          result: { nullified: true },
          mana: 3
        }, session);
        await sleep(250);
        if (!this.engine || this.abandoned || session !== this.sessionId) return;
        if (chapter.enemy.place) {
          const { r, c } = chapter.enemy.place;
          this.engine.state.cells[r][c] = {
            uid: `tut-enemy-${this.tutorial.chapter}-place`,
            owner: 'ai',
            doubled: false,
            placedPly: 0
          };
          this.engine.state.lastMove = { r, c, side: 'ai', type: 'place' };
          this.renderAll();
          await this.showEnemyAction({ type: 'place', r, c }, session);
        }
      }

      if (!this.engine || this.abandoned || session !== this.sessionId) return;
      this.busy = false;
      this.tutorial.playerTurns = this.tutorial.chapter + 1;
      this.nextTutorialChapter();
    }

    nextTutorialChapter() {
      if (!this.tutorial) return;
      const next = this.tutorial.chapter + 1;
      if (next < TUTORIAL_CHAPTERS.length) {
        this.loadTutorialChapter(next);
        this.toast(`${TUTORIAL_CHAPTERS[next].title} · 开始`, 'gold');
      } else {
        this.tutorial.completed = true;
      }
    }

    showBoardFx(text) {
      const el = this.dom.fxToast;
      el.textContent = text;
      el.classList.remove('is-show');
      void el.offsetWidth;
      el.classList.add('is-show');
      clearTimeout(this._fxTimer);
      this._fxTimer = setTimeout(() => el.classList.remove('is-show'), 1100);
    }

    shakeBoard() {
      if (this.engine && (this.engine.state.current === 'ai' || this.aiRunning)) return;
      this.dom.board.classList.remove('is-shaking');
      void this.dom.board.offsetWidth;
      this.dom.board.classList.add('is-shaking');
      setTimeout(() => this.dom.board.classList.remove('is-shaking'), 340);
    }

    toast(text, tone = 'player') {
      const el = document.createElement('div');
      el.className = `toast ${tone}`;
      el.textContent = text;
      this.dom.toastLayer.appendChild(el);
      setTimeout(() => {
        el.classList.add('is-out');
        setTimeout(() => el.remove(), 180);
      }, 2000);
    }

    playSound(name, options) {
      if (this.sound) this.sound.play(name, options);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.sevenfold = new GameApp();
  });
})();
