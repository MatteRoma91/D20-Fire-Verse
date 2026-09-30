/** The hero's sheet beside the board: portrait, vitals, economy pips and a few tabs of detail. */

import { srdLabel } from "@d20-fireverse/protocol";

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
  spellSlots?: Record<string, number> | null;
  conditions?: string[];
  concentrating?: string | null;
  savingThrows: string[];
  skills: string[];
  features: string[];
  traits: string[];
  inventory: string[];
  weapons: string[];
  portrait?: string;
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

export const SHEET_TABS = [
  { id: "overview", label: "Sheet" },
  { id: "gear", label: "Gear" },
  { id: "features", label: "Traits" },
] as const;
export type SheetTab = (typeof SHEET_TABS)[number]["id"];

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function renderPcSheet(host: HTMLElement, sheet: PcSheet | null, tab: SheetTab, isMyTurn: boolean, onTab: (t: SheetTab) => void) {
  if (!sheet) {
    host.innerHTML = `<p class="meta">Waiting for a hero to take the field.</p>`;
    return;
  }
  const eco = sheet.economy;
  const ratio = sheet.maxHp ? Math.max(0, Math.min(1, sheet.hp / sheet.maxHp)) : 0;
  const flags = [eco.dodging ? "Dodging" : "", eco.disengaging ? "Disengaged" : "", eco.hidden ? "Hidden" : ""].filter(Boolean);
  const body = (() => {
    switch (tab) {
      case "overview": {
        const abs = ["str", "dex", "con", "int", "wis", "cha"]
          .map((k) => {
            const a = sheet.abilities[k];
            return a ? `<div class="abil"><span>${k.toUpperCase()}</span><strong>${a.score}</strong><em>${a.modLabel}</em></div>` : "";
          })
          .join("");
        const slots = sheet.spellSlots
          ? Object.entries(sheet.spellSlots)
              .filter(([, n]) => n > 0)
              .map(([level, n]) => `L${level} ×${n}`)
              .join(" · ")
          : "";
        return `<div class="abil-grid">${abs}</div>
          <p class="meta">Saves ${sheet.savingThrows.map((s) => s.toUpperCase()).join(", ") || "—"}</p>
          <p class="meta">Skills ${sheet.skills.map(pretty).join(", ") || "—"}</p>
          ${slots ? `<p class="meta">Slots ${slots}</p>` : ""}
          ${sheet.concentrating ? `<p class="meta">Concentrating on ${pretty(sheet.concentrating)}</p>` : ""}
          ${sheet.conditions?.length ? `<p class="meta">${sheet.conditions.join(", ")}</p>` : ""}`;
      }
      case "gear":
        return `<p class="meta">Weapons ${sheet.weapons.map(pretty).join(", ") || "—"}</p>
          <ul class="sheet-list">${sheet.inventory.map((i) => `<li>${esc(pretty(i))}</li>`).join("") || "<li class='meta'>Nothing carried</li>"}</ul>`;
      case "features":
        return `<ul class="sheet-list">${[...sheet.features, ...sheet.traits].map((f) => `<li>${esc(pretty(f))}</li>`).join("") || "<li class='meta'>None listed</li>"}</ul>`;
      default: {
        const exhaustive: never = tab;
        return exhaustive;
      }
    }
  })();
  host.innerHTML = `
    <header class="sheet-head">
      ${sheet.portrait ? `<img class="sheet-portrait" src="${sheet.portrait}" alt="" />` : ""}
      <div>
        <h3>${esc(sheet.name)}</h3>
        <p class="meta">${esc([srdLabel(sheet.race), srdLabel(sheet.className), `level ${sheet.level}`].filter(Boolean).join(" · "))}</p>
      </div>
    </header>
    <div class="sheet-hp" role="img" aria-label="${sheet.hp} of ${sheet.maxHp} hit points">
      <span style="--hp:${ratio}"></span><strong>${sheet.hp}<em>/${sheet.maxHp} HP</em></strong>
    </div>
    <div class="sheet-vitals">
      <span><em>AC</em>${sheet.ac}</span>
      <span><em>Speed</em>${sheet.speedCells * 5} ft</span>
      <span><em>Prof</em>+${sheet.proficiencyBonus}</span>
    </div>
    <div class="economy ${isMyTurn ? "live" : ""}">
      <span class="pip ${eco.hasAction ? "on" : ""}"><i></i>Action</span>
      <span class="pip ${eco.hasBonusAction ? "on" : ""}"><i></i>Bonus</span>
      <span class="pip move ${eco.movementLeft > 0 ? "on" : ""}"><i></i>${eco.movementLeft * 5} ft</span>
      ${flags.map((f) => `<span class="flag">${f}</span>`).join("")}
    </div>
    <nav class="sheet-tabs">${SHEET_TABS.map((t) => `<button type="button" data-sheet-tab="${t.id}" class="${t.id === tab ? "on" : ""}">${t.label}</button>`).join("")}</nav>
    <div class="sheet-body">${body}</div>`;
  host.querySelectorAll<HTMLElement>("[data-sheet-tab]").forEach((b) => b.addEventListener("click", () => onTab(b.dataset.sheetTab as SheetTab)));
}
