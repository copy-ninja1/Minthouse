import {
  NETWORKS,
  SOL_DECIMALS,
  type NetworkId,
  formatTokenAmount,
  stringToBigint,
} from "@minthouse/shared";

export type TokenMarketQuote = {
  /** Spot price in USD, when a DEX/indexer knows one. */
  priceUsd: number | null;
  /** Fully diluted valuation in USD, when available. */
  fdvUsd: number | null;
  /** Human-readable source label for the quote. */
  source: string;
};

type DexScreenerPair = {
  priceUsd?: string;
  fdv?: number;
  liquidity?: { usd?: number };
};

type DexScreenerResponse = {
  pairs?: DexScreenerPair[] | null;
};

const NATIVE_COINGECKO_IDS = {
  SOL: "solana",
  BNB: "binancecoin",
  tBNB: "binancecoin",
} as const;

/**
 * Best available USD quote for a token address from DexScreener.
 * Returns null when the token has no indexed pool yet.
 */
export async function fetchDexScreenerQuote(
  tokenAddress: string,
  signal?: AbortSignal,
): Promise<TokenMarketQuote | null> {
  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`,
    { signal, headers: { accept: "application/json" } },
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as DexScreenerResponse;
  const pairs = body.pairs ?? [];
  if (pairs.length === 0) {
    return null;
  }
  const ranked = [...pairs].sort(
    (left, right) => (right.liquidity?.usd ?? 0) - (left.liquidity?.usd ?? 0),
  );
  const best = ranked[0];
  if (!best) {
    return null;
  }
  const priceUsd = best.priceUsd ? Number(best.priceUsd) : null;
  return {
    priceUsd: priceUsd !== null && Number.isFinite(priceUsd) ? priceUsd : null,
    fdvUsd:
      typeof best.fdv === "number" && Number.isFinite(best.fdv) ? best.fdv : null,
    source: "DexScreener",
  };
}

/** Spot USD price for SOL or BNB via CoinGecko (no API key). */
export async function fetchNativeUsdPrice(
  symbol: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const id =
    symbol in NATIVE_COINGECKO_IDS
      ? NATIVE_COINGECKO_IDS[symbol as keyof typeof NATIVE_COINGECKO_IDS]
      : null;
  if (!id) {
    return null;
  }
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
    { signal, headers: { accept: "application/json" } },
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as Record<string, { usd?: number }>;
  const price = body[id]?.usd;
  return typeof price === "number" && Number.isFinite(price) ? price : null;
}

/**
 * Converts a Pump.fun SOL market cap (lamports) into a USD quote using the
 * live SOL price. Falls back to null when the oracle is unavailable.
 */
export async function pumpMarketCapUsd(
  marketCapLamports: string,
  network: NetworkId,
  signal?: AbortSignal,
): Promise<TokenMarketQuote | null> {
  const native = NETWORKS[network].nativeSymbol;
  const solUsd = await fetchNativeUsdPrice(native, signal);
  if (solUsd === null) {
    return null;
  }
  try {
    const lamports = stringToBigint(marketCapLamports);
    const sol = Number(formatTokenAmount(lamports, SOL_DECIMALS, { maxFractionDigits: 9 }));
    if (!Number.isFinite(sol)) {
      return null;
    }
    const fdvUsd = sol * solUsd;
    return { priceUsd: null, fdvUsd, source: "Pump curve × CoinGecko" };
  } catch {
    return null;
  }
}

/** Formats a USD amount for compact display, e.g. "$1.2K". */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}
