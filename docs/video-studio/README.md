# RunnerOS Video Studio

Native RunnerOS video-editing workspace for human + agent co-editing.

This is not a pasted-in CapCut clone. The target is a local-first video project system where the UI, agents, workflows, and artifact sidecar all operate on the same project model.

## Docs

- [01 Spec](./01-spec.md)

## Short Version

Video Studio is a first-class RunnerOS surface:

- artifact sidecar previews videos and opens projects
- full Video Studio page handles serious editing
- agents use structured tools instead of clicking the UI
- project files are local, inspectable JSON
- renders run through a bundled local source/tool

The best outside references are:

- DesignCombo React Video Editor for timeline UX
- Diffusion Studio Core for browser video composition and rendering
- OpenReel for full editor feature shape
- OpenCut for agent/API/headless/plugin direction
