import { useState } from "react";
import { toolLabel, toolSummary } from "../lib/format";
import type { ApprovalDecision, ApprovalRequest } from "../types";

type Question = {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
};

const primaryButton =
  "rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-brand-content transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium text-ink-800 hover:bg-surface-tertiary transition-colors";

/** The agent asked the user a question (AskUserQuestion). */
function QuestionForm({
  request,
  questions,
  onDecide,
}: {
  request: ApprovalRequest;
  questions: Question[];
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});

  const answerFor = (index: number) => other[index]?.trim() || (selected[index] ?? []).join(", ");
  const complete = questions.every((_, index) => answerFor(index).length > 0);

  const submit = (answers: Record<string, string>) =>
    onDecide({ behavior: "allow", updatedInput: { ...request.input, answers } });

  const toggle = (index: number, question: Question, label: string) => {
    // A lone single-choice question is answered by the click itself.
    if (questions.length === 1 && !question.multiSelect) {
      submit({ [question.question]: label });
      return;
    }
    setSelected((previous) => {
      const current = previous[index] ?? [];
      const next = question.multiSelect
        ? current.includes(label)
          ? current.filter((item) => item !== label)
          : [...current, label]
        : [label];
      return { ...previous, [index]: next };
    });
  };

  return (
    <div className="grid gap-4">
      {questions.map((question, index) => (
        <div key={index}>
          <p className="text-sm font-medium text-ink-900">{question.question}</p>
          {question.multiSelect && <p className="mt-0.5 text-xs text-muted">Choose any that apply.</p>}
          <div className="mt-2 grid gap-1.5">
            {(question.options ?? []).map((option) => {
              const isSelected = (selected[index] ?? []).includes(option.label);
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => toggle(index, question, option.label)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${isSelected ? "border-accent bg-accent-subtle" : "border-border bg-surface hover:bg-surface-tertiary"}`}
                >
                  <span className="font-medium text-ink-900">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs text-muted">{option.description}</span>
                  )}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={other[index] ?? ""}
            onChange={(event) => setOther((previous) => ({ ...previous, [index]: event.target.value }))}
            placeholder="Or type your own answer"
            className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink-900 placeholder:text-muted focus:border-border-hover focus:outline-none"
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!complete}
          className={primaryButton}
          onClick={() =>
            submit(Object.fromEntries(questions.map((q, index) => [q.question, answerFor(index)])))
          }
        >
          Send answer
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => onDecide({ behavior: "deny", message: "The user skipped the question." })}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

/** The agent wants to run a tool that needs the user's permission. */
export function ApprovalPanel({
  request,
  queued,
  onDecide,
}: {
  request: ApprovalRequest;
  /** Other approvals waiting behind this one. */
  queued: number;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const questions = (request.input as { questions?: Question[] }).questions;
  const isQuestion = request.toolName === "AskUserQuestion" && Array.isArray(questions);
  const summary = toolSummary(request.input);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-3">
      {/* Keyed so a form never carries answers over to the next request. */}
      <div key={request.requestId} className="rounded-2xl border border-accent/30 bg-surface p-4 shadow-card">
        {isQuestion ? (
          <QuestionForm request={request} questions={questions ?? []} onDecide={onDecide} />
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-ink-900">
                Allow {toolLabel(request.toolName)}?
              </p>
              {queued > 0 && <span className="text-xs text-muted">{queued} more waiting</span>}
            </div>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-tertiary p-3 font-mono text-xs text-ink-800">
              {summary || JSON.stringify(request.input, null, 2)}
            </pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                autoFocus
                className={primaryButton}
                onClick={() => onDecide({ behavior: "allow" })}
              >
                Allow
              </button>
              {request.suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className={secondaryButton}
                  title={suggestion.text}
                  onClick={() => onDecide({ behavior: "allow", suggestionIds: [suggestion.id] })}
                >
                  <span className="block max-w-[26rem] truncate">{suggestion.text}</span>
                </button>
              ))}
              <button
                type="button"
                className={secondaryButton}
                onClick={() => onDecide({ behavior: "deny" })}
              >
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
