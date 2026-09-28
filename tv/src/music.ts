/** Scene score: seven looping cues rendered by tools/music/compose.py, crossfaded on the table's AudioContext. */

import { onSettings, settings } from "./settings";

export const MUSIC_TRACKS = [
  "title",
  "tavern",
  "descent",
  "tension",
  "combat",
  "boss",
  "victory",
] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number];

export type MusicState = {
  track: MusicTrack;
  title: string;
  enabled: boolean;
  playing: boolean;
};

export function trackTitle(track: MusicTrack): string {
  switch (track) {
    case "title":
      return "A Very Potent Brew";
    case "tavern":
      return "Jig at the Wizard's Tower";
    case "descent":
      return "What Lies Beneath";
    case "tension":
      return "Noise from the Deep";
    case "combat":
      return "Steel in the Cellar";
    case "boss":
      return "The Infernal Weaver";
    case "victory":
      return "Three Seals, One Toast";
    default: {
      const exhaustive: never = track;
      throw new Error(exhaustive);
    }
  }
}

function resumes(track: MusicTrack): boolean {
  switch (track) {
    case "title":
    case "tavern":
    case "descent":
    case "tension":
      return true;
    case "combat":
    case "boss":
    case "victory":
      return false;
    default: {
      const exhaustive: never = track;
      throw new Error(exhaustive);
    }
  }
}

function fadeInto(track: MusicTrack): number {
  switch (track) {
    case "combat":
    case "boss":
      return 0.9;
    case "tension":
      return 1.6;
    case "title":
    case "tavern":
    case "descent":
    case "victory":
      return 2.6;
    default: {
      const exhaustive: never = track;
      throw new Error(exhaustive);
    }
  }
}

const DUCK = 0.4;
const DECODED_LIMIT = 3;
const STORAGE_KEY = "fireverse.music";

type Voice = {
  track: MusicTrack;
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
  offset: number;
  duration: number;
};

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let wanted: MusicTrack = "title";
let voice: Voice | null = null;
let ducked = false;
let enabled = readEnabled();
const encoded = new Map<MusicTrack, Promise<ArrayBuffer | null>>();
const decoded = new Map<MusicTrack, AudioBuffer>();
const positions = new Map<MusicTrack, number>();
const listeners = new Set<(state: MusicState) => void>();
const format = pickFormat();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function pickFormat(): "ogg" | "m4a" {
  const probe = document.createElement("audio");
  return probe.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "m4a";
}

function snapshot(): MusicState {
  return {
    track: wanted,
    title: trackTitle(wanted),
    enabled,
    playing: !!voice && voice.track === wanted,
  };
}

function emit() {
  const state = snapshot();
  for (const fn of listeners) fn(state);
}

function fetchEncoded(track: MusicTrack): Promise<ArrayBuffer | null> {
  const cached = encoded.get(track);
  if (cached) return cached;
  const request = fetch(`/audio/music/${track}.${format}`)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null)
    .then((bytes) => {
      if (!bytes) encoded.delete(track);
      return bytes;
    });
  encoded.set(track, request);
  return request;
}

async function bufferFor(track: MusicTrack): Promise<AudioBuffer | null> {
  const hit = decoded.get(track);
  if (hit) {
    decoded.delete(track);
    decoded.set(track, hit);
    return hit;
  }
  const bytes = await fetchEncoded(track);
  if (!bytes || !ctx) return null;
  try {
    // decodeAudioData detaches its input; keep the compressed copy for later re-decodes.
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    decoded.set(track, buffer);
    for (const key of decoded.keys()) {
      if (decoded.size <= DECODED_LIMIT) break;
      if (key !== track && key !== voice?.track) decoded.delete(key);
    }
    return buffer;
  } catch {
    return null;
  }
}

function busLevel(): number {
  if (!enabled) return 0;
  const volume = settings().music;
  return ducked ? volume * DUCK : volume;
}

function rampBus(seconds: number) {
  if (!ctx || !bus) return;
  const now = ctx.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(bus.gain.value, now);
  bus.gain.linearRampToValueAtTime(busLevel(), now + seconds);
}

function release(old: Voice, fade: number) {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (resumes(old.track)) {
    positions.set(old.track, (old.offset + now - old.startedAt) % old.duration);
  }
  old.gain.gain.cancelScheduledValues(now);
  old.gain.gain.setValueAtTime(old.gain.gain.value, now);
  old.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
  old.source.onended = () => old.gain.disconnect();
  old.source.stop(now + fade + 0.05);
}

async function apply() {
  const target = wanted;
  if (!ctx || !bus || voice?.track === target) return;
  const buffer = await bufferFor(target);
  if (!buffer || !ctx || !bus || target !== wanted || voice?.track === target) return;

  const fade = voice ? fadeInto(target) : 1.2;
  const now = ctx.currentTime;
  const offset = resumes(target) ? (positions.get(target) ?? 0) % buffer.duration : 0;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(1, now + fade);
  gain.connect(bus);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  source.start(now, offset);

  if (voice) release(voice, fade);
  voice = { track: target, source, gain, startedAt: now, offset, duration: buffer.duration };
  emit();
}

async function prefetch() {
  const order = [wanted, ...MUSIC_TRACKS.filter((t) => t !== wanted)];
  for (const track of order) await fetchEncoded(track);
}

/** Wires the score into an unlocked AudioContext. Safe to call more than once. */
export function attachMusic(context: AudioContext, destination: AudioNode) {
  if (ctx) return;
  ctx = context;
  bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(destination);
  rampBus(0.6);
  onSettings(() => rampBus(0.25));
  void apply();
  void prefetch();
}

export function setMusic(track: MusicTrack) {
  if (wanted === track) return;
  wanted = track;
  emit();
  void apply();
}

export function duckMusic(on: boolean) {
  if (ducked === on) return;
  ducked = on;
  rampBus(on ? 0.25 : 1.4);
}

export function toggleMusic(): boolean {
  enabled = !enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* private mode: the choice lasts for this session */
  }
  rampBus(0.5);
  emit();
  return enabled;
}

export function onMusicChange(fn: (state: MusicState) => void): () => void {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}
