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

    func testResavingSameURLReplacesStaleEntryAndStaysMostRecent() async throws {
        let store = ServerConnectionStore(keychain: InMemoryKeychainStore())
        let url = URL(string: "wss://home.example.com:9100")!

        // First login (server issues a token).
        try await store.save(ServerConnection(name: "Home", url: url, token: "old-token", workspaceId: "w1"))
        // Second login to the SAME server after a restart (new token). This must
        // replace the stale entry, not append a duplicate — otherwise the app
        // would reconnect with the dead token and show offline.
        try await store.save(ServerConnection(name: "Home", url: url, token: "new-token", workspaceId: "w1"))

        let all = try await store.list()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all.first?.token, "new-token")

        let recent = try await store.mostRecent()
        XCTAssertEqual(recent?.token, "new-token")
    }

    func testMostRecentReturnsLastSavedAcrossDifferentServers() async throws {
        let store = ServerConnectionStore(keychain: InMemoryKeychainStore())
        try await store.save(ServerConnection(name: "A", url: URL(string: "wss://a.example.com:9100")!, token: "ta"))
        try await store.save(ServerConnection(name: "B", url: URL(string: "wss://b.example.com:9100")!, token: "tb"))

        let recent = try await store.mostRecent()
        XCTAssertEqual(recent?.token, "tb")
        let count = try await store.list().count
        XCTAssertEqual(count, 2)
    }
}
