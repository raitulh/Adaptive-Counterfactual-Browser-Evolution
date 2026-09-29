/**
 * Summarize a User-Agent string for the sessions list ("Chrome 131 on macOS"). Heuristic by nature:
 * the full string stays available in a tooltip.
 */
export interface UaSummary {
  browser: string | null;
  os: string | null;
  device: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  label: string;
}

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/OPR\/(\d+)/, "Opera"],
  [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
  [/Firefox\/(\d+)/, "Firefox"],
  [/FxiOS\/(\d+)/, "Firefox"],
  [/CriOS\/(\d+)/, "Chrome"],
  [/HeadlessChrome\/(\d+)/, "Headless Chrome"],
  [/Chrome\/(\d+)/, "Chrome"],
  [/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//, "Safari"],
];

const CLIENTS: Array<[RegExp, string]> = [
  [/python-(?:urllib|requests)|aiohttp|httpx/i, "Python client"],
  [/curl\//i, "curl"],
  [/node-fetch|undici|axios/i, "Node.js client"],
  [/PostmanRuntime/i, "Postman"],
];

const OSES: Array<[RegExp, string]> = [
  [/Windows NT/, "Windows"],
  [/iPhone|iPod/, "iOS"],
  [/iPad/, "iPadOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

export function summarizeUserAgent(ua: string | null | undefined): UaSummary {
  if (!ua || !ua.trim()) return { browser: null, os: null, device: "unknown", label: "Unknown device" };
  let browser: string | null = null;
  for (const [re, name] of BROWSERS) {
    const m = ua.match(re);
    if (m) {
      browser = m[1] ? `${name} ${m[1]}` : name;
      break;
    }
  }
  if (!browser) {
    for (const [re, name] of CLIENTS) {
      if (re.test(ua)) {
        browser = name;
        break;
      }
    }
  }
  let os: string | null = null;
  for (const [re, name] of OSES) {
    if (re.test(ua)) {
      os = name;
      break;
    }
  }
  const device: UaSummary["device"] = /bot|crawler|spider/i.test(ua)
    ? "bot"
    : /iPad|Tablet/.test(ua)
      ? "tablet"
      : /Mobi|iPhone|Android.+Mobile/.test(ua)
        ? "mobile"
        : browser || os
          ? "desktop"
          : "unknown";
  const label = browser && os ? `${browser} on ${os}` : browser ?? os ?? ua.split(/[\s/]/)[0] ?? "Unknown device";
  return { browser, os, device, label };
}

/** Human label for SessionOut.auth_method values. */
export function authMethodLabel(method: string): string {
  const m = method.toLowerCase();
  if (m === "password") return "Password";
  if (m === "google" || m === "oauth_google") return "Google";
  if (m.includes("mfa")) return "Password + 2-step";
  return method.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
