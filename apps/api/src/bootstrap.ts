import type { ServerResponse } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import type { ApiEnv } from "@minthouse/config";
import { LOCAL_STORAGE_ROUTE, LocalStorage } from "./storage/local.storage.js";
import { ObjectStorage } from "./storage/object-storage.js";

/** HTTP-level hardening shared by the server entry point and the e2e tests. */
export function configureApp(app: NestExpressApplication, env: ApiEnv): void {
  app.useLogger(app.get(Logger));
  app.set("trust proxy", env.TRUST_PROXY ? 1 : false);
  // Logos are embedded by the web app from another origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.enableCors({
    origin: env.CORS_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["content-type", "x-request-id"],
    exposedHeaders: ["x-request-id"],
    maxAge: 600,
  });
  app.useBodyParser("json", { limit: "100kb" });

  const storage = app.get(ObjectStorage);
  if (storage instanceof LocalStorage) {
    app.useStaticAssets(storage.directory, {
      prefix: LOCAL_STORAGE_ROUTE,
      index: false,
      dotfiles: "deny",
      immutable: true,
      maxAge: "1d",
      setHeaders: (response: ServerResponse) => {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Security-Policy", "default-src 'none'");
      },
    });
  }
  app.enableShutdownHooks();
}
