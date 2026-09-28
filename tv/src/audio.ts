/** Room tone and stingers. No external audio files — the bed is synthesized. */

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

type Bed = {
  stop: () => void;
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bedGain: GainNode | null = null;
let bed: Bed | null = null;
let current: RoomScene | null = null;
let pending: RoomScene = "tavern";
let armed = false;

function context(): AudioContext {
  if (!ctx || !master || !bedGain) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    bedGain = ctx.createGain();
    bedGain.gain.value = 0;
    bedGain.connect(master);
  }
  return ctx;
}

function bedSpec(scene: RoomScene): {
  lows: [number, number];
  lfo: number;
  gain: number;
} {
  switch (scene) {
    case "tavern":
      return { lows: [110, 164.8], lfo: 0.12, gain: 0.045 };
    case "explore":
      return { lows: [82.4, 123.5], lfo: 0.08, gain: 0.04 };
    case "combat":
      return { lows: [55, 82.4], lfo: 2.1, gain: 0.05 };
    case "boss":
      return { lows: [49, 73.4], lfo: 1.35, gain: 0.055 };
    case "victory":
      return { lows: [196, 246.9], lfo: 0.18, gain: 0.04 };
    default: {
      const exhaustive: never = scene;
      throw new Error(exhaustive);
    }
  }
}

function startBed(scene: RoomScene) {
  const c = context();
  if (!bedGain) return;
  bed?.stop();
  const spec = bedSpec(scene);
  const oscs: OscillatorNode[] = [];
  for (const hz of spec.lows) {
    const osc = c.createOscillator();
    osc.type = scene === "victory" ? "sine" : "triangle";
    osc.frequency.value = hz;
    const g = c.createGain();
    g.gain.value = scene === "boss" && hz === spec.lows[1] ? 0.35 : 0.55;
    osc.connect(g);
    g.connect(bedGain);
    osc.start();
    oscs.push(osc);
  }
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = spec.lfo;
  lfoGain.gain.value = scene === "combat" || scene === "boss" ? 0.02 : 0.008;
  lfo.connect(lfoGain);
  lfoGain.connect(bedGain.gain);
  lfo.start();
  bedGain.gain.cancelScheduledValues(c.currentTime);
  bedGain.gain.linearRampToValueAtTime(spec.gain, c.currentTime + 0.6);
  bed = {
    stop: () => {
      const t = c.currentTime;
      for (const osc of oscs) {
        try {
          osc.stop(t + 0.05);
        } catch {
          /* already stopped */
        }
      }
      try {
        lfo.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
    },
  };
  current = scene;
}

export function unlockAudio() {
  armed = true;
  const c = context();
  if (c.state === "suspended") void c.resume();
  if (current !== pending) startBed(pending);
}

export function setScene(raw: string | undefined, fallback: RoomScene = "explore") {
  pending = normalizeScene(raw, fallback);
  if (!armed) return;
  if (current === pending) return;
  startBed(pending);
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
  setScene,
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
