import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";

export class UnsafeUrlError extends Error {
  override readonly name = "UnsafeUrlError";
}

export class FetchLimitError extends Error {
  override readonly name = "FetchLimitError";
}

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type SafeFetchOptions = {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

export type SafeFetchResult = {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string | null;
  body: Buffer;
};

export type SafeFetcherDeps = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  isAllowedAddress?: (address: string) => boolean;
  /**
   * Origins (e.g. this API's own development storage) that may be fetched
   * over http and on private addresses. Must come from server configuration,
   * never from user input.
   */
  trustedOrigins?: readonly string[];
};

/** Only globally routable unicast addresses. Everything else (private, loopback, link-local, CGNAT, mapped, NAT64, …) is refused. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    return false;
  }
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === "unicast";
}

async function resolveWithDns(hostname: string): Promise<ResolvedAddress[]> {
  const results = await lookup(hostname, { all: true, order: "verbatim" });
  return results.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
}

function pinnedLookup(target: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: target.address, family: target.family }]);
    } else {
      callback(null, target.address, target.family);
    }
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Creates a fetcher for untrusted URLs. Every hop is validated: https only,
 * no credentials, default port, and every resolved address must be public.
 * The connection is pinned to the validated address so DNS cannot change
 * between the check and the request.
 */
export function createSafeFetcher(deps: SafeFetcherDeps = {}) {
  const resolve = deps.resolve ?? resolveWithDns;
  const isAllowedAddress = deps.isAllowedAddress ?? isPublicAddress;
  const trusted = new Set((deps.trustedOrigins ?? []).map((origin) => new URL(origin).origin));

  async function validate(url: URL): Promise<ResolvedAddress> {
    const isTrusted = trusted.has(url.origin);
    if (url.protocol !== "https:" && !(isTrusted && url.protocol === "http:")) {
      throw new UnsafeUrlError("Only https URLs can be fetched.");
    }
    if (url.username || url.password) {
      throw new UnsafeUrlError("URLs with credentials are not allowed.");
    }
    if (url.port !== "" && !isTrusted) {
      throw new UnsafeUrlError("Only the default https port is allowed.");
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = ipaddr.isValid(hostname)
      ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === "ipv6" ? 6 : 4 } as const]
      : await resolve(hostname).catch(() => {
          throw new UnsafeUrlError(`Could not resolve ${hostname}.`);
        });
    if (addresses.length === 0) {
      throw new UnsafeUrlError(`Could not resolve ${hostname}.`);
    }
    if (!isTrusted && addresses.some((entry) => !isAllowedAddress(entry.address))) {
      throw new UnsafeUrlError(`${hostname} resolves to a non-public address.`);
    }
    const first = addresses[0];
    if (!first) {
      throw new UnsafeUrlError(`Could not resolve ${hostname}.`);
    }
    return first;
  }

  return async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxRedirects = options.maxRedirects ?? 3;
    const signal = AbortSignal.timeout(timeoutMs);
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new UnsafeUrlError("Invalid URL.");
    }

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const target = await validate(url);
      const agent = new Agent({ connect: { lookup: pinnedLookup(target), timeout: timeoutMs } });
      try {
        const response = await request(url, {
          dispatcher: agent,
          method: "GET",
          signal,
          headers: { accept: "application/json, image/*;q=0.9, */*;q=0.1", "user-agent": "minthouse-metadata-check/1" },
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
        });
        if (REDIRECT_STATUSES.has(response.statusCode)) {
          const location = response.headers.location;
          await response.body.dump();
          if (typeof location !== "string") {
            throw new UnsafeUrlError("Redirect without a Location header.");
          }
          url = new URL(location, url);
          continue;
        }
        const declared = Number(response.headers["content-length"] ?? "0");
        if (declared > options.maxBytes) {
          await response.body.dump();
          throw new FetchLimitError(`Response is larger than ${options.maxBytes} bytes.`);
        }
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of response.body) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          total += buffer.length;
          if (total > options.maxBytes) {
            response.body.destroy();
            throw new FetchLimitError(`Response is larger than ${options.maxBytes} bytes.`);
          }
          chunks.push(buffer);
        }
        const contentType = response.headers["content-type"];
        return {
          url: url.toString(),
          status: response.statusCode,
          contentType: typeof contentType === "string" ? contentType : null,
          body: Buffer.concat(chunks),
        };
      } finally {
        await agent.close();
      }
    }
    throw new UnsafeUrlError(`More than ${maxRedirects} redirects.`);
  };
}

export type SafeFetch = ReturnType<typeof createSafeFetcher>;
