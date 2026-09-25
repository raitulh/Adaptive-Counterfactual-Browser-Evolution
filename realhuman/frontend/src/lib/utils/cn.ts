import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know about custom theme keys so it can resolve
 * conflicts such as `text-body` (font-size) vs `text-muted` (color).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "body-lg", "body", "label", "code"] }],
      shadow: [{ shadow: ["subtle", "elevated", "glow-success", "glow-accent"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
