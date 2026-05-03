import Testing
@testable import BackgroundComputerUse

@Suite
struct CursorDisabledExecutionTests {
    @Test
    func testDisabledCursorTargetingDoesNotMoveOrAnimate() {
        let target = AXActionTargetSnapshot(
            displayIndex: 7,
            projectedIndex: 7,
            primaryCanonicalIndex: 7,
            canonicalIndices: [7],
            displayRole: "button",
            rawRole: "AXButton",
            rawSubrole: nil,
            title: "Test",
            description: nil,
            identifier: nil,
            placeholder: nil,
            url: nil,
            nodeID: "node-7",
            refetchFingerprint: "fingerprint-7",
            refetchLocator: nil,
            projectedValueKind: nil,
            projectedValuePreview: nil,
            projectedValueLength: nil,
            projectedValueTruncated: false,
            isValueSettable: false,
            supportsValueSet: false,
            isTextEntry: false,
            isFocused: false,
            isSelected: false,
            parameterizedAttributes: [],
            frameAppKit: RectDTO(x: 100, y: 100, width: 80, height: 40),
            activationPointAppKit: nil,
            suggestedInteractionPointAppKit: PointDTO(x: 120, y: 120)
        )
        let window = ResolvedWindowDTO(
            windowID: "window-id",
            title: "Window",
            bundleID: "com.example.Test",
            pid: 123,
            launchDate: nil,
            windowNumber: 456,
            frameAppKit: RectDTO(x: 80, y: 80, width: 400, height: 300),
            resolutionStrategy: "test"
        )

        let cursor = AXCursorTargeting.prepareClick(
            requested: CursorRequestDTO(id: "agent-1", name: "Agent", color: "#20C46B"),
            target: target,
            window: window,
            options: .visualCursorDisabled
        )

        #expect(!cursor.moved)
        #expect(cursor.moveDurationMs == nil)
        #expect(cursor.movement == "disabled")
        #expect(cursor.session.id == "agent-1")
        #expect(cursor.targetPointAppKit?.x == 120)
        #expect(cursor.targetPointAppKit?.y == 120)
    }
}
