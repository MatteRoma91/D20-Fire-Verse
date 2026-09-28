/** Synced dice tray — animates to server-authoritative faces. */

export type DiceRollView = {
  id: string;
  roller: string;
  notation: string;
  values: number[];
  sides?: number[];
  modifier?: number;
  total: number;
  purpose?: string;
  label?: string;
  isCrit?: boolean;
  isFumble?: boolean;
};

let lastId = "";
let playing = false;
const queue: DiceRollView[] = [];

type DiceCue = (roll: DiceRollView) => void;
let cue: DiceCue | null = null;

export function onDiceCue(fn: DiceCue) {
  cue = fn;
}

export function enqueueDice(roll: DiceRollView | DiceRollView[] | null | undefined) {
  if (!roll) return;
  const list = Array.isArray(roll) ? roll : [roll];
  for (const r of list) {
    if (!r?.id || r.id === lastId) continue;
    if (queue.some((q) => q.id === r.id)) continue;
    queue.push(r);
  }
  void pump();
}

async function pump() {
  if (playing) return;
  const next = queue.shift();
  if (!next) return;
  playing = true;
  lastId = next.id;
  await showRoll(next);
  playing = false;
  void pump();
}

function ensureHost(): HTMLElement {
  let el = document.getElementById("diceTray");
  if (!el) {
    el = document.createElement("div");
    el.id = "diceTray";
    el.className = "dice-tray";
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function showRoll(roll: DiceRollView): Promise<void> {
  return new Promise((resolve) => {
    const host = ensureHost();
    host.hidden = false;
    cue?.(roll);
    const sides = roll.sides?.length
      ? roll.sides
      : roll.values.map(() => 20);
    const diceHtml = roll.values
      .map((v, i) => {
        const s = sides[i] ?? 20;
        return `<div class="die die-d${s > 20 ? 20 : s}" data-final="${v}" data-sides="${s}">
          <span class="die-face">?</span>
          <span class="die-tag">d${s}</span>
        </div>`;
      })
      .join("");
    const mod =
      roll.modifier && roll.modifier !== 0
        ? `<span class="die-mod">${roll.modifier >= 0 ? "+" : ""}${roll.modifier}</span>`
        : "";
    host.innerHTML = `
      <div class="dice-card ${roll.isCrit ? "crit" : ""} ${roll.isFumble ? "fumble" : ""}">
        <p class="dice-label">${roll.label || roll.purpose || "Roll"} · ${roll.roller}</p>
        <p class="dice-notation">${roll.notation}</p>
        <div class="dice-row">${diceHtml}${mod}</div>
        <p class="dice-total">= <strong>—</strong></p>
      </div>
    `;
    const faces = [...host.querySelectorAll(".die-face")] as HTMLElement[];
    const totalEl = host.querySelector(".dice-total strong") as HTMLElement;
    let frame = 0;
    const max = 22;
    const iv = window.setInterval(() => {
      frame += 1;
      faces.forEach((f, i) => {
        const s = sides[i] ?? 20;
        f.textContent = String(1 + Math.floor(Math.random() * s));
      });
      if (frame >= max) {
        window.clearInterval(iv);
        faces.forEach((f, i) => {
          f.textContent = String(roll.values[i]);
          f.parentElement?.classList.add("settled");
        });
        totalEl.textContent = String(roll.total);
        window.setTimeout(() => {
          host.hidden = true;
          host.innerHTML = "";
          resolve();
        }, 1100);
      }
    }, 45);
  });
}
