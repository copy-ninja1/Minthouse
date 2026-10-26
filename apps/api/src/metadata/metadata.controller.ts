import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  type MetadataVerification,
  type PublishedMetadata,
  publishMetadataRequestSchema,
  verifyMetadataRequestSchema,
} from "@minthouse/shared";
import type { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { UploadRateLimit } from "../common/rate-limit.js";
import { MetadataService } from "./metadata.service.js";

@Controller("metadata")
export class MetadataController {
  constructor(private readonly metadata: MetadataService) {}

  @Post()
  @HttpCode(201)
  @UploadRateLimit()
  publish(
    @Body(new ZodValidationPipe(publishMetadataRequestSchema)) body: z.output<typeof publishMetadataRequestSchema>,
  ): Promise<PublishedMetadata> {
    return this.metadata.publish(body);
  }

  @Get(":id")
  async get(@Param("id", new ParseUUIDPipe()) id: string): Promise<PublishedMetadata> {
    return this.metadata.toPublished(await this.metadata.findDocument(id));
  }

  @Post("verify")
  @HttpCode(200)
  @UploadRateLimit()
  verify(@Body(new ZodValidationPipe(verifyMetadataRequestSchema)) body: z.output<typeof verifyMetadataRequestSchema>): Promise<MetadataVerification> {
    return this.metadata.verify(body);
  }
}
