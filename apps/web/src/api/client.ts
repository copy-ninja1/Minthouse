import axios, { AxiosError } from "axios";
import type { z } from "zod";
import { type ApiError, apiErrorSchema } from "@minthouse/shared";
import { env } from "@/lib/env";

/**
 * Error thrown for every failed API call. `status` is null when the request
 * never got an HTTP response (offline, CORS, timeout).
 */
export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";

  constructor(
    message: string,
    readonly status: number | null,
    readonly requestId: string | undefined,
    readonly issues: ApiError["issues"],
  ) {
    super(message);
  }
}

export const apiClient = axios.create({
  baseURL: env.VITE_API_URL,
  timeout: 20_000,
  headers: { Accept: "application/json" },
});

apiClient.interceptors.request.use((config) => {
  config.headers.set("x-request-id", crypto.randomUUID());
  return config;
});

apiClient.interceptors.response.use(undefined, (error: unknown) => Promise.reject(toApiRequestError(error)));

function toApiRequestError(error: unknown): ApiRequestError {
  if (!(error instanceof AxiosError)) {
    return new ApiRequestError("Unexpected error while contacting the Minthouse API.", null, undefined, undefined);
  }
  if (!error.response) {
    const message =
      error.code === AxiosError.ECONNABORTED
        ? "The Minthouse API took too long to respond."
        : "Could not reach the Minthouse API. Check your connection and try again.";
    return new ApiRequestError(message, null, undefined, undefined);
  }
  const parsed = apiErrorSchema.safeParse(error.response.data);
  if (parsed.success) {
    return new ApiRequestError(parsed.data.message, parsed.data.statusCode, parsed.data.requestId, parsed.data.issues);
  }
  return new ApiRequestError(`The API responded with status ${error.response.status}.`, error.response.status, undefined, undefined);
}

/**
 * Validates a response body against its shared schema. The API and web app
 * share these schemas, so a mismatch means a version skew worth surfacing.
 */
export function parseResponse<Schema extends z.ZodType>(schema: Schema, data: unknown): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiRequestError("The API returned data in an unexpected format.", null, undefined, undefined);
  }
  return result.data;
}
