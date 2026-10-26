import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiError } from "@minthouse/shared";
import { RequestValidationException } from "./zod-validation.pipe.js";

function messageOf(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === "string") {
    return body;
  }
  if (typeof body === "object" && "message" in body) {
    const { message } = body;
    if (typeof message === "string") {
      return message;
    }
    if (Array.isArray(message)) {
      return message.map(String).join("; ");
    }
  }
  return exception.message;
}

/**
 * Client errors raised by Express middleware (body-parser, serve-static, …)
 * follow the `http-errors` convention: `expose` marks a message as safe to show.
 */
function exposedClientError(exception: unknown): { status: number; message: string } | null {
  if (typeof exception !== "object" || exception === null) {
    return null;
  }
  const { status, expose, message } = exception as { status?: unknown; expose?: unknown; message?: unknown };
  if (typeof status === "number" && status >= 400 && status < 500 && expose === true) {
    return { status, message: typeof message === "string" ? message : "Bad request" };
  }
  return null;
}

/**
 * Renders every error in the shared `ApiError` shape. Unexpected errors are
 * logged in full but reported to the client without internal details.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const requestId = typeof request.id === "string" ? request.id : undefined;

    let body: ApiError;
    const clientError = exposedClientError(exception);
    if (clientError) {
      body = {
        statusCode: clientError.status,
        error: HttpStatus[clientError.status] ?? "Error",
        message: clientError.message,
        requestId,
      };
    } else if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      body = {
        statusCode,
        error: HttpStatus[statusCode] ?? "Error",
        message: messageOf(exception),
        requestId,
        issues: exception instanceof RequestValidationException ? exception.issues : undefined,
      };
    } else {
      this.logger.error({ err: exception, requestId }, "Unhandled error");
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
        requestId,
      };
    }
    response.status(body.statusCode).json(body);
  }
}
