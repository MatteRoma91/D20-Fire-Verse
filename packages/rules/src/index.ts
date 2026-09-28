/** Pure rules helpers shared by backend (and future TV preview). */

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function rollDie(sides: number, rng: () => number = Math.random): number {
  return 1 + Math.floor(rng() * sides);
}

export function rollD20(rng: () => number = Math.random): number {
  return rollDie(20, rng);
}

export function rollNotation(
  notation: string,
  rng: () => number = Math.random,
): { values: number[]; total: number } {
  const m = notation.replace(/\s/g, "").match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) {
    const n = Number(notation);
    return { values: [n], total: n };
  }
  const count = Number(m[1]);
  const sides = Number(m[2]);
  const bonus = m[3] ? Number(m[3]) : 0;
  const values: number[] = [];
  let total = bonus;
  for (let i = 0; i < count; i += 1) {
    const v = rollDie(sides, rng);
    values.push(v);
    total += v;
  }
  return { values, total };
}

export function chebyshev(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 5e alternating diagonal costs in cells of speed (5/10/5…). */
export function diagonalStepCost(diagonalIndex: number): number {
  return diagonalIndex % 2 === 0 ? 1 : 2;
}

export type GridQuery = {
  width: number;
  height: number;
  isBlocked: (x: number, y: number) => boolean;
};

export function computeReachable(
  grid: GridQuery,
  start: { x: number; y: number },
  budget: number,
): Array<{ x: number; y: number }> {
  type Node = { x: number; y: number; spent: number; diag: number };
  const best = new Map<string, number>();
  const out: Array<{ x: number; y: number }> = [];
  const q: Node[] = [{ x: start.x, y: start.y, spent: 0, diag: 0 }];
  best.set(`${start.x},${start.y}`, 0);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;

  while (q.length) {
    q.sort((a, b) => a.spent - b.spent);
    const cur = q.shift()!;
    if (cur.spent > 0) out.push({ x: cur.x, y: cur.y });
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      if (grid.isBlocked(nx, ny)) continue;
      const isDiag = dx !== 0 && dy !== 0;
      const actualCost = isDiag ? diagonalStepCost(cur.diag) : 1;
      const spent = cur.spent + actualCost;
      if (spent > budget) continue;
      const key = `${nx},${ny}`;
      if (best.has(key) && best.get(key)! <= spent) continue;
      best.set(key, spent);
      q.push({
        x: nx,
        y: ny,
        spent,
        diag: isDiag ? cur.diag + 1 : cur.diag,
      });
    }
  }
  return out;
}

export function movementCostTo(
  grid: GridQuery,
  start: { x: number; y: number },
  goal: { x: number; y: number },
  budget: number,
): number | null {
  type Node = { x: number; y: number; spent: number; diag: number };
  const best = new Map<string, number>();
  const q: Node[] = [{ x: start.x, y: start.y, spent: 0, diag: 0 }];
  best.set(`${start.x},${start.y}`, 0);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;
  while (q.length) {
    q.sort((a, b) => a.spent - b.spent);
    const cur = q.shift()!;
    if (cur.x === goal.x && cur.y === goal.y) return cur.spent;
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const atGoal = nx === goal.x && ny === goal.y;
      if (!atGoal && grid.isBlocked(nx, ny)) continue;
      const isDiag = dx !== 0 && dy !== 0;
      const actualCost = isDiag ? diagonalStepCost(cur.diag) : 1;
      const spent = cur.spent + actualCost;
      if (spent > budget) continue;
      const key = `${nx},${ny}`;
      if (best.has(key) && best.get(key)! <= spent) continue;
      best.set(key, spent);
      q.push({
        x: nx,
        y: ny,
        spent,
        diag: isDiag ? cur.diag + 1 : cur.diag,
      });
    }
  }
  return null;
}
