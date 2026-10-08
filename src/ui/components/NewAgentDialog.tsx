import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAppStore } from "../store";
import { ModelPicker } from "./ModelPicker";
import { Spinner } from "./icons";

function NewAgentForm({ onClose }: { onClose: () => void }) {
  const models = useAppStore((state) => state.models);
  const createAgent = useAppStore((state) => state.createAgent);
  const [name, setName] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      await createAgent({ name, ...(model ? { model } : {}) });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setCreating(false);
    }
  };

  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !creating) void create();
      }}
    >
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-ink-700">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Cowork"
          className="field"
        />
      </label>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-ink-700">Model</span>
        <ModelPicker value={model} models={models} onChange={setModel} placement="bottom" />
        <span className="text-xs text-muted">You can switch models per chat later.</span>
      </div>
      {error && <p className="break-words text-xs text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="button-secondary" onClick={onClose} disabled={creating}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={!name.trim() || creating}>
          {creating && <Spinner className="h-3.5 w-3.5" />}
          {creating ? "Creating" : "Create agent"}
        </button>
      </div>
    </form>
  );
}

export function NewAgentDialog() {
  const open = useAppStore((state) => state.newAgentOpen);
  const setNewAgentOpen = useAppStore((state) => state.setNewAgentOpen);

  return (
    <Dialog.Root open={open} onOpenChange={setNewAgentOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-elevated focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-ink-900">New agent</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            An agent keeps its own memory across every chat you have with it.
          </Dialog.Description>
          {open && <NewAgentForm onClose={() => setNewAgentOpen(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
