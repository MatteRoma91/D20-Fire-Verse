import {
  abilityMod,
  getAbility,
  getEncounter,
  getMap,
  getMonster,
  getPregen,
  portraitForCharacter,
  portraitForMonster,
  type MapDef,
  type Pregen,
} from "./campaign.js";
import {
  critNotation,
  makeDiceRoll,
  rollAttack,
  rollCheck,
  rollD20,
  rollNotation,
  type D20Mode,
  type DiceOutcome,
  type DiceRoll,
} from "./dice.js";
import {
  exportVitals,
  initSheet,
  longRestResources,
  refreshMenus,
  scaledDice,
  shortRestResources,
  spendSlot,
  type Vitals,
} from "./srd-sheet.js";
import type { Player } from "./types.js";

export type Cell = { x: number; y: number };

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
  blessed?: boolean;
  /** Guiding Bolt: the next attack against this token has advantage. */
  marked?: boolean;
  sneakUsed?: boolean;
  webCooldown?: number;
  /** Sheet-driven heroes rebuild their menu from class, spells and slots. */
  sheetDriven?: boolean;
  slots?: Record<string, number>;
  cantrips?: string[];
  spells?: string[];
  spellAbility?: string;
  reactionIds?: string[];
  reactionReady?: boolean;
  features?: string[];
  fightingStyle?: string;
  conditions?: string[];
  dying?: boolean;
  stable?: boolean;
  deathSuccesses?: number;
  deathFailures?: number;
  acBonus?: number;
  acFloor?: number;
  blur?: boolean;
  invisible?: boolean;
  raging?: boolean;
  ragesLeft?: number;
  reckless?: boolean;
  actionSurge?: boolean;
  extraAction?: boolean;
  ki?: number;
  kiMax?: number;
  layOnHands?: number;
  layOnHandsMax?: number;
  channelDivinity?: number;
  bardicLeft?: number;
  inspiration?: number;
  sorceryPoints?: number;
  castLeveled?: boolean;
  castBonusSpell?: boolean;
  spiritualRounds?: number;
  concentrating?: { spellId: string; targetId?: string };
  brand?: { by: string; dice: string };
  hitDie?: number;
  hitDice?: number;
  arcaneRecovery?: boolean;
  attackedThisTurn?: boolean;
};

export type StrikeHit = {
  targetId: string;
  outcome: DiceOutcome;
  damage: number;
  hp: number;
};

export type CombatEvent = { seq: number; line: string } & (
  | { kind: "start"; order: string[] }
  | { kind: "turn"; tokenId: string; round: number }
  | { kind: "move"; tokenId: string; path: Cell[] }
  | {
      kind: "strike";
      tokenId: string;
      ability: string;
      style: "melee" | "ranged" | "spell";
      rolls: DiceRoll[];
      hits: StrikeHit[];
    }
  | { kind: "heal"; tokenId: string; targetId: string; ability: string; amount: number; hp: number; rolls: DiceRoll[] }
  | { kind: "status"; tokenId: string; ability: string; rolls: DiceRoll[] }
  | { kind: "down"; tokenId: string }
  | { kind: "end"; outcome: "victory" | "defeat" }
);

type EventInput = CombatEvent extends infer E ? (E extends CombatEvent ? Omit<E, "seq"> : never) : never;

const STANDARD_ACTIONS = [
  "std_dash",
  "std_disengage",
  "std_dodge",
  "std_help",
  "std_hide",
  "std_search",
] as const;

export type PendingReaction = {
  kind: "shield" | "opportunity" | "smite";
  playerId: string;
  tokenId: string;
  prompt: string;
  acceptLabel: string;
  declineLabel: string;
  abilityId?: string;
  targetId?: string;
  attackTotal?: number;
  damage: number;
  crit?: boolean;
  damageType?: string;
  negateAuto?: boolean;
  rolls: DiceRoll[];
  abilityName: string;
  style: "melee" | "ranged" | "spell";
  attackerId: string;
  moverId?: string;
  path?: Cell[];
  cost?: number;
  dest?: Cell;
  resumePath?: Cell[];
  resumeMoverId?: string;
};

const EVENT_WINDOW = 80;

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
  round: number;
  log: string[];
  reachable: Array<{ x: number; y: number }>;
  status: "active" | "victory" | "defeat";
  events: CombatEvent[];
  seq: number;
  pending?: PendingReaction;
  aimRequest?: { playerId: string; abilityId: string };
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

function tokenAt(combat: CombatState, x: number, y: number, ignoreId?: string): CombatToken | undefined {
  return combat.tokens.find((t) => !t.dead && t.id !== ignoreId && t.x === x && t.y === y);
}

function inBounds(combat: CombatState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < combat.width && y < combat.height;
}

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

type Visit = { x: number; y: number; cost: number; parity: number; prev: string | null };

/**
 * Dijkstra over (cell, diagonal parity) with the SRD 5-10-5 diagonal rule.
 * Allies can be passed through but never ended on; walls and foes block.
 */
function explore(combat: CombatState, token: CombatToken, budget: number): Map<string, Visit> {
  const visits = new Map<string, Visit>();
  const startKey = `${token.x},${token.y},0`;
  visits.set(startKey, { x: token.x, y: token.y, cost: 0, parity: 0, prev: null });
  const open: string[] = [startKey];
  while (open.length) {
    open.sort((a, b) => visits.get(a)!.cost - visits.get(b)!.cost);
    const key = open.shift()!;
    const cur = visits.get(key)!;
    for (const [dx, dy] of STEPS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(combat, nx, ny) || combat.walls[ny][nx]) continue;
      const blocker = tokenAt(combat, nx, ny, token.id);
      if (blocker && blocker.kind !== token.kind) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (combat.walls[cur.y][nx] || combat.walls[ny][cur.x])) continue;
      const step = diagonal ? (cur.parity === 0 ? 1 : 2) : 1;
      const cost = cur.cost + step;
      if (cost > budget) continue;
      const parity = diagonal ? 1 - cur.parity : cur.parity;
      const nextKey = `${nx},${ny},${parity}`;
      const seen = visits.get(nextKey);
      if (seen && seen.cost <= cost) continue;
      visits.set(nextKey, { x: nx, y: ny, cost, parity, prev: key });
      if (!open.includes(nextKey)) open.push(nextKey);
    }
  }
  return visits;
}

function bestVisits(combat: CombatState, token: CombatToken, visits: Map<string, Visit>): Map<string, Visit> {
  const best = new Map<string, Visit>();
  for (const v of visits.values()) {
    if (v.x === token.x && v.y === token.y) continue;
    if (tokenAt(combat, v.x, v.y, token.id)) continue;
    const cellKey = `${v.x},${v.y}`;
    const prev = best.get(cellKey);
    if (!prev || v.cost < prev.cost) best.set(cellKey, v);
  }
  return best;
}

function unwind(visits: Map<string, Visit>, end: Visit): Cell[] {
  const path: Cell[] = [];
  let cur: Visit | undefined = end;
  while (cur) {
    path.unshift({ x: cur.x, y: cur.y });
    cur = cur.prev ? visits.get(cur.prev) : undefined;
  }
  return path;
}

export function computeReachable(combat: CombatState, tokenId: string): Array<{ x: number; y: number }> {
  const token = combat.tokens.find((t) => t.id === tokenId);
  if (!token || token.dead) return [];
  const visits = explore(combat, token, token.movementLeft);
  return [...bestVisits(combat, token, visits).values()].map((v) => ({ x: v.x, y: v.y }));
}

/** Cheapest legal path to an empty cell, start cell included, or null. */
export function pathTo(
  combat: CombatState,
  token: CombatToken,
  tx: number,
  ty: number,
): { path: Cell[]; cost: number } | null {
  const visits = explore(combat, token, token.movementLeft);
  const end = bestVisits(combat, token, visits).get(`${tx},${ty}`);
  if (!end) return null;
  return { path: unwind(visits, end), cost: end.cost };
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function refreshReachable(combat: CombatState): void {
  const current = currentToken(combat);
  if (current && current.kind === "pc" && !current.dead && combat.status === "active") {
    combat.reachable = computeReachable(combat, current.id);
  } else {
    combat.reachable = [];
  }
}

function pushLog(combat: CombatState, line: string): void {
  combat.log.push(line);
  if (combat.log.length > 40) combat.log.shift();
}

function emit(combat: CombatState, event: EventInput): void {
  combat.seq += 1;
  combat.events.push({ ...event, seq: combat.seq } as CombatEvent);
  if (combat.events.length > EVENT_WINDOW) combat.events.splice(0, combat.events.length - EVENT_WINDOW);
  if (event.line) pushLog(combat, event.line);
}

export function startCombat(
  encounterId: string,
  players: Player[],
  wounds?: Record<string, number>,
  carry?: Record<string, Vitals>,
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
    const pregen = getPregen(p.characterId);
    if (!pregen) throw new Error("BAD_CHARACTER");
    const spot = map.spawn.pcs[i] || map.spawn.pcs[0];
    const initRoll = rollD20() + abilityMod(pregen.abilities.dex);
      const maxHp = pregen.hp;
      const missing = wounds?.[p.playerId] ?? 0;
      const hp = Math.max(0, maxHp - missing);
      tokens.push({
      id: `pc-${p.playerId}`,
      kind: "pc",
      name: pregen.name,
      x: spot.x,
      y: spot.y,
      hp,
      maxHp,
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
    const hero = tokens[tokens.length - 1]!;
    initSheet(hero, pregen, carry?.[p.playerId]);
    refreshMenus(hero, pregen, getAbility);
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
        name: `${mon.name}${group.count > 1 ? ` ${i + 1}` : ""}`,
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

  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (tokens[i].x !== tokens[j].x || tokens[i].y !== tokens[j].y) continue;
      for (const [dx, dy] of STEPS) {
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

  // Ties go to the higher Dexterity, then to the heroes.
  const dexOf = (t: CombatToken) =>
    t.kind === "pc"
      ? getPregen(t.characterId!)?.abilities.dex ?? 10
      : getMonster(t.monsterId!)?.abilities.dex ?? 10;
  const turnOrder = [...tokens]
    .sort(
      (a, b) =>
        b.initiative - a.initiative ||
        dexOf(b) - dexOf(a) ||
        (a.kind === "pc" ? -1 : 1) - (b.kind === "pc" ? -1 : 1),
    )
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
    round: 1,
    log: [],
    reachable: [],
    status: "active",
    events: [],
    seq: 0,
  };
  emit(combat, {
    kind: "start",
    order: turnOrder,
    line: `Initiative: ${turnOrder.map((id) => tokens.find((t) => t.id === id)!.name).join(", ")}.`,
  });
  beginTurn(combat);
  settleEnemies(combat);
  return combat;
}

/** Older saves predate the event timeline; give them one so playback can resume. */
export function hydrateCombat(combat: CombatState): CombatState {
  if (!Array.isArray(combat.events)) combat.events = [];
  if (typeof combat.seq !== "number") combat.seq = 0;
  if (typeof combat.round !== "number") combat.round = 1;
  refreshReachable(combat);
  return combat;
}

function currentToken(combat: CombatState): CombatToken | undefined {
  const id = combat.turnOrder[combat.turnIndex];
  return combat.tokens.find((t) => t.id === id);
}

function stepIndex(combat: CombatState): void {
  combat.turnIndex += 1;
  if (combat.turnIndex >= combat.turnOrder.length) {
    combat.turnIndex = 0;
    combat.round += 1;
  }
}

function hasCondition(token: CombatToken, id: string): boolean {
  return Boolean(token.conditions?.includes(id));
}

function beginTurn(combat: CombatState): void {
  let guard = 0;
  while (guard < combat.turnOrder.length + 1) {
    const t = currentToken(combat);
    if (!t || t.dead) {
      stepIndex(combat);
      guard += 1;
      continue;
    }
    if (t.kind === "pc" && (t.dying || t.stable)) {
      if (t.dying && !t.stable) resolveDeathSave(combat, t);
      if (combat.status !== "active") return;
      if (t.dead) {
        stepIndex(combat);
        guard += 1;
        continue;
      }
      if (t.dying || t.stable) {
        t.movementLeft = 0;
        t.hasAction = false;
        t.hasBonusAction = false;
        t.reactionReady = false;
        emit(combat, { kind: "turn", tokenId: t.id, round: combat.round, line: `Round ${combat.round} — ${t.name} is down.` });
        combat.reachable = [];
        return;
      }
    } else if (hasCondition(t, "incapacitated") || hasCondition(t, "paralyzed") || hasCondition(t, "unconscious")) {
      stepIndex(combat);
      guard += 1;
      continue;
    }
    break;
  }
  const t = currentToken(combat);
  if (!t || t.dead) {
    checkEnd(combat);
    combat.reachable = [];
    return;
  }
  t.movementLeft = t.speedCells;
  if (hasCondition(t, "restrained") || hasCondition(t, "paralyzed") || hasCondition(t, "unconscious")) t.movementLeft = 0;
  if (hasCondition(t, "slowed")) t.movementLeft = Math.max(0, t.movementLeft - 2);
  t.hasAction = true;
  t.hasBonusAction = t.kind === "pc";
  t.dodging = false;
  t.disengaging = false;
  t.helpingTargetId = undefined;
  t.sneakUsed = false;
  t.acBonus = 0;
  t.reactionReady = true;
  t.castLeveled = false;
  t.castBonusSpell = false;
  t.reckless = false;
  t.extraAction = false;
  t.attackedThisTurn = false;
  if (t.spiritualRounds) t.spiritualRounds -= 1;
  if (t.webCooldown) t.webCooldown -= 1;
  if (t.sheetDriven && t.characterId) refreshMenus(t, getPregen(t.characterId), getAbility);
  emit(combat, { kind: "turn", tokenId: t.id, round: combat.round, line: `Round ${combat.round} — ${t.name}.` });
  refreshReachable(combat);
}

/** Resolve every enemy turn in initiative order until a living hero is up or the fight ends. */
function settleEnemies(combat: CombatState): void {
  let guard = 0;
  while (combat.status === "active" && !combat.pending && guard < combat.turnOrder.length * 2 + 4) {
    guard += 1;
    const cur = currentToken(combat);
    if (!cur || cur.dead) {
      checkEnd(combat);
      return;
    }
    if (cur.kind === "pc") {
      refreshReachable(combat);
      return;
    }
    runEnemyTurn(combat, cur);
    if (combat.status !== "active") return;
    stepIndex(combat);
    beginTurn(combat);
  }
  checkEnd(combat);
}

function advanceTurn(combat: CombatState): void {
  if (combat.status !== "active") return;
  stepIndex(combat);
  beginTurn(combat);
  settleEnemies(combat);
}

type AttackSpec = {
  id: string;
  name: string;
  range: number;
  bonus: number;
  damage: Array<{ dice: string; damageType: string }>;
  onHitSave?: { ability: string; dc: number; damage?: Array<{ dice: string; damageType: string }>; condition?: string };
  fireOnHit?: string;
};

function enemyAttacks(enemy: CombatToken): AttackSpec[] {
  const out: AttackSpec[] = [];
  for (const id of enemy.actionIds) {
    const ability = getAbility(id);
    const effect = ability?.effects.find((e) => e.type === "attack");
    if (!ability || !effect) continue;
    const perTurn = (effect.onHit as Array<{ type: string; dice?: string }> | undefined)?.find(
      (h) => h.type === "damage_per_turn_start",
    );
    out.push({
      id,
      name: ability.name,
      range: Number(effect.rangeCells ?? 1),
      bonus: Number(effect.attackBonus ?? 0),
      damage: (effect.damage as AttackSpec["damage"] | undefined) ?? [],
      onHitSave: effect.onHitSave as AttackSpec["onHitSave"],
      fireOnHit: perTurn?.dice,
    });
  }
  return out;
}

function pickEnemyAttack(enemy: CombatToken, attacks: AttackSpec[], dist: number): AttackSpec | undefined {
  const inReach = attacks.filter((a) => a.range >= dist && (a.range <= 1 || !enemy.webCooldown));
  if (!inReach.length) return undefined;
  if (dist <= 1) return inReach.find((a) => a.range <= 1) ?? inReach[0];
  return inReach.sort((a, b) => a.range - b.range)[0];
}

function runEnemyTurn(combat: CombatState, enemy: CombatToken): void {
  const pcs = combat.tokens.filter((t) => t.kind === "pc" && !t.dead);
  if (!pcs.length) {
    checkEnd(combat);
    return;
  }
  pcs.sort(
    (a, b) =>
      chebyshev(enemy.x, enemy.y, a.x, a.y) - chebyshev(enemy.x, enemy.y, b.x, b.y) ||
      a.hp - b.hp,
  );
  const target = pcs[0]!;
  const attacks = enemyAttacks(enemy);
  const melee = attacks.some((a) => a.range <= 1);
  const startDist = chebyshev(enemy.x, enemy.y, target.x, target.y);

  const shouldMove = startDist > 1 && (melee || !pickEnemyAttack(enemy, attacks, startDist));
  let moved = false;
  if (shouldMove) {
    const visits = explore(combat, enemy, enemy.movementLeft);
    let best: Visit | null = null;
    let bestDist = startDist;
    for (const v of bestVisits(combat, enemy, visits).values()) {
      const d = chebyshev(v.x, v.y, target.x, target.y);
      if (d < bestDist || (best && d === bestDist && v.cost < best.cost)) {
        best = v;
        bestDist = d;
      }
    }
    if (best) {
      const path = unwind(visits, best);
      enemy.x = best.x;
      enemy.y = best.y;
      enemy.movementLeft = Math.max(0, enemy.movementLeft - best.cost);
      moved = true;
      emit(combat, {
        kind: "move",
        tokenId: enemy.id,
        path,
        line: `${enemy.name} ${bestDist <= 1 ? "closes on" : "stalks toward"} ${target.name}.`,
      });
    }
  }

  const dist = chebyshev(enemy.x, enemy.y, target.x, target.y);
  const attack = pickEnemyAttack(enemy, attacks, dist);
  if (attack && enemy.hasAction) {
    enemy.hasAction = false;
    enemyStrike(combat, enemy, target, attack);
  } else if (!attack && !moved) {
    emit(combat, {
      kind: "status",
      tokenId: enemy.id,
      ability: "wait",
      rolls: [],
      line: `${enemy.name} hisses and waits for an opening.`,
    });
  }
  enemy.hasAction = false;
  enemy.movementLeft = 0;
  checkEnd(combat);
}

function enemyStrike(combat: CombatState, enemy: CombatToken, target: CombatToken, attack: AttackSpec): void {
  const mode: D20Mode = target.dodging ? "disadvantage" : "normal";
  const roll = rollAttack({
    roller: enemy.name,
    label: `${attack.name} vs ${target.name}`,
    bonus: attack.bonus,
    ac: effectiveAc(target),
    mode,
  });
  const rolls: DiceRoll[] = [roll];
  const landed = roll.outcome === "hit" || roll.outcome === "crit";
  const crit = roll.outcome === "crit";
  let damage = 0;
  if (landed) {
    for (const part of attack.damage) {
      const r = rollNotation(part.dice, { crit });
      damage += r.total;
      rolls.push(
        makeDiceRoll({
          roller: enemy.name,
          notation: crit ? critNotation(part.dice) : part.dice,
          values: r.values,
          sides: r.sides,
          modifier: r.modifier,
          total: r.total,
          purpose: "damage",
          label: `${part.damageType} damage`,
        }),
      );
    }
    if (attack.fireOnHit) {
      const r = rollNotation(attack.fireOnHit, { crit });
      damage += r.total;
      enemy.webCooldown = 2;
      rolls.push(
        makeDiceRoll({
          roller: enemy.name,
          notation: attack.fireOnHit,
          values: r.values,
          sides: r.sides,
          modifier: r.modifier,
          total: r.total,
          purpose: "damage",
          label: "burning silk",
        }),
      );
    }
    if (attack.onHitSave?.damage?.length) {
      const pregen = target.characterId ? getPregen(target.characterId) : undefined;
      const score = pregen?.abilities[attack.onHitSave.ability] ?? 10;
      const proficient = (pregen as { savingThrows?: string[] } | undefined)?.savingThrows?.includes(
        attack.onHitSave.ability,
      );
      const bonus = abilityMod(score) + (proficient ? pregen?.proficiencyBonus ?? 2 : 0);
      const save = rollCheck({
        roller: target.name,
        label: `${attack.onHitSave.ability.toUpperCase()} save`,
        bonus,
        dc: attack.onHitSave.dc,
        purpose: "save",
      });
      rolls.push(save);
      if (save.outcome === "fail") {
        const part = attack.onHitSave.damage[0];
        const r = rollNotation(part.dice);
        damage += r.total;
        rolls.push(
          makeDiceRoll({
            roller: enemy.name,
            notation: part.dice,
            values: r.values,
            sides: r.sides,
            modifier: r.modifier,
            total: r.total,
            purpose: "damage",
            label: `${part.damageType} damage`,
          }),
        );
      }
    }
  } else if (attack.fireOnHit) {
    enemy.webCooldown = 1;
  }
  const verb = attack.range > 1 ? "lashes a strand at" : "lunges at";
  const tail = landed
    ? `${crit ? "Critical! " : ""}${damage} damage.`
    : roll.outcome === "fumble"
      ? "It trips over its own feet."
      : "Miss.";
  const dtype = attack.damage[0]?.damageType ?? "piercing";
  if (
    landed &&
    damage > 0 &&
    holdForShield(combat, enemy, target, {
      damage,
      crit,
      attackTotal: roll.total,
      damageType: dtype,
      rolls,
      abilityName: attack.name,
      style: attack.range > 1 ? "ranged" : "melee",
      attackerId: enemy.id,
      targetId: target.id,
    })
  ) {
    return;
  }
  const hpAfter = Math.max(0, target.hp - damage);
  emit(combat, {
    kind: "strike",
    tokenId: enemy.id,
    ability: attack.name,
    style: attack.range > 1 ? "ranged" : "melee",
    rolls,
    hits: [{ targetId: target.id, outcome: roll.outcome ?? "miss", damage, hp: hpAfter }],
    line: `${enemy.name} ${verb} ${target.name}: ${roll.total} vs AC ${effectiveAc(target)}${mode === "disadvantage" ? " (dodging)" : ""}. ${tail}`,
  });
  if (damage > 0) applyDamage(combat, target, damage, crit, dtype);
}

function checkEnd(combat: CombatState): void {
  if (combat.status !== "active") return;
  const pcsAlive = combat.tokens.some((t) => t.kind === "pc" && !t.dead);
  const enemiesAlive = combat.tokens.some((t) => t.kind === "enemy" && !t.dead);
  if (!enemiesAlive) {
    combat.status = "victory";
    combat.reachable = [];
    emit(combat, { kind: "end", outcome: "victory", line: "The last foe falls. Victory!" });
  } else if (!pcsAlive) {
    combat.status = "defeat";
    combat.reachable = [];
    emit(combat, { kind: "end", outcome: "defeat", line: "The party falls…" });
  }
}

export function proposeMove(
  combat: CombatState,
  playerId: string,
  x: number,
  y: number,
): void {
  if (combat.status !== "active") throw new Error("COMBAT_OVER");
  if (combat.pending) throw new Error("REACTION_PENDING");
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId) throw new Error("NOT_YOUR_TURN");
  const route = pathTo(combat, t, x, y);
  if (!route || route.cost > t.movementLeft) throw new Error("UNREACHABLE");
  commitMove(combat, t, route.path, route.cost);
  refreshReachable(combat);
}

export function performAttack(
  combat: CombatState,
  playerId: string,
  abilityId: string,
  targetId?: string,
  dest?: Cell,
): { rolls: DiceRoll[] } {
  return performPcAction(combat, playerId, abilityId, targetId, dest);
}

function pcSpellDc(pregen: Pregen | undefined, ability: string): number {
  const prof = pregen?.proficiencyBonus ?? 2;
  return 8 + prof + abilityMod(pregen?.abilities[ability] ?? 10);
}

function monsterSaveBonus(token: CombatToken, ability: string): number {
  const mon = token.monsterId ? getMonster(token.monsterId) : undefined;
  return abilityMod(mon?.abilities[ability] ?? 10);
}

function statusEvent(combat: CombatState, t: CombatToken, ability: string, line: string, rolls: DiceRoll[] = []): void {
  emit(combat, { kind: "status", tokenId: t.id, ability, rolls, line });
}

function tokenCastBlocked(token: CombatToken, level: number, asBonus: boolean): boolean {
  if (level <= 0) return false;
  if (token.castBonusSpell) return true;
  if (asBonus && token.castLeveled) return true;
  return false;
}

function addCondition(token: CombatToken, id: string): void {
  if (!token.conditions) token.conditions = [];
  if (!token.conditions.includes(id)) token.conditions.push(id);
}

function spellKey(token: CombatToken, pregen: Pregen | undefined, named: string): string {
  if (named === "spell") return token.spellAbility ?? (pregen as { spellAbility?: string } | undefined)?.spellAbility ?? "int";
  return named;
}

function castSpecial(
  combat: CombatState,
  t: CombatToken,
  pregen: Pregen | undefined,
  name: string,
  effect: Record<string, unknown>,
  isBonus: boolean,
  targetId: string | undefined,
  dest: Cell | undefined,
  castId: string,
): { rolls: DiceRoll[] } | null {
  if (effect.type === "rage") {
    if ((t.ragesLeft ?? 0) <= 0) throw new Error("ALREADY_USED");
    t.ragesLeft = (t.ragesLeft ?? 0) - 1;
    t.raging = true;
    spendEconomy(t, true);
    statusEvent(combat, t, name, `${t.name} rages. Blows land harder, and steel bites less.`);
    return { rolls: [] };
  }
  if (effect.type === "reckless") {
    t.reckless = true;
    statusEvent(combat, t, name, `${t.name} attacks with abandon. Foes will find the opening.`);
    return { rolls: [] };
  }
  if (effect.type === "surge") {
    if (!t.actionSurge) throw new Error("ALREADY_USED");
    t.actionSurge = false;
    t.extraAction = true;
    t.hasAction = true;
    statusEvent(combat, t, name, `${t.name} surges into a second action.`);
    return { rolls: [] };
  }
  if (effect.type === "pool_heal") {
    const ally = targetId ? combat.tokens.find((x) => x.id === targetId && x.kind === "pc") : t;
    if (!ally) throw new Error("NEED_TARGET");
    const pool = t.layOnHands ?? 0;
    if (pool <= 0) throw new Error("ALREADY_USED");
    const need = ally.dying ? 1 : Math.max(0, ally.maxHp - ally.hp);
    const spent = Math.min(pool, Math.max(1, need));
    t.layOnHands = pool - spent;
    ally.hp = Math.min(ally.maxHp, ally.hp + spent);
    ally.dying = false;
    ally.stable = false;
    ally.deathSuccesses = 0;
    ally.deathFailures = 0;
    spendEconomy(t, false);
    statusEvent(combat, t, name, `${t.name} lays on hands. ${ally.name} recovers ${spent}.`);
    return { rolls: [] };
  }
  if (effect.type === "channel_preserve") {
    if ((t.channelDivinity ?? 0) <= 0) throw new Error("ALREADY_USED");
    t.channelDivinity = (t.channelDivinity ?? 0) - 1;
    let pool = 5 * (pregen?.level ?? 1);
    const allies = combat.tokens.filter((a) => a.kind === "pc" && !a.dead && chebyshev(a.x, a.y, t.x, t.y) <= 6);
    for (const ally of allies) {
      const half = Math.floor(ally.maxHp / 2);
      if (ally.hp >= half || pool <= 0) continue;
      const gain = Math.min(pool, half - ally.hp);
      ally.hp += gain;
      pool -= gain;
    }
    spendEconomy(t, false);
    statusEvent(combat, t, name, `${t.name} releases a warm light. The wounded are drawn back from the edge.`);
    return { rolls: [] };
  }
  if (effect.type === "inspire") {
    if ((t.bardicLeft ?? 0) <= 0) throw new Error("ALREADY_USED");
    const ally = combat.tokens.find((x) => x.id === targetId && x.kind === "pc" && x.id !== t.id);
    if (!ally) throw new Error("NEED_TARGET");
    t.bardicLeft = (t.bardicLeft ?? 0) - 1;
    ally.inspiration = (ally.inspiration ?? 0) + 1;
    spendEconomy(t, true);
    statusEvent(combat, t, name, `${t.name} inspires ${ally.name}. A d6 waits on their next roll.`);
    return { rolls: [] };
  }
  if (effect.type === "ki_dodge") {
    if ((t.ki ?? 0) < 1) throw new Error("NO_KI");
    t.ki = (t.ki ?? 0) - 1;
    t.dodging = true;
    spendEconomy(t, true);
    statusEvent(combat, t, name, `${t.name} spends ki and dodges.`);
    return { rolls: [] };
  }
  if (effect.type === "ki_step") {
    if ((t.ki ?? 0) < 1) throw new Error("NO_KI");
    t.ki = (t.ki ?? 0) - 1;
    t.disengaging = true;
    t.movementLeft += t.speedCells;
    spendEconomy(t, true);
    statusEvent(combat, t, name, `${t.name} spends ki, steps clear, and dashes.`);
    refreshReachable(combat);
    return { rolls: [] };
  }
  if (effect.type === "flurry") {
    if ((t.ki ?? 0) < 1) throw new Error("NO_KI");
    if (!targetId) throw new Error("NEED_TARGET");
    t.ki = (t.ki ?? 0) - 1;
    spendEconomy(t, true);
    const strike = getAbility("unarmed_strike");
    const blow = strike?.effects[0];
    if (!blow) throw new Error("NO_EFFECT");
    const first = resolveSpellAttack(combat, t, pregen, "Flurry of Blows", { ...blow, type: "attack" }, targetId, true, true);
    if (combat.status === "active" && !combat.pending) {
      resolveSpellAttack(combat, t, pregen, "Flurry of Blows", { ...blow, type: "attack" }, targetId, true, true);
    }
    return first;
  }
  if (effect.type === "mage_armor") {
    const dex = abilityMod(pregen?.abilities.dex ?? 10);
    t.ac = 13 + dex;
    if (effect.concentration) t.concentrating = { spellId: castId };
    spendEconomy(t, isBonus);
    statusEvent(combat, t, name, `${t.name} is wrapped in mage armor. AC ${t.ac}.`);
    return { rolls: [] };
  }
  if (effect.type === "ward") {
    const ally = targetId ? combat.tokens.find((x) => x.id === targetId) : t;
    const who = ally && ally.kind === "pc" ? ally : t;
    if (effect.acBonus) who.acBonus = (who.acBonus ?? 0) + Number(effect.acBonus);
    if (effect.acFloor) who.acFloor = Number(effect.acFloor);
    if (effect.blur) who.blur = true;
    if (effect.invisible) who.invisible = true;
    if (effect.concentration) t.concentrating = { spellId: castId, targetId: who.id };
    spendEconomy(t, isBonus);
    statusEvent(combat, t, name, `${t.name} casts ${name}.`);
    return { rolls: [] };
  }
  if (effect.type === "brand") {
    if (!targetId) throw new Error("NEED_TARGET");
    const foe = combat.tokens.find((x) => x.id === targetId && x.kind === "enemy" && !x.dead);
    if (!foe) throw new Error("BAD_TARGET");
    foe.brand = { by: t.id, dice: String(effect.dice ?? "1d6") };
    t.concentrating = { spellId: castId, targetId: foe.id };
    spendEconomy(t, isBonus);
    statusEvent(combat, t, name, `${t.name} brands ${foe.name}.`);
    return { rolls: [] };
  }
  if (effect.type === "teleport") {
    if (!dest) throw new Error("NEED_TARGET");
    const range = Number(effect.rangeCells ?? 6);
    if (chebyshev(t.x, t.y, dest.x, dest.y) > range) throw new Error("OUT_OF_RANGE");
    if (tokenAt(combat, dest.x, dest.y) || combat.walls[dest.y]?.[dest.x]) throw new Error("UNREACHABLE");
    t.x = dest.x;
    t.y = dest.y;
    spendEconomy(t, isBonus);
    emit(combat, { kind: "move", tokenId: t.id, path: [{ x: t.x, y: t.y }], line: `${t.name} steps through silver mist.` });
    refreshReachable(combat);
    return { rolls: [] };
  }
  if (effect.type === "sleep") {
    const rolled = rollNotation(String(effect.dice ?? "5d8"));
    let pool = rolled.total;
    const radius = Number(effect.radius ?? 4);
    const origin = targetId ? combat.tokens.find((x) => x.id === targetId) : t;
    if (!origin) throw new Error("NEED_TARGET");
    const victims = combat.tokens
      .filter((e) => e.kind === "enemy" && !e.dead && !hasCondition(e, "unconscious") && chebyshev(e.x, e.y, origin.x, origin.y) <= radius)
      .sort((a, b) => a.hp - b.hp);
    const names: string[] = [];
    for (const foe of victims) {
      if (pool < foe.hp) continue;
      pool -= foe.hp;
      addCondition(foe, "unconscious");
      names.push(foe.name);
    }
    spendEconomy(t, isBonus);
    const dice = makeDiceRoll({
      roller: t.name,
      notation: String(effect.dice ?? "5d8"),
      values: rolled.values,
      sides: rolled.sides,
      modifier: rolled.modifier,
      total: rolled.total,
      purpose: "damage",
      label: "Sleep",
    });
    statusEvent(
      combat,
      t,
      name,
      names.length ? `${t.name} casts sleep (${rolled.total}). ${names.join(", ")} slump.` : `${t.name} casts sleep (${rolled.total}). No one falls.`,
      [dice],
    );
    return { rolls: [dice] };
  }
  if (effect.type === "spiritual_weapon") {
    t.spiritualRounds = 10;
    spendEconomy(t, true);
    statusEvent(combat, t, name, `${t.name} calls a floating weapon. It strikes as a bonus action.`);
    if (t.characterId) refreshMenus(t, pregen, getAbility);
    return { rolls: [] };
  }
  if (effect.type === "restore") {
    const ally = targetId ? combat.tokens.find((x) => x.id === targetId && x.kind === "pc") : t;
    if (!ally) throw new Error("NEED_TARGET");
    ally.conditions = (ally.conditions ?? []).filter((c) => !["blinded", "paralyzed", "poisoned"].includes(c));
    spendEconomy(t, false);
    statusEvent(combat, t, name, `${t.name} restores ${ally.name}.`);
    return { rolls: [] };
  }
  if (effect.type === "aid") {
    const amount = Number(effect.amount ?? 5);
    const allies = combat.tokens.filter((a) => a.kind === "pc" && !a.dead).slice(0, Number(effect.allies ?? 3));
    for (const ally of allies) {
      ally.maxHp += amount;
      ally.hp += amount;
    }
    spendEconomy(t, false);
    statusEvent(combat, t, name, `${t.name} casts aid. ${allies.map((a) => a.name).join(", ")} gain ${amount} hit points.`);
    return { rolls: [] };
  }
  if (effect.type === "rays") {
    if (!targetId) throw new Error("NEED_TARGET");
    const rays = Number(effect.rays ?? 3);
    const rolls: DiceRoll[] = [];
    spendEconomy(t, isBonus);
    for (let i = 0; i < rays; i += 1) {
      if (combat.status !== "active" || combat.pending) break;
      const part = resolveSpellAttack(combat, t, pregen, `${name} ${i + 1}`, effect, targetId, true, true);
      rolls.push(...part.rolls);
    }
    return { rolls };
  }
  return null;
}

export function performPcAction(
  combat: CombatState,
  playerId: string,
  abilityId: string,
  targetId?: string,
  dest?: Cell,
): { rolls: DiceRoll[] } {
  if (combat.status !== "active") throw new Error("COMBAT_OVER");
  if (combat.pending) throw new Error("REACTION_PENDING");
  combat.aimRequest = undefined;
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId) throw new Error("NOT_YOUR_TURN");
  if (t.sheetDriven && t.characterId) refreshMenus(t, getPregen(t.characterId), getAbility);

  let quicken = false;
  let castId = abilityId;
  if (abilityId.startsWith("quicken:")) {
    quicken = true;
    castId = abilityId.slice("quicken:".length);
    if ((t.sorceryPoints ?? 0) < 2) throw new Error("NO_SORCERY");
  }

  const isBonus = t.bonusActionIds.includes(abilityId) || quicken;
  const isAction = t.actionIds.includes(castId);
  if (!isBonus && !isAction) throw new Error("BAD_ABILITY");

  const ability = getAbility(castId);
  if (!ability) throw new Error("BAD_ABILITY");

  if (isBonus) {
    if (!t.hasBonusAction) throw new Error("NO_BONUS");
  } else if (!t.hasAction && !t.extraAction) {
    throw new Error("NO_ACTION");
  }

  const effect = { ...(ability.effects[0] ?? {}) };
  if (!ability.effects[0]) throw new Error("NO_EFFECT");
  const pregen = t.characterId ? getPregen(t.characterId) : undefined;
  const prof = pregen?.proficiencyBonus ?? 2;
  const level = Number((ability as { level?: number }).level ?? effect.slot ?? 0);
  if (level > 0 && tokenCastBlocked(t, level, isBonus || quicken)) throw new Error("BONUS_SPELL");
  let slotUsed = 0;
  if (t.sheetDriven && level > 0 && castId !== "spell_spiritual_weapon_strike") {
    slotUsed = spendSlot(t, level);
    const grown = scaledDice(effect, slotUsed);
    if (grown && Array.isArray(effect.damage)) {
      const parts = effect.damage as Array<{ dice: string }>;
      effect.damage = parts.map((part, index) => (index === 0 ? { ...part, dice: grown } : part));
    }
    if (grown && typeof effect.dice === "string") effect.dice = grown;
  }
  if (quicken) t.sorceryPoints = (t.sorceryPoints ?? 0) - 2;
  if (level > 0) {
    t.castLeveled = true;
    if (isBonus || quicken) t.castBonusSpell = true;
  }
  if (t.sheetDriven && t.characterId) refreshMenus(t, pregen, getAbility);

  const special = castSpecial(combat, t, pregen, ability.name, effect, isBonus || quicken, targetId, dest, castId);
  if (special) return special;

  if (effect.type === "dash") {
    t.movementLeft += t.speedCells;
    spendEconomy(t, isBonus);
    statusEvent(combat, t, ability.name, `${t.name} dashes — ${t.movementLeft * 5} ft of movement left.`);
    refreshReachable(combat);
    return { rolls: [] };
  }
  if (effect.type === "disengage") {
    t.disengaging = true;
    spendEconomy(t, isBonus);
    statusEvent(combat, t, ability.name, `${t.name} disengages and can slip away freely.`);
    refreshReachable(combat);
    return { rolls: [] };
  }
  if (effect.type === "dodge") {
    t.dodging = true;
    spendEconomy(t, isBonus);
    statusEvent(combat, t, ability.name, `${t.name} takes the Dodge — attacks against them have disadvantage.`);
    refreshReachable(combat);
    return { rolls: [] };
  }
  if (effect.type === "help") {
    if (!targetId) throw new Error("NEED_TARGET");
    const ally = combat.tokens.find((x) => x.id === targetId && x.kind === "pc" && !x.dead && x.id !== t.id);
    if (!ally) throw new Error("BAD_TARGET");
    if (chebyshev(t.x, t.y, ally.x, ally.y) > 1) throw new Error("OUT_OF_RANGE");
    ally.helpingTargetId = t.id;
    spendEconomy(t, isBonus);
    statusEvent(combat, t, ability.name, `${t.name} helps ${ally.name} — their next attack has advantage.`);
    refreshReachable(combat);
    return { rolls: [] };
  }
  if (effect.type === "hide" || effect.type === "search") {
    const hide = effect.type === "hide";
    const key = hide ? "dex" : "wis";
    const skill = hide ? "stealth" : "perception";
    const skilled = (pregen as { skills?: string[] } | undefined)?.skills?.includes(skill);
    const bonus = abilityMod(pregen?.abilities[key] ?? 10) + (skilled ? prof : 0);
    const dc = hide ? 12 : 10;
    const roll = rollCheck({
      roller: t.name,
      label: hide ? "Hide (Stealth)" : "Search (Perception)",
      bonus,
      dc,
      purpose: "check",
    });
    if (hide && roll.outcome === "success") t.hidden = true;
    spendEconomy(t, isBonus);
    statusEvent(
      combat,
      t,
      ability.name,
      hide
        ? roll.outcome === "success"
          ? `${t.name} melts into the shadows (${roll.total} vs DC ${dc}).`
          : `${t.name} is spotted trying to hide (${roll.total} vs DC ${dc}).`
        : roll.outcome === "success"
          ? `${t.name} studies the room — nothing hides from them (${roll.total}).`
          : `${t.name} searches, but the dark keeps its secrets (${roll.total}).`,
      [roll],
    );
    refreshReachable(combat);
    return { rolls: [roll] };
  }
  if (effect.type === "ready") {
    spendEconomy(t, isBonus);
    statusEvent(combat, t, ability.name, `${t.name} readies a strike and waits.`);
    refreshReachable(combat);
    return { rolls: [] };
  }
  if (effect.type === "buff") {
    const allies = combat.tokens.filter((a) => a.kind === "pc" && !a.dead);
    for (const a of allies.slice(0, 3)) a.blessed = true;
    spendEconomy(t, isBonus);
    statusEvent(combat, t, ability.name, `${t.name} casts ${ability.name} — the party adds 1d4 to attack rolls.`);
    refreshReachable(combat);
    return { rolls: [] };
  }
  if (effect.type === "heal") {
    let patient = t;
    if (!effect.self) {
      const chosen = targetId ? combat.tokens.find((x) => x.id === targetId && x.kind === "pc" && !x.dead) : undefined;
      if (targetId && !chosen) throw new Error("BAD_TARGET");
      patient = chosen ?? t;
      if (chebyshev(t.x, t.y, patient.x, patient.y) > Number(effect.rangeCells ?? 1)) throw new Error("OUT_OF_RANGE");
    }
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
    if (abilityId === "second_wind") notation = `1d10+${pregen?.level ?? 3}`;
    if (effect.ability) {
      const mod = abilityMod(pregen?.abilities[String(effect.ability)] ?? 10);
      if (/^\d+d\d+$/i.test(notation)) notation = `${notation}${mod >= 0 ? "+" : ""}${mod}`;
    }
    const rolled = rollNotation(notation);
    let healed = rolled.total;
    if (t.features?.includes("disciple_of_life") || t.features?.includes("domain_life")) healed += 2 + Math.max(1, slotUsed);
    const before = patient.hp;
    patient.hp = Math.min(patient.maxHp, patient.hp + healed);
    if (healed > 0 && patient.hp > 0) {
      patient.dying = false;
      patient.stable = false;
      patient.deathSuccesses = 0;
      patient.deathFailures = 0;
    }
    spendEconomy(t, isBonus);
    const dice = makeDiceRoll({
      roller: t.name,
      notation,
      values: rolled.values,
      sides: rolled.sides,
      modifier: rolled.modifier,
      total: rolled.total,
      purpose: "heal",
      label: ability.name,
    });
    emit(combat, {
      kind: "heal",
      tokenId: t.id,
      targetId: patient.id,
      ability: ability.name,
      amount: patient.hp - before,
      hp: patient.hp,
      rolls: [dice],
      line:
        patient === t
          ? `${t.name} uses ${ability.name} and recovers ${patient.hp - before} HP.`
          : `${t.name} casts ${ability.name} on ${patient.name}: +${patient.hp - before} HP.`,
    });
    refreshReachable(combat);
    return { rolls: [dice] };
  }

  if (!targetId) throw new Error("NEED_TARGET");
  const target = combat.tokens.find((x) => x.id === targetId);
  if (!target || target.dead) throw new Error("BAD_TARGET");
  if (target.kind !== "enemy") throw new Error("BAD_TARGET");

  if (effect.type === "save") {
    return castSaveArea(combat, t, target, ability.name, effect, pregen, isBonus);
  }

  const atkEffect = ability.effects.find((e) => e.type === "attack" || e.type === "auto_hit");
  if (!atkEffect) throw new Error("NOT_ATTACK");

  const range = Number(atkEffect.rangeCells ?? 1);
  const dist = chebyshev(t.x, t.y, target.x, target.y);
  if (dist > range) throw new Error("OUT_OF_RANGE");

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
      modifier += r.modifier;
    }
    t.hidden = false;
    spendEconomy(t, isBonus);
    const dice = makeDiceRoll({
      roller: t.name,
      notation: `${missiles}×(${dmgSpec.dice})`,
      values,
      sides,
      modifier,
      total: totalDmg,
      purpose: "damage",
      label: `${ability.name} · ${missiles} darts`,
    });
    if (
      holdForShield(combat, t, target, {
        damage: totalDmg,
        negateAuto: true,
        attackTotal: 99,
        damageType: "force",
        rolls: [dice],
        abilityName: ability.name,
        style: "spell",
        attackerId: t.id,
        targetId: target.id,
      })
    ) {
      return { rolls: [dice] };
    }
    emit(combat, {
      kind: "strike",
      tokenId: t.id,
      ability: ability.name,
      style: "spell",
      rolls: [dice],
      hits: [{ targetId: target.id, outcome: "hit", damage: totalDmg, hp: Math.max(0, target.hp - totalDmg) }],
      line: `${t.name} casts ${ability.name}: ${missiles} darts strike ${target.name} for ${totalDmg}.`,
    });
    applyDamage(combat, target, totalDmg, false, "force");
    checkEnd(combat);
    refreshReachable(combat);
    return { rolls: [dice] };
  }

  let attackBonus = Number(atkEffect.attackBonus ?? 0);
  if (atkEffect.ability) {
    const ab = spellKey(t, pregen, String(atkEffect.ability));
    attackBonus = abilityMod(pregen?.abilities[ab] ?? 10) + (atkEffect.proficient || atkEffect.spellAttack ? prof : 0);
  }
  const ranged = range > 1;
  if (t.fightingStyle === "archery" && ranged) attackBonus += 2;
  if (t.fightingStyle === "dueling" && !ranged) attackBonus += 2;
  const foeAdjacent = combat.tokens.some(
    (e) => e.kind === "enemy" && !e.dead && chebyshev(e.x, e.y, t.x, t.y) <= 1,
  );
  const easyTarget =
    Boolean(target.marked) ||
    hasCondition(target, "outlined") ||
    hasCondition(target, "restrained") ||
    hasCondition(target, "paralyzed") ||
    hasCondition(target, "unconscious") ||
    (hasCondition(target, "prone") && !ranged) ||
    Boolean(target.reckless);
  const advantage = t.hidden || Boolean(t.helpingTargetId) || t.invisible || t.reckless || easyTarget;
  const disadvantage =
    (ranged && foeAdjacent) ||
    hasCondition(t, "prone") ||
    hasCondition(t, "restrained") ||
    hasCondition(t, "frightened") ||
    hasCondition(t, "blinded") ||
    Boolean(target.invisible) ||
    Boolean(target.blur) ||
    (hasCondition(target, "prone") && ranged);
  const mode: D20Mode = advantage === disadvantage ? "normal" : advantage ? "advantage" : "disadvantage";
  let blessBonus = 0;
  if (t.blessed) blessBonus = rollNotation("1d4").total;

  const attackRoll = rollAttack({
    roller: t.name,
    label: `${ability.name} vs ${target.name}${blessBonus ? " · Bless" : ""}`,
    bonus: attackBonus + blessBonus,
    ac: effectiveAc(target),
    mode,
  });
  const rolls: DiceRoll[] = [attackRoll];
  t.hidden = false;
  t.helpingTargetId = undefined;
  target.marked = false;
  spendEconomy(t, isBonus);

  const crit = attackRoll.outcome === "crit";
  const landed = crit || attackRoll.outcome === "hit";
  const style = atkEffect.spellAttack ? "spell" : ranged ? "ranged" : "melee";
  if (!landed) {
    const fumble = attackRoll.outcome === "fumble";
    emit(combat, {
      kind: "strike",
      tokenId: t.id,
      ability: ability.name,
      style,
      rolls,
      hits: [{ targetId: target.id, outcome: attackRoll.outcome ?? "miss", damage: 0, hp: target.hp }],
      line: fumble
        ? `${t.name} swings ${ability.name} — a natural 1. ${target.name} looks almost embarrassed for them.`
        : `${t.name} attacks ${target.name} with ${ability.name}: ${attackRoll.total} vs AC ${target.ac} — miss.`,
    });
    refreshReachable(combat);
    return { rolls };
  }

  let dmgTotal = 0;
  const dmgValues: number[] = [];
  const dmgSides: number[] = [];
  let dmgMod = 0;
  const dmgNotationParts: string[] = [];
  const dmgParts = (atkEffect.damage as Array<{ dice: string; damageType: string; ability?: string }>) ?? [];
  for (const part of dmgParts) {
    let notation = part.dice;
    if (part.ability && /^\d+d\d+$/i.test(part.dice)) {
      const mod = abilityMod(pregen?.abilities[part.ability] ?? 10);
      notation = `${part.dice}${mod >= 0 ? "+" : ""}${mod}`;
    }
    const r = rollNotation(notation, { crit });
    dmgTotal += r.total;
    dmgValues.push(...r.values);
    dmgSides.push(...r.sides);
    dmgMod += r.modifier;
    dmgNotationParts.push(crit ? critNotation(notation) : notation);
  }
  const rogue = pregen?.traits?.includes("sneak_attack_2d6") || pregen?.class === "rogue";
  const finesse = Boolean(atkEffect.sneakAttackEligible) || ranged;
  if (rogue && finesse && !t.sneakUsed) {
    const allyNear = combat.tokens.some(
      (a) => a.kind === "pc" && !a.dead && a.id !== t.id && chebyshev(a.x, a.y, target.x, target.y) <= 1,
    );
    if ((mode === "advantage" || allyNear) && mode !== "disadvantage") {
      const sneak = rollNotation("2d6", { crit });
      t.sneakUsed = true;
      dmgTotal += sneak.total;
      dmgValues.push(...sneak.values);
      dmgSides.push(...sneak.sides);
      dmgNotationParts.push(`${crit ? "4d6" : "2d6"} sneak`);
    }
  }
  rolls.push(
    makeDiceRoll({
      roller: t.name,
      notation: dmgNotationParts.join(" + "),
      values: dmgValues,
      sides: dmgSides,
      modifier: dmgMod,
      total: dmgTotal,
      purpose: "damage",
      label: `${crit ? "Critical damage" : "Damage"} · ${ability.name}`,
    }),
  );

  const onHit = (atkEffect.onHit as Array<{ condition?: string }> | undefined) ?? [];
  if (onHit.some((h) => h.condition === "attack_advantage_next")) target.marked = true;

  if (atkEffect.onHitSave && dmgTotal < target.hp) {
    const save = atkEffect.onHitSave as {
      ability: string;
      dc: number;
      damage?: Array<{ dice: string; damageType: string }>;
    };
    const saveRoll = rollCheck({
      roller: target.name,
      label: `${save.ability.toUpperCase()} save`,
      bonus: monsterSaveBonus(target, save.ability),
      dc: save.dc,
      purpose: "save",
    });
    rolls.push(saveRoll);
    if (saveRoll.outcome === "fail" && save.damage?.length) {
      const extra = rollNotation(save.damage[0].dice);
      dmgTotal += extra.total;
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
    }
  }

  if (target.brand?.by === t.id) {
    const extra = rollNotation(target.brand.dice, { crit });
    dmgTotal += extra.total;
    dmgNotationParts.push(target.brand.dice);
  }
  if (t.raging && !ranged) dmgTotal += 2;
  const dtype = dmgParts[0]?.damageType ?? "slashing";
  if (
    !ranged &&
    t.playerId &&
    t.features?.includes("divine_smite") &&
    t.slots &&
    Object.values(t.slots).some((n) => n > 0)
  ) {
    combat.pending = {
      kind: "smite",
      playerId: t.playerId,
      tokenId: t.id,
      prompt: `${t.name} can pour a spell slot into the blow.`,
      acceptLabel: "Divine Smite",
      declineLabel: "Leave it",
      damage: dmgTotal,
      crit,
      damageType: dtype,
      rolls,
      abilityName: ability.name,
      style,
      attackerId: t.id,
      targetId: target.id,
      attackTotal: attackRoll.total,
    };
    return { rolls };
  }
  if (
    holdForShield(combat, t, target, {
      damage: dmgTotal,
      crit,
      attackTotal: attackRoll.total,
      damageType: dtype,
      rolls,
      abilityName: ability.name,
      style,
      attackerId: t.id,
      targetId: target.id,
    })
  ) {
    return { rolls };
  }
  const hpAfter = Math.max(0, target.hp - dmgTotal);
  emit(combat, {
    kind: "strike",
    tokenId: t.id,
    ability: ability.name,
    style,
    rolls,
    hits: [{ targetId: target.id, outcome: attackRoll.outcome!, damage: dmgTotal, hp: hpAfter }],
    line: crit
      ? `Natural 20! ${t.name}'s ${ability.name} tears into ${target.name} for ${dmgTotal}.`
      : `${t.name} hits ${target.name} with ${ability.name}: ${attackRoll.total} vs AC ${effectiveAc(target)}, ${dmgTotal} damage.`,
  });
  applyDamage(combat, target, dmgTotal, crit, dtype);
  checkEnd(combat);
  refreshReachable(combat);
  return { rolls };
}

/** A cone is as wide as it is long, so the half-angle from the aim line is atan(0.5) ≈ 26.5°. */
const CONE_HALF_ANGLE = Math.atan(0.5);

/** Cone spells: every foe inside the cone makes the save. The aimed foe is always included. */
function castSaveArea(
  combat: CombatState,
  t: CombatToken,
  aim: CombatToken,
  name: string,
  effect: Record<string, unknown>,
  pregen: Pregen | undefined,
  isBonus: boolean,
): { rolls: DiceRoll[] } {
  const shape = String(effect.shape ?? "cone");
  const length = Number(effect.lengthCells ?? effect.rangeCells ?? 3);
  const radius = Number(effect.radius ?? length);
  if (shape !== "cube" && chebyshev(t.x, t.y, aim.x, aim.y) > length) throw new Error("OUT_OF_RANGE");
  const dirX = aim.x - t.x;
  const dirY = aim.y - t.y;
  const dirLen = Math.hypot(dirX, dirY) || 1;
  const caught = combat.tokens.filter((e) => {
    if (e.kind !== "enemy" || e.dead) return false;
    if (shape === "one") return e.id === aim.id;
    if (shape === "sphere") return chebyshev(aim.x, aim.y, e.x, e.y) <= radius;
    if (shape === "cube") return chebyshev(t.x, t.y, e.x, e.y) <= length && e.id !== t.id;
    if (e.id === aim.id) return true;
    const d = chebyshev(t.x, t.y, e.x, e.y);
    if (d < 1 || d > length) return false;
    const ex = e.x - t.x;
    const ey = e.y - t.y;
    const cos = (ex * dirX + ey * dirY) / ((Math.hypot(ex, ey) || 1) * dirLen);
    return cos >= Math.cos(CONE_HALF_ANGLE);
  });
  const dmgSpec = (effect.damage as Array<{ dice: string; damageType: string }>)[0];
  const rolled = rollNotation(dmgSpec.dice);
  const dc = pcSpellDc(pregen, spellKey(t, pregen, String(effect.dcFrom ?? "int")));
  const saveKey = String(effect.ability ?? "dex");
  const rolls: DiceRoll[] = [
    makeDiceRoll({
      roller: t.name,
      notation: dmgSpec.dice,
      values: rolled.values,
      sides: rolled.sides,
      modifier: rolled.modifier,
      total: rolled.total,
      purpose: "damage",
      label: `${name} · ${dmgSpec.damageType}`,
    }),
  ];
  const hits: StrikeHit[] = [];
  for (const e of caught) {
    const save = rollCheck({
      roller: e.name,
      label: `${saveKey.toUpperCase()} save`,
      bonus: monsterSaveBonus(e, saveKey),
      dc,
      purpose: "save",
    });
    rolls.push(save);
    const saved = save.outcome === "success";
    const dmg = saved ? (effect.halfOnSuccess ? Math.floor(rolled.total / 2) : 0) : rolled.total;
    if (!saved && effect.onFail) addCondition(e, String(effect.onFail));
    hits.push({
      targetId: e.id,
      outcome: saved ? "success" : "fail",
      damage: dmg,
      hp: Math.max(0, e.hp - dmg),
    });
  }
  t.hidden = false;
  spendEconomy(t, isBonus);
  if (effect.concentration) t.concentrating = { spellId: name };
  const blow = hits
    .map((h) => {
      const foe = combat.tokens.find((x) => x.id === h.targetId);
      const who = foe?.name ?? "A creature";
      if (h.damage <= 0) return `${who} saves`;
      return h.outcome === "success" ? `${who} takes ${h.damage} (half)` : `${who} takes ${h.damage}`;
    })
    .join("; ");
  emit(combat, {
    kind: "strike",
    tokenId: t.id,
    ability: name,
    style: "spell",
    rolls,
    hits,
    line: `${t.name} casts ${name}: ${blow}. DC ${dc} ${saveKey.toUpperCase()}.`,
  });
  for (const h of hits) {
    const e = combat.tokens.find((x) => x.id === h.targetId)!;
    if (h.damage > 0) applyDamage(combat, e, h.damage);
  }
  checkEnd(combat);
  refreshReachable(combat);
  return { rolls };
}

function spendEconomy(t: CombatToken, bonus: boolean): void {
  if (bonus) t.hasBonusAction = false;
  else if (t.hasAction) t.hasAction = false;
  else t.extraAction = false;
  if (!bonus) t.attackedThisTurn = true;
}

function effectiveAc(token: CombatToken): number {
  return Math.max(token.ac, token.acFloor ?? 0) + (token.acBonus ?? 0);
}

function applyDamage(combat: CombatState, target: CombatToken, amount: number, crit = false, damageType = "untyped"): void {
  let harm = amount;
  if (target.raging && ["bludgeoning", "piercing", "slashing"].includes(damageType)) harm = Math.floor(harm / 2);
  if (target.kind === "pc" && (target.dying || target.stable || target.hp <= 0)) {
    if (harm > 0) {
      target.stable = false;
      target.dying = true;
      target.deathFailures = (target.deathFailures ?? 0) + (crit ? 2 : 1);
      if (harm >= target.maxHp) target.deathFailures = 3;
      if ((target.deathFailures ?? 0) >= 3) markDead(combat, target);
    }
    return;
  }
  const over = harm - target.hp;
  target.hp = Math.max(0, target.hp - harm);
  if (target.concentrating && harm > 0) concentrationCheck(combat, target, harm);
  if (target.hp === 0 && !target.dead) {
    if (target.kind === "pc" && over < target.maxHp) {
      target.dying = true;
      target.stable = false;
      target.deathSuccesses = 0;
      target.deathFailures = 0;
      emit(combat, { kind: "down", tokenId: target.id, line: `${target.name} collapses!` });
    } else {
      markDead(combat, target);
    }
  }
}

function markDead(combat: CombatState, target: CombatToken): void {
  target.dead = true;
  target.dying = false;
  target.hp = 0;
  emit(combat, {
    kind: "down",
    tokenId: target.id,
    line: target.kind === "enemy" ? `${target.name} goes still.` : `${target.name} is gone.`,
  });
}

function concentrationCheck(combat: CombatState, token: CombatToken, damage: number): void {
  const focus = token.concentrating;
  if (!focus) return;
  const pregen = token.characterId ? getPregen(token.characterId) : undefined;
  const proficient = (pregen as { savingThrows?: string[] } | undefined)?.savingThrows?.includes("con");
  const bonus = abilityMod(pregen?.abilities.con ?? 10) + (proficient ? pregen?.proficiencyBonus ?? 2 : 0);
  const dc = Math.max(10, Math.floor(damage / 2));
  const roll = rollCheck({
    roller: token.name,
    label: "Concentration",
    bonus,
    dc,
    purpose: "save",
  });
  if (roll.outcome === "success") {
    statusEvent(combat, token, "Concentration", `${token.name} holds the spell (${roll.total} vs DC ${dc}).`, [roll]);
    return;
  }
  breakConcentration(combat, token);
  statusEvent(combat, token, "Concentration", `${token.name} loses the spell (${roll.total} vs DC ${dc}).`, [roll]);
}

function breakConcentration(combat: CombatState, token: CombatToken): void {
  const focus = token.concentrating;
  token.concentrating = undefined;
  if (!focus) return;
  if (focus.spellId === "spell_bless") {
    for (const ally of combat.tokens) ally.blessed = false;
  }
  if (focus.targetId) {
    const marked = combat.tokens.find((x) => x.id === focus.targetId);
    if (marked?.brand?.by === token.id) marked.brand = undefined;
    if (marked && (focus.spellId === "spell_shield_of_faith" || focus.spellId === "spell_blur" || focus.spellId === "spell_invisibility" || focus.spellId === "spell_barkskin")) {
      marked.blur = false;
      marked.invisible = false;
      marked.acFloor = undefined;
      marked.acBonus = 0;
    }
  }
  token.blur = false;
  token.invisible = false;
}

function shieldReady(target: CombatToken): boolean {
  return Boolean(
    target.kind === "pc" &&
      target.playerId &&
      target.reactionReady &&
      target.reactionIds?.includes("spell_shield") &&
      (target.slots?.["1"] ?? 0) > 0 &&
      !target.dead &&
      !target.dying,
  );
}

function holdForShield(
  combat: CombatState,
  attacker: CombatToken,
  target: CombatToken,
  blow: Omit<PendingReaction, "kind" | "playerId" | "tokenId" | "prompt" | "acceptLabel" | "declineLabel">,
): boolean {
  if (!shieldReady(target) || !target.playerId) return false;
  combat.pending = {
    kind: "shield",
    playerId: target.playerId,
    tokenId: target.id,
    prompt: `${target.name} can cast Shield against ${attacker.name}.`,
    acceptLabel: "Cast Shield",
    declineLabel: "Take the hit",
    ...blow,
  };
  return true;
}

function resolveDeathSave(combat: CombatState, token: CombatToken): void {
  const face = rollD20();
  const roll = makeDiceRoll({
    roller: token.name,
    notation: "1d20",
    values: [face],
    sides: [20],
    modifier: 0,
    total: face,
    purpose: "save",
    label: "Death save",
  });
  if (face === 20) {
    token.hp = 1;
    token.dying = false;
    token.stable = false;
    token.deathSuccesses = 0;
    token.deathFailures = 0;
    statusEvent(combat, token, "Death save", `Natural 20. ${token.name} springs back with 1 hit point.`, [roll]);
    return;
  }
  if (face === 1) token.deathFailures = (token.deathFailures ?? 0) + 2;
  else if (face >= 10) token.deathSuccesses = (token.deathSuccesses ?? 0) + 1;
  else token.deathFailures = (token.deathFailures ?? 0) + 1;
  if ((token.deathFailures ?? 0) >= 3) {
    statusEvent(combat, token, "Death save", `${token.name} fails the last death save.`, [roll]);
    markDead(combat, token);
    checkEnd(combat);
    return;
  }
  if ((token.deathSuccesses ?? 0) >= 3) {
    token.stable = true;
    token.dying = false;
    statusEvent(combat, token, "Death save", `${token.name} stabilizes, still unconscious.`, [roll]);
    return;
  }
  statusEvent(
    combat,
    token,
    "Death save",
    `${token.name} death save ${face}. ${token.deathSuccesses ?? 0} successes, ${token.deathFailures ?? 0} failures.`,
    [roll],
  );
}

function meleeOf(token: CombatToken): string | undefined {
  return token.actionIds.find((id) => id.endsWith("_attack") || id === "unarmed_strike") ?? token.actionIds.find((id) => {
    const ability = getAbility(id);
    const effect = ability?.effects[0];
    return effect?.type === "attack" && Number(effect.rangeCells ?? 1) <= 1;
  });
}

function reactorLeaving(combat: CombatState, mover: CombatToken, from: Cell, to: Cell): CombatToken | undefined {
  if (mover.disengaging) return undefined;
  return combat.tokens.find((other) => {
    if (other.dead || other.dying || other.id === mover.id || other.kind === mover.kind) return false;
    if (!other.reactionReady && other.kind === "pc") return false;
    const was = chebyshev(other.x, other.y, from.x, from.y) <= 1;
    const still = chebyshev(other.x, other.y, to.x, to.y) <= 1;
    if (!was || still) return false;
    if (other.kind === "pc") return Boolean(meleeOf(other));
    return enemyAttacks(other).some((attack) => attack.range <= 1);
  });
}

function finishMove(combat: CombatState, mover: CombatToken, path: Cell[], cost: number): void {
  const end = path[path.length - 1];
  if (!end) return;
  mover.x = end.x;
  mover.y = end.y;
  mover.movementLeft = Math.max(0, mover.movementLeft - cost);
  emit(combat, {
    kind: "move",
    tokenId: mover.id,
    path,
    line: `${mover.name} moves ${cost * 5} ft.`,
  });
}

function commitMove(combat: CombatState, mover: CombatToken, path: Cell[], cost: number): void {
  let threatAt = -1;
  let reactor: CombatToken | undefined;
  for (let i = 1; i < path.length; i += 1) {
    reactor = reactorLeaving(combat, mover, path[i - 1]!, path[i]!);
    if (reactor) {
      threatAt = i;
      break;
    }
  }
  if (!reactor || threatAt < 0) {
    finishMove(combat, mover, path, cost);
    return;
  }
  const prefix = path.slice(0, threatAt);
  if (prefix.length > 1) finishMove(combat, mover, prefix, prefix.length - 1);
  const rest = path.slice(threatAt - 1);
  if (reactor.kind === "pc" && reactor.playerId && reactor.reactionReady) {
    combat.pending = {
      kind: "opportunity",
      playerId: reactor.playerId,
      tokenId: reactor.id,
      prompt: `${mover.name} leaves ${reactor.name}'s reach.`,
      acceptLabel: "Opportunity attack",
      declineLabel: "Let them pass",
      abilityId: meleeOf(reactor),
      targetId: mover.id,
      damage: 0,
      rolls: [],
      abilityName: "Opportunity Attack",
      style: "melee",
      attackerId: reactor.id,
      moverId: mover.id,
      path: rest,
      cost: rest.length - 1,
      dest: rest[rest.length - 1],
    };
    return;
  }
  const attack = enemyAttacks(reactor).find((item) => item.range <= 1);
    if (attack && reactor.kind === "enemy") {
    reactor.reactionReady = false;
    enemyStrike(combat, reactor, mover, attack);
    if (combat.pending) {
      combat.pending.resumePath = rest;
      combat.pending.resumeMoverId = mover.id;
      return;
    }
  }
  if (mover.dead || mover.dying) return;
  commitMove(combat, mover, rest, rest.length - 1);
}

function resolveSpellAttack(
  combat: CombatState,
  attacker: CombatToken,
  pregen: Pregen | undefined,
  name: string,
  effect: Record<string, unknown>,
  targetId: string,
  alreadySpent: boolean,
  free: boolean,
): { rolls: DiceRoll[] } {
  const target = combat.tokens.find((x) => x.id === targetId && !x.dead);
  if (!target) throw new Error("BAD_TARGET");
  const range = Number(effect.rangeCells ?? 1);
  if (chebyshev(attacker.x, attacker.y, target.x, target.y) > range) throw new Error("OUT_OF_RANGE");
  const key = spellKey(attacker, pregen, String(effect.ability ?? "str"));
  const prof = pregen?.proficiencyBonus ?? 2;
  const bonus = abilityMod(pregen?.abilities[key] ?? 10) + (effect.spellAttack || effect.proficient ? prof : 0);
  const roll = rollAttack({
    roller: attacker.name,
    label: `${name} vs ${target.name}`,
    bonus,
    ac: effectiveAc(target),
    mode: "normal",
  });
  const rolls: DiceRoll[] = [roll];
  const landed = roll.outcome === "hit" || roll.outcome === "crit";
  let damage = 0;
  if (landed) {
    const part = ((effect.damage as Array<{ dice: string; damageType: string }> | undefined) ?? [])[0];
    if (part) {
      const rolled = rollNotation(part.dice, { crit: roll.outcome === "crit" });
      damage = rolled.total;
      rolls.push(
        makeDiceRoll({
          roller: attacker.name,
          notation: part.dice,
          values: rolled.values,
          sides: rolled.sides,
          modifier: rolled.modifier,
          total: rolled.total,
          purpose: "damage",
          label: part.damageType,
        }),
      );
    }
  }
  if (!alreadySpent && !free) spendEconomy(attacker, false);
  if (landed && holdForShield(combat, attacker, target, {
    damage,
    crit: roll.outcome === "crit",
    attackTotal: roll.total,
    damageType: "force",
    rolls,
    abilityName: name,
    style: "spell",
    attackerId: attacker.id,
    targetId: target.id,
  })) {
    return { rolls };
  }
  emit(combat, {
    kind: "strike",
    tokenId: attacker.id,
    ability: name,
    style: "spell",
    rolls,
    hits: [{ targetId: target.id, outcome: roll.outcome ?? "miss", damage, hp: Math.max(0, target.hp - damage) }],
    line: landed
      ? `${attacker.name} hits ${target.name} with ${name} for ${damage}.`
      : `${attacker.name} misses ${target.name} with ${name}.`,
  });
  if (damage > 0) applyDamage(combat, target, damage, roll.outcome === "crit");
  checkEnd(combat);
  return { rolls };
}

export function endTurn(combat: CombatState, playerId: string): void {
  if (combat.status !== "active") throw new Error("COMBAT_OVER");
  if (combat.pending) throw new Error("REACTION_PENDING");
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId) throw new Error("NOT_YOUR_TURN");
  advanceTurn(combat);
}

function abilityModLabel(score: number): string {
  const m = abilityMod(score);
  return m >= 0 ? `+${m}` : `${m}`;
}

type MenuAction = {
  id: string;
  name: string;
  actionType: string;
  economy: string;
  needsTarget: boolean;
  targetKind: "enemy" | "ally" | "none" | "cell";
  range: number;
  guided: boolean;
  available: boolean;
};

function buildPcSheet(
  token: CombatToken,
  actionMenu: { actions: MenuAction[]; bonusActions: MenuAction[] } | null,
) {
  const pregen = token.characterId ? getPregen(token.characterId) : undefined;
  const abs = pregen?.abilities ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  return {
    characterId: token.characterId,
    portrait: portraitForCharacter(token.characterId),
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
    spellSlots: token.slots ?? null,
    conditions: token.conditions ?? [],
    concentrating: token.concentrating?.spellId ?? null,
    resources: {
      ki: token.ki ?? null,
      layOnHands: token.layOnHands ?? null,
      sorceryPoints: token.sorceryPoints ?? null,
      ragesLeft: token.ragesLeft ?? null,
      bardicLeft: token.bardicLeft ?? null,
      channelDivinity: token.channelDivinity ?? null,
      hitDice: token.hitDice ?? null,
    },
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

function describeAction(id: string, economy: "action" | "bonus_action", owner: CombatToken, guidedId?: string): MenuAction {
  const quicken = id.startsWith("quicken:");
  const realId = quicken ? id.slice("quicken:".length) : id;
  const a = getAbility(realId);
  const effect = a?.effects?.[0];
  const type = String(effect?.type ?? "");
  let targetKind: MenuAction["targetKind"] = "none";
  if (["attack", "auto_hit", "save", "rays", "brand", "sleep"].includes(type)) targetKind = "enemy";
  if (type === "help" || type === "inspire" || type === "restore" || (type === "heal" && !effect?.self) || type === "pool_heal") targetKind = "ally";
  if ((a as { aim?: string }).aim === "cell" || type === "teleport") targetKind = "cell";
  const range = Number(effect?.rangeCells ?? effect?.lengthCells ?? (targetKind === "none" ? 0 : 1));
  let available = economy === "bonus_action" ? owner.hasBonusAction : owner.hasAction;
  if (id === "second_wind" && owner.secondWindUsed) available = false;
  if (effect?.consume && !owner.inventory.includes(String(effect.consume))) available = false;
  return {
    id,
    name: quicken ? `Quicken: ${a?.name ?? realId}` : (a?.name ?? id),
    actionType: economy,
    economy,
    needsTarget: targetKind === "enemy" || type === "help",
    targetKind,
    range,
    guided: id === guidedId,
    available,
  };
}

export function publicCombat(combat: CombatState, viewerPlayerId?: string) {
  const current = currentToken(combat);
  const menuFor = (tok: CombatToken, live: boolean) => {
    const guidedId = tok.characterId ? getPregen(tok.characterId)?.guidedDefaultAction : undefined;
    const lock = (a: MenuAction) => (live ? a : { ...a, available: false });
    return {
      movement: {
        left: tok.movementLeft,
        speed: tok.speedCells,
        hint: live ? "Move on your turn (walk / optional Dash)." : "Not your turn",
      },
      actions: tok.actionIds.map((id) => lock(describeAction(id, "action", tok, guidedId))),
      bonusActions: tok.bonusActionIds
        .filter((id) => !(id === "second_wind" && tok.secondWindUsed))
        .map((id) => lock(describeAction(id, "bonus_action", tok, guidedId))),
      flags: {
        dodging: tok.dodging,
        disengaging: tok.disengaging,
        hidden: tok.hidden,
        hasAction: tok.hasAction,
        hasBonusAction: tok.hasBonusAction,
      },
    };
  };

  const liveMenu =
    current?.kind === "pc" && !current.dead && combat.status === "active" ? menuFor(current, true) : null;

  const sheetTok = viewerPlayerId
    ? combat.tokens.find((t) => t.playerId === viewerPlayerId && t.kind === "pc")
    : current?.kind === "pc"
      ? current
      : combat.tokens.find((t) => t.kind === "pc" && !t.dead);
  const sheetMenu = sheetTok ? (sheetTok.id === current?.id && liveMenu ? liveMenu : menuFor(sheetTok, false)) : null;

  return {
    encounterId: combat.encounterId,
    mapId: combat.mapId,
    width: combat.width,
    height: combat.height,
    walls: combat.walls,
    round: combat.round,
    seq: combat.seq,
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
      initiative: t.initiative,
      playerId: t.playerId,
      characterId: t.characterId,
      monsterId: t.monsterId,
      portrait: t.kind === "pc" ? portraitForCharacter(t.characterId) : portraitForMonster(t.monsterId),
      boss: t.kind === "enemy" && t.maxHp >= 30,
      actionIds: t.actionIds,
      movementLeft: t.movementLeft,
      hasAction: t.hasAction,
      hasBonusAction: t.hasBonusAction,
      dodging: t.dodging,
      disengaging: t.disengaging,
      hidden: t.hidden,
      blessed: Boolean(t.blessed),
      marked: Boolean(t.marked),
    })),
    turnOrder: combat.turnOrder,
    currentTokenId: current?.id,
    currentName: current?.name,
    reachable: combat.reachable,
    log: combat.log.slice(-12),
    events: combat.events,
    status: combat.status,
    pendingReaction: combat.pending
      ? {
          playerId: combat.pending.playerId,
          kind: combat.pending.kind,
          prompt: combat.pending.prompt,
          acceptLabel: combat.pending.acceptLabel,
          declineLabel: combat.pending.declineLabel,
        }
      : null,
    aimRequest: combat.aimRequest ?? null,
    actions: [...(liveMenu?.actions ?? []), ...(liveMenu?.bonusActions ?? [])],
    actionMenu: liveMenu,
    sheet: sheetTok ? buildPcSheet(sheetTok, sheetMenu) : null,
  };
}

export type PublicCombat = ReturnType<typeof publicCombat>;

/** A hero whose table dropped for good Dodges and passes the rest of the turn. */
export function applyDisconnectDodge(combat: CombatState, playerId: string): void {
  if (combat.status !== "active") return;
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId || t.dead) return;
  t.hasAction = false;
  t.movementLeft = 0;
  t.dodging = true;
  statusEvent(combat, t, "Dodge", `${t.name} loses the thread — Dodges and passes the turn.`);
  advanceTurn(combat);
}

function deliverBlow(combat: CombatState, pending: PendingReaction, damage: number): void {
  const target = combat.tokens.find((token) => token.id === pending.targetId);
  emit(combat, {
    kind: "strike",
    tokenId: pending.attackerId,
    ability: pending.abilityName,
    style: pending.style,
    rolls: pending.rolls,
    hits: [
      {
        targetId: pending.targetId ?? pending.attackerId,
        outcome: damage > 0 ? "hit" : "miss",
        damage,
        hp: Math.max(0, (target?.hp ?? 0) - damage),
      },
    ],
    line:
      damage > 0
        ? `${pending.abilityName} hits for ${damage}.`
        : `${pending.abilityName} is turned aside.`,
  });
  if (target && damage > 0) applyDamage(combat, target, damage, pending.crit, pending.damageType);
  checkEnd(combat);
  if (pending.resumePath && pending.resumeMoverId && !combat.pending) {
    const mover = combat.tokens.find((token) => token.id === pending.resumeMoverId);
    if (mover && !mover.dead && !mover.dying) commitMove(combat, mover, pending.resumePath, pending.resumePath.length - 1);
  }
}

export function requestAim(combat: CombatState, playerId: string, abilityId: string): void {
  if (combat.status !== "active") throw new Error("COMBAT_OVER");
  const token = combat.tokens.find((item) => item.playerId === playerId && item.kind === "pc");
  if (!token) throw new Error("NO_PLAYER");
  if (token.sheetDriven && token.characterId) refreshMenus(token, getPregen(token.characterId), getAbility);
  if (!token.actionIds.includes(abilityId) && !token.bonusActionIds.includes(abilityId)) throw new Error("BAD_ABILITY");
  combat.aimRequest = { playerId, abilityId };
}

export function resolveReaction(combat: CombatState, playerId: string, accept: boolean): void {
  const pending = combat.pending;
  if (!pending || pending.playerId !== playerId) throw new Error("NO_REACTION");
  combat.pending = undefined;
  if (pending.kind === "shield") {
    const target = combat.tokens.find((token) => token.id === pending.tokenId);
    let damage = pending.damage;
    if (accept && target) {
      spendSlot(target, 1);
      target.reactionReady = false;
      target.acBonus = (target.acBonus ?? 0) + 5;
      if (pending.negateAuto || (pending.attackTotal ?? 0) < effectiveAc(target)) damage = 0;
      statusEvent(combat, target, "Shield", `${target.name} snaps a shield of force into place.`);
    }
    deliverBlow(combat, pending, damage);
    return;
  }
  if (pending.kind === "smite") {
    let damage = pending.damage;
    const attacker = combat.tokens.find((token) => token.id === pending.attackerId);
    if (accept && attacker) {
      const slot = spendSlot(attacker, 1);
      const rolled = rollNotation(`${slot + 1}d8`, { crit: pending.crit });
      damage += rolled.total;
      statusEvent(combat, attacker, "Divine Smite", `${attacker.name} smites for ${rolled.total} more radiant.`);
    }
    const target = combat.tokens.find((token) => token.id === pending.targetId);
    if (target && attacker && holdForShield(combat, attacker, target, { ...pending, damage })) return;
    deliverBlow(combat, pending, damage);
    return;
  }
  const reactor = combat.tokens.find((token) => token.id === pending.tokenId);
  const mover = combat.tokens.find((token) => token.id === pending.moverId);
  if (accept && reactor && mover && pending.abilityId) {
    reactor.reactionReady = false;
    const ability = getAbility(pending.abilityId);
    const effect = ability?.effects[0];
    const pregen = reactor.characterId ? getPregen(reactor.characterId) : undefined;
    if (effect) resolveSpellAttack(combat, reactor, pregen, ability?.name ?? "Opportunity Attack", effect, mover.id, true, true);
  }
  if (!combat.pending && mover && pending.path && !mover.dead && !mover.dying) {
    commitMove(combat, mover, pending.path, pending.cost ?? Math.max(0, pending.path.length - 1));
  }
  refreshReachable(combat);
}

export { exportVitals, longRestResources, shortRestResources, type Vitals };
