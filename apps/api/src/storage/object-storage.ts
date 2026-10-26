import type { StorageProvider } from "@minthouse/shared";

export type StoredObject = {
  /** Public https URL that wallets, explorers and Pump.fun can fetch. */
  uri: string;
  /** IPFS content identifier, when the provider is content-addressed. */
  cid: string | null;
};

export abstract class ObjectStorage {
  abstract readonly provider: StorageProvider;
  /** True only when objects are pinned and outlive this server. */
  abstract readonly persistent: boolean;
  abstract put(object: { name: string; bytes: Buffer; contentType: string }): Promise<StoredObject>;
  /** Cheap reachability probe for readiness checks. */
  abstract ready(): Promise<boolean>;
}

export class StorageUnavailableError extends Error {
  override readonly name = "StorageUnavailableError";
}
