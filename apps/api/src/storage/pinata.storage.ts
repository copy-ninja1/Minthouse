import { z } from "zod";
import { ObjectStorage, type StoredObject, StorageUnavailableError } from "./object-storage.js";

const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const PINATA_AUTH_URL = "https://api.pinata.cloud/data/testAuthentication";

const uploadResponseSchema = z.object({
  data: z.object({ cid: z.string().min(1) }),
});

/** Pins files to public IPFS through Pinata. The JWT stays on the server. */
export class PinataStorage extends ObjectStorage {
  readonly provider = "ipfs-pinata" as const;
  readonly persistent = true;

  constructor(
    private readonly jwt: string,
    private readonly gatewayUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async put(object: { name: string; bytes: Buffer; contentType: string }): Promise<StoredObject> {
    const form = new FormData();
    form.append("network", "public");
    form.append("name", object.name);
    form.append("file", new Blob([new Uint8Array(object.bytes)], { type: object.contentType }), object.name);

    const response = await this.fetchImpl(PINATA_UPLOAD_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${this.jwt}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new StorageUnavailableError(`IPFS upload failed with HTTP ${response.status}.`);
    }
    const parsed = uploadResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new StorageUnavailableError("IPFS upload returned an unexpected response.");
    }
    const { cid } = parsed.data.data;
    return { cid, uri: `${this.gatewayUrl.replace(/\/$/, "")}/ipfs/${cid}` };
  }

  async ready(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(PINATA_AUTH_URL, {
        headers: { authorization: `Bearer ${this.jwt}` },
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
