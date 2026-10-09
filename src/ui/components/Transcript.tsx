import { memo, useState } from "react";
import { relativeToFolder, toolLabel, toolSummary } from "../lib/format";
import MDContent from "../render/markdown";
import type { ChatRow, ChatTextRow, ChatToolRow } from "../types";
import { CheckIcon, ChevronRightIcon, CloseIcon, Spinner } from "./icons";

const UserMessage = ({ row }: { row: ChatTextRow }) => (
  <div className="flex justify-end">
    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-surface-tertiary px-4 py-2.5 text-ink-900">
      {row.text}
    </div>
  </div>
);

const AssistantMessage = ({ row }: { row: ChatTextRow }) => (
  <div className="min-w-0 break-words">
    <MDContent text={row.text} />
  </div>
);

function Reasoning({ row, active }: { row: ChatTextRow; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-muted hover:text-ink-700 transition-colors"
      >
        <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className={active ? "animate-pulse" : ""}>{active ? "Thinking" : "Thought"}</span>
      </button>
      {open && (
        <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-ink-600">
          {row.text}
        </div>
      )}
    </div>
  );
}

function ToolStatus({ row, running }: { row: ChatToolRow; running: boolean }) {
  if (row.result) {
    return row.result.isError ? (
      <CloseIcon className="h-3.5 w-3.5 shrink-0 text-error" />
    ) : (
      <CheckIcon className="h-3.5 w-3.5 shrink-0 text-success" />
    );
  }
  // A call with no result is only in flight while its turn is.
  return running ? (
    <Spinner className="h-3.5 w-3.5 shrink-0 text-muted" />
  ) : (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-light" title="No result" />
  );
}

function ToolCall({ row, running, cwd }: { row: ChatToolRow; running: boolean; cwd: string }) {
  const [open, setOpen] = useState(false);
  const summary = relativeToFolder(toolSummary(row.toolInput), cwd);
  const hasInput = Object.keys(row.toolInput).length > 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-secondary text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-tertiary transition-colors"
      >
        <ToolStatus row={row} running={running} />
        <span className="shrink-0 font-medium text-ink-800">{toolLabel(row.toolName)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{summary}</span>
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="grid gap-2 border-t border-border px-3 py-2.5">
          {hasInput && (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ink-700">
              {JSON.stringify(row.toolInput, null, 2)}
            </pre>
          )}
          {row.result && (
            <pre
              className={`max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-tertiary p-2.5 font-mono text-xs ${row.result.isError ? "text-error" : "text-ink-700"}`}
            >
              {row.result.content || "(no output)"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One transcript row. `active` marks the last row of a running turn, which is
 * the only row still being written.
 */
export const TranscriptRow = memo(function TranscriptRow({
  row,
  active,
  running,
  cwd,
}: {
  row: ChatRow;
  active: boolean;
  running: boolean;
  /** The chat's working folder, used to shorten the paths tools report. */
  cwd: string;
}) {
  switch (row.kind) {
    case "user":
      return <UserMessage row={row} />;
    case "assistant":
      return <AssistantMessage row={row} />;
    case "reasoning":
      return <Reasoning row={row} active={active} />;
    case "tool_call":
      return <ToolCall row={row} running={running} cwd={cwd} />;
  }
});
