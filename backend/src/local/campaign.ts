import fs from "node:fs";
import path from "node:path";
import { getCustomCharacter, listCustomCharacters } from "./chargen.js";
import { CAMPAIGN_DIR, CONTENT_ROOT, readJson } from "./paths.js";

export type Manifest = {
  id: string;
  title: string;
  startNodeId: string;
  pregenIds: string[];
  alexaHints?: Record<string, unknown>;
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
    hint?: string;
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

let manifest: Manifest;
let nodes: Record<string, StoryNode>;
let pregens: Record<string, Pregen>;
let maps: Record<string, MapDef>;
let encounters: Record<string, EncounterDef>;
let monsters: Record<string, MonsterDef>;
let abilities: Record<string, AbilityDef>;

export function loadCampaign(): void {
  manifest = readJson<Manifest>(path.join(CAMPAIGN_DIR, "manifest.json"));
  nodes = readJson<Record<string, StoryNode>>(
    path.join(CAMPAIGN_DIR, "nodes", "story.json"),
  );
  maps = readJson<Record<string, MapDef>>(
    path.join(CAMPAIGN_DIR, "maps", "maps.json"),
  );
  encounters = readJson<Record<string, EncounterDef>>(
    path.join(CAMPAIGN_DIR, "encounters", "encounters.json"),
  );
  monsters = readJson<Record<string, MonsterDef>>(
    path.join(CAMPAIGN_DIR, "monsters.json"),
  );
  abilities = readJson<Record<string, AbilityDef>>(
    path.join(CONTENT_ROOT, "abilities", "oneshot_v1.json"),
  );
  pregens = {};
  for (const id of manifest.pregenIds) {
    const file = path.join(CAMPAIGN_DIR, "pregens", `${id}.json`);
    if (fs.existsSync(file)) {
      pregens[id] = readJson<Pregen>(file);
    }
  }
}

export function getManifest(): Manifest {
  return manifest;
}

export function getNode(id: string): StoryNode | undefined {
  return nodes[id];
}

export function listPregens(): Pregen[] {
  return [...Object.values(pregens), ...listCustomCharacters()];
}

export function getPregen(id: string): Pregen | undefined {
  return pregens[id] ?? getCustomCharacter(id);
}

export function getMap(id: string): MapDef | undefined {
  return maps[id];
}

export function getEncounter(id: string): EncounterDef | undefined {
  return encounters[id];
}

export function getMonster(id: string): MonsterDef | undefined {
  return monsters[id];
}

export function getAbility(id: string): AbilityDef | undefined {
  return abilities[id];
}

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}
