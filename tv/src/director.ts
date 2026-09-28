/**
 * Stages the server's combat timeline: every turn, step, blow and fall is played in
 * order with its own beat, so the table watches the rats come instead of seeing
 * them teleport. Input waits while the director has the floor.
 */

import type { Board } from "./board";
import { isD20, rollD20 } from "./dice3d";
import { reducedMotion } from "./settings";
import { panForColumn, sfx, type Sfx } from "./sfx";
import type { CombatEvent, CombatPublic, DiceRoll, Token } from "./types";

export type DirectorHooks = {
  onBusy: (busy: boolean) => void;
  onLine: (line: string, kind: CombatEvent["kind"]) => void;
  onTurn: (token: Token, mine: boolean, round: number) => Promise<void> | void;
  onStart: (order: Token[]) => Promise<void> | void;
  onEnd: (outcome: "victory" | "defeat") => Promise<void> | void;
  onSettled: () => void;
};

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, reducedMotion() ? Math.min(ms, 120) : ms));

function strikeSound(name: string, style: string): Sfx {
  const ability = name.toLowerCase();
  if (style === "ranged") return "bow";
  if (style === "spell") {
    if (/missile/.test(ability)) return "missile";
    if (/fire|burn|flame|ember/.test(ability)) return "fire";
    if (/web/.test(ability)) return "web";
    return "spell";
  }
  if (/bite|claw|sting|fang|web/.test(ability)) return "claw";
  if (/mace|club|staff|hammer|fist|unarmed|shield/.test(ability)) return "blunt";
  return "sword";
}

function isSkittering(t: Token | undefined) {
  return !!t && t.kind !== "pc" && /rat|centipede|spider/i.test(t.name);
}

export class Director {
  private board: Board;
  private hooks: DirectorHooks;
  private queue: CombatEvent[] = [];
  private lastQueued = 0;
  private running = false;
  private latest: CombatPublic | null = null;
  private tokens = new Map<string, Token>();
  private playerId: string | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(board: Board, hooks: DirectorHooks) {
    this.board = board;
    this.hooks = hooks;
  }

  /** A reload or rejoin mid-fight: show the board as it is, without replaying history. */
  skipTo(combat: CombatPublic) {
    this.queue = [];
    this.lastQueued = combat.seq;
    this.latest = combat;
    this.indexTokens(combat);
  }

  get busy() {
    return this.running;
  }

  idle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private indexTokens(c: CombatPublic) {
    for (const t of c.tokens) this.tokens.set(t.id, t);
  }

  feed(combat: CombatPublic, playerId: string | null) {
    this.latest = combat;
    this.playerId = playerId;
    this.indexTokens(combat);
    const fresh = combat.events.filter((e) => e.seq > this.lastQueued);
    if (fresh.length) {
      this.queue.push(...fresh);
      this.lastQueued = fresh[fresh.length - 1]!.seq;
    }
    if (!this.running) void this.run();
  }

  private async run() {
    this.running = true;
    this.hooks.onBusy(true);
    try {
      while (this.queue.length) {
        const e = this.queue.shift()!;
        try {
          await this.playEvent(e);
        } catch (err) {
          console.warn("director", err);
        }
      }
      await this.board.focus(null, 1, 420);
      if (this.latest) this.board.sync(this.latest.tokens, { snap: true });
    } finally {
      this.running = false;
      this.hooks.onBusy(false);
      this.hooks.onSettled();
      for (const w of this.idleWaiters.splice(0)) w();
    }
  }

  private mine(id: string) {
    const t = this.tokens.get(id);
    return !!t && t.kind === "pc" && !!this.playerId && t.playerId === this.playerId;
  }

  private pan(id: string) {
    const cell = this.board.pawnCell(id);
    return cell ? panForColumn(cell.x, this.board.size().cols) : 0;
  }

  private async playEvent(e: CombatEvent) {
    switch (e.kind) {
      case "start": {
        this.hooks.onLine(e.line, e.kind);
        const order = e.order.map((id) => this.tokens.get(id)).filter((t): t is Token => !!t);
        await this.hooks.onStart(order);
        return;
      }
      case "turn": {
        const t = this.tokens.get(e.tokenId);
        if (!t) return;
        const mine = this.mine(t.id);
        this.hooks.onLine(e.line, e.kind);
        if (t.kind !== "pc") {
          const cell = this.board.pawnCell(t.id);
          void this.board.focus(cell ? [cell] : null, 1.28, 480);
        } else {
          void this.board.focus(null, 1, 360);
        }
        await this.hooks.onTurn(t, mine, e.round);
        return;
      }
      case "move": {
        const t = this.tokens.get(e.tokenId);
        const mine = this.mine(e.tokenId);
        this.hooks.onLine(e.line, e.kind);
        if (!mine && e.path.length > 1) {
          void this.board.focus([e.path[0]!, e.path[e.path.length - 1]!], 1.22, 380);
        }
        const skitter = isSkittering(t);
        await this.board.walk(e.tokenId, e.path, mine ? 150 : skitter ? 150 : 210, (cell) => {
          sfx(skitter ? "skitter" : "step", { gain: 0.8, pan: panForColumn(cell.x, this.board.size().cols) });
        });
        await wait(mine ? 60 : 160);
        return;
      }
      case "strike":
        await this.playStrike(e);
        return;
      case "heal": {
        this.hooks.onLine(e.line, e.kind);
        const check = e.rolls.find(isD20);
        if (check) await rollD20(check, { extra: e.rolls.filter((r) => r !== check), fast: true });
        sfx("heal", { pan: this.pan(e.targetId) });
        this.board.sparkle(e.targetId);
        this.board.float(e.targetId, `+${e.amount}`, "heal");
        this.board.setHp(e.targetId, e.hp);
        await wait(700);
        return;
      }
      case "status": {
        this.hooks.onLine(e.line, e.kind);
        const check = e.rolls.find(isD20);
        if (check) await rollD20(check, { fast: this.mine(e.tokenId) });
        const label = e.ability.replace(/^std_|^cunning_/, "").replace(/_/g, " ");
        if (label && !/wait|hiss/.test(e.line.toLowerCase())) this.board.float(e.tokenId, label.replace(/\b\w/g, (c) => c.toUpperCase()), "info");
        if (/bless|guid|spell|shield/i.test(e.ability)) {
          sfx("spell", { pan: this.pan(e.tokenId), gain: 0.7 });
          this.board.sparkle(e.tokenId, 0xffe08a);
        } else sfx("uiConfirm", { gain: 0.5 });
        await wait(this.mine(e.tokenId) ? 350 : 750);
        return;
      }
      case "down": {
        this.hooks.onLine(e.line, e.kind);
        const t = this.tokens.get(e.tokenId);
        sfx(t?.kind === "pc" ? "heroDown" : t?.boss ? "deathBig" : "deathSmall", { pan: this.pan(e.tokenId) });
        await this.board.fall(e.tokenId);
        await wait(250);
        return;
      }
      case "end":
        this.hooks.onLine(e.line, e.kind);
        await this.board.focus(null, 1, 400);
        await this.hooks.onEnd(e.outcome);
        return;
      default: {
        const exhaustive: never = e;
        void exhaustive;
      }
    }
  }

  private async playStrike(e: Extract<CombatEvent, { kind: "strike" }>) {
    const mine = this.mine(e.tokenId);
    this.hooks.onLine(e.line, e.kind);
    const targets = e.hits.map((h) => this.board.pawnCell(h.targetId)).filter((c): c is NonNullable<typeof c> => !!c);
    const self = this.board.pawnCell(e.tokenId);
    if (self) void this.board.focus([self, ...targets], mine ? 1.12 : 1.3, 380);

    const attackRoll = e.rolls.find((r) => isD20(r) && (r.purpose === "attack" || r.vs?.kind === "AC"));
    const saves = e.rolls.filter((r) => isD20(r) && r !== attackRoll);
    const damage = e.rolls.filter((r) => !isD20(r));
    if (attackRoll) {
      sfx("swing", { gain: 0.5, pan: this.pan(e.tokenId) });
      await rollD20(attackRoll, { extra: damage, fast: mine });
    } else if (saves.length) {
      sfx(strikeSound(e.ability, e.style), { pan: this.pan(e.tokenId) });
      for (const [i, s] of saves.entries()) {
        await rollD20(s, { extra: i === 0 ? damage : [], fast: true });
      }
    }

    const sound = strikeSound(e.ability, e.style);
    const impact = () => {
      for (const h of e.hits) {
        const pan = this.pan(h.targetId);
        switch (h.outcome) {
          case "crit":
            sfx(sound, { pan, rate: 0.85, gain: 1.1 });
            this.board.hit(h.targetId, "crit", e.tokenId);
            this.board.float(h.targetId, `−${h.damage}`, "crit");
            break;
          case "hit":
          case "fail":
            sfx(sound, { pan });
            this.board.hit(h.targetId, "hit", e.tokenId);
            this.board.float(h.targetId, `−${h.damage}`, "damage");
            break;
          case "success":
            if (h.damage > 0) {
              sfx(sound, { pan, gain: 0.7 });
              this.board.hit(h.targetId, "graze", e.tokenId);
              this.board.float(h.targetId, `−${h.damage}`, "damage");
            } else {
              this.board.dodge(h.targetId, e.tokenId);
              this.board.float(h.targetId, "Saved", "miss");
            }
            break;
          case "fumble":
            sfx("miss", { pan });
            this.board.float(e.tokenId, "Fumble!", "miss");
            break;
          case "miss":
            sfx("miss", { pan });
            this.board.dodge(h.targetId, e.tokenId);
            this.board.float(h.targetId, "Miss", "miss");
            break;
          default:
            break;
        }
        this.board.setHp(h.targetId, h.hp);
      }
    };

    const first = e.hits[0]?.targetId;
    if (!first) {
      await wait(300);
      return;
    }
    if (e.style === "melee") {
      if (!attackRoll) sfx("swing", { gain: 0.5, pan: this.pan(e.tokenId) });
      await this.board.lunge(e.tokenId, first, impact);
    } else {
      if (!saves.length) sfx(sound, { pan: this.pan(e.tokenId), gain: 0.8 });
      const style = e.style === "ranged" ? "ranged" : sound === "fire" ? "fire" : sound === "web" ? "web" : "spell";
      await Promise.all(e.hits.map((h) => this.board.projectile(e.tokenId, h.targetId, style)));
      impact();
    }
    await wait(mine ? 380 : 620);
  }
}

export type { DiceRoll };
