import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { type z } from "zod";
import { formatIssues } from "./helpers.js";

export class ConfirmationRefusedError extends Error {
  override readonly name = "ConfirmationRefusedError";
}

export type ConfirmationRequest = {
  title: string;
  summary: Record<string, string>;
  /** Exact text the operator must type. Should name the action, asset and network. */
  phrase: string;
  warning?: string;
};

/**
 * Requires an operator to type an exact phrase before an irreversible or
 * mainnet action. In non-interactive environments (CI) the phrase must be
 * supplied in MINTHOUSE_CONFIRM; otherwise the action is refused.
 */
export async function requireTypedConfirmation(request: ConfirmationRequest): Promise<void> {
  console.log(`\n${request.title}`);
  for (const [key, value] of Object.entries(request.summary)) {
    console.log(`  ${key.padEnd(22)} ${value}`);
  }
  if (request.warning) {
    console.log(`\n  ⚠ ${request.warning}`);
  }

  if (!stdin.isTTY) {
    if (process.env.MINTHOUSE_CONFIRM === request.phrase) {
      console.log("\nConfirmed via MINTHOUSE_CONFIRM.");
      return;
    }
    throw new ConfirmationRefusedError(
      `Refusing to continue without confirmation. Run interactively, or set MINTHOUSE_CONFIRM="${request.phrase}".`,
    );
  }

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(`\nType exactly "${request.phrase}" to continue: `);
    if (answer.trim() !== request.phrase) {
      throw new ConfirmationRefusedError("Confirmation phrase did not match. Nothing was sent.");
    }
  } finally {
    readline.close();
  }
}

/**
 * Runs an operator script, printing failures as one readable line instead of
 * a stack trace. Set DEBUG=1 to include the stack.
 */
export async function runScript(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.DEBUG && error instanceof Error) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  }
}

/** Parses environment variables for a CLI script, printing every problem before exiting. */
export function parseCliEnv<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    console.error("Invalid configuration:");
    for (const issue of formatIssues(result.error)) {
      console.error(`  ${issue.variable}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
