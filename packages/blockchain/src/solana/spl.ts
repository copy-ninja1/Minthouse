import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { type Connection, Keypair, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { type SplTokenConfig, U64_MAX, wholeTokensToBaseUnits } from "@minthouse/shared";
import { createMetadataInstruction } from "./metadata.js";

export function associatedTokenAddress(mint: PublicKey, owner: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
}

function assertU64(amount: bigint): void {
  if (amount <= 0n || amount > U64_MAX) {
    throw new RangeError("Amount must be between 1 and the u64 maximum");
  }
}

export type CreateSplTokenPlan = {
  /** Freshly generated mint keypair. Its secret only co-signs the account creation and is then discarded. */
  mint: Keypair;
  instructions: TransactionInstruction[];
  /** Initial supply in base units. */
  initialSupply: bigint;
  recipientTokenAccount: PublicKey | null;
};

/**
 * Plans the single atomic transaction that creates a standard SPL token:
 * mint account → mint initialisation (no freeze authority) → Metaplex
 * metadata → recipient ATA → initial issuance → optional mint-authority
 * revocation. Either everything lands or nothing does.
 */
export async function planCreateSplToken(
  connection: Connection,
  params: { creator: PublicKey; config: SplTokenConfig; metadataUri: string; mint?: Keypair },
): Promise<CreateSplTokenPlan> {
  const { creator, config } = params;
  const mint = params.mint ?? Keypair.generate();
  const recipient = new PublicKey(config.recipient);
  const initialSupply = wholeTokensToBaseUnits(config.initialSupply, config.decimals);
  if (initialSupply > U64_MAX) {
    throw new RangeError("Initial supply exceeds the SPL Token u64 limit");
  }
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  const instructions: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: creator,
      newAccountPubkey: mint.publicKey,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, config.decimals, creator, null, TOKEN_PROGRAM_ID),
    createMetadataInstruction({
      mint: mint.publicKey,
      mintAuthority: creator,
      payer: creator,
      updateAuthority: creator,
      name: config.name,
      symbol: config.symbol,
      uri: params.metadataUri,
      isMutable: config.metadataMutable,
    }),
  ];

  let recipientTokenAccount: PublicKey | null = null;
  if (initialSupply > 0n) {
    recipientTokenAccount = associatedTokenAddress(mint.publicKey, recipient);
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(creator, recipientTokenAccount, recipient, mint.publicKey),
      createMintToCheckedInstruction(mint.publicKey, recipientTokenAccount, creator, initialSupply, config.decimals),
    );
  }
  if (config.mintAuthority === "revoke") {
    instructions.push(createSetAuthorityInstruction(mint.publicKey, creator, AuthorityType.MintTokens, null));
  }
  return { mint, instructions, initialSupply, recipientTokenAccount };
}

type MintRef = { mint: PublicKey; decimals: number; tokenProgram: PublicKey };

/** Mints `amount` base units to `recipient`, creating their token account if missing. */
export function mintToInstructions(
  ref: MintRef,
  params: { authority: PublicKey; payer: PublicKey; recipient: PublicKey; amount: bigint },
): TransactionInstruction[] {
  assertU64(params.amount);
  const destination = associatedTokenAddress(ref.mint, params.recipient, ref.tokenProgram);
  return [
    createAssociatedTokenAccountIdempotentInstruction(params.payer, destination, params.recipient, ref.mint, ref.tokenProgram),
    createMintToCheckedInstruction(ref.mint, destination, params.authority, params.amount, ref.decimals, [], ref.tokenProgram),
  ];
}

/** Transfers between owners' associated token accounts, creating the recipient's if missing. */
export function transferInstructions(
  ref: MintRef,
  params: { owner: PublicKey; recipient: PublicKey; amount: bigint },
): TransactionInstruction[] {
  assertU64(params.amount);
  const source = associatedTokenAddress(ref.mint, params.owner, ref.tokenProgram);
  const destination = associatedTokenAddress(ref.mint, params.recipient, ref.tokenProgram);
  return [
    createAssociatedTokenAccountIdempotentInstruction(params.owner, destination, params.recipient, ref.mint, ref.tokenProgram),
    createTransferCheckedInstruction(source, ref.mint, destination, params.owner, params.amount, ref.decimals, [], ref.tokenProgram),
  ];
}

export function burnInstructions(ref: MintRef, params: { owner: PublicKey; amount: bigint }): TransactionInstruction[] {
  assertU64(params.amount);
  const account = associatedTokenAddress(ref.mint, params.owner, ref.tokenProgram);
  return [createBurnCheckedInstruction(account, ref.mint, params.owner, params.amount, ref.decimals, [], ref.tokenProgram)];
}

/** Transfers mint authority to `newAuthority`, or permanently revokes it when `newAuthority` is null. */
export function setMintAuthorityInstructions(
  ref: Pick<MintRef, "mint" | "tokenProgram">,
  params: { currentAuthority: PublicKey; newAuthority: PublicKey | null },
): TransactionInstruction[] {
  return [
    createSetAuthorityInstruction(
      ref.mint,
      params.currentAuthority,
      AuthorityType.MintTokens,
      params.newAuthority,
      [],
      ref.tokenProgram,
    ),
  ];
}
