import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

export type ValidationIssue = { path: string; message: string };

export class RequestValidationException extends BadRequestException {
  constructor(readonly issues: ValidationIssue[]) {
    super("The request is invalid.");
  }
}

/** Validates and transforms a request part with a shared Zod schema. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new RequestValidationException(
        result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
      );
    }
    return result.data;
  }
}
