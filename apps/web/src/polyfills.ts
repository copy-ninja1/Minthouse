import { Buffer } from "buffer";

/**
 * Solana libraries read `Buffer` from the global scope. The browser does not
 * provide one, so it has to be installed before those modules run.
 */
const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
scope.Buffer = Buffer;
