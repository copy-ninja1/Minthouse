import { cn } from "@/lib/cn";

/** Minthouse coin mark: a struck "M" inside a milled rim. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-fg" />
      <circle cx="16" cy="16" r="9.5" fill="none" strokeWidth="2" className="stroke-accent" />
      <path
        d="M11 20.5v-9l5 5.5 5-5.5v9"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-canvas"
      />
    </svg>
  );
}

export function Wordmark({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="font-display text-2xl leading-none">{label}</span>
    </span>
  );
}
