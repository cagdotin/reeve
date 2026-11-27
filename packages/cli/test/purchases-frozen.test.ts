import { connect } from "@reeve/client";
import { availableCatalog, receipts } from "@reeve/contract/catalog";
import { FEATURES } from "@reeve/contract/features";
import { startServer } from "@reeve/server";
import { Effect } from "effect";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKILL } from "../src/skill.ts";

const home = mkdtempSync(join(tmpdir(), "reeve-frozen-"));
let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer({ home, port: 0 });
});
afterAll(async () => {
  await server.close();
  rmSync(home, { recursive: true, force: true });
});

const rpc = async (body: object, headers: Record<string, string> = {}) => {
  const response = await fetch(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
};

describe("purchases is frozen in the normal build", () => {
  it("is source-controlled off, with no public operations or automation setting", () => {
    expect(FEATURES.purchases).toBe(false);
    const operations = availableCatalog();
    for (const name of Object.keys(receipts)) expect(operations).not.toHaveProperty(name);
    expect(operations.update_book!.input.fields).not.toHaveProperty("autoApplyReceipts");
    expect(SKILL).not.toMatch(/create_receipt|create_product|item_spending|autoApplyReceipts/);
  });

  it("does not publish purchase paths or the setting in OpenAPI", async () => {
    const document = await (await fetch(`${server.url}/api/openapi.json`)).json();
    const text = JSON.stringify(document);
    expect(text).not.toMatch(/receipt-photos/);
    for (const operation of Object.values(receipts))
      expect(document.paths).not.toHaveProperty(
        `/api${operation.http.path.replace(/:(\w+)/g, "{$1}")}`,
      );
  });

  it("answers every frozen HTTP operation and the binary photo route with a JSON 404", async () => {
    for (const operation of Object.values(receipts)) {
      const path = operation.http.path.replace(/:(\w+)/g, (_, key: string) =>
        key === "book" ? "~" : "missing",
      );
      const response = await fetch(`${server.url}/api${path}`, {
        method: operation.http.method,
        ...(operation.http.method === "GET"
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
      });
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
      expect((await response.json())._tag).toBe("RouteNotFound");
    }
    const response = await fetch(`${server.url}/api/books/~/receipt-photos/missing/file`);
    expect(response.status).toBe(404);
    expect((await response.json())._tag).toBe("RouteNotFound");
  });

  it("rejects the old automation input rather than silently dropping it", async () => {
    const response = await fetch(`${server.url}/api/books/~`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoApplyReceipts: true }),
    });
    expect(response.status).toBe(400);
    expect((await response.json())._tag).toBe("InvalidRequest");
  });

  it("does not advertise purchase tools or workflows in MCP", async () => {
    const init = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "freeze-test", version: "1" },
      },
    });
    expect(init.body.result.instructions).not.toContain("create_receipt");
    const headers = {
      "mcp-session-id": init.response.headers.get("mcp-session-id")!,
      "mcp-protocol-version": "2025-06-18",
    };
    const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, headers);
    const names = listed.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("create_transaction");
    for (const name of Object.keys(receipts)) expect(names).not.toContain(name);
    const called = await rpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_receipt",
          arguments: { date: "2026-01-01", total: 100 },
        },
      },
      headers,
    );
    expect(called.body.error).toBeDefined();
  });

  it("filters the connection used by stdio MCP and rejects unavailable calls before opening a book", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "reeve-no-purchases-"));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connect({ home: scratch });
            expect(connection.operations).not.toHaveProperty("create_receipt");
            const failure = yield* Effect.flip(
              connection.run("create_receipt", { date: "2026-01-01", total: 100 }),
            );
            expect(failure._tag).toBe("InvalidRequest");
          }),
        ),
      );
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("omits purchase commands and flags from the real CLI", async () => {
    const cli = resolve("packages/cli/src/main.ts");
    const run = (args: string[]) =>
      promisify(execFile)(process.execPath, [cli, ...args], {
        env: { ...process.env, REEVE_HOME: home },
        timeout: 10000,
      });
    const help = await run(["--help"]);
    expect(help.stdout).toContain("transactions");
    expect(help.stdout).not.toMatch(/receipts|products|items/);
    expect((await run(["books", "update", "--help"])).stdout).not.toContain("auto-apply-receipts");
    await expect(run(["receipts", "list"])).rejects.toThrow(/receipts/);
  }, 20000);
});
