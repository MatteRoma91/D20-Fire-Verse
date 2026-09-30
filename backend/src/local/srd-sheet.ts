import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pregen } from "./campaign.js";
import type { CombatToken } from "./combat.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  fs.readFileSync(path.resolve(here, "../../../content/rules/srd51_combat.json"), "utf8"),
) as Record<string, SrdAbility>;

export type SrdAbility = {
  id: string;
  name: string;
  actionType: string;
  level?: number;
  aim?: string;
  combat?: boolean;
  effects: Array<Record<string, unknown>>;
};

export type Vitals = {
  slots?: Record<string, number>;
  ragesLeft?: number;
  actionSurge?: boolean;
  ki?: number;
  layOnHands?: number;
  channelDivinity?: number;
  bardicLeft?: number;
  sorceryPoints?: number;
  hitDice?: number;
  deathSuccesses?: number;
  deathFailures?: number;
  dying?: boolean;
  stable?: boolean;
  secondWindUsed?: boolean;
};

const STANDARD = ["std_dash", "std_disengage", "std_dodge", "std_help", "std_hide", "std_search"] as const;

const HIT_DICE: Record<string, number> = {
  barbarian: 12,
  fighter: 10,
  paladin: 10,
  ranger: 10,
  bard: 8,
  cleric: 8,
  druid: 8,
  monk: 8,
  rogue: 8,
  warlock: 8,
  sorcerer: 6,
  wizard: 6,
};

export function srdAbility(id: string): SrdAbility | undefined {
  return catalog[id];
}

export function isCombatSpell(id: string, lookup: (id: string) => { effects?: unknown[] } | undefined): boolean {
  const srd = catalog[id];
  if (srd?.combat) return true;
  const known = lookup(id);
  return Boolean(known?.effects?.length) && id.startsWith("spell_");
}

function weaponId(name: string): string {
  if (name === "unarmed") return "unarmed_strike";
  return name.endsWith("_attack") || name.endsWith("_strike") ? name : `${name}_attack`;
}

type Lookup = (id: string) => SrdAbility | undefined;

function spellLevel(ability: SrdAbility): number {
  return Number(ability.level ?? ability.effects[0]?.slot ?? 0);
}

export function slotReady(token: CombatToken, level: number): boolean {
  if (level <= 0) return true;
  const slots = token.slots;
  if (!slots) return true;
  for (let step = level; step <= 9; step += 1) {
    if ((slots[String(step)] ?? 0) > 0) return true;
  }
  return false;
}

export function spendSlot(token: CombatToken, level: number): number {
  if (level <= 0) return 0;
  if (!token.slots) return level;
  for (let step = level; step <= 9; step += 1) {
    const key = String(step);
    if ((token.slots[key] ?? 0) > 0) {
      token.slots[key] -= 1;
      return step;
    }
  }
  throw new Error("NO_SLOT");
}

export function initSheet(token: CombatToken, pregen: Pregen, saved?: Vitals): void {
  const extra = pregen as Pregen & {
    spellSlots?: Record<string, number>;
    cantrips?: string[];
    spellsKnown?: string[];
    spellAbility?: string;
    reactions?: string[];
    features?: string[];
    fightingStyle?: string;
    weapons?: string[];
  };
  const level = pregen.level ?? 1;
  token.sheetDriven = true;
  token.slots = { ...(saved?.slots ?? extra.spellSlots ?? {}) };
  token.cantrips = [...(extra.cantrips ?? [])];
  token.spells = [...(extra.spellsKnown ?? [])];
  token.spellAbility = extra.spellAbility;
  token.reactionIds = [...(extra.reactions ?? [])];
  token.reactionReady = saved ? !saved.dying : true;
  token.features = [...(extra.features ?? [])];
  token.fightingStyle = extra.fightingStyle;
  token.conditions = [];
  token.deathSuccesses = saved?.deathSuccesses ?? 0;
  token.deathFailures = saved?.deathFailures ?? 0;
  token.dying = Boolean(saved?.dying) || token.hp <= 0;
  token.stable = Boolean(saved?.stable);
  token.secondWindUsed = Boolean(saved?.secondWindUsed);
  token.ragesLeft = saved?.ragesLeft ?? (pregen.class === "barbarian" ? (level >= 3 ? 3 : 2) : 0);
  token.actionSurge = saved?.actionSurge ?? (pregen.class === "fighter" && level >= 2);
  token.kiMax = pregen.class === "monk" && level >= 2 ? level : 0;
  token.ki = saved?.ki ?? token.kiMax;
  token.layOnHandsMax = pregen.class === "paladin" ? 5 * level : 0;
  token.layOnHands = saved?.layOnHands ?? token.layOnHandsMax;
  token.channelDivinity = saved?.channelDivinity ?? (pregen.class === "cleric" && level >= 2 ? 1 : 0);
  const cha = Math.max(1, Math.floor(((pregen.abilities.cha ?? 10) - 10) / 2));
  token.bardicLeft = saved?.bardicLeft ?? (pregen.class === "bard" ? cha : 0);
  token.sorceryPoints = saved?.sorceryPoints ?? (pregen.class === "sorcerer" && level >= 2 ? level : 0);
  token.hitDie = HIT_DICE[pregen.class] ?? 8;
  token.hitDice = saved?.hitDice ?? level;
  if (token.hp <= 0) {
    token.hp = 0;
    token.dying = true;
  }
  if (pregen.class === "wizard" && !token.reactionIds.includes("spell_shield") && token.spells.includes("spell_shield")) {
    token.reactionIds.push("spell_shield");
  }
  if (pregen.class === "paladin" && level >= 2 && !token.features.includes("divine_smite")) {
    token.features.push("divine_smite");
  }
}

export function exportVitals(token: CombatToken): Vitals {
  return {
    slots: token.slots ? { ...token.slots } : undefined,
    ragesLeft: token.ragesLeft,
    actionSurge: token.actionSurge,
    ki: token.ki,
    layOnHands: token.layOnHands,
    channelDivinity: token.channelDivinity,
    bardicLeft: token.bardicLeft,
    sorceryPoints: token.sorceryPoints,
    hitDice: token.hitDice,
    deathSuccesses: token.deathSuccesses,
    deathFailures: token.deathFailures,
    dying: token.dying,
    stable: token.stable,
    secondWindUsed: token.secondWindUsed,
  };
}

function pushUnique(list: string[], id: string): void {
  if (!list.includes(id)) list.push(id);
}

export function refreshMenus(token: CombatToken, pregen: Pregen | undefined, lookup: Lookup): void {
  if (!token.sheetDriven || token.kind !== "pc") return;
  const actions: string[] = [];
  const bonus: string[] = [];
  const place = (id: string) => {
    const ability = lookup(id);
    if (!ability || ability.actionType === "reaction") return;
    const level = spellLevel(ability);
    if (level > 0 && !slotReady(token, level)) return;
    if (token.raging && level > 0 && id.startsWith("spell_")) return;
    if (token.castBonusSpell && level > 0) return;
    if (token.castLeveled && ability.actionType === "bonus_action" && level > 0) return;
    const bucket = ability.actionType === "bonus_action" ? bonus : actions;
    pushUnique(bucket, id);
  };

  const weapons = (pregen as { weapons?: string[] } | undefined)?.weapons ?? [];
  for (const name of weapons) place(weaponId(name));
  for (const id of STANDARD) place(id);
  if (token.inventory.includes("potion_healing")) place("use_potion_healing");
  for (const id of token.cantrips ?? []) place(id);
  for (const id of token.spells ?? []) place(id);

  const cls = pregen?.class;
  const level = pregen?.level ?? 1;
  if ((cls === "fighter" || token.features?.includes("second_wind")) && !token.secondWindUsed) pushUnique(bonus, "second_wind");
  if (token.actionSurge) pushUnique(actions, "action_surge");
  if (cls === "rogue" || pregen?.traits?.includes("cunning_action")) {
    pushUnique(bonus, "cunning_dash");
    pushUnique(bonus, "cunning_disengage");
    pushUnique(bonus, "cunning_hide");
  }
  if ((token.ragesLeft ?? 0) > 0 && !token.raging && cls === "barbarian") pushUnique(bonus, "rage");
  if (cls === "barbarian" && level >= 2) pushUnique(actions, "reckless_attack");
  if ((token.layOnHands ?? 0) > 0) pushUnique(actions, "lay_on_hands");
  if ((token.channelDivinity ?? 0) > 0 && token.features?.some((f) => f.includes("life") || f === "domain_life" || f === "disciple_of_life")) {
    pushUnique(actions, "channel_preserve_life");
  }
  if ((token.bardicLeft ?? 0) > 0 && cls === "bard") pushUnique(bonus, "bardic_inspiration");
  if (cls === "monk") {
    pushUnique(bonus, "martial_arts_bonus");
    if ((token.ki ?? 0) > 0 && level >= 2) {
      pushUnique(bonus, "ki_flurry");
      pushUnique(bonus, "ki_patient_defense");
      pushUnique(bonus, "ki_step_of_the_wind");
    }
  }
  if ((token.spiritualRounds ?? 0) > 0) pushUnique(bonus, "spell_spiritual_weapon_strike");
  if ((token.sorceryPoints ?? 0) >= 2 && !token.castLeveled && !token.castBonusSpell) {
    for (const id of [...(token.cantrips ?? []), ...(token.spells ?? [])]) {
      const ability = lookup(id);
      if (!ability || ability.actionType === "bonus_action" || ability.actionType === "reaction") continue;
      if (spellLevel(ability) > 0 && !slotReady(token, spellLevel(ability))) continue;
      pushUnique(bonus, `quicken:${id}`);
    }
  }

  token.actionIds = actions;
  token.bonusActionIds = bonus;
}

export function scaledDice(effect: Record<string, unknown>, slot: number): string | undefined {
  const scaling = effect.scaling as Record<string, string> | undefined;
  return scaling?.[String(slot)];
}

export function shortRestResources(token: CombatToken, pregen: Pregen | undefined): string[] {
  const notes: string[] = [];
  if ((token.hitDice ?? 0) > 0 && token.hp < token.maxHp && token.hp > 0) {
    token.hitDice = (token.hitDice ?? 0) - 1;
    notes.push("hit die");
  }
  token.secondWindUsed = false;
  token.actionSurge = pregen?.class === "fighter" && (pregen.level ?? 1) >= 2;
  const knownSlots = (pregen as { spellSlots?: Record<string, number> } | undefined)?.spellSlots;
  if (pregen?.class === "warlock" && knownSlots) {
    token.slots = { ...knownSlots };
    notes.push("pact slots");
  }
  if (pregen?.class === "wizard" && token.slots && !token.arcaneRecovery) {
    let left = Math.ceil((pregen.level ?? 1) / 2);
    for (const key of ["1", "2"]) {
      const max = knownSlots?.[key] ?? 0;
      while (left >= Number(key) && (token.slots[key] ?? 0) < max) {
        token.slots[key] = (token.slots[key] ?? 0) + 1;
        left -= Number(key);
      }
    }
    token.arcaneRecovery = true;
    notes.push("arcane recovery");
  }
  if (pregen?.class === "monk") token.ki = token.kiMax ?? token.ki;
  if (pregen?.class === "fighter") notes.push("second wind");
  if (pregen?.class === "bard") {
    const cha = Math.max(1, Math.floor(((pregen.abilities.cha ?? 10) - 10) / 2));
    token.bardicLeft = cha;
  }
  if (pregen?.class === "cleric" && (pregen.level ?? 1) >= 2) token.channelDivinity = 1;
  return notes;
}

export function longRestResources(token: CombatToken, pregen: Pregen | undefined): void {
  token.hp = token.maxHp;
  token.dying = false;
  token.stable = false;
  token.deathSuccesses = 0;
  token.deathFailures = 0;
  token.raging = false;
  const knownSlots = (pregen as { spellSlots?: Record<string, number> } | undefined)?.spellSlots;
  if (knownSlots) token.slots = { ...knownSlots };
  const level = pregen?.level ?? 1;
  const recover = Math.max(1, Math.floor(level / 2));
  token.hitDice = Math.min(level, (token.hitDice ?? 0) + recover);
  token.secondWindUsed = false;
  token.actionSurge = pregen?.class === "fighter" && level >= 2;
  token.ki = token.kiMax ?? 0;
  token.layOnHands = token.layOnHandsMax ?? 0;
  token.sorceryPoints = pregen?.class === "sorcerer" && level >= 2 ? level : 0;
  if (pregen?.class === "barbarian") token.ragesLeft = level >= 3 ? 3 : 2;
  if (pregen?.class === "cleric" && level >= 2) token.channelDivinity = 1;
  if (pregen?.class === "bard") {
    token.bardicLeft = Math.max(1, Math.floor(((pregen.abilities.cha ?? 10) - 10) / 2));
  }
  token.arcaneRecovery = false;
}
