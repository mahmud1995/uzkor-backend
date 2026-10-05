import { buildOpenApi } from "./common/openapi";
import "reflect-metadata";
import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { Errors } from "./common/errors";
export async function createApp() {
  for (const key of ["JWT_SECRET", "PAYMENT_WEBHOOK_SECRET"])
    if ((process.env[key]?.length ?? 0) < 32)
      throw new Error(`${key} must contain at least 32 characters`);
  const hold = Number(process.env.PAYMENT_HOLD_MINUTES ?? 15);
  if (!Number.isInteger(hold) || hold < 1 || hold > 60)
    throw new Error("PAYMENT_HOLD_MINUTES must be an integer between 1 and 60");
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  if (process.env.ENABLE_DOCS === "true") {
    const document = buildOpenApi(app);
    SwaggerModule.setup("docs", app, document, {
      jsonDocumentUrl: "openapi.json",
    });
  }
  return app;
}
if (require.main === module)
  createApp()
    .then((app) => app.listen(Number(process.env.PORT ?? 3000)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
