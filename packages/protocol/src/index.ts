/** Shared WebSocket contract (local Express today, AWS API GW later). */

export type ClientAction =
  | "CREATE_ROOM"
  | "CREATE_CHARACTER"
  | "ROLL_ABILITIES"
  | "JOIN_ROOM"
  | "REJOIN"
  | "CHOOSE"
  | "SOLVE_PUZZLE"
  | "WITHDRAW"
  | "RETRY_COMBAT"
  | "MAP_MOVE"
  | "PROPOSE_MOVE"
  | "PERFORM_ACTION"
  | "END_TURN"
  | "REQUEST_SAVE"
  | "RESUME_SAVE"
  | "VOICE_INTENT"
  | "PING";

export type ServerEvent =
  | "HELLO"
  | "ROOM_STATE"
  | "SEAT"
  | "CHARACTER_CREATED"
  | "ABILITY_ROLLS"
  | "PONG"
  | "ERROR"
  | "SAVE_ACK";

export type ClientMessage = {
  action: ClientAction;
  roomCode?: string;
  displayName?: string;
  characterId?: string;
  choiceId?: string;
  playerId?: string;
  x?: number;
  y?: number;
  mapX?: number;
  mapY?: number;
  abilityId?: string;
  targetId?: string;
  saveId?: string;
  intent?: string;
  sequence?: string[];
};

export const VOICE_INTENTS = [
  "choose_1",
  "choose_2",
  "choose_3",
  "end_turn",
  "attack_nearest",
  "cast_magic_missile",
] as const;

export type VoiceIntent = (typeof VOICE_INTENTS)[number];

const ERROR_TEXT: Record<string, string> = {
  ROOM_NOT_FOUND: "That table doesn't exist anymore. Check the room code or start a new one.",
  ROOM_FULL: "This table already seats three heroes.",
  BAD_CHARACTER: "That hero isn't available. Pick another one.",
  CHARACTER_TAKEN: "Someone at the table is already playing that hero.",
  IN_COMBAT: "Not now — a fight is under way.",
  BAD_NODE: "The story lost its place. Resume from your last autosave.",
  ADVENTURE_OVER: "This adventure is over. Start a new table from Home.",
  USE_COMBAT_ACTIONS: "You're in a fight — act from the battle board.",
  COMBAT_OVER: "That fight is already over.",
  COMBAT_ACTIVE: "You can't step back in the middle of a fight.",
  INVALID_CHOICE: "That path is no longer open.",
  NO_CHOICE: "There's no choice with that number.",
  NOT_PUZZLE: "There's no puzzle here right now.",
  NO_MAP_ROOM: "There's no map for this scene.",
  ROOM_HIDDEN: "You haven't explored that room yet.",
  OUTSIDE_ROOM: "You can only walk inside the room you're in.",
  NO_PLAYER: "Join the table with a hero first.",
  NEED_PLAYER: "A fight needs at least one hero at the table.",
  NO_PLAYERS: "Nobody is seated at the table yet.",
  NO_COMBAT: "There's no fight right now.",
  NOT_YOUR_TURN: "Hold on — it's not your turn yet.",
  UNREACHABLE: "You can't reach that square this turn.",
  BAD_ABILITY: "Your hero can't do that.",
  NO_ACTION: "You've already used your action this turn. Move, use a bonus action, or end your turn.",
  NO_BONUS: "You've already used your bonus action this turn.",
  NO_EFFECT: "That ability does nothing here.",
  NEED_TARGET: "Pick a target first.",
  BAD_TARGET: "That's not a valid target.",
  OUT_OF_RANGE: "Out of range — move closer first.",
  ALREADY_USED: "You've already used that this fight.",
  NO_ITEM: "You don't have that item anymore.",
  NOT_ATTACK: "That ability isn't an attack.",
  NO_TARGET: "There's no enemy left to target.",
  NO_ABILITY: "Your hero has no attack ready.",
  NO_MISSILE: "Your hero doesn't know Magic Missile.",
  UNKNOWN_INTENT: "The table didn't understand that command.",
  SAVE_NOT_FOUND: "No save with that id. Check it and try again.",
  MISSING_FIELDS: "Something was missing from that request. Try again.",
  MISSING_DRAFT: "Finish the character before forging it.",
  BAD_JSON: "The table received a garbled message.",
  UNKNOWN_ACTION: "The table doesn't know that action.",
  BAD_ENCOUNTER: "This fight is missing from the campaign.",
  BAD_MAP: "This fight's map is missing from the campaign.",
  NO_BRANCH: "This scene has no way forward. Resume from your autosave.",
  NO_CHECK: "There's no check to roll here.",
  NEED_NAME: "Give your hero a name.",
  BAD_LEVEL: "Heroes start between level 1 and 3.",
  BAD_METHOD: "Pick a way to set your ability scores.",
  BAD_RACE_CLASS_BG: "Pick a race, a class and a background.",
  BAD_ABILITIES: "Every ability needs a score.",
  STANDARD_ARRAY_MISMATCH: "Use each standard array value exactly once: 15, 14, 13, 12, 10, 8.",
  POINT_BUY_RANGE: "With point buy, each score must be between 8 and 15.",
  POINT_BUY_COST: "Those scores cost more than 27 points.",
  POINT_BUY_OVER: "Those scores cost more than 27 points.",
  ROLL_MISMATCH: "Use each rolled score exactly once.",
  ROLL_RANGE: "A rolled score must be between 3 and 18.",
  NEED_SERVER_ROLL: "Roll your scores at the table first.",
  NEED_FLEXIBLE_BONUSES: "Pick two abilities for your half-elf bonuses.",
  FLEXIBLE_DUP: "Your two half-elf bonuses must go to different abilities.",
  FLEXIBLE_ON_FIXED: "Those bonuses can't go on Charisma.",
  BAD_FLEXIBLE: "Pick two abilities for your half-elf bonuses.",
  NEED_RACE_SKILLS: "Pick your extra race skills.",
  SKILL_DUP: "You picked the same skill twice.",
  SKILL_OVERLAP_BG: "Your background already gives you that skill. Pick another.",
  BAD_CLASS_SKILL: "That skill isn't on your class list.",
  NEED_FIGHTING_STYLE: "Pick a fighting style.",
  NEED_DOMAIN: "Pick a divine domain.",
  BAD_CANTRIP: "That cantrip isn't on your class list.",
  BAD_HP_ROLL: "Hit point rolls must fit your hit die.",
  CONNECTING: "Still reaching the table… one moment.",
};

/** Player-facing sentence for a server error code. Never shows a raw code. */
export function describeError(code: string | undefined | null): string {
  if (!code) return "Something went wrong at the table. Try again.";
  const known = ERROR_TEXT[code];
  if (known) return known;
  const need = code.match(/^NEED_(\d+)_(CLASS_SKILLS|CANTRIPS|SPELLS)$/);
  if (need) {
    const what = need[2] === "CLASS_SKILLS" ? "class skills" : need[2] === "CANTRIPS" ? "cantrips" : "spells";
    return `Pick ${need[1]} ${what}.`;
  }
  return "The table couldn't do that. Try something else.";
}

/** SRD ids to display labels: "half_orc" → "Half-Orc", "lightfoot_halfling" → "Lightfoot Halfling". */
export function srdLabel(id: string | undefined | null): string {
  if (!id) return "";
  const words = id.split(/[_\s]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
  return words[0] === "Half" && words.length === 2 ? words.join("-") : words.join(" ");
}
