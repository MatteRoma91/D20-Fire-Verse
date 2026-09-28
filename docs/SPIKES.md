# Technical spikes

## 1. Renderer + D-pad — GO (2026-09-28)
- PixiJS 8 + Vite TV client builds; keyboard arrows/Enter/Esc implemented
- Canvas fallback remains in `tv/local` if dist missing
- **Follow-up:** measure 30 FPS on Vega simulator / Stick

## 2. Voice via companion — PARTIAL GO
- Intent buttons + mic stub → `VOICE_INTENT` on server
- No AWS Transcribe yet (no account)
- **Stop criterion for free STT:** unmet until Phase 3

## 3. Alexa lights — NO-GO for product
- Demo trick deferred; game playable without lights
