# North star

**D20 FireVerse exists to join a Fire TV Stick and Alexa into one fully immersive table.**

The living room is the game. The Fire Stick is the eyes: map, tokens, dice, character sheet, and combat on the television. Alexa is the rest of the body: she speaks the room, she hears the players, and the house answers the fiction. Lights, Echo audio, and voice sit on the same authoritative server as the dice. No human game master. Friends in different homes share one room, each on their own Stick and their own Alexa.

## What “fully immersive” means

| Sense | Device | Job |
|---|---|---|
| Sight | Fire TV Stick (Fire OS or Vega OS) | The dungeon, the pawns, the puzzles, the fight grid, the sheet |
| Hands | Fire remote | Move, choose, confirm. The screen is playable with the remote alone |
| Voice out | Alexa / Echo | Narration and room tone, in sync with the server text (Polly or the skill) |
| Voice in | Alexa | Short intents: choose, move, attack, end turn. The server resolves them; the client does not invent the outcome |
| Atmosphere | Alexa-linked lights and Echo | Scene color and ambient audio follow the node: tavern, cellar, combat, boss, victory |

A session is immersive when those layers fire together from one room state. A dice roll on the server is the same roll the television animates, the same roll Alexa speaks, and the same moment the lights flash.

## What this is not

The product goal is this integration. The hackathon slice that must ship by **2026-10-23** is the playable table on screen, described in [`PRODUCT_DECISIONS.md`](PRODUCT_DECISIONS.md). Alexa atmosphere stays in the design even when a given build cannot yet drive a customer’s devices. If a spike shows that a third-party app cannot command lights or Echo audio directly, the goal stays; the path changes (skill, routines, or a documented friction-log gap), and play on the Stick continues.

Each player binds the devices in **their** room. The default is never “the whole house.”
