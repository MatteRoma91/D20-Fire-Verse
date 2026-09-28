# Friction log

Up to 10% judging bonus. One entry per issue.

| Date | Task attempted | Steps taken | Expected | Actual | Severity | Workaround | Suggestion |
|------|----------------|-------------|----------|--------|----------|------------|------------|
| 2026-09-28 | Local Express+WS on VPS | `npm run start` on :3100 | First boot clean | Port conflicts when restarting (`EADDRINUSE` / exit 137) | Med | `fuser -k 3100/tcp` before start | Document kill-port in LOCAL_DEV; add systemd unit later |
| 2026-09-28 | Combat UX after first kill | Attack then click second rat | Second attack or clear feedback | Action spent; click tried MOVE onto enemy → felt stuck | High | End Turn; UX hints + click-enemy-to-attack | Keep guided ★ + “action USED” HUD |
| 2026-09-28 | PixiJS 8 + Vite TV client | `npm run build -w tv` | Smooth build | Large chunk split OK; need WebGL on Stick | Low | Dev on desktop first | Spike FPS on Vega simulator week of 10/05 |
| 2026-09-28 | Voice without AWS | Companion mic | STT | No in-WebView STT on Fire remote | High | Intent buttons + mic stub | Transcribe when AWS credits arrive |
| 2026-09-28 | Alexa lights | Product feature | Control user home | Not public reverse API | High | Skip / demo switch later | Keep non-blocking |
| 2026-09-28 | Serving TV from backend | static `tv/local` vs `tv/dist` | One URL | Must rebuild dist after UI changes | Low | `npm run build -w @d20-fireverse/tv` | Prefer Vite :5173 in daily dev |
