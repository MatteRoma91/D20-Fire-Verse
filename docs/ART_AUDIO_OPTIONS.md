# Art & audio options (decide before content freeze)

## Art

### A) Geometric placeholders (shapes, flat tokens)
- **Pros:** Fastest; clear readability on TV; zero license risk; good for systems work.
- **Cons:** Weak pitch visuals; less “finished product” feel.
- **Best when:** First 2 weeks / combat & netcode priority.

### B) CC0 / permissive packs (e.g. Kenney, OpenGameArt with compatible license)
- **Pros:** Speedy “real game” look; cheap; fits MIT repo if licenses tracked in ATTRIBUTION.
- **Cons:** Generic fantasy look; must verify each file’s license; mixed styles.
- **Best when:** Default recommendation for hackathon polish.

### C) Curated itch.io / commercial royalty-free pack (paid once)
- **Pros:** Cohesive style; better screenshots/video.
- **Cons:** Cost (conflicts with $0 budget unless someone sponsors); license must allow MIT distribution of the *game* (check redistribution terms).
- **Best when:** Budget appears or a teammate already owns a pack.

### D) AI-generated sprites/backgrounds
- **Pros:** Fast volume of assets.
- **Cons:** Style inconsistency; Amazon/hackathon optics mixed; licensing unclear for some tools; cleanup time often exceeds savings.
- **Best when:** Only for throwaway mockups — not recommended as primary pipeline.

### E) Human artist (commission / teammate)
- **Pros:** Unique brand; best impression.
- **Cons:** Time and coordination risk before 2026-10-23.
- **Best when:** Parallel track for hero logo + 5 key scenes only.

**Suggestion:** Ship **A→B**: placeholders until grid/combat works, then replace with one CC0 pack + custom logo.

## Music / SFX

### 1) Silence + Polly + minimal UI SFX
- **Pros:** $0; no license work; focuses on narration demo.
- **Cons:** Feels empty between lines.
- **Best when:** Absolute budget lock.

### 2) CC0 / CC-BY music + SFX packs
- **Pros:** Free immersion; ATTRIBUTION only; Echo ambience ready.
- **Cons:** Quality varies; looping needs care.
- **Best when:** **Recommended default** with Alexa ambience.

### 3) Paid library (Epidemic-style / game music pack)
- **Pros:** Consistent quality.
- **Cons:** Cost; some licenses forbid certain distribution — read carefully.
- **Best when:** Budget unlocked.

### 4) Original composer (teammate)
- **Pros:** Unique; great story fit.
- **Cons:** Schedule risk.
- **Best when:** One theme + combat loop only.

### 5) Procedural / chiptune simple loops in-engine
- **Pros:** Tiny footprint; no external deps.
- **Cons:** Aesthetic may not match fantasy RPG pitch.
- **Best when:** Fallback if packs delay.

**Suggestion:** **(2)** for music/ambience + tiny UI SFX pack; Polly for speech; keep volumes separable (Narration / SFX / Ambience / Echo).
