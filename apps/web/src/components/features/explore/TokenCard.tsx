import { type TokenSummary, shortenAddress } from "@minthouse/shared";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModeBadge, NetworkLabel } from "@/components/ui/ChainBadge";
import { CopyButton } from "@/components/ui/CopyButton";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { formatBaseUnits, formatRelativeTime, formatTimestamp } from "@/lib/format";

export function TokenCard({ token }: { token: TokenSummary }) {
  const { t } = useTranslation("explore");
  const supply = formatBaseUnits(token.totalSupply, token.decimals, 0);
  const verifiedAgo = token.onchainVerifiedAt ? formatRelativeTime(token.onchainVerifiedAt) : null;

  return (
    <article className="group relative flex flex-col rounded-xl border border-line bg-surface transition-colors duration-150 hover:border-line-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent">
      <header className="flex items-start gap-3 p-4">
        <TokenAvatar imageUri={token.imageUri} symbol={token.symbol} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">
            <Link
              to="/app"
              search={(previous) => ({ ...previous, token: token.address, tokenNetwork: token.network })}
              resetScroll={false}
              aria-label={t("card.inspect", { name: token.name, symbol: token.symbol })}
              className="outline-none after:absolute after:inset-0 after:rounded-xl"
            >
              {token.name}
            </Link>
          </h3>
          <p className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
            <span className="font-mono">{token.symbol}</span>
            <span aria-hidden="true" className="text-fg-subtle">·</span>
            <NetworkLabel network={token.network} />
          </p>
        </div>
        <ModeBadge mode={token.mode} />
      </header>

      <dl className="grid grid-cols-2 gap-x-4 border-t border-line px-4 py-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-fg-subtle">{t("card.supply")}</dt>
          <dd className="truncate font-mono tabular-nums">{supply ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-subtle">{t(`card.address.${token.family}`)}</dt>
          <dd className="relative z-10 -my-1 flex items-center gap-0.5">
            <span className="truncate font-mono" title={token.address}>
              {shortenAddress(token.address)}
            </span>
            <CopyButton value={token.address} />
          </dd>
        </div>
      </dl>

      <footer className="mt-auto flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-xs">
        {verifiedAgo && token.onchainVerifiedAt ? (
          <>
            <BadgeCheck className="size-3.5 text-accent-ink" aria-hidden="true" />
            <time dateTime={token.onchainVerifiedAt} title={formatTimestamp(token.onchainVerifiedAt)} className="text-fg-muted">
              {t("card.verified", { time: verifiedAgo })}
            </time>
          </>
        ) : (
          <>
            <Clock className="size-3.5 text-warn" aria-hidden="true" />
            <span className="text-fg-muted">{t("card.unverified")}</span>
          </>
        )}
      </footer>
    </article>
  );
}
