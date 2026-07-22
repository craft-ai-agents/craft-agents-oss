import Foundation

/// Read-only view of a workspace source, as returned by `sources:get`
/// (`LoadedSource` in `packages/shared/src/sources/types.ts`). Only the
/// `config` fields relevant to a mobile client are decoded; other keys
/// (guide, folderPath, …) are ignored.
public struct Source: Codable, Equatable, Identifiable, Sendable {
    public struct Config: Codable, Equatable, Sendable {
        public let id: String
        public let name: String
        public let slug: String
        public let enabled: Bool
        /// Source type: "mcp" | "api" | "local".
        public let type: String
        public let isAuthenticated: Bool?
        public let icon: String?

        public init(
            id: String,
            name: String,
            slug: String,
            enabled: Bool,
            type: String,
            isAuthenticated: Bool? = nil,
            icon: String? = nil
        ) {
            self.id = id
            self.name = name
            self.slug = slug
            self.enabled = enabled
            self.type = type
            self.isAuthenticated = isAuthenticated
            self.icon = icon
        }
    }

    public let config: Config

    public var id: String { config.slug }
    public var name: String { config.name }
    public var type: String { config.type }

    public init(config: Config) {
        self.config = config
    }
}
