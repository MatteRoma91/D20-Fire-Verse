import fs from "node:fs";
import path from "node:path";
import {
  abilityMod,
  getManifest,
  getNode,
  getPregen,
  loadCampaign,
  type StoryNode,
} from "./campaign.js";
import {
  applyDisconnectDodge,
  endTurn,
  performAttack,
  proposeMove,
  publicCombat,
  startCombat,
  type CombatState,
} from "./combat.js";
import { rollD20, rollNotation } from "./dice.js";
import {
  DUNGEON_ROOMS,
  insideRegion,
  roomForNode,
  type DungeonRoomId,
} from "./dungeon-map.js";
import { DATA_DIR } from "./paths.js";
import type { Player } from "./types.js";

export type { Player };

export type Room = {
  roomCode: string;
  campaignId: string;
  nodeId: string;
  flags: string[];
  players: Player[];
  lastNarration?: string;
  lastDice?: { roller: string; notation: string; values: number[]; total: number; id?: string; purpose?: string; label?: string; modifier?: number; sides?: number[]; isCrit?: boolean; isFumble?: boolean };
  lastDiceBatch?: Array<{
    id: string;
    roller: string;
    notation: string;
    values: number[];
    total: number;
    purpose?: string;
    label?: string;
    modifier?: number;
    sides?: number[];
    isCrit?: boolean;
    isFumble?: boolean;
  }>;
  combat?: CombatState;
  puzzleProgress?: string[];
  puzzleFails?: number;
  puzzleFeedback?: string;
  /** Rooms the party has physically entered — fog lifts only for these. */
  visitedRooms: DungeonRoomId[];
  mapTokens: Array<{
    playerId: string;
    name: string;
    room: DungeonRoomId;
    x: number;
    y: number;
  }>;
  updatedAt: string;
};

const rooms = new Map<string, Room>();

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function bootLocal(): void {
  loadCampaign();
}

export function createRoom(): Room {
  let roomCode = code();
  while (rooms.has(roomCode)) roomCode = code();
  const manifest = getManifest();
  const room: Room = {
    roomCode,
    campaignId: manifest.id,
    nodeId: manifest.startNodeId,
    flags: [],
    players: [],
    visitedRooms: [],
    mapTokens: [],
    updatedAt: new Date().toISOString(),
  };
  applyNodeNarration(room);
  rooms.set(roomCode, room);
  persist(room);
  return room;
}

export function getRoom(roomCode: string): Room | undefined {
  return rooms.get(roomCode.toUpperCase());
}

export function joinRoom(
  roomCode: string,
  displayName: string,
  characterId: string,
): Room {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.players.length >= 3) throw new Error("ROOM_FULL");
  const pregen = getPregen(characterId);
  if (!pregen) throw new Error("BAD_CHARACTER");
  if (room.players.some((p) => p.characterId === characterId)) {
    throw new Error("CHARACTER_TAKEN");
  }
  const playerId = `P${room.players.length + 1}`;
  room.players.push({
    playerId,
    displayName: displayName || pregen.name,
    characterId: pregen.id,
    characterName: pregen.name,
  });
  placeParty(room);
  room.updatedAt = new Date().toISOString();
  persist(room);
  return room;
}

function applyNodeNarration(room: Room): void {
  const node = getNode(room.nodeId);
  if (node?.narration?.text) room.lastNarration = node.narration.text;
}

function hasFlag(room: Room, f: string): boolean {
  return room.flags.includes(f);
}

function setFlags(room: Room, flags?: string[]): void {
  if (!flags) return;
  for (const f of flags) {
    if (!room.flags.includes(f)) room.flags.push(f);
  }
}

function filterChoices(
  room: Room,
  choices: NonNullable<StoryNode["choices"]>,
): NonNullable<StoryNode["choices"]> {
  return choices.filter((c) => {
    if (c.requireFlags?.some((f) => !hasFlag(room, f))) return false;
    if (c.excludeFlags?.some((f) => hasFlag(room, f))) return false;
    return true;
  });
}

function hubChoices(room: Room): NonNullable<StoryNode["choices"]> {
  const choices: NonNullable<StoryNode["choices"]> = [];
  if (!hasFlag(room, "tiles_done")) {
    choices.push({
      id: "tiles",
      label: "Study the mosaic tiles (poem riddle)",
      next: "corridor_tiles",
    });
  }
  if (!hasFlag(room, "seal_cellar")) {
    choices.push({
      id: "cellar",
      label: "Enter the Cellar",
      next: "cellar_enter",
    });
  } else {
    choices.push({
      id: "cellar_done",
      label: "Cellar (Seal claimed) — glance inside",
      next: "corridor_hub",
    });
  }
  if (!hasFlag(room, "seal_well")) {
    choices.push({
      id: "well",
      label: "Enter the Well chamber",
      next: "well_enter",
    });
  }
  if (!hasFlag(room, "seal_store")) {
    choices.push({
      id: "store",
      label: "Enter the Alchemical Store",
      next: "store_enter",
    });
  }
  const seals =
    (hasFlag(room, "seal_cellar") ? 1 : 0) +
    (hasFlag(room, "seal_well") ? 1 : 0) +
    (hasFlag(room, "seal_store") ? 1 : 0);
  if (seals >= 3 && !hasFlag(room, "spider_dead")) {
    choices.push({
      id: "lab",
      label: "Open the Laboratory — Door of Three Seals",
      next: "lab_vault",
    });
  } else if (seals < 3) {
    choices.push({
      id: "lab_locked",
      label: `Iron door (need ${3 - seals} more seal${3 - seals === 1 ? "" : "s"})`,
      next: "lab_locked_peek",
    });
  }
  if (hasFlag(room, "spider_dead") && !hasFlag(room, "magma_done")) {
    choices.push({
      id: "leave",
      label: "Head back toward the brewery stairs…",
      next: "cliffhanger_magma",
    });
  }
  return choices.filter((c) => c.id !== "cellar_done");
}

function resolveChoices(room: Room, node: StoryNode) {
  if (node.type === "hub" || node.hubId === "corridor") {
    return hubChoices(room);
  }
  if (node.type === "puzzle" && node.puzzle) {
    return node.puzzle.options.map((o) => ({
      id: o.id,
      label: o.label,
      next: room.nodeId, // handled specially
    }));
  }
  return filterChoices(room, node.choices ?? []);
}

function placeParty(room: Room): void {
  const area = roomForNode(room.nodeId);
  if (!area) return;
  if (!room.visitedRooms) room.visitedRooms = [];
  if (!room.visitedRooms.includes(area)) room.visitedRooms.push(area);
  if (!room.mapTokens) room.mapTokens = [];
  const region = DUNGEON_ROOMS[area];
  room.players.forEach((p, i) => {
    const spread = (i - (room.players.length - 1) / 2) * 3.2;
    let tok = room.mapTokens.find((t) => t.playerId === p.playerId);
    if (!tok) {
      tok = {
        playerId: p.playerId,
        name: p.characterName,
        room: area,
        x: region.left + region.width / 2 + spread,
        y: region.top + region.height / 2,
      };
      room.mapTokens.push(tok);
    } else if (tok.room !== area) {
      tok.room = area;
      tok.name = p.characterName;
      tok.x = region.left + region.width / 2 + spread;
      tok.y = region.top + region.height / 2;
    }
  });
}

function goTo(room: Room, nextId: string): void {
  if (nextId === "END_SAVE" || nextId === "END_WIN") {
    room.nodeId = nextId;
    room.lastNarration =
      nextId === "END_WIN"
        ? "Adventure complete. Glowkindle pours the last of the Tashalar Pale Ale. The table is the TV."
        : "Progress saved. Resume later for the magma ambush.";
    room.combat = undefined;
    room.puzzleProgress = undefined;
    room.puzzleFails = undefined;
    room.updatedAt = new Date().toISOString();
    persist(room);
    return;
  }
  room.nodeId = nextId;
  room.combat = undefined;
  room.puzzleProgress = undefined;
  room.puzzleFails = undefined;
  room.puzzleFeedback = undefined;
  const node = getNode(nextId);
  if (!node) throw new Error("BAD_NODE");
  if (node.type === "encounter" && node.encounterId) {
    if (room.players.length < 1) throw new Error("NEED_PLAYER");
    room.combat = startCombat(node.encounterId, room.players);
    room.lastNarration = `Combat: ${node.encounterId}. Move on the grid, then Attack / End Turn.`;
  } else {
    applyNodeNarration(room);
    if (node.type === "puzzle" && node.puzzle?.hint) {
      room.lastNarration = `${node.narration?.text ?? ""}\n\n${node.puzzle.hint}`.trim();
    }
  }
  placeParty(room);
  room.updatedAt = new Date().toISOString();
  persist(room);
}

function publishedScene(room: Room, node: ReturnType<typeof getNode>): string {
  if (room.combat) {
    const id = `${node?.encounterId ?? ""} ${node?.id ?? ""}`;
    if (/spider|magma/i.test(id)) return "boss";
    return "combat";
  }
  if (node?.id === "END_WIN") return "victory";
  return node?.alexaScene ?? "explore";
}

export function publicState(room: Room, viewerPlayerId?: string) {
  const node = getNode(room.nodeId);
  const choices = node ? resolveChoices(room, node) : [];
  const progress =
    node?.type === "puzzle" && node.puzzle
      ? {
          kind: "sequence" as const,
          picked: room.puzzleProgress ?? [],
          need: node.puzzle.solution.length,
          fails: room.puzzleFails ?? 0,
          feedback: room.puzzleFeedback ?? "",
        }
      : null;
  return {
    roomCode: room.roomCode,
    campaignId: room.campaignId,
    nodeId: room.nodeId,
    nodeType: node?.type ?? "end",
    alexaScene: publishedScene(room, node),
    narration: room.lastNarration,
    choices,
    skillCheck: node?.type === "skill_check" ? node.check : undefined,
    puzzle: progress,
    players: room.players,
    flags: room.flags,
    visitedRooms: room.visitedRooms ?? [],
    currentRoom: roomForNode(room.nodeId),
    mapTokens: room.mapTokens ?? [],
    lastDice: room.lastDice,
    lastDiceBatch: room.lastDiceBatch ?? null,
    combat: room.combat ? publicCombat(room.combat, viewerPlayerId) : null,
    savePrompt: node?.savePrompt === true,
    localPlayerId: viewerPlayerId ?? null,
  };
}

export function choose(
  roomCode: string,
  choiceId: string,
  playerId?: string,
): Room {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  const node = getNode(room.nodeId);
  if (!node) throw new Error("BAD_NODE");

  if (node.type === "encounter") {
    throw new Error("USE_COMBAT_ACTIONS");
  }

  if (node.type === "skill_check") {
    return resolveSkillCheck(room, node, choiceId === "fail");
  }

  if (node.type === "puzzle" && node.puzzle) {
    return resolvePuzzle(room, node, choiceId);
  }

  const choices = resolveChoices(room, node);
  const choice = choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error("INVALID_CHOICE");
  setFlags(room, choice.flagsSet);
  void playerId;

  // Returning to hub after a side room: maybe hole spawn
  if (choice.next === "corridor_hub") {
    const hole = maybeHoleAmbush(room);
    if (hole) {
      goTo(room, hole);
      return room;
    }
  }

  goTo(room, choice.next);
  return room;
}

function maybeHoleAmbush(room: Room): string | null {
  if (hasFlag(room, "spider_dead")) return null;
  const seals =
    (hasFlag(room, "seal_cellar") ? 1 : 0) +
    (hasFlag(room, "seal_well") ? 1 : 0) +
    (hasFlag(room, "seal_store") ? 1 : 0);
  // After first side-room seal: rats once
  if (seals === 1 && !hasFlag(room, "hole_rats_done")) {
    room.flags.push("hole_rats_done");
    return "hole_rats";
  }
  // After second seal: centipedes once
  if (seals === 2 && !hasFlag(room, "hole_centipedes_done")) {
    room.flags.push("hole_centipedes_done");
    return "hole_centipedes";
  }
  return null;
}

function resolvePuzzle(room: Room, node: StoryNode, optionId: string): Room {
  const puzzle = node.puzzle!;
  if (optionId === "__reset__") {
    room.puzzleProgress = [];
    room.puzzleFails = 0;
    room.puzzleFeedback = "Chain cleared. The puzzle is still open.";
    room.lastNarration = `${node.narration?.text ?? ""}\n\n${room.puzzleFeedback}`.trim();
    room.updatedAt = new Date().toISOString();
    persist(room);
    return room;
  }
  const progress = [...(room.puzzleProgress ?? [])];
  const expected = puzzle.solution[progress.length];
  if (optionId === expected) {
    progress.push(optionId);
    room.puzzleProgress = progress;
    room.puzzleFeedback = "";
    if (progress.length >= puzzle.solution.length) {
      return finishPuzzleSuccess(room, node);
    }
    room.lastNarration = `${node.narration?.text ?? ""}\n\n${puzzle.hint ?? ""}\n\nSequence so far: ${progress.length}/${puzzle.solution.length}.`.trim();
    room.updatedAt = new Date().toISOString();
    persist(room);
    return room;
  }

  return notePuzzleMiss(room, node);
}

/** A wrong guess never leaves the puzzle and never throws. */
function notePuzzleMiss(room: Room, node: StoryNode): Room {
  const puzzle = node.puzzle!;
  room.puzzleFails = (room.puzzleFails ?? 0) + 1;
  if (puzzle.resetOnFail !== false) room.puzzleProgress = [];
  const maxFails = puzzle.maxFailsBeforePenalty ?? 2;
  if (room.puzzleFails >= maxFails) {
    return punishAndStay(room, node);
  }
  room.puzzleFeedback = `Wrong — sequence reset. Fault ${room.puzzleFails}/${maxFails}. Try again.`;
  room.lastNarration = `${node.narration?.text ?? ""}\n\n${puzzle.hint ?? ""}\n\n${room.puzzleFeedback}`.trim();
  room.updatedAt = new Date().toISOString();
  persist(room);
  return room;
}

function punishAndStay(room: Room, node: StoryNode): Room {
  const branch = node.onFailure;
  const effectNote = describePenalty(room, branch?.effects);
  const base =
    branch?.narration?.text ??
    "The mechanism lashes out, then falls quiet.";
  room.puzzleProgress = [];
  room.puzzleFails = 0;
  room.puzzleFeedback = `${base}${effectNote} The puzzle resets — you can try again.`;
  room.lastNarration = room.puzzleFeedback;
  room.updatedAt = new Date().toISOString();
  persist(room);
  return room;
}

function describePenalty(room: Room, effects: unknown[] | undefined): string {
  if (!effects?.length) return "";
  const notes: string[] = [];
  for (const raw of effects) {
    const effect = raw as {
      type?: string;
      damage?: { dice: string; type: string };
    };
    if (effect.type === "saving_throw" && effect.damage?.dice) {
      const dmg = rollNotation(effect.damage.dice);
      room.lastDice = {
        roller: "Trap",
        notation: effect.damage.dice,
        values: dmg.values,
        total: dmg.total,
        sides: dmg.sides,
        modifier: dmg.modifier,
        purpose: "damage",
        label: effect.damage.type,
        id: `trap-${Date.now()}`,
      };
      room.lastDiceBatch = [room.lastDice];
      notes.push(` (${dmg.total} ${effect.damage.type}).`);
    }
  }
  return notes.join("");
}

function finishPuzzleSuccess(room: Room, node: StoryNode): Room {
  const branch = node.onSuccess;
  if (!branch) throw new Error("NO_BRANCH");
  if (branch.narration?.text) room.lastNarration = branch.narration.text;
  setFlags(room, branch.flagsSet);
  room.puzzleProgress = undefined;
  room.puzzleFails = undefined;
  room.puzzleFeedback = undefined;
  if (branch.next === "corridor_hub") {
    const hole = maybeHoleAmbush(room);
    if (hole) {
      goTo(room, hole);
      return room;
    }
  }
  goTo(room, branch.next);
  return room;
}

/** Submit a full sequence at once (interactive vessel/well/vial/mix forms). */
export function solvePuzzleSequence(roomCode: string, sequence: string[]): Room {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  const node = getNode(room.nodeId);
  if (!node || node.type !== "puzzle" || !node.puzzle) {
    throw new Error("NOT_PUZZLE");
  }
  const solution = node.puzzle.solution;
  const ok =
    sequence.length === solution.length &&
    sequence.every((id, i) => id === solution[i]);
  if (ok) {
    return finishPuzzleSuccess(room, node);
  }
  return notePuzzleMiss(room, node);
}

export function mapMove(
  roomCode: string,
  playerId: string,
  x: number,
  y: number,
): Room {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.combat) throw new Error("IN_COMBAT");
  const area = roomForNode(room.nodeId);
  if (!area) throw new Error("NO_MAP_ROOM");
  if (!(room.visitedRooms ?? []).includes(area)) throw new Error("ROOM_HIDDEN");
  const region = DUNGEON_ROOMS[area];
  if (!insideRegion(region, x, y)) throw new Error("OUTSIDE_ROOM");
  if (!room.mapTokens) room.mapTokens = [];
  const player = room.players.find((p) => p.playerId === playerId);
  if (!player) throw new Error("NO_PLAYER");
  let tok = room.mapTokens.find((t) => t.playerId === playerId);
  if (!tok) {
    tok = { playerId, name: player.characterName, room: area, x, y };
    room.mapTokens.push(tok);
  } else {
    tok.x = x;
    tok.y = y;
    tok.room = area;
    tok.name = player.characterName;
  }
  room.updatedAt = new Date().toISOString();
  persist(room);
  return room;
}

export function withdraw(roomCode: string): Room {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.combat?.status === "active") throw new Error("COMBAT_ACTIVE");
  const back: Record<string, string> = {
    fight_well_centipedes: "well_lock",
    fight_cellar_rats: "cellar_enter",
    hole_rats: "corridor_hub",
    hole_centipedes: "corridor_hub",
    fight_spider: "enter_lab",
    fight_magma: "corridor_hub",
    corridor_tiles_force: "corridor_tiles",
  };
  const next = back[room.nodeId] ?? "corridor_hub";
  room.combat = undefined;
  goTo(room, next);
  room.lastNarration = `${room.lastNarration ?? ""}\n\nYou step back. The way is still open.`.trim();
  room.updatedAt = new Date().toISOString();
  persist(room);
  return room;
}

export function combatMove(
  roomCode: string,
  playerId: string,
  x: number,
  y: number,
): Room {
  const room = getRoom(roomCode);
  if (!room?.combat) throw new Error("NO_COMBAT");
  proposeMove(room.combat, playerId, x, y);
  if (room.combat.status === "victory") finishCombat(room);
  room.updatedAt = new Date().toISOString();
  persist(room);
  return room;
}

export function combatAttack(
  roomCode: string,
  playerId: string,
  abilityId: string,
  targetId?: string,
): Room {
  const room = getRoom(roomCode);
  if (!room?.combat) throw new Error("NO_COMBAT");
  const { dice, rolls } = performAttack(room.combat, playerId, abilityId, targetId);
  if (rolls?.length) {
    (room as { lastDiceBatch?: unknown }).lastDiceBatch = rolls;
    room.lastDice = rolls[rolls.length - 1] as typeof room.lastDice;
  } else if (dice) {
    room.lastDice = dice as typeof room.lastDice;
  }
  room.lastNarration = room.combat.log[room.combat.log.length - 1];
  const status = room.combat.status;
  if (status === "victory") finishCombat(room);
  if (status === "defeat") {
    room.lastNarration = "The party is defeated. Reload or end from menu later.";
  }
  room.updatedAt = new Date().toISOString();
  persist(room);
  return room;
}

export function combatEndTurn(roomCode: string, playerId: string): Room {
  const room = getRoom(roomCode);
  if (!room?.combat) throw new Error("NO_COMBAT");
  if (room.combat.status === "victory") {
    finishCombat(room);
    room.updatedAt = new Date().toISOString();
    persist(room);
    return room;
  }
  if (room.combat.status !== "active") throw new Error("COMBAT_OVER");
  endTurn(room.combat, playerId);
  if (room.combat.status === "victory") finishCombat(room);
  room.updatedAt = new Date().toISOString();
  persist(room);
  return room;
}

function finishCombat(room: Room): void {
  const node = getNode(room.nodeId);
  if (node?.encounterId === "lab_infernal_spider") {
    setFlags(room, ["spider_dead"]);
  }
  if (node?.encounterId === "corridor_magma_rat") {
    setFlags(room, ["magma_done"]);
  }
  const next = node?.onVictory || "END_WIN";
  room.lastNarration = "Enemies defeated!";
  room.combat = undefined;
  if (next === "corridor_hub") {
    const hole = maybeHoleAmbush(room);
    if (hole) {
      goTo(room, hole);
      return;
    }
  }
  goTo(room, next);
}

function resolveSkillCheck(room: Room, node: StoryNode, forceFail = false): Room {
  if (!node.check) throw new Error("NO_CHECK");
  const ability = node.check.ability;
  let best = room.players[0];
  let bestMod = -99;
  for (const p of room.players) {
    const pregen = getPregen(p.characterId);
    if (!pregen) continue;
    const mod = abilityMod(pregen.abilities[ability] ?? 10) + 2;
    if (mod > bestMod) {
      bestMod = mod;
      best = p;
    }
  }
  if (!best) throw new Error("NO_PLAYERS");
  const d20 = forceFail ? 1 : rollD20();
  const total = d20 + bestMod;
  room.lastDice = {
    roller: best.characterName,
    notation: `1d20+${bestMod}`,
    values: [d20],
    total,
  };
  const success = !forceFail && total >= node.check.dc;
  const branch = success ? node.onSuccess : node.onFailure;
  if (!branch) throw new Error("NO_BRANCH");
  if (branch.narration?.text) room.lastNarration = branch.narration.text;
  if (branch.flagsSet) {
    for (const f of branch.flagsSet) {
      if (!room.flags.includes(f)) room.flags.push(f);
    }
  }
  if (!success && node.onFailure?.effects?.length) {
    for (const effect of node.onFailure.effects) {
      const e = effect as {
        type?: string;
        damage?: { dice: string; type: string };
      };
      if (e.type === "saving_throw" && e.damage) {
        const dmg = rollNotation(e.damage.dice);
        room.lastNarration = `${branch.narration?.text ?? ""} Fire washes the hall for ${dmg.total} ${e.damage.type}.`;
      }
    }
  }
  goTo(room, branch.next);
  return room;
}

function persist(room: Room): void {
  const file = path.join(DATA_DIR, `room-${room.roomCode}.json`);
  fs.writeFileSync(file, JSON.stringify(room, null, 2));
}

export function loadPersistedRooms(): void {
  if (!fs.existsSync(DATA_DIR)) return;
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.startsWith("room-") || !name.endsWith(".json")) continue;
    try {
      const room = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, name), "utf8"),
      ) as Room;
      if (room.combat) room.combat = undefined;
      rooms.set(room.roomCode, room);
    } catch {
      // ignore
    }
  }
}

export function requestSave(roomCode: string): { room: Room; saveId: string } {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  const saveId = `save-${room.roomCode}-${Date.now().toString(36)}`;
  const dir = path.join(DATA_DIR, "saves");
  fs.mkdirSync(dir, { recursive: true });
  // Persist full snapshot including combat
  fs.writeFileSync(
    path.join(dir, `${saveId}.json`),
    JSON.stringify(room, null, 2),
  );
  room.updatedAt = new Date().toISOString();
  persist(room);
  return { room, saveId };
}

export function resumeSave(saveId: string): Room {
  const file = path.join(DATA_DIR, "saves", `${saveId}.json`);
  if (!fs.existsSync(file)) throw new Error("SAVE_NOT_FOUND");
  const room = JSON.parse(fs.readFileSync(file, "utf8")) as Room;
  // New room code so joiners use fresh session code displayed after resume
  let roomCode = code();
  while (rooms.has(roomCode)) roomCode = code();
  room.roomCode = roomCode;
  room.updatedAt = new Date().toISOString();
  rooms.set(roomCode, room);
  persist(room);
  return room;
}

export function playerDisconnect(roomCode: string, playerId: string): Room | undefined {
  const room = getRoom(roomCode);
  if (!room) return undefined;
  if (room.combat) {
    applyDisconnectDodge(room.combat, playerId);
    if (room.combat.status === "victory") finishCombat(room);
    room.updatedAt = new Date().toISOString();
    persist(room);
  }
  return room;
}

function nearestEnemy(combat: CombatState, playerId: string) {
  const me = combat.tokens.find((t) => t.playerId === playerId && !t.dead);
  if (!me) return null;
  const enemies = combat.tokens.filter((t) => t.kind === "enemy" && !t.dead);
  if (!enemies.length) return null;
  enemies.sort((a, b) => {
    const da = Math.max(Math.abs(a.x - me.x), Math.abs(a.y - me.y));
    const db = Math.max(Math.abs(b.x - me.x), Math.abs(b.y - me.y));
    return da - db;
  });
  return enemies[0];
}

export function voiceIntent(
  roomCode: string,
  playerId: string,
  intent: string,
): Room {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  const node = getNode(room.nodeId);

  if (intent.startsWith("choose_") && node?.type === "story" && node.choices) {
    const idx = Number(intent.split("_")[1]) - 1;
    const choice = node.choices[idx];
    if (!choice) throw new Error("NO_CHOICE");
    return choose(roomCode, choice.id, playerId);
  }
  if (intent === "choose_1" && node?.type === "skill_check") {
    return choose(roomCode, "attempt", playerId);
  }
  if (intent === "end_turn") {
    return combatEndTurn(roomCode, playerId);
  }
  if (intent === "attack_nearest" || intent === "cast_magic_missile") {
    if (!room.combat) throw new Error("NO_COMBAT");
    const target = nearestEnemy(room.combat, playerId);
    if (!target) throw new Error("NO_TARGET");
    const me = room.combat.tokens.find((t) => t.playerId === playerId);
    const abilityId =
      intent === "cast_magic_missile"
        ? "spell_magic_missile"
        : me?.actionIds.find((id) => id.includes("attack") || id.includes("sword") || id.includes("bite") || id.includes("missile")) ||
          me?.actionIds[0];
    if (!abilityId) throw new Error("NO_ABILITY");
    if (intent === "cast_magic_missile" && !me?.actionIds.includes("spell_magic_missile")) {
      throw new Error("NO_MISSILE");
    }
    return combatAttack(roomCode, playerId, abilityId, target.id);
  }
  throw new Error("UNKNOWN_INTENT");
}
