#!/usr/bin/env node
/* 七曜牌局 · 无头界面冒烟测试（jsdom）
 *
 * 为什么要有：这个项目没有构建、没有框架，DOM 接线全靠手写。
 * 2026-10 就出过一次 cacheDom 漏注册 12 个元素，导致「LLM 设置」按钮、
 * 掉线面板、音乐开关、难度立绘切换全是死的——而且不报错，纯靠肉眼发现。
 *
 * 需要 jsdom（不进游戏本体，只是开发期工具）：
 *   npm i jsdom --cache /tmp/npmcache
 *   node tools/ui-smoke.js
 */
'use strict';
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (err) {
  console.log('需要先装 jsdom：npm i jsdom --cache /tmp/npmcache');
  process.exit(2);
}
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const out = [];
const t = (name, fn) => {
  try { const r = fn(); out.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : String(r)]); }
  catch (e) { out.push(['ERR ', name, e.message]); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const modeBtn = (w, mode) => [...w.document.querySelectorAll('.mode-btn[data-mode]')].find(b => b.dataset.mode === mode);

async function boot(withKeys = true, fetchImpl = null) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.com/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.scrollTo = () => {};
  if (fetchImpl) window.fetch = fetchImpl;
  if (withKeys) {
    window.localStorage.setItem('sevenfold.llm', JSON.stringify({
      player: { preset: 'deepseek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', apiKey: 'sk-a', thinking: false },
      ai: { preset: 'xiaomi', baseURL: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', apiKey: 'sk-b', thinking: false }
    }));
  }
  for (const f of ['js/cards.js', 'js/engine.js', 'js/ai.js', 'js/sound.js', 'js/llm.js', 'js/ui.js'])
    window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  // jsdom 自己会派发 DOMContentLoaded，等它（手动再派发会建出第二个 GameApp）
  for (let i = 0; i < 50 && !window.sevenfold; i++) await sleep(20);
  return window;
}

(async () => {
  // ---- A. 基础接线（未配置过，所以弹窗应预填 DeepSeek 默认值）
  {
    const w = await boot(false);
    const app = w.sevenfold;
    const $ = s => w.document.querySelector(s);
    t('GameApp 实例化', () => !!app);
    t('标题页可见', () => !$('#titleScreen').hidden);
    t('cacheDom 关键键都为元素', () => {
      const keys = ['llmSettingsBtn','llmSettingsState','soundBtn','modeBadge','titleArt','oppDeckPanel','llmError','llmRetryBtn','llmAbortBtn'];
      const bad = keys.filter(k => !app.dom[k]);
      return bad.length ? '缺: ' + bad.join(',') : true;
    });
    t('点 LLM 设置能开弹窗', () => { click(w, $('#llmSettingsBtn')); return !$('#modal').hidden; });
    t('弹窗预填 DeepSeek 地址与模型', () => {
      const base = w.document.querySelector('[data-base="ai"]').value;
      const model = w.document.querySelector('[data-model="ai"]').value;
      return base === 'https://api.deepseek.com/v1' && model === 'deepseek-v4-flash' ? true : base + ' | ' + model;
    });
    t('没有「去申请密钥」链接', () => !w.document.querySelector('[data-keyurl]') && !w.document.querySelector('.llm-keyhint'));
    t('保存后状态变「已配置」', () => {
      w.document.querySelector('[data-key="ai"]').value = 'sk-test';
      w.document.querySelector('[data-key="player"]').value = 'sk-test';
      click(w, $('#llmSaveBtn'));
      return $('#llmSettingsState').textContent.includes('已配置') ? true : $('#llmSettingsState').textContent;
    });
    t('顶栏音乐开关可点', () => {
      const btn = $('#soundBtn');
      const before = btn.getAttribute('aria-pressed');
      click(w, btn);
      return btn.getAttribute('aria-pressed') !== before ? true : '没变化';
    });
  }
  // ---- B. Boss 关
  {
    const w = await boot();
    t('Boss：能开局', () => { click(w, modeBtn(w, 'boss')); return !w.document.querySelector('#app').classList.contains('is-title'); });
    t('Boss：血条显示 ◆◆', () => { const el = w.document.querySelector('#bossHp'); return el && el.textContent === '◆◆' ? true : (el ? el.textContent : '没元素'); });
    t('Boss：血条可见', () => !w.document.querySelector('#bossHpBox').hidden);
    t('Boss：徽章是 Boss', () => w.document.querySelector('#modeBadge').textContent === 'Boss' ? true : w.document.querySelector('#modeBadge').textContent);
    t('Boss：卡背用 boss 立绘', () => {
      const v = w.document.querySelector('#oppDeckPanel').style.getPropertyValue('--card-art');
      return v.includes('boss.webp') ? true : v;
    });
  }
  // ---- C. 立绘随悬停切换
  {
    const w = await boot();
    const art = () => w.document.querySelector('#titleArt').style.getPropertyValue('--title-art');
    const before = art();
    w.document.querySelector('[data-mode="easy"]').dispatchEvent(new w.MouseEvent('mouseenter'));
    const easy = art();
    w.document.querySelector('[data-mode="boss"]').dispatchEvent(new w.MouseEvent('mouseenter'));
    const boss = art();
    t('立绘：悬停基础切 easy.webp', () => easy.includes('easy.webp') ? true : easy);
    t('立绘：悬停 Boss 切 boss.webp', () => boss.includes('boss.webp') ? true : boss);
    t('立绘：初始不是空的', () => before.length > 0);
  }
  // ---- D. LLM 对战（两边 LLM）
  {
    const w = await boot();
    click(w, modeBtn(w, 'llmpk'));
    t('LLM 对战：能开局', () => !w.document.querySelector('#app').classList.contains('is-title'));
    t('LLM 对战：两边都是 LLM', () => JSON.stringify(w.sevenfold.seatKind) === '{"player":"llm","ai":"llm"}' ? true : JSON.stringify(w.sevenfold.seatKind));
    t('LLM 对战：徽章正确', () => w.document.querySelector('#modeBadge').textContent === 'LLM 对战' ? true : w.document.querySelector('#modeBadge').textContent);
    await sleep(700);
    t('LLM 对战：没网络时弹掉线面板（不降级）', () => {
      const panel = w.document.querySelector('#llmError');
      const note = w.document.querySelector('#llmErrorText').textContent;
      return panel.hidden === false && note.length > 0 ? true : '面板 hidden / 没文字';
    });
  }
  // ---- D2. LLM 对战：两个模型都会行动（回归测试：渲染不能重置座位）
  {
    const calls = [];
    const fakeFetch = (url, init) => {
      const body = JSON.parse(init.body);
      const user = body.messages[1].content;
      const isDraft = user.includes('可选补给');
      calls.push(`${isDraft ? 'draft' : 'turn'}:${body.model}`);
      const content = isDraft
        ? '{"pick":[1,2],"why":"测试"}'
        : '{"why":"测试","place":1,"cards":[],"discard":[]}';
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
    };
    const w = await boot(true, fakeFetch);
    click(w, modeBtn(w, 'llmpk'));
    await sleep(2600);
    t('LLM 对战：两个模型都出了手', () => {
      const models = new Set(calls.map(c => c.split(':')[1]));
      return calls.length >= 4 && models.size === 2 ? true : `只有 ${calls.length} 次：${calls.join(',')}`;
    });
    t('LLM 对战：渲染后座位没被重置', () => {
      w.sevenfold.requestRender();
      return JSON.stringify(w.sevenfold.seatKind) === '{"player":"llm","ai":"llm"}' ? true : JSON.stringify(w.sevenfold.seatKind);
    });
    t('LLM 对战：棋盘上真的落下子', () => {
      const n = w.sevenfold.engine.state.stats.stonesPlaced;
      return n >= 2 ? true : '只落了 ' + n + ' 子';
    });
  }

  // ---- E. 挑战 LLM（人 vs LLM）
  {
    const w = await boot();
    click(w, modeBtn(w, 'llm'));
    t('挑战 LLM：人是人类、对面 LLM', () => w.sevenfold.seatKind.player === 'human' && w.sevenfold.seatKind.ai === 'llm' ? true : JSON.stringify(w.sevenfold.seatKind));
  }
  // ---- F. 未配置时的闸门
  {
    const w = await boot(false);
    click(w, modeBtn(w, 'llm'));
    t('未配置：弹设置、不进对局', () => (!w.document.querySelector('#modal').hidden && w.document.querySelector('#app').classList.contains('is-title')) ? true : 'modal hidden=' + w.document.querySelector('#modal').hidden);
    t('未配置：标题页状态是「未配置」', () => w.document.querySelector('#llmSettingsState').textContent === '未配置' ? true : w.document.querySelector('#llmSettingsState').textContent);
  }

  for (const [s, n, e] of out) console.log(s, n, e ? '→ ' + e : '');
  const pass = out.filter(r => r[0] === 'PASS').length;
  console.log(`\n结果：${pass} 通过，${out.length - pass} 失败`);
  if (pass !== out.length) process.exitCode = 1;
})();
