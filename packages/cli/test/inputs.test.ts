import { connect } from "@reeve/client";
import { startServer, type RunningServer } from "@reeve/server";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, afterAll, beforeAll, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));

// Every surface refuses an input key the operation does not know (docs/rules/boundaries.md).

const receipt = { date: "2026-10-10", total: 100 };
const nested = { ...receipt, lines: [{ text: "MILK", lineTotal: 100, price: 100 }] };

const homes: Array<string> = [];
const scratchHome = () => {
  const home = mkdtempSync(join(tmpdir(), "reeve-test-"));
  homes.push(home);
  return home;
};

let server: RunningServer;
beforeAll(async () => {
  server = await startServer({ home: scratchHome(), port: 0 });
});
afterAll(async () => {
  await server.close();
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
};

describe("HTTP", () => {
  it("answers an unknown body field with a 400 naming it", async () => {
    const { status, body } = await post("/api/books/~/receipts", { ...receipt, store: "Grocer" });
    expect(status).toBe(400);
    expect(body._tag).toBe("InvalidRequest");
    expect(body.message).toContain(`["store"]`);
  });

  it("names an unknown field in a nested struct by its path", async () => {
    const { status, body } = await post("/api/books/~/receipts", nested);
    expect(status).toBe(400);
    expect(body.message).toContain(`["lines"][0]["price"]`);
  });

  it("refuses an unknown field deep in a saved report and saves nothing", async () => {
    const list = async () =>
      (await fetch(`${server.url}/api/books/~/saved-reports`)).json() as Promise<unknown>;
    const before = await list();
    const { status, body } = await post("/api/books/~/saved-reports", {
      name: "Invalid",
      definition: {
        version: 1,
        type: "net-worth",
        settings: { timeFrame: { start: "2026-01", extra: true } },
        scope: { accounts: { mode: "all" } },
      },
    });
    expect(status).toBe(400);
    expect(body.message).toContain(`["extra"]`);
    expect(await list()).toEqual(before);
  });

  it("answers an unknown query parameter with a 400 naming it", async () => {
    const response = await fetch(`${server.url}/api/books/~/accounts?colour=red`);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain(`["colour"]`);
  });
});

describe("MCP", () => {
  const session = async () => {
    const headers: Record<string, string> = { accept: "application/json, text/event-stream" };
    const init = await post(
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      headers,
    );
    headers["mcp-session-id"] = init.headers.get("mcp-session-id")!;
    headers["mcp-protocol-version"] = "2025-06-18";
    let id = 0;
    return (method: string, params: object) =>
      post("/mcp", { jsonrpc: "2.0", id: ++id, method, params }, headers).then((each) => each.body);
  };

  it("refuses an unknown argument, naming it", async () => {
    const send = await session();
    const answer = await send("tools/call", {
      name: "create_receipt",
      arguments: { ...receipt, store: "Grocer" },
    });
    expect(answer.error.code).toBe(-32602);
    expect(answer.error.message).toContain(`["store"]`);
    const nestedAnswer = await send("tools/call", { name: "create_receipt", arguments: nested });
    expect(nestedAnswer.error.message).toContain(`["lines"][0]["price"]`);
  });

  it("tells agents in each tool's schema that no other argument is allowed", async () => {
    const send = await session();
    const { result } = await send("tools/list", {});
    const tool = result.tools.find((each: { name: string }) => each.name === "create_receipt");
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });
});

describe("connect()", () => {
  const run = (home: string, name: string, input: object) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(connect({ home }), (connection) => Effect.flip(connection.run(name, input))),
      ),
    );

  it("refuses an unknown field on the engine in this process", async () => {
    const error = await run(scratchHome(), "create_receipt", { ...receipt, store: "Grocer" });
    expect(error._tag).toBe("InvalidRequest");
    expect(error.message).toContain(`["store"]`);
  });

  it("refuses an unknown field before sending it to a server", async () => {
    const homeOfServer = homes[0]!;
    const error = await run(homeOfServer, "create_receipt", nested);
    expect(error._tag).toBe("InvalidRequest");
    expect(error.message).toContain(`["lines"][0]["price"]`);
  });
});
