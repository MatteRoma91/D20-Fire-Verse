/**
 * The tactical board, drawn for a television across the room: painted portraits on
 * pawns that walk, lunge, flinch and fall; a camera that leans in on whoever acts;
 * overlays that read by shape as well as colour.
 */

import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { onSettings, reducedMotion, settings } from "./settings";
import type { Cell, Token } from "./types";

type Pawn = {
  id: string;
  root: Container;
  body: Container;
  ring: Graphics;
  glow: Graphics;
  portrait: Sprite | null;
  letter: Text;
  hpBar: Graphics;
  plate: Text;
  badges: Text;
  hurt: Graphics;
  cell: Cell;
  dead: boolean;
  token: Token;
};

type Tween = { start: number; dur: number; step: (t: number) => void; done: () => void };

export type OverlayMode = "move" | "aim" | "idle";

export type Overlay = {
  mode: OverlayMode;
  reachable: Cell[];
  targets: Array<{ id: string; x: number; y: number; kind: "enemy" | "ally"; inRange: boolean }>;
  cursor: Cell | null;
  cursorState: "move" | "attack" | "ally" | "blocked" | "approach";
  path: Cell[];
  currentId?: string;
  myId?: string;
};

const PC_RING = [0x5aa0e8, 0xe8c050, 0x7bc47f];
const ENEMY_RING = 0xd8503c;
const BOSS_RING = 0xff7a2a;
const GOLD = 0xf0c27a;
const CELL_MAX = 84;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export class Board {
  readonly app: Application;
  private world = new Container();
  private floor = new Graphics();
  private overlayG = new Graphics();
  private pathG = new Graphics();
  private tokenLayer = new Container();
  private cursorG = new Graphics();
  private fx = new Container();
  private pawns = new Map<string, Pawn>();
  private tweens: Tween[] = [];
  private cols = 1;
  private rows = 1;
  private walls: boolean[][] = [];
  private cell = 48;
  private ox = 0;
  private oy = 0;
  private boardKey = "";
  private shakeAmp = 0;
  private cam = { x: 0, y: 0, zoom: 1 };
  private pulse = 0;
  private overlay: Overlay | null = null;
  private pcIndex = new Map<string, number>();

  constructor(app: Application) {
    this.app = app;
    this.world.addChild(this.floor, this.overlayG, this.pathG, this.tokenLayer, this.cursorG, this.fx);
    app.stage.addChild(this.world);
    app.ticker.add(() => this.tick());
    app.renderer.on("resize", () => this.layout());
    let contrast = settings().highContrast;
    onSettings((s) => {
      if (s.highContrast === contrast) return;
      contrast = s.highContrast;
      this.layout();
    });
  }

  // ------------------------------------------------------------------ layout

  private layout() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.cell = Math.max(24, Math.min(Math.floor((w - 24) / this.cols), Math.floor((h - 24) / this.rows), CELL_MAX));
    this.ox = Math.floor((w - this.cols * this.cell) / 2);
    this.oy = Math.floor((h - this.rows * this.cell) / 2);
    this.drawFloor();
    for (const p of this.pawns.values()) {
      const c = this.center(p.cell);
      p.root.position.set(c.x, c.y);
      this.drawPawn(p);
    }
    if (this.overlay) this.setOverlay(this.overlay);
    this.applyCamera();
  }

  center(c: Cell) {
    return { x: this.ox + c.x * this.cell + this.cell / 2, y: this.oy + c.y * this.cell + this.cell / 2 };
  }

  /** Screen pixel → board cell, accounting for the camera. */
  cellAt(px: number, py: number): Cell | null {
    const wx = (px - this.world.x) / this.world.scale.x;
    const wy = (py - this.world.y) / this.world.scale.y;
    const x = Math.floor((wx - this.ox) / this.cell);
    const y = Math.floor((wy - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return { x, y };
  }

  isWall(x: number, y: number) {
    return !!this.walls[y]?.[x];
  }

  size() {
    return { cols: this.cols, rows: this.rows };
  }

  private drawFloor() {
    const g = this.floor;
    g.clear();
    const c = this.cell;
    const contrast = settings().highContrast;
    const w = this.cols * c;
    const h = this.rows * c;
    g.roundRect(this.ox - 12, this.oy - 12, w + 24, h + 24, 16).fill({ color: 0x0a0705, alpha: 0.96 });
    g.roundRect(this.ox - 12, this.oy - 12, w + 24, h + 24, 16).stroke({ width: 2, color: 0x8a5a30, alpha: 0.8 });
    g.roundRect(this.ox - 5, this.oy - 5, w + 10, h + 10, 10).stroke({ width: 1, color: 0x3a2818, alpha: 0.9 });
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const px = this.ox + x * c;
        const py = this.oy + y * c;
        const n = hash2(x, y);
        if (this.isWall(x, y)) {
          g.rect(px, py, c, c).fill({ color: contrast ? 0x000000 : 0x0d0907 });
          if (!contrast) {
            const course = Math.max(4, Math.floor(c / 3));
            for (let by = 0; by < c; by += course) {
              const shift = (Math.floor(by / course) % 2) * (c / 2);
              for (let bx = -shift; bx < c; bx += c / 1.5) {
                const x0 = Math.max(px, px + bx + 1);
                const x1 = Math.min(px + c, px + bx + c / 1.5 - 1);
                if (x1 - x0 > 2) g.rect(x0, py + by + 1, x1 - x0, course - 2).fill({ color: 0x2a1f17, alpha: 0.9 - 0.25 * hash2(x * 7 + bx, y * 5 + by) });
              }
            }
          } else {
            g.rect(px + 2, py + 2, c - 4, c - 4).stroke({ width: 2, color: 0x6a6a6a, alpha: 1 });
          }
        } else {
          const tone = contrast ? ((x + y) % 2 === 0 ? 0x3a3530 : 0x2e2a26) : lerpColor(0x2d241b, 0x3a2f24, n);
          g.rect(px, py, c, c).fill({ color: tone, alpha: 0.97 });
          g.rect(px + 0.5, py + 0.5, c - 1, c - 1).stroke({ width: 1, color: 0x000000, alpha: contrast ? 0.6 : 0.4 });
          if (!contrast && n > 0.72) g.circle(px + c * (0.25 + 0.5 * hash2(y, x)), py + c * (0.3 + 0.4 * n), Math.max(1, c * 0.04)).fill({ color: 0x1a130d, alpha: 0.6 });
          if (!contrast) g.rect(px + 1, py + 1, c - 2, 1).fill({ color: 0xffe0b0, alpha: 0.05 });
        }
      }
    }
  }

  // ------------------------------------------------------------------ board & tokens

  /** New fight or re-layout: walls, dimensions, pawns snapped to their cells. */
  setBoard(key: string, cols: number, rows: number, walls: boolean[][], tokens: Token[]) {
    const fresh = key !== this.boardKey;
    if (fresh) {
      this.boardKey = key;
      for (const p of this.pawns.values()) p.root.destroy({ children: true });
      this.pawns.clear();
      this.pcIndex.clear();
      this.tweens = [];
      for (const child of this.fx.removeChildren()) child.destroy();
      this.cam = { x: 0, y: 0, zoom: 1 };
    }
    this.cols = cols;
    this.rows = rows;
    this.walls = walls;
    this.layout();
    this.sync(tokens, { snap: true });
    return fresh;
  }

  /** Bring pawns in line with the server: new ones appear, known ones jump to their true cell and HP. */
  sync(tokens: Token[], opts: { snap: boolean }) {
    let pcCount = 0;
    for (const t of tokens) {
      if (t.kind === "pc" && !this.pcIndex.has(t.id)) this.pcIndex.set(t.id, this.pcIndex.size);
      if (t.kind === "pc") pcCount += 1;
      let p = this.pawns.get(t.id);
      if (!p) {
        p = this.createPawn(t);
        this.pawns.set(t.id, p);
      }
      p.token = t;
      if (opts.snap) {
        p.cell = { x: t.x, y: t.y };
        const c = this.center(p.cell);
        p.root.position.set(c.x, c.y);
        if (t.dead && !p.dead) this.layDown(p, true);
        if (!t.dead && p.dead) this.standUp(p);
      }
      this.drawPawn(p);
    }
    void pcCount;
    for (const [id, p] of this.pawns) {
      if (!tokens.some((t) => t.id === id)) {
        p.root.destroy({ children: true });
        this.pawns.delete(id);
      }
    }
    this.sortDepth();
  }

  private sortDepth() {
    const list = [...this.pawns.values()].sort((a, b) => Number(a.dead) - Number(b.dead) || a.root.y - b.root.y);
    list.forEach((p, i) => (p.root.zIndex = i));
    this.tokenLayer.sortableChildren = true;
  }

  private createPawn(t: Token): Pawn {
    const root = new Container();
    const body = new Container();
    const glow = new Graphics();
    const ring = new Graphics();
    const hurt = new Graphics();
    const letter = new Text({ text: t.name.slice(0, 1).toUpperCase(), style: { fontFamily: "Cinzel, Georgia, serif", fontSize: 24, fontWeight: "700", fill: 0xf6e6c8 } });
    letter.anchor.set(0.5);
    const hpBar = new Graphics();
    const plate = new Text({ text: t.name.split(" ")[0]!.slice(0, 10), style: { fontFamily: "Literata, Georgia, serif", fontSize: 14, fill: 0xf6e6c8, stroke: { color: 0x0b0806, width: 4 } } });
    plate.anchor.set(0.5, 0);
    const badges = new Text({ text: "", style: { fontFamily: "Georgia, serif", fontSize: 16, fill: 0xffe3a0, stroke: { color: 0x0b0806, width: 4 } } });
    badges.anchor.set(0.5, 1);
    body.addChild(glow, ring, letter, hurt);
    root.addChild(body, hpBar, plate, badges);
    this.tokenLayer.addChild(root);
    const pawn: Pawn = { id: t.id, root, body, ring, glow, portrait: null, letter, hpBar, plate, badges, hurt, cell: { x: t.x, y: t.y }, dead: false, token: t };
    if (t.portrait) {
      void Assets.load<Texture>(t.portrait)
        .then((tex) => {
          if (root.destroyed) return;
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5);
          const mask = new Graphics();
          body.addChildAt(sprite, 2);
          body.addChild(mask);
          sprite.mask = mask;
          pawn.portrait = sprite;
          letter.visible = false;
          this.drawPawn(pawn);
        })
        .catch(() => undefined);
    }
    return pawn;
  }

  private ringColor(t: Token) {
    if (t.kind === "pc") return PC_RING[(this.pcIndex.get(t.id) ?? 0) % PC_RING.length]!;
    return t.boss ? BOSS_RING : ENEMY_RING;
  }

  private drawPawn(p: Pawn) {
    const t = p.token;
    const c = this.cell;
    const r = c * (t.boss ? 0.47 : 0.4);
    const color = this.ringColor(t);
    const contrast = settings().highContrast;
    p.glow.clear();
    p.ring.clear();
    p.ring.ellipse(0, r * 0.95, r * 0.95, r * 0.3).fill({ color: 0x000000, alpha: 0.5 });
    if (t.kind === "pc") {
      p.ring.circle(0, 0, r + 3).fill({ color });
      p.ring.circle(0, 0, r + 3).stroke({ width: contrast ? 4 : 2, color: 0xfff4dc, alpha: 0.9 });
    } else {
      // Foes wear a spiked ring: shape, not only colour, says "enemy".
      const spikes = t.boss ? 14 : 10;
      const pts: number[] = [];
      for (let i = 0; i < spikes * 2; i += 1) {
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r + (t.boss ? 10 : 7) : r + 2;
        pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      p.ring.poly(pts).fill({ color });
      p.ring.poly(pts).stroke({ width: contrast ? 3 : 1.5, color: 0x1a0806 });
    }
    p.ring.circle(0, 0, r - 1).fill({ color: 0x1a120c });
    if (p.portrait) {
      const size = (r - 2) * 2;
      const tex = p.portrait.texture;
      p.portrait.scale.set(size / Math.min(tex.width, tex.height));
      const mask = p.portrait.mask as Graphics;
      mask.clear().circle(0, 0, r - 2).fill({ color: 0xffffff });
    }
    p.letter.style.fontSize = Math.max(14, r * 0.9);
    p.hurt.clear().circle(0, 0, r).fill({ color: 0xffffff });
    p.hurt.alpha = 0;

    p.hpBar.clear();
    const ratio = t.maxHp > 0 ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 0;
    const barW = c * 0.8;
    const barY = r + 6;
    if (!p.dead) {
      p.hpBar.roundRect(-barW / 2 - 1, barY - 1, barW + 2, 8, 3).fill({ color: 0x0b0806, alpha: 0.9 });
      p.hpBar.roundRect(-barW / 2, barY, Math.max(2, barW * ratio), 6, 2).fill({
        color: ratio > 0.5 ? 0x6fbf5e : ratio > 0.25 ? 0xe8c040 : 0xe0483c,
      });
      if (ratio <= 0.25) p.hpBar.roundRect(-barW / 2, barY, barW, 6, 2).stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
    }
    p.plate.style.fontSize = Math.max(11, c * 0.19);
    p.plate.y = barY + 9;
    p.plate.visible = !p.dead;
    const marks = [t.dodging ? "🛡" : "", t.hidden ? "👁" : "", t.blessed ? "✦" : "", t.marked ? "◎" : ""].filter(Boolean).join(" ");
    p.badges.text = p.dead ? "" : marks;
    p.badges.y = -r - 8;
    p.badges.style.fontSize = Math.max(12, c * 0.22);
    this.drawGlow(p);
  }

  private drawGlow(p: Pawn) {
    const o = this.overlay;
    const r = this.cell * (p.token.boss ? 0.47 : 0.4);
    p.glow.clear();
    if (p.dead) return;
    if (o?.currentId === p.id) {
      p.glow.circle(0, 0, r + 12).fill({ color: GOLD, alpha: 0.28 });
      p.glow.circle(0, 0, r + 12).stroke({ width: 3, color: GOLD, alpha: 0.95 });
    }
    if (o?.myId === p.id) {
      const y = -r - (p.token.dodging || p.token.hidden || p.token.blessed || p.token.marked ? 30 : 12);
      p.glow.poly([-8, y - 10, 8, y - 10, 0, y]).fill({ color: 0xffe08a });
    }
  }

  // ------------------------------------------------------------------ overlay

  setOverlay(o: Overlay) {
    this.overlay = o;
    const g = this.overlayG;
    const c = this.cell;
    const contrast = settings().highContrast;
    g.clear();
    if (o.mode === "move") {
      for (const r of o.reachable) {
        const px = this.ox + r.x * c;
        const py = this.oy + r.y * c;
        g.roundRect(px + 3, py + 3, c - 6, c - 6, 5).fill({ color: 0xf2c46a, alpha: contrast ? 0.42 : 0.2 });
        g.roundRect(px + 3, py + 3, c - 6, c - 6, 5).stroke({ width: contrast ? 2.5 : 1.5, color: contrast ? 0xffffff : 0xf2c46a, alpha: 0.75 });
        const d = c * 0.07;
        g.poly([px + c / 2, py + c / 2 - d, px + c / 2 + d, py + c / 2, px + c / 2, py + c / 2 + d, px + c / 2 - d, py + c / 2]).fill({ color: 0xfff0c8, alpha: 0.8 });
      }
    }
    for (const t of o.targets) {
      const px = this.ox + t.x * c;
      const py = this.oy + t.y * c;
      const col = t.kind === "enemy" ? 0xe0483c : 0x6fcf7a;
      const alpha = t.inRange ? 1 : 0.35;
      g.roundRect(px + 2, py + 2, c - 4, c - 4, 6).stroke({ width: contrast ? 4 : 3, color: col, alpha });
      const m = c * 0.16;
      if (t.kind === "enemy") {
        g.moveTo(px + m, py + c / 2).lineTo(px + m * 2, py + c / 2);
        g.moveTo(px + c - m, py + c / 2).lineTo(px + c - m * 2, py + c / 2);
        g.moveTo(px + c / 2, py + m).lineTo(px + c / 2, py + m * 2);
        g.moveTo(px + c / 2, py + c - m).lineTo(px + c / 2, py + c - m * 2);
        g.stroke({ width: 3, color: col, alpha });
      } else {
        g.moveTo(px + c - m * 2.2, py + m * 1.3).lineTo(px + c - m * 1.2, py + m * 1.3);
        g.moveTo(px + c - m * 1.7, py + m * 0.8).lineTo(px + c - m * 1.7, py + m * 1.8);
        g.stroke({ width: 3, color: col, alpha });
      }
    }
    this.pathG.clear();
    if (o.path.length > 1) {
      const pts = o.path.map((p) => this.center(p));
      this.pathG.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) this.pathG.lineTo(p.x, p.y);
      this.pathG.stroke({ width: Math.max(3, c * 0.07), color: 0xfff0c8, alpha: 0.85, cap: "round", join: "round" });
      for (const p of pts.slice(1)) this.pathG.circle(p.x, p.y, Math.max(3, c * 0.06)).fill({ color: 0xfff0c8, alpha: 0.9 });
    }
    this.drawCursor();
    for (const p of this.pawns.values()) this.drawGlow(p);
  }

  private drawCursor() {
    const g = this.cursorG;
    g.clear();
    const o = this.overlay;
    if (!o?.cursor) return;
    const c = this.cell;
    const x = this.ox + o.cursor.x * c;
    const y = this.oy + o.cursor.y * c;
    const color =
      o.cursorState === "attack" ? 0xff6a50 : o.cursorState === "ally" ? 0x7fe08a : o.cursorState === "blocked" ? 0x9a8f86 : 0xfff0c8;
    const arm = Math.max(8, c * 0.3);
    const corners: Array<[number, number, number, number]> = [
      [x + 2, y + 2, 1, 1],
      [x + c - 2, y + 2, -1, 1],
      [x + 2, y + c - 2, 1, -1],
      [x + c - 2, y + c - 2, -1, -1],
    ];
    for (const [cx, cy, dx, dy] of corners) {
      g.moveTo(cx, cy + dy * arm).lineTo(cx, cy).lineTo(cx + dx * arm, cy);
    }
    g.stroke({ width: Math.max(3, c * 0.06), color, cap: "round", join: "round" });
    if (o.cursorState === "blocked") {
      const m = c * 0.32;
      g.moveTo(x + m, y + m).lineTo(x + c - m, y + c - m).moveTo(x + c - m, y + m).lineTo(x + m, y + c - m);
      g.stroke({ width: 3, color, alpha: 0.8 });
    }
  }

  // ------------------------------------------------------------------ camera

  private applyCamera() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const z = this.cam.zoom;
    let x = w / 2 - this.cam.x * z;
    let y = h / 2 - this.cam.y * z;
    if (z <= 1.001) {
      x = 0;
      y = 0;
    } else {
      x = Math.min(0, Math.max(w - w * z, x));
      y = Math.min(0, Math.max(h - h * z, y));
    }
    this.world.scale.set(z);
    this.world.position.set(x, y);
  }

  /** Lean the camera toward some cells (an actor and its target), or back out to the whole board. */
  focus(cells: Cell[] | null, zoom = 1.3, ms = 520): Promise<void> {
    const from = { ...this.cam };
    let to: { x: number; y: number; zoom: number };
    if (!cells?.length || reducedMotion()) {
      to = { x: this.app.screen.width / 2, y: this.app.screen.height / 2, zoom: 1 };
    } else {
      const pts = cells.map((c) => this.center(c));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      to = { x: cx, y: cy, zoom };
    }
    if (from.zoom <= 1.001) {
      from.x = to.x;
      from.y = to.y;
    }
    return this.tween(reducedMotion() ? 1 : ms, (t) => {
      const e = easeInOut(t);
      this.cam.x = from.x + (to.x - from.x) * e;
      this.cam.y = from.y + (to.y - from.y) * e;
      this.cam.zoom = from.zoom + (to.zoom - from.zoom) * e;
      this.applyCamera();
    });
  }

  // ------------------------------------------------------------------ animation

  private tween(dur: number, step: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), dur: Math.max(1, dur), step, done: resolve });
    });
  }

  private tick() {
    const now = performance.now();
    this.pulse += this.app.ticker.deltaTime;
    const live: Tween[] = [];
    for (const tw of this.tweens) {
      const t = Math.min(1, (now - tw.start) / tw.dur);
      tw.step(t);
      if (t >= 1) tw.done();
      else live.push(tw);
    }
    this.tweens = live;
    this.cursorG.alpha = 0.7 + Math.sin(this.pulse * 0.12) * 0.3;
    const cur = this.overlay?.currentId ? this.pawns.get(this.overlay.currentId) : undefined;
    if (cur && !cur.dead) cur.glow.alpha = 0.75 + Math.sin(this.pulse * 0.09) * 0.25;
    if (this.shakeAmp > 0.3 && !reducedMotion()) {
      this.shakeAmp *= 0.86;
      this.applyCamera();
      this.world.x += (Math.random() - 0.5) * this.shakeAmp;
      this.world.y += (Math.random() - 0.5) * this.shakeAmp * 0.6;
    } else if (this.shakeAmp > 0) {
      this.shakeAmp = 0;
      this.applyCamera();
    }
  }

  shake(amount: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** Walk a pawn cell by cell along the server's path; `onStep` fires on each footfall. */
  async walk(id: string, path: Cell[], msPerCell: number, onStep?: (cell: Cell, i: number) => void) {
    const p = this.pawns.get(id);
    if (!p || path.length < 2) return;
    if (reducedMotion()) {
      p.cell = path[path.length - 1]!;
      const c = this.center(p.cell);
      p.root.position.set(c.x, c.y);
      this.sortDepth();
      return;
    }
    for (let i = 1; i < path.length; i += 1) {
      const a = this.center(path[i - 1]!);
      const b = this.center(path[i]!);
      const diag = path[i - 1]!.x !== path[i]!.x && path[i - 1]!.y !== path[i]!.y;
      await this.tween(msPerCell * (diag ? 1.25 : 1), (t) => {
        const e = easeInOut(t);
        p.root.position.set(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e - Math.sin(t * Math.PI) * this.cell * 0.12);
        p.body.rotation = Math.sin(t * Math.PI * 2) * 0.06;
      });
      p.cell = path[i]!;
      onStep?.(p.cell, i);
      this.sortDepth();
    }
    p.body.rotation = 0;
  }

  /** The attacker leans into the blow; `onImpact` fires at the moment of contact. */
  async lunge(id: string, targetId: string, onImpact?: () => void) {
    const p = this.pawns.get(id);
    const q = this.pawns.get(targetId);
    if (!p || !q) {
      onImpact?.();
      return;
    }
    const home = this.center(p.cell);
    const dx = q.root.x - home.x;
    const dy = q.root.y - home.y;
    const len = Math.hypot(dx, dy) || 1;
    const reach = Math.min(this.cell * 0.42, len * 0.45);
    const tx = (dx / len) * reach;
    const ty = (dy / len) * reach;
    if (reducedMotion()) {
      onImpact?.();
      return;
    }
    await this.tween(140, (t) => {
      const e = t * t;
      p.root.position.set(home.x - tx * 0.18 * Math.sin(t * Math.PI), home.y - ty * 0.18 * Math.sin(t * Math.PI));
      void e;
    });
    await this.tween(110, (t) => {
      const e = easeOut(t);
      p.root.position.set(home.x + tx * e, home.y + ty * e);
    });
    onImpact?.();
    await this.tween(240, (t) => {
      const e = easeInOut(t);
      p.root.position.set(home.x + tx * (1 - e), home.y + ty * (1 - e));
    });
  }

  /** The struck pawn flashes and recoils; a crit rings harder. */
  hit(id: string, strength: "hit" | "crit" | "graze" = "hit", fromId?: string) {
    const p = this.pawns.get(id);
    if (!p) return;
    const from = fromId ? this.pawns.get(fromId) : undefined;
    const home = this.center(p.cell);
    const dx = from ? p.root.x - from.root.x : 0;
    const dy = from ? p.root.y - from.root.y : -1;
    const len = Math.hypot(dx, dy) || 1;
    const push = this.cell * (strength === "crit" ? 0.22 : 0.12);
    this.shake(strength === "crit" ? 16 : strength === "hit" ? 7 : 3);
    void this.tween(reducedMotion() ? 1 : 320, (t) => {
      p.hurt.alpha = (1 - t) * (strength === "crit" ? 0.95 : 0.75);
      const k = Math.sin(t * Math.PI) * (1 - t);
      p.root.position.set(home.x + (dx / len) * push * k * 2, home.y + (dy / len) * push * k * 2);
      p.body.scale.set(1 + 0.08 * k, 1 - 0.08 * k);
    }).then(() => {
      p.hurt.alpha = 0;
      p.body.scale.set(1);
      p.root.position.set(home.x, home.y);
    });
  }

  dodge(id: string, fromId?: string) {
    const p = this.pawns.get(id);
    if (!p || reducedMotion()) return;
    const from = fromId ? this.pawns.get(fromId) : undefined;
    const home = this.center(p.cell);
    const dx = from ? p.root.y - from.root.y : 1;
    const dy = from ? -(p.root.x - from.root.x) : 0;
    const len = Math.hypot(dx, dy) || 1;
    const side = this.cell * 0.2;
    void this.tween(300, (t) => {
      const k = Math.sin(t * Math.PI);
      p.root.position.set(home.x + (dx / len) * side * k, home.y + (dy / len) * side * k);
    });
  }

  float(id: string, text: string, kind: "damage" | "crit" | "heal" | "miss" | "info") {
    const p = this.pawns.get(id);
    if (!p) return;
    const color = kind === "heal" ? 0x9be89b : kind === "miss" ? 0xd8d0c4 : kind === "crit" ? 0xffd36a : kind === "info" ? 0xfff0c8 : 0xff8a70;
    const size = Math.max(18, this.cell * (kind === "crit" ? 0.62 : kind === "miss" || kind === "info" ? 0.34 : 0.46));
    const label = new Text({
      text,
      style: { fontFamily: "Cinzel, Georgia, serif", fontSize: size, fontWeight: "700", fill: color, stroke: { color: 0x120a06, width: 6 } },
    });
    label.anchor.set(0.5);
    label.position.set(p.root.x, p.root.y - this.cell * 0.45);
    this.fx.addChild(label);
    const y0 = label.y;
    void this.tween(kind === "crit" ? 1500 : 1150, (t) => {
      const pop = t < 0.15 ? easeOut(t / 0.15) * 1.25 : 1.25 - 0.25 * Math.min(1, (t - 0.15) / 0.2);
      label.scale.set(pop);
      label.y = y0 - easeOut(t) * this.cell * 0.7;
      label.alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    }).then(() => label.destroy());
  }

  /** A glowing bolt, arrow or spray of fire from one pawn to another. */
  async projectile(fromId: string, toId: string, style: "ranged" | "spell" | "fire" | "web") {
    const a = this.pawns.get(fromId);
    const b = this.pawns.get(toId);
    if (!a || !b || reducedMotion()) return;
    const g = new Graphics();
    this.fx.addChild(g);
    const ax = a.root.x;
    const ay = a.root.y;
    const bx = b.root.x;
    const by = b.root.y;
    const color = style === "spell" ? 0xa8b8ff : style === "fire" ? 0xff8a2a : style === "web" ? 0xf0e0c0 : 0xf6e6c8;
    const dur = Math.min(520, 140 + Math.hypot(bx - ax, by - ay) * 0.9);
    await this.tween(dur, (t) => {
      const e = easeInOut(t);
      const x = ax + (bx - ax) * e;
      const y = ay + (by - ay) * e - Math.sin(t * Math.PI) * this.cell * (style === "ranged" ? 0.3 : 0.15);
      g.clear();
      if (style === "ranged") {
        const ang = Math.atan2(by - ay, bx - ax);
        const l = this.cell * 0.35;
        g.moveTo(x - Math.cos(ang) * l, y - Math.sin(ang) * l).lineTo(x, y).stroke({ width: 3, color });
      } else {
        const r = this.cell * (style === "fire" ? 0.22 : 0.14);
        g.circle(x, y, r * 1.8).fill({ color, alpha: 0.25 });
        g.circle(x, y, r).fill({ color, alpha: 0.95 });
        for (let i = 0; i < 4; i += 1) {
          const tt = Math.max(0, e - i * 0.05);
          g.circle(ax + (bx - ax) * tt, ay + (by - ay) * tt, r * (0.6 - i * 0.12)).fill({ color, alpha: 0.4 - i * 0.08 });
        }
      }
    });
    g.destroy();
  }

  sparkle(id: string, color = 0x9be89b) {
    const p = this.pawns.get(id);
    if (!p || reducedMotion()) return;
    const g = new Graphics();
    this.fx.addChild(g);
    const seeds = Array.from({ length: 14 }, () => ({ x: (Math.random() - 0.5) * this.cell * 0.8, s: 0.5 + Math.random(), d: Math.random() * 0.3 }));
    void this.tween(1100, (t) => {
      g.clear();
      for (const s of seeds) {
        const k = Math.max(0, Math.min(1, (t - s.d) / 0.7));
        if (k <= 0) continue;
        g.circle(p.root.x + s.x, p.root.y + this.cell * 0.2 - k * this.cell * 0.9 * s.s, 3 * (1 - k) + 1).fill({ color, alpha: 1 - k });
      }
    }).then(() => g.destroy());
  }

  private layDown(p: Pawn, instant: boolean) {
    p.dead = true;
    p.hpBar.clear();
    p.plate.visible = false;
    p.badges.text = "";
    p.glow.clear();
    const finish = () => {
      p.body.rotation = 0.5;
      p.body.alpha = 0.32;
      p.body.scale.set(0.8, 0.55);
      p.body.y = this.cell * 0.12;
      this.sortDepth();
    };
    if (instant || reducedMotion()) {
      finish();
      return Promise.resolve();
    }
    return this.tween(700, (t) => {
      const e = easeOut(t);
      p.body.rotation = 0.5 * e;
      p.body.alpha = 1 - 0.68 * e;
      p.body.scale.set(1 - 0.2 * e, 1 - 0.45 * e);
      p.body.y = this.cell * 0.12 * e;
      p.hurt.alpha = t < 0.3 ? 0.8 * (1 - t / 0.3) : 0;
    }).then(finish);
  }

  private standUp(p: Pawn) {
    p.dead = false;
    p.body.rotation = 0;
    p.body.alpha = 1;
    p.body.scale.set(1);
    p.body.y = 0;
  }

  fall(id: string): Promise<void> {
    const p = this.pawns.get(id);
    if (!p || p.dead) return Promise.resolve();
    return this.layDown(p, false);
  }

  setHp(id: string, hp: number) {
    const p = this.pawns.get(id);
    if (!p) return;
    p.token = { ...p.token, hp };
    this.drawPawn(p);
  }

  pawnCell(id: string): Cell | null {
    return this.pawns.get(id)?.cell ?? null;
  }
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
