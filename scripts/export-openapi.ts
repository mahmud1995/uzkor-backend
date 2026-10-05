import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import { buildOpenApi } from "../src/common/openapi";
import { createApp } from "../src/main";
async function main() {
  const app = await createApp();
  try {
    const document = buildOpenApi(app);
    await mkdir("docs", { recursive: true });
    await writeFile(
      "docs/openapi.json",
      JSON.stringify(document, null, 2) + "\n",
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
