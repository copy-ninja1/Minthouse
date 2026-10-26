import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

const COPIED_FEEDBACK_MS = 1500;

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
};

/** Icon-only copy action with an inline confirmation announced to screen readers. */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCopied(false);
    }, COPIED_FEEDBACK_MS);
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
      aria-label={label ?? t("actions.copyAddress")}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors duration-150 hover:bg-sunken hover:text-fg",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-accent-ink" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      <span role="status" className="sr-only">
        {copied ? t("actions.copied") : ""}
      </span>
    </button>
  );
}
