import { describe, expect, it } from "vitest";
import type { LettaConversationMessage } from "@letta-ai/letta-agent-sdk";
import {
  describeError,
  mergeHistory,
  projectHistory,
  rowIdentity,
  toChatRow,
} from "../../src/electron/libs/transcript";
import { rowIdentity as uiRowIdentity } from "../../src/ui/lib/rows";
import type { ChatRow } from "../../src/electron/types";

/** A saved history page, newest first, the way the API returns it. */
function page(...messages: Array<Record<string, unknown>>): LettaConversationMessage[] {
  return messages
    .map((message, index) => ({
      id: `message-${index}`,
      date: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      ...message,
    }))
    .reverse() as unknown as LettaConversationMessage[];
}

describe("describeError", () => {
  it("digs the readable message out of nested JSON", () => {
    const raw = JSON.stringify({
      error: {
        error: {
          type: "local_backend_error",
          message: '402: {"message":"Payment required. Visit your billing tab.","code":"payment_required"}',
          detail: '402: {"message":"Payment required. Visit your billing tab.","code":"payment_required"}',
        },
      },
    });
    expect(describeError(raw)).toBe("Payment required. Visit your billing tab.");
  });

  it("returns plain messages unchanged, including ones with brackets", () => {
    expect(describeError(new Error("Connection refused"))).toBe("Connection refused");
    expect(describeError("Unexpected token { in config")).toBe("Unexpected token { in config");
  });

  it("never returns an empty message", () => {
    expect(describeError("")).toBe("Something went wrong.");
    expect(describeError(undefined)).toBe("Something went wrong.");
  });
});

describe("toChatRow", () => {
  it("removes injected system reminders from user messages", () => {
    const row = toChatRow({
      kind: "user",
      key: "user:otid:o1",
      otid: "o1",
      text: "<system-reminder>\nDevice info\n</system-reminder>\n\nFix the bug",
    });
    expect(row).toEqual({ kind: "user", key: "user:otid:o1", otid: "o1", text: "Fix the bug" });
  });

  it("clips very long tool output", () => {
    const row = toChatRow({
      kind: "tool_call",
      key: "tool_call:id:t1",
      toolCallId: "t1",
      toolName: "Bash",
      toolInput: { command: "cat big" },
      argumentsComplete: true,
      status: "complete",
      result: { content: "x".repeat(25_000), isError: false },
    });
    expect(row.kind === "tool_call" && row.result?.content.length).toBeLessThan(21_000);
    expect(row.kind === "tool_call" && row.result?.content).toContain("more characters");
  });
});

describe("projectHistory", () => {
  it("rebuilds a turn in order and pairs each tool call with its result", () => {
    const rows = projectHistory(
      page(
        { message_type: "user_message", otid: "o1", content: "list files" },
        {
          message_type: "approval_request_message",
          tool_call: { tool_call_id: "t1", name: "Bash", arguments: '{"command":"ls"}' },
        },
        { message_type: "tool_return_message", tool_call_id: "t1", tool_return: "a.txt", status: "success" },
        { message_type: "assistant_message", content: "One file: a.txt" },
      ),
    );

    expect(rows.map((row) => row.kind)).toEqual(["user", "tool_call", "assistant"]);
    expect(rows[1]).toMatchObject({
      toolName: "Bash",
      toolInput: { command: "ls" },
      status: "complete",
      result: { content: "a.txt", isError: false },
    });
  });

  it("shows a tool call the user denied as failed, not as still running", () => {
    const rows = projectHistory(
      page(
        { message_type: "user_message", otid: "o1", content: "delete it" },
        {
          message_type: "approval_request_message",
          tool_call: { tool_call_id: "t1", name: "Bash", arguments: '{"command":"rm x"}' },
        },
        {
          message_type: "approval_response_message",
          approvals: [{ type: "approval", tool_call_id: "t1", approve: false }],
        },
      ),
    );
    expect(rows.find((row) => row.kind === "tool_call")).toMatchObject({
      status: "complete",
      result: { isError: true },
    });
  });

  it("drops user messages that were only a system reminder", () => {
    const rows = projectHistory(
      page({
        message_type: "user_message",
        otid: "o1",
        content: "<system-reminder>context only</system-reminder>",
      }),
    );
    expect(rows).toEqual([]);
  });
});

describe("mergeHistory", () => {
  const user: ChatRow = { kind: "user", key: "user:otid:o1", otid: "o1", text: "hi" };
  const live: ChatRow = { kind: "assistant", key: "assistant:uuid:a2", text: "streaming" };

  it("keeps live rows after history without repeating shared ones", () => {
    expect(mergeHistory([user], [user, live])).toEqual([user, live]);
  });

  it("identifies rows the same way the UI does", () => {
    for (const row of [user, live]) expect(rowIdentity(row)).toBe(uiRowIdentity(row));
  });
});
