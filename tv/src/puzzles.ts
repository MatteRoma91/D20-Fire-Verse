/**
 * Puzzle boards: one holder places symbols; others soft-hint.
 * Press / glow / reset animations sync to server feedback.
 */

import { reducedMotion } from "./settings";
import { sfx } from "./sfx";

export type PuzzleKind = "tiles" | "vessels" | "well_lock" | "vials" | "mixture";

export type PuzzleProgress = {
  picked: string[];
  need: number;
  fails: number;
  feedback?: string;
  draft?: string[];
  holderId?: string | null;
  holderName?: string | null;
  hints?: Array<{ playerId: string; name: string; slot: number; optionId: string }>;
  history?: Array<{ guess: string[]; black: number; white: number }>;
  lastScore?: { black: number; white: number } | null;
  poem?: string[] | null;
  nudge?: string | null;
} | null;

type Option = { id: string; glyph: string; label: string; color?: string };

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
      { id: "heal", glyph: "✚", label: "Healing", color: "#5a9a6a" },
      { id: "invis", glyph: "◌", label: "Invisibility", color: "#a8c4d8" },
      { id: "vit", glyph: "♥", label: "Vitality", color: "#c45c6a" },
      { id: "poison", glyph: "☠", label: "Poison", color: "#6a5a8a" },
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
    slots: ["Sky", "Spirits", "Slabs"],
    options: [
      { id: "moon_dust", glyph: "☾", label: "Powder of the pale sky-disk", color: "#c8d0e8" },
      { id: "black_salt", glyph: "◆", label: "Black crystal against spirits", color: "#2a2a32" },
      { id: "stone_oil", glyph: "◍", label: "Grease of the deep rock", color: "#8a7040" },
      { id: "hop_ash", glyph: "✿", label: "Ash of bitter flowers", color: "#7a6a50" },
      { id: "quicklime", glyph: "✧", label: "White fire-dust", color: "#e8e0c8" },
      { id: "mercury", glyph: "☿", label: "Living silver", color: "#a0a8b0" },
    ],
    allowRepeat: false,
    clue: `<div class="hint-box mixture-gestures">
      <p><strong>I · Sky</strong> — darken the sky without a sun</p>
      <p><strong>II · Spirits</strong> — draw a border against spirits</p>
      <p><strong>III · Slabs</strong> — anoint the slabs</p>
    </div>`,
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

const localDraft = new Map<string, string[]>();
/** Optimistic draft wins only until the server echo lands. */
const draftDirtyUntil = new Map<string, number>();

const HINT_COLORS = ["#7ec8e3", "#f0b429", "#e891a8", "#b8e040", "#c4a0e8"];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function hintColor(playerId: string): string {
  let n = 0;
  for (const ch of playerId) n = (n + ch.charCodeAt(0)) % HINT_COLORS.length;
  return HINT_COLORS[n]!;
}

function hintMarks(hints: NonNullable<PuzzleProgress>["hints"], match: (h: { optionId: string; slot: number }) => boolean): string {
  const here = (hints ?? []).filter(match);
  if (!here.length) return "";
  return `<span class="hint-row">${here
    .map(
      (h) =>
        `<i class="hint-dot" style="background:${hintColor(h.playerId)}" title="${esc(h.name)} suggests">${esc(h.name.trim().slice(0, 1) || "·")}</i>`,
    )
    .join("")}</span>`;
}

function takeDraft(nodeId: string, server: string[], fails: number): string[] {
  const local = localDraft.get(nodeId);
  const dirty = (draftDirtyUntil.get(nodeId) ?? 0) > Date.now();
  if (local && dirty) return [...local];
  localDraft.set(nodeId, [...server]);
  draftDirtyUntil.delete(nodeId);
  void fails;
  return [...server];
}

function rememberDraft(nodeId: string, picks: string[]) {
  localDraft.set(nodeId, [...picks]);
  draftDirtyUntil.set(nodeId, Date.now() + 1200);
}

function faults(fails: number, max = 2) {
  return `<span class="faults" aria-label="${fails} of ${max} faults">${Array.from({ length: max }, (_, i) => `<i class="${i < fails ? "on" : ""}"></i>`).join("")}</span>`;
}

function feedback(text: string) {
  if (!text) return `<p class="puzzle-feedback" aria-live="polite"></p>`;
  const bad = /wrong|grinds|bite|flash|fumes|blades|lash/i.test(text);
  return `<p class="puzzle-feedback ${bad ? "bad" : "good"}" aria-live="polite">${esc(text)}</p>`;
}

function mixtureVial(picks: string[], options: Option[], boiling: boolean) {
  const layers = boiling
    ? ""
    : picks
        .map((id, i) => {
          const o = options.find((x) => x.id === id);
          const h = 28 + i * 8;
          return `<div class="mix-layer" style="height:${h}%;background:${o?.color ?? "#888"};animation-delay:${i * 0.12}s"></div>`;
        })
        .join("");
  return `<div class="mix-vial ${boiling ? "boil" : ""} ${picks.length && !boiling ? `pour-${Math.min(3, picks.length)}` : ""}" aria-hidden="true"><div class="mix-glass">${layers}</div><span class="mix-label">${boiling ? "Spoiled" : "Result"}</span></div>`;
}

function pressAnim(el: HTMLElement) {
  if (reducedMotion()) {
    el.classList.add("glow");
    return;
  }
  el.classList.remove("press", "glow");
  void el.offsetWidth;
  el.classList.add("press");
  window.setTimeout(() => {
    el.classList.remove("press");
    el.classList.add("glow");
  }, 160);
}

function playReset(host: HTMLElement) {
  sfx("puzzleReset");
  if (reducedMotion()) return;
  host.classList.add("puzzle-reset");
  window.setTimeout(() => host.classList.remove("puzzle-reset"), 480);
}

function playSuccess(host: HTMLElement) {
  sfx("puzzleLock");
  if (reducedMotion()) return;
  host.classList.add("puzzle-success");
  window.setTimeout(() => host.classList.remove("puzzle-success"), 900);
}

export function renderInteractivePuzzle(
  host: HTMLElement,
  opts: {
    nodeId: string;
    progress: PuzzleProgress;
    localPlayerId: string | null;
    playerCount: number;
    onChoose: (choiceId: string) => void;
    onSolve: (sequence: string[]) => void;
    onClaim: () => void;
    onRelease: () => void;
    onHint: (slot: number, optionId: string) => void;
    onDraft: (draft: string[]) => void;
  },
): boolean {
  const kind = puzzleKindForNode(opts.nodeId);
  if (!kind) return false;

  const p = opts.progress;
  const fails = p?.fails ?? 0;
  const pickedNow = p?.picked.length ?? 0;
  if (host.dataset.node !== opts.nodeId) {
    host.dataset.node = opts.nodeId;
    host.dataset.fails = "-1";
    host.dataset.picked = "-1";
  }
  const multi = opts.playerCount > 1;
  const holderId = p?.holderId ?? null;
  const isHolder = !multi || !holderId || holderId === opts.localPlayerId;
  const canHint = multi && holderId && holderId !== opts.localPlayerId;

  const prevFails = Number(host.dataset.fails ?? "-1");
  const prevPicked = Number(host.dataset.picked ?? "-1");
  const resetting =
    (prevFails >= 0 && fails > prevFails) || (prevPicked > 0 && pickedNow === 0 && prevFails >= 0);
  if (resetting) playReset(host);
  if (pickedNow >= (p?.need ?? 99) && (p?.need ?? 0) > 0) playSuccess(host);
  host.dataset.fails = String(fails);
  host.dataset.picked = String(pickedNow);

  if (kind === "tiles") {
    const picked = p?.picked?.length ?? 0;
    const poem = p?.poem ?? [];
    host.innerHTML = `
      <div class="puzzle-panel ${fails ? "is-fault" : ""}">
        ${
          multi
            ? `<div class="puzzle-claim">${
                holderId
                  ? `<span>Hands: <strong>${p?.holderName ?? "…"}</strong></span>${
                      isHolder ? `<button type="button" class="ghost" id="puzzlePass">Pass the mechanism</button>` : `<span class="meta">Soft-tap a tile to suggest</span>`
                    }`
                  : `<button type="button" class="primary" id="puzzleClaim" data-autofocus>Take the mosaic</button>`
              }</div>`
            : ""
        }
        ${poem.length ? `<blockquote class="poem mosaic-poem">${poem.map((line) => `<span>${esc(line)}</span>`).join("")}</blockquote>` : ""}
        <div class="puzzle-status">
          <div class="sigil-slots" aria-label="${picked} of 4 tiles pressed">${[0, 1, 2, 3]
            .map((i) => `<div class="sigil-slot ${i < picked ? "lit sunk" : ""}"></div>`)
            .join("")}</div>
          ${faults(fails)}
        </div>
        <div class="tile-grid">
          ${TILE_GRID.map((t, i) => {
            const order = (p?.picked ?? []).indexOf(t.elem);
            const chain = order >= 0 ? ` in-chain` : "";
            const delay = order >= 0 ? ` style="--chain:${order}"` : "";
            return `<button type="button" class="mosaic-tile ${t.elem}${chain}${resetting ? " rising" : ""}" data-elem="${t.elem}" data-nav-key="tile-${i}" ${i === 0 ? "data-autofocus" : ""} aria-label="${esc(t.label)} tile"${delay}><span>${esc(t.label)}</span>${hintMarks(p?.hints, (h) => h.optionId === t.elem)}</button>`;
          }).join("")}
        </div>
        ${feedback(p?.feedback ?? "")}
        ${p?.nudge ? `<p class="puzzle-nudge">${esc(p.nudge)}</p>` : ""}
        <div class="row"><button type="button" class="ghost" data-nav-key="tile-reset" id="tileReset" ${isHolder ? "" : "disabled"}>Clear the chain</button></div>
      </div>`;
    host.querySelector("#puzzleClaim")?.addEventListener("click", () => opts.onClaim());
    host.querySelector("#puzzlePass")?.addEventListener("click", () => opts.onRelease());
    host.querySelectorAll<HTMLElement>("[data-elem]").forEach((b) =>
      b.addEventListener("click", () => {
        if (canHint) {
          sfx("uiMove");
          b.classList.add("alone");
          opts.onHint(picked, b.dataset.elem!);
          return;
        }
        pressAnim(b);
        if (!isHolder && multi && !holderId) {
          opts.onClaim();
          return;
        }
        if (!isHolder) return;
        sfx("puzzleStep");
        opts.onChoose(b.dataset.elem!);
      }),
    );
    host.querySelector("#tileReset")?.addEventListener("click", () => {
      if (!isHolder) return;
      opts.onChoose("__reset__");
    });
    return true;
  }

  const spec = SPECS[kind];
  const serverDraft = p?.draft?.length ? p.draft : p?.picked ?? [];
  const picks = takeDraft(opts.nodeId, serverDraft, fails);
  host.dataset.draftFails = String(fails);

  const byId = new Map(spec.options.map((o) => [o.id, o]));
  const full = picks.length >= spec.slots.length;
  const history =
    kind === "well_lock" && p?.history?.length
      ? `<div class="well-history">${p.history
          .map(
            (h) =>
              `<div class="well-try">${h.guess.map((g) => byId.get(g)?.glyph ?? "?").join(" ")} <span>●${h.black} ○${h.white}</span></div>`,
          )
          .join("")}</div>`
      : "";

  host.innerHTML = `
    <div class="puzzle-panel ${fails ? "is-fault" : ""} ${kind === "mixture" ? "has-mix" : ""}">
      ${
        multi
          ? `<div class="puzzle-claim">${
              holderId
                ? `<span>Hands: <strong>${p?.holderName ?? "…"}</strong></span>${
                    isHolder ? `<button type="button" class="ghost" id="puzzlePass">Pass the mechanism</button>` : `<span class="meta">Tap a symbol to suggest a slot</span>`
                  }`
                : `<button type="button" class="primary" id="puzzleClaim" data-autofocus>Take the mechanism</button>`
            }</div>`
          : ""
      }
      ${spec.clue}
      <div class="puzzle-status">
        <div class="seq-slots">
          ${spec.slots
            .map((label, i) => {
              const o = picks[i] ? byId.get(picks[i]!) : undefined;
              const next = i === picks.length;
              return `<div class="seq-slot ${o ? "filled drop-in" : ""} ${next ? "next" : ""} ${resetting ? "eject" : ""}" data-slot="${i}"><em>${label}</em>${o ? `<strong>${o.glyph}</strong><span>${esc(o.label.split(" ")[0]!)}</span>` : "<strong>·</strong>"}${hintMarks(p?.hints, (h) => h.slot === i)}</div>`;
            })
            .join("")}
        </div>
        ${faults(fails)}
        ${kind === "mixture" ? mixtureVial(resetting ? [] : picks, spec.options, resetting) : ""}
      </div>
      ${history}
      ${p?.lastScore && kind === "well_lock" ? `<p class="meta well-score">Last try · ●${p.lastScore.black} true · ○${p.lastScore.white} shifted</p>` : ""}
      <div class="seq-options">
        ${spec.options
          .map((o) => {
            const used = !spec.allowRepeat && picks.includes(o.id);
            return `<button type="button" class="seq-option" data-opt="${o.id}" ${used || (full && isHolder) ? "disabled" : ""}><strong>${o.glyph}</strong><span>${o.label}</span></button>`;
          })
          .join("")}
      </div>
      ${feedback(p?.feedback ?? "")}
      ${p?.nudge ? `<p class="puzzle-nudge">${esc(p.nudge)}</p>` : ""}
      <div class="row seq-actions">
        <button type="button" class="ghost" id="seqUndo" ${picks.length && isHolder ? "" : "disabled"}>Lift the last one</button>
        <button type="button" class="primary" id="seqSubmit" ${full && isHolder ? "data-autofocus" : "disabled"}>${spec.submit}</button>
      </div>
    </div>`;

  host.querySelector("#puzzleClaim")?.addEventListener("click", () => opts.onClaim());
  host.querySelector("#puzzlePass")?.addEventListener("click", () => opts.onRelease());

  let hintSlot = picks.length < spec.slots.length ? picks.length : 0;
  host.querySelectorAll<HTMLElement>(".seq-slot").forEach((slotEl) =>
    slotEl.addEventListener("click", () => {
      if (!canHint) return;
      hintSlot = Number(slotEl.dataset.slot ?? 0);
      host.querySelectorAll(".seq-slot").forEach((s) => s.classList.remove("hint-target"));
      slotEl.classList.add("hint-target");
    }),
  );

  host.querySelectorAll<HTMLElement>("[data-opt]").forEach((b) =>
    b.addEventListener("click", () => {
      if (canHint) {
        sfx("uiMove");
        b.classList.add("alone");
        opts.onHint(hintSlot, b.dataset.opt!);
        return;
      }
      pressAnim(b);
      if (!isHolder && multi && !holderId) {
        opts.onClaim();
        return;
      }
      if (!isHolder) return;
      if (picks.length >= spec.slots.length) return;
      picks.push(b.dataset.opt!);
      rememberDraft(opts.nodeId, picks);
      sfx(kind === "mixture" ? "puzzlePour" : "puzzleStep");
      opts.onDraft([...picks]);
      renderInteractivePuzzle(host, opts);
      if (picks.length >= spec.slots.length) (host.querySelector("#seqSubmit") as HTMLElement | null)?.focus();
    }),
  );
  host.querySelector("#seqUndo")?.addEventListener("click", () => {
    if (!isHolder) return;
    picks.pop();
    rememberDraft(opts.nodeId, picks);
    sfx("uiBack");
    opts.onDraft([...picks]);
    renderInteractivePuzzle(host, opts);
  });
  host.querySelector("#seqSubmit")?.addEventListener("click", () => {
    if (!isHolder || picks.length < spec.slots.length) return;
    opts.onSolve([...picks]);
  });
  return true;
}

export function puzzleBack(nodeId: string): boolean {
  const d = localDraft.get(nodeId);
  if (!d?.length) return false;
  d.pop();
  rememberDraft(nodeId, d);
  return true;
}
