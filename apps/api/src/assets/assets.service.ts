import { Inject, Injectable, PayloadTooLargeException, UnprocessableEntityException, UnsupportedMediaTypeException } from "@nestjs/common";
import type { ApiEnv } from "@minthouse/config";
import type { LogoAsset } from "@minthouse/shared";
import { API_ENV } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ObjectStorage } from "../storage/object-storage.js";
import type { MetadataAsset } from "../generated/prisma/client.js";
import { LogoRejectedError, STANDARD_LOGO_SIZE, TRUST_WALLET_LOGO_SIZE, processLogo } from "./logo-processing.js";

export function toLogoAsset(row: MetadataAsset): LogoAsset {
  return {
    id: row.id,
    sha256: row.sha256,
    imageUri: row.uri,
    trustWalletImageUri: row.trustWalletUri,
    storage: row.storage === "ipfs-pinata" ? "ipfs-pinata" : "local-dev",
    persistent: row.persistent,
    width: row.width ?? STANDARD_LOGO_SIZE,
    height: row.height ?? STANDARD_LOGO_SIZE,
    bytes: row.bytes,
  };
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async uploadLogo(bytes: Buffer): Promise<LogoAsset> {
    let processed;
    try {
      processed = await processLogo(bytes, this.env.MAX_LOGO_BYTES);
    } catch (error) {
      if (error instanceof LogoRejectedError) {
        switch (error.reason) {
          case "too-large":
            throw new PayloadTooLargeException(error.message, { cause: error });
          case "unsupported-type":
            throw new UnsupportedMediaTypeException(error.message, { cause: error });
          case "too-small":
          case "corrupt":
            throw new UnprocessableEntityException(error.message, { cause: error });
          default: {
            const exhaustive: never = error.reason;
            throw new Error(`Unhandled logo rejection ${String(exhaustive)}`, { cause: error });
          }
        }
      }
      throw error;
    }

    const existing = await this.prisma.metadataAsset.findUnique({
      where: { kind_storage_sha256: { kind: "logo", storage: this.storage.provider, sha256: processed.sha256 } },
    });
    if (existing) {
      return toLogoAsset(existing);
    }

    const prefix = processed.sha256.slice(0, 32);
    const standard = await this.storage.put({
      name: `logo-${prefix}-${STANDARD_LOGO_SIZE}.png`,
      bytes: processed.standard,
      contentType: "image/png",
    });
    const trustWallet = processed.trustWallet
      ? await this.storage.put({
          name: `logo-${prefix}-${TRUST_WALLET_LOGO_SIZE}.png`,
          bytes: processed.trustWallet,
          contentType: "image/png",
        })
      : null;

    const row = await this.prisma.metadataAsset.upsert({
      where: { kind_storage_sha256: { kind: "logo", storage: this.storage.provider, sha256: processed.sha256 } },
      update: {},
      create: {
        kind: "logo",
        sha256: processed.sha256,
        storage: this.storage.provider,
        persistent: this.storage.persistent,
        uri: standard.uri,
        trustWalletUri: trustWallet?.uri ?? null,
        mimeType: "image/png",
        bytes: processed.standard.length,
        width: STANDARD_LOGO_SIZE,
        height: STANDARD_LOGO_SIZE,
      },
    });
    return toLogoAsset(row);
  }
}
