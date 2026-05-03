import AppKit

struct CursorOverlayPresentation {
    let attachedWindowNumber: Int
    let attachedWindowLevelRawValue: Int
    let snapshot: CursorSnapshot
}

@MainActor
final class CursorOverlayController {
    private(set) var screen: NSScreen
    let window: NSWindow
    let overlayView: CursorOverlaySurfaceView

    init(screen: NSScreen) {
        self.screen = screen
        window = NSWindow(
            contentRect: screen.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        overlayView = CursorOverlaySurfaceView(frame: NSRect(origin: .zero, size: screen.frame.size))

        window.isReleasedWhenClosed = false
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .normal
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .transient]

        overlayView.autoresizingMask = [.width, .height]
        window.contentView = overlayView
    }

    func updateScreen(_ screen: NSScreen) {
        self.screen = screen
        window.setFrame(screen.frame, display: true)
        overlayView.frame = NSRect(origin: .zero, size: screen.frame.size)
    }

    func setPresentation(_ presentation: CursorOverlayPresentation?) {
        overlayView.presentation = presentation
        guard let presentation else {
            window.orderOut(nil)
            return
        }

        window.level = NSWindow.Level(rawValue: presentation.attachedWindowLevelRawValue)
        window.order(.above, relativeTo: presentation.attachedWindowNumber)
    }

    func teardown() {
        window.orderOut(nil)
    }
}

@MainActor
final class CursorOverlaySurfaceView: NSView {
    var presentation: CursorOverlayPresentation? {
        didSet {
            needsDisplay = true
        }
    }

    override var isFlipped: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let presentation,
              let context = NSGraphicsContext.current?.cgContext else {
            return
        }

        let localSnapshot = presentation.snapshot.mapGeometry(localPointOrFallback(fromScreenPoint:))
        context.saveGState()
        context.clear(bounds)
        CursorRenderer.draw(localSnapshot, in: context)
        context.restoreGState()
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    private func localPoint(fromScreenPoint point: CGPoint) -> CGPoint? {
        guard let window else { return nil }
        let windowPoint = window.convertPoint(fromScreen: point)
        return convert(windowPoint, from: nil)
    }

    private func localPointOrFallback(fromScreenPoint point: CGPoint) -> CGPoint {
        localPoint(fromScreenPoint: point) ?? CGPoint(
            x: point.x - (window?.frame.minX ?? 0),
            y: point.y - (window?.frame.minY ?? 0)
        )
    }
}
