#!/usr/bin/env python3
"""Luppolandia score: renders the seven looping ambient cues used by the TV client.

Every cue is written here note by note and synthesized offline, so the project owns
the music outright. Each file loops sample-exactly: the arrangement is rendered twice
and only the second pass is kept, so the reverb and release tails that spill past the
end of the loop are already sounding at its start.

    python3 tools/music/compose.py                  # all cues -> tv/public/audio/music
    python3 tools/music/compose.py --only tavern boss
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

import numpy as np
from scipy import signal

SR = 44100
F32 = np.float32
TWO_PI = 2.0 * math.pi
REPO = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO / "tv" / "public" / "audio" / "music"

R = np.random.default_rng(1)

Note = str | int


def seed(value: int) -> None:
    global R
    R = np.random.default_rng(value)


# ---------------------------------------------------------------- pitch & harmony

_STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_QUALITIES = {
    "": (0, 4, 7),
    "m": (0, 3, 7),
    "5": (0, 7),
    "7": (0, 4, 7, 10),
    "m7": (0, 3, 7, 10),
    "sus4": (0, 5, 7),
    "dim": (0, 3, 6),
}


def midi(note: Note) -> int:
    if isinstance(note, int):
        return note
    i, acc = 1, 0
    while i < len(note) and note[i] in "#b":
        acc += 1 if note[i] == "#" else -1
        i += 1
    return 12 * (int(note[i:]) + 1) + _STEPS[note[0]] + acc


def hz(note: Note) -> float:
    return 440.0 * 2.0 ** ((midi(note) - 69) / 12.0)


def chord_parts(symbol: str) -> tuple[int, tuple[int, ...]]:
    root = symbol[0]
    rest = symbol[1:]
    if rest[:1] in ("#", "b"):
        root += rest[0]
        rest = rest[1:]
    return midi(root + "4") % 12, _QUALITIES[rest]


def voicing(symbol: str, low: Note, count: int) -> list[int]:
    root, quality = chord_parts(symbol)
    classes = {(root + q) % 12 for q in quality}
    out: list[int] = []
    m = midi(low)
    while len(out) < count:
        if m % 12 in classes:
            out.append(m)
        m += 1
    return out


def root_in(symbol: str, low: Note) -> int:
    root, _ = chord_parts(symbol)
    m = midi(low)
    while m % 12 != root:
        m += 1
    return m


def diatonic(note: Note, steps: int, scale: Sequence[int]) -> int:
    m = midi(note)
    pc = m % 12
    idx = max(i for i, s in enumerate(scale) if s <= pc)
    octave, j = divmod(idx + steps, len(scale))
    return m - pc + 12 * octave + scale[j]


def line(text: str, default: float = 1.0, shift: int = 0) -> list[tuple[int | None, float]]:
    """'D4:2 A4 | r:0.5 Bb4' -> [(62, 2.0), (69, 1.0), (None, 0.5), (70, 1.0)]"""
    out: list[tuple[int | None, float]] = []
    for token in text.split():
        if token == "|":
            continue
        name, _, length = token.partition(":")
        beats = float(length) if length else default
        out.append((None if name == "r" else midi(name) + shift, beats))
    return out


def shifted(notes: Iterable[tuple[int | None, float]], fn: Callable[[int], int]):
    return [(fn(n) if n is not None else None, b) for n, b in notes]


# ---------------------------------------------------------------- dsp helpers


def _sos(kind: str, freq, order: int):
    nyq = SR * 0.47
    if isinstance(freq, (tuple, list)):
        lo, hi = max(20.0, freq[0]), min(nyq, freq[1])
        return signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos")
    return signal.butter(order, min(nyq, max(10.0, freq)), kind, fs=SR, output="sos")


def lp(x, fc, order=2):
    return signal.sosfilt(_sos("low", fc, order), x, axis=0)


def hp(x, fc, order=2):
    return signal.sosfilt(_sos("high", fc, order), x, axis=0)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos("band", (lo, hi), order), x, axis=0)


def smooth(x, fc):
    a = 1.0 - math.exp(-TWO_PI * fc / SR)
    return signal.lfilter([a], [1.0, -(1.0 - a)], x, axis=0)


def times(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def phase(freq: np.ndarray, start: float = 0.0) -> np.ndarray:
    return start + TWO_PI * np.cumsum(freq) / SR


def saw(freq: np.ndarray, start: float = 0.0) -> np.ndarray:
    dt = freq / SR
    p = (np.cumsum(dt) + start) % 1.0
    y = 2.0 * p - 1.0
    m = p < dt
    x = p[m] / dt[m]
    y[m] -= x + x - x * x - 1.0
    m = p > 1.0 - dt
    x = (p[m] - 1.0) / dt[m]
    y[m] -= x * x + x + x + 1.0
    return y


def vibrato(f: float, n: int, rate=5.2, depth=0.004, delay=0.25) -> np.ndarray:
    t = times(n)
    ramp = np.clip((t - delay) / 0.45, 0.0, 1.0)
    wobble = 1.0 + depth * ramp * np.sin(TWO_PI * rate * t + R.uniform(0, TWO_PI))
    drift = 1.0 + 0.0008 * np.sin(TWO_PI * R.uniform(0.1, 0.3) * t + R.uniform(0, TWO_PI))
    return f * wobble * drift


def envelope(n: int, gate: float, a: float, d: float, s: float, r: float) -> np.ndarray:
    t = times(n)
    a = max(a, 1e-4)
    rise = np.sin(0.5 * math.pi * np.clip(t / a, 0.0, 1.0)) ** 2
    held = s + (1.0 - s) * np.exp(-np.maximum(t - a, 0.0) / max(d, 1e-4) * 3.0)
    e = np.where(t < a, rise, held)
    g = min(n - 1, int(gate * SR))
    level = e[g]
    after = t >= gate
    e[after] = level * np.exp(-(t[after] - gate) / max(r, 1e-4) * 5.0)
    return e


def pan_stereo(x: np.ndarray, pan: float) -> np.ndarray:
    a = (pan + 1.0) * math.pi / 4.0
    return np.stack([x * math.cos(a), x * math.sin(a)], axis=1)


def peak_norm(x: np.ndarray, level: float) -> np.ndarray:
    p = float(np.max(np.abs(x)))
    return x * (level / p) if p > 0 else x


def noise(n: int) -> np.ndarray:
    return R.standard_normal(n)


def circular(make: Callable[[int], np.ndarray], length_n: int, fade: float = 3.0) -> np.ndarray:
    f = int(fade * SR)
    x = make(length_n + f)
    out = x[:length_n].copy()
    th = np.linspace(0.0, math.pi / 2.0, f)
    fade_out, fade_in = np.cos(th), np.sin(th)
    if x.ndim == 2:
        fade_out, fade_in = fade_out[:, None], fade_in[:, None]
    out[:f] = x[length_n : length_n + f] * fade_out + x[:f] * fade_in
    return out


# ---------------------------------------------------------------- instruments

_PLUCK_CACHE: dict[tuple, list[np.ndarray]] = {}


def _pluck_render(f: float, ring: float, pos: float, bright: float, tau: float, course: bool):
    tau = tau * (220.0 / f) ** 0.35
    n = int(min(ring, tau * 6.5) * SR) + 1
    t = times(n)
    out = np.zeros(n)
    top = max(1, min(22, int(9000.0 / f)))
    for k in range(1, top + 1):
        amp = abs(math.sin(math.pi * k * pos)) / k ** (1.4 - 0.55 * bright)
        if amp < 2e-3:
            continue
        fk = f * k * math.sqrt(1.0 + 0.00012 * k * k)
        tk = tau / (1.0 + 0.45 * (k - 1) * (1.25 - 0.6 * bright))
        decay = np.exp(-t / tk)
        out += amp * decay * np.sin(TWO_PI * fk * t + R.uniform(0, TWO_PI))
        if course and k <= 6:
            out += 0.45 * amp * decay * np.sin(TWO_PI * fk * 1.0016 * t + R.uniform(0, TWO_PI))
    click_n = int(0.004 * SR)
    click = hp(noise(click_n), 1800) * np.linspace(1, 0, click_n) * 0.25 * bright
    out[:click_n] += click * float(np.max(np.abs(out[:click_n])) + 0.2)
    out[: int(0.0015 * SR)] *= np.linspace(0, 1, int(0.0015 * SR))
    return peak_norm(out, 0.5)


def pluck(note: Note, vel=1.0, *, kind: str, ring: float, pos: float, bright: float, tau: float, course: bool):
    key = (midi(note), kind)
    variants = _PLUCK_CACHE.setdefault(key, [])
    if len(variants) < 3:
        variants.append(_pluck_render(hz(note), ring, pos, bright, tau, course))
        return variants[-1] * vel
    return variants[int(R.integers(0, len(variants)))] * vel


def harp(note: Note, vel=1.0):
    return pluck(note, vel, kind="harp", ring=4.5, pos=0.46, bright=0.5, tau=2.3, course=False)


def lute(note: Note, vel=1.0):
    return pluck(note, vel, kind="lute", ring=2.2, pos=0.16, bright=0.8, tau=0.85, course=True)


def dulcimer(note: Note, vel=1.0):
    return pluck(note, vel, kind="dulcimer", ring=3.0, pos=0.11, bright=1.0, tau=1.35, course=True)


def flute(note: Note, dur: float, vel=1.0, breath=0.07, vib=0.006):
    f = hz(note)
    rel = 0.2
    n = int((dur + rel) * SR)
    t = times(n)
    fi = vibrato(f, n, 5.1, vib, 0.3) * (1.0 - 0.012 * np.exp(-t / 0.035))
    ph = phase(fi, R.uniform(0, TWO_PI))
    low = f < 440
    tone = (
        np.sin(ph)
        + (0.3 if low else 0.18) * np.sin(2 * ph + 0.3)
        + 0.07 * np.sin(3 * ph)
        + 0.025 * np.sin(4 * ph)
    )
    e = envelope(n, dur, 0.065, 0.15, 0.82, rel)
    chiff = 0.8 * np.exp(-t / 0.06)
    air = bp(noise(n), f * 1.1, min(f * 3.6, 14000)) * breath * 4.0 * (e * 0.6 + chiff * (e > 0.01))
    return (lp(tone * e, 7500) + air) * vel * 0.35


def strings(notes: Sequence[Note], dur: float, vel=1.0, attack=0.9, release=1.4, bright=0.5, spread=0.7, trem=0.0):
    n = int((dur + release) * SR)
    left = np.zeros(n)
    right = np.zeros(n)
    for note in notes:
        f = hz(note)
        for j, cents in enumerate((-7.0, 0.0, 6.0)):
            fi = vibrato(f * 2 ** (cents / 1200), n, 4.8 + R.uniform(-0.4, 0.4), 0.0035, 0.1)
            s = saw(fi, R.uniform())
            a = ((j - 1) * spread + 1.0) * math.pi / 4.0
            left += s * math.cos(a)
            right += s * math.sin(a)
    y = np.stack([left, right], axis=1)
    y = hp(lp(y, 1500 + 5200 * bright, 2), 70)
    e = envelope(n, dur, attack, 0.6, 0.9, release)
    if trem:
        e = e * (1.0 - 0.3 * (1.0 + np.sin(TWO_PI * trem * times(n))))
    return y * e[:, None] * vel * 0.13 / math.sqrt(max(1, len(notes)))


_FORMANTS = {
    "a": ((730, 90, 1.0), (1090, 110, 0.5), (2440, 160, 0.22)),
    "o": ((570, 80, 1.0), (840, 90, 0.45), (2410, 160, 0.1)),
    "u": ((320, 60, 1.0), (870, 90, 0.28), (2240, 150, 0.06)),
}


def choir(notes: Sequence[Note], dur: float, vel=1.0, vowel="a", attack=1.3, release=1.8):
    n = int((dur + release) * SR)
    left = np.zeros(n)
    right = np.zeros(n)
    for note in notes:
        f = hz(note)
        for j, cents in enumerate((-12.0, -4.0, 5.0, 11.0)):
            fi = vibrato(f * 2 ** (cents / 1200), n, 5.4 + R.uniform(-0.5, 0.5), 0.006, 0.2)
            s = saw(fi, R.uniform())
            a = ((j - 1.5) / 1.5 * 0.8 + 1.0) * math.pi / 4.0
            left += s * math.cos(a)
            right += s * math.sin(a)
    src = np.stack([left, right], axis=1)
    src = src + 0.02 * np.stack([noise(n), noise(n)], axis=1)
    y = np.zeros_like(src)
    for fc, bw, g in _FORMANTS[vowel]:
        y += bp(src, fc - bw, fc + bw, 2) * g
    y = lp(y, 5000)
    e = envelope(n, dur, attack, 0.8, 0.92, release)
    return y * e[:, None] * vel * 0.5 / math.sqrt(max(1, len(notes)))


def brass(notes: Sequence[Note], dur: float, vel=1.0, attack=0.1, release=0.4, stab=False, bright=0.7):
    n = int((dur + release) * SR)
    t = times(n)
    src = np.zeros(n)
    for note in notes:
        f = hz(note)
        for cents in (-4.0, 4.0):
            fi = vibrato(f * 2 ** (cents / 1200), n, 5.0, 0.003, 0.4) * (1.0 - 0.025 * np.exp(-t / 0.05))
            src += saw(fi, R.uniform())
    f0 = hz(min(midi(x) for x in notes))
    dark = lp(src, max(f0 * 2.0, 380), 2)
    shine = lp(src, min(f0 * 10.0, 9000), 2)
    e = envelope(n, dur, 0.02 if stab else attack, 0.18 if stab else 0.5, 0.25 if stab else 0.78, release)
    b = np.clip(e ** 1.5 * bright * vel, 0, 1)
    y = (dark * (1 - b) + shine * b) * e
    return hp(y, 40) * vel * 0.22 / math.sqrt(max(1, len(notes)))


def spiccato(note: Note, vel=1.0, length=0.16):
    f = hz(note)
    n = int((length + 0.1) * SR)
    t = times(n)
    e = np.minimum(t / 0.004, 1.0) * np.exp(-t / (length / 2.4))
    fi = f * (1.0 + 0.002 * np.sin(TWO_PI * 5 * t))
    s = saw(fi, R.uniform()) + 0.45 * saw(fi * 1.004, R.uniform())
    bow = bp(noise(n), f * 2, min(f * 9, 12000)) * 0.08 * np.exp(-t / 0.02)
    return (lp(s, min(f * 7.0, 7500)) * e + bow) * vel * 0.4


def taiko(vel=1.0, size=1.0):
    n = int(2.2 * size * SR)
    t = times(n)
    f = (52.0 / size) * (1.0 + 1.1 * np.exp(-t / 0.045))
    body = np.sin(phase(f)) * np.exp(-t / (0.3 * size))
    skin = bp(noise(n), 150, 1400) * np.exp(-t / 0.04) * 1.1
    slap = hp(noise(n), 2500) * np.exp(-t / 0.007) * 0.45
    return peak_norm(body + skin + slap, 0.9) * vel


def tom(vel=1.0, pitch=1.0):
    n = int(0.6 * SR)
    t = times(n)
    f = 95.0 * pitch * (1.0 + 0.6 * np.exp(-t / 0.03))
    body = np.sin(phase(f)) * np.exp(-t / 0.2)
    skin = bp(noise(n), 300, 3000) * np.exp(-t / 0.025) * 0.5
    return peak_norm(body + skin, 0.8) * vel


def bodhran(vel=1.0, tip=False):
    n = int(0.5 * SR)
    t = times(n)
    f = (150.0 if tip else 72.0) * (1.0 + 0.5 * np.exp(-t / 0.02))
    body = np.sin(phase(f)) * np.exp(-t / (0.08 if tip else 0.17))
    skin = lp(noise(n), 2600) * np.exp(-t / 0.02) * (0.6 if tip else 0.4)
    return peak_norm(body + skin, 0.8) * vel


def snare(vel=1.0):
    n = int(0.4 * SR)
    t = times(n)
    tone = np.sin(TWO_PI * 185 * t) * np.exp(-t / 0.05)
    wires = bp(noise(n), 1500, 7500) * np.exp(-t / 0.11)
    return peak_norm(0.6 * tone + wires, 0.7) * vel


def shaker(vel=1.0):
    n = int(0.12 * SR)
    t = times(n)
    e = np.minimum(t / 0.008, 1.0) * np.exp(-t / 0.04)
    return hp(noise(n), 5500) * e * 0.3 * vel


def swell(dur: float, vel=1.0):
    n = int((dur + 0.5) * SR)
    t = times(n)
    rise = np.clip(t / dur, 0, 1) ** 3
    tail = np.where(t > dur, np.exp(-(t - dur) / 0.12), 1.0)
    shimmer = hp(noise(n), 3000) + 0.6 * bp(noise(n), 5000, 12000)
    return shimmer * rise * tail * 0.12 * vel


_BELLS = {
    "glock": ((1.0, 1.0, 1.6), (2.76, 0.35, 0.6), (5.4, 0.18, 0.3), (8.93, 0.08, 0.15)),
    "celesta": ((1.0, 1.0, 2.4), (2.0, 0.25, 1.0), (3.0, 0.1, 0.5), (4.07, 0.05, 0.3)),
    "church": ((0.5, 0.6, 5.0), (1.0, 1.0, 4.0), (1.19, 0.5, 3.0), (1.5, 0.35, 2.5), (2.0, 0.4, 2.0), (2.52, 0.2, 1.5), (3.0, 0.15, 1.0)),
    "anvil": ((1.0, 1.0, 1.4), (2.4, 0.7, 1.0), (3.9, 0.5, 0.7), (5.3, 0.4, 0.45), (7.1, 0.3, 0.3)),
}


def bell(note: Note, vel=1.0, kind="celesta"):
    f = hz(note)
    table = _BELLS[kind]
    n = int(max(d for _, _, d in table) * 6.0 * SR)
    t = times(n)
    bend = 1.0 - (0.01 * np.exp(-t / 0.3) if kind == "anvil" else 0.0)
    out = np.zeros(n)
    for ratio, amp, decay in table:
        out += amp * np.exp(-t / decay) * np.sin(phase(f * ratio * bend * np.ones(n), R.uniform(0, TWO_PI)))
    out[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return peak_norm(out, 0.6) * vel


def drip(f: float):
    n = int(0.3 * SR)
    t = times(n)
    fi = f * (1.0 + 0.9 * np.clip(t / 0.02, 0, 1))
    return np.sin(phase(fi)) * np.exp(-t / 0.035) * 0.6


def bubble(f: float):
    n = int(0.25 * SR)
    t = times(n)
    fi = f * (1.0 + 0.6 * np.clip(t / 0.06, 0, 1))
    return lp(np.sin(phase(fi)) * np.minimum(t / 0.01, 1) * np.exp(-t / 0.07), 600) * 0.7


# ---------------------------------------------------------------- beds (circular)


def murmur(n: int) -> np.ndarray:
    out = np.zeros((n, 2))
    for _ in range(8):
        centre = R.uniform(350, 1100)
        voice = bp(noise(n), centre * 0.7, centre * 1.6)
        syllables = smooth(smooth(np.abs(noise(n)), 6.0), 6.0)
        syllables = np.clip(syllables / syllables.std() - 1.2, 0, None)
        phrases = lp(noise(n), 0.2, 2)
        phrases = np.clip(phrases / phrases.std() + 0.1, 0, None)
        out += pan_stereo(voice * syllables * phrases, R.uniform(-0.8, 0.8))
    return out / (np.sqrt(np.mean(out**2)) + 1e-9) * 0.1


def crackle(n: int) -> np.ndarray:
    out = np.zeros((n, 2))
    for _ in range(int(7 * n / SR)):
        i = int(R.integers(0, n - 400))
        length = int(R.uniform(0.001, 0.006) * SR)
        burst = noise(length) * np.exp(-np.arange(length) / (length / 3)) * R.pareto(2.5) * 0.4
        out[i : i + length] += pan_stereo(burst, R.uniform(-0.6, 0.6))
    embers = lp(noise(n), 260, 2) * 0.25
    return hp(out, 1200) + pan_stereo(embers, 0.0) * 0.4


def wind(n: int) -> np.ndarray:
    out = np.zeros((n, 2))
    for lo, hi in ((220, 480), (480, 900), (900, 1700)):
        for ch in (0, 1):
            gust = lp(noise(n), 0.12, 2)
            gust = np.clip(gust / gust.std() + 0.4, 0, None)
            out[:, ch] += bp(noise(n), lo, hi) * gust
    return out / (np.sqrt(np.mean(out**2)) + 1e-9) * 0.1


def rumble(n: int) -> np.ndarray:
    swell_lfo = lp(noise(n), 0.15, 2)
    swell_lfo = 0.7 + 0.3 * swell_lfo / (np.abs(swell_lfo).max() + 1e-9)
    left = lp(noise(n), 75, 4) * swell_lfo
    right = lp(noise(n), 75, 4) * swell_lfo
    out = np.stack([left, right], axis=1)
    return out / (np.sqrt(np.mean(out**2)) + 1e-9) * 0.1


# ---------------------------------------------------------------- mix, reverb, master


def make_ir(rt60: float, predelay=0.02, damp=0.45, early=0.6) -> np.ndarray:
    n = int(rt60 * 1.1 * SR)
    t = times(n)
    raw = np.stack([noise(n), noise(n)], axis=1)
    low = lp(raw, 1800, 2)
    high = raw - low
    ir = low * np.exp(-6.9 * t / rt60)[:, None] + high * np.exp(-6.9 * t / (rt60 * damp))[:, None] * 0.6
    ir *= (1.0 - np.exp(-t / 0.012))[:, None]
    for _ in range(12):
        i = int(R.uniform(0.004, 0.07) * SR)
        ir[i, int(R.integers(0, 2))] += R.uniform(1.5, 4.0) * early
    ir /= math.sqrt(float(np.sum(ir**2)) / 2.0)
    return np.concatenate([np.zeros((int(predelay * SR), 2)), ir])


@dataclass
class Grid:
    bpm: float
    beats: int
    bars: int

    @property
    def beat(self) -> float:
        return 60.0 / self.bpm

    @property
    def bar(self) -> float:
        return self.beats * self.beat

    @property
    def length(self) -> float:
        return self.bars * self.bar

    def at(self, bar: float, beat: float = 0.0) -> float:
        return bar * self.bar + beat * self.beat


def hum(t: float, amount=0.006) -> float:
    return max(0.0, t + float(R.normal(0.0, amount)))


class Mix:
    def __init__(self, grid: Grid, tail=10.0):
        self.grid = grid
        self.loop_n = int(round(grid.length * SR))
        self.n = 2 * self.loop_n + int(tail * SR)
        self.dry = np.zeros((self.n, 2), F32)
        self.send = np.zeros((self.n, 2), F32)

    @staticmethod
    def _stereo(sig: np.ndarray, pan: float) -> np.ndarray:
        sig = np.asarray(sig)
        if sig.ndim == 1:
            return pan_stereo(sig, pan)
        if pan:
            sig = sig * np.array([min(1.0, 1.0 - pan), min(1.0, 1.0 + pan)])
        return sig

    def add(self, t: float, sig: np.ndarray, pan=0.0, gain=1.0, send=0.3) -> None:
        st = (self._stereo(sig, pan) * gain).astype(F32)
        for offset in (0, self.loop_n):
            i = int(round(t * SR)) + offset
            j = min(self.n, i + len(st))
            if j <= i:
                continue
            self.dry[i:j] += st[: j - i]
            if send:
                self.send[i:j] += st[: j - i] * send

    def bed(self, sig: np.ndarray, pan=0.0, gain=1.0, send=0.3) -> None:
        st = (self._stereo(sig, pan) * gain).astype(F32)
        assert len(st) == self.loop_n
        for k in range(0, self.n, self.loop_n):
            j = min(self.n, k + self.loop_n)
            self.dry[k:j] += st[: j - k]
            if send:
                self.send[k:j] += st[: j - k] * send

    def render(self, rt60: float, wet: float, target_db: float, damp=0.45, predelay=0.02) -> np.ndarray:
        ir = make_ir(rt60, predelay, damp)
        tail = np.stack(
            [signal.oaconvolve(self.send[:, c], ir[:, c])[: self.n] for c in (0, 1)], axis=1
        )
        full = self.dry.astype(np.float64) + wet * tail
        return master(full, slice(self.loop_n, 2 * self.loop_n), target_db)[self.loop_n : 2 * self.loop_n]


def master(x: np.ndarray, keep: slice, target_db: float, low_cap=0.4) -> np.ndarray:
    x = hp(x, 30, 2)
    lows = signal.sosfiltfilt(_sos("low", 120, 2), x, axis=0)
    total = float(np.mean(x[keep] ** 2)) + 1e-12
    low_e = float(np.mean(lows[keep] ** 2))
    if low_e / total > low_cap:
        rest = total - low_e
        x = x - lows * (1.0 - math.sqrt(low_cap / (1.0 - low_cap) * rest / low_e))
    x = x + 0.6 * signal.sosfiltfilt(_sos("high", 3200, 1), x, axis=0)
    target = 10 ** (target_db / 20.0)
    x *= target / (np.sqrt(np.mean(x[keep] ** 2)) + 1e-12)
    level = np.sqrt(np.maximum(smooth(np.mean(x**2, axis=1), 6.0), 1e-12))
    threshold = target * 1.6
    gain = np.where(level > threshold, (threshold / level) ** 0.6, 1.0)
    x *= smooth(gain, 4.0)[:, None]
    x *= target / (np.sqrt(np.mean(x[keep] ** 2)) + 1e-12)
    x = np.tanh(x * 0.95) / 0.95
    peak = float(np.max(np.abs(x[keep])))
    if peak > 0.97:
        x *= 0.97 / peak
    return x


# ---------------------------------------------------------------- phrase helpers


def play(mix: Mix, bar: float, notes, voice: Callable[[int, float], np.ndarray], *, pan=0.0, gain=1.0, send=0.35, legato=0.95, beat_offset=0.0):
    g = mix.grid
    pos = g.at(bar, beat_offset)
    for note, beats in notes:
        dur = beats * g.beat
        if note is not None:
            mix.add(hum(pos, 0.004), voice(note, dur * legato), pan, gain, send)
        pos += dur


def arpeggio(mix: Mix, bar: int, symbol: str, low: Note, pattern: Sequence[int], *, per_beat=2, voice=harp, vel=0.7, pan=0.0, gain=1.0, send=0.4):
    tones = voicing(symbol, low, max(pattern) + 1)
    step = mix.grid.beat / per_beat
    for i, idx in enumerate(pattern):
        t = mix.grid.at(bar) + i * step
        mix.add(hum(t), voice(tones[idx], vel * R.uniform(0.82, 1.0)), pan, gain, send)


def strum(mix: Mix, t: float, notes: Sequence[int], voice=lute, vel=0.8, down=True, spread=0.012, pan=0.0, gain=1.0, send=0.25):
    order = list(notes) if down else list(reversed(notes))
    for i, note in enumerate(order):
        mix.add(t + i * spread, voice(note, vel * (1.0 - 0.06 * i)), pan, gain, send)


def pad_bars(mix: Mix, progression: Sequence[str], low: Note, count: int, fn, *, bars: Iterable[int] | None = None, pan=0.0, gain=1.0, send=0.5, overlap=1.02):
    for bar in bars if bars is not None else range(len(progression)):
        notes = voicing(progression[bar], low, count)
        mix.add(mix.grid.at(bar), fn(notes, mix.grid.bar * overlap), pan, gain, send)


# ---------------------------------------------------------------- the cues

D_MIXOLYDIAN_PCS = (0, 2, 4, 6, 7, 9, 11)

THEME_MINOR_A = "D4:2 A4:2 | Bb4 A4 G4 F4 | A4:2 C5:2 | Bb4 A4 G4:2 | A4:1.5 G4:0.5 F4 E4 | D4:2 G4:2 | F4 G4 A4 Bb4 | A4:4"
THEME_MINOR_B = "D5:2 A5:2 | Bb5 A5 G5 F5 | A5:2 C6:2 | Bb5 A5 G5:2 | Bb5:1.5 A5:0.5 G5 D5 | F5:2 Bb5:2 | C6 Bb5 A5 G5 | A5:2 G5 E5"
THEME_MAJOR_A = "D4:2 A4:2 | B4 A4 G4 F#4 | A4:2 C#5:2 | B4 A4 G4:2 | A4:1.5 G4:0.5 F#4 E4 | D4:2 G4:2 | F#4 G4 A4 B4 | A4:4"
THEME_MAJOR_B = "D5:2 A5:2 | B5 A5 G5 F#5 | A5:2 C#6:2 | B5 A5 G5:2 | B5:1.5 A5:0.5 G5 D5 | F#5:2 B5:2 | C#6 B5 A5 G5 | A5:2 G5 E5"


def horn(note, dur, vel=0.75):
    return brass([note], dur, vel, attack=0.14, release=0.45, bright=0.55)


def cue_title() -> np.ndarray:
    """A Very Potent Brew — main title. D minor, 70 bpm."""
    g = Grid(70, 4, 16)
    mix = Mix(g)
    prog = "Dm Bb F C Dm Gm Bb A Dm Bb F C Gm Bb C A".split()
    for bar, sym in enumerate(prog):
        low = root_in(sym, "C2")
        mix.add(g.at(bar), strings([low, low + 12], g.bar * 1.02, 0.9, 0.6, 1.2, 0.35), 0.0, 0.9, 0.35)
    pad_bars(mix, prog, "A3", 3, lambda n, d: strings(n, d, 0.8, 1.0, 1.5, 0.45), gain=0.7, send=0.5)
    for bar, sym in enumerate(prog):
        arpeggio(mix, bar, sym, "D3", (0, 1, 2, 3, 4, 5, 4, 2), vel=0.7, pan=-0.35, gain=0.55, send=0.45)
    play(mix, 0, line(THEME_MINOR_A), horn, pan=0.1, gain=0.55, send=0.45)
    play(mix, 8, line(THEME_MINOR_B), lambda n, d: flute(n, d, 0.9), pan=0.25, gain=0.42, send=0.5)
    play(mix, 8, line(THEME_MINOR_B, shift=-12), lambda n, d: strings([n], d, 0.9, 0.18, 0.6, 0.6, 0.3), pan=-0.1, gain=0.55, send=0.45)
    pad_bars(mix, prog, "D4", 3, lambda n, d: choir(n, d, 0.8, "a"), bars=range(8, 16), gain=0.38, send=0.6)
    for bar in range(8, 16):
        mix.add(g.at(bar), taiko(0.6, 1.3), 0.0, 0.35, 0.3)
    for target in (8, 16):
        mix.add(g.at(target) - 2.4, swell(2.4), 0.0, 0.8, 0.4)
    for bar in (0, 4, 8, 12):
        root = root_in(prog[bar], "C5")
        mix.add(g.at(bar), bell(root, 0.7, "celesta"), -0.2, 0.2, 0.6)
        mix.add(g.at(bar, 0.5), bell(root + 7, 0.5, "celesta"), 0.2, 0.18, 0.6)
    return mix.render(3.0, 0.35, -19.0)


def cue_tavern() -> np.ndarray:
    """Jig at the Wizard's Tower — D mixolydian 6/8, dotted quarter at 112."""
    g = Grid(336, 6, 48)
    mix = Mix(g)
    chords = "D C D C D G Am D".split()
    prog = chords * 6
    tune_a = line("D5 A4 F#4 A4 F#4 D4 | C5 G4 E4 G4 E4 C4 | D5 A4 F#4 A4 B4 C5 | D5 E5 D5 C5 A4 G4 | F#4 A4 D5 A4 F#4 A4 | G4 B4 D5 B4 G4 B4 | A4 B4 C5 E5 D5 C5 | D5:3 A4 B4 C5")
    tune_b = line("F#5 E5 D5 E5 F#5 A5 | G5 E5 D5 C5 E5 G5 | A4 D5 F#5 A5 F#5 D5 | E5 D5 C5 E5 G5 E5 | F#5 A5 F#5 E5 D5 C5 | B4 D5 G5 D5 B4 G4 | A4 C5 E5 D5 C5 A4 | D5:3 A4 B4 C5")
    whistle = lambda n, d: flute(n, d, 0.95, 0.05, 0.004)
    hammered = lambda n, d: dulcimer(n, 0.8)
    under = lambda notes: shifted(notes, lambda m: diatonic(m, -2, D_MIXOLYDIAN_PCS))

    play(mix, 0, tune_a, whistle, pan=0.2, gain=0.5, send=0.25, legato=0.9)
    play(mix, 8, tune_a, whistle, pan=0.2, gain=0.5, send=0.25, legato=0.9)
    play(mix, 8, under(tune_a), hammered, pan=-0.35, gain=0.32, send=0.25)
    play(mix, 16, tune_b, whistle, pan=0.2, gain=0.5, send=0.25, legato=0.9)
    play(mix, 24, tune_b, whistle, pan=0.2, gain=0.5, send=0.25, legato=0.9)
    play(mix, 24, shifted(tune_b, lambda m: m - 12), hammered, pan=-0.35, gain=0.34, send=0.25)
    play(mix, 32, tune_a, hammered, pan=-0.2, gain=0.5, send=0.25)
    play(mix, 32, under(tune_a), whistle, pan=0.3, gain=0.32, send=0.25, legato=0.9)
    play(mix, 40, tune_b, whistle, pan=0.2, gain=0.48, send=0.25, legato=0.9)
    play(mix, 40, tune_b, hammered, pan=-0.3, gain=0.36, send=0.25)

    for bar, sym in enumerate(prog):
        t0 = g.at(bar)
        bass = root_in(sym, "E2")
        chord = voicing(sym, "D3", 4)
        mix.add(hum(t0), lute(bass, 0.9), -0.3, 0.5, 0.2)
        strum(mix, hum(t0), chord, vel=0.75, pan=-0.3, gain=0.42)
        strum(mix, hum(g.at(bar, 3)), chord, vel=0.5, down=False, pan=-0.3, gain=0.42)
        mix.add(hum(g.at(bar, 2)), lute(chord[-1], 0.4), -0.25, 0.4, 0.2)
        mix.add(hum(g.at(bar, 5)), lute(chord[-2], 0.35), -0.25, 0.4, 0.2)

        accents = (1.0, 0.35, 0.5, 0.75, 0.35, 0.5)
        for step, vel in enumerate(accents):
            tip = step not in (0, 3)
            mix.add(hum(g.at(bar, step), 0.004), bodhran(vel * R.uniform(0.85, 1.0), tip), 0.05, 0.42, 0.12)
        if bar % 8 == 7:
            for k in range(6):
                mix.add(g.at(bar, 3 + k * 0.5), bodhran(0.3 + 0.08 * k, True), 0.05, 0.4, 0.12)

    drone = circular(lambda n: strings(["D3", "A3"], n / SR, 0.7, 0.01, 0.01, 0.3)[:n], mix.loop_n)
    mix.bed(drone, 0.0, 0.3, 0.3)
    mix.bed(circular(murmur, mix.loop_n), 0.0, 0.55, 0.35)
    mix.bed(circular(crackle, mix.loop_n), 0.4, 0.35, 0.1)
    for _ in range(7):
        mix.add(R.uniform(0, g.length), bell(int(R.integers(96, 104)), 0.5, "glock"), R.uniform(-0.7, 0.7), 0.06, 0.4)
    return mix.render(1.2, 0.25, -18.0)


def cue_descent() -> np.ndarray:
    """What Lies Beneath — A aeolian, 58 bpm, cavern."""
    g = Grid(58, 4, 16)
    mix = Mix(g)
    prog = "Am F G Em Am Dm F E".split() * 2
    mix.bed(circular(lambda n: strings(["A1", "E2"], n / SR, 0.8, 0.01, 0.01, 0.2)[:n], mix.loop_n), 0.0, 0.5, 0.5)
    mix.bed(circular(wind, mix.loop_n), 0.0, 0.9, 0.5)
    pad_bars(mix, prog, "E3", 3, lambda n, d: strings(n, d, 0.7, 2.2, 3.0, 0.3), gain=0.5, send=0.7, overlap=1.05)
    for bar, sym in enumerate(prog):
        if bar % 8 < 4:
            arpeggio(mix, bar, sym, "A2", (0, 2, 4, 5, 3, 1, 2, 4), vel=0.5, pan=-0.4, gain=0.5, send=0.7)
        else:
            tones = voicing(sym, "A2", 3)
            mix.add(g.at(bar), harp(tones[0], 0.5), -0.4, 0.45, 0.7)
            mix.add(g.at(bar, 2), harp(tones[2], 0.4), -0.3, 0.45, 0.7)
    breathy = lambda n, d: flute(n, d, 0.85, 0.12, 0.005)
    play(mix, 4, line("E4:2 A4:1.5 B4:0.5 | C5:3 A4 | G4 F4 E4 C4 | E4:4"), breathy, pan=0.2, gain=0.36, send=0.75)
    play(mix, 12, line("A4:2 C5 E5 | D5:2 F5 E5 | C5:2 A4 G4 | G#4:2 B4 E4"), breathy, pan=0.2, gain=0.36, send=0.75)
    for bar in range(1, 16, 2):
        tones = voicing(prog[bar], "C6", 3)
        mix.add(g.at(bar, 2), bell(tones[int(R.integers(0, 3))], 0.5, "celesta"), R.uniform(-0.6, 0.6), 0.13, 0.9)
    for _ in range(14):
        mix.add(R.uniform(0, g.length), drip(R.uniform(900, 1800)), R.uniform(-0.9, 0.9), 0.07, 0.9)
    for bar in (0, 8):
        mix.add(g.at(bar), taiko(0.7, 2.0), 0.0, 0.35, 0.6)
    return mix.render(5.5, 0.45, -21.0, damp=0.35, predelay=0.04)


def cue_tension() -> np.ndarray:
    """Noise from the Deep — E phrygian pulse, 84 bpm."""
    g = Grid(84, 4, 16)
    mix = Mix(g)
    roots = [midi(n) for n in "E2 E2 F2 E2 E2 E2 G2 F2 E2 F2 E2 F2 G2 F2 Bb1 A1".split()]
    figure = (0, 0, 12, 0, 1, 0, 3, 1)
    for bar, root in enumerate(roots):
        for step, interval in enumerate(figure):
            vel = 0.9 if step in (0, 4) else 0.6
            mix.add(hum(g.at(bar, step * 0.5), 0.003), spiccato(root + interval, vel), -0.15, 0.55, 0.3)
        mix.add(g.at(bar), strings([root - 12], g.bar * 1.02, 0.9, 0.3, 0.8, 0.2), 0.0, 0.55, 0.3)
        mix.add(g.at(bar), taiko(0.8, 1.4), 0.0, 0.42, 0.25)
        mix.add(g.at(bar, 0.45), taiko(0.5, 1.4), 0.0, 0.42, 0.25)
        if bar >= 8:
            for off in range(4):
                mix.add(hum(g.at(bar, off + 0.5), 0.003), shaker(0.8), 0.35, 0.28, 0.2)
    for start in (4, 12):
        mix.add(g.at(start), strings(["B4", "C5"], g.bar * 4, 0.8, 2.0, 1.5, 0.6, 0.9, trem=11.0), 0.0, 0.3, 0.6)
    for target in (8, 16):
        mix.add(g.at(target) - 2.5, swell(2.5), 0.0, 0.9, 0.4)
    for bar in (3, 11):
        mix.add(g.at(bar, 2), bell("E3", 0.7, "anvil"), 0.4, 0.14, 0.8)
    for bar in (0, 8):
        mix.add(g.at(bar), brass(["E1", "B1", "E2"], 3.0, 0.8, 0.25, 1.2, bright=0.5), 0.0, 0.4, 0.5)
    mix.bed(circular(rumble, mix.loop_n), 0.0, 0.5, 0.3)
    return mix.render(3.2, 0.35, -20.0)


def cue_combat() -> np.ndarray:
    """Steel in the Cellar — D minor, 140 bpm, 3+3+2."""
    g = Grid(140, 4, 24)
    mix = Mix(g)
    prog = "Dm Bb C A Dm Bb Gm A".split() + "Bb C Dm Dm Bb C A A".split() + "Dm Bb C A Gm Bb A A".split()
    figure = (0, 0, 12, 0, 0, 12, 7, 12)
    for bar, sym in enumerate(prog):
        root = root_in(sym, "C2")
        for step, interval in enumerate(figure):
            vel = 1.0 if step in (0, 3, 6) else 0.6
            t = hum(g.at(bar, step * 0.5), 0.003)
            mix.add(t, spiccato(root + interval, vel, 0.13), -0.2, 0.5, 0.2)
            mix.add(t, spiccato(root + interval + 12, vel * 0.6, 0.11), 0.25, 0.35, 0.2)
        mix.add(g.at(bar), strings([root - 12, root], g.bar * 1.02, 0.8, 0.1, 0.5, 0.3), 0.0, 0.4, 0.3)
        for step in (0, 3, 6):
            mix.add(hum(g.at(bar, step * 0.5), 0.003), taiko(1.0 if step < 6 else 0.75, 1.1), 0.0, 0.55, 0.15)
        for step in (2, 5, 7):
            mix.add(hum(g.at(bar, step * 0.5), 0.003), tom(0.45, 1.3), 0.3, 0.4, 0.15)
        if bar >= 8:
            for beat in (1, 3):
                mix.add(hum(g.at(bar, beat), 0.003), snare(0.8), 0.1, 0.28, 0.2)
        if bar % 8 == 7:
            for k in range(8):
                mix.add(g.at(bar, 2 + k * 0.25), tom(0.35 + 0.07 * k, 1.1 + 0.05 * (k % 3)), -0.3 + 0.08 * k, 0.45, 0.15)
    play(mix, 0, line(THEME_MINOR_A), lambda n, d: brass([n, n - 12], d, 0.85, 0.08, 0.3, bright=0.75), pan=0.05, gain=0.6, send=0.3)
    for bar in range(8, 16):
        chord = voicing(prog[bar], "D3", 4)
        for step in (0, 3):
            mix.add(hum(g.at(bar, step * 0.5), 0.003), brass(chord, 0.22, 0.9, stab=True, bright=0.85), 0.0, 0.5, 0.3)
    pad_bars(mix, prog, "D4", 3, lambda n, d: choir(n, d, 0.9, "a", 0.5, 1.0), bars=range(8, 24), gain=0.34, send=0.45)
    play(mix, 16, line(THEME_MINOR_A, shift=12), lambda n, d: strings([n], d, 0.9, 0.06, 0.35, 0.75, 0.3), pan=-0.1, gain=0.6, send=0.35)
    play(mix, 16, line(THEME_MINOR_A, shift=12), lambda n, d: flute(n, d, 0.8, 0.05), pan=0.3, gain=0.26, send=0.35)
    pad_bars(mix, prog, "A2", 3, lambda n, d: brass(n, d, 0.6, 0.2, 0.6, bright=0.45), bars=range(16, 24), gain=0.3, send=0.35)
    for target in (8, 16, 24):
        mix.add(g.at(target) - 1.7, swell(1.7), 0.0, 0.8, 0.3)
    return mix.render(2.2, 0.25, -17.0)


def cue_boss() -> np.ndarray:
    """The Infernal Weaver — B phrygian with a tritone, 92 bpm."""
    g = Grid(92, 4, 16)
    mix = Mix(g)
    prog = "Bm C Bm F Bm C G F#".split() * 2
    for bar in (0, 4, 8, 12):
        sym = prog[bar]
        root = root_in(sym, "A1")
        mix.add(g.at(bar), brass([root, root + 12, root + 19, root + 24], 3.6, 1.0, 0.18, 1.6, bright=0.8), 0.0, 0.48, 0.45)
    mix.bed(circular(lambda n: strings(["B1", "F#2"], n / SR, 0.8, 0.01, 0.01, 0.25)[:n], mix.loop_n), 0.0, 0.4, 0.3)
    for bar, sym in enumerate(prog):
        mix.add(hum(g.at(bar, 0.0), 0.003), taiko(1.0, 1.3), 0.0, 0.6, 0.2)
        mix.add(hum(g.at(bar, 1.5), 0.003), taiko(0.55, 1.0), 0.0, 0.5, 0.2)
        mix.add(hum(g.at(bar, 2.0), 0.003), taiko(0.85, 1.3), 0.0, 0.6, 0.2)
        mix.add(hum(g.at(bar, 3.5), 0.003), tom(0.5, 1.2), 0.25, 0.45, 0.2)
        if bar % 8 == 7:
            for k in range(8):
                mix.add(g.at(bar, 2 + k * 0.25), tom(0.4 + 0.07 * k, 1.0 + 0.1 * (k % 2)), 0.3 - 0.08 * k, 0.5, 0.2)
        if bar >= 4:
            shift = root_in(sym, "A4") - midi("B4")
            for step, interval in enumerate((0, 1, 0, 6, 0, 1, 3, 1) * 2):
                side = 0.55 if step % 2 == 0 else -0.55
                mix.add(hum(g.at(bar, step * 0.25), 0.002), spiccato(midi("B4") + shift + interval, R.uniform(0.4, 0.6), 0.09), side, 0.32, 0.35)
    pad_bars(mix, prog, "B3", 3, lambda n, d: choir(n, d, 0.9, "o", 0.6, 1.2), bars=range(8, 16), gain=0.45, send=0.6)
    pad_bars(mix, prog, "B2", 3, lambda n, d: choir(n, d, 0.7, "u", 1.2, 1.5), bars=range(0, 8), gain=0.25, send=0.55)
    for bar in (3, 11):
        mix.add(g.at(bar), bell("F3", 0.8, "anvil"), -0.3, 0.26, 0.6)
    for target in (8, 16):
        mix.add(g.at(target) - 2.2, swell(2.2), 0.0, 0.9, 0.4)
    mix.bed(circular(rumble, mix.loop_n), 0.0, 0.6, 0.25)
    for _ in range(22):
        mix.add(R.uniform(0, g.length), bubble(R.uniform(60, 130)), R.uniform(-0.7, 0.7), 0.12, 0.4)
    return mix.render(3.4, 0.33, -17.5)


def cue_victory() -> np.ndarray:
    """Three Seals, One Toast — D major, 76 bpm."""
    g = Grid(76, 4, 16)
    mix = Mix(g)
    prog = "D G A Em D G Em A D G A Em G Bm A A".split()
    for bar, sym in enumerate(prog):
        low = root_in(sym, "C2")
        mix.add(g.at(bar), strings([low, low + 12], g.bar * 1.02, 0.8, 0.5, 1.2, 0.4), 0.0, 0.75, 0.35)
        arpeggio(mix, bar, sym, "D3", (0, 1, 2, 3, 4, 5, 4, 2), vel=0.7, pan=-0.35, gain=0.52, send=0.45)
    pad_bars(mix, prog, "A3", 3, lambda n, d: strings(n, d, 0.8, 0.9, 1.4, 0.5), gain=0.65, send=0.5)
    play(mix, 0, line(THEME_MAJOR_A), horn, pan=0.1, gain=0.55, send=0.45)
    play(mix, 8, line(THEME_MAJOR_B), lambda n, d: flute(n, d, 0.9), pan=0.25, gain=0.42, send=0.5)
    play(mix, 8, line(THEME_MAJOR_B, shift=-12), lambda n, d: strings([n], d, 0.9, 0.18, 0.6, 0.6, 0.3), pan=-0.1, gain=0.55, send=0.45)
    pad_bars(mix, prog, "D4", 3, lambda n, d: choir(n, d, 0.7, "a"), bars=range(8, 16), gain=0.3, send=0.6)
    for bar in range(0, 16, 2):
        mix.add(g.at(bar), bell(root_in(prog[bar], "C6"), 0.6, "glock"), 0.3, 0.14, 0.55)
    for bar in range(8, 16):
        mix.add(g.at(bar), taiko(0.5, 1.2), 0.0, 0.3, 0.3)
    mix.add(g.at(16) - 2.0, swell(2.0), 0.0, 0.6, 0.4)
    return mix.render(2.8, 0.33, -19.0)


CUES: dict[str, tuple[int, Callable[[], np.ndarray]]] = {
    "title": (11, cue_title),
    "tavern": (23, cue_tavern),
    "descent": (37, cue_descent),
    "tension": (41, cue_tension),
    "combat": (53, cue_combat),
    "boss": (67, cue_boss),
    "victory": (79, cue_victory),
}


# ---------------------------------------------------------------- output


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = np.clip(x + R.uniform(-0.5, 0.5, x.shape) / 32768.0, -1.0, 1.0)
    data = (pcm * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def encode(wav: Path, out_dir: Path, name: str) -> list[Path]:
    targets = [
        (out_dir / f"{name}.ogg", ["-c:a", "libvorbis", "-q:a", "4"]),
        (out_dir / f"{name}.m4a", ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]),
    ]
    for path, args in targets:
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), *args, str(path)],
            check=True,
        )
    return [p for p, _ in targets]


def report(name: str, x: np.ndarray) -> str:
    rms = 20 * math.log10(float(np.sqrt(np.mean(x**2))) + 1e-12)
    peak = 20 * math.log10(float(np.max(np.abs(x))) + 1e-12)
    seam = float(np.max(np.abs(x[0] - x[-1])))
    typical = float(np.percentile(np.abs(np.diff(x, axis=0)), 99.9))
    return f"{name:8s} {len(x) / SR:6.2f}s  rms {rms:6.1f} dBFS  peak {peak:5.1f} dBFS  seam {seam:.4f} (p99.9 step {typical:.4f})"


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="*", choices=sorted(CUES), help="render a subset")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--keep-wav", type=Path, help="also keep the 16-bit masters here")
    args = parser.parse_args(argv)

    if not shutil.which("ffmpeg"):
        print("ffmpeg is required on PATH", file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    names = args.only or list(CUES)
    with tempfile.TemporaryDirectory() as tmp:
        for name in names:
            cue_seed, compose = CUES[name]
            seed(cue_seed)
            _PLUCK_CACHE.clear()
            audio = compose()
            wav = Path(tmp) / f"{name}.wav"
            write_wav(wav, audio)
            encode(wav, args.out, name)
            if args.keep_wav:
                args.keep_wav.mkdir(parents=True, exist_ok=True)
                shutil.copy(wav, args.keep_wav / wav.name)
            print(report(name, audio), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
