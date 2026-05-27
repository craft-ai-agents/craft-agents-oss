# Hypermotion Tool

Managed RunnerOS wrapper for HyperFrames and Remotion.

This exists so agents call one stable local tool instead of random global installs or repo-level app dependencies.

## Install Managed Deps

```bash
cd tools/hypermotion
npm install
```

## Doctor

```bash
node tools/hypermotion/bin/hypermotion.mjs doctor
```

## Create Projects

```bash
node tools/hypermotion/bin/hypermotion.mjs init ./hypermotion-renders/demo --engine hyperframes
node tools/hypermotion/bin/hypermotion.mjs init ./hypermotion-renders/remotion-demo --engine remotion
```

## Preview / Render

```bash
node tools/hypermotion/bin/hypermotion.mjs preview ./hypermotion-renders/demo --engine hyperframes
node tools/hypermotion/bin/hypermotion.mjs render ./hypermotion-renders/remotion-demo --engine remotion --out out/demo.mp4
```

## Agent Rule

Agents should call `hypermotion doctor` first. If managed deps are missing, install inside `tools/hypermotion`, not in the RunnerOS app root.
