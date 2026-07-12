// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatViewModel.swift
import Foundation
import Observation
import CraftAgentKit

@Observable
@MainActor
final class ChatViewModel: RPCTransportDelegate {
    var isOffline: Bool {
        guard client != nil else { return true }
        if case .connected = connectionState { return false }
        return true
    }
    private(set) var messages: [ChatMessage] = []
    var draftText: String = ""
    var errorMessage: String?
    var statusMessage: String?
    var pendingPermissionRequest: PermissionRequest?
    var pendingCredentialRequest: CredentialRequest?
    var pendingAttachments: [FileAttachment] = []
    private(set) var isProcessing: Bool = false
    private(set) var currentModel: String?
    var permissionMode: String?
    private(set) var files: [SessionFile] = []
    private(set) var availableConnections: [LlmConnection] = []
    private(set) var connectionState: ConnectionState

    private let client: RPCClient?
    let sessionId: String
    let workspaceId: String?
    private var streamingMessageId: String?
    private let cache: SessionCacheRepository?
    private var isLoading = false
    private var retryLoadWhenConnected = false
    private var loadFailureActive = false
    private var transientConnectionErrorActive = false

    init(
        client: RPCClient?,
        sessionId: String,
        cache: SessionCacheRepository? = nil,
        workspaceId: String? = nil
    ) {
        self.client = client
        self.sessionId = sessionId
        self.cache = cache
        self.workspaceId = workspaceId
        self.connectionState = client == nil ? .disconnected : .connected
    }

    // MARK: Notes / files / model / permission mode

    /// Loads notes.md for this session (`sessions:getNotes`).
    func loadNotes() async -> String {
        guard let client else { return "" }
        return (try? await client.getNotes(sessionId: sessionId)) ?? ""
    }

    /// Persists notes.md (`sessions:setNotes`).
    func saveNotes(_ content: String) async {
        guard let client else { return }
        do { try await client.setNotes(sessionId: sessionId, content: content) }
        catch { record(error) }
    }

    /// Loads the session file tree (`sessions:getFiles`).
    func loadFiles() async {
        guard let client else { return }
        files = (try? await client.getFiles(sessionId: sessionId)) ?? []
    }

    /// Switches the session's model (`session:setModel`).
    func setModel(_ model: String?, connection: String? = nil) async {
        guard let client, let workspaceId else { return }
        do {
            try await client.setModel(sessionId: sessionId, workspaceId: workspaceId, model: model, connection: connection)
            currentModel = model
        } catch { record(error) }
    }

    /// Loads available model connections for the model picker
    /// (`LLM_Connection:list`).
    func loadConnections() async {
        guard let client else { return }
        availableConnections = (try? await client.listLlmConnections()) ?? []
    }

    /// Switches the session's permission mode (`sessions:command` setPermissionMode).
    func setPermissionMode(_ mode: PermissionMode) async {
        guard let client else { return }
        do {
            try await client.setSessionPermissionMode(sessionId: sessionId, mode: mode)
            permissionMode = mode.rawValue
        } catch { record(error) }
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        guard let client else {
            messages = (try? cache?.cachedMessages(sessionId: sessionId)) ?? []
            return
        }

        await client.transport.addDelegate(self)
        connectionState = await client.transport.state

        do {
            messages = try await client.getMessages(sessionId: sessionId)
            for message in messages { try? cache?.upsert(message, sessionId: sessionId) }
            if let workspaceId {
                currentModel = try? await client.getModel(sessionId: sessionId, workspaceId: workspaceId)
            }
            permissionMode = (try? await client.getPermissionModeState(sessionId: sessionId))?.permissionMode
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
            if messages.isEmpty {
                messages = (try? cache?.cachedMessages(sessionId: sessionId)) ?? []
            }
        }
    }

    func send() async {
        guard let client, !draftText.isEmpty || !pendingAttachments.isEmpty else { return }
        let text = draftText
        let attachments = pendingAttachments
        draftText = ""
        pendingAttachments = []
        isProcessing = true
        do {
            let messageId = try await client.sendMessage(sessionId: sessionId, text: text, attachments: attachments)
            // Optimistically show the sent message (with its images) immediately,
            // keyed by the server's message id so the echoed `user_message`
            // event dedupes against it instead of duplicating.
            let id = messageId ?? UUID().uuidString
            if !messages.contains(where: { $0.id == id }) {
                messages.append(ChatMessage(
                    id: id,
                    role: .user,
                    content: text,
                    timestamp: Date().timeIntervalSince1970 * 1000,
                    attachments: attachments.isEmpty ? nil : attachments.map { $0.asStoredAttachment() }
                ))
            }
        } catch {
            restoreDraft(text: text, attachments: attachments)
            record(error)
            isProcessing = false
        }
    }

    /// Stops the in-flight generation for this session (`sessions:cancel`).
    func stop() async {
        guard let client else { return }
        do {
            try await client.cancelProcessing(sessionId: sessionId)
        } catch {
            record(error)
        }
        isProcessing = false
    }

    /// Replies to a pending credential request (`sessions:respondToCredential`).
    func respondToCredential(_ response: CredentialResponse) async {
        guard let client, let request = pendingCredentialRequest else { return }
        do {
            try await client.respondToCredential(sessionId: sessionId, requestId: request.requestId, response: response)
            pendingCredentialRequest = nil
        } catch {
            record(error)
        }
    }

    /// Applies one `SessionEvent` to local chat state. Pulled out of the
    /// delegate callback so it is directly unit-testable without a transport.
    func apply(_ event: SessionEvent) {
        switch event {
        case .textDelta(let eventSessionId, let delta, _):
            guard eventSessionId == sessionId else { return }
            isProcessing = true
            appendStreamingDelta(delta)
        case .textComplete(let eventSessionId, let text):
            guard eventSessionId == sessionId else { return }
            finalizeStreamingMessage(text: text)
        case .complete(let eventSessionId):
            guard eventSessionId == sessionId else { return }
            isProcessing = false
            statusMessage = nil
        case .status(let eventSessionId, let message):
            guard eventSessionId == sessionId else { return }
            statusMessage = message
        case .errorEvent(let eventSessionId, let error):
            guard eventSessionId == sessionId else { return }
            errorMessage = error
            isProcessing = false
        case .toolStart(let eventSessionId, let toolName, let toolUseId, let toolInput):
            guard eventSessionId == sessionId else { return }
            isProcessing = true
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
        case .credentialRequest(let eventSessionId, let request):
            guard eventSessionId == sessionId else { return }
            pendingCredentialRequest = request
        case .sessionModelChanged(let eventSessionId, let model):
            guard eventSessionId == sessionId else { return }
            currentModel = model
        case .permissionModeChanged(let eventSessionId, let mode):
            guard eventSessionId == sessionId else { return }
            permissionMode = mode
        case .userMessage(let eventSessionId, let message, _):
            guard eventSessionId == sessionId else { return }
            // The server echoes the user's own message back as a `user_message`
            // event; append it (deduped by id) so the sender sees their message
            // immediately instead of only the assistant's reply.
            if !messages.contains(where: { $0.id == message.id }) {
                messages.append(message)
            }
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

    nonisolated func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {
        await handleConnectionState(state)
    }

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
            record(error)
        }
    }

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

    private func restoreDraft(text: String, attachments: [FileAttachment]) {
        if draftText.isEmpty {
            draftText = text
        } else if !text.isEmpty {
            draftText = "\(text)\n\(draftText)"
        }
        pendingAttachments = attachments + pendingAttachments
    }
}
