import type { MemoryCommit, MemoryFile, MemoryOverview } from "../types.js";
import { request, requestChunks } from "./control.js";

// Wire shapes from the app server protocol (protocol_v2 in @letta-ai/letta-code),
// declared here because the package's type export for them does not resolve
// under Node module resolution.
type ListMemoryReply = {
  type: string;
  done: boolean;
  memfs_enabled?: boolean;
  entries: Array<{
    relative_path: string;
    is_system: boolean;
    description: string | null;
    content: string;
    size: number;
    kind?: "markdown" | "image";
  }>;
};

type MemoryHistoryReply = {
  type: string;
  commits: Array<{ sha: string; message: string; timestamp: string; author_name: string | null }>;
};

type MemoryFileAtRefReply = { type: string; content: string | null };

type MemoryFileReply = { type: string; content: string | null };

/**
 * An agent's memory: a git-backed folder of files (MemFS) that the agent reads
 * and maintains. Every write here is a commit, so history is always available.
 */

export async function listMemory(agentId: string): Promise<MemoryOverview> {
  const chunks = await requestChunks<ListMemoryReply>("list_memory", {
    agent_id: agentId,
  });
  const files: MemoryFile[] = chunks
    .flatMap((chunk) => chunk.entries)
    .map((entry) => ({
      path: entry.relative_path,
      system: entry.is_system,
      description: entry.description,
      // The body without its header. Image bytes are not sent to the UI.
      content: entry.kind === "image" ? "" : entry.content,
      size: entry.size,
      kind: entry.kind ?? "markdown",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { enabled: chunks[0]?.memfs_enabled !== false, files };
}

/**
 * The runtime checks every commit against its memory rules (a header on each
 * file, a MEMORY.md index in each folder, size limits, read-only files). Its
 * error is the raw git output; keep only the part that says what to fix.
 */
function describeMemoryError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const start = message.indexOf("Memory validation");
  if (start < 0) return new Error(message);

  const detail = message.slice(start);
  const problems = (
    detail.split("Fix these problems:")[1] ?? detail.replace(/^Memory validation failed:/, "")
  )
    .trim()
    // The problem list ends at the first blank line; advice for the agent follows.
    .split(/\n\s*\n/)[0]
    ?.trim();
  return new Error(`Letta's memory rules blocked this change. ${problems}`);
}

async function readCurrent(agentId: string, path: string): Promise<string | null> {
  try {
    const reply = await request<MemoryFileReply>("read_memory_file", { agent_id: agentId, path });
    return reply.content;
  } catch {
    return null;
  }
}

/**
 * The whole file, including its header. `listMemory` returns only the body, so
 * this is what an editor must load and save.
 */
export async function readMemoryFile(agentId: string, path: string): Promise<string> {
  const reply = await request<MemoryFileReply>("read_memory_file", { agent_id: agentId, path });
  return reply.content ?? "";
}

export async function writeMemoryFile(agentId: string, rawPath: string, content: string): Promise<void> {
  const path = rawPath.trim();
  const previous = await readCurrent(agentId, path);
  try {
    await request("write_memory_file", {
      agent_id: agentId,
      path,
      content,
      commit_message: `Edit ${path} in OSS-UI`,
    });
  } catch (error) {
    // A rejected commit leaves the change in the working tree, where it would
    // ride along with the agent's next commit. Put the file back as it was.
    await (
      previous === null
        ? request("delete_memory_file", { agent_id: agentId, path })
        : request("write_memory_file", { agent_id: agentId, path, content: previous })
    ).catch(() => undefined);
    throw describeMemoryError(error);
  }
}

export async function deleteMemoryFile(agentId: string, path: string): Promise<void> {
  const previous = await readCurrent(agentId, path);
  try {
    await request("delete_memory_file", {
      agent_id: agentId,
      path,
      commit_message: `Delete ${path} in OSS-UI`,
    });
  } catch (error) {
    // A file that was never committed is removed from disk, but then there is
    // nothing for git to record. The delete itself succeeded.
    if (/did not match any files/.test(String(error))) return;
    if (previous !== null) {
      await request("write_memory_file", { agent_id: agentId, path, content: previous }).catch(
        () => undefined,
      );
    }
    throw describeMemoryError(error);
  }
}

export async function listMemoryHistory(agentId: string, path: string): Promise<MemoryCommit[]> {
  const reply = await request<MemoryHistoryReply>("memory_history", {
    agent_id: agentId,
    file_path: path,
    limit: 50,
  });
  return reply.commits.map((commit) => ({
    sha: commit.sha,
    message: commit.message,
    timestamp: Date.parse(commit.timestamp) || 0,
    author: commit.author_name,
  }));
}

export async function readMemoryFileAt(agentId: string, path: string, sha: string): Promise<string> {
  const reply = await request<MemoryFileAtRefReply>("memory_file_at_ref", {
    agent_id: agentId,
    file_path: path,
    ref: sha,
  });
  return reply.content ?? "";
}
