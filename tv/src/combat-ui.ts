/**
 * The combat page, played with a remote: the board owns the D-pad, the cursor starts
 * on the nearest foe, OK moves or strikes, ▼ drops to the action bar, ⏯ ends the turn.
 */

import { Application } from "pixi.js";
import { Board, type Overlay } from "./board";
import { Director } from "./director";
import { cropStyle, DUNGEON_ROOMS, roomForNode } from "./dungeon-map";
import { warmDice } from "./dice3d";
import { focusables, moveFocus, type RemoteKey } from "./nav";
import { coach, hideCoach } from "./onboarding";
import { renderPcSheet, SHEET_TABS, type SheetTab } from "./pc-sheet";
import { reducedMotion } from "./settings";
import { sfx } from "./sfx";
import type { Cell, CombatPublic, MenuAction, RoomState, Token } from "./types";

export type CombatHost = {
  send: (msg: Record<string, unknown>) => void;
  toast: (text: string, kind?: "bad" | "ok" | "info") => void;
  caption: (text: string) => void;
  turnBanner: (title: string, sub: string, tone: "mine" | "ally" | "foe") => Promise<void>;
  victory: () => Promise<void>;
  onDefeatChange: (defeated: boolean) => void;
};

type Aim = { action: MenuAction };

const cheb = (a: Cell, b: Cell) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class CombatUi {
  private host: CombatHost;
  private el: {
    board: HTMLElement;
    ribbon: HTMLElement;
    sheet: HTMLElement;
    actions: HTMLElement;
    title: HTMLElement;
    chapter: HTMLElement;
    meta: HTMLElement;
    log: HTMLElement;
  };
  private appReady: Promise<void> | null = null;
  private board: Board | null = null;
  private director: Director | null = null;
  private combat: CombatPublic | null = null;
  private state: RoomState | null = null;
  private playerId: string | null = null;
  private cursor: Cell = { x: 0, y: 0 };
  private aim: Aim | null = null;
  private sheetTab: SheetTab = "overview";
  private busy = false;
  private awaiting = false;
  private fightKey = "";
  private lastSeq = -1;
  private lastNode = "";
  private fightCount = 0;
  private displayTurnId: string | undefined;
  private endConfirmUntil = 0;
  private outroPlayed = new Set<string>();
  private defeated = false;

  constructor(host: CombatHost, el: CombatUi["el"]) {
    this.host = host;
    this.el = el;
    el.board.addEventListener("focus", () => this.paintOverlay());
    el.board.addEventListener("blur", () => this.paintOverlay());
  }

  private async ensureApp(): Promise<Board> {
    if (this.board) return this.board;
    if (!this.appReady) {
      this.appReady = (async () => {
        const app = new Application();
        await app.init({
          backgroundAlpha: 0,
          resizeTo: this.el.board,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio, 1.5),
          autoDensity: true,
        });
        this.el.board.appendChild(app.canvas);
        new ResizeObserver(() => app.resize()).observe(this.el.board);
        this.board = new Board(app);
        this.director = new Director(this.board, {
          onBusy: (b) => {
            this.busy = b;
            this.el.board.classList.toggle("busy", b);
            this.paintActions();
            this.paintOverlay();
          },
          onLine: (line) => this.host.caption(line),
          onTurn: (t, mine, round) => this.onTimelineTurn(t, mine, round),
          onStart: (order) => this.onStart(order),
          onEnd: (outcome) => this.onEnd(outcome),
          onSettled: () => this.onSettled(),
        });
        app.canvas.addEventListener("pointerdown", (ev) => {
          const rect = app.canvas.getBoundingClientRect();
          const cell = this.board?.cellAt(
            ((ev.clientX - rect.left) * app.screen.width) / rect.width,
            ((ev.clientY - rect.top) * app.screen.height) / rect.height,
          );
          if (!cell) return;
          this.el.board.focus();
          this.cursor = cell;
          this.paintOverlay();
          this.confirm();
        });
        warmDice();
      })();
    }
    await this.appReady;
    return this.board!;
  }

  // ------------------------------------------------------------------ state

  isFighting(): boolean {
    return !!this.combat && (this.combat.status === "active" || this.busy || this.defeated);
  }

  /** The fight that just ended should still play its last blow before the story resumes. */
  wantsOutro(s: RoomState): boolean {
    if (!s.combatOutro || !this.combat) return false;
    const key = `${s.nodeId}:${s.combatOutro.encounterId}:${s.combatOutro.seq}`;
    return !this.outroPlayed.has(key) && s.combatOutro.encounterId === this.combat.encounterId;
  }

  async playOutro(s: RoomState): Promise<void> {
    const outro = s.combatOutro!;
    const key = `${s.nodeId}:${outro.encounterId}:${outro.seq}`;
    this.outroPlayed.add(key);
    this.state = s;
    this.combat = outro;
    this.aim = null;
    this.director?.feed(outro, this.playerId);
    this.paintActions();
    await this.director?.idle();
    this.combat = null;
    this.fightKey = "";
  }

  async render(s: RoomState, opts: { resumed: boolean }) {
    const c = s.combat;
    if (!c) return;
    this.state = s;
    this.playerId = s.localPlayerId;
    const board = await this.ensureApp();
    const newFight = s.nodeId !== this.lastNode || c.seq < this.lastSeq || !this.fightKey;
    this.lastNode = s.nodeId;
    this.lastSeq = c.seq;
    this.combat = c;
    this.defeated = c.status === "defeat";
    if (newFight) {
      this.fightCount += 1;
      this.fightKey = `${s.nodeId}:${this.fightCount}`;
      this.aim = null;
      this.awaiting = false;
      this.displayTurnId = c.currentTokenId;
      board.setBoard(this.fightKey, c.width, c.height, c.walls, c.tokens);
      if (opts.resumed || !c.events.some((e) => e.kind === "start")) this.director!.skipTo(c);
      else this.director!.skipTo({ ...c, seq: Math.min(...c.events.map((e) => e.seq)) - 1 });
      this.paintBackdrop(s.nodeId);
    }
    this.awaiting = false;
    this.director!.feed(c, this.playerId);
    this.paintChrome();
    if (!this.busy) this.onSettled();
  }

  reset() {
    this.combat = null;
    this.fightKey = "";
    this.aim = null;
    this.defeated = false;
    hideCoach();
  }

  private paintBackdrop(nodeId: string) {
    const area = roomForNode(nodeId) ?? "mosaic";
    const crop = cropStyle(DUNGEON_ROOMS[area]);
    this.el.board.style.backgroundImage = "linear-gradient(rgba(12,8,6,.55), rgba(12,8,6,.78)), url(/art/dungeon-map.jpg)";
    this.el.board.style.backgroundSize = `100% 100%, ${crop.size}`;
    this.el.board.style.backgroundPosition = `0 0, ${crop.position}`;
  }

  // ------------------------------------------------------------------ who's who

  private me(): Token | undefined {
    return this.combat?.tokens.find((t) => t.kind === "pc" && t.playerId === this.playerId);
  }

  private myTurn(): boolean {
    const c = this.combat;
    const me = this.me();
    return !!c && !!me && c.status === "active" && c.currentTokenId === me.id && !me.dead;
  }

  private canAct(): boolean {
    return this.myTurn() && !this.busy && !this.awaiting;
  }

  private menu(): MenuAction[] {
    const m = this.combat?.actionMenu;
    return m ? [...m.actions, ...m.bonusActions] : [];
  }

  /** The ★ attack: guided default, else the first action that hits a foe. */
  private strikeAction(): MenuAction | undefined {
    const acts = this.combat?.actionMenu?.actions ?? [];
    return acts.find((a) => a.guided && a.targetKind === "enemy" && a.available) ?? acts.find((a) => a.targetKind === "enemy" && a.available);
  }

  private foes(): Token[] {
    return (this.combat?.tokens ?? []).filter((t) => t.kind !== "pc" && !t.dead);
  }

  private allies(): Token[] {
    return (this.combat?.tokens ?? []).filter((t) => t.kind === "pc" && !t.dead);
  }

  private tokenAt(c: Cell): Token | undefined {
    return this.combat?.tokens.find((t) => !t.dead && t.x === c.x && t.y === c.y);
  }

  private reachable(): Cell[] {
    return this.combat?.reachable ?? [];
  }

  private isReachable(c: Cell) {
    return this.reachable().some((r) => r.x === c.x && r.y === c.y);
  }

  /** Walking route inside the lit cells, for the preview line (the server decides the real one). */
  private route(to: Cell): Cell[] {
    const me = this.me();
    if (!me) return [];
    const open = new Set(this.reachable().map((r) => `${r.x},${r.y}`));
    open.add(`${me.x},${me.y}`);
    if (!open.has(`${to.x},${to.y}`)) return [];
    const prev = new Map<string, string | null>([[`${me.x},${me.y}`, null]]);
    const q: Cell[] = [{ x: me.x, y: me.y }];
    while (q.length) {
      const cur = q.shift()!;
      if (cur.x === to.x && cur.y === to.y) break;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const n = { x: cur.x + dx, y: cur.y + dy };
          const k = `${n.x},${n.y}`;
          if (!open.has(k) || prev.has(k)) continue;
          if (dx && dy && (this.board?.isWall(cur.x + dx, cur.y) || this.board?.isWall(cur.x, cur.y + dy))) continue;
          prev.set(k, `${cur.x},${cur.y}`);
          q.push(n);
        }
      }
    }
    const out: Cell[] = [];
    let k: string | null | undefined = `${to.x},${to.y}`;
    if (!prev.has(k)) return [];
    while (k) {
      const [x, y] = k.split(",").map(Number);
      out.unshift({ x: x!, y: y! });
      k = prev.get(k);
    }
    return out;
  }

  /** Best lit cell to strike `foe` from: in weapon range, shortest walk. */
  private approachCell(foe: Token, range: number): Cell | null {
    const me = this.me();
    if (!me) return null;
    const options = this.reachable().filter((r) => cheb(r, foe) <= range && !this.tokenAt(r));
    const pick = (cells: Cell[]) =>
      cells.map((c) => ({ c, len: this.route(c).length || 99 })).sort((a, b) => a.len - b.len || cheb(a.c, foe) - cheb(b.c, foe))[0]?.c ?? null;
    return pick(options) ?? pick([...this.reachable()].filter((r) => !this.tokenAt(r)).sort((a, b) => cheb(a, foe) - cheb(b, foe)).slice(0, 4));
  }

  // ------------------------------------------------------------------ smart cursor

  private placeSmartCursor() {
    const me = this.me();
    if (!me) return;
    const strike = this.strikeAction();
    const foes = this.foes().sort((a, b) => cheb(a, me) - cheb(b, me) || a.hp - b.hp);
    const inReach = strike ? foes.filter((f) => cheb(f, me) <= strike.range) : [];
    if (inReach.length && me.hasAction) {
      this.cursor = { x: inReach[0]!.x, y: inReach[0]!.y };
      coach("strike");
    } else if (foes.length && me.movementLeft > 0 && strike && me.hasAction) {
      this.cursor = { x: foes[0]!.x, y: foes[0]!.y };
      coach("move");
    } else {
      this.cursor = { x: me.x, y: me.y };
    }
  }

  private aimTargets(action: MenuAction): Token[] {
    const me = this.me();
    if (!me) return [];
    const pool = action.targetKind === "ally" ? this.allies() : this.foes();
    return pool.filter((t) => action.targetKind !== "ally" || cheb(t, me) <= Math.max(1, action.range) || t.id === me.id);
  }

  // ------------------------------------------------------------------ painting

  private cursorState(): Overlay["cursorState"] {
    const me = this.me();
    const at = this.tokenAt(this.cursor);
    if (!me) return "blocked";
    if (this.aim) {
      const ok = this.aimTargets(this.aim.action).some((t) => t.id === at?.id) && (!at || cheb(at, me) <= Math.max(1, this.aim.action.range) || this.aim.action.targetKind === "ally");
      return ok ? (this.aim.action.targetKind === "ally" ? "ally" : "attack") : "blocked";
    }
    if (at && at.kind !== "pc") {
      const strike = this.strikeAction();
      if (strike && cheb(at, me) <= strike.range) return "attack";
      return me.movementLeft > 0 ? "approach" : "blocked";
    }
    if (at) return at.id === me.id ? "move" : "blocked";
    return this.isReachable(this.cursor) ? "move" : "blocked";
  }

  private paintOverlay() {
    const board = this.board;
    const c = this.combat;
    if (!board || !c) return;
    const me = this.me();
    const live = this.canAct() && document.activeElement === this.el.board;
    const displayCurrent = this.busy ? this.displayTurnId : c.currentTokenId;
    const targets: Overlay["targets"] = [];
    if (me && this.canAct()) {
      if (this.aim) {
        for (const t of this.aimTargets(this.aim.action)) {
          targets.push({ id: t.id, x: t.x, y: t.y, kind: this.aim.action.targetKind === "ally" ? "ally" : "enemy", inRange: this.aim.action.targetKind === "ally" || cheb(t, me) <= Math.max(1, this.aim.action.range) });
        }
      } else {
        const strike = this.strikeAction();
        for (const f of this.foes()) targets.push({ id: f.id, x: f.x, y: f.y, kind: "enemy", inRange: !!strike && cheb(f, me) <= strike.range });
      }
    }
    const state = live ? this.cursorState() : "move";
    let path: Cell[] = [];
    if (live && !this.aim) {
      if (state === "move") path = this.route(this.cursor);
      else if (state === "approach") {
        const foe = this.tokenAt(this.cursor);
        const strike = this.strikeAction();
        const cell = foe && strike ? this.approachCell(foe, strike.range) : null;
        if (cell) path = this.route(cell);
      }
    }
    board.setOverlay({
      mode: this.canAct() && !this.aim ? "move" : this.aim ? "aim" : "idle",
      reachable: this.canAct() && !this.aim ? this.reachable() : [],
      targets,
      cursor: live ? this.cursor : null,
      cursorState: state,
      path,
      currentId: displayCurrent,
      myId: me?.id,
    });
    this.paintHint(state);
  }

  private paintHint(state: Overlay["cursorState"]) {
    const c = this.combat;
    if (!c) return;
    const me = this.me();
    let hint: string;
    if (this.busy) hint = "The table is resolving the turn…";
    else if (c.status === "defeat") hint = "The party has fallen.";
    else if (!this.myTurn()) hint = `${c.currentName ?? "Someone"} is acting.`;
    else if (this.awaiting) hint = "…";
    else if (this.aim) hint = `Aim ${this.aim.action.name}: ◀ ▶ ▲ ▼ pick a target · OK confirm · Back cancel`;
    else if (document.activeElement !== this.el.board) hint = "▲ back to the board · OK to use · ⏯ end turn";
    else {
      const at = this.tokenAt(this.cursor);
      switch (state) {
        case "attack":
          hint = `OK — strike ${at?.name ?? "the foe"} with ${this.strikeAction()?.name ?? "your weapon"}`;
          break;
        case "approach":
          hint = `OK — close in on ${at?.name ?? "the foe"}`;
          break;
        case "move":
          hint = me && this.cursor.x === me.x && this.cursor.y === me.y ? "Steer with the D-pad · ▼ more actions · ⏯ end turn" : `OK — walk here (${Math.max(0, this.route(this.cursor).length - 1) * 5} ft)`;
          break;
        case "blocked":
        default:
          hint = me?.hasAction || me?.movementLeft ? "Out of reach from here · ▼ more actions" : "Turn spent — ⏯ ends it";
      }
    }
    this.el.meta.dataset.hint = hint;
    const hintEl = document.getElementById("combatHint");
    if (hintEl) hintEl.textContent = hint;
  }

  private paintChrome() {
    const c = this.combat;
    const s = this.state;
    if (!c || !s) return;
    this.el.meta.textContent = `Round ${c.round}`;
    this.paintRibbon();
    renderPcSheet(this.el.sheet, c.sheet, this.sheetTab, this.myTurn(), (t) => {
      this.sheetTab = t;
      this.paintChrome();
    });
    this.paintActions();
    this.el.log.innerHTML = c.log
      .slice(-5)
      .map((l) => `<li>${esc(l)}</li>`)
      .join("");
  }

  private paintRibbon() {
    const c = this.combat;
    if (!c) return;
    const current = this.busy ? this.displayTurnId : c.currentTokenId;
    const order = c.turnOrder.map((id) => c.tokens.find((t) => t.id === id)).filter((t): t is Token => !!t);
    this.el.ribbon.innerHTML = order
      .map((t) => {
        const ratio = t.maxHp ? Math.max(0, t.hp / t.maxHp) : 0;
        const mine = t.playerId && t.playerId === this.playerId;
        return `<li class="init ${t.kind === "pc" ? "pc" : "foe"} ${t.id === current ? "now" : ""} ${t.dead ? "dead" : ""} ${mine ? "mine" : ""}" style="--hp:${ratio}">
          <span class="init-face">${t.portrait ? `<img src="${t.portrait}" alt="" />` : esc(t.name.slice(0, 1))}</span>
          <span class="init-name">${esc(t.name.split(" ")[0]!)}</span>
          <span class="init-hp"><i></i></span>
          <span class="init-roll">${t.initiative}</span>
        </li>`;
      })
      .join("");
  }

  private paintActions() {
    const c = this.combat;
    if (!c) return;
    const pending = c.pendingReaction;
    if (pending && pending.playerId === this.playerId) {
      this.el.actions.innerHTML = `<p class="meta">${esc(pending.prompt)}</p>
        <button type="button" class="act action" id="reactYes"><strong>${esc(pending.acceptLabel)}</strong></button>
        <button type="button" class="act end" id="reactNo"><strong>${esc(pending.declineLabel)}</strong></button>`;
      this.el.actions.querySelector("#reactYes")?.addEventListener("click", () => this.send({ action: "REACT", accept: true }));
      this.el.actions.querySelector("#reactNo")?.addEventListener("click", () => this.send({ action: "REACT", accept: false }));
      return;
    }
    const can = this.canAct();
    const menu = c.actionMenu;
    const acts = menu && can ? menu.actions : (c.sheet?.actions as MenuAction[] | undefined) ?? [];
    const bonus = menu && can ? menu.bonusActions : (c.sheet?.bonusActions as MenuAction[] | undefined) ?? [];
    const btn = (a: MenuAction, kind: "action" | "bonus") => {
      const disabled = !can || !a.available;
      return `<button type="button" class="act ${kind} ${a.guided ? "guided" : ""} ${this.aim?.action.id === a.id ? "aiming" : ""}" data-act="${a.id}" ${disabled ? "disabled" : ""}>
        <strong>${esc(a.name)}${a.guided ? " ★" : ""}</strong><em>${kind === "bonus" ? "Bonus" : "Action"}${a.range > 1 ? ` · ${a.range * 5} ft` : ""}</em>
      </button>`;
    };
    this.el.actions.innerHTML = `
      <div class="act-group">${acts.map((a) => btn(a, "action")).join("")}</div>
      ${bonus.length ? `<div class="act-group bonus">${bonus.map((a) => btn(a, "bonus")).join("")}</div>` : ""}
      <button type="button" class="act end" id="actEnd" ${can ? "" : "disabled"}><strong>End turn</strong><em>⏯</em></button>`;
    this.el.actions.querySelectorAll<HTMLElement>("[data-act]").forEach((b) =>
      b.addEventListener("click", () => {
        const a = this.menu().find((m) => m.id === b.dataset.act);
        if (a) this.useAction(a);
      }),
    );
    this.el.actions.querySelector("#actEnd")?.addEventListener("click", () => this.endTurn(true));
  }

  // ------------------------------------------------------------------ timeline hooks

  private async onStart(order: Token[]) {
    sfx("enemyTurn", { gain: 0.8 });
    const names = order.map((t) => `${t.name} ${t.initiative}`).join(" · ");
    await this.host.turnBanner("Roll for initiative", names, "foe");
  }

  private async onTimelineTurn(t: Token, mine: boolean, round: number) {
    this.displayTurnId = t.id;
    this.paintRibbon();
    this.paintOverlay();
    if (mine) {
      sfx("turn");
      await this.host.turnBanner("Your turn", `${t.name} · round ${round}`, "mine");
    } else if (t.kind === "pc") {
      sfx("turn", { gain: 0.6 });
      await this.host.turnBanner(`${t.name.split(" ")[0]}'s turn`, `Round ${round}`, "ally");
    } else {
      sfx("enemyTurn", { gain: 0.7 });
      coach("enemy");
      await this.host.turnBanner(t.name, `Round ${round}`, "foe");
    }
  }

  private async onEnd(outcome: "victory" | "defeat") {
    if (outcome === "victory") {
      sfx("victory", { jitter: 0 });
      await this.host.victory();
    } else {
      sfx("defeat", { jitter: 0 });
      this.defeated = true;
      this.host.onDefeatChange(true);
    }
  }

  private onSettled() {
    const c = this.combat;
    if (!c) return;
    this.displayTurnId = c.currentTokenId;
    this.paintChrome();
    this.host.onDefeatChange(c.status === "defeat");
    const aim = c.aimRequest;
    if (aim && aim.playerId === this.playerId && this.myTurn() && !this.aim) {
      const action = this.menu().find((item) => item.id === aim.abilityId);
      if (action) this.useAction(action);
    }
    if (this.myTurn()) {
      const me = this.me()!;
      if (!me.hasAction && !me.hasBonusAction && me.movementLeft <= 0) {
        coach("end");
        requestAnimationFrame(() => (this.el.actions.querySelector("#actEnd") as HTMLElement | null)?.focus());
      } else {
        if (!this.aim) this.placeSmartCursor();
        if (!me.hasAction) coach("end");
        const active = document.activeElement;
        if (!active || active === document.body || !this.el.actions.contains(active)) this.el.board.focus({ preventScroll: true });
      }
    }
    this.paintOverlay();
  }

  // ------------------------------------------------------------------ commands

  private send(msg: Record<string, unknown>) {
    this.awaiting = true;
    this.paintOverlay();
    this.host.send({ ...msg, roomCode: this.state?.roomCode, playerId: this.playerId });
    window.setTimeout(() => {
      if (this.awaiting) {
        this.awaiting = false;
        this.paintOverlay();
        this.paintActions();
      }
    }, 4000);
  }

  private useAction(a: MenuAction) {
    if (!this.canAct()) return;
    if (!a.available) {
      sfx("uiError");
      this.host.toast(a.economy === "bonus_action" ? "Your bonus action is spent this turn." : "Your action is spent this turn.", "bad");
      return;
    }
    if (a.needsTarget || a.targetKind === "ally" || a.targetKind === "cell") {
      this.aim = { action: a };
      const me = this.me()!;
      const targets = this.aimTargets(a).sort((x, y) => cheb(x, me) - cheb(y, me));
      const first = a.targetKind === "ally" ? targets.find((t) => t.hp < t.maxHp) ?? targets[0] : targets.find((t) => cheb(t, me) <= a.range) ?? targets[0];
      if (first) this.cursor = { x: first.x, y: first.y };
      sfx("uiConfirm");
      this.el.board.focus();
      this.paintActions();
      this.paintOverlay();
      return;
    }
    sfx("uiConfirm");
    this.send({ action: "PERFORM_ACTION", abilityId: a.id });
  }

  private endTurn(explicit: boolean) {
    if (!this.canAct()) return;
    const me = this.me();
    if (!explicit && me?.hasAction && Date.now() > this.endConfirmUntil) {
      this.endConfirmUntil = Date.now() + 3500;
      this.host.toast("You still have your action — press ⏯ again to end the turn.", "info");
      return;
    }
    this.aim = null;
    hideCoach();
    sfx("uiConfirm");
    this.send({ action: "END_TURN" });
  }

  private confirm() {
    if (!this.canAct()) {
      if (this.busy) return;
      sfx("uiError");
      this.host.toast(this.myTurn() ? "One moment…" : `It's ${this.combat?.currentName ?? "another hero"}'s turn.`, "info");
      return;
    }
    const me = this.me()!;
    const at = this.tokenAt(this.cursor);
    if (this.aim) {
      const a = this.aim.action;
      if (a.targetKind === "cell") {
        if (!this.isReachable(this.cursor) && cheb(this.cursor, me) > Math.max(1, a.range)) {
          sfx("uiError");
          this.host.toast("That square is out of reach.", "bad");
          return;
        }
        if (cheb(this.cursor, me) > Math.max(1, a.range) || this.tokenAt(this.cursor)) {
          sfx("uiError");
          this.host.toast("Pick an empty square in range.", "bad");
          return;
        }
        this.aim = null;
        sfx("uiConfirm");
        this.send({ action: "PERFORM_ACTION", abilityId: a.id, x: this.cursor.x, y: this.cursor.y });
        return;
      }
      const valid = this.aimTargets(a).find((t) => t.id === at?.id);
      if (!valid) {
        sfx("uiError");
        this.host.toast(a.targetKind === "ally" ? "Pick an ally for that." : "Pick a foe for that.", "bad");
        return;
      }
      if (a.targetKind !== "ally" && cheb(valid, me) > Math.max(1, a.range)) {
        sfx("uiError");
        this.host.toast(`${valid.name} is out of reach for ${a.name}.`, "bad");
        return;
      }
      this.aim = null;
      sfx("uiConfirm");
      this.send({ action: "PERFORM_ACTION", abilityId: a.id, targetId: valid.id });
      return;
    }
    if (at && at.kind !== "pc") {
      const strike = this.strikeAction();
      if (!strike) {
        sfx("uiError");
        this.host.toast("Your action is spent — ⏯ ends the turn.", "bad");
        return;
      }
      if (cheb(at, me) <= strike.range) {
        sfx("uiConfirm");
        this.send({ action: "PERFORM_ACTION", abilityId: strike.id, targetId: at.id });
        return;
      }
      const cell = me.movementLeft > 0 ? this.approachCell(at, strike.range) : null;
      if (!cell) {
        sfx("uiError");
        this.host.toast(`${at.name} is out of reach and you can't move closer.`, "bad");
        return;
      }
      sfx("uiConfirm");
      this.send({ action: "PROPOSE_MOVE", x: cell.x, y: cell.y });
      return;
    }
    if (this.isReachable(this.cursor) && !at) {
      sfx("uiConfirm");
      this.send({ action: "PROPOSE_MOVE", x: this.cursor.x, y: this.cursor.y });
      return;
    }
    if (at?.id === me.id) {
      this.el.actions.querySelector<HTMLElement>("button:not([disabled])")?.focus();
      return;
    }
    sfx("uiError");
    this.host.toast(me.movementLeft > 0 ? "You can't reach that square." : "No movement left this turn.", "bad");
  }

  private moveCursor(dir: "up" | "down" | "left" | "right") {
    const { cols, rows } = this.board?.size() ?? { cols: 1, rows: 1 };
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir] as [number, number];
    if (this.aim && this.aim.action.targetKind !== "cell") {
      const me = this.me();
      const pool = this.aimTargets(this.aim.action).filter((t) => t.x !== this.cursor.x || t.y !== this.cursor.y);
      const scored = pool
        .map((t) => {
          const vx = t.x - this.cursor.x;
          const vy = t.y - this.cursor.y;
          const along = vx * d[0] + vy * d[1];
          const across = Math.abs(vx * d[1] - vy * d[0]);
          return { t, along, score: along + across * 2 + (me && cheb(t, me) > this.aim!.action.range ? 3 : 0) };
        })
        .filter((s) => s.along > 0)
        .sort((a, b) => a.score - b.score);
      if (scored[0]) {
        this.cursor = { x: scored[0].t.x, y: scored[0].t.y };
        sfx("uiMove");
        this.paintOverlay();
      }
      return;
    }
    const nx = this.cursor.x + d[0];
    const ny = this.cursor.y + d[1];
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      if (dir === "down" || dir === "right") moveFocus(dir);
      return;
    }
    this.cursor = { x: nx, y: ny };
    sfx("uiMove");
    this.paintOverlay();
  }

  /** Remote input while the combat page is up. Returns true when handled. */
  handleKey(key: RemoteKey): boolean {
    if (!this.combat) return false;
    const onBoard = document.activeElement === this.el.board;
    if (key === "play") {
      if (this.myTurn() && !this.busy) this.endTurn(false);
      return true;
    }
    if (key === "rew" || key === "ff") {
      const i = SHEET_TABS.findIndex((t) => t.id === this.sheetTab);
      this.sheetTab = SHEET_TABS[(i + (key === "ff" ? 1 : -1) + SHEET_TABS.length) % SHEET_TABS.length]!.id;
      sfx("uiMove");
      this.paintChrome();
      return true;
    }
    if (key === "back") {
      if (this.aim) {
        this.aim = null;
        sfx("uiBack");
        this.paintActions();
        this.paintOverlay();
        return true;
      }
      if (onBoard) {
        this.el.actions.querySelector<HTMLElement>("button:not([disabled])")?.focus();
        sfx("uiBack");
      } else {
        this.el.board.focus();
        sfx("uiBack");
      }
      this.paintOverlay();
      return true;
    }
    if (!onBoard) {
      if (key === "up" && this.el.actions.contains(document.activeElement)) {
        const moved = moveFocus("up");
        if (!moved || !this.el.actions.contains(document.activeElement)) this.el.board.focus();
        this.paintOverlay();
        return true;
      }
      if (key === "left" && this.el.sheet.contains(document.activeElement)) {
        if (!moveFocus("left")) this.el.board.focus();
        this.paintOverlay();
        return true;
      }
      return false;
    }
    switch (key) {
      case "up":
      case "down":
      case "left":
      case "right":
        if (this.busy) return true;
        if (!this.canAct()) {
          if (key === "down" || key === "right") moveFocus(key);
          return true;
        }
        this.moveCursor(key);
        return true;
      case "ok":
        this.confirm();
        return true;
      default:
        return false;
    }
  }

  focusBoard() {
    this.el.board.focus({ preventScroll: true });
    this.paintOverlay();
  }

  hasFocusables(): boolean {
    return focusables(this.el.actions).length > 0;
  }

  get reduced() {
    return reducedMotion();
  }
}
