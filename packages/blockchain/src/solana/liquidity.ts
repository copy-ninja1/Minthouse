import {
  CREATE_CPMM_POOL_FEE_ACC,
  CREATE_CPMM_POOL_PROGRAM,
  CurveCalculator,
  DEVNET_PROGRAM_ID,
  FeeOn,
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
  poolTxId: string;
  swapTxId: string | null;
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

async function loadRaydium(
  connection: Connection,
  signer: SolanaLiquiditySigner,
  accounts: {
    tokenAccounts: TokenAccount[];
    tokenAccountRawInfos: TokenAccountRaw[];
  },
  cluster: "mainnet" | "devnet",
): Promise<Raydium> {
  return Raydium.load({
    connection,
    owner: signer.publicKey,
    cluster,
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
    notSubscribeAccountChange: true,
    tokenAccounts: accounts.tokenAccounts,
    tokenAccountRawInfos: accounts.tokenAccountRawInfos,
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
}

/**
 * Creates a Raydium CPMM pool, then optionally buys with SOL so indexers see a
 * first trade (DexScreener / Trust Wallet price + chart).
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
  const buyLamports = parseTokenAmount(config.initialBuySol, SOL_DECIMALS);
  // Pool SOL + first swap + rent for pool accounts / WSOL ATA + priority fees.
  const rentAndFeesBuffer = 25_000_000n; // 0.025 SOL
  const requiredLamports = nativeAmount + buyLamports + rentAndFeesBuffer;
  const balance = BigInt(
    await connection.getBalance(signer.publicKey, "confirmed"),
  );
  if (balance < requiredLamports) {
    const have = Number(balance) / 10 ** SOL_DECIMALS;
    const need = Number(requiredLamports) / 10 ** SOL_DECIMALS;
    throw new Error(
      `Transfer: insufficient lamports ${balance.toString()}, need ${requiredLamports.toString()} (wallet has ~${have.toFixed(4)} SOL, need ~${need.toFixed(4)} SOL for pool liquidity, initial buy, and fees)`,
    );
  }
  const cluster = raydiumCluster(config.network);
  const accounts = await loadMintTokenAccount(connection, signer.publicKey, mint);
  const raydium = await loadRaydium(connection, signer, accounts, cluster);

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

  const created = await raydium.cpmm.createPool({
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

  const { txId: poolTxId } = await created.execute({ sendAndConfirm: true });
  const poolId = created.extInfo.address.poolId.toBase58();

  if (buyLamports === 0n) {
    return { poolTxId, swapTxId: null, poolId };
  }

  // Refresh wallet token accounts after the pool pulled liquidity.
  const afterPool = await loadMintTokenAccount(connection, signer.publicKey, mint);
  raydium.account.updateTokenAccount(afterPool);

  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId);
  const wsol = WSOLMint.toBase58();
  const baseIn = poolInfo.mintA.address === wsol;
  if (!baseIn && poolInfo.mintB.address !== wsol) {
    throw new Error("Created pool is not paired with SOL");
  }
  if (!rpcData.configInfo) {
    throw new Error("Pool config was missing after creation");
  }

  const amountIn = new BN(buyLamports.toString());
  const swapResult = CurveCalculator.swapBaseInput(
    amountIn,
    baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
    baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
    rpcData.configInfo.tradeFeeRate,
    rpcData.configInfo.creatorFeeRate,
    rpcData.configInfo.protocolFeeRate,
    rpcData.configInfo.fundFeeRate,
    rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB,
  );

  const slippage = Math.min(Math.max(config.slippageBps / 10_000, 0.001), 0.5);
  const swapped = await raydium.cpmm.swap({
    poolInfo,
    poolKeys,
    inputAmount: amountIn,
    swapResult,
    slippage,
    baseIn,
    txVersion: TxVersion.V0,
    computeBudgetConfig: {
      units: 400_000,
      microLamports: 100_000,
    },
  });
  const { txId: swapTxId } = await swapped.execute({ sendAndConfirm: true });

  return { poolTxId, swapTxId, poolId };
}
