What I implemented
- Implemented ProtocolCodec with serialize/deserialize and envelope-shape validation per brief.
- Added unit tests ProtocolCodecTests.swift matching the brief's five cases.

Verification steps skipped and why
- Swift toolchain tests (swift test) were skipped because this environment is Linux without Swift/Xcode toolchain.

Files changed
- apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolCodec.swift (new)
- apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/ProtocolCodecTests.swift (new)
- apps/ios/CraftAgentKit/.protocolcodec-added (marker file to record commit)

Self-review findings
- validate(_:) enforces:
  - id must be non-empty
  - handshake_ack requires non-empty clientId
  - request/event require channel
  - error requires an error payload
  These match the four rules from the brief.
- Tests mirror the five cases in the brief. Behavior should match expected throws and decoding.

Concerns
- I could not run swift test here to verify runtime behavior. The implementation follows the brief exactly; local verification with Xcode/Swift is required to confirm.
