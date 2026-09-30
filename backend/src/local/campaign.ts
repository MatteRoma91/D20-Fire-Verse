import type { CastMember } from "@d20-fireverse/protocol";
import { getCustomCharacter, listCustomCharacters } from "./chargen.js";
import { currentSnapshot, initCatalog } from "./catalog.js";
import { configureVoices, type VoiceFx } from "./narration.js";
import { PORTRAITS, defaultPortrait, isPortraitId, portraitUrl } from "./portraits.js";

export type Manifest = {
  id: string;
  title: string;
  startNodeId: string;
  pregenIds: string[];
  /** Speaking characters: how the table shows them and how the server voices them. */
  cast?: Record<string, CastDef>;
  alexaHints?: Record<string, unknown>;
};

export type CastDef = {
  name: string;
  title: string;
  color: string;
  voice: string;
  speed: number;
  pitch?: number;
  fx?: VoiceFx;
};

export type StoryNode = {
  id: string;
  type: "story" | "skill_check" | "encounter" | "puzzle" | "hub";
  alexaScene?: string;
  narration?: { text: string };
  choices?: Array<{
    id: string;
    label: string;
    next: string;
    flagsSet?: string[];
    requireFlags?: string[];
    excludeFlags?: string[];
  }>;
  /** Named hub that assembles choices from flags (e.g. corridor). */
  hubId?: string;
  check?: {
    ability: string;
    skill?: string;
    dc: number;
    proposer?: string;
  };
  puzzle?: {
    kind: "sequence";
    solution: string[];
    options: Array<{ id: string; label: string }>;
    /** Designer answer key; never shown to players. */
    hint?: string;
    /** Shown after the first wrong attempt. */
    nudge?: string;
    maxFailsBeforePenalty?: number;
    resetOnFail?: boolean;
  };
  onSuccess?: { narration?: { text: string }; next: string; flagsSet?: string[] };
  onFailure?: {
    narration?: { text: string };
    next: string;
    effects?: unknown[];
    flagsSet?: string[];
  };
  encounterId?: string;
  onVictory?: string;
  savePrompt?: boolean;
  /** Who is speaking this beat — portrait on the TV. */
  speaker?: { id: string; name: string };
};

export type Pregen = {
  id: string;
  name: string;
  summary: string;
  level: number;
  class: string;
  hp: number;
  ac: number;
  abilities: Record<string, number>;
  speedCells?: number;
  proficiencyBonus?: number;
  actions?: string[];
  traits?: string[];
  inventory?: string[];
  guidedDefaultAction?: string;
  race?: string;
  portrait?: string;
};

export type MapDef = {
  id: string;
  name: string;
  width: number;
  height: number;
  walls: Array<{ x: number; y: number; w: number; h: number }>;
  spawn: {
    pcs: Array<{ x: number; y: number }>;
    enemies: Array<{ x: number; y: number }>;
  };
};

export type EncounterDef = {
  id: string;
  name: string;
  mapId: string;
  /** Narrated as the fight opens. */
  intro?: string;
  /** Narrated over the last blow. */
  outro?: string;
  scaling: Record<
    string,
    Array<{ monsterId: string; count: number; hpOverride?: number }>
  >;
};

export type MonsterDef = {
  id: string;
  name: string;
  ac: number;
  hp: number;
  speedCells: number;
  abilities: Record<string, number>;
  actions: string[];
  aiProfile?: string;
};

export type AbilityDef = {
  id: string;
  name: string;
  actionType: string;
  needsTarget?: boolean;
  effects: Array<Record<string, unknown>>;
};

export function loadCampaign(): void {
  initCatalog();
  configureVoices(currentSnapshot().manifest.cast);
}

function pack() {
  const snap = currentSnapshot();
  configureVoices(snap.manifest.cast);
  return snap;
}

export function getManifest(): Manifest {
  return pack().manifest;
}

/** The cast as the table shows it; voices stay on the server. */
export function publicCast(): Record<string, CastMember> {
  return Object.fromEntries(
    Object.entries(pack().manifest.cast ?? {}).map(([id, c]) => [id, { name: c.name, title: c.title, color: c.color, pitch: c.pitch ?? 1 }]),
  );
}

export function getNode(id: string): StoryNode | undefined {
  return pack().nodes[id];
}

export function listPregens(): Pregen[] {
  return [...Object.values(pack().pregens), ...listCustomCharacters()];
}

export function getPregen(id: string): Pregen | undefined {
  return pack().pregens[id] ?? getCustomCharacter(id);
}

export function getMap(id: string): MapDef | undefined {
  return pack().maps[id];
}

export function getEncounter(id: string): EncounterDef | undefined {
  return pack().encounters[id];
}

export function getMonster(id: string): MonsterDef | undefined {
  return pack().monsters[id];
}

export function getAbility(id: string): AbilityDef | undefined {
  return pack().abilities[id];
}

export { PORTRAITS, portraitUrl, isPortraitId };

const MONSTER_PORTRAITS = new Set(["giant_rat", "giant_centipede", "infernal_spider", "magma_rat"]);

export function portraitForCharacter(characterId: string | undefined): string | null {
  if (!characterId) return null;
  const pregen = getPregen(characterId);
  if (pregen?.portrait && isPortraitId(pregen.portrait)) return portraitUrl(pregen.portrait);
  if (isPortraitId(characterId)) return portraitUrl(characterId);
  if (pregen) return portraitUrl(defaultPortrait(pregen.race ?? "", pregen.class));
  return null;
}

export function portraitForMonster(monsterId: string | undefined): string | null {
  return monsterId && MONSTER_PORTRAITS.has(monsterId) ? portraitUrl(monsterId) : null;
}

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}
