import { type Address, getAddress } from "viem";
import { LAUNCHPAD_TOKEN_ABI } from "./generated/launchpad-token.js";

/**
 * Contract-call descriptors for management operations. They are plain data
 * accepted by viem `simulateContract`/`writeContract` and the wagmi hooks, so
 * the web app and CLI scripts share one definition of every call.
 */
const call = <const F extends string, const A extends readonly unknown[]>(token: string, functionName: F, args: A) =>
  ({ address: getAddress(token), abi: LAUNCHPAD_TOKEN_ABI, functionName, args }) as const;

export const bscTokenActions = {
  mint: (token: string, to: Address, amount: bigint) => call(token, "mint", [getAddress(to), amount]),
  transfer: (token: string, to: Address, amount: bigint) => call(token, "transfer", [getAddress(to), amount]),
  burn: (token: string, amount: bigint) => call(token, "burn", [amount]),
  approve: (token: string, spender: Address, amount: bigint) => call(token, "approve", [getAddress(spender), amount]),
  revokeApproval: (token: string, spender: Address) => call(token, "approve", [getAddress(spender), 0n]),
  disableMinting: (token: string) => call(token, "disableMinting", []),
  transferOwnership: (token: string, newOwner: Address) => call(token, "transferOwnership", [getAddress(newOwner)]),
  acceptOwnership: (token: string) => call(token, "acceptOwnership", []),
  renounceOwnership: (token: string) => call(token, "renounceOwnership", []),
};
