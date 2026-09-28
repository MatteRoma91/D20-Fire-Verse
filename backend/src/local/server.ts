import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { loadCampaign, listPregens, getManifest, portraitForCharacter, PORTRAITS, portraitUrl } from "./campaign.js";
import {
  createCustomCharacter,
  getChargenCatalog,
  loadChargen,
  rollAbilityScores,
  type ChargenDraft,
} from "./chargen.js";
import { ensureDataDir, REPO_ROOT } from "./paths.js";
import { audioPath, narrationStatus, prewarmNarration, waitForNarration } from "./narration.js";
import {
  choose,
  combatAttack,
  combatEndTurn,
  mapMove,
  combatMove,
  withdraw,
  createRoom,
  getRoom,
  joinRoom,
  loadPersistedRooms,
  playerDisconnect,
  publicState,
  rejoinRoom,
  requestSave,
  resumeSave,
  retryCombat,
  scriptedLines,
  voiceIntent,
  solvePuzzleSequence,
  type Room,
} from "./room.js";

const PORT = Number(process.env.PORT || 3100);
const COMPANION_DEV_PORT = Number(process.env.COMPANION_PORT || 4319);
/** How long a dropped table keeps its turn before it Dodges and passes. */
const DROP_GRACE_MS = Number(process.env.DROP_GRACE_MS || 20000);

type ClientMsg = {
  action: string;
  roomCode?: string;
  displayName?: string;
  characterId?: string;
  choiceId?: string;
  playerId?: string;
  x?: number;
  y?: number;
  mapX?: number;
  mapY?: number;
  abilityId?: string;
  targetId?: string;
  saveId?: string;
  intent?: string;
  draft?: ChargenDraft;
  sequence?: string[];
};

ensureDataDir();
loadCampaign();
loadChargen();
loadPersistedRooms();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

const tvDist = path.join(REPO_ROOT, "tv", "dist");
const tvLocal = path.join(REPO_ROOT, "tv", "local");
const companionDist = path.join(REPO_ROOT, "companion", "dist");
const companionBuilt = fs.existsSync(path.join(companionDist, "index.html"));
app.use("/art", express.static(path.join(REPO_ROOT, "tv", "public", "art"), { maxAge: "7d" }));
if (companionBuilt) {
  app.use("/companion", express.static(companionDist));
}
if (fs.existsSync(path.join(tvDist, "index.html"))) {
  app.use(express.static(tvDist));
} else {
  app.use(express.static(tvLocal));
}

function pregenList() {
  return listPregens().map((p) => ({
    id: p.id,
    name: p.name,
    summary: p.summary,
    class: p.class,
    race: p.race ?? "",
    level: p.level,
    hp: p.hp,
    ac: p.ac,
    portrait: portraitForCharacter(p.id),
    custom: p.id.startsWith("custom_"),
  }));
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === "IPv4" && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "local",
    campaign: getManifest().id,
    combat: true,
    pixi: fs.existsSync(path.join(tvDist, "index.html")),
    narration: narrationStatus(),
    aws: false,
  });
});

/** Where a phone on the same Wi-Fi can reach the companion (for the join QR code). */
app.get("/api/table-info", (req, res) => {
  const hosts = lanAddresses();
  const requestHost = String(req.headers.host ?? "").split(":")[0];
  const host = hosts[0] ?? requestHost ?? "127.0.0.1";
  const port = companionBuilt ? PORT : COMPANION_DEV_PORT;
  res.json({
    hosts,
    companionUrl: `http://${host}:${port}/companion/`,
  });
});

app.get("/api/pregens", (_req, res) => {
  res.json(pregenList());
});

app.get("/api/portraits", (_req, res) => {
  res.json(PORTRAITS.map((id) => ({ id, url: portraitUrl(id) })));
});

app.get("/api/chargen", (_req, res) => {
  res.json(getChargenCatalog());
});

app.post("/api/chargen", (req, res) => {
  try {
    const built = createCustomCharacter(req.body as ChargenDraft);
    res.json(built);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "ERROR",
    });
  }
});

app.post("/api/chargen/roll", (_req, res) => {
  res.json({ scores: rollAbilityScores() });
});

app.get("/api/room/:code", (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) {
    res.status(404).json({ error: "ROOM_NOT_FOUND" });
    return;
  }
  res.json(publicState(room));
});

/** Timings for a narrated line; waits for the narrator if it is still speaking it into the cache. */
app.get("/api/narration/:key/meta", async (req, res) => {
  const key = req.params.key;
  if (!/^[a-f0-9]{20}$/.test(key)) {
    res.status(400).json({ error: "BAD_KEY" });
    return;
  }
  const clip = await waitForNarration(key, 25000);
  if (!clip) {
    res.status(404).json({ error: "NARRATION_UNAVAILABLE" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.json(clip);
});

app.get("/api/narration/:file", (req, res) => {
  const m = req.params.file.match(/^([a-f0-9]{20})\.(m4a|wav)$/);
  const file = m ? audioPath(m[1]) : null;
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.type(file.endsWith(".m4a") ? "audio/mp4" : "audio/wav");
  res.sendFile(file);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

type Sock = WebSocket & {
  roomCode?: string;
  playerId?: string;
  abilityRolls?: number[];
  alive?: boolean;
};

const dropTimers = new Map<string, NodeJS.Timeout>();

function seatKey(roomCode: string, playerId: string) {
  return `${roomCode}:${playerId}`;
}

function broadcast(roomCode: string): void {
  const room = getRoom(roomCode);
  if (!room) return;
  for (const client of wss.clients) {
    const s = client as Sock;
    if (s.readyState === 1 && s.roomCode === roomCode) {
      s.send(
        JSON.stringify({
          eventType: "ROOM_STATE",
          payload: publicState(room, s.playerId),
        }),
      );
    }
  }
}

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function bind(sock: Sock, room: Room, playerId?: string): void {
  sock.roomCode = room.roomCode;
  sock.playerId = playerId;
  if (playerId) {
    const key = seatKey(room.roomCode, playerId);
    const timer = dropTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      dropTimers.delete(key);
    }
  }
  send(sock, { eventType: "SEAT", payload: { roomCode: room.roomCode, playerId: playerId ?? null } });
}

function seatStillHeld(roomCode: string, playerId: string): boolean {
  for (const client of wss.clients) {
    const s = client as Sock;
    if (s.readyState === 1 && s.roomCode === roomCode && s.playerId === playerId) return true;
  }
  return false;
}

function tableWatched(roomCode: string): boolean {
  for (const client of wss.clients) {
    const s = client as Sock;
    if (s.readyState === 1 && s.roomCode === roomCode) return true;
  }
  return false;
}

/**
 * A seat that drops for longer than the grace period Dodges its turn so the rest of the table is
 * not held hostage. When nobody at all is watching, the table is simply paused instead.
 */
function armDropTimer(roomCode: string, playerId: string) {
  const key = seatKey(roomCode, playerId);
  if (dropTimers.has(key)) return;
  dropTimers.set(
    key,
    setTimeout(() => {
      dropTimers.delete(key);
      if (seatStillHeld(roomCode, playerId) || !getRoom(roomCode)) return;
      if (!tableWatched(roomCode)) {
        armDropTimer(roomCode, playerId);
        return;
      }
      const room = playerDisconnect(roomCode, playerId);
      if (room) broadcast(room.roomCode);
    }, DROP_GRACE_MS),
  );
}

wss.on("connection", (ws) => {
  const sock = ws as Sock;
  sock.alive = true;
  sock.on("pong", () => {
    sock.alive = true;
  });
  send(ws, {
    eventType: "HELLO",
    payload: {
      mode: "local",
      campaign: getManifest().title,
      pregens: pregenList(),
      portraits: PORTRAITS.map((id) => ({ id, url: portraitUrl(id) })),
      chargen: getChargenCatalog(),
      narration: narrationStatus(),
    },
  });

  ws.on("close", () => {
    const { roomCode, playerId } = sock;
    if (!roomCode || !playerId) return;
    armDropTimer(roomCode, playerId);
  });

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      send(ws, { eventType: "ERROR", payload: { code: "BAD_JSON" } });
      return;
    }
    try {
      handle(sock, msg);
    } catch (err) {
      send(ws, {
        eventType: "ERROR",
        payload: {
          code: err instanceof Error ? err.message : "ERROR",
          action: msg.action,
        },
      });
    }
  });
});

function handle(sock: Sock, msg: ClientMsg): void {
  const pid = () => {
    const id = msg.playerId || sock.playerId;
    if (!id) throw new Error("NO_PLAYER");
    return id;
  };
  switch (msg.action) {
    case "CREATE_ROOM": {
      const room = createRoom();
      bind(sock, room);
      send(sock, { eventType: "ROOM_STATE", payload: publicState(room) });
      return;
    }
    case "CREATE_CHARACTER": {
      if (!msg.draft) throw new Error("MISSING_DRAFT");
      const rolledPool = msg.draft.method === "roll" ? sock.abilityRolls : undefined;
      const built = createCustomCharacter(msg.draft, rolledPool);
      send(sock, {
        eventType: "CHARACTER_CREATED",
        payload: {
          character: {
            id: built.id,
            name: built.name,
            summary: built.summary,
            class: built.class,
            level: built.level,
            hp: built.hp,
            ac: built.ac,
            abilities: built.abilities,
            portrait: portraitForCharacter(built.id),
            custom: true,
          },
          pregens: pregenList(),
        },
      });
      return;
    }
    case "ROLL_ABILITIES": {
      const scores = rollAbilityScores();
      sock.abilityRolls = scores;
      send(sock, { eventType: "ABILITY_ROLLS", payload: { scores } });
      return;
    }
    case "JOIN_ROOM": {
      if (!msg.roomCode || !msg.characterId) throw new Error("MISSING_FIELDS");
      const { room, playerId } = joinRoom(msg.roomCode, msg.displayName || "Player", msg.characterId);
      bind(sock, room, playerId);
      broadcast(room.roomCode);
      return;
    }
    case "REJOIN": {
      if (!msg.roomCode) throw new Error("MISSING_FIELDS");
      const { room, playerId } = rejoinRoom(msg.roomCode, msg.playerId);
      bind(sock, room, playerId);
      send(sock, { eventType: "ROOM_STATE", payload: publicState(room, playerId) });
      return;
    }
    case "CHOOSE": {
      if (!msg.roomCode || !msg.choiceId) throw new Error("MISSING_FIELDS");
      broadcast(choose(msg.roomCode, msg.choiceId).roomCode);
      return;
    }
    case "SOLVE_PUZZLE": {
      if (!msg.roomCode || !msg.sequence?.length) throw new Error("MISSING_FIELDS");
      broadcast(solvePuzzleSequence(msg.roomCode, msg.sequence).roomCode);
      return;
    }
    case "WITHDRAW": {
      if (!msg.roomCode) throw new Error("MISSING_FIELDS");
      broadcast(withdraw(msg.roomCode).roomCode);
      return;
    }
    case "RETRY_COMBAT": {
      if (!msg.roomCode) throw new Error("MISSING_FIELDS");
      broadcast(retryCombat(msg.roomCode).roomCode);
      return;
    }
    case "MAP_MOVE": {
      if (!msg.roomCode || msg.mapX === undefined || msg.mapY === undefined) throw new Error("MISSING_FIELDS");
      broadcast(mapMove(msg.roomCode, pid(), msg.mapX, msg.mapY).roomCode);
      return;
    }
    case "PROPOSE_MOVE": {
      if (!msg.roomCode || msg.x === undefined || msg.y === undefined) throw new Error("MISSING_FIELDS");
      broadcast(combatMove(msg.roomCode, pid(), msg.x, msg.y).roomCode);
      return;
    }
    case "PERFORM_ACTION": {
      if (!msg.roomCode || !msg.abilityId) throw new Error("MISSING_FIELDS");
      broadcast(combatAttack(msg.roomCode, pid(), msg.abilityId, msg.targetId).roomCode);
      return;
    }
    case "END_TURN": {
      if (!msg.roomCode) throw new Error("MISSING_FIELDS");
      broadcast(combatEndTurn(msg.roomCode, pid()).roomCode);
      return;
    }
    case "REQUEST_SAVE": {
      if (!msg.roomCode) throw new Error("MISSING_FIELDS");
      const { room, saveId } = requestSave(msg.roomCode);
      send(sock, { eventType: "SAVE_ACK", payload: { saveId } });
      broadcast(room.roomCode);
      return;
    }
    case "RESUME_SAVE": {
      if (!msg.saveId) throw new Error("MISSING_FIELDS");
      const room = resumeSave(msg.saveId);
      const seat = room.players[0]?.playerId;
      bind(sock, room, seat);
      send(sock, { eventType: "ROOM_STATE", payload: publicState(room, seat) });
      return;
    }
    case "VOICE_INTENT": {
      if (!msg.roomCode || !msg.intent) throw new Error("MISSING_FIELDS");
      broadcast(voiceIntent(msg.roomCode, pid(), msg.intent).roomCode);
      return;
    }
    case "PING":
      send(sock, { eventType: "PONG", payload: { t: Date.now() } });
      return;
    default:
      send(sock, { eventType: "ERROR", payload: { code: "UNKNOWN_ACTION", action: msg.action } });
  }
}

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const s = client as Sock;
    if (s.alive === false) {
      s.terminate();
      continue;
    }
    s.alive = false;
    s.ping();
  }
}, 15000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`D20 FireVerse LOCAL server on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket: ws://127.0.0.1:${PORT}/ws`);
  console.log(
    fs.existsSync(path.join(tvDist, "index.html"))
      ? "Serving tv/dist (Pixi build)"
      : "Serving tv/local (fallback HTML)",
  );
  prewarmNarration(scriptedLines());
});
