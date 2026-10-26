import { z } from "zod";
import { parseCliEnv } from "@minthouse/config/cli";
import { solanaAddress } from "./context.js";

const decimalAmount = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Plain decimal number of whole tokens, e.g. 1000 or 0.5");

export const mintEnv = z.object({ MINT: solanaAddress });
export const recipientAmountEnv = mintEnv.extend({ RECIPIENT: solanaAddress, AMOUNT: decimalAmount });
export const amountEnv = mintEnv.extend({ AMOUNT: decimalAmount });
export const ownerEnv = mintEnv.extend({ OWNER: solanaAddress.optional() });
export const newAuthorityEnv = mintEnv.extend({ NEW_AUTHORITY: solanaAddress });

export function readEnv<S extends z.ZodType>(schema: S): z.infer<S> {
  return parseCliEnv(schema);
}
