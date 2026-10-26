import { Dialog } from "@base-ui/react/dialog";
import { NETWORKS, type NetworkId, type TokenLookup, shortenAddress } from "@minthouse/shared";
import { useQueryErrorResetBoundary, useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { ArrowUpRight, X } from "lucide-react";
import { type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { tokenLookupQuery } from "@/api/queries";
import { ModeBadge, NetworkLabel } from "@/components/ui/ChainBadge";
import { CopyButton } from "@/components/ui/CopyButton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { formatBaseUnits, formatBps, formatLamportsAsSol, formatTimestamp, safeHttpUrl } from "@/lib/format";

type TokenInspectorProps = {
  target: { network: NetworkId; address: string } | null;
  onClose: () => void;
};

/** Live on-chain view of a single token. Open state lives in the URL so the view is shareable. */
export function TokenInspector({ target, onClose }: TokenInspectorProps) {
  const { t } = useTranslation();
  const { reset } = useQueryErrorResetBoundary();

  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-fg/30 dark:bg-black/60" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:w-[min(40rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0">
          <Dialog.Close
            aria-label={t("actions.close")}
            className="absolute top-4 right-4 z-10 inline-flex size-8 items-center justify-center rounded-md text-fg-subtle hover:bg-sunken hover:text-fg"
          >
            <X className="size-4" aria-hidden="true" />
          </Dialog.Close>
          {target ? (
            <CatchBoundary
              getResetKey={() => `${target.network}:${target.address}`}
              onCatch={() => undefined}
              errorComponent={({ error, reset: resetBoundary }) => (
                <InspectorError
                  error={error}
                  onRetry={() => {
                    reset();
                    resetBoundary();
                  }}
                />
              )}
            >
              <Suspense fallback={<InspectorSkeleton network={target.network} />}>
                <InspectorContent network={target.network} address={target.address} />
              </Suspense>
            </CatchBoundary>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InspectorContent({ network, address }: { network: NetworkId; address: string }) {
  const { t } = useTranslation("explore");
  const { data: token } = useSuspenseQuery(tokenLookupQuery(network, address));
  const explorer = NETWORKS[token.network].explorer;
  const supply = formatBaseUnits(token.totalSupply, token.decimals);
  const metadataUrl = safeHttpUrl(token.metadataUri);

  return (
    <article>
      <header className="flex items-start gap-4 border-b border-line p-6 pr-14">
        <TokenAvatar imageUri={null} symbol={token.symbol} size="lg" />
        <div className="min-w-0 flex-1">
          <Dialog.Title className="font-display text-3xl leading-tight text-balance">{token.name}</Dialog.Title>
          <Dialog.Description render={<div />} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="font-mono">{token.symbol}</span>
            <NetworkLabel network={token.network} />
            {token.mode ? (
              <ModeBadge mode={token.mode} />
            ) : (
              <span className="rounded border border-line-strong px-1.5 text-xs">{t("inspector.unknownMode")}</span>
            )}
          </Dialog.Description>
        </div>
      </header>

      <div className="flex items-center gap-1 border-b border-line bg-sunken/50 px-6 py-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm" title={token.address}>
          {token.address}
        </code>
        <CopyButton value={token.address} />
        {explorer ? (
          <a
            href={explorer.address(token.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-sunken hover:text-fg"
          >
            {t("inspector.explorer", { explorer: explorer.name })}
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
        <Fact label={t("inspector.supply")}>
          <span className="font-mono tabular-nums">{supply ?? token.totalSupply}</span>
          <span className="block font-mono text-xs break-all text-fg-subtle">{t("inspector.baseUnits", { value: token.totalSupply })}</span>
        </Fact>
        <Fact label={t("inspector.decimals")}>
          <span className="font-mono tabular-nums">{token.decimals}</span>
        </Fact>
        <Fact label={token.family === "bsc" ? t("inspector.owner") : t("inspector.mintAuthority")}>
          {token.owner ? (
            <AddressValue address={token.owner} />
          ) : (
            <span className="font-medium">{token.family === "bsc" ? t("inspector.renounced") : t("inspector.revoked")}</span>
          )}
        </Fact>
        <Fact label={t("inspector.minting")}>
          <MintingStatus token={token} />
        </Fact>
        {token.pendingOwner ? (
          <Fact label={t("inspector.pendingOwner")}>
            <AddressValue address={token.pendingOwner} />
          </Fact>
        ) : null}
        {token.family === "solana" ? (
          <Fact label={t("inspector.freeze")}>
            {token.freezeAuthority ? <AddressValue address={token.freezeAuthority} /> : t("inspector.none")}
          </Fact>
        ) : null}
        <Fact label={t("inspector.metadata")}>
          <span className="flex flex-wrap items-center gap-x-3">
            <span>
              {token.metadataMutable === null
                ? t("inspector.notApplicable")
                : token.metadataMutable
                  ? t("inspector.mutable")
                  : t("inspector.immutable")}
            </span>
            {metadataUrl ? (
              <a
                href={metadataUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-0.5 text-sm text-accent-ink underline-offset-2 hover:underline"
              >
                {t("inspector.openMetadata")}
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            ) : null}
          </span>
        </Fact>
        <Fact label={t("inspector.standard")}>{token.tokenStandard}</Fact>
      </dl>

      {token.pump ? <PumpCurve pump={token.pump} network={token.network} /> : null}

      <footer className="flex flex-col gap-1 border-t border-line px-6 py-4 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          {t("inspector.readAt", { network: NETWORKS[token.network].label, time: formatTimestamp(token.readAt) })}
        </p>
        <p className={token.platformDeploymentId ? "text-accent-ink" : undefined}>
          {token.platformDeploymentId ? t("inspector.platform") : t("inspector.external")}
        </p>
      </footer>
    </article>
  );
}

function MintingStatus({ token }: { token: TokenLookup }) {
  const { t } = useTranslation("explore");
  if (token.mintingEnabled === null) {
    return <span className="text-fg-muted">{t("inspector.mintingUnknown")}</span>;
  }
  return token.mintingEnabled ? (
    <span className="font-medium text-warn">{t("inspector.mintingEnabled")}</span>
  ) : (
    <span className="font-medium">{t("inspector.mintingDisabled")}</span>
  );
}

function PumpCurve({ pump, network }: { pump: NonNullable<TokenLookup["pump"]>; network: NetworkId }) {
  const { t } = useTranslation("explore");
  const marketCap = pump.marketCapLamports ? formatLamportsAsSol(pump.marketCapLamports) : null;
  const progress = Math.min(Math.max(pump.progressBps, 0), 10_000);

  return (
    <section aria-labelledby="pump-title" className="border-t border-line p-6">
      <h3 id="pump-title" className="text-xs text-fg-subtle">
        {t("inspector.pump.title")}
      </h3>
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <p className="font-medium">{t(`inspector.pump.${pump.phase}`)}</p>
        <p className="font-mono text-sm tabular-nums">{formatBps(progress)}</p>
      </div>
      <div
        role="meter"
        aria-label={t("inspector.pump.progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress / 100}
        className="mt-2 h-2 overflow-hidden rounded-full bg-sunken"
      >
        <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${progress / 10_000})` }} />
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        {marketCap ? (
          <Fact label={t("inspector.pump.marketCap")}>
            <span className="font-mono tabular-nums">
              {marketCap} {NETWORKS[network].nativeSymbol}
            </span>
          </Fact>
        ) : null}
        <Fact label={t("inspector.pump.creator")}>
          <AddressValue address={pump.creator} />
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function AddressValue({ address }: { address: string }) {
  return (
    <span className="-my-1 flex items-center gap-0.5">
      <span className="truncate font-mono" title={address}>
        {shortenAddress(address, 6)}
      </span>
      <CopyButton value={address} />
    </span>
  );
}

function InspectorSkeleton({ network }: { network: NetworkId }) {
  const { t } = useTranslation("explore");
  return (
    <div aria-busy="true">
      <div className="flex items-center gap-4 border-b border-line p-6">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Dialog.Title className="text-sm text-fg-muted">{t("inspector.loading", { network: NETWORKS[network].label })}</Dialog.Title>
          <Skeleton className="h-7 w-1/2" />
        </div>
      </div>
      <div className="grid gap-4 p-6 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

function InspectorError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation("explore");
  return (
    <div className="p-6 pt-14">
      <Dialog.Title className="sr-only">{t("inspector.errorTitle")}</Dialog.Title>
      <ErrorState title={t("inspector.errorTitle")} error={error} onRetry={onRetry} />
    </div>
  );
}
