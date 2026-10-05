import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
export function buildOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("Preorder Commerce API")
    .setDescription(
      "Guaranteed reservations, timed launches and checkout. Monetary values are strings in integer minor units.",
    )
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  for (const path of Object.values(document.paths))
    for (const operation of Object.values(path ?? {})) {
      if (
        !operation ||
        typeof operation !== "object" ||
        !("responses" in operation)
      )
        continue;
      const op = operation as any;
      for (const [code, description] of Object.entries({
        400: "Invalid request",
        401: "Authentication or webhook signature required",
        403: "Admin role or early-access reservation required",
        404: "Resource unavailable",
        409: "Sold out, phase conflict, customer limit or data conflict",
      }))
        op.responses[code] = {
          description,
          content: {
            "application/json": {
              example: { statusCode: Number(code), error: description },
            },
          },
        };
    }
  return document;
}
