import {
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
  BaseError,
  ContractFunctionExecutionError,
  TransactionReceiptNotFoundError,
  decodeEventLog,
  getAddress,
  keccak256,
  zeroAddress,
} from "viem";
import { type BscTokenConfig, type TxErrorCode, wholeTokensToBaseUnits } from "@minthouse/shared";
import {
  LAUNCHPAD_TOKEN_ABI,
  LAUNCHPAD_TOKEN_BYTECODE,
  LAUNCHPAD_TOKEN_RUNTIME_CODE_HASH,
} from "./generated/launchpad-token.js";

/** Minimal read surface needed here; satisfied by viem and wagmi public clients. */
export type BscReader = Pick<PublicClient, "readContract" | "getCode" | "getTransactionReceipt">;

export type LaunchpadDeployArgs = readonly [string, string, number, bigint, Address, boolean];

/** Converts a validated config into constructor arguments. Supply is converted from whole tokens here, once. */
export function launchpadDeployArgs(config: BscTokenConfig): LaunchpadDeployArgs {
  return [
    config.name,
    config.symbol,
    config.decimals,
    wholeTokensToBaseUnits(config.initialSupply, config.decimals),
    getAddress(config.recipient),
    config.mintingEnabled,
  ];
}

/** Parameters for viem `deployContract` / wagmi `useDeployContract`. */
export function buildLaunchpadDeployment(config: BscTokenConfig) {
  return {
    abi: LAUNCHPAD_TOKEN_ABI,
    bytecode: LAUNCHPAD_TOKEN_BYTECODE,
    args: launchpadDeployArgs(config),
  } as const;
}

export type Erc20State = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  /** True when the runtime bytecode is exactly the Minthouse LaunchpadToken template. */
  isLaunchpadToken: boolean;
  owner: Address | null;
  pendingOwner: Address | null;
  mintingEnabled: boolean | null;
};

async function optionalRead<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ContractFunctionExecutionError) {
      return null;
    }
    throw error;
  }
}

export class NotAContractError extends Error {
  override readonly name = "NotAContractError";
}

export async function isLaunchpadTokenCode(client: BscReader, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return code !== undefined && code !== "0x" && keccak256(code) === LAUNCHPAD_TOKEN_RUNTIME_CODE_HASH;
}

/**
 * Reads ERC-20 state directly from the chain. Works for any ERC-20; the
 * ownership and minting fields are only populated for LaunchpadToken contracts.
 */
export async function readErc20State(client: BscReader, tokenAddress: string): Promise<Erc20State> {
  const address = getAddress(tokenAddress);
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new NotAContractError(`No contract is deployed at ${address} on this network`);
  }
  const isLaunchpadToken = keccak256(code) === LAUNCHPAD_TOKEN_RUNTIME_CODE_HASH;
  const contract = { address, abi: LAUNCHPAD_TOKEN_ABI } as const;

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ ...contract, functionName: "name" }),
    client.readContract({ ...contract, functionName: "symbol" }),
    client.readContract({ ...contract, functionName: "decimals" }),
    client.readContract({ ...contract, functionName: "totalSupply" }),
  ]);

  if (!isLaunchpadToken) {
    return { address, name, symbol, decimals, totalSupply, isLaunchpadToken, owner: null, pendingOwner: null, mintingEnabled: null };
  }

  const [owner, pendingOwner, mintingEnabled] = await Promise.all([
    optionalRead(() => client.readContract({ ...contract, functionName: "owner" })),
    optionalRead(() => client.readContract({ ...contract, functionName: "pendingOwner" })),
    optionalRead(() => client.readContract({ ...contract, functionName: "mintingEnabled" })),
  ]);
  return { address, name, symbol, decimals, totalSupply, isLaunchpadToken, owner, pendingOwner, mintingEnabled };
}

export async function readErc20Balance(client: BscReader, tokenAddress: string, account: string): Promise<bigint> {
  return client.readContract({
    address: getAddress(tokenAddress),
    abi: LAUNCHPAD_TOKEN_ABI,
    functionName: "balanceOf",
    args: [getAddress(account)],
  });
}

export async function readErc20Allowance(client: BscReader, tokenAddress: string, owner: string, spender: string): Promise<bigint> {
  return client.readContract({
    address: getAddress(tokenAddress),
    abi: LAUNCHPAD_TOKEN_ABI,
    functionName: "allowance",
    args: [getAddress(owner), getAddress(spender)],
  });
}

export type BscDeploymentCheck =
  | { status: "pending" }
  | { status: "failed"; code: TxErrorCode; reason: string }
  | { status: "verified"; tokenAddress: Address; blockNumber: bigint; details: Record<string, string> }
  | { status: "mismatch"; tokenAddress: Address | null; reason: string; details: Record<string, string> };

type DeploymentEvents = {
  minted: { to: Address; value: bigint }[];
  ownerSetTo: Address | null;
  mintingDisabled: boolean;
};

function decodeDeploymentEvents(receipt: TransactionReceipt, tokenAddress: Address): DeploymentEvents {
  const events: DeploymentEvents = { minted: [], ownerSetTo: null, mintingDisabled: false };
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== tokenAddress) {
      continue;
    }
    let decoded;
    try {
      decoded = decodeEventLog({ abi: LAUNCHPAD_TOKEN_ABI, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    switch (decoded.eventName) {
      case "Transfer":
        if (decoded.args.from === zeroAddress) {
          events.minted.push({ to: decoded.args.to, value: decoded.args.value });
        }
        break;
      case "OwnershipTransferred":
        events.ownerSetTo = decoded.args.newOwner;
        break;
      case "MintingDisabled":
        events.mintingDisabled = true;
        break;
      case "Approval":
      case "OwnershipTransferStarted":
        break;
      default: {
        const exhaustive: never = decoded;
        throw new Error(`Unhandled event ${String(exhaustive)}`);
      }
    }
  }
  return events;
}

/**
 * Proves a deployment transaction created the requested token.
 *
 * Checks, all against chain data rather than application records:
 * receipt success, sender, runtime bytecode identity, immutable token fields,
 * and the initial issuance / ownership / minting policy recorded in the
 * deployment receipt's own event logs (so later transfers cannot confuse it).
 */
export async function verifyBscDeployment(
  client: BscReader,
  params: { txHash: Hash; creator: string; expected: BscTokenConfig },
): Promise<BscDeploymentCheck> {
  let receipt: TransactionReceipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: params.txHash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      return { status: "pending" };
    }
    throw error;
  }

  if (receipt.status !== "success") {
    return { status: "failed", code: "REVERTED", reason: "The deployment transaction reverted on-chain." };
  }
  if (!receipt.contractAddress) {
    return { status: "mismatch", tokenAddress: null, reason: "The transaction did not create a contract.", details: {} };
  }

  const tokenAddress = getAddress(receipt.contractAddress);
  const expectedArgs = launchpadDeployArgs(params.expected);
  const [, , , expectedSupply, expectedRecipient, expectedMinting] = expectedArgs;
  const details: Record<string, string> = {
    tokenAddress,
    blockNumber: receipt.blockNumber.toString(),
    deployer: getAddress(receipt.from),
  };
  const fail = (reason: string): BscDeploymentCheck => ({ status: "mismatch", tokenAddress, reason, details });

  if (getAddress(receipt.from) !== getAddress(params.creator)) {
    return fail("The transaction was sent by a different account than the recorded creator.");
  }
  if (!(await isLaunchpadTokenCode(client, tokenAddress))) {
    return fail("The deployed bytecode does not match the LaunchpadToken template.");
  }
  details.bytecode = "matches LaunchpadToken template";

  const state = await readErc20State(client, tokenAddress);
  details.name = state.name;
  details.symbol = state.symbol;
  details.decimals = String(state.decimals);
  if (state.name !== params.expected.name || state.symbol !== params.expected.symbol || state.decimals !== params.expected.decimals) {
    return fail("Name, symbol or decimals on-chain differ from the requested configuration.");
  }

  const events = decodeDeploymentEvents(receipt, tokenAddress);
  const issued = events.minted.reduce((sum, mint) => sum + mint.value, 0n);
  details.initialSupplyBaseUnits = issued.toString();
  if (issued !== expectedSupply) {
    return fail("Initial issuance differs from the requested supply.");
  }
  if (expectedSupply > 0n && !events.minted.every((mint) => mint.to === expectedRecipient)) {
    return fail("Initial supply was issued to an unexpected recipient.");
  }
  details.initialRecipient = expectedSupply > 0n ? expectedRecipient : "none";
  if (events.ownerSetTo !== getAddress(params.creator)) {
    return fail("Initial owner is not the creator.");
  }
  details.initialOwner = events.ownerSetTo;
  if (events.mintingDisabled === expectedMinting) {
    return fail("Minting policy differs from the requested configuration.");
  }
  details.mintingAtDeployment = expectedMinting ? "enabled" : "permanently disabled";

  return { status: "verified", tokenAddress, blockNumber: receipt.blockNumber, details };
}

export type EvmTxState =
  | { state: "success"; blockNumber: bigint; contractAddress: Address | null }
  | { state: "reverted"; blockNumber: bigint }
  | { state: "pending" }
  /** Another transaction consumed this nonce: the original can never execute. */
  | { state: "replaced" }
  /** Not visible anywhere and nonce not yet consumed: outcome still uncertain. */
  | { state: "unknown" };

/**
 * Determines what happened to a transaction after an interruption (refresh,
 * timeout). Never assumes failure from absence alone: absence only becomes
 * definitive once the sender's nonce has moved past the recorded nonce.
 */
export async function reconcileEvmTransaction(
  client: Pick<PublicClient, "getTransactionReceipt" | "getTransaction" | "getTransactionCount">,
  params: { hash: Hash; from: Address; nonce?: number },
): Promise<EvmTxState> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: params.hash });
    return receipt.status === "success"
      ? { state: "success", blockNumber: receipt.blockNumber, contractAddress: receipt.contractAddress ?? null }
      : { state: "reverted", blockNumber: receipt.blockNumber };
  } catch (error) {
    if (!(error instanceof BaseError) || !error.walk((inner) => inner instanceof TransactionReceiptNotFoundError)) {
      throw error;
    }
  }

  try {
    await client.getTransaction({ hash: params.hash });
    return { state: "pending" };
  } catch (error) {
    if (!(error instanceof BaseError) || error.name !== "TransactionNotFoundError") {
      throw error;
    }
  }

  if (params.nonce !== undefined) {
    const confirmedNonce = await client.getTransactionCount({ address: params.from, blockTag: "latest" });
    if (confirmedNonce > params.nonce) {
      return { state: "replaced" };
    }
  }
  return { state: "unknown" };
}
