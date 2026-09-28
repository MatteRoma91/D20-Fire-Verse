/**
 * Puzzle boards played with a remote: symbols are big buttons, OK drops the focused
 * one into the next empty slot, Back lifts the last one out. The clues are on the
 * wall; the answer never is.
 */

import { sfx } from "./sfx";

export type PuzzleKind = "tiles" | "vessels" | "well_lock" | "vials" | "mixture";

type Option = { id: string; glyph: string; label: string };

type SequenceSpec = {
  kind: Exclude<PuzzleKind, "tiles">;
  slots: string[];
  options: Option[];
  allowRepeat: boolean;
  clue: string;
  submit: string;
};

const TILE_GRID: Array<{ elem: string; label: string }> = [
  { elem: "emerald", label: "Emerald" },
  { elem: "fire", label: "Fire red" },
  { elem: "slate", label: "Slate grey" },
  { elem: "violet", label: "Violet" },
  { elem: "sand", label: "Sand" },
  { elem: "indigo", label: "Indigo" },
  { elem: "air", label: "Sky" },
  { elem: "copper", label: "Copper" },
  { elem: "wine", label: "Wine" },
  { elem: "lime", label: "Lime" },
  { elem: "black", label: "Black" },
  { elem: "rose", label: "Rose" },
  { elem: "earth", label: "Earth" },
  { elem: "teal", label: "Teal" },
  { elem: "amber", label: "Amber" },
  { elem: "coral", label: "Coral" },
  { elem: "moss", label: "Moss" },
  { elem: "water", label: "Water" },
  { elem: "apricot", label: "Apricot" },
  { elem: "ivory", label: "Ivory" },
  { elem: "violet", label: "Violet" },
  { elem: "olive", label: "Olive" },
  { elem: "steel", label: "Steel" },
  { elem: "fire", label: "Fire red" },
  { elem: "silver", label: "Silver" },
];

const SPIRAL = `<svg class="glyph-svg" viewBox="6 5 14 14" aria-hidden="true"><path d="M12 12a1 1 0 0 1 2 0a2 2 0 0 1-4 0a3 3 0 0 1 6 0a4 4 0 0 1-8 0a5 5 0 0 1 10 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const SPECS: Record<SequenceSpec["kind"], SequenceSpec> = {
  vessels: {
    kind: "vessels",
    slots: ["1", "2", "3", "4"],
    options: [
      { id: "eye", glyph: "◉", label: "Eye" },
      { id: "x", glyph: "✕", label: "X" },
      { id: "wave", glyph: "≈", label: "Wave" },
      { id: "spiral", glyph: SPIRAL, label: "Spiral" },
    ],
    allowRepeat: false,
    clue: `<ul class="clue-list">
      <li>The <strong>X</strong> vessel is neither first nor last.</li>
      <li><strong>Spiral</strong> sits immediately after <strong>Wave</strong>.</li>
      <li><strong>Eye</strong> stands somewhere left of <strong>X</strong>.</li>
      <li>Position 1 is not <strong>Wave</strong>.</li>
    </ul>`,
    submit: "Activate the seal",
  },
  well_lock: {
    kind: "well_lock",
    slots: ["I", "II", "III", "IV"],
    options: [
      { id: "tooth", glyph: "△", label: "Tooth" },
      { id: "spark", glyph: "✦", label: "Spark" },
      { id: "moon", glyph: "○", label: "Moon" },
      { id: "wave", glyph: "☰", label: "Wave" },
      { id: "sun", glyph: "☀", label: "Sun" },
      { id: "skull", glyph: "☠", label: "Skull" },
      { id: "stone", glyph: "□", label: "Stone" },
    ],
    allowRepeat: false,
    clue: `<blockquote class="poem">
      <span>First, what bites the rope;</span>
      <span>then the star that fell;</span>
      <span>then the eye of the night sky;</span>
      <span>last, what has no shape and yet flows.</span>
    </blockquote>`,
    submit: "Unlock the pulley",
  },
  vials: {
    kind: "vials",
    slots: ["α", "β", "γ", "δ"],
    options: [
      { id: "heal", glyph: "✚", label: "Healing" },
      { id: "invis", glyph: "◌", label: "Invisibility" },
      { id: "vit", glyph: "♥", label: "Vitality" },
      { id: "poison", glyph: "☠", label: "Poison" },
    ],
    allowRepeat: true,
    clue: `<ul class="clue-list">
      <li>Two <strong>Healing</strong> vials, never side by side.</li>
      <li><strong>Invisibility</strong> stands immediately left of <strong>Vitality</strong>.</li>
      <li>α is not <strong>Vitality</strong>; δ is not <strong>Invisibility</strong>.</li>
    </ul>`,
    submit: "Lock the vials",
  },
  mixture: {
    kind: "mixture",
    slots: ["I", "II", "III"],
    options: [
      { id: "moon_dust", glyph: "☾", label: "Powder of the pale sky-disk" },
      { id: "black_salt", glyph: "◆", label: "Black crystal against spirits" },
      { id: "stone_oil", glyph: "◍", label: "Grease of the deep rock" },
      { id: "hop_ash", glyph: "✿", label: "Ash of bitter flowers" },
      { id: "quicklime", glyph: "✧", label: "White fire-dust" },
      { id: "mercury", glyph: "☿", label: "Living silver" },
    ],
    allowRepeat: false,
    clue: `<p class="hint-box">Three basins, three gestures: darken the sky, draw a border against spirits, anoint the slabs.</p>`,
    submit: "Pour the mixture",
  },
};

export function puzzleKindForNode(nodeId: string): PuzzleKind | null {
  switch (nodeId) {
    case "corridor_tiles":
      return "tiles";
    case "cellar_vessels":
      return "vessels";
    case "well_lock":
      return "well_lock";
    case "store_vials":
      return "vials";
    case "store_mixture":
      return "mixture";
    default:
      return null;
  }
}

type Progress = { picked: string[]; need: number; fails: number; feedback?: string } | null | undefined;

const drafts = new Map<string, { picks: string[]; fails: number }>();

function draftFor(nodeId: string, fails: number) {
  let d = drafts.get(nodeId);
  if (!d || d.fails !== fails) {
    d = { picks: [], fails };
    drafts.set(nodeId, d);
  }
  return d;
}

function faults(p: Progress, max = 2) {
  const n = p?.fails ?? 0;
  return `<span class="faults" aria-label="${n} of ${max} faults">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
}

function feedback(p: Progress) {
  const text = p?.feedback ?? "";
  if (!text) return `<p class="puzzle-feedback" aria-live="polite"></p>`;
  const bad = /wrong|grinds|bite/i.test(text);
  return `<p class="puzzle-feedback ${bad ? "bad" : "good"}" aria-live="polite">${text}</p>`;
}

export function renderInteractivePuzzle(
  host: HTMLElement,
  opts: {
    nodeId: string;
    progress: Progress;
    onChoose: (choiceId: string) => void;
    onSolve: (sequence: string[]) => void;
  },
): boolean {
  const kind = puzzleKindForNode(opts.nodeId);
  if (!kind) return false;

  if (kind === "tiles") {
    const picked = opts.progress?.picked?.length ?? 0;
    host.innerHTML = `
      <div class="puzzle-panel">
        <div class="puzzle-status">
          <div class="sigil-slots" aria-label="${picked} of 4 tiles pressed">${[0, 1, 2, 3].map((i) => `<div class="sigil-slot ${i < picked ? "lit" : ""}"></div>`).join("")}</div>
          ${faults(opts.progress)}
        </div>
        <div class="tile-grid">
          ${TILE_GRID.map((t, i) => `<button type="button" class="mosaic-tile ${t.elem}" data-elem="${t.elem}" data-nav-key="tile-${i}" ${i === 0 ? "data-autofocus" : ""} aria-label="${t.label} tile"><span>${t.label}</span></button>`).join("")}
        </div>
        ${feedback(opts.progress)}
        <div class="row"><button type="button" class="ghost" data-nav-key="tile-reset" id="tileReset">Clear the chain</button></div>
      </div>`;
    host.querySelectorAll<HTMLElement>("[data-elem]").forEach((b) =>
      b.addEventListener("click", () => {
        sfx("puzzleStep");
        opts.onChoose(b.dataset.elem!);
      }),
    );
    host.querySelector("#tileReset")?.addEventListener("click", () => opts.onChoose("__reset__"));
    return true;
  }

  const spec = SPECS[kind];
  const draft = draftFor(opts.nodeId, opts.progress?.fails ?? 0);
  const render = () => {
    const full = draft.picks.length >= spec.slots.length;
    const byId = new Map(spec.options.map((o) => [o.id, o]));
    host.innerHTML = `
      <div class="puzzle-panel">
        ${spec.clue}
        <div class="puzzle-status">
          <div class="seq-slots">
            ${spec.slots
              .map((label, i) => {
                const o = draft.picks[i] ? byId.get(draft.picks[i]!) : undefined;
                const next = i === draft.picks.length;
                return `<div class="seq-slot ${o ? "filled" : ""} ${next ? "next" : ""}"><em>${label}</em>${o ? `<strong>${o.glyph}</strong><span>${o.label.split(" ")[0]}</span>` : "<strong>·</strong>"}</div>`;
              })
              .join("")}
          </div>
          ${faults(opts.progress)}
        </div>
        <div class="seq-options">
          ${spec.options
            .map((o) => {
              const used = !spec.allowRepeat && draft.picks.includes(o.id);
              return `<button type="button" class="seq-option" data-opt="${o.id}" ${used || full ? "disabled" : ""}><strong>${o.glyph}</strong><span>${o.label}</span></button>`;
            })
            .join("")}
        </div>
        ${feedback(opts.progress)}
        <div class="row seq-actions">
          <button type="button" class="ghost" id="seqUndo" ${draft.picks.length ? "" : "disabled"}>Lift the last one</button>
          <button type="button" class="primary" id="seqSubmit" ${full ? "data-autofocus" : "disabled"}>${spec.submit}</button>
        </div>
      </div>`;
    host.querySelectorAll<HTMLElement>("[data-opt]").forEach((b) =>
      b.addEventListener("click", () => {
        if (draft.picks.length >= spec.slots.length) return;
        draft.picks.push(b.dataset.opt!);
        sfx("puzzleStep");
        render();
        if (draft.picks.length >= spec.slots.length) (host.querySelector("#seqSubmit") as HTMLElement | null)?.focus();
      }),
    );
    host.querySelector("#seqUndo")?.addEventListener("click", () => {
      draft.picks.pop();
      sfx("uiBack");
      render();
    });
    host.querySelector("#seqSubmit")?.addEventListener("click", () => {
      if (draft.picks.length < spec.slots.length) return;
      opts.onSolve([...draft.picks]);
    });
  };
  render();
  return true;
}

/** Back inside a puzzle lifts the last symbol before it leaves the screen. */
export function puzzleBack(nodeId: string): boolean {
  const d = drafts.get(nodeId);
  if (!d?.picks.length) return false;
  d.picks.pop();
  return true;
}
