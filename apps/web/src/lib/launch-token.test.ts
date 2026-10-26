import {
  TX_ERROR_MESSAGES,
  splTokenConfigSchema,
  type Deployment,
  type LogoAsset,
  type PublishedMetadata,
} from "@minthouse/shared";
import { describe, expect, it, vi } from "vitest";
import { ChainLaunchError } from "./chain-launch-error";
import {
  type LaunchApi,
  type TokenDeployer,
  launchToken,
} from "./launch-token";

const CREATOR = "So11111111111111111111111111111111111111112";
const MINT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const config = splTokenConfigSchema.parse({
  mode: "solana-spl",
  network: "solana-devnet",
  name: "Lifecycle",
  symbol: "LIFE",
  description: "",
  decimals: 6,
  initialSupply: "1000000",
  recipient: CREATOR,
  mintAuthority: "revoke",
  metadataMutable: false,
});

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "ab".repeat(32),
    mode: "solana-spl",
    family: "solana",
    network: "solana-devnet",
    creator: CREATOR,
    tokenAddress: null,
    name: "Lifecycle",
    symbol: "LIFE",
    decimals: 6,
    initialSupply: "1000000",
    recipient: CREATOR,
    metadataUri: "https://example.com/meta.json",
    imageUri: "https://example.com/logo.png",
    txId: null,
    status: "awaiting-approval",
    errorCode: null,
    verification: null,
    lastCheckedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const logo: LogoAsset = {
  id: "00000000-0000-4000-8000-000000000002",
  sha256: "cd".repeat(32),
  imageUri: "https://example.com/logo.png",
  trustWalletImageUri: null,
  storage: "ipfs-pinata",
  persistent: true,
  width: 512,
  height: 512,
  bytes: 100,
};

const metadata: PublishedMetadata = {
  id: "00000000-0000-4000-8000-000000000003",
  metadataUri: "https://example.com/meta.json",
  imageUri: "https://example.com/logo.png",
  storage: "ipfs-pinata",
  persistent: true,
  contentAddressed: true,
  document: {},
};

function api(overrides: Partial<LaunchApi> = {}): LaunchApi {
  return {
    uploadLogo: vi.fn().mockResolvedValue(logo),
    publishMetadata: vi.fn().mockResolvedValue(metadata),
    createDeployment: vi.fn().mockResolvedValue(deployment()),
    recordSubmission: vi
      .fn()
      .mockImplementation(
        (_id: string, body: { txId: string; tokenAddress: string }) =>
          deployment({
            status: "submitted",
            txId: body.txId,
            tokenAddress: body.tokenAddress,
          }),
      ),
    cancelDeployment: vi
      .fn()
      .mockResolvedValue(
        deployment({ status: "cancelled", errorCode: "USER_REJECTED" }),
      ),
    getDeployment: vi
      .fn()
      .mockResolvedValue(
        deployment({ status: "completed", tokenAddress: MINT, txId: "sig" }),
      ),
    ...overrides,
  };
}

function deployer(
  submit: TokenDeployer["submit"] = vi
    .fn()
    .mockResolvedValue({
      txId: "sig",
      tokenAddress: MINT,
      lastValidBlockHeight: 10,
    }),
): TokenDeployer {
  return { family: "solana", address: CREATOR, submit };
}

describe("launchToken", () => {
  it("publishes metadata, records the launch, then waits until the chain check completes", async () => {
    const client = api();
    const wallet = deployer();
    const steps: string[] = [];
    const result = await launchToken(
      {
        config,
        logo: new File(["png"], "logo.png", { type: "image/png" }),
        deployer: wallet,
      },
      client,
      (step) => {
        steps.push(step);
      },
      { pollIntervalMs: 0, verifyTimeoutMs: 1_000 },
    );

    expect(steps).toEqual(["publish", "sign", "verify"]);
    expect(client.uploadLogo).toHaveBeenCalledOnce();
    expect(client.publishMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Lifecycle",
        symbol: "LIFE",
        logoAssetId: logo.id,
      }),
    );
    expect(wallet.submit).toHaveBeenCalledWith(config, metadata.metadataUri);
    expect(client.recordSubmission).toHaveBeenCalledWith(
      deployment().id,
      expect.objectContaining({ txId: "sig", tokenAddress: MINT }),
    );
    expect(client.cancelDeployment).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("cancels the deployment when the wallet rejects before anything is broadcast", async () => {
    const client = api();
    const wallet = deployer(() =>
      Promise.reject(
        new ChainLaunchError(
          "USER_REJECTED",
          TX_ERROR_MESSAGES.USER_REJECTED,
          false,
        ),
      ),
    );
    await expect(
      launchToken(
        { config, logo: new File(["png"], "logo.png"), deployer: wallet },
        client,
        () => undefined,
      ),
    ).rejects.toMatchObject({
      message: TX_ERROR_MESSAGES.USER_REJECTED,
    });
    expect(client.cancelDeployment).toHaveBeenCalledWith(deployment().id, {
      errorCode: "USER_REJECTED",
    });
    expect(client.recordSubmission).not.toHaveBeenCalled();
  });

  it("leaves the deployment open when the transaction may already have been sent", async () => {
    const client = api();
    const wallet = deployer(() =>
      Promise.reject(
        new ChainLaunchError(
          "RPC_FAILURE",
          TX_ERROR_MESSAGES.RPC_FAILURE,
          true,
        ),
      ),
    );
    await expect(
      launchToken(
        { config, logo: new File(["png"], "logo.png"), deployer: wallet },
        client,
        () => undefined,
      ),
    ).rejects.toMatchObject({
      message: TX_ERROR_MESSAGES.RPC_FAILURE,
    });
    expect(client.cancelDeployment).not.toHaveBeenCalled();
    expect(client.recordSubmission).not.toHaveBeenCalled();
  });

  it("does not ask the wallet to sign a launch that is already verified", async () => {
    const client = api({
      createDeployment: vi
        .fn()
        .mockResolvedValue(
          deployment({ status: "completed", tokenAddress: MINT }),
        ),
    });
    const wallet = deployer();
    const result = await launchToken(
      { config, logo: new File(["png"], "logo.png"), deployer: wallet },
      client,
      () => undefined,
    );
    expect(result.status).toBe("completed");
    expect(wallet.submit).not.toHaveBeenCalled();
  });
});
