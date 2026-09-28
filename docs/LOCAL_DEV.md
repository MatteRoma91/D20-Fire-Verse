# Local development (no AWS)

## Quick start

```bash
cd /home/ubuntu/D20-Fire-Verse
npm install

# Terminal A — authoritative game server
npm run dev:backend
# http://127.0.0.1:3100  (serves tv/dist if built, else tv/local)

# Terminal B — PixiJS TV (hot reload; proxies WS to :3100)
npm run dev:tv
# http://127.0.0.1:4317/

# Terminal C — companion sheet + intents
npm run dev:companion
# http://127.0.0.1:4319/
```

Rebuild TV into backend static:

```bash
npm run build:tv
# then restart backend — serves tv/dist
```

## Ports
| Service | Port |
|---------|------|
| Backend WS + API + static TV | 3100 |
| Vite TV (Pixi) | 4317 |
| Vite companion | 4319 |

If 3100 is stuck: `fuser -k 3100/tcp`

## Play
1. Open TV (4317 or 3100)
2. Create room → Join pregen
3. Story → grid combat (Pixi): arrows + Enter, click enemy
4. Companion: same room code + player id `P1`, Connect, use intent buttons
5. Save / Resume on TV panel

## Protocol additions (Phase 1–2)
`REQUEST_SAVE`, `RESUME_SAVE`, `VOICE_INTENT`, disconnect Dodge, guided ★ actions.

## Still deferred (Phase 3)
AWS API GW, DynamoDB, Polly, Transcribe, Alexa demo.
