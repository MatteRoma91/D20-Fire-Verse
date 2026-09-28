/** Shared WebSocket contract (local Express today, AWS API GW later). */

export type ClientAction =
  | "CREATE_ROOM"
  | "JOIN_ROOM"
  | "CHOOSE"
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
  | "DICE_REVEAL"
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
  abilityId?: string;
  targetId?: string;
  saveId?: string;
  intent?: string;
  slots?: Record<string, string>;
};

export type DiceReveal = {
  roller: string;
  notation: string;
  values: number[];
  total: number;
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
