# Campaign: A Very Potent Brew (`luppolandia-brew`)

Hackathon v1 cut of **Una Birra Molto Potente** (Luppolandia / `/home/ubuntu/oneshot`).

## Player experience (~20 min)
1. Tavern notice → Glowkindle (Tashalar Pale Ale)
2. Descend into buried tower / mosaic corridor
3. Perception check on the threshold hole
4. **Fight 1:** giant rats (scaled 1–3 players)
5. Short rest offer + potions
6. Simplified **one seal** (Investigation; fail → fire splash)
7. **Fight 2:** Infernal Spider (boss)
8. Cliffhanger → optional Magma Rat **or** save for later

## Files
| Path | Role |
|------|------|
| `manifest.json` | Campaign meta + flow |
| `nodes/story.json` | Story / skill / encounter nodes (English) |
| `encounters/encounters.json` | Two required fights + optional magma |
| `monsters.json` | Stat blocks used |
| `pregens/*.json` | Four level-3 pregens |
| `maps/maps.json` | Stub grids |
| `../../abilities/oneshot_v1.json` | Typed abilities for this slice |

## Cut from full oneshot
- Full Arcana console (tiles / vials / 14 reagents / three seals)
- Centipede waves, DM-only admin UI
- Italian copy; WotC brand terms

## Still TODO for engine
- Wire node runner + encounter loader
- Implement ability ids in `packages/rules`
- Polly lines from `narration.text`
- Art pass on maps
