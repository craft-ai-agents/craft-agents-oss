import Foundation

struct ActionExecutionOptions {
    let visualCursorEnabled: Bool

    static let visualCursorEnabled = ActionExecutionOptions(visualCursorEnabled: true)
    static let visualCursorDisabled = ActionExecutionOptions(visualCursorEnabled: false)
}
