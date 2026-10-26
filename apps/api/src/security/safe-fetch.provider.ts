import type { Provider } from "@nestjs/common";
import type { ApiEnv } from "@minthouse/config";
import { API_ENV } from "../config/env.js";
import { type SafeFetch, createSafeFetcher } from "./safe-fetch.js";

export type { SafeFetch };
export const SAFE_FETCH = Symbol("SAFE_FETCH");

/**
 * In development the API may fetch its own local storage; nothing else on a
 * private network is ever reachable.
 */
export const safeFetchProvider: Provider = {
  provide: SAFE_FETCH,
  inject: [API_ENV],
  useFactory: (env: ApiEnv): SafeFetch =>
    createSafeFetcher({ trustedOrigins: env.NODE_ENV === "production" ? [] : [env.PUBLIC_API_URL] }),
};
