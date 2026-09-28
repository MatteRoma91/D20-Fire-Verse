import {
  bootLocal,
  choose,
  combatAttack,
  combatEndTurn,
  combatMove,
  createRoom,
  getRoom,
  joinRoom,
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
const code = room.roomCode;

function pub() {
  return publicState(getRoom(code)!);
}
function pick(id: string) {
  return choose(code, id, pid);
}

pick("go_money");
pick("accept");
pick("down");
pick("hub");
pick("tiles");

choose(code, "emerald", pid);
let s = pub();
assert(s.nodeId === "corridor_tiles", `emerald left the puzzle: ${s.nodeId}`);
assert((s.puzzle?.fails ?? 0) === 1, `emerald should be a fault, fails=${s.puzzle?.fails}`);
assert((s.puzzle?.picked.length ?? 0) === 0, "chain should reset");

choose(code, "gold", pid);
s = pub();
assert(s.nodeId === "corridor_tiles", `second fault left tiles: ${s.nodeId}`);
assert((s.puzzle?.fails ?? 1) === 0, "penalty should reset the fault counter");
assert((s.puzzle?.feedback ?? "").includes("try again"), s.puzzle?.feedback || "no feedback");

choose(code, "__reset__", pid);
assert(pub().nodeId === "corridor_tiles", "reset left the puzzle");

for (const id of ["violet", "slate", "black", "fire"]) choose(code, id, pid);
s = pub();
assert(s.flags.includes("tiles_done"), `tiles not solved after mistakes: ${s.nodeId}`);

pick("cellar");
pick("fight");
let guard = 0;
while (pub().combat && guard < 80) {
  guard += 1;
  const live = getRoom(code)!;
  const c = live.combat!;
  if (c.status !== "active") break;
  const cur = c.tokens.find((t) => t.id === c.turnOrder[c.turnIndex]);
  const foe = c.tokens.find((t) => t.kind === "enemy" && !t.dead);
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  if (cur?.kind === "pc" && foe && dist(cur, foe) > 1 && cur.movementLeft > 0 && c.reachable[0]) {
    const step = [...c.reachable].sort((a, b) => dist(a, foe) - dist(b, foe))[0]!;
    combatMove(code, pid, step.x, step.y);
    continue;
  }
  if (cur?.kind === "pc" && cur.hasAction && foe && dist(cur, foe) <= 1) {
    combatAttack(code, pid, "longsword_attack", foe.id);
    continue;
  }
  combatEndTurn(code, pid);
}
assert(pub().nodeId === "cellar_vessels", pub().nodeId);

solvePuzzleSequence(code, ["x", "eye", "wave", "spiral"]);
solvePuzzleSequence(code, ["spiral", "eye", "x", "wave"]);
s = pub();
assert(s.nodeId === "cellar_vessels", `vessels penalty left the puzzle: ${s.nodeId}`);
assert(!s.flags.includes("seal_cellar"), "wrong vessels granted the seal");
assert((s.puzzle?.feedback ?? "").length > 0, "no vessel feedback");
solvePuzzleSequence(code, ["eye", "x", "wave", "spiral"]);
s = pub();
assert(s.flags.includes("seal_cellar") || s.nodeId.includes("hole"), `correct vessels failed ${s.nodeId}`);

function fightClear() {
  let guard = 0;
  while (pub().combat && guard < 80) {
    guard += 1;
    const live = getRoom(code)!;
    const c = live.combat!;
    if (c.status !== "active") break;
    const cur = c.tokens.find((t) => t.id === c.turnOrder[c.turnIndex]);
    const foe = c.tokens.find((t) => t.kind === "enemy" && !t.dead);
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    if (cur?.kind === "pc" && foe && dist(cur, foe) > 1 && cur.movementLeft > 0 && c.reachable[0]) {
      const step = [...c.reachable].sort((a, b) => dist(a, foe) - dist(b, foe))[0]!;
      combatMove(code, pid, step.x, step.y);
      continue;
    }
    if (cur?.kind === "pc" && cur.hasAction && foe && dist(cur, foe) <= 1) {
      combatAttack(code, pid, "longsword_attack", foe.id);
      continue;
    }
    combatEndTurn(code, pid);
  }
}

fightClear();
if (pub().choices.some((c) => c.id === "hub")) pick("hub");

pick("well");
pick("lock");
solvePuzzleSequence(code, ["stone", "sun", "skull", "wave"]);
solvePuzzleSequence(code, ["sun", "skull", "tooth", "spark"]);
s = pub();
assert(s.nodeId === "well_lock", `well penalty left the lock: ${s.nodeId} ${s.puzzle?.feedback}`);
assert(!s.combat, "well mistake started a fight");
solvePuzzleSequence(code, ["tooth", "spark", "moon", "wave"]);
assert(pub().nodeId === "well_bucket", `well solve went to ${pub().nodeId}`);
pick("take");
fightClear();
if (pub().choices.some((c) => c.id === "hub")) pick("hub");

pick("store");
pick("vials");
solvePuzzleSequence(code, ["poison", "poison", "poison", "poison"]);
solvePuzzleSequence(code, ["vit", "heal", "heal", "invis"]);
s = pub();
assert(s.nodeId === "store_vials", `vials penalty left the puzzle: ${s.nodeId}`);
solvePuzzleSequence(code, ["heal", "invis", "vit", "heal"]);
assert(pub().nodeId === "store_mixture", pub().nodeId);
solvePuzzleSequence(code, ["mercury", "hop_ash", "quicklime"]);
solvePuzzleSequence(code, ["stone_oil", "moon_dust", "black_salt"]);
s = pub();
assert(s.nodeId === "store_mixture", `mixture penalty left the puzzle: ${s.nodeId}`);
solvePuzzleSequence(code, ["moon_dust", "black_salt", "stone_oil"]);
s = pub();
assert(s.flags.includes("seal_store") || s.nodeId.includes("hole") || s.nodeId === "corridor_hub", s.nodeId);

console.log(JSON.stringify({ ok: true, node: s.nodeId, flags: s.flags }));
