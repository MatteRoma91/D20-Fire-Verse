# Attribution

## System Reference Document 5.1

This project uses content from the **Systems Reference Document 5.1** ("SRD 5.1"),
licensed under **Creative Commons Attribution 4.0 International** (CC-BY-4.0).

- Upstream reference datasets may include community JSON mirrors derived from the SRD 5.1
  (for example structures compatible with open `5e-srd-api` / `5e-database` projects).
- Vendored files live under `content/srd/` and must retain required attribution.
- This software is **not** affiliated with Wizards of the Coast.
- Do not include non-SRD proprietary D&D content in this repository.

Full CC-BY-4.0 text: https://creativecommons.org/licenses/by/4.0/

## Third-party assets

### Music

The seven cues in `tv/public/audio/music/` are original compositions for this project, written and
synthesized by `tools/music/compose.py`. No samples, loops, or third-party recordings are used.
They are covered by the repository's MIT license.

### Sound effects

Everything in `tv/public/audio/sfx/` is synthesized from scratch by `tools/sfx/render.py` (noise,
oscillators and filters — no samples or recordings). Covered by the repository's MIT license.

### Narrator voice

The narrator is generated at runtime by **Kokoro-82M** (hexgrad, Apache-2.0), loaded through
`kokoro-js` from the ONNX export `onnx-community/Kokoro-82M-v1.0-ONNX`.
Model card and license: https://huggingface.co/hexgrad/Kokoro-82M. The model is downloaded on first
run and is not redistributed in this repository. Rendered clips are a cache, not shipped assets.

### Illustrations

Scene paintings, the dungeon map and all hero, NPC and foe portraits in `tv/public/art/` were created
for this project and are covered by the repository's MIT license.

### Fonts

Self-hosted through Fontsource, both under the SIL Open Font License 1.1:

- **Cinzel** — Natanael Gama — https://fonts.google.com/specimen/Cinzel
- **Literata** — TypeTogether for Google — https://fonts.google.com/specimen/Literata

### Libraries

PixiJS (MIT), three.js (MIT), qrcode-generator (MIT), Express (MIT), ws (MIT), Vite (MIT).
