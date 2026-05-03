import Testing
import BackgroundComputerUse

@Suite
struct RuntimeFacadePublicAPITests {
    @Test
    func testRuntimeFacadeIsImportableWithoutTestableImport() {
        let runtime = BackgroundComputerUseRuntime()
        let permissions = runtime.permissions()
        let apps = runtime.listApps()

        #expect(!permissions.checkedAt.isEmpty)
        #expect(!apps.contractVersion.isEmpty)
        _ = apps.runningApps
    }

    @Test
    func testPublicRequestDTOsAreConstructible() throws {
        let cursor = CursorRequestDTO(id: "agent-1", name: "Agent", color: "#20C46B")
        let target = try ActionTargetRequestDTO.displayIndex(3)

        let listWindows = ListWindowsRequest(app: "Safari")
        let state = GetWindowStateRequest(window: "window-id", imageMode: .path)
        let click = ClickRequest(window: "window-id", target: target, clickCount: 1, cursor: cursor)
        let coordinateClick = ClickRequest(window: "window-id", x: 10, y: 20)
        let scroll = ScrollRequest(window: "window-id", target: target, direction: .down)
        let secondary = PerformSecondaryActionRequest(window: "window-id", target: target, action: "show_menu")
        let drag = DragRequest(window: "window-id", toX: 100, toY: 120)
        let resize = ResizeRequest(window: "window-id", handle: .bottomRight, toX: 300, toY: 320)
        let frame = SetWindowFrameRequest(window: "window-id", x: 10, y: 20, width: 500, height: 400)
        let typeText = TypeTextRequest(window: "window-id", target: target, text: "hello")
        let pressKey = PressKeyRequest(window: "window-id", key: "command+a")
        let setValue = SetValueRequest(window: "window-id", target: target, value: "hello")

        #expect(listWindows.app == "Safari")
        #expect(state.imageMode == .path)
        #expect(click.target?.displayIndex == 3)
        #expect(coordinateClick.x == 10)
        #expect(scroll.direction == .down)
        #expect(secondary.action == "show_menu")
        #expect(drag.toX == 100)
        #expect(resize.handle == .bottomRight)
        #expect(frame.width == 500)
        #expect(typeText.text == "hello")
        #expect(pressKey.key == "command+a")
        #expect(setValue.value == "hello")
    }

    @Test
    func testPublicTargetFactoriesValidateLikeHTTPDecoding() {
        #expect(throws: ActionTargetRequestValidationError.self) {
            try ActionTargetRequestDTO.displayIndex(-1)
        }
        #expect(throws: ActionTargetRequestValidationError.self) {
            try ActionTargetRequestDTO.nodeID("  ")
        }
        #expect(throws: ActionTargetRequestValidationError.self) {
            try ActionTargetRequestDTO.refetchFingerprint("")
        }
    }
}
