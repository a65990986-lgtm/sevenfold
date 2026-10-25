/* 七曜牌局 — 界面与对局控制 */
(function () {
  'use strict';

  const CARD_LIB = window.SEVENFOLD_CARDS;
  const CARDS = CARD_LIB.CARDS;
  const BY_ID = CARD_LIB.BY_ID;
  const Engine = window.SevenfoldEngine;
  const AI = window.SevenfoldAI;
  const LEVEL_LIB = window.SEVENFOLD_LEVELS || { LEVELS: [], BY_ID: {}, BOSS_SKILLS: {}, DEFAULT_LEVEL: 'plain', skillsOf: () => [] };

  const LETTERS = 'ABCDEFGHIJKLMNOPQRS';
  const SIDE_LABEL = { player: '你', ai: '墨鸦' };
  const CROW_QUOTES = [
    '“星路已定，何必挣扎。”',
    '“你听见棋子落下的回声了吗？”',
    '“术式，不过是另一种谎言。”',
    '“七曜归位之前，先学会看棋盘。”',
    '“这一手，我等你很久了。”',
    '“别盯着我的暗牌，它不会回答你。”',
    '“棋子会说话，只是你听不懂。”'
  ];
  const CROW_THINKING = [
    '墨鸦正在窥视星盘……',
    '墨鸦的指尖停在半空。',
    '暗处传来羽毛摩擦的声音。',
    '墨鸦在用喙敲击棋盘边缘。'
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad2 = n => String(n).padStart(2, '0');
  const escapeHtml = text => String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* file:// 或不支持时忽略 */ }
  }

  class Sound {
    constructor() {
      this.muted = loadJSON('sevenfold.muted', false) === true;
      this.ctx = null;
    }

    unlock() {
      if (this.muted) return null;
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        this.ctx = new Ctx();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    toggle() {
      this.muted = !this.muted;
      saveJSON('sevenfold.muted', this.muted);
      if (!this.muted) {
        this.unlock();
        this.play('select');
      }
      return this.muted;
    }

    tone(freq, duration, options = {}) {
      if (this.muted) return;
      const ctx = this.unlock();
      if (!ctx) return;
      const t = ctx.currentTime + (options.when || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = options.type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (options.slide) osc.frequency.linearRampToValueAtTime(options.slide, t + duration);
      const vol = options.volume ?? 0.025;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.01);
    }

    noise(duration = 0.18, volume = 0.04) {
      if (this.muted) return;
      const ctx = this.unlock();
      if (!ctx) return;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      gain.gain.value = volume;
      src.buffer = buffer;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
    }

    play(name) {
      if (this.muted) return;
      switch (name) {
        case 'select':
          this.tone(740, 0.045, { type: 'square', volume: 0.018 });
          this.tone(980, 0.04, { type: 'square', volume: 0.012, when: 0.03 });
          break;
        case 'place':
          this.tone(150, 0.11, { type: 'triangle', volume: 0.05, slide: 95 });
          this.tone(640, 0.035, { type: 'square', volume: 0.012, when: 0.015 });
          break;
        case 'card':
          this.tone(523, 0.07, { type: 'square', volume: 0.022 });
          this.tone(659, 0.07, { type: 'square', volume: 0.022, when: 0.06 });
          this.tone(880, 0.1, { type: 'triangle', volume: 0.023, when: 0.12 });
          break;
        case 'secret':
          this.tone(392, 0.12, { type: 'sine', volume: 0.03, slide: 294 });
          this.tone(784, 0.06, { type: 'triangle', volume: 0.015, when: 0.08 });
          break;
        case 'seal':
          this.tone(330, 0.12, { type: 'square', volume: 0.025, slide: 220 });
          break;
        case 'burst':
          this.noise(0.22, 0.055);
          this.tone(110, 0.24, { type: 'sawtooth', volume: 0.035, slide: 48 });
          break;
        case 'draw':
          this.tone(660, 0.045, { type: 'triangle', volume: 0.012 });
          break;
        case 'turn':
          this.tone(440, 0.08, { type: 'triangle', volume: 0.018 });
          this.tone(660, 0.1, { type: 'triangle', volume: 0.018, when: 0.08 });
          break;
        case 'nullify':
          this.tone(220, 0.13, { type: 'square', volume: 0.025, slide: 110 });
          break;
        case 'win':
          [523, 659, 784, 1047, 1319].forEach((f, i) => {
            this.tone(f, 0.22, { type: 'triangle', volume: 0.03, when: i * 0.12 });
          });
          break;
        case 'lose':
          [392, 330, 262, 196].forEach((f, i) => {
            this.tone(f, 0.26, { type: 'triangle', volume: 0.03, when: i * 0.14 });
          });
          break;
        default:
          break;
      }
    }
  }

  class GameApp {
    constructor() {
      this.engine = null;
      this.ai = null;
      this.aiRunning = false;
      this.busy = false;
      this.abandoned = false;
      this.sessionId = 0;
      this.selection = null;
      this.inspectCard = null;
      this.hoverCard = null;
      this.difficulty = loadJSON('sevenfold.difficulty', 'normal') || 'normal';
      this.level = loadJSON('sevenfold.level', LEVEL_LIB.DEFAULT_LEVEL) || LEVEL_LIB.DEFAULT_LEVEL;
      this.record = Object.assign(
        { wins: 0, losses: 0, draws: 0, games: 0 },
        loadJSON('sevenfold.record', {}) || {}
      );
      this.sound = new Sound();
      this.logs = [];
      this.logCount = 0;
      this.newStoneUid = null;
      this.crowLine = CROW_QUOTES[0];
      this.resultShown = false;
      this.gameCounted = false;
      this.resultTimer = null;
      this._renderRaf = null;
      this._lastBoardSize = 0;
      this.boardEls = null;

      this.cacheDom();
      this.renderStars();
      this.renderAvatars();
      this.buildTitleCards();
      this.bindEvents();
      this.applyDifficulty(this.difficulty, false);
      this.applyLevel(this.level, false);
      this.updateRecordLine();
      this.applySoundState();
      this.renderAll();
    }

    cacheDom() {
      this.dom = {
        app: $('#app'),
        roundLabel: $('#roundLabel'),
        turnBadge: $('#turnBadge'),
        aiAvatar: $('#aiAvatar'),
        playerAvatar: $('#playerAvatar'),
        aiGoal: $('#aiGoal'),
        playerGoal: $('#playerGoal'),
        aiGoalPips: $('#aiGoalPips'),
        playerGoalPips: $('#playerGoalPips'),
        aiHandCount: $('#aiHandCount'),
        aiDeckCount: $('#aiDeckCount'),
        aiSecretCount: $('#aiSecretCount'),
        aiSecrets: $('#aiSecrets'),
        aiAura: $('#aiAura'),
        aiAuraText: $('#aiAuraText'),
        crowQuote: $('#crowQuote'),
        board: $('#board'),
        coordTop: $('#coordTop'),
        coordLeft: $('#coordLeft'),
        boardSizeLabel: $('#boardSizeLabel'),
        boardFx: $('#boardFx'),
        fxToast: $('#fxToast'),
        winLine: $('#winLine'),
        winLineGlow: $('#winLineGlow'),
        winLineCore: $('#winLineCore'),
        boardHint: $('#boardHint'),
        hand: $('#hand'),
        playerHandCount: $('#playerHandCount'),
        playerDeckCount: $('#playerDeckCount'),
        playerDiscardCount: $('#playerDiscardCount'),
        playerBadges: $('#playerBadges'),
        cardInspector: $('#cardInspector'),
        logList: $('#logList'),
        logCount: $('#logCount'),
        endTurnBtn: $('#endTurnBtn'),
        cancelBtn: $('#cancelBtn'),
        actionHint: $('#actionHint'),
        phaseSteps: $$('.phase-track span'),
        titleScreen: $('#titleScreen'),
        titleCards: $('#titleCards'),
        startBtn: $('#startBtn'),
        diffBtns: $$('#difficultyPicker .diff-btn'),
        levelBtns: $$('#levelPicker .diff-btn'),
        levelLine: $('#levelLine'),
        bossLine: $('#bossLine'),
        bossSkillText: $('#bossSkillText'),
        bossCampMeter: $('#bossCampMeter'),
        recordLine: $('#recordLine'),
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
        soundBtn: $('#soundBtn'),
        bgStars: $('#bgStars'),
        helpBtn: $('#helpBtn'),
        codexBtn: $('#codexBtn')
      };
    }

    renderStars() {
      const makeStars = (container, count, opacity = 1) => {
        if (!container) return;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
          const star = document.createElement('span');
          star.className = 'bg-star';
          star.style.left = `${Math.random() * 100}%`;
          star.style.top = `${Math.random() * 100}%`;
          star.style.setProperty('--dur', `${2 + Math.random() * 5}s`);
          star.style.setProperty('--delay', `${-Math.random() * 6}s`);
          star.style.opacity = String((0.15 + Math.random() * 0.65) * opacity);
          if (Math.random() > 0.82) {
            star.style.width = '3px';
            star.style.height = '3px';
            star.style.background = '#fde68a';
          }
          frag.appendChild(star);
        }
        container.appendChild(frag);
      };
      makeStars(this.dom.bgStars, 55, 0.9);
      makeStars($('.title-stars'), 85, 1);
    }

    renderAvatars() {
      const player = [
        '000011110000',
        '000144410000',
        '001444441000',
        '014444444100',
        '014466444100',
        '014444444100',
        '001444441000',
        '000144410000',
        '000114411000',
        '000011110000',
        '000000000000',
        '000000000000'
      ];
      const crow = [
        '000000000000',
        '100000000001',
        '110000000011',
        '141000001141',
        '144100014441',
        '014410144410',
        '001444444100',
        '000144641000',
        '000014410000',
        '000001100000',
        '000000000000',
        '000000000000'
      ];
      this.dom.playerAvatar.innerHTML = this.pixelSvg(player, '#5eead4', '#fff5d6', '#05302e');
      this.dom.aiAvatar.innerHTML = this.pixelSvg(crow, '#fb7185', '#ffe4e6', '#ffcc33');
    }

    stoneSvg(owner) {
      const pattern = [
        '000111000',
        '001222100',
        '012335210',
        '123345321',
        '123333321',
        '123333321',
        '012333210',
        '001222100',
        '000111000'
      ];
      const palettes = {
        player: { '1': '#021b19', '2': '#075c57', '3': '#20c7b5', '4': '#8cf8e9', '5': '#ecfffc' },
        ai: { '1': '#24040d', '2': '#7d1732', '3': '#ef5c76', '4': '#ffb7c3', '5': '#fff0f3' }
      };
      const palette = palettes[owner];
      let rects = '';
      pattern.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === '0') return;
          rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch]}"/>`;
        });
      });
      return `<svg viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
    }

    pixelSvg(pattern, accent, light, eye) {
      const palette = {
        '1': '#08040f',
        '2': '#241630',
        '3': accent,
        '4': accent,
        '5': light,
        '6': eye
      };
      let rects = '';
      pattern.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === '0') return;
          const opacity = ch === '3' ? ' opacity=".58"' : '';
          rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch] || accent}"${opacity}/>`;
        });
      });
      return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
    }

    renderIcon(card, size = '') {
      const palette = { '1': '#08040f', '2': '#2b1d40', '3': card.accent, '4': card.accent, '5': '#fff5d6' };
      let groups = { '1': '', '2': '', '3': '', '4': '', '5': '' };
      card.icon.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === '0') return;
          groups[ch] += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        });
      });
      const fill = key => groups[key]
        ? `<g fill="${palette[key]}"${key === '3' ? ' opacity=".58"' : ''}>${groups[key]}</g>`
        : '';
      return `<svg class="pixel-icon" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"${size ? ` style="width:${size};height:${size}"` : ''}>${fill('1')}${fill('2')}${fill('3')}${fill('4')}${fill('5')}</svg>`;
    }

    buildTitleCards() {
      const picks = [
        { id: 'twin', cls: 'title-card--left' },
        { id: 'sixfold', cls: 'title-card--right' },
        { id: 'expand', cls: 'title-card--far' },
        { id: 'subvert', cls: 'title-card--near' }
      ];
      this.dom.titleCards.innerHTML = picks.map(({ id, cls }) => {
        const card = BY_ID[id];
        return `
          <div class="title-card ${cls}" style="--accent:${card.accent}">
            <span class="card-type${card.type === 'delayed' ? ' card-type--delayed' : ''}">${CARD_LIB.TYPE_LABEL[card.type]}</span>
            <div class="card-art">${this.renderIcon(card)}</div>
            <span class="card-name">${card.name}</span>
            <span class="card-epithet">${card.epithet}</span>
            <span class="card-desc">${escapeHtml(card.desc)}</span>
          </div>`;
      }).join('');
    }

    bindEvents() {
      this.dom.startBtn.addEventListener('click', () => {
        this.sound.unlock();
        this.startGame();
      });
      this.dom.diffBtns.forEach(btn => btn.addEventListener('click', () => {
        this.applyDifficulty(btn.dataset.diff, true);
        this.sound.play('select');
      }));
      this.dom.levelBtns.forEach(btn => btn.addEventListener('click', () => {
        this.applyLevel(btn.dataset.level, true);
        this.sound.play('select');
      }));
      [this.dom.helpBtn, ...$$('[data-open="help"]')].forEach(btn => {
        btn.addEventListener('click', () => this.openModal('help'));
      });
      [this.dom.codexBtn, ...$$('[data-open="codex"]')].forEach(btn => {
        btn.addEventListener('click', () => this.openModal('codex'));
      });

      this.dom.hand.addEventListener('click', e => {
        const card = e.target.closest('.card');
        if (!card) return;
        this.selectCard(card.dataset.uid);
      });
      this.dom.hand.addEventListener('pointerover', e => {
        const card = e.target.closest('.card');
        if (!card) return;
        const entry = this.engine && this.engine.state.players.player.hand.find(item => item.uid === card.dataset.uid);
        if (!entry) return;
        this.hoverCard = { uid: entry.uid, cardId: entry.id };
        this.renderInspector();
      });
      this.dom.hand.addEventListener('pointerout', e => {
        const card = e.target.closest('.card');
        if (!card) return;
        const related = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.card') : null;
        if (related === card) return;
        this.hoverCard = null;
        this.renderInspector();
      });

      this.dom.board.addEventListener('click', e => {
        const cell = e.target.closest('.cell');
        if (!cell) return;
        this.onBoardClick(Number(cell.dataset.r), Number(cell.dataset.c));
      });

      this.dom.cancelBtn.addEventListener('click', () => this.cancelSelection());
      this.dom.endTurnBtn.addEventListener('click', () => this.endPlayerTurn());
      this.dom.cardInspector.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'play-card') this.playSelected({});
        if (btn.dataset.action === 'cancel') this.cancelSelection();
      });

      this.dom.soundBtn.addEventListener('click', () => {
        this.sound.toggle();
        this.applySoundState();
      });

      this.dom.rematchBtn.addEventListener('click', () => {
        this.dom.resultScreen.hidden = true;
        this.startGame();
      });
      this.dom.backTitleBtn.addEventListener('click', () => this.backToTitle());

      $$('[data-close-modal]').forEach(el => el.addEventListener('click', () => this.closeModal()));
      this.dom.modalBody.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'open-codex') this.openModal('codex');
        if (btn.dataset.action === 'restart') {
          this.closeModal();
          this.startGame();
        }
        if (btn.dataset.action === 'quit') {
          this.closeModal();
          this.backToTitle();
        }
      });

      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          if (!this.dom.modal.hidden) { this.closeModal(); return; }
          if (this.selection) { this.cancelSelection(); return; }
        }
        if (!this.dom.modal.hidden) return;
        if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
        if (e.key === 'e' || e.key === 'E') {
          if (!this.dom.endTurnBtn.disabled) { e.preventDefault(); this.endPlayerTurn(); }
          return;
        }
        if (/^[1-7]$/.test(e.key) && this.engine && !this.busy) {
          const idx = Number(e.key) - 1;
          const entry = this.engine.state.players.player.hand[idx];
          if (entry) { e.preventDefault(); this.selectCard(entry.uid); }
        }
      });

      this.dom.modal.addEventListener('click', e => {
        if (e.target === this.dom.modal) this.closeModal();
      });
    }

    applyDifficulty(value, animate) {
      if (!['easy', 'normal', 'hard'].includes(value)) value = 'normal';
      this.difficulty = value;
      saveJSON('sevenfold.difficulty', value);
      this.dom.diffBtns.forEach(btn => btn.classList.toggle('is-active', btn.dataset.diff === value));
      if (animate) this.toast(`墨鸦棋力：${this.difficultyLabel(value)}`, 'gold');
    }

    difficultyLabel(value) {
      return { easy: '见习', normal: '棋师', hard: '大棋士' }[value] || '棋师';
    }

    get levelInfo() {
      return LEVEL_LIB.BY_ID[this.level] || LEVEL_LIB.LEVELS[0] || { id: 'plain', name: '无技能关', bossSkills: [] };
    }

    get levelSkills() {
      return LEVEL_LIB.skillsOf ? LEVEL_LIB.skillsOf(this.level) : [];
    }

    applyLevel(value, animate) {
      if (!LEVEL_LIB.BY_ID[value]) value = LEVEL_LIB.DEFAULT_LEVEL || 'plain';
      this.level = value;
      saveJSON('sevenfold.level', value);
      this.dom.levelBtns.forEach(btn => btn.classList.toggle('is-active', btn.dataset.level === value));
      const skills = this.levelSkills;
      const text = skills.length ? skills.map(skill => skill.name).join(' · ') : '无';
      if (this.dom.levelLine) this.dom.levelLine.textContent = `墨鸦权能：${text}`;
      if (animate) this.toast(`关卡：${this.levelInfo.name} · 权能 ${text}`, 'gold');
      this.renderBoss();
    }

    applySoundState() {
      this.dom.soundBtn.classList.toggle('is-muted', this.sound.muted);
      this.dom.soundBtn.setAttribute('aria-pressed', String(!this.sound.muted));
      this.dom.soundBtn.setAttribute('aria-label', this.sound.muted ? '开启音效' : '关闭音效');
    }

    updateRecordLine() {
      const r = this.record;
      this.dom.recordLine.textContent = `战绩 ${r.wins || 0} 胜 · ${r.losses || 0} 负${r.draws ? ` · ${r.draws} 平` : ''}`;
    }

    startGame() {
      this.closeModal();
      if (this.resultTimer) {
        clearTimeout(this.resultTimer);
        this.resultTimer = null;
      }
      this.dom.resultScreen.hidden = true;
      this.dom.titleScreen.classList.add('is-leaving');
      setTimeout(() => { this.dom.titleScreen.hidden = true; }, 320);

      this.engine = new Engine({
        seed: (Date.now() ^ 0x5f3759df) >>> 0,
        bossSkills: this.levelInfo.bossSkills
      });
      this.ai = new AI(this.engine, { difficulty: this.difficulty, seed: (Date.now() ^ 0xa5a5a5a5) >>> 0 });
      this.engineSub = this.engine.onEvent(event => this.onEngineEvent(event));

      this.busy = false;
      this.aiRunning = false;
      this.abandoned = false;
      this.sessionId++;
      this.selection = null;
      this.inspectCard = null;
      this.hoverCard = null;
      this.newStoneUid = null;
      this.resultShown = false;
      this.gameCounted = false;
      this.logs = [];
      this.logCount = 0;
      this.crowLine = CROW_QUOTES[1];
      this.dom.logList.innerHTML = '';
      this.dom.logCount.textContent = '00';
      this.dom.resultScreen.hidden = true;
      this.resetBoardFx();
      this.renderAll();
      this.addLog('星盘展开。你执<em>星火</em>，先行。', 'system');
      if (this.levelSkills.length) {
        this.addLog(`关卡 <b>${this.levelInfo.name}</b>：墨鸦执掌${this.levelSkills.map(skill => `<em>${skill.name}</em>`).join('、')}。`, 'system');
      }
      this.addLog('墨鸦：<em>“让我看看你的星路。”</em>', 'ai');
      this.addLog('起手五张。即时术式须在落子前发动，秘式须在落子后布下。', 'system');
      this.sound.play('turn');
      this.toast('你先手 · 点击手牌或直接落子', 'player');
    }

    backToTitle() {
      this.abandoned = true;
      this.sessionId++;
      this.aiRunning = false;
      this.busy = false;
      this.selection = null;
      if (this.engine && this.engine.state.status === 'playing') this.engine.state.status = 'abandoned';
      this.dom.resultScreen.hidden = true;
      this.dom.titleScreen.hidden = false;
      this.dom.titleScreen.classList.remove('is-leaving');
      this.updateRecordLine();
      this.renderAll();
      this.sound.play('turn');
      this.dom.startBtn.focus();
    }

    onEngineEvent(event) {
      if (this.abandoned) return;
      switch (event.type) {
        case 'turnStart':
          if (event.side === 'player' && event.round > 1) this.addLog(`—— 第 ${event.round} 回合 ——`, 'system');
          break;
        case 'draw':
          if (event.side === 'player') {
            const names = event.cards.map(id => BY_ID[id]?.name).filter(Boolean).join('、');
            this.addLog(`你抽取了【${names}】。`, 'player');
            this.sound.play('draw');
          } else {
            this.addLog('墨鸦抽取了一张牌。', 'ai');
          }
          break;
        case 'cardBurned':
          if (event.side === 'player') this.addLog('手牌已满，新抽到的牌被弃置。', 'system');
          break;
        case 'cardPlayed': {
          const card = BY_ID[event.cardId];
          if (!card) break;
          this.addLog(`${SIDE_LABEL[event.side]}发动了【${card.name}】。`, event.side);
          this.sound.play('card');
          this.showBoardFx(`【${card.name}】`);
          if (event.side === 'ai') this.crowLine = `“${card.name}……一张好牌。”`;
          break;
        }
        case 'secretSet': {
          const card = BY_ID[event.cardId];
          if (!card) break;
          if (event.side === 'player') {
            this.addLog(`你布下秘式【${card.name}】，静待其触发。`, 'player');
            this.showBoardFx(`秘式 · ${card.name}`);
          } else {
            this.addLog('墨鸦布下了一张<em>暗牌</em>。', 'ai');
            this.showBoardFx('暗牌 · 已布下');
            this.crowLine = '“猜猜看，这张牌会落在哪里？”';
          }
          this.sound.play('secret');
          break;
        }
        case 'cardNullified': {
          const card = BY_ID[event.cardId];
          this.addLog(`<em>噤声发动！</em>${SIDE_LABEL[event.side]}的【${card?.name || '术式'}】被吞没。`, 'reveal');
          this.showBoardFx('噤声 · 术式失效');
          this.flashBoard();
          this.sound.play('nullify');
          break;
        }
        case 'stonePlaced': {
          const coord = this.coordName(event.r, event.c);
          const doubled = event.stone?.doubled ? ' · <em>双生</em>' : '';
          this.addLog(`${SIDE_LABEL[event.side]}在 <b>${coord}</b> 落下星子${doubled}。`, event.side);
          this.newStoneUid = event.stone?.uid || null;
          setTimeout(() => { if (this.newStoneUid === event.stone?.uid) this.newStoneUid = null; }, 650);
          this.spawnParticles(event.r, event.c, event.side === 'player' ? '#5eead4' : '#fb7185', 8);
          this.sound.play('place');
          break;
        }
        case 'stoneMoved': {
          const from = this.coordName(event.from.r, event.from.c);
          const to = this.coordName(event.to.r, event.to.c);
          let sentence;
          if (event.by === 'player') {
            sentence = event.owner === 'player'
              ? `你将己方星子从 <b>${from}</b> 移至 <b>${to}</b>。`
              : `你将墨鸦的星子从 <b>${from}</b> 推至 <b>${to}</b>。`;
          } else {
            sentence = event.owner === 'ai'
              ? `墨鸦将己方星子从 <b>${from}</b> 移至 <b>${to}</b>。`
              : `墨鸦将你的星子从 <b>${from}</b> 推至 <b>${to}</b>。`;
          }
          this.addLog(sentence, event.by);
          this.showBoardFx(`位移 · ${from} → ${to}`);
          break;
        }
        case 'campsSwapped':
          this.addLog(`<em>换营！</em>墨鸦把你连成的星路收归己用：双方 ${event.flipped} 枚星子归属对调。`, 'reveal');
          this.showBoardFx('换营 · 星子易主');
          this.shakeBoard();
          this.flashBoard();
          this.sound.play('burst');
          this.crowLine = '“你的星路，本来就是我的。”';
          this.renderBoss();
          break;
        case 'campSwapSuppressed':
          this.addLog('墨鸦已占上风，<em>换营</em>没有发动。', 'system');
          this.toast('墨鸦占优 · 换营未发动', 'gold');
          this.renderBoss();
          break;
        case 'boardExpanded':
          this.addLog(`星盘向四周扩展：<b>${event.from}×${event.from}</b> → <b>${event.to}×${event.to}</b>。`, 'system');
          this.showBoardFx('拓界 · 星盘扩展');
          if (this.dom.board) {
            this.dom.board.classList.add('is-expanding');
            setTimeout(() => this.dom.board.classList.remove('is-expanding'), 560);
          }
          break;
        case 'sealed':
          this.addLog(`${SIDE_LABEL[event.side]}的封锁术式生效，${event.cells.length} 格暂时不可落子。`, event.side);
          this.showBoardFx('封禁 · 四邻锁闭');
          this.sound.play('seal');
          break;
        case 'detonated':
          this.addLog(`<em>崩星爆裂！</em>${event.removed.length} 枚星子化为尘埃${event.shielded.length ? `，${event.shielded.length} 枚被金身护住` : ''}。`, 'reveal');
          this.showBoardFx('崩星 · 寂灭');
          this.shakeBoard();
          this.spawnParticles(event.center.r, event.center.c, '#fb7185', 24, true);
          this.sound.play('burst');
          break;
        case 'subverted':
          this.addLog(`<em>策反发动！</em>${SIDE_LABEL[event.previousOwner]}的星子在 <b>${this.coordName(event.at.r, event.at.c)}</b> 转投${SIDE_LABEL[event.owner]}。`, 'reveal');
          this.showBoardFx('策反 · 星蚀');
          this.flashBoard();
          break;
        case 'mirrored':
          this.addLog(`<em>换影发动！</em>${this.coordName(event.anchor.r, event.anchor.c)} 与 ${this.coordName(event.placed.r, event.placed.c)} 的星子交换了位置。`, 'reveal');
          this.showBoardFx('换影 · 镜界');
          this.flashBoard();
          break;
        case 'mirrorBlocked':
          this.addLog('金身亮起，<em>换影</em>被挡下了。', 'reveal');
          this.showBoardFx('金身 · 术式免疫');
          break;
        case 'forceFizzle':
          this.addLog('定身咒的目标格已失效，咒术解除。', 'system');
          break;
        case 'secretExpired':
          if (event.side === 'player') {
            const card = BY_ID[event.secret?.cardId];
            this.addLog(`你布下的【${card?.name || '秘式'}】悄然失效。`, 'system');
          } else {
            this.addLog('墨鸦的一道暗牌失去了光泽。', 'ai');
          }
          break;
        case 'gameOver':
          this.handleGameOver(event);
          break;
        default:
          break;
      }
      this.requestRender();
    }

    handleGameOver(event) {
      if (this.resultShown || this.abandoned) return;
      this.busy = false;
      this.aiRunning = false;
      this.selection = null;
      if (!this.gameCounted) {
        this.gameCounted = true;
        this.record.games = (this.record.games || 0) + 1;
        if (event.draw) this.record.draws = (this.record.draws || 0) + 1;
        else if (event.winner === 'player') this.record.wins = (this.record.wins || 0) + 1;
        else this.record.losses = (this.record.losses || 0) + 1;
        saveJSON('sevenfold.record', this.record);
        this.updateRecordLine();
      }
      if (event.draw) {
        this.addLog('星盘已满，对局以平局收场。', 'system');
        this.flashBoard();
      } else {
        this.addLog(`<em>${SIDE_LABEL[event.winner]}完成了 ${event.win.target} 子连珠！</em>`, 'reveal');
        setTimeout(() => this.animateWinLine(event.win), 80);
      }
      this.sound.play(event.winner === 'player' ? 'win' : event.winner === 'ai' ? 'lose' : 'turn');
      this.requestRender();
      this.resultTimer = setTimeout(() => {
        this.showResult(event);
      }, event.draw ? 1000 : 1350);
    }

    animateWinLine(win) {
      if (!win || !win.cells || win.cells.length < 2) return;
      const first = win.cells[0];
      const last = win.cells[win.cells.length - 1];
      const size = this.engine.state.size;
      const x1 = ((first.c + 0.5) / size) * 100;
      const y1 = ((first.r + 0.5) / size) * 100;
      const x2 = ((last.c + 0.5) / size) * 100;
      const y2 = ((last.r + 0.5) / size) * 100;
      for (const id of ['winLineGlow', 'winLineCore']) {
        const line = document.getElementById(id);
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
      }
      this.dom.winLine.classList.add('is-show');
      this.flashBoard();
    }

    showResult(event) {
      if (this.resultShown) return;
      this.resultShown = true;
      const state = this.engine.state;
      const isPlayer = event.winner === 'player';
      const isAI = event.winner === 'ai';
      const target = event.win?.target || 7;
      const reason = event.win ? this.engine.state.winReason : '';
      let title = '星盘无声';
      let kicker = 'DRAW';
      let sub = '星盘已满，最后一枚星子也没能改写结局。';
      let cls = '';
      if (isPlayer) {
        title = '七曜归位';
        kicker = 'VICTORY';
        sub = `你在第 ${state.round} 回合完成了 ${target} 子连珠。${reason === 'sixfold' ? '六合改命，星路重写。' : '星火照亮了整片星盘。'}`;
      } else if (isAI) {
        title = '星火熄灭';
        kicker = 'DEFEAT';
        sub = `墨鸦在第 ${state.round} 回合完成了 ${target} 子连珠。${reason === 'sixfold' ? '它的暗牌改写了胜利条件。' : '乌鸦收拢了最后一枚羽翼。'}`;
        cls = 'is-loss';
      }
      this.dom.resultKicker.textContent = kicker;
      this.dom.resultTitle.textContent = title;
      this.dom.resultTitle.className = `result-title ${cls}`;
      this.dom.resultSub.textContent = sub;
      this.dom.resultStats.innerHTML = `
        <div class="result-stat"><span>回合</span><b>${pad2(state.round)}</b></div>
        <div class="result-stat"><span>施术</span><b>${state.stats.cardsPlayed}</b></div>
        <div class="result-stat"><span>落子</span><b>${state.stats.stonesPlaced}</b></div>
      `;
      const pipCount = event.win ? Math.min(7, target) : 0;
      const pips = [];
      for (let i = 0; i < pipCount; i++) {
        pips.push(`<i class="${isAI ? 'is-loss' : ''}" style="--d:${i * 0.07}s"></i>`);
      }
      this.dom.resultLine.innerHTML = pips.join('');
      this.dom.resultScreen.hidden = false;
      this.busy = false;
      this.requestRender();
      setTimeout(() => this.dom.rematchBtn.focus(), 60);
    }

    requestRender() {
      if (this._renderRaf) return;
      this._renderRaf = requestAnimationFrame(() => {
        this._renderRaf = null;
        this.renderAll();
      });
    }

    renderAll() {
      if (!this.engine) {
        this.renderHand();
        this.renderInspector();
        this.renderTopbar();
        return;
      }
      this.renderTopbar();
      this.ensureBoard();
      this.syncBoard();
      this.renderPanels();
      this.renderBoss();
      this.renderHand();
      this.renderInspector();
      this.updateActions();
    }

    renderTopbar() {
      const state = this.engine && this.engine.state;
      if (!state) {
        this.dom.roundLabel.textContent = 'ROUND 01';
        this.dom.turnBadge.className = 'turn-badge';
        this.dom.turnBadge.innerHTML = '<i></i>等待开局';
        return;
      }
      this.dom.roundLabel.textContent = `ROUND ${pad2(state.round)}`;
      let label = '你的回合';
      let cls = 'turn-badge';
      if (state.status !== 'playing') {
        label = '对局结束';
        cls += ' is-over';
      } else if (state.current === 'ai') {
        label = this.aiRunning ? '墨鸦推演中' : '墨鸦回合';
        cls += ' is-ai';
      }
      this.dom.turnBadge.className = cls;
      this.dom.turnBadge.innerHTML = `<i></i>${label}`;
    }

    ensureBoard() {
      const n = this.engine.state.size;
      if (this._lastBoardSize === n && this.dom.board.children.length === n * n) return;
      this._lastBoardSize = n;
      this.dom.board.style.setProperty('--n', n);
      this.dom.board.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
      this.dom.board.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
      this.dom.board.setAttribute('aria-label', `${n}乘${n}星盘`);
      this.dom.coordTop.style.setProperty('--n', n);
      this.dom.coordTop.innerHTML = Array.from({ length: n }, (_, c) => `<span>${LETTERS[c]}</span>`).join('');
      this.dom.coordLeft.innerHTML = Array.from({ length: n }, (_, r) => `<span>${r + 1}</span>`).join('');
      this.dom.boardSizeLabel.textContent = `${n} × ${n}`;

      const frag = document.createDocumentFragment();
      const starPoints = new Set();
      const mid = Math.floor(n / 2);
      const quarter = Math.floor(n / 4);
      const threeQuarter = n - 1 - quarter;
      [[quarter, quarter], [quarter, threeQuarter], [threeQuarter, quarter], [threeQuarter, threeQuarter], [mid, mid]]
        .forEach(([r, c]) => starPoints.add(`${r},${c}`));

      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'cell';
          if (starPoints.has(`${r},${c}`)) cell.classList.add('is-star-point');
          cell.dataset.r = String(r);
          cell.dataset.c = String(c);
          cell.setAttribute('role', 'gridcell');
          cell.innerHTML = `
            <span class="zone-mark" aria-hidden="true"></span>
            <span class="seal-mark" aria-hidden="true"></span>
            <span class="force-mark" aria-hidden="true"></span>
            <span class="target-mark" aria-hidden="true"></span>
            <span class="move-arrow" aria-hidden="true"></span>
            <span class="last-mark" aria-hidden="true"></span>
            <span class="ghost-stone" aria-hidden="true"></span>
            <span class="stone-slot"></span>`;
          frag.appendChild(cell);
        }
      }
      this.dom.board.replaceChildren(frag);
      this.boardEls = [...this.dom.board.children];
      this.dom.winLine.classList.remove('is-show');
    }

    coordName(r, c) {
      return `${LETTERS[c] || '?'}${r + 1}`;
    }

    getTargetSet() {
      if (!this.engine || !this.selection || this.busy) return null;
      const { cardId, stage, from } = this.selection;
      let cells = [];
      if (stage === 'direction' && from) {
        cells = this.engine.getMoveDestinations(from.r, from.c);
      } else {
        cells = this.engine.getCardTargets('player', cardId);
      }
      return new Set(cells.map(cell => `${cell.r},${cell.c}`));
    }

    getTargetList() {
      if (!this.engine || !this.selection || this.busy) return [];
      const { cardId, stage, from } = this.selection;
      if (stage === 'direction' && from) return this.engine.getMoveDestinations(from.r, from.c);
      return this.engine.getCardTargets('player', cardId);
    }

    isOwnZone(r, c) {
      if (!this.engine) return false;
      return this.engine.state.zones.some(zone => zone.owner === 'player' && Math.abs(zone.center.r - r) <= 1 && Math.abs(zone.center.c - c) <= 1);
    }

    syncBoard() {
      if (!this.engine || !this.boardEls) return;
      const state = this.engine.state;
      const n = state.size;
      const targets = this.getTargetSet();
      const targetList = this.getTargetList();
      const softTarget = targetList.length > 22;
      const canInteract = state.status === 'playing' && state.current === 'player' && !this.busy;
      const placeSet = canInteract && !this.selection ? new Set(this.engine.getPlacementCells('player').map(cell => `${cell.r},${cell.c}`)) : new Set();
      const forced = state.forced;
      const lastMove = state.lastMove;
      const showShields = true;

      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const idx = r * n + c;
          const cell = this.boardEls[idx];
          if (!cell) continue;
          const stone = state.cells[r][c];
          const key = `${r},${c}`;
          const isTarget = !!targets && targets.has(key);
          const isPlace = placeSet.has(key);
          const sealed = this.engine.isSealed(r, c);
          const isForced = !!forced && forced.r === r && forced.c === c;
          const zone = this.isOwnZone(r, c);
          const zoneCenter = state.zones.some(z => z.owner === 'player' && z.center.r === r && z.center.c === c);
          const isLast = !!lastMove && lastMove.r === r && lastMove.c === c;
          const classes = ['cell'];
          if (this.isStarPoint(r, c, n)) classes.push('is-star-point');
          if (isPlace) classes.push('playable');
          if (isTarget) classes.push(softTarget ? 'is-target-soft' : 'is-target');
          if (this.selection && this.selection.stage === 'direction' && isTarget) {
            classes.push('is-move-dest');
            const arrow = cell.querySelector('.move-arrow');
            if (arrow) {
              const dr = r - this.selection.from.r;
              const dc = c - this.selection.from.c;
              arrow.textContent = dc === 1 ? '▶' : dc === -1 ? '◀' : dr === 1 ? '▼' : '▲';
            }
          }
          if (this.selection && this.selection.from && this.selection.from.r === r && this.selection.from.c === c) classes.push('is-selected-piece');
          if (isForced) classes.push('is-forced');
          if (sealed) classes.push('is-sealed');
          if (zone) classes.push('is-zone');
          if (zoneCenter) classes.push('is-zone-center');
          if (isLast) classes.push('is-last');
          if (!stone && (isPlace || isTarget)) classes.push('is-actionable');
          cell.className = classes.join(' ');

          const actionable = isPlace || isTarget;
          cell.tabIndex = actionable && (!softTarget || isTarget) ? 0 : -1;
          let label = `${this.coordName(r, c)}，${stone ? (stone.owner === 'player' ? '你的星子' : '墨鸦的星子') : '空格'}`;
          if (stone?.doubled) label += '，双生';
          if (sealed) label += '，已封禁';
          if (isForced) label += '，定身目标';
          if (isTarget) label += '，可选中';
          if (isPlace) label += '，可落子';
          cell.setAttribute('aria-label', label);

          const stoneSlot = cell.querySelector('.stone-slot');
          if (!stone) {
            if (stoneSlot.dataset.uid) {
              stoneSlot.innerHTML = '';
              delete stoneSlot.dataset.uid;
              delete stoneSlot.dataset.sig;
            }
          } else {
            const shield = showShields && stone.owner === 'player' && stone.shieldUntil > state.ply;
            const sig = `${stone.owner}|${stone.doubled ? 1 : 0}|${shield ? 1 : 0}|${stone.convertedFrom ? 1 : 0}|${stone.uid}`;
            if (stoneSlot.dataset.sig !== sig) {
              stoneSlot.dataset.sig = sig;
              stoneSlot.dataset.uid = stone.uid;
              const stoneCls = ['stone', `stone--${stone.owner}`];
              if (stone.doubled) stoneCls.push('is-double');
              if (stone.convertedFrom) stoneCls.push('is-converted');
              stoneSlot.innerHTML = `
                <span class="${stoneCls.join(' ')} is-pixel${this.newStoneUid === stone.uid ? ' is-new' : ''}">
                  ${this.stoneSvg(stone.owner)}
                  ${stone.doubled ? '<span class="double-mark">×2</span>' : ''}
                  ${shield ? '<span class="shield-mark">✦</span>' : ''}
                  ${stone.convertedFrom ? '<span class="converted-mark">◈</span>' : ''}
                </span>`;
            }
          }
        }
      }
      this.dom.board.classList.toggle('is-targeting', !!targets && targets.size > 0);
    }

    isStarPoint(r, c, n) {
      const mid = Math.floor(n / 2);
      const quarter = Math.floor(n / 4);
      const threeQuarter = n - 1 - quarter;
      return (r === mid && c === mid) ||
        ((r === quarter || r === threeQuarter) && (c === quarter || c === threeQuarter));
    }

    renderPanels() {
      if (!this.engine) return;
      const state = this.engine.state;
      const p = state.players.player;
      const a = state.players.ai;
      this.dom.aiHandCount.textContent = a.hand.length;
      this.dom.aiDeckCount.textContent = a.deck.length;
      this.dom.aiSecretCount.textContent = a.secrets.length;
      this.dom.playerHandCount.textContent = p.hand.length;
      this.dom.playerDeckCount.textContent = p.deck.length;
      this.dom.playerDiscardCount.textContent = p.discard.length;

      const playerTarget = p.winTarget;
      const aiVisibleTarget = state.status === 'over' ? a.winTarget : 7;
      this.dom.playerGoal.textContent = playerTarget === 6 ? '六子连珠' : '七子连珠';
      this.dom.aiGoal.textContent = aiVisibleTarget === 6 ? '六子连珠' : '七子连珠';
      this.renderPips(this.dom.playerGoalPips, playerTarget);
      this.renderPips(this.dom.aiGoalPips, aiVisibleTarget);

      this.renderSecrets();
      this.renderAura();

      const quote = this.aiRunning ? CROW_THINKING[Math.floor(Math.random() * CROW_THINKING.length)] : this.crowLine;
      this.dom.crowQuote.textContent = quote;
      this.dom.crowQuote.classList.toggle('is-thinking', this.aiRunning);

      const badges = [];
      if (p.silenced) badges.push('<span class="badge badge--silence">噤声 · 下一牌失效</span>');
      if (p.nextAura) {
        const card = BY_ID[p.nextAura.type];
        badges.push(`<span class="badge badge--aura">下一子 · ${card?.name || '术式'}</span>`);
      }
      p.secrets.slice(-3).forEach(secret => {
        const card = BY_ID[secret.cardId];
        badges.push(`<span class="badge">秘式 · ${card?.name || '未知'}</span>`);
      });
      if (!badges.length) badges.push('<span class="badge">无持续术式</span>');
      this.dom.playerBadges.innerHTML = badges.join('');
    }

    renderPips(container, target) {
      const pips = [];
      for (let i = 0; i < 7; i++) {
        const lit = i < target;
        pips.push(`<span class="goal-pip${lit ? ' is-lit' : ''}${target === 6 ? ' is-six' : ''}"></span>`);
      }
      container.innerHTML = pips.join('');
    }

    renderBoss() {
      const line = this.dom.bossLine;
      if (!line) return;
      const skills = this.levelSkills;
      const state = this.engine ? this.engine.state : null;
      if (!state || !skills.length) {
        line.hidden = true;
        return;
      }
      line.hidden = false;
      const names = skills.map(skill => skill.name).join(' · ');
      const doubleNow = state.status === 'playing'
        && state.bossSkills && state.bossSkills.includes('doubleCard')
        && state.current === 'ai' && state.round % 2 === 0;
      this.dom.bossSkillText.textContent = `${this.levelInfo.name} · ${names}${doubleNow ? ' · 本回合双术生效' : ''}`;
      const meter = this.dom.bossCampMeter;
      if (!meter) return;
      if (!state.bossSkills || !state.bossSkills.includes('campSwap')) {
        meter.hidden = true;
        return;
      }
      meter.hidden = false;
      // count 奇数 = 下一次五连会触发判定（危险）；偶数 = 判定已过，还要再连两次
      const count = state.campSwapCount || 0;
      const swaps = state.campSwaps || 0;
      const swapped = swaps ? ` · 已换 ${swaps} 次` : '';
      if (count === 0) {
        meter.textContent = `换营：还差 2 次五连${swapped}`;
        meter.className = 'boss-meter';
      } else if (count % 2 === 1) {
        meter.textContent = `换营：${count} 次五连 · 再来一次就交换${swapped}`;
        meter.className = 'boss-meter is-warn';
      } else {
        meter.textContent = `换营：${count} 次五连 · 还差 2 次再判${swapped}`;
        meter.className = swaps ? 'boss-meter is-armed' : 'boss-meter';
      }
    }

    renderSecrets() {
      const state = this.engine.state;
      const secrets = state.players.ai.secrets;
      if (!secrets.length) {
        this.dom.aiSecrets.innerHTML = '<span class="empty-note">尚无可疑气息</span>';
        return;
      }
      const backs = secrets.slice(-5).map(() => (
        `<span class="secret-card" title="一张未揭晓的暗牌">？<small>暗牌</small></span>`
      ));
      this.dom.aiSecrets.innerHTML = `<div class="secret-stack">${backs.join('')}</div>`;
    }

    renderAura() {
      const state = this.engine.state;
      const aura = state.players.ai.nextAura;
      if (!aura) {
        this.dom.aiAura.hidden = true;
        return;
      }
      const card = BY_ID[aura.type];
      this.dom.aiAura.hidden = false;
      this.dom.aiAuraText.textContent = `墨鸦下一子：${card?.name || '术式'} · ${card?.epithet || ''}`;
    }

    renderHand() {
      if (!this.engine) {
        this.dom.hand.innerHTML = '<span class="hand-empty">等待星盘开启</span>';
        return;
      }
      const state = this.engine.state;
      const hand = state.players.player.hand;
      if (!hand.length) {
        this.dom.hand.innerHTML = '<span class="hand-empty">手牌已空 · 静候下一抽</span>';
        return;
      }
      const overlap = hand.length >= 5 ? Math.max(-10, 4 - hand.length * 2) : 0;
      const mid = (hand.length - 1) / 2;
      const html = hand.map((entry, index) => {
        const card = BY_ID[entry.id];
        if (!card) return '';
        const can = state.status === 'playing' && state.current === 'player' && !this.busy
          ? this.engine.canPlayCard('player', entry.uid)
          : { ok: false, reason: state.status !== 'playing' ? '对局结束' : '等待你的回合' };
        const selected = this.selection && this.selection.uid === entry.uid;
        const disabled = !can.ok;
        const rot = hand.length > 1 ? (index - mid) * 2.2 : 0;
        const lift = Math.abs(index - mid) * 1.8;
        const phaseNote = card.type === 'instant'
          ? (state.phase === 'post' ? '落子前' : '即时')
          : (state.phase === 'main' ? '落子后' : '秘式');
        return `
          <button type="button"
            class="card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}"
            data-uid="${entry.uid}"
            role="listitem"
            style="--accent:${card.accent};--overlap:${overlap}px;--rot:${rot.toFixed(2)}deg;--lift:${lift.toFixed(1)}px;--zi:${index}"
            aria-pressed="${selected}"
            aria-disabled="${disabled}"
            aria-label="${card.name}，${CARD_LIB.TYPE_LABEL[card.type]}，${card.short}"
            title="${escapeHtml(card.desc)}">
            <span class="card-type${card.type === 'delayed' ? ' card-type--delayed' : ''}">${CARD_LIB.TYPE_LABEL[card.type]}</span>
            <span class="card-shortcut">${index + 1}</span>
            <span class="card-art">${this.renderIcon(card)}</span>
            <span class="card-name">${card.name}</span>
            <span class="card-epithet">${card.epithet}</span>
            <span class="card-desc">${escapeHtml(card.short)}</span>
            <span class="card-bottom"><em>${card.tag}</em><span>${phaseNote}</span></span>
          </button>`;
      }).join('');
      this.dom.hand.innerHTML = html;
    }

    renderInspector() {
      if (!this.engine) {
        this.dom.cardInspector.innerHTML = `
          <div class="inspector-empty">
            <span class="inspector-sigil">✦</span>
            <strong>术式待命</strong>
            <p>点击手牌查看效果。即时术式在落子前发动，延时秘式在落子后布下。</p>
          </div>`;
        return;
      }
      let info = this.hoverCard;
      if (!info && this.selection) info = { uid: this.selection.uid, cardId: this.selection.cardId };
      if (!info && this.inspectCard) info = this.inspectCard;
      if (!info) {
        const state = this.engine.state;
        const turnText = state.current === 'player' ? '你的回合' : '墨鸦的回合';
        this.dom.cardInspector.innerHTML = `
          <div class="inspector-empty">
            <span class="inspector-sigil">✦</span>
            <strong>${turnText} · 静观星盘</strong>
            <p>${state.phase === 'post' ? '可以布下一张延时秘式，或结束回合。' : '选择一张即时术式，或直接点击星盘落子。'}<br>秘式在对方视角中始终是暗牌。</p>
          </div>`;
        return;
      }
      const card = BY_ID[info.cardId];
      if (!card) return;
      const state = this.engine.state;
      const isSelected = this.selection && this.selection.uid === info.uid;
      const can = state.status === 'playing' && state.current === 'player' && !this.busy
        ? this.engine.canPlayCard('player', info.uid)
        : { ok: false, reason: state.status !== 'playing' ? '对局已结束' : '等待你的回合' };
      let targetText = '';
      if (isSelected) {
        if (card.target === 'none') targetText = '点击下方按钮发动这张术式。';
        else if (card.target === 'moveEnemy' || card.target === 'moveOwn') {
          targetText = this.selection.stage === 'direction'
            ? '已选中星子。点击相邻箭头格完成移动。'
            : '点击一枚可移动的星子，再选择方向。';
        } else if (card.target === 'cellAny') targetText = '点击任意一格，作为 3×3 策反区的中心。';
        else if (card.target === 'cellEmpty') targetText = '点击一个空格作为目标。';
        else targetText = '点击一枚符合条件的己方星子。';
      }
      const action = isSelected
        ? (card.target === 'none'
          ? '<button class="pixel-btn pixel-btn--primary" data-action="play-card" type="button">发动术式</button><button class="pixel-btn pixel-btn--ghost" data-action="cancel" type="button">取消</button>'
          : '<button class="pixel-btn pixel-btn--ghost" data-action="cancel" type="button">取消选择</button>')
        : (can.ok ? '<span class="meta-chip is-accent">点击手牌选取</span>' : `<span class="meta-chip">${escapeHtml(can.reason)}</span>`);

      this.dom.cardInspector.innerHTML = `
        <div class="inspector-card" style="--accent:${card.accent}">
          <div class="inspector-head">
            <div class="inspector-icon">${this.renderIcon(card)}</div>
            <div class="inspector-title">
              <span class="card-type${card.type === 'delayed' ? ' card-type--delayed' : ''}">${CARD_LIB.TYPE_LABEL[card.type]}</span>
              <h3>${card.name}</h3>
              <p>${card.epithet} · ${card.tag}</p>
            </div>
          </div>
          <p class="inspector-desc">${escapeHtml(card.desc)}</p>
          <div class="inspector-meta">
            <span class="meta-chip is-accent">${CARD_LIB.TARGET_LABEL[card.target] || '目标'}</span>
            <span class="meta-chip">${card.type === 'instant' ? '落子前' : '落子后'}</span>
            <span class="meta-chip">每回合限 1 牌</span>
          </div>
          ${targetText ? `<div class="inspector-target">${targetText}</div>` : ''}
          ${card.type === 'delayed' ? '<div class="inspector-target">对方只能看到一张暗牌，效果触发时才揭晓。</div>' : ''}
          <div class="inspector-actions">${action}</div>
        </div>`;
    }

    updateActions() {
      const state = this.engine && this.engine.state;
      const playing = state && state.status === 'playing';
      const isPlayer = playing && state.current === 'player';
      const canEnd = isPlayer && state.phase === 'post' && !this.busy && !this.selection;
      this.dom.endTurnBtn.disabled = !canEnd;
      this.dom.cancelBtn.hidden = !this.selection || this.busy;
      this.dom.actionHint.className = 'action-hint';

      if (!state) {
        this.dom.actionHint.textContent = '等待星盘开启。';
        return;
      }
      if (state.status !== 'playing') {
        this.dom.actionHint.textContent = '对局已经结束。';
        this.dom.boardHint.textContent = '星盘终局。';
        this.dom.boardHint.className = 'board-hint';
      } else if (this.busy || state.current === 'ai') {
        this.dom.actionHint.innerHTML = '<b>墨鸦</b>正在推演星路……';
        this.dom.boardHint.textContent = '墨鸦正在窥视你的阵型。';
        this.dom.boardHint.className = 'board-hint';
      } else if (this.selection) {
        const card = BY_ID[this.selection.cardId];
        if (this.selection.stage === 'direction') {
          this.dom.actionHint.innerHTML = `已选星子：点击相邻的<b>箭头格</b>移动。`;
          this.dom.boardHint.textContent = '选择移动方向 · 点击箭头格';
        } else if (card.target === 'none') {
          this.dom.actionHint.innerHTML = `已选【<b>${card.name}</b>】，点击右侧“发动术式”。`;
          this.dom.boardHint.textContent = `已选择【${card.name}】· 确认发动`;
        } else {
          const instruction = CARD_LIB.TARGET_LABEL[card.target];
          this.dom.actionHint.innerHTML = `【<b>${card.name}</b>】${instruction}。`;
          this.dom.boardHint.textContent = `${card.name} · ${instruction}`;
        }
        this.dom.boardHint.className = 'board-hint is-warn';
      } else if (state.phase === 'main') {
        if (state.forced && state.forced.target === 'player') {
          this.dom.actionHint.textContent = '定身咒：本回合只能落在标记格。';
          this.dom.boardHint.textContent = '定身咒 · 只能落在高亮格';
          this.dom.boardHint.className = 'board-hint is-danger';
        } else {
          this.dom.actionHint.innerHTML = '选择一张<b>即时术式</b>，或直接落子。';
          this.dom.boardHint.textContent = '点击手牌发动术式，或直接在星盘落子。';
          this.dom.boardHint.className = 'board-hint';
        }
      } else if (state.phase === 'post') {
        if (state.cardPlayed) {
          this.dom.actionHint.innerHTML = '本回合的术式已用尽。<b>结束回合</b>交给墨鸦。';
          this.dom.boardHint.textContent = '术式已用 · 结束回合';
        } else {
          this.dom.actionHint.innerHTML = '可布下一张<b>延时秘式</b>，或结束回合。';
          this.dom.boardHint.textContent = '落子完成 · 可布下秘式或结束回合';
        }
        this.dom.boardHint.className = 'board-hint';
      }
      if (state.players.player.silenced && playing) {
        this.dom.boardHint.textContent = '噤声：你的下一张牌将会失效。';
        this.dom.boardHint.className = 'board-hint is-danger';
      }

      this.dom.phaseSteps.forEach(step => {
        const phase = step.dataset.phase;
        step.classList.remove('is-active', 'is-done');
        if (!isPlayer) return;
        if (phase === 'main' && state.phase === 'main') step.classList.add('is-active');
        if (phase === 'main' && state.phase !== 'main') step.classList.add('is-done');
        if (phase === 'place' && state.phase === 'post') step.classList.add('is-done');
        if (phase === 'post' && state.phase === 'post') step.classList.add('is-active');
      });
      if (state.status !== 'playing') this.dom.endTurnBtn.disabled = true;
    }

    selectCard(uid) {
      if (!this.engine) return;
      const state = this.engine.state;
      const entry = state.players.player.hand.find(item => item.uid === uid);
      if (!entry) return;
      const card = BY_ID[entry.id];
      this.inspectCard = { uid: entry.uid, cardId: entry.id };
      this.hoverCard = null;
      if (this.busy || state.status !== 'playing' || state.current !== 'player') {
        this.selection = null;
        this.toast('现在还不能发动术式。', 'danger');
        this.renderAll();
        return;
      }
      if (this.selection && this.selection.uid === uid) {
        this.cancelSelection();
        return;
      }
      const can = this.engine.canPlayCard('player', uid);
      if (!can.ok) {
        this.selection = null;
        this.toast(can.reason, 'danger');
        this.renderAll();
        return;
      }
      let stage = 'ready';
      if (card.id === 'repel' || card.id === 'shift') stage = 'piece';
      else if (card.target !== 'none') stage = 'target';
      this.selection = { uid, cardId: entry.id, stage };
      this.sound.play('select');
      this.renderAll();
      if (card.target !== 'none') {
        const count = this.engine.getCardTargets('player', card.id).length;
        this.toast(count > 22
          ? `已选【${card.name}】· 点击星盘选择目标`
          : `已选【${card.name}】· ${count} 个可选目标`, 'player');
      }
    }

    cancelSelection() {
      if (!this.selection) return;
      this.selection = null;
      this.hoverCard = null;
      this.renderAll();
      this.sound.play('select');
    }

    onBoardClick(r, c) {
      if (!this.engine || this.busy) return;
      const state = this.engine.state;
      if (state.status !== 'playing' || state.current !== 'player') return;

      if (this.selection) {
        const { cardId, stage, from } = this.selection;
        const targets = stage === 'direction' && from
          ? this.engine.getMoveDestinations(from.r, from.c)
          : this.engine.getCardTargets('player', cardId);
        const hit = targets.find(cell => cell.r === r && cell.c === c);
        if (!hit) {
          this.toast('这个目标不符合术式条件。', 'danger');
          return;
        }
        if (stage === 'piece') {
          this.selection.stage = 'direction';
          this.selection.from = { r, c };
          this.sound.play('select');
          this.renderAll();
          return;
        }
        if (stage === 'direction') {
          this.playSelected({ from: { ...from }, to: { r, c } });
          return;
        }
        this.playSelected({ r, c });
        return;
      }

      if (this.engine.canPlace('player', r, c)) {
        this.placePlayerStone(r, c);
      } else {
        const reason = this.engine.placementError('player', r, c);
        if (reason !== '现在不能落子') this.toast(reason, 'danger');
      }
    }

    placePlayerStone(r, c) {
      if (!this.engine) return;
      this.busy = true;
      this.renderAll();
      const result = this.engine.place('player', r, c);
      this.busy = false;
      if (!result.ok) {
        this.toast(result.reason || '无法落子', 'danger');
        this.renderAll();
        return;
      }
      this.selection = null;
      this.inspectCard = null;
      this.renderAll();
    }

    playSelected(payload) {
      if (!this.engine || !this.selection || this.busy) return;
      const { uid, cardId } = this.selection;
      const card = BY_ID[cardId];
      this.busy = true;
      this.renderAll();
      const result = this.engine.playCard('player', uid, payload);
      this.busy = false;
      if (!result.ok) {
        this.toast(result.reason || '术式发动失败', 'danger');
        this.renderAll();
        return;
      }
      this.selection = null;
      this.inspectCard = null;
      this.renderAll();
      if (result.nullified) {
        this.toast(`噤声！【${card.name}】被吞没`, 'danger');
      } else if (card.type === 'delayed') {
        this.toast(`秘式【${card.name}】已布下`, 'gold');
      }
      const state = this.engine.state;
      if (state.status === 'playing' && state.phase === 'post' && state.cardPlayed) {
        this.dom.endTurnBtn.focus({ preventScroll: true });
      }
    }

    endPlayerTurn() {
      if (!this.engine || this.busy || this.engine.state.current !== 'player') return;
      if (this.engine.state.phase !== 'post') return;
      this.selection = null;
      this.inspectCard = null;
      this.hoverCard = null;
      const result = this.engine.endTurn('player');
      if (!result.ok) {
        this.toast(result.reason, 'danger');
        return;
      }
      this.sound.play('turn');
      this.renderAll();
      this.runAI();
    }

    async runAI() {
      if (!this.engine || !this.ai || this.aiRunning) return;
      const state = this.engine.state;
      if (state.status !== 'playing' || state.current !== 'ai') return;
      const session = this.sessionId;
      this.aiRunning = true;
      this.busy = true;
      this.crowLine = CROW_THINKING[Math.floor(Math.random() * CROW_THINKING.length)];
      this.renderAll();
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const sleep = ms => new Promise(resolve => setTimeout(resolve, reduce ? Math.min(60, ms) : ms));
      try {
        await this.ai.takeTurn({ sleep });
      } catch (err) {
        console.error('AI turn failed', err);
        this.toast('墨鸦的推演中断了，星盘自动推进。', 'danger');
        try {
          const s = this.engine.state;
          if (s.status === 'playing' && s.current === 'ai') {
            if (s.phase === 'main') {
              const cells = this.engine.getPlacementCells('ai');
              if (cells.length) this.engine.place('ai', cells[0].r, cells[0].c);
            }
            if (this.engine.state.status === 'playing' && this.engine.state.phase === 'post') {
              this.engine.endTurn('ai');
            }
          }
        } catch (fallbackErr) {
          console.error(fallbackErr);
        }
      } finally {
        if (session !== this.sessionId || this.abandoned) return;
        this.aiRunning = false;
        this.busy = false;
        // 兜底：若 AI 因异常没有完成回合，自动推进，避免对局卡死。
        try {
          const s = this.engine.state;
          if (s.status === 'playing' && s.current === 'ai') {
            if (s.phase === 'main') {
              const cells = this.engine.getPlacementCells('ai');
              if (cells.length) this.engine.place('ai', cells[0].r, cells[0].c);
            }
            if (this.engine.state.status === 'playing' && this.engine.state.phase === 'post') {
              this.engine.endTurn('ai');
            }
          }
        } catch (fallbackErr) {
          console.error(fallbackErr);
        }
        this.renderAll();
        if (this.engine.state.status === 'playing' && this.engine.state.current === 'player') {
          this.sound.play('turn');
          this.toast('轮到你了', 'player');
        }
      }
    }

    resetBoardFx() {
      this.dom.winLine.classList.remove('is-show');
      this.dom.fxToast.classList.remove('is-show');
      this.dom.fxToast.textContent = '';
      this.dom.board.classList.remove('is-shaking', 'is-flashing', 'is-expanding', 'is-targeting');
      $$('.fx-particle', this.dom.boardFx).forEach(el => el.remove());
    }

    showBoardFx(text) {
      this.dom.fxToast.textContent = text;
      this.dom.fxToast.classList.remove('is-show');
      void this.dom.fxToast.offsetWidth;
      this.dom.fxToast.classList.add('is-show');
      clearTimeout(this._fxTimer);
      this._fxTimer = setTimeout(() => this.dom.fxToast.classList.remove('is-show'), 1500);
    }

    shakeBoard() {
      this.dom.board.classList.remove('is-shaking');
      void this.dom.board.offsetWidth;
      this.dom.board.classList.add('is-shaking');
      setTimeout(() => this.dom.board.classList.remove('is-shaking'), 340);
    }

    flashBoard() {
      this.dom.board.classList.remove('is-flashing');
      void this.dom.board.offsetWidth;
      this.dom.board.classList.add('is-flashing');
      setTimeout(() => this.dom.board.classList.remove('is-flashing'), 440);
    }

    spawnParticles(r, c, color, count = 10, big = false) {
      if (!this.engine) return;
      const size = this.engine.state.size;
      const left = ((c + 0.5) / size) * 100;
      const top = ((r + 0.5) / size) * 100;
      for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'fx-particle';
        p.style.left = `${left}%`;
        p.style.top = `${top}%`;
        p.style.background = color;
        p.style.width = `${big ? 3 + Math.random() * 4 : 2 + Math.random() * 2}px`;
        p.style.height = p.style.width;
        this.dom.boardFx.appendChild(p);
        const angle = Math.random() * Math.PI * 2;
        const dist = (big ? 24 : 12) + Math.random() * (big ? 40 : 22);
        p.animate([
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0.2)`,
            opacity: 0
          }
        ], {
          duration: 420 + Math.random() * 320,
          easing: 'steps(6)',
          fill: 'forwards'
        }).onfinish = () => p.remove();
      }
    }

    toast(message, tone = '') {
      const el = document.createElement('div');
      el.className = `toast${tone ? ` is-${tone}` : ''}`;
      el.textContent = message;
      this.dom.toastLayer.appendChild(el);
      setTimeout(() => {
        el.classList.add('is-out');
        setTimeout(() => el.remove(), 220);
      }, 2200);
    }

    addLog(html, cls = 'system') {
      const entry = document.createElement('div');
      entry.className = `log-entry is-${cls}`;
      entry.innerHTML = html;
      this.dom.logList.appendChild(entry);
      this.logs.push({ html, cls });
      this.logCount++;
      this.dom.logCount.textContent = pad2(this.logCount);
      while (this.dom.logList.children.length > 60) this.dom.logList.firstElementChild.remove();
      this.dom.logList.scrollTop = this.dom.logList.scrollHeight;
    }

    openModal(kind) {
      if (kind === 'help') {
        this.dom.modalKicker.textContent = 'HOW TO PLAY';
        this.dom.modalTitle.textContent = '玩法说明';
        this.dom.modalBody.innerHTML = this.helpHtml();
      } else {
        this.dom.modalKicker.textContent = '13 ARCANA';
        this.dom.modalTitle.textContent = '卡牌图鉴';
        this.dom.modalBody.innerHTML = this.codexHtml();
      }
      this.dom.modal.hidden = false;
      this._lastFocus = document.activeElement;
      document.body.style.overflow = 'hidden';
      setTimeout(() => $('.modal-close', this.dom.modal)?.focus(), 20);
    }

    closeModal() {
      if (this.dom.modal.hidden) return;
      this.dom.modal.hidden = true;
      document.body.style.overflow = '';
      if (this._lastFocus && this._lastFocus.focus) this._lastFocus.focus({ preventScroll: true });
    }

    helpHtml() {
      return `
        <section class="help-section">
          <h3>胜负条件</h3>
          <p>在星盘上率先完成 <b>7 枚同色星子连珠</b>（横、竖、斜均可）即获胜。落子会改变整条星路，术式则能直接改写规则。</p>
          <p>若你布下【六合改命】，你的胜利条件会永久变为 <b>6 子连珠</b>。双生星算 2 枚星子。</p>
        </section>
        <section class="help-section">
          <h3>一回合怎么走</h3>
          <div class="turn-flow">
            <div class="flow-step"><em>1</em><b>抽牌</b><span>回合开始自动抽 1 张，手牌上限 7。</span></div>
            <div class="flow-step is-key"><em>2</em><b>即时术式</b><span>落子前可发动 1 张即时牌；也可以跳过。</span></div>
            <div class="flow-step is-key"><em>3</em><b>落子</b><span>在星盘落下一枚星子。位移术式会代替落子。</span></div>
            <div class="flow-step"><em>4</em><b>延时秘式</b><span>落子后可布下 1 张秘式，然后结束回合。</span></div>
          </div>
          <div class="help-note"><b>每回合最多只打出一张牌。</b>你可以选择“即时牌 + 落子”，或“落子 + 秘式”，但不能两者都出。位移牌（逐客令 / 挪星步）使用后本回合不能落子。<br>例外的只有<b>基础关的墨鸦</b>：偶数回合它有「双术」，可以一张即时 + 一张延时。</div>
        </section>
        <section class="help-section">
          <h3>关卡与墨鸦的权能</h3>
          <p>标题画面里，<b>棋力</b>和<b>关卡</b>是两件事：棋力决定墨鸦算得多深，关卡决定它额外拥有哪些权能。</p>
          ${this.levelHelpHtml()}
        </section>
        <section class="help-section">
          <h3>明与暗</h3>
          <ul>
            <li><b>即时术式</b>：双方都会看到牌名与效果，适合正面压制。</li>
            <li><b>延时秘式</b>：布下后面朝下，对手只看到“暗牌”。直到触发、失效或对局结束才会揭晓。</li>
            <li>暗牌不会显示在对手的界面中；但棋盘上的<b>封禁格</b>、<b>定身格</b>与<b>已触发效果</b>是公开信息。</li>
            <li>“金身”可以免疫敌方的推动、爆裂与换影。己方布下的爆裂仍会摧毁自己的星子。</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>操作</h3>
          <ul>
            <li>点击手牌查看效果；选择即时牌后点击星盘目标，或点击右侧“发动术式”。</li>
            <li>位移牌需要先点星子，再点相邻的箭头格。</li>
            <li>快捷键：<b>1–7</b> 选牌，<b>E</b> 结束回合，<b>Esc</b> 取消选择。</li>
          </ul>
          <div class="help-note is-warn">网页 Demo 对原稿流程做了可玩化处理：三阶段保留，但每回合最多一张牌。人机“墨鸦”只读取公开信息与自己的暗牌，不会偷看你的秘式。</div>
          <button class="pixel-btn pixel-btn--ghost" type="button" data-action="open-codex">查看 13 张卡牌图鉴</button>
          ${this.engine && this.engine.state.status === 'playing' ? `
            <div class="help-actions">
              <button class="pixel-btn pixel-btn--ghost" type="button" data-action="restart">重新开始本局</button>
              <button class="pixel-btn pixel-btn--ghost" type="button" data-action="quit">返回标题</button>
            </div>` : ''}
        </section>`;
    }

    levelHelpHtml() {
      const levels = LEVEL_LIB.LEVELS || [];
      if (!levels.length) return '';
      const current = this.levelInfo;
      const rows = levels.map(level => {
        const skills = (LEVEL_LIB.skillsOf ? LEVEL_LIB.skillsOf(level.id) : []);
        const names = skills.length ? skills.map(skill => skill.name).join(' · ') : '无';
        const now = level.id === current.id ? ' <b>（当前）</b>' : '';
        return `<li><b>${level.name}</b>${now}：${level.subtitle} — 权能 ${names}</li>`;
      }).join('');
      const details = this.levelSkills.map(skill => `
        <div class="skill-entry">
          <div class="skill-head"><b>${skill.name}</b><span>${skill.tag}</span></div>
          <p>${skill.desc}</p>
          <p class="skill-detail">${skill.detail}</p>
          <p class="skill-hint">应对：${skill.hint}</p>
        </div>`).join('');
      return `<ul>${rows}</ul>${details || '<p>当前关卡没有额外权能。</p>'}`;
    }

    codexHtml() {
      const groups = [
        { type: 'instant', title: '即时术式 · 落子前发动 · 双方可见' },
        { type: 'delayed', title: '延时秘式 · 落子后布下 · 对手不可见' }
      ];
      return groups.map(group => `
        <section class="codex-group">
          <h3>${group.title}</h3>
          <div class="codex-grid">
            ${CARDS.filter(card => card.type === group.type).map(card => `
              <article class="codex-card" style="--accent:${card.accent}">
                <div class="codex-icon">${this.renderIcon(card)}</div>
                <div class="codex-text">
                  <h4>${card.name}<span>${card.epithet}</span></h4>
                  <p>${escapeHtml(card.desc)}</p>
                </div>
              </article>`).join('')}
          </div>
        </section>`).join('') + `
        <div class="help-note is-warn">所有卡牌各有 2 张，双方牌库独立。秘式被触发或过期后才会移出暗牌区。</div>`;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.sevenfold = new GameApp();
  });
})();
