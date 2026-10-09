import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import type { ProviderSummary } from "../types";
import { CheckIcon, ChevronRightIcon, Spinner } from "./icons";

/** Shown first among providers that are not connected yet. */
const FEATURED = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "ollama",
  "lmstudio",
  "openai-compatible",
];

function rank(provider: ProviderSummary): number {
  if (provider.connections.length > 0) return 0;
  const featured = FEATURED.indexOf(provider.id);
  return featured >= 0 ? 1 + featured : 100;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ProviderForm({ provider, onDone }: { provider: ProviderSummary; onDone: () => void }) {
  const connectProvider = useAppStore((state) => state.connectProvider);
  const [methodId, setMethodId] = useState(provider.authMethods[0]?.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const method = provider.authMethods.find((item) => item.id === methodId);
  const fields = method ? method.fields : provider.fields;
  const complete = fields.every((field) => !field.required || values[field.key]?.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectProvider({
        providerId: provider.id,
        ...(method ? { authMethodId: method.id } : {}),
        fields: Object.fromEntries(fields.map((field) => [field.key, values[field.key] ?? ""])),
      });
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete && !busy) void submit();
      }}
    >
      {provider.authMethods.length > 1 && (
        <div className="grid gap-1.5">
          {provider.authMethods.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name={`${provider.id}-method`}
                className="mt-1 accent-[var(--color-accent)]"
                checked={item.id === methodId}
                onChange={() => setMethodId(item.id)}
              />
              <span>
                <span className="block text-ink-900">{item.label}</span>
                <span className="block text-xs text-muted">{item.description}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {fields.map((field, index) => (
        <label key={field.key} className="grid gap-1">
          <span className="text-xs font-medium text-ink-700">
            {field.label}
            {!field.required && <span className="font-normal text-muted"> (optional)</span>}
          </span>
          <input
            autoFocus={index === 0}
            type={field.secret ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            value={values[field.key] ?? ""}
            placeholder={field.placeholder ?? undefined}
            onChange={(event) =>
              setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
            }
            className="field font-mono"
          />
        </label>
      ))}
      {error && <p className="break-words text-xs text-error">{error}</p>}
      <div>
        <button type="submit" className="button-primary" disabled={!complete || busy}>
          {busy && <Spinner className="h-3.5 w-3.5" />}
          {provider.connections.length > 0 ? "Update" : "Connect"}
        </button>
      </div>
    </form>
  );
}

function ProviderRow({
  provider,
  open,
  onToggle,
}: {
  provider: ProviderSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const disconnectProvider = useAppStore((state) => state.disconnectProvider);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = provider.connections.length > 0;

  const disconnect = async (name: string) => {
    setRemoving(name);
    setError(null);
    try {
      await disconnectProvider({ providerId: provider.id, providerName: name });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-tertiary transition-colors"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">{provider.name}</span>
          {!open && (
            <span className="block truncate text-xs text-muted">{provider.description}</span>
          )}
        </span>
        {connected && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-success">
            <CheckIcon className="h-3.5 w-3.5" />
            Connected
          </span>
        )}
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="grid gap-3 px-3 pb-3.5">
          <p className="text-xs text-muted">{provider.description}</p>
          {provider.connections.map((connection) => (
            <div
              key={connection.name}
              className="flex items-center gap-3 rounded-lg bg-surface-tertiary px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-ink-900">
                  {connection.name}
                </span>
                {connection.baseUrl && (
                  <span className="block truncate font-mono text-[11px] text-muted">
                    {connection.baseUrl}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="button-secondary shrink-0"
                disabled={removing !== null}
                onClick={() => void disconnect(connection.name)}
              >
                {removing === connection.name && <Spinner className="h-3.5 w-3.5" />}
                Disconnect
              </button>
            </div>
          ))}
          {error && <p className="break-words text-xs text-error">{error}</p>}
          {provider.oauth ? (
            !connected && (
              <p className="text-xs text-ink-700">
                This provider signs in with a subscription account. Connect it from the Letta CLI:
                run <code className="font-mono">letta</code> in a terminal and use{" "}
                <code className="font-mono">/connect</code>.
              </p>
            )
          ) : (
            <ProviderForm provider={provider} onDone={onToggle} />
          )}
        </div>
      )}
    </div>
  );
}

/** Connect API keys and local inference servers for the local backend. */
export function ProvidersPanel() {
  const providers = useAppStore((state) => state.providers);
  const available = useAppStore(
    (state) => state.connection?.status === "ready" && state.connection.providers,
  );
  const backend = useAppStore((state) => state.connection?.backend);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (providers ?? [])
      .filter((provider) => {
        const haystack = `${provider.name} ${provider.id}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [providers, query]);

  if (!available) {
    return (
      <p className="mt-4 text-sm text-muted">
        {backend === "cloud"
          ? "Letta Cloud manages model access. Provider setup here applies to the local backend."
          : "Model providers are set up on the server this app is connected to."}
      </p>
    );
  }

  if (!providers) {
    return (
      <div className="mt-6 flex justify-center">
        <Spinner className="h-5 w-5 text-muted" />
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-3">
      <p className="text-sm text-muted">
        Your agents send prompts to these providers. Keys are stored by the Letta runtime on the
        machine it runs on.
      </p>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search providers"
        className="field"
      />
      <div className="max-h-[22rem] overflow-y-auto rounded-xl border border-border">
        {visible.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted">No providers match.</div>
        )}
        {visible.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            open={openId === provider.id}
            onToggle={() => setOpenId(openId === provider.id ? null : provider.id)}
          />
        ))}
      </div>
    </div>
  );
}
