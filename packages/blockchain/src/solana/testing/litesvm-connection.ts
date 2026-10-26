/**
 * Test-only bridge that exposes the subset of `@solana/web3.js` `Connection`
 * used by this package, backed by an in-process LiteSVM instance. Programs
 * execute for real (SPL Token, ATA, and any loaded program binaries); only the
 * RPC transport is replaced.
 */
import { readFile } from "node:fs/promises";
import { AccountLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import {
  type AccountInfo,
  type Commitment,
  type Connection,
  type Keypair,
  PublicKey,
  type SignatureStatus,
  type TokenBalance,
  type VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { address, getTransactionDecoder, lamports, type Transaction } from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import bs58 from "bs58";

type StoredTransaction = {
  slot: number;
  message: VersionedMessage;
  signatures: string[];
  err: unknown;
  logs: string[];
  postTokenBalances: TokenBalance[];
};

const decoder = getTransactionDecoder();

function toKitTransaction(tx: VersionedTransaction | Uint8Array): Transaction {
  const bytes = tx instanceof VersionedTransaction ? tx.serialize() : tx;
  return decoder.decode(bytes);
}

type RpcTransactionError =
  | string
  | { InstructionError: [number, string | { Custom: number }] }
  | { InsufficientFundsForRent: { account_index: number } };

/**
 * Converts a LiteSVM failure into the JSON shape RPC nodes return. LiteSVM's
 * error classes are not exported at runtime, but its Rust debug text uses the
 * same variant names as the RPC JSON.
 */
export function toRpcError(result: FailedTransactionMetadata): RpcTransactionError {
  const debug = /err: (.*?), meta: TransactionMetadata/s.exec(result.toString())?.[1] ?? result.toString();
  const custom = /^InstructionError\((\d+), Custom\((\d+)\)\)$/.exec(debug);
  if (custom) {
    return { InstructionError: [Number(custom[1]), { Custom: Number(custom[2]) }] };
  }
  const instruction = /^InstructionError\((\d+), (\w+)\)$/.exec(debug);
  if (instruction) {
    return { InstructionError: [Number(instruction[1]), instruction[2] ?? "Unknown"] };
  }
  const rent = /^InsufficientFundsForRent \{ account_index: (\d+) \}$/.exec(debug);
  if (rent) {
    return { InsufficientFundsForRent: { account_index: Number(rent[1]) } };
  }
  return debug;
}

export class LiteSvmConnection {
  readonly svm: LiteSVM;
  private readonly history = new Map<string, StoredTransaction>();

  constructor(svm = new LiteSVM()) {
    this.svm = svm;
  }

  async loadProgram(programId: PublicKey, soPath: string): Promise<void> {
    this.svm.addProgram(address(programId.toBase58()), await readFile(soPath));
  }

  airdrop(to: PublicKey, amount: bigint): void {
    const result = this.svm.airdrop(address(to.toBase58()), lamports(amount));
    if (!result || result instanceof FailedTransactionMetadata) {
      throw new Error("Airdrop failed");
    }
  }

  setAccount(pubkey: PublicKey, account: { lamports: bigint; owner: PublicKey; data: Uint8Array; executable?: boolean }): void {
    this.svm.setAccount({
      address: address(pubkey.toBase58()),
      lamports: lamports(account.lamports),
      programAddress: address(account.owner.toBase58()),
      data: account.data,
      executable: account.executable ?? false,
      space: BigInt(account.data.length),
    });
  }

  /** Narrow cast used only in tests: this class implements every Connection method the package calls. */
  asConnection(): Connection {
    return this as unknown as Connection;
  }

  getAccountInfo(pubkey: PublicKey, _commitment?: Commitment): Promise<AccountInfo<Buffer> | null> {
    const account = this.svm.getAccount(address(pubkey.toBase58()));
    if (!account.exists) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      data: Buffer.from(account.data),
      executable: account.executable,
      lamports: Number(account.lamports),
      owner: new PublicKey(account.programAddress),
      rentEpoch: 0,
    });
  }

  async getMultipleAccountsInfo(pubkeys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
    return Promise.all(pubkeys.map((key) => this.getAccountInfo(key)));
  }

  getBalance(pubkey: PublicKey): Promise<number> {
    return Promise.resolve(Number(this.svm.getBalance(address(pubkey.toBase58())) ?? 0n));
  }

  getMinimumBalanceForRentExemption(size: number): Promise<number> {
    return Promise.resolve(Number(this.svm.minimumBalanceForRentExemption(BigInt(size))));
  }

  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return Promise.resolve({ blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: this.currentSlot() + 150 });
  }

  getBlockHeight(): Promise<number> {
    return Promise.resolve(this.currentSlot());
  }

  getRecentPrioritizationFees(): Promise<{ slot: number; prioritizationFee: number }[]> {
    return Promise.resolve([]);
  }

  getFeeForMessage(message: VersionedMessage): Promise<{ value: number }> {
    return Promise.resolve({ value: 5_000 * message.header.numRequiredSignatures });
  }

  simulateTransaction(
    tx: VersionedTransaction,
    options?: { accounts?: { addresses: string[] } },
  ): Promise<{ value: { err: unknown; logs: string[]; unitsConsumed: number; accounts: ({ lamports: number } | null)[] } }> {
    this.svm.withSigverify(false);
    try {
      const result = this.svm.simulateTransaction(toKitTransaction(tx));
      if (result instanceof FailedTransactionMetadata) {
        return Promise.resolve({
          value: { err: toRpcError(result), logs: result.meta().logs(), unitsConsumed: 0, accounts: [] },
        });
      }
      const post = result.postAccounts();
      const accounts = (options?.accounts?.addresses ?? []).map((wanted) => {
        const found = post.find((account) => account.address === wanted);
        if (found) {
          return { lamports: Number(found.lamports) };
        }
        const current = this.svm.getBalance(address(wanted));
        return current === null ? null : { lamports: Number(current) };
      });
      return Promise.resolve({
        value: {
          err: null,
          logs: result.meta().logs(),
          unitsConsumed: Number(result.meta().computeUnitsConsumed()),
          accounts,
        },
      });
    } finally {
      this.svm.withSigverify(true);
    }
  }

  sendRawTransaction(raw: Uint8Array): Promise<string> {
    const tx = VersionedTransaction.deserialize(raw);
    const signature = bs58.encode(tx.signatures[0] ?? new Uint8Array(64));
    const result = this.svm.sendTransaction(toKitTransaction(raw));
    const failed = result instanceof FailedTransactionMetadata;
    const meta = failed ? result.meta() : result;
    this.history.set(signature, {
      slot: this.currentSlot(),
      message: tx.message,
      signatures: tx.signatures.map((sig) => bs58.encode(sig)),
      err: failed ? toRpcError(result) : null,
      logs: meta.logs(),
      postTokenBalances: failed ? [] : this.tokenBalancesFor(tx.message),
    });
    this.svm.expireBlockhash();
    return Promise.resolve(signature);
  }

  /** Signs with local test keypairs and sends. Stands in for a wallet in tests. */
  async signAndSend(tx: VersionedTransaction, signers: Keypair[]): Promise<string> {
    tx.sign(signers);
    return this.sendRawTransaction(tx.serialize());
  }

  logsFor(signature: string): string[] {
    return this.history.get(signature)?.logs ?? [];
  }

  getSignatureStatuses(signatures: string[]): Promise<{ value: (SignatureStatus | null)[] }> {
    return Promise.resolve({
      value: signatures.map((signature) => {
        const stored = this.history.get(signature);
        if (!stored) {
          return null;
        }
        return {
          slot: stored.slot,
          confirmations: null,
          err: stored.err as SignatureStatus["err"],
          confirmationStatus: "finalized",
        };
      }),
    });
  }

  getTransaction(signature: string) {
    const stored = this.history.get(signature);
    if (!stored) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      slot: stored.slot,
      blockTime: null,
      transaction: { message: stored.message, signatures: stored.signatures },
      meta: {
        err: stored.err,
        fee: 5_000,
        logMessages: stored.logs,
        preBalances: [],
        postBalances: [],
        preTokenBalances: [],
        postTokenBalances: stored.postTokenBalances,
        loadedAddresses: { writable: [], readonly: [] },
      },
    });
  }

  advanceSlots(count: number): void {
    this.svm.warpToSlot(BigInt(this.currentSlot() + count));
  }

  private currentSlot(): number {
    return Number(this.svm.getClock().slot);
  }

  private tokenBalancesFor(message: VersionedMessage): TokenBalance[] {
    const balances: TokenBalance[] = [];
    message.staticAccountKeys.forEach((key, accountIndex) => {
      const account = this.svm.getAccount(address(key.toBase58()));
      if (!account.exists || account.data.length < AccountLayout.span) {
        return;
      }
      const owner = new PublicKey(account.programAddress);
      if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) {
        return;
      }
      try {
        const info = { data: Buffer.from(account.data), executable: false, lamports: 0, owner, rentEpoch: 0 };
        const token = unpackAccount(key, info, owner);
        balances.push({
          accountIndex,
          mint: token.mint.toBase58(),
          owner: token.owner.toBase58(),
          programId: owner.toBase58(),
          uiTokenAmount: { amount: token.amount.toString(), decimals: 0, uiAmount: null },
        });
      } catch {
        // Not a token account (e.g. a mint with extensions); ignore.
      }
    });
    return balances;
  }
}
