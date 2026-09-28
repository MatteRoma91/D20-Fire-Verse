/**
 * The narrator: neural TTS (Kokoro-82M, Apache-2.0) rendered on the table server,
 * cached on disk by text hash and served as AAC with sentence timings for subtitles.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

export type NarrationCue = { text: string; start: number; end: number };
export type NarrationClip = {
  key: string;
  text: string;
  voice: string;
  duration: number;
  cues: NarrationCue[];
  url: string;
};

type Job = { key: string; text: string; resolve: (clip: NarrationClip | null) => void };

const VOICE = process.env.NARRATOR_VOICE || "bm_george";
const SPEED = Number(process.env.NARRATOR_SPEED || 0.94);
const MODEL = process.env.NARRATOR_MODEL || "onnx-community/Kokoro-82M-v1.0-ONNX";
const ENABLED = process.env.NARRATION !== "off";
const SAMPLE_RATE = 24000;
const SENTENCE_GAP = 0.32;
const PARAGRAPH_GAP = 0.62;
const LEAD_IN = 0.12;
const DIR = path.join(DATA_DIR, "narration");
const FFMPEG = hasFfmpeg();
const EXT = FFMPEG ? "m4a" : "wav";

type Engine = {
  generate(text: string, opts: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
};

let engine: Promise<Engine | null> | null = null;
let engineState: "idle" | "loading" | "ready" | "failed" | "disabled" = ENABLED ? "idle" : "disabled";
const queue: Job[] = [];
const waiting = new Map<string, Promise<NarrationClip | null>>();
const failed = new Set<string>();
let working = false;

function hasFfmpeg(): boolean {
  try {
    return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/** What the voice actually says: the same words, without typography it would read aloud. */
export function speakable(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/…/g, "...")
    .replace(/[«»“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\*|_|#|★|●|○/g, "")
    .replace(/\s*\((?:[^)]{0,40})\)/g, "")
    .replace(/(\d+)\s*\/\s*(\d+)/g, "$1 of $2")
    .replace(/\bHP\b/g, "hit points")
    .replace(/\bAC\b/g, "armor class")
    .replace(/\bDC\b/g, "difficulty")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function narrationKey(text: string): string {
  return createHash("sha1").update(`${VOICE}|${SPEED}|${speakable(text)}`).digest("hex").slice(0, 20);
}

function metaPath(key: string) {
  return path.join(DIR, `${key}.json`);
}

export function audioPath(key: string): string | null {
  for (const ext of ["m4a", "wav"]) {
    const file = path.join(DIR, `${key}.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const clips = new Map<string, NarrationClip>();
const known = new Map<string, string>();

function readClip(key: string): NarrationClip | null {
  const hit = clips.get(key);
  if (hit) return hit;
  const file = metaPath(key);
  if (!fs.existsSync(file) || !audioPath(key)) return null;
  try {
    const clip = JSON.parse(fs.readFileSync(file, "utf8")) as NarrationClip;
    clips.set(key, clip);
    return clip;
  } catch {
    return null;
  }
}

function splitSentences(paragraph: string): string[] {
  const raw = paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [paragraph];
  const out: string[] = [];
  for (const piece of raw.map((s) => s.trim()).filter(Boolean)) {
    const last = out[out.length - 1];
    if (last && (last.length < 18 || piece.length < 8)) out[out.length - 1] = `${last} ${piece}`;
    else out.push(piece);
  }
  return out;
}

function trimSilence(samples: Float32Array): Float32Array {
  const threshold = 0.004;
  let start = 0;
  let end = samples.length - 1;
  while (start < end && Math.abs(samples[start]) < threshold) start += 1;
  while (end > start && Math.abs(samples[end]) < threshold) end -= 1;
  const pad = Math.floor(SAMPLE_RATE * 0.03);
  return samples.subarray(Math.max(0, start - pad), Math.min(samples.length, end + pad));
}

function wavBytes(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function encodeAac(wav: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    proc.stderr.on("data", (d) => (err += String(d)));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg ${code}`))));
  });
}

async function loadEngine(): Promise<Engine | null> {
  if (!ENABLED) return null;
  if (!engine) {
    engineState = "loading";
    engine = (async () => {
      try {
        const t0 = Date.now();
        const { KokoroTTS } = await import("kokoro-js");
        const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "cpu" });
        engineState = "ready";
        console.log(`Narrator ready (${VOICE}) in ${Date.now() - t0} ms`);
        return tts as unknown as Engine;
      } catch (err) {
        engineState = "failed";
        console.warn("Narrator unavailable — the TV falls back to its own voice:", err instanceof Error ? err.message : err);
        return null;
      }
    })();
  }
  return engine;
}

async function render(key: string, text: string): Promise<NarrationClip | null> {
  const tts = await loadEngine();
  if (!tts) return null;
  const paragraphs = speakable(text)
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: Float32Array[] = [];
  const cues: NarrationCue[] = [];
  let cursor = LEAD_IN;
  chunks.push(new Float32Array(Math.floor(LEAD_IN * SAMPLE_RATE)));
  for (let p = 0; p < paragraphs.length; p += 1) {
    const sentences = splitSentences(paragraphs[p]);
    for (let s = 0; s < sentences.length; s += 1) {
      const sentence = sentences[s];
      if (!/[a-z0-9]/i.test(sentence)) continue;
      const out = await tts.generate(sentence, { voice: VOICE, speed: SPEED });
      const voiced = trimSilence(out.audio);
      const len = voiced.length / SAMPLE_RATE;
      cues.push({ text: sentence, start: round(cursor), end: round(cursor + len) });
      chunks.push(voiced);
      cursor += len;
      const last = p === paragraphs.length - 1 && s === sentences.length - 1;
      const gap = last ? 0.35 : s === sentences.length - 1 ? PARAGRAPH_GAP : SENTENCE_GAP;
      chunks.push(new Float32Array(Math.floor(gap * SAMPLE_RATE)));
      cursor += gap;
    }
  }
  if (!cues.length) return null;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  let peak = 0;
  for (const c of chunks) {
    pcm.set(c, offset);
    offset += c.length;
  }
  for (let i = 0; i < pcm.length; i += 1) peak = Math.max(peak, Math.abs(pcm[i]));
  const gain = peak > 0 ? Math.min(3, 0.89 / peak) : 1;
  for (let i = 0; i < pcm.length; i += 1) pcm[i] *= gain;

  fs.mkdirSync(DIR, { recursive: true });
  const wav = path.join(DIR, `${key}.wav`);
  fs.writeFileSync(wav, wavBytes(pcm));
  if (FFMPEG) {
    await encodeAac(wav, path.join(DIR, `${key}.m4a`));
    fs.rmSync(wav, { force: true });
  }
  const clip: NarrationClip = {
    key,
    text,
    voice: VOICE,
    duration: round(total / SAMPLE_RATE),
    cues,
    url: `/api/narration/${key}.${EXT}`,
  };
  fs.writeFileSync(metaPath(key), JSON.stringify(clip, null, 2));
  clips.set(key, clip);
  return clip;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

async function pump(): Promise<void> {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      let clip = readClip(job.key);
      if (!clip) {
        try {
          clip = await render(job.key, job.text);
        } catch (err) {
          console.warn(`Narration failed for ${job.key}:`, err instanceof Error ? err.message : err);
          clip = null;
        }
      }
      if (!clip) failed.add(job.key);
      job.resolve(clip);
    }
  } finally {
    working = false;
  }
}

function enqueue(text: string, urgent: boolean): Promise<NarrationClip | null> {
  const key = narrationKey(text);
  const cached = readClip(key);
  if (cached) return Promise.resolve(cached);
  if (failed.has(key) || !ENABLED || engineState === "failed") return Promise.resolve(null);
  const inflight = waiting.get(key);
  if (inflight) {
    if (urgent) {
      const idx = queue.findIndex((j) => j.key === key);
      if (idx > 0) queue.unshift(...queue.splice(idx, 1));
    }
    return inflight;
  }
  const promise = new Promise<NarrationClip | null>((resolve) => {
    const job: Job = { key, text, resolve };
    if (urgent) queue.unshift(job);
    else queue.push(job);
  }).finally(() => waiting.delete(key));
  waiting.set(key, promise);
  void pump();
  return promise;
}

/** Ask for a line the table is about to show. Returns its key immediately. */
export function requestNarration(text: string): string | null {
  if (!ENABLED || !text.trim()) return null;
  const key = narrationKey(text);
  if (readClip(key)) return key;
  known.set(key, text);
  void enqueue(text, true);
  return key;
}

export async function waitForNarration(key: string, timeoutMs: number): Promise<NarrationClip | null> {
  const cached = readClip(key);
  if (cached) return cached;
  let inflight = waiting.get(key);
  if (!inflight) {
    const text = known.get(key);
    if (!text) return null;
    inflight = enqueue(text, true);
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([inflight, timeout]);
}

/** Render every scripted line in the background so live play never waits on the model. */
export function prewarmNarration(texts: string[]): void {
  if (!ENABLED) return;
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const missing = unique.filter((t) => !readClip(narrationKey(t)));
  if (!missing.length) {
    console.log(`Narration cache warm (${unique.length} lines)`);
    return;
  }
  console.log(`Narrating ${missing.length}/${unique.length} scripted lines in the background…`);
  for (const t of missing) void enqueue(t, false);
}

export function narrationStatus() {
  return { enabled: ENABLED, engine: engineState, voice: VOICE, queued: queue.length, format: EXT };
}
