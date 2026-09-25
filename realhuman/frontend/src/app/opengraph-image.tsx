import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/constants/site";

export const alt = `${siteConfig.name} — ${siteConfig.positioning}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const file = await readFile(
      join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf"),
    );
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const font = await loadFont();
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "radial-gradient(ellipse at 75% 40%, #0f2a22 0%, #060709 55%)",
        color: "#eceef1",
        fontFamily: font ? "Geist" : "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9.5" stroke="#eceef1" strokeWidth="1.6" />
          <path
            d="M8.2 12.3l2.6 2.6 5-5.3"
            stroke="#eceef1"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="18.72" cy="5.28" r="2.4" fill="#3ee39a" stroke="#060709" strokeWidth="1.6" />
        </svg>
        {siteConfig.name}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 84, lineHeight: 1, letterSpacing: "-0.045em", maxWidth: 900 }}>
          Know when you are talking to a human.
        </div>
        <div style={{ fontSize: 30, color: "#a3a9b3" }}>{siteConfig.positioning}</div>
      </div>
    </div>,
    {
      ...size,
      ...(font
        ? { fonts: [{ name: "Geist", data: font, style: "normal" as const, weight: 600 as const }] }
        : {}),
    },
  );
}
