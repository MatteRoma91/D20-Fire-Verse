import assert from "node:assert/strict";
import { before, test } from "node:test";
import { choose, createRoom, joinRoom, publicState, solvePuzzleSequence } from "../src/local/room.js";
import { boot, scriptDice } from "./helpers.js";

before(boot);

function atGlowkindle() {
  const created = createRoom();
  const joined = joinRoom(created.roomCode, "A", "torin_emberhand");
  choose(joined.room.roomCode, "go_money", joined.playerId);
  return joined;
}

test("persuasion DC 14 raises the purse to 100", () => {
  const { room, playerId } = atGlowkindle();
  choose(room.roomCode, "ask_more", playerId);
  assert.equal(room.nodeId, "glowkindle_persuade");
  const restore = scriptDice([[20, 20]]);
  choose(room.roomCode, "attempt", playerId);
  restore();
  assert.ok(room.flags.includes("pay_100"));
  assert.equal(room.nodeId, "glowkindle_pay_100");
  assert.match(room.voiceText ?? "", /hundred/i);
});

test("a failed threat drops the offer to 60, take it or leave it", () => {
  const { room, playerId } = atGlowkindle();
  choose(room.roomCode, "ask_more", playerId);
  const restore = scriptDice([
    [20, 1],
    [20, 1],
  ]);
  choose(room.roomCode, "attempt", playerId);
  assert.equal(room.nodeId, "glowkindle_insist");
  choose(room.roomCode, "intimidate", playerId);
  choose(room.roomCode, "attempt", playerId);
  restore();
  assert.ok(room.flags.includes("pay_60"));
  assert.equal(room.nodeId, "glowkindle_pay_60");
  assert.match(room.voiceText ?? "", /Sixty/);
});

test("perception hides the mosaic until someone sees the niche", () => {
  const created = createRoom();
  const { room, playerId } = joinRoom(created.roomCode, "A", "mira_softstep");
  choose(room.roomCode, "go_money", playerId);
  choose(room.roomCode, "accept", playerId);
  choose(room.roomCode, "down", playerId);
  choose(room.roomCode, "hub", playerId);
  assert.equal(room.nodeId, "corridor_scan");
  const miss = scriptDice([[20, 1]]);
  choose(room.roomCode, "attempt", playerId);
  miss();
  assert.equal(room.nodeId, "corridor_hub");
  assert.ok(!room.flags.includes("mosaic_spotted"));
  assert.ok(!publicState(room).choices.some((c) => c.id === "tiles"));

  room.nodeId = "corridor_arrive";
  const see = scriptDice([[20, 20]]);
  choose(room.roomCode, "hub", playerId);
  choose(room.roomCode, "attempt", playerId);
  see();
  assert.ok(room.flags.includes("mosaic_spotted"));
  assert.ok(publicState(room).choices.some((c) => c.id === "tiles"));
});

test("cellar approach shoots an arrow at every hero; tiles_done does not", () => {
  const created = createRoom();
  const { room, playerId } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  const { playerId: p2 } = joinRoom(created.roomCode, "B", "quill_ashmere");
  room.nodeId = "corridor_hub";
  room.flags.push("mosaic_spotted");
  const restore = scriptDice([
    [20, 1],
    [4, 3],
    [20, 1],
    [4, 2],
  ]);
  choose(room.roomCode, "cellar", playerId);
  choose(room.roomCode, "cellar", p2);
  restore();
  assert.equal(room.nodeId, "cellar_enter");
  assert.equal(room.fx, "arrows");
  assert.equal(room.diceQueue?.length, 2);
  assert.ok((room.wounds?.[playerId] ?? 0) >= 1);
  assert.ok((room.wounds?.[p2] ?? 0) >= 1);
  assert.match(room.voiceText ?? "", /Arrows spit/);
  assert.ok(!room.flags.includes("mosaic_spotted"));

  room.flags.push("tiles_done");
  room.nodeId = "corridor_hub";
  choose(room.roomCode, "well", playerId);
  choose(room.roomCode, "well", p2);
  assert.equal(room.nodeId, "well_enter");
  assert.notEqual(room.fx, "arrows");
  assert.ok(!(room.voiceText ?? "").includes("Arrows spit"));
});

test("returning from the hole springs arrows, then the ambush if it is still due", () => {
  const created = createRoom();
  const { room, playerId } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  room.nodeId = "hole_after_rats";
  room.flags.push("seal_cellar");
  const restore = scriptDice([[20, 20]]);
  choose(room.roomCode, "hub", playerId);
  restore();
  assert.equal(room.nodeId, "hole_rats");
  assert.equal(room.fx, "arrows");
});

test("a second mosaic fault stays on the puzzle and uses arrows, not blades", () => {
  const created = createRoom();
  const { room, playerId } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  room.nodeId = "corridor_tiles";
  const restore = scriptDice([
    [20, 1],
    [4, 1],
  ]);
  solvePuzzleSequence(room.roomCode, ["fire", "slate", "black", "violet"], playerId);
  solvePuzzleSequence(room.roomCode, ["fire", "slate", "black", "violet"], playerId);
  restore();
  assert.equal(room.nodeId, "corridor_tiles");
  assert.match(room.puzzleFeedback ?? "", /Arrows spit/);
  assert.doesNotMatch(room.puzzleFeedback ?? "", /2d10|blades/i);
  assert.equal(room.fx, "arrows");
});
