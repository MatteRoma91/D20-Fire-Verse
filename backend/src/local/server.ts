import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { loadCampaign, listPregens, getManifest } from "./campaign.js";
import {
  createCustomCharacter,
  getChargenCatalog,
  loadChargen,
  rollAbilityScores,
  type ChargenDraft,
} from "./chargen.js";
import { ensureDataDir, REPO_ROOT } from "./paths.js";
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
  requestSave,
  resumeSave,
  voiceIntent,
  solvePuzzleSequence,
} from "./room.js";

const PORT = Number(process.env.PORT || 3100);

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
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

const tvDist = path.join(REPO_ROOT, "tv", "dist");
const tvLocal = path.join(REPO_ROOT, "tv", "local");
if (fs.existsSync(path.join(tvDist, "index.html"))) {
  app.use(express.static(tvDist));
} else {
  app.use(express.static(tvLocal));
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "local",
    campaign: getManifest().id,
    combat: true,
    pixi: fs.existsSync(path.join(tvDist, "index.html")),
    aws: false,
  });
});

app.get("/api/pregens", (_req, res) => {
  res.json(listPregens());
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

type Sock = WebSocket & {
  roomCode?: string;
  playerId?: string;
  abilityRolls?: number[];
};

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
  ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  const sock = ws as Sock;
  send(ws, {
    eventType: "HELLO",
    payload: {
      mode: "local",
      campaign: getManifest().title,
      pregens: listPregens().map((p) => ({
        id: p.id,
        name: p.name,
        summary: p.summary,
        class: p.class,
        level: p.level,
        custom: p.id.startsWith("custom_"),
      })),
      chargen: getChargenCatalog(),
    },
  });

  const ping = setInterval(() => {
    if (ws.readyState === 1) ws.ping();
  }, 30000);

  ws.on("close", () => {
    clearInterval(ping);
    if (sock.roomCode && sock.playerId) {
      const room = playerDisconnect(sock.roomCode, sock.playerId);
      if (room) broadcast(room.roomCode);
    }
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
      if (msg.action === "CREATE_ROOM") {
        const room = createRoom();
        sock.roomCode = room.roomCode;
        send(ws, {
          eventType: "ROOM_STATE",
          payload: publicState(room, sock.playerId),
        });
        return;
      }
      if (msg.action === "CREATE_CHARACTER") {
        if (!msg.draft) throw new Error("MISSING_DRAFT");
        const rolledPool =
          msg.draft.method === "roll" ? sock.abilityRolls : undefined;
        const built = createCustomCharacter(msg.draft, rolledPool);
        send(ws, {
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
              custom: true,
            },
            pregens: listPregens().map((p) => ({
              id: p.id,
              name: p.name,
              summary: p.summary,
              class: p.class,
              level: p.level,
              custom: p.id.startsWith("custom_"),
            })),
          },
        });
        return;
      }
      if (msg.action === "ROLL_ABILITIES") {
        const scores = rollAbilityScores();
        sock.abilityRolls = scores;
        send(ws, {
          eventType: "ABILITY_ROLLS",
          payload: { scores },
        });
        return;
      }
      if (msg.action === "JOIN_ROOM") {
        if (!msg.roomCode || !msg.characterId) throw new Error("MISSING_FIELDS");
        const room = joinRoom(
          msg.roomCode,
          msg.displayName || "Player",
          msg.characterId,
        );
        sock.roomCode = room.roomCode;
        sock.playerId = room.players[room.players.length - 1].playerId;
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "CHOOSE") {
        if (!msg.roomCode || !msg.choiceId) throw new Error("MISSING_FIELDS");
        const room = choose(
          msg.roomCode,
          msg.choiceId,
          msg.playerId || sock.playerId,
        );
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "SOLVE_PUZZLE") {
        if (!msg.roomCode || !msg.sequence?.length) {
          throw new Error("MISSING_FIELDS");
        }
        const room = solvePuzzleSequence(msg.roomCode, msg.sequence);
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "WITHDRAW") {
        if (!msg.roomCode) throw new Error("MISSING_FIELDS");
        const room = withdraw(msg.roomCode);
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "MAP_MOVE") {
        if (!msg.roomCode || msg.mapX === undefined || msg.mapY === undefined) {
          throw new Error("MISSING_FIELDS");
        }
        const pid = msg.playerId || sock.playerId;
        if (!pid) throw new Error("NO_PLAYER");
        const room = mapMove(msg.roomCode, pid, msg.mapX, msg.mapY);
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "PROPOSE_MOVE") {
        if (!msg.roomCode || msg.x === undefined || msg.y === undefined) {
          throw new Error("MISSING_FIELDS");
        }
        const pid = msg.playerId || sock.playerId;
        if (!pid) throw new Error("NO_PLAYER");
        const room = combatMove(msg.roomCode, pid, msg.x, msg.y);
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "PERFORM_ACTION") {
        if (!msg.roomCode || !msg.abilityId) {
          throw new Error("MISSING_FIELDS");
        }
        const pid = msg.playerId || sock.playerId;
        if (!pid) throw new Error("NO_PLAYER");
        const room = combatAttack(
          msg.roomCode,
          pid,
          msg.abilityId,
          msg.targetId,
        );
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "END_TURN") {
        if (!msg.roomCode) throw new Error("MISSING_FIELDS");
        const pid = msg.playerId || sock.playerId;
        if (!pid) throw new Error("NO_PLAYER");
        const room = combatEndTurn(msg.roomCode, pid);
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "REQUEST_SAVE") {
        if (!msg.roomCode) throw new Error("MISSING_FIELDS");
        const { room, saveId } = requestSave(msg.roomCode);
        send(ws, { eventType: "SAVE_ACK", payload: { saveId } });
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "RESUME_SAVE") {
        if (!msg.saveId) throw new Error("MISSING_FIELDS");
        const room = resumeSave(msg.saveId);
        sock.roomCode = room.roomCode;
        send(ws, {
          eventType: "ROOM_STATE",
          payload: publicState(room, sock.playerId),
        });
        return;
      }
      if (msg.action === "VOICE_INTENT") {
        if (!msg.roomCode || !msg.intent) throw new Error("MISSING_FIELDS");
        const pid = msg.playerId || sock.playerId;
        if (!pid) throw new Error("NO_PLAYER");
        const room = voiceIntent(msg.roomCode, pid, msg.intent);
        broadcast(room.roomCode);
        return;
      }
      if (msg.action === "PING") {
        send(ws, { eventType: "PONG", payload: { t: Date.now() } });
        return;
      }
      send(ws, {
        eventType: "ERROR",
        payload: { code: "UNKNOWN_ACTION", action: msg.action },
      });
    } catch (err) {
      send(ws, {
        eventType: "ERROR",
        payload: {
          code: err instanceof Error ? err.message : "ERROR",
        },
      });
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`D20 FireVerse LOCAL server on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket: ws://127.0.0.1:${PORT}/ws`);
  console.log(
    fs.existsSync(path.join(tvDist, "index.html"))
      ? "Serving tv/dist (Pixi build)"
      : "Serving tv/local (fallback HTML)",
  );
});
