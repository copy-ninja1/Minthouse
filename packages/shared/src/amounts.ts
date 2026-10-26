/** Largest value an ERC-20 `uint256` balance or supply can hold. */
export const UINT256_MAX = (1n << 256n) - 1n;
/** Largest value an SPL Token `u64` amount or supply can hold. */
export const U64_MAX = (1n << 64n) - 1n;

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const WHOLE_PATTERN = /^(?:0|[1-9]\d*)$/;
const MAX_DECIMALS = 77;

export class AmountError extends Error {
  override readonly name = "AmountError";
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new AmountError(`Invalid decimals: ${decimals}`);
  }
}

/**
 * Converts a human-readable token amount ("12.5") to integer base units.
 *
 * Rejects (rather than rounds) inputs with more fractional digits than
 * `decimals`, so a user never signs for an amount different from what they typed.
 *
 * @param value - Decimal string without grouping separators or exponent.
 * @param decimals - Token decimals.
 * @returns Amount in base units.
 */
export function parseTokenAmount(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  const trimmed = value.trim();
  const match = DECIMAL_PATTERN.exec(trimmed);
  if (!match) {
    throw new AmountError("Enter a plain decimal number, for example 1000 or 0.5");
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new AmountError(`At most ${decimals} decimal places are allowed`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/**
 * Converts a whole-token supply ("1000000") to base units.
 *
 * Supply configuration in this project is always expressed in whole tokens;
 * this function makes the conversion explicit and rejects fractional input.
 */
export function wholeTokensToBaseUnits(wholeTokens: string | bigint, decimals: number): bigint {
  assertDecimals(decimals);
  const asString = typeof wholeTokens === "bigint" ? wholeTokens.toString() : wholeTokens.trim();
  if (!WHOLE_PATTERN.test(asString)) {
    throw new AmountError("Supply must be a whole number of tokens");
  }
  return BigInt(asString) * 10n ** BigInt(decimals);
}

export type FormatOptions = {
  /** Insert thousands separators in the whole part. Defaults to true. */
  group?: boolean;
  /** Truncate (never round) to this many fractional digits. */
  maxFractionDigits?: number;
};

/** Formats base units as a human-readable decimal string without floating point. */
export function formatTokenAmount(raw: bigint, decimals: number, options: FormatOptions = {}): string {
  assertDecimals(decimals);
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = (absolute / base).toString();
  let fraction = decimals === 0 ? "" : (absolute % base).toString().padStart(decimals, "0");
  if (options.maxFractionDigits !== undefined) {
    fraction = fraction.slice(0, options.maxFractionDigits);
  }
  fraction = fraction.replace(/0+$/, "");
  const groupedWhole = options.group === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${groupedWhole}${fraction ? `.${fraction}` : ""}`;
}

export function fitsUint256(value: bigint): boolean {
  return value >= 0n && value <= UINT256_MAX;
}

export function fitsU64(value: bigint): boolean {
  return value >= 0n && value <= U64_MAX;
}

/** Serialises a bigint for JSON transport. Amounts always travel as base-10 strings. */
export function bigintToString(value: bigint): string {
  return value.toString(10);
}

export function stringToBigint(value: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new AmountError(`Not an integer string: ${value}`);
  }
  return BigInt(value);
}
