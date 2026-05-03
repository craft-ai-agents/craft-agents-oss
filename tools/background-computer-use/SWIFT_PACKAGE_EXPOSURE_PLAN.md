# Swift Package Exposure Plan

## Goal

Expose this repo as an importable Swift package while preserving the existing loopback HTTP runtime. The direct Swift API should be callable without starting the server, and direct action calls should run without the visual cursor or cursor animation delays by default.

## Non-Goals

- Do not rewrite the action, discovery, screenshot, state, or window-motion subsystems.
- Do not keep backwards compatibility shims, duplicate legacy entry points, or transitional APIs. This repo is not yet in production use, so migrate end to end to the clean target/package shape.
- Do not change route request/response JSON schemas as part of package exposure.
- Do not introduce fast verification in this pass. Existing post-action verification and settle behavior should remain intact.
- Do not expose internal AX pipeline, router, transport, or cursor-rendering implementation details as public API unless a DTO is required by the package surface.

## Minimal Change Strategy

1. Convert `Sources/BackgroundComputerUse` from an executable-only target into the importable core target.
2. Move the current `@main` executable entry point into a new executable target, such as `Sources/BackgroundComputerUseServer`.
3. Add a library product while preserving the existing executable product name.
4. Add a small public facade for direct Swift callers.
5. Add internal execution options so the direct Swift facade can disable visual cursor behavior without changing the underlying route services broadly.
6. Make only route-facing request/response DTOs and their required nested DTOs public.
7. Fully migrate existing tests and scripts to the new target layout. Do not leave legacy target aliases or compatibility wrappers.
8. Keep the HTTP server, route registry, documentation surface, and existing scripts working on top of the new package shape.

## Proposed Package Shape

```swift
products: [
    .library(name: "BackgroundComputerUseKit", targets: ["BackgroundComputerUse"]),
    .executable(name: "BackgroundComputerUse", targets: ["BackgroundComputerUseServer"]),
]
```

```text
Sources/
  BackgroundComputerUse/
    BackgroundComputerUseRuntime.swift
    API/
    Actions/
    App/
    Contracts/
    Cursor/
    Discovery/
    Runtime/
    Screenshot/
    StatePipeline/
    Window/

  BackgroundComputerUseServer/
    main.swift
```

Consumers should be able to use:

```swift
import BackgroundComputerUse

let runtime = BackgroundComputerUseRuntime()
let apps = runtime.listApps()
```

## Proposed Direct Swift Surface

Add one public facade:

```swift
public final class BackgroundComputerUseRuntime {
    public init(options: BackgroundComputerUseRuntimeOptions = .init())

    public func permissions() -> RuntimePermissionsDTO
    public func listApps() -> ListAppsResponse
    public func listWindows(_ request: ListWindowsRequest) throws -> ListWindowsResponse
    public func getWindowState(_ request: GetWindowStateRequest) throws -> GetWindowStateResponse

    public func click(_ request: ClickRequest) throws -> ClickResponse
    public func scroll(_ request: ScrollRequest) throws -> ScrollResponse
    public func performSecondaryAction(_ request: PerformSecondaryActionRequest) throws -> PerformSecondaryActionResponse
    public func drag(_ request: DragRequest) throws -> DragResponse
    public func resize(_ request: ResizeRequest) throws -> ResizeResponse
    public func setWindowFrame(_ request: SetWindowFrameRequest) throws -> SetWindowFrameResponse
    public func typeText(_ request: TypeTextRequest) throws -> TypeTextResponse
    public func pressKey(_ request: PressKeyRequest) throws -> PressKeyResponse
    public func setValue(_ request: SetValueRequest) throws -> SetValueResponse
}
```

Add one small options type:

```swift
public struct BackgroundComputerUseRuntimeOptions {
    public var visualCursor: VisualCursorMode

    public init(visualCursor: VisualCursorMode = .disabled) {
        self.visualCursor = visualCursor
    }
}

public enum VisualCursorMode {
    case disabled
    case enabled
}
```

Direct Swift calls should default to `visualCursor: .disabled`.

## Cursor Disable Strategy

The direct package surface should bypass visual cursor choreography when `visualCursor == .disabled`.

That means package action calls must not perform:

- cursor overlay startup
- cursor approach animation
- cursor `waitUntilSettled`
- cursor press/release choreography
- cursor-specific sleeps such as press lead or release hold

The action should still perform the actual AX/native dispatch and the existing post-action verification flow.

Implementation should prefer a small internal context over global state, for example:

```swift
struct ActionExecutionOptions {
    let visualCursorEnabled: Bool
}
```

Route services can receive `ActionExecutionOptions` through initializers with defaults that preserve current server behavior. The direct facade can instantiate services with `visualCursorEnabled: false`.

Response DTOs should remain stable. Cursor fields can report a non-moving disabled state rather than disappearing:

```text
movement: "disabled"
moved: false
moveDurationMs: nil
warnings: []
```

## HTTP API Preservation

The server should continue to build and run as `BackgroundComputerUse`.

Existing route paths, request schemas, response schemas, route documentation, and bootstrap metadata should remain callable. Any cursor behavior change for HTTP routes should be avoided in the first pass unless it is explicitly decided and covered by API compatibility tests.

The executable should continue to launch as a signed `.app` bundle with a stable bundle identifier and stable signing identity. macOS Accessibility and Screen Recording permissions attach to the signed host application, so the build/run scripts must preserve the current stable identity behavior and avoid creating a fresh identity on each launch.

Direct package consumers are responsible for their own host app identity. Any manual direct-package action validation that requires macOS permissions should run from a stable signed host app or fixture, not from a throwaway unsigned binary that would force repeated permission grants.

## Access Control Rules

Make public only what external package consumers need:

- `BackgroundComputerUseRuntime`
- `BackgroundComputerUseRuntimeOptions`
- `VisualCursorMode`
- route request DTOs
- route response DTOs
- nested DTOs and enums required to construct requests or read responses

Keep internal:

- `Router`
- `LoopbackServer`
- route service implementations
- AX capture internals
- action target resolver internals
- cursor coordinator/rendering internals
- native transport/backends

## Implementation Phases

1. Package target split
   - Update `Package.swift`.
   - Move executable `@main` entry to the new server target.
   - Keep scripts building the `BackgroundComputerUse` executable product.

2. Public facade
   - Add `BackgroundComputerUseRuntime`.
   - Wire facade methods to existing services.
   - Preserve existing execution queue behavior.

3. Public DTO pass
   - Make required request/response DTOs public.
   - Add public memberwise-style initializers where callers need to construct request DTOs.
   - Make response properties readable where package consumers need access.

4. Cursor disable path
   - Add internal execution options.
   - Route direct package actions through services configured with visual cursor disabled.
   - Ensure disabled cursor paths do not start overlays or wait for cursor motion.
   - Keep verification and post-action rereads unchanged.

5. Docs and examples
   - Update `README.md` with a short "Swift Package Usage" section.
   - Keep HTTP startup and curl docs intact.
   - Document that direct package calls default to no visual cursor and do not require the loopback server.
   - Document that macOS permissions attach to the host app identity for both the server app and direct package consumers.

6. Tests and validation
   - Add unit/API tests for package import and facade construction.
   - Add tests for public request construction.
   - Add cursor-disabled tests that prove direct calls bypass cursor choreography.
   - Run HTTP route/docs validation to ensure server API did not regress.
   - Manually exercise the runtime against several real macOS apps and capture screenshots or screenshot paths wherever the API supports them.

## Validation Criteria

### Package Exposure

- `swift build` succeeds.
- `swift test` succeeds.
- `swift build --product BackgroundComputerUse` still succeeds.
- A separate local consumer package can depend on this repo, `import BackgroundComputerUse`, construct `BackgroundComputerUseRuntime`, and call non-invasive methods such as `permissions()` and `listApps()`.
- Public request DTOs can be constructed from package consumer code without `@testable import`.
- Response DTO properties required for normal workflows are readable from package consumer code.

### Existing HTTP API

- `./script/build_and_run.sh --verify` succeeds.
- `./script/start.sh` still launches the signed app bundle and writes the runtime manifest.
- Repeated launches use the same bundle identifier and signing identity, so previously granted Accessibility and Screen Recording permissions remain attached.
- `GET /health` returns 200.
- `GET /v1/bootstrap` returns contract version, permission info, instructions, guide, and route summaries.
- `GET /v1/routes` returns the same route count as `RouteID.allCases.count`.
- Core POST routes remain callable with the same method/path pairs:
  - `/v1/list_apps`
  - `/v1/list_windows`
  - `/v1/get_window_state`
  - `/v1/click`
  - `/v1/scroll`
  - `/v1/perform_secondary_action`
  - `/v1/drag`
  - `/v1/resize`
  - `/v1/set_window_frame`
  - `/v1/type_text`
  - `/v1/press_key`
  - `/v1/set_value`

### Documentation Surface

- `APIDocumentationTests` still pass.
- Every public route remains documented with usage, success signals, errors, request fields, and response fields.
- Route documentation does not expose package-only implementation details.
- README clearly distinguishes:
  - server/HTTP usage
  - direct Swift package usage
  - permission/signing expectations
  - direct package default of visual cursor disabled

### Cursor Disabled Behavior

- Direct package actions created with default options do not start the visual cursor overlay.
- Direct package actions do not call cursor approach, movement, wait-until-settled, press, release, or action-specific cursor choreography.
- Direct package action responses keep cursor-related DTO fields stable and report a disabled/non-moving state.
- Existing verification sleeps/rereads remain unchanged.
- Enabling `visualCursor: .enabled` in the direct facade exercises the existing cursor path.
- HTTP server behavior remains covered separately and does not regress accidentally.

### Behavioral Smoke Tests

- `listApps()` works through direct Swift package calls.
- `listWindows(_:)` works through direct Swift package calls for a running app.
- `getWindowState(_:)` works through direct Swift package calls when required permissions are granted.
- At least one direct action route can be exercised manually with visual cursor disabled and completes without waiting for visual cursor animation.
- The same action remains callable through HTTP after the package split.

### Manual App Validation

- Validate against at least three different real apps when available, such as Safari, TextEdit, Finder, Notes, or Calculator.
- For each app, exercise discovery:
  - `listApps`
  - `listWindows`
  - `getWindowState` with `imageMode: "path"` where possible.
- Inspect generated screenshots or screenshot file paths for at least two apps to confirm the visual state corresponds to the target window.
- Exercise at least one safe action with the direct package facade and visual cursor disabled.
- Exercise at least one safe action through the HTTP API after the package split.
- Prefer reversible/manual-safe actions for validation, such as focusing/clicking inert UI, typing into a scratch TextEdit document, moving/resizing a test window, or reading state only.
- Record any app-specific limitations encountered during manual testing in the implementation summary.

### Migration Cleanliness

- No old executable target remains in `Sources/BackgroundComputerUse`.
- No duplicate server entry point remains.
- No compatibility wrapper preserves the previous executable-target layout.
- No package-only shim duplicates route behavior that should instead flow through shared services.
- Public API names represent the intended package surface, not legacy HTTP implementation details.

## Rollback Criteria

Rollback or pause the implementation if:

- The package split requires broad subsystem rewrites.
- Existing HTTP routes or route documentation need schema changes.
- Cursor-disable plumbing requires global mutable state that could leak between server and direct package callers.
- Public access control changes start exposing internal implementation types unnecessarily.
- Stable signing identity behavior regresses and repeated server launches would force repeated permission grants.
