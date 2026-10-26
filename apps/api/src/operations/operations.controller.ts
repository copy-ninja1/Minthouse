import { Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { type OperationHistoryItem, operationHistoryQuerySchema, upsertOperationRequestSchema } from "@minthouse/shared";
import type { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { OperationsService } from "./operations.service.js";

@Controller("operations")
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Post()
  async upsert(
    @Body(new ZodValidationPipe(upsertOperationRequestSchema)) body: z.output<typeof upsertOperationRequestSchema>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OperationHistoryItem> {
    const { item, created } = await this.operations.upsert(body);
    response.status(created ? 201 : 200);
    return item;
  }

  @Get()
  history(@Query(new ZodValidationPipe(operationHistoryQuerySchema)) query: z.output<typeof operationHistoryQuerySchema>): Promise<OperationHistoryItem[]> {
    return this.operations.history(query);
  }
}
