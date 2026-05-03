import Foundation

enum RuntimePermissionInstructions {
    static func make(permissions: RuntimePermissionsDTO, baseURL: URL?) -> BootstrapInstructionsDTO {
        let ready = permissions.accessibility.granted && permissions.screenRecording.granted
        var agent = [
            "Call GET /v1/bootstrap first and check permissions before using action routes.",
            "Use GET /v1/routes as the self-documenting route catalog for request and response shapes.",
            "For visual tasks, call POST /v1/get_window_state with imageMode path or base64 whenever possible and inspect the screenshot as the primary visual ground truth.",
            "Use the projected AX tree for semantic targeting, but validate results with screenshots because AX state and verifiers can lag or omit visual details.",
            "Action routes accept a cursor object. Reuse the same cursor id across related actions to keep one continuous on-screen cursor session."
        ]
        if let baseURL {
            agent.insert("Use local baseURL \(baseURL.absoluteString) for all /v1 requests.", at: 1)
        }

        var user: [String] = []
        if permissions.accessibility.granted == false {
            user.append("Grant Accessibility permission to BackgroundComputerUse in System Settings > Privacy & Security > Accessibility.")
        }
        if permissions.screenRecording.granted == false {
            user.append("Grant Screen Recording permission to BackgroundComputerUse in System Settings > Privacy & Security > Screen & System Audio Recording.")
        }
        if ready == false {
            user.append("After granting permissions, quit and relaunch BackgroundComputerUse through script/start.sh or script/build_and_run.sh run.")
        }
        user.append("Development builds should be launched through the signing/run scripts so macOS permissions attach to the signed app bundle.")

        return BootstrapInstructionsDTO(
            ready: ready,
            summary: ready
                ? "Runtime is ready. Permissions are granted."
                : "Runtime is reachable, but macOS permissions are missing.",
            agent: agent,
            user: user
        )
    }
}
