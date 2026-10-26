import "@/polyfills";
import { Keypair } from "@solana/web3.js";
import { isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainFamily } from "@minthouse/shared";

/** A key held only long enough to sign one launch. It is never sent to the API. */
export type LaunchSecret =
  | { family: "bsc"; address: `0x${string}`; privateKey: Hex }
  | { family: "solana"; address: string; keypair: Keypair };

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Reads a chain private key.
 * BSC accepts a 32-byte hex key. Solana accepts a 64-byte secret or a 32-byte
 * seed, as hex, base58, or a JSON byte array. Seed phrases are refused.
 */
export function readLaunchSecret(
  family: ChainFamily,
  raw: string,
): LaunchSecret | null {
  const value = unwrap(raw);
  if (!value || isSeedPhrase(value)) {
    return null;
  }
  switch (family) {
    case "bsc":
      return readEvmSecret(value);
    case "solana":
      return readSolanaSecret(value);
    default: {
      const exhaustive: never = family;
      throw new Error(`Unhandled chain family ${String(exhaustive)}`);
    }
  }
}

/** Public address of a launch key, or null when the text is not a key for this chain. */
export function launchSecretAddress(
  family: ChainFamily,
  raw: string,
): string | null {
  return readLaunchSecret(family, raw)?.address ?? null;
}

function unwrap(raw: string): string {
  const trimmed = raw.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted ? trimmed.slice(1, -1).trim() : trimmed;
}

function isSeedPhrase(value: string): boolean {
  const words = value.split(/\s+/);
  return words.length >= 12 && words.every((word) => /^[a-z]+$/i.test(word));
}

function readEvmSecret(value: string): LaunchSecret | null {
  const prefixed = value.startsWith("0x") || value.startsWith("0X")
    ? `0x${value.slice(2)}`
    : `0x${value}`;
  if (!isHex(prefixed, { strict: true }) || prefixed.length !== 66) {
    return null;
  }
  const privateKey = prefixed.toLowerCase() as Hex;
  try {
    const account = privateKeyToAccount(privateKey);
    return { family: "bsc", address: account.address, privateKey };
  } catch {
    return null;
  }
}

function readSolanaSecret(value: string): LaunchSecret | null {
  const bytes = value.startsWith("[")
    ? bytesFromJson(value)
    : bytesFromHex(value) ?? decodeBase58(value);
  if (!bytes || (bytes.length !== 32 && bytes.length !== 64)) {
    return null;
  }
  try {
    const keypair =
      bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes);
    return {
      family: "solana",
      address: keypair.publicKey.toBase58(),
      keypair,
    };
  } catch {
    return null;
  }
}

function bytesFromJson(value: string): Uint8Array | null {
  const parsed = parseJson(value);
  if (!isByteList(parsed)) {
    return null;
  }
  return Uint8Array.from(parsed);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isByteList(value: unknown): value is number[] {
  if (!Array.isArray(value) || (value.length !== 32 && value.length !== 64)) {
    return false;
  }
  for (const item of value as readonly unknown[]) {
    if (
      typeof item !== "number" ||
      !Number.isInteger(item) ||
      item < 0 ||
      item > 255
    ) {
      return false;
    }
  }
  return true;
}

function bytesFromHex(value: string): Uint8Array | null {
  const hex =
    value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  if (hex.length !== 64 && hex.length !== 128) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function decodeBase58(value: string): Uint8Array | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
    return null;
  }
  const bytes = [0];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) {
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
