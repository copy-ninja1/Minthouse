import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { CatchBoundary, getRouteApi } from "@tanstack/react-router";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { env } from "@/lib/env";
import type { ExploreSearch } from "@/lib/explore-search";
import { ExploreToolbar } from "./ExploreToolbar";
import { PlatformStatus } from "./PlatformStatus";
import { TokenInspector } from "./TokenInspector";
import { TokenLookupForm } from "./TokenLookupForm";
import { TokenResults, TokenResultsSkeleton } from "./TokenResults";

const routeApi = getRouteApi("/app");

export function ExplorePage() {
  const { t } = useTranslation("explore");
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { reset } = useQueryErrorResetBoundary();

  const filters = { q: search.q, network: search.network };
  const networks = env.VITE_ENABLED_NETWORKS;
  const inspected = search.token && search.tokenNetwork ? { network: search.tokenNetwork, address: search.token } : null;

  const updateSearch = (patch: Partial<ExploreSearch>) => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }), resetScroll: false });
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="sticky top-0 z-30 border-b border-line bg-canvas pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
          <SiteHeader />
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:px-12 lg:py-12">
        <section aria-labelledby="explore-title" className="flex min-w-0 flex-col gap-6">
          <header>
            <h1 id="explore-title" className="font-display text-5xl leading-none text-balance">
              {t("title")}
            </h1>
            <p className="mt-2 text-fg-muted text-pretty">{t("subtitle")}</p>
          </header>

          <ExploreToolbar
            query={search.q}
            network={search.network}
            networks={networks}
            onSearch={(q) => {
              updateSearch({ q });
            }}
            onNetworkChange={(network) => {
              updateSearch({ network });
            }}
          />

          <CatchBoundary
            getResetKey={() => JSON.stringify(filters)}
            errorComponent={({ error, reset: resetBoundary }) => (
              <ErrorState
                title={t("error.title")}
                error={error}
                onRetry={() => {
                  reset();
                  resetBoundary();
                }}
              />
            )}
          >
            <Suspense fallback={<TokenResultsSkeleton />}>
              <TokenResults
                filters={filters}
                onClearSearch={() => {
                  updateSearch({ q: undefined });
                }}
              />
            </Suspense>
          </CatchBoundary>
        </section>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <TokenLookupForm
            networks={networks}
            onInspect={(network, address) => {
              updateSearch({ token: address, tokenNetwork: network });
            }}
          />
          <PlatformStatus />
        </aside>
      </main>

      <TokenInspector
        target={inspected}
        onClose={() => {
          updateSearch({ token: undefined, tokenNetwork: undefined });
        }}
      />
    </div>
  );
}
