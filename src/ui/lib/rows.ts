import type { ChatRow, ChatTextRow } from "../types";

/**
 * Identity used to reconcile a row across the live stream, restored history,
 * and the optimistic user row drawn before Letta has seen the message.
 * Keep in sync with `rowIdentity` in src/electron/libs/transcript.ts.
 */
export function rowIdentity(row: ChatRow): string {
  return row.kind !== "tool_call" && row.otid ? `${row.kind}:otid:${row.otid}` : row.key;
}

/** Replace rows that already exist and append the rest, keeping first-seen order. */
export function upsertRows(rows: ChatRow[], incoming: ChatRow[]): ChatRow[] {
  const next = [...rows];
  const index = new Map(next.map((row, position) => [rowIdentity(row), position]));
  for (const row of incoming) {
    const identity = rowIdentity(row);
    const position = index.get(identity);
    if (position === undefined) {
      index.set(identity, next.length);
      next.push(row);
    } else {
      next[position] = row;
    }
  }
  return next;
}

/** History rows first, then rows that only exist on screen (the live turn). */
export function mergeHistory(history: ChatRow[], current: ChatRow[]): ChatRow[] {
  const seen = new Set(history.map(rowIdentity));
  return [...history, ...current.filter((row) => !seen.has(rowIdentity(row)))];
}

/** The row drawn for a message the moment the user sends it. */
export function optimisticUserRow(text: string, otid: string): ChatTextRow {
  return { kind: "user", key: `user:otid:${otid}`, text, otid };
}
