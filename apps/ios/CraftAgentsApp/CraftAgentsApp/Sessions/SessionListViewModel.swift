// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift
import Foundation
import Observation
import CraftAgentKit

@Observable
@MainActor
final class SessionListViewModel: RPCTransportDelegate {
    private(set) var sessions: [Session] = []
    var errorMessage: String?
    private(set) var client: RPCClient?
    private(set) var cache: SessionCacheRepository?
    /// Workspace-defined session categories (statuses), for the picker + labels.
    private(set) var statuses: [WorkspaceStatus] = []
    /// Workspace the app is connected to; primary source for new-session creation.
    private let connectedWorkspaceId: String?

    init(client: RPCClient?, cache: SessionCacheRepository? = nil, workspaceId: String? = nil) {
        self.client = client
        self.cache = cache
        self.connectedWorkspaceId = workspaceId
    }

    func load() async {
        guard let client else {
            sessions = (try? cache?.cachedSessions()) ?? []
            return
        }
        do {
            sessions = try await client.listSessions()
            for session in sessions { try? cache?.upsert(session) }
            await client.transport.addDelegate(self)
            await loadStatuses()
        } catch {
            errorMessage = "\(error)"
            sessions = (try? cache?.cachedSessions()) ?? []
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
            errorMessage = "\(error)"
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
            errorMessage = "\(error)"
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
            errorMessage = "\(error)"
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
            errorMessage = "\(error)"
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
            errorMessage = "\(error)"
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

    nonisolated func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {}

    nonisolated func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {
        guard envelope.channel == RPCChannels.Sessions.event,
              let firstArg = envelope.args?.first,
              let event = try? firstArg.decoded() as SessionEvent else { return }
        await MainActor.run {
            switch event {
            case .sessionDeleted(let sessionId):
                self.remove(sessionId: sessionId)
            case .nameChanged(let sessionId, let name):
                if let index = self.sessions.firstIndex(where: { $0.id == sessionId }) {
                    self.sessions[index].name = name
                }
            case .sessionStatusChanged(let sessionId, let status):
                if let index = self.sessions.firstIndex(where: { $0.id == sessionId }) {
                    self.sessions[index].sessionStatus = status
                }
            default:
                break
            }
        }
    }

    var clientForDetail: RPCClient? { client }
    var clientCache: SessionCacheRepository? { cache }
}
