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
