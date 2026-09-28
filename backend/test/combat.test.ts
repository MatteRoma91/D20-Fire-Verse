import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  applyDisconnectDodge,
  computeReachable,
  endTurn,
  pathTo,
  performPcAction,
  proposeMove,
  startCombat,
  type CombatState,
  type CombatToken,
} from "../src/local/combat.js";
import { boot, scriptDice } from "./helpers.js";

before(boot);

function token(over: Partial<CombatToken> & Pick<CombatToken, "id" | "kind" | "x" | "y">): CombatToken {
  return {
    name: over.id,
    hp: 20,
    maxHp: 20,
    ac: 12,
    speedCells: 6,
    movementLeft: 6,
    hasAction: true,
    hasBonusAction: over.kind === "pc",
    initiative: 10,
    actionIds: [],
    bonusActionIds: [],
    inventory: [],
    dead: false,
    dodging: false,
    disengaging: false,
    hidden: false,
    secondWindUsed: false,
    ...over,
  };
}

function arena(width: number, height: number, tokens: CombatToken[], walls: Array<[number, number]> = []): CombatState {
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
  for (const [x, y] of walls) grid[y][x] = true;
  return {
    encounterId: "test",
    mapId: "test",
    width,
    height,
    walls: grid,
    tokens,
    turnOrder: tokens.map((t) => t.id),
    turnIndex: 0,
    round: 1,
    log: [],
    reachable: [],
    status: "active",
    events: [],
    seq: 0,
  };
}

function brenna(x: number, y: number, over: Partial<CombatToken> = {}) {
  return token({
    id: "pc-P1",
    kind: "pc",
    name: "Brenna Ironveal",
    x,
    y,
    ac: 16,
    playerId: "P1",
    characterId: "brenna_ironveal",
    actionIds: ["longsword_attack", "std_dodge", "std_dash"],
    bonusActionIds: ["second_wind"],
    ...over,
  });
}

function rat(id: string, x: number, y: number, over: Partial<CombatToken> = {}) {
  return token({
    id,
    kind: "enemy",
    name: "Giant Rat",
    x,
    y,
    hp: 7,
    maxHp: 7,
    monsterId: "giant_rat",
    actionIds: ["giant_rat_bite"],
    ...over,
  });
}

test("diagonals follow the 5-10-5 rule", () => {
  const c = arena(8, 8, [brenna(0, 0)]);
  assert.equal(pathTo(c, c.tokens[0], 1, 1)?.cost, 1);
  assert.equal(pathTo(c, c.tokens[0], 2, 2)?.cost, 3);
  assert.equal(pathTo(c, c.tokens[0], 3, 3)?.cost, 4);
  const route = pathTo(c, c.tokens[0], 3, 0);
  assert.deepEqual(route?.path, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ]);
});

test("no squeezing diagonally between two walls", () => {
  const c = arena(4, 4, [brenna(0, 0)], [
    [1, 0],
    [0, 1],
  ]);
  assert.equal(pathTo(c, c.tokens[0], 1, 1), null);
  assert.equal(computeReachable(c, "pc-P1").length, 0);
});

test("allies can be passed through but foes block", () => {
  const ally = token({ id: "pc-P2", kind: "pc", x: 1, y: 0, playerId: "P2" });
  const c = arena(3, 1, [brenna(0, 0), ally]);
  assert.equal(pathTo(c, c.tokens[0], 2, 0)?.cost, 2);
  const blocked = arena(3, 1, [brenna(0, 0), rat("en-1", 1, 0)]);
  assert.equal(pathTo(blocked, blocked.tokens[0], 2, 0), null);
});

test("moving records the walked path and spends movement", () => {
  const c = arena(8, 3, [brenna(0, 1), rat("en-1", 7, 1)]);
  c.reachable = computeReachable(c, "pc-P1");
  proposeMove(c, "P1", 3, 1);
  const move = c.events.at(-1);
  assert.equal(move?.kind, "move");
  assert.equal(move?.kind === "move" && move.path.length, 4);
  assert.equal(c.tokens[0].movementLeft, 3);
  assert.throws(() => proposeMove(c, "P1", 7, 0), /UNREACHABLE/);
});

test("the enemy turn walks to the hero and attacks with a readable roll", () => {
  const c = arena(8, 3, [brenna(0, 1), rat("en-1", 4, 1)]);
  const restore = scriptDice([
    [20, 15],
    [4, 3],
  ]);
  try {
    endTurn(c, "P1");
  } finally {
    restore();
  }
  const kinds = c.events.map((e) => e.kind);
  assert.deepEqual(kinds, ["turn", "move", "strike", "turn"]);
  const move = c.events[1];
  assert.ok(move.kind === "move" && move.path.at(-1)!.x === 1);
  const strike = c.events[2];
  assert.ok(strike.kind === "strike");
  assert.deepEqual(strike.rolls[0].vs, { kind: "AC", value: 16 });
  assert.equal(strike.rolls[0].total, 19);
  assert.equal(strike.hits[0].outcome, "hit");
  assert.equal(strike.hits[0].damage, 5);
  assert.equal(c.tokens[0].hp, 15);
  assert.equal(c.round, 2);
});

test("a natural 20 from the hero doubles the damage dice", () => {
  const c = arena(3, 1, [brenna(0, 0), rat("en-1", 1, 0, { hp: 30, maxHp: 30 })]);
  const restore = scriptDice([
    [20, 20],
    [8, 4],
    [8, 6],
  ]);
  try {
    performPcAction(c, "P1", "longsword_attack", "en-1");
  } finally {
    restore();
  }
  const strike = c.events.at(-1)!;
  assert.ok(strike.kind === "strike");
  assert.equal(strike.hits[0].outcome, "crit");
  assert.deepEqual(strike.rolls[1].values, [4, 6]);
  assert.equal(strike.hits[0].damage, 4 + 6 + 3);
});

test("the last foe falling ends the fight with victory events", () => {
  const c = arena(3, 1, [brenna(0, 0), rat("en-1", 1, 0, { hp: 2 })]);
  const restore = scriptDice([
    [20, 12],
    [8, 5],
  ]);
  try {
    performPcAction(c, "P1", "longsword_attack", "en-1");
  } finally {
    restore();
  }
  assert.equal(c.status, "victory");
  assert.deepEqual(
    c.events.map((e) => e.kind),
    ["strike", "down", "end"],
  );
  assert.throws(() => endTurn(c, "P1"), /COMBAT_OVER/);
});

test("spent actions are refused, not silently ignored", () => {
  const c = arena(3, 1, [brenna(0, 0), rat("en-1", 1, 0, { hp: 30, maxHp: 30 })]);
  performPcAction(c, "P1", "std_dodge");
  assert.throws(() => performPcAction(c, "P1", "longsword_attack", "en-1"), /NO_ACTION/);
  assert.throws(() => performPcAction(c, "P2", "std_dash"), /NOT_YOUR_TURN/);
});

test("a dropped hero dodges, so the next bite rolls with disadvantage", () => {
  const c = arena(3, 1, [brenna(0, 0), rat("en-1", 1, 0)]);
  applyDisconnectDodge(c, "P1");
  const strike = c.events.find((e) => e.kind === "strike");
  assert.ok(strike && strike.kind === "strike");
  assert.equal(strike.rolls[0].values.length, 2);
  assert.match(strike.rolls[0].notation, /^2d20kl1/);
});

test("a real encounter opens with initiative and hands the turn to a hero", () => {
  const c = startCombat("cellar_rats", [
    { playerId: "P1", displayName: "T", characterId: "brenna_ironveal", characterName: "Brenna Ironveal" },
  ]);
  assert.equal(c.events[0].kind, "start");
  const current = c.tokens.find((t) => t.id === c.turnOrder[c.turnIndex]);
  assert.ok(c.status !== "active" || current?.kind === "pc");
  assert.ok(c.tokens.filter((t) => t.kind === "enemy").length >= 2);
});
