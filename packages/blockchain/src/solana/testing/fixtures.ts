import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import {
  GLOBAL_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  MAYHEM_PROGRAM_ID,
  PUMP_FEE_CONFIG_PDA,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  getGlobalParamsPda,
} from "@pump-fun/pump-sdk";
import type { LiteSvmConnection } from "./litesvm-connection.js";

export type FixtureManifest = {
  rpcUrl: string;
  programs: Record<string, { id: string; slot: number; sha256: string; bytes: number }>;
  accounts: Record<string, { address: string; slot: number; sha256: string }>;
};

/** Mainnet programs whose real binaries the tests execute. */
export const FIXTURE_PROGRAMS = [
  { name: "mpl_token_metadata", id: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" },
  { name: "pump", id: PUMP_PROGRAM_ID.toBase58() },
  { name: "pump_fees", id: PUMP_FEE_PROGRAM_ID.toBase58() },
  { name: "mayhem", id: MAYHEM_PROGRAM_ID.toBase58() },
] as const;

export const PUMP_FIXTURE_PROGRAMS = ["pump", "pump_fees", "mayhem"] as const;

/** Mainnet state accounts cloned into tests: the Pump protocol configuration a launch and trade read. */
export const FIXTURE_ACCOUNTS: readonly { name: string; address: string }[] = [
  { name: "pump_global", address: GLOBAL_PDA.toBase58() },
  { name: "pump_fee_config", address: PUMP_FEE_CONFIG_PDA.toBase58() },
  { name: "pump_global_volume_accumulator", address: GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58() },
  { name: "mayhem_global_params", address: getGlobalParamsPda().toBase58() },
];

export const FIXTURE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../test-fixtures");

export function fixturePath(file: string): string {
  return path.join(FIXTURE_DIRECTORY, file);
}

export async function fixturesAvailable(names: readonly string[]): Promise<boolean> {
  const checks = await Promise.all(
    names.map((name) =>
      readFile(fixturePath(name)).then(
        () => true,
        () => false,
      ),
    ),
  );
  return checks.every(Boolean);
}

export async function loadFixtureAccount(connection: LiteSvmConnection, name: string): Promise<PublicKey> {
  const raw = JSON.parse(await readFile(fixturePath(`${name}.json`), "utf8")) as {
    address: string;
    owner: string;
    lamports: string;
    executable: boolean;
    data: string;
  };
  const pubkey = new PublicKey(raw.address);
  connection.setAccount(pubkey, {
    lamports: BigInt(raw.lamports),
    owner: new PublicKey(raw.owner),
    data: Buffer.from(raw.data, "base64"),
    executable: raw.executable,
  });
  return pubkey;
}
