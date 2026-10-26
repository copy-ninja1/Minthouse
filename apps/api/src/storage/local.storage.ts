import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { ObjectStorage, type StoredObject } from "./object-storage.js";

export const LOCAL_STORAGE_ROUTE = "/storage/";

const SAFE_NAME = /^[a-z0-9][a-z0-9.-]{0,127}$/;

/**
 * Development-only storage on the API's disk. URLs point back at this API and
 * disappear with it, so anything published here is marked non-persistent and
 * must never be written into a mainnet token.
 */
export class LocalStorage extends ObjectStorage {
  readonly provider = "local-dev" as const;
  readonly persistent = false;

  constructor(
    readonly directory: string,
    private readonly publicApiUrl: string,
  ) {
    super();
  }

  async put(object: { name: string; bytes: Buffer; contentType: string }): Promise<StoredObject> {
    if (!SAFE_NAME.test(object.name)) {
      throw new Error(`Refusing unsafe storage object name: ${object.name}`);
    }
    await mkdir(this.directory, { recursive: true });
    await writeFile(path.join(this.directory, object.name), object.bytes);
    return { cid: null, uri: new URL(`${LOCAL_STORAGE_ROUTE}${object.name}`, this.publicApiUrl).toString() };
  }

  async ready(): Promise<boolean> {
    try {
      await mkdir(this.directory, { recursive: true });
      await access(this.directory, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
