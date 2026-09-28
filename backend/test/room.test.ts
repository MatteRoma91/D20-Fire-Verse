import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { describeError } from "@d20-fireverse/protocol";
import {
  choose,
  combatEndTurn,
  createRoom,
  getRoom,
  joinRoom,
  publicState,
  rejoinRoom,
  retryCombat,
  withdraw,
  type Room,
} from "../src/local/room.js";
import { boot, scriptDice } from "./helpers.js";

before(boot);

function pick(room: Room, label: string): Room {
  const state = publicState(room);
  const choice = state.choices.find((c) => c.label.includes(label)) ?? state.choices[0];
  assert.ok(choice, `no choice at ${room.nodeId}`);
  return choose(room.roomCode, choice.id);
}

function toCellarFight(): { room: Room; playerId: string } {
  const created = createRoom();
  const { room, playerId } = joinRoom(created.roomCode, "Tester", "brenna_ironveal");
  for (const label of ["gold", "vague", "Descend", "hub", "Cellar", "steel"]) pick(room, label);
  return { room, playerId };
}

test("the tavern leads down to the cellar fight, voiced and seated", () => {
  const { room, playerId } = toCellarFight();
  assert.equal(room.nodeId, "fight_cellar_rats");
  assert.equal(room.combat?.status, "active");
  const state = publicState(room, playerId);
  assert.ok(state.voice?.text, "the encounter intro is voiced");
  assert.equal(state.voice?.key, null, "tests never load the neural voice");
  assert.ok(state.combat?.events.some((e) => e.kind === "start"));
  const me = state.combat?.tokens.find((t) => t.playerId === playerId);
  assert.ok(me?.portrait?.startsWith("/art/portraits/"));
  assert.throws(() => joinRoom(room.roomCode, "Late", "quill_ashmere"), /IN_COMBAT/);
});

test("a dropped table takes its seat back, a stranger gets the table only", () => {
  const { room, playerId } = toCellarFight();
  assert.equal(rejoinRoom(room.roomCode, playerId).playerId, playerId);
  assert.equal(rejoinRoom(room.roomCode, "P9").playerId, undefined);
  assert.throws(() => rejoinRoom("NOPE00"), /ROOM_NOT_FOUND/);
});

test("a defeat can be retried from the top, never leaving a dead board", () => {
  const { room, playerId } = toCellarFight();
  const combat = room.combat!;
  combat.status = "defeat";
  for (const t of combat.tokens) if (t.kind === "pc") t.dead = true;
  assert.throws(() => combatEndTurn(room.roomCode, playerId), /COMBAT_OVER/);
  retryCombat(room.roomCode);
  assert.equal(room.combat?.status, "active");
  assert.ok(room.combat?.tokens.filter((t) => t.kind === "pc").every((t) => !t.dead && t.hp === t.maxHp));
  assert.match(room.lastNarration ?? "", /anew/);
});

test("withdrawing from a lost fight returns to safe ground", () => {
  const { room } = toCellarFight();
  assert.throws(() => withdraw(room.roomCode), /COMBAT_ACTIVE/);
  room.combat!.status = "defeat";
  withdraw(room.roomCode);
  assert.equal(room.nodeId, "cellar_enter");
  assert.equal(room.combat, undefined);
});

test("puzzles never spell out the answer: a nudge first, then the failure branch keeps the seal", () => {
  const created = createRoom();
  const { room } = joinRoom(created.roomCode, "Tester", "mira_softstep");
  room.nodeId = "cellar_vessels";
  room.combat = undefined;

  choose(room.roomCode, "spiral");
  const first = publicState(room);
  assert.equal(first.puzzle?.fails, 1);
  assert.match(first.puzzle?.feedback ?? "", /Wrong/);
  assert.doesNotMatch(first.narration ?? "", /True order|Eye → X/);

  const restore = scriptDice([[20, 2], [8, 8], [8, 8]]);
  try {
    choose(room.roomCode, "spiral");
  } finally {
    restore();
  }
  assert.equal(getRoom(room.roomCode)?.nodeId, "corridor_hub");
  assert.ok(room.flags.includes("seal_cellar"), "the forced slab still counts as a seal");
  assert.equal(room.lastDice?.outcome, "fail");
  assert.equal(room.lastDice?.vs?.value, 13);
  assert.match(room.lastNarration ?? "", /takes 16 fire/);
});

test("the correct sequence opens the puzzle", () => {
  const created = createRoom();
  const { room } = joinRoom(created.roomCode, "Tester", "quill_ashmere");
  room.nodeId = "cellar_vessels";
  for (const id of ["eye", "x", "wave", "spiral"]) choose(room.roomCode, id);
  assert.ok(room.flags.includes("seal_cellar"));
  assert.notEqual(room.nodeId, "cellar_vessels");
});

test("every error the backend can raise reads like a sentence", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const codes = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        for (const m of fs.readFileSync(full, "utf8").matchAll(/Error\("([A-Z][A-Z0-9_]+)"\)/g)) codes.add(m[1]!);
      }
    }
  };
  walk(root);
  const fallback = describeError("__definitely_unknown__");
  const raw = [...codes].filter((c) => describeError(c) === fallback || describeError(c).includes("_"));
  assert.deepEqual(raw, []);
  assert.equal(describeError("NEED_2_CLASS_SKILLS"), "Pick 2 class skills.");
  assert.ok(codes.size > 40);
});
