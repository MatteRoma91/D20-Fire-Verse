/** The table's one AudioContext: music, narrator and effects each on their own bus. */

import { attachMusic } from "./music";
import { onSettings, settings } from "./settings";

const SCENES = ["tavern", "explore", "combat", "boss", "victory"] as const;
export type RoomScene = (typeof SCENES)[number];

export function normalizeScene(raw: string | undefined, fallback: RoomScene): RoomScene {
  if (raw && (SCENES as readonly string[]).includes(raw)) return raw as RoomScene;
  return fallback;
}

export function sceneLabel(scene: RoomScene): string {
  switch (scene) {
    case "tavern":
      return "Tavern";
    case "explore":
      return "Descent";
    case "combat":
      return "Combat";
    case "boss":
      return "Boss";
    case "victory":
      return "Victory";
    default: {
      const exhaustive: never = scene;
      throw new Error(exhaustive);
    }
  }
}

type Buses = { ctx: AudioContext; master: GainNode; voice: GainNode; sfx: GainNode };

let buses: Buses | null = null;
let armed = false;
const armListeners = new Set<(b: Buses) => void>();

function create(): Buses {
  if (buses) return buses;
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  master.connect(limiter);
  limiter.connect(ctx.destination);
  const voice = ctx.createGain();
  const sfx = ctx.createGain();
  voice.connect(master);
  sfx.connect(master);
  buses = { ctx, master, voice, sfx };
  onSettings((s) => {
    const now = ctx.currentTime;
    voice.gain.setTargetAtTime(s.voice, now, 0.05);
    sfx.gain.setTargetAtTime(s.sfx, now, 0.05);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void ctx.suspend();
    else if (armed) void ctx.resume();
  });
  return buses;
}

/** Browsers only let sound start after a key press; every remote press calls this. */
export function unlockAudio() {
  const b = create();
  if (b.ctx.state === "suspended" && !document.hidden) void b.ctx.resume();
  if (armed) return;
  armed = true;
  attachMusic(b.ctx, b.master);
  for (const fn of armListeners) fn(b);
}

export function audioReady(): Buses | null {
  return armed ? buses : null;
}

export function onAudioArmed(fn: (b: Buses) => void) {
  if (armed && buses) fn(buses);
  else armListeners.add(fn);
}

export function audioFormat(): "ogg" | "m4a" {
  const probe = document.createElement("audio");
  return probe.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "m4a";
}

export function currentVoiceVolume(): number {
  return settings().voice;
}
