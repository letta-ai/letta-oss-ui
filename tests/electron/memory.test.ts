import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
const requestChunks = vi.fn();
vi.mock("../../src/electron/libs/control", () => ({ request, requestChunks }));

const memory = await import("../../src/electron/libs/memory");

/** The commands sent to the runtime, as [type, body] pairs. */
const sent = () => request.mock.calls.map(([type, body]) => [type, body]);

/** Answer `read_memory_file` with `content`, or fail it when the file does not exist. */
function fileOnDisk(content: string | null) {
  return async (type: string) => {
    if (type !== "read_memory_file") return {};
    if (content === null) throw new Error("File not found");
    return { content };
  };
}

beforeEach(() => {
  request.mockReset();
  requestChunks.mockReset();
});

describe("listMemory", () => {
  it("joins the chunks, sorts by path, and leaves image bytes out", async () => {
    requestChunks.mockResolvedValue([
      {
        memfs_enabled: true,
        entries: [
          { relative_path: "reference/b.md", is_system: false, description: "B", content: "b", size: 1 },
          { relative_path: "profile.png", is_system: false, description: null, content: "AAAA", size: 4, kind: "image" },
        ],
      },
      {
        entries: [
          { relative_path: "MEMORY.md", is_system: true, description: null, content: "# Memory", size: 8, kind: "markdown" },
        ],
      },
    ]);

    const overview = await memory.listMemory("agent-1");
    expect(requestChunks).toHaveBeenCalledWith("list_memory", { agent_id: "agent-1" });
    expect(overview.enabled).toBe(true);
    expect(overview.files.map((file) => file.path)).toEqual(["MEMORY.md", "profile.png", "reference/b.md"]);
    expect(overview.files[0]).toMatchObject({ system: true, kind: "markdown", content: "# Memory" });
    expect(overview.files[1]).toMatchObject({ kind: "image", content: "" });
  });

  it("reports agents that do not use file-based memory", async () => {
    requestChunks.mockResolvedValue([{ memfs_enabled: false, entries: [] }]);
    expect(await memory.listMemory("agent-1")).toEqual({ enabled: false, files: [] });
  });
});

describe("writeMemoryFile", () => {
  it("writes the file as a commit", async () => {
    request.mockImplementation(fileOnDisk(null));
    await memory.writeMemoryFile("agent-1", "  notes.md ", "hello");
    expect(sent().at(-1)).toEqual([
      "write_memory_file",
      { agent_id: "agent-1", path: "notes.md", content: "hello", commit_message: "Edit notes.md in OSS-UI" },
    ]);
  });

  it("removes a new file again when the runtime rejects it", async () => {
    request.mockImplementation(async (type: string, body: { content?: string }) => {
      if (type === "read_memory_file") throw new Error("File not found");
      if (type === "write_memory_file" && body.content === "bad") {
        throw new Error(
          "Command failed: git commit -m Edit\nMemory validation blocked this commit. No files were committed.\n\nFix these problems:\nnewdir/a.md: missing required index newdir/MEMORY.md\n\nMove non-core detail out of root Markdown.",
        );
      }
      return {};
    });

    await expect(memory.writeMemoryFile("agent-1", "newdir/a.md", "bad")).rejects.toThrow(
      "Letta's memory rules blocked this change. newdir/a.md: missing required index newdir/MEMORY.md",
    );
    expect(sent().at(-1)).toEqual(["delete_memory_file", { agent_id: "agent-1", path: "newdir/a.md" }]);
  });

  it("puts the old content back when an edit is rejected", async () => {
    request.mockImplementation(async (type: string, body: { content?: string }) => {
      if (type === "read_memory_file") return { content: "original" };
      if (type === "write_memory_file" && body.content === "bad") {
        throw new Error("Command failed: git commit\nMemory validation failed:\n\nnotes.md: missing frontmatter (must start with ---)");
      }
      return {};
    });

    await expect(memory.writeMemoryFile("agent-1", "notes.md", "bad")).rejects.toThrow(
      "Letta's memory rules blocked this change. notes.md: missing frontmatter (must start with ---)",
    );
    expect(sent().at(-1)).toEqual([
      "write_memory_file",
      { agent_id: "agent-1", path: "notes.md", content: "original" },
    ]);
  });

  it("passes other failures through unchanged", async () => {
    request.mockImplementation(async (type: string) => {
      if (type === "read_memory_file") return { content: "original" };
      throw new Error("Lost the connection to Letta.");
    });
    await expect(memory.writeMemoryFile("agent-1", "notes.md", "x")).rejects.toThrow(
      "Lost the connection to Letta.",
    );
  });
});

describe("deleteMemoryFile", () => {
  it("deletes the file as a commit", async () => {
    request.mockImplementation(fileOnDisk("content"));
    await memory.deleteMemoryFile("agent-1", "notes.md");
    expect(sent().at(-1)).toEqual([
      "delete_memory_file",
      { agent_id: "agent-1", path: "notes.md", commit_message: "Delete notes.md in OSS-UI" },
    ]);
  });

  it("treats removing a never-committed file as success", async () => {
    request.mockImplementation(async (type: string) => {
      if (type === "read_memory_file") return { content: "draft" };
      throw new Error("fatal: pathspec 'notes.md' did not match any files");
    });
    await expect(memory.deleteMemoryFile("agent-1", "notes.md")).resolves.toBeUndefined();
    expect(sent().filter(([type]) => type === "write_memory_file")).toEqual([]);
  });

  it("restores the file when the delete is rejected", async () => {
    request.mockImplementation(async (type: string) => {
      if (type === "read_memory_file") return { content: "keep me" };
      if (type === "delete_memory_file") {
        throw new Error("Memory validation blocked this commit.\n\nFix these problems:\nsystem/core.md: read-only file");
      }
      return {};
    });
    await expect(memory.deleteMemoryFile("agent-1", "system/core.md")).rejects.toThrow("read-only file");
    expect(sent().at(-1)).toEqual([
      "write_memory_file",
      { agent_id: "agent-1", path: "system/core.md", content: "keep me" },
    ]);
  });
});

describe("history", () => {
  it("lists a file's versions with parsed timestamps", async () => {
    request.mockResolvedValue({
      commits: [{ sha: "abc", message: "Edit notes.md", timestamp: "2026-01-02T03:04:05Z", author_name: "Agent" }],
    });
    expect(await memory.listMemoryHistory("agent-1", "notes.md")).toEqual([
      { sha: "abc", message: "Edit notes.md", timestamp: Date.UTC(2026, 0, 2, 3, 4, 5), author: "Agent" },
    ]);
    expect(request).toHaveBeenCalledWith("memory_history", { agent_id: "agent-1", file_path: "notes.md", limit: 50 });
  });
});
