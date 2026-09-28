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
};

const ABILITIES: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_LABEL: Record<AbilityKey, string> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
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
    level: 1,
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
  send: (obj: unknown) => void;
  onCreated: (id: string) => void;
}): {
  destroy: () => void;
  refresh: (cat: ChargenCatalog) => void;
  applyRolls: (scores: number[]) => void;
  onCreatedClose: () => void;
} {
  let cat = opts.catalog;
  let draft = defaultDraft(cat);
  let open = false;
  let armed: number | null = null;
  let error = "";

  const panel = document.createElement("section");
  panel.className = "panel chargen-panel";
  panel.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div>
        <h2 style="margin:0;font-size:1.15rem;font-family:Cinzel,serif">Forge a hero</h2>
        <p class="meta" id="cgSource" style="margin:0.25rem 0 0">${cat.source}</p>
      </div>
      <button type="button" class="primary" id="cgToggle">Open creator</button>
    </div>
    <div id="cgBody" hidden></div>
  `;
  opts.root.appendChild(panel);

  const body = () => panel.querySelector("#cgBody") as HTMLElement;
  const toggle = () => panel.querySelector("#cgToggle") as HTMLButtonElement;

  function setOpen(v: boolean) {
    open = v;
    body().hidden = !open;
    panel.classList.toggle("is-open", open);
    toggle().textContent = open ? "Close creator" : "Open creator";
    if (open) {
      document.body.appendChild(panel);
      render();
    } else {
      opts.root.appendChild(panel);
    }
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
      <p class="cg-kicker">Sheet · SRD 5.1</p>
      <h3>${draft.name.trim() || "Unnamed"}</h3>
      <p class="meta">${race.label} ${cls.label} ${draft.level}</p>
      <p class="cg-vitals"><span>HP ${ready ? hp : "—"}</span><span>AC ${ready ? ac : "—"}</span><span>${race.speedCells * 5} ft</span></p>
      <div class="cg-mods">${mods}</div>
      <p class="meta">Hit die d${cls.hitDie} · saves ${cls.savingThrows.map((s) => s.toUpperCase()).join(", ")} · prof +2</p>
      <p class="meta">${features.join(" · ") || "—"}</p>
    `;
  }

  toggle().onclick = () => setOpen(!open);

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
      content += `<div class="row">
        ${cat.methods
          .map(
            (m) => `<button type="button" class="cg-chip ${draft.method === m.id ? "selected" : ""}" data-method="${m.id}">${m.label}</button>`,
          )
          .join("")}
      </div>
      <p class="meta">${cat.methods.find((m) => m.id === draft.method)?.hint ?? ""}</p>`;
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
          ${pool.length ? pool.map((v, i) => `<button type="button" class="score-chip ${armed === v ? "selected" : ""}" data-arm="${v}" data-arm-i="${i}">${v}</button>`).join("") : `<span class="meta">Every score is assigned.</span>`}
        </div>`;
        content += `<div class="cg-abilities">`;
        for (const a of ABILITIES) {
          const base = draft.baseAbilities[a];
          const final = base >= 3 ? abs[a] : null;
          const shown = final == null ? "—" : `${final} (${mod(final) >= 0 ? "+" : ""}${mod(final)})`;
          content += `<button type="button" class="cg-abil cg-slot" data-slot="${a}">
            <span>${ABIL_LABEL[a]}</span>
            <strong>${base >= 3 ? base : "·"}</strong>
            <span class="meta">→ ${shown}</span>
          </button>`;
        }
        content += `</div>`;
        content += `<p class="meta">${draft.method === "roll" ? "Click a rolled number, then the ability that keeps it." : "Click 15, 14, 13, 12, 10, 8 once each, then the ability. Click an assigned ability to lift it back."}</p>`;
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
      if (
        !needsStyle &&
        !cls.domains?.length &&
        !cls.cantripsKnown &&
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
      content += `
        <div class="row">
          <input id="cgName" placeholder="Character name" maxlength="40" value="${draft.name.replace(/"/g, "&quot;")}" style="flex:1;min-width:12rem" />
        </div>
        <div class="cg-review">
          <p><strong id="cgReviewName">${draft.name || "Unnamed"}</strong> — ${race.label} ${cls.label} ${draft.level}</p>
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
        <button type="button" class="primary" id="cgSubmit">Create character</button>
      `;
    }

    content += `<p class="cg-error" id="cgError">${error}</p>`;
    content += `<div class="row cg-nav">
      <button type="button" id="cgBack" ${draft.step === 0 ? "disabled" : ""}>Back</button>
      <button type="button" class="primary" id="cgNext" ${draft.step >= STEPS.length - 1 ? "hidden" : ""}>Next</button>
    </div>`;

    el.innerHTML = `
      <div class="cg-layout">
        <div>
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
  }

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
    el.querySelector("#cgBack")?.addEventListener("click", () => {
      draft.step = Math.max(0, draft.step - 1);
      render();
    });
    el.querySelector("#cgNext")?.addEventListener("click", () => {
      if (!validateStep()) return;
      draft.step = Math.min(STEPS.length - 1, draft.step + 1);
      // auto-fill cantrips/spells defaults when entering options
      if (draft.step === 6) autoPickSpells();
      error = "";
      render();
    });
    el.querySelectorAll("[data-level]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.level = Number((b as HTMLElement).dataset.level) as 1 | 2 | 3;
        render();
      }),
    );
    el.querySelectorAll("[data-race]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.raceId = (b as HTMLElement).dataset.race!;
        draft.flexibleAbilityBonuses = [];
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
        render();
      }),
    );
    el.querySelector("#cgRoll")?.addEventListener("click", () => {
      opts.send({ action: "ROLL_ABILITIES" });
    });
    el.querySelectorAll("[data-arm]").forEach((b) =>
      b.addEventListener("click", () => {
        armed = Number((b as HTMLElement).dataset.arm);
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
        draft.classSkills = toggleMulti(draft.classSkills, id, cls.skillChoices);
        render();
      }),
    );
    el.querySelectorAll("[data-rskill]").forEach((b) =>
      b.addEventListener("click", () => {
        const race = cat.races.find((r) => r.id === draft.raceId)!;
        const id = (b as HTMLElement).dataset.rskill!;
        draft.raceSkills = toggleMulti(draft.raceSkills, id, race.extraSkills);
        render();
      }),
    );
    el.querySelectorAll("[data-fs]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.fightingStyle = (b as HTMLElement).dataset.fs!;
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
        const need = Math.min(
          cls.spellsKnown?.[String(draft.level)] ?? 0,
          poolLen,
        );
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
    el.querySelector("#cgSubmit")?.addEventListener("click", () => {
      draft.name = (el.querySelector("#cgName") as HTMLInputElement)?.value?.trim() || draft.name;
      if (!validateStep()) return;
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
    }
    if (draft.step === 7 && !draft.name.trim()) {
      return fail("The hero needs a name.");
    }
    error = "";
    return true;
  }

  return {
    destroy: () => panel.remove(),
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
      if (open) render();
    },
    onCreatedClose: () => {
      setOpen(false);
      draft = defaultDraft(cat);
    },
  };
}
