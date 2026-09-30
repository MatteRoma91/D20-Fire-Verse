/**
 * Campaign packs live in memory as published versions.
 * A room pins the version it opened with, so a later publish does not rewrite the table.
 * Imports and the editor write a draft under data/campaigns; publishing clones that draft.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AbilityDef, EncounterDef, Manifest, MapDef, MonsterDef, Pregen, StoryNode } from "./campaign.js";
import { CAMPAIGN_DIR, CONTENT_ROOT, DATA_DIR, readJson } from "./paths.js";

export type CampaignRef = { campaignId: string; campaignVersion?: number };

export type Snapshot = {
  id: string;
  version: number;
  manifest: Manifest;
  nodes: Record<string, StoryNode>;
  pregens: Record<string, Pregen>;
  maps: Record<string, MapDef>;
  encounters: Record<string, EncounterDef>;
  monsters: Record<string, MonsterDef>;
  abilities: Record<string, AbilityDef>;
  artDir?: string;
};

type Index = {
  published: Record<string, number>;
  versions: Record<string, number[]>;
};

const BUILTIN = "luppolandia-brew";
const KNOWN_EFFECTS = new Set([
  "dash",
  "disengage",
  "dodge",
  "help",
  "hide",
  "search",
  "ready",
  "buff",
  "heal",
  "save",
  "attack",
  "auto_hit",
]);

const snapshots = new Map<string, Snapshot>();
const drafts = new Map<string, Snapshot>();
const published = new Map<string, number>();
const frames: CampaignRef[] = [];
let ready = false;
let baseAbilities: Record<string, AbilityDef> = {};

function key(id: string, version: number): string {
  return `${id}@${version}`;
}

function catalogRoot(): string {
  return path.join(DATA_DIR, "campaigns");
}

function indexPath(): string {
  return path.join(catalogRoot(), "index.json");
}

function readIndex(): Index {
  if (!fs.existsSync(indexPath())) return { published: {}, versions: {} };
  return readJson<Index>(indexPath());
}

function writeIndex(): void {
  const body: Index = { published: {}, versions: {} };
  for (const [id, version] of published) body.published[id] = version;
  for (const id of new Set([...snapshots.keys()].map((k) => k.split("@")[0]!))) {
    body.versions[id] = [...snapshots.keys()]
      .filter((k) => k.startsWith(`${id}@`))
      .map((k) => Number(k.split("@")[1]))
      .sort((a, b) => a - b);
  }
  fs.mkdirSync(catalogRoot(), { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(body, null, 2));
}

function loadAbilities(extraFile?: string): Record<string, AbilityDef> {
  const merged: Record<string, AbilityDef> = JSON.parse(JSON.stringify(baseAbilities));
  if (extraFile && fs.existsSync(extraFile)) {
    const extra = readJson<Record<string, AbilityDef>>(extraFile);
    for (const [id, ability] of Object.entries(extra)) {
      for (const effect of ability.effects ?? []) {
        if (!KNOWN_EFFECTS.has(String(effect.type))) throw new Error("BAD_ABILITY_EFFECT");
      }
      merged[id] = ability;
    }
  }
  return merged;
}

function readPackDir(dir: string, version: number): Snapshot {
  const manifest = readJson<Manifest>(path.join(dir, "manifest.json"));
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(manifest.id)) throw new Error("BAD_CAMPAIGN_ID");
  const nodes = readJson<Record<string, StoryNode>>(path.join(dir, "nodes", "story.json"));
  const maps = readJson<Record<string, MapDef>>(path.join(dir, "maps", "maps.json"));
  const encounters = readJson<Record<string, EncounterDef>>(path.join(dir, "encounters", "encounters.json"));
  const monsters = readJson<Record<string, MonsterDef>>(path.join(dir, "monsters.json"));
  const pregens: Record<string, Pregen> = {};
  const pregenDir = path.join(dir, "pregens");
  if (fs.existsSync(pregenDir)) {
    for (const name of fs.readdirSync(pregenDir)) {
      if (!name.endsWith(".json")) continue;
      const pregen = readJson<Pregen>(path.join(pregenDir, name));
      pregens[pregen.id] = pregen;
    }
  }
  const artDir = path.join(dir, "art");
  return {
    id: manifest.id,
    version,
    manifest,
    nodes,
    pregens,
    maps,
    encounters,
    monsters,
    abilities: loadAbilities(path.join(dir, "abilities.json")),
    artDir: fs.existsSync(artDir) ? artDir : undefined,
  };
}

function validate(snap: Snapshot): void {
  if (!snap.nodes[snap.manifest.startNodeId]) throw new Error("BAD_START_NODE");
  const nodes = snap.nodes;
  const known = (id: string | undefined, label: string) => {
    if (id && !nodes[id]) throw new Error(`DANGLING_${label}`);
  };
  for (const node of Object.values(nodes)) {
    for (const choice of node.choices ?? []) known(choice.next, "NEXT");
    known(node.onSuccess?.next, "NEXT");
    known(node.onFailure?.next, "NEXT");
    known(node.onVictory, "NEXT");
    if (node.encounterId && !snap.encounters[node.encounterId]) throw new Error("BAD_ENCOUNTER");
  }
  for (const encounter of Object.values(snap.encounters)) {
    if (!snap.maps[encounter.mapId]) throw new Error("BAD_MAP");
    for (const groups of Object.values(encounter.scaling)) {
      for (const group of groups) {
        if (!snap.monsters[group.monsterId]) throw new Error("BAD_MONSTER");
      }
    }
  }
}

function remember(snap: Snapshot): void {
  snapshots.set(key(snap.id, snap.version), snap);
}

export function initCatalog(): void {
  if (ready) return;
  ready = true;
  baseAbilities = readJson<Record<string, AbilityDef>>(path.join(CONTENT_ROOT, "abilities", "oneshot_v1.json"));
  const builtin = readPackDir(CAMPAIGN_DIR, 1);
  remember(builtin);
  published.set(builtin.id, 1);
  const index = readIndex();
  for (const [id, versions] of Object.entries(index.versions)) {
    for (const version of versions) {
      if (id === BUILTIN && version === 1 && !fs.existsSync(versionDir(id, 1))) continue;
      const dir = versionDir(id, version);
      if (!fs.existsSync(path.join(dir, "manifest.json"))) continue;
      remember(readPackDir(dir, version));
    }
  }
  for (const [id, version] of Object.entries(index.published)) {
    if (snapshots.has(key(id, version))) published.set(id, version);
  }
  fs.mkdirSync(catalogRoot(), { recursive: true });
  for (const name of fs.existsSync(catalogRoot()) ? fs.readdirSync(catalogRoot()) : []) {
    const draftDir = path.join(catalogRoot(), name, "draft");
    if (name.startsWith(".")) continue;
    if (fs.existsSync(path.join(draftDir, "manifest.json"))) {
      const draft = readPackDir(draftDir, 0);
      drafts.set(draft.id, draft);
    }
  }
  if (!fs.existsSync(indexPath())) writeIndex();
}

function versionDir(id: string, version: number): string {
  return path.join(catalogRoot(), id, `v${version}`);
}

function draftDir(id: string): string {
  return path.join(catalogRoot(), id, "draft");
}

export function bindFrame(ref: CampaignRef): () => void {
  frames.push(ref);
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    const i = frames.lastIndexOf(ref);
    if (i >= 0) frames.splice(i, 1);
  };
  queueMicrotask(leave);
  return leave;
}

export function currentSnapshot(): Snapshot {
  initCatalog();
  const frame = frames.at(-1);
  if (frame) return snapshotFor(frame);
  const id = published.has(BUILTIN) ? BUILTIN : [...published.keys()][0];
  if (!id) throw new Error("NO_CAMPAIGN");
  return snapshotFor({ campaignId: id, campaignVersion: published.get(id) });
}

export function snapshotFor(ref: CampaignRef): Snapshot {
  initCatalog();
  const version = ref.campaignVersion ?? published.get(ref.campaignId);
  if (version == null) throw new Error("CAMPAIGN_NOT_FOUND");
  const snap = snapshots.get(key(ref.campaignId, version));
  if (!snap) throw new Error("CAMPAIGN_NOT_FOUND");
  return snap;
}

export function publishedVersion(id: string): number | undefined {
  initCatalog();
  return published.get(id);
}

export function listPublished(): Array<{ id: string; title: string; version: number }> {
  initCatalog();
  const out: Array<{ id: string; title: string; version: number }> = [];
  for (const [id, version] of published) {
    const snap = snapshots.get(key(id, version));
    if (snap) out.push({ id, title: snap.manifest.title, version });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export function listCampaigns(): Array<{
  id: string;
  title: string;
  publishedVersion: number | null;
  draft: boolean;
}> {
  initCatalog();
  const ids = new Set<string>([...published.keys(), ...drafts.keys()]);
  for (const k of snapshots.keys()) ids.add(k.split("@")[0]!);
  return [...ids].sort().map((id) => {
    const version = published.get(id) ?? null;
    const snap = version != null ? snapshots.get(key(id, version)) : drafts.get(id);
    return {
      id,
      title: snap?.manifest.title ?? id,
      publishedVersion: version,
      draft: drafts.has(id),
    };
  });
}

export function artDirFor(id: string): string | undefined {
  initCatalog();
  const version = published.get(id);
  if (version == null) return drafts.get(id)?.artDir;
  return snapshots.get(key(id, version))?.artDir;
}

function writePack(dir: string, snap: Snapshot): void {
  fs.mkdirSync(path.join(dir, "nodes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "maps"), { recursive: true });
  fs.mkdirSync(path.join(dir, "encounters"), { recursive: true });
  fs.mkdirSync(path.join(dir, "pregens"), { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(snap.manifest, null, 2));
  fs.writeFileSync(path.join(dir, "nodes", "story.json"), JSON.stringify(snap.nodes, null, 2));
  fs.writeFileSync(path.join(dir, "maps", "maps.json"), JSON.stringify(snap.maps, null, 2));
  fs.writeFileSync(path.join(dir, "encounters", "encounters.json"), JSON.stringify(snap.encounters, null, 2));
  fs.writeFileSync(path.join(dir, "monsters.json"), JSON.stringify(snap.monsters, null, 2));
  for (const pregen of Object.values(snap.pregens)) {
    fs.writeFileSync(path.join(dir, "pregens", `${pregen.id}.json`), JSON.stringify(pregen, null, 2));
  }
  const extra: Record<string, AbilityDef> = {};
  for (const [id, ability] of Object.entries(snap.abilities)) {
    if (!baseAbilities[id] || JSON.stringify(baseAbilities[id]) !== JSON.stringify(ability)) extra[id] = ability;
  }
  if (Object.keys(extra).length) fs.writeFileSync(path.join(dir, "abilities.json"), JSON.stringify(extra, null, 2));
  if (snap.artDir && path.resolve(snap.artDir) !== path.resolve(path.join(dir, "art"))) {
    fs.cpSync(snap.artDir, path.join(dir, "art"), { recursive: true });
  }
}

function cloneSnap(snap: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(snap)) as Snapshot;
}

export function ensureDraft(id: string): Snapshot {
  initCatalog();
  const existing = drafts.get(id);
  if (existing) return existing;
  const version = published.get(id);
  if (version == null) throw new Error("CAMPAIGN_NOT_FOUND");
  const draft = cloneSnap(snapshotFor({ campaignId: id, campaignVersion: version }));
  draft.version = 0;
  drafts.set(id, draft);
  writePack(draftDir(id), draft);
  return draft;
}

export function draftSnapshot(id: string): Snapshot {
  return ensureDraft(id);
}

export function updateDraftNode(id: string, node: StoryNode): Snapshot {
  const draft = ensureDraft(id);
  if (!node.id || node.id !== node.id.trim()) throw new Error("BAD_NODE");
  draft.nodes[node.id] = node;
  writePack(draftDir(id), draft);
  return draft;
}

export function updateDraftEncounter(id: string, encounter: EncounterDef): Snapshot {
  const draft = ensureDraft(id);
  if (!encounter.id) throw new Error("BAD_ENCOUNTER");
  draft.encounters[encounter.id] = encounter;
  writePack(draftDir(id), draft);
  return draft;
}

export function publishCampaign(id: string): Snapshot {
  const draft = ensureDraft(id);
  validate(draft);
  const next = Math.max(0, ...[...snapshots.keys()].filter((k) => k.startsWith(`${id}@`)).map((k) => Number(k.split("@")[1]))) + 1;
  const snap = cloneSnap(draft);
  snap.version = next;
  const dir = versionDir(id, next);
  writePack(dir, snap);
  const art = path.join(dir, "art");
  snap.artDir = fs.existsSync(art) ? art : draft.artDir;
  remember(snap);
  published.set(id, next);
  writeIndex();
  return snap;
}

export function unpublishCampaign(id: string): void {
  initCatalog();
  if (!published.has(id)) return;
  published.delete(id);
  writeIndex();
}

function unzip(buf: Buffer, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const tmp = path.join(os.tmpdir(), `fireverse-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`);
  fs.writeFileSync(tmp, buf);
  const script = `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
for name in z.namelist():
    parts = name.replace("\\\\", "/").split("/")
    if name.startswith("/") or any(p == ".." for p in parts):
        raise SystemExit(2)
z.extractall(sys.argv[2])
`;
  const run = spawnSync("python3", ["-c", script, tmp, dest], { encoding: "utf8" });
  fs.unlinkSync(tmp);
  if (run.status !== 0) throw new Error("BAD_ZIP");
}

function findManifestDir(root: string): string {
  if (fs.existsSync(path.join(root, "manifest.json"))) return root;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, "manifest.json"))) return dir;
  }
  throw new Error("BAD_ZIP");
}

export function importCampaignZip(buf: Buffer): Snapshot {
  initCatalog();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fireverse-camp-"));
  try {
    unzip(buf, tmp);
    const src = findManifestDir(tmp);
    const snap = readPackDir(src, 0);
    validate(snap);
    const dest = draftDir(snap.id);
    fs.rmSync(dest, { recursive: true, force: true });
    writePack(dest, snap);
    const artSrc = path.join(src, "art");
    if (fs.existsSync(artSrc)) fs.cpSync(artSrc, path.join(dest, "art"), { recursive: true });
    snap.artDir = fs.existsSync(path.join(dest, "art")) ? path.join(dest, "art") : undefined;
    drafts.set(snap.id, snap);
    return snap;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
