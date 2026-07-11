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

public actor ServerConnectionStore {
    private let keychain: KeychainStoring
    private static let storageKey = "server-connections"

    public init(keychain: KeychainStoring) {
        self.keychain = keychain
    }

    public func list() async throws -> [ServerConnection] {
        guard let data = try await keychain.load(forKey: Self.storageKey) else { return [] }
        return try JSONDecoder().decode([ServerConnection].self, from: data)
    }

    public func save(_ connection: ServerConnection) async throws {
        var all = try await list()
        // Remove any prior entry for the same server URL (or same id) so that
        // re-logging in updates the connection in place instead of appending a
        // stale duplicate. Combined with callers reading the *last* entry, this
        // guarantees the most recently saved connection is the one used and no
        // dead-token duplicates accumulate.
        all.removeAll { $0.id == connection.id || $0.url == connection.url }
        all.append(connection)
        try await keychain.save(try JSONEncoder().encode(all), forKey: Self.storageKey)
    }

    /// The most recently saved connection (the one a fresh login should use).
    public func mostRecent() async throws -> ServerConnection? {
        try await list().last
    }

    public func delete(id: UUID) async throws {
        var all = try await list()
        all.removeAll { $0.id == id }
        try await keychain.save(try JSONEncoder().encode(all), forKey: Self.storageKey)
    }
}
