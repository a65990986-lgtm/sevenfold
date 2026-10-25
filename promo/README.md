# 宣传片（七曜牌局）

## 成片
| 文件 | 说明 |
|---|---|
| `promo_30s_bgm.mp4` | **推荐版**：30 秒成片，配乐用游戏自带 `chip-battle.mp3`（1s 起循环） |
| `promo_30s.mp4` | 旧版：配乐是程序合成的 chiptune（132 BPM） |
| `promo_A_audio.mp4` / `promo_B_audio.mp4` | 15s + 15s 分段（旧配乐） |
| `gameplay_raw.mp4` | 实机录像原件（1600×1000，24s），可再剪 |

## 音频
| 文件 | 说明 |
|---|---|
| `audio/chip-battle_1-5s.mp3` | 从 `assets/audio/bgm/chip-battle.mp3` 精确截取的 **1.000–5.000s** |
| `audio/chip-battle_30s_bed.m4a` | 1s 起循环铺满 30s，含淡入淡出与 loudnorm(−14 LUFS) |

原始 BGM 未被修改，仍在 `assets/audio/bgm/chip-battle.mp3`。

## 实机录制
`python scripts/record_gameplay.py --seconds 20`
（chrome-headless-shell + CDP，自动开局→补给→落子→过回合→弃牌）

## 成片渲染
`python scripts/sevenfold_promo.py --only b`（只重渲染 B 段）
