export type DicePurpose =
  | "attack"
  | "damage"
  | "check"
  | "save"
  | "heal"
  | "initiative"
  | "other";

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

export function rollNotation(notation: string): {
  values: number[];
  total: number;
  sides: number[];
  modifier: number;
} {
  const parsed = parseNotation(notation);
  if (!parsed) {
    const n = Number(notation);
    return { values: [n], total: n, sides: [0], modifier: 0 };
  }
  const values: number[] = [];
  let total = parsed.modifier;
  for (let i = 0; i < parsed.count; i += 1) {
    const v = rollDie(parsed.sides);
    values.push(v);
    total += v;
  }
  return {
    values,
    total,
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
}): DiceRoll {
  seq += 1;
  const modifier = opts.modifier ?? 0;
  const sumFaces = opts.values.reduce((a, b) => a + b, 0);
  return {
    id: `dice_${Date.now()}_${seq}`,
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
    at: new Date().toISOString(),
  };
}

/** Roll NdM±K and wrap as a synced DiceRoll. */
export function rollAsDice(opts: {
  roller: string;
  notation: string;
  purpose: DicePurpose;
  label?: string;
}): DiceRoll {
  const r = rollNotation(opts.notation);
  const faces = r.values.reduce((a, b) => a + b, 0);
  return makeDiceRoll({
    roller: opts.roller,
    notation: opts.notation,
    values: r.values,
    sides: r.sides,
    modifier: r.modifier,
    total: r.total,
    purpose: opts.purpose,
    label: opts.label,
    isCrit:
      opts.purpose === "attack" &&
      r.sides[0] === 20 &&
      r.values.length === 1 &&
      r.values[0] === 20,
    isFumble:
      opts.purpose === "attack" &&
      r.sides[0] === 20 &&
      r.values.length === 1 &&
      r.values[0] === 1,
  });
}
