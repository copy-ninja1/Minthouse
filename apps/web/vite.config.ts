import { fileURLToPath } from "node:url";
import { findLeakedClientSecrets, formatIssues, webEnvSchema } from "@minthouse/config";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, loadEnv } from "vite";

/** Resolves workspace packages from TypeScript source, matching the rest of the monorepo. */
const SOURCE_CONDITION = "@minthouse/source";

/** Fails the build on invalid `VITE_*` values or anything that looks like a secret headed for the bundle. */
function assertValidClientEnv(mode: string): void {
  const clientEnv = loadEnv(mode, process.cwd(), "VITE_");
  const leaked = findLeakedClientSecrets(clientEnv);
  if (leaked.length > 0) {
    throw new Error(`Refusing to bundle secret-looking variables into the browser: ${leaked.join(", ")}`);
  }
  const result = webEnvSchema.safeParse(clientEnv);
  if (!result.success) {
    const lines = formatIssues(result.error).map((issue) => `  ${issue.variable}: ${issue.message}`);
    throw new Error(`Invalid web environment:\n${lines.join("\n")}`);
  }
}

export default defineConfig(({ mode }) => {
  assertValidClientEnv(mode);

  return {
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      conditions: [SOURCE_CONDITION, ...defaultClientConditions],
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173 },
  };
});
