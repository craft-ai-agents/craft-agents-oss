import AppKit
import CoreGraphics
import Testing
@testable import BackgroundComputerUse

@Suite
struct CursorEmbellishmentPortTests {
    @Test
    func testLockedSwoopyMotionConstantsAndDurationFormula() {
        let tuning = CursorMotionTuning.swoopy

        #expect(abs(tuning.startHandle - 0.94) <= 0.0001)
        #expect(abs(tuning.endHandle - 0.38) <= 0.0001)
        #expect(abs(tuning.arcSize - 0.42) <= 0.0001)
        #expect(abs(tuning.arcFlow - 0.72) <= 0.0001)
        #expect(abs(tuning.baseDurationMilliseconds - 1280) <= 0.0001)
        #expect(abs(CursorMotionConstants.speedMultiplier - 1.45) <= 0.0001)
        #expect(abs(CursorMotionConstants.rotationStiffness - 60) <= 0.0001)
        #expect(abs(CursorMotionConstants.rotationDamping - 10) <= 0.0001)
        #expect(abs(CursorMotionConstants.rotationLookAhead - 0) <= 0.0001)
        #expect(CursorPivotKind.tip.pathPoint == .zero)

        let base = 1.280 / 1.45
        #expect(abs(MotionPacing.transitDuration(for: 520) - base) <= 0.0001)
        #expect(abs(MotionPacing.transitDuration(for: 1) - max(0.42, base * 0.55)) <= 0.0001)
        #expect(abs(MotionPacing.transitDuration(for: 2_000) - base * 1.80) <= 0.0001)
    }

    @Test
    func testLockedActionTimingDefaults() {
        let timings = CursorActionTimings.defaults

        #expect(timings.clickPressHoldMilliseconds == 120)
        #expect(timings.secondaryPreRippleMilliseconds == 120)
        #expect(timings.secondaryDwellMilliseconds == 550)
        #expect(timings.scrollStreakMilliseconds == 750)
        #expect(timings.scrollDwellMilliseconds == 850)
        #expect(timings.pressKeyPreBounceMilliseconds == 180)
        #expect(timings.pressKeyHoldMilliseconds == 180)
        #expect(timings.pressKeyReleaseMilliseconds == 500)
        #expect(timings.setValuePreRippleMilliseconds == 180)
        #expect(timings.setValueDwellMilliseconds == 550)
        #expect(timings.typeArrowToIBeamMilliseconds == 220)
        #expect(timings.typeIBeamToCaretMilliseconds == 220)
        #expect(timings.typeCharacterIntervalMilliseconds == 90)
        #expect(timings.typeTailDwellMilliseconds == 500)
        #expect(timings.morphDurationMilliseconds == 220)
    }

    @Test
    func testEdgeEntrancePointStartsOutsideScreenNearAnEdge() {
        let screen = CGRect(x: 100, y: 200, width: 800, height: 600)
        let expanded = screen.insetBy(dx: -121, dy: -121)

        for _ in 0..<40 {
            let point = CursorMotionPlanner.edgeEntrancePoint(for: screen)
            #expect(!screen.contains(point))
            #expect(expanded.contains(point))
        }
    }

    @Test
    func testPressKeyDisplayLabelUsesParsedChordText() {
        #expect(cursorKeycapDisplayLabel(normalized: "command+f") == "⌘F")
        #expect(cursorKeycapDisplayLabel(normalized: "shift+option+return") == "⇧⌥↩")
        #expect(cursorKeycapDisplayLabel(normalized: "command+shift+p") == "⌘⇧P")
        #expect(cursorKeycapDisplayLabel(normalized: "space") == "Space")
        #expect(cursorKeycapDisplayLabel(normalized: "escape") == "⎋")
    }

    @Test
    func testRendererDrawsLockedGlyphAndEffectStates() throws {
        let glyphs: [CursorGlyph] = [
            .arrow,
            .arrowWithBadge,
            .chevronPill(.vertical, .positive),
            .chevronPill(.horizontal, .negative),
            .keycap("cmd+F"),
            .crosshair,
            .ibeam,
            .caret,
        ]

        for glyph in glyphs {
            let image = try #require(renderSnapshot(glyph: glyph, effects: lockedEffects()))
            #expect(nonBlackPixelCount(in: image) > 60, "Expected \(glyph) to draw visible pixels.")
        }
    }

    private func renderSnapshot(glyph: CursorGlyph, effects: [CursorVisualEffect]) -> CGImage? {
        let width = 180
        let height = 180
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }

        context.setFillColor(NSColor.black.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))

        let accent = CursorAccentPalette.derive(from: NSColor.presenceCursorColor(hex: "#0095A1"))
        let snapshot = CursorSnapshot(
            cursorID: "codex",
            attachedWindowNumber: 1,
            attachedWindowLevelRawValue: 0,
            position: CGPoint(x: 90, y: 90),
            angle: CursorMotionConstants.arrowHomeAngle,
            scale: 1,
            alpha: 1,
            glyph: glyph,
            previousGlyph: nil,
            morphProgress: 1,
            isPressed: false,
            accent: accent,
            baseColor: accent.fill,
            pivotLocal: CursorPivotKind.tip.pathPoint,
            labelText: "Codex",
            labelAlpha: 1,
            labelScale: 1,
            trailHistories: [
                [CGPoint(x: 35, y: 35), CGPoint(x: 58, y: 52), CGPoint(x: 80, y: 72), CGPoint(x: 90, y: 90)],
            ],
            trailVisible: true,
            caretPhase: 0,
            anticipationTilt: 0,
            effects: effects
        )

        CursorRenderer.draw(snapshot, in: context)
        return context.makeImage()
    }

    private func lockedEffects() -> [CursorVisualEffect] {
        [
            .ripple(origin: CGPoint(x: 80, y: 88), color: .systemTeal, maxRadius: 22, thickness: 1.6, lifetime: 0.45, age: 0.18),
            .doubleRipple(origin: CGPoint(x: 95, y: 90), color: .systemTeal, lifetime: 0.65, age: 0.28),
            .chevronStreak(origin: CGPoint(x: 90, y: 90), axis: .vertical, direction: .positive, color: .systemTeal, speed: 140, lifetime: 0.42, age: 0.18),
            .puff(origin: CGPoint(x: 96, y: 98), drift: CGVector(dx: 0.1, dy: 1), color: .systemTeal, radius: 2.4, lifetime: 0.5, age: 0.18),
            .glowPulse(origin: CGPoint(x: 100, y: 100), color: .systemTeal, lifetime: 0.4, age: 0.16),
            .sparkRing(origin: CGPoint(x: 88, y: 92), color: .systemTeal, count: 6, lifetime: 0.52, age: 0.20, rngSeed: 42),
        ]
    }

    private func nonBlackPixelCount(in image: CGImage) -> Int {
        let width = image.width
        let height = image.height
        let bytesPerRow = width * 4
        var bytes = [UInt8](repeating: 0, count: bytesPerRow * height)

        let wrote = bytes.withUnsafeMutableBytes { rawBuffer -> Bool in
            guard let baseAddress = rawBuffer.baseAddress,
                  let context = CGContext(
                      data: baseAddress,
                      width: width,
                      height: height,
                      bitsPerComponent: 8,
                      bytesPerRow: bytesPerRow,
                      space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                  ) else {
                return false
            }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard wrote else { return 0 }

        var count = 0
        for offset in stride(from: 0, to: bytes.count, by: 4) {
            if bytes[offset] > 0 || bytes[offset + 1] > 0 || bytes[offset + 2] > 0 {
                count += 1
            }
        }
        return count
    }
}
