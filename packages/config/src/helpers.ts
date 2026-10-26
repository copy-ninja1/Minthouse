import { z } from "zod";
import { NETWORK_IDS, type NetworkId } from "@minthouse/shared";

export const booleanString = (defaultValue: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .default(defaultValue ? "true" : "false")
    .transform((value) => value === "true" || value === "1");

export const networkList = (defaultValue: readonly NetworkId[]) =>
  z
    .string()
    .default(defaultValue.join(","))
    .transform((value, ctx) => {
      const ids = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const invalid = ids.filter((id) => !(NETWORK_IDS as readonly string[]).includes(id));
      if (invalid.length > 0) {
        ctx.addIssue({ code: "custom", message: `Unknown network id(s): ${invalid.join(", ")}` });
        return z.NEVER;
      }
      return [...new Set(ids)] as NetworkId[];
    });

export const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.url({ protocol: /^https?$/ }).optional());

/** Names that must never appear in a browser-exposed (VITE_*) variable. */
const SECRET_NAME_PATTERN = /(PRIVATE|SECRET|MNEMONIC|SEED|JWT|PASSWORD|API_KEY|KEYPAIR)/i;

/** Returns the names of client-exposed variables that look like they contain secrets. */
export function findLeakedClientSecrets(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((name) => name.startsWith("VITE_") && SECRET_NAME_PATTERN.test(name));
}

export type EnvIssue = { variable: string; message: string };

export function formatIssues(error: z.ZodError): EnvIssue[] {
  return error.issues.map((issue) => ({
    variable: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}
