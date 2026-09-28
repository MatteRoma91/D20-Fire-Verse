import assert from "node:assert/strict";
import { test } from "node:test";
import { critNotation, parseNotation, rollAttack, rollCheck, rollNotation } from "../src/local/dice.js";
import { scriptDice } from "./helpers.js";

test("parses dice notation", () => {
  assert.deepEqual(parseNotation("2d6+3"), { count: 2, sides: 6, modifier: 3 });
  assert.deepEqual(parseNotation("1d20-1"), { count: 1, sides: 20, modifier: -1 });
  assert.equal(parseNotation("banana"), null);
});

test("a critical doubles the dice, never the modifier", () => {
  const restore = scriptDice([
    [8, 5],
    [8, 7],
  ]);
  try {
    const r = rollNotation("1d8+3", { crit: true });
    assert.deepEqual(r.values, [5, 7]);
    assert.equal(r.total, 15);
    assert.equal(critNotation("1d8+3"), "2d8+3");
  } finally {
    restore();
  }
});

test("a natural 20 always hits and crits, even against impossible armor", () => {
  const restore = scriptDice([[20, 20]]);
  try {
    const r = rollAttack({ roller: "A", label: "x", bonus: 0, ac: 40, mode: "normal" });
    assert.equal(r.outcome, "crit");
    assert.equal(r.isCrit, true);
    assert.deepEqual(r.vs, { kind: "AC", value: 40 });
  } finally {
    restore();
  }
});

test("a natural 1 always misses, whatever the bonus", () => {
  const restore = scriptDice([[20, 1]]);
  try {
    const r = rollAttack({ roller: "A", label: "x", bonus: 30, ac: 5, mode: "normal" });
    assert.equal(r.outcome, "fumble");
    assert.equal(r.total, 31);
  } finally {
    restore();
  }
});

test("advantage keeps the higher die and says which one", () => {
  const restore = scriptDice([
    [20, 4],
    [20, 17],
  ]);
  try {
    const r = rollAttack({ roller: "A", label: "x", bonus: 2, ac: 15, mode: "advantage" });
    assert.deepEqual(r.values, [4, 17]);
    assert.equal(r.kept, 1);
    assert.equal(r.total, 19);
    assert.equal(r.outcome, "hit");
    assert.equal(r.notation, "2d20kh1+2");
  } finally {
    restore();
  }
});

test("disadvantage keeps the lower die", () => {
  const restore = scriptDice([
    [20, 18],
    [20, 3],
  ]);
  try {
    const r = rollAttack({ roller: "A", label: "x", bonus: 2, ac: 10, mode: "disadvantage" });
    assert.equal(r.total, 5);
    assert.equal(r.outcome, "miss");
  } finally {
    restore();
  }
});

test("checks meet the DC on a tie", () => {
  const restore = scriptDice([[20, 10]]);
  try {
    const r = rollCheck({ roller: "A", label: "x", bonus: 3, dc: 13, purpose: "check" });
    assert.equal(r.outcome, "success");
    assert.deepEqual(r.vs, { kind: "DC", value: 13 });
  } finally {
    restore();
  }
});
