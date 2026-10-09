import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { relativeTime } from "../lib/format";
import MDContent from "../render/markdown";
import { useAppStore } from "../store";
import type { MemoryCommit, MemoryFile } from "../types";
import { HistoryIcon, PlusIcon, RefreshIcon, Spinner } from "./icons";

const api = window.cowork;

/** What the right-hand pane is doing with the selected file. */
type Mode =
  | { kind: "view" }
  // `original` is the whole file as loaded, header included. null while loading.
  | { kind: "edit"; original: string | null; draft: string }
  | { kind: "new"; path: string; description: string; draft: string }
  | {
      kind: "history";
      commits: MemoryCommit[] | null;
      /** The whole current file, to tell which version is the live one. */
      current: string;
      sha: string | null;
      content: string | null;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Index files list what a folder holds. They are the one file type without a header. */
function isIndexFile(path: string): boolean {
  return /(^|\/)MEMORY\.md$/.test(path);
}

/**
 * Letta requires every memory file except an index to start with a header
 * naming and describing it. The new-file form writes that header for the user.
 */
function withHeader(path: string, description: string, body: string): string {
  if (isIndexFile(path) || body.startsWith("---")) return body;
  const name = fileName(path).replace(/\.[^.]+$/, "");
  // The runtime reads these as plain single-line values, so they are not quoted.
  const summary = description.replace(/\s+/g, " ").trim();
  return `---\nname: ${name}\ndescription: ${summary}\n---\n\n${body}`;
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function FileList({
  files,
  selected,
  onSelect,
}: {
  files: MemoryFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const groups = useMemo(() => {
    const byDirectory = new Map<string, MemoryFile[]>();
    for (const file of files) {
      const directory = directoryOf(file.path);
      byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), file]);
    }
    return [...byDirectory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);

  return (
    <div className="grid gap-3">
      {groups.map(([directory, group]) => (
        <div key={directory}>
          {directory && (
            <div className="truncate px-2.5 pb-1 font-mono text-[11px] text-muted">
              {directory}/
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {group.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => onSelect(file.path)}
                title={file.description ?? file.path}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${selected === file.path ? "bg-ink-900/8 text-ink-900" : "text-ink-800 hover:bg-ink-900/5"}`}
              >
                <span className="min-w-0 flex-1 truncate">{fileName(file.path)}</span>
                {file.system && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    title="Always in the agent's context"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function History({
  mode,
  onPick,
  onRestore,
  busy,
}: {
  mode: Extract<Mode, { kind: "history" }>;
  onPick: (sha: string) => void;
  onRestore: (content: string) => void;
  busy: boolean;
}) {
  if (!mode.commits) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-5 w-5 text-muted" />
      </div>
    );
  }
  if (mode.commits.length === 0) {
    return <p className="py-6 text-sm text-muted">This file has no saved history yet.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto">
        {mode.commits.map((commit) => (
          <button
            key={commit.sha}
            type="button"
            onClick={() => onPick(commit.sha)}
            className={`rounded-lg px-2.5 py-1.5 text-left transition-colors ${mode.sha === commit.sha ? "bg-ink-900/8" : "hover:bg-ink-900/5"}`}
          >
            <span className="block truncate text-sm text-ink-900">{commit.message}</span>
            <span className="block truncate text-xs text-muted">
              {relativeTime(commit.timestamp)}
              {commit.author ? ` by ${commit.author}` : ""}
            </span>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {mode.sha === null ? (
          <p className="py-6 text-sm text-muted">Choose a version to see the file at that point.</p>
        ) : mode.content === null ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-5 w-5 text-muted" />
          </div>
        ) : (
          <>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-tertiary p-3 font-mono text-xs text-ink-800">
              {mode.content || "(empty)"}
            </pre>
            <div>
              <button
                type="button"
                className="button-secondary"
                disabled={busy || mode.content === mode.current}
                onClick={() => onRestore(mode.content ?? "")}
              >
                {mode.content === mode.current ? "This is the current version" : "Restore this version"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MemoryView() {
  const agent = useAppStore((state) => state.agents.find((item) => item.id === state.agentId));
  const memory = useAppStore((state) => state.memory);
  const loadMemory = useAppStore((state) => state.loadMemory);
  const saveMemoryFile = useAppStore((state) => state.saveMemoryFile);
  const deleteMemoryFile = useAppStore((state) => state.deleteMemoryFile);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The navigation waiting on the user's answer to "discard your changes?".
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

  const files = memory?.files ?? [];
  const file =
    files.find((item) => item.path === selectedPath) ??
    // Open on the index file when there is one, otherwise the first file.
    files.find((item) => item.path === "MEMORY.md") ??
    files[0];
  const agentId = agent?.id;

  const hasUnsavedEdit =
    (mode.kind === "edit" && mode.original !== null && mode.draft !== mode.original) ||
    (mode.kind === "new" &&
      (mode.draft.length > 0 || mode.path.length > 0 || mode.description.length > 0));

  const leaveNow = (next: () => void) => {
    setPendingLeave(null);
    setError(null);
    setConfirmingDelete(false);
    next();
  };

  /** Run a navigation, asking first if it would throw away an edit. */
  const leave = (next: () => void) => {
    if (hasUnsavedEdit) setPendingLeave(() => next);
    else leaveNow(next);
  };

  // The file list carries each file's body only. Editing and history work on
  // the whole file, so it is loaded when either one opens.
  const loading =
    (mode.kind === "edit" && mode.original === null) ||
    (mode.kind === "history" && mode.commits === null);
  const loadingKind = loading ? mode.kind : null;
  const loadingPath = loading ? file?.path : undefined;
  useEffect(() => {
    if (!agentId || !loadingPath || !loadingKind) return;
    let cancelled = false;
    const load =
      loadingKind === "edit"
        ? api.readMemoryFile(agentId, loadingPath).then((original): Mode => ({
            kind: "edit",
            original,
            draft: original,
          }))
        : Promise.all([
            api.listMemoryHistory(agentId, loadingPath),
            api.readMemoryFile(agentId, loadingPath),
          ]).then(([commits, current]): Mode => ({
            kind: "history",
            commits,
            current,
            sha: null,
            content: null,
          }));
    load
      .then((next) => {
        if (!cancelled) setMode(next);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setError(errorMessage(failure));
        setMode({ kind: "view" });
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, loadingKind, loadingPath]);

  const pickVersion = (sha: string) => {
    if (!agentId || !file || mode.kind !== "history") return;
    setMode({ ...mode, sha, content: null });
    api
      .readMemoryFileAt(agentId, file.path, sha)
      .then((content) =>
        setMode((current) =>
          current.kind === "history" && current.sha === sha ? { ...current, content } : current,
        ),
      )
      .catch((failure: unknown) => setError(errorMessage(failure)));
  };

  const run = async (action: () => Promise<void>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (mode.kind === "edit" && file) {
      void run(
        () => saveMemoryFile(file.path, mode.draft),
        () => setMode({ kind: "view" }),
      );
    } else if (mode.kind === "new") {
      const path = mode.path.trim().replace(/^\/+/, "");
      if (files.some((item) => item.path === path)) {
        setError(`${path} already exists.`);
        return;
      }
      void run(
        () => saveMemoryFile(path, withHeader(path, mode.description, mode.draft)),
        () => {
          setSelectedPath(path);
          setMode({ kind: "view" });
        },
      );
    }
  };

  const editing = mode.kind === "edit" || mode.kind === "new";

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="app-drag flex h-12 shrink-0 items-center justify-center border-b border-border px-6">
        <span className="truncate text-sm font-medium text-ink-700">
          {agent ? `${agent.name}'s memory` : "Memory"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col border-r border-border">
          <div className="flex items-center gap-1 px-2.5 py-2.5">
            <button
              type="button"
              className="button-secondary flex-1"
              disabled={!memory?.enabled}
              onClick={() =>
                leave(() => setMode({ kind: "new", path: "", description: "", draft: "" }))
              }
            >
              <PlusIcon className="h-3.5 w-3.5" />
              New file
            </button>
            <button
              type="button"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => void loadMemory()}
              className="rounded-lg p-2 text-muted hover:bg-ink-900/8 hover:text-ink-800 transition-colors"
            >
              {memory?.loading ? <Spinner className="h-4 w-4" /> : <RefreshIcon className="h-4 w-4" />}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
            <FileList
              files={files}
              selected={mode.kind === "new" ? null : (file?.path ?? null)}
              onSelect={(path) =>
                leave(() => {
                  setSelectedPath(path);
                  setMode({ kind: "view" });
                })
              }
            />
          </div>
          {files.some((item) => item.system) && (
            <p className="flex items-center gap-2 border-t border-border px-3.5 py-2.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              Always in the agent's context
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {memory?.error ? (
            <div className="p-6 text-sm text-error" role="alert">
              {memory.error}
            </div>
          ) : !memory || (memory.loading && files.length === 0) ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="h-5 w-5 text-muted" />
            </div>
          ) : !memory.enabled ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <h2 className="text-lg font-semibold text-ink-900">No memory files</h2>
              <p className="mt-2 max-w-sm text-sm text-muted">
                This agent does not use file-based memory, so there is nothing to show here.
              </p>
            </div>
          ) : mode.kind === "new" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-ink-700">File path</span>
                <input
                  autoFocus
                  value={mode.path}
                  onChange={(event) => setMode({ ...mode, path: event.target.value })}
                  placeholder="project-notes.md"
                  spellCheck={false}
                  className="field font-mono"
                />
                <span className="text-xs text-muted">
                  A file in a new folder needs that folder to have its own MEMORY.md index.
                </span>
              </label>
              {!isIndexFile(mode.path.trim()) && (
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-ink-700">Description</span>
                  <input
                    value={mode.description}
                    onChange={(event) => setMode({ ...mode, description: event.target.value })}
                    placeholder="One line that tells the agent when to read this file"
                    className="field"
                  />
                </label>
              )}
              <textarea
                value={mode.draft}
                onChange={(event) => setMode({ ...mode, draft: event.target.value })}
                placeholder="What should the agent remember?"
                spellCheck={false}
                className="field min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed"
              />
            </div>
          ) : !file ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <h2 className="text-lg font-semibold text-ink-900">Nothing remembered yet</h2>
              <p className="mt-2 max-w-sm text-sm text-muted">
                The agent writes memory files as it works. You can also add one yourself.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm text-ink-900">{file.path}</div>
                  {file.description && (
                    <div className="truncate text-xs text-muted">{file.description}</div>
                  )}
                </div>
                {mode.kind === "view" && file.kind === "markdown" && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setMode({ kind: "edit", original: null, draft: "" })}
                  >
                    Edit
                  </button>
                )}
                {mode.kind !== "edit" && (
                  <button
                    type="button"
                    className="button-secondary"
                    aria-pressed={mode.kind === "history"}
                    onClick={() =>
                      setMode(
                        mode.kind === "history"
                          ? { kind: "view" }
                          : { kind: "history", commits: null, current: "", sha: null, content: null },
                      )
                    }
                  >
                    <HistoryIcon className="h-3.5 w-3.5" />
                    {mode.kind === "history" ? "Close history" : "History"}
                  </button>
                )}
                {mode.kind === "view" &&
                  (confirmingDelete ? (
                    <>
                      <button
                        type="button"
                        className="button-secondary text-error"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => deleteMemoryFile(file.path),
                            () => {
                              setSelectedPath(null);
                              setConfirmingDelete(false);
                            },
                          )
                        }
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setConfirmingDelete(false)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete
                    </button>
                  ))}
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
                {mode.kind === "edit" && mode.original === null ? (
                  <div className="flex justify-center py-10">
                    <Spinner className="h-5 w-5 text-muted" />
                  </div>
                ) : mode.kind === "edit" ? (
                  <textarea
                    autoFocus
                    value={mode.draft}
                    onChange={(event) => setMode({ ...mode, draft: event.target.value })}
                    spellCheck={false}
                    className="field min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed"
                  />
                ) : mode.kind === "history" ? (
                  <History
                    mode={mode}
                    busy={busy}
                    onPick={pickVersion}
                    onRestore={(content) =>
                      void run(
                        () => saveMemoryFile(file.path, content),
                        () => setMode({ kind: "view" }),
                      )
                    }
                  />
                ) : file.kind === "image" ? (
                  <p className="text-sm text-muted">This is an image file. It cannot be shown here.</p>
                ) : (
                  <div className="mx-auto w-full max-w-3xl">
                    {file.content.trim() ? (
                      <MDContent text={file.content} />
                    ) : (
                      <p className="text-sm text-muted">This file is empty.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {(editing || error) && (
            <div className="flex items-center gap-3 border-t border-border px-5 py-3">
              <p className="min-w-0 flex-1 break-words text-xs text-error" role="alert">
                {error}
              </p>
              {editing && (
                <>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => leave(() => setMode({ kind: "view" }))}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button-primary"
                    disabled={
                      busy ||
                      (mode.kind === "new" &&
                        (!mode.path.trim() ||
                          (!isIndexFile(mode.path.trim()) && !mode.description.trim()))) ||
                      (mode.kind === "edit" && mode.draft === mode.original)
                    }
                    onClick={save}
                  >
                    {busy && <Spinner className="h-3.5 w-3.5" />}
                    Save
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog.Root open={pendingLeave !== null} onOpenChange={(open) => !open && setPendingLeave(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-elevated focus:outline-none"
          >
            <Dialog.Title className="text-base font-semibold text-ink-900">
              Discard your changes?
            </Dialog.Title>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="button-secondary" onClick={() => setPendingLeave(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => pendingLeave && leaveNow(pendingLeave)}
              >
                Discard
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
