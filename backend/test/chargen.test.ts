import assert from "node:assert/strict";
import { before, test } from "node:test";
import { buildCharacter, rollAbilityScores, type ChargenDraft } from "../src/local/chargen.js";
import { isPortraitId } from "../src/local/portraits.js";
import { boot } from "./helpers.js";

before(boot);

function fighter(over: Partial<ChargenDraft> = {}): ChargenDraft {
  return {
    name: "Aldric Stone",
    level: 1,
    raceId: "human",
    classId: "fighter",
    backgroundId: "soldier",
    method: "standard_array",
    baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    classSkills: ["perception", "survival"],
    fightingStyle: "defense",
    ...over,
  };
}

test("a standard-array human fighter is built by the rules", () => {
  const pc = buildCharacter(fighter());
  assert.equal(pc.abilities.str, 16);
  assert.equal(pc.abilities.int, 9);
  assert.equal(pc.hp, 10 + 2);
  assert.ok(pc.ac >= 17, `chain mail + shield + defense, got ${pc.ac}`);
  assert.ok(pc.portrait && isPortraitId(pc.portrait));
});

test("a chosen portrait sticks, an unknown one falls back to the default", () => {
  assert.equal(buildCharacter(fighter({ name: "A", portraitId: "cg_tiefling" })).portrait, "cg_tiefling");
  const fallback = buildCharacter(fighter({ name: "B", portraitId: "../../etc/passwd" })).portrait;
  assert.ok(fallback && isPortraitId(fallback));
});

test("the standard array must be used exactly", () => {
  assert.throws(
    () => buildCharacter(fighter({ baseAbilities: { str: 15, dex: 15, con: 14, int: 8, wis: 12, cha: 10 } })),
    /STANDARD_ARRAY_MISMATCH/,
  );
});

test("point buy cannot exceed 27 points", () => {
  assert.throws(
    () =>
      buildCharacter(
        fighter({ method: "point_buy", baseAbilities: { str: 15, dex: 15, con: 15, int: 10, wis: 8, cha: 8 } }),
      ),
    /POINT_BUY_OVER/,
  );
  const ok = buildCharacter(
    fighter({ method: "point_buy", baseAbilities: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 8 } }),
  );
  assert.equal(ok.abilities.str, 16);
});

test("rolled scores must match the server's pool", () => {
  const pool = rollAbilityScores();
  assert.equal(pool.length, 6);
  for (const s of pool) assert.ok(s >= 3 && s <= 18);
  const [a, b, c, d, e, f] = pool;
  const good = buildCharacter(
    fighter({ method: "roll", baseAbilities: { str: a!, dex: b!, con: c!, int: d!, wis: e!, cha: f! } }),
    pool,
  );
  assert.equal(good.abilities.str, a! + 1);
  const forged = pool.map((s) => Math.min(18, s + 1));
  assert.throws(
    () =>
      buildCharacter(
        fighter({
          method: "roll",
          baseAbilities: { str: forged[0]!, dex: forged[1]!, con: forged[2]!, int: forged[3]!, wis: forged[4]!, cha: forged[5]! },
        }),
        pool,
      ),
    /ROLL_MISMATCH|ROLL_RANGE/,
  );
});

test("class skill count, fighting style and background overlap are enforced", () => {
  assert.throws(() => buildCharacter(fighter({ classSkills: ["perception"] })), /NEED_2_CLASS_SKILLS/);
  assert.throws(() => buildCharacter(fighter({ fightingStyle: undefined })), /NEED_FIGHTING_STYLE/);
  assert.throws(() => buildCharacter(fighter({ classSkills: ["athletics", "perception"] })), /SKILL_OVERLAP_BG/);
  assert.throws(() => buildCharacter(fighter({ name: "  " })), /NEED_NAME/);
});
