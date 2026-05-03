import Foundation

enum RuntimeExecutionScope {
    case sharedRead
    case windowRead(String)
    case windowWrite(String)
}

enum RuntimeExecutionQueue {
    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var windowQueues: [String: DispatchQueue] = [:]
    }

    private static let state = State()
    private static let sharedQueue = DispatchQueue(
        label: "BackgroundComputerUse.RuntimeExecutionQueue.Shared",
        qos: .userInitiated,
        attributes: .concurrent
    )

    static func sync<T>(
        scope: RuntimeExecutionScope,
        _ work: () throws -> T
    ) rethrows -> T {
        switch scope {
        case .sharedRead:
            return try sharedQueue.sync(execute: work)
        case .windowRead(let windowID):
            return try queue(for: windowID).sync(execute: work)
        case .windowWrite(let windowID):
            return try queue(for: windowID).sync(flags: .barrier, execute: work)
        }
    }

    private static func queue(for windowID: String) -> DispatchQueue {
        state.lock.lock()
        defer { state.lock.unlock() }

        if let existing = state.windowQueues[windowID] {
            return existing
        }

        let queue = DispatchQueue(
            label: "BackgroundComputerUse.RuntimeExecutionQueue.Window.\(windowID)",
            qos: .userInitiated,
            attributes: .concurrent
        )
        state.windowQueues[windowID] = queue
        return queue
    }
}
