/** Interactive puzzle UIs (oneshot Console Arcana style). */

export type PuzzleKind = "tiles" | "vessels" | "well_lock" | "vials" | "mixture" | "sequence";

const TILE_GRID: Array<{ elem: string; cls: string }> = [
  { elem: "emerald", cls: "emerald" },
  { elem: "fire", cls: "fire" },
  { elem: "slate", cls: "slate" },
  { elem: "violet", cls: "violet" },
  { elem: "sand", cls: "sand" },
  { elem: "indigo", cls: "indigo" },
  { elem: "air", cls: "air" },
  { elem: "copper", cls: "copper" },
  { elem: "wine", cls: "wine" },
  { elem: "lime", cls: "lime" },
  { elem: "black", cls: "black" },
  { elem: "rose", cls: "rose" },
  { elem: "earth", cls: "earth" },
  { elem: "teal", cls: "teal" },
  { elem: "amber", cls: "amber" },
  { elem: "coral", cls: "coral" },
  { elem: "moss", cls: "moss" },
  { elem: "water", cls: "water" },
  { elem: "apricot", cls: "apricot" },
  { elem: "ivory", cls: "ivory" },
  { elem: "violet", cls: "violet" },
  { elem: "olive", cls: "olive" },
  { elem: "steel", cls: "steel" },
  { elem: "fire", cls: "fire" },
  { elem: "silver", cls: "silver" },
];

export function puzzleKindForNode(nodeId: string): PuzzleKind | null {
  if (nodeId === "corridor_tiles") return "tiles";
  if (nodeId === "cellar_vessels") return "vessels";
  if (nodeId === "well_lock") return "well_lock";
  if (nodeId === "store_vials") return "vials";
  if (nodeId === "store_mixture") return "mixture";
  return null;
}

export function renderInteractivePuzzle(
  host: HTMLElement,
  opts: {
    nodeId: string;
    narration?: string;
    progress?: {
      picked: string[];
      need: number;
      fails: number;
      feedback?: string;
    } | null;
    roomCode: string;
    onChoose: (choiceId: string) => void;
    send: (obj: unknown) => void;
  },
): boolean {
  const kind = puzzleKindForNode(opts.nodeId);
  if (!kind) return false;

  const batch = (sequence: string[]) => {
    opts.send({
      action: "SOLVE_PUZZLE",
      roomCode: opts.roomCode,
      sequence,
    });
  };

  if (kind === "tiles") {
    const picked = opts.progress?.picked?.length ?? 0;
    host.innerHTML = `
      <div class="puzzle-panel">
        <blockquote class="poem">
          <span>The amethyst tear that metal scratches and does not crush,</span>
          <span>the cold ash of a fire that is no more,</span>
          <span>the deep abyss where light dies,</span>
          <span>the wound of the sky before the horizon falls silent.</span>
        </blockquote>
        <div class="sigil-slots">${[0, 1, 2, 3]
          .map(
            (i) =>
              `<div class="sigil-slot ${i < picked ? "lit" : ""}"></div>`,
          )
          .join("")}</div>
        <div class="tile-grid">
          ${TILE_GRID.map(
            (t) =>
              `<button type="button" class="mosaic-tile ${t.cls}" data-elem="${t.elem}" aria-label="${t.elem}"></button>`,
          ).join("")}
        </div>
        <p class="meta" id="puzzleMsg">${opts.progress?.feedback ?? ""}</p>
        <p class="meta">Chain: ${picked}/4${opts.progress?.fails ? ` · faults ${opts.progress.fails}` : ""}</p>
        <button type="button" class="btn-ghost" id="tileReset">Reset chain</button>
      </div>
    `;
    host.querySelectorAll("[data-elem]").forEach((b) => {
      b.addEventListener("click", () => {
        opts.onChoose((b as HTMLElement).dataset.elem!);
      });
    });
    host.querySelector("#tileReset")?.addEventListener("click", () => {
      opts.onChoose("__reset__");
    });
    return true;
  }

  if (kind === "vessels") {
    const optsList = ["eye", "x", "wave", "spiral"];
    const labels: Record<string, string> = {
      eye: "Occhio / Eye",
      x: "X",
      wave: "Onda / Wave",
      spiral: "Spira / Spiral",
    };
    host.innerHTML = `
      <div class="puzzle-panel">
        <ul class="crate-hints">
          <li>① The <strong>X</strong> vessel is neither first nor last.</li>
          <li>② <strong>Spiral</strong> is immediately after <strong>Wave</strong>.</li>
          <li>③ <strong>Eye</strong> is left of <strong>X</strong>.</li>
          <li>④ Position 1 is not <strong>Wave</strong>.</li>
        </ul>
        <div class="field-grid">
          ${[1, 2, 3, 4]
            .map(
              (i) => `
            <label>Position ${i}
              <select data-slot="${i - 1}">
                <option value="">— Symbol —</option>
                ${optsList
                  .map((o) => `<option value="${o}">${labels[o]}</option>`)
                  .join("")}
              </select>
            </label>`,
            )
            .join("")}
        </div>
        <button type="button" class="primary" id="vesselSubmit">Activate Seal</button>
        <p class="meta" id="puzzleMsg">${opts.progress?.feedback ?? ""}</p>
      </div>
    `;
    host.querySelector("#vesselSubmit")?.addEventListener("click", () => {
      const selects = [...host.querySelectorAll("select[data-slot]")] as HTMLSelectElement[];
      const vals = selects.map((s) => s.value);
      if (vals.some((v) => !v) || new Set(vals).size !== 4) {
        errLocal(host, "Choose four different symbols.");
        return;
      }
      batch(vals);
    });
    return true;
  }

  if (kind === "well_lock") {
    const symbols = [
      { id: "tooth", label: "△ Tooth" },
      { id: "spark", label: "✦ Spark" },
      { id: "moon", label: "○ Moon" },
      { id: "wave", label: "☰ Wave" },
      { id: "sun", label: "☀ Sun" },
      { id: "skull", label: "☠ Skull" },
      { id: "stone", label: "□ Stone" },
    ];
    host.innerHTML = `
      <div class="puzzle-panel">
        <p class="hint-box">Four sockets. No duplicates. «First what bites the rope; then the fallen star; then the eye of the night sky; finally what has no shape and yet flows.»</p>
        <div class="field-grid">
          ${[1, 2, 3, 4]
            .map(
              (i) => `
            <label>Socket ${i}
              <select data-slot="${i - 1}">
                <option value="">—</option>
                ${symbols
                  .map((s) => `<option value="${s.id}">${s.label}</option>`)
                  .join("")}
              </select>
            </label>`,
            )
            .join("")}
        </div>
        <button type="button" class="primary" id="wellSubmit">Unlock pulley</button>
        <p class="meta" id="puzzleMsg">${opts.progress?.feedback ?? ""}</p>
      </div>
    `;
    host.querySelector("#wellSubmit")?.addEventListener("click", () => {
      const selects = [...host.querySelectorAll("select[data-slot]")] as HTMLSelectElement[];
      const vals = selects.map((s) => s.value);
      if (vals.some((v) => !v) || new Set(vals).size !== 4) {
        errLocal(host, "Four different symbols required.");
        return;
      }
      batch(vals);
    });
    return true;
  }

  if (kind === "vials") {
    const optsList = [
      { id: "heal", label: "Healing (G)" },
      { id: "invis", label: "Invisibility" },
      { id: "vit", label: "Vitality" },
      { id: "poison", label: "Poison" },
    ];
    host.innerHTML = `
      <div class="puzzle-panel">
        <p class="hint-box">α β γ δ — two Healing not adjacent; Invisibility immediately left of Vitality; α ≠ Vitality; δ ≠ Invisibility.</p>
        <div class="field-grid">
          ${["α", "β", "γ", "δ"]
            .map(
              (lab, i) => `
            <label>${lab}
              <select data-slot="${i}">
                <option value="">—</option>
                ${optsList
                  .map((o) => `<option value="${o.id}">${o.label}</option>`)
                  .join("")}
              </select>
            </label>`,
            )
            .join("")}
        </div>
        <button type="button" class="primary" id="vialSubmit">Lock vials</button>
        <p class="meta" id="puzzleMsg">${opts.progress?.feedback ?? ""}</p>
      </div>
    `;
    host.querySelector("#vialSubmit")?.addEventListener("click", () => {
      const selects = [...host.querySelectorAll("select[data-slot]")] as HTMLSelectElement[];
      const vals = selects.map((s) => s.value);
      if (vals.some((v) => !v)) {
        errLocal(host, "Fill all four vials.");
        return;
      }
      batch(vals);
    });
    return true;
  }

  if (kind === "mixture") {
    const reagents = [
      { id: "moon_dust", label: "Powder of the pale sky-disk" },
      { id: "black_salt", label: "Black crystal against spirits" },
      { id: "stone_oil", label: "Grease of the deep rock" },
      { id: "hop_ash", label: "Ash of bitter flowers" },
      { id: "quicklime", label: "White fire-dust" },
      { id: "mercury", label: "Living silver" },
    ];
    host.innerHTML = `
      <div class="puzzle-panel">
        <p class="hint-box">Three basins. Three gestures: sunless sky → border against spirits → anoint the slabs.</p>
        <div class="field-grid">
          ${["I", "II", "III"]
            .map(
              (lab, i) => `
            <label>Basin ${lab}
              <select data-slot="${i}">
                <option value="">—</option>
                ${reagents
                  .map((r) => `<option value="${r.id}">${r.label}</option>`)
                  .join("")}
              </select>
            </label>`,
            )
            .join("")}
        </div>
        <button type="button" class="primary" id="mixSubmit">Complete mixture</button>
        <p class="meta" id="puzzleMsg">${opts.progress?.feedback ?? ""}</p>
      </div>
    `;
    host.querySelector("#mixSubmit")?.addEventListener("click", () => {
      const selects = [...host.querySelectorAll("select[data-slot]")] as HTMLSelectElement[];
      const vals = selects.map((s) => s.value);
      if (vals.some((v) => !v)) {
        errLocal(host, "Fill all three basins.");
        return;
      }
      batch(vals);
    });
    return true;
  }

  return false;
}

function errLocal(host: HTMLElement, msg: string) {
  const el = host.querySelector("#puzzleMsg");
  if (el) el.textContent = msg;
}
