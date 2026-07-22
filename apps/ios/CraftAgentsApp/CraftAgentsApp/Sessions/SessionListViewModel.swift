// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift
import Foundation
import Observation
import CraftAgentKit

enum SessionListFilter: String, CaseIterable, Identifiable {
    case all
    case unread
    case running
    case flagged

    var id: Self { self }

    var title: String {
        switch self {
        case .all: "All"
        case .unread: "Unread"
        case .running: "Running"
        case .flagged: "Flagged"
        }
    }

    var systemImage: String {
        switch self {
        case .all: "tray.full"
        case .unread: "circle.fill"
        case .running: "bolt.fill"
        case .flagged: "flag.fill"
        }
    }
}

@Observable
@MainActor
final class SessionListViewModel: RPCTransportDelegate {
    private(set) var sessions: [Session] = []
    var searchText = ""
    var selectedFilter: SessionListFilter = .all
    var errorMessage: String?
    private(set) var client: RPCClient?
    private(set) var cache: SessionCacheRepository?
    private(set) var connectionState: ConnectionState
    var isOffline: Bool {
        guard client != nil else { return true }
        if case .connected = connectionState { return false }
        return true
    }
    /// Workspace-defined session categories (statuses), for the picker + labels.
    private(set) var statuses: [WorkspaceStatus] = []
    /// Workspace the app is connected to; primary source for new-session creation.
    private let connectedWorkspaceId: String?
    private var isLoading = false
    private var retryLoadWhenConnected = false
    private var loadFailureActive = false
    private var transientConnectionErrorActive = false

    var visibleSessions: [Session] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return sessions
            .filter(matchesSelectedFilter)
            .filter { session in
                guard !query.isEmpty else { return true }
                return [
                    session.name,
                    session.preview,
                    statusLabel(for: session.sessionStatus),
                    session.workspaceName,
                    session.model,
                ]
                .compactMap { $0 }
                .contains { $0.localizedCaseInsensitiveContains(query) }
            }
            .sorted { $0.lastMessageAt > $1.lastMessageAt }
    }

    init(client: RPCClient?, cache: SessionCacheRepository? = nil, workspaceId: String? = nil) {
        self.client = client
        self.cache = cache
        self.connectedWorkspaceId = workspaceId
        self.connectionState = client == nil ? .disconnected : .connected
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        guard let client else {
            sessions = (try? cache?.cachedSessions()) ?? []
            return
        }

        await client.transport.addDelegate(self)
        connectionState = await client.transport.state

        do {
            sessions = try await client.listSessions()
            for session in sessions { try? cache?.upsert(session) }
            await loadStatuses()
            retryLoadWhenConnected = false
            if loadFailureActive {
                errorMessage = nil
                loadFailureActive = false
                transientConnectionErrorActive = false
            }
        } catch {
            loadFailureActive = true
            retryLoadWhenConnected = isRecoverableConnectionError(error)
            record(error)
            if sessions.isEmpty {
                sessions = (try? cache?.cachedSessions()) ?? []
            }
        }
    }

    /// Loads the workspace's session categories (`statuses:list`).
    func loadStatuses() async {
        guard let client, let workspaceId = connectedWorkspaceId ?? sessions.first?.workspaceId else { return }
        statuses = (try? await client.listStatuses(workspaceId: workspaceId)) ?? []
    }

    /// Human-readable label for a session category id.
    func statusLabel(for id: String?) -> String? {
        guard let id else { return nil }
        return statuses.first(where: { $0.id == id })?.label ?? id
    }

    /// Changes a session's category (`sessions:command` setSessionStatus) and
    /// updates it locally.
    func setSessionStatus(sessionId: String, statusId: String) async {
        guard let client else { return }
        do {
            try await client.setSessionStatus(sessionId: sessionId, status: statusId)
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].sessionStatus = statusId
            }
        } catch {
            record(error)
        }
    }

    func upsert(_ session: Session) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.insert(session, at: 0)
        }
    }

    func remove(sessionId: String) {
        sessions.removeAll { $0.id == sessionId }
    }

    /// Workspace id for a given session (used when opening its chat detail).
    func workspaceId(for sessionId: String) -> String? {
        sessions.first(where: { $0.id == sessionId })?.workspaceId ?? connectedWorkspaceId
    }

    /// Deletes a session (`sessions:delete`) and removes it locally.
    func deleteSession(sessionId: String) async {
        guard let client else { return }
        do {
            try await client.deleteSession(sessionId: sessionId)
            remove(sessionId: sessionId)
        } catch {
            record(error)
        }
    }

    /// Renames a session (`sessions:command` rename) and updates it locally.
    func renameSession(sessionId: String, name: String) async {
        guard let client, !name.isEmpty else { return }
        do {
            try await client.renameSession(sessionId: sessionId, name: name)
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].name = name
            }
        } catch {
            record(error)
        }
    }

    /// Archives a session (`sessions:command` archive) and removes it from the
    /// active list.
    func archiveSession(sessionId: String) async {
        guard let client else { return }
        do {
            try await client.archiveSession(sessionId: sessionId)
            remove(sessionId: sessionId)
        } catch {
            record(error)
        }
    }

    func createSession(workspaceId: String) async -> Session? {
        guard let client else { return nil }
        do {
            let session = try await client.createSession(workspaceId: workspaceId)
            upsert(session)
            try? cache?.upsert(session)
            return session
        } catch {
            record(error)
            return nil
        }
    }

    func resolveWorkspaceIdForNewSession() async -> String? {
        if let connectedWorkspaceId { return connectedWorkspaceId }
        if let existing = sessions.first?.workspaceId { return existing }
        guard let client else { return nil }
        return try? await client.listWorkspaces().first?.id
    }

    /// Creates a new session for the "+" toolbar action and returns it. Resolves
    /// the workspace from the active connection (falling back to existing sessions
    /// or the server's workspace list); surfaces an error instead of silently
    /// failing when none can be found.
    func createNewSession() async -> Session? {
        guard let workspaceId = await resolveWorkspaceIdForNewSession() else {
            errorMessage = "No workspace available to create a session."
            return nil
        }
        return await createSession(workspaceId: workspaceId)
    }

    func apply(_ event: SessionEvent) {
        switch event {
        case .sessionDeleted(let sessionId):
            remove(sessionId: sessionId)
        case .nameChanged(let sessionId, let name):
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].name = name
            }
        case .sessionStatusChanged(let sessionId, let status):
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].sessionStatus = status
            }
        case .textDelta(let sessionId, _, _),
             .toolStart(let sessionId, _, _, _):
            if let index = sessions.firstIndex(where: { $0.id == sessionId }),
               !sessions[index].isProcessing {
                sessions[index].isProcessing = true
            }
        case .complete(let sessionId),
             .errorEvent(let sessionId, _):
            if let index = sessions.firstIndex(where: { $0.id == sessionId }),
               sessions[index].isProcessing {
                sessions[index].isProcessing = false
            }
        case .sessionModelChanged(let sessionId, let model):
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].model = model
            }
        case .permissionModeChanged(let sessionId, let mode):
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].permissionMode = mode
            }
        case .userMessage(let sessionId, let message, _):
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                if !message.content.isEmpty {
                    sessions[index].preview = message.content
                }
                sessions[index].lastMessageAt = message.timestamp
            }
        default:
            break
        }
    }

    nonisolated func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {
        await handleConnectionState(state)
    }

    nonisolated func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {
        guard envelope.channel == RPCChannels.Sessions.event,
              let firstArg = envelope.args?.first,
              let event = try? firstArg.decoded() as SessionEvent else { return }
        await MainActor.run { self.apply(event) }
    }

    var clientForDetail: RPCClient? { client }
    var clientCache: SessionCacheRepository? { cache }

    private func handleConnectionState(_ state: ConnectionState) async {
        connectionState = state
        if case .failed(let connectionError) = state {
            errorMessage = connectionError.message
            transientConnectionErrorActive = false
            retryLoadWhenConnected = false
            return
        }
        guard case .connected = state else { return }

        if transientConnectionErrorActive {
            errorMessage = nil
            transientConnectionErrorActive = false
        }
        guard retryLoadWhenConnected else { return }
        retryLoadWhenConnected = false
        await load()
    }

    private func record(_ error: Error) {
        errorMessage = userFacingTransportError(error)
        transientConnectionErrorActive = isRecoverableConnectionError(error)
    }

    private func matchesSelectedFilter(_ session: Session) -> Bool {
        switch selectedFilter {
        case .all:
            true
        case .unread:
            session.hasUnread == true
        case .running:
            session.isProcessing
        case .flagged:
            session.isFlagged == true
        }
    }
}
