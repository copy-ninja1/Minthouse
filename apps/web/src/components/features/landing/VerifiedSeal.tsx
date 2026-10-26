import { cn } from "@/lib/cn";

/** Decorative assay stamp. Purely visual, so it is hidden from assistive technology. */
export function VerifiedSeal({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={cn("pointer-events-none rotate-12", className)}>
      <defs>
        <path id="seal-path" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0" />
      </defs>
      <circle cx="60" cy="60" r="57" fill="var(--canvas)" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="34" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
      <text fill="currentColor" fontSize="10.5" fontFamily="var(--font-mono)" letterSpacing="2.2">
        <textPath href="#seal-path">VERIFIED ON-CHAIN · VERIFIED ON-CHAIN ·</textPath>
      </text>
      <path d="M47 61.5l9 9 17-19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
