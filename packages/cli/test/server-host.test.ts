import { startServer } from "@reeve/server";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const home = mkdtempSync(join(tmpdir(), "reeve-host-"));
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer({ home, port: 0 });
});

afterAll(async () => {
  await server.close();
  rmSync(home, { recursive: true, force: true });
});

const statusWith = (host: string, path = "/api/openapi.json") =>
  new Promise<number>((resolve, reject) => {
    const { hostname, port } = new URL(server.url);
    const sent = request({ hostname, port, path, headers: { host } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    sent.on("error", reject);
    sent.end();
  });

describe("a request's Host", () => {
  it.each([
    "evil.example",
    "evil.example:4620",
    "127.0.0.1.evil.example",
    "localhost.evil.example",
  ])("refuses %s, which is how a web page reaches a loopback server", async (host) => {
    expect(await statusWith(host)).toBe(403);
  });

  it.each(["127.0.0.1", "127.0.0.1:4620", "localhost", "localhost:5620", "[::1]:4620"])(
    "accepts %s",
    async (host) => {
      expect(await statusWith(host)).toBe(200);
    },
  );
});
