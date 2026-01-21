# Craft Agents

## Commands
- **Dev**: `bun run electron:dev`
- **Build**: `bun run electron:build`
- **Test**: `bun test`
- **Lint**: `bun run lint:electron`
- **Typecheck**: `bun run typecheck:all`
- **Clean**: `bun run electron:clean`

## Architecture
- **Runtime**: Bun
- **Desktop**: Electron + React + Vite
- **UI**: shadcn/ui + Tailwind CSS v4
- **State**: Jotai
- **Structure**:
  - `apps/electron`: Main desktop application
    - `src/main`: Electron main process
    - `src/renderer`: React UI
  - `packages/shared`: Business logic, auth, config
  - `packages/core`: Shared types

## Guidelines
- **Style**: TypeScript, Functional React components
- **Auth**: OAuth (Google, Slack, Microsoft) or Local
- **Storage**: AES-256-GCM encrypted local files
- **Permissions**: Safe (Explore), Ask to Edit, Allow All (Auto)
