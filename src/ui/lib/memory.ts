/** Path and header helpers for an agent's memory files. */

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Index files list what a folder holds. They are the one file type without a header. */
export function isIndexFile(path: string): boolean {
  return /(^|\/)MEMORY\.md$/.test(path);
}

/**
 * Letta requires every memory file except an index to start with a header
 * naming and describing it. The new-file form writes that header for the user.
 */
export function withHeader(path: string, description: string, body: string): string {
  if (isIndexFile(path) || body.startsWith("---")) return body;
  const name = fileName(path).replace(/\.[^.]+$/, "");
  // The runtime reads these as plain single-line values, so they are not quoted.
  const summary = description.replace(/\s+/g, " ").trim();
  return `---\nname: ${name}\ndescription: ${summary}\n---\n\n${body}`;
}
