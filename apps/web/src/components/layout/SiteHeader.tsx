import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Wordmark } from "@/components/ui/BrandMark";
import { buttonStyles } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { cn } from "@/lib/cn";

type SiteHeaderProps = {
  /** The landing page promotes the app; inside the app the action is redundant. */
  showLaunchAction?: boolean;
  className?: string;
};

export function SiteHeader({
  showLaunchAction = false,
  className,
}: SiteHeaderProps) {
  const { t } = useTranslation();

  return (
    <header
      className={cn(
        "flex h-16 shrink-0 items-center justify-between gap-4",
        className,
      )}
    >
      <Link to="/" aria-label={t("nav.home")} className="rounded-md">
        <Wordmark label={t("brand")} />
      </Link>

      <nav
        aria-label={t("nav.label")}
        className="flex items-center gap-1 sm:gap-2"
      >
        <Link
          to="/app"
          className="hidden h-9 items-center rounded-lg px-3 text-sm text-fg-muted transition-colors duration-150 hover:bg-sunken hover:text-fg data-[status=active]:text-fg sm:inline-flex"
          activeOptions={{ exact: true, includeSearch: false }}
        >
          {t("nav.explore")}
        </Link>
        <Link
          to="/app/create"
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-fg-muted transition-colors duration-150 hover:bg-sunken hover:text-fg data-[status=active]:text-fg"
          activeOptions={{ exact: true }}
        >
          {t("nav.create")}
        </Link>
        <ThemeToggle />
        {showLaunchAction ? (
          <Link to="/app" className={buttonStyles({ size: "sm" })}>
            {t("nav.launchApp")}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </nav>
    </header>
  );
}
