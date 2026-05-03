import Foundation

public struct BackgroundComputerUseRuntimeOptions: Sendable {
    public var visualCursor: VisualCursorMode

    public init(visualCursor: VisualCursorMode = .disabled) {
        self.visualCursor = visualCursor
    }
}

public enum VisualCursorMode: Sendable {
    case disabled
    case enabled
}

public final class BackgroundComputerUseRuntime {
    private let services: RuntimeServices

    public init(options: BackgroundComputerUseRuntimeOptions = .init()) {
        let actionOptions = ActionExecutionOptions(
            visualCursorEnabled: options.visualCursor == .enabled
        )
        services = RuntimeServices(executionOptions: actionOptions)
    }

    public func permissions() -> RuntimePermissionsDTO {
        services.permissions()
    }

    public func listApps() -> ListAppsResponse {
        services.listApps()
    }

    public func listWindows(_ request: ListWindowsRequest) throws -> ListWindowsResponse {
        try services.listWindows(request)
    }

    public func getWindowState(_ request: GetWindowStateRequest) throws -> GetWindowStateResponse {
        try services.getWindowState(request)
    }

    public func click(_ request: ClickRequest) throws -> ClickResponse {
        try services.click(request)
    }

    public func scroll(_ request: ScrollRequest) throws -> ScrollResponse {
        try services.scroll(request)
    }

    public func performSecondaryAction(_ request: PerformSecondaryActionRequest) throws -> PerformSecondaryActionResponse {
        try services.performSecondaryAction(request)
    }

    public func drag(_ request: DragRequest) throws -> DragResponse {
        try services.drag(request)
    }

    public func resize(_ request: ResizeRequest) throws -> ResizeResponse {
        try services.resize(request)
    }

    public func setWindowFrame(_ request: SetWindowFrameRequest) throws -> SetWindowFrameResponse {
        try services.setWindowFrame(request)
    }

    public func typeText(_ request: TypeTextRequest) throws -> TypeTextResponse {
        try services.typeText(request)
    }

    public func pressKey(_ request: PressKeyRequest) throws -> PressKeyResponse {
        try services.pressKey(request)
    }

    public func setValue(_ request: SetValueRequest) throws -> SetValueResponse {
        try services.setValue(request)
    }
}
