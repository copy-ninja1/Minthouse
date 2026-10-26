import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SearchX, Sprout } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type TokenSearchFilters, tokenSearchQuery } from "@/api/queries";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenCard } from "./TokenCard";

const GRID_CLASSES = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

type TokenResultsProps = {
  filters: TokenSearchFilters;
  onClearSearch: () => void;
};

export function TokenResults({ filters, onClearSearch }: TokenResultsProps) {
  const { t } = useTranslation("explore");
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(tokenSearchQuery(filters));
  const tokens = data.pages.flatMap((page) => page.items);

  if (tokens.length === 0) {
    return filters.q ? (
      <EmptyState icon={<SearchX className="size-5" aria-hidden="true" />} title={t("empty.searchTitle", { q: filters.q })} body={t("empty.searchBody")}>
        <Button variant="secondary" onClick={onClearSearch}>
          {t("empty.clear")}
        </Button>
      </EmptyState>
    ) : (
      <EmptyState icon={<Sprout className="size-5" aria-hidden="true" />} title={t("empty.noneTitle")} body={t("empty.noneBody")}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link to="/app/create" className={buttonStyles()}>
            {t("empty.create")}
          </Link>
          <a href="#inspect" className={buttonStyles({ variant: "secondary" })}>
            {t("empty.lookup")}
          </a>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className={GRID_CLASSES}>
        {tokens.map((token) => (
          <li key={`${token.network}:${token.address}`} className="grid">
            <TokenCard token={token} />
          </li>
        ))}
      </ul>

      <div className="flex justify-center">
        {hasNextPage ? (
          <Button
            variant="secondary"
            disabled={isFetchingNextPage}
            onClick={() => {
              void fetchNextPage();
            }}
          >
            {isFetchingNextPage ? t("pagination.loading") : t("pagination.loadMore")}
          </Button>
        ) : (
          <p className="text-sm text-fg-subtle">{t("pagination.end")}</p>
        )}
      </div>
    </div>
  );
}

export function TokenResultsSkeleton() {
  return (
    <ul className={GRID_CLASSES} aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="rounded-xl border border-line bg-surface">
          <div className="flex items-center gap-3 p-4">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-line px-4 py-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
          <div className="border-t border-line px-4 py-3">
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
};

function EmptyState({ icon, title, body, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-sunken text-fg-muted">{icon}</span>
      <h2 className="font-display text-2xl text-balance">{title}</h2>
      <p className="max-w-md text-sm text-pretty text-fg-muted">{body}</p>
      <div className="pt-2">{children}</div>
    </div>
  );
}
