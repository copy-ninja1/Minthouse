import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useTheme } from "@/stores/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { resolved, setPreference } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        setPreference(next);
      }}
      aria-label={t("theme.switchTo", { theme: t(`theme.${next}`) })}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg text-fg-muted transition-colors duration-150 hover:bg-sunken hover:text-fg",
        className,
      )}
    >
      {resolved === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </button>
  );
}
