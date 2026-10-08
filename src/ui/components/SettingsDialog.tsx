import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAppStore } from "../store";
import type { AppSettings, BackendKind, SettingsUpdate } from "../types";
import { CloseIcon, Spinner } from "./icons";

const BACKENDS: Array<{ kind: BackendKind; label: string; detail: string }> = [
  {
    kind: "local",
    label: "This computer",
    detail: "Agents and their memory are stored on this machine. No account needed.",
  },
  {
    kind: "cloud",
    label: "Letta Cloud",
    detail: "Agents are stored in Letta Cloud. Tools still run on this machine.",
  },
  {
    kind: "remote",
    label: "Self-hosted server",
    detail: "Connect to a Letta app server you run yourself.",
  },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-ink-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function SettingsForm({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const connection = useAppStore((state) => state.connection);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const reconnect = useAppStore((state) => state.reconnect);

  const [backend, setBackend] = useState(settings.backend);
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [serverToken, setServerToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const update: SettingsUpdate = { backend };
    if (backend === "cloud") {
      update.apiBaseUrl = apiBaseUrl;
      // An empty field keeps the saved key.
      if (apiKey.trim()) update.apiKey = apiKey;
    }
    if (backend === "remote") {
      update.serverUrl = serverUrl;
      if (serverToken.trim()) update.serverToken = serverToken;
    }
    try {
      await saveSettings(update);
      setApiKey("");
      setServerToken("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const canSave = backend !== "remote" || serverUrl.trim().length > 0;

  return (
    <form
      className="mt-4 grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void save();
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-medium text-ink-700">Where your agents live</legend>
        {BACKENDS.map((option) => (
          <label
            key={option.kind}
            className={`flex cursor-pointer gap-3 rounded-xl border px-3.5 py-3 transition-colors ${backend === option.kind ? "border-accent bg-accent-subtle" : "border-border hover:bg-surface-tertiary"}`}
          >
            <input
              type="radio"
              name="backend"
              className="mt-1 accent-[var(--color-accent)]"
              checked={backend === option.kind}
              onChange={() => setBackend(option.kind)}
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">{option.label}</span>
              <span className="block text-xs text-muted">{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {backend === "cloud" && (
        <div className="grid gap-3">
          <Field
            label="API key"
            hint={
              settings.hasApiKey
                ? "A key is saved. Enter a new one to replace it."
                : "Create one at app.letta.com/settings. Leave empty if you ran `letta login`."
            }
          >
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasApiKey ? "Saved" : "sk-let-..."}
              className="field font-mono"
            />
          </Field>
          <Field label="API base URL" hint="Optional. Leave empty for api.letta.com.">
            <input
              value={apiBaseUrl}
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="https://api.letta.com"
              className="field font-mono"
            />
          </Field>
        </div>
      )}

      {backend === "remote" && (
        <div className="grid gap-3">
          <Field
            label="Server URL"
            hint="Start one with: letta server --backend local --listen ws://127.0.0.1:4500"
          >
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="ws://127.0.0.1:4500"
              className="field font-mono"
            />
          </Field>
          <Field
            label="Access token"
            hint={
              settings.hasServerToken
                ? "A token is saved. Enter a new one to replace it."
                : "Only needed if the server was started with --ws-auth."
            }
          >
            <input
              type="password"
              autoComplete="off"
              value={serverToken}
              onChange={(event) => setServerToken(event.target.value)}
              placeholder={settings.hasServerToken ? "Saved" : "Optional"}
              className="field font-mono"
            />
          </Field>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <div className="min-w-0 flex-1 text-xs" role="status">
          {error ? (
            <span className="text-error">{error}</span>
          ) : !connection || connection.status === "connecting" ? (
            <span className="flex items-center gap-2 text-muted">
              <Spinner className="h-3 w-3" />
              Connecting
            </span>
          ) : connection.status === "ready" ? (
            <span className="text-success">Connected to {connection.detail}</span>
          ) : (
            <span className="flex items-start gap-2 text-error">
              <span className="min-w-0 break-words">{connection.error}</span>
              <button type="button" className="shrink-0 underline" onClick={reconnect}>
                Retry
              </button>
            </span>
          )}
        </div>
        <button type="button" className="button-secondary" onClick={onClose}>
          Close
        </button>
        <button type="submit" className="button-primary" disabled={!canSave || saving}>
          Save
        </button>
      </div>
    </form>
  );
}

export function SettingsDialog() {
  const open = useAppStore((state) => state.settingsOpen);
  const settings = useAppStore((state) => state.settings);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);

  return (
    <Dialog.Root open={open} onOpenChange={setSettingsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-elevated focus:outline-none"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-ink-900">Settings</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted hover:bg-surface-tertiary hover:text-ink-800"
            >
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {/* Mounted per open so the form always starts from the saved settings. */}
          {open && settings && (
            <SettingsForm settings={settings} onClose={() => setSettingsOpen(false)} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
