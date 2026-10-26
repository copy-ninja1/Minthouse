import { type ApiEnv, apiEnvSchema, formatIssues } from "@minthouse/config";

export const API_ENV = Symbol("API_ENV");

export class InvalidEnvironmentError extends Error {
  override readonly name = "InvalidEnvironmentError";
}

/** Parses and validates the API environment. Throws before the server starts if anything is wrong. */
export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const result = apiEnvSchema.safeParse(source);
  if (!result.success) {
    const lines = formatIssues(result.error).map((issue) => `  ${issue.variable}: ${issue.message}`);
    throw new InvalidEnvironmentError(`Invalid API environment:\n${lines.join("\n")}`);
  }
  return result.data;
}
