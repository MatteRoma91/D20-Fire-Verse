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
  "std_ready",
  "std_search",
] as const;

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

function beginTurn(combat: CombatState): void {
  let guard = 0;
  while (guard < combat.turnOrder.length + 1) {
    const t = currentToken(combat);
    if (t && !t.dead) break;
    stepIndex(combat);
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
  t.sneakUsed = false;
  if (t.webCooldown) t.webCooldown -= 1;
  emit(combat, { kind: "turn", tokenId: t.id, round: combat.round, line: `Round ${combat.round} — ${t.name}.` });
  refreshReachable(combat);
}

/** Resolve every enemy turn in initiative order until a living hero is up or the fight ends. */
function settleEnemies(combat: CombatState): void {
  let guard = 0;
  while (combat.status === "active" && guard < combat.turnOrder.length * 2 + 4) {
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
    ac: target.ac,
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
  const hpAfter = Math.max(0, target.hp - damage);
  emit(combat, {
    kind: "strike",
    tokenId: enemy.id,
    ability: attack.name,
    style: attack.range > 1 ? "ranged" : "melee",
    rolls,
    hits: [{ targetId: target.id, outcome: roll.outcome ?? "miss", damage, hp: hpAfter }],
    line: `${enemy.name} ${verb} ${target.name}: ${roll.total} vs AC ${target.ac}${mode === "disadvantage" ? " (dodging)" : ""}. ${tail}`,
  });
  if (damage > 0) applyDamage(combat, target, damage);
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
  const t = currentToken(combat);
  if (!t || t.kind !== "pc" || t.playerId !== playerId) throw new Error("NOT_YOUR_TURN");
  const route = pathTo(combat, t, x, y);
  if (!route || route.cost > t.movementLeft) throw new Error("UNREACHABLE");
  t.x = x;
  t.y = y;
  t.movementLeft -= route.cost;
  emit(combat, {
    kind: "move",
    tokenId: t.id,
    path: route.path,
    line: `${t.name} moves ${route.cost * 5} ft.`,
  });
  refreshReachable(combat);
}

export function performAttack(
  combat: CombatState,
  playerId: string,
  abilityId: string,
  targetId?: string,
): { rolls: DiceRoll[] } {
  return performPcAction(combat, playerId, abilityId, targetId);
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

export function performPcAction(
  combat: CombatState,
  playerId: string,
  abilityId: string,
  targetId?: string,
): { rolls: DiceRoll[] } {
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
  const pregen = t.characterId ? getPregen(t.characterId) : undefined;
  const prof = pregen?.proficiencyBonus ?? 2;

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
    const before = patient.hp;
    patient.hp = Math.min(patient.maxHp, patient.hp + rolled.total);
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
    emit(combat, {
      kind: "strike",
      tokenId: t.id,
      ability: ability.name,
      style: "spell",
      rolls: [dice],
      hits: [{ targetId: target.id, outcome: "hit", damage: totalDmg, hp: Math.max(0, target.hp - totalDmg) }],
      line: `${t.name} casts ${ability.name}: ${missiles} darts strike ${target.name} for ${totalDmg}.`,
    });
    applyDamage(combat, target, totalDmg);
    checkEnd(combat);
    refreshReachable(combat);
    return { rolls: [dice] };
  }

  let attackBonus = Number(atkEffect.attackBonus ?? 0);
  if (atkEffect.ability) {
    const ab = String(atkEffect.ability);
    attackBonus = abilityMod(pregen?.abilities[ab] ?? 10) + (atkEffect.proficient || atkEffect.spellAttack ? prof : 0);
  }
  const ranged = range > 1;
  const foeAdjacent = combat.tokens.some(
    (e) => e.kind === "enemy" && !e.dead && chebyshev(e.x, e.y, t.x, t.y) <= 1,
  );
  const advantage = t.hidden || Boolean(t.helpingTargetId) || Boolean(target.marked);
  const disadvantage = ranged && foeAdjacent;
  const mode: D20Mode = advantage === disadvantage ? "normal" : advantage ? "advantage" : "disadvantage";
  let blessBonus = 0;
  if (t.blessed) blessBonus = rollNotation("1d4").total;

  const attackRoll = rollAttack({
    roller: t.name,
    label: `${ability.name} vs ${target.name}${blessBonus ? " · Bless" : ""}`,
    bonus: attackBonus + blessBonus,
    ac: target.ac,
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
      : `${t.name} hits ${target.name} with ${ability.name}: ${attackRoll.total} vs AC ${target.ac}, ${dmgTotal} damage.`,
  });
  applyDamage(combat, target, dmgTotal);
  checkEnd(combat);
  refreshReachable(combat);
  return { rolls };
}

/** Cone spells: every foe within reach and roughly in the aimed direction saves. */
function castSaveArea(
  combat: CombatState,
  t: CombatToken,
  aim: CombatToken,
  name: string,
  effect: Record<string, unknown>,
  pregen: Pregen | undefined,
  isBonus: boolean,
): { rolls: DiceRoll[] } {
  const length = Number(effect.lengthCells ?? 3);
  if (chebyshev(t.x, t.y, aim.x, aim.y) > length) throw new Error("OUT_OF_RANGE");
  const dirX = aim.x - t.x;
  const dirY = aim.y - t.y;
  const dirLen = Math.hypot(dirX, dirY) || 1;
  const caught = combat.tokens.filter((e) => {
    if (e.kind !== "enemy" || e.dead) return false;
    if (e.id === aim.id) return true;
    const d = chebyshev(t.x, t.y, e.x, e.y);
    if (d < 1 || d > length) return false;
    const ex = e.x - t.x;
    const ey = e.y - t.y;
    const cos = (ex * dirX + ey * dirY) / ((Math.hypot(ex, ey) || 1) * dirLen);
    return cos >= Math.cos((53 * Math.PI) / 180);
  });
  const dmgSpec = (effect.damage as Array<{ dice: string; damageType: string }>)[0];
  const rolled = rollNotation(dmgSpec.dice);
  const dc = pcSpellDc(pregen, String(effect.dcFrom ?? "int"));
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
    const dmg = save.outcome === "success" ? (effect.halfOnSuccess ? Math.floor(rolled.total / 2) : 0) : rolled.total;
    hits.push({ targetId: e.id, outcome: save.outcome === "success" ? "miss" : "hit", damage: dmg, hp: Math.max(0, e.hp - dmg) });
  }
  t.hidden = false;
  spendEconomy(t, isBonus);
  emit(combat, {
    kind: "strike",
    tokenId: t.id,
    ability: name,
    style: "spell",
    rolls,
    hits,
    line: `${t.name} casts ${name}: ${hits.length} caught in the flames, DC ${dc}.`,
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
  else t.hasAction = false;
}

function applyDamage(combat: CombatState, target: CombatToken, amount: number): void {
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp === 0 && !target.dead) {
    target.dead = true;
    emit(combat, {
      kind: "down",
      tokenId: target.id,
      line: target.kind === "enemy" ? `${target.name} goes still.` : `${target.name} collapses!`,
    });
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

type MenuAction = {
  id: string;
  name: string;
  actionType: string;
  economy: string;
  needsTarget: boolean;
  targetKind: "enemy" | "ally" | "none";
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
  const a = getAbility(id);
  const effect = a?.effects?.[0];
  const type = String(effect?.type ?? "");
  let targetKind: MenuAction["targetKind"] = "none";
  if (["attack", "auto_hit", "save"].includes(type)) targetKind = "enemy";
  if (type === "help" || (type === "heal" && !effect?.self)) targetKind = "ally";
  const range = Number(effect?.rangeCells ?? effect?.lengthCells ?? (targetKind === "none" ? 0 : 1));
  let available = economy === "bonus_action" ? owner.hasBonusAction : owner.hasAction;
  if (id === "second_wind" && owner.secondWindUsed) available = false;
  if (effect?.consume && !owner.inventory.includes(String(effect.consume))) available = false;
  return {
    id,
    name: a?.name ?? id,
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
