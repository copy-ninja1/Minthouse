import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  LogoRejectedError,
  STANDARD_LOGO_SIZE,
  TRUST_WALLET_LOGO_SIZE,
  TRUST_WALLET_MAX_BYTES,
  processLogo,
} from "../src/assets/logo-processing.js";
import { testPng } from "./helpers.js";

const MAX = 2 * 1024 * 1024;

async function rejection(bytes: Buffer, max = MAX): Promise<LogoRejectedError> {
  try {
    await processLogo(bytes, max);
  } catch (error) {
    if (error instanceof LogoRejectedError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the logo to be rejected");
}

describe("processLogo", () => {
  it("renders square PNG variants without cropping", async () => {
    const source = await testPng(600, 300);
    const result = await processLogo(source, MAX);
    expect(result.sourceType).toBe("image/png");
    expect(result.sourceWidth).toBe(600);
    expect(result.sourceHeight).toBe(300);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);

    const standard = await sharp(result.standard).metadata();
    expect([standard.format, standard.width, standard.height]).toEqual(["png", STANDARD_LOGO_SIZE, STANDARD_LOGO_SIZE]);
    expect(result.trustWallet).not.toBeNull();
    const trust = await sharp(result.trustWallet ?? Buffer.alloc(0)).metadata();
    expect([trust.format, trust.width, trust.height]).toEqual(["png", TRUST_WALLET_LOGO_SIZE, TRUST_WALLET_LOGO_SIZE]);
    expect(result.trustWallet?.length).toBeLessThanOrEqual(TRUST_WALLET_MAX_BYTES);

    const corner = await sharp(result.standard).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(corner[3]).toBe(0);
  });

  it("accepts JPEG and WebP by their bytes", async () => {
    const png = await testPng(200, 200);
    expect((await processLogo(await sharp(png).jpeg().toBuffer(), MAX)).sourceType).toBe("image/jpeg");
    expect((await processLogo(await sharp(png).webp().toBuffer(), MAX)).sourceType).toBe("image/webp");
  });

  it("refuses SVG, which can carry script", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><script>alert(1)</script></svg>');
    expect((await rejection(svg)).reason).toBe("unsupported-type");
  });

  it("refuses files that only claim to be images", async () => {
    expect((await rejection(Buffer.from("GIF89a not really"))).reason).toBe("unsupported-type");
    expect((await rejection(Buffer.from("%PDF-1.7 ..."))).reason).toBe("unsupported-type");
  });

  it("refuses images below the minimum size", async () => {
    const error = await rejection(await testPng(100, 300));
    expect(error.reason).toBe("too-small");
    expect(error.message).toContain("100×300");
  });

  it("refuses oversized uploads before decoding", async () => {
    expect((await rejection(await testPng(300, 300), 100)).reason).toBe("too-large");
  });

  it("refuses truncated images", async () => {
    const png = await testPng(300, 300);
    expect((await rejection(png.subarray(0, 60))).reason).toBe("corrupt");
  });
});
