import Foundation

/// Read-only view of an LLM connection, as returned by `LLM_Connection:list`
/// (`LlmConnection` in `packages/shared/src/config/llm-connections.ts`). Only
/// the identity/display fields a mobile client needs are decoded.
public struct LlmConnection: Codable, Equatable, Identifiable, Sendable {
    public let slug: String
    public let name: String
    public let providerType: String
    public let authType: String
    public let defaultModel: String?

    public var id: String { slug }

    public init(
        slug: String,
        name: String,
        providerType: String,
        authType: String,
        defaultModel: String? = nil
    ) {
        self.slug = slug
        self.name = name
        self.providerType = providerType
        self.authType = authType
        self.defaultModel = defaultModel
    }
}
