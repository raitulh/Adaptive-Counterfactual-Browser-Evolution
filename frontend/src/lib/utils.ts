import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtPct(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

export function fmtNumber(val: number): string {
  return Math.round(val).toLocaleString();
}

export function fmtTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatFriendlyDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getFriendlyTaskName(taskId: string): string {
  if (!taskId) return "General Navigation Flow";
  const map: Record<string, string> = {
    wrong_element_0: "E-Commerce: Checkout Add-to-Cart Selection",
    wrong_element_1: "E-Commerce: Product Variant Specification",
    wrong_element_2: "E-Commerce: Cart Item Quantity Adjustment",
    wrong_element_3: "E-Commerce: Related Item Recommendation",
    wrong_element_4: "E-Commerce: Multi-Item Bulk Selection",
    wrong_sequence_0: "User Authentication: Multi-Step Registration",
    wrong_sequence_1: "Onboarding Flow: Workspace Configuration",
    wrong_sequence_2: "Profile Verification: Security Confirmation Sequence",
    dynamic_ui_0: "Application Settings: Asynchronous Region Preference",
    dynamic_ui_1: "Dashboard Config: Toggle Feature Flags",
    dynamic_ui_2: "Account Billing: Currency Localization",
    dynamic_ui_3: "User Preferences: Theme Mode Persist",
    missing_information_0: "Checkout: Promotional Discount Invariant",
    missing_information_1: "Billing: Address Validation Form",
    missing_information_2: "Security: Two-Factor Modal Confirmation",
    context_failure_0: "Content Routing: Deep Article Navigation",
    context_failure_1: "Documentation: Sub-Section Anchor Jump",
    context_failure_2: "Catalog View: Category Deep-Link",
    navigation_failure_0: "Support Center: Dynamic Drawer Traversal",
    navigation_failure_1: "Knowledge Base: FAQ Collapsible Accordion",
    verification_failure_0: "Order Processing: Final Confirmation Invariant",
    verification_failure_1: "Subscription: Plan Upgrade Verification",
  };
  return map[taskId] || taskId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function getFriendlyTaxonomyName(type: string): string {
  const map: Record<string, string> = {
    WRONG_ELEMENT: "Selector Drift (Misaligned Element Target)",
    WRONG_SEQUENCE: "Sequence Inversion (Premature Submission Race)",
    STATE_MISUNDERSTANDING: "DOM Hydration Delay (Dynamic Content Latency)",
    MISSING_INFORMATION: "Modal / Pop-up Overlay Interception",
    CONTEXT_FAILURE: "Navigation Context Eviction",
    NAVIGATION_FAILURE: "Unresponsive Navigation Target",
    VERIFICATION_FAILURE: "Post-Condition Invariant Violation",
    LOCATOR_DRIFT: "Dynamic Selector Mutation",
    DYNAMIC_TIMING: "Asynchronous Network Hydration Delay",
  };
  return map[type] || type.replace(/_/g, ' ');
}
