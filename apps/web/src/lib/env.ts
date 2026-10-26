import { type WebEnv, formatIssues, webEnvSchema } from "@minthouse/config";

export class InvalidWebEnvError extends Error {
  override readonly name = "InvalidWebEnvError";
}

/**
 * Validates the browser build configuration once at startup so a bad
 * `VITE_*` value fails loudly instead of producing silent request errors.
 */
function loadWebEnv(): WebEnv {
  const result = webEnvSchema.safeParse(import.meta.env);
  if (!result.success) {
    const lines = formatIssues(result.error).map((issue) => `${issue.variable}: ${issue.message}`);
    throw new InvalidWebEnvError(`Invalid web environment. ${lines.join("; ")}`);
  }
  return result.data;
}

export const env = loadWebEnv();
