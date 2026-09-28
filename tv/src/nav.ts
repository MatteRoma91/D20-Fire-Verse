/**
 * Remote-first navigation: the D-pad moves focus to the nearest control in that
 * direction, OK presses it, Back steps out. Focus survives re-renders because every
 * control is remembered by a stable key and found again after the DOM is rebuilt.
 */

import { sfx } from "./sfx";

export type RemoteKey = "up" | "down" | "left" | "right" | "ok" | "back" | "menu" | "play" | "rew" | "ff";

const KEYMAP: Record<string, RemoteKey> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "ok",
  " ": "ok",
  Escape: "back",
  Backspace: "back",
  GoBack: "back",
  BrowserBack: "back",
  ContextMenu: "menu",
  Menu: "menu",
  MediaPlayPause: "play",
  MediaPlay: "play",
  MediaPause: "play",
  MediaRewind: "rew",
  MediaTrackPrevious: "rew",
  MediaFastForward: "ff",
  MediaTrackNext: "ff",
};

/** Fire TV WebViews report some remote buttons only by keyCode. */
const KEYCODES: Record<number, RemoteKey> = {
  4: "back",
  82: "menu",
  85: "play",
  179: "play",
  227: "rew",
  228: "ff",
  89: "rew",
  90: "ff",
};

export function remoteKey(e: KeyboardEvent): RemoteKey | null {
  return KEYMAP[e.key] ?? KEYCODES[e.keyCode] ?? null;
}

export const FOCUSABLE =
  'button:not([disabled]):not([hidden]), summary, [data-nav]:not([aria-disabled="true"]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

function visible(el: HTMLElement): boolean {
  if (el.closest("[hidden], [inert]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
}

let scopeProvider: () => HTMLElement = () => document.body;

/** The container the D-pad is allowed to roam in (the open overlay, else the active page). */
export function setScopeProvider(fn: () => HTMLElement) {
  scopeProvider = fn;
}

export function focusables(root: HTMLElement = scopeProvider()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

type Dir = "up" | "down" | "left" | "right";

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Nearest control in a direction: aligned candidates first, then the shortest weighted distance. */
export function nearestInDirection(from: HTMLElement, dir: Dir, pool: HTMLElement[]): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ac = center(a);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of pool) {
    if (el === from || from.contains(el)) continue;
    const b = el.getBoundingClientRect();
    const bc = center(b);
    let primary: number;
    let overlap: number;
    let secondary: number;
    switch (dir) {
      case "up":
        primary = a.top - b.bottom;
        if (bc.y >= ac.y - 1) continue;
        overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        secondary = Math.abs(bc.x - ac.x);
        break;
      case "down":
        primary = b.top - a.bottom;
        if (bc.y <= ac.y + 1) continue;
        overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        secondary = Math.abs(bc.x - ac.x);
        break;
      case "left":
        primary = a.left - b.right;
        if (bc.x >= ac.x - 1) continue;
        overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        secondary = Math.abs(bc.y - ac.y);
        break;
      case "right":
        primary = b.left - a.right;
        if (bc.x <= ac.x + 1) continue;
        overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        secondary = Math.abs(bc.y - ac.y);
        break;
    }
    const gap = Math.max(0, primary);
    const score = gap + secondary * (overlap > 0 ? 0.25 : 2.2) + (overlap > 0 ? 0 : 600);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** A key that finds "the same control" again after innerHTML rebuilt it. */
export function focusKey(el: Element | null): string | null {
  if (!el || el === document.body) return null;
  const h = el as HTMLElement;
  if (h.dataset.navKey) return `k:${h.dataset.navKey}`;
  if (h.id) return `#${h.id}`;
  const data = Object.entries(h.dataset)
    .filter(([k]) => k !== "nav" && k !== "focused")
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  if (data) return `d:${h.tagName}:${data}`;
  const text = (h.textContent ?? "").trim().slice(0, 40);
  return text ? `t:${h.tagName}:${text}` : null;
}

function findByKey(key: string, root: HTMLElement): HTMLElement | null {
  const pool = focusables(root);
  return pool.find((el) => focusKey(el) === key) ?? null;
}

let remembered: string | null = null;
let rememberedRect: DOMRect | null = null;

document.addEventListener("focusin", (e) => {
  const el = e.target as HTMLElement;
  if (el === document.body) return;
  remembered = focusKey(el);
  rememberedRect = el.getBoundingClientRect();
  if (el.scrollIntoView && !el.dataset.noScroll) el.scrollIntoView({ block: "nearest", inline: "nearest" });
});

function focusEl(el: HTMLElement | null, sound = false) {
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  if (sound) sfx("uiMove");
  return true;
}

/** After a re-render: put focus back on the same control, else the closest one to where it was. */
export function restoreFocus(preferred?: string | null) {
  const root = scopeProvider();
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && root.contains(active) && visible(active)) return;
  const key = preferred ?? remembered;
  const again = key ? findByKey(key, root) : null;
  if (again) {
    focusEl(again);
    return;
  }
  const pool = focusables(root);
  if (!pool.length) return;
  const initial = root.querySelector<HTMLElement>("[data-autofocus]");
  if (initial && visible(initial) && pool.includes(initial)) {
    focusEl(initial);
    return;
  }
  if (rememberedRect) {
    const rc = center(rememberedRect);
    let best = pool[0]!;
    let bestD = Infinity;
    for (const el of pool) {
      const c = center(el.getBoundingClientRect());
      const d = Math.hypot(c.x - rc.x, c.y - rc.y);
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    }
    focusEl(best);
    return;
  }
  focusEl(pool[0]!);
}

/** Move focus one step. Returns false at an edge, so a caller can hand focus elsewhere. */
export function moveFocus(dir: Dir): boolean {
  const root = scopeProvider();
  const pool = focusables(root);
  if (!pool.length) return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || !root.contains(active)) {
    restoreFocus();
    return true;
  }
  const next = nearestInDirection(active, dir, pool);
  if (!next) return false;
  return focusEl(next, true);
}

let restoreQueued = false;
const observer = new MutationObserver(() => {
  if (restoreQueued) return;
  restoreQueued = true;
  requestAnimationFrame(() => {
    restoreQueued = false;
    restoreFocus();
  });
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });

/** An element that wants the arrow keys for itself (the combat grid, a text field's caret). */
export function ownsArrows(el: Element | null, key: RemoteKey): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  if (h.dataset.arrows === "all") return true;
  if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "search")) {
    return key === "left" || key === "right";
  }
  return false;
}
