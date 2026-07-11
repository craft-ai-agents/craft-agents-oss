// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListViewModel.swift
import Foundation
import Observation
import CraftAgentKit

@Observable
@MainActor
final class SessionListViewModel: RPCTransportDelegate {
    private(set) var sessions: [Session] = []
    var errorMessage: String?
    private let client: RPCClient?

    init(client: RPCClient?) {
        self.client = client
    }

    func load() async {
        guard let client else { return }
        do {
            sessions = try await client.listSessions()
            await client.transport.setDelegate(self)
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
}
