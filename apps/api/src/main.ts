import "./instrument.js";
import "reflect-metadata";
import { formatConfigErrorAndExit } from "@isms/config";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { type AppConfig, loadAppConfig } from "./config.js";
import { configureApp } from "./platform/index.js";

async function bootstrap(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadAppConfig();
  } catch (err) {
    return formatConfigErrorAndExit(err);
  }
  // No setGlobalPrefix: every contract declares its full /api/v1 path.
  const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
  configureApp(app, {
    trustProxy: config.TRUST_PROXY,
    uploadLimits: { EVIDENCE_MAX_BYTES: config.EVIDENCE_MAX_BYTES },
  });
  app.enableShutdownHooks();
  await app.listen(config.API_PORT);
  app.get(Logger).log(`isms-api listening on :${String(config.API_PORT)}`, "Bootstrap");
}

void bootstrap();
