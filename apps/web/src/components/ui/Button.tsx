import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent/90 active:bg-accent/85",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-sunken active:bg-sunken/70",
  ghost: "text-fg-muted hover:bg-sunken hover:text-fg active:bg-sunken/70",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-sm",
  md: "h-10 gap-2 rounded-lg px-4 text-sm",
  lg: "h-12 gap-2 rounded-lg px-5 text-base",
};

/** Shared button styling so router `Link`s and `<button>`s look identical. */
export function buttonStyles({ variant = "primary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 select-none",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
  );
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}
