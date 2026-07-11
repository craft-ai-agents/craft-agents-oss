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
    var pendingPermissionRequest: PermissionRequest?
    var pendingAttachments: [FileAttachment] = []

    private let client: RPCClient?
    let sessionId: String
    private var streamingMessageId: String?
    private let cache: SessionCacheRepository?

    init(client: RPCClient?, sessionId: String, cache: SessionCacheRepository? = nil) {
        self.client = client
        self.sessionId = sessionId
        self.cache = cache
    }

    func load() async {
        guard let client else {
            messages = (try? cache?.cachedMessages(sessionId: sessionId)) ?? []
            return
        }
        do {
            messages = try await client.getMessages(sessionId: sessionId)
            for message in messages { try? cache?.upsert(message, sessionId: sessionId) }
            await client.transport.addDelegate(self)
        } catch {
            errorMessage = "\(error)"
            messages = (try? cache?.cachedMessages(sessionId: sessionId)) ?? []
        }
    }

    func send() async {
        guard let client, !draftText.isEmpty || !pendingAttachments.isEmpty else { return }
        let text = draftText
        let attachments = pendingAttachments
        draftText = ""
        pendingAttachments = []
        do {
            try await client.sendMessage(sessionId: sessionId, text: text, attachments: attachments)
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
        case .toolStart(let eventSessionId, let toolName, let toolUseId, let toolInput):
            guard eventSessionId == sessionId else { return }
            messages.append(ChatMessage(
                id: toolUseId, role: .tool, content: "",
                timestamp: Date().timeIntervalSince1970 * 1000,
                toolName: toolName, toolUseId: toolUseId, toolInput: toolInput,
                toolStatus: "running"
            ))
        case .toolResult(let eventSessionId, let toolUseId, _, let result, let isError):
            guard eventSessionId == sessionId else { return }
            guard let index = messages.firstIndex(where: { $0.toolUseId == toolUseId }) else { return }
            messages[index].toolResult = result
            messages[index].toolStatus = (isError ?? false) ? "error" : "success"
        case .permissionRequest(let eventSessionId, let request):
            guard eventSessionId == sessionId else { return }
            pendingPermissionRequest = request
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

    func respond(allowed: Bool, alwaysAllow: Bool) async {
        guard let client, let request = pendingPermissionRequest else { return }
        do {
            try await client.respondToPermission(
                sessionId: sessionId, requestId: request.requestId,
                allowed: allowed, alwaysAllow: alwaysAllow
            )
            pendingPermissionRequest = nil
        } catch {
            errorMessage = "\(error)"
        }
    }
}
