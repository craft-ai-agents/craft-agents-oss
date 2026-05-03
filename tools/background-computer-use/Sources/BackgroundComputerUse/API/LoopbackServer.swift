import Foundation
import Network

final class LoopbackServer: @unchecked Sendable {
    private let queue = DispatchQueue(
        label: "BackgroundComputerUse.LoopbackServer",
        qos: .userInitiated,
        attributes: .concurrent
    )
    private let router = Router()
    private var listener: NWListener?

    private(set) var baseURL: URL?
    private(set) var startedAt: Date?

    func start() async throws -> URL {
        if let baseURL {
            return baseURL
        }

        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true

        let listener = try NWListener(using: parameters, on: .any)
        self.listener = listener

        return try await withCheckedThrowingContinuation { continuation in
            let gate = ResumeGate()

            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection: connection)
            }

            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }

                switch state {
                case .ready:
                    guard let port = listener.port else { return }
                    let baseURL = URL(string: "http://127.0.0.1:\(port.rawValue)")!
                    self.baseURL = baseURL
                    self.startedAt = Date()
                    gate.resumeIfNeeded {
                        continuation.resume(returning: baseURL)
                    }

                case .failed(let error):
                    self.baseURL = nil
                    self.startedAt = nil
                    gate.resumeIfNeeded {
                        continuation.resume(throwing: error)
                    }

                case .cancelled:
                    self.baseURL = nil
                    self.startedAt = nil

                default:
                    break
                }
            }

            listener.start(queue: queue)
        }
    }

    private func handle(connection: NWConnection) {
        let connectionQueue = DispatchQueue(
            label: "BackgroundComputerUse.LoopbackServer.Connection.\(UUID().uuidString)",
            qos: .userInitiated
        )
        connection.start(queue: connectionQueue)
        receiveRequest(on: connection, buffer: Data())
    }

    private func receiveRequest(
        on connection: NWConnection,
        buffer: Data
    ) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }

            var updatedBuffer = buffer
            if let data {
                updatedBuffer.append(data)
            }

            if error != nil {
                self.sendBadRequest(
                    on: connection,
                    message: "Connection failed while reading the HTTP request."
                )
                return
            }

            switch HTTPRequest.parse(updatedBuffer) {
            case .complete(let request):
                let response = self.router.response(
                    for: request,
                    context: RouterContext(
                        baseURL: self.baseURL,
                        startedAt: self.startedAt
                    )
                )
                self.send(response, on: connection)

            case .incomplete:
                guard isComplete == false else {
                    self.sendBadRequest(
                        on: connection,
                        message: "The HTTP request ended before the full payload arrived."
                    )
                    return
                }
                self.receiveRequest(on: connection, buffer: updatedBuffer)

            case .invalid:
                self.sendBadRequest(
                    on: connection,
                    message: "Unable to parse the incoming HTTP request."
                )

            case .tooLarge:
                self.sendPayloadTooLarge(on: connection)
            }
        }
    }

    private func send(_ response: HTTPResponse, on connection: NWConnection) {
        connection.send(content: response.serialized(), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func sendBadRequest(on connection: NWConnection, message: String) {
        let response = HTTPResponse.json(
            ErrorResponse(
                error: "bad_request",
                message: message,
                requestID: UUID().uuidString,
                recovery: [
                    "Send a complete HTTP/1.1 request with a valid request line, headers, and Content-Length.",
                    "For POST routes, send Content-Type: application/json and a JSON object body."
                ]
            ),
            statusCode: 400,
            reasonPhrase: "Bad Request"
        )
        connection.send(content: response.serialized(), completion: .contentProcessed { _ in
                connection.cancel()
        })
    }

    private func sendPayloadTooLarge(on connection: NWConnection) {
        let response = HTTPResponse.json(
            ErrorResponse(
                error: "payload_too_large",
                message: "The HTTP request exceeded the runtime's header or body size limits.",
                requestID: UUID().uuidString,
                recovery: [
                    "Send a smaller JSON payload.",
                    "For screenshots and large state reads, request imageMode path instead of base64 when possible."
                ]
            ),
            statusCode: 413,
            reasonPhrase: "Payload Too Large"
        )
        connection.send(content: response.serialized(), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}

private final class ResumeGate: @unchecked Sendable {
    private let lock = NSLock()
    private var resumed = false

    func resumeIfNeeded(_ body: () -> Void) {
        lock.lock()
        defer { lock.unlock() }

        guard resumed == false else { return }
        resumed = true
        body()
    }
}
