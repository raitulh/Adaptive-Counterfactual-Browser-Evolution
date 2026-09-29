import { OG_ALT, OG_SIZE, renderOgImage } from "@/components/marketing/og-image";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderOgImage();
}
