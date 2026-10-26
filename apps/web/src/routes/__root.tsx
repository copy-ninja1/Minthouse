import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { NotFoundPage, RouteErrorPage } from "@/components/layout/StatusPage";

export type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({ meta: [{ title: "Minthouse — verifiable token launches" }] }),
  component: RootLayout,
  errorComponent: RouteErrorPage,
  notFoundComponent: NotFoundPage,
});

function RootLayout() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}
