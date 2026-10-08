import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EMPTY_CHAT, useAppStore } from "../store";
import type { ChatRow } from "../types";
import { ApprovalPanel } from "./ApprovalPanel";
import { Composer } from "./Composer";
import { TranscriptRow } from "./Transcript";
import { ArrowDownIcon, Spinner } from "./icons";

const FOLLOW_THRESHOLD = 80;
const HISTORY_STEP = 100;

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}

/** What fills the transcript area when there is no conversation to show. */
function Placeholder() {
  const connection = useAppStore((state) => state.connection);
  const agentsLoaded = useAppStore((state) => state.agentsLoaded);
  const agent = useAppStore((state) => state.agents.find((item) => item.id === state.agentId));
  const reconnect = useAppStore((state) => state.reconnect);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setNewAgentOpen = useAppStore((state) => state.setNewAgentOpen);

  if (connection?.status === "error") {
    return (
      <Centered>
        <h2 className="text-lg font-semibold text-ink-900">Can't connect to Letta</h2>
        <p className="mt-2 max-w-md break-words text-sm text-muted">{connection.error}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" className="button-primary" onClick={reconnect}>
            Try again
          </button>
          <button type="button" className="button-secondary" onClick={() => setSettingsOpen(true)}>
            Open Settings
          </button>
        </div>
      </Centered>
    );
  }

  if (connection?.status !== "ready" || !agentsLoaded) {
    return (
      <Centered>
        <Spinner className="h-5 w-5 text-muted" />
        <p className="mt-3 text-sm text-muted">Starting Letta</p>
      </Centered>
    );
  }

  if (!agent) {
    return (
      <Centered>
        <h2 className="text-lg font-semibold text-ink-900">Create your first agent</h2>
        <p className="mt-2 max-w-sm text-sm text-muted">
          An agent remembers what it learns across every chat, and works in the folders you point
          it at.
        </p>
        <button type="button" className="button-primary mt-5" onClick={() => setNewAgentOpen(true)}>
          Create agent
        </button>
      </Centered>
    );
  }

  return (
    <Centered>
      <h2 className="text-xl font-semibold text-ink-900">What should {agent.name} work on?</h2>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Pick a folder below, then describe the task. The agent can read and edit files and run
        commands there.
      </p>
    </Centered>
  );
}

export function ChatView() {
  const activeId = useAppStore((state) => state.activeId);
  const chat = useAppStore((state) => (activeId ? state.chats[activeId] : undefined)) ?? EMPTY_CHAT;
  const pendingFirstMessage = useAppStore((state) => state.pendingFirstMessage);
  const title = useAppStore(
    (state) => state.conversations.find((item) => item.id === activeId)?.title,
  );
  const ready = useAppStore(
    (state) => state.connection?.status === "ready" && state.agentId !== null,
  );
  const loadHistory = useAppStore((state) => state.loadHistory);
  const respondApproval = useAppStore((state) => state.respondApproval);

  const rows: ChatRow[] = activeId ? chat.rows : pendingFirstMessage ? [pendingFirstMessage] : [];
  const running = activeId ? chat.running : pendingFirstMessage !== null;
  const activity = activeId ? chat.activity : pendingFirstMessage ? "Starting" : null;
  const approval = activeId ? chat.approvals[0] : undefined;
  const loadingFirstPage = Boolean(activeId) && !chat.loaded;
  const showPlaceholder = rows.length === 0 && !loadingFirstPage && !chat.error;

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const heightBeforeLoadRef = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  const follow = useCallback(() => {
    followingRef.current = true;
    setFollowing(true);
    scrollToBottom();
  }, [scrollToBottom]);

  // Keep the newest output in view while the reader is at the bottom.
  // The viewport is watched too: it shrinks when an approval prompt appears.
  useEffect(() => {
    const content = contentRef.current;
    const container = scrollRef.current;
    if (!content || !container) return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scrollToBottom();
    });
    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToBottom, showPlaceholder]);

  // Switching chats or starting a turn returns to the latest message. The
  // scroll event this causes brings the `following` state back in line.
  useLayoutEffect(() => {
    followingRef.current = true;
    scrollToBottom();
  }, [activeId, running, scrollToBottom]);

  // Loading earlier messages must not move what the reader is looking at.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || heightBeforeLoadRef.current === null || chat.loading) return;
    container.scrollTop += container.scrollHeight - heightBeforeLoadRef.current;
    heightBeforeLoadRef.current = null;
  }, [chat.rows, chat.loading]);

  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < FOLLOW_THRESHOLD;
    followingRef.current = atBottom;
    setFollowing(atBottom);
  };

  const loadEarlier = () => {
    if (!activeId || chat.loading) return;
    heightBeforeLoadRef.current = scrollRef.current?.scrollHeight ?? null;
    followingRef.current = false;
    setFollowing(false);
    void loadHistory(activeId, chat.limit + HISTORY_STEP);
  };

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-surface">
      <header className="app-drag flex h-12 shrink-0 items-center justify-center border-b border-border px-6">
        <span className="truncate text-sm font-medium text-ink-700">
          {activeId ? title || "New chat" : "New chat"}
        </span>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {showPlaceholder ? (
          <Placeholder />
        ) : (
          <div ref={contentRef} className="mx-auto grid w-full max-w-3xl gap-4 px-6 py-6">
            {loadingFirstPage && (
              <div className="flex justify-center py-8">
                <Spinner className="h-5 w-5 text-muted" />
              </div>
            )}
            {chat.loaded && chat.hasMore && (
              <button
                type="button"
                onClick={loadEarlier}
                disabled={chat.loading}
                className="mx-auto flex items-center gap-2 rounded-full px-3 py-1 text-xs text-muted hover:bg-surface-tertiary hover:text-ink-800 transition-colors"
              >
                {chat.loading && <Spinner className="h-3 w-3" />}
                Load earlier messages
              </button>
            )}
            {rows.map((row, index) => (
              <TranscriptRow
                key={row.key}
                row={row}
                running={running}
                active={running && index === rows.length - 1}
              />
            ))}
            {running && activity && (
              <div className="flex items-center gap-2 text-sm text-muted" role="status">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                {activity}
              </div>
            )}
            {chat.error && (
              <div
                role="alert"
                className="whitespace-pre-wrap break-words rounded-xl border border-error/20 bg-error-light px-3.5 py-2.5 text-sm text-error"
              >
                {chat.error}
              </div>
            )}
          </div>
        )}
      </div>

      {!following && rows.length > 0 && (
        <div className="pointer-events-none relative h-0">
          <button
            type="button"
            onClick={follow}
            aria-label="Jump to latest"
            className="pointer-events-auto absolute bottom-3 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface text-ink-700 shadow-card hover:bg-surface-tertiary"
          >
            <ArrowDownIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {approval && (
        <ApprovalPanel
          request={approval}
          queued={chat.approvals.length - 1}
          onDecide={(decision) => respondApproval(approval.requestId, decision)}
        />
      )}
      <Composer disabled={!ready} />
    </main>
  );
}
