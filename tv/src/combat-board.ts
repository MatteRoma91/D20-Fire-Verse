/** Tactical board drawn for a television, not a debug grid. */

import { Application, Container, Graphics, Text, type Ticker } from "pixi.js";

export type BoardToken = {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  playerId?: string;
};

type FloatLabel = { text: Text; life: number };

let world: Container | null = null;
let floorG: Graphics | null = null;
let pathG: Graphics | null = null;
let tokenLayer: Container | null = null;
let cursorG: Graphics | null = null;
let fxLayer: Container | null = null;
let mounted = false;
let pulse = 0;
let shake = 0;
let boardKey = "";
const lastHp = new Map<string, number>();
let floats: FloatLabel[] = [];

const PC_COLORS = [0x3e7eb8, 0xc9a24a, 0x4e8f55];

function wipe(layer: Container) {
  for (const child of layer.removeChildren()) child.destroy();
}

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function mountCombatBoard(app: Application, root: Container) {
  if (mounted) return;
  world = new Container();
  floorG = new Graphics();
  pathG = new Graphics();
  tokenLayer = new Container();
  cursorG = new Graphics();
  fxLayer = new Container();
  world.addChild(floorG, pathG, tokenLayer, cursorG, fxLayer);
  root.addChild(world);
  app.ticker.add((ticker: Ticker) => {
    pulse += ticker.deltaTime;
    if (!world || !cursorG) return;
    cursorG.alpha = 0.55 + Math.sin(pulse * 0.14) * 0.45;
    if (!reduceMotion() && shake > 0.25) {
      shake *= 0.84;
      world.x = (Math.random() - 0.5) * shake;
      world.y = (Math.random() - 0.5) * shake * 0.55;
    } else {
      shake = 0;
      world.x = 0;
      world.y = 0;
    }
    const next: FloatLabel[] = [];
    for (const f of floats) {
      f.life -= ticker.deltaTime;
      f.text.y -= 0.55 * ticker.deltaTime;
      f.text.alpha = Math.max(0, Math.min(1, f.life / 28));
      if (f.life <= 0) f.text.destroy();
      else next.push(f);
    }
    floats = next;
  });
  mounted = true;
}

export function resetCombatBoard() {
  boardKey = "";
  lastHp.clear();
  shake = 0;
  if (floorG) floorG.clear();
  if (pathG) pathG.clear();
  if (cursorG) cursorG.clear();
  if (tokenLayer) wipe(tokenLayer);
  for (const f of floats) f.text.destroy();
  floats = [];
  if (world) {
    world.x = 0;
    world.y = 0;
  }
}

function cellCenter(
  x: number,
  y: number,
  ox: number,
  oy: number,
  cell: number,
) {
  return { cx: ox + x * cell + cell / 2, cy: oy + y * cell + cell / 2 };
}

function spawnFloat(
  x: number,
  y: number,
  label: string,
  color: number,
) {
  if (!fxLayer) return;
  const text = new Text({
    text: label,
    style: {
      fontFamily: "Georgia, serif",
      fontSize: 18,
      fill: color,
      fontWeight: "700",
    },
  });
  text.anchor.set(0.5);
  text.x = x;
  text.y = y;
  fxLayer.addChild(text);
  floats.push({ text, life: 46 });
}

function greedyPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  open: Set<string>,
) {
  const pts = [from];
  let x = from.x;
  let y = from.y;
  const seen = new Set<string>([`${x},${y}`]);
  for (let step = 0; step < 48; step += 1) {
    if (x === to.x && y === to.y) break;
    const options: Array<[number, number]> = [
      [Math.sign(to.x - x), Math.sign(to.y - y)],
      [Math.sign(to.x - x), 0],
      [0, Math.sign(to.y - y)],
      [Math.sign(to.y - y), Math.sign(to.x - x)],
    ];
    let moved = false;
    for (const [dx, dy] of options) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (!open.has(key) || seen.has(key)) continue;
      x = nx;
      y = ny;
      seen.add(key);
      pts.push({ x, y });
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return pts;
}

function brackets(g: Graphics, x: number, y: number, size: number) {
  const arm = Math.max(6, size * 0.28);
  const corners: Array<[number, number, number, number]> = [
    [x + 3, y + 3, 1, 1],
    [x + size - 3, y + 3, -1, 1],
    [x + 3, y + size - 3, 1, -1],
    [x + size - 3, y + size - 3, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    g.moveTo(cx, cy + dy * arm);
    g.lineTo(cx, cy);
    g.lineTo(cx + dx * arm, cy);
  }
  g.stroke({ width: 2, color: 0xf0c090 });
}

export function cellAtPoint(
  viewWidth: number,
  viewHeight: number,
  cols: number,
  rows: number,
  px: number,
  py: number,
): { x: number; y: number } | null {
  if (cols < 1 || rows < 1) return null;
  const cell = Math.min(
    Math.floor((viewWidth - 16) / cols),
    Math.floor((viewHeight - 16) / rows),
    56,
  );
  if (cell < 1) return null;
  const ox = Math.floor((viewWidth - cols * cell) / 2);
  const oy = Math.floor((viewHeight - rows * cell) / 2);
  const x = Math.floor((px - ox) / cell);
  const y = Math.floor((py - oy) / cell);
  if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
  return { x, y };
}

export function renderCombatBoard(opts: {
  nodeId: string;
  viewWidth: number;
  viewHeight: number;
  width: number;
  height: number;
  walls: boolean[][];
  tokens: BoardToken[];
  currentTokenId?: string;
  reachable: Array<{ x: number; y: number }>;
  cursor: { x: number; y: number };
  mode: "move" | "attack";
  isMyTurn: boolean;
  showMelee: boolean;
  playerId: string | null;
}): { damaged: boolean; healed: boolean } {
  if (!floorG || !pathG || !tokenLayer || !cursorG) {
    return { damaged: false, healed: false };
  }
  if (opts.nodeId !== boardKey) {
    boardKey = opts.nodeId;
    lastHp.clear();
    for (const f of floats) f.text.destroy();
    floats = [];
  }

  const cols = opts.width;
  const rows = opts.height;
  const cell = Math.min(
    Math.floor((opts.viewWidth - 16) / cols),
    Math.floor((opts.viewHeight - 16) / rows),
    56,
  );
  const ox = Math.floor((opts.viewWidth - cols * cell) / 2);
  const oy = Math.floor((opts.viewHeight - rows * cell) / 2);

  floorG.clear();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const wall = !!opts.walls[y]?.[x];
      const px = ox + x * cell;
      const py = oy + y * cell;
      if (wall) {
        floorG.roundRect(px + 2, py + 3, cell - 4, cell - 8, 3);
        floorG.fill({ color: 0x100c0a, alpha: 0.92 });
        floorG.rect(px + 4, py + 5, cell - 8, 3);
        floorG.fill({ color: 0x4a3a30, alpha: 0.85 });
      } else {
        floorG.roundRect(px + 1, py + 1, cell - 2, cell - 2, 3);
        floorG.fill({
          color: (x + y) % 2 === 0 ? 0x2a2118 : 0x231910,
          alpha: 0.55,
        });
      }
    }
  }

  const open = new Set(opts.reachable.map((c) => `${c.x},${c.y}`));
  if (opts.isMyTurn && opts.mode === "move") {
    for (const r of opts.reachable) {
      floorG.roundRect(
        ox + r.x * cell + 4,
        oy + r.y * cell + 4,
        cell - 8,
        cell - 8,
        3,
      );
      floorG.fill({ color: 0xf0c060, alpha: 0.5 });
    }
  }

  const me = opts.tokens.find(
    (t) => !t.dead && t.playerId && t.playerId === opts.playerId,
  );
  if (opts.isMyTurn && opts.showMelee && me) {
    for (const t of opts.tokens) {
      if (t.dead || t.kind !== "enemy") continue;
      const near =
        Math.max(Math.abs(me.x - t.x), Math.abs(me.y - t.y)) <= 1;
      if (!near) continue;
      floorG.roundRect(
        ox + t.x * cell + 3,
        oy + t.y * cell + 3,
        cell - 6,
        cell - 6,
        3,
      );
      floorG.fill({ color: 0xa32020, alpha: 0.38 });
    }
  }

  pathG.clear();
  if (
    opts.isMyTurn &&
    opts.mode === "move" &&
    me &&
    open.has(`${opts.cursor.x},${opts.cursor.y}`)
  ) {
    open.add(`${me.x},${me.y}`);
    const pts = greedyPath(me, opts.cursor, open);
    if (pts.length > 1) {
      const start = cellCenter(pts[0].x, pts[0].y, ox, oy, cell);
      pathG.moveTo(start.cx, start.cy);
      for (const p of pts.slice(1)) {
        const c = cellCenter(p.x, p.y, ox, oy, cell);
        pathG.lineTo(c.cx, c.cy);
      }
      pathG.stroke({ width: 3, color: 0xf0c090, alpha: 0.9 });
    }
  }

  wipe(tokenLayer);
  let damaged = false;
  let healed = false;
  let pcIndex = 0;
  for (const t of opts.tokens) {
    const prev = lastHp.get(t.id);
    const hpNow = t.dead ? 0 : t.hp;
    if (prev !== undefined && hpNow < prev) {
      damaged = true;
      const c = cellCenter(t.x, t.y, ox, oy, cell);
      spawnFloat(c.cx, c.cy - cell * 0.2, `−${prev - hpNow}`, 0xffb4a2);
      if (!reduceMotion()) shake = Math.max(shake, 7);
    } else if (prev !== undefined && hpNow > prev) {
      healed = true;
      const c = cellCenter(t.x, t.y, ox, oy, cell);
      spawnFloat(c.cx, c.cy - cell * 0.2, `+${hpNow - prev}`, 0xb7e0a8);
    }
    lastHp.set(t.id, hpNow);
    if (t.dead) continue;

    const boss = /spider|magma/i.test(t.name);
    const radius = cell * (boss ? 0.34 : 0.28);
    const { cx, cy } = cellCenter(t.x, t.y, ox, oy, cell);
    const color =
      t.kind === "pc"
        ? PC_COLORS[pcIndex++ % PC_COLORS.length]
        : boss
          ? 0x9a2418
          : 0x7a3030;
    const g = new Graphics();
    g.ellipse(cx, cy + radius * 1.05, radius * 0.9, radius * 0.28);
    g.fill({ color: 0x000000, alpha: 0.45 });
    g.roundRect(cx - radius * 0.62, cy - radius * 0.15, radius * 1.24, radius * 1.2, 5);
    g.fill(color);
    g.circle(cx, cy - radius * 0.72, radius * 0.5);
    g.fill(color);
    g.roundRect(cx - radius * 0.62, cy - radius * 0.15, radius * 1.24, radius * 1.2, 5);
    g.stroke({
      width: t.id === opts.currentTokenId ? 3 : 2,
      color: t.id === opts.currentTokenId ? 0xf0c090 : 0xf4e8d4,
    });
    g.circle(cx, cy - radius * 0.72, radius * 0.5);
    g.stroke({
      width: 2,
      color: t.id === opts.currentTokenId ? 0xf0c090 : 0xf4e8d4,
    });
    if (t.playerId && t.playerId === opts.playerId) {
      g.circle(cx, cy - radius * 0.15, radius + 5);
      g.stroke({ width: 2, color: 0xe8c040, alpha: 0.95 });
    }
    const ratio = t.maxHp > 0 ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 0;
    const barW = cell * 0.72;
    const barY = cy + radius * 1.35;
    g.roundRect(cx - barW / 2, barY, barW, 5, 2);
    g.fill({ color: 0x140e0a, alpha: 0.9 });
    g.roundRect(cx - barW / 2, barY, Math.max(2, barW * ratio), 5, 2);
    g.fill({
      color: ratio > 0.5 ? 0x6a9f5a : ratio > 0.25 ? 0xe8c040 : 0xc4483c,
    });
    tokenLayer.addChild(g);

    const name = new Text({
      text: t.name.split(" ")[0].slice(0, 8),
      style: {
        fontFamily: "Georgia, serif",
        fontSize: Math.max(10, cell * 0.2),
        fill: 0xf4e8d4,
      },
    });
    name.anchor.set(0.5, 0);
    name.x = cx;
    name.y = barY + 7;
    tokenLayer.addChild(name);

    const mark = new Text({
      text: t.name.slice(0, 1).toUpperCase(),
      style: {
        fontFamily: "Georgia, serif",
        fontSize: Math.max(12, radius * 0.95),
        fill: 0x1a120c,
        fontWeight: "700",
      },
    });
    mark.anchor.set(0.5);
    mark.x = cx;
    mark.y = cy - radius * 0.72;
    tokenLayer.addChild(mark);
  }

  cursorG.clear();
  const cx0 = ox + opts.cursor.x * cell;
  const cy0 = oy + opts.cursor.y * cell;
  brackets(cursorG, cx0, cy0, cell);

  return { damaged, healed };
}
