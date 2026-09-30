/**
 * The table's d20: a resin die tumbling in 3D that always comes to rest on the face
 * the server rolled, followed by a banner anyone on the couch can read
 * ("17 vs AC 13 — HIT"). Natural 20s stop time; natural 1s get their comic beat.
 */

import {
  AmbientLight,
  BufferAttribute,
  CanvasTexture,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { reducedMotion } from "./settings";
import { sfx } from "./sfx";
import type { DiceRoll } from "./types";

type Face = { number: number; normal: Vector3; up: Vector3 };

type Stage = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  die: Group;
  body: Mesh;
  material: MeshPhysicalMaterial;
  glow: PointLight;
  faces: Face[];
};

let stage: Stage | null = null;
let host: HTMLElement | null = null;
let banner: HTMLElement | null = null;
let flash: HTMLElement | null = null;
let raf = 0;
let chain: Promise<void> = Promise.resolve();

const COLS = 5;
const ROWS = 4;
const TRI = { top: [0.5, 0.07], left: [0.04, 0.87], right: [0.96, 0.87] } as const;

function faceAtlas(): CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  const cw = size / COLS;
  const ch = size / ROWS;
  g.fillStyle = "#3a0d0b";
  g.fillRect(0, 0, size, size);
  for (let n = 1; n <= 20; n += 1) {
    const col = (n - 1) % COLS;
    const row = Math.floor((n - 1) / COLS);
    const ox = col * cw;
    const oy = row * ch;
    const grad = g.createLinearGradient(ox, oy, ox, oy + ch);
    grad.addColorStop(0, "#8e2a1c");
    grad.addColorStop(0.55, "#5c150f");
    grad.addColorStop(1, "#2c0907");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(ox + TRI.top[0] * cw, oy + TRI.top[1] * ch);
    g.lineTo(ox + TRI.left[0] * cw, oy + TRI.left[1] * ch);
    g.lineTo(ox + TRI.right[0] * cw, oy + TRI.right[1] * ch);
    g.closePath();
    g.fill();
    const cx = ox + cw / 2;
    const cy = oy + ch * 0.62;
    g.font = `700 ${n >= 10 ? 70 : 80}px Cinzel, Georgia, serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(20, 6, 4, 0.9)";
    g.strokeText(String(n), cx, cy);
    g.fillStyle = n === 20 ? "#ffd98a" : n === 1 ? "#d9c7b3" : "#f6e6c8";
    g.fillText(String(n), cx, cy);
    if (n === 6 || n === 9) {
      g.fillRect(cx - 18, cy + 40, 36, 6);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Number the twenty faces so opposite faces sum to 21, like a real d20, and map the atlas onto them. */
function buildDie(): { geometry: IcosahedronGeometry; faces: Face[] } {
  const geometry = new IcosahedronGeometry(1, 0);
  const pos = geometry.getAttribute("position");
  const count = pos.count / 3;
  const tris: Array<{ a: Vector3; b: Vector3; c: Vector3; n: Vector3 }> = [];
  for (let f = 0; f < count; f += 1) {
    const a = new Vector3().fromBufferAttribute(pos, f * 3);
    const b = new Vector3().fromBufferAttribute(pos, f * 3 + 1);
    const c = new Vector3().fromBufferAttribute(pos, f * 3 + 2);
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    tris.push({ a, b, c, n });
  }
  const numbers = new Array<number>(count).fill(0);
  let low = 1;
  for (let i = 0; i < count; i += 1) {
    if (numbers[i]) continue;
    let opposite = -1;
    let best = 2;
    for (let j = 0; j < count; j += 1) {
      if (j === i || numbers[j]) continue;
      const d = tris[i]!.n.dot(tris[j]!.n);
      if (d < best) {
        best = d;
        opposite = j;
      }
    }
    numbers[i] = low;
    if (opposite >= 0) numbers[opposite] = 21 - low;
    low += 1;
  }
  const uv = new Float32Array(count * 6);
  const faces: Face[] = [];
  for (let f = 0; f < count; f += 1) {
    const n = numbers[f]!;
    const col = (n - 1) % COLS;
    const row = Math.floor((n - 1) / COLS);
    const put = (k: number, p: readonly [number, number]) => {
      uv[f * 6 + k * 2] = (col + p[0]) / COLS;
      uv[f * 6 + k * 2 + 1] = 1 - (row + p[1]) / ROWS;
    };
    put(0, TRI.top);
    put(1, TRI.left);
    put(2, TRI.right);
    const t = tris[f]!;
    const centroid = new Vector3().add(t.a).add(t.b).add(t.c).multiplyScalar(1 / 3);
    const up = new Vector3().subVectors(t.a, centroid);
    up.sub(t.n.clone().multiplyScalar(up.dot(t.n))).normalize();
    faces.push({ number: n, normal: t.n.clone(), up });
  }
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  return { geometry, faces };
}

/** The orientation that shows `face` to the camera, number upright. */
function restingQuaternion(face: Face): Quaternion {
  const right = new Vector3().crossVectors(face.up, face.normal).normalize();
  const m = new Matrix4().makeBasis(right, face.up, face.normal).transpose();
  return new Quaternion().setFromRotationMatrix(m);
}

function ensureStage(): Stage | null {
  if (stage) return stage;
  try {
    host = document.createElement("div");
    host.className = "dice-stage";
    host.hidden = true;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    host.appendChild(renderer.domElement);
    banner = document.createElement("div");
    banner.className = "dice-banner";
    host.appendChild(banner);
    flash = document.createElement("div");
    flash.className = "dice-flash";
    host.appendChild(flash);
    document.body.appendChild(host);

    const scene = new Scene();
    const camera = new PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 0, 9);
    scene.add(new AmbientLight(0xffe2c0, 0.55));
    const key = new DirectionalLight(0xffd7a0, 2.4);
    key.position.set(-3, 4, 6);
    scene.add(key);
    const rim = new DirectionalLight(0x6f8cff, 0.9);
    rim.position.set(4, -2, -3);
    scene.add(rim);
    const glow = new PointLight(0xffc060, 0, 8);
    glow.position.set(0, 0, 3);
    scene.add(glow);

    const { geometry, faces } = buildDie();
    const material = new MeshPhysicalMaterial({
      map: faceAtlas(),
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
      emissive: new Color(0x000000),
      flatShading: true,
    });
    const body = new Mesh(geometry, material);
    const edges = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: 0xe6b36a, transparent: true, opacity: 0.55 }));
    const die = new Group();
    die.add(body, edges);
    die.scale.setScalar(0.72);
    scene.add(die);

    window.addEventListener("resize", () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    });
    stage = { renderer, scene, camera, die, body, material, glow, faces };
    return stage;
  } catch {
    return null;
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function animate(duration: number, step: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const s = stage;
    if (!s) return resolve();
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      step(t);
      s.renderer.render(s.scene, s.camera);
      if (t < 1) raf = requestAnimationFrame(frame);
      else resolve();
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  });
}

function keptFace(roll: DiceRoll): number {
  if (roll.kept != null && roll.values[roll.kept] != null) return roll.values[roll.kept]!;
  return roll.values[0] ?? 1;
}

function outcomeWord(roll: DiceRoll): string {
  if (roll.purpose === "save") {
    if (roll.outcome === "success") return "SAVED";
    if (roll.outcome === "fail") return "FAILED";
  }
  switch (roll.outcome) {
    case "crit":
      return "CRITICAL HIT";
    case "fumble":
      return "FUMBLE";
    case "hit":
      return "HIT";
    case "miss":
      return "MISS";
    case "success":
      return "SUCCESS";
    case "fail":
      return "FAIL";
    default:
      return "";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function describeRoll(roll: DiceRoll): { headline: string; detail: string } {
  const natural = keptFace(roll);
  const mod = roll.modifier ? `${roll.modifier > 0 ? "+" : "−"} ${Math.abs(roll.modifier)}` : "";
  const vs = roll.vs ? ` vs ${roll.vs.kind} ${roll.vs.value}` : "";
  const word = outcomeWord(roll);
  const headline = `${roll.total}${vs}${word ? ` — ${word}` : ""}`;
  const pair =
    roll.values.length === 2 && roll.sides.every((s) => s === 20)
      ? ` · rolled ${roll.values.join(" and ")}, kept ${natural}`
      : "";
  const detail = `d20 ${natural}${mod ? ` ${mod}` : ""}${pair}`;
  return { headline, detail };
}

function showBanner(roll: DiceRoll, extra: DiceRoll[], tone: string) {
  if (!banner) return;
  const { headline, detail } = describeRoll(roll);
  const damage = extra
    .filter((r) => r.purpose === "damage" || r.purpose === "heal")
    .map((r) => `<span class="dice-dmg ${r.purpose}">${r.purpose === "heal" ? "Heals" : "Damage"} ${escapeHtml(r.notation)} → <strong>${r.total}</strong></span>`)
    .join("");
  banner.className = `dice-banner show ${tone}`;
  banner.innerHTML = `
    <p class="dice-who">${escapeHtml(roll.roller)} · ${escapeHtml(roll.label ?? roll.purpose)}</p>
    <p class="dice-headline">${escapeHtml(headline)}</p>
    <p class="dice-detail">${escapeHtml(detail)}</p>
    ${damage ? `<p class="dice-damage">${damage}</p>` : ""}
  `;
}

function flashScreen(kind: "crit" | "fumble") {
  if (!flash || reducedMotion()) return;
  flash.className = `dice-flash ${kind}`;
  void flash.offsetWidth;
  flash.classList.add("go");
}

async function play(roll: DiceRoll, extra: DiceRoll[], fast: boolean) {
  const s = ensureStage();
  const natural = keptFace(roll);
  const crit = roll.outcome === "crit" || (roll.isCrit && natural === 20);
  const fumble = roll.outcome === "fumble" || (roll.isFumble && natural === 1);
  const tone = crit ? "crit" : fumble ? "fumble" : roll.outcome === "hit" || roll.outcome === "success" ? "good" : roll.outcome ? "bad" : "neutral";
  if (!s || !host) {
    sfx("dice");
    return;
  }
  host.hidden = false;
  host.classList.remove("leaving");
  host.classList.add("on");
  banner!.className = "dice-banner";
  s.material.emissive.setHex(0x000000);
  s.glow.intensity = 0;
  s.die.scale.setScalar(0.72);
  const face = s.faces.find((f) => f.number === natural) ?? s.faces[0]!;
  const target = restingQuaternion(face);
  const calm = reducedMotion();
  const rest = new Vector3(0, 0.55, 0);

  if (calm) {
    s.die.quaternion.copy(target);
    s.die.position.copy(rest);
    await animate(260, () => undefined);
    sfx("diceSettle");
  } else {
    sfx("dice", { gain: 0.9 });
    const axis = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const spins = (fast ? 3 : 4.5) * Math.PI + Math.random() * Math.PI;
    const from = new Vector3(3.6 * (Math.random() < 0.5 ? -1 : 1), -2.6, 1.2);
    const duration = fast ? 750 : 1150;
    const spin = new Quaternion();
    await animate(duration, (t) => {
      const e = easeOut(t);
      spin.setFromAxisAngle(axis, spins * (1 - e));
      s.die.quaternion.copy(target).multiply(spin);
      const bounce = Math.abs(Math.cos(t * Math.PI * 3.2)) * (1 - t) * 1.4;
      s.die.position.set(from.x + (rest.x - from.x) * e, from.y + (rest.y - from.y) * e + bounce, from.z * (1 - e));
    });
    s.die.quaternion.copy(target);
    s.die.position.copy(rest);
    await animate(140, (t) => s.die.scale.setScalar(0.72 * (1 + Math.sin(t * Math.PI) * 0.08)));
  }

  showBanner(roll, extra, tone);

  if (crit) {
    sfx("crit");
    flashScreen("crit");
    s.material.emissive.setHex(0x8a4a00);
    await animate(calm ? 200 : 520, (t) => {
      s.glow.intensity = 30 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5);
      s.die.scale.setScalar(0.72 * (1 + 0.38 * easeOut(t)));
    });
    await wait(fast ? 900 : 1500);
  } else if (fumble) {
    sfx("fumble");
    flashScreen("fumble");
    s.material.emissive.setHex(0x101820);
    const base = s.die.quaternion.clone();
    const wobble = new Quaternion();
    await animate(calm ? 200 : 1100, (t) => {
      const angle = Math.sin(t * Math.PI * 5) * 0.35 * (1 - t);
      wobble.setFromAxisAngle(new Vector3(0, 0, 1), angle);
      s.die.quaternion.copy(base).multiply(wobble);
      s.die.position.y = rest.y - easeOut(t) * 0.35;
      s.die.scale.setScalar(0.72 * (1 - 0.12 * easeOut(t)));
    });
    await wait(fast ? 700 : 1100);
  } else {
    await wait(fast ? 850 : 1500);
  }

  host.classList.add("leaving");
  await wait(260);
  host.classList.remove("on", "leaving");
  host.hidden = true;
  banner!.className = "dice-banner";
}

/**
 * Roll the d20 of `roll` on screen. Rolls queue: a flurry of blows plays one die at a time.
 * `extra` carries the damage/heal rolls that ride on the banner.
 */
export function rollD20(roll: DiceRoll, opts: { extra?: DiceRoll[]; fast?: boolean } = {}): Promise<void> {
  const next = chain.then(() => play(roll, opts.extra ?? [], !!opts.fast));
  chain = next.catch(() => undefined);
  return next;
}

export function isD20(roll: DiceRoll | null | undefined): roll is DiceRoll {
  return !!roll && roll.sides?.length > 0 && roll.sides.every((s) => s === 20) && roll.values.length <= 2;
}

/** Load three.js' shader programs before the first roll so the first throw never stutters. */
export function warmDice() {
  const s = ensureStage();
  if (!s) return;
  s.renderer.compile(s.scene, s.camera);
}
