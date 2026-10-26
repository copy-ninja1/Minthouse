import { createHash } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";
import type { ApiEnv } from "@minthouse/config";
import {
  ACCEPTED_LOGO_MIME_TYPES,
  type MetadataCheck,
  type MetadataVerification,
  type PublishMetadataRequest,
  type PublishedMetadata,
  SOLANA_URI_MAX_BYTES,
  type TokenMetadataDocument,
  type VerifyMetadataRequest,
  canonicalJson,
  getLaunchModeCapabilities,
  getNetwork,
  publishMetadataRequestSchema,
  tokenMetadataDocumentSchema,
  utf8ByteLength,
} from "@minthouse/shared";
import { NotAMintError, readMintState } from "@minthouse/blockchain/solana";
import { API_ENV } from "../config/env.js";
import { ChainClientsService } from "../chains/chain-clients.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { LOCAL_STORAGE_ROUTE } from "../storage/local.storage.js";
import { SAFE_FETCH, type SafeFetch } from "../security/safe-fetch.provider.js";
import { FetchLimitError, UnsafeUrlError } from "../security/safe-fetch.js";
import type { MetadataAsset } from "../generated/prisma/client.js";

const MAX_METADATA_BYTES = 64 * 1024;
const IPFS_PATH = /\/ipfs\/(baf[a-z2-7]{50,}|Qm[1-9A-HJ-NP-Za-km-z]{44})(\/|$)/;

function describeFetchError(error: unknown): string {
  if (error instanceof UnsafeUrlError || error instanceof FetchLimitError) {
    return error.message;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "The request timed out.";
  }
  return "The URL could not be fetched.";
}

@Injectable()
export class MetadataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly chains: ChainClientsService,
    @Inject(SAFE_FETCH) private readonly safeFetch: SafeFetch,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  toPublished(row: MetadataAsset): PublishedMetadata {
    const document = tokenMetadataDocumentSchema.parse(row.document);
    return {
      id: row.id,
      metadataUri: row.uri,
      imageUri: document.image,
      storage: row.storage === "ipfs-pinata" ? "ipfs-pinata" : "local-dev",
      persistent: row.persistent,
      contentAddressed: row.storage === "ipfs-pinata",
      document,
    };
  }

  async findDocument(id: string): Promise<MetadataAsset> {
    const row = await this.prisma.metadataAsset.findUnique({ where: { id } });
    if (!row || row.kind !== "document") {
      throw new NotFoundException("Metadata document not found.");
    }
    return row;
  }

  async publish(request: PublishMetadataRequest): Promise<PublishedMetadata> {
    const input = publishMetadataRequestSchema.parse(request);
    this.chains.assertEnabled(input.network);
    const capabilities = getLaunchModeCapabilities(input.mode);
    if (!(capabilities.networks as readonly string[]).includes(input.network)) {
      throw new BadRequestException(`${capabilities.label} is not available on ${input.network}.`);
    }
    if (getNetwork(input.network).isMainnet && !this.storage.persistent) {
      throw new UnprocessableEntityException(
        "Mainnet metadata must be pinned to IPFS. This server is using temporary development storage.",
      );
    }

    const logo = await this.prisma.metadataAsset.findUnique({ where: { id: input.logoAssetId } });
    if (!logo || logo.kind !== "logo") {
      throw new NotFoundException("Logo not found. Upload the logo first.");
    }
    if (logo.storage !== this.storage.provider) {
      throw new UnprocessableEntityException("The logo was stored with a different storage provider. Upload it again.");
    }

    const document: TokenMetadataDocument = tokenMetadataDocumentSchema.parse({
      name: input.name,
      symbol: input.symbol,
      description: input.description,
      image: logo.uri,
      ...(input.website ? { website: input.website, external_url: input.website } : {}),
      ...(input.twitter ? { twitter: input.twitter } : {}),
      ...(input.telegram ? { telegram: input.telegram } : {}),
      ...(input.mode === "pumpfun" ? { showName: true } : {}),
      properties: { category: "image", files: [{ uri: logo.uri, type: "image/png" }] },
    });
    const json = canonicalJson(document);
    const sha256 = createHash("sha256").update(json).digest("hex");

    const existing = await this.prisma.metadataAsset.findUnique({
      where: { kind_storage_sha256: { kind: "document", storage: this.storage.provider, sha256 } },
    });
    if (existing) {
      return this.toPublished(existing);
    }

    const stored = await this.storage.put({
      name: `metadata-${sha256.slice(0, 32)}.json`,
      bytes: Buffer.from(json, "utf8"),
      contentType: "application/json",
    });
    if (capabilities.family === "solana" && utf8ByteLength(stored.uri) > SOLANA_URI_MAX_BYTES) {
      throw new UnprocessableEntityException(
        `The metadata URI is longer than Solana's ${SOLANA_URI_MAX_BYTES}-byte limit. Configure a shorter IPFS gateway URL.`,
      );
    }

    const row = await this.prisma.metadataAsset.upsert({
      where: { kind_storage_sha256: { kind: "document", storage: this.storage.provider, sha256 } },
      update: {},
      create: {
        kind: "document",
        sha256,
        storage: this.storage.provider,
        persistent: this.storage.persistent,
        uri: stored.uri,
        mimeType: "application/json",
        bytes: Buffer.byteLength(json),
        document,
      },
    });
    return this.toPublished(row);
  }

  private fetchableUrl(uri: string): string | null {
    if (uri.startsWith("ipfs://")) {
      return `${this.env.IPFS_GATEWAY_URL.replace(/\/$/, "")}/ipfs/${uri.slice("ipfs://".length)}`;
    }
    try {
      const url = new URL(uri);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  private isLocalStorageUri(uri: string): boolean {
    try {
      const url = new URL(uri);
      return url.origin === new URL(this.env.PUBLIC_API_URL).origin && url.pathname.startsWith(LOCAL_STORAGE_ROUTE);
    } catch {
      return false;
    }
  }

  /**
   * Independently fetches and checks a metadata URI. Each check reports
   * pass / fail / unknown; nothing is assumed to pass without evidence.
   */
  async verify(request: VerifyMetadataRequest): Promise<MetadataVerification> {
    const checks = new Map<MetadataCheck["id"], MetadataCheck>();
    const set = (id: MetadataCheck["id"], label: string, status: MetadataCheck["status"], detail: string) =>
      checks.set(id, { id, label, status, detail });

    let document: TokenMetadataDocument | null = null;
    const url = this.fetchableUrl(request.uri);
    if (!url) {
      set("metadata-reachable", "Metadata reachable", "fail", "Only https:// and ipfs:// URIs are supported.");
    } else {
      try {
        const response = await this.safeFetch(url, { maxBytes: MAX_METADATA_BYTES });
        if (response.status !== 200) {
          set("metadata-reachable", "Metadata reachable", "fail", `HTTP ${response.status}.`);
        } else {
          set("metadata-reachable", "Metadata reachable", "pass", `Fetched ${response.body.length} bytes.`);
          let json: unknown;
          try {
            json = JSON.parse(response.body.toString("utf8"));
          } catch {
            json = undefined;
          }
          const parsed = tokenMetadataDocumentSchema.safeParse(json);
          if (parsed.success) {
            document = parsed.data;
            set("metadata-valid", "Metadata format", "pass", "Matches the Metaplex fungible token metadata standard.");
          } else {
            const issue = parsed.error.issues[0];
            set(
              "metadata-valid",
              "Metadata format",
              "fail",
              json === undefined ? "The response is not JSON." : `${issue?.path.join(".") || "document"}: ${issue?.message ?? "invalid"}`,
            );
          }
        }
      } catch (error) {
        set("metadata-reachable", "Metadata reachable", "fail", describeFetchError(error));
      }
    }
    if (!checks.has("metadata-valid")) {
      set("metadata-valid", "Metadata format", "unknown", "The metadata could not be read.");
    }

    await this.checkImage(document, set);
    await this.checkOnchainUri(request, set);

    if (IPFS_PATH.test(request.uri) || request.uri.startsWith("ipfs://")) {
      set("persistent-storage", "Persistent storage", "pass", "Content-addressed IPFS URI; the content cannot change.");
    } else if (this.isLocalStorageUri(request.uri)) {
      set("persistent-storage", "Persistent storage", "fail", "Temporary development storage. It will disappear with this server.");
    } else {
      set("persistent-storage", "Persistent storage", "unknown", "Not an IPFS URI; availability depends on the host.");
    }

    const order: MetadataCheck["id"][] = [
      "metadata-reachable",
      "metadata-valid",
      "image-reachable",
      "image-format",
      "onchain-uri-match",
      "persistent-storage",
    ];
    return {
      uri: request.uri,
      checkedAt: new Date().toISOString(),
      checks: order.flatMap((id) => {
        const check = checks.get(id);
        return check ? [check] : [];
      }),
      document,
    };
  }

  private async checkImage(
    document: TokenMetadataDocument | null,
    set: (id: MetadataCheck["id"], label: string, status: MetadataCheck["status"], detail: string) => void,
  ): Promise<void> {
    const imageUrl = document ? this.fetchableUrl(document.image) : null;
    if (!document) {
      set("image-reachable", "Logo reachable", "unknown", "No valid metadata to read the image from.");
      set("image-format", "Logo format", "unknown", "No image was fetched.");
      return;
    }
    if (!imageUrl) {
      set("image-reachable", "Logo reachable", "fail", "The image URI must be https:// or ipfs://.");
      set("image-format", "Logo format", "unknown", "No image was fetched.");
      return;
    }
    try {
      const response = await this.safeFetch(imageUrl, { maxBytes: this.env.MAX_LOGO_BYTES * 2 });
      if (response.status !== 200) {
        set("image-reachable", "Logo reachable", "fail", `HTTP ${response.status}.`);
        set("image-format", "Logo format", "unknown", "No image was fetched.");
        return;
      }
      set("image-reachable", "Logo reachable", "pass", `Fetched ${response.body.length} bytes.`);
      const type = await fileTypeFromBuffer(response.body);
      if (type && (ACCEPTED_LOGO_MIME_TYPES as readonly string[]).includes(type.mime)) {
        set("image-format", "Logo format", "pass", `The file is ${type.mime}.`);
      } else {
        set("image-format", "Logo format", "fail", `The file is ${type?.mime ?? "not a recognised image"}; expected PNG, JPEG or WebP.`);
      }
    } catch (error) {
      set("image-reachable", "Logo reachable", "fail", describeFetchError(error));
      set("image-format", "Logo format", "unknown", "No image was fetched.");
    }
  }

  private async checkOnchainUri(
    request: VerifyMetadataRequest,
    set: (id: MetadataCheck["id"], label: string, status: MetadataCheck["status"], detail: string) => void,
  ): Promise<void> {
    const label = "Matches on-chain URI";
    if (!request.network || !request.tokenAddress) {
      set("onchain-uri-match", label, "unknown", "No token address was given, so the chain was not checked.");
      return;
    }
    const network = getNetwork(request.network);
    if (network.family === "bsc") {
      set("onchain-uri-match", label, "unknown", "ERC-20 tokens have no on-chain metadata URI; this metadata is application-level only.");
      return;
    }
    try {
      const state = await readMintState(this.chains.solana(request.network), request.tokenAddress);
      if (!state.metadata) {
        set("onchain-uri-match", label, "fail", "The mint has no on-chain metadata.");
      } else if (state.metadata.uri === request.uri) {
        set("onchain-uri-match", label, "pass", "The mint's on-chain metadata points to this URI.");
      } else {
        set("onchain-uri-match", label, "fail", `The mint points to ${state.metadata.uri}.`);
      }
    } catch (error) {
      if (error instanceof NotAMintError) {
        set("onchain-uri-match", label, "fail", error.message);
        return;
      }
      set("onchain-uri-match", label, "unknown", "The chain could not be reached.");
    }
  }
}
