import Foundation

struct RuntimeCoordinator {
    func execute<T>(
        route: RouteDescriptorDTO,
        target: RouteTargetSummaryDTO,
        _ work: () throws -> T
    ) rethrows -> T {
        let scope = executionScope(for: route.execution.lane, target: target)
        return try RuntimeExecutionQueue.sync(scope: scope, work)
    }

    private func executionScope(
        for lane: RouteExecutionLaneDTO,
        target: RouteTargetSummaryDTO
    ) -> RuntimeExecutionScope {
        switch lane {
        case .sharedRead:
            return .sharedRead
        case .windowRead:
            return .windowRead(target.windowID ?? "__missing_window__")
        case .windowWrite:
            return .windowWrite(target.windowID ?? "__missing_window__")
        }
    }

}
