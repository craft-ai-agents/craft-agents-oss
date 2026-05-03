import Testing
@testable import BackgroundComputerUse

@Suite
struct PressKeyParserTests {
    @Test
    func testParserMatchesDocumentedBackspaceParity() throws {
        let accepted = try PressKeyParser.parse("BackSpace")
        #expect(accepted.key == "backspace")
        #expect(Int(accepted.keyCode) == 51)

        #expect(throws: (any Error).self) {
            try PressKeyParser.parse("Backspace")
        }
        #expect(throws: (any Error).self) {
            try PressKeyParser.parse("backspace")
        }
    }

    @Test
    func testParserRejectsRawSlashButAcceptsSlashToken() throws {
        #expect(throws: (any Error).self) {
            try PressKeyParser.parse("/")
        }

        let accepted = try PressKeyParser.parse("slash")
        #expect(accepted.key == "/")
        #expect(Int(accepted.keyCode) == 44)
    }

    @Test
    func testParserAcceptsKeypadDigits() throws {
        let zero = try PressKeyParser.parse("KP_0")
        #expect(zero.key == "kp_0")
        #expect(Int(zero.keyCode) == 82)

        let nine = try PressKeyParser.parse("KP_9")
        #expect(nine.key == "kp_9")
        #expect(Int(nine.keyCode) == 92)
    }

    @Test
    func testParserRejectsEnterButAcceptsReturn() throws {
        #expect(throws: (any Error).self) {
            try PressKeyParser.parse("Enter")
        }

        let accepted = try PressKeyParser.parse("Return")
        #expect(accepted.key == "return")
        #expect(Int(accepted.keyCode) == 36)
    }

    @Test
    func testParserNormalizesCommandFIntent() throws {
        let parsed = try PressKeyParser.parse("super+f")
        #expect(parsed.dto.normalized == "command+f")
        #expect(parsed.intent == .openFindOrSearch)
    }

    @Test
    func testNativeCommandFRequiresSearchEvidenceBeyondVisualChange() throws {
        let service = PressKeyRouteService()
        let parsed = try PressKeyParser.parse("super+f")
        let search = PressKeySearchVerificationDTO(
            beforeSearchFieldCount: 0,
            afterSearchFieldCount: 0,
            focusedSearchFieldVerified: false,
            targetWindowNumberBefore: 1,
            targetWindowNumberAfter: 1,
            targetWindowTitleBefore: "Before",
            targetWindowTitleAfter: "After",
            frontmostBundleIDBefore: nil,
            frontmostBundleIDAfter: nil
        )

        #expect(!service.nativeEffectVerified(
            dispatchSucceeded: true,
            parsed: parsed,
            renderedChanged: false,
            focusedChanged: false,
            textStateChanged: false,
            selectionChanged: false,
            visualChanged: true,
            search: search
        ))
    }

    @Test
    func testNativeCommandFVerifiesSearchFieldAppearing() throws {
        let service = PressKeyRouteService()
        let parsed = try PressKeyParser.parse("super+f")
        let search = PressKeySearchVerificationDTO(
            beforeSearchFieldCount: 0,
            afterSearchFieldCount: 1,
            focusedSearchFieldVerified: false,
            targetWindowNumberBefore: 1,
            targetWindowNumberAfter: 1,
            targetWindowTitleBefore: "Before",
            targetWindowTitleAfter: "After",
            frontmostBundleIDBefore: nil,
            frontmostBundleIDAfter: nil
        )

        #expect(service.nativeEffectVerified(
            dispatchSucceeded: true,
            parsed: parsed,
            renderedChanged: false,
            focusedChanged: false,
            textStateChanged: false,
            selectionChanged: false,
            visualChanged: false,
            search: search
        ))
    }

    @Test
    func testNativeCommandChordDoesNotVerifyVisualOnlyChange() throws {
        let service = PressKeyRouteService()
        let parsed = try PressKeyParser.parse("super+shift+p")

        #expect(!service.nativeEffectVerified(
            dispatchSucceeded: true,
            parsed: parsed,
            renderedChanged: false,
            focusedChanged: false,
            textStateChanged: false,
            selectionChanged: false,
            visualChanged: true,
            search: nil
        ))
    }

    @Test
    func testWindowServerPreparationRequiresSuccessfulTargetFocusAndKeyWindowRecordsForKeys() {
        let preparedForClick = NativeWindowServerPreparationResult(
            psnStatus: 0,
            targetFocusStatus: 0,
            keyWindowStatuses: [],
            notes: [],
            warnings: []
        )
        #expect(preparedForClick.preparedTargetWindow(requireKeyWindowRecords: false))
        #expect(!preparedForClick.preparedTargetWindow(requireKeyWindowRecords: true))

        let preparedForKeys = NativeWindowServerPreparationResult(
            psnStatus: 0,
            targetFocusStatus: 0,
            keyWindowStatuses: [0, 0],
            notes: [],
            warnings: []
        )
        #expect(preparedForKeys.preparedTargetWindow(requireKeyWindowRecords: true))

        let skipped = NativeWindowServerPreparationResult(
            psnStatus: nil,
            targetFocusStatus: nil,
            keyWindowStatuses: [],
            notes: [],
            warnings: []
        )
        #expect(!skipped.preparedTargetWindow(requireKeyWindowRecords: false))

        let partialKeyWindow = NativeWindowServerPreparationResult(
            psnStatus: 0,
            targetFocusStatus: 0,
            keyWindowStatuses: [0],
            notes: [],
            warnings: []
        )
        #expect(!partialKeyWindow.preparedTargetWindow(requireKeyWindowRecords: true))

        let nonZeroKeyWindow = NativeWindowServerPreparationResult(
            psnStatus: 0,
            targetFocusStatus: 0,
            keyWindowStatuses: [0, 1],
            notes: [],
            warnings: []
        )
        #expect(!nonZeroKeyWindow.preparedTargetWindow(requireKeyWindowRecords: true))
    }
}
