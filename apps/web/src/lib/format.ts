import { formatDistanceStrict } from "date-fns";
import { SOL_DECIMALS, formatTokenAmount, stringToBigint } from "@minthouse/shared";

/**
 * Formats a base-unit amount string for display using integer math only.
 * Returns null when the input is missing or not an integer string.
 */
export function formatBaseUnits(raw: string | null, decimals: number, maxFractionDigits = 2): string | null {
  if (raw === null) {
    return null;
  }
  try {
    return formatTokenAmount(stringToBigint(raw), decimals, { maxFractionDigits });
  } catch {
    return null;
  }
}

/** Formats lamports as SOL, truncating (never rounding) to four fraction digits. */
export function formatLamportsAsSol(lamports: string): string | null {
  return formatBaseUnits(lamports, SOL_DECIMALS, 4);
}

/** Basis points as a percentage string, e.g. 4250 → "42.5%". */
export function formatBps(bps: number): string {
  const clamped = Math.min(Math.max(bps, 0), 10_000);
  return `${(clamped / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** "3 minutes ago" style label. Returns null for unparseable timestamps. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (date.getTime() > now.getTime()) {
    return "just now";
  }
  return formatDistanceStrict(date, now, { addSuffix: true });
}

/** Absolute timestamp for tooltips and `<time>` titles. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Returns the URL only when it is absolute http(s). Token metadata is
 * user-supplied, so anything else (javascript:, data:, relative paths) is dropped.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
