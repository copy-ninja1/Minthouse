import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

const STEPS = ["configure", "publish", "sign", "verify"] as const;

export function LaunchSteps({ className }: { className?: string }) {
  const { t } = useTranslation("landing");

  return (
    <section aria-labelledby="steps-title" className={cn("min-w-0", className)}>
      <h2 id="steps-title" className="sr-only">
        {t("steps.title")}
      </h2>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-fg-subtle tabular-nums">{String(index + 1).padStart(2, "0")}</span>
            <span className={index === STEPS.length - 1 ? "font-medium text-accent-ink" : "text-fg"}>{t(`steps.${step}`)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
