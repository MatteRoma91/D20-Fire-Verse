/**
 * The narrator and the cast: neural TTS (Kokoro-82M, Apache-2.0) rendered on the table server,
 * one voice per speaker with its own pitch and space, cached on disk by text hash and served
 * as AAC with sentence timings (and who says them) for subtitles.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { scriptLines } from "@d20-fireverse/protocol";
import { DATA_DIR } from "./paths.js";

export type NarrationCue = { text: string; start: number; end: number; speaker?: string };
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
/** fp32 is clean; the quantized q8 build bursts into loud high-frequency glitches mid-sentence. */
const DTYPE = (process.env.NARRATOR_DTYPE || "fp32") as "fp32" | "fp16" | "q8" | "q4" | "q4f16";
const ENABLED = process.env.NARRATION !== "off";
const SAMPLE_RATE = 24000;
const SENTENCE_GAP = 0.32;
const PARAGRAPH_GAP = 0.62;
const LEAD_IN = 0.12;
const DIR = path.join(DATA_DIR, "narration");
const FFMPEG = hasFfmpeg();
const EXT = FFMPEG ? "m4a" : "wav";

/** Rooms a voice can be placed in. Each is an ffmpeg filter chain at the model's sample rate. */
export type VoiceFx = "echo" | "cavern" | "hiss" | "growl";

export type SpeakerVoice = { voice: string; speed: number; pitch?: number; fx?: VoiceFx };

const FX_CHAINS: Record<VoiceFx, string> = {
  echo: "aecho=0.8:0.72:70|190:0.32|0.18,acompressor=threshold=0.1:ratio=4:attack=3:release=80:makeup=2,alimiter=limit=0.6:attack=2:release=40:level=disabled",
  cavern: "highpass=f=110,aecho=0.8:0.85:110|260|470:0.42|0.3|0.2,acompressor=threshold=0.2:ratio=3:attack=4:release=90:makeup=1.4",
  hiss: "chorus=0.6:0.9:32|47:0.45|0.35:0.3|0.45:1.8|1.1,aecho=0.8:0.6:40:0.28,highshelf=f=5000:g=3",
  growl: "lowpass=f=3600,asoftclip=type=tanh:param=1.6,chorus=0.7:0.9:20:0.5:0.6:0.8,aecho=0.8:0.5:28:0.3",
};
const SPEAKER_GAP = 0.42;
const FX_TAIL = 0.6;
const SPEECH_RMS = 0.16;

let cast: Record<string, SpeakerVoice> = {};

/** The campaign's cast. Lines by unknown speakers fall back to the narrator. */
export function configureVoices(next: Record<string, SpeakerVoice> | undefined): void {
  cast = {};
  for (const [id, v] of Object.entries(next ?? {})) {
    if (!v?.voice) continue;
    cast[id] = {
      voice: v.voice,
      speed: clamp(Number(v.speed) || 1, 0.5, 2),
      pitch: clamp(Number(v.pitch) || 1, 0.6, 1.6),
      fx: v.fx && v.fx in FX_CHAINS ? v.fx : undefined,
    };
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function voiceOf(speaker: string | null): SpeakerVoice {
  return (speaker && cast[speaker]) || { voice: VOICE, speed: SPEED };
}

function voiceSignature(v: SpeakerVoice) {
  return [v.voice, v.speed, v.pitch ?? 1, v.fx ? FX_CHAINS[v.fx] : ""];
}

type ScriptPiece = { speaker: string | null; text: string };

/** Who says what, in the words the voices will actually say. */
function script(text: string): ScriptPiece[] {
  return scriptLines(text)
    .map((l) => ({ speaker: l.speaker && cast[l.speaker] ? l.speaker : null, text: speakable(l.text) }))
    .filter((l) => l.text);
}

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
  const pieces = script(text);
  const material = pieces.every((p) => !p.speaker)
    ? `${DTYPE}|${VOICE}|${SPEED}|${pieces.map((p) => p.text).join("\n")}`
    : JSON.stringify([DTYPE, VOICE, SPEED, pieces.map((p) => [p.speaker && voiceSignature(voiceOf(p.speaker)), p.text])]);
  return createHash("sha1").update(material).digest("hex").slice(0, 20);
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

/** Model output is nominally within ±1; fold any stray overshoot back softly instead of clipping it. */
function limit(samples: Float32Array): Float32Array {
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!;
    if (!Number.isFinite(v)) samples[i] = 0;
    else if (v > 0.95 || v < -0.95) samples[i] = Math.sign(v) * (0.95 + 0.05 * Math.tanh((Math.abs(v) - 0.95) / 0.05));
  }
  return samples;
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
        const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: "cpu" });
        engineState = "ready";
        console.log(`Narrator ready (${VOICE}, ${DTYPE}, ${Object.keys(cast).length} cast voices) in ${Date.now() - t0} ms`);
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

/** Pitch and room for one speaker, through ffmpeg. Timing is preserved; the tail may ring on. */
function applyVoiceFx(samples: Float32Array, v: SpeakerVoice): Promise<Float32Array> {
  const filters: string[] = [];
  const pitch = v.pitch ?? 1;
  if (Math.abs(pitch - 1) > 0.005) {
    filters.push(`asetrate=${Math.round(SAMPLE_RATE * pitch)}`, `aresample=${SAMPLE_RATE}`, `atempo=${(1 / pitch).toFixed(4)}`);
  }
  if (v.fx) filters.push(FX_CHAINS[v.fx]);
  if (!FFMPEG || !filters.length) return Promise.resolve(samples);
  const padded = new Float32Array(samples.length + Math.floor(FX_TAIL * SAMPLE_RATE));
  padded.set(samples);
  return new Promise((resolve) => {
    const fmt = ["-f", "f32le", "-ar", String(SAMPLE_RATE), "-ac", "1"];
    const proc = spawn("ffmpeg", ["-loglevel", "error", ...fmt, "-i", "pipe:0", "-af", filters.join(","), ...fmt, "pipe:1"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let err = "";
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d) => (err += String(d)));
    proc.on("error", () => resolve(samples));
    proc.on("close", (code) => {
      const buf = Buffer.concat(out);
      if (code !== 0 || buf.length < 4) {
        console.warn(`Voice effect failed (${v.voice}): ${err.trim() || `ffmpeg ${code}`}`);
        return resolve(samples);
      }
      const pcm = new Float32Array(buf.length >> 2);
      for (let i = 0; i < pcm.length; i += 1) pcm[i] = buf.readFloatLE(i * 4);
      resolve(trimTail(pcm, samples.length));
    });
    proc.stdin.on("error", () => undefined);
    proc.stdin.end(Buffer.from(padded.buffer, padded.byteOffset, padded.byteLength));
  });
}

/** Drop trailing silence but never cut into the voiced part. */
function trimTail(samples: Float32Array, keepAtLeast: number): Float32Array {
  let end = samples.length - 1;
  while (end > keepAtLeast && Math.abs(samples[end]) < 0.003) end -= 1;
  return samples.subarray(0, Math.min(samples.length, end + Math.floor(SAMPLE_RATE * 0.05)));
}

/** Every speaker lands at the same speech loudness, whatever their voice and room did to it. */
function normalize(samples: Float32Array): void {
  let peak = 0;
  let energy = 0;
  let voiced = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i]!);
    peak = Math.max(peak, a);
    if (a > 0.01) {
      energy += a * a;
      voiced += 1;
    }
  }
  if (!peak || !voiced) return;
  const gain = Math.min(SPEECH_RMS / Math.sqrt(energy / voiced), 0.95 / peak, 4);
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
}

function concat(chunks: Float32Array[]): Float32Array {
  const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    pcm.set(c, offset);
    offset += c.length;
  }
  return pcm;
}

async function render(key: string, text: string): Promise<NarrationClip | null> {
  const tts = await loadEngine();
  if (!tts) return null;
  const pieces = script(text);
  const chunks: Float32Array[] = [new Float32Array(Math.floor(LEAD_IN * SAMPLE_RATE))];
  const cues: NarrationCue[] = [];
  let cursor = LEAD_IN;
  const voices = new Set<string>();
  for (let n = 0; n < pieces.length; n += 1) {
    const piece = pieces[n]!;
    const v = voiceOf(piece.speaker);
    voices.add(v.voice);
    const paragraphs = piece.text
      .split(/\n\s*\n|\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const parts: Float32Array[] = [];
    const local: NarrationCue[] = [];
    let at = 0;
    for (let p = 0; p < paragraphs.length; p += 1) {
      const sentences = splitSentences(paragraphs[p]!);
      for (let s = 0; s < sentences.length; s += 1) {
        const sentence = sentences[s]!;
        if (!/[a-z0-9]/i.test(sentence)) continue;
        const out = await tts.generate(sentence, { voice: v.voice, speed: v.speed });
        const voiced = trimSilence(limit(Float32Array.from(out.audio)));
        const len = voiced.length / SAMPLE_RATE;
        local.push({ text: sentence, start: at, end: at + len, ...(piece.speaker ? { speaker: piece.speaker } : {}) });
        parts.push(voiced);
        at += len;
        const lastOfPiece = p === paragraphs.length - 1 && s === sentences.length - 1;
        if (!lastOfPiece) {
          const gap = s === sentences.length - 1 ? PARAGRAPH_GAP : SENTENCE_GAP;
          parts.push(new Float32Array(Math.floor(gap * SAMPLE_RATE)));
          at += gap;
        }
      }
    }
    if (!local.length) continue;
    const voicedPiece = await applyVoiceFx(concat(parts), v);
    normalize(voicedPiece);
    for (const c of local) cues.push({ ...c, start: round(cursor + c.start), end: round(cursor + c.end) });
    chunks.push(voicedPiece);
    cursor += voicedPiece.length / SAMPLE_RATE;
    const next = pieces[n + 1];
    const gap = !next ? 0.35 : next.speaker !== piece.speaker ? SPEAKER_GAP : PARAGRAPH_GAP;
    chunks.push(new Float32Array(Math.floor(gap * SAMPLE_RATE)));
    cursor += gap;
  }
  if (!cues.length) return null;
  const pcm = concat(chunks);

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
    voice: [...voices].join("+"),
    duration: round(pcm.length / SAMPLE_RATE),
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
  return {
    enabled: ENABLED,
    engine: engineState,
    voice: VOICE,
    cast: Object.fromEntries(Object.entries(cast).map(([id, v]) => [id, v.voice])),
    voiceFx: FFMPEG,
    queued: queue.length,
    format: EXT,
  };
}
