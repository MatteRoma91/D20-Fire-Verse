import "@fontsource/cinzel/500.css";
import "@fontsource/cinzel/700.css";
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "./styles.css";
import { describeError, scriptRuns, srdLabel, type CastMember } from "@d20-fireverse/protocol";
import { normalizeScene, sceneLabel, unlockAudio, type RoomScene } from "./audio";
import { mountChargen, type ChargenCatalog } from "./chargen-ui";
import { CombatUi } from "./combat-ui";
import { isD20, rollD20 } from "./dice3d";
import { DUNGEON_ROOMS, roomForNode, type DungeonRoomId } from "./dungeon-map";
import { onMusicChange, setMusic, toggleMusic, type MusicTrack } from "./music";
import { registerNativeBack } from "./native";
import { moveFocus, ownsArrows, remoteKey, restoreFocus, setScopeProvider, type RemoteKey } from "./nav";
import { companionUrl, qrSvg, REMOTE_LEGEND } from "./onboarding";
import { puzzleBack, puzzleKindForNode, renderInteractivePuzzle } from "./puzzles";
import { chapterCard, mountScenes, setScene } from "./scenefx";
import { ART, sceneForNode } from "./scenes";
import { clearSession, loadSession, saveSession, type Session } from "./session";
import { closeSettings, openSettings, settingsOpen } from "./settings-ui";
import { onSettings, settings } from "./settings";
import { sfx } from "./sfx";
import type { Pregen, RoomState } from "./types";
import { isNarrating, onSpokenCue, prefetchVoice, replayNarration, setCast, speak, stopNarration } from "./voice";

type PageId = "home" | "lobby" | "story" | "combat";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const appRoot = document.querySelector<HTMLElement>("#app")!;
appRoot.innerHTML = `
  <div class="stage" id="stage" aria-hidden="true"></div>
  <div class="vignette" aria-hidden="true"></div>
  <div class="grain" aria-hidden="true"></div>
  <header class="topbar">
    <div class="brand-mark">D20 FireVerse <span>Luppolandia</span></div>
    <ol class="party-rail" id="partyRail" aria-label="The party"></ol>
    <div class="now-playing" id="nowPlaying" aria-live="off"><span class="music-bars" aria-hidden="true"><i></i><i></i><i></i></span><span><em id="musicKicker">Music</em><strong id="musicTitle">A Very Potent Brew</strong></span></div>
    <div class="conn" id="conn" role="status">Connecting…</div>
    <div class="menu-hint" aria-hidden="true"><kbd>☰</kbd> Settings</div>
  </header>

  <div class="login-gate" id="loginGate">
    <form class="login-card" id="loginForm">
      <p class="home-kicker">The table</p>
      <h2>Sign in</h2>
      <label>Username <input id="loginUser" autocomplete="username" data-autofocus /></label>
      <label>Password <input id="loginPass" type="password" autocomplete="current-password" /></label>
      <button type="submit" class="primary">Enter</button>
      <p class="meta err" id="loginError"></p>
    </form>
  </div>

  <main class="pages">
    <section class="page page-home active" id="pageHome" aria-label="Title">
      <div class="home-hero">
        <p class="home-kicker">A one-shot for the living room · 5E rules</p>
        <h1 class="home-title">A Very<br />Potent Brew</h1>
        <p class="home-lead">The television is the table. Nobody has to run the game: the rules roll every die in the open, the narrator reads every scene aloud, and the party decides the rest.</p>
        <div class="home-cta" id="homeCta"></div>
        <div class="home-load" id="homeLoad" hidden>
          <input id="saveId" placeholder="Save code, e.g. save-ABC123-…" autocomplete="off" spellcheck="false" />
          <button type="button" class="primary" id="btnResume">Load</button>
        </div>
      </div>
      <aside class="home-side">
        <div class="card qr-card">
          <p class="card-kicker">Bring a phone</p>
          <div class="qr" id="homeQr"></div>
          <p class="meta">Scan to open the companion and take a seat from the couch.</p>
        </div>
        <div class="card legend-card">
          <p class="card-kicker">The remote is all you need</p>
          ${REMOTE_LEGEND}
        </div>
      </aside>
    </section>

    <section class="page page-lobby" id="pageLobby" aria-label="Choose your hero">
      <div class="lobby-main">
        <p class="story-chapter">Gather the party</p>
        <h2 class="lobby-title">Choose your hero</h2>
        <p class="lede">Pick a painted hero to begin now, or forge your own from the SRD rules. Friends can join from their phones at any time outside a fight.</p>
        <div class="hero-grid" id="heroGrid"></div>
      </div>
      <aside class="lobby-side">
        <div class="card room-card">
          <p class="card-kicker">This table</p>
          <p class="room-code" id="roomCode">······</p>
          <div class="qr" id="lobbyQr"></div>
          <p class="meta" id="lobbyQrHint">Scan to join this table from a phone.</p>
          <ul class="seats" id="lobbySeats"></ul>
        </div>
        <button type="button" class="primary" id="btnLobbyWatch" hidden>Begin with the party</button>
        <button type="button" class="ghost" id="btnLobbyBack">↩ Back to the title</button>
      </aside>
      <div id="chargenHost" hidden></div>
    </section>

    <section class="page page-story" id="pageStory" aria-label="Story">
      <div class="story-frame">
        <p class="story-chapter" id="storyChapter"></p>
        <h1 class="story-title" id="storyTitle"></h1>
        <div class="story-dialogue">
          <aside class="speaker" id="speakerCard" hidden>
            <img id="speakerPortrait" alt="" />
            <span id="speakerName"></span>
          </aside>
          <div class="story-narration" id="narration" aria-live="polite"></div>
        </div>
        <p class="story-dice" id="storyDice" hidden></p>
        <div id="voteBar" class="vote-bar" hidden></div>
        <div class="dungeon-map-wrap" id="dungeonMapWrap" hidden>
          <img id="dungeonMap" src="/art/dungeon-map.jpg" alt="Map of the brewery cellars" />
          <div class="fog-mask" id="fogMask"></div>
          <div class="map-tokens" id="mapTokens"></div>
        </div>
        <div id="puzzleHost"></div>
        <div class="choices" id="choices" role="group" aria-label="What do you do?"></div>
        <footer class="story-meta-bar">
          <span id="roomMeta"></span>
          <span class="seals" id="seals" aria-label="Seals"></span>
          <span class="saved-chip" id="savedChip" hidden>✓ Progress saved</span>
        </footer>
      </div>
    </section>

    <section class="page page-combat" id="pageCombat" aria-label="Combat">
      <div class="combat-head">
        <div>
          <p class="story-chapter" id="combatChapter"></p>
          <h2 id="combatTitle">Combat</h2>
        </div>
        <ol class="initiative" id="initiative" aria-label="Initiative order"></ol>
        <div class="round" id="combatRound"></div>
      </div>
      <div class="combat-grid">
        <div class="board-col">
          <div class="board" id="board" tabindex="0" data-arrows="all" data-nav-key="board" data-no-scroll="1" aria-label="Battle map"></div>
          <p class="combat-hint" id="combatHint" aria-live="polite"></p>
          <div class="action-bar" id="actionBar" role="toolbar" aria-label="Actions"></div>
        </div>
        <aside class="sheet-rail">
          <div id="pcSheet"></div>
          <ol class="combat-log" id="combatLog" aria-label="Combat log"></ol>
        </aside>
      </div>
    </section>
  </main>

  <div class="subtitles" id="subtitles" aria-live="polite" hidden><p></p></div>
  <div class="speaker-plate" id="speakerPlate" aria-hidden="true">
    <span class="sp-sigil"></span>
    <span class="sp-text"><strong></strong><small></small></span>
    <span class="sp-wave"><i></i><i></i><i></i><i></i><i></i></span>
  </div>
  <div class="turn-banner" id="turnBanner" hidden><strong></strong><span></span></div>
  <div class="victory-banner" id="victoryBanner" hidden><p>Victory</p><span>The last of them falls.</span></div>
  <div class="modal defeat-modal" id="defeatModal" hidden role="dialog" aria-label="The party has fallen">
    <div class="modal-card">
      <p class="modal-kicker">The party has fallen</p>
      <h2>Darkness, for now</h2>
      <p>The tale is not over. Rise and face them again from the first blow, or step back to safer stone and gather your strength.</p>
      <div class="row modal-actions">
        <button type="button" class="primary" id="btnRetry" data-autofocus>Rise again</button>
        <button type="button" class="ghost" id="btnWithdraw">Step back</button>
      </div>
    </div>
  </div>
  <div class="toast" id="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

mountScenes($("stage"));

let ws: WebSocket | null = null;
let state: RoomState | null = null;
let playerId: string | null = null;
let pregens: Pregen[] = [];
let portraits: Array<{ id: string; url: string }> = [];
let chargenApi: ReturnType<typeof mountChargen> | null = null;
let page: PageId = "home";
let campaigns: Array<{ id: string; title: string; version: number }> = [];
let resumedFirstState = true;
let lastChapterKey = "";
let lastStoryKey = "";
let lastDiceId = "";
let lastAutosave = "";
let storyBusy = false;
let joining = false;
let pendingRejoin: Session | null = null;
let reconnectDelay = 800;
let toastTimer = 0;
let captionTimer = 0;
let savedTimer = 0;

// ------------------------------------------------------------------ helpers

function toast(text: string, kind: "bad" | "ok" | "info" = "bad") {
  const el = $("toast");
  el.textContent = text;
  el.className = `toast show ${kind}`;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove("show");
    window.setTimeout(() => (el.hidden = true), 300);
  }, kind === "bad" ? 4200 : 3200);
}

function send(obj: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    sfx("uiError");
    toast("The table is reconnecting. Try again in a moment.", "info");
    return;
  }
  ws.send(JSON.stringify(obj));
}

function scopeRoot(): HTMLElement {
  const modal = settingsOpen() ?? document.querySelector<HTMLElement>(".modal:not([hidden])");
  if (modal) return modal;
  const cg = document.querySelector<HTMLElement>(".chargen-panel.is-open");
  if (cg) return cg;
  return document.querySelector<HTMLElement>(".page.active") ?? document.body;
}
setScopeProvider(scopeRoot);

function showPage(next: PageId) {
  if (page === next && document.querySelector(`.page.active`)) {
    return;
  }
  page = next;
  document.body.dataset.page = next;
  document.body.classList.toggle("in-combat", next === "combat");
  for (const [id, p] of [
    ["pageHome", "home"],
    ["pageLobby", "lobby"],
    ["pageStory", "story"],
    ["pageCombat", "combat"],
  ] as const) {
    $(id).classList.toggle("active", p === next);
  }
  if (next === "home") {
    setScene(ART.home, "warm");
    setMusic("title");
    renderHome();
  }
  if (next === "lobby") {
    setScene(ART.lobby, "warm");
    setMusic("tavern");
  }
  if (next !== "combat") combat.reset();
  requestAnimationFrame(() => restoreFocus(null));
}

function musicFor(s: RoomState): MusicTrack {
  if (s.combat) {
    if (s.combat.status === "defeat") return "tension";
    return s.combat.tokens.some((t) => t.boss && !t.dead) ? "boss" : "combat";
  }
  if (s.nodeId === "END_WIN" || s.nodeId === "epilogue") return "victory";
  switch (sceneForNode(s.nodeId).tone) {
    case "warm":
      return "tavern";
    case "ember":
      return "tension";
    case "victory":
      return "victory";
    case "cool":
      return "descent";
    default:
      return "descent";
  }
}

function roomScene(s: RoomState): RoomScene {
  const scene = sceneForNode(s.nodeId);
  if (s.combat) return s.combat.tokens.some((t) => t.boss) ? "boss" : "combat";
  return normalizeScene(s.alexaScene, scene.tone === "victory" ? "victory" : scene.tone === "warm" ? "tavern" : "explore");
}

// ------------------------------------------------------------------ subtitles & captions

function caption(text: string) {
  if (page !== "combat") return;
  showSubtitle(text, 3800);
}

function showSubtitle(text: string, hold = 0, speaker: string | null = null) {
  const s = settings();
  const el = $("subtitles");
  if (!s.subtitles || !text) {
    el.hidden = true;
    return;
  }
  const who = speaker ? state?.cast?.[speaker] : undefined;
  el.querySelector("p")!.innerHTML = who
    ? `<b class="sub-who" style="${whoStyle(who.color)}">${esc(who.name)}</b>${esc(text)}`
    : esc(text);
  if (page === "combat") {
    const r = $("board").getBoundingClientRect();
    el.style.setProperty("--subs-top", `${Math.round(r.bottom - 16)}px`);
  }
  el.hidden = false;
  el.classList.remove("fade");
  window.clearTimeout(captionTimer);
  if (hold) captionTimer = window.setTimeout(() => el.classList.add("fade"), hold);
}

/** CSS custom properties for a speaker's colour, as hex and as an rgb triplet for translucent tints. */
function whoStyle(color: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1] ?? "f1c46b";
  const n = parseInt(hex, 16);
  return `--who:#${hex};--who-rgb:${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

let plateSpeaker: string | null = null;

/** The nameplate of whoever is speaking right now; the narrator has none. */
function showSpeaker(speaker: string | null) {
  if (speaker === plateSpeaker) return;
  plateSpeaker = speaker;
  const plate = $("speakerPlate");
  const who = speaker ? state?.cast?.[speaker] : undefined;
  if (!who) {
    plate.classList.remove("on");
    return;
  }
  plate.setAttribute("style", whoStyle(who.color));
  plate.querySelector(".sp-sigil")!.textContent = who.name.replace(/^The\s+/i, "")[0] ?? "";
  plate.querySelector("strong")!.textContent = who.name;
  plate.querySelector("small")!.textContent = who.title;
  plate.classList.remove("on");
  void plate.offsetWidth;
  plate.classList.add("on");
}

onSpokenCue((cue) => {
  showSpeaker(cue?.speaker ?? null);
  const box = $("narration");
  box.querySelectorAll(".spoken").forEach((n) => {
    n.classList.remove("spoken");
    n.classList.add("said");
  });
  box.classList.toggle("speaking", !!cue);
  if (!cue) {
    box.querySelectorAll(".said").forEach((n) => n.classList.remove("said"));
    if (page !== "combat") $("subtitles").hidden = true;
    return;
  }
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(cue.text).slice(0, 36);
  const spans = [...box.querySelectorAll<HTMLElement>(".sent")];
  const hit = spans.find((s) => norm(s.textContent ?? "").includes(target) || target.includes(norm(s.textContent ?? "").slice(0, 36)));
  if (hit && page === "story") {
    hit.classList.add("spoken");
    $("subtitles").hidden = true;
    return;
  }
  showSubtitle(cue.text, 0, cue.speaker);
});

onSettings(() => {
  if (!settings().subtitles) $("subtitles").hidden = true;
});

async function turnBanner(title: string, sub: string, tone: "mine" | "ally" | "foe") {
  const el = $("turnBanner");
  el.className = `turn-banner ${tone}`;
  el.querySelector("strong")!.textContent = title;
  el.querySelector("span")!.textContent = sub;
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add("slam");
  await new Promise((r) => window.setTimeout(r, settings().motion === "reduced" ? 700 : tone === "mine" ? 1100 : 900));
  el.classList.remove("slam");
  el.hidden = true;
}

async function victory() {
  const el = $("victoryBanner");
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add("show");
  await new Promise((r) => window.setTimeout(r, 2300));
  el.classList.remove("show");
  window.setTimeout(() => (el.hidden = true), 500);
}

function setDefeat(defeated: boolean) {
  const modal = $("defeatModal");
  if (modal.hidden === !defeated) return;
  modal.hidden = !defeated;
  if (defeated) requestAnimationFrame(() => $("btnRetry").focus());
}

const combat = new CombatUi(
  { send, toast, caption, turnBanner, victory, onDefeatChange: setDefeat },
  {
    board: $("board"),
    ribbon: $("initiative"),
    sheet: $("pcSheet"),
    actions: $("actionBar"),
    title: $("combatTitle"),
    chapter: $("combatChapter"),
    meta: $("combatRound"),
    log: $("combatLog"),
  },
);

$("btnRetry").addEventListener("click", () => {
  sfx("uiConfirm");
  $("defeatModal").hidden = true;
  send({ action: "RETRY_COMBAT", roomCode: state?.roomCode });
});
$("btnWithdraw").addEventListener("click", () => {
  sfx("uiBack");
  $("defeatModal").hidden = true;
  send({ action: "WITHDRAW", roomCode: state?.roomCode });
});

// ------------------------------------------------------------------ home

function renderHome() {
  const session = loadSession();
  const cta = $("homeCta");
  const cont = session
    ? `<button type="button" class="primary continue" id="btnContinue" data-autofocus>
        <strong>Continue</strong><span>${esc(session.hero ?? "Your party")}${session.place ? ` · ${esc(session.place)}` : ""}</span>
      </button>`
    : "";
  const camp =
    campaigns.length > 1
      ? `<label class="meta">Campaign <select id="campPick">${campaigns
          .map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`)
          .join("")}</select></label>`
      : "";
  cta.innerHTML = `${cont}
    ${camp}
    <button type="button" class="${session ? "" : "primary"}" id="btnNew" ${session ? "" : "data-autofocus"}>Begin a new tale</button>
    <button type="button" class="ghost" id="btnLoad">Load a save code</button>
    <button type="button" class="ghost" id="btnSettings">Settings</button>`;
  $("btnContinue")?.addEventListener("click", () => continueSession());
  $("btnNew").addEventListener("click", () => {
    sfx("uiConfirm");
    clearSession();
    playerId = null;
    state = null;
    spectating = false;
    lobbyEntry = null;
    const campaignId = ($("campPick") as HTMLSelectElement | null)?.value || campaigns[0]?.id;
    send({ action: "CREATE_ROOM", campaignId });
    showPage("lobby");
    renderLobby();
  });
  $("btnLoad").addEventListener("click", () => {
    $("homeLoad").hidden = !$("homeLoad").hidden;
    if (!$("homeLoad").hidden) $("saveId").focus();
  });
  $("btnSettings").addEventListener("click", () => openSettings());
  void companionUrl().then((url) => ($("homeQr").innerHTML = qrSvg(url)));
}

function continueSession() {
  const session = loadSession();
  if (!session) return;
  sfx("uiConfirm");
  pendingRejoin = session;
  resumedFirstState = true;
  spectating = !session.playerId;
  send({ action: "REJOIN", roomCode: session.roomCode, playerId: session.playerId ?? undefined });
}

$("btnResume").addEventListener("click", () => {
  const saveId = ($("saveId") as HTMLInputElement).value.trim();
  if (!saveId) {
    toast("Type the save code you were given.", "info");
    return;
  }
  resumedFirstState = true;
  send({ action: "RESUME_SAVE", saveId });
});
$("saveId").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  $("btnResume").click();
});

// ------------------------------------------------------------------ lobby

let selectedHero: string | null = null;
/** The TV can host a party of phones without taking a seat itself. */
let spectating = false;
let lobbyEntry: { roomCode: string; seq: number } | null = null;

function storyMovedOn(s: RoomState): boolean {
  if (!lobbyEntry || lobbyEntry.roomCode !== s.roomCode) {
    lobbyEntry = { roomCode: s.roomCode, seq: s.narrationSeq };
    return false;
  }
  return s.players.length > 0 && s.narrationSeq > lobbyEntry.seq;
}

function renderLobby() {
  const grid = $("heroGrid");
  const taken = new Set((state?.players ?? []).map((p) => p.characterId));
  grid.innerHTML =
    pregens
      .map((p) => {
        const busy = taken.has(p.id);
        return `<button type="button" class="hero-card ${busy ? "taken" : ""}" data-hero="${esc(p.id)}" ${busy ? "disabled" : ""} ${selectedHero === p.id ? "data-autofocus" : ""}>
          <span class="hero-portrait">${p.portrait ? `<img src="${esc(p.portrait)}" alt="" loading="lazy" />` : ""}</span>
          <span class="hero-copy">
            <strong>${esc(p.name)}</strong>
            <em>${esc([srdLabel(p.race), srdLabel(p.class), `level ${p.level}`].filter(Boolean).join(" · "))}${p.custom ? " · forged" : ""}</em>
            <span>${esc(p.summary)}</span>
          </span>
          ${busy ? `<span class="hero-taken">At the table</span>` : ""}
        </button>`;
      })
      .join("") +
    `<button type="button" class="hero-card forge" id="btnForge">
      <span class="hero-portrait forge-mark" aria-hidden="true">✦</span>
      <span class="hero-copy"><strong>Forge a new hero</strong><em>SRD 5.1 · levels 1–3</em><span>Race, class, background, ability scores and a painted portrait.</span></span>
    </button>`;
  if (!grid.querySelector("[data-autofocus]")) grid.querySelector("button:not([disabled])")?.setAttribute("data-autofocus", "");
  grid.querySelectorAll<HTMLElement>("[data-hero]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.hero!;
      if (!state?.roomCode) {
        toast("Setting the table… try again in a moment.", "info");
        return;
      }
      if (joining) return;
      joining = true;
      selectedHero = id;
      sfx("uiConfirm");
      const hero = pregens.find((p) => p.id === id);
      send({ action: "JOIN_ROOM", roomCode: state.roomCode, characterId: id, displayName: hero?.name ?? "Hero" });
      window.setTimeout(() => (joining = false), 3000);
    }),
  );
  $("btnForge").addEventListener("click", () => {
    sfx("uiConfirm");
    chargenApi?.open();
  });
  const code = state?.roomCode ?? "······";
  $("roomCode").textContent = code;
  $("lobbySeats").innerHTML = (state?.players ?? [])
    .map((p) => `<li><img src="${esc(p.portrait)}" alt="" /><span>${esc(p.characterName)}</span><em>${p.playerId === playerId ? "this TV" : "phone"}</em></li>`)
    .join("");
  const phones = (state?.players ?? []).length;
  const watch = $("btnLobbyWatch");
  watch.hidden = phones === 0;
  watch.textContent = phones === 1 ? "Begin with the phone player" : `Begin with the ${phones} phone players`;
  if (state?.roomCode) {
    void companionUrl(state.roomCode).then((url) => {
      $("lobbyQr").innerHTML = qrSvg(url);
      $("lobbyQrHint").textContent = `Scan to join table ${state?.roomCode ?? ""} from a phone.`;
    });
  }
}

$("btnLobbyWatch").addEventListener("click", () => {
  if (!state?.players.length) return;
  sfx("uiConfirm");
  spectating = true;
  route();
});

$("btnLobbyBack").addEventListener("click", () => {
  spectating = false;
  sfx("uiBack");
  showPage("home");
});

// ------------------------------------------------------------------ party rail

function renderParty() {
  const rail = $("partyRail");
  const players = state?.players ?? [];
  const tokens = state?.combat?.tokens ?? [];
  rail.innerHTML = players
    .map((p) => {
      const t = tokens.find((x) => x.playerId === p.playerId);
      const ratio = t ? Math.max(0, t.hp / t.maxHp) : 1;
      const mine = p.playerId === playerId;
      const active = !!t && state?.combat?.currentTokenId === t.id;
      return `<li class="seat ${mine ? "mine" : ""} ${active ? "active" : ""} ${t?.dead ? "down" : ""}" style="--hp:${ratio}">
        <img src="${esc(p.portrait)}" alt="" />
        <span><strong>${esc(p.characterName.split(" ")[0]!)}</strong><em>${t ? `${t.hp}/${t.maxHp} HP` : mine ? "this TV" : "phone"}</em></span>
      </li>`;
    })
    .join("");
}

// ------------------------------------------------------------------ story

function sentenceSpans(text: string): string {
  const parts = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [text];
  return parts.map((s) => `<span class="sent">${esc(s)}</span>`).join("");
}

/** Narration as prose; spoken lines become quotes signed with the speaker's name and colour. */
function sentences(text: string, cast: Record<string, CastMember> = {}): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const runs = scriptRuns(para).map((run) => {
        const who = run.speaker ? cast[run.speaker] : undefined;
        if (!run.speaker) return sentenceSpans(run.text);
        if (!who) return `“${sentenceSpans(run.text)}”`;
        return `<span class="quote" style="${whoStyle(who.color)}"><span class="who">${esc(who.name)}</span>“${sentenceSpans(run.text)}”</span>`;
      });
      return `<p>${runs.join("")}</p>`;
    })
    .join("");
}

function chapterOf(chapter: string): { key: string; kicker: string; title: string } | null {
  const [head, tail] = chapter.split("·").map((s) => s.trim());
  if (!head) return null;
  if (!/^(Act|Seal|Finale|Epilogue)/.test(head)) return null;
  return { key: head, kicker: head, title: tail || head };
}

function renderSeals() {
  const flags = new Set(state?.flags ?? []);
  $("seals").innerHTML = (
    [
      ["seal_cellar", "Cellar"],
      ["seal_well", "Well"],
      ["seal_store", "Store"],
    ] as const
  )
    .map(([f, label]) => `<span class="seal ${flags.has(f) ? "on" : ""}" title="Seal of the ${label}">◈ ${label}</span>`)
    .join("");
}

function renderMap(s: RoomState) {
  const wrap = $("dungeonMapWrap");
  const area = s.currentRoom ?? roomForNode(s.nodeId);
  const visited = new Set<DungeonRoomId>(s.visitedRooms ?? []);
  const show = !!area && visited.size > 0 && !puzzleKindForNode(s.nodeId);
  wrap.hidden = !show;
  if (!show) return;
  $("fogMask").innerHTML = (Object.keys(DUNGEON_ROOMS) as DungeonRoomId[])
    .map((id) => `<div class="fog ${visited.has(id) ? "revealed" : ""} ${id === area ? "here" : ""}" data-room="${id}" data-label="${visited.has(id) ? DUNGEON_ROOMS[id].label : "?"}"></div>`)
    .join("");
  $("mapTokens").innerHTML = (s.mapTokens ?? [])
    .filter((t) => visited.has(t.room))
    .map((t) => {
      const p = s.players.find((x) => x.playerId === t.playerId);
      return `<div class="pawn ${t.playerId === playerId ? "mine" : ""}" style="left:${t.x}%;top:${t.y}%" title="${esc(t.name)}">${p ? `<img src="${esc(p.portrait)}" alt="" />` : ""}</div>`;
    })
    .join("");
}

function renderChoices(s: RoomState) {
  const box = $("choices");
  const puzzleHost = $("puzzleHost");
  const voteBar = $("voteBar");
  box.innerHTML = "";
  puzzleHost.innerHTML = "";
  voteBar.hidden = true;
  voteBar.innerHTML = "";

  const cast = (choiceId: string) => {
    if (storyBusy) return;
    storyBusy = true;
    box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-busy", "true"));
    sfx("uiConfirm");
    if (s.players.length > 1) {
      send({ action: "CAST_VOTE", roomCode: s.roomCode, playerId, choiceId });
    } else {
      send({ action: "CHOOSE", roomCode: s.roomCode, playerId, choiceId });
    }
    window.setTimeout(() => (storyBusy = false), 2500);
  };

  if (puzzleKindForNode(s.nodeId)) {
    renderInteractivePuzzle(puzzleHost, {
      nodeId: s.nodeId,
      progress: s.puzzle,
      localPlayerId: playerId,
      playerCount: s.players.length,
      onChoose: (choiceId) => send({ action: "CHOOSE", roomCode: s.roomCode, playerId, choiceId }),
      onSolve: (sequence) => {
        sfx("uiConfirm");
        send({ action: "SOLVE_PUZZLE", roomCode: s.roomCode, playerId, sequence });
      },
      onClaim: () => send({ action: "CLAIM_PUZZLE", roomCode: s.roomCode, playerId }),
      onRelease: () => send({ action: "RELEASE_PUZZLE", roomCode: s.roomCode, playerId }),
      onHint: (slot, optionId) =>
        send({ action: "PUZZLE_HINT", roomCode: s.roomCode, playerId, slot, optionId }),
      onDraft: (puzzleDraft) =>
        send({ action: "PUZZLE_DRAFT", roomCode: s.roomCode, playerId, puzzleDraft }),
    });
    return;
  }

  if (s.nodeType === "skill_check" && s.skillCheck) {
    const c = s.skillCheck;
    const skill = (c.skill ?? c.ability).replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
    const roster = s.checkOffer?.roster ?? [];
    const helpers = new Set(s.checkOffer?.helpers ?? []);
    box.innerHTML = `
      <p class="meta">Who attempts ${esc(skill)} (DC ${c.dc})? Help from an ally grants advantage — pledge it before they roll.</p>
      <div class="check-roster">${roster
        .map((r) => {
          const mine = r.playerId === playerId;
          return `<button type="button" class="choice ${mine ? "primary" : ""}" data-volunteer="${esc(r.playerId)}" ${mine ? "" : "disabled"} title="${mine ? "Step up" : "Only they can volunteer"}"><span class="choice-n">${r.bonus >= 0 ? "+" : ""}${r.bonus}</span><span>${esc(r.name)}${helpers.has(r.playerId) ? " · helping" : ""}</span></button>`;
        })
        .join("")}
      </div>
      ${
        playerId && roster.some((r) => r.playerId !== playerId)
          ? `<button type="button" class="choice" id="btnHelp">Pledge Help (advantage)</button>`
          : ""
      }`;
    box.querySelectorAll<HTMLElement>("[data-volunteer]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.hasAttribute("disabled") || b.dataset.volunteer !== playerId) return;
        sfx("uiConfirm");
        send({ action: "VOLUNTEER_CHECK", roomCode: s.roomCode, playerId });
      }),
    );
    box.querySelector("#btnHelp")?.addEventListener("click", () =>
      send({ action: "VOLUNTEER_CHECK", roomCode: s.roomCode, playerId, help: true }),
    );
    return;
  }

  if (s.nodeId === "END_SAVE" || s.nodeId === "END_WIN") {
    box.innerHTML = `<button type="button" class="choice primary" id="btnHome" data-autofocus><span class="choice-n">↩</span><span>${s.nodeId === "END_WIN" ? "Return to the title" : "Rest here — return to the title"}</span></button>`;
    $("btnHome").addEventListener("click", () => {
      sfx("uiConfirm");
      if (s.nodeId === "END_WIN") clearSession();
      state = null;
      showPage("home");
    });
    return;
  }
  if (s.nodeType === "encounter" && !s.combat) {
    box.innerHTML = `<button type="button" class="choice primary" id="btnRetryFight" data-autofocus><span class="choice-n">⚔</span><span>Face them again</span></button>
      <button type="button" class="choice" id="btnStepBack"><span class="choice-n">↩</span><span>Step back to safer ground</span></button>`;
    $("btnRetryFight").addEventListener("click", () => send({ action: "RETRY_COMBAT", roomCode: s.roomCode }));
    $("btnStepBack").addEventListener("click", () => send({ action: "WITHDRAW", roomCode: s.roomCode }));
    return;
  }

  if (s.vote && s.players.length > 1) {
    const sec = Math.ceil(s.vote.remainingMs / 1000);
    voteBar.hidden = false;
    voteBar.innerHTML = `<span class="vote-chip timer">Party vote · ${sec}s</span>
      <button type="button" class="ghost" id="btnCloseVote">Decide now</button>`;
    $("btnCloseVote")?.addEventListener("click", () =>
      send({ action: "CLOSE_VOTE", roomCode: s.roomCode, playerId }),
    );
  }

  box.innerHTML = s.choices
    .map((ch, i) => {
      const voters = s.vote?.votes.filter((v) => v.choiceId === ch.id) ?? [];
      const mine = voters.some((v) => v.playerId === playerId);
      const pawns = voters
        .map((v) =>
          v.portrait
            ? `<img class="choice-pawn" src="${esc(v.portrait)}" alt="" title="${esc(v.name)}" />`
            : `<i class="choice-pawn" title="${esc(v.name)}">${esc(v.name.slice(0, 1))}</i>`,
        )
        .join("");
      return `<button type="button" class="choice ${i === 0 ? "primary guided" : ""} ${mine ? "voted" : ""}" data-choice="${esc(ch.id)}" ${i === 0 ? "data-autofocus" : ""}><span class="choice-n">${i + 1}</span><span>${esc(ch.label)}</span>${pawns ? `<span class="choice-votes">${pawns}</span>` : ""}</button>`;
    })
    .join("");
  box.querySelectorAll<HTMLElement>("[data-choice]").forEach((b) =>
    b.addEventListener("click", () => cast(b.dataset.choice!)),
  );
  if (!s.combat && s.nodeType !== "encounter") {
    box.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="choice" id="btnShortRest"><span class="choice-n">☾</span><span>Short rest</span></button>
       <button type="button" class="choice" id="btnLongRest"><span class="choice-n">☼</span><span>Long rest</span></button>`,
    );
    $("btnShortRest").addEventListener("click", () => send({ action: "SHORT_REST", roomCode: s.roomCode }));
    $("btnLongRest").addEventListener("click", () => send({ action: "LONG_REST", roomCode: s.roomCode }));
  }
}

async function renderStory(s: RoomState) {
  showPage("story");
  const scene = sceneForNode(s.nodeId);
  setScene(scene.art, scene.tone);
  setMusic(musicFor(s));
  $("storyChapter").textContent = scene.chapter;
  $("storyTitle").textContent = scene.title;
  $("roomMeta").textContent = `Table ${s.roomCode}`;
  renderSeals();
  renderMap(s);

  const storyKey = `${s.nodeId}:${s.narrationSeq}`;
  const fresh = storyKey !== lastStoryKey;
  lastStoryKey = storyKey;
  const box = $("narration");
  const text = s.narration ?? "";
  const speakerCard = $("speakerCard");
  if (s.speaker?.portrait) {
    speakerCard.hidden = false;
    ($("speakerPortrait") as HTMLImageElement).src = s.speaker.portrait;
    $("speakerName").textContent = s.speaker.name;
  } else {
    speakerCard.hidden = true;
  }
  if (fresh) {
    box.innerHTML = sentences(text, s.cast);
    box.classList.remove("line-in");
    void box.offsetWidth;
    box.classList.add("line-in");
  }

  const diceList = (s.diceQueue?.length ? s.diceQueue : s.lastDice ? [s.lastDice] : []).filter(isD20);
  const dice = diceList[diceList.length - 1];
  const diceLine = $("storyDice");
  if (dice) {
    const vs = dice.vs ? ` vs ${dice.vs.kind} ${dice.vs.value}` : "";
    const word = dice.outcome === "success" ? " — success" : dice.outcome === "fail" ? " — failed" : "";
    diceLine.textContent = `${dice.roller} · ${dice.label ?? dice.purpose}: ${dice.total}${vs}${word}`;
    diceLine.hidden = false;
  } else diceLine.hidden = true;

  storyBusy = false;
  renderChoices(s);
  prefetchVoice(s.voice);
  if (!fresh) return;

  if (fresh && s.fx === "arrows") {
    sfx("arrow", { gain: 0.85, jitter: 0.02 });
  }

  if (dice && diceList.some((d) => d.id !== lastDiceId) && !resumedFirstState && fresh) {
    box.classList.add("held");
    for (const roll of diceList) {
      if (roll.id === lastDiceId) continue;
      lastDiceId = roll.id;
      await rollD20(roll);
      if (roll.outcome === "fail") sfx("arrowHit", { gain: 0.55, delay: 0.05 });
    }
    box.classList.remove("held");
  } else if (dice) lastDiceId = dice.id;

  const chapter = chapterOf(scene.chapter);
  if (chapter && chapter.key !== lastChapterKey) {
    lastChapterKey = chapter.key;
    if (!resumedFirstState) await chapterCard(chapter.kicker, chapter.title);
  }
  if (state?.nodeId !== s.nodeId || state.narrationSeq !== s.narrationSeq) return;
  if (s.nodeId === "END_WIN" || s.nodeId === "epilogue") sfx("victory", { jitter: 0, gain: 0.6 });
  if (/seal/i.test(text) && /Seal of the/i.test(text) && s.seals > 0) sfx("seal", { gain: 0.7 });
  void speak(s.voice, { interrupt: true });
}

// ------------------------------------------------------------------ routing

let routing: Promise<void> = Promise.resolve();

function route() {
  routing = routing.then(routeNow).catch((err) => console.error(err));
}

async function routeNow() {
  const s = state;
  if (!s) return;
  renderParty();
  document.body.dataset.room = roomScene(s);
  const seated = !!playerId && s.players.some((p) => p.playerId === playerId);

  const watching = s.players.length > 0 && (spectating || storyMovedOn(s));
  if (!seated && !s.combat && page !== "story" && !watching) {
    showPage("lobby");
    renderLobby();
    return;
  }
  if (s.combat) {
    const scene = sceneForNode(s.nodeId);
    showPage("combat");
    setScene(scene.art, "ember");
    setMusic(musicFor(s));
    $("combatChapter").textContent = scene.chapter;
    $("combatTitle").textContent = scene.title;
    if (s.combat.events.some((e) => e.kind === "start") && !resumedFirstState && s.voice) {
      const intro = s.voice;
      void speak(intro, { interrupt: true });
    }
    await combat.render(s, { resumed: resumedFirstState });
    resumedFirstState = false;
    return;
  }
  if (page === "combat" && combat.wantsOutro(s)) {
    const outro = s.combatOutro!;
    await combat.playOutro(s);
    void speak(outro.voice, { interrupt: false });
  }
  setDefeat(false);
  await renderStory(s);
  resumedFirstState = false;
}

// ------------------------------------------------------------------ connection

function onRoomState(next: RoomState) {
  state = next;
  setCast(next.cast);
  if (next.localPlayerId) playerId = next.localPlayerId;
  joining = false;
  pendingRejoin = null;
  const me = next.players.find((p) => p.playerId === playerId);
  if (me || next.players.length === 0 || spectating) {
    saveSession({
      roomCode: next.roomCode,
      playerId,
      hero: me?.characterName,
      place: sceneForNode(next.nodeId).title,
      autosaveId: next.autosaveId,
    });
  }
  if (next.autosaveId && lastAutosave && lastAutosave !== `${next.autosaveId}:${next.nodeId}` && !next.combat) {
    const chip = $("savedChip");
    chip.hidden = false;
    chip.classList.remove("show");
    void chip.offsetWidth;
    chip.classList.add("show");
    window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => (chip.hidden = true), 2600);
  }
  lastAutosave = next.autosaveId ? `${next.autosaveId}:${next.nodeId}` : lastAutosave;
  route();
}

function onError(code: string, action?: string) {
  joining = false;
  if (action === "CREATE_CHARACTER" || action === "ROLL_ABILITIES") chargenApi?.failed();
  if (action === "REJOIN" || (code === "ROOM_NOT_FOUND" && pendingRejoin)) {
    const session = pendingRejoin ?? loadSession();
    pendingRejoin = null;
    if (session?.autosaveId) {
      toast("The table was closed — picking up from the last autosave.", "info");
      resumedFirstState = true;
      send({ action: "RESUME_SAVE", saveId: session.autosaveId });
      return;
    }
    clearSession();
    toast("That table is gone and there's no save to return to. Begin a new tale.", "bad");
    showPage("home");
    return;
  }
  sfx("uiError");
  toast(describeError(code), "bad");
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  const conn = $("conn");
  ws.addEventListener("open", () => {
    reconnectDelay = 800;
    conn.textContent = "Table live";
    conn.className = "conn ok";
  });
  ws.addEventListener("close", () => {
    conn.textContent = "Reconnecting…";
    conn.className = "conn bad";
    window.setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(8000, reconnectDelay * 1.6);
  });
  ws.addEventListener("message", (ev) => {
    let msg: { eventType: string; payload: any };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    switch (msg.eventType) {
      case "HELLO": {
        campaigns = msg.payload.campaigns ?? [];
        pregens = msg.payload.pregens ?? [];
        portraits = msg.payload.portraits ?? [];
        const catalog = msg.payload.chargen as ChargenCatalog | undefined;
        if (catalog && !chargenApi) {
          chargenApi = mountChargen({ root: $("chargenHost"), catalog, portraits, send, onCreated: (id) => (selectedHero = id) });
        } else if (catalog) chargenApi?.refresh(catalog);
        if (page === "lobby") renderLobby();
        const session = loadSession();
        if (state?.roomCode) {
          resumedFirstState = true;
          send({ action: "REJOIN", roomCode: state.roomCode, playerId: playerId ?? undefined });
        } else if (session && page === "home") {
          renderHome();
        }
        break;
      }
      case "SEAT":
        if (msg.payload.playerId) playerId = msg.payload.playerId;
        break;
      case "ROOM_STATE":
        onRoomState(msg.payload as RoomState);
        break;
      case "CHARACTER_CREATED": {
        pregens = msg.payload.pregens ?? pregens;
        const hero = msg.payload.character;
        if (hero?.id) selectedHero = hero.id;
        chargenApi?.onCreatedClose();
        renderLobby();
        requestAnimationFrame(() => $("heroGrid").querySelector<HTMLElement>(`[data-hero="${CSS.escape(hero?.id ?? "")}"]`)?.focus());
        sfx("seal", { gain: 0.6 });
        toast(`${hero?.name ?? "Your hero"} is ready. Press OK on the card to begin.`, "ok");
        break;
      }
      case "ABILITY_ROLLS":
        chargenApi?.applyRolls(msg.payload.scores ?? []);
        break;
      case "SAVE_ACK":
        toast(`Saved. Code: ${msg.payload.saveId}`, "ok");
        break;
      case "ERROR":
        onError(msg.payload?.code, msg.payload?.action);
        break;
      default:
        break;
    }
  });
}

// ------------------------------------------------------------------ remote

function handleBack(): boolean {
  if (settingsOpen()) {
    closeSettings();
    return true;
  }
  const cg = document.querySelector(".chargen-panel.is-open");
  if (cg) {
    chargenApi?.back();
    return true;
  }
  if (page === "lobby") {
    spectating = false;
    sfx("uiBack");
    showPage("home");
    return true;
  }
  if (page === "story" && state && puzzleBack(state.nodeId)) {
    sfx("uiBack");
    renderChoices(state);
    return true;
  }
  if (page === "story") {
    stopNarration();
    return true;
  }
  if (page === "home" && isNarrating()) {
    stopNarration();
    return true;
  }
  return false;
}

registerNativeBack(() => page === "home" && !settingsOpen() && !document.querySelector(".modal:not([hidden])"));

window.addEventListener("keydown", (e) => {
  unlockAudio();
  const key = remoteKey(e);
  const target = e.target as HTMLElement;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if (!key) {
    if (!typing && (e.key === "m" || e.key === "M")) toggleMusic();
    if (!typing && page === "story" && /^[1-9]$/.test(e.key)) {
      const b = $("choices").querySelectorAll<HTMLElement>("[data-choice]")[Number(e.key) - 1];
      b?.click();
    }
    if (!typing && (e.key === "s" || e.key === "S")) openSettings();
    return;
  }
  if (typing && key === "back" && e.key === "Backspace") return;
  if (key === "menu") {
    e.preventDefault();
    if (settingsOpen()) closeSettings();
    else openSettings();
    return;
  }
  if (!settingsOpen() && page === "combat" && !document.querySelector(".modal:not([hidden])") && combat.handleKey(key)) {
    e.preventDefault();
    return;
  }
  switch (key) {
    case "back":
      if (handleBack()) e.preventDefault();
      return;
    case "play":
      e.preventDefault();
      replayNarration();
      return;
    case "rew":
    case "ff":
      return;
    case "ok":
      if (target instanceof HTMLButtonElement) sfx("uiMove", { gain: 0.001 });
      return;
    case "up":
    case "down":
    case "left":
    case "right":
      if (ownsArrows(target, key)) return;
      e.preventDefault();
      moveFocus(key);
      return;
    default: {
      const exhaustive: never = key as never;
      void exhaustive;
    }
  }
});
window.addEventListener("pointerdown", () => unlockAudio());

onMusicChange((m) => {
  const el = $("nowPlaying");
  el.classList.toggle("off", !m.enabled);
  el.classList.toggle("live", m.enabled && m.playing);
  $("musicKicker").textContent = m.enabled ? "Now playing" : "Music muted";
  $("musicTitle").textContent = m.title;
});

void (sceneLabel satisfies (s: RoomScene) => string);
void ({} as RemoteKey);

setScene(ART.home, "warm");
renderHome();

async function ensureLogin(): Promise<void> {
  const me = await fetch("/api/me", { credentials: "same-origin" });
  if (me.ok) {
    $("loginGate").hidden = true;
    return;
  }
  $("loginGate").hidden = false;
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
      $("loginGate").hidden = true;
      resolve();
    });
  });
}

void ensureLogin().then(() => {
  requestAnimationFrame(() => restoreFocus());
  connect();
});

if (import.meta.env.DEV) {
  (window as unknown as { __table: object }).__table = { isNarrating, page: () => page };
}
