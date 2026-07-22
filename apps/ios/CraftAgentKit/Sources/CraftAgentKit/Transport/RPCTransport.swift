// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/RPCTransport.swift
import Foundation

/// WebSocket-based RPC transport. Owns connection lifecycle, handshake,
/// heartbeat, request/response correlation, and reconnect-with-replay —
/// the Swift-side counterpart to `packages/server-core/src/transport/client.ts`.
public actor RPCTransport: NSObject {
    private struct PendingRequest {
        let continuation: CheckedContinuation<JSONValue, Error>
    }

    public enum TransportError: Error, Equatable, LocalizedError {
        case notConnected
        case connectionTimedOut
        case requestTimedOut
        case messageTooLarge
        case remote(WireError)
        case invalidResponse

        public var errorDescription: String? {
            switch self {
            case .notConnected:
                "The server connection is unavailable. Reconnecting..."
            case .connectionTimedOut:
                "Could not reconnect to the server in time."
            case .requestTimedOut:
                "The server took too long to respond."
            case .messageTooLarge:
                "This session is too large to load on this device."
            case .remote(let error):
                error.message
            case .invalidResponse:
                "The server returned an invalid response."
            }
        }

        public var isConnectionUnavailable: Bool {
            switch self {
            case .notConnected, .connectionTimedOut, .requestTimedOut:
                true
            case .remote(let error):
                error.code == .clientDisconnected
                    || error.code == .clientRequestTimeout
                    || error.code == .requestTimeout
            case .messageTooLarge, .invalidResponse:
                false
            }
        }
    }

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var serverURL: URL?
    private var token: String?
    private var workspaceId: String?
    private var clientId: String?
    private var lastSeenSeq: Int = 0
    private var reconnectAttempt = 0
    private var pending: [String: PendingRequest] = [:]
    private var heartbeatTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var missedPongs = 0
    private var isExplicitlyDisconnected = false

    public private(set) var state: ConnectionState = .idle
    
    private final class WeakDelegateBox {
        weak var delegate: RPCTransportDelegate?
        init(_ delegate: RPCTransportDelegate) { self.delegate = delegate }
    }
    
    private var delegateBoxes: [ObjectIdentifier: WeakDelegateBox] = [:]
    private var delegateNotificationTasks: [ObjectIdentifier: Task<Void, Never>] = [:]

    public override init() {
        super.init()
        self.session = URLSession(configuration: .default)
    }

    public func addDelegate(_ delegate: RPCTransportDelegate) {
        delegateBoxes[ObjectIdentifier(delegate)] = WeakDelegateBox(delegate)
    }

    public func removeDelegate(_ delegate: RPCTransportDelegate) {
        let id = ObjectIdentifier(delegate)
        delegateBoxes.removeValue(forKey: id)
        delegateNotificationTasks.removeValue(forKey: id)?.cancel()
    }

    /// Notifies all registered delegates concurrently in unordered fire-and-forget Tasks.
    /// Automatically prunes any boxes whose delegate has been deallocated.
    private func notifyDelegates(_ body: @escaping @Sendable (RPCTransportDelegate) async -> Void) {
        // Prune boxes whose delegate has already been deallocated.
        delegateBoxes = delegateBoxes.filter { $0.value.delegate != nil }
        delegateNotificationTasks = delegateNotificationTasks.filter { delegateBoxes[$0.key] != nil }

        for (id, box) in delegateBoxes {
            guard let delegate = box.delegate else { continue }
            let previous = delegateNotificationTasks[id]
            delegateNotificationTasks[id] = Task {
                await previous?.value
                guard !Task.isCancelled else { return }
                await body(delegate)
            }
        }
    }

    /// Test-only hook so `RPCTransportMultiDelegateTests` can exercise
    /// `notifyDelegates` without a live socket.
    func dispatchForTesting(_ envelope: MessageEnvelope) async {
        await handle(envelope)
    }

    func updateStateForTesting(_ state: ConnectionState) {
        updateState(state)
    }

    /// Opens the WebSocket, performs the handshake, and returns once the
    /// server has acknowledged (`handshake_ack`). Throws on auth failure,
    /// protocol mismatch, or timeout.
    public func connect(serverURL: URL, token: String, workspaceId: String?) async throws {
        reconnectTask?.cancel()
        reconnectTask = nil
        self.serverURL = serverURL
        self.token = token
        self.workspaceId = workspaceId
        reconnectAttempt = 0
        isExplicitlyDisconnected = false
        do {
            try await openSocketAndHandshake()
        } catch {
            if task == nil, !isExplicitlyDisconnected {
                updateState(.failed(Self.connectionError(from: error)))
            }
            throw error
        }
    }

    public func disconnect() {
        isExplicitlyDisconnected = true
        heartbeatTask?.cancel()
        receiveTask?.cancel()
        reconnectTask?.cancel()
        reconnectTask = nil
        let activeTask = task
        task = nil
        activeTask?.cancel(with: .goingAway, reason: nil)
        failAllPending(error: TransportError.notConnected)
        updateState(.disconnected)
    }

    /// Sends a request envelope and awaits the correlated response/error.
    public func request(channel: String, args: [JSONValue] = []) async throws -> JSONValue {
        let deadline = Date().addingTimeInterval(
            TimeInterval(ProtocolConstants.requestTimeoutMs) / 1_000
        )
        try await ensureConnected(until: deadline)
        guard let task else { throw TransportError.notConnected }
        let id = UUID().uuidString
        let envelope = MessageEnvelope(id: id, type: .request, channel: channel, args: args)
        let wire = try ProtocolCodec.serialize(envelope)
        let remainingSeconds = deadline.timeIntervalSinceNow
        guard remainingSeconds > 0 else { throw TransportError.connectionTimedOut }
        let timeoutNanoseconds = UInt64(remainingSeconds * 1_000_000_000)

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = PendingRequest(continuation: continuation)
            Task {
                do {
                    try await task.send(.string(wire))
                } catch {
                    self.failPending(id: id, error: TransportError.notConnected)
                    self.handleSocketFailure(error, failedTask: task)
                }
            }
            Task {
                try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                self.timeoutPending(id: id)
            }
        }
    }

    // MARK: - Handshake

    private func openSocketAndHandshake() async throws {
        guard let serverURL, let token else { throw TransportError.notConnected }
        updateState(reconnectAttempt > 0 ? .reconnecting(attempt: reconnectAttempt) : .connecting)

        let newTask = session.webSocketTask(with: serverURL)
        Self.configureWebSocketTask(newTask)
        newTask.resume()
        self.task = newTask

        let handshakeId = UUID().uuidString
        var handshake = MessageEnvelope(id: handshakeId, type: .handshake)
        handshake.protocolVersion = ProtocolConstants.protocolVersion
        handshake.workspaceId = workspaceId
        handshake.token = token
        handshake.clientCapabilities = []
        if let clientId, lastSeenSeq > 0 {
            handshake.reconnectClientId = clientId
            handshake.lastSeq = lastSeenSeq
        }

        do {
            let wire = try ProtocolCodec.serialize(handshake)
            try await newTask.send(.string(wire))

            let ackEnvelope = try await receiveHandshakeAck(on: newTask, expectedId: handshakeId)
            guard let activeTask = task, activeTask === newTask else {
                throw TransportError.notConnected
            }
            self.clientId = ackEnvelope.clientId
            reconnectAttempt = 0
            updateState(.connected)

            startReceiveLoop(on: newTask)
            startHeartbeat(on: newTask)
        } catch {
            if let activeTask = task, activeTask === newTask {
                task = nil
            }
            newTask.cancel(with: .goingAway, reason: nil)
            throw error
        }
    }

    private func receiveHandshakeAck(on task: URLSessionWebSocketTask, expectedId: String) async throws -> MessageEnvelope {
        while true {
            let message = try await task.receive()
            guard case .string(let text) = message else { continue }
            let envelope = try ProtocolCodec.deserialize(text)
            if envelope.type == .error, envelope.id == expectedId {
                throw envelope.error.map(TransportError.remote) ?? TransportError.invalidResponse
            }
            if envelope.type == .handshakeAck, envelope.id == expectedId {
                return envelope
            }
            // Ignore anything else while waiting for the ack (there should be nothing else yet).
        }
    }

    // MARK: - Receive loop

    private func startReceiveLoop(on task: URLSessionWebSocketTask) {
        receiveTask?.cancel()
        receiveTask = Task {
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    guard case .string(let text) = message else { continue }
                    let envelope = try ProtocolCodec.deserialize(text)
                    await self.handle(envelope)
                } catch {
                    self.handleSocketFailure(error, failedTask: task)
                    break
                }
            }
        }
    }

    private func handle(_ envelope: MessageEnvelope) async {
        switch envelope.type {
        case .response:
            if let result = envelope.result {
                resolvePending(id: envelope.id, result: result)
            } else {
                resolvePending(id: envelope.id, result: .null)
            }
        case .error:
            if let wireError = envelope.error {
                failPending(id: envelope.id, error: TransportError.remote(wireError))
            }
        case .event:
            if let seq = envelope.seq {
                lastSeenSeq = max(lastSeenSeq, seq)
            }
            notifyDelegates { await $0.transport(self, didReceiveEvent: envelope) }
        default:
            break
        }
    }

    // MARK: - Heartbeat

    private func startHeartbeat(on task: URLSessionWebSocketTask) {
        heartbeatTask?.cancel()
        missedPongs = 0
        heartbeatTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: ProtocolConstants.heartbeatIntervalMs * 1_000_000)
                guard !Task.isCancelled else { return }
                task.sendPing { [weak self] error in
                    guard let self else { return }
                    Task {
                        if error != nil {
                            await self.registerMissedPong()
                        } else {
                            await self.resetMissedPongs()
                        }
                    }
                }
            }
        }
    }

    private func registerMissedPong() {
        missedPongs += 1
        if missedPongs >= ProtocolConstants.heartbeatMaxMissed {
            task?.cancel(with: .abnormalClosure, reason: nil)
        }
    }

    private func resetMissedPongs() {
        missedPongs = 0
    }

    // MARK: - Failure / reconnect

    private func handleSocketFailure(_ error: Error, failedTask: URLSessionWebSocketTask) {
        guard let activeTask = task, activeTask === failedTask else { return }
        heartbeatTask?.cancel()
        task = nil
        activeTask.cancel(with: .abnormalClosure, reason: nil)
        guard !isExplicitlyDisconnected else { return }
        let transportError = Self.transportError(forSocketFailure: error)
        failAllPending(error: transportError)
        guard Self.shouldReconnect(after: transportError) else {
            updateState(.failed(Self.connectionError(from: transportError)))
            return
        }
        reconnectAttempt += 1
        updateState(.reconnecting(attempt: reconnectAttempt))
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard reconnectTask == nil, !isExplicitlyDisconnected else { return }
        reconnectTask = Task { [weak self] in
            await self?.runReconnectLoop()
        }
    }

    private func runReconnectLoop() async {
        defer { reconnectTask = nil }
        while !isExplicitlyDisconnected, !Task.isCancelled {
            let attempt = max(reconnectAttempt, 1)
            updateState(.reconnecting(attempt: attempt))
            let backoffMs = min(30_000, 1_000 * (1 << min(attempt, 5)))
            try? await Task.sleep(nanoseconds: UInt64(backoffMs) * 1_000_000)
            guard !isExplicitlyDisconnected, !Task.isCancelled else { return }

            do {
                try await openSocketAndHandshake()
                reconnectTask = nil
                return
            } catch {
                guard Self.shouldReconnect(after: error) else {
                    updateState(.failed(Self.connectionError(from: error)))
                    return
                }
                reconnectAttempt = attempt + 1
            }
        }
    }

    // MARK: - Pending request bookkeeping

    private func resolvePending(id: String, result: JSONValue) {
        guard let entry = pending.removeValue(forKey: id) else { return }
        entry.continuation.resume(returning: result)
    }

    private func failPending(id: String, error: Error) {
        guard let entry = pending.removeValue(forKey: id) else { return }
        entry.continuation.resume(throwing: error)
    }

    private func timeoutPending(id: String) {
        guard pending[id] != nil else { return }
        failPending(id: id, error: TransportError.requestTimedOut)
    }

    private func failAllPending(error: Error) {
        for id in Array(pending.keys) {
            failPending(id: id, error: error)
        }
    }

    private func ensureConnected(until deadline: Date) async throws {
        while true {
            switch state {
            case .connected:
                guard task != nil else { throw TransportError.notConnected }
                return
            case .connecting, .reconnecting:
                guard Date() < deadline else { throw TransportError.connectionTimedOut }
                try await Task.sleep(nanoseconds: 50_000_000)
            case .idle, .disconnected, .failed:
                throw TransportError.notConnected
            }
        }
    }

    static func configureWebSocketTask(_ task: URLSessionWebSocketTask) {
        task.maximumMessageSize = ProtocolConstants.maxIncomingMessageSizeBytes
    }

    static func transportError(forSocketFailure error: Error) -> TransportError {
        if let urlError = error as? URLError,
           urlError.code == .dataLengthExceedsMaximum {
            return .messageTooLarge
        }
        if error.localizedDescription.localizedCaseInsensitiveContains("message too long") {
            return .messageTooLarge
        }
        return .notConnected
    }

    static func shouldReconnect(after error: Error) -> Bool {
        if let transportError = error as? TransportError {
            return transportError.isConnectionUnavailable
        }
        if let urlError = error as? URLError {
            return urlError.code != .dataLengthExceedsMaximum
        }
        return false
    }

    static func connectionError(from error: Error) -> ConnectionError {
        if case .remote(let wireError)? = error as? TransportError {
            switch wireError.code {
            case .authFailed:
                return ConnectionError(kind: .auth, message: wireError.message)
            case .protocolVersionUnsupported:
                return ConnectionError(kind: .protocolVersion, message: wireError.message)
            default:
                return ConnectionError(kind: .server, message: wireError.message)
            }
        }
        return ConnectionError(kind: .network, message: error.localizedDescription)
    }

    private func updateState(_ newState: ConnectionState) {
        state = newState
        notifyDelegates { await $0.transport(self, didChangeState: newState) }
    }
}
