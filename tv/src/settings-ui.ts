/** Settings, opened with Menu: every row is one D-pad stop, ◀ ▶ change its value. */

import { nativeApp } from "./native";
import { REMOTE_LEGEND, resetCoach } from "./onboarding";
import { settings, updateSettings, type Settings, type SubtitleSize } from "./settings";
import { sfx } from "./sfx";
import { replayNarration } from "./voice";

type Row =
  | { id: string; label: string; kind: "volume"; key: "music" | "voice" | "sfx" }
  | { id: string; label: string; kind: "toggle"; key: "narration" | "subtitles" | "highContrast"; on: string; off: string }
  | { id: string; label: string; kind: "choice"; key: "subtitleSize" | "motion"; options: Array<{ value: string; label: string }> };

const ROWS: Row[] = [
  { id: "music", label: "Music", kind: "volume", key: "music" },
  { id: "voice", label: "Narrator volume", kind: "volume", key: "voice" },
  { id: "sfx", label: "Effects", kind: "volume", key: "sfx" },
  { id: "narration", label: "Narrator voice", kind: "toggle", key: "narration", on: "Spoken", off: "Silent" },
  { id: "subtitles", label: "Subtitles", kind: "toggle", key: "subtitles", on: "On", off: "Off" },
  {
    id: "subtitleSize",
    label: "Subtitle size",
    kind: "choice",
    key: "subtitleSize",
    options: [
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ],
  },
  {
    id: "motion",
    label: "Motion",
    kind: "choice",
    key: "motion",
    options: [
      { value: "full", label: "Cinematic" },
      { value: "reduced", label: "Reduced" },
    ],
  },
  { id: "highContrast", label: "Board contrast", kind: "toggle", key: "highContrast", on: "High", off: "Standard" },
];

let overlay: HTMLElement | null = null;
let onCloseCb: (() => void) | null = null;
let opener: HTMLElement | null = null;

function valueLabel(row: Row, s: Settings): string {
  switch (row.kind) {
    case "volume": {
      const v = Math.round(s[row.key] * 10);
      return `<span class="vol" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? "on" : ""}"></i>`).join("")}</span><span class="vol-num">${v * 10}%</span>`;
    }
    case "toggle":
      return s[row.key] ? row.on : row.off;
    case "choice":
      return row.options.find((o) => o.value === s[row.key])?.label ?? "";
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

function change(row: Row, dir: -1 | 1) {
  const s = settings();
  switch (row.kind) {
    case "volume": {
      const next = Math.max(0, Math.min(1, Math.round((s[row.key] + dir * 0.1) * 10) / 10));
      updateSettings({ [row.key]: next } as Partial<Settings>);
      if (row.key === "sfx") sfx("uiConfirm");
      break;
    }
    case "toggle":
      updateSettings({ [row.key]: !s[row.key] } as Partial<Settings>);
      sfx("uiMove");
      break;
    case "choice": {
      const i = row.options.findIndex((o) => o.value === s[row.key]);
      const next = row.options[(i + dir + row.options.length) % row.options.length]!;
      updateSettings({ [row.key]: next.value as SubtitleSize } as Partial<Settings>);
      sfx("uiMove");
      break;
    }
    default: {
      const exhaustive: never = row;
      void exhaustive;
    }
  }
  paint();
}

function paint() {
  if (!overlay) return;
  const s = settings();
  for (const row of ROWS) {
    const el = overlay.querySelector<HTMLElement>(`[data-setting="${row.id}"] .setting-value`);
    if (el) el.innerHTML = valueLabel(row, s);
  }
}

export function settingsOpen(): HTMLElement | null {
  return overlay && !overlay.hidden ? overlay : null;
}

export function openSettings(onClose?: () => void) {
  onCloseCb = onClose ?? null;
  const active = document.activeElement;
  opener = active instanceof HTMLElement && active !== document.body && !overlay?.contains(active) ? active : null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "modal settings-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Settings");
    overlay.innerHTML = `
      <div class="modal-card">
        <p class="modal-kicker">Table settings</p>
        <h2>Sound, voice &amp; comfort</h2>
        <div class="settings-rows">
          ${ROWS.map(
            (r) => `<button type="button" class="setting-row" data-setting="${r.id}">
              <span class="setting-label">${r.label}</span>
              <span class="setting-control"><span class="chev" aria-hidden="true">◀</span><span class="setting-value"></span><span class="chev" aria-hidden="true">▶</span></span>
            </button>`,
          ).join("")}
        </div>
        <details class="settings-legend"><summary>Remote guide</summary>${REMOTE_LEGEND}</details>
        <div class="row modal-actions">
          <button type="button" class="ghost" id="setReplay">Hear the last line again</button>
          <button type="button" class="ghost" id="setCoach">Show first-fight tips again</button>
          ${nativeApp() ? `<button type="button" class="ghost" id="setTable">Change table server</button>` : ""}
          <button type="button" class="primary" id="setClose" data-autofocus>Back to the table</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll<HTMLElement>("[data-setting]").forEach((el) => {
      const row = ROWS.find((r) => r.id === el.dataset.setting)!;
      el.addEventListener("click", () => change(row, 1));
      el.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          change(row, e.key === "ArrowLeft" ? -1 : 1);
        }
      });
    });
    overlay.querySelector("#setClose")!.addEventListener("click", closeSettings);
    overlay.querySelector("#setReplay")!.addEventListener("click", () => {
      closeSettings();
      replayNarration();
    });
    overlay.querySelector("#setTable")?.addEventListener("click", () => {
      closeSettings();
      nativeApp()?.changeTable();
    });
    overlay.querySelector("#setCoach")!.addEventListener("click", () => {
      resetCoach();
      const b = overlay!.querySelector<HTMLElement>("#setCoach")!;
      b.textContent = "Tips will show in the next fight";
    });
  }
  paint();
  overlay.hidden = false;
  requestAnimationFrame(() => overlay?.querySelector<HTMLElement>(".setting-row")?.focus());
  sfx("uiConfirm");
}

export function closeSettings() {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  sfx("uiBack");
  if (opener?.isConnected && opener.offsetParent) opener.focus({ preventScroll: true });
  opener = null;
  onCloseCb?.();
}
