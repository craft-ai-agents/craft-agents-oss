import Foundation

func sanitizedJSONDouble(_ value: Double) -> Double {
    guard value.isFinite else {
        return 0
    }
    return value
}
