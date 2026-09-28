# D20 FireVerse

The TV is the table: online co-op **5E-compatible** d20 RPG for Amazon Fire TV. Authored adventure, server-authoritative combat, a console-scale board (dice, room light, room tone), and a companion that can speak a short command.

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

- [Title, story, move, longsword dice](docs/videos/potent_brew_story_move_and_longsword_dice.mp4) (42s, 9.7 MB)
- [Sable Voss — SRD 5.1 character creation](docs/videos/sable_voss_srd_character_creation.mp4) (29s, 1.6 MB)

## Monorepo

| Path | Role |
|------|------|
| `packages/protocol` | WebSocket contract |
| `packages/rules` | Pathfinding / dice helpers |
| `tv/` | Vite + PixiJS Fire TV client |
| `backend/` | Local Express + WS game server |
| `companion/` | Sheet + voice intents |
| `content/` | Luppolandia brew campaign |

## License
MIT · SRD attribution in [ATTRIBUTION.md](ATTRIBUTION.md)
