import { createFileRoute } from "@tanstack/react-router";
import { publicConfigQuery, tokenSearchQuery } from "@/api/queries";
import { ExplorePage } from "@/components/features/explore/ExplorePage";
import { NotFoundPage, RouteErrorPage } from "@/components/layout/StatusPage";
import { exploreSearchSchema } from "@/lib/explore-search";

export const Route = createFileRoute("/app")({
  validateSearch: exploreSearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q, network: search.network }),
  // Prefetch only: results sit behind their own boundary so the lookup form keeps working if search fails.
  loader: ({ context, deps }) => {
    // Prefetch only. The page has its own error boundary, so a failed warm-up stays silent.
    void context.queryClient.infiniteQuery(tokenSearchQuery(deps)).catch(() => undefined);
    void context.queryClient.query(publicConfigQuery()).catch(() => undefined);
  },
  head: () => ({ meta: [{ title: "Explore tokens · Minthouse" }] }),
  component: ExplorePage,
  errorComponent: RouteErrorPage,
  notFoundComponent: NotFoundPage,
});
