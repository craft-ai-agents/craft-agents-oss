import AppKit
import Foundation

enum AXCursorTargeting {
    static func notAttempted(
        requested: CursorRequestDTO?,
        reason: String,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        cursorResponse(
            requested: requested,
            options: options,
            targetPointAppKit: nil,
            targetPointSource: nil,
            moved: false,
            moveDurationMs: nil,
            movement: options.visualCursorEnabled ? "not_attempted" : "disabled",
            warnings: [reason]
        )
    }

    static func moveToTarget(
        requested: CursorRequestDTO?,
        target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        prepareTargetedCursor(
            requested: requested,
            target: target,
            window: window,
            movement: "approach",
            options: options
        ) { point, windowNumber, cursorID in
            let duration = CursorRuntime.approach(
                to: point,
                attachedWindowNumber: windowNumber,
                cursorID: cursorID
            )
            CursorRuntime.waitUntilSettled(cursorID: cursorID, timeout: duration + 0.35)
            return duration
        }
    }

    static func prepareClick(
        requested: CursorRequestDTO?,
        target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        prepareTargetedCursor(
            requested: requested,
            target: target,
            window: window,
            movement: "approach_click_choreography",
            options: options
        ) { point, windowNumber, cursorID in
            let duration = CursorRuntime.approach(
                to: point,
                attachedWindowNumber: windowNumber,
                cursorID: cursorID
            )
            CursorRuntime.waitUntilSettled(cursorID: cursorID, timeout: duration + 0.35)
            CursorRuntime.setPressed(true, cursorID: cursorID, attachedWindowNumber: windowNumber)
            sleepRunLoop(CursorRuntime.pressLeadDuration())
            return duration
        }
    }

    static func prepareClick(
        requested: CursorRequestDTO?,
        pointAppKit: CGPoint,
        targetPointSource: String,
        window: ResolvedWindowDTO,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        var warnings: [String] = []
        let point = clampVisualPoint(pointAppKit, window: window, warnings: &warnings)
        guard options.visualCursorEnabled else {
            return cursorResponse(
                requested: requested,
                options: options,
                targetPointAppKit: PointDTO(x: point.x, y: point.y),
                targetPointSource: targetPointSource,
                moved: false,
                moveDurationMs: nil,
                movement: "disabled",
                warnings: warnings
            )
        }

        let session = CursorRuntime.resolve(requested: requested)
        let duration = CursorRuntime.approach(
            to: point,
            attachedWindowNumber: window.windowNumber,
            cursorID: session.id
        )
        CursorRuntime.waitUntilSettled(cursorID: session.id, timeout: duration + 0.35)
        CursorRuntime.setPressed(true, cursorID: session.id, attachedWindowNumber: window.windowNumber)
        sleepRunLoop(CursorRuntime.pressLeadDuration())

        return ActionCursorTargetResponseDTO(
            session: session,
            targetPointAppKit: PointDTO(x: point.x, y: point.y),
            targetPointSource: targetPointSource,
            moved: true,
            moveDurationMs: sanitizedJSONDouble(duration * 1_000),
            movement: "approach_click_choreography",
            warnings: warnings
        )
    }

    static func finishClick(cursor: ActionCursorTargetResponseDTO) {
        guard cursor.moved else { return }
        CursorRuntime.finishClick(cursorID: cursor.session.id, afterHold: CursorRuntime.releaseHoldDuration())
    }

    static func prepareSecondaryAction(
        requested: CursorRequestDTO?,
        target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        prepareTargetedCursor(
            requested: requested,
            target: target,
            window: window,
            movement: "approach_secondary_choreography",
            options: options
        ) { point, windowNumber, cursorID in
            CursorRuntime.prepareSecondaryAction(to: point, attachedWindowNumber: windowNumber, cursorID: cursorID)
        }
    }

    static func finishSecondaryAction(cursor: ActionCursorTargetResponseDTO) {
        guard cursor.moved else { return }
        CursorRuntime.finishSecondaryAction(cursorID: cursor.session.id)
    }

    static func prepareScroll(
        requested: CursorRequestDTO?,
        target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO,
        direction: ScrollDirectionDTO,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        let mapped = cursorScrollMapping(for: direction)
        return prepareTargetedCursor(
            requested: requested,
            target: target,
            window: window,
            movement: "approach_scroll_choreography",
            options: options
        ) { point, windowNumber, cursorID in
            CursorRuntime.prepareScroll(
                to: point,
                axis: mapped.axis,
                direction: mapped.direction,
                attachedWindowNumber: windowNumber,
                cursorID: cursorID
            )
        }
    }

    static func finishScroll(cursor: ActionCursorTargetResponseDTO) {
        guard cursor.moved else { return }
        CursorRuntime.finishScroll(cursorID: cursor.session.id)
    }

    static func prepareSetValue(
        requested: CursorRequestDTO?,
        target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        prepareTargetedCursor(
            requested: requested,
            target: target,
            window: window,
            movement: "approach_set_value_choreography",
            options: options
        ) { point, windowNumber, cursorID in
            CursorRuntime.prepareSetValue(to: point, attachedWindowNumber: windowNumber, cursorID: cursorID)
        }
    }

    static func finishSetValue(cursor: ActionCursorTargetResponseDTO) {
        guard cursor.moved else { return }
        CursorRuntime.finishSetValue(cursorID: cursor.session.id)
    }

    static func prepareTypeText(
        requested: CursorRequestDTO?,
        target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        prepareTargetedCursor(
            requested: requested,
            target: target,
            window: window,
            movement: "approach_type_text_choreography",
            options: options
        ) { point, windowNumber, cursorID in
            CursorRuntime.prepareTypeText(to: point, attachedWindowNumber: windowNumber, cursorID: cursorID)
        }
    }

    static func finishTypeText(cursor: ActionCursorTargetResponseDTO, text: String) {
        guard cursor.moved else { return }
        CursorRuntime.finishTypeText(cursorID: cursor.session.id, text: text)
    }

    static func preparePressKey(
        requested: CursorRequestDTO?,
        window: ResolvedWindowDTO,
        keyLabel: String,
        options: ActionExecutionOptions = .visualCursorEnabled
    ) -> ActionCursorTargetResponseDTO {
        let point = pressKeyAnchor(in: window)
        guard options.visualCursorEnabled else {
            return cursorResponse(
                requested: requested,
                options: options,
                targetPointAppKit: PointDTO(x: point.x, y: point.y),
                targetPointSource: "window_titlebar_keyboard_anchor",
                moved: false,
                moveDurationMs: nil,
                movement: "disabled",
                warnings: []
            )
        }

        let session = CursorRuntime.resolve(requested: requested)
        let duration = CursorRuntime.preparePressKey(
            to: point,
            label: keyLabel,
            attachedWindowNumber: window.windowNumber,
            cursorID: session.id
        )

        return ActionCursorTargetResponseDTO(
            session: session,
            targetPointAppKit: PointDTO(x: point.x, y: point.y),
            targetPointSource: "window_titlebar_keyboard_anchor",
            moved: true,
            moveDurationMs: sanitizedJSONDouble(duration * 1_000),
            movement: "approach_press_key_choreography",
            warnings: []
        )
    }

    static func finishPressKey(cursor: ActionCursorTargetResponseDTO) {
        guard cursor.moved else { return }
        CursorRuntime.finishPressKey(cursorID: cursor.session.id)
    }

    private static func prepareTargetedCursor(
        requested: CursorRequestDTO?,
        target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO,
        movement: String,
        options: ActionExecutionOptions,
        prepare: (CGPoint, Int, String) -> TimeInterval
    ) -> ActionCursorTargetResponseDTO {
        guard options.visualCursorEnabled else {
            let resolvedPoint = targetPoint(for: target, window: window)
            guard let point = resolvedPoint.point else {
                return cursorResponse(
                    requested: requested,
                    options: options,
                    targetPointAppKit: nil,
                    targetPointSource: nil,
                    moved: false,
                    moveDurationMs: nil,
                    movement: "disabled",
                    warnings: resolvedPoint.warnings
                )
            }

            return cursorResponse(
                requested: requested,
                options: options,
                targetPointAppKit: PointDTO(x: point.x, y: point.y),
                targetPointSource: resolvedPoint.source,
                moved: false,
                moveDurationMs: nil,
                movement: "disabled",
                warnings: resolvedPoint.warnings
            )
        }

        let session = CursorRuntime.resolve(requested: requested)
        let resolvedPoint = visualTargetPoint(
            for: target,
            window: window,
            previousPoint: CursorRuntime.currentPosition(cursorID: session.id)
        )

        guard let point = resolvedPoint.point else {
            return ActionCursorTargetResponseDTO(
                session: session,
                targetPointAppKit: nil,
                targetPointSource: nil,
                moved: false,
                moveDurationMs: nil,
                movement: "no_target_point",
                warnings: resolvedPoint.warnings
            )
        }

        let duration = prepare(point, window.windowNumber, session.id)

        return ActionCursorTargetResponseDTO(
            session: session,
            targetPointAppKit: PointDTO(x: point.x, y: point.y),
            targetPointSource: resolvedPoint.source,
            moved: true,
            moveDurationMs: sanitizedJSONDouble(duration * 1_000),
            movement: movement,
            warnings: resolvedPoint.warnings
        )
    }

    private static func cursorResponse(
        requested: CursorRequestDTO?,
        options: ActionExecutionOptions,
        targetPointAppKit: PointDTO?,
        targetPointSource: String?,
        moved: Bool,
        moveDurationMs: Double?,
        movement: String,
        warnings: [String]
    ) -> ActionCursorTargetResponseDTO {
        ActionCursorTargetResponseDTO(
            session: options.visualCursorEnabled
                ? CursorRuntime.resolve(requested: requested)
                : disabledSession(requested: requested),
            targetPointAppKit: targetPointAppKit,
            targetPointSource: targetPointSource,
            moved: moved,
            moveDurationMs: moveDurationMs,
            movement: movement,
            warnings: warnings
        )
    }

    static func disabledSession(requested: CursorRequestDTO?) -> CursorResponseDTO {
        CursorResponseDTO(
            id: normalizedCursorID(requested?.id) ?? "visual-cursor-disabled",
            name: normalizedCursorName(requested?.name) ?? "Visual Cursor Disabled",
            color: normalizedCursorHex(requested?.color) ?? "#7A7A7A",
            reused: true
        )
    }

    static func targetPoint(
        for target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO
    ) -> (point: CGPoint?, source: String?, warnings: [String]) {
        var warnings: [String] = []
        let rawCandidate: (point: CGPoint, source: String)? =
            target.suggestedInteractionPointAppKit.map { (cgPoint(from: $0), "suggested_interaction_point") } ??
            target.activationPointAppKit.map { (cgPoint(from: $0), "activation_point") } ??
            target.frameAppKit.map { (rect(from: $0).center, "frame_center") }

        guard let rawCandidate else {
            return (nil, nil, ["Target node had no suggested point, activation point, or frame center for cursor movement."])
        }

        var point = rawCandidate.point
        guard point.x.isFinite, point.y.isFinite else {
            return (nil, rawCandidate.source, ["Target point was not finite."])
        }

        let windowFrame = rect(from: window.frameAppKit).standardized
        if windowFrame.isNull == false, windowFrame.width > 0, windowFrame.height > 0,
           windowFrame.insetBy(dx: -2, dy: -2).contains(point) == false {
            warnings.append("Cursor target point was outside the resolved window frame and was clamped to the window.")
            point = clamp(point, to: windowFrame.insetBy(dx: 1, dy: 1))
        }

        if let screen = DesktopGeometry.screenContaining(point: point) ?? DesktopGeometry.screenMatching(frame: windowFrame) {
            let screenFrame = screen.frame.standardized
            if screenFrame.insetBy(dx: -1, dy: -1).contains(point) == false {
                warnings.append("Cursor target point was outside visible screen geometry and was clamped to the nearest matching screen.")
                point = clamp(point, to: screenFrame.insetBy(dx: 1, dy: 1))
            }
        } else {
            warnings.append("No screen geometry was available for cursor target sanity-checking.")
        }

        return (point, rawCandidate.source, warnings)
    }

    private static func visualTargetPoint(
        for target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO,
        previousPoint: CGPoint?
    ) -> (point: CGPoint?, source: String?, warnings: [String]) {
        var resolved = targetPoint(for: target, window: window)
        guard let previousPoint,
              let frameDTO = target.frameAppKit,
              let basePoint = resolved.point else {
            return resolved
        }

        let frame = rect(from: frameDTO).standardized
        guard frame.width >= 72 || frame.height >= 72 else {
            return resolved
        }

        let insetX = min(max(frame.width * 0.08, 18), max(frame.width / 2 - 1, 1))
        let insetY = min(max(frame.height * 0.08, 18), max(frame.height / 2 - 1, 1))
        let inner = frame.insetBy(dx: insetX, dy: insetY).standardized
        guard inner.width > 8, inner.height > 8 else {
            return resolved
        }

        var candidates: [CGPoint] = [
            CGPoint(x: inner.minX, y: inner.minY),
            CGPoint(x: inner.midX, y: inner.minY),
            CGPoint(x: inner.maxX, y: inner.minY),
            CGPoint(x: inner.minX, y: inner.midY),
            CGPoint(x: inner.midX, y: inner.midY),
            CGPoint(x: inner.maxX, y: inner.midY),
            CGPoint(x: inner.minX, y: inner.maxY),
            CGPoint(x: inner.midX, y: inner.maxY),
            CGPoint(x: inner.maxX, y: inner.maxY),
        ]
        for _ in 0..<6 {
            candidates.append(
                CGPoint(
                    x: CGFloat.random(in: inner.minX...inner.maxX),
                    y: CGFloat.random(in: inner.minY...inner.maxY)
                )
            )
        }

        let scoredCandidates = candidates.map { point in
            (point: point, score: point.distance(to: previousPoint) + CGFloat.random(in: 0...16))
        }
        guard let chosen = scoredCandidates.max(by: { $0.score < $1.score })?.point else {
            return resolved
        }

        if chosen.distance(to: basePoint) >= 8 {
            resolved.point = clampVisualPoint(chosen, window: window, warnings: &resolved.warnings)
            resolved.source = [resolved.source, "visual_interest_offset"]
                .compactMap { $0 }
                .joined(separator: "+")
        }
        return resolved
    }

    private static func clampVisualPoint(
        _ point: CGPoint,
        window: ResolvedWindowDTO,
        warnings: inout [String]
    ) -> CGPoint {
        var point = point
        let windowFrame = rect(from: window.frameAppKit).standardized
        if windowFrame.isNull == false, windowFrame.width > 0, windowFrame.height > 0,
           windowFrame.insetBy(dx: -2, dy: -2).contains(point) == false {
            warnings.append("Visual cursor offset was outside the resolved window frame and was clamped to the window.")
            point = clamp(point, to: windowFrame.insetBy(dx: 1, dy: 1))
        }

        if let screen = DesktopGeometry.screenContaining(point: point) ?? DesktopGeometry.screenMatching(frame: windowFrame) {
            let screenFrame = screen.frame.standardized
            if screenFrame.insetBy(dx: -1, dy: -1).contains(point) == false {
                warnings.append("Visual cursor offset was outside visible screen geometry and was clamped to the nearest matching screen.")
                point = clamp(point, to: screenFrame.insetBy(dx: 1, dy: 1))
            }
        }
        return point
    }

    private static func clamp(_ point: CGPoint, to rect: CGRect) -> CGPoint {
        let standardized = rect.standardized
        return CGPoint(
            x: min(max(point.x, standardized.minX), standardized.maxX),
            y: min(max(point.y, standardized.minY), standardized.maxY)
        )
    }

    private static func rect(from dto: RectDTO) -> CGRect {
        CGRect(x: dto.x, y: dto.y, width: dto.width, height: dto.height)
    }

    private static func cgPoint(from dto: PointDTO) -> CGPoint {
        CGPoint(x: dto.x, y: dto.y)
    }

    private static func cursorScrollMapping(for direction: ScrollDirectionDTO) -> (axis: CursorScrollAxis, direction: CursorScrollDirection) {
        switch direction {
        case .up:
            return (.vertical, .positive)
        case .down:
            return (.vertical, .negative)
        case .left:
            return (.horizontal, .negative)
        case .right:
            return (.horizontal, .positive)
        }
    }

    private static func pressKeyAnchor(in window: ResolvedWindowDTO) -> CGPoint {
        let frame = rect(from: window.frameAppKit).standardized
        guard frame.width > 1, frame.height > 1 else {
            return CGPoint(x: 0, y: 0)
        }
        return CursorTargetProjector.titlebarAnchor(for: frame)
    }
}

private extension CGRect {
    var center: CGPoint {
        CGPoint(x: midX, y: midY)
    }
}
