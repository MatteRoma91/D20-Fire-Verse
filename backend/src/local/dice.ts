export type DicePurpose =
  | "attack"
  | "damage"
  | "check"
  | "save"
  | "heal"
  | "initiative"
  | "other";

export type DiceOutcome = "hit" | "miss" | "crit" | "fumble" | "success" | "fail";

export type DiceRoll = {
  id: string;
  roller: string;
  notation: string;
  /** Natural face values, one per die. */
  values: number[];
  /** Sides for each die in `values`. */
  sides: number[];
  modifier: number;
  total: number;
  purpose: DicePurpose;
  label?: string;
  isCrit?: boolean;
  isFumble?: boolean;
  /** What the total was measured against, so the table can say "18 vs AC 12". */
  vs?: { kind: "AC" | "DC"; value: number };
  outcome?: DiceOutcome;
  /** Index into `values` of the die that counted (advantage/disadvantage). */
  kept?: number;
  at: string;
};

let seq = 0;

export function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}

export function rollD20(): number {
  return rollDie(20);
}

export function parseNotation(notation: string): {
  count: number;
  sides: number;
  modifier: number;
} | null {
  const m = notation.replace(/\s/g, "").match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  return {
    count: Number(m[1]),
    sides: Number(m[2]),
    modifier: m[3] ? Number(m[3]) : 0,
  };
}

export function rollNotation(
  notation: string,
  opts: { crit?: boolean } = {},
): {
  values: number[];
  total: number;
  sides: number[];
  modifier: number;
} {
  const parsed = parseNotation(notation);
  if (!parsed) {
    const n = Number(notation);
    const flat = Number.isFinite(n) ? n : 0;
    return { values: [flat], total: flat, sides: [0], modifier: 0 };
  }
  // A critical hit doubles the dice, never the modifier (SRD 5.1, "Critical Hits").
  const count = opts.crit ? parsed.count * 2 : parsed.count;
  const values: number[] = [];
  let total = parsed.modifier;
  for (let i = 0; i < count; i += 1) {
    const v = rollDie(parsed.sides);
    values.push(v);
    total += v;
  }
  return {
    values,
    total: Math.max(0, total),
    sides: values.map(() => parsed.sides),
    modifier: parsed.modifier,
  };
}

export function makeDiceRoll(opts: {
  roller: string;
  notation: string;
  values: number[];
  sides?: number[];
  modifier?: number;
  total?: number;
  purpose: DicePurpose;
  label?: string;
  isCrit?: boolean;
  isFumble?: boolean;
  vs?: DiceRoll["vs"];
  outcome?: DiceOutcome;
  kept?: number;
}): DiceRoll {
  seq += 1;
  const modifier = opts.modifier ?? 0;
  const sumFaces = opts.values.reduce((a, b) => a + b, 0);
  return {
    id: `dice_${Date.now().toString(36)}_${seq}`,
    roller: opts.roller,
    notation: opts.notation,
    values: opts.values,
    sides:
      opts.sides ??
      opts.values.map(() => {
        const p = parseNotation(opts.notation);
        return p?.sides ?? 20;
      }),
    modifier,
    total: opts.total ?? sumFaces + modifier,
    purpose: opts.purpose,
    label: opts.label,
    isCrit: opts.isCrit,
    isFumble: opts.isFumble,
    vs: opts.vs,
    outcome: opts.outcome,
    kept: opts.kept,
    at: new Date().toISOString(),
  };
}

export type D20Mode = "normal" | "advantage" | "disadvantage";

/** One d20 test with advantage/disadvantage folded in. */
export function rollD20Test(mode: D20Mode): { values: number[]; natural: number; kept: number } {
  const a = rollD20();
  if (mode === "normal") return { values: [a], natural: a, kept: 0 };
  const b = rollD20();
  const keepFirst = mode === "advantage" ? a >= b : a <= b;
  return { values: [a, b], natural: keepFirst ? a : b, kept: keepFirst ? 0 : 1 };
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function d20Notation(mode: D20Mode, bonus: number): string {
  const head = mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
  return bonus === 0 ? head : `${head}${signed(bonus)}`;
}

/**
 * Attack roll against an Armor Class. A natural 20 always hits and is a critical;
 * a natural 1 always misses (SRD 5.1, "Rolling 1 or 20").
 */
export function rollAttack(opts: {
  roller: string;
  label: string;
  bonus: number;
  ac: number;
  mode: D20Mode;
}): DiceRoll {
  const test = rollD20Test(opts.mode);
  const total = test.natural + opts.bonus;
  const crit = test.natural === 20;
  const fumble = test.natural === 1;
  const outcome: DiceOutcome = crit ? "crit" : fumble ? "fumble" : total >= opts.ac ? "hit" : "miss";
  return makeDiceRoll({
    roller: opts.roller,
    notation: d20Notation(opts.mode, opts.bonus),
    values: test.values,
    sides: test.values.map(() => 20),
    modifier: opts.bonus,
    total,
    purpose: "attack",
    label: opts.label,
    isCrit: crit,
    isFumble: fumble,
    vs: { kind: "AC", value: opts.ac },
    outcome,
    kept: test.kept,
  });
}

/** Ability check or saving throw against a Difficulty Class. */
export function rollCheck(opts: {
  roller: string;
  label: string;
  bonus: number;
  dc: number;
  purpose: "check" | "save";
  mode?: D20Mode;
  forceNatural?: number;
}): DiceRoll {
  const mode = opts.mode ?? "normal";
  const test =
    opts.forceNatural !== undefined
      ? { values: [opts.forceNatural], natural: opts.forceNatural, kept: 0 }
      : rollD20Test(mode);
  const total = test.natural + opts.bonus;
  return makeDiceRoll({
    roller: opts.roller,
    notation: d20Notation(opts.forceNatural !== undefined ? "normal" : mode, opts.bonus),
    values: test.values,
    sides: test.values.map(() => 20),
    modifier: opts.bonus,
    total,
    purpose: opts.purpose,
    label: opts.label,
    isCrit: test.natural === 20,
    isFumble: test.natural === 1,
    vs: { kind: "DC", value: opts.dc },
    outcome: total >= opts.dc ? "success" : "fail",
    kept: test.kept,
  });
}

/** Roll NdM±K and wrap as a synced DiceRoll. */
export function rollAsDice(opts: {
  roller: string;
  notation: string;
  purpose: DicePurpose;
  label?: string;
  crit?: boolean;
}): DiceRoll {
  const r = rollNotation(opts.notation, { crit: opts.crit });
  return makeDiceRoll({
    roller: opts.roller,
    notation: opts.crit ? critNotation(opts.notation) : opts.notation,
    values: r.values,
    sides: r.sides,
    modifier: r.modifier,
    total: r.total,
    purpose: opts.purpose,
    label: opts.label,
  });
}

/** "1d8+3" → "2d8+3" for the crit display. */
export function critNotation(notation: string): string {
  const p = parseNotation(notation);
  if (!p) return notation;
  return `${p.count * 2}d${p.sides}${p.modifier ? signed(p.modifier) : ""}`;
}
