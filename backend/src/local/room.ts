import fs from "node:fs";
import path from "node:path";
import {
  abilityMod,
  getEncounter,
  getManifest,
  getNode,
  getPregen,
  loadCampaign,
  portraitForCharacter,
  type StoryNode,
} from "./campaign.js";
import {
  applyDisconnectDodge,
  endTurn,
  hydrateCombat,
  performAttack,
  proposeMove,
  publicCombat,
  startCombat,
  type CombatState,
} from "./combat.js";
import { rollCheck, rollNotation, type DiceRoll } from "./dice.js";
import {
  DUNGEON_ROOMS,
  insideRegion,
  roomForNode,
  type DungeonRoomId,
} from "./dungeon-map.js";
import { requestNarration } from "./narration.js";
import { DATA_DIR } from "./paths.js";
import type { Player } from "./types.js";

export type { Player };

type Choice = NonNullable<StoryNode["choices"]>[number];

export type Room = {
  roomCode: string;
  campaignId: string;
  nodeId: string;
  flags: string[];
  players: Player[];
  lastNarration?: string;
  /** What the narrator voices for the latest beat; the display text may carry more. */
  voiceText?: string;
  narrationSeq?: number;
  lastDice?: DiceRoll;
  combat?: CombatState;
  /** The fight that just ended, kept so the table can play its last blow. */
  outro?: { combat: CombatState; text: string };
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
  autosaveId?: string;
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

function touch(room: Room): void {
  room.updatedAt = new Date().toISOString();
  persist(room);
}

function narrate(room: Room, display: string, spoken: string = display): void {
  room.lastNarration = display;
  room.voiceText = spoken;
  room.narrationSeq = (room.narrationSeq ?? 0) + 1;
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

function requireRoom(roomCode: string): Room {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  return room;
}

export function joinRoom(
  roomCode: string,
  displayName: string,
  characterId: string,
): { room: Room; playerId: string } {
  const room = requireRoom(roomCode);
  if (room.players.length >= 3) throw new Error("ROOM_FULL");
  const pregen = getPregen(characterId);
  if (!pregen) throw new Error("BAD_CHARACTER");
  if (room.players.some((p) => p.characterId === characterId)) {
    throw new Error("CHARACTER_TAKEN");
  }
  if (room.combat?.status === "active") throw new Error("IN_COMBAT");
  let n = 1;
  while (room.players.some((p) => p.playerId === `P${n}`)) n += 1;
  const playerId = `P${n}`;
  room.players.push({
    playerId,
    displayName: displayName || pregen.name,
    characterId: pregen.id,
    characterName: pregen.name,
  });
  placeParty(room);
  touch(room);
  return { room, playerId };
}

/** A table that dropped (reload, Wi-Fi blip) takes its seat back. */
export function rejoinRoom(roomCode: string, playerId?: string): { room: Room; playerId?: string } {
  const room = requireRoom(roomCode);
  if (playerId && !room.players.some((p) => p.playerId === playerId)) {
    return { room };
  }
  return { room, playerId };
}

function applyNodeNarration(room: Room): void {
  const node = getNode(room.nodeId);
  if (!node?.narration?.text) return;
  narrate(room, node.narration.text);
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

function filterChoices(room: Room, choices: Choice[]): Choice[] {
  return choices.filter((c) => {
    if (c.requireFlags?.some((f) => !hasFlag(room, f))) return false;
    if (c.excludeFlags?.some((f) => hasFlag(room, f))) return false;
    return true;
  });
}

function sealCount(room: Room): number {
  return (
    (hasFlag(room, "seal_cellar") ? 1 : 0) +
    (hasFlag(room, "seal_well") ? 1 : 0) +
    (hasFlag(room, "seal_store") ? 1 : 0)
  );
}

function hubChoices(room: Room): Choice[] {
  const choices: Choice[] = [];
  if (!hasFlag(room, "tiles_done")) {
    choices.push({ id: "tiles", label: "Study the mosaic tiles", next: "corridor_tiles" });
  }
  if (!hasFlag(room, "seal_cellar")) {
    choices.push({ id: "cellar", label: "Enter the Cellar", next: "cellar_enter" });
  }
  if (!hasFlag(room, "seal_well")) {
    choices.push({ id: "well", label: "Enter the Well chamber", next: "well_enter" });
  }
  if (!hasFlag(room, "seal_store")) {
    choices.push({ id: "store", label: "Enter the Alchemical Store", next: "store_enter" });
  }
  const seals = sealCount(room);
  if (seals >= 3 && !hasFlag(room, "spider_dead")) {
    choices.push({ id: "lab", label: "Open the Laboratory — Door of Three Seals", next: "lab_vault" });
  } else if (seals < 3) {
    choices.push({
      id: "lab_locked",
      label: `Iron door (need ${3 - seals} more seal${3 - seals === 1 ? "" : "s"})`,
      next: "lab_locked_peek",
    });
  }
  if (hasFlag(room, "spider_dead") && !hasFlag(room, "magma_done")) {
    choices.push({ id: "leave", label: "Head back toward the brewery stairs…", next: "cliffhanger_magma" });
  }
  return choices;
}

function resolveChoices(room: Room, node: StoryNode): Choice[] {
  if (node.type === "hub" || node.hubId === "corridor") {
    return hubChoices(room);
  }
  if (node.type === "puzzle" && node.puzzle) {
    return node.puzzle.options.map((o) => ({ id: o.id, label: o.label, next: room.nodeId }));
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
  room.outro = undefined;
  room.combat = undefined;
  room.puzzleProgress = undefined;
  room.puzzleFails = undefined;
  room.puzzleFeedback = undefined;
  if (nextId === "END_SAVE" || nextId === "END_WIN") {
    room.nodeId = nextId;
    narrate(
      room,
      nextId === "END_WIN"
        ? "Glowkindle pours the last of the Tashalar Pale Ale into your mugs. The brewery is quiet, the brew is safe, and Luppolandia will drink tonight. Well played."
        : "The table remembers where you stand. When you return, the orange glow will still be waiting in the corridor.",
    );
    touch(room);
    autosave(room);
    return;
  }
  const node = getNode(nextId);
  if (!node) throw new Error("BAD_NODE");
  room.nodeId = nextId;
  if (node.type === "encounter" && node.encounterId) {
    if (room.players.length < 1) throw new Error("NEED_PLAYER");
    room.combat = startCombat(node.encounterId, room.players);
    const encounter = getEncounter(node.encounterId);
    narrate(room, encounter?.intro ?? `${encounter?.name ?? "Foes"} block the way. Steel out.`);
  } else {
    applyNodeNarration(room);
  }
  placeParty(room);
  touch(room);
  autosave(room);
}

function publishedScene(room: Room, node: ReturnType<typeof getNode>): string {
  if (room.combat) {
    const id = `${node?.encounterId ?? ""} ${node?.id ?? ""}`;
    if (/spider|magma/i.test(id)) return "boss";
    return "combat";
  }
  if (node?.id === "END_WIN" || room.nodeId === "END_WIN") return "victory";
  return node?.alexaScene ?? "explore";
}

function voiceFor(text: string | undefined, seq: number) {
  if (!text) return null;
  return { key: requestNarration(text), seq, text };
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
  const seq = room.narrationSeq ?? 0;
  return {
    roomCode: room.roomCode,
    campaignId: room.campaignId,
    nodeId: room.nodeId,
    nodeType: node?.type ?? "end",
    alexaScene: publishedScene(room, node),
    narration: room.lastNarration,
    narrationSeq: seq,
    voice: voiceFor(room.voiceText ?? room.lastNarration, seq),
    choices: choices.map((c) => ({ id: c.id, label: c.label })),
    skillCheck: node?.type === "skill_check" ? node.check : undefined,
    puzzle: progress,
    players: room.players.map((p) => ({ ...p, portrait: portraitForCharacter(p.characterId) })),
    flags: room.flags,
    seals: sealCount(room),
    visitedRooms: room.visitedRooms ?? [],
    currentRoom: roomForNode(room.nodeId),
    mapTokens: room.mapTokens ?? [],
    lastDice: room.lastDice ?? null,
    combat: room.combat ? publicCombat(room.combat, viewerPlayerId) : null,
    combatOutro: room.outro
      ? {
          ...publicCombat(room.outro.combat, viewerPlayerId),
          outroText: room.outro.text,
          voice: voiceFor(room.outro.text, room.outro.combat.seq),
        }
      : null,
    savePrompt: node?.savePrompt === true,
    autosaveId: room.autosaveId ?? null,
    localPlayerId: viewerPlayerId ?? null,
  };
}

export function choose(roomCode: string, choiceId: string): Room {
  const room = requireRoom(roomCode);
  const node = getNode(room.nodeId);
  if (!node) {
    if (room.nodeId === "END_SAVE" || room.nodeId === "END_WIN") throw new Error("ADVENTURE_OVER");
    throw new Error("BAD_NODE");
  }
  if (node.type === "encounter") {
    if (room.combat?.status === "active") throw new Error("USE_COMBAT_ACTIONS");
    throw new Error("COMBAT_OVER");
  }
  if (node.type === "skill_check") {
    return resolveSkillCheck(room, node, choiceId === "fail");
  }
  if (node.type === "puzzle" && node.puzzle) {
    return resolvePuzzle(room, node, choiceId);
  }

  const choice = resolveChoices(room, node).find((c) => c.id === choiceId);
  if (!choice) throw new Error("INVALID_CHOICE");
  setFlags(room, choice.flagsSet);
  room.lastDice = undefined;

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
  const seals = sealCount(room);
  if (seals === 1 && !hasFlag(room, "hole_rats_done")) {
    room.flags.push("hole_rats_done");
    return "hole_rats";
  }
  if (seals === 2 && !hasFlag(room, "hole_centipedes_done")) {
    room.flags.push("hole_centipedes_done");
    return "hole_centipedes";
  }
  return null;
}

function puzzleText(node: StoryNode, tail: string): string {
  return [node.narration?.text ?? "", tail].filter(Boolean).join("\n\n").trim();
}

function resolvePuzzle(room: Room, node: StoryNode, optionId: string): Room {
  const puzzle = node.puzzle!;
  if (optionId === "__reset__") {
    room.puzzleProgress = [];
    room.puzzleFails = 0;
    room.puzzleFeedback = "Chain cleared. The mosaic waits.";
    narrate(room, puzzleText(node, room.puzzleFeedback), room.puzzleFeedback);
    touch(room);
    return room;
  }
  if (!puzzle.options.some((o) => o.id === optionId) && !puzzle.solution.includes(optionId)) {
    return notePuzzleMiss(room, node);
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
    const line = `The tile sinks with a soft click. ${progress.length} of ${puzzle.solution.length}.`;
    narrate(room, puzzleText(node, line), line);
    touch(room);
    return room;
  }
  return notePuzzleMiss(room, node);
}

/** A wrong guess earns a nudge first; the last allowed fault springs the room's consequence. */
function notePuzzleMiss(room: Room, node: StoryNode): Room {
  const puzzle = node.puzzle!;
  room.puzzleFails = (room.puzzleFails ?? 0) + 1;
  if (puzzle.resetOnFail !== false) room.puzzleProgress = [];
  const maxFails = puzzle.maxFailsBeforePenalty ?? 2;
  if (room.puzzleFails >= maxFails) {
    return failPuzzle(room, node);
  }
  const warn = room.puzzleFails === maxFails - 1 ? " One more mistake and it will bite." : "";
  const line = `Wrong. The mechanism grinds and resets.${warn}${puzzle.nudge ? ` ${puzzle.nudge}` : ""}`;
  room.puzzleFeedback = line;
  narrate(room, puzzleText(node, line), line);
  touch(room);
  return room;
}

function failPuzzle(room: Room, node: StoryNode): Room {
  const branch = node.onFailure;
  const note = applyPenalty(room, branch?.effects);
  const base = branch?.narration?.text ?? "The mechanism lashes out, then falls quiet.";
  if (!branch?.next) {
    room.puzzleProgress = [];
    room.puzzleFails = 0;
    room.puzzleFeedback = `${base}${note} The mechanism resets. You can try again.`;
    narrate(room, puzzleText(node, room.puzzleFeedback), room.puzzleFeedback);
    touch(room);
    return room;
  }
  const dice = room.lastDice;
  setFlags(room, branch.flagsSet);
  goTo(room, branch.next);
  room.lastDice = dice;
  prefixNarration(room, `${base}${note}`);
  return room;
}

function applyPenalty(room: Room, effects: unknown[] | undefined): string {
  if (!effects?.length) return "";
  const notes: string[] = [];
  for (const raw of effects) {
    const effect = raw as {
      type?: string;
      ability?: string;
      dc?: number;
      damage?: { dice: string; type: string };
    };
    if (effect.type !== "saving_throw" || !effect.damage?.dice) continue;
    const victim = bestPlayer(room, effect.ability ?? "dex");
    const save = rollCheck({
      roller: victim?.name ?? "The party",
      label: `${(effect.ability ?? "dex").toUpperCase()} save · trap`,
      bonus: victim?.mod ?? 0,
      dc: effect.dc ?? 12,
      purpose: "save",
    });
    const dmg = rollNotation(effect.damage.dice);
    const taken = save.outcome === "success" ? Math.floor(dmg.total / 2) : dmg.total;
    room.lastDice = save;
    notes.push(
      save.outcome === "success"
        ? ` ${victim?.name ?? "You"} twists aside and takes only ${taken} ${effect.damage.type}.`
        : ` ${victim?.name ?? "You"} takes ${taken} ${effect.damage.type}.`,
    );
  }
  return notes.join("");
}

function finishPuzzleSuccess(room: Room, node: StoryNode): Room {
  const branch = node.onSuccess;
  if (!branch) throw new Error("NO_BRANCH");
  setFlags(room, branch.flagsSet);
  const successLine = branch.narration?.text;
  if (branch.next === "corridor_hub") {
    const hole = maybeHoleAmbush(room);
    if (hole) {
      goTo(room, hole);
      if (successLine) prefixNarration(room, successLine);
      return room;
    }
  }
  goTo(room, branch.next);
  if (successLine) prefixNarration(room, successLine);
  return room;
}

function prefixNarration(room: Room, line: string): void {
  const display = `${line}\n\n${room.lastNarration ?? ""}`.trim();
  const spoken = `${line}\n\n${room.voiceText ?? ""}`.trim();
  narrate(room, display, spoken);
  persist(room);
}

/** Submit a full sequence at once (interactive vessel/well/vial/mix forms). */
export function solvePuzzleSequence(roomCode: string, sequence: string[]): Room {
  const room = requireRoom(roomCode);
  const node = getNode(room.nodeId);
  if (!node || node.type !== "puzzle" || !node.puzzle) {
    throw new Error("NOT_PUZZLE");
  }
  const solution = node.puzzle.solution;
  const ok = sequence.length === solution.length && sequence.every((id, i) => id === solution[i]);
  if (ok) return finishPuzzleSuccess(room, node);
  return notePuzzleMiss(room, node);
}

export function mapMove(roomCode: string, playerId: string, x: number, y: number): Room {
  const room = requireRoom(roomCode);
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
  touch(room);
  return room;
}

const RETREAT: Record<string, string> = {
  fight_well_centipedes: "well_lock",
  fight_cellar_rats: "cellar_enter",
  hole_rats: "corridor_hub",
  hole_centipedes: "corridor_hub",
  fight_spider: "enter_lab",
  fight_magma: "cliffhanger_magma",
};

export function withdraw(roomCode: string): Room {
  const room = requireRoom(roomCode);
  if (room.combat?.status === "active") throw new Error("COMBAT_ACTIVE");
  const next = RETREAT[room.nodeId] ?? "corridor_hub";
  goTo(room, next);
  const line = "You drag each other back to safer stone and catch your breath. The way is still open.";
  narrate(room, `${line}\n\n${room.lastNarration ?? ""}`.trim(), line);
  touch(room);
  return room;
}

/** After a defeat, the same fight again from the top — nobody is stuck on a dead board. */
export function retryCombat(roomCode: string): Room {
  const room = requireRoom(roomCode);
  const node = getNode(room.nodeId);
  if (node?.type !== "encounter") throw new Error("NO_COMBAT");
  if (room.combat?.status === "active") throw new Error("COMBAT_ACTIVE");
  goTo(room, room.nodeId);
  const line = "Breath returns. Steel is lifted again. The fight begins anew.";
  narrate(room, `${line}\n\n${room.lastNarration ?? ""}`.trim(), `${line} ${room.voiceText ?? ""}`.trim());
  touch(room);
  return room;
}

function requireCombat(room: Room): CombatState {
  if (!room.combat) throw new Error("NO_COMBAT");
  return room.combat;
}

function afterCombatAction(room: Room): void {
  const combat = requireCombat(room);
  if (combat.status === "victory") finishCombat(room);
  else if (combat.status === "defeat") {
    narrate(
      room,
      "Darkness takes the party. But the tale is not over. Rise again and face them, or step back and gather your strength.",
    );
  }
  touch(room);
}

export function combatMove(roomCode: string, playerId: string, x: number, y: number): Room {
  const room = requireRoom(roomCode);
  proposeMove(requireCombat(room), playerId, x, y);
  afterCombatAction(room);
  return room;
}

export function combatAttack(roomCode: string, playerId: string, abilityId: string, targetId?: string): Room {
  const room = requireRoom(roomCode);
  performAttack(requireCombat(room), playerId, abilityId, targetId);
  afterCombatAction(room);
  return room;
}

export function combatEndTurn(roomCode: string, playerId: string): Room {
  const room = requireRoom(roomCode);
  const combat = requireCombat(room);
  if (combat.status !== "active") throw new Error("COMBAT_OVER");
  endTurn(combat, playerId);
  afterCombatAction(room);
  return room;
}

function finishCombat(room: Room): void {
  const combat = requireCombat(room);
  const node = getNode(room.nodeId);
  if (node?.encounterId === "lab_infernal_spider") setFlags(room, ["spider_dead"]);
  if (node?.encounterId === "corridor_magma_rat") setFlags(room, ["magma_done"]);
  const encounter = node?.encounterId ? getEncounter(node.encounterId) : undefined;
  const next = node?.onVictory || "END_WIN";
  const hole = next === "corridor_hub" ? maybeHoleAmbush(room) : null;
  goTo(room, hole ?? next);
  room.outro = { combat, text: encounter?.outro ?? "The last foe falls. Silence settles over the stones." };
}

function bestPlayer(room: Room, ability: string, skill?: string): { player: Player; name: string; mod: number } | null {
  let best: { player: Player; name: string; mod: number } | null = null;
  for (const p of room.players) {
    const pregen = getPregen(p.characterId);
    if (!pregen) continue;
    const skilled = skill ? (pregen as { skills?: string[] }).skills?.includes(skill) : true;
    const mod = abilityMod(pregen.abilities[ability] ?? 10) + (skilled ? pregen.proficiencyBonus ?? 2 : 0);
    if (!best || mod > best.mod) best = { player: p, name: p.characterName, mod };
  }
  return best;
}

function resolveSkillCheck(room: Room, node: StoryNode, forceFail = false): Room {
  if (!node.check) throw new Error("NO_CHECK");
  const best = bestPlayer(room, node.check.ability, node.check.skill);
  if (!best) throw new Error("NO_PLAYERS");
  const roll = rollCheck({
    roller: best.name,
    label: `${node.check.skill ?? node.check.ability.toUpperCase()} check`,
    bonus: best.mod,
    dc: node.check.dc,
    purpose: "check",
    forceNatural: forceFail ? 1 : undefined,
  });
  const success = roll.outcome === "success";
  const branch = success ? node.onSuccess : node.onFailure;
  if (!branch) throw new Error("NO_BRANCH");
  setFlags(room, branch.flagsSet);
  let line = branch.narration?.text ?? "";
  if (!success && node.onFailure?.effects?.length) {
    for (const effect of node.onFailure.effects) {
      const e = effect as { type?: string; damage?: { dice: string; type: string } };
      if (e.type === "saving_throw" && e.damage) {
        const dmg = rollNotation(e.damage.dice);
        line = `${line} It costs ${dmg.total} ${e.damage.type}.`.trim();
      }
    }
  }
  goTo(room, branch.next);
  room.lastDice = roll;
  if (line) prefixNarration(room, line);
  touch(room);
  return room;
}

function persist(room: Room): void {
  const file = path.join(DATA_DIR, `room-${room.roomCode}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(room));
  fs.renameSync(tmp, file);
}

/** Every new scene is a checkpoint the table can resume from. */
function autosave(room: Room): void {
  const dir = path.join(DATA_DIR, "saves");
  fs.mkdirSync(dir, { recursive: true });
  room.autosaveId = `auto-${room.roomCode}`;
  const snapshot: Room = { ...room, outro: undefined };
  fs.writeFileSync(path.join(dir, `${room.autosaveId}.json`), JSON.stringify(snapshot));
}

export function loadPersistedRooms(): void {
  if (!fs.existsSync(DATA_DIR)) return;
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.startsWith("room-") || !name.endsWith(".json")) continue;
    try {
      const room = JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8")) as Room;
      if (room.combat) hydrateCombat(room.combat);
      room.outro = undefined;
      rooms.set(room.roomCode, room);
    } catch {
      // A half-written file from a crash is not worth failing the boot for.
    }
  }
}

export function requestSave(roomCode: string): { room: Room; saveId: string } {
  const room = requireRoom(roomCode);
  const saveId = `save-${room.roomCode}-${Date.now().toString(36)}`;
  const dir = path.join(DATA_DIR, "saves");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${saveId}.json`), JSON.stringify({ ...room, outro: undefined }, null, 2));
  touch(room);
  return { room, saveId };
}

export function resumeSave(saveId: string): Room {
  if (!/^[\w-]+$/.test(saveId)) throw new Error("SAVE_NOT_FOUND");
  const file = path.join(DATA_DIR, "saves", `${saveId}.json`);
  if (!fs.existsSync(file)) throw new Error("SAVE_NOT_FOUND");
  const room = JSON.parse(fs.readFileSync(file, "utf8")) as Room;
  if (room.combat) hydrateCombat(room.combat);
  room.outro = undefined;
  let roomCode = code();
  while (rooms.has(roomCode)) roomCode = code();
  room.roomCode = roomCode;
  room.autosaveId = undefined;
  rooms.set(roomCode, room);
  touch(room);
  return room;
}

export function playerDisconnect(roomCode: string, playerId: string): Room | undefined {
  const room = getRoom(roomCode);
  if (!room?.combat) return undefined;
  applyDisconnectDodge(room.combat, playerId);
  afterCombatAction(room);
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

export function voiceIntent(roomCode: string, playerId: string, intent: string): Room {
  const room = requireRoom(roomCode);
  const node = getNode(room.nodeId);

  if (intent.startsWith("choose_") && node && (node.type === "story" || node.type === "hub")) {
    const idx = Number(intent.split("_")[1]) - 1;
    const choice = resolveChoices(room, node)[idx];
    if (!choice) throw new Error("NO_CHOICE");
    return choose(roomCode, choice.id);
  }
  if (intent === "choose_1" && node?.type === "skill_check") {
    return choose(roomCode, "attempt");
  }
  if (intent === "end_turn") {
    return combatEndTurn(roomCode, playerId);
  }
  if (intent === "attack_nearest" || intent === "cast_magic_missile") {
    const combat = requireCombat(room);
    const target = nearestEnemy(combat, playerId);
    if (!target) throw new Error("NO_TARGET");
    const me = combat.tokens.find((t) => t.playerId === playerId);
    if (intent === "cast_magic_missile" && !me?.actionIds.includes("spell_magic_missile")) {
      throw new Error("NO_MISSILE");
    }
    const abilityId =
      intent === "cast_magic_missile"
        ? "spell_magic_missile"
        : (me?.characterId ? getPregen(me.characterId)?.guidedDefaultAction : undefined) ??
          me?.actionIds.find((id) => id.endsWith("_attack"));
    if (!abilityId) throw new Error("NO_ABILITY");
    return combatAttack(roomCode, playerId, abilityId, target.id);
  }
  throw new Error("UNKNOWN_INTENT");
}

/** Every line the campaign can narrate verbatim, for the narrator's warm cache. */
export function scriptedLines(): string[] {
  const lines: string[] = [];
  const nodeIds = new Set<string>();
  const manifest = getManifest();
  const walk = [manifest.startNodeId];
  while (walk.length) {
    const id = walk.pop()!;
    if (nodeIds.has(id)) continue;
    nodeIds.add(id);
    const node = getNode(id);
    if (!node) continue;
    for (const c of node.choices ?? []) walk.push(c.next);
    for (const next of [node.onVictory, node.onSuccess?.next, node.onFailure?.next]) if (next) walk.push(next);
    if (node.type === "hub") walk.push("corridor_tiles", "cellar_enter", "well_enter", "store_enter", "lab_vault", "lab_locked_peek", "cliffhanger_magma");
    if (node.narration?.text) {
      lines.push(node.type === "puzzle" && node.puzzle?.hint ? puzzleText(node, "") : node.narration.text);
    }
    if (node.encounterId) {
      const e = getEncounter(node.encounterId);
      if (e?.intro) lines.push(e.intro);
      if (e?.outro) lines.push(e.outro);
    }
  }
  return lines;
}
