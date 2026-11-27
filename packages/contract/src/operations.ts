/**
 * Calls operations by name over HTTP from the browser: the input is the catalog's flat struct,
 * split into path parameters and the query (GET) or JSON body, as the server's endpoints read it.
 * Only types come from the catalog, so no Effect code reaches the bundle.
 */
import type { Catalog, FileSuccess, OperationName } from "./catalog.ts";
import { ApiError, createClient } from "./client.ts";
import { routes } from "./routes.gen.ts";

export type Input<K extends OperationName> = Catalog[K]["input"]["Type"];

export type Output<K extends OperationName> = Catalog[K]["success"] extends FileSuccess
  ? Blob
  : Catalog[K]["success"] extends { readonly Type: infer T }
    ? T
    : never;

export { ApiError };

const queryValues = (value: unknown): Array<string> =>
  value === undefined
    ? []
    : value === null
      ? [""]
      : Array.isArray(value)
        ? value.map(String)
        : [String(value)];

export const createOperations = (baseUrl: string, defaultBook = "~") => {
  const base = baseUrl.replace(/\/$/, "");
  const { url: routeUrl } = createClient(base);

  const run = async <K extends OperationName>(name: K, input: Input<K>): Promise<Output<K>> => {
    const route = (routes as Record<string, readonly [string, string]>)[name];
    if (route === undefined)
      throw new ApiError(404, { _tag: "RouteNotFound", message: `No operation ${name}` });
    const [method, template] = route;
    const rest: Record<string, unknown> = { ...(input as object) };
    const path = template.replace(/:(\w+)/g, (_, key: string) => {
      const value = rest[key] ?? (key === "book" ? defaultBook : undefined);
      delete rest[key];
      if (typeof value !== "string" || value === "" || value === "." || value === "..")
        throw new ApiError(400, { _tag: "InvalidRequest", message: `Missing ${key}` });
      return encodeURIComponent(value);
    });
    const search = new URLSearchParams();
    if (method === "GET")
      for (const [key, value] of Object.entries(rest))
        for (const each of queryValues(value)) search.append(key, each);
    const qs = search.toString();
    const response = await fetch(`${base}${path}${qs === "" ? "" : `?${qs}`}`, {
      method,
      ...(method === "GET"
        ? {}
        : { body: JSON.stringify(rest), headers: { "content-type": "application/json" } }),
    });
    if (!response.ok)
      throw new ApiError(response.status, await response.json().catch(() => undefined));
    const type = response.headers.get("content-type") ?? "";
    if (response.status === 204) return undefined as Output<K>;
    return (type.includes("json") ? await response.json() : await response.blob()) as Output<K>;
  };

  return { run, url: routeUrl };
};

export type Operations = ReturnType<typeof createOperations>;
