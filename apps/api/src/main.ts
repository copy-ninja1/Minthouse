import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApp } from "./bootstrap.js";
import { loadApiEnv } from "./config/env.js";

const env = loadApiEnv();
const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), { bufferLogs: true });
configureApp(app, env);
await app.listen(env.PORT);
