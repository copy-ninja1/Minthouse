import { randomUUID } from "node:crypto";
import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import type { ApiEnv } from "@minthouse/config";
import { AssetsController } from "./assets/assets.controller.js";
import { AssetsService } from "./assets/assets.service.js";
import { ChainClientsService } from "./chains/chain-clients.service.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { isUploadRoute } from "./common/rate-limit.js";
import { API_ENV } from "./config/env.js";
import { DeploymentVerifier } from "./deployments/deployment-verifier.js";
import { DeploymentsController } from "./deployments/deployments.controller.js";
import { DeploymentsService } from "./deployments/deployments.service.js";
import { HealthController } from "./health/health.controller.js";
import { MetadataController } from "./metadata/metadata.controller.js";
import { MetadataService } from "./metadata/metadata.service.js";
import { OperationsController } from "./operations/operations.controller.js";
import { OperationsService } from "./operations/operations.service.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { ReconcileWorker } from "./reconcile/reconcile.worker.js";
import { safeFetchProvider } from "./security/safe-fetch.provider.js";
import { createObjectStorage } from "./storage/create-storage.js";
import { ObjectStorage } from "./storage/object-storage.js";
import { TokensController } from "./tokens/tokens.controller.js";
import { TokensService } from "./tokens/tokens.service.js";

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            quietReqLogger: true,
            genReqId: (request, response) => {
              const header = request.headers["x-request-id"];
              const id = typeof header === "string" && REQUEST_ID.test(header) ? header : randomUUID();
              response.setHeader("x-request-id", id);
              return id;
            },
            serializers: {
              req: (request: { id: unknown; method: unknown; url: unknown }) => ({
                id: request.id,
                method: request.method,
                url: request.url,
              }),
              res: (response: { statusCode: unknown }) => ({ statusCode: response.statusCode }),
            },
            autoLogging: { ignore: (request) => request.url?.startsWith("/health") ?? false },
          },
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: "default", ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
            { name: "upload", ttl: 60_000, limit: env.UPLOAD_RATE_LIMIT_PER_MINUTE, skipIf: (context) => !isUploadRoute(context) },
          ],
        }),
      ],
      controllers: [
        HealthController,
        AssetsController,
        MetadataController,
        DeploymentsController,
        OperationsController,
        TokensController,
      ],
      providers: [
        { provide: API_ENV, useValue: env },
        { provide: ObjectStorage, useFactory: () => createObjectStorage(env) },
        safeFetchProvider,
        PrismaService,
        ChainClientsService,
        AssetsService,
        MetadataService,
        DeploymentVerifier,
        DeploymentsService,
        OperationsService,
        TokensService,
        ReconcileWorker,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
