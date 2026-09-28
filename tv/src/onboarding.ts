/** The first minute at the table: a phone QR, a picture of the remote, and a coach for the first fight. */

import qrcode from "qrcode-generator";

export function qrSvg(text: string, cell = 5): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

let tableInfo: Promise<{ companionUrl: string; hosts: string[] } | null> | null = null;

export function companionBase(): Promise<string> {
  if (!tableInfo) {
    tableInfo = fetch("/api/table-info")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return tableInfo.then((info) => info?.companionUrl ?? `${location.protocol}//${location.hostname}:4319/companion/`);
}

export async function companionUrl(roomCode?: string, seat?: string): Promise<string> {
  const base = await companionBase();
  const u = new URL(base);
  if (roomCode) u.searchParams.set("room", roomCode);
  if (seat) u.searchParams.set("seat", seat);
  return u.toString();
}

export const REMOTE_LEGEND = `
  <div class="remote-legend">
    <div class="rl-item"><span class="rl-key dpad" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span><strong>D-pad</strong> move · aim</span></div>
    <div class="rl-item"><span class="rl-key ok" aria-hidden="true">OK</span><span><strong>Select</strong> choose · strike</span></div>
    <div class="rl-item"><span class="rl-key" aria-hidden="true">↩</span><span><strong>Back</strong> cancel · step out</span></div>
    <div class="rl-item"><span class="rl-key" aria-hidden="true">☰</span><span><strong>Menu</strong> settings</span></div>
    <div class="rl-item"><span class="rl-key" aria-hidden="true">⏯</span><span><strong>Play</strong> hear again · end turn</span></div>
    <div class="rl-item"><span class="rl-key" aria-hidden="true">⏪⏩</span><span><strong>Rewind / Forward</strong> sheet tabs</span></div>
  </div>`;

const COACH_KEY = "fireverse.coach.v1";
export type CoachStep = "move" | "strike" | "end" | "enemy";

const COPY: Record<CoachStep, { title: string; body: string }> = {
  move: {
    title: "Your turn",
    body: "Gold cells are where you can walk. The cursor starts on the nearest foe: press <kbd>OK</kbd> to close in, or steer with the <kbd>D-pad</kbd>.",
  },
  strike: {
    title: "A foe in reach",
    body: "The red crosshair means you can hit it. <kbd>OK</kbd> strikes with your ★ attack. Other moves wait below the board — press <kbd>▼</kbd>.",
  },
  end: {
    title: "Spent",
    body: "Action used. Press <kbd>⏯</kbd> or choose <strong>End turn</strong> and watch the dice answer back.",
  },
  enemy: {
    title: "Their move",
    body: "Foes act on their own. Every roll is shown against your armor — the table never hides a die.",
  },
};

function seen(): Set<CoachStep> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COACH_KEY) ?? "[]") as CoachStep[]);
  } catch {
    return new Set();
  }
}

let shown = seen();
let tipTimer = 0;

export function resetCoach() {
  shown = new Set();
  try {
    localStorage.removeItem(COACH_KEY);
  } catch {
    /* ignore */
  }
}

/** Show a coaching card once per step, ever. */
export function coach(step: CoachStep) {
  if (shown.has(step)) return;
  shown.add(step);
  try {
    localStorage.setItem(COACH_KEY, JSON.stringify([...shown]));
  } catch {
    /* ignore */
  }
  let el = document.getElementById("coachTip");
  if (!el) {
    el = document.createElement("aside");
    el.id = "coachTip";
    el.className = "coach-tip";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  const copy = COPY[step];
  el.innerHTML = `<p class="coach-kicker">First fight</p><h4>${copy.title}</h4><p>${copy.body}</p>`;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => el!.classList.remove("show"), 9000);
}

export function hideCoach() {
  document.getElementById("coachTip")?.classList.remove("show");
}
