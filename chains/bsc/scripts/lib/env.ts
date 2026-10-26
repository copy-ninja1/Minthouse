import { z } from "zod";
import { type Address, getAddress } from "viem";
import { evmAddressField } from "@minthouse/shared";
import { parseCliEnv } from "@minthouse/config/cli";

const address = evmAddressField.transform((value): Address => getAddress(value));
const decimalAmount = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Plain decimal number of whole tokens, e.g. 1000 or 0.5");

export const tokenEnv = z.object({ TOKEN_ADDRESS: address });
export const recipientAmountEnv = tokenEnv.extend({ RECIPIENT: address, AMOUNT: decimalAmount });
export const amountEnv = tokenEnv.extend({ AMOUNT: decimalAmount });
export const accountEnv = tokenEnv.extend({ ACCOUNT: address.optional() });
export const spenderEnv = tokenEnv.extend({ OWNER: address.optional(), SPENDER: address });
export const newOwnerEnv = tokenEnv.extend({ NEW_OWNER: address });

export function readEnv<S extends z.ZodType>(schema: S): z.infer<S> {
  return parseCliEnv(schema);
}
