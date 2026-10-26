import { createFileRoute } from "@tanstack/react-router";
import { publicConfigQuery } from "@/api/queries";
import { CreatePage } from "@/components/features/create/CreatePage";
import { NotFoundPage, RouteErrorPage } from "@/components/layout/StatusPage";
import { WalletProviders } from "@/stores/wallets";

export const Route = createFileRoute("/app_/create")({
  loader: ({ context }) => {
    void context.queryClient.query(publicConfigQuery()).catch(() => undefined);
  },
  head: () => ({ meta: [{ title: "Create a token · Minthouse" }] }),
  component: CreateRoute,
  errorComponent: RouteErrorPage,
  notFoundComponent: NotFoundPage,
});

function CreateRoute() {
  return (
    <WalletProviders>
      <CreatePage />
    </WalletProviders>
  );
}
