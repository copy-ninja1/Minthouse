import { createFileRoute } from "@tanstack/react-router";
import { recentLaunchesQuery } from "@/api/queries";
import { LandingPage } from "@/components/features/landing/LandingPage";
import { NotFoundPage, RouteErrorPage } from "@/components/layout/StatusPage";

export const Route = createFileRoute("/")({
  // Warm the cache without blocking: the landing page renders even when the API is down.
  loader: ({ context }) => {
    // Prefetch only. A down API must not fail the landing page, which renders its own empty state.
    void context.queryClient.query(recentLaunchesQuery()).catch(() => undefined);
  },
  component: LandingPage,
  errorComponent: RouteErrorPage,
  notFoundComponent: NotFoundPage,
});
