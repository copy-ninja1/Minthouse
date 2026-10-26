import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { ACCEPTED_LOGO_MIME_TYPES, type AcceptedLogoMimeType, MIN_LOGO_DIMENSION } from "@minthouse/shared";

export const STANDARD_LOGO_SIZE = 512;
/** Trust Wallet assets repository: 256×256 PNG, at most 100 kB. */
export const TRUST_WALLET_LOGO_SIZE = 256;
export const TRUST_WALLET_MAX_BYTES = 100 * 1024;
/** Decompression-bomb guard: refuse images above 64 megapixels before decoding. */
const MAX_INPUT_PIXELS = 8192 * 8192;

export class LogoRejectedError extends Error {
  override readonly name = "LogoRejectedError";
  constructor(
    message: string,
    readonly reason: "too-large" | "unsupported-type" | "too-small" | "corrupt",
  ) {
    super(message);
  }
}

export type ProcessedLogo = {
  /** SHA-256 of the uploaded bytes, used for de-duplication. */
  sha256: string;
  sourceType: AcceptedLogoMimeType;
  sourceWidth: number;
  sourceHeight: number;
  standard: Buffer;
  /** null when the image cannot meet Trust Wallet's size limit. */
  trustWallet: Buffer | null;
};

function isAcceptedType(mime: string): mime is AcceptedLogoMimeType {
  return (ACCEPTED_LOGO_MIME_TYPES as readonly string[]).includes(mime);
}

function squarePng(input: Buffer, size: number, palette: boolean): Promise<Buffer> {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette })
    .toBuffer();
}

/**
 * Validates an uploaded logo by its actual bytes (not the client's declared
 * type) and renders square PNG variants. Non-square images are letterboxed
 * on a transparent background rather than cropped.
 */
export async function processLogo(bytes: Buffer, maxBytes: number): Promise<ProcessedLogo> {
  if (bytes.length > maxBytes) {
    throw new LogoRejectedError(`The image is larger than ${Math.floor(maxBytes / 1024)} kB.`, "too-large");
  }
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !isAcceptedType(detected.mime)) {
    throw new LogoRejectedError("Upload a PNG, JPEG or WebP image. SVG and other formats are not accepted.", "unsupported-type");
  }

  let width: number;
  let height: number;
  try {
    const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    width = metadata.autoOrient.width;
    height = metadata.autoOrient.height;
  } catch {
    throw new LogoRejectedError("The image could not be decoded.", "corrupt");
  }
  if (width < MIN_LOGO_DIMENSION || height < MIN_LOGO_DIMENSION) {
    throw new LogoRejectedError(
      `The image is ${width}×${height}px; it must be at least ${MIN_LOGO_DIMENSION}×${MIN_LOGO_DIMENSION}px.`,
      "too-small",
    );
  }

  let standard: Buffer;
  let trustWallet: Buffer | null;
  try {
    standard = await squarePng(bytes, STANDARD_LOGO_SIZE, false);
    trustWallet = await squarePng(bytes, TRUST_WALLET_LOGO_SIZE, false);
    if (trustWallet.length > TRUST_WALLET_MAX_BYTES) {
      trustWallet = await squarePng(bytes, TRUST_WALLET_LOGO_SIZE, true);
    }
    if (trustWallet.length > TRUST_WALLET_MAX_BYTES) {
      trustWallet = null;
    }
  } catch {
    throw new LogoRejectedError("The image could not be decoded.", "corrupt");
  }

  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceType: detected.mime,
    sourceWidth: width,
    sourceHeight: height,
    standard,
    trustWallet,
  };
}
