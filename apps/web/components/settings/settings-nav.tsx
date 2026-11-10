import type { Permission } from "@isms/contracts";
import { cn } from "@isms/ui";
import Link from "next/link";

export function SettingsNav({
  current,
  permissions,
}: {
  current: "ai" | "concern-reporting";
  permissions: readonly Permission[];
}) {
  const links = [
    ...(permissions.includes("settings.ai.manage")
      ? [{ key: "ai" as const, href: "/settings/ai", label: "AI assistant" }]
      : []),
    ...(permissions.includes("organisation.manage")
      ? [
          {
            key: "concern-reporting" as const,
            href: "/settings/concern-reporting",
            label: "Concern reporting",
          },
        ]
      : []),
  ];
  if (links.length < 2) return null;
  return (
    <nav aria-label="Settings" className="flex flex-wrap gap-2 border-b border-control-border pb-3">
      {links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          aria-current={current === link.key ? "page" : undefined}
          className={cn(
            "rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors",
            current === link.key
              ? "bg-accent-soft text-accent"
              : "text-fg-muted hover:bg-control-hover hover:text-fg",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
