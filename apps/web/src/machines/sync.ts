import { createCallbackLogic, setup, types } from "xstate";

/** Events the EventSource actor reports back to the machine. */
type SourceEvent = { type: "OPEN" } | { type: "ERROR" } | { type: "CHANGE"; book: string };

type SyncEvent = SourceEvent | { type: "ONLINE" } | { type: "OFFLINE" } | { type: "RETRY" };

export interface SyncInput {
  url: string;
  /** Called for every `change` event, and with `null` after (re)connecting to resync everything. */
  onChange: (book: string | null) => void;
}

const MAX_ATTEMPTS = 6;

const eventSource = createCallbackLogic<SyncEvent, { url: string }>(({ sendBack, input }) => {
  const source = new EventSource(input.url, { withCredentials: true });
  source.addEventListener("open", () => sendBack({ type: "OPEN" }));
  // EventSource retries by itself; close it so the machine owns the backoff and status.
  source.addEventListener("error", () => {
    source.close();
    sendBack({ type: "ERROR" });
  });
  source.addEventListener("change", (event) => {
    try {
      const data: unknown = JSON.parse(event.data);
      if (
        typeof data === "object" &&
        data !== null &&
        "book" in data &&
        typeof data.book === "string"
      ) {
        sendBack({ type: "CHANGE", book: data.book });
      }
    } catch {
      // Ignore malformed payloads; the next change or reconnect resyncs.
    }
  });
  return () => source.close();
});

const networkStatus = createCallbackLogic<SyncEvent>(({ sendBack }) => {
  const online = () => sendBack({ type: "ONLINE" });
  const offline = () => sendBack({ type: "OFFLINE" });
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
});

const browserOffline = () => typeof navigator !== "undefined" && !navigator.onLine;

const startOver = { target: "connected", context: { attempts: 0 } } as const;

/**
 * Live sync over `/api/events`: connecting → live, and on errors reconnecting with exponential
 * backoff until it gives up (offline). Going back online or RETRY starts over.
 */
export const syncMachine = setup({
  schemas: {
    context: types<SyncInput & { attempts: number }>(),
    events: {
      OPEN: types<{}>(),
      ERROR: types<{}>(),
      CHANGE: types<{ book: string }>(),
      ONLINE: types<{}>(),
      OFFLINE: types<{}>(),
      RETRY: types<{}>(),
    },
    input: types<SyncInput>(),
  },
  actors: { eventSource, networkStatus },
  delays: {
    backoff: ({ context }) => Math.min(30_000, 1_000 * 2 ** (context.attempts - 1)),
  },
}).createMachine({
  id: "sync",
  context: ({ input }) => ({ ...input, attempts: 0 }),
  invoke: { src: "networkStatus" },
  initial: "connected",
  on: {
    OFFLINE: { target: ".offline" },
  },
  states: {
    connected: {
      invoke: { src: "eventSource", input: ({ context }) => ({ url: context.url }) },
      initial: "connecting",
      on: {
        ERROR: ({ context }) =>
          context.attempts >= MAX_ATTEMPTS
            ? { target: "offline" }
            : { target: "reconnecting", context: { attempts: context.attempts + 1 } },
      },
      states: {
        connecting: {
          on: { OPEN: { target: "live" } },
        },
        live: {
          // Anything may have changed while we were away.
          entry: ({ context }, enq) => {
            enq(() => context.onChange(null));
            return { context: { attempts: 0 } };
          },
          on: { CHANGE: ({ context, event }, enq) => enq(() => context.onChange(event.book)) },
        },
      },
    },
    reconnecting: {
      always: () => (browserOffline() ? { target: "offline" } : undefined),
      after: { backoff: { target: "connected" } },
      on: { RETRY: { target: "connected" } },
    },
    offline: {
      // Keep trying slowly in case the server comes back without a network change.
      after: { 30_000: startOver },
      on: { ONLINE: startOver, RETRY: startOver },
    },
  },
});

export type SyncStatus = "connecting" | "live" | "reconnecting" | "offline";
