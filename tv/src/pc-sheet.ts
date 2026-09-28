/** Navigable summarized PC sheet used in combat instead of flat action buttons. */

export type SheetAction = {
  id: string;
  name: string;
  economy: string;
  needsTarget?: boolean;
  guided?: boolean;
  available?: boolean;
};

export type PcSheet = {
  name: string;
  summary: string;
  level: number;
  className: string;
  race: string;
  background: string;
  hp: number;
  maxHp: number;
  ac: number;
  speedCells: number;
  proficiencyBonus: number;
  abilities: Record<string, { score: number; mod: number; modLabel: string }>;
  savingThrows: string[];
  skills: string[];
  features: string[];
  traits: string[];
  inventory: string[];
  weapons: string[];
  economy: {
    movementLeft: number;
    hasAction: boolean;
    hasBonusAction: boolean;
    dodging: boolean;
    disengaging: boolean;
    hidden: boolean;
  };
  actions: SheetAction[];
  bonusActions: SheetAction[];
};

type Tab = "overview" | "actions" | "bonus" | "gear" | "features";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Sheet" },
  { id: "actions", label: "Actions" },
  { id: "bonus", label: "Bonus" },
  { id: "gear", label: "Gear" },
  { id: "features", label: "Traits" },
];

export function renderPcSheet(
  host: HTMLElement,
  opts: {
    sheet: PcSheet | null;
    isMyTurn: boolean;
    pendingId?: string | null;
    onAction: (a: SheetAction) => void;
    onEndTurn: () => void;
  },
): void {
  const sheet = opts.sheet;
  if (!sheet) {
    host.innerHTML = `<p class="meta">No character sheet.</p>`;
    return;
  }

  let tab = (host.dataset.tab as Tab) || "actions";
  if (!TABS.some((t) => t.id === tab)) tab = "overview";

  const eco = sheet.economy;
  const idle =
    opts.isMyTurn &&
    !eco.hasAction &&
    !eco.hasBonusAction &&
    eco.movementLeft <= 0;

  const flags = [
    eco.dodging ? "Dodging" : null,
    eco.disengaging ? "Disengaging" : null,
    eco.hidden ? "Hidden" : null,
  ].filter(Boolean);

  host.innerHTML = `
    <div class="pcsheet">
      <header class="pcsheet-head">
        <div>
          <h3>${sheet.name}</h3>
          <p class="meta">${[sheet.race, sheet.className, `lv ${sheet.level}`]
            .filter(Boolean)
            .join(" · ")}</p>
        </div>
        <div class="pcsheet-vitals">
          <span><em>HP</em> ${sheet.hp}/${sheet.maxHp}</span>
          <span><em>AC</em> ${sheet.ac}</span>
          <span><em>Spd</em> ${sheet.speedCells * 5} ft</span>
          <span><em>Prof</em> +${sheet.proficiencyBonus}</span>
        </div>
      </header>
      <div class="pcsheet-economy meta">
        Move <strong>${eco.movementLeft}</strong>
        · Act ${eco.hasAction ? "●" : "○"}
        · Bonus ${eco.hasBonusAction ? "●" : "○"}
        ${flags.length ? ` · ${flags.join(" · ")}` : ""}
        ${!opts.isMyTurn ? " · <em>not your turn</em>" : ""}
      </div>
      <nav class="pcsheet-tabs">
        ${TABS.map(
          (t) =>
            `<button type="button" data-tab="${t.id}" class="${
              t.id === tab ? "on" : ""
            }">${t.label}</button>`,
        ).join("")}
      </nav>
      <div class="pcsheet-body">${body(sheet, tab, opts)}</div>
      <div class="pcsheet-foot">
        <button type="button" class="primary" id="pcsheetEnd" ${
          opts.isMyTurn ? "" : "disabled"
        }>End Turn</button>
        ${
          idle
            ? `<p class="meta">Action economy spent — End Turn to continue.</p>`
            : ""
        }
      </div>
    </div>
  `;
  host.dataset.tab = tab;

  host.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      host.dataset.tab = (btn as HTMLElement).dataset.tab || "overview";
      renderPcSheet(host, opts);
    });
  });
  host.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.act!;
      const all = [...sheet.actions, ...sheet.bonusActions];
      const a = all.find((x) => x.id === id);
      if (a) opts.onAction(a);
    });
  });
  host.querySelector("#pcsheetEnd")?.addEventListener("click", () => {
    opts.onEndTurn();
  });
}

function body(sheet: PcSheet, tab: Tab, opts: { isMyTurn: boolean; pendingId?: string | null }) {
  if (tab === "overview") {
    const abs = ["str", "dex", "con", "int", "wis", "cha"]
      .map((k) => {
        const a = sheet.abilities[k];
        if (!a) return "";
        return `<div class="pcsheet-abil"><span>${k.toUpperCase()}</span><strong>${a.score}</strong><em>${a.modLabel}</em></div>`;
      })
      .join("");
    return `
      <p class="meta">${sheet.summary || ""}</p>
      <div class="pcsheet-abs">${abs}</div>
      <p class="meta">Saves: ${(sheet.savingThrows || []).map((s) => s.toUpperCase()).join(", ") || "—"}</p>
      <p class="meta">Skills: ${(sheet.skills || []).join(", ") || "—"}</p>
      <p class="meta">Actions are the strike. Lit cells are your movement. ★ is the suggested play.</p>
    `;
  }
  if (tab === "actions") {
    return listActs(sheet.actions, opts, "No actions available");
  }
  if (tab === "bonus") {
    return listActs(sheet.bonusActions, opts, "No bonus actions");
  }
  if (tab === "gear") {
    return `
      <p class="meta">Weapons: ${(sheet.weapons || []).join(", ") || "—"}</p>
      <ul class="pcsheet-list">${(sheet.inventory || [])
        .map((i) => `<li>${i.replace(/_/g, " ")}</li>`)
        .join("") || "<li class='meta'>Empty</li>"}</ul>
    `;
  }
  return `
    <ul class="pcsheet-list">${[...(sheet.features || []), ...(sheet.traits || [])]
      .map((f) => `<li>${f.replace(/_/g, " ")}</li>`)
      .join("") || "<li class='meta'>None listed</li>"}</ul>
  `;
}

function listActs(
  items: SheetAction[],
  opts: { isMyTurn: boolean; pendingId?: string | null },
  empty: string,
) {
  if (!items.length) return `<p class="meta">${empty}</p>`;
  return `<div class="pcsheet-acts">${items
    .map((a) => {
      const on = opts.pendingId === a.id ? "pending" : "";
      const dis = !opts.isMyTurn || a.available === false;
      return `<button type="button" class="pcsheet-act ${on} ${
        a.guided ? "guided" : ""
      }" data-act="${a.id}" ${dis ? "disabled" : ""}>
        <strong>${a.name}${a.guided ? " ★" : ""}</strong>
        <span class="meta">${a.economy.replace("_", " ")}${
          a.needsTarget ? " · needs target" : ""
        }${a.available === false ? " · used" : ""}</span>
      </button>`;
    })
    .join("")}</div>`;
}
