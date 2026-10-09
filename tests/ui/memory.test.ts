import { describe, expect, it } from "vitest";
import { directoryOf, fileName, isIndexFile, withHeader } from "../../src/ui/lib/memory";

describe("memory paths", () => {
  it("splits a path into folder and file name", () => {
    expect(directoryOf("reference/notes.md")).toBe("reference");
    expect(directoryOf("notes.md")).toBe("");
    expect(fileName("reference/deep/notes.md")).toBe("notes.md");
  });

  it("recognizes index files at any depth", () => {
    expect(isIndexFile("MEMORY.md")).toBe(true);
    expect(isIndexFile("reference/MEMORY.md")).toBe(true);
    expect(isIndexFile("reference/MY-MEMORY.md")).toBe(false);
    expect(isIndexFile("memory.md")).toBe(false);
  });
});

describe("withHeader", () => {
  it("writes the name and description header Letta requires", () => {
    expect(withHeader("reference/project-notes.md", "Notes on the project", "# Notes\n")).toBe(
      "---\nname: project-notes\ndescription: Notes on the project\n---\n\n# Notes\n",
    );
  });

  it("keeps the description on one line", () => {
    expect(withHeader("a.md", "  line one\nline two  ", "x")).toContain(
      "description: line one line two\n",
    );
  });

  it("leaves index files and files that already have a header alone", () => {
    expect(withHeader("reference/MEMORY.md", "ignored", "# Index\n")).toBe("# Index\n");
    const withOwnHeader = "---\nname: mine\ndescription: mine\n---\nbody";
    expect(withHeader("a.md", "ignored", withOwnHeader)).toBe(withOwnHeader);
  });
});
