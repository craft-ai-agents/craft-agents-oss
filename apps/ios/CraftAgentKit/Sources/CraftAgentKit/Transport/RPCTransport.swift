// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/RPCTransport.swift
import Foundation

/// WebSocket-based RPC transport. Owns connection lifecycle, handshake,
/// heartbeat, request/response correlation, and reconnect-with-replay —
/// the Swift-side counterpart to `packages/server-core/src/transport/client.ts`.
public actor RPCTransport: NSObject {
    private struct PendingRequest {
        let continuation: CheckedContinuation<JSONValue, Error>
    }

    public enum TransportError: Error, Equatable {
        case notConnected
        case requestTimedOut
        case remote(WireError)
        case invalidResponse
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
    private var missedPongs = 0
    private var isExplicitlyDisconnected = false

    public private(set) var state: ConnectionState = .idle
    private var delegates: [ObjectIdentifier: RPCTransportDelegate] = [:]

    public override init() {
        super.init()
        self.session = URLSession(configuration: .default)
    }

    public func addDelegate(_ delegate: RPCTransportDelegate) {
        delegates[ObjectIdentifier(delegate)] = delegate
    }

    public func removeDelegate(_ delegate: RPCTransportDelegate) {
        delegates.removeValue(forKey: ObjectIdentifier(delegate))
    }

    private func notifyDelegates(_ body: @escaping (RPCTransportDelegate) async -> Void) {
        for delegate in delegates.values {
            Task { await body(delegate) }
        }
    }

    /// Test-only hook so `RPCTransportMultiDelegateTests` can exercise
    /// `notifyDelegates` without a live socket.
    func dispatchForTesting(_ envelope: MessageEnvelope) async {
        await handle(envelope)
    }

    /// Opens the WebSocket, performs the handshake, and returns once the
    /// server has acknowledged (`handshake_ack`). Throws on auth failure,
    /// protocol mismatch, or timeout.
    public func connect(serverURL: URL, token: String, workspaceId: String?) async throws {
        self.serverURL = serverURL
        self.token = token
        self.workspaceId = workspaceId
        isExplicitlyDisconnected = false
        try await openSocketAndHandshake()
    }

    public func disconnect() {
        isExplicitlyDisconnected = true
        heartbeatTask?.cancel()
        receiveTask?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        updateState(.disconnected)
    }

    /// Sends a request envelope and awaits the correlated response/error.
    public func request(channel: String, args: [JSONValue] = []) async throws -> JSONValue {
        guard let task else { throw TransportError.notConnected }
        let id = UUID().uuidString
        let envelope = MessageEnvelope(id: id, type: .request, channel: channel, args: args)
        let wire = try ProtocolCodec.serialize(envelope)

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = PendingRequest(continuation: continuation)
            Task {
                do {
                    try await task.send(.string(wire))
                } catch {
                    await self.failPending(id: id, error: error)
                }
            }
            Task {
                try? await Task.sleep(nanoseconds: ProtocolConstants.requestTimeoutMs * 1_000_000)
                await self.timeoutPending(id: id)
            }
        }
    }

    // MARK: - Handshake

    private func openSocketAndHandshake() async throws {
        guard let serverURL, let token else { throw TransportError.notConnected }
        updateState(reconnectAttempt > 0 ? .reconnecting(attempt: reconnectAttempt) : .connecting)

        let newTask = session.webSocketTask(with: serverURL)
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

        let wire = try ProtocolCodec.serialize(handshake)
        try await newTask.send(.string(wire))

        let ackEnvelope = try await receiveHandshakeAck(on: newTask, expectedId: handshakeId)
        self.clientId = ackEnvelope.clientId
        reconnectAttempt = 0
        updateState(.connected)

        startReceiveLoop(on: newTask)
        startHeartbeat(on: newTask)
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
                    await self.handleSocketFailure(error)
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

    private func handleSocketFailure(_ error: Error) async {
        heartbeatTask?.cancel()
        guard !isExplicitlyDisconnected else { return }
        for (id, _) in pending {
            failPending(id: id, error: TransportError.notConnected)
        }
        reconnectAttempt += 1
        updateState(.reconnecting(attempt: reconnectAttempt))

        let backoffMs = min(30_000, 1_000 * (1 << min(reconnectAttempt, 5)))
        try? await Task.sleep(nanoseconds: UInt64(backoffMs) * 1_000_000)
        guard !isExplicitlyDisconnected else { return }
        do {
            try await openSocketAndHandshake()
        } catch {
            updateState(.failed(ConnectionError(kind: .network, message: "\(error)")))
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

    private func updateState(_ newState: ConnectionState) {
        state = newState
        notifyDelegates { await $0.transport(self, didChangeState: newState) }
    }
}
