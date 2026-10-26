import { type Abi, type ContractFunctionName, type Address } from "viem";
import { requireTypedConfirmation } from "@minthouse/config/cli";
import { classifyEvmError } from "@minthouse/blockchain/bsc";
import { type ScriptContext, explorerTx, requireWallet } from "./context.js";

type CallDescriptor = {
  address: Address;
  abi: Abi;
  functionName: ContractFunctionName;
  args: readonly unknown[];
};

export type ExecuteOptions = {
  title: string;
  summary: Record<string, string>;
  /** Irreversible actions require typed confirmation on every network. */
  irreversible?: { phrase: string; warning: string };
  /** Reads chain state after confirmation and returns a line describing the verified result. */
  verify: () => Promise<string>;
};

/**
 * Simulates, confirms (on mainnet or for irreversible actions), sends, waits
 * for confirmations, and verifies the resulting on-chain state.
 */
export async function executeTokenCall(context: ScriptContext, call: CallDescriptor, options: ExecuteOptions): Promise<void> {
  const { wallet, signer } = requireWallet(context);
  const summary = { Network: `${context.network.label} (chain ${context.chainId})`, Signer: signer, ...options.summary };

  let request;
  try {
    ({ request } = await context.publicClient.simulateContract({ ...call, account: wallet.account }));
  } catch (error) {
    const classified = classifyEvmError(error);
    throw new Error(`Simulation failed — nothing was sent. ${classified.message}`, { cause: error });
  }

  if (options.irreversible) {
    await requireTypedConfirmation({ title: options.title, summary, phrase: options.irreversible.phrase, warning: options.irreversible.warning });
  } else if (context.isMainnet) {
    await requireTypedConfirmation({
      title: options.title,
      summary,
      phrase: `${call.functionName} on ${context.network.id}`,
      warning: "This is a BNB Smart Chain MAINNET transaction and spends real BNB.",
    });
  } else {
    console.log(`\n${options.title}`);
    for (const [key, value] of Object.entries(summary)) {
      console.log(`  ${key.padEnd(22)} ${value}`);
    }
  }

  const hash = await wallet.writeContract(request);
  console.log(`\nSubmitted: ${explorerTx(context, hash)}`);
  const receipt = await context.publicClient.waitForTransactionReceipt({ hash, confirmations: context.confirmations });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted in block ${receipt.blockNumber}.`);
  }
  console.log(`Confirmed in block ${receipt.blockNumber}.`);
  console.log(`Verified on-chain: ${await options.verify()}`);
}
