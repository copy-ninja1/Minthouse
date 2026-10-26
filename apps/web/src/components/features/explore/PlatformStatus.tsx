import type { PublicConfig } from "@minthouse/shared";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { publicConfigQuery } from "@/api/queries";
import { NetworkLabel } from "@/components/ui/ChainBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

/** Capabilities the API reports about itself; nothing here is hard-coded in the client. */
export function PlatformStatus({ className }: { className?: string }) {
  const { t } = useTranslation("explore");
  const query = useQuery(publicConfigQuery());

  return (
    <section aria-labelledby="status-title" className={cn("rounded-xl border border-line p-5", className)}>
      <h2 id="status-title" className="text-xs text-fg-subtle">
        {t("status.title")}
      </h2>
      <PlatformStatusBody query={query} />
    </section>
  );
}

function PlatformStatusBody({ query }: { query: UseQueryResult<PublicConfig> }) {
  const { t } = useTranslation("explore");

  switch (query.status) {
    case "pending":
      return (
        <div className="mt-3 flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      );
    case "error":
      return <p className="mt-3 text-sm text-fg-muted">{t("status.offline")}</p>;
    case "success": {
      const { networks, storage, pumpfunNetworks } = query.data;
      return (
        <>
          <dl className="mt-3 flex flex-col gap-3 text-sm">
            <StatusRow label={t("status.networks")}>
              <ul className="flex flex-col items-end gap-1">
                {networks.map((network) => (
                  <li key={network}>
                    <NetworkLabel network={network} />
                  </li>
                ))}
              </ul>
            </StatusRow>
            <StatusRow label={t("status.storage")}>{storage.persistent ? t("status.ipfs") : t("status.local")}</StatusRow>
            <StatusRow label={t("status.pumpfun")}>
              {pumpfunNetworks.length > 0 ? (
                <ul className="flex flex-col items-end gap-1">
                  {pumpfunNetworks.map((network) => (
                    <li key={network}>
                      <NetworkLabel network={network} />
                    </li>
                  ))}
                </ul>
              ) : (
                t("status.unavailable")
              )}
            </StatusRow>
          </dl>
          {storage.persistent ? null : (
            <p className="mt-4 flex gap-2 rounded-lg bg-warn-soft p-3 text-xs text-pretty text-fg">
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden="true" />
              {t("status.localWarning")}
            </p>
          )}
        </>
      );
    }
    default: {
      const exhaustive: never = query;
      return exhaustive;
    }
  }
}

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
