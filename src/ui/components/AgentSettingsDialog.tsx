import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAppStore } from "../store";
import type { AgentDetails, AgentUpdate } from "../types";
import { ModelPicker } from "./ModelPicker";
import { CloseIcon, Spinner } from "./icons";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function DeleteAgent({ agent }: { agent: AgentDetails }) {
  const deleteAgent = useAppStore((state) => state.deleteAgent);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAgent();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-3.5 py-3">
        <div>
          <div className="text-sm font-medium text-ink-900">Delete this agent</div>
          <div className="text-xs text-muted">
            Removes the agent, its memory, and all of its chats. This cannot be undone.
          </div>
        </div>
        <button
          type="button"
          className="button-secondary shrink-0 text-error"
          onClick={() => setConfirming(true)}
        >
          Delete...
        </button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-3 rounded-xl border border-error/30 bg-error-light px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed === agent.name && !busy) void remove();
      }}
    >
      <label className="grid gap-1.5">
        <span className="text-sm text-ink-900">
          Type <span className="font-semibold">{agent.name}</span> to delete this agent, its memory,
          and all of its chats.
        </span>
        <input
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          spellCheck={false}
          className="field"
        />
      </label>
      {error && <p className="break-words text-xs text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setTyped("");
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={typed !== agent.name || busy}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-error px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Spinner className="h-3.5 w-3.5" />}
          Delete permanently
        </button>
      </div>
    </form>
  );
}

function AgentForm({ initial }: { initial: AgentDetails }) {
  const models = useAppStore((state) => state.models);
  const updateAgent = useAppStore((state) => state.updateAgent);
  // What is saved on the server, so only real changes are sent.
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [model, setModel] = useState(initial.model);
  const [system, setSystem] = useState(initial.system);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const update: AgentUpdate = {
    ...(name.trim() !== saved.name ? { name } : {}),
    ...(description.trim() !== (saved.description ?? "") ? { description } : {}),
    ...(model && model !== saved.model ? { model } : {}),
    ...(system !== saved.system ? { system } : {}),
  };
  const changed = Object.keys(update).length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const agent = await updateAgent(update);
      setSaved({ ...agent, system });
      setJustSaved(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 grid gap-5">
      <form
        className="grid gap-4"
        onChange={() => setJustSaved(false)}
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && name.trim() && !busy) void save();
        }}
      >
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-ink-700">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className="field" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-ink-700">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this agent is for"
            className="field"
          />
        </label>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-ink-700">Default model</span>
          <ModelPicker
            value={model}
            models={models}
            placement="bottom"
            onChange={(handle) => {
              setModel(handle);
              setJustSaved(false);
            }}
          />
          <span className="text-xs text-muted">
            Used for new chats. A chat keeps the model you pick for it.
          </span>
        </div>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-ink-700">System prompt</span>
          <textarea
            value={system}
            onChange={(event) => setSystem(event.target.value)}
            rows={10}
            spellCheck={false}
            className="field resize-y font-mono text-xs leading-relaxed"
          />
          <span className="text-xs text-muted">
            The instructions the agent always follows. What it learns over time belongs in its
            memory, not here.
          </span>
        </label>
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 break-words text-xs" role="status">
            {error ? (
              <span className="text-error">{error}</span>
            ) : (
              justSaved && !changed && <span className="text-success">Saved</span>
            )}
          </p>
          <button type="submit" className="button-primary" disabled={!changed || !name.trim() || busy}>
            {busy && <Spinner className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </form>
      <DeleteAgent agent={saved} />
    </div>
  );
}

function AgentSettingsBody({ agentId }: { agentId: string }) {
  const [details, setDetails] = useState<AgentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.bridge
      .getAgent(agentId)
      .then((agent) => {
        if (!cancelled) setDetails(agent);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (error) return <p className="mt-4 break-words text-sm text-error">{error}</p>;
  if (!details) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-5 w-5 text-muted" />
      </div>
    );
  }
  return <AgentForm initial={details} />;
}

/** Rename, describe, re-model, re-prompt, or delete the selected agent. */
export function AgentSettingsDialog() {
  const open = useAppStore((state) => state.agentSettingsOpen);
  const agentId = useAppStore((state) => state.agentId);
  const setAgentSettingsOpen = useAppStore((state) => state.setAgentSettingsOpen);

  return (
    <Dialog.Root open={open} onOpenChange={setAgentSettingsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-elevated focus:outline-none"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-ink-900">
              Agent settings
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted hover:bg-surface-tertiary hover:text-ink-800"
            >
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {/* Mounted per open so the form always starts from the saved agent. */}
          {open && agentId && <AgentSettingsBody key={agentId} agentId={agentId} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
