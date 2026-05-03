import Foundation

public struct HealthResponse: Encodable, Sendable {
    public let ok: Bool
    public let contractVersion: String
    public let timestamp: String
}

public struct BootstrapRouteDTO: Encodable, Sendable {
    public let id: String
    public let method: String
    public let path: String
    public let url: String
    public let category: String
    public let summary: String
}

public struct RouteFieldDTO: Encodable, Sendable {
    public let name: String
    public let type: String
    public let required: Bool
    public let description: String?
    public let defaultValue: String?
}

public struct RouteBodySchemaDTO: Encodable, Sendable {
    public let contentType: String?
    public let fields: [RouteFieldDTO]
}

public struct APIConceptDTO: Encodable, Sendable {
    public let name: String
    public let description: String
    public let fields: [RouteFieldDTO]?
}

public struct APIGuideDTO: Encodable, Sendable {
    public let summary: String
    public let flow: [String]
    public let concepts: [APIConceptDTO]
    public let responseReading: [String]
    public let troubleshooting: [String]
}

public struct RouteUsageDTO: Encodable, Sendable {
    public let whenToUse: String
    public let useAfter: [String]
    public let successSignals: [String]
    public let nextSteps: [String]
    public let exampleRequest: String?
}

public struct RouteErrorDTO: Encodable, Sendable {
    public let statusCode: Int
    public let error: String
    public let meaning: String
    public let recovery: [String]
}

public struct APIRouteDTO: Encodable, Sendable {
    public let id: String
    public let method: String
    public let path: String
    public let category: String
    public let summary: String
    public let notes: [String]
    public let execution: RouteExecutionPolicyDTO
    public let implementationStatus: RouteImplementationStatusDTO
    public let usage: RouteUsageDTO
    public let request: RouteBodySchemaDTO?
    public let response: RouteBodySchemaDTO
    public let errors: [RouteErrorDTO]
}

public struct PermissionStatusDTO: Encodable, Sendable {
    public let granted: Bool
    public let promptable: Bool
}

public struct RuntimePermissionsDTO: Encodable, Sendable {
    public let accessibility: PermissionStatusDTO
    public let screenRecording: PermissionStatusDTO
    public let checkedAt: String
    public let checkMs: Double
}

public struct BootstrapInstructionsDTO: Encodable, Sendable {
    public let ready: Bool
    public let summary: String
    public let agent: [String]
    public let user: [String]
}

public struct BootstrapResponse: Encodable, Sendable {
    public let contractVersion: String
    public let baseURL: String?
    public let startedAt: String?
    public let permissions: RuntimePermissionsDTO
    public let instructions: BootstrapInstructionsDTO
    public let guide: APIGuideDTO
    public let routes: [BootstrapRouteDTO]
}

public struct RuntimeManifestDTO: Encodable, Sendable {
    public let contractVersion: String
    public let baseURL: String
    public let startedAt: String
    public let permissions: RuntimePermissionsDTO
    public let instructions: BootstrapInstructionsDTO
    public let guide: APIGuideDTO
    public let routes: [BootstrapRouteDTO]
}

public struct RouteListResponse: Encodable, Sendable {
    public let contractVersion: String
    public let guide: APIGuideDTO
    public let routes: [APIRouteDTO]
}

public struct ErrorResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let error: String
    public let message: String
    public let requestID: String
    public let recovery: [String]

    public init(
        error: String,
        message: String,
        requestID: String,
        recovery: [String] = [],
        contractVersion: String = ContractVersion.current,
        ok: Bool = false
    ) {
        self.contractVersion = contractVersion
        self.ok = ok
        self.error = error
        self.message = message
        self.requestID = requestID
        self.recovery = recovery
    }
}
