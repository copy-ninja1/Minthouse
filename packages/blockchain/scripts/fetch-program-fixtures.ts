/**
 * Downloads deployed program binaries (and selected state accounts) from
 * Solana mainnet so LiteSVM tests run the real on-chain code. Output goes to
 * `test-fixtures/` (git-ignored) with a manifest recording the source slot and
 * SHA-256 of every file, so a test failure can always be traced to exact bytes.
 *
 *   pnpm --filter @minthouse/blockchain fixtures [--force]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import { FIXTURE_ACCOUNTS, FIXTURE_PROGRAMS, type FixtureManifest } from "../src/solana/testing/fixtures.js";

const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAM_DATA_HEADER = 45;

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test-fixtures");
const rpcUrl = process.env.SOLANA_FIXTURE_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const connection = new Connection(rpcUrl, "confirmed");
const force = process.argv.includes("--force");

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function exists(file: string): Promise<boolean> {
  return readFile(file).then(
    () => true,
    () => false,
  );
}

async function fetchProgram(programId: PublicKey): Promise<Uint8Array> {
  const program = await connection.getAccountInfo(programId);
  if (!program?.executable) {
    throw new Error(`${programId.toBase58()} is not an executable program on ${rpcUrl}`);
  }
  if (!program.owner.equals(UPGRADEABLE_LOADER)) {
    return program.data;
  }
  const programData = new PublicKey(program.data.subarray(4, 36));
  const data = await connection.getAccountInfo(programData);
  if (!data) {
    throw new Error(`Program data account ${programData.toBase58()} not found`);
  }
  return data.data.subarray(PROGRAM_DATA_HEADER);
}

await mkdir(directory, { recursive: true });
const manifestPath = path.join(directory, "manifest.json");
const manifest: FixtureManifest = force
  ? { rpcUrl, programs: {}, accounts: {} }
  : await readFile(manifestPath, "utf8")
      .then((raw) => JSON.parse(raw) as FixtureManifest)
      .catch(() => ({ rpcUrl, programs: {}, accounts: {} }));

for (const program of FIXTURE_PROGRAMS) {
  const file = path.join(directory, `${program.name}.so`);
  if (!force && (await exists(file))) {
    console.log(`✓ ${program.name} (cached)`);
    continue;
  }
  const slot = await connection.getSlot();
  const bytes = await fetchProgram(new PublicKey(program.id));
  await writeFile(file, bytes);
  manifest.programs[program.name] = { id: program.id, slot, sha256: sha256(bytes), bytes: bytes.length };
  console.log(`↓ ${program.name} ${program.id} (${bytes.length} bytes, slot ${slot})`);
}

for (const account of FIXTURE_ACCOUNTS) {
  const file = path.join(directory, `${account.name}.json`);
  if (!force && (await exists(file))) {
    console.log(`✓ ${account.name} (cached)`);
    continue;
  }
  const slot = await connection.getSlot();
  const info = await connection.getAccountInfo(new PublicKey(account.address));
  if (!info) {
    throw new Error(`Account ${account.name} (${account.address}) not found`);
  }
  await writeFile(
    file,
    JSON.stringify({
      address: account.address,
      owner: info.owner.toBase58(),
      lamports: info.lamports.toString(),
      executable: info.executable,
      data: info.data.toString("base64"),
    }),
  );
  manifest.accounts[account.name] = { address: account.address, slot, sha256: sha256(info.data) };
  console.log(`↓ ${account.name} ${account.address} (slot ${slot})`);
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Fixtures in ${directory}`);
