# Lottie

Use this source to create, preview, and validate production-ready Lottie JSON
animations through the official `diffusionstudio/lottie` Skia player harness.

## Commands

- Doctor: `node bin/lottie.mjs doctor`
- Live doctor: `node bin/lottie.mjs doctor --live`
- Init player: `node bin/lottie.mjs init <project-dir>`
- Validate: `node bin/lottie.mjs validate <project-dir>`
- Preview: `node bin/lottie.mjs dev <project-dir> -- --host 127.0.0.1 --port 5173`

## Rules

- No API key is required.
- The first init needs internet access to fetch the official harness and npm packages.
- Write animation JSON to `<project-dir>/public/lottie.json`.
- Write editable control labels/ranges to `<project-dir>/public/controls.json`.
- Verify exact frames with `?frame=<n>&paused=1`; do not drag the player scrubber for frame checks.
- Do not hand-roll a custom viewer or switch to `lottie-web` for verification.
- Before claiming done, run `node bin/lottie.mjs validate <project-dir>` and open the official preview.
