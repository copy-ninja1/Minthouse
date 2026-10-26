/** Stable JSON serialisation (sorted keys) so equal inputs always hash identically. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

/**
 * Derives a deterministic SHA-256 idempotency key from operation inputs.
 *
 * The same wallet submitting the same configuration (with the same client
 * nonce/draft id) always produces the same key, which lets both the client and
 * the API refuse a duplicate submission.
 *
 * @param parts - Public, non-sensitive inputs identifying one intended operation.
 * @returns 64-character lowercase hex digest.
 */
export async function deriveIdempotencyKey(parts: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(parts));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
