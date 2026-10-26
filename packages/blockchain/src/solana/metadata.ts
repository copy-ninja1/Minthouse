import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  getCreateMetadataAccountV3InstructionDataSerializer,
  getMetadataAccountDataSerializer,
} from "@metaplex-foundation/mpl-token-metadata";
import { getTokenMetadata, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Buffer } from "buffer";
import { type Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);

export function findMetadataAddress(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  )[0];
}

export type CreateMetadataParams = {
  mint: PublicKey;
  mintAuthority: PublicKey;
  payer: PublicKey;
  updateAuthority: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  isMutable: boolean;
};

/**
 * Metaplex `CreateMetadataAccountV3`, built from the official serializer with
 * the account order of the generated client (optional rent account omitted).
 * No creators, royalties, collection or uses are set: this is a fungible token.
 */
export function createMetadataInstruction(params: CreateMetadataParams): TransactionInstruction {
  const data = getCreateMetadataAccountV3InstructionDataSerializer().serialize({
    data: {
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
    },
    isMutable: params.isMutable,
    collectionDetails: null,
  });
  const updateAuthorityIsSigner =
    params.updateAuthority.equals(params.payer) || params.updateAuthority.equals(params.mintAuthority);
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: findMetadataAddress(params.mint), isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.mintAuthority, isSigner: true, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.updateAuthority, isSigner: updateAuthorityIsSigner, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export type OnchainMetadata = {
  source: "metaplex" | "token-2022";
  name: string;
  symbol: string;
  uri: string;
  updateAuthority: string | null;
  isMutable: boolean | null;
};

/** Metaplex pads fixed-length strings with NUL bytes. */
function unpad(value: string): string {
  return value.replace(/\0+$/, "").trim();
}

export function decodeMetaplexMetadata(data: Uint8Array): OnchainMetadata & { mint: string } {
  const [decoded] = getMetadataAccountDataSerializer().deserialize(data);
  return {
    source: "metaplex",
    mint: decoded.mint.toString(),
    name: unpad(decoded.name),
    symbol: unpad(decoded.symbol),
    uri: unpad(decoded.uri),
    updateAuthority: decoded.updateAuthority.toString(),
    isMutable: decoded.isMutable,
  };
}

/**
 * Reads token metadata from wherever the token program stores it: the
 * Token-2022 metadata extension, or the Metaplex metadata account.
 */
export async function readOnchainMetadata(
  connection: Connection,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<OnchainMetadata | null> {
  if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    const extension = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null);
    if (extension) {
      return {
        source: "token-2022",
        name: extension.name,
        symbol: extension.symbol,
        uri: extension.uri,
        updateAuthority: extension.updateAuthority?.toBase58() ?? null,
        isMutable: extension.updateAuthority ? !extension.updateAuthority.equals(PublicKey.default) : false,
      };
    }
  }
  const account = await connection.getAccountInfo(findMetadataAddress(mint), "confirmed");
  if (!account?.owner.equals(TOKEN_METADATA_PROGRAM_ID)) {
    return null;
  }
  const decoded = decodeMetaplexMetadata(account.data);
  if (decoded.mint !== mint.toBase58()) {
    return null;
  }
  return decoded;
}
