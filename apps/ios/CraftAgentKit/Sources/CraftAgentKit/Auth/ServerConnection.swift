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
