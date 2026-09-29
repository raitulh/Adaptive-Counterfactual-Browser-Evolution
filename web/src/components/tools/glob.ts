/**
 * Tool-name pattern matching with the same semantics as the backend (Python `fnmatch.fnmatchcase`):
 * `*` matches any run of characters (including dots), `?` one character, `[seq]` / `[!seq]` a
 * character class. Matching is case-sensitive and anchored to the whole name.
 */

const cache = new Map<string, RegExp>();

function escapeRegex(ch: string): string {
  return ch.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}

/** Translate an fnmatch pattern to an anchored RegExp (mirrors CPython's fnmatch.translate). */
export function globToRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let out = "";
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i++];
    if (c === "*") {
      // Collapse consecutive stars.
      while (pattern[i] === "*") i++;
      out += "[\\s\\S]*";
    } else if (c === "?") {
      out += "[\\s\\S]";
    } else if (c === "[") {
      let j = i;
      if (pattern[j] === "!") j++;
      if (pattern[j] === "]") j++;
      while (j < n && pattern[j] !== "]") j++;
      if (j >= n) {
        out += "\\[";
      } else {
        let body = pattern.slice(i, j).replace(/\\/g, "\\\\");
        i = j + 1;
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        else if (body.startsWith("^")) body = `\\${body}`;
        out += `[${body}]`;
      }
    } else {
      out += escapeRegex(c);
    }
  }
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${out})$`);
  } catch {
    re = /$^/; // an invalid class never matches anything
  }
  cache.set(pattern, re);
  return re;
}

export function matchesPattern(name: string, pattern: string): boolean {
  return globToRegExp(pattern).test(name);
}

export function matchesAny(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchesPattern(name, p));
}

/** Names from `names` that `pattern` matches. */
export function matchingNames(pattern: string, names: readonly string[]): string[] {
  const re = globToRegExp(pattern);
  return names.filter((n) => re.test(n));
}

/**
 * Effective tool set for an agent tool policy, exactly as the permission engine decides step 4:
 * a tool is permitted when it matches an allowed pattern and no denied pattern.
 */
export function agentToolAccess(names: readonly string[], allowed: readonly string[], denied: readonly string[]) {
  const permitted: string[] = [];
  const blocked: string[] = [];
  for (const name of names) {
    if (matchesAny(name, allowed) && !matchesAny(name, denied)) permitted.push(name);
    else blocked.push(name);
  }
  return { permitted, blocked };
}

/** Pattern suggestions: every tool name plus one `namespace.*` wildcard per namespace. */
export function patternSuggestions(names: readonly string[]): string[] {
  const namespaces = new Set<string>();
  for (const n of names) {
    const parts = n.split(".");
    if (parts.length > 1) namespaces.add(`${parts[0]}.*`);
    if (parts[0] === "mcp" && parts.length > 2) namespaces.add(`mcp.${parts[1]}.*`);
  }
  return [...[...namespaces].sort(), ...[...names].sort()];
}
