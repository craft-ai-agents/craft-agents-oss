import Foundation
import Testing
@testable import BackgroundComputerUse

@Suite

struct APIDocumentationTests {
    @Test
    func everyPublicRouteIncludesOperationalDocumentation() {
        let routes = RouteRegistry.publicRoutes()

        #expect(routes.count == RouteID.allCases.count)

        for route in routes {
            #expect(!route.usage.whenToUse.isEmpty)
            #expect(!route.usage.successSignals.isEmpty)
            #expect(!route.errors.isEmpty)
            #expect(route.implementationStatus == .implemented)
        }
    }

    @Test
    func routeListResponseDocumentsGuideExecutionAndErrors() throws {
        let response = RouteListResponse(
            contractVersion: ContractVersion.current,
            guide: APIDocumentation.guide,
            routes: RouteRegistry.publicRoutes()
        )

        let data = try JSONSupport.encoder.encode(response)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["guide"] != nil)

        let routes = try #require(json["routes"] as? [[String: Any]])
        let click = try #require(routes.first { $0["id"] as? String == RouteID.click.rawValue })
        #expect(click["execution"] != nil)
        #expect(click["usage"] != nil)

        let errors = try #require(click["errors"] as? [[String: Any]])
        #expect(errors.contains { $0["error"] as? String == "invalid_request" })
        #expect(errors.contains { $0["error"] as? String == "window_not_found" })
    }

    @Test
    func actionRoutesDocumentCanonicalTargetOnly() throws {
        let response = RouteListResponse(
            contractVersion: ContractVersion.current,
            guide: APIDocumentation.guide,
            routes: RouteRegistry.publicRoutes()
        )

        let data = try JSONSupport.encoder.encode(response)
        let encoded = try #require(String(data: data, encoding: .utf8))

        let removedFieldName = "element" + "Index"
        #expect(!encoded.contains(removedFieldName))

        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let routes = try #require(json["routes"] as? [[String: Any]])
        for routeID in [
            RouteID.click.rawValue,
            RouteID.scroll.rawValue,
            RouteID.performSecondaryAction.rawValue,
            RouteID.typeText.rawValue,
            RouteID.setValue.rawValue
        ] {
            let route = try #require(routes.first { $0["id"] as? String == routeID })
            let request = try #require(route["request"] as? [String: Any])
            let fields = try #require(request["fields"] as? [[String: Any]])
            #expect(fields.contains { $0["name"] as? String == "target" })
        }
    }

    @Test
    func invalidRequestErrorIsVersionedAndActionable() throws {
        let request = try makeRequest(
            method: "POST",
            path: "/v1/list_windows",
            body: "{}"
        )

        let response = Router().response(
            for: request,
            context: RouterContext(baseURL: nil, startedAt: nil)
        )

        #expect(response.statusCode == 400)

        let json = try #require(JSONSerialization.jsonObject(with: response.body) as? [String: Any])
        #expect(json["contractVersion"] as? String == ContractVersion.current)
        #expect(json["ok"] as? Bool == false)
        #expect(json["error"] as? String == "invalid_request")
        #expect((json["message"] as? String)?.contains("Missing required field 'app'") == true)

        let recovery = try #require(json["recovery"] as? [String])
        #expect(recovery.contains { $0.contains("/v1/routes") })
    }

    private func makeRequest(method: String, path: String, body: String = "") throws -> HTTPRequest {
        let bodyData = Data(body.utf8)
        var request = "\(method) \(path) HTTP/1.1\r\n"
        request += "Host: 127.0.0.1\r\n"
        request += "Content-Type: application/json\r\n"
        request += "Content-Length: \(bodyData.count)\r\n"
        request += "\r\n"

        var data = Data(request.utf8)
        data.append(bodyData)

        switch HTTPRequest.parse(data) {
        case .complete(let parsed):
            return parsed
        case .incomplete:
            Issue.record("Request parser returned incomplete")
            throw TestRequestError.parseFailed
        case .invalid:
            Issue.record("Request parser returned invalid")
            throw TestRequestError.parseFailed
        case .tooLarge:
            Issue.record("Request parser rejected the fixture as too large")
            throw TestRequestError.parseFailed
        }
    }
}

private enum TestRequestError: Error {
    case parseFailed
}
