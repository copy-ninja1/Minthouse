import type { TokenPage } from "@minthouse/shared";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { recentLaunchesQuery } from "@/api/queries";
import { ChainDot } from "@/components/ui/ChainBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { cn } from "@/lib/cn";

/**
 * Real launches from the indexer. The landing page must render without the
 * API, so failures degrade to a quiet note instead of an error boundary.
 */
export function RecentLaunches({ className }: { className?: string }) {
  const { t } = useTranslation("landing");
  const query = useQuery(recentLaunchesQuery());

  return (
    <section aria-labelledby="recent-title" className={cn("flex min-w-0 items-center gap-4", className)}>
      <h2 id="recent-title" className="shrink-0 text-xs text-fg-subtle">
        {t("recent.title")}
      </h2>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" aria-live="polite">
        <RecentLaunchesBody query={query} />
      </div>
      <Link to="/app" className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted hover:text-fg">
        {t("recent.viewAll")}
        <ArrowUpRight className="size-3" aria-hidden="true" />
      </Link>
    </section>
  );
}

function RecentLaunchesBody({ query }: { query: UseQueryResult<TokenPage> }) {
  const { t } = useTranslation("landing");

  switch (query.status) {
    case "pending":
      return [0, 1, 2].map((index) => <Skeleton key={index} className="h-8 w-28 rounded-full" />);
    case "error":
      return <p className="truncate text-sm text-fg-subtle">{t("recent.unavailable")}</p>;
    case "success": {
      if (query.data.items.length === 0) {
        return <p className="truncate text-sm text-fg-subtle">{t("recent.empty")}</p>;
      }
      return (
        <ul className="flex min-w-0 items-center gap-2">
          {query.data.items.map((token) => (
            <li key={`${token.network}:${token.address}`} className="shrink-0">
              <Link
                to="/app"
                search={{ token: token.address, tokenNetwork: token.network }}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-1 text-sm transition-colors duration-150 hover:border-line-strong"
              >
                <TokenAvatar imageUri={token.imageUri} symbol={token.symbol} size="sm" />
                <span className="font-medium">{token.symbol}</span>
                <ChainDot family={token.family} />
              </Link>
            </li>
          ))}
        </ul>
      );
    }
    default: {
      const exhaustive: never = query;
      return exhaustive;
    }
  }
}
