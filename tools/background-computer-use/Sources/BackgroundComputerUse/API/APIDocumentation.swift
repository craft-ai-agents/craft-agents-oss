import Foundation

enum APIDocumentation {
    static let guide = APIGuideDTO(
        summary: "Local loopback API for discovering macOS app windows, reading window state, and dispatching background-safe actions.",
        flow: [
            "Call GET /v1/bootstrap first. Use baseURL from the response or runtime manifest and stop if instructions.ready is false.",
            "Call GET /v1/routes for the complete route catalog, request fields, response fields, execution policy, examples, and error codes.",
            "Call POST /v1/list_apps to find a target app, then POST /v1/list_windows with an app name or bundle ID.",
            "Call POST /v1/get_window_state with a window ID and imageMode path or base64. Use the screenshot as visual ground truth and the projected tree for semantic targets.",
            "Call one action route. Reuse stateToken when available, pass a cursor object if you want a visible agent cursor, then read state again before planning the next meaningful action."
        ],
        concepts: [
            APIConceptDTO(
                name: "window",
                description: "Stable window ID returned by list_windows. Most state and action routes require this exact ID.",
                fields: nil
            ),
            APIConceptDTO(
                name: "stateToken",
                description: "Opaque snapshot token returned by get_window_state and action responses. Pass it back to action routes so stale-target checks can compare the action against the state you inspected.",
                fields: nil
            ),
            APIConceptDTO(
                name: "target",
                description: "Semantic action target from get_window_state. Use {\"kind\":\"display_index\",\"value\":N} for a rendered line, {\"kind\":\"node_id\",\"value\":\"...\"} for a stable node, or {\"kind\":\"refetch_fingerprint\",\"value\":\"...\"} when node_id is unavailable. Refresh state after actions because labels, titles, and layout can change.",
                fields: [
                    RouteFieldDTO(name: "kind", type: "display_index | node_id | refetch_fingerprint", required: true, description: "How the route should resolve the target.", defaultValue: nil),
                    RouteFieldDTO(name: "value", type: "integer | string", required: true, description: "Integer for display_index; string for node_id and refetch_fingerprint.", defaultValue: nil),
                ]
            ),
            APIConceptDTO(
                name: "imageMode",
                description: "Use path for local agents, base64 for remote-only consumers, and omit only when visual verification is not needed.",
                fields: [
                    RouteFieldDTO(name: "path", type: "mode", required: false, description: "Return screenshot file paths.", defaultValue: nil),
                    RouteFieldDTO(name: "base64", type: "mode", required: false, description: "Inline screenshot bytes as base64.", defaultValue: nil),
                    RouteFieldDTO(name: "omit", type: "mode", required: false, description: "Do not include screenshots.", defaultValue: nil),
                ]
            ),
            APIConceptDTO(
                name: "CursorRequest",
                description: "Optional visible cursor session for action routes. Reuse id across related calls to move the same cursor.",
                fields: [
                    RouteFieldDTO(name: "id", type: "string", required: false, description: "Stable cursor session ID, for example agent-1.", defaultValue: nil),
                    RouteFieldDTO(name: "name", type: "string", required: false, description: "Short label displayed with the cursor.", defaultValue: nil),
                    RouteFieldDTO(name: "color", type: "string", required: false, description: "CSS-style hex color, for example #20C46B.", defaultValue: nil),
                ]
            ),
        ],
        responseReading: [
            "Transport errors use non-2xx HTTP status codes and the common error body: contractVersion, ok=false, error, message, requestID, and recovery.",
            "Action routes can return HTTP 200 with ok=false when the request was understood but the effect was unsupported, unresolved, unverified, or ambiguous. Read classification, failureDomain or issueBucket, summary, warnings, transports, and verification before retrying.",
            "For visual tasks, trust screenshots over AX-only summaries when they disagree. AX trees and verifier summaries can lag or miss purely visual state.",
            "Verbose implementation notes are omitted from most action responses unless the request includes debug: true."
        ],
        troubleshooting: [
            "invalid_request means the JSON body did not match the route's request fields or enum values. Inspect the route entry in /v1/routes.",
            "app_not_found means list_windows could not resolve the app query. Call list_apps and retry with the exact name or bundleID.",
            "window_not_found means the window ID is stale or closed. Call list_windows again and choose a live window.",
            "accessibility_denied or screenshot failures mean macOS privacy permissions need to be granted to the signed app bundle, then the app must be relaunched."
        ]
    )

    static func usage(for routeID: String) -> RouteUsageDTO {
        guard let id = RouteID(rawValue: routeID) else {
            return usage(
                whenToUse: "Use this registered route according to its method, path, request schema, and response schema.",
                exampleRequest: nil
            )
        }

        switch id {
        case .health:
            return usage(
                whenToUse: "Check that the loopback HTTP server is alive without touching app or window state.",
                useAfter: ["Runtime process has started."],
                successSignals: ["HTTP 200 and ok=true."],
                nextSteps: ["Call /v1/bootstrap for permissions, baseURL, and route discovery."],
                exampleRequest: nil
            )
        case .bootstrap:
            return usage(
                whenToUse: "Start every client session here to confirm baseURL, macOS permissions, and route availability.",
                useAfter: ["Runtime manifest exists or a local base URL is known."],
                successSignals: ["HTTP 200, baseURL is present, and instructions.ready tells you whether action routes are safe to use."],
                nextSteps: ["If ready is false, follow instructions.user. If ready is true, call /v1/routes."],
                exampleRequest: nil
            )
        case .routes:
            return usage(
                whenToUse: "Discover how to call every endpoint, what each response means, and which errors to handle.",
                useAfter: ["Call /v1/bootstrap first so you know the runtime is ready."],
                successSignals: ["HTTP 200 with a route entry for every supported id."],
                nextSteps: ["Use route.request.fields and route.usage.exampleRequest to build calls."],
                exampleRequest: nil
            )
        case .listApps:
            return usage(
                whenToUse: "Find targetable running apps and the current frontmost app.",
                useAfter: ["Bootstrap is ready."],
                successSignals: ["runningApps contains the app you intend to operate and includes its bundleID."],
                nextSteps: ["Call list_windows with the app name or bundleID."],
                exampleRequest: #"{}"#
            )
        case .listWindows:
            return usage(
                whenToUse: "Resolve an app query to live windows and obtain stable window IDs.",
                useAfter: ["Call list_apps, or already know an app name or bundleID."],
                successSignals: ["windows contains at least one on-screen window with a windowID."],
                nextSteps: ["Call get_window_state with the selected windowID."],
                exampleRequest: #"{"app":"Safari"}"#
            )
        case .getWindowState:
            return usage(
                whenToUse: "Read the current visual and semantic state of a window before planning or verifying actions.",
                useAfter: ["Call list_windows and choose a live windowID."],
                successSignals: ["stateToken, screenshot, tree, focusedElement, backgroundSafety, and notes are returned."],
                nextSteps: ["Pick a semantic target or screenshot coordinate, then call an action route."],
                exampleRequest: #"{"window":"WINDOW_ID","imageMode":"path","maxNodes":6500}"#
            )
        case .click:
            return usage(
                whenToUse: "Activate a UI target by semantic target, or click a point in model-facing screenshot coordinates.",
                useAfter: ["Call get_window_state and identify a target or x/y coordinate."],
                successSignals: ["ok=true and classification=success, or inspect summary/failureDomain when ok=false."],
                nextSteps: ["Read get_window_state again when the UI may have changed."],
                exampleRequest: #"{"window":"WINDOW_ID","stateToken":"STATE_TOKEN","target":{"kind":"display_index","value":12},"clickCount":1,"imageMode":"path"}"#
            )
        case .scroll:
            return usage(
                whenToUse: "Scroll a specific semantic element or scrollable ancestor in a direction.",
                useAfter: ["Call get_window_state and choose a target in or near the scrollable region."],
                successSignals: ["classification=success for movement, boundary for a real edge, or issueBucket explains unresolved failures."],
                nextSteps: ["Use postStateToken or read state again before targeting newly visible content."],
                exampleRequest: #"{"window":"WINDOW_ID","stateToken":"STATE_TOKEN","target":{"kind":"display_index","value":20},"direction":"down","pages":1,"imageMode":"path"}"#
            )
        case .performSecondaryAction:
            return usage(
                whenToUse: "Invoke a non-primary action exposed by a node, such as a secondaryActions label or binding.",
                useAfter: ["Call get_window_state and read the target node's secondaryActions or secondaryActionBindings."],
                successSignals: ["ok=true and outcome.status indicates the expected effect was verified or accepted."],
                nextSteps: ["Inspect postState or read state again, especially for menus or visual changes."],
                exampleRequest: #"{"window":"WINDOW_ID","stateToken":"STATE_TOKEN","target":{"kind":"display_index","value":8},"action":"Close","imageMode":"path"}"#
            )
        case .drag:
            return usage(
                whenToUse: "Move a window to a target model-facing screen coordinate.",
                useAfter: ["Call list_windows and choose a windowID."],
                successSignals: ["ok=true, action.effectVerified=true, and window.frameAfterAppKit reflects the requested movement."],
                nextSteps: ["Use get_window_state or list_windows to confirm final layout when needed."],
                exampleRequest: #"{"window":"WINDOW_ID","toX":120,"toY":90}"#
            )
        case .resize:
            return usage(
                whenToUse: "Resize a window by dragging a named edge or corner handle to a target coordinate.",
                useAfter: ["Call list_windows and choose a windowID."],
                successSignals: ["ok=true, action.effectVerified=true, and window.frameAfterAppKit changed as intended."],
                nextSteps: ["Use get_window_state or list_windows to confirm final layout when needed."],
                exampleRequest: #"{"window":"WINDOW_ID","handle":"bottomRight","toX":1200,"toY":800}"#
            )
        case .setWindowFrame:
            return usage(
                whenToUse: "Set a window's frame directly; prefer this over drag/resize for deterministic layout.",
                useAfter: ["Call list_windows and choose a windowID."],
                successSignals: ["ok=true, action.effectVerified=true, and frameAfterAppKit matches x/y/width/height within platform tolerance."],
                nextSteps: ["Read state again if you will interact with content after resizing."],
                exampleRequest: #"{"window":"WINDOW_ID","x":80,"y":80,"width":1200,"height":800,"animate":true}"#
            )
        case .typeText:
            return usage(
                whenToUse: "Insert text into a focused text entry or a specific text-entry element.",
                useAfter: ["Call get_window_state and identify a text-entry target, or deliberately rely on the current focused element."],
                successSignals: ["ok=true and verification exact value or selection evidence matches the requested text."],
                nextSteps: ["Use press_key for explicit Return/Tab submission; type_text does not auto-submit."],
                exampleRequest: #"{"window":"WINDOW_ID","stateToken":"STATE_TOKEN","target":{"kind":"display_index","value":4},"text":"hello","focusAssistMode":"focus_and_caret_end","imageMode":"path"}"#
            )
        case .pressKey:
            return usage(
                whenToUse: "Send a key or key chord to the target window, including semantic shortcuts like command+f where supported.",
                useAfter: ["Call get_window_state when you need to verify focus, selection, or text effects."],
                successSignals: ["ok=true and action.route plus verification explain whether a semantic or native key path worked."],
                nextSteps: ["Read state again when the key may open UI, move focus, or change text.", "If native key delivery is attempted but no effect is verified, first perform a safe click in the target content surface, then retry press_key."],
                exampleRequest: #"{"window":"WINDOW_ID","stateToken":"STATE_TOKEN","key":"command+f","imageMode":"path"}"#
            )
        case .setValue:
            return usage(
                whenToUse: "Set a value directly through Accessibility on a semantic replacement target.",
                useAfter: ["Call get_window_state and choose a target whose node reports value-set support."],
                successSignals: ["ok=true and verification exactValueMatch is true."],
                nextSteps: ["Use type_text instead when you need keystroke semantics, focus movement, autocomplete, or submission behavior."],
                exampleRequest: #"{"window":"WINDOW_ID","stateToken":"STATE_TOKEN","target":{"kind":"display_index","value":4},"value":"hello","imageMode":"path"}"#
            )
        }
    }

    static func errors(for routeID: String) -> [RouteErrorDTO] {
        guard let id = RouteID(rawValue: routeID) else {
            return commonErrors()
        }

        var errors: [RouteErrorDTO] = []

        if routeHasJSONBody(id) {
            errors.append(
                RouteErrorDTO(
                    statusCode: 400,
                    error: "invalid_request",
                    meaning: "The JSON body is missing, malformed, has a wrong type, or uses an unsupported enum value.",
                    recovery: [
                        "Inspect this route's request.fields.",
                        "Include all required fields and match enum values exactly."
                    ]
                )
            )
        }

        if routeNeedsAccessibility(id) {
            errors.append(
                RouteErrorDTO(
                    statusCode: 403,
                    error: "accessibility_denied",
                    meaning: "The runtime cannot read or control the target because macOS Accessibility permission is missing.",
                    recovery: [
                        "Grant Accessibility permission to the signed BackgroundComputerUse app bundle.",
                        "Quit and relaunch through script/start.sh or script/build_and_run.sh run."
                    ]
                )
            )
        }

        if id == .listWindows {
            errors.append(
                RouteErrorDTO(
                    statusCode: 404,
                    error: "app_not_found",
                    meaning: "The app query did not match a targetable running application.",
                    recovery: ["Call list_apps and retry with the exact name or bundleID."]
                )
            )
        }

        if routeNeedsWindow(id) {
            errors.append(
                RouteErrorDTO(
                    statusCode: 404,
                    error: "window_not_found",
                    meaning: "The supplied window ID no longer resolves to a live window.",
                    recovery: ["Call list_windows again and retry with a current windowID."]
                )
            )
        }

        errors.append(contentsOf: commonErrors())
        return errors
    }

    private static func usage(
        whenToUse: String,
        useAfter: [String] = [],
        successSignals: [String] = [],
        nextSteps: [String] = [],
        exampleRequest: String?
    ) -> RouteUsageDTO {
        RouteUsageDTO(
            whenToUse: whenToUse,
            useAfter: useAfter,
            successSignals: successSignals,
            nextSteps: nextSteps,
            exampleRequest: exampleRequest
        )
    }

    private static func routeHasJSONBody(_ id: RouteID) -> Bool {
        switch id {
        case .health, .bootstrap, .routes:
            return false
        default:
            return true
        }
    }

    private static func routeNeedsAccessibility(_ id: RouteID) -> Bool {
        switch id {
        case .health, .bootstrap, .routes:
            return false
        default:
            return true
        }
    }

    private static func routeNeedsWindow(_ id: RouteID) -> Bool {
        switch id {
        case .getWindowState, .click, .scroll, .performSecondaryAction, .drag, .resize, .setWindowFrame, .typeText, .pressKey, .setValue:
            return true
        case .health, .bootstrap, .routes, .listApps, .listWindows:
            return false
        }
    }

    private static func commonErrors() -> [RouteErrorDTO] {
        [
            RouteErrorDTO(
                statusCode: 404,
                error: "route_not_found",
                meaning: "No registered route matched the method and path.",
                recovery: ["Call GET /v1/routes and use one of the advertised method/path pairs."]
            ),
            RouteErrorDTO(
                statusCode: 500,
                error: "internal_error",
                meaning: "The route failed after the request was accepted.",
                recovery: [
                    "Retry once if the target UI is changing.",
                    "If it persists, call the action with debug=true where supported and include requestID in logs."
                ]
            ),
        ]
    }
}
