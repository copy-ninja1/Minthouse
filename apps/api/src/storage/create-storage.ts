import path from "node:path";
import type { ApiEnv } from "@minthouse/config";
import { LocalStorage } from "./local.storage.js";
import type { ObjectStorage } from "./object-storage.js";
import { PinataStorage } from "./pinata.storage.js";

export function createObjectStorage(env: ApiEnv): ObjectStorage {
  switch (env.STORAGE_PROVIDER) {
    case "pinata": {
      if (!env.PINATA_JWT) {
        throw new Error("PINATA_JWT is required when STORAGE_PROVIDER=pinata");
      }
      return new PinataStorage(env.PINATA_JWT, env.IPFS_GATEWAY_URL);
    }
    case "local":
      return new LocalStorage(path.resolve(env.LOCAL_STORAGE_DIR), env.PUBLIC_API_URL);
    default: {
      const exhaustive: never = env.STORAGE_PROVIDER;
      throw new Error(`Unhandled storage provider ${String(exhaustive)}`);
    }
  }
}
