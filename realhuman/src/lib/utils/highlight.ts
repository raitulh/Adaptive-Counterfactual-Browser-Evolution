/**
 * A deliberately small syntax highlighter for the handful of languages shown
 * on the site. It avoids shipping a full editor or grammar bundle.
 */

export type CodeLanguage = "ts" | "bash" | "json" | "python" | "html";

export type TokenType =
  | "plain"
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "function"
  | "property"
  | "type"
  | "variable"
  | "literal"
  | "punctuation"
  | "operator";

export interface Token {
  type: TokenType;
  value: string;
}

interface Rule {
  type: TokenType;
  pattern: RegExp;
}

const JS_KEYWORDS =
  "import|from|export|default|const|let|var|async|await|function|return|if|else|new|throw|try|catch|class|extends|typeof|interface|type";
const PY_KEYWORDS =
  "import|from|as|async|await|def|return|if|elif|else|with|raise|try|except|class|for|in|not|and|or|is|lambda|pass";
const BASH_KEYWORDS = "curl|export|echo|npm|npx|pnpm|yarn|pip|uvicorn";

function sticky(source: string, flags = ""): RegExp {
  return new RegExp(source, `y${flags}`);
}

const shared = {
  number: { type: "number", pattern: sticky(String.raw`\b\d+(?:\.\d+)?\b`) },
  punctuation: { type: "punctuation", pattern: sticky(String.raw`[{}()[\];,.:]`) },
  operator: {
    type: "operator",
    pattern: sticky(String.raw`=>|===|!==|==|!=|>=|<=|&&|\|\||[=+\-*/!<>?|&]`),
  },
  whitespace: { type: "plain", pattern: sticky(String.raw`\s+`) },
  identifier: { type: "plain", pattern: sticky(String.raw`[A-Za-z_$][\w$]*`) },
} satisfies Record<string, Rule>;

const GRAMMARS: Record<CodeLanguage, Rule[]> = {
  ts: [
    { type: "comment", pattern: sticky(String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`) },
    {
      type: "string",
      pattern: sticky(
        String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|` + "`(?:\\\\.|[^`\\\\])*`",
      ),
    },
    { type: "keyword", pattern: sticky(String.raw`\b(?:${JS_KEYWORDS})\b`) },
    { type: "literal", pattern: sticky(String.raw`\b(?:true|false|null|undefined)\b`) },
    { type: "property", pattern: sticky(String.raw`(?<=\.)[A-Za-z_$][\w$]*`) },
    { type: "function", pattern: sticky(String.raw`[A-Za-z_$][\w$]*(?=\s*\()`) },
    { type: "type", pattern: sticky(String.raw`\b[A-Z][A-Za-z0-9]*\b`) },
    shared.number,
    shared.operator,
    shared.punctuation,
    shared.whitespace,
    shared.identifier,
  ],
  python: [
    { type: "comment", pattern: sticky(String.raw`#[^\n]*`) },
    {
      type: "string",
      pattern: sticky(String.raw`[fr]?"(?:\\.|[^"\\\n])*"|[fr]?'(?:\\.|[^'\\\n])*'`),
    },
    { type: "keyword", pattern: sticky(String.raw`\b(?:${PY_KEYWORDS})\b`) },
    { type: "literal", pattern: sticky(String.raw`\b(?:True|False|None)\b`) },
    { type: "property", pattern: sticky(String.raw`(?<=\.)[A-Za-z_][\w]*`) },
    { type: "function", pattern: sticky(String.raw`[A-Za-z_][\w]*(?=\s*\()`) },
    shared.number,
    shared.operator,
    shared.punctuation,
    shared.whitespace,
    shared.identifier,
  ],
  bash: [
    { type: "comment", pattern: sticky(String.raw`(?<=^|\s)#[^\n]*`) },
    { type: "string", pattern: sticky(String.raw`'[^']*'|"(?:\\.|[^"\\])*"`) },
    { type: "variable", pattern: sticky(String.raw`\$\{?[A-Za-z_][A-Za-z0-9_]*\}?`) },
    { type: "keyword", pattern: sticky(String.raw`\b(?:${BASH_KEYWORDS})\b`) },
    { type: "property", pattern: sticky(String.raw`(?<=\s)--?[a-zA-Z][\w-]*`) },
    { type: "punctuation", pattern: sticky(String.raw`\\(?=\n)`) },
    shared.whitespace,
    { type: "plain", pattern: sticky(String.raw`[^\s"'$\\]+`) },
  ],
  json: [
    { type: "property", pattern: sticky(String.raw`"(?:\\.|[^"\\])*"(?=\s*:)`) },
    { type: "string", pattern: sticky(String.raw`"(?:\\.|[^"\\])*"`) },
    { type: "literal", pattern: sticky(String.raw`\b(?:true|false|null)\b`) },
    { type: "number", pattern: sticky(String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`) },
    shared.punctuation,
    shared.whitespace,
    shared.identifier,
  ],
  html: [
    { type: "comment", pattern: sticky(String.raw`<!--[\s\S]*?-->`) },
    { type: "keyword", pattern: sticky(String.raw`<\/?[a-zA-Z][\w-]*|\/?>`) },
    { type: "property", pattern: sticky(String.raw`[a-zA-Z-:]+(?==)`) },
    { type: "string", pattern: sticky(String.raw`"[^"]*"|'[^']*'`) },
    { type: "operator", pattern: sticky("=") },
    shared.whitespace,
    { type: "plain", pattern: sticky(String.raw`[^<>="'\s]+`) },
  ],
};

/** Tokenizes `code`. Unknown characters become plain text; nothing is dropped. */
export function tokenize(code: string, language: CodeLanguage): Token[] {
  const rules = GRAMMARS[language];
  const tokens: Token[] = [];
  let index = 0;

  const push = (type: TokenType, value: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === type && type === "plain") last.value += value;
    else tokens.push({ type, value });
  };

  outer: while (index < code.length) {
    for (const rule of rules) {
      rule.pattern.lastIndex = index;
      const match = rule.pattern.exec(code);
      if (match && match[0].length > 0) {
        push(rule.type, match[0]);
        index += match[0].length;
        continue outer;
      }
    }
    push("plain", code.charAt(index));
    index += 1;
  }
  return language === "bash" ? splitShellVariables(tokens) : tokens;
}

/** Highlights `$VARIABLES` inside double-quoted shell strings. */
function splitShellVariables(tokens: Token[]): Token[] {
  const variable = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g;
  return tokens.flatMap((token) => {
    if (token.type !== "string" || !token.value.startsWith('"')) return [token];
    const parts: Token[] = [];
    let last = 0;
    for (const match of token.value.matchAll(variable)) {
      const start = match.index ?? 0;
      if (start > last) parts.push({ type: "string", value: token.value.slice(last, start) });
      parts.push({ type: "variable", value: match[0] });
      last = start + match[0].length;
    }
    if (last < token.value.length) parts.push({ type: "string", value: token.value.slice(last) });
    return parts;
  });
}

/** Tokenizes and splits into lines so each line can be rendered (and highlighted) independently. */
export function tokenizeLines(code: string, language: CodeLanguage): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(code, language)) {
    const parts = token.value.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ type: token.type, value: part });
    });
  }
  return lines;
}
