import {
  CREATE_CPMM_POOL_FEE_ACC,
  CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID,
  Raydium,
  type TokenAccount,
  type TokenAccountRaw,
  TxVersion,
  WSOLMint,
  getCpmmPdaAmmConfigId,
} from "@raydium-io/raydium-sdk-v2";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  type Connection,
  type PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  SOL_DECIMALS,
  type NetworkId,
  type SplTokenConfig,
  getNetwork,
  parseTokenAmount,
  wholeTokensToBaseUnits,
} from "@minthouse/shared";

export type SolanaLiquiditySigner = {
  publicKey: PublicKey;
  signTransaction: (
    transaction: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
};

export type SeedSplLiquidityResult = {
  txId: string;
  poolId: string;
};

/** True when the config asks for a pool and the cluster has Raydium CPMM. */
export function shouldSeedSplLiquidity(config: SplTokenConfig): boolean {
  const network = getNetwork(config.network);
  if (network.family !== "solana" || network.isLocal) {
    return false;
  }
  const native = parseTokenAmount(config.liquidityNative, SOL_DECIMALS);
  const tokens = BigInt(config.liquidityTokens);
  return native > 0n && tokens > 0n;
}

function raydiumCluster(network: NetworkId): "mainnet" | "devnet" {
  const net = getNetwork(network);
  if (net.family !== "solana") {
    throw new Error(`${network} is not a Solana network`);
  }
  switch (net.cluster) {
    case "mainnet-beta":
      return "mainnet";
    case "devnet":
      return "devnet";
    case "localnet":
      throw new Error("Raydium CPMM is not available on localnet");
    default: {
      const exhaustive: never = net.cluster;
      throw new Error(`Unhandled Solana cluster ${String(exhaustive)}`);
    }
  }
}

/**
 * Loads the signer's ATA for `mint` via getAccountInfo (not an indexed RPC).
 * Passing this into Raydium avoids getTokenAccountsByOwner, which many free
 * public endpoints (e.g. PublicNode) block.
 */
async function loadMintTokenAccount(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{
  tokenAccounts: TokenAccount[];
  tokenAccountRawInfos: TokenAccountRaw[];
}> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (!info) {
    throw new Error(
      "The signing account's token account was not found. Set the recipient to your own address so the pool can pull tokens.",
    );
  }
  const decoded = AccountLayout.decode(info.data);
  const amount = new BN(decoded.amount.toString());
  if (amount.isZero()) {
    throw new Error("The signing account holds zero tokens for this mint.");
  }
  const accountInfo = {
    mint: decoded.mint,
    owner: decoded.owner,
    amount,
    delegateOption: decoded.delegateOption,
    delegate: decoded.delegate,
    state: decoded.state,
    isNativeOption: decoded.isNativeOption,
    isNative: new BN(decoded.isNative.toString()),
    delegatedAmount: new BN(decoded.delegatedAmount.toString()),
    closeAuthorityOption: decoded.closeAuthorityOption,
    closeAuthority: decoded.closeAuthority,
  } as TokenAccountRaw["accountInfo"];
  return {
    tokenAccounts: [
      {
        publicKey: ata,
        mint,
        isAssociated: true,
        amount,
        isNative: false,
        programId: TOKEN_PROGRAM_ID,
      },
    ],
    tokenAccountRawInfos: [
      {
        programId: TOKEN_PROGRAM_ID,
        pubkey: ata,
        accountInfo,
      },
    ],
  };
}

/**
 * Creates a Raydium CPMM pool pairing the new mint with SOL.
 * Call after the mint transaction has confirmed and the signer holds the
 * liquidity token amount (recipient must be the signing account).
 */
export async function seedSplLiquidity(
  connection: Connection,
  signer: SolanaLiquiditySigner,
  params: { mint: PublicKey; config: SplTokenConfig },
): Promise<SeedSplLiquidityResult> {
  const { mint, config } = params;
  if (!shouldSeedSplLiquidity(config)) {
    throw new Error("Liquidity amounts are zero or the network has no Raydium CPMM");
  }
  if (config.recipient !== signer.publicKey.toBase58()) {
    throw new Error(
      "Liquidity seeding requires the recipient to be the signing account so the pool can pull tokens.",
    );
  }

  const tokenAmount = wholeTokensToBaseUnits(config.liquidityTokens, config.decimals);
  const nativeAmount = parseTokenAmount(config.liquidityNative, SOL_DECIMALS);
  const cluster = raydiumCluster(config.network);
  const { tokenAccounts, tokenAccountRawInfos } = await loadMintTokenAccount(
    connection,
    signer.publicKey,
    mint,
  );

  const raydium = await Raydium.load({
    connection,
    owner: signer.publicKey,
    cluster,
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
    notSubscribeAccountChange: true,
    tokenAccounts,
    tokenAccountRawInfos,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> => {
      const signed: T[] = [];
      for (const tx of txs) {
        if (tx instanceof Transaction) {
          throw new Error("Legacy Solana transactions are not supported for Raydium pool creation");
        }
        signed.push((await signer.signTransaction(tx)) as T);
      }
      return signed;
    },
  });

  const feeConfigs = await raydium.api.getCpmmConfigs();
  const feeConfig = feeConfigs.find((entry) => entry.index === 0) ?? feeConfigs[0];
  if (!feeConfig) {
    throw new Error("Raydium returned no CPMM fee configs");
  }
  if (cluster === "devnet") {
    feeConfig.id = getCpmmPdaAmmConfigId(
      DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      feeConfig.index,
    ).publicKey.toBase58();
  }

  // Prefer API metadata for WSOL; on-chain read for the brand-new mint.
  const mintA = await raydium.token.getTokenInfo(WSOLMint);
  const mintB = await raydium.token.getTokenInfo(mint);

  const programId =
    cluster === "devnet"
      ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
      : CREATE_CPMM_POOL_PROGRAM;
  const poolFeeAccount =
    cluster === "devnet"
      ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
      : CREATE_CPMM_POOL_FEE_ACC;

  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId,
    poolFeeAccount,
    mintA,
    mintB,
    mintAAmount: new BN(nativeAmount.toString()),
    mintBAmount: new BN(tokenAmount.toString()),
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
    computeBudgetConfig: {
      units: 600_000,
      microLamports: 100_000,
    },
  });

  const { txId } = await execute({ sendAndConfirm: true });
  return {
    txId,
    poolId: extInfo.address.poolId.toBase58(),
  };
}
