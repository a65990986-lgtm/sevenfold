# BGM

## 正在用

`battle-loop.mp3`（3.9s 无缝循环，78KB）—— 来自 `promo/audio/chip-battle_1-5s.mp3`，
把尾部 80ms 和头部做等功率交叉淡化后裁掉，循环点不会“咔”一下。
`js/sound.js` 的 `playBgm('battle')` 在开局时播放、结算时淡出，和顶栏「♪ 音乐」开关联动。

音量为 BGM_VOLUME = 0.34，压过棋盘但不盖落子/术式音效。

---

以下是最初的四段候选，留着备选。


四段候选，都是 **44.1kHz 立体声 / 160kbps mp3**，用 `tools/bgm_synth.py` 合成（numpy 手写音色，无外部模型、无版权问题）。

| 文件 | 风格 | 调性 / BPM | 时长 | 特点 |
| --- | --- | --- | --- | --- |
| `chip-battle.mp3` | 8-bit 激斗 | A 小调 / 150 | 52s | 方波主旋律 + 三角波贝斯 + 噪声鼓；前奏 4 小节 → A 主题 → B 高八度变奏 → 4 小节 break → 主题回归。最贴像素 UI |
| `guofeng-war.mp3` | 国风电子战鼓 | D 羽调 / 132 | 52s | 太鼓切分 + 古筝分解（谐波拨弦）+ 笛子主旋律（带揉弦）；每 8 小节一记锣。和「星火/墨鸦/术式」的命名最搭 |
| `dark-synthwave.mp3` | 暗黑 synthwave | A 小调 / 140 | 56s | 失谐锯齿 pad + 脉冲贝斯 + 16 分琶音 + 四踩；第 25-28 小节撤鼓做 breakdown。压迫感最强 |
| `chip-taiko-hybrid.mp3` | 8-bit + 战鼓 | A 小调 / 144 | 54s | 芯片主旋律 + 战鼓低频 + 古筝点缀；四段式，B 段高八度叠低八度对位。工作量最大、质感最"燃" |

## 结构（都以 4/4、8 小节乐句为单位）

```
chip-battle     intro 4 | A 8 | B 8 | break 4 | A 8
guofeng-war     intro 4 | A 8 | B 8 | tail 8
synthwave       pad 进场 4 | 主体 24 | breakdown 4（无鼓）
hybrid          intro 4 | A 8 | B 8 | break 4 | A 8
```

每小节的 RMS 都验过，没有忽大忽小的空洞（前奏故意轻一档，作为淡入）。

## 重新生成 / 改参数

```bash
python tools/bgm_synth.py            # 全部
python tools/bgm_synth.py chip       # 只重出某一段（chip / guofeng / synthwave / hybrid）
```

想改的东西都在 `tools/bgm_synth.py` 里：

- 速度：每个 `compose_*` 开头的 `bpm`
- 调性：`A_MINOR` 字典 + 各段旋律的 MIDI 音高
- 音色：`wave()` 的波形/占空比、`adsr()` 包络、`lp()` 截止频率
- 长度：`bars`（小节数），段落划分在注释里

## 还没做的事

- **循环点**：现在每段末尾留了约 1 秒混响尾音，适合试听；要接进游戏当 BGM 得裁到循环点（或者直接接受 1 秒淡出）。
- **接入**：还没改 `js/sound.js`。定了哪段之后，加一条 loop 通道（开局淡入、结算淡出、受顶栏静音键控制）即可。
