---
name: gen-test
description: Generate tests for a given file or function. Detects the test framework in use (Vitest for frontend, Jest for packages) and creates a test file alongside the source.
---

Generate tests for the file or function provided by the user.

## Steps

1. Read the target file to understand its exports, types, and logic.
2. Detect the test framework:
   - `apps/desktop` or `packages/ui*` → Vitest (`vitest`)
   - Other packages → check `package.json` for `jest` or `vitest`
3. Check if a test file already exists (e.g. `*.test.ts`, `*.spec.ts`) and append to it rather than overwriting.
4. Write tests covering:
   - Happy path for each exported function/component
   - Edge cases: empty input, null/undefined, boundary values
   - Error cases where the source throws or returns an error state
5. For React components, use `@testing-library/react` render + user-event patterns.
6. For pure functions, use plain `describe/it/expect` blocks.
7. Do not mock internal modules unless they make network calls or touch the filesystem.
8. Run the tests after writing them and fix any failures before finishing.

## Conventions

- Test files live next to the source: `src/foo.ts` → `src/foo.test.ts`
- Use `describe('<ModuleName>', () => { ... })` as the top-level block
- Import from the source file using relative paths
- Use `vi.fn()` (Vitest) or `jest.fn()` (Jest) for spies — never `sinon`
