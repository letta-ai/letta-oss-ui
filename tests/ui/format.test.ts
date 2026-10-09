import { describe, expect, it } from "vitest";
import {
  folderName,
  modelLabel,
  relativeTime,
  relativeToFolder,
  shortPath,
  toolLabel,
  toolSummary,
} from "../../src/ui/lib/format";

describe("paths", () => {
  it("shortens long paths to the last two folders", () => {
    expect(shortPath("/Users/sam/code/project")).toBe(".../code/project");
    expect(shortPath("/tmp")).toBe("/tmp");
  });

  it("returns the last folder name", () => {
    expect(folderName("/Users/sam/code/project")).toBe("project");
    expect(folderName("C:\\Users\\sam\\project")).toBe("project");
  });
});

describe("relativeToFolder", () => {
  it("shows paths inside the working folder relative to it", () => {
    expect(relativeToFolder("/work/app/src/a.ts", "/work/app")).toBe("src/a.ts");
    expect(relativeToFolder("cat /work/app/a.ts /work/app/b.ts", "/work/app/")).toBe("cat a.ts b.ts");
    expect(relativeToFolder("ls /work/app", "/work/app")).toBe("ls .");
  });

  it("leaves other paths and an unknown folder alone", () => {
    expect(relativeToFolder("/etc/hosts", "/work/app")).toBe("/etc/hosts");
    expect(relativeToFolder("/work/app-old/a.ts", "/work/app")).toBe("/work/app-old/a.ts");
    expect(relativeToFolder("/work/app/a.ts", "")).toBe("/work/app/a.ts");
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 0, 15, 12);
  const minute = 60_000;

  it("formats recent times in minutes, hours, and days", () => {
    expect(relativeTime(now - 20_000, now)).toBe("now");
    expect(relativeTime(now - 5 * minute, now)).toBe("5m");
    expect(relativeTime(now - 3 * 60 * minute, now)).toBe("3h");
    expect(relativeTime(now - 2 * 24 * 60 * minute, now)).toBe("2d");
  });

  it("is empty when there is no timestamp", () => {
    expect(relativeTime(0, now)).toBe("");
  });
});

describe("modelLabel", () => {
  const models = [{ id: "sonnet", handle: "anthropic/claude-sonnet", label: "Claude Sonnet" }];

  it("uses the catalog label when the model is known", () => {
    expect(modelLabel("anthropic/claude-sonnet", models)).toBe("Claude Sonnet");
  });

  it("falls back to the handle's last segment", () => {
    expect(modelLabel("openai/gpt-x", models)).toBe("gpt-x");
    expect(modelLabel(null, models)).toBe("Default model");
  });
});

describe("tools", () => {
  it("summarizes a call by its most telling input, across toolsets", () => {
    expect(toolSummary({ command: "ls -la" })).toBe("ls -la");
    expect(toolSummary({ cmd: "pwd", description: "Print dir" })).toBe("pwd");
    expect(toolSummary({ file_path: "/a/b.ts", old_string: "x" })).toBe("/a/b.ts");
    expect(toolSummary({ command: ["git", "status"] })).toBe("git status");
    expect(toolSummary({ limit: 3 })).toBe("");
  });

  it("turns tool names into readable labels", () => {
    expect(toolLabel("exec_command")).toBe("Exec command");
    expect(toolLabel("WebFetch")).toBe("Web Fetch");
    expect(toolLabel("mcp__github__list_issues")).toBe("Github: list issues");
  });
});
