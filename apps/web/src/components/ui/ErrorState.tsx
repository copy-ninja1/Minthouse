import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiRequestError } from "@/api/client";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

type ErrorStateProps = {
  title: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
  children?: ReactNode;
};

/** Explains a failure where it happened, with the API request ID for support when there is one. */
export function ErrorState({ title, error, onRetry, className, children }: ErrorStateProps) {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : t("errors.genericBody");
  const requestId = error instanceof ApiRequestError ? error.requestId : undefined;

  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft p-5", className)}>
      <div className="flex items-center gap-2 text-danger">
        <TriangleAlert className="size-4" aria-hidden="true" />
        <p className="font-medium">{title}</p>
      </div>
      <p className="text-sm text-pretty text-fg-muted">{message}</p>
      {requestId ? <p className="font-mono text-xs text-fg-subtle">{t("errors.requestId", { id: requestId })}</p> : null}
      {children}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("actions.retry")}
        </Button>
      ) : null}
    </div>
  );
}
