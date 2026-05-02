import { describe, expect, it, mock } from "bun:test";
import type { SessionToolContext } from "../context.ts";
import { TOOL_DESCRIPTIONS } from "../tool-defs.ts";
import { handleSetSessionStatus } from "./set-session-status.ts";

describe("set_session_status tool description", () => {
  // Workspaces ship with status IDs like "todo" / "needs-review" / "done".
  // The default template does NOT include "in_progress" — yet a previous
  // version of this description suggested it as an example, which led the
  // agent to call set_session_status({ status: "in_progress" }) and trip
  // the unknown-status path on every fresh workspace.
  //
  // Guard against regression: the description must not advertise specific
  // status IDs that aren't part of the canonical default config.
  it("does not hardcode status IDs that may not exist in a workspace", () => {
    const desc = TOOL_DESCRIPTIONS.set_session_status;
    expect(desc).not.toContain('"in_progress"');
    expect(desc).not.toContain("'in_progress'");
  });

  it("points the agent at a discovery path for valid IDs", () => {
    const desc = TOOL_DESCRIPTIONS.set_session_status.toLowerCase();
    const mentionsDiscovery =
      desc.includes("get_session_info") ||
      desc.includes("list_sessions") ||
      desc.includes("available") ||
      desc.includes("returns");
    expect(mentionsDiscovery).toBe(true);
  });
});

function baseCtx(): Partial<SessionToolContext> {
  return {
    sessionId: "sess-1",
    workspacePath: "/tmp/ws",
    sessionPath: "/tmp/ws/sessions/sess-1",
  };
}

describe("handleSetSessionStatus", () => {
  it("returns errorResponse when ctx.setSessionStatus is missing", async () => {
    const ctx = baseCtx() as SessionToolContext;

    const result = await handleSetSessionStatus(ctx, { status: "todo" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not available");
  });

  it("rejects unknown status fast and lists available IDs", async () => {
    const setSessionStatus = mock(async () => {});
    const ctx = {
      ...baseCtx(),
      setSessionStatus,
      resolveStatus: () => ({
        resolved: null,
        available: ["backlog", "todo", "needs-review", "done", "cancelled"],
      }),
    } as unknown as SessionToolContext;

    const result = await handleSetSessionStatus(ctx, { status: "in_progress" });

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("in_progress");
    expect(text).toContain("backlog");
    expect(text).toContain("needs-review");
    expect(setSessionStatus).not.toHaveBeenCalled();
  });

  it("resolves display-name input to canonical ID before persisting", async () => {
    const setSessionStatus = mock(async () => {});
    const ctx = {
      ...baseCtx(),
      setSessionStatus,
      resolveStatus: (s: string) =>
        s === "Needs Review"
          ? { resolved: "needs-review", available: ["needs-review"] }
          : { resolved: null, available: ["needs-review"] },
    } as unknown as SessionToolContext;

    const result = await handleSetSessionStatus(ctx, {
      status: "Needs Review",
    });

    expect(result.isError).toBeFalsy();
    expect(setSessionStatus).toHaveBeenCalledTimes(1);
    expect(setSessionStatus.mock.calls[0]?.[1]).toBe("needs-review");
  });

  it("targets a specific session when sessionId is provided", async () => {
    const setSessionStatus = mock(async () => {});
    const ctx = {
      ...baseCtx(),
      setSessionStatus,
      resolveStatus: () => ({ resolved: "done", available: ["done"] }),
    } as unknown as SessionToolContext;

    await handleSetSessionStatus(ctx, { sessionId: "sess-9", status: "done" });

    expect(setSessionStatus).toHaveBeenCalledTimes(1);
    expect(setSessionStatus.mock.calls[0]?.[0]).toBe("sess-9");
    expect(setSessionStatus.mock.calls[0]?.[1]).toBe("done");
  });

  it("without resolveStatus, passes the status through (legacy fallback)", async () => {
    const setSessionStatus = mock(async () => {});
    const ctx = {
      ...baseCtx(),
      setSessionStatus,
    } as unknown as SessionToolContext;

    const result = await handleSetSessionStatus(ctx, { status: "arbitrary" });

    expect(result.isError).toBeFalsy();
    expect(setSessionStatus.mock.calls[0]?.[1]).toBe("arbitrary");
  });

  it("returns errorResponse when setSessionStatus throws", async () => {
    const setSessionStatus = mock(async () => {
      throw new Error("persistence failed");
    });
    const ctx = {
      ...baseCtx(),
      setSessionStatus,
      resolveStatus: () => ({ resolved: "done", available: ["done"] }),
    } as unknown as SessionToolContext;

    const result = await handleSetSessionStatus(ctx, { status: "done" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("persistence failed");
  });
});
