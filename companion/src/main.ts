import "@fontsource/cinzel/700.css";
import "@fontsource-variable/literata/opsz.css";
import "./styles.css";
import { describeError, srdLabel } from "@d20-fireverse/protocol";

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

type Pregen = { id: string; name: string; summary: string; class: string; race?: string; level: number; portrait?: string };
type Seat = { playerId: string; characterId: string; characterName: string; portrait: string };
type Token = { id: string; playerId?: string; name: string; hp: number; maxHp: number; ac: number; dead: boolean; kind: string };
type MenuAction = { id: string; name: string; available: boolean };
type PuzzleState = {
  kind: string;
  picked: string[];
  need: number;
  fails: number;
  feedback: string;
  draft?: string[];
  holderId?: string | null;
  holderName?: string | null;
  hints?: Array<{ playerId: string; name: string; slot: number; optionId: string }>;
} | null;
type TableState = {
  roomCode: string;
  nodeId: string;
  nodeType: string;
  alexaScene?: string;
  narration?: string;
  speaker?: { id: string; name: string; portrait: string } | null;
  players: Seat[];
  choices: Array<{ id: string; label: string }>;
  skillCheck?: { ability: string; skill?: string; dc: number };
  vote?: {
    nodeId: string;
    votes: Array<{ playerId: string; choiceId: string; name: string; portrait: string | null }>;
    remainingMs: number;
  } | null;
  checkOffer?: {
    roster: Array<{ playerId: string; name: string; bonus: number }>;
    volunteers: string[];
    helpers: string[];
  } | null;
  puzzle: PuzzleState;
  combat: {
    status: string;
    round: number;
    currentTokenId?: string;
    currentName?: string;
    tokens: Token[];
    actionMenu: { actions: MenuAction[] } | null;
  } | null;
  localPlayerId: string | null;
};

const STORE = "fireverse.companion.v1";
type Stored = { roomCode: string; playerId: string | null };

function loadStored(): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Stored | null;
    return s?.roomCode ? s : null;
  } catch {
    return null;
  }
}
function saveStored(s: Stored | null) {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: the seat just won't survive a reload */
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

const params = new URLSearchParams(location.search);
const stored = loadStored();
let roomCode = cleanCode(params.get("room") ?? stored?.roomCode ?? "");
let playerId: string | null = params.get("seat") ?? (stored && stored.roomCode === roomCode ? stored.playerId : null);
if (params.has("room")) history.replaceState(null, "", location.pathname);

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <header class="mast">
    <div>
      <p class="kicker">D20 FireVerse · Companion</p>
      <h1 id="mastTitle">Take a seat</h1>
    </div>
    <span class="conn" id="conn">Connecting…</span>
  </header>

  <section class="panel login-gate" id="loginGate">
    <h2>Sign in</h2>
    <form id="loginForm">
      <label for="loginUser">Username</label>
      <input id="loginUser" autocomplete="username" />
      <label for="loginPass">Password</label>
      <input id="loginPass" type="password" autocomplete="current-password" />
      <button type="submit" class="primary">Enter</button>
      <p class="meta err" id="loginError"></p>
    </form>
  </section>

  <section class="panel" id="joinPanel" hidden>
    <form class="code-row" id="codeForm">
      <label for="roomCode">Table code</label>
      <input id="roomCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC123" inputmode="text" />
      <button type="submit" class="primary">Find the table</button>
    </form>
    <p class="meta" id="joinHint">The code is on the television, above the QR code.</p>
    <div class="heroes" id="heroes"></div>
  </section>

  <section class="panel seat-panel" id="seatPanel" hidden>
    <div class="who" id="who"></div>
    <div class="turn" id="turn" hidden></div>
    <div class="controls" id="controls"></div>
    <p class="narr" id="narr"></p>
    <div class="row-end"><button type="button" class="ghost small" id="btnLeave">Leave this seat</button></div>
  </section>

  <section class="panel" id="micPanel" hidden>
    <h2>Say it</h2>
    <p class="meta">“Choose two”, “attack”, “magic missile”, “end turn”.</p>
    <button type="button" id="btnMic" class="mic">Tap and speak</button>
  </section>

  <p class="toast" id="toast" role="status" hidden></p>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let ws: WebSocket | null = null;
let state: TableState | null = null;
let pregens: Pregen[] = [];
let reconnectDelay = 800;
let toastTimer = 0;

($("roomCode") as HTMLInputElement).value = roomCode;

function toast(text: string, kind: "bad" | "ok" = "bad") {
  const el = $("toast");
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4200);
}

function send(obj: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast("Reconnecting to the table — try again in a moment.");
    return false;
  }
  ws.send(JSON.stringify(obj));
  return true;
}

function attach() {
  if (!roomCode) return;
  send({ action: "REJOIN", roomCode, playerId: playerId ?? undefined });
}

function me(): Seat | undefined {
  return state?.players.find((p) => p.playerId === playerId);
}

let signedIn = false;

function render() {
  const seated = !!state && !!me();
  $("loginGate").hidden = signedIn;
  $("joinPanel").hidden = !signedIn || seated;
  $("seatPanel").hidden = !seated;
  $("micPanel").hidden = !seated;
  $("mastTitle").textContent = seated ? me()!.characterName : state ? `Table ${state.roomCode}` : "Take a seat";
  document.body.dataset.room = state?.alexaScene ?? "tavern";
  if (seated) renderSeat();
  else renderHeroes();
}

function renderHeroes() {
  const box = $("heroes");
  if (!state) {
    box.innerHTML = "";
    $("joinHint").textContent = roomCode ? "Looking for the table…" : "The code is on the television, above the QR code.";
    return;
  }
  const taken = new Set(state.players.map((p) => p.characterId));
  const inFight = state.combat?.status === "active";
  $("joinHint").textContent = inFight ? "A fight is on. You can take a seat as soon as it ends." : "Choose who you'll play. The television shows the rest.";
  box.innerHTML = pregens
    .map((p) => {
      const busy = taken.has(p.id);
      return `<button type="button" class="hero" data-hero="${esc(p.id)}" ${busy || inFight ? "disabled" : ""}>
        ${p.portrait ? `<img src="${esc(p.portrait)}" alt="" loading="lazy" />` : `<span class="mark">${esc(p.name.slice(0, 1))}</span>`}
        <span><strong>${esc(p.name)}</strong><em>${esc([srdLabel(p.race), srdLabel(p.class), `Level ${p.level}`].filter(Boolean).join(" · "))}</em>${busy ? `<i>At the table</i>` : ""}</span>
      </button>`;
    })
    .join("");
  box.querySelectorAll<HTMLElement>("[data-hero]").forEach((b) =>
    b.addEventListener("click", () => {
      const hero = pregens.find((p) => p.id === b.dataset.hero);
      if (!hero || !state) return;
      b.setAttribute("aria-busy", "true");
      send({ action: "JOIN_ROOM", roomCode: state.roomCode, characterId: hero.id, displayName: hero.name });
    }),
  );
}

function renderSeat() {
  const s = state!;
  const seat = me()!;
  const token = s.combat?.tokens.find((t) => t.playerId === seat.playerId);
  const ratio = token ? Math.max(0, token.hp / Math.max(1, token.maxHp)) : 1;
  $("who").innerHTML = `
    <img src="${esc(seat.portrait)}" alt="" />
    <div>
      <strong>${esc(seat.characterName)}</strong>
      <span class="meta">${token ? `${token.hp}/${token.maxHp} HP · AC ${token.ac}` : "Exploring"}</span>
      <span class="hp"><i style="width:${Math.round(ratio * 100)}%"></i></span>
    </div>`;

  const turn = $("turn");
  const controls = $("controls");
  const combat = s.combat?.status === "active" ? s.combat : null;
  if (combat) {
    const mine = !!token && combat.currentTokenId === token.id;
    turn.hidden = false;
    turn.className = `turn ${mine ? "mine" : ""}`;
    turn.textContent = token?.dead ? "You are down — your allies can still turn this." : mine ? "Your turn" : `Round ${combat.round} · ${combat.currentName ?? "…"} is acting`;
    const menu = combat.actionMenu?.actions ?? [];
    const missile = menu.find((a) => a.id === "spell_magic_missile");
    controls.innerHTML = mine
      ? `<button type="button" class="primary big" data-intent="attack_nearest">Attack the nearest foe</button>
         ${missile ? `<button type="button" data-intent="cast_magic_missile" ${missile.available ? "" : "disabled"}>Magic Missile</button>` : ""}
         <button type="button" data-intent="end_turn">End turn</button>
         <p class="meta">Moving and aiming happen on the television with the remote.</p>`
      : "";
  } else {
    turn.hidden = true;
    if (s.skillCheck && s.nodeType === "skill_check") {
      const skill = (s.skillCheck.skill ?? s.skillCheck.ability).replace(/_/g, " ");
      const roster = s.checkOffer?.roster ?? [];
      const helpers = new Set(s.checkOffer?.helpers ?? []);
      controls.innerHTML = `
        <p class="meta">Who attempts ${esc(skill)} · DC ${s.skillCheck.dc}? Pledge Help before they step up for advantage.</p>
        ${roster
          .map((r) => {
            const mine = r.playerId === seat.playerId;
            return `<button type="button" class="${mine ? "primary" : ""}" data-volunteer="${esc(r.playerId)}" ${mine ? "" : "disabled"}>${esc(r.name)} · ${r.bonus >= 0 ? "+" : ""}${r.bonus}${helpers.has(r.playerId) ? " · helping" : ""}</button>`;
          })
          .join("")}
        ${
          roster.some((r) => r.playerId !== seat.playerId)
            ? `<button type="button" data-help="1">Pledge Help (advantage)</button>`
            : ""
        }`;
    } else if (s.puzzle) {
      const holder = s.puzzle.holderId;
      const multi = s.players.length > 1;
      if (multi && !holder) {
        controls.innerHTML = `<button type="button" class="primary big" data-claim="1">Take the mechanism</button>
          <p class="meta">First hands place the symbols. Others can soft-suggest on the TV.</p>`;
      } else if (multi && holder === seat.playerId) {
        controls.innerHTML = `<p class="meta">You hold the mechanism — place symbols on the television.</p>
          <button type="button" data-release="1">Pass the mechanism</button>`;
      } else if (multi) {
        controls.innerHTML = `<p class="meta">${esc(s.puzzle.holderName ?? "An ally")} holds the mechanism. Soft-suggest from the TV, or wait your turn.</p>`;
      } else {
        controls.innerHTML = `<p class="meta">A puzzle is on the television. Work it with the remote.</p>`;
      }
    } else {
      const voting = !!(s.vote && s.players.length > 1);
      const sec = voting ? Math.ceil(s.vote!.remainingMs / 1000) : 0;
      controls.innerHTML =
        (voting ? `<p class="meta">Party vote · ${sec}s left</p>` : "") +
        s.choices
          .map((c, i) => {
            const mine = s.vote?.votes.find((v) => v.playerId === seat.playerId)?.choiceId === c.id;
            return `<button type="button" class="${i === 0 ? "primary" : ""} ${mine ? "voted" : ""}" data-choice="${esc(c.id)}"><b>${i + 1}</b>${esc(c.label)}${mine ? " · your vote" : ""}</button>`;
          })
          .join("");
    }
  }
  controls.querySelectorAll<HTMLElement>("[data-intent]").forEach((b) =>
    b.addEventListener("click", () => {
      if (navigator.vibrate) navigator.vibrate(12);
      send({ action: "VOICE_INTENT", roomCode: s.roomCode, playerId, intent: b.dataset.intent });
    }),
  );
  controls.querySelectorAll<HTMLElement>("[data-choice]").forEach((b) =>
    b.addEventListener("click", () => {
      if (navigator.vibrate) navigator.vibrate(12);
      if (s.players.length > 1) {
        send({ action: "CAST_VOTE", roomCode: s.roomCode, playerId, choiceId: b.dataset.choice });
      } else {
        send({ action: "CHOOSE", roomCode: s.roomCode, playerId, choiceId: b.dataset.choice });
      }
    }),
  );
  controls.querySelectorAll<HTMLElement>("[data-volunteer]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.hasAttribute("disabled") || b.dataset.volunteer !== seat.playerId) return;
      if (navigator.vibrate) navigator.vibrate(12);
      send({ action: "VOLUNTEER_CHECK", roomCode: s.roomCode, playerId: seat.playerId });
    }),
  );
  controls.querySelectorAll<HTMLElement>("[data-help]").forEach((b) =>
    b.addEventListener("click", () => {
      if (navigator.vibrate) navigator.vibrate(12);
      send({ action: "VOLUNTEER_CHECK", roomCode: s.roomCode, playerId, help: true });
    }),
  );
  controls.querySelectorAll<HTMLElement>("[data-claim]").forEach((b) =>
    b.addEventListener("click", () => {
      if (navigator.vibrate) navigator.vibrate(12);
      send({ action: "CLAIM_PUZZLE", roomCode: s.roomCode, playerId });
    }),
  );
  controls.querySelectorAll<HTMLElement>("[data-release]").forEach((b) =>
    b.addEventListener("click", () => {
      if (navigator.vibrate) navigator.vibrate(12);
      send({ action: "RELEASE_PUZZLE", roomCode: s.roomCode, playerId });
    }),
  );
  const speaker = s.speaker;
  const narrLead = (s.narration ?? "").split(/\n{2,}/)[0]!.slice(0, 320);
  const narr = $("narr");
  if (speaker?.portrait) {
    narr.innerHTML = `<span class="speaker-inline"><img src="${esc(speaker.portrait)}" alt="" /><strong>${esc(speaker.name)}</strong></span>`;
    narr.append(document.createTextNode(narrLead));
  } else {
    narr.textContent = narrLead;
  }
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  const conn = $("conn");
  ws.onopen = () => {
    reconnectDelay = 800;
    conn.textContent = "Live";
    conn.className = "conn ok";
  };
  ws.onclose = () => {
    conn.textContent = "Reconnecting…";
    conn.className = "conn bad";
    window.setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(8000, reconnectDelay * 1.6);
  };
  ws.onmessage = (ev) => {
    let msg: { eventType?: string; payload?: any };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    switch (msg.eventType) {
      case "HELLO":
        pregens = msg.payload?.pregens ?? [];
        attach();
        render();
        break;
      case "SEAT":
        if (msg.payload?.playerId) {
          playerId = msg.payload.playerId;
          saveStored({ roomCode, playerId });
        }
        break;
      case "ROOM_STATE":
        state = msg.payload as TableState;
        roomCode = state.roomCode;
        if (state.localPlayerId) playerId = state.localPlayerId;
        if (playerId && !state.players.some((p) => p.playerId === playerId)) playerId = null;
        saveStored({ roomCode, playerId });
        render();
        break;
      case "CHARACTER_CREATED":
        pregens = msg.payload?.pregens ?? pregens;
        render();
        break;
      case "ERROR": {
        const code = String(msg.payload?.code ?? "");
        if (msg.payload?.action === "REJOIN") {
          if (playerId) {
            playerId = null;
            attach();
            return;
          }
          state = null;
          saveStored(null);
          render();
          toast(code === "ROOM_NOT_FOUND" ? "No table with that code. Check the television." : describeError(code));
          return;
        }
        document.querySelectorAll("[aria-busy]").forEach((b) => b.removeAttribute("aria-busy"));
        toast(describeError(code));
        break;
      }
      default:
        break;
    }
  };
}

$("codeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = cleanCode(($("roomCode") as HTMLInputElement).value);
  if (code.length < 4) {
    toast("Type the table code shown on the television.");
    return;
  }
  roomCode = code;
  playerId = null;
  attach();
});

$("btnLeave").addEventListener("click", () => {
  playerId = null;
  saveStored({ roomCode, playerId: null });
  attach();
  render();
});

function intentFromSpeech(text: string): { intent?: string; choice?: number } | null {
  const t = text.toLowerCase();
  if (/\bend\b/.test(t) && /turn/.test(t)) return { intent: "end_turn" };
  if (/magic missile|missile/.test(t)) return { intent: "cast_magic_missile" };
  if (/attack|strike|hit|swing|shoot/.test(t)) return { intent: "attack_nearest" };
  if (/\b(three|third|3)\b/.test(t)) return { choice: 3 };
  if (/\b(two|second|2)\b/.test(t)) return { choice: 2 };
  if (/\b(one|first|1|roll)\b/.test(t)) return { choice: 1 };
  return null;
}

let listening: SpeechSession | null = null;
$("btnMic").addEventListener("click", () => {
  const Ctor = speechCtor();
  if (!Ctor) {
    toast("This browser can't listen. Use the buttons above.");
    return;
  }
  if (listening) {
    listening.stop();
    return;
  }
  const rec = new Ctor();
  listening = rec;
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.continuous = false;
  rec.onresult = (ev) => {
    const said = ev.results[0]?.[0]?.transcript ?? "";
    const heard = intentFromSpeech(said);
    if (!heard || !state) {
      toast(`Heard “${said}” — that isn't a table command.`);
      return;
    }
    toast(`Heard “${said}”`, "ok");
    const intent = heard.intent ?? `choose_${heard.choice}`;
    send({ action: "VOICE_INTENT", roomCode: state.roomCode, playerId, intent });
  };
  rec.onerror = (ev) => toast(ev.error === "not-allowed" ? "The microphone is blocked for this page." : "The microphone didn't catch that.");
  rec.onend = () => {
    listening = null;
    $("btnMic").textContent = "Tap and speak";
    $("btnMic").classList.remove("live");
  };
  $("btnMic").textContent = "Listening… tap to stop";
  $("btnMic").classList.add("live");
  rec.start();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ws?.readyState === WebSocket.OPEN) attach();
});

async function ensureLogin(): Promise<void> {
  const me = await fetch("/api/me", { credentials: "same-origin" });
  if (me.ok) {
    signedIn = true;
    return;
  }
  await new Promise<void>((resolve) => {
    $("loginForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("loginError").textContent = "";
      const res = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: ($("loginUser") as HTMLInputElement).value,
          password: ($("loginPass") as HTMLInputElement).value,
        }),
      });
      if (!res.ok) {
        $("loginError").textContent = "That username or password is wrong.";
        return;
      }
      signedIn = true;
      resolve();
    });
  });
}

render();
void ensureLogin().then(() => {
  render();
  connect();
});
