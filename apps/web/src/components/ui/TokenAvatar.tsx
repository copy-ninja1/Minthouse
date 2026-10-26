import { useState } from "react";
import { cn } from "@/lib/cn";
import { safeHttpUrl } from "@/lib/format";

type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AvatarSize, { frame: string; monogram: string }> = {
  sm: { frame: "size-6", monogram: "text-[10px]" },
  md: { frame: "size-11", monogram: "text-lg" },
  lg: { frame: "size-14", monogram: "text-2xl" },
};

type TokenAvatarProps = {
  imageUri: string | null;
  symbol: string;
  size?: AvatarSize;
  className?: string;
};

/**
 * Token logo with a monogram fallback. Logos are user-supplied, so the URL is
 * restricted to http(s) and loaded without a referrer.
 */
export function TokenAvatar({ imageUri, symbol, size = "md", className }: TokenAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = safeHttpUrl(imageUri);
  const showImage = src !== null && failedSrc !== src;
  const sizing = SIZE_CLASSES[size];

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-sunken",
        sizing.frame,
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => {
            setFailedSrc(src);
          }}
        />
      ) : (
        <span aria-hidden="true" className={cn("font-display leading-none text-fg-muted", sizing.monogram)}>
          {symbol.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}
