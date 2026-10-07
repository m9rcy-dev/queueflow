import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { allowedOrigins, checkProductionConfig, trustProxyHops } from "./config/production-config";

async function bootstrap(): Promise<void> {
  const logger = new Logger("Bootstrap");

  // Phase 20: refuse to start a production deploy that's missing settings.
  const { errors, warnings } = checkProductionConfig(process.env);
  for (const warning of warnings) logger.warn(warning);
  if (errors.length > 0) {
    for (const error of errors) logger.error(error);
    throw new Error(`Refusing to start: ${errors.length} production setting(s) missing or unsafe.`);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(helmet());

  // Behind Render's load balancer: use the visitor's IP (rate limits), not the proxy's.
  const hops = trustProxyHops(process.env);
  if (hops > 0) app.set("trust proxy", hops);

  // Only the web app may call the API from a browser in production. Locally
  // any origin is allowed (localhost, or a phone on the Mac's IP — Phase 19).
  const production = process.env.NODE_ENV === "production";
  app.enableCors({ origin: production ? allowedOrigins(process.env) : true });

  // Finish in-flight requests and close the database cleanly on redeploys (SIGTERM).
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`QueueFlow API listening on port ${port}`);
}

void bootstrap();
