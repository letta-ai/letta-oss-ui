import {
  createTranscriptAccumulator,
  type LettaConversationMessage,
  type TranscriptRow,
} from "@letta-ai/letta-agent-sdk";
import type { ChatRow } from "../types.js";

/**
 * Projection from the SDK's transcript rows to what the renderer draws.
 *
 * The SDK's transcript accumulator owns reconciliation (joining streamed
 * fragments, pairing tool calls with results, replaying history). This file
 * only narrows its rows and handles the details the accumulator leaves to the
 * application.
 */

const MAX_TOOL_OUTPUT_CHARS = 20_000;

/**
 * Letta injects environment context into user messages as `<system-reminder>`
 * blocks. They are part of the prompt, not something the user typed.
 */
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>\s*/g;

function clip(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  const hidden = text.length - MAX_TOOL_OUTPUT_CHARS;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... ${hidden.toLocaleString()} more characters`;
}

export function toChatRow(row: TranscriptRow): ChatRow {
  if (row.kind === "tool_call") {
    return {
      kind: "tool_call",
      key: row.key,
      toolCallId: row.toolCallId,
      toolName: row.toolName,
      toolInput: row.toolInput,
      status: row.status,
      ...(row.result
        ? { result: { content: clip(row.result.content), isError: row.result.isError } }
        : {}),
    };
  }
  return {
    kind: row.kind,
    key: row.key,
    text: row.kind === "user" ? row.text.replace(SYSTEM_REMINDER, "").trim() : row.text,
    ...(row.otid ? { otid: row.otid } : {}),
  };
}

/**
 * Identity used to reconcile a row across the live stream, restored history,
 * and the optimistic user row the renderer draws before Letta has seen it.
 * Keep in sync with `rowIdentity` in src/ui/lib/rows.ts.
 */
export function rowIdentity(row: ChatRow): string {
  return row.kind !== "tool_call" && row.otid ? `${row.kind}:otid:${row.otid}` : row.key;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/**
 * Tool calls the user refused. A refusal is recorded as an
 * `approval_response_message`, which is not transcript content, so without
 * this a denied call would restore as one still waiting for its result.
 */
function deniedToolCallIds(messages: readonly LettaConversationMessage[]): Set<string> {
  const denied = new Set<string>();
  for (const message of messages) {
    const source = asRecord(message);
    if (source?.message_type !== "approval_response_message") continue;

    const approvals = Array.isArray(source.approvals) ? source.approvals : [source];
    for (const entry of approvals) {
      const approval = asRecord(entry);
      const toolCallId = approval?.tool_call_id;
      if (typeof toolCallId !== "string") continue;
      if (approval?.approve === false || approval?.status === "error") denied.add(toolCallId);
    }
  }
  return denied;
}

/** Project a persisted history page (newest first) into renderer rows. */
export function projectHistory(messages: readonly LettaConversationMessage[]): ChatRow[] {
  const rows = createTranscriptAccumulator().rebase(messages, { order: "desc" });
  const denied = deniedToolCallIds(messages);

  const projected: ChatRow[] = [];
  for (const source of rows) {
    const row = toChatRow(source);
    if (row.kind === "tool_call") {
      projected.push(
        !row.result && denied.has(row.toolCallId)
          ? { ...row, status: "complete", result: { content: "Denied", isError: true } }
          : row,
      );
    } else if (row.text) {
      projected.push(row);
    }
  }
  return projected;
}

/** History rows first, then rows that only exist in the live stream. */
export function mergeHistory(history: ChatRow[], live: ChatRow[]): ChatRow[] {
  const seen = new Set(history.map(rowIdentity));
  return [...history, ...live.filter((row) => !seen.has(rowIdentity(row)))];
}

/**
 * Runtime errors arrive as JSON nested inside JSON strings. Dig out the
 * innermost human-readable message.
 */
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  let best = raw;

  const visit = (value: unknown, depth: number): void => {
    if (depth > 8) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      const start = trimmed.search(/[{[]/);
      if (start >= 0) {
        try {
          visit(JSON.parse(trimmed.slice(start)), depth + 1);
          return;
        } catch {
          // Not JSON after all - treat it as the message.
        }
      }
      if (trimmed) best = trimmed;
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    for (const key of ["error", "detail", "message"]) {
      if (record[key] !== undefined) {
        visit(record[key], depth + 1);
        return;
      }
    }
  };

  visit(raw, 0);
  return best || "Something went wrong.";
}
