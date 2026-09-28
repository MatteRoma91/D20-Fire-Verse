import fs from "node:fs";
import path from "node:path";
import { CONTENT_ROOT, DATA_DIR, readJson } from "./paths.js";
import type { Pregen } from "./campaign.js";

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type ChargenDraft = {
  name: string;
  level: 1 | 2 | 3;
  raceId: string;
  classId: string;
  backgroundId: string;
  /** Scores before racial bonuses (8–15 for array/point buy). */
  baseAbilities: Record<AbilityKey, number>;
  /** For half-elf: which two abilities get +1 (not CHA). */
  flexibleAbilityBonuses?: AbilityKey[];
  /** Class skill picks (not including background auto-skills). */
  classSkills: string[];
  /** Half-elf extra skills. */
  raceSkills?: string[];
  method: "standard_array" | "point_buy" | "roll";
  fightingStyle?: string;
  domain?: string;
  cantrips?: string[];
  spellsKnown?: string[];
  hpMethod?: "average" | "rolled";
  /** Optional rolled HP extras for levels 2+ (hit die rolls, no CON). */
  hpRolls?: number[];
};

type RaceDef = {
  label: string;
  speedCells: number;
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  flexibleBonuses?: number;
  traits: string[];
  hpBonusPerLevel?: number;
  extraSkills?: number;
  extraCantrip?: boolean;
  size: string;
};

type ClassDef = {
  label: string;
  hitDie: number;
  savingThrows: AbilityKey[];
  skillChoices: number;
  skillList: string[];
  armor: string;
  shield: boolean;
  unarmoredDefense?: "barbarian" | "monk";
  spellcasting?: "full" | "half" | "pact";
  spellAbility?: AbilityKey;
  cantripsKnown?: Record<string, number>;
  spellsKnown?: Record<string, number>;
  spellbookAt1?: number;
  spellbookPerLevel?: number;
  preparedFormula?: string;
  domains?: Record<string, { label: string; features: string[]; bonusSpells?: string[] }>;
  spellLists?: { cantrips: string[]; "1": string[]; "2": string[] };
  fightingStyleRequired?: boolean;
  fightingStyleAt?: number;
  fightingStyleOptions?: string[];
  primaryWeapons: string[];
  actionsByLevel: Record<string, string[]>;
  traitsByLevel?: Record<string, string[]>;
  featuresByLevel: Record<string, string[]>;
  inventory: string[];
};

type ChargenData = {
  proficiencyByLevel: Record<string, number>;
  standardArray: number[];
  pointBuy: {
    budget: number;
    min: number;
    max: number;
    costs: Record<string, number>;
  };
  abilities: AbilityKey[];
  skills: Record<string, { ability: string; label: string }>;
  armor: Record<
    string,
    {
      base?: number;
      dex?: string;
      acBonus?: number;
      label: string;
      strReq?: number;
      stealthDisadvantage?: boolean;
    }
  >;
  races: Record<string, RaceDef>;
  backgrounds: Record<
    string,
    { label: string; skills: string[]; equipment?: string[]; tool?: string }
  >;
  fightingStyles: Record<string, { label: string; desc: string }>;
  classes: Record<string, ClassDef>;
  spellSlots: Record<string, Record<string, Record<string, number>>>;
  spellCatalog: Record<string, { label: string; level: number; combat?: boolean }>;
};

let data: ChargenData;
const customChars = new Map<string, Pregen>();
const CUSTOM_DIR = path.join(DATA_DIR, "custom-characters");

export function loadChargen(): void {
  data = readJson<ChargenData>(path.join(CONTENT_ROOT, "chargen", "srd51.json"));
  fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  for (const file of fs.readdirSync(CUSTOM_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const p = readJson<Pregen>(path.join(CUSTOM_DIR, file));
      customChars.set(p.id, p);
    } catch {
      /* skip corrupt */
    }
  }
}

export function getChargenCatalog() {
  return {
    source: "SRD 5.1 (CC-BY 4.0) — levels 1–3",
    levels: [1, 2, 3],
    methods: [
      {
        id: "standard_array",
        label: "Standard Array",
        values: data.standardArray,
        hint: "Assign 15, 14, 13, 12, 10, 8 once each, then apply racial bonuses.",
      },
      {
        id: "point_buy",
        label: "Point Buy",
        budget: data.pointBuy.budget,
        costs: data.pointBuy.costs,
        hint: "27 points. Scores 8–15 before racial bonuses.",
      },
      {
        id: "roll",
        label: "Roll 4d6 drop lowest",
        hint: "Six rolls, assign freely. Racial bonuses after.",
      },
    ],
    abilities: data.abilities,
    skills: data.skills,
    races: Object.entries(data.races).map(([id, r]) => ({
      id,
      label: r.label,
      speedCells: r.speedCells,
      abilityBonuses: r.abilityBonuses,
      flexibleBonuses: r.flexibleBonuses ?? 0,
      traits: r.traits,
      extraSkills: r.extraSkills ?? 0,
      hpBonusPerLevel: r.hpBonusPerLevel ?? 0,
    })),
    backgrounds: Object.entries(data.backgrounds).map(([id, b]) => ({
      id,
      label: b.label,
      skills: b.skills,
    })),
    fightingStyles: Object.entries(data.fightingStyles).map(([id, f]) => ({
      id,
      ...f,
    })),
    classes: Object.entries(data.classes).map(([id, c]) => ({
      id,
      label: c.label,
      hitDie: c.hitDie,
      savingThrows: c.savingThrows,
      skillChoices: c.skillChoices,
      skillList: c.skillList,
      armor: c.armor,
      shield: c.shield,
      spellcasting: c.spellcasting ?? null,
      spellAbility: c.spellAbility ?? null,
      cantripsKnown: c.cantripsKnown ?? null,
      spellsKnown: c.spellsKnown ?? null,
      preparedFormula: c.preparedFormula ?? null,
      domains: c.domains
        ? Object.entries(c.domains).map(([did, d]) => ({ id: did, ...d }))
        : null,
      fightingStyleRequired: !!c.fightingStyleRequired,
      fightingStyleAt: c.fightingStyleAt ?? null,
      fightingStyleOptions: c.fightingStyleOptions ?? null,
      featuresByLevel: c.featuresByLevel,
      spellLists: c.spellLists ?? null,
    })),
    spellSlots: data.spellSlots,
    spellCatalog: data.spellCatalog,
    pointBuy: data.pointBuy,
    standardArray: data.standardArray,
  };
}

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function avgHitDie(die: number): number {
  return Math.floor(die / 2) + 1;
}

function sameMultiset(a: number[], b: number[]): boolean {
  const left = [...a].sort((x, y) => y - x);
  const right = [...b].sort((x, y) => y - x);
  return left.join(",") === right.join(",");
}

function validateAbilities(draft: ChargenDraft, rolledPool?: number[]): void {
  const scores = data.abilities.map((a) => draft.baseAbilities[a]);
  if (scores.some((s) => typeof s !== "number" || !Number.isFinite(s))) {
    throw new Error("BAD_ABILITIES");
  }
  if (draft.method === "standard_array") {
    if (!sameMultiset(scores, data.standardArray)) {
      throw new Error("STANDARD_ARRAY_MISMATCH");
    }
  } else if (draft.method === "point_buy") {
    let spent = 0;
    for (const s of scores) {
      if (s < data.pointBuy.min || s > data.pointBuy.max) {
        throw new Error("POINT_BUY_RANGE");
      }
      const cost = data.pointBuy.costs[String(s)];
      if (cost === undefined) throw new Error("POINT_BUY_COST");
      spent += cost;
    }
    if (spent > data.pointBuy.budget) throw new Error("POINT_BUY_OVER");
  } else if (draft.method === "roll") {
    if (!rolledPool || rolledPool.length !== 6) throw new Error("NEED_SERVER_ROLL");
    for (const s of [...scores, ...rolledPool]) {
      if (s < 3 || s > 18) throw new Error("ROLL_RANGE");
    }
    if (!sameMultiset(scores, rolledPool)) throw new Error("ROLL_MISMATCH");
  } else {
    throw new Error("BAD_METHOD");
  }
}

function applyRacialBonuses(
  draft: ChargenDraft,
  race: RaceDef,
): Record<AbilityKey, number> {
  const out = { ...draft.baseAbilities } as Record<AbilityKey, number>;
  for (const [k, v] of Object.entries(race.abilityBonuses)) {
    out[k as AbilityKey] += v ?? 0;
  }
  if (race.flexibleBonuses) {
    const picks = draft.flexibleAbilityBonuses ?? [];
    if (picks.length !== race.flexibleBonuses) {
      throw new Error("NEED_FLEXIBLE_BONUSES");
    }
    const uniq = new Set(picks);
    if (uniq.size !== picks.length) throw new Error("FLEXIBLE_DUP");
    for (const a of picks) {
      if (!data.abilities.includes(a)) throw new Error("BAD_FLEXIBLE");
      if (race.abilityBonuses[a]) throw new Error("FLEXIBLE_ON_FIXED");
      out[a] += 1;
    }
  }
  return out;
}

function computeAc(
  cls: ClassDef,
  abilities: Record<AbilityKey, number>,
  fightingStyle?: string,
): { ac: number; armor: string; shield: boolean } {
  const dex = abilityMod(abilities.dex);
  const con = abilityMod(abilities.con);
  const wis = abilityMod(abilities.wis);
  let ac: number;
  let armorKey = cls.armor;

  if (cls.unarmoredDefense === "barbarian") {
    ac = 10 + dex + con;
    armorKey = "none";
  } else if (cls.unarmoredDefense === "monk") {
    ac = 10 + dex + wis;
    armorKey = "none";
  } else {
    const armor = data.armor[cls.armor] ?? data.armor.none;
    const base = armor.base ?? 10;
    let dexBonus = 0;
    if (armor.dex === "full") dexBonus = dex;
    else if (armor.dex === "max2") dexBonus = Math.min(dex, 2);
    ac = base + dexBonus;
    if (armor.strReq && abilities.str < armor.strReq) {
      // Fallback to leather if STR req not met
      const leather = data.armor.leather;
      ac = (leather.base ?? 11) + dex;
      armorKey = "leather";
    }
  }
  const shield = cls.shield;
  if (shield) ac += data.armor.shield.acBonus ?? 2;
  if (fightingStyle === "defense" && armorKey !== "none") ac += 1;
  return { ac, armor: armorKey, shield };
}

function computeHp(
  draft: ChargenDraft,
  cls: ClassDef,
  race: RaceDef,
  abilities: Record<AbilityKey, number>,
): number {
  const con = abilityMod(abilities.con);
  const racial = race.hpBonusPerLevel ?? 0;
  let hp = cls.hitDie + con + racial;
  for (let lvl = 2; lvl <= draft.level; lvl += 1) {
    let die: number;
    if (draft.hpMethod === "rolled" && draft.hpRolls?.[lvl - 2] != null) {
      die = draft.hpRolls[lvl - 2]!;
      if (die < 1 || die > cls.hitDie) throw new Error("BAD_HP_ROLL");
    } else {
      die = avgHitDie(cls.hitDie);
    }
    hp += die + con + racial;
  }
  return Math.max(1, hp);
}

function spellSlotsFor(
  cls: ClassDef,
  level: number,
): Record<string, number> | undefined {
  if (!cls.spellcasting) return undefined;
  const table = data.spellSlots[cls.spellcasting];
  return table?.[String(level)] ?? {};
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
}

export function buildCharacter(draft: ChargenDraft, rolledPool?: number[]): Pregen {
  if (!draft.name?.trim()) throw new Error("NEED_NAME");
  if (![1, 2, 3].includes(draft.level)) throw new Error("BAD_LEVEL");
  const race = data.races[draft.raceId];
  const cls = data.classes[draft.classId];
  const bg = data.backgrounds[draft.backgroundId];
  if (!race || !cls || !bg) throw new Error("BAD_RACE_CLASS_BG");

  validateAbilities(draft, rolledPool);
  const abilities = applyRacialBonuses(draft, race);

  // Skills: background + class picks + race extras, unique
  const bgSkills = bg.skills;
  const classPicks = draft.classSkills ?? [];
  if (classPicks.length !== cls.skillChoices) {
    throw new Error(`NEED_${cls.skillChoices}_CLASS_SKILLS`);
  }
  for (const s of classPicks) {
    if (!cls.skillList.includes(s)) throw new Error("BAD_CLASS_SKILL");
    if (bgSkills.includes(s)) throw new Error("SKILL_OVERLAP_BG");
  }
  const raceSkills = draft.raceSkills ?? [];
  if ((race.extraSkills ?? 0) !== raceSkills.length) {
    throw new Error("NEED_RACE_SKILLS");
  }
  const allSkills = [...new Set([...bgSkills, ...classPicks, ...raceSkills])];
  if (allSkills.length !== bgSkills.length + classPicks.length + raceSkills.length) {
    throw new Error("SKILL_DUP");
  }

  // Fighting style
  let fightingStyle = draft.fightingStyle;
  const needsStyle =
    cls.fightingStyleRequired ||
    (cls.fightingStyleAt != null && draft.level >= cls.fightingStyleAt);
  if (needsStyle) {
    if (!fightingStyle || !cls.fightingStyleOptions?.includes(fightingStyle)) {
      throw new Error("NEED_FIGHTING_STYLE");
    }
  } else {
    fightingStyle = undefined;
  }

  // Domain (cleric)
  let domain = draft.domain;
  if (cls.domains) {
    if (!domain || !cls.domains[domain]) throw new Error("NEED_DOMAIN");
  } else {
    domain = undefined;
  }

  // Spells / cantrips (soft validate counts when class has lists)
  const cantrips = [...(draft.cantrips ?? [])];
  const spellsKnown = [...(draft.spellsKnown ?? [])];
  if (cls.cantripsKnown) {
    const available = cls.spellLists?.cantrips ?? [];
    const need = Math.min(
      cls.cantripsKnown[String(draft.level)] ?? 0,
      available.length,
    );
    while (cantrips.length < need) {
      const next = available.find((c) => !cantrips.includes(c));
      if (!next) break;
      cantrips.push(next);
    }
    if (cantrips.length !== need) throw new Error(`NEED_${need}_CANTRIPS`);
    for (const c of cantrips) {
      if (!available.includes(c) && !data.spellCatalog[c]) {
        throw new Error("BAD_CANTRIP");
      }
    }
  }
  if (cls.spellsKnown && cls.spellcasting) {
    const pool = [
      ...(cls.spellLists?.["1"] ?? []),
      ...(draft.level >= 3 ? cls.spellLists?.["2"] ?? [] : []),
    ];
    const need = Math.min(
      cls.spellsKnown[String(draft.level)] ?? 0,
      pool.length,
    );
    while (spellsKnown.length < need) {
      const next = pool.find((s) => !spellsKnown.includes(s));
      if (!next) break;
      spellsKnown.push(next);
    }
    if (need > 0 && spellsKnown.length !== need) {
      throw new Error(`NEED_${need}_SPELLS`);
    }
  }

  const { ac, armor, shield } = computeAc(cls, abilities, fightingStyle);
  const hp = computeHp(draft, cls, race, abilities);
  const proficiencyBonus = data.proficiencyByLevel[String(draft.level)] ?? 2;

  const features = [
    ...(cls.featuresByLevel[String(draft.level)]
      ? Array.from(
          { length: draft.level },
          (_, i) => cls.featuresByLevel[String(i + 1)] ?? [],
        ).flat()
      : []),
  ];
  if (fightingStyle) features.push(`fighting_style_${fightingStyle}`);
  if (domain) features.push(`domain_${domain}`);

  const traits = [
    ...race.traits,
    ...(cls.traitsByLevel?.[String(draft.level)] ?? []),
  ];

  const levelKey = String(draft.level);
  let actions = [...(cls.actionsByLevel[levelKey] ?? [])];
  // Include combat spells from known/prepared that have combat ability ids
  for (const sid of [...cantrips, ...spellsKnown]) {
    const sp = data.spellCatalog[sid];
    if (sp?.combat && !actions.includes(sid)) actions.push(sid);
  }
  if (domain && cls.domains?.[domain]?.bonusSpells) {
    for (const sid of cls.domains[domain].bonusSpells!) {
      const sp = data.spellCatalog[sid];
      if (sp?.combat && !actions.includes(sid)) actions.push(sid);
    }
  }

  // Fix second_wind dice dynamically stored on character summary
  const guided =
    actions.find((a) => a.startsWith("spell_")) ||
    actions.find((a) => a.endsWith("_attack")) ||
    actions[0];

  const idBase = slugify(draft.name.trim()) || "hero";
  let id = `custom_${idBase}`;
  let n = 1;
  while (customChars.has(id) || fs.existsSync(path.join(CUSTOM_DIR, `${id}.json`))) {
    n += 1;
    id = `custom_${idBase}_${n}`;
  }

  const summary = `${race.label} ${cls.label} ${draft.level} — custom (SRD 5.1)`;

  const pregen: Pregen = {
    id,
    name: draft.name.trim().slice(0, 40),
    summary,
    level: draft.level,
    class: draft.classId,
    hp,
    ac,
    abilities,
    speedCells: race.speedCells,
    proficiencyBonus,
    actions,
    traits,
    inventory: [
      ...cls.inventory,
      ...(bg.equipment ?? []),
      ...(bg.tool ? [bg.tool] : []),
    ],
    guidedDefaultAction: guided,
  };

  // Extended fields used by combat/sheet (cast through enrich)
  const enriched = {
    ...pregen,
    race: draft.raceId,
    background: draft.backgroundId,
    subclass: domain,
    armor,
    shield,
    weapons: cls.primaryWeapons,
    savingThrows: cls.savingThrows,
    skills: allSkills,
    features: [...new Set(features)],
    spellSlots: spellSlotsFor(cls, draft.level),
    cantrips,
    spellsKnown,
    fightingStyle,
    method: draft.method,
    custom: true,
    renameAllowed: true,
  };

  return enriched as Pregen;
}

export function registerCustomCharacter(pregen: Pregen): Pregen {
  customChars.set(pregen.id, pregen);
  fs.writeFileSync(
    path.join(CUSTOM_DIR, `${pregen.id}.json`),
    JSON.stringify(pregen, null, 2),
    "utf8",
  );
  return pregen;
}

export function createCustomCharacter(
  draft: ChargenDraft,
  rolledPool?: number[],
): Pregen {
  const built = buildCharacter(draft, rolledPool);
  return registerCustomCharacter(built);
}

export function listCustomCharacters(): Pregen[] {
  return [...customChars.values()];
}

export function getCustomCharacter(id: string): Pregen | undefined {
  return customChars.get(id);
}

export function rollAbilityScores(): number[] {
  const scores: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const dice = [0, 0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6));
    dice.sort((a, b) => a - b);
    scores.push(dice[1]! + dice[2]! + dice[3]!);
  }
  return scores;
}
