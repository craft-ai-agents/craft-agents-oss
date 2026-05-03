import AppKit
import Foundation

private func tipScreenPosition(snapshot: CursorSnapshot) -> CGPoint {
    let effectiveAngle = snapshot.angle + snapshot.anticipationTilt + CursorMotionConstants.drawAngleOffset
    let c = cos(effectiveAngle)
    let s = sin(effectiveAngle)
    let vx = -snapshot.pivotLocal.x
    let vy = -snapshot.pivotLocal.y
    let ox = (c * vx - s * vy) * snapshot.scale
    let oy = (s * vx + c * vy) * snapshot.scale
    return CGPoint(x: snapshot.position.x + ox, y: snapshot.position.y + oy)
}

private func isArrowLike(_ glyph: CursorGlyph) -> Bool {
    switch glyph {
    case .arrow, .arrowWithBadge:
        return true
    case .chevronPill, .keycap, .crosshair, .ibeam, .caret:
        return false
    }
}

enum CursorRenderer {
    static func draw(_ snapshot: CursorSnapshot, in context: CGContext) {
        if snapshot.trailVisible {
            drawTrail(
                histories: snapshot.trailHistories,
                color: snapshot.accent.trail,
                alpha: snapshot.alpha,
                in: context
            )
        }

        let tipScreen = tipScreenPosition(snapshot: snapshot)
        let effectiveAngle = snapshot.angle + snapshot.anticipationTilt

        if let previous = snapshot.previousGlyph, snapshot.morphProgress < 1 {
            let previousAlpha = (1 - snapshot.morphProgress) * snapshot.alpha
            let nextAlpha = snapshot.morphProgress * snapshot.alpha
            let popScale = morphScale(snapshot.morphProgress)
            drawGlyph(
                previous,
                position: isArrowLike(previous) ? snapshot.position : tipScreen,
                tipScreen: tipScreen,
                angle: effectiveAngle,
                scale: snapshot.scale * popScale,
                alpha: previousAlpha,
                isPressed: snapshot.isPressed,
                accent: snapshot.accent,
                baseColor: snapshot.baseColor,
                pivotLocal: isArrowLike(previous) ? snapshot.pivotLocal : .zero,
                caretPhase: snapshot.caretPhase,
                in: context
            )
            drawGlyph(
                snapshot.glyph,
                position: isArrowLike(snapshot.glyph) ? snapshot.position : tipScreen,
                tipScreen: tipScreen,
                angle: effectiveAngle,
                scale: snapshot.scale * popScale,
                alpha: nextAlpha,
                isPressed: snapshot.isPressed,
                accent: snapshot.accent,
                baseColor: snapshot.baseColor,
                pivotLocal: isArrowLike(snapshot.glyph) ? snapshot.pivotLocal : .zero,
                caretPhase: snapshot.caretPhase,
                in: context
            )
        } else {
            drawGlyph(
                snapshot.glyph,
                position: isArrowLike(snapshot.glyph) ? snapshot.position : tipScreen,
                tipScreen: tipScreen,
                angle: effectiveAngle,
                scale: snapshot.scale,
                alpha: snapshot.alpha,
                isPressed: snapshot.isPressed,
                accent: snapshot.accent,
                baseColor: snapshot.baseColor,
                pivotLocal: isArrowLike(snapshot.glyph) ? snapshot.pivotLocal : .zero,
                caretPhase: snapshot.caretPhase,
                in: context
            )
        }

        drawLabel(
            text: snapshot.labelText,
            anchor: tipScreen,
            glyphScale: snapshot.scale,
            labelAlpha: snapshot.labelAlpha * snapshot.alpha,
            labelScale: snapshot.labelScale,
            color: snapshot.accent.fill,
            in: context
        )

        for effect in snapshot.effects {
            draw(effect, in: context)
        }
    }

    private static func morphScale(_ progress: CGFloat) -> CGFloat {
        let s = sin(progress * .pi)
        return 1 + s * 0.12
    }

    private static func drawTrail(
        histories: [[CGPoint]],
        color: NSColor,
        alpha: CGFloat,
        in context: CGContext
    ) {
        context.saveGState()
        for (index, history) in histories.enumerated() where history.count > 1 {
            let path = smoothPath(points: history)
            let trailAlpha = max(0.04, 0.22 - CGFloat(index) * 0.032) * alpha
            let width = max(0.9, 1.8 - CGFloat(index) * 0.14)
            let stroke = index.isMultiple(of: 2)
                ? NSColor.white.withAlphaComponent(trailAlpha * 1.1)
                : color.withAlphaComponent(trailAlpha * 0.9)
            context.addPath(path)
            context.setStrokeColor(stroke.cgColor)
            context.setLineWidth(width)
            context.setLineCap(.round)
            context.setLineJoin(.round)
            context.strokePath()
        }
        context.restoreGState()
    }

    private static func drawGlyph(
        _ glyph: CursorGlyph,
        position: CGPoint,
        tipScreen: CGPoint,
        angle: CGFloat,
        scale: CGFloat,
        alpha: CGFloat,
        isPressed: Bool,
        accent: CursorAccentPalette,
        baseColor: NSColor,
        pivotLocal: CGPoint,
        caretPhase: CGFloat,
        in context: CGContext
    ) {
        switch glyph {
        case .arrow:
            drawArrow(at: position, angle: angle, scale: scale, alpha: alpha, pressed: isPressed, color: baseColor, pivotLocal: pivotLocal, in: context)
        case .arrowWithBadge:
            drawArrow(at: position, angle: angle, scale: scale, alpha: alpha, pressed: isPressed, color: baseColor, pivotLocal: pivotLocal, in: context)
            drawBadge(tipScreen: tipScreen, scale: scale, alpha: alpha, color: accent.fill, in: context)
        case let .chevronPill(axis, direction):
            drawChevronPill(at: position, axis: axis, direction: direction, scale: scale, alpha: alpha, accent: accent, in: context)
        case let .keycap(label):
            drawArrow(at: position, angle: angle, scale: scale * 0.85, alpha: alpha * 0.6, pressed: isPressed, color: baseColor, pivotLocal: .zero, in: context)
            drawKeycap(at: position, label: label, scale: scale, alpha: alpha, pressed: isPressed, accent: accent, in: context)
        case .crosshair:
            drawCrosshair(at: position, angle: angle, scale: scale, alpha: alpha, accent: accent, in: context)
        case .ibeam:
            drawIBeam(at: position, scale: scale, alpha: alpha, color: accent.fill, in: context)
        case .caret:
            drawCaret(at: position, scale: scale, alpha: alpha, caretPhase: caretPhase, color: accent.fill, in: context)
        }
    }

    private static func drawArrow(
        at position: CGPoint,
        angle: CGFloat,
        scale: CGFloat,
        alpha: CGFloat,
        pressed: Bool,
        color: NSColor,
        pivotLocal: CGPoint,
        in context: CGContext
    ) {
        let clamped = max(0.5, min(scale, 1.8))
        let fillAlpha = alpha * (pressed ? 0.78 : 1)
        let strokeAlpha = min(1, fillAlpha * 1.08)

        var transform = CGAffineTransform(translationX: position.x, y: position.y)
            .rotated(by: angle + CursorMotionConstants.drawAngleOffset)
            .scaledBy(x: clamped, y: clamped)
            .translatedBy(x: -pivotLocal.x, y: -pivotLocal.y)

        let raw = CursorGlyphs.arrowPath()
        guard let arrow = raw.copy(using: &transform) else { return }

        context.saveGState()
        context.setShadow(
            offset: CGSize(width: 0, height: 1),
            blur: 4.5,
            color: NSColor.black.withAlphaComponent(0.22 * fillAlpha).cgColor
        )
        context.addPath(arrow)
        context.setFillColor(color.withAlphaComponent(fillAlpha).cgColor)
        context.fillPath()
        context.restoreGState()

        context.addPath(arrow)
        context.setStrokeColor(NSColor.white.withAlphaComponent(strokeAlpha * 0.94).cgColor)
        context.setLineWidth(2.4 * clamped)
        context.setLineJoin(.round)
        context.setLineCap(.round)
        context.strokePath()

        context.addPath(arrow)
        context.setFillColor(color.withAlphaComponent(fillAlpha).cgColor)
        context.fillPath()
    }

    private static func drawBadge(
        tipScreen: CGPoint,
        scale: CGFloat,
        alpha: CGFloat,
        color: NSColor,
        in context: CGContext
    ) {
        let clamped = max(0.5, min(scale, 1.8))
        let center = CGPoint(
            x: tipScreen.x - 14 * clamped,
            y: tipScreen.y + 6 * clamped
        )
        context.saveGState()
        context.setFillColor(color.withAlphaComponent(alpha).cgColor)
        for index in 0..<3 {
            let cx = center.x + CGFloat(index - 1) * 4 * clamped
            context.addEllipse(in: CGRect(x: cx - 1.6, y: center.y - 1.6, width: 3.2, height: 3.2))
        }
        context.fillPath()
        context.restoreGState()
    }

    private static func drawChevronPill(
        at position: CGPoint,
        axis: CursorScrollAxis,
        direction: CursorScrollDirection,
        scale: CGFloat,
        alpha: CGFloat,
        accent: CursorAccentPalette,
        in context: CGContext
    ) {
        let clamped = max(0.5, min(scale, 1.8))
        var transform = CGAffineTransform(translationX: position.x, y: position.y)
            .scaledBy(x: clamped, y: clamped)
        guard let pill = CursorGlyphs.chevronPillPath(axis: axis).copy(using: &transform) else { return }

        context.saveGState()
        context.setShadow(
            offset: CGSize(width: 0, height: 1.4),
            blur: 6,
            color: NSColor.black.withAlphaComponent(0.24 * alpha).cgColor
        )
        context.addPath(pill)
        context.setFillColor(accent.fill.withAlphaComponent(alpha * 0.95).cgColor)
        context.fillPath()
        context.restoreGState()

        context.addPath(pill)
        context.setStrokeColor(NSColor.white.withAlphaComponent(alpha * 0.92).cgColor)
        context.setLineWidth(1.6 * clamped)
        context.strokePath()

        var innerTransform = CGAffineTransform(translationX: position.x, y: position.y)
            .scaledBy(x: clamped * 1.2, y: clamped * 1.2)
        guard let chevron = CursorGlyphs.chevronInnerPath(axis: axis, direction: direction).copy(using: &innerTransform) else { return }
        context.addPath(chevron)
        context.setStrokeColor(NSColor.white.withAlphaComponent(alpha).cgColor)
        context.setLineWidth(2.2 * clamped)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        context.strokePath()
    }

    private static func drawKeycap(
        at position: CGPoint,
        label: String,
        scale: CGFloat,
        alpha: CGFloat,
        pressed: Bool,
        accent: CursorAccentPalette,
        in context: CGContext
    ) {
        let clamped = max(0.55, min(scale, 1.8))
        let rect = CursorGlyphs.keycapRect(label: label)
        let pressYOffset: CGFloat = pressed ? 2 : 0

        var transform = CGAffineTransform(translationX: position.x, y: position.y + pressYOffset)
            .scaledBy(x: clamped, y: clamped)
        guard let cap = CursorGlyphs.keycapPath(label: label).copy(using: &transform) else { return }

        context.saveGState()
        context.setShadow(
            offset: CGSize(width: 0, height: 2 - pressYOffset),
            blur: 6,
            color: NSColor.black.withAlphaComponent(0.32 * alpha).cgColor
        )
        context.addPath(cap)
        context.setFillColor(accent.fill.withAlphaComponent(alpha).cgColor)
        context.fillPath()
        context.restoreGState()

        context.addPath(cap)
        context.setStrokeColor(NSColor.white.withAlphaComponent(alpha * 0.9).cgColor)
        context.setLineWidth(1.4 * clamped)
        context.strokePath()

        let font = NSFont.systemFont(ofSize: 12 * clamped, weight: .semibold)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.white.withAlphaComponent(alpha),
        ]
        let text = NSString(string: label.isEmpty ? "K" : label)
        let size = text.size(withAttributes: attributes)
        let center = CGPoint(
            x: position.x + rect.midX * clamped - size.width / 2,
            y: position.y + rect.midY * clamped - size.height / 2 + pressYOffset
        )
        let state = NSGraphicsContext.current
        let nsContext = NSGraphicsContext(cgContext: context, flipped: false)
        NSGraphicsContext.current = nsContext
        text.draw(at: center, withAttributes: attributes)
        NSGraphicsContext.current = state
    }

    private static func drawCrosshair(
        at position: CGPoint,
        angle: CGFloat,
        scale: CGFloat,
        alpha: CGFloat,
        accent: CursorAccentPalette,
        in context: CGContext
    ) {
        let clamped = max(0.5, min(scale, 1.8))
        var transform = CGAffineTransform(translationX: position.x, y: position.y)
            .rotated(by: angle * 0.1)
            .scaledBy(x: clamped, y: clamped)
        guard let crosshair = CursorGlyphs.crosshairPath().copy(using: &transform) else { return }

        context.saveGState()
        context.setShadow(
            offset: CGSize(width: 0, height: 1),
            blur: 4,
            color: NSColor.black.withAlphaComponent(0.2 * alpha).cgColor
        )
        context.addPath(crosshair)
        context.setFillColor(accent.fill.withAlphaComponent(alpha).cgColor)
        context.fillPath()
        context.restoreGState()

        context.addPath(crosshair)
        context.setStrokeColor(NSColor.white.withAlphaComponent(alpha * 0.85).cgColor)
        context.setLineWidth(0.8 * clamped)
        context.strokePath()

        let ringRadius: CGFloat = 14 * clamped
        context.setStrokeColor(accent.fill.withAlphaComponent(alpha * 0.55).cgColor)
        context.setLineWidth(1.0 * clamped)
        context.addArc(center: position, radius: ringRadius, startAngle: 0, endAngle: .pi * 2, clockwise: false)
        context.strokePath()
    }

    private static func drawIBeam(
        at position: CGPoint,
        scale: CGFloat,
        alpha: CGFloat,
        color: NSColor,
        in context: CGContext
    ) {
        let clamped = max(0.5, min(scale, 1.8))
        var transform = CGAffineTransform(translationX: position.x, y: position.y)
            .scaledBy(x: clamped, y: clamped)
        guard let beam = CursorGlyphs.iBeamPath().copy(using: &transform) else { return }

        context.saveGState()
        context.setShadow(
            offset: CGSize(width: 0, height: 1),
            blur: 3,
            color: NSColor.black.withAlphaComponent(0.25 * alpha).cgColor
        )
        context.addPath(beam)
        context.setFillColor(color.withAlphaComponent(alpha).cgColor)
        context.fillPath()
        context.restoreGState()

        context.addPath(beam)
        context.setStrokeColor(NSColor.white.withAlphaComponent(alpha * 0.85).cgColor)
        context.setLineWidth(0.6 * clamped)
        context.strokePath()
    }

    private static func drawCaret(
        at position: CGPoint,
        scale: CGFloat,
        alpha: CGFloat,
        caretPhase: CGFloat,
        color: NSColor,
        in context: CGContext
    ) {
        let clamped = max(0.5, min(scale, 1.8))
        let visible: CGFloat = caretPhase < 0.5 ? 1 : 0
        let fadedAlpha = alpha * (0.2 + visible * 0.8)

        var transform = CGAffineTransform(translationX: position.x, y: position.y)
            .scaledBy(x: clamped, y: clamped)
        guard let caret = CursorGlyphs.caretPath().copy(using: &transform) else { return }

        context.saveGState()
        context.setShadow(offset: .zero, blur: 6, color: color.withAlphaComponent(0.6 * fadedAlpha).cgColor)
        context.addPath(caret)
        context.setFillColor(color.withAlphaComponent(fadedAlpha).cgColor)
        context.fillPath()
        context.restoreGState()
    }

    private static func drawLabel(
        text: String,
        anchor: CGPoint,
        glyphScale: CGFloat,
        labelAlpha: CGFloat,
        labelScale: CGFloat,
        color: NSColor,
        in context: CGContext
    ) {
        guard text.isEmpty == false, labelAlpha > 0.01 else { return }
        let clamped = max(0.55, min(glyphScale, 1.8))
        let fontSize = max(8, 10 * clamped)
        let font = NSFont.systemFont(ofSize: fontSize, weight: .medium)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.white.withAlphaComponent(labelAlpha),
        ]
        let nsText = NSString(string: text)
        let textSize = nsText.size(withAttributes: attributes)
        let padding: CGFloat = 10 * clamped
        let height: CGFloat = 18 * clamped
        let pillWidth = textSize.width + padding
        let baseRect = CGRect(
            x: anchor.x + 13 * clamped,
            y: anchor.y - 12 * clamped - height + 2,
            width: pillWidth,
            height: height
        )

        let pivot = anchor
        context.saveGState()
        context.translateBy(x: pivot.x, y: pivot.y)
        context.scaleBy(x: labelScale, y: labelScale)
        context.translateBy(x: -pivot.x, y: -pivot.y)

        context.setShadow(
            offset: CGSize(width: 0, height: 1),
            blur: 3,
            color: NSColor.black.withAlphaComponent(0.16 * labelAlpha).cgColor
        )
        let pill = CGPath(
            roundedRect: baseRect,
            cornerWidth: 4 * clamped,
            cornerHeight: 4 * clamped,
            transform: nil
        )
        context.addPath(pill)
        context.setFillColor(color.withAlphaComponent(labelAlpha).cgColor)
        context.fillPath()

        let state = NSGraphicsContext.current
        let nsContext = NSGraphicsContext(cgContext: context, flipped: false)
        NSGraphicsContext.current = nsContext
        nsText.draw(
            at: CGPoint(x: baseRect.minX + padding / 2, y: baseRect.minY + (baseRect.height - textSize.height) / 2),
            withAttributes: attributes
        )
        NSGraphicsContext.current = state

        context.restoreGState()
    }

    private static func draw(_ effect: CursorVisualEffect, in context: CGContext) {
        switch effect {
        case let .ripple(origin, color, maxRadius, thickness, _, _):
            let t = effect.progress
            let eased = cursorEaseOutCubic(t)
            let radius = maxRadius * eased
            let alpha = (1 - t) * 0.55
            context.saveGState()
            context.setStrokeColor(color.withAlphaComponent(alpha).cgColor)
            context.setLineWidth(thickness * (1 - t * 0.65))
            context.addArc(center: origin, radius: radius, startAngle: 0, endAngle: .pi * 2, clockwise: false)
            context.strokePath()
            context.restoreGState()

        case let .doubleRipple(origin, color, _, _):
            let t = effect.progress
            for index in 0..<2 {
                let delay = CGFloat(index) * 0.22
                let local = max(0, t - delay)
                guard local > 0 else { continue }
                let normalized = min(1, local / (1 - delay))
                let eased = cursorEaseOutCubic(normalized)
                let radius: CGFloat = 5 + eased * (30 - CGFloat(index) * 6)
                let alpha = (1 - normalized) * 0.55
                context.saveGState()
                context.setStrokeColor(color.withAlphaComponent(alpha).cgColor)
                context.setLineWidth(1.3 - CGFloat(index) * 0.3)
                context.addArc(center: origin, radius: radius, startAngle: 0, endAngle: .pi * 2, clockwise: false)
                context.strokePath()
                context.restoreGState()
            }

        case let .chevronStreak(origin, axis, direction, color, speed, _, _):
            let t = effect.progress
            let alpha = (1 - t) * 0.85
            let travel = speed * CGFloat(effect.age)
            let directionSign: CGFloat = direction == .positive ? 1 : -1
            let signedAxisSign = axis == .vertical ? -directionSign : directionSign

            context.saveGState()
            context.setLineWidth(2.2)
            context.setLineCap(.round)
            context.setLineJoin(.round)

            for index in 0..<3 {
                let offset = CGFloat(index) * 14 + travel
                let alphaI = alpha * (1 - CGFloat(index) * 0.25)
                context.setStrokeColor(color.withAlphaComponent(alphaI).cgColor)
                let path = CGMutablePath()
                switch axis {
                case .vertical:
                    let y = origin.y + offset * signedAxisSign
                    path.move(to: CGPoint(x: origin.x - 6, y: y - 3 * signedAxisSign))
                    path.addLine(to: CGPoint(x: origin.x, y: y + 3 * signedAxisSign))
                    path.addLine(to: CGPoint(x: origin.x + 6, y: y - 3 * signedAxisSign))
                case .horizontal:
                    let x = origin.x + offset * signedAxisSign
                    path.move(to: CGPoint(x: x - 3 * signedAxisSign, y: origin.y - 6))
                    path.addLine(to: CGPoint(x: x + 3 * signedAxisSign, y: origin.y))
                    path.addLine(to: CGPoint(x: x - 3 * signedAxisSign, y: origin.y + 6))
                }
                context.addPath(path)
                context.strokePath()
            }
            context.restoreGState()

        case let .puff(origin, drift, color, radius, _, _):
            let t = effect.progress
            let x = origin.x + drift.dx * t * 18
            let y = origin.y + drift.dy * t * 18
            let r = radius * (1 + t * 1.2)
            let alpha = (1 - t) * 0.6
            context.saveGState()
            context.setFillColor(color.withAlphaComponent(alpha).cgColor)
            context.addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: 0, endAngle: .pi * 2, clockwise: false)
            context.fillPath()
            context.restoreGState()

        case let .glowPulse(origin, color, _, _):
            let t = effect.progress
            let eased = cursorEaseOutQuint(t)
            let radius: CGFloat = 6 + eased * 22
            let alpha = (1 - t) * 0.28
            guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { return }
            let cgColor = color.withAlphaComponent(alpha).cgColor
            let clear = color.withAlphaComponent(0).cgColor
            guard let gradient = CGGradient(
                colorsSpace: colorSpace,
                colors: [cgColor, clear] as CFArray,
                locations: [0, 1]
            ) else { return }

            context.saveGState()
            context.setBlendMode(.normal)
            context.drawRadialGradient(
                gradient,
                startCenter: origin,
                startRadius: 0,
                endCenter: origin,
                endRadius: radius,
                options: [.drawsAfterEndLocation]
            )
            context.restoreGState()

        case let .sparkRing(origin, color, count, _, _, rngSeed):
            let t = effect.progress
            let eased = cursorEaseOutQuint(t)
            let travel: CGFloat = 3 + eased * 20
            let alpha = (1 - t) * 0.55

            context.saveGState()
            context.setFillColor(color.withAlphaComponent(alpha).cgColor)
            for index in 0..<count {
                let fraction = CGFloat(index) / CGFloat(count)
                let jitter = CGFloat((rngSeed &+ UInt64(index)) % 100) / 100
                let angle = fraction * .pi * 2 + jitter * 0.4
                let radius = travel * (0.78 + jitter * 0.34)
                let x = origin.x + cos(angle) * radius
                let y = origin.y + sin(angle) * radius
                let size: CGFloat = 1.5 * (1 - t * 0.7)
                context.addEllipse(in: CGRect(x: x - size, y: y - size, width: size * 2, height: size * 2))
            }
            context.fillPath()
            context.restoreGState()
        }
    }

    private static func smoothPath(points: [CGPoint]) -> CGPath {
        let path = CGMutablePath()
        guard let first = points.first else { return path }
        path.move(to: first)
        guard points.count > 1 else { return path }

        if points.count == 2 {
            path.addLine(to: points[1])
            return path
        }

        for index in 0..<(points.count - 1) {
            let p0 = index > 0 ? points[index - 1] : points[index]
            let p1 = points[index]
            let p2 = points[index + 1]
            let p3 = index + 2 < points.count ? points[index + 2] : p2
            let control1 = CGPoint(
                x: p1.x + (p2.x - p0.x) / 6,
                y: p1.y + (p2.y - p0.y) / 6
            )
            let control2 = CGPoint(
                x: p2.x - (p3.x - p1.x) / 6,
                y: p2.y - (p3.y - p1.y) / 6
            )
            path.addCurve(to: p2, control1: control1, control2: control2)
        }
        return path
    }
}

enum CursorGlyphs {
    static func arrowPath() -> CGPath {
        let path = CGMutablePath()
        path.move(to: CGPoint(x: 0, y: 0))
        path.addLine(to: CGPoint(x: 0.8, y: -14))
        path.addLine(to: CGPoint(x: -2.8, y: -11.2))
        path.addLine(to: CGPoint(x: -9.2, y: -10))
        path.closeSubpath()
        return path
    }

    static func iBeamPath() -> CGPath {
        let path = CGMutablePath()
        let topY: CGFloat = -2
        let bottomY: CGFloat = 18
        let halfCap: CGFloat = 4
        let stroke: CGFloat = 1.6
        path.addRect(CGRect(x: -stroke / 2, y: topY, width: stroke, height: bottomY - topY))
        path.addRect(CGRect(x: -halfCap, y: topY - 0.8, width: halfCap * 2, height: 1.6))
        path.addRect(CGRect(x: -halfCap, y: bottomY - 0.8, width: halfCap * 2, height: 1.6))
        return path
    }

    static func caretPath() -> CGPath {
        let path = CGMutablePath()
        path.addRoundedRect(
            in: CGRect(x: -0.9, y: -2, width: 1.8, height: 20),
            cornerWidth: 0.9,
            cornerHeight: 0.9
        )
        return path
    }

    static func crosshairPath() -> CGPath {
        let path = CGMutablePath()
        let reach: CGFloat = 11
        let gap: CGFloat = 3.5
        let thick: CGFloat = 1.6
        path.addRect(CGRect(x: -thick / 2, y: -reach, width: thick, height: reach - gap))
        path.addRect(CGRect(x: -thick / 2, y: gap, width: thick, height: reach - gap))
        path.addRect(CGRect(x: -reach, y: -thick / 2, width: reach - gap, height: thick))
        path.addRect(CGRect(x: gap, y: -thick / 2, width: reach - gap, height: thick))
        path.addEllipse(in: CGRect(x: -2, y: -2, width: 4, height: 4))
        return path
    }

    static func keycapRect(label: String) -> CGRect {
        let font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        let text = NSString(string: label.isEmpty ? "K" : label)
        let size = text.size(withAttributes: [.font: font])
        let width = max(26, size.width + 14)
        let height: CGFloat = 24
        return CGRect(x: -width / 2, y: -height - 6, width: width, height: height)
    }

    static func keycapPath(label: String) -> CGPath {
        let rect = keycapRect(label: label)
        return CGPath(roundedRect: rect, cornerWidth: 6, cornerHeight: 6, transform: nil)
    }

    static func chevronPillRect(axis: CursorScrollAxis) -> CGRect {
        switch axis {
        case .vertical:
            return CGRect(x: -9, y: -14, width: 18, height: 28)
        case .horizontal:
            return CGRect(x: -14, y: -9, width: 28, height: 18)
        }
    }

    static func chevronPillPath(axis: CursorScrollAxis) -> CGPath {
        let rect = chevronPillRect(axis: axis)
        let radius = min(rect.width, rect.height) / 2
        return CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    }

    static func chevronInnerPath(axis: CursorScrollAxis, direction: CursorScrollDirection) -> CGPath {
        let path = CGMutablePath()
        switch axis {
        case .vertical:
            let sign: CGFloat = direction == .positive ? -1 : 1
            path.move(to: CGPoint(x: -4, y: 2 * sign))
            path.addLine(to: CGPoint(x: 0, y: -2 * sign))
            path.addLine(to: CGPoint(x: 4, y: 2 * sign))
        case .horizontal:
            let sign: CGFloat = direction == .positive ? 1 : -1
            path.move(to: CGPoint(x: -2 * sign, y: -4))
            path.addLine(to: CGPoint(x: 2 * sign, y: 0))
            path.addLine(to: CGPoint(x: -2 * sign, y: 4))
        }
        return path
    }
}
