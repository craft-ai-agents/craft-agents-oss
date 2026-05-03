import AppKit
import Foundation

enum CursorTargetProjector {
    static func titlebarAnchor(for frame: CGRect) -> CGPoint {
        let titlebarHeight = min(max(28.0, frame.height * 0.06), 48.0)
        return CGPoint(
            x: frame.midX,
            y: frame.maxY - (titlebarHeight / 2)
        )
    }

    static func resizeHandlePoint(for handle: ResizeHandleDTO, in frame: CGRect) -> CGPoint {
        switch handle {
        case .left:
            return CGPoint(x: frame.minX, y: frame.midY)
        case .right:
            return CGPoint(x: frame.maxX, y: frame.midY)
        case .top:
            return CGPoint(x: frame.midX, y: frame.maxY)
        case .bottom:
            return CGPoint(x: frame.midX, y: frame.minY)
        case .topLeft:
            return CGPoint(x: frame.minX, y: frame.maxY)
        case .topRight:
            return CGPoint(x: frame.maxX, y: frame.maxY)
        case .bottomLeft:
            return CGPoint(x: frame.minX, y: frame.minY)
        case .bottomRight:
            return CGPoint(x: frame.maxX, y: frame.minY)
        }
    }
}
