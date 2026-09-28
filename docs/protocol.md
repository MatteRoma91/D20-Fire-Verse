# Protocol (draft)

Version: 0.1.0

All game-authoritative events are server-emitted. Clients propose intents.

## Client → Server (examples)
- `AUTH_LOGIN` `{ username, password }`
- `CREATE_ROOM` `{ campaignId, characterId }`
- `JOIN_ROOM` `{ roomCode, characterId }`
- `CAST_STORY_VOTE` `{ roomId, nodeId, choiceId }`
- `PROPOSE_MOVE` `{ roomId, path: [{x,y}, ...] }`
- `PERFORM_ACTION` `{ roomId, type, payload }`  // no client dice authority
- `END_TURN` `{ roomId }`
- `REQUEST_SAVE` `{ roomId }`
- `CHOOSE_DEATH_OUTCOME` `{ roomId, outcome: "RELOAD_SAVE" | "END_RUN" }`
- `ALEXA_RETRY` `{ roomId }`

## Server → Client (examples)
- `ROOM_STATE`
- `STORY_NODE` `{ nodeId, text, choices[], subtitles }`
- `VOTE_STATE` / `VOTE_RESULT` `{ votes, tieBreakRolls?, selectedChoiceId }`
- `STATE_UPDATE` `{ turn, initiative, gridState, fxToRender, characters }`
- `DICE_REVEAL` `{ rollerId, notation, values[], total }` // for synced TV animation
- `NARRATION` `{ text, audioUrl }`
- `ALEXA_HINT` `{ lightColorHex?, lightPulse?, ambientTrack?, volume? }`
- `SAVE_ACK`
- `ERROR` `{ code, message }`
