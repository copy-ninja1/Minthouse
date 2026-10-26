import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenAccountNotFoundError, getAccount, unpackMint } from "@solana/spl-token";
import { type Connection, PublicKey } from "@solana/web3.js";
import { type OnchainMetadata, readOnchainMetadata } from "./metadata.js";
import { associatedTokenAddress } from "./spl.js";

export type SolanaMintState = {
  address: string;
  tokenProgram: "spl-token" | "token-2022";
  tokenProgramId: PublicKey;
  decimals: number;
  supply: bigint;
  /** null means minting is permanently disabled. */
  mintAuthority: string | null;
  freezeAuthority: string | null;
  metadata: OnchainMetadata | null;
};

export class NotAMintError extends Error {
  override readonly name = "NotAMintError";
}

/** Reads a mint and its metadata directly from the chain. Supports SPL Token and Token-2022 mints. */
export async function readMintState(connection: Connection, mintAddress: string): Promise<SolanaMintState> {
  const mint = new PublicKey(mintAddress);
  const account = await connection.getAccountInfo(mint, "confirmed");
  if (!account) {
    throw new NotAMintError(`No account exists at ${mintAddress} on this cluster`);
  }
  const isLegacy = account.owner.equals(TOKEN_PROGRAM_ID);
  if (!isLegacy && !account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new NotAMintError(`${mintAddress} is not owned by a token program`);
  }
  let decoded;
  try {
    decoded = unpackMint(mint, account, account.owner);
  } catch {
    throw new NotAMintError(`${mintAddress} is a token account, not a mint`);
  }
  const metadata = await readOnchainMetadata(connection, mint, account.owner);
  return {
    address: mint.toBase58(),
    tokenProgram: isLegacy ? "spl-token" : "token-2022",
    tokenProgramId: account.owner,
    decimals: decoded.decimals,
    supply: decoded.supply,
    mintAuthority: decoded.mintAuthority?.toBase58() ?? null,
    freezeAuthority: decoded.freezeAuthority?.toBase58() ?? null,
    metadata,
  };
}

/** Balance of `owner`'s associated token account; zero when the account does not exist yet. */
export async function readTokenBalance(
  connection: Connection,
  params: { mint: PublicKey; owner: PublicKey; tokenProgram: PublicKey },
): Promise<bigint> {
  const address = associatedTokenAddress(params.mint, params.owner, params.tokenProgram);
  try {
    const account = await getAccount(connection, address, "confirmed", params.tokenProgram);
    return account.amount;
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      return 0n;
    }
    throw error;
  }
}
