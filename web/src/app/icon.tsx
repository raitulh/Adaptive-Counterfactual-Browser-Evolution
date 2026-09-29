import { ImageResponse } from "next/og";

/** App icons generated from the brand mark: favicon-size, PWA sizes and a maskable variant. */
const SIZES = { "32": 32, "192": 192, "512": 512, maskable: 512 } as const;

export function generateImageMetadata() {
  return (Object.keys(SIZES) as Array<keyof typeof SIZES>).map((id) => ({
    id,
    contentType: "image/png",
    size: { width: SIZES[id], height: SIZES[id] },
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const key = String(await id) as keyof typeof SIZES;
  const px = SIZES[key] ?? 32;
  const maskable = key === "maskable";
  // Maskable icons need their content inside the central safe zone (80%).
  const mark = maskable ? px * 0.62 : px;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: px >= 192 ? "#07080a" : "transparent",
        borderRadius: px >= 192 && !maskable ? px * 0.22 : 0,
      }}
    >
      <svg
        width={mark * (px >= 192 && !maskable ? 0.78 : 1)}
        height={mark * (px >= 192 && !maskable ? 0.78 : 1)}
        viewBox="0 0 32 32"
      >
        <defs>
          <radialGradient id="c" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E9FEFF" />
            <stop offset="55%" stopColor="#5CE1E6" />
            <stop offset="100%" stopColor="#1B8C93" />
          </radialGradient>
        </defs>
        <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" />
        <path d="M16 3a13 13 0 0 1 12.2 8.5" fill="none" stroke="#A99BFF" strokeWidth="2" strokeLinecap="round" />
        <circle cx="28.2" cy="11.5" r="2" fill="#A99BFF" />
        <circle cx="5.2" cy="21.8" r="1.7" fill="rgba(255,255,255,0.6)" />
        <circle cx="16" cy="16" r="5.8" fill="url(#c)" />
        <circle cx="16" cy="16" r="8.6" fill="none" stroke="rgba(92,225,230,0.4)" strokeWidth="1" />
      </svg>
    </div>,
    { width: px, height: px },
  );
}
