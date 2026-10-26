import { BadRequestException, Controller, HttpCode, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { LogoAsset } from "@minthouse/shared";
import { UploadRateLimit } from "../common/rate-limit.js";
import { AssetsService } from "./assets.service.js";

/** Multer's own cap; the configured MAX_LOGO_BYTES is enforced again in the service. */
const MULTER_MAX_BYTES = 10 * 1024 * 1024;

@Controller("assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post("logo")
  @HttpCode(201)
  @UploadRateLimit()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MULTER_MAX_BYTES, files: 1, fields: 0 } }))
  async uploadLogo(@UploadedFile() file: Express.Multer.File | undefined): Promise<LogoAsset> {
    if (!file) {
      throw new BadRequestException('Send the image as multipart form field "file".');
    }
    return this.assets.uploadLogo(file.buffer);
  }
}
