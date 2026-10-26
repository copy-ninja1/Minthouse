import "@/polyfills";
import { Keypair } from "@solana/web3.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { launchSecretAddress, readLaunchSecret } from "./launch-signer";

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const SOLANA_SECRET =
  "2Ana1pUpv2ZbMVkwF5FXapYeBEjdxDatLn7nvJkhgTSdZd8hbDHTd21as7EAsg7ypityqfsw2pMQKJcVDVcAEsd";
const SOLANA_ADDRESS = "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj";

describe("launch signer", () => {
  it("reads a BSC private key with or without the 0x prefix", () => {
    expect(launchSecretAddress("bsc", ANVIL_KEY)).toBe(ANVIL_ADDRESS);
    expect(launchSecretAddress("bsc", ANVIL_KEY.slice(2))).toBe(ANVIL_ADDRESS);
    expect(launchSecretAddress("bsc", `"${ANVIL_KEY}"`)).toBe(ANVIL_ADDRESS);
  });

  it("reads a generated BSC key without echoing it back", () => {
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    const secret = readLaunchSecret("bsc", privateKey);
    expect(secret?.address).toBe(address);
    expect(secret && "privateKey" in secret ? secret.privateKey : null).toBe(
      privateKey,
    );
  });

  it("reads a Solana secret as base58, hex, or a JSON byte array", () => {
    expect(launchSecretAddress("solana", SOLANA_SECRET)).toBe(SOLANA_ADDRESS);
    const keypair = Keypair.generate();
    const json = JSON.stringify(Array.from(keypair.secretKey));
    const hex = Array.from(keypair.secretKey)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(launchSecretAddress("solana", json)).toBe(
      keypair.publicKey.toBase58(),
    );
    expect(launchSecretAddress("solana", `0x${hex}`)).toBe(
      keypair.publicKey.toBase58(),
    );
    const seed = keypair.secretKey.slice(0, 32);
    expect(launchSecretAddress("solana", JSON.stringify(Array.from(seed)))).toBe(
      Keypair.fromSeed(seed).publicKey.toBase58(),
    );
  });

  it("refuses a seed phrase and a key for the other chain", () => {
    const phrase = Array.from({ length: 12 }, () => "abandon").join(" ");
    expect(readLaunchSecret("bsc", phrase)).toBeNull();
    expect(readLaunchSecret("solana", phrase)).toBeNull();
    expect(readLaunchSecret("bsc", SOLANA_SECRET)).toBeNull();
    expect(readLaunchSecret("solana", "not-a-key")).toBeNull();
    expect(readLaunchSecret("bsc", "")).toBeNull();
  });
});
