import { useEffect, useLayoutEffect, useRef } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { folderName, shortPath } from "../lib/format";
import { NEW_CHAT, selectCwd, selectModel, useAppStore } from "../store";
import type { PermissionMode } from "../types";
import { ModelPicker } from "./ModelPicker";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, FolderIcon, ShieldIcon, StopIcon } from "./icons";

const MAX_HEIGHT = 240;
// A stable reference: a selector must not return a fresh array on every call.
const NO_FOLDERS: string[] = [];

const PERMISSION_MODES: Array<{ mode: PermissionMode; label: string; detail: string }> = [
  { mode: "standard", label: "Ask first", detail: "Asks before running commands or editing files" },
  { mode: "acceptEdits", label: "Accept edits", detail: "Edits files freely, asks before commands" },
  { mode: "unrestricted", label: "Full access", detail: "Runs everything without asking" },
];

const menuContent =
  "z-50 min-w-[240px] rounded-xl border border-border bg-surface p-1 shadow-elevated";
const menuItem =
  "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-800 outline-none data-[highlighted]:bg-surface-tertiary";

function FolderMenu({ cwd }: { cwd: string }) {
  const recentCwds = useAppStore((state) => state.settings?.recentCwds ?? NO_FOLDERS);
  const setCwd = useAppStore((state) => state.setCwd);
  const pickCwd = useAppStore((state) => state.pickCwd);
  const others = recentCwds.filter((path) => path !== cwd);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="chip" title={`Working folder: ${cwd}`}>
        <FolderIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{folderName(cwd) || "Choose folder"}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menuContent} side="top" align="start" sideOffset={8}>
          <DropdownMenu.Label className="px-3 pb-1 pt-2 text-xs text-muted">
            The agent works in this folder
          </DropdownMenu.Label>
          <DropdownMenu.Item className={menuItem} disabled>
            <CheckIcon className="h-4 w-4 shrink-0 text-accent" />
            <span className="truncate font-mono text-xs">{shortPath(cwd)}</span>
          </DropdownMenu.Item>
          {others.map((path) => (
            <DropdownMenu.Item key={path} className={menuItem} onSelect={() => setCwd(path)}>
              <span className="w-4 shrink-0" />
              <span className="truncate font-mono text-xs" title={path}>
                {shortPath(path)}
              </span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={menuItem} onSelect={() => void pickCwd()}>
            <FolderIcon className="h-4 w-4 shrink-0 text-muted" />
            Choose folder...
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PermissionMenu() {
  const current = useAppStore((state) => state.settings?.permissionMode ?? "standard");
  const saveSettings = useAppStore((state) => state.saveSettings);
  const label = PERMISSION_MODES.find((item) => item.mode === current)?.label ?? current;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="chip" title="What the agent may do without asking">
        <ShieldIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menuContent} side="top" align="start" sideOffset={8}>
          {PERMISSION_MODES.map((item) => (
            <DropdownMenu.Item
              key={item.mode}
              className={menuItem}
              onSelect={() => void saveSettings({ permissionMode: item.mode })}
            >
              <span className="w-4 shrink-0">
                {item.mode === current && <CheckIcon className="h-4 w-4 text-accent" />}
              </span>
              <span>
                <span className="block">{item.label}</span>
                <span className="block text-xs text-muted">{item.detail}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Composer({ disabled }: { disabled: boolean }) {
  const activeId = useAppStore((state) => state.activeId);
  const key = activeId ?? NEW_CHAT;
  const draft = useAppStore((state) => state.drafts[key] ?? "");
  const running = useAppStore((state) =>
    activeId ? (state.chats[activeId]?.running ?? false) : state.pendingFirstMessage !== null,
  );
  const cwd = useAppStore((state) => selectCwd(state, key));
  const model = useAppStore((state) => selectModel(state, key));
  const models = useAppStore((state) => state.models);
  const setDraft = useAppStore((state) => state.setDraft);
  const setModel = useAppStore((state) => state.setModel);
  const send = useAppStore((state) => state.send);
  const stop = useAppStore((state) => state.stop);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT)}px`;
    input.style.overflowY = input.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [key, disabled]);

  const canSend = !disabled && !running && draft.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-5">
      <div className="rounded-2xl border border-border bg-surface shadow-card transition-colors focus-within:border-border-hover">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder={disabled ? "Connect to Letta to start" : "Ask your agent to do something"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter and IME composition insert a newline.
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (canSend) void send(draft);
          }}
          className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-ink-900 placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <FolderMenu cwd={cwd} />
            <ModelPicker value={model} models={models} onChange={setModel} className="min-w-0" />
            <PermissionMenu />
          </div>
          {running && activeId ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop"
              title="Stop"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 text-surface hover:opacity-80 transition-opacity"
            >
              <StopIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send(draft)}
              disabled={!canSend}
              aria-label="Send"
              title="Send (Enter)"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-brand-content transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUpIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
