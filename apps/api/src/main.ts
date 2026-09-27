import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module";

/**
 * Application entry point. Phase 0 keeps this minimal — a health endpoint and
 * baseline security headers. Global auth guard, validation pipe, and CORS
 * config for the web app's origin land in Phase 1 (see PROJECT_STATUS.md).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  // Phase 0: open CORS during local development. Phase 1 restricts this to
  // the actual web app origin once real auth/cookies are in play.
  app.enableCors({ origin: true });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`QueueFlow API listening on port ${port}`);
}

bootstrap();
