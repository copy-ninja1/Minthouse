import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../deployments");

const deploymentRecordSchema = z.object({
  network: z.string(),
  chainId: z.number(),
  address: z.string(),
  txHash: z.string(),
  deployer: z.string(),
  blockNumber: z.string(),
  constructorArgs: z.tuple([z.string(), z.string(), z.number(), z.string(), z.string(), z.boolean()]),
  deployedAt: z.string(),
});
export type DeploymentRecord = z.infer<typeof deploymentRecordSchema>;

/** Saves a local, public-data-only deployment receipt used by the verify script. */
export async function saveDeployment(record: DeploymentRecord): Promise<string> {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${record.network}-${record.address}.json`);
  const json = JSON.stringify(record, null, 2);
  await writeFile(file, json);
  await writeFile(path.join(directory, `${record.network}-latest.json`), json);
  return file;
}

export async function loadDeployment(network: string, address?: string): Promise<DeploymentRecord> {
  const file = path.join(directory, `${network}-${address ?? "latest"}.json`);
  const raw = await readFile(file, "utf8").catch(() => {
    throw new Error(`No deployment record at ${file}. Deploy first or set TOKEN_ADDRESS to a recorded deployment.`);
  });
  return deploymentRecordSchema.parse(JSON.parse(raw));
}
