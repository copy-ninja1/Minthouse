import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  type Deployment,
  cancelDeploymentRequestSchema,
  createDeploymentRequestSchema,
  deploymentListQuerySchema,
  recordSubmissionRequestSchema,
} from "@minthouse/shared";
import type { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { DeploymentsService } from "./deployments.service.js";

@Controller("deployments")
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  /** 201 for a new record, 200 when the idempotency key matched an identical earlier request. */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createDeploymentRequestSchema)) body: z.output<typeof createDeploymentRequestSchema>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Deployment> {
    const { deployment, created } = await this.deployments.create(body);
    response.status(created ? 201 : 200);
    return deployment;
  }

  @Get()
  list(@Query(new ZodValidationPipe(deploymentListQuerySchema)) query: z.output<typeof deploymentListQuerySchema>): Promise<Deployment[]> {
    return this.deployments.list(query);
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) id: string): Promise<Deployment> {
    return this.deployments.get(id);
  }

  @Post(":id/submission")
  @HttpCode(200)
  recordSubmission(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(recordSubmissionRequestSchema)) body: z.output<typeof recordSubmissionRequestSchema>,
  ): Promise<Deployment> {
    return this.deployments.recordSubmission(id, body);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(cancelDeploymentRequestSchema)) body: z.output<typeof cancelDeploymentRequestSchema>,
  ): Promise<Deployment> {
    return this.deployments.cancel(id, body);
  }
}
