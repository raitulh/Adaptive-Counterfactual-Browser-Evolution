import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#07080a",
      }}
    >
      <svg width="132" height="132" viewBox="0 0 32 32">
        <defs>
          <radialGradient id="c" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E9FEFF" />
            <stop offset="55%" stopColor="#5CE1E6" />
            <stop offset="100%" stopColor="#1B8C93" />
          </radialGradient>
        </defs>
        <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.3" />
        <path d="M16 3a13 13 0 0 1 12.2 8.5" fill="none" stroke="#A99BFF" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="28.2" cy="11.5" r="2" fill="#A99BFF" />
        <circle cx="5.2" cy="21.8" r="1.7" fill="rgba(255,255,255,0.6)" />
        <circle cx="16" cy="16" r="5.6" fill="url(#c)" />
        <circle cx="16" cy="16" r="8.5" fill="none" stroke="rgba(92,225,230,0.4)" strokeWidth="1" />
      </svg>
    </div>,
    { ...size },
  );
}
