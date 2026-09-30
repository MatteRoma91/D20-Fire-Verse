import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  castVote,
  choose,
  claimPuzzle,
  closeVote,
  createRoom,
  joinRoom,
  puzzleHint,
  publicState,
  solvePuzzleSequence,
} from "../src/local/room.js";
import { boot } from "./helpers.js";

before(boot);

test("a lone seat chooses at once; two seats open a vote", () => {
  const a = createRoom();
  const { room: r1, playerId: p1 } = joinRoom(a.roomCode, "A", "brenna_ironveal");
  choose(r1.roomCode, "go_money", p1);
  assert.equal(r1.nodeId, "glowkindle");
  assert.equal(r1.vote, undefined);

  const b = createRoom();
  const { room: r2, playerId: b1 } = joinRoom(b.roomCode, "A", "brenna_ironveal");
  joinRoom(b.roomCode, "B", "quill_ashmere");
  castVote(r2.roomCode, b1, "go_money");
  assert.ok(r2.vote);
  assert.equal(r2.nodeId, "hook_notice");
  const st = publicState(r2);
  assert.equal(st.vote?.votes.length, 1);
});

test("closing a vote with a majority advances the story", () => {
  const created = createRoom();
  const { room, playerId: p1 } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  const { playerId: p2 } = joinRoom(created.roomCode, "B", "quill_ashmere");
  castVote(room.roomCode, p1, "go_money");
  castVote(room.roomCode, p2, "go_money");
  assert.equal(room.nodeId, "glowkindle");
  assert.equal(room.vote, undefined);
});

test("puzzle claim blocks other solvers; hints do not burn faults", () => {
  const created = createRoom();
  const { room, playerId: p1 } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  const { playerId: p2 } = joinRoom(created.roomCode, "B", "mira_softstep");
  for (const id of ["go_money", "accept", "down", "hub", "tiles"]) {
    // solo path after votes would be messy — force node
    void id;
  }
  room.nodeId = "corridor_tiles";
  claimPuzzle(room.roomCode, p1);
  assert.throws(() => claimPuzzle(room.roomCode, p2), /PUZZLE_HELD/);
  puzzleHint(room.roomCode, p2, 0, "violet");
  assert.equal(room.puzzleFails ?? 0, 0);
  assert.equal(publicState(room).puzzle?.hints.length, 1);
  assert.throws(() => solvePuzzleSequence(room.roomCode, ["fire", "slate", "black", "violet"], p2), /NOT_PUZZLE_HOLDER/);
  solvePuzzleSequence(room.roomCode, ["fire", "slate", "black", "violet"], p1);
  assert.equal(room.nodeId, "corridor_tiles");
  assert.ok((room.puzzleFails ?? 0) >= 1);
});

test("well miss reports mastermind pearls and stays until the swarm", () => {
  const created = createRoom();
  const { room, playerId } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  room.nodeId = "well_lock";
  claimPuzzle(room.roomCode, playerId);
  solvePuzzleSequence(room.roomCode, ["wave", "tooth", "spark", "moon"], playerId);
  assert.equal(room.nodeId, "well_lock");
  assert.ok(room.puzzleCoop?.lastScore);
  assert.match(room.puzzleFeedback ?? "", /●|○/);
  solvePuzzleSequence(room.roomCode, ["sun", "skull", "tooth", "spark"], playerId);
  assert.equal(room.nodeId, "fight_well_centipedes");
});

test("vessel failure does not gift the seal", () => {
  const created = createRoom();
  const { room, playerId } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  room.nodeId = "cellar_vessels";
  claimPuzzle(room.roomCode, playerId);
  solvePuzzleSequence(room.roomCode, ["x", "eye", "wave", "spiral"], playerId);
  solvePuzzleSequence(room.roomCode, ["spiral", "wave", "x", "eye"], playerId);
  assert.equal(room.nodeId, "cellar_vessels");
  assert.ok(!room.flags.includes("seal_cellar"));
});

test("mosaic soft-hints accept decorative tiles without burning faults", () => {
  const created = createRoom();
  const { room, playerId: p1 } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  const { playerId: p2 } = joinRoom(created.roomCode, "B", "mira_softstep");
  room.nodeId = "corridor_tiles";
  claimPuzzle(room.roomCode, p1);
  puzzleHint(room.roomCode, p2, 0, "emerald");
  assert.equal(room.puzzleFails ?? 0, 0);
  assert.equal(publicState(room).puzzle?.hints[0]?.optionId, "emerald");
});

test("closeVote with one seat's vote advances", () => {
  const created = createRoom();
  const { room, playerId: p1 } = joinRoom(created.roomCode, "A", "brenna_ironveal");
  joinRoom(created.roomCode, "B", "quill_ashmere");
  castVote(room.roomCode, p1, "go_beer");
  closeVote(room.roomCode);
  assert.equal(room.nodeId, "glowkindle");
});
