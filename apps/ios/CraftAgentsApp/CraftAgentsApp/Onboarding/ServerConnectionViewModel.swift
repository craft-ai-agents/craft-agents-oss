// apps/ios/CraftAgentsApp/CraftAgentsApp/Onboarding/ServerConnectionViewModel.swift
import Foundation
import Observation
import CraftAgentKit

enum ServerConnectionSetupError: LocalizedError {
    case invalidServerURL
    case connectionNotTested

    var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            "Enter a valid ws:// or wss:// server address."
        case .connectionNotTested:
            "Test the connection before choosing a workspace."
        }
    }
}

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
    private var testedServerURL: URL?
    private var testedToken: String?

    var isConnecting: Bool {
        if case .connecting = connectionState { return true }
        return false
    }

    var canConnect: Bool {
        validatedServerURL != nil
            && !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isConnecting
            && !hasVerifiedConnection
    }

    var hasVerifiedConnection: Bool {
        pendingClient != nil
            && testedServerURL == validatedServerURL
            && testedToken == token
    }

    var validatedServerURL: URL? {
        let trimmed = serverURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let candidate = trimmed.contains("://") ? trimmed : "wss://\(trimmed)"
        guard let components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(),
              scheme == "ws" || scheme == "wss",
              components.host?.isEmpty == false else {
            return nil
        }
        return components.url
    }

    init(store: ServerConnectionStore) {
        self.store = store
    }

    func testConnectionAndFetchWorkspaces() async {
        guard let url = validatedServerURL else {
            errorMessage = ServerConnectionSetupError.invalidServerURL.localizedDescription
            return
        }
        let tokenToTest = token
        await pendingClient?.disconnect()
        pendingClient = nil
        testedServerURL = nil
        testedToken = nil
        workspaces = []
        errorMessage = nil
        connectionState = .connecting
        let transport = RPCTransport()
        let client = RPCClient(transport: transport)
        do {
            try await client.connect(serverURL: url, token: tokenToTest, workspaceId: nil)
            workspaces = try await client.listWorkspaces()
            pendingClient = client
            testedServerURL = url
            testedToken = tokenToTest
            connectionState = .connected
        } catch {
            connectionState = .failed(ConnectionError(kind: .unknown, message: "\(error)"))
            errorMessage = "Could not connect: \(error)"
        }
    }

    func saveAndConnect(workspaceId: String) async throws {
        guard let url = validatedServerURL else {
            throw ServerConnectionSetupError.invalidServerURL
        }
        guard hasVerifiedConnection else {
            throw ServerConnectionSetupError.connectionNotTested
        }
        let connection = ServerConnection(name: url.host ?? "Server", url: url, token: token, workspaceId: workspaceId)
        try await store.save(connection)
        await pendingClient?.disconnect()
    }
}
