import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const controlClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm placeholder:text-fg-subtle aria-invalid:border-danger disabled:opacity-60";

type FieldProps = {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
};

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs text-fg-muted">
        {label}
      </label>
      <div
        data-error-id={error ? errorId : undefined}
        data-hint-id={hint && !error ? hintId : undefined}
      >
        {children}
      </div>
      {hint && !error ? (
        <p id={hintId} className="text-xs text-pretty text-fg-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  placeholder?: string;
  mono?: boolean;
  autoComplete?: string;
  inputMode?: ComponentProps<"input">["inputMode"];
  spellCheck?: boolean;
};

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  mono,
  autoComplete = "off",
  inputMode,
  spellCheck,
}: TextFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <input
        id={id}
        name={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        spellCheck={spellCheck ?? false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(controlClass, mono && "font-mono")}
      />
    </Field>
  );
}
