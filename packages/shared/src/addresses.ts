import { keccak_256 } from "@noble/hashes/sha3.js";
import type { ChainFamily } from "./networks.js";

/**
 * Address checks are implemented here, instead of through viem and
 * `@solana/web3.js`, because this module is imported by the browser bundle.
 * Those libraries pull in hundreds of kilobytes the page never uses.
 * Behavior matches them: EIP-55 for mixed-case EVM addresses, and a 32-byte
 * base58 public key for Solana (including PDAs).
 */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_INDEX = new Map<string, number>();
for (let index = 0; index < BASE58_ALPHABET.length; index += 1) {
  const character = BASE58_ALPHABET[index];
  if (character !== undefined) {
    BASE58_INDEX.set(character, index);
  }
}

export function isEvmAddress(value: string): boolean {
  if (!EVM_ADDRESS.test(value) || value.toLowerCase() === ZERO_ADDRESS) {
    return false;
  }
  // All-lowercase skips the checksum, matching viem's strict mode. Any
  // uppercase character must be the EIP-55 encoding, so a one-character typo fails.
  if (value === value.toLowerCase()) {
    return true;
  }
  return checksumEvmAddress(value) === value;
}

export function toChecksumAddress(value: string): `0x${string}` {
  if (!EVM_ADDRESS.test(value)) {
    throw new Error(`Invalid EVM address: ${value}`);
  }
  return checksumEvmAddress(value);
}

/** Validates a base58 Solana public key (32 bytes). Accepts PDAs, which are valid mint addresses. */
export function isSolanaAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    return false;
  }
  const decoded = decodeBase58(value);
  return decoded?.length === 32 && encodeBase58(decoded) === value;
}

export function isAddressForFamily(family: ChainFamily, value: string): boolean {
  switch (family) {
    case "bsc":
      return isEvmAddress(value);
    case "solana":
      return isSolanaAddress(value);
    default: {
      const exhaustive: never = family;
      throw new Error(`Unhandled chain family: ${String(exhaustive)}`);
    }
  }
}

/** Canonical form used for storage and comparisons. */
export function normalizeAddress(family: ChainFamily, value: string): string {
  switch (family) {
    case "bsc":
      return toChecksumAddress(value);
    case "solana": {
      const decoded = decodeBase58(value);
      if (!decoded || decoded.length !== 32) {
        throw new Error(`Invalid Solana address: ${value}`);
      }
      return encodeBase58(decoded);
    }
    default: {
      const exhaustive: never = family;
      throw new Error(`Unhandled chain family: ${String(exhaustive)}`);
    }
  }
}

export function sameAddress(family: ChainFamily, a: string, b: string): boolean {
  if (!isAddressForFamily(family, a) || !isAddressForFamily(family, b)) {
    return false;
  }
  return normalizeAddress(family, a) === normalizeAddress(family, b);
}

export function shortenAddress(value: string, visible = 4): string {
  if (value.length <= visible * 2 + 3) {
    return value;
  }
  return `${value.slice(0, visible + (value.startsWith("0x") ? 2 : 0))}…${value.slice(-visible)}`;
}

/** EIP-55 checksum. `keccak256` covers the lowercase hex text, not the raw bytes. */
function checksumEvmAddress(value: string): `0x${string}` {
  const hex = value.slice(2).toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(hex));
  let checksummed = "0x";
  for (let index = 0; index < hex.length; index += 1) {
    const byte = hash[index >> 1] ?? 0;
    const nibble = index % 2 === 0 ? byte >> 4 : byte & 0x0f;
    const character = hex[index] ?? "";
    checksummed += nibble >= 8 ? character.toUpperCase() : character;
  }
  return checksummed as `0x${string}`;
}

function decodeBase58(value: string): Uint8Array | null {
  const bytes = [0];
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) {
      return null;
    }
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += (bytes[index] ?? 0) * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeros = 0;
  for (const character of value) {
    if (character !== "1") {
      break;
    }
    leadingZeros += 1;
  }

  const decoded = new Uint8Array(leadingZeros + bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    decoded[decoded.length - 1 - index] = bytes[index] ?? 0;
  }
  return decoded;
}

function encodeBase58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    leadingZeros += 1;
  }

  return "1".repeat(leadingZeros) + digits.toReversed().map((digit) => BASE58_ALPHABET[digit] ?? "").join("");
}
