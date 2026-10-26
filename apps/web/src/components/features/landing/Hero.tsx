import { Link } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonStyles } from "@/components/ui/Button";

export function Hero() {
  const { t } = useTranslation(["landing", "common"]);

  return (
    <section aria-labelledby="hero-title" className="flex flex-col items-start gap-5 short:gap-4 tiny:gap-3">
      <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-2 text-xs text-fg-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
        {t("eyebrow")}
      </p>

      <h1
        id="hero-title"
        className="font-display text-[clamp(2.6rem,min(8.5vw,10dvh),6.75rem)] leading-[0.92] text-balance"
      >
        {t("title")}
        <br />
        <em className="text-accent-ink">{t("titleEmphasis")}</em>
      </h1>

      <p className="max-w-xl text-base text-pretty text-fg-muted sm:text-lg short:text-base tiny:line-clamp-3">{t("lede")}</p>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Link to="/app" className={buttonStyles({ size: "lg" })}>
          {t("cta.primary")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <Link to="/app" hash="inspect" className={buttonStyles({ variant: "secondary", size: "lg" })}>
          {t("cta.secondary")}
        </Link>
      </div>

      <p className="inline-flex items-center gap-2 text-sm text-fg-muted">
        <ShieldCheck className="size-4 text-accent-ink" aria-hidden="true" />
        {t("common:security.short")}
      </p>
    </section>
  );
}
