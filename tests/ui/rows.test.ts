import { describe, expect, it } from "vitest";
import { mergeHistory, optimisticUserRow, rowIdentity, upsertRows } from "../../src/ui/lib/rows";
import type { ChatRow } from "../../src/ui/types";

const text = (kind: "user" | "assistant" | "reasoning", key: string, value: string, otid?: string): ChatRow => ({
  kind,
  key,
  text: value,
  ...(otid ? { otid } : {}),
});

const tool = (id: string, status: "streaming" | "ready" | "complete" = "ready"): ChatRow => ({
  kind: "tool_call",
  key: `tool_call:id:${id}`,
  toolCallId: id,
  toolName: "Bash",
  toolInput: {},
  status,
});

describe("rowIdentity", () => {
  it("uses the otid for text rows that have one", () => {
    expect(rowIdentity(text("user", "user:uuid:abc", "hi", "o1"))).toBe("user:otid:o1");
  });

  it("keeps rows of different kinds apart when they share an otid", () => {
    expect(rowIdentity(text("assistant", "a", "x", "o1"))).not.toBe(
      rowIdentity(text("reasoning", "b", "y", "o1")),
    );
  });

  it("falls back to the key, and always uses the key for tool calls", () => {
    expect(rowIdentity(text("assistant", "assistant:uuid:1", "x"))).toBe("assistant:uuid:1");
    expect(rowIdentity(tool("t1"))).toBe("tool_call:id:t1");
  });
});

describe("upsertRows", () => {
  it("appends new rows in the order they arrive", () => {
    const rows = upsertRows([text("user", "u1", "hi")], [tool("t1"), text("assistant", "a1", "yo")]);
    expect(rows.map((row) => row.key)).toEqual(["u1", "tool_call:id:t1", "a1"]);
  });

  it("replaces a row in place when it is sent again", () => {
    const rows = upsertRows(
      [text("user", "u1", "hi"), text("assistant", "a1", "He"), tool("t1", "streaming")],
      [text("assistant", "a1", "Hello"), tool("t1", "complete")],
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ key: "a1", text: "Hello" });
    expect(rows[2]).toMatchObject({ status: "complete" });
  });

  it("does not change the list it was given", () => {
    const original = [text("user", "u1", "hi")];
    upsertRows(original, [text("assistant", "a1", "yo")]);
    expect(original).toHaveLength(1);
  });
});

describe("mergeHistory", () => {
  it("puts history first and keeps rows that only exist on screen", () => {
    const history = [text("user", "u1", "old"), text("assistant", "a1", "older")];
    const current = [text("assistant", "a1", "older"), text("assistant", "a2", "live")];
    expect(mergeHistory(history, current).map((row) => row.key)).toEqual(["u1", "a1", "a2"]);
  });

  it("replaces an optimistic user row with the saved message that has the same otid", () => {
    const optimistic = optimisticUserRow("hello", "o1");
    const saved = text("user", "user:uuid:server", "hello", "o1");
    expect(mergeHistory([saved], [optimistic])).toEqual([saved]);
  });
});
