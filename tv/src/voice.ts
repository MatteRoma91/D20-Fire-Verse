/**
 * The narrator: plays the neural voice the table server renders for each beat,
 * ducks the score under it and publishes the sentence being spoken for subtitles.
 * Falls back to the browser voice when the server has no clip in time.
 */

import { scriptLines, type CastMember } from "@d20-fireverse/protocol";
import { audioReady } from "./audio";
import { duckMusic } from "./music";
import { settings } from "./settings";
import type { Voice } from "./types";

export type Cue = { text: string; start: number; end: number; speaker?: string };
export type SpokenCue = { line: string; index: number; cues: Cue[]; text: string; speaker: string | null } | null;

type Clip = { key: string; text: string; duration: number; cues: Cue[]; url: string };

type Job = { voice: Voice; resolve: () => void };

const META_TIMEOUT_MS = 9000;
const played = new Set<string>();
const queue: Job[] = [];
const clipCache = new Map<string, Promise<{ clip: Clip; buffer: AudioBuffer } | null>>();
const cueListeners = new Set<(cue: SpokenCue) => void>();

let running = false;
let generation = 0;
let stopCurrent: (() => void) | null = null;
let lastVoice: Voice | null = null;
let cast: Record<string, CastMember> = {};

/** Who can speak at this table (used by the browser-voice fallback). */
export function setCast(next: Record<string, CastMember> | undefined) {
  cast = next ?? {};
}

function emit(cue: SpokenCue) {
  for (const fn of cueListeners) fn(cue);
}

export function onSpokenCue(fn: (cue: SpokenCue) => void): () => void {
  cueListeners.add(fn);
  return () => cueListeners.delete(fn);
}

function idOf(v: Voice): string {
  return `${v.seq}:${v.key ?? v.text}`;
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((p) => p.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Sentence cues with their speaker, for when there is no server clip to time them. */
function scriptedCues(text: string): Cue[] {
  return scriptLines(text).flatMap((l) =>
    splitSentences(l.text).map((s) => ({ text: s, start: 0, end: 0, ...(l.speaker && cast[l.speaker] ? { speaker: l.speaker } : {}) })),
  );
}

async function fetchClip(key: string): Promise<{ clip: Clip; buffer: AudioBuffer } | null> {
  const cached = clipCache.get(key);
  if (cached) return cached;
  const task = (async () => {
    const b = audioReady();
    if (!b) return null;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), META_TIMEOUT_MS);
    try {
      const metaRes = await fetch(`/api/narration/${key}/meta`, { signal: ctrl.signal });
      if (!metaRes.ok) return null;
      const clip = (await metaRes.json()) as Clip;
      const audioRes = await fetch(clip.url, { signal: ctrl.signal });
      if (!audioRes.ok) return null;
      const buffer = await b.ctx.decodeAudioData(await audioRes.arrayBuffer());
      return { clip, buffer };
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  })();
  clipCache.set(key, task);
  void task.then((r) => {
    if (!r) clipCache.delete(key);
  });
  if (clipCache.size > 24) {
    const oldest = clipCache.keys().next().value;
    if (oldest && oldest !== key) clipCache.delete(oldest);
  }
  return task;
}

/** Start fetching a clip before it is needed (the next beat is usually predictable). */
export function prefetchVoice(v: Voice | null | undefined) {
  if (v?.key && settings().narration) void fetchClip(v.key);
}

function playBuffer(clip: Clip, buffer: AudioBuffer, gen: number): Promise<void> {
  return new Promise((resolve) => {
    const b = audioReady();
    if (!b || gen !== generation) return resolve();
    const src = b.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(b.voice);
    const startAt = b.ctx.currentTime + 0.05;
    let raf = 0;
    let lastIndex = -2;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      stopCurrent = null;
      emit(null);
      resolve();
    };
    const tick = () => {
      if (done) return;
      const t = b.ctx.currentTime - startAt;
      let index = clip.cues.findIndex((c) => t >= c.start - 0.05 && t < c.end + 0.25);
      if (index < 0 && t > 0) index = lastIndex;
      if (index !== lastIndex) {
        lastIndex = index;
        const cue = index >= 0 ? clip.cues[index]! : null;
        emit(cue ? { line: clip.text, index, cues: clip.cues, text: cue.text, speaker: cue.speaker ?? null } : null);
      }
      raf = requestAnimationFrame(tick);
    };
    src.onended = finish;
    stopCurrent = () => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      finish();
    };
    src.start(startAt);
    raf = requestAnimationFrame(tick);
  });
}

function speakFallback(text: string, gen: number): Promise<void> {
  const cues = scriptedCues(text);
  const synth = window.speechSynthesis;
  if (!synth || !cues.length) {
    return readAlong(text, cues, gen);
  }
  return new Promise((resolve) => {
    let i = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stopCurrent = null;
      emit(null);
      resolve();
    };
    stopCurrent = () => {
      synth.cancel();
      finish();
    };
    const next = () => {
      if (gen !== generation || i >= cues.length) return finish();
      const cue = cues[i]!;
      const who = cue.speaker ? cast[cue.speaker] : undefined;
      const u = new SpeechSynthesisUtterance(cue.text);
      u.lang = "en-GB";
      u.rate = who ? 1.02 : 0.98;
      u.pitch = Math.min(2, Math.max(0, who?.pitch ?? 1));
      u.volume = Math.min(1, settings().voice);
      emit({ line: text, index: i, cues, text: cue.text, speaker: cue.speaker ?? null });
      u.onend = () => {
        i += 1;
        next();
      };
      u.onerror = () => finish();
      synth.speak(u);
    };
    synth.cancel();
    next();
  });
}

/** Voice off: still pace the subtitles at reading speed so the table can follow along. */
function readAlong(text: string, cues: Cue[], gen: number): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      stopCurrent = null;
      emit(null);
      resolve();
    };
    stopCurrent = finish;
    const step = () => {
      if (gen !== generation || i >= cues.length) return finish();
      emit({ line: text, index: i, cues, text: cues[i]!.text, speaker: cues[i]!.speaker ?? null });
      const words = cues[i]!.text.split(/\s+/).length;
      i += 1;
      timer = window.setTimeout(step, Math.max(1400, words * 330));
    };
    step();
  });
}

async function run(job: Job) {
  const gen = generation;
  const v = job.voice;
  const s = settings();
  if (!s.narration) {
    if (s.subtitles) await readAlong(v.text, scriptedCues(v.text), gen);
    return;
  }
  duckMusic(true);
  try {
    const clip = v.key ? await fetchClip(v.key) : null;
    if (gen !== generation) return;
    if (clip) await playBuffer(clip.clip, clip.buffer, gen);
    else await speakFallback(v.text, gen);
  } finally {
    if (gen === generation && queue.length === 0) duckMusic(false);
  }
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    await run(job);
    job.resolve();
  }
  running = false;
  duckMusic(false);
}

/**
 * Speak a beat once. `interrupt` cuts whatever is playing (a new scene);
 * otherwise the line waits its turn (the outro of a fight, then the next scene).
 */
export function speak(v: Voice | null | undefined, opts: { interrupt?: boolean } = {}): Promise<void> {
  if (!v?.text) return Promise.resolve();
  const id = idOf(v);
  if (played.has(id)) return Promise.resolve();
  played.add(id);
  if (played.size > 200) played.delete(played.values().next().value!);
  lastVoice = v;
  if (opts.interrupt) stopNarration();
  return new Promise((resolve) => {
    queue.push({ voice: v, resolve });
    void pump();
  });
}

export function stopNarration() {
  generation += 1;
  for (const job of queue.splice(0)) job.resolve();
  stopCurrent?.();
  window.speechSynthesis?.cancel();
  emit(null);
}

/** Play/Pause on the remote: hear the last line again. */
export function replayNarration() {
  if (!lastVoice) return;
  const v = lastVoice;
  stopNarration();
  played.delete(idOf(v));
  void speak(v);
}

export function isNarrating(): boolean {
  return running;
}
