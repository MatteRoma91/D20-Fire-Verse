import {
  abilityMod,
  getAbility,
  getEncounter,
  getMap,
  getMonster,
  getPregen,
  type MapDef,
  type Pregen,
} from "./campaign.js";
import { rollD20, rollNotation, makeDiceRoll, type DiceRoll } from "./dice.js";
import type { Player } from "./types.js";

export type CombatToken = {
  id: string;
  kind: "pc" | "enemy";
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ac: number;
  speedCells: number;
  movementLeft: number;
  hasAction: boolean;
  hasBonusAction: boolean;
  initiative: number;
  playerId?: string;
  characterId?: string;
  monsterId?: string;
  actionIds: string[];
  bonusActionIds: string[];
  inventory: string[];
  dead: boolean;
  dodging: boolean;
  disengaging: boolean;
  hidden: boolean;
  helpingTargetId?: string;
  secondWindUsed: boolean;
};

const STANDARD_ACTIONS = [
  "std_dash",
  "std_disengage",
  "std_dodge",
  "std_help",
  "std_hide",
  "std_ready",
  "std_search",
] as const;

function bonusActionsFor(pregen: Pregen): string[] {
  const out: string[] = [];
  if (pregen.actions?.includes("second_wind") || pregen.class === "fighter") {
    out.push("second_wind");
  }
  if (pregen.traits?.includes("cunning_action") || pregen.class === "rogue") {
    out.push("cunning_dash", "cunning_disengage", "cunning_hide");
  }
  return out;
}

function actionIdsFor(pregen: Pregen): string[] {
  const base = [...(pregen.actions ?? ["longsword_attack"]).filter((id) => id !== "second_wind")];
  for (const id of STANDARD_ACTIONS) {
    if (!base.includes(id)) base.push(id);
  }
  if (pregen.inventory?.includes("potion_healing")) {
    base.push("use_potion_healing");
  }
  return base;
}

export type CombatState = {
  encounterId: string;
  mapId: string;
  width: number;
  height: number;
  walls: boolean[][];
  tokens: CombatToken[];
  turnOrder: string[];
  turnIndex: number;
  log: string[];
  reachable: Array<{ x: number; y: number }>;
  status: "active" | "victory" | "defeat";
};

function wallGrid(map: MapDef): boolean[][] {
  const g = Array.from({ length: map.height }, () =>
    Array.from({ length: map.width }, () => false),
  );
  for (const w of map.walls) {
    for (let y = w.y; y < w.y + w.h; y += 1) {
      for (let x = w.x; x < w.x + w.w; x += 1) {
        if (y >= 0 && y < map.height && x >= 0 && x < map.width) g[y][x] = true;
      }
    }
  }
  return g;
}

function occupied(combat: CombatState, x: number, y: number, ignoreId?: string): boolean {
  return combat.tokens.some(
    (t) => !t.dead && t.id !== ignoreId && t.x === x && t.y === y,
  );
}

function inBounds(combat: CombatState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < combat.width && y < combat.height;
}

function walkable(combat: CombatState, x: number, y: number, ignoreId?: string): boolean {
  return (
    inBounds(combat, x, y) &&
    !combat.walls[y][x] &&
    !occupied(combat, x, y, ignoreId)
  );
}

/** 5e-style diagonal costs: 5, 10, 5, 10... in feet → 1 or 2 cells of speed */
function stepCost(dx: number, dy: number, diagonalIndex: number): number {
  if (dx !== 0 && dy !== 0) {
    return diagonalIndex % 2 === 0 ? 1 : 2;
  }
  return 1;
}

export function computeReachable(combat: CombatState, tokenId: string): Array<{ x: number; y: number }> {
  const token = combat.tokens.find((t) => t.id === tokenId);
  if (!token || token.dead) return [];
  const budget = token.movementLeft;
  type Node = { x: number; y: number; spent: number; diag: number };
  const best = new Map<string, number>();
  const out: Array<{ x: number; y: number }> = [];
  const q: Node[] = [{ x: token.x, y: token.y, spent: 0, diag: 0 }];
  best.set(`${token.x},${token.y}`, 0);

  while (q.length) {
    q.sort((a, b) => a.spent - b.spent);
    const cur = q.shift()!;
    if (cur.spent > 0) out.push({ x: cur.x, y: cur.y });
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!walkable(combat, nx, ny, token.id)) continue;
      const isDiag = dx !== 0 && dy !== 0;
      const cost = stepCost(dx, dy, isDiag ? cur.diag : cur.diag);
      // track diagonal count only when taking a diagonal
      const nextDiag = isDiag ? cur.diag + 1 : cur.diag;
      const actualCost = isDiag ? (cur.diag % 2 === 0 ? 1 : 2) : 1;
      const spent = cur.spent + actualCost;
      if (spent > budget) continue;
      const key = `${nx},${ny}`;
      const prev = best.get(key);
      if (prev !== undefined && prev <= spent) continue;
      best.set(key, spent);
      q.push({ x: nx, y: ny, spent, diag: nextDiag });
      void cost;
    }
  }
  return out;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function refreshReachable(combat: CombatState): void {
  const currentId = combat.turnOrder[combat.turnIndex];
  const current = combat.tokens.find((t) => t.id === currentId);
  if (current && current.kind === "pc" && !current.dead) {
    combat.reachable = computeReachable(combat, current.id);
  } else {
    combat.reachable = [];
  }
}

function pushLog(combat: CombatState, line: string): void {
  combat.log.push(line);
  if (combat.log.length > 40) combat.log.shift();
}

export function startCombat(
  encounterId: string,
  players: Player[],
): CombatState {
  const encounter = getEncounter(encounterId);
  if (!encounter) throw new Error("BAD_ENCOUNTER");
  const map = getMap(encounter.mapId);
  if (!map) throw new Error("BAD_MAP");
  const n = Math.min(3, Math.max(1, players.length));
  const scale = encounter.scaling[String(n)] || encounter.scaling["1"];
  const walls = wallGrid(map);
  const tokens: CombatToken[] = [];

  players.forEach((p, i) => {
    const pregen = getPregen(p.characterId) as Pregen;
    const spot = map.spawn.pcs[i] || map.spawn.pcs[0];
    const initRoll = rollD20() + abilityMod(pregen.abilities.dex);
    tokens.push({
      id: `pc-${p.playerId}`,
      kind: "pc",
      name: pregen.name,
      x: spot.x,
      y: spot.y,
      hp: pregen.hp,
      maxHp: pregen.hp,
      ac: pregen.ac,
      speedCells: pregen.speedCells ?? 6,
      movementLeft: pregen.speedCells ?? 6,
      hasAction: true,
      hasBonusAction: true,
      initiative: initRoll,
      playerId: p.playerId,
      characterId: pregen.id,
      actionIds: actionIdsFor(pregen),
      bonusActionIds: bonusActionsFor(pregen),
      inventory: [...(pregen.inventory ?? [])],
      dead: false,
      dodging: false,
      disengaging: false,
      hidden: false,
      secondWindUsed: false,
    });
  });

  let enemySpot = 0;
  let enemySeq = 0;
  for (const group of scale) {
    const mon = getMonster(group.monsterId);
    if (!mon) continue;
    for (let i = 0; i < group.count; i += 1) {
      const spot = map.spawn.enemies[enemySpot % map.spawn.enemies.length];
      enemySpot += 1;
      enemySeq += 1;
      const hp = group.hpOverride ?? mon.hp;
      const initRoll = rollD20() + abilityMod(mon.abilities.dex ?? 10);
      tokens.push({
        id: `en-${enemySeq}`,
        kind: "enemy",
        name: `${mon.name}${group.count > 1 ? ` ${enemySeq}` : ""}`,
        x: spot.x,
        y: spot.y,
        hp,
        maxHp: hp,
        ac: mon.ac,
        speedCells: mon.speedCells,
        movementLeft: mon.speedCells,
        hasAction: true,
        hasBonusAction: false,
        initiative: initRoll,
        monsterId: mon.id,
        actionIds: mon.actions,
        bonusActionIds: [],
        inventory: [],
        dead: false,
        dodging: false,
        disengaging: false,
        hidden: false,
        secondWindUsed: false,
      });
    }
  }

  // De-overlap enemy spawns if same cell
  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (tokens[i].x === tokens[j].x && tokens[i].y === tokens[j].y) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
        ] as const) {
          const nx = tokens[i].x + dx;
          const ny = tokens[i].y + dy;
          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < map.width &&
            ny < map.height &&
            !walls[ny][nx] &&
            !tokens.some((t) => t.x === nx && t.y === ny)
          ) {
            tokens[i].x = nx;
            tokens[i].y = ny;
            break;
          }
        }
      }
    }
  }

  const turnOrder = [...tokens]
    .sort((a, b) => b.initiative - a.initiative)
    .map((t) => t.id);

  const combat: CombatState = {
    encounterId,
    mapId: map.id,
    width: map.width,
    height: map.height,
    walls,
    tokens,
    turnOrder,
    turnIndex: 0,
    log: [`Combat! Initiative: ${turnOrder.map((id) => tokens.find((t) => t.id === id)!.name).join(", ")}`],
    reachable: [],
    status: "active",
  };
  beginTurn(combat);
  // Resolve opening enemy initiatives so the first human always can act
  let openGuard = 0;
  while (
    combat.status === "active" &&
    openGuard < combat.turnOrder.length + 2 &&
    currentToken(combat)?.kind === "enemy"
  ) {
    openGuard += 1;
    runEnemyTurn(combat, currentToken(combat)!);
    if (combat.status !== "active") break;
    combat.turnIndex = (combat.turnIndex + 1) % combat.turnOrder.length;
    beginTurn(combat);
  }
  return combat;
}

function currentToken(combat: CombatState): CombatToken | undefined {
  const id = combat.turnOrder[combat.turnIndex];
  return combat.tokens.find((t) => t.id === id);
}

function beginTurn(combat: CombatState): void {
  // skip dead / missing tokens
  let guard = 0;
  while (guard < combat.turnOrder.length + 1) {
    const t = currentToken(combat);
    if (t && !t.dead) break;
    combat.turnIndex = (combat.turnIndex + 1) % combat.turnOrder.length;
    guard += 1;
  }
  const t = currentToken(combat);
  if (!t || t.dead) {
    checkEnd(combat);
    combat.reachable = [];
    return;
  }
  t.movementLeft = t.speedCells;
  t.hasAction = true;
  t.hasBonusAction = t.kind === "pc";
  t.dodging = false;
  t.disengaging = false;
  t.helpingTargetId = undefined;
  pushLog(combat, `Turn: ${t.name}`);
  refreshReachable(combat);
}

/** Advance initiative; auto-resolve every enemy until a living PC (or combat ends). */
function advanceTurn(combat: CombatState): void {
  if (combat.status !== "active") return;
  combat.turnIndex = (combat.turnIndex + 1) % combat.turnOrder.length;
  let guard = 0;
  while (combat.status === "active" && guard < combat.turnOrder.length + 4) {
    guard += 1;
    beginTurn(combat);
    if (combat.status !== "active") return;
    const cur = currentToken(combat);
    if (!cur || cur.dead) {
      checkEnd(combat);
      return;
    }
    if (cur.kind === "pc") {
      refreshReachable(combat);
      return; // wait for player
    }
    // Enemy: resolve then step initiative (do NOT recurse beginTurn from enemy)
    runEnemyTurn(combat, cur);
    if (combat.status !== "active") return;
    combat.turnIndex = (combat.turnIndex + 1) % combat.turnOrder.length;
  }
  // Safety: if we somehow looped only enemies/dead, force check
  checkEnd(combat);
}

function runEnemyTurn(combat: CombatState, enemy: CombatToken): void {
  const pcs = combat.tokens.filter((t) => t.kind === "pc" && !t.dead);
  if (!pcs.length) {
    checkEnd(combat);
    return;
  }
  pcs.sort(
    (a, b) =>
      chebyshev(enemy.x, enemy.y, a.x, a.y) -
      chebyshev(enemy.x, enemy.y, b.x, b.y),
  );
  const target = pcs[0]!;
  const reach = computeReachable(combat, enemy.id);
  let best = {
    x: enemy.x,
    y: enemy.y,
    d: chebyshev(enemy.x, enemy.y, target.x, target.y),
  };
  for (const c of reach) {
    const d = chebyshev(c.x, c.y, target.x, target.y);
    if (d < best.d) best = { x: c.x, y: c.y, d };
  }
  if (best.x !== enemy.x || best.y !== enemy.y) {
    const cost = movementCostTo(combat, enemy, best.x, best.y) ?? 0;
    enemy.x = best.x;
    enemy.y = best.y;
    enemy.movementLeft = Math.max(0, enemy.movementLeft - cost);
    pushLog(combat, `${enemy.name} skitters to (${enemy.x},${enemy.y}).`);
  }

  const abilityId = enemy.actionIds[0];
  const ability = abilityId ? getAbility(abilityId) : undefined;
  if (ability && enemy.hasAction) {
    const effect = ability.effects.find((e) => e.type === "attack");
    if (effect) {
      const range = Number(effect.rangeCells ?? 1);
      if (chebyshev(enemy.x, enemy.y, target.x, target.y) <= range) {
        const bonus = Number(effect.attackBonus ?? 0);
        let d20 = rollD20();
        if (target.dodging) d20 = Math.min(d20, rollD20());
        const total = d20 + bonus;
        enemy.hasAction = false;
        if (total >= target.ac) {
          let dmg = 0;
          for (const part of effect.damage as Array<{ dice: string }>) {
            dmg += rollNotation(part.dice).total;
          }
          applyDamage(combat, target, dmg);
          pushLog(
            combat,
            `${enemy.name} bites ${target.name}: ${total} vs AC ${target.ac}${target.dodging ? " (dodge)" : ""}, ${dmg} damage.`,
          );
        } else {
          pushLog(
            combat,
            `${enemy.name} snaps at ${target.name}: ${total} vs AC ${target.ac}${target.dodging ? " (dodge)" : ""} — miss.`,
          );
        }
      }
    }
  }
  enemy.hasAction = false;
  enemy.movementLeft = 0;
  checkEnd(combat);
}

function checkEnd(combat: CombatState): void {
  const pcsAlive = combat.tokens.some((t) => t.kind === "pc" && !t.dead);
  const enemiesAlive = combat.tokens.some((t) => t.kind === "enemy" && !t.dead);
  if (!enemiesAlive) {
    combat.status = "victory";
    pushLog(combat, "Victory!");
  } else if (!pcsAlive) {
    combat.status = "defeat";
    pushLog(combat, "The party falls…");
  }
}

export function proposeMove(
  combat: CombatState,
  playerId: string,
  x: number,
  y: number,
): { dice?: { roller: string; notation: string; values: number[]; total: number } } {
  if (combat.status !== "active") throw new Error("COMBAT_OVER");
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId) throw new Error("NOT_YOUR_TURN");
  const ok = combat.reachable.some((c) => c.x === x && c.y === y);
  if (!ok) throw new Error("UNREACHABLE");
  // spend movement via shortest path cost
  const cost = movementCostTo(combat, t, x, y);
  if (cost === null || cost > t.movementLeft) throw new Error("UNREACHABLE");
  t.x = x;
  t.y = y;
  t.movementLeft -= cost;
  pushLog(combat, `${t.name} moves to (${x},${y}).`);
  refreshReachable(combat);
  return {};
}

function movementCostTo(
  combat: CombatState,
  token: CombatToken,
  tx: number,
  ty: number,
): number | null {
  type Node = { x: number; y: number; spent: number; diag: number };
  const best = new Map<string, number>();
  const q: Node[] = [{ x: token.x, y: token.y, spent: 0, diag: 0 }];
  best.set(`${token.x},${token.y}`, 0);
  while (q.length) {
    q.sort((a, b) => a.spent - b.spent);
    const cur = q.shift()!;
    if (cur.x === tx && cur.y === ty) return cur.spent;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!walkable(combat, nx, ny, token.id) && !(nx === tx && ny === ty)) continue;
      if (!inBounds(combat, nx, ny) || combat.walls[ny][nx]) continue;
      if (occupied(combat, nx, ny, token.id) && !(nx === tx && ny === ty)) continue;
      const isDiag = dx !== 0 && dy !== 0;
      const actualCost = isDiag ? (cur.diag % 2 === 0 ? 1 : 2) : 1;
      const spent = cur.spent + actualCost;
      if (spent > token.movementLeft) continue;
      const key = `${nx},${ny}`;
      if (best.has(key) && best.get(key)! <= spent) continue;
      best.set(key, spent);
      q.push({ x: nx, y: ny, spent, diag: isDiag ? cur.diag + 1 : cur.diag });
    }
  }
  return null;
}

export function performAttack(
  combat: CombatState,
  playerId: string,
  abilityId: string,
  targetId?: string,
): { dice?: DiceRoll; rolls?: DiceRoll[] } {
  return performPcAction(combat, playerId, abilityId, targetId);
}

export function performPcAction(
  combat: CombatState,
  playerId: string,
  abilityId: string,
  targetId?: string,
): { dice?: DiceRoll; rolls?: DiceRoll[] } {
  if (combat.status !== "active") throw new Error("COMBAT_OVER");
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId) throw new Error("NOT_YOUR_TURN");

  const isBonus = t.bonusActionIds.includes(abilityId);
  const isAction = t.actionIds.includes(abilityId);
  if (!isBonus && !isAction) throw new Error("BAD_ABILITY");

  const ability = getAbility(abilityId);
  if (!ability) throw new Error("BAD_ABILITY");

  if (isBonus) {
    if (!t.hasBonusAction) throw new Error("NO_BONUS");
  } else if (!t.hasAction) {
    throw new Error("NO_ACTION");
  }

  const effect = ability.effects[0];
  if (!effect) throw new Error("NO_EFFECT");

  // --- Standard / bonus utility actions ---
  if (effect.type === "dash") {
    t.movementLeft += t.speedCells;
    spendEconomy(t, isBonus);
    pushLog(combat, `${t.name} Dashes (+${t.speedCells} movement).`);
    refreshReachable(combat);
    return {};
  }
  if (effect.type === "disengage") {
    t.disengaging = true;
    spendEconomy(t, isBonus);
    pushLog(combat, `${t.name} Disengages (no opportunity attacks).`);
    refreshReachable(combat);
    return {};
  }
  if (effect.type === "dodge") {
    t.dodging = true;
    spendEconomy(t, isBonus);
    pushLog(combat, `${t.name} Dodges (attacks against them have disadvantage).`);
    refreshReachable(combat);
    return {};
  }
  if (effect.type === "help") {
    if (!targetId) throw new Error("NEED_TARGET");
    const ally = combat.tokens.find((x) => x.id === targetId && x.kind === "pc" && !x.dead);
    if (!ally) throw new Error("BAD_TARGET");
    if (chebyshev(t.x, t.y, ally.x, ally.y) > 1) throw new Error("OUT_OF_RANGE");
    t.helpingTargetId = ally.id;
    spendEconomy(t, isBonus);
    pushLog(combat, `${t.name} Helps ${ally.name} (advantage on next check/attack vs adjacent foe).`);
    refreshReachable(combat);
    return {};
  }
  if (effect.type === "hide") {
    const pregen = getPregen(t.characterId!);
    const mod = abilityMod(pregen!.abilities.dex) + (pregen!.proficiencyBonus ?? 2);
    const d20 = rollD20();
    const total = d20 + mod;
    const dc = 12; // simplified contested DC
    const dice = makeDiceRoll({
      roller: t.name,
      notation: `1d20+${mod}`,
      values: [d20],
      sides: [20],
      modifier: mod,
      total,
      purpose: "check",
      label: "Hide (Stealth)",
    });
    if (total >= dc) {
      t.hidden = true;
      pushLog(combat, `${t.name} Hides successfully (${total} vs DC ${dc}).`);
    } else {
      pushLog(combat, `${t.name} fails to Hide (${total} vs DC ${dc}).`);
    }
    spendEconomy(t, isBonus);
    refreshReachable(combat);
    return { dice, rolls: [dice] };
  }
  if (effect.type === "ready") {
    spendEconomy(t, isBonus);
    pushLog(combat, `${t.name} Readies an action (triggers if the condition occurs before next turn).`);
    refreshReachable(combat);
    return {};
  }
  if (effect.type === "search") {
    const pregen = getPregen(t.characterId!);
    const mod = abilityMod(pregen!.abilities.wis) + (pregen!.proficiencyBonus ?? 2);
    const d20 = rollD20();
    const total = d20 + mod;
    const dice = makeDiceRoll({
      roller: t.name,
      notation: `1d20+${mod}`,
      values: [d20],
      sides: [20],
      modifier: mod,
      total,
      purpose: "check",
      label: "Search (Perception)",
    });
    spendEconomy(t, isBonus);
    pushLog(combat, `${t.name} Searches the area (Perception ${total}).`);
    refreshReachable(combat);
    return { dice, rolls: [dice] };
  }
  if (effect.type === "heal" && effect.self) {
    if (abilityId === "second_wind") {
      if (t.secondWindUsed) throw new Error("ALREADY_USED");
      t.secondWindUsed = true;
    }
    if (effect.consume) {
      const item = String(effect.consume);
      const idx = t.inventory.indexOf(item);
      if (idx < 0) throw new Error("NO_ITEM");
      t.inventory.splice(idx, 1);
    }
    let notation = String(effect.dice);
    if (abilityId === "second_wind") {
      const lvl = getPregen(t.characterId!)?.level ?? 3;
      notation = `1d10+${lvl}`;
    }
    const rolled = rollNotation(notation);
    const healed = rolled.total;
    t.hp = Math.min(t.maxHp, t.hp + healed);
    spendEconomy(t, isBonus);
    pushLog(combat, `${t.name} uses ${ability.name} and recovers ${healed} HP (now ${t.hp}/${t.maxHp}).`);
    refreshReachable(combat);
    const dice = makeDiceRoll({
      roller: t.name,
      notation,
      values: rolled.values,
      sides: rolled.sides,
      modifier: rolled.modifier,
      total: healed,
      purpose: "heal",
      label: ability.name,
    });
    return { dice, rolls: [dice] };
  }

  // --- Attacks / spells needing a target ---
  if (!targetId) throw new Error("NEED_TARGET");
  const target = combat.tokens.find((x) => x.id === targetId);
  if (!target || target.dead) throw new Error("BAD_TARGET");

  const atkEffect = ability.effects.find((e) => e.type === "attack" || e.type === "auto_hit");
  if (!atkEffect) throw new Error("NOT_ATTACK");
  if (target.kind !== "enemy" && atkEffect.type !== "help") throw new Error("BAD_TARGET");

  const range = Number(atkEffect.rangeCells ?? 1);
  const dist = chebyshev(t.x, t.y, target.x, target.y);
  if (dist > range) throw new Error("OUT_OF_RANGE");

  const pregen = getPregen(t.characterId!);
  const prof = pregen?.proficiencyBonus ?? 2;

  if (atkEffect.type === "auto_hit") {
    const missiles = Number(atkEffect.missiles ?? 1);
    const dmgSpec = (atkEffect.damage as Array<{ dice: string; damageType: string }>)[0];
    let totalDmg = 0;
    const values: number[] = [];
    const sides: number[] = [];
    let modifier = 0;
    for (let i = 0; i < missiles; i += 1) {
      const r = rollNotation(dmgSpec.dice);
      totalDmg += r.total;
      values.push(...r.values);
      sides.push(...r.sides);
      modifier = r.modifier;
    }
    applyDamage(combat, target, totalDmg);
    t.hidden = false;
    spendEconomy(t, isBonus);
    const dice = makeDiceRoll({
      roller: t.name,
      notation: `${missiles}×${dmgSpec.dice}`,
      values,
      sides,
      modifier: missiles > 1 ? 0 : modifier,
      total: totalDmg,
      purpose: "damage",
      label: ability.name,
    });
    pushLog(combat, `${t.name} casts ${ability.name} on ${target.name} for ${totalDmg} damage.`);
    checkEnd(combat);
    refreshReachable(combat);
    return { dice, rolls: [dice] };
  }

  let attackBonus = Number(atkEffect.attackBonus ?? 0);
  if (atkEffect.ability) {
    const ab = String(atkEffect.ability);
    attackBonus = abilityMod(pregen!.abilities[ab]) + (atkEffect.proficient ? prof : 0);
  }
  if (atkEffect.spellAttack) {
    const ab = String(atkEffect.ability || "int");
    attackBonus = abilityMod(pregen!.abilities[ab]) + prof;
  }

  const d20a = rollD20();
  let d20 = d20a;
  const advantage = t.hidden || Boolean(t.helpingTargetId);
  let d20b: number | undefined;
  if (advantage) {
    d20b = rollD20();
    d20 = Math.max(d20a, d20b);
  }
  const total = d20 + attackBonus;
  const hit = total >= target.ac;
  const attackRoll = makeDiceRoll({
    roller: t.name,
    notation: advantage ? `2d20kh1+${attackBonus}` : `1d20+${attackBonus}`,
    values: advantage && d20b != null ? [d20a, d20b] : [d20],
    sides: advantage && d20b != null ? [20, 20] : [20],
    modifier: attackBonus,
    total,
    purpose: "attack",
    label: `${ability.name} vs ${target.name}`,
    isCrit: d20 === 20,
    isFumble: d20 === 1,
  });
  const rolls: DiceRoll[] = [attackRoll];
  t.hidden = false;
  t.helpingTargetId = undefined;
  spendEconomy(t, isBonus);

  if (!hit) {
    pushLog(combat, `${t.name} attacks ${target.name} with ${ability.name}: ${total} vs AC ${target.ac} — miss.`);
    refreshReachable(combat);
    return { dice: attackRoll, rolls };
  }

  let dmgTotal = 0;
  const dmgValues: number[] = [];
  const dmgSides: number[] = [];
  let dmgMod = 0;
  let dmgNotationParts: string[] = [];
  const dmgParts = atkEffect.damage as Array<{
    dice: string;
    damageType: string;
    ability?: string;
  }>;
  for (const part of dmgParts) {
    let notation = part.dice;
    if (part.ability && /^\d+d\d+$/i.test(part.dice)) {
      const mod = abilityMod(pregen!.abilities[part.ability]);
      notation = `${part.dice}${mod >= 0 ? "+" : ""}${mod}`;
    }
    const r = rollNotation(notation);
    dmgTotal += r.total;
    dmgValues.push(...r.values);
    dmgSides.push(...r.sides);
    dmgMod += r.modifier;
    dmgNotationParts.push(notation);
  }
  // Sneak Attack if rogue trait and advantage/ally
  if (pregen?.traits?.includes("sneak_attack_2d6") || pregen?.class === "rogue") {
    const allyNear = combat.tokens.some(
      (a) =>
        a.kind === "pc" &&
        !a.dead &&
        a.id !== t.id &&
        chebyshev(a.x, a.y, target.x, target.y) <= 1,
    );
    if (advantage || allyNear) {
      const sneak = rollNotation("2d6");
      dmgTotal += sneak.total;
      dmgValues.push(...sneak.values);
      dmgSides.push(...sneak.sides);
      dmgNotationParts.push("2d6 SA");
      pushLog(combat, `${t.name} Sneak Attack!`);
    }
  }
  const damageRoll = makeDiceRoll({
    roller: t.name,
    notation: dmgNotationParts.join("+"),
    values: dmgValues,
    sides: dmgSides,
    modifier: dmgMod,
    total: dmgTotal,
    purpose: "damage",
    label: `Damage · ${ability.name}`,
  });
  rolls.push(damageRoll);
  applyDamage(combat, target, dmgTotal);
  pushLog(
    combat,
    `${t.name} hits ${target.name} with ${ability.name}: ${total} vs AC ${target.ac}, ${dmgTotal} damage.`,
  );

  if (atkEffect.onHitSave && !target.dead) {
    const save = atkEffect.onHitSave as {
      ability: string;
      dc: number;
      damage: Array<{ dice: string; damageType: string }>;
    };
    const saveD20 = rollD20();
    const saveMod = abilityMod(10);
    const saveTotal = saveD20 + saveMod;
    const saveDice = makeDiceRoll({
      roller: target.name,
      notation: `1d20+${saveMod}`,
      values: [saveD20],
      sides: [20],
      modifier: saveMod,
      total: saveTotal,
      purpose: "save",
      label: `${save.ability.toUpperCase()} save DC ${save.dc}`,
    });
    rolls.push(saveDice);
    if (saveTotal < save.dc) {
      const extra = rollNotation(save.damage[0].dice);
      applyDamage(combat, target, extra.total);
      rolls.push(
        makeDiceRoll({
          roller: t.name,
          notation: save.damage[0].dice,
          values: extra.values,
          sides: extra.sides,
          modifier: extra.modifier,
          total: extra.total,
          purpose: "damage",
          label: save.damage[0].damageType,
        }),
      );
      pushLog(combat, `${target.name} fails save — +${extra.total} ${save.damage[0].damageType}.`);
    } else {
      pushLog(combat, `${target.name} succeeds on the save.`);
    }
  }

  checkEnd(combat);
  refreshReachable(combat);
  return { dice: attackRoll, rolls };
}

function spendEconomy(t: CombatToken, bonus: boolean): void {
  if (bonus) t.hasBonusAction = false;
  else t.hasAction = false;
}

function applyDamage(combat: CombatState, target: CombatToken, amount: number): void {
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp === 0) {
    target.dead = true;
    pushLog(combat, `${target.name} is down!`);
  }
}

export function endTurn(combat: CombatState, playerId: string): void {
  if (combat.status !== "active") throw new Error("COMBAT_OVER");
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId) throw new Error("NOT_YOUR_TURN");
  advanceTurn(combat);
}

function abilityModLabel(score: number): string {
  const m = abilityMod(score);
  return m >= 0 ? `+${m}` : `${m}`;
}

function buildPcSheet(
  token: CombatToken,
  actionMenu: {
    actions: Array<{
      id: string;
      name: string;
      economy: string;
      needsTarget?: boolean;
      guided?: boolean;
      available?: boolean;
    }>;
    bonusActions: Array<{
      id: string;
      name: string;
      economy: string;
      needsTarget?: boolean;
      guided?: boolean;
      available?: boolean;
    }>;
  } | null,
) {
  const pregen = token.characterId ? getPregen(token.characterId) : undefined;
  const abs = pregen?.abilities ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  return {
    characterId: token.characterId,
    name: token.name,
    summary: pregen?.summary ?? "",
    level: pregen?.level ?? 1,
    className: pregen?.class ?? "adventurer",
    race: (pregen as { race?: string } | undefined)?.race ?? "",
    background: (pregen as { background?: string } | undefined)?.background ?? "",
    hp: token.hp,
    maxHp: token.maxHp,
    ac: token.ac,
    speedCells: token.speedCells,
    proficiencyBonus: pregen?.proficiencyBonus ?? 2,
    abilities: Object.fromEntries(
      Object.entries(abs).map(([k, v]) => [
        k,
        { score: v, mod: abilityMod(v), modLabel: abilityModLabel(v) },
      ]),
    ),
    savingThrows: (pregen as { savingThrows?: string[] } | undefined)?.savingThrows ?? [],
    skills: (pregen as { skills?: string[] } | undefined)?.skills ?? [],
    features: (pregen as { features?: string[] } | undefined)?.features ?? [],
    traits: pregen?.traits ?? [],
    inventory: token.inventory ?? [],
    weapons: (pregen as { weapons?: string[] } | undefined)?.weapons ?? [],
    economy: {
      movementLeft: token.movementLeft,
      hasAction: token.hasAction,
      hasBonusAction: token.hasBonusAction,
      dodging: token.dodging,
      disengaging: token.disengaging,
      hidden: token.hidden,
    },
    actions: actionMenu?.actions ?? [],
    bonusActions: actionMenu?.bonusActions ?? [],
  };
}

export function publicCombat(combat: CombatState, viewerPlayerId?: string) {
  const current = currentToken(combat);
  const guidedId =
    current?.kind === "pc" && current.characterId
      ? getPregen(current.characterId)?.guidedDefaultAction
      : undefined;

  function mapAction(id: string, economy: "action" | "bonus_action") {
    const a = getAbility(id);
    const needsTarget =
      a?.effects?.some((e) =>
        ["attack", "auto_hit", "help"].includes(String(e.type)),
      ) || Boolean((a as { needsTarget?: boolean } | undefined)?.needsTarget);
    return {
      id,
      name: a?.name ?? id,
      actionType: economy,
      economy,
      needsTarget: Boolean(needsTarget),
      guided: id === guidedId,
      available:
        economy === "bonus_action"
          ? Boolean(current?.hasBonusAction)
          : Boolean(current?.hasAction),
    };
  }

  const actionMenu =
    current?.kind === "pc" && !current.dead
      ? {
          movement: {
            left: current.movementLeft,
            speed: current.speedCells,
            hint: "Move on your turn (walk / optional Dash).",
          },
          actions: current.actionIds.map((id) => mapAction(id, "action")),
          bonusActions: current.bonusActionIds
            .filter((id) => !(id === "second_wind" && current.secondWindUsed))
            .map((id) => mapAction(id, "bonus_action")),
          flags: {
            dodging: current.dodging,
            disengaging: current.disengaging,
            hidden: current.hidden,
            hasAction: current.hasAction,
            hasBonusAction: current.hasBonusAction,
          },
        }
      : null;

  const myTok = viewerPlayerId
    ? combat.tokens.find((t) => t.playerId === viewerPlayerId && t.kind === "pc")
    : current?.kind === "pc"
      ? current
      : combat.tokens.find((t) => t.kind === "pc" && !t.dead);

  // Sheet always reflects the viewer's PC (or first PC), with live HP; action lists from current turn menu when it's their turn
  const sheetTok = myTok;
  const sheetMenu =
    sheetTok && current?.id === sheetTok.id
      ? actionMenu
      : sheetTok
        ? {
            movement: {
              left: sheetTok.movementLeft,
              speed: sheetTok.speedCells,
              hint: "Not your turn",
            },
            actions: sheetTok.actionIds.map((id) => mapAction(id, "action")).map((a) => ({
              ...a,
              available: false,
            })),
            bonusActions: sheetTok.bonusActionIds
              .filter((id) => !(id === "second_wind" && sheetTok.secondWindUsed))
              .map((id) => mapAction(id, "bonus_action"))
              .map((a) => ({ ...a, available: false })),
            flags: {
              dodging: sheetTok.dodging,
              disengaging: sheetTok.disengaging,
              hidden: sheetTok.hidden,
              hasAction: sheetTok.hasAction,
              hasBonusAction: sheetTok.hasBonusAction,
            },
          }
        : null;

  return {
    encounterId: combat.encounterId,
    mapId: combat.mapId,
    width: combat.width,
    height: combat.height,
    walls: combat.walls,
    tokens: combat.tokens.map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      x: t.x,
      y: t.y,
      hp: t.hp,
      maxHp: t.maxHp,
      ac: t.ac,
      dead: t.dead,
      playerId: t.playerId,
      actionIds: t.actionIds,
      movementLeft: t.movementLeft,
      hasAction: t.hasAction,
      hasBonusAction: t.hasBonusAction,
      dodging: t.dodging,
      disengaging: t.disengaging,
      hidden: t.hidden,
    })),
    turnOrder: combat.turnOrder,
    currentTokenId: current?.id,
    currentName: current?.name,
    reachable: combat.reachable,
    log: combat.log.slice(-12),
    status: combat.status,
    actions: [
      ...(actionMenu?.actions ?? []),
      ...(actionMenu?.bonusActions ?? []),
    ],
    actionMenu,
    sheet: sheetTok ? buildPcSheet(sheetTok, sheetMenu) : null,
  };
}

/** Disconnect: current PC Dodges (skips remainder) if it's their turn. */
export function applyDisconnectDodge(combat: CombatState, playerId: string): void {
  if (combat.status !== "active") return;
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId || t.dead) return;
  t.hasAction = false;
  t.movementLeft = 0;
  pushLog(combat, `${t.name} loses connection — Dodges and skips the rest of the turn.`);
  advanceTurn(combat);
}
