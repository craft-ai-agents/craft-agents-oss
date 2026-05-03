import CoreGraphics
import Foundation

struct CGWindowRecord {
    let ownerPID: pid_t
    let windowNumber: Int
    let title: String
    let frameAppKit: CGRect
    let orderIndex: Int
    let isOnScreen: Bool
}

enum CGWindowInventory {
    static func current(onScreenOnly: Bool) -> [CGWindowRecord] {
        let options: CGWindowListOption = onScreenOnly ? [.optionOnScreenOnly, .excludeDesktopElements] : [.optionAll, .excludeDesktopElements]
        guard let infoList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return []
        }

        return infoList.enumerated().compactMap { index, info in
            guard let ownerPID = info[kCGWindowOwnerPID as String] as? pid_t,
                  let windowNumber = info[kCGWindowNumber as String] as? Int,
                  let bounds = info[kCGWindowBounds as String] as? NSDictionary,
                  let quartzBounds = CGRect(dictionaryRepresentation: bounds) else {
                return nil
            }

            let layer = info[kCGWindowLayer as String] as? Int ?? 0
            let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
            guard layer == 0, alpha > 0 else {
                return nil
            }

            return CGWindowRecord(
                ownerPID: ownerPID,
                windowNumber: windowNumber,
                title: (info[kCGWindowName as String] as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
                frameAppKit: DesktopGeometry.appKitRect(fromQuartz: quartzBounds),
                orderIndex: index,
                isOnScreen: info[kCGWindowIsOnscreen as String] as? Bool ?? true
            )
        }
    }

    static func windows(for pid: pid_t, onScreenOnly: Bool) -> [CGWindowRecord] {
        current(onScreenOnly: onScreenOnly).filter { $0.ownerPID == pid }
    }
}
