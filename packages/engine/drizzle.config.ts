import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./packages/engine/src/db/schema.ts",
    "./packages/engine/src/receipts/schema.ts",
    "./packages/engine/src/bank/schema.ts",
  ],
  out: "./packages/engine/drizzle",
});
