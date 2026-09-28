import {
  bootLocal,
  choose,
  combatAttack,
  combatEndTurn,
  combatMove,
  createRoom,
  getRoom,
  joinRoom,
  mapMove,
  publicState,
  solvePuzzleSequence,
} from "../backend/src/local/room.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

bootLocal();
const room = createRoom();
const joined = joinRoom(room.roomCode, "Brenna", "brenna_ironveal");
const pid = joined.players[0]!.playerId;

function pub() {
  const r = getRoom(room.roomCode);
  if (!r) throw new Error("missing room");
  return publicState(r);
}

function pick(id: string) {
  return choose(room.roomCode, id, pid);
}

pick("go_money");
pick("accept");
pick("down");
const pubStairs = pub();
assert(pubStairs.visitedRooms?.includes("stairs"), "stairs not revealed on descend");
assert(pubStairs.mapTokens?.length === 1, "no pawn on stairs");
assert(!pubStairs.visitedRooms?.includes("cellar"), "cellar revealed too early");

pick("hub");
const hub = pub();
assert(hub.visitedRooms?.includes("mosaic"), "mosaic not revealed");
assert(hub.visitedRooms?.includes("stairs"), "stairs fog returned");
assert(!hub.visitedRooms?.includes("well"), "well fog lifted without entry");

pick("tiles");
const bad = solvePuzzleSequence(room.roomCode, ["fire", "slate", "black", "violet"]);
assert(bad.nodeId === "corridor_tiles", `wrong tiles should stay, got ${bad.nodeId}`);
const good = solvePuzzleSequence(room.roomCode, ["violet", "slate", "black", "fire"]);
assert(good.flags.includes("tiles_done"), "tiles solution failed");
assert(good.nodeId === "corridor_hub", `tiles next ${good.nodeId}`);

pick("cellar");
const cellar = pub();
assert(cellar.visitedRooms?.includes("cellar"), "cellar not revealed on entry");
assert(cellar.mapTokens?.[0]?.room === "cellar", "pawn not in cellar");
const moved = mapMove(room.roomCode, pid, 20, 15);
assert(Math.abs((moved.mapTokens[0]?.x ?? 0) - 20) < 0.01, "pawn did not move");
let outside = false;
try {
  mapMove(room.roomCode, pid, 90, 90);
} catch (e) {
  outside = (e as Error).message === "OUTSIDE_ROOM";
}
assert(outside, "walked outside the room");

function fightUntilClear() {
  let guard = 0;
  while (guard < 120) {
    guard += 1;
    const live = getRoom(room.roomCode);
    if (!live?.combat) return;
    const c = live.combat;
    if (c.status === "victory") {
      combatEndTurn(room.roomCode, pid);
      return;
    }
    if (c.status === "defeat") throw new Error(`wiped at ${live.nodeId}`);
    const cur = c.tokens.find((t) => t.id === c.turnOrder[c.turnIndex]);
    const foe = c.tokens.find((t) => t.kind === "enemy" && !t.dead);
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    if (cur?.kind === "pc" && foe && dist(cur, foe) > 1 && cur.movementLeft > 0) {
      const step = [...c.reachable].sort((a, b) => dist(a, foe) - dist(b, foe))[0];
      if (step) {
        combatMove(room.roomCode, pid, step.x, step.y);
        continue;
      }
    }
    if (cur?.kind === "pc" && cur.hasAction && foe && dist(cur, foe) <= 1) {
      combatAttack(room.roomCode, pid, "longsword_attack", foe.id);
      continue;
    }
    combatEndTurn(room.roomCode, pid);
  }
  throw new Error(`combat stuck at ${pub().nodeId}`);
}

pick("fight");
fightUntilClear();
const after = pub();
assert(after.nodeId === "cellar_vessels", `expected vessels, got ${after.nodeId}`);
const wrongV = solvePuzzleSequence(room.roomCode, ["x", "eye", "wave", "spiral"]);
assert(wrongV.nodeId === "cellar_vessels", "bad vessels advanced");
const vessels = solvePuzzleSequence(room.roomCode, ["eye", "x", "wave", "spiral"]);
assert(
  vessels.flags.includes("seal_cellar"),
  `vessels failed at ${vessels.nodeId}`,
);

fightUntilClear();
if (pub().nodeId === "hole_after_rats") pick("hub");

pick("well");
assert(pub().visitedRooms?.includes("well"), "well not revealed on entry");
assert(!pub().visitedRooms?.includes("store"), "store revealed early");
pick("lock");
const wellBad = solvePuzzleSequence(room.roomCode, ["wave", "tooth", "spark", "moon"]);
assert(wellBad.nodeId === "well_lock", `bad well advanced to ${wellBad.nodeId}`);
const well = solvePuzzleSequence(room.roomCode, ["tooth", "spark", "moon", "wave"]);
assert(well.flags.includes("seal_well") || well.nodeId.includes("hole") || well.nodeId.includes("bucket"), `well failed ${well.nodeId}`);

fightUntilClear();
if (pub().choices.some((c) => c.id === "hub")) pick("hub");
if (pub().nodeId === "well_bucket") {
  const next = pub().choices[0];
  if (next) pick(next.id);
}
fightUntilClear();
if (pub().nodeId === "hole_after_centipedes" || pub().choices.some((c) => c.id === "hub")) {
  if (pub().choices.some((c) => c.id === "hub")) pick("hub");
}

pick("store");
assert(pub().visitedRooms?.includes("store"), "store not revealed");
pick("vials");
const vialsBad = solvePuzzleSequence(room.roomCode, ["invis", "heal", "vit", "heal"]);
assert(vialsBad.nodeId === "store_vials", `bad vials advanced to ${vialsBad.nodeId}`);
const vials = solvePuzzleSequence(room.roomCode, ["heal", "invis", "vit", "heal"]);
assert(vials.nodeId === "store_mixture" || vials.flags.includes("seal_store"), `vials failed ${vials.nodeId}`);
if (pub().nodeId === "store_mixture") {
  const mixBad = solvePuzzleSequence(room.roomCode, ["stone_oil", "moon_dust", "black_salt"]);
  assert(mixBad.nodeId === "store_mixture", `bad mix advanced to ${mixBad.nodeId}`);
  solvePuzzleSequence(room.roomCode, ["moon_dust", "black_salt", "stone_oil"]);
}
const done = pub();
assert(done.flags.includes("seal_store") || done.nodeId.includes("hole"), `mixture failed ${done.nodeId} ${done.flags.join(",")}`);
assert(done.visitedRooms?.includes("store"), "store fog missing after entry");
assert(done.mapTokens?.some((t) => t.playerId === pid), "pawn missing");

console.log(
  JSON.stringify({
    ok: true,
    node: done.nodeId,
    visited: done.visitedRooms,
    tokens: done.mapTokens,
    flags: done.flags,
  }),
);
