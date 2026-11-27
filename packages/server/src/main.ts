// Development entry point: `pnpm dev:web` runs this next to the Vite dev server, which proxies /api.
import { defaultHome } from "@reeve/engine";
import { homedir } from "node:os";
import { startServer } from "./index.ts";

const server = await startServer({
  home: defaultHome(process.env, homedir()),
  port: Number(process.env["REEVE_PORT"] ?? 4620),
});

const devUrl = process.env["REEVE_WEB_URL"] ?? "http://localhost:5620";
console.log(`reeve API on ${server.url}`);
console.log(`Open ${devUrl}`);

const shutdown = () => void server.close().then(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
