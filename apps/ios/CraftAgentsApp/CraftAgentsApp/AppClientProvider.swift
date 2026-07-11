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
    /// The workspace the active connection was established against. Used as the
    /// primary source when creating a new session so the "+" action never has to
    /// guess (fixes "No workspace available").
    private(set) var workspaceId: String?
    /// All workspaces available on the connected server (for the switcher).
    private(set) var workspaces: [Workspace] = []
    private(set) var lastError: String?
    private let store: ServerConnectionStore
    /// The connection currently in use, retained so we can reconnect with a
    /// different workspace id.
    private var connection: ServerConnection?

    init(store: ServerConnectionStore) {
        self.store = store
    }

    func connectToSavedServer() async {
        guard let connection = try? await store.mostRecent() else { return }
        self.connection = connection
        await connect(using: connection)
    }

    /// Switches the active workspace by reconnecting the transport with the new
    /// workspace id (the server scopes sessions to the handshake workspace) and
    /// persisting the choice on the saved connection.
    func switchWorkspace(to id: String) async {
        guard let existing = connection, existing.workspaceId != id else { return }
        await client?.disconnect()
        client = nil
        let updated = ServerConnection(
            id: existing.id, name: existing.name, url: existing.url,
            token: existing.token, workspaceId: id
        )
        connection = updated
        try? await store.save(updated) // dedups by id — replaces in place
        await connect(using: updated)
    }

    private func connect(using connection: ServerConnection) async {
        connectionState = .connecting
        lastError = nil
        workspaceId = connection.workspaceId
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
            workspaces = (try? await client.listWorkspaces()) ?? []
        } catch {
            self.client = nil
            lastError = "\(error)"
            connectionState = .failed(ConnectionError(kind: .network, message: "\(error)"))
        }
    }
}
