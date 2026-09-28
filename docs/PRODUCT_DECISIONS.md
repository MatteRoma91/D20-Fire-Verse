# Product decisions (locked) — hackathon v1

Last update: 2026-09-28 (full oneshot restored)  
Product: **D20 FireVerse** · Repo: **D20-Fire-Verse**  
Deadline: **2026-10-23 12:00 PT**

## North star
Fire TV Stick and Alexa as one fully immersive table: screen, remote, voice, lights, and Echo driven by the same server state. Canonical text: [`NORTH_STAR.md`](NORTH_STAR.md). The rows below are the hackathon slice, not a replacement for that goal.

## One-sentence product
The television is the table: 1–3 friends join a room from different homes, play the full Luppolandia brewery oneshot (*A Very Potent Brew* / *Una Birra Molto Potente*) with remote (and optional voice), server dice, Polly narration — no human GM.

## What players get in v1
| Piece | Spec |
|--------|------|
| Adventure | **Full oneshot** from `/home/ubuntu/oneshot` (~2.5–3.5 h): hub, 3 seals free-order, lab boss, magma exit |
| Characters | 4 pregens **or** SRD chargen levels 1–3 |
| Combat | Cellar rats, hole ambushes, well centipedes, Infernal Spider, Magma Rat |
| Multiplayer | Room code; 1–3 players; solo OK |
| Story | Faithful v9 path + TV sequence puzzles (tiles, vessels, well lock, vials, mixture) |
| Input | D-pad first; destination-select movement (server path, 5/10/5 diagonals) |
| Voice | Companion mic → Transcribe → rigid intents (if spike OK); else Alexa skill fallback or omit |
| Audio | Polly + subtitles always (browser TTS until Polly) |
| Lights | Optional demo on *our* Alexa account if spike OK |
| Save | Resume mid-run; disconnect = Dodge + skip turn |
| Guided mode | Recommended actions highlighted |

## Explicitly cut from v1
Full SRD to L20 · map editor · shops · systemic loot/level-up · Cognito/accounts · shipping “control user’s Alexa home” · dual Appstore as must · AI GM · pixel-perfect Arcana console (same puzzle solutions, TV buttons)

## Architecture (unchanged intent)
- Web TS client (PixiJS) on Vega/Fire OS WebView
- Shared `packages/rules` typed-effect engine (sparse content)
- Local Express+WS now; later API GW WebSocket + Lambda + DynamoDB + S3 + Polly (+ Transcribe)
- Keepalive pings; optimistic room versioning; no Lambda in VPC

## Legal
- Transcribe needed SRD lines from **official SRD PDF** + CC-BY attribution
- Do not copy 5e-database wholesale
- MIT repo; no WotC trademarks / non-SRD creatures

## Success metrics (ship gate)
1. Outsider finishes a fight on simulator with remote only, no developer coaching
2. Two clients stay in sync through disconnect/reconnect
3. Demo video shows hub → seal → combat without showstopper bugs

## Campaign (selected)
- `content/campaigns/luppolandia-brew/` — English presentation of `/home/ubuntu/oneshot` **v9**
- Path: Stairs → Mosaic (tiles) → Cellar / Well / Store (free order) → Lab vault → Infernal Spider → Magma Rat → Epilogue
- 4 pregens L3 + custom chargen

## Post-hackathon (not scheduled)
Widen catalog on same effect schema; deeper Arcana console parity; ambient integrations if APIs exist.
