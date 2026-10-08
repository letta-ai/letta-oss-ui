import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { modelLabel, relativeTime } from "../lib/format";
import { useAppStore } from "../store";
import type { ConnectionState, ConversationSummary } from "../types";
import { CheckIcon, ChevronDownIcon, MoreIcon, PlusIcon, SettingsIcon, Spinner } from "./icons";

const isMac = window.cowork.platform === "darwin";

const menuContent =
  "z-50 min-w-[220px] rounded-xl border border-border bg-surface p-1 shadow-elevated";
const menuItem =
  "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-800 outline-none data-[highlighted]:bg-surface-tertiary";

function AgentSwitcher() {
  const agents = useAppStore((state) => state.agents);
  const agentId = useAppStore((state) => state.agentId);
  const models = useAppStore((state) => state.models);
  const selectAgent = useAppStore((state) => state.selectAgent);
  const setNewAgentOpen = useAppStore((state) => state.setNewAgentOpen);
  const current = agents.find((agent) => agent.id === agentId);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-ink-900/5 transition-colors outline-none">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-900">
            {current?.name ?? "No agent"}
          </span>
          <span className="block truncate text-xs text-muted">
            {current ? modelLabel(current.model, models) : "Create an agent to begin"}
          </span>
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={`${menuContent} w-[256px]`} align="start" sideOffset={6}>
          <div className="max-h-72 overflow-y-auto">
            {agents.map((agent) => (
              <DropdownMenu.Item
                key={agent.id}
                className={menuItem}
                onSelect={() => agent.id !== agentId && void selectAgent(agent.id)}
              >
                <span className="w-4 shrink-0">
                  {agent.id === agentId && <CheckIcon className="h-4 w-4 text-accent" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{agent.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {modelLabel(agent.model, models)}
                  </span>
                </span>
              </DropdownMenu.Item>
            ))}
          </div>
          {agents.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
          <DropdownMenu.Item className={menuItem} onSelect={() => setNewAgentOpen(true)}>
            <PlusIcon className="h-4 w-4 shrink-0 text-muted" />
            New agent...
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ConversationItem({
  conversation,
  now,
  onRename,
  onResume,
}: {
  conversation: ConversationSummary;
  now: number;
  onRename: (conversation: ConversationSummary) => void;
  onResume: (conversation: ConversationSummary) => void;
}) {
  const active = useAppStore((state) => state.activeId === conversation.id);
  const running = useAppStore((state) => state.chats[conversation.id]?.running ?? false);
  const waiting = useAppStore((state) => (state.chats[conversation.id]?.approvals.length ?? 0) > 0);
  const openChat = useAppStore((state) => state.openChat);
  const archiveConversation = useAppStore((state) => state.archiveConversation);

  return (
    <div
      className={`group relative flex items-center rounded-lg transition-colors ${active ? "bg-ink-900/8" : "hover:bg-ink-900/5"}`}
    >
      <button
        type="button"
        onClick={() => openChat(conversation.id)}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1 text-left outline-none"
      >
        <span className={`min-w-0 flex-1 truncate text-sm ${active ? "text-ink-900" : "text-ink-800"}`}>
          {conversation.title || "New chat"}
        </span>
        {running ? (
          waiting ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-warning" title="Waiting for you" />
          ) : (
            <Spinner className="h-3.5 w-3.5 shrink-0 text-muted" />
          )
        ) : (
          <span className="shrink-0 text-xs text-muted-light group-hover:hidden">
            {relativeTime(conversation.updatedAt, now)}
          </span>
        )}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label="Chat options"
          className="mr-1 hidden shrink-0 rounded-md p-1 text-muted hover:bg-ink-900/10 hover:text-ink-800 group-hover:block data-[state=open]:block outline-none"
        >
          <MoreIcon className="h-4 w-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={menuContent} align="start" sideOffset={6}>
            <DropdownMenu.Item className={menuItem} onSelect={() => onRename(conversation)}>
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItem} onSelect={() => onResume(conversation)}>
              Resume in Letta Code
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              className={`${menuItem} text-error`}
              onSelect={() => void archiveConversation(conversation.id)}
            >
              Archive
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: ConnectionState | null }) {
  if (!connection || connection.status === "connecting") {
    return (
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <Spinner className="h-3 w-3 shrink-0" />
        Connecting
      </span>
    );
  }
  const ready = connection.status === "ready";
  return (
    <span
      className="flex min-w-0 items-center gap-2 text-xs text-muted"
      title={ready ? connection.detail : connection.error}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${ready ? "bg-success" : "bg-error"}`} />
      <span className="truncate">{ready ? connection.detail : "Not connected"}</span>
    </span>
  );
}

const dialogOverlay = "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]";
const dialogContent =
  "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-elevated focus:outline-none";

function RenameDialog({
  conversation,
  onClose,
}: {
  conversation: ConversationSummary;
  onClose: () => void;
}) {
  const renameConversation = useAppStore((state) => state.renameConversation);
  const [title, setTitle] = useState(conversation.title);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogContent} aria-describedby={undefined}>
          <Dialog.Title className="text-base font-semibold text-ink-900">Rename chat</Dialog.Title>
          <form
            className="mt-3 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) void renameConversation(conversation.id, title);
              onClose();
            }}
          >
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="field"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="button-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="button-primary" disabled={!title.trim()}>
                Rename
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ResumeDialog({
  conversation,
  onClose,
}: {
  conversation: ConversationSummary;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const command = `letta --conv ${conversation.id}`;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogContent}>
          <Dialog.Title className="text-base font-semibold text-ink-900">
            Resume in Letta Code
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            Run this in a terminal to continue the chat from the command line.
          </Dialog.Description>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-tertiary px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-ink-900">{command}</code>
            <button
              type="button"
              className="button-secondary shrink-0"
              onClick={() => {
                void navigator.clipboard.writeText(command).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Sidebar() {
  const conversations = useAppStore((state) => state.conversations);
  const conversationsLoaded = useAppStore((state) => state.conversationsLoaded);
  const agentId = useAppStore((state) => state.agentId);
  const connection = useAppStore((state) => state.connection);
  const openChat = useAppStore((state) => state.openChat);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [resuming, setResuming] = useState<ConversationSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Keep the relative timestamps fresh.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className={`app-drag shrink-0 ${isMac ? "h-12" : "h-3"}`} />
      <div className="px-2.5">
        <AgentSwitcher />
        <button
          type="button"
          disabled={!agentId}
          onClick={() => openChat(null)}
          className="mt-2 flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-ink-800 hover:bg-surface-tertiary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          New chat
          <kbd className="ml-auto font-sans text-xs text-muted-light">{isMac ? "⌘N" : "Ctrl+N"}</kbd>
        </button>
      </div>

      <nav className="mt-3 min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {agentId && conversationsLoaded && conversations.length === 0 && (
          <p className="px-2.5 py-3 text-xs text-muted">No chats yet.</p>
        )}
        <div className="flex flex-col gap-0.5">
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              now={now}
              onRename={setRenaming}
              onResume={setResuming}
            />
          ))}
        </div>
      </nav>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
        <ConnectionBadge connection={connection} />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
          className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-ink-900/8 hover:text-ink-800 transition-colors"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>

      {renaming && <RenameDialog conversation={renaming} onClose={() => setRenaming(null)} />}
      {resuming && <ResumeDialog conversation={resuming} onClose={() => setResuming(null)} />}
    </aside>
  );
}
