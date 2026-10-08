import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

// Raw HTML in agent output is deliberately not rendered: it is shown as text.
function MDContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        h1: (props) => <h1 className="mt-4 text-xl font-semibold text-ink-900" {...props} />,
        h2: (props) => <h2 className="mt-4 text-lg font-semibold text-ink-900" {...props} />,
        h3: (props) => <h3 className="mt-3 text-base font-semibold text-ink-800" {...props} />,
        p: (props) => <p className="mt-2 leading-relaxed text-ink-800 first:mt-0" {...props} />,
        ul: (props) => <ul className="mt-2 ml-5 grid list-disc gap-1" {...props} />,
        ol: (props) => <ol className="mt-2 ml-5 grid list-decimal gap-1" {...props} />,
        li: (props) => <li className="min-w-0 text-ink-800" {...props} />,
        strong: (props) => <strong className="font-semibold text-ink-900" {...props} />,
        a: (props) => (
          <a
            className="text-accent underline underline-offset-2 hover:opacity-80"
            target="_blank"
            rel="noreferrer"
            {...props}
          />
        ),
        blockquote: (props) => (
          <blockquote className="mt-2 border-l-2 border-border pl-3 text-ink-600" {...props} />
        ),
        table: (props) => (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm" {...props} />
          </div>
        ),
        th: (props) => (
          <th className="border-b border-border px-2 py-1.5 text-left font-semibold" {...props} />
        ),
        td: (props) => <td className="border-b border-border px-2 py-1.5 align-top" {...props} />,
        pre: (props) => (
          <pre
            className="mt-3 max-w-full overflow-x-auto rounded-xl bg-surface-tertiary p-3 text-[13px] leading-relaxed text-ink-800"
            {...props}
          />
        ),
        code: ({ children, className, ...rest }) => {
          const isBlock = /language-/.test(className ?? "") || String(children).includes("\n");
          return isBlock ? (
            <code className={`${className ?? ""} font-mono`} {...rest}>
              {children}
            </code>
          ) : (
            <code
              className="rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-[0.9em] text-ink-900"
              {...rest}
            >
              {children}
            </code>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export default memo(MDContent);
