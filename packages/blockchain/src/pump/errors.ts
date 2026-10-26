import { TX_ERROR_MESSAGES } from "@minthouse/shared";
import { type ClassifiedSolanaError, classifySolanaError } from "../solana/errors.js";

/** Pump program error codes (from the official IDL) that mean the slippage bound was hit. */
const PUMP_SLIPPAGE_ERRORS = [6002, 6003] as const;
const PUMP_CURVE_COMPLETE_ERROR = 6005;

function customCode(error: unknown, logs: string[]): number | null {
  const text = `${error instanceof Error ? error.message : JSON.stringify(error)} ${logs.join(" ")}`;
  const json = /"Custom":\s*(\d+)/.exec(text)?.[1];
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text)?.[1];
  const anchor = /Error Number: (\d+)/.exec(text)?.[1];
  const raw = json ?? anchor ?? (hex ? String(Number.parseInt(hex, 16)) : undefined);
  return raw === undefined ? null : Number(raw);
}

/** Classifies a failed Pump trade or launch, recognising the program's own errors first. */
export function classifyPumpError(error: unknown, logs: string[] = []): ClassifiedSolanaError {
  const code = customCode(error, logs);
  if (code !== null && (PUMP_SLIPPAGE_ERRORS as readonly number[]).includes(code)) {
    return { code: "SLIPPAGE_EXCEEDED", message: TX_ERROR_MESSAGES.SLIPPAGE_EXCEEDED, ...(logs.length > 0 ? { logs } : {}) };
  }
  if (code === PUMP_CURVE_COMPLETE_ERROR) {
    return {
      code: "REVERTED",
      message: "The bonding curve completed before your trade landed. Nothing was traded; the coin now trades on PumpSwap.",
      ...(logs.length > 0 ? { logs } : {}),
    };
  }
  return classifySolanaError(error, logs);
}
