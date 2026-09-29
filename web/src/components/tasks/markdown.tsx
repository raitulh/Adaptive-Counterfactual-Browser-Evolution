"use client";

/**
 * Safe markdown for model-written answers: raw HTML is never rendered (`skipHtml`), links open in
 * a new tab without referrer/opener and only for http(s)/mailto, images are shown as links.
 * Loaded with next/dynamic by callers (react-markdown is not on the critical path).
 */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE_URL = /^(https?:|mailto:)/i;

const components: Components = {
  a: ({ href, children }) =>
    href && SAFE_URL.test(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-accent underline-offset-2 hover:underline"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    typeof src === "string" && SAFE_URL.test(src) ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
        {alt || "image"}
      </a>
    ) : null,
  code: ({ children, className }) => (
    <code className={`rounded bg-surface-3 px-1 py-px font-mono text-[0.85em] ${className ?? ""}`}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg border border-line bg-bg p-3 text-xs [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
        {children}
      </table>
    </div>
  ),
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-agentos flex flex-col gap-3 text-sm leading-relaxed text-fg [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
