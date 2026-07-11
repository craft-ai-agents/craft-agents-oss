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
