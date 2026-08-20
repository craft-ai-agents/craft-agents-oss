import Foundation

/// Payload for `sessions:respondToCredential` — mirrors `CredentialResponse` in
/// `packages/shared/src/protocol/dto.ts`.
public struct CredentialResponse: Codable, Equatable, Sendable {
    public let type: String
    public let value: String?
    public let username: String?
    public let password: String?
    public let headers: [String: String]?
    public let cancelled: Bool

    public init(
        value: String? = nil,
        username: String? = nil,
        password: String? = nil,
        headers: [String: String]? = nil,
        cancelled: Bool = false
    ) {
        self.type = "credential"
        self.value = value
        self.username = username
        self.password = password
        self.headers = headers
        self.cancelled = cancelled
    }
}
