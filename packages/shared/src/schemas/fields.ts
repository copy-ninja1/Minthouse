import { z } from "zod";
import { isEvmAddress, isSolanaAddress } from "../addresses.js";

const encoder = new TextEncoder();

function isControlCodePoint(codePoint: number, allowWhitespace: boolean): boolean {
  if (allowWhitespace && (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d)) {
    return false;
  }
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
}

export function hasControlCharacters(value: string, allowWhitespace = false): boolean {
  for (const character of value) {
    if (isControlCodePoint(character.codePointAt(0) ?? 0, allowWhitespace)) {
      return true;
    }
  }
  return false;
}

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

export function boundedText(label: string, maxBytes: number) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => !hasControlCharacters(value), `${label} contains invalid characters`)
    .refine((value) => utf8ByteLength(value) <= maxBytes, `${label} must be at most ${maxBytes} bytes`);
}

export function tokenSymbol(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .max(maxLength, `Symbol must be at most ${maxLength} characters`)
    .regex(/^[A-Za-z0-9]+$/, "Symbol may only contain letters and numbers");
}

export const descriptionField = z
  .string()
  .trim()
  .max(1000, "Description must be at most 1000 characters")
  .refine((value) => !hasControlCharacters(value, true), "Description contains invalid characters");

/**
 * Parses a URL and returns it only if it is a public https URL without
 * credentials. Used for user-supplied links that are displayed or stored.
 */
export function parseSafeHttpsUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) {
    return null;
  }
  return url;
}

function linkField(label: string, allowedHosts?: readonly string[]) {
  return z
    .string()
    .trim()
    .max(200, `${label} must be at most 200 characters`)
    .refine((value) => {
      if (value === "") {
        return true;
      }
      const url = parseSafeHttpsUrl(value);
      if (!url) {
        return false;
      }
      return !allowedHosts || allowedHosts.includes(url.hostname.replace(/^www\./, ""));
    }, allowedHosts ? `${label} must be an https:// link on ${allowedHosts.join(" or ")}` : `${label} must be an https:// link`)
    .optional()
    .transform((value) => (value ? value : undefined));
}

export const websiteField = linkField("Website");
export const twitterField = linkField("X/Twitter link", ["x.com", "twitter.com"]);
export const telegramField = linkField("Telegram link", ["t.me", "telegram.me"]);

export const wholeTokenAmountField = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)$/, "Enter a whole number of tokens without separators")
  .max(78, "Amount is too large");

export const evmAddressField = z.string().trim().refine(isEvmAddress, "Enter a valid BNB Smart Chain address (0x…)");

export const solanaAddressField = z.string().trim().refine(isSolanaAddress, "Enter a valid Solana address");
