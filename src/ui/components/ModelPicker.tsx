import { useEffect, useMemo, useRef, useState } from "react";
import { modelLabel } from "../lib/format";
import type { ModelOption } from "../types";
import { CheckIcon, ChevronDownIcon } from "./icons";

const MAX_RESULTS = 60;

/** Searchable model menu. Catalogs run to hundreds of models, so it filters as you type. */
export function ModelPicker({
  value,
  models,
  onChange,
  disabled = false,
  placement = "top",
  className = "",
}: {
  value: string | null;
  models: ModelOption[];
  onChange: (handle: string) => void;
  disabled?: boolean;
  placement?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = terms.length
      ? models.filter((model) => {
          const haystack = `${model.label} ${model.handle}`.toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
      : models;
    return matches.slice(0, MAX_RESULTS);
  }, [models, query]);

  const choose = (handle: string) => {
    onChange(handle);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled || models.length === 0}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value ?? undefined}
        className="chip max-w-full"
      >
        <span className="truncate">{modelLabel(value, models)}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <div
          className={`absolute left-0 z-50 w-80 rounded-xl border border-border bg-surface p-1.5 shadow-elevated ${placement === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) choose(results[0].handle);
            }}
            placeholder="Search models"
            className="w-full rounded-lg bg-surface-tertiary px-3 py-2 text-sm text-ink-900 placeholder:text-muted focus:outline-none"
          />
          <div role="listbox" className="mt-1.5 max-h-72 overflow-y-auto">
            {results.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted">No models match.</div>
            )}
            {results.map((model) => (
              <button
                key={model.handle}
                type="button"
                role="option"
                aria-selected={model.handle === value}
                onClick={() => choose(model.handle)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-surface-tertiary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink-900">{model.label}</span>
                  <span className="block truncate font-mono text-[11px] text-muted">
                    {model.handle}
                  </span>
                </span>
                {model.handle === value && <CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
