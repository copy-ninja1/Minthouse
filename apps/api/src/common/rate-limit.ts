import { type ExecutionContext, SetMetadata } from "@nestjs/common";

const UPLOAD_ROUTE = "minthouse:upload-route";

/** Marks a handler as an upload, which applies the stricter `upload` throttler. */
export const UploadRateLimit = () => SetMetadata(UPLOAD_ROUTE, true);

export function isUploadRoute(context: ExecutionContext): boolean {
  return Reflect.getMetadata(UPLOAD_ROUTE, context.getHandler()) === true;
}
