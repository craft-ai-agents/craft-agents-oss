// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift
import Foundation
import Observation
import CraftAgentKit

@Observable
@MainActor
final class ChatViewModel: RPCTransportDelegate {
    private(set) var messages: [ChatMessage] = []
    var draftText: String = ""
    var errorMessage: String?

    private let client: RPCClient?
    let sessionId: String
    private var streamingMessageId: String?

    init(client: RPCClient?, sessionId: String) {
        self.client = client
        self.sessionId = sessionId
    }

    func load() async {
        guard let client else { return }
        do {
            messages = try await client.getMessages(sessionId: sessionId)
            await client.transport.addDelegate(self)
        } catch {
            errorMessage = "\(error)"
        }
    }

    func send() async {
        guard let client, !draftText.isEmpty else { return }
        let text = draftText
        draftText = ""
        do {
            try await client.sendMessage(sessionId: sessionId, text: text)
        } catch {
            errorMessage = "\(error)"
        }
    }

    /// Applies one `SessionEvent` to local chat state. Pulled out of the
    /// delegate callback so it is directly unit-testable without a transport.
    func apply(_ event: SessionEvent) {
        switch event {
        case .textDelta(let eventSessionId, let delta, _):
            guard eventSessionId == sessionId else { return }
            appendStreamingDelta(delta)
        case .textComplete(let eventSessionId, let text):
            guard eventSessionId == sessionId else { return }
            finalizeStreamingMessage(text: text)
        case .errorEvent(let eventSessionId, let error):
            guard eventSessionId == sessionId else { return }
            errorMessage = error
        default:
            break
        }
    }

    private func appendStreamingDelta(_ delta: String) {
        if let streamingMessageId, let index = messages.firstIndex(where: { $0.id == streamingMessageId }) {
            messages[index].content += delta
        } else {
            let id = UUID().uuidString
            streamingMessageId = id
            messages.append(ChatMessage(
                id: id, role: .assistant, content: delta, timestamp: Date().timeIntervalSince1970 * 1000,
                isStreaming: true
            ))
        }
    }

    private func finalizeStreamingMessage(text: String) {
        guard let streamingMessageId, let index = messages.firstIndex(where: { $0.id == streamingMessageId }) else {
            messages.append(ChatMessage(
                id: UUID().uuidString, role: .assistant, content: text,
                timestamp: Date().timeIntervalSince1970 * 1000, isStreaming: false
            ))
            return
        }
        messages[index].content = text
        messages[index].isStreaming = false
        self.streamingMessageId = nil
    }

    nonisolated func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {}

    nonisolated func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {
        guard envelope.channel == RPCChannels.Sessions.event,
              let firstArg = envelope.args?.first,
              let event = try? firstArg.decoded() as SessionEvent else { return }
        await MainActor.run { self.apply(event) }
    }
}
