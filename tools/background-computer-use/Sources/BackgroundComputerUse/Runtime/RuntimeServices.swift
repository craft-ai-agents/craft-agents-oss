import Foundation

struct RuntimeServices {
    private let coordinator = RuntimeCoordinator()
    private let runningAppService = RunningAppService()
    private let windowListService = WindowListService()
    private let windowStateService: WindowStateService
    private let windowDragRouteService: WindowDragRouteService
    private let windowResizeRouteService: WindowResizeRouteService
    private let setWindowFrameRouteService: SetWindowFrameRouteService
    private let setValueRouteService: SetValueRouteService
    private let typeTextRouteService: TypeTextRouteService
    private let pressKeyRouteService: PressKeyRouteService
    private let scrollRouteService: ScrollRouteService
    private let secondaryActionRouteService: SecondaryActionRouteService
    private let clickRouteService: ClickRouteService

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        windowStateService = WindowStateService(executionOptions: executionOptions)
        windowDragRouteService = WindowDragRouteService(executionOptions: executionOptions)
        windowResizeRouteService = WindowResizeRouteService(executionOptions: executionOptions)
        setWindowFrameRouteService = SetWindowFrameRouteService(executionOptions: executionOptions)
        setValueRouteService = SetValueRouteService(executionOptions: executionOptions)
        typeTextRouteService = TypeTextRouteService(executionOptions: executionOptions)
        pressKeyRouteService = PressKeyRouteService(executionOptions: executionOptions)
        scrollRouteService = ScrollRouteService(executionOptions: executionOptions)
        secondaryActionRouteService = SecondaryActionRouteService(executionOptions: executionOptions)
        clickRouteService = ClickRouteService(executionOptions: executionOptions)
    }

    func permissions() -> RuntimePermissionsDTO {
        RuntimePermissionsSnapshot.current().dto
    }

    func listApps() -> ListAppsResponse {
        execute(routeID: .listApps, target: .shared) {
            runningAppService.listApps()
        }
    }

    func listWindows(_ request: ListWindowsRequest) throws -> ListWindowsResponse {
        try execute(
            routeID: .listWindows,
            target: RouteTargetSummaryDTO(kind: .appQuery, appQuery: request.app, windowID: nil)
        ) {
            try windowListService.listWindows(appQuery: request.app)
        }
    }

    func getWindowState(_ request: GetWindowStateRequest) throws -> GetWindowStateResponse {
        try execute(routeID: .getWindowState, target: windowTarget(request.window)) {
            try windowStateService.getWindowState(request: request)
        }
    }

    func click(_ request: ClickRequest) throws -> ClickResponse {
        try execute(routeID: .click, target: windowTarget(request.window)) {
            try clickRouteService.click(request: request)
        }
    }

    func scroll(_ request: ScrollRequest) throws -> ScrollResponse {
        try execute(routeID: .scroll, target: windowTarget(request.window)) {
            try scrollRouteService.scroll(request: request)
        }
    }

    func performSecondaryAction(_ request: PerformSecondaryActionRequest) throws -> PerformSecondaryActionResponse {
        try execute(routeID: .performSecondaryAction, target: windowTarget(request.window)) {
            try secondaryActionRouteService.performSecondaryAction(request: request)
        }
    }

    func drag(_ request: DragRequest) throws -> DragResponse {
        try execute(routeID: .drag, target: windowTarget(request.window)) {
            try windowDragRouteService.drag(request: request)
        }
    }

    func resize(_ request: ResizeRequest) throws -> ResizeResponse {
        try execute(routeID: .resize, target: windowTarget(request.window)) {
            try windowResizeRouteService.resize(request: request)
        }
    }

    func setWindowFrame(_ request: SetWindowFrameRequest) throws -> SetWindowFrameResponse {
        try execute(routeID: .setWindowFrame, target: windowTarget(request.window)) {
            try setWindowFrameRouteService.setWindowFrame(request: request)
        }
    }

    func typeText(_ request: TypeTextRequest) throws -> TypeTextResponse {
        try execute(routeID: .typeText, target: windowTarget(request.window)) {
            try typeTextRouteService.typeText(request: request)
        }
    }

    func pressKey(_ request: PressKeyRequest) throws -> PressKeyResponse {
        try execute(routeID: .pressKey, target: windowTarget(request.window)) {
            try pressKeyRouteService.pressKey(request: request)
        }
    }

    func setValue(_ request: SetValueRequest) throws -> SetValueResponse {
        try execute(routeID: .setValue, target: windowTarget(request.window)) {
            try setValueRouteService.setValue(request: request)
        }
    }

    private func execute<Response>(
        routeID: RouteID,
        target: RouteTargetSummaryDTO,
        _ work: () throws -> Response
    ) rethrows -> Response {
        let route = RouteRegistry.descriptor(for: routeID)
        return try coordinator.execute(route: route, target: target, work)
    }

    private func windowTarget(_ windowID: String) -> RouteTargetSummaryDTO {
        RouteTargetSummaryDTO(kind: .window, appQuery: nil, windowID: windowID)
    }
}
