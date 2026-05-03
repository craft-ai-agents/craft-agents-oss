import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case unknown = "UNKNOWN"

    init(token: String) {
        self = HTTPMethod(rawValue: token.uppercased()) ?? .unknown
    }
}

enum HTTPRequestParseResult {
    case incomplete
    case invalid
    case tooLarge
    case complete(HTTPRequest)
}

struct HTTPRequest {
    private static let maximumHeaderBytes = 64 * 1024
    private static let maximumBodyBytes = 10 * 1024 * 1024
    private static let singletonHeaders: Set<String> = [
        "content-length",
        "content-type",
        "host"
    ]

    let method: HTTPMethod
    let path: String
    let queryItems: [URLQueryItem]
    let headers: [String: String]
    let body: Data

    static func parse(_ data: Data) -> HTTPRequestParseResult {
        let separator = Data("\r\n\r\n".utf8)
        guard let headerRange = data.range(of: separator) else {
            if data.count > maximumHeaderBytes {
                return .tooLarge
            }
            return .incomplete
        }
        guard headerRange.lowerBound <= maximumHeaderBytes else {
            return .tooLarge
        }

        let headerData = data.subdata(in: 0..<headerRange.lowerBound)
        guard let headerBlock = String(data: headerData, encoding: .utf8) else {
            return .invalid
        }
        let headerLines = headerBlock.components(separatedBy: "\r\n")

        guard let requestLine = headerLines.first else {
            return .invalid
        }

        let requestLineParts = requestLine.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
        guard requestLineParts.count >= 2 else {
            return .invalid
        }

        let method = HTTPMethod(token: String(requestLineParts[0]))
        let rawPath = String(requestLineParts[1])
        let url = URL(string: "http://127.0.0.1\(rawPath)")

        var headers: [String: String] = [:]
        var canonicalHeaderNames: [String: String] = [:]
        for line in headerLines.dropFirst() {
            let pair = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard pair.count == 2 else {
                return .invalid
            }

            let rawName = String(pair[0]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(pair[1]).trimmingCharacters(in: .whitespacesAndNewlines)
            guard rawName.isEmpty == false else {
                return .invalid
            }

            let normalizedName = rawName.lowercased()
            if let existingName = canonicalHeaderNames[normalizedName] {
                if singletonHeaders.contains(normalizedName) {
                    return .invalid
                }
                headers[existingName] = [headers[existingName], value]
                    .compactMap { $0 }
                    .joined(separator: ", ")
            } else {
                canonicalHeaderNames[normalizedName] = rawName
                headers[rawName] = value
            }
        }

        let normalizedHeaders = Dictionary(uniqueKeysWithValues: headers.map { key, value in
            (key.lowercased(), value)
        })
        let contentLengthValue = normalizedHeaders["content-length"] ?? "0"
        guard let contentLength = Int(contentLengthValue), contentLength >= 0 else {
            return .invalid
        }
        guard contentLength <= maximumBodyBytes else {
            return .tooLarge
        }
        let bodyStart = headerRange.upperBound
        let availableBodyLength = data.count - bodyStart
        guard availableBodyLength >= contentLength else {
            return .incomplete
        }
        let body = data.subdata(in: bodyStart..<(bodyStart + contentLength))

        return .complete(
            HTTPRequest(
                method: method,
                path: url?.path ?? rawPath,
                queryItems: URLComponents(
                    url: url ?? URL(string: "http://127.0.0.1")!,
                    resolvingAgainstBaseURL: false
                )?.queryItems ?? [],
                headers: headers,
                body: body
            )
        )
    }

    private init(
        method: HTTPMethod,
        path: String,
        queryItems: [URLQueryItem],
        headers: [String: String],
        body: Data
    ) {
        self.method = method
        self.path = path
        self.queryItems = queryItems
        self.headers = headers
        self.body = body
    }
}

struct HTTPResponse {
    let statusCode: Int
    let reasonPhrase: String
    let headers: [String: String]
    let body: Data

    func serialized() -> Data {
        var response = "HTTP/1.1 \(statusCode) \(reasonPhrase)\r\n"
        for (header, value) in headers.sorted(by: { $0.key < $1.key }) {
            response += "\(header): \(value)\r\n"
        }
        response += "Content-Length: \(body.count)\r\n"
        response += "Connection: close\r\n\r\n"

        var data = Data(response.utf8)
        data.append(body)
        return data
    }

    static func json<T: Encodable>(
        _ value: T,
        statusCode: Int = 200,
        reasonPhrase: String = "OK",
        includeDebugNotes: Bool = true
    ) -> HTTPResponse {
        let body: Data
        do {
            let encoded = try JSONSupport.encoder.encode(value)
            body = includeDebugNotes ? encoded : try stripDebugNotes(from: encoded)
        } catch {
            let message = "Failed to encode \(String(describing: T.self)): \(error)"
            let fallback = ErrorResponse(
                error: "encoding_failure",
                message: message,
                requestID: UUID().uuidString,
                recovery: ["The server could not serialize the response. Keep the requestID and report this as a runtime bug."]
            )
            let fallbackBody = (try? JSONSupport.encoder.encode(fallback))
                ?? Data("{\"contractVersion\":\"\(ContractVersion.current)\",\"ok\":false,\"error\":\"encoding_failure\",\"message\":\"Failed to encode response.\",\"requestID\":\"unknown\",\"recovery\":[]}".utf8)
            return HTTPResponse(
                statusCode: 500,
                reasonPhrase: "Internal Server Error",
                headers: [
                    "Cache-Control": "no-store",
                    "Content-Type": "application/json; charset=utf-8"
                ],
                body: fallbackBody
            )
        }

        return HTTPResponse(
            statusCode: statusCode,
            reasonPhrase: reasonPhrase,
            headers: [
                "Cache-Control": "no-store",
                "Content-Type": "application/json; charset=utf-8"
            ],
            body: body
        )
    }

    static func text(
        _ value: String,
        statusCode: Int = 200,
        reasonPhrase: String = "OK"
    ) -> HTTPResponse {
        HTTPResponse(
            statusCode: statusCode,
            reasonPhrase: reasonPhrase,
            headers: [
                "Cache-Control": "no-store",
                "Content-Type": "text/plain; charset=utf-8"
            ],
            body: Data(value.utf8)
        )
    }

    private static func stripDebugNotes(from data: Data) throws -> Data {
        let json = try JSONSerialization.jsonObject(with: data)
        let stripped = stripDebugNotes(from: json)
        return try JSONSerialization.data(
            withJSONObject: stripped,
            options: [.prettyPrinted, .sortedKeys]
        )
    }

    private static func stripDebugNotes(from value: Any) -> Any {
        if let dictionary = value as? [String: Any] {
            var stripped: [String: Any] = [:]
            for (key, child) in dictionary where key != "notes" {
                stripped[key] = stripDebugNotes(from: child)
            }
            return stripped
        }

        if let array = value as? [Any] {
            return array.map(stripDebugNotes(from:))
        }

        return value
    }
}
