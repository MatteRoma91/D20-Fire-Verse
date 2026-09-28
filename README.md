# D20 FireVerse

The TV is the table: online co-op **5E-compatible** d20 RPG for Amazon Fire TV. Authored adventure, server-authoritative combat, a console-scale board (dice, room light, an original score), and a companion that can speak a short command.

**North star:** a Fire TV Stick and Alexa as one fully immersive table — screen, remote, voice, lights, and Echo on the same server. See [`docs/NORTH_STAR.md`](docs/NORTH_STAR.md).

> Hackathon due **2026-10-23**. Local-first until AWS exists.

## Run (local)

```bash
npm install
npm run dev:backend    # http://127.0.0.1:3100/  (built TV, if present)
npm run dev:tv         # http://127.0.0.1:4317/  hot reload, proxies the table
npm run dev:companion  # http://127.0.0.1:4319/  sheet + voice
```

Full notes: [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) · Ship: [`docs/SHIP_CHECKLIST.md`](docs/SHIP_CHECKLIST.md)

## Walkthroughs

Downloadable captures of the running table:

- [Title, story, move, longsword dice](docs/videos/potent_brew_story_move_and_longsword_dice.mp4)
- [Sable Voss — SRD 5.1 character creation](docs/videos/sable_voss_srd_character_creation.mp4)

## Score

Seven original looping cues follow the table: the title, the tavern, the descent, tension beats, combat, the boss and the victory toast. The TV crossfades between them, ducks under the narration voice, and **M** (or the Music pill) mutes.

| Cue | Plays on | File |
|-----|----------|------|
| A Very Potent Brew | Title screen | [`title.ogg`](tv/public/audio/music/title.ogg) · [`.m4a`](tv/public/audio/music/title.m4a) |
| Jig at the Wizard's Tower | Lobby, tavern scenes | [`tavern.ogg`](tv/public/audio/music/tavern.ogg) · [`.m4a`](tv/public/audio/music/tavern.m4a) |
| What Lies Beneath | Brewery rooms, puzzles | [`descent.ogg`](tv/public/audio/music/descent.ogg) · [`.m4a`](tv/public/audio/music/descent.m4a) |
| Noise from the Deep | Ember beats before fights | [`tension.ogg`](tv/public/audio/music/tension.ogg) · [`.m4a`](tv/public/audio/music/tension.m4a) |
| Steel in the Cellar | Combat | [`combat.ogg`](tv/public/audio/music/combat.ogg) · [`.m4a`](tv/public/audio/music/combat.m4a) |
| The Infernal Weaver | Spider and magma fights | [`boss.ogg`](tv/public/audio/music/boss.ogg) · [`.m4a`](tv/public/audio/music/boss.m4a) |
| Three Seals, One Toast | Victory | [`victory.ogg`](tv/public/audio/music/victory.ogg) · [`.m4a`](tv/public/audio/music/victory.m4a) |

Every note is written and synthesized in [`tools/music/compose.py`](tools/music/compose.py), so the score is reproducible and owned by the project:

```bash
pip install -r tools/music/requirements.txt   # numpy, scipy; ffmpeg on PATH
python3 tools/music/compose.py                # or: --only tavern boss
```

## Monorepo

| Path | Role |
|------|------|
| `packages/protocol` | WebSocket contract |
| `packages/rules` | Pathfinding / dice helpers |
| `tv/` | Vite + PixiJS Fire TV client |
| `backend/` | Local Express + WS game server |
| `companion/` | Sheet + voice intents |
| `content/` | Luppolandia brew campaign |
| `tools/music/` | Score composer (renders `tv/public/audio/music`) |

## License
MIT · SRD attribution in [ATTRIBUTION.md](ATTRIBUTION.md)
