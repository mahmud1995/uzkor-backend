import "dotenv/config";
import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { entities } from "./entities";
export default defineConfig({
  clientUrl: process.env.DATABASE_URL,
  entities,
  extensions: [Migrator],
  migrations: {
    path: "dist/database/migrations",
    pathTs: "src/database/migrations",
    transactional: true,
  },
});
