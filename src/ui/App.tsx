import { useEffect } from "react";
import { AgentSettingsDialog } from "./components/AgentSettingsDialog";
import { ChatView } from "./components/ChatView";
import { MemoryView } from "./components/MemoryView";
import { NewAgentDialog } from "./components/NewAgentDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { CloseIcon } from "./components/icons";
import { useAppStore } from "./store";

const NOTICE_TIMEOUT_MS = 8_000;

function Notice() {
  const notice = useAppStore((state) => state.notice);
  const setNotice = useAppStore((state) => state.setNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  if (!notice) return null;
  return (
    <div
      role="alert"
      className="fixed left-1/2 top-4 z-[60] flex max-w-lg -translate-x-1/2 items-start gap-3 rounded-xl border border-error/20 bg-error-light px-4 py-3 shadow-elevated"
    >
      <span className="min-w-0 break-words text-sm text-error">{notice}</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 text-error hover:opacity-70"
        onClick={() => setNotice(null)}
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function App() {
  const view = useAppStore((state) => state.view);
  // Keyed by agent so switching agents starts the memory view fresh.
  const agentId = useAppStore((state) => state.agentId);

  useEffect(() => {
    const { handleEvent, bootstrap, setNotice } = useAppStore.getState();
    // Subscribe before the first fetch so no state change is missed.
    const unsubscribe = window.bridge.onEvent(handleEvent);
    bootstrap().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : String(error));
    });
    return unsubscribe;
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-ink-900">
      <Sidebar />
      {view === "memory" ? <MemoryView key={agentId} /> : <ChatView />}
      <SettingsDialog />
      <NewAgentDialog />
      <AgentSettingsDialog />
      <Notice />
    </div>
  );
}
