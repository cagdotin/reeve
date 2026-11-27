import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import remarkGfm from "remark-gfm";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";

// The engine's defaultHome, which this config cannot import.
const home =
  process.env["REEVE_HOME"] ??
  join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "reeve");

/**
 * The server to proxy to: the one on REEVE_API_PORT when it is set, otherwise the one
 * `server.json` names at each request, as every reeve client finds it (docs/rules/boundaries.md). The desktop
 * app's server can be one it attached to or a child on another port.
 */
const target = () => {
  const port = process.env["REEVE_API_PORT"];
  if (port !== undefined) return `http://127.0.0.1:${port}`;
  try {
    return (JSON.parse(readFileSync(join(home, "server.json"), "utf8")) as { url: string }).url;
  } catch {
    return "http://127.0.0.1:4620";
  }
};

const proxy: ProxyOptions = {
  // The proxy copies its options at each request, so a getter gives each one the current server.
  get target() {
    return target();
  },
  configure: (server) => {
    server.on("proxyRes", (res, _req, out) => {
      if (!String(res.headers["content-type"]).startsWith("text/event-stream")) return;
      // If the API goes away, drop the browser's stream too so EventSource notices and the sync
      // machine can reconnect; otherwise the proxy keeps it open forever.
      res.once("close", () => {
        if (!out.writableEnded) out.destroy();
      });
    });
  },
};

/** Compiles `.mdx`, leaving the `?raw` imports the docs app reads titles and `.md` through. */
const docsMdx = (): Plugin => {
  const plugin = mdx({ include: /\.mdx$/, mdExtensions: [], remarkPlugins: [remarkGfm] }) as Plugin;
  const compile = plugin.transform as (code: string, id: string) => unknown;
  return {
    ...plugin,
    enforce: "pre",
    transform(code, id) {
      return id.includes("?raw") ? undefined : (compile.call(this, code, id) as undefined);
    },
  };
};

export default defineConfig({
  plugins: [
    docsMdx(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react({ include: /\.(mdx|[jt]sx?)$/ }),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // `docs/` compiles into imports of React, and lies outside this package's node_modules.
    dedupe: ["react"],
  },
  server: {
    port: 5620,
    strictPort: true,
    proxy: {
      "/api": proxy,
      "/mcp": proxy,
    },
  },
});
