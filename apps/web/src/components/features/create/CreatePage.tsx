import type { PublicConfig } from "@minthouse/shared";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { publicConfigQuery } from "@/api/queries";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { CreateTokenForm } from "./CreateTokenForm";

export function CreatePage() {
  const { t } = useTranslation("create");
  const config = useQuery(publicConfigQuery());

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="sticky top-0 z-30 border-b border-line bg-canvas pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
          <SiteHeader />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <header>
          <h1 className="font-display text-5xl leading-none text-balance">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-2xl text-fg-muted text-pretty">
            {t("subtitle")}
          </p>
        </header>
        <ConfigBody
          status={config.status}
          data={config.data}
          error={config.error}
          onRetry={() => {
            void config.refetch();
          }}
        />
      </main>
    </div>
  );
}

function ConfigBody({
  status,
  data,
  error,
  onRetry,
}: {
  status: "pending" | "error" | "success";
  data: PublicConfig | undefined;
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useTranslation("create");
  switch (status) {
    case "pending":
      return (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      );
    case "error":
      return (
        <ErrorState
          title={t("errors.configTitle")}
          error={error}
          onRetry={onRetry}
        />
      );
    case "success":
      return data ? <CreateTokenForm config={data} /> : null;
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled config status ${String(exhaustive)}`);
    }
  }
}
