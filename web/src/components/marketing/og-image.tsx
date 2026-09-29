/**
 * Social card (Open Graph / Twitter) rendered with next/og. Uses the font bundled with next/og
 * (no network, no runtime font files) and the brand mark drawn as inline SVG.
 */
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "AgentOS — Give AI a goal. AgentOS gets the work done.";

const C = {
  bg: "#07080a",
  fg: "#eceef2",
  muted: "#a1a7b3",
  subtle: "#7d8594",
  accent: "#5ce1e6",
  verify: "#a99bff",
  line: "rgba(255,255,255,0.08)",
};

function CoreMark({ size }: { size: number }) {
  // The brand mark (core, orbit, verification arc) at poster scale.
  return (
    <svg width={size} height={size} viewBox="0 0 320 320">
      <defs>
        <radialGradient id="g" cx="42%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#E9FEFF" />
          <stop offset="45%" stopColor="#5CE1E6" />
          <stop offset="100%" stopColor="#1B8C93" />
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5CE1E6" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#5CE1E6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="160" cy="160" r="150" fill="url(#glow)" />
      <circle cx="160" cy="160" r="130" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
      <path d="M160 30 A130 130 0 0 1 282 115" fill="none" stroke="#A99BFF" strokeWidth="5" strokeLinecap="round" />
      <circle cx="282" cy="115" r="9" fill="#A99BFF" />
      <circle cx="52" cy="218" r="7" fill="rgba(255,255,255,0.55)" />
      <ellipse
        cx="160"
        cy="160"
        rx="150"
        ry="46"
        fill="none"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="1.5"
        strokeDasharray="3 8"
        transform="rotate(-10 160 160)"
      />
      <circle cx="160" cy="160" r="84" fill="none" stroke="rgba(92,225,230,0.35)" strokeWidth="2" />
      <circle cx="160" cy="160" r="54" fill="url(#g)" />
    </svg>
  );
}

export function renderOgImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: C.bg,
        color: C.fg,
        padding: "64px 72px",
        backgroundImage:
          "radial-gradient(circle at 78% 42%, rgba(92,225,230,0.16), transparent 42%), linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
        backgroundSize: "100% 100%, 48px 48px, 48px 48px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: 700,
          height: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, letterSpacing: -0.5 }}>
          <CoreMark size={44} />
          <div style={{ display: "flex" }}>
            <span>Agent</span>
            <span style={{ color: C.muted }}>OS</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 78, lineHeight: 1.02, letterSpacing: -3.2 }}>Give AI a goal.</div>
          <div style={{ fontSize: 78, lineHeight: 1.02, letterSpacing: -3.2, color: C.muted }}>
            AgentOS gets the work done.
          </div>
          <div style={{ marginTop: 28, fontSize: 26, color: C.muted, lineHeight: 1.4, maxWidth: 620 }}>
            Plan, execute, verify, and improve real-world tasks across the tools you use.
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 19, color: C.subtle, letterSpacing: 1 }}>
          <span>LLM proposes</span>
          <span style={{ color: C.line }}>/</span>
          <span>Backend decides</span>
          <span style={{ color: C.line }}>/</span>
          <span>Tools execute</span>
          <span style={{ color: C.line }}>/</span>
          <span style={{ color: C.verify }}>Verifier confirms</span>
        </div>
      </div>
      <div style={{ position: "absolute", right: 40, top: 95, display: "flex" }}>
        <CoreMark size={440} />
      </div>
    </div>,
    { ...OG_SIZE },
  );
}
