#!/usr/bin/env python3
"""七曜牌局 · BGM 合成器（numpy 手写，无外部模型）

为什么自己合成：
  · 本机没有音乐生成模型（ComfyUI 只有视频用的音频 VAE）
  · 主题是"20×20 七子棋 + 术式卡牌 + 像素 UI"，需要 BPM/调性/循环点都可控
  · 免版权、文件小、以后改一个参数就能重出

输出：assets/audio/bgm/*.mp3（44.1kHz 立体声），外加一份 README 说明调性/时长。

用法：
  python tools/bgm_synth.py            # 全部渲染
  python tools/bgm_synth.py chip       # 只渲染某一段
"""
import os
import subprocess
import sys

import numpy as np

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "audio", "bgm")


# ---------------------------------------------------------------- 基础音色
def hz(midi):
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def n_of(sec):
    return int(round(sec * SR))


def wave(kind, freq, n, duty=0.5, phase=0.0):
    """kind: sq / saw / tri / sine"""
    t = np.arange(n) / SR
    ph = (phase + freq * t) % 1.0
    if kind == "sq":
        return np.where(ph < duty, 1.0, -1.0)
    if kind == "saw":
        return 2.0 * ph - 1.0
    if kind == "tri":
        return 4.0 * np.abs(ph - 0.5) - 1.0
    return np.sin(2.0 * np.pi * ph)


def vibrato_wave(kind, freq, n, rate=5.4, depth=0.006, phase=0.0):
    t = np.arange(n) / SR
    ph = (phase + freq * t + freq * depth / (2 * np.pi * rate) * np.sin(2 * np.pi * rate * t)) % 1.0
    if kind == "sine":
        return np.sin(2 * np.pi * ph)
    if kind == "sq":
        return np.where(ph < 0.5, 1.0, -1.0)
    return 2.0 * ph - 1.0


def adsr(n, a=0.004, d=0.05, s=0.72, r=0.05):
    a_n = max(1, min(n, int(a * SR)))
    d_n = max(1, min(n - a_n, int(d * SR))) if n > a_n else 0
    r_n = max(1, min(n - a_n - d_n, int(r * SR))) if n > a_n + d_n else 0
    s_n = max(0, n - a_n - d_n - r_n)
    parts = [
        np.linspace(0.0, 1.0, a_n, endpoint=False),
        np.linspace(1.0, s, d_n, endpoint=False) if d_n else np.array([]),
        np.full(s_n, s),
        np.linspace(s, 0.0, r_n) if r_n else np.array([]),
    ]
    env = np.concatenate(parts)
    if len(env) < n:
        env = np.concatenate([env, np.zeros(n - len(env))])
    return env[:n]


def perc_env(n, decay=0.25, attack=0.001):
    """打击类包络：瞬间起音 + 指数衰减"""
    t = np.arange(n) / SR
    return np.exp(-t / decay) * np.clip(t / max(attack, 1e-4), 0, 1)


def lp(x, fc, order=2):
    """FFT 一阶/二阶低通（够用且快，numpy 自带）"""
    n = len(x)
    if n < 8:
        return x
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    X *= 1.0 / np.sqrt(1.0 + (f / max(fc, 20)) ** (2 * order))
    return np.fft.irfft(X, n)


def hp(x, fc, order=2):
    n = len(x)
    if n < 8:
        return x
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    X *= 1.0 / np.sqrt(1.0 + (max(fc, 20) / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X, n)


def reverb(x, decay=1.5, mix=0.22, seed=7):
    n = int(decay * SR)
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR / (decay / 6.0))
    ir = lp(ir, 3500, 1)
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    L = len(x) + n - 1
    wet = np.fft.irfft(np.fft.rfft(x, L) * np.fft.rfft(ir, L))[: len(x)]
    return x * (1 - mix) + wet * mix * 9.0


# ---------------------------------------------------------------- 鼓组
def kick(dur=0.32, f0=135.0, f1=46.0, decay=0.16):
    n = n_of(dur)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.045)
    ph = np.cumsum(f) / SR
    body = np.sin(2 * np.pi * ph) * np.exp(-t / decay)
    click = np.random.default_rng(1).standard_normal(n) * np.exp(-t / 0.004) * 0.5
    return (body + click) * 0.95


def snare(dur=0.22, tone=190.0):
    n = n_of(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(2)
    noise = hp(rng.standard_normal(n), 1800, 1) * np.exp(-t / 0.075)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.05) * 0.6
    return (noise * 0.75 + body) * 0.85


def hat(dur=0.06, decay=0.018):
    n = n_of(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(3)
    return hp(rng.standard_normal(n), 7000, 2) * np.exp(-t / decay) * 0.55


def taiko(dur=0.55, f=62.0, decay=0.22):
    """战鼓：低频鼓皮 + 一点皮面噪声"""
    n = n_of(dur)
    t = np.arange(n) / SR
    ph = np.cumsum(f * (1 + 0.25 * np.exp(-t / 0.03))) / SR
    body = np.sin(2 * np.pi * ph) * np.exp(-t / decay)
    rng = np.random.default_rng(4)
    skin = lp(rng.standard_normal(n), 900, 1) * np.exp(-t / 0.03) * 0.35
    return (body * 1.0 + skin) * 0.9


def gong(dur=2.4):
    n = n_of(dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(5)
    noise = rng.standard_normal(n) * np.exp(-t / 0.9)
    tone = (np.sin(2 * np.pi * 82 * t) + 0.5 * np.sin(2 * np.pi * 123 * t)) * np.exp(-t / 1.1)
    return lp(noise * 0.6 + tone * 0.7, 2600, 1) * 0.55


def pluck(freq, dur=1.2, harmonics=9, bright=1.0, decay=5.0):
    """古筝/竖琴感的拨弦：谐波叠加 + 高次谐波衰减更快 + 噪声拨片"""
    n = n_of(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, harmonics + 1):
        fk = freq * k
        if fk > SR / 2 - 1000:
            break
        amp = (1.0 / k ** 1.25) * (bright if k == 1 else bright * 0.9)
        y += amp * np.sin(2 * np.pi * fk * t + 0.3 * k) * np.exp(-t * (decay * (0.55 + 0.12 * k)))
    rng = np.random.default_rng(6)
    pick = hp(rng.standard_normal(n), 2500, 1) * np.exp(-t / 0.012) * 0.25
    return (y + pick) * 0.5


# ---------------------------------------------------------------- 场景装配
class Song:
    def __init__(self, bpm, bars, beats_per_bar=4):
        self.bpm = bpm
        self.spb = 60.0 / bpm          # 每拍秒数
        self.bars = bars
        self.total = self.spb * beats_per_bar * bars
        self.len = n_of(self.total) + SR
        self.tracks = {}

    def track(self, name):
        if name not in self.tracks:
            self.tracks[name] = np.zeros(self.len)
        return self.tracks[name]

    def add(self, name, buf, beat, gain=1.0):
        if name not in self.tracks:
            self.tracks[name] = np.zeros(self.len)
        buf = np.asarray(buf, dtype=float) * gain
        start = n_of(beat * self.spb)
        end = min(self.len, start + len(buf))
        if start >= self.len:
            return
        self.tracks[name][start:end] += buf[: end - start]

    def note(self, name, kind, midi, beat, beats, gain=1.0, duty=0.5, env=None, vib=False, fc=None):
        dur = beats * self.spb
        n = n_of(dur)
        if n <= 0:
            return
        f = hz(midi)
        sig = vibrato_wave(kind, f, n) if vib else wave(kind, f, n, duty)
        e = env if env is not None else adsr(n, a=0.004, d=0.05, s=0.7, r=0.05)
        sig = sig * e
        if fc:
            sig = lp(sig, fc, 1)
        self.add(name, sig, beat, gain)

    def render(self):
        # 混响总线
        master = np.zeros(self.len)
        for name, buf in self.tracks.items():
            if name in ("kit", "bass"):      # 节奏声部少给混响
                master += buf
            else:
                master += buf
        send = np.zeros(self.len)
        for name in ("lead", "pad", "pluck", "arp", "dizi"):
            if name in self.tracks:
                send += self.tracks[name]
        wet = reverb(send, decay=1.7, mix=0.35)
        mix = master * 0.85 + wet * 0.55
        # 轻微限幅 + 归一
        mix = np.tanh(mix * 0.9) / np.tanh(0.9)
        peak = np.max(np.abs(mix)) or 1.0
        mix = mix / peak * 0.72
        # 简易立体声：右声道略延迟，给点宽度
        d = n_of(0.008)
        left = mix
        right = np.concatenate([np.zeros(d), mix[:-d]])
        return np.stack([left, right], axis=1)


def write_wav(path, stereo):
    pcm = np.clip(stereo, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    import wave as wavemod
    with wavemod.open(path, "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


def to_mp3(wav, mp3, bitrate="160k"):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame",
         "-b:a", bitrate, "-ar", str(SR), mp3],
        check=True,
    )
    os.remove(wav)


# ---------------------------------------------------------------- 四段曲子
A_MINOR = {"Am": [57, 60, 64], "F": [53, 57, 60], "C": [48, 52, 55], "G": [55, 59, 62]}


def chord_seq(bars_pattern, step):
    """[(chord, 小节数)] → [(beat, chord)]"""
    out, beat = [], 0.0
    for name, nbars in bars_pattern:
        out.append((beat, name))
        beat += nbars * 4
    return out


def compose_chip():
    """8-bit 激斗：A 小调 150 BPM，方波主旋律 + 三角贝斯 + 噪声鼓

    段落：前奏 4 小节（鼓+贝斯）→ A 8（主题）→ B 8（高八度变奏）
          → break 4（只剩鼓+琶音）→ A 8（回到主题）
    """
    bpm, bars = 150, 32
    s = Song(bpm, bars)
    prog = [("Am", 2), ("F", 2), ("C", 2), ("G", 2)]

    # 贝斯：32 小节全铺，八分音符根音 + 每 4 个跳八度
    for cyc in range(4):
        for ci, (name, _) in enumerate(prog):
            root = A_MINOR[name][0] - 12
            for i in range(16):
                beat = cyc * 32 + ci * 8 + i * 0.5
                m = root if i % 4 != 3 else root + 12
                n = n_of(0.45 * s.spb)
                s.add("bass", wave("tri", hz(m), n) * perc_env(n, 0.12), beat, 0.30)

    # 琶音：32 小节全铺（16 分），break 段留 4 小节
    for cyc in range(4):
        for ci, (name, _) in enumerate(prog):
            tones = A_MINOR[name]
            pat = [tones[0], tones[1], tones[2], tones[0] + 12,
                   tones[2], tones[1], tones[0], tones[1]]
            for i in range(32):
                beat = cyc * 32 + ci * 8 + i * 0.25
                s.note("arp", "sq", pat[i % 8] + 12, beat, 0.16, gain=0.05, duty=0.25,
                       env=perc_env(n_of(0.16 * s.spb), 0.04))

    # 主题动机（8 小节 = 32 拍）
    hook = [
        (69, 1), (72, 1), (76, 1), (81, 1),
        (79, 1), (76, 1), (72, 1), (76, 1),
        (77, 1), (81, 1), (84, 1), (81, 1),
        (79, 2), (74, 2),
        (72, 1), (76, 1), (79, 1), (84, 1),
        (83, 1), (79, 1), (76, 1), (79, 1),
        (74, 1), (77, 1), (81, 1), (86, 1),
        (84, 2), (81, 2),
    ]

    def hook_at(offset, transpose=0, gain=0.26, track="lead", duty=0.5):
        beat = offset
        for m, d in hook:
            s.note(track, "sq", m + transpose, beat, d * 0.95, gain=gain, duty=duty,
                   env=adsr(n_of(d * 0.95 * s.spb), 0.004, 0.04, 0.75, 0.06))
            beat += d

    hook_at(16)                              # A：第 5 小节
    hook_at(48, transpose=12, gain=0.30)     # B：高八度变奏（抬电平，别比 A 弱）
    hook_at(48, transpose=0, gain=0.10, track="lead3", duty=0.125)   # B：同度薄对位
    hook_at(48, transpose=-12, gain=0.10, track="lead2", duty=0.125)  # B：低八度对位
    hook_at(96)                              # 回到主题（第 25 小节）

    # 鼓：前奏 4 小节只走 kick+hat，之后加军鼓
    for bar in range(bars):
        b0 = bar * 4
        s.add("kit", kick(), b0, 0.9)
        s.add("kit", kick(), b0 + 2, 0.9)
        if bar >= 4:
            s.add("kit", snare(), b0 + 1, 0.55)
            s.add("kit", snare(), b0 + 3, 0.55)
        for i in range(8):
            s.add("kit", hat(), b0 + i * 0.5, 0.30 if i % 2 == 0 else 0.18)
        if bar % 8 == 7:
            for i in range(4):
                s.add("kit", snare(), b0 + 3 + i * 0.25, 0.35)
    return s, "chip-battle"


def compose_guofeng():
    """国风电子：D 羽调 132 BPM，太鼓 + 古筝 + 笛子"""
    bpm, bars = 132, 28
    s = Song(bpm, bars)
    # 古筝：Dm - Bb - F - C 的分解和弦
    chords = [[50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55]]
    for cyc in range(7):
        for ci, tones in enumerate(chords):
            base = cyc * 16 + ci * 4
            pat = [tones[0], tones[1], tones[2], tones[0] + 12,
                   tones[1] + 12, tones[2], tones[0] + 12, tones[1]]
            for i, m in enumerate(pat * 2):
                s.add("pluck", pluck(hz(m + 12), dur=1.1, decay=6.0), base + i * 0.25, 0.30)
    # 太鼓：切分重拍
    taiko_pat = [(0, 1.0), (1.5, 0.6), (2, 0.85), (3.25, 0.7)]
    for bar in range(bars):
        b0 = bar * 4
        for off, g in taiko_pat:
            s.add("kit", taiko(), b0 + off, g * 0.95)
        if bar % 4 == 3:
            s.add("kit", taiko(f=48, decay=0.4), b0 + 3.5, 0.9)
    # 锣：第 1/9/17/25 小节
    for bar in (0, 8, 16, 24):
        s.add("kit", gong(), bar * 4, 0.75)
    # 低音持续 + 走句
    drone = [38, 38, 34, 34, 41, 41, 36, 36]
    for bar in range(bars):
        m = drone[bar % 8]
        s.note("bass", "tri", m, bar * 4, 3.7, gain=0.26, env=adsr(n_of(3.7 * s.spb), 0.05, 0.2, 0.8, 0.2))
    # 笛子主旋律（五声：D F G A C）
    melody = [
        (74, 1.5), (77, 0.5), (79, 1), (81, 1),
        (79, 1.5), (77, 0.5), (74, 1), (72, 1),
        (74, 1), (77, 1), (79, 1.5), (81, 0.5),
        (84, 2), (81, 1), (79, 1),
        (77, 1), (74, 1), (72, 1), (74, 0.5), (77, 0.5),
        (79, 2), (77, 1), (74, 1),
        (72, 1), (74, 1), (77, 1.5), (79, 0.5),
        (81, 2), (79, 1), (77, 1),
    ]
    beat = 16
    for rep in range(2):
        for m, d in melody:
            s.note("dizi", "sine", m, beat, d * 0.96, gain=0.22, vib=True,
                   env=adsr(n_of(d * 0.96 * s.spb), 0.06, 0.12, 0.8, 0.12))
            beat += d
    # 战鼓滚奏（第 17 小节）
    for i in range(16):
        s.add("kit", taiko(f=70, decay=0.12), 64 + i * 0.125, 0.15 + 0.02 * i)
    return s, "guofeng-war"


def compose_synthwave():
    """暗黑 synthwave：A 小调 140 BPM，脉冲贝斯 + 宽 pad + 16 分琶音"""
    bpm, bars = 140, 32
    s = Song(bpm, bars)
    prog = [("Am", 2), ("F", 2), ("C", 2), ("G", 2)]
    # Pad：每个和弦 8 拍，失谐三角波叠加
    for cyc in range(4):
        for name, nbars in prog:
            beat = cyc * 32 + prog.index((name, nbars)) * 8
            tones = A_MINOR[name]
            for k, m in enumerate(tones + [tones[0] + 12]):
                n = n_of(8 * s.spb)
                dur_env = adsr(n, a=0.6, d=0.4, s=0.85, r=1.2)
                for det in (-0.12, 0.0, 0.12):
                    sig = wave("saw", hz(m + 24) * (1 + det / 100), n) * dur_env
                    s.add("pad", lp(sig, 1800, 1), beat, 0.05)
    # 脉冲贝斯
    for cyc in range(4):
        for ci, (name, _) in enumerate(prog):
            root = A_MINOR[name][0] - 24
            for i in range(16):
                beat = cyc * 32 + ci * 8 + i * 0.5
                m = root if i % 4 != 3 else root + 12
                n = n_of(0.42 * s.spb)
                sig = lp(wave("saw", hz(m), n), 420, 1) * perc_env(n, 0.09)
                s.add("bass", sig, beat, 0.32)
    # 16 分琶音（带一点延迟感）
    for cyc in range(4):
        for ci, (name, _) in enumerate(prog):
            tones = A_MINOR[name]
            pat = [tones[0], tones[2], tones[1], tones[2], tones[0] + 12, tones[2], tones[1], tones[2]]
            for i in range(32):
                beat = cyc * 32 + ci * 8 + i * 0.25
                s.note("arp", "sq", pat[i % 8] + 24, beat, 0.16, gain=0.05, duty=0.35,
                       env=perc_env(n_of(0.16 * s.spb), 0.05))
    # 鼓：四踩 + 反拍军鼓（第 25-28 小节 breakdown 撤掉）
    for bar in range(bars):
        b0 = bar * 4
        if 24 <= bar < 28:
            continue
        for k in range(4):
            s.add("kit", kick(decay=0.14), b0 + k, 0.85)
        s.add("kit", snare(), b0 + 1, 0.5)
        s.add("kit", snare(), b0 + 3, 0.5)
        for i in range(8):
            s.add("kit", hat(decay=0.012), b0 + i * 0.5, 0.22)
    # breakdown 处的滤波扫动
    n2 = n_of(4 * s.spb)
    rng2 = np.random.default_rng(11)
    riser = rng2.standard_normal(n2) * np.linspace(0, 1, n2) ** 3 * 0.10
    s.add("pad", hp(riser, 800, 1), 92, 1.0)
    # 开场噪声升起
    n = n_of(4 * s.spb)
    rng = np.random.default_rng(9)
    sweep = hp(rng.standard_normal(n), 400, 1) * np.linspace(0, 1, n) ** 2 * 0.12
    s.add("pad", sweep, 0, 1.0)
    return s, "dark-synthwave"


def compose_hybrid():
    """8-bit + 战鼓：144 BPM，芯片主旋律 + 太鼓低频 + 古筝点缀

    段落：前奏 4（太鼓+贝斯）→ A 8（主题）→ B 8（古筝层+对位）→ break 4 → A 8
    """
    bpm, bars = 144, 32
    s = Song(bpm, bars)
    prog = [("Am", 2), ("F", 2), ("C", 2), ("G", 2)]

    # 芯片贝斯
    for cyc in range(4):
        for ci, (name, _) in enumerate(prog):
            root = A_MINOR[name][0] - 24
            for i in range(16):
                beat = cyc * 32 + ci * 8 + i * 0.5
                m = root if i % 4 != 3 else root + 12
                n = n_of(0.44 * s.spb)
                s.add("bass", wave("tri", hz(m), n) * perc_env(n, 0.12), beat, 0.28)

    # 前奏：太鼓滚奏 + 踩镲，把开场撑起来
    for i in range(128):                       # 4 小节的战鼓滚奏，逐渐加密加重
        s.add("kit", taiko(f=68, decay=0.09), i * 0.125, 0.08 + 0.16 * (i / 127))
    for i in range(32):
        s.add("kit", hat(), i * 0.5, 0.18)
    for bar in range(4):                       # 前奏的古筝分解，别让第 2/4 小节空掉
        tones = A_MINOR["Am"] if bar < 2 else A_MINOR["F"]
        for k, m in enumerate(tones):
            s.add("pluck", pluck(hz(m + 12), dur=0.9, decay=7.0), bar * 4 + k * 0.5, 0.10)
    # 太鼓：全曲，但前奏只留重拍
    for bar in range(bars):
        b0 = bar * 4
        s.add("kit", taiko(), b0, 0.9)
        s.add("kit", taiko(), b0 + 2, 0.8)
        if bar >= 4:
            if bar % 2 == 1:
                s.add("kit", taiko(f=52, decay=0.3), b0 + 3.5, 0.7)
            s.add("kit", kick(decay=0.1), b0 + 1, 0.35)
            s.add("kit", snare(), b0 + 1, 0.3)
        if bar % 8 == 7:
            for i in range(8):
                s.add("kit", taiko(f=70, decay=0.1), b0 + 2 + i * 0.25, 0.18 + 0.02 * i)

    # 古筝点缀：A/B 段每 2 小节一次上行
    for cyc in range(4):
        for ci, (name, _) in enumerate(prog):
            tones = A_MINOR[name]
            base = cyc * 32 + ci * 8
            gain = 0.12 if base < 16 else 0.20   # 前奏轻一点，别空着
            for i, m in enumerate([tones[0], tones[1], tones[2], tones[1] + 12]):
                s.add("pluck", pluck(hz(m + 12), dur=0.9, decay=7.0), base + 2 + i * 0.25, gain)

    # 主旋律
    hook = [
        (81, 0.5), (81, 0.5), (79, 0.5), (81, 0.5), (84, 1), (81, 1),
        (79, 0.5), (76, 0.5), (79, 0.5), (81, 0.5), (76, 1), (72, 1),
        (74, 0.5), (77, 0.5), (81, 0.5), (84, 0.5), (86, 1), (84, 1),
        (81, 0.5), (79, 0.5), (77, 0.5), (74, 0.5), (72, 2),
    ]

    def hook_at(offset, transpose=0, gain=0.24, track="lead", duty=0.25):
        beat = offset
        for m, d in hook:
            s.note(track, "sq", m + transpose, beat, d * 0.92, gain=gain, duty=duty,
                   env=adsr(n_of(d * 0.92 * s.spb), 0.003, 0.03, 0.8, 0.05))
            beat += d

    # A 段：第 5-12 小节（动机 4 小节，重复两次）
    hook_at(16); hook_at(32)
    # B 段：第 13-20 小节（高八度 + 低八度对位）
    hook_at(48, transpose=12, gain=0.26); hook_at(64, transpose=12, gain=0.26)
    hook_at(48, transpose=-12, gain=0.10, track="lead2", duty=0.125)
    hook_at(64, transpose=-12, gain=0.10, track="lead2", duty=0.125)
    # A 回归：第 25-32 小节
    hook_at(96); hook_at(112)
    return s, "chip-taiko-hybrid"


PIECES = {
    "chip": compose_chip,
    "guofeng": compose_guofeng,
    "synthwave": compose_synthwave,
    "hybrid": compose_hybrid,
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    which = sys.argv[1:] or list(PIECES)
    for key in which:
        fn = PIECES.get(key)
        if not fn:
            print(f"未知片段 {key}，可选：{', '.join(PIECES)}")
            continue
        song, name = fn()
        stereo = song.render()
        wav = os.path.join(OUT_DIR, name + ".wav")
        mp3 = os.path.join(OUT_DIR, name + ".mp3")
        write_wav(wav, stereo)
        to_mp3(wav, mp3)
        dur = len(stereo) / SR
        print(f"{name:20s} {dur:5.1f}s  {os.path.getsize(mp3)/1024:6.0f} KB  {song.bpm} BPM")


if __name__ == "__main__":
    main()
