import "./styles.css";

interface SpeechAlt {
  readonly transcript: string;
}
interface SpeechHit {
  readonly isFinal: boolean;
  readonly 0: SpeechAlt;
}
interface SpeechEv {
  readonly results: ArrayLike<SpeechHit>;
}
interface SpeechSession {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechEv) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
interface SpeechSessionCtor {
  new (): SpeechSession;
}

function speechCtor(): SpeechSessionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechSessionCtor;
    webkitSpeechRecognition?: SpeechSessionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Seat = { playerId: string; characterName: string };
type Token = {
  playerId?: string;
  name: string;
  hp: number;
  maxHp: number;
  dead: boolean;
};
type TableState = {
  roomCode?: string;
  nodeId?: string;
  alexaScene?: string;
  narration?: string;
  players?: Seat[];
  combat?: { currentName?: string; tokens?: Token[] } | null;
  choices?: Array<{ id: string; label: string }>;
};

const app = document.querySelector("#app")!;
app.innerHTML = `
  <header class="mast">
    <p class="kicker">D20 FireVerse</p>
    <h1>Companion</h1>
    <p class="meta">The phone is the sheet and the voice. The television keeps the table.</p>
  </header>
  <section class="panel">
    <label>Room code<input id="roomCode" maxlength="6" autocapitalize="characters" placeholder="ABC123" /></label>
    <label>Seat<input id="playerId" placeholder="P1" /></label>
    <button class="primary" id="btnConnect" type="button">Sit at the table</button>
    <p class="meta" id="status">Not connected</p>
  </section>
  <section class="panel sheet" id="sheet">
    <div id="sheetBody" class="meta">Join from the television first. Your seat id is on the story bar.</div>
  </section>
  <section class="panel">
    <h2>Say it</h2>
    <p class="meta">“choose two”, “attack”, “magic missile”, “end turn”.</p>
    <button type="button" id="btnMic">Hold the room — listen</button>
    <div class="grid" id="intents"></div>
  </section>
  <p class="err" id="err"></p>
`;

const $ = (id: string) => document.getElementById(id)!;

let ws: WebSocket | null = null;
let state: TableState | null = null;
let pollTimer = 0;

const INTENT_BTNS: Array<[string, string]> = [
  ["choose_1", "Choose 1"],
  ["choose_2", "Choose 2"],
  ["choose_3", "Choose 3"],
  ["end_turn", "End turn"],
  ["attack_nearest", "Attack nearest"],
  ["cast_magic_missile", "Magic missile"],
];

$("intents").innerHTML = INTENT_BTNS.map(
  ([id, label]) =>
    `<button type="button" data-intent="${id}">${label}</button>`,
).join("");

function send(obj: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    $("err").textContent = "Connect before you speak";
    return;
  }
  ws.send(JSON.stringify(obj));
}

function sceneName(scene: string | undefined) {
  switch (scene) {
    case "tavern":
      return "Tavern";
    case "explore":
      return "Descent";
    case "combat":
      return "Combat";
    case "boss":
      return "Boss";
    case "victory":
      return "Victory";
    default:
      return "—";
  }
}

function renderSheet() {
  const body = $("sheetBody");
  if (!state?.players?.length) {
    body.innerHTML = `<div class="meta">Waiting for the room…</div>`;
    return;
  }
  const pid = ($("playerId") as HTMLInputElement).value.trim();
  const me = state.players.find((p) => p.playerId === pid) || state.players[0];
  const token = state.combat?.tokens?.find((t) => t.playerId === me.playerId);
  const hp = token ? Math.max(0, token.hp / Math.max(1, token.maxHp)) : 0;
  const choices = (state.choices || [])
    .map((c, i) => `<li>${i + 1}. ${c.label}</li>`)
    .join("");
  body.innerHTML = `
    <div class="who">
      <span class="mark">${me.characterName.slice(0, 1)}</span>
      <div>
        <strong>${me.characterName}</strong>
        <div class="meta">${me.playerId} · ${sceneName(state.alexaScene)}</div>
      </div>
    </div>
    <div class="hp"><span style="width:${token ? Math.round(hp * 100) : 0}%"></span></div>
    <div class="meta">${token ? `${token.hp}/${token.maxHp} HP` : "Not in a fight"} · Turn ${state.combat?.currentName || "—"}</div>
    <p class="narr">${(state.narration || "").slice(0, 280)}</p>
    ${choices ? `<ol class="choices">${choices}</ol>` : ""}
  `;
  document.body.dataset.room = state.alexaScene || "tavern";
}

function intentFromSpeech(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bend\b/.test(t) && /turn/.test(t)) return "end_turn";
  if (/magic missile|missile/.test(t)) return "cast_magic_missile";
  if (/attack|strike|hit|swing/.test(t)) return "attack_nearest";
  if (/\b(three|third|3)\b/.test(t)) return "choose_3";
  if (/\b(two|second|2)\b/.test(t)) return "choose_2";
  if (/\b(one|first|1)\b/.test(t)) return "choose_1";
  return null;
}

function dispatchIntent(intent: string) {
  const roomCode = ($("roomCode") as HTMLInputElement).value.toUpperCase();
  const playerId = ($("playerId") as HTMLInputElement).value.trim() || "P1";
  send({ action: "VOICE_INTENT", roomCode, playerId, intent });
}

$("btnConnect").onclick = () => {
  $("err").textContent = "";
  ws?.close();
  window.clearTimeout(pollTimer);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    $("status").textContent = "Listening to the table";
    const room = ($("roomCode") as HTMLInputElement).value.toUpperCase();
    if (room) pollRoom(room);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as { eventType?: string; payload?: TableState & { code?: string } };
    if (msg.eventType === "ROOM_STATE" && msg.payload) {
      state = msg.payload;
      renderSheet();
    }
    if (msg.eventType === "ERROR") {
      $("err").textContent = msg.payload?.code || "The table refused that";
    }
  };
  ws.onclose = () => {
    $("status").textContent = "Disconnected";
  };
};

async function pollRoom(room: string) {
  try {
    const r = await fetch(`/api/room/${room}`);
    if (r.ok) {
      state = (await r.json()) as TableState;
      renderSheet();
    }
  } catch {
    /* the socket is the source of truth when it is up */
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    pollTimer = window.setTimeout(() => pollRoom(room), 1500);
  }
}

$("intents").onclick = (e) => {
  const t = e.target as HTMLElement;
  const intent = t.getAttribute("data-intent");
  if (!intent) return;
  dispatchIntent(intent);
};

$("btnMic").onclick = () => {
  const Ctor = speechCtor();
  if (!Ctor) {
    $("err").textContent = "This browser has no speech recognition — use the buttons";
    return;
  }
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.continuous = false;
  rec.onresult = (ev) => {
    const said = ev.results[0]?.[0]?.transcript ?? "";
    const intent = intentFromSpeech(said);
    if (!intent) {
      $("err").textContent = `Heard “${said}” — not a table command`;
      return;
    }
    $("err").textContent = `Heard “${said}”`;
    dispatchIntent(intent);
  };
  rec.onerror = (ev) => {
    $("err").textContent = ev.error === "not-allowed" ? "Microphone blocked" : ev.error;
  };
  rec.onend = () => {
    $("btnMic").textContent = "Hold the room — listen";
  };
  $("btnMic").textContent = "Listening…";
  rec.start();
};
