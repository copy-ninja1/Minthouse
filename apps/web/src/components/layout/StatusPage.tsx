import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button, buttonStyles } from "@/components/ui/Button";
import { ApiRequestError } from "@/api/client";
import { SiteHeader } from "./SiteHeader";

type StatusPageProps = {
  code: string;
  title: string;
  body: string;
  requestId?: string;
  onRetry?: () => void;
};

function StatusPage({ code, title, body, requestId, onRetry }: StatusPageProps) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col px-5 sm:px-8 lg:px-12">
      <SiteHeader />
      <main className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
        <p className="font-mono text-sm text-fg-subtle">{code}</p>
        <h1 className="font-display text-5xl leading-none text-balance sm:text-6xl">{title}</h1>
        <p className="max-w-lg text-fg-muted text-pretty">{body}</p>
        {requestId ? <p className="font-mono text-xs text-fg-subtle">{t("errors.requestId", { id: requestId })}</p> : null}
        <div className="flex gap-3 pt-2">
          {onRetry ? <Button onClick={onRetry}>{t("actions.retry")}</Button> : null}
          <Link to="/" className={buttonStyles({ variant: onRetry ? "secondary" : "primary" })}>
            {t("actions.backHome")}
          </Link>
        </div>
      </main>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return <StatusPage code="404" title={t("errors.notFoundTitle")} body={t("errors.notFoundBody")} />;
}

export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryReset = useQueryErrorResetBoundary();
  const isApiError = error instanceof ApiRequestError;

  return (
    <StatusPage
      code={isApiError && error.status ? String(error.status) : "Error"}
      title={t("errors.genericTitle")}
      body={isApiError ? error.message : t("errors.genericBody")}
      requestId={isApiError ? error.requestId : undefined}
      onRetry={() => {
        queryReset.reset();
        reset();
        void router.invalidate();
      }}
    />
  );
}
