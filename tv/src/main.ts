import "./styles.css";
import { Application, Container } from "pixi.js";
import {
  mountChargen,
  type ChargenCatalog,
} from "./chargen-ui";
import { ART, sceneForNode } from "./scenes";
import { renderPcSheet, type PcSheet } from "./pc-sheet";
import { enqueueDice, onDiceCue } from "./dice-tray";
import { audio, normalizeScene, sceneLabel, type RoomScene } from "./audio";
import {
  cellAtPoint,
  mountCombatBoard,
  renderCombatBoard,
  resetCombatBoard,
} from "./combat-board";
import { puzzleKindForNode, renderInteractivePuzzle } from "./puzzles";
import {
  DUNGEON_ROOMS,
  cropStyle,
  roomForNode,
  type DungeonRoomId,
} from "./dungeon-map";

type Pregen = {
  id: string;
  name: string;
  summary: string;
  class: string;
  level: number;
  custom?: boolean;
};
type RoomState = {
  roomCode: string;
  nodeId: string;
  nodeType: string;
  narration?: string;
  choices?: Array<{ id: string; label: string }>;
  skillCheck?: { ability: string; skill?: string; dc: number };
  puzzle?: {
    kind: string;
    picked: string[];
    need: number;
    fails: number;
    feedback?: string;
  } | null;
  flags?: string[];
  visitedRooms?: DungeonRoomId[];
  currentRoom?: DungeonRoomId | null;
  mapTokens?: Array<{
    playerId: string;
    name: string;
    room: DungeonRoomId;
    x: number;
    y: number;
  }>;
  players?: Array<{ playerId: string; characterName: string; characterId: string }>;
  lastDice?: {
    id?: string;
    roller: string;
    notation: string;
    values: number[];
    total: number;
    purpose?: string;
    label?: string;
    modifier?: number;
    sides?: number[];
    isCrit?: boolean;
    isFumble?: boolean;
  };
  lastDiceBatch?: Array<{
    id: string;
    roller: string;
    notation: string;
    values: number[];
    total: number;
    purpose?: string;
    label?: string;
    modifier?: number;
    sides?: number[];
    isCrit?: boolean;
    isFumble?: boolean;
  }> | null;
  combat?: CombatPublic | null;
  localPlayerId?: string | null;
  saveId?: string | null;
  alexaScene?: string;
};

type CombatPublic = {
  width: number;
  height: number;
  walls: boolean[][];
  mapId?: string;
  tokens: Array<{
    id: string;
    kind: string;
    name: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    dead: boolean;
    playerId?: string;
    hasAction?: boolean;
    hasBonusAction?: boolean;
    movementLeft?: number;
  }>;
  currentTokenId?: string;
  currentName?: string;
  reachable: Array<{ x: number; y: number }>;
  log: string[];
  status: string;
  actions: Array<{
    id: string;
    name: string;
    actionType: string;
    economy?: string;
    needsTarget?: boolean;
    guided?: boolean;
    available?: boolean;
  }>;
  actionMenu?: {
    movement: { left: number; speed: number; hint: string };
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
      available?: boolean;
    }>;
    flags: {
      dodging: boolean;
      disengaging: boolean;
      hidden: boolean;
      hasAction: boolean;
      hasBonusAction: boolean;
    };
  } | null;
  sheet?: PcSheet | null;
};

type PageId = "home" | "lobby" | "story" | "combat";

const appRoot = document.querySelector("#app")!;
appRoot.innerHTML = `
  <div class="stage-bg tone-warm" id="stageBg"></div>
  <div class="grain" aria-hidden="true"></div>
  <div class="letterbox top" aria-hidden="true"></div>
  <div class="letterbox bottom" aria-hidden="true"></div>
  <div id="turnBanner" class="turn-banner" hidden>Turn</div>
  <div class="shell">
    <header class="topbar">
      <div class="brand-mark">D20 FireVerse <span>· Luppolandia</span></div>
      <div class="party-rail" id="partyRail"></div>
      <div class="house-light" id="houseLight" data-scene="tavern">
        <span class="lamp" aria-hidden="true"></span>
        <span>
          <span class="house-kicker">Room light</span>
          <strong id="houseScene">Tavern</strong>
        </span>
      </div>
      <div class="conn" id="conn">Connecting…</div>
    </header>

    <section class="page page-home active" id="pageHome">
      <div class="home-hero">
        <p class="home-kicker">Luppolandia · one-shot</p>
        <h1 class="home-title">A Very<br />Potent Brew</h1>
        <p class="home-lead">
          The television is the table. No one deals the story. A remote, a room
          code, and whatever is still breathing under the brewery.
        </p>
        <div class="home-cta">
          <button class="primary" type="button" id="btnEnter">Enter the tavern</button>
          <button class="ghost" type="button" id="btnHomeResume">Resume a save</button>
        </div>
        <p class="home-hint">Arrows move · Enter confirms · 1–9 choose a line</p>
      </div>
    </section>

    <section class="page page-lobby" id="pageLobby">
      <div class="glass fade-in">
        <h2>Gather the party</h2>
        <p class="lede">Create a room, pick a hero — or forge one from the SRD (levels 1–3).</p>
        <div class="row">
          <button class="primary" id="btnCreate" type="button">Create room</button>
          <input id="joinCode" maxlength="6" placeholder="Room code" style="text-transform:uppercase;width:7rem" />
          <input id="displayName" placeholder="Display name" style="width:9rem" />
        </div>
        <div class="row">
          <label class="meta"><input type="checkbox" id="tts" checked /> Narration voice</label>
          <button type="button" id="btnBackHome">← Home</button>
        </div>
        <div class="pregens" id="pregens"></div>
        <div class="row" style="margin-top:0.75rem">
          <button class="primary" id="btnJoin" type="button">Join with selected character</button>
        </div>
        <div class="row" style="margin-top:0.35rem">
          <input id="saveId" placeholder="save id" style="width:10rem" />
          <button type="button" id="btnResume">Resume</button>
        </div>
      </div>
      <div class="glass fade-in" id="chargenHost"></div>
    </section>

    <section class="page page-story" id="pageStory">
      <div class="story-frame">
        <p class="story-chapter" id="storyChapter"></p>
        <h1 class="story-title" id="storyTitle"></h1>
        <div class="story-narration" id="narration"></div>
        <div class="story-dice" id="dice"></div>
        <div id="dungeonMapWrap" class="dungeon-map-wrap" hidden>
          <img id="dungeonMap" src="/art/dungeon-map.jpg" alt="Brewery dungeon map" />
          <div class="fog-mask" id="fogMask"></div>
          <div id="mapTokens" class="map-tokens"></div>
        </div>
        <p class="map-caption" id="mapCaption" hidden></p>
        <div id="puzzleHost"></div>
        <div class="choices" id="choices"></div>
        <div class="story-meta-bar">
          <span id="roomMeta"></span>
          <button type="button" id="btnSave">Save progress</button>
        </div>
      </div>
    </section>

    <section class="page page-combat" id="pageCombat">
      <div class="combat-head">
        <div>
          <p class="story-chapter" id="combatChapter" style="margin:0"></p>
          <h2 id="combatTitle">Combat</h2>
        </div>
        <div class="meta" id="turnMeta"></div>
      </div>
      <div class="combat-grid">
        <div>
          <div id="pixi-host" tabindex="0"></div>
          <p class="meta" id="combatHint"></p>
        </div>
        <div class="glass pcsheet-rail">
          <div id="pcSheetHost"></div>
          <div class="log" id="combatLog"></div>
          <div class="row" style="margin-top:0.55rem">
            <button type="button" id="btnSaveCombat">Save</button>
            <button type="button" id="btnRetreat" hidden>Step back</button>
          </div>
        </div>
      </div>
    </section>
  </div>
  <p class="err" id="err"></p>
`;

const $ = (id: string) => document.getElementById(id)!;
const proto = location.protocol === "https:" ? "wss" : "ws";
const wsUrl = `${proto}://${location.host}/ws`;

let ws: WebSocket;
let pregens: Pregen[] = [];
let selected: string | null = null;
let state: RoomState | null = null;
let playerId: string | null = null;
let cursor = { x: 1, y: 1 };
let mode: "move" | "attack" = "move";
let pendingAbility: {
  id: string;
  needsTarget: boolean;
  economy: string;
} | null = null;
let lastSpoken = "";
let currentPage: PageId = "home";
let chargenApi: ReturnType<typeof mountChargen> | null = null;
let wasCombat = false;
let lastTurnId = "";
let turnTimer = 0;

let pixi: Application | null = null;
let gridLayer: Container | null = null;

function err(m = "", kind: "bad" | "ok" = "bad") {
  const el = $("err");
  el.textContent = m;
  el.classList.toggle("ok", kind === "ok" && m.length > 0);
}
function send(obj: unknown) {
  if (ws.readyState !== WebSocket.OPEN) {
    err("Table is still connecting");
    return;
  }
  ws.send(JSON.stringify(obj));
  const action = (obj as { action?: string }).action;
  if (
    action === "CHOOSE" ||
    action === "PROPOSE_MOVE" ||
    action === "PERFORM_ACTION" ||
    action === "END_TURN" ||
    action === "JOIN_ROOM" ||
    action === "CREATE_ROOM"
  ) {
    audio.confirm();
  }
}

function setBackground(art: string, tone: string) {
  const bg = $("stageBg");
  bg.style.backgroundImage = `url(${art})`;
  bg.className = `stage-bg tone-${tone}`;
}

function setHouse(raw: string | undefined, fallback: RoomScene) {
  const scene = normalizeScene(raw, fallback);
  const el = $("houseLight");
  el.dataset.scene = scene;
  $("houseScene").textContent = sceneLabel(scene);
  document.body.dataset.room = scene;
  audio.setScene(scene);
}

function renderParty() {
  const rail = $("partyRail");
  const players = state?.players ?? [];
  if (!players.length) {
    rail.innerHTML = "";
    return;
  }
  const tokens = state?.combat?.tokens ?? [];
  rail.innerHTML = players
    .map((p) => {
      const token = tokens.find((t) => t.playerId === p.playerId);
      const mine = p.playerId === playerId;
      const active = !!(token && state?.combat?.currentTokenId === token.id);
      const detail = token
        ? `${mine ? `${p.playerId} · ` : ""}${token.hp}/${token.maxHp}`
        : mine
          ? p.playerId
          : "at the table";
      return `<div class="seat ${mine ? "mine" : ""} ${active ? "active" : ""}">
        <span class="seat-mark">${p.characterName.slice(0, 1)}</span>
        <span class="seat-copy"><strong>${p.characterName.split(" ")[0]}</strong><em>${detail}</em></span>
      </div>`;
    })
    .join("");
}

function slamTurn(name: string) {
  const el = $("turnBanner");
  window.clearTimeout(turnTimer);
  el.hidden = false;
  el.textContent = `${name}'s turn`;
  el.classList.remove("slam");
  void el.offsetWidth;
  el.classList.add("slam");
  audio.turn();
  turnTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 1400);
}

function moveFocus(dir: 1 | -1, rootSel: string) {
  const root = document.querySelector(rootSel);
  if (!root) return;
  const nodes = [
    ...root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"),
  ].filter((el) => el.offsetParent !== null);
  if (!nodes.length) return;
  const i = nodes.indexOf(document.activeElement as HTMLElement);
  const base = i < 0 ? (dir === 1 ? -1 : 0) : i;
  nodes[(base + dir + nodes.length) % nodes.length]?.focus();
}

function showPage(page: PageId) {
  currentPage = page;
  document.body.classList.toggle("cinematic", page === "story" || page === "combat");
  for (const id of ["pageHome", "pageLobby", "pageStory", "pageCombat"]) {
    $(id).classList.remove("active");
  }
  const map: Record<PageId, string> = {
    home: "pageHome",
    lobby: "pageLobby",
    story: "pageStory",
    combat: "pageCombat",
  };
  $(map[page]).classList.add("active");

  if (page === "home") setBackground(ART.home, "warm");
  if (page === "lobby") setBackground(ART.lobby, "warm");
  if (page === "lobby" && !chargenApi) {
    /* wait for HELLO */
  }
}

function speak(text: string) {
  if (!($("tts") as HTMLInputElement).checked) return;
  if (!text || text === lastSpoken) return;
  lastSpoken = text;
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 1.02;
  window.speechSynthesis.speak(u);
}

function connect() {
  ws = new WebSocket(wsUrl);
  ws.addEventListener("open", () => {
    $("conn").textContent = "Live · local table";
    $("conn").classList.remove("bad");
  });
  ws.addEventListener("close", () => {
    $("conn").textContent = "Disconnected — retrying…";
    $("conn").classList.add("bad");
    setTimeout(connect, 1500);
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.eventType === "HELLO") {
      pregens = msg.payload.pregens || [];
      renderPregens();
      const catalog = msg.payload.chargen as ChargenCatalog | undefined;
      if (catalog && !chargenApi) {
        chargenApi = mountChargen({
          root: $("chargenHost"),
          catalog,
          send,
          onCreated: (id) => {
            selected = id;
          },
        });
      } else if (catalog && chargenApi) {
        chargenApi.refresh(catalog);
      }
    }
    if (msg.eventType === "CHARACTER_CREATED") {
      pregens = msg.payload.pregens || [];
      renderPregens();
      const id = msg.payload.character?.id;
      if (id) {
        selected = id;
        const radio = document.querySelector(
          `input[name="pregen"][value="${id}"]`,
        ) as HTMLInputElement | null;
        if (radio) radio.checked = true;
        err(
          `Forged ${msg.payload.character.name} — Join to enter the brewery`,
          "ok",
        );
      }
      chargenApi?.onCreatedClose();
    }
    if (msg.eventType === "ABILITY_ROLLS") {
      chargenApi?.applyRolls(msg.payload.scores || []);
    }
    if (msg.eventType === "ROOM_STATE") {
      state = msg.payload;
      if (state?.localPlayerId) playerId = state.localPlayerId;
      if (state?.lastDiceBatch?.length) enqueueDice(state.lastDiceBatch);
      else if (state?.lastDice?.id) {
        enqueueDice({ ...state.lastDice, id: state.lastDice.id });
      }
      renderGame();
    }
    if (msg.eventType === "SAVE_ACK") {
      err(`Saved as ${msg.payload.saveId}`);
      ($("saveId") as HTMLInputElement).value = msg.payload.saveId;
    }
    if (msg.eventType === "ERROR") err(msg.payload?.code || "Error");
  });
}

function renderPregens() {
  $("pregens").innerHTML = pregens
    .map(
      (p) => `
    <label>
      <input type="radio" name="pregen" value="${p.id}" ${
        selected === p.id || (!selected && p.id === pregens[0]?.id) ? "checked" : ""
      } />
      <span><strong>${p.name}</strong> — ${p.class} ${p.level}${
        p.custom ? " · custom" : ""
      }<br/><span class="meta">${p.summary}</span></span>
    </label>`,
    )
    .join("");
  if (!selected) selected = pregens[0]?.id ?? null;
  $("pregens").onchange = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "pregen") selected = t.value;
  };
}

async function ensurePixi() {
  if (pixi) return;
  pixi = new Application();
  await pixi.init({
    background: "#15100c",
    backgroundAlpha: 0.72,
    resizeTo: $("pixi-host"),
    antialias: false,
  });
  $("pixi-host").appendChild(pixi.canvas);
  gridLayer = new Container();
  pixi.stage.addChild(gridLayer);
  pixi.canvas.addEventListener("pointerdown", (ev) => {
    const combat = state?.combat;
    if (!combat || !pixi) return;
    const rect = pixi.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const hit = cellAtPoint(
      pixi.screen.width,
      pixi.screen.height,
      combat.width,
      combat.height,
      ((ev.clientX - rect.left) * pixi.screen.width) / rect.width,
      ((ev.clientY - rect.top) * pixi.screen.height) / rect.height,
    );
    if (!hit) return;
    cursor = hit;
    void drawCombat().then(() => confirmCell());
  });
}

function myToken() {
  return state?.combat?.tokens.find((t) => t.playerId === playerId);
}
function isMyTurn() {
  const c = state?.combat;
  if (!c) return false;
  const cur = c.tokens.find((t) => t.id === c.currentTokenId);
  return !!(cur && cur.playerId === playerId);
}
function enemyAt(x: number, y: number) {
  return state?.combat?.tokens.find(
    (t) => !t.dead && t.kind === "enemy" && t.x === x && t.y === y,
  );
}
async function drawCombat() {
  const c = state?.combat;
  if (!c || !state) return;
  await ensurePixi();
  if (!gridLayer || !pixi) return;
  mountCombatBoard(pixi, gridLayer);
  const me = myToken();
  const hit = renderCombatBoard({
    nodeId: state.nodeId,
    viewWidth: pixi.screen.width,
    viewHeight: pixi.screen.height,
    width: c.width,
    height: c.height,
    walls: c.walls,
    tokens: c.tokens,
    currentTokenId: c.currentTokenId,
    reachable: c.reachable || [],
    cursor,
    mode,
    isMyTurn: isMyTurn(),
    showMelee: !!me?.hasAction,
    playerId,
  });
  if (hit.damaged) audio.hit();

  $("combatLog").textContent = (c.log || []).join("\n");
  const fightRoom = roomForNode(state.nodeId) ?? "mosaic";
  const waitingName = c.currentName || "another hero";
  $("combatHint").textContent = !isMyTurn()
    ? `Hold — ${waitingName} is acting`
    : pendingAbility?.needsTarget
      ? `Aim ${pendingAbility.id.replaceAll("_", " ")} · click the foe or press Enter`
      : !me?.hasAction && !me?.hasBonusAction
        ? "Economy spent — End Turn"
        : "Click a lit cell to step · click a red cell to strike · arrows still aim";

  const flags = c.actionMenu?.flags;
  $("turnMeta").textContent =
    `${DUNGEON_ROOMS[fightRoom].label} · ${c.currentName} · ${c.status}` +
    (isMyTurn()
      ? ` · move ${me?.movementLeft ?? 0}` +
        ` · Act ${flags?.hasAction ? "●" : "○"}` +
        ` · Bonus ${flags?.hasBonusAction ? "●" : "○"}`
      : "");

  // Room crop of the oneshot map behind the fight grid
  const host = $("pixi-host");
  const crop = cropStyle(DUNGEON_ROOMS[fightRoom]);
  host.style.backgroundImage = "url(/art/dungeon-map.jpg)";
  host.style.backgroundRepeat = "no-repeat";
  host.style.backgroundSize = crop.size;
  host.style.backgroundPosition = crop.position;

  renderPcSheet($("pcSheetHost"), {
    sheet: c.sheet ?? null,
    isMyTurn: isMyTurn(),
    pendingId: pendingAbility?.id,
    onAction: (a) => {
      if (a.available === false) {
        err("Already used this turn");
        return;
      }
      if (a.needsTarget) {
        mode = "attack";
        pendingAbility = {
          id: a.id,
          needsTarget: true,
          economy: a.economy,
        };
        err(`Click a target for ${a.name}`);
        void drawCombat();
        return;
      }
      send({
        action: "PERFORM_ACTION",
        roomCode: state!.roomCode,
        playerId,
        abilityId: a.id,
      });
      pendingAbility = null;
      mode = "move";
    },
    onEndTurn: () => {
      mode = "move";
      pendingAbility = null;
      send({ action: "END_TURN", roomCode: state!.roomCode, playerId });
    },
  });
}

function tryAttack(enemy: { id: string }) {
  const me = myToken() as
    | { hasAction?: boolean; hasBonusAction?: boolean }
    | undefined;
  const abilityId =
    pendingAbility?.id ||
    state?.combat?.actionMenu?.actions?.find((a) => a.guided)?.id ||
    state?.combat?.actions?.find((a) => a.guided)?.id ||
    state?.combat?.actionMenu?.actions?.find((a) => a.id.includes("attack"))
      ?.id ||
    state?.combat?.actions?.find(
      (a) => a.actionType === "action" || a.economy === "action",
    )?.id;
  if (!abilityId) return;
  const meta =
    state?.combat?.actions?.find((a) => a.id === abilityId) ||
    state?.combat?.actionMenu?.actions?.find((a) => a.id === abilityId) ||
    state?.combat?.actionMenu?.bonusActions?.find((a) => a.id === abilityId);
  if (meta?.economy === "bonus_action" && me && me.hasBonusAction === false) {
    err("Bonus already used — End Turn from your sheet");
    return;
  }
  if (meta?.economy !== "bonus_action" && me && me.hasAction === false) {
    err("Action already used — open sheet and End Turn");
    return;
  }
  send({
    action: "PERFORM_ACTION",
    roomCode: state!.roomCode,
    playerId,
    abilityId,
    targetId: enemy.id,
  });
  mode = "move";
  pendingAbility = null;
}

function confirmCell() {
  if (!state?.combat || !isMyTurn()) return;
  if (pendingAbility?.id === "std_help") {
    const ally = state.combat.tokens.find(
      (t) => !t.dead && t.kind === "pc" && t.x === cursor.x && t.y === cursor.y,
    );
    if (!ally) {
      err("Help needs an adjacent ally cell");
      return;
    }
    send({
      action: "PERFORM_ACTION",
      roomCode: state.roomCode,
      playerId,
      abilityId: "std_help",
      targetId: ally.id,
    });
    pendingAbility = null;
    mode = "move";
    return;
  }
  const enemy = enemyAt(cursor.x, cursor.y);
  if (enemy) {
    tryAttack(enemy);
    return;
  }
  if (mode === "attack" || pendingAbility?.needsTarget) {
    err("No valid target here");
    return;
  }
  const ok = (state.combat.reachable || []).some(
    (c) => c.x === cursor.x && c.y === cursor.y,
  );
  if (!ok) {
    err("Unreachable");
    return;
  }
  send({
    action: "PROPOSE_MOVE",
    roomCode: state.roomCode,
    playerId,
    x: cursor.x,
    y: cursor.y,
  });
}

function renderGame() {
  if (!state) return;

  const scene = sceneForNode(state.nodeId);
  const roomScene: RoomScene = state.combat
    ? /spider|magma/i.test(scene.title)
      ? "boss"
      : "combat"
    : normalizeScene(state.alexaScene, scene.tone === "victory" ? "victory" : scene.tone === "warm" ? "tavern" : "explore");
  setHouse(state.combat ? roomScene : state.alexaScene, roomScene);
  renderParty();
  const seals = (state.flags || []).filter((f) =>
    ["seal_cellar", "seal_well", "seal_store"].includes(f),
  );
  const sealLabel = [
    seals.includes("seal_cellar") ? "Cellar" : null,
    seals.includes("seal_well") ? "Well" : null,
    seals.includes("seal_store") ? "Store" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  $("roomMeta").textContent =
    `Room ${state.roomCode}${playerId ? ` · seat ${playerId}` : ""} · ${(state.players || [])
      .map((p) => p.characterName)
      .join(", ") || "waiting"}` +
    (sealLabel ? ` · Seals: ${sealLabel}` : " · Seals: —");

  if (state.combat) {
    wasCombat = true;
    showPage("combat");
    setBackground(scene.art, scene.tone);
    $("combatChapter").textContent = scene.chapter;
    $("combatTitle").textContent = scene.title;
    const turnId = state.combat.currentTokenId ?? "";
    if (turnId && turnId !== lastTurnId) {
      lastTurnId = turnId;
      slamTurn(state.combat.currentName || "The table");
    }
    void drawCombat();
    const retreat = $("btnRetreat");
    retreat.hidden = state.combat.status === "active";
    retreat.onclick = () =>
      send({ action: "WITHDRAW", roomCode: state!.roomCode, playerId });
    $("pixi-host").focus();
    return;
  }

  if (wasCombat) {
    wasCombat = false;
    lastTurnId = "";
    resetCombatBoard();
  }

  if (state.nodeType === "encounter") {
    showPage("story");
    setBackground(scene.art, scene.tone);
    $("storyTitle").textContent = scene.title;
    $("narration").textContent =
      state.narration || "The fight did not start. Step back and try again.";
    const box = $("choices");
    box.innerHTML = "";
    const b = document.createElement("button");
    b.className = "primary";
    b.textContent = "Step back — the puzzle is still open";
    b.onclick = () =>
      send({ action: "WITHDRAW", roomCode: state!.roomCode, playerId });
    box.appendChild(b);
    return;
  }

  if (!state.players?.length) {
    showPage("lobby");
    setBackground(ART.lobby, "warm");
    err(`Room ${state.roomCode} ready — pick a character and Join`, "ok");
    ($("joinCode") as HTMLInputElement).value = state.roomCode;
    return;
  }

  showPage("story");
  setBackground(scene.art, scene.tone);
  $("storyChapter").textContent = scene.chapter;
  $("storyTitle").textContent = scene.title;

  const text = state.narration || "";
  const narration = $("narration");
  if (narration.textContent !== text) {
    narration.textContent = text;
    narration.classList.remove("line-in");
    void narration.offsetWidth;
    narration.classList.add("line-in");
  }
  speak(text);
  $("dice").textContent = state.lastDice
    ? `${state.lastDice.roller}: ${state.lastDice.notation} = ${state.lastDice.total}`
    : state.puzzle
      ? `Puzzle progress ${state.puzzle.picked.length}/${state.puzzle.need}${
          state.puzzle.fails ? ` · faults ${state.puzzle.fails}` : ""
        }`
      : "";

  const mapWrap = $("dungeonMapWrap");
  const area = state.currentRoom ?? roomForNode(state.nodeId);
  const showMap = !!area || (state.visitedRooms?.length ?? 0) > 0;
  mapWrap.hidden = !showMap || !area && !(state.visitedRooms?.length);
  if (showMap && (area || state.visitedRooms?.length)) {
    const visited = new Set(state.visitedRooms ?? []);
    const fog = $("fogMask");
    fog.innerHTML = (Object.keys(DUNGEON_ROOMS) as DungeonRoomId[])
      .map((id) => {
        const open = visited.has(id);
        const here = id === area;
        return `<div class="fog ${open ? "revealed" : ""} ${here ? "here" : ""}" data-room="${id}" data-label="${open ? DUNGEON_ROOMS[id].label : "???"}"></div>`;
      })
      .join("");
    const colors = ["#4a8fd4", "#e8c040", "#6a9f5a"];
    const tokens = $("mapTokens");
    tokens.innerHTML = (state.mapTokens ?? [])
      .filter((t) => visited.has(t.room))
      .map((t, i) => {
        const mine = t.playerId === playerId;
        return `<div class="pawn ${mine ? "mine" : ""}" style="left:${t.x}%;top:${t.y}%;--pawn:${colors[i % colors.length]}" title="${t.name}">
          <span class="pawn-disc">${t.name.slice(0, 1)}</span>
          <span class="pawn-name">${t.name.split(" ")[0]}</span>
        </div>`;
      })
      .join("");
    const img = $("dungeonMap") as HTMLImageElement;
    const caption = $("mapCaption");
    caption.hidden = false;
    caption.textContent = area
      ? `${DUNGEON_ROOMS[area].label} — click inside this room to move your pawn. Unvisited rooms stay dark.`
      : "Rooms you have entered stay open.";
    img.onclick = (ev) => {
      if (!area || !playerId) return;
      const rect = img.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 100;
      const y = ((ev.clientY - rect.top) / rect.height) * 100;
      const region = DUNGEON_ROOMS[area];
      const inside =
        x >= region.left &&
        x <= region.left + region.width &&
        y >= region.top &&
        y <= region.top + region.height;
      if (!inside) {
        err("You can only walk inside the room you are in.");
        return;
      }
      send({
        action: "MAP_MOVE",
        roomCode: state!.roomCode,
        playerId,
        mapX: x,
        mapY: y,
      });
    };
  }

  const box = $("choices");
  box.innerHTML = "";
  const puzzleHost = $("puzzleHost");
  puzzleHost.innerHTML = "";

  if (state.nodeType === "puzzle" || puzzleKindForNode(state.nodeId)) {
    const interactive = renderInteractivePuzzle(puzzleHost, {
      nodeId: state.nodeId,
      narration: text,
      progress: state.puzzle,
      roomCode: state.roomCode,
      send,
      onChoose: (choiceId) =>
        send({ action: "CHOOSE", roomCode: state!.roomCode, choiceId }),
    });
    if (!interactive) {
      (state.choices || []).forEach((ch) => {
        const b = document.createElement("button");
        b.textContent = ch.label;
        b.onclick = () =>
          send({ action: "CHOOSE", roomCode: state!.roomCode, choiceId: ch.id });
        box.appendChild(b);
      });
    }
    return;
  }
  if (state.nodeType === "skill_check") {
    const c = state.skillCheck!;
    const b = document.createElement("button");
    b.className = "primary guided";
    b.textContent = `Attempt ${c.skill || c.ability} (DC ${c.dc}) ★`;
    b.onclick = () =>
      send({
        action: "CHOOSE",
        roomCode: state!.roomCode,
        choiceId: "attempt",
      });
    box.appendChild(b);
    return;
  }
  if (state.nodeId === "END_SAVE" || state.nodeId === "END_WIN") {
    const b = document.createElement("button");
    b.className = "primary";
    b.textContent =
      state.nodeId === "END_WIN" ? "Return home" : "Save noted — return home";
    b.onclick = () => {
      state = null;
      showPage("home");
    };
    box.appendChild(b);
    return;
  }
  (state.choices || []).forEach((ch, i) => {
    const b = document.createElement("button");
    b.className = i === 0 ? "primary guided" : "";
    b.textContent = `${i + 1}. ${ch.label}${i === 0 ? " ★" : ""}`;
    b.onclick = () =>
      send({ action: "CHOOSE", roomCode: state!.roomCode, choiceId: ch.id });
    box.appendChild(b);
  });
}

window.addEventListener("keydown", (e) => {
  audio.unlock();
  if (currentPage === "home" && (e.key === "Enter" || e.key === "ArrowRight")) {
    e.preventDefault();
    ($("btnEnter") as HTMLButtonElement).click();
    return;
  }
  if (currentPage === "lobby" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    moveFocus(e.key === "ArrowDown" ? 1 : -1, "#pageLobby");
    return;
  }
  if (currentPage === "story" && !state?.combat) {
    if (e.key >= "1" && e.key <= "9" && state?.choices?.length) {
      const idx = Number(e.key) - 1;
      const ch = state.choices[idx];
      if (ch)
        send({ action: "CHOOSE", roomCode: state.roomCode, choiceId: ch.id });
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(e.key === "ArrowDown" ? 1 : -1, "#pageStory");
    }
    return;
  }
  if (currentPage !== "combat" || !state?.combat) return;
  const map: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (map[e.key]) {
    e.preventDefault();
    cursor.x += map[e.key][0];
    cursor.y += map[e.key][1];
    cursor.x = Math.max(0, Math.min((state.combat?.width ?? 1) - 1, cursor.x));
    cursor.y = Math.max(0, Math.min((state.combat?.height ?? 1) - 1, cursor.y));
    void drawCombat();
  } else if (e.key === "Enter") {
    e.preventDefault();
    confirmCell();
  } else if (e.key === "Escape") {
    mode = "move";
    pendingAbility = null;
    err();
    void drawCombat();
  }
});

$("btnEnter").onclick = () => {
  err();
  showPage("lobby");
};
$("btnBackHome").onclick = () => {
  err();
  showPage("home");
};
$("btnHomeResume").onclick = () => {
  showPage("lobby");
  ($("saveId") as HTMLInputElement).focus();
};
$("btnCreate").onclick = () => {
  err();
  send({ action: "CREATE_ROOM" });
};
$("btnJoin").onclick = () => {
  err();
  const roomCode = (
    ($("joinCode") as HTMLInputElement).value ||
    state?.roomCode ||
    ""
  ).toUpperCase();
  if (!roomCode || !selected) return err("Room code + character required");
  send({
    action: "JOIN_ROOM",
    roomCode,
    displayName: ($("displayName") as HTMLInputElement).value || "Player",
    characterId: selected,
  });
  ($("joinCode") as HTMLInputElement).value = roomCode;
};
function requestSave() {
  if (!state?.roomCode) return;
  send({ action: "REQUEST_SAVE", roomCode: state.roomCode });
}
$("btnSave").onclick = requestSave;
$("btnSaveCombat").onclick = requestSave;
$("btnResume").onclick = () => {
  const saveId = ($("saveId") as HTMLInputElement).value.trim();
  if (!saveId) return err("Need save id");
  send({ action: "RESUME_SAVE", saveId });
};

setBackground(ART.home, "warm");
setHouse("tavern", "tavern");
onDiceCue((roll) => {
  if (roll.isCrit) audio.fanfare();
  else if (roll.isFumble) audio.fumble();
  else audio.dice();
});
window.addEventListener("pointerdown", () => audio.unlock());
connect();
