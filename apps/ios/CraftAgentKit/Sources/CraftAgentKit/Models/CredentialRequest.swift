import Foundation

/// Mirrors the display-relevant fields of `CredentialAuthRequest`
/// (`packages/session-tools-core/src/types.ts`), delivered via a
/// `credential_request` session event. The client replies with a
/// `CredentialResponse` through `sessions:respondToCredential`.
public struct CredentialRequest: Codable, Equatable, Identifiable, Sendable {
    public let requestId: String
    public let sourceSlug: String?
    public let sourceName: String?
    /// Input mode, e.g. "api_key", "bearer", "basic".
    public let mode: String?
    public let description: String?
    public let hint: String?
    public let passwordRequired: Bool?

    public var id: String { requestId }

    /// Basic auth needs a username + password; other modes take a single value.
    public var isBasicAuth: Bool { mode == "basic" }

    public init(
        requestId: String,
        sourceSlug: String? = nil,
        sourceName: String? = nil,
        mode: String? = nil,
        description: String? = nil,
        hint: String? = nil,
        passwordRequired: Bool? = nil
    ) {
        self.requestId = requestId
        self.sourceSlug = sourceSlug
        self.sourceName = sourceName
        self.mode = mode
        self.description = description
        self.hint = hint
        self.passwordRequired = passwordRequired
    }
}
