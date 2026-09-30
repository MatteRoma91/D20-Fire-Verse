# Protocol (local table)

Version: 0.2.0 (Fire Stick + companion)

All game-authoritative events are server-emitted. Clients propose intents; the server resolves and broadcasts `ROOM_STATE`.

## Client → Server

### Table life
- `CREATE_ROOM` `{ campaignId }`
- `JOIN_ROOM` `{ roomCode, characterId, displayName? }`
- `REJOIN` `{ roomCode, playerId? }`
- `LEAVE_SEAT` / companion seat clear via rejoin without `playerId`

### Story
- `CHOOSE` `{ roomCode, playerId?, choiceId }` — solo applies immediately; with 2+ seats becomes a host/remote vote cast
- `CAST_VOTE` `{ roomCode, playerId, choiceId }` — seat vote on a choice (hub included). Closes when all seated vote, after ~20s, or `CLOSE_VOTE`
- `CLOSE_VOTE` `{ roomCode, playerId }` — host/TV “Decide now”
- Tie: server rolls a d20 among tied options and shows it in the shared dice tray

### Skill checks
- `VOLUNTEER_CHECK` `{ roomCode, playerId, help? }` — first volunteer rolls with **their** modifier; `help: true` grants advantage from an ally. No silent `bestPlayer` roll.

### Puzzles
- `CLAIM_PUZZLE` `{ roomCode, playerId }` — first claimer is the only hand whose `SOLVE_PUZZLE` / mosaic `CHOOSE` counts
- `RELEASE_PUZZLE` `{ roomCode, playerId }` — pass the mechanism
- `PUZZLE_HINT` `{ roomCode, playerId, slot, optionId }` — soft suggest (alone + initial); does **not** increment fails or submit
- `PUZZLE_DRAFT` `{ roomCode, playerId, puzzleDraft: string[] }` — shared draft on the room
- `SOLVE_PUZZLE` `{ roomCode, playerId, sequence: string[] }` — holder only

Designer `hint` strings that contain the full solution stay out of UI/voice; after a fail the server may surface `nudge`.

## Server → Client
- `HELLO` `{ pregens }`
- `SEAT` `{ playerId }`
- `ROOM_STATE` — includes `speaker`, `vote`, `checkOffer`, puzzle coop (`holderId`, `hints`, `draft`, well `history` / `lastScore`, `poem`, `nudge`), `lastDice`, combat, map
- `CHARACTER_CREATED`
- `ERROR` `{ code, action? }` — human copy via `describeError` in `@d20-fireverse/protocol`

## ROOM_STATE highlights
- `speaker?: { id, name, portrait }` — Glowkindle / messenger on dialogue nodes
- `vote?: { nodeId, votes[], closesAt, remainingMs }`
- `checkOffer?: { roster[{ playerId, name, bonus }], volunteers, helpers, remainingMs }`
- `puzzle.holderId` / `hints` / `draft` / Mastermind pearls for the well
