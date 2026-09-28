#!/usr/bin/env python3
"""Luppolandia sound effects: every cue the table plays, synthesized offline from physical-ish models.

Dice are resin bouncing on an oak table (modal resonators excited by impulse trains that
lose energy per bounce), steel is inharmonic partials over a transient, footsteps are
filtered grit on stone. Nothing is sampled, so the project owns every sound outright.

    python3 tools/sfx/render.py                 # all cues -> tv/public/audio/sfx
    python3 tools/sfx/render.py --only dice_1 crit
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Callable

import numpy as np
from scipy import signal

SR = 44100
REPO = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO / "tv" / "public" / "audio" / "sfx"
F32 = np.float32


def rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR), dtype=F32) / SR


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SR), dtype=F32)


def env_exp(n: int, decay: float) -> np.ndarray:
    return np.exp(-np.arange(n, dtype=F32) / (decay * SR)).astype(F32)


def env_ad(n: int, attack: float, decay: float) -> np.ndarray:
    a = max(1, int(attack * SR))
    out = np.ones(n, dtype=F32)
    out[: min(a, n)] = np.linspace(0, 1, min(a, n), dtype=F32)
    if n > a:
        out[a:] = np.exp(-np.arange(n - a, dtype=F32) / (decay * SR))
    return out


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, [max(20.0, lo), min(hi, SR / 2 - 100)], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x).astype(F32)


def lowpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, min(cutoff, SR / 2 - 100), btype="low", fs=SR, output="sos")
    return signal.sosfilt(sos, x).astype(F32)


def highpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, max(20.0, cutoff), btype="high", fs=SR, output="sos")
    return signal.sosfilt(sos, x).astype(F32)


def resonator(x: np.ndarray, freq: float, q: float) -> np.ndarray:
    """Two-pole resonant filter: an impulse through it rings like a struck mode."""
    w = 2 * math.pi * freq / SR
    r = math.exp(-w / (2 * q))
    b = [1 - r]
    a = [1, -2 * r * math.cos(w), r * r]
    return signal.lfilter(b, a, x).astype(F32)


def modal(x: np.ndarray, modes: list[tuple[float, float, float]]) -> np.ndarray:
    out = np.zeros_like(x)
    for freq, q, gain in modes:
        out += resonator(x, freq, q) * gain
    return out


def mix_at(dst: np.ndarray, src: np.ndarray, at: float, gain: float = 1.0) -> np.ndarray:
    i = int(at * SR)
    need = i + len(src)
    if need > len(dst):
        dst = np.concatenate([dst, np.zeros(need - len(dst), dtype=F32)])
    dst[i:need] += src * gain
    return dst


def room(x: np.ndarray, size: float = 0.35, wet: float = 0.18, seed: int = 7, tone: float = 4200) -> np.ndarray:
    """Small stone cellar: exponentially decaying filtered noise as impulse response."""
    r = rng(seed)
    n = int(size * SR)
    ir = r.standard_normal(n).astype(F32) * env_exp(n, size / 5)
    ir = lowpass(ir, tone)
    ir[: int(0.004 * SR)] = 0
    ir /= np.sqrt(np.sum(ir**2)) + 1e-9
    tail = np.zeros(len(x) + n, dtype=F32)
    wetsig = signal.fftconvolve(x, ir).astype(F32)[: len(x) + n]
    tail[: len(wetsig)] = wetsig
    dry = np.concatenate([x, np.zeros(n, dtype=F32)])
    return dry * (1 - wet * 0.5) + tail * wet


def sine(freq: float | np.ndarray, seconds: float, phase: float = 0.0) -> np.ndarray:
    t = t_axis(seconds)
    if np.isscalar(freq):
        return np.sin(2 * math.pi * float(freq) * t + phase).astype(F32)
    ph = np.cumsum(np.asarray(freq, dtype=np.float64)) * 2 * math.pi / SR
    return np.sin(ph + phase).astype(F32)


def saw(freq: np.ndarray) -> np.ndarray:
    ph = np.cumsum(np.asarray(freq, dtype=np.float64)) / SR
    return (2 * (ph - np.floor(ph + 0.5))).astype(F32)


def add(*parts: np.ndarray) -> np.ndarray:
    """Sum layers of different lengths, padding the short ones with silence."""
    n = max(len(p) for p in parts)
    out = np.zeros(n, dtype=F32)
    for p in parts:
        out[: len(p)] += p
    return out


def normalize(x: np.ndarray, peak: float = 0.89) -> np.ndarray:
    m = float(np.max(np.abs(x))) or 1.0
    return (x / m * peak).astype(F32)


def fade_tail(x: np.ndarray, seconds: float = 0.03) -> np.ndarray:
    n = min(len(x), int(seconds * SR))
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n, dtype=F32)
    return x


def trim(x: np.ndarray, floor_db: float = -62) -> np.ndarray:
    thr = 10 ** (floor_db / 20) * (np.max(np.abs(x)) or 1)
    idx = np.where(np.abs(x) > thr)[0]
    if not len(idx):
        return x
    return fade_tail(x[: idx[-1] + int(0.02 * SR)])


# ---------------------------------------------------------------- building blocks

OAK = [(142, 9, 0.9), (231, 11, 0.7), (398, 14, 0.5), (655, 16, 0.35), (1180, 18, 0.18)]


def resin_click(r: np.random.Generator, energy: float) -> np.ndarray:
    """One corner of a resin d20 striking oak: bright tick for the die, a knock for the table."""
    n = int(0.16 * SR)
    burst = np.zeros(n, dtype=F32)
    width = int(SR * (0.0006 + 0.0006 * r.random()))
    burst[:width] = r.standard_normal(width).astype(F32) * np.hanning(width).astype(F32)
    die = modal(burst, [(3100 + 900 * r.random(), 24, 0.55), (5200 + 1200 * r.random(), 30, 0.35), (7600, 34, 0.15)])
    table = modal(burst, [(f * (0.97 + 0.06 * r.random()), q, g) for f, q, g in OAK])
    grit = highpass(burst * 0.12, 2500)
    return (die * 0.4 + table * energy * 3.2 + grit) * energy


def whoosh(r: np.random.Generator, seconds: float, lo: float, hi: float, peak_at: float = 0.45) -> np.ndarray:
    n = int(seconds * SR)
    noise = r.standard_normal(n).astype(F32)
    out = np.zeros(n, dtype=F32)
    block = 256
    centers = np.concatenate([
        np.linspace(lo, hi, int(n * peak_at)),
        np.linspace(hi, lo * 0.8, n - int(n * peak_at)),
    ])
    zi = None
    for start in range(0, n, block):
        c = float(centers[min(start, n - 1)])
        sos = signal.butter(2, [c * 0.6, min(c * 1.6, SR / 2 - 200)], btype="band", fs=SR, output="sos")
        if zi is None:
            zi = signal.sosfilt_zi(sos) * 0
        chunk, zi = signal.sosfilt(sos, noise[start : start + block], zi=zi)
        out[start : start + block] = chunk
    shape = np.sin(np.linspace(0, math.pi, n)) ** 2
    return (out * shape).astype(F32)


def metal(r: np.random.Generator, base: float, seconds: float, bright: float = 1.0) -> np.ndarray:
    ratios = [1.0, 2.76, 5.40, 8.93, 13.34]
    t = t_axis(seconds)
    out = np.zeros_like(t)
    for i, k in enumerate(ratios):
        f = base * k * (1 + 0.004 * r.standard_normal())
        decay = seconds / (1.0 + i * 1.2)
        out += np.sin(2 * math.pi * f * t + r.random() * 6.28) * np.exp(-t / decay) * (bright ** i) / (1 + i)
    return out.astype(F32)


def thump(freq: float, seconds: float, drop: float = 0.5) -> np.ndarray:
    t = t_axis(seconds)
    f = freq * (1 - drop * (1 - np.exp(-t / 0.05)))
    return (sine(f, seconds) * env_ad(len(t), 0.002, seconds / 4)).astype(F32)


def grit(r: np.random.Generator, seconds: float, lo: float, hi: float, decay: float) -> np.ndarray:
    n = int(seconds * SR)
    return bandpass(r.standard_normal(n).astype(F32), lo, hi) * env_ad(n, 0.001, decay)


def bell(freq: float, seconds: float, partials=((1, 1), (2.0, 0.5), (2.76, 0.38), (5.4, 0.2), (8.9, 0.1))) -> np.ndarray:
    t = t_axis(seconds)
    out = np.zeros_like(t)
    for k, g in partials:
        out += np.sin(2 * math.pi * freq * k * t) * np.exp(-t / (seconds / (0.6 + k * 0.5))) * g
    return out.astype(F32) * env_ad(len(t), 0.002, seconds)


def brass(freq: float, seconds: float, vib: float = 5.2, bright: float = 2600) -> np.ndarray:
    t = t_axis(seconds)
    f = freq * (1 + 0.006 * np.sin(2 * math.pi * vib * t) * np.clip(t / 0.25, 0, 1))
    tone = saw(f) * 0.6 + saw(f * 1.003) * 0.4
    swell = np.clip(t / 0.06, 0, 1) * np.exp(-np.maximum(0, t - seconds * 0.6) / (seconds * 0.25))
    return lowpass(tone * swell, bright).astype(F32)


def pluck(freq: float, seconds: float, damp: float = 0.996, seed: int = 3) -> np.ndarray:
    """Karplus-Strong: a lute string for the interface."""
    r = rng(seed)
    period = max(2, int(SR / freq))
    buf = r.uniform(-1, 1, period).astype(F32)
    n = int(seconds * SR)
    out = np.zeros(n, dtype=F32)
    for i in range(n):
        v = buf[i % period]
        out[i] = v
        buf[i % period] = damp * 0.5 * (v + buf[(i + 1) % period])
    return lowpass(out, 5200)


# ---------------------------------------------------------------- cues


def dice_roll(seed: int) -> np.ndarray:
    """A d20 thrown on oak: a hard first landing, bounces losing energy, a tumble, then the settle."""
    r = rng(seed)
    out = silence(1.3)
    at = 0.01
    energy = 1.0
    gap = 0.11 + 0.03 * r.random()
    for _ in range(5):
        out = mix_at(out, resin_click(r, energy), at)
        if r.random() < 0.6:
            out = mix_at(out, resin_click(r, energy * 0.4), at + 0.012 + 0.01 * r.random())
        at += gap
        gap *= 0.62 + 0.08 * r.random()
        energy *= 0.62
    for _ in range(int(9 + r.integers(0, 6))):
        at += 0.018 + 0.03 * r.random()
        out = mix_at(out, resin_click(r, 0.18 + 0.12 * r.random()), at)
    out = mix_at(out, resin_click(r, 0.35), at + 0.07)
    return trim(normalize(room(out, 0.28, 0.14, seed)))


def dice_settle() -> np.ndarray:
    r = rng(41)
    out = mix_at(silence(0.25), resin_click(r, 0.55), 0.0)
    out = mix_at(out, resin_click(r, 0.22), 0.045)
    return trim(normalize(room(out, 0.2, 0.12), 0.7))


def sword_swing(seed: int) -> np.ndarray:
    r = rng(seed)
    return trim(normalize(room(whoosh(r, 0.34, 500, 3400, 0.55) * 0.9, 0.3, 0.12, seed), 0.75))


def sword_hit(seed: int) -> np.ndarray:
    r = rng(seed)
    body = add(thump(120, 0.28, 0.55) * 0.9, grit(r, 0.2, 300, 2400, 0.03) * 0.8)
    steel = metal(r, 520 + 90 * r.random(), 0.7, 0.8) * 0.35
    lead = whoosh(r, 0.16, 700, 3600, 0.8) * 0.5
    out = mix_at(silence(0.9), lead, 0)
    out = mix_at(out, body, 0.13)
    out = mix_at(out, steel, 0.13)
    return trim(normalize(room(out, 0.4, 0.2, seed)))


def blunt_hit(seed: int) -> np.ndarray:
    r = rng(seed)
    out = add(thump(90, 0.35, 0.6), grit(r, 0.25, 150, 1600, 0.05) * 0.9)
    return trim(normalize(room(out, 0.35, 0.18, seed)))


def claw_hit(seed: int) -> np.ndarray:
    r = rng(seed)
    out = silence(0.5)
    for i in range(3):
        out = mix_at(out, grit(r, 0.09, 1800, 7000, 0.02) * (1 - i * 0.2), 0.035 * i)
    out = mix_at(out, thump(140, 0.2, 0.4) * 0.7, 0.02)
    return trim(normalize(room(out, 0.3, 0.14, seed)))


def miss(seed: int) -> np.ndarray:
    r = rng(seed)
    out = whoosh(r, 0.3, 380, 2200, 0.5) * 0.8
    out = mix_at(out, grit(r, 0.12, 200, 900, 0.03) * 0.25, 0.26)
    return trim(normalize(room(out, 0.3, 0.12, seed), 0.6))


def crit() -> np.ndarray:
    """Natural 20: the room holds its breath, then steel rings and something heavy lands."""
    r = rng(20)
    swell = whoosh(r, 0.6, 200, 6000, 0.95) * 0.5
    boom = thump(58, 1.4, 0.45) * 1.2
    shing = metal(r, 880, 1.6, 0.9) * 0.4
    chord = sum(bell(f, 2.2) for f in (523.25, 659.25, 783.99, 1046.5)) * 0.12
    out = mix_at(silence(2.6), swell, 0)
    out = mix_at(out, boom, 0.58)
    out = mix_at(out, shing, 0.58)
    out = mix_at(out, chord, 0.62)
    return trim(normalize(room(out, 1.1, 0.3, 20, 6000)))


def fumble() -> np.ndarray:
    """Natural 1: a muted trombone sighs downward. The table is allowed to laugh."""
    notes = [(311.1, 0.34), (293.7, 0.34), (277.2, 0.34), (261.6, 1.0)]
    out = silence(0.1)
    at = 0.0
    for i, (f, d) in enumerate(notes):
        t = t_axis(d)
        wobble = 1 + (0.03 * np.sin(2 * math.pi * 6 * t) * np.clip(t / 0.3, 0, 1) if i == 3 else 0)
        freq = f * wobble * (1 - (0.06 * t / d if i == 3 else 0))
        tone = lowpass(saw(freq) * env_ad(len(t), 0.03, d * 0.9), 1400)
        out = mix_at(out, tone, at)
        at += d * 0.92
    return trim(normalize(room(out, 0.4, 0.15), 0.72))


def death(seed: int, pitch: float) -> np.ndarray:
    """A creature's last squeal falling into a heavy body on stone."""
    r = rng(seed)
    d = 0.55
    t = t_axis(d)
    f = pitch * (1.1 - 0.55 * t / d) * (1 + 0.04 * np.sin(2 * math.pi * 23 * t))
    squeal = bandpass(saw(f), pitch * 0.8, pitch * 6) * env_ad(len(t), 0.01, 0.22) * 0.6
    body = add(thump(70, 0.5, 0.5), grit(r, 0.3, 120, 1200, 0.06) * 0.7)
    out = mix_at(silence(1.2), squeal, 0)
    out = mix_at(out, body, 0.42)
    return trim(normalize(room(out, 0.5, 0.22, seed)))


def hero_down() -> np.ndarray:
    r = rng(66)
    out = add(thump(64, 0.8, 0.5) * 1.1, grit(r, 0.4, 100, 900, 0.08) * 0.6)
    out = mix_at(out, metal(r, 330, 1.2, 0.7) * 0.25, 0.05)
    toll = bell(98, 2.6) * 0.5
    out = mix_at(out, toll, 0.35)
    return trim(normalize(room(out, 1.0, 0.3, 66)))


def footstep(seed: int) -> np.ndarray:
    r = rng(seed)
    heel = add(grit(r, 0.09, 90, 900, 0.018), thump(95, 0.08, 0.3) * 0.5)
    toe = grit(r, 0.07, 400, 3800, 0.012) * 0.45
    out = mix_at(silence(0.22), heel, 0)
    out = mix_at(out, toe, 0.045 + 0.02 * r.random())
    return trim(normalize(room(out, 0.3, 0.16, seed), 0.55))


def skitter(seed: int) -> np.ndarray:
    r = rng(seed)
    out = silence(0.3)
    for i in range(7):
        out = mix_at(out, grit(r, 0.02, 2500, 9000, 0.004) * (0.5 + 0.5 * r.random()), i * 0.028 + 0.01 * r.random())
    return trim(normalize(room(out, 0.25, 0.12, seed), 0.45))


def ui_move() -> np.ndarray:
    r = rng(90)
    burst = np.zeros(int(0.08 * SR), dtype=F32)
    burst[:40] = r.standard_normal(40).astype(F32) * np.hanning(40).astype(F32)
    tick = modal(burst, [(1850, 22, 0.8), (2900, 26, 0.3)])
    return trim(normalize(tick, 0.32))


def ui_confirm() -> np.ndarray:
    out = mix_at(silence(0.6), pluck(392, 0.5, seed=4), 0)
    out = mix_at(out, pluck(587.3, 0.5, seed=5) * 0.8, 0.07)
    return trim(normalize(room(out, 0.4, 0.2), 0.5))


def ui_back() -> np.ndarray:
    out = mix_at(silence(0.5), pluck(440, 0.4, seed=6), 0)
    out = mix_at(out, pluck(293.7, 0.45, seed=7) * 0.8, 0.07)
    return trim(normalize(room(out, 0.4, 0.2), 0.42))


def ui_error() -> np.ndarray:
    r = rng(92)
    out = silence(0.4)
    for i in range(2):
        out = mix_at(out, add(thump(150, 0.12, 0.2) * 0.8, grit(r, 0.06, 200, 1200, 0.01) * 0.4), 0.11 * i)
    return trim(normalize(room(out, 0.25, 0.12), 0.45))


def turn_gong() -> np.ndarray:
    r = rng(12)
    out = bell(196, 2.2, ((1, 1), (1.51, 0.4), (2.0, 0.35), (2.76, 0.3), (4.1, 0.12))) * 0.8
    out = add(out, grit(r, len(out) / SR, 800, 6000, 0.01) * 0.12)
    return trim(normalize(room(out, 0.9, 0.25, 12)))


def enemy_turn() -> np.ndarray:
    out = bell(110, 2.0, ((1, 1), (1.19, 0.5), (2.4, 0.3), (3.3, 0.18))) * 0.7
    out = add(out, thump(55, 1.0, 0.3) * 0.6)
    return trim(normalize(room(out, 0.9, 0.25, 13)))


def victory() -> np.ndarray:
    """Three seals, one toast: a short brass call resolving to a warm major chord."""
    out = silence(3.4)
    calls = [(392.0, 0.0, 0.22), (523.25, 0.22, 0.22), (659.25, 0.44, 0.3)]
    for f, at, d in calls:
        out = mix_at(out, brass(f, d + 0.1) * 0.7, at)
    for f in (523.25, 659.25, 783.99, 261.63):
        out = mix_at(out, brass(f, 2.4, bright=2200) * 0.35, 0.78)
    out = mix_at(out, bell(1046.5, 2.4) * 0.15, 0.78)
    out = mix_at(out, thump(65, 1.2, 0.3) * 0.7, 0.78)
    return trim(normalize(room(out, 1.4, 0.3, 30, 5000)))


def defeat() -> np.ndarray:
    t = t_axis(3.6)
    drone = lowpass(saw(110 * (1 - 0.12 * t / 3.6)) * 0.5 + saw(164.8 * (1 - 0.12 * t / 3.6)) * 0.3, 700)
    drone *= env_ad(len(t), 0.4, 1.6)
    out = drone * 0.7
    out = mix_at(out, bell(82.4, 3.0) * 0.8, 0.1)
    out = mix_at(out, bell(82.4, 3.0) * 0.5, 1.5)
    return trim(normalize(room(out, 1.4, 0.3, 31)))


def heal() -> np.ndarray:
    out = silence(1.8)
    for i, f in enumerate((523.25, 659.25, 783.99, 1046.5, 1318.5)):
        out = mix_at(out, bell(f, 1.2) * (0.5 - i * 0.05), i * 0.08)
    r = rng(44)
    sparkle = highpass(r.standard_normal(int(1.2 * SR)).astype(F32), 7000) * env_ad(int(1.2 * SR), 0.3, 0.3) * 0.08
    out = mix_at(out, sparkle, 0.1)
    return trim(normalize(room(out, 1.0, 0.35, 44, 7000)))


def spell() -> np.ndarray:
    r = rng(51)
    rise = whoosh(r, 0.7, 300, 5200, 0.85) * 0.7
    t = t_axis(0.7)
    shimmer = sine(600 * (1 + 1.5 * t / 0.7), 0.7) * env_ad(len(t), 0.2, 0.2) * 0.25
    out = mix_at(silence(1.2), add(rise, shimmer), 0)
    out = mix_at(out, bell(1567.98, 0.6) * 0.2, 0.62)
    return trim(normalize(room(out, 0.8, 0.3, 51, 7000)))


def missile() -> np.ndarray:
    r = rng(52)
    out = silence(0.9)
    for i in range(3):
        t = t_axis(0.35)
        zap = sine(1400 * (1 - 0.6 * t / 0.35), 0.35) * env_ad(len(t), 0.005, 0.1)
        out = mix_at(out, add(zap * 0.4, whoosh(r, 0.35, 900, 5000, 0.3) * 0.4), i * 0.11)
    return trim(normalize(room(out, 0.6, 0.25, 52, 7000)))


def fire() -> np.ndarray:
    r = rng(53)
    n = int(1.1 * SR)
    roar = lowpass(r.standard_normal(n).astype(F32), 1400) * env_ad(n, 0.05, 0.4)
    out = roar * 0.8
    for _ in range(40):
        at = r.random() * 0.9
        out = mix_at(out, grit(r, 0.02, 2000, 8000, 0.003) * r.random() * 0.8, at)
    out = mix_at(out, thump(80, 0.5, 0.4) * 0.6, 0.0)
    return trim(normalize(room(out, 0.6, 0.2, 53)))


def bow() -> np.ndarray:
    r = rng(54)
    t = t_axis(0.25)
    twang = sine(196 * (1 + 0.02 * np.exp(-t / 0.02)), 0.25) * env_ad(len(t), 0.001, 0.07) * 0.6
    out = mix_at(silence(0.6), twang, 0)
    out = mix_at(out, whoosh(r, 0.3, 1200, 6000, 0.3) * 0.5, 0.04)
    return trim(normalize(room(out, 0.4, 0.15, 54), 0.7))


def web() -> np.ndarray:
    r = rng(55)
    out = whoosh(r, 0.5, 900, 3000, 0.4) * 0.5
    for i in range(10):
        out = mix_at(out, grit(r, 0.05, 3000, 9000, 0.01) * 0.3, 0.05 * i)
    return trim(normalize(room(out, 0.5, 0.2, 55), 0.7))


def chapter() -> np.ndarray:
    """Chapter card: a deep cinematic hit with a page breath before it."""
    r = rng(60)
    breath = whoosh(r, 0.5, 200, 2600, 0.9) * 0.35
    boom = thump(48, 2.2, 0.35) * 1.1
    tail = bell(130.8, 2.8, ((1, 1), (2.0, 0.3), (3.0, 0.15))) * 0.3
    out = mix_at(silence(3.0), breath, 0)
    out = mix_at(out, boom, 0.46)
    out = mix_at(out, tail, 0.46)
    return trim(normalize(room(out, 1.6, 0.35, 60, 3800)))


def seal() -> np.ndarray:
    r = rng(61)
    slab = add(thump(60, 0.8, 0.4) * 0.9, grit(r, 0.5, 80, 900, 0.12) * 0.7)
    chime = sum(bell(f, 1.8) for f in (659.25, 987.77, 1318.5)) * 0.18
    out = mix_at(silence(2.2), slab, 0)
    out = mix_at(out, chime, 0.35)
    return trim(normalize(room(out, 1.0, 0.3, 61)))


def puzzle_step() -> np.ndarray:
    r = rng(62)
    click = add(grit(r, 0.05, 1000, 5000, 0.006) * 0.6, thump(220, 0.12, 0.2) * 0.4)
    out = mix_at(silence(0.6), click, 0)
    out = mix_at(out, bell(880, 0.5) * 0.12, 0.02)
    return trim(normalize(room(out, 0.5, 0.2, 62), 0.55))


def trap() -> np.ndarray:
    r = rng(63)
    grind = bandpass(r.standard_normal(int(0.6 * SR)).astype(F32), 80, 700) * env_ad(int(0.6 * SR), 0.05, 0.25)
    out = mix_at(silence(1.6), grind * 0.7, 0)
    out = mix_at(out, fire() * 0.8, 0.35)
    return trim(normalize(out))


CUES: dict[str, Callable[[], np.ndarray]] = {
    **{f"dice_{i}": (lambda i=i: dice_roll(100 + i)) for i in range(1, 5)},
    "dice_settle": dice_settle,
    **{f"swing_{i}": (lambda i=i: sword_swing(200 + i)) for i in range(1, 3)},
    **{f"sword_{i}": (lambda i=i: sword_hit(300 + i)) for i in range(1, 4)},
    **{f"blunt_{i}": (lambda i=i: blunt_hit(310 + i)) for i in range(1, 3)},
    **{f"claw_{i}": (lambda i=i: claw_hit(320 + i)) for i in range(1, 3)},
    **{f"miss_{i}": (lambda i=i: miss(400 + i)) for i in range(1, 3)},
    "crit": crit,
    "fumble": fumble,
    "death_small": lambda: death(500, 1400),
    "death_big": lambda: death(501, 520),
    "hero_down": hero_down,
    **{f"step_{i}": (lambda i=i: footstep(600 + i)) for i in range(1, 5)},
    **{f"skitter_{i}": (lambda i=i: skitter(650 + i)) for i in range(1, 3)},
    "ui_move": ui_move,
    "ui_confirm": ui_confirm,
    "ui_back": ui_back,
    "ui_error": ui_error,
    "turn": turn_gong,
    "enemy_turn": enemy_turn,
    "victory": victory,
    "defeat": defeat,
    "heal": heal,
    "spell": spell,
    "missile": missile,
    "fire": fire,
    "bow": bow,
    "web": web,
    "chapter": chapter,
    "seal": seal,
    "puzzle_step": puzzle_step,
    "trap": trap,
}


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def encode(wav: Path, out_dir: Path, name: str) -> list[Path]:
    targets = [
        (out_dir / f"{name}.ogg", ["-c:a", "libvorbis", "-q:a", "3"]),
        (out_dir / f"{name}.m4a", ["-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"]),
    ]
    for path, args in targets:
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), *args, str(path)],
            check=True,
        )
    return [p for p, _ in targets]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--only", nargs="*", default=None)
    args = parser.parse_args()
    if not shutil.which("ffmpeg"):
        print("ffmpeg is required on PATH", file=sys.stderr)
        return 1
    names = args.only or list(CUES)
    unknown = [n for n in names if n not in CUES]
    if unknown:
        print(f"unknown cues: {', '.join(unknown)}", file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name in names:
            audio = CUES[name]()
            wav = Path(tmp) / f"{name}.wav"
            write_wav(wav, audio)
            encode(wav, args.out, name)
            print(f"{name:14s} {len(audio) / SR:5.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
