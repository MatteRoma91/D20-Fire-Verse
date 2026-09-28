# D20 FireVerse

The TV is the table: a **5E-compatible** d20 RPG for the living room, built for Amazon Fire TV and a
plain remote. Nobody has to run the game. The server rolls every die in the open, a neural narrator
reads every scene aloud with synced subtitles, and the party decides the rest — from the couch with
the D-pad, or from their phones.

**North star:** a Fire TV Stick and Alexa as one fully immersive table — screen, remote, voice,
lights and Echo on the same server. See [`docs/NORTH_STAR.md`](docs/NORTH_STAR.md).

## Run it

```bash
npm install
npm run build          # TV + companion bundles
npm run dev:backend    # table server on http://127.0.0.1:3100/ (serves the built TV and /companion)
```

For development, run the hot-reload clients next to the server:

```bash
npm run dev:tv         # http://127.0.0.1:4317/            proxies /ws and /api to :3100
npm run dev:companion  # http://127.0.0.1:4319/companion/  the phone seat
```

Checks (the same as CI):

```bash
npm run typecheck && NARRATION=off npm test && npm run build
```

More: [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) · [`docs/SHIP_CHECKLIST.md`](docs/SHIP_CHECKLIST.md)

## The adventure

*A Very Potent Brew* is a one-shot of about fifteen minutes to the boss: a job at the tavern, the
descent into the Wizard's Tower brewery, a mosaic hub with three seals to win (tile, vessel, well and
alchemy puzzles, plus rat and centipede fights), the Infernal Spider behind the Door of Three Seals,
and a Magma Rat cliffhanger. Every scene is a checkpoint: **Continue** on the title screen picks the
table back up, and a lost table resumes from its last autosave.

Heroes are four painted SRD pregens (level 3) or your own, forged on the TV from SRD 5.1 rules —
race, class, background, ability scores (standard array, point buy or 4d6-drop-lowest, with a
one-press "Recommended for {class}" layout), skills, spells, name and portrait.

## The remote is all you need

| Key | At the table |
|-----|--------------|
| D-pad | Move between choices · aim on the board |
| OK / Select | Choose · in combat: move to the cursor or strike what it's on |
| Back | Cancel · step out of a menu |
| Menu | Settings (volumes, voice, subtitles, motion, contrast, remote guide) |
| Play/Pause | Hear the last line again · in combat: end turn |
| Rewind / Fast-forward | Sheet tabs in combat |

On a keyboard: arrows, Enter, Esc/Backspace, `S` (settings), `M` (music), `1`–`9` (choices).

In combat the cursor starts on the best target: **OK** walks you into reach, **OK** again strikes
with your ★ attack. Every other action (Dash, Dodge, spells, potions…) waits below the board — press
**▼**. Foe turns play out step by step, and every roll lands a 3D d20 on the server's value with the
result stated against the target's AC (HIT / MISS / CRITICAL). A first-fight coach explains each step
once; *Settings → Show first-fight tips again* brings it back.

## Phones (companion)

The title and lobby show a QR code. Scanning it opens `/companion/` on the table's LAN address: pick a
hero to take a seat, tap story choices, roll skill checks, and on your turn attack, cast or end the
turn — or speak a short command. A phone seat survives screen locks and reloads (it rejoins on its
own). The TV can host a phone-only party: *Begin with the phone players* in the lobby, or just let a
phone make the first choice and the TV follows.

If a seated player drops mid-fight for more than 20 s (`DROP_GRACE_MS`) while others are still at
the table, their hero Dodges and passes the turn so nobody is held hostage. If nobody is watching,
the table simply pauses.

## Narrator voice

Narration is rendered **on the table server** with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
(Apache-2.0) through `kokoro-js`: a neural English voice, cached on disk by text hash in
`backend/data/narration/`, served as AAC with per-sentence timings so the TV highlights each line as
it is spoken (karaoke subtitles). The first boot downloads the quantized ONNX model (~92 MB, cached by transformers.js under
`node_modules/@huggingface/transformers/.cache/`) and pre-renders
the adventure's scripted lines in the background; after that every line is instant.

| Variable | Default | Meaning |
|----------|---------|---------|
| `NARRATION` | on | `off` disables the neural voice (tests, low-power hosts) |
| `NARRATOR_VOICE` | `bm_george` | Any Kokoro voice id |
| `NARRATOR_SPEED` | `0.94` | Speaking rate |
| `NARRATOR_MODEL` | `onnx-community/Kokoro-82M-v1.0-ONNX` | Hugging Face model id |

Without the model (offline, `NARRATION=off`, or a failed render) the TV falls back to the device's
speech synthesis, and subtitles always show. `ffmpeg` on `PATH` is used for AAC; without it clips
are served as WAV.

## Sound

- **Score** — seven original looping cues that crossfade with the scene and duck under the narrator,
  written and synthesized in [`tools/music/compose.py`](tools/music/compose.py).
- **Effects** — dice, blades, arrows, claws, spells, hits, deaths, footsteps and UI ticks, all
  synthesized by [`tools/sfx/render.py`](tools/sfx/render.py). Nothing is sampled.

```bash
pip install -r tools/music/requirements.txt && python3 tools/music/compose.py
pip install -r tools/sfx/requirements.txt   && python3 tools/sfx/render.py
```

| Cue | Plays on |
|-----|----------|
| A Very Potent Brew | Title screen |
| Jig at the Wizard's Tower | Lobby, tavern scenes |
| What Lies Beneath | Brewery rooms, puzzles |
| Noise from the Deep | Ember beats before fights |
| Steel in the Cellar | Combat |
| The Infernal Weaver | Spider and magma fights |
| Three Seals, One Toast | Victory |

## Accessibility

Settings (Menu) persist per TV: music / narrator / effects volumes, spoken or silent narrator,
subtitles on/off and size, **reduced motion** (no camera moves, Ken Burns or shake; the die snaps to
its face), and **high-contrast board** (brighter reach cells, thicker rings and outlines). Errors are
written for people, never as server codes.

## Walkthroughs

Downloadable captures of the running table, driven only with the remote:

- [Highlights (6 min): forge, narrated tavern, cellar fight, vessels, the boss, the toast](docs/videos/aaa_highlights.mp4)
- [The whole adventure (22 min): title to *Adventure Complete* — forge, tavern, mosaic, three seals, ambushes, Infernal Spider, Magma Rat](docs/videos/aaa_remote_only_walkthrough.mp4)
- [Title, story, move, longsword dice](docs/videos/potent_brew_story_move_and_longsword_dice.mp4) (earlier build)
- [Sable Voss — SRD 5.1 character creation](docs/videos/sable_voss_srd_character_creation.mp4) (earlier build)

## Monorepo

| Path | Role |
|------|------|
| `packages/protocol` | WebSocket contract and human-readable error copy |
| `packages/rules` | Pathfinding / dice helpers |
| `backend/` | Express + WebSocket table server: rules, combat, saves, narration |
| `tv/` | Vite + PixiJS + three.js Fire TV client |
| `companion/` | Phone seat |
| `content/` | The Luppolandia brew campaign and SRD data |
| `tools/music/`, `tools/sfx/` | Score and effects renderers |

## License

MIT · SRD 5.1 and third-party credits in [ATTRIBUTION.md](ATTRIBUTION.md)
