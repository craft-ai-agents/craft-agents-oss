import Foundation

struct RuntimeBootState {
    let baseURL: URL
    let startedAt: Date
    let manifestPath: String
}

final class RuntimeBootstrap: @unchecked Sendable {
    private let server: LoopbackServer

    init(server: LoopbackServer = LoopbackServer()) {
        self.server = server
    }

    func start() async throws -> RuntimeBootState {
        let baseURL = try await server.start()
        let startedAt = server.startedAt ?? Date()
        let manifestURL = try writeManifest(baseURL: baseURL, startedAt: startedAt)
        return RuntimeBootState(
            baseURL: baseURL,
            startedAt: startedAt,
            manifestPath: manifestURL.path
        )
    }

    private func writeManifest(baseURL: URL, startedAt: Date) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("background-computer-use", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let manifestURL = directory.appendingPathComponent("runtime-manifest.json")
        let permissions = RuntimePermissionsSnapshot.current().dto
        let instructions = RuntimePermissionInstructions.make(permissions: permissions, baseURL: baseURL)
        let manifest = RuntimeManifestDTO(
            contractVersion: ContractVersion.current,
            baseURL: baseURL.absoluteString,
            startedAt: Time.iso8601String(from: startedAt),
            permissions: permissions,
            instructions: instructions,
            guide: APIDocumentation.guide,
            routes: RouteRegistry.bootstrapRouteDescriptors(baseURL: baseURL)
        )
        try JSONSupport.encoder.encode(manifest).write(to: manifestURL, options: .atomic)
        return manifestURL
    }
}
