// apps/ios/CraftAgentsApp/CraftAgentsApp/Onboarding/ServerConnectionViewModel.swift
import Foundation
import Observation
import CraftAgentKit

@Observable
@MainActor
final class ServerConnectionViewModel {
    var serverURLText: String = ""
    var token: String = ""
    var connectionState: ConnectionState = .idle
    var workspaces: [Workspace] = []
    var errorMessage: String?

    private let store: ServerConnectionStore
    private var pendingClient: RPCClient?

    init(store: ServerConnectionStore) {
        self.store = store
    }

    func testConnectionAndFetchWorkspaces() async {
        guard let url = URL(string: serverURLText) else {
            errorMessage = "Enter a valid server URL, e.g. wss://myserver.example.com:9100"
            return
        }
        errorMessage = nil
        connectionState = .connecting
        let transport = RPCTransport()
        let client = RPCClient(transport: transport)
        do {
            try await client.connect(serverURL: url, token: token, workspaceId: nil)
            workspaces = try await client.listWorkspaces()
            pendingClient = client
            connectionState = .connected
        } catch {
            connectionState = .failed(ConnectionError(kind: .unknown, message: "\(error)"))
            errorMessage = "Could not connect: \(error)"
        }
    }

    func saveAndConnect(workspaceId: String) async throws {
        guard let url = URL(string: serverURLText) else { return }
        let connection = ServerConnection(name: url.host ?? "Server", url: url, token: token, workspaceId: workspaceId)
        try await store.save(connection)
        await pendingClient?.disconnect()
    }
}
