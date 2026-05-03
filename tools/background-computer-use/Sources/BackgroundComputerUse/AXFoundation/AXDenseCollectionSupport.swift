import ApplicationServices

enum AXDenseCollectionSupport {
    static let windowingThreshold = 80

    static var rowsAttribute: CFString { "AXRows" as CFString }
    static var visibleRowsAttribute: CFString { "AXVisibleRows" as CFString }

    static func isNativeCollectionRole(_ role: String?) -> Bool {
        switch role {
        case String(kAXTableRole),
             String(kAXOutlineRole),
             String(kAXListRole),
             "AXCollection",
             "AXContentList":
            return true
        default:
            return false
        }
    }
}
