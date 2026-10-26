import { LAUNCH_MODES, LAUNCH_MODE_CAPABILITIES, type LaunchModeCapabilities } from "@minthouse/shared";
import { useTranslation } from "react-i18next";
import { ChainDot } from "@/components/ui/ChainBadge";
import { cn } from "@/lib/cn";
import { VerifiedSeal } from "./VerifiedSeal";

function decimalsLabel(decimals: LaunchModeCapabilities["decimals"], fixedLabel: (value: number) => string): string {
  return decimals.configurable ? `${decimals.min}–${decimals.max}` : fixedLabel(decimals.min);
}

/** The three launch modes, rendered straight from the shared capability table so copy never drifts from code. */
export function LaunchModesLedger({ className }: { className?: string }) {
  const { t } = useTranslation("landing");

  return (
    <section aria-labelledby="modes-title" className={cn("relative", className)}>
      <VerifiedSeal className="absolute -top-8 right-5 size-24 text-accent-ink short:hidden" />

      <div className="rounded-2xl border border-line bg-surface shadow-sm">
        <header className="border-b border-line px-6 pt-5 pb-4 short:py-3">
          <h2 id="modes-title" className="font-display text-3xl leading-tight short:text-2xl">
            {t("modes.title")}
          </h2>
          <p className="text-sm text-fg-muted">{t("modes.subtitle")}</p>
        </header>

        <ul className="divide-y divide-line">
          {LAUNCH_MODES.map((mode) => {
            const capabilities = LAUNCH_MODE_CAPABILITIES[mode];
            const decimals = decimalsLabel(capabilities.decimals, (value) => t("modes.decimalsFixed", { value }));
            const supply = t(`modes.supply.${capabilities.supply}`);
            const minting = capabilities.postDeployMint ? t("modes.minting.allowed") : t("modes.minting.never");
            return (
              <li key={mode} className="flex flex-col gap-1 px-6 py-4 short:py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="flex items-center gap-2 font-medium">
                    <ChainDot family={capabilities.family} />
                    {t(`modes.rows.${mode}.name`)}
                  </p>
                  <p className="text-right text-xs text-fg-subtle">{t(`modes.rows.${mode}.standard`)}</p>
                </div>
                <p className="pl-4 text-sm text-pretty text-fg-muted">
                  <span className="text-fg-subtle">{t("modes.columns.decimals")} </span>
                  <span className="tabular-nums">{decimals}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="text-fg-subtle">{t("modes.columns.supply")} </span>
                  {supply}
                  <span aria-hidden="true"> · </span>
                  <span className="text-fg-subtle">{t("modes.columns.minting")} </span>
                  {minting}
                </p>
              </li>
            );
          })}
        </ul>

        <p className="rounded-b-2xl border-t border-line bg-sunken/60 px-6 py-3 font-mono text-xs text-fg-muted">{t("modes.footnote")}</p>
      </div>
    </section>
  );
}
