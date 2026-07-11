// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/ParityModelsDecodingTests.swift
import XCTest
@testable import CraftAgentKit

/// Decode/encode guards for the models added for desktop feature parity. Keeps
/// the wire contracts (unread summary, file tree, statuses, labels, permission
/// mode state, sources, skills, LLM connections, credential response) honest.
final class ParityModelsDecodingTests: XCTestCase {
    func testDecodesUnreadSummary() throws {
        let value = JSONValue.object([
            "totalUnreadSessions": .number(3),
            "byWorkspace": .object(["w1": .number(2), "w2": .number(1)]),
            "hasUnreadByWorkspace": .object(["w1": .bool(true), "w2": .bool(true)]),
        ])
        let summary: UnreadSummary = try value.decoded()
        XCTAssertEqual(summary.totalUnreadSessions, 3)
        XCTAssertEqual(summary.byWorkspace["w1"], 2)
        XCTAssertEqual(summary.hasUnreadByWorkspace["w2"], true)
    }

    func testDecodesRecursiveSessionFileTree() throws {
        let value = JSONValue.array([
            .object([
                "name": .string("dir"),
                "path": .string("/s/dir"),
                "type": .string("directory"),
                "children": .array([
                    .object([
                        "name": .string("a.txt"),
                        "path": .string("/s/dir/a.txt"),
                        "type": .string("file"),
                        "size": .number(12),
                    ]),
                ]),
            ]),
        ])
        let files: [SessionFile] = try value.decoded()
        XCTAssertEqual(files.count, 1)
        XCTAssertTrue(files[0].isDirectory)
        XCTAssertEqual(files[0].children?.first?.name, "a.txt")
        XCTAssertEqual(files[0].children?.first?.size, 12)
    }

    func testDecodesStatusWithStringOrObjectColor() throws {
        let stringColor: WorkspaceStatus = try JSONValue.object([
            "id": .string("todo"), "label": .string("To do"), "color": .string("accent"),
        ]).decoded()
        XCTAssertEqual(stringColor.label, "To do")

        let objectColor: WorkspaceStatus = try JSONValue.object([
            "id": .string("done"), "label": .string("Done"),
            "color": .object(["light": .string("#0f0"), "dark": .string("#0a0")]),
        ]).decoded()
        XCTAssertEqual(objectColor.id, "done")
    }

    func testDecodesLabelConfigEnvelope() throws {
        let value = JSONValue.object([
            "labels": .array([
                .object([
                    "id": .string("bug"), "name": .string("Bug"),
                    "children": .array([
                        .object(["id": .string("p1"), "name": .string("P1"), "valueType": .string("number")]),
                    ]),
                ]),
            ]),
        ])
        let config: WorkspaceLabelConfig = try value.decoded()
        XCTAssertEqual(config.labels?.count, 1)
        XCTAssertEqual(config.labels?.first?.children?.first?.valueType, "number")
    }

    func testDecodesPermissionModeState() throws {
        let value = JSONValue.object([
            "permissionMode": .string("ask"),
            "modeVersion": .number(2),
            "changedAt": .string("2026-01-01T00:00:00Z"),
            "changedBy": .string("user"),
        ])
        let state: PermissionModeState = try value.decoded()
        XCTAssertEqual(state.permissionMode, "ask")
        XCTAssertEqual(state.modeVersion, 2)
        XCTAssertNil(state.previousPermissionMode)
    }

    func testDecodesSourceIgnoringExtraKeys() throws {
        let value = JSONValue.array([
            .object([
                "config": .object([
                    "id": .string("id1"), "name": .string("GitHub"), "slug": .string("github"),
                    "enabled": .bool(true), "type": .string("mcp"), "isAuthenticated": .bool(true),
                ]),
                "folderPath": .string("/ignored"),
                "guide": .null,
            ]),
        ])
        let sources: [Source] = try value.decoded()
        XCTAssertEqual(sources.first?.name, "GitHub")
        XCTAssertEqual(sources.first?.type, "mcp")
        XCTAssertEqual(sources.first?.config.isAuthenticated, true)
    }

    func testDecodesSkillFromLoadedSkillShape() throws {
        let value = JSONValue.array([
            .object([
                "slug": .string("pdf"),
                "metadata": .object(["name": .string("PDF"), "description": .string("Work with PDFs")]),
                "content": .string("ignored"),
                "source": .string("workspace"),
            ]),
        ])
        let skills: [Skill] = try value.decoded()
        XCTAssertEqual(skills.first?.name, "PDF")
        XCTAssertEqual(skills.first?.metadata.description, "Work with PDFs")
    }

    func testDecodesLlmConnection() throws {
        let value = JSONValue.array([
            .object([
                "slug": .string("anthropic"), "name": .string("Anthropic"),
                "providerType": .string("anthropic"), "authType": .string("oauth"),
                "defaultModel": .string("claude-opus-4-8"),
            ]),
        ])
        let conns: [LlmConnection] = try value.decoded()
        XCTAssertEqual(conns.first?.providerType, "anthropic")
        XCTAssertEqual(conns.first?.defaultModel, "claude-opus-4-8")
    }

    func testEncodesCredentialResponse() throws {
        let response = CredentialResponse(value: "secret", cancelled: false)
        let encoded = try encodeAsJSONValue(response)
        guard case .object(let obj) = encoded else { return XCTFail("expected object") }
        XCTAssertEqual(obj["type"], .string("credential"))
        XCTAssertEqual(obj["value"], .string("secret"))
        XCTAssertEqual(obj["cancelled"], .bool(false))
    }

    func testEncodesCreateLabelInput() throws {
        let input = CreateLabelInput(name: "Bug", parentId: "root", valueType: "number")
        let encoded = try encodeAsJSONValue(input)
        guard case .object(let obj) = encoded else { return XCTFail("expected object") }
        XCTAssertEqual(obj["name"], .string("Bug"))
        XCTAssertEqual(obj["parentId"], .string("root"))
        XCTAssertEqual(obj["valueType"], .string("number"))
    }
}
