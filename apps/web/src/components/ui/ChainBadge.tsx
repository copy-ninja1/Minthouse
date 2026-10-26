import type { ChainFamily, LaunchMode, NetworkId } from "@minthouse/shared";
import { NETWORKS } from "@minthouse/shared";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

const FAMILY_DOT: Record<ChainFamily, string> = {
  bsc: "bg-bnb",
  solana: "bg-sol",
};

export function ChainDot({ family, className }: { family: ChainFamily; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", FAMILY_DOT[family], className)} />;
}

export function NetworkLabel({ network, className }: { network: NetworkId; className?: string }) {
  const info = NETWORKS[network];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <ChainDot family={info.family} />
      <span className="truncate">{info.label}</span>
    </span>
  );
}

export function ModeBadge({ mode, className }: { mode: LaunchMode | null; className?: string }) {
  const { t } = useTranslation();
  if (mode === null) {
    return null;
  }
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded border border-line-strong px-1.5 font-mono text-[11px] leading-none text-fg-muted uppercase",
        className,
      )}
    >
      {t(`modes.${mode}`)}
    </span>
  );
}
