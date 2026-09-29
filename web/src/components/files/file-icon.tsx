import {
  FileIcon,
  FileImageIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extensionOf } from "./validation";

const ICONS: Record<"image" | "sheet" | "json" | "text" | "other", LucideIcon> = {
  image: FileImageIcon,
  sheet: FileSpreadsheetIcon,
  json: FileJsonIcon,
  text: FileTextIcon,
  other: FileIcon,
};

function kindFor(contentTypeOrName: string): keyof typeof ICONS {
  const v = contentTypeOrName.toLowerCase();
  const ext = extensionOf(v);
  if (v.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (v.includes("spreadsheet") || v === "text/csv" || ["xlsx", "csv"].includes(ext)) return "sheet";
  if (v === "application/json" || ext === "json") return "json";
  if (
    v.startsWith("text/") ||
    v === "application/pdf" ||
    v.includes("wordprocessing") ||
    ["pdf", "docx", "txt", "md", "html"].includes(ext)
  )
    return "text";
  return "other";
}

export function FileTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICONS[kindFor(type)];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-fg-muted",
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
