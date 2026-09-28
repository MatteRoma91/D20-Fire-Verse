/** Room scenes, the shared AudioContext and synthesized stingers. Music lives in music.ts. */

import { attachMusic } from "./music";

const SCENES = ["tavern", "explore", "combat", "boss", "victory"] as const;
export type RoomScene = (typeof SCENES)[number];

export function normalizeScene(
  raw: string | undefined,
  fallback: RoomScene,
): RoomScene {
  if (raw && (SCENES as readonly string[]).includes(raw)) {
    return raw as RoomScene;
  }
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

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let armed = false;

function context(): AudioContext {
  if (!ctx || !master) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend();
      else if (armed) void ctx.resume();
    });
  }
  return ctx;
}

export function unlockAudio() {
  const c = context();
  if (c.state === "suspended" && !document.hidden) void c.resume();
  if (armed || !master) return;
  armed = true;
  attachMusic(c, master);
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  slideTo?: number,
) {
  if (!armed || !master) return;
  const c = context();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, slideTo),
      c.currentTime + dur,
    );
  }
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  osc.connect(g);
  g.connect(master);
  osc.start();
  osc.stop(c.currentTime + dur + 0.02);
}

function noise(duration: number, freq: number, gain: number) {
  if (!armed || !master) return;
  const c = context();
  const frames = Math.max(1, Math.floor(c.sampleRate * duration));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 0.7;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start();
}

export const audio = {
  unlock: unlockAudio,
  confirm() {
    tone(520, 0.07, "sine", 0.04, 680);
  },
  dice() {
    noise(0.22, 1400, 0.07);
    tone(180, 0.12, "triangle", 0.03, 90);
  },
  hit() {
    noise(0.08, 240, 0.09);
    tone(160, 0.14, "triangle", 0.08, 48);
  },
  fanfare() {
    tone(523, 0.18, "sine", 0.06);
    tone(784, 0.28, "sine", 0.05);
  },
  fumble() {
    tone(196, 0.22, "sawtooth", 0.03, 70);
  },
  turn() {
    tone(392, 0.09, "sine", 0.05);
    window.setTimeout(() => tone(523, 0.12, "sine", 0.04), 90);
  },
};
