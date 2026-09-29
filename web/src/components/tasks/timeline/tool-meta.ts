import {
  BarChart3Icon,
  BrainIcon,
  CalendarIcon,
  ContactIcon,
  FileSearchIcon,
  FileTextIcon,
  GlobeIcon,
  HardDriveIcon,
  MailIcon,
  SearchIcon,
  SparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

const NAMESPACE_ICONS: Record<string, LucideIcon> = {
  calendar: CalendarIcon,
  gmail: MailIcon,
  contacts: ContactIcon,
  drive: HardDriveIcon,
  files: FileTextIcon,
  documents: FileSearchIcon,
  memory: BrainIcon,
  search: SearchIcon,
  web: GlobeIcon,
  data: BarChart3Icon,
  llm: SparklesIcon,
};

/** Icon for a tool by namespace ("calendar.create_event" → calendar). */
export function toolIcon(tool: string | null | undefined): LucideIcon {
  if (!tool) return WrenchIcon;
  return NAMESPACE_ICONS[tool.split(".")[0]] ?? WrenchIcon;
}

/** Present-progressive verb for a running tool ("Calendar" → "Checking your calendar"). */
export function toolActivityVerb(tool: string | null | undefined): string {
  const ns = tool?.split(".")[0];
  switch (ns) {
    case "calendar":
      return "Working in your calendar";
    case "gmail":
      return "Working in Gmail";
    case "contacts":
      return "Looking through contacts";
    case "drive":
      return "Reading Google Drive";
    case "files":
      return "Reading your files";
    case "documents":
      return "Searching your documents";
    case "memory":
      return "Consulting memory";
    case "search":
    case "web":
      return "Researching the web";
    case "data":
      return "Analyzing data";
    case "llm":
      return "Drafting with the model";
    default:
      return "Running a tool";
  }
}
