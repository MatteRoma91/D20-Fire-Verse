/** The room as the table server publishes it (backend/src/local/room.ts publicState). */

import type { DungeonRoomId } from "./dungeon-map";
import type { PcSheet } from "./pc-sheet";

export type DiceOutcome = "hit" | "miss" | "crit" | "fumble" | "success" | "fail";

export type DiceRoll = {
  id: string;
  roller: string;
  notation: string;
  values: number[];
  sides: number[];
  modifier: number;
  total: number;
  purpose: string;
  label?: string;
  isCrit?: boolean;
  isFumble?: boolean;
  vs?: { kind: "AC" | "DC"; value: number };
  outcome?: DiceOutcome;
  kept?: number;
  at?: string;
};

export type Cell = { x: number; y: number };

export type StrikeHit = { targetId: string; outcome: DiceOutcome; damage: number; hp: number };

export type CombatEvent = { seq: number; line: string } & (
  | { kind: "start"; order: string[] }
  | { kind: "turn"; tokenId: string; round: number }
  | { kind: "move"; tokenId: string; path: Cell[] }
  | {
      kind: "strike";
      tokenId: string;
      ability: string;
      style: "melee" | "ranged" | "spell";
      rolls: DiceRoll[];
      hits: StrikeHit[];
    }
  | { kind: "heal"; tokenId: string; targetId: string; ability: string; amount: number; hp: number; rolls: DiceRoll[] }
  | { kind: "status"; tokenId: string; ability: string; rolls: DiceRoll[] }
  | { kind: "down"; tokenId: string }
  | { kind: "end"; outcome: "victory" | "defeat" }
);

export type Token = {
  id: string;
  kind: "pc" | "enemy" | string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ac: number;
  dead: boolean;
  initiative: number;
  playerId?: string;
  characterId?: string;
  monsterId?: string;
  portrait: string;
  boss: boolean;
  movementLeft: number;
  hasAction: boolean;
  hasBonusAction: boolean;
  dodging: boolean;
  disengaging: boolean;
  hidden: boolean;
  blessed: boolean;
  marked: boolean;
};

export type MenuAction = {
  id: string;
  name: string;
  actionType: string;
  economy: string;
  needsTarget: boolean;
  targetKind: "enemy" | "ally" | "none";
  range: number;
  guided: boolean;
  available: boolean;
};

export type CombatPublic = {
  encounterId: string;
  mapId: string;
  width: number;
  height: number;
  walls: boolean[][];
  round: number;
  seq: number;
  tokens: Token[];
  turnOrder: string[];
  currentTokenId?: string;
  currentName?: string;
  reachable: Cell[];
  log: string[];
  events: CombatEvent[];
  status: "active" | "victory" | "defeat";
  actions: MenuAction[];
  actionMenu: {
    movement: { left: number; speed: number; hint: string };
    actions: MenuAction[];
    bonusActions: MenuAction[];
    flags: { dodging: boolean; disengaging: boolean; hidden: boolean; hasAction: boolean; hasBonusAction: boolean };
  } | null;
  sheet: (PcSheet & { portrait?: string; characterId?: string }) | null;
};

export type Voice = { key: string | null; seq: number; text: string };

export type { CastMember } from "@d20-fireverse/protocol";

export type Player = {
  playerId: string;
  displayName: string;
  characterId: string;
  characterName: string;
  portrait: string;
};

export type RoomState = {
  roomCode: string;
  campaignId: string;
  nodeId: string;
  nodeType: string;
  alexaScene?: string;
  narration?: string;
  narrationSeq: number;
  /** Speaking characters by id, for nameplates and subtitles. */
  cast?: Record<string, import("@d20-fireverse/protocol").CastMember>;
  voice: Voice | null;
  speaker?: { id: string; name: string; portrait: string } | null;
  choices: Array<{ id: string; label: string }>;
  skillCheck?: { ability: string; skill?: string; dc: number };
  vote?: {
    nodeId: string;
    votes: Array<{ playerId: string; choiceId: string; name: string; portrait: string | null }>;
    closesAt: number;
    remainingMs: number;
  } | null;
  checkOffer?: {
    nodeId: string;
    volunteers: string[];
    helpers: string[];
    remainingMs: number;
    roster: Array<{ playerId: string; name: string; bonus: number }>;
  } | null;
  puzzle: {
    kind: string;
    picked: string[];
    need: number;
    fails: number;
    feedback: string;
    draft?: string[];
    holderId?: string | null;
    holderName?: string | null;
    hints?: Array<{ playerId: string; name: string; slot: number; optionId: string }>;
    history?: Array<{ guess: string[]; black: number; white: number }>;
    lastScore?: { black: number; white: number } | null;
    poem?: string[] | null;
    nudge?: string | null;
  } | null;
  players: Player[];
  flags: string[];
  seals: number;
  visitedRooms: DungeonRoomId[];
  currentRoom: DungeonRoomId | null;
  mapTokens: Array<{ playerId: string; name: string; room: DungeonRoomId; x: number; y: number }>;
  lastDice: DiceRoll | null;
  diceQueue?: DiceRoll[];
  fx?: "arrows" | null;
  combat: CombatPublic | null;
  combatOutro: (CombatPublic & { outroText: string; voice: Voice | null }) | null;
  savePrompt: boolean;
  autosaveId: string | null;
  localPlayerId: string | null;
};

export type Pregen = {
  id: string;
  name: string;
  summary: string;
  class: string;
  level: number;
  race?: string;
  portrait?: string;
  custom?: boolean;
};
