import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import { plainNarration, scriptLines } from "@d20-fireverse/protocol";
import { getManifest } from "../src/local/campaign.js";
import { CAMPAIGN_DIR } from "../src/local/paths.js";
import { createRoom, publicState } from "../src/local/room.js";
import { boot } from "./helpers.js";

before(boot);

test("narration splits into who-says-what, in order", () => {
  const lines = scriptLines("A gnome grins. [[glowkindle: Drink. Then we talk.]] He waits.");
  assert.deepEqual(lines, [
    { speaker: null, text: "A gnome grins." },
    { speaker: "glowkindle", text: "Drink. Then we talk." },
    { speaker: null, text: "He waits." },
  ]);
  assert.equal(plainNarration("He says: [[glowkindle: Go.]]"), "He says: “Go.”");
  assert.deepEqual(scriptLines("No one speaks here."), [{ speaker: null, text: "No one speaks here." }]);
});

test("every spoken line in the campaign belongs to someone in the cast", () => {
  const cast = getManifest().cast ?? {};
  const files = [path.join(CAMPAIGN_DIR, "nodes", "story.json"), path.join(CAMPAIGN_DIR, "encounters", "encounters.json")];
  const speakers = new Set<string>();
  for (const file of files) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/\[\[([a-z0-9_]+):/g)) speakers.add(m[1]!);
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\[\[[^\]]*\\n\\n[^\]]*\]\]/, "a spoken line never spans a blank line");
  }
  assert.ok(speakers.size >= 5, "the campaign gives its characters a voice");
  for (const id of speakers) {
    assert.ok(cast[id], `${id} speaks but has no cast entry`);
    assert.ok(cast[id]!.voice && cast[id]!.name && /^#[0-9a-f]{6}$/i.test(cast[id]!.color), `${id} is fully cast`);
  }
  const voices = Object.values(cast).map((c) => `${c.voice}:${c.pitch ?? 1}:${c.fx ?? ""}`);
  assert.equal(new Set(voices).size, voices.length, "no two characters sound the same");
});

test("the table learns who is speaking, never how the server voices them", () => {
  const state = publicState(createRoom());
  const glow = state.cast.glowkindle;
  assert.equal(glow?.name, "Glowkindle");
  assert.ok(glow && !("voice" in glow) && !("fx" in glow));
});
