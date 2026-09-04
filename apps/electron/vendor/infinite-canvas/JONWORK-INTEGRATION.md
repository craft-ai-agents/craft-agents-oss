# Jonwork integration

Upstream: <https://github.com/basketikun/infinite-canvas>

Vendored revision: `9414048f9d0a099386aa15d81bedb5376b79ee61`

Jonwork keeps the upstream web application as a separately built iframe bundle so its React 19 and Ant Design runtime do not collide with the Electron renderer's React 18 runtime.

Local integration changes:

- use hash routing so the app works from Electron's relative file URL;
- replace the upstream local Agent panel with a Jonwork session composer;
- publish canvas snapshots to the parent renderer;
- accept native `CanvasAgentOp` batches from Jonwork sessions and acknowledge them after application.

The generated production bundle is copied to `src/renderer/public/infinite-canvas/` and is included by the normal renderer build.

To refresh the bundle after changing the vendored app, install its dependencies with `npm install --legacy-peer-deps`, run `npm run build` with `VITE_BASE=./`, then replace the generated public bundle and retain `LICENSE.txt`.
