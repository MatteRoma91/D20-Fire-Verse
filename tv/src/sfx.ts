/** Rendered sound effects (tools/sfx/render.py), with small pitch and level variation per play. */

import { audioFormat, audioReady, onAudioArmed } from "./audio";

const VARIANTS = {
  dice: ["dice_1", "dice_2", "dice_3", "dice_4"],
  diceSettle: ["dice_settle"],
  swing: ["swing_1", "swing_2"],
  sword: ["sword_1", "sword_2", "sword_3"],
  blunt: ["blunt_1", "blunt_2"],
  claw: ["claw_1", "claw_2"],
  miss: ["miss_1", "miss_2"],
  crit: ["crit"],
  fumble: ["fumble"],
  deathSmall: ["death_small"],
  deathBig: ["death_big"],
  heroDown: ["hero_down"],
  step: ["step_1", "step_2", "step_3", "step_4"],
  skitter: ["skitter_1", "skitter_2"],
  uiMove: ["ui_move"],
  uiConfirm: ["ui_confirm"],
  uiBack: ["ui_back"],
  uiError: ["ui_error"],
  turn: ["turn"],
  enemyTurn: ["enemy_turn"],
  victory: ["victory"],
  defeat: ["defeat"],
  heal: ["heal"],
  spell: ["spell"],
  missile: ["missile"],
  fire: ["fire"],
  bow: ["bow"],
  web: ["web"],
  chapter: ["chapter"],
  seal: ["seal"],
  puzzleStep: ["puzzle_step"],
  trap: ["trap"],
} as const;

export type Sfx = keyof typeof VARIANTS;

const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
const lastVariant = new Map<Sfx, number>();
const lastPlayed = new Map<Sfx, number>();
const format = audioFormat();

function load(name: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(name);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(name);
  if (pending) return pending;
  const b = audioReady();
  if (!b) return Promise.resolve(null);
  const p = fetch(`/audio/sfx/${name}.${format}`)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((bytes) => (bytes ? b.ctx.decodeAudioData(bytes) : null))
    .then((buf) => {
      if (buf) buffers.set(name, buf);
      loading.delete(name);
      return buf;
    })
    .catch(() => {
      loading.delete(name);
      return null;
    });
  loading.set(name, p);
  return p;
}

onAudioArmed(() => {
  const all = Object.values(VARIANTS).flat();
  void (async () => {
    for (const name of all) await load(name);
  })();
});

function pickVariant(kind: Sfx): string {
  const list = VARIANTS[kind];
  if (list.length === 1) return list[0]!;
  const prev = lastVariant.get(kind) ?? -1;
  let i = Math.floor(Math.random() * list.length);
  if (i === prev) i = (i + 1) % list.length;
  lastVariant.set(kind, i);
  return list[i]!;
}

export type PlayOpts = { gain?: number; rate?: number; pan?: number; delay?: number; jitter?: number };

/** Fire and forget. Rapid repeats of the same cue (cursor ticks) are rate-limited so they never pile up. */
export function sfx(kind: Sfx, opts: PlayOpts = {}): void {
  const b = audioReady();
  if (!b) return;
  const now = performance.now();
  const minGap = kind === "uiMove" ? 45 : kind === "step" || kind === "skitter" ? 70 : 0;
  if (minGap && now - (lastPlayed.get(kind) ?? 0) < minGap) return;
  lastPlayed.set(kind, now);
  const name = pickVariant(kind);
  void load(name).then((buf) => {
    if (!buf) return;
    const src = b.ctx.createBufferSource();
    src.buffer = buf;
    const jitter = opts.jitter ?? 0.04;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    const g = b.ctx.createGain();
    g.gain.value = (opts.gain ?? 1) * (1 + (Math.random() * 2 - 1) * 0.06);
    const panner = b.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
    src.connect(g).connect(panner).connect(b.sfx);
    src.start(b.ctx.currentTime + (opts.delay ?? 0));
  });
}

/** Stereo position of a board column, so a blow on the left of the table sounds on the left. */
export function panForColumn(x: number, width: number): number {
  if (width <= 1) return 0;
  return ((x / (width - 1)) * 2 - 1) * 0.6;
}
