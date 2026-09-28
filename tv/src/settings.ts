/** Table preferences, remembered on this television. */

export type SubtitleSize = "small" | "medium" | "large";
export type MotionPref = "full" | "reduced";

export type Settings = {
  music: number;
  voice: number;
  sfx: number;
  narration: boolean;
  subtitles: boolean;
  subtitleSize: SubtitleSize;
  motion: MotionPref;
  highContrast: boolean;
};

const KEY = "fireverse.settings.v1";

const DEFAULTS: Settings = {
  music: 0.55,
  voice: 1,
  sfx: 0.8,
  narration: true,
  subtitles: true,
  subtitleSize: "medium",
  motion: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full",
  highContrast: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const legacyMusic = localStorage.getItem("fireverse.music") === "off" ? 0 : undefined;
    return { ...DEFAULTS, ...(legacyMusic === 0 ? { music: 0 } : {}), ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();
const listeners = new Set<(s: Settings) => void>();

function applyToDocument(s: Settings) {
  const root = document.documentElement;
  root.dataset.subs = s.subtitleSize;
  root.dataset.motion = s.motion;
  root.dataset.contrast = s.highContrast ? "high" : "normal";
}

applyToDocument(current);

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode: the choice lasts for this session */
  }
  applyToDocument(current);
  for (const fn of listeners) fn(current);
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

export function reducedMotion(): boolean {
  return current.motion === "reduced";
}
