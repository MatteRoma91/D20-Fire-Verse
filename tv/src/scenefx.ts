/** Living scenes: slow camera drift over the painted art, air that moves, and chapter cards between acts. */

import { reducedMotion } from "./settings";
import { sfx } from "./sfx";

export type Tone = "warm" | "cool" | "ember" | "victory";

type Mote = { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; tw: number };

let layers: [HTMLElement, HTMLElement] | null = null;
let front = 0;
let currentArt = "";
let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let tone: Tone = "warm";
let motes: Mote[] = [];
let raf = 0;
let lastT = 0;
let cardTimer = 0;

export function mountScenes(host: HTMLElement) {
  const a = document.createElement("div");
  const b = document.createElement("div");
  a.className = "stage-layer";
  b.className = "stage-layer";
  host.append(a, b);
  layers = [a, b];
  canvas = document.createElement("canvas");
  canvas.className = "stage-air";
  host.appendChild(canvas);
  ctx2d = canvas.getContext("2d");
  const resize = () => {
    if (!canvas) return;
    const scale = Math.min(window.devicePixelRatio, 1.25);
    canvas.width = Math.floor(window.innerWidth * scale);
    canvas.height = Math.floor(window.innerHeight * scale);
  };
  resize();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else loop(performance.now());
  });
  loop(performance.now());
}

/** Crossfade to a painting and start a slow Ken Burns drift across it. */
export function setScene(art: string, nextTone: Tone) {
  document.body.dataset.tone = nextTone;
  if (nextTone !== tone) {
    tone = nextTone;
    motes = [];
  }
  if (!layers || art === currentArt) return;
  currentArt = art;
  const incoming = layers[1 - front]!;
  const outgoing = layers[front]!;
  const img = new Image();
  img.onload = img.onerror = () => {
    if (currentArt !== art) return;
    incoming.style.backgroundImage = `url(${art})`;
    const dx = (Math.random() * 2 - 1) * 3;
    const dy = (Math.random() * 2 - 1) * 2;
    incoming.style.setProperty("--kb-x", `${dx.toFixed(2)}%`);
    incoming.style.setProperty("--kb-y", `${dy.toFixed(2)}%`);
    incoming.style.setProperty("--kb-from", `${(1.04 + Math.random() * 0.03).toFixed(3)}`);
    incoming.style.setProperty("--kb-to", `${(1.12 + Math.random() * 0.05).toFixed(3)}`);
    incoming.classList.remove("drift");
    void incoming.offsetWidth;
    incoming.classList.add("drift", "shown");
    outgoing.classList.remove("shown");
    front = 1 - front;
  };
  img.src = art;
}

function spawn(w: number, h: number): Mote {
  switch (tone) {
    case "ember":
      return { x: Math.random() * w, y: h + 10, vx: (Math.random() - 0.5) * 12, vy: -(24 + Math.random() * 40), r: 1 + Math.random() * 2.2, life: 0, max: 5 + Math.random() * 5, tw: Math.random() * 6 };
    case "victory":
      return { x: Math.random() * w, y: -10, vx: (Math.random() - 0.5) * 10, vy: 14 + Math.random() * 18, r: 1 + Math.random() * 2, life: 0, max: 10 + Math.random() * 8, tw: Math.random() * 6 };
    case "cool":
      return { x: Math.random() * w, y: Math.random() * h, vx: 4 + Math.random() * 6, vy: (Math.random() - 0.5) * 3, r: 0.6 + Math.random() * 1.6, life: 0, max: 8 + Math.random() * 8, tw: Math.random() * 6 };
    case "warm":
    default:
      return { x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 5, vy: -(2 + Math.random() * 5), r: 0.8 + Math.random() * 1.8, life: 0, max: 8 + Math.random() * 8, tw: Math.random() * 6 };
  }
}

function colour(m: Mote, alpha: number): string {
  switch (tone) {
    case "ember":
      return `rgba(255, ${140 + Math.floor(60 * Math.sin(m.tw))}, 60, ${alpha})`;
    case "victory":
      return `rgba(255, 220, 140, ${alpha})`;
    case "cool":
      return `rgba(190, 210, 235, ${alpha * 0.7})`;
    case "warm":
    default:
      return `rgba(255, 214, 150, ${alpha * 0.8})`;
  }
}

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (!canvas || !ctx2d) return;
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
  lastT = now;
  const w = canvas.width;
  const h = canvas.height;
  ctx2d.clearRect(0, 0, w, h);
  if (reducedMotion() || document.body.classList.contains("in-combat")) return;
  const target = tone === "ember" ? 70 : tone === "victory" ? 60 : 45;
  while (motes.length < target) {
    const m = spawn(w, h);
    if (tone !== "ember" && tone !== "victory") m.life = Math.random() * m.max;
    motes.push(m);
  }
  ctx2d.globalCompositeOperation = "lighter";
  motes = motes.filter((m) => {
    m.life += dt;
    m.tw += dt * 3;
    m.x += (m.vx + Math.sin(m.tw) * 4) * dt;
    m.y += m.vy * dt;
    const k = m.life / m.max;
    if (k >= 1 || m.y < -20 || m.y > h + 20 || m.x < -20 || m.x > w + 20) return false;
    const alpha = Math.sin(k * Math.PI) * (0.35 + 0.35 * Math.abs(Math.sin(m.tw)));
    ctx2d!.beginPath();
    ctx2d!.fillStyle = colour(m, alpha);
    ctx2d!.arc(m.x, m.y, m.r * (tone === "ember" ? 1 : 1.4), 0, Math.PI * 2);
    ctx2d!.fill();
    return true;
  });
  ctx2d.globalCompositeOperation = "source-over";
}

/** A title card between acts. Resolves when the card has faded, so the narrator speaks after it. */
export function chapterCard(kicker: string, title: string): Promise<void> {
  let card = document.getElementById("chapterCard");
  if (!card) {
    card = document.createElement("div");
    card.id = "chapterCard";
    card.className = "chapter-card";
    card.setAttribute("aria-live", "polite");
    document.body.appendChild(card);
  }
  const el = card;
  window.clearTimeout(cardTimer);
  el.innerHTML = `<p class="chapter-kicker"></p><h1 class="chapter-title"></h1><span class="chapter-rule" aria-hidden="true"></span>`;
  el.querySelector(".chapter-kicker")!.textContent = kicker;
  el.querySelector(".chapter-title")!.textContent = title;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  sfx("chapter", { gain: 0.8, jitter: 0 });
  const hold = reducedMotion() ? 1400 : 2600;
  return new Promise((resolve) => {
    cardTimer = window.setTimeout(() => {
      el.classList.remove("show");
      window.setTimeout(resolve, 500);
    }, hold);
  });
}
