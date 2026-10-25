/* 七曜牌局 · MP3 音效管理 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.SevenfoldSound = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CUES = {
    select: 'assets/audio/select.mp3',
    hover: 'assets/audio/hover.mp3',
    deny: 'assets/audio/deny.mp3',
    modal: 'assets/audio/modal.mp3',
    start: 'assets/audio/start.mp3',
    manaRefill: 'assets/audio/manaRefill.mp3',
    offer: 'assets/audio/offer.mp3',
    draftPick: 'assets/audio/draftPick.mp3',
    draw: 'assets/audio/draw.mp3',
    discard: 'assets/audio/discard.mp3',
    turn: 'assets/audio/turn.mp3',
    turnEnd: 'assets/audio/turnEnd.mp3',
    placePlayer: 'assets/audio/placePlayer.mp3',
    placeAi: 'assets/audio/placeAi.mp3',
    move: 'assets/audio/move.mp3',
    seal: 'assets/audio/seal.mp3',
    twin: 'assets/audio/twin.mp3',
    ruin: 'assets/audio/ruin.mp3',
    swap: 'assets/audio/swap.mp3',
    subvert: 'assets/audio/subvert.mp3',
    silence: 'assets/audio/silence.mp3',
    nullify: 'assets/audio/nullify.mp3',
    sixwin: 'assets/audio/sixwin.mp3',
    retire: 'assets/audio/retire.mp3',
    extra: 'assets/audio/extra.mp3',
    charge: 'assets/audio/charge.mp3',
    store: 'assets/audio/store.mp3',
    discount: 'assets/audio/discount.mp3',
    win: 'assets/audio/win.mp3',
    lose: 'assets/audio/lose.mp3',
    drawGame: 'assets/audio/drawGame.mp3'
  };


  const BGM = {
    battle: 'assets/audio/bgm/battle-loop.mp3'
  };
  const BGM_VOLUME = 0.34;      // 压住音乐，别盖过落子和术式

  class SoundManager {
    constructor(options = {}) {
      this.volume = Number.isFinite(options.volume) ? options.volume : 0.68;
      this.muted = !!options.muted;
      this.pools = new Map();
      this.lastPlayed = new Map();
    }

    setMuted(muted) {
      this.muted = !!muted;
      for (const pool of this.pools.values()) {
        for (const audio of pool) audio.muted = this.muted;
      }
      if (this.bgm) this.bgm.muted = this.muted;
    }

    // 对战音乐：循环播放，静音时跟着静音
    playBgm(name = 'battle') {
      if (typeof Audio === 'undefined' || !BGM[name]) return null;
      if (this.bgm) {
        if (!this.bgm.paused) return this.bgm;
        const retry = this.bgm.play();
        if (retry && typeof retry.catch === 'function') retry.catch(() => {});
        return this.bgm;
      }
      const audio = new Audio(encodeURI(BGM[name]));
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = this.muted ? 0 : BGM_VOLUME;
      audio.muted = this.muted;
      this.bgm = audio;
      const playback = audio.play();
      if (playback && typeof playback.catch === 'function') playback.catch(() => {});
      return audio;
    }

    stopBgm(options = {}) {
      if (!this.bgm) return;
      const fade = Number(options.fade) || 0;
      const target = this.bgm;
      if (fade > 0) {
        const step = BGM_VOLUME / (fade / 40);
        const timer = setInterval(() => {
          if (!target.volume) return clearInterval(timer);
          target.volume = Math.max(0, target.volume - step);
        }, 40);
        setTimeout(() => {
          clearInterval(timer);
          try { target.pause(); target.currentTime = 0; } catch (_) { /* ignore */ }
        }, fade);
        return;
      }
      try { target.pause(); target.currentTime = 0; } catch (_) { /* ignore */ }
    }

    play(name, options = {}) {
      if (this.muted || !CUES[name] || typeof Audio === 'undefined') return null;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const throttle = Number(options.throttle) || 0;
      if (throttle && now - (this.lastPlayed.get(name) || 0) < throttle) return null;
      this.lastPlayed.set(name, now);
      const delay = Number(options.delay) || 0;
      if (delay > 0) return setTimeout(() => this._playNow(name, options), delay);
      return this._playNow(name, options);
    }

    _playNow(name, options) {
      const pool = this.pools.get(name) || [];
      let audio = pool.find(item => item.paused || item.ended);
      if (!audio) {
        audio = new Audio(encodeURI(CUES[name]));
        audio.preload = 'auto';
        pool.push(audio);
        this.pools.set(name, pool);
      }
      audio.muted = this.muted;
      audio.volume = Math.max(0, Math.min(1, this.volume * (Number(options.volume) || 1)));
      try { audio.currentTime = 0; } catch (_) { /* metadata may not be ready yet */ }
      const playback = audio.play();
      if (playback && typeof playback.catch === 'function') playback.catch(() => {});
      return audio;
    }
  }

  return { CUES, SoundManager };
});
