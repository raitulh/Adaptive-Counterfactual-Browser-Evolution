import { cn } from "@/lib/utils/cn";
import { tokenizeLines, type CodeLanguage, type TokenType } from "@/lib/utils/highlight";

const TOKEN_CLASS: Record<TokenType, string> = {
  plain: "text-foreground/90",
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  number: "text-syntax-number",
  literal: "text-syntax-number",
  comment: "text-syntax-comment italic",
  function: "text-syntax-function",
  property: "text-syntax-property",
  type: "text-syntax-type",
  variable: "text-syntax-variable",
  punctuation: "text-syntax-punctuation",
  operator: "text-syntax-punctuation",
};

interface CodeBlockProps {
  code: string;
  language: CodeLanguage;
  /** Accessible name for the scrollable region. */
  label: string;
  activeLine?: number | null;
  showLineNumbers?: boolean;
  className?: string;
}

/** Highlighted, keyboard-scrollable code. Pure render — safe in server components. */
export function CodeBlock({
  code,
  language,
  label,
  activeLine = null,
  showLineNumbers = true,
  className,
}: CodeBlockProps) {
  const lines = tokenizeLines(code, language);
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className={cn(
        "overflow-x-auto py-4 font-mono text-code focus-visible:outline-offset-[-2px]",
        className,
      )}
    >
      <code className="grid min-w-max">
        {lines.map((tokens, index) => (
          <span
            key={index}
            data-active={activeLine === index ? "" : undefined}
            className={cn(
              "relative flex pr-6 transition-colors duration-500",
              "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-transparent before:transition-colors before:duration-500",
              "data-active:bg-accent/[0.07] data-active:before:bg-accent",
            )}
          >
            {showLineNumbers ? (
              <span
                aria-hidden
                className="w-10 shrink-0 pr-4 text-right text-subtle tabular-nums select-none"
              >
                {index + 1}
              </span>
            ) : (
              <span aria-hidden className="w-4 shrink-0" />
            )}
            <span>
              {tokens.length === 0
                ? " "
                : tokens.map((token, tokenIndex) => (
                    <span key={tokenIndex} className={TOKEN_CLASS[token.type]}>
                      {token.value}
                    </span>
                  ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
