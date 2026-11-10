import type { ModuleKey, Permission } from "@isms/contracts";
import {
  Building2Icon,
  FileBarChartIcon,
  HouseIcon,
  LibraryBigIcon,
  ListTodoIcon,
  MessageSquareWarningIcon,
  ScaleIcon,
  SettingsIcon,
  ShieldAlertIcon,
  TrophyIcon,
  GavelIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  /** Message key under `nav.` */
  key:
    | "home"
    | "report"
    | "tasks"
    | "risks"
    | "reports"
    | "library"
    | "aiAct"
    | "contribution"
    | "judgmentQueue"
    | "organisation"
    | "settings";
  icon: LucideIcon;
  /** Current for this path and everything below it (Home is current only on "/"). */
  section: boolean;
};

/**
 * Primary navigation for the viewer. Hiding an item is presentation only: the API checks
 * every request itself. Later plans add their sections here. A module's item shows only while
 * the module is on (`modules`, from /me) and the viewer may read it.
 */
export function navItemsFor(
  permissions: readonly Permission[],
  modules: readonly ModuleKey[] = [],
): NavItem[] {
  const items: NavItem[] = [{ href: "/", key: "home", icon: HouseIcon, section: false }];
  if (permissions.includes("risks.report")) {
    items.push({ href: "/report", key: "report", icon: MessageSquareWarningIcon, section: true });
    items.push({
      href: "/security-contribution",
      key: "contribution",
      icon: TrophyIcon,
      section: true,
    });
    // Evidence requests go to people who can report, the contributors included.
    items.push({ href: "/tasks", key: "tasks", icon: ListTodoIcon, section: true });
  }
  if (permissions.includes("concerns.judge")) {
    items.push({
      href: "/concern-evaluations",
      key: "judgmentQueue",
      icon: GavelIcon,
      section: true,
    });
  }
  if (permissions.includes("risks.read")) {
    items.push({ href: "/risks", key: "risks", icon: ShieldAlertIcon, section: true });
  }
  if (permissions.includes("reports.read")) {
    items.push({ href: "/reports", key: "reports", icon: FileBarChartIcon, section: true });
  }
  if (permissions.includes("library.read")) {
    items.push({ href: "/library", key: "library", icon: LibraryBigIcon, section: true });
  }
  if (modules.includes("eu_ai_act") && permissions.includes("aiact.read")) {
    items.push({ href: "/ai-act", key: "aiAct", icon: ScaleIcon, section: true });
  }
  if (permissions.includes("organisation.manage")) {
    items.push({ href: "/setup", key: "organisation", icon: Building2Icon, section: true });
  }
  if (permissions.includes("settings.ai.manage")) {
    // The only settings page so far; it is the section's entry.
    items.push({ href: "/settings/ai", key: "settings", icon: SettingsIcon, section: true });
  }
  return items;
}

export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.key === "settings") return pathname.startsWith("/settings/");
  return item.section
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;
}
