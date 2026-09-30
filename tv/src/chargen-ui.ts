/** Character creation wizard (SRD 5.1 levels 1–3). */

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type ChargenCatalog = {
  source: string;
  levels: number[];
  methods: Array<{ id: string; label: string; values?: number[]; budget?: number; hint: string }>;
  abilities: AbilityKey[];
  skills: Record<string, { ability: string; label: string }>;
  races: Array<{
    id: string;
    label: string;
    speedCells: number;
    abilityBonuses: Partial<Record<AbilityKey, number>>;
    flexibleBonuses: number;
    traits: string[];
    extraSkills: number;
    hpBonusPerLevel: number;
  }>;
  backgrounds: Array<{ id: string; label: string; skills: string[] }>;
  fightingStyles: Array<{ id: string; label: string; desc: string }>;
  classes: Array<{
    id: string;
    label: string;
    hitDie: number;
    savingThrows: string[];
    skillChoices: number;
    skillList: string[];
    armor: string;
    shield: boolean;
    spellcasting: string | null;
    spellAbility: string | null;
    cantripsKnown: Record<string, number> | null;
    spellsKnown: Record<string, number> | null;
    preparedFormula: string | null;
    domains: Array<{ id: string; label: string }> | null;
    fightingStyleRequired: boolean;
    fightingStyleAt: number | null;
    fightingStyleOptions: string[] | null;
    featuresByLevel: Record<string, string[]>;
    spellLists: { cantrips: string[]; "1": string[]; "2": string[] } | null;
  }>;
  pointBuy: { budget: number; costs: Record<string, number>; min: number; max: number };
  standardArray: number[];
  spellCatalog: Record<string, { label: string; level: number; combat?: boolean }>;
};

export type DraftState = {
  step: number;
  name: string;
  level: 1 | 2 | 3;
  raceId: string;
  classId: string;
  backgroundId: string;
  method: "standard_array" | "point_buy" | "roll";
  baseAbilities: Record<AbilityKey, number>;
  flexibleAbilityBonuses: AbilityKey[];
  classSkills: string[];
  raceSkills: string[];
  fightingStyle: string;
  domain: string;
  cantrips: string[];
  spellsKnown: string[];
  rolledPool: number[];
  /** Null until the player picks one; the lineage suggests a face meanwhile. */
  portraitId: string | null;
};

export type PortraitOption = { id: string; url: string };

/** Mirrors the backend's default so the preview shows the face the server will assign. */
export function suggestedPortrait(raceId: string, classId: string): string {
  if (raceId === "dragonborn") return "cg_dragonborn";
  if (raceId === "tiefling") return "cg_tiefling";
  if (raceId === "half_orc") return "cg_halforc";
  if (raceId === "wood_elf") return "cg_woodelf";
  if (raceId === "rock_gnome") return "cg_gnome";
  if (raceId === "hill_dwarf" || raceId === "mountain_dwarf") return "torin_emberhand";
  if (raceId.endsWith("halfling")) return "mira_softstep";
  if (raceId === "high_elf" || raceId === "half_elf") return "quill_ashmere";
  if (classId === "bard" || classId === "warlock" || classId === "sorcerer") return "cg_bard";
  return "brenna_ironveal";
}

const NAME_PARTS: Record<string, { first: string[]; last: string[] }> = {
  dwarf: { first: ["Thora", "Balin", "Dagna", "Rurik", "Hilda", "Kildrak"], last: ["Ironfist", "Stonebrow", "Deepdelve", "Coppervein"] },
  elf: { first: ["Aelar", "Naivara", "Thamior", "Sariel", "Ivellios", "Lia"], last: ["Moonwhisper", "Galanodel", "Nightbreeze", "Amakiir"] },
  halfling: { first: ["Cora", "Milo", "Verna", "Roscoe", "Lidda", "Perrin"], last: ["Tealeaf", "Goodbarrel", "Underbough", "Brushgather"] },
  gnome: { first: ["Nissa", "Boddynock", "Orla", "Fonkin", "Zook", "Bimpnottin"], last: ["Tinkertop", "Nackle", "Scheppen", "Garrick"] },
  dragonborn: { first: ["Arjhan", "Sora", "Kriv", "Nala", "Medrash", "Harann"], last: ["Kerrhylon", "Clethtinthiallor", "Daardendrian", "Yarjerit"] },
  tiefling: { first: ["Akmenos", "Nemeia", "Kallista", "Mordai", "Orianna", "Damakos"], last: ["of the Ember", "Hollowhymn", "Ashveil", "Nightcant"] },
  orc: { first: ["Dench", "Shautha", "Holg", "Emen", "Krusk", "Ovak"], last: ["Tuskbreaker", "Redscar", "Grimjaw", "Stoneback"] },
  human: { first: ["Brenna", "Aldric", "Maren", "Tobias", "Isolde", "Garrett"], last: ["Ashford", "Vell", "Harrowgate", "Blackwood"] },
};

function nameFamily(raceId: string): keyof typeof NAME_PARTS {
  if (raceId.includes("dwarf")) return "dwarf";
  if (raceId.includes("halfling")) return "halfling";
  if (raceId.includes("gnome")) return "gnome";
  if (raceId === "dragonborn") return "dragonborn";
  if (raceId === "tiefling") return "tiefling";
  if (raceId === "half_orc") return "orc";
  if (raceId.includes("elf")) return "elf";
  return "human";
}

function suggestName(raceId: string, previous: string): string {
  const parts = NAME_PARTS[nameFamily(raceId)]!;
  for (let i = 0; i < 6; i += 1) {
    const first = parts.first[Math.floor(Math.random() * parts.first.length)]!;
    const last = parts.last[Math.floor(Math.random() * parts.last.length)]!;
    const name = `${first} ${last}`;
    if (name !== previous) return name;
  }
  return previous;
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const ABILITIES: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_LABEL: Record<AbilityKey, string> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

/** Where each class wants its best scores, highest first. */
const PRIORITY: Record<string, AbilityKey[]> = {
  barbarian: ["str", "con", "dex", "wis", "cha", "int"],
  bard: ["cha", "dex", "con", "wis", "int", "str"],
  cleric: ["wis", "con", "str", "dex", "cha", "int"],
  druid: ["wis", "con", "dex", "int", "cha", "str"],
  fighter: ["str", "con", "dex", "wis", "cha", "int"],
  monk: ["dex", "wis", "con", "str", "int", "cha"],
  paladin: ["str", "cha", "con", "wis", "dex", "int"],
  ranger: ["dex", "wis", "con", "str", "int", "cha"],
  rogue: ["dex", "con", "int", "wis", "cha", "str"],
  sorcerer: ["cha", "con", "dex", "wis", "int", "str"],
  warlock: ["cha", "con", "dex", "wis", "int", "str"],
  wizard: ["int", "con", "dex", "wis", "cha", "str"],
};

export function defaultDraft(cat: ChargenCatalog): DraftState {
  const race = cat.races[0]!;
  const cls = cat.classes.find((c) => c.id === "fighter") ?? cat.classes[0]!;
  const bg = cat.backgrounds[0]!;
  const base: Record<AbilityKey, number> = {
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0,
  };
  return {
    step: 0,
    name: "",
    level: 3,
    raceId: race.id,
    classId: cls.id,
    backgroundId: bg.id,
    method: "standard_array",
    baseAbilities: base,
    flexibleAbilityBonuses: [],
    classSkills: [],
    raceSkills: [],
    fightingStyle: cls.fightingStyleOptions?.[0] ?? "defense",
    domain: cls.domains?.[0]?.id ?? "life",
    cantrips: [],
    spellsKnown: [],
    rolledPool: [],
    portraitId: null,
  };
}

function mod(score: number) {
  return Math.floor((score - 10) / 2);
}

function finalAbilities(d: DraftState, cat: ChargenCatalog) {
  const race = cat.races.find((r) => r.id === d.raceId)!;
  const out = { ...d.baseAbilities };
  for (const [k, v] of Object.entries(race.abilityBonuses)) {
    out[k as AbilityKey] += v ?? 0;
  }
  for (const a of d.flexibleAbilityBonuses) out[a] += 1;
  return out;
}

function pointBuySpent(d: DraftState, cat: ChargenCatalog) {
  return ABILITIES.reduce(
    (sum, a) => sum + (cat.pointBuy.costs[String(d.baseAbilities[a])] ?? 99),
    0,
  );
}

function previewHpAc(d: DraftState, cat: ChargenCatalog) {
  const cls = cat.classes.find((c) => c.id === d.classId)!;
  const race = cat.races.find((r) => r.id === d.raceId)!;
  const abs = finalAbilities(d, cat);
  const con = mod(abs.con);
  const racial = race.hpBonusPerLevel;
  const avg = Math.floor(cls.hitDie / 2) + 1;
  let hp = cls.hitDie + con + racial;
  for (let l = 2; l <= d.level; l += 1) hp += avg + con + racial;
  let ac = 10 + mod(abs.dex);
  if (cls.id === "barbarian") ac = 10 + mod(abs.dex) + mod(abs.con);
  else if (cls.id === "monk") ac = 10 + mod(abs.dex) + mod(abs.wis);
  else if (cls.armor === "leather") ac = 11 + mod(abs.dex);
  else if (cls.armor === "hide") ac = 12 + Math.min(mod(abs.dex), 2);
  else if (cls.armor === "scale_mail") ac = 14 + Math.min(mod(abs.dex), 2);
  else if (cls.armor === "chain_mail") {
    ac = abs.str >= 13 ? 16 : 11 + mod(abs.dex);
  }
  if (cls.shield) ac += 2;
  if (d.fightingStyle === "defense" && cls.armor !== "none") ac += 1;
  return { hp, ac, abs, cls, race };
}

const STEPS = [
  "Level",
  "Race",
  "Class",
  "Background",
  "Abilities",
  "Skills",
  "Class options",
  "Name & review",
];

export function mountChargen(opts: {
  root: HTMLElement;
  catalog: ChargenCatalog;
  portraits: PortraitOption[];
  send: (obj: Record<string, unknown>) => void;
  onCreated: (id: string) => void;
}): {
  destroy: () => void;
  open: () => void;
  close: () => void;
  /** Back on the remote: one step back, or close from the first step. */
  back: () => void;
  isOpen: () => boolean;
  refresh: (cat: ChargenCatalog) => void;
  applyRolls: (scores: number[]) => void;
  onCreatedClose: () => void;
  /** The server refused the draft; its message arrives as a toast, the form unlocks. */
  failed: () => void;
} {
  let cat = opts.catalog;
  let draft = defaultDraft(cat);
  let open = false;
  let armed: number | null = null;
  let error = "";
  let submitting = false;
  let returnFocus: HTMLElement | null = null;

  const panel = document.createElement("section");
  panel.className = "chargen-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "cgTitle");
  panel.hidden = true;
  panel.innerHTML = `
    <div class="chargen-frame">
      <header class="chargen-head">
        <div>
          <p class="kicker">Forge a hero</p>
          <h2 id="cgTitle">A new name for the tavern ledger</h2>
          <p class="meta" id="cgSource">${escHtml(cat.source)}</p>
        </div>
        <button type="button" class="ghost" id="cgClose" aria-label="Close the hero forge">Close</button>
      </header>
      <div id="cgBody"></div>
    </div>
  `;
  opts.root.appendChild(panel);

  const body = () => panel.querySelector("#cgBody") as HTMLElement;
  panel.querySelector("#cgClose")!.addEventListener("click", () => setOpen(false));

  function setOpen(v: boolean) {
    if (open === v) return;
    open = v;
    panel.classList.toggle("is-open", open);
    if (open) {
      returnFocus = document.activeElement as HTMLElement | null;
      document.body.appendChild(panel);
      panel.hidden = false;
      error = "";
      render();
    } else {
      panel.hidden = true;
      opts.root.appendChild(panel);
      returnFocus?.focus?.({ preventScroll: true });
      returnFocus = null;
    }
  }

  function currentPortrait(): string {
    return draft.portraitId ?? suggestedPortrait(draft.raceId, draft.classId);
  }

  function portraitUrl(id: string): string {
    return opts.portraits.find((p) => p.id === id)?.url ?? `/art/portraits/${id}.webp`;
  }

  function scoresReady() {
    return ABILITIES.every((a) => draft.baseAbilities[a] >= 3);
  }

  function unusedScores(): number[] {
    const bag =
      draft.method === "roll"
        ? [...draft.rolledPool]
        : [...cat.standardArray];
    if (draft.method === "point_buy") return [];
    for (const a of ABILITIES) {
      const v = draft.baseAbilities[a];
      const i = bag.indexOf(v);
      if (i >= 0) bag.splice(i, 1);
    }
    return bag;
  }

  function liveSheet() {
    const { hp, ac, abs, cls, race } = previewHpAc(draft, cat);
    const ready = scoresReady();
    const features = Object.entries(cls.featuresByLevel)
      .filter(([lvl]) => Number(lvl) <= draft.level)
      .flatMap(([, list]) => list)
      .map((f) => f.replace(/_/g, " "));
    const mods = ABILITIES.map((a) => {
      const score = ready ? abs[a] : null;
      const m = score == null ? "—" : `${score} (${mod(score) >= 0 ? "+" : ""}${mod(score)})`;
      return `<div class="cg-mod"><span>${ABIL_LABEL[a]}</span><strong>${m}</strong></div>`;
    }).join("");
    return `
      <img class="cg-live-portrait" src="${escHtml(portraitUrl(currentPortrait()))}" alt="" />
      <p class="cg-kicker">Sheet · SRD 5.1</p>
      <h3>${escHtml(draft.name.trim() || "Unnamed")}</h3>
      <p class="meta">${race.label} ${cls.label} ${draft.level}</p>
      <p class="cg-vitals"><span>HP ${ready ? hp : "—"}</span><span>AC ${ready ? ac : "—"}</span><span>${race.speedCells * 5} ft</span></p>
      <div class="cg-mods">${mods}</div>
      <p class="meta">Hit die d${cls.hitDie} · saves ${cls.savingThrows.map((s) => s.toUpperCase()).join(", ")} · prof +2</p>
      <p class="meta">${features.join(" · ") || "—"}</p>
    `;
  }

  function render() {
    const el = body();
    const { hp, ac, abs, cls, race } = previewHpAc(draft, cat);
    const stepTitle = STEPS[draft.step] ?? "";
    let content = "";

    if (draft.step === 0) {
      content += `<div class="cg-grid">
        ${[1, 2, 3]
          .map(
            (l) => `<button type="button" class="cg-pick ${draft.level === l ? "selected" : ""}" data-level="${l}">
            Level ${l}<br/><span class="meta">Proficiency +2 · full features through ${l}</span>
          </button>`,
          )
          .join("")}
      </div>`;
    } else if (draft.step === 1) {
      content += `<div class="cg-grid">
        ${cat.races
          .map((r) => {
            const bonuses = Object.entries(r.abilityBonuses)
              .map(([k, v]) => `+${v} ${k.toUpperCase()}`)
              .join(", ");
            const flex = r.flexibleBonuses
              ? ` · +1 to ${r.flexibleBonuses} other abilities`
              : "";
            return `<button type="button" class="cg-pick ${draft.raceId === r.id ? "selected" : ""}" data-race="${r.id}">
              <strong>${r.label}</strong><br/>
              <span class="meta">${bonuses}${flex} · speed ${r.speedCells * 5} ft</span>
            </button>`;
          })
          .join("")}
      </div>`;
      if (race.flexibleBonuses > 0) {
        content += `<p class="meta">Pick ${race.flexibleBonuses} ability +1 (Half-Elf):</p><div class="row">`;
        const fixed = new Set(Object.keys(race.abilityBonuses));
        for (const a of ABILITIES) {
          if (fixed.has(a)) continue;
          const on = draft.flexibleAbilityBonuses.includes(a);
          content += `<button type="button" class="cg-chip ${on ? "selected" : ""}" data-flex="${a}">${ABIL_LABEL[a]}</button>`;
        }
        content += `</div>`;
      }
    } else if (draft.step === 2) {
      content += `<div class="cg-grid">
        ${cat.classes
          .map(
            (c) => `<button type="button" class="cg-pick ${draft.classId === c.id ? "selected" : ""}" data-class="${c.id}">
              <strong>${c.label}</strong> <span class="meta">d${c.hitDie}</span><br/>
              <span class="meta">Saves ${c.savingThrows.map((s) => s.toUpperCase()).join("/")} · ${c.skillChoices} skills${c.spellcasting ? ` · ${c.spellcasting} caster` : ""}</span>
            </button>`,
          )
          .join("")}
      </div>`;
    } else if (draft.step === 3) {
      content += `<div class="cg-grid">
        ${cat.backgrounds
          .map(
            (b) => `<button type="button" class="cg-pick ${draft.backgroundId === b.id ? "selected" : ""}" data-bg="${b.id}">
              <strong>${b.label}</strong><br/>
              <span class="meta">${b.skills.map((s) => cat.skills[s]?.label ?? s).join(", ")}</span>
            </button>`,
          )
          .join("")}
      </div>`;
    } else if (draft.step === 4) {
      const canAuto = draft.method !== "roll" || draft.rolledPool.length === 6;
      content += `<div class="row">
        ${cat.methods
          .map(
            (m) => `<button type="button" class="cg-chip ${draft.method === m.id ? "selected" : ""}" data-method="${m.id}">${m.label}</button>`,
          )
          .join("")}
      </div>
      <p class="meta">${cat.methods.find((m) => m.id === draft.method)?.hint ?? ""}</p>
      ${canAuto ? `<div class="row"><button type="button" class="ghost" id="cgAuto">✦ Recommended for ${escHtml(cls.label)}</button><span class="meta">Best score to ${PRIORITY[cls.id]?.[0]?.toUpperCase() ?? "the key ability"}, then down the list.</span></div>` : ""}`;
      if (draft.method === "point_buy") {
        const spent = pointBuySpent(draft, cat);
        const left = cat.pointBuy.budget - spent;
        content += `<p class="cg-budget">Points left <strong>${left}</strong> / ${cat.pointBuy.budget}</p>`;
        content += `<div class="cg-abilities">`;
        for (const a of ABILITIES) {
          const base = draft.baseAbilities[a];
          const final = abs[a];
          content += `<div class="cg-abil">
            <span>${ABIL_LABEL[a]}</span>
            <button type="button" data-pb="${a}" data-dir="-1" aria-label="Lower ${ABIL_LABEL[a]}">−</button>
            <strong>${base}</strong>
            <button type="button" data-pb="${a}" data-dir="1" aria-label="Raise ${ABIL_LABEL[a]}">+</button>
            <span class="meta">→ ${final} (${mod(final) >= 0 ? "+" : ""}${mod(final)})</span>
          </div>`;
        }
        content += `</div><p class="meta">Scores stay between 8 and 15 before racial bonuses. Racial bonuses are already in the arrow.</p>`;
      } else {
        if (draft.method === "roll") {
          content += `<div class="row"><button type="button" class="primary" id="cgRoll">Roll 4d6, drop lowest</button>
            <span class="meta">${draft.rolledPool.length ? "Server pool is law. Assign each roll once." : "The server rolls. You only assign."}</span></div>`;
        }
        const pool = unusedScores();
        content += `<div class="score-pool" aria-label="Unassigned scores">
          ${pool.length ? pool.map((v, i) => `<button type="button" class="score-chip ${armed === v ? "selected" : ""}" data-arm="${v}" data-arm-i="${i}">${v}</button>`).join("") : `<span class="meta">${draft.method === "roll" && !draft.rolledPool.length ? "Six rolled scores will land here." : "Every score is assigned."}</span>`}
        </div>`;
        content += `<div class="cg-abilities">`;
        for (const a of ABILITIES) {
          const base = draft.baseAbilities[a];
          const final = base >= 3 ? abs[a] : null;
          const shown = final == null ? "—" : `${final} (${mod(final) >= 0 ? "+" : ""}${mod(final)})`;
          content += `<button type="button" class="cg-abil cg-slot" data-slot="${a}" ${base >= 3 ? "" : "data-empty"}>
            <span>${ABIL_LABEL[a]}</span>
            <strong>${base >= 3 ? base : "·"}</strong>
            <span class="meta">→ ${shown}</span>
          </button>`;
        }
        content += `</div>`;
        content += `<p class="meta">${draft.method === "roll" ? "Pick a rolled number, then the ability that keeps it. Pick an assigned ability to lift it back." : "Pick 15, 14, 13, 12, 10 and 8 once each, then the ability that keeps it. Pick an assigned ability to lift it back."}</p>`;
      }
    } else if (draft.step === 5) {
      const bg = cat.backgrounds.find((b) => b.id === draft.backgroundId)!;
      const locked = new Set(bg.skills);
      content += `<p class="meta">Background already grants <strong>${bg.skills.map((s) => cat.skills[s]?.label ?? s).join(", ")}</strong>. Those cannot be picked again.</p>`;
      content += `<p class="meta">Class skills <strong>${draft.classSkills.length}/${cls.skillChoices}</strong></p><div class="cg-skills">`;
      for (const s of cls.skillList) {
        const disabled = locked.has(s);
        const on = draft.classSkills.includes(s);
        content += `<button type="button" class="cg-chip ${on ? "selected" : ""}" data-skill="${s}" ${disabled ? "disabled" : ""}>
          ${cat.skills[s]?.label ?? s}${disabled ? " (bg)" : ""}
        </button>`;
      }
      content += `</div>`;
      if (race.extraSkills > 0) {
        content += `<p class="meta">Race: pick ${race.extraSkills} more skills (${draft.raceSkills.length}):</p><div class="cg-skills">`;
        for (const [sid, sk] of Object.entries(cat.skills)) {
          const taken = locked.has(sid) || draft.classSkills.includes(sid);
          const on = draft.raceSkills.includes(sid);
          content += `<button type="button" class="cg-chip ${on ? "selected" : ""}" data-rskill="${sid}" ${taken && !on ? "disabled" : ""}>${sk.label}</button>`;
        }
        content += `</div>`;
      }
    } else if (draft.step === 6) {
      const needsStyle =
        cls.fightingStyleRequired ||
        (cls.fightingStyleAt != null && draft.level >= cls.fightingStyleAt);
      if (needsStyle && cls.fightingStyleOptions) {
        content += `<p class="meta">Fighting Style</p><div class="cg-grid">`;
        for (const id of cls.fightingStyleOptions) {
          const fs = cat.fightingStyles.find((f) => f.id === id)!;
          content += `<button type="button" class="cg-pick ${draft.fightingStyle === id ? "selected" : ""}" data-fs="${id}">
            <strong>${fs.label}</strong><br/><span class="meta">${fs.desc}</span>
          </button>`;
        }
        content += `</div>`;
      }
      if (cls.domains?.length) {
        content += `<p class="meta">Divine Domain</p><div class="row">`;
        for (const dom of cls.domains) {
          content += `<button type="button" class="cg-chip ${draft.domain === dom.id ? "selected" : ""}" data-domain="${dom.id}">${dom.label}</button>`;
        }
        content += `</div>`;
      }
      if (cls.cantripsKnown && cls.spellLists) {
        const need = Math.min(
          cls.cantripsKnown[String(draft.level)] ?? 0,
          cls.spellLists.cantrips.length,
        );
        content += `<p class="meta">Cantrips (${draft.cantrips.length}/${need})</p><div class="cg-skills">`;
        for (const cid of cls.spellLists.cantrips) {
          const on = draft.cantrips.includes(cid);
          content += `<button type="button" class="cg-chip ${on ? "selected" : ""}" data-cantrip="${cid}">${cat.spellCatalog[cid]?.label ?? cid}</button>`;
        }
        content += `</div>`;
      }
      if (cls.spellsKnown && cls.spellLists) {
        const pool = [
          ...(cls.spellLists["1"] ?? []),
          ...(draft.level >= 3 ? cls.spellLists["2"] ?? [] : []),
        ];
        const need = Math.min(
          cls.spellsKnown[String(draft.level)] ?? 0,
          pool.length,
        );
        if (need > 0) {
          content += `<p class="meta">Spells known (${draft.spellsKnown.length}/${need})</p><div class="cg-skills">`;
          for (const sid of pool) {
            const on = draft.spellsKnown.includes(sid);
            content += `<button type="button" class="cg-chip ${on ? "selected" : ""}" data-spell="${sid}">${cat.spellCatalog[sid]?.label ?? sid}</button>`;
          }
          content += `</div>`;
        }
      }
      if (cls.preparedFormula && !cls.spellsKnown && cls.spellLists) {
        const pool = [
          ...(cls.spellLists["1"] ?? []),
          ...(draft.level >= 3 ? cls.spellLists["2"] ?? [] : []),
        ];
        const ability = (cls.spellAbility ?? "int") as AbilityKey;
        const race = cat.races.find((r) => r.id === draft.raceId);
        const score = (draft.baseAbilities[ability] ?? 10) + (race?.abilityBonuses[ability] ?? 0);
        const mod = Math.floor((score - 10) / 2);
        const raw = cls.preparedFormula.includes("half") ? mod + Math.floor(draft.level / 2) : mod + draft.level;
        const need = Math.max(1, Math.min(raw, pool.length));
        content += `<p class="meta">Prepared spells (${draft.spellsKnown.length}/${need})</p><div class="cg-skills">`;
        for (const sid of pool) {
          const on = draft.spellsKnown.includes(sid);
          content += `<button type="button" class="cg-chip ${on ? "selected" : ""}" data-spell="${sid}">${cat.spellCatalog[sid]?.label ?? sid}</button>`;
        }
        content += `</div>`;
      }
      if (
        !needsStyle &&
        !cls.domains?.length &&
        !cls.cantripsKnown &&
        !cls.preparedFormula &&
        !(cls.spellsKnown && (cls.spellsKnown[String(draft.level)] ?? 0) > 0)
      ) {
        content += `<p class="meta">No extra choices at this level — features unlock automatically.</p>
          <ul class="meta">${Object.entries(cls.featuresByLevel)
            .filter(([l]) => Number(l) <= draft.level)
            .flatMap(([, feats]) => feats)
            .map((f) => `<li>${f.replace(/_/g, " ")}</li>`)
            .join("")}</ul>`;
      }
    } else {
      const chosen = currentPortrait();
      content += `
        <div class="row cg-name-row">
          <input id="cgName" placeholder="Character name" maxlength="40" autocomplete="off" spellcheck="false" value="${escHtml(draft.name)}" />
          <button type="button" id="cgSuggest">Suggest a name</button>
        </div>
        <p class="meta">Portrait${draft.portraitId ? "" : " · suggested for this lineage"}</p>
        <div class="cg-portraits" role="radiogroup" aria-label="Portrait">
          ${opts.portraits
            .map(
              (p) => `<button type="button" class="cg-portrait ${p.id === chosen ? "selected" : ""}" data-portrait="${escHtml(p.id)}" role="radio" aria-checked="${p.id === chosen}" aria-label="Portrait ${escHtml(p.id.replace(/^cg_/, "").replace(/_/g, " "))}">
                <img src="${escHtml(p.url)}" alt="" loading="lazy" />
              </button>`,
            )
            .join("")}
        </div>
        <div class="cg-review">
          <p><strong id="cgReviewName">${escHtml(draft.name || "Unnamed")}</strong> — ${race.label} ${cls.label} ${draft.level}</p>
          <p class="meta">HP ${hp} · AC ${ac} · Speed ${race.speedCells * 5} ft · Prof +2</p>
          <p class="meta">${ABILITIES.map((a) => `${ABIL_LABEL[a]} ${abs[a]}`).join(" · ")}</p>
          <p class="meta">Skills: ${[...new Set([
            ...(cat.backgrounds.find((b) => b.id === draft.backgroundId)?.skills ?? []),
            ...draft.classSkills,
            ...draft.raceSkills,
          ])]
            .map((s) => cat.skills[s]?.label ?? s)
            .join(", ")}</p>
        </div>
        <button type="button" class="primary" id="cgSubmit" ${submitting ? "disabled" : ""}>${submitting ? "Forging…" : "Create character"}</button>
      `;
    }

    content += `<p class="cg-error" id="cgError" role="alert">${escHtml(error)}</p>`;
    content += `<div class="row cg-nav">
      <button type="button" id="cgBack">${draft.step === 0 ? "Cancel" : "Back"}</button>
      <button type="button" class="primary" id="cgNext" ${draft.step >= STEPS.length - 1 ? "hidden" : ""}>Next</button>
    </div>`;

    el.innerHTML = `
      <div class="cg-layout">
        <div class="cg-main">
          <div class="cg-steps">${STEPS.map((s, i) =>
            `<span class="${i === draft.step ? "on" : i < draft.step ? "done" : ""}">${i + 1}. ${s}</span>`,
          ).join("")}</div>
          <h3 class="cg-step-title">${stepTitle}</h3>
          ${content}
        </div>
        <aside class="cg-live">${liveSheet()}</aside>
      </div>
    `;
    wire(el);
    const first =
      el.querySelector<HTMLElement>(".cg-main .selected:not([disabled])") ??
      el.querySelector<HTMLElement>(".cg-main button:not([disabled]):not(#cgBack), .cg-main input");
    first?.setAttribute("data-autofocus", "");
    if (focusSel) {
      const sel = focusSel;
      focusSel = null;
      focusStep = false;
      (el.querySelector<HTMLElement>(sel) ?? el.querySelector<HTMLElement>("#cgNext:not([hidden])"))?.focus({ preventScroll: true });
    } else if (focusStep) {
      focusStep = false;
      (first ?? el.querySelector<HTMLElement>("#cgNext"))?.focus({ preventScroll: true });
    }
    if (error) el.querySelector("#cgError")?.scrollIntoView({ block: "nearest" });
  }

  let focusStep = false;
  /** Where OK should land after this pick, so the remote flows through the form. */
  let focusSel: string | null = null;

  function goStep(step: number) {
    draft.step = Math.max(0, Math.min(STEPS.length - 1, step));
    if (draft.step === 6) {
      autoPickSpells();
      focusSel = "#cgNext:not([hidden])";
    }
    if (draft.step === 7 && !draft.name.trim()) focusSel = "#cgSuggest";
    error = "";
    focusStep = true;
    el0().scrollTop = 0;
    render();
  }

  const el0 = () => panel.querySelector(".chargen-frame") as HTMLElement;

  function toggleMulti(
    list: string[],
    id: string,
    max: number,
  ): string[] {
    if (list.includes(id)) return list.filter((x) => x !== id);
    if (list.length >= max) return [...list.slice(1), id];
    return [...list, id];
  }

  function wire(el: HTMLElement) {
    el.querySelector("#cgBack")?.addEventListener("click", () => stepBack());
    el.querySelector("#cgNext")?.addEventListener("click", () => {
      if (!validateStep()) return;
      goStep(draft.step + 1);
    });
    el.querySelector("#cgSuggest")?.addEventListener("click", () => {
      draft.name = suggestName(draft.raceId, draft.name);
      error = "";
      render();
    });
    el.querySelectorAll("[data-portrait]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.portraitId = (b as HTMLElement).dataset.portrait!;
        render();
      }),
    );
    el.querySelectorAll("[data-level]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.level = Number((b as HTMLElement).dataset.level) as 1 | 2 | 3;
        focusSel = "#cgNext:not([hidden])";
        render();
      }),
    );
    el.querySelectorAll("[data-race]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.raceId = (b as HTMLElement).dataset.race!;
        draft.flexibleAbilityBonuses = [];
        focusSel = cat.races.find((r) => r.id === draft.raceId)?.flexibleBonuses ? "[data-flex]" : "#cgNext:not([hidden])";
        render();
      }),
    );
    el.querySelectorAll("[data-flex]").forEach((b) =>
      b.addEventListener("click", () => {
        const a = (b as HTMLElement).dataset.flex as AbilityKey;
        const race = cat.races.find((r) => r.id === draft.raceId)!;
        draft.flexibleAbilityBonuses = toggleMulti(
          draft.flexibleAbilityBonuses,
          a,
          race.flexibleBonuses,
        ) as AbilityKey[];
        render();
      }),
    );
    el.querySelectorAll("[data-class]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.classId = (b as HTMLElement).dataset.class!;
        focusSel = "#cgNext:not([hidden])";
        const cls = cat.classes.find((c) => c.id === draft.classId)!;
        draft.fightingStyle = cls.fightingStyleOptions?.[0] ?? "";
        draft.domain = cls.domains?.[0]?.id ?? "";
        draft.classSkills = [];
        draft.cantrips = [];
        draft.spellsKnown = [];
        render();
      }),
    );
    el.querySelectorAll("[data-bg]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.backgroundId = (b as HTMLElement).dataset.bg!;
        focusSel = "#cgNext:not([hidden])";
        draft.classSkills = [];
        draft.raceSkills = [];
        render();
      }),
    );
    el.querySelectorAll("[data-method]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.method = (b as HTMLElement).dataset.method as DraftState["method"];
        armed = null;
        const fill = draft.method === "point_buy" ? 8 : 0;
        draft.baseAbilities = {
          str: fill,
          dex: fill,
          con: fill,
          int: fill,
          wis: fill,
          cha: fill,
        };
        error = "";
        focusSel = draft.method === "roll" && !draft.rolledPool.length ? "#cgRoll" : "#cgAuto";
        render();
      }),
    );
    el.querySelector("#cgAuto")?.addEventListener("click", () => {
      const order = PRIORITY[draft.classId] ?? ABILITIES;
      const values =
        draft.method === "roll" ? [...draft.rolledPool] : [...cat.standardArray];
      values.sort((a, b) => b - a);
      order.forEach((a, i) => (draft.baseAbilities[a] = values[i] ?? 8));
      armed = null;
      error = "";
      focusSel = "#cgNext:not([hidden])";
      render();
    });
    el.querySelector("#cgRoll")?.addEventListener("click", () => {
      opts.send({ action: "ROLL_ABILITIES" });
    });
    el.querySelectorAll("[data-arm]").forEach((b) =>
      b.addEventListener("click", () => {
        armed = Number((b as HTMLElement).dataset.arm);
        focusSel = "[data-slot][data-empty]";
        error = "";
        render();
      }),
    );
    el.querySelectorAll("[data-slot]").forEach((b) =>
      b.addEventListener("click", () => {
        const a = (b as HTMLElement).dataset.slot as AbilityKey;
        if (armed == null) {
          if (draft.baseAbilities[a] >= 3) {
            armed = draft.baseAbilities[a];
            draft.baseAbilities[a] = 0;
          }
        } else {
          draft.baseAbilities[a] = armed;
          armed = null;
          focusSel = "[data-arm]";
        }
        error = "";
        render();
      }),
    );
    el.querySelectorAll("[data-pb]").forEach((b) =>
      b.addEventListener("click", () => {
        const a = (b as HTMLElement).dataset.pb as AbilityKey;
        const dir = Number((b as HTMLElement).dataset.dir);
        const cur = draft.baseAbilities[a];
        const next = cur + dir;
        if (next < cat.pointBuy.min || next > cat.pointBuy.max) {
          error = "Point buy stays between 8 and 15 before racial bonuses.";
          render();
          return;
        }
        const nextCost = cat.pointBuy.costs[String(next)];
        const curCost = cat.pointBuy.costs[String(cur)] ?? 0;
        if (nextCost === undefined) return;
        const spent = pointBuySpent(draft, cat) - curCost + nextCost;
        if (spent > cat.pointBuy.budget) {
          error = "Not enough points left for that raise.";
          render();
          return;
        }
        draft.baseAbilities[a] = next;
        error = "";
        render();
      }),
    );
    el.querySelectorAll("[data-skill]").forEach((b) =>
      b.addEventListener("click", () => {
        const cls = cat.classes.find((c) => c.id === draft.classId)!;
        const id = (b as HTMLElement).dataset.skill!;
        const had = draft.classSkills.length;
        draft.classSkills = toggleMulti(draft.classSkills, id, cls.skillChoices);
        const race = cat.races.find((r) => r.id === draft.raceId)!;
        if (had < cls.skillChoices && draft.classSkills.length === cls.skillChoices) {
          focusSel = race.extraSkills > draft.raceSkills.length ? "[data-rskill]:not([disabled])" : "#cgNext:not([hidden])";
        }
        render();
      }),
    );
    el.querySelectorAll("[data-rskill]").forEach((b) =>
      b.addEventListener("click", () => {
        const race = cat.races.find((r) => r.id === draft.raceId)!;
        const id = (b as HTMLElement).dataset.rskill!;
        const had = draft.raceSkills.length;
        draft.raceSkills = toggleMulti(draft.raceSkills, id, race.extraSkills);
        if (had < race.extraSkills && draft.raceSkills.length === race.extraSkills) focusSel = "#cgNext:not([hidden])";
        render();
      }),
    );
    el.querySelectorAll("[data-fs]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.fightingStyle = (b as HTMLElement).dataset.fs!;
        focusSel = "#cgNext:not([hidden])";
        render();
      }),
    );
    el.querySelectorAll("[data-domain]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.domain = (b as HTMLElement).dataset.domain!;
        render();
      }),
    );
    el.querySelectorAll("[data-cantrip]").forEach((b) =>
      b.addEventListener("click", () => {
        const cls = cat.classes.find((c) => c.id === draft.classId)!;
        const need = Math.min(
          cls.cantripsKnown?.[String(draft.level)] ?? 0,
          cls.spellLists?.cantrips.length ?? 0,
        );
        const id = (b as HTMLElement).dataset.cantrip!;
        draft.cantrips = toggleMulti(draft.cantrips, id, need);
        render();
      }),
    );
    el.querySelectorAll("[data-spell]").forEach((b) =>
      b.addEventListener("click", () => {
        const cls = cat.classes.find((c) => c.id === draft.classId)!;
        const poolLen =
          (cls.spellLists?.["1"]?.length ?? 0) +
          (draft.level >= 3 ? cls.spellLists?.["2"]?.length ?? 0 : 0);
        const prepared = preparedCount(cls);
        const need = prepared || Math.min(cls.spellsKnown?.[String(draft.level)] ?? 0, poolLen);
        const id = (b as HTMLElement).dataset.spell!;
        draft.spellsKnown = toggleMulti(draft.spellsKnown, id, need);
        render();
      }),
    );
    el.querySelector("#cgName")?.addEventListener("input", (e) => {
      draft.name = (e.target as HTMLInputElement).value;
      const shown = draft.name.trim() || "Unnamed";
      const live = el.querySelector(".cg-live h3");
      if (live) live.textContent = shown;
      const review = el.querySelector("#cgReviewName");
      if (review) review.textContent = shown;
    });
    el.querySelector("#cgName")?.addEventListener("keydown", (e) => {
      const k = e as KeyboardEvent;
      if (k.key === "Enter") {
        k.preventDefault();
        k.stopPropagation();
        el.querySelector<HTMLElement>("#cgSubmit")?.focus();
      }
    });
    el.querySelector("#cgSubmit")?.addEventListener("click", () => {
      if (submitting) return;
      draft.name = (el.querySelector("#cgName") as HTMLInputElement)?.value?.trim() || draft.name.trim();
      if (!validateStep()) return;
      submitting = true;
      window.setTimeout(() => {
        if (!submitting) return;
        submitting = false;
        if (open) render();
      }, 4000);
      render();
      opts.send({
        action: "CREATE_CHARACTER",
        draft: {
          name: draft.name,
          level: draft.level,
          raceId: draft.raceId,
          classId: draft.classId,
          backgroundId: draft.backgroundId,
          method: draft.method,
          baseAbilities: draft.baseAbilities,
          flexibleAbilityBonuses: draft.flexibleAbilityBonuses,
          classSkills: draft.classSkills,
          raceSkills: draft.raceSkills,
          fightingStyle: draft.fightingStyle || undefined,
          domain: draft.domain || undefined,
          cantrips: draft.cantrips,
          spellsKnown: draft.spellsKnown,
          hpMethod: "average",
          portraitId: currentPortrait(),
        },
      });
    });
  }

  function autoPickSpells() {
    const cls = cat.classes.find((c) => c.id === draft.classId)!;
    if (cls.cantripsKnown && cls.spellLists && draft.cantrips.length === 0) {
      const need = Math.min(
        cls.cantripsKnown[String(draft.level)] ?? 0,
        cls.spellLists.cantrips.length,
      );
      draft.cantrips = cls.spellLists.cantrips.slice(0, need);
    }
    if (cls.spellsKnown && cls.spellLists && draft.spellsKnown.length === 0) {
      const pool = [
        ...(cls.spellLists["1"] ?? []),
        ...(draft.level >= 3 ? cls.spellLists["2"] ?? [] : []),
      ];
      const need = Math.min(cls.spellsKnown[String(draft.level)] ?? 0, pool.length);
      if (need > 0) draft.spellsKnown = pool.slice(0, need);
    }
    if (cls.preparedFormula && !cls.spellsKnown && cls.spellLists && draft.spellsKnown.length === 0) {
      const pool = [
        ...(cls.spellLists["1"] ?? []),
        ...(draft.level >= 3 ? cls.spellLists["2"] ?? [] : []),
      ];
      const need = Math.min(preparedCount(cls), pool.length);
      if (need > 0) draft.spellsKnown = pool.slice(0, need);
    }
  }

  function preparedCount(cls: ChargenCatalog["classes"][number]): number {
    if (!cls.preparedFormula) return 0;
    const ability = (cls.spellAbility ?? "int") as AbilityKey;
    const race = cat.races.find((r) => r.id === draft.raceId);
    const score = (draft.baseAbilities[ability] ?? 10) + (race?.abilityBonuses[ability] ?? 0);
    const mod = Math.floor((score - 10) / 2);
    const raw = cls.preparedFormula.includes("half") ? mod + Math.floor(draft.level / 2) : mod + draft.level;
    const poolLen =
      (cls.spellLists?.["1"]?.length ?? 0) + (draft.level >= 3 ? cls.spellLists?.["2"]?.length ?? 0 : 0);
    return Math.max(1, Math.min(raw, poolLen || raw));
  }

  function fail(msg: string): boolean {
    error = msg;
    render();
    return false;
  }

  function validateStep(): boolean {
    const race = cat.races.find((r) => r.id === draft.raceId)!;
    const cls = cat.classes.find((c) => c.id === draft.classId)!;
    if (draft.step === 1 && race.flexibleBonuses > 0) {
      const fixed = new Set(Object.keys(race.abilityBonuses));
      if (draft.flexibleAbilityBonuses.some((a) => fixed.has(a))) {
        return fail("Flexible bonuses go to abilities that do not already have a racial bonus.");
      }
      if (draft.flexibleAbilityBonuses.length !== race.flexibleBonuses) {
        return fail(`Pick ${race.flexibleBonuses} other abilities for +1.`);
      }
    }
    if (draft.step === 4) {
      if (draft.method === "standard_array") {
        const sorted = ABILITIES.map((a) => draft.baseAbilities[a]).sort((a, b) => b - a);
        const expected = [...cat.standardArray].sort((a, b) => b - a);
        if (sorted.join(",") !== expected.join(",")) {
          return fail("Standard array uses 15, 14, 13, 12, 10 and 8 once each.");
        }
      }
      if (draft.method === "point_buy") {
        if (pointBuySpent(draft, cat) > cat.pointBuy.budget) {
          return fail("Point buy is over 27.");
        }
        if (ABILITIES.some((a) => draft.baseAbilities[a] < 8 || draft.baseAbilities[a] > 15)) {
          return fail("Point buy scores stay between 8 and 15.");
        }
      }
      if (draft.method === "roll") {
        if (draft.rolledPool.length !== 6) return fail("Roll on the server first.");
        const sorted = ABILITIES.map((a) => draft.baseAbilities[a]).sort((a, b) => b - a);
        const expected = [...draft.rolledPool].sort((a, b) => b - a);
        if (sorted.join(",") !== expected.join(",")) {
          return fail("Assign each server roll once.");
        }
      }
    }
    if (draft.step === 5) {
      if (draft.classSkills.length !== cls.skillChoices) {
        return fail(`Pick exactly ${cls.skillChoices} class skills, different from the background.`);
      }
      if (draft.raceSkills.length !== race.extraSkills) {
        return fail(`Pick exactly ${race.extraSkills} extra skills from the lineage.`);
      }
    }
    if (draft.step === 6) {
      const needsStyle =
        cls.fightingStyleRequired ||
        (cls.fightingStyleAt != null && draft.level >= cls.fightingStyleAt);
      if (needsStyle && !draft.fightingStyle) {
        return fail("Pick a fighting style.");
      }
      if (cls.domains?.length && !draft.domain) {
        return fail("Pick a domain.");
      }
      if (cls.cantripsKnown) {
        const available = cls.spellLists?.cantrips?.length ?? 0;
        const need = Math.min(
          cls.cantripsKnown[String(draft.level)] ?? 0,
          available,
        );
        if (draft.cantrips.length !== need) {
          return fail(`Pick ${need} cantrips.`);
        }
      }
      if (cls.spellsKnown) {
        const poolLen =
          (cls.spellLists?.["1"]?.length ?? 0) +
          (draft.level >= 3 ? cls.spellLists?.["2"]?.length ?? 0 : 0);
        const need = Math.min(
          cls.spellsKnown[String(draft.level)] ?? 0,
          poolLen,
        );
        if (need > 0 && draft.spellsKnown.length !== need) {
          return fail(`Pick ${need} spells.`);
        }
      }
      if (cls.preparedFormula && !cls.spellsKnown) {
        const need = preparedCount(cls);
        if (draft.spellsKnown.length !== need) return fail(`Prepare ${need} spells.`);
      }
    }
    if (draft.step === 7 && !draft.name.trim()) {
      return fail("The hero needs a name.");
    }
    error = "";
    return true;
  }

  function stepBack() {
    if (draft.step === 0) setOpen(false);
    else goStep(draft.step - 1);
  }

  return {
    destroy: () => panel.remove(),
    open: () => setOpen(true),
    close: () => setOpen(false),
    back: () => stepBack(),
    isOpen: () => open,
    refresh: (c) => {
      cat = c;
      (panel.querySelector("#cgSource") as HTMLElement).textContent = c.source;
      if (open) render();
    },
    applyRolls: (scores: number[]) => {
      draft.rolledPool = scores;
      draft.method = "roll";
      armed = null;
      draft.baseAbilities = {
        str: 0,
        dex: 0,
        con: 0,
        int: 0,
        wis: 0,
        cha: 0,
      };
      error = "";
      focusSel = "#cgAuto";
      if (open) render();
    },
    failed: () => {
      if (!submitting) return;
      submitting = false;
      if (open) render();
    },
    onCreatedClose: () => {
      submitting = false;
      setOpen(false);
      draft = defaultDraft(cat);
    },
  };
}
