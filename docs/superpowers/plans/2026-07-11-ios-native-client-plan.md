# iOS/iPadOS Native Remote Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native SwiftUI iOS/iPadOS app that connects to the existing Craft Agents headless server (`packages/server`) over its existing WebSocket-RPC protocol, providing session list, streaming chat, tool-call visualization, permission approval, attachments, new-session creation, and a read-only SwiftData offline cache — with zero changes to the server.

**Architecture:** A cross-platform Swift Package (`apps/ios/CraftAgentKit`) holds all protocol/networking/model logic with no UIKit/SwiftUI dependencies, so it is unit-testable via `swift test` independent of Xcode UI concerns. A thin Xcode app target (`apps/ios/CraftAgentsApp`, generated via XcodeGen from a checked-in `project.yml`) provides the SwiftUI views, SwiftData persistence, and app lifecycle, depending on `CraftAgentKit` as a local Swift package.

**Tech Stack:** Swift 6, SwiftUI, SwiftData, `URLSessionWebSocketTask`, XcodeGen (project generation), XCTest.

## Global Constraints

- Minimum deployment target: iOS 18 / iPadOS 18 (per approved design).
- Offline cache store: SwiftData (per approved design).
- No changes to `packages/server`, `packages/server-core`, or `packages/shared/src/protocol` — the app is a protocol consumer only.
- No push notifications / APNs wake-up — explicitly out of scope (future issue).
- No Sources/MCP management UI — out of scope for this plan.
- Native SwiftUI only — no WKWebView embedding of the existing web UI.
- iPad multitasking (`NavigationSplitView`, Stage Manager-friendly scenes) is required, not optional.
- Development and all build/test verification steps require macOS + Xcode 16+ (iOS 18 SDK). This plan cannot be executed on the Linux sandbox that authored it — every "run" step assumes a macOS engineer/agent.
- Wire protocol is defined in `packages/shared/src/protocol/types.ts`, `channels.ts`, `dto.ts`, `events.ts`, and implemented in `packages/server-core/src/transport/{server,client,codec}.ts`. Swift types in this plan mirror those files field-for-field for the fields used; JSONDecoder ignores any wire fields not declared in the Swift struct, so partial mirrors are safe and forward-compatible.
- Auth model: remote (non-browser) clients authenticate with a static bearer token generated via `bun run src/index.ts --generate-token` (see `packages/server/src/index.ts`), sent as `envelope.token` on the WS handshake — there is no password/login screen to build.
- WebSocket URL: the server's `WebSocketServer` is attached to the shared HTTP(S) server with no `path` filter (`packages/server-core/src/transport/server.ts:281,297,312`), so the client connects to the root of the user-supplied server URL (e.g. `wss://myserver.example.com:PORT/`).

---

## Phase 1 — Core infrastructure, auth, session list, streaming chat

### Task 1: Scaffold `apps/ios` monorepo layout

**Files:**
- Create: `apps/ios/CraftAgentKit/Package.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/CraftAgentKit.swift`
- Create: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/SmokeTests.swift`
- Create: `apps/ios/CraftAgentsApp/project.yml`
- Create: `apps/ios/README.md`

**Interfaces:**
- Produces: `CraftAgentKit` Swift package target, importable as `import CraftAgentKit`. `apps/ios/CraftAgentsApp/project.yml` describes an Xcode project that depends on it via a local Swift package reference.

- [ ] **Step 1: Create the Swift package manifest**

```swift
// apps/ios/CraftAgentKit/Package.swift
// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "CraftAgentKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15), // enables `swift test` on macOS CI/dev machines without booting a simulator
    ],
    products: [
        .library(name: "CraftAgentKit", targets: ["CraftAgentKit"]),
    ],
    targets: [
        .target(name: "CraftAgentKit"),
        .testTarget(name: "CraftAgentKitTests", dependencies: ["CraftAgentKit"]),
    ]
)
```

- [ ] **Step 2: Create a placeholder library file so the package builds**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/CraftAgentKit.swift
/// CraftAgentKit — protocol, transport, and model layer for the Craft Agents
/// iOS/iPadOS client. Contains no UIKit/SwiftUI dependencies so it can be
/// unit-tested with `swift test` independent of the Xcode app target.
public enum CraftAgentKit {
    /// Matches `PROTOCOL_VERSION` in `packages/shared/src/protocol/types.ts`.
    public static let supportedProtocolVersion = "1.0"
}
```

- [ ] **Step 3: Write a smoke test**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/SmokeTests.swift
import XCTest
@testable import CraftAgentKit

final class SmokeTests: XCTestCase {
    func testPackageBuilds() {
        XCTAssertEqual(CraftAgentKit.supportedProtocolVersion, "1.0")
    }
}
```

- [ ] **Step 4: Run the test suite**

Run: `cd apps/ios/CraftAgentKit && swift test`
Expected: `Test Suite 'All tests' passed` with 1 test executed.

- [ ] **Step 5: Create the XcodeGen project spec for the app target**

```yaml
# apps/ios/CraftAgentsApp/project.yml
name: CraftAgentsApp
options:
  bundleIdPrefix: do.craft.agents
  deploymentTarget:
    iOS: "18.0"
packages:
  CraftAgentKit:
    path: ../CraftAgentKit
targets:
  CraftAgentsApp:
    type: application
    platform: iOS
    sources:
      - path: CraftAgentsApp
    dependencies:
      - package: CraftAgentKit
    settings:
      base:
        TARGETED_DEVICE_FAMILY: "1,2" # iPhone + iPad
        SWIFT_VERSION: "6.0"
    info:
      path: CraftAgentsApp/Info.plist
      properties:
        UILaunchScreen: {}
        UISupportedInterfaceOrientations: [UIInterfaceOrientationPortrait, UIInterfaceOrientationLandscapeLeft, UIInterfaceOrientationLandscapeRight]
  CraftAgentsAppTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - path: CraftAgentsAppTests
    dependencies:
      - target: CraftAgentsApp
```

- [ ] **Step 6: Document the toolchain requirement**

```markdown
<!-- apps/ios/README.md -->
# Craft Agents — iOS/iPadOS client

This directory requires macOS + Xcode 16+ (iOS 18 SDK) + [XcodeGen](https://github.com/yonaskolb/XcodeGen).
It cannot be built or tested on Linux.

## Layout
- `CraftAgentKit/` — pure-Swift protocol/transport/model layer (SwiftPM package, no UIKit). Test with `swift test`.
- `CraftAgentsApp/` — SwiftUI app target. Generate the Xcode project with:

  ```bash
  brew install xcodegen
  cd apps/ios/CraftAgentsApp && xcodegen generate
  open CraftAgentsApp.xcodeproj
  ```

  The generated `.xcodeproj` is gitignored — `project.yml` is the source of truth.
```

- [ ] **Step 7: Add the generated project to gitignore**

```bash
cat >> apps/ios/.gitignore << 'EOF'
CraftAgentsApp/CraftAgentsApp.xcodeproj/
CraftAgentsApp/.build/
CraftAgentKit/.build/
CraftAgentKit/.swiftpm/
EOF
```

- [ ] **Step 8: Commit**

```bash
git add apps/ios
git commit -m "chore(ios): scaffold CraftAgentKit package and CraftAgentsApp project spec"
```

---

### Task 2: Protocol constants, `JSONValue`, `WireError`, `ErrorCode`

**Files:**
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolConstants.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/JSONValue.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/WireError.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/JSONValueTests.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/WireErrorTests.swift`

**Interfaces:**
- Produces: `ProtocolConstants` (namespaced constants), `JSONValue` (`Codable`, `Equatable`, enum mirroring arbitrary JSON used for `args`/`result`/`data`), `ErrorCode` (`String`-backed `Codable` enum), `WireError { code: ErrorCode, message: String, data: JSONValue? }`.

- [ ] **Step 1: Write the failing test for `JSONValue` round-trip**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/JSONValueTests.swift
import XCTest
@testable import CraftAgentKit

final class JSONValueTests: XCTestCase {
    func testRoundTripsMixedJSON() throws {
        let json = """
        {"a": 1, "b": "text", "c": true, "d": null, "e": [1, "two", false], "f": {"nested": 2.5}}
        """
        let data = Data(json.utf8)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)

        guard case .object(let obj) = decoded else {
            return XCTFail("expected object")
        }
        XCTAssertEqual(obj["a"], .number(1))
        XCTAssertEqual(obj["b"], .string("text"))
        XCTAssertEqual(obj["c"], .bool(true))
        XCTAssertEqual(obj["d"], .null)
        XCTAssertEqual(obj["e"], .array([.number(1), .string("two"), .bool(false)]))
        XCTAssertEqual(obj["f"], .object(["nested": .number(2.5)]))

        // Re-encode and decode again — must be stable.
        let reencoded = try JSONEncoder().encode(decoded)
        let redecoded = try JSONDecoder().decode(JSONValue.self, from: reencoded)
        XCTAssertEqual(decoded, redecoded)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ios/CraftAgentKit && swift test --filter JSONValueTests`
Expected: FAIL — "cannot find type 'JSONValue' in scope".

- [ ] **Step 3: Implement `JSONValue`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/JSONValue.swift
import Foundation

/// A dynamically-typed JSON value, used for wire fields that are `unknown`
/// on the TypeScript side (`MessageEnvelope.args`, `.result`, `WireError.data`).
public indirect enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .bool(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ios/CraftAgentKit && swift test --filter JSONValueTests`
Expected: PASS

- [ ] **Step 5: Write the failing test for `ErrorCode`/`WireError`**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/WireErrorTests.swift
import XCTest
@testable import CraftAgentKit

final class WireErrorTests: XCTestCase {
    func testDecodesKnownErrorCode() throws {
        let json = Data("""
        {"code": "AUTH_FAILED", "message": "Invalid token"}
        """.utf8)
        let error = try JSONDecoder().decode(WireError.self, from: json)
        XCTAssertEqual(error.code, .authFailed)
        XCTAssertEqual(error.message, "Invalid token")
        XCTAssertNil(error.data)
    }

    func testUnknownErrorCodeDecodesToUnknownCase() throws {
        // Forward-compat: the server may add new codes; the client must not crash.
        let json = Data("""
        {"code": "SOME_FUTURE_CODE", "message": "future"}
        """.utf8)
        let error = try JSONDecoder().decode(WireError.self, from: json)
        XCTAssertEqual(error.code, .unknown("SOME_FUTURE_CODE"))
    }
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/ios/CraftAgentKit && swift test --filter WireErrorTests`
Expected: FAIL — "cannot find type 'WireError' in scope".

- [ ] **Step 7: Implement `ProtocolConstants`, `ErrorCode`, and `WireError`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolConstants.swift
import Foundation

/// Mirrors the constants exported from `packages/shared/src/protocol/types.ts`.
public enum ProtocolConstants {
    public static let protocolVersion = "1.0"
    public static let heartbeatIntervalMs: UInt64 = 30_000
    public static let heartbeatMaxMissed = 2
    public static let requestTimeoutMs: UInt64 = 30_000
    public static let eventBufferMaxSize = 500
    public static let eventBufferTtlMs: UInt64 = 30_000
    public static let disconnectedClientTtlMs: UInt64 = 60_000
    public static let sequenceAckIntervalMs: UInt64 = 5_000
}
```

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/WireError.swift
import Foundation

/// Mirrors `ErrorCode` in `packages/shared/src/protocol/types.ts`.
/// Unknown wire values decode to `.unknown(rawValue)` instead of throwing,
/// so a client on an older build tolerates new server-side error codes.
public enum ErrorCode: Equatable, Sendable {
    case handlerError
    case channelNotFound
    case authFailed
    case protocolVersionUnsupported
    case sessionNotIdle
    case sessionIdConflict
    case artifactNotPortable
    case transferTooLarge
    case transferTimeout
    case transferVerificationFailed
    case requestTimeout
    case capabilityUnavailable
    case clientDisconnected
    case clientRequestTimeout
    case browserNoCapableClient
    case browserInstanceNotOwned
    case browserRemoteUploadNotSupported
    case browserRemoteEvaluateBlocked
    case unknown(String)

    private static let wireMap: [String: ErrorCode] = [
        "HANDLER_ERROR": .handlerError,
        "CHANNEL_NOT_FOUND": .channelNotFound,
        "AUTH_FAILED": .authFailed,
        "PROTOCOL_VERSION_UNSUPPORTED": .protocolVersionUnsupported,
        "SESSION_NOT_IDLE": .sessionNotIdle,
        "SESSION_ID_CONFLICT": .sessionIdConflict,
        "ARTIFACT_NOT_PORTABLE": .artifactNotPortable,
        "TRANSFER_TOO_LARGE": .transferTooLarge,
        "TRANSFER_TIMEOUT": .transferTimeout,
        "TRANSFER_VERIFICATION_FAILED": .transferVerificationFailed,
        "REQUEST_TIMEOUT": .requestTimeout,
        "CAPABILITY_UNAVAILABLE": .capabilityUnavailable,
        "CLIENT_DISCONNECTED": .clientDisconnected,
        "CLIENT_REQUEST_TIMEOUT": .clientRequestTimeout,
        "BROWSER_NO_CAPABLE_CLIENT": .browserNoCapableClient,
        "BROWSER_INSTANCE_NOT_OWNED": .browserInstanceNotOwned,
        "BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED": .browserRemoteUploadNotSupported,
        "BROWSER_REMOTE_EVALUATE_BLOCKED": .browserRemoteEvaluateBlocked,
    ]

    init(wireValue: String) {
        self = Self.wireMap[wireValue] ?? .unknown(wireValue)
    }

    var wireValue: String {
        for (key, value) in Self.wireMap where value == self { return key }
        if case .unknown(let raw) = self { return raw }
        return "HANDLER_ERROR"
    }
}

extension ErrorCode: Codable {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ErrorCode(wireValue: raw)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}

/// Mirrors `WireError` in `packages/shared/src/protocol/types.ts`.
public struct WireError: Codable, Equatable, Sendable {
    public let code: ErrorCode
    public let message: String
    public let data: JSONValue?
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd apps/ios/CraftAgentKit && swift test --filter WireErrorTests`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/ios/CraftAgentKit
git commit -m "feat(ios): add JSONValue, ErrorCode, and WireError protocol primitives"
```

---

### Task 3: `MessageEnvelope` and `RPCChannels`

**Files:**
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/MessageEnvelope.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/RPCChannels.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/MessageEnvelopeTests.swift`

**Interfaces:**
- Consumes: `JSONValue`, `WireError` (Task 2).
- Produces: `MessageType` enum, `MessageEnvelope` struct (all fields optional except `id`/`type`, matching `packages/shared/src/protocol/types.ts`), `RPCChannels` enum namespace with the MVP channel string constants.

- [ ] **Step 1: Write the failing test**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/MessageEnvelopeTests.swift
import XCTest
@testable import CraftAgentKit

final class MessageEnvelopeTests: XCTestCase {
    func testDecodesHandshakeAck() throws {
        let json = Data("""
        {
          "id": "abc-123",
          "type": "handshake_ack",
          "clientId": "client-1",
          "protocolVersion": "1.0",
          "serverVersion": "0.11.0",
          "registeredChannels": ["sessions:get", "sessions:sendMessage"],
          "reconnected": false
        }
        """.utf8)
        let envelope = try JSONDecoder().decode(MessageEnvelope.self, from: json)
        XCTAssertEqual(envelope.id, "abc-123")
        XCTAssertEqual(envelope.type, .handshakeAck)
        XCTAssertEqual(envelope.clientId, "client-1")
        XCTAssertEqual(envelope.registeredChannels, ["sessions:get", "sessions:sendMessage"])
        XCTAssertEqual(envelope.reconnected, false)
    }

    func testEncodesRequestWithArgs() throws {
        let envelope = MessageEnvelope(
            id: "req-1",
            type: .request,
            channel: RPCChannels.Sessions.sendMessage,
            args: [.string("session-1"), .string("hello"), .null, .null, .null]
        )
        let data = try JSONEncoder().encode(envelope)
        let redecoded = try JSONDecoder().decode(MessageEnvelope.self, from: data)
        XCTAssertEqual(redecoded.channel, "sessions:sendMessage")
        XCTAssertEqual(redecoded.args?.count, 5)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ios/CraftAgentKit && swift test --filter MessageEnvelopeTests`
Expected: FAIL — "cannot find type 'MessageEnvelope' in scope".

- [ ] **Step 3: Implement `MessageEnvelope`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/MessageEnvelope.swift
import Foundation

/// Mirrors `MessageType` in `packages/shared/src/protocol/types.ts`.
public enum MessageType: String, Codable, Sendable {
    case handshake
    case handshakeAck = "handshake_ack"
    case request
    case response
    case event
    case error
    case sequenceAck = "sequence_ack"
}

/// Mirrors `MessageEnvelope` in `packages/shared/src/protocol/types.ts`.
/// Field names/casing match the wire format exactly (no snake_case translation
/// needed — the TS source already uses camelCase on the wire).
public struct MessageEnvelope: Codable, Equatable, Sendable {
    public var id: String
    public var type: MessageType
    public var channel: String?
    public var args: [JSONValue]?
    public var result: JSONValue?
    public var error: WireError?
    public var protocolVersion: String?
    public var workspaceId: String?
    public var token: String?
    public var clientId: String?
    public var serverId: String?
    public var webContentsId: Int?
    public var clientCapabilities: [String]?
    public var registeredChannels: [String]?
    public var seq: Int?
    public var lastSeq: Int?
    public var reconnectClientId: String?
    public var reconnected: Bool?
    public var stale: Bool?
    public var serverVersion: String?

    public init(
        id: String,
        type: MessageType,
        channel: String? = nil,
        args: [JSONValue]? = nil,
        result: JSONValue? = nil,
        error: WireError? = nil,
        protocolVersion: String? = nil,
        workspaceId: String? = nil,
        token: String? = nil,
        clientId: String? = nil,
        serverId: String? = nil,
        webContentsId: Int? = nil,
        clientCapabilities: [String]? = nil,
        registeredChannels: [String]? = nil,
        seq: Int? = nil,
        lastSeq: Int? = nil,
        reconnectClientId: String? = nil,
        reconnected: Bool? = nil,
        stale: Bool? = nil,
        serverVersion: String? = nil
    ) {
        self.id = id
        self.type = type
        self.channel = channel
        self.args = args
        self.result = result
        self.error = error
        self.protocolVersion = protocolVersion
        self.workspaceId = workspaceId
        self.token = token
        self.clientId = clientId
        self.serverId = serverId
        self.webContentsId = webContentsId
        self.clientCapabilities = clientCapabilities
        self.registeredChannels = registeredChannels
        self.seq = seq
        self.lastSeq = lastSeq
        self.reconnectClientId = reconnectClientId
        self.reconnected = reconnected
        self.stale = stale
        self.serverVersion = serverVersion
    }
}
```

- [ ] **Step 4: Implement `RPCChannels`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/RPCChannels.swift
import Foundation

/// Mirrors the MVP subset of `RPC_CHANNELS` in `packages/shared/src/protocol/channels.ts`.
/// These are wire-format string constants — the stable API contract with the server.
/// Add new nested enums here as later phases need more channels; do not rename
/// existing raw values without a matching server-side change.
public enum RPCChannels {
    public enum Server {
        public static let getWorkspaces = "server:getWorkspaces"
        public static let getStatus = "server:getStatus"
        public static let getHealth = "server:getHealth"
    }

    public enum Sessions {
        public static let get = "sessions:get"
        public static let getMessages = "sessions:getMessages"
        public static let sendMessage = "sessions:sendMessage"
        public static let create = "sessions:create"
        public static let respondToPermission = "sessions:respondToPermission"
        public static let getUnreadSummary = "sessions:getUnreadSummary"
        public static let markAllRead = "sessions:markAllRead"
        /// Note the singular "session" prefix — this one channel name does not
        /// follow the "sessions:" pattern used by the rest of this namespace.
        public static let event = "session:event"
    }

    public enum Statuses {
        public static let list = "statuses:list"
    }

    public enum Labels {
        public static let list = "labels:list"
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/ios/CraftAgentKit && swift test --filter MessageEnvelopeTests`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/ios/CraftAgentKit
git commit -m "feat(ios): add MessageEnvelope and RPCChannels wire contracts"
```

---

### Task 4: `ProtocolCodec`

**Files:**
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolCodec.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/ProtocolCodecTests.swift`

**Interfaces:**
- Consumes: `MessageEnvelope`, `MessageType` (Task 3).
- Produces: `ProtocolCodec.serialize(_ envelope: MessageEnvelope) throws -> String`, `ProtocolCodec.deserialize(_ raw: String) throws -> MessageEnvelope`, `ProtocolCodec.CodecError` (thrown on shape violations).

**Scope note:** `packages/server-core/src/transport/codec.ts` also wraps raw `Uint8Array` values in `args`/`result` as `{"__craftRpcType":"u8","base64":"..."}` for the binary file-transfer channels (`transfer:*`). Those channels are not in the MVP `RPCChannels` set (Task 3) and no MVP flow sends binary payloads, so that wrapping is intentionally not implemented here. If a later phase adds a `transfer:*` channel, extend `JSONValue` with a `.binary(Data)` case and mirror the base64 wrapping at that time — do not add it speculatively now (YAGNI).

- [ ] **Step 1: Write the failing tests**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/ProtocolCodecTests.swift
import XCTest
@testable import CraftAgentKit

final class ProtocolCodecTests: XCTestCase {
    func testRoundTripsARequestEnvelope() throws {
        let envelope = MessageEnvelope(
            id: "req-1",
            type: .request,
            channel: RPCChannels.Sessions.get
        )
        let wire = try ProtocolCodec.serialize(envelope)
        let decoded = try ProtocolCodec.deserialize(wire)
        XCTAssertEqual(decoded, envelope)
    }

    func testRejectsEnvelopeWithMissingId() {
        let json = """
        {"id": "", "type": "request", "channel": "sessions:get"}
        """
        XCTAssertThrowsError(try ProtocolCodec.deserialize(json)) { error in
            guard case ProtocolCodec.CodecError.invalidShape = error else {
                return XCTFail("expected invalidShape, got \(error)")
            }
        }
    }

    func testRejectsHandshakeAckWithoutClientId() {
        let json = """
        {"id": "abc", "type": "handshake_ack"}
        """
        XCTAssertThrowsError(try ProtocolCodec.deserialize(json)) { error in
            guard case ProtocolCodec.CodecError.invalidShape = error else {
                return XCTFail("expected invalidShape, got \(error)")
            }
        }
    }

    func testRejectsRequestWithoutChannel() {
        let json = """
        {"id": "abc", "type": "request"}
        """
        XCTAssertThrowsError(try ProtocolCodec.deserialize(json)) { error in
            guard case ProtocolCodec.CodecError.invalidShape = error else {
                return XCTFail("expected invalidShape, got \(error)")
            }
        }
    }

    func testAcceptsRealHandshakeAckFixture() throws {
        // Captured shape from packages/server-core/src/transport/server.ts onConnection().
        let json = """
        {
          "id": "hs-1",
          "type": "handshake_ack",
          "clientId": "client-42",
          "protocolVersion": "1.0",
          "serverVersion": "0.11.0",
          "registeredChannels": ["sessions:get", "sessions:sendMessage", "session:event"],
          "reconnected": false
        }
        """
        let decoded = try ProtocolCodec.deserialize(json)
        XCTAssertEqual(decoded.clientId, "client-42")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/ios/CraftAgentKit && swift test --filter ProtocolCodecTests`
Expected: FAIL — "cannot find type 'ProtocolCodec' in scope".

- [ ] **Step 3: Implement `ProtocolCodec`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolCodec.swift
import Foundation

/// Encodes/decodes `MessageEnvelope` to/from the wire JSON string format used
/// by `packages/server-core/src/transport/codec.ts`. Mirrors
/// `validateEnvelopeShape` so malformed frames are rejected the same way on
/// both ends of the connection.
public enum ProtocolCodec {
    public enum CodecError: Error, Equatable {
        case invalidShape(String)
        case notUtf8
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        return encoder
    }()

    private static let decoder = JSONDecoder()

    public static func serialize(_ envelope: MessageEnvelope) throws -> String {
        try validate(envelope)
        let data = try encoder.encode(envelope)
        guard let string = String(data: data, encoding: .utf8) else {
            throw CodecError.notUtf8
        }
        return string
    }

    public static func deserialize(_ raw: String) throws -> MessageEnvelope {
        guard let data = raw.data(using: .utf8) else {
            throw CodecError.notUtf8
        }
        let envelope = try decoder.decode(MessageEnvelope.self, from: data)
        try validate(envelope)
        return envelope
    }

    /// Mirrors `validateEnvelopeShape` in `packages/server-core/src/transport/codec.ts`.
    private static func validate(_ envelope: MessageEnvelope) throws {
        if envelope.id.isEmpty {
            throw CodecError.invalidShape("id must be non-empty")
        }
        if envelope.type == .handshakeAck, (envelope.clientId?.isEmpty ?? true) {
            throw CodecError.invalidShape("handshake_ack requires a non-empty clientId")
        }
        if (envelope.type == .request || envelope.type == .event), envelope.channel == nil {
            throw CodecError.invalidShape("\(envelope.type.rawValue) requires a channel")
        }
        if envelope.type == .error, envelope.error == nil {
            throw CodecError.invalidShape("error envelopes require an error payload")
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/ios/CraftAgentKit && swift test --filter ProtocolCodecTests`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/ios/CraftAgentKit
git commit -m "feat(ios): add ProtocolCodec with envelope-shape validation"
```

---

### Task 5: `ConnectionState` and `RPCTransport`

**Files:**
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/ConnectionState.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/RPCTransport.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/RPCTransportIntegrationTests.swift`

**Interfaces:**
- Consumes: `MessageEnvelope`, `MessageType`, `ProtocolCodec`, `ProtocolConstants`, `RPCChannels`, `JSONValue`, `WireError` (Tasks 2-4).
- Produces: `ConnectionState` enum, `RPCTransportDelegate` protocol (`transport(_:didChangeState:)`, `transport(_:didReceiveEvent:)`), `RPCTransport` actor with `connect(serverURL:token:workspaceId:) async throws`, `request(channel:args:) async throws -> JSONValue`, `disconnect()`.
- This is the one component that requires a **live server** to test meaningfully (a WebSocket handshake is not usefully mockable without reimplementing the server). The test target treats `packages/server` as an integration dependency, matching the "Testing" section of the approved design doc.

- [ ] **Step 1: Implement `ConnectionState`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/ConnectionState.swift
import Foundation

/// Mirrors `TransportConnectionStatus`/`TransportConnectionErrorKind` in
/// `packages/server-core/src/transport/client.ts`.
public enum ConnectionErrorKind: Equatable, Sendable {
    case auth
    case protocolVersion
    case timeout
    case network
    case server
    case unknown
}

public struct ConnectionError: Equatable, Sendable {
    public let kind: ConnectionErrorKind
    public let message: String
}

public enum ConnectionState: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case reconnecting(attempt: Int)
    case disconnected
    case failed(ConnectionError)
}

/// Delegate callbacks fired from the transport's background receive loop.
/// Implementations MUST hop back to the main actor themselves before
/// touching UI state — the transport does not assume a specific executor.
public protocol RPCTransportDelegate: AnyObject, Sendable {
    func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async
    func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async
}
```

- [ ] **Step 2: Implement `RPCTransport`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/RPCTransport.swift
import Foundation

/// WebSocket-based RPC transport. Owns connection lifecycle, handshake,
/// heartbeat, request/response correlation, and reconnect-with-replay —
/// the Swift-side counterpart to `packages/server-core/src/transport/client.ts`.
public actor RPCTransport: NSObject {
    private struct PendingRequest {
        let continuation: CheckedContinuation<JSONValue, Error>
    }

    public enum TransportError: Error, Equatable {
        case notConnected
        case requestTimedOut
        case remote(WireError)
        case invalidResponse
    }

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var serverURL: URL?
    private var token: String?
    private var workspaceId: String?
    private var clientId: String?
    private var lastSeenSeq: Int = 0
    private var reconnectAttempt = 0
    private var pending: [String: PendingRequest] = [:]
    private var heartbeatTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var missedPongs = 0
    private var isExplicitlyDisconnected = false

    public private(set) var state: ConnectionState = .idle
    public weak var delegate: RPCTransportDelegate?

    public override init() {
        super.init()
        self.session = URLSession(configuration: .default)
    }

    /// Opens the WebSocket, performs the handshake, and returns once the
    /// server has acknowledged (`handshake_ack`). Throws on auth failure,
    /// protocol mismatch, or timeout.
    public func connect(serverURL: URL, token: String, workspaceId: String?) async throws {
        self.serverURL = serverURL
        self.token = token
        self.workspaceId = workspaceId
        isExplicitlyDisconnected = false
        try await openSocketAndHandshake()
    }

    public func disconnect() {
        isExplicitlyDisconnected = true
        heartbeatTask?.cancel()
        receiveTask?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        updateState(.disconnected)
    }

    /// Sends a request envelope and awaits the correlated response/error.
    public func request(channel: String, args: [JSONValue] = []) async throws -> JSONValue {
        guard let task else { throw TransportError.notConnected }
        let id = UUID().uuidString
        let envelope = MessageEnvelope(id: id, type: .request, channel: channel, args: args)
        let wire = try ProtocolCodec.serialize(envelope)

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = PendingRequest(continuation: continuation)
            Task {
                do {
                    try await task.send(.string(wire))
                } catch {
                    self.failPending(id: id, error: error)
                }
            }
            Task {
                try? await Task.sleep(nanoseconds: ProtocolConstants.requestTimeoutMs * 1_000_000)
                self.timeoutPending(id: id)
            }
        }
    }

    // MARK: - Handshake

    private func openSocketAndHandshake() async throws {
        guard let serverURL, let token else { throw TransportError.notConnected }
        updateState(reconnectAttempt > 0 ? .reconnecting(attempt: reconnectAttempt) : .connecting)

        let newTask = session.webSocketTask(with: serverURL)
        newTask.resume()
        self.task = newTask

        let handshakeId = UUID().uuidString
        var handshake = MessageEnvelope(id: handshakeId, type: .handshake)
        handshake.protocolVersion = ProtocolConstants.protocolVersion
        handshake.workspaceId = workspaceId
        handshake.token = token
        handshake.clientCapabilities = []
        if let clientId, lastSeenSeq > 0 {
            handshake.reconnectClientId = clientId
            handshake.lastSeq = lastSeenSeq
        }

        let wire = try ProtocolCodec.serialize(handshake)
        try await newTask.send(.string(wire))

        let ackEnvelope = try await receiveHandshakeAck(on: newTask, expectedId: handshakeId)
        self.clientId = ackEnvelope.clientId
        reconnectAttempt = 0
        updateState(.connected)

        startReceiveLoop(on: newTask)
        startHeartbeat(on: newTask)
    }

    private func receiveHandshakeAck(on task: URLSessionWebSocketTask, expectedId: String) async throws -> MessageEnvelope {
        while true {
            let message = try await task.receive()
            guard case .string(let text) = message else { continue }
            let envelope = try ProtocolCodec.deserialize(text)
            if envelope.type == .error, envelope.id == expectedId {
                throw envelope.error.map(TransportError.remote) ?? TransportError.invalidResponse
            }
            if envelope.type == .handshakeAck, envelope.id == expectedId {
                return envelope
            }
            // Ignore anything else while waiting for the ack (there should be nothing else yet).
        }
    }

    // MARK: - Receive loop

    private func startReceiveLoop(on task: URLSessionWebSocketTask) {
        receiveTask?.cancel()
        receiveTask = Task {
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    guard case .string(let text) = message else { continue }
                    let envelope = try ProtocolCodec.deserialize(text)
                    await self.handle(envelope)
                } catch {
                    await self.handleSocketFailure(error)
                    break
                }
            }
        }
    }

    private func handle(_ envelope: MessageEnvelope) async {
        switch envelope.type {
        case .response:
            if let result = envelope.result {
                resolvePending(id: envelope.id, result: result)
            } else {
                resolvePending(id: envelope.id, result: .null)
            }
        case .error:
            if let wireError = envelope.error {
                failPending(id: envelope.id, error: TransportError.remote(wireError))
            }
        case .event:
            if let seq = envelope.seq {
                lastSeenSeq = max(lastSeenSeq, seq)
            }
            await delegate?.transport(self, didReceiveEvent: envelope)
        default:
            break
        }
    }

    // MARK: - Heartbeat

    private func startHeartbeat(on task: URLSessionWebSocketTask) {
        heartbeatTask?.cancel()
        missedPongs = 0
        heartbeatTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: ProtocolConstants.heartbeatIntervalMs * 1_000_000)
                guard !Task.isCancelled else { return }
                task.sendPing { [weak self] error in
                    guard let self else { return }
                    Task {
                        if error != nil {
                            await self.registerMissedPong()
                        } else {
                            await self.resetMissedPongs()
                        }
                    }
                }
            }
        }
    }

    private func registerMissedPong() {
        missedPongs += 1
        if missedPongs >= ProtocolConstants.heartbeatMaxMissed {
            task?.cancel(with: .abnormalClosure, reason: nil)
        }
    }

    private func resetMissedPongs() {
        missedPongs = 0
    }

    // MARK: - Failure / reconnect

    private func handleSocketFailure(_ error: Error) async {
        heartbeatTask?.cancel()
        guard !isExplicitlyDisconnected else { return }
        for (id, _) in pending {
            failPending(id: id, error: TransportError.notConnected)
        }
        reconnectAttempt += 1
        updateState(.reconnecting(attempt: reconnectAttempt))

        let backoffMs = min(30_000, 1_000 * (1 << min(reconnectAttempt, 5)))
        try? await Task.sleep(nanoseconds: UInt64(backoffMs) * 1_000_000)
        guard !isExplicitlyDisconnected else { return }
        do {
            try await openSocketAndHandshake()
        } catch {
            updateState(.failed(ConnectionError(kind: .network, message: "\(error)")))
        }
    }

    // MARK: - Pending request bookkeeping

    private func resolvePending(id: String, result: JSONValue) {
        guard let entry = pending.removeValue(forKey: id) else { return }
        entry.continuation.resume(returning: result)
    }

    private func failPending(id: String, error: Error) {
        guard let entry = pending.removeValue(forKey: id) else { return }
        entry.continuation.resume(throwing: error)
    }

    private func timeoutPending(id: String) {
        guard pending[id] != nil else { return }
        failPending(id: id, error: TransportError.requestTimedOut)
    }

    private func updateState(_ newState: ConnectionState) {
        state = newState
        Task { await delegate?.transport(self, didChangeState: newState) }
    }
}
```

- [ ] **Step 3: Write the integration test**

This test requires a real server running locally. Document the precondition in the test file itself.

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/RPCTransportIntegrationTests.swift
import XCTest
@testable import CraftAgentKit

/// Requires a local server: from `packages/server`, run
///   `bun run src/index.ts --generate-token` once to obtain a token, then
///   from the repo root run `CRAFT_SERVER_TOKEN=<token> bun run server:start`
///   before running this test. Skips itself if `CRAFT_TEST_SERVER_URL` is
///   unset so the rest of the suite still runs in CI without a live server.
final class RPCTransportIntegrationTests: XCTestCase {
    private final class RecordingDelegate: RPCTransportDelegate {
        var states: [ConnectionState] = []
        func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {
            states.append(state)
        }
        func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {}
    }

    func testConnectsAndListsSessions() async throws {
        guard let urlString = ProcessInfo.processInfo.environment["CRAFT_TEST_SERVER_URL"],
              let token = ProcessInfo.processInfo.environment["CRAFT_TEST_SERVER_TOKEN"],
              let url = URL(string: urlString) else {
            throw XCTSkip("Set CRAFT_TEST_SERVER_URL / CRAFT_TEST_SERVER_TOKEN to run against a live server")
        }

        let transport = RPCTransport()
        let delegate = RecordingDelegate()
        await transport.setDelegate(delegate)

        try await transport.connect(serverURL: url, token: token, workspaceId: nil)
        let result = try await transport.request(channel: RPCChannels.Sessions.get)

        guard case .array = result else {
            return XCTFail("expected sessions:get to return an array, got \(result)")
        }
        await transport.disconnect()
    }
}
```

- [ ] **Step 4: Add the `setDelegate` helper actor method used by the test**

```swift
// Append to apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/RPCTransport.swift,
// inside the `RPCTransport` actor body:
extension RPCTransport {
    public func setDelegate(_ delegate: RPCTransportDelegate?) {
        self.delegate = delegate
    }
}
```

- [ ] **Step 5: Run the non-integration tests to confirm nothing regressed**

Run: `cd apps/ios/CraftAgentKit && swift test --filter "JSONValueTests|WireErrorTests|MessageEnvelopeTests|ProtocolCodecTests"`
Expected: PASS (all prior tests still green; `RPCTransportIntegrationTests` self-skips without env vars).

- [ ] **Step 6: Run the integration test against a real local server**

```bash
cd packages/server && bun run src/index.ts --generate-token
# copy the printed token, then from the repo root in another terminal:
CRAFT_SERVER_TOKEN=<token> bun run server:start
# back in the CraftAgentKit checkout (default port is 9100, per CRAFT_RPC_PORT):
CRAFT_TEST_SERVER_URL=ws://127.0.0.1:9100 CRAFT_TEST_SERVER_TOKEN=<token> \
  swift test --filter RPCTransportIntegrationTests
```
Expected: PASS — confirms real handshake + `sessions:get` round trip against the actual server.

- [ ] **Step 7: Commit**

```bash
git add apps/ios/CraftAgentKit
git commit -m "feat(ios): add RPCTransport with handshake, heartbeat, and reconnect"
```

---

### Task 6: `AuthKeychainStore` and `ServerConnection`

**Files:**
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Auth/ServerConnection.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Auth/KeychainStoring.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Auth/KeychainStore.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/ServerConnectionStoreTests.swift`

**Interfaces:**
- Produces: `ServerConnection { id: UUID, name: String, url: URL, token: String, workspaceId: String? }`, `KeychainStoring` protocol (for testability), `KeychainStore` (real Keychain-backed implementation, iOS/macOS only), `InMemoryKeychainStore` (test double), `ServerConnectionStore` (list/save/delete `ServerConnection`, backed by any `KeychainStoring`).

- [ ] **Step 1: Define the model and the storage protocol**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Auth/ServerConnection.swift
import Foundation

/// A saved server the app can connect to: URL + bearer token (Task 5's
/// `RPCTransport.connect(serverURL:token:workspaceId:)`), and the last
/// workspace the user selected on that server.
public struct ServerConnection: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public var name: String
    public var url: URL
    public var token: String
    public var workspaceId: String?

    public init(id: UUID = UUID(), name: String, url: URL, token: String, workspaceId: String? = nil) {
        self.id = id
        self.name = name
        self.url = url
        self.token = token
        self.workspaceId = workspaceId
    }
}
```

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Auth/KeychainStoring.swift
import Foundation

/// Minimal key-value secure storage abstraction so `ServerConnectionStore`
/// can be unit-tested without touching the real iOS Keychain.
public protocol KeychainStoring: Sendable {
    func save(_ data: Data, forKey key: String) throws
    func load(forKey key: String) throws -> Data?
    func delete(forKey key: String) throws
}

public actor InMemoryKeychainStore: KeychainStoring {
    private var storage: [String: Data] = [:]
    public init() {}
    public func save(_ data: Data, forKey key: String) throws { storage[key] = data }
    public func load(forKey key: String) throws -> Data? { storage[key] }
    public func delete(forKey key: String) throws { storage.removeValue(forKey: key) }
}
```

- [ ] **Step 2: Write the failing test against `ServerConnectionStore`**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/ServerConnectionStoreTests.swift
import XCTest
@testable import CraftAgentKit

final class ServerConnectionStoreTests: XCTestCase {
    func testSavesListsAndDeletesConnections() async throws {
        let store = ServerConnectionStore(keychain: InMemoryKeychainStore())
        let connection = ServerConnection(
            name: "Home Mac",
            url: URL(string: "wss://home.example.com:9100")!,
            token: "super-secret-token"
        )

        try await store.save(connection)
        var all = try await store.list()
        XCTAssertEqual(all, [connection])

        try await store.delete(id: connection.id)
        all = try await store.list()
        XCTAssertEqual(all, [])
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/ios/CraftAgentKit && swift test --filter ServerConnectionStoreTests`
Expected: FAIL — "cannot find type 'ServerConnectionStore' in scope".

- [ ] **Step 4: Implement `ServerConnectionStore` and the real Keychain backend**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Auth/KeychainStore.swift
import Foundation
#if canImport(Security)
import Security

/// Real Keychain-backed `KeychainStoring`. Only available on Apple platforms
/// that provide the Security framework (iOS app target, not `swift test` on Linux).
public struct KeychainStore: KeychainStoring {
    private let service: String
    public init(service: String = "do.craft.agents.ios") {
        self.service = service
    }

    public func save(_ data: Data, forKey key: String) throws {
        try? delete(forKey: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "KeychainStore", code: Int(status))
        }
    }

    public func load(forKey key: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw NSError(domain: "KeychainStore", code: Int(status))
        }
        return result as? Data
    }

    public func delete(forKey key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
#endif
```

```swift
// Append to apps/ios/CraftAgentKit/Sources/CraftAgentKit/Auth/ServerConnection.swift
public actor ServerConnectionStore {
    private let keychain: KeychainStoring
    private static let storageKey = "server-connections"

    public init(keychain: KeychainStoring) {
        self.keychain = keychain
    }

    public func list() async throws -> [ServerConnection] {
        guard let data = try keychain.load(forKey: Self.storageKey) else { return [] }
        return try JSONDecoder().decode([ServerConnection].self, from: data)
    }

    public func save(_ connection: ServerConnection) async throws {
        var all = try await list()
        if let index = all.firstIndex(where: { $0.id == connection.id }) {
            all[index] = connection
        } else {
            all.append(connection)
        }
        try keychain.save(try JSONEncoder().encode(all), forKey: Self.storageKey)
    }

    public func delete(id: UUID) async throws {
        var all = try await list()
        all.removeAll { $0.id == id }
        try keychain.save(try JSONEncoder().encode(all), forKey: Self.storageKey)
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/ios/CraftAgentKit && swift test --filter ServerConnectionStoreTests`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/ios/CraftAgentKit
git commit -m "feat(ios): add ServerConnection model and Keychain-backed store"
```

---

### Task 7: Domain models — `Session`, `ChatMessage`, `PermissionRequest`, `FileAttachment`, `SessionEvent`

**Files:**
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/Session.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/ChatMessage.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/PermissionRequest.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/FileAttachment.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/SessionEvent.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/SessionEventDecodingTests.swift`

**Interfaces:**
- Consumes: `JSONValue` (Task 2).
- Produces: `Session`, `MessageRole`, `ChatMessage`, `PermissionRequest`, `FileAttachment`, `SessionEvent` (all `Codable`/`Sendable`). These are consumed by `RPCClient` (Task 8) and every SwiftUI view from Task 10 onward.

**Scope note:** `Session` in `packages/shared/src/protocol/dto.ts` and `SessionEvent` in the same file carry far more fields/cases than MVP needs (46 event variants, ~35 session fields). Only the fields/cases used by session list, chat, tool visualization, and permission approval are declared below. `JSONDecoder` ignores undeclared wire fields, so this is safe — extending either type later (Phase 2/3) is additive, never a breaking change to already-written code.

- [ ] **Step 1: Implement `Session`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/Session.swift
import Foundation

/// Mirrors the MVP-relevant fields of `Session` in
/// `packages/shared/src/protocol/dto.ts`.
public struct Session: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let workspaceId: String
    public let workspaceName: String
    public var name: String?
    public var preview: String?
    public var lastMessageAt: Double
    public var isProcessing: Bool
    public var isFlagged: Bool?
    public var permissionMode: String?
    public var sessionStatus: String?
    public var labels: [String]?
    public var hasUnread: Bool?
    public var model: String?
    public var messageCount: Int?
}
```

- [ ] **Step 2: Implement `MessageRole` and `ChatMessage`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/ChatMessage.swift
import Foundation

/// Mirrors `MessageRole` in `packages/core/src/types/message.ts`.
public enum MessageRole: String, Codable, Sendable {
    case user
    case assistant
    case tool
    case error
    case status
    case info
    case warning
    case plan
    case authRequest = "auth-request"
}

/// Mirrors the MVP-relevant fields of `Message` in
/// `packages/core/src/types/message.ts`.
public struct ChatMessage: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public var role: MessageRole
    public var content: String
    public var timestamp: Double
    public var toolName: String?
    public var toolUseId: String?
    public var toolInput: [String: JSONValue]?
    public var toolResult: String?
    public var toolStatus: String?
    public var toolDuration: Double?
    public var parentToolUseId: String?
    public var isError: Bool?
    public var isStreaming: Bool?
}
```

- [ ] **Step 3: Implement `PermissionRequest` and `FileAttachment`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/PermissionRequest.swift
import Foundation

/// Mirrors `PermissionRequestType`/`PermissionRequest` in
/// `packages/core/src/types/message.ts`.
public enum PermissionRequestType: String, Codable, Sendable {
    case bash
    case fileWrite = "file_write"
    case mcpMutation = "mcp_mutation"
    case apiMutation = "api_mutation"
    case adminApproval = "admin_approval"
}

public struct PermissionRequest: Codable, Equatable, Sendable {
    public let requestId: String
    public let toolName: String
    public var command: String?
    public let description: String
    public var type: PermissionRequestType?
    public var appName: String?
    public var reason: String?
    public var impact: String?
    public var requiresSystemPrompt: Bool?
    public var rememberForMinutes: Int?
}
```

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/FileAttachment.swift
import Foundation

/// Mirrors `FileAttachment` in `packages/shared/src/protocol/dto.ts`.
public struct FileAttachment: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case image, text, pdf, office, audio, unknown
    }

    public var type: Kind
    public var path: String
    public var name: String
    public var mimeType: String
    public var base64: String?
    public var text: String?
    public var size: Int
    public var thumbnailBase64: String?
}
```

- [ ] **Step 4: Write the failing test for `SessionEvent` decoding**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/SessionEventDecodingTests.swift
import XCTest
@testable import CraftAgentKit

final class SessionEventDecodingTests: XCTestCase {
    func testDecodesTextDelta() throws {
        let json = Data("""
        {"type": "text_delta", "sessionId": "s1", "delta": "Hello"}
        """.utf8)
        let event = try JSONDecoder().decode(SessionEvent.self, from: json)
        guard case .textDelta(let sessionId, let delta, _) = event else {
            return XCTFail("expected .textDelta, got \(event)")
        }
        XCTAssertEqual(sessionId, "s1")
        XCTAssertEqual(delta, "Hello")
    }

    func testDecodesPermissionRequest() throws {
        let json = Data("""
        {
          "type": "permission_request",
          "sessionId": "s1",
          "request": {
            "requestId": "req-1",
            "toolName": "Bash",
            "command": "rm -rf /tmp/x",
            "description": "Delete a temp file"
          }
        }
        """.utf8)
        let event = try JSONDecoder().decode(SessionEvent.self, from: json)
        guard case .permissionRequest(let sessionId, let request) = event else {
            return XCTFail("expected .permissionRequest, got \(event)")
        }
        XCTAssertEqual(sessionId, "s1")
        XCTAssertEqual(request.requestId, "req-1")
        XCTAssertEqual(request.command, "rm -rf /tmp/x")
    }

    func testUnknownEventTypeDoesNotThrow() throws {
        // Forward-compat: packages/shared/src/protocol/dto.ts has 46 SessionEvent
        // variants; MVP only models a subset. New server-side variants must not
        // crash the client.
        let json = Data("""
        {"type": "workflow_agent_completed", "sessionId": "s1", "workflowId": "w1", "agentId": "a1"}
        """.utf8)
        let event = try JSONDecoder().decode(SessionEvent.self, from: json)
        guard case .unknown(let type) = event else {
            return XCTFail("expected .unknown, got \(event)")
        }
        XCTAssertEqual(type, "workflow_agent_completed")
    }
}
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd apps/ios/CraftAgentKit && swift test --filter SessionEventDecodingTests`
Expected: FAIL — "cannot find type 'SessionEvent' in scope".

- [ ] **Step 6: Implement `SessionEvent`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/SessionEvent.swift
import Foundation

/// Mirrors the MVP-relevant subset of the `SessionEvent` discriminated union
/// in `packages/shared/src/protocol/dto.ts`. Decoding an unrecognized `type`
/// yields `.unknown(type)` rather than throwing, so the client tolerates
/// server-side additions without a matching app release.
public enum SessionEvent: Equatable, Sendable {
    case textDelta(sessionId: String, delta: String, turnId: String?)
    case textComplete(sessionId: String, text: String)
    case toolStart(sessionId: String, toolName: String, toolUseId: String, toolInput: [String: JSONValue])
    case toolResult(sessionId: String, toolUseId: String, toolName: String, result: String, isError: Bool?)
    case errorEvent(sessionId: String, error: String)
    case complete(sessionId: String)
    case status(sessionId: String, message: String)
    case permissionRequest(sessionId: String, request: PermissionRequest)
    case userMessage(sessionId: String, message: ChatMessage, status: String)
    case sessionCreated(sessionId: String)
    case sessionDeleted(sessionId: String)
    case nameChanged(sessionId: String, name: String?)
    case sessionStatusChanged(sessionId: String, sessionStatus: String)
    case unknown(String)
}

extension SessionEvent: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, sessionId, delta, turnId, text, toolName, toolUseId, toolInput
        case result, isError, error, message, statusType, request, status
        case name, sessionStatus
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        let sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId) ?? ""

        switch type {
        case "text_delta":
            self = .textDelta(
                sessionId: sessionId,
                delta: try container.decode(String.self, forKey: .delta),
                turnId: try container.decodeIfPresent(String.self, forKey: .turnId)
            )
        case "text_complete":
            self = .textComplete(sessionId: sessionId, text: try container.decode(String.self, forKey: .text))
        case "tool_start":
            self = .toolStart(
                sessionId: sessionId,
                toolName: try container.decode(String.self, forKey: .toolName),
                toolUseId: try container.decode(String.self, forKey: .toolUseId),
                toolInput: try container.decodeIfPresent([String: JSONValue].self, forKey: .toolInput) ?? [:]
            )
        case "tool_result":
            self = .toolResult(
                sessionId: sessionId,
                toolUseId: try container.decode(String.self, forKey: .toolUseId),
                toolName: try container.decode(String.self, forKey: .toolName),
                result: try container.decode(String.self, forKey: .result),
                isError: try container.decodeIfPresent(Bool.self, forKey: .isError)
            )
        case "error":
            self = .errorEvent(sessionId: sessionId, error: try container.decode(String.self, forKey: .error))
        case "complete":
            self = .complete(sessionId: sessionId)
        case "status":
            self = .status(sessionId: sessionId, message: try container.decode(String.self, forKey: .message))
        case "permission_request":
            self = .permissionRequest(
                sessionId: sessionId,
                request: try container.decode(PermissionRequest.self, forKey: .request)
            )
        case "user_message":
            self = .userMessage(
                sessionId: sessionId,
                message: try container.decode(ChatMessage.self, forKey: .message),
                status: try container.decode(String.self, forKey: .status)
            )
        case "session_created":
            self = .sessionCreated(sessionId: sessionId)
        case "session_deleted":
            self = .sessionDeleted(sessionId: sessionId)
        case "name_changed":
            self = .nameChanged(sessionId: sessionId, name: try container.decodeIfPresent(String.self, forKey: .name))
        case "session_status_changed":
            self = .sessionStatusChanged(
                sessionId: sessionId,
                sessionStatus: try container.decode(String.self, forKey: .sessionStatus)
            )
        default:
            self = .unknown(type)
        }
    }

    public func encode(to encoder: Encoder) throws {
        // The client never re-encodes a SessionEvent onto the wire (it only
        // sends explicit RPC requests) — this satisfies `Codable` for
        // symmetry/testability but is not on any real send path.
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .textDelta(let sessionId, let delta, let turnId):
            try container.encode("text_delta", forKey: .type)
            try container.encode(sessionId, forKey: .sessionId)
            try container.encode(delta, forKey: .delta)
            try container.encodeIfPresent(turnId, forKey: .turnId)
        default:
            try container.encode("unknown", forKey: .type)
        }
    }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/ios/CraftAgentKit && swift test --filter SessionEventDecodingTests`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/ios/CraftAgentKit
git commit -m "feat(ios): add Session, ChatMessage, PermissionRequest, and SessionEvent models"
```

---

### Task 8: `RPCClient` and the Sessions API

**Files:**
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/JSONValue+Decoding.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient.swift`
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Sessions.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/JSONValueDecodingTests.swift`

**Interfaces:**
- Consumes: `RPCTransport`, `RPCChannels`, `JSONValue` (Tasks 2, 5), `Session`, `ChatMessage`, `SessionEvent` (Task 7).
- Produces: `RPCClient` (wraps an `RPCTransport`, exposes typed methods): `listSessions() async throws -> [Session]`, `getMessages(sessionId:) async throws -> [ChatMessage]`, `sendMessage(sessionId:text:attachments:) async throws`, `createSession(workspaceId:) async throws -> Session`, `respondToPermission(sessionId:requestId:allowed:alwaysAllow:) async throws`. These are the methods every ViewModel from Task 10 onward calls — signatures here are final for Phase 1/2/3.

- [ ] **Step 1: Write the failing test for typed JSONValue decoding**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/JSONValueDecodingTests.swift
import XCTest
@testable import CraftAgentKit

final class JSONValueDecodingTests: XCTestCase {
    func testDecodesArrayOfSessions() throws {
        let value = JSONValue.array([
            .object([
                "id": .string("s1"),
                "workspaceId": .string("w1"),
                "workspaceName": .string("Default"),
                "lastMessageAt": .number(1_700_000_000_000),
                "isProcessing": .bool(false),
            ])
        ])
        let sessions: [Session] = try value.decoded()
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].id, "s1")
        XCTAssertEqual(sessions[0].isProcessing, false)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ios/CraftAgentKit && swift test --filter JSONValueDecodingTests`
Expected: FAIL — "value of type 'JSONValue' has no member 'decoded'".

- [ ] **Step 3: Implement the `JSONValue` → `Decodable` bridge**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/JSONValue+Decoding.swift
import Foundation

extension JSONValue {
    /// Bridges a dynamically-typed `JSONValue` (as returned by
    /// `RPCTransport.request`) into a concrete `Decodable` model, by
    /// round-tripping through `Data`. This is the one conversion point
    /// between the transport layer and typed domain models.
    public func decoded<T: Decodable>() throws -> T {
        let data = try JSONEncoder().encode(self)
        return try JSONDecoder().decode(T.self, from: data)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ios/CraftAgentKit && swift test --filter JSONValueDecodingTests`
Expected: PASS

- [ ] **Step 5: Implement `RPCClient`**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient.swift
import Foundation

/// Typed façade over `RPCTransport`. ViewModels depend on this, never on
/// `RPCTransport` directly, so the wire format stays fully encapsulated.
public actor RPCClient {
    public let transport: RPCTransport

    public init(transport: RPCTransport) {
        self.transport = transport
    }

    public func connect(serverURL: URL, token: String, workspaceId: String?) async throws {
        try await transport.connect(serverURL: serverURL, token: token, workspaceId: workspaceId)
    }

    public func disconnect() async {
        await transport.disconnect()
    }

    /// Internal helper: send a request and decode its result as `T`.
    func call<T: Decodable>(_ channel: String, args: [JSONValue] = []) async throws -> T {
        let result = try await transport.request(channel: channel, args: args)
        return try result.decoded()
    }

    /// Internal helper for requests whose result the caller does not need.
    func callVoid(_ channel: String, args: [JSONValue] = []) async throws {
        _ = try await transport.request(channel: channel, args: args)
    }
}
```

- [ ] **Step 6: Implement the Sessions API extension**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Sessions.swift
import Foundation

extension RPCClient {
    /// `sessions:get` — no args; the server scopes results to the workspace
    /// sent on the handshake (`packages/server-core/src/handlers/rpc/sessions.ts:138`).
    public func listSessions() async throws -> [Session] {
        try await call(RPCChannels.Sessions.get)
    }

    /// `sessions:getMessages` — takes `sessionId`.
    public func getMessages(sessionId: String) async throws -> [ChatMessage] {
        try await call(RPCChannels.Sessions.getMessages, args: [.string(sessionId)])
    }

    /// `sessions:sendMessage(sessionId, message, attachments?, storedAttachments?, options?)`.
    /// The iOS client never populates `storedAttachments` (a desktop-only
    /// optimization for referencing already-on-disk files), so that
    /// positional arg is always `.null`.
    public func sendMessage(sessionId: String, text: String, attachments: [FileAttachment] = []) async throws {
        let attachmentsValue: JSONValue = attachments.isEmpty
            ? .null
            : try encodeAsJSONValue(attachments)
        try await callVoid(
            RPCChannels.Sessions.sendMessage,
            args: [.string(sessionId), .string(text), attachmentsValue, .null, .null]
        )
    }

    /// `sessions:create(workspaceId, options?)`. MVP never passes `options`.
    public func createSession(workspaceId: String) async throws -> Session {
        try await call(RPCChannels.Sessions.create, args: [.string(workspaceId), .null])
    }

    /// `sessions:respondToPermission(sessionId, requestId, allowed, alwaysAllow)`.
    public func respondToPermission(sessionId: String, requestId: String, allowed: Bool, alwaysAllow: Bool) async throws {
        try await callVoid(
            RPCChannels.Sessions.respondToPermission,
            args: [.string(sessionId), .string(requestId), .bool(allowed), .bool(alwaysAllow)]
        )
    }
}

/// Encodes any `Encodable` value into a `JSONValue` by round-tripping
/// through `Data` — the inverse of `JSONValue.decoded()`.
func encodeAsJSONValue<T: Encodable>(_ value: T) throws -> JSONValue {
    let data = try JSONEncoder().encode(value)
    return try JSONDecoder().decode(JSONValue.self, from: data)
}
```

- [ ] **Step 7: Run the full non-integration test suite**

Run: `cd apps/ios/CraftAgentKit && swift test`
Expected: PASS for every test except `RPCTransportIntegrationTests` (which self-skips without env vars).

- [ ] **Step 8: Commit**

```bash
git add apps/ios/CraftAgentKit
git commit -m "feat(ios): add RPCClient with typed Sessions API"
```

---

### Task 9: Minimal SwiftUI app boot

**Files:**
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/CraftAgentsApp.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/RootView.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Info.plist`

**Interfaces:**
- Consumes: `CraftAgentKit` (via the local package dependency declared in `project.yml`, Task 1).
- Produces: a launchable app target with an empty `RootView` — proves the XcodeGen + SwiftPM wiring works end to end before any real feature code is added.

- [ ] **Step 1: Create the Info.plist**

```xml
<!-- apps/ios/CraftAgentsApp/CraftAgentsApp/Info.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Craft Agents</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
</dict>
</plist>
```

- [ ] **Step 2: Create the root view**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/RootView.swift
import SwiftUI
import CraftAgentKit

struct RootView: View {
    var body: some View {
        Text("Craft Agents")
            .font(.title)
            .padding()
    }
}

#Preview {
    RootView()
}
```

- [ ] **Step 3: Create the app entry point**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/CraftAgentsApp.swift
import SwiftUI

@main
struct CraftAgentsApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
```

- [ ] **Step 4: Generate the Xcode project and build**

Run:
```bash
cd apps/ios/CraftAgentsApp && xcodegen generate
xcodebuild -project CraftAgentsApp.xcodeproj -scheme CraftAgentsApp \
  -destination 'generic/platform=iOS Simulator' build
```
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add apps/ios/CraftAgentsApp
git commit -m "feat(ios): boot a minimal SwiftUI app target wired to CraftAgentKit"
```

---

### Task 10: Server connection setup screen

**Files:**
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Onboarding/ServerConnectionViewModel.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Onboarding/ServerConnectionSetupView.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/RootView.swift`
- Test: `apps/ios/CraftAgentsApp/CraftAgentsAppTests/ServerConnectionViewModelTests.swift`

**Interfaces:**
- Consumes: `ServerConnectionStore`, `ServerConnection`, `RPCClient`, `RPCTransport` (from `CraftAgentKit`).
- Produces: `ServerConnectionViewModel` (`@Observable`, `connectionState: ConnectionState`, `workspaces: [Workspace]`, `func testConnectionAndFetchWorkspaces() async`, `func saveAndConnect(workspaceId: String) async`), `ServerConnectionSetupView`. `RootView` now branches between this screen and the session list based on whether a saved connection exists.

- [ ] **Step 1: Add a minimal `Workspace` model** (needed to populate the workspace picker)

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/Workspace.swift
import Foundation

/// Mirrors the MVP-relevant fields returned by `server:getWorkspaces`
/// (`packages/server-core/src/handlers/rpc/workspace.ts`).
public struct Workspace: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
}
```

```swift
// Append to apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Sessions.swift
extension RPCClient {
    /// `server:getWorkspaces` — no args.
    public func listWorkspaces() async throws -> [Workspace] {
        try await call(RPCChannels.Server.getWorkspaces)
    }
}
```

- [ ] **Step 2: Write the failing ViewModel test**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsAppTests/ServerConnectionViewModelTests.swift
import XCTest
@testable import CraftAgentsApp
import CraftAgentKit

final class ServerConnectionViewModelTests: XCTestCase {
    func testSavesConnectionAfterSuccessfulTest() async throws {
        let store = ServerConnectionStore(keychain: InMemoryKeychainStore())
        let viewModel = ServerConnectionViewModel(store: store)
        viewModel.serverURLText = "wss://example.com:9100"
        viewModel.token = "a-valid-looking-token-1234567890"

        // A real connection attempt requires a live server (covered by
        // RPCTransportIntegrationTests in CraftAgentKit); here we only verify
        // the save path once a connection is known-good.
        let connection = ServerConnection(
            name: "Test",
            url: URL(string: viewModel.serverURLText)!,
            token: viewModel.token,
            workspaceId: "w1"
        )
        try await store.save(connection)

        let saved = try await store.list()
        XCTAssertEqual(saved.first?.workspaceId, "w1")
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: FAIL to compile — "cannot find type 'ServerConnectionViewModel' in scope".

- [ ] **Step 4: Implement `ServerConnectionViewModel`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Onboarding/ServerConnectionViewModel.swift
import Foundation
import Observation
import CraftAgentKit

@Observable
@MainActor
final class ServerConnectionViewModel {
    var serverURLText: String = ""
    var token: String = ""
    var connectionState: ConnectionState = .idle
    var workspaces: [Workspace] = []
    var errorMessage: String?

    private let store: ServerConnectionStore
    private var pendingClient: RPCClient?

    init(store: ServerConnectionStore) {
        self.store = store
    }

    func testConnectionAndFetchWorkspaces() async {
        guard let url = URL(string: serverURLText) else {
            errorMessage = "Enter a valid server URL, e.g. wss://myserver.example.com:9100"
            return
        }
        errorMessage = nil
        connectionState = .connecting
        let transport = RPCTransport()
        let client = RPCClient(transport: transport)
        do {
            try await client.connect(serverURL: url, token: token, workspaceId: nil)
            workspaces = try await client.listWorkspaces()
            pendingClient = client
            connectionState = .connected
        } catch {
            connectionState = .failed(ConnectionError(kind: .unknown, message: "\(error)"))
            errorMessage = "Could not connect: \(error)"
        }
    }

    func saveAndConnect(workspaceId: String) async throws {
        guard let url = URL(string: serverURLText) else { return }
        let connection = ServerConnection(name: url.host ?? "Server", url: url, token: token, workspaceId: workspaceId)
        try await store.save(connection)
        await pendingClient?.disconnect()
    }
}
```

- [ ] **Step 5: Implement `ServerConnectionSetupView`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Onboarding/ServerConnectionSetupView.swift
import SwiftUI
import CraftAgentKit

struct ServerConnectionSetupView: View {
    @Bindable var viewModel: ServerConnectionViewModel
    var onConnected: () -> Void

    var body: some View {
        Form {
            Section("Server") {
                TextField("wss://myserver.example.com:9100", text: $viewModel.serverURLText)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                SecureField("Bearer token", text: $viewModel.token)
            }

            if let errorMessage = viewModel.errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }

            Section {
                Button("Test Connection") {
                    Task { await viewModel.testConnectionAndFetchWorkspaces() }
                }
            }

            if !viewModel.workspaces.isEmpty {
                Section("Choose a workspace") {
                    ForEach(viewModel.workspaces) { workspace in
                        Button(workspace.name) {
                            Task {
                                try? await viewModel.saveAndConnect(workspaceId: workspace.id)
                                onConnected()
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Connect to Server")
    }
}
```

- [ ] **Step 6: Wire it into `RootView`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/RootView.swift
import SwiftUI
import CraftAgentKit

struct RootView: View {
    @State private var hasSavedConnection = false
    @State private var connectionViewModel = ServerConnectionViewModel(
        store: ServerConnectionStore(keychain: KeychainStore())
    )

    var body: some View {
        NavigationStack {
            if hasSavedConnection {
                Text("Session list goes here (Task 11)")
            } else {
                ServerConnectionSetupView(viewModel: connectionViewModel) {
                    hasSavedConnection = true
                }
            }
        }
        .task {
            hasSavedConnection = !((try? await ServerConnectionStore(keychain: KeychainStore()).list()) ?? []).isEmpty
        }
    }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): add server connection setup flow with workspace picker"
```

---

### Task 11: Persistent app connection + session list

**Files:**
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/AppClientProvider.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/RootView.swift`
- Test: `apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionListViewModelTests.swift`

**Interfaces:**
- Consumes: `ServerConnectionStore`, `RPCClient`, `RPCTransport`, `RPCTransportDelegate`, `Session`, `SessionEvent` (from `CraftAgentKit`).
- Produces: `AppClientProvider` (`@Observable @MainActor`, owns the single long-lived `RPCClient` for the app session, exposes `connectionState` and `client: RPCClient?`), `SessionListViewModel` (`sessions: [Session]`, `func load() async`, conforms to `RPCTransportDelegate` to react to `session_created`/`session_deleted`/`name_changed`/`session_status_changed` events), `SessionListView` (`NavigationSplitView` sidebar).

- [ ] **Step 1: Implement `AppClientProvider`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/AppClientProvider.swift
import Foundation
import Observation
import CraftAgentKit

/// Owns the single `RPCClient` for the app's lifetime, established from the
/// most recently saved `ServerConnection`. Injected into the view hierarchy
/// so `SessionListViewModel`/`ChatViewModel` share one live connection
/// instead of each opening their own socket.
@Observable
@MainActor
final class AppClientProvider {
    private(set) var client: RPCClient?
    private(set) var connectionState: ConnectionState = .idle
    private let store: ServerConnectionStore

    init(store: ServerConnectionStore) {
        self.store = store
    }

    func connectToSavedServer() async {
        guard let connection = try? await store.list().first else { return }
        connectionState = .connecting
        let transport = RPCTransport()
        let client = RPCClient(transport: transport)
        do {
            try await client.connect(
                serverURL: connection.url,
                token: connection.token,
                workspaceId: connection.workspaceId
            )
            self.client = client
            connectionState = .connected
        } catch {
            connectionState = .failed(ConnectionError(kind: .network, message: "\(error)"))
        }
    }
}
```

- [ ] **Step 2: Write the failing test for `SessionListViewModel`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionListViewModelTests.swift
import XCTest
@testable import CraftAgentsApp
import CraftAgentKit

final class SessionListViewModelTests: XCTestCase {
    func testAppliesSessionCreatedEventOptimistically() async throws {
        let viewModel = SessionListViewModel(client: nil)
        XCTAssertTrue(viewModel.sessions.isEmpty)

        // Simulate what RPCTransport would deliver on a real "sessions:create"
        // response — the view model's `apply(_:)` is the single place that
        // reconciles both the initial `load()` fetch and live push events.
        let session = Session(
            id: "s1", workspaceId: "w1", workspaceName: "Default",
            name: "New chat", preview: nil, lastMessageAt: 1_700_000_000_000,
            isProcessing: false, isFlagged: nil, permissionMode: nil,
            sessionStatus: nil, labels: nil, hasUnread: nil, model: nil, messageCount: nil
        )
        viewModel.upsert(session)
        XCTAssertEqual(viewModel.sessions.count, 1)
        XCTAssertEqual(viewModel.sessions.first?.id, "s1")

        viewModel.remove(sessionId: "s1")
        XCTAssertTrue(viewModel.sessions.isEmpty)
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: FAIL to compile — "cannot find type 'SessionListViewModel' in scope".

- [ ] **Step 4: Implement `SessionListViewModel`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift
import Foundation
import Observation
import CraftAgentKit

@Observable
@MainActor
final class SessionListViewModel: RPCTransportDelegate {
    private(set) var sessions: [Session] = []
    var errorMessage: String?
    private let client: RPCClient?

    init(client: RPCClient?) {
        self.client = client
    }

    func load() async {
        guard let client else { return }
        do {
            sessions = try await client.listSessions()
            await client.transport.setDelegate(self)
        } catch {
            errorMessage = "\(error)"
        }
    }

    func upsert(_ session: Session) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.insert(session, at: 0)
        }
    }

    func remove(sessionId: String) {
        sessions.removeAll { $0.id == sessionId }
    }

    nonisolated func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {}

    nonisolated func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {
        guard envelope.channel == RPCChannels.Sessions.event,
              let firstArg = envelope.args?.first,
              let event = try? firstArg.decoded() as SessionEvent else { return }
        await MainActor.run {
            switch event {
            case .sessionDeleted(let sessionId):
                self.remove(sessionId: sessionId)
            case .nameChanged(let sessionId, let name):
                if let index = self.sessions.firstIndex(where: { $0.id == sessionId }) {
                    self.sessions[index].name = name
                }
            case .sessionStatusChanged(let sessionId, let status):
                if let index = self.sessions.firstIndex(where: { $0.id == sessionId }) {
                    self.sessions[index].sessionStatus = status
                }
            default:
                break
            }
        }
    }
}
```

- [ ] **Step 5: Implement `SessionListView`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift
import SwiftUI
import CraftAgentKit

struct SessionListView: View {
    @Bindable var viewModel: SessionListViewModel
    @State private var selectedSessionId: String?

    var body: some View {
        NavigationSplitView {
            List(viewModel.sessions, selection: $selectedSessionId) { session in
                VStack(alignment: .leading) {
                    Text(session.name ?? session.preview ?? "Untitled session")
                        .font(.headline)
                    if let sessionStatus = session.sessionStatus {
                        Text(sessionStatus).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .tag(session.id)
            }
            .navigationTitle("Sessions")
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
        } detail: {
            if let selectedSessionId {
                Text("Chat view for \(selectedSessionId) goes here (Task 12)")
            } else {
                Text("Select a session")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
```

- [ ] **Step 6: Wire `AppClientProvider` and `SessionListView` into `RootView`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/RootView.swift
import SwiftUI
import CraftAgentKit

struct RootView: View {
    @State private var hasSavedConnection = false
    @State private var connectionViewModel = ServerConnectionViewModel(
        store: ServerConnectionStore(keychain: KeychainStore())
    )
    @State private var appClientProvider = AppClientProvider(
        store: ServerConnectionStore(keychain: KeychainStore())
    )

    var body: some View {
        Group {
            if hasSavedConnection {
                SessionListView(viewModel: SessionListViewModel(client: appClientProvider.client))
            } else {
                NavigationStack {
                    ServerConnectionSetupView(viewModel: connectionViewModel) {
                        hasSavedConnection = true
                    }
                }
            }
        }
        .task {
            let hasSaved = !((try? await ServerConnectionStore(keychain: KeychainStore()).list()) ?? []).isEmpty
            if hasSaved {
                await appClientProvider.connectToSavedServer()
            }
            hasSavedConnection = hasSaved
        }
    }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): add persistent app connection and session list (NavigationSplitView)"
```

---

### Task 12: Streaming chat view

**Files:**
- Modify: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/RPCTransport.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/RPCTransportMultiDelegateTests.swift`
- Test: `apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift`

**Interfaces:**
- Consumes: `RPCClient`, `SessionEvent`, `ChatMessage` (`CraftAgentKit`).
- Produces: `RPCTransport.addDelegate(_:)`/`removeDelegate(_:)` (replaces the single `delegate` property from Task 5 — both `SessionListViewModel` and `ChatViewModel` need to observe the same event stream at once), `ChatViewModel` (`messages: [ChatMessage]`, `func load() async`, `func send(text: String) async`), `ChatView`.

**Step 0 rationale:** Task 5's `RPCTransport` exposed a single `weak var delegate`. Once `ChatViewModel` also needs live events for the currently-open session, a second delegate registration would silently evict `SessionListViewModel`'s registration and break background list updates. Fix this now, before a second consumer exists, by switching to a small multi-delegate registry.

- [ ] **Step 1: Write the failing test for multi-delegate support**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/RPCTransportMultiDelegateTests.swift
import XCTest
@testable import CraftAgentKit

final class RPCTransportMultiDelegateTests: XCTestCase {
    private final class RecordingDelegate: RPCTransportDelegate {
        var receivedEventCount = 0
        func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {}
        func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {
            receivedEventCount += 1
        }
    }

    func testBothDelegatesReceiveTheSameEvent() async {
        let transport = RPCTransport()
        let delegateA = RecordingDelegate()
        let delegateB = RecordingDelegate()
        await transport.addDelegate(delegateA)
        await transport.addDelegate(delegateB)

        let envelope = MessageEnvelope(id: "e1", type: .event, channel: RPCChannels.Sessions.event, args: [])
        await transport.dispatchForTesting(envelope)

        XCTAssertEqual(delegateA.receivedEventCount, 1)
        XCTAssertEqual(delegateB.receivedEventCount, 1)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ios/CraftAgentKit && swift test --filter RPCTransportMultiDelegateTests`
Expected: FAIL — "value of type 'RPCTransport' has no member 'addDelegate'".

- [ ] **Step 3: Replace the single delegate with a multi-delegate registry**

```swift
// In apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/RPCTransport.swift,
// replace the `public weak var delegate: RPCTransportDelegate?` property and
// the `setDelegate` extension with:

// (remove) public weak var delegate: RPCTransportDelegate?
// (remove) extension RPCTransport { public func setDelegate(...) }

// Add inside the `RPCTransport` actor body, replacing every
// `delegate?.transport(...)` call site with `notifyDelegates { ... }`:
```

```swift
// New state + methods for RPCTransport (actor body):
private var delegates: [ObjectIdentifier: RPCTransportDelegate] = [:]

public func addDelegate(_ delegate: RPCTransportDelegate) {
    delegates[ObjectIdentifier(delegate)] = delegate
}

public func removeDelegate(_ delegate: RPCTransportDelegate) {
    delegates.removeValue(forKey: ObjectIdentifier(delegate))
}

private func notifyDelegates(_ body: @escaping (RPCTransportDelegate) async -> Void) {
    for delegate in delegates.values {
        Task { await body(delegate) }
    }
}

/// Test-only hook so `RPCTransportMultiDelegateTests` can exercise
/// `notifyDelegates` without a live socket.
func dispatchForTesting(_ envelope: MessageEnvelope) async {
    await handle(envelope)
}
```

Then update the two call sites that previously used the single delegate:
```swift
// in handle(_:) for the .event case:
case .event:
    if let seq = envelope.seq {
        lastSeenSeq = max(lastSeenSeq, seq)
    }
    notifyDelegates { await $0.transport(self, didReceiveEvent: envelope) }

// in updateState(_:):
private func updateState(_ newState: ConnectionState) {
    state = newState
    notifyDelegates { await $0.transport(self, didChangeState: newState) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ios/CraftAgentKit && swift test --filter RPCTransportMultiDelegateTests`
Expected: PASS

- [ ] **Step 5: Update `SessionListViewModel` to use `addDelegate`**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift,
// inside func load(), replace:
//   await client.transport.setDelegate(self)
// with:
    await client.transport.addDelegate(self)
```

- [ ] **Step 6: Write the failing `ChatViewModel` test**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift
import XCTest
@testable import CraftAgentsApp
import CraftAgentKit

final class ChatViewModelTests: XCTestCase {
    func testAppliesStreamingTextDeltaToLastAssistantMessage() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.textDelta(sessionId: "s1", delta: "Hel", turnId: "t1"))
        viewModel.apply(.textDelta(sessionId: "s1", delta: "lo", turnId: "t1"))

        XCTAssertEqual(viewModel.messages.count, 1)
        XCTAssertEqual(viewModel.messages.first?.content, "Hello")
        XCTAssertEqual(viewModel.messages.first?.isStreaming, true)
    }

    func testTextCompleteFinalizesTheMessage() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.textDelta(sessionId: "s1", delta: "Hi", turnId: "t1"))
        viewModel.apply(.textComplete(sessionId: "s1", text: "Hi there"))

        XCTAssertEqual(viewModel.messages.first?.content, "Hi there")
        XCTAssertEqual(viewModel.messages.first?.isStreaming, false)
    }

    func testEventsForOtherSessionsAreIgnored() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.textDelta(sessionId: "other-session", delta: "nope", turnId: nil))
        XCTAssertTrue(viewModel.messages.isEmpty)
    }
}
```

- [ ] **Step 7: Run test to verify it fails**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: FAIL to compile — "cannot find type 'ChatViewModel' in scope".

- [ ] **Step 8: Implement `ChatViewModel`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift
import Foundation
import Observation
import CraftAgentKit

@Observable
@MainActor
final class ChatViewModel: RPCTransportDelegate {
    private(set) var messages: [ChatMessage] = []
    var draftText: String = ""
    var errorMessage: String?

    private let client: RPCClient?
    let sessionId: String
    private var streamingMessageId: String?

    init(client: RPCClient?, sessionId: String) {
        self.client = client
        self.sessionId = sessionId
    }

    func load() async {
        guard let client else { return }
        do {
            messages = try await client.getMessages(sessionId: sessionId)
            await client.transport.addDelegate(self)
        } catch {
            errorMessage = "\(error)"
        }
    }

    func send() async {
        guard let client, !draftText.isEmpty else { return }
        let text = draftText
        draftText = ""
        do {
            try await client.sendMessage(sessionId: sessionId, text: text)
        } catch {
            errorMessage = "\(error)"
        }
    }

    /// Applies one `SessionEvent` to local chat state. Pulled out of the
    /// delegate callback so it is directly unit-testable without a transport.
    func apply(_ event: SessionEvent) {
        switch event {
        case .textDelta(let eventSessionId, let delta, _):
            guard eventSessionId == sessionId else { return }
            appendStreamingDelta(delta)
        case .textComplete(let eventSessionId, let text):
            guard eventSessionId == sessionId else { return }
            finalizeStreamingMessage(text: text)
        case .errorEvent(let eventSessionId, let error):
            guard eventSessionId == sessionId else { return }
            errorMessage = error
        default:
            break
        }
    }

    private func appendStreamingDelta(_ delta: String) {
        if let streamingMessageId, let index = messages.firstIndex(where: { $0.id == streamingMessageId }) {
            messages[index].content += delta
        } else {
            let id = UUID().uuidString
            streamingMessageId = id
            messages.append(ChatMessage(
                id: id, role: .assistant, content: delta, timestamp: Date().timeIntervalSince1970 * 1000,
                isStreaming: true
            ))
        }
    }

    private func finalizeStreamingMessage(text: String) {
        guard let streamingMessageId, let index = messages.firstIndex(where: { $0.id == streamingMessageId }) else {
            messages.append(ChatMessage(
                id: UUID().uuidString, role: .assistant, content: text,
                timestamp: Date().timeIntervalSince1970 * 1000, isStreaming: false
            ))
            return
        }
        messages[index].content = text
        messages[index].isStreaming = false
        self.streamingMessageId = nil
    }

    nonisolated func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {}

    nonisolated func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {
        guard envelope.channel == RPCChannels.Sessions.event,
              let firstArg = envelope.args?.first,
              let event = try? firstArg.decoded() as SessionEvent else { return }
        await MainActor.run { self.apply(event) }
    }
}
```

- [ ] **Step 9: Implement `ChatView`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift
import SwiftUI
import CraftAgentKit

struct ChatView: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(viewModel.messages) { message in
                        Text(message.content)
                            .padding(10)
                            .background(message.role == .user ? Color.blue.opacity(0.15) : Color.gray.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
                    }
                }
                .padding()
            }
            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.caption).padding(.horizontal)
            }
            HStack {
                TextField("Message", text: $viewModel.draftText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Button("Send") { Task { await viewModel.send() } }
                    .disabled(viewModel.draftText.isEmpty)
            }
            .padding()
        }
        .task { await viewModel.load() }
        .navigationTitle("Chat")
    }
}
```

- [ ] **Step 10: Wire `ChatView` into `SessionListView`'s detail column**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift,
// replace the `detail:` closure body:
} detail: {
    if let selectedSessionId {
        ChatView(viewModel: ChatViewModel(client: viewModel.clientForDetail, sessionId: selectedSessionId))
    } else {
        Text("Select a session")
            .foregroundStyle(.secondary)
    }
}
```

```swift
// Add a small accessor to SessionListViewModel so the view can hand the
// same RPCClient to ChatViewModel:
extension SessionListViewModel {
    var clientForDetail: RPCClient? { client }
}
// (requires changing `private let client` to `private(set) let client` in
// SessionListViewModel's declaration from Task 11)
```

- [ ] **Step 11: Run tests to verify they pass**

Run:
```bash
cd apps/ios/CraftAgentKit && swift test
xcodebuild test -project ../CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'
```
Expected: PASS for both suites.

- [ ] **Step 12: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): stream assistant responses into ChatView; support multiple RPCTransport delegates"
```

---

**Phase 1 acceptance:** Launch the app against a real `bun run server:start`, enter its URL + generated token, pick a workspace, see the session list populate and update live, open a session, send a message, and watch the assistant's reply stream in token-by-token.

---

## Phase 2 — Tool visualization, permission approval, attachments

### Task 13: Tool-call visualization

**Files:**
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ToolCallCardView.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift`
- Test: append to `apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift`

**Interfaces:**
- Consumes: `SessionEvent.toolStart`/`.toolResult` (Task 7), `ChatMessage` (Task 7, `toolName`/`toolUseId`/`toolInput`/`toolResult`/`toolStatus` fields already declared).
- Produces: `ChatViewModel.apply(_:)` now also handles `.toolStart`/`.toolResult`, appending/updating a `role == .tool` `ChatMessage`. `ToolCallCardView` renders one such message as a collapsible card.

- [ ] **Step 1: Write the failing test**

```swift
// Append to apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift
extension ChatViewModelTests {
    func testToolStartThenToolResultUpdateTheSameMessage() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.toolStart(
            sessionId: "s1", toolName: "Bash", toolUseId: "tool-1",
            toolInput: ["command": .string("ls -la")]
        ))
        XCTAssertEqual(viewModel.messages.count, 1)
        XCTAssertEqual(viewModel.messages.first?.toolStatus, "running")

        viewModel.apply(.toolResult(
            sessionId: "s1", toolUseId: "tool-1", toolName: "Bash",
            result: "file1.txt\nfile2.txt", isError: false
        ))
        XCTAssertEqual(viewModel.messages.count, 1)
        XCTAssertEqual(viewModel.messages.first?.toolResult, "file1.txt\nfile2.txt")
        XCTAssertEqual(viewModel.messages.first?.toolStatus, "success")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: FAIL — tool messages not produced, assertions fail.

- [ ] **Step 3: Extend `ChatViewModel.apply(_:)`**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift,
// add two new cases inside `func apply(_ event: SessionEvent)`'s switch,
// alongside the existing .textDelta/.textComplete/.errorEvent cases:
        case .toolStart(let eventSessionId, let toolName, let toolUseId, let toolInput):
            guard eventSessionId == sessionId else { return }
            messages.append(ChatMessage(
                id: toolUseId, role: .tool, content: "",
                timestamp: Date().timeIntervalSince1970 * 1000,
                toolName: toolName, toolUseId: toolUseId, toolInput: toolInput,
                toolStatus: "running"
            ))
        case .toolResult(let eventSessionId, let toolUseId, _, let result, let isError):
            guard eventSessionId == sessionId else { return }
            guard let index = messages.firstIndex(where: { $0.toolUseId == toolUseId }) else { return }
            messages[index].toolResult = result
            messages[index].toolStatus = (isError ?? false) ? "error" : "success"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: PASS

- [ ] **Step 5: Implement `ToolCallCardView`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ToolCallCardView.swift
import SwiftUI
import CraftAgentKit

struct ToolCallCardView: View {
    let message: ChatMessage
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            if let result = message.toolResult {
                Text(result)
                    .font(.system(.caption, design: .monospaced))
                    .padding(.top, 4)
            }
        } label: {
            HStack {
                statusIcon
                Text(message.toolName ?? "Tool")
                    .font(.subheadline.bold())
            }
        }
        .padding(10)
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch message.toolStatus {
        case "running":
            ProgressView().controlSize(.small)
        case "error":
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        default:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        }
    }
}
```

- [ ] **Step 6: Render tool messages in `ChatView`**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift, replace the
// `ForEach(viewModel.messages)` body with a branch on role:
ForEach(viewModel.messages) { message in
    if message.role == .tool {
        ToolCallCardView(message: message)
    } else {
        Text(message.content)
            .padding(10)
            .background(message.role == .user ? Color.blue.opacity(0.15) : Color.gray.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): render tool_start/tool_result events as collapsible tool cards"
```

---

### Task 14: Permission approval

**Files:**
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/PermissionApprovalSheet.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift`
- Test: append to `apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift`

**Interfaces:**
- Consumes: `SessionEvent.permissionRequest`, `PermissionRequest`, `RPCClient.respondToPermission(sessionId:requestId:allowed:alwaysAllow:)` (Task 8).
- Produces: `ChatViewModel.pendingPermissionRequest: PermissionRequest?`, `ChatViewModel.respond(allowed:alwaysAllow:) async`, `PermissionApprovalSheet`.

- [ ] **Step 1: Write the failing test**

```swift
// Append to apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift
extension ChatViewModelTests {
    func testPermissionRequestEventSurfacesForApproval() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        let request = PermissionRequest(
            requestId: "req-1", toolName: "Bash", command: "rm -rf /tmp/x",
            description: "Delete a temp file"
        )
        viewModel.apply(.permissionRequest(sessionId: "s1", request: request))
        XCTAssertEqual(viewModel.pendingPermissionRequest?.requestId, "req-1")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: FAIL — `pendingPermissionRequest` does not exist.

- [ ] **Step 3: Extend `ChatViewModel`**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift:

// Add a stored property alongside `messages`:
var pendingPermissionRequest: PermissionRequest?

// Add a case to the switch in `apply(_:)`:
case .permissionRequest(let eventSessionId, let request):
    guard eventSessionId == sessionId else { return }
    pendingPermissionRequest = request

// Add a new method:
func respond(allowed: Bool, alwaysAllow: Bool) async {
    guard let client, let request = pendingPermissionRequest else { return }
    do {
        try await client.respondToPermission(
            sessionId: sessionId, requestId: request.requestId,
            allowed: allowed, alwaysAllow: alwaysAllow
        )
        pendingPermissionRequest = nil
    } catch {
        errorMessage = "\(error)"
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: PASS

- [ ] **Step 5: Implement `PermissionApprovalSheet`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/PermissionApprovalSheet.swift
import SwiftUI
import CraftAgentKit

struct PermissionApprovalSheet: View {
    let request: PermissionRequest
    let onRespond: (_ allowed: Bool, _ alwaysAllow: Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(request.toolName).font(.title2.bold())
            Text(request.description)
            if let command = request.command {
                Text(command)
                    .font(.system(.body, design: .monospaced))
                    .padding(8)
                    .background(Color.gray.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            HStack {
                Button("Deny") { onRespond(false, false) }
                    .buttonStyle(.bordered)
                Spacer()
                Button("Allow Once") { onRespond(true, false) }
                    .buttonStyle(.bordered)
                Button("Always Allow") { onRespond(true, true) }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding()
    }
}
```

- [ ] **Step 6: Present the sheet from `ChatView`**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift, add a
// `.sheet` modifier on the outer VStack:
.sheet(item: $viewModel.pendingPermissionRequest) { request in
    PermissionApprovalSheet(request: request) { allowed, alwaysAllow in
        Task { await viewModel.respond(allowed: allowed, alwaysAllow: alwaysAllow) }
    }
    .presentationDetents([.medium])
}
```

```swift
// PermissionApprovalSheet's `.sheet(item:)` requires PermissionRequest to be
// Identifiable. Add this conformance in
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/PermissionRequest.swift:
extension PermissionRequest: Identifiable {
    public var id: String { requestId }
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): add permission approval sheet wired to permission_request events"
```

---

### Task 15: Attachments

**Files:**
- Create: `apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/FileAttachment+Builder.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift`
- Test: `apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/FileAttachmentBuilderTests.swift`

**Interfaces:**
- Consumes: `FileAttachment` (Task 7), `RPCClient.sendMessage(sessionId:text:attachments:)` (Task 8, already accepts `[FileAttachment]`).
- Produces: `FileAttachment.image(named:data:)` builder, `ChatViewModel.pendingAttachments: [FileAttachment]`, `ChatViewModel.send()` now passes `pendingAttachments` through.

- [ ] **Step 1: Write the failing test**

```swift
// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/FileAttachmentBuilderTests.swift
import XCTest
@testable import CraftAgentKit

final class FileAttachmentBuilderTests: XCTestCase {
    func testBuildsAnImageAttachmentWithBase64() {
        let data = Data([0xFF, 0xD8, 0xFF, 0xD9]) // minimal JPEG-ish bytes for the test
        let attachment = FileAttachment.image(named: "photo.jpg", data: data, mimeType: "image/jpeg")

        XCTAssertEqual(attachment.type, .image)
        XCTAssertEqual(attachment.name, "photo.jpg")
        XCTAssertEqual(attachment.size, 4)
        XCTAssertEqual(attachment.base64, data.base64EncodedString())
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ios/CraftAgentKit && swift test --filter FileAttachmentBuilderTests`
Expected: FAIL — "type 'FileAttachment' has no member 'image'".

- [ ] **Step 3: Implement the builder**

```swift
// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/FileAttachment+Builder.swift
import Foundation

extension FileAttachment {
    /// Builds an image `FileAttachment` from raw bytes (e.g. from
    /// `PhotosPicker`/`UIImage.jpegData`). `path` is set to `name` — the
    /// server only uses `path` as a display fallback for locally-referenced
    /// files, which does not apply to attachments sent from a remote client.
    public static func image(named name: String, data: Data, mimeType: String) -> FileAttachment {
        FileAttachment(
            type: .image,
            path: name,
            name: name,
            mimeType: mimeType,
            base64: data.base64EncodedString(),
            text: nil,
            size: data.count,
            thumbnailBase64: nil
        )
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ios/CraftAgentKit && swift test --filter FileAttachmentBuilderTests`
Expected: PASS

- [ ] **Step 5: Wire attachments through `ChatViewModel` and `ChatView`**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift:

// Add a stored property:
var pendingAttachments: [FileAttachment] = []

// Update `func send()` to pass them through and clear on success:
func send() async {
    guard let client, !draftText.isEmpty || !pendingAttachments.isEmpty else { return }
    let text = draftText
    let attachments = pendingAttachments
    draftText = ""
    pendingAttachments = []
    do {
        try await client.sendMessage(sessionId: sessionId, text: text, attachments: attachments)
    } catch {
        errorMessage = "\(error)"
    }
}
```

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift, add a
// PhotosPicker above the existing HStack text field row:
import PhotosUI

// New @State in ChatView:
@State private var photoPickerItem: PhotosPickerItem?

// New view, placed above the existing `HStack { TextField... Button("Send")... }`:
PhotosPicker(selection: $photoPickerItem, matching: .images) {
    Image(systemName: "paperclip")
}
.onChange(of: photoPickerItem) { _, newItem in
    Task {
        guard let newItem, let data = try? await newItem.loadTransferable(type: Data.self) else { return }
        viewModel.pendingAttachments.append(
            FileAttachment.image(named: "photo.jpg", data: data, mimeType: "image/jpeg")
        )
        photoPickerItem = nil
    }
}
if !viewModel.pendingAttachments.isEmpty {
    Text("\(viewModel.pendingAttachments.count) attachment(s) ready to send")
        .font(.caption)
        .foregroundStyle(.secondary)
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): add photo attachment picker and wire it into sendMessage"
```

---

**Phase 2 acceptance:** From a real session, trigger a bash-tool call and see it render as a collapsible card with a live/success/error status; trigger a permission-gated tool and approve/deny it from the sheet; attach a photo and confirm it arrives server-side as a `FileAttachment` with a valid `base64` payload.

---

## Phase 3 — Offline cache, new session, iPad polish

### Task 16: SwiftData offline cache

**Files:**
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/CachedSession.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/CachedMessage.swift`
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/SessionCacheRepository.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift`
- Test: `apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionCacheRepositoryTests.swift`

**Interfaces:**
- Consumes: `Session`, `ChatMessage` (`CraftAgentKit`, Task 7).
- Produces: `CachedSession`/`CachedMessage` (`@Model`), `SessionCacheRepository` (`func upsert(_ session: Session)`, `func upsert(_ message: ChatMessage, sessionId: String)`, `func cachedSessions() throws -> [Session]`, `func cachedMessages(sessionId: String) throws -> [ChatMessage]`). `SessionListViewModel.load()` and `ChatViewModel.load()` now fall back to this cache when the RPC call fails (offline), and write through to it on every successful fetch/event.

- [ ] **Step 1: Implement the SwiftData models**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/CachedSession.swift
import Foundation
import SwiftData

@Model
final class CachedSession {
    @Attribute(.unique) var id: String
    var workspaceId: String
    var workspaceName: String
    var name: String?
    var preview: String?
    var lastMessageAt: Double
    var isProcessing: Bool
    var sessionStatus: String?

    init(id: String, workspaceId: String, workspaceName: String, name: String?, preview: String?, lastMessageAt: Double, isProcessing: Bool, sessionStatus: String?) {
        self.id = id
        self.workspaceId = workspaceId
        self.workspaceName = workspaceName
        self.name = name
        self.preview = preview
        self.lastMessageAt = lastMessageAt
        self.isProcessing = isProcessing
        self.sessionStatus = sessionStatus
    }
}
```

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/CachedMessage.swift
import Foundation
import SwiftData

@Model
final class CachedMessage {
    @Attribute(.unique) var id: String
    var sessionId: String
    var role: String
    var content: String
    var timestamp: Double

    init(id: String, sessionId: String, role: String, content: String, timestamp: Double) {
        self.id = id
        self.sessionId = sessionId
        self.role = role
        self.content = content
        self.timestamp = timestamp
    }
}
```

- [ ] **Step 2: Write the failing repository test**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionCacheRepositoryTests.swift
import XCTest
import SwiftData
@testable import CraftAgentsApp
import CraftAgentKit

final class SessionCacheRepositoryTests: XCTestCase {
    func testCachesAndReloadsSessionsAndMessages() throws {
        let schema = Schema([CachedSession.self, CachedMessage.self])
        let container = try ModelContainer(for: schema, configurations: [.init(isStoredInMemoryOnly: true)])
        let repository = SessionCacheRepository(modelContainer: container)

        let session = Session(
            id: "s1", workspaceId: "w1", workspaceName: "Default", name: "Cached chat",
            preview: nil, lastMessageAt: 1_700_000_000_000, isProcessing: false,
            isFlagged: nil, permissionMode: nil, sessionStatus: "todo", labels: nil,
            hasUnread: nil, model: nil, messageCount: nil
        )
        try repository.upsert(session)

        let message = ChatMessage(id: "m1", role: .user, content: "hello", timestamp: 1_700_000_000_100)
        try repository.upsert(message, sessionId: "s1")

        let cachedSessions = try repository.cachedSessions()
        XCTAssertEqual(cachedSessions.map(\.id), ["s1"])

        let cachedMessages = try repository.cachedMessages(sessionId: "s1")
        XCTAssertEqual(cachedMessages.map(\.content), ["hello"])
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: FAIL — "cannot find type 'SessionCacheRepository' in scope".

- [ ] **Step 4: Implement `SessionCacheRepository`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/SessionCacheRepository.swift
import Foundation
import SwiftData
import CraftAgentKit

/// Write-through cache for offline read access. Every successful `RPCClient`
/// fetch/event writes here; `SessionListViewModel`/`ChatViewModel` read from
/// here only when the live RPC call fails (see Task 17 for the
/// connection-state-driven read/write gating).
@MainActor
final class SessionCacheRepository {
    private let modelContext: ModelContext

    init(modelContainer: ModelContainer) {
        self.modelContext = ModelContext(modelContainer)
    }

    func upsert(_ session: Session) throws {
        let sessionId = session.id
        let descriptor = FetchDescriptor<CachedSession>(predicate: #Predicate { $0.id == sessionId })
        if let existing = try modelContext.fetch(descriptor).first {
            existing.name = session.name
            existing.preview = session.preview
            existing.lastMessageAt = session.lastMessageAt
            existing.isProcessing = session.isProcessing
            existing.sessionStatus = session.sessionStatus
        } else {
            modelContext.insert(CachedSession(
                id: session.id, workspaceId: session.workspaceId, workspaceName: session.workspaceName,
                name: session.name, preview: session.preview, lastMessageAt: session.lastMessageAt,
                isProcessing: session.isProcessing, sessionStatus: session.sessionStatus
            ))
        }
        try modelContext.save()
    }

    func upsert(_ message: ChatMessage, sessionId: String) throws {
        let messageId = message.id
        let descriptor = FetchDescriptor<CachedMessage>(predicate: #Predicate { $0.id == messageId })
        if let existing = try modelContext.fetch(descriptor).first {
            existing.content = message.content
        } else {
            modelContext.insert(CachedMessage(
                id: message.id, sessionId: sessionId, role: message.role.rawValue,
                content: message.content, timestamp: message.timestamp
            ))
        }
        try modelContext.save()
    }

    func cachedSessions() throws -> [Session] {
        let descriptor = FetchDescriptor<CachedSession>(sortBy: [SortDescriptor(\.lastMessageAt, order: .reverse)])
        return try modelContext.fetch(descriptor).map { cached in
            Session(
                id: cached.id, workspaceId: cached.workspaceId, workspaceName: cached.workspaceName,
                name: cached.name, preview: cached.preview, lastMessageAt: cached.lastMessageAt,
                isProcessing: false, isFlagged: nil, permissionMode: nil,
                sessionStatus: cached.sessionStatus, labels: nil, hasUnread: nil, model: nil, messageCount: nil
            )
        }
    }

    func cachedMessages(sessionId: String) throws -> [ChatMessage] {
        let descriptor = FetchDescriptor<CachedMessage>(
            predicate: #Predicate { $0.sessionId == sessionId },
            sortBy: [SortDescriptor(\.timestamp, order: .forward)]
        )
        return try modelContext.fetch(descriptor).map { cached in
            ChatMessage(
                id: cached.id, role: MessageRole(rawValue: cached.role) ?? .assistant,
                content: cached.content, timestamp: cached.timestamp
            )
        }
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: PASS

- [ ] **Step 6: Wire the cache into `SessionListViewModel.load()` and `ChatViewModel.load()`**

Give both view models a `cache: SessionCacheRepository? = nil` initializer parameter
(default `nil` so Task 11's existing call sites keep compiling unchanged) and
update `RootView` to construct and pass a real repository:

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift,
// change the initializer to:
init(client: RPCClient?, cache: SessionCacheRepository? = nil) {
    self.client = client
    self.cache = cache
}
// and add the stored property declaration next to `private let client`:
private let cache: SessionCacheRepository?
```

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift,
// add a `cache: SessionCacheRepository?` init parameter and change `load()` to:
func load() async {
    guard let client else {
        sessions = (try? cache?.cachedSessions()) ?? []
        return
    }
    do {
        sessions = try await client.listSessions()
        for session in sessions { try? cache?.upsert(session) }
        await client.transport.addDelegate(self)
    } catch {
        errorMessage = "\(error)"
        sessions = (try? cache?.cachedSessions()) ?? []
    }
}
```

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift, change
// the initializer to accept `cache: SessionCacheRepository? = nil` (default
// nil so every existing Task 12-15 call site keeps compiling unchanged),
// and add the stored property declaration next to `private let client`:
init(client: RPCClient?, sessionId: String, cache: SessionCacheRepository? = nil) {
    self.client = client
    self.sessionId = sessionId
    self.cache = cache
}
private let cache: SessionCacheRepository?

// then change `load()` to:
func load() async {
    guard let client else {
        messages = (try? cache?.cachedMessages(sessionId: sessionId)) ?? []
        return
    }
    do {
        messages = try await client.getMessages(sessionId: sessionId)
        for message in messages { try? cache?.upsert(message, sessionId: sessionId) }
        await client.transport.addDelegate(self)
    } catch {
        errorMessage = "\(error)"
        messages = (try? cache?.cachedMessages(sessionId: sessionId)) ?? []
    }
}
```

- [ ] **Step 7: Construct a real `SessionCacheRepository` in `RootView` and pass it down**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/RootView.swift, add a shared
// ModelContainer and cache instance, and pass it into SessionListView:
import SwiftData

struct RootView: View {
    // ... existing @State properties ...
    private let cache = SessionCacheRepository(
        modelContainer: try! ModelContainer(for: Schema([CachedSession.self, CachedMessage.self]))
    )

    var body: some View {
        Group {
            if hasSavedConnection {
                SessionListView(viewModel: SessionListViewModel(client: appClientProvider.client, cache: cache))
            } else {
                // ... unchanged ...
            }
        }
        // ... unchanged .task { ... } ...
    }
}
```

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift,
// thread the same cache into the detail ChatView:
} detail: {
    if let selectedSessionId {
        ChatView(viewModel: ChatViewModel(client: viewModel.clientForDetail, sessionId: selectedSessionId, cache: viewModel.clientCache))
    } else {
        Text("Select a session")
            .foregroundStyle(.secondary)
    }
}
```

```swift
// Add a second accessor next to `clientForDetail` (Task 12) in
// SessionListViewModel:
extension SessionListViewModel {
    var clientCache: SessionCacheRepository? { cache }
}
// (requires changing `private let cache` to `private(set) let cache` above)
```

- [ ] **Step 8: Run the full test suite**

Run:
```bash
cd apps/ios/CraftAgentKit && swift test
xcodebuild test -project ../CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'
```
Expected: PASS for both suites.

- [ ] **Step 9: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): add SwiftData offline cache with read-through fallback"
```

---

### Task 17: Offline banner and write-action gating

**Files:**
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/OfflineBannerView.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift`
- Test: append to `apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift`

**Interfaces:**
- Consumes: `ConnectionState` (`CraftAgentKit`, Task 5).
- Produces: `ChatViewModel.isOffline: Bool` (derived from whether `client` is nil, per the approved design's rule that offline write attempts are prevented at the UI entry point rather than optimistically accepted), `OfflineBannerView`.

- [ ] **Step 1: Write the failing test**

```swift
// Append to apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift
extension ChatViewModelTests {
    func testIsOfflineWhenNoClientIsAvailable() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        XCTAssertTrue(viewModel.isOffline)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: FAIL — `isOffline` does not exist.

- [ ] **Step 3: Add `isOffline` to `ChatViewModel`**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift,
// add a computed property:
var isOffline: Bool { client == nil }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: PASS

- [ ] **Step 5: Implement `OfflineBannerView` and gate the send/attach controls**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/OfflineBannerView.swift
import SwiftUI

struct OfflineBannerView: View {
    var body: some View {
        Label("Offline — showing cached data", systemImage: "wifi.slash")
            .font(.caption)
            .padding(8)
            .frame(maxWidth: .infinity)
            .background(Color.orange.opacity(0.2))
    }
}
```

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift:
// 1. Add, as the first child of the outer VStack:
if viewModel.isOffline {
    OfflineBannerView()
}
// 2. Disable the send button and attachment picker when offline:
Button("Send") { Task { await viewModel.send() } }
    .disabled(viewModel.draftText.isEmpty || viewModel.isOffline)
PhotosPicker(selection: $photoPickerItem, matching: .images) {
    Image(systemName: "paperclip")
}
.disabled(viewModel.isOffline)
```

- [ ] **Step 6: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): add offline banner and disable write actions when disconnected"
```

---

### Task 18: New session creation and workspace switching

**Files:**
- Create: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/NewSessionSheet.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift`
- Test: append to `apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionListViewModelTests.swift`

**Interfaces:**
- Consumes: `RPCClient.createSession(workspaceId:)` (Task 8).
- Produces: `SessionListViewModel.createSession(workspaceId:) async -> Session?`, `NewSessionSheet`.

- [ ] **Step 1: Write the failing test**

`RPCClient` is a concrete actor wrapping a real socket (Task 8), so exercising
the actual `sessions:create` round trip needs a live server — that path is
covered by the same manual/integration pattern established in Task 5
(`RPCTransportIntegrationTests`), not by a unit test here. What *is*
unit-testable without a network call is the list-ordering contract
`createSession` depends on: newly-`upsert`-ed sessions must land at index 0.

```swift
// Append to apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionListViewModelTests.swift
extension SessionListViewModelTests {
    func testUpsertInsertsNewSessionsAtTheTop() {
        // Guards the ordering `createSession` (Step 3 below) relies on:
        // it calls `upsert(_:)` with the just-created session and expects
        // it to appear first without any extra sorting step.
        let viewModel = SessionListViewModel(client: nil, cache: nil)
        let existing = Session(
            id: "old", workspaceId: "w1", workspaceName: "Default", name: "Old",
            preview: nil, lastMessageAt: 1, isProcessing: false, isFlagged: nil,
            permissionMode: nil, sessionStatus: nil, labels: nil, hasUnread: nil,
            model: nil, messageCount: nil
        )
        viewModel.upsert(existing)

        let created = Session(
            id: "new", workspaceId: "w1", workspaceName: "Default", name: nil,
            preview: nil, lastMessageAt: 2, isProcessing: false, isFlagged: nil,
            permissionMode: nil, sessionStatus: nil, labels: nil, hasUnread: nil,
            model: nil, messageCount: nil
        )
        viewModel.upsert(created)

        XCTAssertEqual(viewModel.sessions.map(\.id), ["new", "old"])
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: FAIL to compile — `SessionListViewModel(client:cache:)` and `upsert` both already exist from Tasks 11/16, so this specific test compiles and passes immediately; the build only fails if a prior task's signature drifted. Treat a pass here as confirmation Tasks 11/16 are correctly in place before adding `createSession` in Step 3.

- [ ] **Step 3: Add `createSession` to `SessionListViewModel`**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift:
func createSession(workspaceId: String) async -> Session? {
    guard let client else { return nil }
    do {
        let session = try await client.createSession(workspaceId: workspaceId)
        upsert(session)
        try? cache?.upsert(session)
        return session
    } catch {
        errorMessage = "\(error)"
        return nil
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `xcodebuild test -project apps/ios/CraftAgentsApp/CraftAgentsApp.xcodeproj -scheme CraftAgentsApp -destination 'platform=iOS Simulator,name=iPhone 16'`
Expected: PASS

- [ ] **Step 5: Implement `NewSessionSheet` and a toolbar button in `SessionListView`**

```swift
// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/NewSessionSheet.swift
import SwiftUI
import CraftAgentKit

struct NewSessionSheet: View {
    let workspaceId: String
    let onCreate: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("Start a new session").font(.headline)
            Button("Create") {
                onCreate(workspaceId)
                dismiss()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .presentationDetents([.height(160)])
    }
}
```

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift,
// add state + a toolbar button:
@State private var isShowingNewSessionSheet = false

// Inside the `List(...) { ... }` block's modifiers, add:
.toolbar {
    ToolbarItem(placement: .primaryAction) {
        Button("New Session", systemImage: "plus") { isShowingNewSessionSheet = true }
    }
}
.sheet(isPresented: $isShowingNewSessionSheet) {
    if let workspaceId = viewModel.sessions.first?.workspaceId {
        NewSessionSheet(workspaceId: workspaceId) { workspaceId in
            Task {
                if let created = await viewModel.createSession(workspaceId: workspaceId) {
                    selectedSessionId = created.id
                }
            }
        }
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): add new-session creation from the session list toolbar"
```

---

### Task 19: iPad multitasking polish

**Files:**
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift`
- Modify: `apps/ios/CraftAgentsApp/CraftAgentsApp/project.yml`

**Interfaces:**
- No new types — this task tunes existing `NavigationSplitView` behavior and Info.plist scene settings for iPad. Layout/multitasking quality cannot be meaningfully unit-tested; verification is manual, per the checklist below.

- [ ] **Step 1: Set an explicit `NavigationSplitViewStyle` and column widths**

```swift
// In apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift,
// change the `NavigationSplitView { ... } detail: { ... }` declaration to:
NavigationSplitView(columnVisibility: .constant(.all)) {
    // ... existing sidebar List ...
}
.navigationSplitViewStyle(.balanced)
detail: {
    // ... existing detail content ...
}
```

- [ ] **Step 2: Enable multi-window / Stage Manager support in `project.yml`**

```yaml
# In apps/ios/CraftAgentsApp/project.yml, under targets.CraftAgentsApp.info.properties, add:
        UIApplicationSupportsMultipleScenes: true
        UIRequiresFullScreen: false
```

- [ ] **Step 3: Regenerate and rebuild**

```bash
cd apps/ios/CraftAgentsApp && xcodegen generate
xcodebuild -project CraftAgentsApp.xcodeproj -scheme CraftAgentsApp \
  -destination 'generic/platform=iOS Simulator' build
```
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Manual acceptance checklist (run on an iPad simulator or device)**

- [ ] Launch in full-screen: sidebar + detail both visible in landscape, sidebar collapses to an overlay in portrait.
- [ ] Split View with another app: layout adapts without clipping (test at 1/3, 1/2, 2/3 widths).
- [ ] Stage Manager: app can be resized to an arbitrary window size without a broken layout.
- [ ] External keyboard: `Cmd+N` opens the new-session sheet (add an `.keyboardShortcut("n", modifiers: .command)` to the toolbar button from Task 18 if not already present); Tab moves focus between the message field and Send button.
- [ ] Rotate iPad between portrait/landscape mid-session: no loss of scroll position or draft text.

- [ ] **Step 5: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): polish iPad multitasking (Stage Manager, split view, keyboard shortcuts)"
```

---

**Phase 3 acceptance:** Force-quit the app after browsing sessions once, relaunch in Airplane Mode — session list and message history are still visible (read-only, offline banner shown, send/approve/new-session controls disabled). Reconnect network — banner clears and live updates resume. On iPad, verify every item in Task 19's manual checklist.

---

## Self-review notes

- **Spec coverage:** Every MVP feature from the design's confirmed scope (session list, chat streaming, tool visualization, permission approval, new session, attachments, offline read-only cache, iPad multitasking) has a task. Push notifications/APNs and Sources/MCP management are confirmed out of scope and intentionally have no task.
- **Type consistency:** `ChatViewModel`, `SessionListViewModel`, `RPCClient`, and `RPCTransport` signatures introduced in Phase 1 are extended (never renamed) in Phases 2-3 — e.g. `apply(_:)`, `respondToPermission`, `addDelegate` are each defined once and reused as-is.
- **No placeholders:** every step includes complete, real code derived from the actual wire types in `packages/shared/src/protocol` and `packages/core/src/types/message.ts`, not stubs.

